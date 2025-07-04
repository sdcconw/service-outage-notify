const express = require('express');
const router = express.Router();
const db = require('../models/db');
const auth = require('../middleware/auth');

// 共通のDB操作関数
const getAll = (table) => db.prepare(`SELECT * FROM ${table}`).all();

const insert = (table, name) => {
  if (!name) return;
  db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name);
};

const update = (table, id, name) => {
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, id);
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
  res.render('admin_settings', {
    categories: getAll('categories'),
    statuses: getAll('statuses'),
    tags: getAll('tags'),
  });
});

// カテゴリ
router.post('/add/category', auth, (req, res) => {
  insert('categories', req.body.name);
  res.redirect('/admin/settings');
});

router.post('/edit/category/:id', auth, (req, res) => {
  update('categories', req.params.id, req.body.name);
  res.redirect('/admin/settings');
});

router.post('/delete/category/:id', auth, (req, res) => {
  if (isUsed('incidents', 'category_id', req.params.id)) {
    return res.status(400).send('このカテゴリは使用中のため削除できません。');
  }
  remove('categories', req.params.id);
  res.redirect('/admin/settings');
});

// ステータス
router.post('/add/status', auth, (req, res) => {
  insert('statuses', req.body.name);
  res.redirect('/admin/settings');
});

router.post('/edit/status/:id', auth, (req, res) => {
  update('statuses', req.params.id, req.body.name);
  res.redirect('/admin/settings');
});

router.post('/delete/status/:id', auth, (req, res) => {
  if (isUsed('incidents', 'status_id', req.params.id)) {
    return res.status(400).send('このステータスは使用中のため削除できません。');
  }
  remove('statuses', req.params.id);
  res.redirect('/admin/settings');
});

// タグ
router.post('/add/tag', auth, (req, res) => {
  insert('tags', req.body.name);
  res.redirect('/admin/settings');
});

router.post('/edit/tag/:id', auth, (req, res) => {
  update('tags', req.params.id, req.body.name);
  res.redirect('/admin/settings');
});

router.post('/delete/tag/:id', auth, (req, res) => {
  if (isUsed('incident_tags', 'tag_id', req.params.id)) {
    return res.status(400).send('このタグは使用中のため削除できません。');
  }
  remove('tags', req.params.id);
  res.redirect('/admin/settings');
});

module.exports = router;
