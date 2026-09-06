/* ============================================================
   store.js · estado global, configuración y persistencia
   ============================================================ */
window.VLM = window.VLM || {};

VLM.store = (function () {

  const KEY_DATA = 'vlm.datos.v1';
  const KEY_CFG  = 'vlm.config.v1';
  const KEY_UI   = 'vlm.ui.v1';

  const CFG_DEFAULT = {
    diasCritico:   7,    // <= N días de cobertura => CRÍTICO
    diasBajo:      15,   // <= N días de cobertura => BAJO
    diasObjetivo:  30,   // stock objetivo al reponer, en días de consumo
    factorBajo:    1.5,  // stock <= min * factor => BAJO
    horizonte:     30,   // días de la curva de proyección
    diasMes:       30,   // divisor consumo mensual -> diario
    tvSegundos:    20,
    tvSoloCriticos: false
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
    ui: {
      tema: 'dark',
      vista: 'dashboard',
      filtroLab: null,
      filtroEstado: null,
      busqueda: '',
      orden: { campo: 'diasCobertura', dir: 'asc' }
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

  function cargar() {
    try {
      const cfg = JSON.parse(localStorage.getItem(KEY_CFG) || 'null');
      if (cfg) Object.assign(state.cfg, CFG_DEFAULT, cfg);
    } catch (e) {}
    try {
      const ui = JSON.parse(localStorage.getItem(KEY_UI) || 'null');
      if (ui) Object.assign(state.ui, ui);
    } catch (e) {}
    try {
      const d = JSON.parse(localStorage.getItem(KEY_DATA) || 'null');
      if (d && Array.isArray(d.productos)) {
        state.productos = d.productos.map(p => {
          if (p.vencimiento) p.vencimiento = new Date(p.vencimiento);
          return p;
        });
        state.meta = Object.assign(state.meta, d.meta || {});
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

  function setUi(parcial, silencioso) {
    Object.assign(state.ui, parcial);
    guardarUi();
    if (!silencioso) emit('ui');
  }

  function hayDatos() { return state.productos.length > 0; }

  return {
    state, CFG_DEFAULT,
    on, emit, cargar, guardar,
    setProductos, limpiar, setCfg, setUi, hayDatos
  };
})();
