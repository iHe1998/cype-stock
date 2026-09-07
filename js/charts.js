/* ============================================================
   charts.js · envoltorio de Chart.js
   Todos los gráficos leen los colores del tema activo.
   ============================================================ */
window.VLM = window.VLM || {};

VLM.charts = (function () {
  const U = VLM.util;
  const A = VLM.analytics;
  const instancias = {};   // id de canvas -> Chart

  function tema() {
    return {
      texto:  U.cssVar('--text') || '#e8eef6',
      muted:  U.cssVar('--muted') || '#7c8ca0',
      grid:   U.cssVar('--border-soft') || '#1b2532',
      surf:   U.cssVar('--surface') || '#111823',
      accent: U.cssVar('--accent') || '#38bdf8',
      ok:     U.cssVar('--ok') || '#22c55e',
      warn:   U.cssVar('--warn') || '#f59e0b',
      crit:   U.cssVar('--crit') || '#ef4444',
      info:   U.cssVar('--info') || '#a78bfa',
      agotado: U.cssVar('--agotado') || '#414c5c'
    };
  }

  /** Agotado va en gris casi negro, no en rojo: es otra cosa que crítico. */
  function colorEstado(estado, t) {
    return {
      agotado: t.agotado, critico: t.crit, bajo: t.warn,
      ok: t.ok, exceso: t.info, sd: t.muted
    }[estado] || t.muted;
  }

  /** Destruye el gráfico anterior en ese canvas antes de dibujar. */
  function montar(canvas, config) {
    if (!canvas) return null;
    const id = canvas.id || (canvas.id = 'c' + Math.random().toString(36).slice(2));
    if (instancias[id]) { instancias[id].destroy(); delete instancias[id]; }
    instancias[id] = new Chart(canvas.getContext('2d'), config);
    return instancias[id];
  }

  function destruirTodos() {
    Object.keys(instancias).forEach(id => { instancias[id].destroy(); delete instancias[id]; });
  }

  /** Opciones base compartidas. Escala tipografía para el modo TV. */
  function base(t, tv) {
    const f = tv ? 18 : 11;
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      layout: { padding: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: !tv,
          backgroundColor: t.surf,
          titleColor: t.texto,
          bodyColor: t.texto,
          borderColor: t.grid,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 6,
          displayColors: true,
          boxPadding: 4
        }
      },
      scales: {
        x: {
          grid: { color: t.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: t.muted, font: { size: f }, padding: 6 }
        },
        y: {
          grid: { color: t.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: t.muted, font: { size: f }, padding: 6 }
        }
      }
    };
  }

  /* ------------------------------------------------------------
     1. Stock por laboratorio (barras horizontales)
     ------------------------------------------------------------ */
  function stockPorLab(canvas, labs, tv) {
    const t = tema();
    const top = labs.slice().sort((a, b) => b.resumen.unidades - a.resumen.unidades).slice(0, tv ? 8 : 12);
    const o = base(t, tv);
    o.indexAxis = 'y';
    o.scales.x.ticks.callback = v => U.fmtCompact(v);
    o.plugins.tooltip.callbacks = {
      label: c => U.fmt(c.parsed.x) + ' unidades'
    };
    return montar(canvas, {
      type: 'bar',
      data: {
        labels: top.map(l => l.nombre),
        datasets: [{
          data: top.map(l => l.resumen.unidades),
          backgroundColor: top.map(l => l.color),
          borderRadius: 4,
          barThickness: tv ? 26 : 16
        }]
      },
      options: o
    });
  }

  /* ------------------------------------------------------------
     2. Distribución de estados (dona)
     ------------------------------------------------------------ */
  function estados(canvas, res, tv) {
    const t = tema();
    const claves = A.ORDEN_ESTADOS.filter(k => res.porEstado[k] > 0);
    return montar(canvas, {
      type: 'doughnut',
      data: {
        labels: claves.map(k => A.ESTADOS[k].label),
        datasets: [{
          data: claves.map(k => res.porEstado[k]),
          backgroundColor: claves.map(k => colorEstado(k, t)),
          borderColor: t.surf,
          borderWidth: 3,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: tv ? 'bottom' : 'right',
            labels: {
              color: t.texto,
              font: { size: tv ? 18 : 12 },
              boxWidth: tv ? 16 : 10,
              boxHeight: tv ? 16 : 10,
              padding: tv ? 16 : 10,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            enabled: !tv,
            backgroundColor: t.surf, titleColor: t.texto, bodyColor: t.texto,
            borderColor: t.grid, borderWidth: 1, padding: 10, cornerRadius: 6,
            callbacks: {
              label: c => {
                const tot = c.dataset.data.reduce((s, v) => s + v, 0);
                return ' ' + c.label + ': ' + c.parsed + ' SKU (' + Math.round(c.parsed / tot * 100) + '%)';
              }
            }
          }
        }
      }
    });
  }

  /* ------------------------------------------------------------
     3. Picking vs altura por laboratorio (barras apiladas)
     ------------------------------------------------------------ */
  function pickingVsAltura(canvas, labs, tv) {
    const t = tema();
    const top = labs.slice(0, tv ? 8 : 12).map(l => ({
      nombre: l.nombre,
      picking: l.productos.reduce((s, p) => s + (p.stockPicking || 0), 0),
      altura:  l.productos.reduce((s, p) => s + (p.stockAltura || 0), 0)
    }));
    const o = base(t, tv);
    o.indexAxis = 'y';
    o.scales.x.stacked = true;
    o.scales.y.stacked = true;
    o.scales.y.grid.display = false;
    o.scales.x.ticks.callback = v => U.fmtCompact(v);
    o.plugins.legend = {
      display: true, position: 'top',
      labels: { color: t.muted, font: { size: tv ? 16 : 11 }, boxWidth: 9, boxHeight: 9,
                usePointStyle: true, pointStyle: 'circle', padding: 12 }
    };
    o.plugins.tooltip.callbacks = { label: c => c.dataset.label + ': ' + U.fmt(c.parsed.x) + ' u' };
    return montar(canvas, {
      type: 'bar',
      data: {
        labels: top.map(l => recortar(l.nombre, 18)),
        datasets: [
          { label: 'Picking', data: top.map(l => l.picking), backgroundColor: t.accent,
            borderRadius: 3, barThickness: tv ? 24 : 16 },
          { label: 'Altura', data: top.map(l => l.altura), backgroundColor: t.agotado,
            borderRadius: 3, barThickness: tv ? 24 : 16 }
        ]
      },
      options: o
    });
  }

  /* ------------------------------------------------------------
     6. Estados apilados por laboratorio
     ------------------------------------------------------------ */
  function estadosPorLab(canvas, labs, tv) {
    const t = tema();
    const top = labs.slice(0, tv ? 8 : 12);
    const claves = ['agotado', 'critico', 'bajo', 'ok', 'exceso', 'sd'];
    const o = base(t, tv);
    o.indexAxis = 'y';
    o.scales.x.stacked = true;
    o.scales.y.stacked = true;
    o.scales.y.grid.display = false;
    o.scales.x.ticks.precision = 0;
    o.plugins.legend = {
      display: true, position: 'top',
      labels: { color: t.muted, font: { size: tv ? 16 : 11 }, boxWidth: 9, boxHeight: 9, usePointStyle: true, pointStyle: 'circle', padding: 12 }
    };
    return montar(canvas, {
      type: 'bar',
      data: {
        labels: top.map(l => l.nombre),
        datasets: claves.map(k => ({
          label: A.ESTADOS[k].label,
          data: top.map(l => l.resumen.porEstado[k] || 0),
          backgroundColor: colorEstado(k, t),
          borderRadius: 3,
          barThickness: tv ? 24 : 15
        })).filter(ds => ds.data.some(v => v > 0))
      },
      options: o
    });
  }

  function recortar(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  return {
    montar, destruirTodos, tema, colorEstado,
    stockPorLab, estados, pickingVsAltura, estadosPorLab
  };
})();
