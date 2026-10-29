// Angka untuk Dashboard: ringkasan total Fothang dan rincian per pos dalam satu tahun.
// Semua dihitung dari transaksi yang sama dengan laporan, jadi angkanya selalu cocok dengan Tabel & Laporan Bulanan.
//
// Catatan "pindahan": pindahan antar pos tidak dihitung sebagai pemasukan/pengeluaran (uangnya tidak keluar
// dari yayasan). Di tingkat pos, nilainya ditampilkan terpisah sebagai "pindahan" supaya
// saldo awal + masuk - keluar + pindahan = saldo akhir.
const { toRupiah } = require('../lib/money');
const { yearRange, monthOf } = require('../lib/period');
const { titleCase } = require('../lib/text');
const { CATEGORY_DONATUR } = require('./classifier');
const { sheetName } = require('./presenters');
const { assertOwned } = require('./guards');

const TOP_N = 8;
const RECENT_LIMIT = 9;

/** Kelompokkan nominal per label, urut terbesar; sisanya digabung jadi "Lainnya". */
function topGroups(rows, labelOf, limit = TOP_N) {
  const groups = new Map();
  for (const t of rows) {
    const label = labelOf(t);
    const g = groups.get(label.toUpperCase()) || { label, cents: 0, count: 0 };
    g.cents += Math.abs(t.amount_cents);
    g.count++;
    groups.set(label.toUpperCase(), g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.cents - a.cents);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  if (rest.length) top.push({ label: `Lainnya (${rest.length})`, cents: rest.reduce((s, g) => s + g.cents, 0), count: rest.reduce((s, g) => s + g.count, 0) });
  return top.map((g) => ({ label: g.label, amount: toRupiah(g.cents), count: g.count }));
}

const isTransfer = (t) => t.source === 'pindahan';
const isIn = (t) => t.amount_cents > 0 && !isTransfer(t);
const isOut = (t) => t.amount_cents < 0 && !isTransfer(t);
const sum = (rows) => rows.reduce((s, t) => s + t.amount_cents, 0);
/** Total pengeluaran sebagai angka positif (rupiah). */
const outflow = (rows) => toRupiah(Math.abs(sum(rows.filter(isOut))));

/** Transaksi terbaru (tanpa pindahan antar pos), terbaru di atas. */
function recentTransactions(rows, posById) {
  return rows
    .filter((t) => !isTransfer(t))
    .sort((a, b) => (b.date === a.date ? b.seq - a.seq || b.id - a.id : b.date < a.date ? -1 : 1))
    .slice(0, RECENT_LIMIT)
    .map((t) => ({
      id: t.id,
      date: t.date,
      pos: posById.get(t.pos_id)?.code ?? '',
      pos_name: posById.get(t.pos_id)?.name ?? 'Belum dialokasikan',
      name: sheetName(t),
      category: t.category,
      amount: toRupiah(t.amount_cents),
    }));
}

/**
 * 10 donatur terbesar, hanya dari pos yang memakai Daftar Donatur (mis. CU THAN) —
 * pos lain mencatat nomor tiket/lampion di kolom nama, bukan nama orang.
 */
function topDonors(rows, posIds) {
  return topGroups(rows.filter((t) => t.category === CATEGORY_DONATUR && posIds.has(t.pos_id)), (t) => titleCase(t.name), 10)
    .filter((d) => !d.label.startsWith('Lainnya'));
}

module.exports = function dashboardService({ repos, services }) {
  /** Bulan terakhir (1-12) yang punya transaksi, atau 0 bila belum ada. */
  const lastMonthOf = (rows) => rows.reduce((m, t) => Math.max(m, monthOf(t.date)), 0);

  /** Saldo akhir tiap bulan (sen) untuk sekumpulan baris, mulai dari saldo awal tahun. */
  function monthlyClosing(openingCents, rows, lastMonth) {
    const out = [];
    let saldo = openingCents;
    for (let m = 1; m <= 12; m++) {
      saldo += sum(rows.filter((t) => monthOf(t.date) === m));
      out.push(m <= lastMonth ? saldo : null);
    }
    return out;
  }

  function monthlyFlows(rows, closing) {
    return Array.from({ length: 12 }, (_, i) => {
      const inMonth = rows.filter((t) => monthOf(t.date) === i + 1);
      return {
        month: i + 1,
        masuk: toRupiah(sum(inMonth.filter(isIn))),
        keluar: outflow(inMonth),
        pindahan: toRupiah(sum(inMonth.filter(isTransfer))),
        saldo: closing[i] == null ? null : toRupiah(closing[i]),
        count: inMonth.length,
      };
    });
  }

  return {
    /** Ringkasan seluruh Fothang dalam satu tahun. */
    overview(fothangId, year) {
      const { from, to } = yearRange(year);
      const rows = repos.transaction.list({ fothangId, from, to });
      const accounts = repos.account.listByFothang(fothangId);
      const opening = services.balance.snapshot(fothangId, from);
      const tabel = services.ledger.tabel(fothangId, year);
      // Saldo bank hanya diketahui bila ada mutasi rekening koran (data dari file DRAF tidak membawa saldo bank).
      const hasStatement = tabel.accounts.some((a) => a.kind === 'bank' && a.actual_date);
      const lastMonth = lastMonthOf(rows);

      // Saldo awal tahun seluruh Fothang = semua pos (termasuk nonaktif) + yang belum dialokasikan, di semua akun.
      const allPos = services.pos.list(fothangId, { includeInactive: true });
      let totalOpening = 0;
      for (const a of accounts) {
        totalOpening += opening.unallocated(a.id);
        for (const p of allPos) totalOpening += opening.of(p.id, a.id);
      }

      const pos = services.pos.list(fothangId).map((p) => {
        const own = rows.filter((t) => t.pos_id === p.id);
        const openingCents = accounts.reduce((s, a) => s + opening.of(p.id, a.id), 0);
        const closing = monthlyClosing(openingCents, own, Math.max(lastMonth, 1));
        return {
          pos_id: p.id, number: p.number, code: p.code, name: p.name,
          opening: toRupiah(openingCents),
          masuk: toRupiah(sum(own.filter(isIn))),
          keluar: outflow(own),
          pindahan: toRupiah(sum(own.filter(isTransfer))),
          closing: toRupiah(openingCents + sum(own)),
          count: own.length,
          monthly: closing.map((c) => (c == null ? null : toRupiah(c))),
        };
      });

      return {
        year,
        last_month: lastMonth,
        totals: {
          opening: toRupiah(totalOpening),
          saldo: tabel.total,
          bank: hasStatement ? tabel.actual : null,
          bank_date: tabel.accounts.find((a) => a.actual_date)?.actual_date ?? null,
          selisih: hasStatement ? tabel.selisih : null,
          masuk: toRupiah(sum(rows.filter(isIn))),
          keluar: outflow(rows),
          transaksi: rows.filter((t) => !isTransfer(t)).length,
          belum_dialokasikan: rows.filter((t) => !t.pos_id).length,
        },
        months: monthlyFlows(rows, monthlyClosing(totalOpening, rows, lastMonth)),
        pos,
        recent: recentTransactions(rows, new Map(allPos.map((x) => [x.id, x]))),
        donors: topDonors(rows, new Set(allPos.filter((p) => p.show_donors).map((p) => p.id))),
      };
    },

    /** Rincian satu pos dalam satu tahun. */
    pos(fothangId, posId, year) {
      const p = assertOwned(repos.pos.findById(Number(posId)), fothangId, 'Pos');
      const { from, to } = yearRange(year);
      const rows = repos.transaction.list({ fothangId, from, to, posId: p.id });
      const accounts = repos.account.listByFothang(fothangId);
      const opening = services.balance.snapshot(fothangId, from);
      const openingCents = accounts.reduce((s, a) => s + opening.of(p.id, a.id), 0);
      const lastMonth = lastMonthOf(repos.transaction.list({ fothangId, from, to }));

      return {
        pos: { id: p.id, number: p.number, code: p.code, name: p.name },
        year,
        last_month: lastMonth,
        opening: toRupiah(openingCents),
        masuk: toRupiah(sum(rows.filter(isIn))),
        keluar: outflow(rows),
        pindahan: toRupiah(sum(rows.filter(isTransfer))),
        closing: toRupiah(openingCents + sum(rows)),
        count: rows.length,
        months: monthlyFlows(rows, monthlyClosing(openingCents, rows, Math.max(lastMonth, 1))),
        recent: recentTransactions(rows, new Map([[p.id, p]])),
        donors: p.show_donors ? topDonors(rows, new Set([p.id])) : [],
      };
    },
  };
};

module.exports.topGroups = topGroups;
