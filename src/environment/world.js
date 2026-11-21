import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../core/config.js';
import { fbm, hash2, mulberry32, clamp, smooth } from '../core/noise.js';

// The practice course. Throw direction is -Z. Sea along the right (+X),
// mountains along the left, and the coast sweeps across the far end.
export const BOUNDS = { minX: -1300, maxX: 1300, minZ: -5100, maxZ: 700 };
export const LAUNCH = { x: 0, z: 0 };
export const SEA_LEVEL = 0;

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

// Real land for this page (course.js), or null for the practice valley.
let ground = null;
export const groundInfo = () => (ground ? ground.info : null);
export const realGround = () => ground;
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

// On real land a field or the town may fall in the sea or on a cliff: move it
// sideways (then a little along) to the nearest gentle dry ground.
function placeOnLand(zn) {
  const probe = (x, z) => {
    const pts = [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, -0.5], [0, 0.5]]
      .map(([a, b]) => rawHeight(x + a * zn.w, z + b * zn.d));
    const lo = Math.min(...pts), hi = Math.max(...pts);
    return lo > 3 && hi - lo < 45 ? pts.reduce((s, v) => s + v, 0) / pts.length : null;
  };
  for (const dz of [0, -120, 120, -240, 240]) {
    for (let k = 0; k <= 12; k++) {
      for (const sgn of k ? [1, -1] : [1]) {
        const x = zn.x0 + sgn * k * 75, z = zn.z0 + dz;
        if (Math.abs(x) > BOUNDS.maxX - zn.w) continue;
        const lvl = probe(x, z);
        if (lvl !== null) { zn.x = x; zn.z = z; return lvl; }
      }
    }
  }
  return null;
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
    const wgt = zoneWeight(zn, x, z);
    if (wgt > 0) h += (zn.level - h) * wgt;
  }
  return h;
}
export const surfaceHeight = (x, z) => Math.max(SEA_LEVEL, groundHeight(x, z));

export function zoneAt(x, z) {
  for (const zn of ZONES) {
    if (Math.abs(x - zn.x) <= zn.w / 2 && Math.abs(z - zn.z) <= zn.d / 2) return zn;
  }
  return null;
}

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
  for (let i = -4; i <= 4; i++) {
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
  BUILDINGS.push({ x: T.x + 24, z: T.z - 24, w: 12, d: 22, h: 13, roofH: 7, base: T.level, wall: 0, roof: 1, kind: 'church' });
  BUILDINGS.push({ x: T.x + 24, z: T.z - 40, w: 7, d: 7, h: 30, roofH: 16, base: T.level, wall: 0, roof: 1, kind: 'tower' });
  // farmhouses beside the fields
  for (const f of FIELDS) {
    const x = f.x + f.w / 2 + 22, z = f.z - f.d / 4;
    BUILDINGS.push({ x, z, w: 12, d: 9, h: 7, roofH: 5, base: groundHeight(x, z), wall: 1, roof: 0, kind: 'house' });
  }
  for (const b of BUILDINGS) {
    b.minX = b.x - b.w / 2; b.maxX = b.x + b.w / 2;
    b.minZ = b.z - b.d / 2; b.maxZ = b.z + b.d / 2;
    b.top = b.base + b.h + b.roofH * 0.5;
  }
}

// Lays the fields, town, lift and houses onto the current ground.
function layout() {
  for (const zn of ZONES) {
    zn.x = zn.x0; zn.z = zn.z0;
    const lvl = ground ? placeOnLand(zn) : null;
    zn.level = lvl ?? Math.max(3, rawHeight(zn.x, zn.z));
  }
  THERMALS.length = 0;
  for (const f of FIELDS) THERMALS.push({ x: f.x, z: f.z, base: f.level, mul: f.mult, kind: 'field' });
  THERMALS.push({ x: TOWN.x, z: TOWN.z, base: TOWN.level, mul: CONFIG.lift.townThermalFactor, kind: 'town' });
  RAIN_CLOUDS.length = 0;
  for (const c of RAIN) RAIN_CLOUDS.push({ ...c, base: surfaceHeight(c.x, c.z) + CONFIG.lift.rainCloudBase });
  makeBuildings();
}
layout();

/** Swaps in real land (from course.js) before the world is built; null = practice valley. */
export function setGround(g) {
  ground = g;
  layout();
}

export function buildingHit(x, y, z) {
  for (const b of BUILDINGS) {
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.top) return b;
  }
  return null;
}

