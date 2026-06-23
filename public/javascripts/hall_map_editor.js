// ============================================================
// マップエディタのJavaScript
// セル選択・配置・行列操作・ズーム・保存を担当
// ============================================================

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
      layoutData = {};
    }

    // HTMLテーブルからセルデータを読み取り（既存データがない場合に備えて）
    const cellElements = document.querySelectorAll(".editor-cell");
    cellElements.forEach((cell) => {
      const row = parseInt(cell.dataset.row);
      const col = parseInt(cell.dataset.col);
      const cellType = cell.dataset.type;
      const machineNumber = cell.dataset.machineNumber;
      const label = cell.dataset.label;

      const key = `${row}_${col}`;

      // 既存のJSONデータが空、またはこのセルがJSONに存在しない場合HTMLから構築
      if (!layoutData[key] && cellType !== "empty") {
        layoutData[key] = {
          row: row,
          col: col,
          type: cellType,
        };

        if (
          machineNumber &&
          machineNumber !== "undefined" &&
          machineNumber !== ""
        ) {
          layoutData[key].machine_number = parseInt(machineNumber);
        }

        if (label && label !== "undefined" && label !== "") {
          layoutData[key].label = label;
        }
      }
    });

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
  selectTool("select");
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
  const rowColPanel = document.getElementById("row-col-edit-panel");

  if (machinePanel) {
    if (tool === "machine") {
      machinePanel.style.display = "inline-flex";
    } else {
      machinePanel.style.display = "none";
    }
  }

  // 行列編集パネルは「選択」ツールの時のみ表示
  if (rowColPanel) {
    if (tool === "select") {
      rowColPanel.style.display = "inline-flex";
    } else {
      rowColPanel.style.display = "none";
    }
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

  // 「選択」ツールの場合は、セルを選択状態にするだけで何もしない
  if (currentTool === "select") {
    return;
  }

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

      // 自動増分の設定を取得
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
      label: "█",
    });
    cell.dataset.type = "wall";
    cell.className = "editor-cell wall";
    cell.innerHTML = `<div class="cell-content wall">█</div>`;
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

  if (!display) return;

  let info = `行: ${row}, 列: ${col} / ${getTypeLabel(cell.dataset.type)}`;

  if (cell.dataset.machineNumber) {
    info += ` / 台番号: ${cell.dataset.machineNumber}`;
  }

  display.textContent = info;
}

// セルタイプの表示ラベルを取得
function getTypeLabel(type) {
  const labels = {
    machine: "🎰 台",
    wall: "🧱 壁",
    counter: "🏪 カウンター",
    empty: "⬜ 空白",
  };
  return labels[type] || type;
}

// 自動増分の値を取得
function getAutoIncrementValue() {
  const selected = document.querySelector(
    'input[name="auto-increment"]:checked',
  );
  return selected ? parseInt(selected.value) : 0;
}

// 台番号を適用（ボタンクリック用）
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
  selectedCell.innerHTML = `<div class="cell-content"><span class="cell-number">${machineNumber}</span></div>`;

  document.getElementById("machine-number-input").value =
    parseInt(machineNumber) + 1;
}

// セルデータを更新（メモリ内のeditorLayoutDataを変更）
function updateCellData(row, col, data) {
  const key = `${row}_${col}`;
  editorLayoutData[key] = data;
}

