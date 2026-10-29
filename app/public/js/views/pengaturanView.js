// Pengaturan: data Fothang, akun (BCA, Kas Kecil), daftar pos & saldo awal, tambah Fothang baru, backup.
import { $, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { money, numClass, parseAmount, dateId } from '../core/format.js';
import { openModal, attempt } from '../components/feedback.js';

/** @param {() => Promise<void>} refreshApp muat ulang data referensi (Fothang, akun, pos) setelah perubahan */
export async function pengaturanView(main, params, { refreshApp }) {
  const f = store.fothang;
  const posList = await api.get('/pos', { all: 1 });
  const accounts = store.accounts;
  const reload = async () => { await refreshApp(); pengaturanView(main, params, { refreshApp }); };

  const openingTotal = (accountId) => posList.reduce((s, p) => s + (p.openings[accountId] || 0), 0);

  render(main, html`
    <div class="view-head">
      <div><h1>Pengaturan — ${f.name}</h1><p class="sub">Data Fothang, akun, dan pos. Saldo awal berlaku per ${dateId(f.start_date)}.</p></div>
      <div class="toolbar">
        <a class="btn" href="/api/backup">⭳ Backup Database</a>
        <button id="newFothang">+ Fothang Baru</button>
      </div>
    </div>
    <div class="stack">
      <div class="cols">
        <section class="panel">
          <h2>Data Fothang</h2>
          <form class="form-grid" id="fothangForm">
            <label>Kode<input name="code" required value="${f.code}"></label>
            <label>Nama singkat (judul laporan)<input name="short_name" required value="${f.short_name}"></label>
            <label class="full">Nama lengkap<input name="name" required value="${f.name}"></label>
            <label>Mulai pembukuan (saldo awal)<input type="date" name="start_date" required value="${f.start_date}"></label>
            <div class="align-end"><button class="btn-primary" type="submit">Simpan</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="toolbar toolbar-between mb-2"><h2 class="mb-0">Akun</h2><button class="btn-small" id="addAccount">+ Akun</button></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Nama</th><th>Jenis</th><th>No. Rekening</th><th class="num">Saldo Awal Akun</th><th class="num">Total Saldo Awal Pos</th></tr></thead>
            <tbody>${accounts.map((a) => {
              const diff = Math.round((a.opening - openingTotal(a.id)) * 100);
              return html`<tr class="clickable" data-account="${a.id}">
                <td><b>${a.name}</b></td><td>${a.kind === 'bank' ? 'Bank' : 'Kas'}</td><td class="mono">${a.account_no}</td>
                <td class="${numClass(a.opening)}">${money(a.opening)}</td>
                <td class="num ${diff ? 'neg' : 'in'}">${money(openingTotal(a.id))} ${diff ? '≠' : '✓'}</td></tr>`;
            })}</tbody>
          </table></div>
          <p class="hint mt-2">Saldo awal akun harus sama dengan jumlah saldo awal semua pos di akun itu (✓), supaya Tabel tidak menunjukkan selisih.</p>
        </section>
      </div>

      <section class="panel">
        <div class="toolbar toolbar-between mb-2"><h2 class="mb-0">Pos Keuangan</h2><button class="btn-small btn-primary" id="addPos">+ Pos</button></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>No. Sheet</th><th>Kode</th><th>Nama</th><th>Alias kode mutasi</th>${accounts.map((a) => html`<th class="num">Saldo Awal ${a.name}</th>`)}<th>Daftar Donatur</th><th>Status</th></tr></thead>
          <tbody>${posList.map((p) => html`<tr class="clickable" data-pos="${p.id}">
            <td>${p.number}</td><td><b>${p.code}</b></td><td>${p.name}</td><td class="mono">${p.aliases}</td>
            ${accounts.map((a) => html`<td class="${numClass(p.openings[a.id] || 0)}">${money(p.openings[a.id] || 0)}</td>`)}
            <td>${p.show_donors ? '✓' : ''}</td>
            <td>${p.active ? html`<span class="badge badge-ok">Aktif</span>` : html`<span class="badge">Nonaktif</span>`}</td></tr>`)}
          </tbody>
        </table></div>
      </section>
    </div>`);

  $('#fothangForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await attempt(() => api.updateFothang(f.id, Object.fromEntries(new FormData(e.target))), 'Data Fothang disimpan')) reload();
  });
  $('#newFothang').addEventListener('click', () => openFothangForm(reload));
  $('#addAccount').addEventListener('click', () => openAccountForm(null, reload));
  $('#addPos').addEventListener('click', () => openPosForm(null, posList, reload));
  on($('.stack', main), 'click', 'tr[data-account]', (e, tr) => openAccountForm(store.accountById(tr.dataset.account), reload));
  on($('.stack', main), 'click', 'tr[data-pos]', (e, tr) => openPosForm(posList.find((p) => p.id === Number(tr.dataset.pos)), posList, reload));
}

