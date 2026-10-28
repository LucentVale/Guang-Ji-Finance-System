// Langkah 3 — Laporan Keuangan Tahunan, tampil seperti file Excel "Laporan Keuangan Kuang Hang Tahun 2026":
// tab sheet di bawah (Tabel, Barang, 1 CU THAN, 2 KFCC, ...), tiap sheet berisi transaksi pos per bulan
// dengan kolom Masuk / Keluar / Saldo untuk setiap akun (BCA, Kas Kecil).
import { $, $$, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, dayOf, dateId, MONTHS } from '../core/format.js';
import { openModal, attempt } from '../components/feedback.js';
import { openTransactionForm, openTransferForm } from '../components/transactionForms.js';

const SHEET_TABEL = 'tabel';
const SHEET_BARANG = 'barang';

export async function workbookView(main, params) {
  const sheet = params.get('sheet') || SHEET_TABEL;
  const fothang = store.fothang;

  render(main, html`
    <section class="workbook">
      <div class="workbook-toolbar">
        <span class="title">Laporan Keuangan ${fothang.name} Tahun ${store.year}</span>
        <span id="sheetActions" class="toolbar"></span>
        <a class="btn" href="${api.downloadUrl('/export/tahunan.xlsx', { year: store.year })}">⭳ Excel Tahunan</a>
      </div>
      <div class="sheet-scroll" id="sheetBody"><div class="empty">Memuat…</div></div>
      <nav class="sheet-tabs" aria-label="Sheet">
        <button data-sheet="${SHEET_TABEL}">Tabel</button>
        <button data-sheet="${SHEET_BARANG}">Barang</button>
        ${store.pos.map((p) => html`<button data-sheet="${p.id}">${p.number} ${p.code}</button>`)}
      </nav>
    </section>`);

  $$('.sheet-tabs button', main).forEach((b) => {
    b.classList.toggle('active', b.dataset.sheet === sheet);
    b.addEventListener('click', () => (location.hash = `#/tahunan?sheet=${b.dataset.sheet}`));
  });
  $('.sheet-tabs button.active', main)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  const body = $('#sheetBody', main);
  const actions = $('#sheetActions', main);
  const reload = () => workbookView(main, params);
  if (sheet === SHEET_TABEL) await renderTabel(body);
  else if (sheet === SHEET_BARANG) await renderBarang(body, actions, reload);
  else await renderPosSheet(body, actions, Number(sheet), reload);
}

/** Kepala sheet: nama Fothang + judul, seperti baris 1-2 di Excel. */
const sheetTitle = (subtitle) => html`
  <div class="sheet-heading"><div class="big">${store.fothang.name.toUpperCase()}</div><div>${subtitle}</div></div>`;

// ---------------------------------------------------------------- Sheet Tabel (rekap saldo)

