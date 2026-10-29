// Langkah 3 — Laporan Keuangan Tahunan (padanan file Excel "Laporan Keuangan Kuang Hang Tahun 2026").
// Dua tampilan, dipilih lewat tombol segmen di toolbar:
//   Rekap   — saldo akhir tiap pos per akun dibanding rekening koran (sheet "Tabel")
//   Per Pos — transaksi satu pos per bulan (pos dipilih dari dropdown), dengan kartu ringkasan,
//             subtotal tiap bulan, dan kolom Masuk / Keluar / Saldo untuk setiap akun (BCA, Kas Kecil).
import { $, $$, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { amount, numClass, dayOf, dateId, MONTHS } from '../core/format.js';
import { toast } from '../components/feedback.js';
import { openTransactionForm, openTransferForm, openTransactionDetail } from '../components/transactionForms.js';

const SHEET_TABEL = 'tabel';
const FLASH_MS = 1600;

/** Pos terakhir yang dibuka, supaya tombol "Per Pos" kembali ke sana. */
let lastPosId = null;
/** Bulan yang sedang terbuka per sheet ("fothang:pos:tahun" -> Set bulan); bertahan saat isi sheet dimuat ulang. */
const openMonths = new Map();

export async function workbookView(main, params) {
  const sheet = params.get('sheet') || SHEET_TABEL;
  const fothang = store.fothang;

  // Sheet pos yang tidak ada (mis. ?sheet=999, ?sheet=barang dari versi lama, atau id pos milik Fothang lain
  // setelah ganti Fothang): kembali ke sheet Tabel daripada menampilkan halaman error.
  if (sheet !== SHEET_TABEL && !store.posById(sheet)) {
    toast(`Sheet pos tidak ditemukan di ${fothang.short_name}. Menampilkan sheet Tabel.`);
    location.replace(`#/tahunan?sheet=${SHEET_TABEL}`);
    return;
  }
  const isPos = sheet !== SHEET_TABEL;
  main.classList.add('view-fill'); // tabel mengisi sisa tinggi layar
  if (isPos) lastPosId = Number(sheet);
  if (!store.posById(lastPosId)) lastPosId = store.pos[0]?.id ?? null;

  // Saldo tiap pos untuk isi dropdown pemilih pos.
  const tabel = await api.get('/tabel', { year: store.year });
  const saldoOf = new Map(tabel.rows.map((r) => [r.pos_id, r.total]));
  const mode = isPos ? 'pos' : sheet;

  render(main, html`
    <section class="workbook">
      <div class="workbook-toolbar">
        <div class="segmented" role="tablist" aria-label="Tampilan">
          <button role="tab" data-go="${SHEET_TABEL}" class="${mode === SHEET_TABEL ? 'on' : ''}" aria-selected="${mode === SHEET_TABEL}">Rekap</button>
          <button role="tab" data-go="pos" class="${mode === 'pos' ? 'on' : ''}" aria-selected="${mode === 'pos'}" ${lastPosId ? '' : 'disabled'}>Per Pos</button>
        </div>
        ${isPos ? html`
          <label class="pos-picker"><span class="sr-only">Pilih pos</span>
            <select id="posPicker">${store.pos.map((p) => html`
              <option value="${p.id}" ${p.id === Number(sheet) ? 'selected' : ''}>${p.number} · ${p.name} — Rp ${amount(saldoOf.get(p.id) ?? 0)}</option>`)}
            </select>
          </label>
          <span class="title-year">${store.year}</span>` : html`<span class="title">Rekap Saldo per Pos — ${store.year}</span>`}
        <span class="toolbar-spacer"></span>
        <span id="sheetActions" class="toolbar"></span>
        <a class="btn" href="${api.downloadUrl('/export/tahunan.xlsx', { year: store.year })}">⭳ Excel Tahunan</a>
      </div>
      <div id="sheetSummary"></div>
      <div class="sheet-scroll" id="sheetBody"><div class="empty">Memuat…</div></div>
    </section>`);

  $$('[data-go]', main).forEach((b) => b.addEventListener('click', () => {
    const target = b.dataset.go === 'pos' ? lastPosId : b.dataset.go;
    if (target) location.hash = `#/tahunan?sheet=${target}`;
  }));
  $('#posPicker', main)?.addEventListener('change', (e) => (location.hash = `#/tahunan?sheet=${e.target.value}`));

  const body = $('#sheetBody', main);
  const summary = $('#sheetSummary', main);
  // Filter sheet pos dari hash; objek yang sama dipakai ulang saat isi sheet dimuat ulang (simpan/hapus).
  const filters = filtersFrom(params);
  const actions = $('#sheetActions', main);

  function loadSheet() {
    if (sheet === SHEET_TABEL) return renderTabel(body, tabel);
    return renderPosSheet({ body, summary, actions, posId: Number(sheet), reload, filters });
  }

  /**
   * Muat ulang ISI sheet saja (bukan seluruh halaman) setelah simpan/hapus, lalu pulihkan posisi gulir
   * supaya pengguna tetap di bulan yang sedang dikerjakan. focusId = baris yang baru diubah (disorot sebentar).
   */
  async function reload({ focusId } = {}) {
    const { scrollTop, scrollLeft } = body;
    await loadSheet();
    body.scrollTop = scrollTop;
    body.scrollLeft = scrollLeft;
    if (focusId) flashRow(body, focusId);
  }

  await loadSheet();
}

/** Sorot sebentar baris yang baru diubah; gulir seperlunya bila baris itu di luar layar. */
function flashRow(body, id) {
  const tr = $(`tr[data-id="${CSS.escape(String(id))}"]`, body);
  if (!tr || tr.hidden) return; // mis. baris baru saja dihapus, atau bulannya sedang dilipat
  tr.scrollIntoView({ block: 'nearest' });
  tr.classList.add('flash');
  setTimeout(() => tr.classList.remove('flash'), FLASH_MS);
}

// ---------------------------------------------------------------- Rekap (sheet Tabel)

/** Sel saldo pembanding (rekening koran). Tanpa pembanding: "—" + alasannya, bukan 0. */
const actualCell = (a) => (a.has_comparison
  ? html`<td class="num">${amount(a.actual)}${a.actual_date ? html`<div class="muted" style="font-size:11px">per ${dateId(a.actual_date)}</div>` : ''}</td>`
  : html`<td class="num muted">—<div style="font-size:11px">${a.actual_note}</div></td>`);

/** Sel selisih. Tanda ✓ hanya bila benar-benar dicocokkan dengan pembanding dan hasilnya 0. */
function selisihCell(value, hasComparison) {
  if (!hasComparison || value == null) return html`<td class="num muted">—</td>`;
  return value ? html`<td class="num neg">${amount(value)}</td>` : html`<td class="num in">${amount(0)} ✓</td>`;
}

function renderTabel(body, t) {
  const accounts = t.accounts;
  const hasUnallocated = accounts.some((a) => a.unallocated);

  render(body, html`
    <table class="sheet ledger" style="min-width:0">
      <thead><tr><th style="width:50px">No</th><th>Keterangan Laporan</th>${accounts.map((a) => html`<th>${a.name}</th>`)}<th>Total</th><th class="go-col"><span class="sr-only">Buka</span></th></tr></thead>
      <tbody>
        ${t.rows.map((r) => html`
          <tr class="clickable go-row" data-pos="${r.pos_id}" title="Buka transaksi ${r.name}">
            <td class="day">${r.number}</td><td>${r.name} (${r.code})${r.active ? '' : html` <span class="badge">nonaktif</span>`}</td>
            ${accounts.map((a) => html`<td class="${numClass(r.saldo[a.account_id])}">${amount(r.saldo[a.account_id])}</td>`)}
            <td class="${numClass(r.total)}"><b>${amount(r.total)}</b></td>
            <td class="go-col" aria-hidden="true">›</td>
          </tr>`)}
        ${hasUnallocated ? html`<tr class="row-warn"><td></td><td><a href="#/draf?filter=none">Belum dialokasikan ke pos →</a></td>
          ${accounts.map((a) => html`<td class="${numClass(a.unallocated)}">${amount(a.unallocated)}</td>`)}<td></td><td></td></tr>` : ''}
        <tr class="row-strong"><td></td><td>TOTAL POS</td>${accounts.map((a) => html`<td class="${numClass(a.total)}">${amount(a.total)}</td>`)}<td class="${numClass(t.total)}">${amount(t.total)}</td><td></td></tr>
        <tr><td></td><td>SALDO REKENING / KAS</td>${accounts.map(actualCell)}
          <td class="num">${t.actual == null ? '—' : amount(t.actual)}</td><td></td></tr>
        <tr class="row-strong"><td></td><td>SELISIH LEBIH / (KURANG) UANG</td>
          ${accounts.map((a) => selisihCell(a.selisih, a.has_comparison))}
          ${selisihCell(t.selisih, t.selisih != null)}<td></td></tr>
      </tbody>
    </table>
    ${accounts.some((a) => !a.has_comparison) ? html`<p class="muted sheet-note">Selisih total hanya menghitung akun yang punya pembanding
      (rekening koran). Akun bertanda "—" belum bisa dicocokkan.</p>` : ''}`);
  on(body, 'click', 'tr[data-pos]', (e, tr) => (location.hash = `#/tahunan?sheet=${tr.dataset.pos}`));
}

// ---------------------------------------------------------------- Per Pos

// Filter sheet pos (disimpan di hash, mis. #/tahunan?sheet=1&bulan=2&q=irene&jenis=keluar).
const FILTER_TYPES = { '': 'Semua', masuk: 'Masuk', keluar: 'Keluar' };
const SEARCH_DELAY_MS = 200;

/** Baca filter dari parameter hash; nilai yang tidak dikenal diabaikan. */
function filtersFrom(params) {
  const bulan = Number(params.get('bulan'));
  const jenis = params.get('jenis') || '';
  return {
    bulan: bulan >= 1 && bulan <= 12 ? bulan : 0,
    q: (params.get('q') || '').trim(),
    jenis: jenis in FILTER_TYPES ? jenis : '',
  };
}

const isFiltered = (f) => Boolean(f.bulan || f.q || f.jenis);

/** Tulis filter ke hash tanpa memicu render ulang seluruh halaman (replaceState tidak memicu hashchange). */
function writeFiltersToHash(posId, f) {
  const q = new URLSearchParams({ sheet: String(posId) });
  if (f.bulan) q.set('bulan', String(f.bulan));
  if (f.q) q.set('q', f.q);
  if (f.jenis) q.set('jenis', f.jenis);
  history.replaceState(null, '', `#/tahunan?${q}`);
}

/** Kategori yang layak ditampilkan sebagai badge (tidak untuk DONATUR, pindahan, atau yang sama dengan namanya). */
function categoryBadge(r) {
  const c = r.category;
  if (!c || c === 'DONATUR' || c.startsWith('PINDAHAN') || c === String(r.name).toUpperCase()) return '';
  return html`<span class="cat-badge">${c}</span>`;
}

/** Gabungan No Kwitansi, Piao Wen, dan Keterangan menjadi satu teks "Catatan". */
const noteOf = (r) => [r.receipt_no && `Kw. ${r.receipt_no}`, r.piao_wen && `PW ${r.piao_wen}`, r.note].filter(Boolean).join(' · ');

/** Cocok dengan kata kunci pencarian: nama, kategori, atau catatan (tanpa membedakan huruf besar/kecil). */
const matchesSearch = (r, q) => !q || [r.name, r.category, noteOf(r)].join(' ').toLowerCase().includes(q.toLowerCase());

function rowVisible(r, f) {
  if (f.jenis === 'masuk' && !r.masuk) return false;
  if (f.jenis === 'keluar' && !r.keluar) return false;
  return matchesSearch(r, f.q);
}

const cents = (n) => Math.round(n * 100);
const sumRupiah = (rows, field) => rows.reduce((t, r) => t + cents(r[field]), 0) / 100;
const sumValues = (values) => values.reduce((t, v) => t + cents(v), 0) / 100;

async function renderPosSheet({ body, summary, actions, posId, reload, filters }) {
  const s = await api.get(`/pos/${posId}/sheet`, { year: store.year });
  const canWrite = store.can('write');
  const acc = s.accounts;
  const allRows = s.months.flatMap((m) => m.rows);
  // Kolom Catatan hanya tampil bila ada minimal satu baris berisi No Kwitansi / Piao Wen / Keterangan.
  const showNote = allRows.some((r) => noteOf(r));
  const labelSpan = showNote ? 3 : 2; // Tgl + Nama (+ Catatan)
  const colspan = labelSpan + acc.length * 3;

  // Bulan yang terbuka: diingat per pos & tahun; bawaan = bulan terakhir yang berisi data.
  const stateKey = `${store.fothangId}:${posId}:${store.year}`;
  if (!openMonths.has(stateKey)) openMonths.set(stateKey, new Set(s.months.length ? [s.months.at(-1).month] : []));
  const open = openMonths.get(stateKey);

  /** Saldo per akun di awal bulan = saldo akhir bulan berisi data sebelumnya, atau saldo awal tahun. */
  function openingOf(month) {
    const prev = s.months.filter((m) => m.month < month).at(-1);
    return acc.map((a) => (prev ? prev.subtotal.accounts.find((x) => x.id === a.id).closing : a.opening));
  }
  function closingOf(month) {
    const m = s.months.find((x) => x.month === month);
    return m ? acc.map((a) => m.subtotal.accounts.find((x) => x.id === a.id).closing) : openingOf(month);
  }

  render(actions, html`
    <button data-act="add" data-write>+ Transaksi</button>
    <button data-act="transfer" data-write>⇄ Pindahan Pos</button>`);
  $('[data-act="add"]', actions).addEventListener('click', () => openTransactionForm(null, { posId, onSaved: () => reload() }));
  $('[data-act="transfer"]', actions).addEventListener('click', () => openTransferForm({ fromPosId: posId, onSaved: () => reload() }));

  // Bilah filter digambar sekali (supaya kotak cari tidak kehilangan fokus); kartu & tabel digambar ulang saat filter berubah.
  render(summary, html`
    <div class="filter-bar" role="search">
      <label class="inline">Bulan
        <select id="fBulan"><option value="0">Semua</option>${MONTHS.map((m, i) => html`<option value="${i + 1}" ${filters.bulan === i + 1 ? 'selected' : ''}>${m}</option>`)}</select>
      </label>
      <input id="fCari" type="search" placeholder="Cari nama, kategori, catatan…" value="${filters.q}" aria-label="Cari transaksi">
      <div class="segmented" role="group" aria-label="Jenis transaksi">
        ${Object.entries(FILTER_TYPES).map(([v, label]) => html`<button type="button" data-jenis="${v}" class="${filters.jenis === v ? 'on' : ''}">${label}</button>`)}
      </div>
      <button type="button" id="fReset" class="btn-ghost">Hapus filter</button>
      <span id="posWarn" class="warn-slot"></span>
    </div>
    <div id="posCards"></div>`);

  function drawCards() {
    const filtered = isFiltered(filters);
    const period = filters.bulan ? MONTHS[filters.bulan - 1] : String(store.year);
    const rows = allRows.filter((r) => (!filters.bulan || Number(r.date.slice(5, 7)) === filters.bulan) && rowVisible(r, filters));
    const opening = filters.bulan ? sumValues(openingOf(filters.bulan)) : s.total_opening;
    const closing = filters.bulan ? sumValues(closingOf(filters.bulan)) : s.total_closing;
    const masuk = filtered ? sumRupiah(rows, 'masuk') : s.total_in;
    const keluar = filtered ? sumRupiah(rows, 'keluar') : s.total_out;
    const tag = filtered ? html` <em>(difilter)</em>` : '';
    const tile = (label, value, cls = '') => html`<div class="sum-card"><span>${label}</span><b class="${cls}">Rp ${amount(value)}</b></div>`;

    // Saldo ditampilkan netral; cukup SATU peringatan bila saldo awal/akhir pos minus.
    const minus = s.total_opening < 0 || s.total_closing < 0;
    render($('#posWarn', summary), minus ? html`
      <span class="minus-warn" role="note" title="Saldo pos ini minus. Cek saldo awal di Pengaturan atau alokasi transaksi di Draf.">⚠ Saldo pos ini minus — cek
        <a href="#/pengaturan">saldo awal</a> atau <a href="#/draf">alokasi di Draf</a></span>` : '');
    render($('#posCards', summary), html`
      <div class="sum-cards">
        ${tile(`Saldo awal ${period}`, opening)}
        ${tile(html`Total masuk${tag}`, masuk, 'in')}
        ${tile(html`Total keluar${tag}`, keluar, 'out')}
        ${tile(`Saldo akhir ${period}`, closing)}
      </div>`);
  }

  // Bendahara/Admin: klik baris = ubah. Pimpinan: klik baris = lihat rincian (tanpa ubah).
  const rowClass = canWrite ? 'clickable' : 'viewable';
  // Masuk hijau, keluar merah tua; saldo berjalan netral (tanpa merah walau minus).
  const cells = (row, field) => acc.map((a) => {
    if (a.id !== row.account_id) return html`<td></td>`;
    const value = row[field];
    if (field === 'saldo') return html`<td class="num">${amount(value)}</td>`;
    return html`<td class="num amt-${field}">${value ? amount(value) : ''}</td>`;
  });
  /** Subtotal bulan; saat difilter cari/jenis, Masuk & Keluar dijumlah dari baris yang tampil saja. */
  function subtotalCells(m, rows, filtered) {
    const flow = (a, field) => (filtered
      ? sumRupiah(rows.filter((r) => r.account_id === a.id), field)
      : m.subtotal.accounts.find((x) => x.id === a.id)[field]);
    return html`
      ${acc.map((a) => { const v = flow(a, 'masuk'); return html`<td class="num amt-masuk">${v ? amount(v) : ''}</td>`; })}
      ${acc.map((a) => { const v = flow(a, 'keluar'); return html`<td class="num amt-keluar">${v ? amount(v) : ''}</td>`; })}
      ${acc.map((a) => html`<td class="num">${amount(m.subtotal.accounts.find((x) => x.id === a.id).closing)}</td>`)}`;
  }

  function drawTable() {
    const filtered = isFiltered(filters);
    // Dengan filter cari/jenis, bulan tanpa hasil disembunyikan dan bulan yang ada hasilnya dibuka.
    const textFilter = Boolean(filters.q || filters.jenis);
    const months = s.months
      .filter((m) => !filters.bulan || m.month === filters.bulan)
      .map((m) => ({ ...m, visibleRows: m.rows.filter((r) => rowVisible(r, filters)) }))
      .filter((m) => !textFilter || m.visibleRows.length);
    const periodLabel = filters.bulan ? ` ${MONTHS[filters.bulan - 1].toUpperCase()}` : '';
    const openingCells = (filters.bulan ? openingOf(filters.bulan) : acc.map((a) => a.opening)).map((v) => html`<td class="num">${amount(v)}</td>`);
    const closingCells = (filters.bulan ? closingOf(filters.bulan) : acc.map((a) => a.closing)).map((v) => html`<td class="num">${amount(v)}</td>`);

    render(body, html`
      <table class="sheet ledger" id="posSheet">
        <thead>
          <tr>
            <th rowspan="2">Tgl</th><th rowspan="2" style="min-width:320px">Nama</th>${showNote ? html`<th rowspan="2">Catatan</th>` : ''}
            <th colspan="${acc.length}">Masuk</th><th colspan="${acc.length}">Keluar</th><th colspan="${acc.length}">Saldo</th>
          </tr>
          <tr>${[0, 1, 2].map(() => acc.map((a) => html`<th>${a.name}</th>`))}</tr>
        </thead>
        <tbody>
          <tr class="row-strong"><td></td><td colspan="${labelSpan - 1}">SALDO AWAL${periodLabel}</td>${acc.map(() => html`<td></td><td></td>`)}${openingCells}</tr>
          ${months.map((m) => {
            const isOpen = filtered || open.has(m.month);
            return html`
              <tr class="row-month">
                <td colspan="${colspan}" class="month-cell">
                  <button type="button" class="month-toggle" data-month="${m.month}" aria-expanded="${isOpen}" ${filtered ? 'disabled' : ''}>
                    <span class="caret" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>${MONTHS[m.month - 1].toUpperCase()} ${store.year}
                    <span class="month-count">${textFilter ? `${m.visibleRows.length} dari ${m.rows.length}` : m.rows.length} transaksi</span>
                  </button>
                </td>
              </tr>
              ${m.visibleRows.map((r) => html`
                <tr class="${rowClass}" data-id="${r.id}" data-month="${m.month}" ${isOpen ? '' : 'hidden'}>
                  <td class="day">${dayOf(r.date)}</td>
                  <td class="${r.keluar ? 'indent' : ''}">${categoryBadge(r)}${r.name}${r.source === 'pindahan' ? html` <span class="badge">pindahan</span>` : ''}</td>
                  ${showNote ? html`<td class="note-cell">${noteOf(r)}</td>` : ''}
                  ${cells(r, 'masuk')}${cells(r, 'keluar')}${cells(r, 'saldo')}
                </tr>`)}
              <tr class="row-subtotal"><td></td><td colspan="${labelSpan - 1}">Total ${MONTHS[m.month - 1]}${textFilter ? ' (difilter)' : ''}</td>${subtotalCells(m, m.visibleRows, textFilter)}</tr>`;
          })}
          ${!s.months.length ? html`<tr><td colspan="${colspan}" class="empty">Belum ada transaksi untuk pos ini di ${store.year}.</td></tr>`
            : !months.length ? html`<tr><td colspan="${colspan}" class="empty">Tidak ada transaksi yang cocok dengan filter.</td></tr>` : ''}
        </tbody>
        <tfoot><tr><td></td><td colspan="${labelSpan - 1}">SALDO AKHIR${periodLabel}</td>${acc.map(() => html`<td></td><td></td>`)}${closingCells}</tr></tfoot>
      </table>`);

    const table = $('#posSheet', body);
    // Lipat / buka satu bulan (baris "Total <Bulan>" tetap terlihat saat dilipat). Nonaktif selama difilter.
    on(table, 'click', '.month-toggle', (e, btn) => {
      const month = Number(btn.dataset.month);
      const isOpen = !open.has(month);
      if (isOpen) open.add(month); else open.delete(month);
      btn.setAttribute('aria-expanded', String(isOpen));
      $('.caret', btn).textContent = isOpen ? '▾' : '▸';
      $$(`tr[data-month="${month}"]`, table).forEach((tr) => (tr.hidden = !isOpen));
    });
    on(table, 'click', 'tr[data-id]', (e, tr) => {
      const tx = allRows.find((r) => r.id === Number(tr.dataset.id));
      if (!canWrite) return openTransactionDetail(tx);
      openTransactionForm(tx, { onSaved: () => reload({ focusId: tx.id }) });
    });
  }

  function draw() {
    drawCards();
    drawTable();
    $('#fReset', summary).hidden = !isFiltered(filters);
  }

  function update(changes) {
    Object.assign(filters, changes);
    writeFiltersToHash(posId, filters);
    body.scrollTop = 0;
    draw();
  }
  $('#fBulan', summary).addEventListener('change', (e) => update({ bulan: Number(e.target.value) }));
  let searchTimer;
  $('#fCari', summary).addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => update({ q: e.target.value.trim() }), SEARCH_DELAY_MS);
  });
  on(summary, 'click', '[data-jenis]', (e, btn) => {
    $$('[data-jenis]', summary).forEach((b) => b.classList.toggle('on', b === btn));
    update({ jenis: btn.dataset.jenis });
  });
  $('#fReset', summary).addEventListener('click', () => {
    $('#fBulan', summary).value = '0';
    $('#fCari', summary).value = '';
    $$('[data-jenis]', summary).forEach((b) => b.classList.toggle('on', b.dataset.jenis === ''));
    update({ bulan: 0, q: '', jenis: '' });
  });

  draw();
}
