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
  function dashboard(el, items, cfg) {
    const res  = A.resumen(items, cfg);
    const labs = A.porLaboratorio(items, cfg);
    const proy = A.proyeccion(items, cfg);
    const tramos = A.quiebresPorTramo(items, cfg);
    const urgentes = A.topUrgentes(items, 6);

    const cobertura = res.coberturaGlobal !== null
      ? U.fmtDias(res.coberturaGlobal) + ' días' : 's/d';

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
      kpi('Consumo a ' + cfg.horizonte + ' días', U.fmtCompact(res.consumoHorizonte),
          U.fmt(res.consumoDiario, true) + ' uds/día · cobertura ' + cobertura, 'k-info') +
      '</div>';

    /* --- aviso de faltante proyectado --- */
    if (res.faltanteHorizonte > 0) {
      html += '<div class="notice n-warn" style="margin-top:14px">' +
        '<svg viewBox="0 0 24 24" class="ico"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
        '<div>Con el consumo actual faltarán <strong>' + U.fmt(res.faltanteHorizonte) +
        ' unidades</strong> en los próximos ' + cfg.horizonte + ' días. ' +
        (res.valorReposicion > 0 ? 'Reposición estimada: <strong>$' + U.fmt(res.valorReposicion) + '</strong>.' : '') +
        '</div></div>';
    }

    /* --- gráficos --- */
    html += '<h3 class="section-title">Situación del stock</h3>';
    html += '<div class="grid grid-2">' +
      cardChart('Stock por laboratorio', 'unidades', 'chLabStock', 300) +
      cardChart('Distribución por estado', res.skus + ' SKU', 'chEstados', 300) +
      '</div>';

    html += '<h3 class="section-title">Consumo y proyección</h3>';
    html += '<div class="grid grid-2">' +
      cardChart('Stock total proyectado', 'próximos ' + cfg.horizonte + ' días, sin reposición', 'chProy', 300) +
      cardChart('¿Cuándo se agota cada producto?', 'SKU por tramo', 'chQuiebres', 300) +
      '</div>';

    html += '<div class="grid grid-2" style="margin-top:14px">' +
      cardChart('Menor cobertura', 'los 10 más urgentes', 'chCobertura', 320) +
      cardChart('Consumo proyectado por laboratorio', cfg.horizonte + ' días', 'chConsumoLab', 320) +
      '</div>';

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
    C.proyeccion($('#chProy', el), proy);
    C.quiebres($('#chQuiebres', el), tramos);
    C.menorCobertura($('#chCobertura', el), items, cfg, false, 10);
    C.consumoPorLab($('#chConsumoLab', el), labs, cfg);
  }

  /* ============================================================
     VISTA 2 · LABORATORIOS
     ============================================================ */
  function laboratorios(el, items, cfg) {
    const labs = A.porLaboratorio(items, cfg);

    let html = '<div class="toolbar">' +
      '<input class="input" id="labSearch" type="search" placeholder="Buscar laboratorio…" ' +
      'value="' + U.esc(VLM.store.state.ui.busqueda) + '">' +
      '<span class="muted small">' + labs.length + ' laboratorios · ' + items.length + ' SKU</span>' +
      '</div>';

    html += '<div class="grid grid-2" style="margin-bottom:18px">' +
      cardChart('Estados por laboratorio', 'cantidad de SKU', 'chLabEstados', 340) +
      cardChart('Consumo proyectado', cfg.horizonte + ' días', 'chLabConsumo', 340) +
      '</div>';

    html += '<h3 class="section-title">Detalle por laboratorio</h3>';
    html += '<div class="lab-grid" id="labGrid">' + labs.map(l => labCard(l, cfg)).join('') + '</div>';

    el.innerHTML = html;
    C.estadosPorLab($('#chLabEstados', el), labs);
    C.consumoPorLab($('#chLabConsumo', el), labs, cfg);

    const buscar = $('#labSearch', el);
    buscar.addEventListener('input', U.debounce(() => {
      const q = U.norm(buscar.value);
      U.$$('#labGrid .lab-card', el).forEach(card => {
        card.hidden = q ? U.norm(card.dataset.lab).indexOf(q) === -1 : false;
      });
    }, 150));
  }

  function labCard(l, cfg) {
    const r = l.resumen;
    const cob = r.coberturaGlobal !== null ? U.fmtDias(r.coberturaGlobal) + ' d' : 's/d';
    return '<div class="card lab-card" data-lab="' + U.esc(l.nombre) + '">' +
      '<div class="lab-top">' +
        '<div class="lab-name"><i class="lab-swatch" style="background:' + l.color + '"></i>' + U.esc(l.nombre) + '</div>' +
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
      if (ui.filtroLab && p.laboratorio !== ui.filtroLab) return false;
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
          '<span>' + U.esc(p.laboratorio) + '</span>' +
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
      'Codigo', 'Descripcion', 'Laboratorio', 'Ubicacion', 'Estado',
      'Stock actual', 'Stock minimo', 'Consumo diario', 'Dias de cobertura',
      'Fecha estimada de quiebre', 'Unidades a reponer', 'Valor estimado'
    ]];
    lista.forEach(p => filas.push([
      p.codigo, p.descripcion, p.laboratorio, p.ubicacion,
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
    { id: 'laboratorio',   label: 'Laboratorio' },
    { id: 'ubicacion',     label: 'Ubicación', clase: 't-code' },
    { id: 'stock',         label: 'Stock',     num: true },
    { id: 'stockMin',      label: 'Mínimo',    num: true },
    { id: 'consumoDiario', label: 'Cons./día', num: true },
    { id: 'diasCobertura', label: 'Cobertura', num: true },
    { id: 'consumoProyectado', label: 'Consumo proy.', num: true },
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
      if (ui.filtroLab && p.laboratorio !== ui.filtroLab) return false;
      if (ui.filtroEstado && p.estado !== ui.filtroEstado) return false;
      if (q) {
        const blob = U.norm(p.codigo + ' ' + p.descripcion + ' ' + p.laboratorio + ' ' + p.ubicacion + ' ' + p.lote);
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
          '<td><i class="lab-swatch" style="display:inline-block;background:' + U.colorDe(p.laboratorio) + '"></i> ' + U.esc(p.laboratorio) + '</td>' +
          '<td class="t-code">' + U.esc(p.ubicacion || '—') + '</td>' +
          '<td class="t-num"><strong>' + U.fmt(p.stock) + '</strong></td>' +
          '<td class="t-num muted">' + (p.stockMin ? U.fmt(p.stockMin) : '—') + '</td>' +
          '<td class="t-num">' + (p.consumoDiario ? U.fmt(p.consumoDiario, true) : '—') + '</td>' +
          '<td class="t-num">' + U.fmtDias(p.diasCobertura) +
            '<div class="minibar m-' + p.estado + '"><i style="width:' + pct + '%"></i></div></td>' +
          '<td class="t-num muted">' + (p.consumoProyectado ? U.fmt(p.consumoProyectado) : '—') + '</td>' +
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

  return { dashboard, laboratorios, reposicion, inventario, badge, kpi, stackbar, repoItem, exportarRepo };
})();
