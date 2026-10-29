// Aturan hak akses. Satu-satunya tempat yang menentukan peran mana boleh melakukan apa.
//
//   read  : melihat data & laporan                       -> admin, bendahara, pimpinan
//   write : impor mutasi, input/ubah transaksi          -> admin, bendahara
//   admin : pengaturan Fothang/akun/pos, pengguna, backup -> admin
//
// Selain peran, pengguna non-admin hanya boleh mengakses Fothang yang ditugaskan kepadanya.

const ROLES = {
  admin: { label: 'Admin Yayasan', permissions: ['read', 'write', 'admin'] },
  bendahara: { label: 'Bendahara Fothang', permissions: ['read', 'write'] },
  pimpinan: { label: 'Pimpinan', permissions: ['read'] },
};

const isRole = (role) => Object.hasOwn(ROLES, role);

/** @param {{role: string}} user  @param {'read'|'write'|'admin'} permission */
const allows = (user, permission) => !!user && user.active !== false && (ROLES[user.role]?.permissions.includes(permission) ?? false);

/** @param {{role: string, fothang_ids: number[]}} user */
const canAccessFothang = (user, fothangId) => !!user && (user.role === 'admin' || user.fothang_ids.includes(Number(fothangId)));

/**
 * Pengguna bawaan saat login dimatikan (config.auth.loginRequired = false).
 * Berperan Admin, tetapi hanya dilayani untuk permintaan dari komputer ini sendiri (lihat src/http/app.js).
 */
const LOCAL_USER = Object.freeze({
  id: null,
  username: 'lokal',
  full_name: 'Pengguna Lokal',
  role: 'admin',
  role_label: 'Mode tanpa login',
  active: true,
  must_change_password: false,
  fothang_ids: [],
});

module.exports = { ROLES, isRole, allows, canAccessFothang, LOCAL_USER };
