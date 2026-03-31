const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const News = require('./models/News');
const Source = require('./models/Source');
const gridfs = require('./lib/gridfs');

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
];
function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getBrowserHeaders(url) {
  const origin = new URL(url).origin;
  return {
    'User-Agent': getRandomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Referer': origin + '/',
    'Cache-Control': 'max-age=0'
  };
}

async function fetchPage(url, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
      const response = await axios.get(url, {
        headers: getBrowserHeaders(url),
        timeout: 20000,
        maxRedirects: 5,
        responseType: 'arraybuffer',
        decompress: true
      });

      const contentType = response.headers['content-type'] || '';
      let charset = 'utf-8';
      const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
      if (charsetMatch) {
        charset = charsetMatch[1].toLowerCase();
      }

      const buf = Buffer.from(response.data);
      const htmlPreview = buf.toString('utf-8').substring(0, 2000);
      const metaCharset = htmlPreview.match(/charset=["']?([^"'\s;>]+)/i);
      if (metaCharset) {
        charset = metaCharset[1].toLowerCase();
      }

      const turkishCharsets = ['iso-8859-9', 'windows-1254', 'latin5'];
      if (turkishCharsets.includes(charset)) {
        const { TextDecoder } = require('util');
        const decoder = new TextDecoder(charset);
        return decoder.decode(buf);
      }

      return buf.toString('utf-8');
    } catch (err) {
      lastErr = err;
      console.log(`[Scraper] ${url} deneme ${attempt + 1} başarısız: ${err.message}`);
    }
  }
  throw lastErr;
}

async function downloadImage(imageUrl) {
  if (!imageUrl || imageUrl.startsWith('data:')) return '';

  try {
    const response = await axios.get(imageUrl, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': new URL(imageUrl).origin + '/'
      },
      timeout: 10000,
      responseType: 'arraybuffer',
      maxRedirects: 5
    });

    const contentType = response.headers['content-type'] || '';

    if (!contentType.includes('image')) {
      console.error(`[Scraper] Görsel değil (${contentType}): ${imageUrl}`);
      return '';
    }

    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';
    else if (contentType.includes('gif')) ext = '.gif';
    else {
      const urlExt = path.extname(imageUrl.split('?')[0]).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(urlExt)) {
        ext = urlExt;
      }
    }

    const filename = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    const buf = Buffer.from(response.data);
    const ct = contentType.split(';')[0].trim() || 'image/jpeg';
    const { url } = await gridfs.uploadBuffer(buf, filename, ct);
    return url;
  } catch (err) {
    console.error(`[Scraper] Görsel indirme hatası: ${err.message}`);
    return imageUrl;
  }
}

function normalizeDateValue(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;

  const compact = trimmed
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/,/, ' ')
    .trim();

  // dd.mm.yyyy hh:mm or dd/mm/yyyy hh:mm
  const trMatch = compact.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (trMatch) {
    const day = parseInt(trMatch[1], 10);
    const month = parseInt(trMatch[2], 10) - 1;
    let year = parseInt(trMatch[3], 10);
    if (year < 100) year += 2000;
    const hour = trMatch[4] ? parseInt(trMatch[4], 10) : 0;
    const minute = trMatch[5] ? parseInt(trMatch[5], 10) : 0;
    const dt = new Date(year, month, day, hour, minute);
    if (!Number.isNaN(dt.getTime())) return dt;
  }

  return null;
}

