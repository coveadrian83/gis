'use strict';
// Formatare și desen pentru atlas: hărți (geometria din geom.json) și elemente de grafic.
const GEOM = require('./geom.json');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// număr în română: virgulă zecimală; separator de mii doar dacă se cere
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '–' : String(+(+v).toFixed(d)).replace('.', ','));
const fix = (v, d = 1) => (v == null ? '–' : (+v).toFixed(d).replace('.', ','));
const mii = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const pct = (v, d = 0) => (v == null ? '–' : fmt(100 * v, d) + '%');
// „de” după numerele întregi ≥ 20 (20 de minute), nu după zecimale sau 1–19
const de = (n) => { const x = Math.round(+n); if (!Number.isInteger(+n)) return ''; const r = x % 100; return x >= 20 && !(r >= 1 && r <= 19) ? ' de' : ''; };
const nde = (n, noun, d = 1) => fmt(n, d) + de(n) + ' ' + noun;
const lista = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' și ' + a[a.length - 1]);

// ancoră pentru etichete: din atlasul inițial sau centrul poligonului
function anchor(panel, id) {
  const P = GEOM[panel]; const a = P.anchors[id];
  if (a) return [a[0], a[1]];
  const u = P.units.find((x) => x.id === id); return u ? u.c : null;
}
const shortName = (id) => (GEOM.ias.anchors[id] ? GEOM.ias.anchors[id][2] : null);

let mapNo = 0;
// panel de hartă: fill(id) → culoare sau 'hatch'; labels: [{id, lines:[[cls, text], ...]}]; extra: SVG peste unități
function mapPanel(panel, { fill, aria, ptag, labels = [], extra = '', under = '', dataAttr = 'data-u' }) {
  const P = GEOM[panel]; mapNo++; const id = 'g' + mapNo;
  let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="${esc(aria)}"><defs>\n<pattern id="${id}h" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect width="7" height="7" style="fill:var(--q1)"/><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--hatch)" stroke-width="2.2"/></pattern>\n<clipPath id="${id}c"><rect width="640" height="600"/></clipPath></defs><g clip-path="url(#${id}c)">`;
  for (const u of P.units) {
    let f = fill(u.id); if (f === 'hatch') f = `url(#${id}h)`;
    s += `<path d="${u.d}" style="fill:${f};stroke:${u.stroke}" stroke-width="${u.sw}" stroke-linejoin="round" ${dataAttr}="${u.id}"/>`;
  }
  s += P.outline + under + P.inset + extra;
  for (const L of labels) {
    const a = L.at || anchor(panel, L.id); if (!a) continue; let y = a[1];
    for (const [cls, text, dy] of L.lines) { s += `<text x="${a[0]}" y="${+(y).toFixed(1)}" class="${cls} halo" text-anchor="middle" pointer-events="none">${esc(text)}</text>`; y += dy || (cls === 'lbl' ? 21 : 18); }
  }
  s += `<text x="14" y="28" class="ptag">${esc(ptag)}</text>` + P.north + P.scale + '</g></svg>';
  return s;
}
const fig = (...panels) => `<div class="panels">${panels.map((p) => `<figure class="panel">${p}</figure>`).join('')}</div>`;
const legend = (title, items) => `<div class="legend" role="list"><span class="lt">${esc(title)}</span>${items.map(([sw, t]) => `<span class="li" role="listitem">${sw}${esc(t)}</span>`).join('')}</div>`;
const sw = (c) => `<span class="sw" style="background:${c}"></span>`;
const swHatch = '<span class="sw sw-hatch"></span>';
const notes = (items) => `<ul class="notes">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const table = (summary, head, rows, after = '') => `<details class="data"><summary>${summary}</summary><div class="tw"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${after}</details>`;
const section = (id, kicker, no, title, lead, body) => `<section class="fig" id="${id}" aria-labelledby="${id}-t">\n<header class="fh"><p class="kicker"><span class="fno">${no}</span>${kicker}</p><h2 id="${id}-t">${title}</h2><p class="lead">${lead}</p></header>\n${body}\n</section>`;

// axă verticală + bare grupate
function barChart({ title, aria, groups, series, max, step, unit = '' }) {
  // groups: [{label, sub, values:[v per serie]}], series: [{color}]
  const x0 = 70, x1 = 610, y0 = 530, y1 = 70, H = y0 - y1;
  const Y = (v) => y0 - (H * v) / max;
  let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="${esc(aria)}"><text x="16" y="28" class="axt">${esc(title)}</text>`;
  for (let v = 0; v <= max; v += step) s += `<line x1="${x0}" y1="${Y(v).toFixed(1)}" x2="${x1}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${x0 - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="ax">${v}${unit}</text>`;
  const gw = (x1 - x0) / groups.length, bw = Math.min(30, (gw - 18) / series.length);
  groups.forEach((g, i) => {
    const cx = x0 + gw * (i + 0.5), start = cx - (bw * series.length) / 2;
    g.values.forEach((v, j) => { if (v == null) return; const x = start + j * bw; s += `<rect x="${x.toFixed(1)}" y="${Y(v).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${(y0 - Y(v)).toFixed(1)}" style="fill:${series[j].color}"/><text x="${(x + bw / 2 - 1.5).toFixed(1)}" y="${(Y(v) - 6).toFixed(1)}" text-anchor="middle" class="sm">${fmt(v, 1)}</text>`; });
    s += `<text x="${cx.toFixed(1)}" y="550" text-anchor="middle" class="ax-l">${esc(g.label)}</text>`;
    if (g.sub) s += `<text x="${cx.toFixed(1)}" y="568" text-anchor="middle" class="sm">${esc(g.sub)}</text>`;
  });
  return s + '</svg>';
}
// bare orizontale (o serie), cu etichetă
function hbarChart({ title, aria, rows, max, ticks, unit = '%', x0 = 168, x1 = 566 }) {
  const n = rows.length, top = 56, bottom = 572, h = Math.min(n <= 8 ? 56 : 22, (bottom - top) / n);
  const X = (v) => x0 + ((x1 - x0) * v) / max;
  let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="${esc(aria)}"><text x="16" y="28" class="axt">${esc(title)}</text>`;
  for (const t of ticks) s += `<line x1="${X(t).toFixed(1)}" y1="${top - 6}" x2="${X(t).toFixed(1)}" y2="${(top + n * h).toFixed(1)}" class="grid"/><text x="${X(t).toFixed(1)}" y="${(top + n * h + 16).toFixed(1)}" text-anchor="middle" class="ax">${t}${unit}</text>`;
  rows.forEach((r, i) => { const y = top + i * h; const w = Math.max(0, X(Math.min(r.v, max)) - x0);
    s += `<text x="${x0 - 8}" y="${(y + h * 0.62).toFixed(1)}" text-anchor="end" class="ax-l">${esc(r.label)}</text><rect x="${x0}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(h * 0.66).toFixed(1)}" style="fill:${r.color}"${r.id ? ` data-u="${r.id}"` : ''}/><text x="${(x0 + w + 6).toFixed(1)}" y="${(y + h * 0.62).toFixed(1)}" class="ax">${esc(r.text)}</text>`; });
  return s + '</svg>';
}
module.exports = { GEOM, esc, fmt, fix, mii, pct, de, nde, lista, anchor, shortName, mapPanel, fig, legend, sw, swHatch, notes, table, section, barChart, hbarChart };
