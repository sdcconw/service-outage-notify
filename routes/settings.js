// Admin settings routes for category/status/tag master maintenance.
// Delete actions block removal when any incident/maintenance references remain.
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAdminAuth } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { writeAuditLog } = require('../models/audit');
const { BOOTSTRAP_STATUS_COLORS, normalizeStatusColorInput, resolveStatusColor } = require('../models/statusColor');

const auth = requireAdminAuth;

router.use((req, res, next) => {
  if (req.method === 'POST') return verifyCsrfToken(req, res, next);
  return next();
});

// 共通のDB操作関数
const getAll = (table) => db.prepare(`SELECT * FROM ${table}`).all();

const insert = (table, name) => {
  if (!name) return;
  db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name);
};

const update = (table, id, name) => {
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, id);
};

const insertStatus = (name, color) => {
  if (!name) return;
  db.prepare(`INSERT INTO statuses (name, color) VALUES (?, ?)`).run(name, normalizeStatusColorInput(color));
};

const updateStatus = (id, name, color) => {
  db.prepare(`UPDATE statuses SET name = ?, color = ? WHERE id = ?`).run(name, normalizeStatusColorInput(color), id);
};

const isUsed = (table, column, id) => {
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${table} WHERE ${column} = ?`).get(id);
  return row && row.cnt > 0;
};

const remove = (table, id) => {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
};

// 管理画面表示
router.get('/', auth, (req, res) => {
  const statuses = getAll('statuses').map((s) => ({
    ...s,
    color_resolved: resolveStatusColor(s.color),
  }));

  res.render('admin_settings', {
    categories: getAll('categories'),
    statuses,
    tags: getAll('tags'),
    bootstrapColors: Object.keys(BOOTSTRAP_STATUS_COLORS),
  });
});

// カテゴリ
router.post('/add/category', auth, (req, res) => {
  insert('categories', req.body.name);
  const row = db.prepare('SELECT id, name FROM categories WHERE id = last_insert_rowid()').get();
  if (row) writeAuditLog(req, 'create', 'category', row.id, null, row);
  res.redirect('/admin/settings');
});

router.post('/edit/category/:id', auth, (req, res) => {
  const before = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  update('categories', req.params.id, req.body.name);
  const after = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  writeAuditLog(req, 'update', 'category', req.params.id, before, after);
  res.redirect('/admin/settings');
});

router.post('/delete/category/:id', auth, (req, res) => {
  if (
    isUsed('incidents', 'category_id', req.params.id) ||
    isUsed('maintenance_schedules', 'category_id', req.params.id)
  ) {
    return res.status(400).send('このカテゴリは使用中のため削除できません。');
  }
  const before = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  remove('categories', req.params.id);
  writeAuditLog(req, 'delete', 'category', req.params.id, before, null);
  res.redirect('/admin/settings');
});

// ステータス
router.post('/add/status', auth, (req, res) => {
  insertStatus(req.body.name, req.body.color);
  const row = db.prepare('SELECT id, name, color FROM statuses WHERE id = last_insert_rowid()').get();
  if (row) writeAuditLog(req, 'create', 'status', row.id, null, row);
  res.redirect('/admin/settings');
});

router.post('/edit/status/:id', auth, (req, res) => {
  const before = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id);
  updateStatus(req.params.id, req.body.name, req.body.color);
  const after = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id);
  writeAuditLog(req, 'update', 'status', req.params.id, before, after);
  res.redirect('/admin/settings');
});

router.post('/delete/status/:id', auth, (req, res) => {
  if (
    isUsed('incidents', 'status_id', req.params.id) ||
    isUsed('maintenance_schedules', 'status_id', req.params.id)
  ) {
    return res.status(400).send('このステータスは使用中のため削除できません。');
  }
  const before = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id);
  remove('statuses', req.params.id);
  writeAuditLog(req, 'delete', 'status', req.params.id, before, null);
  res.redirect('/admin/settings');
});

// タグ
router.post('/add/tag', auth, (req, res) => {
  insert('tags', req.body.name);
  const row = db.prepare('SELECT id, name FROM tags WHERE id = last_insert_rowid()').get();
  if (row) writeAuditLog(req, 'create', 'tag', row.id, null, row);
  res.redirect('/admin/settings');
});

router.post('/edit/tag/:id', auth, (req, res) => {
  const before = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  update('tags', req.params.id, req.body.name);
  const after = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  writeAuditLog(req, 'update', 'tag', req.params.id, before, after);
  res.redirect('/admin/settings');
});

router.post('/delete/tag/:id', auth, (req, res) => {
  if (
    isUsed('incident_tags', 'tag_id', req.params.id) ||
    isUsed('maintenance_tags', 'tag_id', req.params.id)
  ) {
    return res.status(400).send('このタグは使用中のため削除できません。');
  }
  const before = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
  remove('tags', req.params.id);
  writeAuditLog(req, 'delete', 'tag', req.params.id, before, null);
  res.redirect('/admin/settings');
});

module.exports = router;
