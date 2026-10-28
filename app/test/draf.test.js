// Uji format file DRAF: ekspor, impor (tata letak baru & lama), dan penggantian data per bulan.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createTestContext, makeMutasiFile } = require('./helpers');
const { parseDrafSheet, parseMonthTitle } = require('../src/services/drafFormat');

const MUTASI = [
  ['02/01', 'TRSF E-BANKING CR', 'CU THAN ; SAHABAT SEJATI', '300.00 CR', '1,300.00'],
  ['05/01', 'TRSF E-BANKING DB', 'CU THAN ; IURAN MABGI', '200.00 DB', '1,100.00'],
  ['06/01', 'TRSF E-BANKING CR', 'CU THAN ; PELITA ; IRENE', '50.00 CR', '1,150.00'],
];

async function contextWithJanuary() {
  const t = createTestContext();
  const up = await t.ctx.services.imports.upload(t.fothangId, await makeMutasiFile(MUTASI), 'Mutasi Januari 2026.xlsx');
  t.ctx.services.imports.commit(t.fothangId, { token: up.token, sheet: 'Jan 26', year: 2026, account_id: t.bcaId });
  return t;
}

const rowsOf = (t) => t.ctx.repos.transaction.list({ fothangId: t.fothangId, accountId: t.bcaId })
  .map((r) => [r.date, r.amount_cents, r.pos_id, r.category, r.name]);

async function importDraf(t, buffer, months) {
  const up = await t.ctx.services.imports.upload(t.fothangId, buffer, 'DRAF.xlsx');
  const request = { token: up.token, sheet: up.sheets[0].name, account_id: t.bcaId };
  const preview = t.ctx.services.imports.previewDraf(t.fothangId, request);
  const result = t.ctx.services.imports.commitDraf(t.fothangId, { ...request, months: months ?? preview.months.map((m) => m.month) });
  return { preview, result };
}

test('judul bulan campuran Indonesia/Inggris dikenali', () => {
  assert.deepEqual(parseMonthTitle('JANUARI 2026'), { month: 1, year: 2026 });
  assert.deepEqual(parseMonthTitle('MARCH 2026'), { month: 3, year: 2026 });
  assert.deepEqual(parseMonthTitle('AUG 2026'), { month: 8, year: 2026 });
  assert.equal(parseMonthTitle('SALDO AWAL'), null);
});

test('ekspor DRAF bertata letak file manual', async () => {
  const t = await contextWithJanuary();
  const buffer = await t.ctx.services.excel.draftWorkbook(t.fothangId, t.bcaId, 2026, 1);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('January');
  assert.equal(ws.getCell('A1').value, 'UJI FO THANG');
  assert.deepEqual(['A3', 'B3', 'C3', 'H3', 'I3', 'J3'].map((a) => ws.getCell(a).value), ['Tgl', 'Pos', 'Keterangan', 'Masuk', 'Keluar', 'Saldo']);
  assert.equal(ws.getCell('D5').value, 'SALDO AWAL');
  assert.equal(ws.getCell('J5').value, 1000);
  assert.equal(ws.getCell('A6').value, null, 'baris kosong di awal bulan, tanpa judul bulan');
  assert.deepEqual(ws.getCell('A7').value, new Date(Date.UTC(2026, 0, 2)));
  assert.equal(ws.getCell('A7').numFmt, 'd/m/yyyy');
  assert.deepEqual([ws.getCell('B7').value, ws.getCell('C7').value, ws.getCell('H7').value], ['CU THAN', 'SAHABAT SEJATI', 300]);
  assert.equal(ws.getCell('C9').value, 'PELITA ; IRENE');
  assert.deepEqual(ws.getCell('J9').value, { formula: 'J8+H9-I9', result: 1150 });
  assert.equal(ws.getCell('H7').fill.fgColor.argb, 'FFFFCC99');
  assert.equal(ws.getCell('I8').fill.fgColor.argb, 'FFCCFFCC');
});

test('impor DRAF mengganti data bulan itu (tidak dobel) dan hasilnya identik bolak-balik', async () => {
  const t = await contextWithJanuary();
  const before = rowsOf(t);
  const buffer = await t.ctx.services.excel.draftWorkbook(t.fothangId, t.bcaId, 2026, 1);

  const { preview, result } = await importDraf(t, buffer);
  assert.equal(preview.layout, 'pos');
  assert.equal(preview.opening_file, 1000);
  assert.deepEqual(preview.months[0].existing, { mutasi: 3 });
  assert.deepEqual(result, { added: 3, replaced: 3, months: [1] });
  assert.deepEqual(rowsOf(t), before);
  assert.ok(t.ctx.repos.transaction.list({ fothangId: t.fothangId }).every((r) => r.source === 'draf'));
});