// ---------- visuals ----------
function makePaperTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  const rng = mulberry32(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 232 + rng() * 23;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.1;
  g.strokeStyle = '#7d725d';
  for (let i = 0; i < 260; i++) {
    const x = rng() * 256, y = rng() * 256, a = rng() * Math.PI, l = 6 + rng() * 18;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeFurrowTexture(a, b) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? a : b;
    g.fillRect(0, i * 8, 128, 8);
  }
  const rng = mulberry32(3);
  g.globalAlpha = 0.12;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rng() < 0.5 ? '#ffffff' : '#6b5420';
    g.fillRect(rng() * 128, rng() * 128, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const COL = {
  horizon: new THREE.Color('#e6eff1')
};
export const HORIZON_COLOR = COL.horizon;

// Natural ground colours (sRGB), mixed by height, slope and patchy noise.
const GROUND = Object.fromEntries(Object.entries({
  wetSand: '#a99a77', sand: '#cdbd92', lush: '#566f35', grass: '#6b8340', dry: '#8d8b4f',
  heath: '#6f6a45', soil: '#7a6648', rock: '#77726a', rockLight: '#9d978b', snow: '#e9edf0',
  field: '#c2a258', town: '#a39b8d'
}).map(([k, v]) => [k, new THREE.Color(v)]));

// slope: 0 flat … 1 vertical. metres: real height on real land, else null.
function groundColor(x, z, h, slope, metres, out) {
  const zn = zoneAt(x, z);
  if (zn && zn.kind === 'field') return out.copy(GROUND.field);
  if (zn && zn.kind === 'town') return out.copy(GROUND.town);
  const beach = metres === null ? 2.2 : 1.2; // real coasts: only a thin strip of sand
  if (h < beach) return out.copy(GROUND.wetSand).lerp(GROUND.sand, clamp(h / beach, 0, 1));
  const n1 = fbm(x / 260, z / 260, 21) * 0.5 + 0.5;   // big patches
  const n2 = fbm(x / 60, z / 60, 33) * 0.5 + 0.5;     // small patches
  out.copy(GROUND.lush).lerp(GROUND.grass, smooth(0.25, 0.6, n1)).lerp(GROUND.dry, smooth(0.6, 0.85, n1) * 0.7);
  // high ground: thinner, browner cover, then bare rock and snow
  const m = metres ?? h * 12;                         // practice valley: a rough real-world height
  out.lerp(GROUND.heath, smooth(900, 1900, m) * 0.8);
  const rocky = Math.max(smooth(0.38, 0.62, slope + (n2 - 0.5) * 0.15), smooth(1900, 2600, m));
  out.lerp(n2 > 0.5 ? GROUND.rockLight : GROUND.rock, rocky);
  out.lerp(GROUND.soil, smooth(0.25, 0.4, slope) * (1 - rocky) * 0.35);
  const snowLine = 2500 + (n1 - 0.5) * 400;
  out.lerp(GROUND.snow, smooth(snowLine, snowLine + 250, m) * (1 - smooth(0.5, 0.75, slope)));
  return out.multiplyScalar(0.92 + n2 * 0.14);
}

// Fine grain over the ground (tiles every few metres), so it isn't flat paint.
function makeDetailTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      // tileable: sample noise on a torus
      const a = (i / S) * Math.PI * 2, b = (j / S) * Math.PI * 2;
      const u = Math.cos(a) * 2 + 9, v = Math.sin(a) * 2 + 9, w = Math.cos(b) * 2 + 9, q = Math.sin(b) * 2;
      const n = fbm(u * 2 + w * 1.3, v * 2 + q * 1.7, 5, 5) * 0.5 + fbm(u * 7 + q, w * 7 + v, 9, 3) * 0.5;
      const val = 226 + n * 34 + (hash2(i, j, 4) - 0.5) * 18;
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = clamp(val, 0, 255);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function addColor(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function makeCloud(rng, color, size) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    const s = size * (0.55 + rng() * 0.5);
    m.scale.set(s, s * 0.7, s);
    m.position.set((rng() - 0.5) * size * 2.2, rng() * size * 0.4, (rng() - 0.5) * size * 1.4);
    m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    grp.add(m);
  }
  return grp;
}

export function buildWorld(scene) {
  const rng = mulberry32(20261118);
  const paper = makePaperTexture();

  // the sky, fog and lights live in sky.js (they change with the time of day)

  // terrain: smooth shading, colours from height and slope, fine grain
  {
    const CELL = 18;
    const W = BOUNDS.maxX - BOUNDS.minX, D = BOUNDS.maxZ - BOUNDS.minZ;
    const geo = new THREE.PlaneGeometry(W, D, Math.round(W / CELL), Math.round(D / CELL));
    geo.rotateX(-Math.PI / 2);
    geo.translate((BOUNDS.minX + BOUNDS.maxX) / 2, 0, (BOUNDS.minZ + BOUNDS.maxZ) / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), z = pos.getZ(i);
      const edge = Math.abs(x - BOUNDS.minX) < 1 || Math.abs(x - BOUNDS.maxX) < 1 || Math.abs(z - BOUNDS.minZ) < 1 || Math.abs(z - BOUNDS.maxZ) < 1;
      if (!edge) {
        x += (hash2(i, 1, 5) - 0.5) * CELL * 0.3;
        z += (hash2(i, 2, 5) - 0.5) * CELL * 0.3;
      }
      pos.setXYZ(i, x, groundHeight(x, z), z);
    }
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal, uv = geo.attributes.uv;
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      groundColor(x, z, y, 1 - nrm.getY(i), ground ? ground.metres(x, z) : null, c);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      uv.setXY(i, x / 9, z / 9);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: makeDetailTexture(), roughness: 1, metalness: 0 }));
    terrain.name = 'terrain';
    scene.add(terrain);
  }

  // sea: gentle swell, a little shine from the sun
  {
    const geo = new THREE.PlaneGeometry(9000, 12000, 180, 240);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, SEA_LEVEL, -2200);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, SEA_LEVEL - 0.3 + fbm(x / 70, z / 40, 61, 3) * 0.6);
    }
    geo.computeVertexNormals();
    const sea = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#3f6a7c', roughness: 0.32, metalness: 0 }));
    sea.name = 'sea';
    scene.add(sea);
  }

  // wheat fields (striped overlays on the flattened ground)
  {
    const texA = makeFurrowTexture('#c9a85a', '#b39149');
    const texB = makeFurrowTexture('#bf9a52', '#a88443');
    for (const f of FIELDS) {
      const tex = (f.tone ? texB : texA).clone();
      tex.needsUpdate = true;
      tex.repeat.set(f.w / 60, f.d / 60);
      const geo = new THREE.PlaneGeometry(f.w, f.d);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.position.set(f.x, f.level + 0.35, f.z);
      scene.add(m);
    }
  }

  // buildings, merged into two meshes: houses (swapped for the Blender
  // cottage once the model kit loads) and landmarks (church and tower)
  {
    const walls = ['#f4ecdc', '#f1d9cf', '#d9e3ea', '#efe3c0'].map((c) => new THREE.Color(c));
    const roofs = ['#b9533f', '#4f607f', '#c99a2e', '#6e8a5a'].map((c) => new THREE.Color(c));
    for (const [name, pick] of [['houses', (b) => b.kind === 'house'], ['landmarks', (b) => b.kind !== 'house']]) {
      const parts = [];
      for (const b of BUILDINGS.filter(pick)) {
        const wall = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
        wall.translate(b.x, b.base + b.h / 2, b.z);
        parts.push(addColor(wall, walls[b.wall]));
        const roof = new THREE.ConeGeometry(1, 1, 4, 1).toNonIndexed();
        roof.rotateY(Math.PI / 4);
        roof.scale((b.w / Math.SQRT2) * 1.1, b.roofH, (b.d / Math.SQRT2) * 1.1);
        roof.translate(b.x, b.base + b.h + b.roofH / 2, b.z);
        parts.push(addColor(roof, roofs[b.roof]));
      }
      for (const p of parts) p.deleteAttribute('uv');
      const merged = mergeGeometries(parts);
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.name = name;
      scene.add(mesh);
    }
  }

  // trees
  {
    const geo = new THREE.ConeGeometry(1, 1, 5).toNonIndexed();
    geo.translate(0, 0.5, 0);
    geo.computeVertexNormals();
    const max = 700;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), max);
    const greens = ['#5f8f55', '#6f9c5c', '#4e7d4c', '#7aa564'].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; tries < 6000 && n < max; tries++) {
      const x = BOUNDS.minX + 100 + rng() * (BOUNDS.maxX - BOUNDS.minX - 200);
      const z = BOUNDS.minZ + 100 + rng() * (BOUNDS.maxZ - BOUNDS.minZ - 200);
      const h = groundHeight(x, z);
      if (h < 4 || h > 115) continue;
      if (Math.hypot(x - LAUNCH.x, z - LAUNCH.z) < 90) continue;
      if (ZONES.some((zn) => Math.abs(x - zn.x) < zn.w / 2 + 25 && Math.abs(z - zn.z) < zn.d / 2 + 25)) continue;
      if (fbm(x / 300, z / 300, 44) < -0.05) continue; // clump into woods
      const sc = 0.7 + rng() * 0.8;
      p.set(x, h - 0.5, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6);
      s.set(4 * sc, 12 * sc, 4 * sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, greens[Math.floor(rng() * greens.length)]);
      n++;
    }
    mesh.count = n;
    mesh.name = 'trees';
    scene.add(mesh);
  }

  // cumulus clouds mark the top of each thermal; they follow the wind.
  const cumulus = THERMALS.map((th) => {
    const c = makeCloud(rng, '#ffffff', th.kind === 'town' ? 20 : 26);
    scene.add(c);
    return c;
  });

  // rain clouds with falling rain
  const rains = RAIN_CLOUDS.map((rc) => {
    const cloud = makeCloud(rng, '#8a93a3', 42);
    cloud.position.set(rc.x, rc.base + 10, rc.z);
    cloud.scale.setScalar(1.25);
    scene.add(cloud);
    const n = 320;
    const pos = new Float32Array(n * 6);
    const drops = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * CONFIG.lift.rainRadius * 0.8;
      const x = rc.x + Math.cos(a) * rr, z = rc.z + Math.sin(a) * rr;
      const ground = surfaceHeight(x, z);
      drops.push({ x, z, ground, y: ground + rng() * (rc.base - ground) });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#5d72a0', transparent: true, opacity: 0.6 }));
    lines.frustumCulled = false;
    scene.add(lines);
    return { rc, drops, pos, geo };
  });

  // paper scraps spiralling up each thermal
  const SCRAPS = 36;
  const scrapGeo = new THREE.BufferGeometry();
  scrapGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1, 0, -0.8, -0.6, 0, 0.8, -0.5, 0.15]), 3));
  scrapGeo.computeVertexNormals();
  const scrapMesh = new THREE.InstancedMesh(scrapGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), THERMALS.length * SCRAPS);
  scrapMesh.frustumCulled = false;
  const scrapCols = ['#f39a3d', '#f7c873', '#ffffff', '#ef7d52'].map((c) => new THREE.Color(c));
  const scraps = [];
  THERMALS.forEach((th, ti) => {
    for (let i = 0; i < SCRAPS; i++) {
      scraps.push({ th, h: rng() * CONFIG.lift.thermalTop * 0.75, a: rng() * Math.PI * 2, r: 8 + rng() * CONFIG.lift.thermalRadius * 0.7, spin: rng() * 6 });
      scrapMesh.setColorAt(ti * SCRAPS + i, scrapCols[i % scrapCols.length]);
    }
  });
  scene.add(scrapMesh);

  const tmp = { x: 0, z: 0 };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3(2.4, 2.4, 2.4);

  function update(dt, t, wind) {
    const L = CONFIG.lift;
    THERMALS.forEach((th, i) => {
      const y = th.base + L.thermalTop * 0.85;
      thermalCenter(th, y, wind, tmp);
      cumulus[i].position.set(tmp.x, y, tmp.z);
    });

    for (const r of rains) {
      const n = r.drops.length;
      for (let i = 0; i < n; i++) {
        const d = r.drops[i];
        d.y -= 70 * dt;
        if (d.y < d.ground) d.y = r.rc.base;
        const o = i * 6;
        r.pos[o] = d.x; r.pos[o + 1] = d.y; r.pos[o + 2] = d.z;
        r.pos[o + 3] = d.x + wind.x * 0.25; r.pos[o + 4] = d.y + 6; r.pos[o + 5] = d.z + wind.z * 0.25;
      }
      r.geo.attributes.position.needsUpdate = true;
    }

    const top = L.thermalTop * 0.8;
    scraps.forEach((s, i) => {
      const rise = 2 + L.thermalStrength * s.th.mul * 0.8;
      s.h += rise * dt;
      if (s.h > top) s.h = 0;
      s.a += dt * (0.6 + 12 / s.r);
      const y = s.th.base + 2 + s.h;
      thermalCenter(s.th, y, wind, tmp);
      v4.set(tmp.x + Math.cos(s.a) * s.r, y, tmp.z + Math.sin(s.a) * s.r);
      e4.set(t * 1.7 + s.spin, t * 2.3 + s.spin * 2, s.spin);
      q4.setFromEuler(e4);
      m4.compose(v4, q4, s4);
      scrapMesh.setMatrixAt(i, m4);
    });
    scrapMesh.instanceMatrix.needsUpdate = true;
  }

  return { update, paper };
}
