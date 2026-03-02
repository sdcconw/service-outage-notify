// Application entry point: wires middleware, auth/login, view routes, and API routes.
// Also validates required runtime environment variables before boot.
const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const app = express();
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('./models/db');
const { ensureCsrfToken, verifyCsrfToken } = require('./middleware/csrf');
const { createInMemoryRateLimiter } = require('./middleware/rateLimit');
const { requireAdminAuth } = require('./middleware/auth');

const trustProxy = Number(process.env.TRUST_PROXY || 1);
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : true;
const cookieSameSite = process.env.COOKIE_SAMESITE || 'lax';

function validateRequiredEnv() {
  const requiredVars = ['ADMIN_USER', 'ADMIN_PASS', 'JWT_SECRET', 'API_KEY'];
  const missing = requiredVars.filter((name) => {
    const value = process.env[name];
    return !value || String(value).trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

validateRequiredEnv();

function timingSafeStringEquals(a, b) {
  const hash = (v) => crypto.createHash('sha256').update(String(v || '')).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// view設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', trustProxy);

// セキュリティヘッダー
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// ミドルウェア設定
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(ensureCsrfToken);

const publicRateLimiter = createInMemoryRateLimiter({
  enabled: process.env.PUBLIC_RATE_LIMIT_ENABLED,
  windowMs: process.env.PUBLIC_RATE_LIMIT_WINDOW_MS,
  maxRequests: process.env.PUBLIC_RATE_LIMIT_MAX_REQUESTS,
  message: process.env.PUBLIC_RATE_LIMIT_MESSAGE || 'アクセスが集中しています。しばらくしてから再試行してください。',
  skip: (req) => !(req.method === 'GET' && req.path === '/'),
});
app.use(publicRateLimiter);

const loginRateLimiter = createInMemoryRateLimiter({
  enabled: process.env.LOGIN_RATE_LIMIT_ENABLED,
  windowMs: process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
  maxRequests: process.env.LOGIN_RATE_LIMIT_MAX_REQUESTS,
  message: process.env.LOGIN_RATE_LIMIT_MESSAGE || 'ログイン試行回数が上限に達しました。しばらくしてから再試行してください。',
  skip: (req) => req.method !== 'POST',
});
app.use('/login', loginRateLimiter);

const apiRateLimiter = createInMemoryRateLimiter({
  enabled: process.env.API_RATE_LIMIT_ENABLED,
  windowMs: process.env.API_RATE_LIMIT_WINDOW_MS,
  maxRequests: process.env.API_RATE_LIMIT_MAX_REQUESTS,
  message: process.env.API_RATE_LIMIT_MESSAGE || 'APIのリクエストが上限に達しました。しばらくしてから再試行してください。',
});
app.use('/api', apiRateLimiter);

// ルーティング
app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));
app.use('/admin/settings', require('./routes/settings'));
app.use('/api', require('./routes/api'));

// ログイン処理
app.get('/login', (req, res) => res.render('login'));
app.post('/login', verifyCsrfToken, (req, res) => {
  const { username, password } = req.body;
  if (
    timingSafeStringEquals(username, process.env.ADMIN_USER) &&
    timingSafeStringEquals(password, process.env.ADMIN_PASS)
  ) {
    const token = jwt.sign({ user: username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: cookieSameSite,
      secure: cookieSecure,
    });
    res.redirect('/admin');
  } else {
    res.status(401).send('ログイン失敗');
  }
});

// Swagger UI
const { swaggerUi, specs } = require('./swagger');
app.use('/api-docs', apiRateLimiter, requireAdminAuth, swaggerUi.serve, swaggerUi.setup(specs));

// サーバ起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
