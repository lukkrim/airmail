// Stamp designs. Country stamps show that country's real outline (from the
// bundled Natural Earth map) in one of the postal inks; three starter stamps
// are always available for a new letter.
import { geoPath, geoAzimuthalEqualArea, geoCentroid, geoArea, geoDistance } from 'd3-geo';
import { COUNTRIES } from '../environment/land.js';
import { stampSVG, PLANE_ART, COLORS } from './theme.js';

const INKS = ['#c4262e', '#1f4f9c', '#2f7a5b', '#8a4fa3', '#b8741f', '#2b7f8f', '#b5476b', '#56662a'];

const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

const byName = new Map(COUNTRIES.features.map((f) => [f.properties.name, f]));
export const COUNTRY_COUNT = byName.size;

// Records a path, dropping points closer than `min` px so big coastlines stay light.
function thinPath(min = 0.7) {
  let d = '', lx = 0, ly = 0;
  const f = (n) => Math.round(n * 10) / 10;
  return {
    moveTo(x, y) { d += `M${f(x)} ${f(y)}`; lx = x; ly = y; },
    lineTo(x, y) { if (Math.hypot(x - lx, y - ly) < min) return; d += `L${f(x)} ${f(y)}`; lx = x; ly = y; },
    closePath() { d += 'Z'; },
    arc() {},
    result() { return d; }
  };
}

const shapeCache = new Map();
function countryShape(name) {
  if (shapeCache.has(name)) return shapeCache.get(name);
  const f = byName.get(name);
  let d = '';
  if (f) {
    // Frame the main landmasses only, so far-off islands (the Azores for
    // Portugal, Réunion for France) don't shrink the country to a dot.
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    const parts = polys.map((c) => {
      const g = { type: 'Polygon', coordinates: c };
      return { c, area: geoArea(g), at: geoCentroid(g) };
    });
    const biggest = parts.reduce((a, b) => (b.area > a.area ? b : a));
    const near = (p) => (geoDistance(p.at, biggest.at) * 180) / Math.PI <= 18;
    const main = { type: 'MultiPolygon', coordinates: parts.filter((p) => p === biggest || (near(p) && p.area >= biggest.area * 0.02)).map((p) => p.c) };
    const [lon, lat] = geoCentroid(main);
    const proj = geoAzimuthalEqualArea().rotate([-lon, -lat]).fitExtent([[5, 4], [55, 48]], main);
    const ctx = thinPath();
    geoPath(proj, ctx)(f);
    d = ctx.result();
  }
  shapeCache.set(name, d);
  return d;
}

const sunburst = (color) => {
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    rays += `<line x1="30" y1="26" x2="${(30 + Math.cos(a) * 40).toFixed(1)}" y2="${(26 + Math.sin(a) * 40).toFixed(1)}"/>`;
  }
  return `<g stroke="${color}" stroke-width="2.4" opacity="0.13">${rays}</g>`;
};

const WAVES_ART = (c) => `<g fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round">
  <path d="M4 22 q7 -7 14 0 t14 0 t14 0 t14 0"/><path d="M4 32 q7 -7 14 0 t14 0 t14 0 t14 0" opacity="0.7"/>
  <path d="M4 42 q7 -7 14 0 t14 0 t14 0 t14 0" opacity="0.45"/></g>
  <g transform="translate(20 4) scale(0.45)" stroke="${COLORS.ink}" stroke-width="2.4" stroke-linejoin="round">
  <polygon points="0,20 48,0 22,36" fill="#fff"/><polygon points="22,36 48,0 26,26" fill="#eef1f7"/></g>`;

const GLOBE_ART = (c) => `<g fill="none" stroke="${c}" stroke-width="1.8">
  <circle cx="30" cy="26" r="20"/><ellipse cx="30" cy="26" rx="9" ry="20"/><path d="M10 26 H50 M13 16 H47 M13 36 H47"/></g>
  <path d="M8 40 Q30 -2 54 14" fill="none" stroke="${COLORS.red}" stroke-width="1.6" stroke-dasharray="3 3"/>
  <g transform="translate(44 6) scale(0.32) rotate(20)" stroke="${COLORS.ink}" stroke-width="3" stroke-linejoin="round">
  <polygon points="0,20 48,0 22,36" fill="#fff"/></g>`;

const SWALLOW_ART = (c) => `<path d="M8 30 C18 22 24 22 30 26 C36 18 44 12 56 10 C46 16 40 22 38 28 C44 30 50 34 54 40 C44 36 36 34 30 33 C24 38 16 40 8 30 Z"
  fill="${c}" stroke="${COLORS.ink}" stroke-width="1.2" stroke-linejoin="round"/><circle cx="27" cy="27.5" r="1.2" fill="#fff"/>`;

// Always available when writing a letter.
export const STARTERS = [
  { id: 'starter:plane', name: 'Par avion', color: COLORS.red, art: () => PLANE_ART },
  { id: 'starter:globe', name: 'Round the world', color: COLORS.blue, art: (c) => GLOBE_ART(c) },
  { id: 'starter:swallow', name: 'Swallow', color: '#2f7a5b', art: (c) => SWALLOW_ART(c) }
];

export const SEA_ID = 'sea';
export const stampIdFor = (country) => (country ? `c:${country}` : SEA_ID);

/** Display info for a stamp id: { id, name, color, svg() }. */
export function stampInfo(id) {
  const starter = STARTERS.find((s) => s.id === id);
  if (starter) return { ...starter, svg: () => stampSVG({ art: starter.art(starter.color), label: starter.name.toUpperCase(), color: starter.color }) };
  if (id === SEA_ID) {
    const c = '#2b7f8f';
    return { id, name: 'At sea', color: c, svg: () => stampSVG({ art: WAVES_ART(c), label: 'AT SEA', color: c }) };
  }
  const name = id.startsWith('c:') ? id.slice(2) : id;
  const h = hash(name);
  const c = INKS[h % INKS.length];
  const value = [5, 10, 15, 20, 25, 30, 50][(h >>> 5) % 7];
  return {
    id, name, color: c,
    svg: () => {
      const d = countryShape(name);
      const art = sunburst(c) + (d ? `<path d="${d}" fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-width="1.3" stroke-linejoin="round"/>` : '');
      return stampSVG({ art, label: name.toUpperCase(), value: `${value}c`, color: c });
    }
  };
}
