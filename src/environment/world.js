// The flight course as data: ground heights, what covers the ground, the
// fields and town, rising and sinking air, and buildings to bump into. No
// drawing here (worldView.js draws it), so the headless checks can use it.
//
// Two kinds of course: the practice valley (made up, below), or real land
// from course.js swapped in with setGround(). Throw direction is −Z.
import { CONFIG } from '../core/config.js';
import { fbm, mulberry32, clamp, smooth } from '../core/noise.js';
import { COVER } from './cover.js';
import { BOUNDS, LAUNCH, SEA_LEVEL, FAR, NEAR } from './bounds.js';
export { BOUNDS, LAUNCH, SEA_LEVEL, FAR, NEAR, COVER };

// The practice valley: sea along the right (+X), mountains along the left,
// and the coast sweeps across the far end.
const HILLS = [
  { x: 0, z: 20, r: 130, h: 95 },      // launch hill
  { x: 230, z: -700, r: 130, h: 50 },
  { x: -260, z: -1050, r: 170, h: 70 },
  { x: 230, z: -1700, r: 110, h: 45 },
  { x: -220, z: -2350, r: 190, h: 85 },
  { x: 270, z: -2800, r: 150, h: 60 },
  { x: -140, z: -3350, r: 160, h: 55 }
];

// Warm wheat fields: each makes a thermal.
export const FIELDS = [
  { x: -40, z: -430, w: 150, d: 130, mult: 0.95, tone: 0 },
  { x: -80, z: -1520, w: 160, d: 140, mult: 1.05, tone: 1 },
  { x: -60, z: -2700, w: 170, d: 150, mult: 1.0, tone: 0 },
  { x: 60, z: -3250, w: 150, d: 140, mult: 0.9, tone: 1 }
];
export const TOWN = { x: 60, z: -2060, w: 230, d: 190, kind: 'town' };
for (const f of FIELDS) f.kind = 'field';
for (const zn of [...FIELDS, TOWN]) { zn.x0 = zn.x; zn.z0 = zn.z; }

// Real land (course.js), or null for the practice valley.
let ground = null;
let skies = null; // today's clouds and rain along a real course
export const groundInfo = () => (ground ? ground.info : null);
export const realGround = () => ground;
export const skiesInfo = () => skies;
const RAIN = [
  { x: 10, z: -1200 },
  { x: 150, z: -2950 }
];

// ---------- terrain ----------
function hillsH(x, z) {
  let h = 0;
  for (const H of HILLS) {
    const dx = x - H.x, dz = z - H.z;
    const d2 = dx * dx + dz * dz, r2 = H.r * H.r;
    if (d2 > r2 * 9) continue;
    h += H.h * Math.exp((-2 * d2) / r2);
  }
  return h;
}
const mountainMask = (x) => smooth(-560, -900, x);
const backdropMask = (z) => smooth(260, 680, z);

export function coastX(z) {
  let c = 430 + 110 * Math.sin(z / 650) + 50 * Math.sin(z / 210 + 1);
  c -= smooth(-3500, -4300, z) * 1400;
  return c;
}

function rawHeight(x, z) {
  if (ground) return ground.height(x, z);
  let h = 8 + fbm(x / 380, z / 380, 3) * 7;
  h += hillsH(x, z);
  const m = mountainMask(x);
  if (m > 0) h += m * (150 + 90 * fbm(x / 260 + 7, z / 260 - 3, 9));
  const b = backdropMask(z);
  if (b > 0) h += b * (90 + 40 * fbm(x / 200, z / 200, 5));
  const cx = coastX(z);
  const s = smooth(cx - 70, cx + 50, x);
  return h * (1 - s) - 18 * s;
}

// Smooth version of the big shapes, used for ridge lift (no small noise).
function shapeHeight(x, z) {
  if (ground) return ground.shape(x, z);
  return hillsH(x, z) + 150 * mountainMask(x) + 90 * backdropMask(z);
}

