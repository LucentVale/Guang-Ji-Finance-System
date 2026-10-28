// Hash kata sandi dengan scrypt (bawaan Node.js). Format tersimpan: scrypt$N$r$p$salt$hash (base64).
const crypto = require('node:crypto');

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MIN_LENGTH = 8;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

/** Pesan kesalahan bila kata sandi terlalu lemah, atau null bila boleh dipakai. */
function passwordProblem(password, username = '') {
  const pw = String(password ?? '');
  if (pw.length < MIN_LENGTH) return `Kata sandi minimal ${MIN_LENGTH} karakter`;
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) return 'Kata sandi tidak boleh mengandung nama pengguna';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Kata sandi harus berisi huruf dan angka';
  return null;
}

/** Token acak untuk sesi + hash-nya (yang disimpan di database). */
function newToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = { hashPassword, verifyPassword, passwordProblem, newToken, hashToken, MIN_LENGTH };
