# VLM Stock · Panel de control

Panel web para visualizar el **stock de una torre de picking vertical (VLM)** a partir de una
planilla Excel. Pensado para quedar proyectado en un televisor del depósito y que el equipo
vea de un vistazo qué hay que reponer.

- 📊 Gráficos de stock, picking vs altura y estado por laboratorio
- 🏭 Catálogo cerrado de **laboratorios**, con los de fuera separados y contados
- ❄️ Separa **cámara de frío** (2-8 °C) de **ambiente**, y **dentro** de **fuera del VLM**
- 🔴 Marca las posiciones **próximas a vaciarse** por porcentaje de su capacidad
- 📦 Dice **de qué posición de altura bajar**, cruzando artículo, lote y Atributo02
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
| Descripción | — | Descripcion, Producto, Denominación |
| Laboratorio | ✅ | Laboratorio, Lab, Propietario, Marca |
| Stock físico | ✅ | Stock físico, Stock, Cantidad, Existencia |
| Disponible | — | Disponible, Cantidad disponible |
| Asignado | — | Asignado, Comprometido, Reservado |
| Ubicación | — | Ubicacion, Bandeja, Charola, Posición |
| Stock mínimo | — | Minimo, Punto de Pedido, Stock Min |
| Stock máximo | — | Maximo, Capacidad |
| Conservación | — | Conservacion, Cadena de Frío, Temperatura, Refrigerado |
| Lote | — | Lote, Partida, Batch |
| Lote secundario | — | Atributo02, Lote Proveedor |
| Vencimiento | — | Vencimiento, Vto, Caducidad |
| Estatus *(filtro)* | — | Estatus, Estado, Status |
| Atributo 07 *(filtro)* | — | Atributo 07 |

> El panel mira el día a día, no el stock a futuro: no hay proyección ni días de
> cobertura. Las alertas salen del **máximo por posición** (ver más abajo).

### Físico, disponible y asignado

El **físico** es lo que hay en la posición. El **disponible** ya tiene descontado lo que
los pedidos lanzados se van a llevar: de 200 unidades físicas con dos pedidos por 150, el
disponible es 50.

Los gráficos, los KPIs y los estados usan **siempre el físico** — el panel es para saber
qué reponer, y lo que se repone es lo que está en el estante. El disponible aparece sólo
al abrir un artículo (clic en cualquier fila del inventario o de la reposición), junto con
el desglose por lote.

### Filas que no entran

Las columnas **Estatus** y **Atributo 07** no se muestran en ningún lado: sólo filtran.
Entra la mercadería en `OK` con atributo 07 `1000`; el resto (bloqueada, en cuarentena,
en tránsito) se descarta y el aviso de importación dice cuántas filas fueron y por qué.
Si la planilla no trae esas columnas no se filtra nada.

### Filas repetidas del mismo lote

El mismo artículo y lote aparece en varias filas cuando el sistema lo tiene partido en
distintos **LPN**, aunque físicamente esté todo junto. El LPN no forma parte de la clave
de agrupación, así que esas filas se suman en una sola: se agrupa por **posición + lote +
Atributo 02**.

Hay una planilla de ejemplo en [`data/plantilla_vlm.csv`](data/plantilla_vlm.csv), y desde la
pantalla inicial podés **descargar la plantilla en `.xlsx`**.

---

## Laboratorios, ámbito y conservación

Los productos se clasifican en dos dimensiones independientes, que se combinan
en cuatro cuadrantes: **VLM · Frío**, **VLM · Ambiente**, **Fuera · Frío**, **Fuera · Ambiente**.
La barra superior filtra por cualquiera de las dos, más un tercer filtro por
**laboratorio**, y los tres afectan a todas las vistas — el resumen y sus gráficos
incluidos, así que se puede mirar el panel de un solo laboratorio. El desplegable muestra
cuántos SKU tiene cada uno y se pinta cuando hay uno elegido, para que no se lea el panel
creyendo que se ve el depósito entero.

### El SKU es el que manda

**Ni el ámbito ni la conservación salen del laboratorio.** Se deciden por artículo, en
este orden:

