// マップ新規作成画面のスクリプト

function updatePreview() {
  const rows =
    parseInt(document.querySelector('[name="hall_map[rows]"]').value) || 20;
  const cols =
    parseInt(document.querySelector('[name="hall_map[cols]"]').value) || 40;
  const preview = document.getElementById("grid-preview");

  const previewRows = Math.min(rows, 20);
  const previewCols = Math.min(cols, 40);

  let html = '<table class="preview-table">';
  for (let r = 1; r <= previewRows; r++) {
    html += "<tr>";
    for (let c = 1; c <= previewCols; c++) {
      html += "<td></td>";
    }
    html += "</tr>";
  }
  html += "</table>";

  preview.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", function () {
  updatePreview();

  document
    .querySelector('[name="hall_map[rows]"]')
    .addEventListener("input", updatePreview);
  document
    .querySelector('[name="hall_map[cols]"]')
    .addEventListener("input", updatePreview);
});
