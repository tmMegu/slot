// ============================================================
// hall_map.js - マップタブの表示色分けズーム機能
//
// 主な機能:
//   1. 色分けモード（5種類の条件で台を色分け表示）
//   2. 表示設定（機種名台番号差枚回転数の表示切替）
//   3. セルサイズフォントサイズの調整
//   4. ズーム機能（PC: Ctrl+ホイール、スマホ: ピンチ操作）
// ============================================================

// ------------------------------------------------------------
// 定数グローバル変数
// ------------------------------------------------------------

// 色分けに使用するCSSクラス一覧
var ALL_COLOR_CLASSES = [
  "color-red",
  "color-green",
  "color-yellow",
  "color-light-green",
  "color-dark-green",
  "color-light-red",
  "color-dark-red",
];

// 色分け機能の有効/無効フラグ
var colorEnabled = true;

// ズーム倍率をグローバルに保持（セルサイズ変更時に再適用するため）
window.currentMapZoomScale = 1;

// 初期化済みフラグ（スクリプトの重複読み込み対策）
if (typeof window.mapIsInitialized === "undefined") {
  window.mapIsInitialized = false;
}

// ============================================================
// 色分け機能
// ============================================================

/**
 * 色分けモードの切り替え（チェックボックスから呼ばれる）
 * グローバルスコープで定義（HTMLのonchange等から直接呼び出すため）
 */
window.toggleColorMode = function () {
  var checkbox = document.getElementById("color-enabled");
  if (checkbox) {
    colorEnabled = checkbox.checked;

    // 色分け設定パネルの表示/非表示を切り替え
    var content = document.getElementById("color-settings-content");
    if (content) {
      content.style.display = colorEnabled ? "block" : "none";
    }

    // 色を更新
    updateMapColors();
  }
};

/**
 * マップの色分けを更新する
 * 選択中の色分け条件に応じて適切な関数を呼び出す
 */
window.updateMapColors = function () {
  if (!colorEnabled) {
    clearAllColors();
    return;
  }

  var conditionElement = document.getElementById("color-condition");
  if (!conditionElement) return;

  var condition = conditionElement.value;

  // 色の説明テキストを更新
  updateColorDescription(condition);

  // 各条件に応じた色分けを適用
  switch (condition) {
    case "worst_7days":
      applyWorstRankColors();
      break;
    case "past_7days_minus":
      applyPast7DaysColors("minus");
      break;
    case "past_7days_plus":
      applyPast7DaysColors("plus");
      break;
    case "worst_model_7days":
      applyWorstModelColors();
      break;
    case "today_diff_levels":
      applyTodayDiffLevelColors();
      break;
  }
};

/**
 * 色分け条件の説明テキストを更新する
 * @param {string} condition - 色分け条件のID
 */
function updateColorDescription(condition) {
  var descElement = document.getElementById("color-description");
  if (!descElement) return;

  var html = "<strong>色の意味:</strong><br>";

  switch (condition) {
    case "worst_7days":
      html += " 赤色 = 機種ごとのワースト1位（最も差枚が悪い台）<br>";
      html += " 緑色 = 機種ごとのワースト2位（2番目に差枚が悪い台）";
      break;
    case "past_7days_minus":
      html += " 赤色 = 過去7日間の合計差枚がマイナスの台";
      break;
    case "past_7days_plus":
      html += " 緑色 = 過去7日間の合計差枚がプラスの台";
      break;
    case "worst_model_7days":
      html += " 赤色 = 過去7日間で最も機種合計差枚が低い機種の全台";
      break;
    case "today_diff_levels":
      html += " 薄い緑 = +1,000〜1,999<br>";
      html += " 濃い緑 = +2,000〜2,999<br>";
      html += " 薄い赤 = +3,000〜3,999<br>";
      html += " 濃い赤 = +4,000以上";
      break;
  }

  descElement.innerHTML = html;
}

// ------------------------------------------------------------
// 色分けヘルパー関数
// ------------------------------------------------------------

/**
 * 指定されたセルから全ての色分けクラスを除去する
 * @param {NodeList|Array} cells - 対象のセル要素リスト
 */
function removeColorClasses(cells) {
  cells.forEach(function (cell) {
    ALL_COLOR_CLASSES.forEach(function (cls) {
      cell.classList.remove(cls);
    });
  });
}

/**
 * 全てのマップセルから色分けを解除する
 */
