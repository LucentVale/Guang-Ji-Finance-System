// Format file "DRAF Laporan Keuangan" — dipakai untuk EKSPOR (membuat file) dan IMPOR (membaca file).
// Tata letak mengikuti file kerja manual:
//
//   baris 1  : KUANG HANG FO THANG                      (A1:J1, Calibri 26)
//   baris 2  : DRAFT Laporan Keuangan CU THAN 2026       (A2:J2, Calibri 20, garis bawah)
//   baris 3-4: Tgl | Pos | Keterangan | No Kwitansi | Piao Wen | Keterangan | Masuk | Keluar | Saldo
//                                                                           BCA     BCA      BCA
//   baris 5  : SALDO AWAL ............................................................. [J5 hitam]
//   lalu per bulan: satu baris kosong, lalu baris transaksi dengan tanggal lengkap (1/1/2026) di kolom Tgl.
//   Kolom J berisi rumus =J(sebelumnya)+H-I. Masuk berwarna oranye, Keluar hijau.
//
// Ekspor: satu sheet bernama bulan terakhir yang berisi data, KUMULATIF sejak Januari (sheet "Sep" = Januari s.d. September).
// Impor: sheet mana pun dari file manual (yang dulu berisi banyak sheet bulan) bisa dipilih.
// Pembaca file juga menerima tata letak lama: kolom B berisi gabungan "POS ; KETERANGAN",
// dan kolom Tgl berisi nomor hari di bawah judul bulan ("JANUARI 2026").

const ExcelJS = require('exceljs');
const { clean, upper } = require('../lib/text');

// ---------------------------------------------------------------- Tata letak & gaya

/** Nama sheet seperti di file manual (bulan terbaru di kiri). */
const SHEET_NAMES = ['January', 'February', 'March', 'April', 'Mei', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];

const COL = { day: 1, pos: 2, ket: 3, ketEnd: 4, receipt: 5, piao: 6, note: 7, masuk: 8, keluar: 9, saldo: 10 };
const WIDTHS = [12.71, 15.71, 30.43, 10.57, 10.71, 5.57, 15.71, 12.71, 12.71, 15.71];
const ROW_HEIGHT = 25.15;
const FIRST_DATA_ROW = 6;

const FONT = { name: 'Calibri', size: 12 };
const FILL_MASUK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC99' } };  // oranye (indeks warna 47)
const FILL_KELUAR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFFCC' } }; // hijau (indeks warna 42)
const FILL_BLACK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D0D0D' } };
const FMT_AMOUNT = '#,##0_);[Red](#,##0)';
const FMT_SALDO = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
const FMT_DATE = 'd/m/yyyy';
const THIN = { style: 'thin' };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const MIDDLE = { vertical: 'middle' };

/** "2026-01-02" -> tanggal Excel (UTC, supaya tidak bergeser karena zona waktu). */
const excelDate = (iso) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));

function styleRow(ws, r) {
  ws.getRow(r).height = ROW_HEIGHT;
  for (let c = 1; c <= 10; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { ...FONT, ...(cell.font || {}) };
    cell.alignment = { ...MIDDLE, ...(cell.alignment || {}) };
  }
  // Kotak per kolom; Keterangan (C:D) tampil sebagai satu kolom tanpa garis tengah.
  for (const c of [COL.day, COL.pos, COL.receipt, COL.piao, COL.note, COL.masuk, COL.keluar, COL.saldo]) ws.getCell(r, c).border = BOX;
  ws.getCell(r, COL.ket).border = { top: THIN, bottom: THIN, left: THIN };
  ws.getCell(r, COL.ketEnd).border = { top: THIN, bottom: THIN, right: THIN };
  ws.getCell(r, COL.masuk).fill = FILL_MASUK;
  ws.getCell(r, COL.keluar).fill = FILL_KELUAR;
  ws.getCell(r, COL.masuk).numFmt = FMT_AMOUNT;
  ws.getCell(r, COL.keluar).numFmt = FMT_AMOUNT;
  ws.getCell(r, COL.saldo).numFmt = FMT_SALDO;
  ws.getCell(r, COL.receipt).numFmt = '@';
}

