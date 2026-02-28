const db = require('./db');

function safeStringify(value) {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

function writeAuditLog(req, action, entityType, entityId, beforeData, afterData) {
  const actor = req.user?.user || req.user?.role || 'unknown';
  const authMethod = req.user?.method || 'jwt';

  db.prepare(`
    INSERT INTO audit_logs
    (actor, auth_method, action, entity_type, entity_id, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    actor,
    authMethod,
    action,
    entityType,
    String(entityId ?? ''),
    safeStringify(beforeData),
    safeStringify(afterData)
  );
}

module.exports = { writeAuditLog };
