const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { requireApiAuth } = require('../middleware/auth');
const { body, validationResult, param } = require('express-validator');
const { writeAuditLog } = require('../models/audit');
const { generateIncidentCode, generateMaintenanceCode } = require('../models/managementCode');
const { resolveStatusColor } = require('../models/statusColor');

const auth = requireApiAuth;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

/** 共通レスポンス関数 */
function respond(res, success, data = null, error = null, status = 200) {
  res.status(status).json({ success, data, error });
}

/** データ存在チェック */
function exists(table, id) {
  const row = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
  return !!row;
}

function parseTagIds(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tagId) => Number(tagId))
    .filter((tagId) => Number.isInteger(tagId) && tagId > 0);
}

function allTagsExist(tagIds) {
  if (tagIds.length === 0) return true;
  const rows = db
    .prepare(`SELECT id FROM tags WHERE id IN (${tagIds.map(() => '?').join(',')})`)
    .all(...tagIds);
  return rows.length === new Set(tagIds).size;
}

function saveIncidentTags(incidentId, tagIds) {
  db.prepare('DELETE FROM incident_tags WHERE incident_id = ?').run(incidentId);
  if (tagIds.length === 0) return;
  const stmt = db.prepare('INSERT INTO incident_tags (incident_id, tag_id) VALUES (?, ?)');
  tagIds.forEach((tagId) => stmt.run(incidentId, tagId));
}

function saveMaintenanceTags(maintenanceId, tagIds) {
  db.prepare('DELETE FROM maintenance_tags WHERE maintenance_id = ?').run(maintenanceId);
  if (tagIds.length === 0) return;
  const stmt = db.prepare('INSERT INTO maintenance_tags (maintenance_id, tag_id) VALUES (?, ?)');
  tagIds.forEach((tagId) => stmt.run(maintenanceId, tagId));
}

function shouldNotify(raw) {
  return raw === true || raw === 1 || raw === '1';
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function getStatusColorInt(color) {
  return parseInt(resolveStatusColor(color).hex.replace('#', ''), 16);
}

async function sendDiscordNotificationIncident(code, title, statusName, statusColor) {
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
  } catch (e) {
    console.error('Discord通知エラー(incident):', e);
  }
}

