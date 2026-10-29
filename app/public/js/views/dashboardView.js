// Dashboard: ringkasan total Fothang dan rincian per pos untuk tahun terpilih.
// Tata letak mengikuti desain referensi: kartu saldo gelap & donatur (kiri), transaksi terbaru (tengah),
// kartu Total Pemasukan & Total Pengeluaran dengan grafik batang kecil (kanan), lalu tren saldo & ringkasan per pos.
// ?pos=<id> menampilkan rincian satu pos; tanpa parameter menampilkan ringkasan semua pos.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, rupiah, dateId, dateShort, MONTHS } from '../core/format.js';
import { miniBarChart, balanceLineChart, rankedBarChart, sparkline, attachTooltips, monthlyFlowChart, flowLegend } from '../components/charts.js';

const throughLabel = (lastMonth) => (lastMonth ? `Data s.d. ${MONTHS[lastMonth - 1]} ${store.year}` : `Belum ada data ${store.year}`);

/** Angka besar dengan sen dibuat samar, mis. "Rp 327.994.469" + ",24". */
function bigMoney(n) {
  if (n == null) return html`<span class="muted">—</span>`;
  const [whole, cents] = money(Math.abs(n)).split(',');
  return html`<span class="${n < 0 ? 'neg' : ''}">${n < 0 ? '−' : ''}Rp ${whole}<span class="cents">,${cents}</span></span>`;
}

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

