# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_02_03_041015) do
  create_table "hall_maps", force: :cascade do |t|
    t.text "color_settings"
    t.integer "cols", default: 20, null: false
    t.datetime "created_at", null: false
    t.integer "hall_id", null: false
    t.text "layout_data"
    t.string "name", default: "メインフロア", null: false
    t.integer "rows", default: 10, null: false
    t.datetime "updated_at", null: false
    t.index ["hall_id", "name"], name: "index_hall_maps_on_hall_id_and_name", unique: true
    t.index ["hall_id"], name: "index_hall_maps_on_hall_id"
  end

  create_table "halls", force: :cascade do |t|
    t.integer "code"
    t.datetime "created_at", null: false
    t.text "memo"
    t.string "name"
    t.datetime "updated_at", null: false
  end

  create_table "machine_data", force: :cascade do |t|
    t.integer "art_count"
    t.integer "bb_count"
    t.datetime "created_at", null: false
    t.date "date"
    t.text "date_memo"
    t.integer "difference_count"
    t.integer "game_count"
    t.integer "hall_id", null: false
    t.text "machine_memo"
    t.string "machine_name"
    t.integer "machine_number"
    t.integer "rb_count"
    t.datetime "updated_at", null: false
    t.index ["hall_id"], name: "index_machine_data_on_hall_id"
  end

  add_foreign_key "hall_maps", "halls"
  add_foreign_key "machine_data", "halls"
end
