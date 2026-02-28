# REQUIREMENT

本書は `service-outage-notify` の現行実装をもとに、機能要件を整理したものです。

## 1. 目的

- 通信設備に関する障害情報・計画メンテナンス情報を利用者へ迅速に公開する。
- 運用担当者が Web 管理画面または API から情報を登録・更新できるようにする。

## 2. 利用者ロール

- 公開閲覧者: 公開ページで障害/メンテ情報を参照する。
- 管理者: 管理画面で障害・メンテ・マスタを管理する。
- 外部システム: API キーまたは JWT で API を実行する。

## 3. 機能要件

### FR-01 認証

- 管理画面は認証必須とする。
- ログインは `ADMIN_USER` / `ADMIN_PASS` で判定する。
- 認証成功時は JWT を Cookie に保存し、有効期限は1時間とする。
- API は以下のいずれかで認証可能とする。
- `x-api-key` ヘッダー
- `Authorization: Bearer <JWT>` ヘッダー

### FR-02 障害情報管理（管理画面）

- 障害情報の一覧表示、登録、編集、削除、表示/非表示切替を提供する。
- 項目は少なくとも以下を持つ。
- 管理番号（自動生成）
- 案件名
- カテゴリ
- ステータス
- 詳細情報（Markdown）
- 開始日時 / 終了日時
- タグ（複数）
- 登録/編集時に Discord 通知の有無を選択できる。

### FR-03 メンテナンス情報管理（管理画面）

- メンテナンス情報の一覧表示、登録、編集、削除、表示/非表示切替を提供する。
- 項目は少なくとも以下を持つ。
- タイトル
- カテゴリ
- ステータス
- 内容（Markdown）
- 開始日時 / 終了日時
- タグ（複数）
- 登録/編集時に Discord 通知の有無を選択できる。

### FR-04 公開ページ

- 障害情報タブ・メンテナンス情報タブを表示できる。
- 非表示フラグの立った情報は表示しない。
- 詳細情報は Markdown を HTML 変換して表示する（サニタイズ必須）。
- 以下の絞り込み機能を提供する。
- フリーワード検索
- ステータス（複数選択）
- カテゴリ（複数選択）
- タグ（複数選択）
- 詳細モーダル表示を提供する。
- 自動更新間隔を選択でき、手動更新もできる。
- URL ハッシュ `#maintenance` でメンテナンスタブを初期選択できる。

### FR-05 マスタ管理

- カテゴリ、ステータス、タグの一覧表示・追加・編集・削除を提供する。
- 参照中のマスタは削除不可とする（少なくとも incidents 参照をチェック）。

### FR-06 API（障害情報）

- `GET /api/incidents`: 一覧取得
- `POST /api/incidents`: 新規登録
- `PUT /api/incidents/:id`: 更新
- `DELETE /api/incidents/:id`: 削除
- 入力バリデーション（型・必須・ID妥当性）を実施する。
- レスポンスは `{ success, data, error }` 形式とする。

### FR-07 API（メンテナンス情報）

- `GET /api/maintenance`: 一覧取得
- `POST /api/maintenance`: 新規登録
- `PUT /api/maintenance/:id`: 更新
- `DELETE /api/maintenance/:id`: 削除
- 入力バリデーション（型・必須・ID妥当性）を実施する。
- レスポンスは `{ success, data, error }` 形式とする。

### FR-08 通知

- 管理画面の登録/編集時、通知指定がある場合のみ Discord Webhook 通知を送る。
- 通知本文にはタイトル、期間、ステータス、公開ページ導線を含む。

### FR-09 APIドキュメント

- `GET /api-docs` で Swagger UI を提供する。
- API 仕様（認証方式・入出力例）を閲覧可能にする。

## 4. データ要件

- SQLite を使用し、起動時に必要テーブルを自動作成する。
- 主要テーブルは以下。
- `incidents`
- `maintenance_schedules`
- `categories`
- `statuses`
- `tags`
- `incident_tags`
- `maintenance_tags`
- `incidents.code` は一意制約を持つ。
- `is_hidden` は公開可否フラグとして扱う。

## 5. 非機能要件

- 実行環境は Node.js 20 系を前提とする（Dockerfile 準拠）。
- 公開画面は PC/モバイル双方で閲覧可能なレスポンシブ UI とする。
- API/管理画面は未認証アクセスを拒否する。
- ログイン用トークンは `httpOnly` Cookie を使用する。

## 6. 現実装ベースの補足事項

- ステータス色は DB `statuses.color` ではなくアプリ内固定マッピングを使用している。
- 管理番号生成フォーマットは障害/メンテナンスともに管理画面と API で統一済み（障害: `INC-YYYYMMDDHHMMNNN`、メンテナンス: `MTN-YYYYMMDDHHMMNNN`）。
- マスタ削除時の参照チェックは incidents 系に加えて maintenance 側参照（`maintenance_schedules` / `maintenance_tags`）も対象としている。
- 初期マスタデータ投入機能はないため、初回起動後に管理画面から登録が必要。
