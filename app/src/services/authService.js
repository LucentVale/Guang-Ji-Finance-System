// Login, sesi, ganti kata sandi, dan pembuatan akun Admin pertama.
const { badRequest, AppError, conflict } = require('../lib/errors');
const { clean } = require('../lib/text');
const pw = require('../lib/password');
const { ROLES } = require('./accessPolicy');

const unauthorized = (message = 'Silakan masuk terlebih dahulu') => new AppError(401, message);
const GENERIC_LOGIN_ERROR = 'Nama pengguna atau kata sandi salah';

module.exports = function authService({ repos, services, config }) {
  const opts = config.auth;
  const now = () => new Date();
  const iso = (d) => d.toISOString();
  const addMinutes = (d, m) => new Date(d.getTime() + m * 60000);

  /** Data pengguna yang aman dikirim ke browser (tanpa hash kata sandi). */
  function publicUser(u) {
    return {
      id: u.id,
      username: u.username,
      full_name: u.full_name,
      role: u.role,
      role_label: ROLES[u.role].label,
      active: !!u.active,
      must_change_password: !!u.must_change_password,
      fothang_ids: repos.user.fothangIds(u.id),
      last_login_at: u.last_login_at,
    };
  }

  function startSession(user) {
    const { token, hash } = pw.newToken();
    const t = now();
    repos.session.insert({ token_hash: hash, user_id: user.id, created_at: iso(t), last_seen_at: iso(t), expires_at: iso(addMinutes(t, opts.sessionMaxHours * 60)) });
    repos.user.recordLogin(user.id, iso(t));
    return token;
  }

  return {
    /** Belum ada pengguna sama sekali -> perlu membuat Admin pertama. */
    setupNeeded: () => repos.user.count() === 0,

    /** Buat Admin pertama. Hanya boleh saat belum ada pengguna (pemeriksaan asal permintaan ada di lapisan HTTP). */
    setupFirstAdmin(input) {
      if (repos.user.count() > 0) throw conflict('Akun Admin sudah pernah dibuat');
      const id = services.user.create({ ...input, role: 'admin', must_change_password: false }, null);
      return { token: startSession(repos.user.findById(id)), user: publicUser(repos.user.findById(id)) };
    },

    /**
     * Pesan error dibuat sama untuk "pengguna tidak ada" dan "kata sandi salah",
     * supaya orang luar tidak bisa menebak nama pengguna yang terdaftar.
     */
    login(username, password) {
      const user = repos.user.findByUsername(clean(username));
      if (!user || !user.active) {
        pw.verifyPassword(password, pw.hashPassword('waktu-yang-sama')); // samakan waktu respons
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }
      if (user.locked_until && user.locked_until > iso(now())) {
        throw new AppError(429, `Akun dikunci sementara karena terlalu banyak percobaan. Coba lagi setelah ${opts.lockMinutes} menit.`);
      }
      if (!pw.verifyPassword(password, user.password_hash)) {
        const attempts = user.failed_attempts + 1;
        const locked = attempts >= opts.maxFailedLogins ? iso(addMinutes(now(), opts.lockMinutes)) : null;
        repos.user.recordFailure(user.id, locked ? 0 : attempts, locked);
        throw unauthorized(GENERIC_LOGIN_ERROR);
      }
      return { token: startSession(user), user: publicUser(user) };
    },

    /** Pengguna pemilik token, atau null bila sesi tidak ada / habis / pengguna dinonaktifkan. */
    authenticate(token) {
      if (!token) return null;
      const hash = pw.hashToken(token);
      const session = repos.session.find(hash);
      if (!session) return null;
      const t = now();
      const idleLimit = iso(addMinutes(t, -opts.sessionIdleMinutes));
      if (session.expires_at < iso(t) || session.last_seen_at < idleLimit) {
        repos.session.delete(hash);
        return null;
      }
      const user = repos.user.findById(session.user_id);
      if (!user || !user.active) return null;
      repos.session.touch(hash, iso(t));
      return { ...publicUser(user), session_hash: hash };
    },

    logout(token) {
      if (token) repos.session.delete(pw.hashToken(token));
    },

    /** Ganti kata sandi sendiri; sesi lain milik pengguna ini ikut berakhir. */
    changePassword(user, currentPassword, newPassword) {
      const row = repos.user.findById(user.id);
      if (!pw.verifyPassword(currentPassword, row.password_hash)) throw badRequest('Kata sandi lama salah');
      const problem = pw.passwordProblem(newPassword, row.username);
      if (problem) throw badRequest(problem);
      if (pw.verifyPassword(newPassword, row.password_hash)) throw badRequest('Kata sandi baru harus berbeda dari yang lama');
      repos.user.setPassword(row.id, pw.hashPassword(newPassword), false);
      repos.session.deleteOtherSessions(row.id, user.session_hash);
    },

    purgeExpiredSessions() {
      const t = now();
      repos.session.deleteExpired(iso(t), iso(addMinutes(t, -opts.sessionIdleMinutes)));
    },

    publicUser,
  };
};
