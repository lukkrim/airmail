// City centres from real building data. OpenStreetMap buildings (with their
// real heights) only come in the most detailed map tiles, which are heavy, so
// they are loaded just around the biggest towns on the course: up to about a
// dozen tiles. Each tall building becomes a tower or a mid-rise, each big low
// one a mall or a warehouse, merged onto a coarse grid because the course is
// squeezed (one game unit is several real metres) while buildings are drawn
// at about their real size. Runs in the worker and in Node.
import { vectorTile, tileX, tileY } from './tiles.js';
import { CoverGrid } from './cover.js';
import { NEAR } from './bounds.js';

const Z = 14;              // the zoom that has buildings with heights
const CELL_M = 220;        // one structure per this many real metres
const MAX_TALL = 130, MAX_LOW = 30;
const EARTH = 40075016.686;

// What counts as a city centre worth loading, and how many tiles around it.
function centres(places, coverAt) {
  const inside = (p) => p.x > NEAR.minX && p.x < NEAR.maxX && p.z > NEAR.minZ && p.z < NEAR.maxZ;
  const out = [];
  const towns = places.filter((p) => p.rank >= 3 && inside(p))
    .sort((a, b) => b.rank - a.rank || Math.abs(a.x) + Math.abs(a.z) * 0.3 - (Math.abs(b.x) + Math.abs(b.z) * 0.3));
  for (const p of towns) {
    if (out.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 500)) continue;
    out.push({ x: p.x, z: p.z, size: p.rank >= 4 ? 3 : 2, name: p.name });
    if (out.length >= 2) break;
  }
  // a throw from inside a big built-up area with no named centre nearby
  if (!out.length) {
    let urban = 0, n = 0;
    for (let x = -400; x <= 400; x += 40) for (let z = -800; z <= 0; z += 40) { n++; if (coverAt(x, z) === 4) urban++; }
    if (urban / n > 0.5) out.push({ x: 0, z: -400, size: 2, name: '' });
  }
  return out;
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].y - r[i].y);
  return Math.abs(a) / 2;
}

/**
 * o: course options; map: { toLatLon, toGame }; places: named places;
 * coverAt(x, z). Resolves to { structures: [{ x, z, h, side, kind }], tiles }.
 * h and side are real metres; kind: tower, midrise, mall, warehouse.
 */
export async function cityStructures(o, map, places, coverAt, signal) {
  const list = centres(places, coverAt);
  if (!list.length) return { structures: [], tiles: 0, centres: [] };
  const want = new Map();
  for (const c of list) {
    const p = map.toLatLon(c.x, c.z);
    const fx = tileX(p.lon, Z), fy = tileY(p.lat, Z);
    // the size × size tiles nearest the centre
    const x0 = Math.round(fx - c.size / 2), y0 = Math.round(fy - c.size / 2);
    for (let dx = 0; dx < c.size; dx++) for (let dy = 0; dy < c.size; dy++) want.set(`${x0 + dx}/${y0 + dy}`, [x0 + dx, y0 + dy]);
  }
  const tiles = [...want.values()].slice(0, 13);
  const got = await Promise.allSettled(tiles.map(([x, y]) => vectorTile(Z, x, y, signal).then((tile) => ({ tile, x, y }))));
  if (signal && signal.aborted) throw new Error('aborted');

  const n = 2 ** Z;
  const toGame = (tx, ty, extent) => (pt) => {
    const lon = ((tx + pt.x / extent) / n) * 360 - 180;
    const yy = Math.PI - (2 * Math.PI * (ty + pt.y / extent)) / n;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(yy));
    return map.toGame(lon, lat);
  };
  // shops and offices vs industry, from the land use around each building
  const uses = new CoverGrid(NEAR.minX, NEAR.minZ, 10, Math.ceil((NEAR.maxX - NEAR.minX) / 10), Math.ceil((NEAR.maxZ - NEAR.minZ) / 10));
  const USE = { retail: 1, commercial: 1, industrial: 2 };
  const best = new Map();
  let count = 0;
  for (const r of got) {
    if (r.status !== 'fulfilled') continue;
    const { tile, x, y } = r.value;
    const lu = tile.layers.landuse;
    if (lu) {
      const g = toGame(x, y, lu.extent);
      for (let i = 0; i < lu.length; i++) {
        const f = lu.feature(i);
        const v = USE[f.properties.class];
        if (!v || f.type !== 3) continue;
        const rings = f.loadGeometry().map((ring) => ring.map((pt) => { const [gx, gz] = g(pt); return [(gx - uses.x0) / uses.cell, (gz - uses.z0) / uses.cell]; }));
        uses.fillRings(rings, v);
      }
    }
    const b = tile.layers.building;
    if (!b) continue;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * (y + 0.5)) / n));
    const mPerPx = (EARTH * Math.cos(lat * Math.PI / 180)) / n / b.extent;
    const g = toGame(x, y, b.extent);
    for (let i = 0; i < b.length; i++) {
      const f = b.feature(i);
      if (f.type !== 3) continue;
      const pr = f.properties;
      if ((pr.render_min_height || 0) > 0) continue; // an upper part of a building
      const h = pr.render_height || 0;
      const ring = f.loadGeometry()[0];
      if (!ring || ring.length < 3) continue;
      const area = ringArea(ring) * mPerPx * mPerPx;
      const tall = h >= 20, big = area >= 6000 && h < 25;
      if (!tall && !big) continue;
      let sx = 0, sy = 0;
      for (const pt of ring) { sx += pt.x; sy += pt.y; }
      const [gx, gz] = g({ x: sx / ring.length, y: sy / ring.length });
      if (gx < NEAR.minX || gx > NEAR.maxX || gz < NEAR.minZ || gz > NEAR.maxZ) continue;
      count++;
      const use = uses.at(gx, gz);
      const kind = h >= 45 ? 'tower' : tall ? 'midrise' : use === 2 ? 'warehouse' : 'mall';
      const key = `${Math.floor((gx * o.metresPerUnit) / CELL_M)},${Math.floor((gz * o.metresPerUnit) / CELL_M)}`;
      const s = { x: Math.round(gx * 10) / 10, z: Math.round(gz * 10) / 10, h: Math.round(h), side: Math.round(Math.sqrt(area)), kind };
      const old = best.get(key);
      // a cell keeps its tallest building, or its biggest if none is tall
      const score = (q) => (q.kind === 'tower' || q.kind === 'midrise' ? 10000 + q.h : q.side);
      if (!old || score(s) > score(old)) best.set(key, s);
    }
  }
  const all = [...best.values()];
  const tall = all.filter((q) => q.kind === 'tower' || q.kind === 'midrise').sort((a, b) => b.h - a.h).slice(0, MAX_TALL);
  const low = all.filter((q) => q.kind === 'mall' || q.kind === 'warehouse').sort((a, b) => b.side - a.side).slice(0, MAX_LOW);
  const structures = [...tall, ...low].sort((a, b) => a.z - b.z || a.x - b.x);
  return { structures, tiles: got.filter((r) => r.status === 'fulfilled').length, buildings: count, centres: list };
}
