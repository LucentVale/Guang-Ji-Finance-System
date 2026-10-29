// Form transaksi (baru / ubah), rincian read-only, pecah transaksi, dan form pindahan antar pos.
import { $, $$, html } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, parseAmount, todayIso, dateId } from '../core/format.js';
import { openModal, attempt } from './feedback.js';
import { posOptions, accountOptions } from './options.js';

const SOURCE_NOTES = {
  mutasi: 'Baris dari mutasi bank: tanggal, akun, dan nominal mengikuti rekening koran. Yang bisa diubah: pos, kategori, nama, dan keterangan.',
  pindahan: 'Baris pindahan antar pos tidak bisa diubah. Hapus untuk membatalkan (pasangannya ikut terhapus).',
};

function defaultDate() {
  const today = todayIso();
  return today.startsWith(String(store.year)) ? today : `${store.year}-01-01`;
}

const SOURCE_LABEL = { mutasi: 'Mutasi bank', draf: 'File DRAF', manual: 'Input manual', pindahan: 'Pindahan antar pos' };

/** Rincian satu transaksi tanpa bisa diubah — untuk pengguna yang hanya boleh melihat (Pimpinan). */
export function openTransactionDetail(tx) {
  const row = (label, value) => (value ? html`<dt>${label}</dt><dd>${value}</dd>` : '');
  openModal({
    title: 'Rincian Transaksi',
    body: html`
      <dl class="detail-list">
        ${row('Tanggal', dateId(tx.date))}
        ${row('Pos', store.posById(tx.pos_id)?.name ?? 'Belum dialokasikan')}
        ${row('Akun', store.accountById(tx.account_id)?.name)}
        ${row('Kategori', tx.category)}
        ${row('Nama / uraian', tx.name)}
        ${row(tx.masuk ? 'Masuk' : 'Keluar', `Rp ${money(tx.masuk || tx.keluar)}`)}
        ${row('No. Kwitansi', tx.receipt_no)}
        ${row('Piao Wen', tx.piao_wen)}
        ${row('Keterangan', tx.note)}
        ${row('Sumber', SOURCE_LABEL[tx.source] || tx.source)}
        ${row('Kode mutasi', tx.bank_code)}
      </dl>
      <p class="muted" style="margin:0;font-size:12px">Anda hanya punya akses melihat. Perubahan data dilakukan oleh Bendahara atau Admin.</p>`,
    footer: html`<div></div><button data-close>Tutup</button>`,
  });
}

/**
 * @param {object|null} tx transaksi yang diubah (null = baru)
 * @param {{posId?: number, defaults?: {date?: string, account_id?: number}, onSaved: () => void}} options
 *   defaults = isian awal untuk transaksi baru (mis. tanggal & akun dari halaman Draf)
 */
