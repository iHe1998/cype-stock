/* ============================================================
   vigia.js · carga automática: vigilar una carpeta y subir el
   Excel de saldos de SCE apenas aparece

   SCE no deja programar exportaciones a nivel usuario, así
   que el Excel lo sigue bajando una persona con "Exportar a Excel"
   en la vista "SALDOS STOCK GRAL". Lo que se automatiza es todo lo
   demás: Chrome lo guarda en una carpeta, esta pestaña la vigila,
   comprueba que sea el de saldos y lo sube. La persona ya no abre el
   panel, no inicia sesión ni mapea columnas.

   Corre en el navegador, con la API de acceso a carpetas de Chrome y
   Edge: no hay que instalar nada en una PC de empresa, y el Excel se
   lee con el mismo lector que la importación a mano.

   Tres trampas de SCE que esto tiene que esquivar:
     - TODAS las exportaciones de SCE se llaman export.xlsx, de la
       pantalla que sean. El nombre no dice nada: la de saldos se
       reconoce por sus 15 columnas.
     - Chrome no pisa: crea export (1).xlsx, export (2).xlsx… Hay que
       mirar las fechas, no los nombres.
     - Chrome no deja vigilar Descargas entera, sólo una subcarpeta.
   ============================================================ */
window.VLM = window.VLM || {};

