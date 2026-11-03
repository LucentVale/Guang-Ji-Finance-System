// Membuat installer Windows: dist/SistemKeuanganGuangJi-Setup-<versi>.exe
//
//   npm run build:installer                 (lengkap: validasi -> staging -> Inno Setup)
//   npm run build:installer -- --skip-check   lewati npm run check (hanya untuk mencoba-coba)
//   npm run build:installer -- --keep-staging biarkan folder dist/staging untuk diperiksa
//
// Langkah:
//   1. npm run check (ESLint + test) harus lulus
//   2. salin program ke dist/staging/app (tanpa test, data, alat pengembang)
//   3. npm ci --omit=dev di staging (hanya komponen yang dipakai aplikasi)
//   4. salin node.exe yang sedang menjalankan skrip ini ke dist/staging/runtime (harus Node 24, Windows x64)
//   5. salinan konsisten database (VACUUM INTO) + config.local.json tanpa login -> dist/staging/seed
//   6. kompilasi installer/guangji.iss dengan Inno Setup (ISCC)
//
// PERHATIAN: installer berisi DATA KEUANGAN (langkah 5). Folder dist/ ada di .gitignore; jangan sebar file installer.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const APP_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(APP_DIR, '..', 'dist');
const STAGING = path.join(DIST_DIR, 'staging');
const ISS_FILE = path.join(APP_DIR, 'installer', 'guangji.iss');
const SOURCE_DB = path.join(APP_DIR, 'data', 'keuangan.db');
const REQUIRED_NODE_MAJOR = 24;

/** Isi program yang ikut ke installer (relatif ke folder app). Selain ini (test, data, scripts, ...) tidak ikut. */
const APP_ENTRIES = ['server.js', 'package.json', 'package-lock.json', 'src', 'public'];
/** File di app/desktop yang dibutuhkan versi terpasang (ikon Desktop dibuat oleh installer, bukan skrip "Pasang Ikon"). */
const DESKTOP_FILES = ['Buka Sistem Keuangan.vbs', 'Matikan Server.vbs', 'guang-ji.ico'];

const args = new Set(process.argv.slice(2));

class BuildError extends Error {}

function step(n, text) {
  console.log(`\n[${n}/6] ${text}`);
}

/** Jalankan perintah tanpa shell (argumen tidak ditafsirkan ulang); gagal = hentikan build. */
function run(command, commandArgs, { cwd = APP_DIR } = {}) {
  const result = spawnSync(command, commandArgs, { cwd, stdio: 'inherit' });
  if (result.error) throw new BuildError(`Tidak bisa menjalankan ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new BuildError(`${path.basename(command)} ${commandArgs.join(' ')} gagal (kode ${result.status})`);
}

/**
 * npm di Windows adalah file .cmd (butuh shell), jadi skrip npm-cli.js dijalankan langsung lewat Node:
 * npm_execpath diisi otomatis saat dijalankan lewat `npm run`; selain itu pakai npm bawaan instalasi Node.
 */
function npm(commandArgs, options) {
  const cli = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(cli)) throw new BuildError(`npm tidak ditemukan (${cli})`);
  run(process.execPath, [cli, ...commandArgs], options);
}

function readVersion() {
  const { version } = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new BuildError(`Versi di package.json tidak valid: "${version}" (contoh: 1.0.0)`);
  return version;
}

function checkRuntime() {
  const major = Number(process.versions.node.split('.')[0]);
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new BuildError(`Installer harus dibuat di Windows 64-bit (sekarang ${process.platform}/${process.arch}).`);
  if (major !== REQUIRED_NODE_MAJOR) throw new BuildError(`Butuh Node ${REQUIRED_NODE_MAJOR} (node:sqlite), sekarang ${process.version}.`);
}

/** Cari ISCC.exe: variabel ISCC_PATH, lalu lokasi pemasangan Inno Setup 6 yang umum. */
function findIscc() {
  const candidates = [
    process.env.ISCC_PATH,
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new BuildError('Inno Setup 6 tidak ditemukan. Pasang dengan: winget install --id JRSoftware.InnoSetup -e --scope user (atau isi ISCC_PATH).');
  return found;
}

function copyProgram() {
  const appOut = path.join(STAGING, 'app');
  for (const entry of APP_ENTRIES) {
    const from = path.join(APP_DIR, entry);
    if (!fs.existsSync(from)) throw new BuildError(`File program tidak ada: ${entry}`);
    fs.cpSync(from, path.join(appOut, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(appOut, 'desktop'), { recursive: true });
  for (const file of DESKTOP_FILES) fs.copyFileSync(path.join(APP_DIR, 'desktop', file), path.join(appOut, 'desktop', file));
  // Pengaturan khusus komputer pembuat (mis. loginRequired) TIDAK boleh ikut sebagai bagian program.
  if (fs.existsSync(path.join(appOut, 'config.local.json'))) throw new BuildError('config.local.json ikut tersalin ke program');
}

function copyRuntime() {
  const runtimeOut = path.join(STAGING, 'runtime');
  fs.mkdirSync(runtimeOut, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(runtimeOut, 'node.exe'));
  fs.writeFileSync(path.join(runtimeOut, 'NODE-LICENSE.txt'), [
    `node.exe di folder ini adalah Node.js ${process.version} (win-x64), https://nodejs.org`,
    'Node.js dirilis dengan lisensi MIT; lisensi lengkap Node.js dan komponen di dalamnya:',
    `https://github.com/nodejs/node/blob/${process.version}/LICENSE`,
    '',
  ].join('\r\n'));
}

