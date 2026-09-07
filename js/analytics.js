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
  function calcular(productos, cfg, consumoHist) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

    return productos.map(p => {
      const r = Object.assign({}, p);

      // --- consumo diario: la planilla manda; si no trae, sale del historial ---
      if (!(r.consumoDiario > 0) && consumoHist && consumoHist[r.codigo] > 0) {
        r.consumoDiario = consumoHist[r.codigo];
        r.fuenteConsumo = 'historial';
      }
      const cd = r.consumoDiario > 0 ? r.consumoDiario : 0;

      // --- días de cobertura ---
      if (cd > 0)          r.diasCobertura = r.stock / cd;
      else if (r.stock > 0) r.diasCobertura = null;   // sin consumo: desconocido
      else                  r.diasCobertura = 0;

      // --- fecha estimada de quiebre (dato de detalle) ---
      r.fechaQuiebre = (r.diasCobertura !== null && isFinite(r.diasCobertura) && cd > 0)
        ? U.addDias(hoy, r.diasCobertura) : null;

      // --- estado: se toma el peor entre criterio por días y por mínimo ---
      const porDias = estadoPorDias(r.diasCobertura, cfg);
      const porMin  = estadoPorMinimo(r, cfg);
      r.estado = peor(porDias, porMin);
      if (r.stock <= 0) r.estado = 'agotado';

      // --- ocupación de la ubicación ---
      r.ocupacion = r.stockMax > 0 ? Math.min(1, r.stock / r.stockMax) : null;
      if (r.stockMax > 0 && r.stock > r.stockMax * 1.05 && r.estado === 'ok') r.estado = 'exceso';

      // --- sugerencia de reposición ---
      r.sugerido = calcularSugerido(r, cfg);

      // --- vencimiento ---
      r.diasAVencer = r.vencimiento
        ? Math.round((r.vencimiento - hoy) / 86400000) : null;

      // urgencia: menor = más urgente (para ordenar la reposición)
      r.urgencia = calcularUrgencia(r, cfg);
      return r;
    });
  }

  function estadoPorDias(dias, cfg) {
    if (dias === null || dias === undefined) return null;
    if (dias <= 0) return 'agotado';
    if (dias <= cfg.diasCritico) return 'critico';
    if (dias <= cfg.diasBajo) return 'bajo';
    return 'ok';
  }

  function estadoPorMinimo(p, cfg) {
    if (!(p.stockMin > 0)) return null;
    if (p.stock <= 0) return 'agotado';
    if (p.stock <= p.stockMin) return 'critico';
    if (p.stock <= p.stockMin * cfg.factorBajo) return 'bajo';
    return 'ok';
  }

  function peor(a, b) {
    if (!a && !b) return 'sd';
    if (!a) return b;
    if (!b) return a;
    return ESTADOS[a].orden <= ESTADOS[b].orden ? a : b;
  }

  /** Cuánto pedir: hasta capacidad, o hasta cubrir N días de consumo. */
  function calcularSugerido(p, cfg) {
    let objetivo = 0;
    if (p.consumoDiario > 0) objetivo = p.consumoDiario * cfg.diasObjetivo;
    if (p.stockMin > 0)      objetivo = Math.max(objetivo, p.stockMin * cfg.factorBajo);
    if (p.stockMax > 0)      objetivo = Math.min(Math.max(objetivo, p.stockMin || 0), p.stockMax);
    if (objetivo <= 0)       return 0;
    return Math.max(0, Math.ceil(objetivo - p.stock));
  }

  /** Score de urgencia: días de cobertura, con penalización por estado. */
  function calcularUrgencia(p, cfg) {
    if (p.stock <= 0) return -1;
    if (p.diasCobertura !== null && isFinite(p.diasCobertura)) return p.diasCobertura;
    // sin consumo: usar el déficit contra el mínimo como proxy
    if (p.stockMin > 0 && p.stock < p.stockMin) {
      return cfg.diasCritico * (p.stock / p.stockMin);
    }
    return 9999;
  }

  /* ------------------------------------------------------------
     Agregados
     ------------------------------------------------------------ */

  function resumen(items, cfg) {
    const r = {
      skus: items.length,
      unidades: 0,
      consumoDiario: 0,
      porEstado: { agotado: 0, critico: 0, bajo: 0, ok: 0, exceso: 0, sd: 0 },
      porZona:   { frio: 0, ambiente: 0 },
      porAmbito: { vlm: 0, externo: 0 },
      alertaZona:   { frio: 0, ambiente: 0 },
      alertaAmbito: { vlm: 0, externo: 0 },
      unidadesZona: { frio: 0, ambiente: 0 },
      labs: 0,
      sinConsumo: 0,
      venceEn30: 0,
      vencido: 0,
      noGestionados: 0
    };
    const labs = {};
    items.forEach(p => {
      r.unidades += p.stock;
      r.consumoDiario += p.consumoDiario;
      r.porEstado[p.estado] = (r.porEstado[p.estado] || 0) + 1;

      const enAlerta = p.estado === 'agotado' || p.estado === 'critico' || p.estado === 'bajo';
      if (p.conservacion) {
        r.porZona[p.conservacion]++;
        r.unidadesZona[p.conservacion] += p.stock;
        if (enAlerta) r.alertaZona[p.conservacion]++;
      }
      if (p.ambito) {
        r.porAmbito[p.ambito]++;
        if (enAlerta) r.alertaAmbito[p.ambito]++;
      }
      if (!p.gestionado) r.noGestionados++;

      if (!p.consumoDiario) r.sinConsumo++;
      if (p.diasAVencer !== null) {
        if (p.diasAVencer < 0) r.vencido++;
        else if (p.diasAVencer <= 30) r.venceEn30++;
      }
      labs[p.labNombre || p.laboratorio] = true;
    });
    r.labs = Object.keys(labs).length;
    r.aReponer = r.porEstado.agotado + r.porEstado.critico;
    r.enAlerta = r.aReponer + r.porEstado.bajo;
    r.coberturaGlobal = r.consumoDiario > 0 ? r.unidades / r.consumoDiario : null;
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

  /* ------------------------------------------------------------
     HISTORIAL · consumo real por diferencia entre snapshots
     ------------------------------------------------------------ */

  /** Días calendario entre dos snapshots (mínimo 1). */
  function diasEntre(a, b) {
    const d = Math.round((new Date(b.dia + 'T00:00:00') - new Date(a.dia + 'T00:00:00')) / 86400000);
    return d > 0 ? d : 1;
  }

  /**
   * Proporción de SKU que comparten dos snapshots.
   * Si dos importaciones consecutivas casi no se solapan no son comparables
   * (cambió el formato del export, se cargó otro archivo, vino incompleto):
   * restarlas daría un consumo enorme y falso, así que ese tramo se descarta.
   */
  const SOLAPE_MINIMO = 0.5;

  function solape(a, b) {
    const ka = Object.keys(a.porSku), kb = Object.keys(b.porSku);
    if (!ka.length || !kb.length) return 0;
    let comunes = 0;
    ka.forEach(k => { if (b.porSku[k] !== undefined) comunes++; });
    return comunes / Math.min(ka.length, kb.length);
  }

  /**
   * Consumo real entre importaciones consecutivas.
   *
   * Una baja de stock es consumo; una suba es reposición. Se calculan por
   * separado porque un SKU puede recibir mercadería y consumirse en el mismo
   * intervalo: en ese caso la diferencia subestima el consumo. Con snapshots
   * diarios el error es chico, pero conviene tenerlo presente.
   *
   * @returns { periodos, totalConsumido, totalRepuesto, dias, promedioDiario, suficiente }
   */
  function historialConsumo(historial, dias) {
    const h = (historial || []).filter(s => s && s.porSku);
    const res = {
      periodos: [], totalConsumido: 0, totalRepuesto: 0,
      dias: 0, promedioDiario: 0, snapshots: (historial || []).length,
      saltados: 0, suficiente: h.length >= 2
    };
    if (!res.suficiente) return res;

    const desde = h.length - 1 - (dias || 30);
    for (let i = Math.max(1, desde); i < h.length; i++) {
      const prev = h[i - 1], cur = h[i];
      if (solape(prev, cur) < SOLAPE_MINIMO) { res.saltados++; continue; }
      let consumido = 0, repuesto = 0;
      const codigos = Object.keys(cur.porSku);
      codigos.forEach(cod => {
        const antes = prev.porSku[cod];
        if (antes === undefined) return;          // SKU nuevo: no es consumo
        const delta = antes - cur.porSku[cod];
        if (delta > 0) consumido += delta; else repuesto += -delta;
      });
      // SKUs que desaparecieron de la planilla: se cuentan como consumidos
      Object.keys(prev.porSku).forEach(cod => {
        if (cur.porSku[cod] === undefined) consumido += prev.porSku[cod];
      });

      const nd = diasEntre(prev, cur);
      res.periodos.push({
        dia: cur.dia,
        fecha: new Date(cur.dia + 'T00:00:00'),
        consumido: consumido,
        repuesto: repuesto,
        stockFinal: cur.total,
        dias: nd,
        porDia: consumido / nd
      });
      res.totalConsumido += consumido;
      res.totalRepuesto += repuesto;
      res.dias += nd;
    }
    res.promedioDiario = res.dias > 0 ? res.totalConsumido / res.dias : 0;
    return res;
  }

  /**
   * Consumo diario promedio por SKU, sacado del historial.
   * Se usa cuando la planilla no trae columna de consumo.
   * @returns { codigo: unidades por día }
   */
  function consumoPorSku(historial, ventanaDias) {
    const h = (historial || []).filter(s => s && s.porSku);
    const out = {};
    if (h.length < 2) return out;

    const desde = Math.max(1, h.length - 1 - (ventanaDias || 30));
    const acum = {}, dias = {};
    for (let i = desde; i < h.length; i++) {
      const prev = h[i - 1], cur = h[i];
      if (solape(prev, cur) < SOLAPE_MINIMO) continue;
      const nd = diasEntre(prev, cur);
      Object.keys(cur.porSku).forEach(cod => {
        const antes = prev.porSku[cod];
        if (antes === undefined) return;
        const delta = antes - cur.porSku[cod];
        if (!(cod in acum)) { acum[cod] = 0; dias[cod] = 0; }
        if (delta > 0) acum[cod] += delta;
        dias[cod] += nd;
      });
    }
    Object.keys(acum).forEach(cod => {
      if (dias[cod] > 0 && acum[cod] > 0) out[cod] = acum[cod] / dias[cod];
    });
    return out;
  }

  /** Consumo del período por laboratorio, para el gráfico comparativo. */
  function consumoPorLaboratorio(items, cfg) {
    return porLaboratorio(items, cfg)
      .map(l => ({
        nombre: l.nombre,
        color: l.color,
        consumido: l.productos.reduce((s, p) => s + (p.consumoDiario || 0), 0) * (cfg.ventanaConsumo || 30)
      }))
      .filter(l => l.consumido > 0)
      .sort((a, b) => b.consumido - a.consumido);
  }

  /** Cuántos SKU se agotan en cada tramo de días. */
  function quiebresPorTramo(items, cfg) {
    const tramos = [
      { label: 'Ya agotado', max: 0,   n: 0 },
      { label: '1-7 días',   max: 7,   n: 0 },
      { label: '8-15 días',  max: 15,  n: 0 },
      { label: '16-30 días', max: 30,  n: 0 },
      { label: '31-60 días', max: 60,  n: 0 },
      { label: '+60 días',   max: 1e9, n: 0 }
    ];
    items.forEach(p => {
      const d = p.diasCobertura;
      if (d === null || !isFinite(d)) return;
      for (const t of tramos) { if (d <= t.max) { t.n++; break; } }
    });
    return tramos;
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
    calcular, resumen, porLaboratorio, porGrupo, filtrarPorZona,
    historialConsumo, consumoPorSku, consumoPorLaboratorio,
    quiebresPorTramo, topUrgentes
  };
})();
