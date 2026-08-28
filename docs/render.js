/* Canvas plotting for the SAA annotation tool.
 *
 * Deliberate deviation from spec section 2, which named Plotly.js: Plotly's event
 * model is the direct cause of the v1 click bugs (selection events instead of
 * clicks, snapping to invisible plotted markers, no way to click empty plot area).
 * Rendering by hand gives exact control over the three things that matter here:
 *   1. click anywhere -> x maps to time, y is ignored
 *   2. guaranteed peak-preserving decimation (min/max per pixel column)
 *   3. three panels sharing one time axis, with draggable interval edges
 */
const Render = (() => {
  const PAD = { l: 58, r: 10, t: 6, b: 6 };

  // first index with arr[i] >= v
  function lower(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (arr[m] < v) lo = m + 1; else hi = m;
    }
    return lo;
  }

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  /* Peak-preserving reduction to at most `cols` columns. Returns per-column
   * {min,max,n}. This is NOT every-Nth sampling: every local extremum inside a
   * column survives as that column's min or max, so no peak can be hidden. */
  function bucket(t, y, t0, t1, cols) {
    const i0 = lower(t, t0), i1 = lower(t, t1);
    const span = (t1 - t0) || 1;
    const out = new Array(cols);
    for (let i = i0; i < i1; i++) {
      let c = Math.floor((t[i] - t0) / span * cols);
      if (c < 0) c = 0; else if (c >= cols) c = cols - 1;
      const v = y[i], b = out[c];
      if (b === undefined) out[c] = { min: v, max: v, n: 1 };
      else {
        if (v < b.min) b.min = v;
        if (v > b.max) b.max = v;
        b.n++;
      }
    }
    return { cols: out, i0, i1, exact: (i1 - i0) <= cols * 1.5 };
  }

  function yScale(t, y, t0, t1, log) {
    const i0 = lower(t, t0), i1 = lower(t, t1);
    let mn = Infinity, mx = -Infinity, mnPos = Infinity;
    for (let i = i0; i < i1; i++) {
      const v = y[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      if (v > 0 && v < mnPos) mnPos = v;
    }
    if (!isFinite(mx)) { mn = 0; mx = 1; mnPos = 0.1; }
    if (log) {
      const lo = isFinite(mnPos) ? mnPos * 0.7 : 1e-3;
      const hi = Math.max(mx * 1.4, lo * 10);
      const a = Math.log10(lo), b = Math.log10(hi);
      return { to: v => (v <= 0 ? 0 : (Math.log10(v) - a) / (b - a)), lo, hi, log: true };
    }
    const pad = (mx - mn) * 0.08 || 1;
    const lo = Math.max(0, mn - pad), hi = mx + pad;
    return { to: v => (v - lo) / (hi - lo), lo, hi, log: false };
  }

  function ticks(lo, hi, log) {
    const out = [];
    if (log) {
      for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
        for (const m of [1, 2, 5]) {
          const v = m * Math.pow(10, e);
          if (v >= lo && v <= hi) out.push(v);
        }
      }
      if (out.length > 8) {
        const k = Math.ceil(out.length / 7);
        return out.filter((_, i) => i % k === 0);
      }
      return out;
    }
    const base = Math.pow(10, Math.floor(Math.log10((hi - lo) / 4 || 1)));
    for (const m of [1, 2, 5, 10, 20]) {
      const s = base * m;
      if ((hi - lo) / s <= 6) {
        for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(v);
        break;
      }
    }
    return out;
  }

  function fmtY(v) {
    const a = Math.abs(v);
    if (a === 0) return '0';
    // "1k" reads better than "1e+3" in a 58px gutter
    if (a >= 1000) return (Math.round(v / 100) / 10) + 'k';
    if (a >= 1) return String(Math.round(v * 100) / 100);
    return String(Number(v.toPrecision(2)));
  }

  /* o: {t, y, t0, t1, log, selection, saved, ref, hoverX} */
  function panel(canvas, o) {
    const { ctx, w, h } = fit(canvas);
    const x0 = PAD.l, x1 = w - PAD.r, y0 = PAD.t, y1 = h - PAD.b;
    const pw = x1 - x0, ph = y1 - y0;
    ctx.clearRect(0, 0, w, h);

    const sc = yScale(o.t, o.y, o.t0, o.t1, o.log);
    const Y = v => y1 - sc.to(v) * ph;
    const X = s => x0 + (s - o.t0) / (o.t1 - o.t0) * pw;

    ctx.strokeStyle = '#262d3a';
    ctx.fillStyle = '#93a0b5';
    ctx.font = '11px ui-monospace,monospace';
    ctx.textAlign = 'right';
    ctx.lineWidth = 1;
    for (const v of ticks(sc.lo, sc.hi, sc.log)) {
      const y = Math.round(Y(v)) + 0.5;
      if (y < y0 || y > y1) continue;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillText(fmtY(v), x0 - 7, y + 4);
    }

    function band(a, b, fill, stroke) {
      const xa = Math.max(x0, X(a)), xb = Math.min(x1, X(b));
      if (X(b) < x0 || X(a) > x1) return;
      ctx.fillStyle = fill;
      ctx.fillRect(xa, y0, Math.max(1.5, xb - xa), ph);
      if (!stroke) return;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xa + 0.5, y0); ctx.lineTo(xa + 0.5, y1);
      ctx.moveTo(xb - 0.5, y0); ctx.lineTo(xb - 0.5, y1);
      ctx.stroke();
    }

    // reference bands are admin-only; `ref` is never populated in volunteer mode
    for (const s of (o.ref || [])) band(s[0], s[1], 'rgba(255,90,90,.16)', null);
    for (const s of (o.saved || [])) band(s.s, s.e, 'rgba(72,209,122,.15)', 'rgba(72,209,122,.65)');

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, pw, ph);
    ctx.clip();
    const cols = Math.max(1, Math.round(pw));
    const b = bucket(o.t, o.y, o.t0, o.t1, cols);
    ctx.strokeStyle = '#cdd7e6';
    ctx.lineWidth = 1;
    if (b.exact) {
      ctx.beginPath();
      let started = false;
      for (let i = Math.max(0, b.i0 - 1); i < Math.min(o.t.length, b.i1 + 1); i++) {
        const x = X(o.t[i]), y = Y(o.y[i]);
        if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      let prev = null;
      for (let c = 0; c < cols; c++) {
        const bk = b.cols[c];
        if (!bk) continue;
        const x = x0 + c + 0.5;
        const yTop = Y(bk.max), yBot = Y(bk.min);
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, Math.max(yBot, yTop + 0.8));
        if (prev) { ctx.moveTo(prev.x, prev.y); ctx.lineTo(x, yTop); }
        prev = { x: x, y: yBot };
      }
      ctx.stroke();
    }
    ctx.restore();

    /* Guide line. Reliable in ONE direction only: above it is almost certainly a
     * pass (measured 99% precision at 5x the day's median ddsi), but ~29% of passes
     * never cross it. Drawn under the selection so it never obscures live work. */
    if (o.guide && o.guide.v > 0) {
      const gy = Y(o.guide.v);
      if (gy > y0 && gy < y1) {
        ctx.strokeStyle = '#9a8cff';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, Math.round(gy) + 0.5);
        ctx.lineTo(x1, Math.round(gy) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        if (o.guide.label) {
          ctx.font = '10px ui-monospace,monospace';
          ctx.textAlign = 'left';
          const tw = ctx.measureText(o.guide.label).width;
          ctx.fillStyle = 'rgba(23,27,35,.85)';
          ctx.fillRect(x1 - tw - 10, gy - 13, tw + 8, 12);
          ctx.fillStyle = '#9a8cff';
          ctx.fillText(o.guide.label, x1 - tw - 6, gy - 4);
          ctx.textAlign = 'right';
        }
      }
    }

    const sel = o.selection;
    if (sel && sel.start != null) {
      if (sel.end != null) {
        band(Math.min(sel.start, sel.end), Math.max(sel.start, sel.end),
          'rgba(255,182,56,.22)', '#ffb638');
      } else {
        ctx.strokeStyle = '#ffb638';
        ctx.lineWidth = 1.5;
        const x = Math.round(X(sel.start)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffb638';
      for (const v of [sel.start, sel.end]) {
        if (v == null) continue;
        const x = X(v);
        if (x >= x0 - 3 && x <= x1 + 3) ctx.fillRect(x - 2.5, y0, 5, 7);
      }
    }

    if (o.hoverX != null && o.hoverX >= x0 && o.hoverX <= x1) {
      ctx.strokeStyle = 'rgba(90,169,255,.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(o.hoverX) + 0.5, y0);
      ctx.lineTo(Math.round(o.hoverX) + 0.5, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = '#262d3a';
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, pw - 1, ph - 1);
  }

  function axis(canvas, t0, t1) {
    const { ctx, w } = fit(canvas);
    ctx.clearRect(0, 0, w, canvas.clientHeight);
    const x0 = PAD.l, x1 = w - PAD.r, pw = x1 - x0, span = t1 - t0;
    const step = [10, 30, 60, 300, 600, 1800, 3600, 7200, 10800, 21600]
      .find(s => span / s <= 12) || 21600;
    ctx.fillStyle = '#93a0b5';
    ctx.font = '11px ui-monospace,monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#262d3a';
    for (let s = Math.ceil(t0 / step) * step; s <= t1; s += step) {
      const x = x0 + (s - t0) / span * pw;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, 4);
      ctx.stroke();
      const hh = String(Math.floor(s / 3600) % 24).padStart(2, '0');
      const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
      const ss = String(Math.floor(s) % 60).padStart(2, '0');
      ctx.fillText(step < 60 ? hh + ':' + mm + ':' + ss : hh + ':' + mm, x, 15);
    }
  }

  // x pixel -> time, and time -> x pixel, for hit-testing outside the renderer
  function geom(canvas, t0, t1) {
    const w = canvas.clientWidth, x0 = PAD.l, x1 = w - PAD.r, pw = x1 - x0;
    return {
      x0, x1,
      toTime: px => t0 + (Math.min(x1, Math.max(x0, px)) - x0) / pw * (t1 - t0),
      toPx: s => x0 + (s - t0) / (t1 - t0) * pw,
      inPlot: px => px >= x0 && px <= x1
    };
  }

  return { panel, axis, geom, PAD, lower };
})();
