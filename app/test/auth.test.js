// Uji keamanan login & hak akses lewat HTTP sungguhan (server dijalankan di port acak).
const test = require('node:test');
const assert = require('node:assert/strict');
const baseConfig = require('../src/config');
const { createContext } = require('../src/context');
const { createServer } = require('../src/http/app');
const { hashPassword, verifyPassword, passwordProblem } = require('../src/lib/password');

const ADMIN = { username: 'admin', full_name: 'Admin Yayasan', password: 'rahasia123' };

/** Jalankan server dengan database kosong + 2 Fothang. Mengembalikan helper request. */
async function startApp({ loginRequired = true } = {}) {
  // Pengaturan login dibuat eksplisit agar tes tidak bergantung pada config.local.json di komputer ini.
  const config = { ...baseConfig, host: '127.0.0.1', auth: { ...baseConfig.auth, loginRequired } };
  const ctx = createContext(':memory:', { seed: false, config });
  const f1 = ctx.services.fothang.create({ code: 'SATU', name: 'Satu Fo Thang', start_date: '2026-01-01' });
  const f2 = ctx.services.fothang.create({ code: 'DUA', name: 'Dua Fo Thang', start_date: '2026-01-01' });
  const server = createServer(ctx, config);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** Klien sederhana yang menyimpan cookie sesi seperti browser. */
  function client() {
    let cookie = '';
    return async function call(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
      return { status: res.status, data, setCookie };
    };
  }

  test.after(() => server.close());
  return { ctx, f1, f2, client, base };
}

test('kata sandi di-hash dan diverifikasi; kata sandi lemah ditolak', () => {
  const stored = hashPassword('rahasia123');
  assert.ok(stored.startsWith('scrypt$'));
  assert.ok(!stored.includes('rahasia123'));
  assert.ok(verifyPassword('rahasia123', stored));
  assert.ok(!verifyPassword('rahasia124', stored));
  assert.match(passwordProblem('pendek1'), /minimal/);
  assert.match(passwordProblem('hanyahuruf'), /huruf dan angka/);
  assert.match(passwordProblem('budi12345', 'budi'), /nama pengguna/);
});

