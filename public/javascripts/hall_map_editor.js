// グローバル変数（存在しない場合のみ宣言）
if (typeof editorLayoutData === "undefined") {
  var editorLayoutData = {};
}
if (typeof selectedCell === "undefined") {
  var selectedCell = null;
}
if (typeof currentTool === "undefined") {
  var currentTool = "machine";
}
if (typeof zoomLevel === "undefined") {
  var zoomLevel = 1.0;
}
if (typeof mapRows === "undefined") {
  var mapRows = 20;
}
if (typeof mapCols === "undefined") {
  var mapCols = 40;
}

// ページ読み込み時の自動初期化
document.addEventListener("DOMContentLoaded", function () {
  const container = document.querySelector(".map-editor-container");
  const dataElement = document.getElementById("editor-initial-data");

  if (container && dataElement) {
    // data属性からIDと行列サイズを取得
    const hallId = parseInt(dataElement.dataset.hallId);
    const mapId = parseInt(dataElement.dataset.mapId);
    const rows = parseInt(dataElement.dataset.rows) || 20;
    const cols = parseInt(dataElement.dataset.cols) || 40;

    // hiddenフィールドのテキストコンテンツからJSONをパース
    let layoutData = {};
    try {
      const jsonText = dataElement.textContent.trim();
      if (jsonText) {
        layoutData = JSON.parse(jsonText);
      }
    } catch (e) {
      console.error("Failed to parse layout data:", e);
      layoutData = {};
    }

    initializeEditor(hallId, mapId, layoutData, rows, cols);
  }
});

// エディター初期化
function initializeEditor(hallId, mapId, layoutData, rows, cols) {
  editorLayoutData = layoutData || {};
  window.hallId = hallId;
  window.mapId = mapId;
  mapRows = rows;
  mapCols = cols;
  selectTool("machine");
}

// ツール選択
function selectTool(tool) {
  currentTool = tool;

  document.querySelectorAll(".tool-btn").forEach((btn) => {
    btn.classList.remove("active");
    if (btn.dataset.tool === tool) {
      btn.classList.add("active");
    }
  });

  const machinePanel = document.getElementById("machine-input-panel");
  const labelPanel = document.getElementById("label-input-panel");

  if (tool === "machine") {
    machinePanel.style.display = "block";
    labelPanel.style.display = "none";
  } else if (tool === "wall" || tool === "counter") {
    machinePanel.style.display = "none";
    labelPanel.style.display = "block";
  } else {
    machinePanel.style.display = "none";
    labelPanel.style.display = "none";
  }
}

// セル選択
function selectCell(row, col) {
  const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);

  if (selectedCell) {
    selectedCell.classList.remove("selected");
  }

  selectedCell = cell;
  cell.classList.add("selected");
  updateSelectionDisplay(row, col);

  // 台配置ツールが選択されている場合、自動で台番号を設定
  if (currentTool === "machine") {
    const machineNumberInput = document.getElementById("machine-number-input");
    const machineNumber = machineNumberInput.value;

    if (machineNumber) {
      // 台番号を設定
      updateCellData(row, col, {
        type: "machine",
        machine_number: parseInt(machineNumber),
      });

      cell.dataset.type = "machine";
      cell.dataset.machineNumber = machineNumber;
      cell.className = "editor-cell machine";
      cell.innerHTML = `<div class="cell-content"><span class="cell-number">${machineNumber}</span></div>`;

      // 自動増減の設定を取得
      const autoIncrement = getAutoIncrementValue();
      if (autoIncrement !== 0) {
        const newValue = parseInt(machineNumber) + autoIncrement;
        machineNumberInput.value = newValue;
      }
      // 台番号を設定した場合は、ここで処理を終了（既存値の読み込みをスキップ）
      return;
    }
  } else if (currentTool === "wall") {
    // 壁ツールの場合、即座に壁を配置
    updateCellData(row, col, {
      type: "wall",
      label: "■",
    });
    cell.dataset.type = "wall";
    cell.className = "editor-cell wall";
    cell.innerHTML = `<div class="cell-content wall">■</div>`;
  } else if (currentTool === "counter") {
    // カウンターツールの場合、即座にカウンターを配置
    updateCellData(row, col, {
      type: "counter",
      label: "カウンター",
    });
    cell.dataset.type = "counter";
    cell.className = "editor-cell counter";
    cell.innerHTML = `<div class="cell-content counter">カウンター</div>`;
  } else if (currentTool === "empty") {
    // 空白ツールの場合、セルをクリア
    updateCellData(row, col, {
      type: "empty",
    });
    cell.dataset.type = "empty";
    cell.dataset.machineNumber = "";
    cell.className = "editor-cell empty";
    cell.innerHTML = "";
  } else if (currentTool === "eraser") {
    // 消しゴムツールの場合、セルをクリア
    updateCellData(row, col, {
      type: "empty",
    });
    cell.dataset.type = "empty";
    cell.dataset.machineNumber = "";
    cell.className = "editor-cell empty";
    cell.innerHTML = "";
  }

  // 既存のセルの台番号を表示
  if (cell.dataset.type === "machine" && cell.dataset.machineNumber) {
    document.getElementById("machine-number-input").value =
      cell.dataset.machineNumber;
  }

  if (
    (cell.dataset.type === "wall" || cell.dataset.type === "counter") &&
    cell.dataset.label
  ) {
    document.getElementById("label-input").value = cell.dataset.label;
  }
}

