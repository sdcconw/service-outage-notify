const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireAdminAuth } = require('../middleware/auth');
const { verifyCsrfToken } = require('../middleware/csrf');
const { writeAuditLog } = require('../models/audit');
const { resolveStatusColor } = require('../models/statusColor');
const { generateIncidentCode, generateMaintenanceCode } = require('../models/managementCode');

const auth = requireAdminAuth;

router.use((req, res, next) => {
  if (req.method === 'POST') return verifyCsrfToken(req, res, next);
  return next();
});

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function getStatusColorInt(color) {
  return parseInt(resolveStatusColor(color).hex.replace('#', ''), 16);
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

function parseListState(query, defaults) {
  const page = Math.max(parseInt(query.page || defaults.page, 10) || defaults.page, 1);
  const pageSize = [10, 20, 50, 100].includes(parseInt(query.page_size, 10))
    ? parseInt(query.page_size, 10)
    : defaults.pageSize;
  const sort = Object.prototype.hasOwnProperty.call(defaults.allowedSort, query.sort)
    ? query.sort
    : defaults.sort;
  const order = String(query.order || defaults.order).toLowerCase() === 'asc' ? 'asc' : 'desc';

  return {
    page,
    pageSize,
    sort,
    order,
    orderSql: order.toUpperCase(),
    sortSql: defaults.allowedSort[sort],
  };
}

function buildListQuery(state) {
  return `?page=${state.page}&page_size=${state.pageSize}&sort=${encodeURIComponent(state.sort)}&order=${state.order}`;
}

function buildReturnQuery(query, defaults) {
  const page = Math.max(parseInt(query.page || defaults.page, 10) || defaults.page, 1);
  const pageSize = [10, 20, 50, 100].includes(parseInt(query.page_size, 10))
    ? parseInt(query.page_size, 10)
    : defaults.pageSize;
  const sort = query.sort || defaults.sort;
  const order = String(query.order || defaults.order).toLowerCase() === 'asc' ? 'asc' : 'desc';
  return `?page=${page}&page_size=${pageSize}&sort=${encodeURIComponent(sort)}&order=${order}`;
}

function clampPage(page, totalPages) {
  return Math.min(Math.max(page, 1), Math.max(totalPages, 1));
}

function enrichIncidents(incidents) {
  const incidentTags = db.prepare(`
    SELECT it.incident_id, t.id, t.name
    FROM incident_tags it
    JOIN tags t ON it.tag_id = t.id
  `).all();

  const byIncidentId = new Map();
  incidentTags.forEach((row) => {
    if (!byIncidentId.has(row.incident_id)) byIncidentId.set(row.incident_id, []);
    byIncidentId.get(row.incident_id).push(row);
  });

  incidents.forEach((incident) => {
    const tags = byIncidentId.get(incident.id) || [];
    incident.tags = tags.map((t) => t.name);
    incident.tag_ids = tags.map((t) => String(t.id));
    const color = resolveStatusColor(incident.status_color);
    incident.status_color = color.hex;
    incident.status_text_color = color.textColor;
    incident.start_at_fmt = formatDateTime(incident.start_at);
    incident.end_at_fmt = incident.end_at ? formatDateTime(incident.end_at) : '';
  });
}

function enrichMaintenances(maintenances) {
  const maintenanceTags = db.prepare(`
    SELECT mt.maintenance_id, t.id, t.name
    FROM maintenance_tags mt
    JOIN tags t ON mt.tag_id = t.id
  `).all();

  const byMaintenanceId = new Map();
  maintenanceTags.forEach((row) => {
    if (!byMaintenanceId.has(row.maintenance_id)) byMaintenanceId.set(row.maintenance_id, []);
    byMaintenanceId.get(row.maintenance_id).push(row);
  });

  maintenances.forEach((maintenance) => {
    const tags = byMaintenanceId.get(maintenance.id) || [];
    maintenance.tags = tags.map((t) => t.name);
    maintenance.tag_ids = tags.map((t) => String(t.id));
    const color = resolveStatusColor(maintenance.status_color);
    maintenance.status_color = color.hex;
    maintenance.status_text_color = color.textColor;
    maintenance.start_time_fmt = formatDateTime(maintenance.start_time);
    maintenance.end_time_fmt = maintenance.end_time ? formatDateTime(maintenance.end_time) : '';
  });
}

function saveMaintenanceTags(maintenanceId, tagIds) {
  db.prepare(`DELETE FROM maintenance_tags WHERE maintenance_id = ?`).run(maintenanceId);
  const insert = db.prepare(`INSERT INTO maintenance_tags (maintenance_id, tag_id) VALUES (?, ?)`);
  tagIds.forEach((tagId) => insert.run(maintenanceId, tagId));
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

async function sendDiscordNotificationMaintenanceEmbed(title, startTime, endTime, statusName, statusColor) {
  if (!DISCORD_WEBHOOK_URL) return;

  const embed = {
    title: `🔧 「${title}」メンテナンス実施のお知らせ`,
    description: [
      `**メンテナンス予定時間:** ${formatDateTime(startTime)} ～ ${endTime ? formatDateTime(endTime) : '未定'}`,
      `**対応状況:** ${statusName}`,
      '',
      `詳細は [SDCCONWv3メンテナンス情報ページ](https://outage.s.sdconw.com/#maintenance) をご確認ください。`
    ].join('\n'),
    color: getStatusColorInt(statusColor),
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

async function sendDiscordNotificationEmbed(code, title, statusName, statusColor) {
  if (!DISCORD_WEBHOOK_URL) return;

  const embed = {
    title: `⚠️ 案件管理番号 ${code} の障害情報`,
    description: `件名: **${title}**\n現在のステータスは **${statusName}** です。\n詳細は [SDCCONWv3障害情報ページ](https://outage.s.sdconw.com/) をご確認ください。`,
    color: getStatusColorInt(statusColor),
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

function listPagePayload(state, totalCount) {
  const totalPages = Math.max(Math.ceil(totalCount / state.pageSize), 1);
  const page = clampPage(state.page, totalPages);
  return {
    ...state,
    page,
    totalCount,
    totalPages,
    offset: (page - 1) * state.pageSize,
  };
}

router.get('/', auth, (req, res) => res.redirect('/admin/incidents'));

router.get('/incidents', auth, (req, res) => {
  const state = parseListState(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
    allowedSort: {
      created_at: 'i.created_at',
      code: 'i.code',
      category: 'c.name',
      title: 'i.title',
      status: 's.name',
      start_at: 'i.start_at',
      end_at: 'i.end_at',
    },
  });

  const totalCount = db.prepare('SELECT COUNT(*) AS cnt FROM incidents').get().cnt;
  const pageState = listPagePayload(state, totalCount);

  const incidents = db.prepare(`
    SELECT
      i.id, i.code, i.title, i.is_hidden,
      i.start_at, i.end_at,
      i.info_md,
      i.category_id,
      i.status_id,
      c.name AS category,
      s.name AS status,
      s.color AS status_color
    FROM incidents i
    JOIN categories c ON i.category_id = c.id
    JOIN statuses s ON i.status_id = s.id
    ORDER BY ${state.sortSql} ${state.orderSql}, i.id DESC
    LIMIT ? OFFSET ?
  `).all(pageState.pageSize, pageState.offset);

  enrichIncidents(incidents);

  const categories = db.prepare('SELECT * FROM categories').all();
  const statuses = db.prepare('SELECT * FROM statuses').all();
  const tags = db.prepare('SELECT * FROM tags').all();

  res.render('admin_incidents', {
    incidents,
    categories,
    statuses,
    tags,
    listState: {
      ...pageState,
      queryString: buildListQuery(pageState),
    },
  });
});

router.post('/incidents/add', auth, async (req, res) => {
  let { title, category_id, status_id, info_md, start_at, end_at, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  const newCode = generateIncidentCode();
  const result = db
    .prepare(`
      INSERT INTO incidents (code, title, category_id, status_id, info_md, start_at, end_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(newCode, title, category_id, status_id, info_md, start_at, end_at);

  saveIncidentTags(result.lastInsertRowid, tags);

  const created = db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
  writeAuditLog(req, 'create', 'incident', result.lastInsertRowid, null, created);

  if (discord_notify === '1') {
    const incident = db.prepare('SELECT code, title FROM incidents WHERE id = ?').get(result.lastInsertRowid);
    const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '不明', color: '#6c757d' };
    await sendDiscordNotificationEmbed(incident.code, incident.title, status.name, status.color);
  }

  res.redirect(`/admin/incidents${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

router.post('/incidents/edit/:id', auth, async (req, res) => {
  let { title, category_id, status_id, info_md, start_at, end_at, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  const before = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);

  db.prepare(`
    UPDATE incidents
    SET title = ?, category_id = ?, status_id = ?, info_md = ?, start_at = ?, end_at = ?
    WHERE id = ?
  `).run(title, category_id, status_id, info_md, start_at, end_at, req.params.id);

  saveIncidentTags(req.params.id, tags);

  const after = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  writeAuditLog(req, 'update', 'incident', req.params.id, before, after);

  if (discord_notify === '1') {
    const incident = db.prepare('SELECT code, title FROM incidents WHERE id = ?').get(req.params.id);
    const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '不明', color: '#6c757d' };
    await sendDiscordNotificationEmbed(incident.code, incident.title, status.name, status.color);
  }

  res.redirect(`/admin/incidents${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

router.post('/incidents/hide/:id', auth, async (req, res) => {
  const current = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  const newValue = current.is_hidden ? 0 : 1;
  db.prepare('UPDATE incidents SET is_hidden = ? WHERE id = ?').run(newValue, req.params.id);
  const after = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  writeAuditLog(req, 'toggle_visibility', 'incident', req.params.id, current, after);

  res.redirect(`/admin/incidents${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

router.post('/incidents/delete/:id', auth, async (req, res) => {
  const before = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM incident_tags WHERE incident_id = ?').run(req.params.id);
  db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  writeAuditLog(req, 'delete', 'incident', req.params.id, before, null);

  res.redirect(`/admin/incidents${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

router.get('/maintenance', auth, (req, res) => {
  const state = parseListState(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
    allowedSort: {
      created_at: 'm.created_at',
      code: 'm.code',
      id: 'm.id',
      category: 'c.name',
      title: 'm.title',
      status: 's.name',
      start_time: 'm.start_time',
      end_time: 'm.end_time',
    },
  });

  const totalCount = db.prepare('SELECT COUNT(*) AS cnt FROM maintenance_schedules').get().cnt;
  const pageState = listPagePayload(state, totalCount);

  const maintenances = db.prepare(`
    SELECT
      m.id, m.code, m.title, m.is_hidden,
      m.start_time, m.end_time,
      m.description,
      m.category_id,
      m.status_id,
      c.name AS category,
      s.name AS status,
      s.color AS status_color
    FROM maintenance_schedules m
    JOIN categories c ON m.category_id = c.id
    JOIN statuses s ON m.status_id = s.id
    ORDER BY ${state.sortSql} ${state.orderSql}, m.id DESC
    LIMIT ? OFFSET ?
  `).all(pageState.pageSize, pageState.offset);

  enrichMaintenances(maintenances);

  const categories = db.prepare('SELECT * FROM categories').all();
  const statuses = db.prepare('SELECT * FROM statuses').all();
  const tags = db.prepare('SELECT * FROM tags').all();

  res.render('admin_maintenance', {
    maintenances,
    categories,
    statuses,
    tags,
    listState: {
      ...pageState,
      queryString: buildListQuery(pageState),
    },
  });
});

router.post('/maintenance/add', auth, async (req, res) => {
  let { title, category_id, status_id, description, start_time, end_time, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  const newCode = generateMaintenanceCode();
  const result = db
    .prepare(`
      INSERT INTO maintenance_schedules (code, title, category_id, status_id, description, start_time, end_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(newCode, title, category_id, status_id, description, start_time, end_time);

  saveMaintenanceTags(result.lastInsertRowid, tags);

  const created = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(result.lastInsertRowid);
  writeAuditLog(req, 'create', 'maintenance', result.lastInsertRowid, null, created);

  if (discord_notify === '1') {
    const maintenance = db.prepare('SELECT title, start_time, end_time FROM maintenance_schedules WHERE id = ?').get(result.lastInsertRowid);
    const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '予定', color: '#6c757d' };
    await sendDiscordNotificationMaintenanceEmbed(maintenance.title, maintenance.start_time, maintenance.end_time, status.name, status.color);
  }

  res.redirect(`/admin/maintenance${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

router.post('/maintenance/edit/:id', auth, async (req, res) => {
  let { title, category_id, status_id, description, start_time, end_time, tags, discord_notify } = req.body;
  tags = Array.isArray(tags) ? tags : tags ? [tags] : [];

  const before = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(req.params.id);

  db.prepare(`
    UPDATE maintenance_schedules
    SET title = ?, category_id = ?, status_id = ?, description = ?, start_time = ?, end_time = ?
    WHERE id = ?
  `).run(title, category_id, status_id, description, start_time, end_time, req.params.id);

  saveMaintenanceTags(req.params.id, tags);

  const after = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(req.params.id);
  writeAuditLog(req, 'update', 'maintenance', req.params.id, before, after);

  if (discord_notify === '1') {
    const maintenance = db.prepare('SELECT title, start_time, end_time FROM maintenance_schedules WHERE id = ?').get(req.params.id);
    const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '予定', color: '#6c757d' };
    await sendDiscordNotificationMaintenanceEmbed(maintenance.title, maintenance.start_time, maintenance.end_time, status.name, status.color);
  }

  res.redirect(`/admin/maintenance${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

router.post('/maintenance/hide/:id', auth, async (req, res) => {
  const current = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(req.params.id);
  const newValue = current.is_hidden ? 0 : 1;
  db.prepare('UPDATE maintenance_schedules SET is_hidden = ? WHERE id = ?').run(newValue, req.params.id);
  const after = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(req.params.id);
  writeAuditLog(req, 'toggle_visibility', 'maintenance', req.params.id, current, after);

  res.redirect(`/admin/maintenance${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

router.post('/maintenance/delete/:id', auth, async (req, res) => {
  const before = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM maintenance_schedules WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM maintenance_tags WHERE maintenance_id = ?').run(req.params.id);
  writeAuditLog(req, 'delete', 'maintenance', req.params.id, before, null);

  res.redirect(`/admin/maintenance${buildReturnQuery(req.query, {
    page: 1,
    pageSize: 20,
    sort: 'created_at',
    order: 'desc',
  })}`);
});

module.exports = router;
