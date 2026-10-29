// Dashboard: ringkasan total Fothang dan rincian per pos untuk tahun terpilih.
// Tata letak mengikuti desain referensi: kartu saldo gelap & donatur (kiri), transaksi terbaru (tengah),
// kartu Total Pemasukan & Total Pengeluaran dengan grafik batang kecil (kanan), lalu tren saldo & ringkasan per pos.
// ?pos=<id> menampilkan rincian satu pos; tanpa parameter menampilkan ringkasan semua pos.
// Dua jenis dashboard (tab di kepala halaman):
//   Keseluruhan — setahun penuh (tanpa ?bulan).
//   Per Bulan   — ?bulan=<1-12>: kartu, transaksi terbaru, donatur, dan pemasukan/pengeluaran tiap pos hanya bulan itu;
//                 tabel "per bulan" tetap setahun sebagai pembanding (bulan terpilih disorot).
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, rupiah, dateId, dateShort, MONTHS } from '../core/format.js';
import { miniBarChart, balanceLineChart, rankedBarChart, sparkline, attachTooltips, monthlyFlowChart, flowLegend } from '../components/charts.js';

const throughLabel = (lastMonth, month = null) => {
  if (month) return `Data bulan ${MONTHS[month - 1]} ${store.year}`;
  return lastMonth ? `Data s.d. ${MONTHS[lastMonth - 1]} ${store.year}` : `Belum ada data ${store.year}`;
};

/** Label periode untuk judul kartu: "April" atau "" (setahun). */
const periodLabel = (month) => (month ? MONTHS[month - 1] : '');

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

/** Hash dashboard untuk kombinasi pos & bulan (keduanya opsional). */
function dashboardHash(posId, month) {
  const q = new URLSearchParams();
  if (posId) q.set('pos', String(posId));
  if (month) q.set('bulan', String(month));
  return `#/dashboard${q.size ? `?${q}` : ''}`;
}

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

  render(main, html`
    <div class="view-head">
      <div>
        <h1>${detail ? detail.pos.name : 'Dashboard'}</h1>
        <p class="sub">${throughLabel(overview.last_month, month)} · Pindahan antar pos tidak dihitung sebagai pemasukan/pengeluaran.</p>
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
    <div id="dash">${detail ? posSection(detail, month) : overviewSection(overview, month)}</div>`);

  $('#posFilter', main).addEventListener('change', (e) => (location.hash = dashboardHash(e.target.value, month)));
  // Keseluruhan = setahun; Per Bulan dimulai dari bulan terakhir yang berisi data.
  main.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    location.hash = dashboardHash(posId, b.dataset.mode === 'bulan' ? month || overview.last_month : null);
  }));
  const dash = $('#dash', main);
  attachTooltips(dash);
  // Baris tabel (data-pos) dan batang "Saldo per pos" (data-id) membuka rincian pos.
  on(dash, 'click', '[data-pos], [data-id]', (e, el) => (location.hash = dashboardHash(el.dataset.pos ?? el.dataset.id, month)));
  // Bulan (tombol bulan, baris tabel / batang grafik per bulan) membuka dashboard Per Bulan untuk bulan itu.
  // (dipasang pada elemen halaman ini, bukan `main`, yang dipakai ulang tiap pindah halaman)
  const goMonth = (e, el) => (location.hash = dashboardHash(posId, el.dataset.month));
  on(dash, 'click', '[data-month]', goMonth);
  const strip = $('.month-strip', main);
  if (strip) on(strip, 'click', '[data-month]', goMonth);
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

/**
 * Kartu Pemasukan / Pengeluaran: total periode + grafik 6 bulan.
 * focusMonth = bulan yang disorot & dibandingkan dengan bulan sebelumnya (bulan terpilih, atau bulan terakhir berisi data).
 */
function flowCard({ title, total, months, focusMonth, field, tone, upIsGood }) {
  return html`
    <section class="dcard flow">
      <header><div><h2>${title}</h2></div></header>
      <div class="flow-total">${bigMoney(total)} ${changePill(months, focusMonth, field, { upIsGood })}</div>
      ${miniBarChart(months, field, { lastMonth: focusMonth, tone, label: title })}
    </section>`;
}

/** Kedua kartu arus kas (kolom kanan) untuk periode setahun atau satu bulan. */
function flowCards(data, total, month) {
  const p = periodLabel(month);
  const common = { months: data.months, focusMonth: month || data.last_month };
  return html`
    ${flowCard({ ...common, title: p ? `Pemasukan ${p}` : 'Total Pemasukan', total: total.masuk, field: 'masuk', tone: 'accent', upIsGood: true })}
    ${flowCard({ ...common, title: p ? `Pengeluaran ${p}` : 'Total Pengeluaran', total: total.keluar, field: 'keluar', tone: 'ink', upIsGood: false })}`;
}

