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
  /* Versión de las reglas de fábrica. Se sube SÓLO cuando cambia
     REGLAS_DEFAULT, y es lo que decide si a una lista guardada hay que
     sumarle reglas nuevas o hay que dejarla en paz. Sin esto no había forma
     de distinguir "esta regla no la tenés porque es nueva" de "esta regla la
     borraste a propósito". */
  const REGLAS_V = 2;

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

    /* --- el VLM ---
       Adentro de la torre todos los artículos comparten la misma ubicación
       aunque físicamente estén en bandejas distintas: el sistema no las
       distingue. Así que acá la unidad no es la posición sino el ARTÍCULO, y
       de eso se encarga la configuración (posición + artículo). */
    { patron: 'VLMVENTA01', accion: 'usar', tipo: 'picking', ambito: 'vlm', zona: 'frio',
      nota: 'VLM, cámara de frío' },
    { patron: 'VLMVENTA02', accion: 'usar', tipo: 'picking', ambito: 'vlm', zona: 'ambiente',
      nota: 'VLM, ambiente' },
    { patron: 'VLM*', accion: 'usar', tipo: 'picking', ambito: 'vlm',
      nota: 'VLM, sin zona definida' },

    // --- picking con nombre propio, fuera del VLM ---
    { patron: 'BIOCAM*', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'frio',
      nota: 'picking cámara, pasillo' },
    { patron: 'P*',      accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'ambiente',
      nota: 'picking ambiente' },

    /* --- posiciones numéricas: PPPBBBNNN ---
       PPP  pasillo   (010, 013, 104, 003…)  -> define la zona:
                                                1xx cámara, 0xx ambiente
       BBB  posición dentro del pasillo       -> no se usa para clasificar
       NNN  altura del rack                   -> define el tipo:
                                                100 y 150 se pickean,
                                                200/250/300/400/500 son altura

       Las reglas de nivel de picking van primero: si no, la regla del
       pasillo (1*, 0*) se las comería y todo quedaría como altura. */
    { patron: '1*100', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'frio',
      nota: 'pasillo 1xx (cámara), nivel 100' },
    { patron: '1*150', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'frio',
      nota: 'pasillo 1xx (cámara), nivel 150' },
    { patron: '0*100', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'ambiente',
      nota: 'pasillo 0xx (ambiente), nivel 100' },
    { patron: '0*150', accion: 'usar', tipo: 'picking', ambito: 'externo', zona: 'ambiente',
      nota: 'pasillo 0xx (ambiente), nivel 150' },
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

  /**
   * Reconcilia las reglas guardadas con las de esta versión.
   *
   * Sin esto, una lista guardada en el navegador le gana para siempre a las
   * reglas nuevas que trae la app: alguien que editó una regla hace meses no
   * vería nunca las de VLMVENTA01/02, y su stock del VLM seguiría cayendo en
   * la red de seguridad. Las reglas propias (patrones que no están en las de
   * fábrica) se conservan, antes del `*` final para que sigan teniendo efecto.
   */
  function migrarReglas(guardadas, version) {
    const lista = (guardadas || [])
      .filter(r => r && r.patron)
      .map(r => Object.assign({}, r));
    if (!lista.length) return reglasDefault();

    /* Ya vio las reglas de esta versión: manda lo guardado, tal cual. Es lo
       que la persona editó, ordenó y —si quiso— borró. */
    if (version >= REGLAS_V) return lista;

    /* Viene de una versión anterior: se suman las reglas nuevas que falten,
       en el lugar que ocupan en la lista de fábrica. El lugar importa: una
       regla de nivel (1*100) tiene que quedar arriba de la del pasillo (1*)
       o no gana nunca. */
    const tiene = {};
    lista.forEach(r => { tiene[String(r.patron).toUpperCase()] = true; });
    reglasDefault().forEach((r, i) => {
      if (tiene[String(r.patron).toUpperCase()]) return;
      lista.splice(Math.min(i, lista.length), 0, r);
    });
    return lista;
  }

  /* ------------------------------------------------------------
     Normalización
     ------------------------------------------------------------ */

  /**
   * Algunas posiciones numéricas vienen con un dígito de menos porque el
   * sistema le come el cero final: "10501910" en vez de "105019100". Sin
   * corregirlo, el nivel se lee corrido (910 en vez de 100) y una posición
   * de picking termina clasificada como altura.
   *
   * Sólo se completa cuando son 8 dígitos exactos: el formato es PPPBBBNNN,
   * de 9. Cualquier otra cosa se deja como viene.
   */
  function normalizar(ubicacion) {
    const u = String(ubicacion == null ? '' : ubicacion).trim();
    if (/^\d{8}$/.test(u)) return u + '0';
    return u;
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
    const conteo = lista.map(r => ({ patron: r.patron, accion: r.accion, tipo: r.tipo,
                                     n: 0, tapadaPor: null }));
    let sinRegla = 0;
    ubicaciones.forEach(u => {
      let i = -1;
      for (let k = 0; k < lista.length; k++) { if (coincide(u, lista[k].patron)) { i = k; break; } }
      if (i === -1) { sinRegla++; return; }
      conteo[i].n++;
      /* Las de más abajo que también agarraban esta posición pero llegan
         tarde. Sin esto, una regla tapada se ve igual que una que no
         coincide con nada —las dos dicen "0 ubic."— y no hay forma de
         darse cuenta de que el problema es el orden. */
      for (let k = i + 1; k < lista.length; k++) {
        if (conteo[k].tapadaPor === null && coincide(u, lista[k].patron)) {
          conteo[k].tapadaPor = lista[i].patron;
        }
      }
    });
    return { conteo, sinRegla };
  }

  return { TIPOS, REGLAS_V, REGLAS_DEFAULT, reglasDefault, migrarReglas,
           normalizar, coincide, evaluar, cobertura };
})();
