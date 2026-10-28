// Cookie sesi & pemeriksaan keamanan permintaan.
const COOKIE_NAME = 'gj_sid';

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const readSessionToken = (req) => parseCookies(req.headers.cookie)[COOKIE_NAME] || null;

/**
 * HttpOnly: tidak bisa dibaca JavaScript (aman dari XSS).
 * SameSite=Strict: tidak ikut terkirim dari situs lain (melindungi dari CSRF).
 * Secure: hanya lewat HTTPS (aktifkan saat online).
 */
function sessionCookie(token, { maxAgeSeconds, secure }) {
  return [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${maxAgeSeconds}`, secure ? 'Secure' : '']
    .filter(Boolean).join('; ');
}

const clearedSessionCookie = ({ secure }) => sessionCookie('', { maxAgeSeconds: 0, secure });

/**
 * Permintaan langsung dari komputer server itu sendiri (bukan diteruskan reverse proxy).
 * Dipakai untuk membatasi pembuatan Admin pertama.
 */
function isLocalRequest(req) {
  const addr = req.socket.remoteAddress;
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const forwarded = req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-real-ip'];
  return loopback && !forwarded;
}

/** Tolak permintaan pengubah data yang berasal dari situs lain (header Origin berbeda host). */
function isCrossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.host; } catch { return true; }
}

module.exports = { COOKIE_NAME, readSessionToken, sessionCookie, clearedSessionCookie, isLocalRequest, isCrossSite };
