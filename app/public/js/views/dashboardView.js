// Dashboard. Dua jenis (tab di kepala halaman), masing-masing untuk semua pos atau satu pos (?pos=<id>):
//   Keseluruhan — setahun penuh (file ini). Tata letak mengikuti desain referensi: kartu saldo gelap & donatur (kiri),
//                 transaksi terbaru (tengah), Total Pemasukan & Total Pengeluaran dengan grafik batang kecil (kanan),
//                 lalu pemasukan & pengeluaran per bulan, tren saldo, dan ringkasan per pos.
//   Per Bulan   — ?bulan=<1-12>: dashboard khusus satu bulan (views/dashboardMonth.js).
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, rupiah, dateId, dateShort, MONTHS } from '../core/format.js';
import { miniBarChart, balanceLineChart, rankedBarChart, attachTooltips, monthlyFlowChart, flowLegend } from '../components/charts.js';
import { bigMoney, card, donorCard, posSummaryCard, initials, minus, signed } from '../components/dashboardCards.js';
import { renderMonthDashboard } from './dashboardMonth.js';

const throughLabel = (lastMonth) => (lastMonth ? `Data s.d. ${MONTHS[lastMonth - 1]} ${store.year}` : `Belum ada data ${store.year}`);

/** Perubahan bulan terakhir vs bulan sebelumnya (ikon + teks, tidak hanya warna). */
function changePill(months, lastMonth, field, { upIsGood }) {
  if (lastMonth < 2) return '';
  const cur = months[lastMonth - 1][field];
  const prev = months[lastMonth - 2][field];
  if (!prev) return '';
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  const good = up === upIsGood;
  return html`<span class="change ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pct)}% vs ${MONTHS[lastMonth - 2].slice(0, 3)}</span>`;
}

/** Status kecocokan dengan bank: ikon + teks. */
function bankStatus(t) {
  if (t.bank == null) return html`<span class="status">— Belum ada saldo dari mutasi bank</span>`;
  return Math.round(t.selisih * 100) === 0
    ? html`<span class="status good">✓ Cocok dengan bank${t.bank_date ? ` per ${dateId(t.bank_date)}` : ''}</span>`
    : html`<span class="status bad">⚠ Selisih ${rupiah(t.selisih)}</span>`;
}

/** Keterangan kecil di bawah nama: kategori (mis. PELITA), atau nama pos bila kategorinya tidak menambah informasi. */
const subLabel = (r) => (r.category && r.category !== 'DONATUR' && r.category !== String(r.name).toUpperCase() ? r.category : r.pos_name);

/** Hash dashboard untuk kombinasi pos & bulan (keduanya opsional; tanpa bulan = Keseluruhan). */
function dashboardHash(posId, month) {
  const q = new URLSearchParams();
  if (posId) q.set('pos', String(posId));
  if (month) q.set('bulan', String(month));
  return `#/dashboard${q.size ? `?${q}` : ''}`;
}

/** Gambar ulang halaman (mis. setelah transaksi diubah dari dashboard Per Bulan). */
const rerenderView = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

