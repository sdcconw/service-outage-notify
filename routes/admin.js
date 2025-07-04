const express = require('express');
const router = express.Router();
const db = require('../models/db');
const auth = require('../middleware/auth');
const marked = require('marked');
const fetch = require('node-fetch');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// ステータス別Discord Embedカラー取得（16進数→10進数）
function getStatusColor(status) {
  switch (status) {
    case '確認中':    return parseInt('dc3545', 16); // 赤
    case '対応中':    return parseInt('ffc107', 16); // 黄
    case '回復済':    return parseInt('0d6efd', 16); // 青
    default:          return parseInt('dc3545', 16); // 赤（その他）
  }
}

// Discord通知関数（Embed形式でリッチメッセージ送信）
async function sendDiscordNotificationEmbed(code, title, status) {
  if (!DISCORD_WEBHOOK_URL) return;

  const embed = {
    title: `案件管理番号 ${code} の障害情報`,
    description: `件名: **${title}**\n現在のステータスは **${status}** です。\n詳細は [outage.s.sdconw.com](https://outage.s.sdconw.com/) をご確認ください。`,
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

// 発番コード生成
function generateCode() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time =
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0');
  const todayCount = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM incidents WHERE substr(created_at, 1, 10) = date('now')"
    )
    .get().cnt;
  return date + time + (todayCount + 1).toString().padStart(3, '0');
}

// 指定incidentIdにタグ配列を保存（削除→挿入）
function saveIncidentTags(incidentId, tagIds) {
  db.prepare('DELETE FROM incident_tags WHERE incident_id = ?').run(incidentId);
  const insertTag = db.prepare(
    'INSERT INTO incident_tags (incident_id, tag_id) VALUES (?, ?)'
  );
  tagIds.forEach((tagId) => {
    insertTag.run(incidentId, tagId);
  });
}

// 事故情報一覧取得時のタグ情報付加
function attachTagsToIncidents(incidents) {
  incidents.forEach((incident) => {
    const tags = db
      .prepare(
        `
      SELECT t.id, t.name FROM tags t
      JOIN incident_tags it ON it.tag_id = t.id
      WHERE it.incident_id = ?
    `
      )
      .all(incident.id);

    incident.tags = tags.map((t) => t.name);
    incident.tag_ids = tags.map((t) => String(t.id));

    // ステータス色分け
    switch (incident.status) {
      case '確認中':
        incident.status_color = '#dc3545';
        break;
      case '対応中':
        incident.status_color = '#ffc107';
        break;
      case '回復済':
        incident.status_color = '#0d6efd';
        break;
      default:
        incident.status_color = '#dc3545';
        break;
    }

    incident.info_html = marked.parse(incident.info_md || '');
  });
}

router.get('/', auth, (req, res) => res.redirect('/admin/incidents'));

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

router.post('/incidents/add', auth, async (req, res) => {
  let {
    title,
    category_id,
    status_id,
    info_md,
    start_at,
    end_at,
    tags,
    discord_notify,
  } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  const result = db
    .prepare(
      `
    INSERT INTO incidents (code, title, category_id, status_id, info_md, start_at, end_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(generateCode(), title, category_id, status_id, info_md, start_at, end_at);

  saveIncidentTags(result.lastInsertRowid, tags);

  if (discord_notify === '1') {
    const incident = db
      .prepare('SELECT code, title FROM incidents WHERE id = ?')
      .get(result.lastInsertRowid);
    const status =
      db.prepare('SELECT name FROM statuses WHERE id = ?').get(status_id)?.name ||
      '不明';
    await sendDiscordNotificationEmbed(incident.code, incident.title, status);
  }

  res.redirect('/admin/incidents');
});

router.post('/incidents/edit/:id', auth, async (req, res) => {
  let {
    title,
    category_id,
    status_id,
    info_md,
    start_at,
    end_at,
    tags,
    discord_notify,
  } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  db.prepare(
    `
    UPDATE incidents 
    SET title = ?, category_id = ?, status_id = ?, info_md = ?, start_at = ?, end_at = ?
    WHERE id = ?
  `
  ).run(title, category_id, status_id, info_md, start_at, end_at, req.params.id);

  saveIncidentTags(req.params.id, tags);

  if (discord_notify === '1') {
    const incident = db
      .prepare('SELECT code, title FROM incidents WHERE id = ?')
      .get(req.params.id);
    const status =
      db.prepare('SELECT name FROM statuses WHERE id = ?').get(status_id)?.name ||
      '不明';
    await sendDiscordNotificationEmbed(incident.code, incident.title, status);
  }

  res.redirect('/admin/incidents');
});

router.post('/incidents/hide/:id', auth, async (req, res) => {
  const current = db
    .prepare('SELECT is_hidden FROM incidents WHERE id = ?')
    .get(req.params.id);
  const newValue = current.is_hidden ? 0 : 1;
  db.prepare('UPDATE incidents SET is_hidden = ? WHERE id = ?').run(
    newValue,
    req.params.id
  );
  res.redirect('/admin/incidents');
});

router.post('/incidents/delete/:id', auth, async (req, res) => {
  db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  res.redirect('/admin/incidents');
});

module.exports = router;
