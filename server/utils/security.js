const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { root } = require('./dataStore');

const PLACEHOLDER_SECRETS = new Set([
  '',
  'replace-this-secret',
  'replace-with-a-generated-strong-secret',
  'change-this-secret'
]);

function requireStrongSecret(name, minLength = 32) {
  const value = String(process.env[name] || '').trim();
  if (PLACEHOLDER_SECRETS.has(value) || value.length < minLength) {
    throw new Error(`${name} must be set to a strong secret of at least ${minLength} characters`);
  }
  return value;
}

function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  const allowed = allowedOrigins();
  if (!allowed.length && process.env.NODE_ENV !== 'production') return callback(null, true);
  if (allowed.includes(origin)) return callback(null, true);
  return callback(new Error('Origin is not allowed'), false);
}

function rateLimit({ windowMs, max, keyPrefix = 'global' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const bucket = hits.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    hits.set(key, bucket);
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    return next();
  };
}

function ensureCsrfToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.path === '/api/auth/login' || req.path === '/api/zkteco/push') return next();
  const expected = ensureCsrfToken(req);
  const provided = String(req.get('x-csrf-token') || req.body?._csrf || '').trim();
  if (!expected || provided !== expected) return res.status(403).json({ error: 'Invalid CSRF token' });
  return next();
}

function safeUpload({ fieldTypes, maxFileSize = 10 * 1024 * 1024, maxFiles = 1 }) {
  const storage = multer.diskStorage({
    destination: path.join(root, 'public', 'uploads'),
    filename: (req, file, cb) => {
      const ext = extensionFor(file.mimetype);
      cb(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${ext}`);
    }
  });
  return multer({
    storage,
    limits: { fileSize: maxFileSize, files: maxFiles },
    fileFilter: (req, file, cb) => {
      const allowed = fieldTypes[file.fieldname] || fieldTypes['*'] || [];
      if (allowed.includes(file.mimetype)) return cb(null, true);
      return cb(new Error('Unsupported file type'));
    }
  });
}

function extensionFor(mime) {
  return {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg'
  }[mime] || '.bin';
}

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg'];

module.exports = {
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  corsOrigin,
  ensureCsrfToken,
  rateLimit,
  requireCsrf,
  requireStrongSecret,
  safeUpload
};
