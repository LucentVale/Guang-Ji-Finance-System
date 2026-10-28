// Impor semua file mutasi bank di satu folder sekaligus, memakai alur yang sama dengan menu Mutasi.
// Pemakaian: node scripts/import-folder.js [folder] [kode-fothang] [nama-akun]
//   default: ../Bahan/Mutasi Keuangan, KUANG-HANG, BCA
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { createContext } = require('../src/context');

async function main() {
  const folder = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'Bahan', 'Mutasi Keuangan'));
  const fothangCode = process.argv[3] || 'KUANG-HANG';
  const accountName = process.argv[4] || 'BCA';

  const { repos, services } = createContext(config.databaseFile);
  const fothang = repos.fothang.list().find((f) => f.code === fothangCode);
  if (!fothang) throw new Error(`Fothang ${fothangCode} tidak ditemukan`);
  const account = repos.account.listByFothang(fothang.id).find((a) => a.name === accountName);
  if (!account) throw new Error(`Akun ${accountName} tidak ditemukan`);

  const files = fs.readdirSync(folder).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$')).sort();
  for (const file of files) {
    const upload = await services.imports.upload(fothang.id, fs.readFileSync(path.join(folder, file)), file);
    for (const sheet of upload.sheets) {
      const request = { token: upload.token, sheet: sheet.name, year: sheet.year, account_id: account.id };
      const rows = services.imports.preview(fothang.id, request);
      const result = services.imports.commit(fothang.id, request);
      const unallocated = rows.filter((r) => !r.pos_id && !r.duplicate).length;
      console.log(`${file} [${sheet.name}]: ${result.added} baru, ${result.skipped} dilewati${unallocated ? `, ${unallocated} belum dialokasikan` : ''}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
