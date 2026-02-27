# 台データ（1日1台ごとの実績）を表すモデル
#
# カラム:
#   id               - 主キー
#   hall_id           - ホールID（外部キー）
#   date             - 日付
#   machine_number   - 台番号
#   machine_name     - 機種名（メモ専用レコードの場合は空）
#   game_count       - 回転数（G数）
#   difference_count - 差枚数
#   bb_count         - BB回数
#   rb_count         - RB回数
#   art_count        - ART回数
#   machine_memo     - 台メモ（ユーザー入力）
#   created_at, updated_at - タイムスタンプ
#
# 関連:
#   belongs_to :hall - 所属ホール
#
# メモ専用レコード:
#   データが存在しない日でも台メモだけ保存できるように、
#   全カウントが0の場合は機種名を空にして保存する
class MachineData < ApplicationRecord
  belongs_to :hall

  validates :date, presence: true
  validates :machine_number, presence: true
  # 実データの場合のみ機種名を必須とする（全カウントが0の場合はメモ専用レコード）
  validates :machine_name, presence: true, unless: :memo_only_record?

  private

  # 全ての数値カラムが0の場合はメモ専用レコードとみなす
  def memo_only_record?
    game_count == 0 && difference_count == 0 && bb_count == 0 && rb_count == 0 && art_count == 0
  end
end