async function sendDiscordNotificationMaintenance(title, startTime, endTime, statusName, statusColor) {
  if (!DISCORD_WEBHOOK_URL) return;
  const embed = {
    title: `🔧 「${title}」メンテナンス実施のお知らせ`,
    description: [
      `**メンテナンス予定時間:** ${formatDateTime(startTime)} ～ ${endTime ? formatDateTime(endTime) : '未定'}`,
      `**対応状況:** ${statusName}`,
      '',
      '詳細は [SDCCONWv3メンテナンス情報ページ](https://outage.s.sdconw.com/#maintenance) をご確認ください。',
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
  } catch (e) {
    console.error('Discord通知エラー(maintenance):', e);
  }
}

/**
 * @swagger
 * tags:
 *   - name: Incidents
 *     description: 障害情報を管理するAPI
 *   - name: Maintenance
 *     description: メンテナンス情報を管理するAPI
 */

//
// ==================== Incidents API ====================
//

/**
 * @swagger
 * /api/incidents:
 *   get:
 *     summary: 障害情報一覧の取得
 *     description: 登録されているすべての障害情報を取得します。
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: 一覧取得成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer, example: 1 }
 *                       code: { type: string, example: "INC202510261423001" }
 *                       title: { type: string, example: "通信障害" }
 *                       category: { type: string, example: "ネットワーク" }
 *                       status: { type: string, example: "対応中" }
 *                       start_at: { type: string, example: "2025-10-26T14:23:00+09:00" }
 *                       end_at: { type: string, example: null }
 *                       tags:
 *                         type: array
 *                         items: { type: string }
 *                         example: ["OSI01"]
 *                 error: { type: string, example: null }
 */
router.get('/incidents', auth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT i.id, i.code, i.title, i.info_md, i.start_at, i.end_at,
             COALESCE(GROUP_CONCAT(t.name, '||'), '') AS tags_csv,
             c.name AS category, s.name AS status
      FROM incidents i
      JOIN categories c ON i.category_id = c.id
      JOIN statuses s ON i.status_id = s.id
      LEFT JOIN incident_tags it ON it.incident_id = i.id
      LEFT JOIN tags t ON t.id = it.tag_id
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `).all();
    const data = rows.map((row) => ({
      ...row,
      tags: row.tags_csv ? row.tags_csv.split('||').filter(Boolean) : [],
    })).map(({ tags_csv, ...row }) => row);
    respond(res, true, data);
  } catch (e) {
    respond(res, false, null, e.message, 500);
  }
});


/**
 * @swagger
 * /api/incidents:
 *   post:
 *     summary: 障害情報を新規登録
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category_id, status_id, start_at]
 *             properties:
 *               title:
 *                 type: string
 *                 description: 障害のタイトル
 *               category_id:
 *                 type: integer
 *                 description: カテゴリID (1=ネットワーク, 2=アプリ, 3=DB, 4=その他)
 *               status_id:
 *                 type: integer
 *                 description: ステータスID (1=調査中, 2=対応中, 3=復旧, 4=完了)
 *               info_md:
 *                 type: string
 *                 description: 詳細情報 (Markdown可)
 *               start_at:
 *                 type: string
 *                 format: date-time
 *                 description: 障害発生日時
 *               end_at:
 *                 type: string
 *                 format: date-time
 *                 description: 障害終了日時
 *               is_hidden:
 *                 type: boolean
 *                 description: 非表示フラグ（true=非公開, false=公開）
 *                 example: false
 *               tags:
 *                 type: array
 *                 items: { type: integer }
 *                 description: タグID配列
 *               discord_notify:
 *                 type: boolean
 *                 description: Discord通知を送信するか
 *           example:
 *             title: "API応答遅延"
 *             category_id: 2
 *             status_id: 1
 *             info_md: "### 詳細\n- 発生: 14:23\n- 影響範囲: 認証API遅延"
 *             start_at: "2025-10-26T14:23:00+09:00"
 *             end_at: "2025-10-26T16:00:00+09:00"
 *             is_hidden: false
 *     responses:
 *       201:
 *         description: 登録成功
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data: { id: 12 }
 *               error: null
 */
router.post(
  '/incidents',
  auth,
  [
    body('title').isString().isLength({ min: 1 }),
    body('category_id').isInt({ min: 1 }),
    body('status_id').isInt({ min: 1 }),
    body('info_md').optional().isString(),
    body('start_at').isISO8601(),
    body('end_at').optional({ values: 'null' }).isISO8601(),
    body('is_hidden').optional().isBoolean(),
    body('tags').optional().isArray(),
    body('tags.*').optional().isInt({ min: 1 }),
    body('discord_notify').optional(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return respond(res, false, null, errors.array(), 400);
    const { title, category_id, status_id, info_md, start_at, end_at, is_hidden = false, discord_notify } = req.body;
    const tagIds = parseTagIds(req.body.tags);
    if (!exists('categories', category_id)) return respond(res, false, null, 'カテゴリが存在しません', 400);
    if (!exists('statuses', status_id)) return respond(res, false, null, 'ステータスが存在しません', 400);
    if (!allTagsExist(tagIds)) return respond(res, false, null, '存在しないタグIDが含まれています', 400);
    try {
      const stmt = db.prepare(`
        INSERT INTO incidents (code, title, category_id, status_id, info_md, start_at, end_at, is_hidden)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(generateIncidentCode(), title, category_id, status_id, info_md, start_at, end_at, is_hidden ? 1 : 0);
      saveIncidentTags(result.lastInsertRowid, tagIds);
      const after = db.prepare('SELECT * FROM incidents WHERE id = ?').get(result.lastInsertRowid);
      writeAuditLog(req, 'create', 'incident', result.lastInsertRowid, null, after);
      if (shouldNotify(discord_notify)) {
        const incident = db.prepare('SELECT code, title FROM incidents WHERE id = ?').get(result.lastInsertRowid);
        const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '不明', color: '#6c757d' };
        await sendDiscordNotificationIncident(incident.code, incident.title, status.name, status.color);
      }
      respond(res, true, { id: result.lastInsertRowid }, null, 201);
    } catch (e) {
      respond(res, false, null, e.message, 500);
    }
  }
);
/**
 * @swagger
 * /api/incidents/{id}:
 *   put:
 *     summary: 障害情報の更新
 *     description: 既存の障害情報を更新します。is_hidden を true に設定すると一覧から非表示になります。
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           example: 3
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category_id, status_id, start_at]
 *             properties:
 *               title:
 *                 type: string
 *                 description: 障害タイトル
 *                 example: "通信障害（復旧対応中）"
 *               category_id:
 *                 type: integer
 *                 description: カテゴリID（1=ネットワーク, 2=アプリなど）
 *                 example: 1
 *               status_id:
 *                 type: integer
 *                 description: ステータスID（1=調査中, 2=対応中, 3=復旧, 4=完了）
 *                 example: 2
 *               info_md:
 *                 type: string
 *                 description: 詳細情報 (Markdown対応)
 *                 example: "更新: 状況を監視中"
 *               start_at:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-10-26T14:23:00+09:00"
 *               end_at:
 *                 type: string
 *                 format: date-time
 *                 example: null
 *               is_hidden:
 *                 type: boolean
 *                 description: 非表示フラグ（true=非公開, false=公開）
 *                 example: false
 *               tags:
 *                 type: array
 *                 items: { type: integer }
 *                 description: タグID配列
 *               discord_notify:
 *                 type: boolean
 *                 description: Discord通知を送信するか
 *     responses:
 *       200:
 *         description: 更新成功
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data: { id: 3 }
 *               error: null
 */