// マップデータを保存（通常のフォーム送信）
function saveMapData() {
  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "保存中...";

  // データの検証：editorLayoutDataが空の場合HTMLから再構築を試みる
  if (!editorLayoutData || Object.keys(editorLayoutData).length === 0) {
    // HTMLテーブルから全セルデータを読み取り
    const cellElements = document.querySelectorAll(".editor-cell");
    const rebuiltData = {};

    cellElements.forEach((cell) => {
      const row = parseInt(cell.dataset.row);
      const col = parseInt(cell.dataset.col);
      const cellType = cell.dataset.type;
      const machineNumber = cell.dataset.machineNumber;
      const label = cell.dataset.label;

      if (cellType && cellType !== "empty") {
        const key = `${row}_${col}`;
        rebuiltData[key] = {
          row: row,
          col: col,
          type: cellType,
        };

        if (
          machineNumber &&
          machineNumber !== "undefined" &&
          machineNumber !== ""
        ) {
          rebuiltData[key].machine_number = parseInt(machineNumber);
        }

        if (label && label !== "undefined" && label !== "") {
          rebuiltData[key].label = label;
        }
      }
    });

    if (Object.keys(rebuiltData).length > 0) {
      editorLayoutData = rebuiltData;
    } else {
      alert(
        "保存するデータがありません。データが正しく読み込まれていない可能性があります。",
      );
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 保存";
      return;
    }
  }

  // hidden fieldにデータを設定
  document.getElementById("layout-data-field").value =
    JSON.stringify(editorLayoutData);

  // 行と列のサイズも更新
  document.getElementById("rows-field").value = mapRows;
  document.getElementById("cols-field").value = mapCols;

  // フォーム送信
  document.getElementById("map-save-form").submit();
}

// ============================================================
// ズーム機能
// ============================================================

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

// 現在のHTMLテーブルの状態をeditorLayoutDataに同期
function syncLayoutDataFromDOM() {
  const cells = document.querySelectorAll(".editor-cell");
  let syncCount = 0;

  cells.forEach((cell) => {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const cellType = cell.dataset.type || "empty";
    const key = `${row}_${col}`;

    if (cellType !== "empty") {
      editorLayoutData[key] = {
        row: row,
        col: col,
        type: cellType,
      };

      if (cellType === "machine" && cell.dataset.machineNumber) {
        editorLayoutData[key].machine_number = parseInt(
          cell.dataset.machineNumber,
        );
      }

      if (
        (cellType === "wall" || cellType === "counter") &&
        cell.dataset.label
      ) {
        editorLayoutData[key].label = cell.dataset.label;
      }

      syncCount++;
    } else {
      // emptyセルは削除（メモリ節約）
      if (editorLayoutData[key]) {
        delete editorLayoutData[key];
      }
    }
  });
}

// 選択中のセルの行・列を取得
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
  // まずDOMの状態をeditorLayoutDataに同期
  syncLayoutDataFromDOM();

  const selected = getSelectedRowCol();
  if (!selected) return;

  const targetRow = selected.row;
  const newLayoutData = {};

  if (position === "above") {
    // 選択中の行の上に挿入: targetRow以降の行を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (row >= targetRow) {
        // ディープコピーして新しい位置に配置
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row + 1;
        cellData.col = col;
        newLayoutData[`${row + 1}_${col}`] = cellData;
      } else {
        // そのままコピー
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row;
        cellData.col = col;
        newLayoutData[key] = cellData;
      }
    });

    // targetRow行の空セルは初期化不要（存在しないセルは自動的にempty扱い）
  } else {
    // 選択中の行の下に挿入: targetRow+1以降の行を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (row > targetRow) {
        // ディープコピーして新しい位置に配置
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row + 1;
        cellData.col = col;
        newLayoutData[`${row + 1}_${col}`] = cellData;
      } else {
        // そのままコピー
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row;
        cellData.col = col;
        newLayoutData[key] = cellData;
      }
    });

    // targetRow+1行の空セルは初期化不要
  }

  editorLayoutData = newLayoutData;
  mapRows++;
  updateMapInfo();
  reloadMapTable();

  // 元のセルの新しい位置を計算して再選択
  let newRow = selected.row;
  if (position === "above") {
    newRow = selected.row + 1; // 上に追加したので、元のセルは+1行目に移動
  }
  // position === "below" の場合は元のセルの位置は変わらない

  // 再選択
  setTimeout(() => {
    selectCell(newRow, selected.col);
  }, 10);
}

