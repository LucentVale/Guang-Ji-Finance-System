// Tampilan laporan: Tabel, sheet per pos, Draf, Cek Saldo, Laporan Bulanan, dan Dashboard.
const { assertYear, assertMonth } = require('../../lib/period');

module.exports = function register(router, { services }) {
  const base = '/api/fothang/:fothangId';

  router.get(`${base}/tabel`, ({ params, query }) => services.ledger.tabel(params.fothangId, assertYear(query.year)));
  router.get(`${base}/pos/:posId/sheet`, ({ params, query }) => services.ledger.posSheet(params.fothangId, params.posId, assertYear(query.year)));
  router.get(`${base}/draf`, ({ params, query }) =>
    services.ledger.draf(params.fothangId, query.account_id, assertYear(query.year), assertMonth(query.month)));
  router.get(`${base}/cek`, ({ params, query }) =>
    services.reconciliation.month(params.fothangId, assertYear(query.year), assertMonth(query.month)));
  router.get(`${base}/laporan-bulanan`, ({ params, query }) =>
    services.report.monthly(params.fothangId, assertYear(query.year), assertMonth(query.month), { all: query.all === '1' }));

  // month opsional: tanpa month = setahun penuh.
  const optionalMonth = (value) => (value ? assertMonth(value) : null);
  router.get(`${base}/dashboard`, ({ params, query }) =>
    services.dashboard.overview(params.fothangId, assertYear(query.year), optionalMonth(query.month)));
  router.get(`${base}/dashboard/pos/:posId`, ({ params, query }) =>
    services.dashboard.pos(params.fothangId, params.posId, assertYear(query.year), optionalMonth(query.month)));
};
