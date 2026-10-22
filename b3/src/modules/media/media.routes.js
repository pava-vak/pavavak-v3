const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { recordUpload, canAccessFile } = require('./mediaAccess');

// Lazy-load sharp — if the native binding isn't compiled for this platform, uploads still work raw
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const IMAGE_MAX_PX = 2048;     // longest edge
const IMAGE_WEBP_QUALITY = 85;
const IMAGE_SKIP_SMALL = 100_000; // skip compression for files already under 100 KB
const THUMB_MAX_PX = 400;

const UPLOADS_DIR = process.env.MEDIA_UPLOADS_DIR || path.join(process.cwd(), 'uploads');

try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (err) { console.error('Cannot create uploads dir:', err); }

const MIME_TO_EXT = {
  'image/jpeg':               '.jpg',
  'image/png':                '.png',
  'image/gif':                '.gif',
  'image/webp':               '.webp',
  'image/heic':               '.heic',
  'image/heif':               '.heif',
  'video/mp4':                '.mp4',
  'video/webm':               '.webm',
  'video/quicktime':          '.mov',
  'video/3gpp':               '.3gp',
  'audio/ogg':                '.ogg',
  'audio/webm':               '.weba',
  'audio/mp4':                '.m4a',
  'audio/mpeg':               '.mp3',
  'audio/wav':                '.wav',
  'application/pdf':          '.pdf',
  'application/msword':       '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain':               '.txt',
  'application/zip':          '.zip',
  'text/csv':                 '.csv',
};

const EXT_TO_MIME = {
  '.jpg':  'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.3gp':  'video/3gpp',
  '.ogg':  'audio/ogg',
  '.weba': 'audio/webm',
  '.m4a':  'audio/mp4',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt':  'text/plain',
  '.zip':  'application/zip',
  '.csv':  'text/csv',
};

// UUID v4 followed by an allowed extension — no path traversal possible
const FILE_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|gif|webp|heic|heif|mp4|webm|mov|3gp|ogg|weba|m4a|mp3|wav|pdf|doc|docx|xls|xlsx|txt|zip|csv)$/;

// Strip codec params from MIME type: "video/webm;codecs=vp9" → "video/webm"
function baseMime(mimeType) {
  return String(mimeType || '').split(';')[0].trim().toLowerCase();
}

function isVideo(mimeType) {
  return baseMime(mimeType).startsWith('video/');
}

