Rails.application.routes.draw do
  root "halls#index"

  resources :halls do
    member do
      # 日付メモの一括更新
      post :update_date_memos
    end

    # 傾向調査機能
    get "trend_analysis", to: "trend_analysis#show", as: "trend_analysis"

    # データ分析機能
    get "data_analysis", to: "data_analysis#show", as: "data_analysis"

    # 台番号の過去データ表示
    get "machines/:machine_number", to: "machine_data#machine_history", as: "machine_history"

    get "dates/:date", to: "machine_data#show", as: "machine_data"

    # マップ単独表示画面（タブから独立）
    get "dates/:date/map", to: "machine_data#show_map", as: "machine_map"

    # 台メモの更新
    post "dates/:date/update_machine_memo", to: "machine_data#update_machine_memo", as: "update_machine_memo"
    post "dates/:date/update_machine_memos", to: "machine_data#update_machine_memos", as: "update_machine_memos"

    # 手動データインポート
    post "dates/:date/manual_import", to: "machine_data#manual_import", as: "manual_import_machine_data"

    # マップ関連のルート
    resources :maps, controller: "hall_maps", except: [ :show ] do
      member do
        post :duplicate  # マップの複製
      end
    end

    # マップデータのAPI的なエンドポイント
    get "maps/:id/data", to: "hall_maps#map_data", as: "map_data"
  end

  # データインポート
  get "import", to: "machine_data#import_form"
  post "import", to: "machine_data#import"
  post "machine_data/batch_import", to: "machine_data#batch_import"
end
