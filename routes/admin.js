const express = require('express');
const router = express.Router();
const db = require('../models/db');
const auth = require('../middleware/auth');
const marked = require('marked');

function generateCode() {
  const now = new Date();
  const date = now.toISOString().slice(0,10).replace(/-/g, '');
  const time = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0');
  const todayCount = db.prepare("SELECT COUNT(*) as cnt FROM incidents WHERE substr(created_at, 1, 10) = date('now')").get().cnt;
  const count = (todayCount + 1).toString().padStart(3, '0');
  return date + time + count;
}

router.get('/', auth, (req, res) => res.redirect('/admin/incidents'));

// 一覧とフォーム表示
router.get('/incidents', auth, (req, res) => {
  const incidents = db.prepare(`
    SELECT 
      i.id, i.code, i.title, i.is_hidden,
      i.start_at, i.end_at,
      i.info_md,
      i.category_id,
      i.status_id,
      c.name AS category,
      s.name AS status
    FROM incidents i
    JOIN categories c ON i.category_id = c.id
    JOIN statuses s ON i.status_id = s.id
    ORDER BY i.created_at DESC
  `).all();

  incidents.forEach(incident => {
    const tags = db.prepare(`
      SELECT t.name FROM tags t
      JOIN incident_tags it ON it.tag_id = t.id
      WHERE it.incident_id = ?
    `).all(incident.id);
    incident.tags = tags.map(t => t.name);

    // ステータス色分け
    switch (incident.status) {
      case '確認中': incident.status_color = '#dc3545'; break;
      case '対応中': incident.status_color = '#ffc107'; break;
      case '回復済': incident.status_color = '#0d6efd'; break;
      default:        incident.status_color = '#6c757d'; break;
    }

    // Markdown → HTML 変換
    incident.info_html = marked.parse(incident.info_md || '');
  });

  const categories = db.prepare("SELECT * FROM categories").all();
  const statuses = db.prepare("SELECT * FROM statuses").all();
  const tags = db.prepare("SELECT * FROM tags").all();

  res.render('admin_incidents', {
    incidents,
    categories,
    statuses,
    tags
  });
});

// 追加処理
router.post('/incidents/add', auth, (req, res) => {
  const { title, category_id, status_id, info_md, start_at, end_at } = req.body;
  let tag_ids = req.body.tags;
  if (!Array.isArray(tag_ids)) {
    tag_ids = tag_ids ? [tag_ids] : [];
  }

  const result = db.prepare(`
    INSERT INTO incidents (code, title, category_id, status_id, info_md, start_at, end_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(generateCode(), title, category_id, status_id, info_md, start_at, end_at);
  const incidentId = result.lastInsertRowid;

  const insertTag = db.prepare("INSERT INTO incident_tags (incident_id, tag_id) VALUES (?, ?)");
  tag_ids.forEach(tagId => {
    insertTag.run(incidentId, tagId);
  });

  res.redirect('/admin/incidents');
});

// 編集送信処理
router.post('/incidents/edit/:id', auth, (req, res) => {
  const { title, category_id, status_id, info_md, start_at, end_at } = req.body;
  let tag_ids = req.body.tags;
  if (!Array.isArray(tag_ids)) {
    tag_ids = tag_ids ? [tag_ids] : [];
  }

  db.prepare(`
    UPDATE incidents 
    SET title = ?, category_id = ?, status_id = ?, info_md = ?, start_at = ?, end_at = ?
    WHERE id = ?
  `).run(title, category_id, status_id, info_md, start_at, end_at, req.params.id);

  db.prepare("DELETE FROM incident_tags WHERE incident_id = ?").run(req.params.id);
  const insertTag = db.prepare("INSERT INTO incident_tags (incident_id, tag_id) VALUES (?, ?)");
  tag_ids.forEach(tagId => {
    insertTag.run(req.params.id, tagId);
  });

  res.redirect('/admin/incidents');
});

// 非表示/表示切替
router.post('/incidents/hide/:id', auth, (req, res) => {
  const current = db.prepare("SELECT is_hidden FROM incidents WHERE id = ?").get(req.params.id);
  const newValue = current.is_hidden ? 0 : 1;
  db.prepare("UPDATE incidents SET is_hidden = ? WHERE id = ?").run(newValue, req.params.id);
  res.redirect('/admin/incidents');
});

// 完全削除
router.post('/incidents/delete/:id', auth, (req, res) => {
  db.prepare("DELETE FROM incidents WHERE id = ?").run(req.params.id);
  res.redirect('/admin/incidents');
});

module.exports = router;
