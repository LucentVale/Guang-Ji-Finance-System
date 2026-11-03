// Uji penyusun konfigurasi: folder data yang bisa dipindah (versi terpasang) dan urutan prioritas pengaturan.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/configLoader');

/** Folder app & folder data sementara; dihapus otomatis sesudah test. */
function tempDirs(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'guangji-config-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const rootDir = path.join(base, 'app');
  const dataDir = path.join(base, 'Data Saya'); // dengan spasi, seperti folder Windows sungguhan
  fs.mkdirSync(rootDir);
  fs.mkdirSync(dataDir);
  const write = (dir, value) => fs.writeFileSync(path.join(dir, 'config.local.json'), typeof value === 'string' ? value : JSON.stringify(value));
  return { rootDir, dataDir, write };
}

test('bawaan: data di app/data, login wajib, port 3000 (perilaku lama tidak berubah)', (t) => {
  const { rootDir } = tempDirs(t);
  const c = loadConfig({}, { rootDir });
  assert.equal(c.dataDir, path.join(rootDir, 'data'));
  assert.equal(c.databaseFile, path.join(rootDir, 'data', 'keuangan.db'));
  assert.equal(c.publicDir, path.join(rootDir, 'public'));
  assert.equal(c.auth.loginRequired, true);
  assert.equal(c.port, 3000);
  assert.equal(c.host, '127.0.0.1');
});

test('GUANGJI_DATA_DIR memindahkan database, dan config.local.json di folder data dibaca', (t) => {
  const { rootDir, dataDir, write } = tempDirs(t);
  write(dataDir, { loginRequired: false });
  const c = loadConfig({ GUANGJI_DATA_DIR: dataDir }, { rootDir });
  assert.equal(c.dataDir, dataDir);
  assert.equal(c.databaseFile, path.join(dataDir, 'keuangan.db'));
  assert.equal(c.auth.loginRequired, false);
});

test('urutan prioritas: env > folder data > folder app > bawaan', (t) => {
  const { rootDir, dataDir, write } = tempDirs(t);
  write(rootDir, { loginRequired: true });
  write(dataDir, { loginRequired: false });
  assert.equal(loadConfig({ GUANGJI_DATA_DIR: dataDir }, { rootDir }).auth.loginRequired, false, 'folder data menang atas folder app');
  assert.equal(loadConfig({ GUANGJI_DATA_DIR: dataDir, LOGIN_REQUIRED: '1' }, { rootDir }).auth.loginRequired, true, 'env menang atas semua');
  assert.equal(loadConfig({}, { rootDir }).auth.loginRequired, true, 'tanpa folder data: folder app');
  assert.equal(loadConfig({ GUANGJI_DATA_DIR: dataDir, DATABASE_FILE: path.join(dataDir, 'lain.db') }, { rootDir }).databaseFile, path.join(dataDir, 'lain.db'));
});

test('env kosong dianggap tidak diisi; path relatif dijadikan absolut', (t) => {
  const { rootDir } = tempDirs(t);
  const c = loadConfig({ GUANGJI_DATA_DIR: '  ', PORT: '', LOGIN_REQUIRED: '' }, { rootDir });
  assert.equal(c.dataDir, path.join(rootDir, 'data'));
  assert.equal(c.port, 3000);
  assert.equal(c.auth.loginRequired, true);
  assert.ok(path.isAbsolute(loadConfig({ GUANGJI_DATA_DIR: 'relatif' }, { rootDir }).dataDir));
});

test('config.local.json rusak menghentikan aplikasi dengan pesan yang menyebut filenya; BOM tidak dianggap rusak', (t) => {
  const { rootDir, dataDir, write } = tempDirs(t);
  write(dataDir, '{ loginRequired: false');
  assert.throws(() => loadConfig({ GUANGJI_DATA_DIR: dataDir }, { rootDir }), (err) => err.message.includes('config.local.json') && err.cause instanceof SyntaxError);
  write(dataDir, '[1, 2]');
  assert.throws(() => loadConfig({ GUANGJI_DATA_DIR: dataDir }, { rootDir }), /harus berisi objek JSON/);
  write(dataDir, '\uFEFF{ "loginRequired": false }');
  assert.equal(loadConfig({ GUANGJI_DATA_DIR: dataDir }, { rootDir }).auth.loginRequired, false);
});
