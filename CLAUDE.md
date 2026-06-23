# Slot — パチンコ店スロット台データ管理・分析アプリ

このファイルは Claude（および新規開発者）が本プロジェクトの全体像を素早く把握するためのリファレンス。
詳細な実装メモは各コントローラー冒頭のコメント、`PERFORMANCE_OPTIMIZATION.md` を参照。

---

## 1. プロジェクト概要

パチンコ店ごとにスロット台の日次実績データを取り込み、高設定の傾向を見つけるための分析アプリ。

- **目的**: 「どの店舗で、どんな日に、どんな台に設定が入りやすいか」を可視化・分析する
- **利用者**: 開発者本人（メイン）＋ ごく稀に1名（合計2名想定）
- **規模感**: 1ホールあたり数十〜数百台 × 日数。1年分で数万〜十数万レコード／ホール

## 2. インフラ・運用

| 項目 | 内容 |
| --- | --- |
| 本番ホスティング | Render（無料枠） |
| DB | Supabase（PostgreSQL） |
| 開発DB | SQLite（`storage/development.sqlite3`） |
| デプロイ | Kamal + Docker（`Dockerfile`, `config/deploy.yml`） |
| 制約 | Render 無料枠のメモリ上限（実質512MB）に収まる必要あり。重い集計はメモリ不足で落ちる |

## 3. 技術スタック

- Ruby 3.x / Rails 8.1
- Hotwire（Turbo, Stimulus）, ImportMap
- Propshaft（アセットパイプライン）
- Solid Queue / Solid Cache / Solid Cable（Rails 8.1 デフォルト、DB バックエンド）
- Nokogiri / HTTParty（外部サイトからのスクレイピングインポート）
- Prawn（マップPDF出力 — **廃止予定**、§10 参照）

## 4. 画面構成

ルートは `config/routes.rb` 参照。画面は大きく7種類。

| 画面 | パス | コントローラー | 概要 |
| --- | --- | --- | --- |
| ホール一覧 | `/` | `halls#index` | ホール一覧、一括インポート |
| ホール詳細／日付一覧 | `/halls/:id` | `halls#show` | 日付ごとの集計サマリと日付メモ |
| ホール作成/編集 | `/halls/new`, `/halls/:id/edit` | `halls#new/edit` | ホール基本情報の登録 |
| 日別台データ | `/halls/:hall_id/dates/:date` | `machine_data#show` | **タブ構成**: 一覧 / 機種ランキング / マップ |
| 台履歴 | `/halls/:hall_id/machines/:machine_number` | `machine_data#machine_history` | 特定台番号の過去推移 |
| フロアマップ編集 | `/halls/:hall_id/maps/...` | `hall_maps#index/new/edit` | レイアウトエディタ |
| 傾向分析 | `/halls/:id/trend_analysis` | `trend_analysis#show` | フィルター＋日別集計 |
| データ分析 | `/halls/:id/data_analysis` | `data_analysis#show` | 5種マトリクス分析 |
| データインポート | `/import` | `machine_data#import` / `batch_import` | URL指定・一括取込 |

## 5. データモデル

`app/models/` 配下。

- **Hall** — ホール（店舗）。`name`, `code`, `memo`, `data_import_url1..5`
- **MachineData** — 1日1台分の実績。`hall_id`, `date`, `machine_number`, `machine_name`, `game_count`, `difference_count`, `bb_count`, `rb_count`, `art_count`, `machine_memo`, `date_memo`
  - 全カウント=0 のレコードは「メモ専用レコード」として扱う（`memo_only_record?`）
- **HallMap** — フロアマップ。`rows`, `cols`, JSON の `layout_data`（`"行_列"` キー）と `color_settings`

## 6. コントローラー共通処理

- **`MachineDataFilterable` Concern** (`app/controllers/concerns/`)
  - `MachineDataController` / `TrendAnalysisController` で include
  - 共通: パラメータ／セッション復元、フィルター適用、日別集計、ランキング計算
  - キー名統一（2026-06リファクタリングで `total_diff`, `avg_diff`, `plus_machines` に統一）

## 7. サービス層

`app/services/`

- `MachineDataImporter` — 外部サイト（slo-navi.com 等）からのスクレイピングインポート
- `TabSeparatedDataParser` — タブ区切りテキストの手動インポート

## 8. データインポート方法

1. **URL指定インポート** — `Hall#data_import_url1..5` を起点に1日分を取得
2. **一括インポート** — 日付範囲×複数ホールを指定して連続実行（0.5秒sleepで負荷分散）
3. **手動インポート** — タブ区切りテキストを貼り付け

## 9. MCP 連携

- 外部MCPサーバー: `C:\MCP\slot\src\index.js`（**別リポジトリ**、Node.js 製）
- 接続: `.vscode/mcp.json` で stdio 経由。Supabase に直接接続して読取
- 現状機能: DB からのデータ参照（読取専用）
- 将来計画: 「設定推測のためのデータ供給関数群」を追加し、AI が傾向分析できるようにする（§11）

## 10. 廃止履歴

| 対象 | 廃止時期 | 理由 |
| --- | --- | --- |
| マップPDF出力（`export_map_pdf` ルート / `HallMapPdfService` / `prawn`・`prawn-table` gem / `hall_map_print.css` / `hall_map_pdf.js`） | 2026-06 | 実使用されておらず、Render無料枠でメモリを圧迫していたため |