VLM.vigia = (function () {
  const U = VLM.util;

  const KEY = 'vlm.vigia.v1';
  const CADA_MS = 20000;

  /* Las 15 columnas de la vista de saldos, normalizadas. Es la huella: un
     archivo que no las tiene todas es otra exportación de SCE, y subirla
     reemplazaría el stock de todas las pantallas por cualquier cosa. */
  const HUELLA = ['propietario', 'articulo', 'descripcion', 'lote', 'ubicacion', 'lpn',
                  'stock fisico', 'disponible', 'estatus', 'asignado', 'atributo 02',
                  'fecha de vencimiento', 'atributo 07', 'atributo 08', 'paquete'];

  /* Campo del panel -> columna de la vista de saldos. Fijo, no adivinado: la
     importación a mano adivina y deja que la persona corrija, pero acá no hay
     nadie para corregir. "Disponible" y "Stock físico", por ejemplo, se
     parecen lo bastante como para que un adivino los confunda. */
  const MAPEO = {
    laboratorio: 'propietario', codigo: 'articulo', descripcion: 'descripcion',
    lote: 'lote', ubicacion: 'ubicacion', stock: 'stock fisico', disponible: 'disponible',
    estatus: 'estatus', asignado: 'asignado', lote2: 'atributo 02',
    vencimiento: 'fecha de vencimiento', atributo07: 'atributo 07', paquete: 'paquete'
  };

  let carpeta = null;        // FileSystemDirectoryHandle
  let persistida = false;    // si el handle quedó guardado para la próxima vez
  let timer = null;
  let ocupado = false;
  let retenido = null;       // { file, firma, n, antes } a la espera de "Subir igual"
  let est = { estado: 'apagado', texto: '' };
  const oyentes = [];

  /* ---------------- estado ---------------- */

  function soportado() {
    return typeof window.showDirectoryPicker === 'function' && !!window.isSecureContext;
  }

  function leerMemoria() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function guardarMemoria(m) {
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) {}
  }

  function poner(estado, texto) {
    est = { estado: estado, texto: texto || '' };
    oyentes.forEach(fn => { try { fn(est); } catch (e) {} });
  }

  function firmaDe(file) {
    return { nombre: file.name, modificado: file.lastModified, tamano: file.size };
  }
  function mismaFirma(a, b) {
    return !!a && !!b && a.nombre === b.nombre && a.modificado === b.modificado && a.tamano === b.tamano;
  }

  /* ---------------- dónde queda guardada la carpeta ----------------
     El permiso sobre la carpeta no se puede guardar en localStorage: el
     "handle" sólo entra en IndexedDB. */

  function abrirDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('cype', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('vigia');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idb(modo, accion, valor) {
    const db = await abrirDb();
    return new Promise((res, rej) => {
      const st = db.transaction('vigia', modo).objectStore('vigia');
      const q = accion === 'get' ? st.get('carpeta')
              : accion === 'put' ? st.put(valor, 'carpeta')
              : st.delete('carpeta');
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  }

  /* ---------------- ciclo de vida ---------------- */

  async function iniciar() {
    if (!soportado()) { poner('no-soportado'); return; }
    try { carpeta = await idb('readonly', 'get'); } catch (e) { carpeta = null; }
    if (!carpeta) { poner('apagado'); return; }
    persistida = true;
    let p = 'prompt';
    try { p = await carpeta.queryPermission({ mode: 'read' }); } catch (e) {}
    if (p === 'granted') arrancar();
    else poner('esperando-permiso', 'El navegador pide permiso otra vez para leer «' +
                carpeta.name + '». Apretá Retomar.');
  }

  /** Lo llama un clic: el navegador sólo abre el selector con un gesto. */
  async function elegir() {
    if (!soportado()) { poner('no-soportado'); return; }
    let h;
    try {
      h = await window.showDirectoryPicker({ id: 'cype-sce', mode: 'read' });
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // la persona cerró el selector
      poner('error', 'No se pudo abrir la carpeta: ' + e.message);
      return;
    }
    carpeta = h;
    // si no se puede guardar, igual vigila; sólo que no va a sobrevivir a una recarga
    try { await idb('readwrite', 'put', h); persistida = true; } catch (e) { persistida = false; }
    const m = leerMemoria();
    m.rechazados = [];
    guardarMemoria(m);
    arrancar();
  }

  /** También tiene que venir de un clic, por el mismo motivo. */
  async function retomar() {
    if (!carpeta) { poner('apagado'); return; }
    let p = 'denied';
    try { p = await carpeta.requestPermission({ mode: 'read' }); } catch (e) {}
    if (p === 'granted') arrancar();
    else poner('esperando-permiso', 'Sin permiso no puedo leer la carpeta. Apretá Retomar y aceptá.');
  }

  async function detener() {
    clearInterval(timer); timer = null;
    carpeta = null; retenido = null;
    try { await idb('readwrite', 'del'); } catch (e) {}
    poner('apagado');
  }

  function arrancar() {
    poner('vigilando', textoVigilando());
    clearInterval(timer);
    timer = setInterval(revisar, CADA_MS);
    revisar();
  }

  function textoVigilando(extra) {
    const m = leerMemoria();
    let t = 'Vigilando «' + (carpeta ? carpeta.name : '?') + '»';
    if (m.ultimo) {
      t += ' · último: ' + m.ultimo.nombre + ', ' + U.hace(m.ultimo.cuando) +
           ', ' + U.fmt(m.ultimo.productos) + ' artículos';
    } else {
      t += ' · todavía no subió nada';
    }
    if (VLM.app.stockPendiente && VLM.app.stockPendiente()) {
      t += ' · la base no contesta: el último está cargado en esta PC y se sube solo apenas vuelva';
    }
    if (!persistida) t += ' · ojo: si se recarga la página hay que volver a elegir la carpeta';
    return extra ? t + ' · ' + extra : t;
  }

  /* ---------------- la revisión ---------------- */

  /** Todas las planillas de la carpeta, de la más nueva a la más vieja. */
  async function planillas() {
    const lista = [];
    for await (const h of carpeta.values()) {
      if (h.kind !== 'file') continue;
      if (!/\.(xlsx|xls)$/i.test(h.name)) continue;          // .crdownload todavía se está bajando
      if (h.name.indexOf('~$') === 0) continue;              // archivo de bloqueo de Excel
      lista.push(await h.getFile());
    }
    return lista.sort((a, b) => b.lastModified - a.lastModified);
  }

  /** Desde cuándo es el stock que ya está cargado: nada más viejo que eso entra. */
  function stockVigenteDesde() {
    const meta = VLM.store.state.meta || {};
    const sub = meta.subidoEn ? Date.parse(meta.subidoEn) : 0;
    return Math.max(meta.importadoEn || 0, isFinite(sub) ? sub : 0);
  }

  async function revisar() {
    if (!carpeta || ocupado || retenido) return;
    ocupado = true;
    try {
      const m = leerMemoria();
      const rechazados = m.rechazados || [];
      const desde = Math.max(stockVigenteDesde(), m.ultimo ? m.ultimo.modificado : 0);

      /* Candidatos: lo que es más nuevo que el stock cargado. No alcanza con
         mirar el más nuevo de todos: si alguien exporta los saldos y enseguida
         otra pantalla de SCE, el más nuevo es el otro, y los saldos quedarían
         sin subir. Se prueban del más nuevo al más viejo hasta dar con uno. */
      const nuevos = (await planillas()).filter(f =>
        f.lastModified > desde && !rechazados.some(r => mismaFirma(r, firmaDe(f))));

      if (!nuevos.length) { poner(estadoTranquilo(), textoVigilando()); return; }

      for (const f of nuevos) {
        // recién guardado: puede estar todavía escribiéndose
        if (Date.now() - f.lastModified < 4000) {
          poner('vigilando', textoVigilando('llegó ' + f.name + ', esperando que termine de guardarse'));
          return;
        }
        const r = await procesar(f, false);
        if (r === 'subido' || r === 'esperar') return;
        // 'rechazado': probar con el siguiente
      }
      poner(estadoTranquilo(), textoVigilando());
    } catch (e) {
      if (e && e.name === 'NotAllowedError') {
        poner('esperando-permiso', 'El navegador quitó el permiso sobre la carpeta. Apretá Retomar.');
        clearInterval(timer); timer = null;
      } else {
        poner('error', 'No se pudo leer la carpeta: ' + (e && e.message));
      }
    } finally {
      ocupado = false;
    }
  }

  function rechazar(file, motivo) {
    const m = leerMemoria();
    m.rechazados = (m.rechazados || []).concat([firmaDe(file)]).slice(-50);
    guardarMemoria(m);
    return motivo;
  }

  /**
   * Lee un archivo y, si es el de saldos, lo sube.
   * @returns 'subido' | 'rechazado' | 'esperar'
   */
  async function procesar(file, forzar) {
    const N = VLM.nube, P = VLM.parser, S = VLM.store;

    // sin sesión no hay cómo subir: se reintenta solo en cuanto alguien entre
    if (N.configurada() && !N.conSesion()) {
      poner('error', 'Llegó ' + file.name + ', pero hace falta la sesión iniciada en esta PC ' +
                     'para subirlo. Apenas entres, lo sube.');
      return 'esperar';
    }

    let r;
    try { r = await P.leerArchivo(file); }
    catch (e) { rechazar(file); return 'rechazado'; }   // no es un Excel legible

    const matriz = P.hojaAMatriz(r.wb, r.hojas[0]);
    const fh = P.detectarFilaEncabezado(matriz);
    const cab = (matriz[fh] || []).map(h => U.norm(h));
    const faltan = HUELLA.filter(h => cab.indexOf(h) === -1);
    if (faltan.length) {
      // otra exportación de SCE: es lo más común, no merece un cartel
      rechazar(file);
      return 'rechazado';
    }

    const mapa = {};
    Object.keys(MAPEO).forEach(campo => { mapa[campo] = cab.indexOf(MAPEO[campo]); });

    const res = P.normalizar(matriz, fh, mapa, S.state.cfg, S.state.labs,
      { agrupar: true, reglas: S.state.reglasUbic, posiciones: S.state.posiciones });

    if (!res.productos.length) {
      rechazar(file);
      poner('error', file.name + ' tiene las columnas de saldos pero ninguna fila válida. No se subió.');
      return 'rechazado';
    }

    /* Una exportación con la mitad de artículos que lo que hay suele ser un
       error —la vista con otro filtro, un propietario solo— y subirla dejaría
       a todas las pantallas mostrando medio depósito. Se retiene hasta que
       alguien confirme. */
    const antes = S.state.productos.length;
    if (!forzar && antes >= 20 && res.productos.length < antes * 0.5) {
      retenido = { file: file, n: res.productos.length, antes: antes };
      poner('retenido', file.name + ' trae ' + U.fmt(res.productos.length) +
            ' artículos y hoy hay ' + U.fmt(antes) + '. Puede ser una exportación con otro ' +
            'filtro. Si está bien, apretá Subir igual.');
      return 'esperar';
    }

    await VLM.app.aplicarImportacion(res, {
      archivo: file.name, hoja: r.hojas[0], mapeo: mapa, automatico: true
    });

    /* Se anota como hecho aunque la subida haya fallado: el archivo YA está
       cargado en esta PC, y la subida pendiente la reintenta app.js en cada
       refresco (ver marcarStockSinSubir). Reprocesarlo acá no arreglaría nada. */
    const m = leerMemoria();
    m.ultimo = Object.assign(firmaDe(file), { cuando: Date.now(), productos: res.productos.length });
    guardarMemoria(m);
    poner(estadoTranquilo(), textoVigilando());
    return 'subido';
  }

  /** "Vigilando", salvo que haya stock que todavía no llegó a la base. */
  function estadoTranquilo() {
    return VLM.app.stockPendiente && VLM.app.stockPendiente() ? 'error' : 'vigilando';
  }

  async function subirIgual() {
    if (!retenido) return;
    const f = retenido.file;
    retenido = null;
    ocupado = true;
    try { await procesar(f, true); } finally { ocupado = false; }
  }

  function descartarRetenido() {
    if (!retenido) return;
    rechazar(retenido.file);
    retenido = null;
    poner(estadoTranquilo(), textoVigilando());
  }

  function revisarAhora() { if (carpeta) revisar(); }

  return {
    HUELLA, soportado, iniciar, elegir, retomar, detener, revisarAhora,
    subirIgual, descartarRetenido,
    estado: () => est,
    alCambiar: fn => { oyentes.push(fn); }
  };
})();
