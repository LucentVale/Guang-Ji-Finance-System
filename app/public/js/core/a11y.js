// Aksesibilitas yang berlaku untuk seluruh aplikasi, dipasang sekali dari main.js.
//
// Baris tabel yang bisa diklik (tr.clickable / tr.viewable / tr.go-row) dibuat bisa dipakai dengan keyboard:
//   - diberi tabindex="0" supaya bisa dicapai dengan Tab (termasuk baris yang digambar ulang belakangan)
//   - Enter / Spasi pada baris = klik baris itu
// Baris yang berisi kontrol sendiri (mis. pilihan pos di Draf) tetap bisa difokus; tombol di dalamnya
// tidak ikut terpicu karena hanya penekanan tombol pada BARIS itu sendiri yang diteruskan sebagai klik.

const ROW_SELECTOR = 'tr.clickable, tr.viewable, tr.go-row';

function enhanceRows(root) {
  root.querySelectorAll?.(`:is(${ROW_SELECTOR}):not([tabindex])`).forEach((tr) => tr.setAttribute('tabindex', '0'));
}

export function installA11y() {
  enhanceRows(document);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && (n.matches?.(ROW_SELECTOR) ? n.setAttribute('tabindex', '0') : enhanceRows(n)));
  }).observe(document.body, { childList: true, subtree: true });

  // "Lewati ke isi halaman": aplikasi memakai routing hash, jadi href="#view" tidak boleh mengubah alamat —
  // cukup pindahkan fokus ke isi halaman.
  document.getElementById('skipLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('view')?.focus();
  });

  document.addEventListener('keydown', (e) => {
    const row = e.target;
    if (!(row instanceof HTMLTableRowElement) || !row.matches(ROW_SELECTOR)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Spasi tidak menggulir halaman
      row.click();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Panah atas/bawah: pindah ke baris berikut/sebelumnya di tabel yang sama (tabel panjang tidak perlu di-Tab satu per satu).
      const rows = [...row.closest('table').querySelectorAll(ROW_SELECTOR)].filter((r) => !r.hidden);
      const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }); }
    }
  });
}

/** Elemen yang bisa difokus di dalam root (urutan Tab). */
export const focusables = (root) => [...root.querySelectorAll(
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
)].filter((el) => el.offsetParent !== null || el === document.activeElement);
