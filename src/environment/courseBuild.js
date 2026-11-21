// Builds a real-land course as plain data (typed arrays), so it can run in a
// worker and in Node. course.js wraps the result for the game.
//
// The course is laid out exactly like a journey leg: game −Z points along
// `bearing` from the plane's spot, and one game unit is `metresPerUnit` real
// metres (the journey's pace), so the land under the plane is the land the
// letter really crosses. Heights are stretched so hills read clearly, very
// tall mountains are squeezed, and a launch hill is added.
import { FAR, LAUNCH, NEAR } from './bounds.js';
import { elevationTile, vectorTile, tileX, tileY } from './tiles.js';
import { CoverGrid, COVER, paintCover, paintCoverTexture } from './cover.js';
import { gameToLatLon, distanceKm, bearingDeg } from './geo.js';
import { smooth } from '../core/noise.js';

const D2R = Math.PI / 180;
export const NEAR_CELL = 8;    // height grid step near the course, game units
export const FAR_CELL = 150;   // height grid step out to the horizon
export const COVER_CELL = 3;   // land-cover pixel near the course
export const FAR_COVER_CELL = 50;

/** Vertical stretch (game units per real metre) for a given squeeze. */
export function verticalScale(metresPerUnit) {
  return Math.max(0.035, 0.275 * (8 / metresPerUnit) ** 0.55);
}

function mapping(o) {
  const start = { lat: o.lat, lon: o.lon };
  const kpu = o.metresPerUnit / 1000;
  return {
    toLatLon: (x, z) => gameToLatLon(start, o.bearing, x, z, kpu),
    toGame: (lon, lat) => {
      const p = { lat, lon };
      const d = distanceKm(start, p);
      if (d < 1e-9) return [0, 0];
      const rel = (bearingDeg(start, p) - o.bearing) * D2R;
      return [(d * Math.sin(rel)) / kpu, (-d * Math.cos(rel)) / kpu];
    }
  };
}

// Which tiles at zoom z cover a game-space rectangle.
function tilesFor(region, z, toLatLon, neighbours = true) {
  const set = new Map();
  const N = 24;
  for (let a = 0; a <= N; a++) {
    for (let b = 0; b <= N; b++) {
      const x = region.minX + ((region.maxX - region.minX) * a) / N;
      const zz = region.minZ + ((region.maxZ - region.minZ) * b) / N;
      const p = toLatLon(x, zz);
      const tx = Math.floor(tileX(p.lon, z)), ty = Math.floor(tileY(p.lat, z));
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
        // neighbours too, so bilinear sampling never falls off a tile
        if ((dx || dy) && (!neighbours || (a % N && b % N))) continue;
        const k = `${tx + dx}/${ty + dy}`;
        if (!set.has(k)) set.set(k, [tx + dx, ty + dy]);
      }
    }
  }
  return [...set.values()].filter(([, y]) => y >= 0 && y < 2 ** z);
}

function pickZoom(region, toLatLon, want, maxTiles, lo = 2, neighbours = true) {
  for (let z = want; z >= lo; z--) {
    const t = tilesFor(region, z, toLatLon, neighbours);
    if (t.length <= maxTiles) return { z, tiles: t };
  }
  return { z: lo, tiles: tilesFor(region, lo, toLatLon, neighbours) };
}

const zoomForPixel = (lat, metres) =>
  Math.max(2, Math.min(13, Math.round(Math.log2((156543 * Math.cos(lat * D2R)) / metres))));

async function elevationSampler(region, o, toLatLon, pixelMetres, maxTiles, signal) {
  const { z, tiles } = pickZoom(region, toLatLon, zoomForPixel(o.lat, pixelMetres), maxTiles);
  const n = 2 ** z;
  const data = new Map();
  await Promise.all(tiles.map(([x, y]) => elevationTile(z, x, y, signal).then((d) => data.set(`${((x % n) + n) % n}/${y}`, d))));
  const px = (gx, gy) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const d = data.get(`${((tx % n) + n) % n}/${ty}`);
    if (!d) return 0;
    return d[(gy - ty * 256) * 256 + (gx - tx * 256)];
  };
  return {
    z, count: tiles.length,
    at(lat, lon) {
      const fx = tileX(lon, z) * 256 - 0.5, fy = tileY(lat, z) * 256 - 0.5;
      const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const a = px(ix, iy) + (px(ix + 1, iy) - px(ix, iy)) * tx;
      const b = px(ix, iy + 1) + (px(ix + 1, iy + 1) - px(ix, iy + 1)) * tx;
      return a + (b - a) * ty;
    }
  };
}

