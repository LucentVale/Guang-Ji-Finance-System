// Helper DOM kecil. `html` adalah template tag yang otomatis meng-escape nilai,
// sehingga nama donatur dsb. tidak pernah dianggap sebagai HTML.
//
//   html`<td>${nama}</td>`            -> nama di-escape
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`  -> hasil html bersarang tidak di-escape ulang
//   ${kondisi && html`...`}           -> false/null/undefined menjadi teks kosong
// Atribut ARIA bernilai boolean wajib ditulis eksplisit: aria-pressed="${String(aktif)}" (false -> "false").

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

function toHtml(value) {
  if (value == null || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(toHtml).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  return new SafeHtml(strings.reduce((out, str, i) => out + str + (i < values.length ? toHtml(values[i]) : ''), ''));
}

/** Sisipkan HTML apa adanya (hanya untuk string yang kita buat sendiri, bukan input pengguna). */
export const raw = (value) => new SafeHtml(String(value));

export function render(element, content) {
  element.innerHTML = toHtml(content);
  return element;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Pasang satu listener untuk banyak elemen anak: on(table, 'click', 'tr[data-id]', (e, tr) => ...). */
export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}
