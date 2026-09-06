/* ============================================================
   views.js · render de las cuatro vistas
   ============================================================ */
window.VLM = window.VLM || {};

VLM.views = (function () {
  const U = VLM.util;
  const A = VLM.analytics;
  const C = VLM.charts;
  const $ = U.$;

  /* ---------- fragmentos reutilizables ---------- */

  function badge(estado) {
    const e = A.ESTADOS[estado] || A.ESTADOS.sd;
    return '<span class="badge b-' + estado + '">' + e.label + '</span>';
  }

  /** Chip de conservación (❄ Frío / 🌡 Ambiente). */
  function zchip(zona) {
    const z = VLM.labs.ZONAS[zona];
    if (!z) return '';
    return '<span class="zchip z-' + zona + '" title="' + z.desc + '">' + z.icono + ' ' + z.corto + '</span>';
  }

  /** Chip de ámbito (VLM / Fuera). */
  function achip(ambito) {
    const a = VLM.labs.AMBITOS[ambito];
    if (!a) return '';
    return '<span class="zchip a-' + ambito + '" title="' + a.desc + '">' + a.corto + '</span>';
  }

  /** Encabezado de un cuadrante ámbito × conservación. */
  function grupoHead(g) {
    const r = g.resumen;
    return '<div class="grupo-head g-' + g.zona + '">' +
      '<h3><span class="g-ico">' + g.icono + '</span>' + U.esc(g.label) + '</h3>' +
      '<span class="g-meta">' + r.skus + ' SKU · ' + U.fmtCompact(r.unidades) + ' unidades' +
        (g.alerta ? ' · <strong style="color:var(--crit)">' + g.alerta + ' en alerta</strong>' : '') +
      '</span></div>';
  }

  /** Tarjeta de cuadrante para el resumen. */
  function zonaCard(g) {
    const r = g.resumen;
    return '<div class="zona-card zc-' + g.zona + (g.ambito === 'externo' ? ' zc-externo' : '') + '">' +
      '<div class="zona-card-top">' +
        '<div class="zona-card-name">' + g.icono + ' ' + VLM.labs.ZONAS[g.zona].label + '</div>' +
        achip(g.ambito) +
      '</div>' +
      '<div class="zona-card-nums">' +
        '<div><b>' + U.fmt(r.skus) + '</b><span>SKU</span></div>' +
        '<div><b>' + U.fmtCompact(r.unidades) + '</b><span>unidades</span></div>' +
        '<div class="' + (g.alerta ? 'n-alerta' : '') + '"><b>' + U.fmt(g.alerta) + '</b><span>en alerta</span></div>' +
      '</div>' +
      stackbar(r) +
      '<div class="zona-card-labs">' + g.labs.map(l => U.esc(l.nombre)).join(' · ') + '</div>' +
      '</div>';
  }

  function kpi(label, valor, sub, clase) {
    return '<div class="kpi ' + (clase || '') + '">' +
      '<div class="kpi-label">' + U.esc(label) + '</div>' +
      '<div class="kpi-value">' + valor + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function cardChart(titulo, sub, canvasId, alto) {
    return '<div class="card">' +
      '<div class="card-head"><h3>' + U.esc(titulo) + '</h3>' +
        (sub ? '<span class="muted">' + U.esc(sub) + '</span>' : '') + '</div>' +
      '<div class="chart-box" style="height:' + (alto || 280) + 'px">' +
        '<canvas id="' + canvasId + '"></canvas></div>' +
      '</div>';
  }

  /** Barra apilada de estados de un conjunto de productos. */
  function stackbar(res) {
    const total = res.skus || 1;
    return '<div class="stackbar">' +
      A.ORDEN_ESTADOS.map(k => {
        const n = res.porEstado[k] || 0;
        if (!n) return '';
        return '<i class="sb-' + k + '" style="width:' + (n / total * 100) + '%" title="' +
          A.ESTADOS[k].label + ': ' + n + '"></i>';
      }).join('') + '</div>';
  }

  /* ============================================================
     VISTA 1 · RESUMEN
     ============================================================ */
  function dashboard(el, items, cfg, hist) {
    const res  = A.resumen(items, cfg);
    const labs = A.porLaboratorio(items, cfg);
    const grupos = A.porGrupo(items, cfg);
    const tramos = A.quiebresPorTramo(items, cfg);
    const urgentes = A.topUrgentes(items, 6);
    const consLabs = A.consumoPorLaboratorio(items, cfg);

    let html = '';

    /* --- KPIs --- */
    html += '<div class="kpi-grid">' +
      kpi('Productos (SKU)', U.fmt(res.skus),
          res.labs + ' laboratorios · ' + U.fmt(res.unidades) + ' unidades') +
      kpi('A reponer ya', U.fmt(res.aReponer),
          res.porEstado.agotado + ' agotados · ' + res.porEstado.critico + ' críticos',
          res.aReponer > 0 ? 'k-crit' : 'k-ok') +
      kpi('Próximos a vaciarse', U.fmt(res.porEstado.bajo),
          'menos de ' + cfg.diasBajo + ' días de cobertura',
          res.porEstado.bajo > 0 ? 'k-warn' : 'k-ok') +
      kpi('❄ Cadena de frío en alerta', U.fmt(res.alertaZona.frio),
          'de ' + res.porZona.frio + ' SKU refrigerados',
          res.alertaZona.frio > 0 ? 'k-crit' : 'k-ok') +
      (hist.activo
        ? kpi('Consumido en el período', hist.suficiente ? U.fmtCompact(hist.totalConsumido) : '—',
              hist.suficiente
                ? U.fmt(hist.promedioDiario, true) + ' uds/día en ' + hist.dias + ' días'
                : 'hacen falta 2 importaciones', 'k-info')
        : '') +
      '</div>';

    /* --- cuadrantes ámbito × conservación --- */
    html += '<h3 class="section-title">Por zona de almacenamiento</h3>';
    html += '<div class="zona-grid">' + grupos.map(zonaCard).join('') + '</div>';

    /* --- gráficos --- */
    html += '<h3 class="section-title">Situación del stock</h3>';
    html += '<div class="grid grid-2">' +
      cardChart('Stock por laboratorio', 'unidades', 'chLabStock', 300) +
      cardChart('Distribución por estado', res.skus + ' SKU', 'chEstados', 300) +
      '</div>';

    /* --- historial real de consumo (sólo si está activado) --- */
    if (hist.activo) {
      html += '<h3 class="section-title">Historial de consumo</h3>';
      if (!hist.suficiente) {
        html += avisoHistorial(hist);
      } else {
        html += '<div class="grid grid-2">' +
          cardChart('Consumo por día', 'unidades que salieron, calculadas por diferencia de stock', 'chHist', 300) +
          cardChart('Consumido por laboratorio', 'período completo', 'chConsumoLab', 300) +
          '</div>';
      }
    }

    /* --- análisis de detalle: cuándo se agota cada producto --- */
    // ojo: un producto agotado tiene cobertura 0, que es finita. Lo que define
    // si se puede analizar el agotamiento es que haya consumo conocido.
    const hayCobertura = items.some(p => p.consumoDiario > 0);
    html += '<h3 class="section-title">Análisis de detalle</h3>';
    if (hayCobertura) {
      html += '<div class="grid grid-2">' +
        cardChart('¿Cuándo se agota cada producto?', 'SKU por tramo, según el consumo observado', 'chQuiebres', 300) +
        cardChart('Menor cobertura', 'los 10 más urgentes', 'chCobertura', 300) +
        '</div>';
    } else {
      html += avisoSinConsumo(hist);
    }

    /* --- top urgentes --- */
    if (urgentes.length) {
      html += '<h3 class="section-title">Reponer primero</h3>';
      html += '<div class="repo-list">' + urgentes.map((p, i) => repoItem(p, i + 1, cfg)).join('') + '</div>';
      html += '<div style="margin-top:12px"><button class="btn" data-goto="repo">Ver lista completa de reposición →</button></div>';
    }

    el.innerHTML = html;

    /* --- montaje de gráficos --- */
    C.stockPorLab($('#chLabStock', el), labs);
    C.estados($('#chEstados', el), res);
    if (hayCobertura) {
      C.quiebres($('#chQuiebres', el), tramos);
      C.menorCobertura($('#chCobertura', el), items, cfg, false, 10);
    }
    if (hist.activo && hist.suficiente) {
      C.historial($('#chHist', el), hist);
      C.consumoLab($('#chConsumoLab', el), consLabs);
    }
  }

  /**
   * No hay ningún dato de consumo: ni columna en la planilla ni historial.
   * Sin eso no se puede saber cuándo se agota nada.
   */
  function avisoSinConsumo(hist) {
    return '<div class="notice">' +
      '<svg viewBox="0 0 24 24" class="ico" style="color:var(--accent)">' +
        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>' +
      '<div><strong>No se puede calcular cuándo se agota cada producto.</strong><br>' +
      'Hace falta saber cuánto se consume, y no hay de dónde sacarlo: la planilla no trae ' +
      'columna de consumo' +
      (hist.activo ? ' y todavía no hay suficientes importaciones en el historial.'
                   : ' y el historial de consumo está desactivado.') +
      '<br><span class="small muted">' +
      (hist.activo
        ? 'Importá una vez por día: desde la segunda importación aparece la cobertura.'
        : 'Podés activarlo en ⚙ Configuración → Historial de consumo, o agregar una ' +
          'columna de consumo a la planilla. Mientras tanto, las alertas salen del stock mínimo.') +
      '</span></div></div>';
  }

  /** Explica por qué todavía no hay historial y cómo se construye. */
  function avisoHistorial(hist) {
    const n = hist.snapshots;
    return '<div class="notice">' +
      '<svg viewBox="0 0 24 24" class="ico" style="color:var(--accent)">' +
        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>' +
      '<div><strong>Todavía no se puede calcular el consumo.</strong><br>' +
      'La planilla es una foto del stock del momento, así que el consumo sale de ' +
      '<strong>restar importaciones sucesivas</strong>. Llevás ' + n +
      (n === 1 ? ' importación guardada' : ' importaciones guardadas') +
      ' y hacen falta al menos 2.<br>' +
      '<span class="small muted">Importá la planilla una vez por día y a partir de mañana vas a ver ' +
      'el consumo diario, la cobertura y la fecha estimada de quiebre de cada producto.</span>' +
      '</div></div>';
  }

  /* ============================================================
     VISTA 2 · LABORATORIOS
     ============================================================ */
  function laboratorios(el, items, cfg) {
    const labs = A.porLaboratorio(items, cfg);
    const grupos = A.porGrupo(items, cfg);

    let html = '<div class="toolbar">' +
      '<input class="input" id="labSearch" type="search" placeholder="Buscar laboratorio…" ' +
      'value="' + U.esc(VLM.store.state.ui.busqueda) + '">' +
      '<span class="muted small">' + labs.length + ' laboratorios · ' + items.length + ' SKU</span>' +
      '</div>';

    html += '<div class="grid grid-2" style="margin-bottom:18px">' +
      cardChart('Estados por laboratorio', 'cantidad de SKU', 'chLabEstados', 340) +
      cardChart('Consumo por laboratorio', 'según el historial observado', 'chLabConsumo', 340) +
      '</div>';

    // agrupado por cuadrante: VLM·Frío, VLM·Ambiente, Fuera·Frío, Fuera·Ambiente
    html += '<div id="labGrid">' + grupos.map(g =>
      grupoHead(g) +
      '<div class="lab-grid">' + g.labs.map(l => labCard(l, cfg, g.zona)).join('') + '</div>'
    ).join('') + '</div>';

    el.innerHTML = html;
    C.estadosPorLab($('#chLabEstados', el), labs);
    C.consumoLab($('#chLabConsumo', el), A.consumoPorLaboratorio(items, cfg));

    const buscar = $('#labSearch', el);
    buscar.addEventListener('input', U.debounce(() => {
      const q = U.norm(buscar.value);
      U.$$('#labGrid .lab-card', el).forEach(card => {
        card.hidden = q ? U.norm(card.dataset.lab).indexOf(q) === -1 : false;
      });
      // ocultar el encabezado de los cuadrantes que quedaron vacíos
      U.$$('#labGrid .grupo-head', el).forEach(head => {
        const grid = head.nextElementSibling;
        const visibles = grid ? U.$$('.lab-card', grid).filter(c => !c.hidden).length : 0;
        head.hidden = visibles === 0;
        if (grid) grid.hidden = visibles === 0;
      });
    }, 150));
  }

  function labCard(l, cfg, zona) {
    const r = l.resumen;
    const cob = r.coberturaGlobal !== null ? U.fmtDias(r.coberturaGlobal) + ' d' : 's/d';
    return '<div class="card lab-card" data-lab="' + U.esc(l.nombre) + '">' +
      '<div class="lab-top">' +
        '<div class="lab-name"><i class="lab-swatch" style="background:' + l.color + '"></i>' + U.esc(l.nombre) + '</div>' +
        (zona ? zchip(zona) : '') +
        (l.criticos > 0 ? badge('critico') : (r.porEstado.bajo > 0 ? badge('bajo') : badge('ok'))) +
      '</div>' +
      '<div class="lab-stats">' +
        '<div class="lab-stat"><b>' + U.fmt(r.skus) + '</b><span>SKU</span></div>' +
        '<div class="lab-stat"><b>' + U.fmtCompact(r.unidades) + '</b><span>unidades</span></div>' +
        '<div class="lab-stat ' + (l.criticos ? 's-crit' : (r.porEstado.bajo ? 's-warn' : '')) + '">' +
          '<b>' + U.fmt(r.enAlerta) + '</b><span>en alerta</span></div>' +
      '</div>' +
      stackbar(r) +
      '<div class="lab-legend">' +
        '<span>Cobertura ' + cob + '</span>' +
        '<span>Consumo ' + U.fmtCompact(r.consumoHorizonte) + ' uds/' + cfg.horizonte + 'd</span>' +
        (r.valorReposicion > 0 ? '<span>Reposición $' + U.fmtCompact(r.valorReposicion) + '</span>' : '') +
      '</div>' +
      '</div>';
  }

  /* ============================================================
     VISTA 3 · REPOSICIÓN
     ============================================================ */
  function reposicion(el, items, cfg) {
    const ui = VLM.store.state.ui;
    const labs = A.porLaboratorio(items, cfg);

    const criticos = items
      .filter(p => ['agotado', 'critico', 'bajo'].indexOf(p.estado) > -1)
      .sort((a, b) => a.urgencia - b.urgencia);

    const filtrados = criticos.filter(p => {
      if (ui.filtroLab && (p.labNombre || p.laboratorio) !== ui.filtroLab) return false;
      if (ui.filtroEstado && p.estado !== ui.filtroEstado) return false;
      return true;
    });

    const totalUds = filtrados.reduce((s, p) => s + p.sugerido, 0);
    const totalVal = filtrados.reduce((s, p) => s + p.valorSugerido, 0);

    let html = '<div class="kpi-grid" style="margin-bottom:16px">' +
      kpi('Productos a reponer', U.fmt(filtrados.length),
          criticos.filter(p => p.estado === 'agotado').length + ' agotados', 'k-crit') +
      kpi('Unidades sugeridas', U.fmtCompact(totalUds),
          'para cubrir ' + cfg.diasObjetivo + ' días', 'k-info') +
      kpi('Valor estimado', totalVal > 0 ? '$' + U.fmtCompact(totalVal) : '—',
          'según precio unitario cargado') +
      kpi('Laboratorios afectados', U.fmt(new Set(filtrados.map(p => p.laboratorio)).size),
          'de ' + labs.length + ' en total', 'k-warn') +
      '</div>';

    /* filtros */
    html += '<div class="toolbar">' +
      '<select class="select" id="repoLab"><option value="">Todos los laboratorios</option>' +
        labs.map(l => '<option value="' + U.esc(l.nombre) + '"' +
          (ui.filtroLab === l.nombre ? ' selected' : '') + '>' + U.esc(l.nombre) +
          ' (' + l.alerta + ')</option>').join('') +
      '</select>' +
      '<div class="chip-row">' +
        chip('', 'Todos', !ui.filtroEstado) +
        chip('agotado', 'Agotados', ui.filtroEstado === 'agotado') +
        chip('critico', 'Críticos', ui.filtroEstado === 'critico') +
        chip('bajo', 'Bajos', ui.filtroEstado === 'bajo') +
      '</div>' +
      '<div class="spacer"></div>' +
      '<button class="btn" id="repoExport">Exportar CSV</button>' +
      '</div>';

    if (!filtrados.length) {
      html += '<div class="no-results"><strong>Sin productos en alerta</strong><br>' +
        '<span class="small">Con los umbrales actuales (' + cfg.diasCritico + '/' + cfg.diasBajo +
        ' días) no hay nada por reponer.</span></div>';
    } else {
      html += '<div class="repo-list">' + filtrados.map((p, i) => repoItem(p, i + 1, cfg)).join('') + '</div>';
    }

    el.innerHTML = html;

    $('#repoLab', el).addEventListener('change', e => {
      VLM.store.setUi({ filtroLab: e.target.value || null });
    });
    U.$$('.chip', el).forEach(c => c.addEventListener('click', () => {
      VLM.store.setUi({ filtroEstado: c.dataset.val || null });
    }));
    $('#repoExport', el).addEventListener('click', () => exportarRepo(filtrados, cfg));
  }

  function chip(val, label, activo) {
    return '<button class="chip' + (activo ? ' is-active' : '') + '" data-val="' + val + '">' + label + '</button>';
  }

  function repoItem(p, rank, cfg) {
    const clase = p.estado === 'agotado' ? 'r-agotado' : (p.estado === 'bajo' ? 'r-bajo' : '');
    const dias = p.diasCobertura !== null && isFinite(p.diasCobertura)
      ? U.fmtDias(p.diasCobertura) : 's/d';
    const quiebre = p.fechaQuiebre ? 'se agota ' + U.fmtFechaCorta(p.fechaQuiebre) : 'sin consumo cargado';

    return '<div class="repo-item ' + clase + '">' +
      '<div class="repo-rank">' + rank + '</div>' +
      '<div class="repo-main">' +
        '<strong>' + U.esc(p.descripcion) + '</strong>' +
        '<div class="repo-meta">' +
          '<span>' + U.esc(p.codigo) + '</span>' +
          '<span>' + U.esc(p.labNombre || p.laboratorio) + '</span>' +
          '<span>' + zchip(p.conservacion) + ' ' + achip(p.ambito) + '</span>' +
          (p.ubicacion ? '<span>📍 ' + U.esc(p.ubicacion) + '</span>' : '') +
          '<span>' + quiebre + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="repo-metric"><b>' + U.fmt(p.stock) + '</b><span>stock actual</span></div>' +
      '<div class="repo-metric ' + (p.estado === 'bajo' ? 'm-warn' : 'm-crit') + '">' +
        '<b>' + dias + '</b><span>días restantes</span></div>' +
      '<div class="repo-metric m-accent"><b>+' + U.fmt(p.sugerido) + '</b><span>a reponer</span></div>' +
      '</div>';
  }

  function exportarRepo(lista, cfg) {
    if (!lista.length) { U.toast('No hay nada para exportar', 'err'); return; }
    const filas = [[
      'Codigo', 'Descripcion', 'Laboratorio', 'Conservacion', 'Ambito', 'Ubicacion', 'Estado',
      'Stock actual', 'Stock minimo', 'Consumo diario', 'Dias de cobertura',
      'Fecha estimada de quiebre', 'Unidades a reponer', 'Valor estimado'
    ]];
    lista.forEach(p => filas.push([
      p.codigo, p.descripcion, p.labNombre || p.laboratorio,
      VLM.labs.ZONAS[p.conservacion] ? VLM.labs.ZONAS[p.conservacion].label : '',
      VLM.labs.AMBITOS[p.ambito] ? VLM.labs.AMBITOS[p.ambito].label : '',
      p.ubicacion,
      A.ESTADOS[p.estado].label,
      p.stock, p.stockMin,
      Math.round(p.consumoDiario * 100) / 100,
      p.diasCobertura !== null && isFinite(p.diasCobertura) ? Math.round(p.diasCobertura * 10) / 10 : '',
      p.fechaQuiebre ? U.fmtFecha(p.fechaQuiebre) : '',
      p.sugerido,
      Math.round(p.valorSugerido)
    ]));
    const hoy = new Date().toISOString().slice(0, 10);
    U.download('reposicion_vlm_' + hoy + '.csv', U.toCsv(filas), 'text/csv;charset=utf-8');
    U.toast('Exportadas ' + lista.length + ' líneas', 'ok');
  }

  /* ============================================================
     VISTA 4 · INVENTARIO
     ============================================================ */
  const COLUMNAS = [
    { id: 'codigo',        label: 'Código',    clase: 't-code' },
    { id: 'descripcion',   label: 'Producto',  clase: 't-desc' },
    { id: 'labNombre',     label: 'Laboratorio' },
    { id: 'conservacion',  label: 'Conserv.' },
    { id: 'ambito',        label: 'Ámbito' },
    { id: 'ubicacion',     label: 'Ubicación', clase: 't-code' },
    { id: 'stock',         label: 'Stock',     num: true },
    { id: 'stockMin',      label: 'Mínimo',    num: true },
    { id: 'consumoDiario', label: 'Cons./día', num: true },
    { id: 'diasCobertura', label: 'Cobertura', num: true },
    { id: 'fechaQuiebre',  label: 'Se agota', num: true },
    { id: 'sugerido',      label: 'A reponer', num: true },
    { id: 'estado',        label: 'Estado' }
  ];

  function inventario(el, items, cfg) {
    const ui = VLM.store.state.ui;
    const labs = A.porLaboratorio(items, cfg);

    let html = '<div class="toolbar">' +
      '<input class="input" id="invSearch" type="search" placeholder="Buscar código, producto, ubicación…" value="' + U.esc(ui.busqueda) + '">' +
      '<select class="select" id="invLab"><option value="">Todos los laboratorios</option>' +
        labs.map(l => '<option value="' + U.esc(l.nombre) + '"' +
          (ui.filtroLab === l.nombre ? ' selected' : '') + '>' + U.esc(l.nombre) + '</option>').join('') +
      '</select>' +
      '<div class="chip-row">' +
        chip('', 'Todos', !ui.filtroEstado) +
        chip('agotado', 'Agotado', ui.filtroEstado === 'agotado') +
        chip('critico', 'Crítico', ui.filtroEstado === 'critico') +
        chip('bajo', 'Bajo', ui.filtroEstado === 'bajo') +
        chip('ok', 'OK', ui.filtroEstado === 'ok') +
      '</div>' +
      '<div class="spacer"></div>' +
      '<span class="muted small" id="invCount"></span>' +
      '</div>' +
      '<div class="table-wrap"><table class="table" id="invTable"></table></div>';

    el.innerHTML = html;
    pintarTabla(el, items, cfg);

    $('#invSearch', el).addEventListener('input', U.debounce(e => {
      VLM.store.setUi({ busqueda: e.target.value }, true);
      pintarTabla(el, items, cfg);
    }, 180));
    $('#invLab', el).addEventListener('change', e => {
      VLM.store.setUi({ filtroLab: e.target.value || null }, true);
      pintarTabla(el, items, cfg);
    });
    U.$$('.chip', el).forEach(c => c.addEventListener('click', () => {
      VLM.store.setUi({ filtroEstado: c.dataset.val || null }, true);
      U.$$('.chip', el).forEach(x => x.classList.toggle('is-active', x === c));
      pintarTabla(el, items, cfg);
    }));
  }

  function filtrar(items, ui) {
    const q = U.norm(ui.busqueda);
    return items.filter(p => {
      if (ui.filtroLab && (p.labNombre || p.laboratorio) !== ui.filtroLab) return false;
      if (ui.filtroEstado && p.estado !== ui.filtroEstado) return false;
      if (q) {
        const blob = U.norm(p.codigo + ' ' + p.descripcion + ' ' + p.laboratorio + ' ' +
          (p.labNombre || '') + ' ' + p.ubicacion + ' ' + p.lote);
        if (blob.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function pintarTabla(el, items, cfg) {
    const ui = VLM.store.state.ui;
    const filtrados = ordenar(filtrar(items, ui), ui.orden);
    const tabla = $('#invTable', el);
    const cnt = $('#invCount', el);
    if (cnt) cnt.textContent = filtrados.length + ' de ' + items.length + ' productos';

    let html = '<thead><tr>' + COLUMNAS.map(c => {
      const act = ui.orden.campo === c.id;
      return '<th data-col="' + c.id + '" class="' + (act ? 'sorted ' : '') + (c.num ? 't-num' : '') + '">' +
        U.esc(c.label) + '<span class="sort-ind">' + (act ? (ui.orden.dir === 'asc' ? '▲' : '▼') : '⇅') + '</span></th>';
    }).join('') + '</tr></thead><tbody>';

    if (!filtrados.length) {
      html += '<tr><td colspan="' + COLUMNAS.length + '"><div class="no-results">Sin resultados para ese filtro</div></td></tr>';
    } else {
      filtrados.forEach(p => {
        const pct = p.diasCobertura !== null && isFinite(p.diasCobertura)
          ? Math.min(100, p.diasCobertura / (cfg.diasObjetivo || 30) * 100) : 0;
        html += '<tr class="row-' + p.estado + '">' +
          '<td class="t-code">' + U.esc(p.codigo) + '</td>' +
          '<td class="t-desc">' + U.esc(p.descripcion) + '</td>' +
          '<td><i class="lab-swatch" style="display:inline-block;background:' + U.colorDe(p.labNombre || p.laboratorio) + '"></i> ' +
            U.esc(p.labNombre || p.laboratorio) + '</td>' +
          '<td>' + zchip(p.conservacion) + '</td>' +
          '<td>' + achip(p.ambito) + '</td>' +
          '<td class="t-code">' + U.esc(p.ubicacion || '—') + '</td>' +
          '<td class="t-num"><strong>' + U.fmt(p.stock) + '</strong></td>' +
          '<td class="t-num muted">' + (p.stockMin ? U.fmt(p.stockMin) : '—') + '</td>' +
          '<td class="t-num">' + (p.consumoDiario ? U.fmt(p.consumoDiario, true) : '—') + '</td>' +
          '<td class="t-num">' + U.fmtDias(p.diasCobertura) +
            '<div class="minibar m-' + p.estado + '"><i style="width:' + pct + '%"></i></div></td>' +
          '<td class="t-num muted">' + (p.fechaQuiebre ? U.fmtFechaCorta(p.fechaQuiebre) : '—') + '</td>' +
          '<td class="t-num">' + (p.sugerido ? '<strong>+' + U.fmt(p.sugerido) + '</strong>' : '—') + '</td>' +
          '<td>' + badge(p.estado) + '</td>' +
          '</tr>';
      });
    }
    html += '</tbody>';
    tabla.innerHTML = html;

    U.$$('th[data-col]', tabla).forEach(th => th.addEventListener('click', () => {
      const campo = th.dataset.col;
      const dir = (ui.orden.campo === campo && ui.orden.dir === 'asc') ? 'desc' : 'asc';
      VLM.store.setUi({ orden: { campo, dir } }, true);
      pintarTabla(el, items, cfg);
    }));
  }

  function ordenar(lista, orden) {
    const { campo, dir } = orden;
    const mult = dir === 'asc' ? 1 : -1;
    return lista.slice().sort((a, b) => {
      let va = a[campo], vb = b[campo];
      if (campo === 'estado') { va = A.ESTADOS[a.estado].orden; vb = A.ESTADOS[b.estado].orden; }
      if (va === null || va === undefined) va = dir === 'asc' ? Infinity : -Infinity;
      if (vb === null || vb === undefined) vb = dir === 'asc' ? Infinity : -Infinity;
      if (typeof va === 'string' || typeof vb === 'string') {
        return String(va).localeCompare(String(vb), 'es') * mult;
      }
      return (va - vb) * mult;
    });
  }

  return {
    dashboard, laboratorios, reposicion, inventario,
    badge, zchip, achip, kpi, stackbar, grupoHead, zonaCard, repoItem, exportarRepo
  };
})();
