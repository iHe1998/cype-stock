/* ============================================================
   tv.js · modo televisor: pantallas rotativas a gran escala
   ============================================================ */
window.VLM = window.VLM || {};

VLM.tv = (function () {
  const U = VLM.util;
  const A = VLM.analytics;
  const C = VLM.charts;
  const V = VLM.views;
  const $ = U.$;

  let activo = false;
  let idx = 0;
  let timerSlide = null;
  let timerReloj = null;
  let timerBarra = null;
  let datos = null;   // { items, cfg }

  /* ------------------------------------------------------------
     Definición de pantallas

     El `id` es lo que se guarda en la configuración para saber qué pantallas
     están marcadas, así que no se cambia: renombrar uno equivale a dejar la
     pantalla sin marcar en todas las PCs. El nombre y la descripción salen de
     acá también para la lista de Configuración, para que no haya dos listas
     de pantallas que se vayan separando.
     ------------------------------------------------------------ */
  const SLIDES = [
    { id: 'resumen', nombre: 'Resumen general', render: slideResumen,
      desc: 'Los números del momento y dos gráficos: estado del stock y stock por laboratorio.' },
    { id: 'criticos', nombre: 'Reponer ahora', render: slideCriticos,
      desc: 'Los 8 más urgentes con su posición y cuánto reponer.',
      saltarSi: d => A.topUrgentes(d.items, 1).length === 0 },
    { id: 'frio', nombre: 'Cadena de frío', render: slideFrio,
      desc: 'Lo mismo acotado a 2 a 8 °C.',
      saltarSi: d => d.items.filter(p => p.conservacion === 'frio').length === 0 },
    { id: 'ambiente', nombre: 'Ambiente', render: slideAmbiente,
      desc: 'Lo mismo acotado a 15 a 25 °C.',
      saltarSi: d => d.items.filter(p => p.conservacion === 'ambiente').length === 0 },
    { id: 'labs', nombre: 'Laboratorios', render: slideLabs,
      desc: 'Una tarjeta por laboratorio con sus unidades y su barra de estado.' }
  ];

  /** Para la lista de casilleros de Configuración. Sin los render ni los saltarSi. */
  function pantallas() {
    return SLIDES.map(s => ({ id: s.id, nombre: s.nombre, desc: s.desc, automatica: !!s.saltarSi }));
  }

  /**
   * Qué pantallas se muestran, en orden.
   *
   * Dos filtros encima de la lista: lo que se marcó en Configuración y lo que
   * no tiene nada que mostrar ahora mismo (`saltarSi`). Cada filtro se aplica
   * sólo si deja algo: desmarcar todo, o un día sin nada en frío ni ambiente,
   * dejaría la tele del depósito en blanco sin que nadie entienda por qué.
   */
  function visibles() {
    const marcas = (datos && datos.cfg && datos.cfg.tvPantallas) || {};
    // ausente = marcada: una pantalla nueva aparece sola, sin tener que ir a
    // buscarla a Configuración en cada PC
    const marcadas = SLIDES.filter(s => marcas[s.id] !== false);
    const base = marcadas.length ? marcadas : SLIDES;
    const conDatos = base.filter(s => !(s.saltarSi && s.saltarSi(datos)));
    return (conDatos.length ? conDatos : base).map(s => SLIDES.indexOf(s));
  }

  /* ------------------------------------------------------------
     Ciclo de vida
     ------------------------------------------------------------ */
  function entrar(items, cfg, filtroLab) {
    if (!items.length) { U.toast('Cargá datos antes de usar el modo TV', 'err'); return; }
    datos = { items, cfg, filtroLab: filtroLab || null };
    activo = true;
    idx = visibles()[0];
    // para volver acá si la página se recarga sola por una versión nueva
    try { sessionStorage.setItem('vlm.tv', '1'); } catch (e) {}
    C.destruirTodos();
    $('#tvMode').hidden = false;
    document.body.style.overflow = 'hidden';
    pedirPantallaCompleta();
    reloj();
    timerReloj = setInterval(reloj, 10000);
    pintar();
    programar();
    document.addEventListener('keydown', teclas);
  }

  function salir() {
    activo = false;
    try { sessionStorage.removeItem('vlm.tv'); } catch (e) {}
    clearTimeout(timerSlide);
    clearInterval(timerReloj);
    clearInterval(timerBarra);
    document.removeEventListener('keydown', teclas);
    $('#tvMode').hidden = true;
    $('#tvBody').innerHTML = '';
    document.body.style.overflow = '';
    C.destruirTodos();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    VLM.app.render();
  }

  function pedirPantallaCompleta() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen().catch(() => {/* el navegador puede bloquearlo sin gesto */});
    }
  }

  function teclas(e) {
    if (e.key === 'Escape') { salir(); }
    else if (e.key === 'ArrowRight') { avanzar(1); }
    else if (e.key === 'ArrowLeft') { avanzar(-1); }
    else if (e.key === ' ') { e.preventDefault(); pausarReanudar(); }
  }

  let pausado = false;
  function pausarReanudar() {
    pausado = !pausado;
    if (pausado) { clearTimeout(timerSlide); clearInterval(timerBarra); $('#tvBar').style.width = '100%'; }
    else programar();
  }

  /* La rotación va por la lista de visibles, no por SLIDES: así desmarcar una
     pantalla la saca del ciclo en vez de mostrarla un rato en blanco. Si la
     que está puesta ya no está en la lista —la acabaron de desmarcar—, se
     arranca de nuevo por la primera. */
  function avanzar(paso) {
    const vis = visibles();
    const pos = vis.indexOf(idx);
    if (pos > -1) {
      idx = vis[(pos + paso + vis.length) % vis.length];
    } else {
      // la que estaba puesta se acaba de desmarcar: se sigue por la que le
      // toca, sin volver al principio de la rotación
      const orden = paso < 0 ? vis.slice().reverse() : vis;
      const sigue = orden.filter(i => paso < 0 ? i < idx : i > idx);
      idx = sigue.length ? sigue[0] : orden[0];
    }
    pintar();
    programar();
  }

  function programar() {
    clearTimeout(timerSlide);
    clearInterval(timerBarra);
    if (pausado) return;
    const ms = (datos.cfg.tvSegundos || 20) * 1000;
    const bar = $('#tvBar');
    const t0 = Date.now();
    bar.style.width = '0%';
    timerBarra = setInterval(() => {
      const p = Math.min(100, (Date.now() - t0) / ms * 100);
      bar.style.width = p + '%';
    }, 120);
    timerSlide = setTimeout(() => avanzar(1), ms);
  }

  function reloj() {
    const d = new Date();
    $('#tvClock').textContent =
      d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) +
      ' · ' + d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  }

  function pintar() {
    C.destruirTodos();
    const slide = SLIDES[idx];
    $('#tvSlideName').textContent = slide.nombre;
    pintarFiltro();
    slide.render($('#tvBody'), datos.items, datos.cfg);
  }

  /**
   * Qué laboratorio se está mirando. Los números de todas las pantallas salen
   * de los items que llegan ya filtrados, así que sin este cartel el mismo
   * panel muestra totales muy distintos sin decir por qué.
   */
  function pintarFiltro() {
    const el = $('#tvFiltro');
    const lab = datos.filtroLab;
    el.textContent = lab || 'General';
    el.classList.toggle('es-general', !lab);
  }

  /**
   * Redibuja con datos nuevos sin cortar la rotación.
   *
   * La configuración puede haber llegado de otra PC: si la pantalla que está
   * puesta se acaba de desmarcar, pasa a la siguiente en vez de quedarse ahí
   * hasta que se cumpla el tiempo.
   */
  function refrescar(items, cfg, filtroLab) {
    if (!activo) return;
    datos = { items, cfg, filtroLab: filtroLab || null };
    if (visibles().indexOf(idx) === -1) { avanzar(1); return; }
    pintar();
  }

  /* ------------------------------------------------------------
     Pantalla 1 · Resumen
     ------------------------------------------------------------ */
  function slideResumen(el, items, cfg) {
    const res = A.resumen(items, cfg);

    el.innerHTML =
      '<div class="tv-kpis">' +
        tvKpi('Productos', U.fmt(res.skus), res.labs + ' laboratorios · ' + U.fmtCompact(res.unidades) + ' u. en picking') +
        tvKpi('A reponer YA', U.fmt(res.aReponer), res.porEstado.agotado + ' agotados', res.aReponer ? 'k-crit' : 'k-ok') +
        tvKpi('Próximos a vaciarse', U.fmt(res.porEstado.bajo), 'bajo el ' + cfg.pctBajo + '% de su capacidad', res.porEstado.bajo ? 'k-warn' : 'k-ok') +
        tvKpi('En altura', U.fmtCompact(res.unidadesAltura), 'reserva para rellenar') +
      '</div>' +
      '<div class="tv-split">' +
        '<div class="tv-panel"><h3>Estado del stock</h3><div class="tv-chart"><canvas id="tvChEstados"></canvas></div></div>' +
        '<div class="tv-panel"><h3>Stock en picking por laboratorio</h3><div class="tv-chart"><canvas id="tvChLabs"></canvas></div></div>' +
      '</div>';

    C.estados($('#tvChEstados', el), res, true);
    C.stockPorLab($('#tvChLabs', el), A.porLaboratorio(items, cfg), true);
  }

  function tvKpi(label, valor, sub, clase) {
    return '<div class="tv-kpi ' + (clase || '') + '">' +
      '<div class="tv-kpi-label">' + U.esc(label) + '</div>' +
      '<div class="tv-kpi-value">' + valor + '</div>' +
      '<div class="tv-kpi-sub">' + sub + '</div></div>';
  }

  /* ------------------------------------------------------------
     Pantalla 2 · Reponer ahora
     ------------------------------------------------------------ */
  function slideCriticos(el, items, cfg) {
    const lista = A.topUrgentes(items, 8);
    const total = lista.reduce((s, p) => s + p.sugerido, 0);

    el.innerHTML =
      '<h2>⚠ Reponer ahora · ' + lista.length + ' productos · ' + U.fmt(total) + ' unidades</h2>' +
      '<div class="tv-crit">' + lista.map((p, i) => {
        const dias = p.ocupacion !== null ? Math.round(p.ocupacion * 100) + '%' : 's/d';
        return '<div class="tv-crit-row r-' + p.estado + '">' +
          '<div class="tv-crit-rank">' + (i + 1) + '</div>' +
          '<div class="tv-crit-name">' + U.esc(p.descripcion) +
            '<span class="tv-crit-lab"> · ' + U.esc(p.laboratorio) +
            (p.ubicacion ? ' · 📍 ' + U.esc(p.ubicacion) : '') + '</span></div>' +
          '<div class="tv-crit-val ' + (p.estado === 'agotado' ? 'v-agotado' : p.estado === 'bajo' ? 'v-warn' : 'v-crit') + '">' + dias +
            '<span class="tv-crit-sub">lleno</span></div>' +
          '<div class="tv-crit-val">+' + U.fmt(p.sugerido) + '<span class="tv-crit-sub">reponer</span></div>' +
          '</div>';
      }).join('') + '</div>';
  }

  /* ------------------------------------------------------------
     Pantallas · Reposición por conservación

     Frío y ambiente son la misma pantalla: cambia qué se filtra y cómo
     se titula. Una sola función y dos llamadas, así no se separan con
     el tiempo — la de ambiente nació de copiar la de frío.
     ------------------------------------------------------------ */
  function slideFrio(el, items, cfg) {
    slideConservacion(el, items, cfg, {
      conservacion: 'frio',
      titulo: '❄ Cadena de frío · 2 a 8 °C',
      kpiSkus: 'SKU refrigerados',
      sinAlertas: 'Sin alertas en cadena de frío'
    });
  }

  function slideAmbiente(el, items, cfg) {
    slideConservacion(el, items, cfg, {
      conservacion: 'ambiente',
      titulo: '🌡 Ambiente · 15 a 25 °C',
      kpiSkus: 'SKU en ambiente',
      sinAlertas: 'Sin alertas en ambiente'
    });
  }

  function slideConservacion(el, items, cfg, o) {
    const sel = items.filter(p => p.conservacion === o.conservacion);
    const res = A.resumen(sel, cfg);
    const urgentes = A.topUrgentes(sel, 6);

    el.innerHTML =
      '<h2>' + o.titulo + '</h2>' +
      '<div class="tv-kpis" style="grid-template-columns:repeat(3,1fr)">' +
        tvKpi(o.kpiSkus, U.fmt(res.skus), U.fmtCompact(res.unidades) + ' u. en picking') +
        tvKpi('En alerta', U.fmt(res.enAlerta),
              res.porEstado.agotado + ' agotados · ' + res.porEstado.critico + ' críticos',
              res.enAlerta ? 'k-crit' : 'k-ok') +
        tvKpi('Unidades a reponer', U.fmtCompact(sel.reduce((s, p) => s + p.sugerido, 0)),
              'hasta llenar las posiciones') +
      '</div>' +
      (urgentes.length
        ? '<div class="tv-crit" style="margin-top:1.6vh">' + urgentes.map((p, i) => {
            const dias = p.ocupacion !== null ? Math.round(p.ocupacion * 100) + '%' : 's/d';
            return '<div class="tv-crit-row r-' + p.estado + '">' +
              '<div class="tv-crit-rank">' + (i + 1) + '</div>' +
              '<div class="tv-crit-name">' + U.esc(p.descripcion) +
                '<span class="tv-crit-lab"> · ' + U.esc(p.labNombre || p.laboratorio) +
                (p.ubicacion ? ' · 📍 ' + U.esc(p.ubicacion) : '') + '</span></div>' +
              '<div class="tv-crit-val ' + (p.estado === 'agotado' ? 'v-agotado' : p.estado === 'bajo' ? 'v-warn' : 'v-crit') + '">' + dias +
                '<span class="tv-crit-sub">lleno</span></div>' +
              '<div class="tv-crit-val">+' + U.fmt(p.sugerido) + '<span class="tv-crit-sub">reponer</span></div>' +
              '</div>';
          }).join('') + '</div>'
        : '<div class="tv-panel" style="margin-top:1.6vh;align-items:center;justify-content:center">' +
          '<h3 style="color:var(--ok)">' + o.sinAlertas + '</h3></div>');
  }

  /* ------------------------------------------------------------
     Pantalla 3 · Laboratorios
     ------------------------------------------------------------ */
  function slideLabs(el, items, cfg) {
    const labs = A.porLaboratorio(items, cfg).slice(0, 8);
    el.innerHTML =
      '<h2>Stock en picking por laboratorio</h2>' +
      '<div class="tv-labs">' + labs.map(l => {
        const r = l.resumen;
        return '<div class="tv-lab">' +
          '<div class="tv-lab-name"><i style="background:' + l.color + '"></i>' + U.esc(l.nombre) + '</div>' +
          '<div class="tv-lab-num">' + U.fmtCompact(r.unidades) + '</div>' +
          '<div class="tv-lab-sub">' + r.skus + ' SKU · ' +
            (r.enAlerta ? '<strong style="color:var(--warn)">' + r.enAlerta + ' en alerta</strong>' : 'sin alertas') +
          '</div>' + V.stackbar(r) + '</div>';
      }).join('') + '</div>';
  }

  return { entrar, salir, refrescar, pantallas, get activo() { return activo; } };
})();
