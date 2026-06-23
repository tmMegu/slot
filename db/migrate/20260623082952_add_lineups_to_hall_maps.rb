class AddLineupsToHallMaps < ActiveRecord::Migration[8.1]
  def change
    add_column :hall_maps, :lineups, :text
  end
end
