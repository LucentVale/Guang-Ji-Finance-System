// Langkah 2 — Draf: semua transaksi satu bulan berurutan seperti rekening koran.
// Di sini transaksi "dirapikan": dialokasikan ke pos, diberi kategori, dan saldo berjalan dicocokkan dengan bank.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, dateShort, MONTHS } from '../core/format.js';
import { attempt } from '../components/feedback.js';
import { accountOptions, monthOptions, posOptions, defaultMonth } from '../components/options.js';
import { openTransactionForm } from '../components/transactionForms.js';
import { openDrafImport } from '../components/drafImport.js';

/** Asal data bulan ini: dari mutasi bank, file DRAF, atau input manual. */
function sourceBadge(rows) {
  const counts = {};
  for (const r of rows) counts[r.source] = (counts[r.source] || 0) + 1;
  const label = { mutasi: 'mutasi bank', draf: 'file DRAF', manual: 'input manual' };
  return Object.entries(counts).map(([src, n]) => html`<span class="badge">${n} baris dari ${label[src] || src}</span>`);
}

/** Bulan terakhir (1-12) di tahun terpilih yang punya transaksi di akun ini, atau 0 bila belum ada. */
async function lastMonthWithData(accountId) {
  const rows = await api.get('/transactions', { year: store.year, account_id: accountId });
  return rows.reduce((m, t) => Math.max(m, Number(t.date.slice(5, 7))), 0);
}

