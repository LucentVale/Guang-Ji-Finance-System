// Isi buku "Laporan Keuangan Tahunan": sheet Tabel, sheet per pos, dan Draf (urutan mutasi per akun).
const { toRupiah } = require('../lib/money');
const { yearRange, monthRange, monthOf } = require('../lib/period');
const { clean, upper } = require('../lib/text');
const { assertOwned } = require('./guards');
const { buildAliasIndex } = require('./classifier');
const present = require('./presenters');

module.exports = function ledgerService({ repos, services }) {
  const accountsOf = (fothangId) => repos.account.listByFothang(fothangId);

  return {
    /**
     * Sheet "Tabel": saldo akhir tahun tiap pos per akun, dibandingkan dengan saldo rekening koran.
     * Selisih = saldo bank (rekening koran) - total saldo pos di akun itu.
     *
     * Hanya akun yang punya PEMBANDING dari luar pembukuan yang dihitung selisihnya:
     *   - bank: saldo baris mutasi terakhir (rekening koran)
     *   - kas : belum ada hitungan fisik di aplikasi, jadi actual & selisih = null (bukan 0 / "cocok")
     * Total "actual" dan "selisih" hanya menjumlah akun yang punya pembanding (null bila tidak ada sama sekali).
     */
    tabel(fothangId, year) {
      const accounts = accountsOf(fothangId);
      const { to } = yearRange(year);
      const snap = services.balance.snapshot(fothangId, to);

      // Pos nonaktif tetap ditampilkan bila masih bersaldo, supaya total tidak menyimpang.
      const allPos = services.pos.list(fothangId, { includeInactive: true });
      const rows = allPos
        .map((p) => {
          const perAccount = Object.fromEntries(accounts.map((a) => [a.id, toRupiah(snap.of(p.id, a.id))]));
          const total = accounts.reduce((s, a) => s + snap.of(p.id, a.id), 0);
          return { pos_id: p.id, number: p.number, code: p.code, name: p.name, active: p.active, saldo: perAccount, total: toRupiah(total) };
        })
        .filter((r) => r.active || r.total !== 0);

      const columns = accounts.map((a) => {
        const posTotal = allPos.reduce((s, p) => s + snap.of(p.id, a.id), 0) + snap.unallocated(a.id);
        const statement = a.kind === 'bank' ? repos.transaction.lastStatementBalance(a.id, to) : null;
        const actual = statement ? statement.balance_cents : null;
        return {
          account_id: a.id,
          name: a.name,
          kind: a.kind,
          unallocated: toRupiah(snap.unallocated(a.id)),
          total: toRupiah(posTotal),
          actual: toRupiah(actual),
          actual_date: statement?.date ?? null,
          selisih: actual == null ? null : toRupiah(actual - posTotal),
          has_comparison: actual != null,
          actual_note: actual != null ? '' : a.kind === 'cash' ? 'belum ada hitungan fisik' : 'belum ada mutasi bank',
        };
      });

      const compared = columns.filter((c) => c.has_comparison);
      const sum = (list, pick) => list.reduce((s, c) => s + Math.round(pick(c) * 100), 0);
      return {
        year,
        accounts: columns,
        rows,
        total: toRupiah(sum(columns, (c) => c.total)),
        actual: compared.length ? toRupiah(sum(compared, (c) => c.actual)) : null,
        selisih: compared.length ? toRupiah(sum(compared, (c) => c.selisih)) : null,
        // Total saldo pos di akun-akun yang punya pembanding (dasar perhitungan "selisih" total).
        compared_total: toRupiah(sum(compared, (c) => c.total)),
      };
    },

    /**
     * Sheet per pos (seperti sheet "1" = CU THAN): baris per transaksi dikelompokkan per bulan,
     * dengan kolom Masuk/Keluar/Saldo untuk setiap akun (BCA, Kas Kecil, ...).
     * Akun yang tidak pernah dipakai pos ini disembunyikan.
     *
     * Ringkasan (semua baris sheet, termasuk pindahan antar pos, supaya cocok dengan saldo berjalan):
     *   total_opening / total_in / total_out / total_closing  — seluruh akun
     *   accounts[i].total_in / total_out                         — per akun
     *   months[i].subtotal = { masuk, keluar, accounts: [{ id, masuk, keluar, closing }] } — per bulan
     */
    posSheet(fothangId, posId, year) {
      const pos = assertOwned(repos.pos.findById(Number(posId)), fothangId, 'Pos');
      const allAccounts = accountsOf(fothangId);
      const { from, to } = yearRange(year);
      const opening = services.balance.snapshot(fothangId, from);
      const rows = repos.transaction.list({ fothangId, from, to, posId: pos.id });

      const used = new Set(rows.map((r) => r.account_id));
      const accounts = allAccounts.filter((a) => used.has(a.id) || opening.of(pos.id, a.id) !== 0);
      if (!accounts.length && allAccounts.length) accounts.push(allAccounts[0]);

      const running = new Map(accounts.map((a) => [a.id, opening.of(pos.id, a.id)]));
      const lookup = { accounts: new Map(allAccounts.map((a) => [a.id, a])) };
      // Jumlah masuk/keluar dalam sen: per akun untuk setahun, dan per akun untuk bulan yang sedang dibaca.
      const zero = () => new Map(accounts.map((a) => [a.id, { in: 0, out: 0 }]));
      const yearFlow = zero();
      const months = [];
      let monthFlow = null;

      const closeMonth = () => {
        const m = months.at(-1);
        if (!m) return;
        const perAccount = accounts.map((a) => ({
          id: a.id,
          masuk: toRupiah(monthFlow.get(a.id).in),
          keluar: toRupiah(monthFlow.get(a.id).out),
          closing: toRupiah(running.get(a.id)),
        }));
        const sumOf = (key) => toRupiah([...monthFlow.values()].reduce((s, f) => s + f[key], 0));
        m.subtotal = { masuk: sumOf('in'), keluar: sumOf('out'), accounts: perAccount };
      };

      for (const r of rows) {
        const m = monthOf(r.date);
        if (months.at(-1)?.month !== m) {
          closeMonth();
          months.push({ month: m, rows: [] });
          monthFlow = zero();
        }
        running.set(r.account_id, running.get(r.account_id) + r.amount_cents);
        const key = r.amount_cents > 0 ? 'in' : 'out';
        monthFlow.get(r.account_id)[key] += Math.abs(r.amount_cents);
        yearFlow.get(r.account_id)[key] += Math.abs(r.amount_cents);
        months.at(-1).rows.push({ ...present.transaction(r, lookup), saldo: toRupiah(running.get(r.account_id)) });
      }
      closeMonth();

      const sumCents = (values) => [...values].reduce((s, v) => s + v, 0);
      return {
        pos: { id: pos.id, number: pos.number, code: pos.code, name: pos.name },
        year,
        accounts: accounts.map((a) => ({
          id: a.id,
          name: a.name,
          opening: toRupiah(opening.of(pos.id, a.id)),
          closing: toRupiah(running.get(a.id)),
          total_in: toRupiah(yearFlow.get(a.id).in),
          total_out: toRupiah(yearFlow.get(a.id).out),
        })),
        months,
        total_opening: toRupiah(sumCents(accounts.map((a) => opening.of(pos.id, a.id)))),
        total_in: toRupiah(sumCents([...yearFlow.values()].map((f) => f.in))),
        total_out: toRupiah(sumCents([...yearFlow.values()].map((f) => f.out))),
        total_closing: toRupiah(sumCents(running.values())),
      };
    },

    /**
     * Draf: semua transaksi satu akun dalam satu bulan, berurutan seperti rekening koran,
     * dengan saldo berjalan yang dicocokkan baris demi baris dengan saldo bank.
     * Pindahan antar pos tidak ditampilkan karena tidak menggerakkan uang di bank.
     */
    draf(fothangId, accountId, year, month) {
      const fothang = repos.fothang.findById(fothangId);
      const account = assertOwned(repos.account.findById(Number(accountId)), fothangId, 'Akun');
      const { from, to } = monthRange(year, month);
      const allPos = repos.pos.listByFothang(fothangId, { includeInactive: true });
      const lookup = { pos: new Map(allPos.map((p) => [p.id, p])) };
      const aliasIndex = buildAliasIndex(allPos);

      /**
       * Kolom Pos & Keterangan seperti ditulis di file DRAF manual:
       *   Pos = kode seperti diketik di kolom C mutasi ("KELAS", "PAT WU AI LIU"), bila memang menunjuk ke pos baris ini;
       *         selain itu (mis. pecahan ke pos lain) kode pos-nya.
       *   Keterangan = nama, atau "KATEGORI ; NAMA"; kategori yang sudah tersirat di kode (mis. WU AI LIU) tidak diulang.
       */
      function drafColumns(t) {
        const typed = upper(clean(t.bank_code).split(';')[0] || '');
        const hit = aliasIndex.get(typed);
        const fromCode = !!hit && hit.posId === t.pos_id;
        // Kategori ditulis di depan nama (masuk maupun keluar), kecuali yang sudah tersirat: DONATUR,
        // kategori bawaan alias (WU AI LIU), baris bank yang namanya sudah sama (BUNGA BANK), dan pindahan.
        const implied = !t.category || t.category === 'DONATUR' || t.category.startsWith('PINDAHAN')
          || (fromCode && t.category === hit.category) || t.category === upper(t.name) || present.isSystemRow(t);
        return {
          draf_pos: fromCode ? typed : lookup.pos.get(t.pos_id)?.code ?? '',
          draf_ket: implied ? t.name : `${t.category} ; ${t.name}`,
        };
      }

      const openingBook = services.balance.accountBalance(account, fothang.start_date, from);
      const source = repos.transaction.list({ fothangId, from, to, accountId: account.id }).filter((t) => t.source !== 'pindahan');

      let saldo = openingBook;
      const saldoAfter = source.map((t) => (saldo += t.amount_cents));

      // Baris yang dipecah: saldo bank baru bisa dibandingkan setelah pecahan terakhirnya (urutan: asal, lalu pecahan).
      const group = (t) => t.split_of ?? t.id;
      const lastIndexOfGroup = new Map(source.map((t, i) => [group(t), i]));
      const groupSize = new Map();
      for (const t of source) groupSize.set(group(t), (groupSize.get(group(t)) || 0) + 1);

      const rows = source.map((t, i) => ({
        ...present.transaction(t, lookup),
        ...drafColumns(t),
        split: groupSize.get(group(t)) > 1,
        saldo: toRupiah(saldoAfter[i]),
        match: t.balance_cents == null ? null : t.balance_cents === saldoAfter[lastIndexOfGroup.get(group(t))],
      }));

      return { account: { id: account.id, name: account.name, kind: account.kind }, year, month, opening: toRupiah(openingBook), closing: toRupiah(saldo), rows };
    },
  };
};