// 選択情報の表示更新
function updateSelectionDisplay(row, col) {
  const cell = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
  const display = document.getElementById("selection-display");

  let info = `行: ${row}, 列: ${col}<br>`;
  info += `タイプ: ${getTypeLabel(cell.dataset.type)}<br>`;

  if (cell.dataset.machineNumber) {
    info += `台番号: ${cell.dataset.machineNumber}`;
  }

  display.innerHTML = info;
}

function getTypeLabel(type) {
  const labels = {
    machine: "🎰 台",
    wall: "🧱 壁",
    counter: "🏪 カウンター",
    empty: "⬜ 空白",
  };
  return labels[type] || type;
}

// 自動増減の値を取得
function getAutoIncrementValue() {
  const selected = document.querySelector(
    'input[name="auto-increment"]:checked',
  );
  return selected ? parseInt(selected.value) : 0;
}

// 台番号を適用
function applyMachineNumber() {
  if (!selectedCell) {
    alert("セルを選択してください");
    return;
  }

  const machineNumber = document.getElementById("machine-number-input").value;

  if (!machineNumber) {
    alert("台番号を入力してください");
    return;
  }

  const row = selectedCell.dataset.row;
  const col = selectedCell.dataset.col;

  updateCellData(row, col, {
    type: "machine",
    machine_number: parseInt(machineNumber),
  });

  selectedCell.dataset.type = "machine";
  selectedCell.dataset.machineNumber = machineNumber;
  selectedCell.className = "editor-cell machine";
  selectedCell.innerHTML = `<div class="cell-content"><span class="cell-number">台${machineNumber}</span></div>`;

  document.getElementById("machine-number-input").value =
    parseInt(machineNumber) + 1;
}

// セルデータを更新
function updateCellData(row, col, data) {
  const key = `${row}_${col}`;
  editorLayoutData[key] = data;
}

// マップデータを保存（通常のフォーム送信）
function saveMapData() {
  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "保存中...";

  // データの検証
  if (!editorLayoutData || Object.keys(editorLayoutData).length === 0) {
    alert(
      "保存するデータがありません。マップが正しく読み込まれていない可能性があります。",
    );
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 保存";
    return;
  }

  // hidden fieldにデータを設定
  document.getElementById("layout-data-field").value =
    JSON.stringify(editorLayoutData);

  // 行・列のサイズも更新
  document.getElementById("rows-field").value = mapRows;
  document.getElementById("cols-field").value = mapCols;

  // フォーム送信
  document.getElementById("map-save-form").submit();
}

// ズーム機能
function zoomIn() {
  zoomLevel = Math.min(zoomLevel + 0.1, 2.0);
  applyZoom();
}

function zoomOut() {
  zoomLevel = Math.max(zoomLevel - 0.1, 0.5);
  applyZoom();
}

