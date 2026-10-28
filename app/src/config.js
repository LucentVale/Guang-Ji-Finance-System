// Konfigurasi aplikasi.
// Urutan prioritas: environment variable  >  file config.local.json (di folder app)  >  nilai bawaan.
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..');
const LOCAL_CONFIG_FILE = path.join(ROOT_DIR, 'config.local.json');

/** Pengaturan khusus komputer ini, mis. { "loginRequired": false }. Tidak wajib ada. */
function readLocalConfig() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`File ${LOCAL_CONFIG_FILE} tidak valid: ${err.message}`);
  }
}

const local = readLocalConfig();
const envFlag = (name) => (process.env[name] === undefined ? undefined : process.env[name] === '1');

module.exports = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  databaseFile: process.env.DATABASE_FILE || path.join(ROOT_DIR, 'data', 'keuangan.db'),
  publicDir: path.join(ROOT_DIR, 'public'),
  maxUploadBytes: 25 * 1024 * 1024,

  auth: {
    // false = mode tanpa login (hanya untuk pemakaian di komputer ini; server menolak berjalan tanpa login bila bisa diakses dari luar).
    loginRequired: envFlag('LOGIN_REQUIRED') ?? local.loginRequired ?? true,
    sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES || 120), // keluar otomatis bila tidak aktif
    sessionMaxHours: Number(process.env.SESSION_MAX_HOURS || 12),       // batas mutlak satu sesi
    maxFailedLogins: 5,                                                   // salah kata sandi sebanyak ini -> dikunci
    lockMinutes: 15,
    // Aktifkan (COOKIE_SECURE=1) saat aplikasi berjalan di HTTPS / online.
    cookieSecure: process.env.COOKIE_SECURE === '1',
  },
};
