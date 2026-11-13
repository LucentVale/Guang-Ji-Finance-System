// Uji format Template Data (bentuk data seragam untuk semua vihara): membuat, membaca, dan bolak-balik.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  buildTemplateWorkbook, parseTemplateSheet, findTemplateSheet, parseDate, parseAmount, COLUMNS, SHEET,
} = require('../src/services/templateFormat');

const SETUP = {
  orgName: 'Uji Fo Thang',
  pos: [{ code: 'CU THAN', name: 'Cu Than' }, { code: 'KFCC', name: 'Khai Fang Ci Cing' }],
  accounts: [{ name: 'BCA' }, { name: 'Kas Kecil' }],
  categories: ['DONATUR', 'PELITA', 'LISTRIK'],
};

const ROWS = [
  { date: '2026-10-01', account: 'BCA', pos: 'CU THAN', category: 'DONATUR', name: 'SAHABAT SEJATI', masuk: 300000, keluar: 0, saldo_bank: 1300000.25, receipt_no: '0012', piao_wen: '', note: '' },
  { date: '2026-10-15', account: 'BCA', pos: 'CU THAN', category: 'LISTRIK', name: 'BAYAR LISTRIK', masuk: 0, keluar: 1525511.5, saldo_bank: null, receipt_no: '', piao_wen: 'A1', note: 'meteran baru' },
  { date: '2026-10-20', account: 'Kas Kecil', pos: 'KFCC', category: '', name: 'IRENE', masuk: 50000, keluar: 0, saldo_bank: null, receipt_no: '', piao_wen: '', note: '' },
];

async function load(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

/** Workbook berisi satu sheet dengan judul kolom & baris yang diberikan (meniru file buatan vihara lain). */
function sheetWith(header, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return ws;
}

test('template kosong: tiga sheet, judul kolom lengkap, daftar pilihan, dropdown', async () => {
  const wb = await load(await buildTemplateWorkbook(SETUP));
  assert.deepEqual(wb.worksheets.map((ws) => ws.name), [SHEET.guide, SHEET.data, SHEET.lists]);

  const ws = wb.getWorksheet(SHEET.data);
  assert.deepEqual(COLUMNS.map((_, i) => ws.getCell(1, i + 1).value), COLUMNS.map((c) => c.title));
  assert.equal(ws.getCell('A1').value, 'Tanggal');

  const lists = wb.getWorksheet(SHEET.lists);
  assert.deepEqual([lists.getCell('A2').value, lists.getCell('B2').value, lists.getCell('A3').value], ['CU THAN', 'Cu Than', 'KFCC']);
  assert.deepEqual([lists.getCell('D2').value, lists.getCell('D3').value], ['BCA', 'Kas Kecil']);
  assert.equal(lists.getCell('F4').value, 'LISTRIK');

  assert.deepEqual(ws.getCell('C2').dataValidation.formulae, ['Daftar!$A$2:$A$3']);
  assert.deepEqual(ws.getCell('B2').dataValidation.formulae, ['Daftar!$D$2:$D$3']);
  assert.equal(findTemplateSheet(wb).name, SHEET.data);
  assert.deepEqual(parseTemplateSheet(ws), { rows: [], errors: [] }, 'baris kosong berdropdown tidak dianggap data');
});

test('bolak-balik: data yang diekspor terbaca kembali sama persis', async () => {
  const wb = await load(await buildTemplateWorkbook({ ...SETUP, rows: ROWS }));
  const ws = wb.getWorksheet(SHEET.data);
  assert.deepEqual(ws.getCell('A2').value, new Date(Date.UTC(2026, 9, 1)));
  assert.equal(ws.getCell('G2').value, null, 'Keluar 0 ditulis kosong');

  const { rows, errors } = parseTemplateSheet(ws);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map(({ row: _row, ...rest }) => rest), ROWS);
  assert.deepEqual(rows.map((r) => r.row), [2, 3, 4]);
});

test('file vihara lain: urutan kolom berbeda, kolom opsional tidak ada, tanggal & nominal berupa teks', () => {
  const ws = sheetWith(
    ['Pos', 'Keterangan', 'Tanggal', 'Keluar', 'Masuk'],
    [
      ['CU THAN', 'Lina', '5/1/2026', '', '1.250.000'],
      ['CU THAN', 'Air PAM', '2026-01-07', 'Rp 8.569,50', null],
    ],
  );
  const { rows, errors } = parseTemplateSheet(ws);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => [r.date, r.pos, r.name, r.masuk, r.keluar, r.account, r.saldo_bank]), [
    ['2026-01-05', 'CU THAN', 'Lina', 1250000, 0, '', null],
    ['2026-01-07', 'CU THAN', 'Air PAM', 0, 8569.5, '', null],
  ]);
});

test('baris salah dilaporkan dengan nomor barisnya, bukan dibuang diam-diam', () => {
  const ws = sheetWith(
    ['Tanggal', 'Pos', 'Nama / Uraian', 'Masuk', 'Keluar'],
    [
      ['31/2/2026', 'CU THAN', 'tanggal mustahil', 100, null],
      ['', 'CU THAN', 'tanpa tanggal', 100, null],
      ['1/3/2026', 'CU THAN', 'dua-duanya', 100, 50],
      ['1/3/2026', 'CU THAN', 'tanpa nominal', null, null],
      ['1/3/2026', 'CU THAN', 'minus', -100, null],
      ['1/3/2026', 'CU THAN', 'huruf', 'seratus', null],
      ['2/3/2026', 'CU THAN', 'benar', 100, null],
    ],
  );
  const { rows, errors } = parseTemplateSheet(ws);
  assert.deepEqual(rows.map((r) => r.name), ['benar']);
  assert.deepEqual(errors.map((e) => e.row), [2, 3, 4, 5, 6, 7]);
  assert.match(errors[0].message, /tanggal "31\/2\/2026" tidak dikenali/);
  assert.match(errors[1].message, /tanggal kosong/);
  assert.match(errors[2].message, /dua-duanya/);
  assert.match(errors[3].message, /kosong/);
  assert.match(errors[4].message, /minus/);
  assert.match(errors[5].message, /Masuk bukan angka/);
});

