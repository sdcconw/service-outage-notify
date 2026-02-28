# Service Outage Notify

通信設備の障害情報と計画メンテナンス情報を公開・管理する Node.js + Express 製アプリケーションです。  
公開画面（利用者向け）と管理画面（運用者向け）、および外部連携用 API を提供します。

## 主な機能

- 障害情報の登録・編集・削除・公開/非公開切替
- メンテナンス情報の登録・編集・削除・公開/非公開切替
- カテゴリ・ステータス・タグのマスタ管理
- 公開ページでの検索・複数条件フィルタ・タブ切替（障害/メンテ）
- Markdown 本文の表示（公開画面側でサニタイズ）
- 管理画面からの Discord Webhook 通知（任意）
- JWT / APIキー認証付き REST API
- Swagger UI による API ドキュメント表示

## 技術スタック

- Node.js / Express
- EJS (テンプレート)
- SQLite (`better-sqlite3`)
- Swagger (`swagger-jsdoc`, `swagger-ui-express`)

## ディレクトリ構成（主要）

- `server.js`: エントリポイント
- `models/db.js`: SQLite テーブル初期化
- `routes/public.js`: 公開画面
- `routes/admin.js`: 管理画面（障害/メンテ）
- `routes/settings.js`: マスタ管理画面
- `routes/api.js`: REST API
- `middleware/auth.js`: APIキー/JWT 認証
- `views/*.ejs`: 画面テンプレート
- `swagger.js`: Swagger 設定

## セットアップ

### 1. 依存関係インストール

```bash
npm install
```

### 2. 環境変数設定

`.env.example` をコピーして `.env` を作成し、最低限以下を設定してください。

```env
ADMIN_USER=admin
ADMIN_PASS=strong-password
JWT_SECRET=your-jwt-secret
API_KEY=your-api-key
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
PORT=3000
```

- `DISCORD_WEBHOOK_URL` は未設定でも動作します（通知のみ無効）。
- `PORT` は未設定時 `3000` です。

### 3. 起動

```bash
npm start
```

起動後、`http://localhost:3000` にアクセスしてください。

## 画面 URL

- 公開ページ: `GET /`
- ログイン: `GET /login`
- 管理画面（障害）: `GET /admin/incidents`
- 管理画面（メンテ）: `GET /admin/maintenance`
- 設定管理: `GET /admin/settings`
- APIドキュメント: `GET /api-docs`

## 認証仕様

### 管理画面

- `POST /login` で `ADMIN_USER` / `ADMIN_PASS` を検証
- 成功時に JWT を `token` Cookie（`httpOnly`）へ保存
- 有効期限: 1時間

### API

以下のいずれかで認証できます。

- `x-api-key: <API_KEY>` ヘッダー（または `?api_key=` クエリ）
- `Authorization: Bearer <JWT>`

## API エンドポイント（実装済み）

### Incidents

- `GET /api/incidents`
- `POST /api/incidents`
- `PUT /api/incidents/:id`
- `DELETE /api/incidents/:id`

### Maintenance

- `GET /api/maintenance`
- `POST /api/maintenance`
- `PUT /api/maintenance/:id`
- `DELETE /api/maintenance/:id`

## 初期データと運用上の注意

- SQLite DB は `./db/database.db` に作成されます。
- `categories` / `statuses` / `tags` の初期データ投入処理はないため、管理画面の「設定管理」から先に登録してください。
- 表示中のステータス色はマスタの `statuses.color` ではなく、コード内の固定マッピングで決定されます。

## Docker

```bash
docker build -t service-outage-notify .
docker run --rm -p 3000:3000 --env-file .env service-outage-notify
```

## ライセンス

`LICENSE` を参照してください。