function clearAllColors() {
  var cells = document.querySelectorAll(".map-cell");
  removeColorClasses(cells);
}

/**
 * セルのdata-past-7days-diff属性から過去7日間の差枚を取得する
 * @param {Element} cell - マップセル要素
 * @returns {number|null} 差枚の数値（無効な場合はnull）
 */
function getPast7DaysDiff(cell) {
  var diffStr = cell.getAttribute("data-past-7days-diff");
  if (diffStr === undefined || diffStr === null || diffStr === "") return null;
  var diff = parseFloat(diffStr);
  return isNaN(diff) ? null : diff;
}

/**
 * フィルター条件をチェックして、色分け対象かどうかを判定する
 * - 機種名フィルター（含む/含まない）
 * - 台数範囲フィルター
 * @param {Element} cell - マップセル要素
 * @returns {boolean} 色分け対象ならtrue
 */
function shouldApplyColorToCell(cell) {
  // --- 機種名フィルター（複数キーワード対応） ---
  var modelFilterType =
    document.getElementById("model-filter-type")?.value || "none";
  var modelFilterText =
    document.getElementById("model-filter-text")?.value || "";

  if (modelFilterType !== "none" && modelFilterText.trim()) {
    var machineName = cell.getAttribute("data-machine-name") || "";
    // 空白で分割してキーワードの配列を作成
    var keywords = modelFilterText.trim().split(/\s+/);

    if (modelFilterType === "include") {
      // 「含む」: いずれかのキーワードが機種名に含まれていればOK（OR検索）
      var matchesAny = keywords.some(function (keyword) {
        return machineName.includes(keyword);
      });
      if (!matchesAny) return false;
    } else if (modelFilterType === "exclude") {
      // 「含まない」: いずれかのキーワードが含まれていたらNG
      var matchesAnyExclude = keywords.some(function (keyword) {
        return machineName.includes(keyword);
      });
      if (matchesAnyExclude) return false;
    }
  }

  // --- 台数範囲フィルター ---
  var countFilterEnabled =
    document.getElementById("machine-count-filter-enabled")?.checked || false;

  if (countFilterEnabled) {
    var machineNameForCount = cell.getAttribute("data-machine-name") || "";
    var minCount =
      parseInt(document.getElementById("machine-count-min")?.value) || 0;
    var maxCount =
      parseInt(document.getElementById("machine-count-max")?.value) || Infinity;

    // 同じ機種名の台数をカウント
    var allCells = document.querySelectorAll('.map-cell[data-type="machine"]');
    var machineCount = Array.from(allCells).filter(function (c) {
      return c.getAttribute("data-machine-name") === machineNameForCount;
    }).length;

    if (machineCount < minCount || machineCount > maxCount) {
      return false;
    }
  }

  return true;
}

// ------------------------------------------------------------
// 色分け条件ごとの適用関数
// ------------------------------------------------------------

/**
 * 機種ごとのワーストランキング色分けを適用
 * ワースト1位  赤、ワースト2位  緑
 * フィルター後に動的に計算する
 */
function applyWorstRankColors() {
  var cells = document.querySelectorAll('.map-cell[data-type="machine"]');
  removeColorClasses(cells);

  // フィルター対象の台を収集し、機種ごとにグループ化
  var machineGroups = {};
  cells.forEach(function (cell) {
    if (!shouldApplyColorToCell(cell)) return;

    var machineName = cell.getAttribute("data-machine-name") || "";
    var diff = getPast7DaysDiff(cell);
    if (diff === null) return;

    if (!machineGroups[machineName]) {
      machineGroups[machineName] = [];
    }
    machineGroups[machineName].push({ cell: cell, diff: diff });
  });

  // 各機種内でワースト1,2を計算して色を適用
  Object.values(machineGroups).forEach(function (group) {
    // 差枚で昇順ソート（小さい方がワースト）
    group.sort(function (a, b) {
      return a.diff - b.diff;
    });

    // ワースト1位は赤
    if (group.length >= 1) {
      group[0].cell.classList.add("color-red");
    }
    // ワースト2位は緑
    if (group.length >= 2) {
      group[1].cell.classList.add("color-green");
    }
  });
}

/**
 * 過去7日間の差枚がマイナス/プラスの台を色分けする（共通関数）
 * applyPast7DaysMinusColors と applyPast7DaysPlusColors を統合
 *
 * @param {string} type - "minus"（マイナス台を赤）または "plus"（プラス台を緑）
 */
