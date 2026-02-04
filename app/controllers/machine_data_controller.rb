class MachineDataController < ApplicationController
  # インポート関連アクション
  def import_form
    @halls = Hall.all
  end

  def import
    url = params[:url]
    hall_code = params[:hall_code]
    date = params[:date]

    importer = MachineDataImporter.new(url, hall_code, date)
    result = importer.import

    if result[:success]
      flash[:notice] = "#{result[:count]}件のデータをインポートしました"
      redirect_to halls_path
    else
      flash[:alert] = "エラー: #{result[:error]}"
      redirect_to import_form_machine_data_path
    end
  end

  def batch_import
    Rails.logger.info "=== batch_import started ==="
    Rails.logger.info "Params: #{params.inspect}"

    start_date = Date.parse(params[:start_date])
    end_date = Date.parse(params[:end_date])
    hall_ids = params[:hall_ids] || []

    Rails.logger.info "Start date: #{start_date}"
    Rails.logger.info "End date: #{end_date}"
    Rails.logger.info "Hall IDs: #{hall_ids.inspect}"

    if hall_ids.empty?
      flash[:alert] = "ホールを選択してください"
      redirect_to halls_path and return
    end

    total_imported = 0
    error_count = 0
    success_count = 0

    halls = Hall.where(id: hall_ids)

    halls.each do |hall|
      dates = (start_date..end_date).to_a

      dates.each do |date|
        url = "https://slo-navi.com/data/#{date.strftime('%Y-%m-%d')}-#{hall.code}/"

        importer = MachineDataImporter.new(url, hall.code, date)
        result = importer.import

        if result[:success]
          total_imported += result[:count]
          success_count += 1
        else
          error_count += 1
        end

        sleep(0.5)
      end
    end

    if error_count == 0
      flash[:notice] = "#{success_count}日分、合計#{total_imported}件のデータをインポートしました"
    else
      flash[:alert] = "#{success_count}日成功、#{error_count}日失敗。合計#{total_imported}件インポート"
    end

    redirect_to halls_path
  rescue => e
    flash[:alert] = "エラーが発生しました"
    redirect_to halls_path
  end

  # メインの表示アクション
  def show
    initialize_parameters
    load_machine_data
    calculate_past_data
    generate_summaries
    apply_filters_and_sorting
    prepare_view_data
  end

  # PDF出力アクション（Prawn版）
  # ホールマップをPDF形式でダウンロードする
  def export_map_pdf
    # パラメータから必要な情報を取得
    @hall = Hall.find_by(id: params[:hall_id])
    @date = Date.parse(params[:date])

    # マップデータを取得
    @hall_maps = HallMap.where(hall_id: @hall.id).order(:created_at)
    @current_map = @hall_maps.first # デフォルトマップ

    # 選択されたマップIDがあれば、そのマップを使用
    if params[:map_id].present?
      selected_map = @hall_maps.find_by(id: params[:map_id])
      @current_map = selected_map if selected_map
    end

    # 機種データを取得
    machine_data = MachineData.where(hall_id: @hall.id, date: @date)
    @machine_data_by_number = machine_data.index_by(&:machine_number)

    # ワーストランク情報を取得（カラーリング用） - デフォルト7日間
    @color_worst_ranks = calculate_color_worst_ranks(7)

    # 表示設定パラメータ
    display_settings = {
      show_machine_name: params[:show_machine_name] != "0",
      show_machine_number: params[:show_machine_number] != "0",
      show_diff: params[:show_diff] == "1",
      show_map_games: params[:show_map_games] == "1",
      show_bb: params[:show_bb] == "1"
    }
    # 色分け有効/条件
    color_settings = @current_map.get_color_settings.merge(
      "enabled" => params[:color_enabled] != "0",
      "condition" => params[:color_condition] || @current_map.get_color_settings["condition"]
    )

    # PDF生成サービスを呼び出し
    pdf_service = HallMapPdfService.new(
      hall: @hall,
      date: @date.to_s,
      hall_map: @current_map,
      machine_data_by_number: @machine_data_by_number,
      color_worst_ranks: @color_worst_ranks,
      display_settings: display_settings,
      color_settings: color_settings
    )

    # PDFを生成
    pdf_binary = pdf_service.generate

    # PDFファイルとしてダウンロードを開始
    send_data pdf_binary,
              filename: "#{@hall.name}_map_#{@date}.pdf",
              type: "application/pdf",
              disposition: "attachment" # ダウンロードダイアログを表示
  end

  # 台メモの更新（Ajax用）
  def update_machine_memo
    hall = Hall.find(params[:hall_id])
    date = Date.parse(params[:date])
    machine_number = params[:machine_number]
    memo = params[:memo]

    machine_data = hall.machine_data.find_by(date: date, machine_number: machine_number)

    if machine_data
      machine_data.update(machine_memo: memo)
      render json: { success: true }
    else
      render json: { success: false, error: "データが見つかりません" }, status: :not_found
    end
  end

  # 台メモの一括更新（Ajax用）
  def update_machine_memos
    hall = Hall.find(params[:hall_id])
    date = Date.parse(params[:date])
    memos = params[:memos] || {}

    updated_count = 0
    memos.each do |machine_number, memo|
      machine_data = hall.machine_data.find_by(date: date, machine_number: machine_number)
      if machine_data
        machine_data.update(machine_memo: memo)
        updated_count += 1
      end
    end

    render json: { success: true, updated_count: updated_count }
  rescue => e
    render json: { success: false, error: e.message }, status: :unprocessable_entity
  end

  private

  # ============================================================
  # 初期化・パラメータ設定
  # ============================================================

  def initialize_parameters
    @hall = Hall.find_by(id: params[:hall_id])
    @date = Date.parse(params[:date])

    # 表示設定
    @show_difference = params[:show_difference] != "0"
    @show_games = params[:show_games] == "1"

    # ソート設定
    @sort_by = params[:sort_by] || "machine_number"
    @sort_order = params[:sort_order] || "asc"

    # 表示日数
    @display_days = if params[:display_days].present?
                      params[:display_days].map(&:to_i).uniq.sort
    else
                      [ 7 ] # デフォルト値を7日に設定
    end

    # フィルター設定
    setup_filter_parameters
  end

  def setup_filter_parameters
    @filter_machine_name = params[:filter_machine_name]
    @filter_machine_name_search = params[:filter_machine_name_search]
    @filter_machine_name_search_type = params[:filter_machine_name_search_type] || "include"
    @filter_game_count_min = parse_int_param(:filter_game_count_min)
    @filter_game_count_max = parse_int_param(:filter_game_count_max)
    @filter_difference_min = parse_int_param(:filter_difference_min)
    @filter_difference_max = parse_int_param(:filter_difference_max)
    @filter_bb_count_min = parse_int_param(:filter_bb_count_min)
    @filter_bb_count_max = parse_int_param(:filter_bb_count_max)
    @filter_diff_days = parse_int_param(:filter_diff_days)
    @filter_diff_value_min = parse_int_param(:filter_diff_value_min)
    @filter_diff_value_max = parse_int_param(:filter_diff_value_max)
    @filter_game_count_days = parse_int_param(:filter_game_count_days)
    @filter_game_count_value_min = parse_int_param(:filter_game_count_value_min)
    @filter_game_count_value_max = parse_int_param(:filter_game_count_value_max)
    @filter_machine_count_min = parse_int_param(:filter_machine_count_min)
    @filter_machine_count_max = parse_int_param(:filter_machine_count_max)
    @filter_rank_days = parse_int_param(:filter_rank_days)
    @filter_ranks = params[:filter_ranks]&.map(&:to_i) || []
  end

  def parse_int_param(key)
    params[key].present? ? params[key].to_i : nil
  end

  # ============================================================
  # データ読み込み
  # ============================================================

  def load_machine_data
    @machine_data = @hall.machine_data.where(date: @date).order(:machine_number)

    if @machine_data.empty?
      load_reference_data
    else
      @data_exists = true
      @reference_date = nil
    end
  end

  def load_reference_data
    @data_exists = false
    @reference_date = find_latest_data_date(@hall, @date)

    if @reference_date
      reference_data = @hall.machine_data.where(date: @reference_date).order(:machine_number)
      @machine_data = create_empty_machine_data(reference_data)
    else
      @machine_data = []
    end
  end

  def create_empty_machine_data(reference_data)
    reference_data.map do |data|
      MachineData.new(
        hall_id: @hall.id,
        date: @date,
        machine_number: data.machine_number,
        machine_name: data.machine_name,
        game_count: 0,
        difference_count: 0,
        bb_count: 0,
        rb_count: 0,
        art_count: 0
      )
    end
  end

  def find_latest_data_date(hall, target_date)
    hall.machine_data
        .where("date < ?", target_date)
        .order(date: :desc)
        .limit(1)
        .pluck(:date)
        .first
  end

  # ============================================================
  # 過去データの計算
  # ============================================================

  def calculate_past_data
    calculate_diff_data
    calculate_game_count_data
  end

  def calculate_diff_data
    if @show_difference && @display_days.any?
      @diff_days = {}
      @diff_ranks = {}

      @display_days.each do |days|
        @diff_days[days] = calculate_sum_for_period(days, :difference_count)
        @diff_ranks[days] = calculate_ranks_by_machine_name(@machine_data, @diff_days[days])
      end
    else
      @diff_days = {}
      @diff_ranks = {}
    end
  end

  def calculate_game_count_data
    if @show_games && @display_days.any?
      @game_count_days = {}
      @game_count_ranks = {}

      @display_days.each do |days|
        @game_count_days[days] = calculate_sum_for_period(days, :game_count)
        @game_count_ranks[days] = calculate_ranks_by_machine_name(@machine_data, @game_count_days[days])
      end
    else
      @game_count_days = {}
      @game_count_ranks = {}
    end
  end

  # 指定期間の合計値を計算（汎用メソッド）
  def calculate_sum_for_period(days, column)
    start_date = @date - days.days
    end_date = @date - 1.day

    @hall.machine_data
         .where(date: start_date..end_date)
         .group(:machine_number)
         .sum(column)
  end

  # 機種名ごとにランキングを計算（汎用メソッド）
  def calculate_ranks_by_machine_name(machine_data, aggregated_data)
    grouped = machine_data.group_by(&:machine_name)
    ranks = {}

    grouped.each do |machine_name, machines|
      sorted = machines
        .select { |m| aggregated_data[m.machine_number] }
        .sort_by { |m| aggregated_data[m.machine_number] }

      ranks[sorted[0].machine_number] = 1 if sorted[0]
      ranks[sorted[1].machine_number] = 2 if sorted[1]
      ranks[sorted[2].machine_number] = 3 if sorted[2]
      ranks[sorted[3].machine_number] = 4 if sorted[3]
      ranks[sorted[4].machine_number] = 5 if sorted[4]
    end

    ranks
  end

  # ============================================================
  # 集計データの生成
  # ============================================================

  def generate_summaries
    # 日別集計データ
    date_range_param = params[:date_range] || "7"
    @daily_summary_data = generate_daily_summary(date_range_param)

    # 機種別集計データ（フィルター適用前）
    @machine_stats = calculate_machine_stats(@machine_data)
  end

  def calculate_machine_stats(machine_data)
    return [] if machine_data.empty?

    grouped = machine_data.group_by(&:machine_name)
    stats = []

    grouped.each do |machine_name, machines|
      total_machines = machines.count
      total_diff = machines.sum(&:difference_count)
      total_games = machines.sum(&:game_count)
      plus_machines = machines.count { |m| m.difference_count > 0 }

      avg_diff = total_machines > 0 ? (total_diff.to_f / total_machines).round : 0
      avg_games = total_machines > 0 ? (total_games.to_f / total_machines).round : 0
      win_rate = total_machines > 0 ? ((plus_machines.to_f / total_machines) * 100).round(1) : 0

      stats << {
        machine_name: machine_name,
        avg_diff: avg_diff,
        total_diff: total_diff,
        avg_games: avg_games,
        plus_machines: plus_machines,
        total_machines: total_machines,
        win_rate: win_rate
      }
    end

    # 平均差枚で降順ソート
    stats.sort_by! { |s| -s[:avg_diff] }

    # 順位を追加
    stats.each_with_index do |stat, index|
      stat[:rank] = index + 1
    end

    stats
  end

  def generate_daily_summary_for_current_date
    daily_machines = @hall.machine_data.where(date: @date)
    return [] if daily_machines.empty?

    filtered_machines = apply_filter_for_summary(daily_machines, @date)
    return [] if filtered_machines.empty?

    [ calculate_daily_stats(@date, filtered_machines) ]
  end

  def generate_daily_summary(date_range_param)
    end_date = @date
    target_dates = determine_target_dates(date_range_param, end_date)
    results = []

    target_dates.each do |target_date|
      daily_machines = @hall.machine_data.where(date: target_date)
      next if daily_machines.empty?

      filtered_machines = apply_filter_for_summary(daily_machines, target_date)
      next if filtered_machines.empty?

      results << calculate_daily_stats(target_date, filtered_machines)
    end

    results
  end

  def determine_target_dates(date_range_param, end_date)
    # カスタム日付選択の場合
    if date_range_param == "custom" && params[:custom_dates].present?
      custom_dates = params[:custom_dates].map { |d| Date.parse(d) rescue nil }.compact
      return custom_dates.sort.reverse
    end

    case date_range_param
    when "day_7"
      fetch_dates_by_day_numbers([ 7, 17, 27 ], end_date)
    when "day_1"
      fetch_dates_by_day_numbers([ 1, 11, 21, 31 ], end_date)
    when "day_8"
      fetch_dates_by_day_numbers([ 8, 18, 28 ], end_date)
    else
      days = date_range_param.to_i
      start_date = end_date - days.days
      (start_date..end_date).to_a.reverse
    end
  end

  def fetch_dates_by_day_numbers(day_numbers, end_date)
    @hall.machine_data
         .where("CAST(strftime('%d', date) AS INTEGER) IN (?)", day_numbers)
         .where("date <= ?", end_date)
         .select(:date)
         .distinct
         .order(date: :desc)
         .pluck(:date)
  end

  def calculate_daily_stats(date, machines)
    total_diff = machines.sum(&:difference_count)
    total_games = machines.sum(&:game_count)
    win_count = machines.count { |m| m.difference_count > 0 }
    machine_count = machines.size

    {
      date: date,
      machine_count: machine_count,
      total_difference: total_diff,
      win_count: win_count,
      win_rate: (win_count.to_f / machine_count * 100).round(1),
      avg_games: (total_games.to_f / machine_count).round,
      avg_difference: (total_diff.to_f / machine_count).round
    }
  end

  # ============================================================
  # フィルター処理
  # ============================================================

  def apply_filters_and_sorting
    # マップタブ用に全台データを保持（フィルター適用前）
    @all_machine_data = @machine_data.dup

    # フィルター適用
    @machine_data = apply_filter(@machine_data, @diff_days, @game_count_days)

    # フィルター後の集計
    @filtered_summary = calculate_filtered_summary(@machine_data)

    # ソート処理
    @machine_data = apply_sorting(@machine_data, @sort_by, @sort_order, @diff_days, @game_count_days)
  end

  def calculate_filtered_summary(machine_data)
    return nil if machine_data.empty?

    total_count = machine_data.count
    total_games = machine_data.sum(&:game_count)
    total_diff = machine_data.sum(&:difference_count)
    plus_machines = machine_data.count { |m| m.difference_count > 0 }

    {
      count: total_count,
      avg_games: total_count > 0 ? (total_games.to_f / total_count).round : 0,
      avg_diff: total_count > 0 ? (total_diff.to_f / total_count).round : 0,
      plus_machines: plus_machines,
      win_rate: total_count > 0 ? ((plus_machines.to_f / total_count) * 100).round(1) : 0
    }
  end

  def apply_filter(machine_data, diff_days, game_count_days)
    filtered = machine_data

    # 機種名フィルター
    filtered = apply_machine_name_filter(filtered)

    # 数値フィルター
    filtered = apply_numeric_filters(filtered)

    # 過去データフィルター
    filtered = apply_past_data_filters(filtered, diff_days, game_count_days)

    # 機種毎台数フィルター
    filtered = apply_machine_count_filter(filtered)

    # ワーストランキングフィルター
    filtered = apply_rank_filter(filtered)

    filtered
  end

  def apply_machine_name_filter(filtered)
    # ドロップダウンフィルター
    if @filter_machine_name.present?
      filtered = filtered.select { |m| m.machine_name == @filter_machine_name }
    end

    # 検索フィルター
    if @filter_machine_name_search.present?
      if @filter_machine_name_search_type == "include"
        filtered = filtered.select { |m| m.machine_name.include?(@filter_machine_name_search) }
      else
        filtered = filtered.select { |m| !m.machine_name.include?(@filter_machine_name_search) }
      end
    end

    filtered
  end

  def apply_numeric_filters(filtered)
    # G数フィルター
    filtered = apply_range_filter(filtered, :game_count, @filter_game_count_min, @filter_game_count_max)

    # 当日差枚フィルター
    filtered = apply_range_filter(filtered, :difference_count, @filter_difference_min, @filter_difference_max)

    # BB数フィルター
    filtered = apply_range_filter(filtered, :bb_count, @filter_bb_count_min, @filter_bb_count_max)

    filtered
  end

  def apply_range_filter(data, attribute, min_value, max_value)
    data = data.select { |m| m.send(attribute) >= min_value } if min_value.present?
    data = data.select { |m| m.send(attribute) <= max_value } if max_value.present?
    data
  end

  def apply_past_data_filters(filtered, diff_days, game_count_days)
    # 過去差枚フィルター
    if @filter_diff_days.present? && (@filter_diff_value_min.present? || @filter_diff_value_max.present?) && diff_days[@filter_diff_days]
      filtered = filtered.select do |m|
        diff_value = diff_days[@filter_diff_days][m.machine_number] || 0
        value_in_range?(diff_value, @filter_diff_value_min, @filter_diff_value_max)
      end
    end

    # 過去回転数フィルター
    if @filter_game_count_days.present? && (@filter_game_count_value_min.present? || @filter_game_count_value_max.present?) && game_count_days[@filter_game_count_days]
      filtered = filtered.select do |m|
        game_count_value = game_count_days[@filter_game_count_days][m.machine_number] || 0
        value_in_range?(game_count_value, @filter_game_count_value_min, @filter_game_count_value_max)
      end
    end

    filtered
  end

  def value_in_range?(value, min_value, max_value)
    passes_min = min_value.blank? || value >= min_value
    passes_max = max_value.blank? || value <= max_value
    passes_min && passes_max
  end

  def apply_machine_count_filter(filtered)
    if @filter_machine_count_min.present? || @filter_machine_count_max.present?
      machine_counts = filtered.group_by(&:machine_name).transform_values(&:count)

      filtered = filtered.select do |m|
        count = machine_counts[m.machine_name]
        value_in_range?(count, @filter_machine_count_min, @filter_machine_count_max)
      end
    end

    filtered
  end

  def apply_rank_filter(filtered)
    if @filter_rank_days.present? && @filter_ranks.present? && @diff_ranks[@filter_rank_days]
      filtered = filtered.select do |m|
        rank = @diff_ranks[@filter_rank_days][m.machine_number]
        @filter_ranks.include?(rank)
      end
    end

    filtered
  end

  def apply_filter_for_summary(machines, target_date)
    filtered = machines.to_a

    # 機種名フィルター
    filtered = apply_machine_name_filter(filtered)

    # 数値フィルター
    filtered = apply_numeric_filters(filtered)

    # 過去データフィルター（その日付時点での計算）
    filtered = apply_past_data_filters_for_date(filtered, target_date)

    # 機種毎台数フィルター
    filtered = apply_machine_count_filter(filtered)

    # ワーストランキングフィルター（その日付時点での計算）
    filtered = apply_rank_filter_for_date(filtered, target_date)

    filtered
  end

  def apply_past_data_filters_for_date(filtered, target_date)
    # 過去差枚フィルター
    if @filter_diff_days.present? && (@filter_diff_value_min.present? || @filter_diff_value_max.present?)
      diff_data = calculate_aggregated_data_for_date(target_date, @filter_diff_days, :difference_count)

      filtered = filtered.select do |m|
        diff_value = diff_data[m.machine_number] || 0
        value_in_range?(diff_value, @filter_diff_value_min, @filter_diff_value_max)
      end
    end

    # 過去回転数フィルター
    if @filter_game_count_days.present? && (@filter_game_count_value_min.present? || @filter_game_count_value_max.present?)
      game_count_data = calculate_aggregated_data_for_date(target_date, @filter_game_count_days, :game_count)

      filtered = filtered.select do |m|
        game_count_value = game_count_data[m.machine_number] || 0
        value_in_range?(game_count_value, @filter_game_count_value_min, @filter_game_count_value_max)
      end
    end

    filtered
  end

  def calculate_aggregated_data_for_date(target_date, days, column)
    start_date = target_date - days.days
    end_date = target_date - 1.day

    @hall.machine_data
         .where(date: start_date..end_date)
         .group(:machine_number)
         .sum(column)
  end

  def apply_rank_filter_for_date(filtered, target_date)
    if @filter_rank_days.present? && @filter_ranks.present?
      diff_data = calculate_aggregated_data_for_date(target_date, @filter_rank_days, :difference_count)
      ranks = calculate_ranks_by_machine_name(filtered, diff_data)

      filtered = filtered.select do |m|
        rank = ranks[m.machine_number]
        @filter_ranks.include?(rank)
      end
    end

    filtered
  end

  # ============================================================
  # ソート処理
  # ============================================================

  def apply_sorting(machine_data, sort_by, sort_order, diff_days, game_count_days)
    sorted_data = case sort_by
    when "machine_number"   then machine_data.sort_by(&:machine_number)
    when "machine_name"     then machine_data.sort_by(&:machine_name)
    when "game_count"       then machine_data.sort_by(&:game_count)
    when "difference_count" then machine_data.sort_by(&:difference_count)
    when "bb_count"         then machine_data.sort_by(&:bb_count)
    when "rb_count"         then machine_data.sort_by(&:rb_count)
    when "art_count"        then machine_data.sort_by(&:art_count)
    when /^diff_(\d+)$/
      days = Regexp.last_match(1).to_i
      machine_data.sort_by { |m| diff_days[days][m.machine_number] || 0 }
    when /^game_count_(\d+)$/
      days = Regexp.last_match(1).to_i
      machine_data.sort_by { |m| game_count_days[days][m.machine_number] || 0 }
    else
      machine_data.sort_by(&:machine_number)
    end

    sort_order == "desc" ? sorted_data.reverse : sorted_data
  end

  # ============================================================
  # ビュー用データの準備
  # ============================================================

  def prepare_view_data
    # ドロップダウン用機種一覧
    @machine_names = if @data_exists
                       @hall.machine_data.where(date: @date).pluck(:machine_name).uniq.sort
    elsif @reference_date
                       @hall.machine_data.where(date: @reference_date).pluck(:machine_name).uniq.sort
    else
                       []
    end

    # マップ用データ
    @hall_maps = @hall.hall_maps.order(:created_at)
    @current_map = @hall_maps.first
    # マップタブでは常に全台表示（フィルター適用なし）
    @machine_data_by_number = @all_machine_data.index_by(&:machine_number)

    # 色分け用データ
    @color_worst_ranks = calculate_color_worst_ranks(7)
  end

  # 色分け用：機種ごとの過去N日間総差枚ワーストランキング（全台対象）
  def calculate_color_worst_ranks(days)
    past_data = calculate_aggregated_data_for_date(@date, days, :difference_count)

    # 機種名を取得（当日データがない場合は参照日から取得）
    machine_info = if @data_exists
                     @hall.machine_data
                          .where(date: @date)
                          .select(:machine_number, :machine_name)
                          .index_by(&:machine_number)
    elsif @reference_date
                     @hall.machine_data
                          .where(date: @reference_date)
                          .select(:machine_number, :machine_name)
                          .index_by(&:machine_number)
    else
                     {}
    end

    # 機種名でグループ化
    grouped_by_name = Hash.new { |h, k| h[k] = [] }
    past_data.each do |machine_number, total_diff|
      machine_name = machine_info[machine_number]&.machine_name
      next unless machine_name

      grouped_by_name[machine_name] << { machine_number: machine_number, total_diff: total_diff }
    end

    # 各機種でワースト1, 2, 3, 4, 5を特定
    worst_ranks = {}
    grouped_by_name.each do |machine_name, machines|
      sorted = machines.sort_by { |m| m[:total_diff] }
      worst_ranks[sorted[0][:machine_number]] = 1 if sorted[0]
      worst_ranks[sorted[1][:machine_number]] = 2 if sorted[1]
      worst_ranks[sorted[2][:machine_number]] = 3 if sorted[2]
      worst_ranks[sorted[3][:machine_number]] = 4 if sorted[3]
      worst_ranks[sorted[4][:machine_number]] = 5 if sorted[4]
    end

    worst_ranks
  end
end
