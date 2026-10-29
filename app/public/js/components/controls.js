// Kontrol kecil yang dipakai di banyak halaman.
import { html, on } from '../core/dom.js';

/**
 * Tombol segmen (pilih satu dari beberapa), mis. Rekap | Per Pos atau Semua | Masuk | Keluar.
 * Semantik: grup tombol toggle (role="group" + aria-pressed). Pembaca layar membacakan "ditekan" pada pilihan aktif.
 * @param {{name: string, label: string, options: {value: string, label: any, disabled?: boolean}[], current: string}} p
 *   name = pengenal grup (dipakai bindSegmented), label = nama grup untuk pembaca layar
 */
export function segmented({ name, label, options, current }) {
  return html`
    <div class="segmented" role="group" aria-label="${label}">
      ${options.map((o) => html`<button type="button" data-seg="${name}" value="${o.value}" class="${o.value === current ? 'on' : ''}"
        aria-pressed="${String(o.value === current)}" ${o.disabled ? 'disabled' : ''}>${o.label}</button>`)}
    </div>`;
}

/** Tandai pilihan aktif pada grup segmen `name` di dalam root (tanpa memicu onChange). */
export function setSegmented(root, name, value) {
  root.querySelectorAll(`[data-seg="${name}"]`).forEach((b) => {
    const isOn = b.value === value;
    b.classList.toggle('on', isOn);
    b.setAttribute('aria-pressed', String(isOn));
  });
}

/** Pasang klik pada grup segmen `name`: tandai pilihan, lalu panggil onChange(value). */
export function bindSegmented(root, name, onChange) {
  on(root, 'click', `[data-seg="${name}"]`, (e, btn) => {
    setSegmented(root, name, btn.value);
    onChange(btn.value);
  });
}

/** Tunda pemanggilan fn sampai pengguna berhenti mengetik selama `ms` milidetik (kotak cari). */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Jeda standar kotak cari (ms). */
export const SEARCH_DELAY_MS = 200;
