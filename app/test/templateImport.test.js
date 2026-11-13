// Uji impor Template Data: bolak-balik dengan ekspor, file buatan vihara lain, baris salah, dan Cek Saldo.
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createTestContext, makeMutasiFile } = require('./helpers');

const MUTASI = [
  ['02/01', 'TRSF E-BANKING CR', 'CU THAN ; SAHABAT SEJATI', '300.00 CR', '1,300.00'],
  ['05/01', 'TRSF E-BANKING DB', 'CU THAN ; IURAN MABGI', '200.00 DB', '1,100.00'],
  ['03/02', 'TRSF E-BANKING CR', 'KFCC ; IRENE', '50.00 CR', '1,150.00'],
];

async function contextWithMutasi() {
  const t = createTestContext();
  const up = await t.ctx.services.imports.upload(t.fothangId, await makeMutasiFile(MUTASI), 'Mutasi Januari 2026.xlsx');
  t.ctx.services.imports.commit(t.fothangId, { token: up.token, sheet: 'Jan 26', year: 2026, account_id: t.bcaId });
  return t;
}

/** File .xlsx satu sheet: baris judul lalu baris data (meniru template yang diisi vihara lain). */
async function makeFile(header, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Transaksi');
  ws.addRow(header);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function previewOf(t, buffer) {
  const up = await t.ctx.services.imports.upload(t.fothangId, buffer, 'Template.xlsx');
  return { token: up.token, preview: t.ctx.services.imports.previewTemplate(t.fothangId, { token: up.token }) };
}

const rowsOf = (t) => t.ctx.repos.transaction.list({ fothangId: t.fothangId })
  .filter((r) => r.source !== 'pindahan')
  .map((r) => [r.date, r.amount_cents, r.pos_id, r.category, r.name]);
const checksOf = (t, month) => t.ctx.services.reconciliation.month(t.fothangId, 2026, month).checks.map((c) => [c.label, c.ok]);

test('bolak-balik: ekspor template lalu impor menghasilkan data & Cek Saldo yang sama', async () => {
  const t = await contextWithMutasi();
  const donasi = t.ctx.repos.transaction.list({ fothangId: t.fothangId }).find((r) => r.amount_cents === 30000);
  t.ctx.services.transaction.split(t.fothangId, donasi.id, { amount: 100, pos_id: t.kfccId, category: 'DONATUR', name: 'SAHABAT SEJATI' });
  t.ctx.services.transaction.transfer(t.fothangId, { date: '2026-01-10', account_id: t.bcaId, from_pos_id: t.cuThanId, to_pos_id: t.kfccId, amount: 50 });
  const before = rowsOf(t);
  const checksBefore = [checksOf(t, 1), checksOf(t, 2)];
  const snapshot = t.ctx.services.balance.snapshot(t.fothangId, '2026-03-01');

  const buffer = await t.ctx.services.excel.templateWorkbook(t.fothangId, { year: 2026 });
  const { token, preview } = await previewOf(t, buffer);
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.months.map((m) => [m.key, m.count, m.masuk, m.keluar]), [['2026-01', 3, 300, 200], ['2026-02', 1, 50, 0]]);
  assert.deepEqual(preview.months[0].accounts, [{ account_id: t.bcaId, name: 'BCA', count: 3, existing: { mutasi: 3 } }]);

  const result = t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: ['2026-01', '2026-02'] });
  assert.deepEqual(result, { added: 4, replaced: 3, months: ['2026-01', '2026-02'] });
  assert.deepEqual(rowsOf(t), before);
  assert.equal(t.ctx.repos.transaction.list({ fothangId: t.fothangId, source: 'pindahan' }).length, 2, 'pindahan tetap ada');
  assert.ok(t.ctx.repos.transaction.list({ fothangId: t.fothangId }).filter((r) => r.source !== 'pindahan').every((r) => r.source === 'draf'));

  // Saldo pos tidak berubah, dan Saldo Bank dari template dipakai Cek Saldo (semua pemeriksaan tetap sama & lolos).
  const after = t.ctx.services.balance.snapshot(t.fothangId, '2026-03-01');
  for (const pos of [t.cuThanId, t.kfccId]) assert.equal(after.of(pos, t.bcaId), snapshot.of(pos, t.bcaId));
  assert.deepEqual([checksOf(t, 1), checksOf(t, 2)], checksBefore);
  assert.ok(checksOf(t, 1).every(([, ok]) => ok), JSON.stringify(checksOf(t, 1)));
  assert.equal(checksOf(t, 1).length, 5, 'pemeriksaan saldo bank ikut dijalankan');
});

