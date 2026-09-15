/* ============================================================
   parser.js · lectura de Excel/CSV, detección y mapeo de columnas
   ============================================================ */
window.VLM = window.VLM || {};

VLM.parser = (function () {
  const U = VLM.util;

  /* ------------------------------------------------------------
     Campos que entiende la app.
     alias: nombres de columna habituales (se comparan normalizados)
     ------------------------------------------------------------ */
  const CAMPOS = [
    { id: 'codigo', label: 'Código / SKU', req: true, tipo: 'texto',
      hint: 'Identificador único del artículo',
      alias: ['codigo', 'cod', 'sku', 'articulo', 'art', 'item', 'referencia', 'ref', 'id', 'codigo articulo', 'codigo producto', 'cod art'] },

    { id: 'descripcion', label: 'Descripción', req: false, tipo: 'texto',
      hint: 'Si falta, se muestra el código',
      alias: ['descripcion', 'desc', 'producto', 'nombre', 'detalle', 'denominacion', 'descripcion articulo'] },

    { id: 'laboratorio', label: 'Laboratorio', req: true, tipo: 'texto',
      hint: 'Se usa para agrupar los productos',
      alias: ['laboratorio', 'lab', 'proveedor', 'propietario', 'marca', 'fabricante', 'droguería', 'drogueria', 'laboratorio proveedor', 'dueño'] },

    { id: 'stock', label: 'Stock físico', req: true, tipo: 'numero',
      hint: 'Unidades que hay en la posición. Es lo que se ve en los gráficos.',
      alias: ['stock fisico', 'fisico', 'cantidad fisica', 'stock real', 'cantidad disponible',
              'stock disponible', 'stock', 'stock actual', 'cantidad', 'cant', 'existencia',
              'existencias', 'saldo', 'disponible', 'unidades', 'qty', 'cantidad actual'] },

    { id: 'disponible', label: 'Disponible', req: false, tipo: 'numero',
      hint: 'Físico menos lo ya comprometido por pedidos. Sólo se ve en el detalle del artículo.',
      alias: ['disponible', 'cantidad disponible', 'stock disponible', 'libre', 'sin asignar'] },

    { id: 'asignado', label: 'Asignado', req: false, tipo: 'numero',
      hint: 'Unidades comprometidas por pedidos ya lanzados',
      alias: ['asignado', 'cantidad asignada', 'comprometido', 'reservado'] },

    { id: 'ubicacion', label: 'Ubicación', req: false, tipo: 'texto',
      hint: 'Bandeja / posición / rack',
      alias: ['ubicacion', 'ubic', 'bandeja', 'charola', 'tray', 'posicion', 'pos', 'localizacion', 'locacion', 'estante', 'casillero'] },

    { id: 'stockMin', label: 'Stock mínimo', req: false, tipo: 'numero',
      hint: 'Punto de reposición',
      alias: ['stock minimo', 'minimo', 'min', 'stock min', 'punto de pedido', 'punto pedido', 'rop', 'nivel minimo', 'stock seguridad'] },

    { id: 'stockMax', label: 'Stock máximo / capacidad', req: false, tipo: 'numero',
      hint: 'Capacidad de la ubicación',
      alias: ['stock maximo', 'maximo', 'max', 'stock max', 'capacidad', 'cap', 'nivel maximo'] },

    { id: 'conservacion', label: 'Conservación', req: false, tipo: 'texto',
      hint: 'Frío o ambiente; si falta se usa la regla de la posición',
      alias: ['conservacion', 'cadena de frio', 'cadena frio', 'temperatura', 'refrigerado',
              'termolabil', 'condicion de conservacion', 'tipo de conservacion',
              'condiciones de conservacion', 'almacenamiento', 'frio'] },

    { id: 'lote', label: 'Lote', req: false, tipo: 'texto',
      hint: 'Se usa para bajar el mismo lote desde altura',
      alias: ['lote', 'batch', 'partida', 'nro lote'] },

    { id: 'lote2', label: 'Lote secundario / Atributo02', req: false, tipo: 'texto',
      hint: 'Segundo identificador de partida, si la planilla lo trae',
      alias: ['atributo02', 'atributo 02', 'atributo2', 'lote proveedor', 'lote secundario', 'partida proveedor', 'lote fabricante'] },

    { id: 'paquete', label: 'Paquete', req: false, tipo: 'texto',
      hint: 'Código de empaque. Sólo se muestra; no filtra ni se edita.',
      alias: ['paquete', 'package', 'empaque', 'envase', 'codigo de paquete'] },

    { id: 'vencimiento', label: 'Vencimiento', req: false, tipo: 'fecha',
      hint: 'Fecha de caducidad',
      alias: ['vencimiento', 'vto', 'vence', 'caducidad', 'fecha vencimiento', 'fecha vto', 'expira', 'expiry'] },

    // Estas dos no se muestran en ningún lado: sólo sirven para descartar
    // filas al importar (mercadería bloqueada, en cuarentena, etc.).
    { id: 'estatus', label: 'Estatus (filtro)', req: false, tipo: 'texto',
      hint: 'Sólo se importan las filas en OK',
      alias: ['estatus', 'estado', 'status', 'estado del stock'] },

    { id: 'atributo07', label: 'Atributo 07 (filtro)', req: false, tipo: 'texto',
      hint: 'Sólo se importan las filas con 1000',
      alias: ['atributo07', 'atributo 07', 'atributo7'] },

  ];

  /* Valores que tiene que tener una fila para entrar. Si la columna no está
     mapeada no se filtra nada: una planilla que no las trae se importa igual. */
  const FILTROS_FILA = { estatus: 'OK', atributo07: '1000' };

  /* ------------------------------------------------------------
     Lectura del archivo
     ------------------------------------------------------------ */

  /** Lee el archivo y devuelve { wb, hojas, nombre }. */
  function leerArchivo(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('No se pudo leer el archivo'));
      fr.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), {
            type: 'array', cellDates: true, cellText: false
          });
          if (!wb.SheetNames.length) throw new Error('El archivo no tiene hojas');
          resolve({ wb, hojas: wb.SheetNames, nombre: file.name });
        } catch (err) {
          reject(new Error('Formato no reconocido: ' + err.message));
        }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  /** Devuelve la hoja como matriz de filas (array de arrays). */
  function hojaAMatriz(wb, nombreHoja) {
    const ws = wb.Sheets[nombreHoja];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null, raw: true });
  }

  /**
   * Detecta la fila de encabezados: la primera de las 15 primeras filas
   * con más celdas de texto no vacías.
   */
  function detectarFilaEncabezado(matriz) {
    let mejor = 0, mejorPuntaje = -1;
    const lim = Math.min(matriz.length, 15);
    for (let i = 0; i < lim; i++) {
      const fila = matriz[i] || [];
      let puntaje = 0;
      fila.forEach(c => {
        if (c === null || c === '') return;
        puntaje += typeof c === 'string' ? 2 : 0.5;
      });
      // bonus si alguna celda coincide con un alias conocido
      fila.forEach(c => { if (typeof c === 'string' && aliasMatch(c)) puntaje += 4; });
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = i; }
    }
    return mejor;
  }

  function aliasMatch(texto) {
    const n = U.norm(texto);
    if (!n) return null;
    for (const campo of CAMPOS) {
      if (campo.alias.indexOf(n) > -1) return campo.id;
    }
    return null;
  }

  /**
   * Puntaje difuso: exacto > empieza-con > contiene.
   * Entre dos coincidencias exactas gana la más específica, así una planilla
   * con "Cantidad" y "Cantidad disponible" mapea el stock a la segunda.
   */
  function puntuarAlias(header, campo) {
    const n = U.norm(header);
    if (!n) return 0;
    let mejor = 0;
    for (const a of campo.alias) {
      if (n === a) return 100 + a.length;
      if (n.indexOf(a) === 0) mejor = Math.max(mejor, 70 - (n.length - a.length));
      else if (n.indexOf(a) > -1) mejor = Math.max(mejor, 50 - (n.length - a.length));
      else if (a.indexOf(n) === 0 && n.length >= 3) mejor = Math.max(mejor, 40);
    }
    return Math.max(0, mejor);
  }

  /**
   * Auto-mapea encabezados -> campos.
   * Cada columna se asigna a un solo campo (el de mayor puntaje).
   */
  function autoMapear(headers) {
    const pares = [];
    headers.forEach((h, idx) => {
      CAMPOS.forEach(campo => {
        const p = puntuarAlias(h, campo);
        if (p > 30) pares.push({ idx, campo: campo.id, p });
      });
    });
    pares.sort((a, b) => b.p - a.p);

    const mapa = {}, usadas = {};
    pares.forEach(par => {
      if (mapa[par.campo] !== undefined) return;   // campo ya asignado
      if (usadas[par.idx]) return;                 // columna ya usada
      mapa[par.campo] = par.idx;
      usadas[par.idx] = true;
    });
    return mapa;
  }

  /* ------------------------------------------------------------
     Fechas ambiguas
     ------------------------------------------------------------ */

  /**
   * Decide si una columna de fechas viene en d/m/a o m/d/a mirando toda la
   * columna: alcanza con que UNA fila tenga el primer número > 12 (o el
   * segundo) para desempatar. Celda por celda "10/31/26" es indecidible.
   * Ante la duda, d/m/a, que es lo habitual acá.
   */
  function detectarFormatoFecha(matriz, filaHeader, idx) {
    if (idx === undefined || idx === null) return 'dmy';
    let dmy = 0, mdy = 0;
    for (let i = filaHeader + 1; i < matriz.length; i++) {
      const fila = matriz[i];
      if (!fila) continue;
      const v = fila[idx];
      if (typeof v !== 'string') continue;
      const m = v.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (!m) continue;
      const a = +m[1], b = +m[2];
      if (a > 12 && b <= 12) dmy++;
      else if (b > 12 && a <= 12) mdy++;
    }
    return mdy > dmy ? 'mdy' : 'dmy';
  }

  /* ------------------------------------------------------------
     Agrupación por código
     ------------------------------------------------------------ */

  /**
   * Aplica la configuración de posiciones (mínimo y máximo) sobre productos
   * ya normalizados.
   *
   * No necesita el archivo original: cada producto guarda su `detalle` con el
   * stock por ubicación, así que editar un máximo se refleja al toque sin
   * volver a importar.
   *
   * Los mínimos y máximos se SUMAN entre las posiciones del artículo, una vez
   * por ubicación aunque tenga varios lotes. Y sólo cuentan las posiciones que
   * siguen con el mismo artículo con el que se configuraron.
   */
  function aplicarPosiciones(productos, cfgPosiciones) {
    cfgPosiciones = cfgPosiciones || {};
    productos.forEach(p => {
      const dets = (p.detalle && p.detalle.length)
        ? p.detalle
        : [{ ubicacion: p.ubicacion, stock: p.stock }];

      // Una entrada por posición configurada, con su propio stock, mínimo y
      // máximo. El estado del artículo sale de la PEOR de ellas, no de la
      // suma: se repone posición por posición, y una vacía hay que atenderla
      // aunque otra del mismo artículo esté llena.
      const porUbic = {};
      dets.forEach(d => {
        const u = String(d.ubicacion || '').trim().toUpperCase();
        if (!u) return;
        // primero la configuración de ESTE artículo en esta posición; si no
        // hay, la de la posición sola (formato viejo, una posición un artículo)
        const c = cfgPosiciones[u + '|' + String(p.codigo).toUpperCase()] || cfgPosiciones[u];
        if (!c) return;
        if (c.articulo && c.articulo !== p.codigo) return;   // se reasignó
        if (!porUbic[u]) porUbic[u] = { ubicacion: d.ubicacion, stock: 0, min: c.min || 0, max: c.max || 0 };
        porUbic[u].stock += d.stock;
      });

      const lista = Object.keys(porUbic).map(k => porUbic[k]);
      const hay = lista.length > 0;

      p.posConfig      = lista;
      p.tieneConfigPos = hay;
      p.minPos = lista.reduce((s, x) => s + x.min, 0);
      p.maxPos = lista.reduce((s, x) => s + x.max, 0);
      p.stockPosConfig = lista.reduce((s, x) => s + x.stock, 0);
      if (hay) { p.stockMin = p.minPos; p.stockMax = p.maxPos; }
      p.stockRef = hay ? p.stockPosConfig : p.stock;
    });
    return productos;
  }

  /**
   * Clasifica cada artículo: VLM o fuera, frío o ambiente, y qué posiciones
   * suyas son picking y cuáles reserva.
   *
   * El orden importa: primero el SKU, después la ubicación. Que un artículo
   * viva en la torre no lo decide su laboratorio —AstraZeneca tiene de los dos
   * tipos— sino que aparezca en una posición del VLM. Y recién sabiendo eso se
   * puede leer el resto de sus ubicaciones: el nivel 100 de un artículo del VLM
   * es la reserva para rellenar la torre, mientras que el mismo nivel 100 en un
   * artículo de pasillo es la posición desde la que se sirve.
   *

   * Sin esto, cambiar una regla —o abrir una versión nueva de la app que trae
   * reglas nuevas— dejaba la clasificación vieja pegada hasta reimportar la
   * planilla: el artículo seguía en la zona y el ámbito que le tocaron el día
   * que se importó. Cada producto guarda su `detalle` con la ubicación de cada
   * línea, así que se puede recalcular sin el archivo original.
   *
   * Lo único que NO se puede recuperar son las filas que una regla de ignorar
   * descartó al importar: esas nunca se guardaron.
   */
  function reaplicarReglas(productos, reglas, catalogo) {
    reglas = reglas || VLM.ubicaciones.reglasDefault();
    catalogo = catalogo || VLM.labs.catalogoDefault();

    productos.forEach(p => {
      // sin agrupar (una fila por producto) no hay detalle: la única ubicación
      // del producto hace de detalle para poder clasificarlo igual
      const dets = (p.detalle && p.detalle.length)
        ? p.detalle : [{ ubicacion: p.ubicacion, stock: p.stock }];

      // --- 1. el SKU: ¿vive en la torre? ---
      // Manda que el artículo aparezca en una posición del VLM, no de dónde
      // sea el laboratorio. AstraZeneca tiene artículos adentro de la torre y
      // otros que se pickean de pasillo; son el mismo laboratorio y no se
      // clasifican igual.
      const evaluadas = dets.map(d => ({
        det: d, regla: VLM.ubicaciones.evaluar(d.ubicacion, reglas)
      }));
      const enVLM = evaluadas.filter(e => e.regla && e.regla.ambito === 'vlm');
      const esVLM = enVLM.length > 0;

      let pick = 0, alt = 0;
      const zonaPeso = {};
      const ubicPicking = [], ubicAltura = [], ubicaciones = [];

      // --- 2. la ubicación, leída según lo que sea el SKU ---
      evaluadas.forEach(e => {
        const d = e.det, regla = e.regla;
        const esPosVLM = !!(regla && regla.ambito === 'vlm');

        /* Un artículo del VLM se pickea SÓLO de la torre. Todo lo que tenga
           en pasillo —incluido el nivel 100, que en cualquier otro artículo
           sería picking— es la reserva con la que se rellena la torre. Sin
           esta distinción, el nivel 100 de un artículo del VLM se contaba
           como si se sirviera de ahí y los gráficos mostraban un picking que
           no existe. */
        d.tipo = esVLM ? (esPosVLM ? 'picking' : 'altura')
                       : ((regla && regla.tipo) || 'picking');
        d.reservaVLM = esVLM && !esPosVLM;

        const zona = regla && regla.zona ? regla.zona : null;
        if (zona && !p.zonaDeColumna) d.zona = zona;

        if (d.tipo === 'altura') {
          alt += d.stock;
          if (d.ubicacion && ubicAltura.indexOf(d.ubicacion) === -1) ubicAltura.push(d.ubicacion);
        } else {
          pick += d.stock;
          if (d.ubicacion && ubicPicking.indexOf(d.ubicacion) === -1) ubicPicking.push(d.ubicacion);
        }
        if (d.ubicacion && ubicaciones.indexOf(d.ubicacion) === -1) ubicaciones.push(d.ubicacion);

        /* La zona sale de la cara de picking: para un artículo del VLM, de si
           está en VLMVENTA01 (frío) o 02 (ambiente), sin que la reserva de
           pasillo pueda torcerlo. Para el resto, del pasillo, con el picking
           pesando doble. */
        if (!zona) return;
        if (esVLM && !esPosVLM) return;
        zonaPeso[zona] = (zonaPeso[zona] || 0) + (d.stock || 0) * (d.tipo === 'picking' ? 2 : 1) + 1;
      });

      const mayor = o => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
      const zonaGana = mayor(zonaPeso);

      p.stockPicking = pick;
      p.stockAltura  = alt;
      p.ubicaciones  = ubicaciones;
      p.ubicPicking  = ubicPicking;
      p.ubicAltura   = ubicAltura;
      p.sinPicking   = ubicPicking.length === 0;
      p.zonasMixtas  = Object.keys(zonaPeso).length > 1;
      p.ubicacion    = ubicPicking.length ? ubicPicking[0] : (ubicaciones[0] || '');
      if (ubicaciones.length > 1) p.ubicacion += ' +' + (ubicaciones.length - 1);

      // la columna de la planilla, si existe, le gana a la regla
      if (zonaGana && !p.zonaDeColumna) { p.zonaPlanilla = zonaGana; p.zonaExplicita = true; }
      p.ambitoPos = esVLM ? 'vlm' : 'externo';

      VLM.labs.clasificar(p, catalogo);
    });
    return productos;
  }

  /** ¿Hay más de una fila por código? (export por posición o por lote) */
  function hayRepetidos(productos) {
    const vistos = {};
    for (const p of productos) {
      if (vistos[p.codigo]) return true;
      vistos[p.codigo] = true;
    }
    return false;
  }

  /**
   * Junta las filas del mismo código en un solo producto.
   *
   * El stock se suma, porque cada fila es una posición o un lote distinto.
   * El mínimo, el máximo y el consumo NO se suman: son atributos del artículo
   * repetidos en cada fila, así que se toma el mayor (que con datos sanos es
   * el mismo valor). Del vencimiento queda el más próximo, que es el que
   * manda para decidir.
   */
  function agrupar(productos) {
    const mapa = {}, orden = [];
    productos.forEach(p => {
      const k = p.codigo;
      if (!mapa[k]) {
        mapa[k] = Object.assign({}, p, {
          ubicaciones: [], ubicPicking: [], ubicAltura: [], lotes: [], detalle: [],
          posiciones: 0, stockPicking: 0, stockAltura: 0,
          disponible: 0, asignado: 0, hayDisponible: false,
          minPos: 0, maxPos: 0, stockPosConfig: 0, tieneConfigPos: false
        });
        orden.push(k);
        mapa[k].stock = 0;
      }
      const g = mapa[k];
      g.stock += p.stock;
      g.posiciones++;
      // el disponible se suma igual que el físico; si la planilla no trae la
      // columna queda en null para no mostrar un cero que parece un dato real
      if (p.disponible !== null && p.disponible !== undefined) {
        g.hayDisponible = true;
        g.disponible += p.disponible;
      }
      g.asignado += p.asignado || 0;
      if (p.tipoPos === 'altura') {
        g.stockAltura += p.stock;
        if (p.ubicacion && g.ubicAltura.indexOf(p.ubicacion) === -1) g.ubicAltura.push(p.ubicacion);
      } else {
        g.stockPicking += p.stock;
        if (p.ubicacion && g.ubicPicking.indexOf(p.ubicacion) === -1) g.ubicPicking.push(p.ubicacion);
      }
      // se mira ANTES de registrarla: define si su mín/máx ya se sumó
      const ubicNueva = !!p.ubicacion && g.ubicaciones.indexOf(p.ubicacion) === -1;
      if (ubicNueva) g.ubicaciones.push(p.ubicacion);
      if (p.lote && g.lotes.indexOf(p.lote) === -1) g.lotes.push(p.lote);

      // Detalle por posición Y lote: lo usa la vista de Posiciones y, sobre
      // todo, la reposición, que necesita saber de qué altura bajar el MISMO
      // lote que está en la posición de picking.
      // El LPN NO entra en la clave: en el VLM el mismo lote aparece partido
      // en varios LPN aunque físicamente esté todo junto, así que esas filas
      // se suman en una sola.
      const yaD = g.detalle.filter(d =>
        d.ubicacion === p.ubicacion && d.lote === p.lote && d.lote2 === p.lote2)[0];
      if (yaD) {
        yaD.stock += p.stock;
        yaD.asignado += p.asignado || 0;
        if (p.disponible !== null && p.disponible !== undefined) {
          yaD.disponible = (yaD.disponible || 0) + p.disponible;
        }
        yaD.lineas++;
      } else g.detalle.push({
        ubicacion: p.ubicacion, stock: p.stock, tipo: p.tipoPos,
        disponible: p.disponible, asignado: p.asignado || 0, lineas: 1,
        zona: p.conservacion, lote: p.lote, lote2: p.lote2,
        vencimiento: p.vencimiento
      });

      // La zona y el ámbito NO se deciden acá: hace falta ver todas las
      // ubicaciones del artículo juntas, y eso lo hace reaplicarReglas() sobre
      // la lista ya agrupada. Acá sólo se junta el stock.
      if (p.zonaDeColumna) g.zonaDeColumna = true;
      // el paquete es del artículo, igual en todas sus filas
      if (!g.paquete && p.paquete) g.paquete = p.paquete;
      g.stockMin       = Math.max(g.stockMin || 0, p.stockMin || 0);
      g.stockMax       = Math.max(g.stockMax || 0, p.stockMax || 0);
      if (p.vencimiento && (!g.vencimiento || p.vencimiento < g.vencimiento)) g.vencimiento = p.vencimiento;
      if (!g.descripcion || g.descripcion === g.codigo) g.descripcion = p.descripcion;
    });

    return orden.map(k => {
      const g = mapa[k];
      g.lote = g.lotes.length > 1 ? g.lotes.length + ' lotes' : (g.lotes[0] || '');
      if (!g.hayDisponible) g.disponible = null;
      delete g.hayDisponible;
      return g;
    });
  }

  /* ------------------------------------------------------------
     Normalización de filas -> productos
     ------------------------------------------------------------ */

  /**
   * Convierte la matriz + mapeo en registros normalizados y los clasifica
   * contra el catálogo de laboratorios (ámbito VLM/externo y conservación).
   * @returns { productos, descartadas, avisos, noListados }
   */
  function normalizar(matriz, filaHeader, mapa, cfg, catalogo, opciones) {
    const productos = [];
    const avisos = [];
    let descartadas = 0;
    catalogo = catalogo || VLM.labs.catalogoDefault();
    opciones = opciones || {};
    const reglas = opciones.reglas || VLM.ubicaciones.reglasDefault();
    const cfgPosiciones = opciones.posiciones || {};
    let ignoradas = 0, sinRegla = 0, filtradas = 0;
    const ignoradasPorPatron = {};
    const filtradasPorValor = {};
    // posiciones que ninguna regla ubica en frío o ambiente: quedan en ambiente
    // por descarte, y eso hay que decirlo
    const sinZona = {};
    // todas las posiciones que aparecen en el archivo, incluidas las ignoradas:
    // el editor de reglas las necesita para decir cuántas cubre cada regla
    const ubicVistas = {};
    // posiciones cuya configuración quedó vieja porque cambió el artículo
    const posReasignadas = {};
    const fmtFecha = detectarFormatoFecha(matriz, filaHeader, mapa.vencimiento);

    // encabezado de la columna de conservación: cambia cómo se lee un "SI"
    const filaHeaders = matriz[filaHeader] || [];
    const idxCons = mapa.conservacion;
    const headerCons = (idxCons === undefined || idxCons === null)
      ? '' : U.norm(filaHeaders[idxCons]);

    const get = (fila, campoId) => {
      const idx = mapa[campoId];
      return (idx === undefined || idx === null) ? null : fila[idx];
    };

    for (let i = filaHeader + 1; i < matriz.length; i++) {
      const fila = matriz[i];
      if (!fila || !fila.length) continue;
      if (fila.every(c => c === null || c === '')) continue;

      const codigo = get(fila, 'codigo');
      const desc   = get(fila, 'descripcion');
      const stock  = U.toNum(get(fila, 'stock'));

      // fila inútil: sin identificador o sin stock numérico
      if ((codigo === null || codigo === '') && (desc === null || desc === '')) { descartadas++; continue; }
      if (stock === null) { descartadas++; continue; }

      // --- filtros de estatus: mercadería que no está disponible para vender ---
      let fueraDeFiltro = null;
      for (const campo in FILTROS_FILA) {
        if (mapa[campo] === undefined || mapa[campo] === null) continue;
        const v = String(get(fila, campo) === null ? '' : get(fila, campo)).trim();
        if (U.norm(v) !== U.norm(FILTROS_FILA[campo])) { fueraDeFiltro = campo + '=' + (v || '(vacío)'); break; }
      }
      if (fueraDeFiltro) {
        filtradas++;
        filtradasPorValor[fueraDeFiltro] = (filtradasPorValor[fueraDeFiltro] || 0) + 1;
        continue;
      }

      const lab = String(get(fila, 'laboratorio') || '').trim() || 'Sin laboratorio';

      // --- reglas de posición: ignorar, picking o altura ---
      // se normaliza antes de todo: la posición corregida es la que se usa
      // para clasificar, para mostrar y como clave de configuración
      const ubic = VLM.ubicaciones.normalizar(get(fila, 'ubicacion') || '');
      if (ubic) ubicVistas[ubic] = 1;
      const regla = VLM.ubicaciones.evaluar(ubic, reglas);
      if (regla && regla.accion === 'ignorar') {
        ignoradas++;
        ignoradasPorPatron[regla.patron] = (ignoradasPorPatron[regla.patron] || 0) + 1;
        continue;
      }
      if (ubic && !regla) sinRegla++;

      // la columna de la planilla manda sobre la regla de posición
      const zonaCol = VLM.labs.parsearConservacion(get(fila, 'conservacion'), headerCons);
      if (!zonaCol && !(regla && regla.zona) && ubic) sinZona[ubic] = (sinZona[ubic] || 0) + 1;
      const zonaFila = zonaCol ||
                       (regla && regla.zona) || null;

      const cod = String(codigo === null ? '' : codigo).trim() || ('#' + (productos.length + 1));

      // La configuración de la posición sólo vale si sigue el mismo artículo.
      // Si la posición se reasignó, el mín/máx del artículo anterior no aplica
      // y queda para revisar: aplicarlo a ciegas daría alertas falsas.
      const U_ = ubic ? ubic.toUpperCase() : '';
      const cfgPos = U_ ? (cfgPosiciones[U_ + '|' + cod.toUpperCase()] || cfgPosiciones[U_]) : null;
      const cfgVigente = cfgPos && (!cfgPos.articulo || cfgPos.articulo === cod);
      if (cfgPos && !cfgVigente) posReasignadas[ubic] = { antes: cfgPos.articulo, ahora: cod };
      productos.push(VLM.labs.clasificar({
        codigo:        cod,
        // sin columna de descripcion se muestra el codigo, que es lo unico que hay
        descripcion:   String(desc === null ? '' : desc).trim() || cod,
        laboratorio:   lab,
        // la posición manda sobre el default del laboratorio, pero no sobre
        // una columna de conservación explícita en la planilla
        zonaPlanilla:  zonaFila,
        zonaExplicita: !!zonaFila,
        // si la zona vino de una columna de la planilla, ninguna regla de
        // posición la pisa después (ver reaplicarReglas)
        zonaDeColumna: !!zonaCol,
        ambitoPos:     regla && regla.ambito ? regla.ambito : null,
        tipoPos:       (regla && regla.tipo) || 'picking',
        ubicacion:     ubic,
        stock:         stock,
        // el físico es lo que se ve en los gráficos y define el estado; el
        // disponible ya tiene descontado lo que los pedidos lanzados se van a
        // llevar, y sólo aparece en el detalle del artículo
        disponible:    U.toNum(get(fila, 'disponible')),
        asignado:      U.toNum(get(fila, 'asignado')) || 0,
        // min/max configurados para ESTA posición (ver Posiciones)
        minPos:        cfgVigente ? (cfgPos.min || 0) : 0,
        maxPos:        cfgVigente ? (cfgPos.max || 0) : 0,
        stockMin:      cfgVigente && cfgPos.min ? cfgPos.min : (U.toNum(get(fila, 'stockMin')) || 0),
        stockMax:      cfgVigente && cfgPos.max ? cfgPos.max : (U.toNum(get(fila, 'stockMax')) || 0),
        paquete:       String(get(fila, 'paquete') || '').trim(),
        lote:          String(get(fila, 'lote') || '').trim(),
        lote2:         String(get(fila, 'lote2') || '').trim(),
        vencimiento:   U.toDate(get(fila, 'vencimiento'), fmtFecha)
      }, catalogo));
    }

    // un export por posicion trae varias filas del mismo articulo
    const repetidos = hayRepetidos(productos);
    const agrupado = repetidos && opciones.agrupar !== false;
    const filasLeidas = productos.length;
    let lista = agrupado ? agrupar(productos) : productos;
    // VLM o fuera, frío o ambiente, picking o reserva: se decide por artículo,
    // una vez que están todas sus ubicaciones juntas. Es la misma función que
    // corre al editar las reglas, así que importar y reclasificar dan igual.
    reaplicarReglas(lista, reglas, catalogo);
    // el mínimo y el máximo se resuelven al final, desde el detalle por
    // posición: es la misma función que corre al editarlos sin reimportar
    aplicarPosiciones(lista, cfgPosiciones);

    // --- laboratorios de la planilla que no están en el catálogo ---
    const noListados = {};
    lista.forEach(p => {
      if (p.gestionado) return;
      if (!noListados[p.laboratorio]) noListados[p.laboratorio] = 0;
      noListados[p.laboratorio]++;
    });
    const nombresNoListados = Object.keys(noListados);

    if (!productos.length) avisos.push('No se pudo leer ninguna fila válida. Revisá la fila de encabezados y el mapeo.');
    if (descartadas > 0)   avisos.push(descartadas + ' fila(s) omitidas por estar vacías o sin stock numérico.');
    if (ignoradas) {
      const detalle = Object.keys(ignoradasPorPatron)
        .sort((a,b) => ignoradasPorPatron[b] - ignoradasPorPatron[a])
        .slice(0, 5).map(k => k + ' (' + ignoradasPorPatron[k] + ')').join(', ');
      avisos.push(ignoradas + ' fila(s) ignoradas por reglas de posición: ' + detalle + '.');
    }
    if (sinRegla) {
      avisos.push(sinRegla + ' fila(s) con posiciones que ninguna regla cubre.');
    }
    const zonasFaltantes = Object.keys(sinZona);
    if (zonasFaltantes.length) {
      avisos.push(zonasFaltantes.length + ' posición(es) sin frío ni ambiente definido (' +
        zonasFaltantes.slice(0, 4).join(', ') + (zonasFaltantes.length > 4 ? '…' : '') +
        '): quedan en Ambiente por descarte. Agregales una regla con zona.');
    }
    if (filtradas) {
      const porQue = Object.keys(filtradasPorValor)
        .sort((a, b) => filtradasPorValor[b] - filtradasPorValor[a])
        .slice(0, 3).map(k => k + ' (' + filtradasPorValor[k] + ')').join(', ');
      avisos.push(filtradas + ' fila(s) descartadas por estatus: ' + porQue +
                  '. Sólo entra lo que está en OK con atributo 07 = 1000.');
    }
    const nReasig = Object.keys(posReasignadas).length;
    if (nReasig) {
      avisos.push(nReasig + ' posición(es) cambiaron de artículo: su mínimo y máximo quedan ' +
                  'para revisar en la pestaña Posiciones y no se aplican hasta confirmarlos.');
    }
    if (agrupado) {
      avisos.push('La planilla trae varias filas por artículo: se agruparon ' + filasLeidas +
                  ' filas en ' + lista.length + ' productos, sumando las cantidades.');
    } else if (repetidos) {
      avisos.push('Hay códigos repetidos y la agrupación está desactivada: cada fila cuenta como un producto aparte.');
    }
    if (fmtFecha === 'mdy') {
      avisos.push('Las fechas se leyeron como mes/día/año (formato de EE.UU.).');
    }
    if (mapa.conservacion === undefined) {
      avisos.push('Sin columna de conservación: frío o ambiente salen de la regla de cada posición.');
    }
    if (nombresNoListados.length) {
      avisos.push(nombresNoListados.length + ' laboratorio(s) fuera del catálogo: ' +
        nombresNoListados.slice(0, 4).join(', ') +
        (nombresNoListados.length > 4 ? '…' : '') + '.');
    }
    return { productos: lista, descartadas, avisos, noListados, nombresNoListados,
             repetidos, agrupado, filasLeidas, formatoFecha: fmtFecha,
             ignoradas, sinRegla, ignoradasPorPatron, filtradas, filtradasPorValor, sinZona,
             ubicacionesVistas: Object.keys(ubicVistas), posReasignadas };
  }

  /* ------------------------------------------------------------
     Plantilla descargable
     ------------------------------------------------------------ */
  function generarPlantilla() {
    const headers = ['Codigo', 'Descripcion', 'Laboratorio', 'Conservacion', 'Ubicacion', 'Stock',
                     'Stock Minimo', 'Stock Maximo', 'Lote', 'Vencimiento'];
    const filas = [
      ['AZ-101', 'Tagrisso 80mg x30 comp',   'ASTRAZENECA',        'Ambiente', 'B01-C01', 140,  60, 320, 'AZ4411', '2027-08-31'],
      ['RO-201', 'Herceptin 440mg vial',     'ROCHE',              'Frio',     'CF-B1',     4,  10,  40, 'RO8801', '2027-05-31'],
      ['AM-401', 'Neulasta 6mg jeringa',     'AMGEN',              'Frio',     'CF-D1',     8,  15,  60, 'AM9901', '2027-06-30'],
      ['BS-601', 'Bioyetin 4000 UI x6 amp',  'BIOSIDUS ARGENTINA', 'Frio',     'DEP-F2',   96,  40, 200, 'BS1101', '2027-04-30']
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers].concat(filas));
    ws['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 20 }, { wch: 13 }, { wch: 11 }, { wch: 8 },
                   { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 13 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock VLM');
    XLSX.writeFile(wb, 'plantilla_vlm.xlsx');
  }

  return {
    CAMPOS, leerArchivo, hojaAMatriz, detectarFilaEncabezado,
    autoMapear, normalizar, generarPlantilla,
    detectarFormatoFecha, hayRepetidos, agrupar, aplicarPosiciones, reaplicarReglas
  };
})();
