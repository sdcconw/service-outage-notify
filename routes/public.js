const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const marked = require('marked');

// DOMPurifyセットアップ
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function convertMarkdownToSafeHtml(mdText) {
  const dirty = marked.parse(mdText || '');
  return DOMPurify.sanitize(dirty);
}


// タグ取得関数
function getTagsForIncident(id) {
  return db.prepare(`
    SELECT t.name
    FROM tags t
    JOIN incident_tags it ON it.tag_id = t.id
    WHERE it.incident_id = ?
  `).all(id).map(t => t.name);
}
function getTagsForMaintenance(id) {
  return db.prepare(`
    SELECT t.name
    FROM tags t
    JOIN maintenance_tags mt ON mt.tag_id = t.id
    WHERE mt.maintenance_id = ?
  `).all(id).map(t => t.name);
}

// 🔹 トップページ
router.get('/', (req, res) => {
  // 障害情報
  const incidentsRaw = db.prepare(`
    SELECT i.id, i.code, i.title, i.info_md, i.start_at, i.end_at,
           c.name AS category, s.name AS status
    FROM incidents i
    JOIN categories c ON i.category_id = c.id
    JOIN statuses s ON i.status_id = s.id
    WHERE i.is_hidden = 0
    ORDER BY i.created_at DESC
  `).all();

  const incidents = incidentsRaw.map(i => ({
    ...i,
    info_html: convertMarkdownToSafeHtml(i.info_md),
    tags: getTagsForIncident(i.id),
    status_color: getStatusColor(i.status)
  }));

  // メンテナンス情報
  const maintenanceRaw = db.prepare(`
    SELECT m.id, m.title, m.description AS info_md, m.start_time, m.end_time,
           c.name AS category, s.name AS status
    FROM maintenance_schedules m
    JOIN categories c ON m.category_id = c.id
    JOIN statuses s ON m.status_id = s.id
    WHERE IFNULL(m.is_hidden, 0) = 0
    ORDER BY m.created_at DESC
  `).all();

  const maintenance = maintenanceRaw.map(m => ({
    ...m,
    info_html: convertMarkdownToSafeHtml(m.info_md),
    tags: getTagsForMaintenance(m.id),
    status_color: getStatusColor(m.status)
  }));

  // 🔹 フィルタ用データ
  const statuses = db.prepare(`SELECT name FROM statuses ORDER BY id`).all();
  const categories = db.prepare(`SELECT name FROM categories ORDER BY id`).all();
  const tags = db.prepare(`SELECT name FROM tags ORDER BY id`).all();

  res.render('index', { incidents, maintenance, statuses, categories, tags });
});

// ステータス色
function getStatusColor(status) {
  switch (status) {
    case '回復済':
      return 'bg-success text-light'; // 緑：正常に戻った
    case '完了':
      return 'bg-primary text-light'; // 青：処理完了
    case '対応中':
      return 'bg-warning text-dark'; // 黄：進行中
    case '進行中':
      return 'bg-info text-dark'; // 水色：進行系でも軽め
    case '確認中':
      return 'bg-danger text-light'; // 赤：要確認
    case '予定':
      return 'bg-info text-dark'; // 水色：スケジュール予定
    case '計画':
      return 'bg-secondary text-light'; // グレー：まだ未実施
    case '緊急':
      return 'bg-danger text-light'; // 赤：最優先
    default:
      return 'bg-dark text-light'; // 黒：分類不能
  }
}


module.exports = router;
