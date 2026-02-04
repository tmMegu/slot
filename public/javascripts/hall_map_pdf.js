/**
 * ホールマップPDF出力機能
 *
 * ブラウザの印刷機能を使用してマップをPDF出力します。
 * 既存の処理には影響を与えず、独立して動作します。
 */

// ============================================================
// グローバル変数
// ============================================================

// 印刷準備中フラグ（スクリプトの重複読み込み対策）
if (typeof window.pdfIsPrintPreparing === "undefined") {
  window.pdfIsPrintPreparing = false;
}

// ============================================================
// メイン処理
// ============================================================

/**
 * PDF出力を実行する（表部分のみ）
 *
 * 【処理の流れ】
 * 1. 不要な要素を非表示にする
 * 2. ユーザー指定のスケールを適用
 * 3. 印刷ダイアログを表示
 * 4. 印刷後に元の表示に戻す
 */
window.exportMapToPDF = function () {
  if (window.pdfIsPrintPreparing) {
    return;
  }

  try {
    console.log("=== PDF出力開始 ===");

    // セルサイズと余白を固定値で設定
    const cellWidthMm = 34;
    const cellHeightMm = 34;
    const marginMm = 0;

    console.log(`セルサイズ: ${cellWidthMm}mm x ${cellHeightMm}mm`);

    // 動的にページサイズを設定するスタイルを追加
    addDynamicPrintStyle(cellWidthMm, cellHeightMm, marginMm);

    // 印刷準備（不要な要素を非表示）
    console.log("preparePrint()を呼び出します");
    preparePrint();

    // 少し遅延させてから印刷ダイアログを表示
    setTimeout(() => {
      window.print();

      // 印刷ダイアログが閉じられた後にクリーンアップ
      setTimeout(() => {
        cleanupPrint();
      }, 1000);
    }, 100);
  } catch (error) {
    console.error("PDF出力エラー:", error);
    alert("PDF出力に失敗しました。もう一度お試しください。");
    cleanupPrint();
  }
};

// ============================================================
// 動的スタイル追加処理
// ============================================================

/**
 * 表示設定を取得
 *
 * @returns {Object} 表示設定
 */
function getDisplaySettings() {
  const settings = {
    showMachineName:
      document.getElementById("show-machine-name")?.checked ?? true,
    showMachineNumber:
      document.getElementById("show-machine-number")?.checked ?? true,
    showDiff: document.getElementById("show-diff")?.checked ?? false,
    showGames: document.getElementById("show-map-games")?.checked ?? false,
    showBB: document.getElementById("show-bb")?.checked ?? false,
  };

  console.log("表示設定:", settings);
  return settings;
}

/**
 * 動的にページサイズを設定するスタイルを追加
 *
 * @param {number} cellWidthMm - セルの幅（mm）
 * @param {number} cellHeightMm - セルの高さ（mm）
 * @param {number} marginMm - 余白（mm）
 */
