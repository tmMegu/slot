class AddDataImportUrlsToHalls < ActiveRecord::Migration[8.1]
  def change
    add_column :halls, :data_import_url1, :text
    add_column :halls, :data_import_url2, :text
    add_column :halls, :data_import_url3, :text
    add_column :halls, :data_import_url4, :text
    add_column :halls, :data_import_url5, :text
  end
end
