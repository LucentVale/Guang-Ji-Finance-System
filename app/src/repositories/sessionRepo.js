// Akses tabel session. Kolom waktu memakai ISO UTC (new Date().toISOString()) agar mudah dibandingkan.
module.exports = function sessionRepo(db) {
  return {
    insert: (s) =>
      db.prepare('INSERT INTO session (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run(s.token_hash, s.user_id, s.created_at, s.last_seen_at, s.expires_at),

    find: (tokenHash) => db.prepare('SELECT * FROM session WHERE token_hash = ?').get(tokenHash),
    touch: (tokenHash, at) => db.prepare('UPDATE session SET last_seen_at = ? WHERE token_hash = ?').run(at, tokenHash),
    delete: (tokenHash) => db.prepare('DELETE FROM session WHERE token_hash = ?').run(tokenHash),
    deleteByUser: (userId) => db.prepare('DELETE FROM session WHERE user_id = ?').run(userId),
    deleteOtherSessions: (userId, keepHash) => db.prepare('DELETE FROM session WHERE user_id = ? AND token_hash <> ?').run(userId, keepHash),
    deleteExpired: (now, idleBefore) => db.prepare('DELETE FROM session WHERE expires_at < ? OR last_seen_at < ?').run(now, idleBefore),
  };
};