function addDynamicPrintStyle(cellWidthMm, cellHeightMm, marginMm) {
  // マップテーブルの実際のサイズを取得
  const mapTable = document.querySelector(".map-table");
  if (!mapTable) return;

  // 行数と列数を取得
  const rows = mapTable.querySelectorAll("tr").length;
  const cols = mapTable.querySelector("tr")
    ? mapTable.querySelector("tr").querySelectorAll("td").length
    : 0;

  // 用紙サイズを計算
  const pageWidthMm = cellWidthMm * cols + marginMm * 2;
  const pageHeightMm = cellHeightMm * rows + marginMm * 2;

  // 表示設定を取得
  const displaySettings = getDisplaySettings();

  // 既存の動的スタイルを削除
  const existingStyle = document.getElementById("dynamic-pdf-style");
  if (existingStyle) {
    existingStyle.remove();
  }

  // 新しいスタイルを追加
  const style = document.createElement("style");
  style.id = "dynamic-pdf-style";
  style.textContent = `
    @media print {
      @page {
        size: ${pageWidthMm}mm ${pageHeightMm}mm;
        margin: ${marginMm}mm;
      }
      
      .map-table td {
        width: ${cellWidthMm}mm !important;
        min-width: ${cellWidthMm}mm !important;
        max-width: ${cellWidthMm}mm !important;
        height: ${cellHeightMm}mm !important;
        font-size: ${Math.max(Math.floor(cellHeightMm / 8), 8)}pt !important;
        padding: 0.5mm !important;
        box-sizing: border-box !important;
        vertical-align: middle !important;
      }
      
      .machine-info {
        display: flex !important;
        flex-direction: column !important;
        gap: 0mm !important;
        align-items: center !important;
        justify-content: flex-start !important;
        width: 100% !important;
        height: 100% !important;
        padding-top: 0mm !important;
      }
      
      .cell-content.machine {
        display: flex !important;
        width: 100% !important;
        height: 100% !important;
      }
      
      .machine-number {
        display: ${displaySettings.showMachineNumber ? "block" : "none"} !important;
        font-size: ${Math.max(Math.floor(cellHeightMm / 1.1), 24)}pt !important;
        font-weight: bold !important;
        margin: 0 !important;
        padding: 0 !important;
        line-height: 0.9 !important;
        order: 2 !important;
        position: static !important;
        top: auto !important;
        left: auto !important;
        right: auto !important;
        bottom: auto !important;
        transform: none !important;
      }
      
      .machine-name {
        display: ${displaySettings.showMachineName ? "block" : "none"} !important;
        font-size: ${Math.max(Math.floor(cellHeightMm / 1.8), 16)}pt !important;
        white-space: normal !important;
        word-wrap: break-word !important;
        overflow: visible !important;
        max-height: none !important;
        margin: 0mm 0 5mm 0 !important;
        padding: 0 !important;
        line-height: 1 !important;
        order: 1 !important;
        position: static !important;
        top: auto !important;
        left: auto !important;
        right: auto !important;
        bottom: auto !important;
        transform: none !important;
      }
      
      .machine-stats {
        display: block !important;
        font-size: ${Math.max(Math.floor(cellHeightMm / 4.5), 6)}pt !important;
        margin: 5mm 0 0 0 !important;
        padding: 0 !important;
        line-height: 1.1 !important;
        order: 3 !important;
        position: static !important;
      }
      
      .stat-diff {
        display: ${displaySettings.showDiff ? "inline" : "none"} !important;
      }
      
      .stat-games {
        display: ${displaySettings.showGames ? "inline" : "none"} !important;
      }
      
      .stat-bb {
        display: ${displaySettings.showBB ? "inline" : "none"} !important;
      }
    }
  `;
  document.head.appendChild(style);

  console.log(
    `PDF設定: ${rows}行 x ${cols}列, セルサイズ: ${cellWidthMm}mm x ${cellHeightMm}mm, 余白: ${marginMm}mm, 用紙: ${pageWidthMm}mm x ${pageHeightMm}mm`,
  );

  const machineNameFontSize = Math.max(Math.floor(cellHeightMm / 1.8), 16);
  const machineNumberFontSize = Math.max(Math.floor(cellHeightMm / 1.1), 24);
  console.log(
    `.machine-name のCSS設定: display: ${displaySettings.showMachineName ? "block" : "none"} !important, font-size: ${machineNameFontSize}pt (上)`,
  );
  console.log(
    `.machine-number のCSS設定: font-size: ${machineNumberFontSize}pt (下)`,
  );
  console.log(
    `34mm ÷ 1.1 = ${Math.floor(34 / 1.1)}pt (台番号・下), 34mm ÷ 1.8 = ${Math.floor(34 / 1.8)}pt (機種名・上)`,
  );

  // 実際に機種名要素が存在するか確認
  const machineNames = document.querySelectorAll(".machine-name");
  console.log(`画面上の.machine-name要素数: ${machineNames.length}`);
  if (machineNames.length > 0) {
    const firstMachineName = machineNames[0];
    console.log(
      `最初の機種名: "${firstMachineName.textContent}", display: ${getComputedStyle(firstMachineName).display}`,
    );
  }
}