function resetZoom() {
  zoomLevel = 1.0;
  applyZoom();
}

function applyZoom() {
  const table = document.getElementById("editor-map-table");
  table.style.transform = `scale(${zoomLevel})`;
  table.style.transformOrigin = "top left";
}

// ============================================================
// 行・列の追加・削除機能（選択中のセル基準）
// ============================================================

// 選択中のセルの行/列を取得
function getSelectedRowCol() {
  if (!selectedCell) {
    alert("セルを選択してから操作してください");
    return null;
  }
  const row = parseInt(selectedCell.dataset.row);
  const col = parseInt(selectedCell.dataset.col);
  return { row, col };
}

// 選択中のセルの上/下に行を追加
function addRowAtSelection(position) {
  const selected = getSelectedRowCol();
  if (!selected) return;

  const targetRow = selected.row;
  const newLayoutData = {};

  if (position === "above") {
    // 選択中の行の上に挿入: targetRow以降の行を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (row >= targetRow) {
        // ディープコピー
        newLayoutData[`${row + 1}_${col}`] = JSON.parse(
          JSON.stringify(editorLayoutData[key]),
        );
      } else {
        // ディープコピー
        newLayoutData[key] = JSON.parse(JSON.stringify(editorLayoutData[key]));
      }
    });

    // targetRow行を空で初期化
    for (let col = 1; col <= mapCols; col++) {
      newLayoutData[`${targetRow}_${col}`] = { type: "empty" };
    }
  } else {
    // 選択中の行の下に挿入: targetRow+1以降の行を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (row > targetRow) {
        // ディープコピー
        newLayoutData[`${row + 1}_${col}`] = JSON.parse(
          JSON.stringify(editorLayoutData[key]),
        );
      } else {
        // ディープコピー
        newLayoutData[key] = JSON.parse(JSON.stringify(editorLayoutData[key]));
      }
    });

    // targetRow+1行を空で初期化
    for (let col = 1; col <= mapCols; col++) {
      newLayoutData[`${targetRow + 1}_${col}`] = { type: "empty" };
    }
  }

  editorLayoutData = newLayoutData;
  mapRows++;
  updateMapInfo();
  reloadMapTable();
}

// 選択中のセルの行を削除
function removeRowAtSelection(position) {
  if (mapRows <= 1) {
    alert("行は最低1行必要です");
    return;
  }

  const selected = getSelectedRowCol();
  if (!selected) return;

  if (!confirm("この操作は取り消せません。削除しますか？")) {
    return;
  }

  const targetRow = position === "current" ? selected.row : selected.row + 1;

  if (targetRow > mapRows) {
    alert("削除する行が存在しません");
    return;
  }

  const newLayoutData = {};

  // targetRow行を削除し、それ以降の行を-1シフト
  Object.keys(editorLayoutData).forEach((key) => {
    const [row, col] = key.split("_").map(Number);

    if (row < targetRow) {
      // targetRow より前の行はそのまま（ディープコピー）
      newLayoutData[key] = JSON.parse(JSON.stringify(editorLayoutData[key]));
    } else if (row > targetRow) {
      // targetRow より後の行は-1シフト（ディープコピー）
      newLayoutData[`${row - 1}_${col}`] = JSON.parse(
        JSON.stringify(editorLayoutData[key]),
      );
    }
    // row === targetRow は削除（コピーしない）
  });

  editorLayoutData = newLayoutData;
  mapRows--;
  updateMapInfo();
  reloadMapTable();
}

