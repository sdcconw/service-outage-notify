// Public-facing status page routes: list/filter incidents and maintenance.
// Markdown content is sanitized before rendering.
const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const marked = require('marked');
const { resolveStatusColor } = require('../models/statusColor');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const QUERY_CACHE_ENABLED = String(process.env.PUBLIC_QUERY_CACHE_ENABLED || 'true').toLowerCase() === 'true';
const QUERY_CACHE_TTL_MS = Number.parseInt(process.env.PUBLIC_QUERY_CACHE_TTL_MS || '15000', 10);
const SEARCH_USE_FTS = String(process.env.PUBLIC_SEARCH_USE_FTS || 'true').toLowerCase() === 'true';

const queryHtmlCache = new Map();

function cacheCleanup() {
  if (!QUERY_CACHE_ENABLED) return;
  const now = Date.now();
  for (const [key, item] of queryHtmlCache.entries()) {
    if (item.expiresAt <= now) queryHtmlCache.delete(key);
  }
}

setInterval(cacheCleanup, Math.max(30 * 1000, QUERY_CACHE_TTL_MS)).unref();

function convertMarkdownToSafeHtml(mdText) {
  const dirty = marked.parse(mdText || '');
  return DOMPurify.sanitize(dirty);
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

function parseArrayParam(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
  return [];
}

function parsePositiveInt(value, defaultValue) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return parsed;
}

function parseFilters(query) {
  const pageSizeInput = parsePositiveInt(query.page_size, 20);
  return {
    q: String(query.q || '').trim(),
    statuses: parseArrayParam(query.statuses),
    categories: parseArrayParam(query.categories),
    tags: parseArrayParam(query.tags),
    tab: query.tab === 'maintenance' ? 'maintenance' : 'incidents',
    incPage: parsePositiveInt(query.inc_page, 1),
    mtPage: parsePositiveInt(query.mt_page, 1),
    pageSize: PAGE_SIZE_OPTIONS.includes(pageSizeInput) ? pageSizeInput : 20,
  };
}

function buildLikeKeyword(keyword) {
  return `%${keyword.replace(/[%_]/g, '\\$&')}%`;
}

function buildFtsMatch(keyword) {
  const tokens = keyword
    .split(/\s+/)
    .map((t) => t.trim().replace(/"/g, ''))
    .filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' AND ');
}

function buildIncidentWhere(filters) {
  const where = ['i.is_hidden = 0'];
  const params = [];

  if (filters.q) {
    const like = buildLikeKeyword(filters.q);
    const ftsMatch = SEARCH_USE_FTS ? buildFtsMatch(filters.q) : null;
    where.push(`(
      IFNULL(i.code, '') LIKE ? ESCAPE '\\'
      OR c.name LIKE ? ESCAPE '\\'
      OR s.name LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM incident_tags it2
        JOIN tags t2 ON t2.id = it2.tag_id
        WHERE it2.incident_id = i.id
          AND t2.name LIKE ? ESCAPE '\\'
      )
      ${ftsMatch ? 'OR EXISTS (SELECT 1 FROM incidents_fts f WHERE f.rowid = i.id AND incidents_fts MATCH ?)' : ''}
    )`);
    params.push(like, like, like, like);
    if (ftsMatch) params.push(ftsMatch);
  }

  if (filters.statuses.length > 0) {
    where.push(`s.name IN (${filters.statuses.map(() => '?').join(',')})`);
    params.push(...filters.statuses);
  }

  if (filters.categories.length > 0) {
    where.push(`c.name IN (${filters.categories.map(() => '?').join(',')})`);
    params.push(...filters.categories);
  }

  if (filters.tags.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM incident_tags it3
      JOIN tags t3 ON t3.id = it3.tag_id
      WHERE it3.incident_id = i.id
        AND t3.name IN (${filters.tags.map(() => '?').join(',')})
    )`);
    params.push(...filters.tags);
  }

  return { whereSql: where.join(' AND '), params };
}

function buildMaintenanceWhere(filters) {
  const where = ['IFNULL(m.is_hidden, 0) = 0'];
  const params = [];

  if (filters.q) {
    const like = buildLikeKeyword(filters.q);
    const ftsMatch = SEARCH_USE_FTS ? buildFtsMatch(filters.q) : null;
    where.push(`(
      IFNULL(m.code, '') LIKE ? ESCAPE '\\'
      OR c.name LIKE ? ESCAPE '\\'
      OR s.name LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1 FROM maintenance_tags mt2
        JOIN tags t2 ON t2.id = mt2.tag_id
        WHERE mt2.maintenance_id = m.id
          AND t2.name LIKE ? ESCAPE '\\'
      )
      ${ftsMatch ? 'OR EXISTS (SELECT 1 FROM maintenance_fts f WHERE f.rowid = m.id AND maintenance_fts MATCH ?)' : ''}
    )`);
    params.push(like, like, like, like);
    if (ftsMatch) params.push(ftsMatch);
  }

  if (filters.statuses.length > 0) {
    where.push(`s.name IN (${filters.statuses.map(() => '?').join(',')})`);
    params.push(...filters.statuses);
  }

  if (filters.categories.length > 0) {
    where.push(`c.name IN (${filters.categories.map(() => '?').join(',')})`);
    params.push(...filters.categories);
  }

  if (filters.tags.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM maintenance_tags mt3
      JOIN tags t3 ON t3.id = mt3.tag_id
      WHERE mt3.maintenance_id = m.id
        AND t3.name IN (${filters.tags.map(() => '?').join(',')})
    )`);
    params.push(...filters.tags);
  }

  return { whereSql: where.join(' AND '), params };
}

