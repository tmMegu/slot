class CreateHalls < ActiveRecord::Migration[8.1]
  def change
    create_table :halls do |t|
      t.string :name
      t.integer :code

      t.timestamps
    end
  end
end
