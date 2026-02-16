class MachineData < ApplicationRecord
  belongs_to :hall

  validates :date, presence: true
  validates :machine_number, presence: true
  # メモ専用レコード（machine_nameが空でmemoが存在する）の場合はmachine_nameが空でもOK
  validates :machine_name, presence: true, unless: :memo_only_record?

  private

  def memo_only_record?
    machine_name.blank? && (machine_memo.present? || date_memo.present?)
  end
end
