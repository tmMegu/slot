class HallMapsController < ApplicationController
  before_action :set_hall
  before_action :set_map, only: [ :edit, :update, :destroy, :duplicate ]

  # GET /halls/:hall_id/maps
  def index
    @maps = @hall.hall_maps.order(:created_at)
  end

  # GET /halls/:hall_id/maps/new
  def new
    @map = @hall.hall_maps.build
    @map.rows = params[:rows]&.to_i || 20
    @map.cols = params[:cols]&.to_i || 40
  end

  # POST /halls/:hall_id/maps
  def create
    @map = @hall.hall_maps.build(map_params)

    # 空のレイアウトデータを初期化
    initialize_empty_layout(@map)

    if @map.save
      redirect_to edit_hall_map_path(@hall, @map), notice: "マップを作成しました。"
    else
      render :new, status: :unprocessable_entity
    end
  end

  # GET /halls/:hall_id/maps/:id/edit
  def edit
    # 編集画面
  end

  # PATCH/PUT /halls/:hall_id/maps/:id
  def update
    updated = false

    # layout_dataの更新（JavaScriptから送信される場合）
    if params[:layout_data].present? && params[:layout_data] != ""
      begin
        layout_data = JSON.parse(params[:layout_data])

        # 空のlayout_dataで既存データを上書きしないようにチェック
        if layout_data.blank? || layout_data.empty?
          Rails.logger.warn "Empty layout_data received, skipping update"
          flash[:alert] = "空のマップデータは保存できません"
          redirect_to edit_hall_map_path(@hall, @map)
          return
        end

        @map.layout_data = layout_data
        updated = true
      rescue JSON::ParserError => e
        Rails.logger.error "JSON parse error: #{e.message}"
        flash[:alert] = "マップデータの保存に失敗しました"
        render :edit, status: :unprocessable_entity
        return
      end
    end

    # 名前などの基本情報の更新（フォームから送信される場合）
    # rows/cols が空文字や 0 / layout_data の中身と矛盾する値のときは上書きを拒否
    # （JS のキャッシュバグや誤動作によるデータ破壊を防ぐための防御）
    if params[:hall_map].present?
      safe_attrs = map_params.to_h
      max_row = 0
      max_col = 0
      @map.safe_layout_data.each_key do |key|
        r, c = key.split("_").map(&:to_i)
        max_row = r if r > max_row
        max_col = c if c > max_col
      end

      ["rows", "cols"].each do |k|
        v = safe_attrs[k].to_i
        max_required = (k == "rows") ? max_row : max_col
        if v <= 0 || v < max_required
          safe_attrs.delete(k)
        else
          safe_attrs[k] = v
        end
      end
      @map.assign_attributes(safe_attrs)
      updated = true
    end

    # 並び情報の更新（JSON 文字列で送信される）
    if params[:lineups].present?
      begin
        lineups_data = JSON.parse(params[:lineups])
        @map.replace_lineups(lineups_data)
        updated = true
      rescue JSON::ParserError => e
        Rails.logger.error "Lineups JSON parse error: #{e.message}"
        flash[:alert] = "並び情報の保存に失敗しました"
        render :edit, status: :unprocessable_entity
        return
      end
    end

    if updated && @map.save
      redirect_to edit_hall_map_path(@hall, @map), notice: "マップを保存しました。"
    elsif updated
      render :edit, status: :unprocessable_entity
    else
      redirect_to edit_hall_map_path(@hall, @map), alert: "更新するデータがありません"
    end
  end

  # DELETE /halls/:hall_id/maps/:id
  def destroy
    @map.destroy
    redirect_to hall_maps_path(@hall), notice: "マップを削除しました。", status: :see_other
  end

  # POST /halls/:hall_id/maps/:id/duplicate
  # @map.dup は serialize 属性との相互作用で rows/cols/layout_data が抜けて
  # DB default が適用されるケースがあるため、明示的に全属性を build に渡す
  def duplicate
    new_map = @hall.hall_maps.new(
      hall_id: @hall.id,
      name: generate_unique_copy_name(@map.name),
      rows: @map.rows,
      cols: @map.cols,
      layout_data: @map.safe_layout_data.deep_dup,
      color_settings: @map.safe_color_settings.deep_dup,
      lineups: @map.safe_lineups.deep_dup,
    )

    if new_map.save
      redirect_to edit_hall_map_path(@hall, new_map), notice: "マップを複製しました。"
    else
      redirect_to hall_maps_path(@hall), alert: "マップの複製に失敗しました: #{new_map.errors.full_messages.join(', ')}"
    end
  end

  private

  def set_hall
    @hall = Hall.find(params[:hall_id])
  end

  def set_map
    @map = @hall.hall_maps.find(params[:id])
  end

  def map_params
    params.require(:hall_map).permit(:name, :rows, :cols)
  end

  def initialize_empty_layout(map)
    layout = {}
    (1..map.rows).each do |row|
      (1..map.cols).each do |col|
        layout["#{row}_#{col}"] = { "type" => "empty" }
      end
    end
    map.layout_data = layout
  end

  def generate_unique_copy_name(original_name)
    # "元の名前のコピー" を基本とする
    base_name = "#{original_name}のコピー"

    # 既に同じ名前が存在しない場合はそのまま返す
    return base_name unless @hall.hall_maps.exists?(name: base_name)

    # 既に存在する場合は連番を付ける
    counter = 2
    loop do
      new_name = "#{original_name}のコピー#{counter}"
      return new_name unless @hall.hall_maps.exists?(name: new_name)
      counter += 1
    end
  end
end
