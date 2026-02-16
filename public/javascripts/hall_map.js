// グローバル変数
var colorEnabled = true;

// 色分けモードの切り替え（グローバルスコープで確実に定義）
window.toggleColorMode = function () {
  const checkbox = document.getElementById("color-enabled");
  if (checkbox) {
    colorEnabled = checkbox.checked;

    // 設定コンテンツの表示/非表示
    const content = document.getElementById("color-settings-content");
    if (content) {
      content.style.display = colorEnabled ? "block" : "none";
    }

    // 色を更新
    updateMapColors();
  }
};

// マップの色を更新（グローバルスコープで定義）
window.updateMapColors = function () {
  if (!colorEnabled) {
    // 色分け無効時は全てクリア
    clearAllColors();
    return;
  }

  const conditionElement = document.getElementById("color-condition");
  if (!conditionElement) {
    return;
  }

  const condition = conditionElement.value;

  // 機種ごとのワーストランキング色分け
  if (condition === "worst_7days") {
    applyWorstRankColors();
    return;
  }
};

// マップ切り替え（グローバルスコープで定義）
window.changeMap = function (mapId) {
  location.reload();
};

// パネルの開閉（グローバルスコープで定義）
window.togglePanel = function (panelId) {
  const content = document.getElementById(panelId);
  if (!content) {
    return;
  }

  // .collapsible-toggleを探す（直前の兄弟要素から）
  const prevSibling = content.previousElementSibling;
  const toggle = prevSibling?.querySelector(".collapsible-toggle");

  // activeクラスをトグル
  if (content.classList.contains("active")) {
    content.classList.remove("active");
    if (toggle) toggle.textContent = "▼";
  } else {
    content.classList.add("active");
    if (toggle) toggle.textContent = "▲";
  }
};

// ページ読み込み時の自動初期化
function initializeColorMode() {
  const container = document.querySelector(".map-tab-container");
  if (container) {
    // 色分けモードのチェックボックスを確認
    const colorEnabledCheckbox = document.getElementById("color-enabled");
    if (colorEnabledCheckbox) {
      colorEnabled = colorEnabledCheckbox.checked;

      // 色分けを適用
      if (colorEnabled) {
        window.updateMapColors();
      }
    }
  }
}

// DOMContentLoadedイベント（初回読み込み時）
// 以下は削除：重複していたため

// 機種ごとのワーストランキング色分けを適用
function applyWorstRankColors() {
  const cells = document.querySelectorAll('.map-cell[data-type="machine"]');

  cells.forEach((cell) => {
    // 既存の色クラスを削除
    cell.classList.remove("color-red", "color-green", "color-yellow");

    const worstRank = cell.dataset.worstRank;

    // data-worst-rank が "1" または "2" の場合のみ色を適用
    if (worstRank === "1") {
      // ワースト1は赤
      cell.classList.add("color-red");
    } else if (worstRank === "2") {
      // ワースト2は緑
      cell.classList.add("color-green");
    }
  });
}

// 全ての色をクリア
function clearAllColors() {
  const cells = document.querySelectorAll(".map-cell");
  cells.forEach((cell) => {
    cell.classList.remove("color-red", "color-green", "color-yellow");
  });
}

// ============================================================
// 表示設定機能
// ============================================================

// マップの表示内容を更新
window.updateMapDisplay = function () {
  const nameCheckbox = document.getElementById("show-machine-name");
  const numberCheckbox = document.getElementById("show-machine-number");
  const diffCheckbox = document.getElementById("show-diff");
  const gamesCheckbox = document.getElementById("show-map-games");
  const bbCheckbox = document.getElementById("show-bb");

  const showMachineName = nameCheckbox?.checked ?? true;
  const showMachineNumber = numberCheckbox?.checked ?? true;
  const showDiff = diffCheckbox?.checked ?? false;
  const showGames = gamesCheckbox?.checked ?? false;
  const showBb = bbCheckbox?.checked ?? false;

  const cells = document.querySelectorAll('.map-cell[data-type="machine"]');

  cells.forEach((cell) => {
    const machineInfo = cell.querySelector(".machine-info");
    if (!machineInfo) return;

    // 各要素の表示/非表示を切り替え
    const nameElement = machineInfo.querySelector(".machine-name");
    const numberElement = machineInfo.querySelector(".machine-number");
    let statsElement = machineInfo.querySelector(".machine-stats");

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

    // 差枚、回転数、BBの表示を再構築
    const difference = cell.dataset.difference || "0";
    const games = cell.dataset.games || "0";

    let statsHtml = "";

    if (showDiff) {
      const diffNum = parseInt(difference);
      const diffClass =
        diffNum > 0 ? "positive" : diffNum < 0 ? "negative" : "";
      statsHtml += `<div class="stat-diff ${diffClass}">${diffNum > 0 ? "+" : ""}${difference}</div>`;
    }

    if (showGames) {
      statsHtml += `<div class="stat-games">${games}G</div>`;
    }

    if (showBb) {
      // BB情報は追加のデータが必要（現状は非表示）
      statsHtml += `<div class="stat-bb">BB: -</div>`;
    }

    statsElement.innerHTML = statsHtml;
    statsElement.style.display =
      showDiff || showGames || showBb ? "flex" : "none";
  });
};