async function renderTabel(body) {
  const t = await api.get('/tabel', { year: store.year });
  const accounts = t.accounts;
  const colspan = 3 + accounts.length;
  const hasUnallocated = accounts.some((a) => a.unallocated);

  render(body, html`
    ${sheetTitle(`Rekap Saldo per Pos ${store.year}`)}
    <table class="sheet" style="min-width:0">
      <thead><tr><th style="width:50px">No</th><th>Keterangan Laporan</th>${accounts.map((a) => html`<th>${a.name}</th>`)}<th>Total</th></tr></thead>
      <tbody>
        ${t.rows.map((r) => html`
          <tr class="clickable" data-pos="${r.pos_id}">
            <td class="day">${r.number}</td><td>${r.name} (${r.code})${r.active ? '' : html` <span class="badge">nonaktif</span>`}</td>
            ${accounts.map((a) => html`<td class="${numClass(r.saldo[a.account_id])}">${money(r.saldo[a.account_id])}</td>`)}
            <td class="${numClass(r.total)}"><b>${money(r.total)}</b></td>
          </tr>`)}
        ${hasUnallocated ? html`<tr class="row-warn"><td></td><td><a href="#/draf?filter=none">Belum dialokasikan ke pos →</a></td>
          ${accounts.map((a) => html`<td class="${numClass(a.unallocated)}">${money(a.unallocated)}</td>`)}<td></td></tr>` : ''}
        <tr class="row-strong"><td></td><td>TOTAL POS</td>${accounts.map((a) => html`<td class="${numClass(a.total)}">${money(a.total)}</td>`)}<td class="${numClass(t.total)}">${money(t.total)}</td></tr>
        <tr><td></td><td>SALDO REKENING / KAS</td>${accounts.map((a) => html`<td class="num">${money(a.actual)}${a.actual_date ? html`<div class="muted" style="font-size:11px">per ${dateId(a.actual_date)}</div>` : ''}</td>`)}<td class="num">${money(t.actual)}</td></tr>
        <tr class="row-strong"><td></td><td>SELISIH LEBIH / (KURANG) UANG</td>
          ${accounts.map((a) => html`<td class="num ${a.selisih ? 'neg' : 'in'}">${money(a.selisih)}</td>`)}
          <td class="num ${t.selisih ? 'neg' : 'in'}">${money(t.selisih)} ${t.selisih ? '' : '✓'}</td></tr>
      </tbody>
    </table>`);
  on(body, 'click', 'tr[data-pos]', (e, tr) => (location.hash = `#/tahunan?sheet=${tr.dataset.pos}`));
}

// ---------------------------------------------------------------- Sheet per pos

async function renderPosSheet(body, actions, posId, reload) {
  const s = await api.get(`/pos/${posId}/sheet`, { year: store.year });
  const acc = s.accounts;
  const colspan = 5 + acc.length * 3;
  const cells = (row, field) => acc.map((a) => {
    if (a.id !== row.account_id) return html`<td></td>`;
    const value = row[field];
    if (field === 'saldo') return html`<td class="${numClass(value)}">${money(value)}</td>`;
    return html`<td class="num">${value ? money(value) : ''}</td>`;
  });

  render(actions, html`
    <button data-act="add" data-write>+ Transaksi</button>
    <button data-act="transfer" data-write>⇄ Pindahan Pos</button>`);
  $('[data-act="add"]', actions).addEventListener('click', () => openTransactionForm(null, { posId, onSaved: reload }));
  $('[data-act="transfer"]', actions).addEventListener('click', () => openTransferForm({ fromPosId: posId, onSaved: reload }));

  const allRows = s.months.flatMap((m) => m.rows);
  render(body, html`
    ${sheetTitle(`Laporan Keuangan ${s.pos.name.toUpperCase()} ${store.year}`)}
    <table class="sheet" id="posSheet">
      <thead>
        <tr>
          <th rowspan="2">Tgl</th><th rowspan="2" style="min-width:320px">Nama</th><th rowspan="2">No Kwitansi</th><th rowspan="2">Piao Wen</th><th rowspan="2">Keterangan</th>
          <th colspan="${acc.length}">Masuk</th><th colspan="${acc.length}">Keluar</th><th colspan="${acc.length}">Saldo</th>
        </tr>
        <tr>${[0, 1, 2].map(() => acc.map((a) => html`<th>${a.name}</th>`))}</tr>
      </thead>
      <tbody>
        <tr class="row-strong"><td></td><td colspan="4">SALDO AWAL</td>${acc.map(() => html`<td></td><td></td>`)}${acc.map((a) => html`<td class="${numClass(a.opening)}">${money(a.opening)}</td>`)}</tr>
        ${s.months.map((m) => html`
          <tr class="row-month"><td colspan="${colspan}">${MONTHS[m.month - 1].toUpperCase()} ${store.year}</td></tr>
          ${m.rows.map((r) => html`
            <tr class="clickable" data-id="${r.id}">
              <td class="day">${dayOf(r.date)}</td>
              <td class="${r.keluar ? 'indent' : ''}">${r.sheet_name}${r.source === 'pindahan' ? html` <span class="badge">pindahan</span>` : ''}</td>
              <td>${r.receipt_no}</td><td>${r.piao_wen}</td><td>${r.note}</td>
              ${cells(r, 'masuk')}${cells(r, 'keluar')}${cells(r, 'saldo')}
            </tr>`)}`)}
        ${s.months.length ? '' : html`<tr><td colspan="${colspan}" class="empty">Belum ada transaksi untuk pos ini di ${store.year}.</td></tr>`}
      </tbody>
      <tfoot><tr><td></td><td colspan="4">SALDO AKHIR</td>${acc.map(() => html`<td></td><td></td>`)}${acc.map((a) => html`<td class="${numClass(a.closing)}">${money(a.closing)}</td>`)}</tr></tfoot>
    </table>`);

  on($('#posSheet', body), 'click', 'tr[data-id]', (e, tr) => {
    openTransactionForm(allRows.find((r) => r.id === Number(tr.dataset.id)), { onSaved: reload });
  });
}

