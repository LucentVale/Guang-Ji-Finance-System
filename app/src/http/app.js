// Server HTTP: melayani API (/api/...) dan file frontend (folder public).
//
// Bila login dimatikan (config.local.json: "loginRequired": false), semua permintaan dari komputer ini
// dilayani sebagai LOCAL_USER (Admin) dan permintaan dari luar ditolak.
//
// Urutan pemeriksaan setiap permintaan API:
//   1. cari route            4. hak akses peran (read / write / admin)
//   2. tolak lintas-situs    5. akses ke Fothang yang diminta
//   3. login (sesi cookie)   6. jalankan handler, lalu catat aktivitas bila mengubah data
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../lib/errors');
const { allows, canAccessFothang, LOCAL_USER } = require('../services/accessPolicy');
const { Router } = require('./router');
const { readRawBody, readJsonBody, sendResult, sendError, sendJson } = require('./respond');
const { readSessionToken, isCrossSite, isLocalRequest } = require('./session');

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];

const ROUTE_MODULES = [
  require('./routes/authRoutes'),
  require('./routes/userRoutes'),
  require('./routes/fothangRoutes'),
  require('./routes/posRoutes'),
  require('./routes/transactionRoutes'),
  require('./routes/importRoutes'),
  require('./routes/reportRoutes'),
  require('./routes/exportRoutes'),
];

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Header keamanan untuk semua respons.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
};

const forbidden = (message) => new AppError(403, message);
const unauthorized = () => new AppError(401, 'Silakan masuk terlebih dahulu');

function serveStatic(res, publicDir, pathname) {
  const file = path.normalize(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(publicDir)) return sendJson(res, 403, { error: 'Akses ditolak' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'File tidak ditemukan' });
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function createServer(ctx, config) {
  const loginRequired = config.auth.loginRequired;
  // Pengaman: mode tanpa login tidak boleh dipakai bila server bisa diakses dari komputer lain / internet.
  if (!loginRequired && !LOOPBACK_HOSTS.includes(config.host)) {
    throw new Error(`Mode tanpa login hanya boleh di komputer lokal, tetapi HOST=${config.host}. Aktifkan login (loginRequired: true).`);
  }

  const router = new Router();
  for (const register of ROUTE_MODULES) register(router, ctx);
  const { auth, audit, fothang } = ctx.services;

  async function handleApi(req, res, url) {
    const found = router.match(req.method, url.pathname);
    if (!found) return sendJson(res, 404, { error: 'Endpoint tidak ditemukan' });
    const { route, params } = found;
    const options = route.options;
    const isRead = req.method === 'GET';

    if (!isRead && isCrossSite(req)) throw forbidden('Permintaan dari situs lain ditolak');

    let user;
    if (loginRequired) user = auth.authenticate(readSessionToken(req));
    else {
      // Pengaman kedua: tanpa login, hanya permintaan langsung dari komputer ini yang dilayani (bukan lewat proxy).
      if (!isLocalRequest(req)) throw forbidden('Mode tanpa login hanya bisa dibuka dari komputer ini');
      user = LOCAL_USER;
    }
    if (!options.public) {
      if (!user) throw unauthorized();
      if (user.must_change_password && !options.allowWhilePasswordExpired) throw forbidden('Anda wajib mengganti kata sandi terlebih dahulu');
      const permission = options.permission || (isRead ? 'read' : 'write');
      if (!allows(user, permission)) throw forbidden('Peran Anda tidak diizinkan melakukan ini');
    }

    // Semua path ber-:fothangId divalidasi dulu; handler menerima id berupa angka.
    if (params.fothangId) {
      params.fothangId = fothang.get(params.fothangId).id;
      if (!canAccessFothang(user, params.fothangId)) throw forbidden('Anda tidak punya akses ke Fothang ini');
    }

    const cookies = [];
    const input = {
      req,
      user,
      params,
      query: Object.fromEntries(url.searchParams),
      body: !isRead && !options.rawBody ? await readJsonBody(req, config.maxUploadBytes) : {},
      rawBody: options.rawBody ? await readRawBody(req, config.maxUploadBytes) : null,
      setCookie: (cookie) => cookies.push(cookie),
    };
    const result = await route.handler(input);

    if (!isRead && user && options.audit !== false) {
      audit.record({
        user,
        action: options.audit || `${req.method} ${route.pattern}`,
        fothangId: params.fothangId ?? null,
        entityId: params.id ?? null,
        body: options.rawBody ? { file: req.headers['x-filename'] } : input.body,
      });
    }
    if (cookies.length) res.setHeader('Set-Cookie', cookies);
    sendResult(res, result);
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(res, config.publicDir, url.pathname);
    } catch (err) {
      sendError(res, err);
    }
  });
}

module.exports = { createServer };