// セルサイズを更新（横幅・縦幅別々に指定）
window.updateCellSize = function () {
  const cells = document.querySelectorAll(".map-cell");
  const tables = document.querySelectorAll(".map-table, #map-table");
  const widthSlider = document.getElementById("cell-width-slider");
  const heightSlider = document.getElementById("cell-height-slider");
  const widthDisplay = document.getElementById("cell-width-display");
  const heightDisplay = document.getElementById("cell-height-display");

  const width = widthSlider ? widthSlider.value : 80;
  const height = heightSlider ? heightSlider.value : 64;

  // テーブルにtable-layout: fixedを設定して、セル幅を固定
  // さらにテーブル全体の幅も明示的に制御
  tables.forEach((table) => {
    table.style.setProperty("table-layout", "fixed", "important");
    table.style.setProperty("width", "auto", "important");
    table.style.setProperty("max-width", "none", "important");
    table.style.setProperty("display", "table", "important");
  });

  cells.forEach((cell) => {
    cell.style.setProperty("width", `${width}px`, "important");
    cell.style.setProperty("min-width", `${width}px`, "important");
    cell.style.setProperty("max-width", `${width}px`, "important");
    cell.style.setProperty("height", `${height}px`, "important");
    cell.style.setProperty("box-sizing", "border-box", "important");
  });

  if (widthDisplay) {
    widthDisplay.textContent = `${width}px`;
  }
  if (heightDisplay) {
    heightDisplay.textContent = `${height}px`;
  }
};

// フォントサイズを更新
window.updateFontSize = function (size) {
  const display = document.getElementById("font-size-display");
  const slider = document.getElementById("font-size-slider");
  const sizeNum = parseFloat(size);

  // スライダーの値を更新
  if (slider) {
    slider.value = sizeNum;
  }

  // machine-info内の全要素にフォントサイズを適用
  const machineInfos = document.querySelectorAll(".machine-info");

  machineInfos.forEach((info) => {
    const nameElement = info.querySelector(".machine-name");
    const numberElement = info.querySelector(".machine-number");
    const statsElement = info.querySelector(".machine-stats");

    if (nameElement) {
      nameElement.style.fontSize = `${sizeNum}px`;
    }
    if (numberElement) {
      // 台番号は基準より20%大きく
      numberElement.style.fontSize = `${sizeNum * 1.2}px`;
    }
    if (statsElement) {
      // 差枚・回転数は機種名・台番号の0.7倍
      const statSize = sizeNum * 0.7;
      statsElement.style.fontSize = `${statSize}px`;
      // 個別要素にも適用
      const statItems = statsElement.querySelectorAll(
        ".stat-diff, .stat-games, .stat-bb",
      );
      statItems.forEach((item) => {
        item.style.fontSize = `${statSize}px`;
      });
    }
  });

  if (display) {
    display.textContent = `${sizeNum}px`;
  }
};

// グリッド線の表示切り替え
window.toggleGrid = function () {
  const checkbox = document.getElementById("show-grid");
  if (!checkbox) return;

  const showGrid = checkbox.checked;
  const tables = document.querySelectorAll(".map-table, #map-table");

  tables.forEach((table) => {
    if (showGrid) {
      table.classList.remove("no-grid");
    } else {
      table.classList.add("no-grid");
    }
  });
};

// パネルの開閉
function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  const header = panel.previousElementSibling;
  const toggle = header.querySelector(".collapsible-toggle");

  if (panel.style.display === "none" || !panel.style.display) {
    panel.style.display = "block";
    toggle.textContent = "▲";
  } else {
    panel.style.display = "none";
    toggle.textContent = "▼";
  }
}

// ============================================================
// 初期化
// ============================================================

// 初期化済みフラグ（スクリプトの重複読み込み対策）
if (typeof window.mapIsInitialized === "undefined") {
  window.mapIsInitialized = false;
}

// ページロード時の統合初期化
function initializeMapDisplay() {
  if (window.mapIsInitialized) {
    return;
  }

  window.mapIsInitialized = true;

  setTimeout(() => {
    // セルサイズの初期化
    updateCellSize();

    // フォントサイズの初期化（18pxに設定）
    updateFontSize(18);

    // グリッド線の初期化
    const gridCheckbox = document.getElementById("show-grid");
    if (gridCheckbox && gridCheckbox.checked) {
      const tables = document.querySelectorAll(".map-table, #map-table");
      tables.forEach((table) => {
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

// 表示設定のチェックボックスにイベントリスナーを追加
function setupDisplayCheckboxes() {
  const checkboxIds = [
    "show-machine-name",
    "show-machine-number",
    "show-diff",
    "show-map-games",
    "show-bb",
  ];

  checkboxIds.forEach((id) => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      // 既存のリスナーを削除（重複防止）
      checkbox.removeEventListener("change", updateMapDisplay);
      // 新しいリスナーを追加
      checkbox.addEventListener("change", function (e) {
        console.log(
          `✓ ${id} がクリックされました - checked:`,
          e.target.checked,
        );
        updateMapDisplay();
      });

      // テスト用：要素の状態を確認
      const styles = window.getComputedStyle(checkbox);
      console.log(`${id} にイベントリスナーを追加`, {
        disabled: checkbox.disabled,
        display: styles.display,
        pointerEvents: styles.pointerEvents,
        visibility: styles.visibility,
      });
    } else {
      console.log(`${id} が見つかりません`);
    }
  });
}

// Turboフレームワークを使用しているため、turbo:loadのみを使用
// DOMContentLoadedとturbo:loadが両方発火するため、turbo:loadのみを使用
document.addEventListener("turbo:load", function () {
  window.mapIsInitialized = false;
  initializeMapDisplay();
});

document.addEventListener("turbo:frame-load", function () {
  window.mapIsInitialized = false;
  initializeMapDisplay();
});
