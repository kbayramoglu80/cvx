require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const News = require('./models/News');
const Source = require('./models/Source');
const Ad = require('./models/Ad');
const KunyaSettings = require('./models/KunyeSettings');
const AboutSettings = require('./models/AboutSettings');
const { scrapeAndSave, scrapeAll, previewSource } = require('./scraper');
const gridfs = require('./lib/gridfs');

const fs = require('fs');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
const PORT = process.env.PORT || 8080;
const ADMIN_PATH = process.env.ADMIN_PATH || 'yonetim59x';
const ADMIN_PASS = process.env.ADMIN_PASS || 'X9k#Hb59!qTr@2026zW';

// --- Middleware ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// GridFS ile saklanan medya (MongoDB); /uploads/ klasöründen bağımsız
app.get('/api/media/:id', (req, res) => gridfs.streamToResponse(req, res));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 's3cr3t_default_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 3 * 60 * 60 * 1000 }
}));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/' + ADMIN_PATH + '/giris');
}

function normalizeAdSize(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseAdDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
}

function normalizeInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function sanitizeAdBaseName(input) {
  const value = String(input || '').trim().replace(/\s+/g, ' ');
  return value || 'Reklam';
}

function toArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

function buildAdSequenceName(baseName, index, total) {
  if (total <= 1) return baseName;
  const padLength = Math.max(2, String(total).length);
  const orderLabel = String(index + 1).padStart(padLength, '0');
  return `${baseName} - ${orderLabel}`;
}

/** "Kenan1 - 02" -> "Kenan1"; "Belediye" -> "Belediye" */
function getAdGroupKey(name) {
  if (!name || typeof name !== 'string') return name || '';
  const m = name.match(/^(.+?)\s+-\s+\d+$/);
  return m ? m[1].trim() : name.trim();
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg binary bulunamadı.'));
    }

    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += String(chunk || ''); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(stderr || `FFmpeg çıkış kodu: ${code}`));
    });
  });
}

async function convertAdMediaToMp4(file, width, height) {
  const inputPath = file.path;
  const outputFilename = `${path.parse(file.filename).name}.mp4`;
  const outputPath = path.join(uploadsDir, outputFilename);
  // Oranı koru; libx264 için genişlik ve yükseklik çift olmalı (trunc ile 2'ye yuvarla)
  const scaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`;
  const isVideo = String(file.mimetype || '').toLowerCase() === 'video/mp4';

  const args = isVideo
    ? ['-y', '-i', inputPath, '-vf', scaleFilter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-an', '-movflags', '+faststart', outputPath]
    : ['-y', '-loop', '1', '-i', inputPath, '-vf', scaleFilter, '-t', '6', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', outputPath];

  await runFfmpeg(args);

  try { fs.unlinkSync(inputPath); } catch (_) {}
  return '/uploads/' + outputFilename;
}

function parseSelectedCategories(input, fallback = 'Gündem') {
  const allowed = ['Son Dakika', 'Gündem', 'Ekonomi', 'Spor', 'Siyaset', 'Yaşam', 'Sağlık'];
  const arr = Array.isArray(input) ? input : (input ? [input] : []);
  const cleaned = [...new Set(arr.map(v => String(v).trim()).filter(v => allowed.includes(v)))];
  if (cleaned.length === 0) return [fallback];
  return cleaned;
}

function getSubmittedCategories(body) {
  return body.categories || body['categories[]'] || body.category;
}

function parseReporters(input) {
  if (!input) return [];
  return String(input)
    .split(/[\r\n,]+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function categoryFilter(category) {
  return { $or: [{ category }, { categories: { $in: [category] } }] };
}

const defaultKunye = {
  publisher: '59 HABER KUTUSU',
  tradeName: 'www59haberkutusu.com.tr',
  establishmentDate: '16.10.2025',
  legalRepresentative: 'Mehmetcan ARSLAN',
  editorInChief: 'Ege ARSLAN',
  managementAddress: 'Reşadiye Mahallesi, Şinasi Kurşun Caddesi, 7. Sokak, Mazlum Ap. No: 2 D: 6, Tekirdağ',
  reporters: [],
  hostingProvider: 'Render',
  hostingTradeName: 'Render Services, Inc.',
  hostingAddress: '525 Brannan St, Suite 300, San Francisco, CA 94107',
  corporateEmail: '59haberkutusucom@gmail.com',
  contactPhone: '+90 533 477 36 39'
};

const defaultAbout = {
  aboutText: `59 Haber Kutusu, güncel haberleri, analizleri ve gündemdeki önemli gelişmeleri sizlere hızlı ve güvenilir bir şekilde ulaştırmayı amaçlayan dijital haber platformudur. Amacımız, okurlarımıza doğru bilgiye kolay erişim sağlamak ve Türkiye'den ve dünyadan öne çıkan haberleri tarafsız bir bakış açısıyla sunmaktır.

Platformumuzda politika, ekonomi, teknoloji, kültür-sanat, spor ve yaşam gibi farklı kategorilerde içerikler bulabilir, günün öne çıkan gelişmelerini anlık olarak takip edebilirsiniz. 59 Haber Kutusu, güvenilir kaynakları titizlikle seçerek, okuyucularına bilgi kirliliğinden uzak, net ve anlaşılır haber deneyimi sunmayı hedefler.

Okurlarımızın fikirlerini önemsiyor ve etkileşimli bir haber deneyimi sunmayı önceliğimiz olarak görüyoruz. Siz de güncel gelişmeleri takip etmek, analizleri okumak ve bilgiye hızlı bir şekilde ulaşmak için 59 Haber Kutusu'nu ziyaret edebilirsiniz.`,
  copyrightText: `Tüm içerikler, görseller, videolar ve metinler 59 Haber Kutusu'na aittir ve Türkiye Cumhuriyeti Fikri ve Sınai Mülkiyet Kanunu ile korunmaktadır. İzinsiz kopyalanması, çoğaltılması, dağıtılması, ticari veya kişisel amaçlarla kullanılması kesinlikle yasaktır.

Sitedeki herhangi bir içerikten alıntı yapmak isteyen kişiler, yazılı izin almak zorundadır. Aksi durumlarda yasal işlem uygulanacaktır.`
};