router.put(
  '/incidents/:id',
  auth,
  [
    param('id').isInt({ min: 1 }),
    body('title').isString().notEmpty(),
    body('category_id').isInt({ min: 1 }),
    body('status_id').isInt({ min: 1 }),
    body('info_md').optional().isString(),
    body('start_at').isISO8601(),
    body('end_at').optional({ values: 'null' }).isISO8601(),
    body('is_hidden').optional().isBoolean(),
    body('tags').optional().isArray(),
    body('tags.*').optional().isInt({ min: 1 }),
    body('discord_notify').optional(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return respond(res, false, null, errors.array(), 400);

    const { title, category_id, status_id, info_md, start_at, end_at, is_hidden = false, discord_notify } = req.body;
    const { id } = req.params;
    const tagIds = parseTagIds(req.body.tags);

    if (!exists('incidents', id)) {
      return respond(res, false, null, '指定IDの障害が存在しません', 404);
    }
    if (!exists('categories', category_id)) return respond(res, false, null, 'カテゴリが存在しません', 400);
    if (!exists('statuses', status_id)) return respond(res, false, null, 'ステータスが存在しません', 400);
    if (!allTagsExist(tagIds)) return respond(res, false, null, '存在しないタグIDが含まれています', 400);

    try {
      const before = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      db.prepare(`
        UPDATE incidents
        SET title = ?, category_id = ?, status_id = ?, info_md = ?, start_at = ?, end_at = ?, is_hidden = ?
        WHERE id = ?
      `).run(title, category_id, status_id, info_md, start_at, end_at, is_hidden ? 1 : 0, id);
      saveIncidentTags(id, tagIds);
      const after = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
      writeAuditLog(req, 'update', 'incident', id, before, after);
      if (shouldNotify(discord_notify)) {
        const incident = db.prepare('SELECT code, title FROM incidents WHERE id = ?').get(id);
        const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '不明', color: '#6c757d' };
        await sendDiscordNotificationIncident(incident.code, incident.title, status.name, status.color);
      }

      respond(res, true, { id });
    } catch (e) {
      respond(res, false, null, e.message, 500);
    }
  }
);


