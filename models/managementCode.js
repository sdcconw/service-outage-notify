const db = require('./db');

const TABLES = {
  incident: 'incidents',
  maintenance: 'maintenance_schedules',
};

function formatDateParts(dateValue = new Date()) {
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date for code generation');
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return {
    ymd: `${yyyy}${mm}${dd}`,
    hhmm: `${hh}${mi}`,
  };
}

function generateSequentialCode(prefix, tableName, now = new Date()) {
  const parts = formatDateParts(now);
  const todayCount = db
    .prepare(`SELECT COUNT(*) AS cnt FROM ${tableName} WHERE date(created_at, 'localtime') = ?`)
    .get(`${parts.ymd.slice(0, 4)}-${parts.ymd.slice(4, 6)}-${parts.ymd.slice(6, 8)}`).cnt;
  return `${prefix}${parts.ymd}${parts.hhmm}${String(todayCount + 1).padStart(3, '0')}`;
}

function generateIncidentCode(now = new Date()) {
  return generateSequentialCode('INC', TABLES.incident, now);
}

function generateMaintenanceCode(now = new Date()) {
  return generateSequentialCode('MTN', TABLES.maintenance, now);
}

module.exports = {
  generateIncidentCode,
  generateMaintenanceCode,
};
