const crypto = require('crypto');

const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : true;
const cookieSameSite = process.env.COOKIE_SAMESITE || 'lax';

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeEquals(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function ensureCsrfToken(req, res, next) {
  let token = req.cookies.csrf_token;

  if (!token) {
    token = createToken();
    res.cookie('csrf_token', token, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
    });
  }

  res.locals.csrfToken = token;
  next();
}

function verifyCsrfToken(req, res, next) {
  const cookieToken = req.cookies.csrf_token;
  const requestToken = req.body?._csrf || req.header('x-csrf-token');

  if (!cookieToken || !requestToken || !timingSafeEquals(cookieToken, requestToken)) {
    return res.status(403).send('Invalid CSRF token');
  }

  next();
}

module.exports = {
  ensureCsrfToken,
  verifyCsrfToken,
};
