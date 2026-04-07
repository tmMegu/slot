// MCPサーバー本体
// Claude Desktop から stdio 経由で呼び出される

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getAllHalls,
  getHallById,
  getMachineData,
  getDailySummary,
  getHighGameCountMachines,
  getHighDifferenceMachines,
  getMachineStatsByName,
  getWeekdayStats,
  getMachineNames,
  getDateRange,
} from "./db.js";

// ============================================================
// サーバー初期化
// ============================================================

const server = new McpServer({
  name: "slot-analysis",
  version: "1.0.0",
});

// ============================================================
// ツール定義
// ============================================================

// ---- ホール一覧 ----
server.tool(
  "get_halls",
  "登録されているホール（パチンコ・スロット店）の一覧を取得する。hall_id を確認するために最初に呼ぶこと。",
  {},
  async () => {
    const halls = await getAllHalls();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(halls, null, 2),
        },
      ],
    };
  }
);

// ---- ホール情報 ----
server.tool(
  "get_hall_info",
  "指定したホールの詳細情報（名前・メモ・データ期間）を取得する。",
  {
    hall_id: z.number().int().positive().describe("ホールID（get_halls で確認）"),
  },
  async ({ hall_id }) => {
    const hall = await getHallById(hall_id);
    if (!hall) {
      return { content: [{ type: "text", text: `hall_id=${hall_id} のホールが見つかりません。` }] };
    }
    const range = await getDateRange(hall_id);
    const names = await getMachineNames(hall_id);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              hall,
              data_range: range,
              machine_names: names,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---- 台データ取得（生データ） ----
server.tool(
  "get_machine_data",
  "指定ホール・期間・台番号の台データ（ゲーム数・差枚・BB・RB・ART）を取得する。期間が長い場合はデータ量が多くなるため、1〜2週間程度に絞ることを推奨。",
  {
    hall_id: z.number().int().positive().describe("ホールID"),
    start_date: z.string().describe("開始日 YYYY-MM-DD"),
    end_date: z.string().describe("終了日 YYYY-MM-DD"),
    machine_number: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("台番号（省略すると全台）"),
  },
  async ({ hall_id, start_date, end_date, machine_number }) => {
    const data = getMachineData({
      hallId: hall_id,
      startDate: start_date,
      endDate: end_date,
      machineNumber: machine_number ?? null,
    });
    return {
      content: [
        {
          type: "text",
          text:
            data.length === 0
              ? "該当データがありません。"
              : JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// ---- 特定日のサマリー ----
server.tool(
  "get_daily_summary",
  "特定の1日における全台のデータサマリーを取得する。その日の全体傾向の把握や高設定台の特定に使う。",
  {
    hall_id: z.number().int().positive().describe("ホールID"),
    date: z.string().describe("対象日 YYYY-MM-DD"),
  },
  async ({ hall_id, date }) => {
    const data = getDailySummary({ hallId: hall_id, date });
    return {
      content: [
        {
          type: "text",
          text:
            data.length === 0
              ? `${date} のデータがありません。`
              : JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// ---- ゲーム数上位台 ----
server.tool(
  "get_high_game_count_machines",
  "指定期間でゲーム数（回転数）の合計が多い台を上位N件取得する。よく回されている台＝設定が入りやすい台の発見に使う。",
  {
    hall_id: z.number().int().positive().describe("ホールID"),
    start_date: z.string().describe("開始日 YYYY-MM-DD"),
    end_date: z.string().describe("終了日 YYYY-MM-DD"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("取得件数（デフォルト20）"),
  },
  async ({ hall_id, start_date, end_date, limit }) => {
    const data = getHighGameCountMachines({
      hallId: hall_id,
      startDate: start_date,
      endDate: end_date,
      limit: limit ?? 20,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ---- 差枚数上位台 ----
server.tool(
  "get_high_difference_machines",
  "指定期間で差枚数の合計が高い台を上位N件取得する。出玉の多い台＝高設定候補の特定に使う。",
  {
    hall_id: z.number().int().positive().describe("ホールID"),
    start_date: z.string().describe("開始日 YYYY-MM-DD"),
    end_date: z.string().describe("終了日 YYYY-MM-DD"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("取得件数（デフォルト20）"),
  },
  async ({ hall_id, start_date, end_date, limit }) => {
    const data = getHighDifferenceMachines({
      hallId: hall_id,
      startDate: start_date,
      endDate: end_date,
      limit: limit ?? 20,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ---- 機種名で統計取得 ----
server.tool(
  "get_machine_stats_by_name",
  "機種名（部分一致）で台を絞り込み、台番号ごとの統計を取得する。特定機種の設定傾向分析に使う。",
  {
    hall_id: z.number().int().positive().describe("ホールID"),
    machine_name: z.string().describe("機種名（部分一致）例: 'バジリスク'"),
    start_date: z.string().describe("開始日 YYYY-MM-DD"),
    end_date: z.string().describe("終了日 YYYY-MM-DD"),
  },
  async ({ hall_id, machine_name, start_date, end_date }) => {
    const data = getMachineStatsByName({
      hallId: hall_id,
      machineName: machine_name,
      startDate: start_date,
      endDate: end_date,
    });
    return {
      content: [
        {
          type: "text",
          text:
            data.length === 0
              ? `"${machine_name}" に一致する機種データがありません。`
              : JSON.stringify(data, null, 2),
        },
      ],
    };
  }
);

// ---- 曜日別統計 ----
server.tool(
  "get_weekday_stats",
  "曜日ごとの平均ゲーム数・平均差枚数・高差枚日数を集計する。ホールの設定投入曜日の傾向把握に使う。",
  {
    hall_id: z.number().int().positive().describe("ホールID"),
    start_date: z.string().describe("開始日 YYYY-MM-DD"),
    end_date: z.string().describe("終了日 YYYY-MM-DD"),
    machine_number: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("台番号（省略すると全台集計）"),
  },
  async ({ hall_id, start_date, end_date, machine_number }) => {
    const data = getWeekdayStats({
      hallId: hall_id,
      startDate: start_date,
      endDate: end_date,
      machineNumber: machine_number ?? null,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }
);

// ============================
// 起動
// ============================

const transport = new StdioServerTransport();
await server.connect(transport);
