// Helper teks kecil yang dipakai di banyak tempat.

/** Rapikan spasi (termasuk non-breaking space dari file bank). */
const clean = (value) => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

/** "PELITA ULAMBANA" -> "Pelita Ulambana". */
const titleCase = (value) => clean(value).toLowerCase().replace(/(^|[\s(\-/&])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());

const upper = (value) => clean(value).toUpperCase();

module.exports = { clean, titleCase, upper };
