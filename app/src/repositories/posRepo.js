// Akses tabel pos dan saldo awalnya per akun.
module.exports = function posRepo(db) {
  return {
    listByFothang: (fothangId, { includeInactive = false } = {}) =>
      db.prepare(`SELECT * FROM pos WHERE fothang_id = ? ${includeInactive ? '' : 'AND active = 1'} ORDER BY number, id`).all(fothangId),

    findById: (id) => db.prepare('SELECT * FROM pos WHERE id = ?').get(id),

    insert: (fothangId, p) =>
      Number(
        db.prepare('INSERT INTO pos (fothang_id, number, code, name, aliases, show_donors, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(fothangId, p.number, p.code, p.name, p.aliases, p.show_donors, p.active).lastInsertRowid,
      ),

    update: (id, p) =>
      db.prepare('UPDATE pos SET number = ?, code = ?, name = ?, aliases = ?, show_donors = ?, active = ? WHERE id = ?')
        .run(p.number, p.code, p.name, p.aliases, p.show_donors, p.active, id),

    delete: (id) => db.prepare('DELETE FROM pos WHERE id = ?').run(id),

    /** Saldo awal semua pos milik satu Fothang: [{ pos_id, account_id, amount_cents }]. */
    openingsByFothang: (fothangId) =>
      db.prepare(`SELECT o.* FROM pos_opening o JOIN pos p ON p.id = o.pos_id WHERE p.fothang_id = ?`).all(fothangId),

    setOpening: (posId, accountId, cents) =>
      db.prepare(`INSERT INTO pos_opening (pos_id, account_id, amount_cents) VALUES (?, ?, ?)
                  ON CONFLICT (pos_id, account_id) DO UPDATE SET amount_cents = excluded.amount_cents`).run(posId, accountId, cents),
  };
};
