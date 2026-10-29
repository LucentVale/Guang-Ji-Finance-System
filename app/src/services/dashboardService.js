// Angka untuk Dashboard: ringkasan total Fothang dan rincian per pos dalam satu tahun.
// Semua dihitung dari transaksi yang sama dengan laporan, jadi angkanya selalu cocok dengan Tabel & Laporan Bulanan.
//
// Catatan "pindahan": pindahan antar pos tidak dihitung sebagai pemasukan/pengeluaran (uangnya tidak keluar
// dari yayasan). Di tingkat pos, nilainya ditampilkan terpisah sebagai "pindahan" supaya
// saldo awal + masuk - keluar + pindahan = saldo akhir.
const { toRupiah } = require('../lib/money');
const { yearRange, monthOf, dayOf } = require('../lib/period');
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

  /**
   * Arus kas harian satu bulan (untuk dashboard Per Bulan): pemasukan & pengeluaran tiap tanggal (tanpa pindahan)
   * dan saldo di akhir hari (termasuk pindahan). Hari tanpa transaksi tetap ada supaya grafik utuh 1..akhir bulan.
   */
  function dailyFlows(year, month, openingCents, rows) {
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let saldo = openingCents;
    return Array.from({ length: days }, (_, i) => {
      const onDay = rows.filter((t) => dayOf(t.date) === i + 1);
      saldo += sum(onDay);
      return { day: i + 1, masuk: toRupiah(sum(onDay.filter(isIn))), keluar: outflow(onDay), saldo: toRupiah(saldo), count: onDay.length };
    });
  }

  /**
   * Periode yang dirangkum kartu-kartu dashboard: setahun penuh (month = null) atau satu bulan.
   * before = baris sebelum periode (untuk saldo awal periode), inPeriod = baris di dalam periode.
   */
  function period(rows, month) {
    if (!month) return { before: [], inPeriod: rows };
    return { before: rows.filter((t) => monthOf(t.date) < month), inPeriod: rows.filter((t) => monthOf(t.date) === month) };
  }

  return {
    /**
     * Ringkasan seluruh Fothang dalam satu tahun.
     * month (1-12, opsional): kartu & tabel per pos hanya untuk bulan itu; grafik per bulan tetap setahun.
     */
    overview(fothangId, year, month = null) {
      const { from, to } = yearRange(year);
      const all = repos.transaction.list({ fothangId, from, to });
      const { before, inPeriod: rows } = period(all, month);
      const accounts = repos.account.listByFothang(fothangId);
      const opening = services.balance.snapshot(fothangId, from);
      const tabel = services.ledger.tabel(fothangId, year);
      // Saldo bank hanya diketahui bila ada mutasi rekening koran (data dari file DRAF tidak membawa saldo bank).
      // Pembanding bank berlaku untuk saldo akhir tahun berjalan, jadi tidak ditampilkan saat melihat satu bulan.
      const hasStatement = !month && tabel.accounts.some((a) => a.kind === 'bank' && a.actual_date);
      const lastMonth = lastMonthOf(all);

      // Saldo awal tahun seluruh Fothang = semua pos (termasuk nonaktif) + yang belum dialokasikan, di semua akun.
      const allPos = services.pos.list(fothangId, { includeInactive: true });
      let totalOpening = 0;
      for (const a of accounts) {
        totalOpening += opening.unallocated(a.id);
        for (const p of allPos) totalOpening += opening.of(p.id, a.id);
      }
      const periodOpening = totalOpening + sum(before);

      const pos = services.pos.list(fothangId).map((p) => {
        const own = rows.filter((t) => t.pos_id === p.id);
        const yearOpening = accounts.reduce((s, a) => s + opening.of(p.id, a.id), 0);
        const openingCents = yearOpening + sum(before.filter((t) => t.pos_id === p.id));
        const closing = monthlyClosing(yearOpening, all.filter((t) => t.pos_id === p.id), Math.max(lastMonth, 1));
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
        month,
        last_month: lastMonth,
        totals: {
          opening: toRupiah(periodOpening),
          saldo: month ? toRupiah(periodOpening + sum(rows)) : tabel.total,
          bank: hasStatement ? tabel.actual : null,
          bank_date: tabel.accounts.find((a) => a.actual_date)?.actual_date ?? null,
          selisih: hasStatement ? tabel.selisih : null,
          masuk: toRupiah(sum(rows.filter(isIn))),
          keluar: outflow(rows),
          transaksi: rows.filter((t) => !isTransfer(t)).length,
          belum_dialokasikan: rows.filter((t) => !t.pos_id).length,
        },
        months: monthlyFlows(all, monthlyClosing(totalOpening, all, lastMonth)),
        year_opening: toRupiah(totalOpening),
        days: month ? dailyFlows(year, month, periodOpening, rows) : null,
        pos,
        recent: recentTransactions(rows, new Map(allPos.map((x) => [x.id, x]))),
        donors: topDonors(rows, new Set(allPos.filter((p) => p.show_donors).map((p) => p.id))),
      };
    },

    /** Rincian satu pos dalam satu tahun, atau satu bulan bila month diisi (grafik per bulan tetap setahun). */
    pos(fothangId, posId, year, month = null) {
      const p = assertOwned(repos.pos.findById(Number(posId)), fothangId, 'Pos');
      const { from, to } = yearRange(year);
      const all = repos.transaction.list({ fothangId, from, to, posId: p.id });
      const { before, inPeriod: rows } = period(all, month);
      const accounts = repos.account.listByFothang(fothangId);
      const opening = services.balance.snapshot(fothangId, from);
      const yearOpening = accounts.reduce((s, a) => s + opening.of(p.id, a.id), 0);
      const openingCents = yearOpening + sum(before);
      const lastMonth = lastMonthOf(repos.transaction.list({ fothangId, from, to }));

      return {
        pos: { id: p.id, number: p.number, code: p.code, name: p.name },
        year,
        month,
        last_month: lastMonth,
        year_opening: toRupiah(yearOpening),
        opening: toRupiah(openingCents),
        masuk: toRupiah(sum(rows.filter(isIn))),
        keluar: outflow(rows),
        pindahan: toRupiah(sum(rows.filter(isTransfer))),
        closing: toRupiah(openingCents + sum(rows)),
        count: rows.length,
        months: monthlyFlows(all, monthlyClosing(yearOpening, all, Math.max(lastMonth, 1))),
        days: month ? dailyFlows(year, month, openingCents, rows) : null,
        recent: recentTransactions(rows, new Map([[p.id, p]])),
        donors: p.show_donors ? topDonors(rows, new Set([p.id])) : [],
      };
    },
  };
};

module.exports.topGroups = topGroups;
