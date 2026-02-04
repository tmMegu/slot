class HallsController < ApplicationController
  # ホール一覧表示
  def index
    @halls = Hall.all
  end

  # ホール詳細と日付一覧表示
  def show
    @hall = find_hall
    setup_date_range
    load_date_data
  end

  # 新規ホール作成フォーム
  def new
    @hall = Hall.new
  end

  # ホール作成処理
  def create
    hall = Hall.new(hall_params)
    if hall.save
      redirect_to halls_path, notice: "ホールを作成しました。"
    else
      @hall = hall
      render :new
    end
  end

  # ホール削除処理
  def destroy
    hall = find_hall
    hall.destroy
    redirect_to halls_path, notice: "ホールを削除しました。"
  end

  # ホール編集フォーム
  def edit
    @hall = find_hall
  end

  # 日付メモの一括更新
  def update_date_memos
    hall = find_hall
    memos = params[:memos] || {}

    updated_count = 0

    memos.each do |date_str, memo_text|
      date = Date.parse(date_str)
      # その日付の全データを更新
      hall.machine_data.where(date: date).update_all(date_memo: memo_text)
      updated_count += 1
    end

    render json: { success: true, updated_count: updated_count }
  rescue => e
    render json: { success: false, error: e.message }, status: :unprocessable_entity
  end

  # ホール更新処理
  def update
    hall = find_hall
    if hall.update(hall_params)
      redirect_to halls_path, notice: "ホールを更新しました。"
    else
      @hall = hall
      render :edit
    end
  end

  private

  # Strong Parameters
  def hall_params
    params.permit(:name, :code, :memo)
  end

  # ホールを検索
  def find_hall
    Hall.find_by(id: params[:id])
  end

  # 日付範囲を設定
  def setup_date_range
    if params[:start_date].present? && params[:end_date].present?
      @start_date = Date.parse(params[:start_date])
      @end_date = Date.parse(params[:end_date])
    else
      # デフォルト: 1ヶ月前から2日後まで
      @start_date = Date.today - 1.month
      @end_date = Date.today + 2.days
    end
  end

  # 日付関連データを読み込み
  def load_date_data
    # 日付の範囲を配列で生成（新しい順）
    @dates = (@start_date..@end_date).to_a.reverse

    # 実際にデータが存在する日付を取得
    @existing_dates = @hall.machine_data.select(:date).distinct.pluck(:date).to_set

    # 各日付の集計データを計算
    @date_stats = calculate_date_stats(@hall, @dates)

    # 各日付のメモを取得
    @date_memos = fetch_date_memos(@hall, @dates)
  end

  # 各日付の集計データを計算
  def calculate_date_stats(hall, dates)
    stats = {}

    dates.each do |date|
      data = hall.machine_data.where(date: date)

      if data.exists?
        stats[date] = build_date_stats(data)
      else
        stats[date] = nil
      end
    end

    stats
  end

  # 日付の統計情報を構築
  def build_date_stats(data)
    total_machines = data.count
    total_diff = data.sum(:difference_count)
    total_games = data.sum(:game_count)
    plus_machines = data.where("difference_count > 0").count

    {
      avg_diff: calculate_average(total_diff, total_machines),
      avg_games: calculate_average(total_games, total_machines),
      total_diff: total_diff,
      plus_machines: plus_machines,
      total_machines: total_machines,
      win_rate: calculate_win_rate(plus_machines, total_machines)
    }
  end

  # 平均値を計算
  def calculate_average(total, count)
    count > 0 ? (total.to_f / count).round : 0
  end

  # 勝率を計算
  def calculate_win_rate(plus_count, total_count)
    total_count > 0 ? ((plus_count.to_f / total_count) * 100).round(1) : 0
  end

  # 各日付のメモを取得（最初の1件のdate_memoを取得）
  def fetch_date_memos(hall, dates)
    memos = {}
    dates.each do |date|
      # その日の最初のデータからdate_memoを取得
      first_data = hall.machine_data.where(date: date).first
      memos[date] = first_data&.date_memo
    end
    memos
  end
end
