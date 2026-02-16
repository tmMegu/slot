class MachineData < ApplicationRecord
  belongs_to :hall

  validates :date, presence: true
  validates :machine_number, presence: true
  # 実データの場合のみ機種名を必須とする（全カウントが0の場合はメモ専用レコード）
  validates :machine_name, presence: true, unless: :memo_only_record?

  private

  def memo_only_record?
    game_count == 0 && difference_count == 0 && bb_count == 0 && rb_count == 0 && art_count == 0
  end
end