test('impor DRAF tata letak lama (kolom NAMA gabungan) dan baris tanpa tanggal', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sep');
  ws.getCell('A1').value = 'UJI FO THANG';
  ws.getCell('A2').value = 'DRAFT Laporan Keuangan CU THAN 2026';
  ws.getCell('A3').value = 'Tgl';
  ws.getCell('B3').value = 'NAMA';
  ws.getCell('D5').value = 'SALDO AWAL';
  ws.getCell('J5').value = 1000;
  ws.getCell('A6').value = 'MARCH 2026';
  ws.addRow([31, 'CU THAN ; BUNGA BANK', null, null, null, null, null, 87.5, null]);
  ws.addRow([null, 'CU THAN ; PAJAK BUNGA', null, null, null, null, null, null, 17.5]);
  ws.addRow([null, 'KFCC ; SHERLY THE', null, null, null, null, null, 500, null]);

  const parsed = parseDrafSheet(ws);
  assert.equal(parsed.layout, 'gabung');
  assert.deepEqual(parsed.rows.map((r) => [r.date, r.day_assumed]), [['2026-03-31', false], ['2026-03-31', true], ['2026-03-31', true]]);

  const t = createTestContext();
  const { result } = await importDraf(t, Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(result.added, 3);
  const rows = t.ctx.services.transaction.list(t.fothangId, { year: 2026, month: 3 });
  assert.deepEqual(rows.map((r) => [r.pos, r.category, r.masuk || -r.keluar]),
    [['CU THAN', 'BUNGA BANK', 87.5], ['CU THAN', 'PAJAK BUNGA', -17.5], ['KFCC', 'DONATUR', 500]]);
});

test('impor DRAF: tanggal berupa teks "1/2/2026" juga dibaca', () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('February');
  ws.getCell('A2').value = 'DRAFT Laporan Keuangan CU THAN 2026';
  ws.getCell('A3').value = 'Tgl';
  ws.getCell('B3').value = 'Pos';
  ws.addRow([]);
  ws.addRow(['1/2/2026', 'CU THAN', 'YU JUN PENG', null, null, null, null, 150000, null]);
  ws.addRow([null, 'CU THAN', 'BIAYA ADM', null, null, null, null, null, 30000]);
  const parsed = parseDrafSheet(ws);
  assert.equal(parsed.layout, 'pos');
  assert.deepEqual(parsed.rows.map((r) => [r.date, r.day_assumed, r.code]),
    [['2026-02-01', false, 'CU THAN ; YU JUN PENG'], ['2026-02-01', true, 'CU THAN ; BIAYA ADM']]);
});

test('impor DRAF hanya bulan yang dipilih', async () => {
  const t = await contextWithJanuary();
  const buffer = await t.ctx.services.excel.draftWorkbook(t.fothangId, t.bcaId, 2026, 1);
  const up = await t.ctx.services.imports.upload(t.fothangId, buffer, 'DRAF.xlsx');
  assert.throws(() => t.ctx.services.imports.commitDraf(t.fothangId, { token: up.token, sheet: 'January', account_id: t.bcaId, months: [] }), /minimal satu bulan/);
});

test('ekspor DRAF: satu sheet bulan terakhir yang berisi data, apa pun bulan yang sedang dibuka', async () => {
  const baseConfig = require('../src/config');
  const { createServer } = require('../src/http/app');
  const t = createTestContext();
  const server = createServer(t.ctx, { ...baseConfig, host: '127.0.0.1', auth: { ...baseConfig.auth, loginRequired: false } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/fothang/${t.fothangId}/export/draf.xlsx?account_id=${t.bcaId}&year=2026&month=10`;
  const sheetNames = async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await (await fetch(url)).arrayBuffer()));
    return wb.worksheets.map((w) => w.name);
  };
  try {
    t.ctx.services.transaction.create(t.fothangId, { date: '2026-01-05', account_id: t.bcaId, pos_id: t.cuThanId, name: 'A', masuk: 10 });
    assert.deepEqual(await sheetNames(), ['January']);
    t.ctx.services.transaction.create(t.fothangId, { date: '2026-02-03', account_id: t.bcaId, pos_id: t.cuThanId, name: 'B', masuk: 20 });
    assert.deepEqual(await sheetNames(), ['February']);
  } finally {
    server.close();
  }
});

test('header DRAF: Pos dan Keterangan masing-masing dua baris', async () => {
  const t = await contextWithJanuary();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await t.ctx.services.excel.draftWorkbook(t.fothangId, t.bcaId, 2026, 1));
  const merges = wb.worksheets[0].model.merges;
  for (const range of ['A3:A4', 'B3:B4', 'C3:D4', 'E3:E4', 'F3:F4', 'G3:G4']) assert.ok(merges.includes(range), range);
});
