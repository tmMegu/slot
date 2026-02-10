// 開閉パネル（グローバルスコープで定義 - HTMLから直接呼び出すため最初に定義）
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

// タブ切り替え
function switchTab(tabName) {
  // すべてのタブコンテンツを非表示
  const contents = document.querySelectorAll(".tab-content");
  contents.forEach((content) => {
    content.classList.remove("active");
  });

  // すべてのタブボタンを非アクティブ
  const buttons = document.querySelectorAll(".tab-button");
  buttons.forEach((button) => {
    button.classList.remove("active");
  });

  // 選択されたタブを表示
  const selectedContent = document.getElementById("tab-" + tabName);
  if (selectedContent) {
    selectedContent.classList.add("active");
  }

  // 選択されたボタンをアクティブ
  const selectedButton = event?.target;
  if (selectedButton) {
    selectedButton.classList.add("active");
  }

  // マップタブの場合、初期化を実行
  if (tabName === "map" && window.currentMapId) {
    setTimeout(() => {
      initializeMap(window.hallId, window.currentMapId, window.currentDate);
    }, 100);
  }
}

// ページロード時にハッシュがあればそのタブを開く
document.addEventListener("DOMContentLoaded", function () {
  const hash = window.location.hash.substring(1);
  if (hash && document.getElementById(`tab-${hash}`)) {
    switchTab(hash);
  }
  // サーバーサイドで既にアクティブなタブが設定されているので、
  // ここでは何もしない（すでにHTMLにactiveクラスが設定されている）
});

// 表示日数の複数選択
function selectPreset(preset) {
  const checkboxes = document.querySelectorAll(
    '.day-checkbox-group input[type="checkbox"]',
  );

  checkboxes.forEach((cb) => (cb.checked = false));

  switch (preset) {
    case "1-8":
      for (let i = 1; i <= 8; i++) {
        const checkbox = document.getElementById(`day-${i}`);
        if (checkbox) checkbox.checked = true;
      }
      break;
    case "7-7":
      const day7 = document.getElementById("day-7");
      if (day7) day7.checked = true;
      break;
    case "1-31":
      for (let i = 1; i <= 31; i++) {
        const checkbox = document.getElementById(`day-${i}`);
        if (checkbox) checkbox.checked = true;
      }
      break;
  }
}

// アクティブなタブを取得する関数
function getActiveTab() {
  const activeButton = document.querySelector(".tab-button.active");
  return activeButton ? activeButton.getAttribute("data-tab") : "list";
}

// ソートセレクトボックスから更新する関数（非同期版）
function updateSort() {
  const sortBy = document.getElementById("sort-select").value;
  const sortOrder = document.getElementById("sort-order").value;

  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("sort_by", sortBy);
  currentUrl.searchParams.set("sort_order", sortOrder);
  currentUrl.searchParams.set("format", "json");

  const tbody = document.querySelector("#tab-list tbody");

  fetch(currentUrl.toString(), {
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => {
      // レスポンスのコンテンツタイプをチェック
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(
          "サーバーがJSONを返していません。HTMLが返された可能性があります。",
        );
      }
      return response.json().then((data) => ({ data, ok: response.ok }));
    })
    .then(({ data, ok }) => {
      if (!ok && data.error) {
        // サーバーエラーの詳細を表示
        console.error("サーバーエラー:", data.error);
        if (data.backtrace) {
          console.error("バックトレース:", data.backtrace);
        }
        throw new Error(data.error);
      }
      if (data.html) {
        // テーブルのtbody部分のみを更新
        if (tbody) {
          tbody.innerHTML = data.html;
        }
        // ソート矢印を更新
        updateSortArrows(sortBy, sortOrder);
        // URLのパラメータを更新（ブラウザ履歴に追加せずに）
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("sort_by", sortBy);
        newUrl.searchParams.set("sort_order", sortOrder);
        window.history.replaceState({}, "", newUrl.toString());
      }
    })
    .catch((error) => {
      console.error("ソートエラー:", error);
      console.error("リクエストURL:", currentUrl.toString());
      // エラー時は従来通りページ再読み込み
      const fallbackUrl = currentUrl
        .toString()
        .replace("&format=json", "")
        .replace("format=json&", "")
        .replace("format=json", "");
      window.location.href = fallbackUrl;
    });
}