/**
 * @swagger
 * /api/incidents/{id}:
 *   delete:
 *     summary: 障害情報を削除
 *     tags: [Incidents]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 削除成功
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data: { id: 5 }
 *               error: null
 */
router.delete('/incidents/:id', auth, [param('id').isInt({ min: 1 })], (req, res) => {
  const { id } = req.params;
  if (!exists('incidents', id)) return respond(res, false, null, '該当データがありません', 404);
  try {
    const before = db.prepare('SELECT * FROM incidents WHERE id=?').get(id);
    db.prepare(`DELETE FROM incident_tags WHERE incident_id=?`).run(id);
    db.prepare(`DELETE FROM incidents WHERE id=?`).run(id);
    writeAuditLog(req, 'delete', 'incident', id, before, null);
    respond(res, true, { id });
  } catch (e) {
    respond(res, false, null, e.message, 500);
  }
});

//
// ==================== Maintenance API ====================
//

/**
 * @swagger
 * /api/maintenance:
 *   get:
 *     summary: メンテナンス情報一覧の取得
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: 一覧取得成功
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data:
 *                 - id: 1
 *                   code: "MTN202511010100001"
 *                   title: "夜間メンテナンス"
 *                   description: "DBスキーマ更新とバックアップ"
 *                   start_time: "2025-11-01T01:00:00+09:00"
 *                   end_time: "2025-11-01T03:00:00+09:00"
 *                   category: "システム"
 *                   status: "予定"
 *                   tags: ["OSI01"]
 *               error: null
 */