function applyPast7DaysColors(type) {
  var cells = document.querySelectorAll('.map-cell[data-type="machine"]');

  cells.forEach(function (cell) {
    // まず色をクリア
    removeColorClasses([cell]);

    if (!shouldApplyColorToCell(cell)) return;

    var diff = getPast7DaysDiff(cell);
    if (diff === null) return;

    if (type === "minus" && diff < 0) {
      cell.classList.add("color-red");
    } else if (type === "plus" && diff > 0) {
      cell.classList.add("color-green");
    }
  });
}

/**
 * 過去7日間で最も機種合計差枚が低い機種の全台を赤色にする
 * フィルター後に動的に計算する
 */
function applyWorstModelColors() {
  var cells = document.querySelectorAll('.map-cell[data-type="machine"]');
  removeColorClasses(cells);

  // フィルター対象の台を収集し、機種ごとの合計差枚を計算
  var modelTotals = {};
  var modelCells = {};

  cells.forEach(function (cell) {
    if (!shouldApplyColorToCell(cell)) return;

    var machineName = cell.getAttribute("data-machine-name") || "";
    var diff = getPast7DaysDiff(cell);
    if (diff === null) return;

    if (!modelTotals[machineName]) {
      modelTotals[machineName] = 0;
      modelCells[machineName] = [];
    }
    modelTotals[machineName] += diff;
    modelCells[machineName].push(cell);
  });

  // 機種合計差枚が最も低い機種を特定
  var worstModelName = null;
  var worstTotal = Infinity;

  Object.entries(modelTotals).forEach(function (entry) {
    var modelName = entry[0];
    var total = entry[1];
    if (total < worstTotal) {
      worstTotal = total;
      worstModelName = modelName;
    }
  });

  // 最も差枚が低い機種の全台に赤色を適用
  if (worstModelName && modelCells[worstModelName]) {
    modelCells[worstModelName].forEach(function (cell) {
      cell.classList.add("color-red");
    });
  }
}

/**
 * 当日の差枚を段階的に色分けする
 * +1,000〜1,999  薄い緑、+2,000〜2,999  濃い緑
 * +3,000〜3,999  薄い赤、+4,000以上  濃い赤
 */
function applyTodayDiffLevelColors() {
  var cells = document.querySelectorAll('.map-cell[data-type="machine"]');

  cells.forEach(function (cell) {
    removeColorClasses([cell]);

    if (!shouldApplyColorToCell(cell)) return;

    var level = cell.dataset.todayDiffLevel;
    if (level) {
      switch (level) {
        case "1":
          cell.classList.add("color-light-green"); // +1,000〜1,999
          break;
        case "2":
          cell.classList.add("color-dark-green"); // +2,000〜2,999
          break;
        case "3":
          cell.classList.add("color-light-red"); // +3,000〜3,999
          break;
        case "4":
          cell.classList.add("color-dark-red"); // +4,000以上
          break;
      }
    }
  });
}

// ============================================================
// 表示設定機能
// ============================================================

/**
 * マップの表示内容を更新する
 * チェックボックスの状態に応じて、各要素の表示/非表示を切り替える
 */