// 選択中のセルの行を削除
function removeRowAtSelection(position) {
  if (mapRows <= 1) {
    alert("行は最低1行必要です");
    return;
  }

  // まずDOMの状態をeditorLayoutDataに同期
  syncLayoutDataFromDOM();

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

  // 削除後、残ってきたセルを選択
  let newRow = selected.row;
  if (position === "current") {
    // 現在の行を削除した場合、次の行（繰り上ってくる）を選択
    newRow = Math.min(selected.row, mapRows);
  } else {
    // 下の行を削除した場合、元のセルはそのまま
    newRow = selected.row;
  }

  // 再選択
  setTimeout(() => {
    selectCell(newRow, selected.col);
  }, 10);
}

// 選択中のセルの左/右に列を追加
function addColumnAtSelection(position) {
  // まずDOMの状態をeditorLayoutDataに同期
  syncLayoutDataFromDOM();

  const selected = getSelectedRowCol();
  if (!selected) return;

  const targetCol = selected.col;
  const newLayoutData = {};

  if (position === "left") {
    // 選択中の列の左に挿入: targetCol以降の列を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (col >= targetCol) {
        // ディープコピーして新しい位置に配置
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row;
        cellData.col = col + 1;
        newLayoutData[`${row}_${col + 1}`] = cellData;
      } else {
        // そのままコピー
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row;
        cellData.col = col;
        newLayoutData[key] = cellData;
      }
    });

    // targetCol列の空セルは初期化不要
  } else {
    // 選択中の列の右に挿入: targetCol+1以降の列を+1シフト
    Object.keys(editorLayoutData).forEach((key) => {
      const [row, col] = key.split("_").map(Number);
      if (col > targetCol) {
        // ディープコピーして新しい位置に配置
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row;
        cellData.col = col + 1;
        newLayoutData[`${row}_${col + 1}`] = cellData;
      } else {
        // そのままコピー
        const cellData = JSON.parse(JSON.stringify(editorLayoutData[key]));
        cellData.row = row;
        cellData.col = col;
        newLayoutData[key] = cellData;
      }
    });

    // targetCol+1列の空セルは初期化不要
  }

  editorLayoutData = newLayoutData;
  mapCols++;
  updateMapInfo();
  reloadMapTable();

  // 元のセルの新しい位置を計算して再選択
  let newCol = selected.col;
  if (position === "left") {
    newCol = selected.col + 1; // 左に追加したので、元のセルは+1列目に移動
  }
  // position === "right" の場合は元のセルの位置は変わらない

  // 再選択
  setTimeout(() => {
    selectCell(selected.row, newCol);
  }, 10);
}

// 選択中のセルの列を削除
function removeColumnAtSelection(position) {
  if (mapCols <= 1) {
    alert("列は最低1列必要です");
    return;
  }

  // まずDOMの状態をeditorLayoutDataに同期
  syncLayoutDataFromDOM();

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

  // 削除後、残ってきたセルを選択
  let newCol = selected.col;
  if (position === "current") {
    // 現在の列を削除した場合、次の列（繰り上ってくる）を選択
    newCol = Math.min(selected.col, mapCols);
  } else {
    // 右の列を削除した場合、元のセルはそのまま
    newCol = selected.col;
  }

  // 再選択
  setTimeout(() => {
    selectCell(selected.row, newCol);
  }, 10);
}