async function fetchArticlePublishedAt(articleUrl) {
  if (!articleUrl) return null;
  try {
    const html = await fetchPage(articleUrl);
    const $ = cheerio.load(html);

    const candidates = [
      $('meta[property="article:published_time"]').attr('content'),
      $('meta[name="article:published_time"]').attr('content'),
      $('meta[property="og:published_time"]').attr('content'),
      $('meta[name="og:published_time"]').attr('content'),
      $('meta[property="og:updated_time"]').attr('content'),
      $('meta[name="pubdate"]').attr('content'),
      $('meta[name="publish-date"]').attr('content'),
      $('meta[itemprop="datePublished"]').attr('content'),
      $('time').first().attr('datetime'),
      $('[itemprop="datePublished"]').first().attr('datetime'),
      $('[itemprop="datePublished"]').first().text(),
      $('.date').first().text(),
      $('.tarih').first().text(),
      $('.post-date').first().text(),
      $('.entry-date').first().text()
    ];

    for (const val of candidates) {
      const parsed = normalizeDateValue(val);
      if (parsed) return parsed;
    }
  } catch (err) {
    console.log(`[Scraper] Yayın tarihi alınamadı (${articleUrl}): ${err.message}`);
  }
  return null;
}

function resolveUrl(href, baseUrl) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (baseUrl) {
    const base = baseUrl.replace(/\/$/, '');
    const path = href.startsWith('/') ? href : '/' + href;
    return base + path;
  }
  return href;
}

function resolveImageUrl(imgEl, $, baseUrl) {
  const src = imgEl.attr('data-src') ||
              imgEl.attr('data-original') ||
              imgEl.attr('data-lazy-src') ||
              imgEl.attr('src') || '';
  if (!src || src.startsWith('data:')) return '';

  const resolved = resolveUrl(src, baseUrl);
  return upgradeImageUrl(resolved);
}

function upgradeImageUrl(url) {
  if (!url) return '';

  const placeholders = ['bos.png', 'mask-', 'placeholder', 'default-image', 'no-image'];
  if (placeholders.some(p => url.includes(p))) return '';

  return url;
}

