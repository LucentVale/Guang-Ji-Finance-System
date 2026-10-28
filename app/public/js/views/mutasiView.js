// Langkah 1 — Mutasi Bank: impor file rekening koran (.xlsx) dan lihat mutasi yang sudah masuk.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, dateId } from '../core/format.js';
import { toast, attempt } from '../components/feedback.js';
import { accountOptions, monthOptions, posOptions, defaultMonth } from '../components/options.js';

export async function mutasiView(main, params) {
  const month = Number(params.get('month')) || defaultMonth();
  const accountId = Number(params.get('account_id')) || store.bankAccounts[0]?.id;

  render(main, html`
    <div class="view-head">
      <div>
        <h1>1. Mutasi Bank</h1>
        <p class="sub">Upload file mutasi dari bank (contoh: "Mutasi Kuang Hang Januari 2026.xlsx"). Kolom C berisi kode
          <span class="mono">POS ; KATEGORI ; NAMA</span> yang dipakai untuk mengalokasikan transaksi ke pos.</p>
      </div>
    </div>
    <div class="stack">
      <section class="panel" id="importPanel" data-write></section>
      <section class="workbook">
        <div class="workbook-toolbar">
          <span class="title">Mutasi yang sudah diimpor</span>
          <select id="accountSel" aria-label="Akun bank">${accountOptions(accountId, { kind: 'bank' })}</select>
          <select id="monthSel" aria-label="Bulan">${monthOptions(month)}</select>
        </div>
        <div class="sheet-scroll" id="mutasiList"></div>
      </section>
    </div>`);

  const reload = () => {
    location.hash = `#/mutasi?month=${$('#monthSel').value}&account_id=${$('#accountSel').value}`;
  };
  $('#monthSel').addEventListener('change', reload);
  $('#accountSel').addEventListener('change', reload);

  renderDropzone($('#importPanel'), accountId);
  await renderImported($('#mutasiList'), accountId, month);
}

async function renderImported(el, accountId, month) {
  if (!accountId) return render(el, html`<div class="empty">Belum ada akun bank. Tambahkan di Pengaturan.</div>`);
  const rows = await api.get('/transactions', { year: store.year, month, account_id: accountId, source: 'mutasi' });
  if (!rows.length) return render(el, html`<div class="empty">Belum ada mutasi untuk bulan ini.</div>`);
  render(el, html`
    <table class="sheet">
      <thead><tr><th>Tanggal</th><th>Keterangan Bank</th><th>Kode (kolom C)</th><th>Pos</th><th>Nominal</th><th>Saldo</th></tr></thead>
      <tbody>${rows.map((r) => html`
        <tr class="${r.pos ? '' : 'row-warn'}">
          <td>${dateId(r.date)}</td>
          <td class="muted" style="font-size:12px">${r.bank_type}${r.bank_desc ? html`<br>${r.bank_desc}` : ''}</td>
          <td class="mono">${r.bank_code}</td>
          <td>${r.pos || html`<span class="badge badge-warn">Belum ada</span>`}</td>
          <td class="num ${r.masuk ? 'in' : 'out'}">${money(r.masuk || r.keluar)} ${r.masuk ? 'CR' : 'DB'}</td>
          <td class="num">${money(r.balance)}</td>
        </tr>`)}</tbody>
    </table>`);
}

// ---------------------------------------------------------------- Impor: upload -> preview -> simpan

function renderDropzone(panel, accountId) {
  render(panel, html`
    <h2>Impor file mutasi</h2>
    <label class="dropzone" id="dropzone">
      <span style="font-size:26px">⇪</span>
      <b>Klik untuk memilih file, atau seret file mutasi (.xlsx) ke sini</b>
      <span>Baris yang sudah pernah diimpor otomatis dilewati, jadi aman mengimpor ulang file yang sama.</span>
      <input type="file" accept=".xlsx" hidden id="fileInput">
    </label>`);
  const zone = $('#dropzone', panel);
  const start = (file) => file && upload(panel, file, accountId);
  $('#fileInput', panel).addEventListener('change', (e) => start(e.target.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); start(e.dataTransfer.files[0]); });
}

async function upload(panel, file, accountId) {
  render(panel, html`<div class="empty">Membaca ${file.name}…</div>`);
  let upload;
  try {
    upload = await api.upload('/imports/upload', file);
  } catch (err) {
    toast(err.message, { error: true });
    return renderDropzone(panel, accountId);
  }
  const first = upload.sheets[0] || {};
  render(panel, html`
    <div class="toolbar" style="margin-bottom:12px">
      <b>${upload.file_name}</b>
      <label class="inline">Sheet <select id="sheetSel">${upload.sheets.map((s) => html`<option value="${s.name}" data-year="${s.year || store.year}">${s.name}</option>`)}</select></label>
      <label class="inline">Tahun <input id="yearInput" type="number" style="width:90px" value="${first.year || store.year}"></label>
      <label class="inline">Akun <select id="importAccount">${accountOptions(accountId, { kind: 'bank' })}</select></label>
      <button id="cancelImport" class="btn-ghost">Batal</button>
    </div>
    <div id="previewBox"></div>`);

  const request = () => ({ token: upload.token, sheet: $('#sheetSel', panel).value, year: Number($('#yearInput', panel).value), account_id: Number($('#importAccount', panel).value) });
  const refresh = () => showPreview(panel, request);
  $('#sheetSel', panel).addEventListener('change', (e) => { $('#yearInput', panel).value = e.target.selectedOptions[0].dataset.year; refresh(); });
  $('#yearInput', panel).addEventListener('change', refresh);
  $('#importAccount', panel).addEventListener('change', refresh);
  $('#cancelImport', panel).addEventListener('click', () => renderDropzone(panel, accountId));
  refresh();
}