function registerMediaRoutes(app) {
  // Binary parsers for video, audio, and documents. Fastify's built-in text/plain parser would
  // otherwise turn .txt/.csv uploads into a string, which upload-binary rejects.
  if (app.hasContentTypeParser('text/plain')) app.removeContentTypeParser('text/plain');
  for (const prefix of [/^video\//, /^audio\//, /^application\//, /^text\//]) {
    app.addContentTypeParser(prefix, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  }

  // POST /api/v3/media/upload
  // Images: JSON body { data: "<base64>", mimeType: "image/jpeg" } — max 6 MB
  app.post('/api/v3/media/upload', { preHandler: requireAuth }, async (request, reply) => {
    const { data, mimeType } = request.body || {};

    if (!data || typeof data !== 'string') {
      return reply.status(400).send({ success: false, error: 'Missing image data' });
    }
    const mime = baseMime(mimeType);
    if (!MIME_TO_EXT[mime] || isVideo(mime)) {
      return reply.status(400).send({ success: false, error: 'Unsupported image type' });
    }
    if (data.length > 6_300_000) {
      return reply.status(413).send({ success: false, error: 'Image too large (max ~4.5 MB)' });
    }

    let buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch {
      return reply.status(400).send({ success: false, error: 'Invalid base64 data' });
    }

    // Compress + convert to WebP (skip GIF and already-small files)
    let finalBuffer = buffer;
    let finalMime = mime;
    let finalExt = MIME_TO_EXT[mime];

    if (sharp && mime !== 'image/gif' && buffer.length > IMAGE_SKIP_SMALL) {
      try {
        finalBuffer = await sharp(buffer)
          .rotate() // apply EXIF orientation
          .resize(IMAGE_MAX_PX, IMAGE_MAX_PX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: IMAGE_WEBP_QUALITY })
          .toBuffer();
        finalMime = 'image/webp';
        finalExt  = '.webp';
      } catch (err) {
        request.log.warn({ err }, 'sharp compression failed, storing original');
        finalBuffer = buffer;
        finalExt = MIME_TO_EXT[mime];
      }
    }

    const fileId   = `${crypto.randomUUID()}${finalExt}`;
    const filePath = path.join(UPLOADS_DIR, fileId);

    // Generate thumbnail
    let thumbId = null;
    if (sharp && finalMime !== 'image/gif') {
      try {
        const thumbBuffer = await sharp(finalBuffer)
          .resize(THUMB_MAX_PX, THUMB_MAX_PX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 75 })
          .toBuffer();
        // Named from the main file's uuid so "GET /media/:fileId?thumb=1" can find it
        thumbId = `${fileId.replace(/\.[^.]+$/, '')}.thumb.webp`;
        await fs.promises.writeFile(path.join(UPLOADS_DIR, thumbId), thumbBuffer);
      } catch {
        thumbId = null;
      }
    }

    try {
      await fs.promises.writeFile(filePath, finalBuffer);
      await recordUpload(fileId, request.auth.userId);
    } catch (err) {
      request.log.error({ err }, 'Failed to write media file');
      return reply.status(500).send({ success: false, error: 'Upload failed' });
    }

    return reply.status(201).send({ success: true, fileId, thumbId });
  });

  // POST /api/v3/media/upload-video
  // Body: raw binary, Content-Type: video/* — max 100 MB
  app.post('/api/v3/media/upload-video',
    { preHandler: requireAuth, bodyLimit: 100 * 1024 * 1024 },
    async (request, reply) => {
      const mime = baseMime(request.headers['content-type']);
      if (!isVideo(mime) || !MIME_TO_EXT[mime]) {
        return reply.status(400).send({ success: false, error: 'Unsupported video type' });
      }

      const body = request.body;
      if (!body || !Buffer.isBuffer(body) || body.length === 0) {
        return reply.status(400).send({ success: false, error: 'Missing video data' });
      }
      if (body.length > 100 * 1024 * 1024) {
        return reply.status(413).send({ success: false, error: 'Video too large (max 100 MB)' });
      }

      const ext = MIME_TO_EXT[mime];
      const fileId = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileId);

      try {
        await fs.promises.writeFile(filePath, body);
        await recordUpload(fileId, request.auth.userId);
      } catch (err) {
        request.log.error({ err }, 'Failed to write video file');
        return reply.status(500).send({ success: false, error: 'Upload failed' });
      }

      return reply.status(201).send({ success: true, fileId });
    }
  );

  // POST /api/v3/media/upload-binary
  // Audio / documents: raw binary, Content-Type determines type — max 50 MB
  app.post('/api/v3/media/upload-binary',
    { preHandler: requireAuth, bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => {
      const mime = baseMime(request.headers['content-type']);
      if (!MIME_TO_EXT[mime] || mime.startsWith('image/') || mime.startsWith('video/')) {
        return reply.status(400).send({ success: false, error: 'Unsupported file type' });
      }
      const body = request.body;
      if (!body || !Buffer.isBuffer(body) || body.length === 0) {
        return reply.status(400).send({ success: false, error: 'Missing file data' });
      }
      const ext = MIME_TO_EXT[mime];
      const fileId = `${crypto.randomUUID()}${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileId);
      try {
        await fs.promises.writeFile(filePath, body);
        await recordUpload(fileId, request.auth.userId);
      } catch (err) {
        request.log.error({ err }, 'Failed to write file');
        return reply.status(500).send({ success: false, error: 'Upload failed' });
      }
      return reply.status(201).send({ success: true, fileId });
    }
  );

  // GET /api/v3/media/:fileId
  app.get('/api/v3/media/:fileId', { preHandler: requireAuth }, async (request, reply) => {
    const { fileId } = request.params;

    if (!FILE_ID_RE.test(fileId)) {
      return reply.status(400).send({ success: false, error: 'Invalid file ID' });
    }

    if (!request.auth.isAdmin && !(await canAccessFile(request.auth.userId, fileId))) {
      return reply.status(403).send({ success: false, error: 'Access denied' });
    }

    // Low-detail thumbnail for the blurred inline preview (so the sharp image never reaches the device there)
    if (request.query?.thumb) {
      const thumbPath = path.join(UPLOADS_DIR, `${fileId.replace(/\.[^.]+$/, '')}.thumb.webp`);
      try {
        const tstat = await fs.promises.stat(thumbPath);
        return reply
          .header('Content-Type', 'image/webp')
          .header('Content-Length', String(tstat.size))
          .header('Cache-Control', 'private, max-age=86400')
          .header('X-Content-Type-Options', 'nosniff')
          .send(fs.createReadStream(thumbPath));
      } catch { /* no thumb (e.g. gif/old upload): fall through to the full file */ }
    }

    const filePath = path.join(UPLOADS_DIR, fileId);
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return reply.status(404).send({ success: false, error: 'Not found' });
    }

    const ext = path.extname(fileId).toLowerCase();
    const contentType = EXT_TO_MIME[ext] || 'application/octet-stream';
    const video = isVideo(contentType);
    const totalSize = stat.size;

    // Handle Range requests — required for video seeking and iOS playback
    const rangeHeader = request.headers.range;
    if (video && rangeHeader) {
      const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end   = match[2] ? parseInt(match[2], 10) : totalSize - 1;
        const chunkSize = end - start + 1;

        if (start >= totalSize || end >= totalSize || start > end) {
          return reply
            .status(416)
            .header('Content-Range', `bytes */${totalSize}`)
            .send();
        }

        return reply
          .status(206)
          .header('Content-Type', contentType)
          .header('Content-Range', `bytes ${start}-${end}/${totalSize}`)
          .header('Content-Length', String(chunkSize))
          .header('Accept-Ranges', 'bytes')
          .header('Cache-Control', 'private, max-age=86400')
          .header('X-Content-Type-Options', 'nosniff')
          .send(fs.createReadStream(filePath, { start, end }));
      }
    }

    return reply
      .header('Content-Type', contentType)
      .header('Content-Length', String(totalSize))
      .header('Cache-Control', 'private, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', 'inline')
      .header('Accept-Ranges', video ? 'bytes' : 'none')
      .send(fs.createReadStream(filePath));
  });
}

module.exports = { registerMediaRoutes };
