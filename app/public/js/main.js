// Titik masuk frontend.
//   1. cek status login -> tampilkan layar masuk / buat Admin / ganti kata sandi bila perlu
//   2. setelah masuk: muat data referensi, atur header (Fothang, tahun, pengguna), jalankan router halaman
import { $, $$, html, render } from './core/dom.js';
import { api, setSessionExpiredHandler } from './core/api.js';
import { store } from './core/store.js';
import { renderUserMenu } from './components/userMenu.js';
import { showLogin, showSetup, showForcedPasswordChange } from './views/authView.js';
import { dashboardView } from './views/dashboardView.js';
import { mutasiView } from './views/mutasiView.js';
import { drafView } from './views/drafView.js';
import { workbookView } from './views/workbookView.js';
import { cekView } from './views/cekView.js';
import { laporanView } from './views/laporanView.js';
import { riwayatView } from './views/riwayatView.js';
import { penggunaView } from './views/penggunaView.js';
import { pengaturanView } from './views/pengaturanView.js';

// permission: izin minimal untuk membuka halaman (lihat store.can)
const VIEWS = {
  dashboard: { render: dashboardView, permission: 'read' },
  mutasi: { render: mutasiView, permission: 'read' },
  draf: { render: drafView, permission: 'read' },
  tahunan: { render: workbookView, permission: 'read' },
  cek: { render: cekView, permission: 'read' },
  laporan: { render: laporanView, permission: 'read' },
  riwayat: { render: riwayatView, permission: 'read' },
  pengguna: { render: penggunaView, permission: 'admin' },
  pengaturan: { render: pengaturanView, permission: 'admin' },
};
const DEFAULT_VIEW = 'dashboard';

const main = $('#view');
const authScreen = $('#authScreen');
const appShell = $('#appShell');

// ---------------------------------------------------------------- Login

function showAuthScreen() {
  appShell.hidden = true;
  authScreen.hidden = false;
  $('#modalRoot').innerHTML = '';
}

/** Tentukan layar berdasarkan status login di server. */
async function boot() {
  let status;
  try {
    status = await api.auth.status();
  } catch (err) {
    showAuthScreen();
    return render(authScreen, html`<div class="auth-card empty">Tidak bisa terhubung ke server: ${err.message}</div>`);
  }
  store.user = status.user;
  store.loginRequired = status.login_required;
  document.body.classList.toggle('login-off', !store.loginRequired);

  if (!store.loginRequired) return openApp(); // mode tanpa login: langsung masuk aplikasi

  if (status.setup_needed) {
    showAuthScreen();
    return showSetup(authScreen, { allowedHere: status.setup_allowed_here }, boot);
  }
  if (!store.user) {
    showAuthScreen();
    return showLogin(authScreen, boot);
  }
  if (store.user.must_change_password) {
    showAuthScreen();
    return showForcedPasswordChange(authScreen, store.user, boot);
  }
  await openApp();
}

// Sesi habis di tengah pemakaian (mis. lama tidak aktif) -> kembali ke layar masuk.
setSessionExpiredHandler(() => {
  if (!appShell.hidden) boot();
});

// ---------------------------------------------------------------- Aplikasi

/** Muat daftar Fothang yang boleh diakses, lalu akun & pos milik Fothang terpilih. */
async function loadReferenceData() {
  store.fothangList = await api.listFothang();
  if (!store.fothang) store.setFothang(store.fothangList[0]?.id);
  if (store.fothangId) [store.accounts, store.pos] = await Promise.all([api.get('/accounts'), api.get('/pos')]);
  renderHeader();
}

function renderHeader() {
  const f = store.fothang;
  $('#fothangName').textContent = f ? f.name : '—';
  render($('#fothangSelect'), store.fothangList.map((x) => html`<option value="${x.id}" ${x.id === store.fothangId ? 'selected' : ''}>${x.short_name}</option>`));

  const startYear = Number((f?.start_date || String(store.year)).slice(0, 4));
  const lastYear = Math.max(startYear, new Date().getFullYear()) + 1;
  if (store.year < startYear || store.year > lastYear) store.setYear(Math.min(Math.max(store.year, startYear), lastYear));
  const years = Array.from({ length: lastYear - startYear + 1 }, (_, i) => startYear + i);
  render($('#yearSelect'), years.map((y) => html`<option ${y === store.year ? 'selected' : ''}>${y}</option>`));

  document.body.classList.toggle('can-write', store.can('write'));
  document.body.classList.toggle('can-admin', store.can('admin'));
  renderUserMenu($('#userMenu'), { onSignedOut: boot });
}

async function openApp() {
  authScreen.hidden = true;
  appShell.hidden = false;
  await loadReferenceData();
  if (!store.fothangId) {
    return render(main, html`<div class="panel empty">Akun Anda belum diberi akses ke Fothang mana pun. Hubungi Admin Yayasan.</div>`);
  }
  route();
}

async function route() {
  if (appShell.hidden) return;
  const [name, query] = location.hash.replace(/^#\/?/, '').split('?');
  const viewName = VIEWS[name] && store.can(VIEWS[name].permission) ? name : DEFAULT_VIEW;
  $$('#flowNav a').forEach((a) => a.classList.toggle('active', a.dataset.view === viewName));
  try {
    await VIEWS[viewName].render(main, new URLSearchParams(query || ''), { refreshApp: loadReferenceData });
  } catch (err) {
    render(main, html`<div class="panel empty">Gagal memuat halaman: ${err.message}</div>`);
  }
}

$('#fothangSelect').addEventListener('change', async (e) => {
  store.setFothang(e.target.value);
  await loadReferenceData();
  route();
});
$('#yearSelect').addEventListener('change', (e) => {
  store.setYear(e.target.value);
  route();
});
window.addEventListener('hashchange', route);

boot();