function enrichIncidents(items) {
  const ids = items.map((i) => i.id);
  const tagMap = new Map();
  if (ids.length > 0) {
    const rows = db.prepare(`
      SELECT it.incident_id, t.name
      FROM incident_tags it
      JOIN tags t ON t.id = it.tag_id
      WHERE it.incident_id IN (${ids.map(() => '?').join(',')})
    `).all(...ids);
    rows.forEach((row) => {
      if (!tagMap.has(row.incident_id)) tagMap.set(row.incident_id, []);
      tagMap.get(row.incident_id).push(row.name);
    });
  }

  return items.map((i) => {
    const color = resolveStatusColor(i.status_color);
    return {
      ...i,
      info_html: convertMarkdownToSafeHtml(i.info_md),
      tags: tagMap.get(i.id) || [],
      status_color: color.hex,
      status_text_color: color.textColor,
      start_at_fmt: formatDateTime(i.start_at),
      end_at_fmt: i.end_at ? formatDateTime(i.end_at) : '',
    };
  });
}

function enrichMaintenances(items) {
  const ids = items.map((m) => m.id);
  const tagMap = new Map();
  if (ids.length > 0) {
    const rows = db.prepare(`
      SELECT mt.maintenance_id, t.name
      FROM maintenance_tags mt
      JOIN tags t ON t.id = mt.tag_id
      WHERE mt.maintenance_id IN (${ids.map(() => '?').join(',')})
    `).all(...ids);
    rows.forEach((row) => {
      if (!tagMap.has(row.maintenance_id)) tagMap.set(row.maintenance_id, []);
      tagMap.get(row.maintenance_id).push(row.name);
    });
  }

  return items.map((m) => {
    const color = resolveStatusColor(m.status_color);
    return {
      ...m,
      info_html: convertMarkdownToSafeHtml(m.info_md),
      tags: tagMap.get(m.id) || [],
      status_color: color.hex,
      status_text_color: color.textColor,
      start_time_fmt: formatDateTime(m.start_time),
      end_time_fmt: m.end_time ? formatDateTime(m.end_time) : '',
    };
  });
}

function paginate(totalCount, page, pageSize) {
  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
  const safePage = Math.min(Math.max(page, 1), totalPages);
  return {
    totalCount,
    totalPages,
    page: safePage,
    pageSize,
    offset: (safePage - 1) * pageSize,
  };
}

function buildActiveFilterChips(filters) {
  const chips = [];
  if (filters.q) chips.push({ type: 'q', value: filters.q, label: `キーワード: ${filters.q}` });
  filters.statuses.forEach((v) => chips.push({ type: 'statuses', value: v, label: `ステータス: ${v}` }));
  filters.categories.forEach((v) => chips.push({ type: 'categories', value: v, label: `分類: ${v}` }));
  filters.tags.forEach((v) => chips.push({ type: 'tags', value: v, label: `タグ: ${v}` }));
  return chips;
}

