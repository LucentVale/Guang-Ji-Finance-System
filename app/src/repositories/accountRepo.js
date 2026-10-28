// Akses tabel account (rekening bank / kas).
module.exports = function accountRepo(db) {
  return {
    listByFothang: (fothangId) => db.prepare('SELECT * FROM account WHERE fothang_id = ? ORDER BY sort, id').all(fothangId),

    findById: (id) => db.prepare('SELECT * FROM account WHERE id = ?').get(id),

    insert: (fothangId, a) =>
      Number(
        db.prepare('INSERT INTO account (fothang_id, name, kind, account_no, opening_cents, sort) VALUES (?, ?, ?, ?, ?, ?)')
          .run(fothangId, a.name, a.kind, a.account_no, a.opening_cents, a.sort).lastInsertRowid,
      ),

    update: (id, a) =>
      db.prepare('UPDATE account SET name = ?, kind = ?, account_no = ?, opening_cents = ?, sort = ? WHERE id = ?')
        .run(a.name, a.kind, a.account_no, a.opening_cents, a.sort, id),
  };
};
