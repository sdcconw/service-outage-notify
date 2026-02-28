// SQLite schema bootstrap and lightweight migrations run on service startup.
// This module also creates indexes, FTS tables/triggers, and one-time backfills.
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
db.exec('CREATE INDEX IF NOT EXISTS idx_incidents_visibility_created ON incidents(is_hidden, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_visibility_created ON maintenance_schedules(is_hidden, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_schedules(status_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_category ON maintenance_schedules(category_id)');

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
db.exec('CREATE INDEX IF NOT EXISTS idx_incident_tags_incident ON incident_tags(incident_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_incident_tags_tag ON incident_tags(tag_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_tags_pair_unique ON incident_tags(incident_id, tag_id)');

db.exec(`
  CREATE TABLE IF NOT EXISTS maintenance_tags (
    maintenance_id INTEGER,
    tag_id INTEGER
  );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_tags_maintenance ON maintenance_tags(maintenance_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_maintenance_tags_tag ON maintenance_tags(tag_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_tags_pair_unique ON maintenance_tags(maintenance_id, tag_id)');

// categories テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name)');

// statuses テーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    color TEXT
  );
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_statuses_name ON statuses(name)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)');

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

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS incidents_fts
  USING fts5(title, info_md, tokenize='unicode61');
`);
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS maintenance_fts
  USING fts5(title, description, tokenize='unicode61');
`);

db.exec('DROP TRIGGER IF EXISTS incidents_ai');
db.exec('DROP TRIGGER IF EXISTS incidents_au');
db.exec('DROP TRIGGER IF EXISTS incidents_ad');
db.exec('DROP TRIGGER IF EXISTS maintenance_ai');
db.exec('DROP TRIGGER IF EXISTS maintenance_au');
db.exec('DROP TRIGGER IF EXISTS maintenance_ad');

db.exec(`
  CREATE TRIGGER incidents_ai AFTER INSERT ON incidents BEGIN
    INSERT INTO incidents_fts(rowid, title, info_md)
    VALUES (new.id, IFNULL(new.title, ''), IFNULL(new.info_md, ''));
  END;
`);
db.exec(`
  CREATE TRIGGER incidents_au AFTER UPDATE ON incidents BEGIN
    DELETE FROM incidents_fts WHERE rowid = old.id;
    INSERT INTO incidents_fts(rowid, title, info_md)
    VALUES (new.id, IFNULL(new.title, ''), IFNULL(new.info_md, ''));
  END;
`);
db.exec(`
  CREATE TRIGGER incidents_ad AFTER DELETE ON incidents BEGIN
    DELETE FROM incidents_fts WHERE rowid = old.id;
  END;
`);

db.exec(`
  CREATE TRIGGER maintenance_ai AFTER INSERT ON maintenance_schedules BEGIN
    INSERT INTO maintenance_fts(rowid, title, description)
    VALUES (new.id, IFNULL(new.title, ''), IFNULL(new.description, ''));
  END;
`);
db.exec(`
  CREATE TRIGGER maintenance_au AFTER UPDATE ON maintenance_schedules BEGIN
    DELETE FROM maintenance_fts WHERE rowid = old.id;
    INSERT INTO maintenance_fts(rowid, title, description)
    VALUES (new.id, IFNULL(new.title, ''), IFNULL(new.description, ''));
  END;
`);
db.exec(`
  CREATE TRIGGER maintenance_ad AFTER DELETE ON maintenance_schedules BEGIN
    DELETE FROM maintenance_fts WHERE rowid = old.id;
  END;
`);

function syncFtsTable(ftsTableName, sourceTableName, columns) {
  const ftsCount = db.prepare(`SELECT COUNT(*) AS cnt FROM ${ftsTableName}`).get().cnt;
  const srcCount = db.prepare(`SELECT COUNT(*) AS cnt FROM ${sourceTableName}`).get().cnt;
  if (ftsCount === srcCount) return;
  const cols = columns.join(', ');
  db.exec(`DELETE FROM ${ftsTableName};`);
  db.exec(`
    INSERT INTO ${ftsTableName}(rowid, ${cols})
    SELECT id, ${columns.map((c) => `IFNULL(${c}, '')`).join(', ')}
    FROM ${sourceTableName};
  `);
}

syncFtsTable('incidents_fts', 'incidents', ['title', 'info_md']);
syncFtsTable('maintenance_fts', 'maintenance_schedules', ['title', 'description']);

module.exports = db;
