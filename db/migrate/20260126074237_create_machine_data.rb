class CreateMachineData < ActiveRecord::Migration[8.1]
  def change
    create_table :machine_data do |t|
      t.references :hall, null: false, foreign_key: true
      t.date :date
      t.integer :machine_number
      t.string :machine_name
      t.integer :game_count
      t.integer :difference_count
      t.integer :bb_count
      t.integer :rb_count
      t.integer :art_count

      t.timestamps
    end
  end
end