const ZONES = [...FIELDS, TOWN];

// How good a spot is for a warm field (thermal source), by what covers it.
const FIELD_SCORE = {
  [COVER.FARM]: 1, [COVER.NONE]: 0.85, [COVER.GRASS]: 0.85, [COVER.ROAD]: 0.8, [COVER.SAND]: 0.75,
  [COVER.ROCK]: 0.6, [COVER.URBAN]: 0.5, [COVER.WOOD]: 0.35, [COVER.WETLAND]: 0.25, [COVER.ICE]: 0.2,
  [COVER.WATER]: 0, [COVER.OCEAN]: 0
};
const SAMPLE = [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, -0.5], [0, 0.5], [-0.5, 0], [0.5, 0]];

// On real land a field or the town may fall in the sea, in a forest or on a
// cliff: look sideways (then a little along) for the best gentle dry ground.
// town: prefer real built-up land. Returns the ground level, or null if
// there's no land near (a stretch of open sea).
function placeOnLand(zn, town) {
  let best = null;
  for (const dz of [0, -120, 120, -240, 240, -360, 360]) {
    for (let k = 0; k <= 12; k++) {
      for (const sgn of k ? [1, -1] : [1]) {
        const x = zn.x0 + sgn * k * 75, z = zn.z0 + dz;
        if (Math.abs(x) > BOUNDS.maxX - zn.w) continue;
        const hs = [], cs = [];
        for (const [a, b] of SAMPLE) {
          hs.push(rawHeight(x + a * zn.w, z + b * zn.d));
          cs.push(ground.coverAt(x + a * zn.w, z + b * zn.d));
        }
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (lo <= 3 || hi - lo > (town ? 35 : 45)) continue;
        if (cs.some((c) => c === COVER.OCEAN || c === COVER.WATER)) continue;
        const score = town
          ? cs.filter((c) => c === COVER.URBAN || c === COVER.ROAD).length / cs.length + 0.2
          : cs.reduce((s, c) => s + (FIELD_SCORE[c] ?? 0.5), 0) / cs.length;
        const value = score - k * 0.025 - Math.abs(dz) * 0.0004;
        if (!best || value > best.value) best = { value, score, x, z, level: hs.reduce((s, v) => s + v, 0) / hs.length };
      }
    }
  }
  if (!best) return null;
  zn.x = best.x; zn.z = best.z; zn.score = Math.min(1, best.score);
  return best.level;
}

function zoneWeight(zn, x, z) {
  const dx = Math.max(0, Math.abs(x - zn.x) - zn.w / 2);
  const dz = Math.max(0, Math.abs(z - zn.z) - zn.d / 2);
  if (dx > 45 || dz > 45) return 0;
  const d = Math.hypot(dx, dz);
  return d >= 45 ? 0 : 1 - smooth(0, 45, d);
}

export function groundHeight(x, z) {
  let h = rawHeight(x, z);
  for (const zn of ZONES) {
    if (zn.off) continue;
    const wgt = zoneWeight(zn, x, z);
    if (wgt > 0) h += (zn.level - h) * wgt;
  }
  return h;
}
export const surfaceHeight = (x, z) => Math.max(SEA_LEVEL, groundHeight(x, z));

export function zoneAt(x, z) {
  for (const zn of ZONES) {
    if (zn.off) continue;
    if (Math.abs(x - zn.x) <= zn.w / 2 && Math.abs(z - zn.z) <= zn.d / 2) return zn;
  }
  return null;
}

