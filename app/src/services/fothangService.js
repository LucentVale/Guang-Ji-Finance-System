// Fothang (cabang) dan akun-akunnya. Satu database bisa menampung banyak Fothang.
const { inTransaction } = require('../db/connection');
const { badRequest, conflict, notFound } = require('../lib/errors');
const { toCents, toRupiah } = require('../lib/money');
const { assertIsoDate } = require('../lib/period');
const { clean, upper } = require('../lib/text');
const { assertOwned } = require('./guards');

const DEFAULT_ACCOUNTS = [
  { name: 'BCA', kind: 'bank', opening: 0, sort: 1 },
  { name: 'Kas Kecil', kind: 'cash', opening: 0, sort: 2 },
];

module.exports = function fothangService({ db, repos }) {
  function validateFothang(input) {
    const f = {
      code: upper(input.code).replace(/\s+/g, '-'),
      name: clean(input.name),
      short_name: clean(input.short_name) || clean(input.name).replace(/\s*fo\s*thang\s*$/i, ''),
      start_date: assertIsoDate(input.start_date, 'Tanggal mulai pembukuan'),
    };
    if (!f.code || !f.name) throw badRequest('Kode dan nama Fothang wajib diisi');
    return f;
  }

  function validateAccount(input) {
    const a = {
      name: clean(input.name),
      kind: input.kind === 'cash' ? 'cash' : 'bank',
      account_no: clean(input.account_no),
      opening_cents: toCents(input.opening ?? 0),
      sort: Number(input.sort) || 0,
    };
    if (!a.name) throw badRequest('Nama akun wajib diisi');
    return a;
  }

  const presentAccount = (a) => ({ ...a, opening: toRupiah(a.opening_cents) });

  return {
    list: () => repos.fothang.list(),

    get(id) {
      const f = repos.fothang.findById(Number(id));
      if (!f) throw notFound('Fothang tidak ditemukan');
      return f;
    },

    /** Buat Fothang baru. Opsi copy_pos_from menyalin daftar pos (tanpa saldo) dari Fothang lain. */
    create(input) {
      const f = validateFothang(input);
      return inTransaction(db, () => {
        let id;
        try { id = repos.fothang.insert(f); } catch { throw conflict(`Kode Fothang ${f.code} sudah dipakai`); }
        for (const a of input.accounts?.length ? input.accounts : DEFAULT_ACCOUNTS) repos.account.insert(id, validateAccount(a));
        if (input.copy_pos_from) {
          for (const p of repos.pos.listByFothang(Number(input.copy_pos_from))) {
            repos.pos.insert(id, { ...p, active: 1 });
          }
        }
        return repos.fothang.findById(id);
      });
    },

    update(id, input) {
      this.get(id);
      try { repos.fothang.update(Number(id), validateFothang(input)); } catch (e) {
        if (e.status) throw e;
        throw conflict('Kode Fothang sudah dipakai');
      }
      return repos.fothang.findById(Number(id));
    },

    accounts: (fothangId) => repos.account.listByFothang(fothangId).map(presentAccount),

    saveAccount(fothangId, input, accountId = null) {
      const a = validateAccount(input);
      try {
        if (accountId) {
          assertOwned(repos.account.findById(accountId), fothangId, 'Akun');
          repos.account.update(accountId, a);
          return accountId;
        }
        return repos.account.insert(fothangId, a);
      } catch (e) {
        if (e.status) throw e;
        throw conflict(`Akun ${a.name} sudah ada`);
      }
    },
  };
};
