// middleware/auth.js
const jwt = require('jsonwebtoken');

module.exports = function (req, res, next) {
  // --- 1️⃣ APIキー認証チェック ---
  const apiKey = process.env.API_KEY;
  const headerApiKey = req.header('x-api-key');
  const queryApiKey = req.query.api_key;

  if (apiKey && (headerApiKey === apiKey || queryApiKey === apiKey)) {
    // APIキー一致 → 認証成功（ユーザー情報は空のシステムアカウント扱い）
    req.user = { role: 'system', method: 'api_key' };
    return next();
  }

  // --- 2️⃣ JWTトークン（Cookie or Authorizationヘッダー）チェック ---
  const token =
    req.cookies.token ||
    req.header('Authorization')?.replace('Bearer ', '');

  if (!token) return res.status(401).send('Unauthorized');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).send('Forbidden');
  }
};
