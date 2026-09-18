/* ============================================================
   nube.js · máximos compartidos entre PCs (Supabase)

   El problema que resuelve: los máximos por SKU viven en el
   localStorage del navegador, así que son de UNA máquina. Cargarlos en
   la PC de la oficina y abrir el panel en la del depósito daba la tabla
   vacía. Acá se guardan en una base y los ve cualquiera que abra la web.

   Va contra la API REST de Supabase con fetch pelado, sin su librería:
   este proyecto no tiene build ni dependencias y no vale la pena sumar
   50 KB para cuatro llamadas.

   Quién puede qué:
     - leer    cualquiera que abra la página (clave anónima, es pública
               a propósito: Supabase la publica en el cliente y lo que
               protege de verdad son las políticas RLS de la tabla)
     - escribir sólo con sesión iniciada
   Así el panel del depósito muestra los máximos sin poder tocarlos, y
   quien los configura entra con su usuario.

   Sin configurar, todo esto no existe: la app sigue funcionando con el
   localStorage como hasta ahora. Es lo que permite que el archivo
   suelto ande sin internet.
   ============================================================ */
window.VLM = window.VLM || {};

VLM.nube = (function () {
  const KEY_CFG  = 'vlm.nube.v1';
  const KEY_SESS = 'vlm.nube.sesion.v1';
  const TABLA        = 'maximos';
  const TABLA_STOCK  = 'stock';
  const TABLA_CONFIG = 'config';

  let cfg = null;      // { url, anonKey }
  let sesion = null;   // { access_token, refresh_token, email }

  function cargar() {
    try { cfg = JSON.parse(localStorage.getItem(KEY_CFG) || 'null'); } catch (e) { cfg = null; }
    /* Sin nada guardado en este navegador se usa lo que venga en
       config.js, que es lo que hace que una PC nueva funcione sin que
       nadie le cargue nada. Lo del navegador manda por si alguien
       necesita apuntar a otra base. */
    if (!cfg || !cfg.url || !cfg.anonKey) {
      const d = (VLM.config && VLM.config.supabase) || {};
      if (d.url && d.anonKey) cfg = { url: String(d.url).replace(/\/+$/, ''), anonKey: d.anonKey, porDefecto: true };
    }
    try { sesion = JSON.parse(localStorage.getItem(KEY_SESS) || 'null'); } catch (e) { sesion = null; }
    return cfg;
  }

  /** ¿La conexión vino de config.js y no de esta PC? */
  function esPorDefecto() { return !!(cfg && cfg.porDefecto); }

  /**
   * ¿Se pueden tocar las configuraciones?
   *
   * Con una base conectada hace falta sesión: la pantalla del depósito y
   * cualquiera que abra la web ven, pero no cambian nada. Sin base conectada
   * —el archivo suelto en un pendrive— no hay contra qué autenticarse y sería
   * absurdo trabarlo, así que ahí se puede todo.
   *
   * Esto traba la interfaz, que es lo que evita los accidentes: alguien
   * apoyando el codo en la PC del depósito. No es una barrera de seguridad —
   * quien sepa abrir la consola del navegador la saltea—. Lo que de verdad
   * protege lo que ven los demás son las políticas de la base, que rechazan
   * cualquier escritura sin sesión.
   */
  function puedeEditar() { return !configurada() || conSesion(); }

  function configurada() { return !!(cfg && cfg.url && cfg.anonKey); }
  function conSesion()   { return !!(sesion && sesion.access_token); }
  function email()       { return sesion ? sesion.email : null; }
  function datos()       { return cfg ? { url: cfg.url, anonKey: cfg.anonKey } : null; }

  function setConfig(url, anonKey) {
    url = String(url || '').trim().replace(/\/+$/, '');
    anonKey = String(anonKey || '').trim();
    if (!url || !anonKey) { cfg = null; try { localStorage.removeItem(KEY_CFG); } catch (e) {} return; }
    cfg = { url, anonKey };
    try { localStorage.setItem(KEY_CFG, JSON.stringify(cfg)); } catch (e) {}
  }

  function guardarSesion(s) {
    sesion = s;
    try {
      if (s) localStorage.setItem(KEY_SESS, JSON.stringify(s));
      else localStorage.removeItem(KEY_SESS);
    } catch (e) {}
  }

  /* ---------------- llamadas ---------------- */

  function cabeceras(conToken) {
    const h = {
      'apikey': cfg.anonKey,
      'Content-Type': 'application/json'
    };
    h['Authorization'] = 'Bearer ' + ((conToken && sesion && sesion.access_token) || cfg.anonKey);
    return h;
  }

  async function pedir(ruta, opciones, conToken) {
    if (!configurada()) throw new Error('La nube no está configurada');
    const r = await fetch(cfg.url + ruta, Object.assign({
      headers: cabeceras(conToken)
    }, opciones || {}));
    if (r.status === 401 && conToken && sesion && sesion.refresh_token) {
      // el token dura una hora: se renueva y se reintenta una sola vez
      const ok = await renovar();
      if (ok) return pedir(ruta, opciones, conToken);
    }
    const txt = await r.text();
    if (!r.ok) throw new Error('Supabase ' + r.status + ': ' + txt.slice(0, 200));
    // Un upsert con Prefer: return=minimal contesta 201 SIN cuerpo, así que no
    // se puede llamar a .json() a ciegas: revienta con "Unexpected end of JSON".
    if (!txt) return null;
    try { return JSON.parse(txt); } catch (e) { return null; }
  }

  async function renovar() {
    try {
      const r = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': cfg.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: sesion.refresh_token })
      });
      if (!r.ok) { guardarSesion(null); return false; }
      const j = await r.json();
      guardarSesion({ access_token: j.access_token, refresh_token: j.refresh_token,
                      email: (j.user && j.user.email) || (sesion && sesion.email) });
      return true;
    } catch (e) { return false; }
  }

  async function entrar(correo, clave) {
    if (!configurada()) throw new Error('Falta configurar la nube');
    const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || ('error ' + r.status));
    guardarSesion({ access_token: j.access_token, refresh_token: j.refresh_token,
                    email: (j.user && j.user.email) || correo });
    return sesion.email;
  }

  function salir() { guardarSesion(null); }

  /* ---------------- máximos ---------------- */

  /** Baja todos los máximos. Devuelve el mapa con la forma de store.posiciones. */
  async function bajarMaximos() {
    const filas = await pedir('/rest/v1/' + TABLA + '?select=clave,ubicacion,articulo,min,max', { method: 'GET' });
    const mapa = {};
    (filas || []).forEach(f => {
      if (!f.clave) return;
      mapa[f.clave] = { min: f.min || 0, max: f.max || 0,
                        ubicacion: f.ubicacion, articulo: f.articulo };
    });
    return mapa;
  }

  /**
   * Sube el mapa entero. Usa upsert (Prefer: resolution=merge-duplicates),
   * que inserta lo nuevo y pisa lo que ya estaba, en una sola llamada.
   */
  async function subirMaximos(mapa) {
    const filas = Object.keys(mapa || {}).map(k => ({
      clave: k,
      ubicacion: mapa[k].ubicacion || k.split('|')[0] || '',
      articulo: mapa[k].articulo || k.split('|')[1] || '',
      min: mapa[k].min || 0,
      max: mapa[k].max || 0
    })).filter(f => f.min || f.max);
    if (!filas.length) return 0;
    await pedir('/rest/v1/' + TABLA + '?on_conflict=clave', {
      method: 'POST',
      headers: Object.assign(cabeceras(true), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(filas)
    }, true);
    return filas.length;
  }

  /** Borra de la base las claves que ya no están en el mapa local. */
  async function borrarMaximo(clave) {
    await pedir('/rest/v1/' + TABLA + '?clave=eq.' + encodeURIComponent(clave),
      { method: 'DELETE' }, true);
  }

  /* ---------------- stock ----------------
     Una sola fila con la foto del stock: el mismo arreglo de productos que
     se guarda en el navegador, tal cual. Así la PC del depósito y la de la
     tele no necesitan que nadie les suba la planilla — la cargan de acá.

     Es UNA fila, no una por artículo, porque la app trabaja con la lista
     entera de una: subirla y bajarla completa es una llamada en vez de
     doscientas, y no hay estados intermedios donde la pantalla muestre
     medio stock.

     Cuando SCE escriba solo, va a escribir en esta misma fila: el panel no
     se entera de si del otro lado hubo una persona o un sistema. */

  /**
   * Sólo la marca de tiempo del stock, sin el stock.
   *
   * La fila entera pesa medio mega y las pantallas refrescan cada pocos
   * minutos: preguntar "¿cambió algo?" con unos cientos de bytes y bajar el
   * archivo sólo cuando cambió es la diferencia entre gigas por mes y nada.
   */
  async function fechaStock() {
    const filas = await pedir('/rest/v1/' + TABLA_STOCK + '?id=eq.actual&select=actualizado',
      { method: 'GET' });
    const f = (filas || [])[0];
    return f ? f.actualizado : null;
  }

  async function bajarStock() {
    const filas = await pedir('/rest/v1/' + TABLA_STOCK + '?id=eq.actual&select=productos,meta,actualizado,por',
      { method: 'GET' });
    const f = (filas || [])[0];
    if (!f || !f.productos) return null;
    return { productos: f.productos, meta: f.meta || {}, actualizado: f.actualizado, por: f.por };
  }

  async function subirStock(productos, meta) {
    const cuando = new Date().toISOString();
    await pedir('/rest/v1/' + TABLA_STOCK + '?on_conflict=id', {
      method: 'POST',
      headers: Object.assign(cabeceras(true), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{
        id: 'actual',
        productos: productos,
        meta: meta || {},
        por: (sesion && sesion.email) || null,
        actualizado: cuando
      }])
    }, true);
    // devuelve la marca para que quien subió no se baje después su propio
    // archivo por no saber que la fila de la base ya es la suya
    return cuando;
  }

  /* ---------------- configuración compartida ----------------
     Reglas de posición, catálogo de laboratorios y umbrales. Deciden lo que
     ve el panel tanto como el stock: con reglas distintas, dos PCs clasifican
     el mismo artículo distinto y muestran números que no cierran entre sí.

     Una sola fila, como el stock: se cambia poco y siempre entera. */

  async function bajarConfig() {
    const filas = await pedir('/rest/v1/' + TABLA_CONFIG + '?id=eq.actual&select=datos,actualizado,por',
      { method: 'GET' });
    const f = (filas || [])[0];
    if (!f || !f.datos) return null;
    return { datos: f.datos, actualizado: f.actualizado, por: f.por };
  }

  async function subirConfig(datos) {
    const cuando = new Date().toISOString();
    await pedir('/rest/v1/' + TABLA_CONFIG + '?on_conflict=id', {
      method: 'POST',
      headers: Object.assign(cabeceras(true), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{
        id: 'actual',
        datos: datos,
        por: (sesion && sesion.email) || null,
        actualizado: cuando
      }])
    }, true);
    return cuando;
  }

  cargar();

  return {
    cargar, configurada, conSesion, esPorDefecto, puedeEditar, email, datos, setConfig,
    entrar, salir, bajarMaximos, subirMaximos, borrarMaximo,
    fechaStock, bajarStock, subirStock,
    bajarConfig, subirConfig
  };
})();
