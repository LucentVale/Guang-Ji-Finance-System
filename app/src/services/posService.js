// Pos keuangan (CU THAN, KFCC, ...) beserta saldo awalnya per akun.
const { inTransaction } = require('../db/connection');
const { badRequest, conflict } = require('../lib/errors');
const { toCents, toRupiah } = require('../lib/money');
const { clean, upper } = require('../lib/text');
const { assertOwned } = require('./guards');

module.exports = function posService({ db, repos }) {
  function validate(input) {
    const p = {
      number: Number(input.number),
      code: upper(input.code),
      name: clean(input.name),
      aliases: String(input.aliases ?? '').split(',').map(clean).filter(Boolean).join(','),
      show_donors: input.show_donors ? 1 : 0,
      active: input.active === false ? 0 : 1,
    };
    if (!p.code || !p.name) throw badRequest('Kode dan nama pos wajib diisi');
    if (!Number.isInteger(p.number) || p.number < 1) throw badRequest('Nomor sheet harus angka 1 atau lebih');
    return p;
  }

  /** openings: { [accountId]: rupiah } */
  function saveOpenings(fothangId, posId, openings = {}) {
    for (const [accountId, rupiah] of Object.entries(openings)) {
      assertOwned(repos.account.findById(Number(accountId)), fothangId, 'Akun');
      repos.pos.setOpening(posId, Number(accountId), toCents(rupiah || 0));
    }
  }

  return {
    /** Daftar pos lengkap dengan saldo awal per akun: openings = { [accountId]: rupiah }. */
    list(fothangId, { includeInactive = false } = {}) {
      const openings = repos.pos.openingsByFothang(fothangId);
      return repos.pos.listByFothang(fothangId, { includeInactive }).map((p) => ({
        ...p,
        show_donors: !!p.show_donors,
        active: !!p.active,
        openings: Object.fromEntries(openings.filter((o) => o.pos_id === p.id).map((o) => [o.account_id, toRupiah(o.amount_cents)])),
      }));
    },

    get: (fothangId, posId) => assertOwned(repos.pos.findById(Number(posId)), fothangId, 'Pos'),

    create(fothangId, input) {
      const p = validate(input);
      return inTransaction(db, () => {
        let id;
        try { id = repos.pos.insert(fothangId, p); } catch { throw conflict(`Kode pos ${p.code} sudah dipakai`); }
        saveOpenings(fothangId, id, input.openings);
        return id;
      });
    },

    update(fothangId, posId, input) {
      this.get(fothangId, posId);
      const p = validate(input);
      inTransaction(db, () => {
        try { repos.pos.update(Number(posId), p); } catch { throw conflict(`Kode pos ${p.code} sudah dipakai`); }
        saveOpenings(fothangId, Number(posId), input.openings);
      });
    },

    remove(fothangId, posId) {
      this.get(fothangId, posId);
      const n = repos.transaction.countByPos(Number(posId));
      if (n) throw conflict(`Pos masih memiliki ${n} transaksi. Nonaktifkan saja, atau pindahkan transaksinya dulu.`);
      repos.pos.delete(Number(posId));
    },
  };
};