export async function dashboardView(main, params) {
  const posId = Number(params.get('pos')) || null;
  const requested = Number(params.get('bulan'));
  const askMonth = requested >= 1 && requested <= 12 ? requested : null;
  const query = { year: store.year, ...(askMonth ? { month: askMonth } : {}) };
  const [overview, detail] = await Promise.all([
    api.get('/dashboard', query),
    posId ? api.get(`/dashboard/pos/${posId}`, query) : null,
  ]);
  // Bulan hanya bisa dipilih sampai bulan terakhir yang berisi data.
  const month = askMonth && askMonth <= overview.last_month ? askMonth : null;
  if (askMonth && !month) return void location.replace(dashboardHash(posId, null));

  const sub = month
    ? `Dashboard bulan ${MONTHS[month - 1]} ${store.year} · pindahan antar pos tidak dihitung sebagai pemasukan/pengeluaran.`
    : `${throughLabel(overview.last_month)} · Pindahan antar pos tidak dihitung sebagai pemasukan/pengeluaran.`;
  render(main, html`
    <div class="view-head">
      <div>
        <h1>${detail ? detail.pos.name : 'Dashboard'}${month ? html` <span class="title-month">${MONTHS[month - 1]} ${store.year}</span>` : ''}</h1>
        <p class="sub">${sub}</p>
      </div>
      <div class="view-filters">
        <div class="segmented" role="tablist" aria-label="Jenis dashboard">
          <button role="tab" data-mode="tahun" class="${month ? '' : 'on'}" aria-selected="${!month}">Keseluruhan</button>
          <button role="tab" data-mode="bulan" class="${month ? 'on' : ''}" aria-selected="${!!month}" ${overview.last_month ? '' : 'disabled'}>Per Bulan</button>
        </div>
        <label class="pill-select"><span>Tampilkan</span>
          <select id="posFilter" aria-label="Pilih pos">
            <option value="">Semua pos</option>
            ${overview.pos.map((p) => html`<option value="${p.pos_id}" ${p.pos_id === posId ? 'selected' : ''}>${p.number}. ${p.name}</option>`)}
          </select>
        </label>
      </div>
    </div>
    ${month ? monthStrip(overview.last_month, month) : ''}
    <div id="dash">${month ? html`<div class="empty">Memuat…</div>` : detail ? posSection(detail) : overviewSection(overview)}</div>`);

  $('#posFilter', main).addEventListener('change', (e) => (location.hash = dashboardHash(e.target.value, month)));
  // Keseluruhan = setahun; Per Bulan dimulai dari bulan terakhir yang berisi data.
  main.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    location.hash = dashboardHash(posId, b.dataset.mode === 'bulan' ? month || overview.last_month : null);
  }));
  const dash = $('#dash', main);
  attachTooltips(dash);
  // Baris "per pos" (data-pos) dan batang "Saldo per pos" (data-id) membuka rincian pos, di jenis dashboard yang sama.
  on(dash, 'click', '[data-pos], [data-id]', (e, el) => (location.hash = dashboardHash(el.dataset.pos ?? el.dataset.id, month)));
  // Bulan (tombol bulan, baris tabel / batang grafik per bulan) membuka dashboard Per Bulan untuk bulan itu.
  // (dipasang pada elemen halaman ini, bukan `main`, yang dipakai ulang tiap pindah halaman)
  const goMonth = (e, el) => (location.hash = dashboardHash(posId, el.dataset.month));
  on(dash, 'click', '[data-month]', goMonth);
  const strip = $('.month-strip', main);
  if (strip) on(strip, 'click', '[data-month]', goMonth);

  if (month) await renderMonthDashboard(dash, { data: detail || overview, month, posId, overview, onChanged: rerenderView });
}

/** Deretan tombol bulan untuk dashboard Per Bulan (hanya bulan yang sudah berisi data). */
function monthStrip(lastMonth, month) {
  return html`
    <nav class="month-strip" aria-label="Pilih bulan">
      <button data-month="${month - 1}" ${month > 1 ? '' : 'disabled'} aria-label="Bulan sebelumnya">‹</button>
      ${MONTHS.slice(0, lastMonth).map((m, i) => html`
        <button data-month="${i + 1}" class="${i + 1 === month ? 'on' : ''}" ${i + 1 === month ? 'aria-current="true"' : ''}>${m.slice(0, 3)}</button>`)}
      <button data-month="${month + 1}" ${month < lastMonth ? '' : 'disabled'} aria-label="Bulan berikutnya">›</button>
    </nav>`;
}

// ---------------------------------------------------------------- Bagian-bagian kartu (Keseluruhan)

/** Kartu gelap saldo utama (seperti "Total Balance" di desain referensi). */
function balanceHero({ title, subtitle, amount, inner }) {
  return html`
    <section class="hero">
      <div class="hero-top"><div><h2>${title}</h2><p>${subtitle}</p></div><span class="hero-year">${store.year}</span></div>
      <div class="hero-inner">
        <p class="label">${inner.label}</p>
        <div class="hero-amount">${bigMoney(amount)}</div>
        <p class="hero-note">${inner.note}</p>
        <div class="hero-actions">
          <a href="#/mutasi"><span aria-hidden="true">⇪</span> Impor Mutasi</a>
          <a href="#/laporan"><span aria-hidden="true">⎙</span> Laporan PDF</a>
        </div>
      </div>
    </section>`;
}

