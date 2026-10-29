// Toast (pesan singkat), modal (dialog), dan attempt() untuk aksi async dengan umpan balik.
import { $, $$, html, render } from '../core/dom.js';
import { focusables } from '../core/a11y.js';

let toastTimer;
/**
 * Pesan singkat di pojok kanan bawah. Pesan biasa diumumkan sopan (role=status);
 * pesan galat diumumkan segera ke pembaca layar (role=alert) dan tampil lebih lama.
 */
export function toast(message, { error = false } = {}) {
  const el = $('#toast');
  el.hidden = true; // tampilkan ulang supaya pembaca layar mengumumkan pesan yang sama berturut-turut
  el.setAttribute('role', error ? 'alert' : 'status');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), error ? 6000 : 3000);
}

/**
 * Jalankan aksi async dengan umpan balik:
 *   - tombol yang memicu aksi (tombol yang sedang fokus) dinonaktifkan & diberi pemintal selama proses,
 *     supaya tidak terkirim dua kali
 *   - berhasil: toast successMessage (bila ada); gagal: pesan galat sebagai toast
 * @returns {Promise<boolean>} true bila berhasil
 */
export async function attempt(action, successMessage) {
  const button = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try {
    await action();
    if (successMessage) toast(successMessage);
    return true;
  } catch (err) {
    toast(err.message, { error: true });
    return false;
  } finally {
    if (button?.isConnected) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

let modalCount = 0;
/**
 * Tampilkan modal (dialog).
 *   - judul dihubungkan lewat aria-labelledby; fokus masuk ke isian pertama (atau ke dialog)
 *   - Tab / Shift+Tab berputar di dalam dialog; Esc atau klik latar menutup
 *   - setelah ditutup, fokus kembali ke elemen yang membuka dialog
 * @param {{title: string, body: any, footer: any, wide?: boolean}} parts konten hasil html``; wide = modal lebar untuk tabel
 * @returns {{root: HTMLElement, close: () => void}}
 */
export function openModal({ title, body, footer, wide = false }) {
  const host = $('#modalRoot');
  const opener = document.activeElement;
  const titleId = `modal-title-${++modalCount}`;
  render(host, html`
    <div class="modal-backdrop">
      <section class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
        <header><h2 id="${titleId}">${title}</h2><button type="button" class="btn-ghost" data-close aria-label="Tutup">✕</button></header>
        <div class="body">${body}</div>
        <footer>${footer}</footer>
      </section>
    </div>`);
  const dialog = $('.modal', host);

  const onKey = (e) => {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const items = focusables(dialog);
    if (!items.length) { e.preventDefault(); dialog.focus(); return; }
    const first = items[0];
    const last = items.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  function close() {
    host.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus();
  }
  document.addEventListener('keydown', onKey);
  $$('[data-close]', host).forEach((b) => b.addEventListener('click', close));
  $('.modal-backdrop', host).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-backdrop')) close(); });
  setTimeout(() => ($('input:not([disabled]), select:not([disabled]), textarea:not([disabled])', dialog) || dialog).focus(), 20);
  return { root: dialog, close };
}
