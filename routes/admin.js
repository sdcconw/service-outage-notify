const express = require('express');
const router = express.Router();
const db = require('../models/db');
const auth = require('../middleware/auth');
const marked = require('marked');
const fetch = require('node-fetch');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// =============================
// ステータス色共通関数
// =============================

// ステータス名 → HEXカラーコード（画面表示用）
function getStatusColorCode(status) {
  switch (status) {
    case '確認中': return '#dc3545'; // 赤 danger
    case '対応中': return '#ffc107'; // 黄 warning
    case '回復済': return '#0d6efd'; // 青 primary
    case '計画':   return '#6f42c1'; // 紫 info
    case '緊急':   return '#ffc107'; // 黄 warning
    case '完了':   return '#198754'; // 緑 success
    default:       return '#6c757d'; // グレー secondary
  }
}

// Discord用カラー（16進→10進）
function getStatusColor(status) {
  return parseInt(getStatusColorCode(status).replace('#', ''), 16);
}

// =============================
// メンテナンス関連
// =============================

function attachTagsToMaintenances(maintenances) {
  const maintenanceTags = db.prepare(`
    SELECT mt.maintenance_id, t.name
    FROM maintenance_tags mt
    JOIN tags t ON mt.tag_id = t.id
  `).all();

  maintenances.forEach(m => {
    m.tags = maintenanceTags
      .filter(mt => mt.maintenance_id === m.id)
      .map(mt => mt.name);

    // ステータスカラー付与
    m.status_color = getStatusColorCode(m.status);
  });
}

function saveMaintenanceTags(maintenanceId, tagIds) {
  db.prepare(`DELETE FROM maintenance_tags WHERE maintenance_id = ?`).run(maintenanceId);
  const insert = db.prepare(`INSERT INTO maintenance_tags (maintenance_id, tag_id) VALUES (?, ?)`);
  tagIds.forEach(tagId => insert.run(maintenanceId, tagId));
}

