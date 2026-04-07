// PostgreSQL (Supabase) データベースへのアクセス層
// 環境変数 DATABASE_URL で接続先を指定する

import pg from "pg";

const { Pool } = pg;

// DATABASE_URL 例:
//   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase は SSL 必須
});

/** SQL実行ヘルパー（パラメーター付き） */
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

// ============================================================
// ホール
// ============================================================

export async function getAllHalls() {
  return query("SELECT id, name, code, memo FROM halls ORDER BY id");
}

export async function getHallById(hallId) {
  const rows = await query(
    "SELECT id, name, code, memo FROM halls WHERE id = $1",
    [hallId]
  );
  return rows[0] ?? null;
}

// ============================================================
// 台データ取得
// ============================================================

export async function getMachineData({ hallId, startDate, endDate, machineNumber }) {
  let sql = `
    SELECT
      date,
      machine_number,
      machine_name,
      game_count,
      difference_count,
      bb_count,
      rb_count,
      art_count,
      machine_memo
    FROM machine_data
    WHERE hall_id = $1
      AND date BETWEEN $2 AND $3
      AND machine_name IS NOT NULL
      AND machine_name != ''
  `;
  const params = [hallId, startDate, endDate];

  if (machineNumber != null) {
    params.push(machineNumber);
    sql += ` AND machine_number = $${params.length}`;
  }

  sql += " ORDER BY date, machine_number";
  return query(sql, params);
}

export async function getDailySummary({ hallId, date }) {
  return query(
    `
    SELECT
      machine_number,
      machine_name,
      game_count,
      difference_count,
      bb_count,
      rb_count,
      art_count,
      machine_memo
    FROM machine_data
    WHERE hall_id = $1
      AND date = $2
      AND machine_name IS NOT NULL
      AND machine_name != ''
    ORDER BY machine_number
    `,
    [hallId, date]
  );
}

export async function getHighGameCountMachines({ hallId, startDate, endDate, limit = 20 }) {
  return query(
    `
    SELECT
      machine_number,
      machine_name,
      COUNT(*)                                          AS days_played,
      SUM(game_count)                                   AS total_game_count,
      SUM(difference_count)                             AS total_difference,
      SUM(bb_count)                                     AS total_bb,
      SUM(rb_count)                                     AS total_rb,
      SUM(art_count)                                    AS total_art,
      ROUND(SUM(game_count)::numeric / COUNT(*), 0)     AS avg_game_count
    FROM machine_data
    WHERE hall_id = $1
      AND date BETWEEN $2 AND $3
      AND game_count > 0
      AND machine_name IS NOT NULL
      AND machine_name != ''
    GROUP BY machine_number, machine_name
    ORDER BY total_game_count DESC
    LIMIT $4
    `,
    [hallId, startDate, endDate, limit]
  );
}

export async function getHighDifferenceMachines({ hallId, startDate, endDate, limit = 20 }) {
  return query(
    `
    SELECT
      machine_number,
      machine_name,
      COUNT(*)                                          AS days_played,
      SUM(game_count)                                   AS total_game_count,
      SUM(difference_count)                             AS total_difference,
      SUM(bb_count)                                     AS total_bb,
      SUM(rb_count)                                     AS total_rb,
      SUM(art_count)                                    AS total_art,
      ROUND(SUM(difference_count)::numeric / COUNT(*), 0) AS avg_difference
    FROM machine_data
    WHERE hall_id = $1
      AND date BETWEEN $2 AND $3
      AND game_count > 0
      AND machine_name IS NOT NULL
      AND machine_name != ''
    GROUP BY machine_number, machine_name
    ORDER BY total_difference DESC
    LIMIT $4
    `,
    [hallId, startDate, endDate, limit]
  );
}

export async function getMachineStatsByName({ hallId, machineName, startDate, endDate }) {
  return query(
    `
    SELECT
      machine_number,
      machine_name,
      COUNT(*)                                            AS days_played,
      SUM(game_count)                                     AS total_game_count,
      SUM(difference_count)                               AS total_difference,
      SUM(bb_count)                                       AS total_bb,
      SUM(rb_count)                                       AS total_rb,
      SUM(art_count)                                      AS total_art,
      ROUND(SUM(game_count)::numeric / COUNT(*), 0)       AS avg_game_count,
      ROUND(SUM(difference_count)::numeric / COUNT(*), 0) AS avg_difference
    FROM machine_data
    WHERE hall_id = $1
      AND machine_name ILIKE $2
      AND date BETWEEN $3 AND $4
      AND game_count > 0
    GROUP BY machine_number, machine_name
    ORDER BY machine_number
    `,
    [hallId, `%${machineName}%`, startDate, endDate]
  );
}

export async function getWeekdayStats({ hallId, startDate, endDate, machineNumber }) {
  // EXTRACT(DOW FROM date): 0=日曜 〜 6=土曜
  let sql = `
    SELECT
      CASE EXTRACT(DOW FROM date)::INTEGER
        WHEN 0 THEN '日曜'
        WHEN 1 THEN '月曜'
        WHEN 2 THEN '火曜'
        WHEN 3 THEN '水曜'
        WHEN 4 THEN '木曜'
        WHEN 5 THEN '金曜'
        WHEN 6 THEN '土曜'
      END AS weekday,
      COUNT(*)                                        AS count,
      ROUND(AVG(game_count), 0)                       AS avg_game_count,
      ROUND(AVG(difference_count), 0)                 AS avg_difference,
      SUM(CASE WHEN difference_count > 1000 THEN 1 ELSE 0 END) AS high_diff_days
    FROM machine_data
    WHERE hall_id = $1
      AND date BETWEEN $2 AND $3
      AND game_count > 0
      AND machine_name IS NOT NULL
      AND machine_name != ''
  `;
  const params = [hallId, startDate, endDate];

  if (machineNumber != null) {
    params.push(machineNumber);
    sql += ` AND machine_number = $${params.length}`;
  }

  sql += " GROUP BY EXTRACT(DOW FROM date) ORDER BY EXTRACT(DOW FROM date)";
  return query(sql, params);
}

export async function getMachineNames(hallId) {
  const rows = await query(
    `
    SELECT DISTINCT machine_name
    FROM machine_data
    WHERE hall_id = $1
      AND machine_name IS NOT NULL
      AND machine_name != ''
    ORDER BY machine_name
    `,
    [hallId]
  );
  return rows.map((r) => r.machine_name);
}

export async function getDateRange(hallId) {
  const rows = await query(
    `
    SELECT
      MIN(date) AS oldest_date,
      MAX(date) AS latest_date,
      COUNT(DISTINCT date) AS total_days
    FROM machine_data
    WHERE hall_id = $1
      AND game_count > 0
    `,
    [hallId]
  );
  return rows[0] ?? null;
}

