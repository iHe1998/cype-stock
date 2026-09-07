# VLM Stock · Panel de control

Panel web para visualizar el **stock de una torre de picking vertical (VLM)** a partir de una
planilla Excel. Pensado para quedar proyectado en un televisor del depósito y que el equipo
vea de un vistazo qué hay que reponer.

- 📊 Gráficos de stock y del **consumo real del mes**
- 🏭 Catálogo cerrado de **laboratorios**, con los de fuera separados y contados
- ❄️ Separa **cámara de frío** (2-8 °C) de **ambiente**, y **dentro** de **fuera del VLM**
- 🔴 Marca los productos **próximos a vaciarse** y los ya agotados
- 📅 Calcula **días de cobertura** y la **fecha estimada de quiebre**
- 📺 **Modo TV**: pantallas rotativas a gran escala
- 📥 Importa `.xlsx` / `.xls` / `.csv` con **detección automática de columnas**

Sin backend, sin dependencias que instalar y **sin conexión a internet**: es HTML + CSS + JS,
con las dos librerías que usa copiadas dentro del repo.

---

## Cómo usarlo

### Local
Abrí `index.html` con doble clic. Listo.

### En un pendrive (para presentar)
```powershell
.\build.ps1 -Demo
```
Genera `dist\vlm-stock.html`: **un solo archivo** con todo adentro (CSS, librerías y código).
Lo copiás a un pendrive, doble clic y funciona en cualquier PC con Windows, sin internet,
sin instalar nada y sin permisos de sistemas.

`-Demo` genera además `dist\vlm-stock-demo.html`, que arranca con datos de ejemplo cargados.

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
| Conservación | — | Conservacion, Cadena de Frío, Temperatura, Refrigerado |
| Consumo mensual | — | Consumo Mensual, Salidas Mes, Demanda Mensual |
| Lote | — | Lote, Partida, Batch |
| Vencimiento | — | Vencimiento, Vto, Caducidad |

> **No hace falta que la planilla traiga el consumo.** Si no lo trae, la app lo calcula
> sola restando importaciones sucesivas — ver la sección siguiente. Si lo trae, esa columna
> tiene prioridad.

Hay una planilla de ejemplo en [`data/plantilla_vlm.csv`](data/plantilla_vlm.csv), y desde la
pantalla inicial podés **descargar la plantilla en `.xlsx`**.

---

## Laboratorios, ámbito y conservación

Los productos se clasifican en dos dimensiones independientes, que se combinan
en cuatro cuadrantes: **VLM · Frío**, **VLM · Ambiente**, **Fuera · Frío**, **Fuera · Ambiente**.
La barra superior filtra por cualquiera de las dos y afecta a todas las vistas.

### Catálogo (editable en ⚙ Configuración)

| Laboratorio | Ámbito | Conservación por defecto |
|---|---|---|
| AstraZeneca | VLM | Ambiente |
| Roche | VLM | Frío |
| Sanofi Aventis | VLM | Ambiente |
| Amgen | VLM | Frío |
| Abbvie | Fuera del VLM | Frío |
| Biosidus Argentina | Fuera del VLM | Frío |

**Sólo se procesan los laboratorios del catálogo.** Los demás quedan fuera de KPIs y
gráficos, pero la app *dice cuántos son* en la barra superior — para que un nombre mal
escrito no desaparezca en silencio. Si querés verlos igual, hay un check en Configuración.

El matcheo es tolerante: reconoce razones sociales completas. `LAB. ROCHE S.A.Q. e I.`,
`SANOFI-AVENTIS ARGENTINA S.A.` y `ASTRA ZENECA ARGENTINA` caen en el laboratorio correcto.

### De dónde sale frío o ambiente

Se resuelve con esta prioridad:

1. **La columna de conservación de la planilla**, si existe. Entiende `Frío`, `Refrigerado`,
   `2-8°C`, `Termolábil`, `Heladera`, `Ambiente`, `15-25°C`, `Seco`. En una columna llamada
   `Cadena de frío`, un `SI`/`NO` también se interpreta bien.
2. **El valor por defecto del laboratorio**, según la tabla de arriba.
3. Si no hay ninguno de los dos: `Ambiente`.

