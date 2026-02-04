class CreateHallMaps < ActiveRecord::Migration[7.0]
  def change
    create_table :hall_maps do |t|
      t.references :hall, null: false, foreign_key: true
      t.string :name, null: false, default: 'メインフロア'
      t.integer :rows, null: false, default: 20
      t.integer :cols, null: false, default: 40
      t.text :layout_data  # JSON形式でマップ配置を保存
      t.text :color_settings  # JSON形式で色分け設定を保存
      t.timestamps
    end

    add_index :hall_maps, [ :hall_id, :name ], unique: true
  end
end
