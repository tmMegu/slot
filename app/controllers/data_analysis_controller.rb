class DataAnalysisController < ApplicationController
  # データ分析画面の表示
  # 過去1年間のデータを1回のクエリで取得し、各種マトリクスを生成
  def show
    @hall = Hall.find_by(id: params[:hall_id])
    
    # 分析期間の設定（デフォルト1年間）
    @end_date = params[:end_date].present? ? Date.parse(params[:end_date]) : Date.today
    @start_date = params[:start_date].present? ? Date.parse(params[:start_date]) : (@end_date - 1.year)
    
    # カレンダー表示用の年月（デフォルトは最新月）
    @calendar_year = params[:calendar_year].present? ? params[:calendar_year].to_i : @end_date.year
    @calendar_month = params[:calendar_month].present? ? params[:calendar_month].to_i : @end_date.month
    
    # 全データを1回のクエリで取得（SQL最適化）
    load_analysis_data
    
    # 各マトリクス用のデータを生成
    generate_calendar_data
    generate_last_digit_matrices
    generate_weekday_matrices
    generate_week_number_matrix
    generate_machine_date_matrix
  end

  private

  # ============================================================
  # データ読み込み（SQL最適化）
  # ============================================================

  def load_analysis_data
    # 分析期間の全データを1回のクエリで取得
    @all_machine_data = @hall.machine_data
                             .where(date: @start_date..@end_date)
                             .select(:date, :machine_number, :machine_name, :game_count, :difference_count)
                             .order(:date, :machine_number)
                             .to_a
    
    # 日付ごとにグループ化（メモリ上で処理）
    @data_by_date = @all_machine_data.group_by(&:date)
    
    # 機種名一覧を取得
    @machine_names = @all_machine_data.map(&:machine_name).uniq.sort
  end

  # ============================================================
  # カレンダーマトリクス生成
  # ============================================================

  def generate_calendar_data
    # 指定月の日付範囲
    calendar_start = Date.new(@calendar_year, @calendar_month, 1)
    calendar_end = calendar_start.end_of_month
    
    @calendar_data = {}
    
    (calendar_start..calendar_end).each do |date|
      machines = @data_by_date[date] || []
      
      if machines.any?
        total_diff = machines.sum(&:difference_count)
        total_games = machines.sum(&:game_count)
        win_count = machines.count { |m| m.difference_count > 0 }
        
        @calendar_data[date.day] = {
          avg_diff: (total_diff.to_f / machines.size).round,
          avg_games: (total_games.to_f / machines.size).round,
          win_rate: (win_count.to_f / machines.size * 100).round(1),
          machine_count: machines.size
        }
      end
    end
  end

  # ============================================================
  # 末尾日×末尾番台マトリクス生成
  # ============================================================

  def generate_last_digit_matrices
    date_conditions = (0..9).to_a + ['ぞろ目', '月=日', '月末']
    machine_conditions = (0..9).to_a + ['ぞろ目', '月=日', '月末']

    # 日付条件ごとにデータを事前グループ化（全データスキャンを13回→169+7回分削減）
    by_date_cond = {}
    date_conditions.each do |cond|
      by_date_cond[cond] = @all_machine_data.select { |m| matches_date_condition?(m.date, cond) }
    end

    # 末尾日×末尾番台
    @last_digit_machine_matrix = {}
    date_conditions.each do |date_cond|
      @last_digit_machine_matrix[date_cond] = {}
      machine_conditions.each do |machine_cond|
        filtered = by_date_cond[date_cond].select { |m| matches_machine_condition?(m.machine_number, m.date, machine_cond) }
        @last_digit_machine_matrix[date_cond][machine_cond] = calculate_stats(filtered)
      end
    end

    # 末尾日×曜日
    @last_digit_weekday_matrix = {}
    date_conditions.each do |date_cond|
      @last_digit_weekday_matrix[date_cond] = {}
      (0..6).each do |wday|
        filtered = by_date_cond[date_cond].select { |m| m.date.wday == wday }
        @last_digit_weekday_matrix[date_cond][wday] = calculate_stats(filtered)
      end
    end
  end

  # ============================================================
  # 第〇×曜日マトリクス生成
  # ============================================================

  def generate_week_number_matrix
    # 週番号ごとに事前グループ化
    by_week = @all_machine_data.group_by { |m| ((m.date.day - 1) / 7) + 1 }

    @week_weekday_matrix = {}
    (1..5).each do |week_num|
      @week_weekday_matrix[week_num] = {}
      week_data = by_week[week_num] || []
      (0..6).each do |wday|
        @week_weekday_matrix[week_num][wday] = calculate_stats(week_data.select { |m| m.date.wday == wday })
      end
    end
  end

  # ============================================================
  # 曜日マトリクス生成
  # ============================================================

  def generate_weekday_matrices
    by_wday = @all_machine_data.group_by { |m| m.date.wday }
    @weekday_stats = (0..6).each_with_object({}) do |wday, h|
      h[wday] = calculate_stats(by_wday[wday] || [])
    end
  end

  # ============================================================
  # 日付×機種名マトリクス生成
  # ============================================================

  def generate_machine_date_matrix
    @machine_date_matrix = {}
    
    # 日付範囲を絞る（直近3ヶ月程度に制限してパフォーマンス向上）
    recent_start = [@end_date - 90.days, @start_date].max
    
    # 日付配列を生成
    @machine_date_dates = (recent_start..@end_date).to_a
    
    @machine_names.each do |machine_name|
      @machine_date_matrix[machine_name] = {}
      
      @machine_date_dates.each do |date|
        machines = @data_by_date[date]&.select { |m| m.machine_name == machine_name } || []
        
        if machines.any?
          @machine_date_matrix[machine_name][date] = calculate_stats(machines)
        end
      end
    end
  end

  # ============================================================
  # ヘルパーメソッド
  # ============================================================

  # 日付と機種の条件でデータをフィルタリング
  def filter_by_conditions(date_cond, machine_cond)
    @all_machine_data.select do |m|
      matches_date_condition?(m.date, date_cond) &&
      matches_machine_condition?(m.machine_number, m.date, machine_cond)
    end
  end

  # 日付が条件に合うかチェック
  def matches_date_condition?(date, condition)
    case condition
    when Integer
      date.day % 10 == condition
    when 'ぞろ目'
      date.day.to_s.chars.uniq.size == 1 && date.day >= 11
    when '月=日'
      date.month == date.day
    when '月末'
      date == date.end_of_month
    else
      false
    end
  end

  # 台番号が条件に合うかチェック
  def matches_machine_condition?(machine_number, date, condition)
    case condition
    when Integer
      machine_number % 10 == condition
    when 'ぞろ目'
      number_str = machine_number.to_s
      number_str.length >= 2 && number_str[-1] == number_str[-2]
    when '月=日'
      machine_number == date.day
    when '月末'
      # 月末は該当なし
      false
    else
      false
    end
  end

  # 統計情報を計算
  def calculate_stats(data)
    return nil if data.empty?
    
    # 日付ごとにグループ化して集計
    by_date = data.group_by(&:date)
    daily_stats = []
    
    by_date.each do |date, machines|
      total_diff = machines.sum(&:difference_count)
      total_games = machines.sum(&:game_count)
      win_count = machines.count { |m| m.difference_count > 0 }
      
      daily_stats << {
        avg_diff: (total_diff.to_f / machines.size).round,
        avg_games: (total_games.to_f / machines.size).round,
        win_rate: (win_count.to_f / machines.size * 100).round(1),
        machine_count: machines.size
      }
    end
    
    # 全期間の平均を計算
    {
      avg_diff: (daily_stats.sum { |s| s[:avg_diff] }.to_f / daily_stats.size).round,
      avg_games: (daily_stats.sum { |s| s[:avg_games] }.to_f / daily_stats.size).round,
      win_rate: (daily_stats.sum { |s| s[:win_rate] }.to_f / daily_stats.size).round(1),
      days_count: daily_stats.size,
      total_machines: data.size
    }
  end
end
