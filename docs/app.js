/* SAA Manual Labeling Tool — application logic.
 *
 * Annotation is BLIND: the NASA/SRAG reference is never fetched or drawn in
 * volunteer mode. It lives under /ref/, which the Worker serves only to admins.
 * Independent labels are the whole point of the campaign, so this is enforced by
 * not having the data rather than by hiding a layer.
 */
(() => {
  // Ordered top-to-bottom. Measured share of reference passes whose peak clears
  // that day's ordinary background maximum -- i.e. what is actually findable.
  const PANELS = [
    { key: 'ddsi', title: 'ddsi — deposited dose', note: '67% of passes visible' },
    { key: 'dh', title: 'ddsi × hardness — most sensitive', note: '70% of passes visible' },
    { key: 'flux', title: 'flux — count rate', note: '58% of passes visible' }
  ];

  const S = {
    index: null, dayIdx: 0, date: null, day: null,
    view: { t0: 0, t1: 86400 },
    sel: { start: null, end: null },
    labels: [], done: [], editing: null,
    log: true, hoverX: null, volunteer: ''
  };

  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const hms = s => {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, x = s % 60;
    return [h, m, x].map(n => String(n).padStart(2, '0')).join(':');
  };
  const dur = s => {
    const m = Math.floor(Math.abs(s) / 60), x = Math.round(Math.abs(s) % 60);
    return m + 'm ' + String(x).padStart(2, '0') + 's';
  };
  // absolute UTC instant -> seconds after the viewed day's midnight (may be <0 or
  // >86400 for a pass that crosses midnight)
  const secOf = (isoStr, date) =>
    (Date.parse(isoStr) - Date.parse(date + 'T00:00:00Z')) / 1000;

  /* ---------------------------------------------------------------- panels */

  const canvases = [];
  function buildPanels() {
    const host = $('panels');
    host.innerHTML = '';
    for (const p of PANELS) {
      const d = document.createElement('div');
      d.className = 'panel';
      const c = document.createElement('canvas');
      c.style.height = '148px';
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.textContent = p.title + '  ·  ' + p.note;
      const val = document.createElement('div');
      val.className = 'val';
      d.append(c, tag, val);
      host.append(d);
      canvases.push({ el: d, canvas: c, val, key: p.key });
      wire(c);
    }
    const ax = document.createElement('canvas');
    ax.style.height = '22px';
    $('axis').append(ax);
    canvases.axis = ax;
  }

  let pending = false;
  function draw() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!S.day) return;
      const saved = S.labels
        .filter(l => l.id !== S.editing)
        .map(l => ({ s: secOf(l.start, S.date), e: secOf(l.end, S.date) }))
        .filter(l => l.e > S.view.t0 - 60 && l.s < S.view.t1 + 60);
      for (const c of canvases) {
        Render.panel(c.canvas, {
          t: S.day.t, y: S.day[c.key],
          t0: S.view.t0, t1: S.view.t1,
          log: S.log, selection: S.sel, saved, ref: null, hoverX: S.hoverX
        });
      }
      Render.axis(canvases.axis, S.view.t0, S.view.t1);
    });
  }

  const nearest = sec => {
    const t = S.day.t;
    let i = Render.lower(t, sec);
    if (i <= 0) return t[0];
    if (i >= t.length) return t[t.length - 1];
    return (sec - t[i - 1] <= t[i] - sec) ? t[i - 1] : t[i];
  };

  function readout(sec) {
    const t = S.day.t;
    let i = Render.lower(t, sec);
    if (i >= t.length) i = t.length - 1;
    for (const c of canvases) {
      const v = S.day[c.key][i];
      c.val.textContent = hms(t[i]) + '   ' + (v >= 100 ? v.toFixed(0) : v.toPrecision(3));
    }
  }

  /* ------------------------------------------------------------ interaction */

  function wire(canvas) {
    let down = null, mode = null;

    const g = () => Render.geom(canvas, S.view.t0, S.view.t1);
    // offsetX is relative to whatever element is under the pointer, which is wrong
    // once a drag leaves the canvas -- always measure against the canvas itself
    const localX = e => e.clientX - canvas.getBoundingClientRect().left;

    const handleAt = px => {
      if (S.sel.start == null) return null;
      const gg = g();
      for (const k of ['start', 'end']) {
        if (S.sel[k] == null) continue;
        if (Math.abs(gg.toPx(S.sel[k]) - px) <= 6) return k;
      }
      return null;
    };

    canvas.addEventListener('mousedown', e => {
      const px = localX(e);
      if (!g().inPlot(px)) return;
      down = { px, x: e.clientX, t: g().toTime(px) };
      mode = e.shiftKey ? 'pan' : (handleAt(px) || null);
      if (mode === 'pan') canvas.parentElement.classList.add('grabbing');
      // preventDefault below stops text selection while dragging, but it also
      // suppresses the blur that would commit a half-typed name -- so blur by hand
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
      }
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      const inside = e.target === canvas;
      if (inside) {
        S.hoverX = localX(e);
        if (g().inPlot(S.hoverX)) readout(g().toTime(S.hoverX));
      }
      if (!down) { if (inside) draw(); return; }

      if (mode === 'pan') {
        const gg = g();
        const perPx = (S.view.t1 - S.view.t0) / (gg.x1 - gg.x0);
        let d = (e.clientX - down.x) * perPx;
        down.x = e.clientX;
        const span = S.view.t1 - S.view.t0;
        let t0 = clamp(S.view.t0 - d, 0, 86400 - span);
        S.view = { t0, t1: t0 + span };
        draw();
        return;
      }
      if (mode === 'start' || mode === 'end') {
        S.sel[mode] = nearest(g().toTime(localX(e)));
        renderSel();
        draw();
      }
    });

    window.addEventListener('mouseup', e => {
      if (!down) return;
      canvas.parentElement.classList.remove('grabbing');
      const moved = Math.abs(e.clientX - down.x) > 4 || mode === 'pan';
      // a click is a press and release in the same place with no handle grabbed
      if (!moved && !mode) click(down.t);
      down = null;
      mode = null;
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const gg = g(), px = localX(e);
      if (!gg.inPlot(px)) return;
      const at = gg.toTime(px);
      const k = e.deltaY > 0 ? 1.25 : 0.8;
      let span = clamp((S.view.t1 - S.view.t0) * k, 60, 86400);
      const frac = (at - S.view.t0) / (S.view.t1 - S.view.t0);
      let t0 = clamp(at - frac * span, 0, 86400 - span);
      S.view = { t0, t1: t0 + span };
      draw();
    }, { passive: false });

    canvas.addEventListener('mouseleave', () => { S.hoverX = null; draw(); });
  }

  function click(t) {
    const s = nearest(t);
    if (S.sel.start == null) { S.sel.start = s; S.sel.end = null; }
    else if (S.sel.end == null) { S.sel.end = s; }
    else {
      // both set: start a fresh selection rather than silently mangling this one
      S.sel = { start: s, end: null };
    }
    renderSel();
    draw();
  }

  // Always read the name from the field rather than trusting a cached copy: a
  // `change` event can never fire if the input never loses focus, and mousedown on
  // the canvas calls preventDefault(), which suppresses the blur.
  const who = () => ($('who').value || '').trim();

  function renderSel() {
    const { start, end } = S.sel;
    const ready = start != null && end != null && start !== end;
    S.volunteer = who();
    const named = S.volunteer.length > 0;
    $('save').disabled = !(ready && named);
    $('clear').disabled = start == null;
    $('whoWarn').classList.toggle('hidden', named || !ready);
    $('save').textContent = S.editing ? 'Save changes' : 'Save label';

    if (start == null) {
      $('selInfo').textContent = 'Click a panel to set the start of a pass.';
    } else if (end == null) {
      $('selInfo').innerHTML = 'Start <b>' + hms(start) + '</b> UTC — now click the end.';
    } else if (start === end) {
      $('selInfo').innerHTML = 'Start and end are the same sample — click further apart, ' +
        'or zoom in first.';
    } else {
      const a = Math.min(start, end), b = Math.max(start, end);
      $('selInfo').innerHTML = 'Start <b>' + hms(a) + '</b> &rarr; end <b>' + hms(b) +
        '</b> UTC  ·  ' + dur(b - a) +
        (S.editing ? '  ·  editing an existing label' : '');
    }
  }

  /* ------------------------------------------------------------------ data */

  async function loadIndex() {
    S.index = (await (await fetch('data/index.json')).json()).days;
    const j = $('jump');
    j.innerHTML = '';
    S.index.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = d.date;
      j.append(o);
    });
  }

  async function loadDay(i, force) {
    if (!force && S.sel.start != null && S.sel.end != null && !confirm(
      'You have an unsaved selection. Leave this day and discard it?')) return;
    S.dayIdx = clamp(i, 0, S.index.length - 1);
    S.date = S.index[S.dayIdx].date;
    S.day = await (await fetch('data/' + S.date + '.json')).json();
    S.sel = { start: null, end: null };
    S.editing = null;
    S.view = { t0: 0, t1: 86400 };
    $('jump').value = String(S.dayIdx);
    $('dayInfo').textContent = 'day ' + (S.dayIdx + 1) + ' of ' + S.index.length +
      '  ·  ' + S.day.n.toLocaleString() + ' samples at 11 s';
    $('prev').disabled = S.dayIdx === 0;
    $('next').disabled = S.dayIdx === S.index.length - 1;
    renderSel();
    renderLabels();
    draw();
  }

  async function refresh() {
    if (!S.volunteer.trim()) { S.labels = []; S.done = []; renderLabels(); return; }
    S.labels = await Store.list(S.volunteer.trim());
    S.done = await Store.completed(S.volunteer.trim());
    renderLabels();
    draw();
  }

  function renderLabels() {
    const mine = S.labels.slice().sort((a, b) => a.start.localeCompare(b.start));
    const body = $('labels').querySelector('tbody');
    body.innerHTML = '';
    $('noLabels').classList.toggle('hidden', mine.length > 0);
    $('labelCount').textContent = mine.length
      ? mine.length + ' total, ' + mine.filter(l => l.date === S.date).length + ' on this day'
      : '';
    mine.forEach((l, i) => {
      const tr = document.createElement('tr');
      if (l.id === S.editing) tr.className = 'editing';
      const a = new Date(l.start), b = new Date(l.end);
      const cell = t => t.toISOString().slice(11, 19);
      tr.innerHTML =
        '<td>' + (i + 1) + '</td><td>' + l.date + '</td><td>' + cell(a) + '</td><td>' +
        cell(b) + '</td><td>' + dur((b - a) / 1000) + '</td>';
      const td = document.createElement('td');
      const ed = document.createElement('button');
      ed.className = 'ghost';
      ed.textContent = 'Edit';
      ed.onclick = () => startEdit(l);
      const rm = document.createElement('button');
      rm.className = 'danger';
      rm.textContent = 'Delete';
      rm.onclick = () => remove(l);
      td.append(ed, rm);
      tr.append(td);
      body.append(tr);
    });
    const done = S.done.includes(S.date);
    $('complete').disabled = done;
    $('doneInfo').textContent = done
      ? 'This day is marked complete.'
      : (S.done.length ? S.done.length + ' days completed.' : '');
  }

  async function startEdit(l) {
    if (l.date !== S.date) {
      const i = S.index.findIndex(d => d.date === l.date);
      if (i >= 0) await loadDay(i, true);
    }
    S.editing = l.id;
    S.sel = { start: secOf(l.start, S.date), end: secOf(l.end, S.date) };
    const a = Math.min(S.sel.start, S.sel.end), b = Math.max(S.sel.start, S.sel.end);
    const pad = Math.max(600, (b - a) * 2);
    S.view = { t0: clamp(a - pad, 0, 86400), t1: clamp(b + pad, 0, 86400) };
    renderSel();
    renderLabels();
    draw();
  }

  async function remove(l) {
    if (!confirm('Delete this label?\n\n' + l.date + '  ' +
      l.start.slice(11, 19) + ' → ' + l.end.slice(11, 19))) return;
    try {
      await Store.remove(l.id, S.volunteer.trim());
      if (S.editing === l.id) { S.editing = null; S.sel = { start: null, end: null }; }
      await refresh();
      renderSel();
    } catch (err) { alert('Could not delete the label. Please try again.'); }
  }

  async function commit(startSec, endSec, source) {
    const v = who();
    S.volunteer = v;
    if (!v) { $('whoWarn').classList.remove('hidden'); return false; }
    const a = Math.min(startSec, endSec), b = Math.max(startSec, endSec);
    if (!(b > a)) { alert('Start time must be before end time.'); return false; }

    const dupe = S.labels.some(l => l.id !== S.editing && l.date === S.date &&
      Math.abs(secOf(l.start, S.date) - a) < 1 && Math.abs(secOf(l.end, S.date) - b) < 1);
    if (dupe && !confirm('You already saved an identical interval. Save it again?')) return false;

    try {
      if (S.editing) await Store.update(S.editing, v, S.date, a, b);
      else await Store.save(v, S.date, a, b, source);
      S.editing = null;
      S.sel = { start: null, end: null };   // spec section 12: reset after save
      await refresh();
      renderSel();
      return true;
    } catch (err) {
      alert('Unable to save label. Please try again.');
      return false;
    }
  }

  /* ------------------------------------------------------------------- wire */

  function init() {
    buildPanels();

    // `input` fires on every keystroke, so the Save button enables as soon as a name
    // is typed. `change` additionally reloads that volunteer's existing labels.
    $('who').addEventListener('input', () => {
      S.volunteer = who();
      localStorage.setItem('saa.who', S.volunteer);
      renderSel();
    });
    $('who').addEventListener('change', () => {
      S.volunteer = who();
      localStorage.setItem('saa.who', S.volunteer);
      refresh();
      renderSel();
    });
    S.volunteer = localStorage.getItem('saa.who') || '';
    $('who').value = S.volunteer;

    $('prev').onclick = () => loadDay(S.dayIdx - 1);
    $('next').onclick = () => loadDay(S.dayIdx + 1);
    $('jump').onchange = e => loadDay(+e.target.value);
    $('reset').onclick = () => { S.view = { t0: 0, t1: 86400 }; draw(); };
    $('logY').onchange = e => { S.log = e.target.checked; draw(); };

    $('save').onclick = () => commit(S.sel.start, S.sel.end, 'click');
    $('clear').onclick = () => {
      S.sel = { start: null, end: null };
      S.editing = null;
      renderSel();
      renderLabels();
      draw();
    };

    $('mSave').onclick = () => {
      const re = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
      const A = $('mStart').value.trim(), B = $('mEnd').value.trim();
      const ma = re.exec(A), mb = re.exec(B);
      if (!ma || !mb) {
        $('mErr').textContent = 'Please enter a valid time in HH:MM:SS format.';
        return;
      }
      const toS = m => +m[1] * 3600 + +m[2] * 60 + +m[3];
      const a = toS(ma), b = toS(mb);
      if (a >= b) { $('mErr').textContent = 'Start time must be before end time.'; return; }
      $('mErr').textContent = '';
      // the date of the day being viewed is supplied automatically -- spec section 19
      commit(a, b, 'manual').then(ok => {
        if (ok) { $('mStart').value = ''; $('mEnd').value = ''; }
      });
    };

    $('complete').onclick = async () => {
      const v = S.volunteer.trim();
      if (!v) { $('whoWarn').classList.remove('hidden'); return; }
      const n = S.labels.filter(l => l.date === S.date).length;
      if (!confirm('Mark ' + S.date + ' complete with ' + n + ' label' +
        (n === 1 ? '' : 's') + '?')) return;
      await Store.complete(v, S.date);
      await refresh();
    };

    $('download').onclick = () => {
      const rows = [['annotator', 'date', 'start', 'end', 'label', 'source']];
      for (const l of S.labels.slice().sort((a, b) => a.start.localeCompare(b.start))) {
        rows.push([l.volunteer, l.date, l.start, l.end, l.label || 'SAA', l.source || '']);
      }
      const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'saa_labels_' + (S.volunteer.trim() || 'anon') + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    };

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') { $('clear').click(); }
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft' && !$('prev').disabled) loadDay(S.dayIdx - 1);
      if (e.key === 'ArrowRight' && !$('next').disabled) loadDay(S.dayIdx + 1);
    });
    window.addEventListener('resize', draw);
    window.addEventListener('beforeunload', e => {
      if (S.sel.start != null && S.sel.end != null) { e.preventDefault(); e.returnValue = ''; }
    });

    $('storeState').textContent = Store.isLocal
      ? '⚠ ' + Store.backend.warning
      : 'Saving to the shared database.';
    $('storeState').className = Store.isLocal ? 'warn' : 'muted';

    // test hook: lets the workflow be driven headlessly, where a real pointer and
    // screenshots are not available
    window.__saa = { S, draw, click, commit, loadDay, refresh, renderSel };

    loadIndex().then(() => loadDay(0, true)).then(refresh);
  }

  init();
})();
