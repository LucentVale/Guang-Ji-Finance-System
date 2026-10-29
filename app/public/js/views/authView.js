// Layar sebelum masuk aplikasi: masuk (login), buat Admin pertama, dan wajib ganti kata sandi.
import { $, html, render } from '../core/dom.js';
import { api } from '../core/api.js';

const card = (title, sub, body) => html`
  <section class="auth-card">
    <img class="logo" src="img/logo-emblem.png" alt="Logo Yayasan Guang Ji">
    <h1>${title}</h1>
    <p class="sub">${sub}</p>
    ${body}
  </section>`;

/** Pasang submit handler: tombol dinonaktifkan selama proses, error tampil di kartu. */
function handleSubmit(root, action) {
  const form = $('form', root);
  const error = $('.error', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    error.hidden = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await action(Object.fromEntries(new FormData(form)));
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
      $('input', form)?.focus();
    }
  });
  setTimeout(() => $('input', form)?.focus(), 20);
}

/** @param {() => void} onSignedIn dipanggil setelah berhasil masuk */
export function showLogin(root, onSignedIn) {
  render(root, card('Sistem Keuangan Guang Ji', 'Silakan masuk dengan akun Anda', html`
    <form>
      <label>Nama pengguna<input name="username" autocomplete="username" required></label>
      <label>Kata sandi<input name="password" type="password" autocomplete="current-password" required></label>
      <p class="error" role="alert" hidden></p>
      <button type="submit" class="btn-primary">Masuk</button>
      <p class="hint">Lupa kata sandi? Hubungi Admin Yayasan untuk mengatur ulang.</p>
    </form>`));
  handleSubmit(root, async ({ username, password }) => {
    await api.auth.login(username, password);
    onSignedIn();
  });
}

/** Membuat akun Admin pertama (hanya muncul saat belum ada pengguna sama sekali). */
export function showSetup(root, { allowedHere }, onSignedIn) {
  if (!allowedHere) {
    render(root, card('Belum ada akun Admin', 'Aplikasi belum disiapkan', html`
      <p class="hint">Akun Admin pertama hanya bisa dibuat langsung di komputer server, atau lewat perintah
        <span class="mono">npm run create-admin</span>. Hubungi pengelola aplikasi.</p>`));
    return;
  }
  render(root, card('Selamat datang', 'Buat akun Admin Yayasan pertama untuk mulai memakai aplikasi', html`
    <form>
      <label>Nama lengkap<input name="full_name" required autocomplete="name"></label>
      <label>Nama pengguna<input name="username" required autocomplete="username" placeholder="huruf kecil, mis. admin"></label>
      <label>Kata sandi<input name="password" type="password" required autocomplete="new-password"></label>
      <label>Ulangi kata sandi<input name="password2" type="password" required autocomplete="new-password"></label>
      <p class="hint">Minimal 8 karakter, berisi huruf dan angka.</p>
      <p class="error" role="alert" hidden></p>
      <button type="submit" class="btn-primary">Buat Akun Admin</button>
    </form>`));
  handleSubmit(root, async (data) => {
    if (data.password !== data.password2) throw new Error('Kedua kata sandi tidak sama');
    await api.auth.setup({ full_name: data.full_name, username: data.username, password: data.password });
    onSignedIn();
  });
}

/** Wajib ganti kata sandi sementara yang diberikan Admin. */
export function showForcedPasswordChange(root, user, onDone) {
  render(root, card(`Halo, ${user.full_name}`, 'Kata sandi Anda masih sementara. Silakan buat kata sandi baru.', html`
    <form>
      <label>Kata sandi sementara<input name="current" type="password" required autocomplete="current-password"></label>
      <label>Kata sandi baru<input name="next" type="password" required autocomplete="new-password"></label>
      <label>Ulangi kata sandi baru<input name="next2" type="password" required autocomplete="new-password"></label>
      <p class="hint">Minimal 8 karakter, berisi huruf dan angka.</p>
      <p class="error" role="alert" hidden></p>
      <button type="submit" class="btn-primary">Simpan Kata Sandi</button>
    </form>`));
  handleSubmit(root, async ({ current, next, next2 }) => {
    if (next !== next2) throw new Error('Kedua kata sandi baru tidak sama');
    await api.auth.changePassword(current, next);
    onDone();
  });
}
