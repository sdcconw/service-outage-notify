const express = require('express');
const router = express.Router();
const db = require('../models/db');
const auth = require('../middleware/auth');

/**
 * @swagger
 * /api/incidents:
 *   get:
 *     summary: 障害一覧を取得
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功時、障害一覧を返す
 */
router.get('/incidents', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.code, i.title, i.info_md, i.start_at, i.end_at,
           c.name as category, s.name as status
    FROM incidents i
    JOIN categories c ON i.category_id = c.id
    JOIN statuses s ON i.status_id = s.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(rows);
});

/**
 * @swagger
 * /api/incidents:
 *   post:
 *     summary: 障害を新規登録
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category_id, status_id]
 *             properties:
 *               title: { type: string }
 *               category_id: { type: integer }
 *               status_id: { type: integer }
 *               info_md: { type: string }
 *               start_at: { type: string, format: date-time }
 *               end_at: { type: string, format: date-time }
 *     responses:
 *       201: { description: 登録成功 }
 */
router.post('/incidents', auth, (req, res) => {
  const { title, category_id, status_id, info_md, start_at, end_at } = req.body;
  if (!title || !category_id || !status_id) {
    return res.status(400).json({ error: "必須項目が不足しています。" });
  }
  const stmt = db.prepare(`
    INSERT INTO incidents (code, title, category_id, status_id, info_md, start_at, end_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(generateCode(), title, category_id, status_id, info_md, start_at, end_at);
  res.status(201).json({ success: true, id: result.lastInsertRowid });
});

/**
 * @swagger
 * /api/incidents/{id}:
 *   put:
 *     summary: 障害情報を更新
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, category_id, status_id]
 *             properties:
 *               title: { type: string }
 *               category_id: { type: integer }
 *               status_id: { type: integer }
 *               info_md: { type: string }
 *               start_at: { type: string, format: date-time }
 *               end_at: { type: string, format: date-time }
 *     responses:
 *       200: { description: 更新成功 }
 */
router.put('/incidents/:id', auth, (req, res) => {
  const { title, category_id, status_id, info_md, start_at, end_at } = req.body;
  db.prepare(`
    UPDATE incidents
    SET title = ?, category_id = ?, status_id = ?, info_md = ?, start_at = ?, end_at = ?
    WHERE id = ?
  `).run(title, category_id, status_id, info_md, start_at, end_at, req.params.id);
  res.json({ success: true });
});

/**
 * @swagger
 * /api/incidents/{id}:
 *   delete:
 *     summary: 障害を削除
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: 削除成功 }
 */
router.delete('/incidents/:id', auth, (req, res) => {
  db.prepare("DELETE FROM incidents WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

function generateCode() {
  const now = new Date();
  const date = now.toISOString().slice(0,10).replace(/-/g, '');
  const time = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0');
  const todayCount = db.prepare("SELECT COUNT(*) as cnt FROM incidents WHERE substr(created_at, 1, 10) = date('now')").get().cnt;
  const count = (todayCount + 1).toString().padStart(3, '0');
  return date + time + count;
}

module.exports = router;
