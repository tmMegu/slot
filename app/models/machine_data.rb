class MachineData < ApplicationRecord
  belongs_to :hall

  validates :date, presence: true
  validates :machine_number, presence: true
  validates :machine_name, presence: true
end
