# MCP拡張設計・実装ドキュメント（slot-analysis）

> ⚠️ **同期注意**: 本ドキュメントは MCP リポジトリ側の `C:\MCP\slot\DESIGN.md` と内容を完全同期させています。一方を更新した際は必ずもう一方も更新してください。最終同期日: 2026-06-23

---

## 1. ドキュメントの目的

別リポジトリ `C:\MCP\slot` に置かれた MCP サーバー (`slot-analysis`) の **設計仕様** と **実装状態** を記録する。
slot 本体アプリの開発者・将来の自分・AI（Claude）の全員が、現在の MCP の能力と次の追加候補を把握できるようにする。

---

## 2. 現状の MCP ツール（全29ツール）

すべて Supabase PostgreSQL へ直接接続し読取専用。stdio 経由で Claude Desktop / Claude Code に接続。

### 2.1 基本データ取得（8ツール）

| ツール | 概要 |
| --- | --- |
| `get_halls` | ホール一覧 |
| `get_hall_info` | ホール詳細＋データ期間＋機種一覧 |
| `get_machine_data` | 指定期間の生データ |
| `get_daily_summary` | 1日全台サマリー |
| `get_high_game_count_machines` | 期間内ゲーム数上位N台 |
| `get_high_difference_machines` | 期間内差枚上位N台 |
| `get_machine_stats_by_name` | 機種名（部分一致）統計 |
| `get_weekday_stats` | 曜日別集計 |

### 2.2 既存の設定傾向分析（7ツール）

| ツール | 概要 |
| --- | --- |
| `analyze_low_diff_7day_pattern` | 過去7日差枚最低台が当日プラスになる率 |
| `get_high_setting_candidates` | 指定日の高設定濃厚/候補台 |
| `analyze_adjacent_setting` | 並び設定（連番台）パターン |
| `analyze_series_setting_cycle` | 機種内・台ごとの高設定頻度と平均間隔 |
| `analyze_setting_tendency` | 機種別＋曜日別の高設定統計サマリー |
| `analyze_day_of_month_pattern` | 「Nのつく日」パターン検証 |
| `get_low_diff_candidates_for_date` | 当日の高設定候補台予測 |

### 2.3 拡張ツール Phase 1（8ツール、2026-06 追加）

| ツール | 概要 |
| --- | --- |
| `analyze_machine_number_pattern` | 末尾／ぞろ目／偶奇／月日合致 別の単一軸スライス |
| `analyze_cross_pattern` | 日付条件 × 台番号条件 の汎用クロス集計（最重要） |
| `analyze_model_weekday_matrix` | 機種 × 曜日 マトリクス |
| `analyze_prev_day_minus_pattern` | 前日大マイナス → 当日プラス検証 |
| `analyze_consecutive_minus_pattern` | N日連続マイナス → 翌日反発 |
| `analyze_rotation_buckets` | 最終高設定日からの経過日数バケット |
| `find_hot_machines_today` | 本日候補のスコアリング（重み調整可） |
| `get_data_inventory` | データ棚卸し（AI 探索の起点） |

### 2.4 拡張ツール Phase 2（6ツール、2026-06 追加）

| ツール | 概要 |
| --- | --- |
| `analyze_new_machine_lifecycle` | 新台導入後N日目別の高設定率（バケット集計） |
| `analyze_juggler_rb_rate` | ジャグラー系REG確率偏重判定（rb_count/game_count） |
| `get_machine_lineups` | ホールに登録された並び（島）情報の取得 |
| `analyze_lineup_setting` | 並び単位の高設定クラスタリング分析 |
| `analyze_corner_machine_bias` | 角台（並び両端）vs 中央台 の高設定率比較 |
| `analyze_anniversary_effect` | 周年日・グランドオープン日 の効果検証 |

### 2.5 既存ツールの改良（p 値追加、2026-06）

以下のツールに二項検定の両側 p 値（正規近似）を追加し、サンプル数の少ない検出をAI側が信頼度判定できるようにした:
- `analyze_machine_number_pattern` (by_value 各行)
- `analyze_cross_pattern` (matrix 各セル)
- `analyze_prev_day_minus_pattern` (summary)
- `analyze_consecutive_minus_pattern` (summary + by_machine_name)
- `analyze_rotation_buckets` (各バケット)
- `analyze_lineup_setting`, `analyze_corner_machine_bias`, `analyze_anniversary_effect` (新規・最初から付与)

p 値の解釈: `p_value_vs_baseline < 0.05` で統計的有意。`n < 30` では正規近似の信頼性が落ちる旨を `p_value_note` に明記。

---

## 3. 共通仕様

### 3.1 高設定判定の統一定義
**`差枚 > 0 かつ 機種内ゲーム数上位25%`**（既存ツールと一致）

