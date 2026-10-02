# Measure whether the one-pager fits a single A4 page, and how each column
# balances. Renders the HTML in headless Chrome and reports back overflow in
# pixels plus the used height of each macro column.
$src = "C:\Users\Parth Gupta\Desktop\Navika\docs\navika-onepager.html"
$m = "C:\Users\Parth Gupta\Desktop\Navika\docs\_measure.html"

$inject = @'
<div id="MRES">PENDING</div><script>
var p = document.querySelector(".page");
var cols = Array.prototype.map.call(document.querySelectorAll(".col"), function(c, i) {
  return "COL" + (i + 1) + "_MM=" + (c.getBoundingClientRect().height * 25.4 / 96).toFixed(1);
});
var gap = p.scrollHeight - p.clientHeight;
document.getElementById("MRES").textContent =
  "RESULT_OV_PX=" + gap +
  "@@OVER_MM=" + (gap * 25.4 / 96).toFixed(1) +
  "@@USED_MM=" + ((p.scrollHeight - 12 * 96 / 25.4) * 25.4 / 96).toFixed(1) +
  "@@A4_MM=297@@" + cols.join("@@");
</script>
'@

$html = Get-Content $src -Raw
$html = $html -replace '</body>', ($inject + "`n</body>")
Set-Content -Path $m -Value $html -Encoding UTF8

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$dom = (& $chrome --headless=new --disable-gpu --no-sandbox --virtual-time-budget=8000 --window-size=794,1123 --dump-dom ([System.Uri]$m).AbsoluteUri 2>$null | Out-String)

if ($dom -match '<div id="MRES">RESULT_OV_PX=([\s\S]*?)</div>') {
  $matches[1] -replace '@@', "`n"
} else {
  Write-Output "NOT CAPTURED"
}
