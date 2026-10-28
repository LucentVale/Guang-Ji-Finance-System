// Laporan bulanan per pos, mengikuti "BENTUK LAPORAN KEUANGAN":
//   Saldo Awal, Pemasukan (dikelompokkan per kategori), Pengeluaran (per uraian), Saldo Akhir, Daftar Donatur.
const { toRupiah, sumCents } = require('../lib/money');
const { monthRange, monthName } = require('../lib/period');
const { titleCase } = require('../lib/text');
const { CATEGORY_DONATUR } = require('./classifier');
const { reportLabel } = require('./presenters');

/** Gabungkan baris berlabel sama: [{ label, amount, count }]. Donatur selalu di urutan pertama. */
function groupLines(rows) {
  const groups = new Map();
  for (const t of rows) {
    const label = reportLabel(t);
    const g = groups.get(label.toUpperCase()) || { label, cents: 0, count: 0 };
    g.cents += Math.abs(t.amount_cents);
    g.count++;
    groups.set(label.toUpperCase(), g);
  }
  return [...groups.values()]
    .sort((a, b) => (a.label === 'Donatur' ? -1 : b.label === 'Donatur' ? 1 : 0))
    .map((g) => ({ label: g.label, amount: toRupiah(g.cents), count: g.count }));
}

function donorList(rows) {
  const donors = new Map();
  for (const t of rows.filter((r) => r.category === CATEGORY_DONATUR)) {
    const d = donors.get(t.name.toUpperCase()) || { name: titleCase(t.name), cents: 0 };
    d.cents += t.amount_cents;
    donors.set(t.name.toUpperCase(), d);
  }
  return [...donors.values()].sort((a, b) => a.name.localeCompare(b.name)).map((d) => ({ name: d.name, amount: toRupiah(d.cents) }));
}

module.exports = function reportService({ repos, services }) {
  return {
    /** @param {{all?: boolean}} options all = tampilkan juga pos tanpa transaksi bulan ini */
    monthly(fothangId, year, month, { all = false } = {}) {
      const fothang = repos.fothang.findById(fothangId);
      const { from, to } = monthRange(year, month);
      const accounts = repos.account.listByFothang(fothangId);
      const before = services.balance.snapshot(fothangId, from);

      const blocks = services.pos.list(fothangId).map((pos) => {
        const rows = repos.transaction.list({ fothangId, from, to, posId: pos.id });
        const income = rows.filter((r) => r.amount_cents > 0);
        const expense = rows.filter((r) => r.amount_cents < 0);
        const opening = accounts.reduce((s, a) => s + before.of(pos.id, a.id), 0);
        const totalIn = sumCents(income);
        const totalOut = -sumCents(expense);
        const donors = pos.show_donors ? donorList(income) : [];
        return {
          pos: { id: pos.id, number: pos.number, code: pos.code, name: pos.name, show_donors: pos.show_donors },
          opening: toRupiah(opening),
          income: groupLines(income),
          expense: groupLines(expense),
          total_in: toRupiah(totalIn),
          total_out: toRupiah(totalOut),
          closing: toRupiah(opening + totalIn - totalOut),
          donors,
          donors_total: toRupiah(donors.reduce((s, d) => s + Math.round(d.amount * 100), 0)),
          tx_count: rows.length,
        };
      });

      return {
        fothang: { id: fothang.id, name: fothang.name, short_name: fothang.short_name },
        year,
        month,
        month_name: monthName(month),
        blocks: all ? blocks : blocks.filter((b) => b.tx_count > 0),
      };
    },
  };
};
