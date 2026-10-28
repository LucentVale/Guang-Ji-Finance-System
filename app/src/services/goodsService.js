// Sheet "Barang": donasi berupa barang.
const { badRequest } = require('../lib/errors');
const { assertIsoDate, yearRange } = require('../lib/period');
const { clean } = require('../lib/text');
const { assertOwned } = require('./guards');

module.exports = function goodsService({ repos }) {
  function validate(input) {
    const g = { date: assertIsoDate(input.date), name: clean(input.name), item: clean(input.item), note: clean(input.note) };
    if (!g.name || !g.item) throw badRequest('Nama donatur dan barang wajib diisi');
    return g;
  }

  return {
    list(fothangId, year) {
      const { from, to } = yearRange(year);
      return repos.goods.listByYear(fothangId, from, to);
    },
    create: (fothangId, input) => repos.goods.insert(fothangId, validate(input)),
    update(fothangId, id, input) {
      assertOwned(repos.goods.findById(Number(id)), fothangId, 'Data barang');
      repos.goods.update(Number(id), validate(input));
    },
    remove(fothangId, id) {
      assertOwned(repos.goods.findById(Number(id)), fothangId, 'Data barang');
      repos.goods.delete(Number(id));
    },
  };
};