Así un laboratorio puede tener productos en las dos zonas (Roche tiene los biológicos en
frío y Xeloda o Tamiflu en ambiente) y aparece en los dos cuadrantes.

---

## Historial de consumo

> **Desactivado por defecto.** Se prende en **⚙ Configuración → Historial de consumo**.
> Mientras esté apagado la app no guarda nada y el panel no lo menciona.

La planilla es una **foto del stock del momento**: dice cuánto hay, no cuánto salió.
Para saber el consumo real, la app **guarda un snapshot en cada importación** y resta.

```
consumo del día   = Σ  max(0, stock_ayer − stock_hoy)     por SKU
reposición        = Σ  max(0, stock_hoy − stock_ayer)     por SKU
consumo diario    = consumo acumulado / días transcurridos
```

Una baja de stock es consumo; una suba es reposición. Se cuentan por separado porque un
mismo SKU puede recibir mercadería y consumirse en el mismo intervalo — en ese caso la
diferencia **subestima** el consumo. Importando una vez por día el error es despreciable;
si pasás una semana entre importaciones, el número queda corto.

- Se necesitan **al menos 2 importaciones** para que aparezca cualquier cálculo de consumo.
- Dos importaciones el mismo día se pisan: vale la última.
- La primera importación real **descarta el historial de los datos de ejemplo**: si no, los
  SKU inventados desaparecerían de la planilla y contarían como un consumo enorme.
- Si dos importaciones consecutivas comparten menos de la mitad de los SKU, ese tramo se
  descarta en vez de inventar un consumo falso (pasa si cambia el formato del export).
- Se guardan hasta **60 snapshots**. Si el navegador se queda sin espacio, la app va
  descartando los más viejos antes que perder todo, y avisa.
- El historial se borra desde **⚙ Configuración → Historial de consumo**.

Este historial es además la **fuente del consumo diario** de cada SKU cuando la planilla
no trae una columna de consumo, y con eso salen los días de cobertura y la fecha de quiebre.

---

## Cómo calcula las alertas

```
consumo diario    = columna de la planilla  ó  promedio del historial
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
build.ps1             arma la versión de un solo archivo (dist/)
css/styles.css        sistema de diseño (tema oscuro/claro, modo TV)
js/util.js            formateo de números y fechas, colores, helpers
js/labs.js            catálogo de laboratorios, ámbito y conservación
js/store.js           estado global, configuración y persistencia
js/parser.js          lectura de Excel, detección y mapeo de columnas
js/analytics.js       cobertura, criticidad, historial de consumo y agregados
js/charts.js          gráficos (Chart.js)
js/views.js           las cuatro vistas
js/tv.js              modo televisor
js/app.js             arranque, navegación, asistente de importación
lib/                  SheetJS y Chart.js (ver lib/README.md)
data/                 planilla de ejemplo
dist/                 salida de build.ps1 — generado, no editar a mano
```

Librerías: [SheetJS](https://sheetjs.com) para leer Excel y
[Chart.js](https://www.chartjs.org) para los gráficos. Están **vendorizadas** en `lib/`
para que la app no dependa de un CDN — ver [`lib/README.md`](lib/README.md) para las
versiones y cómo actualizarlas.

---

## Próximos pasos

- [x] ~~Calcular el consumo real por diferencia entre importaciones~~
- [ ] Derivar el ámbito (VLM / fuera) de la **posición** en vez del laboratorio
- [ ] Exportar el historial de consumo a Excel
- [ ] Conectar directo al **WMS / ERP** del VLM en vez de subir la planilla a mano
- [ ] Auto-refresco leyendo un archivo desde una carpeta de red
- [ ] Alertas por mail o Telegram cuando algo entra en crítico

---

## Licencia

© 2026 Joel — Todos los derechos reservados.

Este proyecto es un **prototipo en evaluación** y todavía no tiene una licencia de código
abierto asignada. El código está publicado para poder demostrarlo, no para su reutilización:
sin una licencia explícita, no se otorga permiso para copiarlo, modificarlo ni distribuirlo.

Si te interesa usarlo, escribime.
