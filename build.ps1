<#
.SYNOPSIS
  Arma una version de un solo archivo HTML, autocontenida y offline.

.DESCRIPTION
  Toma index.html y le mete adentro el CSS, las librerias de lib/ y todos los
  modulos de js/. El resultado es un unico .html que funciona con doble clic,
  desde un pendrive y sin conexion a internet.

.PARAMETER Demo
  Genera ademas dist/cype-stock-demo.html, que arranca con los datos de ejemplo
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
$modulos = @('config', 'util', 'nube', 'labs', 'ubicaciones', 'store', 'parser', 'asistente', 'analytics', 'charts', 'views', 'tv', 'app')

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

# --- sello de version ---
# Sin esto no hay forma de saber que copia del .html esta abriendo alguien:
# los file:// comparten localStorage, asi que una version vieja en Descargas
# se ve igual que la nueva y trabaja sobre los mismos datos guardados.
$fecha = Get-Date -Format 'dd/MM/yyyy HH:mm'
$commit = '?'
try { $commit = (& git -C $root rev-parse --short HEAD 2>$null) } catch {}
if (-not $commit) { $commit = '?' }
# El texto a reemplazar va sin acentos a proposito: PowerShell 5.1 lee los
# .ps1 como ANSI, no como UTF-8, y un literal con acentos no matchearia el
# del HTML (que si es UTF-8).
$sello = "compilado $fecha - $commit"
$marca = '>build local<'
if ($html -notlike "*$marca*") { throw "No se encontro la marca de version ($marca) en index.html" }
$html = $html.Replace($marca, ">$sello<")
Write-Host "  sello: $sello"

# --- version.json, para la web ---
# El .html suelto lleva el sello adentro, pero la version de la web son los
# archivos del repo tal cual, sin sello. Sin este archivo una pantalla abierta
# no tiene forma de enterarse de que se publico algo nuevo: se queda con el
# codigo que cargo a la manana hasta que alguien apriete F5.
# El instante importa mas que el commit: cambia en cada compilada, asi que
# alcanza con comparar para saber que hay algo nuevo.
$ver = "{`"commit`":`"$commit`",`"compilado`":`"$fecha`"}"
[System.IO.File]::WriteAllText((Join-Path $root 'version.json'), $ver, (New-Object System.Text.UTF8Encoding $false))
Write-Host "  version.json: $ver"

# --- control: no puede quedar ninguna referencia externa ---
if ($html -match '<script src=' -or $html -match '<link rel="stylesheet"') {
  throw "Quedaron referencias externas sin embeber. Revisa las listas \$libs / \$modulos."
}

New-Item -ItemType Directory -Force $dist | Out-Null

$salida = Join-Path $dist 'cype-stock.html'
Write-Utf8 $salida $html
$kb = [math]::Round((Get-Item $salida).Length / 1KB)
Write-Host "`n  -> dist\cype-stock.html  ($kb KB)" -ForegroundColor Green

if ($Demo) {
  $auto = @'
<script>
/* build -Demo: carga los datos de ejemplo al abrir.
   Refresca tambien cuando lo guardado ya es una demo, para que este archivo
   muestre siempre el ejemplo de ESTA version y no el que quedo en el
   localStorage de una version anterior. Un import real sobrevive. */
window.addEventListener('load', function () {
  setTimeout(function () {
    var S = window.VLM && VLM.store;
    if (!S) return;
    if (!S.hayDatos() || S.state.meta.demo || S.state.meta.archivo === 'Datos de ejemplo') {
      VLM.app.cargarDemo();
    }
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

  $salidaDemo = Join-Path $dist 'cype-stock-demo.html'
  Write-Utf8 $salidaDemo $htmlDemo
  $kbd = [math]::Round((Get-Item $salidaDemo).Length / 1KB)
  Write-Host "  -> dist\cype-stock-demo.html  ($kbd KB)" -ForegroundColor Green
}

Write-Host "`nListo. Copia el archivo a un pendrive y abrilo con doble clic." -ForegroundColor Cyan