// 選択中のセルの左/右に列を追加
function addColumnAtSelection(position) {
  const selected = getSelectedRowCol();
  if (!selected) return;

  const targetCol = selected.col;
  const newLayoutData = {};

  if (position === "left") {
    // 選択中の列の左に挿入: targetCol以降の列を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (col >= targetCol) {
        // ディープコピー
        newLayoutData[`${row}_${col + 1}`] = JSON.parse(
          JSON.stringify(editorLayoutData[key]),
        );
      } else {
        // ディープコピー
        newLayoutData[key] = JSON.parse(JSON.stringify(editorLayoutData[key]));
      }
    });

    // targetCol列を空で初期化
    for (let row = 1; row <= mapRows; row++) {
      newLayoutData[`${row}_${targetCol}`] = { type: "empty" };
    }
  } else {
    // 選択中の列の右に挿入: targetCol+1以降の列を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (col > targetCol) {
        // ディープコピー
        newLayoutData[`${row}_${col + 1}`] = JSON.parse(
          JSON.stringify(editorLayoutData[key]),
        );
      } else {
        // ディープコピー
        newLayoutData[key] = JSON.parse(JSON.stringify(editorLayoutData[key]));
      }
    });

    // targetCol+1列を空で初期化
    for (let row = 1; row <= mapRows; row++) {
      newLayoutData[`${row}_${targetCol + 1}`] = { type: "empty" };
    }
  }

  editorLayoutData = newLayoutData;
  mapCols++;
  updateMapInfo();
  reloadMapTable();
}

// 選択中のセルの列を削除
function removeColumnAtSelection(position) {
  if (mapCols <= 1) {
    alert("列は最低1列必要です");
    return;
  }

  const selected = getSelectedRowCol();
  if (!selected) return;

  if (!confirm("この操作は取り消せません。削除しますか？")) {
    return;
  }

  const targetCol = position === "current" ? selected.col : selected.col + 1;

  if (targetCol > mapCols) {
    alert("削除する列が存在しません");
    return;
  }

  const newLayoutData = {};

  // targetCol列を削除し、それ以降の列を-1シフト
  Object.keys(editorLayoutData).forEach((key) => {
    const [row, col] = key.split("_").map(Number);

    if (col < targetCol) {
      // targetCol より前の列はそのまま（ディープコピー）
      newLayoutData[key] = JSON.parse(JSON.stringify(editorLayoutData[key]));
    } else if (col > targetCol) {
      // targetCol より後の列は-1シフト（ディープコピー）
      newLayoutData[`${row}_${col - 1}`] = JSON.parse(
        JSON.stringify(editorLayoutData[key]),
      );
    }
    // col === targetCol は削除（コピーしない）
  });

  editorLayoutData = newLayoutData;
  mapCols--;
  updateMapInfo();
  reloadMapTable();
}

// マップ情報の更新
function updateMapInfo() {
  const infoElement = document.querySelector(".map-info");
  if (infoElement) {
    infoElement.textContent = `📐 ${mapRows}行 × ${mapCols}列`;
  }

  // hidden fieldも更新
  document.getElementById("rows-field").value = mapRows;
  document.getElementById("cols-field").value = mapCols;
}

// マップテーブルを再描画
function reloadMapTable() {
  const table = document.getElementById("editor-map-table");
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  for (let row = 1; row <= mapRows; row++) {
    const tr = document.createElement("tr");

    for (let col = 1; col <= mapCols; col++) {
      const key = `${row}_${col}`;
      const cellData = editorLayoutData[key] || { type: "empty" };

      const td = document.createElement("td");
      td.className = `editor-cell ${cellData.type || "empty"}`;
      td.dataset.row = row;
      td.dataset.col = col;
      td.dataset.type = cellData.type || "empty";
      td.onclick = function () {
        selectCell(row, col);
      };

      // セルの内容を描画
      if (cellData.type === "machine" && cellData.machine_number) {
        td.dataset.machineNumber = cellData.machine_number;
        const content = document.createElement("div");
        content.className = "cell-content";
        const span = document.createElement("span");
        span.className = "cell-number";
        span.textContent = cellData.machine_number;
        content.appendChild(span);
        td.appendChild(content);
      } else if (cellData.type === "wall") {
        td.dataset.label = cellData.label || "";
        const content = document.createElement("div");
        content.className = "cell-content wall";
        content.textContent = cellData.label || "■";
        td.appendChild(content);
      } else if (cellData.type === "counter") {
        td.dataset.label = cellData.label || "";
        const content = document.createElement("div");
        content.className = "cell-content counter";
        content.textContent = cellData.label || "カウンター";
        td.appendChild(content);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  // ズームを再適用
  applyZoom();
}
