# ホール（パチンコ・スロット店）を表すモデル
#
# カラム:
#   id                    - 主キー
#   name                  - ホール名（必須）
#   code                  - ホールコード（データ取得用）
#   memo                  - メモ
#   anniversary_month_day - 周年日（MM-DD形式、例 "07-15"。年は無視で毎年同じ日）
#   grand_open_date       - グランドオープン日（特定の1日）
#   data_import_url1..5   - 外部サイトからのインポートURL
#   created_at, updated_at - タイムスタンプ
#
# 関連:
#   has_many :machine_data - ホールの台データ（日付×台番号）
#   has_many :hall_maps    - ホールのフロアマップ
class Hall < ApplicationRecord
  has_many :machine_data, class_name: "MachineData", dependent: :destroy
  has_many :hall_maps, dependent: :destroy

  validates :name, presence: true
  validates :anniversary_month_day,
    format: { with: /\A(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\z/, message: "は MM-DD 形式で入力" },
    allow_blank: true
end