function cleanTitle(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const CATEGORY_KEYWORDS = {
  'Spor': [
    'spor', 'maç', 'gol', 'futbol', 'basketbol', 'voleybol', 'şampiyon',
    'lig', 'takım', 'transfer', 'turnuva', 'milli takım', 'antrenör',
    'stadyum', 'güreş', 'boks', 'atletizm', 'badminton', 'karate',
    'kick boks', 'muay thai', 'forma', 'deplasman', 'galibiyet', 'mağlubiyet',
    'puan', 'kupa', 'sampiyona', 'sporcu', 'teknik direktör', 'hakem',
    'penaltı', 'yarış', 'koşu', 'yüzme', 'tenis', 'beşiktaş', 'galatasaray',
    'fenerbahçe', 'trabzonspor', 'çorluspor', 'fevzipaşa spor'
  ],
  'Ekonomi': [
    'ekonomi', 'borsa', 'dolar', 'euro', 'faiz', 'enflasyon', 'ihracat',
    'ithalat', 'yatırım', 'bütçe', 'vergi', 'ticaret', 'sanayi', 'piyasa',
    'bist', 'merkez bankası', 'ticaret odası', 'tso', 'osb', 'fabrika',
    'istihdam', 'işsizlik', 'maaş', 'zam', 'fiyat', 'ödenek', 'döviz',
    'halk et', 'tüketici', 'promosyon', 'kredi'
  ],
  'Siyaset': [
    'siyaset', 'milletvekili', 'belediye başkanı', 'parti', 'ak parti',
    'chp', 'mhp', 'iyi parti', 'meclis', 'cumhurbaşkanı', 'bakan',
    'seçim', 'oy', 'siyasi', 'vali', 'kaymakam', 'vekil', 'başkan adayı',
    'genel kurul', 'kongre', 'tbmm', 'muhalefet', 'iktidar', 'aday',
    'büyükşehir belediye'
  ],
  'Sağlık': [
    'sağlık', 'hastane', 'doktor', 'ameliyat', 'tedavi', 'hastalık',
    'kanser', 'grip', 'covid', 'aşı', 'ilaç', 'diş', 'enfeksiyon',
    'kalp', 'tansiyon', 'diyabet', 'obezite', 'beslenme', 'vitamin',
    'psikolog', 'terapi', 'bel ağrısı', 'kolon', 'ağız', 'sahur',
    'oruç', 'zayıflatan'
  ],
  'Yaşam': [
    'yaşam', 'kültür', 'sanat', 'eğitim', 'okul', 'öğrenci', 'ramazan',
    'bayram', 'festival', 'gezi', 'tatil', 'moda', 'yemek', 'tarih',
    'müze', 'sergi', 'konser', 'tiyatro', 'sinema', 'kitap', 'fener alayı',
    'bedesten', 'iftar', 'sahur', 'davulcu', 'ev modası', 'çocuk hakları'
  ],
  'Son Dakika': [
    'son dakika', 'flaş', 'acil', 'deprem', 'sel', 'kaza', 'patlama',
    'yangın', 'öldürdü', 'bıçak', 'cinayet', 'tutuklama', 'operasyon',
    'yaralı', 'hayatını kaybetti', 'saldırı', 'ölü', 'gözaltı',
    'kaçak', 'uyuşturucu', 'hırsızlık', 'gasp', 'silahlı'
  ]
};

function detectCategory(title, description, siteCategory) {
  const text = (title + ' ' + description).toLowerCase().replace(/İ/g, 'i').replace(/I/g, 'ı');

  if (siteCategory && siteCategory !== 'Gündem') {
    const validCats = ['Son Dakika', 'Gündem', 'Ekonomi', 'Spor', 'Siyaset', 'Yaşam', 'Sağlık'];
    const normalized = siteCategory.trim();
    if (validCats.includes(normalized)) return normalized;

    const siteMap = {
      'asayiş': 'Son Dakika', 'asayis': 'Son Dakika',
      'spor haber': 'Spor', 'spor': 'Spor',
      'ekonomi': 'Ekonomi',
      'siyaset': 'Siyaset',
      'sağlık': 'Sağlık', 'saglik': 'Sağlık',
      'yaşam': 'Yaşam', 'yasam': 'Yaşam',
      'eğitim': 'Yaşam', 'egitim': 'Yaşam',
      'teknoloji': 'Gündem',
      'çorlu haber': 'Gündem', 'trakya haber': 'Gündem', 'ergene haber': 'Gündem',
      'gündem': 'Gündem', 'gundem': 'Gündem'
    };
    const mapped = siteMap[normalized.toLowerCase()];
    if (mapped) return mapped;
  }

  let bestCat = 'Gündem';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        score += kw.includes(' ') ? 3 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = category;
    }
  }

  return bestCat;
}

async function scrapeSource(source) {
  const results = [];
  const seenTitles = new Set();

  try {
    const html = await fetchPage(source.url);
    const $ = cheerio.load(html);

    const baseUrl = source.baseUrl || new URL(source.url).origin;
    const articles = $(source.selectors.articleList);

    articles.each((i, el) => {
      try {
        const $el = $(el);

        const titleEl = source.selectors.title ? $el.find(source.selectors.title) : $el;
        const title = cleanTitle(titleEl.first().text());
        if (!title || title.length < 5) return;

        if (seenTitles.has(title)) return;
        seenTitles.add(title);

        let description = '';
        if (source.selectors.description) {
          description = cleanTitle($el.find(source.selectors.description).first().text());
        }
        if (!description) {
          description = title;
        }

        let image = '';
        if (source.selectors.image) {
          const imgEl = $el.find(source.selectors.image).first();
          if (imgEl.length) {
            image = imgEl.is('img') ? resolveImageUrl(imgEl, $, baseUrl) : resolveUrl(imgEl.attr('href') || '', baseUrl);
          }
        }

        let link = '';
        if (source.selectors.link) {
          if (source.selectors.link === '_self') {
            link = resolveUrl($el.attr('href') || '', baseUrl);
          } else {
            const linkEl = $el.find(source.selectors.link).first();
            link = resolveUrl(linkEl.attr('href') || '', baseUrl);
          }
        }

        let siteCategory = '';
        if (source.selectors.category) {
          siteCategory = cleanTitle($el.find(source.selectors.category).first().text());
        }

        const category = detectCategory(title, description, siteCategory);
        results.push({ title, description, image, link, category });
      } catch (err) {
        // skip malformed article
      }
    });
  } catch (err) {
    console.error(`[Scraper] ${source.name} hatası:`, err.message);
    throw err;
  }

  return results;
}