async function getKunyeSettings() {
  const data = await KunyaSettings.findOne({ singletonKey: 'main' });
  const raw = data ? (typeof data.toObject === 'function' ? data.toObject() : data) : {};
  const merged = { ...defaultKunye, ...raw };
  if (!Array.isArray(merged.reporters)) {
    merged.reporters = parseReporters(merged.reporters);
  }
  return merged;
}

async function getAboutSettings() {
  const data = await AboutSettings.findOne({ singletonKey: 'main' });
  const raw = data ? (typeof data.toObject === 'function' ? data.toObject() : data) : {};
  return { ...defaultAbout, ...raw };
}

async function getSideAds(pageKey = 'all') {
  const now = new Date();
  const activeDateFilter = {
    active: true,
    $or: [{ media: { $exists: true, $ne: '' } }, { image: { $exists: true, $ne: '' } }],
    pageTarget: { $in: ['all', pageKey] },
    $and: [
      { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
      { $or: [{ endDate: null }, { endDate: { $gte: now } }] }
    ]
  };

  const [leftAds, rightAds, topAds, bottomAds, customAds] = await Promise.all([
    Ad.find({ ...activeDateFilter, position: 'left' }).sort({ sortOrder: 1, createdAt: 1 }),
    Ad.find({ ...activeDateFilter, position: 'right' }).sort({ sortOrder: 1, createdAt: 1 }),
    Ad.find({ ...activeDateFilter, position: 'top' }).sort({ sortOrder: 1, createdAt: 1 }),
    Ad.find({ ...activeDateFilter, position: 'bottom' }).sort({ sortOrder: 1, createdAt: 1 }),
    Ad.find({ ...activeDateFilter, position: 'custom' }).sort({ sortOrder: 1, createdAt: 1 })
  ]);
  return { leftAds, rightAds, topAds, bottomAds, customAds };
}

// --- Multer: bellek (dosyalar MongoDB GridFS'e yazılır, disk üzerinde kaybolmaz) ---
const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

const adUpload = multer({
  storage: memoryStorage,
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.jpeg', '.jpg', '.png', '.gif', '.webp', '.mp4'];
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    const isAllowedImage = mime.startsWith('image/');
    const isAllowedVideo = mime === 'video/mp4';
    cb(null, allowedExt.includes(ext) && (isAllowedImage || isAllowedVideo));
  },
  limits: { fileSize: 30 * 1024 * 1024 }
});

async function uploadFilesToGridFs(files) {
  const urls = [];
  for (const f of files) {
    if (!f || !f.buffer) continue;
    const { url } = await gridfs.uploadBuffer(f.buffer, f.originalname, f.mimetype);
    urls.push(url);
  }
  return urls;
}

// --- MongoDB connection ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB bağlantısı başarılı');
    seedDefaultSources();
    backfillNewsSlugs();
  })
  .catch(err => console.error('MongoDB bağlantı hatası:', err));

async function backfillNewsSlugs() {
  try {
    const legacyNews = await News.find({ $or: [{ slug: { $exists: false } }, { slug: '' }] });
    if (!legacyNews.length) return;

    for (const item of legacyNews) {
      await item.save();
    }
    console.log(`${legacyNews.length} haber için slug üretildi.`);
  } catch (err) {
    console.error('Slug backfill hatası:', err.message);
  }
}

async function seedDefaultSources() {
  try {
    const count = await Source.countDocuments();
    if (count === 0) {
      console.log('Varsayılan haber kaynakları ekleniyor...');
      const defaults = [
      {
        name: 'Çerkezköy Bakış',
        url: 'https://www.cerkezkoybakis.com',
        baseUrl: 'https://www.cerkezkoybakis.com',
        category: 'Gündem',
        selectors: {
          articleList: '.post-listing .post-box-title a, .all-posts-widget .post-box-title a',
          title: 'a',
          description: '',
          image: 'img',
          link: 'a',
          category: '.post-cat-wrap a'
        },
        active: true
      },
      {
        name: 'Ergene Haber',
        url: 'https://www.ergenehaber.com',
        baseUrl: 'https://www.ergenehaber.com',
        category: 'Gündem',
        selectors: {
          articleList: 'article.post, .post-item, .listing-item',
          title: 'h2 a, .post-title a, .title a',
          description: '.post-excerpt p, .excerpt, .post-summary',
          image: 'img',
          link: 'h2 a, .post-title a, .title a',
          category: '.post-cat-wrap a, .category a, .term-badge a'
        },
        active: true
      },
      {
        name: 'Devrim Gazetesi',
        url: 'https://www.devrimgazetesi.com.tr',
        baseUrl: 'https://www.devrimgazetesi.com.tr',
        category: 'Gündem',
        selectors: {
          articleList: '.td_module_10, .td-module-thumb, .td_module_6',
          title: 'h3 a, .entry-title a',
          description: '.td-excerpt, .td-post-text-excerpt',
          image: 'img',
          link: 'h3 a, .entry-title a',
          category: '.td-post-category'
        },
        active: true
      },
      {
        name: 'Avrupayakası - Tekirdağ',
        url: 'https://avrupayakasi.com.tr/tekirdag.html',
        baseUrl: 'https://avrupayakasi.com.tr',
        category: 'Gündem',
        selectors: {
          articleList: 'div.topic',
          title: 'h4',
          description: 'p',
          image: '',
          link: 'a[href*=".html"]',
          category: ''
        },
        active: true
      },
      {
        name: 'Avrupayakası - Çorlu Güncel',
        url: 'https://avrupayakasi.com.tr/corlu-guncel.html',
        baseUrl: 'https://avrupayakasi.com.tr',
        category: 'Gündem',
        selectors: {
          articleList: 'div.topic',
          title: 'h4',
          description: 'p',
          image: '',
          link: 'a[href*=".html"]',
          category: ''
        },
        active: true
      }
    ];
      await Source.insertMany(defaults);
      console.log('5 varsayılan kaynak eklendi.');
    }
    await ensureAvrupayakasiSources();
  } catch (err) {
    console.error('Kaynak seed hatası:', err.message);
  }
}