// マップ情報の表示更新
function updateMapInfo() {
  const infoElement = document.querySelector(".map-info");
  if (infoElement) {
    infoElement.textContent = `🗺 ${mapRows}行 × ${mapCols}列`;
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
        content.textContent = cellData.label || "█";
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

// ============================================================
// 並び（島）管理
// ============================================================

document.addEventListener("DOMContentLoaded", function () {
  loadInitialLineups();
});

function loadInitialLineups() {
  const data = document.getElementById("lineups-initial-data");
  if (!data) return;
  let lineups = [];
  try {
    lineups = JSON.parse(data.dataset.lineups || "[]");
  } catch (e) {
    console.error("lineups parse error:", e);
    return;
  }
  if (!Array.isArray(lineups)) return;
  for (const l of lineups) {
    addLineupRow({
      id: l.id ?? null,
      name: l.name ?? "",
      machine_numbers: l.machine_numbers ?? [],
    });
  }
  updateLineupCountBadge();
}

function toggleLineupPanel() {
  const body = document.getElementById("lineup-panel-body");
  const toggle = document.getElementById("lineup-panel-toggle");
  if (!body || !toggle) return;
  if (body.style.display === "none") {
    body.style.display = "block";
    toggle.textContent = "▼";
  } else {
    body.style.display = "none";
    toggle.textContent = "▶";
  }
}

function addLineupRow(data) {
  const list = document.getElementById("lineup-list");
  if (!list) return;
  const row = document.createElement("div");
  row.className = "lineup-row";
  if (data && data.id) row.dataset.lineupId = data.id;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "lineup-name";
  nameInput.placeholder = "並び名（任意）";
  nameInput.value = data?.name ?? "";

  const numbersInput = document.createElement("input");
  numbersInput.type = "text";
  numbersInput.className = "lineup-machines";
  numbersInput.placeholder = "1,2,3,4,5,6";
  numbersInput.value = (data?.machine_numbers ?? []).join(",");

  const countLabel = document.createElement("span");
  countLabel.className = "lineup-machine-count";
  numbersInput.addEventListener("input", () => updateRowCount(row));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn-danger btn-small";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = () => removeLineupRow(row);

  row.appendChild(nameInput);
  row.appendChild(numbersInput);
  row.appendChild(countLabel);
  row.appendChild(deleteBtn);
  list.appendChild(row);

  updateRowCount(row);
  updateLineupCountBadge();
}

function removeLineupRow(row) {
  if (!row) return;
  row.remove();
  updateLineupCountBadge();
}

function updateRowCount(row) {
  const input = row.querySelector(".lineup-machines");
  const label = row.querySelector(".lineup-machine-count");
  if (!input || !label) return;
  const nums = parseLineupNumbers(input.value);
  label.textContent = nums.length > 0 ? `${nums.length}台` : "—";
  label.classList.toggle("empty", nums.length === 0);
}

function updateLineupCountBadge() {
  const badge = document.getElementById("lineup-count-badge");
  if (!badge) return;
  const rows = document.querySelectorAll("#lineup-list .lineup-row");
  let nonEmpty = 0;
  rows.forEach((r) => {
    const input = r.querySelector(".lineup-machines");
    if (input && parseLineupNumbers(input.value).length > 0) nonEmpty++;
  });
  badge.textContent = `(${nonEmpty})`;
}

function parseLineupNumbers(str) {
  if (!str) return [];
  return [...new Set(
    str.split(/[,\s]+/).map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0)
  )].sort((a, b) => a - b);
}

function serializeLineups() {
  const rows = document.querySelectorAll("#lineup-list .lineup-row");
  const result = [];
  rows.forEach((r) => {
    const name = r.querySelector(".lineup-name")?.value || "";
    const nums = parseLineupNumbers(r.querySelector(".lineup-machines")?.value || "");
    if (nums.length === 0) return;
    const id = parseInt(r.dataset.lineupId, 10);
    result.push({
      id: Number.isInteger(id) && id > 0 ? id : null,
      name: name,
      machine_numbers: nums,
    });
  });
  return result;
}

// 既存 saveMapData を拡張: 並び情報を hidden field にセット
// 関数宣言（function saveMapData() {...}）は巻き上げ済みなのでファイル末尾でラップしても安全
(function patchSaveMapData() {
  const original = window.saveMapData;
  if (typeof original !== "function") return;
  window.saveMapData = function () {
    const lineupsField = document.getElementById("lineups-field");
    if (lineupsField) {
      lineupsField.value = JSON.stringify(serializeLineups());
    }
    return original.apply(this, arguments);
  };
})();
