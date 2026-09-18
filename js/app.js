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
  let vistaDibujada = null; // qué vista mostró el último render, para el scroll

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
    wireNube();
    wireCfgNav();
    wireAsistente();
    S.on(motivo => {
      if (motivo === 'labs') reclasificar();
      // lo que acaba de bajar de la base no se vuelve a subir
      if (motivo === 'posiciones') { reaplicarPosiciones(); if (!aplicandoDeNube) sincronizarMaximosPronto(); }
      if (motivo === 'ubicaciones') reaplicarReglas();
      if (motivo === 'cfg' || motivo === 'datos') calculados = null;
      // la configuración compartida bajó de la base: un solo repaso de todo
      if (motivo === 'compartida') { reclasificar(); reaplicarReglas(true); calculados = null; }
      // umbrales, laboratorios y reglas cambian lo que ven todos, así que viajan
      if (!aplicandoDeNube && (motivo === 'cfg' || motivo === 'labs' || motivo === 'ubicaciones')) {
        sincronizarConfigPronto();
      }
      render();
    });
    // Al abrir: las reglas de posición pueden haber cambiado desde la última
    // importación (por editarlas o por abrir una versión nueva de la app), y
    // los productos guardados traen la clasificación de ese momento.
    if (S.hayDatos()) reaplicarReglas(true);
    render();
    // sin esto, el botón de importar queda habilitado hasta que alguien abra
    // Configuración por primera vez
    aplicarBloqueo();
    // los máximos compartidos se traen al abrir, sin bloquear el dibujado:
    // si la base no responde, el panel igual muestra lo que hay guardado
    if (VLM.nube.configurada()) bajarDeNube(true);
    setInterval(actualizarEstado, 60000);
    setInterval(refrescoPeriodico, REFRESCO_MS);
    mirarVersion();   // deja anotada la versión con la que arrancó

    $('#btnActualizar').addEventListener('click', () => location.reload());
    $('#btnAvisoCerrar').addEventListener('click', () => { $('#avisoVersion').hidden = true; });

    /* Si la pantalla se recargó sola estando en modo TV, vuelve a entrar:
       si no, la tele se quedaría en el resumen sin rotar y nadie la va a
       tocar. La pantalla completa sí se pierde —el navegador no la da sin
       un clic—, pero la del depósito suele estar en F11, que sí sobrevive. */
    try {
      if (sessionStorage.getItem('vlm.tv') === '1' && S.hayDatos()) {
        VLM.tv.entrar(itemsVisibles(), S.state.cfg, S.state.ui.filtroLab);
      }
    } catch (e) {}
  }

  /* ------------------------------------------------------------
     Refresco periódico

     La pantalla del depósito queda prendida todo el día y nadie la va a
     recargar. Sin esto mostraría lo de la hora en que se abrió, y dos
     pantallas abiertas en momentos distintos dirían cosas distintas.
     ------------------------------------------------------------ */
  const REFRESCO_MS = 150000;   // 2 min y medio

  /* ------------------------------------------------------------
     Versión nueva publicada

     Los datos se refrescan solos, pero el programa es el que se cargó al
     abrir la página. La pantalla del depósito queda con el código de esa
     mañana hasta que alguien la recargue, y nadie la va a recargar.

     version.json lo escribe build.ps1 en cada compilada. Si no existe —el
     archivo suelto del pendrive, o una versión vieja de la web— no pasa
     nada: esto queda callado.
     ------------------------------------------------------------ */
  let versionVista = null;

  async function mirarVersion() {
    let v;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      v = await r.json();
    } catch (e) { return; }   // sin internet o sin el archivo: no molestar

    const firma = (v.commit || '') + ' · ' + (v.compilado || '');
    if (firma === ' · ') return;
    // en la web el pie dice "build local" porque el sello lo pone el build
    // del archivo suelto; acá sí se sabe qué versión está corriendo
    const pie = $('#appVersion');
    if (pie && pie.textContent === 'build local') pie.textContent = 'web · ' + firma;
    if (versionVista === null) { versionVista = firma; return; }
    if (firma === versionVista) return;
    versionVista = firma;

    /* En modo TV se recarga sola: es la pantalla que nadie mira de cerca y
       la única que nadie va a recargar nunca. En cualquier otro caso se
       avisa y decide la persona — recargarle la pantalla a alguien que está
       leyendo la lista de reposición es peor que mostrarle código de ayer. */
    if (VLM.tv.activo) { location.reload(); return; }
    $('#avisoVersion').hidden = false;
  }

  function refrescoPeriodico() {
    mirarVersion();
    if (!VLM.nube.configurada()) return;
    // no mientras alguien está cargando un número: le cambiaría la tabla debajo
    const act = document.activeElement;
    if (act && act.classList && act.classList.contains('pos-inp')) return;
    // ni con una pantalla abierta encima, que se redibuja de atrás
    if (!$('#modalSettings').hidden || !$('#modalImport').hidden || !$('#modalIA').hidden) return;
    bajarDeNube(true);
  }

  /**
   * Reaplica el mínimo y el máximo sobre los productos ya cargados.
   * No hace falta reimportar: cada producto guarda su stock por posición.
   */
  function reaplicarPosiciones() {
    P.aplicarPosiciones(S.state.productos, S.state.posiciones);
    S.guardar();
    calculados = null;
  }

  /**
   * Reaplica las reglas de posición: tipo (picking/altura), zona y ámbito.
   * No hace falta reimportar; cada producto guarda sus ubicaciones.
   *
   * @param silencioso al arrancar, sin avisar ni redibujar de más
   */
  function reaplicarReglas(silencioso) {
    P.reaplicarReglas(S.state.productos, S.state.reglasUbic, S.state.labs);
    P.aplicarPosiciones(S.state.productos, S.state.posiciones);
    S.guardar();
    calculados = null;
    if (silencioso) return;
    // decir cuántos quedaron afuera del todo: si no, desaparecen sin explicación
    const fuera = S.state.productos.filter(p =>
      p.ignorado || (p.detalleIgnorado && p.detalleIgnorado.length && !(p.detalle || []).length)).length;
    U.toast('Reglas aplicadas sobre el stock cargado' +
            (fuera ? ' · ' + fuera + ' artículo(s) quedaron ignorados por completo' : ''), 'ok');
  }

  /** Reaplica el catálogo de laboratorios sobre los productos ya cargados. */
  function reclasificar() {
    const cat = S.state.labs;
    S.state.productos.forEach(p => VLM.labs.clasificar(p, cat));
    S.guardar();
    calculados = null;
  }

  /**
   * Todos los artículos con sus métricas, SIN los filtros de la barra.
   * El asistente busca sobre esto: pedirle un SKU y que no aparezca porque
   * la pantalla estaba filtrada por frío sería desconcertante.
   */
  function itemsCalculados() {
    if (!calculados) {
      // los que una regla de ignorar dejó sin ninguna posición no existen ni
      // para el panel ni para el buscador: se pidió que no estuvieran
      calculados = A.calcular(S.state.productos, S.state.cfg)
        .filter(p => !P.estaIgnorado(p));
    }
    return calculados;
  }

  /**
   * Productos que se muestran: calculados, sin los laboratorios fuera del
   * catálogo (si así está configurado) y filtrados por ámbito, conservación
   * y laboratorio.
   *
   * @param sinLab deja afuera el filtro de laboratorio. Lo usa la propia barra
   *   para armar su desplegable: si se filtrara, quedaría una sola opción y no
   *   habría cómo volver.
   */
  function itemsVisibles(sinLab) {
    const ui = S.state.ui;
    let items = itemsCalculados();
    const cfg = S.state.cfg;

    /* Fuera los que no tienen ninguna posición de picking.

       Son SKU que están sólo en los racks, sin lugar asignado en el piso. El
       panel es sobre qué reponer en picking, y de esos no hay nada que
       reponer: no se les carga máximo, así que caían todos en «sin datos» y
       ensuciaban los gráficos y el inventario con filas que nunca van a
       cambiar de estado. Se los sigue encontrando desde el buscador. */
    items = items.filter(p => !p.sinPicking);

    if (cfg.labsNoListados === 'excluir') items = items.filter(p => p.gestionado);
    items = A.filtrarPorZona(items, ui);
    // el laboratorio es un filtro global como los otros dos: afecta al resumen
    // y a sus gráficos, no sólo a las listas
    if (!sinLab && ui.filtroLab) {
      items = items.filter(p => (p.labNombre || p.laboratorio) === ui.filtroLab);
    }
    return items;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    /* Guardar un valor redibuja la vista entera. Sin esto, cargar de corrido
       los máximos de la tabla de posiciones perdía dos cosas en cada número:
       el cursor, y el lugar de la lista. Al reemplazar el innerHTML la página
       se queda sin alto por un instante, el navegador recorta el scroll a lo
       que entra —o sea, arriba de todo— y cuando vuelve el contenido ya se
       perdió. Cargar los últimos artículos de la lista era bajar de nuevo
       después de cada carga. */
    const focoPrev = document.activeElement && document.activeElement.dataset
      ? document.activeElement.dataset.k : null;
    const scrollPrev = window.scrollY;
    const tablasPrev = scrollDeTablas();
    const vistaPrev = vistaDibujada;
    const hay = S.hayDatos();
    $('#empty').hidden = hay;
    $('#tabs').hidden = !hay;
    $('#zonebar').hidden = !hay;
    $$('.view').forEach(v => v.hidden = true);
    actualizarEstado();
    if (!hay) return;

    const cfg = S.state.cfg;
    const items = itemsVisibles();
    sincronizarZonebar(items, itemsVisibles(true));

    const vista = S.state.ui.vista;
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === vista));
    const el = $('#view-' + vista);
    if (!el) return;
    el.hidden = false;

    if (!items.length) {
      el.innerHTML = '<div class="no-results"><strong>Ningún producto coincide con el filtro</strong><br>' +
        '<span class="small">Probá con “Todo”, “Todas” y “Todos los laboratorios” en la barra de arriba.</span></div>';
      return;
    }
    try {
      if (vista === 'dashboard') V.dashboard(el, items, cfg);
      else if (vista === 'labs')  V.laboratorios(el, items, cfg);
      else if (vista === 'repo')  V.reposicion(el, items, cfg);
      else if (vista === 'inv')   V.inventario(el, items, cfg);
      else if (vista === 'pos')   V.posiciones(el, items, cfg);
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

    // clic en un artículo -> detalle (es el único lugar donde se ve el
    // disponible: en los gráficos y los estados manda el físico)
    /* Por uid y no por código: el mismo SKU puede estar dos veces, una por
       propietario, y son artículos distintos. (`data-art`, que es otra cosa,
       lleva el código suelto para configurar la posición.) */
    $$('[data-uid]', el).forEach(n => {
      n.addEventListener('click', ev => {
        if (ev.target.closest('input, button, a')) return;
        abrirArticulo(n.dataset.uid, items, cfg);
      });
    });

    if (focoPrev) restaurarFoco(el, focoPrev);

    // Volver a donde estaba, pero sólo si es la MISMA vista: al cambiar de
    // pestaña se arranca arriba, que es de donde se empieza a leer.
    if (vista === vistaPrev) {
      if (scrollPrev > 0) window.scrollTo(0, scrollPrev);
      restaurarScrollDeTablas(tablasPrev);
    } else if (vistaPrev !== null) window.scrollTo(0, 0);
    vistaDibujada = vista;

    if (VLM.tv.activo) VLM.tv.refrescar(items, cfg, S.state.ui.filtroLab);
  }

  /* Las tablas de Inventario y Posiciones tienen su propio scroll, aparte del
     de la página, y ahí estaba el salto de verdad: al redibujar, la tabla
     nueva arranca arriba de todo aunque la página no se haya movido. Cargando
     los máximos de los últimos artículos, cada número devolvía la lista al
     principio. Se toman por orden de aparición, que es estable entre un
     redibujo y el siguiente. */
  function scrollDeTablas() {
    return $$('.view:not([hidden]) .table-wrap')
      .map(w => [w.scrollTop, w.scrollLeft]);
  }

  function restaurarScrollDeTablas(previos) {
    if (!previos || !previos.length) return;
    const aplicar = () => {
      $$('.view:not([hidden]) .table-wrap').forEach((w, i) => {
        const p = previos[i];
        if (!p) return;
        // leer scrollHeight fuerza el cálculo del layout: sin esto se asigna
        // sobre una tabla que todavía no tiene alto y el navegador recorta el
        // valor a lo que entra
        void w.scrollHeight;
        if (p[0]) w.scrollTop = p[0];
        if (p[1]) w.scrollLeft = p[1];
      });
    };
    aplicar();
    // y de nuevo en el próximo cuadro, por si en el primer intento la tabla
    // todavía no tenía su alto definitivo y el valor quedó recortado
    requestAnimationFrame(aplicar);
  }

  /** Devuelve el cursor al mismo campo después de redibujar. */
  function restaurarFoco(el, clave) {
    const n = el.querySelector('[data-k="' + clave.replace(/"/g, '\\"') + '"]');
    if (!n) return;
    // preventScroll: focus() por defecto lleva el elemento a la vista, y eso
    // pelearía con la restauración del scroll de unas líneas más abajo
    n.focus({ preventScroll: true });
    if (n.select) n.select();
  }

  /** @param id el uid del artículo (código|propietario); tolera un código suelto */
  function abrirArticulo(id, items, cfg) {
    const p = items.filter(x => x.uid === id)[0] || items.filter(x => x.codigo === id)[0];
    if (!p) return;
    /* Con el propietario adelante: el mismo SKU puede estar dos veces, con la
       misma descripción, y sin esto las dos fichas se ven idénticas. */
    const nombre = p.descripcion && p.descripcion !== p.codigo ? p.descripcion : p.codigo;
    $('#artTitulo').textContent = nombre + ' · ' + (p.labNombre || p.laboratorio);
    $('#artBody').innerHTML = V.detalleArticulo(p, cfg);
    $('#modalArt').hidden = false;
  }

  /* ---------- barra de ámbito / conservación ---------- */

  function wireZonebar() {
    $$('#zonebar .seg').forEach(seg => {
      const clave = seg.dataset.key;
      U.$$('.seg-btn', seg).forEach(btn => btn.addEventListener('click', () => {
        S.setUi({ [clave]: btn.dataset.val || null });
      }));
    });
    $('#zoneLab').addEventListener('change', e => {
      S.setUi({ filtroLab: e.target.value || null });
    });
  }

  /**
   * @param items      lo que se está mostrando, con todos los filtros puestos
   * @param itemsSinLab lo mismo pero sin el filtro de laboratorio: de ahí
   *   salen las opciones del desplegable, para que se pueda volver a "todos"
   *   y para que no quede una sola opción una vez elegido uno.
   */
  function sincronizarZonebar(items, itemsSinLab) {
    const ui = S.state.ui;
    $$('#zonebar .seg').forEach(seg => {
      const actual = ui[seg.dataset.key] || '';
      U.$$('.seg-btn', seg).forEach(btn =>
        btn.classList.toggle('is-active', btn.dataset.val === actual));
    });

    // --- laboratorios presentes en lo que se está viendo ---
    const cuenta = {};
    itemsSinLab.forEach(p => {
      const n = p.labNombre || p.laboratorio;
      cuenta[n] = (cuenta[n] || 0) + 1;
    });
    const nombres = Object.keys(cuenta).sort((a, b) => a.localeCompare(b, 'es'));
    // el elegido va igual aunque el filtro de zona lo haya dejado sin productos:
    // si no, el desplegable mostraría otra cosa que la que se está filtrando
    if (ui.filtroLab && nombres.indexOf(ui.filtroLab) === -1) nombres.push(ui.filtroLab);

    const sel = $('#zoneLab');
    const firma = nombres.map(n => n + ':' + (cuenta[n] || 0)).join('|') + '#' + (ui.filtroLab || '');
    if (sel.dataset.firma !== firma) {
      sel.innerHTML = '<option value="">Todos los laboratorios</option>' +
        nombres.map(n => '<option value="' + U.esc(n) + '"' +
          (ui.filtroLab === n ? ' selected' : '') + '>' + U.esc(n) +
          (cuenta[n] ? ' (' + cuenta[n] + ')' : '') + '</option>').join('');
      sel.dataset.firma = firma;
    }
    sel.classList.toggle('is-active', !!ui.filtroLab);

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
      VLM.tv.entrar(itemsVisibles(), S.state.cfg, S.state.ui.filtroLab);
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

  /* ============================================================
     ASISTENTE · buscar y cambiar datos escribiendo

     La interpretación de la frase vive en asistente.js; acá está sólo
     lo que se ve y lo que se aplica. Nada se cambia sin que antes se
     muestre qué va a pasar y alguien lo confirme: una frase mal
     entendida no puede pisar un máximo de callado.
     ============================================================ */
  function wireAsistente() {
    const inp = $('#iaInput');
    $('#btnAsistente').addEventListener('click', abrirAsistente);
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); abrirAsistente();
      }
    });
    inp.addEventListener('input', U.debounce(pintarAsistente, 110));
    // escribir y dar Enter: lo normal es aceptar lo primero que salió
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const primero = $('#iaCuerpo .ia-fila, #iaCuerpo .ia-aplicar');
      if (primero) primero.click();
    });
  }

  function abrirAsistente() {
    if (!S.hayDatos()) { U.toast('Cargá el stock antes de usar el buscador', 'err'); return; }
    $('#modalIA').hidden = false;
    $('#iaInput').value = '';
    pintarAsistente();
    $('#iaInput').focus();
  }

  function pintarAsistente() {
    const cuerpo = $('#iaCuerpo');
    const r = VLM.asistente.interpretar($('#iaInput').value, itemsCalculados());
    if (r.accion === 'ayuda')  return iaEjemplos(cuerpo);
    if (r.accion === 'ir')     return iaIr(cuerpo, r);
    if (r.accion === 'cambio') return iaCambio(cuerpo, r);
    iaResultados(cuerpo, r);
  }

  function iaEntendido(txt, cuenta) {
    return '<div class="ia-entendido">Entendí: <strong>' + U.esc(txt) + '</strong>' +
      (cuenta === undefined ? '' :
        '<span class="ia-cuenta">' + U.fmt(cuenta) + (cuenta === 1 ? ' resultado' : ' resultados') + '</span>') +
      '</div>';
  }

  function iaAviso(txt) {
    return '<div class="ia-aviso"><svg viewBox="0 0 24 24" class="ico">' +
      '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 16.5h.01"/></svg>' +
      '<div>' + U.esc(txt) + '</div></div>';
  }

  /**
   * @param mostrarTodas para "dónde está X": las ubicaciones, no sólo la primera
   * @param campo 'min'|'max' si la frase pidió ese dato: se muestra ese
   */
  function iaFila(p, mostrarTodas, campo) {
    const ub = mostrarTodas ? (p.ubicaciones || []).join(' · ') : p.ubicacion;
    const ref = p.stockRef !== undefined ? p.stockRef : p.stock;
    const hayMax = p.stockMax > 0;
    const num = campo === 'min'
      ? U.fmt(p.stockMin || 0) + '<span>de mínimo</span>'
      : U.fmt(ref) + (hayMax ? ' / ' + U.fmt(p.stockMax) : '') +
        '<span>' + (hayMax ? 'de su máximo' : 'sin máximo') + '</span>';
    return '<button class="ia-fila" data-uid="' + U.esc(p.uid || p.codigo) + '" ' +
      'data-cod="' + U.esc(p.codigo) + '">' +
      V.badge(p.estado) +
      '<span class="ia-fila-txt"><strong>' + U.esc(p.descripcion || p.codigo) + '</strong>' +
      '<span class="ia-fila-sub">' + U.esc(p.codigo) + ' · ' +
        U.esc(p.labNombre || p.laboratorio) + (ub ? ' · 📍 ' + U.esc(ub) : '') + '</span></span>' +
      '<span class="ia-fila-num">' + num + '</span>' +
      '</button>';
  }

  /** Clic en un resultado: abre el detalle del artículo. */
  function iaAlDetalle(cuerpo) {
    $$('.ia-fila', cuerpo).forEach(b => b.addEventListener('click', () => {
      $('#modalIA').hidden = true;
      abrirArticulo(b.dataset.uid, itemsCalculados(), S.state.cfg);
    }));
  }

  function iaEjemplos(cuerpo) {
    cuerpo.innerHTML = '<div class="ia-ej-tit">Probá con</div><div class="ia-ejemplos">' +
      VLM.asistente.ejemplos(itemsCalculados()).map(e =>
        '<button class="ia-ej" data-ej="' + U.esc(e.txt) + '"><code>' + U.esc(e.txt) +
        '</code><span>' + U.esc(e.que) + '</span></button>').join('') + '</div>';
    $$('.ia-ej', cuerpo).forEach(b => b.addEventListener('click', () => {
      $('#iaInput').value = b.dataset.ej;
      pintarAsistente();
      $('#iaInput').focus();
    }));
  }

  function iaResultados(cuerpo, r) {
    if (!r.items.length) {
      cuerpo.innerHTML = iaEntendido(r.entendido, 0) +
        '<div class="ia-nada">Ningún artículo coincide.</div>';
      return;
    }
    const TOPE = 40;
    const lista = r.items.slice(0, TOPE);
    cuerpo.innerHTML = iaEntendido(r.entendido, r.items.length) +
      lista.map(p => iaFila(p, !!r.filtros.donde, r.filtros.campo)).join('') +
      (r.items.length > TOPE
        ? '<div class="ia-nada">y ' + U.fmt(r.items.length - TOPE) + ' más · afiná la búsqueda</div>' : '');
    iaAlDetalle(cuerpo);
  }

  function iaIr(cuerpo, r) {
    cuerpo.innerHTML = '<div class="ia-cambio"><h4>' + U.esc(r.entendido) + '</h4>' +
      '<div class="cfg-actions" style="margin-top:12px">' +
      '<button class="btn btn-primary ia-aplicar" id="iaIr">Ir</button></div></div>';
    $('#iaIr').addEventListener('click', () => {
      $('#modalIA').hidden = true;
      if (r.destino === 'tv') VLM.tv.entrar(itemsVisibles(), S.state.cfg, S.state.ui.filtroLab);
      else if (r.destino === 'config') abrirSettings();
      else irA(r.vista);
    });
  }

  function iaCambio(cuerpo, r) {
    const etiqueta = r.campo === 'max' ? 'máximo' : 'mínimo';

    // varios artículos coinciden: elegir uno reescribe la frase con su código
    if (r.candidatos) {
      cuerpo.innerHTML = iaEntendido(r.entendido) + iaAviso(r.problema) +
        r.candidatos.map(p => iaFila(p)).join('') +
        (r.total > r.candidatos.length
          ? '<div class="ia-nada">y ' + U.fmt(r.total - r.candidatos.length) + ' más</div>' : '');
      $$('.ia-fila', cuerpo).forEach(b => b.addEventListener('click', () => {
        $('#iaInput').value = etiqueta + ' ' + r.valor + ' ' + b.dataset.cod;
        pintarAsistente();
        $('#iaInput').focus();
      }));
      return;
    }

    if (r.problema) {
      cuerpo.innerHTML = iaEntendido(r.entendido) + iaAviso(r.problema);
      return;
    }

    const trabado = !VLM.nube.puedeEditar();
    cuerpo.innerHTML = iaEntendido(r.entendido) +
      (trabado ? iaAviso('Hace falta iniciar sesión con una cuenta autorizada para cambiar valores.') : '') +
      r.posiciones.map((pos, i) =>
        '<div class="ia-cambio">' +
          '<h4>' + U.esc(r.producto.descripcion || r.producto.codigo) + '</h4>' +
          '<p>' + U.esc(r.producto.codigo) + ' · 📍 ' + U.esc(pos.ubicacion) +
            ' · ' + U.fmt(pos.stock) + ' en esa posición</p>' +
          '<div class="ia-flecha">' +
            '<b class="ia-antes">' + U.fmt(pos[r.campo] || 0) + '</b><span>→</span>' +
            '<b class="ia-despues">' + U.fmt(r.valor) + '</b>' +
            '<small>' + etiqueta + '</small>' +
          '</div>' +
          '<div class="cfg-actions"><button class="btn btn-primary ia-aplicar" data-i="' + i + '"' +
            (trabado ? ' disabled' : '') + '>Aplicar</button></div>' +
        '</div>').join('');

    $$('.ia-aplicar', cuerpo).forEach(b => b.addEventListener('click', () => {
      const pos = r.posiciones[+b.dataset.i];
      const cambio = {}; cambio[r.campo] = r.valor;
      S.setPosicion(pos.ubicacion, cambio, r.producto.codigo);
      U.toast(etiqueta + ' de ' + (r.producto.descripcion || r.producto.codigo) +
              ' en ' + pos.ubicacion + ': ' + U.fmt(r.valor), 'ok');
      $('#modalIA').hidden = true;
    }));
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
                           { agrupar: $('#impAgrupar').checked, reglas: S.state.reglasUbic, posiciones: S.state.posiciones });
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
    const cols = ['codigo', 'descripcion', 'laboratorio', 'ubicacion', 'stock', 'stockMin', 'stockMax'];
    const labels = ['Código', 'Descripción', 'Laboratorio', 'Ubicación', 'Stock', 'Mínimo', 'Máximo'];
    $('#prevTable').innerHTML =
      '<thead><tr>' + labels.map(l => '<th class="no-sort">' + l + '</th>').join('') + '</tr></thead>' +
      '<tbody>' + muestra.map(p => '<tr>' + cols.map(c => {
        const v = p[c];
        const num = typeof v === 'number';
        return '<td class="' + (num ? 't-num' : '') + '">' +
          U.esc(num ? U.fmt(v) : (v || '—')) + '</td>';
      }).join('') + '</tr>').join('') + '</tbody>';
  }

  function confirmarImport() {
    if (!validarMapeo()) return;
    const r = imp.resultado || P.normalizar(imp.matriz, imp.filaHeader, imp.mapa, S.state.cfg, S.state.labs,
                                            { agrupar: $('#impAgrupar').checked, reglas: S.state.reglasUbic, posiciones: S.state.posiciones });
    if (!r.productos.length) { U.toast('No hay filas válidas para importar', 'err'); return; }

    S.setProductos(r.productos, {
      archivo: imp.nombre,
      hoja: imp.hoja,
      filas: r.productos.length,
      importadoEn: Date.now(),
      mapeo: Object.assign({}, imp.mapa),
      ubicacionesVistas: r.ubicacionesVistas || []
    });
    $('#modalImport').hidden = true;
    U.toast('Importados ' + r.productos.length + ' productos', 'ok');
    r.avisos.forEach(a => U.toast(a));
    // y se comparte solo: quien importa no tiene que acordarse de subirlo
    subirStockANube();
  }

  /* ============================================================
     MÁXIMOS: RESPALDO Y CARGA MASIVA
     ============================================================ */

  /**
   * Carga máximos desde el Excel que genera "Exportar máximos".
   *
   * No toca el stock, y eso es lo que lo hace seguro. Pasar los máximos por
   * la importación normal significaría que el mismo archivo reemplaza el
   * stock, y como sólo tiene posiciones de picking se perderían todas las de
   * reserva sin que nadie lo hubiera pedido.
   *
   * Manda lo que diga el archivo para las filas que trae: una fila con las
   * dos columnas en blanco borra ese máximo. Las posiciones que no están en
   * el archivo no se tocan.
   */
  async function importarMaximos(file) {
    try {
      const r = await P.leerArchivo(file);
      const matriz = P.hojaAMatriz(r.wb, r.hojas[0]);
      if (!matriz.length) throw new Error('la hoja está vacía');

      const cab = (matriz[0] || []).map(c => U.norm(c));
      const iUbic = cab.indexOf('ubicacion');
      const iCod  = cab.indexOf('codigo');
      const iMin  = cab.indexOf('minimo');
      const iMax  = cab.indexOf('maximo');
      if (iUbic < 0 || iCod < 0 || (iMin < 0 && iMax < 0)) {
        throw new Error('faltan columnas. Se esperan Ubicacion, Codigo, Minimo y Maximo, ' +
                        'como las que salen de «Exportar máximos»');
      }

      const mapa = Object.assign({}, S.state.posiciones);
      let puestos = 0, borrados = 0, ignoradas = 0;
      for (let i = 1; i < matriz.length; i++) {
        const f = matriz[i] || [];
        const ubic = String(f[iUbic] == null ? '' : f[iUbic]).trim();
        const cod  = String(f[iCod]  == null ? '' : f[iCod]).trim();
        if (!ubic || !cod) { ignoradas++; continue; }
        const min = iMin < 0 ? 0 : (U.toNum(f[iMin]) || 0);
        const max = iMax < 0 ? 0 : (U.toNum(f[iMax]) || 0);
        const k = S.clavePos(ubic, cod);
        if (!min && !max) {
          if (mapa[k]) { delete mapa[k]; borrados++; }
          continue;
        }
        mapa[k] = { ubicacion: ubic.toUpperCase(), articulo: cod, min: min, max: max };
        puestos++;
      }

      if (!puestos && !borrados) { U.toast('El archivo no trae ningún máximo', 'err'); return; }
      // Lo que borra no se ve hasta que pasó: mejor decirlo antes.
      if (borrados && !confirm('Se van a cargar ' + puestos + ' máximos y borrar ' + borrados +
            ' que en el archivo quedaron en blanco. ¿Seguir?')) return;

      S.setPosiciones(mapa);
      U.toast('Cargados ' + puestos + ' máximos' +
              (borrados ? ' · ' + borrados + ' borrados' : '') +
              (ignoradas ? ' · ' + ignoradas + ' filas sin ubicación o código' : ''), 'ok');
    } catch (e) {
      U.toast('No se pudieron cargar los máximos: ' + e.message, 'err');
    }
  }

  /* ============================================================
     DATOS DE EJEMPLO
     ============================================================ */
  /* Datos de ejemplo. Las ubicaciones son las de verdad: adentro del VLM todo
     comparte VLMVENTA01 (frío) o VLMVENTA02 (ambiente), y lo de afuera usa
     posiciones de pasillo PPPBBBNNN, con algunas de altura para que se vea de
     dónde bajar mercadería. */
  const DEMO = [
    ['Codigo','Descripcion','Laboratorio','Ubicacion','Stock fisico','Disponible','Asignado','Estatus','Stock Minimo','Stock Maximo','Lote','Atributo 02','Atributo 07','Vencimiento'],

    // --- ASTRAZENECA · VLM ---
    ['AZ-101','Tagrisso 80mg x30 comp','ASTRAZENECA','VLMVENTA02',140,110,30,'OK',60,320,'AZ4411','FMNZ','1000','2027-08-31'],
    ['AZ-102','Forxiga 10mg x28 comp','ASTRAZENECA','VLMVENTA02',62,62,0,'OK',80,400,'AZ4418','EGKD','1000','2027-11-30'],
    ['AZ-103','Crestor 20mg x30 comp','ASTRAZENECA','VLMVENTA02',410,395,15,'OK',120,600,'AZ4423','SX695','1000','2028-02-28'],
    // reserva de un artículo del VLM: pasillo, y una en nivel 100 — que en un
    // artículo de pasillo sería picking, pero acá es con lo que se rellena la torre
    ['AZ-103','Crestor 20mg x30 comp','ASTRAZENECA','005023300',900,900,0,'OK',120,600,'AZ4423','SX695','1000','2028-02-28'],
    ['AZ-103','Crestor 20mg x30 comp','ASTRAZENECA','004023100',240,240,0,'OK',120,600,'AZ4423','SX695','1000','2028-02-28'],
    ['AZ-104','Symbicort 160/4.5 turbuhaler','ASTRAZENECA','VLMVENTA02',228,228,0,'OK',90,450,'AZ4430','VKRT','1000','2027-06-30'],
    ['AZ-105','Imfinzi 500mg vial','ASTRAZENECA','VLMVENTA01',18,4,14,'OK',12,60,'AZ7702','BCDG','1000','2027-03-31'],
    ['AZ-106','Faslodex 250mg jeringa x2','ASTRAZENECA','VLMVENTA01',34,34,0,'OK',20,90,'AZ7715','SW829','1000','2027-09-30'],

    // --- ROCHE · VLM ---
    ['RO-201','Herceptin 440mg vial','ROCHE','VLMVENTA01',4,4,0,'OK',10,40,'RO8801','1004379','1000','2027-05-31'],
    ['RO-201','Herceptin 440mg vial','ROCHE','104008200',120,120,0,'OK',10,40,'RO8801','1004379','1000','2027-05-31'],
    ['RO-202','MabThera 500mg vial','ROCHE','VLMVENTA01',11,11,0,'OK',10,45,'RO8809','1005985','1000','2027-07-31'],
    ['RO-203','Avastin 400mg vial','ROCHE','VLMVENTA01',26,20,6,'OK',14,60,'RO8814','1006056','1000','2028-01-31'],
    ['RO-204','Actemra 400mg vial','ROCHE','VLMVENTA01',31,31,0,'OK',12,50,'RO8820','423216','1000','2027-10-31'],
    ['RO-205','Xeloda 500mg x120 comp','ROCHE','VLMVENTA02',96,96,0,'OK',45,220,'RO3310','SS630','1000','2028-04-30'],
    ['RO-206','Tamiflu 75mg x10 caps','ROCHE','VLMVENTA02',315,280,35,'OK',100,500,'RO3318','TT2749A','1000','2027-12-31'],

    // --- SANOFI AVENTIS · VLM ---
    ['SA-301','Lantus SoloStar 100UI x5','SANOFI AVENTIS','VLMVENTA01',0,0,0,'OK',20,90,'SA5501','SY164','1000','2027-02-28'],
    ['SA-302','Toujeo SoloStar 300UI x3','SANOFI AVENTIS','VLMVENTA01',22,22,0,'OK',18,80,'SA5508','SY689','1000','2027-04-30'],
    ['SA-303','Plavix 75mg x28 comp','SANOFI AVENTIS','VLMVENTA02',520,520,0,'OK',150,700,'SA2210','SX524','1000','2028-06-30'],
    ['SA-304','Clexane 40mg jeringa x10','SANOFI AVENTIS','VLMVENTA02',148,100,48,'OK',80,380,'SA2217','SX026','1000','2027-09-30'],
    ['SA-305','Aubagio 14mg x28 comp','SANOFI AVENTIS','VLMVENTA02',73,73,0,'OK',40,180,'SA2224','TA436','1000','2027-11-30'],
    ['SA-306','Taxotere 80mg vial','SANOFI AVENTIS','VLMVENTA02',41,41,0,'OK',25,110,'SA2231','AACL','1000','2028-03-31'],

    // --- AMGEN · VLM (biológicos, todo cadena de frío) ---
    ['AM-401','Neulasta 6mg jeringa','AMGEN','VLMVENTA01',8,8,0,'OK',15,60,'AM9901','430074','1000','2027-06-30'],
    ['AM-402','Prolia 60mg jeringa','AMGEN','VLMVENTA01',37,37,0,'OK',20,85,'AM9908','415133','1000','2027-08-31'],
    ['AM-403','Xgeva 120mg vial','AMGEN','VLMVENTA01',24,24,0,'OK',16,70,'AM9914','1189717','1000','2028-01-31'],
    ['AM-404','Aranesp 40mcg jeringa x4','AMGEN','VLMVENTA01',52,52,0,'OK',25,120,'AM9920','FABR','1000','2027-10-31'],
    ['AM-405','Repatha 140mg lapicera x2','AMGEN','VLMVENTA01',19,19,0,'OK',22,95,'AM9927','GADC','1000','2027-05-31'],

    // --- ABBVIE · fuera del VLM, picking de pasillo + altura ---
    ['AB-501','Humira 40mg jeringa x2','ABBVIE','104006100',13,13,0,'OK',18,75,'AB6601','ABLH','1000','2027-07-31'],
    ['AB-501','Humira 40mg jeringa x2','ABBVIE','104006300',180,180,0,'OK',18,75,'AB6601','ABLH','1000','2027-07-31'],
    ['AB-502','Venclexta 100mg x28 comp','ABBVIE','013012100',44,44,0,'OK',25,120,'AB6608','BBDX','1000','2028-02-29'],
    ['AB-503','Creon 25000 x50 caps','ABBVIE','013012150',186,150,36,'OK',70,340,'AB6615','FFYZ','1000','2028-05-31'],
    ['AB-504','Rinvoq 15mg x28 comp','ABBVIE','013013100',58,58,0,'OK',30,140,'AB6622','EARX','1000','2027-12-31'],
    ['AB-504','Rinvoq 15mg x28 comp','ABBVIE','013013400',240,240,0,'OK',30,140,'AB6622','EARX','1000','2027-12-31'],

    // --- BIOSIDUS ARGENTINA · fuera del VLM, cámara de pasillo ---
    ['BS-601','Bioyetin 4000 UI x6 amp','BIOSIDUS ARGENTINA','BIOCAM0101',96,96,0,'OK',40,200,'BS1101','133962','1000','2027-04-30'],
    ['BS-602','Neutromax 300mcg x5 jeringa','BIOSIDUS ARGENTINA','BIOCAM0102',28,28,0,'OK',30,130,'BS1108','133970','1000','2027-06-30'],
    ['BS-602','Neutromax 300mcg x5 jeringa','BIOSIDUS ARGENTINA','104013200',310,310,0,'OK',30,130,'BS1108','133970','1000','2027-06-30'],
    ['BS-603','Bioferon 3MUI x5 amp','BIOSIDUS ARGENTINA','BIOCAM0103',61,61,0,'OK',25,110,'BS1115','133988','1000','2028-01-31'],

    // --- descartados por estatus: no entran, pero la app dice cuántos son ---
    ['AZ-103','Crestor 20mg x30 comp','ASTRAZENECA','VLMVENTA02',75,0,0,'HOLD',120,600,'AZ4401','SX695','1000','2026-11-30'],
    ['RO-206','Tamiflu 75mg x10 caps','ROCHE','VLMVENTA02',40,0,0,'OK',100,500,'RO3301','TT2749A','2000','2026-12-31'],

    // --- fuera del catálogo: se excluyen, pero la app avisa cuántos son ---
    ['GA-701','Ibuprofeno 600mg x20 comp','GADOR','013020100',480,480,0,'OK',150,700,'GA0110','GDR01','1000','2028-03-31'],
    ['EL-702','Losartan 50mg x30 comp','ELEA','013020150',312,312,0,'OK',120,600,'EL0220','ELE02','1000','2027-10-31']
  ];

  function cargarDemo() {
    const mapa = P.autoMapear(DEMO[0]);
    const r = P.normalizar(DEMO, 0, mapa, S.state.cfg, S.state.labs, { reglas: S.state.reglasUbic, posiciones: S.state.posiciones });
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


  /* ============================================================
     CONFIGURACIÓN
     ============================================================ */
  /* ---------- máximos compartidos ---------- */

  /* Controles que siguen activos aunque no haya sesión.
     - los de entrar, porque son justamente cómo se desbloquea;
     - los de conexión, que son la salida de emergencia si la base a la que
       apunta esta PC está mal o caída: son locales y no cambian nada de lo
       que ven los demás;
     - los de sólo lectura: traer de la base y exportar el CSV. */
  const SIN_BLOQUEO = ['cfgNubeMail', 'cfgNubePass', 'btnNubeEntrar', 'btnNubeSalir',
                       'btnIrCuenta',
                       'cfgNubeUrl', 'cfgNubeKey', 'btnNubeGuardar',
                       // sacar una copia no cambia nada: que pueda cualquiera
                       'btnNubeBajar', 'btnExportMax'];

  /* Sección abierta de Configuración. Se mantiene entre aperturas: quien
     está cargando laboratorios abre y cierra varias veces seguidas. */
  let seccionCfg = 'cuenta';

  function mostrarSeccion(sec) {
    seccionCfg = sec;
    $$('#cfgNav .cfg-nav-item').forEach(b => b.classList.toggle('is-sel', b.dataset.sec === sec));
    $$('#cfgPanel .cfg-sec').forEach(s => { s.hidden = s.dataset.sec !== sec; });
    $('#cfgPanel').scrollTop = 0;
    aplicarBloqueo();
  }

  function wireCfgNav() {
    $$('#cfgNav .cfg-nav-item').forEach(b =>
      b.addEventListener('click', () => mostrarSeccion(b.dataset.sec)));
    $('#btnIrCuenta').addEventListener('click', () => {
      mostrarSeccion('cuenta');
      $('#cfgNubeMail').focus();
    });
  }

  /**
   * Traba la pantalla de Configuración entera cuando no hay sesión.
   *
   * Es una traba de interfaz: evita el accidente —alguien tocando la PC del
   * depósito— no al que sepa abrir la consola. Lo que de verdad protege lo
   * que ven los demás son las políticas de la base.
   *
   * Sólo mira adentro del panel: el nav y el pie quedan afuera, que si no se
   * traba también el botón de cambiar de sección.
   */
  function aplicarBloqueo() {
    const trabado = !VLM.nube.puedeEditar();
    $$('#cfgPanel input, #cfgPanel select, #cfgPanel button').forEach(el => {
      if (SIN_BLOQUEO.indexOf(el.id) > -1) return;
      el.disabled = trabado;
    });
    $('#cfgChipLectura').hidden = !trabado;
    // en Cuenta el cartel sobra: ahí abajo está el recuadro que dice lo mismo
    $('#cfgBloqueo').hidden = !trabado || seccionCfg === 'cuenta';

    /* Importar es el cambio más grande de todos: cambia el stock que ven
       todos. Sin sesión el archivo quedaría sólo en esta PC y el refresco
       de la base lo reemplazaría al rato, sin que nadie entienda por qué. */
    ['#btnImport', '#btnImport2'].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      el.disabled = trabado;
      el.title = trabado
        ? 'Hace falta iniciar sesión con una cuenta autorizada'
        : 'Cargar el Excel de saldos';
    });
  }

  function pintarNube() {
    const N = VLM.nube;
    const est = $('#nubeEstado');
    const d = N.datos();
    if (d) { $('#cfgNubeUrl').value = d.url; $('#cfgNubeKey').value = d.anonKey; }

    $('#nubeLogin').hidden = !(N.configurada() && !N.conSesion());
    $('#btnNubeSubir').disabled = !N.conSesion();
    $('#btnNubeSubirStock').disabled = !N.conSesion();

    if (!N.configurada()) {
      est.className = 'cuenta-box';
      est.innerHTML =
        '<svg viewBox="0 0 24 24" class="ico"><path d="M17 18H7a4 4 0 0 1-.5-8 6 6 0 0 1 11.2-1.8A3.5 3.5 0 0 1 21 13.5"/>' +
        '<path d="M3 3l18 18"/></svg>' +
        '<div class="cuenta-txt"><strong>Sin base conectada</strong>' +
        '<span>Todo queda en esta PC. Se configura en «Conexión a la base».</span></div>';
    } else if (N.conSesion()) {
      const mail = N.email() || '';
      est.className = 'cuenta-box es-ok';
      est.innerHTML =
        '<span class="cuenta-avatar">' + U.esc((mail[0] || '?').toUpperCase()) + '</span>' +
        '<div class="cuenta-txt"><strong>' + U.esc(mail) + '</strong>' +
        '<span>Cuenta autorizada · podés cambiar todo y subir cambios</span></div>' +
        '<button class="btn btn-sm" id="btnNubeSalir">Cerrar sesión</button>';
      $('#btnNubeSalir').addEventListener('click', () => { N.salir(); refrescarPorSesion(); });
    } else {
      est.className = 'cuenta-box es-lectura';
      est.innerHTML =
        '<svg viewBox="0 0 24 24" class="ico"><rect x="4" y="11" width="16" height="10" rx="2"/>' +
        '<path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
        '<div class="cuenta-txt"><strong>Modo lectura</strong>' +
        '<span>Entrá con una cuenta autorizada para poder cambiar la configuración.</span></div>';
    }
    // el estado de la sesión define qué se puede tocar en toda la pantalla
    aplicarBloqueo();
  }

  /**
   * Entrar o salir no cambia sólo la pantalla de Configuración: la tabla de
   * Posiciones dibuja los mínimos y máximos `disabled` según la sesión, y el
   * aviso de modo lectura sale de ahí también. Sin volver a dibujar el panel,
   * iniciar sesión y cerrar la pantalla dejaba todo trabado hasta un F5.
   */
  function refrescarPorSesion() {
    pintarNube();
    render();
  }

  /* ------------------------------------------------------------
     Máximos compartidos: la base es la única verdad

     El panel tiene que mostrar lo mismo en la oficina y en el depósito,
     así que un máximo cambiado acá viaja solo. Antes había que acordarse
     de apretar "Subir máximos" y, si no, el cambio no salía de esta PC.

     `maxSinSubir` se prende cuando una subida falla —sin internet, base
     caída— y es lo único que hace que una bajada NO pise lo local.
     Mientras esté prendido se reintenta en cada bajada.
     ------------------------------------------------------------ */
  const KEY_PEND = 'vlm.maxpend.v1';
  let maxSinSubir = false;
  let clavesEnBase = [];      // qué tenía la base en la última bajada
  let aplicandoDeNube = false; // para no devolverle a la base lo que vino de ella

  try { maxSinSubir = localStorage.getItem(KEY_PEND) === '1'; } catch (e) {}

  function marcarSinSubir(v) {
    maxSinSubir = v;
    try {
      if (v) localStorage.setItem(KEY_PEND, '1');
      else localStorage.removeItem(KEY_PEND);
    } catch (e) {}
  }

  /**
   * Manda los máximos a la base. Sube el mapa entero en una sola llamada:
   * son unos cientos de filas y así no hay estados a medio camino.
   *
   * Los borrados van aparte: subirMaximos() sólo manda lo que tiene algún
   * valor, así que un máximo borrado acá seguiría en la base y volvería en
   * la próxima bajada como si nada.
   */
  async function sincronizarMaximos() {
    const N = VLM.nube;
    if (!N.configurada() || !N.conSesion()) return;
    const locales = S.state.posiciones || {};
    try {
      await N.subirMaximos(locales);
      const borradas = clavesEnBase.filter(k => !locales[k]);
      for (let i = 0; i < borradas.length; i++) await N.borrarMaximo(borradas[i]);
      clavesEnBase = Object.keys(locales);
      if (maxSinSubir) {
        marcarSinSubir(false);
        U.toast('Máximos guardados en la base', 'ok');
      }
    } catch (e) {
      marcarSinSubir(true);
      U.toast('No se pudo guardar en la base: ' + e.message + '. Queda en esta PC.', 'err');
    }
  }

  /* Al cargar máximos de corrido se toca una celda atrás de otra: sin
     esperar un poco sería una subida por tecla. */
  const sincronizarMaximosPronto = U.debounce(sincronizarMaximos, 900);

  /** Guarda un mapa que vino de la base, sin dispararle una subida de vuelta. */
  function aplicarDeNube(mapa) {
    aplicandoDeNube = true;
    try { S.setPosiciones(mapa); } finally { aplicandoDeNube = false; }
  }

  /* ------------------------------------------------------------
     Configuración compartida: umbrales, laboratorios y reglas

     Deciden lo que ve el panel tanto como el stock. Con reglas distintas en
     cada PC, la misma posición es picking acá y altura allá, y dos pantallas
     del mismo depósito muestran números que no cierran entre sí. Viajan por
     la base igual que los máximos.
     ------------------------------------------------------------ */
  const KEY_PEND_CFG = 'vlm.cfgpend.v1';
  let cfgSinSubir = false;
  let cfgDeLaBase = null;   // la última firma vista, para no reaplicar de gusto

  try { cfgSinSubir = localStorage.getItem(KEY_PEND_CFG) === '1'; } catch (e) {}

  function marcarCfgSinSubir(v) {
    cfgSinSubir = v;
    try {
      if (v) localStorage.setItem(KEY_PEND_CFG, '1');
      else localStorage.removeItem(KEY_PEND_CFG);
    } catch (e) {}
  }

  function firmaConfig(d) {
    try { return JSON.stringify(d); } catch (e) { return ''; }
  }

  async function sincronizarConfig() {
    const N = VLM.nube;
    if (!N.configurada() || !N.conSesion()) return;
    const d = S.configCompartida();
    try {
      await N.subirConfig(d);
      cfgDeLaBase = firmaConfig(d);
      if (cfgSinSubir) { marcarCfgSinSubir(false); U.toast('Configuración guardada en la base', 'ok'); }
    } catch (e) {
      marcarCfgSinSubir(true);
      U.toast('No se pudo guardar la configuración en la base: ' + e.message, 'err');
    }
  }

  /* Editar reglas es tocar un select atrás de otro: sin esperar sería una
     subida por clic. */
  const sincronizarConfigPronto = U.debounce(sincronizarConfig, 1200);

  /**
   * Trae la configuración compartida. Manda la base, con las mismas dos
   * excepciones que los máximos: si la base no tiene nada, esta PC siembra lo
   * suyo; y si acá quedó algo sin subir, no se pisa y se reintenta.
   */
  async function bajarConfig(silencioso) {
    const N = VLM.nube;
    try {
      const r = await N.bajarConfig();
      if (!r || !r.datos) {
        // primera vez: la primera PC con sesión deja la configuración puesta
        if (N.conSesion()) sincronizarConfig();
        return;
      }
      if (cfgSinSubir) { sincronizarConfig(); return; }

      const firma = firmaConfig(r.datos);
      if (firma === cfgDeLaBase) return;        // nada nuevo
      if (firma === firmaConfig(S.configCompartida())) { cfgDeLaBase = firma; return; }

      cfgDeLaBase = firma;
      aplicandoDeNube = true;
      try { S.setConfigCompartida(r.datos); } finally { aplicandoDeNube = false; }
      if (!silencioso) U.toast('Traída la configuración de la base', 'ok');
    } catch (e) {
      if (!silencioso) U.toast('No se pudo traer la configuración: ' + e.message, 'err');
      else console.warn('nube (config):', e.message);
    }
  }

  /**
   * Trae el stock, pero sólo si cambió desde la última vez.
   *
   * La fila del stock pesa medio mega —251 artículos con sus 1.414
   * posiciones— y cada pantalla abierta refresca cada dos minutos y medio.
   * Bajarla siempre serían 2,7 GB por mes y por pantalla: más de la mitad del
   * plan gratis de Supabase gastado en traer exactamente lo mismo que ya
   * estaba. Preguntar la fecha son unos cientos de bytes, y el stock cambia
   * una vez por día, cuando alguien importa la planilla.
   *
   * Con el botón "Traer de la base" se baja igual: la persona lo pidió.
   */
  async function bajarStockSiCambio(silencioso) {
    const N = VLM.nube;
    try {
      if (silencioso) {
        const fecha = await N.fechaStock();
        if (fecha && fecha === S.state.meta.subidoEn) return;
      }
      const s = await N.bajarStock();
      if (s && s.productos && s.productos.length) {
        const productos = s.productos.map(p => VLM.labs.clasificar(S.hidratarFechas(p), S.state.labs));
        S.setProductos(productos, Object.assign({}, s.meta, {
          deNube: true, subidoPor: s.por, subidoEn: s.actualizado
        }));
        if (!silencioso) U.toast('Traído el stock: ' + productos.length + ' productos', 'ok');
      } else if (!silencioso) {
        U.toast('No hay stock cargado en la base todavía');
      }
    } catch (e) {
      if (!silencioso) U.toast('No se pudo traer el stock: ' + e.message, 'err');
      else console.warn('nube (stock):', e.message);
    }
  }

  /**
   * Trae de la base lo compartido: el stock y los máximos.
   *
   * El stock primero, porque los máximos se aplican sobre los productos. Y
   * los dos por separado: que falle uno no tiene por qué dejar sin el otro.
   */
  async function bajarDeNube(silencioso) {
    const N = VLM.nube;
    if (!N.configurada()) return;

    /* La configuración primero: define cómo se clasifica todo lo demás. Si
       bajara después, el stock se mostraría un instante con las reglas viejas
       y se reclasificaría de nuevo a la vista de todos. */
    await bajarConfig(silencioso);
    await bajarStockSiCambio(silencioso);

    try {
      const deLaBase = await N.bajarMaximos();
      const locales = S.state.posiciones || {};
      clavesEnBase = Object.keys(deLaBase);

      /* La base manda. Es lo que hace que todos vean lo mismo abran desde
         donde abran: si cada PC conservara lo suyo, cada una mostraría una
         mezcla distinta y el panel del depósito diría algo que el de la
         oficina no.

         Dos excepciones, las dos para no borrar trabajo:

         1. La base vacía no pisa nada. Es lo que pasa la primera vez que se
            conecta una PC que venía trabajando sola, y también si la tabla
            se vacía por error: en vez de perder los máximos, se conservan y
            se suben.
         2. Si quedó algo sin subir acá —falló la subida por falta de
            internet o porque la base no contestaba—, se conserva lo local y
            se reintenta. */
      if (!clavesEnBase.length && Object.keys(locales).length) {
        marcarSinSubir(true);
        U.toast('La base no tiene máximos: se conservan los de esta PC y se suben', 'warn');
        sincronizarMaximos();
      } else if (maxSinSubir) {
        aplicarDeNube(Object.assign({}, deLaBase, locales));
        U.toast('Hay máximos de esta PC sin guardar en la base. Reintentando…', 'warn');
        sincronizarMaximos();
      } else {
        aplicarDeNube(deLaBase);
        if (!silencioso) U.toast('Traídos ' + clavesEnBase.length + ' máximos de la base', 'ok');
      }
      return clavesEnBase.length;
    } catch (e) {
      // sin internet o con la base caída, el panel tiene que seguir andando
      // con lo último que haya quedado guardado en el navegador
      if (!silencioso) U.toast('No se pudieron traer los máximos: ' + e.message, 'err');
      else console.warn('nube (máximos):', e.message);
    }
  }

  /**
   * Sube el stock recién importado, para que lo vean las demás PCs.
   * Sólo con sesión: el panel del depósito no tiene que poder pisarlo.
   */
  async function subirStockANube() {
    const N = VLM.nube;
    if (!N.configurada() || !N.conSesion()) return false;
    try {
      const cuando = await N.subirStock(S.state.productos, S.state.meta);
      // dejar anotado que la fila de la base es ésta, o el próximo refresco
      // se baja medio mega para traer el archivo que acabamos de mandar
      S.setProductos(S.state.productos, Object.assign({}, S.state.meta, {
        subidoEn: cuando, subidoPor: N.email()
      }));
      U.toast('Stock subido: lo ven todas las PCs', 'ok');
      return true;
    } catch (e) {
      U.toast('No se pudo subir el stock: ' + e.message, 'err');
      return false;
    }
  }

  function wireNube() {
    const N = VLM.nube;

    $('#btnNubeGuardar').addEventListener('click', async () => {
      N.setConfig($('#cfgNubeUrl').value, $('#cfgNubeKey').value);
      // conectar o desconectar también cambia quién puede editar
      refrescarPorSesion();
      if (!N.configurada()) { U.toast('Conexión borrada: los máximos vuelven a ser locales'); return; }
      U.toast('Conexión guardada');
      await bajarDeNube();
    });

    $('#btnNubeBajar').addEventListener('click', () => bajarDeNube());

    $('#btnNubeSubir').addEventListener('click', async () => {
      try {
        const n = await N.subirMaximos(S.state.posiciones);
        U.toast('Subidos ' + n + ' máximos', 'ok');
      } catch (e) { U.toast('No se pudieron subir: ' + e.message, 'err'); }
    });

    $('#btnNubeSubirStock').addEventListener('click', () => {
      if (!S.hayDatos()) { U.toast('No hay stock cargado para subir', 'err'); return; }
      subirStockANube();
    });

    $('#btnNubeEntrar').addEventListener('click', async () => {
      try {
        await N.entrar($('#cfgNubeMail').value.trim(), $('#cfgNubePass').value);
        // los campos se vacían: el recuadro de arriba ya dice con qué cuenta
        // entraste, dejarlos llenos hacía dudar de si había entrado
        $('#cfgNubeMail').value = '';
        $('#cfgNubePass').value = '';
        refrescarPorSesion();
        U.toast('Sesión iniciada', 'ok');
      } catch (e) { U.toast('No se pudo entrar: ' + e.message, 'err'); }
    });
  }

  const CAMPOS_CFG = [
    ['cfgPctCritico', 'pctCritico', 'int'],
    ['cfgPctBajo', 'pctBajo', 'int'],
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
    pintarReglasEditor();
    pintarLabsEditor();
    pintarNube();
    mostrarSeccion(seccionCfg);
    $('#modalSettings').hidden = false;
  }

  /* ---------- reglas de posición ---------- */

  function pintarReglasEditor() {
    const Ub = VLM.ubicaciones;
    const reglas = S.state.reglasUbic;
    const cont = $('#reglasEditor');

    // cuántas ubicaciones de lo que está cargado cae en cada regla
    // contra TODAS las posiciones del archivo, incluidas las que se ignoraron
    let ubics = S.state.meta.ubicacionesVistas || [];
    if (!ubics.length) {
      ubics = [];
      S.state.productos.forEach(p => {
        (p.ubicaciones || [p.ubicacion]).forEach(u => { if (u && ubics.indexOf(u) === -1) ubics.push(u); });
      });
    }
    const cob = ubics.length ? Ub.cobertura(ubics, reglas) : null;

    cont.innerHTML =
      '<div class="reglas-head"><span>Patrón</span><span>Acción</span><span>Tipo</span>' +
      '<span>Zona</span><span>Ámbito</span><span></span></div>' +
      reglas.map((r, i) => {
        const n = cob ? cob.conteo[i].n : null;
        const ign = r.accion === 'ignorar';
        // una regla que no agarra nada porque otra de más arriba se le
        // adelanta no se distingue de una que no coincide con nada
        const tapada = cob && n === 0 ? cob.conteo[i].tapadaPor : null;
        const info = (n !== null ? n + ' ubic.' : '') +
          (tapada ? ' · sin efecto: «' + tapada + '» las agarra antes' : '');
        return '<div class="regla-row' + (ign ? ' r-ign' : '') +
            (tapada ? ' r-tapada' : '') + '" data-i="' + i + '">' +
          '<div><input type="text" data-campo="patron" value="' + U.esc(r.patron) + '">' +
            '<div class="regla-pie">' +
              // se ve como texto hasta que le hacen clic: la descripción es
              // para leerla de un vistazo, no un campo más para completar
              '<input type="text" class="regla-desc" data-campo="nota" ' +
                'placeholder="para qué es" value="' + U.esc(r.nota || '') + '">' +
              (info ? '<span class="regla-nota">' + U.esc(info) + '</span>' : '') +
            '</div></div>' +
          sel('accion', r.accion || 'usar', { usar: 'Usar', ignorar: 'Ignorar' }) +
          sel('tipo', r.tipo || '', { '': '—', picking: 'Picking', altura: 'Altura' }, ign) +
          sel('zona', r.zona || '', { '': '—', frio: '❄ Frío', ambiente: '🌡 Ambiente' }, ign) +
          sel('ambito', r.ambito || '', { '': '—', vlm: 'VLM', externo: 'Fuera' }, ign) +
          '<div class="regla-acciones">' +
            '<button class="btn btn-icon regla-sube" title="Subir: gana antes"' +
              (i === 0 ? ' disabled' : '') + '>' +
              '<svg viewBox="0 0 24 24" class="ico"><path d="m6 15 6-6 6 6"/></svg></button>' +
            '<button class="btn btn-icon regla-baja" title="Bajar"' +
              (i === reglas.length - 1 ? ' disabled' : '') + '>' +
              '<svg viewBox="0 0 24 24" class="ico"><path d="m6 9 6 6 6-6"/></svg></button>' +
            '<button class="btn btn-icon lab-row-del" title="Quitar regla">' +
              '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>' +
          '</div></div>';
      }).join('') +
      (cob && cob.sinRegla
        ? '<p class="muted small" style="margin-top:8px">' + cob.sinRegla +
          ' ubicación(es) que ninguna regla cubre. Agregá una regla <code>*</code> al final para atraparlas.</p>'
        : '');

    function sel(campo, valor, opciones, deshabilitado) {
      return '<select data-campo="' + campo + '"' + (deshabilitado ? ' disabled' : '') + '>' +
        Object.keys(opciones).map(k => '<option value="' + k + '"' +
          (valor === k ? ' selected' : '') + '>' + opciones[k] + '</option>').join('') +
        '</select>';
    }

    U.$$('.regla-row', cont).forEach(row => {
      const i = +row.dataset.i;
      U.$$('input, select', row).forEach(campo => campo.addEventListener('change', () => {
        const lista = S.state.reglasUbic.slice();
        const r = Object.assign({}, lista[i]);
        const v = campo.value.trim();
        if (campo.dataset.campo === 'patron' && !v) { campo.value = r.patron; return; }
        if (v === '') delete r[campo.dataset.campo]; else r[campo.dataset.campo] = v;
        lista[i] = r;
        S.setReglasUbic(lista);
        pintarReglasEditor();
      }));
      U.$('.lab-row-del', row).addEventListener('click', () => {
        S.setReglasUbic(S.state.reglasUbic.filter((_, j) => j !== i));
        pintarReglasEditor();
      });
      U.$('.regla-sube', row).addEventListener('click', () => mover(i, -1));
      U.$('.regla-baja', row).addEventListener('click', () => mover(i, +1));
    });

    /** Cambia una regla de lugar. El orden ES la lógica: la primera que
        coincide gana, así que subir una regla es lo que la hace valer. */
    function mover(i, paso) {
      const j = i + paso;
      const lista = S.state.reglasUbic.slice();
      if (j < 0 || j >= lista.length) return;
      const t = lista[i]; lista[i] = lista[j]; lista[j] = t;
      S.setReglasUbic(lista);
      pintarReglasEditor();
    }
  }

  /**
   * Agrega una regla donde pueda servir para algo.
   *
   * Antes se agregaba al final, y al final casi nunca gana: las reglas se
   * evalúan en orden y arriba están los comodines (`1*`, `0*`, `*`) que se
   * quedan con todo. Una regla para una posición concreta iba a parar abajo
   * de ellos, no agarraba nada y parecía que la app no se actualizaba.
   *
   * Así que se la mete justo ARRIBA de la primera regla que hoy se queda con
   * alguna de las posiciones que el patrón nuevo abarca. Es el lugar más
   * abajo posible en el que igual gana: no se saltea reglas que no tienen
   * nada que ver —las de ignorar, sobre todo— pero sí a la que la tapaba.
   */
  function agregarRegla() {
    const patron = (prompt('Patrón de posición (ej: BIOCAM*, *100, P*, SPP):') || '').trim();
    if (!patron) return;

    const Ub = VLM.ubicaciones;
    const lista = S.state.reglasUbic.slice();
    const ubics = S.state.meta.ubicacionesVistas || [];
    const alcanza = ubics.filter(u => Ub.coincide(u, patron));

    let donde = 0;   // sin stock cargado no hay con qué decidir: arriba de todo
    if (alcanza.length) {
      donde = lista.length;
      alcanza.forEach(u => {
        for (let k = 0; k < lista.length; k++) {
          if (Ub.coincide(u, lista[k].patron)) { if (k < donde) donde = k; break; }
        }
      });
    }

    lista.splice(donde, 0, { patron: patron, accion: 'usar', tipo: 'picking' });
    S.setReglasUbic(lista);
    pintarReglasEditor();
    U.toast(alcanza.length
      ? 'Regla agregada · agarra ' + alcanza.length + ' ubicación(es)'
      : 'Regla agregada arriba de todo · no coincide con ninguna ubicación cargada');
  }

  /* ---------- catálogo de laboratorios ---------- */

  function pintarLabsEditor() {
    const L = VLM.labs;
    const labs = S.state.labs;
    const cont = $('#labsEditor');

    const cob = coberturaLabs(labs);

    cont.innerHTML =
      '<div class="labs-head"><span>Laboratorio</span><span></span></div>' +
      labs.map((l, i) => {
        const c = cob[i];
        // el "0 filas" también se dice: un laboratorio que no reconoce nada
        // es casi siempre un alias mal escrito, y callarlo no ayuda
        const info = c.tapadoPor
          ? 'sin efecto: «' + c.tapadoPor + '» lo reconoce antes'
          : U.fmt(c.n) + (c.n === 1 ? ' fila' : ' filas');
        return '<div class="lab-row' + (c.tapadoPor ? ' r-tapada' : '') + '" data-i="' + i + '">' +
          '<div>' +
            '<input type="text" data-campo="nombre" value="' + U.esc(l.nombre) + '" placeholder="Nombre">' +
            '<div class="lab-pie">' +
              '<span class="lab-alias">Reconoce:</span>' +
              // editable: el alias es lo que decide a qué laboratorio va cada
              // fila del Excel, y era lo único del catálogo que no se podía tocar
              '<input type="text" class="lab-alias-inp" data-campo="alias" ' +
                'value="' + U.esc(l.alias.join(', ')) + '" ' +
                'title="Nombres tal como vienen en el Excel, separados por coma">' +
              (info ? '<span class="lab-cuenta">' + U.esc(info) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<button class="btn btn-icon lab-row-del" title="Quitar del catálogo">' +
            '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>' +
        '</div>';
      }).join('');

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
        } else if (campo.dataset.campo === 'alias') {
          /* Sin ningún alias el laboratorio no reconoce nada y desaparecería
             sin decir por qué: se vuelve al que había. */
          const lista = valor.split(',').map(a => a.trim()).filter(Boolean);
          if (!lista.length) { campo.value = l.alias.join(', '); return; }
          l.alias = lista;
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

  /**
   * Cuántas filas del stock cargado reconoce cada laboratorio, y cuál queda
   * sin efecto porque otro de más arriba se le adelanta.
   *
   * Es el mismo problema que el de las reglas de posición: dos laboratorios
   * con el mismo alias no dan error, gana el primero y el otro no agarra nada.
   * Pasa con "Biosidus" y "Biosidus ARG", que son dos propietarios distintos
   * en la planilla pero comparten el principio del nombre.
   */
  function coberturaLabs(labs) {
    const conteo = labs.map(() => ({ n: 0, tapadoPor: null }));
    const nombres = {};
    S.state.productos.forEach(p => {
      const n = p.laboratorio || '';
      nombres[n] = (nombres[n] || 0) + ((p.detalle && p.detalle.length) || 1);
    });
    Object.keys(nombres).forEach(n => {
      const idGana = VLM.labs.clasificar({ laboratorio: n }, labs).labId;
      const i = labs.map(l => l.id).indexOf(idGana);
      if (i < 0) return;                       // ese nombre no está en el catálogo
      conteo[i].n += nombres[n];
      // los que también lo reconocerían, pero llegan tarde
      labs.forEach((l, k) => {
        if (k === i || conteo[k].tapadoPor) return;
        if (VLM.labs.clasificar({ laboratorio: n }, [l]).labId === l.id) {
          conteo[k].tapadoPor = labs[i].nombre;
        }
      });
    });
    // sólo se avisa del que no agarra NADA: el problema es que está de más
    conteo.forEach(c => { if (c.n) c.tapadoPor = null; });
    return conteo;
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
      alias: [nombre]
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
      });
    });

    $('#btnAddRegla').addEventListener('click', agregarRegla);
    $('#btnResetReglas').addEventListener('click', () => {
      if (!confirm('¿Restaurar las reglas de posición originales?')) return;
      S.resetReglasUbic();
      pintarReglasEditor();
      U.toast('Reglas restauradas. Volvé a importar para aplicarlas.', 'ok');
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

    $('#btnExportMax').addEventListener('click', () => {
      if (!S.hayDatos()) { U.toast('No hay datos cargados', 'err'); return; }
      V.exportarMaximos(itemsCalculados());
    });

    $('#btnImportMax').addEventListener('click', () => $('#fileMax').click());
    $('#fileMax').addEventListener('change', e => {
      const f = e.target.files[0];
      // se limpia para que elegir el mismo archivo otra vez vuelva a disparar
      e.target.value = '';
      if (f) importarMaximos(f);
    });

    $('#btnClearData').addEventListener('click', () => {
      /* Con una base conectada esto ya no borra nada de verdad: el stock
         vuelve en el próximo refresco. Prometer "no se puede deshacer" sería
         mentir y asustar de gusto. */
      const hayBase = VLM.nube.configurada();
      if (!confirm(hayBase
            ? '¿Vaciar la pantalla de esta PC? El stock sigue en la base y vuelve en un rato.'
            : '¿Borrar los datos cargados? Esta acción no se puede deshacer.')) return;
      S.limpiar();
      $('#modalSettings').hidden = true;
      U.toast(hayBase ? 'Pantalla vaciada · el stock vuelve de la base' : 'Datos borrados');
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { render, irA, cargarDemo };
})();
