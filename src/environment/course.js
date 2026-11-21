// A flight course made from real land (Phase B). The real ground around a
// place is turned into a height grid in game units: the throw points along
// `bearing`, distances are squeezed by `metresPerUnit`, hills are stretched
// up so they read clearly, and a launch hill is added so every flight starts
// the same way. world.js uses it in place of the practice valley.
import { loadElevation, zoomFor } from './elevation.js';
import { BOUNDS, LAUNCH } from './world.js';
import { smooth } from '../core/noise.js';

const CELL = 8;          // grid step, game units
const M_PER_DEG = 111320;

// Named spots for trying the real ground: ?ground=bigsur or ?ground=lat,lon,bearing
export const GROUND_PRESETS = {
  bigsur: { lat: 36.27, lon: -121.81, bearing: 140, name: 'Big Sur coast, California' },
  fjord: { lat: 60.39, lon: 5.33, bearing: 75, name: 'Fjords east of Bergen, Norway' },
  alps: { lat: 46.69, lon: 7.86, bearing: 175, name: 'Interlaken towards the Jungfrau, Switzerland' },
  lakes: { lat: 54.6, lon: -3.14, bearing: 200, name: 'Lake District, England' }
};

/** Reads ?ground=… from the address. Returns options for loadRealGround, or null. */
export function groundFromURL(search) {
  const v = new URLSearchParams(search).get('ground');
  if (!v) return null;
  if (GROUND_PRESETS[v]) return { ...GROUND_PRESETS[v] };
  const [lat, lon, bearing = 0, mpu] = v.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, bearing, metresPerUnit: mpu || undefined, name: `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
}

// game (x, z) → real lat/lon. -Z is forward along the bearing, +X to the right.
function toLatLon(o, x, z) {
  const b = (o.bearing * Math.PI) / 180;
  const f = -z * o.metresPerUnit, r = x * o.metresPerUnit;
  const east = f * Math.sin(b) + r * Math.cos(b);
  const north = f * Math.cos(b) - r * Math.sin(b);
  return { lat: o.lat + north / M_PER_DEG, lon: o.lon + east / (M_PER_DEG * Math.cos((o.lat * Math.PI) / 180)) };
}

function blur(src, w, h, r) {
  const a = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < h; j++) {           // rows
    for (let i = 0; i < w; i++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const ii = i + k; if (ii >= 0 && ii < w) { s += src[j * w + ii]; n++; } }
      a[j * w + i] = s / n;
    }
  }
  for (let j = 0; j < h; j++) {           // columns
    for (let i = 0; i < w; i++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const jj = j + k; if (jj >= 0 && jj < h) { s += a[jj * w + i]; n++; } }
      out[j * w + i] = s / n;
    }
  }
  return out;
}

/**
 * Loads and builds a real-land course. Options: lat, lon, bearing (degrees,
 * the throw direction), metresPerUnit (squeeze, default 8), exaggeration
 * (hill stretch, default 2.2). Resolves to { height(x,z), shape(x,z), info }.
 */
export async function loadRealGround(opts, { timeoutMs = 12000 } = {}) {
  const o = { metresPerUnit: 8, exaggeration: 2.2, ...opts };
  const t0 = performance.now();
  const pad = 200;
  const corners = [];
  for (const x of [BOUNDS.minX - pad, 0, BOUNDS.maxX + pad]) {
    for (const z of [BOUNDS.minZ - pad, 0, BOUNDS.maxZ + pad]) corners.push(toLatLon(o, x, z));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let elev;
  try {
    elev = await loadElevation(corners, zoomFor(o.lat, o.metresPerUnit * CELL * 1.5), { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }

  // sample the real heights (metres) on the game grid
  const x0 = BOUNDS.minX - pad, z0 = BOUNDS.minZ - pad;
  const w = Math.ceil((BOUNDS.maxX - BOUNDS.minX + 2 * pad) / CELL) + 1;
  const h = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + 2 * pad) / CELL) + 1;
  const metres = new Float32Array(w * h);
  let sea = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = toLatLon(o, x0 + i * CELL, z0 + j * CELL);
      const m = elev.heightAt(p.lat, p.lon);
      metres[j * w + i] = m;
      if (m <= 0) sea++;
    }
  }

  // inland courses start from their low ground, so the valley floor sits
  // where the practice valley's does; coastal ones keep the real sea level
  const sorted = Array.from(metres).sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.05)];
  const base = sea > w * h * 0.01 ? 0 : low - (6 * o.metresPerUnit) / o.exaggeration;
  const k = o.exaggeration / o.metresPerUnit;
  const game = new Float32Array(w * h);
  for (let n = 0; n < game.length; n++) {
    const m = metres[n];
    if (base === 0 && m <= 0.5) {
      game[n] = -3 - Math.min(15, -m / o.metresPerUnit); // under the sea
      continue;
    }
    let y = Math.max(0.8, (m - base) * k);
    if (y > 220) y = 220 + (y - 220) * 0.45; // big mountains are squeezed a little more
    game[n] = y;
  }

  // a launch hill about as tall as the practice one, above the land around it
  const ring = [];
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    ring.push(sampleGrid(game, w, h, x0, z0, LAUNCH.x + Math.cos(ang) * 320, LAUNCH.z + Math.sin(ang) * 320));
  }
  const around = Math.max(4, ring.reduce((s, v) => s + Math.max(0, v), 0) / ring.length);
  const local = sampleGrid(game, w, h, x0, z0, LAUNCH.x, LAUNCH.z);
  const lift = Math.max(0, around + 95 - Math.max(0, local));
  const R = 140;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = x0 + i * CELL - LAUNCH.x, dz = z0 + j * CELL - (LAUNCH.z + 20);
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R * 9) continue;
      const n = j * w + i;
      game[n] = Math.max(game[n], 0.8 * smooth(R * 3, 0, Math.sqrt(d2))) + lift * Math.exp((-2 * d2) / (R * R));
    }
  }

  const shape = blur(game.map((v) => Math.max(0, v)), w, h, 5); // big shapes, for ridge lift
  const info = {
    name: o.name || '',
    lat: o.lat, lon: o.lon, bearing: o.bearing,
    metresPerUnit: o.metresPerUnit, exaggeration: o.exaggeration,
    zoom: elev.zoom, tiles: elev.tiles, seaShare: sea / (w * h),
    ms: Math.round(performance.now() - t0)
  };
  return {
    height: (x, z) => sampleGrid(game, w, h, x0, z0, x, z),
    shape: (x, z) => sampleGrid(shape, w, h, x0, z0, x, z),
    metres: (x, z) => sampleGrid(metres, w, h, x0, z0, x, z),
    toLatLon: (x, z) => toLatLon(o, x, z),
    info
  };
}

function sampleGrid(g, w, h, x0, z0, x, z) {
  const fx = (x - x0) / CELL, fz = (z - z0) / CELL;
  const i = Math.max(0, Math.min(w - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(h - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
  const k = j * w + i;
  const a = g[k] + (g[k + 1] - g[k]) * tx;
  const b = g[k + w] + (g[k + w + 1] - g[k + w]) * tx;
  return a + (b - a) * tz;
}
