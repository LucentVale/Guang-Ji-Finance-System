// Langkah 4 — Cek Saldo: mutasi, draf, dan laporan per pos harus cocok sebelum laporan dibuat PDF.
import { $, html, render } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, MONTHS } from '../core/format.js';
import { monthOptions, defaultMonth } from '../components/options.js';

export async function cekView(main, params) {
  const month = Number(params.get('month')) || defaultMonth();
  const r = await api.get('/cek', { year: store.year, month });
  const period = `${MONTHS[month - 1]} ${store.year}`;
  const totals = r.pos.reduce((t, p) => ({ opening: t.opening + p.opening, masuk: t.masuk + p.masuk, keluar: t.keluar + p.keluar, closing: t.closing + p.closing }),
    { opening: 0, masuk: 0, keluar: 0, closing: 0 });

  render(main, html`
    <div class="view-head">
      <div>
        <h1>4. Cek Saldo — ${period}</h1>
        <p class="sub">Memastikan saldo awal & akhir pembukuan sama dengan rekening koran, saldo Draf cocok di setiap baris,
          dan semua transaksi sudah masuk ke pos. Bila semua ✓, laporan siap dibuat PDF.</p>
      </div>
      <div class="toolbar">
        <select id="monthSel" aria-label="Bulan">${monthOptions(month)}</select>
        ${r.ready
          ? html`<a class="btn btn-primary" href="#/laporan?month=${month}">Lanjut ke 5. Laporan PDF →</a>`
          : html`<a class="btn" href="#/draf?month=${month}">Perbaiki di Draf</a>`}
      </div>
    </div>

    <p class="notice ${r.ready ? 'notice-ok' : ''}">${r.ready ? `✓ Semua pemeriksaan lolos. Laporan ${period} siap dibuat.` : `Masih ada yang belum cocok untuk ${period}.`}</p>

    <div class="cols" style="margin-bottom:14px">
      <section class="panel">
        <h2>Pemeriksaan</h2>
        <ul class="checklist">${r.checks.map((c) => html`
          <li class="${c.ok ? 'ok' : 'fail'}"><span class="mark">${c.ok ? '✓' : '✗'}</span><span>${c.label}</span><span class="detail">${c.detail}</span></li>`)}
        </ul>
      </section>
      <section class="panel">
        <h2>Akun: Pembukuan vs Rekening Koran</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Akun</th><th class="num">Saldo Awal</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo Akhir</th><th class="num">Saldo Bank</th></tr></thead>
          <tbody>${r.accounts.map((a) => html`<tr>
            <td>${a.name}</td><td class="${numClass(a.opening)}">${money(a.opening)}</td><td class="num in">${money(a.masuk)}</td><td class="num out">${money(a.keluar)}</td>
            <td class="${numClass(a.closing)}">${money(a.closing)}</td>
            <td class="num ${a.statement_closing == null ? 'muted' : a.statement_closing === a.closing ? 'in' : 'neg'}">${a.statement_closing == null ? '—' : money(a.statement_closing)}</td></tr>`)}
          </tbody></table></div>
      </section>
    </div>

    <section class="panel">
      <h2>Ringkasan per Pos — ${period}</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>No</th><th>Pos</th><th class="num">Saldo Awal</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo Akhir</th></tr></thead>
        <tbody>${r.pos.map((p) => html`<tr class="clickable" data-pos="${p.pos_id}">
          <td>${p.number}</td><td>${p.name} <span class="muted mono">${p.code}</span></td>
          <td class="${numClass(p.opening)}">${money(p.opening)}</td><td class="num in">${p.masuk ? money(p.masuk) : ''}</td>
          <td class="num out">${p.keluar ? money(p.keluar) : ''}</td><td class="${numClass(p.closing)}">${money(p.closing)}</td></tr>`)}
        </tbody>
        <tfoot><tr><td></td><td>Total</td><td class="num">${money(totals.opening)}</td><td class="num">${money(totals.masuk)}</td><td class="num">${money(totals.keluar)}</td><td class="num">${money(totals.closing)}</td></tr></tfoot>
      </table></div>
    </section>`);

  $('#monthSel').addEventListener('change', (e) => (location.hash = `#/cek?month=${e.target.value}`));
  main.querySelectorAll('tr[data-pos]').forEach((tr) => tr.addEventListener('click', () => (location.hash = `#/tahunan?sheet=${tr.dataset.pos}`)));
}