/** Salinan konsisten database asli (termasuk isi file -wal) + pemeriksaan keutuhan. */
function snapshotData() {
  if (!fs.existsSync(SOURCE_DB)) throw new BuildError(`Database tidak ditemukan: ${SOURCE_DB}`);
  const seedDir = path.join(STAGING, 'seed');
  fs.mkdirSync(seedDir, { recursive: true });
  const target = path.join(seedDir, 'keuangan.db');
  const source = new DatabaseSync(SOURCE_DB, { readOnly: true });
  try {
    source.prepare('VACUUM INTO ?').run(target);
  } finally {
    source.close();
  }
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    const integrity = copy.prepare('PRAGMA integrity_check').get();
    if (Object.values(integrity)[0] !== 'ok') throw new BuildError(`Salinan database rusak: ${JSON.stringify(integrity)}`);
    const count = (table) => copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const stats = { fothang: count('fothang'), pos: count('pos'), transaksi: count('transactions') };
    if (!stats.fothang) throw new BuildError('Salinan database tidak berisi Fothang');
    console.log(`    data: ${stats.fothang} Fothang, ${stats.pos} pos, ${stats.transaksi} transaksi`);
  } finally {
    copy.close();
  }
  // Komputer lain dipakai tanpa login (sesuai keputusan pengguna); server tetap hanya bisa dibuka dari komputer itu sendiri.
  fs.writeFileSync(path.join(seedDir, 'config.local.json'), `${JSON.stringify({ loginRequired: false }, null, 2)}\n`);
}

function main() {
  checkRuntime();
  const version = readVersion();
  const iscc = findIscc();
  console.log(`Membuat installer Sistem Keuangan Guang Ji ${version} (Node ${process.version})`);

  step(1, 'Validasi kode (npm run check)');
  if (args.has('--skip-check')) console.log('    DILEWATI (--skip-check)');
  else npm(['run', 'check']);

  step(2, 'Menyalin program ke dist/staging');
  fs.rmSync(STAGING, { recursive: true, force: true });
  copyProgram();

  step(3, 'Memasang komponen produksi (npm ci --omit=dev)');
  npm(['ci', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error'], { cwd: path.join(STAGING, 'app') });
  if (fs.existsSync(path.join(STAGING, 'app', 'node_modules', 'eslint'))) throw new BuildError('ESLint ikut terpasang; seharusnya tidak');

  step(4, 'Menyalin Node.js bawaan');
  copyRuntime();

  step(5, 'Menyalin data keuangan (VACUUM INTO)');
  snapshotData();

  step(6, 'Mengompilasi installer (Inno Setup)');
  fs.mkdirSync(DIST_DIR, { recursive: true });
  run(iscc, ['/Q', `/DAppVersion=${version}`, `/DStagingDir=${STAGING}`, `/DOutputDir=${DIST_DIR}`, ISS_FILE]);

  const output = path.join(DIST_DIR, `SistemKeuanganGuangJi-Setup-${version}.exe`);
  if (!fs.existsSync(output)) throw new BuildError(`Inno Setup selesai, tetapi ${output} tidak ada`);
  if (!args.has('--keep-staging')) fs.rmSync(STAGING, { recursive: true, force: true });

  const mb = (fs.statSync(output).size / 1024 / 1024).toFixed(1);
  console.log(`\nSELESAI: ${output} (${mb} MB)`);
  console.log('PERHATIAN: file ini berisi data keuangan. Simpan & bagikan seperti dokumen rahasia; jangan diunggah ke internet.');
}

try {
  main();
} catch (err) {
  console.error(`\nGAGAL: ${err.message}`);
  if (!(err instanceof BuildError)) console.error(err.stack);
  process.exitCode = 1;
}
