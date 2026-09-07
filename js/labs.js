/* ============================================================
   labs.js · catálogo de laboratorios, ámbito y conservación

   Dos dimensiones independientes:
     ámbito       vlm | externo     ¿está dentro de la torre?
     conservación frio | ambiente   ¿cámara de frío o temperatura ambiente?
   ============================================================ */
window.VLM = window.VLM || {};

VLM.labs = (function () {
  const U = VLM.util;

  /* ---------------- constantes de presentación ---------------- */

  const AMBITOS = {
    vlm:     { label: 'VLM',            corto: 'VLM',   desc: 'Dentro de la torre de picking' },
    externo: { label: 'Fuera del VLM',  corto: 'Fuera', desc: 'Almacenado fuera de la torre' }
  };

  const ZONAS = {
    frio:     { label: 'Cámara de frío', corto: 'Frío',     icono: '❄', desc: '2 a 8 °C' },
    ambiente: { label: 'Ambiente',       corto: 'Ambiente', icono: '🌡', desc: '15 a 25 °C' }
  };

  /* ---------------- catálogo por defecto ----------------
     `alias` se compara normalizado (sin acentos ni puntuación) contra el
     valor de la columna Laboratorio, primero exacto y después por contención.
     `zona` es el valor por defecto cuando la planilla no trae conservación.
     ------------------------------------------------------ */
  const CATALOGO_DEFAULT = [
    { id: 'astrazeneca', nombre: 'AstraZeneca',         ambito: 'vlm',
      alias: ['astrazeneca', 'astra zeneca', 'astra', 'az'],                  zona: 'ambiente' },
    { id: 'roche',       nombre: 'Roche',               ambito: 'vlm',
      alias: ['roche', 'productos roche', 'roche argentina'],                 zona: 'frio' },
    { id: 'sanofi',      nombre: 'Sanofi Aventis',      ambito: 'vlm',
      alias: ['sanofi aventis', 'sanofi', 'aventis', 'sanofi argentina'],     zona: 'ambiente' },
    { id: 'amgen',       nombre: 'Amgen',               ambito: 'vlm',
      alias: ['amgen', 'amgen argentina'],                                    zona: 'frio' },
    { id: 'abbvie',      nombre: 'Abbvie',              ambito: 'externo',
      alias: ['abbvie', 'abb vie', 'abbott vie'],                             zona: 'frio' },
    { id: 'biosidus',    nombre: 'Biosidus Argentina',  ambito: 'externo',
      alias: ['biosidus argentina', 'biosidus'],                              zona: 'frio' }
  ];

  /** Copia profunda, para no mutar la constante al editar en Configuración. */
  function catalogoDefault() {
    return CATALOGO_DEFAULT.map(l => Object.assign({}, l, { alias: l.alias.slice() }));
  }

  /* ---------------- matcheo de nombres ---------------- */

  /**
   * Busca a qué laboratorio del catálogo corresponde un nombre de la planilla.
   * Primero intenta coincidencia exacta; después, que el nombre del Excel
   * contenga algún alias ("LAB. ROCHE S.A.Q. e I." -> Roche).
   * Los alias de menos de 4 caracteres sólo matchean exacto, para que "az"
   * no se coma cualquier razón social que tenga esas letras.
   */
  function buscar(nombreRaw, catalogo) {
    const n = U.norm(nombreRaw);
    if (!n) return null;

    for (const l of catalogo) {
      if (l.alias.some(a => U.norm(a) === n)) return l;
    }
    let mejor = null, mejorLargo = 0;
    for (const l of catalogo) {
      for (const a of l.alias) {
        const an = U.norm(a);
        if (an.length < 4) continue;
        if (an.length > mejorLargo && (n === an || n.indexOf(an + ' ') === 0 ||
            n.indexOf(' ' + an) > -1 || n.indexOf(an) > -1)) {
          mejor = l; mejorLargo = an.length;
        }
      }
    }
    return mejor;
  }

  /* ---------------- conservación ---------------- */

  const RE_FRIO = /(cadena de frio|cadena frio|refriger|termolab|heladera|frio|cold|2 a 8|2 8 c|2 8 grados)/;
  const RE_AMB  = /(ambiente|temperatura ambiente|seco|room|15 a 25|15 25|no refriger|sin frio)/;
  const RE_SI   = /^(si|s|x|true|verdadero|1|sí)$/;
  const RE_NO   = /^(no|n|false|falso|0)$/;

  /**
   * Interpreta el valor de la columna de conservación.
   * `headerNorm` importa: en una columna "Cadena de frío" un "SI" significa
   * frío, mientras que en una columna "Conservación" hay que leer el texto.
   * @returns 'frio' | 'ambiente' | null (no se pudo determinar)
   */
  function parsearConservacion(valor, headerNorm) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = U.norm(valor);
    if (!n) return null;

    const headerEsFrio = headerNorm ? RE_FRIO.test(headerNorm) : false;
    if (headerEsFrio) {
      if (RE_SI.test(n)) return 'frio';
      if (RE_NO.test(n)) return 'ambiente';
    }
    if (RE_AMB.test(n))  return 'ambiente';
    if (RE_FRIO.test(n)) return 'frio';
    return null;
  }

  /**
   * Resuelve la conservación final de un producto.
   * Prioridad: lo que diga la planilla > el default del laboratorio > ambiente.
   */
  function resolverZona(zonaDePlanilla, lab) {
    if (zonaDePlanilla === 'frio' || zonaDePlanilla === 'ambiente') return zonaDePlanilla;
    if (lab && (lab.zona === 'frio' || lab.zona === 'ambiente')) return lab.zona;
    return 'ambiente';
  }

  /**
   * Clasifica un producto ya normalizado: le agrega labId, labNombre,
   * ambito, conservacion y gestionado.
   */
  function clasificar(p, catalogo) {
    const lab = buscar(p.laboratorio, catalogo);
    p.labId       = lab ? lab.id : null;
    p.labNombre   = lab ? lab.nombre : p.laboratorio;
    p.gestionado  = !!lab;
    // el ámbito sale de la posición si una regla lo define: dónde está la
    // mercadería es un hecho físico, el laboratorio es sólo el default
    p.ambito      = p.ambitoPos || (lab ? lab.ambito : 'externo');
    p.conservacion = resolverZona(p.zonaPlanilla, lab);
    return p;
  }

  /** Clave de agrupación "vlm|frio" y su etiqueta legible. */
  function claveGrupo(p)      { return p.ambito + '|' + p.conservacion; }
  function labelGrupo(clave)  {
    const [a, z] = clave.split('|');
    return AMBITOS[a].label + ' · ' + ZONAS[z].label;
  }

  /** Los cuatro grupos posibles, en orden de importancia operativa. */
  const GRUPOS = ['vlm|frio', 'vlm|ambiente', 'externo|frio', 'externo|ambiente'];

  return {
    AMBITOS, ZONAS, GRUPOS, CATALOGO_DEFAULT,
    catalogoDefault, buscar, parsearConservacion, resolverZona, clasificar,
    claveGrupo, labelGrupo
  };
})();
