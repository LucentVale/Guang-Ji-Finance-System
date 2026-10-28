// Grafik SVG sederhana untuk Dashboard (tanpa library luar).
// Aturan tampilan (lihat panduan data-viz): batang <= 24px dengan ujung membulat 4px dan pangkal rata,
// celah 2px antar batang yang bersentuhan, garis 2px, grid tipis & samar, teks memakai warna teks (bukan warna seri),
// legenda untuk >= 2 seri, dan tooltip saat kursor diarahkan.
import { html, raw, escapeHtml } from '../core/dom.js';
import { money, MONTHS } from '../core/format.js';

export const SERIES = { masuk: 'var(--series-1)', keluar: 'var(--series-2)' };
const W = 640;
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;

/** Angka ringkas untuk sumbu: 1,2 M / 350 jt / 25 rb. */
export function compact(n) {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const fmt = (v) => v.toLocaleString('id-ID', { maximumFractionDigits: v < 10 ? 1 : 0 });
  if (a >= 1e9) return `${sign}${fmt(a / 1e9)} M`;
  if (a >= 1e6) return `${sign}${fmt(a / 1e6)} jt`;
  if (a >= 1e3) return `${sign}${fmt(a / 1e3)} rb`;
  return `${sign}${fmt(a)}`;
}

/** Skala "rapi": batas atas & jarak tick yang bulat (1, 2, 2.5, 5 × 10^n). */
function niceScale(min, max, ticks = 4) {
  if (min === max) { max = max === 0 ? 1 : max * 1.1; min = Math.min(0, min); }
  const raw = (max - min) / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const values = [];
  for (let v = lo; v <= hi + step / 2; v += step) values.push(Math.round(v * 100) / 100);
  return { lo, hi, values };
}

/**
 * Batang vertikal: ujung data membulat, pangkal (garis nol) rata.
 * Untuk nilai negatif ujung membulatnya di bawah.
 */
function columnPath(x, w, yBase, yValue) {
  const r = Math.min(RADIUS, w / 2, Math.abs(yBase - yValue));
  if (yValue <= yBase) {
    return `M${x},${yBase}V${yValue + r}Q${x},${yValue} ${x + r},${yValue}H${x + w - r}Q${x + w},${yValue} ${x + w},${yValue + r}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yValue - r}Q${x},${yValue} ${x + r},${yValue}H${x + w - r}Q${x + w},${yValue} ${x + w},${yValue - r}V${yBase}Z`;
}

/** Batang horizontal dari garis nol: ujung data membulat. */
function barPath(xBase, xValue, y, h) {
  const r = Math.min(RADIUS, h / 2, Math.abs(xValue - xBase));
  if (xValue >= xBase) {
    return `M${xBase},${y}H${xValue - r}Q${xValue},${y} ${xValue},${y + r}V${y + h - r}Q${xValue},${y + h} ${xValue - r},${y + h}H${xBase}Z`;
  }
  return `M${xBase},${y}H${xValue + r}Q${xValue},${y} ${xValue},${y + r}V${y + h - r}Q${xValue},${y + h} ${xValue + r},${y + h}H${xBase}Z`;
}

function gridAndAxis(scale, y, left, right) {
  return scale.values.map((v) => `
    <line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="grid${v === 0 ? ' zero' : ''}"/>
    <text x="${left - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${escapeHtml(compact(v))}</text>`).join('');
}

const legend = (items) => html`
  <div class="chart-legend">${items.map((i) => html`<span><i style="background:${i.color}"></i>${i.label}</span>`)}</div>`;

/** Teks tooltip: baris "label: nilai" dipisah "|" (dibaca oleh attachTooltips). */
const tip = (title, rows) => escapeHtml([title, ...rows.map(([k, v]) => `${k}: Rp ${money(v)}`)].join('|'));

/**
 * Kolom berkelompok per bulan (Masuk & Keluar).
 * @param {{month:number, masuk:number, keluar:number}[]} months
 */
export function monthlyFlowChart(months, { lastMonth = 12 } = {}) {
  const H = 240;
  const pad = { l: 64, r: 8, t: 12, b: 28 };
  const visible = months.slice(0, Math.max(lastMonth, 1));
  const scale = niceScale(0, Math.max(...visible.flatMap((m) => [m.masuk, m.keluar]), 0));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - scale.lo) / (scale.hi - scale.lo));
  const band = (W - pad.l - pad.r) / visible.length;
  const bw = Math.min(BAR_MAX, (band * 0.7 - GAP) / 2);

  let marks = '';
  visible.forEach((m, i) => {
    const cx = pad.l + band * i + band / 2;
    marks += `<path d="${columnPath(cx - bw - GAP / 2, bw, y(0), y(m.masuk))}" fill="${SERIES.masuk}"/>`;
    marks += `<path d="${columnPath(cx + GAP / 2, bw, y(0), y(m.keluar))}" fill="${SERIES.keluar}"/>`;
    marks += `<text x="${cx}" y="${H - 8}" class="tick" text-anchor="middle">${MONTHS[m.month - 1].slice(0, 3)}</text>`;
    // Area sentuh selebar satu bulan, lebih besar dari batangnya.
    marks += `<rect x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${H - pad.t - pad.b}" class="hit"
      data-tip="${tip(`${MONTHS[m.month - 1]}`, [['Masuk', m.masuk], ['Keluar', m.keluar]])}"/>`;
  });

  return html`
    ${legend([{ label: 'Pemasukan', color: SERIES.masuk }, { label: 'Pengeluaran', color: SERIES.keluar }])}
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Pemasukan dan pengeluaran per bulan">
      ${raw(gridAndAxis(scale, y, pad.l, W - pad.r))}${raw(marks)}
    </svg>`;
}

