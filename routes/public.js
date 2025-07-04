const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Markdownを安全にHTMLへ変換
const convertMarkdownToSafeHtml = (markdown) => {
  try {
    const rawHtml = marked.parse(markdown || '');
    return DOMPurify.sanitize(rawHtml);
  } catch {
    return '<p>プレビューエラー</p>';
  }
};

// 指定incidentIdのタグ名を取得
const getTagsForIncident = (incidentId) => {
  const rows = db.prepare(`
    SELECT t.name 
    FROM tags t
    JOIN incident_tags it ON it.tag_id = t.id
    WHERE it.incident_id = ?
  `).all(incidentId);
  return rows.map(r => r.name);
};

router.get('/', (req, res) => {
  const incidentsRaw = db.prepare(`
    SELECT
      i.id, i.code, i.title, i.info_md, i.start_at, i.end_at,
      c.name AS category,
      s.name AS status,
      CASE s.name
        WHEN '回復済' THEN 'primary'
        WHEN '対応中' THEN 'warning'
        WHEN '確認中' THEN 'danger'
        ELSE 'secondary'
      END AS status_color
    FROM incidents i
    JOIN categories c ON i.category_id = c.id
    JOIN statuses s ON i.status_id = s.id
    WHERE i.is_hidden = 0
    ORDER BY i.created_at DESC
  `).all();

  const incidents = incidentsRaw.map(incident => ({
    ...incident,
    info_html: convertMarkdownToSafeHtml(incident.info_md),
    tags: getTagsForIncident(incident.id)
  }));

  res.render('index', { incidents });
});

module.exports = router;
