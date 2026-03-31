const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

const BUCKET_NAME = 'media';

function getBucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB bağlı değil');
  return new GridFSBucket(db, { bucketName: BUCKET_NAME });
}

function isGridFsUrl(url) {
  return typeof url === 'string' && /^\/api\/media\/[a-f0-9]{24}$/i.test(url.trim());
}

function idFromGridFsUrl(url) {
  return String(url || '').trim().split('/').pop();
}

/**
 * @returns {Promise<{ id: import('mongodb').ObjectId, url: string }>}
 */
function uploadBuffer(buffer, filename, contentType) {
  return new Promise((resolve, reject) => {
    const bucket = getBucket();
    const uploadStream = bucket.openUploadStream(filename || 'file', {
      contentType: contentType || 'application/octet-stream'
    });
    uploadStream.on('error', reject);
    uploadStream.on('finish', function onFinish() {
      const id = uploadStream.id;
      resolve({ id, url: `/api/media/${id.toString()}` });
    });
    uploadStream.end(buffer);
  });
}

async function deleteByUrl(url) {
  if (!isGridFsUrl(url)) return;
  try {
    await getBucket().delete(new ObjectId(idFromGridFsUrl(url)));
  } catch (_) {
    /* dosya yok */
  }
}

/**
 * Haber içeriğindeki tüm /api/media/... referanslarını siler.
 */
async function deleteGridFsUrlsInHtml(html) {
  if (!html || typeof html !== 'string') return;
  const matches = html.match(/\/api\/media\/[a-f0-9]{24}/gi) || [];
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m)) continue;
    seen.add(m);
    await deleteByUrl(m);
  }
}

function streamToResponse(req, res) {
  const idStr = req.params.id;
  if (!/^[a-f0-9]{24}$/i.test(idStr)) {
    res.status(404).end();
    return;
  }
  const _id = new ObjectId(idStr);
  const bucket = getBucket();
  bucket.find({ _id }).toArray().then((files) => {
    if (!files.length) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', files[0].contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    bucket.openDownloadStream(_id).on('error', () => res.status(404).end()).pipe(res);
  }).catch(() => res.status(404).end());
}

module.exports = {
  getBucket,
  uploadBuffer,
  deleteByUrl,
  isGridFsUrl,
  deleteGridFsUrlsInHtml,
  streamToResponse
};
