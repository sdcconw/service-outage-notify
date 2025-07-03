const express = require('express');
const router = express.Router();
const db = require('../models/db');
const auth = require('../middleware/auth');

// 設定管理画面 表示
router.get('/', auth, (req, res) => {
  const categories = db.prepare("SELECT * FROM categories").all();
  const statuses = db.prepare("SELECT * FROM statuses").all();
  const tags = db.prepare("SELECT * FROM tags").all();

  res.render('admin_settings', {
    categories,
    statuses,
    tags
  });
});

// ----- カテゴリ -----
router.post('/add/category', auth, (req, res) => {
  const { name } = req.body;
  if (name) db.prepare("INSERT INTO categories (name) VALUES (?)").run(name);
  res.redirect('/admin/settings');
});

router.post('/edit/category/:id', auth, (req, res) => {
  const { name } = req.body;
  db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, req.params.id);
  res.redirect('/admin/settings');
});

router.post('/delete/category/:id', auth, (req, res) => {
  const usage = db.prepare("SELECT COUNT(*) AS cnt FROM incidents WHERE category_id = ?").get(req.params.id).cnt;
  if (usage > 0) {
    return res.status(400).send("このカテゴリは使用中のため削除できません。");
  }
  db.prepare("DELETE FROM categories WHERE id = ?").run(req.params.id);
  res.redirect('/admin/settings');
});

// ----- ステータス -----
router.post('/add/status', auth, (req, res) => {
  const { name } = req.body;
  if (name) db.prepare("INSERT INTO statuses (name) VALUES (?)").run(name);
  res.redirect('/admin/settings');
});

router.post('/edit/status/:id', auth, (req, res) => {
  const { name } = req.body;
  db.prepare("UPDATE statuses SET name = ? WHERE id = ?").run(name, req.params.id);
  res.redirect('/admin/settings');
});

router.post('/delete/status/:id', auth, (req, res) => {
  const usage = db.prepare("SELECT COUNT(*) AS cnt FROM incidents WHERE status_id = ?").get(req.params.id).cnt;
  if (usage > 0) {
    return res.status(400).send("このステータスは使用中のため削除できません。");
  }
  db.prepare("DELETE FROM statuses WHERE id = ?").run(req.params.id);
  res.redirect('/admin/settings');
});

// ----- タグ -----
router.post('/add/tag', auth, (req, res) => {
  const { name } = req.body;
  if (name) db.prepare("INSERT INTO tags (name) VALUES (?)").run(name);
  res.redirect('/admin/settings');
});

router.post('/edit/tag/:id', auth, (req, res) => {
  const { name } = req.body;
  db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, req.params.id);
  res.redirect('/admin/settings');
});

router.post('/delete/tag/:id', auth, (req, res) => {
  const usage = db.prepare("SELECT COUNT(*) AS cnt FROM incident_tags WHERE tag_id = ?").get(req.params.id).cnt;
  if (usage > 0) {
    return res.status(400).send("このタグは使用中のため削除できません。");
  }
  db.prepare("DELETE FROM tags WHERE id = ?").run(req.params.id);
  res.redirect('/admin/settings');
});

module.exports = router;