function openPosForm(pos, posList, onSaved) {
  const nextNumber = Math.max(0, ...posList.map((p) => p.number)) + 1;
  const { root, close } = openModal({
    title: pos ? `Ubah Pos ${pos.code}` : 'Pos Baru',
    body: html`
      <form class="form-grid" id="posForm">
        <label>No. sheet<input name="number" type="number" min="1" required value="${pos?.number ?? nextNumber}"></label>
        <label>Kode (seperti di kolom C mutasi)<input name="code" required value="${pos?.code || ''}" placeholder="mis. CU THAN"></label>
        <label class="full">Nama<input name="name" required value="${pos?.name || ''}" placeholder="mis. Cu Than"></label>
        <label class="full">Alias kode mutasi (pisahkan dengan koma)
          <input name="aliases" value="${pos?.aliases || ''}" placeholder="mis. KELAS,SXY  atau  PAT WU AI LIU=Wu Ai Liu">
          <span>Format <span class="mono">KODE=Kategori</span> memberi kategori otomatis untuk kode tersebut.</span></label>
        ${store.accounts.map((a) => html`<label>Saldo awal ${a.name}<input name="opening_${a.id}" inputmode="decimal" value="${money(pos?.openings[a.id] || 0)}"></label>`)}
        <label class="check full"><input type="checkbox" name="show_donors" ${pos?.show_donors ? 'checked' : ''}> Tampilkan Daftar Donatur di laporan bulanan</label>
        <label class="check full"><input type="checkbox" name="active" ${!pos || pos.active ? 'checked' : ''}> Aktif</label>
      </form>`,
    footer: html`<div>${pos ? html`<button class="btn-danger" data-act="delete">Hapus</button>` : ''}</div>
      <div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-act="save">Simpan</button></div>`,
  });

  $('[data-act="save"]', root).addEventListener('click', async () => {
    const form = $('#posForm', root);
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const body = {
      number: Number(data.number), code: data.code, name: data.name, aliases: data.aliases,
      show_donors: !!data.show_donors, active: !!data.active,
      openings: Object.fromEntries(store.accounts.map((a) => [a.id, parseAmount(data[`opening_${a.id}`])])),
    };
    if (await attempt(() => (pos ? api.put(`/pos/${pos.id}`, body) : api.post('/pos', body)), 'Pos disimpan')) { close(); onSaved(); }
  });
  $('[data-act="delete"]', root)?.addEventListener('click', async () => {
    if (confirm(`Hapus pos ${pos.code}?`) && await attempt(() => api.del(`/pos/${pos.id}`), 'Pos dihapus')) { close(); onSaved(); }
  });
}

function openAccountForm(account, onSaved) {
  const { root, close } = openModal({
    title: account ? `Ubah Akun ${account.name}` : 'Akun Baru',
    body: html`
      <form class="form-grid" id="accountForm">
        <label>Nama<input name="name" required value="${account?.name || ''}" placeholder="mis. BCA, Kas Kecil"></label>
        <label>Jenis<select name="kind">
          <option value="bank" ${account?.kind !== 'cash' ? 'selected' : ''}>Bank (bisa impor mutasi)</option>
          <option value="cash" ${account?.kind === 'cash' ? 'selected' : ''}>Kas tunai</option></select></label>
        <label>No. Rekening<input name="account_no" value="${account?.account_no || ''}"></label>
        <label>Saldo awal<input name="opening" inputmode="decimal" value="${money(account?.opening || 0)}"></label>
        <label>Urutan<input name="sort" type="number" value="${account?.sort ?? store.accounts.length + 1}"></label>
      </form>`,
    footer: html`<div></div><div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-act="save">Simpan</button></div>`,
  });
  $('[data-act="save"]', root).addEventListener('click', async () => {
    const form = $('#accountForm', root);
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const body = { ...data, opening: parseAmount(data.opening) };
    if (await attempt(() => (account ? api.put(`/accounts/${account.id}`, body) : api.post('/accounts', body)), 'Akun disimpan')) { close(); onSaved(); }
  });
}

function openFothangForm(onSaved) {
  const { root, close } = openModal({
    title: 'Fothang Baru',
    body: html`
      <p class="muted">Setiap Fothang punya pembukuan sendiri (akun, pos, transaksi). Akun BCA dan Kas Kecil dibuat otomatis.</p>
      <form class="form-grid" id="newFothangForm">
        <label>Kode<input name="code" required placeholder="mis. KUANG-MING"></label>
        <label>Nama singkat<input name="short_name" required placeholder="mis. Kuang Ming"></label>
        <label class="full">Nama lengkap<input name="name" required placeholder="mis. Kuang Ming Fo Thang"></label>
        <label>Mulai pembukuan<input type="date" name="start_date" required value="${store.year}-01-01"></label>
        <label>Salin daftar pos dari<select name="copy_pos_from"><option value="">— tidak —</option>
          ${store.fothangList.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>
      </form>`,
    footer: html`<div></div><div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-act="save">Buat Fothang</button></div>`,
  });
  $('[data-act="save"]', root).addEventListener('click', async () => {
    const form = $('#newFothangForm', root);
    if (!form.reportValidity()) return;
    let created;
    if (await attempt(async () => { created = await api.createFothang(Object.fromEntries(new FormData(form))); }, 'Fothang dibuat')) {
      store.setFothang(created.id);
      close();
      onSaved();
    }
  });
}
