# MCP拡張設計・実装ドキュメント（slot-analysis）

> ⚠️ **同期注意**: 本ドキュメントは MCP リポジトリ側の `C:\MCP\slot\DESIGN.md` と内容を完全同期させています。一方を更新した際は必ずもう一方も更新してください。最終同期日: 2026-06-23（Phase 3 追加）

---

## 1. ドキュメントの目的

別リポジトリ `C:\MCP\slot` に置かれた MCP サーバー (`slot-analysis`) の **設計仕様** と **実装状態** を記録する。
slot 本体アプリの開発者・将来の自分・AI（Claude）の全員が、現在の MCP の能力と次の追加候補を把握できるようにする。

---

## 2. 現状の MCP ツール（全32ツール）

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

### 2.5 拡張ツール Phase 3（3ツール、2026-06 追加）

| ツール | 概要 |
| --- | --- |
| `discover_patterns` | **仮説なしの全探索**。12軸条件を単一・ペアで総当たりし、ベースラインから乖離するパターンを統計的に発見。多重検定の注意あり |
| `analyze_lineup_consecutive_runs` | 並び内のN連続高設定走を検出。角始まり/中央始まり/列全体 を分類 |
| `analyze_juggler_bb_rb_ratio` | **ジャグラー専用**。BB:RB 比率と REG 占有率 rb/(bb+rb) で設定推測。AT/ART 機には適用不可 |

### 2.6 既存ツールの改良（2026-06）

**p 値追加**:

以下のツールに二項検定の両側 p 値（正規近似）を追加し、サンプル数の少ない検出をAI側が信頼度判定できるようにした:
- `analyze_machine_number_pattern` (by_value 各行)
- `analyze_cross_pattern` (matrix 各セル)
- `analyze_prev_day_minus_pattern` (summary)
- `analyze_consecutive_minus_pattern` (summary + by_machine_name)
- `analyze_rotation_buckets` (各バケット)
- `analyze_lineup_setting`, `analyze_corner_machine_bias`, `analyze_anniversary_effect` (新規・最初から付与)
- `discover_patterns` (全 top_patterns 各行)

p 値の解釈: `p_value_vs_baseline < 0.05` で統計的有意。`n < 30` では正規近似の信頼性が落ちる旨を `p_value_note` に明記。

**`analyze_cross_pattern` の履歴依存条件サポート**: machine_conditions に下記の type を指定可能（lookback バッファ計算が走る）:
- `past_3day_worst_in_series` — 機種内で過去3日差枚合計が最低（rank=1）
- `past_7day_worst_in_series` — 機種内で過去7日差枚合計が最低（rank=1）
- `past_14day_worst_in_series` — 機種内で過去14日差枚合計が最低（rank=1）
- `past_30day_worst_in_series` — 機種内で過去30日差枚合計が最低（rank=1）
- `past_n_day_worst_in_series` — **任意 N 日ワースト**（value で日数を指定。例 `value: 21` で 21日ワースト）【2026-07 追加】
- `prev_day_diff_at_most` — value で指定した値以下の前日差枚（既定 -1500）
- `consec_minus_at_least` — value で指定した日数以上の連続マイナス（既定 3）

これにより「**8のつく日 × 過去7日ワースト**」のようなコミュニティで広く語られる複合パターンを直接検証できる。任意 N 対応により「過去21日」「過去60日」のような探索的な日数指定も可能。

### 2.7 機種台数フィルタ（2026-07 追加）

`analyze_cross_pattern` と `discover_patterns` に下記オプションを追加:
- `min_machines_per_series` — この台数未満の機種を分析対象から除外（例: 3 で「1〜2台の機種を除外」）
- `max_machines_per_series` — この台数を超える機種を分析対象から除外（例: 15 で「16台以上の機種を除外」）

**目的**: 1〜2台しかない機種は統計的に意味が薄く、逆に台数が極端に多い機種（ジャグラー大量設置など）はホール全体の傾向を歪める。レンジ指定で「素直に傾向が出る中規模機種だけ」に絞った分析が可能になる。

**実装**: SQL 取得後に JS でカウント → フィルタ。`computeMachineCounts` で機種ごとの unique machine_number 数を集計し、`filterByMachineCount` で対象を絞る。`discover_patterns` の場合はベースライン計算も絞った母集団で行う（同じ母集団内での lift を見る）。

### 2.8 `discover_patterns` の過去ワースト軸を任意 N 対応（2026-07）

`past_worst_days` パラメータで、過去ワースト軸として総当たりに含める日数リストを指定可能。既定は `[3, 7, 14, 30]`。