window.updateMapDisplay = function () {
  var nameCheckbox = document.getElementById("show-machine-name");
  var numberCheckbox = document.getElementById("show-machine-number");
  var diffCheckbox = document.getElementById("show-diff");
  var gamesCheckbox = document.getElementById("show-map-games");
  var bbCheckbox = document.getElementById("show-bb");

  var showMachineName = nameCheckbox?.checked ?? true;
  var showMachineNumber = numberCheckbox?.checked ?? true;
  var showDiff = diffCheckbox?.checked ?? false;
  var showGames = gamesCheckbox?.checked ?? false;
  var showBb = bbCheckbox?.checked ?? false;

  var cells = document.querySelectorAll('.map-cell[data-type="machine"]');

  cells.forEach(function (cell) {
    var machineInfo = cell.querySelector(".machine-info");
    if (!machineInfo) return;

    // 各要素の表示/非表示を切り替え
    var nameElement = machineInfo.querySelector(".machine-name");
    var numberElement = machineInfo.querySelector(".machine-number");
    var statsElement = machineInfo.querySelector(".machine-stats");

    if (nameElement) {
      nameElement.style.display = showMachineName ? "block" : "none";
    }
    if (numberElement) {
      numberElement.style.display = showMachineNumber ? "block" : "none";
    }

    // statsElementが存在しない場合は作成
    if (!statsElement) {
      statsElement = document.createElement("div");
      statsElement.className = "machine-stats";
      machineInfo.appendChild(statsElement);
    }

    // 差枚回転数BBの表示を組み立て
    var difference = cell.dataset.difference || "0";
    var games = cell.dataset.games || "0";
    var statsHtml = "";

    if (showDiff) {
      var diffNum = parseInt(difference);
      var diffClass = diffNum > 0 ? "positive" : diffNum < 0 ? "negative" : "";
      statsHtml +=
        '<div class="stat-diff ' +
        diffClass +
        '">' +
        (diffNum > 0 ? "+" : "") +
        difference +
        "</div>";
    }

    if (showGames) {
      statsHtml += '<div class="stat-games">' + games + "G</div>";
    }

    if (showBb) {
      // BB情報は追加のデータが必要（現状は非表示）
      statsHtml += '<div class="stat-bb">BB: -</div>';
    }

    statsElement.innerHTML = statsHtml;
    statsElement.style.display =
      showDiff || showGames || showBb ? "flex" : "none";
  });
};

/**
 * セルサイズを更新する（横幅縦幅を別々に指定可能）
 */
window.updateCellSize = function () {
  var cells = document.querySelectorAll(".map-cell");
  var tables = document.querySelectorAll(".map-table, #map-table");
  var widthSlider = document.getElementById("cell-width-slider");
  var heightSlider = document.getElementById("cell-height-slider");
  var widthDisplay = document.getElementById("cell-width-display");
  var heightDisplay = document.getElementById("cell-height-display");

  var width = widthSlider ? widthSlider.value : 40;
  var height = heightSlider ? heightSlider.value : 20;

  // テーブルにtable-layout: fixedを設定してセル幅を固定
  tables.forEach(function (table) {
    table.style.setProperty("table-layout", "fixed", "important");
    table.style.setProperty("width", "auto", "important");
    table.style.setProperty("max-width", "none", "important");
    table.style.setProperty("display", "table", "important");
    // ズームのtransformを維持（リセットしない）
  });

  cells.forEach(function (cell) {
    cell.style.setProperty("width", width + "px", "important");
    cell.style.setProperty("min-width", width + "px", "important");
    cell.style.setProperty("max-width", width + "px", "important");
    cell.style.setProperty("height", height + "px", "important");
    cell.style.setProperty("box-sizing", "border-box", "important");
  });

  if (widthDisplay) widthDisplay.textContent = width + "px";
  if (heightDisplay) heightDisplay.textContent = height + "px";

  // セルサイズ変更後、ズームのサイズ調整を再計算
  var mapTable = document.querySelector(".map-table");
  if (mapTable && window.currentMapZoomScale) {
    applyZoomWithCurrentScale(mapTable, window.currentMapZoomScale);
  }
};

/**
 * フォントサイズを更新する
 * 機種名台番号差枚回転数は全て同じサイズに統一
 * @param {number|string} size - フォントサイズ（px）
 */
window.updateFontSize = function (size) {
  var display = document.getElementById("font-size-display");
  var slider = document.getElementById("font-size-slider");
  var sizeNum = parseFloat(size);

  // スライダーの値を更新
  if (slider) slider.value = sizeNum;

  // machine-info内の全要素にフォントサイズを適用（全て同じサイズに統一）
  var machineInfos = document.querySelectorAll(".machine-info");

  machineInfos.forEach(function (info) {
    var nameElement = info.querySelector(".machine-name");
    var numberElement = info.querySelector(".machine-number");
    var statsElement = info.querySelector(".machine-stats");

    if (nameElement) nameElement.style.fontSize = sizeNum + "px";
    if (numberElement) numberElement.style.fontSize = sizeNum + "px";
    if (statsElement) {
      statsElement.style.fontSize = sizeNum + "px";
      // 個別要素にも適用
      var statItems = statsElement.querySelectorAll(
        ".stat-diff, .stat-games, .stat-bb",
      );
      statItems.forEach(function (item) {
        item.style.fontSize = sizeNum + "px";
      });
    }
  });

  if (display) display.textContent = sizeNum + "px";
};

/**
 * グリッド線の表示切り替え
 */
