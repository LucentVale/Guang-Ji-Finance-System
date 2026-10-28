// Impor data dalam 3 langkah: upload -> preview (periksa & alokasikan) -> commit.
// Dua jenis file:
//   - Mutasi bank (rekening koran): baris baru ditambahkan, baris yang sudah pernah diimpor dilewati.
//   - File DRAF Laporan Keuangan: data bulan yang dipilih DIGANTI seluruhnya dengan isi file.
// File yang di-upload disimpan sementara di memori. Saat commit, file dibaca ULANG di server,
// jadi tanggal & nominal tidak bisa diubah dari browser; yang dikirim hanya koreksi alokasi.

const crypto = require('node:crypto');
const { inTransaction } = require('../db/connection');
const { badRequest } = require('../lib/errors');
const { toCents, toRupiah, sumCents } = require('../lib/money');
const { assertYear, monthRange, assertMonth } = require('../lib/period');
const { clean, upper } = require('../lib/text');
const parser = require('./mutasiParser');
const { parseDrafSheet } = require('./drafFormat');
const { classify, buildAliasIndex } = require('./classifier');
const { assertOwned } = require('./guards');

const UPLOAD_TTL_MS = 60 * 60 * 1000;

module.exports = function importService({ db, repos, services }) {
  const uploads = new Map(); // token -> { fothangId, workbook, fileName, createdAt }

  function forgetExpired() {
    for (const [token, u] of uploads) if (Date.now() - u.createdAt > UPLOAD_TTL_MS) uploads.delete(token);
  }

  function getUpload(fothangId, token) {
    const u = uploads.get(token);
    if (!u || u.fothangId !== fothangId) throw badRequest('Sesi upload sudah kedaluwarsa, silakan upload ulang file-nya');
    return u;
  }

  function bankAccount(fothangId, accountId) {
    const account = assertOwned(repos.account.findById(Number(accountId)), fothangId, 'Akun');
    if (account.kind !== 'bank') throw badRequest('Mutasi hanya bisa diimpor ke akun bank');
    return account;
  }

  /** Baca sheet lalu klasifikasikan setiap baris ke pos. */
  function classifiedRows(fothangId, upload, sheetName, year, accountId) {
    const worksheet = upload.workbook.getWorksheet(sheetName);
    if (!worksheet) throw badRequest(`Sheet "${sheetName}" tidak ditemukan`);
    const aliasIndex = buildAliasIndex(repos.pos.listByFothang(fothangId, { includeInactive: true }));
    let previousBalance = null;
    return parser.parseSheet(worksheet, assertYear(year)).map((row) => {
      // Cek rantai saldo rekening koran: saldo sebelumnya + nominal = saldo baris ini.
      const chainOk = previousBalance == null || row.balance_cents == null || previousBalance + row.amount_cents === row.balance_cents;
      previousBalance = row.balance_cents ?? previousBalance;
      return {
        ...row,
        ...classify(row, aliasIndex),
        duplicate: repos.transaction.dedupeExists(accountId, row.dedupe_key),
        chain_ok: chainOk,
      };
    });
  }

  /** Baca sheet DRAF lalu klasifikasikan setiap baris ke pos (dengan aturan yang sama seperti mutasi). */
  function drafRows(fothangId, upload, sheetName) {
    const worksheet = upload.workbook.getWorksheet(sheetName);
    if (!worksheet) throw badRequest(`Sheet "${sheetName}" tidak ditemukan`);
    let parsed;
    try { parsed = parseDrafSheet(worksheet); } catch (err) { throw badRequest(err.message); }
    if (!parsed.year) throw badRequest('Tahun tidak ditemukan di judul sheet (mis. "DRAFT Laporan Keuangan CU THAN 2026")');

    const aliasIndex = buildAliasIndex(repos.pos.listByFothang(fothangId, { includeInactive: true }));
    const rows = parsed.rows.map((r, i) => {
      const amountCents = toCents(r.masuk) - toCents(r.keluar);
      const code = r.pos_text ? `${r.pos_text} ; ${r.keterangan}` : r.keterangan;
      const { split: _alreadySplitInDraf, ...cls } = classify({ bank_code: code, bank_type: '', amount_cents: amountCents }, aliasIndex);
      return {
        seq: i + 1, row: r.row, month: r.month, date: r.date, day_assumed: r.day_assumed, amount_cents: amountCents, bank_code: code,
        receipt_no: r.receipt_no, piao_wen: r.piao_wen, note: r.note, ...cls,
      };
    });
    return { ...parsed, rows: rows.filter((r) => r.amount_cents !== 0) };
  }

  function drafAccount(fothangId, accountId) {
    return assertOwned(repos.account.findById(Number(accountId)), fothangId, 'Akun');
  }

  return {
    async upload(fothangId, buffer, fileName) {
      forgetExpired();
      let workbook;
      try { workbook = await parser.readWorkbook(buffer); } catch {
        throw badRequest('File tidak bisa dibaca. Pastikan formatnya Excel .xlsx');
      }
      const token = crypto.randomUUID();
      uploads.set(token, { fothangId, workbook, fileName, createdAt: Date.now() });
      return { token, file_name: fileName, sheets: parser.listSheets(workbook, fileName) };
    },

    preview(fothangId, { token, sheet, year, account_id: accountId }) {
      bankAccount(fothangId, accountId);
      return classifiedRows(fothangId, getUpload(fothangId, token), sheet, year, Number(accountId));
    },

    /**
     * overrides: { [seq]: { pos_id, category, name } } — koreksi alokasi dari layar preview.
     * Mengembalikan jumlah baris yang tersimpan dan yang dilewati (sudah pernah diimpor).
     */
    commit(fothangId, { token, sheet, year, account_id: accountId, overrides = {} }) {
      const account = bankAccount(fothangId, accountId);
      const rows = classifiedRows(fothangId, getUpload(fothangId, token), sheet, year, account.id);
      const posIds = new Set(repos.pos.listByFothang(fothangId, { includeInactive: true }).map((p) => p.id));

      let added = 0;
      inTransaction(db, () => {
        for (const row of rows) {
          const fix = overrides[row.seq] || {};
          const posId = 'pos_id' in fix ? Number(fix.pos_id) || null : row.pos_id;
          if (posId && !posIds.has(posId)) throw badRequest(`Pos tidak valid pada baris ${row.seq}`);
          const id = repos.transaction.insertIfNew({
            ...row,
            fothang_id: fothangId,
            account_id: account.id,
            pos_id: posId,
            category: 'category' in fix ? upper(fix.category) : row.category,
            name: 'name' in fix ? clean(fix.name) : row.name,
            source: 'mutasi',
          });
          if (!id) continue;
          added++;
          // Kode seperti "SHERLY THE (500K) KFCC": bagian tersebut langsung dipecah ke pos tujuannya.
          if (row.split && posId && row.split.pos_id !== posId) {
            services.transaction.split(fothangId, id, {
              amount: row.split.amount_cents / 100, pos_id: row.split.pos_id,
              category: 'category' in fix ? fix.category : row.category, name: 'name' in fix ? fix.name : row.name,
            });
          }
        }
      });
      return { added, skipped: rows.length - added };
    },

    /**
     * Preview file DRAF: ringkasan per bulan (berapa baris, total, data yang sudah ada & akan diganti)
     * serta pemeriksaan saldo awal file vs aplikasi.
     */
    previewDraf(fothangId, { token, sheet, account_id: accountId }) {
      const fothang = repos.fothang.findById(fothangId);
      const account = drafAccount(fothangId, accountId);
      const parsed = drafRows(fothangId, getUpload(fothangId, token), sheet);
      const openingApp = services.balance.accountBalance(account, fothang.start_date, `${parsed.year}-01-01`);

      const months = [...new Set(parsed.rows.map((r) => r.month))].map((month) => {
        const rows = parsed.rows.filter((r) => r.month === month);
        const { from, to } = monthRange(parsed.year, month);
        return {
          month,
          count: rows.length,
          masuk: toRupiah(sumCents(rows.filter((r) => r.amount_cents > 0))),
          keluar: toRupiah(-sumCents(rows.filter((r) => r.amount_cents < 0))),
          existing: repos.transaction.countBySource(account.id, from, to),
        };
      });

      return {
        year: parsed.year,
        layout: parsed.layout,
        opening_file: parsed.opening,
        opening_app: toRupiah(openingApp),
        months,
        rows: parsed.rows,
      };
    },

    /**
     * Simpan isi file DRAF untuk bulan-bulan yang dipilih. Semua baris akun itu di bulan tersebut
     * (dari mutasi, DRAF, atau input manual) diganti; pindahan antar pos tidak disentuh.
     * overrides: { [seq]: { pos_id, category, name } }
     */
    commitDraf(fothangId, { token, sheet, account_id: accountId, months = [], overrides = {} }) {
      const account = drafAccount(fothangId, accountId);
      const parsed = drafRows(fothangId, getUpload(fothangId, token), sheet);
      const chosen = new Set(months.map(assertMonth));
      if (!chosen.size) throw badRequest('Pilih minimal satu bulan yang akan diimpor');
      const posIds = new Set(repos.pos.listByFothang(fothangId, { includeInactive: true }).map((p) => p.id));

      let replaced = 0;
      let added = 0;
      inTransaction(db, () => {
        for (const month of chosen) {
          const { from, to } = monthRange(parsed.year, month);
          replaced += repos.transaction.deleteForAccountPeriod(account.id, from, to);
        }
        for (const row of parsed.rows.filter((r) => chosen.has(r.month))) {
          const fix = overrides[row.seq] || {};
          const posId = 'pos_id' in fix ? Number(fix.pos_id) || null : row.pos_id;
          if (posId && !posIds.has(posId)) throw badRequest(`Pos tidak valid pada baris ${row.row}`);
          repos.transaction.insert({
            fothang_id: fothangId,
            account_id: account.id,
            pos_id: posId,
            date: row.date,
            category: 'category' in fix ? upper(fix.category) : row.category,
            name: 'name' in fix ? clean(fix.name) : row.name,
            amount_cents: row.amount_cents,
            receipt_no: row.receipt_no,
            piao_wen: row.piao_wen,
            note: row.note,
            source: 'draf',
            bank_code: row.bank_code,
            seq: row.seq,
          });
          added++;
        }
      });
      return { added, replaced, months: [...chosen].sort((a, b) => a - b) };
    },
  };
};