export async function drafView(main, params) {
  const month = Number(params.get('month')) || defaultMonth();
  const accountId = Number(params.get('account_id')) || store.accounts[0]?.id;
  const onlyUnallocated = params.get('filter') === 'none';
  const go = (changes = {}) => {
    const q = new URLSearchParams({ month, account_id: accountId, ...(onlyUnallocated ? { filter: 'none' } : {}), ...changes });
    if (!q.get('filter')) q.delete('filter');
    location.hash = `#/draf?${q}`;
  };

  const draf = await api.get('/draf', { account_id: accountId, year: store.year, month });
  // Dibuka tanpa bulan (menu samping / tautan dashboard lama) dan bulan berjalan masih kosong:
  // langsung tampilkan bulan terakhir yang berisi data, supaya pengguna tidak perlu mengganti bulan dulu.
  if (!params.get('month') && !draf.rows.length) {
    const latest = await lastMonthWithData(accountId);
    if (latest && latest !== month) return void location.replace(`#/draf?month=${latest}&account_id=${accountId}${onlyUnallocated ? '&filter=none' : ''}`);
  }
  const unallocated = draf.rows.filter((r) => !r.pos_id).length;
  const mismatched = draf.rows.filter((r) => r.match === false).length;
  const rows = onlyUnallocated ? draf.rows.filter((r) => !r.pos_id) : draf.rows;

  render(main, html`
    <div class="view-head">
      <div>
        <h1>2. Draf Laporan Keuangan</h1>
        <p class="sub">Urutan transaksi sama dengan rekening koran. Pilih pos untuk tiap baris (atau klik baris untuk mengubah kategori/nama).
          Kolom "Saldo" dihitung sistem dan harus sama dengan "Saldo Bank".</p>
      </div>
      <div class="toolbar">
        <button id="addRow" data-write title="Tambah transaksi baru di bulan ini">+ Baris</button>
        <button id="importDraf" data-write title="Isi data dari file DRAF Laporan Keuangan (.xlsx)">⇪ Impor File DRAF</button>
        <a class="btn" href="${api.downloadUrl('/export/draf.xlsx', { account_id: accountId, year: store.year })}"
           title="File DRAF Januari s.d. bulan terakhir yang berisi data, format sama dengan file manual">⭳ Excel Draf</a>
        <a class="btn btn-primary" href="#/tahunan">Lanjut ke 3. Laporan per Pos →</a>
      </div>
    </div>
    <div class="toolbar mb-3">
      ${sourceBadge(draf.rows)}
      ${unallocated ? html`<span class="badge badge-warn">${unallocated} belum punya pos</span>` : html`<span class="badge badge-ok">Semua sudah punya pos</span>`}
      ${draf.rows.some((r) => r.match !== null) ? (mismatched ? html`<span class="badge badge-red">${mismatched} saldo tidak cocok</span>` : html`<span class="badge badge-ok">Saldo cocok dengan bank</span>`) : ''}
    </div>
    <section class="workbook">
      <div class="workbook-toolbar">
        <span class="title">DRAF ${MONTHS[month - 1].toUpperCase()} ${store.year} — ${draf.account.name}</span>
        <label class="check"><input type="checkbox" id="onlyNone" ${onlyUnallocated ? 'checked' : ''}> Hanya yang belum punya pos</label>
        <select id="accountSel" aria-label="Akun">${accountOptions(accountId)}</select>
        <select id="monthSel" aria-label="Bulan">${monthOptions(month)}</select>
      </div>
      <div class="sheet-scroll">
        <table class="sheet" id="drafTable">
          <thead><tr>
            <th>Tgl</th><th style="width:170px">Pos</th><th style="min-width:300px">Keterangan</th><th>No Kwitansi</th><th>Piao Wen</th><th>Keterangan</th>
            <th>Masuk</th><th>Keluar</th><th>Saldo</th><th>Saldo Bank</th>
          </tr></thead>
          <tbody>
            <tr class="row-strong"><td></td><td colspan="5" class="num">SALDO AWAL</td><td></td><td></td><td class="${numClass(draf.opening)}">${money(draf.opening)}</td><td></td></tr>
            ${rows.map((r) => html`
              <tr class="clickable ${r.pos_id ? '' : 'row-warn'}" data-id="${r.id}">
                <td class="day" style="width:96px">${dateShort(r.date)}</td>
                <td data-stop><select class="cell-select" data-assign="${r.id}" ${store.can('write') ? '' : 'disabled'}>${posOptions(r.pos_id, { empty: '— pilih pos —' })}</select></td>
                <td class="${r.split_of ? 'indent' : ''}" title="Kode mutasi: ${r.bank_code}">${r.draf_ket}${r.split ? html` <span class="badge">dipecah</span>` : ''}${r.source === 'manual' ? html` <span class="badge">manual</span>` : ''}</td>
                <td>${r.receipt_no}</td>
                <td>${r.piao_wen}</td>
                <td>${r.note}</td>
                <td class="num in">${r.masuk ? money(r.masuk) : ''}</td>
                <td class="num out">${r.keluar ? money(r.keluar) : ''}</td>
                <td class="${numClass(r.saldo)}">${money(r.saldo)}</td>
                <td class="num ${r.match === false ? 'neg' : 'muted'}">${r.balance == null ? '' : money(r.balance)}${r.match === false ? ' ✗' : ''}</td>
              </tr>`)}
            ${rows.length ? '' : html`<tr><td colspan="10" class="empty">${onlyUnallocated ? 'Semua transaksi sudah punya pos.' : 'Belum ada transaksi. Impor mutasi di langkah 1.'}</td></tr>`}
          </tbody>
          <tfoot><tr><td></td><td colspan="5" class="num">SALDO AKHIR</td><td></td><td></td><td class="${numClass(draf.closing)}">${money(draf.closing)}</td><td></td></tr></tfoot>
        </table>
      </div>
    </section>`);

  $('#monthSel').addEventListener('change', (e) => go({ month: e.target.value }));
  $('#accountSel').addEventListener('change', (e) => go({ account_id: e.target.value }));
  $('#onlyNone').addEventListener('change', (e) => go({ filter: e.target.checked ? 'none' : '' }));

  const table = $('#drafTable');
  const reload = () => drafView(main, params);

  // Tambah baris langsung di Draf: tanggal default di bulan & akun yang sedang dibuka.
  $('#addRow')?.addEventListener('click', () => {
    const lastDate = draf.rows.at(-1)?.date ?? `${store.year}-${String(month).padStart(2, '0')}-01`;
    openTransactionForm(null, { defaults: { date: lastDate, account_id: accountId }, onSaved: reload });
  });
  $('#importDraf')?.addEventListener('click', () => openDrafImport({
    accountId,
    onSaved: (months) => go({ month: months.includes(month) ? month : months[0] }),
  }));
  on(table, 'change', '[data-assign]', async (e, select) => {
    await attempt(() => api.post('/transactions/assign-pos', { ids: [Number(select.dataset.assign)], pos_id: select.value || null }), 'Pos disimpan');
    select.closest('tr').classList.toggle('row-warn', !select.value);
  });
  on(table, 'click', 'tr[data-id]', (e, tr) => {
    if (e.target.closest('[data-stop]')) return;
    const tx = draf.rows.find((r) => r.id === Number(tr.dataset.id));
    openTransactionForm(tx, { onSaved: reload });
  });
}
