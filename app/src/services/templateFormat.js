// Format file "Template Data Guang Ji": bentuk data seragam untuk semua vihara.
// Satu baris = satu transaksi. Dipakai untuk EKSPOR (membuat template, kosong atau berisi data)
// dan IMPOR (membaca template yang sudah diisi). Modul ini murni (tanpa database).
//
// Sheet:
//   Petunjuk  : cara mengisi & arti kolom
//   Transaksi : Tanggal | Akun | Pos | Kategori | Nama / Uraian | Masuk | Keluar | Saldo Bank | No Kwitansi | Piao Wen | Catatan
//   Saldo Awal: saldo awal setiap pos per akun pada tanggal mulai pembukuan, ditambah saldo awal tiap akun
//               (untuk vihara yang baru mulai memakai aplikasi; dipakai saat impor hanya bila dicentang)
//   Daftar    : kode & nama Pos, nama Akun, Kategori milik Fothang itu (sumber pilihan dropdown di sheet Transaksi)
//
// Pembaca mencari baris judul berdasarkan TEKS judul kolom, jadi urutan kolom boleh berubah
// dan kolom opsional boleh dihapus; yang wajib hanya Tanggal, Pos, dan Masuk/Keluar.

const ExcelJS = require('exceljs');
const { clean, upper } = require('../lib/text');

const SHEET = { guide: 'Petunjuk', data: 'Transaksi', openings: 'Saldo Awal', lists: 'Daftar' };

/** Label baris khusus di sheet Saldo Awal (dibaca ulang saat impor). */
const OPENING_LABEL = { header: 'Kode Pos', total: 'TOTAL POS', account: 'SALDO AWAL AKUN', diff: 'SELISIH' };

/** Kolom sheet Transaksi, sesuai urutan di file. `aliases` = judul lain yang juga diterima saat membaca. */
const COLUMNS = [
  { key: 'date', title: 'Tanggal', width: 13, required: true, help: 'Tanggal transaksi, mis. 13/10/2026 (hari/bulan/tahun).' },
  { key: 'account', title: 'Akun', width: 12, help: 'Rekening/kas tempat uang masuk atau keluar (pilih dari daftar). Boleh kosong bila Fothang hanya punya satu akun bank.' },
  { key: 'pos', title: 'Pos', width: 16, required: true, help: 'Kode pos (pilih dari daftar), mis. CU THAN.' },
  { key: 'category', title: 'Kategori', width: 18, help: 'Jenis transaksi, mis. DONATUR, PELITA, LISTRIK. Kosongkan bila tidak ada.' },
  { key: 'name', title: 'Nama / Uraian', width: 34, aliases: ['NAMA', 'URAIAN', 'KETERANGAN'], help: 'Nama donatur atau uraian pengeluaran.' },
  { key: 'masuk', title: 'Masuk', width: 16, help: 'Nominal uang masuk (angka saja). Isi Masuk ATAU Keluar, tidak keduanya.' },
  { key: 'keluar', title: 'Keluar', width: 16, help: 'Nominal uang keluar (angka saja, tanpa tanda minus).' },
  { key: 'saldo_bank', title: 'Saldo Bank', width: 18, aliases: ['SALDO'], help: 'Opsional: saldo menurut rekening koran sesudah transaksi ini. Bila diisi, Cek Saldo mencocokkan setiap baris.' },
  { key: 'receipt_no', title: 'No Kwitansi', width: 13, aliases: ['NO. KWITANSI', 'KWITANSI'], help: 'Opsional.' },
  { key: 'piao_wen', title: 'Piao Wen', width: 10, help: 'Opsional.' },
  { key: 'note', title: 'Catatan', width: 24, aliases: ['KETERANGAN TAMBAHAN'], help: 'Opsional: keterangan tambahan.' },
];
const COL_INDEX = Object.fromEntries(COLUMNS.map((c, i) => [c.key, i + 1]));

/** Baris kosong bergaris & berdropdown yang disediakan di bawah data untuk diisi. */
const EMPTY_ROWS = 300;

const FONT = { name: 'Calibri', size: 11 };
const FILL_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const FILL_MASUK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCC99' } };  // sama dengan file DRAF
const FILL_KELUAR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFFCC' } };
const FMT_AMOUNT = '#,##0.00;[Red]-#,##0.00';
const FMT_DATE = 'dd/mm/yyyy';
const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