/**
 * Garis saldo per bulan (satu seri; judul kartu sudah menyebutkan isinya, jadi tanpa legenda).
 * Nilai null (bulan tanpa data) tidak digambar.
 */
export function balanceLineChart(months, { label = 'Saldo' } = {}) {
  const H = 240;
  const pad = { l: 64, r: 70, t: 12, b: 28 };
  const points = months.filter((m) => m.saldo != null);
  if (!points.length) return html`<p class="muted empty">Belum ada data.</p>`;
  const scale = niceScale(Math.min(0, ...points.map((m) => m.saldo)), Math.max(...points.map((m) => m.saldo)));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - scale.lo) / (scale.hi - scale.lo));
  const step = (W - pad.l - pad.r) / 11;
  const x = (month) => pad.l + step * (month - 1);

  const d = points.map((m, i) => `${i ? 'L' : 'M'}${x(m.month)},${y(m.saldo)}`).join('');
  const last = points.at(-1);
  let marks = `<path d="${d}" class="line" stroke="${SERIES.masuk}"/>`;
  marks += `<circle cx="${x(last.month)}" cy="${y(last.saldo)}" r="5" class="dot" fill="${SERIES.masuk}"/>`;
  marks += `<text x="${x(last.month) + 10}" y="${y(last.saldo) + 4}" class="value-label">${escapeHtml(compact(last.saldo))}</text>`;
  months.forEach((m) => {
    marks += `<text x="${x(m.month)}" y="${H - 8}" class="tick" text-anchor="middle">${MONTHS[m.month - 1].slice(0, 3)}</text>`;
    if (m.saldo != null) {
      marks += `<rect x="${x(m.month) - step / 2}" y="${pad.t}" width="${step}" height="${H - pad.t - pad.b}" class="hit"
        data-crosshair="${x(m.month)}" data-tip="${tip(MONTHS[m.month - 1], [[label, m.saldo]])}"/>`;
    }
  });

  return html`
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${label} per bulan">
      ${raw(gridAndAxis(scale, y, pad.l, W - pad.r))}
      <line class="crosshair" y1="${pad.t}" y2="${H - pad.b}" x1="0" x2="0" visibility="hidden"/>
      ${raw(marks)}
    </svg>`;
}

