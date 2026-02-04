class HallMap < ApplicationRecord
  belongs_to :hall

  serialize :layout_data, coder: JSON
  serialize :color_settings, coder: JSON

  validates :name, presence: true
  validates :rows, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 100 }
  validates :cols, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 100 }

  before_save :ensure_hash_format

  # セルのデータを取得
  def get_cell(row, col)
    data = safe_layout_data
    return {} unless data
    data["#{row}_#{col}"] || {}
  end

  # セルのデータを設定
  def set_cell(row, col, data)
    self.layout_data ||= {}
    self.layout_data["#{row}_#{col}"] = data
  end

  # 全セルのデータを取得
  def all_cells
    safe_layout_data || {}
  end

  # マップ上の全台番号を取得
  def machine_numbers
    data = safe_layout_data
    return [] unless data.is_a?(Hash)

    begin
      data.values
          .select { |cell| cell.is_a?(Hash) && cell["type"] == "machine" && cell["machine_number"] }
          .map { |cell| cell["machine_number"] }
          .compact
          .uniq
          .sort
    rescue => e
      Rails.logger.error "machine_numbers error: #{e.message}"
      []
    end
  end

  # 色分け設定のデフォルト値
  def default_color_settings
    {
      "condition" => "past_7_diff",
      "threshold_red" => -5000,
      "threshold_green" => 5000,
      "enabled" => true
    }
  end

  # 色分け設定を取得（デフォルト値付き）
  def get_color_settings
    settings = safe_color_settings || {}
    settings.reverse_merge(default_color_settings)
  end

  # 公開メソッド：layout_dataを安全に取得
  def safe_layout_data
    parse_json_field(layout_data)
  end

  # 公開メソッド：color_settingsを安全に取得
  def safe_color_settings
    parse_json_field(color_settings)
  end

  private

  # JSON形式のフィールドを安全にパース
  def parse_json_field(field_value)
    return {} if field_value.nil?
    return field_value if field_value.is_a?(Hash)

    if field_value.is_a?(String)
      begin
        parsed = JSON.parse(field_value)
        return parsed if parsed.is_a?(Hash)
        {}
      rescue JSON::ParserError => e
        Rails.logger.error "JSON parse error: #{e.message}"
        {}
      end
    else
      {}
    end
  end

  # 保存前にハッシュ形式を保証
  def ensure_hash_format
    self.layout_data = safe_layout_data
    self.color_settings = safe_color_settings
  end
end
