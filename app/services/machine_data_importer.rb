class MachineDataImporter
  require "httparty"
  require "nokogiri"

  def initialize(url, hall_code, date)
    @url = url
    @hall_code = hall_code
    @date = date
  end

  def import
    Rails.logger.info "=== インポート開始 ==="
    Rails.logger.info "URL: #{@url}"
    Rails.logger.info "店舗コード: #{@hall_code}"
    Rails.logger.info "日付: #{@date}"

    hall = Hall.find_by(code: @hall_code)
    unless hall
      Rails.logger.error "エラー: 店舗が見つかりません"
      return { success: false, error: "店舗が見つかりません" }
    end
    Rails.logger.info "店舗: #{hall.name}"

    html = fetch_html
    Rails.logger.info "HTML取得完了 (#{html.length}文字)"
    Rails.logger.info "HTML最初の500文字: #{html[0..500]}"

    data_rows = parse_table(html)
    Rails.logger.info "パース結果: #{data_rows.length}行"

    return { success: true, count: 0 } if data_rows.empty?

    Rails.logger.info "最初の3行:"
    data_rows.first(3).each_with_index do |row, i|
      Rails.logger.info "  #{i+1}: #{row.inspect}"
    end

    # 既存データを削除（同じ日付のデータを上書き）
    deleted_count = hall.machine_data.where(date: @date).delete_all
    Rails.logger.info "既存データ削除: #{deleted_count}件"

    # バルクインサート用のデータを準備
    now = Time.current
    records = data_rows.map do |row_data|
      {
        hall_id: hall.id,
        date: @date,
        machine_number: row_data[:machine_number],
        machine_name: row_data[:machine_name],
        game_count: row_data[:game_count],
        difference_count: row_data[:difference_count],
        bb_count: row_data[:bb_count],
        rb_count: row_data[:rb_count],
        art_count: row_data[:art_count],
        created_at: now,
        updated_at: now
      }
    end

    # バルクインサート実行
    MachineData.insert_all(records)

    Rails.logger.info "インポート完了: #{records.length}件"
    { success: true, count: records.length }
  rescue => e
    Rails.logger.error "エラー発生: #{e.message}"
    Rails.logger.error e.backtrace.first(5).join("\n")
    { success: false, error: e.message }
  end

  private

  def fetch_html
    response = HTTParty.get(@url)
    response.body
  end

  def parse_table(html)
    doc = Nokogiri::HTML(html)
    rows = []

    # bl_allMachineTable内のテーブルを取得
    table = doc.at_css(".bl_allMachineTable .bl_table_data")
    unless table
      Rails.logger.warn "警告: .bl_allMachineTable .bl_table_dataが見つかりません"
      return rows
    end
    Rails.logger.info "テーブル発見"

    table.css("tr").each_with_index do |row, index|
      # ヘッダー行をスキップ
      if row["class"]&.include?("bl_table_data_group_header")
        next
      end

      # データ行のみ処理
      next unless row["class"]&.include?("bl_table_data_group")

      cells = row.css("td")
      next if cells.empty? || cells.length < 7

      # 列の順番: 0:機種名, 1:台番号, 2:G数, 3:差枚, 4:BB, 5:RB, 6:ART
      rows << {
        machine_name: cells[0]&.text&.strip || "",
        machine_number: cells[1]&.text&.strip&.to_i || 0,
        game_count: cells[2]&.text&.strip&.gsub(",", "")&.to_i || 0,
        difference_count: cells[3]&.text&.strip&.gsub(/[+,]/, "")&.to_i || 0,
        bb_count: cells[4]&.text&.strip&.to_i || 0,
        rb_count: cells[5]&.text&.strip&.to_i || 0,
        art_count: cells[6]&.text&.strip&.to_i || 0
      }
    end

    Rails.logger.info "パース完了: #{rows.length}行"
    rows
  end
end
