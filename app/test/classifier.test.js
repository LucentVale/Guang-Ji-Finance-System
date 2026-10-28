const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, buildAliasIndex } = require('../src/services/classifier');

const index = buildAliasIndex([
  { id: 1, code: 'CU THAN', aliases: 'CT' },
  { id: 8, code: 'PAT', aliases: 'PHING AN TEN,PAT WU AI LIU=Wu Ai Liu' },
  { id: 13, code: 'KELAS SXY', aliases: 'KELAS,SXY' },
]);
const row = (bank_code, amount_cents, bank_type = 'TRSF E-BANKING CR') => ({ bank_code, amount_cents, bank_type });

test('dua bagian, uang masuk -> kategori DONATUR', () => {
  assert.deepEqual(classify(row('CU THAN ; SAHABAT SEJATI', 300000000), index),
    { pos_id: 1, pos_code: 'CU THAN', category: 'DONATUR', name: 'SAHABAT SEJATI', split: null });
});

test('dua bagian, uang keluar -> tanpa kategori, nama = uraian', () => {
  const r = classify(row('CU THAN ; IURAN MABGI', -20000000, 'TRSF E-BANKING DB'), index);
  assert.equal(r.category, '');
  assert.equal(r.name, 'IURAN MABGI');
});

test('tiga bagian -> kategori di tengah', () => {
  const r = classify(row('CU THAN ; PELITA ; IRENE', 10000000), index);
  assert.equal(r.category, 'PELITA');
  assert.equal(r.name, 'IRENE');
});

test('baris otomatis bank selalu memakai kategori baku', () => {
  assert.equal(classify(row('CU THAN ; BUNGA BANK', 11811278, 'BUNGA'), index).category, 'BUNGA BANK');
  assert.equal(classify(row('CU THAN', -2362256, 'PAJAK BUNGA'), index).category, 'PAJAK BUNGA');
  assert.equal(classify(row('CU THAN ; BY. ADMIN BANK', -3000000, 'BIAYA ADM'), index).category, 'BIAYA ADM');
});

test('alias dikenali, termasuk alias dengan kategori', () => {
  assert.equal(classify(row('KELAS ; CONG SIU LIAN', 25000000), index).pos_id, 13);
  const pat = classify(row('PAT WU AI LIU ; NO 1 - 2', 100000800), index);
  assert.equal(pat.pos_id, 8);
  assert.equal(pat.category, 'WU AI LIU');
});

test('kode tidak dikenal -> pos kosong, spasi ganda dirapikan', () => {
  assert.equal(classify(row('X', 50000000), index).pos_id, null);
  assert.equal(classify(row('CU  THAN ; AGUNG', 20000000), index).pos_id, 1);
});

test('penanda pecah "500K KFCC" menghasilkan saran pecah ke pos lain', () => {
  const withKfcc = buildAliasIndex([{ id: 1, code: 'CU THAN', aliases: '' }, { id: 2, code: 'KFCC', aliases: '' }, { id: 3, code: 'KITAB SUCI', aliases: '' }, { id: 4, code: 'SSY', aliases: '' }]);
  const sherly = classify(row('CU THAN ; SHERLY THE (500K) KFCC ; SHERLY THE (500K)', 100000000), withKfcc);
  assert.deepEqual(sherly, { pos_id: 1, pos_code: 'CU THAN', category: 'DONATUR', name: 'SHERLY THE', split: { pos_id: 2, pos_code: 'KFCC', amount_cents: 50000000 } });

  const liSuChiu = classify(row('SSY ; LI SU CHIU 250K KITAB SUCI ; LI SU CHIU 250K', 50000000), withKfcc);
  assert.deepEqual(liSuChiu.split, { pos_id: 3, pos_code: 'KITAB SUCI', amount_cents: 25000000 });

  // Tidak dipecah bila nominal pecahan >= nominal transaksi atau pos tujuannya tidak dikenal.
  assert.equal(classify(row('CU THAN ; SHERLY (500K) KFCC ; SHERLY', 50000000), withKfcc).split, null);
  assert.equal(classify(row('CU THAN ; PELITA 2026 ; IRENE', 50000000), withKfcc).split, null);
});
