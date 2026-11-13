// Impor data dalam 3 langkah: upload -> preview (periksa & alokasikan) -> commit.
// Tiga jenis file:
//   - Mutasi bank (rekening koran): baris baru ditambahkan, baris yang sudah pernah diimpor dilewati.
//   - File DRAF Laporan Keuangan: data bulan yang dipilih DIGANTI seluruhnya dengan isi file.
//   - Template Data (bentuk seragam semua vihara): sama seperti DRAF, tetapi akun ditentukan per baris.
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
const { parseTemplateSheet, findTemplateSheet, parseOpeningsSheet } = require('./templateFormat');
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

  /**
   * Baca Template Data lalu cocokkan Akun & Pos dengan data Fothang.
   *   Akun: nama akun (huruf besar/kecil bebas); boleh kosong bila Fothang hanya punya satu akun.
   *   Pos : kode, nama, atau kata kunci pos (alias "PAT WU AI LIU=Wu Ai Liu" sekaligus mengisi kategori bila kosong).
   * Pos yang tidak dikenal tidak menggagalkan impor (bisa dipilih di pratinjau); akun yang tidak dikenal
   * dan baris yang salah isi menjadi `errors`, dan selama masih ada `errors` file tidak bisa disimpan.
   */
  function templateRows(fothangId, upload) {
    const worksheet = findTemplateSheet(upload.workbook);
    if (!worksheet) throw badRequest('File ini bukan Template Data (judul kolom Tanggal, Pos, Masuk/Keluar tidak ditemukan)');
    const parsed = parseTemplateSheet(worksheet);

    const accounts = repos.account.listByFothang(fothangId);
    const accountByName = new Map(accounts.map((a) => [upper(a.name), a]));
    const allPos = repos.pos.listByFothang(fothangId, { includeInactive: true });
    const aliasIndex = buildAliasIndex(allPos);
    for (const p of allPos) if (!aliasIndex.has(upper(p.name))) aliasIndex.set(upper(p.name), { posId: p.id, category: '' });

    const errors = [...parsed.errors];
    const rows = [];
    parsed.rows.forEach((r, i) => {
      const account = r.account ? accountByName.get(upper(r.account)) : accounts.length === 1 ? accounts[0] : null;
      if (!account) {
        errors.push({ row: r.row, message: r.account ? `akun "${r.account}" tidak ada di Fothang ini` : 'kolom Akun kosong (Fothang ini punya lebih dari satu akun)' });
        return;
      }
      const hit = r.pos ? aliasIndex.get(upper(r.pos)) : null;
      rows.push({
        ...r,
        seq: i + 1,
        month: Number(r.date.slice(5, 7)),
        account_id: account.id,
        account: account.name,
        pos_id: hit?.posId ?? null,
        pos_unknown: !hit,
        category: r.category || hit?.category || '',
        amount_cents: toCents(r.masuk) - toCents(r.keluar),
        balance_cents: r.saldo_bank == null ? null : toCents(r.saldo_bank),
      });
    });
    errors.sort((a, b) => a.row - b.row);
    return { sheet: worksheet.name, rows, errors };
  }

  /**
   * Sheet Saldo Awal Template Data (null bila tidak ada): dicocokkan dengan pos & akun Fothang,
   * lalu dibandingkan dengan saldo awal sekarang. Hanya nilai yang BERBEDA yang masuk `changes`.
   * Pos & akun harus sudah ada (ditambahkan di Pengaturan); yang tidak dikenal menjadi `errors`.
   */
  function templateOpenings(fothangId, upload) {
    const sheet = parseOpeningsSheet(upload.workbook);
    if (!sheet) return null;
    const fothang = repos.fothang.findById(fothangId);
    const errors = [...sheet.errors];
    const accounts = repos.account.listByFothang(fothangId);
    const accountByName = new Map(accounts.map((a) => [upper(a.name), a]));
    const columns = sheet.accounts.map((name) => {
      const account = accountByName.get(upper(name));
      if (!account) errors.push({ row: 0, message: `kolom akun "${name}" tidak ada di Fothang ini` });
      return account || null;
    });
    const allPos = repos.pos.listByFothang(fothangId, { includeInactive: true });
    const posByKey = new Map();
    for (const p of allPos) for (const key of [p.code, p.name]) if (!posByKey.has(upper(key))) posByKey.set(upper(key), p);
    const current = new Map(repos.pos.openingsByFothang(fothangId).map((o) => [`${o.pos_id}:${o.account_id}`, o.amount_cents]));

    const changes = [];
    const seen = new Set();
    const posCents = new Map(accounts.map((a) => [a.id, allPos.reduce((s, p) => s + (current.get(`${p.id}:${a.id}`) || 0), 0)]));
    for (const r of sheet.rows) {
      const pos = posByKey.get(upper(r.pos));
      if (!pos) { errors.push({ row: r.row, message: `pos "${r.pos}" tidak ada — tambahkan dulu di Pengaturan` }); continue; }
      if (seen.has(pos.id)) { errors.push({ row: r.row, message: `pos "${r.pos}" tertulis dua kali` }); continue; }
      seen.add(pos.id);
      columns.forEach((account, j) => {
        if (!account) return;
        const before = current.get(`${pos.id}:${account.id}`) || 0;
        const after = toCents(r.values[j]);
        posCents.set(account.id, posCents.get(account.id) - before + after);
        if (before !== after) changes.push({ pos_id: pos.id, pos: pos.code, account_id: account.id, account: account.name, before: toRupiah(before), after: toRupiah(after) });
      });
    }
    const accountChanges = [];
    const accountCents = new Map(accounts.map((a) => [a.id, a.opening_cents]));
    if (sheet.account_openings) {
      columns.forEach((account, j) => {
        if (!account) return;
        const after = toCents(sheet.account_openings[j]);
        accountCents.set(account.id, after);
        if (after !== account.opening_cents) accountChanges.push({ account_id: account.id, account: account.name, before: toRupiah(account.opening_cents), after: toRupiah(after) });
      });
    }
    // Sesudah diterapkan: jumlah saldo awal pos per akun vs saldo awal akun (harus sama agar Cek Saldo lolos).
    const totals = accounts.map((a) => ({
      account_id: a.id, account: a.name, pos_total: toRupiah(posCents.get(a.id)), account_opening: toRupiah(accountCents.get(a.id)),
      diff: toRupiah(posCents.get(a.id) - accountCents.get(a.id)),
    }));
    errors.sort((a, b) => a.row - b.row);
    return { start_date: fothang.start_date, changes, account_changes: accountChanges, totals, errors };
  }

  /** "2026-10" dari tanggal ISO; kunci bulan untuk Template Data (file boleh berisi lebih dari satu tahun). */
  const monthKey = (date) => date.slice(0, 7);
  const rangeOfKey = (key) => monthRange(Number(key.slice(0, 4)), Number(key.slice(5, 7)));

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
      // is_template: file ini Template Data (bukan file DRAF / mutasi), supaya layar impor bisa memilih alurnya sendiri.
      return { token, file_name: fileName, sheets: parser.listSheets(workbook, fileName), is_template: !!findTemplateSheet(workbook) };
    },

    preview(fothangId, { token, sheet, year, account_id: accountId }) {
      bankAccount(fothangId, accountId);
      return classifiedRows(fothangId, getUpload(fothangId, token), sheet, year, Number(accountId));
    },

    /**
     * overrides: { [seq]: { pos_id, category, name } } — koreksi alokasi dari layar preview.
     * exclude: [seq] — baris yang sengaja tidak disimpan (dipilih "Lewati" di preview). Tidak diingat:
     * bila file yang sama diimpor ulang, baris itu muncul lagi sebagai baris baru.
     * Mengembalikan jumlah baris yang tersimpan, yang dilewati karena sudah pernah diimpor (skipped),
     * dan yang sengaja tidak disimpan (excluded).
     */
    commit(fothangId, { token, sheet, year, account_id: accountId, overrides = {}, exclude = [] }) {
      const account = bankAccount(fothangId, accountId);
      const rows = classifiedRows(fothangId, getUpload(fothangId, token), sheet, year, account.id);
      const posIds = new Set(repos.pos.listByFothang(fothangId, { includeInactive: true }).map((p) => p.id));
      if (!Array.isArray(exclude)) throw badRequest('Daftar baris yang dilewati tidak valid');
      const excluded = new Set(exclude.map(Number));
      const seqs = new Set(rows.map((r) => r.seq));
      for (const seq of excluded) if (!seqs.has(seq)) throw badRequest(`Baris ${seq} yang dilewati tidak ada di file`);

      let added = 0;
      inTransaction(db, () => {
        for (const row of rows) {
          if (excluded.has(row.seq)) continue;
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
      return { added, skipped: rows.length - excluded.size - added, excluded: excluded.size };
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

    /**
     * Pratinjau Template Data: ringkasan per bulan & per akun (berapa baris, total, data lama yang akan diganti),
     * baris hasil pencocokan, dan daftar baris yang salah.
     */
    previewTemplate(fothangId, { token }) {
      const parsed = templateRows(fothangId, getUpload(fothangId, token));
      const keys = [...new Set(parsed.rows.map((r) => monthKey(r.date)))].sort();
      const months = keys.map((key) => {
        const rows = parsed.rows.filter((r) => monthKey(r.date) === key);
        const { from, to } = rangeOfKey(key);
        const accountIds = [...new Set(rows.map((r) => r.account_id))];
        return {
          key,
          year: Number(key.slice(0, 4)),
          month: Number(key.slice(5, 7)),
          count: rows.length,
          masuk: toRupiah(sumCents(rows.filter((r) => r.amount_cents > 0))),
          keluar: toRupiah(Math.abs(sumCents(rows.filter((r) => r.amount_cents < 0)))),
          accounts: accountIds.map((id) => ({
            account_id: id,
            name: rows.find((r) => r.account_id === id).account,
            count: rows.filter((r) => r.account_id === id).length,
            existing: repos.transaction.countBySource(id, from, to),
          })),
        };
      });
      // openings: perbandingan sheet Saldo Awal dengan saldo awal sekarang (null bila file tidak punya sheet itu).
      return { sheet: parsed.sheet, months, rows: parsed.rows, errors: parsed.errors, openings: templateOpenings(fothangId, getUpload(fothangId, token)) };
    },

    /**
     * Simpan Template Data untuk bulan-bulan yang dipilih (months: ["2026-10", ...]).
     * Per bulan, data akun-akun yang muncul di file pada bulan itu DIGANTI (seperti impor DRAF);
     * pindahan antar pos dan akun yang tidak ada di file tidak disentuh. Ditolak bila file masih punya baris salah.
     * overrides: { [seq]: { pos_id, category, name } }
     * apply_openings: true = saldo awal pos & akun juga diganti dengan isi sheet Saldo Awal (boleh tanpa bulan).
     */
    commitTemplate(fothangId, { token, months = [], overrides = {}, apply_openings: applyOpenings = false }) {
      const upload = getUpload(fothangId, token);
      const parsed = templateRows(fothangId, upload);
      if (parsed.errors.length) {
        const first = parsed.errors[0];
        throw badRequest(`File masih punya ${parsed.errors.length} baris yang salah (mis. baris ${first.row}: ${first.message}). Perbaiki di Excel lalu upload ulang.`);
      }
      const openings = applyOpenings ? templateOpenings(fothangId, upload) : null;
      if (applyOpenings && !openings) throw badRequest('File ini tidak punya sheet Saldo Awal');
      if (openings?.errors.length) {
        const first = openings.errors[0];
        throw badRequest(`Sheet Saldo Awal masih salah${first.row ? ` (baris ${first.row})` : ''}: ${first.message}`);
      }
      if (!Array.isArray(months)) throw badRequest('Daftar bulan tidak valid');
      if (!months.length && !applyOpenings) throw badRequest('Pilih minimal satu bulan yang akan diimpor');
      const chosen = new Set(months.map(String));
      const inFile = new Set(parsed.rows.map((r) => monthKey(r.date)));
      for (const key of chosen) if (!inFile.has(key)) throw badRequest(`Bulan ${key} tidak ada di file`);
      const posIds = new Set(repos.pos.listByFothang(fothangId, { includeInactive: true }).map((p) => p.id));
      const rows = parsed.rows.filter((r) => chosen.has(monthKey(r.date)));

      let replaced = 0;
      let added = 0;
      inTransaction(db, () => {
        for (const key of chosen) {
          const { from, to } = rangeOfKey(key);
          const accountIds = new Set(rows.filter((r) => monthKey(r.date) === key).map((r) => r.account_id));
          for (const accountId of accountIds) replaced += repos.transaction.deleteForAccountPeriod(accountId, from, to);
        }
        for (const row of rows) {
          const fix = overrides[row.seq] || {};
          const posId = 'pos_id' in fix ? Number(fix.pos_id) || null : row.pos_id;
          if (posId && !posIds.has(posId)) throw badRequest(`Pos tidak valid pada baris ${row.row}`);
          repos.transaction.insert({
            fothang_id: fothangId,
            account_id: row.account_id,
            pos_id: posId,
            date: row.date,
            category: 'category' in fix ? upper(fix.category) : row.category,
            name: 'name' in fix ? clean(fix.name) : row.name,
            amount_cents: row.amount_cents,
            receipt_no: row.receipt_no,
            piao_wen: row.piao_wen,
            note: row.note,
            source: 'draf',
            balance_cents: row.balance_cents,
            seq: row.seq,
          });
          added++;
        }
        if (openings) {
          for (const c of openings.changes) repos.pos.setOpening(c.pos_id, c.account_id, toCents(c.after));
          for (const c of openings.account_changes) {
            const account = repos.account.findById(c.account_id);
            repos.account.update(account.id, { ...account, opening_cents: toCents(c.after) });
          }
        }
      });
      const result = { added, replaced, months: [...chosen].sort() };
      if (openings) result.openings_changed = openings.changes.length + openings.account_changes.length;
      return result;
    },
  };
};