1. **¿El SKU aparece en alguna posición `VLMVENTA*`?** Si sí, es del VLM. Si no, es de
   afuera. AstraZeneca tiene artículos de los dos tipos, así que preguntárselo al
   laboratorio da la respuesta equivocada para la mitad.
2. **Recién ahí se leen sus otras ubicaciones**, y significan cosas distintas según lo
   anterior:

| El SKU está en… | `VLMVENTA01/02` | Nivel `100`/`150` de pasillo | Nivel `200`+ |
|---|---|---|---|
| **el VLM** | picking | **reserva** para rellenar la torre | reserva |
| **pasillo** | — | picking | reserva |

El nivel `100` es el caso que importa: en un artículo de pasillo es la posición desde la
que se sirve, y en uno del VLM es con lo que se rellena la torre. Sin la distinción, un
artículo del VLM mostraba un picking de pasillo que nadie usa.

> **Ejemplo real.** `4002905XAR` está en `VLMVENTA02` con 120 unidades, y además tiene
> `005023300` y `004023200`. Queda como **VLM · Ambiente**, con 120 en picking y el resto
> como reserva — y esas dos posiciones aparecen en la lista de reposición como el lugar de
> donde bajar la mercadería.

### Catálogo de laboratorios (editable en ⚙ Configuración)

AstraZeneca, Roche, Sanofi Aventis, Amgen, Abbvie y Biosidus Argentina. El catálogo dice
**cuáles** se procesan y cómo se llaman; nada más.

**Sólo se procesan los laboratorios del catálogo.** Los demás quedan fuera de KPIs y
gráficos, pero la app *dice cuántos son* en la barra superior — para que un nombre mal
escrito no desaparezca en silencio. Si querés verlos igual, hay un check en Configuración.

El matcheo es tolerante: reconoce razones sociales completas. `LAB. ROCHE S.A.Q. e I.`,
`SANOFI-AVENTIS ARGENTINA S.A.` y `ASTRA ZENECA ARGENTINA` caen en el laboratorio correcto.

### De dónde sale frío o ambiente

**De la posición**, que es donde está la mercadería:

1. **La columna de conservación de la planilla**, si existe. Entiende `Frío`, `Refrigerado`,
   `2-8°C`, `Termolábil`, `Heladera`, `Ambiente`, `15-25°C`, `Seco`. En una columna llamada
   `Cadena de frío`, un `SI`/`NO` también se interpreta bien.
2. **La regla de la posición de picking**: `VLMVENTA01` es frío, `VLMVENTA02` es ambiente,
   los pasillos `1xx` son cámara y los `0xx` ambiente.
3. Si ninguna regla la define: `Ambiente`, y la posición sale listada en el aviso de
   importación para que se note que le falta una regla.

Para un artículo del VLM manda **su cara de picking en la torre**: su reserva de pasillo no
vota. Uno que se sirve de `VLMVENTA01` sigue siendo frío aunque tenga miles de unidades
guardadas en un pasillo de ambiente.

Así un laboratorio aparece en los dos cuadrantes según dónde esté cada artículo, que es lo
que pasa en la realidad.

---

## Reglas de posición

La posición dice más que el laboratorio: si se pickea o es stock de altura, si está en
cámara o en ambiente, y si hay que ignorarla porque es una zona de tránsito.

Las posiciones numéricas son `PPPBBBNNN`:

```
010008100      104020250
||| ||| |||
||| ||| _ altura del rack: 100 y 150 se pickean
||| |||                    200 250 300 400 500 son altura
||| _____ posición dentro del pasillo
________ pasillo: 1xx cámara de frío, 0xx ambiente
```

Si a una posición numérica le falta el último dígito, la app se lo completa con un cero:
`10501910` se lee como `105019100`. Sin eso el nivel se corre (`910` en vez de `100`) y una
posición de picking termina contada como altura. Sólo se completa cuando son 8 dígitos
exactos; el resto se deja como viene.

Las reglas se evalúan **en orden** y gana la primera que coincide, así que las de ignorar
van arriba: `PACK` tiene que resolverse antes que `P*`. El comodín `*` vale al principio,
al final, en el medio (`103*100`) o solo (`*` = todas). Se editan en **⚙ Configuración → Reglas de posición**, que
muestra cuántas ubicaciones del archivo cargado cubre cada regla.

