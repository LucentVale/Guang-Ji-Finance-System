// Akses tabel fothang. Repository hanya berisi SQL, tanpa aturan bisnis.
module.exports = function fothangRepo(db) {
  return {
    list: () => db.prepare('SELECT * FROM fothang ORDER BY id').all(),

    findById: (id) => db.prepare('SELECT * FROM fothang WHERE id = ?').get(id),

    insert: (f) =>
      Number(
        db.prepare('INSERT INTO fothang (code, name, short_name, start_date) VALUES (?, ?, ?, ?)')
          .run(f.code, f.name, f.short_name, f.start_date).lastInsertRowid,
      ),

    update: (id, f) =>
      db.prepare('UPDATE fothang SET code = ?, name = ?, short_name = ?, start_date = ? WHERE id = ?')
        .run(f.code, f.name, f.short_name, f.start_date, id),
  };
};
