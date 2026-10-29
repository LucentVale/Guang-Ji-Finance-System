// Format angka & tanggal gaya Indonesia.

export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const numberFormat = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234567.5 -> "1.234.567,50"; kosong untuk null. */
export const money = (n) => (n == null ? '' : numberFormat.format(n));

const wholeFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/**
 * Seperti money(), tetapi ",00" dihilangkan bila tidak ada sen: 200000 -> "200.000", 118112.78 -> "118.112,78".
 * Dipakai di tabel yang padat (Laporan per Pos). money() tetap dipakai halaman lain.
 */
export function amount(n) {
  if (n == null) return '';
  return Math.round(n * 100) % 100 === 0 ? wholeFormat.format(Math.round(n)) : numberFormat.format(n);
}

/** "Rp 1.234.567,50" / "-Rp 1.234.567,50". */
export const rupiah = (n) => (n == null ? '–' : `${n < 0 ? '-' : ''}Rp ${numberFormat.format(Math.abs(n))}`);

/** Kelas CSS untuk angka: merah bila negatif. */
export const numClass = (n) => (n < 0 ? 'num neg' : 'num');

/** "2026-01-31" -> "31/01/2026". */
export const dateId = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export const dayOf = (iso) => Number(iso.slice(8, 10));

/** "2026-01-02" -> "2/1/2026" (seperti kolom Tgl di file DRAF). */
export const dateShort = (iso) => (iso ? `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}` : '');

/** "PELITA ULAMBANA" -> "Pelita Ulambana". */
export const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s(\-/&])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/**
 * Baca nominal yang diketik pengguna. Mendukung "1.250.000,50", "1250000.5", "1,250,000".
 * Mengembalikan 0 untuk input kosong / tidak valid.
 */
export function parseAmount(text) {
  let s = String(text ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) {
    // Pemisah yang muncul terakhir adalah pemisah desimal.
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{3}$/.test(s) && (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
