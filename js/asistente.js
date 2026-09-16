/* ============================================================
   asistente.js · pedirle cosas al panel escribiendo en español

   No es un modelo de lenguaje: es un intérprete de frases sobre un
   vocabulario cerrado —SKU, laboratorio, ubicación, lote, mínimo,
   máximo, frío/ambiente, VLM/fuera—, que es todo lo que se le puede
   pedir a este panel.

   Por qué así y no una IA de las que se conectan a internet:
     - anda sin conexión y adentro del archivo suelto del pendrive;
     - no tiene tope de uso ni clave que se pueda robar de un sitio
       público, que es lo que pasa con una clave de API en el navegador;
     - contesta al instante, sin esperar a un servidor;
     - y lo que más importa acá: NO INVENTA. Si no entiende, lo dice.
       Un modelo que improvisa una ubicación manda a una persona al
       pasillo equivocado, y eso es peor que no contestar.

   El precio es que sólo entiende lo que está en este archivo. Agregar
   una forma nueva de decir algo es sumarla a las listas de abajo.

   Las frases van SIN TILDES y en minúscula: se comparan contra el texto
   ya normalizado por util.norm, que saca acentos y puntuación.
   ============================================================ */
window.VLM = window.VLM || {};

VLM.asistente = (function () {
  const U = VLM.util;

  /* ------------------------------------------------------------
     Vocabulario
     ------------------------------------------------------------ */
  const ESTADO = {
    agotado: ['agotado', 'agotados', 'sin stock', 'vacio', 'vacios', 'en cero'],
    critico: ['critico', 'criticos', 'en rojo', 'rojo', 'rojos', 'urgente', 'urgentes'],
    bajo:    ['bajo', 'bajos', 'en amarillo', 'amarillo', 'amarillos'],
    ok:      ['ok', 'en verde', 'verde', 'verdes'],
    exceso:  ['exceso', 'excedido', 'excedidos', 'de mas', 'sobrante', 'sobrantes']
  };

  const ZONA = {
    frio:     ['frio', 'frios', 'refrigerado', 'refrigerados', 'cadena de frio', 'heladera', 'termolabil'],
    ambiente: ['ambiente', 'temperatura ambiente', 'seco', 'secos']
  };

  const AMBITO = {
    vlm:     ['vlm', 'torre', 'en la torre', 'modula'],
    externo: ['externo', 'externos', 'fuera del vlm', 'fuera de la torre', 'afuera', 'fuera', 'pasillo']
  };

  const CAMPO = {
    max: ['maximo', 'maximos', 'max', 'capacidad', 'tope'],
    min: ['minimo', 'minimos', 'min', 'punto de pedido']
  };

  const VISTA = {
    dashboard: ['resumen', 'tablero'],
    labs:      ['laboratorios'],
    repo:      ['reposicion', 'reposiciones'],
    inv:       ['inventario'],
    pos:       ['posiciones']
  };

  /* Sólo con uno de estos adelante una frase es "andá a tal lado". Sin
     verbo, "reposicion" es una búsqueda de lo que hay que reponer. */
  const VERBO_IR    = ['ir a', 'anda a', 'andate a', 'llevame a', 'abrir', 'abri', 'abrime', 'mostrar', 'mostrame'];
  const VERBO_SACAR = ['sacar', 'saca', 'sacale', 'borrar', 'borra', 'borrale',
                       'quitar', 'quita', 'quitale', 'eliminar', 'elimina'];
  const REPONER     = ['que hay que reponer', 'que tengo que reponer', 'que reponer',
                       'que repongo', 'a reponer', 'para reponer', 'reponer', 'faltantes'];
  const SIN_MAXIMO  = ['sin maximo', 'sin maximos', 'sin configurar', 'sin capacidad',
                       'no configurados', 'falta configurar'];
  const DONDE       = ['donde esta', 'donde estan', 'donde hay', 'donde queda', 'ubicacion de', 'donde'];

  /* Palabras que no dicen nada sobre QUÉ se busca: sobran tanto para
     entender la frase como para comparar contra los artículos. */
  const RELLENO = ['pone', 'poner', 'ponele', 'poneles', 'cambiar', 'cambia', 'cambiale',
                   'fijar', 'fija', 'fijale', 'setear', 'dejar', 'deja', 'dejale',
                   'buscar', 'busca', 'buscame', 'ver', 'dame', 'decime', 'mostrar',
                   'de', 'del', 'a', 'al', 'en', 'el', 'la', 'lo', 'los', 'las',
                   'un', 'una', 'unos', 'unas', 'para', 'con', 'que', 'es', 'sea',
                   'articulo', 'articulos', 'sku', 'skus', 'producto', 'productos',
                   'item', 'items', 'codigo', 'y', 'e', 'o', 'u', 'me', 'se', 'su', 'sus',
                   /* "el lote 5J012A" busca 5J012A: la palabra "lote" no está
                      escrita en ningún dato, así que dejarla daba cero
                      resultados. Ojo con sumar acá "posicion": es una vista y
                      rompería "ir a posiciones". */
                   'lote', 'lotes', 'partida', 'batch', 'nro', 'numero', 'ubicacion',
                   'todos', 'todas', 'todo', 'toda', 'hay', 'tiene', 'tienen', 'esta', 'estan'];

  /* ------------------------------------------------------------
     Herramientas de texto
     ------------------------------------------------------------ */

  /**
   * Saca una frase del texto, pero sólo si está como palabras enteras:
   * "min" no tiene que picar dentro de "administracion". Devuelve el
   * texto sin la frase, o null si no estaba.
   */
  function quitarFrase(texto, frase) {
    const t = ' ' + texto + ' ';
    const i = t.indexOf(' ' + frase + ' ');
    if (i < 0) return null;
    return (t.slice(0, i) + ' ' + t.slice(i + frase.length + 2)).replace(/\s+/g, ' ').trim();
  }

  /**
   * Busca en la tabla de sinónimos la frase MÁS LARGA que aparezca.
   * El largo importa: "cadena de frio" tiene que ganarle a "frio", y
   * "fuera del vlm" a "vlm", o se entiende al revés.
   */
  function extraer(texto, tabla) {
    let mejorValor = null, mejorFrase = '';
    Object.keys(tabla).forEach(valor => tabla[valor].forEach(frase => {
      if (frase.length <= mejorFrase.length) return;
      if (quitarFrase(texto, frase) === null) return;
      mejorValor = valor; mejorFrase = frase;
    }));
    if (!mejorValor) return null;
    return { valor: mejorValor, frase: mejorFrase, resto: quitarFrase(texto, mejorFrase) };
  }

  /** Igual que extraer pero con una lista suelta: devuelve el resto o null. */
  function quitarAlguna(texto, lista) {
    let mejor = '';
    lista.forEach(frase => {
      if (frase.length > mejor.length && quitarFrase(texto, frase) !== null) mejor = frase;
    });
    return mejor ? { frase: mejor, resto: quitarFrase(texto, mejor) } : null;
  }

  /** ¿Arranca con alguna de estas frases? Devuelve el resto o null. */
  function empiezaCon(texto, lista) {
    let mejor = '';
    lista.forEach(f => {
      if (f.length > mejor.length && (texto === f || texto.indexOf(f + ' ') === 0)) mejor = f;
    });
    return mejor ? texto.slice(mejor.length).trim() : null;
  }

  function limpiarRelleno(texto) {
    return texto.split(' ').filter(w => w && RELLENO.indexOf(w) === -1).join(' ').trim();
  }

  /* ------------------------------------------------------------
     Búsqueda sobre los artículos
     ------------------------------------------------------------ */

  /** Todo lo que de un artículo se puede escribir en el buscador. */
  function textoDe(p) {
    return U.norm([
      p.codigo, p.descripcion, p.laboratorio, p.labNombre, p.lote, p.lote2,
      p.paquete, p.ubicacion,
      (p.detalle || []).map(d => (d.ubicacion || '') + ' ' + (d.lote || '')).join(' ')
    ].join(' '));
  }

  /** Todas las palabras tienen que aparecer: así "lantus 100" afina. */
  function porTexto(consulta, items) {
    const palabras = consulta.split(' ').filter(Boolean);
    if (!palabras.length) return items.slice();
    return items.filter(p => {
      const t = textoDe(p);
      return palabras.every(w => t.indexOf(w) > -1);
    });
  }

  /**
   * Posiciones del artículo que aceptan mínimo y máximo.
   *
   * Es la MISMA regla que usa la tabla de Posiciones (parser.esConfigurable):
   * la reserva no se configura. Tienen que coincidir o el asistente ofrecería
   * cargar un número en una posición que la tabla no muestra, y el valor no
   * aparecería en ningún lado.
   */
  function posicionesDe(p) {
    const cfg = VLM.store.state.posiciones;
    const vistas = {};
    (p.detalle || []).forEach(d => {
      if (!d.ubicacion || !VLM.parser.esConfigurable(d)) return;
      const u = String(d.ubicacion).toUpperCase();
      if (!vistas[u]) {
        const c = cfg[u + '|' + String(p.codigo).toUpperCase()] || cfg[u] || {};
        vistas[u] = { ubicacion: d.ubicacion, stock: 0, min: c.min || 0, max: c.max || 0 };
      }
      vistas[u].stock += d.stock || 0;
    });
    return Object.keys(vistas).map(k => vistas[k]);
  }

  /* ------------------------------------------------------------
     Interpretación
     ------------------------------------------------------------ */

  /**
   * Convierte una frase en algo que el panel pueda hacer.
   *
   * @param texto lo que escribió la persona
   * @param items artículos ya calculados (con estado, ocupación, etc.)
   * @returns { accion: 'ayuda' | 'ir' | 'cambio' | 'buscar', ... }
   */
  function interpretar(texto, items) {
    const t = U.norm(texto);
    if (!t) return { accion: 'ayuda' };
    items = items || [];

    return interpretarIr(t)
        || interpretarCambio(t, items)
        || interpretarBusqueda(t, items);
  }

  /* ---------- "ir a ..." ---------- */
  function interpretarIr(t) {
    if (quitarFrase(t, 'modo tv') !== null || t === 'tv') {
      return { accion: 'ir', destino: 'tv', entendido: 'Entrar al modo TV' };
    }
    const sinVerbo = empiezaCon(t, VERBO_IR);
    const objetivo = sinVerbo === null ? t : limpiarRelleno(sinVerbo);
    if (objetivo === 'configuracion' || objetivo === 'ajustes') {
      return { accion: 'ir', destino: 'config', entendido: 'Abrir la configuración' };
    }
    // sin verbo adelante, "reposicion" es "qué hay que reponer", no "andá ahí"
    if (sinVerbo === null) return null;
    const v = extraer(objetivo, VISTA);
    if (!v || v.resto) return null;
    return { accion: 'ir', destino: 'vista', vista: v.valor,
             entendido: 'Ir a ' + v.frase };
  }

  /* ---------- "poné 120 de máximo a ..." ---------- */
  function interpretarCambio(t, items) {
    const c = extraer(t, CAMPO);
    if (!c) return null;

    const sacar = quitarAlguna(t, VERBO_SACAR);
    /* Hasta 5 dígitos: una cantidad de picking nunca llega a 99.999, y los
       códigos de artículo son de 9. Así "mínimo 30 al 110027286" sabe que 30
       es el valor y 110027286 el artículo, sin tener que adivinar. */
    const num = c.resto.match(/(?:^|\s)(\d{1,5})(?:\s|$)/);

    // "máximos de Roche" no es un cambio: es una búsqueda. Hace falta un
    // número, o decir explícitamente que se saca.
    if (!num && !sacar) return null;

    const campo = c.valor;
    const valor = num ? parseInt(num[1], 10) : 0;
    let resto = num ? quitarFrase(c.resto, num[1]) : c.resto;
    if (sacar) resto = quitarAlguna(resto, VERBO_SACAR) ? quitarAlguna(resto, VERBO_SACAR).resto : resto;
    resto = limpiarRelleno(resto || '');

    const etiqueta = campo === 'max' ? 'máximo' : 'mínimo';
    const base = num ? 'Poner ' + valor + ' de ' + etiqueta : 'Sacar el ' + etiqueta;

    if (!resto) {
      return { accion: 'cambio', campo, valor, entendido: base,
               problema: 'Falta decir de qué artículo. Probá con el código o parte del nombre.' };
    }

    const encontrados = porTexto(resto, items);
    if (!encontrados.length) {
      return { accion: 'cambio', campo, valor, entendido: base + ' a «' + resto + '»',
               problema: 'No hay ningún artículo que coincida con «' + resto + '».' };
    }
    if (encontrados.length > 1) {
      return { accion: 'cambio', campo, valor, entendido: base,
               candidatos: encontrados.slice(0, 12), total: encontrados.length,
               problema: 'Coinciden ' + encontrados.length + ' artículos. Elegí cuál:' };
    }

    const p = encontrados[0];
    const posiciones = posicionesDe(p);
    if (!posiciones.length) {
      return { accion: 'cambio', campo, valor, producto: p,
               entendido: base + ' a ' + (p.descripcion || p.codigo),
               problema: 'Ese artículo no tiene posiciones de picking: todo su stock es reserva, ' +
                         'y la reserva no lleva mínimo ni máximo.' };
    }
    return { accion: 'cambio', campo, valor, producto: p, posiciones,
             entendido: base + ' a ' + (p.descripcion || p.codigo) };
  }

  /* ---------- todo lo demás es buscar ---------- */
  function interpretarBusqueda(t, items) {
    const filtros = {};
    const partes = [];
    let resto = t;

    const donde = empiezaCon(resto, DONDE);
    if (donde !== null) { filtros.donde = true; resto = donde; }

    const rep = quitarAlguna(resto, REPONER);
    if (rep) { filtros.reponer = true; resto = rep.resto; partes.push('a reponer'); }

    const sinMax = quitarAlguna(resto, SIN_MAXIMO);
    if (sinMax) { filtros.sinMaximo = true; resto = sinMax.resto; partes.push('sin máximo cargado'); }

    const e = extraer(resto, ESTADO);
    if (e) { filtros.estado = e.valor; resto = e.resto; partes.push('en ' + e.valor.toUpperCase()); }

    const z = extraer(resto, ZONA);
    if (z) { filtros.zona = z.valor; resto = z.resto; partes.push(z.valor === 'frio' ? 'de frío' : 'de ambiente'); }

    const a = extraer(resto, AMBITO);
    if (a) { filtros.ambito = a.valor; resto = a.resto; partes.push(a.valor === 'vlm' ? 'dentro del VLM' : 'fuera del VLM'); }

    /* Un campo suelto sin número —"máximos de Roche"— no cambia nada: es una
       búsqueda que además dice qué columna mirar. */
    const campo = extraer(resto, CAMPO);
    if (campo) {
      filtros.campo = campo.valor; resto = campo.resto;
      partes.push(campo.valor === 'max' ? 'con su máximo' : 'con su mínimo');
    }

    const texto = limpiarRelleno(resto);
    if (texto) partes.unshift('«' + texto + '»');

    let res = items;
    if (filtros.reponer)   res = res.filter(p => ['agotado', 'critico', 'bajo'].indexOf(p.estado) > -1);
    if (filtros.estado)    res = res.filter(p => p.estado === filtros.estado);
    if (filtros.zona)      res = res.filter(p => p.conservacion === filtros.zona);
    if (filtros.ambito)    res = res.filter(p => p.ambito === filtros.ambito);
    if (filtros.sinMaximo) res = res.filter(p => !p.tieneConfigPos);
    if (texto)             res = porTexto(texto, res);

    // lo más urgente primero, que es lo que se suele estar buscando
    res = res.slice().sort((x, y) => {
      const ux = x.urgencia === null || x.urgencia === undefined ? 99 : x.urgencia;
      const uy = y.urgencia === null || y.urgencia === undefined ? 99 : y.urgencia;
      return ux - uy;
    });

    return {
      accion: 'buscar', filtros, texto, items: res,
      entendido: partes.length ? 'Artículos ' + partes.join(', ') : 'Todos los artículos'
    };
  }

  /**
   * Lo que se muestra con la caja vacía. Además de ayudar es la documentación
   * de lo que entiende.
   *
   * Los ejemplos salen del stock que está cargado, no inventados: un ejemplo
   * con un artículo que no existe contesta "no coincide" en el primer intento
   * y parece roto justo cuando la persona está probando si sirve.
   */
  function ejemplos(items) {
    items = items || [];
    const conNombre = items.filter(p => p.descripcion && p.descripcion !== p.codigo);
    const p = conNombre[0] || items[0];
    const nombre = p ? (p.descripcion || p.codigo).split(' ')[0] : 'Lantus';
    const codigo = p ? p.codigo : '110027286';

    let lote = '';
    items.some(x => (x.detalle || []).some(d => { if (d.lote) { lote = d.lote; return true; } }));

    const lista = [
      { txt: 'qué hay que reponer',  que: 'lo que está agotado, crítico o bajo' },
      { txt: 'críticos de frío',     que: 'cruza estado y conservación' },
      { txt: nombre.toLowerCase(),   que: 'por laboratorio, código, nombre, lote o ubicación' }
    ];
    if (lote) lista.push({ txt: 'dónde está el lote ' + lote, que: 'en qué posiciones hay ese lote' });
    return lista.concat([
      { txt: 'sin máximo',                        que: 'los que faltan configurar' },
      { txt: 'poné 120 de máximo a ' + nombre,    que: 'cambia el máximo (pide confirmar)' },
      { txt: 'mínimo 30 al ' + codigo,            que: 'lo mismo por código' },
      { txt: 'ir a posiciones',                   que: 'cambia de pantalla' }
    ]);
  }

  return { interpretar, posicionesDe, ejemplos };
})();