// ============================================================
// 印刷準備処理
// ============================================================

/**
 * 印刷前の準備を行う
 *
 * 【処理内容】
 * - 表部分以外のすべての要素を非表示
 * - 表部分のみを印刷対象にする
 * - ユーザー指定のスケールを適用
 *
 * @param {number} scaleX - 横方向の拡大率（1.0 = 100%）
 * @param {number} scaleY - 縦方向の拡大率（1.0 = 100%）
 */
function preparePrint(scaleX = 1.0, scaleY = 1.0) {
  window.pdfIsPrintPreparing = true;

  // マップテーブルを取得
  const mapTable = document.querySelector(".map-table");
  if (!mapTable) {
    alert("マップが見つかりません。");
    return;
  }

  // 画面上で設定されたインラインスタイルをクリア（印刷CSSを優先させるため）
  const elementsWithInlineStyle = mapTable.querySelectorAll(
    ".machine-name, .machine-number, .stat-diff, .stat-games, .stat-bb, .machine-stats",
  );

  console.log(
    `インラインスタイルをクリアする要素数: ${elementsWithInlineStyle.length}`,
  );

  // 表示設定を取得
  const displaySettings = getDisplaySettings();
  console.log("preparePrint: 表示設定", displaySettings);

  // 各machine-info内の要素順序を入れ替える（機種名を上、台番号を下に）
  const machineInfos = mapTable.querySelectorAll(".machine-info");
  console.log(`machine-info要素数: ${machineInfos.length}`);

  machineInfos.forEach((info) => {
    const machineNumber = info.querySelector(".machine-number");
    const machineName = info.querySelector(".machine-name");
    const machineStats = info.querySelector(".machine-stats");

    if (machineNumber && machineName) {
      // 順序を保存（復元用）
      info.setAttribute("data-original-order", "saved");

      // 機種名を最初に、台番号を2番目に、統計を最後に配置
      info.appendChild(machineName); // 最後に移動
      info.appendChild(machineNumber); // 最後に移動
      if (machineStats) {
        info.appendChild(machineStats); // 最後に移動
      }

      console.log(
        `要素を並び替え: ${machineName.textContent} → ${machineNumber.textContent}`,
      );
    }
  });

  elementsWithInlineStyle.forEach((el) => {
    // インラインスタイルを一時的に保存
    const originalDisplay = el.style.display || "";
    const originalCssText = el.style.cssText || "";
    el.setAttribute("data-original-display", originalDisplay);
    el.setAttribute("data-original-csstext", originalCssText);

    // 全てのインラインスタイルをクリア（重なりを防ぐため）
    el.style.cssText = "";

    // クラスに応じて表示設定を適用
    if (el.classList.contains("machine-name")) {
      el.style.setProperty(
        "display",
        displaySettings.showMachineName ? "block" : "none",
        "important",
      );
      console.log(
        `machine-name: ${displaySettings.showMachineName ? "block" : "none"} !important`,
      );
    } else if (el.classList.contains("machine-number")) {
      el.style.setProperty(
        "display",
        displaySettings.showMachineNumber ? "block" : "none",
        "important",
      );
    } else if (el.classList.contains("stat-diff")) {
      el.style.setProperty(
        "display",
        displaySettings.showDiff ? "block" : "none",
        "important",
      );
    } else if (el.classList.contains("stat-games")) {
      el.style.setProperty(
        "display",
        displaySettings.showGames ? "block" : "none",
        "important",
      );
    } else if (el.classList.contains("stat-bb")) {
      el.style.setProperty(
        "display",
        displaySettings.showBB ? "block" : "none",
        "important",
      );
    } else if (el.classList.contains("machine-stats")) {
      // machine-statsは常に表示（子要素で制御）
      el.style.setProperty("display", "block", "important");
    }
  });

  console.log("印刷準備: 表示設定を!importantで適用しました");

  // スケールを適用（縦横別々に指定）
  const mapGridContainer = document.querySelector(".map-grid-container");
  if (mapGridContainer) {
    // 印刷時もスケールを維持するためのクラスを追加（transformは使わない）
    mapGridContainer.classList.add("pdf-scaled");
    mapGridContainer.setAttribute("data-pdf-scale-x", scaleX);
    mapGridContainer.setAttribute("data-pdf-scale-y", scaleY);
  }

  // body直下の全要素を取得
  const bodyChildren = document.body.children;

  // マップテーブルの親要素を特定（.map-grid-container または .map-tab-container）
  let mapContainer =
    mapTable.closest(".map-grid-container") ||
    mapTable.closest(".map-tab-container");

  // body直下の要素で、マップコンテナの親階層でないものをすべて非表示
  for (let i = 0; i < bodyChildren.length; i++) {
    const child = bodyChildren[i];

    // マップテーブルの親階層でない要素は非表示
    if (!child.contains(mapTable)) {
      child.classList.add("print-hide-temp");
    }
  }

  // マップコンテナ内で、テーブル以外の要素を非表示
  if (mapContainer) {
    const containerChildren = mapContainer.querySelectorAll("*");
    containerChildren.forEach((element) => {
      // テーブル自体とその子要素以外を非表示
      if (!mapTable.contains(element) && element !== mapTable) {
        element.classList.add("print-hide-temp");
      }
    });
  }

  // 追加で明示的に非表示にする要素
  const hideSelectors = [
    ".collapsible-panel",
    ".map-toolbar",
    "nav",
    ".tab-buttons",
    "footer",
    ".sidebar",
    "header",
    ".header",
    "h1",
    "h2",
    ".page-title",
    "a", // すべてのリンク（「日付一覧に戻る」など）
    ".back-link",
    ".breadcrumb",
    ".navigation",
  ];

  hideSelectors.forEach((selector) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach((element) => {
      // マップテーブル内のリンクは除外
      if (!mapTable.contains(element)) {
        element.classList.add("print-hide-temp");
      }
    });
  });
}

