// Uang disimpan dalam SEN (integer) supaya penjumlahan tidak pernah meleset karena pembulatan desimal.
// API menerima dan mengirim nilai dalam RUPIAH (number), konversi hanya terjadi di sini.

const { badRequest } = require('./errors');

/** Rupiah (number) -> sen (integer). */
function toCents(rupiah) {
  const n = Number(rupiah);
  if (!Number.isFinite(n)) throw badRequest(`Nominal tidak valid: ${rupiah}`);
  return Math.round(n * 100);
}

/** Sen (integer) -> rupiah (number). */
function toRupiah(cents) {
  return cents == null ? null : cents / 100;
}

/** Nominal positif wajib (mis. input pengguna). */
function positiveCents(rupiah, label = 'Nominal') {
  const cents = toCents(rupiah);
  if (cents <= 0) throw badRequest(`${label} harus lebih dari 0`);
  return cents;
}

/**
 * Teks nominal dari rekening koran BCA -> sen bertanda.
 * "200,000.00 CR" -> 20000000, "1,844,000.00 DB" -> -184400000, "241,493,040.38" -> 24149304038.
 * Mengembalikan null bila teks bukan angka.
 */
function parseBankAmount(text) {
  const raw = String(text ?? '').replace(/ /g, ' ').trim().toUpperCase();
  const isDebit = raw.endsWith('DB');
  const digits = raw.replace(/(CR|DB)$/, '').replace(/,/g, '').trim();
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(Math.abs(n) * 100);
  return isDebit ? -cents : cents;
}

const sumCents = (rows, pick = (r) => r.amount_cents) => rows.reduce((total, r) => total + pick(r), 0);

const rupiahFormat = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sen -> teks "Rp 1.234.567,89" untuk pesan yang dibaca pengguna. */
function formatRupiah(cents) {
  if (cents == null) return '–';
  return `${cents < 0 ? '-' : ''}Rp ${rupiahFormat.format(Math.abs(cents) / 100)}`;
}

module.exports = { toCents, toRupiah, positiveCents, parseBankAmount, sumCents, formatRupiah };