### 3.2 ぞろ目台の定義
**2桁のみ**（11, 22, 33, 44, 55, 66, 77, 88, 99）。3桁台（111, 222, ...）は含めない。
SQL: `machine_number BETWEEN 11 AND 99 AND machine_number % 11 = 0`

### 3.3 月日合致の定義
**`machine_number = EXTRACT(DAY FROM date)::INTEGER`**
例: 6月15日 → 台番号 15。月をまたぐ判定は不要（日付の「日」のみ）。

### 3.4 除外フィルタ
全ツールで `exclude_machine_names`（部分一致配列）を統一実装。
SQL: `AND NOT EXISTS (SELECT 1 FROM UNNEST($N::text[]) AS ex WHERE machine_name ILIKE '%' || ex || '%')`

### 3.5 統計的有意性（p 値）
- 二項検定の両側 p 値（正規近似）
- ヘルパー: `binomialTwoTailedPValue(hits, n, baselineRate)`
- erf 近似に Abramowitz & Stegun 7.1.26（誤差 ~1.5e-7）
- n が小さいときの信頼性低下を `p_value_note` で警告

### 3.6 ベースライン比較
`lift_pct` (= 条件下のヒット率 − 全体ベースライン) を主要ツールで出力。
正の lift がホール傾向の強さを示す。

---

## 4. 関連 DB スキーマ追加（2026-06）

slot 本体アプリ側で以下のカラムを追加した。MCP はこれらを直接読み取る。

### 4.1 `hall_maps.lineups` (text/JSON)
並び（島）情報を保持。マップ編集画面で人が設定する。
構造:
```json
[
  { "id": 1, "name": "ジャグラー左島", "machine_numbers": [1,2,3,4,5,6] },
  { "id": 2, "name": "沖ドキ", "machine_numbers": [10,11,12,13] }
]
```

### 4.2 `halls.anniversary_month_day` (string, MM-DD)
毎年同じ日に発生する周年日。年は無視。空欄可。
例: `"07-15"` → 毎年7月15日。

### 4.3 `halls.grand_open_date` (date)
グランドオープン日（特定の1日）。`analyze_anniversary_effect` で同月日を毎年マッチする用途。

---

## 5. 調査結果サマリー（実装の根拠）

「スロット 傾向 設定」等の検索でスロッターコミュニティが整理しているパターンを横断調査し、優先実装した。

### 優先実装した上位5パターン → 対応ツール

| 順位 | パターン | 対応ツール |
| --- | --- | --- |
| 1 | 日付末尾 × 台番末尾 の複合 | `analyze_cross_pattern` |
| 2 | 凹み台の翌日上げ | `analyze_prev_day_minus_pattern` |
| 3 | 機種 × 曜日 マトリクス | `analyze_model_weekday_matrix` |
| 4 | ぞろ目日 / ゾロ目台 | `analyze_cross_pattern` + `analyze_machine_number_pattern` |
| 5 | 機種内ワースト台の翌日順位 | （既存 `analyze_low_diff_7day_pattern`） |

### 補足実装

| パターン | ツール |
| --- | --- |
| N日連続マイナス反発 | `analyze_consecutive_minus_pattern` |
| 設定ローテーション | `analyze_rotation_buckets` |
| 当日候補スコアリング（重み調整可） | `find_hot_machines_today` |
| データ棚卸し | `get_data_inventory` |
| 新台導入後N日目傾向 | `analyze_new_machine_lifecycle` |
| ジャグラーREG偏重 | `analyze_juggler_rb_rate` |
| 並び（島）情報の利用 | `get_machine_lineups` |
| 並び単位の高設定クラスタリング | `analyze_lineup_setting` |
| 角台効果（並び両端） | `analyze_corner_machine_bias` |
| 周年・グランドオープン日効果 | `analyze_anniversary_effect` |

---

## 6. 解決済み設計判断（2026-06）

| 項目 | 決定 |
| --- | --- |
| 月日合致の定義 | `EXTRACT(DAY FROM date) = machine_number` |
| ぞろ目の対象 | 2桁のみ（11〜99）。3桁台は含めない |
| スコアリング重み | AI が `weights` パラメータで動的に調整可能 |
| CLAUDE.md §11 | 本ドキュメントへの参照に置き換え済み |
| 設計ドキュメントの保管場所 | slot/MCP_EXTENSION_DESIGN.md と C:\MCP\slot\DESIGN.md を**両方とも完全同期**で維持 |
| 並び（島）情報の保管 | `hall_maps.lineups` (text/JSON 配列) |
| 並び編集の UI | マップ編集画面下部の「並び（島）管理」パネル（テキスト入力ベース v1） |
| 周年日のフォーマット | MM-DD（毎年同じ月日） |
| p 値の計算手法 | 二項検定・正規近似（n<30 は警告） |