/**
 * Batang horizontal berurutan (satu seri), mendukung nilai negatif.
 * @param {{label:string, value:number, id?:any}[]} items
 */
export function rankedBarChart(items, { color = SERIES.masuk, labelWidth = 170 } = {}) {
  if (!items.length) return html`<p class="muted empty">Belum ada data.</p>`;
  const rowH = 30;
  const barH = Math.min(BAR_MAX - 6, rowH - 10);
  const pad = { l: labelWidth, r: 96, t: 4, b: 4 };
  const H = pad.t + pad.b + rowH * items.length;
  const lo = Math.min(0, ...items.map((i) => i.value));
  const hi = Math.max(0, ...items.map((i) => i.value));
  const x = (v) => pad.l + (W - pad.l - pad.r) * ((v - lo) / ((hi - lo) || 1));

  let marks = `<line x1="${x(0)}" x2="${x(0)}" y1="${pad.t}" y2="${H - pad.b}" class="grid zero"/>`;
  items.forEach((item, i) => {
    const top = pad.t + rowH * i;
    const yBar = top + (rowH - barH) / 2;
    const valueX = item.value >= 0 ? x(item.value) + 6 : x(0) + 6;
    marks += `<text x="${pad.l - 10}" y="${top + rowH / 2 + 4}" class="cat-label" text-anchor="end">${escapeHtml(item.label)}</text>`;
    if (item.value !== 0) marks += `<path d="${barPath(x(0), x(item.value), yBar, barH)}" fill="${color}"/>`;
    marks += `<text x="${valueX}" y="${top + rowH / 2 + 4}" class="value-label${item.value < 0 ? ' neg' : ''}">${escapeHtml(compact(item.value))}</text>`;
    marks += `<rect x="0" y="${top}" width="${W}" height="${rowH}" class="hit" ${item.id != null ? `data-id="${escapeHtml(item.id)}"` : ''}
      data-tip="${tip(item.label, [['Jumlah', item.value]])}"/>`;
  });

  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Perbandingan nilai">${raw(marks)}</svg>`;
}

/** Garis mini di tabel (tren saldo bulanan). */
export function sparkline(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return '';
  const w = 90;
  const h = 24;
  const lo = Math.min(...pts.map(([, v]) => v));
  const hi = Math.max(...pts.map(([, v]) => v));
  const x = (i) => 2 + ((w - 4) * i) / 11;
  const y = (v) => (hi === lo ? h / 2 : 3 + (h - 6) * (1 - (v - lo) / (hi - lo)));
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return raw(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline" aria-hidden="true"><path d="${d}"/></svg>`);
}

/** Pasang tooltip & crosshair pada semua elemen [data-tip] di dalam root. */
export function attachTooltips(root) {
  let box = document.querySelector('.chart-tip');
  if (!box) {
    box = document.createElement('div');
    box.className = 'chart-tip';
    box.hidden = true;
    document.body.append(box);
  }
  root.addEventListener('mousemove', (e) => {
    const target = e.target.closest('[data-tip]');
    const svg = e.target.closest('svg');
    svg?.querySelector('.crosshair')?.setAttribute('visibility', target?.dataset.crosshair ? 'visible' : 'hidden');
    if (!target) { box.hidden = true; return; }
    if (target.dataset.crosshair) {
      const line = svg.querySelector('.crosshair');
      line.setAttribute('x1', target.dataset.crosshair);
      line.setAttribute('x2', target.dataset.crosshair);
    }
    const [title, ...rows] = target.dataset.tip.split('|');
    box.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = title;
    box.append(strong, ...rows.map((r) => Object.assign(document.createElement('div'), { textContent: r })));
    box.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - box.offsetWidth - 8);
    box.style.left = `${x}px`;
    box.style.top = `${e.clientY + 14}px`;
  });
  root.addEventListener('mouseleave', () => { box.hidden = true; });
}
