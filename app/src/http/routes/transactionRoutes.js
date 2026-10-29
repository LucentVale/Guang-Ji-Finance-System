// Transaksi: daftar, input manual, ubah, hapus, pecah, alokasi pos, pindahan antar pos.
const { reply } = require('../respond');

module.exports = function register(router, { services }) {
  const base = '/api/fothang/:fothangId/transactions';

  router.get(base, ({ params, query }) => services.transaction.list(params.fothangId, query));
  router.post(base, ({ params, body }) => reply.created({ id: services.transaction.create(params.fothangId, body) }), { audit: 'Menambah transaksi' });
  router.put(`${base}/:id`, ({ params, body }) => { services.transaction.update(params.fothangId, params.id, body); }, { audit: 'Mengubah transaksi' });
  router.delete(`${base}/:id`, ({ params }) => { services.transaction.remove(params.fothangId, params.id); }, { audit: 'Menghapus transaksi' });

  router.post(`${base}/:id/split`, ({ params, body }) => reply.created({ id: services.transaction.split(params.fothangId, params.id, body) }),
    { audit: 'Memecah transaksi' });
  router.post(`${base}/assign-pos`, ({ params, body }) => ({ updated: services.transaction.assignPos(params.fothangId, body.ids || [], body.pos_id) }),
    { audit: 'Mengalokasikan pos' });
  router.post('/api/fothang/:fothangId/transfers', ({ params, body }) => reply.created({ transfer_id: services.transaction.transfer(params.fothangId, body) }),
    { audit: 'Pindahan antar pos' });
  router.get('/api/fothang/:fothangId/pos-balance', ({ params, query }) => services.transaction.posBalance(params.fothangId, query));
  router.get('/api/fothang/:fothangId/categories', ({ params }) => services.transaction.categories(params.fothangId));
};