// Discord通知関数（メンテナンス用）
async function sendDiscordNotificationMaintenanceEmbed(title, start_time, end_time, status) {
  if (!DISCORD_WEBHOOK_URL) return;

  const color = getStatusColor(status);

  const embed = {
    title: `🔧 「${title}」メンテナンス実施のお知らせ`,
    description: [
      `**メンテナンス予定時間:** ${start_time} ～ ${end_time || '未定'}`,
      `**対応状況:** ${status}`,
      '',
      `詳細は [SDCCONWv3メンテナンス情報ページ](https://outage.s.sdconw.com/#maintenance) をご確認ください。`
    ].join('\n'),
    color: color,
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (error) {
    console.error('Discord通知エラー（メンテナンス）:', error);
  }
}

// =============================
// 障害関連
// =============================

function attachTagsToIncidents(incidents) {
  incidents.forEach((incident) => {
    const tags = db
      .prepare(`
        SELECT t.id, t.name FROM tags t
        JOIN incident_tags it ON it.tag_id = t.id
        WHERE it.incident_id = ?
      `)
      .all(incident.id);

    incident.tags = tags.map((t) => t.name);
    incident.tag_ids = tags.map((t) => String(t.id));

    // ステータスカラーを付与
    incident.status_color = getStatusColorCode(incident.status);

    incident.info_html = marked.parse(incident.info_md || '');
  });
}

function saveIncidentTags(incidentId, tagIds) {
  db.prepare('DELETE FROM incident_tags WHERE incident_id = ?').run(incidentId);
  const insertTag = db.prepare(
    'INSERT INTO incident_tags (incident_id, tag_id) VALUES (?, ?)'
  );
  tagIds.forEach((tagId) => {
    insertTag.run(incidentId, tagId);
  });
}

// Discord通知関数（障害用）
async function sendDiscordNotificationEmbed(code, title, status) {
  if (!DISCORD_WEBHOOK_URL) return;

  const embed = {
    title: `⚠️ 案件管理番号 ${code} の障害情報`,
    description: `件名: **${title}**\n現在のステータスは **${status}** です。\n詳細は [SDCCONWv3障害情報ページ](https://outage.s.sdconw.com/) をご確認ください。`,
    color: getStatusColor(status),
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (error) {
    console.error('Discord通知エラー:', error);
  }
}

// =============================
// 共通ユーティリティ
// =============================

function generateCode() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time =
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0');
  const todayCount = db
    .prepare("SELECT COUNT(*) as cnt FROM incidents WHERE substr(created_at, 1, 10) = date('now')")
    .get().cnt;
  return date + time + (todayCount + 1).toString().padStart(3, '0');
}

// =============================
// ルーティング
// =============================

router.get('/', auth, (req, res) => res.redirect('/admin/incidents'));

// 障害一覧
router.get('/incidents', auth, (req, res) => {
  const incidents = db
    .prepare(`
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
    `)
    .all();

  attachTagsToIncidents(incidents);

  const categories = db.prepare('SELECT * FROM categories').all();
  const statuses = db.prepare('SELECT * FROM statuses').all();
  const tags = db.prepare('SELECT * FROM tags').all();

  res.render('admin_incidents', { incidents, categories, statuses, tags });
});

// 障害登録
router.post('/incidents/add', auth, async (req, res) => {
  let { title, category_id, status_id, info_md, start_at, end_at, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  const result = db
    .prepare(`
      INSERT INTO incidents (code, title, category_id, status_id, info_md, start_at, end_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(generateCode(), title, category_id, status_id, info_md, start_at, end_at);

  saveIncidentTags(result.lastInsertRowid, tags);

  if (discord_notify === '1') {
    const incident = db.prepare('SELECT code, title FROM incidents WHERE id = ?').get(result.lastInsertRowid);
    const status = db.prepare('SELECT name FROM statuses WHERE id = ?').get(status_id)?.name || '不明';
    await sendDiscordNotificationEmbed(incident.code, incident.title, status);
  }

  res.redirect('/admin/incidents');
});

// 障害編集
router.post('/incidents/edit/:id', auth, async (req, res) => {
  let { title, category_id, status_id, info_md, start_at, end_at, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  db.prepare(`
      UPDATE incidents 
      SET title = ?, category_id = ?, status_id = ?, info_md = ?, start_at = ?, end_at = ?
      WHERE id = ?
    `).run(title, category_id, status_id, info_md, start_at, end_at, req.params.id);

  saveIncidentTags(req.params.id, tags);

  if (discord_notify === '1') {
    const incident = db.prepare('SELECT code, title FROM incidents WHERE id = ?').get(req.params.id);
    const status = db.prepare('SELECT name FROM statuses WHERE id = ?').get(status_id)?.name || '不明';
    await sendDiscordNotificationEmbed(incident.code, incident.title, status);
  }

  res.redirect('/admin/incidents');
});

// 障害の表示/非表示切替
router.post('/incidents/hide/:id', auth, async (req, res) => {
  const current = db.prepare('SELECT is_hidden FROM incidents WHERE id = ?').get(req.params.id);
  const newValue = current.is_hidden ? 0 : 1;
  db.prepare('UPDATE incidents SET is_hidden = ? WHERE id = ?').run(newValue, req.params.id);
  res.redirect('/admin/incidents');
});

// 障害削除
router.post('/incidents/delete/:id', auth, async (req, res) => {
  db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  res.redirect('/admin/incidents');
});

// =============================
// メンテナンス管理
// =============================

router.get('/maintenance', auth, (req, res) => {
  const maintenances = db
    .prepare(`
      SELECT 
        m.id, m.title, m.is_hidden,
        m.start_time, m.end_time,
        m.description,
        m.category_id,
        m.status_id,
        c.name AS category,
        s.name AS status
      FROM maintenance_schedules m
      JOIN categories c ON m.category_id = c.id
      JOIN statuses s ON m.status_id = s.id
      ORDER BY m.created_at DESC
    `)
    .all();

  attachTagsToMaintenances(maintenances);

  const categories = db.prepare('SELECT * FROM categories').all();
  const statuses = db.prepare('SELECT * FROM statuses').all();
  const tags = db.prepare('SELECT * FROM tags').all();

  res.render('admin_maintenance', { maintenances, categories, statuses, tags });
});

// メンテナンス登録
router.post('/maintenance/add', auth, async (req, res) => {
  let { title, category_id, status_id, description, start_time, end_time, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  const result = db
    .prepare(`
      INSERT INTO maintenance_schedules (title, category_id, status_id, description, start_time, end_time)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(title, category_id, status_id, description, start_time, end_time);

  saveMaintenanceTags(result.lastInsertRowid, tags);

  if (discord_notify === '1') {
    const maintenance = db.prepare('SELECT title, start_time, end_time FROM maintenance_schedules WHERE id = ?').get(result.lastInsertRowid);
    const status = db.prepare('SELECT name FROM statuses WHERE id = ?').get(status_id)?.name || '予定';
    await sendDiscordNotificationMaintenanceEmbed(maintenance.title, maintenance.start_time, maintenance.end_time, status);
  }

  res.redirect('/admin/maintenance');
});

// メンテナンス編集
router.post('/maintenance/edit/:id', auth, async (req, res) => {
  let { title, category_id, status_id, description, start_time, end_time, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  db.prepare(`
      UPDATE maintenance_schedules 
      SET title = ?, category_id = ?, status_id = ?, description = ?, start_time = ?, end_time = ?
      WHERE id = ?
    `).run(title, category_id, status_id, description, start_time, end_time, req.params.id);

  saveMaintenanceTags(req.params.id, tags);

  if (discord_notify === '1') {
    const maintenance = db.prepare('SELECT title, start_time, end_time FROM maintenance_schedules WHERE id = ?').get(req.params.id);
    const status = db.prepare('SELECT name FROM statuses WHERE id = ?').get(status_id)?.name || '予定';
    await sendDiscordNotificationMaintenanceEmbed(maintenance.title, maintenance.start_time, maintenance.end_time, status);
  }

  res.redirect('/admin/maintenance');
});

// メンテナンスの表示/非表示切替
router.post('/maintenance/hide/:id', auth, async (req, res) => {
  const current = db.prepare('SELECT is_hidden FROM maintenance_schedules WHERE id = ?').get(req.params.id);
  const newValue = current.is_hidden ? 0 : 1;
  db.prepare('UPDATE maintenance_schedules SET is_hidden = ? WHERE id = ?').run(newValue, req.params.id);
  res.redirect('/admin/maintenance');
});

// メンテナンス削除
router.post('/maintenance/delete/:id', auth, async (req, res) => {
  db.prepare('DELETE FROM maintenance_schedules WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM maintenance_tags WHERE maintenance_id = ?').run(req.params.id);
  res.redirect('/admin/maintenance');
});

module.exports = router;
