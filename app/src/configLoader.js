// Penyusun konfigurasi aplikasi (dipisah dari config.js supaya bisa diuji dengan env & folder buatan).
//
// Urutan prioritas:  environment variable  >  config.local.json di FOLDER DATA  >  config.local.json di folder app  >  bawaan.
//
// Folder data = tempat database, cadangan, dan catatan server:
//   - GUANGJI_DATA_DIR bila diisi (versi terpasang lewat installer: %LOCALAPPDATA%\Guang Ji\Sistem Keuangan)
//   - selain itu app/data (cara kerja di komputer pengembang, seperti sebelumnya)
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_CONFIG_NAME = 'config.local.json';

/**
 * Baca config.local.json (mis. { "loginRequired": false }). Tidak wajib ada; isi yang rusak menghentikan aplikasi
 * dengan pesan yang menyebut nama filenya (lebih baik gagal jelas daripada diam-diam memakai pengaturan bawaan).
 */
function readLocalConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`File ${file} tidak bisa dibaca: ${err.message}`, { cause: err });
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, '')); // BOM dari Notepad lama tidak dianggap rusak
  } catch (err) {
    throw new Error(`File ${file} tidak valid: ${err.message}`, { cause: err });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`File ${file} harus berisi objek JSON, mis. { "loginRequired": false }`);
  return parsed;
}

/** Nilai env yang kosong ("" atau hanya spasi) dianggap tidak diisi. */
const envValue = (env, name) => (typeof env[name] === 'string' && env[name].trim() !== '' ? env[name].trim() : undefined);
const envFlag = (env, name) => (envValue(env, name) === undefined ? undefined : envValue(env, name) === '1');

/**
 * @param {Record<string, string|undefined>} env biasanya process.env
 * @param {{rootDir: string}} options rootDir = folder app (berisi server.js, public/, data/)
 */
function loadConfig(env, { rootDir }) {
  const dataDir = path.resolve(envValue(env, 'GUANGJI_DATA_DIR') ?? path.join(rootDir, 'data'));
  const local = {
    ...readLocalConfig(path.join(rootDir, LOCAL_CONFIG_NAME)),
    ...(dataDir === path.join(rootDir, 'data') ? {} : readLocalConfig(path.join(dataDir, LOCAL_CONFIG_NAME))),
  };

  return {
    port: Number(envValue(env, 'PORT') ?? 3000),
    host: envValue(env, 'HOST') ?? '127.0.0.1',
    dataDir,
    databaseFile: path.resolve(envValue(env, 'DATABASE_FILE') ?? path.join(dataDir, 'keuangan.db')),
    publicDir: path.join(rootDir, 'public'),
    maxUploadBytes: 25 * 1024 * 1024,

    auth: {
      // false = mode tanpa login (hanya untuk pemakaian di komputer ini; server menolak berjalan tanpa login bila bisa diakses dari luar).
      loginRequired: envFlag(env, 'LOGIN_REQUIRED') ?? local.loginRequired ?? true,
      sessionIdleMinutes: Number(envValue(env, 'SESSION_IDLE_MINUTES') ?? 120), // keluar otomatis bila tidak aktif
      sessionMaxHours: Number(envValue(env, 'SESSION_MAX_HOURS') ?? 12),       // batas mutlak satu sesi
      maxFailedLogins: 5,                                                         // salah kata sandi sebanyak ini -> dikunci
      lockMinutes: 15,
      // Aktifkan (COOKIE_SECURE=1) saat aplikasi berjalan di HTTPS / online.
      cookieSecure: envValue(env, 'COOKIE_SECURE') === '1',
    },
  };
}

module.exports = { loadConfig, LOCAL_CONFIG_NAME };