window.toggleGrid = function () {
  var checkbox = document.getElementById("show-grid");
  if (!checkbox) return;

  var showGrid = checkbox.checked;
  var tables = document.querySelectorAll(".map-table, #map-table");

  tables.forEach(function (table) {
    if (showGrid) {
      table.classList.remove("no-grid");
    } else {
      table.classList.add("no-grid");
    }
  });
};

/**
 * マップ切り替え（ページリロード）
 */
window.changeMap = function (mapId) {
  location.reload();
};

/**
 * 折りたたみパネルの開閉
 * @param {string} panelId - パネルのDOM ID
 */
window.togglePanel = function (panelId) {
  var content = document.getElementById(panelId);
  if (!content) return;

  // 直前の兄弟要素からトグルボタンを探す
  var prevSibling = content.previousElementSibling;
  var toggle = prevSibling?.querySelector(".collapsible-toggle");

  // activeクラスをトグル
  if (content.classList.contains("active")) {
    content.classList.remove("active");
    if (toggle) toggle.textContent = "";
  } else {
    content.classList.add("active");
    if (toggle) toggle.textContent = "";
  }
};

// ============================================================
// 初期化処理
// ============================================================

/**
 * 色分けモードを初期化する
 * ページ読み込み時にチェックボックスの状態を反映
 */
function initializeColorMode() {
  var container = document.querySelector(".map-tab-container");
  if (container) {
    var colorEnabledCheckbox = document.getElementById("color-enabled");
    if (colorEnabledCheckbox) {
      colorEnabled = colorEnabledCheckbox.checked;
      if (colorEnabled) {
        window.updateMapColors();
      }
    }
  }
}

/**
 * ページロード時の統合初期化
 * セルサイズ、フォントサイズ、グリッド、表示設定、色分けを順に初期化
 */
function initializeMapDisplay() {
  if (window.mapIsInitialized) return;
  window.mapIsInitialized = true;

  setTimeout(function () {
    // セルサイズの初期化
    updateCellSize();

    // フォントサイズの初期化（8pxに設定）
    updateFontSize(8);

    // グリッド線の初期化
    var gridCheckbox = document.getElementById("show-grid");
    if (gridCheckbox && gridCheckbox.checked) {
      var tables = document.querySelectorAll(".map-table, #map-table");
      tables.forEach(function (table) {
        table.classList.remove("no-grid");
      });
    }

    // 表示設定のチェックボックスにイベントリスナーを追加
    setupDisplayCheckboxes();

    // 表示項目の初期化
    updateMapDisplay();

    // 色分けモードの初期化（最後に実行）
    initializeColorMode();
  }, 100);
}

/**
 * 表示設定のチェックボックスにイベントリスナーを追加する
 * チェックボックスの変更時にupdateMapDisplayを呼び出す
 */
function setupDisplayCheckboxes() {
  var checkboxIds = [
    "show-machine-name",
    "show-machine-number",
    "show-diff",
    "show-map-games",
    "show-bb",
  ];

  checkboxIds.forEach(function (id) {
    var checkbox = document.getElementById(id);
    if (checkbox) {
      // 既存リスナーを削除（重複防止）
      checkbox.removeEventListener("change", updateMapDisplay);
      // 新しいリスナーを追加
      checkbox.addEventListener("change", function () {
        updateMapDisplay();
      });
    }
  });
}

// ------------------------------------------------------------
// Turboイベントリスナー
// Turboフレームワーク使用時、turbo:loadのみを使用
// （DOMContentLoadedとturbo:loadが両方発火するため）
// ------------------------------------------------------------

document.addEventListener("turbo:load", function () {
  window.mapIsInitialized = false;
  initializeMapDisplay();
  initializeMapZoom();
});

document.addEventListener("turbo:frame-load", function () {
  window.mapIsInitialized = false;
  initializeMapDisplay();
  initializeMapZoom();
});

// ============================================================
// マップズーム機能
// PC: Ctrl + マウスホイール
// Safari(iOS): gestureイベント
// Android/Chrome: タッチ操作（ピンチインピンチアウト）
// ============================================================

/**
 * ズームを適用する（スクロールを維持するように改善）
 * CSS transformでスケーリングし、コンテナのサイズを調整する
 * @param {Element} element - ズーム対象の要素（map-table）
 * @param {number} scale - ズーム倍率
 */
