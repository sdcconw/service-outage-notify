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

module.exports = db;