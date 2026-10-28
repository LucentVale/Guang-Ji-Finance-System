// "Cek Saldo": memastikan Mutasi, Draf, dan Laporan per Pos cocok sebelum laporan bulanan dibuat PDF.
//
// Untuk satu bulan diperiksa:
//   1. Saldo awal pembukuan tiap akun bank = saldo awal di rekening koran
//   2. Saldo berjalan Draf cocok dengan saldo bank di setiap baris mutasi
//   3. Saldo akhir pembukuan = saldo akhir rekening koran
//   4. Semua transaksi sudah dialokasikan ke pos
//   5. Jumlah saldo akhir semua pos = saldo akhir semua akun

const { toRupiah, sumCents, formatRupiah: rp } = require('../lib/money');
const { monthRange } = require('../lib/period');

module.exports = function reconciliationService({ repos, services }) {
  /** Saldo awal menurut rekening koran: saldo baris terakhir bulan lalu, atau dihitung dari baris pertama bulan ini. */
  function statementOpening(accountId, from, monthRows) {
    const previous = repos.transaction.lastStatementBalance(accountId, from);
    if (previous) return previous.balance_cents;
    const first = monthRows.find((r) => r.source === 'mutasi' && r.balance_cents != null);
    if (!first) return null;
    // Nominal asli di rekening koran = baris asal + semua pecahannya.
    const bankAmount = sumCents(monthRows.filter((r) => r.id === first.id || r.split_of === first.id));
    return first.balance_cents - bankAmount;
  }

  return {
    month(fothangId, year, month) {
      const fothang = repos.fothang.findById(fothangId);
      const { from, to } = monthRange(year, month);
      const checks = [];
      const check = (label, ok, detail) => checks.push({ label, ok, detail });

      // --- Per akun: pembukuan vs rekening koran
      const accounts = repos.account.listByFothang(fothangId).map((account) => {
        const rows = repos.transaction.list({ fothangId, from, to, accountId: account.id });
        const opening = services.balance.accountBalance(account, fothang.start_date, from);
        const closing = opening + sumCents(rows);
        const draf = services.ledger.draf(fothangId, account.id, year, month);
        const mismatchRows = draf.rows.filter((r) => r.match === false).length;
        const isBank = account.kind === 'bank';
        const hasMutasi = rows.some((r) => r.source === 'mutasi');
        const stmtOpening = isBank && hasMutasi ? statementOpening(account.id, from, rows) : null;
        const stmtClosing = isBank && hasMutasi ? repos.transaction.lastStatementBalance(account.id, to)?.balance_cents ?? null : null;

        if (isBank && hasMutasi) {
          check(`Saldo awal ${account.name} = rekening koran`, stmtOpening === opening, `Pembukuan ${rp(opening)} · Bank ${rp(stmtOpening)}`);
          check(`Saldo berjalan Draf ${account.name} cocok di setiap baris`, mismatchRows === 0, mismatchRows ? `${mismatchRows} baris tidak cocok` : `${draf.rows.length} baris cocok`);
          check(`Saldo akhir ${account.name} = rekening koran`, stmtClosing === closing, `Pembukuan ${rp(closing)} · Bank ${rp(stmtClosing)}`);
        }
        return {
          account_id: account.id, name: account.name, kind: account.kind, has_mutasi: hasMutasi,
          opening: toRupiah(opening),
          masuk: toRupiah(sumCents(rows.filter((r) => r.amount_cents > 0))),
          keluar: toRupiah(-sumCents(rows.filter((r) => r.amount_cents < 0))),
          closing: toRupiah(closing),
          statement_opening: toRupiah(stmtOpening),
          statement_closing: toRupiah(stmtClosing),
          mismatch_rows: mismatchRows,
        };
      });

      // --- Alokasi ke pos
      const unallocated = repos.transaction.count({ fothangId, from, to, posId: 'none' });
      check('Semua transaksi sudah dialokasikan ke pos', unallocated === 0, unallocated ? `${unallocated} transaksi belum punya pos` : 'Lengkap');

      // --- Ringkasan per pos untuk bulan ini (dasar Laporan Bulanan)
      const before = services.balance.snapshot(fothangId, from);
      const after = services.balance.snapshot(fothangId, to);
      const accountIds = accounts.map((a) => a.account_id);
      const posRows = services.pos.list(fothangId).map((p) => {
        const rows = repos.transaction.list({ fothangId, from, to, posId: p.id });
        return {
          pos_id: p.id, number: p.number, code: p.code, name: p.name,
          opening: toRupiah(accountIds.reduce((s, a) => s + before.of(p.id, a), 0)),
          masuk: toRupiah(sumCents(rows.filter((r) => r.amount_cents > 0))),
          keluar: toRupiah(-sumCents(rows.filter((r) => r.amount_cents < 0))),
          closing: toRupiah(accountIds.reduce((s, a) => s + after.of(p.id, a), 0)),
          count: rows.length,
        };
      });
      const posTotalCents = accountIds.reduce((s, a) => s + after.unallocated(a), 0) + posRows.reduce((s, p) => s + Math.round(p.closing * 100), 0);
      const accountTotalCents = accounts.reduce((s, a) => s + Math.round(a.closing * 100), 0);
      check('Total saldo semua pos = total saldo semua akun', posTotalCents === accountTotalCents,
        `Pos ${rp(posTotalCents)} · Akun ${rp(accountTotalCents)}${posTotalCents !== accountTotalCents ? ' (periksa saldo awal pos vs saldo awal akun)' : ''}`);

      return { year, month, accounts, pos: posRows, unallocated, checks, ready: checks.every((c) => c.ok) };
    },
  };
};
