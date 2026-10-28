// Alat bantu pengujian: database sementara di memori dan file mutasi buatan.
const ExcelJS = require('exceljs');
const { createContext } = require('../src/context');

/** Konteks aplikasi dengan database kosong di memori: 1 Fothang, akun BCA, pos CU THAN & KFCC. */
function createTestContext() {
  const ctx = createContext(':memory:', { seed: false });
  const fothang = ctx.services.fothang.create({
    code: 'UJI', name: 'Uji Fo Thang', start_date: '2026-01-01',
    accounts: [{ name: 'BCA', kind: 'bank', opening: 1000 }],
  });
  const bca = ctx.repos.account.listByFothang(fothang.id)[0];
  const cuThan = ctx.services.pos.create(fothang.id, { number: 1, code: 'CU THAN', name: 'Cu Than', openings: { [bca.id]: 600 } });
  const kfcc = ctx.services.pos.create(fothang.id, { number: 2, code: 'KFCC', name: 'Khai Fang Ci Cing', openings: { [bca.id]: 400 } });
  return { ctx, fothangId: fothang.id, bcaId: bca.id, cuThanId: cuThan, kfccId: kfcc };
}

/**
 * Buat file .xlsx berformat rekening koran BCA.
 * rows: [tanggal 'dd/mm', jenis, kode kolom C, nominal 'x CR/DB', saldo, ...baris keterangan tambahan]
 */
async function makeMutasiFile(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Jan 26');
  for (const [date, type, code, amount, balance, ...extra] of rows) {
    ws.addRow([date, type, code, amount, balance]);
    for (const line of extra) ws.addRow([null, line]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { createTestContext, makeMutasiFile };