/** Kartu Total Pemasukan / Total Pengeluaran: total setahun + grafik 6 bulan terakhir. */
function flowCard(title, total, months, lastMonth, field, tone, upIsGood) {
  return html`
    <section class="dcard flow">
      <header><div><h2>${title}</h2></div></header>
      <div class="flow-total">${bigMoney(total)} ${changePill(months, lastMonth, field, { upIsGood })}</div>
      ${miniBarChart(months, field, { lastMonth, tone, label: title })}
    </section>`;
}

/** @param {{showPos?: boolean, lastMonth: number}} options lastMonth = bulan terakhir berisi data (dibuka di Draf) */
function recentCard(rows, { showPos = true, lastMonth }) {
  return card('Transaksi terbaru', 'Transaksi paling akhir yang tercatat', html`
    ${rows.length ? html`
      <div class="tx-list ${showPos ? '' : 'no-pos'}">
        <div class="tx-row tx-head"><span>Nama</span><span>Tanggal</span>${showPos ? html`<span>Pos</span>` : ''}<span class="num">Jumlah</span></div>
        ${rows.map((r) => html`
          <div class="tx-row">
            <span class="tx-name"><i class="tx-avatar ${r.amount < 0 ? 'out' : ''}" aria-hidden="true">${initials(r.name)}</i>
              <span><b>${r.name}</b><small>${subLabel(r)}</small></span></span>
            <span class="muted">${dateShort(r.date)}</span>
            ${showPos ? html`<span><span class="pos-pill">${r.pos || '—'}</span></span>` : ''}
            <span class="num tx-amount ${r.amount < 0 ? 'out' : 'in'}">${r.amount < 0 ? '−' : '+'} ${money(Math.abs(r.amount))}</span>
          </div>`)}
      </div>` : html`<p class="muted empty">Belum ada transaksi di ${store.year}.</p>`}
    <div class="card-foot"><a class="btn" href="#/draf${lastMonth ? `?month=${lastMonth}` : ''}">Lihat semua di Draf</a></div>`, 'recent');
}

/**
 * Pemasukan & pengeluaran setiap bulan: grafik batang berpasangan + tabel.
 * Tiap baris: saldo awal + pemasukan − pengeluaran + pindahan = saldo akhir.
 * Kolom Pindahan hanya tampil bila ada (di ringkasan semua pos nilainya selalu 0). Klik bulan = dashboard Per Bulan.
 * @param {{months: object[], lastMonth: number, opening: number}} p opening = saldo awal tahun
 */
function monthlyCard({ months, lastMonth, opening }) {
  const shown = months.filter((m) => m.month <= lastMonth);
  const showTransfer = shown.some((m) => m.pindahan);
  const total = (field) => Math.round(shown.reduce((s, m) => s + m[field] * 100, 0)) / 100;
  const openingOf = (i) => (i ? shown[i - 1].saldo : opening);

  return card('Pemasukan & Pengeluaran per bulan', 'Klik bulan untuk membuka dashboard Per Bulan', shown.length ? html`
    <div class="monthly-legend">${flowLegend()}</div>
    <div class="monthly-body">
    <div>${monthlyFlowChart(months, { lastMonth })}</div>
    <div class="table-wrap flat"><table class="table monthly-table">
      <thead><tr><th>Bulan</th><th class="num">Saldo awal</th><th class="num">Pemasukan</th><th class="num">Pengeluaran</th>
        ${showTransfer ? html`<th class="num">Pindahan</th>` : ''}<th class="num">Selisih</th><th class="num">Saldo akhir</th></tr></thead>
      <tbody>${shown.map((m, i) => html`
        <tr class="clickable" data-month="${m.month}" title="Buka dashboard ${MONTHS[m.month - 1]}">
          <td><b>${MONTHS[m.month - 1]}</b></td>
          <td class="${numClass(openingOf(i))}">${money(openingOf(i))}</td>
          <td class="num in">${m.masuk ? money(m.masuk) : '–'}</td>
          <td class="num out">${m.keluar ? money(m.keluar) : '–'}</td>
          ${showTransfer ? html`<td class="${numClass(m.pindahan)}">${m.pindahan ? signed(m.pindahan) : ''}</td>` : ''}
          <td class="${numClass(minus(m.masuk, m.keluar))}">${signed(minus(m.masuk, m.keluar))}</td>
          <td class="${numClass(m.saldo)}"><b>${money(m.saldo)}</b></td>
        </tr>`)}
      </tbody>
      <tfoot><tr><td>Total ${store.year}</td><td class="${numClass(opening)}">${money(opening)}</td>
        <td class="num">${money(total('masuk'))}</td><td class="num">${money(total('keluar'))}</td>
        ${showTransfer ? html`<td class="${numClass(total('pindahan'))}">${money(total('pindahan'))}</td>` : ''}
        <td class="${numClass(minus(total('masuk'), total('keluar')))}">${money(minus(total('masuk'), total('keluar')))}</td>
        <td class="${numClass(shown.at(-1).saldo)}">${money(shown.at(-1).saldo)}</td></tr></tfoot>
    </table></div>
    </div>` : html`<p class="muted empty">Belum ada transaksi di ${store.year}.</p>`, 'monthly');
}