async function showPreview(panel, request) {
  const box = $('#previewBox', panel);
  render(box, html`<div class="empty">Memproses…</div>`);
  let rows;
  try { ({ rows } = await api.post('/imports/preview', request())); } catch (err) {
    render(box, '');
    return toast(err.message, { error: true });
  }

  const fresh = rows.filter((r) => !r.duplicate);
  const unknown = fresh.filter((r) => !r.pos_id);
  const brokenChain = rows.filter((r) => !r.chain_ok);
  const overrides = {}; // seq -> { pos_id?, category?, name? }

  render(box, html`
    <div class="toolbar" style="margin-bottom:10px">
      <span class="badge">${rows.length} baris</span>
      <span class="badge badge-ok">${fresh.length} baru</span>
      ${rows.length > fresh.length ? html`<span class="badge">${rows.length - fresh.length} sudah pernah diimpor</span>` : ''}
      ${unknown.length ? html`<span class="badge badge-warn">${unknown.length} kode pos tidak dikenal</span>` : ''}
      ${brokenChain.length ? html`<span class="badge badge-red">${brokenChain.length} saldo tidak berurutan</span>` : ''}
      <span style="flex:1"></span>
      <button class="btn-primary" id="commitBtn" ${fresh.length ? '' : 'disabled'}>Simpan ${fresh.length} transaksi</button>
    </div>
    ${unknown.length ? html`<p class="notice">Baris kuning: kode pos di kolom C tidak dikenal. Pilih pos-nya di sini, atau biarkan kosong dan alokasikan nanti di Draf.</p>` : ''}
    ${brokenChain.length ? html`<p class="notice">Baris merah: saldo sebelumnya + nominal ≠ saldo bank. Periksa apakah ada baris yang terlewat di file.</p>` : ''}
    <div class="sheet-scroll" style="max-height:55vh">
      <table class="sheet">
        <thead><tr><th>Tgl</th><th>Kode (kolom C)</th><th>Pos</th><th>Kategori</th><th>Nama</th><th>Masuk</th><th>Keluar</th><th>Saldo Bank</th></tr></thead>
        <tbody>${rows.map((r) => html`
          <tr data-seq="${r.seq}" class="${!r.chain_ok ? 'row-warn' : !r.pos_id && !r.duplicate ? 'row-warn' : ''}" style="${r.duplicate ? 'opacity:.45' : ''}">
            <td>${dateId(r.date)}</td>
            <td class="mono" title="${r.bank_desc}">${r.bank_code}</td>
            <td>${r.duplicate ? store.posById(r.pos_id)?.code || '' : html`<select class="cell-select" data-field="pos_id">${posOptions(r.pos_id, { empty: '— pilih —' })}</select>`}</td>
            <td>${r.duplicate ? r.category : html`<input class="cell-input" data-field="category" value="${r.category}">`}</td>
            <td>${r.duplicate ? r.name : html`<input class="cell-input" data-field="name" value="${r.name}">`}
              ${r.split && !r.duplicate ? html`<span class="badge badge-ok" title="Bagian ini otomatis dipindahkan ke pos lain">✂ ${money(r.split.amount_cents / 100)} → ${r.split.pos_code}</span>` : ''}</td>
            <td class="num in">${r.amount_cents > 0 ? money(r.amount_cents / 100) : ''}</td>
            <td class="num out">${r.amount_cents < 0 ? money(-r.amount_cents / 100) : ''}</td>
            <td class="num ${r.chain_ok ? 'muted' : 'neg'}">${r.balance_cents == null ? '' : money(r.balance_cents / 100)}</td>
          </tr>`)}</tbody>
      </table>
    </div>`);

  on($('table', box), 'change', '[data-field]', (e, input) => {
    const seq = input.closest('tr').dataset.seq;
    overrides[seq] = { ...overrides[seq], [input.dataset.field]: input.value };
  });

  $('#commitBtn', box).addEventListener('click', async () => {
    const stillUnknown = fresh.filter((r) => !(overrides[r.seq]?.pos_id ?? r.pos_id)).length;
    if (stillUnknown && !confirm(`${stillUnknown} transaksi belum punya pos. Tetap simpan? (bisa dialokasikan nanti di Draf)`)) return;
    let result;
    const ok = await attempt(async () => { result = await api.post('/imports/commit', { ...request(), overrides }); });
    if (!ok) return;
    const month = Number(fresh[0]?.date.slice(5, 7)) || defaultMonth();
    render(panel, html`
      <p class="notice notice-ok">✓ ${result.added} transaksi tersimpan${result.skipped ? `, ${result.skipped} dilewati karena sudah ada` : ''}.</p>
      <div class="toolbar">
        <a class="btn btn-primary" href="#/draf?month=${month}">Lanjut ke 2. Draf →</a>
        <button id="importMore">Impor file lain</button>
      </div>`);
    $('#importMore', panel).addEventListener('click', () => renderDropzone(panel, request().account_id));
    renderImported($('#mutasiList'), request().account_id, Number($('#monthSel').value));
  });
}