function buildQueryString(filters, overrides = {}) {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  merged.statuses.forEach((v) => params.append('statuses', v));
  merged.categories.forEach((v) => params.append('categories', v));
  merged.tags.forEach((v) => params.append('tags', v));
  params.set('tab', merged.tab);
  params.set('inc_page', String(merged.incPage));
  params.set('mt_page', String(merged.mtPage));
  params.set('page_size', String(merged.pageSize));
  return `?${params.toString()}`;
}

router.get('/', (req, res, next) => {
  try {
    if (QUERY_CACHE_ENABLED) {
      const key = req.originalUrl;
      const cached = queryHtmlCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return res.send(cached.html);
      }
    }

    const filters = parseFilters(req.query);

    const incidentWhere = buildIncidentWhere(filters);
    const incidentTotal = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM incidents i
      JOIN categories c ON i.category_id = c.id
      JOIN statuses s ON i.status_id = s.id
      WHERE ${incidentWhere.whereSql}
    `).get(...incidentWhere.params).cnt;
    const incidentPage = paginate(incidentTotal, filters.incPage, filters.pageSize);
    const incidentRows = db.prepare(`
      SELECT
        i.id, i.code, i.title, i.info_md, i.start_at, i.end_at,
        c.name AS category, s.name AS status, s.color AS status_color
      FROM incidents i
      JOIN categories c ON i.category_id = c.id
      JOIN statuses s ON i.status_id = s.id
      WHERE ${incidentWhere.whereSql}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT ? OFFSET ?
    `).all(...incidentWhere.params, incidentPage.pageSize, incidentPage.offset);
    const incidents = enrichIncidents(incidentRows);

    const maintenanceWhere = buildMaintenanceWhere(filters);
    const maintenanceTotal = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM maintenance_schedules m
      JOIN categories c ON m.category_id = c.id
      JOIN statuses s ON m.status_id = s.id
      WHERE ${maintenanceWhere.whereSql}
    `).get(...maintenanceWhere.params).cnt;
    const maintenancePage = paginate(maintenanceTotal, filters.mtPage, filters.pageSize);
    const maintenanceRows = db.prepare(`
      SELECT
        m.id, m.code, m.title, m.description AS info_md, m.start_time, m.end_time,
        c.name AS category, s.name AS status, s.color AS status_color
      FROM maintenance_schedules m
      JOIN categories c ON m.category_id = c.id
      JOIN statuses s ON m.status_id = s.id
      WHERE ${maintenanceWhere.whereSql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?
    `).all(...maintenanceWhere.params, maintenancePage.pageSize, maintenancePage.offset);
    const maintenance = enrichMaintenances(maintenanceRows);

    const statuses = db.prepare('SELECT name FROM statuses ORDER BY id').all();
    const categories = db.prepare('SELECT name FROM categories ORDER BY id').all();
    const tags = db.prepare('SELECT name FROM tags ORDER BY id').all();

    const latestUpdated = db.prepare(`
      SELECT MAX(ts) AS latest
      FROM (
        SELECT MAX(created_at) AS ts FROM incidents WHERE is_hidden = 0
        UNION ALL
        SELECT MAX(created_at) AS ts FROM maintenance_schedules WHERE IFNULL(is_hidden, 0) = 0
      )
    `).get().latest;

    const activeFilterChips = buildActiveFilterChips(filters);
    const queryFor = (overrides) => buildQueryString(filters, overrides);

    const locals = {
      incidents,
      maintenance,
      statuses,
      categories,
      tags,
      lastUpdatedAt: latestUpdated ? formatDateTime(latestUpdated) : '-',
      filters,
      activeFilterChips,
      pagination: {
        incidents: incidentPage,
        maintenance: maintenancePage,
      },
      queryFor,
      pageSizeOptions: PAGE_SIZE_OPTIONS,
    };

    return res.render('index', locals, (err, html) => {
      if (err) return next(err);
      if (QUERY_CACHE_ENABLED) {
        queryHtmlCache.set(req.originalUrl, {
          html,
          expiresAt: Date.now() + Math.max(1000, QUERY_CACHE_TTL_MS),
        });
      }
      return res.send(html);
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