router.get('/maintenance', auth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT m.id, m.code, m.title, m.description, m.start_time, m.end_time,
             COALESCE(GROUP_CONCAT(t.name, '||'), '') AS tags_csv,
             c.name AS category, s.name AS status
      FROM maintenance_schedules m
      JOIN categories c ON m.category_id = c.id
      JOIN statuses s ON m.status_id = s.id
      LEFT JOIN maintenance_tags mt ON mt.maintenance_id = m.id
      LEFT JOIN tags t ON t.id = mt.tag_id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    `).all();
    const data = rows.map((row) => ({
      ...row,
      tags: row.tags_csv ? row.tags_csv.split('||').filter(Boolean) : [],
    })).map(({ tags_csv, ...row }) => row);
    respond(res, true, data);
  } catch (e) {
    respond(res, false, null, e.message, 500);
  }
});
/**
 * @swagger
 * /api/maintenance:
 *   post:
 *     summary: メンテナンス情報を新規登録
 *     description: 新しいメンテナンススケジュールを登録します。`is_hidden` を true にすると一覧から非表示になります。
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category_id, status_id, start_time]
 *             properties:
 *               title:
 *                 type: string
 *                 description: メンテナンスタイトル
 *                 example: "夜間メンテナンス"
 *               description:
 *                 type: string
 *                 description: メンテナンス内容の詳細
 *                 example: "バックアップおよびマイグレーションを実施します。"
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 description: 開始日時
 *                 example: "2025-11-01T01:00:00+09:00"
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 description: 終了予定日時
 *                 example: "2025-11-01T03:00:00+09:00"
 *               category_id:
 *                 type: integer
 *                 description: カテゴリID (1=ネットワーク, 2=アプリ, 3=データベース等)
 *                 example: 3
 *               status_id:
 *                 type: integer
 *                 description: ステータスID (1=予定, 2=実施中, 3=完了)
 *                 example: 1
 *               is_hidden:
 *                 type: boolean
 *                 description: 非表示フラグ（true=非公開, false=公開）
 *                 example: false
 *               tags:
 *                 type: array
 *                 items: { type: integer }
 *                 description: タグID配列
 *               discord_notify:
 *                 type: boolean
 *                 description: Discord通知を送信するか
 *           example:
 *             title: "夜間メンテナンス"
 *             description: "バックアップおよびマイグレーション実施"
 *             start_time: "2025-11-01T01:00:00+09:00"
 *             end_time: "2025-11-01T03:00:00+09:00"
 *             category_id: 3
 *             status_id: 1
 *             is_hidden: false
 *     responses:
 *       201:
 *         description: 登録成功
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data: { id: 7 }
 *               error: null
 */
router.post(
  '/maintenance',
  auth,
  [
    body('title').isString().isLength({ min: 1 }),
    body('category_id').isInt({ min: 1 }),
    body('status_id').isInt({ min: 1 }),
    body('description').optional().isString(),
    body('start_time').isISO8601(),
    body('end_time').optional({ values: 'null' }).isISO8601(),
    body('is_hidden').optional().isBoolean(),
    body('tags').optional().isArray(),
    body('tags.*').optional().isInt({ min: 1 }),
    body('discord_notify').optional(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return respond(res, false, null, errors.array(), 400);

    const {
      title,
      category_id,
      status_id,
      description,
      start_time,
      end_time,
      is_hidden = false,
      discord_notify,
    } = req.body;
    const tagIds = parseTagIds(req.body.tags);

    if (!exists('categories', category_id))
      return respond(res, false, null, 'カテゴリが存在しません', 400);
    if (!exists('statuses', status_id))
      return respond(res, false, null, 'ステータスが存在しません', 400);
    if (!allTagsExist(tagIds))
      return respond(res, false, null, '存在しないタグIDが含まれています', 400);

    try {
      const stmt = db.prepare(`
        INSERT INTO maintenance_schedules
        (code, title, category_id, status_id, description, start_time, end_time, is_hidden)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        generateMaintenanceCode(),
        title,
        category_id,
        status_id,
        description,
        start_time,
        end_time,
        is_hidden ? 1 : 0
      );
      saveMaintenanceTags(result.lastInsertRowid, tagIds);
      const after = db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(result.lastInsertRowid);
      writeAuditLog(req, 'create', 'maintenance', result.lastInsertRowid, null, after);
      if (shouldNotify(discord_notify)) {
        const maintenance = db.prepare('SELECT title, start_time, end_time FROM maintenance_schedules WHERE id = ?').get(result.lastInsertRowid);
        const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '予定', color: '#6c757d' };
        await sendDiscordNotificationMaintenance(maintenance.title, maintenance.start_time, maintenance.end_time, status.name, status.color);
      }

      respond(res, true, { id: result.lastInsertRowid }, null, 201);
    } catch (e) {
      respond(res, false, null, e.message, 500);
    }
  }
);
/**
 * @swagger
 * /api/maintenance/{id}:
 *   put:
 *     summary: メンテナンス情報を更新
 *     description: 既存のメンテナンス情報を更新します。`is_hidden` を true にすると一覧から非表示になります。
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           example: 7
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category_id, status_id, start_time]
 *             properties:
 *               title:
 *                 type: string
 *                 description: メンテナンスタイトル
 *                 example: "夜間メンテナンス（再実施）"
 *               description:
 *                 type: string
 *                 description: 詳細内容 (Markdown可)
 *                 example: "DB負荷対策を追加しました。"
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 description: 開始日時
 *                 example: "2025-11-05T01:00:00+09:00"
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 description: 終了日時
 *                 example: "2025-11-05T02:30:00+09:00"
 *               category_id:
 *                 type: integer
 *                 description: カテゴリID (1=ネットワーク, 2=アプリ, 3=DB)
 *                 example: 2
 *               status_id:
 *                 type: integer
 *                 description: ステータスID (1=予定, 2=実施中, 3=完了)
 *                 example: 2
 *               is_hidden:
 *                 type: boolean
 *                 description: 非表示フラグ（true=非公開, false=公開）
 *                 example: false
 *               tags:
 *                 type: array
 *                 items: { type: integer }
 *                 description: タグID配列
 *               discord_notify:
 *                 type: boolean
 *                 description: Discord通知を送信するか
 *           example:
 *             title: "夜間メンテナンス（再実施）"
 *             description: "DB負荷対策を追加"
 *             start_time: "2025-11-05T01:00:00+09:00"
 *             end_time: "2025-11-05T02:30:00+09:00"
 *             category_id: 2
 *             status_id: 2
 *             is_hidden: false
 *     responses:
 *       200:
 *         description: 更新成功
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data: { id: 7 }
 *               error: null
 */
