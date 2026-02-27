# 台データの表示・管理を行うコントローラー
#
# 主な機能:
#   - show: 日別台データの表示（フィルタリング・ソート・色分け・ランキング付き）
#   - import / batch_import: 外部URLからの台データ取込
#   - manual_import: 手動データ入力
#   - export_map_pdf: マップPDF出力
#   - update_machine_memo(s): 台メモの個別・一括更新
#   - machine_history: 台番号ごとの履歴表示
#
# フィルタリング・集計の共通処理は MachineDataFilterable をincludeして利用
# セッションに検索条件を保存し、ページ遷移後も条件を維持する
class MachineDataController < ApplicationController
  include MachineDataFilterable

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

  # 台番号の過去データ表示
  def machine_history
    @hall = Hall.find_by(id: params[:hall_id])
    @machine_number = params[:machine_number].to_i

    # 日付範囲の設定
    @end_date = params[:end_date].present? ? Date.parse(params[:end_date]) : Date.today
    @start_date = params[:start_date].present? ? Date.parse(params[:start_date]) : (@end_date - 90.days)

    # 指定された台番号の過去データを取得（最適化：1回のクエリ）
    @machine_data = @hall.machine_data
                         .where(machine_number: @machine_number, date: @start_date..@end_date)
                         .order(date: :desc)
                         .to_a

    # データが存在する場合、機種名を取得
    @machine_name = @machine_data.first&.machine_name

    # 集計データを計算
    if @machine_data.any?
      @summary = {
        total_days: @machine_data.length,
        total_games: @machine_data.sum(&:game_count),
        total_diff: @machine_data.sum(&:difference_count),
        total_bb: @machine_data.sum(&:bb_count),
        total_rb: @machine_data.sum(&:rb_count),
        total_art: @machine_data.sum(&:art_count),
        avg_games: (@machine_data.sum(&:game_count).to_f / @machine_data.length).round,
        avg_diff: (@machine_data.sum(&:difference_count).to_f / @machine_data.length).round,
        plus_days: @machine_data.count { |m| m.difference_count > 0 },
        win_rate: (@machine_data.count { |m| m.difference_count > 0 }.to_f / @machine_data.length * 100).round(1)
      }
    else
      @summary = nil
    end
  end

  # メインの表示アクション
  # 【パフォーマンス最適化済み】
  # - 必要な列のみをSELECT
  # - 1回のクエリで全期間のデータを取得
  # - キャッシュを活用して重複クエリを削減
  # - メモリ使用量を最小化（不要な配列複製を削減）
  def show
    # リセットフラグがあればセッションを削除
    if params[:reset_filters] == "1"
      session.delete(:machine_data_filters)
      redirect_to hall_machine_data_path(params[:hall_id], params[:date]) and return
    end

    initialize_parameters        # パラメータ解析
    load_machine_data           # 当日データの読み込み（最適化：必要な列のみSELECT）
    calculate_past_data         # 過去データの計算（最適化：キャッシュ活用）
    generate_summaries          # 集計データの生成（最適化：バッチ処理）
    apply_filters_and_sorting   # フィルターとソートの適用（最適化：メモリ効率化）
    prepare_view_data           # ビュー用データの準備（最適化：既存データを再利用）

    # JSON形式でリクエストされた場合、テーブルHTMLのみを返す（並び替え非同期化用）
    respond_to do |format|
      format.html # 通常のHTMLレスポンス
      format.json do
        begin
          # 一覧タブのテーブル行HTMLを生成（formats: [:html]を明示的に指定）
          html = render_to_string(partial: "machine_data/list_table_rows", layout: false, formats: [ :html ])
          render json: { html: html }
        rescue => e
          # エラーが発生した場合はJSONでエラーを返す
          render json: { error: e.message, backtrace: e.backtrace.first(5) }, status: :internal_server_error
        end
      end
    end
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

    # 色分け用データ（全条件対応）
    @color_worst_ranks = calculate_color_worst_ranks(7)
    @color_past_7days_diff = calculate_past_period_diff(7)
    @color_worst_machine_ranks = calculate_worst_machine_by_model(7)
    @color_today_diff_levels = calculate_today_diff_levels

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
      color_past_7days_diff: @color_past_7days_diff,
      color_worst_machine_ranks: @color_worst_machine_ranks,
      color_today_diff_levels: @color_today_diff_levels,
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
    created_count = 0

    memos.each do |machine_number, memo|
      machine_data = hall.machine_data.find_by(date: date, machine_number: machine_number)

      if machine_data
        # 既存レコードを更新
        machine_data.update(machine_memo: memo)
        updated_count += 1
      else
        # 新規レコードを作成（メモ専用レコードとして機種名は空）
        hall.machine_data.create!(
          date: date,
          machine_number: machine_number,
          machine_name: "",
          machine_memo: memo,
          game_count: 0,
          difference_count: 0,
          bb_count: 0,
          rb_count: 0,
          art_count: 0
        )
        created_count += 1
      end
    end

    render json: { success: true, updated_count: updated_count, created_count: created_count }
  rescue => e
    render json: { success: false, error: e.message }, status: :unprocessable_entity
  end

  # 手動データインポート（Json/Ajax用）
  def manual_import
    hall_id = params[:hall_id]
    date = Date.parse(params[:date])
    format = params[:format] || "tab_separated"
    data_text = params[:data]

    hall = Hall.find_by(id: hall_id)
    return render json: { success: false, error: "ホールが見つかりません" }, status: :not_found unless hall

    case format
    when "tab_separated"
      parser = TabSeparatedDataParser.new
      result = parser.parse_and_import(data_text, hall, date)
    else
      return render json: { success: false, error: "不明な形式です" }, status: :unprocessable_entity
    end

    if result[:success]
      render json: { success: true, count: result[:count] }
    else
      render json: { success: false, error: result[:error] }, status: :unprocessable_entity
    end
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

    # セッションキーを設定
    @session_key = "machine_data_filters"

    # セッションから検索条件を復元（パラメータが指定されていない場合）
    restore_from_session_if_needed

    # 表示設定
    @show_difference = get_param_or_session(:show_difference, "1") != "0"
    @show_games = get_param_or_session(:show_games, "0") == "1"
    @show_bb = get_param_or_session(:show_bb, "0") == "1"
    @show_rb = get_param_or_session(:show_rb, "0") == "1"
    @show_art = get_param_or_session(:show_art, "0") == "1"

    # ソート設定
    @sort_by = get_param_or_session(:sort_by, "machine_number")
    @sort_order = get_param_or_session(:sort_order, "asc")

    # 表示日数
    if params[:display_days].present?
      display_days_param = params[:display_days]
      @display_days = display_days_param.is_a?(String) ?
        display_days_param.split(",").map(&:to_i).uniq.sort :
        display_days_param.map(&:to_i).uniq.sort
    elsif session[@session_key] && session[@session_key][:display_days].present?
      display_days_value = session[@session_key][:display_days]
      @display_days = display_days_value.is_a?(String) ?
        display_days_value.split(",").map(&:to_i).uniq.sort :
        display_days_value.map(&:to_i).uniq.sort
    else
      @display_days = [ 7 ] # デフォルト値を7日に設定
    end

    # フィルター設定
    setup_filter_parameters

    # セッションに保存
    save_to_session
  end

  # セッションから検索条件を復元（パラメータが何も指定されていない場合のみ）
  def restore_from_session_if_needed
    # パラメータが何も指定されていない場合、セッションから復元
    if params.keys.none? { |k| k.start_with?("filter_", "sort_", "show_", "display_") }
      if session[@session_key]
        session[@session_key].each do |key, value|
          params[key] = value unless params[key].present?
        end
      end
    end
  end

  # パラメータまたはセッションから値を取得
  def get_param_or_session(key, default_value)
    if params[key].present?
      params[key]
    elsif session[@session_key] && session[@session_key][key]
      session[@session_key][key]
    else
      default_value
    end
  end

  # セッションに検索条件を保存（サイズ最適化）
  def save_to_session
    session[@session_key] ||= {}

    # 空値を保存しないヘルパー
    save_if_present = lambda do |key, value|
      if value.is_a?(Array)
        session[@session_key][key] = value.join(",") if value.any?
      elsif value.present? || value == false || value == 0
        session[@session_key][key] = value
      else
        session[@session_key].delete(key)
      end
    end

    # 表示設定
    save_if_present.call(:show_difference, @show_difference ? "1" : "0")
    save_if_present.call(:show_games, @show_games ? "1" : "0")
    save_if_present.call(:show_bb, @show_bb ? "1" : "0")
    save_if_present.call(:show_rb, @show_rb ? "1" : "0")
    save_if_present.call(:show_art, @show_art ? "1" : "0")

    # ソート設定
    save_if_present.call(:sort_by, @sort_by)
    save_if_present.call(:sort_order, @sort_order)

    # 表示日数
    save_if_present.call(:display_days, @display_days)

    # フィルター設定（空値は保存しない）
    save_if_present.call(:filter_machine_name, @filter_machine_name)
    save_if_present.call(:filter_machine_name_search, @filter_machine_name_search)
    save_if_present.call(:filter_machine_name_search_type, @filter_machine_name_search_type)
    save_if_present.call(:filter_game_count_min, @filter_game_count_min)
    save_if_present.call(:filter_game_count_max, @filter_game_count_max)
    save_if_present.call(:filter_difference_min, @filter_difference_min)
    save_if_present.call(:filter_difference_max, @filter_difference_max)
    save_if_present.call(:filter_bb_count_min, @filter_bb_count_min)
    save_if_present.call(:filter_bb_count_max, @filter_bb_count_max)
    save_if_present.call(:filter_machine_last_digit, @filter_machine_last_digit)
    save_if_present.call(:filter_machine_double_digit, @filter_machine_double_digit ? "1" : nil)
    save_if_present.call(:filter_best_ranks, @filter_best_ranks)
    save_if_present.call(:filter_best_rank_days, @filter_best_rank_days)
    save_if_present.call(:filter_diff_days, @filter_diff_days)
    save_if_present.call(:filter_diff_value_min, @filter_diff_value_min)
    save_if_present.call(:filter_diff_value_max, @filter_diff_value_max)
    save_if_present.call(:filter_game_count_days, @filter_game_count_days)
    save_if_present.call(:filter_game_count_value_min, @filter_game_count_value_min)
    save_if_present.call(:filter_game_count_value_max, @filter_game_count_value_max)
    save_if_present.call(:filter_machine_count_min, @filter_machine_count_min)
    save_if_present.call(:filter_machine_count_max, @filter_machine_count_max)
    save_if_present.call(:filter_rank_days, @filter_rank_days)
    save_if_present.call(:filter_ranks, @filter_ranks)
  end

  def setup_filter_parameters
    @filter_machine_name = get_param_or_session(:filter_machine_name, nil)
    @filter_machine_name_search = get_param_or_session(:filter_machine_name_search, nil)
    @filter_machine_name_search_type = get_param_or_session(:filter_machine_name_search_type, "include")
    @filter_game_count_min = parse_int_param_with_session(:filter_game_count_min)
    @filter_game_count_max = parse_int_param_with_session(:filter_game_count_max)
    @filter_difference_min = parse_int_param_with_session(:filter_difference_min)
    @filter_difference_max = parse_int_param_with_session(:filter_difference_max)
    @filter_bb_count_min = parse_int_param_with_session(:filter_bb_count_min)
    @filter_bb_count_max = parse_int_param_with_session(:filter_bb_count_max)

    # 台番号末尾フィルター
    @filter_machine_last_digit = get_param_or_session(:filter_machine_last_digit, nil)
    @filter_machine_double_digit = get_param_or_session(:filter_machine_double_digit, "0") == "1"

    # ベストランクフィルター（配列の復元）
    if params[:filter_best_ranks].present?
      @filter_best_ranks = params[:filter_best_ranks].map(&:to_i)
    elsif session[@session_key] && session[@session_key][:filter_best_ranks].present?
      @filter_best_ranks = session[@session_key][:filter_best_ranks].is_a?(String) ?
        session[@session_key][:filter_best_ranks].split(",").map(&:to_i) :
        session[@session_key][:filter_best_ranks]
    else
      @filter_best_ranks = []
    end

    @filter_best_rank_days = parse_int_param_with_session(:filter_best_rank_days)
    @filter_diff_days = parse_int_param_with_session(:filter_diff_days)
    @filter_diff_value_min = parse_int_param_with_session(:filter_diff_value_min)
    @filter_diff_value_max = parse_int_param_with_session(:filter_diff_value_max)
    @filter_game_count_days = parse_int_param_with_session(:filter_game_count_days)
    @filter_game_count_value_min = parse_int_param_with_session(:filter_game_count_value_min)
    @filter_game_count_value_max = parse_int_param_with_session(:filter_game_count_value_max)
    @filter_machine_count_min = parse_int_param_with_session(:filter_machine_count_min)
    @filter_machine_count_max = parse_int_param_with_session(:filter_machine_count_max)
    @filter_rank_days = parse_int_param_with_session(:filter_rank_days)

    # ランクフィルター（配列の復元）
    if params[:filter_ranks].present?
      @filter_ranks = params[:filter_ranks].is_a?(Array) ? params[:filter_ranks].map(&:to_i) : params[:filter_ranks].to_s.split(",").map(&:to_i)
    elsif session[@session_key] && session[@session_key][:filter_ranks].present?
      @filter_ranks = session[@session_key][:filter_ranks].is_a?(String) ?
        session[@session_key][:filter_ranks].split(",").map(&:to_i) :
        session[@session_key][:filter_ranks]
    else
      @filter_ranks = []
    end
  end

  # parse_int_param は MachineDataFilterable から継承

  # セッション対応版: パラメータまたはセッションから整数値を取得する
  def parse_int_param_with_session(key)
    if params[key].present?
      params[key].to_i
    elsif session[@session_key] && session[@session_key][key]
      session[@session_key][key].to_i
    else
      nil
    end
  end

  # ============================================================
  # データ読み込み
  # ============================================================

  def load_machine_data
    @machine_data = @hall.machine_data
                         .where(date: @date)
                         .order(:machine_number)

    # データ存在判定：データが存在し、かつ機種名が入っているレコードがある場合
    if @machine_data.any? && @machine_data.where.not(machine_name: [ nil, "" ]).exists?
      @data_exists = true
      @reference_date = nil
    else
      load_reference_data
    end
  end

  def load_reference_data
    @data_exists = false
    @reference_date = find_latest_data_date(@hall, @date)

    if @reference_date
      reference_data = @hall.machine_data.where(date: @reference_date).order(:machine_number)

      # メモのみのレコードがある場合はマージする
      existing_memo_records = @machine_data.index_by(&:machine_number)
      @machine_data = create_empty_machine_data_with_memos(reference_data, existing_memo_records)
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

  # メモのみのレコードをマージして空データを作成
  def create_empty_machine_data_with_memos(reference_data, existing_memo_records)
    reference_data.map do |data|
      existing = existing_memo_records[data.machine_number]
      memo = existing&.machine_memo || ""

      MachineData.new(
        hall_id: @hall.id,
        date: @date,
        machine_number: data.machine_number,
        machine_name: data.machine_name,
        game_count: 0,
        difference_count: 0,
        bb_count: 0,
        rb_count: 0,
        art_count: 0,
        machine_memo: memo
      )
    end
  end

  def find_latest_data_date(hall, target_date)
    # 機種名が入っているレコード（実データ）のみを対象とする
    hall.machine_data
        .where("date < ?", target_date)
        .where.not(machine_name: [ nil, "" ])
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
    # ワースト/ベストランクフィルター用のデータを計算（表示設定に関係なく）
    calculate_rank_filter_data
  end

  def calculate_diff_data
    if @show_difference && @display_days.any?
      @diff_days = {}
      @diff_ranks = {}
      @diff_best_ranks = {}

      @display_days.each do |days|
        @diff_days[days] = calculate_sum_for_period(days, :difference_count)
        @diff_ranks[days] = calculate_ranks_by_machine_name(@machine_data, @diff_days[days], :worst)
        @diff_best_ranks[days] = calculate_ranks_by_machine_name(@machine_data, @diff_days[days], :best)
      end
    else
      @diff_days = {}
      @diff_ranks = {}
      @diff_best_ranks = {}
    end
  end

  def calculate_rank_filter_data
    # ワーストランクフィルター用の計算
    if @filter_rank_days.present? && (@filter_ranks.present? || @filter_best_ranks.present?)
      # 表示日数に含まれていない場合でも計算
      unless @diff_ranks[@filter_rank_days]
        diff_data = calculate_sum_for_period(@filter_rank_days, :difference_count)
        @diff_ranks[@filter_rank_days] = calculate_ranks_by_machine_name(@machine_data, diff_data, :worst)
        @diff_best_ranks[@filter_rank_days] = calculate_ranks_by_machine_name(@machine_data, diff_data, :best)
      end
    end

    # ベストランクフィルター用の計算（別の日数指定の場合）
    if @filter_best_rank_days.present? && @filter_best_ranks.present?
      unless @diff_best_ranks[@filter_best_rank_days]
        diff_data = calculate_sum_for_period(@filter_best_rank_days, :difference_count)
        @diff_ranks[@filter_best_rank_days] = calculate_ranks_by_machine_name(@machine_data, diff_data, :worst)
        @diff_best_ranks[@filter_best_rank_days] = calculate_ranks_by_machine_name(@machine_data, diff_data, :best)
      end
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

  # 指定期間の合計値を計算（最適化版：全日数分を1回のクエリで取得）
  # キャッシュを活用して同じクエリの重複実行を防止
  def calculate_sum_for_period(days, column)
    # キャッシュがあれば再利用
    @past_data_cache ||= {}
    return @past_data_cache["#{days}_#{column}"] if @past_data_cache["#{days}_#{column}"]

    start_date = @date - days.days
    end_date = @date - 1.day

    result = @hall.machine_data
                  .where(date: start_date..end_date)
                  .group(:machine_number)
                  .sum(column)

    @past_data_cache["#{days}_#{column}"] = result
    result
  end

  # 過去N日間でマイナスになった日数をカウント
  def calculate_negative_days_count(days)
    # キャッシュがあれば再利用
    @negative_count_cache ||= {}
    return @negative_count_cache[days] if @negative_count_cache[days]

    start_date = @date - days.days
    end_date = @date - 1.day

    # 過去N日間のデータを取得し、マイナスの日数をカウント
    result = @hall.machine_data
                  .where(date: start_date..end_date)
                  .where("difference_count < 0")
                  .group(:machine_number)
                  .count

    @negative_count_cache[days] = result
    result
  end

  # calculate_ranks_by_machine_name は MachineDataFilterable から継承

  # ============================================================
  # 集計データの生成
  # 【最適化】全日付のデータを1回のクエリで取得し、メモリ上で処理
  # ============================================================

  def generate_summaries
    # 日別集計データ（最適化：バッチ処理で全日付を一括取得）
    date_range_param = params[:date_range] || "7"
    @daily_summary_data = generate_daily_summary(date_range_param)

    # 機種別集計データ（フィルター適用前、メモリ上で処理）
    @machine_stats = calculate_machine_stats(@machine_data)
  end

  # 機種別集計データを計算（メモリ上で処理、追加クエリなし）
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

  # 【最適化版】日別集計データを生成（全日付を1回のクエリで取得）
  # パフォーマンス向上：N個の日付に対してN回クエリ → 1回のクエリで全取得
  def generate_daily_summary(date_range_param)
    end_date = @date
    target_dates = determine_target_dates(date_range_param, end_date)
    return [] if target_dates.empty?

    # 【最適化】全日付のデータを1回のクエリで取得
    date_range = (target_dates.min..target_dates.max)
    all_machines_data = @hall.machine_data
                             .where(date: date_range)
                             .select(:id, :date, :machine_number, :machine_name, :game_count, :difference_count, :bb_count)
                             .to_a

    # 日付ごとにグループ化
    machines_by_date = all_machines_data.group_by(&:date)

    # 過去データが必要な場合は事前に一括計算
    past_data_cache = preload_past_data_for_summary(target_dates)

    results = []
    target_dates.each do |target_date|
      daily_machines = machines_by_date[target_date]
      next if daily_machines.nil? || daily_machines.empty?

      filtered_machines = apply_filter_for_summary_optimized(daily_machines, target_date, past_data_cache)
      next if filtered_machines.empty?

      results << calculate_daily_stats(target_date, filtered_machines)
    end

    results
  rescue => e
    Rails.logger.error "日別集計エラー: #{e.message}"
    Rails.logger.error e.backtrace.join("\n")
    []
  end

  def determine_target_dates(date_range_param, end_date)
    # カスタム日付選択の場合
    if date_range_param == "custom" && params[:custom_dates].present?
      custom_dates = params[:custom_dates].map { |d| Date.parse(d) rescue nil }.compact
      return custom_dates.sort.reverse
    end

    case date_range_param
    when "day_7"
      # 7のつく日を全て取得（制限なし）
      fetch_dates_by_day_numbers([ 7, 17, 27 ], end_date)
    when "day_1"
      # 1のつく日を全て取得（制限なし）
      fetch_dates_by_day_numbers([ 1, 11, 21, 31 ], end_date)
    when "day_8"
      # 8のつく日を全て取得（制限なし）
      fetch_dates_by_day_numbers([ 8, 18, 28 ], end_date)
    else
      days = date_range_param.to_i
      start_date = end_date - days.days
      (start_date..end_date).to_a.reverse
    end
  end

  def fetch_dates_by_day_numbers(day_numbers, end_date, start_limit = nil)
    query = @hall.machine_data
                 .where("CAST(strftime('%d', date) AS INTEGER) IN (?)", day_numbers)
                 .where("date <= ?", end_date)

    query = query.where("date >= ?", start_limit) if start_limit

    query.select(:date)
         .distinct
         .order(date: :desc)
         .pluck(:date)
  end

  # calculate_daily_stats は MachineDataFilterable から継承

  # 【最適化】日別集計用の過去データを事前に一括取得
  def preload_past_data_for_summary(target_dates)
    cache = {}

    # 過去差枚フィルターが有効な場合
    if @filter_diff_days.present? && (@filter_diff_value_min.present? || @filter_diff_value_max.present?)
      days = @filter_diff_days
      # 全日付分の過去データを1回のクエリで取得
      min_start = target_dates.min - days.days
      max_end = target_dates.max - 1.day

      diff_data = @hall.machine_data
                       .where(date: min_start..max_end)
                       .select(:date, :machine_number, :difference_count)
                       .to_a

      # 各ターゲット日付ごとに集計
      target_dates.each do |target_date|
        start_date = target_date - days.days
        end_date = target_date - 1.day

        aggregated = Hash.new(0)
        diff_data.each do |record|
          if record.date >= start_date && record.date <= end_date
            aggregated[record.machine_number] += record.difference_count
          end
        end

        cache["diff_#{target_date}"] = aggregated
      end
    end

    # 過去回転数フィルターが有効な場合
    if @filter_game_count_days.present? && (@filter_game_count_value_min.present? || @filter_game_count_value_max.present?)
      days = @filter_game_count_days
      min_start = target_dates.min - days.days
      max_end = target_dates.max - 1.day

      game_data = @hall.machine_data
                       .where(date: min_start..max_end)
                       .select(:date, :machine_number, :game_count)
                       .to_a

      target_dates.each do |target_date|
        start_date = target_date - days.days
        end_date = target_date - 1.day

        aggregated = Hash.new(0)
        game_data.each do |record|
          if record.date >= start_date && record.date <= end_date
            aggregated[record.machine_number] += record.game_count
          end
        end

        cache["game_#{target_date}"] = aggregated
      end
    end

    # ランクフィルターが有効な場合
    if @filter_rank_days.present? && (@filter_ranks.present? || @filter_best_ranks.present?)
      days = @filter_rank_days
      min_start = target_dates.min - days.days
      max_end = target_dates.max - 1.day

      rank_data = @hall.machine_data
                       .where(date: min_start..max_end)
                       .select(:date, :machine_number, :machine_name, :difference_count)
                       .to_a

      target_dates.each do |target_date|
        start_date = target_date - days.days
        end_date = target_date - 1.day

        aggregated = Hash.new(0)
        rank_data.each do |record|
          if record.date >= start_date && record.date <= end_date
            aggregated[record.machine_number] += record.difference_count
          end
        end

        cache["rank_#{target_date}"] = aggregated
      end
    end

    cache
  end

  # ============================================================
  # フィルター処理
  # ============================================================

  def apply_filters_and_sorting
    # マップタブ用に全台データを保持（index_byでハッシュ化のみ）
    @machine_data_by_number = @machine_data.index_by(&:machine_number)

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

  # apply_machine_name_filter は MachineDataFilterable から継承
  # （AND/OR検索対応の上位互換版を使用）

  # apply_numeric_filters は MachineDataFilterable から継承
  # （台番号偶数・奇数フィルターも追加対応）

  # apply_range_filter は MachineDataFilterable から継承

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

    # 過去差枚がマイナスの台フィルター
    if @filter_past_negative_days.present?
      negative_diff_data = calculate_sum_for_period(@filter_past_negative_days, :difference_count)
      filtered = filtered.select do |m|
        diff_value = negative_diff_data[m.machine_number] || 0
        diff_value < 0
      end
    end

    # 過去マイナスになった日数フィルター
    if @filter_negative_count_days.present? && (@filter_negative_count_min.present? || @filter_negative_count_max.present?)
      negative_count_data = calculate_negative_days_count(@filter_negative_count_days)
      filtered = filtered.select do |m|
        negative_days = negative_count_data[m.machine_number] || 0
        value_in_range?(negative_days, @filter_negative_count_min, @filter_negative_count_max)
      end
    end

    filtered
  end

  # value_in_range? は MachineDataFilterable から継承
  # apply_machine_count_filter は MachineDataFilterable から継承

  def apply_rank_filter(filtered)
    # ワーストランクフィルター（@filter_rank_daysは既にcalculate_rank_filter_dataで計算済み）
    if @filter_rank_days.present? && @filter_ranks.present? && @diff_ranks[@filter_rank_days]
      filtered = filtered.select do |m|
        rank = @diff_ranks[@filter_rank_days][m.machine_number]
        @filter_ranks.include?(rank)
      end
    end

    # ベストランクフィルター（filter_best_rank_daysまたはfilter_rank_daysを使用）
    best_days = @filter_best_rank_days || @filter_rank_days
    if best_days.present? && @filter_best_ranks.present? && @diff_best_ranks[best_days]
      filtered = filtered.select do |m|
        rank = @diff_best_ranks[best_days][m.machine_number]
        @filter_best_ranks.include?(rank)
      end
    end

    filtered
  end

  # 【最適化版】事前にキャッシュした過去データを使用
  def apply_filter_for_summary_optimized(machines, target_date, past_data_cache)
    filtered = machines

    # 機種名フィルター
    filtered = apply_machine_name_filter(filtered)

    # 数値フィルター
    filtered = apply_numeric_filters(filtered)

    # 過去データフィルター（キャッシュから取得）
    filtered = apply_past_data_filters_with_cache(filtered, target_date, past_data_cache)

    # 機種毎台数フィルター
    filtered = apply_machine_count_filter(filtered)

    # ワーストランキングフィルター（キャッシュから取得）
    filtered = apply_rank_filter_with_cache(filtered, target_date, past_data_cache)

    filtered
  end

  # 互換性のため旧メソッドも残す（非日別集計用）
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

  # 【最適化版】キャッシュから過去データを取得してフィルター
  def apply_past_data_filters_with_cache(filtered, target_date, past_data_cache)
    # 過去差枚フィルター
    if @filter_diff_days.present? && (@filter_diff_value_min.present? || @filter_diff_value_max.present?)
      diff_data = past_data_cache["diff_#{target_date}"] || {}

      filtered = filtered.select do |m|
        diff_value = diff_data[m.machine_number] || 0
        value_in_range?(diff_value, @filter_diff_value_min, @filter_diff_value_max)
      end
    end

    # 過去回転数フィルター
    if @filter_game_count_days.present? && (@filter_game_count_value_min.present? || @filter_game_count_value_max.present?)
      game_count_data = past_data_cache["game_#{target_date}"] || {}

      filtered = filtered.select do |m|
        game_count_value = game_count_data[m.machine_number] || 0
        value_in_range?(game_count_value, @filter_game_count_value_min, @filter_game_count_value_max)
      end
    end

    # 過去差枚がマイナスの台フィルター（リアルタイム計算）
    if @filter_past_negative_days.present?
      negative_diff_data = calculate_aggregated_data_for_date(target_date, @filter_past_negative_days, :difference_count)
      filtered = filtered.select do |m|
        diff_value = negative_diff_data[m.machine_number] || 0
        diff_value < 0
      end
    end

    # 過去マイナスになった日数フィルター（リアルタイム計算）
    if @filter_negative_count_days.present? && (@filter_negative_count_min.present? || @filter_negative_count_max.present?)
      negative_count_data = calculate_negative_days_count_for_date(target_date, @filter_negative_count_days)
      filtered = filtered.select do |m|
        negative_days = negative_count_data[m.machine_number] || 0
        value_in_range?(negative_days, @filter_negative_count_min, @filter_negative_count_max)
      end
    end

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

    # 過去差枚がマイナスの台フィルター
    if @filter_past_negative_days.present?
      negative_diff_data = calculate_aggregated_data_for_date(target_date, @filter_past_negative_days, :difference_count)
      filtered = filtered.select do |m|
        diff_value = negative_diff_data[m.machine_number] || 0
        diff_value < 0
      end
    end

    # 過去マイナスになった日数フィルター
    if @filter_negative_count_days.present? && (@filter_negative_count_min.present? || @filter_negative_count_max.present?)
      negative_count_data = calculate_negative_days_count_for_date(target_date, @filter_negative_count_days)
      filtered = filtered.select do |m|
        negative_days = negative_count_data[m.machine_number] || 0
        value_in_range?(negative_days, @filter_negative_count_min, @filter_negative_count_max)
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

  # 特定の日付を基準に過去N日間でマイナスになった日数をカウント
  def calculate_negative_days_count_for_date(target_date, days)
    start_date = target_date - days.days
    end_date = target_date - 1.day

    @hall.machine_data
         .where(date: start_date..end_date)
         .where("difference_count < 0")
         .group(:machine_number)
         .count
  end

  # 【最適化版】キャッシュから過去データを取得してランクフィルター
  def apply_rank_filter_with_cache(filtered, target_date, past_data_cache)
    if @filter_rank_days.present? && (@filter_ranks.present? || @filter_best_ranks.present?)
      diff_data = past_data_cache["rank_#{target_date}"] || {}
      ranks = calculate_ranks_by_machine_name(filtered, diff_data, :worst)
      best_ranks = calculate_ranks_by_machine_name(filtered, diff_data, :best)

      if @filter_ranks.present?
        filtered = filtered.select do |m|
          rank = ranks[m.machine_number]
          @filter_ranks.include?(rank)
        end
      end

      if @filter_best_ranks.present?
        filtered = filtered.select do |m|
          rank = best_ranks[m.machine_number]
          @filter_best_ranks.include?(rank)
        end
      end
    end

    filtered
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
      # ソート用の日数データが存在しない場合は動的に計算
      unless diff_days[days]
        diff_days[days] = calculate_sum_for_period(days, :difference_count)
      end
      machine_data.sort_by { |m| diff_days[days][m.machine_number] || 0 }
    when /^game_count_(\d+)$/
      days = Regexp.last_match(1).to_i
      # ソート用の日数データが存在しない場合は動的に計算
      unless game_count_days[days]
        game_count_days[days] = calculate_sum_for_period(days, :game_count)
      end
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
    # ドロップダウン用機種一覧（既にロード済みのデータから取得してクエリを削減）
    @machine_names = @machine_data_by_number.values.map(&:machine_name).uniq.sort

    # マップ用データ
    @hall_maps = @hall.hall_maps.order(:created_at)
    @current_map = @hall_maps.first
    # マップタブでは常に全台表示（@machine_data_by_numberは既にapply_filters_and_sortingで作成済み）

    # 色分け用データ
    @color_worst_ranks = calculate_color_worst_ranks(7)
    @color_past_7days_diff = calculate_past_period_diff(7)
    @color_worst_machine_ranks = calculate_worst_machine_by_model(7)
    @color_today_diff_levels = calculate_today_diff_levels
  end

  # 色分け用：機種ごとの過去N日間総差枚ワーストランキング（全台対象）
  # 【最適化】既存のキャッシュとデータを活用
  def calculate_color_worst_ranks(days)
    # 既に計算済みの場合は再利用
    return @diff_ranks[days] if @diff_ranks && @diff_ranks[days]

    # calculate_sum_for_periodのキャッシュを活用
    past_data = calculate_sum_for_period(days, :difference_count)

    # 既にロード済みのデータから機種名を取得
    machines = @machine_data_by_number.values

    # ランキング計算
    calculate_ranks_by_machine_name(machines, past_data, :worst)
  end

  # 共通メソッド：過去N日間の合計差枚（台番号ごと）
  def calculate_past_period_diff(days)
    past_data = calculate_sum_for_period(days, :difference_count)

    # 当日存在するすべての台番号について、過去データがない場合は0を設定
    result = {}
    @machine_data_by_number.keys.each do |machine_number|
      result[machine_number] = past_data[machine_number] || 0
    end
    result
  end

  # 共通メソッド：過去N日間の機種ごと総差枚が最も低い機種の全台にフラグを付ける
  def calculate_worst_machine_by_model(days)
    past_data = calculate_sum_for_period(days, :difference_count)
    machines = @machine_data_by_number.values

    # 機種ごとの総差枚を計算（過去データがない場合は0として扱う）
    model_totals = machines.group_by(&:machine_name).transform_values do |ms|
      ms.sum { |m| past_data[m.machine_number] || 0 }
    end

    # 最も差枚が低い機種を特定
    worst_model = model_totals.min_by { |_name, total| total }&.first

    # その機種の全台番号にフラグを付ける
    result = {}
    if worst_model
      machines.select { |m| m.machine_name == worst_model }.each do |m|
        result[m.machine_number] = true
      end
    end
    result
  end

  # 共通メソッド：当日の差枚レベル（段階的な色分け用）
  def calculate_today_diff_levels
    result = {}
    @machine_data_by_number.each do |number, machine|
      diff = machine.difference_count.to_i
      if diff >= 4000
        result[number] = 4 # 濃いめの赤
      elsif diff >= 3000
        result[number] = 3 # 薄めの赤
      elsif diff >= 2000
        result[number] = 2 # 濃い緑
      elsif diff >= 1000
        result[number] = 1 # 薄めの緑
      end
    end
    result
  end
end