async function ensureAvrupayakasiSources() {
  try {
    const sources = [
      { url: 'https://avrupayakasi.com.tr/tekirdag.html', name: 'Avrupayakası - Tekirdağ' },
      { url: 'https://avrupayakasi.com.tr/corlu-guncel.html', name: 'Avrupayakası - Çorlu Güncel' }
    ];
    const selectors = {
      articleList: 'div.topic',
      title: 'h4',
      description: 'p',
      image: '',
      link: 'a[href*=".html"]',
      category: ''
    };
    const baseUrl = 'https://avrupayakasi.com.tr';
    const category = 'Gündem';
    for (const { url, name } of sources) {
      const existing = await Source.findOne({ url });
      if (existing) {
        await Source.updateOne({ url }, { $set: { selectors, baseUrl, category, name } });
        continue;
      }
      await Source.create({ name, url, baseUrl, category, selectors, active: true });
      console.log('Haber çekiciye eklendi: ' + name);
    }
  } catch (err) {
    console.error('Avrupayakası kaynak ekleme:', err.message);
  }
}

// ==========================================
//  PAGE ROUTES
// ==========================================

// Ana sayfa
app.get('/', async (req, res) => {
  try {
    const empty = { heroNews: [], sonDakika: [], gundem: [], ekonomi: [], spor: [], siyaset: [], yasam: [],
      sonDakikaCount: 0, gundemCount: 0, ekonomiCount: 0, sporCount: 0, siyasetCount: 0, yasamCount: 0, leftAds: [], rightAds: [], topAds: [], bottomAds: [], customAds: [] };

    if (mongoose.connection.readyState !== 1) {
      return res.render('index', empty);
    }

    const heroNews = await News.find({ placement: { $in: ['hero', 'both'] } }).sort({ createdAt: -1 }).limit(10);
    const sonDakika = await News.find({ ...categoryFilter('Son Dakika'), placement: { $in: ['homepage', 'both'] } }).sort({ createdAt: -1 }).limit(4);
    const gundem = await News.find({ ...categoryFilter('Gündem'), placement: { $in: ['homepage', 'both'] } }).sort({ createdAt: -1 }).limit(4);
    const ekonomi = await News.find({ ...categoryFilter('Ekonomi'), placement: { $in: ['homepage', 'both'] } }).sort({ createdAt: -1 }).limit(4);
    const spor = await News.find({ ...categoryFilter('Spor'), placement: { $in: ['homepage', 'both'] } }).sort({ createdAt: -1 }).limit(4);
    const siyaset = await News.find({ ...categoryFilter('Siyaset'), placement: { $in: ['homepage', 'both'] } }).sort({ createdAt: -1 }).limit(4);
    const yasam = await News.find({ ...categoryFilter('Yaşam'), placement: { $in: ['homepage', 'both'] } }).sort({ createdAt: -1 }).limit(4);

    const sonDakikaCount = await News.countDocuments(categoryFilter('Son Dakika'));
    const gundemCount = await News.countDocuments(categoryFilter('Gündem'));
    const ekonomiCount = await News.countDocuments(categoryFilter('Ekonomi'));
    const sporCount = await News.countDocuments(categoryFilter('Spor'));
    const siyasetCount = await News.countDocuments(categoryFilter('Siyaset'));
    const yasamCount = await News.countDocuments(categoryFilter('Yaşam'));
    const { leftAds, rightAds, topAds, bottomAds, customAds } = await getSideAds('home');

    res.render('index', {
      heroNews, sonDakika, gundem, ekonomi, spor, siyaset, yasam,
      sonDakikaCount, gundemCount, ekonomiCount, sporCount, siyasetCount, yasamCount,
      leftAds, rightAds, topAds, bottomAds, customAds
    });
  } catch (err) {
    console.error('Ana sayfa hatası:', err.message);
    const empty = { heroNews: [], sonDakika: [], gundem: [], ekonomi: [], spor: [], siyaset: [], yasam: [],
      sonDakikaCount: 0, gundemCount: 0, ekonomiCount: 0, sporCount: 0, siyasetCount: 0, yasamCount: 0, leftAds: [], rightAds: [], topAds: [], bottomAds: [], customAds: [] };
    res.render('index', empty);
  }
});

// Künye sayfası
app.get('/kunye', async (req, res) => {
  try {
    const { leftAds, rightAds, topAds, bottomAds, customAds } = await getSideAds('kunye');
    const kunye = await getKunyeSettings();
    res.render('kunye', { leftAds, rightAds, topAds, bottomAds, customAds, kunye });
  } catch (err) {
    console.error(err);
    res.render('kunye', { leftAds: [], rightAds: [], topAds: [], bottomAds: [], customAds: [], kunye: defaultKunye });
  }
});

// Hakkında sayfası
app.get('/hakkinda', async (req, res) => {
  try {
    const { leftAds, rightAds, topAds, bottomAds, customAds } = await getSideAds('all');
    const about = await getAboutSettings();
    res.render('about', { leftAds, rightAds, topAds, bottomAds, customAds, about });
  } catch (err) {
    console.error(err);
    res.render('about', { leftAds: [], rightAds: [], topAds: [], bottomAds: [], customAds: [], about: defaultAbout });
  }
});

// Telif hakkı sayfası
app.get('/telif-hakki', async (req, res) => {
  try {
    const { leftAds, rightAds, topAds, bottomAds, customAds } = await getSideAds('all');
    const about = await getAboutSettings();
    res.render('copyright', { leftAds, rightAds, topAds, bottomAds, customAds, copyrightText: about.copyrightText || defaultAbout.copyrightText });
  } catch (err) {
    console.error(err);
    res.render('copyright', { leftAds: [], rightAds: [], topAds: [], bottomAds: [], customAds: [], copyrightText: defaultAbout.copyrightText });
  }
});

