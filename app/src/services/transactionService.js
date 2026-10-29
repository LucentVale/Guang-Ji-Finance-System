// Input, ubah, hapus transaksi; alokasi ke pos; pindahan antar pos.
const crypto = require('node:crypto');
const { inTransaction } = require('../db/connection');
const { badRequest } = require('../lib/errors');
const { positiveCents, toCents } = require('../lib/money');
const { assertIsoDate, monthRange, yearRange, assertYear, assertMonth } = require('../lib/period');
const { clean, upper, titleCase } = require('../lib/text');
const { assertOwned } = require('./guards');
const present = require('./presenters');

module.exports = function transactionService({ db, repos, services }) {
  function lookups(fothangId) {
    return {
      accounts: new Map(repos.account.listByFothang(fothangId).map((a) => [a.id, a])),
      pos: new Map(repos.pos.listByFothang(fothangId, { includeInactive: true }).map((p) => [p.id, p])),
    };
  }

  /** Validasi input pengguna. Isi salah satu: masuk ATAU keluar (dalam rupiah). */
  function validate(fothangId, input) {
    const masuk = toCents(input.masuk || 0);
    const keluar = toCents(input.keluar || 0);
    if (masuk && keluar) throw badRequest('Isi salah satu saja: Masuk atau Keluar');
    if (masuk < 0 || keluar < 0) throw badRequest('Nominal tidak boleh negatif');
    if (!masuk && !keluar) throw badRequest('Nominal wajib diisi');

    const posId = input.pos_id ? Number(input.pos_id) : null;
    if (posId) assertOwned(repos.pos.findById(posId), fothangId, 'Pos');
    const accountId = Number(input.account_id);
    assertOwned(repos.account.findById(accountId), fothangId, 'Akun');

    return {
      fothang_id: fothangId,
      account_id: accountId,
      pos_id: posId,
      date: assertIsoDate(input.date),
      category: upper(input.category),
      name: clean(input.name),
      amount_cents: masuk || -keluar,
      receipt_no: clean(input.receipt_no),
      piao_wen: clean(input.piao_wen),
      note: clean(input.note),
    };
  }

  /** Filter dari query string: year, month, pos_id, account_id, type, q. */
  function filterFromQuery(fothangId, q) {
    const year = assertYear(q.year);
    const range = q.month ? monthRange(year, assertMonth(q.month)) : yearRange(year);
    return {
      fothangId,
      ...range,
      posId: q.pos_id === 'none' ? 'none' : Number(q.pos_id) || null,
      accountId: Number(q.account_id) || null,
      type: q.type,
      source: q.source,
      search: clean(q.q),
    };
  }

  return {
    list(fothangId, query) {
      const look = lookups(fothangId);
      return repos.transaction.list(filterFromQuery(fothangId, query)).map((t) => present.transaction(t, look));
    },

    get(fothangId, id) {
      return assertOwned(repos.transaction.findById(Number(id)), fothangId, 'Transaksi');
    },

    categories: (fothangId) => repos.transaction.categories(fothangId),

    create(fothangId, input) {
      return repos.transaction.insert({ ...validate(fothangId, input), source: 'manual' });
    },

    update(fothangId, id, input) {
      const old = this.get(fothangId, id);
      if (old.source === 'pindahan') throw badRequest('Pindahan antar pos tidak bisa diubah. Hapus lalu buat ulang.');
      // Data rekening koran (tanggal, nominal, akun) tidak boleh berubah; hanya alokasi & keterangannya.
      const locked = old.source === 'mutasi'
        ? { date: old.date, account_id: old.account_id, masuk: Math.max(old.amount_cents, 0) / 100, keluar: Math.max(-old.amount_cents, 0) / 100 }
        : {};
      repos.transaction.update(old.id, validate(fothangId, { account_id: old.account_id, ...input, ...locked }));
    },

    /**
     * Hapus transaksi.
     *   - pindahan: pasangannya ikut terhapus
     *   - pecahan: nominalnya dikembalikan ke baris asal (digabung kembali)
     *   - baris asal yang punya pecahan: pecahannya ikut terhapus (ON DELETE CASCADE)
     */
    remove(fothangId, id) {
      const old = this.get(fothangId, id);
      inTransaction(db, () => {
        if (old.transfer_id) repos.transaction.deleteTransfer(old.transfer_id);
        else {
          if (old.split_of) repos.transaction.addAmount(old.split_of, old.amount_cents);
          repos.transaction.delete(old.id);
        }
      });
    },

    /**
     * Pecah satu transaksi menjadi dua baris dengan pos berbeda, total tetap sama.
     * Contoh: transfer Sherly Rp 1.000.000 -> 500.000 tetap di CU THAN, 500.000 dipecah ke KFCC.
     * Baris pecahan menyalin data bank (tanggal, kode mutasi) dan menunjuk ke baris asal lewat split_of.
     * input: { amount (rupiah, bagian yang dipisah), pos_id, category, name }
     */
    split(fothangId, id, input) {
      const original = this.get(fothangId, id);
      if (original.source === 'pindahan') throw badRequest('Pindahan antar pos tidak bisa dipecah');
      const cents = positiveCents(input.amount, 'Nominal pecahan');
      if (cents >= Math.abs(original.amount_cents)) throw badRequest('Nominal pecahan harus lebih kecil dari nominal transaksi');
      const posId = Number(input.pos_id) || null;
      if (!posId) throw badRequest('Pilih pos untuk bagian yang dipecah');
      assertOwned(repos.pos.findById(posId), fothangId, 'Pos');

      const signed = Math.sign(original.amount_cents) * cents;
      return inTransaction(db, () => {
        repos.transaction.addAmount(original.id, -signed);
        return repos.transaction.insert({
          ...original,
          pos_id: posId,
          category: upper(input.category),
          name: clean(input.name) || original.name,
          amount_cents: signed,
          receipt_no: '', piao_wen: '', note: '',
          balance_cents: null,
          dedupe_key: null,
          split_of: original.split_of ?? original.id,
        });
      });
    },

    /** Alokasikan banyak transaksi sekaligus ke satu pos (atau kosongkan dengan posId null). */
    assignPos(fothangId, ids, posId) {
      if (posId) assertOwned(repos.pos.findById(Number(posId)), fothangId, 'Pos');
      const owned = ids.map(Number).filter((id) => repos.transaction.findById(id)?.fothang_id === fothangId);
      inTransaction(db, () => repos.transaction.setPos(owned, posId ? Number(posId) : null));
      return owned.length;
    },

    /** Saldo satu pos di satu akun per tanggal (rupiah) — dipakai form pindahan untuk "pindahkan semua saldo". */
    posBalance(fothangId, query) {
      const pos = assertOwned(repos.pos.findById(Number(query.pos_id)), fothangId, 'Pos');
      const account = assertOwned(repos.account.findById(Number(query.account_id)), fothangId, 'Akun');
      const date = assertIsoDate(query.date);
      // Saldo awal pos + transaksi s/d tanggal itu (snapshot menghitung SEBELUM tanggal, jadi pakai hari berikutnya).
      const nextDay = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const saldo = services.balance.snapshot(fothangId, nextDay).of(pos.id, account.id);
      return { pos_id: pos.id, account_id: account.id, date, saldo: saldo / 100 };
    },

    /**
     * Pindahan antar pos dalam satu akun: dua baris berpasangan, total saldo akun tidak berubah.
     * Baris pindahan diletakkan paling bawah pada tanggalnya (seperti di file Laporan Keuangan).
     */
    transfer(fothangId, input) {
      const from = assertOwned(repos.pos.findById(Number(input.from_pos_id)), fothangId, 'Pos asal');
      const to = assertOwned(repos.pos.findById(Number(input.to_pos_id)), fothangId, 'Pos tujuan');
      if (from.id === to.id) throw badRequest('Pos asal dan tujuan harus berbeda');
      const account = assertOwned(repos.account.findById(Number(input.account_id)), fothangId, 'Akun');
      const cents = positiveCents(input.amount);
      const date = assertIsoDate(input.date);
      const base = {
        fothang_id: fothangId, account_id: account.id, date, seq: repos.transaction.lastSeqOn(account.id, date) + 1,
        note: clean(input.note), source: 'pindahan', transfer_id: crypto.randomUUID(),
      };
      inTransaction(db, () => {
        repos.transaction.insert({ ...base, pos_id: from.id, amount_cents: -cents, category: `PINDAHAN KE ${upper(to.name)}`, name: `Pindahan ke ${titleCase(to.name)}` });
        repos.transaction.insert({ ...base, pos_id: to.id, amount_cents: cents, category: `PINDAHAN DARI ${upper(from.name)}`, name: `Pindahan dari ${titleCase(from.name)}` });
      });
      return base.transfer_id;
    },
  };
};
