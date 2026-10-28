// Ekspor ke Excel dengan tata letak yang sama seperti file kerja manual:
//   - Laporan Keuangan Tahunan  (sheet Tabel, Barang, lalu satu sheet per pos)
//   - Draf Laporan Keuangan      (satu sheet per bulan, urutan rekening koran)
//   - Laporan Bulanan            (Bentuk Laporan Keuangan, satu sheet per bulan)
const ExcelJS = require('exceljs');
const { monthName, dayOf } = require('../lib/period');
const { buildDrafWorkbook } = require('./drafFormat');

const NUMBER_FORMAT = '#,##0.00_);[Red](#,##0.00)';
const BOLD = { bold: true };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2E6C9' } };
const MONTH_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF6E3' } };
const THIN = { style: 'thin', color: { argb: 'FF9E9E9E' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };

const safeSheetName = (name) => String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistem Keuangan Guang Ji';
  wb.created = new Date();
  return wb;
}

function setMoney(cell, value) {
  cell.value = value ?? null;
  cell.numFmt = NUMBER_FORMAT;
}

/** Judul 2 baris di atas sheet: nama Fothang dan judul laporan. */
function writeTitle(ws, lastCol, line1, line2) {
  ws.mergeCells(1, 1, 1, lastCol);
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(1, 1).value = line1.toUpperCase();
  ws.getCell(1, 1).font = { bold: true, size: 16 };
  ws.getCell(2, 1).value = line2;
  ws.getCell(2, 1).font = { bold: true, size: 12 };
  ws.getRow(1).alignment = ws.getRow(2).alignment = { horizontal: 'center' };
}