// theadのソート矢印を更新する関数
function updateSortArrows(sortBy, sortOrder) {
  // 全てのsortableヘッダーからsort-asc/sort-descクラスを削除
  const headers = document.querySelectorAll("#tab-list th.sortable");
  headers.forEach((header) => {
    header.classList.remove("sort-asc", "sort-desc");
  });

  // 現在のソート列に矢印クラスを追加
  const currentHeader = document.querySelector(
    `#tab-list th.sortable[onclick*="${sortBy}"]`,
  );
  if (currentHeader) {
    currentHeader.classList.add(`sort-${sortOrder}`);
  }
}

// グローバルスコープに明示的に登録（onclick属性から呼び出すため）
window.sort = function (sortBy) {
  const currentUrl = new URL(window.location.href);
  const currentSort = currentUrl.searchParams.get("sort_by");
  const currentOrder = currentUrl.searchParams.get("sort_order");

  let newOrder = "asc";

  // 同じ列をもう一度クリックしたら順序を反転
  if (currentSort === sortBy && currentOrder === "asc") {
    newOrder = "desc";
  }

  currentUrl.searchParams.set("sort_by", sortBy);
  currentUrl.searchParams.set("sort_order", newOrder);
  currentUrl.searchParams.set("format", "json");

  const tbody = document.querySelector("#tab-list tbody");

  fetch(currentUrl.toString(), {
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => {
      // レスポンスのコンテンツタイプをチェック
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(
          "サーバーがJSONを返していません。HTMLが返された可能性があります。",
        );
      }
      return response.json().then((data) => ({ data, ok: response.ok }));
    })
    .then(({ data, ok }) => {
      if (!ok && data.error) {
        // サーバーエラーの詳細を表示
        console.error("サーバーエラー:", data.error);
        if (data.backtrace) {
          console.error("バックトレース:", data.backtrace);
        }
        throw new Error(data.error);
      }
      if (data.html) {
        // テーブルのtbody部分のみを更新
        if (tbody) {
          tbody.innerHTML = data.html;
        }
        // theadのソート矢印を更新
        updateSortArrows(sortBy, newOrder);
        // URLのパラメータを更新（ブラウザ履歴に追加せずに）
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("sort_by", sortBy);
        newUrl.searchParams.set("sort_order", newOrder);
        window.history.replaceState({}, "", newUrl.toString());
      }
    })
    .catch((error) => {
      console.error("ソートエラー:", error);
      console.error("リクエストURL:", currentUrl.toString());
      // エラー時は従来通りページ再読み込み
      const fallbackUrl = currentUrl
        .toString()
        .replace("&format=json", "")
        .replace("format=json&", "")
        .replace("format=json", "");
      window.location.href = fallbackUrl;
    });
};

function resetSort() {
  const currentUrl = new URL(window.location);
  currentUrl.searchParams.delete("sort_by");
  currentUrl.searchParams.delete("sort_order");
  currentUrl.searchParams.set("format", "json");

  const tbody = document.querySelector("#tab-list tbody");

  fetch(currentUrl.toString(), {
    headers: {
      Accept: "application/json",
    },
  })
    .then((response) => {
      // レスポンスのコンテンツタイプをチェック
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(
          "サーバーがJSONを返していません。HTMLが返された可能性があります。",
        );
      }
      return response.json().then((data) => ({ data, ok: response.ok }));
    })
    .then(({ data, ok }) => {
      if (!ok && data.error) {
        // サーバーエラーの詳細を表示
        console.error("サーバーエラー:", data.error);
        if (data.backtrace) {
          console.error("バックトレース:", data.backtrace);
        }
        throw new Error(data.error);
      }
      if (data.html) {
        // テーブルのtbody部分のみを更新
        if (tbody) {
          tbody.innerHTML = data.html;
        }
        // ソート矢印をリセット（デフォルトの台番号昇順）
        updateSortArrows("machine_no", "asc");
        // URLのパラメータを更新（ブラウザ履歴に追加せずに）
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete("sort_by");
        newUrl.searchParams.delete("sort_order");
        window.history.replaceState({}, "", newUrl.toString());
      }
    })
    .catch((error) => {
      console.error("リセットエラー:", error);
      console.error("リクエストURL:", currentUrl.toString());
      // エラー時は従来通りページ再読み込み
      const fallbackUrl = currentUrl
        .toString()
        .replace("&format=json", "")
        .replace("format=json&", "")
        .replace("format=json", "");
      window.location.href = fallbackUrl;
    });
}

