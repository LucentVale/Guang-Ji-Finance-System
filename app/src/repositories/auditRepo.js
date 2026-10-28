// Akses tabel audit_log (catatan aktivitas). Hanya bisa ditambah, tidak pernah diubah.
module.exports = function auditRepo(db) {
  return {
    insert: (e) =>
      db.prepare('INSERT INTO audit_log (user_id, username, fothang_id, action, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run(e.user_id ?? null, e.username, e.fothang_id ?? null, e.action, e.entity_id ?? null, e.detail ?? ''),

    /** filter: { fothangIds (null = semua), userId, limit } — terbaru dulu. */
    list(filter) {
      const clauses = [];
      const args = [];
      if (filter.fothangIds) {
        clauses.push(`(fothang_id IS NULL OR fothang_id IN (${filter.fothangIds.map(() => '?').join(',') || 'NULL'}))`);
        args.push(...filter.fothangIds);
      }
      if (filter.userId) { clauses.push('user_id = ?'); args.push(filter.userId); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      return db.prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`).all(...args, filter.limit || 200);
    },
  };
};
