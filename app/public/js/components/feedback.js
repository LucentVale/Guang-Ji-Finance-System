// Toast (pesan singkat) dan modal (dialog).
import { $, $$, html, render } from '../core/dom.js';

let toastTimer;
export function toast(message, { error = false } = {}) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${error ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), error ? 6000 : 3000);
}

/** Jalankan aksi async; tampilkan error sebagai toast. Mengembalikan true bila berhasil. */
export async function attempt(action, successMessage) {
  try {
    await action();
    if (successMessage) toast(successMessage);
    return true;
  } catch (err) {
    toast(err.message, { error: true });
    return false;
  }
}

/**
 * Tampilkan modal.
 * @param {{title: string, body: any, footer: any, wide?: boolean}} parts konten hasil html``; wide = modal lebar untuk tabel
 * @returns {{root: HTMLElement, close: () => void}}
 */
export function openModal({ title, body, footer, wide = false }) {
  const host = $('#modalRoot');
  render(host, html`
    <div class="modal-backdrop">
      <section class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
        <header><h3>${title}</h3><button class="btn-ghost" data-close aria-label="Tutup">✕</button></header>
        <div class="body">${body}</div>
        <footer>${footer}</footer>
      </section>
    </div>`);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    host.innerHTML = '';
    document.removeEventListener('keydown', onKey);
  }
  document.addEventListener('keydown', onKey);
  $$('[data-close]', host).forEach((b) => b.addEventListener('click', close));
  $('.modal-backdrop', host).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-backdrop')) close(); });
  setTimeout(() => $('input:not([disabled]), select', host)?.focus(), 20);
  return { root: $('.modal', host), close };
}