test('alur keamanan lengkap', async (t) => {
  const { ctx, f1, f2, client } = await startApp();
  const anon = client();
  const admin = client();

  await t.test('tanpa login: data ditolak, halaman tetap bisa dibuka', async () => {
    assert.equal((await anon('GET', '/api/fothang')).status, 401);
    assert.equal((await anon('GET', `/api/fothang/${f1.id}/tabel?year=2026`)).status, 401);
    assert.equal((await anon('GET', '/')).status, 200);
  });

  await t.test('Admin pertama hanya dari komputer server dan hanya sekali', async () => {
    assert.equal((await anon('GET', '/api/auth/status')).data.setup_needed, true);
    const viaProxy = await anon('POST', '/api/auth/setup', ADMIN, { 'X-Forwarded-For': '203.0.113.9' });
    assert.equal(viaProxy.status, 403);

    const res = await admin('POST', '/api/auth/setup', ADMIN);
    assert.equal(res.status, 200);
    assert.match(res.setCookie, /HttpOnly/);
    assert.match(res.setCookie, /SameSite=Strict/);
    assert.equal((await anon('POST', '/api/auth/setup', { ...ADMIN, username: 'admin2' })).status, 409);
  });

  await t.test('login salah memberi pesan umum, lalu dikunci setelah 5 kali', async () => {
    const guest = client();
    const unknown = await guest('POST', '/api/auth/login', { username: 'tidakada', password: 'x' });
    const wrong = await guest('POST', '/api/auth/login', { username: 'admin', password: 'salah' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.data.error, wrong.data.error);
    for (let i = 0; i < 4; i++) await guest('POST', '/api/auth/login', { username: 'admin', password: 'salah' });
    assert.equal((await guest('POST', '/api/auth/login', { username: 'admin', password: ADMIN.password })).status, 429);
    ctx.repos.user.recordFailure(ctx.repos.user.findByUsername('admin').id, 0, null); // buka kunci untuk tes berikutnya
  });

  const bendahara = client();
  const pimpinan = client();
  await t.test('Admin membuat Bendahara (Fothang SATU) dan Pimpinan', async () => {
    assert.equal((await admin('POST', '/api/users', { username: 'bendahara1', full_name: 'Bendahara Satu', role: 'bendahara', password: 'sementara1', fothang_ids: [f1.id] })).status, 201);
    assert.equal((await admin('POST', '/api/users', { username: 'pimpinan', full_name: 'Pimpinan', role: 'pimpinan', password: 'sementara2', fothang_ids: [f1.id, f2.id], must_change_password: false })).status, 201);
    assert.equal((await bendahara('POST', '/api/auth/login', { username: 'bendahara1', password: 'sementara1' })).status, 200);
    assert.equal((await pimpinan('POST', '/api/auth/login', { username: 'pimpinan', password: 'sementara2' })).status, 200);
  });

  await t.test('kata sandi sementara wajib diganti sebelum memakai aplikasi', async () => {
    assert.equal((await bendahara('GET', '/api/fothang')).status, 403);
    assert.equal((await bendahara('POST', '/api/auth/change-password', { current_password: 'sementara1', new_password: 'baruAman99' })).status, 200);
    assert.equal((await bendahara('GET', '/api/fothang')).status, 200);
  });

  await t.test('Bendahara: hanya Fothang-nya, boleh input transaksi, tidak boleh pengaturan', async () => {
    const list = (await bendahara('GET', '/api/fothang')).data;
    assert.deepEqual(list.map((f) => f.code), ['SATU']);
    assert.equal((await bendahara('GET', `/api/fothang/${f2.id}/tabel?year=2026`)).status, 403);

    const pos = ctx.services.pos.create(f1.id, { number: 1, code: 'CU THAN', name: 'Cu Than' });
    const bca = ctx.repos.account.listByFothang(f1.id)[0];
    const created = await bendahara('POST', `/api/fothang/${f1.id}/transactions`, { date: '2026-01-05', account_id: bca.id, pos_id: pos, name: 'Donatur Uji', masuk: 100000 });
    assert.equal(created.status, 201);
    assert.equal((await bendahara('POST', `/api/fothang/${f1.id}/pos`, { number: 2, code: 'BARU', name: 'Baru' })).status, 403);
    assert.equal((await bendahara('GET', '/api/users')).status, 403);
    assert.equal((await bendahara('GET', '/api/backup')).status, 403);
  });

  await t.test('Pimpinan: hanya melihat', async () => {
    assert.equal((await pimpinan('GET', `/api/fothang/${f1.id}/tabel?year=2026`)).status, 200);
    assert.equal((await pimpinan('GET', `/api/fothang/${f2.id}/tabel?year=2026`)).status, 200);
    const bca = ctx.repos.account.listByFothang(f1.id)[0];
    assert.equal((await pimpinan('POST', `/api/fothang/${f1.id}/transactions`, { date: '2026-01-05', account_id: bca.id, name: 'x', masuk: 1 })).status, 403);
  });

  await t.test('permintaan dari situs lain ditolak', async () => {
    const bca = ctx.repos.account.listByFothang(f1.id)[0];
    const res = await admin('POST', `/api/fothang/${f1.id}/transactions`, { date: '2026-01-01', account_id: bca.id, name: 'A', masuk: 1 }, { Origin: 'https://situs-jahat.example' });
    assert.equal(res.status, 403);
  });

  await t.test('catatan aktivitas mencatat pelaku, tanpa kata sandi', async () => {
    const log = (await admin('GET', '/api/audit')).data;
    const tx = log.find((e) => e.action === 'Menambah transaksi');
    assert.equal(tx.username, 'bendahara1');
    assert.ok(!JSON.stringify(log).includes('sementara1'));
    assert.ok(log.some((e) => e.action.startsWith('Gagal masuk')));
  });

  await t.test('pengguna yang dinonaktifkan langsung keluar', async () => {
    const id = ctx.repos.user.findByUsername('pimpinan').id;
    assert.equal((await admin('PUT', `/api/users/${id}`, { full_name: 'Pimpinan', role: 'pimpinan', active: false, fothang_ids: [f1.id] })).status, 200);
    assert.equal((await pimpinan('GET', '/api/fothang')).status, 401);
  });

  await t.test('Admin terakhir tidak bisa diturunkan', async () => {
    const id = ctx.repos.user.findByUsername('admin').id;
    assert.equal((await admin('PUT', `/api/users/${id}`, { full_name: 'Admin', role: 'pimpinan', fothang_ids: [f1.id] })).status, 409);
  });

  await t.test('keluar menghapus sesi', async () => {
    await admin('POST', '/api/auth/logout');
    assert.equal((await admin('GET', '/api/fothang')).status, 401);
  });
});

test('mode tanpa login: hanya dari komputer ini, dan tidak bisa dipakai di server online', async () => {
  const { ctx: appCtx, f1, client } = await startApp({ loginRequired: false });
  const local = client();

  const status = (await local('GET', '/api/auth/status')).data;
  assert.equal(status.login_required, false);
  assert.equal(status.setup_needed, false);
  assert.equal((await local('GET', `/api/fothang/${f1.id}/tabel?year=2026`)).status, 200);
  const bca = appCtx.repos.account.listByFothang(f1.id)[0];
  assert.equal((await local('POST', `/api/fothang/${f1.id}/transactions`, { date: '2026-01-01', account_id: bca.id, name: 'A', masuk: 1 })).status, 201);

  // Permintaan yang diteruskan proxy (dari internet) ditolak.
  const proxied = await local('GET', `/api/fothang/${f1.id}/tabel?year=2026`, null, { 'X-Forwarded-For': '203.0.113.9' });
  assert.equal(proxied.status, 403);

  // Server menolak berjalan tanpa login bila bisa diakses dari komputer lain.
  const ctx = createContext(':memory:', { seed: false });
  assert.throws(() => createServer(ctx, { ...baseConfig, host: '0.0.0.0', auth: { ...baseConfig.auth, loginRequired: false } }), /Mode tanpa login/);
});
