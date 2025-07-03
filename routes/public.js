
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.code, i.title, i.info_md, i.start_at, i.end_at, c.name as category, s.name as status,
      CASE s.name
        WHEN '回復済' THEN 'primary'
        WHEN '対応中' THEN 'warning'
        WHEN '確認中' THEN 'danger'
        ELSE 'secondary'
      END as status_color
    FROM incidents i
    JOIN categories c ON i.category_id = c.id
    JOIN statuses s ON i.status_id = s.id
    WHERE i.is_hidden = 0
  ORDER BY i.created_at DESC
  `).all();

  // Markdown -> HTML 安全変換
  const incidents = rows.map(row => ({
    ...row,
    info_html: DOMPurify.sanitize(marked.parse(row.info_md || ''))
  }));

  
  // タグも取得
  incidents.forEach(i => {
    const tags = db.prepare(`
      SELECT t.name FROM tags t
      JOIN incident_tags it ON it.tag_id = t.id
      WHERE it.incident_id = ?
    `).all(i.id);
    i.tags = tags.map(t => t.name);
  });
  res.render('index', { incidents });

});

module.exports = router;
