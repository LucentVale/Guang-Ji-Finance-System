// Halaman Data, tab "Kategori": daftar kategori setahun (jumlah & total), ganti nama atau gabungkan kategori.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money } from '../core/format.js';
import { attempt, openModal, toast } from '../components/feedback.js';
import { debounce, SEARCH_DELAY_MS } from '../components/controls.js';

// Kategori yang dipakai sistem (laporan donatur, baris otomatis bank): tidak bisa diganti, tapi boleh jadi tujuan.
const FIXED = new Set(['DONATUR', 'BUNGA BANK', 'PAJAK BUNGA', 'BIAYA ADM']);
const round = (x) => Math.round(x * 100) / 100;
/** Kunci kemiripan: tanpa spasi & tanda baca, jadi "PELITA" dan "PELITA." dianggap mirip. */
const looseKey = (c) => c.replace(/[^A-Z0-9]/g, '');

function groupCategories(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.source === 'pindahan') continue;
    if (!groups.has(r.category)) groups.set(r.category, { name: r.category, count: 0, masuk: 0, keluar: 0, pos: new Map() });
    const g = groups.get(r.category);
    g.count++;
    g.masuk += r.masuk;
    g.keluar += r.keluar;
    const pos = r.pos || 'tanpa pos';
    g.pos.set(pos, (g.pos.get(pos) || 0) + 1);
  }
  const list = [...groups.values()].map((g) => ({
    ...g,
    masuk: round(g.masuk),
    keluar: round(g.keluar),
    pos: [...g.pos.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p),
    fixed: FIXED.has(g.name),
  }));
  // Tandai kategori yang ejaannya mirip satu sama lain (kandidat digabungkan).
  const byLoose = new Map();
  for (const c of list) if (c.name) byLoose.set(looseKey(c.name), [...(byLoose.get(looseKey(c.name)) || []), c.name]);
  for (const c of list) c.similar = c.name ? byLoose.get(looseKey(c.name)).filter((n) => n !== c.name) : [];
  return list.sort((a, b) => b.count - a.count);
}

export async function kategoriTab(root, params) {
  const state = { q: params.get('q') || '' };
  const canWrite = store.can('write');
  const selected = new Set();
  let categories = [];

  render(root, html`
    <section class="panel">
      <div class="filter-bar data-filters" role="search">
        <input id="kQ" type="search" placeholder="Cari kategori…" value="${state.q}" aria-label="Cari kategori">
      </div>
      <p class="muted data-note">Kategori transaksi tahun ${store.year} (tanpa pindahan antar pos). Klik baris untuk melihat transaksinya.
        Ganti nama / gabungkan berlaku untuk semua tahun di Fothang ini.</p>
      <div class="toolbar data-summary" id="kSummary" aria-live="polite"></div>
      <div class="toolbar data-bulk" id="kBulk" data-write hidden></div>
      <div class="table-wrap flat"><table class="table data-table" id="kTable"></table></div>
    </section>`);

  async function load() {
    categories = groupCategories(await api.get('/transactions', { year: store.year }));
    selected.clear();
    draw();
  }

  const visible = () => {
    const q = state.q.toUpperCase();
    return categories.filter((c) => !q || c.name.includes(q));
  };

  function draw() {
    history.replaceState(null, '', `#/data?${new URLSearchParams({ tab: 'kategori', ...(state.q ? { q: state.q } : {}) })}`);
    const list = visible();
    const similar = categories.filter((c) => c.similar.length).length;
    render($('#kSummary', root), html`
      <span class="badge">${list.filter((c) => c.name).length} kategori</span>
      ${similar ? html`<span class="badge badge-warn">${similar} kategori ejaannya mirip</span>` : ''}`);
    drawBulk();
    render($('#kTable', root), html`
      <thead><tr>
        ${canWrite ? html`<th><span class="sr-only">Pilih</span></th>` : ''}
        <th>Kategori</th><th class="num">Transaksi</th><th class="num">Masuk</th><th class="num">Keluar</th><th>Pos terbanyak</th>
      </tr></thead>
      <tbody>${list.length ? list.map((c) => html`
        <tr class="${c.name ? 'clickable' : ''}" data-cat="${c.name}">
          ${canWrite ? html`<td data-stop>${c.name && !c.fixed
            ? html`<input type="checkbox" data-sel="${c.name}" ${selected.has(c.name) ? 'checked' : ''} aria-label="Pilih ${c.name}">` : ''}</td>` : ''}
          <td>${c.name || html`<span class="muted">(tanpa kategori)</span>`}
            ${c.fixed ? html` <span class="badge" title="Dipakai sistem, tidak bisa diganti namanya">sistem</span>` : ''}
            ${c.similar.length ? html` <span class="badge badge-warn" title="Mirip: ${c.similar.join(' · ')}">mirip ${c.similar.join(', ')}</span>` : ''}</td>
          <td class="num">${c.count}</td>
          <td class="num in">${c.masuk ? money(c.masuk) : ''}</td>
          <td class="num out">${c.keluar ? money(c.keluar) : ''}</td>
          <td>${c.pos.slice(0, 3).join(', ')}${c.pos.length > 3 ? html` <span class="muted">+${c.pos.length - 3}</span>` : ''}</td>
        </tr>`) : html`<tr><td colspan="6" class="empty">Tidak ada kategori yang cocok.</td></tr>`}
      </tbody>`);
  }

  function drawBulk() {
    const bar = $('#kBulk', root);
    bar.hidden = !selected.size;
    render(bar, selected.size ? html`
      <b>${selected.size} dipilih</b>
      <button type="button" class="btn-primary" id="renameBtn">${selected.size > 1 ? 'Gabungkan…' : 'Ganti nama…'}</button>
      <button type="button" class="btn-ghost" id="renameClear">Batal pilih</button>` : '');
  }

  const search = debounce((q) => { state.q = q; draw(); }, SEARCH_DELAY_MS);
  $('#kQ', root).addEventListener('input', (e) => search(e.target.value.trim()));

  const table = $('#kTable', root);
  on(table, 'click', 'tr[data-cat]', (e, tr) => {
    if (e.target.closest('[data-stop]') || !tr.dataset.cat) return;
    location.hash = `#/data?${new URLSearchParams({ tab: 'transaksi', category: tr.dataset.cat })}`;
  });
  on(table, 'change', '[data-sel]', (e, box) => {
    if (box.checked) selected.add(box.dataset.sel); else selected.delete(box.dataset.sel);
    drawBulk();
  });
  on(root, 'click', '#renameClear', () => { selected.clear(); draw(); });
  on(root, 'click', '#renameBtn', () => openRename(categories.filter((c) => selected.has(c.name)), categories, load));

  await load();
}

