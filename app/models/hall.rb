class Hall < ApplicationRecord
  has_many :machine_data, class_name: "MachineData", dependent: :destroy
  has_many :hall_maps, dependent: :destroy

  validates :name, presence: true
end
