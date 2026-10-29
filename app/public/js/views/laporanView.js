// Langkah 5 — Laporan bulanan bentuk resmi ("BENTUK LAPORAN KEUANGAN"), satu pos per halaman, siap dicetak ke PDF.
import { $, html, render } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money } from '../core/format.js';
import { monthOptions, defaultMonth } from '../components/options.js';

export async function laporanView(main, params) {
  const month = Number(params.get('month')) || defaultMonth();
  const all = params.get('all') === '1';
  const [report, check] = await Promise.all([
    api.get('/laporan-bulanan', { year: store.year, month, all: all ? 1 : '' }),
    api.get('/cek', { year: store.year, month }),
  ]);
  const period = `${report.month_name} ${store.year}`;

  render(main, html`
    <div class="view-head no-print">
      <div>
        <h1>5. Laporan Keuangan Bulanan</h1>
        <p class="sub">Format mengikuti PDF "Bentuk Laporan Keuangan". Klik <b>Cetak / Simpan PDF</b>, lalu pilih "Save as PDF" sebagai printer.</p>
      </div>
      <div class="toolbar">
        <select id="monthSel" aria-label="Bulan">${monthOptions(month)}</select>
        <label class="check"><input type="checkbox" id="allPos" ${all ? 'checked' : ''}> Semua pos</label>
        <a class="btn" href="${api.downloadUrl('/export/laporan-bulanan.xlsx', { year: store.year, month })}">⭳ Excel</a>
        <button class="btn-primary" id="printBtn">⎙ Cetak / Simpan PDF</button>
      </div>
    </div>
    ${check.ready ? '' : html`<p class="notice no-print">⚠ Cek Saldo ${period} belum lolos semua. <a href="#/cek?month=${month}">Lihat detail →</a></p>`}
    <div class="report-paper">
      ${report.blocks.length ? report.blocks.map((b) => reportPage(b, report, period)) : html`<div class="empty">Belum ada transaksi untuk ${period}.</div>`}
    </div>`);

  const go = () => (location.hash = `#/laporan?month=${$('#monthSel').value}${$('#allPos').checked ? '&all=1' : ''}`);
  $('#monthSel').addEventListener('change', go);
  $('#allPos').addEventListener('change', go);
  $('#printBtn').addEventListener('click', () => {
    const previous = document.title;
    document.title = `${String(report.month).padStart(2, '0')} Laporan Keuangan ${report.fothang.short_name} ${period}`; // nama file PDF bawaan
    window.print();
    document.title = previous;
  });
}

const COLS = html`<colgroup><col><col class="c-amount"><col class="c-sign"><col class="c-total"><col class="c-sign"></colgroup>`;

function itemRows(items) {
  if (!items.length) return html`<tr class="item underline-amount"><td class="muted">—</td><td class="amount"></td><td></td><td></td><td></td></tr>`;
  return items.map((l, i) => html`
    <tr class="item ${i === items.length - 1 ? 'underline-amount' : ''}"><td>${l.label}</td><td class="num amount">${money(l.amount)}</td><td></td><td></td><td></td></tr>`);
}

function reportPage(b, report, period) {
  return html`
    <article class="report-page">
      <div class="report-head">
        <img src="img/logo-emblem.png" alt="">
        <div>
          <div class="org">Yayasan Guang Ji · ${report.fothang.name}</div>
          <div class="report-title">Laporan Keuangan ${b.pos.name.toUpperCase()} ${report.fothang.short_name}</div>
          <div class="report-period">Per ${period}</div>
        </div>
      </div>
      <table class="report-table">
        ${COLS}
        <tr class="strong"><td>Saldo Awal ${period}</td><td></td><td></td><td class="num">${money(b.opening)}</td><td></td></tr>
        <tr class="section"><td colspan="5">Pemasukan :</td></tr>
        ${itemRows(b.income)}
        <tr><td></td><td></td><td class="sign">+</td><td></td><td></td></tr>
        <tr class="strong"><td>Total Pemasukan</td><td></td><td></td><td class="num">${money(b.total_in)}</td><td></td></tr>
        <tr class="section"><td colspan="5">Pengeluaran :</td></tr>
        ${itemRows(b.expense)}
        <tr><td></td><td></td><td class="sign">+</td><td></td><td></td></tr>
        <tr class="strong underline-total"><td>Total Pengeluaran</td><td></td><td></td><td class="num total">${money(b.total_out)}</td><td class="sign">−</td></tr>
        <tr class="strong"><td>Saldo Akhir ${period}</td><td></td><td></td><td class="num">${money(b.closing)}</td><td></td></tr>
      </table>
      ${b.donors.length ? html`
        <div class="report-donors">
          <div class="report-title report-title-sm">Daftar Donatur ${b.pos.name.toUpperCase()} ${report.year}</div>
          <table class="report-table">
            ${COLS}
            ${itemRows(b.donors.map((d) => ({ label: d.name, amount: d.amount })))}
            <tr><td></td><td></td><td class="sign">+</td><td></td><td></td></tr>
            <tr class="strong"><td></td><td></td><td></td><td class="num">${money(b.donors_total)}</td><td></td></tr>
          </table>
        </div>` : ''}
    </article>`;
}
