// Halaman Data, tab "Semua transaksi": semua transaksi setahun dengan cari & saringan,
// total mengikuti saringan, tambah / ubah transaksi, pindahan antar pos, ganti pos banyak baris sekaligus,
// dan ekspor Excel sesuai saringan.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, dateShort, todayIso } from '../core/format.js';
import { attempt } from '../components/feedback.js';
import { posOptions, monthOptions } from '../components/options.js';
import { segmented, bindSegmented, debounce, SEARCH_DELAY_MS } from '../components/controls.js';
import { openTransactionForm, openTransactionDetail, openTransferForm } from '../components/transactionForms.js';

const SOURCES = { mutasi: 'Mutasi bank', draf: 'File DRAF', manual: 'Input manual', pindahan: 'Pindahan' };
// Saringan yang disimpan di alamat halaman (supaya tetap sama sesudah memuat ulang).
const FILTER_KEYS = ['q', 'pos_id', 'category', 'source', 'month', 'date_from', 'date_to', 'type'];
// Tabel panjang digambar bertahap supaya halaman tetap ringan.
const PAGE_ROWS = 300;

const round = (x) => Math.round(x * 100) / 100;
const sum = (rows, field) => round(rows.reduce((t, r) => t + r[field], 0));

/** Tanggal awal transaksi baru: hari ini bila masuk saringan bulan/tahun, selain itu tanggal 1 bulan terpilih (atau 1 Januari). */
function newDate(month) {
  const today = todayIso();
  const prefix = month ? `${store.year}-${String(month).padStart(2, '0')}` : String(store.year);
  return today.startsWith(prefix) ? today : `${store.year}-${String(month || 1).padStart(2, '0')}-01`;
}