## 11. 傾向分析 MCP の状況

slot-analysis MCP（別リポジトリ `C:\MCP\slot`）には現在 **29ツール** が実装されている（2026-06 に拡張14ツール追加）。

### 11.1 ツール構成
- 基本データ取得: 8ツール（halls / hall_info / machine_data 等）
- 既存設定傾向分析: 7ツール（low_diff_7day / adjacent_setting / setting_tendency 等）
- **拡張ツール Phase 1: 8ツール**（2026-06 追加・コミュニティ調査ベース）
  - `analyze_machine_number_pattern`, `analyze_cross_pattern`, `analyze_model_weekday_matrix`
  - `analyze_prev_day_minus_pattern`, `analyze_consecutive_minus_pattern`
  - `analyze_rotation_buckets`, `find_hot_machines_today`, `get_data_inventory`
- **拡張ツール Phase 2: 6ツール**（2026-06 追加）
  - `analyze_new_machine_lifecycle` — 新台導入後N日目別の高設定率
  - `analyze_juggler_rb_rate` — ジャグラー系REG確率偏重判定
  - `get_machine_lineups` — 並び（島）情報の取得
  - `analyze_lineup_setting` — 並び単位の高設定クラスタリング
  - `analyze_corner_machine_bias` — 角台（並び両端）vs 中央 の高設定率比較
  - `analyze_anniversary_effect` — 周年日・グランドオープン日の効果検証
- **既存ツール改良**: `analyze_*` 系に二項検定の p 値（正規近似）を追加

### 11.2 設計判断（確定済み）
- 高設定判定: 「差枚+ かつ 機種内ゲーム数上位25%」で統一
- ぞろ目台の対象: **2桁のみ**（11〜99）。3桁台は含めない
- 月日合致: `machine_number = EXTRACT(DAY FROM date)`
- スコアリング重み: AI が動的に調整可能（`find_hot_machines_today` の `weights`）
- p 値: 二項検定の両側 p 値（正規近似）。n<30 では信頼性低下を明記
- 並び情報: `hall_maps.lineups` (JSON 配列)、マップ編集画面で人が設定

### 11.3 関連DBスキーマ追加（2026-06）
- `hall_maps.lineups` (text/JSON) — 並び（島）情報 `[{id, name, machine_numbers: [..]}]`
- `halls.anniversary_month_day` (string, MM-DD) — 周年日（毎年同じ月日）
- `halls.grand_open_date` (date) — グランドオープン日

### 11.4 詳細仕様
ツール一覧・入出力仕様・コミュニティ調査の根拠・次フェーズ候補は [MCP_EXTENSION_DESIGN.md](MCP_EXTENSION_DESIGN.md) を参照。
**同ドキュメントは MCP リポジトリ側の `C:\MCP\slot\DESIGN.md` と完全同期させており、どちらを読んでも同じ情報が得られる。** 編集時は両方を必ず更新すること。

### 11.5 次フェーズ候補（未実装）
- 並び情報の視覚的編集 UI（マップ上で複数セル選択して並びを作成）
- 並び色分け表示（マップ表示時に同一並びを同色枠線で）
- イベント日（周年以外の任意の特別日）の登録と分析

## 12. 開発指針

### コード方針（2026-06 大規模リファクタリングで確立）
- **重複は Concern に集約**（`MachineDataFilterable`）
- **N回クエリ → 1回 + メモリ集計**を徹底（`PERFORMANCE_OPTIMIZATION.md`）
- **`SELECT` は必要な列のみ**（特に集計用）
- **ハードコード回避**（`each_with_index` ループ等）
- **インラインCSSは外部化**（`public/stylesheets/` の用途別ファイルへ）

### CSS構造
- `common.css` — CSS変数（`:root` で `--color-*`, `--space-*`, `--radius-*`）と共通スタイル
- 用途別ファイル: `machine_data.css`, `hall_map.css`, `trend_analysis.css`, `data_analysis.css`
- レイアウト `application.html.erb` は最小限。各画面でヘッダーを独自描画している（**改修予定 — 共通ヘッダー化**）

### JavaScript
- ImportMap + Stimulus 構成だが、現状ほぼ素のJS（`onclick=...`）
- 改修方針: タブ／マップ／日付ナビなどは Stimulus controller 化する

### パフォーマンス意識
- Render 無料枠で動かすため、メモリ消費の大きい一括ロード→メモリ集計は注意
- 大量データを扱う画面（trend_analysis, data_analysis）はキャッシュ／件数制限／遅延ロードを検討

### コミット粒度
- 画面単位／機能単位で PR を分ける（段階的改修方針）

## 13. 進行中の改修

全体改修を進行中。タスクは `TaskList` で管理。主要フェーズ:

1. CLAUDE.md 整備（このファイル）✅
2. マップPDF廃止 ✅
3. 共通ヘッダー実装 ✅
4. マップ独立画面追加（タブも残す）＋ JSバグ修正 ✅
5. 日別台データ画面 UX/UI 改善 ✅
6. 傾向分析・データ分析の計測と改善 ✅
7. MCP 拡張設計 ✅
8. MCP 拡張ツール実装（8ツール追加） ✅

次フェーズ候補は §11.4 参照。
