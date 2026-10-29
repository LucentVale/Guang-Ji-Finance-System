// Akses tabel transactions. Semua nominal dalam sen.

const ORDER = 'ORDER BY date, seq, id';

module.exports = function transactionRepo(db) {
  /**
   * Bangun klausa WHERE dari filter.
   * filter: { fothangId, from, to, posId ('none' = belum dialokasikan), accountId, type ('in'|'out'), search }
   */
  function where(filter) {
    const clauses = ['fothang_id = ?'];
    const args = [filter.fothangId];
    if (filter.from) { clauses.push('date >= ?'); args.push(filter.from); }
    if (filter.to) { clauses.push('date < ?'); args.push(filter.to); }
    if (filter.posId === 'none') clauses.push('pos_id IS NULL');
    else if (filter.posId) { clauses.push('pos_id = ?'); args.push(filter.posId); }
    if (filter.accountId) { clauses.push('account_id = ?'); args.push(filter.accountId); }
    if (filter.source) { clauses.push('source = ?'); args.push(filter.source); }
    if (filter.type === 'in') clauses.push('amount_cents > 0');
    if (filter.type === 'out') clauses.push('amount_cents < 0');
    if (filter.search) {
      clauses.push('(name LIKE ? OR category LIKE ? OR bank_code LIKE ? OR note LIKE ? OR receipt_no LIKE ?)');
      const like = `%${filter.search}%`;
      args.push(like, like, like, like, like);
    }
    return { sql: clauses.join(' AND '), args };
  }

  return {
    findById: (id) => db.prepare('SELECT * FROM transactions WHERE id = ?').get(id),

    list(filter) {
      const w = where(filter);
      return db.prepare(`SELECT * FROM transactions WHERE ${w.sql} ${ORDER}`).all(...w.args);
    },

    count(filter) {
      const w = where(filter);
      return db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE ${w.sql}`).get(...w.args).n;
    },

    /** Total sen per (pos, akun) dalam rentang tanggal. */
    sumByPosAndAccount(fothangId, from, to) {
      return db.prepare(`SELECT pos_id, account_id, SUM(amount_cents) AS cents FROM transactions
                         WHERE fothang_id = ? AND date >= ? AND date < ? GROUP BY pos_id, account_id`).all(fothangId, from, to);
    },

    /** Total sen satu akun (semua pos) dalam rentang tanggal. */
    sumByAccount(accountId, from, to) {
      return db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM transactions WHERE account_id = ? AND date >= ? AND date < ?')
        .get(accountId, from, to).cents;
    },

    /** Urutan (seq) terbesar di satu akun pada satu tanggal; baris baru diberi seq sesudahnya supaya tampil paling bawah. */
    lastSeqOn: (accountId, date) => db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM transactions WHERE account_id = ? AND date = ?').get(accountId, date).s,

    /** Saldo rekening koran terakhir sebelum tanggal tertentu (baris mutasi terakhir). */
    lastStatementBalance(accountId, before) {
      return db.prepare(`SELECT date, balance_cents FROM transactions
                         WHERE account_id = ? AND source = 'mutasi' AND balance_cents IS NOT NULL AND date < ?
                         ORDER BY date DESC, seq DESC, id DESC LIMIT 1`).get(accountId, before) || null;
    },

    dedupeExists: (accountId, key) => !!db.prepare('SELECT 1 FROM transactions WHERE account_id = ? AND dedupe_key = ?').get(accountId, key),

    insert(t) {
      const r = db.prepare(`INSERT INTO transactions
        (fothang_id, account_id, pos_id, date, category, name, amount_cents, receipt_no, piao_wen, note,
         source, bank_type, bank_code, bank_desc, balance_cents, seq, dedupe_key, transfer_id, split_of)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        t.fothang_id, t.account_id, t.pos_id ?? null, t.date, t.category ?? '', t.name ?? '', t.amount_cents,
        t.receipt_no ?? '', t.piao_wen ?? '', t.note ?? '', t.source, t.bank_type ?? '', t.bank_code ?? '',
        t.bank_desc ?? '', t.balance_cents ?? null, t.seq ?? 0, t.dedupe_key ?? null, t.transfer_id ?? null, t.split_of ?? null,
      );
      return Number(r.lastInsertRowid);
    },

    /** Simpan baris mutasi; baris dengan dedupe_key yang sudah ada dilewati. Mengembalikan id baru, atau null bila dilewati. */
    insertIfNew(t) {
      if (t.dedupe_key && this.dedupeExists(t.account_id, t.dedupe_key)) return null;
      return this.insert(t);
    },

    update(id, t) {
      db.prepare(`UPDATE transactions SET account_id = ?, pos_id = ?, date = ?, category = ?, name = ?, amount_cents = ?,
                  receipt_no = ?, piao_wen = ?, note = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(t.account_id, t.pos_id ?? null, t.date, t.category, t.name, t.amount_cents, t.receipt_no, t.piao_wen, t.note, id);
    },

    /** Tambah/kurangi nominal satu baris (dipakai saat memecah dan menggabungkan kembali transaksi). */
    addAmount(id, deltaCents) {
      db.prepare("UPDATE transactions SET amount_cents = amount_cents + ?, updated_at = datetime('now','localtime') WHERE id = ?").run(deltaCents, id);
    },

    setPos(ids, posId) {
      const st = db.prepare("UPDATE transactions SET pos_id = ?, updated_at = datetime('now','localtime') WHERE id = ?");
      for (const id of ids) st.run(posId, id);
    },

    /** Hapus semua baris satu akun dalam rentang tanggal, kecuali pindahan antar pos (dipakai saat data bulan diganti dari file DRAF). */
    deleteForAccountPeriod: (accountId, from, to) =>
      Number(db.prepare("DELETE FROM transactions WHERE account_id = ? AND date >= ? AND date < ? AND source <> 'pindahan' AND split_of IS NULL")
        .run(accountId, from, to).changes),

    /** Jumlah baris per sumber untuk satu akun dalam rentang tanggal: { mutasi: 120, draf: 0, ... } */
    countBySource(accountId, from, to) {
      const rows = db.prepare("SELECT source, COUNT(*) AS n FROM transactions WHERE account_id = ? AND date >= ? AND date < ? AND source <> 'pindahan' GROUP BY source")
        .all(accountId, from, to);
      return Object.fromEntries(rows.map((r) => [r.source, r.n]));
    },

    delete: (id) => db.prepare('DELETE FROM transactions WHERE id = ?').run(id),
    deleteTransfer: (transferId) => db.prepare('DELETE FROM transactions WHERE transfer_id = ?').run(transferId),
    countByPos: (posId) => db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE pos_id = ?').get(posId).n,

    categories: (fothangId) =>
      db.prepare("SELECT category, COUNT(*) AS n FROM transactions WHERE fothang_id = ? AND category <> '' GROUP BY category ORDER BY n DESC")
        .all(fothangId).map((r) => r.category),
  };
};
