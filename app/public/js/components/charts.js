// Grafik SVG sederhana untuk Dashboard (tanpa library luar).
// Aturan tampilan (lihat panduan data-viz): ujung batang membulat 4px dengan pangkal rata, garis 2px,
// grid tipis & samar, teks memakai warna teks (bukan warna seri), satu seri per grafik (kecuali Pemasukan vs
// Pengeluaran, yang diberi legenda), dan tooltip saat kursor diarahkan.
// Batang horizontal maksimal 24px; batang "mini" di kartu ringkasan sengaja lebih lebar mengikuti desain referensi.
import { html, raw, escapeHtml } from '../core/dom.js';
import { money, MONTHS } from '../core/format.js';

// Warna mengikuti tema oranye logo (lihat css/base.css). Satu seri per grafik, jadi tidak perlu palet kategori.
export const COLORS = {
  accent: 'var(--accent)',               // batang utama
  accentLine: 'var(--accent-strong)',    // garis 2px (lebih gelap agar kontras dengan latar putih)
  accentMuted: 'var(--accent-tint)',     // batang yang tidak disorot
  ink: 'var(--ink-2)',                   // sorotan gelap (kartu pengeluaran)
  inkMuted: '#ddd5cb',
};
const W = 640;
const BAR_MAX = 24;
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

/** Teks tooltip: baris "label: nilai" dipisah "|" (dibaca oleh attachTooltips). */
const tip = (title, rows) => escapeHtml([title, ...rows.map(([k, v]) => `${k}: Rp ${money(v)}`)].join('|'));

/**
 * Grafik batang kecil per bulan untuk kartu ringkasan (seperti kartu "Total Income" di contoh desain):
 * batang lembut, bulan terakhir yang berisi data disorot dan diberi label nilainya.
 * @param {{month:number}[]} months data 12 bulan
 * @param {string} field 'masuk' atau 'keluar'
 * @param {{lastMonth:number, tone:'accent'|'ink', label:string}} options
 */
export function miniBarChart(months, field, { lastMonth, tone = 'accent', label }) {
  // Kanvas sempit sendiri (bukan lebar 640) karena kartunya kecil; kalau tidak, batang & teks ikut mengecil.
  const MW = 300;
  const H = 170;
  const pad = { l: 4, r: 4, t: 34, b: 24 };
  const end = Math.max(lastMonth, 6);
  const shown = months.slice(end - 6, end); // 6 bulan, berakhir di bulan terakhir yang berisi data
  const max = Math.max(...shown.map((m) => m[field]), 1);
  const band = (MW - pad.l - pad.r) / shown.length;
  const bw = Math.min(30, band * 0.62);
  const base = H - pad.b;
  const y = (v) => pad.t + (base - pad.t) * (1 - v / max);
  const [soft, strong] = tone === 'ink' ? [COLORS.inkMuted, COLORS.ink] : [COLORS.accentMuted, COLORS.accent];

  let marks = '';
  shown.forEach((m, i) => {
    const x = pad.l + band * i + (band - bw) / 2;
    const v = m[field];
    const highlight = m.month === lastMonth;
    if (v > 0) marks += `<path d="${columnPath(x, bw, base, Math.min(y(v), base - 3))}" fill="${highlight ? strong : soft}"/>`;
    else marks += `<rect x="${x}" y="${base - 2}" width="${bw}" height="2" rx="1" fill="${soft}"/>`;
    if (highlight && v > 0) {
      const text = compact(v);
      const tw = text.length * 7 + 14;
      marks += `<rect x="${x + bw / 2 - tw / 2}" y="${y(v) - 26}" width="${tw}" height="20" rx="10" class="value-pill"/>`;
      marks += `<text x="${x + bw / 2}" y="${y(v) - 12}" class="value-pill-text" text-anchor="middle">${escapeHtml(text)}</text>`;
    }
    marks += `<text x="${x + bw / 2}" y="${H - 6}" class="tick" text-anchor="middle">${MONTHS[m.month - 1].slice(0, 3)}</text>`;
    marks += `<rect x="${pad.l + band * i}" y="0" width="${band}" height="${H}" class="hit" data-tip="${tip(MONTHS[m.month - 1], [[label, v]])}"/>`;
  });
  return html`<svg viewBox="0 0 ${MW} ${H}" class="chart mini" role="img" aria-label="${label} per bulan">${raw(marks)}</svg>`;
}

