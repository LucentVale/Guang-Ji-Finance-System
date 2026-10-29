// Dashboard Per Bulan: semua angka hanya untuk SATU bulan (tidak ada pembanding setahun).
//   1. Angka utama bulan itu: saldo awal, pemasukan, pengeluaran, selisih, (pindahan), saldo akhir, jumlah transaksi
//   2. Arus kas harian (klik tanggal = saring tabel transaksi ke tanggal itu) + donatur bulan itu
//   3. Semua pos: pemasukan & pengeluaran tiap pos di bulan itu
//   4. Semua transaksi bulan itu, bisa disaring (jenis, pos, tanggal, kata kunci); klik baris = rincian / ubah
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, dateShort, dayOf, MONTHS } from '../core/format.js';
import { dailyFlowChart, flowLegend } from '../components/charts.js';
import { bigMoney, card, donorCard, posSummaryCard, minus, signed } from '../components/dashboardCards.js';
import { openTransactionForm, openTransactionDetail } from '../components/transactionForms.js';
import { segmented, bindSegmented, debounce, SEARCH_DELAY_MS } from '../components/controls.js';

const TYPES = { '': 'Semua', masuk: 'Masuk', keluar: 'Keluar' };

/** Angka utama periode, sama bentuknya untuk semua pos (data.totals) maupun satu pos (data). */
function summaryOf(data, isPos) {
  if (isPos) return { opening: data.opening, masuk: data.masuk, keluar: data.keluar, pindahan: data.pindahan, closing: data.closing, unallocated: 0 };
  const t = data.totals;
  return { opening: t.opening, masuk: t.masuk, keluar: t.keluar, pindahan: 0, closing: t.saldo, unallocated: t.belum_dialokasikan };
}

function kpi(label, value, { cls = '', note = '' } = {}) {
  return html`<div class="kpi ${cls}"><span class="kpi-label">${label}</span><b class="kpi-value">${value}</b>${note ? html`<small>${note}</small>` : ''}</div>`;
}

function kpiRow(s, txs, monthName) {
  const nonTransfer = txs.filter((t) => t.source !== 'pindahan');
  const nIn = nonTransfer.filter((t) => t.masuk).length;
  const nOut = nonTransfer.filter((t) => t.keluar).length;
  const net = minus(s.masuk, s.keluar);
  return html`
    <div class="kpi-row" role="list">
      ${kpi(`Saldo awal ${monthName}`, bigMoney(s.opening))}
      ${kpi('Pemasukan', bigMoney(s.masuk), { cls: 'in', note: `${nIn} transaksi` })}
      ${kpi('Pengeluaran', bigMoney(s.keluar), { cls: 'out', note: `${nOut} transaksi` })}
      ${kpi(net >= 0 ? 'Surplus' : 'Defisit', html`<span class="${numClass(net)}">${signed(net)}</span>`, { note: 'pemasukan − pengeluaran' })}
      ${s.pindahan ? kpi('Pindahan antar pos', html`<span class="${numClass(s.pindahan)}">${signed(s.pindahan)}</span>`) : ''}
      ${kpi(`Saldo akhir ${monthName}`, bigMoney(s.closing), {
        cls: 'strong', note: s.unallocated ? html`<span class="status bad">⚠ ${s.unallocated} belum punya pos</span>` : `${nonTransfer.length} transaksi`,
      })}
    </div>`;
}

/**
 * Isi dashboard Per Bulan.
 * @param {HTMLElement} dash wadah isi (di bawah kepala halaman & deretan bulan)
 * @param {{data: object, month: number, posId: number|null, overview: object, onChanged: () => void}} p
 *   data = hasil /dashboard (semua pos) atau /dashboard/pos/:id, keduanya dengan ?month
 */