/** Header tabel dua baris: Tgl | Nama | No Kwitansi | Piao Wen | Keterangan | Masuk/Keluar/Saldo per akun. */
function writeLedgerHeader(ws, accounts) {
  const fixed = ['Tgl', 'Nama', 'No Kwitansi', 'Piao Wen', 'Keterangan'];
  fixed.forEach((label, i) => {
    ws.mergeCells(3, i + 1, 4, i + 1);
    ws.getCell(3, i + 1).value = label;
  });
  ['Masuk', 'Keluar', 'Saldo'].forEach((group, g) => {
    const start = fixed.length + 1 + g * accounts.length;
    if (accounts.length > 1) ws.mergeCells(3, start, 3, start + accounts.length - 1);
    ws.getCell(3, start).value = group;
    accounts.forEach((a, i) => (ws.getCell(4, start + i).value = a.name));
  });
  for (const r of [3, 4]) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (c) => {
      c.font = BOLD; c.fill = HEADER_FILL; c.border = BOX; c.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

function ledgerColumns(accountCount) {
  return [{ width: 6 }, { width: 46 }, { width: 12 }, { width: 10 }, { width: 22 },
    ...Array.from({ length: accountCount * 3 }, () => ({ width: 17 }))];
}

module.exports = function excelExport({ repos, services }) {
  function addTabelSheet(wb, fothangId, year) {
    const t = services.ledger.tabel(fothangId, year);
    const ws = wb.addWorksheet('Tabel');
    ws.columns = [{ width: 6 }, { width: 40 }, ...t.accounts.map(() => ({ width: 20 })), { width: 20 }];
    const lastCol = 3 + t.accounts.length;
    writeTitle(ws, lastCol, String(year), 'Rekap Saldo per Pos');
    const header = ws.addRow(['No', 'Keterangan Laporan', ...t.accounts.map((a) => a.name), 'Total']);
    header.eachCell((c) => { c.font = BOLD; c.fill = HEADER_FILL; c.border = BOX; });
    for (const r of t.rows) {
      const row = ws.addRow([r.number, `${r.name} (${r.code})`, ...t.accounts.map((a) => r.saldo[a.account_id]), r.total]);
      for (let c = 3; c <= lastCol; c++) row.getCell(c).numFmt = NUMBER_FORMAT;
    }
    const unallocated = t.accounts.reduce((s, a) => s + (a.unallocated || 0), 0);
    if (unallocated) {
      const row = ws.addRow(['', 'Belum dialokasikan', ...t.accounts.map((a) => a.unallocated), unallocated]);
      for (let c = 3; c <= lastCol; c++) row.getCell(c).numFmt = NUMBER_FORMAT;
    }
    const summary = [
      ['TOTAL POS', t.accounts.map((a) => a.total), t.total],
      ['SALDO REKENING / KAS', t.accounts.map((a) => a.actual), t.actual],
      ['SELISIH LEBIH / (KURANG) UANG', t.accounts.map((a) => a.selisih), t.selisih],
    ];
    ws.addRow([]);
    for (const [label, values, total] of summary) {
      const row = ws.addRow(['', label, ...values, total]);
      row.font = BOLD;
      for (let c = 3; c <= lastCol; c++) row.getCell(c).numFmt = NUMBER_FORMAT;
    }
  }

  function addBarangSheet(wb, fothangId, year, fothang) {
    const ws = wb.addWorksheet('Barang');
    ws.columns = [{ width: 12 }, { width: 36 }, { width: 36 }, { width: 30 }];
    writeTitle(ws, 4, fothang.name, `Donatur Barang ${year}`);
    const header = ws.addRow(['Tgl', 'Nama', 'Barang', 'Keterangan']);
    header.eachCell((c) => { c.font = BOLD; c.fill = HEADER_FILL; c.border = BOX; });
    for (const g of services.goods.list(fothangId, year)) ws.addRow([g.date.split('-').reverse().join('/'), g.name, g.item, g.note]);
  }

  function addPosSheet(wb, fothangId, pos, year, fothang) {
    const sheet = services.ledger.posSheet(fothangId, pos.id, year);
    const n = sheet.accounts.length;
    const ws = wb.addWorksheet(safeSheetName(`${pos.number} ${pos.code}`));
    ws.columns = ledgerColumns(n);
    writeTitle(ws, 5 + n * 3, fothang.name, `Laporan Keuangan ${pos.name.toUpperCase()} ${year}`);
    writeLedgerHeader(ws, sheet.accounts);

    const saldoCol = (i) => 6 + n * 2 + i;
    const openRow = ws.addRow([]);
    openRow.getCell(4).value = 'SALDO AWAL';
    openRow.font = BOLD;
    sheet.accounts.forEach((a, i) => setMoney(openRow.getCell(saldoCol(i)), a.opening));

    for (const m of sheet.months) {
      const monthRow = ws.addRow([`${monthName(m.month).toUpperCase()} ${year}`]);
      monthRow.font = BOLD;
      monthRow.fill = MONTH_FILL;
      for (const t of m.rows) {
        const row = ws.addRow([dayOf(t.date), t.sheet_name, t.receipt_no, t.piao_wen, t.note]);
        if (t.keluar) row.getCell(2).alignment = { indent: 2 };
        const i = sheet.accounts.findIndex((a) => a.id === t.account_id);
        if (t.masuk) setMoney(row.getCell(6 + i), t.masuk);
        if (t.keluar) setMoney(row.getCell(6 + n + i), t.keluar);
        setMoney(row.getCell(saldoCol(i)), t.saldo);
      }
    }
    const closeRow = ws.addRow([]);
    closeRow.getCell(4).value = 'SALDO AKHIR';
    closeRow.font = BOLD;
    sheet.accounts.forEach((a, i) => setMoney(closeRow.getCell(saldoCol(i)), a.closing));
  }

  return {
    async annualWorkbook(fothangId, year) {
      const fothang = repos.fothang.findById(fothangId);
      const wb = newWorkbook();
      addTabelSheet(wb, fothangId, year);
      addBarangSheet(wb, fothangId, year, fothang);
      for (const pos of services.pos.list(fothangId)) addPosSheet(wb, fothangId, pos, year, fothang);
      return Buffer.from(await wb.xlsx.writeBuffer());
    },

    /**
     * File DRAF dengan tata letak persis file manual (lihat drafFormat.js):
     * satu sheet per bulan 1..lastMonth, masing-masing kumulatif sejak Januari.
     */
    async draftWorkbook(fothangId, accountId, year, lastMonth) {
      const fothang = repos.fothang.findById(fothangId);
      const months = [];
      for (let m = 1; m <= lastMonth; m++) months.push({ month: m, ...services.ledger.draf(fothangId, accountId, year, m) });
      return buildDrafWorkbook({
        orgName: fothang.name,
        accountName: months[0].account.name,
        year,
        opening: months[0].opening,
        months,
        lastMonth,
      });
    },

    async monthlyReportWorkbook(fothangId, year, months) {
      const wb = newWorkbook();
      for (const month of months) {
        const rep = services.report.monthly(fothangId, year, month);
        const ws = wb.addWorksheet(`${rep.month_name} ${year}`);
        ws.columns = [{ width: 4 }, { width: 46 }, { width: 18 }, { width: 4 }, { width: 20 }, { width: 4 }];
        const period = `${rep.month_name} ${year}`;
        let r = 1;
        const put = (row, col, value, bold = false) => {
          const cell = ws.getCell(row, col);
          if (typeof value === 'number' || value?.formula) setMoney(cell, value); else cell.value = value;
          if (bold) cell.font = BOLD;
          return cell;
        };
        const lines = (items) => {
          const start = r;
          for (const l of items) { put(r, 2, l.label); put(r, 3, l.amount); r++; }
          if (!items.length) r++;
          ws.getCell(r - 1, 3).border = { bottom: THIN };
          put(r, 4, '+'); r++;
          return { start, end: r - 2 };
        };

        for (const b of rep.blocks) {
          ws.mergeCells(r, 1, r, 5);
          put(r, 1, `Laporan Keuangan ${b.pos.name.toUpperCase()} ${rep.fothang.short_name}`, true).alignment = { horizontal: 'center' };
          ws.mergeCells(r + 1, 1, r + 1, 5);
          put(r + 1, 1, `Per ${period}`, true).alignment = { horizontal: 'center' };
          r += 2;
          const openRow = r;
          put(r, 1, `Saldo Awal ${period}`, true); put(r, 5, b.opening, true); r++;
          put(r, 1, 'Pemasukan :', true); r++;
          const inc = lines(b.income);
          const inRow = r;
          put(r, 1, 'Total Pemasukan', true); put(r, 5, { formula: `SUM(C${inc.start}:C${inc.end})`, result: b.total_in }, true); r += 2;
          put(r, 1, 'Pengeluaran :', true); r++;
          const exp = lines(b.expense);
          const outRow = r;
          put(r, 1, 'Total Pengeluaran', true); put(r, 5, { formula: `SUM(C${exp.start}:C${exp.end})`, result: b.total_out }, true).border = { bottom: THIN };
          put(r, 6, '-'); r++;
          put(r, 1, `Saldo Akhir ${period}`, true); put(r, 5, { formula: `E${openRow}+E${inRow}-E${outRow}`, result: b.closing }, true);
          r += 4;
          if (b.donors.length) {
            put(r, 1, `Daftar Donatur ${b.pos.name.toUpperCase()} ${year}`, true); r++;
            const d = lines(b.donors.map((x) => ({ label: x.name, amount: x.amount })));
            put(r, 5, { formula: `SUM(C${d.start}:C${d.end})`, result: b.donors_total }, true);
            r += 4;
          }
        }
        if (!rep.blocks.length) put(1, 1, `Belum ada transaksi untuk ${period}`);
        ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
      }
      return Buffer.from(await wb.xlsx.writeBuffer());
    },

    async transactionsWorkbook(rows) {
      const wb = newWorkbook();
      const ws = wb.addWorksheet('Transaksi');
      ws.columns = [
        { header: 'Tanggal', key: 'date', width: 12 }, { header: 'Akun', key: 'account', width: 10 },
        { header: 'Pos', key: 'pos', width: 16 }, { header: 'Kategori', key: 'category', width: 18 },
        { header: 'Nama / Uraian', key: 'name', width: 40 }, { header: 'Masuk', key: 'masuk', width: 16 },
        { header: 'Keluar', key: 'keluar', width: 16 }, { header: 'No Kwitansi', key: 'receipt_no', width: 12 },
        { header: 'Piao Wen', key: 'piao_wen', width: 10 }, { header: 'Keterangan', key: 'note', width: 24 },
        { header: 'Sumber', key: 'source', width: 10 }, { header: 'Kode Mutasi', key: 'bank_code', width: 40 },
      ];
      ws.getRow(1).font = BOLD;
      for (const t of rows) {
        const row = ws.addRow({ ...t, masuk: t.masuk || null, keluar: t.keluar || null });
        row.getCell('masuk').numFmt = row.getCell('keluar').numFmt = NUMBER_FORMAT;
      }
      ws.autoFilter = { from: 'A1', to: 'L1' };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      return Buffer.from(await wb.xlsx.writeBuffer());
    },
  };
};
