// Halaman Data: mengelola data yang sudah tersimpan (dibagi per tab).
//   - Mutasi per bulan: lihat & hapus baris hasil impor rekening koran (satu baris atau sebulan sekaligus)
//   - Semua transaksi: cari & saring setahun, ganti pos banyak baris, ekspor Excel (dataTransaksi.js)
//   - Donatur: daftar per nama, riwayat, gabungkan ejaan nama (dataDonatur.js)
//   - Kategori: jumlah & total per kategori, ganti nama / gabungkan (dataKategori.js)
// Ditambah tombol "Template Data" untuk mengunduh file berbentuk seragam (kosong atau berisi data).
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, dateShort, MONTHS } from '../core/format.js';
import { attempt, openModal, toast } from '../components/feedback.js';
import { accountOptions, defaultMonth, monthOptions } from '../components/options.js';
import { transaksiTab } from './dataTransaksi.js';
import { donaturTab } from './dataDonatur.js';
import { kategoriTab } from './dataKategori.js';

const TABS = [
  { id: 'mutasi', label: 'Mutasi per bulan', render: mutasiTab },
  { id: 'transaksi', label: 'Semua transaksi', render: transaksiTab },
  { id: 'donatur', label: 'Donatur', render: donaturTab },
  { id: 'kategori', label: 'Kategori', render: kategoriTab },
];

const round = (x) => Math.round(x * 100) / 100;
const sum = (rows, field) => round(rows.reduce((t, r) => t + r[field], 0));

export async function dataView(main, params) {
  const tab = TABS.find((t) => t.id === params.get('tab')) || TABS[0];
  render(main, html`
    <div class="view-head">
      <div>
        <h1>Data</h1>
        <p class="sub">Kelola data yang sudah tersimpan. Setiap penghapusan tercatat di Riwayat.</p>
      </div>
      <div class="toolbar">
        <button type="button" id="openTemplate" title="File Excel berbentuk seragam untuk semua vihara">⭳ Template Data</button>
      </div>
    </div>
    <nav class="data-tabs" aria-label="Bagian halaman Data">
      ${TABS.map((t) => html`<a href="#/data?tab=${t.id}" class="${t === tab ? 'on' : ''}" ${t === tab ? 'aria-current="page"' : ''}>${t.label}</a>`)}
    </nav>
    <div id="dataTab"></div>`);
  $('#openTemplate', main).addEventListener('click', openTemplateDialog);
  await tab.render($('#dataTab', main), params, () => dataView(main, params));
}

// ---------------------------------------------------------------- Template Data

/** Dialog unduh Template Data: kosong (untuk diisi vihara) atau berisi data setahun / sebulan. */
function openTemplateDialog() {
  const { root, close } = openModal({
    title: 'Unduh Template Data',
    body: html`
      <p>File Excel berbentuk seragam untuk semua vihara: satu baris satu transaksi, dengan petunjuk pengisian
        dan pilihan Pos/Akun/Kategori milik Fothang ini.</p>
      <form class="form-grid" id="templateForm">
        <label class="full">Isi file
          <select name="kosong">
            <option value="1">Kosong — untuk diisi</option>
            <option value="0">Berisi data yang sudah ada</option>
          </select>
        </label>
        <label>Bulan
          <select name="month" disabled>${monthOptions('', { empty: `Setahun ${store.year}` })}</select>
        </label>
        <label>Akun
          <select name="account_id" disabled><option value="">Semua akun</option>${accountOptions('')}</select>
        </label>
      </form>
      <p class="muted">Pindahan antar pos tidak ikut di template.</p>`,
    footer: html`<button type="button" data-close>Batal</button>
      <a class="btn btn-primary" id="templateDownload" href="#">⭳ Unduh</a>`,
  });
  const form = $('#templateForm', root);
  const link = $('#templateDownload', root);
  const update = () => {
    const empty = form.kosong.value === '1';
    form.month.disabled = form.account_id.disabled = empty;
    const query = empty ? { year: store.year, kosong: 1 } : { year: store.year, month: form.month.value, account_id: form.account_id.value };
    link.href = api.downloadUrl('/export/template.xlsx', query);
  };
  form.addEventListener('change', update);
  link.addEventListener('click', () => setTimeout(close));
  update();
}

// ---------------------------------------------------------------- Mutasi per bulan

