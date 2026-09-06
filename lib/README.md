# Librerías vendorizadas

Estas librerías están copiadas dentro del repo a propósito, para que la app
**funcione sin conexión a internet** (red del depósito restringida, proxy que
bloquea CDNs, PC sin salida a internet).

| Archivo | Librería | Versión | Origen |
|---|---|---|---|
| `xlsx.full.min.js` | [SheetJS](https://sheetjs.com) — lectura de Excel | 0.18.5 | `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js` |
| `chart.umd.min.js` | [Chart.js](https://www.chartjs.org) — gráficos | 4.4.1 | `https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js` |

Descargadas el 2026-09-06. No están modificadas.

## Cómo actualizarlas

```powershell
Invoke-WebRequest -UseBasicParsing `
  -Uri  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js' `
  -OutFile 'lib\xlsx.full.min.js'
```

Cambiá la versión en la URL, actualizá la tabla de arriba y volvé a correr
`.\build.ps1`. Después probá una importación real: SheetJS cambió de licencia y
de forma de distribución después de la 0.18.5, así que conviene verificar antes
de saltar de versión mayor.
