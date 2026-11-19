window.VLM = window.VLM || {};

VLM.ubicaciones = (function () {

  const ZONA_VLM = { VLMVENTA01: 'frio', VLMVENTA02: 'ambiente' };

  function normalizar(ubicacion) {
    const u = String(ubicacion == null ? '' : ubicacion).trim();
    if (/^\d{8}$/.test(u)) return u + '0';
    if (/^VLMVENT\d/i.test(u)) return 'VLMVENTA' + u.slice(7);
    return u;
  }

  function evaluar(ubicacion) {
    const u = normalizar(ubicacion).toUpperCase();
    if (!u) return null;
    if (u.indexOf('VLMVENTA') === 0) {
      return { accion: 'usar', tipo: 'picking', ambito: 'vlm', zona: ZONA_VLM[u] || null };
    }
    if (/^\d{9}$/.test(u)) return { accion: 'usar', tipo: 'altura' };
    return { accion: 'ignorar' };
  }

  return { ZONA_VLM, normalizar, evaluar };
})();
