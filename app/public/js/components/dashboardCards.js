// Potongan kartu yang dipakai bersama oleh dashboard Keseluruhan (views/dashboardView.js)
// dan dashboard Per Bulan (views/dashboardMonth.js).
import { $, html, render, on } from '../core/dom.js';
import { store } from '../core/store.js';
import { money, numClass, MONTHS } from '../core/format.js';
import { sparkline } from './charts.js';
import { segmented, bindSegmented } from './controls.js';

/** Angka besar dengan sen dibuat samar, mis. "Rp 327.994.469" + ",24". */
export function bigMoney(n) {
  if (n == null) return html`<span class="muted">—</span>`;
  const [whole, cents] = money(Math.abs(n)).split(',');
  return html`<span class="${n < 0 ? 'neg' : ''}">${n < 0 ? '−' : ''}Rp ${whole}<span class="cents">,${cents}</span></span>`;
}

/** Selisih dua nominal rupiah tanpa galat pecahan (mis. masuk − keluar). */
export const minus = (a, b) => Math.round((a - b) * 100) / 100;

/** "+1.000,00" untuk nilai positif, "-1.000,00" untuk negatif. */
export const signed = (n) => `${n > 0 ? '+' : ''}${money(n)}`;

export const initials = (text) => String(text || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';

/** Kartu putih standar: judul, keterangan kecil, isi. */
export const card = (title, sub, body, cls = '') => html`
  <section class="dcard ${cls}"><header><div><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div></header>${body}</section>`;

export function donorCard(donors, { sub = 'Dari pos yang memakai Daftar Donatur', empty = 'Belum ada data donatur.' } = {}) {
  return card('Donatur terbesar', sub, donors.length ? html`
    <ol class="donor-list">${donors.slice(0, 6).map((d) => html`
      <li><i class="tx-avatar" aria-hidden="true">${initials(d.label)}</i><span>${d.label}</span><b class="num">${money(d.amount)}</b></li>`)}
    </ol>` : html`<p class="muted empty">${empty}</p>`);
}

/**
 * Tabel ringkasan per pos. Setahun (month = null): dengan tren saldo.
 * Satu bulan: pemasukan, pengeluaran, dan selisih tiap pos di bulan itu; pos yang aktif di bulan itu di atas,
 * pos tanpa transaksi disamarkan. Baris berisi data-pos (halaman pemakai menentukan arti kliknya).
 */
export function posSummaryCard(o, month = null) {
  const t = o.totals;
  const p = month ? MONTHS[month - 1] : '';
  const idle = (x) => Number(!x.masuk && !x.keluar); // 1 = tidak ada transaksi di periode ini
  const rows = month ? [...o.pos].sort((a, b) => idle(a) - idle(b) || a.number - b.number) : o.pos;
  return card(p ? `Pemasukan & Pengeluaran per pos — ${p} ${store.year}` : 'Ringkasan per pos', 'Klik baris untuk melihat rincian pos', html`
    <div class="table-wrap flat"><table class="table">
      <thead><tr><th>No</th><th>Pos</th><th class="num">Saldo awal${p ? ` ${p}` : ''}</th><th class="num">Masuk</th><th class="num">Keluar</th>
        ${month ? html`<th class="num">Selisih</th>` : ''}<th class="num">Pindahan</th><th class="num">Saldo akhir</th>${month ? '' : html`<th>Tren saldo</th>`}</tr></thead>
      <tbody>${rows.map((x) => html`
        <tr class="clickable ${month && idle(x) ? 'idle' : ''}" data-pos="${x.pos_id}">
          <td>${x.number}</td><td><b>${x.name}</b> <span class="muted mono">${x.code}</span></td>
          <td class="${numClass(x.opening)}">${money(x.opening)}</td>
          <td class="num in">${x.masuk ? money(x.masuk) : ''}</td>
          <td class="num out">${x.keluar ? money(x.keluar) : ''}</td>
          ${month ? html`<td class="${numClass(minus(x.masuk, x.keluar))}">${idle(x) ? '' : signed(minus(x.masuk, x.keluar))}</td>` : ''}
          <td class="${numClass(x.pindahan)}">${x.pindahan ? money(x.pindahan) : ''}</td>
          <td class="${numClass(x.closing)}"><b>${money(x.closing)}</b></td>
          ${month ? '' : html`<td>${sparkline(x.monthly)}</td>`}
        </tr>`)}
      </tbody>
      <tfoot><tr><td></td><td>Total</td><td class="num">${money(t.opening)}</td><td class="num">${money(t.masuk)}</td><td class="num">${money(t.keluar)}</td>
        ${month ? html`<td class="${numClass(minus(t.masuk, t.keluar))}">${signed(minus(t.masuk, t.keluar))}</td>` : ''}<td></td>
        <td class="num">${money(t.saldo)}</td>${month ? '' : html`<td></td>`}</tr></tfoot>
    </table></div>`, 'pos-summary');
}

/** Angka yang bisa dipilih di kartu "Per pos per bulan". */
const POS_MONTH_FIELDS = [
  { value: 'masuk', label: 'Pemasukan' },
  { value: 'keluar', label: 'Pengeluaran' },
  { value: 'saldo', label: 'Saldo akhir' },
];

/** Jumlah nominal rupiah tanpa galat pecahan. */
const total = (values) => Math.round(values.reduce((s, v) => s + (v || 0) * 100, 0)) / 100;

/**
 * Tabel pos × bulan (Januari s.d. bulan terakhir berisi data) untuk satu angka: masuk, keluar, atau saldo akhir.
 * Kolom terakhir: total setahun (masuk/keluar) atau saldo akhir terakhir (saldo). Baris data-pos = rincian pos;
 * sel data-cell-month = dashboard pos itu pada bulan tersebut (lihat bindPosMonthlyCard).
 * @param {{pos: object[], last_month: number}} o ringkasan dari /api/dashboard (tiap pos punya `months`)
 */
function posMonthlyTable(o, field) {
  const months = Array.from({ length: o.last_month }, (_, i) => i + 1);
  const isSaldo = field === 'saldo';
  const value = (p, m) => p.months[m - 1][field];
  const rowTotal = (p) => (isSaldo ? value(p, o.last_month) : total(months.map((m) => value(p, m))));
  const show = (v) => (isSaldo || v ? money(v) : '–');
  const tone = isSaldo ? '' : field === 'masuk' ? 'in' : 'out';
  return html`
    <table class="table pos-month-table">
      <thead><tr><th scope="col">Pos</th>
        ${months.map((m) => html`<th scope="col" class="num">${MONTHS[m - 1].slice(0, 3)}</th>`)}
        <th scope="col" class="num">${isSaldo ? `Saldo ${MONTHS[o.last_month - 1].slice(0, 3)}` : `Total ${store.year}`}</th></tr></thead>
      <tbody>${o.pos.map((p) => html`
        <tr class="clickable" data-pos="${p.pos_id}" title="Buka dashboard ${p.name}">
          <th scope="row"><b>${p.name}</b> <span class="muted mono">${p.code}</span></th>
          ${months.map((m) => html`<td class="${numClass(value(p, m))} ${tone}" data-cell-month="${m}"
            title="${p.name} · ${MONTHS[m - 1]}">${show(value(p, m))}</td>`)}
          <td class="${numClass(rowTotal(p))}"><b>${show(rowTotal(p))}</b></td>
        </tr>`)}
      </tbody>
      <tfoot><tr><th scope="row">Total</th>
        ${months.map((m) => html`<td class="${numClass(total(o.pos.map((p) => value(p, m))))}">${money(total(o.pos.map((p) => value(p, m))))}</td>`)}
        <td class="${numClass(total(o.pos.map(rowTotal)))}">${money(total(o.pos.map(rowTotal)))}</td></tr></tfoot>
    </table>`;
}

/** Kartu "Per pos per bulan" (dashboard Keseluruhan, semua pos). Pasang interaksinya dengan bindPosMonthlyCard. */
export function posMonthlyCard(o, field = 'masuk') {
  return card('Per pos per bulan', 'Klik angka untuk membuka dashboard pos itu pada bulan tersebut', o.last_month ? html`
    <div class="pos-month-bar">${segmented({ name: 'posMonth', label: 'Angka yang ditampilkan', current: field, options: POS_MONTH_FIELDS })}</div>
    <div class="table-wrap flat pos-month-wrap">${posMonthlyTable(o, field)}</div>` : html`<p class="muted empty">Belum ada transaksi di ${store.year}.</p>`, 'pos-month');
}

/**
 * Ganti angka (segmen) dan klik sel bulan. onCell(posId, month) dipanggil untuk sel; klik di luar sel
 * diteruskan ke halaman (baris data-pos).
 */
export function bindPosMonthlyCard(root, o, onCell) {
  const cardEl = $('.pos-month', root);
  const wrap = cardEl && $('.pos-month-wrap', cardEl);
  if (!wrap) return;
  bindSegmented(cardEl, 'posMonth', (field) => render(wrap, posMonthlyTable(o, field)));
  on(wrap, 'click', 'td[data-cell-month]', (e, td) => {
    e.stopPropagation(); // jangan ikut membuka rincian pos setahun (klik baris)
    onCell(td.closest('tr').dataset.pos, Number(td.dataset.cellMonth));
  });
}
