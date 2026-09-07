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

    // --- picking ---
    { patron: 'BIOCAM*', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'frio',
      nota: 'picking cámara, pasillo' },
    { patron: '*100',    accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'frio',
      nota: 'picking cámara, nivel 100' },
    { patron: 'P*',      accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'ambiente',
      nota: 'picking ambiente' },

    // --- todo lo demás: stock de altura. No se pickea, pero es stock real
    //     y dice de dónde bajar mercadería para rellenar el picking. ---
    { patron: '*',       accion: 'usar', tipo: 'altura',
      nota: 'stock de altura (niveles 200 en adelante)' }
  ];

  function reglasDefault() {
    return REGLAS_DEFAULT.map(r => Object.assign({}, r));
  }

  /* ------------------------------------------------------------
     Matcheo
     ------------------------------------------------------------ */

  /** Glob simple: PREFIJO*, *SUFIJO, *CONTIENE*, * (todo) o exacto. */
  function coincide(ubicacion, patron) {
    const u = String(ubicacion == null ? '' : ubicacion).trim().toUpperCase();
    const p = String(patron == null ? '' : patron).trim().toUpperCase();
    if (!p) return false;
    if (p === '*') return true;
    const abre = p.charAt(0) === '*';
    const cierra = p.charAt(p.length - 1) === '*';
    const core = p.replace(/^\*/, '').replace(/\*$/, '');
    if (!core) return true;
    if (abre && cierra) return u.indexOf(core) > -1;
    if (abre)  return u.length >= core.length && u.slice(-core.length) === core;
    if (cierra) return u.indexOf(core) === 0;
    return u === core;
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