---

## 7. ツール詳細仕様（拡張 Phase 1）

### 7.1 `analyze_machine_number_pattern`
slice_type: `"last_digit" | "double_digit" | "parity" | "month_day_match"`
返却 `by_value[]` 各行に `p_value_vs_baseline` を含む。

### 7.2 `analyze_cross_pattern`
任意の日付条件×台番号条件のクロス集計。例: 7のつく日 × 末尾7。
- date_conditions: `[{key, type: last_digit|specific_days|weekday|end_of_month|month_eq_day|day_zorome_2digit|all, value?}]`
- machine_conditions: `[{key, type: last_digit|double_digit_2digit|parity|month_day_match|all, value?}]`
- 返却 `matrix[]` 各セルに `p_value_vs_baseline` を含む。

### 7.3 `analyze_model_weekday_matrix`
機種 × 曜日 のマトリクス。`highlights[]` に機種ごとのベスト曜日。

### 7.4 `analyze_prev_day_minus_pattern`
前日差枚 ≤ `min_prev_minus` (既定 -1500) の翌日プラス率と全体ベースラインの比較。

### 7.5 `analyze_consecutive_minus_pattern`
連続マイナス `min_consecutive_minus_days` (既定 3) 後の翌日反発率。

### 7.6 `analyze_rotation_buckets`
最終高設定からの経過日数バケット (`buckets`) 別の今回設定率。

### 7.7 `find_hot_machines_today`
4因子（prev_7day_minus / days_since_last_high / machine_high_rate / prev_day_minus）の重み付け合算で上位 `top_n` 件。`weights` で各因子の重みを上書き可（自動正規化）。

### 7.8 `get_data_inventory`
ホールのデータ概況＋利用可能な分析ツールカタログを返す。AI 探索の起点。

---

## 8. ツール詳細仕様（拡張 Phase 2）

### 8.1 `analyze_new_machine_lifecycle`
機種ごとの「初登場日」を基準に、新台導入後N日目の高設定率を `day_buckets` (既定 1日目, 2-3日目, 4-7日目, 8-14日目, 15-30日目, 31-60日目, 61-365日目) で集計。

注意: ホールのデータ蓄積開始時点で既存だった機種は初登場日が不正確。`min_introduction_age_days` を上げると純粋な新台のみに絞れる。

### 8.2 `analyze_juggler_rb_rate`
- `machine_name_filter` (ILIKE, 既定 `'%ジャグラー%'`)
- `threshold_rb_rate` (既定 1/270 ≒ 0.0037 = マイジャグラー系設定6 REG確率)
- `min_game_count` (既定 3000G)

REG確率が閾値超えの台×日を返す。`by_machine[]` に台ごとの「閾値超え日数」が入り、ホールの「ジャグラー強さ」の指標になる。

### 8.3 `get_machine_lineups`
hall_maps の `lineups` カラムを読み取り、ホールの全マップ（または指定マップ）の並び情報を返す。

### 8.4 `analyze_lineup_setting`
各「日 × 並び」内で `min_high_in_lineup` (既定 2) 以上の台が高設定だった日を「並び成立イベント」としてカウント。`by_lineup[]` に並びごとの成立率と並び内高設定率のベースライン比較 p 値。

### 8.5 `analyze_corner_machine_bias`
並びの両端（角台）と内側（中央台）の高設定率を比較。`comparison.corner / middle / solo` で各カテゴリ、`by_lineup[]` で並びごとの corner vs middle 比較。

### 8.6 `analyze_anniversary_effect`
`halls.anniversary_month_day` と `grand_open_date` の周辺日（`window_days` で前後N日）の高設定率を、その他の日と比較。`p_value_vs_other` で有意差判定。

---

## 9. 次フェーズ候補（未実装）

| 候補 | 想定工数 | メモ |
| --- | --- | --- |
| 並び情報の視覚的編集 UI | 中 | マップ上で複数セル選択→並びに追加する Stimulus UI |
| 並び色分け表示 | 小 | マップ表示時、同一並びを同色枠線で表示 |
| イベント日の登録と分析 | 中 | 周年以外の任意特別日（毎月のイベント、新装等）を Hall に複数登録できる仕組み |
| 統計的有意性の厳密検定 | 中 | 小サンプル時に二項検定の正確 p 値（exact）への切替 |
| Rails アプリ → MCP 統合 UI | 大 | Rails 側で MCP 結果を画面表示 |

---

## 10. 同期手順

slot/MCP_EXTENSION_DESIGN.md と C:\MCP\slot\DESIGN.md は同一内容を維持する。
- どちらかを編集したら **必ず両方同じ内容にする**
- ヘッダーの「最終同期日」を更新する
- 実装が変わった場合は §2.x 表と §7-§8 の詳細仕様も同時に更新する
