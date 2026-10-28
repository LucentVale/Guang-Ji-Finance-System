// Uji alur lengkap: impor mutasi -> draf -> laporan per pos -> cek saldo -> laporan bulanan.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestContext, makeMutasiFile } = require('./helpers');

// Saldo awal bank 1.000; tiga transaksi Januari.
const MUTASI = [
  ['02/01', 'TRSF E-BANKING CR', 'CU THAN ; SAHABAT SEJATI', '300.00 CR', '1,300.00', '0201/FTSCY/WS95271 300.00', 'SANTY'],
  ['05/01', 'TRSF E-BANKING DB', 'CU THAN ; IURAN MABGI', '200.00 DB', '1,100.00'],
  ['06/01', 'TRSF E-BANKING CR', 'X', '50.00 CR', '1,150.00'],
];

async function importJanuary(t) {
  const { ctx, fothangId, bcaId } = t;
  const upload = await ctx.services.imports.upload(fothangId, await makeMutasiFile(MUTASI), 'Mutasi Uji Januari 2026.xlsx');
  const request = { token: upload.token, sheet: 'Jan 26', year: 2026, account_id: bcaId };
  return { upload, request, preview: ctx.services.imports.preview(fothangId, request) };
}

test('impor membaca baris, keterangan bank, dan mencegah impor ganda', async () => {
  const t = createTestContext();
  const { upload, request, preview } = await importJanuary(t);
  assert.equal(upload.sheets[0].year, 2026);
  assert.equal(preview.length, 3);
  assert.equal(preview[0].bank_desc, '0201/FTSCY/WS95271 300.00 | SANTY');
  assert.ok(preview.every((r) => r.chain_ok));

  assert.deepEqual(t.ctx.services.imports.commit(t.fothangId, request), { added: 3, skipped: 0 });
  assert.deepEqual(t.ctx.services.imports.commit(t.fothangId, request), { added: 0, skipped: 3 });
});

test('koreksi alokasi saat impor dipakai, nominal tetap dari file', async () => {
  const t = createTestContext();
  const { request } = await importJanuary(t);
  t.ctx.services.imports.commit(t.fothangId, { ...request, overrides: { 3: { pos_id: t.kfccId, name: 'Donasi KFCC' } } });
  const row = t.ctx.services.transaction.list(t.fothangId, { year: 2026, pos_id: t.kfccId })[0];
  assert.equal(row.name, 'Donasi KFCC');
  assert.equal(row.masuk, 50);
});

test('cek saldo gagal bila ada transaksi tanpa pos, lolos setelah dialokasikan', async () => {
  const t = createTestContext();
  const { request } = await importJanuary(t);
  t.ctx.services.imports.commit(t.fothangId, request);

  let check = t.ctx.services.reconciliation.month(t.fothangId, 2026, 1);
  assert.equal(check.ready, false);
  assert.equal(check.unallocated, 1);

  const unallocated = t.ctx.services.transaction.list(t.fothangId, { year: 2026, pos_id: 'none' });
  t.ctx.services.transaction.assignPos(t.fothangId, unallocated.map((r) => r.id), t.kfccId);
  check = t.ctx.services.reconciliation.month(t.fothangId, 2026, 1);
  assert.equal(check.ready, true, JSON.stringify(check.checks));

  const tabel = t.ctx.services.ledger.tabel(t.fothangId, 2026);
  assert.equal(tabel.total, 1150);
  assert.equal(tabel.selisih, 0);
});

test('draf menandai baris yang saldonya tidak cocok dengan bank', async () => {
  const t = createTestContext();
  const { request } = await importJanuary(t);
  t.ctx.services.imports.commit(t.fothangId, request);
  // Transaksi manual di akun bank yang tidak ada di rekening koran membuat saldo berikutnya meleset.
  t.ctx.services.transaction.create(t.fothangId, { date: '2026-01-03', account_id: t.bcaId, pos_id: t.cuThanId, name: 'Salah input', keluar: 10 });
  const draf = t.ctx.services.ledger.draf(t.fothangId, t.bcaId, 2026, 1);
  assert.deepEqual(draf.rows.map((r) => r.match), [true, null, false, false]);
});

test('pindahan antar pos tidak mengubah total, dan baris mutasi terkunci', async () => {
  const t = createTestContext();
  const { request } = await importJanuary(t);
  t.ctx.services.imports.commit(t.fothangId, request);
  t.ctx.services.transaction.transfer(t.fothangId, { date: '2026-01-10', account_id: t.bcaId, from_pos_id: t.cuThanId, to_pos_id: t.kfccId, amount: 100 });

  const sheet = t.ctx.services.ledger.posSheet(t.fothangId, t.kfccId, 2026);
  assert.equal(sheet.total_closing, 500);
  assert.equal(t.ctx.services.ledger.tabel(t.fothangId, 2026).total, 1150);

  const mutasiRow = t.ctx.services.transaction.list(t.fothangId, { year: 2026, pos_id: t.cuThanId }).find((r) => r.source === 'mutasi');
  t.ctx.services.transaction.update(t.fothangId, mutasiRow.id, { pos_id: t.cuThanId, name: 'Diubah', masuk: 999999, date: '2026-12-31' });
  const after = t.ctx.services.transaction.get(t.fothangId, mutasiRow.id);
  assert.equal(after.name, 'Diubah');
  assert.equal(after.amount_cents, 30000);
  assert.equal(after.date, '2026-01-02');
});