function writeHeader(ws, { orgName, year, accountName }) {
  ws.columns = WIDTHS.map((width) => ({ width }));
  ws.mergeCells('A1:J1');
  ws.mergeCells('A2:J2');
  ws.getCell('A1').value = orgName.toUpperCase();
  ws.getCell('A1').font = { name: 'Calibri', size: 26 };
  ws.getCell('A2').value = { richText: [
    { text: 'DRAFT', font: { name: 'Calibri', size: 20, bold: true } },
    { text: ` Laporan Keuangan CU THAN ${year}`, font: { name: 'Calibri', size: 20 } },
  ] };
  for (const a of ['A1', 'A2']) ws.getCell(a).alignment = { horizontal: 'center', vertical: 'middle' };
  for (let c = 1; c <= 10; c++) ws.getCell(2, c).border = { bottom: THIN };
  ws.getRow(1).height = ws.getRow(2).height = ROW_HEIGHT;

  // Baris 3-4: judul kolom.
  // Kolom tanpa sub-judul akun digabung dua baris (3-4); Masuk/Keluar/Saldo punya sub-judul nama akun di baris 4.
  for (const range of ['A3:A4', 'B3:B4', 'C3:D4', 'E3:E4', 'F3:F4', 'G3:G4']) ws.mergeCells(range);
  const titles = { A3: 'Tgl', B3: 'Pos', C3: 'Keterangan', E3: 'No Kwitansi', F3: 'Piao Wen', G3: 'Keterangan', H3: 'Masuk', I3: 'Keluar', J3: 'Saldo' };
  for (const [a, v] of Object.entries(titles)) ws.getCell(a).value = v;
  for (const a of ['H4', 'I4', 'J4']) ws.getCell(a).value = accountName;
  for (const r of [3, 4]) {
    ws.getRow(r).height = ROW_HEIGHT;
    for (let c = 1; c <= 10; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { ...FONT, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BOX;
    }
  }
  ws.getCell('H4').fill = FILL_MASUK;
  ws.getCell('I4').fill = FILL_KELUAR;
}

/**
 * Buat file DRAF.
 * @param {object} p
 * @param {string} p.orgName nama Fothang, mis. "Kuang Hang Fo Thang"
 * @param {string} p.accountName mis. "BCA"
 * @param {number} p.year
 * @param {number} p.opening saldo awal akun per 1 Januari (rupiah)
 * @param {{month:number, rows:object[]}[]} p.months baris Draf per bulan (lihat ledgerService.draf), urut Januari dst.
 * @param {number} p.lastMonth bulan terakhir; dibuat SATU sheet bernama bulan ini, berisi Januari s.d. bulan ini
 */
async function buildDrafWorkbook({ orgName, accountName, year, opening, months, lastMonth }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistem Keuangan Guang Ji';
  const ws = wb.addWorksheet(SHEET_NAMES[lastMonth - 1], {
    views: [{ showGridLines: false, zoomScale: 85, state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:4' },
  });
  writeHeader(ws, { orgName, year, accountName });

  // Baris 5: saldo awal.
  styleRow(ws, 5);
  ws.getCell('D5').value = 'SALDO AWAL';
  ws.getCell('D5').font = { name: 'Calibri', size: 10 };
  ws.getCell('D5').alignment = { horizontal: 'right', vertical: 'middle' };
  const j5 = ws.getCell('J5');
  j5.value = opening;
  j5.fill = FILL_BLACK;
  j5.font = { name: 'Calibri', size: 10, color: { argb: 'FFFFFFFF' } };
  j5.alignment = { horizontal: 'center', vertical: 'middle' };

  let r = FIRST_DATA_ROW;
  let saldo = opening;
  const addRow = (values) => {
    styleRow(ws, r);
    for (const [c, v] of Object.entries(values)) if (v !== '' && v != null) ws.getCell(r, Number(c)).value = v;
    ws.getCell(r, COL.saldo).value = { formula: `J${r - 1}+H${r}-I${r}`, result: saldo };
    r++;
  };

  for (const m of months.filter((x) => x.month <= lastMonth)) {
    addRow({}); // baris kosong di awal setiap bulan
    for (const t of m.rows) {
      saldo = Math.round((saldo + t.masuk - t.keluar) * 100) / 100;
      addRow({
        [COL.day]: excelDate(t.date),
        [COL.pos]: t.draf_pos,
        [COL.ket]: t.draf_ket,
        [COL.receipt]: t.receipt_no,
        [COL.piao]: t.piao_wen,
        [COL.note]: t.note,
        [COL.masuk]: t.masuk || null,
        [COL.keluar]: t.keluar || null,
      });
      const dateCell = ws.getCell(r - 1, COL.day);
      dateCell.numFmt = FMT_DATE;
      dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- Membaca file DRAF

// Judul bulan yang dikenali (file manual memakai campuran Indonesia & Inggris, mis. "MARCH 2026", "AUG 2026").
const MONTH_WORDS = [
  ['JANUARI', 'JANUARY', 'JAN'], ['FEBRUARI', 'FEBRUARY', 'FEB'], ['MARET', 'MARCH', 'MAR'], ['APRIL', 'APR'],
  ['MEI', 'MAY'], ['JUNI', 'JUNE', 'JUN'], ['JULI', 'JULY', 'JUL'], ['AGUSTUS', 'AUGUST', 'AUG', 'AGS'],
  ['SEPTEMBER', 'SEPT', 'SEP'], ['OKTOBER', 'OCTOBER', 'OKT', 'OCT'], ['NOVEMBER', 'NOV'], ['DESEMBER', 'DECEMBER', 'DES', 'DEC'],
];

/** "MARCH 2026" -> 3, selain judul bulan -> null. */
function parseMonthTitle(text) {
  const m = upper(text).match(/^([A-Z]+)\.?\s+(20\d{2})$/);
  if (!m) return null;
  const index = MONTH_WORDS.findIndex((words) => words.includes(m[1]));
  return index < 0 ? null : { month: index + 1, year: Number(m[2]) };
}

function cellValue(cell) {
  if (cell.isMerged && cell.master.address !== cell.address) return null;
  const v = cell.value;
  if (v && typeof v === 'object') {
    if ('result' in v) return v.result ?? null;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return v.text;
  }
  return v;
}
const cellText = (cell) => clean(cellValue(cell) ?? '');

/** Tanggal di kolom Tgl: sel bertipe tanggal Excel, atau teks "1/1/2026" (hari/bulan/tahun). Selain itu null. */
function cellDate(cell) {
  const v = cellValue(cell);
  if (v instanceof Date) return { year: v.getUTCFullYear(), month: v.getUTCMonth() + 1, day: v.getUTCDate() };
  const m = typeof v === 'string' && v.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](20\d{2})$/);
  return m ? { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) } : null;
}
const cellNumber = (cell) => {
  const v = cellValue(cell);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/**
 * Baca satu sheet DRAF.
 * @returns {{ layout: 'pos'|'gabung', year: number|null, opening: number|null, rows: object[] }}
 *   rows: { month, day, day_assumed, date, pos_text, keterangan, code, masuk, keluar, receipt_no, piao_wen, note, file_saldo, row }
 */
function parseDrafSheet(ws) {
  // Cari baris judul kolom ("Tgl" di kolom A).
  let headerRow = null;
  for (let r = 1; r <= 10 && !headerRow; r++) if (upper(cellText(ws.getCell(r, 1))) === 'TGL') headerRow = r;
  if (!headerRow) throw new Error(`Sheet "${ws.name}" bukan format DRAF (judul kolom "Tgl" tidak ditemukan)`);

  // Tata letak baru: kolom B "Pos", C "Keterangan". Tata letak lama: kolom B "NAMA" berisi "POS ; KETERANGAN".
  const layout = upper(cellText(ws.getCell(headerRow, 2))) === 'POS' ? 'pos' : 'gabung';
  const titleYear = cellText(ws.getCell(2, 1)).match(/20\d{2}/);
  let year = titleYear ? Number(titleYear[0]) : null;

  let opening = null;
  let current = null;
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r <= headerRow + 1) return;
    const a = ws.getCell(r, COL.day);
    if (upper(cellText(ws.getCell(r, COL.ketEnd))).includes('SALDO AWAL') || upper(cellText(ws.getCell(r, COL.pos))).includes('SALDO AWAL')) {
      opening = cellNumber(ws.getCell(r, COL.saldo));
      return;
    }
    // Tata letak lama: judul bulan ("JANUARI 2026") di kolom Tgl, baris di bawahnya hanya berisi nomor hari.
    const title = parseMonthTitle(cellText(a));
    if (title) { current = title.month; year = year || title.year; return; }
    // Tata letak baru: tanggal lengkap di setiap baris.
    const date = cellDate(a);
    if (date) { current = date.month; year = year || date.year; }

    const masuk = cellNumber(ws.getCell(r, COL.masuk)) || 0;
    const keluar = cellNumber(ws.getCell(r, COL.keluar)) || 0;
    if (!current || (!masuk && !keluar)) return;
    // Baris bernominal tanpa tanggal (mis. bunga/biaya bank di akhir bulan): pakai tanggal baris sebelumnya.
    const written = date ? date.day : cellNumber(a);
    const previous = rows.at(-1)?.month === current ? rows.at(-1).day : null;
    const day = written || previous || 1;

    const posText = layout === 'pos' ? cellText(ws.getCell(r, COL.pos)) : '';
    const keterangan = layout === 'pos'
      ? clean(`${cellText(ws.getCell(r, COL.ket))} ${cellText(ws.getCell(r, COL.ketEnd))}`)
      : cellText(ws.getCell(r, COL.pos));
    rows.push({
      row: r,
      month: current,
      day,
      day_assumed: !written,
      pos_text: posText,
      keterangan,
      code: layout === 'pos' ? `${posText} ; ${keterangan}` : keterangan,
      masuk,
      keluar,
      receipt_no: cellText(ws.getCell(r, COL.receipt)),
      piao_wen: cellText(ws.getCell(r, COL.piao)),
      note: cellText(ws.getCell(r, COL.note)),
      file_saldo: cellNumber(ws.getCell(r, COL.saldo)),
    });
  });
  const pad = (n) => String(n).padStart(2, '0');
  for (const x of rows) x.date = year ? `${year}-${pad(x.month)}-${pad(x.day)}` : null;
  return { layout, year, opening, rows };
}

module.exports = { buildDrafWorkbook, parseDrafSheet, parseMonthTitle, SHEET_NAMES, COL };
