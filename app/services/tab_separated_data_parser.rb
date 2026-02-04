class TabSeparatedDataParser
  # タブ区切りデータをパースしてDBに保存
  # フォーマット: 機種\t台番\t差枚\tG数
  # ヘッダー行が途中に混在する可能性がある
  def parse_and_import(data_text, hall, date)
    lines = data_text.strip.split("\n").map(&:strip)
    return { success: false, error: "データが空です" } if lines.empty?

    records_to_insert = []
    errors = []

    lines.each_with_index do |line, index|
      next if line.empty?

      # ヘッダー行をスキップ（「機種」「台番」「差枚」「G数」「出率」を含む行）
      next if header_line?(line)

      # タブまたは複数スペースで分割
      parts = line.split(/\t+|\s{2,}/).map(&:strip)

      # 最低限必要な列数をチェック（機種、台番、差枚、G数）
      if parts.size < 4
        errors << "行#{index + 1}: データが不足しています（機種、台番、差枚、G数が必要）"
        next
      end

      machine_name = parts[0]
      machine_number = parts[1]
      difference_str = parts[2]
      games_str = parts[3]

      # パラメータのバリデーション
      next unless validate_params(machine_name, machine_number, difference_str, games_str, errors, index)

      # 数値に変換
      difference = parse_number(difference_str)
      games = parse_number(games_str)

      # 挿入用レコードを追加
      records_to_insert << {
        hall_id: hall.id,
        date: date,
        machine_number: machine_number.to_i,
        machine_name: machine_name,
        difference_count: difference,
        game_count: games,
        created_at: Time.current,
        updated_at: Time.current
      }
    rescue => e
      errors << "行#{index + 1}: エラー - #{e.message}"
    end

    # 一括insert実行
    if records_to_insert.any?
      begin
        # 該当日付のデータを先に削除（SQLite互換性）
        MachineData.where(hall_id: hall.id, date: date).delete_all
        # 一括insert
        MachineData.insert_all(records_to_insert)
        { success: true, count: records_to_insert.size }
      rescue => e
        { success: false, error: "データベースエラー: #{e.message}" }
      end
    else
      error_msg = errors.any? ? errors.first : "有効なデータが見つかりません"
      { success: false, error: error_msg }
    end
  end

  private

  # ヘッダー行の判定
  def header_line?(line)
    headers = %w[機種 台番 差枚 G数 出率]
    headers.any? { |header| line.include?(header) }
  end

  # パラメータバリデーション
  def validate_params(machine_name, machine_number, difference_str, games_str, errors, index)
    if machine_name.blank?
      errors << "行#{index + 1}: 機種名が空です"
      return false
    end

    if machine_number.blank?
      errors << "行#{index + 1}: 台番が空です"
      return false
    end

    unless machine_number.match?(/^\d+$/)
      errors << "行#{index + 1}: 台番は数字である必要があります"
      return false
    end

    if difference_str.blank?
      errors << "行#{index + 1}: 差枚が空です"
      return false
    end

    if games_str.blank?
      errors << "行#{index + 1}: G数が空です"
      return false
    end

    unless difference_str.match?(/^-?\d+(?:,\d{3})*(?:\.\d+)?$/)
      errors << "行#{index + 1}: 差枚の形式が不正です（例: 15,845 や -1000）"
      return false
    end

    unless games_str.match?(/^\d+(?:,\d{3})*(?:\.\d+)?$/)
      errors << "行#{index + 1}: G数の形式が不正です（例: 8,624）"
      return false
    end

    true
  end

  # 数値パース（カンマを除去）
  def parse_number(str)
    str.to_s.gsub(",", "").to_i
  end
end