// ============================================================
// クリーンアップ処理
// ============================================================
// ============================================================

/**
 * 印刷後のクリーンアップを行う
 *
 * 【処理内容】
 * - 非表示にした要素を元に戻す
 * - スケールをリセット
 * - 動的スタイルを削除
 */
function cleanupPrint() {
  // print-hide-temp クラスを持つ全要素からクラスを削除
  const hideElements = document.querySelectorAll(".print-hide-temp");
  hideElements.forEach((element) => {
    element.classList.remove("print-hide-temp");
  });

  // マップテーブル内の要素のインラインスタイルを復元
  const mapTable = document.querySelector(".map-table");
  if (mapTable) {
    // 要素の順序を元に戻す
    const machineInfosWithOrder = mapTable.querySelectorAll(
      ".machine-info[data-original-order]",
    );
    machineInfosWithOrder.forEach((info) => {
      const machineNumber = info.querySelector(".machine-number");
      const machineName = info.querySelector(".machine-name");
      const machineStats = info.querySelector(".machine-stats");

      if (machineNumber && machineName) {
        // 元の順序に戻す（台番号→機種名→統計）
        info.insertBefore(machineNumber, info.firstChild);
        info.insertBefore(machineName, machineStats);
        info.removeAttribute("data-original-order");
      }
    });

    const elementsWithOriginalStyle = mapTable.querySelectorAll(
      "[data-original-csstext]",
    );
    elementsWithOriginalStyle.forEach((el) => {
      const originalCssText = el.getAttribute("data-original-csstext");
      el.style.cssText = originalCssText;
      el.removeAttribute("data-original-display");
      el.removeAttribute("data-original-csstext");
    });
    console.log(`復元した要素数: ${elementsWithOriginalStyle.length}`);
  }

  // スケールをリセット
  const mapGridContainer = document.querySelector(".map-grid-container");
  if (mapGridContainer) {
    mapGridContainer.removeAttribute("data-pdf-scale-x");
    mapGridContainer.removeAttribute("data-pdf-scale-y");
    mapGridContainer.classList.remove("pdf-scaled");
  }

  // 動的スタイルを削除
  const dynamicStyle = document.getElementById("dynamic-pdf-style");
  if (dynamicStyle) {
    dynamicStyle.remove();
  }

  console.log("印刷後のクリーンアップ完了");

  // フラグをリセット
  window.pdfIsPrintPreparing = false;
}

