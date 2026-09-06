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

    { id: 'descripcion', label: 'Descripción', req: true, tipo: 'texto',
      hint: 'Nombre del producto',
      alias: ['descripcion', 'desc', 'producto', 'nombre', 'detalle', 'articulo', 'denominacion', 'descripcion articulo'] },

    { id: 'laboratorio', label: 'Laboratorio', req: true, tipo: 'texto',
      hint: 'Se usa para agrupar los productos',
      alias: ['laboratorio', 'lab', 'proveedor', 'marca', 'fabricante', 'droguería', 'drogueria', 'laboratorio proveedor'] },

    { id: 'stock', label: 'Stock actual', req: true, tipo: 'numero',
      hint: 'Unidades disponibles hoy',
      alias: ['stock', 'stock actual', 'cantidad', 'cant', 'existencia', 'existencias', 'saldo', 'disponible', 'unidades', 'qty', 'cantidad actual', 'stock real'] },

    { id: 'ubicacion', label: 'Ubicación en VLM', req: false, tipo: 'texto',
      hint: 'Bandeja / charola / posición',
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
      hint: '',
      alias: ['lote', 'batch', 'partida', 'nro lote'] },

    { id: 'vencimiento', label: 'Vencimiento', req: false, tipo: 'fecha',
      hint: 'Fecha de caducidad',
      alias: ['vencimiento', 'vto', 'vence', 'caducidad', 'fecha vencimiento', 'fecha vto', 'expira', 'expiry'] },

    { id: 'precio', label: 'Precio unitario', req: false, tipo: 'numero',
      hint: 'Para valorizar el stock',
      alias: ['precio', 'precio unitario', 'costo', 'costo unitario', 'valor', 'valor unitario', 'pvp', 'importe unitario'] }
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

  /** Puntaje difuso: exacto > empieza-con > contiene. */
  function puntuarAlias(header, campo) {
    const n = U.norm(header);
    if (!n) return 0;
    let mejor = 0;
    for (const a of campo.alias) {
      if (n === a) return 100;
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
     Normalización de filas -> productos
     ------------------------------------------------------------ */

  /**
   * Convierte la matriz + mapeo en registros normalizados y los clasifica
   * contra el catálogo de laboratorios (ámbito VLM/externo y conservación).
   * @returns { productos, descartadas, avisos, noListados }
   */
  function normalizar(matriz, filaHeader, mapa, cfg, catalogo) {
    const productos = [];
    const avisos = [];
    let descartadas = 0;
    const diasMes = (cfg && cfg.diasMes) || 30;
    catalogo = catalogo || VLM.labs.catalogoDefault();

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

      productos.push(VLM.labs.clasificar({
        codigo:        String(codigo === null ? '' : codigo).trim() || ('#' + (productos.length + 1)),
        descripcion:   String(desc === null ? '' : desc).trim() || '(sin descripción)',
        laboratorio:   lab,
        zonaPlanilla:  VLM.labs.parsearConservacion(get(fila, 'conservacion'), headerCons),
        ubicacion:     String(get(fila, 'ubicacion') || '').trim(),
        stock:         stock,
        stockMin:      U.toNum(get(fila, 'stockMin')) || 0,
        stockMax:      U.toNum(get(fila, 'stockMax')) || 0,
        consumoDiario: consumoDiario,
        consumoMensual: consMensual !== null ? consMensual : (consumoDiario ? consumoDiario * diasMes : 0),
        fuenteConsumo: fuenteConsumo,
        lote:          String(get(fila, 'lote') || '').trim(),
        vencimiento:   U.toDate(get(fila, 'vencimiento')),
        precio:        U.toNum(get(fila, 'precio')) || 0
      }, catalogo));
    }

    // --- laboratorios de la planilla que no están en el catálogo ---
    const noListados = {};
    productos.forEach(p => {
      if (p.gestionado) return;
      if (!noListados[p.laboratorio]) noListados[p.laboratorio] = 0;
      noListados[p.laboratorio]++;
    });
    const nombresNoListados = Object.keys(noListados);

    if (!productos.length) avisos.push('No se pudo leer ninguna fila válida. Revisá la fila de encabezados y el mapeo.');
    if (descartadas > 0)   avisos.push(descartadas + ' fila(s) omitidas por estar vacías o sin stock numérico.');
    if (mapa.consumoDiario === undefined && mapa.consumoMensual === undefined) {
      avisos.push('Sin columna de consumo: no se podrán calcular días de cobertura ni proyección.');
    }
    if (mapa.stockMin === undefined && mapa.consumoDiario === undefined && mapa.consumoMensual === undefined) {
      avisos.push('Sin stock mínimo ni consumo: las alertas de faltante quedarán vacías.');
    }
    if (mapa.conservacion === undefined) {
      avisos.push('Sin columna de conservación: se usa el valor por defecto de cada laboratorio (editable en Configuración).');
    }
    if (nombresNoListados.length) {
      avisos.push(nombresNoListados.length + ' laboratorio(s) fuera del catálogo: ' +
        nombresNoListados.slice(0, 4).join(', ') +
        (nombresNoListados.length > 4 ? '…' : '') + '.');
    }
    return { productos, descartadas, avisos, noListados, nombresNoListados };
  }

  /* ------------------------------------------------------------
     Plantilla descargable
     ------------------------------------------------------------ */
  function generarPlantilla() {
    const headers = ['Codigo', 'Descripcion', 'Laboratorio', 'Conservacion', 'Ubicacion', 'Stock',
                     'Stock Minimo', 'Stock Maximo', 'Consumo Mensual', 'Lote', 'Vencimiento', 'Precio'];
    const filas = [
      ['AZ-101', 'Tagrisso 80mg x30 comp',   'ASTRAZENECA',        'Ambiente', 'B01-C01', 140,  60, 320,  95, 'AZ4411', '2027-08-31', 2480000],
      ['RO-201', 'Herceptin 440mg vial',     'ROCHE',              'Frio',     'CF-B1',     4,  10,  40,  14, 'RO8801', '2027-05-31', 4120000],
      ['AM-401', 'Neulasta 6mg jeringa',     'AMGEN',              'Frio',     'CF-D1',     8,  15,  60,  22, 'AM9901', '2027-06-30', 1240000],
      ['BS-601', 'Bioyetin 4000 UI x6 amp',  'BIOSIDUS ARGENTINA', 'Frio',     'DEP-F2',   96,  40, 200,  72, 'BS1101', '2027-04-30',  148000]
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers].concat(filas));
    ws['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 20 }, { wch: 13 }, { wch: 11 }, { wch: 8 },
                   { wch: 12 }, { wch: 14 }, { wch: 15 }, { wch: 10 }, { wch: 13 }, { wch: 11 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Stock VLM');
    XLSX.writeFile(wb, 'plantilla_vlm.xlsx');
  }

  return {
    CAMPOS, leerArchivo, hojaAMatriz, detectarFilaEncabezado,
    autoMapear, normalizar, generarPlantilla
  };
})();
