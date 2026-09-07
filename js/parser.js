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

    { id: 'stock', label: 'Stock actual', req: true, tipo: 'numero',
      hint: 'Unidades disponibles hoy',
      alias: ['cantidad disponible', 'stock disponible', 'stock', 'stock actual', 'cantidad', 'cant', 'existencia', 'existencias', 'saldo', 'disponible', 'unidades', 'qty', 'cantidad actual', 'stock real'] },

    { id: 'ubicacion', label: 'Ubicación', req: false, tipo: 'texto',
      hint: 'Bandeja / posición / rack',
      alias: ['ubicacion', 'ubic', 'bandeja', 'charola', 'tray', 'posicion', 'pos', 'localizacion', 'locacion', 'estante', 'casillero'] },

    { id: 'stockMin', label: 'Stock mínimo', req: false, tipo: 'numero',
      hint: 'Punto de reposición',
      alias: ['stock minimo', 'minimo', 'min', 'stock min', 'punto de pedido', 'punto pedido', 'rop', 'nivel minimo', 'stock seguridad'] },

    { id: 'stockMax', label: 'Stock máximo / capacidad', req: false, tipo: 'numero',
      hint: 'Capacidad de la ubicación',
      alias: ['stock maximo', 'maximo', 'max', 'stock max', 'capacidad', 'cap', 'nivel maximo'] },

    { id: 'consumoDiario', label: 'Consumo diario', req: false, tipo: 'numero',
      hint: 'Unidades por día (si no, se calcula del mensual)',
      alias: ['consumo diario', 'consumo dia', 'cons diario', 'consumo por dia', 'promedio diario', 'demanda diaria', 'uds dia'] },

    { id: 'consumoMensual', label: 'Consumo mensual', req: false, tipo: 'numero',
      hint: 'Salidas del último mes o promedio mensual',
      alias: ['consumo mensual', 'consumo mes', 'cons mensual', 'salidas mes', 'salidas', 'egresos mes', 'demanda mensual', 'promedio mensual', 'consumo 30 dias', 'venta mensual', 'movimiento mensual'] },

    { id: 'conservacion', label: 'Conservación', req: false, tipo: 'texto',
      hint: 'Frío o ambiente; si falta se usa el default del laboratorio',
      alias: ['conservacion', 'cadena de frio', 'cadena frio', 'temperatura', 'refrigerado',
              'termolabil', 'condicion de conservacion', 'tipo de conservacion',
              'condiciones de conservacion', 'almacenamiento', 'frio'] },

    { id: 'lote', label: 'Lote', req: false, tipo: 'texto',
      hint: 'Se usa para bajar el mismo lote desde altura',
      alias: ['lote', 'batch', 'partida', 'nro lote'] },

    { id: 'lote2', label: 'Lote secundario / Atributo02', req: false, tipo: 'texto',
      hint: 'Segundo identificador de partida, si la planilla lo trae',
      alias: ['atributo02', 'atributo 02', 'atributo2', 'lote proveedor', 'lote secundario', 'partida proveedor', 'lote fabricante'] },

    { id: 'vencimiento', label: 'Vencimiento', req: false, tipo: 'fecha',
      hint: 'Fecha de caducidad',
      alias: ['vencimiento', 'vto', 'vence', 'caducidad', 'fecha vencimiento', 'fecha vto', 'expira', 'expiry'] },

  ];

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
          minPos: 0, maxPos: 0, stockPosConfig: 0, tieneConfigPos: false,
          zonaPeso: {}, ambitoPeso: {}
        });
        orden.push(k);
        mapa[k].stock = 0;
      }
      const g = mapa[k];
      g.stock += p.stock;
      g.posiciones++;
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
      const yaD = g.detalle.filter(d =>
        d.ubicacion === p.ubicacion && d.lote === p.lote && d.lote2 === p.lote2)[0];
      if (yaD) yaD.stock += p.stock;
      else g.detalle.push({
        ubicacion: p.ubicacion, stock: p.stock, tipo: p.tipoPos,
        zona: p.conservacion, lote: p.lote, lote2: p.lote2,
        vencimiento: p.vencimiento
      });

      // min/max: los de la planilla son del artículo y se repiten en cada fila
      // (se toma el mayor), pero los configurados por posición se SUMAN, porque
      // cada posición aporta su propia capacidad. Se cuenta una vez por
      // ubicación, no por lote.
      if (p.minPos || p.maxPos) {
        g.tieneConfigPos = true;
        if (ubicNueva) { g.minPos += p.minPos || 0; g.maxPos += p.maxPos || 0; }
        // El mínimo de una posición se compara contra lo que hay EN ESA
        // posición, no contra el stock total del artículo: si no, la reserva
        // de altura tapa que la posición de picking está por vaciarse.
        g.stockPosConfig += p.stock;
      }

      // La zona y el ámbito se deciden por peso, pero SÓLO votan las filas
      // donde el dato es explícito: una columna de la planilla o una regla de
      // posición. Las que caen al default del laboratorio no votan, porque es
      // una suposición y no puede ganarle a un dato real — si no, el stock de
      // altura (que suele no tener regla de zona) tapa a las posiciones de
      // picking, que son las que definen desde dónde se sirve el artículo.
      const peso = (p.stock || 0) * (p.tipoPos === 'picking' ? 2 : 1) + 1;
      if (p.zonaExplicita && p.conservacion) {
        g.zonaPeso[p.conservacion] = (g.zonaPeso[p.conservacion] || 0) + peso;
      }
      if (p.ambitoPos) g.ambitoPeso[p.ambitoPos] = (g.ambitoPeso[p.ambitoPos] || 0) + peso;

      g.stockMin       = Math.max(g.stockMin || 0, p.stockMin || 0);
      g.stockMax       = Math.max(g.stockMax || 0, p.stockMax || 0);
      g.consumoDiario  = Math.max(g.consumoDiario || 0, p.consumoDiario || 0);
      g.consumoMensual = Math.max(g.consumoMensual || 0, p.consumoMensual || 0);
      if (p.vencimiento && (!g.vencimiento || p.vencimiento < g.vencimiento)) g.vencimiento = p.vencimiento;
      if (!g.descripcion || g.descripcion === g.codigo) g.descripcion = p.descripcion;
    });

    const mayor = o => Object.keys(o).sort((a, b) => o[b] - o[a])[0];

    return orden.map(k => {
      const g = mapa[k];
      g.ubicacion = g.ubicPicking.length ? g.ubicPicking[0] : (g.ubicaciones[0] || '');
      if (g.ubicaciones.length > 1) g.ubicacion += ' +' + (g.ubicaciones.length - 1);
      g.lote = g.lotes.length > 1 ? g.lotes.length + ' lotes' : (g.lotes[0] || '');
      // la configuración de posiciones gana sobre lo que traiga la planilla
      if (g.tieneConfigPos) { g.stockMin = g.minPos; g.stockMax = g.maxPos; }
      // contra qué stock se miden el mínimo y el máximo
      g.stockRef = g.tieneConfigPos ? g.stockPosConfig : g.stock;
      g.conservacion = mayor(g.zonaPeso) || g.conservacion;
      g.ambito       = mayor(g.ambitoPeso) || g.ambito;
      g.zonasMixtas  = Object.keys(g.zonaPeso).length > 1;
      g.sinPicking   = g.ubicPicking.length === 0;
      delete g.zonaPeso; delete g.ambitoPeso;
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
    const diasMes = (cfg && cfg.diasMes) || 30;
    catalogo = catalogo || VLM.labs.catalogoDefault();
    opciones = opciones || {};
    const reglas = opciones.reglas || VLM.ubicaciones.reglasDefault();
    const cfgPosiciones = opciones.posiciones || {};
    let ignoradas = 0, sinRegla = 0;
    const ignoradasPorPatron = {};
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

      const consDiario  = U.toNum(get(fila, 'consumoDiario'));
      const consMensual = U.toNum(get(fila, 'consumoMensual'));
      let consumoDiario = 0, fuenteConsumo = 'ninguna';
      if (consDiario !== null && consDiario > 0)       { consumoDiario = consDiario;             fuenteConsumo = 'diario'; }
      else if (consMensual !== null && consMensual > 0) { consumoDiario = consMensual / diasMes; fuenteConsumo = 'mensual'; }

      const lab = String(get(fila, 'laboratorio') || '').trim() || 'Sin laboratorio';

      // --- reglas de posición: ignorar, picking o altura ---
      // se normaliza antes de todo: la posición corregida es la que se usa
      // para clasificar, para mostrar y como clave de configuración
      const ubic = VLM.ubicaciones.normalizar(get(fila, 'ubicacion') || '');
      if (ubic) ubicVistas[ubic] = 1;
      const regla = VLM.ubicaciones.evaluar(ubic, reglas);
      const cfgPos = ubic ? cfgPosiciones[ubic.toUpperCase()] : null;
      if (regla && regla.accion === 'ignorar') {
        ignoradas++;
        ignoradasPorPatron[regla.patron] = (ignoradasPorPatron[regla.patron] || 0) + 1;
        continue;
      }
      if (ubic && !regla) sinRegla++;

      // la columna de la planilla manda sobre la regla de posición
      const zonaFila = VLM.labs.parsearConservacion(get(fila, 'conservacion'), headerCons) ||
                       (regla && regla.zona) || null;

      const cod = String(codigo === null ? '' : codigo).trim() || ('#' + (productos.length + 1));

      // La configuración de la posición sólo vale si sigue el mismo artículo.
      // Si la posición se reasignó, el mín/máx del artículo anterior no aplica
      // y queda para revisar: aplicarlo a ciegas daría alertas falsas.
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
        ambitoPos:     regla && regla.ambito ? regla.ambito : null,
        tipoPos:       (regla && regla.tipo) || 'picking',
        ubicacion:     ubic,
        stock:         stock,
        // min/max configurados para ESTA posición (ver Posiciones)
        minPos:        cfgVigente ? (cfgPos.min || 0) : 0,
        maxPos:        cfgVigente ? (cfgPos.max || 0) : 0,
        stockMin:      cfgVigente && cfgPos.min ? cfgPos.min : (U.toNum(get(fila, 'stockMin')) || 0),
        stockMax:      cfgVigente && cfgPos.max ? cfgPos.max : (U.toNum(get(fila, 'stockMax')) || 0),
        consumoDiario: consumoDiario,
        consumoMensual: consMensual !== null ? consMensual : (consumoDiario ? consumoDiario * diasMes : 0),
        fuenteConsumo: fuenteConsumo,
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
    if (mapa.consumoDiario === undefined && mapa.consumoMensual === undefined) {
      avisos.push('Sin columna de consumo: se calcula restando importaciones sucesivas. ' +
                  'Importá una vez por día y desde la segunda vas a ver la cobertura.');
    }
    if (mapa.stockMin === undefined) {
      avisos.push('Sin stock mínimo: las alertas salen sólo de los días de cobertura.');
    }
    if (mapa.conservacion === undefined) {
      avisos.push('Sin columna de conservación: se usa el valor por defecto de cada laboratorio (editable en Configuración).');
    }
    if (nombresNoListados.length) {
      avisos.push(nombresNoListados.length + ' laboratorio(s) fuera del catálogo: ' +
        nombresNoListados.slice(0, 4).join(', ') +
        (nombresNoListados.length > 4 ? '…' : '') + '.');
    }
    return { productos: lista, descartadas, avisos, noListados, nombresNoListados,
             repetidos, agrupado, filasLeidas, formatoFecha: fmtFecha,
             ignoradas, sinRegla, ignoradasPorPatron,
             ubicacionesVistas: Object.keys(ubicVistas), posReasignadas };
  }

  /* ------------------------------------------------------------
     Plantilla descargable
     ------------------------------------------------------------ */
  function generarPlantilla() {
    const headers = ['Codigo', 'Descripcion', 'Laboratorio', 'Conservacion', 'Ubicacion', 'Stock',
                     'Stock Minimo', 'Stock Maximo', 'Consumo Mensual', 'Lote', 'Vencimiento'];
    const filas = [
      ['AZ-101', 'Tagrisso 80mg x30 comp',   'ASTRAZENECA',        'Ambiente', 'B01-C01', 140,  60, 320,  95, 'AZ4411', '2027-08-31'],
      ['RO-201', 'Herceptin 440mg vial',     'ROCHE',              'Frio',     'CF-B1',     4,  10,  40,  14, 'RO8801', '2027-05-31'],
      ['AM-401', 'Neulasta 6mg jeringa',     'AMGEN',              'Frio',     'CF-D1',     8,  15,  60,  22, 'AM9901', '2027-06-30'],
      ['BS-601', 'Bioyetin 4000 UI x6 amp',  'BIOSIDUS ARGENTINA', 'Frio',     'DEP-F2',   96,  40, 200,  72, 'BS1101', '2027-04-30']
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers].concat(filas));
    ws['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 20 }, { wch: 13 }, { wch: 11 }, { wch: 8 },
                   { wch: 12 }, { wch: 14 }, { wch: 15 }, { wch: 10 }, { wch: 13 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock VLM');
    XLSX.writeFile(wb, 'plantilla_vlm.xlsx');
  }

  return {
    CAMPOS, leerArchivo, hojaAMatriz, detectarFilaEncabezado,
    autoMapear, normalizar, generarPlantilla,
    detectarFormatoFecha, hayRepetidos, agrupar
  };
})();