// ============================================================
// イベントリスナー
// ============================================================

// ブラウザの afterprint イベントでクリーンアップ
window.addEventListener("afterprint", () => {
  cleanupPrint();
});

// ============================================================
// 旧処理（使用していません）
// ============================================================

/**
 * 現在のページのスタイルをキャプチャする
 *
 * @returns {string} すべてのスタイルシートの内容
 */
function captureStyles() {
  let styles = "";

  // すべてのスタイルシートを取得
  const styleSheets = document.styleSheets;
  for (let i = 0; i < styleSheets.length; i++) {
    try {
      const rules = styleSheets[i].cssRules || styleSheets[i].rules;
      if (rules) {
        for (let j = 0; j < rules.length; j++) {
          styles += rules[j].cssText + "\n";
        }
      }
    } catch (e) {
      // 外部スタイルシートでCORSエラーが発生する場合はスキップ
      console.warn("スタイルシートの読み込みエラー:", e);
    }
  }

  // インラインstyle要素も取得
  const inlineStyles = document.querySelectorAll("style");
  inlineStyles.forEach((style) => {
    styles += style.textContent + "\n";
  });

  return styles;
}

/**
 * 印刷用HTMLを生成する
 *
 * @param {string} tableHTML - マップテーブルのHTML
 * @param {number} scale - 縮小率
 * @param {string} styles - 元のページのスタイル
 * @returns {string} 完全なHTML文書
 */
function createPrintHTML(tableHTML, scale, styles) {
  return `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ホールマップ - PDF出力</title>
  <style>
    /* 元のページのスタイルを保持 */
    ${styles}

    /* ページ設定 */
    @page {
      size: auto;
      margin: 2mm;
    }

    /* 印刷用の追加スタイル */
    * {
      box-sizing: border-box;
      page-break-inside: avoid !important;
    }

    html, body {
      width: 100%;
      height: 100%;
      overflow: visible;
      background: white;
      margin: 0;
      padding: 0;
    }

    body {
      display: flex;
      justify-content: flex-start;
      align-items: flex-start;
      padding: 10mm;
    }

    /* スケールラッパー */
    .scale-wrapper {
      transform-origin: top left;
      transform: scale(${scale});
      display: inline-block;
      margin: 0;
      padding: 0;
    }

    /* テーブルの基本設定を強制 */
    .map-table {
      border-collapse: collapse !important;
      page-break-inside: avoid !important;
      page-break-after: avoid !important;
      page-break-before: avoid !important;
    }

    .map-table td {
      border: 1px solid #333 !important;
      page-break-inside: avoid !important;
    }

    .map-table tr {
      page-break-inside: avoid !important;
      page-break-after: avoid !important;
    }

    /* 印刷時の調整 */
    @media print {
      html, body {
        margin: 0 !important;
        padding: 0 !important;
      }

      body {
        padding: 0 !important;
        display: block !important;
      }

      .scale-wrapper {
        page-break-inside: avoid !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <div class="scale-wrapper">
    ${tableHTML}
  </div>
</body>
</html>
  `;
}

// ============================================================
// 旧処理（互換性のため残す - 使用していません）
// ============================================================

// ============================================================
// 旧処理（互換性のため残す - 使用していません）
// ============================================================

/**
 * 印刷前の準備を行う（旧処理 - 現在は使用していません）
 */