export async function openTransactionForm(tx, { posId, defaults = {}, onSaved }) {
  if (!store.can('write')) return; // Pimpinan hanya melihat
  const categories = await api.get('/categories').catch(() => []);
  const locked = tx?.source === 'mutasi';
  const readOnly = tx?.source === 'pindahan';
  let kind = !tx || tx.masuk ? 'in' : 'out';

  const { root, close } = openModal({
    title: tx ? 'Ubah Transaksi' : 'Transaksi Baru',
    body: html`
      ${tx && SOURCE_NOTES[tx.source] ? html`<p class="notice">${SOURCE_NOTES[tx.source]}${tx.bank_code ? html`<br><span class="mono">${tx.bank_code}</span>` : ''}</p>` : ''}
      <form class="form-grid" id="txForm">
        <label>Tanggal<input type="date" name="date" required value="${tx?.date || defaults.date || defaultDate()}" ${locked || readOnly ? 'disabled' : ''}></label>
        <label>Akun<select name="account_id" ${locked || readOnly ? 'disabled' : ''}>${accountOptions(tx?.account_id ?? defaults.account_id)}</select></label>
        <label class="full">Pos<select name="pos_id" required ${readOnly ? 'disabled' : ''}>${posOptions(tx?.pos_id ?? posId, { empty: 'Pilih pos…' })}</select></label>
        <div class="full">
          <div class="segmented" role="radiogroup" aria-label="Jenis transaksi">
            <button type="button" data-kind="in" class="${kind === 'in' ? 'on' : ''}" ${locked || readOnly ? 'disabled' : ''}>Masuk</button>
            <button type="button" data-kind="out" class="${kind === 'out' ? 'on' : ''}" ${locked || readOnly ? 'disabled' : ''}>Keluar</button>
          </div>
        </div>
        <label>Nominal (Rp)<input name="amount" inputmode="decimal" required placeholder="0" value="${tx ? money(tx.masuk || tx.keluar) : ''}" ${locked || readOnly ? 'disabled' : ''}></label>
        <label>Kategori<input name="category" list="categoryList" value="${tx?.category || ''}" placeholder="DONATUR, PELITA, ANGPAO…" ${readOnly ? 'disabled' : ''}>
          <datalist id="categoryList">${categories.map((c) => html`<option value="${c}">`)}</datalist></label>
        <label class="full">Nama donatur / uraian<input name="name" required value="${tx?.name || ''}" ${readOnly ? 'disabled' : ''}></label>
        <label>No. Kwitansi<input name="receipt_no" value="${tx?.receipt_no || ''}" ${readOnly ? 'disabled' : ''}></label>
        <label>Piao Wen<input name="piao_wen" value="${tx?.piao_wen || ''}" ${readOnly ? 'disabled' : ''}></label>
        <label class="full">Keterangan<input name="note" value="${tx?.note || ''}" ${readOnly ? 'disabled' : ''}></label>
        <p class="full muted" style="font-size:12px;margin:0">Kategori <b>DONATUR</b> masuk ke Daftar Donatur. Pengeluaran tanpa kategori tampil per uraian di laporan bulanan.</p>
      </form>`,
    footer: html`
      <div class="toolbar">
        ${tx ? html`<button class="btn-danger" data-action="delete">${tx.split_of ? 'Gabungkan kembali' : 'Hapus'}</button>` : ''}
        ${tx && !readOnly ? html`<button data-action="split" title="Bagi transaksi ini ke pos lain">✂ Pecah ke pos lain</button>` : ''}
      </div>
      <div class="toolbar"><button data-close>Batal</button>${readOnly ? '' : html`<button class="btn-primary" data-action="save">Simpan</button>`}</div>`,
  });

  const form = $('#txForm', root);
  $$('[data-kind]', root).forEach((btn) => btn.addEventListener('click', () => {
    kind = btn.dataset.kind;
    $$('[data-kind]', root).forEach((b) => b.classList.toggle('on', b === btn));
  }));

  async function save() {
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const amount = locked ? tx.masuk || tx.keluar : parseAmount(data.amount);
    const body = { ...data, masuk: kind === 'in' ? amount : 0, keluar: kind === 'out' ? amount : 0 };
    const ok = await attempt(() => (tx ? api.put(`/transactions/${tx.id}`, body) : api.post('/transactions', body)), 'Transaksi disimpan');
    if (ok) { close(); onSaved(); }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  $('[data-action="save"]', root)?.addEventListener('click', save);
  $('[data-action="split"]', root)?.addEventListener('click', () => {
    close();
    openSplitForm(tx, { onSaved });
  });
  $('[data-action="delete"]', root)?.addEventListener('click', async () => {
    const warning = tx.split_of
      ? 'Gabungkan pecahan ini kembali ke transaksi asalnya?'
      : locked ? 'Hapus baris mutasi ini? Saldo tidak akan cocok dengan bank sampai file mutasinya diimpor ulang.' : 'Hapus transaksi ini?';
    if (!confirm(warning)) return;
    if (await attempt(() => api.del(`/transactions/${tx.id}`), 'Transaksi dihapus')) { close(); onSaved(); }
  });
}

/**
 * Pecah satu transaksi ke pos lain, mis. transfer Rp 1.000.000 dari Sherly:
 * Rp 500.000 tetap di CU THAN, Rp 500.000 dipecah ke KFCC. Total tetap sama dengan rekening koran.
 */
export function openSplitForm(tx, { onSaved }) {
  const total = tx.masuk || tx.keluar;
  const { root, close } = openModal({
    title: 'Pecah Transaksi ke Pos Lain',
    body: html`
      <p class="muted">Transaksi <b>${tx.pos || 'tanpa pos'} ; ${tx.name}</b> sebesar <b>Rp ${money(total)}</b>.
        Isi bagian yang dipindahkan ke pos lain; sisanya tetap di baris ini.</p>
      <form class="form-grid" id="splitForm">
        <label>Nominal yang dipecah (Rp)<input name="amount" inputmode="decimal" required value="${money(total / 2)}"></label>
        <label>Ke pos<select name="pos_id" required>${posOptions('', { empty: 'Pilih pos…' })}</select></label>
        <label>Kategori<input name="category" value="${tx.category}"></label>
        <label>Nama<input name="name" value="${tx.name}"></label>
        <p class="full muted" style="margin:0" id="splitRemainder"></p>
      </form>`,
    footer: html`<div></div><div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-action="save">Pecah</button></div>`,
  });
  const form = $('#splitForm', root);
  const showRemainder = () => {
    const rest = total - parseAmount(form.amount.value);
    $('#splitRemainder', root).textContent = `Sisa di ${tx.pos || 'baris ini'}: Rp ${money(rest)}`;
  };
  form.amount.addEventListener('input', showRemainder);
  showRemainder();
  $('[data-action="save"]', root).addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (await attempt(() => api.post(`/transactions/${tx.id}/split`, { ...data, amount: parseAmount(data.amount) }), 'Transaksi dipecah')) { close(); onSaved(); }
  });
}

/** Pindahan saldo dari satu pos ke pos lain dalam satu akun. */
export function openTransferForm({ fromPosId, onSaved }) {
  const { root, close } = openModal({
    title: 'Pindahan Antar Pos',
    body: html`
      <p class="muted">Contoh: "Pindahan dari Phing An Ten" ke Cu Than, atau bagian KFCC dari donasi yang masuk ke Cu Than. Total saldo akun tidak berubah.</p>
      <form class="form-grid" id="transferForm">
        <label>Tanggal<input type="date" name="date" required value="${defaultDate()}"></label>
        <label>Akun<select name="account_id">${accountOptions()}</select></label>
        <label>Dari pos<select name="from_pos_id" required>${posOptions(fromPosId, { empty: 'Pilih…' })}</select></label>
        <label>Ke pos<select name="to_pos_id" required>${posOptions('', { empty: 'Pilih…' })}</select></label>
        <label>Nominal (Rp)<input name="amount" inputmode="decimal" required placeholder="0"></label>
        <label>Keterangan<input name="note" placeholder="opsional"></label>
      </form>`,
    footer: html`<div></div><div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-action="save">Simpan Pindahan</button></div>`,
  });
  $('[data-action="save"]', root).addEventListener('click', async () => {
    const form = $('#transferForm', root);
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (await attempt(() => api.post('/transfers', { ...data, amount: parseAmount(data.amount) }), 'Pindahan disimpan')) { close(); onSaved(); }
  });
}
