// Kartu pengguna di bawah sidebar: inisial, nama, peran, ganti kata sandi, keluar.
import { $, html, render } from '../core/dom.js';
import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { openModal, attempt } from './feedback.js';

const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase();

export function renderUserMenu(el, { onSignedOut }) {
  const u = store.user;
  if (!store.loginRequired) {
    render(el, html`
      <span class="avatar" aria-hidden="true">${initial(u.full_name)}</span>
      <span class="who" title="Login dimatikan di app/config.local.json. Hanya bisa dibuka dari komputer ini.">
        <strong>${u.full_name}</strong><small>Mode tanpa login</small></span>`);
    return;
  }
  render(el, html`
    <span class="avatar" aria-hidden="true">${initial(u.full_name)}</span>
    <span class="who"><strong>${u.full_name}</strong><small>${u.role_label}</small></span>
    <button data-act="password" title="Ganti kata sandi" aria-label="Ganti kata sandi">🔑</button>
    <button data-act="logout" title="Keluar">Keluar</button>`);
  $('[data-act="password"]', el).addEventListener('click', openChangePassword);
  $('[data-act="logout"]', el).addEventListener('click', async () => {
    await api.auth.logout().catch(() => {});
    onSignedOut();
  });
}

function openChangePassword() {
  const { root, close } = openModal({
    title: 'Ganti Kata Sandi',
    body: html`
      <form class="form-grid" id="pwForm">
        <label class="full">Kata sandi lama<input name="current" type="password" required autocomplete="current-password"></label>
        <label>Kata sandi baru<input name="next" type="password" required autocomplete="new-password"></label>
        <label>Ulangi kata sandi baru<input name="next2" type="password" required autocomplete="new-password"></label>
        <p class="full muted" style="margin:0;font-size:12px">Minimal 8 karakter, berisi huruf dan angka. Perangkat lain yang sedang masuk dengan akun ini akan otomatis keluar.</p>
      </form>`,
    footer: html`<div></div><div class="toolbar"><button data-close>Batal</button><button class="btn-primary" data-act="save">Simpan</button></div>`,
  });
  $('[data-act="save"]', root).addEventListener('click', async () => {
    const form = $('#pwForm', root);
    if (!form.reportValidity()) return;
    const { current, next, next2 } = Object.fromEntries(new FormData(form));
    if (next !== next2) return attempt(() => Promise.reject(new Error('Kedua kata sandi baru tidak sama')));
    if (await attempt(() => api.auth.changePassword(current, next), 'Kata sandi diganti')) close();
  });
}