test('file vihara lain: akun kosong, pos lewat nama/alias, pos tak dikenal bisa dipilih di pratinjau', async () => {
  const t = createTestContext();
  const pat = t.ctx.services.pos.create(t.fothangId, { number: 3, code: 'PAT', name: 'Phing An Ten', aliases: 'PAT WU AI LIU=Wu Ai Liu' });
  const buffer = await makeFile(['Tanggal', 'Pos', 'Keterangan', 'Masuk', 'Keluar'], [
    ['5/1/2026', 'Cu Than', 'Lina', '1.250', null],
    ['6/1/2026', 'pat wu ai liu', 'Irene', 100, null],
    ['7/1/2026', 'DANA LAIN', 'Tidak dikenal', null, 30],
    ['2/2/2026', 'KFCC', 'Februari', 10, null],
  ]);
  const { token, preview } = await previewOf(t, buffer);
  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.rows.map((r) => [r.seq, r.account, r.pos_id, r.pos_unknown, r.category, r.amount_cents]), [
    [1, 'BCA', t.cuThanId, false, '', 125000],
    [2, 'BCA', pat, false, 'WU AI LIU', 10000],
    [3, 'BCA', null, true, '', -3000],
    [4, 'BCA', t.kfccId, false, '', 1000],
  ]);

  // Hanya Januari; baris pos tak dikenal diarahkan ke KFCC lewat pratinjau.
  const result = t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: ['2026-01'], overrides: { 3: { pos_id: t.kfccId } } });
  assert.deepEqual(result, { added: 3, replaced: 0, months: ['2026-01'] });
  assert.deepEqual(rowsOf(t).map(([date, cents, pos]) => [date, cents, pos]), [
    ['2026-01-05', 125000, t.cuThanId], ['2026-01-06', 10000, pat], ['2026-01-07', -3000, t.kfccId],
  ]);
  // Tanpa Saldo Bank: pemeriksaan rekening koran tidak dijalankan (tidak ada yang bisa dicocokkan).
  assert.equal(checksOf(t, 1).length, 2);

  // Impor ulang bulan yang sama mengganti, bukan menambah.
  const again = await previewOf(t, buffer);
  assert.deepEqual(again.preview.months[0].accounts[0].existing, { draf: 3 });
  t.ctx.services.imports.commitTemplate(t.fothangId, { token: again.token, months: ['2026-01'] });
  assert.equal(rowsOf(t).length, 3);
});

test('baris salah & akun tak dikenal: tampil di pratinjau, file ditolak saat disimpan', async () => {
  const t = createTestContext();
  t.ctx.services.fothang.saveAccount(t.fothangId, { name: 'Kas Kecil', kind: 'cash' });
  const buffer = await makeFile(['Tanggal', 'Akun', 'Pos', 'Nama / Uraian', 'Masuk', 'Keluar'], [
    ['5/1/2026', 'bca', 'CU THAN', 'benar (akun huruf kecil)', 100, null],
    ['6/1/2026', '', 'CU THAN', 'akun kosong', 100, null],
    ['7/1/2026', 'MANDIRI', 'CU THAN', 'akun tak dikenal', 100, null],
    ['8/1/2026', 'BCA', 'CU THAN', 'dua-duanya', 100, 5],
  ]);
  const { token, preview } = await previewOf(t, buffer);
  assert.deepEqual(preview.rows.map((r) => r.name), ['benar (akun huruf kecil)']);
  assert.deepEqual(preview.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(preview.errors[0].message, /Akun kosong/);
  assert.match(preview.errors[1].message, /"MANDIRI" tidak ada/);
  assert.throws(() => t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: ['2026-01'] }), /3 baris yang salah \(mis\. baris 3/);
  assert.equal(rowsOf(t).length, 0, 'tidak ada yang tersimpan');
});

test('impor template: bulan harus dipilih & ada di file; file lain ditolak', async () => {
  const t = createTestContext();
  const { token } = await previewOf(t, await makeFile(['Tanggal', 'Pos', 'Masuk'], [['5/1/2026', 'CU THAN', 100]]));
  assert.throws(() => t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: [] }), /minimal satu bulan/);
  assert.throws(() => t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: ['2026-03'] }), /tidak ada di file/);

  const up = await t.ctx.services.imports.upload(t.fothangId, await makeMutasiFile(MUTASI), 'Mutasi.xlsx');
  assert.equal(up.is_template, false, 'layar impor tahu ini bukan template');
  const draf = await t.ctx.services.imports.upload(t.fothangId, await t.ctx.services.excel.draftWorkbook(t.fothangId, t.bcaId, 2026, 1), 'DRAF.xlsx');
  assert.equal(draf.is_template, false, 'file DRAF tidak salah dikenali sebagai template');
  const tpl = await t.ctx.services.imports.upload(t.fothangId, await t.ctx.services.excel.templateWorkbook(t.fothangId, { year: 2026, empty: true }), 'T.xlsx');
  assert.equal(tpl.is_template, true);
  assert.throws(() => t.ctx.services.imports.previewTemplate(t.fothangId, { token: up.token }), /bukan Template Data/);
});

// ---------------------------------------------------------------- Sheet Saldo Awal

/** Ekspor template kosong, lalu ubah sheet Saldo Awal lewat `edit(ws)`; hasilnya buffer .xlsx. */
async function editedTemplate(t, edit) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await t.ctx.services.excel.templateWorkbook(t.fothangId, { year: 2026, empty: true }));
  edit(wb.getWorksheet('Saldo Awal'));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
