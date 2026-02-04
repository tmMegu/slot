# frozen_string_literal: true

# ホールマップをPDFとして生成するサービスクラス
# Prawnライブラリを使用してサーバーサイドでPDFを作成します
class HallMapPdfService
  # 1mmをポイントに変換する定数（1mm = 2.83465pt）
  MM_TO_PT = 2.83465

  # 初期化
  #
  # @param hall [Hall] ホール情報
  # @param date [String] 日付（YYYY-MM-DD形式）
  # @param hall_map [HallMap] マップレイアウト情報
  # @param machine_data_by_number [Hash] 台番号をキーとした機種データのハッシュ
  # @param color_worst_ranks [Hash] 台番号をキーとしたワーストランク情報のハッシュ
  # @param display_settings [Hash] 表示設定のハッシュ
  # @param color_settings [Hash] 色分け設定のハッシュ
  def initialize(hall:, date:, hall_map:, machine_data_by_number:, color_worst_ranks: {}, display_settings: {}, color_settings: {})
    @hall = hall
    @date = date
    @hall_map = hall_map
    @machine_data = machine_data_by_number
    @color_worst_ranks = color_worst_ranks
    @display_settings = display_settings
    @color_settings = color_settings.presence || hall_map.get_color_settings
  end

  # PDFを生成して返す
  #
  # @return [String] PDF形式のバイナリデータ
  def generate
    cell_width_mm = 34
    cell_height_mm = 34
    margin_mm = 5 # 余白5mm
    page_width_pt = (@hall_map.cols * cell_width_mm + margin_mm * 2) * MM_TO_PT
    page_height_pt = (@hall_map.rows * cell_height_mm + margin_mm * 2) * MM_TO_PT

    Prawn::Document.new(
      page_size: [ page_width_pt, page_height_pt ],
      margin: margin_mm * MM_TO_PT,
      page_layout: :portrait
    ) do |pdf|
      font_path = "C:/Windows/Fonts/meiryo.ttc"
      pdf.font font_path if File.exist?(font_path)
      # マップグリッドを描画
      draw_map_grid(pdf, cell_width_mm, cell_height_mm)
    end.render
  end

  # マップグリッドを描画
  def draw_map_grid(pdf, cell_width_mm, cell_height_mm)
    margin_pt = 5 * MM_TO_PT
    cell_w = cell_width_mm * MM_TO_PT
    cell_h = cell_height_mm * MM_TO_PT
    rows = @hall_map.rows
    cols = @hall_map.cols
    layout = @hall_map.safe_layout_data
    color_settings = @color_settings
    show_name = @display_settings[:show_machine_name]
    show_number = @display_settings[:show_machine_number]

    rows.times do |row_idx|
      cols.times do |col_idx|
        x = margin_pt + col_idx * cell_w
        y = pdf.bounds.top - margin_pt - row_idx * cell_h
        cell_key = "#{row_idx + 1}_#{col_idx + 1}"
        cell = layout[cell_key] || {}
        cell_type = cell["type"] || "empty"
        label = cell["label"]
        machine_number = cell["machine_number"]
        machine = @machine_data[machine_number] if machine_number
        worst_rank = @color_worst_ranks[machine_number] if machine_number && @color_worst_ranks

        # machine/wall/counterセルのみ背景・枠線を描画
        unless cell_type == "empty"
          # 背景色決定
          bg_color =
            if cell_type == "machine"
              if color_settings["enabled"] && color_settings["condition"] == "worst_7days"
                case worst_rank
                when 1 then "FFCCCC"
                when 2 then "CCFFCC"
                else "F0F0F0"
                end
              else
                "F0F0F0"
              end
            elsif cell_type == "wall"
              "333333"
            elsif cell_type == "counter"
              "FFC107"
            else
              "FFFFFF"
            end
          pdf.save_graphics_state do
            pdf.fill_color bg_color
            pdf.fill_rectangle [ x, y ], cell_w, cell_h
            pdf.fill_color "000000"
            pdf.stroke_color "DDDDDD"
            pdf.line_width = 1
            # 上線
            pdf.stroke_line [ x, y ], [ x + cell_w, y ]
            # 左線
            pdf.stroke_line [ x, y ], [ x, y - cell_h ]
            # 右端セルのみ右線
            if col_idx == cols - 1
              pdf.stroke_line [ x + cell_w, y ], [ x + cell_w, y - cell_h ]
            end
            # 最下行セルのみ下線
            if row_idx == rows - 1
              pdf.stroke_line [ x, y - cell_h ], [ x + cell_w, y - cell_h ]
            end
            pdf.stroke_color "000000"
          end
        end

        # セル内容
        pdf.bounding_box([ x, y ], width: cell_w, height: cell_h) do
          case cell_type
          when "machine"
            # 機種名（上部、5文字まで）
            if show_name && machine&.machine_name
              pdf.text_box machine.machine_name.to_s.slice(0, 5),
                at: [0, cell_h * 0.55],
                width: cell_w,
                height: cell_h * 0.25,
                align: :center,
                valign: :top,
                size: 14
            end
            # 台番号（機種名のすぐ下、中央寄せ）
            if machine_number
              pdf.text_box machine_number.to_s,
                at: [0, cell_h * 0.3],
                width: cell_w,
                height: cell_h * 0.25,
                align: :center,
                valign: :top,
                size: 18
            end
          when "wall"
            pdf.text_box(label || "■",
              at: [ 0, cell_h * 0.5 ],
              width: cell_w,
              height: cell_h,
              align: :center,
              valign: :center,
              size: 12,
              color: "FFFFFF")
          when "counter"
            pdf.text_box(label || "カウンター",
              at: [ 0, cell_h * 0.5 ],
              width: cell_w,
              height: cell_h,
              align: :center,
              valign: :center,
              size: 10)
          end
        end
      end
    end
  end
end
