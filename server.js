const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const app = express();
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('./models/db');

// view設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ミドルウェア設定
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ルーティング
app.use('/', require('./routes/public'));
app.use('/admin', require('./routes/admin'));
app.use('/admin/settings', require('./routes/settings'));
app.use('/api', require('./routes/api'));

// ログイン処理
app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASS
  ) {
    const token = jwt.sign({ user: username }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.cookie('token', token, { httpOnly: true });
    res.redirect('/admin');
  } else {
    res.status(401).send('ログイン失敗');
  }
});

// Swagger UI
const { swaggerUi, specs } = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// サーバ起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