export async function transaksiTab(root, params) {
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) || '']));
  const categories = await api.get('/categories').catch(() => []);
  const canWrite = store.can('write');
  let rows = [];
  let shown = PAGE_ROWS;
  const selected = new Set();

  render(root, html`
    <section class="panel data-tx">
      <div class="filter-bar data-filters" role="search">
        <input id="fQ" type="search" placeholder="Cari nama, kategori, kode mutasi, catatan…" value="${filters.q}" aria-label="Cari transaksi">
        <select id="fPos" aria-label="Pos">
          <option value="">Semua pos</option>
          <option value="none" ${filters.pos_id === 'none' ? 'selected' : ''}>Belum punya pos</option>
          ${posOptions(filters.pos_id)}
        </select>
        <select id="fCategory" aria-label="Kategori">
          <option value="">Semua kategori</option>
          ${categories.map((c) => html`<option ${c === filters.category ? 'selected' : ''}>${c}</option>`)}
        </select>
        <select id="fSource" aria-label="Sumber">
          <option value="">Semua sumber</option>
          ${Object.entries(SOURCES).map(([v, l]) => html`<option value="${v}" ${v === filters.source ? 'selected' : ''}>${l}</option>`)}
        </select>
        <select id="fMonth" aria-label="Bulan">${monthOptions(filters.month, { empty: `Setahun ${store.year}` })}</select>
        <label class="inline">Dari<input id="fFrom" type="date" value="${filters.date_from}" min="${store.year}-01-01" max="${store.year}-12-31"></label>
        <label class="inline">s.d.<input id="fTo" type="date" value="${filters.date_to}" min="${store.year}-01-01" max="${store.year}-12-31"></label>
        ${segmented({ name: 'type', label: 'Jenis transaksi', current: filters.type,
          options: [{ value: '', label: 'Semua' }, { value: 'in', label: 'Masuk' }, { value: 'out', label: 'Keluar' }] })}
        <button type="button" class="btn-ghost" id="fReset">Hapus saringan</button>
      </div>
      <div class="toolbar toolbar-between data-summary" id="txSummary" aria-live="polite"></div>
      <div class="toolbar data-bulk" id="txBulk" data-write hidden></div>
      <div class="table-wrap flat"><table class="table data-table" id="txTable"></table></div>
      <div class="toolbar toolbar-center" id="txMore"></div>
    </section>`);

  const query = () => ({ year: store.year, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });

  /** Simpan saringan di alamat tanpa memuat ulang halaman. */
  function remember() {
    const q = new URLSearchParams({ tab: 'transaksi', ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    history.replaceState(null, '', `#/data?${q}`);
  }

  async function load() {
    remember();
    rows = await api.get('/transactions', query());
    shown = PAGE_ROWS;
    selected.clear();
    draw();
  }

  function drawSummary() {
    const masuk = sum(rows, 'masuk');
    const keluar = sum(rows, 'keluar');
    render($('#txSummary', root), html`
      <div class="toolbar">
        <span class="badge">${rows.length} transaksi</span>
        <span class="badge badge-ok">Masuk Rp ${money(masuk)}</span>
        <span class="badge badge-red">Keluar Rp ${money(keluar)}</span>
        <span class="badge">Selisih Rp ${money(round(masuk - keluar))}</span>
      </div>
      <div class="toolbar">
        <button type="button" class="btn-primary" id="txAdd" data-write>+ Transaksi</button>
        <button type="button" id="txTransfer" data-write>⇄ Pindahan Pos</button>
        <a class="btn" href="${api.downloadUrl('/export/transaksi.xlsx', query())}" title="Daftar transaksi sesuai saringan yang aktif">⭳ Excel</a>
      </div>`);
  }

  function drawBulk() {
    const bar = $('#txBulk', root);
    bar.hidden = !selected.size;
    if (!selected.size) return render(bar, '');
    render(bar, html`
      <b>${selected.size} dipilih</b>
      <label class="inline">Ganti pos ke<select id="bulkPos">${posOptions('', { empty: '— pilih pos —' })}</select></label>
      <button type="button" class="btn-primary" id="bulkApply">Terapkan</button>
      <button type="button" class="btn-ghost" id="bulkClear">Batal pilih</button>`);
  }

  function drawTable() {
    const visible = rows.slice(0, shown);
    const selectable = visible.filter((r) => r.source !== 'pindahan');
    const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
    render($('#txTable', root), html`
      <thead><tr>
        ${canWrite ? html`<th><input type="checkbox" id="selAll" aria-label="Pilih semua baris yang tampil" ${allOn ? 'checked' : ''}></th>` : ''}
        <th>Tgl</th><th>Akun</th><th>Pos</th><th>Kategori</th><th>Nama / Uraian</th><th class="num">Masuk</th><th class="num">Keluar</th><th>Sumber</th>
        ${canWrite ? html`<th><span class="sr-only">Ubah</span></th>` : ''}
      </tr></thead>
      <tbody>${visible.length ? visible.map((r) => html`
        <tr class="clickable ${r.pos_id ? '' : 'row-warn'}" data-id="${r.id}">
          ${canWrite ? html`<td data-stop>${r.source === 'pindahan' ? ''
            : html`<input type="checkbox" data-sel="${r.id}" ${selected.has(r.id) ? 'checked' : ''} aria-label="Pilih ${dateShort(r.date)} ${r.name}">`}</td>` : ''}
          <td class="nowrap">${dateShort(r.date)}</td>
          <td>${r.account}</td>
          <td>${r.pos || html`<span class="badge badge-warn">tanpa pos</span>`}</td>
          <td>${r.category}</td>
          <td>${r.name}${r.split_of ? html` <span class="badge">pecahan</span>` : ''}</td>
          <td class="num in">${r.masuk ? money(r.masuk) : ''}</td>
          <td class="num out">${r.keluar ? money(r.keluar) : ''}</td>
          <td class="muted nowrap">${SOURCES[r.source] || r.source}</td>
          ${canWrite ? html`<td data-stop><button type="button" class="btn-ghost btn-small nowrap" data-edit="${r.id}"
            aria-label="${r.source === 'pindahan' ? 'Buka' : 'Ubah'} ${dateShort(r.date)} ${r.name}">${r.source === 'pindahan' ? 'Buka' : '✎ Ubah'}</button></td>` : ''}
        </tr>`) : html`<tr><td colspan="10" class="empty">Tidak ada transaksi yang cocok dengan saringan.</td></tr>`}
      </tbody>`);
    render($('#txMore', root), rows.length > shown
      ? html`<button type="button" id="showMore">Tampilkan ${Math.min(PAGE_ROWS, rows.length - shown)} lagi (${rows.length - shown} tersisa)</button>` : '');
  }

  function draw() { drawSummary(); drawBulk(); drawTable(); }

  // ---- saringan
  const set = (key, value) => { filters[key] = value; load(); };
  const search = debounce((q) => set('q', q), SEARCH_DELAY_MS);
  $('#fQ', root).addEventListener('input', (e) => search(e.target.value.trim()));
  for (const [id, key] of [['#fPos', 'pos_id'], ['#fCategory', 'category'], ['#fSource', 'source'], ['#fMonth', 'month'], ['#fFrom', 'date_from'], ['#fTo', 'date_to']]) {
    $(id, root).addEventListener('change', (e) => set(key, e.target.value));
  }
  bindSegmented(root, 'type', (value) => set('type', value));
  $('#fReset', root).addEventListener('click', () => {
    location.hash = `#/data?tab=transaksi&r=${Date.now()}`; // muat ulang tab tanpa saringan
  });

  // ---- tabel
  const table = $('#txTable', root);
  on(table, 'click', 'tr[data-id]', (e, tr) => {
    if (e.target.closest('[data-stop]')) return;
    const tx = rows.find((r) => r.id === Number(tr.dataset.id));
    if (canWrite) openTransactionForm(tx, { onSaved: load }); else openTransactionDetail(tx);
  });
  on(table, 'click', '[data-edit]', (e, btn) => openTransactionForm(rows.find((r) => r.id === Number(btn.dataset.edit)), { onSaved: load }));
  on(table, 'change', '[data-sel]', (e, box) => {
    if (box.checked) selected.add(Number(box.dataset.sel)); else selected.delete(Number(box.dataset.sel));
    drawBulk();
    const selAll = $('#selAll', table);
    if (selAll) selAll.checked = rows.slice(0, shown).filter((r) => r.source !== 'pindahan').every((r) => selected.has(r.id));
  });
  on(table, 'change', '#selAll', (e, box) => {
    for (const r of rows.slice(0, shown)) if (r.source !== 'pindahan') { if (box.checked) selected.add(r.id); else selected.delete(r.id); }
    drawBulk();
    drawTable();
  });
  on(root, 'click', '#showMore', () => { shown += PAGE_ROWS; drawTable(); });

  // ---- tambah transaksi / pindahan antar pos
  on(root, 'click', '#txAdd', () => openTransactionForm(null, {
    posId: filters.pos_id && filters.pos_id !== 'none' ? Number(filters.pos_id) : undefined,
    defaults: { date: newDate(filters.month) },
    onSaved: load,
  }));
  on(root, 'click', '#txTransfer', () => openTransferForm({
    fromPosId: filters.pos_id && filters.pos_id !== 'none' ? Number(filters.pos_id) : undefined,
    onSaved: load,
  }));

  // ---- ganti pos banyak baris
  on(root, 'click', '#bulkClear', () => { selected.clear(); drawBulk(); drawTable(); });
  on(root, 'click', '#bulkApply', async () => {
    const posId = $('#bulkPos', root).value;
    if (!posId) return $('#bulkPos', root).focus();
    const pos = store.posById(posId);
    const n = selected.size;
    if (await attempt(() => api.post('/transactions/assign-pos', { ids: [...selected], pos_id: Number(posId) }), `${n} transaksi dipindah ke pos ${pos?.code ?? ''}`)) load();
  });

  await load();
}
