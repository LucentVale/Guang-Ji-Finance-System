// Unduhan: Excel (tahunan, draf, laporan bulanan, transaksi) dan backup database.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reply, MIME } = require('../respond');
const { assertYear, assertMonth, monthName, monthRange } = require('../../lib/period');

module.exports = function register(router, { db, repos, services }) {
  const base = '/api/fothang/:fothangId/export';

  /** Bulan yang dipilih, atau semua bulan yang punya transaksi. */
  function monthsOf(fothangId, year, month) {
    if (month) return [assertMonth(month)];
    const months = [];
    for (let m = 1; m <= 12; m++) if (repos.transaction.count({ fothangId, ...monthRange(year, m) })) months.push(m);
    return months.length ? months : [1];
  }

  /** Bulan terakhir (1-12) yang punya transaksi di akun ini; Januari bila belum ada data sama sekali. */
  function lastMonthWithData(fothangId, year, accountId) {
    for (let m = 12; m >= 1; m--) if (repos.transaction.count({ fothangId, accountId, ...monthRange(year, m) })) return m;
    return 1;
  }

  const fileLabel = (fothangId, year, month) =>
    `${services.fothang.get(fothangId).short_name} ${month ? `${monthName(Number(month))} ` : ''}${year}`;

  router.get(`${base}/tahunan.xlsx`, async ({ params, query }) => {
    const year = assertYear(query.year);
    const buffer = await services.excel.annualWorkbook(params.fothangId, year);
    return reply.file(buffer, `Laporan Keuangan ${fileLabel(params.fothangId, year)}.xlsx`, MIME.xlsx);
  });

  // Selalu sampai bulan TERAKHIR yang punya data di akun itu (bukan bulan yang sedang dibuka di aplikasi):
  // satu sheet bernama bulan tersebut, berisi Januari s.d. bulan itu.
  router.get(`${base}/draf.xlsx`, async ({ params, query }) => {
    const year = assertYear(query.year);
    const accountId = Number(query.account_id);
    const lastMonth = lastMonthWithData(params.fothangId, year, accountId);
    const buffer = await services.excel.draftWorkbook(params.fothangId, accountId, year, lastMonth);
    return reply.file(buffer, `DRAF Laporan Keuangan ${fileLabel(params.fothangId, year)}.xlsx`, MIME.xlsx);
  });

  router.get(`${base}/laporan-bulanan.xlsx`, async ({ params, query }) => {
    const year = assertYear(query.year);
    const buffer = await services.excel.monthlyReportWorkbook(params.fothangId, year, monthsOf(params.fothangId, year, query.month));
    return reply.file(buffer, `Bentuk Laporan Keuangan ${fileLabel(params.fothangId, year, query.month)}.xlsx`, MIME.xlsx);
  });

  router.get(`${base}/transaksi.xlsx`, async ({ params, query }) => {
    const buffer = await services.excel.transactionsWorkbook(services.transaction.list(params.fothangId, query));
    return reply.file(buffer, 'Daftar Transaksi.xlsx', MIME.xlsx);
  });

  // Salinan utuh database (semua Fothang) yang aman diambil walau aplikasi sedang berjalan.
  router.get('/api/backup', () => {
    const tmp = path.join(os.tmpdir(), `backup-keuangan-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buffer = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return reply.file(buffer, `backup-keuangan-${new Date().toISOString().slice(0, 10)}.db`, MIME.binary);
  }, { permission: 'admin' });
};