function preparePrint() {
  window.pdfIsPrintPreparing = true;

  // 非表示にする要素のセレクタ
  const hideSelectors = [
    ".collapsible-panel", // 設定パネル
    ".map-toolbar", // マップツールバー
    "nav", // ナビゲーション
    ".tab-buttons", // タブボタン
    "footer", // フッター
    ".sidebar", // サイドバー（存在する場合）
  ];

  // 各要素に print-hide クラスを追加
  hideSelectors.forEach((selector) => {
    const elements = document.querySelectorAll(selector);
    elements.forEach((element) => {
      element.classList.add("print-hide");
    });
  });

  // マップコンテナに印刷モードクラスを追加
  const mapContainer = document.querySelector(".map-tab-container");
  if (mapContainer) {
    mapContainer.classList.add("print-mode");
    mapContainer.style.pageBreakInside = "avoid";
    mapContainer.style.pageBreakAfter = "avoid";
  }

  // マップグリッドコンテナに印刷モードクラスを追加
  const gridContainer = document.querySelector(".map-grid-container");
  if (gridContainer) {
    gridContainer.classList.add("print-mode");
    gridContainer.style.pageBreakInside = "avoid";
    gridContainer.style.pageBreakAfter = "avoid";
  }

  // マップテーブルに1ページ化の強制スタイルを追加
  const mapTable = document.querySelector(".map-table");
  if (mapTable) {
    mapTable.style.pageBreakInside = "avoid";
    mapTable.style.pageBreakAfter = "avoid";
    mapTable.style.pageBreakBefore = "avoid";

    // tbody にも適用
    const tbody = mapTable.querySelector("tbody");
    if (tbody) {
      tbody.style.pageBreakInside = "avoid";
      tbody.style.pageBreakAfter = "avoid";
    }

    // 全ての tr にも適用
    const rows = mapTable.querySelectorAll("tr");
    rows.forEach((row) => {
      row.style.pageBreakInside = "avoid";
      row.style.pageBreakAfter = "avoid";
    });

    // マップを1ページに収めるための自動縮小
    calculateAndApplyScale(mapTable);
  }
}

/**
 * マップのサイズを計算して自動的に縮小率を適用（旧処理 - 現在は使用していません）
 */
function calculateAndApplyScale(mapTable) {
  // マップの実際のサイズを取得
  const mapWidth = mapTable.offsetWidth;
  const mapHeight = mapTable.offsetHeight;

  // 印刷可能領域のサイズを推定（A4横向きを基準、余白を考慮）
  // A4横向き: 297mm x 210mm = 約1123px x 794px（96dpi）
  // 余白を引いた印刷可能領域: 約1073px x 744px（余白各5mm）
  const printableWidth = 1073; // px
  const printableHeight = 744; // px

  // 縮小率を計算（幅と高さの両方を考慮し、小さい方を採用）
  const scaleX = printableWidth / mapWidth;
  const scaleY = printableHeight / mapHeight;
  const scale = Math.min(scaleX, scaleY, 1); // 1を超えないようにする（拡大しない）

  // 縮小が必要な場合のみ適用
  if (scale < 1) {
    // ラッパー要素を作成してスケール適用
    const wrapper = document.createElement("div");
    wrapper.style.transformOrigin = "top left";
    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.display = "inline-block";
    wrapper.className = "print-scale-wrapper";

    // マップテーブルをラッパーで囲む
    mapTable.parentNode.insertBefore(wrapper, mapTable);
    wrapper.appendChild(mapTable);

    // ラッパーのサイズを調整（縮小後のサイズに合わせる）
    wrapper.style.width = `${mapWidth}px`;
    wrapper.style.height = `${mapHeight}px`;

    // 縮小率を保存（クリーンアップ時に使用）
    mapTable.setAttribute("data-scale-applied", scale);
  }
}

/**
 * 印刷ダイアログを表示する（旧処理 - 現在は使用していません）
 */
function executePrint() {
  // 印刷ダイアログを表示
  window.print();

  // 印刷ダイアログが閉じられた後にクリーンアップ
  // （印刷完了/キャンセルを検知）
  setTimeout(() => {
    cleanupPrint();
  }, 1000);
}

