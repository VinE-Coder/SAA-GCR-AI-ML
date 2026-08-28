/* Persistence layer.
 *
 * Two interchangeable backends behind one interface, so the UI never knows which
 * is in use and swapping local -> production is a one-line config change:
 *
 *   LocalBackend  localStorage. Development and offline fallback ONLY.
 *   ApiBackend    Cloudflare Worker + D1. Production.
 *
 * v1's fatal flaw was st.session_state as the only store, so every label lived or
 * died with the browser tab. Every mutation here is awaited and confirmed before
 * the UI reports success -- nothing is ever "saved" only in memory.
 *
 * Labels are stored as ABSOLUTE UTC instants, never day-relative, so a pass that
 * crosses 00:00 UTC is one interval rather than two halves. Nine such passes exist
 * in the current dataset.
 */
const Store = (() => {
  const KEY = 'saa.labels.v1';
  const DONE = 'saa.completed.v1';

  const iso = (date, secs) => {
    const base = Date.parse(date + 'T00:00:00Z');
    return new Date(base + Math.round(secs * 1000)).toISOString().replace('.000Z', 'Z');
  };

  const LocalBackend = {
    name: 'local',
    warning: 'Your labels are saved in this browser and will still be here if you ' +
             'close the tab or reload. They are NOT sent anywhere — click ' +
             '"Download my labels (CSV)" when you finish and send the file to Vineeth.',
    _read(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } },
    _write(k, v) { localStorage.setItem(k, JSON.stringify(v)); },

    async list(volunteer) {
      return this._read(KEY).filter(r => r.volunteer === volunteer && !r.deleted_at);
    },
    async save(rec) {
      const all = this._read(KEY);
      const row = Object.assign({}, rec, {
        id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        created_at: new Date().toISOString()
      });
      all.push(row);
      this._write(KEY, all);
      return row;
    },
    async update(id, volunteer, patch) {
      const all = this._read(KEY);
      const row = all.find(r => r.id === id && r.volunteer === volunteer);
      if (!row) throw new Error('not found');
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      this._write(KEY, all);
      return row;
    },
    async remove(id, volunteer) {
      const all = this._read(KEY);
      const row = all.find(r => r.id === id && r.volunteer === volunteer);
      if (!row) throw new Error('not found');
      // soft delete: a withdrawn label is data about annotation behaviour and the
      // agreement study needs the audit trail
      row.deleted_at = new Date().toISOString();
      this._write(KEY, all);
    },
    async complete(volunteer, date) {
      const all = this._read(DONE);
      if (!all.some(r => r.volunteer === volunteer && r.date === date)) {
        all.push({ volunteer, date, completed_at: new Date().toISOString() });
        this._write(DONE, all);
      }
    },
    async completed(volunteer) {
      return this._read(DONE).filter(r => r.volunteer === volunteer).map(r => r.date);
    }
  };

  function ApiBackend(base, token) {
    const call = async (path, opts) => {
      const r = await fetch(base + path, Object.assign({
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + token
        }
      }, opts));
      if (!r.ok) throw new Error((await r.text()) || ('HTTP ' + r.status));
      return r.status === 204 ? null : r.json();
    };
    return {
      name: 'api',
      warning: null,
      // the server derives the volunteer from the token and ignores any id the
      // browser sends -- spec section 35
      list: () => call('/labels'),
      save: rec => call('/labels', { method: 'POST', body: JSON.stringify(rec) }),
      update: (id, _v, patch) =>
        call('/labels/' + id, { method: 'PATCH', body: JSON.stringify(patch) }),
      remove: id => call('/labels/' + id, { method: 'DELETE' }),
      complete: (_v, date) =>
        call('/complete', { method: 'POST', body: JSON.stringify({ date }) }),
      completed: () => call('/complete')
    };
  }

  // token arrives as ?t=... from the volunteer's invite link
  const params = new URLSearchParams(location.search);
  const token = params.get('t');
  const backend = (window.SAA_API && token)
    ? ApiBackend(window.SAA_API, token)
    : LocalBackend;

  return {
    backend,
    iso,
    isLocal: backend.name === 'local',
    list: v => backend.list(v),
    save: (volunteer, date, startSec, endSec, source) => backend.save({
      volunteer, date,
      start: iso(date, startSec),
      end: iso(date, endSec),
      label: 'SAA',
      source: source || 'click'
    }),
    update: (id, volunteer, date, startSec, endSec) => backend.update(id, volunteer, {
      start: iso(date, startSec),
      end: iso(date, endSec)
    }),
    remove: (id, v) => backend.remove(id, v),
    complete: (v, d) => backend.complete(v, d),
    completed: v => backend.completed(v)
  };
})();
