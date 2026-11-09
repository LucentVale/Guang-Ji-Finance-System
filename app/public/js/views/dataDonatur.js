// Halaman Data, tab "Donatur": daftar pemberi dana setahun (dari semua transaksi MASUK),
// riwayat per nama, dan penggabungan ejaan nama yang sebenarnya orang yang sama.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, dateShort } from '../core/format.js';
import { attempt, openModal, toast } from '../components/feedback.js';
import { debounce, SEARCH_DELAY_MS } from '../components/controls.js';

// Baris otomatis bank bukan donatur.
const SYSTEM_CATEGORIES = new Set(['BUNGA BANK', 'PAJAK BUNGA', 'BIAYA ADM']);
const SORTS = {
  total: { label: 'Total terbesar', compare: (a, b) => b.total - a.total },
  count: { label: 'Paling sering', compare: (a, b) => b.count - a.count || b.total - a.total },
  last: { label: 'Terakhir menyumbang', compare: (a, b) => b.last.localeCompare(a.last) },
  name: { label: 'Nama A–Z', compare: (a, b) => a.name.localeCompare(b.name, 'id') },
};
const SOURCES = { mutasi: 'Mutasi bank', draf: 'File DRAF', manual: 'Input manual' };

const round = (x) => Math.round(x * 100) / 100;
/** Kunci pengelompokan: huruf besar & spasi dirapikan, jadi "Huang Fa Yen" dan "HUANG FA YEN" satu donatur. */
const keyOf = (name) => name.toUpperCase().replace(/\s+/g, ' ').trim();

/** Kelompokkan transaksi masuk per donatur. Nama tampilan = ejaan yang paling sering dipakai. */
function groupDonors(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.source === 'pindahan' || !r.name || SYSTEM_CATEGORIES.has(r.category)) continue;
    const key = keyOf(r.name);
    if (!groups.has(key)) groups.set(key, { key, rows: [], spellings: new Map() });
    const g = groups.get(key);
    g.rows.push(r);
    g.spellings.set(r.name, (g.spellings.get(r.name) || 0) + 1);
  }
  return [...groups.values()].map((g) => {
    const spellings = [...g.spellings.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    return {
      key: g.key,
      name: spellings[0],
      spellings,
      rows: g.rows,
      count: g.rows.length,
      total: round(g.rows.reduce((t, r) => t + r.masuk, 0)),
      pos: [...new Set(g.rows.map((r) => r.pos || 'tanpa pos'))],
      last: g.rows.reduce((m, r) => (r.date > m ? r.date : m), ''),
    };
  });
}

export async function donaturTab(root, params) {
  const state = { q: params.get('q') || '', sort: SORTS[params.get('sort')] ? params.get('sort') : 'total' };
  const canWrite = store.can('write');
  const selected = new Set(); // kunci donatur
  let donors = [];

  render(root, html`
    <section class="panel">
      <div class="filter-bar data-filters" role="search">
        <input id="dQ" type="search" placeholder="Cari nama donatur…" value="${state.q}" aria-label="Cari donatur">
        <label class="inline">Urutkan<select id="dSort">
          ${Object.entries(SORTS).map(([v, s]) => html`<option value="${v}" ${v === state.sort ? 'selected' : ''}>${s.label}</option>`)}
        </select></label>
      </div>
      <p class="muted data-note">Dari semua transaksi <b>masuk</b> tahun ${store.year} (tanpa pindahan antar pos dan baris otomatis bank).
        Nama dengan huruf besar/kecil atau spasi berbeda dihitung satu donatur.</p>
      <div class="toolbar data-summary" id="dSummary" aria-live="polite"></div>
      <div class="toolbar data-bulk" id="dBulk" data-write hidden></div>
      <div class="table-wrap flat"><table class="table data-table" id="dTable"></table></div>
    </section>`);

  function remember() {
    const q = new URLSearchParams({ tab: 'donatur', ...(state.q ? { q: state.q } : {}), ...(state.sort !== 'total' ? { sort: state.sort } : {}) });
    history.replaceState(null, '', `#/data?${q}`);
  }

  async function load() {
    donors = groupDonors(await api.get('/transactions', { year: store.year, type: 'in' }));
    selected.clear();
    draw();
  }

  const visible = () => {
    const q = keyOf(state.q);
    return donors.filter((d) => !q || d.key.includes(q)).sort(SORTS[state.sort].compare);
  };

  function draw() {
    remember();
    const list = visible();
    render($('#dSummary', root), html`
      <span class="badge">${list.length} donatur</span>
      <span class="badge">${list.reduce((n, d) => n + d.count, 0)} transaksi</span>
      <span class="badge badge-ok">Total Rp ${money(round(list.reduce((t, d) => t + d.total, 0)))}</span>`);
    drawBulk();
    render($('#dTable', root), html`
      <thead><tr>
        ${canWrite ? html`<th><span class="sr-only">Pilih</span></th>` : ''}
        <th>Nama</th><th class="num">Kali</th><th class="num">Total</th><th>Pos</th><th>Terakhir</th>
      </tr></thead>
      <tbody>${list.length ? list.map((d) => html`
        <tr class="clickable" data-key="${d.key}">
          ${canWrite ? html`<td data-stop><input type="checkbox" data-sel="${d.key}" ${selected.has(d.key) ? 'checked' : ''} aria-label="Pilih ${d.name}"></td>` : ''}
          <td>${d.name}${d.spellings.length > 1 ? html` <span class="badge badge-warn" title="${d.spellings.join(' · ')}">${d.spellings.length} ejaan</span>` : ''}</td>
          <td class="num">${d.count}</td>
          <td class="num in">${money(d.total)}</td>
          <td>${d.pos.join(', ')}</td>
          <td class="nowrap">${dateShort(d.last)}</td>
        </tr>`) : html`<tr><td colspan="6" class="empty">${donors.length ? 'Tidak ada donatur yang cocok.' : `Belum ada transaksi masuk di ${store.year}.`}</td></tr>`}
      </tbody>`);
  }

  /** Bilah gabungkan: muncul bila yang dipilih punya lebih dari satu ejaan nama. */
  function drawBulk() {
    const bar = $('#dBulk', root);
    const chosen = donors.filter((d) => selected.has(d.key));
    const spellings = chosen.flatMap((d) => d.spellings);
    bar.hidden = !chosen.length;
    render(bar, chosen.length ? html`
      <b>${chosen.length} dipilih</b>
      <button type="button" class="btn-primary" id="mergeBtn" ${spellings.length > 1 ? '' : 'disabled'}>Gabungkan nama…</button>
      <button type="button" class="btn-ghost" id="mergeClear">Batal pilih</button>
      ${spellings.length > 1 ? '' : html`<span class="muted">Pilih minimal dua nama, atau satu nama yang punya beberapa ejaan.</span>`}` : '');
  }

  const search = debounce((q) => { state.q = q; draw(); }, SEARCH_DELAY_MS);
  $('#dQ', root).addEventListener('input', (e) => search(e.target.value.trim()));
  $('#dSort', root).addEventListener('change', (e) => { state.sort = e.target.value; draw(); });

  const table = $('#dTable', root);
  on(table, 'click', 'tr[data-key]', (e, tr) => {
    if (e.target.closest('[data-stop]')) return;
    openHistory(donors.find((d) => d.key === tr.dataset.key));
  });
  on(table, 'change', '[data-sel]', (e, box) => {
    if (box.checked) selected.add(box.dataset.sel); else selected.delete(box.dataset.sel);
    drawBulk();
  });
  on(root, 'click', '#mergeClear', () => { selected.clear(); draw(); });
  on(root, 'click', '#mergeBtn', () => openMerge(donors.filter((d) => selected.has(d.key)), load));

  await load();
}

