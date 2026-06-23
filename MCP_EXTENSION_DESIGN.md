# MCP拡張設計（slot-analysis）

別リポジトリ `C:\MCP\slot` の MCP サーバーに対する次の拡張提案。
本ドキュメントは設計のみ。実装は本体UI改修の完了後。

---

## 1. 現状の MCP ツール一覧（実装済み）

slot-analysis MCP には既に下記15ツールが存在する。

### 基本データ取得
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

### 設定傾向分析
| ツール | 概要 |
| --- | --- |
| `analyze_low_diff_7day_pattern` | 過去7日差枚最低台が当日プラスになる率 |
| `get_high_setting_candidates` | 指定日の高設定濃厚/候補台 |
| `analyze_adjacent_setting` | 並び設定（連番台）パターン |
| `analyze_series_setting_cycle` | 機種内・台ごとの高設定頻度と平均間隔 |
| `analyze_setting_tendency` | 機種別＋曜日別の高設定統計サマリー |
| `analyze_day_of_month_pattern` | 「Nのつく日」パターン検証 |
| `get_low_diff_candidates_for_date` | 当日の高設定候補台予測 |

### 共通設計
- 高設定判定: `差枚 > 0 かつ 機種内ゲーム数上位25%`
- 除外フィルタ: `exclude_machine_names`（部分一致）でジャグラー・沖ドキ等を一括除外可能
- DB: Supabase PostgreSQL 直接接続

---

## 2. ギャップ分析

CLAUDE.md §11 の目標と現状の比較：

| 目標 | 現状 | ギャップ |
| --- | --- | --- |
| 日付条件でスライス | ✅ 曜日／月日／7のつく日 | △ 月日合致／月末／ぞろ目日 単独ツールが未提供 |
| 機種条件でスライス | ✅ 機種名フィルタ／部分一致 | ◯ 充足 |
| 台番号末尾でスライス | ❌ 未対応 | ⚠️ 未実装 |
| ぞろ目台でスライス | ❌ 未対応 | ⚠️ 未実装 |
| 偶奇台でスライス | ❌ 未対応 | ⚠️ 未実装 |
| 月日合致台でスライス | ❌ 未対応 | ⚠️ 未実装 |
| 「日付条件 × 機種条件 × 台条件」のクロス集計 | △ `analyze_day_of_month_pattern` のみ | ⚠️ 一般化が必要 |
| 「経過日数」を切り口にした分析 | △ `get_low_diff_candidates_for_date` で last_high_date のみ | ⚠️ 経過日数バケットでの統計化が必要 |

---

## 3. 提案する新規ツール（優先度順）

### 3.1 [P1] `analyze_machine_number_pattern`

**目的**: 台番号の属性（末尾／ぞろ目／偶奇／月日合致）別の高設定率を統計化。

**シグネチャ**
```js
{
  hall_id: number,
  start_date: string,  // YYYY-MM-DD
  end_date: string,
  slice_type: "last_digit" | "double_digit" | "parity" | "month_day_match",
  exclude_machine_names?: string[]
}
```

**返却（last_digit 例）**
```json
{
  "summary": {
    "description": "末尾0〜9の高設定率",
    "slice_type": "last_digit",
    "total_machine_days": 12345,
    "baseline_hit_rate_pct": 12.3
  },
  "by_value": [
    { "value": 0, "instance_count": 1200, "hit_count": 150, "hit_rate_pct": 12.5 },
    { "value": 1, "instance_count": 1180, "hit_count": 130, "hit_rate_pct": 11.0 },
    ...
  ]
}
```

**SQL方針**
- `machine_number % 10` で末尾抽出
- `LENGTH(machine_number::text) >= 2 AND RIGHT(machine_number::text, 1) = LEFT(RIGHT(machine_number::text, 2), 1)` でぞろ目
- `machine_number % 2 = 0` で偶数
- `EXTRACT(DAY FROM date)::integer = machine_number` で月日合致

---

### 3.2 [P1] `analyze_cross_pattern`

**目的**: 「日付条件 × 台番号条件」の任意クロス集計を返す汎用ツール。データ分析画面のマトリクス相当を AI に提供。

**シグネチャ**
```js
{
  hall_id: number,
  start_date: string,
  end_date: string,
  date_conditions: Array<{ key: string, type: "last_digit"|"specific_days"|"weekday"|"end_of_month"|"month_day", value?: number|number[] }>,
  machine_conditions: Array<{ key: string, type: "last_digit"|"double_digit"|"parity"|"month_day_match", value?: number|"even"|"odd" }>,
  exclude_machine_names?: string[]
}
```

**返却**
```json
{
  "matrix": [
    {
      "date_cond_key": "7のつく日",
      "machine_cond_key": "末尾7",
      "instance_count": 234,
      "hit_count": 35,
      "hit_rate_pct": 15.0
    },
    ...
  ],
  "baseline_hit_rate_pct": 12.3
}
```

**設計上の利点**
- AI が探索的に「色々な組合せを試したい」場合に1リクエストで完結
- データ分析画面の5マトリクス（カレンダー／末尾日×末尾番台／末尾日×曜日／第N週×曜日／日付×機種）を統合的に提供可能

---

### 3.3 [P2] `analyze_consecutive_minus_pattern`

**目的**: 「N日連続マイナスの後、当日に高設定になる確率」を検証。

