// Impor "Template Data" (bentuk seragam semua vihara) — langkah sesudah file diunggah lewat dialog impor di Draf:
// periksa baris salah -> pilih bulan -> rapikan pos yang tak dikenal -> (opsional) perbarui saldo awal -> simpan.
// Data akun-akun di file pada bulan yang dipilih DIGANTI dengan isi file (seperti impor DRAF).
// Saldo awal pos & akun hanya diganti bila kotak "Perbarui saldo awal" dicentang.
import { $, $$, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { money, dateId, MONTHS } from '../core/format.js';
import { attempt, toast } from './feedback.js';
import { posOptions } from './options.js';

const SOURCE_LABEL = { mutasi: 'mutasi bank', draf: 'file DRAF/template', manual: 'input manual' };
const monthLabel = (m) => `${MONTHS[m.month - 1]} ${m.year}`;

const errorBox = (title, errors) => html`
  <div class="notice notice-error" role="alert">
    ${title}
    <ul class="error-list">${errors.map((e) => html`<li>${e.row ? `Baris ${e.row}: ` : ''}${e.message}</li>`)}</ul>
  </div>`;

/** Bagian Saldo Awal: daftar perubahan + kotak centang untuk menerapkannya. */
function openingsSection(op) {
  if (!op) return '';
  const count = op.changes.length + op.account_changes.length;
  const unbalanced = op.totals.filter((t) => Math.round(t.diff * 100) !== 0);
  return html`
    <h2 class="mt-2">Saldo Awal <span class="muted">per ${dateId(op.start_date)}</span></h2>
    ${op.errors.length ? errorBox(html`<b>Sheet Saldo Awal perlu diperbaiki</b> sebelum bisa dipakai.`, op.errors) : ''}
    ${!op.errors.length && !count ? html`<p class="muted">Sama dengan saldo awal di aplikasi — tidak ada yang berubah.</p>` : ''}
    ${!op.errors.length && count ? html`
      <label class="check mb-2"><input type="checkbox" id="applyOpenings">
        <span>Perbarui saldo awal (${count} nilai berubah). Semua saldo sejak tanggal mulai pembukuan ikut berubah.</span></label>
      <div class="table-wrap mb-3">
        <table class="table">
          <thead><tr><th>Pos</th><th>Akun</th><th class="num">Sekarang</th><th class="num">Di file</th></tr></thead>
          <tbody>
            ${op.changes.map((c) => html`<tr><td>${c.pos}</td><td>${c.account}</td><td class="num">${money(c.before)}</td><td class="num">${money(c.after)}</td></tr>`)}
            ${op.account_changes.map((c) => html`<tr class="row-strong"><td>Saldo awal akun</td><td>${c.account}</td><td class="num">${money(c.before)}</td><td class="num">${money(c.after)}</td></tr>`)}
          </tbody>
        </table>
      </div>
      ${unbalanced.map((t) => html`<p class="notice">Sesudah diperbarui, jumlah saldo awal pos ${t.account} (${money(t.pos_total)}) belum sama dengan
        saldo awal akun (${money(t.account_opening)}), selisih ${money(t.diff)}. Cek Saldo akan menandainya.</p>`)}` : ''}`;
}

/**
 * @param {HTMLElement} box tempat pratinjau ditampilkan (di dalam dialog impor)
 * @param {{token: string, file_name: string}} up hasil upload
 * @param {{close: () => void, onSaved: (keys: string[]) => void}} options
 */
export async function renderTemplateImport(box, up, { close, onSaved }) {
  render(box, html`<div class="empty">Memproses…</div>`);
  let pv;
  try { pv = await api.post('/imports/template/preview', { token: up.token }); } catch (err) { render(box, ''); return toast(err.message, { error: true }); }

  const overrides = {};
  const unknown = pv.rows.filter((r) => r.pos_unknown).length;
  const existingText = (a) => Object.entries(a.existing).map(([src, n]) => `${n} dari ${SOURCE_LABEL[src] || src}`).join(', ');
  const op = pv.openings;
  const canOpenings = !!op && !op.errors.length && op.changes.length + op.account_changes.length > 0;
  const blocked = pv.errors.length > 0;

  render(box, html`
    <p class="mt-0"><b>${up.file_name}</b> <span class="badge">Template Data · sheet ${pv.sheet}</span></p>
    ${blocked ? errorBox(html`<b>${pv.errors.length} baris perlu diperbaiki di Excel</b>, lalu upload ulang file-nya.
      Selama masih ada baris salah, file belum bisa disimpan.`, pv.errors) : ''}
    ${unknown ? html`<p class="notice">Ada ${unknown} baris dengan Pos yang tidak dikenali (baris kuning). Pilih pos-nya di tabel, atau alokasikan nanti di Draf.</p>` : ''}

    ${pv.months.length ? html`
      <h2 class="mt-2">Bulan yang diimpor</h2>
      <div class="table-wrap mb-3">
        <table class="table">
          <thead><tr><th></th><th>Bulan</th><th class="num">Baris</th><th class="num">Masuk</th><th class="num">Keluar</th><th>Data yang sudah ada (akan diganti)</th></tr></thead>
          <tbody>${pv.months.map((m) => html`
            <tr>
              <td><input type="checkbox" class="month-check" value="${m.key}" checked aria-label="Impor ${monthLabel(m)}"></td>
              <td class="nowrap">${monthLabel(m)}</td>
              <td class="num">${m.count}</td>
              <td class="num in">${money(m.masuk)}</td>
              <td class="num out">${money(m.keluar)}</td>
              <td>${m.accounts.map((a) => (Object.keys(a.existing).length
                ? html`<span class="badge badge-warn">${a.name}: ${existingText(a)}</span> `
                : html`<span class="muted">${a.name}: kosong</span> `))}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>` : html`<p class="muted">Sheet Transaksi kosong — tidak ada transaksi yang diimpor.</p>`}

    ${openingsSection(op)}

    ${pv.months.length || canOpenings ? html`
      <div class="toolbar mb-2">
        <span class="muted">${pv.months.length ? html`Data akun di file pada bulan yang dicentang akan <b>diganti</b> dengan isi file. Pindahan antar pos dan akun lain tidak terpengaruh.` : ''}</span>
        <span class="spacer"></span>
        <button class="btn-primary" id="templateCommit" ${blocked ? 'disabled' : ''}>Simpan</button>
      </div>` : ''}

    ${pv.rows.length ? html`
      <div class="sheet-scroll sheet-scroll-short">
        <table class="sheet" id="templateRows">
          <thead><tr><th>Baris</th><th>Tgl</th><th>Akun</th><th class="col-pos">Pos</th><th>Kategori</th><th>Nama / Uraian</th><th>Masuk</th><th>Keluar</th><th>Saldo Bank</th></tr></thead>
          <tbody>${pv.rows.map((r) => html`
            <tr data-seq="${r.seq}" data-key="${r.date.slice(0, 7)}" class="${r.pos_id ? '' : 'row-warn'}">
              <td class="muted">${r.row}</td>
              <td class="nowrap">${dateId(r.date)}</td>
              <td>${r.account}</td>
              <td><select class="cell-select" data-field="pos_id" aria-label="Pos baris ${r.row}"
                title="${r.pos_unknown && r.pos ? `Di file: ${r.pos}` : ''}">${posOptions(r.pos_id, { empty: r.pos_unknown && r.pos ? `— ${r.pos}? —` : '— pilih —' })}</select></td>
              <td><input class="cell-input" data-field="category" value="${r.category}" aria-label="Kategori baris ${r.row}"></td>
              <td><input class="cell-input" data-field="name" value="${r.name}" aria-label="Nama baris ${r.row}"></td>
              <td class="num in">${r.amount_cents > 0 ? money(r.amount_cents / 100) : ''}</td>
              <td class="num out">${r.amount_cents < 0 ? money(-r.amount_cents / 100) : ''}</td>
              <td class="num muted">${r.balance_cents == null ? '' : money(r.balance_cents / 100)}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>` : ''}`);

  const commitButton = $('#templateCommit', box);
  if (!commitButton) return;
  const chosen = () => $$('.month-check:checked', box).map((c) => c.value);
  const rowsTable = $('#templateRows', box);
  if (rowsTable) {
    $$('.month-check', box).forEach((c) => c.addEventListener('change', () => {
      const keys = new Set(chosen());
      $$('tbody tr', rowsTable).forEach((tr) => (tr.hidden = !keys.has(tr.dataset.key)));
    }));
    on(rowsTable, 'change', '[data-field]', (e, input) => {
      const seq = input.closest('tr').dataset.seq;
      overrides[seq] = { ...overrides[seq], [input.dataset.field]: input.value };
      if (input.dataset.field === 'pos_id') input.closest('tr').classList.toggle('row-warn', !input.value);
    });
  }

  commitButton.addEventListener('click', async () => {
    const months = chosen();
    const applyOpenings = !!$('#applyOpenings', box)?.checked;
    if (!months.length && !applyOpenings) {
      return toast(canOpenings ? 'Centang minimal satu bulan, atau "Perbarui saldo awal"' : 'Centang minimal satu bulan', { error: true });
    }
    const replacing = pv.months.filter((m) => months.includes(m.key) && m.accounts.some((a) => Object.keys(a.existing).length));
    const warnings = [
      replacing.length ? `Data ${replacing.map(monthLabel).join(', ')} yang sudah ada akan DIGANTI dengan isi Template Data.` : '',
      applyOpenings ? 'Saldo awal pos & akun akan DIGANTI dengan isi sheet Saldo Awal.' : '',
    ].filter(Boolean);
    if (warnings.length && !confirm(`${warnings.join('\n')}\nLanjutkan?`)) return;
    let result;
    const ok = await attempt(async () => {
      result = await api.post('/imports/template/commit', { token: up.token, months, overrides, apply_openings: applyOpenings });
    });
    if (!ok) return;
    const parts = [
      months.length ? `${result.added} baris tersimpan${result.replaced ? `, ${result.replaced} baris lama diganti` : ''}` : '',
      result.openings_changed ? `${result.openings_changed} saldo awal diperbarui` : '',
    ].filter(Boolean);
    toast(parts.join('; '));
    close();
    onSaved(result.months);
  });
}