| Patrón | Acción | |
|---|---|---|
| `SPP` `PACK` `STAGE` `ACONDI` `PICKTO` `FALDEP*` `ROTORI*` `C*` | ignorar | tránsito, packing, acondicionado: no es stock ubicado |
| `VLMVENTA01` | picking · cámara · **VLM** | adentro de la torre |
| `VLMVENTA02` | picking · ambiente · **VLM** | adentro de la torre |
| `VLM*` | picking · VLM | red de seguridad de la torre |
| `BIOCAM*` | picking · cámara | picking de pasillo |
| `P*` | picking · ambiente | |
| `1*100` `1*150` | picking · cámara | pasillo 1xx |
| `0*100` `0*150` | picking · ambiente | pasillo 0xx |
| `1*` | altura · cámara | pasillos 103, 104… |
| `0*` | altura · ambiente | pasillos 013, 014… |
| `*` | altura | red de seguridad: lo que no encaje en nada |

Las reglas se **reaplican sobre el stock ya cargado**: al editarlas, y también al abrir
una versión de la app que trae reglas nuevas. No hace falta reimportar — cada producto
guarda las ubicaciones de sus líneas. Lo único que no vuelve son las filas que una regla
de ignorar descartó al importar: esas nunca se guardaron.

### Adentro del VLM la ubicación no distingue nada

Todo lo que está en la torre comparte `VLMVENTA01` o `VLMVENTA02` aunque físicamente esté
en bandejas separadas: el sistema no las distingue. Por eso, adentro del VLM el corte útil
es el **artículo**, no la posición — y de ahí sale el gráfico principal del resumen, que
es stock por artículo.

**Picking y altura** se separan por producto. Todos los KPIs y gráficos muestran
**sólo el stock en posiciones de picking**: es lo que se sirve y lo que hay que vigilar.
Si se sumara la reserva de altura, un artículo con la posición casi vacía y un pallet
arriba se vería sano. En el export de pasillo que se usó de prueba son 64.917 unidades en
picking contra 238.321 en altura — el 79% del total es reserva que no se pickea. Adentro
del VLM no hay altura: todo lo que está en la torre se pickea.

La altura sigue estando donde sirve: la tabla de inventario tiene las dos columnas, el
gráfico "Picking vs altura" muestra el reparto por laboratorio, y la lista de reposición
dice de qué posiciones bajar.

La zona y el ámbito de un artículo se deciden por peso entre sus posiciones, con el
picking valiendo doble. **Sólo votan las filas con dato explícito** — una columna de la
planilla o una regla de posición. Las que caen al default del laboratorio no votan: es una
suposición y no puede ganarle a un dato real. Sin eso, el stock de altura (que suele no
tener regla de zona) tapaba a las posiciones de picking.

---

## Posiciones: mínimo y máximo

La pestaña **Posiciones** lista una fila por **posición de picking + artículo** con su
stock y el **mínimo** y el **máximo** editables ahí mismo. El
**máximo** es el que manda: de él salen los umbrales de crítico y bajo, y el porcentaje de
llenado que muestra cada fila. Se guardan solos y se aplican al instante, sin reimportar.

**La reserva no se configura ni se grafica.** Un mínimo y un máximo dicen cuándo rellenar
una posición y cuánto entra; de la altura —y del pasillo que abastece al VLM— no se
rellena nada, se saca. Esas filas no aparecen en la pestaña, que si no serían la mayoría y
taparían las que sí hay que cargar. Un artículo que existe **sólo** en reserva tampoco
entra en el gráfico: no tiene nada que reponer y sería una barra en cero. El resumen dice
cuántos son, para que no desaparezcan en silencio.

La reserva sigue viéndose donde sirve: en el detalle del artículo y en la lista de
reposición, que dice de qué posición bajar la mercadería.

La clave es posición **más** artículo, no la posición sola. Afuera del VLM cada posición
de picking tiene un artículo y da lo mismo, pero adentro de la torre todos comparten
`VLMVENTA01` o `VLMVENTA02`: con la posición sola, cargar un máximo lo cargaría para los
cientos de artículos que viven ahí.