/**
 * Gabungkan baris pecahan ke baris asalnya, supaya satu baris tabel = satu baris rekening koran.
 * Nominal baris = nominal di bank (baris asal + semua pecahannya).
 */
function bankRows(rows) {
  const parts = new Map();
  for (const r of rows) if (r.split_of) parts.set(r.split_of, [...(parts.get(r.split_of) || []), r]);
  return rows.filter((r) => !r.split_of).map((r) => {
    const own = parts.get(r.id) || [];
    return { ...r, parts: own, bank_masuk: round(r.masuk + sum(own, 'masuk')), bank_keluar: round(r.keluar + sum(own, 'keluar')) };
  });
}

const amountText = (r) => (r.bank_masuk ? `Rp ${money(r.bank_masuk)} (masuk)` : `Rp ${money(r.bank_keluar)} (keluar)`);

const balanceWarning = html`
  <p class="notice">Saldo sistem akan selisih dengan saldo bank di Cek Saldo sampai ada transaksi pelengkapnya
    atau file mutasinya diimpor ulang. Baris yang dihapus akan muncul lagi sebagai baris baru bila file mutasinya diimpor ulang.</p>`;

async function mutasiTab(root, params, reload) {
  const banks = store.accounts.filter((a) => a.kind === 'bank');
  if (!banks.length) return render(root, html`<section class="panel empty">Belum ada akun bank. Tambahkan di Pengaturan.</section>`);
  const accountId = Number(params.get('account_id')) || banks[0].id;
  const account = banks.find((a) => a.id === accountId) || banks[0];

  const all = await api.get('/transactions', { year: store.year, account_id: account.id, source: 'mutasi' });
  const perMonth = MONTHS.map((_, i) => all.filter((r) => Number(r.date.slice(5, 7)) === i + 1 && !r.split_of).length);
  const lastWithData = perMonth.findLastIndex((n) => n > 0) + 1;
  const month = Number(params.get('month')) || lastWithData || defaultMonth();
  const rows = bankRows(all.filter((r) => Number(r.date.slice(5, 7)) === month));
  const period = `${MONTHS[month - 1]} ${store.year}`;
  const go = (changes) => (location.hash = `#/data?${new URLSearchParams({ tab: 'mutasi', account_id: account.id, month, ...changes })}`);

  render(root, html`
    <section class="panel">
      <div class="toolbar toolbar-between mb-3">
        <h2 class="data-title">Mutasi ${account.name} — ${period}</h2>
        <select id="accountSel" aria-label="Akun bank">${accountOptions(account.id, { kind: 'bank' })}</select>
      </div>
      <div class="month-chips" role="group" aria-label="Pilih bulan">
        ${MONTHS.map((m, i) => html`
          <button type="button" data-month="${i + 1}" class="${i + 1 === month ? 'on' : ''}" aria-pressed="${String(i + 1 === month)}">
            <b>${m.slice(0, 3)}</b><small>${perMonth[i] ? `${perMonth[i]} baris` : 'kosong'}</small>
          </button>`)}
      </div>

      <div class="toolbar toolbar-between data-summary">
        <div class="toolbar">
          <span class="badge">${rows.length} baris bank</span>
          <span class="badge badge-ok">Masuk Rp ${money(sum(rows, 'bank_masuk'))}</span>
          <span class="badge badge-red">Keluar Rp ${money(sum(rows, 'bank_keluar'))}</span>
        </div>
        ${rows.length ? html`<button type="button" class="btn-danger" id="deleteMonth" data-write>🗑 Hapus semua mutasi ${MONTHS[month - 1]}</button>` : ''}
      </div>

      <div class="table-wrap flat">
        <table class="table data-table">
          <thead><tr>
            <th>Tgl</th><th>Kode mutasi (kolom C)</th><th>Pos</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo Bank</th>
            <th data-write><span class="sr-only">Hapus</span></th>
          </tr></thead>
          <tbody>${rows.length ? rows.map((r) => html`
            <tr>
              <td class="nowrap">${dateShort(r.date)}</td>
              <td><span class="mono">${r.bank_code || '—'}</span>${r.bank_desc ? html`<small class="muted data-desc">${r.bank_desc}</small>` : ''}</td>
              <td>${r.pos ? r.pos : html`<span class="badge badge-warn">tanpa pos</span>`}${r.parts.map((p) => html` <span class="badge" title="Dipecah Rp ${money(p.masuk || p.keluar)}">+ ${p.pos || 'tanpa pos'}</span>`)}</td>
              <td class="num in">${r.bank_masuk ? money(r.bank_masuk) : ''}</td>
              <td class="num out">${r.bank_keluar ? money(r.bank_keluar) : ''}</td>
              <td class="num muted">${r.balance == null ? '' : money(r.balance)}</td>
              <td data-write><button type="button" class="btn-ghost btn-small btn-danger nowrap" data-delete="${r.id}"
                aria-label="Hapus baris ${dateShort(r.date)} ${r.bank_code}">🗑 Hapus</button></td>
            </tr>`) : html`<tr><td colspan="7" class="empty">Belum ada mutasi yang diimpor untuk ${period}.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>`);

  $('#accountSel', root).addEventListener('change', (e) => go({ account_id: e.target.value, month: '' }));
  on(root, 'click', '[data-month]', (e, btn) => go({ month: btn.dataset.month }));
  on(root, 'click', '[data-delete]', (e, btn) => confirmDeleteRow(rows.find((r) => r.id === Number(btn.dataset.delete)), reload));
  $('#deleteMonth', root)?.addEventListener('click', () => confirmDeleteMonth({ account, month, rows, reload }));
}

/** Konfirmasi hapus satu baris mutasi (pecahannya ikut terhapus). */
function confirmDeleteRow(r, reload) {
  const { root, close } = openModal({
    title: 'Hapus baris mutasi?',
    body: html`
      <dl class="data-facts">
        <dt>Tanggal</dt><dd>${dateShort(r.date)}</dd>
        <dt>Kode mutasi</dt><dd class="mono">${r.bank_code || '—'}</dd>
        <dt>Nominal</dt><dd>${amountText(r)}</dd>
        <dt>Pos</dt><dd>${r.pos || 'tanpa pos'}</dd>
      </dl>
      ${r.parts.length ? html`<p>Baris ini sudah dipecah ke ${r.parts.map((p) => `${p.pos || 'tanpa pos'} (Rp ${money(p.masuk || p.keluar)})`).join(', ')}.
        <b>Pecahannya ikut terhapus.</b></p>` : ''}
      ${balanceWarning}`,
    footer: html`<button type="button" data-close>Batal</button><button type="button" class="btn-danger" id="confirmDelete">🗑 Hapus</button>`,
  });
  $('#confirmDelete', root).addEventListener('click', async () => {
    if (await attempt(() => api.del(`/transactions/${r.id}`), 'Baris mutasi dihapus')) { close(); reload(); }
  });
}

/** Konfirmasi hapus semua mutasi satu bulan: pengguna harus mengetik nama bulannya. */
function confirmDeleteMonth({ account, month, rows, reload }) {
  const name = MONTHS[month - 1];
  const split = rows.filter((r) => r.parts.length).length;
  const { root, close } = openModal({
    title: `Hapus semua mutasi ${name} ${store.year}?`,
    body: html`
      <p>Akan dihapus <b>${rows.length} baris mutasi</b> akun ${account.name}
        (masuk Rp ${money(sum(rows, 'bank_masuk'))}, keluar Rp ${money(sum(rows, 'bank_keluar'))})${split ? `, termasuk pecahan dari ${split} baris` : ''}.
        Baris draf, input manual, dan pindahan antar pos tidak ikut terhapus.</p>
      ${balanceWarning}
      <p class="muted">Disarankan membuat <a href="/api/backup">Backup Database</a> lebih dulu.</p>
      <label>Ketik <b>${name}</b> untuk mengonfirmasi
        <input id="confirmText" autocomplete="off" spellcheck="false"></label>`,
    footer: html`<button type="button" data-close>Batal</button>
      <button type="button" class="btn-danger" id="confirmDelete" disabled>🗑 Hapus ${rows.length} baris</button>`,
  });
  const input = $('#confirmText', root);
  const button = $('#confirmDelete', root);
  const matches = () => input.value.trim().toLowerCase() === name.toLowerCase();
  input.addEventListener('input', () => (button.disabled = !matches()));
  button.addEventListener('click', async () => {
    if (!matches()) return;
    let deleted = 0;
    const ok = await attempt(async () => {
      ({ deleted } = await api.post('/mutasi/delete-month', { account_id: account.id, year: store.year, month }));
    });
    if (ok) { toast(`${deleted} baris mutasi ${name} dihapus`); close(); reload(); }
  });
}