async function coverFor(region, cell, o, map, maxTiles, wantZoom, signal) {
  const w = Math.ceil((region.maxX - region.minX) / cell), h = Math.ceil((region.maxZ - region.minZ) / cell);
  const grid = new CoverGrid(region.minX, region.minZ, cell, w, h);
  let places = [], ok = true, z = 0;
  try {
    const pick = pickZoom(region, map.toLatLon, Math.min(13, wantZoom), maxTiles, 4, false);
    z = pick.z;
    const tiles = await Promise.all(pick.tiles.map(([x, y]) => vectorTile(pick.z, x, y, signal).then((tile) => ({ tile, z: pick.z, x, y }))));
    places = paintCover(grid, tiles, map.toGame, o.metresPerUnit);
  } catch (err) {
    if (signal && signal.aborted) throw err;
    ok = false; // no land cover today: the ground is coloured from height alone
  }
  return { grid, places, ok, z };
}

function blur(src, w, h, r) {
  const a = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let j = 0; j < h; j++) {
    let s = 0, n = 0;
    for (let i = -r; i < w + r; i++) {
      if (i + r < w) { s += src[j * w + i + r]; n++; }
      if (i - r - 1 >= 0) { s -= src[j * w + i - r - 1]; n--; }
      if (i >= 0 && i < w) a[j * w + i] = s / n;
    }
  }
  for (let i = 0; i < w; i++) {
    let s = 0, n = 0;
    for (let j = -r; j < h + r; j++) {
      if (j + r < h) { s += a[(j + r) * w + i]; n++; }
      if (j - r - 1 >= 0) { s -= a[(j - r - 1) * w + i]; n--; }
      if (j >= 0 && j < h) out[j * w + i] = s / n;
    }
  }
  return out;
}

