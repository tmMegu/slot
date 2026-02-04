class AddMemosToMachineData < ActiveRecord::Migration[8.1]
  def change
    add_column :machine_data, :date_memo, :text
    add_column :machine_data, :machine_memo, :text
  end
end
