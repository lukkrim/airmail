// Real-land courses for the game (Phase B). The heavy work (map tiles, land
// cover, height grids) runs in a background worker (courseWorker.js); this
// file asks for a course and wraps the result with the lookups world.js uses.
import { sampleGrid } from './courseBuild.js';
import { NEAR } from './bounds.js';
import { COVER } from './cover.js';

// Named spots for trying the real ground: ?ground=bigsur or ?ground=lat,lon,bearing[,metresPerUnit]
export const GROUND_PRESETS = {
  bigsur: { lat: 36.27, lon: -121.81, bearing: 140, name: 'Big Sur coast, California' },
  fjord: { lat: 60.39, lon: 5.33, bearing: 75, name: 'Fjords east of Bergen, Norway' },
  alps: { lat: 46.69, lon: 7.86, bearing: 175, name: 'Interlaken towards the Jungfrau, Switzerland' },
  lakes: { lat: 54.6, lon: -3.14, bearing: 200, name: 'Lake District, England' },
  tuscany: { lat: 43.47, lon: 11.25, bearing: 150, name: 'Tuscan hills, Italy' },
  plains: { lat: 41.6, lon: -93.6, bearing: 270, name: 'Iowa farmland, USA' }
};

/** Reads ?ground=… from the address. Returns course options, or null. */
export function groundFromURL(search) {
  const v = new URLSearchParams(search).get('ground');
  if (!v) return null;
  if (GROUND_PRESETS[v]) return { ...GROUND_PRESETS[v] };
  const [lat, lon, bearing = 0, mpu] = v.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, bearing, metresPerUnit: mpu || undefined, name: `${lat.toFixed(2)}, ${lon.toFixed(2)}` };
}

/** Wraps course data with the lookups the game needs. */
export function makeGround(c) {
  const inNear = (x, z) => x >= NEAR.minX && x <= NEAR.maxX && z >= NEAR.minZ && z <= NEAR.maxZ;
  const coverGrid = (g) => (x, z) => {
    const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((z - g.z0) / g.cell);
    return i < 0 || j < 0 || i >= g.w || j >= g.h ? COVER.NONE : g.data[j * g.w + i];
  };
  const nearCover = coverGrid(c.cover), farCover = coverGrid(c.farCover);
  return {
    ...c,
    height: (x, z) => (inNear(x, z) ? sampleGrid(c.near, x, z) : sampleGrid(c.far, x, z)),
    shape: (x, z) => (inNear(x, z) ? sampleGrid(c.shape, x, z) : Math.max(0, sampleGrid(c.far, x, z))),
    metres: (x, z) => (inNear(x, z) ? sampleGrid(c.metres, x, z) : sampleGrid(c.farMetres, x, z)),
    coverAt: (x, z) => (inNear(x, z) ? nearCover(x, z) : farCover(x, z)),
    /** The nearest named town or village to a point, with its distance in game units. */
    placeNear(x, z) {
      let best = null, bd = Infinity;
      for (const p of c.places) {
        const d = Math.hypot(p.x - x, p.z - z) / (1 + p.rank * 0.25);
        if (d < bd) { bd = d; best = p; }
      }
      return best ? { ...best, dist: Math.hypot(best.x - x, best.z - z) } : null;
    }
  };
}

// ---------- loading ----------
let worker = null;
let nextId = 1;
const waiting = new Map();
function getWorker() {
  if (worker === null) {
    try {
      worker = new Worker(new URL('./courseWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const w = waiting.get(e.data.id);
        if (!w) return;
        waiting.delete(e.data.id);
        if (e.data.ok) w.resolve(e.data.course); else w.reject(new Error(e.data.error));
      };
      worker.onerror = () => { for (const w of waiting.values()) w.reject(new Error('course worker failed')); waiting.clear(); worker = false; };
    } catch {
      worker = false; // no module workers: build on the page instead
    }
  }
  return worker || null;
}

const built = new Map(); // key → Promise<ground>, so the same course isn't built twice
const keyOf = (o) => [o.lat.toFixed(4), o.lon.toFixed(4), Math.round(o.bearing), Math.round((o.metresPerUnit || 8) * 100)].join('/');

/**
 * Loads a real-land course. opts: { lat, lon, bearing, metresPerUnit, name }.
 * Resolves to a ground for world.setGround, or rejects (offline, timeout).
 */
export function loadRealGround(opts, { timeoutMs = 15000 } = {}) {
  const key = keyOf({ metresPerUnit: 8, ...opts });
  if (built.has(key)) return built.get(key);
  const job = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('course timed out')), timeoutMs);
    const done = (fn) => (v) => { clearTimeout(timer); fn(v); };
    const w = getWorker();
    if (w) {
      const id = nextId++;
      waiting.set(id, { resolve: done((c) => resolve(makeGround(c))), reject: done(reject) });
      w.postMessage({ id, opts });
    } else {
      import('./courseBuild.js')
        .then((m) => m.buildCourse(opts))
        .then(done((c) => resolve(makeGround(c))), done(reject));
    }
  });
  built.set(key, job);
  job.catch(() => built.delete(key));
  if (built.size > 6) built.delete(built.keys().next().value);
  return job;
}
