// Bantuan routing (hash). Router-nya sendiri ada di main.js.

/** Gambar ulang halaman yang sedang dibuka (mis. setelah data diubah dari dialog). */
export const refreshView = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
