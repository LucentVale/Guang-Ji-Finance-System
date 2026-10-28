// Kelola pengguna (khusus Admin): tambah, ubah peran/akses, nonaktifkan, atur ulang kata sandi.
const { inTransaction } = require('../db/connection');
const { badRequest, conflict, notFound } = require('../lib/errors');
const { clean } = require('../lib/text');
const pw = require('../lib/password');
const { isRole } = require('./accessPolicy');

module.exports = function userService({ db, repos, services }) {
  function getUser(id) {
    const u = repos.user.findById(Number(id));
    if (!u) throw notFound('Pengguna tidak ditemukan');
    return u;
  }

  /** Fothang yang valid saja; admin tidak perlu daftar Fothang (otomatis semua). */
  function validFothangIds(role, ids = []) {
    if (role === 'admin') return [];
    const existing = new Set(repos.fothang.list().map((f) => f.id));
    const clean = [...new Set(ids.map(Number))].filter((id) => existing.has(id));
    if (!clean.length) throw badRequest('Pilih minimal satu Fothang yang boleh diakses pengguna ini');
    return clean;
  }

  function validateProfile(input) {
    const p = { full_name: clean(input.full_name), role: input.role, active: input.active === false ? 0 : 1 };
    if (!p.full_name) throw badRequest('Nama lengkap wajib diisi');
    if (!isRole(p.role)) throw badRequest('Peran tidak valid');
    return p;
  }

  /** Jangan sampai tidak ada Admin aktif sama sekali (aplikasi tidak bisa dikelola lagi). */
  function assertKeepsAnAdmin(user, next) {
    const losesAdmin = user.role === 'admin' && user.active && (next.role !== 'admin' || !next.active);
    if (losesAdmin && repos.user.countActiveAdmins() <= 1) throw conflict('Harus ada minimal satu Admin aktif');
  }

  return {
    list: () => repos.user.list().map((u) => services.auth.publicUser(u)),

    /** input: { username, full_name, role, password, fothang_ids, must_change_password } */
    create(input) {
      const username = clean(input.username).toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw badRequest('Nama pengguna 3–32 karakter: huruf kecil, angka, titik, - atau _');
      if (repos.user.findByUsername(username)) throw conflict(`Nama pengguna ${username} sudah dipakai`);
      const profile = validateProfile(input);
      const problem = pw.passwordProblem(input.password, username);
      if (problem) throw badRequest(problem);
      const fothangIds = validFothangIds(profile.role, input.fothang_ids);

      return inTransaction(db, () => {
        const id = repos.user.insert({
          username, ...profile, password_hash: pw.hashPassword(input.password),
          must_change_password: input.must_change_password === false ? 0 : 1,
        });
        repos.user.setFothangIds(id, fothangIds);
        return id;
      });
    },

    update(id, input) {
      const user = getUser(id);
      const profile = validateProfile(input);
      assertKeepsAnAdmin(user, profile);
      const fothangIds = validFothangIds(profile.role, input.fothang_ids);
      inTransaction(db, () => {
        repos.user.update(user.id, profile);
        repos.user.setFothangIds(user.id, fothangIds);
        if (!profile.active) repos.session.deleteByUser(user.id); // langsung keluar dari semua perangkat
      });
    },

    /** Admin memberi kata sandi sementara; pengguna wajib menggantinya saat login berikutnya. */
    resetPassword(id, temporaryPassword) {
      const user = getUser(id);
      const problem = pw.passwordProblem(temporaryPassword, user.username);
      if (problem) throw badRequest(problem);
      inTransaction(db, () => {
        repos.user.setPassword(user.id, pw.hashPassword(temporaryPassword), true);
        repos.session.deleteByUser(user.id);
      });
    },
  };
};
