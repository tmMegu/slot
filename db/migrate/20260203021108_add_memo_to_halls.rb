class AddMemoToHalls < ActiveRecord::Migration[8.1]
  def change
    add_column :halls, :memo, :text
  end
end