const initials = (text) => String(text || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '#';

const card = (title, sub, body, cls = '') => html`
  <section class="dcard ${cls}"><header><div><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div></header>${body}</section>`;

export async function dashboardView(main, params) {
  const posId = Number(params.get('pos')) || null;
  const overview = await api.get('/dashboard', { year: store.year });
  const detail = posId ? await api.get(`/dashboard/pos/${posId}`, { year: store.year }) : null;

  render(main, html`
    <div class="view-head">
      <div>
        <h1>${detail ? detail.pos.name : 'Dashboard'}</h1>
        <p class="sub">${throughLabel(overview.last_month)} · Pindahan antar pos tidak dihitung sebagai pemasukan/pengeluaran.</p>
      </div>
      <label class="pill-select"><span>Tampilkan</span>
        <select id="posFilter" aria-label="Pilih pos">
          <option value="">Semua pos</option>
          ${overview.pos.map((p) => html`<option value="${p.pos_id}" ${p.pos_id === posId ? 'selected' : ''}>${p.number}. ${p.name}</option>`)}
        </select>
      </label>
    </div>
    <div id="dash">${detail ? posSection(detail) : overviewSection(overview)}</div>`);

  $('#posFilter', main).addEventListener('change', (e) => (location.hash = e.target.value ? `#/dashboard?pos=${e.target.value}` : '#/dashboard'));
  const dash = $('#dash', main);
  attachTooltips(dash);
  // Baris tabel (data-pos) dan batang "Saldo per pos" (data-id) membuka rincian pos.
  on(dash, 'click', '[data-pos], [data-id]', (e, el) => (location.hash = `#/dashboard?pos=${el.dataset.pos ?? el.dataset.id}`));
  // Rincian satu pos: bulan (baris tabel / batang grafik per bulan) membuka bulan itu di Laporan per Pos.
  if (detail) on(dash, 'click', '[data-month]', (e, el) => (location.hash = `#/tahunan?sheet=${detail.pos.id}&bulan=${el.dataset.month}`));
}

// ---------------------------------------------------------------- Bagian-bagian kartu

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

function flowCard(title, total, months, lastMonth, field, tone, upIsGood) {
  return html`
    <section class="dcard flow">
      <header><div><h2>${title}</h2></div></header>
      <div class="flow-total">${bigMoney(total)} ${changePill(months, lastMonth, field, { upIsGood })}</div>
      ${miniBarChart(months, field, { lastMonth, tone, label: title })}
    </section>`;
}

function recentCard(rows, { showPos = true } = {}) {
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
    <div class="card-foot"><a class="btn" href="#/draf">Lihat semua di Draf</a></div>`, 'recent');
}

function donorCard(donors) {
  return card('Donatur terbesar', 'Dari pos yang memakai Daftar Donatur', donors.length ? html`
    <ol class="donor-list">${donors.slice(0, 6).map((d) => html`
      <li><i class="tx-avatar" aria-hidden="true">${initials(d.label)}</i><span>${d.label}</span><b class="num">${money(d.amount)}</b></li>`)}
    </ol>` : html`<p class="muted empty">Belum ada data donatur.</p>`);
}

/**
 * Pemasukan & pengeluaran setiap bulan: grafik batang berpasangan + tabel.
 * Tiap baris: saldo awal + pemasukan − pengeluaran + pindahan = saldo akhir.
 * Kolom Pindahan hanya tampil bila ada (di ringkasan semua pos nilainya selalu 0).
 * @param {{months: object[], lastMonth: number, opening: number, clickable: boolean}} p
 */
function monthlyCard({ months, lastMonth, opening, clickable }) {
  const shown = months.filter((m) => m.month <= lastMonth);
  const showTransfer = shown.some((m) => m.pindahan);
  const total = (field) => Math.round(shown.reduce((s, m) => s + m[field] * 100, 0)) / 100;
  const selisih = (m) => Math.round((m.masuk - m.keluar) * 100) / 100;
  const openingOf = (i) => (i ? shown[i - 1].saldo : opening);
  const sub = clickable ? 'Klik bulan untuk membuka transaksinya di Laporan per Pos' : 'Semua pos · pindahan antar pos tidak dihitung';

  return card('Pemasukan & Pengeluaran per bulan', sub, shown.length ? html`
    <div class="monthly-legend">${flowLegend()}</div>
    <div class="monthly-body">
    <div>${monthlyFlowChart(months, { lastMonth })}</div>
    <div class="table-wrap flat"><table class="table monthly-table">
      <thead><tr><th>Bulan</th><th class="num">Saldo awal</th><th class="num">Pemasukan</th><th class="num">Pengeluaran</th>
        ${showTransfer ? html`<th class="num">Pindahan</th>` : ''}<th class="num">Selisih</th><th class="num">Saldo akhir</th></tr></thead>
      <tbody>${shown.map((m, i) => html`
        <tr class="${clickable ? 'clickable' : ''}" ${clickable ? html`data-month="${m.month}" title="Buka ${MONTHS[m.month - 1]} di Laporan per Pos"` : ''}>
          <td><b>${MONTHS[m.month - 1]}</b></td>
          <td class="${numClass(openingOf(i))}">${money(openingOf(i))}</td>
          <td class="num in">${m.masuk ? money(m.masuk) : '–'}</td>
          <td class="num out">${m.keluar ? money(m.keluar) : '–'}</td>
          ${showTransfer ? html`<td class="${numClass(m.pindahan)}">${m.pindahan ? `${m.pindahan > 0 ? '+' : ''}${money(m.pindahan)}` : ''}</td>` : ''}
          <td class="${numClass(selisih(m))}">${selisih(m) > 0 ? '+' : ''}${money(selisih(m))}</td>
          <td class="${numClass(m.saldo)}"><b>${money(m.saldo)}</b></td>
        </tr>`)}
      </tbody>
      <tfoot><tr><td>Total ${store.year}</td><td class="${numClass(opening)}">${money(opening)}</td>
        <td class="num">${money(total('masuk'))}</td><td class="num">${money(total('keluar'))}</td>
        ${showTransfer ? html`<td class="${numClass(total('pindahan'))}">${money(total('pindahan'))}</td>` : ''}
        <td class="${numClass(total('masuk') - total('keluar'))}">${money(Math.round((total('masuk') - total('keluar')) * 100) / 100)}</td>
        <td class="${numClass(shown.at(-1).saldo)}">${money(shown.at(-1).saldo)}</td></tr></tfoot>
    </table></div>
    </div>` : html`<p class="muted empty">Belum ada transaksi di ${store.year}.</p>`, clickable ? 'monthly' : 'monthly static');
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
      <div class="col">${recentCard(o.recent)}</div>
      <div class="col">
        ${flowCard('Total Pemasukan', t.masuk, o.months, o.last_month, 'masuk', 'accent', true)}
        ${flowCard('Total Pengeluaran', t.keluar, o.months, o.last_month, 'keluar', 'ink', false)}
      </div>
    </div>

    ${monthlyCard({ months: o.months, lastMonth: o.last_month, opening: t.opening, clickable: false })}

    <div class="dash-grid">
      ${card('Saldo total per bulan', 'Saldo akhir bulan, semua pos', balanceLineChart(o.months, { label: 'Saldo total' }))}
      ${card('Saldo per pos', 'Klik untuk melihat rincian pos', rankedBarChart(byBalance.map((p) => ({ label: p.name, value: p.closing, id: p.pos_id }))), 'clickable-bars')}
    </div>

    ${card('Ringkasan per pos', 'Klik baris untuk melihat rincian', html`
      <div class="table-wrap flat"><table class="table">
        <thead><tr><th>No</th><th>Pos</th><th class="num">Saldo awal</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Pindahan</th><th class="num">Saldo akhir</th><th>Tren saldo</th></tr></thead>
        <tbody>${o.pos.map((p) => html`
          <tr class="clickable" data-pos="${p.pos_id}">
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
      </table></div>`)}`;
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
      <div class="col">${recentCard(d.recent, { showPos: false })}</div>
      <div class="col">
        ${flowCard('Total Pemasukan', d.masuk, d.months, d.last_month, 'masuk', 'accent', true)}
        ${flowCard('Total Pengeluaran', d.keluar, d.months, d.last_month, 'keluar', 'ink', false)}
      </div>
    </div>
    ${monthlyCard({ months: d.months, lastMonth: d.last_month, opening: d.opening, clickable: true })}
    <div class="dash-grid">
      ${card(`Saldo ${d.pos.name} per bulan`, 'Saldo akhir bulan', balanceLineChart(d.months, { label: `Saldo ${d.pos.name}` }))}
    </div>
    <p class="toolbar"><a class="btn" href="#/tahunan?sheet=${d.pos.id}">Buka sheet ${d.pos.code} di Laporan per Pos →</a></p>`;
}