/** "2026-01-02" -> tanggal Excel (UTC, supaya tidak bergeser karena zona waktu). */
const excelDate = (iso) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));

// ---------------------------------------------------------------- Membuat template

function writeGuide(wb, orgName) {
  const ws = wb.addWorksheet(SHEET.guide, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 18 }, { width: 100 }];
  const lines = [
    [`Template Data Keuangan — ${orgName}`, null, { bold: true, size: 16 }],
    [],
    ['Cara mengisi', null, { bold: true, size: 12 }],
    ['1.', `Isi sheet "${SHEET.data}": satu baris untuk satu transaksi, urut menurut tanggal.`],
    ['2.', 'Kolom Akun, Pos, dan Kategori bisa dipilih dari daftar (klik sel, lalu panah kecil di kanannya).'],
    ['3.', 'Isi nominal di kolom Masuk ATAU Keluar (angka saja, tanpa "Rp" dan tanpa minus).'],
    ['4.', `Jangan mengubah judul kolom di baris pertama. Daftar pilihan ada di sheet "${SHEET.lists}" (jangan diubah).`],
    ['5.', 'Simpan sebagai .xlsx lalu impor lewat aplikasi. Data akun pada bulan yang dipilih saat impor akan DIGANTI dengan isi file ini.'],
    [],
    ['Saldo Awal', null, { bold: true, size: 12 }],
    ['', `Sheet "${SHEET.openings}" cukup diisi sekali, saat vihara mulai memakai aplikasi: saldo setiap pos per akun pada tanggal mulai pembukuan.`],
    ['', `Baris ${OPENING_LABEL.account} = saldo rekening koran / kas pada tanggal itu. Baris ${OPENING_LABEL.diff} harus 0 (jumlah semua pos = saldo akun).`],
    ['', 'Saldo awal hanya diubah bila saat impor dicentang "Perbarui saldo awal". Pos baru ditambahkan dulu di Pengaturan.'],
    [],
    ['Arti kolom', null, { bold: true, size: 12 }],
    ...COLUMNS.map((c) => [c.title + (c.required ? ' *' : ''), c.help]),
    [],
    ['', '* wajib diisi'],
  ];
  lines.forEach(([a, b, font], i) => {
    const row = ws.getRow(i + 1);
    if (a != null) row.getCell(1).value = a;
    if (b != null) row.getCell(2).value = b;
    for (const c of [1, 2]) {
      row.getCell(c).font = { ...FONT, ...(font || {}) };
      row.getCell(c).alignment = { vertical: 'top', wrapText: c === 2 };
    }
  });
}

