// Riwayat aktivitas: siapa mengubah apa dan kapan (terbaru di atas).
import { html, render } from '../core/dom.js';
import { api } from '../core/api.js';

export async function riwayatView(main) {
  const [entries, fothangs] = await Promise.all([api.audit({ limit: 300 }), api.listFothang()]);
  const fothangName = (id) => fothangs.find((f) => f.id === id)?.short_name ?? '';

  render(main, html`
    <div class="view-head">
      <div><h1>Riwayat Aktivitas</h1><p class="sub">300 aktivitas terakhir: login, impor mutasi, perubahan transaksi, pengaturan, dan pengguna.</p></div>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Waktu</th><th>Pengguna</th><th>Fothang</th><th>Aktivitas</th><th>Rincian</th></tr></thead>
        <tbody>${entries.length ? entries.map((e) => html`
          <tr>
            <td class="muted nowrap">${e.at}</td>
            <td class="mono">${e.username}</td>
            <td>${fothangName(e.fothang_id)}</td>
            <td class="${e.action.startsWith('Gagal') ? 'neg' : ''}">${e.action}${e.entity_id ? html` <span class="muted">#${e.entity_id}</span>` : ''}</td>
            <td class="mono audit-detail">${e.detail}</td>
          </tr>`) : html`<tr><td colspan="5" class="empty">Belum ada aktivitas.</td></tr>`}
        </tbody>
      </table>
    </div>`);
}
