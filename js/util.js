/* ============================================================
   util.js · helpers generales
   ============================================================ */
window.VLM = window.VLM || {};

VLM.util = (function () {

  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Escapa texto para insertar en HTML. */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Normaliza texto: minúsculas, sin acentos, espacios colapsados. */
  function norm(v) {
    return String(v == null ? '' : v)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /**
   * Convierte a número tolerando formatos de planilla:
   * "1.234,56" (es-AR), "1,234.56" (en-US), "$ 1.200", "12 un", "-", "".
   */
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s || s === '-' || s === '—' || /^n\/?d$/i.test(s)) return null;
    s = s.replace(/[^\d,.\-]/g, '');
    if (!s || s === '-') return null;
    const lastComma = s.lastIndexOf(',');
    const lastDot   = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // el separador decimal es el que aparece último
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else                     s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      // una sola coma: decimal si deja 1-2 dígitos, si no es separador de miles
      s = (s.length - lastComma - 1) <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (lastDot > -1) {
      const dots = (s.match(/\./g) || []).length;
      if (dots > 1 || (s.length - lastDot - 1) === 3) s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function fmt(n, dec) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return dec ? nf1.format(n) : nf0.format(Math.round(n));
  }

  /** 1.2k / 3.4M para ejes y KPIs grandes. */
  function fmtCompact(n) {
    if (n === null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
    if (a >= 1e4) return Math.round(n / 1e3) + 'k';
    return nf0.format(Math.round(n));
  }

  function fmtDias(d) {
    if (d === null || d === undefined || !isFinite(d)) return 's/d';
    if (d === Infinity) return '∞';
    if (d >= 999) return '+999';
    return d < 10 ? nf1.format(d) : nf0.format(Math.round(d));
  }

  /** Fecha Excel (serial) o string/Date → Date | null. */
  function toDate(v) {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') {
      // serial de Excel (base 1899-12-30)
      const ms = Math.round((v - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return isNaN(d) ? null : d;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);   // dd/mm/aaaa
    if (m) {
      let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
      const d = new Date(y, +m[2] - 1, +m[1]);
      return isNaN(d) ? null : d;
    }
    m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);          // aaaa-mm-dd
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      return isNaN(d) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function fmtFecha(d) {
    if (!d) return '—';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtFechaCorta(d) {
    if (!d) return '—';
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }

  function addDias(base, n) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + Math.round(n));
    return d;
  }

  /** "hace 4 min" */
  function hace(ts) {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'hace instantes';
    const m = Math.floor(s / 60);
    if (m < 60) return 'hace ' + m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return 'hace ' + h + ' h';
    const d = Math.floor(h / 24);
    return 'hace ' + d + (d === 1 ? ' día' : ' días');
  }

  /** Color estable por nombre (laboratorios). */
  const PALETA = [
    '#38bdf8', '#22c55e', '#f59e0b', '#a78bfa', '#f472b6',
    '#2dd4bf', '#fb923c', '#60a5fa', '#4ade80', '#facc15',
    '#c084fc', '#fb7185', '#34d399', '#93c5fd', '#fdba74'
  ];
  const _colorCache = {};
  function colorDe(nombre) {
    if (_colorCache[nombre]) return _colorCache[nombre];
    let h = 0;
    const s = String(nombre);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (_colorCache[nombre] = PALETA[h % PALETA.length]);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const a = arguments, c = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(c, a), ms || 200);
    };
  }

  /** Descarga un archivo generado en el navegador. */
  function download(nombre, contenido, mime) {
    const blob = contenido instanceof Blob
      ? contenido
      : new Blob([contenido], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /** CSV con BOM para que Excel respete los acentos. */
  function toCsv(filas) {
    const cell = v => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + filas.map(f => f.map(cell).join(';')).join('\r\n');
  }

  function toast(msg, tipo) {
    const wrap = $('#toasts');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast' + (tipo ? ' t-' + tipo : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .25s, transform .25s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(16px)';
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  /** Lee una variable CSS del tema actual. */
  function cssVar(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  }

  return {
    $, $$, esc, norm, toNum, fmt, fmtCompact, fmtDias,
    toDate, fmtFecha, fmtFechaCorta, addDias, hace,
    colorDe, PALETA, debounce, download, toCsv, toast, cssVar
  };
})();
