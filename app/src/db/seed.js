// Data awal: Fothang Kuang Hang beserta akun dan pos-nya,
// diambil dari "Laporan Keuangan Kuang Hang Tahun 2026.xlsx" (sheet Tabel + saldo awal tiap sheet).

const KUANG_HANG = {
  code: 'KUANG-HANG',
  name: 'Kuang Hang Fo Thang',
  short_name: 'Kuang Hang',
  start_date: '2026-01-01',
  accounts: [
    { name: 'BCA', kind: 'bank', opening: 241293040.38, sort: 1 },
    { name: 'Kas Kecil', kind: 'cash', opening: 0, sort: 2 },
  ],
  // [nomor sheet, kode, nama, alias, saldo awal BCA, tampilkan daftar donatur]
  pos: [
    [1, 'CU THAN', 'Cu Than', 'CT', -26251492.62, true],
    [2, 'KFCC', 'Khai Fang Ci Cing', 'KHAI FANG CI CING', 1181432, false],
    [3, 'KITAB SUCI', 'Kitab Suci', 'KS', 22400000, false],
    [4, 'SSY', 'Sheng Sien Yen', 'SHENG SIEN YEN', 540008, false],
    [5, 'KOPERASI', 'Koperasi', 'KOP', 85072453, false],
    [7, 'BAKSOS', 'Bakti Sosial', 'BAKTI SOSIAL', 0, false],
    [8, 'PAT', 'Phing An Ten', 'PHING AN TEN,PAT WU AI LIU=Wu Ai Liu', 0, false],
    [9, 'BULAN KASIH', 'Bulan Kasih', 'BK', 0, false],
    [10, 'FANG SEN', 'Fang Sen', 'FANG SHEN,FS', 0, false],
    [11, 'PAC', 'Phing An Cai', 'PHING AN CAI', 0, false],
    [12, 'CHIOKO', 'Chioko', '', 0, false],
    [13, 'KELAS SXY', 'Kelas SXY', 'KELAS,SXY', 156350420, false],
    [14, 'KUPON', 'Kupon', '', 0, false],
    [20, 'ANGPAO ULTAH GJ', 'Angpao Ultah GJ ke 30', 'ANGPAO ULTAH', 2000220, false],
  ],
};

/** Isi data awal hanya jika database masih kosong. */
function seedIfEmpty(ctx) {
  if (ctx.repos.fothang.list().length > 0) return;
  const { fothang: fothangService } = ctx.services;
  const f = fothangService.create({
    code: KUANG_HANG.code,
    name: KUANG_HANG.name,
    short_name: KUANG_HANG.short_name,
    start_date: KUANG_HANG.start_date,
    accounts: KUANG_HANG.accounts,
  });
  const bca = ctx.repos.account.listByFothang(f.id).find((a) => a.name === 'BCA');
  for (const [number, code, name, aliases, opening, showDonors] of KUANG_HANG.pos) {
    ctx.services.pos.create(f.id, {
      number, code, name, aliases, show_donors: showDonors,
      openings: { [bca.id]: opening },
    });
  }
}

module.exports = { seedIfEmpty, KUANG_HANG };
