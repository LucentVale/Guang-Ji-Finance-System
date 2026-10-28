// Dashboard: ringkasan total Fothang dan rincian per pos untuk tahun terpilih.
// ?pos=<id> menampilkan rincian satu pos; tanpa parameter menampilkan ringkasan semua pos.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, rupiah, dateId, MONTHS } from '../core/format.js';
import { SERIES, monthlyFlowChart, balanceLineChart, rankedBarChart, sparkline, attachTooltips } from '../components/charts.js';

const tile = (label, value, hint = '', cls = '') => html`
  <div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value ${cls}">${value}</div>${hint ? html`<div class="kpi-hint">${hint}</div>` : ''}</div>`;

const card = (title, sub, body, extraClass = '') => html`
  <section class="dash-card ${extraClass}"><header><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</header>${body}</section>`;

/** Status selisih bank: ikon + teks (tidak bergantung pada warna saja). */
function bankStatus(t) {
  if (t.bank == null) return html`<span class="status">— Belum ada saldo dari mutasi bank</span>`;
  return Math.round(t.selisih * 100) === 0
    ? html`<span class="status good">✓ Cocok dengan bank</span>`
    : html`<span class="status bad">⚠ Selisih ${rupiah(t.selisih)}</span>`;
}

const throughLabel = (lastMonth) => (lastMonth ? `Data s.d. ${MONTHS[lastMonth - 1]} ${store.year}` : `Belum ada data ${store.year}`);

export async function dashboardView(main, params) {
  const posId = Number(params.get('pos')) || null;
  const overview = await api.get('/dashboard', { year: store.year });
  const detail = posId ? await api.get(`/dashboard/pos/${posId}`, { year: store.year }) : null;

  render(main, html`
    <div class="view-head">
      <div>
        <h1>Dashboard ${store.fothang.short_name} ${store.year}</h1>
        <p class="sub">${throughLabel(overview.last_month)}. Pindahan antar pos tidak dihitung sebagai pemasukan/pengeluaran.</p>
      </div>
      <label class="inline">Tampilkan
        <select id="posFilter" aria-label="Pilih pos">
          <option value="">Semua pos (total)</option>
          ${overview.pos.map((p) => html`<option value="${p.pos_id}" ${p.pos_id === posId ? 'selected' : ''}>${p.number}. ${p.name}</option>`)}
        </select>
      </label>
    </div>
    <div id="dash">${detail ? posSection(detail) : overviewSection(overview)}</div>`);

  $('#posFilter', main).addEventListener('change', (e) => (location.hash = e.target.value ? `#/dashboard?pos=${e.target.value}` : '#/dashboard'));
  const dash = $('#dash', main);
  attachTooltips(dash);
  on(dash, 'click', '[data-id]', (e, el) => (location.hash = `#/dashboard?pos=${el.dataset.id}`));
}

// ---------------------------------------------------------------- Semua pos

