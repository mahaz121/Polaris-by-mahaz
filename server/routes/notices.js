const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { db, nowIso } = require('../utils/database');
const { PDF_MIME_TYPES, safeUpload } = require('../utils/security');
const { emitAllDisplays, emitAdminStats } = require('../socket');
const { audit } = require('../utils/audit');

const router = express.Router();
const upload = safeUpload({
  fieldTypes: {
    englishPdfFile: PDF_MIME_TYPES,
    arabicPdfFile: PDF_MIME_TYPES
  },
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 2
}).fields([
  { name: 'englishPdfFile', maxCount: 1 },
  { name: 'arabicPdfFile', maxCount: 1 }
]);

function publicUploadPath(file) {
  return file ? `/uploads/${path.basename(file.path)}` : '';
}

function mapNotice(row) {
  return row && {
    id: row.id,
    title: row.title || '',
    englishPdfFile: row.english_pdf || '',
    arabicPdfFile: row.arabic_pdf || '',
    effectiveDate: row.effective_date || '',
    displayOrder: Number(row.display_order || 0),
    active: !!row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanTitle(value) {
  return String(value || '').trim().slice(0, 160);
}

function cleanDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return raw.length === 10 ? raw : date.toISOString().slice(0, 10);
}

function cleanOrder(value) {
  return Math.max(0, Math.min(9999, Number(value || 0) || 0));
}

async function hasPdfSignature(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(5);
    await handle.read(buffer, 0, 5, 0);
    return buffer.toString('utf8') === '%PDF-';
  } finally {
    await handle.close();
  }
}

async function removeFile(uploadPath) {
  if (!uploadPath || !uploadPath.startsWith('/uploads/')) return;
  try {
    await fs.unlink(path.join(__dirname, '..', '..', 'public', 'uploads', path.basename(uploadPath)));
  } catch {}
}

async function validateUploadedPdf(file) {
  if (!file) return;
  if (!await hasPdfSignature(file.path)) {
    await fs.unlink(file.path).catch(() => {});
    const err = new Error('Uploaded file is not a valid PDF');
    err.statusCode = 400;
    throw err;
  }
}

async function validateNoticeFiles(files) {
  await Promise.all([
    validateUploadedPdf(files.englishPdfFile?.[0]),
    validateUploadedPdf(files.arabicPdfFile?.[0])
  ]);
}

async function cleanupRequestFiles(files = {}) {
  const uploaded = Object.values(files).flat().filter(Boolean);
  await Promise.all(uploaded.map(file => fs.unlink(file.path).catch(() => {})));
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM notice_board_notices
    WHERE active = 1
    ORDER BY display_order ASC, effective_date DESC, title COLLATE NOCASE ASC
  `).all();
  res.json(rows.map(mapNotice));
});

router.post('/', upload, async (req, res, next) => {
  try {
    await validateNoticeFiles(req.files || {});
    const title = cleanTitle(req.body.title);
    const effectiveDate = cleanDate(req.body.effectiveDate);
    const englishPdf = req.files?.englishPdfFile?.[0];
    const arabicPdf = req.files?.arabicPdfFile?.[0];
    if (!title) {
      await cleanupRequestFiles(req.files);
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!effectiveDate) {
      await cleanupRequestFiles(req.files);
      return res.status(400).json({ error: 'Effective date is required' });
    }
    if (!englishPdf || !arabicPdf) {
      await cleanupRequestFiles(req.files);
      return res.status(400).json({ error: 'English and Arabic PDF files are required' });
    }

    const stamp = nowIso();
    const row = {
      id: randomUUID(),
      title,
      englishPdf: publicUploadPath(englishPdf),
      arabicPdf: publicUploadPath(arabicPdf),
      effectiveDate,
      displayOrder: cleanOrder(req.body.displayOrder),
      createdAt: stamp,
      updatedAt: stamp
    };
    db.prepare(`
      INSERT INTO notice_board_notices
      (id, title, english_pdf, arabic_pdf, effective_date, display_order, active, created_at, updated_at)
      VALUES (@id, @title, @englishPdf, @arabicPdf, @effectiveDate, @displayOrder, 1, @createdAt, @updatedAt)
    `).run(row);
    audit(req, 'notice.create', { id: row.id, title: row.title });
    await emitAllDisplays();
    await emitAdminStats();
    res.status(201).json(mapNotice(db.prepare('SELECT * FROM notice_board_notices WHERE id = ?').get(row.id)));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', upload, async (req, res, next) => {
  try {
    await validateNoticeFiles(req.files || {});
    const existing = db.prepare('SELECT * FROM notice_board_notices WHERE id = ? AND active = 1').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Notice not found' });

    const englishPdf = req.files?.englishPdfFile?.[0];
    const arabicPdf = req.files?.arabicPdfFile?.[0];
    const title = cleanTitle(req.body.title) || existing.title;
    const effectiveDate = cleanDate(req.body.effectiveDate) || existing.effective_date;
    const nextEnglish = englishPdf ? publicUploadPath(englishPdf) : existing.english_pdf;
    const nextArabic = arabicPdf ? publicUploadPath(arabicPdf) : existing.arabic_pdf;
    db.prepare(`
      UPDATE notice_board_notices
      SET title = @title,
          english_pdf = @englishPdf,
          arabic_pdf = @arabicPdf,
          effective_date = @effectiveDate,
          display_order = @displayOrder,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: req.params.id,
      title,
      englishPdf: nextEnglish,
      arabicPdf: nextArabic,
      effectiveDate,
      displayOrder: cleanOrder(req.body.displayOrder),
      updatedAt: nowIso()
    });
    if (englishPdf) await removeFile(existing.english_pdf);
    if (arabicPdf) await removeFile(existing.arabic_pdf);
    audit(req, 'notice.update', { id: req.params.id, title });
    await emitAllDisplays();
    await emitAdminStats();
    res.json(mapNotice(db.prepare('SELECT * FROM notice_board_notices WHERE id = ?').get(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM notice_board_notices WHERE id = ? AND active = 1').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Notice not found' });
  db.prepare('UPDATE notice_board_notices SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  audit(req, 'notice.delete', { id: req.params.id, title: existing.title });
  await emitAllDisplays();
  await emitAdminStats();
  res.json({ ok: true });
});

module.exports = router;
