// Akses tabel app_user dan user_fothang.
module.exports = function userRepo(db) {
  return {
    count: () => db.prepare('SELECT COUNT(*) AS n FROM app_user').get().n,
    list: () => db.prepare('SELECT * FROM app_user ORDER BY role, full_name').all(),
    findById: (id) => db.prepare('SELECT * FROM app_user WHERE id = ?').get(id),
    findByUsername: (username) => db.prepare('SELECT * FROM app_user WHERE username = ?').get(username),

    insert: (u) =>
      Number(db.prepare('INSERT INTO app_user (username, full_name, password_hash, role, active, must_change_password) VALUES (?, ?, ?, ?, ?, ?)')
        .run(u.username, u.full_name, u.password_hash, u.role, u.active, u.must_change_password).lastInsertRowid),

    update: (id, u) =>
      db.prepare('UPDATE app_user SET full_name = ?, role = ?, active = ? WHERE id = ?').run(u.full_name, u.role, u.active, id),

    setPassword: (id, hash, mustChange) =>
      db.prepare('UPDATE app_user SET password_hash = ?, must_change_password = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
        .run(hash, mustChange ? 1 : 0, id),

    recordFailure: (id, attempts, lockedUntil) =>
      db.prepare('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockedUntil, id),

    recordLogin: (id, at) =>
      db.prepare('UPDATE app_user SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(at, id),

    fothangIds: (userId) => db.prepare('SELECT fothang_id FROM user_fothang WHERE user_id = ?').all(userId).map((r) => r.fothang_id),

    setFothangIds(userId, ids) {
      db.prepare('DELETE FROM user_fothang WHERE user_id = ?').run(userId);
      const st = db.prepare('INSERT INTO user_fothang (user_id, fothang_id) VALUES (?, ?)');
      for (const id of ids) st.run(userId, id);
    },

    countActiveAdmins: () => db.prepare("SELECT COUNT(*) AS n FROM app_user WHERE role = 'admin' AND active = 1").get().n,
  };
};
