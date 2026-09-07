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
     3. Historial de consumo real (barras) + stock total (línea)
     ------------------------------------------------------------ */
  function historial(canvas, hist, tv) {
    const t = tema();
    const p = hist.periodos;
    const o = base(t, tv);
    o.scales.y.ticks.callback = v => U.fmtCompact(v);
    o.scales.y.title = { display: !tv, text: 'unidades consumidas', color: t.muted, font: { size: 10 } };
    o.scales.x.grid.display = false;
    o.scales.x.ticks.maxTicksLimit = tv ? 10 : 14;
    o.scales.y1 = {
      position: 'right',
      grid: { display: false },
      border: { display: false },
      ticks: { color: t.muted, font: { size: tv ? 16 : 10 }, callback: v => U.fmtCompact(v) }
    };
    o.plugins.tooltip.callbacks = {
      title: c => {
        const per = p[c[0].dataIndex];
        return U.fmtFecha(per.fecha) + (per.dias > 1 ? ' · acumula ' + per.dias + ' días' : '');
      },
      label: c => c.datasetIndex === 0
        ? U.fmt(c.parsed.y) + ' unidades consumidas'
        : 'Stock al cierre: ' + U.fmt(c.parsed.y)
    };
    o.plugins.legend = {
      display: true, position: 'top',
      labels: { color: t.muted, font: { size: tv ? 16 : 11 }, boxWidth: 9, boxHeight: 9,
                usePointStyle: true, pointStyle: 'circle', padding: 12 }
    };

    return montar(canvas, {
      type: 'bar',
      data: {
        labels: p.map(x => U.fmtFechaCorta(x.fecha)),
        datasets: [
          {
            label: 'Consumido',
            data: p.map(x => Math.round(x.consumido)),
            backgroundColor: t.accent,
            borderRadius: 4,
            maxBarThickness: tv ? 40 : 26,
            order: 2
          },
          {
            label: 'Stock total',
            type: 'line',
            data: p.map(x => x.stockFinal),
            borderColor: t.muted,
            borderWidth: tv ? 3 : 2,
            borderDash: [5, 4],
            pointRadius: 0,
            tension: .3,
            yAxisID: 'y1',
            order: 1
          }
        ]
      },
      options: o
    });
  }

  /* ------------------------------------------------------------
     3b. Consumo del período por laboratorio
     ------------------------------------------------------------ */
  function consumoLab(canvas, filas, tv) {
    const t = tema();
    const top = filas.slice(0, tv ? 8 : 10);
    const o = base(t, tv);
    o.indexAxis = 'y';
    o.scales.y.grid.display = false;
    o.scales.x.ticks.callback = v => U.fmtCompact(v);
    o.plugins.tooltip.callbacks = { label: c => U.fmt(c.parsed.x) + ' unidades consumidas' };
    return montar(canvas, {
      type: 'bar',
      data: {
        labels: top.map(l => recortar(l.nombre, 20)),
        datasets: [{
          data: top.map(l => Math.round(l.consumido)),
          backgroundColor: top.map(l => l.color),
          borderRadius: 4,
          barThickness: tv ? 24 : 16
        }]
      },
      options: o
    });
  }

  /* ------------------------------------------------------------
     4. Quiebres por tramo (barras)
     ------------------------------------------------------------ */
  function quiebres(canvas, tramos, tv) {
    const t = tema();
    // el primer tramo es "Ya agotado": gris, no rojo
    const cols = [t.agotado, t.crit, t.warn, t.accent, t.ok, t.ok];
    const o = base(t, tv);
    o.scales.y.ticks.precision = 0;
    o.scales.x.grid.display = false;
    o.plugins.tooltip.callbacks = { label: c => c.parsed.y + ' producto(s)' };
    return montar(canvas, {
      type: 'bar',
      data: {
        labels: tramos.map(x => x.label),
        datasets: [{
          data: tramos.map(x => x.n),
          backgroundColor: cols,
          borderRadius: 5,
          maxBarThickness: tv ? 80 : 52
        }]
      },
      options: o
    });
  }

  /* ------------------------------------------------------------
     5. Menor cobertura (top N barras horizontales)
     ------------------------------------------------------------ */
  function menorCobertura(canvas, items, cfg, tv, n) {
    const t = tema();
    const top = items
      .filter(p => p.diasCobertura !== null && isFinite(p.diasCobertura))
      .sort((a, b) => a.diasCobertura - b.diasCobertura)
      .slice(0, n || (tv ? 8 : 10));
    const o = base(t, tv);
    o.indexAxis = 'y';
    o.scales.y.grid.display = false;
    o.scales.x.ticks.callback = v => v + 'd';
    o.plugins.tooltip.callbacks = {
      title: c => top[c[0].dataIndex].descripcion,
      label: c => U.fmtDias(c.parsed.x) + ' días de cobertura · stock ' + U.fmt(top[c.dataIndex].stock)
    };
    return montar(canvas, {
      type: 'bar',
      data: {
        labels: top.map(p => recortar(p.descripcion, tv ? 26 : 30)),
        datasets: [{
          data: top.map(p => Math.round(p.diasCobertura * 10) / 10),
          backgroundColor: top.map(p => colorEstado(p.estado, t)),
          borderRadius: 4,
          barThickness: tv ? 24 : 15
        }]
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
    stockPorLab, estados, historial, consumoLab, quiebres, menorCobertura, estadosPorLab
  };
})();
