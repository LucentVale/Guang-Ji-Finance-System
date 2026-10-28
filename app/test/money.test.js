const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBankAmount, toCents, formatRupiah } = require('../src/lib/money');

test('parseBankAmount membaca nominal CR/DB rekening koran', () => {
  assert.equal(parseBankAmount('200,000.00 CR'), 20000000);
  assert.equal(parseBankAmount('1,844,000.00 DB'), -184400000);
  assert.equal(parseBankAmount(' 241,493,040.38'), 24149304038);
  assert.equal(parseBankAmount(''), null);
  assert.equal(parseBankAmount('bukan angka'), null);
});

test('toCents membulatkan ke sen terdekat', () => {
  assert.equal(toCents(118112.78), 11811278);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.throws(() => toCents('abc'));
});

test('formatRupiah memakai format Indonesia', () => {
  assert.equal(formatRupiah(123456789), 'Rp 1.234.567,89');
  assert.equal(formatRupiah(-50000), '-Rp 500,00');
});
