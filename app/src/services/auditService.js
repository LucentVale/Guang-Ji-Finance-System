// Catatan aktivitas: setiap perubahan data dicatat bersama pelakunya.
const MAX_DETAIL_LENGTH = 2000;
const SECRET_FIELDS = /pass(word)?|token/i;

/** Buang kolom rahasia dan potong isi yang terlalu panjang. */
function summarize(body) {
  if (!body || typeof body !== 'object' || !Object.keys(body).length) return '';
  const safe = JSON.stringify(body, (key, value) => (SECRET_FIELDS.test(key) ? '••••' : value));
  return safe.length > MAX_DETAIL_LENGTH ? `${safe.slice(0, MAX_DETAIL_LENGTH)}…` : safe;
}

module.exports = function auditService({ repos }) {
  return {
    /** entry: { user, action, fothangId, entityId, body } */
    record({ user, action, fothangId = null, entityId = null, body = null }) {
      repos.audit.insert({
        user_id: user?.id ?? null,
        username: user?.username ?? '(tanpa login)',
        fothang_id: fothangId,
        action,
        entity_id: entityId == null ? null : String(entityId),
        detail: summarize(body),
      });
    },

    /** Admin melihat semua; pengguna lain hanya aktivitas di Fothang yang boleh diaksesnya. */
    list(user, { limit = 200 } = {}) {
      return repos.audit.list({ fothangIds: user.role === 'admin' ? null : user.fothang_ids, limit: Math.min(Number(limit) || 200, 1000) });
    },
  };
};

module.exports.summarize = summarize;
