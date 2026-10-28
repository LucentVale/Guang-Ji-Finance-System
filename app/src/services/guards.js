// Pemeriksaan kepemilikan: data milik Fothang lain tidak boleh dibaca/diubah lewat Fothang ini.
const { notFound } = require('../lib/errors');

function assertOwned(entity, fothangId, label) {
  if (!entity || entity.fothang_id !== fothangId) throw notFound(`${label} tidak ditemukan`);
  return entity;
}

module.exports = { assertOwned };
