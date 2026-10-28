// Kelola pengguna (Admin) dan catatan aktivitas.
const { reply } = require('../respond');
const { ROLES } = require('../../services/accessPolicy');

module.exports = function register(router, { services }) {
  const admin = { permission: 'admin' };

  router.get('/api/roles', () => Object.entries(ROLES).map(([value, r]) => ({ value, label: r.label, permissions: r.permissions })));
  router.get('/api/users', () => services.user.list(), admin);
  router.post('/api/users', ({ body }) => reply.created({ id: services.user.create(body) }), { ...admin, audit: 'Menambah pengguna' });
  router.put('/api/users/:id', ({ params, body }) => { services.user.update(params.id, body); }, { ...admin, audit: 'Mengubah pengguna' });
  router.post('/api/users/:id/reset-password', ({ params, body }) => { services.user.resetPassword(params.id, body.password); },
    { ...admin, audit: 'Mengatur ulang kata sandi pengguna' });

  router.get('/api/audit', ({ user, query }) => services.audit.list(user, { limit: query.limit }));
};
