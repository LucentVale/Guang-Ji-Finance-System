// Login, keluar, status sesi, ganti kata sandi, dan pembuatan Admin pertama.
const { AppError } = require('../../lib/errors');
const { readSessionToken, sessionCookie, clearedSessionCookie, isLocalRequest } = require('../session');

module.exports = function register(router, { services, config }) {
  const cookieOptions = { maxAgeSeconds: config.auth.sessionMaxHours * 3600, secure: config.auth.cookieSecure };

  // Dipanggil frontend saat dibuka: perlu setup? sudah login?
  router.get('/api/auth/status', ({ user, req }) => ({
    login_required: config.auth.loginRequired,
    setup_needed: config.auth.loginRequired && services.auth.setupNeeded(),
    setup_allowed_here: isLocalRequest(req),
    user: user ? strip(user) : null,
  }), { public: true });

  router.post('/api/auth/setup', ({ req, body, setCookie }) => {
    // Admin pertama hanya boleh dibuat langsung dari komputer server, bukan dari internet.
    if (!isLocalRequest(req)) throw new AppError(403, 'Akun Admin pertama hanya bisa dibuat dari komputer server');
    const { token, user } = services.auth.setupFirstAdmin(body);
    services.audit.record({ user, action: 'Membuat akun Admin pertama' });
    setCookie(sessionCookie(token, cookieOptions));
    return { user };
  }, { public: true, audit: false });

  router.post('/api/auth/login', ({ body, setCookie }) => {
    try {
      const { token, user } = services.auth.login(body.username, body.password);
      services.audit.record({ user, action: 'Masuk (login)' });
      setCookie(sessionCookie(token, cookieOptions));
      return { user };
    } catch (err) {
      services.audit.record({ user: { username: String(body.username || '').slice(0, 40) }, action: `Gagal masuk: ${err.message}` });
      throw err;
    }
  }, { public: true, audit: false });

  router.post('/api/auth/logout', ({ req, user, setCookie }) => {
    services.auth.logout(readSessionToken(req));
    if (user) services.audit.record({ user, action: 'Keluar (logout)' });
    setCookie(clearedSessionCookie(cookieOptions));
  }, { public: true, audit: false });

  router.post('/api/auth/change-password', ({ user, body }) => {
    services.auth.changePassword(user, body.current_password, body.new_password);
  }, { permission: 'read', allowWhilePasswordExpired: true, audit: 'Mengganti kata sandi sendiri' });
};

/** Jangan kirim hash sesi ke browser. */
function strip(user) {
  const { session_hash: _hidden, ...rest } = user;
  return rest;
}
