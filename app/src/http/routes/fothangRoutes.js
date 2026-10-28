// Fothang dan akun (rekening/kas).
const { reply } = require('../respond');
const { canAccessFothang } = require('../../services/accessPolicy');

module.exports = function register(router, { services }) {
  const admin = { permission: 'admin' };

  // Hanya Fothang yang boleh diakses pengguna ini.
  router.get('/api/fothang', ({ user }) => services.fothang.list().filter((f) => canAccessFothang(user, f.id)));
  router.post('/api/fothang', ({ body }) => reply.created(services.fothang.create(body)), { ...admin, audit: 'Menambah Fothang' });
  router.get('/api/fothang/:fothangId', ({ params }) => services.fothang.get(params.fothangId));
  router.put('/api/fothang/:fothangId', ({ params, body }) => services.fothang.update(params.fothangId, body), { ...admin, audit: 'Mengubah data Fothang' });

  router.get('/api/fothang/:fothangId/accounts', ({ params }) => services.fothang.accounts(params.fothangId));
  router.post('/api/fothang/:fothangId/accounts', ({ params, body }) => reply.created({ id: services.fothang.saveAccount(params.fothangId, body) }),
    { ...admin, audit: 'Menambah akun' });
  router.put('/api/fothang/:fothangId/accounts/:id', ({ params, body }) => {
    services.fothang.saveAccount(params.fothangId, body, Number(params.id));
  }, { ...admin, audit: 'Mengubah akun' });
};