function recentCard(rows, { showPos = true, month = null } = {}) {
  const sub = month ? `Transaksi terakhir di bulan ${MONTHS[month - 1]}` : 'Transaksi paling akhir yang tercatat';
  const empty = month ? `Belum ada transaksi di ${MONTHS[month - 1]} ${store.year}.` : `Belum ada transaksi di ${store.year}.`;
  return card('Transaksi terbaru', sub, html`
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
      </div>` : html`<p class="muted empty">${empty}</p>`}
    <div class="card-foot"><a class="btn" href="#/draf${month ? `?month=${month}` : ''}">Lihat semua di Draf</a></div>`, 'recent');
}

function donorCard(donors, month = null) {
  const sub = month ? `Bulan ${MONTHS[month - 1]} · pos yang memakai Daftar Donatur` : 'Dari pos yang memakai Daftar Donatur';
  return card('Donatur terbesar', sub, donors.length ? html`
    <ol class="donor-list">${donors.slice(0, 6).map((d) => html`
      <li><i class="tx-avatar" aria-hidden="true">${initials(d.label)}</i><span>${d.label}</span><b class="num">${money(d.amount)}</b></li>`)}
    </ol>` : html`<p class="muted empty">Belum ada data donatur${month ? ' di bulan ini' : ''}.</p>`);
}

/**
 * Pemasukan & pengeluaran setiap bulan (selalu setahun): grafik batang berpasangan + tabel.
 * Tiap baris: saldo awal + pemasukan − pengeluaran + pindahan = saldo akhir.
 * Kolom Pindahan hanya tampil bila ada (di ringkasan semua pos nilainya selalu 0).
 * @param {{months: object[], lastMonth: number, opening: number, selected: number|null, hint: string}} p
 *   opening = saldo awal TAHUN; selected = bulan yang sedang dipilih (disorot); hint = arti klik pada bulan
 */
function monthlyCard({ months, lastMonth, opening, selected, hint }) {
  const shown = months.filter((m) => m.month <= lastMonth);
  const showTransfer = shown.some((m) => m.pindahan);
  const total = (field) => Math.round(shown.reduce((s, m) => s + m[field] * 100, 0)) / 100;
  const selisih = (m) => Math.round((m.masuk - m.keluar) * 100) / 100;
  const openingOf = (i) => (i ? shown[i - 1].saldo : opening);

  return card('Pemasukan & Pengeluaran per bulan', hint, shown.length ? html`
    <div class="monthly-legend">${flowLegend()}</div>
    <div class="monthly-body">
    <div>${monthlyFlowChart(months, { lastMonth, selected })}</div>
    <div class="table-wrap flat"><table class="table monthly-table">
      <thead><tr><th>Bulan</th><th class="num">Saldo awal</th><th class="num">Pemasukan</th><th class="num">Pengeluaran</th>
        ${showTransfer ? html`<th class="num">Pindahan</th>` : ''}<th class="num">Selisih</th><th class="num">Saldo akhir</th></tr></thead>
      <tbody>${shown.map((m, i) => html`
        <tr class="clickable ${m.month === selected ? 'selected' : ''}" data-month="${m.month}" title="${MONTHS[m.month - 1]}: ${hint}"
          ${m.month === selected ? 'aria-current="true"' : ''}>
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
    </div>` : html`<p class="muted empty">Belum ada transaksi di ${store.year}.</p>`, 'monthly');
}

// ---------------------------------------------------------------- Semua pos

function overviewSection(o, month) {
  const t = o.totals;
  const p = periodLabel(month);
  const byBalance = [...o.pos].sort((a, b) => b.closing - a.closing).filter((x) => x.closing !== 0 || x.count);
  const note = month
    ? html`Saldo per akhir ${p} ${store.year}${t.belum_dialokasikan ? html` · <span class="status bad">⚠ ${t.belum_dialokasikan} belum punya pos</span>` : ''}`
    : html`${bankStatus(t)}${t.belum_dialokasikan ? html` · <span class="status bad">⚠ ${t.belum_dialokasikan} belum punya pos</span>` : ''}`;
  // Keseluruhan: tabel per bulan dulu, lalu grafik saldo & ringkasan per pos.
  // Per Bulan: pemasukan/pengeluaran tiap pos di bulan itu dulu, lalu perbandingan dengan bulan lain.
  const monthly = monthlyCard({
    months: o.months, lastMonth: o.last_month, opening: o.year_opening, selected: month,
    hint: month ? `${p} disorot · klik bulan lain untuk berpindah` : 'Klik bulan untuk membuka dashboard Per Bulan',
  });
  const balanceByPos = card('Saldo per pos', `${p ? `Per akhir ${p} · ` : ''}Klik untuk melihat rincian pos`,
    rankedBarChart(byBalance.map((x) => ({ label: x.name, value: x.closing, id: x.pos_id }))), 'clickable-bars');
  const posTable = posSummaryCard(o, month);
  return html`
    <div class="dash-top">
      <div class="col">
        ${balanceHero({
          title: 'Total Saldo', subtitle: `Semua pos · saldo awal ${p ? `${p} ` : ''}${rupiah(t.opening)}`, amount: t.saldo,
          inner: { label: p ? `Saldo akhir ${p}, semua pos` : 'Saldo semua pos', note },
        })}
        ${donorCard(o.donors, month)}
      </div>
      <div class="col">${recentCard(o.recent, { month })}</div>
      <div class="col">${flowCards(o, t, month)}</div>
    </div>

    ${month ? html`${posTable}${monthly}${balanceByPos}` : html`
      ${monthly}
      <div class="dash-grid">
        ${card('Saldo total per bulan', 'Saldo akhir bulan, semua pos', balanceLineChart(o.months, { label: 'Saldo total' }))}
        ${balanceByPos}
      </div>
      ${posTable}`}`;
}

/**
 * Tabel ringkasan per pos. Keseluruhan: setahun dengan tren saldo.
 * Per Bulan: pemasukan, pengeluaran, dan selisih tiap pos di bulan itu (pos aktif di bulan itu di atas).
 */
function posSummaryCard(o, month) {
  const t = o.totals;
  const p = periodLabel(month);
  const diff = (x) => Math.round((x.masuk - x.keluar) * 100) / 100;
  const idle = (x) => Number(!x.masuk && !x.keluar); // 1 = tidak ada transaksi di bulan itu
  const rows = month ? [...o.pos].sort((a, b) => idle(a) - idle(b) || a.number - b.number) : o.pos;
  return html`
    ${card(p ? `Pemasukan & Pengeluaran per pos — ${p} ${store.year}` : 'Ringkasan per pos', 'Klik baris untuk melihat rincian pos', html`
      <div class="table-wrap flat"><table class="table">
        <thead><tr><th>No</th><th>Pos</th><th class="num">Saldo awal${p ? ` ${p}` : ''}</th><th class="num">Masuk</th><th class="num">Keluar</th>
          ${month ? html`<th class="num">Selisih</th>` : ''}<th class="num">Pindahan</th><th class="num">Saldo akhir</th>${month ? '' : html`<th>Tren saldo</th>`}</tr></thead>
        <tbody>${rows.map((x) => html`
          <tr class="clickable ${month && idle(x) ? 'idle' : ''}" data-pos="${x.pos_id}">
            <td>${x.number}</td><td><b>${x.name}</b> <span class="muted mono">${x.code}</span></td>
            <td class="${numClass(x.opening)}">${money(x.opening)}</td>
            <td class="num in">${x.masuk ? money(x.masuk) : ''}</td>
            <td class="num out">${x.keluar ? money(x.keluar) : ''}</td>
            ${month ? html`<td class="${numClass(diff(x))}">${x.masuk || x.keluar ? `${diff(x) > 0 ? '+' : ''}${money(diff(x))}` : ''}</td>` : ''}
            <td class="${numClass(x.pindahan)}">${x.pindahan ? money(x.pindahan) : ''}</td>
            <td class="${numClass(x.closing)}"><b>${money(x.closing)}</b></td>
            ${month ? '' : html`<td>${sparkline(x.monthly)}</td>`}
          </tr>`)}
        </tbody>
        <tfoot><tr><td></td><td>Total</td><td class="num">${money(t.opening)}</td><td class="num">${money(t.masuk)}</td><td class="num">${money(t.keluar)}</td>
          ${month ? html`<td class="${numClass(diff(t))}">${money(diff(t))}</td>` : ''}<td></td><td class="num">${money(t.saldo)}</td>${month ? '' : html`<td></td>`}</tr></tfoot>
      </table></div>`, 'pos-summary')}`;
}

// ---------------------------------------------------------------- Satu pos

function posSection(d, month) {
  const p = periodLabel(month);
  const pindahan = d.pindahan ? ` · pindahan ${d.pindahan > 0 ? '+' : '−'}${rupiah(Math.abs(d.pindahan))}` : '';
  return html`
    <div class="dash-top">
      <div class="col">
        ${balanceHero({
          title: `Saldo ${d.pos.name}`, subtitle: `Saldo awal ${p ? `${p} ` : ''}${rupiah(d.opening)}${pindahan}`, amount: d.closing,
          inner: { label: p ? `Saldo akhir ${p}` : 'Saldo akhir', note: throughLabel(d.last_month, month) },
        })}
        ${d.donors.length ? donorCard(d.donors, month) : ''}
      </div>
      <div class="col">${recentCard(d.recent, { showPos: false, month })}</div>
      <div class="col">${flowCards(d, d, month)}</div>
    </div>
    ${monthlyCard({
      months: d.months, lastMonth: d.last_month, opening: d.year_opening, selected: month,
      hint: month ? `${p} disorot · klik bulan lain untuk berpindah` : 'Klik bulan untuk membuka dashboard Per Bulan',
    })}
    ${month ? '' : html`<div class="dash-grid">
      ${card(`Saldo ${d.pos.name} per bulan`, 'Saldo akhir bulan', balanceLineChart(d.months, { label: `Saldo ${d.pos.name}` }))}
    </div>`}
    <p class="toolbar"><a class="btn" href="#/tahunan?sheet=${d.pos.id}${month ? `&bulan=${month}` : ''}">Buka sheet ${d.pos.code} di Laporan per Pos →</a></p>`;
}