function resetFilter() {
  const currentUrl = new URL(window.location);
  Array.from(currentUrl.searchParams.keys()).forEach((key) => {
    if (key.startsWith("filter_")) {
      currentUrl.searchParams.delete(key);
    }
  });

  // active_tabを保持
  const activeTab = currentUrl.searchParams.get("active_tab") || getActiveTab();
  if (activeTab) {
    currentUrl.searchParams.set("active_tab", activeTab);
  }

  window.location.href = currentUrl.toString();
}

function changeDate(newDate, hallId) {
  const baseUrl = `/halls/${hallId}/dates/${newDate}`;

  // 現在のクエリパラメータを保持
  const currentUrl = new URL(window.location.href);
  const queryParams = new URLSearchParams(currentUrl.search);

  // dateパラメータを削除
  queryParams.delete("date");

  // クエリストリングを構築
  const queryString = queryParams.toString();
  const newUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  window.location.href = newUrl;
}

function changeDateRange(days) {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set("date_range", days);

  // active_tabを保持
  const activeTab = currentUrl.searchParams.get("active_tab") || getActiveTab();
  if (activeTab) {
    currentUrl.searchParams.set("active_tab", activeTab);
  }

  window.location.href = currentUrl.toString();
}

// 日付選択モードの切り替え
function toggleDateSelectionMode(mode) {
  const presetSelector = document.getElementById("preset-selector");
  const customSelector = document.getElementById("custom-date-selector");

  if (mode === "preset") {
    if (presetSelector) presetSelector.style.display = "flex";
    if (customSelector) customSelector.style.display = "none";
  } else if (mode === "custom") {
    if (presetSelector) presetSelector.style.display = "none";
    if (customSelector) customSelector.style.display = "block";
  }
}

function clearAllDays() {
  const checkboxes = document.querySelectorAll(
    '.day-checkbox-group input[type="checkbox"]',
  );
  checkboxes.forEach((cb) => (cb.checked = false));
}

// メモの一括保存（台データ一覧用）
function saveMemos() {
  const memoInputs = document.querySelectorAll(".memo-input");
  const hallId = window.location.pathname.split("/")[2];
  const dateMatch = window.location.pathname.match(/\/dates\/([^\/]+)/);
  const date = dateMatch ? dateMatch[1] : null;

  // デバッグ情報
  console.log("saveMemos - pathname:", window.location.pathname);
  console.log("saveMemos - hallId:", hallId);
  console.log("saveMemos - date:", date);

  if (!date) {
    alert("日付情報が取得できません");
    return;
  }

  const url = `/halls/${hallId}/dates/${date}/update_machine_memos`;
  console.log("saveMemos - URL:", url);
  const formData = new FormData();

  // 変更されたメモのみを収集
  let changedCount = 0;
  memoInputs.forEach((input) => {
    const machineNumber = input.getAttribute("data-machine-number");
    const currentValue = input.value;
    const originalValue = input.getAttribute("data-original-value") || "";

    // 値が変更されている場合のみ追加
    if (currentValue !== originalValue) {
      formData.append(`memos[${machineNumber}]`, currentValue);
      changedCount++;
    }
  });

  // 変更がない場合は処理を中断
  if (changedCount === 0) {
    alert("変更されたメモはありません");
    return;
  }

  console.log(`saveMemos - 変更件数: ${changedCount}件`);

  formData.append(
    "authenticity_token",
    document.querySelector('meta[name="csrf-token"]')?.content || "",
  );

  fetch(url, {
    method: "POST",
    body: formData,
    headers: {
      "X-CSRF-Token":
        document.querySelector('meta[name="csrf-token"]')?.content || "",
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        // 成功時、元の値を現在の値で更新
        memoInputs.forEach((input) => {
          const currentValue = input.value;
          const originalValue = input.getAttribute("data-original-value") || "";
          if (currentValue !== originalValue) {
            input.setAttribute("data-original-value", currentValue);
          }
        });
        // 成功メッセージは表示しない（静かに更新）
      } else {
        alert("エラーが発生しました: " + (data.error || "不明なエラー"));
      }
    })
    .catch((error) => {
      console.error("Error:", error);
      alert("エラーが発生しました: " + error.message);
    });
}