function applyZoom(element, scale) {
  window.currentMapZoomScale = scale;
  element.style.transform = "scale(" + scale + ")";
  element.style.transformOrigin = "top left";

  var mapContainer = document.querySelector(".map-grid-container");
  if (!mapContainer) return;

  var rect = element.getBoundingClientRect();
  var actualWidth = rect.width / scale;
  var actualHeight = rect.height / scale;

  var scaledHeight = actualHeight * scale;

  mapContainer.style.minHeight = scaledHeight + "px";
  mapContainer.style.overflowY = "auto";
  mapContainer.style.minWidth = "100%";
  mapContainer.style.overflowX = "auto";

  if (scale > 1) {
    element.style.width = actualWidth + "px";
  } else {
    element.style.width = "auto";
  }
}

/**
 * applyZoomのヘルパー関数（スケールを保持して使用）
 */
function applyZoomWithCurrentScale(element, scale) {
  applyZoom(element, scale);
}

/**
 * マップズーム機能を初期化する
 * PCSafariAndroidそれぞれに対応したイベントリスナーを登録
 */
function initializeMapZoom() {
  var mapContainer = document.querySelector(".map-grid-container");
  var mapTable = document.querySelector(".map-table");

  if (!mapContainer || !mapTable) return;

  var scale = 1;
  var minScale = 0.5;
  var maxScale = 3;
  var scaleStep = 0.1;

  // タッチ関連の変数
  var initialDistance = 0;
  var initialScale = 1;
  var isZooming = false;

  // --- PC用: Ctrl + ホイールでズーム ---
  mapContainer.addEventListener(
    "wheel",
    function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();

        var delta = -e.deltaY;
        var scaleChange = delta > 0 ? scaleStep : -scaleStep;
        scale = Math.min(Math.max(scale + scaleChange, minScale), maxScale);

        window.currentMapZoomScale = scale;
        applyZoom(mapTable, scale);
      }
      // Ctrl/Cmd が押されていない場合は通常のスクロールを許可（何もしない）
    },
    { passive: false },
  );

  // --- Safari用: gestureイベント（iOS Safari専用） ---
  var lastGestureScale = 1;

  mapContainer.addEventListener(
    "gesturestart",
    function (e) {
      e.preventDefault();
      lastGestureScale = 1;
      isZooming = true;
    },
    { passive: false },
  );

  mapContainer.addEventListener(
    "gesturechange",
    function (e) {
      e.preventDefault();
      scale = Math.min(
        Math.max(scale * (e.scale / lastGestureScale), minScale),
        maxScale,
      );
      lastGestureScale = e.scale;
      window.currentMapZoomScale = scale;
      applyZoom(mapTable, scale);
    },
    { passive: false },
  );

  mapContainer.addEventListener(
    "gestureend",
    function (e) {
      e.preventDefault();
      isZooming = false;
      lastGestureScale = 1;
    },
    { passive: false },
  );

  // --- スマホ用: ピンチインピンチアウト（Android Chrome用） ---
  mapContainer.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length === 2) {
        // 2本指の場合のみpreventDefault（ズーム操作）
        e.preventDefault();
        isZooming = true;
        initialDistance = getDistance(e.touches[0], e.touches[1]);
        initialScale = scale;
      }
      // 1本指の場合は何もしない（スクロール可能）
    },
    { passive: false },
  );

  mapContainer.addEventListener(
    "touchmove",
    function (e) {
      if (e.touches.length === 2 && isZooming) {
        // 2本指の場合のみpreventDefault（ズーム処理）
        e.preventDefault();

        var currentDistance = getDistance(e.touches[0], e.touches[1]);
        var scaleChange = currentDistance / initialDistance;
        scale = Math.min(
          Math.max(initialScale * scaleChange, minScale),
          maxScale,
        );

        window.currentMapZoomScale = scale;
        applyZoom(mapTable, scale);
      }
      // 1本指の場合は何もしない（スクロール可能）
    },
    { passive: false },
  );

  mapContainer.addEventListener(
    "touchend",
    function (e) {
      if (e.touches.length < 2) {
        initialDistance = 0;
        isZooming = false;
      }
    },
    { passive: false },
  );

  /**
   * 2点間の距離を計算する（ピンチ操作用）
   */
  function getDistance(touch1, touch2) {
    var dx = touch2.clientX - touch1.clientX;
    var dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // applyZoom はグローバルスコープで定義済み
}
