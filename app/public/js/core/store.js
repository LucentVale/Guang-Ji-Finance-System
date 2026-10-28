// State global aplikasi: Fothang & tahun yang dipilih, serta data referensi (akun, pos).
// Pilihan pengguna diingat di localStorage (bila tersedia).

const saved = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key, value) => { try { localStorage.setItem(key, value); } catch { /* mode privat */ } };

export const store = {
  /** Pengguna yang sedang login: { username, full_name, role, role_label, permissions } */
  user: null,
  /** false = mode tanpa login (diatur di app/config.local.json) */
  loginRequired: true,
  /** Izin per peran (sama dengan src/services/accessPolicy.js; server tetap memeriksa ulang). */
  rolePermissions: { admin: ['read', 'write', 'admin'], bendahara: ['read', 'write'], pimpinan: ['read'] },
  can(permission) { return !!this.user && (this.rolePermissions[this.user.role] || []).includes(permission); },

  fothangList: [],
  fothangId: Number(saved('fothangId')) || null,
  year: Number(saved('year')) || new Date().getFullYear(),
  accounts: [],
  pos: [],

  get fothang() { return this.fothangList.find((f) => f.id === this.fothangId); },
  get bankAccounts() { return this.accounts.filter((a) => a.kind === 'bank'); },
  posById(id) { return this.pos.find((p) => p.id === Number(id)); },
  accountById(id) { return this.accounts.find((a) => a.id === Number(id)); },

  setFothang(id) { this.fothangId = Number(id); remember('fothangId', id); },
  setYear(year) { this.year = Number(year); remember('year', year); },
};