// What covers the ground here (cover.js COVER values).
export function coverAt(x, z) {
  const zn = zoneAt(x, z);
  if (zn) return zn.kind === 'town' ? COVER.URBAN : COVER.FARM;
  if (ground) return ground.coverAt(x, z);
  // the practice valley: sea, beach, woods on the lower slopes, open grass
  const h = rawHeight(x, z);
  if (h < SEA_LEVEL) return COVER.OCEAN;
  if (h < 2.2) return COVER.SAND;
  if (h > 150) return COVER.ROCK;
  if (h > 4 && h < 115 && fbm(x / 300, z / 300, 44) > -0.05 && Math.hypot(x - LAUNCH.x, z - LAUNCH.z) > 110) return COVER.WOOD;
  return COVER.NONE;
}
export { rawHeight };

// ---------- air ----------
export const THERMALS = [];
export const RAIN_CLOUDS = [];

// Centre of a thermal column at height y: it leans downwind as it rises.
export function thermalCenter(th, y, wind, out) {
  const L = CONFIG.lift;
  const drift = (Math.max(0, y - th.base) / L.thermalRiseRate) * L.thermalDrift;
  out.x = th.x + wind.x * drift;
  out.z = th.z + wind.z * drift;
  return out;
}

// Vertical air speed at a point (positive = rising). Optionally fills `parts`.
export function verticalAir(x, y, z, wind, parts) {
  const L = CONFIG.lift;
  let thermal = 0, ridge = 0, rain = 0;

  const r = L.thermalRadius, r2 = r * r;
  const windFade = 1 - Math.min(0.8, L.thermalWindPenalty * wind.speed);
  for (const th of THERMALS) {
    const hgt = y - th.base;
    if (hgt < -5 || hgt > L.thermalTop) continue;
    const drift = (Math.max(0, hgt) / L.thermalRiseRate) * L.thermalDrift;
    const dx = x - (th.x + wind.x * drift), dz = z - (th.z + wind.z * drift);
    const d2 = dx * dx + dz * dz;
    if (d2 > 9 * r2) continue;
    const d = Math.sqrt(d2);
    const core = Math.exp(-d2 / r2);
    const ring = Math.exp(-((d - 1.7 * r) ** 2) / (0.25 * r2));
    const fade = 1 - smooth(L.thermalTop * 0.65, L.thermalTop, hgt);
    thermal += L.thermalStrength * th.mul * (core - L.thermalSinkRing * ring) * fade * windFade;
  }

  if (wind.speed > 0.01) {
    const agl = y - surfaceHeight(x, z);
    if (agl < L.ridgeDepth * 4) {
      const e = 8;
      const gx = (shapeHeight(x + e, z) - shapeHeight(x - e, z)) / (2 * e);
      const gz = (shapeHeight(x, z + e) - shapeHeight(x, z - e)) / (2 * e);
      const along = wind.x * gx + wind.z * gz; // air pushed uphill rises
      let rv = along * L.ridgeFactor * (along < 0 ? L.leeSinkFactor : 1);
      rv *= Math.exp(-Math.max(0, agl) / L.ridgeDepth);
      ridge = clamp(rv, -L.maxRidge, L.maxRidge);
    }
  }

  const rr2 = L.rainRadius * L.rainRadius;
  for (const c of RAIN_CLOUDS) {
    if (y > c.base + 10) continue;
    const dx = x - c.x, dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 9 * rr2) continue;
    rain -= L.rainSink * Math.exp(-d2 / rr2);
  }

  if (parts) {
    parts.thermal = thermal;
    parts.ridge = ridge;
    parts.rain = rain;
  }
  return thermal + ridge + rain;
}

