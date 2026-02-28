const Database = require('better-sqlite3');
const db = new Database('./db/database.db');

// incidents テーブル（障害情報）
db.exec(`
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    category_id INTEGER,
    status_id INTEGER,
    info_md TEXT,
    code TEXT UNIQUE,
    start_at DATETIME,
    end_at DATETIME,
    is_hidden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// maintenance_schedules（計画メンテナンス）
db.exec(`
  CREATE TABLE IF NOT EXISTS maintenance_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT,
    title TEXT NOT NULL,
    category_id INTEGER,
    status_id INTEGER,
    description TEXT,
    service_name TEXT,
    start_time DATETIME,
    end_time DATETIME,
    status TEXT DEFAULT '計画済',
    is_hidden INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

function hasColumn(tableName, columnName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((col) => col.name === columnName);
}

if (!hasColumn('incidents', 'code')) {
  db.exec('ALTER TABLE incidents ADD COLUMN code TEXT');
}

if (!hasColumn('maintenance_schedules', 'code')) {
  db.exec('ALTER TABLE maintenance_schedules ADD COLUMN code TEXT');
}

db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_code_unique ON incidents(code)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_code_unique ON maintenance_schedules(code)');

function formatCodeDateTime(dateValue) {
  const d = dateValue ? new Date(dateValue) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const yyyy = safe.getFullYear();
  const mm = String(safe.getMonth() + 1).padStart(2, '0');
  const dd = String(safe.getDate()).padStart(2, '0');
  const hh = String(safe.getHours()).padStart(2, '0');
  const mi = String(safe.getMinutes()).padStart(2, '0');
  return { ymd: `${yyyy}${mm}${dd}`, hhmm: `${hh}${mi}` };
}

const missingMaintenanceCodes = db.prepare(`
  SELECT id, created_at
  FROM maintenance_schedules
  WHERE code IS NULL OR code = ''
  ORDER BY datetime(created_at) ASC, id ASC
`).all();

if (missingMaintenanceCodes.length > 0) {
  const seqByDay = new Map();
  const updateCode = db.prepare('UPDATE maintenance_schedules SET code = ? WHERE id = ?');
  const tx = db.transaction((rows) => {
    rows.forEach((row) => {
      const parts = formatCodeDateTime(row.created_at);
      const current = seqByDay.get(parts.ymd) || 0;
      const next = current + 1;
      seqByDay.set(parts.ymd, next);
      const code = `MTN${parts.ymd}${parts.hhmm}${String(next).padStart(3, '0')}`;
      updateCode.run(code, row.id);
    });
  });
  tx(missingMaintenanceCodes);
}

// tags テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  );
`);

// incident_tags 中間テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS incident_tags (
    incident_id INTEGER,
    tag_id INTEGER
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS maintenance_tags (
    maintenance_id INTEGER,
    tag_id INTEGER
  );
`);

// categories テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  );
`);

// statuses テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    color TEXT
  );
`);

// audit_logs テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT,
    auth_method TEXT,
    action TEXT,
    entity_type TEXT,
    entity_id TEXT,
    before_json TEXT,
    after_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;
