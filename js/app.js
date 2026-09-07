/* ============================================================
   app.js · arranque, navegación, importación y configuración
   ============================================================ */
window.VLM = window.VLM || {};

VLM.app = (function () {
  const U = VLM.util;
  const S = VLM.store;
  const P = VLM.parser;
  const A = VLM.analytics;
  const V = VLM.views;
  const $ = U.$, $$ = U.$$;

  let calculados = null;    // productos con métricas, cache por render

  /* ============================================================
     ARRANQUE
     ============================================================ */
  function init() {
    if (typeof XLSX === 'undefined' || typeof Chart === 'undefined') {
      U.toast('No se pudieron cargar las librerías (¿sin internet?)', 'err');
    }
    S.cargar();
    aplicarTema(S.state.ui.tema);
    wireTopbar();
    wireTabs();
    wireZonebar();
    wireImport();
    wireSettings();
    S.on(motivo => {
      if (motivo === 'labs') reclasificar();
      if (motivo === 'cfg' || motivo === 'datos') calculados = null;
      render();
    });
    render();
    setInterval(actualizarEstado, 60000);
  }

  /** Reaplica el catálogo de laboratorios sobre los productos ya cargados. */
  function reclasificar() {
    const cat = S.state.labs;
    S.state.productos.forEach(p => VLM.labs.clasificar(p, cat));
    S.guardar();
    calculados = null;
  }

  /**
   * Productos que se muestran: calculados, sin los laboratorios fuera del
   * catálogo (si así está configurado) y filtrados por ámbito y conservación.
   */
  function itemsVisibles() {
    const cfg = S.state.cfg, ui = S.state.ui;
    if (!calculados) {
      // el consumo diario sale del historial cuando la planilla no lo trae
      const consumoHist = cfg.historialActivo
        ? A.consumoPorSku(S.state.historial, cfg.ventanaConsumo) : null;
      calculados = A.calcular(S.state.productos, cfg, consumoHist);
    }
    let items = calculados;
    if (cfg.labsNoListados === 'excluir') items = items.filter(p => p.gestionado);
    return A.filtrarPorZona(items, ui);
  }

  /** Historial de consumo real, ya recortado a la ventana configurada. */
  function historialActual() {
    if (!S.state.cfg.historialActivo) {
      return { activo: false, suficiente: false, periodos: [], snapshots: 0 };
    }
    const h = A.historialConsumo(S.state.historial, S.state.cfg.diasHistorial);
    h.activo = true;
    return h;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    const hay = S.hayDatos();
    $('#empty').hidden = hay;
    $('#tabs').hidden = !hay;
    $('#zonebar').hidden = !hay;
    $$('.view').forEach(v => v.hidden = true);
    actualizarEstado();
    if (!hay) return;

    const cfg = S.state.cfg;
    const items = itemsVisibles();
    sincronizarZonebar(items);

    const vista = S.state.ui.vista;
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === vista));
    const el = $('#view-' + vista);
    if (!el) return;
    el.hidden = false;

    if (!items.length) {
      el.innerHTML = '<div class="no-results"><strong>Ningún producto coincide con el filtro</strong><br>' +
        '<span class="small">Probá con “Todo” y “Todas” en la barra de arriba.</span></div>';
      return;
    }

    const hist = historialActual();
    try {
      if (vista === 'dashboard') V.dashboard(el, items, cfg, hist);
      else if (vista === 'labs')  V.laboratorios(el, items, cfg);
      else if (vista === 'repo')  V.reposicion(el, items, cfg);
      else if (vista === 'inv')   V.inventario(el, items, cfg);
    } catch (e) {
      console.error(e);
      el.innerHTML = '<div class="no-results"><strong>Error al dibujar la vista</strong><br>' +
        '<span class="small">' + U.esc(e.message) + '</span></div>';
    }

    // botones "ir a otra vista" dentro de las vistas
    $$('[data-goto]', el).forEach(b => b.addEventListener('click', () => irA(b.dataset.goto)));

    // clic en tarjeta de laboratorio -> filtrar reposición
    $$('.lab-card', el).forEach(c => c.addEventListener('click', () => {
      S.setUi({ filtroLab: c.dataset.lab, filtroEstado: null, vista: 'repo' });
    }));

    if (VLM.tv.activo) VLM.tv.refrescar(items, cfg, hist);
  }

  /* ---------- barra de ámbito / conservación ---------- */

  function wireZonebar() {
    $$('#zonebar .seg').forEach(seg => {
      const clave = seg.dataset.key;
      U.$$('.seg-btn', seg).forEach(btn => btn.addEventListener('click', () => {
        S.setUi({ [clave]: btn.dataset.val || null });
      }));
    });
  }

  function sincronizarZonebar(items) {
    const ui = S.state.ui;
    $$('#zonebar .seg').forEach(seg => {
      const actual = ui[seg.dataset.key] || '';
      U.$$('.seg-btn', seg).forEach(btn =>
        btn.classList.toggle('is-active', btn.dataset.val === actual));
    });

    const total = S.state.productos.length;
    const excluidos = S.state.cfg.labsNoListados === 'excluir'
      ? S.state.productos.filter(p => !p.gestionado).length : 0;
    let txt = items.length + ' de ' + total + ' productos';
    if (excluidos) txt += ' · ' + excluidos + ' fuera del catálogo de laboratorios';
    $('#zoneCount').textContent = txt;
  }

  function actualizarEstado() {
    const meta = S.state.meta;
    const dot = $('#statusDot'), txt = $('#statusText');
    if (!S.hayDatos()) {
      dot.className = 'dot';
      txt.textContent = 'Sin datos cargados';
      return;
    }
    const edad = Date.now() - (meta.importadoEn || 0);
    dot.className = 'dot ' + (edad > 12 * 3600e3 ? 'stale' : 'live');
    txt.innerHTML = U.esc(meta.archivo || 'datos') + ' · ' +
      S.state.productos.length + ' productos · <strong>' + U.hace(meta.importadoEn) + '</strong>';
  }

  function irA(vista) {
    S.setUi({ vista: vista });
  }

  /* ============================================================
     TOPBAR / NAV
     ============================================================ */
  function wireTopbar() {
    $('#btnImport').addEventListener('click', abrirImport);
    $('#btnImport2').addEventListener('click', abrirImport);
    $('#btnDemo').addEventListener('click', cargarDemo);
    $('#btnTemplate').addEventListener('click', e => { e.preventDefault(); P.generarPlantilla(); });
    $('#btnSettings').addEventListener('click', abrirSettings);
    $('#btnTheme').addEventListener('click', () => {
      aplicarTema(S.state.ui.tema === 'dark' ? 'light' : 'dark');
      render();
    });
    $('#btnTV').addEventListener('click', () => {
      VLM.tv.entrar(itemsVisibles(), S.state.cfg, historialActual());
    });
    $('#tvExit').addEventListener('click', () => VLM.tv.salir());

    // cierre genérico de modales
    $$('.modal').forEach(m => {
      m.addEventListener('click', e => {
        if (e.target === m || e.target.closest('[data-close]')) m.hidden = true;
      });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !VLM.tv.activo) $$('.modal').forEach(m => m.hidden = true);
    });
  }

  function wireTabs() {
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      S.setUi({ vista: t.dataset.view, filtroEstado: null, busqueda: '' });
    }));
  }

  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    S.setUi({ tema: tema }, true);
  }

  /* ============================================================
     IMPORTACIÓN
     ============================================================ */
  const imp = { wb: null, hojas: [], nombre: '', matriz: [], headers: [], mapa: {}, filaHeader: 0 };

  function abrirImport() {
    $('#modalImport').hidden = false;
    $('#impStep1').hidden = false;
    $('#impStep2').hidden = true;
    $('#btnDoImport').hidden = true;
    $('#impMsg').textContent = '';
    $('#fileInput').value = '';
  }

  function wireImport() {
    const dz = $('#dropzone'), input = $('#fileInput');

    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]); });

    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.add('is-over');
    }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault(); dz.classList.remove('is-over');
    }));
    dz.addEventListener('drop', e => {
      const f = e.dataTransfer.files[0];
      if (f) procesarArchivo(f);
    });

    // soltar el archivo en cualquier parte de la app abre el asistente
    ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => {
      if (e.type === 'dragover') { e.preventDefault(); return; }
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f && !VLM.tv.activo) { abrirImport(); procesarArchivo(f); }
    }));

    $('#selSheet').addEventListener('change', () => cargarHoja($('#selSheet').value, true));
    $('#inpHeaderRow').addEventListener('change', () => {
      imp.filaHeader = Math.max(0, (parseInt($('#inpHeaderRow').value, 10) || 1) - 1);
      releerHeaders(true);
    });
    $('#btnDoImport').addEventListener('click', confirmarImport);
    $('#impAgrupar').addEventListener('change', pintarPreview);
  }

  function procesarArchivo(file) {
    $('#impMsg').textContent = 'Leyendo ' + file.name + '…';
    P.leerArchivo(file).then(r => {
      imp.wb = r.wb; imp.hojas = r.hojas; imp.nombre = r.nombre;
      $('#impFileName').textContent = r.nombre;
      $('#selSheet').innerHTML = r.hojas.map(h => '<option>' + U.esc(h) + '</option>').join('');
      $('#impStep1').hidden = true;
      $('#impStep2').hidden = false;
      $('#btnDoImport').hidden = false;
      cargarHoja(r.hojas[0], false);
    }).catch(err => {
      $('#impMsg').textContent = '';
      U.toast(err.message, 'err');
    });
  }

  function cargarHoja(nombre, reautoMapear) {
    imp.hoja = nombre;
    imp.matriz = P.hojaAMatriz(imp.wb, nombre);
    if (!imp.matriz.length) {
      $('#impMsg').textContent = 'La hoja "' + nombre + '" está vacía';
      $('#mapList').innerHTML = ''; $('#prevTable').innerHTML = '';
      return;
    }
    imp.filaHeader = P.detectarFilaEncabezado(imp.matriz);
    $('#inpHeaderRow').value = imp.filaHeader + 1;
    releerHeaders(true);
  }

  function releerHeaders(auto) {
    const fila = imp.matriz[imp.filaHeader] || [];
    const ancho = imp.matriz.reduce((m, f) => Math.max(m, f ? f.length : 0), 0);
    imp.headers = [];
    for (let i = 0; i < ancho; i++) {
      const h = fila[i];
      imp.headers.push(h === null || h === undefined || h === ''
        ? 'Columna ' + colLetra(i) : String(h).trim());
    }
    if (auto) imp.mapa = P.autoMapear(imp.headers);
    pintarMapeo();
    pintarPreview();
  }

  function colLetra(i) {
    let s = '';
    i++;
    while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }

  function pintarMapeo() {
    const html = P.CAMPOS.map(campo => {
      const sel = imp.mapa[campo.id];
      const falta = campo.req && (sel === undefined || sel === null);
      return '<div class="map-row ' + (campo.req ? 'is-req ' : '') + (falta ? 'is-missing' : '') + '">' +
        '<label>' + U.esc(campo.label) + (campo.req ? '<span class="req">*</span>' : '') + '</label>' +
        '<select data-campo="' + campo.id + '">' +
          '<option value="">— sin asignar —</option>' +
          imp.headers.map((h, i) =>
            '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' +
            colLetra(i) + ' · ' + U.esc(h) + '</option>').join('') +
        '</select>' +
        (campo.hint ? '<span class="hint">' + U.esc(campo.hint) + '</span>' : '') +
        '</div>';
    }).join('');
    $('#mapList').innerHTML = html;

    $$('#mapList select').forEach(s => s.addEventListener('change', () => {
      const campo = s.dataset.campo;
      const val = s.value === '' ? undefined : parseInt(s.value, 10);
      if (val === undefined) delete imp.mapa[campo]; else imp.mapa[campo] = val;
      pintarMapeo();
      pintarPreview();
    }));
    validarMapeo();
  }

  function validarMapeo() {
    const faltan = P.CAMPOS.filter(c => c.req && imp.mapa[c.id] === undefined);
    const btn = $('#btnDoImport');
    btn.disabled = faltan.length > 0;
    $('#impMsg').textContent = faltan.length
      ? 'Falta asignar: ' + faltan.map(c => c.label).join(', ')
      : 'Listo para importar';
    return faltan.length === 0;
  }

  function pintarPreview() {
    const r = P.normalizar(imp.matriz, imp.filaHeader, imp.mapa, S.state.cfg, S.state.labs,
                           { agrupar: $('#impAgrupar').checked });
    imp.resultado = r;

    // la opción de agrupar sólo aparece si la planilla realmente repite códigos
    $('#impAgruparWrap').hidden = !r.repetidos;
    $('#impAgruparInfo').textContent = r.repetidos
      ? (r.agrupado ? '· ' + r.filasLeidas + ' filas → ' + r.productos.length + ' productos'
                    : '· ' + r.filasLeidas + ' filas sin agrupar')
      : '';

    const muestra = r.productos.slice(0, 8);
    $('#prevCount').textContent = r.productos.length
      ? '· ' + r.productos.length + (r.agrupado ? ' productos' : ' filas') +
        (r.descartadas ? ' (' + r.descartadas + ' omitidas)' : '')
      : '· sin filas válidas';

    if (!muestra.length) {
      $('#prevTable').innerHTML = '<tbody><tr><td><div class="no-results">' +
        'No se detectaron filas. Revisá la fila de encabezados y que la columna de stock tenga números.' +
        '</div></td></tr></tbody>';
      return;
    }
    const cols = ['codigo', 'descripcion', 'laboratorio', 'ubicacion', 'stock', 'stockMin', 'consumoDiario'];
    const labels = ['Código', 'Descripción', 'Laboratorio', 'Ubicación', 'Stock', 'Mínimo', 'Cons./día'];
    $('#prevTable').innerHTML =
      '<thead><tr>' + labels.map(l => '<th class="no-sort">' + l + '</th>').join('') + '</tr></thead>' +
      '<tbody>' + muestra.map(p => '<tr>' + cols.map(c => {
        const v = p[c];
        const num = typeof v === 'number';
        return '<td class="' + (num ? 't-num' : '') + '">' +
          U.esc(num ? U.fmt(v, c === 'consumoDiario') : (v || '—')) + '</td>';
      }).join('') + '</tr>').join('') + '</tbody>';
  }

  function confirmarImport() {
    if (!validarMapeo()) return;
    const r = imp.resultado || P.normalizar(imp.matriz, imp.filaHeader, imp.mapa, S.state.cfg, S.state.labs,
                                            { agrupar: $('#impAgrupar').checked });
    if (!r.productos.length) { U.toast('No hay filas válidas para importar', 'err'); return; }

    S.setProductos(r.productos, {
      archivo: imp.nombre,
      hoja: imp.hoja,
      filas: r.productos.length,
      importadoEn: Date.now(),
      mapeo: Object.assign({}, imp.mapa)
    });
    $('#modalImport').hidden = true;
    U.toast('Importados ' + r.productos.length + ' productos', 'ok');
    r.avisos.forEach(a => U.toast(a));
  }

  /* ============================================================
     DATOS DE EJEMPLO
     ============================================================ */
  const DEMO = [
    ['Codigo','Descripcion','Laboratorio','Conservacion','Ubicacion','Stock','Stock Minimo','Stock Maximo','Consumo Mensual','Lote','Vencimiento'],

    // --- ASTRAZENECA · VLM ---
    ['AZ-101','Tagrisso 80mg x30 comp','ASTRAZENECA','Ambiente','B01-C01',140,60,320,95,'AZ4411','2027-08-31'],
    ['AZ-102','Forxiga 10mg x28 comp','ASTRAZENECA','Ambiente','B01-C02',62,80,400,150,'AZ4418','2027-11-30'],
    ['AZ-103','Crestor 20mg x30 comp','ASTRAZENECA','Ambiente','B01-C03',410,120,600,185,'AZ4423','2028-02-28'],
    ['AZ-104','Symbicort 160/4.5 turbuhaler','ASTRAZENECA','Ambiente','B01-C04',228,90,450,140,'AZ4430','2027-06-30'],
    ['AZ-105','Imfinzi 500mg vial','ASTRAZENECA','Frio','CF-A1',18,12,60,26,'AZ7702','2027-03-31'],
    ['AZ-106','Faslodex 250mg jeringa x2','ASTRAZENECA','Frio','CF-A2',34,20,90,38,'AZ7715','2027-09-30'],

    // --- ROCHE · VLM ---
    ['RO-201','Herceptin 440mg vial','ROCHE','Frio','CF-B1',4,10,40,14,'RO8801','2027-05-31'],
    ['RO-202','MabThera 500mg vial','ROCHE','Frio','CF-B2',11,10,45,17,'RO8809','2027-07-31'],
    ['RO-203','Avastin 400mg vial','ROCHE','Frio','CF-B3',26,14,60,22,'RO8814','2028-01-31'],
    ['RO-204','Actemra 400mg vial','ROCHE','Frio','CF-B4',31,12,50,15,'RO8820','2027-10-31'],
    ['RO-205','Xeloda 500mg x120 comp','ROCHE','Ambiente','B02-C01',96,45,220,68,'RO3310','2028-04-30'],
    ['RO-206','Tamiflu 75mg x10 caps','ROCHE','Ambiente','B02-C02',315,100,500,120,'RO3318','2027-12-31'],

    // --- SANOFI AVENTIS · VLM ---
    ['SA-301','Lantus SoloStar 100UI x5','SANOFI AVENTIS','Frio','CF-C1',0,20,90,45,'SA5501','2027-02-28'],
    ['SA-302','Toujeo SoloStar 300UI x3','SANOFI AVENTIS','Frio','CF-C2',22,18,80,36,'SA5508','2027-04-30'],
    ['SA-303','Plavix 75mg x28 comp','SANOFI AVENTIS','Ambiente','B03-C01',520,150,700,210,'SA2210','2028-06-30'],
    ['SA-304','Clexane 40mg jeringa x10','SANOFI AVENTIS','Ambiente','B03-C02',148,80,380,165,'SA2217','2027-09-30'],
    ['SA-305','Aubagio 14mg x28 comp','SANOFI AVENTIS','Ambiente','B03-C03',73,40,180,55,'SA2224','2027-11-30'],
    ['SA-306','Taxotere 80mg vial','SANOFI AVENTIS','Ambiente','B03-C04',41,25,110,32,'SA2231','2028-03-31'],

    // --- AMGEN · VLM (biológicos, todo cadena de frío) ---
    ['AM-401','Neulasta 6mg jeringa','AMGEN','Frio','CF-D1',8,15,60,22,'AM9901','2027-06-30'],
    ['AM-402','Prolia 60mg jeringa','AMGEN','Frio','CF-D2',37,20,85,29,'AM9908','2027-08-31'],
    ['AM-403','Xgeva 120mg vial','AMGEN','Frio','CF-D3',24,16,70,25,'AM9914','2028-01-31'],
    ['AM-404','Aranesp 40mcg jeringa x4','AMGEN','Frio','CF-D4',52,25,120,34,'AM9920','2027-10-31'],
    ['AM-405','Repatha 140mg lapicera x2','AMGEN','Frio','CF-D5',19,22,95,41,'AM9927','2027-05-31'],

    // --- ABBVIE · fuera del VLM ---
    ['AB-501','Humira 40mg jeringa x2','ABBVIE','Frio','DEP-F1',13,18,75,31,'AB6601','2027-07-31'],
    ['AB-502','Venclexta 100mg x28 comp','ABBVIE','Ambiente','DEP-A3',44,25,120,38,'AB6608','2028-02-29'],
    ['AB-503','Creon 25000 x50 caps','ABBVIE','Ambiente','DEP-A4',186,70,340,112,'AB6615','2028-05-31'],
    ['AB-504','Rinvoq 15mg x28 comp','ABBVIE','Ambiente','DEP-A5',58,30,140,46,'AB6622','2027-12-31'],

    // --- BIOSIDUS ARGENTINA · fuera del VLM ---
    ['BS-601','Bioyetin 4000 UI x6 amp','BIOSIDUS ARGENTINA','Frio','DEP-F2',96,40,200,72,'BS1101','2027-04-30'],
    ['BS-602','Neutromax 300mcg x5 jeringa','BIOSIDUS ARGENTINA','Frio','DEP-F3',28,30,130,58,'BS1108','2027-06-30'],
    ['BS-603','Bioferon 3MUI x5 amp','BIOSIDUS ARGENTINA','Frio','DEP-F4',61,25,110,34,'BS1115','2028-01-31'],

    // --- fuera del catálogo: se excluyen, pero la app avisa cuántos son ---
    ['GA-701','Ibuprofeno 600mg x20 comp','GADOR','Ambiente','B09-C01',480,150,700,260,'GA0110','2028-03-31'],
    ['EL-702','Losartan 50mg x30 comp','ELEA','Ambiente','B09-C02',312,120,600,195,'EL0220','2027-10-31']
  ];

  function cargarDemo() {
    const mapa = P.autoMapear(DEMO[0]);
    const r = P.normalizar(DEMO, 0, mapa, S.state.cfg, S.state.labs);
    S.limpiarHistorial();
    if (S.state.cfg.historialActivo) sembrarHistorialDemo(r.productos, 21);
    S.setProductos(r.productos, {
      archivo: 'Datos de ejemplo',
      hoja: 'demo',
      filas: r.productos.length,
      importadoEn: Date.now(),
      mapeo: mapa,
      demo: true
    });
    U.toast('Cargados ' + r.productos.length + ' productos de ejemplo', 'ok');
  }

  /**
   * Inventa N días de importaciones previas para que el demo tenga historial.
   * Va hacia atrás desde el stock actual: cada día anterior tenía algo más de
   * stock (lo consumido), y de vez en cuando entra una reposición.
   * Sólo para la demo: con datos reales el historial se arma importando.
   */
  function sembrarHistorialDemo(productos, dias) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    // semilla fija para que el demo se vea igual siempre
    let semilla = 20260906;
    const rnd = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };

    const stock = {};
    productos.forEach(p => { stock[p.codigo] = p.stock; });

    const snaps = [];
    for (let d = 0; d < dias; d++) {
      const fecha = U.addDias(hoy, -d);
      snaps.push({
        dia: fecha.getFullYear() + '-' + String(fecha.getMonth() + 1).padStart(2, '0') +
             '-' + String(fecha.getDate()).padStart(2, '0'),
        ts: fecha.getTime(),
        archivo: 'Datos de ejemplo',
        skus: productos.length,
        total: Object.keys(stock).reduce((s, k) => s + stock[k], 0),
        porSku: Object.assign({}, stock),
        demo: true
      });
      // retroceder un día: sumar lo consumido y descontar reposiciones
      productos.forEach(p => {
        const base = Math.max(p.stockMin || 1, p.stock || 1);
        const consumo = Math.round(base * (0.02 + rnd() * 0.05));
        stock[p.codigo] += consumo;
        if (rnd() < 0.06) stock[p.codigo] = Math.max(0, stock[p.codigo] - Math.round(base * 0.4));
      });
    }
    snaps.reverse().forEach(s => S.state.historial.push(s));
  }

  /* ============================================================
     CONFIGURACIÓN
     ============================================================ */
  const CAMPOS_CFG = [
    ['cfgDiasCritico', 'diasCritico', 'int'],
    ['cfgDiasBajo', 'diasBajo', 'int'],
    ['cfgDiasObjetivo', 'diasObjetivo', 'int'],
    ['cfgFactorBajo', 'factorBajo', 'float'],
    ['cfgHistorialActivo', 'historialActivo', 'bool'],
    ['cfgVentanaConsumo', 'ventanaConsumo', 'int'],
    ['cfgDiasHistorial', 'diasHistorial', 'int'],
    ['cfgTvSegundos', 'tvSegundos', 'int'],
    ['cfgTvSoloCriticos', 'tvSoloCriticos', 'bool']
  ];

  function abrirSettings() {
    CAMPOS_CFG.forEach(([id, clave, tipo]) => {
      const el = $('#' + id);
      if (tipo === 'bool') el.checked = !!S.state.cfg[clave];
      else el.value = S.state.cfg[clave];
    });
    $('#cfgIncluirNoListados').checked = S.state.cfg.labsNoListados === 'incluir';
    pintarLabsEditor();
    actualizarHistInfo();
    $('#modalSettings').hidden = false;
  }

  function actualizarHistInfo() {
    const activo = S.state.cfg.historialActivo;
    $('#histOpciones').hidden = !activo;
    if (!activo) return;
    const h = S.state.historial;
    const el = $('#histInfo');
    if (!h.length) { el.textContent = 'Sin importaciones guardadas todavía.'; return; }
    el.textContent = h.length + (h.length === 1 ? ' importación guardada' : ' importaciones guardadas') +
      ' · del ' + h[0].dia + ' al ' + h[h.length - 1].dia +
      ' · máximo ' + S.MAX_SNAPSHOTS;
  }

  /* ---------- catálogo de laboratorios ---------- */

  function pintarLabsEditor() {
    const L = VLM.labs;
    const labs = S.state.labs;
    const cont = $('#labsEditor');

    cont.innerHTML =
      '<div class="labs-head"><span>Laboratorio</span><span>Ámbito</span><span>Conservación</span><span></span></div>' +
      labs.map((l, i) =>
        '<div class="lab-row" data-i="' + i + '">' +
          '<div>' +
            '<input type="text" data-campo="nombre" value="' + U.esc(l.nombre) + '" placeholder="Nombre">' +
            '<span class="lab-alias">Reconoce: ' + U.esc(l.alias.join(', ')) + '</span>' +
          '</div>' +
          '<select data-campo="ambito">' +
            Object.keys(L.AMBITOS).map(k => '<option value="' + k + '"' +
              (l.ambito === k ? ' selected' : '') + '>' + L.AMBITOS[k].corto + '</option>').join('') +
          '</select>' +
          '<select data-campo="zona">' +
            Object.keys(L.ZONAS).map(k => '<option value="' + k + '"' +
              (l.zona === k ? ' selected' : '') + '>' + L.ZONAS[k].icono + ' ' + L.ZONAS[k].corto + '</option>').join('') +
          '</select>' +
          '<button class="btn btn-icon lab-row-del" title="Quitar del catálogo">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>' +
        '</div>').join('');

    U.$$('.lab-row', cont).forEach(row => {
      const i = +row.dataset.i;
      U.$$('input, select', row).forEach(campo => campo.addEventListener('change', () => {
        const labs2 = S.state.labs.slice();
        const l = Object.assign({}, labs2[i]);
        const valor = campo.value.trim();
        if (campo.dataset.campo === 'nombre') {
          if (!valor) { campo.value = l.nombre; return; }
          l.nombre = valor;
          // el nombre siempre tiene que estar entre los alias reconocidos
          if (!l.alias.some(a => U.norm(a) === U.norm(valor))) l.alias = [valor].concat(l.alias);
        } else {
          l[campo.dataset.campo] = valor;
        }
        labs2[i] = l;
        S.setLabs(labs2);
        pintarLabsEditor();
      }));
      U.$('.lab-row-del', row).addEventListener('click', () => {
        const l = S.state.labs[i];
        if (!confirm('¿Quitar "' + l.nombre + '" del catálogo?\n\nSus productos dejarán de mostrarse.')) return;
        S.setLabs(S.state.labs.filter((_, j) => j !== i));
        pintarLabsEditor();
      });
    });
  }

  function agregarLab() {
    const nombre = (prompt('Nombre del laboratorio:') || '').trim();
    if (!nombre) return;
    if (S.state.labs.some(l => U.norm(l.nombre) === U.norm(nombre))) {
      U.toast('Ese laboratorio ya está en el catálogo', 'err');
      return;
    }
    S.setLabs(S.state.labs.concat([{
      id: U.norm(nombre).replace(/ /g, '-') || ('lab' + Date.now()),
      nombre: nombre,
      alias: [nombre],
      ambito: 'vlm',
      zona: 'ambiente'
    }]));
    pintarLabsEditor();
    U.toast('Agregado: ' + nombre, 'ok');
  }

  function wireSettings() {
    CAMPOS_CFG.forEach(([id, clave, tipo]) => {
      $('#' + id).addEventListener('change', e => {
        let v;
        if (tipo === 'bool') v = e.target.checked;
        else if (tipo === 'float') v = parseFloat(e.target.value);
        else v = parseInt(e.target.value, 10);
        if (tipo !== 'bool' && (!isFinite(v) || v < 0)) { e.target.value = S.state.cfg[clave]; return; }
        S.setCfg({ [clave]: v });
        if (clave === 'historialActivo') {
          actualizarHistInfo();
          if (v) U.toast('Historial activado. Se guarda desde la próxima importación.', 'ok');
        }
      });
    });

    $('#btnClearHist').addEventListener('click', () => {
      if (!confirm('¿Borrar el historial de importaciones?\n\nSe pierde el consumo calculado y hay que ' +
                   'volver a acumular al menos 2 días para recuperarlo.')) return;
      S.limpiarHistorial();
      calculados = null;
      actualizarHistInfo();
      U.toast('Historial borrado');
    });

    $('#btnAddLab').addEventListener('click', agregarLab);
    $('#btnResetLabs').addEventListener('click', () => {
      if (!confirm('¿Restaurar el catálogo original de laboratorios?')) return;
      S.resetLabs();
      pintarLabsEditor();
      U.toast('Catálogo restaurado', 'ok');
    });
    $('#cfgIncluirNoListados').addEventListener('change', e => {
      S.setCfg({ labsNoListados: e.target.checked ? 'incluir' : 'excluir' });
    });

    $('#btnExportCsv').addEventListener('click', () => {
      if (!S.hayDatos()) { U.toast('No hay datos cargados', 'err'); return; }
      const items = itemsVisibles();
      V.exportarRepo(
        items.filter(p => ['agotado', 'critico', 'bajo'].indexOf(p.estado) > -1)
             .sort((a, b) => a.urgencia - b.urgencia),
        S.state.cfg
      );
    });

    $('#btnClearData').addEventListener('click', () => {
      if (!confirm('¿Borrar los datos cargados? Esta acción no se puede deshacer.')) return;
      S.limpiar();
      $('#modalSettings').hidden = true;
      U.toast('Datos borrados');
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { render, irA, cargarDemo };
})();