// Kategori sayfası
app.get('/kategori/:slug', async (req, res) => {
  try {
    const slugMap = {
      'son-dakika': 'Son Dakika',
      'gundem': 'Gündem',
      'ekonomi': 'Ekonomi',
      'spor': 'Spor',
      'siyaset': 'Siyaset',
      'yasam': 'Yaşam',
      'saglik': 'Sağlık'
    };
    const category = slugMap[req.params.slug];
    if (!category) return res.status(404).send('Kategori bulunamadı');

    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;

    const categoryQuery = categoryFilter(category);
    const total = await News.countDocuments(categoryQuery);
    const news = await News.find(categoryQuery).sort({ createdAt: -1 }).skip(skip).limit(limit);
    const totalPages = Math.ceil(total / limit);
    const { leftAds, rightAds, topAds, bottomAds, customAds } = await getSideAds('category');

    res.render('category', { news, category, slug: req.params.slug, page, totalPages, total, leftAds, rightAds, topAds, bottomAds, customAds });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// Haber detay sayfası
app.get('/haber/:slugOrId', async (req, res) => {
  try {
    const key = req.params.slugOrId;
    let news = await News.findOneAndUpdate({ slug: key }, { $inc: { viewCount: 1 } }, { new: true });
    if (!news && mongoose.Types.ObjectId.isValid(key)) {
      news = await News.findByIdAndUpdate(key, { $inc: { viewCount: 1 } }, { new: true });
      if (news && news.slug) {
        return res.redirect(301, '/haber/' + news.slug);
      }
    }
    if (!news) return res.status(404).send('Haber bulunamadı');

    // Aynı kategoriden diğer haberler (mevcut haber hariç)
    const primaryCategory = (news.categories && news.categories.length > 0) ? news.categories[0] : news.category;
    const related = await News.find({ ...categoryFilter(primaryCategory), _id: { $ne: news._id } })
      .sort({ createdAt: -1 }).limit(4);

    // Önceki ve sonraki haber
    const prev = await News.findOne({ createdAt: { $lt: news.createdAt } }).sort({ createdAt: -1 });
    const next = await News.findOne({ createdAt: { $gt: news.createdAt } }).sort({ createdAt: 1 });
    const { leftAds, rightAds, topAds, bottomAds, customAds } = await getSideAds('detail');

    res.render('detail', { news, related, prev, next, leftAds, rightAds, topAds, bottomAds, customAds });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// Admin login sayfası
app.get('/' + ADMIN_PATH + '/giris', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/' + ADMIN_PATH);
  res.render('login', { error: req.query.error || '', adminPath: ADMIN_PATH });
});

app.post('/' + ADMIN_PATH + '/giris', (req, res) => {
  if (req.body.password === ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.redirect('/' + ADMIN_PATH);
  }
  res.redirect('/' + ADMIN_PATH + '/giris?error=1');
});

app.get('/' + ADMIN_PATH + '/cikis', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Admin paneli (korumalı)
app.get('/' + ADMIN_PATH, requireAuth, async (req, res) => {
  try {
    const category = req.query.category || '';
    const filter = category ? { category } : {};
    const news = await News.find(filter).sort({ createdAt: -1 });
    const editId = req.query.edit || null;
    let editNews = null;
    if (editId) {
      editNews = await News.findById(editId);
    }
    res.render('admin', { news, editNews, category, categories: ['Son Dakika', 'Gündem', 'Ekonomi', 'Spor', 'Siyaset', 'Yaşam', 'Sağlık'], adminPath: ADMIN_PATH });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// Künye yönetim sayfası (korumalı)
app.get('/' + ADMIN_PATH + '/kunye', requireAuth, async (req, res) => {
  try {
    const kunye = await getKunyeSettings();
    res.render('kunye-admin', { kunye, adminPath: ADMIN_PATH });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// Hakkında yönetim sayfası (korumalı)
app.get('/' + ADMIN_PATH + '/hakkinda', requireAuth, async (req, res) => {
  try {
    const about = await getAboutSettings();
    res.render('about-admin', { about, adminPath: ADMIN_PATH });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

function buildGroupedAds(ads) {
  const groupMap = new Map();
  for (const ad of ads) {
    const key = getAdGroupKey(ad.name);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(ad);
  }
  const groupedAds = [];
  for (const ad of ads) {
    const key = getAdGroupKey(ad.name);
    if (!groupMap.has(key)) continue;
    const items = groupMap.get(key);
    groupMap.delete(key);
    groupedAds.push({ groupName: key, items });
  }
  return groupedAds;
}

function getAdsPanelPath(panelModeRaw) {
  const panelMode = String(panelModeRaw || '').toLowerCase();
  if (panelMode === 'mobile') return '/' + ADMIN_PATH + '/ads-mobile';
  if (panelMode === 'common') return '/' + ADMIN_PATH + '/ads-common';
  return '/' + ADMIN_PATH + '/ads';
}

// Reklam yönetim — sadece PC / masaüstü hedefli reklamlar (+ eski "both" kayıtları)
app.get('/' + ADMIN_PATH + '/ads', requireAuth, async (req, res) => {
  try {
    const ads = await Ad.find({ deviceTarget: { $in: ['desktop', 'both'] } }).sort({ createdAt: -1 });
    const groupedAds = buildGroupedAds(ads);
    const editId = req.query.edit || null;
    let editAd = null;
    if (editId) {
      editAd = await Ad.findById(editId);
      if (editAd && editAd.deviceTarget === 'mobile') {
        return res.redirect('/' + ADMIN_PATH + '/ads-mobile?edit=' + editId);
      }
    }
    res.render('ads', { ads, groupedAds, editAd, adminPath: ADMIN_PATH, panelDevice: 'desktop' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// Reklam yönetim — sadece mobil hedefli reklamlar (+ eski "both" kayıtları)
app.get('/' + ADMIN_PATH + '/ads-mobile', requireAuth, async (req, res) => {
  try {
    const ads = await Ad.find({ deviceTarget: { $in: ['mobile', 'both'] } }).sort({ createdAt: -1 });
    const groupedAds = buildGroupedAds(ads);
    const editId = req.query.edit || null;
    let editAd = null;
    if (editId) {
      editAd = await Ad.findById(editId);
      if (editAd && editAd.deviceTarget === 'desktop') {
        return res.redirect('/' + ADMIN_PATH + '/ads?edit=' + editId);
      }
    }
    res.render('ads', { ads, groupedAds, editAd, adminPath: ADMIN_PATH, panelDevice: 'mobile' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// Reklam yönetim — sadece ortak (PC + Mobil) hedefli reklamlar
app.get('/' + ADMIN_PATH + '/ads-common', requireAuth, async (req, res) => {
  try {
    const ads = await Ad.find({ deviceTarget: 'both' }).sort({ createdAt: -1 });
    const groupedAds = buildGroupedAds(ads);
    const editId = req.query.edit || null;
    let editAd = null;
    if (editId) {
      editAd = await Ad.findById(editId);
      if (editAd && editAd.deviceTarget === 'desktop') {
        return res.redirect('/' + ADMIN_PATH + '/ads?edit=' + editId);
      }
      if (editAd && editAd.deviceTarget === 'mobile') {
        return res.redirect('/' + ADMIN_PATH + '/ads-mobile?edit=' + editId);
      }
    }
    res.render('ads', { ads, groupedAds, editAd, adminPath: ADMIN_PATH, panelDevice: 'common' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// ==========================================
//  API ROUTES
// ==========================================

// Create news (korumalı)
app.post('/api/news', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const selectedCategories = parseSelectedCategories(getSubmittedCategories(req.body));
    let imageUrl = req.body.existingImage || '';
    if (req.file && req.file.buffer) {
      const { url } = await gridfs.uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
      imageUrl = url;
    }
    const data = {
      title: req.body.title,
      description: req.body.description,
      content: req.body.content || '',
      category: selectedCategories[0],
      categories: selectedCategories,
      featured: req.body.placement === 'hero' || req.body.placement === 'both',
      placement: req.body.placement || 'none',
      image: imageUrl
    };
    await News.create(data);
    res.redirect('/' + ADMIN_PATH);
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '?error=1');
  }
});

// Upload inline images for news content (korumalı)
app.post('/api/news/upload-inline-image', requireAuth, upload.array('images', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: 'Görsel bulunamadı' });
    }
    const urls = await uploadFilesToGridFs(files);
    return res.json({ urls });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Görsel yükleme hatası' });
  }
});

// Delete ALL news (korumalı) - must be before /:id routes
app.post('/api/news/delete-all', requireAuth, async (req, res) => {
  try {
    const all = await News.find({}).select('image content');
    for (const n of all) {
      if (gridfs.isGridFsUrl(n.image)) await gridfs.deleteByUrl(n.image);
      await gridfs.deleteGridFsUrlsInHtml(n.content);
    }
    await News.deleteMany({});
    res.redirect('/' + ADMIN_PATH);
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '?error=1');
  }
});

// Update news (korumalı)
app.post('/api/news/:id', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const selectedCategories = parseSelectedCategories(getSubmittedCategories(req.body));
    const existing = await News.findById(req.params.id);
    const data = {
      title: req.body.title,
      description: req.body.description,
      content: req.body.content || '',
      category: selectedCategories[0],
      categories: selectedCategories,
      featured: req.body.placement === 'hero' || req.body.placement === 'both',
      placement: req.body.placement || 'none'
    };
    if (req.file && req.file.buffer) {
      if (existing && gridfs.isGridFsUrl(existing.image)) await gridfs.deleteByUrl(existing.image);
      const { url } = await gridfs.uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
      data.image = url;
    }
    await News.findByIdAndUpdate(req.params.id, data);
    res.redirect('/' + ADMIN_PATH);
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '?error=1');
  }
});

// Delete news (korumalı)
app.post('/api/news/:id/delete', requireAuth, async (req, res) => {
  try {
    const n = await News.findById(req.params.id);
    if (n) {
      if (gridfs.isGridFsUrl(n.image)) await gridfs.deleteByUrl(n.image);
      await gridfs.deleteGridFsUrlsInHtml(n.content);
    }
    await News.findByIdAndDelete(req.params.id);
    res.redirect('/' + ADMIN_PATH);
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '?error=1');
  }
});

// Update künye settings (korumalı)
app.post('/api/kunye', requireAuth, async (req, res) => {
  try {
    await KunyaSettings.findOneAndUpdate(
      { singletonKey: 'main' },
      {
        singletonKey: 'main',
        publisher: req.body.publisher || defaultKunye.publisher,
        tradeName: req.body.tradeName || defaultKunye.tradeName,
        establishmentDate: req.body.establishmentDate || defaultKunye.establishmentDate,
        legalRepresentative: req.body.legalRepresentative || defaultKunye.legalRepresentative,
        editorInChief: req.body.editorInChief || defaultKunye.editorInChief,
        managementAddress: req.body.managementAddress || defaultKunye.managementAddress,
        reporters: parseReporters(req.body.reporters),
        hostingProvider: req.body.hostingProvider || defaultKunye.hostingProvider,
        hostingTradeName: req.body.hostingTradeName || defaultKunye.hostingTradeName,
        hostingAddress: req.body.hostingAddress || defaultKunye.hostingAddress,
        corporateEmail: req.body.corporateEmail || defaultKunye.corporateEmail,
        contactPhone: req.body.contactPhone || defaultKunye.contactPhone
      },
      { upsert: true, new: true }
    );

    res.redirect('/' + ADMIN_PATH + '/kunye');
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '/kunye?error=1');
  }
});

// Save about settings (korumalı)
app.post('/api/hakkinda', requireAuth, async (req, res) => {
  try {
    await AboutSettings.findOneAndUpdate(
      { singletonKey: 'main' },
      {
        singletonKey: 'main',
        aboutText: (req.body.aboutText || '').trim() || defaultAbout.aboutText,
        copyrightText: (req.body.copyrightText || '').trim() || defaultAbout.copyrightText
      },
      { upsert: true, new: true }
    );

    res.redirect('/' + ADMIN_PATH + '/hakkinda');
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '/hakkinda?error=1');
  }
});

// Create ad(s) (korumalı)
app.post('/api/ads', requireAuth, adUpload.array('media', 30), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.redirect(getAdsPanelPath(req.body?.adPanelMode) + '?error=1');
    }
    const baseName = sanitizeAdBaseName(req.body.name);
    const allowedPositions = ['left', 'right', 'top', 'bottom', 'between', 'custom'];
    const allowedPageTargets = ['all', 'home', 'category', 'detail', 'kunye'];

    let deviceChoice = ['both', 'desktop', 'mobile'].includes(req.body.deviceTarget)
      ? req.body.deviceTarget
      : 'both';
    // Ayrı PC / Mobil paneller: hangi panelden kayıt açıldıysa sadece o cihaza yayınla.
    const panelMode = String(req.body.adPanelMode || '').toLowerCase();
    if (panelMode === 'desktop') deviceChoice = 'desktop';
    if (panelMode === 'mobile') deviceChoice = 'mobile';
    if (panelMode === 'common') deviceChoice = 'both';

    // deviceTarget bazında ayrı seçilen konum/sayfa listeleri.
    // Eski form isimleri varsa geriye dönük destek için fallback ekliyoruz.
    const positionsDesktopRaw = toArray(
      req.body['positionsDesktop[]'] || req.body.positionsDesktop || req.body['positions[]'] || req.body.positions || req.body.position
    );
    const pageTargetsDesktopRaw = toArray(
      req.body['pageTargetsDesktop[]'] || req.body.pageTargetsDesktop || req.body['pageTargets[]'] || req.body.pageTargets || req.body.pageTarget
    );
    const positionsMobileRaw = toArray(
      req.body['positionsMobile[]'] || req.body.positionsMobile || req.body['positions[]'] || req.body.positions || req.body.position
    );
    const pageTargetsMobileRaw = toArray(
      req.body['pageTargetsMobile[]'] || req.body.pageTargetsMobile || req.body['pageTargets[]'] || req.body.pageTargets || req.body.pageTarget
    );

    const desktopPositions = positionsDesktopRaw.filter(p => allowedPositions.includes(p));
    const mobilePositions = positionsMobileRaw.filter(p => allowedPositions.includes(p));
    const finalDesktopPositions = desktopPositions.length ? desktopPositions : ['left'];
    // Mobilde yalnızca üst alan kullanılır (yan / alt / özel sitede gösterilmez).
    let finalMobilePositions = mobilePositions.length ? mobilePositions : ['top'];
    finalMobilePositions = finalMobilePositions.filter(p => p === 'top');
    if (!finalMobilePositions.length) finalMobilePositions = ['top'];

    const desktopPageTargets = pageTargetsDesktopRaw.filter(p => allowedPageTargets.includes(p));
    const mobilePageTargets = pageTargetsMobileRaw.filter(p => allowedPageTargets.includes(p));

    let finalDesktopPageTargets = desktopPageTargets.length ? desktopPageTargets : ['all'];
    let finalMobilePageTargets = mobilePageTargets.length ? mobilePageTargets : ['all'];
    if (finalDesktopPageTargets.includes('all')) finalDesktopPageTargets = ['all'];
    if (finalMobilePageTargets.includes('all')) finalMobilePageTargets = ['all'];
    const width = normalizeAdSize(req.body.width, 350, 80, 3000);
    const height = normalizeAdSize(req.body.height, 250, 80, 3000);
    const mobileWidth = normalizeAdSize(req.body.mobileWidth, 320, 80, 1200);
    const mobileHeight = normalizeAdSize(req.body.mobileHeight, 250, 80, 1600);
    const startDate = parseAdDate(req.body.startDate, false);
    const endDate = parseAdDate(req.body.endDate, true);
    const customStyles = req.body.customStyles || '';
    const customTop = normalizeInt(req.body.customTop, 180, 0, 5000);
    const customLeft = normalizeInt(req.body.customLeft, 12, 0, 5000);
    const customZIndex = normalizeInt(req.body.customZIndex, 60, 1, 9999);
    const rotateSeconds = normalizeInt(req.body.rotateSeconds, 7, 1, 120);
    const active = req.body.active === 'on';
    const orientation = ['vertical', 'horizontal', 'tilt-right', 'tilt-left'].includes(req.body.orientation)
      ? req.body.orientation
      : 'vertical';
    const docs = [];
    const deviceTasks = [];
    if (deviceChoice === 'desktop' || deviceChoice === 'both') {
      deviceTasks.push({
        deviceTarget: 'desktop',
        positions: finalDesktopPositions,
        pageTargets: finalDesktopPageTargets
      });
    }
    if (deviceChoice === 'mobile' || deviceChoice === 'both') {
      deviceTasks.push({
        deviceTarget: 'mobile',
        positions: finalMobilePositions,
        pageTargets: finalMobilePageTargets
      });
    }

    const mediaUrls = await uploadFilesToGridFs(files);

    for (const task of deviceTasks) {
      for (const position of task.positions) {
        for (const pageTarget of task.pageTargets) {
          const lastAd = await Ad.findOne({ position, pageTarget, deviceTarget: task.deviceTarget })
            .sort({ sortOrder: -1, createdAt: -1 })
            .select('sortOrder');
          const startSortOrder = normalizeInt(lastAd?.sortOrder, 0, 0, Number.MAX_SAFE_INTEGER) + 1;

          for (let idx = 0; idx < files.length; idx += 1) {
            const file = files[idx];
            const mime = String(file.mimetype || '').toLowerCase();
            const isVideo = mime === 'video/mp4';
            const mediaPath = mediaUrls[idx];
            docs.push({
              name: buildAdSequenceName(baseName, idx, files.length),
              media: mediaPath,
              mediaType: isVideo ? 'video' : 'image',
              link: req.body.link || '#',
              position,
              pageTarget,
              deviceTarget: task.deviceTarget,
              orientation,
              width,
              height,
              mobileWidth,
              mobileHeight,
              startDate,
              endDate,
              customStyles,
              customTop,
              customLeft,
              customZIndex,
              rotateSeconds,
              sortOrder: startSortOrder + idx,
              active
            });
          }
        }
      }
    }

    await Ad.insertMany(docs);

    res.redirect(getAdsPanelPath(panelMode));
  } catch (err) {
    console.error(err);
    res.redirect(getAdsPanelPath(req.body?.adPanelMode) + '?error=1');
  }
});

// Update ad (korumalı)
app.post('/api/ads/:id', requireAuth, adUpload.array('media', 30), async (req, res) => {
  try {
    const files = req.files || [];
    const currentAd = await Ad.findById(req.params.id);
    const panelMode = String(req.body.adPanelMode || '').toLowerCase();
    const adsRedirect = getAdsPanelPath(panelMode);
    if (!currentAd) return res.redirect(adsRedirect + '?error=1');
    const baseName = sanitizeAdBaseName(req.body.name);

    const allowedPositions = ['left', 'right', 'top', 'bottom', 'between', 'custom'];
    const allowedPageTargets = ['all', 'home', 'category', 'detail', 'kunye'];
    const positionsDesktopRaw = toArray(
      req.body['positionsDesktop[]'] || req.body.positionsDesktop || req.body['positions[]'] || req.body.positions || req.body.position
    );
    const pageTargetsDesktopRaw = toArray(
      req.body['pageTargetsDesktop[]'] || req.body.pageTargetsDesktop || req.body['pageTargets[]'] || req.body.pageTargets || req.body.pageTarget
    );
    const positionsMobileRaw = toArray(
      req.body['positionsMobile[]'] || req.body.positionsMobile || req.body['positions[]'] || req.body.positions || req.body.position
    );
    const pageTargetsMobileRaw = toArray(
      req.body['pageTargetsMobile[]'] || req.body.pageTargetsMobile || req.body['pageTargets[]'] || req.body.pageTargets || req.body.pageTarget
    );

    const desiredDevice = ['both', 'desktop', 'mobile'].includes(req.body.deviceTarget)
      ? req.body.deviceTarget
      : (currentAd.deviceTarget || 'both');

    // "both" güncelleme sırasında tek kaydı temsil edemediği için:
    // - desiredDevice = mobile ise mobil seçimlerini uygula
    // - desiredDevice = desktop ise pc seçimlerini uygula
    // - desiredDevice = both ise mevcut kaydın deviceTarget'ına göre uygula
    let targetDeviceForPosition = 'desktop';
    if (desiredDevice === 'mobile') targetDeviceForPosition = 'mobile';
    if (desiredDevice === 'desktop') targetDeviceForPosition = 'desktop';
    if (desiredDevice === 'both') {
      targetDeviceForPosition = currentAd.deviceTarget === 'mobile' ? 'mobile' : 'desktop';
    }

    const selectedPositionsRaw = targetDeviceForPosition === 'mobile' ? positionsMobileRaw : positionsDesktopRaw;
    const selectedPageTargetsRaw = targetDeviceForPosition === 'mobile' ? pageTargetsMobileRaw : pageTargetsDesktopRaw;

    const selectedPositions = selectedPositionsRaw.filter(p => allowedPositions.includes(p));
    const selectedPageTargets = selectedPageTargetsRaw.filter(p => allowedPageTargets.includes(p));

    let nextPosition = selectedPositions[0] || currentAd.position || 'left';
    if (targetDeviceForPosition === 'mobile') {
      nextPosition = 'top';
    }
    let nextPageTarget = selectedPageTargets[0] || currentAd.pageTarget || 'all';
    if (selectedPageTargets.includes('all') || selectedPageTargetsRaw.includes('all')) nextPageTarget = 'all';

    const data = {
      name: req.body.name,
      link: req.body.link || '#',
      position: nextPosition,
      pageTarget: nextPageTarget,
      // Tek kaydı güncellediğimiz için 'both' seçimi yerine mevcut kaydın cihazına göre güncelliyoruz.
      deviceTarget: ['desktop', 'mobile'].includes(req.body.deviceTarget)
        ? req.body.deviceTarget
        : (currentAd.deviceTarget === 'mobile' ? 'mobile' : 'desktop'),
      orientation: ['vertical', 'horizontal', 'tilt-right', 'tilt-left'].includes(req.body.orientation)
        ? req.body.orientation
        : (currentAd.orientation || 'vertical'),
      width: normalizeAdSize(req.body.width, 350, 80, 3000),
      height: normalizeAdSize(req.body.height, 250, 80, 3000),
      mobileWidth: normalizeAdSize(req.body.mobileWidth, 320, 80, 1200),
      mobileHeight: normalizeAdSize(req.body.mobileHeight, 250, 80, 1600),
      startDate: parseAdDate(req.body.startDate, false),
      endDate: parseAdDate(req.body.endDate, true),
      customStyles: req.body.customStyles || '',
      customTop: normalizeInt(req.body.customTop, 180, 0, 5000),
      customLeft: normalizeInt(req.body.customLeft, 12, 0, 5000),
      customZIndex: normalizeInt(req.body.customZIndex, 60, 1, 9999),
      rotateSeconds: normalizeInt(req.body.rotateSeconds, 7, 1, 120),
      active: req.body.active === 'on'
    };

    let mediaUrlsUpdate = null;
    if (files.length > 0) {
      mediaUrlsUpdate = await uploadFilesToGridFs(files);
      if (gridfs.isGridFsUrl(currentAd.media)) await gridfs.deleteByUrl(currentAd.media);
      const file = files[0];
      const mime = String(file.mimetype || '').toLowerCase();
      const isVideo = mime === 'video/mp4';
      data.media = mediaUrlsUpdate[0];
      data.mediaType = isVideo ? 'video' : 'image';
    } else if (req.body.existingMedia) {
      data.media = req.body.existingMedia;
      data.mediaType = req.body.existingMediaType || 'video';
    }

    await Ad.findByIdAndUpdate(req.params.id, data);

    if (files.length > 1 && mediaUrlsUpdate) {
      const extraFiles = files.slice(1);
      const startSortOrder = normalizeInt(currentAd.sortOrder, 0, 0, Number.MAX_SAFE_INTEGER) + 1;
      const extraDocs = [];
      for (let idx = 0; idx < extraFiles.length; idx += 1) {
        const file = extraFiles[idx];
        const mime = String(file.mimetype || '').toLowerCase();
        const isVideo = mime === 'video/mp4';
        const mediaPath = mediaUrlsUpdate[idx + 1];
        extraDocs.push({
          name: buildAdSequenceName(baseName, idx + 1, files.length),
          media: mediaPath,
          mediaType: isVideo ? 'video' : 'image',
          link: data.link,
          position: data.position,
          pageTarget: data.pageTarget,
          deviceTarget: data.deviceTarget,
          orientation: data.orientation || 'vertical',
          width: data.width,
          height: data.height,
          mobileWidth: data.mobileWidth,
          mobileHeight: data.mobileHeight,
          startDate: data.startDate,
          endDate: data.endDate,
          customStyles: data.customStyles,
          customTop: data.customTop,
          customLeft: data.customLeft,
          customZIndex: data.customZIndex,
          rotateSeconds: data.rotateSeconds,
          sortOrder: startSortOrder + idx,
          active: data.active
        });
      }
      await Ad.insertMany(extraDocs);
    }

    res.redirect(adsRedirect);
  } catch (err) {
    console.error(err);
    res.redirect(getAdsPanelPath(req.body?.adPanelMode) + '?error=1');
  }
});

// Toggle ad active/inactive (korumalı)
app.post('/api/ads/:id/toggle', requireAuth, async (req, res) => {
  try {
    const panelMode = String(req.body.adPanelMode || '').toLowerCase();
    const adsRedirect = getAdsPanelPath(panelMode);
    const ad = await Ad.findById(req.params.id);
    if (ad) {
      ad.active = !ad.active;
      await ad.save();
    }
    res.redirect(adsRedirect);
  } catch (err) {
    console.error(err);
    res.redirect(getAdsPanelPath(req.body?.adPanelMode) + '?error=1');
  }
});

// Delete ad (korumalı)
app.post('/api/ads/:id/delete', requireAuth, async (req, res) => {
  try {
    const panelMode = String(req.body.adPanelMode || '').toLowerCase();
    const adsRedirect = getAdsPanelPath(panelMode);
    const ad = await Ad.findById(req.params.id);
    if (ad && gridfs.isGridFsUrl(ad.media)) await gridfs.deleteByUrl(ad.media);
    await Ad.findByIdAndDelete(req.params.id);
    res.redirect(adsRedirect);
  } catch (err) {
    console.error(err);
    res.redirect(getAdsPanelPath(req.body?.adPanelMode) + '?error=1');
  }
});

// ==========================================
//  SCRAPER ROUTES
// ==========================================

// Scraper admin page
app.get('/' + ADMIN_PATH + '/scraper', requireAuth, async (req, res) => {
  try {
    const sources = await Source.find().sort({ createdAt: -1 });
    const editId = req.query.edit || null;
    let editSource = null;
    if (editId) {
      editSource = await Source.findById(editId);
    }
    res.render('scraper', {
      sources,
      editSource,
      categories: ['Son Dakika', 'Gündem', 'Ekonomi', 'Spor', 'Siyaset', 'Yaşam', 'Sağlık'],
      adminPath: ADMIN_PATH
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Sunucu hatası');
  }
});

// Create source
app.post('/api/sources', requireAuth, async (req, res) => {
  try {
    await Source.create({
      name: req.body.name,
      url: req.body.url,
      baseUrl: req.body.baseUrl || '',
      category: req.body.category,
      selectors: {
        articleList: req.body.articleList,
        title: req.body.title,
        description: req.body.description || '',
        image: req.body.image || '',
        link: req.body.link,
        category: req.body.categorySelector || ''
      }
    });
    res.redirect('/' + ADMIN_PATH + '/scraper');
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '/scraper?error=1');
  }
});

// Update source
app.post('/api/sources/:id', requireAuth, async (req, res) => {
  try {
    await Source.findByIdAndUpdate(req.params.id, {
      name: req.body.name,
      url: req.body.url,
      baseUrl: req.body.baseUrl || '',
      category: req.body.category,
      selectors: {
        articleList: req.body.articleList,
        title: req.body.title,
        description: req.body.description || '',
        image: req.body.image || '',
        link: req.body.link,
        category: req.body.categorySelector || ''
      }
    });
    res.redirect('/' + ADMIN_PATH + '/scraper');
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '/scraper?error=1');
  }
});

// Toggle source active/inactive
app.post('/api/sources/:id/toggle', requireAuth, async (req, res) => {
  try {
    const source = await Source.findById(req.params.id);
    if (source) {
      source.active = !source.active;
      await source.save();
    }
    res.redirect('/' + ADMIN_PATH + '/scraper');
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '/scraper?error=1');
  }
});

// Delete source
app.post('/api/sources/:id/delete', requireAuth, async (req, res) => {
  try {
    await Source.findByIdAndDelete(req.params.id);
    res.redirect('/' + ADMIN_PATH + '/scraper');
  } catch (err) {
    console.error(err);
    res.redirect('/' + ADMIN_PATH + '/scraper?error=1');
  }
});

// Scrape single source - preview only (AJAX)
app.post('/api/sources/:id/scrape', requireAuth, async (req, res) => {
  try {
    const result = await scrapeAndSave(req.params.id);
    res.json(result);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Scrape all active sources (AJAX)
app.post('/api/sources/scrape-all', requireAuth, async (req, res) => {
  try {
    const results = await scrapeAll();
    res.json({ results });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Save selected articles from a source (AJAX)
app.post('/api/sources/:id/save-selected', requireAuth, async (req, res) => {
  try {
    const source = await Source.findById(req.params.id);
    if (!source) return res.json({ error: 'Kaynak bulunamadı' });

    const articles = req.body.articles || [];
    let savedCount = 0;

    for (const article of articles) {
      const exists = await News.findOne({ title: article.title });
      if (exists) continue;

      await News.create({
        title: article.title,
        description: article.description || article.title,
        content: article.link ? `<p>Kaynak: <a href="${article.link}" target="_blank">${source.name}</a></p>` : '',
        category: article.category || 'Gündem',
        categories: [article.category || 'Gündem'],
        image: article.image || '',
        publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
        placement: 'none',
        featured: false
      });
      savedCount++;
    }

    await Source.findByIdAndUpdate(req.params.id, {
      lastScrapedAt: new Date(),
      lastScrapedCount: savedCount
    });

    res.json({ saved: savedCount, total: articles.length, source: source.name });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Preview source (AJAX)
app.get('/api/sources/:id/preview', requireAuth, async (req, res) => {
  try {
    const source = await Source.findById(req.params.id);
    if (!source) return res.json({ error: 'Kaynak bulunamadı' });
    const articles = await previewSource(source);
    res.json({ articles });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// JSON API - all news
app.get('/api/news', async (req, res) => {
  try {
    const category = req.query.category || '';
    const filter = category ? categoryFilter(category) : {};
    const news = await News.find(filter).sort({ createdAt: -1 });
    res.json(news);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
  console.log(`Admin paneli: http://localhost:${PORT}/${ADMIN_PATH}`);
});
