// Pilihan <option> yang sering dipakai.
import { html } from '../core/dom.js';
import { MONTHS } from '../core/format.js';
import { store } from '../core/store.js';

const selected = (a, b) => (String(a) === String(b) ? 'selected' : '');

export const posOptions = (current, { empty = '' } = {}) => html`
  ${empty ? html`<option value="">${empty}</option>` : ''}
  ${store.pos.map((p) => html`<option value="${p.id}" ${selected(p.id, current)}>${p.number}. ${p.code}</option>`)}`;

export const accountOptions = (current, { kind } = {}) =>
  store.accounts.filter((a) => !kind || a.kind === kind).map((a) => html`<option value="${a.id}" ${selected(a.id, current)}>${a.name}</option>`);

export const monthOptions = (current, { empty = '' } = {}) => html`
  ${empty ? html`<option value="">${empty}</option>` : ''}
  ${MONTHS.map((m, i) => html`<option value="${i + 1}" ${selected(i + 1, current)}>${m}</option>`)}`;

/** Bulan default: bulan ini bila tahun berjalan, selain itu Desember. */
export function defaultMonth() {
  const now = new Date();
  return store.year === now.getFullYear() ? now.getMonth() + 1 : 12;
}