Un artículo puede estar en varias posiciones. En ese caso **hereda el estado de su peor
posición**, no del promedio: se repone posición por posición, y una que está por vaciarse
hay que atenderla aunque otra del mismo artículo esté llena. Las unidades a reponer sí se
suman entre todas.

### Cuando una posición cambia de artículo

En picking es normal que al agotarse un artículo la posición se reasigne a otro. El
mínimo y el máximo se guardan **junto al artículo que ocupaba la posición**, porque el
máximo depende del artículo: no entran las mismas unidades de una caja grande que de una
chica.

Si al importar el ocupante cambió, esa configuración **no se aplica** — quedaría dando
alertas del artículo anterior. La posición aparece como `Revisar` en la lista, con los
valores viejos todavía visibles como punto de partida, y se confirma con el botón ✓ o
editando cualquiera de los dos números. El aviso de importación dice cuántas hay.

Esto vale sólo para las posiciones de un solo artículo. En una posición compartida (el
VLM) que haya otro artículo configurado es lo normal, no un cambio de ocupante.

### De dónde bajar para rellenar

En la lista de reposición, cada producto muestra las posiciones de altura de donde sacar
mercadería, cruzadas por **artículo + lote + Atributo02**. Primero las del **mismo lote**
que ya está en la posición de picking —rellenar con otro lote mezcla partidas— y después
las demás ordenadas por vencimiento, que es el orden en que conviene sacarlas.

Para cargar muchas de golpe: **Exportar plantilla** baja un `.xlsx` con una fila por
posición y artículo, se completan las columnas `Mínimo` y `Máximo` en Excel y se vuelve
con **Importar completada**. Las columnas `Posicion` y `Articulo` son las que arman la
clave: no hay que tocarlas.

> Es `.xlsx` y no CSV a propósito. En CSV, Excel lee `010004100` como número y le come el
> cero de adelante; al reimportarlo la configuración no matchearía ninguna posición. En el
> `.xlsx` las columnas Posición y Artículo van forzadas a texto.

---

## Cómo calcula las alertas

El panel mira **el día de hoy**: qué tan llena está cada posición, como porcentaje de su
capacidad. No hay proyección ni días de cobertura — el consumo se maneja en vivo con la
transmisión del momento, no acá.

```
llenado   = lo que hay en la posición / máximo
a reponer = máximo - lo que hay
```

| Estado | Llenado |
|---|---|
| ⬛ Agotado | vacía y sin reserva en altura |
| 🔴 Crítico | **≤ 10% del máximo** · o vacía con reserva arriba |
| 🟡 Bajo | **≤ 25% del máximo** |
| 🟢 OK | > 25% |
| 🟣 Exceso | > 105% del máximo |
| ⬜ Sin datos | sin máximo ni mínimo cargados |

Sin máximo se usa el mínimo como punto de pedido. Sin ninguno de los dos el producto queda
en **sin datos** y no genera alerta — el Resumen avisa cuántos están así, para que no pasen
por buenos.

### Contra qué stock se mide

Si el máximo sale de la **configuración de una posición**, se compara contra lo que hay
**en esa posición**, no contra el stock total del artículo. Un artículo con 1.034 unidades
en su posición de picking y 7.800 en altura está **bajo** si esa posición admite 4.200: lo
que importa es que desde donde se sirve está por vaciarse, no que sobre mercadería arriba.

Por eso también, una posición de picking vacía con reserva en altura es **crítica**, no
agotada: agotado es que no hay en ningún lado.

Los porcentajes se cambian desde **⚙ Configuración**.

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
js/ubicaciones.js     reglas de posición (ignorar / picking / altura)
js/store.js           estado global, configuración y persistencia
js/parser.js          lectura de Excel, detección y mapeo de columnas
js/analytics.js       cobertura, criticidad, historial de consumo y agregados
js/charts.js          gráficos (Chart.js)
js/views.js           las cinco vistas
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

- [x] ~~Derivar el ámbito y la conservación de la **posición**~~
- [x] ~~Configurar mínimo y máximo por posición~~
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
