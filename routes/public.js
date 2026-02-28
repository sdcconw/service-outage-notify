const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const marked = require('marked');
const { resolveStatusColor } = require('../models/statusColor');

// DOMPurifyセットアップ
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function convertMarkdownToSafeHtml(mdText) {
  const dirty = marked.parse(mdText || '');
  return DOMPurify.sanitize(dirty);
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16).replace('T', ' ');
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}


function buildTagMap(rows, idKey) {
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row[idKey])) map.set(row[idKey], []);
    map.get(row[idKey]).push(row.name);
  });
  return map;
}

// 🔹 トップページ
router.get('/', (req, res) => {
  // 障害情報
  const incidentsRaw = db.prepare(`
    SELECT i.id, i.code, i.title, i.info_md, i.start_at, i.end_at,
           c.name AS category, s.name AS status, s.color AS status_color
    FROM incidents i
    JOIN categories c ON i.category_id = c.id
    JOIN statuses s ON i.status_id = s.id
    WHERE i.is_hidden = 0
    ORDER BY i.created_at DESC
  `).all();
  const incidentTagMap = buildTagMap(
    db.prepare(`
      SELECT it.incident_id, t.name
      FROM incident_tags it
      JOIN tags t ON t.id = it.tag_id
    `).all(),
    'incident_id'
  );

  const incidents = incidentsRaw.map(i => ({
    ...i,
    info_html: convertMarkdownToSafeHtml(i.info_md),
    tags: incidentTagMap.get(i.id) || [],
    status_color: resolveStatusColor(i.status_color).hex,
    status_text_color: resolveStatusColor(i.status_color).textColor,
    start_at_fmt: formatDateTime(i.start_at),
    end_at_fmt: i.end_at ? formatDateTime(i.end_at) : '',
  }));

  // メンテナンス情報
  const maintenanceRaw = db.prepare(`
    SELECT m.id, m.code, m.title, m.description AS info_md, m.start_time, m.end_time,
           c.name AS category, s.name AS status, s.color AS status_color
    FROM maintenance_schedules m
    JOIN categories c ON m.category_id = c.id
    JOIN statuses s ON m.status_id = s.id
    WHERE IFNULL(m.is_hidden, 0) = 0
    ORDER BY m.created_at DESC
  `).all();
  const maintenanceTagMap = buildTagMap(
    db.prepare(`
      SELECT mt.maintenance_id, t.name
      FROM maintenance_tags mt
      JOIN tags t ON t.id = mt.tag_id
    `).all(),
    'maintenance_id'
  );

  const maintenance = maintenanceRaw.map(m => ({
    ...m,
    info_html: convertMarkdownToSafeHtml(m.info_md),
    tags: maintenanceTagMap.get(m.id) || [],
    status_color: resolveStatusColor(m.status_color).hex,
    status_text_color: resolveStatusColor(m.status_color).textColor,
    start_time_fmt: formatDateTime(m.start_time),
    end_time_fmt: m.end_time ? formatDateTime(m.end_time) : '',
  }));

  // 🔹 フィルタ用データ
  const statuses = db.prepare(`SELECT name FROM statuses ORDER BY id`).all();
  const categories = db.prepare(`SELECT name FROM categories ORDER BY id`).all();
  const tags = db.prepare(`SELECT name FROM tags ORDER BY id`).all();

  const latestUpdated = db.prepare(`
    SELECT MAX(ts) AS latest
    FROM (
      SELECT MAX(created_at) AS ts FROM incidents WHERE is_hidden = 0
      UNION ALL
      SELECT MAX(created_at) AS ts FROM maintenance_schedules WHERE IFNULL(is_hidden, 0) = 0
    )
  `).get().latest;

  res.render('index', {
    incidents,
    maintenance,
    statuses,
    categories,
    tags,
    lastUpdatedAt: latestUpdated ? formatDateTime(latestUpdated) : '-',
  });
});


module.exports = router;
