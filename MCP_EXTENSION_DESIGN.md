# MCP拡張設計・実装ドキュメント（slot-analysis）

> ⚠️ **同期注意**: 本ドキュメントは MCP リポジトリ側の `C:\MCP\slot\DESIGN.md` と内容を完全同期させています。一方を更新した際は必ずもう一方も更新してください。最終同期日: 2026-06-23

---

## 1. ドキュメントの目的

別リポジトリ `C:\MCP\slot` に置かれた MCP サーバー (`slot-analysis`) の **設計仕様** と **実装状態** を記録する。
slot 本体アプリの開発者・将来の自分・AI（Claude）の全員が、現在の MCP の能力と次の追加候補を把握できるようにする。

---

## 2. 現状の MCP ツール（全23ツール）

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

### 2.3 【2026-06 追加】拡張ツール（8ツール）

| ツール | 由来 | 概要 |
| --- | --- | --- |
| `analyze_machine_number_pattern` | 設計提案 | 末尾／ぞろ目（2桁のみ）／偶奇／月日合致 別の単一軸スライス |
| `analyze_cross_pattern` | 設計提案 | 日付条件 × 台番号条件 の汎用クロス集計（最重要） |
| `analyze_model_weekday_matrix` | 調査P1-3位 | 機種 × 曜日 マトリクス（看板機種の曜日固定癖検出） |
| `analyze_prev_day_minus_pattern` | 調査P1-2位 | 前日大マイナス → 当日プラスの単日反発検証 |
| `analyze_consecutive_minus_pattern` | 調査P2 | N日連続マイナス → 翌日反発の確率 |
| `analyze_rotation_buckets` | 設計提案 | 最終高設定からの経過日数バケット別の今回設定率 |
| `find_hot_machines_today` | 設計提案 | 本日候補のスコアリング（4因子・**重み調整可**） |
| `get_data_inventory` | 設計提案 | データ棚卸し（AI 探索の起点） |

---

## 3. 共通仕様

### 3.1 高設定判定の統一定義
**`差枚 > 0 かつ 機種内ゲーム数上位25%`**（既存ツールと一致）

### 3.2 ぞろ目台の定義（2026-06 確定）
**2桁のみ**（11, 22, 33, 44, 55, 66, 77, 88, 99）。3桁台（111, 222, ...）は含めない。
SQL: `machine_number BETWEEN 11 AND 99 AND machine_number % 11 = 0`

### 3.3 月日合致の定義（2026-06 確定）
**`machine_number = EXTRACT(DAY FROM date)::INTEGER`**
例: 6月15日 → 台番号 15。月をまたぐ判定は不要（日付の「日」のみ）。

### 3.4 除外フィルタ
全ツールで `exclude_machine_names`（部分一致配列）を統一実装。
SQL: `AND NOT EXISTS (SELECT 1 FROM UNNEST($N::text[]) AS ex WHERE machine_name ILIKE '%' || ex || '%')`

### 3.5 統計的有意性の確認
`hit_rate_pct` 単独で判断するとサンプル数が少ない場合に誤判定する。すべての集計に **`instance_count` を必ず含める**ことで、AI 側が信頼度を判断できるようにしている。

### 3.6 ベースライン比較
`lift_pct` (= 条件下のヒット率 − 全体ベースライン) を主要ツールで出力。
正の lift がホール傾向の強さを示す。

---

## 4. 調査結果サマリー（実装の根拠）

「スロット 傾向 設定」等の検索で集めた、コミュニティで広く語られているパターンを優先実装した。

### 優先実装した上位5パターン（実装→対応ツール）

| 順位 | パターン | 対応ツール |
| --- | --- | --- |
| 1 | 日付末尾 × 台番末尾 の複合 | `analyze_cross_pattern` |
| 2 | 凹み台の翌日上げ | `analyze_prev_day_minus_pattern` |
| 3 | 機種 × 曜日 マトリクス | `analyze_model_weekday_matrix` |
| 4 | ぞろ目日 / ゾロ目台 | `analyze_cross_pattern` + `analyze_machine_number_pattern` |
| 5 | 機種内ワースト台の翌日順位 | （既存 `analyze_low_diff_7day_pattern`） |

