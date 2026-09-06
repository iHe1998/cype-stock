<#
.SYNOPSIS
  Arma una version de un solo archivo HTML, autocontenida y offline.

.DESCRIPTION
  Toma index.html y le mete adentro el CSS, las librerias de lib/ y todos los
  modulos de js/. El resultado es un unico .html que funciona con doble clic,
  desde un pendrive y sin conexion a internet.

.PARAMETER Demo
  Genera ademas dist/vlm-stock-demo.html, que arranca con los datos de ejemplo
  ya cargados (util para mostrarlo sin tener que subir una planilla).

.EXAMPLE
  .\build.ps1
  .\build.ps1 -Demo
#>
[CmdletBinding()]
param([switch]$Demo)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'

# Orden de carga: las librerias van antes que los modulos de la app.
$libs    = @('xlsx.full.min.js', 'chart.umd.min.js')
$modulos = @('util', 'store', 'parser', 'analytics', 'charts', 'views', 'tv', 'app')

function Read-Utf8($ruta) {
  if (-not (Test-Path $ruta)) { throw "No se encontro el archivo: $ruta" }
  return [System.IO.File]::ReadAllText($ruta, [System.Text.Encoding]::UTF8)
}

function Write-Utf8($ruta, $texto) {
  $sinBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ruta, $texto, $sinBom)
}

Write-Host "Compilando desde $root" -ForegroundColor Cyan

$html = Read-Utf8 (Join-Path $root 'index.html')

# --- CSS ---
$css  = Read-Utf8 (Join-Path $root 'css\styles.css')
$tag  = '<link rel="stylesheet" href="css/styles.css">'
if ($html -notlike "*$tag*") { throw "No se encontro el <link> del CSS en index.html" }
$html = $html.Replace($tag, "<style>`n$css`n</style>")
Write-Host "  + css/styles.css"

# --- librerias + modulos ---
foreach ($l in $libs) {
  $js  = Read-Utf8 (Join-Path $root "lib\$l")
  $tag = "<script src=`"lib/$l`"></script>"
  if ($html -notlike "*$tag*") { throw "No se encontro el <script> de lib/$l en index.html" }
  $html = $html.Replace($tag, "<script>`n$js`n</script>")
  Write-Host "  + lib/$l"
}
foreach ($m in $modulos) {
  $js  = Read-Utf8 (Join-Path $root "js\$m.js")
  $tag = "<script src=`"js/$m.js`"></script>"
  if ($html -notlike "*$tag*") { throw "No se encontro el <script> de js/$m.js en index.html" }
  $html = $html.Replace($tag, "<script>`n$js`n</script>")
  Write-Host "  + js/$m.js"
}

# --- control: no puede quedar ninguna referencia externa ---
if ($html -match '<script src=' -or $html -match '<link rel="stylesheet"') {
  throw "Quedaron referencias externas sin embeber. Revisa las listas \$libs / \$modulos."
}

New-Item -ItemType Directory -Force $dist | Out-Null

$salida = Join-Path $dist 'vlm-stock.html'
Write-Utf8 $salida $html
$kb = [math]::Round((Get-Item $salida).Length / 1KB)
Write-Host "`n  -> dist\vlm-stock.html  ($kb KB)" -ForegroundColor Green

if ($Demo) {
  $auto = @'
<script>
/* build -Demo: carga los datos de ejemplo al abrir */
window.addEventListener('load', function () {
  setTimeout(function () {
    if (window.VLM && VLM.store && !VLM.store.hayDatos()) VLM.app.cargarDemo();
  }, 60);
});
</script>
</body>
'@
  # OJO: no usar .Replace() aca. SheetJS incluye el literal "</body>" en su
  # codigo de parseo de HTML, asi que un reemplazo global inyecta el script
  # adentro de la libreria y la rompe. Solo la ultima ocurrencia es la real.
  $cierre = '</body>'
  $i = $html.LastIndexOf($cierre)
  if ($i -lt 0) { throw "No se encontro </body> en index.html" }
  $htmlDemo = $html.Substring(0, $i) + $auto + $html.Substring($i + $cierre.Length)

  $salidaDemo = Join-Path $dist 'vlm-stock-demo.html'
  Write-Utf8 $salidaDemo $htmlDemo
  $kbd = [math]::Round((Get-Item $salidaDemo).Length / 1KB)
  Write-Host "  -> dist\vlm-stock-demo.html  ($kbd KB)" -ForegroundColor Green
}

Write-Host "`nListo. Copia el archivo a un pendrive y abrilo con doble clic." -ForegroundColor Cyan