**シグネチャ**
```js
{
  hall_id: number,
  start_date: string,
  end_date: string,
  min_consecutive_minus_days: number,  // 例: 3
  exclude_machine_names?: string[]
}
```

**返却**
```json
{
  "summary": {
    "min_consecutive_minus_days": 3,
    "instance_count": 567,
    "hit_count": 90,
    "hit_rate_pct": 15.9,
    "baseline_hit_rate_pct": 12.3
  },
  "by_machine_name": [
    { "machine_name": "...", "instance_count": ..., "hit_rate_pct": ... }
  ]
}
```

---

### 3.4 [P2] `analyze_rotation_buckets`

**目的**: 「最終高設定日からの経過日数バケット」別の今回設定率。設定ローテーションの確率を可視化。

**シグネチャ**
```js
{
  hall_id: number,
  start_date: string,
  end_date: string,
  buckets?: Array<[number, number]>,  // 例: [[1,3],[4,7],[8,14],[15,30],[31,365]]
  exclude_machine_names?: string[]
}
```

**返却**
```json
{
  "buckets": [
    { "range": "1-3日", "instance_count": ..., "hit_rate_pct": ... },
    { "range": "4-7日", ... },
    ...
  ]
}
```

---

### 3.5 [P3] `find_hot_machines_today`

**目的**: 当日のスコアリングを1ショットで返すヒューリスティック。複数の既存ツールを組み合わせる総合判定。

**シグネチャ**
```js
{
  hall_id: number,
  target_date: string,
  top_n?: number  // デフォルト10
}
```

**スコア要素（重み付け）**
- 前7日差枚（マイナス度合いが大きいほど加点）
- 最終高設定日からの経過日数
- 過去30日の機種内高設定率（その台が機種内で「アタリ位置」だったか）
- 隣接台の過去並び設定実績

**返却**
```json
{
  "top_candidates": [
    {
      "machine_number": 123,
      "machine_name": "...",
      "score": 87.5,
      "factors": {
        "prev_7day_sum": -3500,
        "days_since_last_high": 21,
        "machine_high_rate_pct": 18.5,
        "adjacent_pattern_count": 2
      }
    }
  ],
  "scoring_weights": { ... }
}
```

---

### 3.6 [P3] `get_data_inventory`

**目的**: 与えられたホールの「データ概況」を AI が最初に確認するための1ツール。

**シグネチャ**
```js
{
  hall_id: number
}
```

**返却**
```json
{
  "date_range": { "oldest": "2025-01-01", "latest": "2026-06-22", "total_days": 538 },
  "machine_counts": { "total": 250, "by_series": [{ "name": "...", "count": 12 }] },
  "data_density": { "days_with_data": 530, "avg_machines_per_day": 245 },
  "available_tools": [
    { "name": "analyze_machine_number_pattern", "good_for": "末尾傾向検出" },
    ...
  ]
}
```

→ AI が探索を始める前に「このホールで何ができるか」を理解しやすくする。

---

## 4. 実装上の共通考慮

### 4.1 出力サイズ管理
- `analyze_cross_pattern` のマトリクスは要素数が多くなり得る（13×13=169 等）。`include_zero_rate: false` オプションでヒット率0%の行を省略可能にする。

### 4.2 統計的有意性
- `hit_rate_pct` だけ見ても N が小さいと意味なし。すべての集計に `instance_count` を必ず含め、AI が信頼度を判断できるようにする。
- 将来的には `confidence_interval` や `p_value` も検討（ただし MCP の応答は短い方が良いので慎重に）。

### 4.3 高設定判定の統一
- 既存ツールと同じ「差枚 > 0 かつ 機種内ゲーム数上位25%」を維持。
- 将来的にしきい値変更を許すオプションは追加可能（`high_setting_definition: "p75"|"p80"|"diff_only"|...`）。

### 4.4 除外フィルタ
- 全ツールで `exclude_machine_names` を統一実装。`buildExcludeFilter` ヘルパーを既存どおり使用。

---

## 5. 実装優先度のまとめ

| 順位 | ツール | 工数感 | 想定効果 |
| --- | --- | --- | --- |
| 1 | `analyze_machine_number_pattern` | 小 | 末尾／ぞろ目／偶奇/月日合致の単独検証 |
| 2 | `analyze_cross_pattern` | 中 | データ分析画面マトリクス相当を AI 提供 |
| 3 | `analyze_consecutive_minus_pattern` | 小 | N日連続マイナスからの反発検証 |
| 4 | `analyze_rotation_buckets` | 中 | 設定ローテーション確率の可視化 |
| 5 | `find_hot_machines_today` | 大 | 当日候補のスコアリング統合 |
| 6 | `get_data_inventory` | 小 | AI の最初の探索用ヘルパー |

---

## 6. 未決事項（要 user 確認）

1. **「月日合致」の定義**: `EXTRACT(DAY FROM date) = machine_number` で OK か？（例: 7月15日に台番15）
2. **「ぞろ目」の対象範囲**: 11/22/33 のみ（2桁ぞろ目）か、111/222 などの3桁台も含めるか
3. **`find_hot_machines_today` のスコア重み**: AI に重み調整させる API にするか、固定式にするか
4. **CLAUDE.md §11 の更新**: 本ドキュメントの完成後、§11 を本ドキュメントへの参照に置き換えるか
5. **MCP リポジトリの設計ドキュメントの保管場所**: 本ドキュメント (slot 側) と MCP 側 (`C:\MCP\slot\DESIGN.md`) のどちらが第一情報源か
