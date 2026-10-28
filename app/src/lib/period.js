// Helper tanggal & periode bulanan. Tanggal selalu string ISO "YYYY-MM-DD" agar mudah dibandingkan di SQL.
const { badRequest } = require('./errors');

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const pad2 = (n) => String(n).padStart(2, '0');

/** Rentang satu bulan: from (inklusif) dan to (eksklusif). */
function monthRange(year, month) {
  return {
    from: `${year}-${pad2(month)}-01`,
    to: month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`,
  };
}

/** Rentang satu tahun: from (inklusif) dan to (eksklusif). */
function yearRange(year) {
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
}

const monthName = (month) => MONTH_NAMES[month - 1];
const monthOf = (isoDate) => Number(isoDate.slice(5, 7));
const dayOf = (isoDate) => Number(isoDate.slice(8, 10));

function assertIsoDate(value, label = 'Tanggal') {
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value));
  if (!ok) throw badRequest(`${label} tidak valid`);
  return value;
}

function assertYear(value) {
  const y = Number(value);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest('Tahun tidak valid');
  return y;
}

function assertMonth(value) {
  const m = Number(value);
  if (!Number.isInteger(m) || m < 1 || m > 12) throw badRequest('Bulan tidak valid');
  return m;
}

module.exports = { MONTH_NAMES, monthRange, yearRange, monthName, monthOf, dayOf, pad2, assertIsoDate, assertYear, assertMonth };
