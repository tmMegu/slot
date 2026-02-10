# 台データのフィルタリング・集計処理を提供する共通モジュール
# MachineDataController と TrendAnalysisController で共有
module MachineDataFilterable
  extend ActiveSupport::Concern

  private

  # ============================================================
  # パラメータ解析
  # ============================================================

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

    # 台番号末尾フィルター
    @filter_machine_last_digit = params[:filter_machine_last_digit]
    @filter_machine_double_digit = params[:filter_machine_double_digit] == "1"

    # 過去差枚フィルター（ワースト・ベスト）
    @filter_past_diff_days = parse_int_param(:filter_past_diff_days)
    @filter_past_diff_type = params[:filter_past_diff_type] || "worst" # worst or best
    
    # filter_past_diff_ranksの処理（文字列または配列に対応）
    if params[:filter_past_diff_ranks].present?
      @filter_past_diff_ranks = params[:filter_past_diff_ranks].is_a?(String) ?
        params[:filter_past_diff_ranks].split(',').map(&:to_i) :
        params[:filter_past_diff_ranks].map(&:to_i)
    else
      @filter_past_diff_ranks = []
    end

    # ベストランクフィルター（文字列または配列に対応）
    if params[:filter_best_ranks].present?
      @filter_best_ranks = params[:filter_best_ranks].is_a?(String) ?
        params[:filter_best_ranks].split(',').map(&:to_i) :
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
        params[:filter_ranks].split(',').map(&:to_i) :
        params[:filter_ranks].map(&:to_i)
    else
      @filter_ranks = []
    end
  end

  def parse_int_param(key)
    params[key].present? ? params[key].to_i : nil
  end

  # ============================================================
  # フィルター処理
  # ============================================================

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
    
    # 過去〇日間の範囲を計算
    start_date = base_date - @filter_past_diff_days.days
    end_date = base_date - 1.day
    
    # 台番号ごとの過去差枚合計を計算
    past_diff_totals = {}
    target_machines.each do |machine|
      total_diff = 0
      (start_date..end_date).each do |date|
        if machines_by_date[date]
          machine_data = machines_by_date[date].find { |m| m.machine_number == machine.machine_number }
          total_diff += machine_data.difference_count if machine_data
        end
      end
      past_diff_totals[machine.machine_number] = total_diff
    end
    
    # 機種名ごとにランキングを計算
    rank_type = @filter_past_diff_type == "best" ? :best : :worst
    past_diff_ranks = calculate_ranks_by_machine_name(target_machines, past_diff_totals, rank_type)
    
    # 指定されたランクの台のみを返す（複数選択対応）
    target_machines.select do |machine|
      rank = past_diff_ranks[machine.machine_number]
      rank.present? && @filter_past_diff_ranks.include?(rank)
    end
  end

  # ============================================================
  # 集計処理
  # ============================================================

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

  # 機種名ごとにランキングを計算（汎用メソッド）
  # rank_type: :worst（デフォルト、昇順でワースト）または :best（降順でベスト）
  def calculate_ranks_by_machine_name(machine_data, aggregated_data, rank_type = :worst)
    grouped = machine_data.group_by(&:machine_name)
    ranks = {}

    grouped.each do |machine_name, machines|
      sorted = machines
        .select { |m| aggregated_data[m.machine_number] }
        .sort_by { |m| rank_type == :best ? -aggregated_data[m.machine_number] : aggregated_data[m.machine_number] }

      ranks[sorted[0].machine_number] = 1 if sorted[0]
      ranks[sorted[1].machine_number] = 2 if sorted[1]
      ranks[sorted[2].machine_number] = 3 if sorted[2]
      ranks[sorted[3].machine_number] = 4 if sorted[3]
      ranks[sorted[4].machine_number] = 5 if sorted[4]
    end

    ranks
  end
end
