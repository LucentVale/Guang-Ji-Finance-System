// Pemanggilan API server. Semua endpoint data berada di bawah /api/fothang/:id (lihat src/http/routes).
// Sesi login memakai cookie HttpOnly, jadi tidak ada token yang disimpan di JavaScript.
import { store } from './store.js';

/** Dipanggil bila sesi habis (401), mis. untuk menampilkan halaman masuk lagi. Diisi oleh main.js. */
let onSessionExpired = () => {};
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const isJson = body !== undefined && !(body instanceof Blob);
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: isJson ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: isJson ? JSON.stringify(body) : body,
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (res.status === 401 && !path.startsWith('/api/auth/')) onSessionExpired();
  if (!res.ok) throw new Error(data?.error || `Permintaan gagal (${res.status})`);
  return data;
}

/** Path endpoint milik Fothang yang sedang dipilih. */
const scoped = (path) => `/api/fothang/${store.fothangId}${path}`;

const query = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  return q.toString() ? `?${q}` : '';
};

export const api = {
  get: (path, params) => request(scoped(path) + query(params)),
  post: (path, body) => request(scoped(path), { method: 'POST', body }),
  put: (path, body) => request(scoped(path), { method: 'PUT', body }),
  del: (path) => request(scoped(path), { method: 'DELETE' }),

  /** Upload file mentah (mis. mutasi .xlsx). */
  upload: (path, file) => request(scoped(path), { method: 'POST', body: file, headers: { 'X-Filename': encodeURIComponent(file.name) } }),

  /** URL unduhan (Excel) untuk dipakai di <a href>. */
  downloadUrl: (path, params) => scoped(path) + query(params),

  // Endpoint global (tidak terikat satu Fothang)
  listFothang: () => request('/api/fothang'),
  createFothang: (body) => request('/api/fothang', { method: 'POST', body }),
  updateFothang: (id, body) => request(`/api/fothang/${id}`, { method: 'PUT', body }),

  auth: {
    status: () => request('/api/auth/status'),
    setup: (body) => request('/api/auth/setup', { method: 'POST', body }),
    login: (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } }),
    logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),
    changePassword: (current_password, new_password) => request('/api/auth/change-password', { method: 'POST', body: { current_password, new_password } }),
  },

  users: {
    list: () => request('/api/users'),
    create: (body) => request('/api/users', { method: 'POST', body }),
    update: (id, body) => request(`/api/users/${id}`, { method: 'PUT', body }),
    resetPassword: (id, password) => request(`/api/users/${id}/reset-password`, { method: 'POST', body: { password } }),
  },

  audit: (params) => request(`/api/audit${query(params)}`),
};
