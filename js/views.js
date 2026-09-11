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
      '<span class="g-meta">' + r.skus + ' SKU · ' + U.fmtCompact(r.unidades) + ' u. en picking' +
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
        '<div><b>' + U.fmtCompact(r.unidades) + '</b><span>en picking</span></div>' +
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
  function dashboard(el, items, cfg) {
    const res  = A.resumen(items, cfg);
    const labs = A.porLaboratorio(items, cfg);
    const grupos = A.porGrupo(items, cfg);
    const urgentes = A.topUrgentes(items, 6);

    let html = '';

    /* --- KPIs --- */
    html += '<div class="kpi-grid">' +
      kpi('Productos (SKU)', U.fmt(res.skus),
          res.labs + ' laboratorios · ' + U.fmt(res.unidades) + ' unidades en picking') +
      kpi('A reponer ya', U.fmt(res.aReponer),
          'por debajo del ' + cfg.pctCritico + '% · ' + res.porEstado.agotado + ' agotados',
          res.aReponer > 0 ? 'k-crit' : 'k-ok') +
      kpi('Próximos a vaciarse', U.fmt(res.porEstado.bajo),
          'por debajo del ' + cfg.pctBajo + '% de su capacidad',
          res.porEstado.bajo > 0 ? 'k-warn' : 'k-ok') +
      kpi('❄ Cadena de frío en alerta', U.fmt(res.alertaZona.frio),
          'de ' + res.porZona.frio + ' SKU refrigerados',
          res.alertaZona.frio > 0 ? 'k-crit' : 'k-ok') +
      '</div>';

    /* --- cuadrantes ámbito × conservación --- */
    html += '<h3 class="section-title">Por zona de almacenamiento</h3>';
    html += '<div class="zona-grid">' + grupos.map(zonaCard).join('') + '</div>';

    /* --- gráficos --- */
    html += '<h3 class="section-title">Situación del stock</h3>';
    /* El corte principal es el artículo: adentro del VLM la ubicación no
       distingue nada, todos comparten VLMVENTA01 o VLMVENTA02.

       Los que están sólo en reserva no entran: no tienen posición de picking,
       así que no hay nada que reponer y sólo aportarían barras en cero. */
    const conPicking = items.filter(p => !p.sinPicking);
    const soloReserva = items.length - conPicking.length;
    const topArt = Math.min(conPicking.length, 15);
    html += cardChart('Stock por artículo',
        (topArt < conPicking.length
          ? 'unidades en picking · los ' + topArt + ' de mayor stock, de ' + conPicking.length
          : 'unidades en picking') +
        (soloReserva ? ' · ' + soloReserva + ' sólo en reserva, fuera del gráfico' : ''),
        'chArtStock', Math.max(280, topArt * 24 + 50));
    html += '<div class="grid grid-2" style="margin-top:14px">' +
      cardChart('Distribución por estado', res.skus + ' SKU', 'chEstados', 300) +
      cardChart('Stock en picking por laboratorio', 'unidades', 'chLabStock', 300) +
      '</div>';

    /* --- posiciones sin configurar: sin máximo no hay alerta posible ---
       Sólo cuentan los que tienen picking: a los de pura reserva no se les
       carga máximo, así que nunca se van a poder "terminar de configurar". */
    const sinConfig = conPicking.filter(p => !(p.stockMax > 0) && !(p.stockMin > 0)).length;
    if (sinConfig) html += avisoSinConfig(sinConfig, conPicking.length, cfg);

    /* --- top urgentes --- */
    if (urgentes.length) {
      html += '<h3 class="section-title">Reponer primero</h3>';
      html += '<div class="repo-list">' + urgentes.map((p, i) => repoItem(p, i + 1, cfg)).join('') + '</div>';
      html += '<div style="margin-top:12px"><button class="btn" data-goto="repo">Ver lista completa de reposición →</button></div>';
    }

    el.innerHTML = html;

    /* --- montaje de gráficos --- */
    C.stockPorArticulo($('#chArtStock', el), conPicking);
    C.stockPorLab($('#chLabStock', el), labs);
    C.estados($('#chEstados', el), res);
  }

  /**
   * Sin máximo cargado no hay contra qué medir: esos productos quedan en
   * "sin datos" y no generan alerta. Conviene que se vea, no que pasen por OK.
   */
  function avisoSinConfig(n, total, cfg) {
    return '<div class="notice n-warn" style="margin-top:14px">' +
      '<svg viewBox="0 0 24 24" class="ico"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 ' +
        '1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
      '<div><strong>' + U.fmt(n) + ' de ' + U.fmt(total) + ' productos no tienen máximo cargado.</strong><br>' +
      'Sin capacidad no hay contra qué medir, así que no generan alerta: quedan como ' +
      '<em>sin datos</em>.' +
      '<br><span class="small muted">Cargalos en <strong>Posiciones</strong>. ' +
      'Crítico por debajo del ' + cfg.pctCritico + '%, bajo por debajo del ' + cfg.pctBajo + '%.</span>' +
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
      cardChart('Picking vs altura', 'unidades por laboratorio', 'chLabConsumo', 340) +
      '</div>';

    // agrupado por cuadrante: VLM·Frío, VLM·Ambiente, Fuera·Frío, Fuera·Ambiente
    html += '<div id="labGrid">' + grupos.map(g =>
      grupoHead(g) +
      '<div class="lab-grid">' + g.labs.map(l => labCard(l, cfg, g.zona)).join('') + '</div>'
    ).join('') + '</div>';

    el.innerHTML = html;
    C.estadosPorLab($('#chLabEstados', el), labs);
    C.pickingVsAltura($('#chLabConsumo', el), labs);

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
    return '<div class="card lab-card" data-lab="' + U.esc(l.nombre) + '">' +
      '<div class="lab-top">' +
        '<div class="lab-name"><i class="lab-swatch" style="background:' + l.color + '"></i>' + U.esc(l.nombre) + '</div>' +
        (zona ? zchip(zona) : '') +
        (l.criticos > 0 ? badge('critico') : (r.porEstado.bajo > 0 ? badge('bajo') : badge('ok'))) +
      '</div>' +
      '<div class="lab-stats">' +
        '<div class="lab-stat"><b>' + U.fmt(r.skus) + '</b><span>SKU</span></div>' +
        '<div class="lab-stat"><b>' + U.fmtCompact(r.unidades) + '</b><span>en picking</span></div>' +
        '<div class="lab-stat ' + (l.criticos ? 's-crit' : (r.porEstado.bajo ? 's-warn' : '')) + '">' +
          '<b>' + U.fmt(r.enAlerta) + '</b><span>en alerta</span></div>' +
      '</div>' +
      stackbar(r) +
      '<div class="lab-legend">' +
        '<span>' + U.fmtCompact(r.unidadesAltura) + ' en altura</span>' +
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
    const enFrio = filtrados.filter(p => p.conservacion === 'frio').length;

    let html = '<div class="kpi-grid" style="margin-bottom:16px">' +
      kpi('Productos a reponer', U.fmt(filtrados.length),
          criticos.filter(p => p.estado === 'agotado').length + ' agotados', 'k-crit') +
      kpi('Unidades sugeridas', U.fmtCompact(totalUds),
          'hasta llenar las posiciones', 'k-info') +
      kpi('❄ En cadena de frío', U.fmt(enFrio),
          'de ' + filtrados.length + ' a reponer', enFrio > 0 ? 'k-warn' : 'k-ok') +
      kpi('Laboratorios afectados', U.fmt(new Set(filtrados.map(p => p.labNombre || p.laboratorio)).size),
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
        '<span class="small">Con los umbrales actuales (' + cfg.pctCritico + '% / ' + cfg.pctBajo +
        '% de la capacidad) no hay nada por reponer.</span></div>';
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

  /** Aviso de que el lote que está en la posición no se puede continuar. */
  function chipFinDeLote() {
    return '<span class="alt-fin" title="En la reserva no queda el lote que ' +
      'está en la posición: lo que se baje va a ser de otra partida">' +
      '<svg viewBox="0 0 24 24" class="ico"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 ' +
        '1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
      'Fin de lote</span>';
  }

  /**
   * De dónde bajar mercadería para rellenar el picking.
   *
   * Se cruza por artículo + lote + Atributo02: rellenar una posición de
   * picking con otro lote mezcla partidas, así que primero se ofrecen las
   * alturas del MISMO lote que ya está abajo. Si no hay ninguna —o la
   * posición de picking está vacía— se listan las demás por vencimiento,
   * que es el orden en que conviene sacarlas.
   */
  function fuentesAltura(p) {
    const det = p.detalle || [];
    const altura = det.filter(d => d.tipo === 'altura' && d.stock > 0);

    const clave = d => (d.lote || '') + '|' + (d.lote2 || '');
    const enPicking = {};
    const picking = det.filter(d => d.tipo === 'picking' && d.stock > 0);
    picking.forEach(d => { enPicking[clave(d)] = true; });

    /* FIN DE LOTE: hay algo abajo, pero de ese lote no queda nada en la
       reserva. Lo que se reponga va a ser de otra partida, y eso hay que
       saberlo antes de ir a buscarlo, no cuando ya se está en la posición.
       Sólo aplica si la posición todavía tiene stock con lote: vacía no hay
       lote que se esté terminando, y sin columna de lote no hay con qué
       comparar. */
    const conLote = picking.filter(d => d.lote || d.lote2);
    const finDeLote = conLote.length > 0 && !altura.some(d => enPicking[clave(d)]);

    if (!altura.length) {
      // sin reserva no hay bloque de "bajar de", pero si el lote se termina
      // el aviso tiene que salir igual
      return finDeLote
        ? '<div class="repo-altura es-fin">' + chipFinDeLote() +
          '<span class="alt-u">no queda reserva de este artículo</span></div>'
        : '';
    }

    // agrupar las alturas por lote, sumando lo que hay en cada una
    const porLote = {};
    altura.forEach(d => {
      const k = clave(d);
      if (!porLote[k]) porLote[k] = {
        lote: d.lote, lote2: d.lote2, stock: 0, ubics: [],
        vto: d.vencimiento, mismo: !!enPicking[k]
      };
      const g = porLote[k];
      g.stock += d.stock;
      if (g.ubics.indexOf(d.ubicacion) === -1) g.ubics.push(d.ubicacion);
      if (d.vencimiento && (!g.vto || d.vencimiento < g.vto)) g.vto = d.vencimiento;
    });

    const lotes = Object.keys(porLote).map(k => porLote[k]).sort((a, b) => {
      if (a.mismo !== b.mismo) return a.mismo ? -1 : 1;       // primero el que ya está abajo
      if (a.vto && b.vto) return a.vto - b.vto;               // después, el que vence antes
      return b.stock - a.stock;
    });

    const total = altura.reduce((s, d) => s + d.stock, 0);
    // Ocupa una fila propia a todo el ancho de la tarjeta, así que entran tres
    // lotes uno al lado del otro en vez de dos apilados en una columna angosta.
    const muestra = lotes.slice(0, 3);
    const resto = lotes.length - muestra.length;

    return '<div class="repo-altura' + (finDeLote ? ' es-fin' : '') + '">' +
      '<div class="alt-head">' +
        '<svg viewBox="0 0 24 24" class="ico alt-ico"><path d="M12 5v14m0 0-6-6m6 6 6-6"/></svg>' +
        '<span class="alt-title">Bajar de</span>' +
        '<b>' + U.fmt(total) + '</b><span class="alt-u">unidades en altura</span>' +
        (finDeLote ? chipFinDeLote() : '') +
        (resto ? '<span class="alt-mas">+' + resto + ' lote(s) más</span>' : '') +
      '</div>' +
      '<div class="alt-lotes">' +
        muestra.map(g =>
          '<div class="alt-lote' + (g.mismo ? ' es-mismo' : '') + '">' +
            '<span class="alt-ubics">' + U.esc(g.ubics.slice(0, 2).join(' · ')) +
              (g.ubics.length > 2 ? ' +' + (g.ubics.length - 2) : '') + '</span>' +
            '<span class="alt-cant">' + U.fmt(g.stock) + ' u</span>' +
            '<span class="alt-meta">' +
              (g.lote ? 'lote ' + U.esc(g.lote) : '') +
              (g.lote2 ? ' · ' + U.esc(g.lote2) : '') +
              (g.vto ? ' · vto ' + U.fmtFechaCorta(g.vto) : '') +
            '</span>' +
            (g.mismo ? '<span class="alt-mismo">mismo lote</span>' : '') +
          '</div>').join('') +
      '</div>' +
      '</div>';
  }

  function repoItem(p, rank, cfg) {
    const clase = p.estado === 'agotado' ? 'r-agotado' : (p.estado === 'bajo' ? 'r-bajo' : '');
    const pct = p.ocupacion !== null ? Math.round(p.ocupacion * 100) + '%' : 's/d';

    return '<div class="repo-item row-link ' + clase + '" data-art="' + U.esc(p.codigo) + '">' +
      '<div class="repo-fila">' +
      '<div class="repo-rank">' + rank + '</div>' +
      '<div class="repo-main">' +
        '<strong>' + U.esc(p.descripcion) + '</strong>' +
        '<div class="repo-meta">' +
          '<span>' + U.esc(p.codigo) + '</span>' +
          '<span>' + U.esc(p.labNombre || p.laboratorio) + '</span>' +
          '<span>' + zchip(p.conservacion) + ' ' + achip(p.ambito) + '</span>' +
          (p.peorPosicion ? '<span>📍 <strong>' + U.esc(p.peorPosicion) + '</strong></span>'
            : p.ubicacion ? '<span>📍 ' + U.esc(p.ubicacion) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="repo-metric"><b>' + U.fmt(p.stockPicking !== undefined ? p.stockPicking : p.stock) +
        '</b><span>en picking</span></div>' +
      '<div class="repo-metric ' + (p.estado === 'agotado' ? 'm-agotado' : p.estado === 'bajo' ? 'm-warn' : 'm-crit') + '">' +
        '<b>' + pct + '</b><span>de su capacidad</span></div>' +
      '<div class="repo-metric m-accent"><b>+' + U.fmt(p.sugerido) + '</b><span>a reponer</span></div>' +
      '</div>' +
      // fuera de la grilla de arriba: adentro, al cruzar varias columnas, le
      // movía los anchos a las métricas y le comía espacio al artículo
      fuentesAltura(p) +
      '</div>';
  }

  /* ============================================================
     DETALLE DE UN ARTÍCULO
     ============================================================ */

  /**
   * Lo que no entra en los gráficos: el desglose por lote y, sobre todo, el
   * DISPONIBLE.
   *
   * El físico es lo que hay en la posición; el disponible ya tiene descontado
   * lo que los pedidos lanzados se van a llevar. Si de 200 unidades hay dos
   * pedidos por 150, quedan 50 realmente libres. Eso importa cuando se mira un
   * artículo puntual, pero no en los gráficos: el panel es para saber qué
   * reponer, y lo que se repone es lo físico.
   */
  function detalleArticulo(p, cfg) {
    const hayDisp = p.disponible !== null && p.disponible !== undefined;
    const asignado = p.asignado || 0;

    let html = '<div class="art-head">' +
      '<div><span class="t-code">' + U.esc(p.codigo) + '</span> ' +
        badge(p.estado) + ' ' + zchip(p.conservacion) + ' ' + achip(p.ambito) + '</div>' +
      '<div class="muted small">' + U.esc(p.labNombre || p.laboratorio) +
        (p.ubicacion ? ' · 📍 ' + U.esc(p.ubicacion) : '') + '</div>' +
      '</div>';

    html += '<div class="kpi-grid" style="margin:14px 0">' +
      kpi('Stock físico', U.fmt(p.stockPicking !== undefined ? p.stockPicking : p.stock),
          'lo que hay en la posición') +
      (hayDisp ? kpi('Disponible', U.fmt(p.disponible),
          asignado ? U.fmt(asignado) + ' ya comprometidas por pedidos' : 'sin pedidos lanzados',
          p.disponible <= 0 ? 'k-crit' : (asignado ? 'k-warn' : 'k-ok')) : '') +
      (p.stockAltura ? kpi('En altura', U.fmt(p.stockAltura), 'reserva para rellenar') : '') +
      kpi('Capacidad', p.stockMax > 0 ? U.fmt(p.stockMax) : '—',
          p.ocupacion !== null && p.ocupacion !== undefined
            ? Math.round(p.ocupacion * 100) + '% ocupado' +
              (p.peorPosicion ? ' en ' + U.esc(p.peorPosicion) : '')
            : 'sin máximo cargado') +
      '</div>';

    // barra física vs disponible: se ve de un vistazo cuánto está comprometido
    if (hayDisp && p.stock > 0) {
      const pctDisp = Math.max(0, Math.min(100, p.disponible / p.stock * 100));
      html += '<div class="art-barra"><i style="width:' + pctDisp + '%"></i></div>' +
        '<div class="art-barra-leyenda muted small">' +
        '<span>' + U.fmt(p.disponible) + ' libres</span>' +
        '<span>' + U.fmt(Math.max(0, p.stock - p.disponible)) + ' comprometidas</span>' +
        '</div>';
    }

    // --- desglose por lote ---
    const det = (p.detalle || []).slice().sort((a, b) =>
      (a.tipo === b.tipo ? 0 : a.tipo === 'picking' ? -1 : 1) ||
      (a.vencimiento && b.vencimiento ? a.vencimiento - b.vencimiento : 0));

    if (det.length) {
      html += '<h3 class="section-title">Por lote</h3>' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th class="no-sort">Posición</th><th class="no-sort">Lote</th>' +
        '<th class="no-sort">Atributo 02</th><th class="no-sort">Vence</th>' +
        '<th class="no-sort t-num">Físico</th>' +
        (hayDisp ? '<th class="no-sort t-num">Disponible</th>' : '') +
        '</tr></thead><tbody>';
      det.forEach(d => {
        const dispD = d.disponible !== null && d.disponible !== undefined ? d.disponible : null;
        html += '<tr>' +
          '<td class="t-code">' + U.esc(d.ubicacion || '—') +
            (d.tipo === 'altura' ? ' <span class="badge b-sd">altura</span>' : '') +
            (d.lineas > 1 ? ' <span class="muted small">(' + d.lineas + ' LPN)</span>' : '') + '</td>' +
          '<td class="t-code">' + U.esc(d.lote || '—') + '</td>' +
          '<td class="t-code">' + U.esc(d.lote2 || '—') + '</td>' +
          '<td class="muted">' + (d.vencimiento ? U.fmtFecha(d.vencimiento) : '—') + '</td>' +
          '<td class="t-num"><strong>' + U.fmt(d.stock) + '</strong></td>' +
          (hayDisp ? '<td class="t-num' + (dispD !== null && dispD < d.stock ? ' t-warn' : '') + '">' +
            (dispD !== null ? U.fmt(dispD) : '—') + '</td>' : '') +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }

    return html;
  }

  function exportarRepo(lista, cfg) {
    if (!lista.length) { U.toast('No hay nada para exportar', 'err'); return; }
    const filas = [[
      'Codigo', 'Descripcion', 'Laboratorio', 'Conservacion', 'Ambito', 'Ubicacion', 'Estado',
      'Stock en picking', 'Minimo', 'Maximo', 'Porcentaje de llenado',
      'Stock en altura', 'Unidades a reponer'
    ]];
    lista.forEach(p => filas.push([
      p.codigo, p.descripcion, p.labNombre || p.laboratorio,
      VLM.labs.ZONAS[p.conservacion] ? VLM.labs.ZONAS[p.conservacion].label : '',
      VLM.labs.AMBITOS[p.ambito] ? VLM.labs.AMBITOS[p.ambito].label : '',
      p.ubicacion,
      A.ESTADOS[p.estado].label,
      p.stockPicking !== undefined ? p.stockPicking : p.stock,
      p.stockMin, p.stockMax,
      p.ocupacion !== null ? Math.round(p.ocupacion * 100) + '%' : '',
      p.stockAltura || 0,
      p.sugerido
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
    { id: 'stockPicking',  label: 'Picking',   num: true },
    { id: 'stockAltura',   label: 'Altura',    num: true },
    { id: 'stockMin',      label: 'Mínimo',    num: true },
    { id: 'stockMax',      label: 'Máximo',    num: true },
    { id: 'ocupacion',     label: 'Llenado',   num: true },
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
        const pct = p.ocupacion !== null ? Math.min(100, p.ocupacion * 100) : 0;
        html += '<tr class="row-' + p.estado + ' row-link" data-art="' + U.esc(p.codigo) + '">' +
          '<td class="t-code">' + U.esc(p.codigo) + '</td>' +
          '<td class="t-desc">' + U.esc(p.descripcion) + '</td>' +
          '<td><i class="lab-swatch" style="display:inline-block;background:' + U.colorDe(p.labNombre || p.laboratorio) + '"></i> ' +
            U.esc(p.labNombre || p.laboratorio) + '</td>' +
          '<td>' + zchip(p.conservacion) + '</td>' +
          '<td>' + achip(p.ambito) + '</td>' +
          '<td class="t-code">' + U.esc(p.ubicacion || '—') + '</td>' +
          '<td class="t-num"><strong>' + U.fmt(p.stock) + '</strong></td>' +
          '<td class="t-num">' + (p.stockPicking === undefined ? '—'
            : (p.stockPicking > 0 ? U.fmt(p.stockPicking)
               : '<span class="sin-pick">0</span>')) + '</td>' +
          '<td class="t-num muted">' + (p.stockAltura ? U.fmt(p.stockAltura) : '—') + '</td>' +
          '<td class="t-num muted">' + (p.stockMin ? U.fmt(p.stockMin) : '—') + '</td>' +
          '<td class="t-num muted">' + (p.stockMax ? U.fmt(p.stockMax) : '—') + '</td>' +
          '<td class="t-num">' + (p.ocupacion !== null ? Math.round(p.ocupacion * 100) + '%' : '—') +
            '<div class="minibar m-' + p.estado + '"><i style="width:' + pct + '%"></i></div></td>' +
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

  /* ============================================================
     VISTA 5 · POSICIONES
     Una fila por posición física, con su mínimo y su máximo editables.
     Las posiciones ignoradas por reglas no llegan hasta acá: la app ya las
     descartó al importar, y en esta pantalla sólo serían ruido.
     ============================================================ */
  function posiciones(el, items, cfg) {
    const ui = VLM.store.state.ui;
    const cfgPos = VLM.store.state.posiciones;

    /* UNA fila por POSICIÓN + ARTÍCULO.
       Afuera del VLM cada posición de picking tiene un solo artículo y la
       fila es la posición de siempre. Adentro de la torre, en cambio, todos
       comparten VLMVENTA01/02, así que la fila es el artículo dentro de esa
       posición: es lo único que se puede configurar por separado. */
    const porSlot = {}, artsPorUbic = {};
    let enReserva = 0;
    items.forEach(p => {
      (p.detalle || []).forEach(d => {
        if (!d.ubicacion) return;
        // La reserva no se configura. Un mínimo y un máximo dicen cuándo
        // rellenar una posición y cuánto entra; en altura —o en el pasillo que
        // abastece al VLM— no se rellena nada, se saca. Cargarles un número
        // sería inventar una alerta que nadie va a atender, y son la mayoría
        // de las filas: taparían las que sí importan.
        if (d.tipo === 'altura') { enReserva++; return; }
        const u = d.ubicacion.toUpperCase();
        const k = u + '|' + String(p.codigo).toUpperCase();
        if (!artsPorUbic[u]) artsPorUbic[u] = {};
        artsPorUbic[u][p.codigo] = 1;
        if (!porSlot[k]) {
          const c = cfgPos[k] || cfgPos[u] || {};
          porSlot[k] = {
            clave: k, ubicacion: d.ubicacion, tipo: d.tipo || 'picking', zona: d.zona,
            arts: [{ codigo: p.codigo, descripcion: p.descripcion }],
            codigo: p.codigo, descripcion: p.descripcion,
            stock: 0, min: c.min || 0, max: c.max || 0,
            artConfig: c.articulo || null
          };
        }
        porSlot[k].stock += d.stock;
      });
    });
    const filas = Object.keys(porSlot).map(k => porSlot[k])
      .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion, 'es') ||
                      a.codigo.localeCompare(b.codigo, 'es'));

    /* En picking es normal que al agotarse un artículo la posición se le dé a
       otro. Ahí el mín/máx guardado es del artículo anterior y no sirve: no se
       aplica hasta confirmarlo. En una posición compartida (el VLM) esto no
       aplica: que haya otro artículo configurado ahí es lo normal. */
    filas.forEach(f => {
      const compartida = Object.keys(artsPorUbic[f.ubicacion.toUpperCase()] || {}).length > 1;
      f.compartida = compartida;
      f.reasignada = !compartida && !!(f.artConfig && (f.min || f.max) && f.artConfig !== f.codigo);
    });

    const q = U.norm(ui.busquedaPos || '');
    const vis = filas.filter(f => {
      if (q && U.norm(f.ubicacion + ' ' + f.codigo + ' ' + f.descripcion).indexOf(q) === -1) return false;
      return true;
    });

    const configuradas = filas.filter(f => f.min || f.max).length;

    let html = '<div class="kpi-grid" style="margin-bottom:16px">' +
      kpi('Posiciones de picking', U.fmt(filas.length),
          enReserva ? U.fmt(enReserva) + ' de reserva, que no se configuran' : 'una fila por artículo') +
      kpi('Con máximo cargado', U.fmt(filas.filter(f => f.max).length),
          filas.length ? Math.round(configuradas / filas.length * 100) + '% del total' : '',
          configuradas ? 'k-ok' : 'k-warn') +
      kpi('Para rellenar', U.fmt(filas.filter(f => !f.reasignada &&
            ['critico','bajo','agotado'].indexOf(estadoPosicion(f, cfg)) > -1).length),
          'bajo el ' + cfg.pctBajo + '% de su capacidad', 'k-crit') +
      kpi('Cambiaron de artículo', U.fmt(filas.filter(f => f.reasignada).length),
          'el mín/máx guardado no se aplica',
          filas.some(f => f.reasignada) ? 'k-warn' : 'k-ok') +
      '</div>';

    html += '<div class="toolbar">' +
      '<input class="input" id="posSearch" type="search" placeholder="Buscar posición o artículo…" value="' + U.esc(ui.busquedaPos || '') + '">' +
      '<div class="spacer"></div>' +
      '<button class="btn" id="posExport">Exportar plantilla</button>' +
      '<button class="btn" id="posImport">Importar completada</button>' +
      '<input type="file" id="posFile" accept=".xlsx,.xls,.csv" hidden>' +
      '<span class="muted small">' + vis.length + ' filas</span>' +
      '</div>';

    html += '<div class="notice" style="margin-bottom:12px">' +
      '<svg viewBox="0 0 24 24" class="ico" style="color:var(--accent)">' +
        '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>' +
      '<div>Escribí el <strong>mínimo</strong> (cuándo rellenar) y el <strong>máximo</strong> ' +
      '(cuánto entra) de cada artículo en su posición de picking. Se guardan y se aplican al instante.<br>' +
      '<span class="small muted">La reserva —altura y el pasillo que abastece al VLM— no se ' +
      'configura: de ahí se saca, no se rellena. Se ve en el detalle del artículo y en la reposición.</span><br>' +
      '<span class="small muted">Si son muchas, exportá la plantilla, completá las columnas Mínimo y Máximo en Excel y volvé a importarla.</span>' +
      '</div></div>';

    html += '<div class="table-wrap"><table class="table" id="posTable">' +
      '<thead><tr>' +
        '<th class="no-sort">Posición</th><th class="no-sort">Zona</th>' +
        '<th class="no-sort">Artículo</th><th class="no-sort t-num">Stock</th>' +
        '<th class="no-sort t-num">Mínimo</th><th class="no-sort t-num">Máximo</th>' +
        '<th class="no-sort">Estado</th>' +
      '</tr></thead><tbody>';

    if (!vis.length) {
      html += '<tr><td colspan="7"><div class="no-results">Sin posiciones para ese filtro</div></td></tr>';
    } else {
      vis.forEach(f => {
        let est = '', clase = '';
        if (f.reasignada) {
          est = '<span class="badge b-bajo">Revisar</span>' +
                '<button class="btn btn-icon pos-ok" data-ubic="' + U.esc(f.ubicacion) + '" ' +
                'data-art="' + U.esc(f.codigo) + '" ' +
                'title="Confirmar que estos valores sirven para el artículo nuevo">' +
                '<svg viewBox="0 0 24 24" class="ico"><path d="M20 6 9 17l-5-5"/></svg></button>';
          clase = 'row-bajo';
        }
        else {
          const e = estadoPosicion(f, cfg);
          if (e === 'sd') est = '<span class="badge b-sd">Sin cargar</span>';
          else {
            est = badge(e) + (f.max ? ' <span class="pos-pct">' +
              Math.round(f.stock / f.max * 100) + '%</span>' : '');
            if (e === 'critico' || e === 'agotado') clase = 'row-critico';
            else if (e === 'bajo') clase = 'row-bajo';
          }
        }
        html += '<tr class="' + clase + '">' +
          '<td class="t-code"><strong>' + U.esc(f.ubicacion) + '</strong></td>' +
          '<td>' + zchip(f.zona) + '</td>' +
          '<td class="t-desc"><span class="t-code">' + U.esc(f.codigo) + '</span>' +
            (f.descripcion && f.descripcion !== f.codigo ? ' ' + U.esc(f.descripcion) : '') + '</td>' +
          '<td class="t-num"><strong>' + U.fmt(f.stock) + '</strong></td>' +
          celdaInp(f, 'min') + celdaInp(f, 'max') +
          '<td>' + est + '</td>' +
          '</tr>';
      });
    }
    html += '</tbody></table></div>';

    el.innerHTML = html;

    $('#posSearch', el).addEventListener('input', U.debounce(e => {
      VLM.store.setUi({ busquedaPos: e.target.value });
    }, 220));
    // al editar se re-asocia al artículo que ocupa la posición ahora
    U.$$('.pos-inp', el).forEach(inp => {
      // un clic selecciona lo que ya está: se carga escribiendo el número
      // nuevo encima, sin tener que borrar antes
      inp.addEventListener('focus', () => inp.select());
      inp.addEventListener('change', () => {
        const v = parseInt(inp.value, 10);
        VLM.store.setPosicion(inp.dataset.ubic,
          { [inp.dataset.campo]: isFinite(v) && v > 0 ? v : 0 }, inp.dataset.art);
      });
    });
    U.$$('.pos-ok', el).forEach(b => b.addEventListener('click', () => {
      VLM.store.setPosicion(b.dataset.ubic, {}, b.dataset.art);
      U.toast('Confirmado para el artículo nuevo', 'ok');
    }));
    $('#posExport', el).addEventListener('click', () => exportarPosiciones(filas));
    $('#posImport', el).addEventListener('click', () => $('#posFile', el).click());
    $('#posFile', el).addEventListener('change', e => {
      if (e.target.files[0]) importarPosiciones(e.target.files[0]);
    });
  }

  /**
   * Celda editable de mínimo o máximo.
   * `data-k` identifica la celda entre redibujos: al guardar un valor se
   * vuelve a dibujar toda la tabla, y sin esa clave el cursor se perdía en
   * cada número cargado (ver restaurarFoco en app.js).
   */
  function celdaInp(f, campo) {
    return '<td class="t-num"><input class="pos-inp" type="number" min="0" step="1" ' +
      'inputmode="numeric" ' +
      'data-k="' + U.esc(f.ubicacion + '|' + f.codigo + '|' + campo) + '" ' +
      'data-ubic="' + U.esc(f.ubicacion) + '" data-art="' + U.esc(f.codigo) + '" ' +
      'data-campo="' + campo + '" value="' + (f[campo] || '') + '"></td>';
  }

  /**
   * Estado de UNA posición, con la misma regla que usa el resto de la app:
   * porcentaje de la capacidad. Sin máximo se cae al mínimo.
   */
  function estadoPosicion(f, cfg) {
    return A.estadoDeNivel(f.stock, f.min, f.max, cfg);
  }

  /**
   * Exporta a .xlsx, no a CSV, y fuerza Posición y Artículo a texto.
   * En CSV, Excel lee "010004100" como número y le come el cero de adelante:
   * al reimportarlo la configuración no matchearía ninguna posición.
   */
  function exportarPosiciones(filas) {
    const out = [['Posicion', 'Zona', 'Articulo', 'Descripcion', 'Stock', 'Minimo', 'Maximo']];
    filas.forEach(f => out.push([
      f.ubicacion, f.zona || '',
      f.codigo, f.descripcion === f.codigo ? '' : f.descripcion,
      f.stock, f.min || '', f.max || ''
    ]));

    const ws = XLSX.utils.aoa_to_sheet(out);
    for (let i = 1; i <= filas.length; i++) {
      ['A', 'D'].forEach(col => {
        const c = ws[col + (i + 1)];
        if (c && c.v !== undefined && c.v !== '') { c.t = 's'; c.v = String(c.v); c.z = '@'; }
      });
    }
    ws['!cols'] = [{ wch: 14 }, { wch: 9 }, { wch: 10 }, { wch: 14 },
                   { wch: 30 }, { wch: 9 }, { wch: 9 }, { wch: 9 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Posiciones');
    XLSX.writeFile(wb, 'posiciones_vlm.xlsx');
    U.toast('Exportadas ' + filas.length + ' posiciones', 'ok');
  }

  /**
   * Vuelve a leer el CSV exportado. Sólo mira Posicion, Minimo y Maximo: el
   * resto de las columnas están para que sea legible en Excel.
   */
  function importarPosiciones(file) {
    const fr = new FileReader();
    fr.onload = e => {
      try {
        // raw:false devuelve el texto formateado de la celda, que es lo que
        // conserva ceros a la izquierda en las posiciones numéricas
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],
          { header: 1, blankrows: false, raw: false, defval: '' });
        if (!filas.length) throw new Error('archivo vacío');

        const head = filas[0].map(h => U.norm(h));
        const iU = head.indexOf('posicion'), iMin = head.indexOf('minimo'), iMax = head.indexOf('maximo');
        const iArt = head.indexOf('articulo');
        if (iU === -1) throw new Error('falta la columna Posicion');

        const mapa = Object.assign({}, VLM.store.state.posiciones);
        let n = 0;
        for (let i = 1; i < filas.length; i++) {
          const f = filas[i];
          if (!f || !f[iU]) continue;
          const ubic = String(f[iU]).trim().toUpperCase();
          const art  = iArt > -1 ? String(f[iArt] || '').trim() : '';
          const k = VLM.store.clavePos(ubic, art);
          const min = iMin > -1 ? (U.toNum(f[iMin]) || 0) : 0;
          const max = iMax > -1 ? (U.toNum(f[iMax]) || 0) : 0;
          if (min || max) { mapa[k] = { min: min, max: max, ubicacion: ubic, articulo: art || undefined }; n++; }
          else delete mapa[k];
        }
        VLM.store.setPosiciones(mapa);
        U.toast(n + ' posiciones configuradas.', 'ok');
      } catch (err) {
        U.toast('No se pudo leer el archivo: ' + err.message, 'err');
      }
    };
    fr.readAsArrayBuffer(file);
  }

  return {
    dashboard, laboratorios, reposicion, inventario, posiciones, detalleArticulo,
    badge, zchip, achip, kpi, stackbar, grupoHead, zonaCard, repoItem, exportarRepo
  };
})();
