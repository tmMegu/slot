# ホール（パチンコ・スロット店）を表すモデル
#
# カラム:
#   id   - 主キー
#   name - ホール名（必須）
#   code - ホールコード（データ取得用）
#   created_at, updated_at - タイムスタンプ
#
# 関連:
#   has_many :machine_data - ホールの台データ（日付×台番号）
#   has_many :hall_maps    - ホールのフロアマップ
class Hall < ApplicationRecord
  has_many :machine_data, class_name: "MachineData", dependent: :destroy
  has_many :hall_maps, dependent: :destroy

  validates :name, presence: true
end
