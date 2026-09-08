/* ============================================================
   analytics.js · cálculo de cobertura, criticidad y proyecciones
   ============================================================ */
window.VLM = window.VLM || {};

VLM.analytics = (function () {
  const U = VLM.util;

  const ESTADOS = {
    agotado: { label: 'Agotado', orden: 0, color: 'crit' },
    critico: { label: 'Crítico', orden: 1, color: 'crit' },
    bajo:    { label: 'Bajo',    orden: 2, color: 'warn' },
    ok:      { label: 'OK',      orden: 3, color: 'ok' },
    exceso:  { label: 'Exceso',  orden: 4, color: 'info' },
    sd:      { label: 'Sin datos', orden: 5, color: 'sd' }
  };
  const ORDEN_ESTADOS = ['agotado', 'critico', 'bajo', 'ok', 'exceso', 'sd'];

  /**
   * Enriquece cada producto con métricas derivadas.
   * No muta el original: devuelve copias.
   */
  function calcular(productos, cfg) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    return productos.map(p => {
      const r = Object.assign({}, p);

      // contra qué se mide: si el máximo sale de la configuración de una
      // posición, lo que importa es lo que hay EN esa posición. Si no, la
      // reserva de altura tapa que el picking está por vaciarse.
      const ref = r.stockRef !== undefined ? r.stockRef : r.stock;

      if (r.posConfig && r.posConfig.length) {
        // el artículo hereda el estado de su PEOR posición: se repone
        // posición por posición, no el artículo entero
        const evaluadas = r.posConfig.map(x => ({
          ubicacion: x.ubicacion,
          stock: x.stock, min: x.min, max: x.max,
          llenado: x.max > 0 ? x.stock / x.max : (x.min > 0 ? x.stock / (x.min * 1.25) : null),
          estado: estadoDeNivel(x.stock, x.min, x.max, cfg)
        }));
        const peorPos = evaluadas.reduce((a, b) =>
          ESTADOS[b.estado].orden < ESTADOS[a.estado].orden ? b : a);
        r.posEvaluadas = evaluadas;
        r.peorPosicion = peorPos.ubicacion;
        r.peorStock    = peorPos.stock;
        r.peorMin      = peorPos.min;
        r.peorMax      = peorPos.max;
        r.ocupacion    = peorPos.llenado;
        r.estado       = peorPos.estado;
        r.sugerido     = r.posConfig.reduce((s, x) =>
          s + Math.max(0, Math.ceil((x.max > 0 ? x.max : x.min * 1.25) - x.stock)), 0);
      } else {
        r.ocupacion = r.stockMax > 0 ? ref / r.stockMax : null;
        r.estado    = estadoPorNivel(r, cfg, ref);
        r.sugerido  = calcularSugerido(r, ref);
      }

      r.diasAVencer = r.vencimiento
        ? Math.round((r.vencimiento - hoy) / 86400000) : null;

      // urgencia: menor = más urgente. Es el llenado de la peor posición,
      // así la lista de reposición arranca por la que está más vacía.
      r.urgencia = r.ocupacion !== null && r.ocupacion !== undefined
        ? r.ocupacion : calcularUrgencia(r, ref);
      return r;
    });
  }

  /**
   * Estado según qué tan llena está la posición, como porcentaje de su
   * capacidad. Sin máximo cargado se cae al mínimo, que es lo único que queda;
   * sin ninguno de los dos no hay con qué opinar.
   */
  function estadoPorNivel(p, cfg, ref) {
    return estadoDeNivel(ref, p.stockMin, p.stockMax, cfg,
      p.tieneConfigPos && p.stock > 0);
  }

  /**
   * La regla, aislada, para poder aplicarla igual a un artículo entero que a
   * una posición suelta.
   *
   * @param conReserva si la posición está vacía pero hay stock en altura: eso
   *   es crítico (hay que bajar ya), no agotado (agotado es que no hay nada).
   */
  function estadoDeNivel(stock, min, max, cfg, conReserva) {
    if (!(max > 0) && !(min > 0)) return 'sd';
    if (stock <= 0) return conReserva ? 'critico' : 'agotado';

    if (max > 0) {
      const pct = stock / max * 100;
      if (pct <= cfg.pctCritico) return 'critico';
      if (pct <= cfg.pctBajo)    return 'bajo';
      if (stock > max * 1.05)    return 'exceso';
      return 'ok';
    }
    if (stock <= min) return 'critico';
    if (stock <= min * 1.25) return 'bajo';
    return 'ok';
  }

  /** Cuánto reponer: hasta llenar la posición. */
  function calcularSugerido(p, ref) {
    const objetivo = p.stockMax > 0 ? p.stockMax : (p.stockMin > 0 ? p.stockMin * 1.25 : 0);
    if (objetivo <= 0) return 0;
    return Math.max(0, Math.ceil(objetivo - ref));
  }

  /** Qué tan vacía está la posición, de 0 (vacía) a 1 (llena). */
  function calcularUrgencia(p, ref) {
    if (p.stockMax > 0) return ref / p.stockMax;
    if (p.stockMin > 0) return ref / (p.stockMin * 1.25);
    return 9999;   // sin configurar: al fondo de la lista
  }

  /* ------------------------------------------------------------
     Agregados
     ------------------------------------------------------------ */

  /**
   * Agregado de un conjunto de productos.
   *
   * `unidades` es SÓLO el stock en posiciones de picking: es lo que se sirve
   * y lo que hay que vigilar. La reserva de altura se cuenta aparte en
   * `unidadesAltura` — si se sumara todo, un artículo con la posición de
   * picking casi vacía y un pallet arriba se vería sano en los gráficos.
   */
  function resumen(items, cfg) {
    const r = {
      skus: items.length,
      unidades: 0,        // picking
      unidadesAltura: 0,
      unidadesTotal: 0,
      porEstado: { agotado: 0, critico: 0, bajo: 0, ok: 0, exceso: 0, sd: 0 },
      porZona:   { frio: 0, ambiente: 0 },
      porAmbito: { vlm: 0, externo: 0 },
      alertaZona:   { frio: 0, ambiente: 0 },
      alertaAmbito: { vlm: 0, externo: 0 },
      unidadesZona: { frio: 0, ambiente: 0 },
      labs: 0,
      venceEn30: 0,
      vencido: 0,
      noGestionados: 0
    };
    const labs = {};
    items.forEach(p => {
      // sin agrupar por posición (planilla vieja o sin ubicaciones) no hay
      // separación picking/altura: ahí el stock total ES el de picking
      const pick = p.stockPicking !== undefined ? p.stockPicking : p.stock;
      const alt  = p.stockAltura !== undefined ? p.stockAltura : 0;

      r.unidades += pick;
      r.unidadesAltura += alt;
      r.unidadesTotal += p.stock;
      r.porEstado[p.estado] = (r.porEstado[p.estado] || 0) + 1;

      const enAlerta = p.estado === 'agotado' || p.estado === 'critico' || p.estado === 'bajo';
      if (p.conservacion) {
        r.porZona[p.conservacion]++;
        r.unidadesZona[p.conservacion] += pick;
        if (enAlerta) r.alertaZona[p.conservacion]++;
      }
      if (p.ambito) {
        r.porAmbito[p.ambito]++;
        if (enAlerta) r.alertaAmbito[p.ambito]++;
      }
      if (!p.gestionado) r.noGestionados++;

      if (p.diasAVencer !== null) {
        if (p.diasAVencer < 0) r.vencido++;
        else if (p.diasAVencer <= 30) r.venceEn30++;
      }
      labs[p.labNombre || p.laboratorio] = true;
    });
    r.labs = Object.keys(labs).length;
    r.aReponer = r.porEstado.agotado + r.porEstado.critico;
    r.enAlerta = r.aReponer + r.porEstado.bajo;
    return r;
  }

  /** Agrupa por laboratorio con su propio resumen, ordenado por criticidad. */
  function porLaboratorio(items, cfg) {
    const mapa = {};
    items.forEach(p => {
      const k = p.labNombre || p.laboratorio;
      if (!mapa[k]) mapa[k] = [];
      mapa[k].push(p);
    });
    return Object.keys(mapa).map(nombre => {
      const productos = mapa[nombre];
      const res = resumen(productos, cfg);
      const ref = productos[0];
      return {
        nombre: nombre,
        color: U.colorDe(nombre),
        ambito: ref.ambito,
        gestionado: ref.gestionado,
        productos: productos,
        resumen: res,
        criticos: res.porEstado.agotado + res.porEstado.critico,
        alerta: res.enAlerta
      };
    }).sort((a, b) => (b.criticos - a.criticos) || (b.alerta - a.alerta) || a.nombre.localeCompare(b.nombre));
  }

  /**
   * Agrupa en los cuatro cuadrantes ámbito × conservación
   * (VLM·Frío, VLM·Ambiente, Fuera·Frío, Fuera·Ambiente).
   * Devuelve sólo los grupos que tienen productos.
   */
  function porGrupo(items, cfg) {
    const L = VLM.labs;
    const mapa = {};
    items.forEach(p => {
      const k = L.claveGrupo(p);
      if (!mapa[k]) mapa[k] = [];
      mapa[k].push(p);
    });
    return L.GRUPOS.filter(k => mapa[k]).map(clave => {
      const [ambito, zona] = clave.split('|');
      const productos = mapa[clave];
      const res = resumen(productos, cfg);
      return {
        clave: clave,
        ambito: ambito,
        zona: zona,
        label: L.labelGrupo(clave),
        icono: L.ZONAS[zona].icono,
        productos: productos,
        resumen: res,
        labs: porLaboratorio(productos, cfg),
        criticos: res.porEstado.agotado + res.porEstado.critico,
        alerta: res.enAlerta
      };
    });
  }

  /** Aplica los filtros globales de ámbito y conservación. */
  function filtrarPorZona(items, ui) {
    return items.filter(p => {
      if (ui.filtroAmbito && p.ambito !== ui.filtroAmbito) return false;
      if (ui.filtroZona && p.conservacion !== ui.filtroZona) return false;
      return true;
    });
  }

  /** Top N por urgencia (los que hay que reponer primero). */
  function topUrgentes(items, n) {
    return items
      .filter(p => p.estado === 'agotado' || p.estado === 'critico' || p.estado === 'bajo')
      .sort((a, b) => a.urgencia - b.urgencia)
      .slice(0, n || 10);
  }

  return {
    ESTADOS, ORDEN_ESTADOS,
    calcular, estadoDeNivel, resumen, porLaboratorio, porGrupo, filtrarPorZona,
    topUrgentes
  };
})();