例: `past_worst_days: [5, 10, 21]` で 5日/10日/21日ワースト軸が AXES に組み込まれ、他の軸とのクロスも全て試行される。

内部実装: `enrichRowsWithHistory(rows, allRows, pastNs)` の第3引数で動的に N リストを受け取り、各 row に `past_sums: Map<N, sum>` と `past_ranks: Map<N, rank>` を付与する。lookback バッファは `max(30, max(pastNs))` 日確保。後方互換のため `past3_sum/past3_rank` 等の固定プロパティも併設。

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

## 9. ツール詳細仕様（拡張 Phase 3）

### 9.1 `discover_patterns`

**目的**: 仮説なしの全探索。AI に「ホール固有の傾向で、まだ仮説化されていないもの」を発見させる。

**12 axes**（軸内は相互排他、軸間でクロス）:
1. date_last_digit (0-9)
2. weekday (日-土)
3. end_of_month
4. day_zorome (11/22/33)
5. machine_last_digit (0-9)
6. machine_double_digit (11-99 のぞろ目台)
7. machine_parity (偶数/奇数)
8. month_day_match (EXTRACT(DAY)=台番号)
9. past_7day_worst (機種内 rank=1)
10. past_3day_worst (機種内 rank=1)
11. prev_day_minus (-1500 以下 / -3000 以下)
12. consec_minus (2日 / 3日)

**生成される組合せ**:
- 単一: ~37 個
- ペア: 軸×軸の全組合せ（軸内排他のため軸間のみ）
- トリプル: include_triples=true で有効化（処理重い）

**出力**:
- `top_patterns_by_score`: |lift_pct| × √n でソートした top max_results
- `significant_patterns`: p_value ≤ significance_threshold のみ

**多重検定注意**: 数百〜数千の組合せをテストするため、p<0.05 でも偶然の可能性あり。lift_pct と instance_count の両方を確認することを caveat に明記。

### 9.2 `analyze_lineup_consecutive_runs`

**目的**: 並び内で N 台以上の連続高設定が並ぶ「連続走」を検出。

**分類**:
- `runs_from_corner`: 並びの左角または右角始まり
- `runs_from_middle`: 内側のみ
- `runs_full_lineup`: 並び全体が高設定

**出力**:
- `by_lineup[]`: 並びごとの集計（total_runs, run_counts_by_length, 等）
- `top_runs`: 長い順 → 新しい順の発生事例（最大30件）

並び情報（hall_maps.lineups）が未登録なら空結果＋メッセージ。

### 9.3 `analyze_juggler_bb_rb_ratio`

**目的**: ジャグラー専用の設定推測。BB:RB 比率と REG 占有率 rb/(bb+rb) で判定。

**⚠️ 適用範囲**:
- 対象: ジャグラーシリーズ（マイジャグラー/ファンキー/アイム/ハッピー 等）
- 不適用: AT/ART 機、スマスロ機（ボーナス役割が複雑）

**原理**:
- 高設定ほど BB と REG の差が小さく、BB:RB ≈ 1:1 に近づく
- 設定6級マイジャグラーV: BB:RB ≈ 1.1:1、REG確率 ≈ 1/270
- 設定1: BB:RB ≈ 1.6:1、REG確率 ≈ 1/450

**出力**:
- 各台×日に `reg_in_total_bonus_ratio`, `bb_to_rb_ratio`, `rb_inverse_estimate` を付与
- `by_machine[]`: 台ごとの「閾値超え日数」とトータル平均

---

## 10. 次フェーズ候補（未実装）

| 候補 | 想定工数 | メモ |
| --- | --- | --- |
| 並び情報の視覚的編集 UI | 中 | マップ上で複数セル選択→並びに追加する Stimulus UI |
| 並び色分け表示 | 小 | マップ表示時、同一並びを同色枠線で表示 |
| イベント日の登録と分析 | 中 | 周年以外の任意特別日（毎月のイベント、新装等）を Hall に複数登録できる仕組み |
| 多重検定補正 | 中 | `discover_patterns` の p 値に Bonferroni/FDR 補正を追加 |
| 統計的有意性の厳密検定 | 中 | 小サンプル時に二項検定の正確 p 値（exact）への切替 |
| Rails アプリ → MCP 統合 UI | 大 | Rails 側で MCP 結果を画面表示 |

---

## 11. 同期手順

slot/MCP_EXTENSION_DESIGN.md と C:\MCP\slot\DESIGN.md は同一内容を維持する。
- どちらかを編集したら **必ず両方同じ内容にする**
- ヘッダーの「最終同期日」を更新する
- 実装が変わった場合は §2.x 表と §7-§8 の詳細仕様も同時に更新する
