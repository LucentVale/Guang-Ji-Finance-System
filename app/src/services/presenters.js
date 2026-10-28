// Mengubah baris database menjadi bentuk yang dikirim ke frontend / Excel.
const { toRupiah } = require('../lib/money');
const { titleCase } = require('../lib/text');
const { CATEGORY_DONATUR } = require('./classifier');

/**
 * Nama seperti di Laporan Keuangan Tahunan:
 *   masuk dengan kategori  -> "PELITA ; IRENE"
 *   masuk donatur          -> "SAHABAT SEJATI"
 *   keluar                 -> uraian saja (ditampilkan menjorok, seperti kolom C di Excel)
 */
function sheetName(t) {
  const categoryIsName = t.category === String(t.name).toUpperCase(); // mis. baris bank "BUNGA BANK"
  if (t.amount_cents > 0 && t.category && !categoryIsName && t.category !== CATEGORY_DONATUR && !t.category.startsWith('PINDAHAN')) {
    return `${t.category} ; ${t.name}`;
  }
  return t.name;
}

/** Label baris di laporan bulanan (Bentuk Laporan Keuangan). */
function reportLabel(t) {
  if (t.category === CATEGORY_DONATUR) return 'Donatur';
  if (t.category) return titleCase(t.category);
  return titleCase(t.name) || (t.amount_cents > 0 ? 'Lain-lain' : 'Pengeluaran Lain');
}

function transaction(t, lookup = {}) {
  return {
    id: t.id,
    date: t.date,
    account_id: t.account_id,
    account: lookup.accounts?.get(t.account_id)?.name ?? '',
    pos_id: t.pos_id,
    pos: lookup.pos?.get(t.pos_id)?.code ?? '',
    category: t.category,
    name: t.name,
    sheet_name: sheetName(t),
    masuk: t.amount_cents > 0 ? toRupiah(t.amount_cents) : 0,
    keluar: t.amount_cents < 0 ? toRupiah(-t.amount_cents) : 0,
    receipt_no: t.receipt_no,
    piao_wen: t.piao_wen,
    note: t.note,
    source: t.source,
    bank_type: t.bank_type,
    bank_code: t.bank_code,
    bank_desc: t.bank_desc,
    balance: toRupiah(t.balance_cents),
    transfer_id: t.transfer_id,
    split_of: t.split_of ?? null,
  };
}

/** Baris otomatis bank (bunga, pajak bunga, biaya admin): nama sudah menjelaskan, kategori tidak perlu ditulis. */
const isSystemRow = (t) => ['BUNGA BANK', 'PAJAK BUNGA', 'BIAYA ADM'].includes(t.category);

module.exports = { transaction, sheetName, reportLabel, isSystemRow };