export async function renderMonthDashboard(dash, { data, month, posId, overview, onChanged }) {
  const monthName = MONTHS[month - 1];
  const txs = await api.get('/transactions', { year: store.year, month, ...(posId ? { pos_id: posId } : {}) });
  const isPos = Boolean(posId);
  const filters = { jenis: '', pos: '', day: 0, q: '' };

  render(dash, html`
    ${kpiRow(summaryOf(data, isPos), txs, monthName)}
    <div class="month-grid">
      ${card(`Arus kas harian — ${monthName} ${store.year}`, 'Klik tanggal untuk melihat transaksinya', html`
        <div class="monthly-legend">${flowLegend()}</div>
        ${dailyFlowChart(data.days, { monthName })}`, 'daily')}
      ${data.donors.length || !isPos
        ? donorCard(data.donors, { sub: `Bulan ${monthName} · pos yang memakai Daftar Donatur`, empty: 'Belum ada donatur di bulan ini.' })
        : ''}
    </div>
    ${isPos ? '' : posSummaryCard(data, month)}
    <section class="dcard month-tx" id="monthTx">
      <header><div><h2>Semua transaksi ${monthName} ${store.year}</h2>
        <p>${store.can('write') ? 'Klik baris untuk melihat rincian atau mengubah' : 'Klik baris untuk melihat rincian'}</p></div></header>
      <div class="filter-bar" role="search">
        ${segmented({ name: 'jenis', label: 'Jenis transaksi', current: '', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) })}
        ${isPos ? '' : html`<label class="inline">Pos
          <select id="txPos"><option value="">Semua pos</option>${overview.pos.map((p) => html`<option value="${p.pos_id}">${p.number}. ${p.name}</option>`)}</select></label>`}
        <input type="search" id="txSearch" placeholder="Cari nama, kategori, catatan…" aria-label="Cari transaksi">
        <span id="txDay"></span>
      </div>
      <div id="txTable"></div>
    </section>
    <p class="toolbar">
      <a class="btn" href="#/draf?month=${month}">Buka ${monthName} di Draf →</a>
      ${isPos ? html`<a class="btn" href="#/tahunan?sheet=${posId}&bulan=${month}">Buka ${monthName} di Laporan per Pos →</a>` : ''}
    </p>`);

  const table = $('#txTable', dash);
  const visible = () => txs.filter((t) => {
    if (filters.jenis === 'masuk' && !t.masuk) return false;
    if (filters.jenis === 'keluar' && !t.keluar) return false;
    if (filters.pos && t.pos_id !== Number(filters.pos)) return false;
    if (filters.day && dayOf(t.date) !== filters.day) return false;
    if (filters.q && ![t.sheet_name, t.category, t.note, t.receipt_no, t.bank_desc].join(' ').toLowerCase().includes(filters.q)) return false;
    return true;
  });

  function drawTable() {
    const rows = visible();
    const counted = rows.filter((t) => t.source !== 'pindahan'); // pindahan tidak dihitung sebagai pemasukan/pengeluaran
    const sumOf = (field) => Math.round(counted.reduce((s, t) => s + t[field] * 100, 0)) / 100;
    render($('#txDay', dash), filters.day
      ? html`<button type="button" class="chip-clear" data-clear-day>Tanggal ${filters.day} ${monthName} ✕</button>` : '');
    render(table, rows.length ? html`
      <div class="tx-scroll"><table class="table tx-table">
        <thead><tr><th>Tgl</th><th>Nama / uraian</th>${isPos ? '' : html`<th>Pos</th>`}<th>Akun</th><th class="num">Masuk</th><th class="num">Keluar</th></tr></thead>
        <tbody>${rows.map((t) => html`
          <tr class="clickable" data-tx="${t.id}">
            <td class="muted">${dateShort(t.date)}</td>
            <td><b>${t.sheet_name}</b>${t.source === 'pindahan' ? html` <span class="badge">pindahan</span>` : ''}
              ${t.note ? html`<small class="muted tx-note">${t.note}</small>` : ''}</td>
            ${isPos ? '' : html`<td><span class="pos-pill">${t.pos || '—'}</span></td>`}
            <td class="muted">${t.account}</td>
            <td class="num in">${t.masuk ? money(t.masuk) : ''}</td>
            <td class="num out">${t.keluar ? money(t.keluar) : ''}</td>
          </tr>`)}
        </tbody>
        <tfoot><tr><td></td><td>${rows.length} transaksi${counted.length < rows.length ? ' · total tanpa pindahan' : ''}</td>${isPos ? '' : html`<td></td>`}<td></td>
          <td class="num">${money(sumOf('masuk'))}</td><td class="num">${money(sumOf('keluar'))}</td></tr></tfoot>
      </table></div>` : html`<p class="muted empty">Tidak ada transaksi yang cocok dengan saringan.</p>`);
  }
  drawTable();

  // Saringan: jenis, pos, kata kunci, tanggal (dari grafik harian).
  bindSegmented($('#monthTx', dash), 'jenis', (jenis) => { filters.jenis = jenis; drawTable(); });
  $('#txPos', dash)?.addEventListener('change', (e) => { filters.pos = e.target.value; drawTable(); });
  const search = debounce((q) => { filters.q = q; drawTable(); }, SEARCH_DELAY_MS);
  $('#txSearch', dash).addEventListener('input', (e) => search(e.target.value.trim().toLowerCase()));
  on(dash, 'click', '[data-day]', (e, el) => {
    filters.day = Number(el.dataset.day);
    drawTable();
    $('#monthTx', dash).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  on(dash, 'click', '[data-clear-day]', () => { filters.day = 0; drawTable(); });

  // Klik baris: Bendahara/Admin bisa mengubah, Pimpinan hanya melihat rincian.
  on(table, 'click', 'tr[data-tx]', (e, tr) => {
    const tx = txs.find((t) => t.id === Number(tr.dataset.tx));
    if (store.can('write')) openTransactionForm(tx, { onSaved: onChanged });
    else openTransactionDetail(tx);
  });
}
