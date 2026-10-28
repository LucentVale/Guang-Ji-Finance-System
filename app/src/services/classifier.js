// Menerjemahkan kode kolom C mutasi ("DANA ; KATEGORI ; NAMA") menjadi pos, kategori, dan nama.
// Modul ini murni (tanpa database) sehingga mudah diuji: lihat test/classifier.test.js.
//
// Aturan:
//   "CU THAN ; SAHABAT SEJATI"      -> pos CU THAN, uang masuk = kategori DONATUR, nama SAHABAT SEJATI
//   "CU THAN ; IURAN MABGI"         -> pos CU THAN, uang keluar tanpa kategori, uraian IURAN MABGI
//   "CU THAN ; PELITA ; IRENE"      -> pos CU THAN, kategori PELITA, nama IRENE
//   Baris bank BUNGA / PAJAK BUNGA / BIAYA ADM -> kategori baku, apa pun isi kolom C-nya
//   Alias "PAT WU AI LIU=Wu Ai Liu" -> pos PAT dengan kategori WU AI LIU
//   "CU THAN ; SHERLY THE (500K) KFCC ; SHERLY THE (500K)" (masuk 1 juta)
//                                   -> pos CU THAN, DONATUR, dengan saran pecah: 500rb ke pos KFCC

const { clean, upper, titleCase } = require('../lib/text');

const CATEGORY_DONATUR = 'DONATUR';

/** Kategori baku untuk baris yang dibuat otomatis oleh bank (berdasarkan kolom B). */
/**
 * Kategori baku untuk baris otomatis bank. Dikenali dari kolom B rekening koran (bankType),
 * atau — untuk file DRAF yang tidak punya kolom itu — dari tulisan keterangannya.
 */
function systemCategory(bankType, text = '') {
  const type = upper(bankType);
  if (type === 'BUNGA') return 'BUNGA BANK';
  if (type.startsWith('PAJAK')) return 'PAJAK BUNGA';
  if (type.startsWith('BIAYA ADM')) return 'BIAYA ADM';
  if (type) return '';
  const t = upper(text);
  if (t === 'BUNGA BANK') return 'BUNGA BANK';
  if (t.startsWith('PAJAK BUNGA')) return 'PAJAK BUNGA';
  if (/^(BIAYA|BY\.?) ?ADM/.test(t)) return 'BIAYA ADM';
  return '';
}

/** Penanda nominal pecahan di akhir teks, mis. "(500K)", "250K", "1 JT". */
const SPLIT_MARKER = /\s*\(?\d+(?:[.,]\d+)?\s*(K|RB|JT)\)?\s*$/i;

/**
 * Peta kode -> { posId, category } dari daftar pos.
 * @param {{id:number, code:string, aliases:string}[]} posList
 */
function buildAliasIndex(posList) {
  const index = new Map();
  for (const pos of posList) {
    for (const entry of [pos.code, ...String(pos.aliases || '').split(',')]) {
      const [alias, category] = entry.split('=');
      if (!clean(alias)) continue;
      index.set(upper(alias), { posId: pos.id, category: category ? upper(category) : '' });
    }
  }
  return index;
}

const UNIT_CENTS = { K: 100000, RB: 100000, JT: 100000000 };

/**
 * Kenali penanda pecah di bagian tengah kode: "<teks> <angka><K|RB|JT> <KODE POS>".
 * Contoh: "SHERLY THE (500K) KFCC" -> { pos_id: KFCC, amount_cents: 50000000 }.
 * Mengembalikan null bila bukan penanda pecah atau kode pos-nya tidak dikenal.
 */
function splitHint(text, aliasIndex) {
  const m = upper(text).match(/\(?(\d+(?:[.,]\d+)?)\s*(K|RB|JT)\)?\s+(.+)$/);
  if (!m) return null;
  const target = aliasIndex.get(clean(m[3]));
  if (!target) return null;
  return { pos_id: target.posId, pos_code: clean(m[3]), amount_cents: Math.round(Number(m[1].replace(',', '.')) * UNIT_CENTS[m[2]]) };
}

/**
 * @param {{bank_code:string, bank_type:string, amount_cents:number}} row
 * @param {Map} aliasIndex hasil buildAliasIndex
 * @returns {{pos_id:number|null, pos_code:string, category:string, name:string, split:object|null}}
 *   split = saran pecah { pos_id, pos_code, amount_cents } (lihat splitHint)
 */
function classify(row, aliasIndex) {
  const parts = clean(row.bank_code).split(';').map(clean).filter(Boolean);
  const posCode = upper(parts[0] || '');
  const match = aliasIndex.get(posCode);
  const incoming = row.amount_cents > 0;

  let category = '';
  let name = '';
  let split = null;
  const sysCategory = systemCategory(row.bank_type, parts[1]);
  if (sysCategory) {
    category = sysCategory;
    name = parts[1] ? upper(parts[1]) : sysCategory; // nama ditulis seperti di kode, mis. "BIAYA ADMIN BANK"
  } else if (parts.length <= 1) {
    name = clean(row.bank_code) || titleCase(row.bank_type);
  } else if (parts.length === 2) {
    name = parts[1];
    category = incoming ? CATEGORY_DONATUR : '';
  } else {
    split = splitHint(parts[1], aliasIndex);
    category = split ? (incoming ? CATEGORY_DONATUR : '') : upper(parts[1]);
    name = parts.slice(2).join(' ; ');
    // "SHERLY THE (500K)" -> "SHERLY THE": penanda nominal hanya untuk memecah, tidak ikut ke nama (sama seperti file DRAF).
    if (split) name = clean(name.replace(SPLIT_MARKER, '')) || name;
  }

  if (match?.category && (!category || category === CATEGORY_DONATUR)) category = match.category;
  // Pecahan hanya masuk akal bila lebih kecil dari nominal dan ke pos yang berbeda.
  if (split && (!match || split.pos_id === match.posId || split.amount_cents >= Math.abs(row.amount_cents))) split = null;

  return { pos_id: match ? match.posId : null, pos_code: posCode, category, name, split };
}

module.exports = { classify, buildAliasIndex, systemCategory, splitHint, CATEGORY_DONATUR };