### 補足実装（汎用化のため）

| パターン | ツール |
| --- | --- |
| N日連続マイナス反発 | `analyze_consecutive_minus_pattern` |
| 設定ローテーション | `analyze_rotation_buckets` |
| 当日候補スコアリング | `find_hot_machines_today`（重み調整可） |
| データ棚卸し | `get_data_inventory` |

### 未実装（次フェーズ候補）

| パターン | 理由 |
| --- | --- |
| 角台効果 | `HallMap.layout_data` から島端を判定する必要があり、MCP 単体では困難 |
| 周年・グランドオープン日 | Hall に周年日カラムが必要（現状 `date_memo` で代替可能） |
| 新台導入後N日目傾向 | 機種別「初登場日」を計算する CTE が必要 |
| ジャグラーREG偏重判定 | `bb_count` / `rb_count` を使う機種特化分析（汎用ツールで未対応） |
| 月初優位 / 月末回収 | `analyze_cross_pattern` の `specific_days` で代替可能 |

---

## 5. ツール仕様詳細（拡張8ツール）

### 5.1 `analyze_machine_number_pattern`
```ts
input: {
  hall_id: number,
  start_date: string,    // YYYY-MM-DD
  end_date: string,
  slice_type: "last_digit" | "double_digit" | "parity" | "month_day_match",
  exclude_machine_names?: string[]
}
output: {
  summary: { slice_type, slice_label, total_instances, total_hits, baseline_hit_rate_pct, high_setting_definition },
  by_value: [{ value, instance_count, hit_count, hit_rate_pct }]
}
```

### 5.2 `analyze_cross_pattern`
```ts
input: {
  hall_id: number,
  start_date: string, end_date: string,
  date_conditions: Array<{
    key: string,
    type: "last_digit"|"specific_days"|"weekday"|"end_of_month"|"month_eq_day"|"day_zorome_2digit"|"all",
    value?: number | number[]
  }>,
  machine_conditions: Array<{
    key: string,
    type: "last_digit"|"double_digit_2digit"|"parity"|"month_day_match"|"all",
    value?: number | "even" | "odd"
  }>,
  exclude_machine_names?: string[],
  include_zero_rate?: boolean  // 既定 true
}
output: {
  summary: { description, total_machine_days, total_high_settings, baseline_hit_rate_pct, high_setting_definition },
  matrix: [{ date_cond_key, machine_cond_key, instance_count, hit_count, hit_rate_pct }],
  date_conditions, machine_conditions
}
```

**呼び出し例（7のつく日 × 末尾7 検証）:**
```json
{
  "date_conditions": [
    { "key": "7のつく日", "type": "specific_days", "value": [7, 17, 27] },
    { "key": "その他",    "type": "all" }
  ],
  "machine_conditions": [
    { "key": "末尾7",   "type": "last_digit", "value": 7 },
    { "key": "その他",  "type": "all" }
  ]
}
```

### 5.3 `analyze_model_weekday_matrix`
```ts
input: { hall_id, start_date, end_date, min_machine_count?: number, exclude_machine_names? }
output: {
  summary: { description, high_setting_definition, min_machine_count_per_day },
  matrix: [{ machine_name, dow, weekday, instance_count, hit_count, hit_rate_pct }],
  highlights: [{ machine_name, best_weekday, best_hit_rate_pct, best_instance_count }]
}
```

### 5.4 `analyze_prev_day_minus_pattern`
```ts
input: { hall_id, start_date, end_date, min_prev_minus?: number, exclude_machine_names? }
output: {
  summary: {
    description, min_prev_minus,
    total_instances, hit_count, hit_rate_pct,
    baseline_hit_rate_pct, lift_pct
  }
}
```

### 5.5 `analyze_consecutive_minus_pattern`
```ts
input: { hall_id, start_date, end_date, min_consecutive_minus_days?: number, exclude_machine_names? }
output: {
  summary: {
    description, min_consecutive_minus_days,
    total_instances, hit_count, hit_rate_pct,
    baseline_hit_rate_pct, lift_pct
  },
  by_machine_name: [{ machine_name, instance_count, hit_count, hit_rate_pct }]
}
```

