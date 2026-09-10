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
     El catálogo dice QUÉ laboratorios se procesan y cómo se llaman. Nada más.
     Ni el ámbito ni la conservación salen de acá: los dos son propiedades de
     dónde está la mercadería, y un laboratorio tiene de todo. AstraZeneca
     tiene artículos adentro de la torre y otros que se pickean de pasillo, y
     adentro de la torre los tiene en VLMVENTA01 (frío) y en VLMVENTA02
     (ambiente). Cualquier default por laboratorio sólo puede estar bien para
     una parte.
     ------------------------------------------------------ */
  const CATALOGO_DEFAULT = [
    { id: 'astrazeneca', nombre: 'AstraZeneca',
      alias: ['astrazeneca', 'astra zeneca', 'astra', 'az'] },
    { id: 'roche', nombre: 'Roche',
      alias: ['roche', 'productos roche', 'roche argentina'] },
    { id: 'sanofi', nombre: 'Sanofi Aventis',
      alias: ['sanofi aventis', 'sanofi', 'aventis', 'sanofi argentina'] },
    { id: 'amgen', nombre: 'Amgen',
      alias: ['amgen', 'amgen argentina'] },
    { id: 'abbvie', nombre: 'Abbvie',
      alias: ['abbvie', 'abb vie', 'abbott vie'] },
    { id: 'biosidus', nombre: 'Biosidus Argentina',
      alias: ['biosidus argentina', 'biosidus'] }
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
   *
   * Sale de la POSICIÓN: de una columna de conservación de la planilla, o de
   * la regla de la posición (VLMVENTA01 es frío, VLMVENTA02 es ambiente). El
   * laboratorio no vota: tiene artículos de los dos lados.
   *
   * Si ninguna regla la define queda `ambiente`, pero la posición aparece en
   * el aviso de "posiciones sin zona" para que se note que falta una regla y
   * no pase por un dato bueno.
   */
  function resolverZona(zonaDePlanilla) {
    if (zonaDePlanilla === 'frio' || zonaDePlanilla === 'ambiente') return zonaDePlanilla;
    return 'ambiente';
  }

  /**
   * Clasifica un producto ya normalizado.
   *
   * El laboratorio sólo aporta el nombre lindo y si está en el catálogo. El
   * ámbito y la conservación los decide parser.reaplicarReglas() mirando las
   * ubicaciones del artículo, así que acá sólo se copian.
   */
  function clasificar(p, catalogo) {
    const lab = buscar(p.laboratorio, catalogo);
    p.labId       = lab ? lab.id : null;
    p.labNombre   = lab ? lab.nombre : p.laboratorio;
    p.gestionado  = !!lab;
    p.ambito      = p.ambitoPos || 'externo';
    p.conservacion = resolverZona(p.zonaPlanilla);
    p.zonaSupuesta = !p.zonaExplicita;
    return p;
  }

  /**
   * Los catálogos guardados por versiones anteriores traen `zona` y `ambito`
   * por laboratorio. Se descartan: los dos salen de la posición.
   * Además se agregan los laboratorios nuevos que el catálogo guardado
   * no tenga, sin tocar los que el usuario haya editado.
   */
  function migrarCatalogo(guardado) {
    const lista = (guardado || []).map(l => {
      const c = Object.assign({}, l);
      delete c.zona;
      delete c.ambito;
      return c;
    });
    const ids = lista.map(l => l.id);
    CATALOGO_DEFAULT.forEach(d => {
      if (ids.indexOf(d.id) === -1) lista.push(Object.assign({}, d, { alias: d.alias.slice() }));
    });
    return lista;
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
    catalogoDefault, migrarCatalogo, buscar, parsearConservacion, resolverZona, clasificar,
    claveGrupo, labelGrupo
  };
})();
