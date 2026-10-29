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
import { installA11y } from './core/a11y.js';

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

// Indikator "sedang memuat": baru tampil bila halaman butuh lebih dari LOADING_DELAY_MS (supaya tidak berkedip).
const LOADING_DELAY_MS = 150;
let routeToken = 0;

async function route() {
  if (appShell.hidden) return;
  const token = ++routeToken;
  const [name, query] = location.hash.replace(/^#\/?/, '').split('?');
  const viewName = VIEWS[name] && store.can(VIEWS[name].permission) ? name : DEFAULT_VIEW;
  const viewChanged = main.dataset.view !== viewName;
  $$('#flowNav a').forEach((a) => {
    const active = a.dataset.view === viewName;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  main.className = ''; // kelas tata letak khusus (mis. view-fill) dipasang ulang oleh view yang membutuhkannya
  main.setAttribute('aria-busy', 'true');
  const loadingTimer = setTimeout(() => main.classList.add('is-loading'), LOADING_DELAY_MS);
  try {
    await VIEWS[viewName].render(main, new URLSearchParams(query || ''), { refreshApp: loadReferenceData });
  } catch (err) {
    if (token === routeToken) {
      main.className = '';
      render(main, html`<div class="panel empty" role="alert">Gagal memuat halaman: ${err.message}
        <div class="toolbar toolbar-center"><button type="button" id="retryRoute">Coba lagi</button></div></div>`);
      $('#retryRoute', main)?.addEventListener('click', route);
    }
  } finally {
    clearTimeout(loadingTimer);
    if (token === routeToken) { main.classList.remove('is-loading'); main.removeAttribute('aria-busy'); }
  }
  main.dataset.view = viewName;
  // Pindah ke halaman lain: fokus ke judul halaman, supaya pengguna keyboard/pembaca layar mulai dari atas isi baru.
  if (viewChanged && token === routeToken && document.activeElement?.closest('#flowNav')) {
    const heading = $('h1', main);
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
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

installA11y();
boot();