### 5.6 `analyze_rotation_buckets`
```ts
input: {
  hall_id, start_date, end_date,
  buckets?: Array<[number, number]>,  // [[1,3],[4,7],[8,14],[15,30],[31,365]]
  exclude_machine_names?
}
output: {
  summary: { description, high_setting_definition, total_instances, overall_hit_rate_pct },
  buckets: [{ range, min, max, instance_count, hit_count, hit_rate_pct }]
}
```

### 5.7 `find_hot_machines_today`
```ts
input: {
  hall_id: number,
  target_date: string,
  top_n?: number,           // 既定 10
  weights?: {               // 各 0以上、合計は内部で1に正規化
    prev_7day_minus?: number,
    days_since_last_high?: number,
    machine_high_rate?: number,
    prev_day_minus?: number
  },
  exclude_machine_names?: string[]
}
output: {
  target_date,
  top_candidates: [{
    machine_number, machine_name, score,
    factor_scores: { prev_7day_minus, days_since_last_high, machine_high_rate, prev_day_minus },  // 各 [0,100]
    factors:       { prev_7day_sum, days_since_last_high, high_count_30d, prev_day_diff, days_with_data_in_7d }
  }],
  weights_used,
  scoring_note
}
```

**スコアリング設計:**
- 各因子を `[0, 100]` のスコアにスケール
- `prev_7day_minus`: 0G→0点、-10000→100点（線形）
- `days_since_last_high`: 1日→5点、21日以上→100点（NULL は 30 扱い）
- `machine_high_rate`: 過去30日の高設定回数 0→0点、5回以上→100点
- `prev_day_minus`: 0→0点、-3000→100点（線形）
- 合計 = 各因子スコア × 正規化された重み の総和

### 5.8 `get_data_inventory`
```ts
input: { hall_id: number }
output: {
  date_range: { oldest_date, latest_date, days_with_data, total_records },
  machines: { total_unique, avg_per_day, series_count },
  by_series: [{ machine_name, machine_count }],
  analysis_tools: [{ name, purpose }]  // 全23ツールのカタログ
}
```

---

## 6. 解決済み設計判断（2026-06）

| 項目 | 決定 |
| --- | --- |
| 月日合致の定義 | `EXTRACT(DAY FROM date) = machine_number` で確定 |
| ぞろ目の対象 | 2桁のみ（11〜99）。3桁台は含めない |
| スコアリング重み | AI が `weights` パラメータで動的に調整可能 |
| CLAUDE.md §11 | 本ドキュメントへの参照に置き換え済み |
| 設計ドキュメントの保管場所 | slot/MCP_EXTENSION_DESIGN.md と C:\MCP\slot\DESIGN.md を**両方とも完全同期**で維持 |

---

## 7. 次フェーズ候補（実装未着手）

| 候補 | 想定工数 | 検証可能性 |
| --- | --- | --- |
| 角台効果（島端台の高設定率） | 中 | HallMap 連携必要 |
| 周年効果検証 | 中 | Hall に周年日カラム追加が望ましい |
| 新台導入後N日目傾向 | 小 | 機種別「初登場日」CTE で実現可能 |
| ジャグラーREG偏重判定 | 小 | `rb_count / game_count` の機種別計算 |
| 統計的有意性（p値）追加 | 中 | 既存ツールの `instance_count` に加えて二項分布の p 値を返す |
| Ruby アプリ → MCP 統合 UI | 大 | 別タスク。Rails 側で MCP 結果を画面表示 |

---

## 8. 同期手順

slot/MCP_EXTENSION_DESIGN.md と C:\MCP\slot\DESIGN.md は同一内容を維持する。
- どちらかを編集したら **必ず両方同じ内容にする**
- ヘッダーの「最終同期日」を更新する
- 実装が変わった場合は §2.3 表と §5 の詳細仕様も同時に更新する