router.put(
  '/maintenance/:id',
  auth,
  [
    param('id').isInt({ min: 1 }),
    body('title').isString().notEmpty(),
    body('category_id').isInt({ min: 1 }),
    body('status_id').isInt({ min: 1 }),
    body('description').optional().isString(),
    body('start_time').isISO8601(),
    body('end_time').optional({ values: 'null' }).isISO8601(),
    body('is_hidden').optional().isBoolean(),
    body('tags').optional().isArray(),
    body('tags.*').optional().isInt({ min: 1 }),
    body('discord_notify').optional(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return respond(res, false, null, errors.array(), 400);

    const { id } = req.params;
    const { title, category_id, status_id, description, start_time, end_time, is_hidden = false, discord_notify } = req.body;
    const tagIds = parseTagIds(req.body.tags);

    if (!exists('maintenance_schedules', id))
      return respond(res, false, null, '指定IDのメンテナンスが存在しません', 404);
    if (!exists('categories', category_id))
      return respond(res, false, null, 'カテゴリが存在しません', 400);
    if (!exists('statuses', status_id))
      return respond(res, false, null, 'ステータスが存在しません', 400);
    if (!allTagsExist(tagIds))
      return respond(res, false, null, '存在しないタグIDが含まれています', 400);

    try {
      const before = db.prepare('SELECT * FROM maintenance_schedules WHERE id=?').get(id);
      db.prepare(`
        UPDATE maintenance_schedules
        SET title=?, category_id=?, status_id=?, description=?, start_time=?, end_time=?, is_hidden=?
        WHERE id=?
      `).run(title, category_id, status_id, description, start_time, end_time, is_hidden ? 1 : 0, id);
      saveMaintenanceTags(id, tagIds);
      const after = db.prepare('SELECT * FROM maintenance_schedules WHERE id=?').get(id);
      writeAuditLog(req, 'update', 'maintenance', id, before, after);
      if (shouldNotify(discord_notify)) {
        const maintenance = db.prepare('SELECT title, start_time, end_time FROM maintenance_schedules WHERE id = ?').get(id);
        const status = db.prepare('SELECT name, color FROM statuses WHERE id = ?').get(status_id) || { name: '予定', color: '#6c757d' };
        await sendDiscordNotificationMaintenance(maintenance.title, maintenance.start_time, maintenance.end_time, status.name, status.color);
      }

      respond(res, true, { id });
    } catch (e) {
      respond(res, false, null, e.message, 500);
    }
  }
);


/**
 * @swagger
 * /api/maintenance/{id}:
 *   delete:
 *     summary: メンテナンス情報を削除
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: 削除成功
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               data: { id: 9 }
 *               error: null
 */
router.delete('/maintenance/:id', auth, [param('id').isInt({ min: 1 })], (req, res) => {
  const { id } = req.params;
  if (!exists('maintenance_schedules', id))
    return respond(res, false, null, '該当データがありません', 404);
  try {
    const before = db.prepare('SELECT * FROM maintenance_schedules WHERE id=?').get(id);
    db.prepare(`DELETE FROM maintenance_tags WHERE maintenance_id=?`).run(id);
    db.prepare(`DELETE FROM maintenance_schedules WHERE id=?`).run(id);
    writeAuditLog(req, 'delete', 'maintenance', id, before, null);
    respond(res, true, { id });
  } catch (e) {
    respond(res, false, null, e.message, 500);
  }
});

module.exports = router;
