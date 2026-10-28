// Membaca file rekening koran BCA (.xlsx), format seperti "Mutasi Kuang Hang Januari 2026.xlsx":
//   A: tanggal "dd/mm"   B: jenis transaksi (+ baris-baris keterangan bank di bawahnya)
//   C: kode alokasi       D: nominal "200,000.00 CR/DB"   E: saldo
// Hasilnya baris mentah; klasifikasi ke pos dilakukan oleh classifier.js.

const ExcelJS = require('exceljs');
const { clean, upper } = require('../lib/text');
const { parseBankAmount } = require('../lib/money');
const { MONTH_NAMES, pad2 } = require('../lib/period');

const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

async function readWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/** Tebak tahun & bulan dari nama sheet ("Jan 26") atau nama file ("... Januari 2026.xlsx"). */
function guessPeriod(fileName, sheetName) {
  const text = `${sheetName} ${fileName}`.toLowerCase();
  const fullYear = text.match(/20\d{2}/);
  const shortYear = String(sheetName).match(/(\d{2})\s*$/);
  const year = fullYear ? Number(fullYear[0]) : shortYear ? 2000 + Number(shortYear[1]) : null;

  let month = MONTH_NAMES.findIndex((m) => text.includes(m.toLowerCase())) + 1;
  if (!month) month = SHORT_MONTHS.findIndex((m) => new RegExp(`\\b${m}`).test(text)) + 1;
  return { year, month: month || null };
}

function listSheets(workbook, fileName) {
  return workbook.worksheets
    .filter((ws) => ws.actualRowCount > 0)
    .map((ws) => ({ name: ws.name, ...guessPeriod(fileName, ws.name) }));
}

/** Teks dari sel ExcelJS (bisa berupa rich text, rumus, atau tanggal). */
function cellText(cell) {
  // Sel hasil merge (mis. A1:A3) hanya dibaca di sel utamanya agar satu transaksi tidak terbaca berulang.
  if (cell.isMerged && cell.master.address !== cell.address) return '';
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return `${pad2(v.getUTCDate())}/${pad2(v.getUTCMonth() + 1)}`;
  if (typeof v === 'object') {
    if (v.richText) return clean(v.richText.map((t) => t.text).join(''));
    if (v.text != null) return clean(v.text);
    if (v.result != null) return clean(v.result);
  }
  return clean(v);
}

/** Kunci unik satu baris mutasi, dipakai untuk mencegah impor ganda. */
const dedupeKey = (r) => `${r.date}|${r.amount_cents}|${r.balance_cents ?? ''}|${upper(r.bank_code)}`;

/**
 * @returns {{seq, date, bank_type, bank_code, bank_desc, amount_cents, balance_cents, dedupe_key}[]}
 */
function parseSheet(worksheet, year) {
  const rows = [];
  let current = null;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const [date, type, code, amount, balance] = [1, 2, 3, 4, 5].map((i) => cellText(row.getCell(i)));
    const dayMonth = date.match(/^(\d{1,2})\/(\d{1,2})/);
    const cents = amount ? parseBankAmount(amount) : null;

    if (dayMonth && cents) {
      current = {
        seq: rows.length + 1,
        date: `${year}-${pad2(dayMonth[2])}-${pad2(dayMonth[1])}`,
        bank_type: type,
        bank_code: code,
        bank_desc: '',
        amount_cents: cents,
        balance_cents: parseBankAmount(balance),
      };
      rows.push(current);
    } else if (current && type && !date) {
      // Baris lanjutan: keterangan tambahan dari bank untuk transaksi di atasnya.
      current.bank_desc = current.bank_desc ? `${current.bank_desc} | ${type}` : type;
    }
  });
  for (const r of rows) r.dedupe_key = dedupeKey(r);
  return rows;
}

module.exports = { readWorkbook, listSheets, parseSheet, guessPeriod, dedupeKey };
