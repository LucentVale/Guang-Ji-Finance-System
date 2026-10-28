// Pos keuangan (CU THAN, KFCC, ...). Mengubah daftar pos & saldo awal khusus Admin.
const { reply } = require('../respond');

module.exports = function register(router, { services }) {
  const base = '/api/fothang/:fothangId/pos';
  const admin = { permission: 'admin' };

  router.get(base, ({ params, query }) => services.pos.list(params.fothangId, { includeInactive: query.all === '1' }));
  router.post(base, ({ params, body }) => reply.created({ id: services.pos.create(params.fothangId, body) }), { ...admin, audit: 'Menambah pos' });
  router.put(`${base}/:id`, ({ params, body }) => { services.pos.update(params.fothangId, params.id, body); }, { ...admin, audit: 'Mengubah pos / saldo awal' });
  router.delete(`${base}/:id`, ({ params }) => { services.pos.remove(params.fothangId, params.id); }, { ...admin, audit: 'Menghapus pos' });
};
