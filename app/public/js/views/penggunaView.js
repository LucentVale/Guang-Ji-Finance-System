// Kelola pengguna (khusus Admin): tambah, ubah peran & akses Fothang, nonaktifkan, atur ulang kata sandi.
import { $, $$, html, render, on } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { openModal, attempt } from '../components/feedback.js';

const ROLE_HELP = {
  admin: 'Semua akses, termasuk pengaturan dan pengguna. Otomatis bisa membuka semua Fothang.',
  bendahara: 'Impor mutasi, Draf, input transaksi, cetak laporan untuk Fothang yang dipilih.',
  pimpinan: 'Hanya melihat laporan, Cek Saldo, dan riwayat Fothang yang dipilih. Tidak bisa mengubah data.',
};
const ROLE_LABEL = { admin: 'Admin Yayasan', bendahara: 'Bendahara Fothang', pimpinan: 'Pimpinan' };

export async function penggunaView(main) {
  const [users, fothangs] = await Promise.all([api.users.list(), api.listFothang()]);
  const fothangName = (id) => fothangs.find((f) => f.id === id)?.short_name ?? `#${id}`;
  const reload = () => penggunaView(main);

  render(main, html`
    <div class="view-head">
      <div><h1>Pengguna</h1><p class="sub">Siapa saja yang boleh masuk, perannya, dan Fothang yang boleh dibuka.</p></div>
      <button class="btn-primary" id="addUser">+ Pengguna</button>
    </div>
    <div class="table-wrap">
      <table class="table" id="userTable">
        <thead><tr><th>Nama</th><th>Nama Pengguna</th><th>Peran</th><th>Fothang</th><th>Terakhir Masuk</th><th>Status</th></tr></thead>
        <tbody>${users.map((u) => html`
          <tr class="clickable" data-id="${u.id}">
            <td><b>${u.full_name}</b>${u.id === store.user.id ? html` <span class="badge">Anda</span>` : ''}</td>
            <td class="mono">${u.username}</td>
            <td>${u.role_label}</td>
            <td>${u.role === 'admin' ? html`<span class="muted">Semua</span>` : u.fothang_ids.map(fothangName).join(', ')}</td>
            <td class="muted">${u.last_login_at ? new Date(u.last_login_at).toLocaleString('id-ID') : 'Belum pernah'}</td>
            <td>${!u.active ? html`<span class="badge">Nonaktif</span>` : u.must_change_password ? html`<span class="badge badge-warn">Kata sandi sementara</span>` : html`<span class="badge badge-ok">Aktif</span>`}</td>
          </tr>`)}
        </tbody>
      </table>
    </div>`);

  $('#addUser', main).addEventListener('click', () => openUserForm(null, fothangs, reload));
  on($('#userTable', main), 'click', 'tr[data-id]', (e, tr) => openUserForm(users.find((u) => u.id === Number(tr.dataset.id)), fothangs, reload));
}

function openUserForm(user, fothangs, onSaved) {
  const isNew = !user;
  const { root, close } = openModal({
    title: isNew ? 'Pengguna Baru' : `Ubah Pengguna — ${user.username}`,
    body: html`
      <form class="form-grid" id="userForm">
        <label class="full">Nama lengkap<input name="full_name" required value="${user?.full_name || ''}"></label>
        <label>Nama pengguna<input name="username" required ${isNew ? '' : 'disabled'} value="${user?.username || ''}" placeholder="mis. bendahara.kuanghang"></label>
        <label>Peran<select name="role">${Object.entries(ROLE_LABEL).map(([v, l]) => html`<option value="${v}" ${user?.role === v ? 'selected' : ''}>${l}</option>`)}</select></label>
        <p class="full hint" id="roleHelp"></p>
        <fieldset class="full fieldset" id="fothangBox">
          <legend>Fothang yang boleh dibuka</legend>
          ${fothangs.map((f) => html`<label class="check"><input type="checkbox" name="fothang" value="${f.id}" ${user?.fothang_ids.includes(f.id) || (isNew && fothangs.length === 1) ? 'checked' : ''}> ${f.name}</label>`)}
        </fieldset>
        ${isNew ? html`
          <label class="full">Kata sandi sementara<input name="password" required autocomplete="new-password">
            <span>Berikan ke pengguna; ia wajib menggantinya saat pertama masuk. Min. 8 karakter, huruf & angka.</span></label>` : html`
          <label class="check full"><input type="checkbox" name="active" ${user.active ? 'checked' : ''}> Aktif (boleh masuk)</label>`}
      </form>`,
    footer: html`
      <div>${isNew ? '' : html`<button data-act="reset">Atur ulang kata sandi</button>`}</div>
      <div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-act="save">Simpan</button></div>`,
  });

  const form = $('#userForm', root);
  const syncRole = () => {
    const role = form.role.value;
    $('#roleHelp', root).textContent = ROLE_HELP[role];
    $('#fothangBox', root).hidden = role === 'admin';
  };
  form.role.addEventListener('change', syncRole);
  syncRole();

  $('[data-act="save"]', root).addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    const body = {
      full_name: data.full_name,
      role: data.role,
      fothang_ids: $$('input[name="fothang"]:checked', form).map((c) => Number(c.value)),
      ...(isNew ? { username: data.username, password: data.password } : { active: !!data.active }),
    };
    const ok = await attempt(() => (isNew ? api.users.create(body) : api.users.update(user.id, body)), 'Pengguna disimpan');
    if (ok) { close(); onSaved(); }
  });

  $('[data-act="reset"]', root)?.addEventListener('click', async () => {
    const password = prompt(`Kata sandi sementara baru untuk ${user.username} (min. 8 karakter, huruf & angka):`);
    if (!password) return;
    const ok = await attempt(() => api.users.resetPassword(user.id, password), 'Kata sandi diatur ulang. Pengguna wajib menggantinya saat masuk.');
    if (ok) { close(); onSaved(); }
  });
}