// ---------------------------------------------------------------- Sheet Barang (donasi barang)

async function renderBarang(body, actions, reload) {
  const items = await api.get('/barang', { year: store.year });
  render(actions, html`<button data-act="add" data-write>+ Donasi Barang</button>`);
  $('[data-act="add"]', actions).addEventListener('click', () => openGoodsForm(null, reload));

  const byMonth = MONTHS.map((name, i) => ({ name, items: items.filter((g) => Number(g.date.slice(5, 7)) === i + 1) }));
  render(body, html`
    ${sheetTitle(`DONATUR BARANG ${store.year}`)}
    <table class="sheet" id="goodsSheet" style="min-width:700px">
      <thead><tr><th style="width:60px">Tgl</th><th>Nama</th><th>Barang</th><th>Keterangan</th></tr></thead>
      <tbody>${byMonth.map((m) => html`
        <tr class="row-month"><td colspan="4">${m.name.toUpperCase()} ${store.year}</td></tr>
        ${m.items.map((g) => html`<tr class="clickable" data-id="${g.id}"><td class="day">${dayOf(g.date)}</td><td>${g.name}</td><td>${g.item}</td><td>${g.note}</td></tr>`)}`)}
      </tbody>
    </table>`);
  on($('#goodsSheet', body), 'click', 'tr[data-id]', (e, tr) => openGoodsForm(items.find((g) => g.id === Number(tr.dataset.id)), reload));
}

function openGoodsForm(item, onSaved) {
  if (!store.can('write')) return; // Pimpinan hanya melihat
  const { root, close } = openModal({
    title: item ? 'Ubah Donasi Barang' : 'Donasi Barang',
    body: html`
      <form class="form-grid" id="goodsForm">
        <label>Tanggal<input type="date" name="date" required value="${item?.date || `${store.year}-01-01`}"></label>
        <label>Nama donatur<input name="name" required value="${item?.name || ''}"></label>
        <label class="full">Barang<input name="item" required value="${item?.item || ''}" placeholder="mis. 5 karung beras"></label>
        <label class="full">Keterangan<input name="note" value="${item?.note || ''}"></label>
      </form>`,
    footer: html`<div>${item ? html`<button class="btn-danger" data-act="delete">Hapus</button>` : ''}</div>
      <div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-act="save">Simpan</button></div>`,
  });
  $('[data-act="save"]', root).addEventListener('click', async () => {
    const form = $('#goodsForm', root);
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (await attempt(() => (item ? api.put(`/barang/${item.id}`, data) : api.post('/barang', data)), 'Tersimpan')) { close(); onSaved(); }
  });
  $('[data-act="delete"]', root)?.addEventListener('click', async () => {
    if (confirm('Hapus data barang ini?') && await attempt(() => api.del(`/barang/${item.id}`), 'Dihapus')) { close(); onSaved(); }
  });
}
