# ホールのフロアマップを表すモデル
#
# カラム:
#   id             - 主キー
#   hall_id         - ホールID（外部キー）
#   name           - マップ名
#   rows           - 行数（1〜100）
#   cols           - 列数（1〜100）
#   layout_data    - セル配置データ（JSON形式）
#                    キー: "行_列" (例: "0_3")
#                    値: { type: "machine"/"wall"/"counter", machine_number: 台番号, label: ラベル }
#   color_settings - 色分け設定（JSON形式）
#   lineups        - 並び（島）情報の配列（JSON形式）
#                    [{ id: number, name: string, machine_numbers: number[] }, ...]
#   created_at, updated_at - タイムスタンプ
#
# 関連:
#   belongs_to :hall - 所属ホール
class HallMap < ApplicationRecord
  belongs_to :hall

  serialize :layout_data, coder: JSON
  serialize :color_settings, coder: JSON
  serialize :lineups, coder: JSON, type: Array

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

  # 並び情報を安全に取得（配列）
  def safe_lineups
    parse_array_field(lineups)
  end

  # 並び情報を上書き保存する。lineups_data は配列 [{id, name, machine_numbers: [..]}]
  # 入力順は物理的順序（島の端→端）として意味があるため保持する。重複は除去するが並び替えはしない。
  # id が無い要素には自動採番、空並びは破棄する。
  def replace_lineups(lineups_data)
    return unless lineups_data.is_a?(Array)
    existing_ids = lineups_data.map { |e| (e.is_a?(Hash) || e.is_a?(ActionController::Parameters)) ? (e["id"] || e[:id]).to_i : 0 }.select { |i| i > 0 }
    next_id = (existing_ids.max || 0) + 1
    cleaned = lineups_data.map do |entry|
      next unless entry.is_a?(Hash) || entry.is_a?(ActionController::Parameters)
      entry = entry.to_unsafe_h if entry.respond_to?(:to_unsafe_h)
      raw = entry["machine_numbers"] || entry[:machine_numbers] || []
      nums = []
      seen = {}
      raw.each do |v|
        n = v.to_i
        next if n <= 0 || seen[n]
        seen[n] = true
        nums << n
      end
      next if nums.empty?
      id = (entry["id"] || entry[:id]).to_i
      if id <= 0
        id = next_id
        next_id += 1
      end
      {
        "id" => id,
        "name" => (entry["name"] || entry[:name]).to_s.strip,
        "machine_numbers" => nums
      }
    end.compact
    self.lineups = cleaned
  end

  # 指定台番号が属する並びを返す（複数の並びに属することは想定しない）
  def lineup_for(machine_number)
    safe_lineups.find { |l| (l["machine_numbers"] || []).include?(machine_number) }
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

  # 配列形式のフィールドを安全にパース（lineups 用）
  def parse_array_field(field_value)
    return [] if field_value.nil?
    return field_value if field_value.is_a?(Array)
    if field_value.is_a?(String)
      begin
        parsed = JSON.parse(field_value)
        return parsed if parsed.is_a?(Array)
        []
      rescue JSON::ParserError => e
        Rails.logger.error "JSON parse error (array): #{e.message}"
        []
      end
    else
      []
    end
  end

  # 保存前にハッシュ形式を保証
  def ensure_hash_format
    self.layout_data = safe_layout_data
    self.color_settings = safe_color_settings
    self.lineups = safe_lineups
  end
end
