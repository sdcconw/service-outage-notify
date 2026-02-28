// Auth middleware for Admin UI (JWT only) and API (API key or JWT).
const jwt = require('jsonwebtoken');

function extractBearerToken(req) {
  return req.header('Authorization')?.replace('Bearer ', '');
}

function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function requireAdminAuth(req, res, next) {
  const token = req.cookies.token || extractBearerToken(req);
  if (!token) return res.status(401).send('Unauthorized');

  try {
    req.user = verifyJwt(token);
    return next();
  } catch (err) {
    return res.status(403).send('Forbidden');
  }
}

function requireApiAuth(req, res, next) {
  const apiKey = process.env.API_KEY;
  const headerApiKey = req.header('x-api-key');

  if (apiKey && headerApiKey === apiKey) {
    req.user = { role: 'system', method: 'api_key' };
    return next();
  }

  const token = req.cookies.token || extractBearerToken(req);
  if (!token) return res.status(401).send('Unauthorized');

  try {
    req.user = verifyJwt(token);
    return next();
  } catch (err) {
    return res.status(403).send('Forbidden');
  }
}

module.exports = {
  requireAdminAuth,
  requireApiAuth,
};
