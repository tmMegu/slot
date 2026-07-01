require "benchmark"

# 傾向分析を行うコントローラー
#
# 主な機能:
#   - show: 過去データから高設定の傾向を分析
#     - 機種名フィルタリング（AND/OR検索）
#     - 数値範囲フィルタリング（G数・差枚・BB回数）
#     - 台番号末尾・ぞろ目・偶奇フィルタリング
#     - 過去差枚のワースト/ベスト分析
#     - 日別集計統計の表示
#
# フィルタリング・集計の共通処理は MachineDataFilterable をincludeして利用
class TrendAnalysisController < ApplicationController
  include MachineDataFilterable

  # 既定の解析期間（日数）。重い処理になるため短めに。
  DEFAULT_ANALYSIS_DAYS = 90
  # 解析期間の最大日数（OOM 防止のためのハードキャップ）
  MAX_ANALYSIS_DAYS = 365

  # 傾向調査画面の表示
  # 過去の全台データを参照して、高設定を入れる台の傾向を調査
  def show
    @hall = Hall.find_by(id: params[:hall_id])

    # セッションキーを設定
    @session_key = "trend_analysis_filters"

    # リセットフラグがあればセッションを削除
    if params[:reset_filters] == "1"
      session.delete(@session_key)
      redirect_to hall_trend_analysis_path(@hall) and return
    end

    # セッションから検索条件を復元（パラメータが指定されていない場合）
    restore_from_session_if_needed

    # パラメータ初期化
    initialize_analysis_parameters

    # フィルター設定
    setup_filter_parameters

    # セッションに保存
    save_to_session

    # 計測しながら各処理を実行
    @perf_metrics = {}
    @perf_metrics[:load_ms]          = (Benchmark.realtime { load_analysis_data } * 1000).round
    @perf_metrics[:date_list_ms]     = (Benchmark.realtime { generate_date_list } * 1000).round
    @perf_metrics[:daily_summary_ms] = (Benchmark.realtime { generate_filtered_daily_summary } * 1000).round
    @perf_metrics[:total_records]    = @all_machine_data.length
    @perf_metrics[:analysis_days]    = (@analysis_end_date - @analysis_start_date).to_i + 1
    @perf_metrics[:target_dates]     = @target_dates.length
    @perf_metrics[:result_days]      = @daily_summary.length
    @perf_metrics[:total_ms]         = @perf_metrics[:load_ms] + @perf_metrics[:date_list_ms] + @perf_metrics[:daily_summary_ms]

    Rails.logger.info "[TrendAnalysis hall=#{@hall&.id}] #{@perf_metrics.map { |k, v| "#{k}=#{v}" }.join(' ')}"
  end

  private

  # ============================================================
  # 初期化・パラメータ設定
  # ============================================================

  def initialize_analysis_parameters
    # データ分析対象期間（どのデータを使って分析するか）
    @analysis_start_date = get_param_or_session_date(:analysis_start_date, Date.today - DEFAULT_ANALYSIS_DAYS.days)
    @analysis_end_date = get_param_or_session_date(:analysis_end_date, Date.today)

    # ハードキャップ: 期間が長すぎる場合は開始日を引き戻して制限し、警告を出す
    span_days = (@analysis_end_date - @analysis_start_date).to_i + 1
    if span_days > MAX_ANALYSIS_DAYS
      @analysis_start_date = @analysis_end_date - (MAX_ANALYSIS_DAYS - 1).days
      flash.now[:notice] = "解析期間が長すぎたため、#{MAX_ANALYSIS_DAYS}日分（#{@analysis_start_date} 〜 #{@analysis_end_date}）に制限しました"
    end

    # 表示日付範囲（どの日付を一覧に表示するか）
    @display_date_mode = get_param_or_session(:display_date_mode, "all") # all, last_digit, day_number, custom
    @display_last_digit = get_param_or_session(:display_last_digit, nil) # 0-9
    @display_day_number = get_param_or_session(:display_day_number, nil) # 1-31

    # 配列データの復元
    if params[:display_custom_dates].present?
      @display_custom_dates = params[:display_custom_dates]
    elsif session[@session_key] && session[@session_key][:display_custom_dates].present?
      @display_custom_dates = session[@session_key][:display_custom_dates].is_a?(String) ?
        session[@session_key][:display_custom_dates].split(",") :
        session[@session_key][:display_custom_dates]
    else
      @display_custom_dates = []
    end

    # 表示順
    @sort_order = get_param_or_session(:sort_order, "desc") # desc: 新しい順, asc: 古い順
  end

  # setup_filter_parametersをオーバーライドしてセッションから配列を復元
  def setup_filter_parameters
    super

    # 過去差枚フィルターの順位配列を復元（paramsも文字列の可能性がある）
    if params[:filter_past_diff_ranks].present?
      @filter_past_diff_ranks = params[:filter_past_diff_ranks].is_a?(String) ?
        params[:filter_past_diff_ranks].split(",").map(&:to_i) :
        params[:filter_past_diff_ranks].map(&:to_i)
    elsif session[@session_key] && session[@session_key][:filter_past_diff_ranks].present?
      @filter_past_diff_ranks = session[@session_key][:filter_past_diff_ranks].is_a?(String) ?
        session[@session_key][:filter_past_diff_ranks].split(",").map(&:to_i) :
        session[@session_key][:filter_past_diff_ranks]
    else
      @filter_past_diff_ranks = []
    end

    # 上位機種表示フィルター
    @show_top_machines_1 = params[:show_top_machines_1] == "1" || session[@session_key]&.dig(:show_top_machines_1) == "1"
    @show_top_machines_2 = params[:show_top_machines_2] == "1" || session[@session_key]&.dig(:show_top_machines_2) == "1"
    @show_top_machines_3 = params[:show_top_machines_3] == "1" || session[@session_key]&.dig(:show_top_machines_3) == "1"
  end

  # get_param_or_session は MachineDataFilterable から継承

  # パラメータまたはセッションから日付を取得
  def get_param_or_session_date(key, default_value)
    if params[key].present?
      Date.parse(params[key])
    elsif session[@session_key] && session[@session_key][key]
      Date.parse(session[@session_key][key])
    else
      default_value
    end
  end

  # セッションから検索条件を復元（パラメータが何も指定されていない場合のみ）
  def restore_from_session_if_needed
    # パラメータが何も指定されていない場合、セッションから復元
    filter_keys = %w[analysis_start_date analysis_end_date display_date_mode filter_machine_name filter_difference_min filter_difference_max]
    if params.keys.none? { |k| filter_keys.include?(k) || k.start_with?("filter_") }
      if session[@session_key]
        session[@session_key].each do |key, value|
          params[key] = value unless params[key].present?
        end
      end
    end
  end

  # セッションに検索条件を保存（サイズ最適化）
  def save_to_session
    session[@session_key] ||= {}
    session[@session_key][:analysis_start_date] = @analysis_start_date.to_s
    session[@session_key][:analysis_end_date] = @analysis_end_date.to_s

    session_values = {
      display_date_mode:            @display_date_mode,
      display_last_digit:           @display_last_digit,
      display_day_number:           @display_day_number,
      display_custom_dates:         @display_custom_dates,
      sort_order:                   @sort_order,
      filter_machine_name:          @filter_machine_name,
      filter_machine_name_search:   @filter_machine_name_search,
      filter_machine_name_search_type: @filter_machine_name_search_type,
      filter_machine_name_operator: @filter_machine_name_operator,
      filter_machine_last_digit:    @filter_machine_last_digit,
      filter_machine_double_digit:  @filter_machine_double_digit ? "1" : nil,
      filter_machine_parity:        @filter_machine_parity,
      filter_difference_min:        @filter_difference_min,
      filter_difference_max:        @filter_difference_max,
      filter_game_count_min:        @filter_game_count_min,
      filter_game_count_max:        @filter_game_count_max,
      filter_bb_count_min:          @filter_bb_count_min,
      filter_bb_count_max:          @filter_bb_count_max,
      filter_machine_count_min:     @filter_machine_count_min,
      filter_machine_count_max:     @filter_machine_count_max,
      filter_past_diff_days:        @filter_past_diff_days,
      filter_past_diff_type:        @filter_past_diff_type,
      filter_past_diff_ranks:       @filter_past_diff_ranks,
      filter_past_negative_days:    @filter_past_negative_days,
      filter_negative_count_days:   @filter_negative_count_days,
      filter_negative_count_min:    @filter_negative_count_min,
      filter_negative_count_max:    @filter_negative_count_max,
      show_top_machines_1:          @show_top_machines_1 ? "1" : nil,
      show_top_machines_2:          @show_top_machines_2 ? "1" : nil,
      show_top_machines_3:          @show_top_machines_3 ? "1" : nil
    }

    session_values.each do |key, value|
      if value.is_a?(Array)
        value.any? ? session[@session_key][key] = value.join(",") : session[@session_key].delete(key)
      elsif value.present?
        session[@session_key][key] = value
      else
        session[@session_key].delete(key)
      end
    end
  end

  # ============================================================
  # データ読み込み
  # ============================================================

  def load_analysis_data
    # AR オブジェクトではなく pluck → 軽量 Struct に変換することでメモリ削減（約 1/7）
    rows = @hall.machine_data
                .where(date: @analysis_start_date..@analysis_end_date)
                .order(:date, :machine_number)
                .pluck(:id, :date, :machine_number, :machine_name, :game_count, :difference_count, :bb_count, :rb_count, :art_count)

    @all_machine_data = rows.map { |r| MachineDataFilterable::MachineDatum.new(*r) }

    # 日付ごとにグループ化
    @machines_by_date = @all_machine_data.group_by(&:date)

    # 機種名一覧（フィルター用）
    @machine_names = @all_machine_data.map(&:machine_name).uniq.sort
  end

  # ============================================================
  # 日付一覧の生成
  # ============================================================

  def generate_date_list
    # 実際にデータが存在する日付を取得
    existing_dates = @machines_by_date.keys

    # 表示モードに応じて日付をフィルタリング
    @target_dates = case @display_date_mode
    when "day_7"
      # 7のつく日（7, 17, 27日）
      existing_dates.select { |d| [ 7, 17, 27 ].include?(d.day) }
    when "day_1"
      # 1のつく日（1, 11, 21, 31日）
      existing_dates.select { |d| [ 1, 11, 21, 31 ].include?(d.day) }
    when "day_8"
      # 8のつく日（8, 18, 28日）
      existing_dates.select { |d| [ 8, 18, 28 ].include?(d.day) }
    when "last_digit"
      # 末尾指定（例：末尾が5の日 → 5, 15, 25日）
      if @display_last_digit.present?
        digit = @display_last_digit.to_i
        existing_dates.select { |d| d.day.to_s[-1].to_i == digit }
      else
        existing_dates
      end
    when "day_number"
      # 特定の日付（例：毎月5日）
      if @display_day_number.present?
        day_num = @display_day_number.to_i
        existing_dates.select { |d| d.day == day_num }
      else
        existing_dates
      end
    when "custom"
      # カスタム日付選択
      if @display_custom_dates.present?
        custom_dates = @display_custom_dates.map { |d| Date.parse(d) rescue nil }.compact
        existing_dates & custom_dates
      else
        existing_dates
      end
    else
      # 全日付
      existing_dates
    end

    # ソート順を適用
    @target_dates = @sort_order == "asc" ? @target_dates.sort : @target_dates.sort.reverse
  end

  # ============================================================
  # 集計データの生成（フィルター適用）
  # ============================================================

  def generate_filtered_daily_summary
    @daily_summary = []

    @target_dates.each do |date|
      machines = @machines_by_date[date]
      next if machines.nil? || machines.empty?

      # フィルター適用（日付も渡す）
      filtered_machines = apply_filters(machines, date)
      next if filtered_machines.empty?

      # 集計データを生成
      @daily_summary << calculate_daily_stats(date, filtered_machines)
    end
  end

  def apply_filters(machines, date = nil)
    filtered = machines

    # 機種名フィルター
    filtered = apply_machine_name_filter(filtered)

    # 数値フィルター
    filtered = apply_numeric_filters(filtered)

    # 機種毎台数フィルター
    filtered = apply_machine_count_filter(filtered)

    # 過去差枚フィルター（ワースト・ベスト）
    if date && @filter_past_diff_days.present?
      filtered = apply_past_diff_filter(@machines_by_date, filtered, date)
    end

    # 過去差枚がマイナスの台フィルター
    if date && @filter_past_negative_days.present?
      filtered = apply_past_negative_filter(@machines_by_date, filtered, date)
    end

    # 過去N日の差枚合計フィルター（閾値ベース）
    if date && @filter_past_total_days.present?
      filtered = apply_past_total_diff_filter(@machines_by_date, filtered, date)
    end

    # 過去マイナスになった日数フィルター
    if date && @filter_negative_count_days.present?
      filtered = apply_negative_count_filter(@machines_by_date, filtered, date)
    end

    filtered
  end

  def calculate_daily_stats(date, filtered_machines)
    stats = super

    # 上位機種の算出（表示フラグがONの場合のみ）
    if @show_top_machines_1 || @show_top_machines_2 || @show_top_machines_3
      top_machines = calculate_top_machines(filtered_machines)
      stats[:top_machine_1] = top_machines[0] if @show_top_machines_1
      stats[:top_machine_2] = top_machines[1] if @show_top_machines_2
      stats[:top_machine_3] = top_machines[2] if @show_top_machines_3
    end

    stats
  end

  def calculate_top_machines(machines)
    # 機種ごとの平均差枚、平均回転数、勝率を計算
    machine_stats = machines.group_by(&:machine_name).map do |name, ms|
      avg_diff = (ms.sum(&:difference_count).to_f / ms.size).round
      avg_games = (ms.sum(&:game_count).to_f / ms.size).round
      plus_count = ms.count { |m| m.difference_count > 0 }
      total_count = ms.size
      win_rate = total_count > 0 ? (plus_count.to_f / total_count * 100).round(1) : 0

      # 機種名を8文字に調整（不足分は全角空白で埋める）
      formatted_name = if name.length > 8
                         name[0, 8]
      else
                         name + "　" * (8 - name.length)
      end

      {
        name: formatted_name,
        full_name: name,
        avg_diff: avg_diff,
        avg_games: avg_games,
        count: total_count,
        plus_count: plus_count,
        win_rate: win_rate
      }
    end

    # 平均差枚でソートして上位3つを取得
    machine_stats.sort_by { |m| -m[:avg_diff] }.take(3)
  end
end