/** Huruf kolom Excel ke-n (1 = A). */
const colLetter = (n) => (n > 26 ? colLetter(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

/**
 * Sheet Saldo Awal: judul (baris 1-2), judul kolom Kode Pos | Nama Pos | <akun...> (baris 4), satu baris per pos,
 * lalu TOTAL POS (rumus), SALDO AWAL AKUN (diisi), SELISIH (rumus, harus 0).
 */
function writeOpenings(wb, { startDate, accounts, rows, accountOpenings }) {
  const ws = wb.addWorksheet(SHEET.openings, { views: [{ state: 'frozen', ySplit: 4 }] });
  const last = 2 + accounts.length;
  ws.columns = [{ width: 18 }, { width: 30 }, ...accounts.map(() => ({ width: 20 }))];
  ws.getCell('A1').value = `Saldo Awal per ${startDate.split('-').reverse().join('/')}`;
  ws.getCell('A1').font = { ...FONT, bold: true, size: 14 };
  ws.getCell('A2').value = `Saldo setiap pos per akun pada tanggal mulai pembukuan. ${OPENING_LABEL.diff} harus 0.`;
  ws.getCell('A2').font = { ...FONT, italic: true };

  [OPENING_LABEL.header, 'Nama Pos', ...accounts.map((a) => a.name)].forEach((v, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = v;
    cell.font = { ...FONT, bold: true };
    cell.fill = FILL_HEADER;
    cell.border = BOX;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const style = (r, bold = false) => {
    for (let c = 1; c <= last; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { ...FONT, bold };
      cell.border = BOX;
      if (c > 2) cell.numFmt = FMT_AMOUNT;
    }
  };
  const first = 5;
  rows.forEach((p, i) => {
    ws.getCell(first + i, 1).value = p.code;
    ws.getCell(first + i, 2).value = p.name;
    p.values.forEach((v, j) => { ws.getCell(first + i, 3 + j).value = v || 0; });
    style(first + i);
  });
  const end = first + Math.max(rows.length, 1) - 1;
  const [totalRow, accountRow, diffRow] = [end + 1, end + 2, end + 3];
  ws.getCell(totalRow, 1).value = OPENING_LABEL.total;
  ws.getCell(accountRow, 1).value = OPENING_LABEL.account;
  ws.getCell(diffRow, 1).value = OPENING_LABEL.diff;
  accounts.forEach((_, j) => {
    const c = 3 + j;
    const L = colLetter(c);
    const total = rows.reduce((s, p) => s + Math.round((p.values[j] || 0) * 100), 0) / 100;
    const opening = accountOpenings[j] || 0;
    ws.getCell(totalRow, c).value = { formula: `SUM(${L}${first}:${L}${end})`, result: total };
    ws.getCell(accountRow, c).value = opening;
    ws.getCell(diffRow, c).value = { formula: `${L}${totalRow}-${L}${accountRow}`, result: Math.round((total - opening) * 100) / 100 };
  });
  for (const r of [totalRow, accountRow, diffRow]) style(r, true);
  for (let c = 3; c <= last; c++) ws.getCell(accountRow, c).fill = FILL_MASUK; // sel yang diisi pengguna
}

/** Sheet Daftar: kolom A-B Pos (kode, nama), D Akun, F Kategori. Mengembalikan rentang untuk dropdown. */
function writeLists(wb, { pos, accounts, categories }) {
  const ws = wb.addWorksheet(SHEET.lists);
  ws.columns = [{ width: 18 }, { width: 30 }, { width: 3 }, { width: 16 }, { width: 3 }, { width: 24 }];
  const head = { A1: 'Kode Pos', B1: 'Nama Pos', D1: 'Akun', F1: 'Kategori' };
  for (const [a, v] of Object.entries(head)) {
    ws.getCell(a).value = v;
    ws.getCell(a).font = { ...FONT, bold: true };
    ws.getCell(a).fill = FILL_HEADER;
  }
  pos.forEach((p, i) => { ws.getCell(i + 2, 1).value = p.code; ws.getCell(i + 2, 2).value = p.name; });
  accounts.forEach((a, i) => { ws.getCell(i + 2, 4).value = a.name; });
  categories.forEach((c, i) => { ws.getCell(i + 2, 6).value = c; });
  // Rentang minimal satu sel supaya rumus dropdown tetap sah walau daftarnya kosong.
  const range = (col, n) => `${SHEET.lists}!$${col}$2:$${col}$${Math.max(n, 1) + 1}`;
  return { pos: range('A', pos.length), account: range('D', accounts.length), category: range('F', categories.length) };
}

function styleDataRow(ws, r, lists) {
  for (let c = 1; c <= COLUMNS.length; c++) {
    const cell = ws.getCell(r, c);
    cell.font = FONT;
    cell.border = BOX;
    cell.alignment = { vertical: 'middle' };
  }
  ws.getCell(r, COL_INDEX.date).numFmt = FMT_DATE;
  for (const k of ['masuk', 'keluar', 'saldo_bank']) ws.getCell(r, COL_INDEX[k]).numFmt = FMT_AMOUNT;
  ws.getCell(r, COL_INDEX.masuk).fill = FILL_MASUK;
  ws.getCell(r, COL_INDEX.keluar).fill = FILL_KELUAR;
  for (const k of ['receipt_no', 'piao_wen']) ws.getCell(r, COL_INDEX[k]).numFmt = '@';

  // Dropdown: Akun & Pos harus dari daftar; Kategori boleh diisi bebas (hanya saran).
  const strict = (title) => ({ showErrorMessage: true, errorStyle: 'stop', errorTitle: title, error: `Pilih ${title} dari daftar.` });
  ws.getCell(r, COL_INDEX.account).dataValidation = { type: 'list', allowBlank: true, formulae: [lists.account], ...strict('Akun') };
  ws.getCell(r, COL_INDEX.pos).dataValidation = { type: 'list', allowBlank: true, formulae: [lists.pos], ...strict('Pos') };
  ws.getCell(r, COL_INDEX.category).dataValidation = { type: 'list', allowBlank: true, formulae: [lists.category], showErrorMessage: false };
}

/**
 * Buat file Template Data.
 * @param {object} p
 * @param {string} p.orgName nama Fothang
 * @param {{code:string, name:string}[]} p.pos pos aktif, urut nomor
 * @param {{name:string}[]} p.accounts
 * @param {string[]} p.categories kategori yang sudah dipakai (saran dropdown)
 * @param {object[]} [p.rows] transaksi (rupiah): { date, account, pos, category, name, masuk, keluar, saldo_bank, receipt_no, piao_wen, note }
 * @param {object} [p.openings] isi sheet Saldo Awal (rupiah); tanpa ini sheet tidak dibuat:
 *   { startDate, accounts: [{name}], rows: [{code, name, values: [per akun]}], accountOpenings: [per akun] }
 * @returns {Promise<Buffer>}
 */
async function buildTemplateWorkbook({ orgName, pos, accounts, categories, rows = [], openings = null }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistem Keuangan Guang Ji';
  writeGuide(wb, orgName);
  const ws = wb.addWorksheet(SHEET.data, { views: [{ state: 'frozen', ySplit: 1, zoomScale: 90 }] });
  if (openings) writeOpenings(wb, openings);
  const lists = writeLists(wb, { pos, accounts, categories });
  wb.views = [{ activeTab: 1 }]; // buka langsung di sheet Transaksi

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  COLUMNS.forEach((c, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = c.title;
    cell.font = { ...FONT, bold: true };
    cell.fill = FILL_HEADER;
    cell.border = BOX;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.getRow(1).height = 22;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  rows.forEach((t, i) => {
    const r = i + 2;
    const values = { ...t, date: t.date ? excelDate(t.date) : null };
    for (const c of COLUMNS) {
      const v = values[c.key];
      if (v !== '' && v != null && v !== 0) ws.getCell(r, COL_INDEX[c.key]).value = v;
    }
  });
  for (let r = 2; r <= rows.length + EMPTY_ROWS + 1; r++) styleDataRow(ws, r, lists);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- Membaca template

function cellValue(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result ?? null;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text != null) return v.text;
  }
  return v;
}
const cellText = (cell) => clean(cellValue(cell) ?? '');
const pad2 = (n) => String(n).padStart(2, '0');

/** Tanggal: sel tanggal Excel, teks "13/10/2026", atau "2026-10-13". Hasil "YYYY-MM-DD", atau null bila tidak sah. */
function parseDate(value) {
  let y; let m; let d;
  if (value instanceof Date) [y, m, d] = [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()];
  else {
    const text = clean(value);
    const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (dmy) [d, m, y] = dmy.slice(1).map(Number);
    else if (ymd) [y, m, d] = ymd.slice(1).map(Number);
    else return null;
  }
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Nominal: angka Excel, atau teks gaya Indonesia ("1.250.000", "1.250.000,50", "Rp 50.000").
 * Kosong -> 0; tidak bisa dibaca -> NaN.
 */
function parseAmount(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let text = clean(value).replace(/^rp\.?\s*/i, '').replace(/\s/g, '');
  if (!text || text === '-') return 0;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text) || /^-?\d+,\d+$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

/** Cari baris judul (yang memuat "Tanggal") di 10 baris pertama; hasil { row, cols: {key: kolom} } atau null. */
function findHeader(ws) {
  for (let r = 1; r <= 10; r++) {
    const cols = {};
    for (let c = 1; c <= Math.max(ws.columnCount, COLUMNS.length); c++) {
      const title = upper(cellText(ws.getCell(r, c)));
      const col = COLUMNS.find((x) => upper(x.title) === title || (x.aliases || []).includes(title));
      if (col && !(col.key in cols)) cols[col.key] = c;
    }
    if (cols.date && cols.pos && (cols.masuk || cols.keluar)) return { row: r, cols };
  }
  return null;
}

/** Sheet Transaksi dari workbook template, atau null bila workbook ini bukan template. */
function findTemplateSheet(wb) {
  const named = wb.getWorksheet(SHEET.data);
  if (named && findHeader(named)) return named;
  return wb.worksheets.find((ws) => findHeader(ws)) || null;
}

/**
 * Baca sheet Transaksi. Baris kosong dilewati; baris yang salah tidak dibuang diam-diam tetapi
 * dicatat di `errors` (pemanggil yang memutuskan: tampilkan & tolak impor).
 * @returns {{ rows: object[], errors: {row:number, message:string}[] }}
 *   rows: { row, date, account, pos, category, name, masuk, keluar, saldo_bank, receipt_no, piao_wen, note } (rupiah)
 */
function parseTemplateSheet(ws) {
  const header = findHeader(ws);
  if (!header) throw new Error(`Sheet "${ws.name}" bukan Template Data (judul kolom Tanggal, Pos, Masuk/Keluar tidak ditemukan)`);
  const { cols } = header;
  const get = (row, key) => (cols[key] ? cellValue(row.getCell(cols[key])) : null);
  const text = (row, key) => clean(get(row, key) ?? '');

  const rows = [];
  const errors = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    if (r <= header.row) return;
    const filled = Object.keys(cols).some((k) => text(row, k) !== '');
    if (!filled) return; // baris bergaya/berdropdown tetapi kosong

    const problems = [];
    const date = parseDate(get(row, 'date'));
    if (!date) problems.push(text(row, 'date') ? `tanggal "${text(row, 'date')}" tidak dikenali` : 'tanggal kosong');
    const masuk = parseAmount(get(row, 'masuk'));
    const keluar = parseAmount(get(row, 'keluar'));
    const saldoBank = cols.saldo_bank ? parseAmount(get(row, 'saldo_bank')) : 0;
    if (Number.isNaN(masuk)) problems.push('Masuk bukan angka');
    if (Number.isNaN(keluar)) problems.push('Keluar bukan angka');
    if (Number.isNaN(saldoBank)) problems.push('Saldo Bank bukan angka');
    if (masuk < 0 || keluar < 0) problems.push('nominal tidak boleh minus (pakai kolom Keluar)');
    if (masuk > 0 && keluar > 0) problems.push('Masuk dan Keluar terisi dua-duanya');
    if (!(masuk > 0) && !(keluar > 0) && !Number.isNaN(masuk) && !Number.isNaN(keluar)) problems.push('nominal Masuk/Keluar kosong');
    if (problems.length) { errors.push({ row: r, message: problems.join('; ') }); return; }

    const saldoText = text(row, 'saldo_bank');
    rows.push({
      row: r,
      date,
      account: text(row, 'account'),
      pos: text(row, 'pos'),
      category: upper(text(row, 'category')),
      name: text(row, 'name'),
      masuk: Math.round(masuk * 100) / 100,
      keluar: Math.round(keluar * 100) / 100,
      saldo_bank: saldoText === '' ? null : Math.round(saldoBank * 100) / 100,
      receipt_no: text(row, 'receipt_no'),
      piao_wen: text(row, 'piao_wen'),
      note: text(row, 'note'),
    });
  });
  return { rows, errors };
}

/**
 * Baca sheet Saldo Awal (bila ada). Sel kosong = 0; minus boleh (pos yang nombok).
 * @returns {null | { accounts: string[], rows: {row, pos, values: number[]}[], account_openings: number[]|null, errors: {row, message}[] }}
 */
function parseOpeningsSheet(wb) {
  const ws = wb.getWorksheet(SHEET.openings);
  if (!ws) return null;
  let headerRow = null;
  for (let r = 1; r <= 10 && !headerRow; r++) if (upper(cellText(ws.getCell(r, 1))) === upper(OPENING_LABEL.header)) headerRow = r;
  if (!headerRow) {
    return { accounts: [], rows: [], account_openings: null, errors: [{ row: 1, message: `judul kolom "${OPENING_LABEL.header}" tidak ditemukan` }] };
  }

  const accounts = [];
  for (let c = 3; cellText(ws.getCell(headerRow, c)); c++) accounts.push(cellText(ws.getCell(headerRow, c)));
  const errors = [];
  const valuesOf = (r) => accounts.map((name, j) => {
    const v = parseAmount(cellValue(ws.getCell(r, 3 + j)));
    if (Number.isNaN(v)) { errors.push({ row: r, message: `saldo awal ${name} bukan angka` }); return 0; }
    return Math.round(v * 100) / 100;
  });

  const rows = [];
  let accountOpenings = null;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const label = cellText(ws.getCell(r, 1));
    const key = upper(label);
    if (!key || key === OPENING_LABEL.total || key === OPENING_LABEL.diff) continue;
    if (key === OPENING_LABEL.account) accountOpenings = valuesOf(r);
    else rows.push({ row: r, pos: label, values: valuesOf(r) });
  }
  return { accounts, rows, account_openings: accountOpenings, errors };
}

module.exports = {
  buildTemplateWorkbook, parseTemplateSheet, findTemplateSheet, parseOpeningsSheet, parseDate, parseAmount, COLUMNS, SHEET,
};
