/* ============================================================
   store.js · estado global, configuración y persistencia
   ============================================================ */
window.VLM = window.VLM || {};

VLM.store = (function () {

  const KEY_DATA = 'vlm.datos.v1';
  const KEY_CFG  = 'vlm.config.v1';
  const KEY_UI   = 'vlm.ui.v1';
  const KEY_LABS = 'vlm.labs.v1';
  const KEY_UBIC = 'vlm.ubicaciones.v1';
  const KEY_POS  = 'vlm.posiciones.v1';

  // Versión del esquema de los datos guardados. Se sube cuando cambia la forma
  // de los productos. Los datos reales se migran (se reclasifican al cargar);
  // los datos de ejemplo de una versión vieja se descartan, para que el demo
  // no quede pegado con productos y laboratorios de otra época.
  const VERSION = 3;

  const CFG_DEFAULT = {
    // Qué tan llena está la posición, como porcentaje de su capacidad.
    // Es el criterio principal: una posición de picking al 10% de su máximo
    // hay que reponerla ya, esté donde esté el punto de pedido.
    pctCritico:    10,   // stock <= 10% del máximo => CRÍTICO
    pctBajo:       25,   // stock <= 25% del máximo => BAJO
    tvSegundos:    20,
    tvSoloCriticos: false,
    // qué hacer con laboratorios que no están en el catálogo:
    // 'excluir' los deja fuera de KPIs y vistas (pero se informa cuántos son),
    // 'incluir' los muestra como no gestionados.
    labsNoListados: 'excluir'
  };

  const state = {
    productos: [],      // registros normalizados (ver parser.js)
    meta: {             // info de la última importación
      archivo: null,
      hoja: null,
      filas: 0,
      importadoEn: null,
      mapeo: null
    },
    cfg: Object.assign({}, CFG_DEFAULT),
    labs: [],           // catálogo de laboratorios (ver labs.js)
    reglasUbic: [],     // reglas de posición (ver ubicaciones.js)
    posiciones: {},     // UBICACION|ARTICULO -> { min, max } configurados a mano
    ui: {
      tema: 'dark',
      vista: 'dashboard',
      filtroLab: null,
      filtroEstado: null,
      filtroAmbito: null,   // 'vlm' | 'externo' | null (todos)
      filtroZona: null,     // 'frio' | 'ambiente' | null (todas)
      busquedaPos: '',
      busqueda: '',
      orden: { campo: 'ocupacion', dir: 'asc' }
    }
  };

  const listeners = [];
  /** Suscribe un callback a los cambios de estado. */
  function on(fn) { listeners.push(fn); return fn; }
  function emit(motivo) { listeners.forEach(fn => fn(motivo)); }

  /* ---------------- persistencia ---------------- */

  function guardar() {
    try {
      // las fechas se serializan a ISO; se rehidratan al cargar
      localStorage.setItem(KEY_DATA, JSON.stringify({
        v: VERSION,
        productos: state.productos,
        meta: state.meta
      }));
    } catch (e) {
      console.warn('No se pudo guardar en localStorage', e);
      VLM.util.toast('No se pudieron guardar los datos localmente (¿archivo muy grande?)', 'err');
    }
  }

  function guardarCfg() {
    try { localStorage.setItem(KEY_CFG, JSON.stringify(state.cfg)); } catch (e) {}
  }

  function guardarUi() {
    try {
      localStorage.setItem(KEY_UI, JSON.stringify({
        tema: state.ui.tema, vista: state.ui.vista
      }));
    } catch (e) {}
  }

  function guardarLabs() {
    try { localStorage.setItem(KEY_LABS, JSON.stringify(state.labs)); } catch (e) {}
  }

  function guardarReglasUbic() {
    try { localStorage.setItem(KEY_UBIC, JSON.stringify(state.reglasUbic)); } catch (e) {}
  }

  function guardarPosiciones() {
    try { localStorage.setItem(KEY_POS, JSON.stringify(state.posiciones)); } catch (e) {}
  }

  function cargar() {
    try {
      const cfg = JSON.parse(localStorage.getItem(KEY_CFG) || 'null');
      if (cfg) Object.assign(state.cfg, CFG_DEFAULT, cfg);
    } catch (e) {}
    try {
      const labs = JSON.parse(localStorage.getItem(KEY_LABS) || 'null');
      state.labs = (labs && labs.length)
        ? VLM.labs.migrarCatalogo(labs) : VLM.labs.catalogoDefault();
    } catch (e) {
      state.labs = VLM.labs.catalogoDefault();
    }
    try {
      const ru = JSON.parse(localStorage.getItem(KEY_UBIC) || 'null');
      state.reglasUbic = (ru && ru.length)
        ? VLM.ubicaciones.migrarReglas(ru) : VLM.ubicaciones.reglasDefault();
    } catch (e) {
      state.reglasUbic = VLM.ubicaciones.reglasDefault();
    }
    try {
      const pos = JSON.parse(localStorage.getItem(KEY_POS) || 'null');
      state.posiciones = migrarPosiciones((pos && typeof pos === 'object') ? pos : {});
    } catch (e) { state.posiciones = {}; }
    try {
      const ui = JSON.parse(localStorage.getItem(KEY_UI) || 'null');
      if (ui) Object.assign(state.ui, ui);
    } catch (e) {}
    try {
      const d = JSON.parse(localStorage.getItem(KEY_DATA) || 'null');
      if (d && Array.isArray(d.productos)) {
        const viejo = d.v !== VERSION;
        // las primeras versiones del demo no marcaban meta.demo, sólo el nombre
        const esDemo = !!(d.meta && (d.meta.demo || d.meta.archivo === 'Datos de ejemplo'));

        if (viejo && esDemo) {
          // datos de ejemplo de una versión anterior: se descartan
          try { localStorage.removeItem(KEY_DATA); } catch (e2) {}
        } else {
          state.productos = d.productos.map(p => {
            if (p.vencimiento) p.vencimiento = new Date(p.vencimiento);
            // Reclasificar SIEMPRE: los productos guardados por una versión
            // anterior no traen gestionado/ambito/conservacion, y sin esto
            // quedarían todos como "fuera del catálogo".
            return VLM.labs.clasificar(p, state.labs);
          });
          state.meta = Object.assign(state.meta, d.meta || {});
          if (viejo) guardar();   // reescribir ya migrado
        }
      }
    } catch (e) {
      console.warn('Datos guardados ilegibles', e);
    }
    return state;
  }

  /* ---------------- mutaciones ---------------- */

  function setProductos(productos, meta) {
    state.productos = productos;
    state.meta = Object.assign({ importadoEn: Date.now() }, meta || {});
    guardar();
    emit('datos');
  }

  function limpiar() {
    state.productos = [];
    state.meta = { archivo: null, hoja: null, filas: 0, importadoEn: null, mapeo: null };
    try { localStorage.removeItem(KEY_DATA); } catch (e) {}
    emit('datos');
  }

  function setCfg(parcial) {
    Object.assign(state.cfg, parcial);
    guardarCfg();
    emit('cfg');
  }

  /** Reemplaza el catálogo de laboratorios y reclasifica los productos. */
  function setLabs(labs) {
    state.labs = labs;
    guardarLabs();
    emit('labs');
  }

  function resetLabs() {
    setLabs(VLM.labs.catalogoDefault());
  }

  /** Reemplaza las reglas de posición. Se reaplican sobre el stock cargado. */
  function setReglasUbic(reglas) {
    state.reglasUbic = reglas;
    guardarReglasUbic();
    emit('ubicaciones');
  }

  function resetReglasUbic() {
    setReglasUbic(VLM.ubicaciones.reglasDefault());
  }

  /**
   * Configura min/max de una posición.
   *
   * Se guarda junto al artículo que la ocupaba en ese momento. En picking es
   * normal que al agotarse un artículo la posición se reasigne a otro, y el
   * máximo depende del artículo: no entran las mismas unidades de una caja
   * grande que de una chica. Al cambiar el ocupante la configuración queda
   * marcada para revisar en vez de aplicarse a ciegas.
   */
  function setPosicion(ubicacion, cfg, articulo) {
    const k = clavePos(ubicacion, articulo);
    if (!k) return;
    const actual = state.posiciones[k] || {};
    const nueva = Object.assign({}, actual, cfg);
    nueva.ubicacion = String(ubicacion).trim().toUpperCase();
    if (articulo) nueva.articulo = String(articulo);
    if (!nueva.min && !nueva.max) delete state.posiciones[k];
    else state.posiciones[k] = nueva;
    guardarPosiciones();
    emit('posiciones');
  }

  /**
   * La clave de configuración es POSICIÓN|ARTÍCULO, no la posición sola.
   *
   * Afuera del VLM cada posición de picking tiene un artículo y da lo mismo,
   * pero adentro de la torre TODOS los artículos comparten VLMVENTA01 o
   * VLMVENTA02: con la posición sola, cargar un máximo lo cargaría para los
   * cientos de artículos que viven ahí.
   */
  function clavePos(ubicacion, articulo) {
    const u = String(ubicacion == null ? '' : ubicacion).trim().toUpperCase();
    if (!u) return '';
    const a = String(articulo == null ? '' : articulo).trim().toUpperCase();
    return a ? u + '|' + a : u;
  }

  /**
   * Las versiones anteriores guardaban la configuración con la posición sola
   * como clave y el artículo adentro. Se rearma con la clave nueva para no
   * perder lo ya cargado.
   */
  function migrarPosiciones(mapa) {
    const salida = {};
    Object.keys(mapa).forEach(k => {
      const v = mapa[k] || {};
      if (k.indexOf('|') > -1) { salida[k] = v; return; }
      v.ubicacion = v.ubicacion || k;
      salida[clavePos(k, v.articulo)] = v;
    });
    return salida;
  }

  /** Reemplaza todo el mapa de golpe (importar CSV). */
  function setPosiciones(mapa) {
    state.posiciones = mapa || {};
    guardarPosiciones();
    emit('posiciones');
  }

  function limpiarPosiciones() { setPosiciones({}); }

  function setUi(parcial, silencioso) {
    Object.assign(state.ui, parcial);
    guardarUi();
    if (!silencioso) emit('ui');
  }

  function hayDatos() { return state.productos.length > 0; }

  return {
    state, CFG_DEFAULT,
    on, emit, cargar, guardar,
    setProductos, limpiar, setCfg, setUi, setLabs, resetLabs,
    setReglasUbic, resetReglasUbic,
    setPosicion, setPosiciones, limpiarPosiciones, clavePos, hayDatos
  };
})();
