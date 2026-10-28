// Merangkai seluruh lapisan aplikasi: database -> repositories -> services.
// Pengujian bisa memakai createContext(':memory:') untuk database sementara.
const defaultConfig = require('./config');
const { openDatabase } = require('./db/connection');
const { seedIfEmpty } = require('./db/seed');

const repositoryFactories = {
  fothang: require('./repositories/fothangRepo'),
  account: require('./repositories/accountRepo'),
  pos: require('./repositories/posRepo'),
  transaction: require('./repositories/transactionRepo'),
  goods: require('./repositories/goodsRepo'),
  user: require('./repositories/userRepo'),
  session: require('./repositories/sessionRepo'),
  audit: require('./repositories/auditRepo'),
};

// Service saling memanggil lewat ctx.services saat dijalankan, jadi urutan di sini tidak berpengaruh.
const serviceFactories = {
  fothang: require('./services/fothangService'),
  pos: require('./services/posService'),
  balance: require('./services/balanceService'),
  transaction: require('./services/transactionService'),
  imports: require('./services/importService'),
  goods: require('./services/goodsService'),
  ledger: require('./services/ledgerService'),
  reconciliation: require('./services/reconciliationService'),
  report: require('./services/reportService'),
  dashboard: require('./services/dashboardService'),
  excel: require('./services/excelExport'),
  auth: require('./services/authService'),
  user: require('./services/userService'),
  audit: require('./services/auditService'),
};

function createContext(databaseFile, { seed = true, config = defaultConfig } = {}) {
  const db = openDatabase(databaseFile);
  const repos = {};
  for (const [name, factory] of Object.entries(repositoryFactories)) repos[name] = factory(db);

  const ctx = { db, repos, services: {}, config };
  for (const [name, factory] of Object.entries(serviceFactories)) ctx.services[name] = factory(ctx);

  if (seed) seedIfEmpty(ctx);
  return ctx;
}

module.exports = { createContext };