/**
 * 印刷後のクリーンアップを行う（旧処理 - 現在は使用していません）
 */
function cleanupPrint() {
  // print-hide クラスを持つ全要素からクラスを削除
  const hideElements = document.querySelectorAll(".print-hide");
  hideElements.forEach((element) => {
    element.classList.remove("print-hide");
  });

  // print-mode クラスを持つ全要素からクラスを削除
  const printModeElements = document.querySelectorAll(".print-mode");
  printModeElements.forEach((element) => {
    element.classList.remove("print-mode");
  });

  // インラインスタイルを削除
  const mapContainer = document.querySelector(".map-tab-container");
  if (mapContainer) {
    mapContainer.style.pageBreakInside = "";
    mapContainer.style.pageBreakAfter = "";
  }

  const gridContainer = document.querySelector(".map-grid-container");
  if (gridContainer) {
    gridContainer.style.pageBreakInside = "";
    gridContainer.style.pageBreakAfter = "";
  }

  // スケールラッパーを削除してマップテーブルを元の位置に戻す
  const wrapper = document.querySelector(".print-scale-wrapper");
  if (wrapper) {
    const mapTable = wrapper.querySelector(".map-table");
    if (mapTable) {
      // data-scale-applied属性を削除
      mapTable.removeAttribute("data-scale-applied");

      // テーブルをラッパーの親要素に戻す
      wrapper.parentNode.insertBefore(mapTable, wrapper);

      // インラインスタイルをクリア
      mapTable.style.pageBreakInside = "";
      mapTable.style.pageBreakAfter = "";
      mapTable.style.pageBreakBefore = "";

      const tbody = mapTable.querySelector("tbody");
      if (tbody) {
        tbody.style.pageBreakInside = "";
        tbody.style.pageBreakAfter = "";
      }

      const rows = mapTable.querySelectorAll("tr");
      rows.forEach((row) => {
        row.style.pageBreakInside = "";
        row.style.pageBreakAfter = "";
      });
    }

    // ラッパーを削除
    wrapper.remove();
  } else {
    // ラッパーがない場合でもテーブルのスタイルをクリア
    const mapTable = document.querySelector(".map-table");
    if (mapTable) {
      mapTable.style.pageBreakInside = "";
      mapTable.style.pageBreakAfter = "";
      mapTable.style.pageBreakBefore = "";

      const tbody = mapTable.querySelector("tbody");
      if (tbody) {
        tbody.style.pageBreakInside = "";
        tbody.style.pageBreakAfter = "";
      }

      const rows = mapTable.querySelectorAll("tr");
      rows.forEach((row) => {
        row.style.pageBreakInside = "";
        row.style.pageBreakAfter = "";
      });
    }
  }

  // フラグをリセット
  window.pdfIsPrintPreparing = false;
}

// ============================================================
// ユーティリティ関数
// ============================================================

/**
 * 現在の日時を取得する（ファイル名用）
 *
 * @returns {string} YYYY-MM-DD_HH-mm-ss 形式の文字列
 *
 * 【使用例】
 * getCurrentDateTime() → "2026-01-30_14-30-45"
 */
function getCurrentDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * PDFファイル名を生成する
 *
 * @returns {string} ファイル名（例：map_2026-01-30_14-30-45.pdf）
 */
function generatePDFFilename() {
  const mapName =
    document.querySelector(".map-selector select option:checked")
      ?.textContent || "map";
  const dateTime = getCurrentDateTime();
  return `${mapName}_${dateTime}.pdf`;
}

// ============================================================
// イベントリスナー
// ============================================================

/**
 * 印刷後のイベントを監視
 *
 * afterprint イベントで確実にクリーンアップを実行
 */
if (window.matchMedia) {
  const mediaQueryList = window.matchMedia("print");
  mediaQueryList.addListener((mql) => {
    if (!mql.matches) {
      // 印刷モードから通常モードに戻った
      cleanupPrint();
    }
  });
}

// ブラウザの afterprint イベント
window.addEventListener("afterprint", () => {
  cleanupPrint();
});
