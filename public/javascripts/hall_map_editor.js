// ============================================================
// マップエディタ
// - State をクロージャに集約しグローバル汚染を最小化
// - data-layout / data-lineups 属性経由で初期データを受け取る
// - セルは個別再描画、行列変更時のみテーブル全体を再構築
// - 直線連番（同一行/列・L字・斜め）と並び編集モードに対応
// - Turbo 対応: DOMContentLoaded と turbo:load の両方で初期化
// ============================================================

(function () {
  "use strict";

  // ---------- State ----------
  const State = {
    hallId: 0,
    mapId: 0,
    rows: 20,
    cols: 40,
    layoutData: {},      // { "r_c": { type, machine_number, label } }
    lineups: [],         // [{ id, name, machine_numbers: [..] }]

    selectedCell: null,  // { row, col }
    currentTool: "select",
    zoomLevel: 1.0,

    // 直線連番
    lineStart: null,     // { row, col }

    // 並び編集
    editingLineupId: null,    // 編集対象の lineup.id（null 時は通常モード）
    lineupLineStart: null,    // 並び編集モード内での直線指定起点

    // 並びID自動採番のシード
    nextLineupId: 1,
  };

  // ---------- Helpers ----------
  function $(sel) { return document.querySelector(sel); }
  function cellEl(row, col) {
    return document.querySelector(`.editor-cell[data-row="${row}"][data-col="${col}"]`);
  }
  function key(row, col) { return `${row}_${col}`; }
  function parseJsonAttr(raw, fallback) {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return (typeof parsed === typeof fallback || Array.isArray(parsed) === Array.isArray(fallback)) ? parsed : fallback;
    } catch (e) {
      console.error("JSON parse error:", e, raw);
      return fallback;
    }
  }

  // ---------- Initialization ----------
  // Turbo 対応: DOMContentLoaded は Turbo 遷移では再発火しないため turbo:load も購読する。
  // IIFE が遷移ごとに再評価されると同じ関数オブジェクトが2つできるので、
  // グローバルに前回の bootstrap を保持して削除→再登録で重複を防ぐ。
  const bootstrap = () => init();
  if (typeof window.__mapEditorBootstrap === "function") {
    document.removeEventListener("DOMContentLoaded", window.__mapEditorBootstrap);
    document.removeEventListener("turbo:load", window.__mapEditorBootstrap);
  }
  window.__mapEditorBootstrap = bootstrap;
  document.addEventListener("DOMContentLoaded", bootstrap);
  document.addEventListener("turbo:load", bootstrap);
  // turbo:load が DOMContentLoaded より後に発火する初回ロードでも、両方で init が呼ばれるが
  // init は idempotent（State 再代入＋ handler 上書き）なので副作用なし。

  function init() {
    // edit ページ以外（マップ一覧など）でも turbo:load で呼ばれるため、対象がなければ静かに return
    const dataEl = $("#editor-initial-data");
    if (!dataEl) return;

    State.hallId = parseInt(dataEl.dataset.hallId, 10);
    State.mapId = parseInt(dataEl.dataset.mapId, 10);
    State.rows = parseInt(dataEl.dataset.rows, 10) || 20;
    State.cols = parseInt(dataEl.dataset.cols, 10) || 40;
    State.layoutData = parseJsonAttr(dataEl.dataset.layout, {});
    State.lineups = parseJsonAttr(dataEl.dataset.lineups, []);

    // layoutData が空のときは HTML テーブルから再構築（互換）
    if (!State.layoutData || Object.keys(State.layoutData).length === 0) {
      State.layoutData = rebuildLayoutFromDom();
    }

    // 並びIDの次のシード値
    const maxId = State.lineups.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0);
    State.nextLineupId = maxId + 1;

    bindCellHandlers();
    bindActionButtons();
    renderLineupList();
    updateLineupCountBadge();
    setTool("select");
  }

  // data-action 属性を持つ要素にクリックハンドラを動的にアタッチ
  // HTML inline onclick は Turbo/タイミングの絡みで不安定なので JS 側で確実にバインドする
  function bindActionButtons() {
    document.querySelectorAll("[data-action]").forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        const action = el.dataset.action;
        executeAction(action, el);
      };
    });
  }

  function executeAction(action, el) {
    switch (action) {
      case "save-map": saveMapData(); break;
      case "set-tool": setTool(el.dataset.tool); break;
      case "apply-machine-number":
        if (!State.selectedCell) { alert("セルを選択してください"); return; }
        applyMachine(State.selectedCell.row, State.selectedCell.col);
        break;
      case "cancel-line-start": cancelLineStart(); break;
      case "add-row": addRow(el.dataset.position); break;
      case "add-col": addColumn(el.dataset.position); break;
      case "remove-row": removeRow(); break;
      case "remove-col": removeColumn(); break;
      case "zoom-in": State.zoomLevel = Math.min(State.zoomLevel + 0.1, 2.0); applyZoom(); break;
      case "zoom-out": State.zoomLevel = Math.max(State.zoomLevel - 0.1, 0.5); applyZoom(); break;
      case "zoom-reset": State.zoomLevel = 1.0; applyZoom(); break;
      case "toggle-lineup-panel": toggleLineupPanel(); break;
      case "add-lineup-row": appendLineupRowEmpty(); break;
      case "exit-lineup-edit": exitLineupEditMode(); break;
      case "clear-lineup-selection": clearLineupSelection(); break;
    }
  }

  function rebuildLayoutFromDom() {
    const out = {};
    document.querySelectorAll(".editor-cell").forEach((td) => {
      const r = parseInt(td.dataset.row, 10);
      const c = parseInt(td.dataset.col, 10);
      const t = td.dataset.type || "empty";
      if (t === "empty") return;
      const mn = td.dataset.machineNumber;
      const lb = td.dataset.label;
      const data = { type: t };
      if (mn && mn !== "undefined" && mn !== "") data.machine_number = parseInt(mn, 10);
      if (lb && lb !== "undefined" && lb !== "") data.label = lb;
      out[`${r}_${c}`] = data;
    });
    return out;
  }

  function bindCellHandlers() {
    document.querySelectorAll(".editor-cell").forEach((td) => {
      const r = parseInt(td.dataset.row, 10);
      const c = parseInt(td.dataset.col, 10);
      td.onclick = () => onCellClick(r, c);
    });
  }

  // ---------- Cell Rendering ----------
  function renderCell(row, col) {
    const td = cellEl(row, col);
    if (!td) return;
    const data = State.layoutData[key(row, col)];
    const type = (data && data.type) || "empty";

    td.dataset.type = type;
    td.dataset.machineNumber = (data && data.machine_number) || "";
    td.dataset.label = (data && data.label) || "";

    let extra = "";
    if (State.selectedCell && State.selectedCell.row === row && State.selectedCell.col === col) extra += " selected";
    if (State.lineStart && State.lineStart.row === row && State.lineStart.col === col) extra += " line-start";
    if (State.lineupLineStart && State.lineupLineStart.row === row && State.lineupLineStart.col === col) extra += " line-start";
    if (State.editingLineupId !== null && type === "machine") {
      const lineup = State.lineups.find((l) => l.id === State.editingLineupId);
      const mn = data.machine_number;
      if (lineup && mn && lineup.machine_numbers.includes(mn)) extra += " in-current-lineup";
    }
    td.className = `editor-cell ${type}${extra}`;

    if (!data || type === "empty") {
      td.innerHTML = "";
    } else if (type === "machine") {
      td.innerHTML = `<div class="cell-content"><span class="cell-number">${data.machine_number ?? ""}</span></div>`;
    } else if (type === "wall") {
      td.innerHTML = `<div class="cell-content wall">${data.label || "█"}</div>`;
    } else if (type === "counter") {
      td.innerHTML = `<div class="cell-content counter">${data.label || "カウンター"}</div>`;
    }
  }

  function renderAllCells() {
    for (let r = 1; r <= State.rows; r++) {
      for (let c = 1; c <= State.cols; c++) renderCell(r, c);
    }
  }

  // ---------- Cell Click Routing ----------
  function onCellClick(row, col) {
    // 並び編集モード時は別ルート
    if (State.editingLineupId !== null) {
      handleLineupModeClick(row, col);
      return;
    }
    setSelected(row, col);

    switch (State.currentTool) {
      case "select": break;
      case "machine": applyMachine(row, col); break;
      case "machine-line": handleLineToolClick(row, col); break;
      case "wall": setCellData(row, col, { type: "wall", label: "█" }); break;
      case "counter": setCellData(row, col, { type: "counter", label: "カウンター" }); break;
      case "empty":
      case "eraser": setCellData(row, col, { type: "empty" }); break;
    }
  }

  function setSelected(row, col) {
    const prev = State.selectedCell;
    State.selectedCell = { row, col };
    if (prev) renderCell(prev.row, prev.col);
    renderCell(row, col);
    updateSelectionDisplay();
  }

  function updateSelectionDisplay() {
    const display = $("#selection-display");
    if (!display) return;
    if (!State.selectedCell) { display.textContent = "なし"; return; }
    const { row, col } = State.selectedCell;
    const data = State.layoutData[key(row, col)];
    const type = (data && data.type) || "empty";
    const typeLabels = { machine: "🎰 台", wall: "🧱 壁", counter: "🏪 カウンター", empty: "⬜ 空白" };
    let info = `行: ${row}, 列: ${col} / ${typeLabels[type] || type}`;
    if (data && data.machine_number) info += ` / 台番号: ${data.machine_number}`;
    display.textContent = info;
  }

  // ---------- Cell Mutation ----------
  function setCellData(row, col, data) {
    const k = key(row, col);
    if (!data || data.type === "empty") {
      delete State.layoutData[k];
    } else {
      State.layoutData[k] = data;
    }
    renderCell(row, col);
  }

  function applyMachine(row, col) {
    const input = $("#machine-number-input");
    if (!input || !input.value) return;
    const num = parseInt(input.value, 10);
    if (Number.isNaN(num)) return;
    setCellData(row, col, { type: "machine", machine_number: num });
    const inc = getAutoIncrement();
    if (inc !== 0) input.value = num + inc;
  }

  function getAutoIncrement() {
    const sel = document.querySelector('input[name="auto-increment"]:checked');
    return sel ? parseInt(sel.value, 10) : 0;
  }

  // ---------- Direct Line Tool ----------
  function handleLineToolClick(row, col) {
    if (!State.lineStart) {
      setLineStart(row, col);
      return;
    }
    // 同じセルを再クリック → キャンセル
    if (State.lineStart.row === row && State.lineStart.col === col) {
      cancelLineStart();
      return;
    }
    const input = $("#machine-number-input");
    if (!input || !input.value) {
      alert("起点に割り当てる台番号を入力してください");
      return;
    }
    const startNum = parseInt(input.value, 10);
    if (Number.isNaN(startNum)) return;

    const mode = getLinePathMode();
    const path = computePath(State.lineStart, { row, col }, mode);
    const inc = (getAutoIncrement() === -1) ? -1 : 1; // 連番デフォルトは +1
    let num = startNum;
    for (const p of path) {
      setCellData(p.row, p.col, { type: "machine", machine_number: num });
      num += inc;
    }
    input.value = num;

    // 終点を新しい起点として連続使用したいケースもあるが、まず明示的にリセット
    cancelLineStart();
  }

  function setLineStart(row, col) {
    if (State.lineStart) {
      const old = State.lineStart;
      State.lineStart = null;
      renderCell(old.row, old.col);
    }
    State.lineStart = { row, col };
    renderCell(row, col);
    const status = $("#line-status");
    if (status) status.textContent = `起点 (${row}, ${col}) → 終点を選択してください`;
    const cancel = $("#line-cancel-btn");
    if (cancel) cancel.style.display = "inline-block";
  }

  function cancelLineStart() {
    if (State.lineStart) {
      const old = State.lineStart;
      State.lineStart = null;
      renderCell(old.row, old.col);
    }
    const status = $("#line-status");
    if (status) status.textContent = "起点を選択してください";
    const cancel = $("#line-cancel-btn");
    if (cancel) cancel.style.display = "none";
  }

  function getLinePathMode() {
    const sel = document.querySelector('input[name="line-path"]:checked');
    return sel ? sel.value : "l-h";
  }

  function computePath(a, b, mode) {
    if (a.row === b.row) return horizontalPath(a, b);
    if (a.col === b.col) return verticalPath(a, b);
    if (mode === "diagonal") return bresenhamPath(a, b);
    if (mode === "l-v") return lShapePath(a, b, "vertical-first");
    return lShapePath(a, b, "horizontal-first");
  }

  function horizontalPath(a, b) {
    const dir = b.col >= a.col ? 1 : -1;
    const path = [];
    for (let c = a.col; dir > 0 ? c <= b.col : c >= b.col; c += dir) {
      path.push({ row: a.row, col: c });
    }
    return path;
  }
  function verticalPath(a, b) {
    const dir = b.row >= a.row ? 1 : -1;
    const path = [];
    for (let r = a.row; dir > 0 ? r <= b.row : r >= b.row; r += dir) {
      path.push({ row: r, col: a.col });
    }
    return path;
  }
  function lShapePath(a, b, mode) {
    const path = [];
    const dirR = b.row >= a.row ? 1 : -1;
    const dirC = b.col >= a.col ? 1 : -1;
    if (mode === "horizontal-first") {
      for (let c = a.col; dirC > 0 ? c <= b.col : c >= b.col; c += dirC) path.push({ row: a.row, col: c });
      for (let r = a.row + dirR; dirR > 0 ? r <= b.row : r >= b.row; r += dirR) path.push({ row: r, col: b.col });
    } else {
      for (let r = a.row; dirR > 0 ? r <= b.row : r >= b.row; r += dirR) path.push({ row: r, col: a.col });
      for (let c = a.col + dirC; dirC > 0 ? c <= b.col : c >= b.col; c += dirC) path.push({ row: b.row, col: c });
    }
    return path;
  }
  function bresenhamPath(a, b) {
    const path = [];
    let r = a.row, c = a.col;
    const dr = Math.abs(b.row - a.row);
    const dc = Math.abs(b.col - a.col);
    const sr = a.row < b.row ? 1 : -1;
    const sc = a.col < b.col ? 1 : -1;
    let err = dc - dr;
    let safety = (dr + dc) * 2 + 10; // 無限ループ防止
    while (safety-- > 0) {
      path.push({ row: r, col: c });
      if (r === b.row && c === b.col) break;
      const e2 = 2 * err;
      if (e2 > -dr) { err -= dr; c += sc; }
      if (e2 < dc) { err += dc; r += sr; }
    }
    return path;
  }

  // ---------- Tool Switching ----------
  function setTool(tool) {
    cancelLineStart();
    State.currentTool = tool;
    document.querySelectorAll(".tool-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    const machinePanel = $("#machine-input-panel");
    const linePanel = $("#line-path-panel");
    const rowColPanel = $("#row-col-edit-panel");
    if (machinePanel) machinePanel.style.display = (tool === "machine" || tool === "machine-line") ? "inline-flex" : "none";
    if (linePanel) linePanel.style.display = (tool === "machine-line") ? "inline-flex" : "none";
    if (rowColPanel) rowColPanel.style.display = (tool === "select") ? "inline-flex" : "none";
  }

  // ---------- Row/Column Operations ----------
  function shiftLayoutData(transform) {
    const out = {};
    Object.entries(State.layoutData).forEach(([k, v]) => {
      const [r, c] = k.split("_").map(Number);
      const t = transform(r, c);
      if (!t) return; // 削除対象
      out[`${t.row}_${t.col}`] = JSON.parse(JSON.stringify(v));
    });
    State.layoutData = out;
  }

  function addRow(position) {
    if (!State.selectedCell) { alert("セルを選択してください"); return; }
    const target = State.selectedCell.row;
    if (position === "above") {
      shiftLayoutData((r, c) => r >= target ? { row: r + 1, col: c } : { row: r, col: c });
    } else {
      shiftLayoutData((r, c) => r > target ? { row: r + 1, col: c } : { row: r, col: c });
    }
    State.rows++;
    if (position === "above") State.selectedCell = { row: target + 1, col: State.selectedCell.col };
    rebuildTable();
    updateMapInfoUi();
  }

  function removeRow() {
    if (State.rows <= 1) { alert("行は最低1行必要です"); return; }
    if (!State.selectedCell) { alert("セルを選択してください"); return; }
    if (!confirm("選択中の行を削除します。よろしいですか？")) return;
    const target = State.selectedCell.row;
    shiftLayoutData((r, c) => {
      if (r === target) return null;
      if (r > target) return { row: r - 1, col: c };
      return { row: r, col: c };
    });
    State.rows--;
    State.selectedCell = { row: Math.min(target, State.rows), col: State.selectedCell.col };
    rebuildTable();
    updateMapInfoUi();
  }

  function addColumn(position) {
    if (!State.selectedCell) { alert("セルを選択してください"); return; }
    const target = State.selectedCell.col;
    if (position === "left") {
      shiftLayoutData((r, c) => c >= target ? { row: r, col: c + 1 } : { row: r, col: c });
    } else {
      shiftLayoutData((r, c) => c > target ? { row: r, col: c + 1 } : { row: r, col: c });
    }
    State.cols++;
    if (position === "left") State.selectedCell = { row: State.selectedCell.row, col: target + 1 };
    rebuildTable();
    updateMapInfoUi();
  }

  function removeColumn() {
    if (State.cols <= 1) { alert("列は最低1列必要です"); return; }
    if (!State.selectedCell) { alert("セルを選択してください"); return; }
    if (!confirm("選択中の列を削除します。よろしいですか？")) return;
    const target = State.selectedCell.col;
    shiftLayoutData((r, c) => {
      if (c === target) return null;
      if (c > target) return { row: r, col: c - 1 };
      return { row: r, col: c };
    });
    State.cols--;
    State.selectedCell = { row: State.selectedCell.row, col: Math.min(target, State.cols) };
    rebuildTable();
    updateMapInfoUi();
  }

  function rebuildTable() {
    const tbody = document.querySelector("#editor-map-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    for (let r = 1; r <= State.rows; r++) {
      const tr = document.createElement("tr");
      for (let c = 1; c <= State.cols; c++) {
        const td = document.createElement("td");
        td.className = "editor-cell empty";
        td.dataset.row = r;
        td.dataset.col = c;
        td.dataset.type = "empty";
        td.dataset.machineNumber = "";
        td.dataset.label = "";
        td.onclick = () => onCellClick(r, c);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    renderAllCells();
    applyZoom();
  }

  function updateMapInfoUi() {
    const rowsField = $("#rows-field");
    const colsField = $("#cols-field");
    if (rowsField) rowsField.value = State.rows;
    if (colsField) colsField.value = State.cols;
  }

  // ---------- Zoom ----------
  function applyZoom() {
    const table = $("#editor-map-table");
    if (!table) return;
    table.style.transform = `scale(${State.zoomLevel})`;
    table.style.transformOrigin = "top left";
  }

  // ---------- Lineup Management ----------
  function renderLineupList() {
    const list = $("#lineup-list");
    if (!list) return;
    list.innerHTML = "";
    State.lineups.forEach((l) => list.appendChild(buildLineupRow(l)));
  }

  function buildLineupRow(lineup) {
    const row = document.createElement("div");
    row.className = "lineup-row";
    row.dataset.lineupId = lineup.id;
    if (State.editingLineupId === lineup.id) row.classList.add("editing");

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "lineup-name";
    nameInput.placeholder = "並び名（任意）";
    nameInput.value = lineup.name || "";
    nameInput.addEventListener("input", () => { lineup.name = nameInput.value; });

    const numbersInput = document.createElement("input");
    numbersInput.type = "text";
    numbersInput.className = "lineup-machines";
    numbersInput.placeholder = "1,2,3,4,5,6";
    numbersInput.value = (lineup.machine_numbers || []).join(",");
    numbersInput.addEventListener("input", () => {
      lineup.machine_numbers = parseLineupNumbers(numbersInput.value);
      updateCountLabel(row, lineup.machine_numbers.length);
      updateLineupCountBadge();
      // 表示中の machine セルの 'in-current-lineup' クラスを更新
      if (State.editingLineupId === lineup.id) renderAllCells();
    });

    const countLabel = document.createElement("span");
    countLabel.className = "lineup-machine-count";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-secondary btn-small";
    editBtn.textContent = "🎯 マップで選択";
    editBtn.onclick = () => enterLineupEditMode(lineup.id);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger btn-small";
    deleteBtn.textContent = "削除";
    deleteBtn.onclick = () => removeLineupRow(lineup.id);

    row.appendChild(nameInput);
    row.appendChild(numbersInput);
    row.appendChild(countLabel);
    row.appendChild(editBtn);
    row.appendChild(deleteBtn);

    updateCountLabel(row, (lineup.machine_numbers || []).length);
    return row;
  }

  function updateCountLabel(rowEl, count) {
    const label = rowEl.querySelector(".lineup-machine-count");
    if (!label) return;
    label.textContent = count > 0 ? `${count}台` : "—";
    label.classList.toggle("empty", count === 0);
  }

  function parseLineupNumbers(str) {
    if (!str) return [];
    // 順序保持・重複除去
    const result = [];
    const seen = new Set();
    str.split(/[,\s]+/).forEach((s) => {
      const n = parseInt(s.trim(), 10);
      if (Number.isInteger(n) && n > 0 && !seen.has(n)) {
        seen.add(n);
        result.push(n);
      }
    });
    return result;
  }

  function updateLineupCountBadge() {
    const badge = $("#lineup-count-badge");
    if (!badge) return;
    const nonEmpty = State.lineups.filter((l) => (l.machine_numbers || []).length > 0).length;
    badge.textContent = `(${nonEmpty})`;
  }

  function appendLineupRowEmpty() {
    const newLineup = {
      id: State.nextLineupId++,
      name: "",
      machine_numbers: [],
    };
    State.lineups.push(newLineup);
    const list = $("#lineup-list");
    if (list) list.appendChild(buildLineupRow(newLineup));
    updateLineupCountBadge();
  }

  function removeLineupRow(lineupId) {
    const idx = State.lineups.findIndex((l) => l.id === lineupId);
    if (idx < 0) return;
    State.lineups.splice(idx, 1);
    if (State.editingLineupId === lineupId) State.editingLineupId = null;
    renderLineupList();
    updateLineupCountBadge();
    renderAllCells();
  }

  // ---------- Lineup Edit Mode ----------
  function enterLineupEditMode(lineupId) {
    State.editingLineupId = lineupId;
    State.lineupLineStart = null;
    const lineup = State.lineups.find((l) => l.id === lineupId);
    const banner = $("#lineup-edit-banner");
    const name = $("#lineup-edit-target-name");
    const mainPalette = $("#main-tool-palette");
    const mainControl = $("#main-control-panel");
    if (banner) banner.style.display = "block";
    if (name) name.textContent = (lineup && lineup.name) ? lineup.name : `並び #${lineupId}`;
    if (mainPalette) mainPalette.style.display = "none";
    if (mainControl) mainControl.style.display = "none";
    updateLineupEditCount();
    renderLineupList();
    renderAllCells();
  }

  function exitLineupEditMode() {
    State.editingLineupId = null;
    State.lineupLineStart = null;
    const banner = $("#lineup-edit-banner");
    const mainPalette = $("#main-tool-palette");
    const mainControl = $("#main-control-panel");
    if (banner) banner.style.display = "none";
    if (mainPalette) mainPalette.style.display = "block";
    if (mainControl) mainControl.style.display = "flex";
    renderLineupList();
    renderAllCells();
  }

  function clearLineupSelection() {
    const lineup = State.lineups.find((l) => l.id === State.editingLineupId);
    if (!lineup) return;
    if (!confirm("この並びの台を全て解除します。よろしいですか？")) return;
    lineup.machine_numbers = [];
    syncLineupRowInput(lineup);
    updateLineupEditCount();
    updateLineupCountBadge();
    renderAllCells();
  }

  function syncLineupRowInput(lineup) {
    const rowEl = document.querySelector(`.lineup-row[data-lineup-id="${lineup.id}"]`);
    if (!rowEl) return;
    const input = rowEl.querySelector(".lineup-machines");
    if (input) input.value = lineup.machine_numbers.join(",");
    updateCountLabel(rowEl, lineup.machine_numbers.length);
  }

  function getLineupMode() {
    const sel = document.querySelector('input[name="lineup-mode"]:checked');
    return sel ? sel.value : "single";
  }

  function handleLineupModeClick(row, col) {
    const lineup = State.lineups.find((l) => l.id === State.editingLineupId);
    if (!lineup) return;
    const data = State.layoutData[key(row, col)];
    if (!data || data.type !== "machine" || !data.machine_number) {
      // 台セル以外はスキップ
      return;
    }

    const mode = getLineupMode();
    if (mode === "single") {
      toggleLineupMember(lineup, data.machine_number);
    } else {
      // 直線範囲
      if (!State.lineupLineStart) {
        State.lineupLineStart = { row, col };
        renderCell(row, col);
        const hint = $("#lineup-edit-hint");
        if (hint) hint.textContent = `起点 (${row}, ${col}) → 終点をクリックして範囲指定（L字横優先）`;
        return;
      }
      // 終点 → 経路上の machine セルを追加
      const path = computePath(State.lineupLineStart, { row, col }, "l-h");
      const oldStart = State.lineupLineStart;
      State.lineupLineStart = null;
      for (const p of path) {
        const d = State.layoutData[key(p.row, p.col)];
        if (d && d.type === "machine" && d.machine_number) {
          addLineupMember(lineup, d.machine_number);
        }
      }
      renderCell(oldStart.row, oldStart.col);
      const hint = $("#lineup-edit-hint");
      if (hint) hint.textContent = "起点をクリックして範囲指定を開始";
    }
    syncLineupRowInput(lineup);
    updateLineupEditCount();
    updateLineupCountBadge();
    renderAllCells();
  }

  function addLineupMember(lineup, machineNumber) {
    if (!lineup.machine_numbers.includes(machineNumber)) lineup.machine_numbers.push(machineNumber);
  }
  function toggleLineupMember(lineup, machineNumber) {
    const i = lineup.machine_numbers.indexOf(machineNumber);
    if (i >= 0) lineup.machine_numbers.splice(i, 1);
    else lineup.machine_numbers.push(machineNumber);
  }

  function updateLineupEditCount() {
    const lineup = State.lineups.find((l) => l.id === State.editingLineupId);
    const el = $("#lineup-edit-current-count");
    if (!el || !lineup) return;
    el.textContent = `(${lineup.machine_numbers.length}台)`;
  }

  function toggleLineupPanel() {
    const body = $("#lineup-panel-body");
    const toggle = $("#lineup-panel-toggle");
    if (!body || !toggle) return;
    const hidden = body.style.display === "none";
    body.style.display = hidden ? "block" : "none";
    toggle.textContent = hidden ? "▼" : "▶";
  }

  // ---------- Lineup Mode Radio Change ----------
  document.addEventListener("change", (e) => {
    if (e.target && e.target.name === "lineup-mode") {
      // ラジオ切替時、直線指定起点をクリア
      if (State.lineupLineStart) {
        const old = State.lineupLineStart;
        State.lineupLineStart = null;
        renderCell(old.row, old.col);
      }
      const hint = $("#lineup-edit-hint");
      if (hint) {
        hint.textContent = e.target.value === "single"
          ? "マップで台セルをクリックすると並びに追加されます。同じ台をクリックすると削除。"
          : "起点をクリックして範囲指定を開始。経路上の台が並びに追加されます。";
      }
    }
  });

  // ---------- Save ----------
  function buildLineupsForSave() {
    // State.lineups から空の並びを除外して送信用配列を作る
    return State.lineups
      .filter((l) => (l.machine_numbers || []).length > 0)
      .map((l) => ({
        id: l.id,
        name: l.name || "",
        machine_numbers: l.machine_numbers,
      }));
  }

  function saveMapData() {
    const btn = $("#save-btn");
    if (btn) { btn.disabled = true; btn.textContent = "保存中..."; }

    // 並び編集モード中なら抜けてから保存
    if (State.editingLineupId !== null) exitLineupEditMode();

    // 保存前に最終チェック：layoutData が空ならアラート
    if (!State.layoutData || Object.keys(State.layoutData).length === 0) {
      // HTML から再構築を試行（フォールバック）
      State.layoutData = rebuildLayoutFromDom();
    }
    if (Object.keys(State.layoutData).length === 0) {
      alert("保存するデータがありません。配置を確認してください。");
      if (btn) { btn.disabled = false; btn.textContent = "💾 保存"; }
      return;
    }

    $("#layout-data-field").value = JSON.stringify(State.layoutData);
    $("#lineups-field").value = JSON.stringify(buildLineupsForSave());
    $("#rows-field").value = State.rows;
    $("#cols-field").value = State.cols;
    $("#map-save-form").submit();
  }

  // ---------- Public API (onclick handlers) ----------
  // 旧 HTML が <td onclick="selectCell(r,c)"> のままキャッシュされている可能性に対する保険
  window.selectCell = function (row, col) { onCellClick(row, col); };
  window.selectTool = setTool;
  window.applyMachineNumber = function () {
    if (!State.selectedCell) { alert("セルを選択してください"); return; }
    const { row, col } = State.selectedCell;
    applyMachine(row, col);
  };
  window.cancelLineStart = cancelLineStart;
  window.addRowAtSelection = addRow;
  window.removeRowAtSelection = removeRow;
  window.addColumnAtSelection = addColumn;
  window.removeColumnAtSelection = removeColumn;
  window.zoomIn = function () { State.zoomLevel = Math.min(State.zoomLevel + 0.1, 2.0); applyZoom(); };
  window.zoomOut = function () { State.zoomLevel = Math.max(State.zoomLevel - 0.1, 0.5); applyZoom(); };
  window.resetZoom = function () { State.zoomLevel = 1.0; applyZoom(); };
  window.saveMapData = saveMapData;
  window.toggleLineupPanel = toggleLineupPanel;
  window.addLineupRow = appendLineupRowEmpty;
  window.exitLineupEditMode = exitLineupEditMode;
  window.clearLineupSelection = clearLineupSelection;

  // debug
  window.__mapEditorState = State;
})();