test('pecah transaksi: total tetap, saldo draf tetap cocok, bisa digabung kembali', async () => {
  const t = createTestContext();
  const { request } = await importJanuary(t);
  t.ctx.services.imports.commit(t.fothangId, request);
  const donasi = t.ctx.services.transaction.list(t.fothangId, { year: 2026, pos_id: t.cuThanId }).find((r) => r.masuk === 300);

  const partId = t.ctx.services.transaction.split(t.fothangId, donasi.id, { amount: 100, pos_id: t.kfccId, category: 'DONATUR', name: 'SAHABAT SEJATI' });
  assert.equal(t.ctx.services.transaction.get(t.fothangId, donasi.id).amount_cents, 20000);
  assert.equal(t.ctx.services.transaction.get(t.fothangId, partId).amount_cents, 10000);

  const draf = t.ctx.services.ledger.draf(t.fothangId, t.bcaId, 2026, 1);
  assert.ok(draf.rows.every((r) => r.match !== false), 'saldo bank dicek setelah pecahan terakhir');
  assert.deepEqual(draf.rows.slice(0, 2).map((r) => [r.pos, r.sheet_name]), [['CU THAN', 'SAHABAT SEJATI'], ['KFCC', 'SAHABAT SEJATI']]);
  assert.equal(t.ctx.services.ledger.posSheet(t.fothangId, t.kfccId, 2026).total_closing, 500);

  assert.throws(() => t.ctx.services.transaction.split(t.fothangId, donasi.id, { amount: 200, pos_id: t.kfccId }), /lebih kecil/);

  t.ctx.services.transaction.remove(t.fothangId, partId);
  assert.equal(t.ctx.services.transaction.get(t.fothangId, donasi.id).amount_cents, 30000);
});

test('laporan bulanan mengelompokkan pemasukan & daftar donatur', async () => {
  const t = createTestContext();
  const { request } = await importJanuary(t);
  t.ctx.services.imports.commit(t.fothangId, request);
  t.ctx.services.pos.update(t.fothangId, t.cuThanId, { number: 1, code: 'CU THAN', name: 'Cu Than', show_donors: true });

  const report = t.ctx.services.report.monthly(t.fothangId, 2026, 1);
  const cuThan = report.blocks.find((b) => b.pos.code === 'CU THAN');
  assert.deepEqual(cuThan.income, [{ label: 'Donatur', amount: 300, count: 1 }]);
  assert.deepEqual(cuThan.expense, [{ label: 'Iuran Mabgi', amount: 200, count: 1 }]);
  assert.equal(cuThan.opening, 600);
  assert.equal(cuThan.closing, 700);
  assert.deepEqual(cuThan.donors, [{ name: 'Sahabat Sejati', amount: 300 }]);
});

test('data Fothang lain tidak bisa diakses', async () => {
  const t = createTestContext();
  const other = t.ctx.services.fothang.create({ code: 'LAIN', name: 'Lain Fo Thang', start_date: '2026-01-01' });
  assert.throws(() => t.ctx.services.pos.get(other.id, t.cuThanId), /Pos tidak ditemukan/);
});

test('impor memecah otomatis kode "... 500K KFCC"', async () => {
  const t = createTestContext();
  const file = await makeMutasiFile([['16/01', 'TRSF E-BANKING CR', 'CU THAN ; SHERLY THE (500K) KFCC ; SHERLY THE (500K)', '1,000,000.00 CR', '1,001,000.00']]);
  const upload = await t.ctx.services.imports.upload(t.fothangId, file, 'Mutasi Januari 2026.xlsx');
  const request = { token: upload.token, sheet: 'Jan 26', year: 2026, account_id: t.bcaId };
  assert.deepEqual(t.ctx.services.imports.commit(t.fothangId, request), { added: 1, skipped: 0 });

  const rows = t.ctx.services.transaction.list(t.fothangId, { year: 2026 });
  assert.deepEqual(rows.map((r) => [r.pos, r.category, r.masuk]), [['CU THAN', 'DONATUR', 500000], ['KFCC', 'DONATUR', 500000]]);
  assert.ok(t.ctx.services.reconciliation.month(t.fothangId, 2026, 1).ready);
});

test('dashboard: total cocok dengan per pos, pindahan tidak dihitung sebagai masuk/keluar', async () => {
  const t = createTestContext();
  const { request } = await importJanuary(t);
  t.ctx.services.imports.commit(t.fothangId, request);
  const unallocated = t.ctx.services.transaction.list(t.fothangId, { year: 2026, pos_id: 'none' });
  t.ctx.services.transaction.assignPos(t.fothangId, unallocated.map((r) => r.id), t.kfccId);
  t.ctx.services.transaction.transfer(t.fothangId, { date: '2026-01-10', account_id: t.bcaId, from_pos_id: t.cuThanId, to_pos_id: t.kfccId, amount: 100 });

  const o = t.ctx.services.dashboard.overview(t.fothangId, 2026);
  assert.equal(o.last_month, 1);
  assert.deepEqual([o.totals.opening, o.totals.masuk, o.totals.keluar, o.totals.saldo, o.totals.selisih], [1000, 350, 200, 1150, 0]);
  assert.equal(o.pos.reduce((s, p) => s + p.closing, 0), o.totals.saldo);
  const kfcc = o.pos.find((p) => p.code === 'KFCC');
  assert.deepEqual([kfcc.opening, kfcc.masuk, kfcc.keluar, kfcc.pindahan, kfcc.closing], [400, 50, 0, 100, 550]);
  assert.deepEqual(o.months[0], { month: 1, masuk: 350, keluar: 200, saldo: 1150, count: 5 });
  assert.equal(o.months[1].saldo, null, 'bulan tanpa data tidak digambar');

  const cu = t.ctx.services.dashboard.pos(t.fothangId, t.cuThanId, 2026);
  assert.deepEqual([cu.opening, cu.masuk, cu.keluar, cu.pindahan, cu.closing], [600, 300, 200, -100, 600]);
  assert.deepEqual(cu.income, [{ label: 'Donatur', amount: 300, count: 1 }]);
});
