function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function toInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function createInMemoryRateLimiter(options = {}) {
  const enabled = toBool(options.enabled, true);
  const windowMs = toInt(options.windowMs, 60 * 1000);
  const maxRequests = toInt(options.maxRequests, 120);
  const message = options.message || 'Too many requests. Please try again later.';
  const statusCode = toInt(options.statusCode, 429);
  const keyGenerator = options.keyGenerator || ((req) => req.ip || 'unknown');
  const skip = options.skip || (() => false);

  const buckets = new Map();

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (now - bucket.windowStart >= windowMs) {
        buckets.delete(key);
      }
    }
  }, Math.max(30 * 1000, windowMs));
  cleanupTimer.unref();

  return function rateLimiter(req, res, next) {
    if (!enabled || skip(req)) return next();

    const now = Date.now();
    const key = keyGenerator(req);
    const current = buckets.get(key);

    if (!current || now - current.windowStart >= windowMs) {
      buckets.set(key, { windowStart: now, count: 1 });
      return next();
    }

    current.count += 1;
    if (current.count <= maxRequests) {
      return next();
    }

    const retryAfterSec = Math.ceil((windowMs - (now - current.windowStart)) / 1000);
    res.set('Retry-After', String(Math.max(retryAfterSec, 1)));
    return res.status(statusCode).send(message);
  };
}

module.exports = {
  createInMemoryRateLimiter,
};