/** Baris di sheet Saldo Awal yang kolom A-nya `label`. */
const rowOf = (ws, label) => { for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === label) return r; return null; };
const openingsOf = (t) => t.ctx.services.pos.list(t.fothangId).map((p) => [p.code, p.openings[t.bcaId]]);

test('sheet Saldo Awal: terekspor apa adanya, dan tanpa perubahan tidak ada yang diganti', async () => {
  const t = createTestContext();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await t.ctx.services.excel.templateWorkbook(t.fothangId, { year: 2026, empty: true }));
  const ws = wb.getWorksheet('Saldo Awal');
  assert.equal(ws.getCell('A1').value, 'Saldo Awal per 01/01/2026');
  assert.deepEqual([ws.getCell('A4').value, ws.getCell('B4').value, ws.getCell('C4').value], ['Kode Pos', 'Nama Pos', 'BCA']);
  assert.deepEqual([5, 6].map((r) => [ws.getCell(r, 1).value, ws.getCell(r, 3).value]), [['CU THAN', 600], ['KFCC', 400]]);
  assert.equal(ws.getCell(rowOf(ws, 'TOTAL POS'), 3).value.formula, 'SUM(C5:C6)');
  assert.equal(ws.getCell(rowOf(ws, 'SALDO AWAL AKUN'), 3).value, 1000);
  assert.equal(ws.getCell(rowOf(ws, 'SELISIH'), 3).value.formula, 'C7-C8');

  const { token, preview } = await previewOf(t, await editedTemplate(t, () => {}));
  assert.deepEqual(preview.openings.changes, []);
  assert.deepEqual(preview.openings.account_changes, []);
  assert.deepEqual(preview.openings.totals, [{ account_id: t.bcaId, account: 'BCA', pos_total: 1000, account_opening: 1000, diff: 0 }]);
  assert.throws(() => t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: [] }), /minimal satu bulan/);
});

test('sheet Saldo Awal: perubahan tampil di pratinjau dan hanya diterapkan bila dicentang', async () => {
  const t = createTestContext();
  const buffer = await editedTemplate(t, (ws) => {
    ws.getCell(5, 3).value = 700;         // CU THAN
    ws.getCell(6, 3).value = '250';       // KFCC, ditulis sebagai teks
    ws.getCell(rowOf(ws, 'SALDO AWAL AKUN'), 3).value = 900;
  });
  const { token, preview } = await previewOf(t, buffer);
  assert.deepEqual(preview.openings.errors, []);
  assert.deepEqual(preview.openings.changes.map((c) => [c.pos, c.account, c.before, c.after]), [['CU THAN', 'BCA', 600, 700], ['KFCC', 'BCA', 400, 250]]);
  assert.deepEqual(preview.openings.account_changes.map((c) => [c.account, c.before, c.after]), [['BCA', 1000, 900]]);
  assert.equal(preview.openings.totals[0].diff, 50, 'selisih sesudah diterapkan dilaporkan');

  const result = t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: [], apply_openings: true });
  assert.deepEqual(result, { added: 0, replaced: 0, months: [], openings_changed: 3 });
  assert.deepEqual(openingsOf(t), [['CU THAN', 700], ['KFCC', 250]]);
  assert.equal(t.ctx.repos.account.findById(t.bcaId).opening_cents, 90000);
});

test('sheet Saldo Awal salah: diterapkan ditolak, tetapi transaksi tetap bisa diimpor tanpa saldo awal', async () => {
  const t = createTestContext();
  const buffer = await editedTemplate(t, (ws) => {
    ws.getCell(5, 3).value = 'enam ratus';
    ws.getCell(7, 1).value = 'DANA BARU';   // menimpa baris TOTAL POS: pos yang belum ada
    ws.getCell(4, 4).value = 'MANDIRI';     // kolom akun yang tidak ada
    const tx = ws.workbook.getWorksheet('Transaksi');
    tx.getCell('A2').value = '5/1/2026'; tx.getCell('C2').value = 'CU THAN'; tx.getCell('F2').value = 100;
  });
  const { token, preview } = await previewOf(t, buffer);
  assert.deepEqual(preview.errors, []);
  const messages = preview.openings.errors.map((e) => e.message).join(' | ');
  assert.match(messages, /kolom akun "MANDIRI" tidak ada/);
  assert.match(messages, /saldo awal BCA bukan angka/);
  assert.match(messages, /pos "DANA BARU" tidak ada — tambahkan dulu di Pengaturan/);
  assert.throws(() => t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: ['2026-01'], apply_openings: true }), /Sheet Saldo Awal masih salah/);
  assert.equal(rowsOf(t).length, 0, 'tidak ada yang tersimpan saat ditolak');

  const result = t.ctx.services.imports.commitTemplate(t.fothangId, { token, months: ['2026-01'] });
  assert.equal(result.added, 1);
  assert.deepEqual(openingsOf(t), [['CU THAN', 600], ['KFCC', 400]], 'saldo awal tidak berubah');
});
