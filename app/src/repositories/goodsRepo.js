// Akses tabel goods_donation (sheet "Barang").
module.exports = function goodsRepo(db) {
  return {
    listByYear: (fothangId, from, to) =>
      db.prepare('SELECT * FROM goods_donation WHERE fothang_id = ? AND date >= ? AND date < ? ORDER BY date, id').all(fothangId, from, to),

    findById: (id) => db.prepare('SELECT * FROM goods_donation WHERE id = ?').get(id),

    insert: (fothangId, g) =>
      Number(db.prepare('INSERT INTO goods_donation (fothang_id, date, name, item, note) VALUES (?, ?, ?, ?, ?)')
        .run(fothangId, g.date, g.name, g.item, g.note).lastInsertRowid),

    update: (id, g) => db.prepare('UPDATE goods_donation SET date = ?, name = ?, item = ?, note = ? WHERE id = ?').run(g.date, g.name, g.item, g.note, id),

    delete: (id) => db.prepare('DELETE FROM goods_donation WHERE id = ?').run(id),
  };
};
