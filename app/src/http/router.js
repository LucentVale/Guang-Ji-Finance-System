// Router HTTP minimal. Pola path memakai ":nama" untuk parameter, mis. "/api/fothang/:fothangId/pos/:id".
//
// Handler: async ({ req, user, params, query, body, rawBody, setCookie }) => hasil
//   - hasil berupa object/array dikirim sebagai JSON
//   - hasil dari reply.file(...) / reply.created(...) diperlakukan khusus (lihat respond.js)
//
// Opsi route (argumen ke-3):
//   public: true          -> boleh tanpa login
//   permission            -> 'read' | 'write' | 'admin' (default: GET = read, lainnya = write; lihat accessPolicy.js)
//   audit                 -> label catatan aktivitas, atau false agar tidak dicatat (default: "<METHOD> <pola path>")
//   rawBody: true         -> body tidak di-parse sebagai JSON (mis. upload file)
//   allowWhilePasswordExpired: true -> tetap bisa dipakai walau pengguna wajib ganti kata sandi

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`);
    this.routes.push({ method, pattern, regex, keys, handler, options });
    return this;
  }

  get(pattern, handler, options) { return this.add('GET', pattern, handler, options); }
  post(pattern, handler, options) { return this.add('POST', pattern, handler, options); }
  put(pattern, handler, options) { return this.add('PUT', pattern, handler, options); }
  delete(pattern, handler, options) { return this.add('DELETE', pattern, handler, options); }

  /** Cari route yang cocok. Mengembalikan { route, params } atau null. */
  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = pathname.match(route.regex);
      if (m) return { route, params: Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

module.exports = { Router };