function overviewSection(o) {
  const t = o.totals;
  const byBalance = [...o.pos].sort((a, b) => b.closing - a.closing).filter((p) => p.closing !== 0 || p.count);
  return html`
    <div class="kpi-row">
      ${tile('Total saldo semua pos', rupiah(t.saldo), `Saldo awal ${store.year}: ${rupiah(t.opening)}`, t.saldo < 0 ? 'neg' : '')}
      ${tile('Saldo bank', rupiah(t.bank), html`${t.bank_date ? `per ${dateId(t.bank_date)} · ` : ''}${bankStatus(t)}`)}
      ${tile(`Pemasukan ${store.year}`, rupiah(t.masuk))}
      ${tile(`Pengeluaran ${store.year}`, rupiah(t.keluar))}
      ${tile('Transaksi', t.transaksi.toLocaleString('id-ID'),
        t.belum_dialokasikan ? html`<span class="status bad">⚠ ${t.belum_dialokasikan} belum punya pos</span>` : html`<span class="status good">✓ Semua punya pos</span>`)}
    </div>

    <div class="dash-grid">
      ${card('Pemasukan & pengeluaran per bulan', 'Arahkan kursor ke bulan untuk melihat angkanya', monthlyFlowChart(o.months, { lastMonth: o.last_month }))}
      ${card('Saldo total per bulan', 'Saldo akhir bulan, semua pos', balanceLineChart(o.months, { label: 'Saldo total' }))}
      ${card('Saldo per pos', 'Klik batang untuk melihat rincian pos', rankedBarChart(byBalance.map((p) => ({ label: p.name, value: p.closing, id: p.pos_id }))))}
      ${card('Sumber pemasukan', `Total ${rupiah(t.masuk)}`, rankedBarChart(o.income.map((g) => ({ label: g.label, value: g.amount })), { color: SERIES.masuk }))}
      ${card('Pengeluaran terbesar', `Total ${rupiah(t.keluar)}`, rankedBarChart(o.expense.map((g) => ({ label: g.label, value: g.amount })), { color: SERIES.keluar, labelWidth: 220 }))}
      ${card('Donatur terbesar', 'Dari pos yang memakai Daftar Donatur', donorList(o.donors))}
    </div>

    ${card('Ringkasan per pos', 'Klik baris untuk melihat rincian', html`
      <div class="table-wrap"><table class="table">
        <thead><tr><th>No</th><th>Pos</th><th class="num">Saldo awal</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Pindahan</th><th class="num">Saldo akhir</th><th>Tren saldo</th></tr></thead>
        <tbody>${o.pos.map((p) => html`
          <tr class="clickable" data-id="${p.pos_id}">
            <td>${p.number}</td><td><b>${p.name}</b> <span class="muted mono">${p.code}</span></td>
            <td class="${numClass(p.opening)}">${money(p.opening)}</td>
            <td class="num">${p.masuk ? money(p.masuk) : ''}</td>
            <td class="num">${p.keluar ? money(p.keluar) : ''}</td>
            <td class="${numClass(p.pindahan)}">${p.pindahan ? money(p.pindahan) : ''}</td>
            <td class="${numClass(p.closing)}"><b>${money(p.closing)}</b></td>
            <td>${sparkline(p.monthly)}</td>
          </tr>`)}
        </tbody>
        <tfoot><tr><td></td><td>Total</td><td class="num">${money(t.opening)}</td><td class="num">${money(t.masuk)}</td><td class="num">${money(t.keluar)}</td><td></td><td class="num">${money(t.saldo)}</td><td></td></tr></tfoot>
      </table></div>`, 'wide')}`;
}

// ---------------------------------------------------------------- Satu pos

function posSection(d) {
  return html`
    <div class="kpi-row">
      ${tile(`Saldo awal ${d.year}`, rupiah(d.opening), '', d.opening < 0 ? 'neg' : '')}
      ${tile('Pemasukan', rupiah(d.masuk))}
      ${tile('Pengeluaran', rupiah(d.keluar))}
      ${tile('Pindahan antar pos', rupiah(d.pindahan), 'masuk (+) / keluar (−)')}
      ${tile('Saldo akhir', rupiah(d.closing), throughLabel(d.last_month), d.closing < 0 ? 'neg' : '')}
    </div>
    <div class="dash-grid">
      ${card(`Pemasukan & pengeluaran ${d.pos.name}`, 'Arahkan kursor ke bulan untuk melihat angkanya', monthlyFlowChart(d.months, { lastMonth: d.last_month }))}
      ${card(`Saldo ${d.pos.name} per bulan`, 'Saldo akhir bulan', balanceLineChart(d.months, { label: `Saldo ${d.pos.name}` }))}
      ${card('Sumber pemasukan', `Total ${rupiah(d.masuk)}`, rankedBarChart(d.income.map((g) => ({ label: g.label, value: g.amount })), { color: SERIES.masuk }))}
      ${card('Pengeluaran terbesar', `Total ${rupiah(d.keluar)}`, rankedBarChart(d.expense.map((g) => ({ label: g.label, value: g.amount })), { color: SERIES.keluar, labelWidth: 220 }))}
      ${d.donors.length ? card('Donatur terbesar', '', donorList(d.donors)) : ''}
    </div>
    <p class="toolbar"><a class="btn" href="#/tahunan?sheet=${d.pos.id}">Buka sheet ${d.pos.code} di Laporan per Pos →</a></p>`;
}

function donorList(donors) {
  if (!donors.length) return html`<p class="muted empty">Belum ada data donatur.</p>`;
  return html`<ol class="donor-list">${donors.map((d) => html`<li><span>${d.label}</span><span class="num">${money(d.amount)}</span></li>`)}</ol>`;
}
