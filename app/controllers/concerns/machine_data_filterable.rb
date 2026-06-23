# 台データのフィルタリング・集計処理を提供する共通モジュール
# MachineDataController と TrendAnalysisController で共有
module MachineDataFilterable
  extend ActiveSupport::Concern

  # pluck 経由でメモリ削減して扱うための軽量 Struct
  # ActiveRecord オブジェクトの代わりに使用することで、1台あたりのメモリ使用量を約 1/7 に削減
  MachineDatum = Struct.new(:id, :date, :machine_number, :machine_name, :game_count, :difference_count, :bb_count, :rb_count, :art_count)

  private

  # ============================================================
  # パラメータ解析
  # ============================================================

  def setup_filter_parameters
    @filter_machine_name = params[:filter_machine_name]
    @filter_machine_name_search = params[:filter_machine_name_search]
    @filter_machine_name_search_type = params[:filter_machine_name_search_type] || "include"
    @filter_machine_name_operator = params[:filter_machine_name_operator] || "or" # or or and
    @filter_game_count_min = parse_int_param(:filter_game_count_min)
    @filter_game_count_max = parse_int_param(:filter_game_count_max)
    @filter_difference_min = parse_int_param(:filter_difference_min)
    @filter_difference_max = parse_int_param(:filter_difference_max)
    @filter_bb_count_min = parse_int_param(:filter_bb_count_min)
    @filter_bb_count_max = parse_int_param(:filter_bb_count_max)

    # 台番号末尾フィルター
    @filter_machine_last_digit = params[:filter_machine_last_digit]
    @filter_machine_double_digit = params[:filter_machine_double_digit] == "1"
    @filter_machine_parity = params[:filter_machine_parity] # even, odd, または nil

    # 過去差枚フィルター（ワースト・ベスト）
    @filter_past_diff_days = parse_int_param(:filter_past_diff_days)
    @filter_past_diff_type = params[:filter_past_diff_type] || "worst" # worst or best

    # filter_past_diff_ranksの処理（文字列または配列に対応）
    if params[:filter_past_diff_ranks].present?
      @filter_past_diff_ranks = params[:filter_past_diff_ranks].is_a?(String) ?
        params[:filter_past_diff_ranks].split(",").map(&:to_i) :
        params[:filter_past_diff_ranks].map(&:to_i)
    else
      @filter_past_diff_ranks = []
    end

    # 過去差枚がマイナスの台フィルター
    @filter_past_negative_days = parse_int_param(:filter_past_negative_days)

    # 過去7日間でマイナスになった日数フィルター
    @filter_negative_count_days = parse_int_param(:filter_negative_count_days) # デフォルト7日間
    @filter_negative_count_min = parse_int_param(:filter_negative_count_min)
    @filter_negative_count_max = parse_int_param(:filter_negative_count_max)

    # ベストランクフィルター（文字列または配列に対応）
    if params[:filter_best_ranks].present?
      @filter_best_ranks = params[:filter_best_ranks].is_a?(String) ?
        params[:filter_best_ranks].split(",").map(&:to_i) :
        params[:filter_best_ranks].map(&:to_i)
    else
      @filter_best_ranks = []
    end

    @filter_best_rank_days = parse_int_param(:filter_best_rank_days)
    @filter_diff_days = parse_int_param(:filter_diff_days)
    @filter_diff_value_min = parse_int_param(:filter_diff_value_min)
    @filter_diff_value_max = parse_int_param(:filter_diff_value_max)
    @filter_game_count_days = parse_int_param(:filter_game_count_days)
    @filter_game_count_value_min = parse_int_param(:filter_game_count_value_min)
    @filter_game_count_value_max = parse_int_param(:filter_game_count_value_max)
    @filter_machine_count_min = parse_int_param(:filter_machine_count_min)
    @filter_machine_count_max = parse_int_param(:filter_machine_count_max)
    @filter_rank_days = parse_int_param(:filter_rank_days)

    # filter_ranksの処理（文字列または配列に対応）
    if params[:filter_ranks].present?
      @filter_ranks = params[:filter_ranks].is_a?(String) ?
        params[:filter_ranks].split(",").map(&:to_i) :
        params[:filter_ranks].map(&:to_i)
    else
      @filter_ranks = []
    end
  end

  def parse_int_param(key)
    params[key].present? ? params[key].to_i : nil
  end

  # パラメータまたはセッションから値を取得（@session_key が設定されていること）
  def get_param_or_session(key, default_value)
    if params[key].present?
      params[key]
    elsif session[@session_key] && session[@session_key][key]
      session[@session_key][key]
    else
      default_value
    end
  end

  # ============================================================
  # フィルター処理
  # ============================================================

  def apply_machine_name_filter(filtered)
    # ドロップダウンフィルター
    if @filter_machine_name.present?
      filtered = filtered.select { |m| m.machine_name == @filter_machine_name }
    end

    # 検索フィルター（複数条件対応）
    if @filter_machine_name_search.present?
      search_terms = @filter_machine_name_search.split(/[\s　]+/).map(&:strip).reject(&:empty?)

      if search_terms.any?
        if @filter_machine_name_operator == "and"
          # AND検索：全ての検索語を含む
          filtered = filtered.select do |m|
            if @filter_machine_name_search_type == "include"
              search_terms.all? { |term| m.machine_name.include?(term) }
            else
              search_terms.all? { |term| !m.machine_name.include?(term) }
            end
          end
        else
          # OR検索：いずれかの検索語を含む
          filtered = filtered.select do |m|
            if @filter_machine_name_search_type == "include"
              search_terms.any? { |term| m.machine_name.include?(term) }
            else
              search_terms.any? { |term| !m.machine_name.include?(term) }
            end
          end
        end
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

    # 台番号末尾フィルター
    if @filter_machine_last_digit.present?
      filtered = filtered.select { |m| m.machine_number.to_s[-1] == @filter_machine_last_digit }
    end

    # 台番号末尾2桁ぞろ目フィルター
    if @filter_machine_double_digit
      filtered = filtered.select do |m|
        number_str = m.machine_number.to_s
        number_str.length >= 2 && number_str[-1] == number_str[-2]
      end
    end

    # 台番号偶数・奇数フィルター
    if @filter_machine_parity.present?
      if @filter_machine_parity == "even"
        filtered = filtered.select { |m| m.machine_number.even? }
      elsif @filter_machine_parity == "odd"
        filtered = filtered.select { |m| m.machine_number.odd? }
      end
    end

    filtered
  end

  def apply_range_filter(data, attribute, min_value, max_value)
    data = data.select { |m| m.send(attribute) >= min_value } if min_value.present?
    data = data.select { |m| m.send(attribute) <= max_value } if max_value.present?
    data
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

  def value_in_range?(value, min_value, max_value)
    passes_min = min_value.blank? || value >= min_value
    passes_max = max_value.blank? || value <= max_value
    passes_min && passes_max
  end

  # 過去差枚フィルター（ワースト・ベスト）
  # machines_by_date: 日付ごとの台データのハッシュ { date => [machine_data] }
  # target_machines: フィルター対象の台データ配列
  def apply_past_diff_filter(machines_by_date, target_machines, base_date)
    return target_machines unless @filter_past_diff_days.present? && @filter_past_diff_ranks.any?

    start_date = base_date - @filter_past_diff_days.days
    end_date = base_date - 1.day

    # 台番号ごとの過去差枚合計をハッシュで高速構築
    past_diff_totals = Hash.new(0)
    (start_date..end_date).each do |date|
      next unless machines_by_date[date]
      machines_by_date[date].each { |m| past_diff_totals[m.machine_number] += m.difference_count }
    end

    rank_type = @filter_past_diff_type == "best" ? :best : :worst
    past_diff_ranks = calculate_ranks_by_machine_name(target_machines, past_diff_totals, rank_type)

    target_machines.select do |machine|
      rank = past_diff_ranks[machine.machine_number]
      rank.present? && @filter_past_diff_ranks.include?(rank)
    end
  end

  # 過去差枚がマイナスの台フィルター
  def apply_past_negative_filter(machines_by_date, target_machines, base_date)
    return target_machines unless @filter_past_negative_days.present?

    start_date = base_date - @filter_past_negative_days.days
    end_date = base_date - 1.day

    past_diff_totals = Hash.new(0)
    (start_date..end_date).each do |date|
      next unless machines_by_date[date]
      machines_by_date[date].each { |m| past_diff_totals[m.machine_number] += m.difference_count }
    end

    target_machines.select { |machine| past_diff_totals[machine.machine_number] < 0 }
  end

  # 過去〇日間でマイナスになった日数フィルター
  def apply_negative_count_filter(machines_by_date, target_machines, base_date)
    return target_machines unless @filter_negative_count_days.present? && (@filter_negative_count_min.present? || @filter_negative_count_max.present?)

    start_date = base_date - @filter_negative_count_days.days
    end_date = base_date - 1.day

    # 台番号ごとのマイナス日数をハッシュで高速構築
    negative_counts = Hash.new(0)
    (start_date..end_date).each do |date|
      next unless machines_by_date[date]
      machines_by_date[date].each { |m| negative_counts[m.machine_number] += 1 if m.difference_count < 0 }
    end

    target_machines.select { |machine| value_in_range?(negative_counts[machine.machine_number], @filter_negative_count_min, @filter_negative_count_max) }
  end

  # ============================================================
  # 集計処理
  # ============================================================

  def calculate_daily_stats(date, machines)
    total_diff = machines.sum(&:difference_count)
    total_games = machines.sum(&:game_count)
    plus_machines = machines.count { |m| m.difference_count > 0 }
    machine_count = machines.size

    {
      date: date,
      machine_count: machine_count,
      total_diff: total_diff,
      total_games: total_games,
      avg_diff: machine_count > 0 ? (total_diff.to_f / machine_count).round : 0,
      avg_games: machine_count > 0 ? (total_games.to_f / machine_count).round : 0,
      plus_machines: plus_machines,
      win_rate: machine_count > 0 ? (plus_machines.to_f / machine_count * 100).round(1) : 0.0
    }
  end

  # 機種名ごとにランキングを計算（汎用メソッド）
  # rank_type: :worst（デフォルト、昇順でワースト）または :best（降順でベスト）
  def calculate_ranks_by_machine_name(machine_data, aggregated_data, rank_type = :worst)
    grouped = machine_data.group_by(&:machine_name)
    ranks = {}

    grouped.each do |machine_name, machines|
      sorted = machines
        .select { |m| aggregated_data[m.machine_number] }
        .sort_by { |m| rank_type == :best ? -aggregated_data[m.machine_number] : aggregated_data[m.machine_number] }

      sorted.each_with_index { |m, i| ranks[m.machine_number] = i + 1 }
    end

    ranks
  end
end
