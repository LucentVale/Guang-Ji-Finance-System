// Impor file "DRAF Laporan Keuangan" (.xlsx): pilih file -> pilih sheet & bulan -> periksa -> simpan.
// Data bulan yang dipilih DIGANTI dengan isi file (bukan ditambahkan), supaya tidak dobel dengan hasil impor mutasi.
import { $, $$, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { money, dateId, MONTHS } from '../core/format.js';
import { openModal, attempt, toast } from './feedback.js';
import { accountOptions, posOptions } from './options.js';

const SOURCE_LABEL = { mutasi: 'mutasi bank', draf: 'file DRAF', manual: 'input manual' };

/** @param {{accountId: number, onSaved: (months: number[]) => void}} options */
export function openDrafImport({ accountId, onSaved }) {
  const { root, close } = openModal({
    title: 'Impor File DRAF Laporan Keuangan',
    wide: true,
    body: html`
      <p class="muted mt-0">Pilih file DRAF (mis. "DRAF Laporan Keuangan Kuang Hang 2026.xlsx"). Baris dibaca dari kolom
        Tgl, Pos / Nama, Keterangan, No Kwitansi, Piao Wen, Masuk, dan Keluar.</p>
      <label class="dropzone" id="drafDrop">
        <span class="icon-lg" aria-hidden="true">⇪</span>
        <b>Klik untuk memilih file DRAF, atau seret ke sini</b>
        <input type="file" accept=".xlsx" hidden id="drafFile">
      </label>
      <div id="drafStep"></div>`,
    footer: html`<div></div><div class="toolbar"><button data-close>Tutup</button></div>`,
  });

  const zone = $('#drafDrop', root);
  const start = (file) => file && upload(file);
  $('#drafFile', root).addEventListener('change', (e) => start(e.target.files[0]));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); start(e.dataTransfer.files[0]); });

  async function upload(file) {
    const step = $('#drafStep', root);
    render(step, html`<div class="empty">Membaca ${file.name}…</div>`);
    let up;
    try { up = await api.upload('/imports/upload', file); } catch (err) { render(step, ''); return toast(err.message, { error: true }); }
    zone.hidden = true;
    // Sheet bulan terakhir (paling kiri di file manual) biasanya sudah berisi Januari s.d. bulan itu.
    render(step, html`
      <div class="toolbar mb-3">
        <b>${up.file_name}</b>
        <label class="inline">Sheet <select id="drafSheet">${up.sheets.map((s) => html`<option value="${s.name}">${s.name}</option>`)}</select></label>
        <label class="inline">Akun <select id="drafAccount">${accountOptions(accountId)}</select></label>
      </div>
      <div id="drafPreview"></div>`);
    const request = () => ({ token: up.token, sheet: $('#drafSheet', root).value, account_id: Number($('#drafAccount', root).value) });
    $('#drafSheet', root).addEventListener('change', () => preview(request));
    $('#drafAccount', root).addEventListener('change', () => preview(request));
    preview(request);
  }

  async function preview(request) {
    const box = $('#drafPreview', root);
    render(box, html`<div class="empty">Memproses…</div>`);
    let pv;
    try { pv = await api.post('/imports/draf/preview', request()); } catch (err) { render(box, ''); return toast(err.message, { error: true }); }

    const overrides = {};
    const unknown = pv.rows.filter((r) => !r.pos_id).length;
    const assumed = pv.rows.filter((r) => r.day_assumed).length;
    const openingDiffers = pv.opening_file != null && Math.round(pv.opening_file * 100) !== Math.round(pv.opening_app * 100);
    const existingText = (m) => Object.entries(m.existing).map(([src, n]) => `${n} dari ${SOURCE_LABEL[src] || src}`).join(', ');

    render(box, html`
      ${openingDiffers ? html`<p class="notice">⚠ Saldo awal di file (${money(pv.opening_file)}) berbeda dengan saldo awal di aplikasi (${money(pv.opening_app)}). Periksa saldo awal di Pengaturan.</p>` : ''}
      ${unknown ? html`<p class="notice">Ada ${unknown} baris tanpa pos yang dikenali (baris kuning). Pilih pos-nya di tabel, atau alokasikan nanti di Draf.</p>` : ''}
      ${assumed ? html`<p class="notice">${assumed} baris di file tidak punya tanggal; dipakai tanggal baris sebelumnya (ditandai *).</p>` : ''}

      <h2 class="mt-2">Bulan yang diimpor</h2>
      <div class="table-wrap mb-3">
        <table class="table">
          <thead><tr><th></th><th>Bulan</th><th class="num">Baris di file</th><th class="num">Masuk</th><th class="num">Keluar</th><th>Data yang sudah ada (akan diganti)</th></tr></thead>
          <tbody>${pv.months.map((m) => html`
            <tr>
              <td><input type="checkbox" class="month-check" value="${m.month}" checked aria-label="Impor ${MONTHS[m.month - 1]}"></td>
              <td>${MONTHS[m.month - 1]} ${pv.year}</td>
              <td class="num">${m.count}</td>
              <td class="num in">${money(m.masuk)}</td>
              <td class="num out">${money(m.keluar)}</td>
              <td>${Object.keys(m.existing).length ? html`<span class="badge badge-warn">${existingText(m)}</span>` : html`<span class="muted">kosong</span>`}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>

      <div class="toolbar mb-2">
        <span class="muted">Data akun ini di bulan yang dicentang akan <b>diganti</b> dengan isi file. Pindahan antar pos tidak terpengaruh.</span>
        <span class="spacer"></span>
        <button class="btn-primary" id="drafCommit">Simpan & Ganti Data</button>
      </div>

      <div class="sheet-scroll" style="max-height:45vh">
        <table class="sheet" id="drafRows">
          <thead><tr><th>Tgl</th><th>Kode di file</th><th style="width:170px">Pos</th><th>Kategori</th><th>Nama</th><th>Masuk</th><th>Keluar</th></tr></thead>
          <tbody>${pv.rows.map((r) => html`
            <tr data-seq="${r.seq}" data-month="${r.month}" class="${r.pos_id ? '' : 'row-warn'}">
              <td>${dateId(r.date)}${r.day_assumed ? ' *' : ''}</td>
              <td class="mono">${r.bank_code}</td>
              <td><select class="cell-select" data-field="pos_id">${posOptions(r.pos_id, { empty: '— pilih —' })}</select></td>
              <td><input class="cell-input" data-field="category" value="${r.category}"></td>
              <td><input class="cell-input" data-field="name" value="${r.name}"></td>
              <td class="num in">${r.amount_cents > 0 ? money(r.amount_cents / 100) : ''}</td>
              <td class="num out">${r.amount_cents < 0 ? money(-r.amount_cents / 100) : ''}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>`);

    const chosenMonths = () => $$('.month-check:checked', box).map((c) => Number(c.value));
    const syncRows = () => {
      const chosen = new Set(chosenMonths());
      $$('#drafRows tbody tr', box).forEach((tr) => (tr.hidden = !chosen.has(Number(tr.dataset.month))));
    };
    $$('.month-check', box).forEach((c) => c.addEventListener('change', syncRows));
    on($('#drafRows', box), 'change', '[data-field]', (e, input) => {
      const seq = input.closest('tr').dataset.seq;
      overrides[seq] = { ...overrides[seq], [input.dataset.field]: input.value };
      if (input.dataset.field === 'pos_id') input.closest('tr').classList.toggle('row-warn', !input.value);
    });

    $('#drafCommit', box).addEventListener('click', async () => {
      const months = chosenMonths();
      if (!months.length) return toast('Centang minimal satu bulan', { error: true });
      const replacing = pv.months.filter((m) => months.includes(m.month) && Object.keys(m.existing).length);
      if (replacing.length && !confirm(`Data ${replacing.map((m) => MONTHS[m.month - 1]).join(', ')} yang sudah ada akan DIGANTI dengan isi file DRAF. Lanjutkan?`)) return;
      let result;
      const ok = await attempt(async () => { result = await api.post('/imports/draf/commit', { ...request(), months, overrides }); });
      if (!ok) return;
      toast(`${result.added} baris tersimpan${result.replaced ? `, ${result.replaced} baris lama diganti` : ''}`);
      close();
      onSaved(result.months);
    });
  }
}