test('sheet tanpa judul kolom Tanggal/Pos/Masuk bukan template', () => {
  const ws = sheetWith(['Tgl', 'Pos', 'Keterangan'], [['1/1/2026', 'CU THAN', 'x']]);
  assert.throws(() => parseTemplateSheet(ws), /bukan Template Data/);
  assert.equal(findTemplateSheet(ws.workbook), null);
});

test('pembaca tanggal & nominal', () => {
  assert.equal(parseDate('13/10/2026'), '2026-10-13');
  assert.equal(parseDate('13-10-2026'), '2026-10-13');
  assert.equal(parseDate(new Date(Date.UTC(2026, 1, 28))), '2026-02-28');
  assert.equal(parseDate('29/2/2026'), null);
  assert.equal(parseDate('13/10'), null);

  assert.equal(parseAmount(1500.5), 1500.5);
  assert.equal(parseAmount('1.250.000'), 1250000);
  assert.equal(parseAmount('1.250.000,75'), 1250000.75);
  assert.equal(parseAmount('Rp 50.000'), 50000);
  assert.equal(parseAmount('1,250,000.75'), 1250000.75);
  assert.equal(parseAmount('2500'), 2500);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount(null), 0);
  assert.ok(Number.isNaN(parseAmount('abc')));
});

// ---------------------------------------------------------------- Ekspor dari data aplikasi

const { createTestContext, makeMutasiFile } = require('./helpers');

const MUTASI = [
  ['02/01', 'TRSF E-BANKING CR', 'CU THAN ; SAHABAT SEJATI', '300.00 CR', '1,300.00'],
  ['05/01', 'TRSF E-BANKING DB', 'CU THAN ; IURAN MABGI', '200.00 DB', '1,100.00'],
];

async function contextWithJanuary() {
  const t = createTestContext();
  const up = await t.ctx.services.imports.upload(t.fothangId, await makeMutasiFile(MUTASI), 'Mutasi Januari 2026.xlsx');
  t.ctx.services.imports.commit(t.fothangId, { token: up.token, sheet: 'Jan 26', year: 2026, account_id: t.bcaId });
  return t;
}

async function exported(t, options) {
  const wb = await load(await t.ctx.services.excel.templateWorkbook(t.fothangId, { year: 2026, ...options }));
  return { wb, ...parseTemplateSheet(wb.getWorksheet(SHEET.data)) };
}

test('ekspor template berisi data: pindahan tidak ikut, saldo bank baris pecahan di pecahan terakhir', async () => {
  const t = await contextWithJanuary();
  const tx = t.ctx.services.transaction;
  const donasi = t.ctx.repos.transaction.list({ fothangId: t.fothangId }).find((r) => r.amount_cents > 0);
  tx.split(t.fothangId, donasi.id, { amount: 100, pos_id: t.kfccId, category: 'DONATUR', name: 'SAHABAT SEJATI' });
  tx.transfer(t.fothangId, { date: '2026-01-10', account_id: t.bcaId, from_pos_id: t.cuThanId, to_pos_id: t.kfccId, amount: 50 });

  const { rows, errors, wb } = await exported(t, {});
  assert.deepEqual(errors, []);
  assert.deepEqual(rows.map((r) => [r.date, r.account, r.pos, r.category, r.name, r.masuk, r.keluar, r.saldo_bank]), [
    ['2026-01-02', 'BCA', 'CU THAN', 'DONATUR', 'SAHABAT SEJATI', 200, 0, null],
    ['2026-01-02', 'BCA', 'KFCC', 'DONATUR', 'SAHABAT SEJATI', 100, 0, 1300],
    ['2026-01-05', 'BCA', 'CU THAN', '', 'IURAN MABGI', 0, 200, 1100],
  ]);
  const lists = wb.getWorksheet(SHEET.lists);
  assert.deepEqual([lists.getCell('A2').value, lists.getCell('A3').value, lists.getCell('D2').value], ['CU THAN', 'KFCC', 'BCA']);
  const categories = [];
  for (let r = 2; lists.getCell(r, 6).value; r++) categories.push(lists.getCell(r, 6).value);
  assert.ok(categories.includes('DONATUR'));
  assert.ok(!categories.some((c) => c.startsWith('PINDAHAN')), 'kategori pindahan tidak ditawarkan');
});

test('ekspor template: kosong, per bulan, dan akun milik Fothang lain ditolak', async () => {
  const t = await contextWithJanuary();
  assert.equal((await exported(t, { empty: true })).rows.length, 0);
  assert.equal((await exported(t, { month: 1 })).rows.length, 2);
  assert.equal((await exported(t, { month: 2 })).rows.length, 0);
  assert.equal((await exported(t, { accountId: t.bcaId })).rows.length, 2);
  await assert.rejects(t.ctx.services.excel.templateWorkbook(t.fothangId, { year: 2026, accountId: 999 }), /Akun tidak ditemukan/);
});
