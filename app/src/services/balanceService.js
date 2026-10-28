// Perhitungan saldo pada suatu tanggal: saldo awal (per start_date Fothang) + semua transaksi sesudahnya.

module.exports = function balanceService({ repos }) {
  const key = (posId, accountId) => `${posId ?? 'none'}:${accountId}`;

  return {
    /**
     * Potret saldo setiap pos di setiap akun, SEBELUM tanggal `before`.
     * pos_id null = transaksi yang belum dialokasikan ke pos.
     */
    snapshot(fothangId, before) {
      const fothang = repos.fothang.findById(fothangId);
      const cents = new Map();
      const add = (posId, accountId, value) => cents.set(key(posId, accountId), (cents.get(key(posId, accountId)) || 0) + value);

      for (const o of repos.pos.openingsByFothang(fothangId)) add(o.pos_id, o.account_id, o.amount_cents);
      for (const s of repos.transaction.sumByPosAndAccount(fothangId, fothang.start_date, before)) add(s.pos_id, s.account_id, s.cents);

      return {
        of: (posId, accountId) => cents.get(key(posId, accountId)) || 0,
        unallocated: (accountId) => cents.get(key(null, accountId)) || 0,
      };
    },

    /** Saldo satu akun menurut pembukuan (saldo awal akun + transaksinya), sebelum tanggal `before`. */
    accountBalance(account, startDate, before) {
      return account.opening_cents + repos.transaction.sumByAccount(account.id, startDate, before);
    },
  };
};
