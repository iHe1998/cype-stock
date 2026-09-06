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
    wireImport();
    wireSettings();
    S.on(motivo => {
      if (motivo === 'cfg' || motivo === 'datos') calculados = null;
      render();
    });
    render();
    setInterval(actualizarEstado, 60000);
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    const hay = S.hayDatos();
    $('#empty').hidden = hay;
    $('#tabs').hidden = !hay;
    $$('.view').forEach(v => v.hidden = true);
    actualizarEstado();
    if (!hay) return;

    const cfg = S.state.cfg;
    if (!calculados) calculados = A.calcular(S.state.productos, cfg);

    const vista = S.state.ui.vista;
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === vista));
    const el = $('#view-' + vista);
    if (!el) return;
    el.hidden = false;

    try {
      if (vista === 'dashboard') V.dashboard(el, calculados, cfg);
      else if (vista === 'labs')  V.laboratorios(el, calculados, cfg);
      else if (vista === 'repo')  V.reposicion(el, calculados, cfg);
      else if (vista === 'inv')   V.inventario(el, calculados, cfg);
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

    if (VLM.tv.activo) VLM.tv.refrescar(calculados, cfg);
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
      if (!calculados) calculados = A.calcular(S.state.productos, S.state.cfg);
      VLM.tv.entrar(calculados, S.state.cfg);
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
    const r = P.normalizar(imp.matriz, imp.filaHeader, imp.mapa, S.state.cfg);
    imp.resultado = r;
    const muestra = r.productos.slice(0, 8);
    $('#prevCount').textContent = r.productos.length
      ? '· ' + r.productos.length + ' filas detectadas' + (r.descartadas ? ' (' + r.descartadas + ' omitidas)' : '')
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
    const r = imp.resultado || P.normalizar(imp.matriz, imp.filaHeader, imp.mapa, S.state.cfg);
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
    ['Codigo','Descripcion','Laboratorio','Ubicacion','Stock','Stock Minimo','Stock Maximo','Consumo Mensual','Lote','Vencimiento','Precio'],
    ['A-1001','Amoxicilina 500mg x21 comp','Bago','B01-C03',340,120,600,280,'L2451','2027-04-30',1250],
    ['A-1002','Ibuprofeno 400mg x20 comp','Bago','B01-C04',85,150,700,420,'L2455','2027-01-31',890],
    ['A-1003','Paracetamol 500mg x30 comp','Roemmers','B01-C05',1240,300,1500,610,'L3312','2028-02-28',760],
    ['A-1004','Enalapril 10mg x30 comp','Roemmers','B02-C01',42,100,500,190,'L3319','2026-11-30',980],
    ['A-1005','Losartan 50mg x30 comp','Elea','B02-C02',610,200,900,340,'L7781','2027-09-30',1420],
    ['A-1006','Metformina 850mg x30 comp','Elea','B02-C03',150,180,800,360,'L7788','2027-06-30',1130],
    ['A-1007','Atorvastatina 20mg x30 comp','Gador','B02-C04',880,250,1200,410,'L5502','2028-05-31',2100],
    ['A-1008','Levotiroxina 100mcg x50 comp','Gador','B03-C01',95,120,600,230,'L5510','2027-03-31',1650],
    ['A-1009','Omeprazol 20mg x30 caps','Raffo','B03-C02',720,200,1000,380,'L9021','2027-12-31',940],
    ['A-1010','Amlodipina 5mg x30 comp','Raffo','B03-C03',26,90,450,175,'L9033','2026-10-31',1080],
    ['A-1011','Salbutamol aerosol 200 dosis','Roche','B03-C04',58,60,300,145,'L1140','2027-08-31',4300],
    ['A-1012','Insulina Glargina 100UI lapicera','Roche','B04-C01',34,40,180,95,'L1155','2026-12-15',18900],
    ['A-1013','Clopidogrel 75mg x30 comp','Pfizer','B04-C02',410,150,700,260,'L6620','2028-01-31',2650],
    ['A-1014','Sertralina 50mg x30 comp','Pfizer','B04-C03',192,140,600,290,'L6631','2027-07-31',1780],
    ['A-1015','Rivaroxaban 20mg x28 comp','Bayer','B04-C04',64,80,350,155,'L4410','2027-05-31',9800],
    ['A-1016','Aspirina Prevent 100mg x60','Bayer','B05-C01',1520,400,2000,520,'L4422','2029-03-31',680],
    ['A-1017','Diclofenac 75mg amp x5','Novartis','B05-C02',210,120,600,240,'L8815','2027-02-28',1340],
    ['A-1018','Valsartan 160mg x28 comp','Novartis','B05-C03',7,70,400,180,'L8829','2026-09-30',2380],
    ['A-1019','Clexane 40mg jeringa x2','Sanofi','B05-C04',118,60,300,130,'L2207','2027-10-31',12400],
    ['A-1020','Ramipril 5mg x30 comp','Sanofi','B06-C01',455,150,700,215,'L2219','2028-04-30',1290],
    ['A-1021','Dexametasona 8mg amp x3','Bago','B06-C02',0,50,250,110,'L2470','2027-11-30',1560],
    ['A-1022','Ceftriaxona 1g amp','Roemmers','B06-C03',88,100,500,320,'L3341','2027-04-30',3200],
    ['A-1023','Ondansetron 8mg amp x5','Elea','B06-C04',265,80,400,140,'L7799','2028-03-31',2950],
    ['A-1024','Hidroclorotiazida 25mg x30','Gador','B07-C01',690,180,800,210,'L5528','2028-06-30',720],
    ['A-1025','Furosemida 40mg x30 comp','Raffo','B07-C02',132,150,650,275,'L9044','2027-09-30',860]
  ];

  function cargarDemo() {
    const mapa = P.autoMapear(DEMO[0]);
    const r = P.normalizar(DEMO, 0, mapa, S.state.cfg);
    S.setProductos(r.productos, {
      archivo: 'Datos de ejemplo',
      hoja: 'demo',
      filas: r.productos.length,
      importadoEn: Date.now(),
      mapeo: mapa
    });
    U.toast('Cargados ' + r.productos.length + ' productos de ejemplo', 'ok');
  }

  /* ============================================================
     CONFIGURACIÓN
     ============================================================ */
  const CAMPOS_CFG = [
    ['cfgDiasCritico', 'diasCritico', 'int'],
    ['cfgDiasBajo', 'diasBajo', 'int'],
    ['cfgDiasObjetivo', 'diasObjetivo', 'int'],
    ['cfgFactorBajo', 'factorBajo', 'float'],
    ['cfgHorizonte', 'horizonte', 'int'],
    ['cfgDiasMes', 'diasMes', 'int'],
    ['cfgTvSegundos', 'tvSegundos', 'int'],
    ['cfgTvSoloCriticos', 'tvSoloCriticos', 'bool']
  ];

  function abrirSettings() {
    CAMPOS_CFG.forEach(([id, clave, tipo]) => {
      const el = $('#' + id);
      if (tipo === 'bool') el.checked = !!S.state.cfg[clave];
      else el.value = S.state.cfg[clave];
    });
    $('#modalSettings').hidden = false;
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
      });
    });

    $('#btnExportCsv').addEventListener('click', () => {
      if (!S.hayDatos()) { U.toast('No hay datos cargados', 'err'); return; }
      const items = calculados || A.calcular(S.state.productos, S.state.cfg);
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