/**
 * Pemasukan vs pengeluaran per bulan: dua batang berdampingan tiap bulan (Jan–Des).
 * Dua seri, jadi kartu pemakainya wajib menampilkan legenda (lihat flowLegend).
 * Bulan sesudah lastMonth hanya diberi label (belum ada data). Area tiap bulan bisa diklik (data-month).
 * selected = bulan yang sedang dipilih: batangnya tetap berwarna penuh, bulan lain dibuat lembut.
 * @param {{month:number, masuk:number, keluar:number}[]} months data 12 bulan
 */
export function monthlyFlowChart(months, { lastMonth, selected = null }) {
  const H = 260;
  const pad = { l: 64, r: 12, t: 12, b: 28 };
  const shown = months.filter((m) => m.month <= lastMonth);
  if (!shown.length) return html`<p class="muted empty">Belum ada data.</p>`;
  const scale = niceScale(0, Math.max(...shown.map((m) => Math.max(m.masuk, m.keluar)), 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - scale.lo) / (scale.hi - scale.lo));
  const band = (W - pad.l - pad.r) / 12;
  const bw = Math.min(BAR_MAX - 6, (band - 10) / 2);
  const base = y(0);

  let marks = '';
  months.forEach((m) => {
    const left = pad.l + band * (m.month - 1);
    const x = left + (band - (bw * 2 + 2)) / 2;
    marks += `<text x="${left + band / 2}" y="${H - 8}" class="tick${m.month > lastMonth ? ' future' : ''}" text-anchor="middle">${MONTHS[m.month - 1].slice(0, 3)}</text>`;
    if (m.month > lastMonth) return;
    const dim = selected && m.month !== selected;
    [[m.masuk, dim ? COLORS.accentMuted : COLORS.accent, 0], [m.keluar, dim ? COLORS.inkMuted : COLORS.ink, bw + 2]].forEach(([v, color, dx]) => {
      if (v > 0) marks += `<path d="${columnPath(x + dx, bw, base, Math.min(y(v), base - 2))}" fill="${color}"/>`;
    });
    const selisih = Math.round((m.masuk - m.keluar) * 100) / 100;
    marks += `<rect x="${left}" y="${pad.t}" width="${band}" height="${H - pad.t - pad.b}" class="hit" data-month="${m.month}"
      data-tip="${tip(MONTHS[m.month - 1], [['Pemasukan', m.masuk], ['Pengeluaran', m.keluar], ['Selisih', selisih]])}"/>`;
  });

  return html`
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Pemasukan dan pengeluaran per bulan">
      ${raw(gridAndAxis(scale, y, pad.l, W - pad.r))}
      ${raw(marks)}
    </svg>`;
}

/** Legenda dua seri untuk monthlyFlowChart (warna + teks, tidak hanya warna). */
export const flowLegend = () => html`
  <span class="legend"><span><i style="background:${COLORS.accent}"></i>Pemasukan</span><span><i style="background:${COLORS.ink}"></i>Pengeluaran</span></span>`;

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
  const area = `${d}L${x(last.month)},${y(Math.max(scale.lo, 0))}L${x(points[0].month)},${y(Math.max(scale.lo, 0))}Z`;
  let marks = `<path d="${area}" class="area" fill="${COLORS.accent}"/><path d="${d}" class="line" stroke="${COLORS.accentLine}"/>`;
  marks += `<circle cx="${x(last.month)}" cy="${y(last.saldo)}" r="5" class="dot" fill="${COLORS.accent}"/>`;
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
export function rankedBarChart(items, { color = COLORS.accent, labelWidth = 170 } = {}) {
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