async function fetchImageFromArticlePage(articleUrl) {
  try {
    const html = await fetchPage(articleUrl);
    const $ = cheerio.load(html);
    const baseUrl = new URL(articleUrl).origin;

    const selectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      '.news-detail img', '.article-img img', '.post-img img',
      '.content img', 'article img', '.detail img',
      '.haber-detay img', '.news-image img',
      '.post-thumbnail img', '.featured-image img'
    ];

    // og:image meta tag (en güvenilir - genelde büyük görsel)
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (ogImage) return upgradeImageUrl(resolveUrl(ogImage, baseUrl));

    const twImage = $('meta[name="twitter:image"]').attr('content');
    if (twImage) return upgradeImageUrl(resolveUrl(twImage, baseUrl));

    // İçerikteki ilk büyük resmi bul
    for (const sel of selectors.slice(2)) {
      const img = $(sel).first();
      if (img.length) {
        const src = img.attr('data-src') || img.attr('src') || '';
        if (src && !src.startsWith('data:') && !src.includes('bos.png') && !src.includes('logo')) {
          return upgradeImageUrl(resolveUrl(src, baseUrl));
        }
      }
    }
  } catch (e) { /* ignore */ }
  return '';
}

async function scrapeAndSave(sourceId) {
  const source = await Source.findById(sourceId);
  if (!source) throw new Error('Kaynak bulunamadı');

  const articles = await scrapeSource(source);
  let savedCount = 0;

  for (const article of articles) {
    const exists = await News.findOne({ title: article.title });
    if (exists) continue;

    let imageUrl = article.image;

    // Görsel yoksa veya bozuksa detay sayfasından çekmeyi dene
    if (article.link) {
      const needsFetch = !imageUrl || imageUrl === '' || imageUrl.includes('-s.jpg');
      if (needsFetch) {
        try {
          const betterImg = await fetchImageFromArticlePage(article.link);
          if (betterImg) imageUrl = betterImg;
        } catch (e) { /* ignore */ }
      }
    }

    let publishedAt = null;
    if (article.link) {
      publishedAt = await fetchArticlePublishedAt(article.link);
    }

    await News.create({
      title: article.title,
      description: article.description,
      content: article.link ? `<p>Kaynak: <a href="${article.link}" target="_blank">${source.name}</a></p>` : '',
      category: article.category,
      categories: [article.category || 'Gündem'],
      image: imageUrl || '',
      publishedAt,
      placement: 'none',
      featured: false
    });
    savedCount++;
  }

  await Source.findByIdAndUpdate(sourceId, {
    lastScrapedAt: new Date(),
    lastScrapedCount: savedCount
  });

  return { total: articles.length, saved: savedCount, source: source.name };
}

async function scrapeAll() {
  const sources = await Source.find({ active: true });
  const results = [];

  for (const source of sources) {
    try {
      const result = await scrapeAndSave(source._id);
      results.push(result);
    } catch (err) {
      results.push({ source: source.name, error: err.message, total: 0, saved: 0 });
    }
  }

  return results;
}

async function previewSource(source) {
  const articles = await scrapeSource(source);
  for (const article of articles) {
    article.publishedAt = article.link ? await fetchArticlePublishedAt(article.link) : null;
  }
  return articles;
}

module.exports = { scrapeAndSave, scrapeAll, previewSource };