/** Ganti nama satu kategori, atau gabungkan beberapa kategori menjadi satu. */
function openRename(chosen, all, onDone) {
  const merging = chosen.length > 1;
  const count = chosen.reduce((n, c) => n + c.count, 0);
  const { root, close } = openModal({
    title: merging ? 'Gabungkan kategori' : `Ganti nama kategori ${chosen[0].name}`,
    body: html`
      <p>${merging
        ? `Pilih kategori yang dipakai. Sesudahnya ${count} transaksi di ${store.year} memakai kategori itu`
        : `${count} transaksi di ${store.year} akan memakai nama baru`}
        (tahun lain ikut diganti bila kategorinya persis sama).</p>
      <fieldset class="data-merge">
        <legend class="sr-only">Kategori tujuan</legend>
        ${merging ? chosen.map((c, i) => html`<label class="check"><input type="radio" name="target" value="${c.name}" ${i === 0 ? 'checked' : ''}>
          <span>${c.name} <span class="muted">(${c.count} transaksi)</span></span></label>`) : ''}
        ${merging ? html`<label class="check"><input type="radio" name="target" value="__custom"><span>Nama lain:</span></label>` : ''}
        <input id="customName" list="catList" aria-label="Nama kategori baru" placeholder="Tulis nama kategori" ${merging ? 'disabled' : ''}
          value="${merging ? '' : chosen[0].name}">
        <datalist id="catList">${all.filter((c) => c.name).map((c) => html`<option value="${c.name}"></option>`)}</datalist>
      </fieldset>
      <p class="muted">Kategori ditulis huruf besar. Bila namanya sama dengan kategori lain yang sudah ada, keduanya menjadi satu.
        Kata kunci pos di Pengaturan tidak ikut berubah, jadi impor berikutnya bisa memakai nama lama lagi.</p>`,
    footer: html`<button type="button" data-close>Batal</button><button type="button" class="btn-primary" id="renameOk">Simpan</button>`,
  });
  const custom = $('#customName', root);
  on(root, 'change', 'input[name="target"]', (e, radio) => {
    custom.disabled = radio.value !== '__custom';
    if (!custom.disabled) custom.focus();
  });
  $('#renameOk', root).addEventListener('click', async () => {
    const picked = $('input[name="target"]:checked', root)?.value ?? '__custom';
    const to = (picked === '__custom' ? custom.value : picked).trim().toUpperCase();
    if (!to) return custom.focus();
    let updated = 0;
    const ok = await attempt(async () => {
      ({ updated } = await api.post('/categories/rename', { from: chosen.map((c) => c.name), to }));
    });
    if (ok) {
      close();
      await onDone();
      toast(`${updated} transaksi dipindah ke kategori ${to}`);
    }
  });
}
