# VLM Stock · Panel de control

Panel web para visualizar el **stock de una torre de picking vertical (VLM)** a partir de una
planilla Excel. Pensado para quedar proyectado en un televisor del depósito y que el equipo
vea de un vistazo qué hay que reponer.

- 📊 Gráficos de stock, consumo y proyección
- 🏭 Agrupación por **laboratorio**
- 🔴 Marca los productos **próximos a vaciarse** y los ya agotados
- 📅 Calcula **días de cobertura** y la **fecha estimada de quiebre**
- 📺 **Modo TV**: pantallas rotativas a gran escala
- 📥 Importa `.xlsx` / `.xls` / `.csv` con **detección automática de columnas**

Sin backend, sin build, sin dependencias que instalar: es HTML + CSS + JS.

---

## Cómo usarlo

### Local
Abrí `index.html` con doble clic. Listo.
(Necesita conexión a internet la primera vez para bajar las librerías de CDN.)

### En la tele del trabajo
1. Publicalo en GitHub Pages (ver más abajo).
2. Abrí la URL en el navegador de la TV o de la PC conectada a la TV.
3. Botón **Modo TV** → `F11` para pantalla completa.

Los datos quedan guardados en el navegador (`localStorage`), así que si se corta la luz
y vuelve, la pantalla se recupera sola con la última planilla cargada.

**Atajos del modo TV:** `Esc` salir · `←` / `→` cambiar pantalla · `Espacio` pausar.

---

## Formato de la planilla

La app **detecta las columnas sola** y muestra un asistente de mapeo antes de importar,
así que no hace falta que la planilla tenga nombres exactos. Reconoce variantes comunes
en español (`Artículo`, `Existencia`, `Punto de Pedido`, `Salidas Mes`, `Proveedor`, …),
tolera acentos, filas de título arriba del encabezado y números en formato `1.234,56`.

| Campo | Obligatorio | Ejemplos de encabezado que reconoce |
|---|---|---|
| Código / SKU | ✅ | Codigo, SKU, Artículo, Referencia |
| Descripción | ✅ | Descripcion, Producto, Denominación |
| Laboratorio | ✅ | Laboratorio, Lab, Proveedor, Marca |
| Stock actual | ✅ | Stock, Cantidad, Existencia, Saldo |
| Ubicación | — | Ubicacion, Bandeja, Charola, Posición |
| Stock mínimo | — | Minimo, Punto de Pedido, Stock Min |
| Stock máximo | — | Maximo, Capacidad |
| Consumo diario | — | Consumo Diario, Promedio Diario |
| Consumo mensual | — | Consumo Mensual, Salidas Mes, Demanda Mensual |
| Lote | — | Lote, Partida, Batch |
| Vencimiento | — | Vencimiento, Vto, Caducidad |
| Precio unitario | — | Precio, Costo, Valor Unitario |

> Para que funcionen los **días de cobertura** y la **proyección** hace falta al menos una
> columna de consumo (diaria o mensual). Sin ella la app igual muestra el stock, pero no
> puede anticipar cuándo se vacía.

Hay una planilla de ejemplo en [`data/plantilla_vlm.csv`](data/plantilla_vlm.csv), y desde la
pantalla inicial podés **descargar la plantilla en `.xlsx`**.

---

## Cómo calcula las alertas

```
consumo diario   = consumo diario  ó  consumo mensual / 30
días de cobertura = stock / consumo diario
fecha de quiebre  = hoy + días de cobertura
a reponer         = objetivo - stock       (objetivo = consumo diario × días objetivo,
                                            acotado por el stock máximo)
```

El **estado** de cada producto es el peor de dos criterios:

| Estado | Por cobertura | Por stock mínimo |
|---|---|---|
| 🔴 Agotado | stock = 0 | stock = 0 |
| 🔴 Crítico | ≤ 7 días | stock ≤ mínimo |
| 🟡 Bajo | ≤ 15 días | stock ≤ mínimo × 1,5 |
| 🟢 OK | > 15 días | > mínimo × 1,5 |
| 🟣 Exceso | — | stock > máximo |

Todos los umbrales se cambian desde **⚙ Configuración**.

---

## Publicar en GitHub Pages

```bash
git remote add origin https://github.com/TU-USUARIO/vlm-stock.git
git branch -M main
git push -u origin main
```

Después, en el repo: **Settings → Pages → Source: `Deploy from a branch` → `main` / `/ (root)`**.
En un par de minutos queda en `https://TU-USUARIO.github.io/vlm-stock/`.

---

## Estructura

```
index.html            estructura y modales
css/styles.css        sistema de diseño (tema oscuro/claro, modo TV)
js/util.js            formateo de números y fechas, colores, helpers
js/store.js           estado global, configuración y persistencia
js/parser.js          lectura de Excel, detección y mapeo de columnas
js/analytics.js       cobertura, criticidad, proyecciones y agregados
js/charts.js          gráficos (Chart.js)
js/views.js           las cuatro vistas
js/tv.js              modo televisor
js/app.js             arranque, navegación, asistente de importación
data/                 planilla de ejemplo
```

Librerías por CDN: [SheetJS](https://sheetjs.com) para leer Excel y
[Chart.js](https://www.chartjs.org) para los gráficos.

---

## Próximos pasos

- [ ] Calcular el consumo real desde un **historial de movimientos** en vez de un promedio fijo
- [ ] Guardar histórico de importaciones para ver la **tendencia** del stock
- [ ] Conectar directo al **WMS / ERP** del VLM en vez de subir la planilla a mano
- [ ] Auto-refresco leyendo un archivo desde una carpeta de red
- [ ] Alertas por mail o Telegram cuando algo entra en crítico