export function sampleGrid(g, x, z) {
  const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
  const i = Math.max(0, Math.min(g.w - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(g.h - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i)), tz = Math.max(0, Math.min(1, fz - j));
  const k = j * g.w + i, a = g.data;
  const top = a[k] + (a[k + 1] - a[k]) * tx;
  const bot = a[k + g.w] + (a[k + g.w + 1] - a[k + g.w]) * tx;
  return top + (bot - top) * tz;
}

/**
 * opts: { lat, lon, bearing, metresPerUnit, name }. Resolves to plain data;
 * see course.js for how the game reads it.
 */
export async function buildCourse(opts, { signal } = {}) {
  const t0 = Date.now();
  const o = { metresPerUnit: 8, ...opts };
  const map = mapping(o);
  const mpu = o.metresPerUnit;

  // heights near the course and out to the horizon, land cover for both
  const [nearE, farE, nearC, farC] = await Promise.all([
    elevationSampler(NEAR, o, map.toLatLon, mpu * NEAR_CELL, 40, signal),
    elevationSampler(FAR, o, map.toLatLon, mpu * FAR_CELL * 0.5, 16, signal),
    coverFor(NEAR, COVER_CELL, o, map, 40, zoomForPixel(o.lat, mpu * COVER_CELL) + 1, signal),
    coverFor(FAR, FAR_COVER_CELL, o, map, 9, zoomForPixel(o.lat, mpu * FAR_COVER_CELL * 2), signal)
  ]);

  const grid = (region, cell) => {
    const w = Math.ceil((region.maxX - region.minX) / cell) + 1, h = Math.ceil((region.maxZ - region.minZ) / cell) + 1;
    return { x0: region.minX, z0: region.minZ, cell, w, h, data: new Float32Array(w * h) };
  };
  const nearM = grid(NEAR, NEAR_CELL), farM = grid(FAR, FAR_CELL);
  const coverAt = (x, z) => {
    const c = nearC.grid.at(x, z);
    if (x >= NEAR.minX && x < NEAR.maxX && z >= NEAR.minZ && z < NEAR.maxZ) return c;
    return farC.grid.at(x, z);
  };
  const haveCover = nearC.ok;
  let seaCells = 0;
  for (const [g, E] of [[nearM, nearE], [farM, farE]]) {
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) {
        const x = g.x0 + i * g.cell, z = g.z0 + j * g.cell;
        const p = map.toLatLon(x, z);
        g.data[j * g.w + i] = E.at(p.lat, p.lon);
      }
    }
  }
  // sea: from the map's coastline when there is land cover, else from height
  const isSea = (x, z, m) => (haveCover ? coverAt(x, z) === COVER.OCEAN : m <= 0.5);
  for (let j = 0; j < nearM.h; j++) {
    for (let i = 0; i < nearM.w; i++) {
      if (isSea(nearM.x0 + i * NEAR_CELL, nearM.z0 + j * NEAR_CELL, nearM.data[j * nearM.w + i])) seaCells++;
    }
  }

  // inland courses start from their low ground, coastal ones from sea level
  const k = verticalScale(mpu);
  const sorted = Float32Array.from(nearM.data).sort();
  const low = sorted[Math.floor(sorted.length * 0.05)];
  const coastal = seaCells > nearM.w * nearM.h * 0.005;
  const base = coastal ? 0 : low - 6 / k;
  const toGameHeight = (x, z, m) => {
    if (isSea(x, z, m)) return -2.5 - Math.min(16, Math.max(0, -m) * k * 0.5);
    let y = Math.max(0.8, (m - base) * k);
    if (y > 220) y = 220 + (y - 220) * 0.45;
    return y;
  };
  const conv = (g) => {
    const out = { ...g, data: new Float32Array(g.data.length) };
    for (let j = 0; j < g.h; j++) {
      for (let i = 0; i < g.w; i++) out.data[j * g.w + i] = toGameHeight(g.x0 + i * g.cell, g.z0 + j * g.cell, g.data[j * g.w + i]);
    }
    return out;
  };
  const near = conv(nearM), far = conv(farM);

  // a launch hill about as tall as the practice one, above the land around it
  let around = 0;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    around += Math.max(0, sampleGrid(near, LAUNCH.x + Math.cos(ang) * 320, LAUNCH.z + Math.sin(ang) * 320));
  }
  around = Math.max(4, around / 16);
  const local = Math.max(0, sampleGrid(near, LAUNCH.x, LAUNCH.z));
  const lift = Math.max(0, around + 95 - local);
  const R = 140;
  for (let j = 0; j < near.h; j++) {
    for (let i = 0; i < near.w; i++) {
      const dx = near.x0 + i * NEAR_CELL - LAUNCH.x, dz = near.z0 + j * NEAR_CELL - (LAUNCH.z + 20);
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R * 9) continue;
      const n = j * near.w + i;
      near.data[n] = Math.max(near.data[n], 0.8 * smooth(R * 3, 0, Math.sqrt(d2))) + lift * Math.exp((-2 * d2) / (R * R));
    }
  }
  // the hill is land, whatever the map says is under it
  for (let j = 0; j < nearC.grid.h; j++) {
    for (let i = 0; i < nearC.grid.w; i++) {
      const x = nearC.grid.x0 + (i + 0.5) * COVER_CELL, z = nearC.grid.z0 + (j + 0.5) * COVER_CELL;
      const d = Math.hypot(x - LAUNCH.x, z - LAUNCH.z - 20);
      const n = j * nearC.grid.w + i;
      if (d < R * 1.6 && (nearC.grid.data[n] === COVER.OCEAN || nearC.grid.data[n] === COVER.WATER)) nearC.grid.data[n] = COVER.SAND;
      if (d < R * 0.9 && nearC.grid.data[n] !== COVER.NONE) nearC.grid.data[n] = COVER.GRASS;
    }
  }

  const shape = { ...near, data: blur(near.data.map((v) => Math.max(0, v)), near.w, near.h, 5) };
  const nearTex = paintCoverTexture(nearC.grid, mpu);
  const farTex = paintCoverTexture(farC.grid, mpu);

  return {
    info: {
      name: o.name || '', lat: o.lat, lon: o.lon, bearing: o.bearing, metresPerUnit: mpu,
      verticalScale: k, base, coastal, seaShare: seaCells / (nearM.w * nearM.h),
      zoom: { elevation: nearE.z, far: farE.z, cover: nearC.z, farCover: farC.z },
      tiles: nearE.count + farE.count, cover: haveCover, ms: Date.now() - t0
    },
    near, far, shape, metres: nearM, farMetres: farM,
    cover: { x0: nearC.grid.x0, z0: nearC.grid.z0, cell: COVER_CELL, w: nearC.grid.w, h: nearC.grid.h, data: nearC.grid.data, rgba: nearTex.rgba, water: nearTex.water },
    farCover: { x0: farC.grid.x0, z0: farC.grid.z0, cell: FAR_COVER_CELL, w: farC.grid.w, h: farC.grid.h, data: farC.grid.data, rgba: farTex.rgba, water: farTex.water },
    places: mergePlaces(nearC.places, farC.places)
  };
}

// Close-up tiles leave out big towns' labels and wide ones miss villages: use both.
function mergePlaces(a, b) {
  const seen = new Set(), out = [];
  for (const p of [...a, ...b]) {
    const key = p.name;
    if (seen.has(key)) continue;
    if (p.x < FAR.minX || p.x > FAR.maxX || p.z < FAR.minZ || p.z > FAR.maxZ) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Every big array in a course, for postMessage transfer. */
export function transfers(c) {
  return [c.near.data, c.far.data, c.shape.data, c.metres.data, c.farMetres.data,
    c.cover.data, c.cover.rgba, c.cover.water, c.farCover.data, c.farCover.rgba, c.farCover.water].map((a) => a.buffer);
}