// ---------- buildings (data first, so collisions work without meshes) ----------
export const BUILDINGS = [];
function makeBuildings() {
  BUILDINGS.length = 0;
  const rng = mulberry32(99);
  const T = TOWN;
  if (!T.off) for (let i = -4; i <= 4; i++) {
    for (let j = -3; j <= 3; j++) {
      if (i === 0 || j === 0) continue; // two main streets, square in the middle
      if (i === 1 && j === -1) continue; // church plot
      if (rng() < 0.15) continue;
      const fall = 1 - Math.hypot(i, j) / 7;
      BUILDINGS.push({
        x: T.x + i * 24 + (rng() - 0.5) * 4,
        z: T.z + j * 24 + (rng() - 0.5) * 4,
        w: 11 + rng() * 7,
        d: 11 + rng() * 7,
        h: 6 + rng() * 12 * Math.max(0.3, fall),
        roofH: 4 + rng() * 4,
        base: T.level,
        wall: Math.floor(rng() * 4),
        roof: Math.floor(rng() * 4),
        kind: 'house'
      });
    }
  }
  // church: nave + tower with a spire
  if (!T.off) BUILDINGS.push({ x: T.x + 24, z: T.z - 24, w: 12, d: 22, h: 13, roofH: 7, base: T.level, wall: 0, roof: 1, kind: 'church' });
  if (!T.off) BUILDINGS.push({ x: T.x + 24, z: T.z - 40, w: 7, d: 7, h: 30, roofH: 16, base: T.level, wall: 0, roof: 1, kind: 'tower' });
  // farmhouses beside the fields
  for (const f of FIELDS) {
    if (f.off) continue;
    const x = f.x + f.w / 2 + 22, z = f.z - f.d / 4;
    BUILDINGS.push({ x, z, w: 12, d: 9, h: 7, roofH: 5, base: groundHeight(x, z), wall: 1, roof: 0, kind: 'house' });
  }
  for (const b of BUILDINGS) {
    b.minX = b.x - b.w / 2; b.maxX = b.x + b.w / 2;
    b.minZ = b.z - b.d / 2; b.maxZ = b.z + b.d / 2;
    b.top = b.base + b.h + b.roofH * 0.5;
  }
}

// Sunshine makes thermals: clear skies a little stronger, overcast weaker.
export function sunFactor(cloud) {
  return 1.1 - 0.35 * clamp(cloud, 0, 1);
}

// Lays the fields, town, lift and houses onto the current ground.
function layout() {
  for (const zn of ZONES) {
    zn.x = zn.x0; zn.z = zn.z0; zn.off = false; zn.score = 1;
    const lvl = ground ? placeOnLand(zn, zn.kind === 'town') : null;
    if (ground && lvl === null) zn.off = true; // open sea here
    zn.level = lvl ?? Math.max(3, rawHeight(zn.x, zn.z));
  }
  const sun = skies ? sunFactor(skies.cloud) : 1;
  THERMALS.length = 0;
  // over open sea there are still weak thermals (warm water, cumulus streets)
  const mul = (zn, m) => (zn.off ? m * 0.7 : m * (0.75 + 0.25 * zn.score)) * sun;
  const base = (zn) => (zn.off ? SEA_LEVEL : zn.level);
  for (const f of FIELDS) THERMALS.push({ x: f.x, z: f.z, base: base(f), mul: mul(f, f.mult), kind: f.off ? 'sea' : 'field' });
  THERMALS.push({ x: TOWN.x, z: TOWN.z, base: base(TOWN), mul: mul(TOWN, CONFIG.lift.townThermalFactor), kind: TOWN.off ? 'sea' : 'town' });
  RAIN_CLOUDS.length = 0;
  const rain = skies ? skies.rain : RAIN;
  rain.forEach((c, i) => {
    const x = c.x ?? (i % 2 ? 160 : -120);
    RAIN_CLOUDS.push({ x, z: c.z, base: surfaceHeight(x, c.z) + CONFIG.lift.rainCloudBase, mm: c.mm ?? 1 });
  });
  makeBuildings();
}
layout();

/**
 * Swaps in real land (from course.js); null = the practice valley.
 * weather: { cloud: 0…1, rain: [{ z, mm }] } along the course, or null.
 */
export function setGround(g, weather = null) {
  ground = g;
  skies = g ? weather : null;
  layout();
}

export function buildingHit(x, y, z) {
  for (const b of BUILDINGS) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.top) return b;
  }
  return null;
}