/** Riwayat sumbangan satu donatur. */
function openHistory(d) {
  const rows = [...d.rows].sort((a, b) => b.date.localeCompare(a.date));
  openModal({
    title: d.name,
    wide: true,
    body: html`
      <div class="toolbar mb-3">
        <span class="badge">${d.count} kali</span>
        <span class="badge badge-ok">Total Rp ${money(d.total)}</span>
        ${d.spellings.length > 1 ? html`<span class="badge badge-warn">Ejaan: ${d.spellings.join(' · ')}</span>` : ''}
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Tgl</th><th>Pos</th><th>Kategori</th><th>Nama tersimpan</th><th class="num">Nominal</th><th>Sumber</th></tr></thead>
        <tbody>${rows.map((r) => html`<tr>
          <td class="nowrap">${dateShort(r.date)}</td><td>${r.pos || 'tanpa pos'}</td><td>${r.category}</td><td>${r.name}</td>
          <td class="num in">${money(r.masuk)}</td><td class="muted nowrap">${SOURCES[r.source] || r.source}</td></tr>`)}
        </tbody>
      </table></div>`,
    footer: html`<div></div><button type="button" data-close>Tutup</button>`,
  });
}

/** Gabungkan semua ejaan dari donatur yang dipilih menjadi satu nama. */
function openMerge(chosen, onDone) {
  const spellings = chosen.flatMap((d) => d.spellings);
  const counts = new Map(chosen.flatMap((d) => d.spellings.map((s) => [s, d.rows.filter((r) => r.name === s).length])));
  const rowsThisYear = chosen.reduce((n, d) => n + d.count, 0);
  const { root, close } = openModal({
    title: 'Gabungkan nama donatur',
    body: html`
      <p>Pilih nama yang dipakai. Semua transaksi masuk dengan nama di bawah ini akan diganti ke nama tersebut
        (${rowsThisYear} transaksi di ${store.year}; tahun lain ikut diganti bila namanya persis sama).</p>
      <fieldset class="data-merge">
        <legend class="sr-only">Nama yang dipakai</legend>
        ${spellings.map((s, i) => html`<label class="check"><input type="radio" name="target" value="${s}" ${i === 0 ? 'checked' : ''}>
          <span>${s} <span class="muted">(${counts.get(s)} transaksi)</span></span></label>`)}
        <label class="check"><input type="radio" name="target" value="__custom"><span>Nama lain:</span></label>
        <input id="customName" aria-label="Nama lain" placeholder="Tulis nama yang benar" disabled>
      </fieldset>
      <p class="muted">Pengeluaran dan pindahan antar pos tidak berubah. Perubahan tercatat di Riwayat.</p>`,
    footer: html`<button type="button" data-close>Batal</button><button type="button" class="btn-primary" id="mergeOk">Gabungkan</button>`,
  });
  const custom = $('#customName', root);
  on(root, 'change', 'input[name="target"]', (e, radio) => {
    custom.disabled = radio.value !== '__custom';
    if (!custom.disabled) custom.focus();
  });
  $('#mergeOk', root).addEventListener('click', async () => {
    const picked = $('input[name="target"]:checked', root).value;
    const to = picked === '__custom' ? custom.value.trim() : picked;
    if (!to) return custom.focus();
    let updated = 0;
    const ok = await attempt(async () => {
      ({ updated } = await api.post('/donors/rename', { from: spellings, to }));
    });
    if (ok) {
      close();
      await onDone();
      toast(`${updated} transaksi diganti ke "${to}"`);
    }
  });
}