// ---------------------------------------------------------------- Semua pos

function overviewSection(o) {
  const t = o.totals;
  const byBalance = [...o.pos].sort((a, b) => b.closing - a.closing).filter((p) => p.closing !== 0 || p.count);
  return html`
    <div class="dash-top">
      <div class="col">
        ${balanceHero({
          title: 'Total Saldo', subtitle: `Semua pos · saldo awal ${rupiah(t.opening)}`, amount: t.saldo,
          inner: { label: 'Saldo semua pos', note: html`${bankStatus(t)}${t.belum_dialokasikan ? html` · <span class="status bad">⚠ ${t.belum_dialokasikan} belum punya pos</span>` : ''}` },
        })}
        ${donorCard(o.donors)}
      </div>
      <div class="col">${recentCard(o.recent, { lastMonth: o.last_month })}</div>
      <div class="col">
        ${flowCard('Total Pemasukan', t.masuk, o.months, o.last_month, 'masuk', 'accent', true)}
        ${flowCard('Total Pengeluaran', t.keluar, o.months, o.last_month, 'keluar', 'ink', false)}
      </div>
    </div>

    ${monthlyCard({ months: o.months, lastMonth: o.last_month, opening: o.year_opening })}

    <div class="dash-grid">
      ${card('Saldo total per bulan', 'Saldo akhir bulan, semua pos', balanceLineChart(o.months, { label: 'Saldo total' }))}
      ${card('Saldo per pos', 'Klik untuk melihat rincian pos', rankedBarChart(byBalance.map((p) => ({ label: p.name, value: p.closing, id: p.pos_id }))), 'clickable-bars')}
    </div>

    ${posSummaryCard(o)}`;
}

// ---------------------------------------------------------------- Satu pos

function posSection(d) {
  const pindahan = d.pindahan ? ` · pindahan ${d.pindahan > 0 ? '+' : '−'}${rupiah(Math.abs(d.pindahan))}` : '';
  return html`
    <div class="dash-top">
      <div class="col">
        ${balanceHero({
          title: `Saldo ${d.pos.name}`, subtitle: `Saldo awal ${rupiah(d.opening)}${pindahan}`, amount: d.closing,
          inner: { label: 'Saldo akhir', note: throughLabel(d.last_month) },
        })}
        ${d.donors.length ? donorCard(d.donors) : ''}
      </div>
      <div class="col">${recentCard(d.recent, { showPos: false, lastMonth: d.last_month })}</div>
      <div class="col">
        ${flowCard('Total Pemasukan', d.masuk, d.months, d.last_month, 'masuk', 'accent', true)}
        ${flowCard('Total Pengeluaran', d.keluar, d.months, d.last_month, 'keluar', 'ink', false)}
      </div>
    </div>
    ${monthlyCard({ months: d.months, lastMonth: d.last_month, opening: d.year_opening })}
    <div class="dash-grid">
      ${card(`Saldo ${d.pos.name} per bulan`, 'Saldo akhir bulan', balanceLineChart(d.months, { label: `Saldo ${d.pos.name}` }))}
    </div>
    <p class="toolbar"><a class="btn" href="#/tahunan?sheet=${d.pos.id}">Buka sheet ${d.pos.code} di Laporan per Pos →</a></p>`;
}
