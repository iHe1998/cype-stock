/* ============================================================
   ubicaciones.js · reglas de posición

   La posición dice más que el laboratorio: si se pickea o es stock de
   altura, si está en cámara o en ambiente, y si hay que ignorarla porque
   es una zona de tránsito y no stock real.

   Las reglas se evalúan EN ORDEN y gana la primera que coincide, así que
   las de ignorar van arriba: "PACK" tiene que resolverse antes que "P*".
   ============================================================ */
window.VLM = window.VLM || {};

VLM.ubicaciones = (function () {

  const TIPOS = {
    picking: { label: 'Picking',  corto: 'Pick',   desc: 'Se pickea de acá' },
    altura:  { label: 'Altura',   corto: 'Altura', desc: 'Reserva: se baja para rellenar picking' }
  };

  /* ------------------------------------------------------------
     Reglas provisionales, según lo que describió el usuario para el
     export de Biosidus. Se editan en Configuración; el archivo bueno
     va a traer las posiciones del VLM, que todavía no aparecen acá.
     ------------------------------------------------------------ */
  const REGLAS_DEFAULT = [
    // --- tránsito, acondicionado y faltantes: no son stock ubicado ---
    { patron: 'SPP',     accion: 'ignorar', nota: 'tránsito' },
    { patron: 'PACK',    accion: 'ignorar', nota: 'packing' },
    { patron: 'STAGE',   accion: 'ignorar', nota: 'staging' },
    { patron: 'ACONDI',  accion: 'ignorar', nota: 'acondicionado' },
    { patron: 'PICKTO',  accion: 'ignorar', nota: 'tránsito' },
    { patron: 'FALDEP*', accion: 'ignorar', nota: 'faltante depósito' },
    { patron: 'ROTORI*', accion: 'ignorar', nota: 'rotura / origen' },
    { patron: 'C*',      accion: 'ignorar', nota: 'no se usa' },

    // --- picking con nombre propio ---
    { patron: 'BIOCAM*', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'frio',
      nota: 'picking cámara, pasillo' },
    { patron: 'P*',      accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'ambiente',
      nota: 'picking ambiente' },

    /* --- posiciones numéricas: PPPBBBNNN ---
       Los tres primeros dígitos son el pasillo y los tres últimos el nivel.
       El pasillo define la zona (100 en adelante es cámara, por debajo es
       ambiente) y el nivel define el tipo (100 se pickea, 200 en adelante es
       altura). Por eso van primero las dos reglas de nivel 100: si no, la
       regla del pasillo se las comería. */
    { patron: '1*100', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'frio',
      nota: 'pasillo 1xx (cámara), nivel 100' },
    { patron: '0*100', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'ambiente',
      nota: 'pasillo 0xx (ambiente), nivel 100' },
    { patron: '1*',    accion: 'usar', tipo: 'altura', ambito: 'externo', zona: 'frio',
      nota: 'altura de cámara (pasillos 103, 104…)' },
    { patron: '0*',    accion: 'usar', tipo: 'altura', ambito: 'externo', zona: 'ambiente',
      nota: 'altura de ambiente (pasillos 013, 014…)' },

    // --- red de seguridad: lo que no encaje en nada queda como altura,
    //     sin zona, para que se note en el editor en vez de desaparecer ---
    { patron: '*', accion: 'usar', tipo: 'altura', nota: 'sin clasificar' }
  ];

  function reglasDefault() {
    return REGLAS_DEFAULT.map(r => Object.assign({}, r));
  }

  /* ------------------------------------------------------------
     Matcheo
     ------------------------------------------------------------ */

  /**
   * Glob con `*` en cualquier posición: PREFIJO*, *SUFIJO, *CONTIENE*,
   * PREFIJO*SUFIJO, `*` (todo) o exacto.
   *
   * El comodín en el medio es el que importa acá: el pasillo va al principio
   * y el nivel al final, así que "103*100" es "pasillo 103, nivel 100".
   */
  function coincide(ubicacion, patron) {
    const u = String(ubicacion == null ? '' : ubicacion).trim().toUpperCase();
    const p = String(patron == null ? '' : patron).trim().toUpperCase();
    if (!p) return false;
    if (p.indexOf('*') === -1) return u === p;

    const partes = p.split('*');
    let pos = 0;
    for (let i = 0; i < partes.length; i++) {
      const parte = partes[i];
      if (!parte) continue;
      if (i === 0) {                                  // ancla al inicio
        if (u.indexOf(parte) !== 0) return false;
        pos = parte.length;
      } else if (i === partes.length - 1) {           // ancla al final
        if (u.length - parte.length < pos) return false;
        return u.slice(-parte.length) === parte;
      } else {                                        // trozo del medio
        const idx = u.indexOf(parte, pos);
        if (idx === -1) return false;
        pos = idx + parte.length;
      }
    }
    return true;
  }

  /**
   * Primera regla que coincide, o null si ninguna.
   * @returns { accion, tipo, ambito, zona, patron, nota } | null
   */
  function evaluar(ubicacion, reglas) {
    if (!ubicacion) return null;
    const lista = reglas && reglas.length ? reglas : REGLAS_DEFAULT;
    for (const r of lista) {
      if (coincide(ubicacion, r.patron)) return r;
    }
    return null;
  }

  /** Cuenta cuántas ubicaciones distintas caen en cada regla. Para el editor. */
  function cobertura(ubicaciones, reglas) {
    const lista = reglas && reglas.length ? reglas : REGLAS_DEFAULT;
    const conteo = lista.map(r => ({ patron: r.patron, accion: r.accion, tipo: r.tipo, n: 0 }));
    let sinRegla = 0;
    ubicaciones.forEach(u => {
      let i = -1;
      for (let k = 0; k < lista.length; k++) { if (coincide(u, lista[k].patron)) { i = k; break; } }
      if (i === -1) sinRegla++; else conteo[i].n++;
    });
    return { conteo, sinRegla };
  }

  return { TIPOS, REGLAS_DEFAULT, reglasDefault, coincide, evaluar, cobertura };
})();
