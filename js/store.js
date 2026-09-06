/* ============================================================
   store.js · estado global, configuración y persistencia
   ============================================================ */
window.VLM = window.VLM || {};

VLM.store = (function () {

  const KEY_DATA = 'vlm.datos.v1';
  const KEY_CFG  = 'vlm.config.v1';
  const KEY_UI   = 'vlm.ui.v1';
  const KEY_LABS = 'vlm.labs.v1';
  const KEY_HIST = 'vlm.historial.v1';

  const MAX_SNAPSHOTS = 60;   // ~2 meses de importaciones diarias

  const CFG_DEFAULT = {
    diasCritico:   7,    // <= N días de cobertura => CRÍTICO
    diasBajo:      15,   // <= N días de cobertura => BAJO
    diasObjetivo:  30,   // stock objetivo al reponer, en días de consumo
    factorBajo:    1.5,  // stock <= min * factor => BAJO
    ventanaConsumo: 30,  // días de historial que se promedian para el consumo diario
    diasHistorial: 30,   // días que muestra el gráfico de historial
    diasMes:       30,   // divisor consumo mensual -> diario
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
    historial: [],      // snapshots de stock, uno por día (ver agregarSnapshot)
    ui: {
      tema: 'dark',
      vista: 'dashboard',
      filtroLab: null,
      filtroEstado: null,
      filtroAmbito: null,   // 'vlm' | 'externo' | null (todos)
      filtroZona: null,     // 'frio' | 'ambiente' | null (todas)
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

  function guardarLabs() {
    try { localStorage.setItem(KEY_LABS, JSON.stringify(state.labs)); } catch (e) {}
  }

  /**
   * Guarda el historial. Si no entra en localStorage va tirando los snapshots
   * más viejos antes que perder todo, y como último recurso deja sólo los
   * totales (sin el detalle por SKU, que es lo que más pesa).
   */
  function guardarHistorial() {
    let intento = state.historial;
    for (let i = 0; i < 6; i++) {
      try {
        localStorage.setItem(KEY_HIST, JSON.stringify(intento));
        state.historial = intento;
        return true;
      } catch (e) {
        if (intento.length > 8) {
          intento = intento.slice(-Math.floor(intento.length / 2));
        } else {
          intento = intento.map(s => Object.assign({}, s, { porSku: null, podado: true }));
          try {
            localStorage.setItem(KEY_HIST, JSON.stringify(intento));
            state.historial = intento;
            VLM.util.toast('Historial recortado por falta de espacio en el navegador');
            return true;
          } catch (e2) { return false; }
        }
      }
    }
    return false;
  }

  function cargar() {
    try {
      const cfg = JSON.parse(localStorage.getItem(KEY_CFG) || 'null');
      if (cfg) Object.assign(state.cfg, CFG_DEFAULT, cfg);
    } catch (e) {}
    try {
      const labs = JSON.parse(localStorage.getItem(KEY_LABS) || 'null');
      state.labs = (labs && labs.length) ? labs : VLM.labs.catalogoDefault();
    } catch (e) {
      state.labs = VLM.labs.catalogoDefault();
    }
    try {
      const h = JSON.parse(localStorage.getItem(KEY_HIST) || 'null');
      state.historial = Array.isArray(h) ? h : [];
    } catch (e) { state.historial = []; }
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
    agregarSnapshot(productos, state.meta);
    guardar();
    emit('datos');
  }

  /**
   * Registra la foto de stock de esta importación. El historial es lo que
   * después permite calcular cuánto se consumió realmente (por diferencia
   * entre fotos), porque la planilla sólo trae el stock del momento.
   * Dos importaciones del mismo día se pisan: vale la última.
   */
  function agregarSnapshot(productos, meta) {
    const ahora = new Date();
    const dia = ahora.getFullYear() + '-' +
      String(ahora.getMonth() + 1).padStart(2, '0') + '-' +
      String(ahora.getDate()).padStart(2, '0');

    const porSku = {};
    let total = 0;
    productos.forEach(p => {
      porSku[p.codigo] = p.stock;
      total += p.stock;
    });

    const snap = {
      dia: dia,
      ts: ahora.getTime(),
      archivo: (meta && meta.archivo) || null,
      skus: productos.length,
      total: total,
      porSku: porSku
    };

    const i = state.historial.findIndex(s => s.dia === dia);
    if (i > -1) state.historial[i] = snap;
    else state.historial.push(snap);

    state.historial.sort((a, b) => a.dia < b.dia ? -1 : (a.dia > b.dia ? 1 : 0));
    if (state.historial.length > MAX_SNAPSHOTS) {
      state.historial = state.historial.slice(-MAX_SNAPSHOTS);
    }
    guardarHistorial();
  }

  function limpiarHistorial() {
    state.historial = [];
    try { localStorage.removeItem(KEY_HIST); } catch (e) {}
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

  function setUi(parcial, silencioso) {
    Object.assign(state.ui, parcial);
    guardarUi();
    if (!silencioso) emit('ui');
  }

  function hayDatos() { return state.productos.length > 0; }

  return {
    state, CFG_DEFAULT,
    on, emit, cargar, guardar,
    setProductos, limpiar, setCfg, setUi, setLabs, resetLabs, hayDatos,
    agregarSnapshot, limpiarHistorial, MAX_SNAPSHOTS
  };
})();
