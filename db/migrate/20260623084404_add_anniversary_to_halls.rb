class AddAnniversaryToHalls < ActiveRecord::Migration[8.1]
  def change
    add_column :halls, :anniversary_month_day, :string
    add_column :halls, :grand_open_date, :date
  end
end
