// Trees and houses scattered over the land by what covers it: forests are
// dense, open country has the odd tree, towns are full of houses. The land is
// split into square chunks; only chunks near the camera are drawn, so a big
// forest costs no more than a small one. Placement is seeded per chunk, so
// the same course always grows the same trees.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash2, mulberry32, smooth } from '../core/noise.js';
import { COVER } from './cover.js';

const CHUNK = 200;

// ---------- shapes (unit size: about 1 tall, scaled per instance) ----------
function paint(geo, fn) {
  const p = geo.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), col);
    c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
function wobble(geo, amount, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (hash2(Math.round(x * 97), Math.round(z * 97) + Math.round(y * 53), seed) - 0.5) * amount;
    const r = Math.hypot(x, z) || 1;
    p.setXYZ(i, x + (x / r) * k, y + k * 0.4, z + (z / r) * k);
  }
  return geo;
}
const clean = (g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); g.index && (g = g.toNonIndexed()); return g; };

const BARK = new THREE.Color('#4a3a2c');
function trunk(h, r) {
  const g = clean(new THREE.CylinderGeometry(r * 0.7, r, h, 6, 1, true));
  g.translate(0, h / 2, 0);
  return paint(g, (x, y, z, c) => c.copy(BARK));
}

/** A spruce-like conifer: stacked, ragged cones, darker inside and below. */
export function coniferGeometry() {
  const parts = [trunk(0.25, 0.035)];
  const deep = new THREE.Color('#1f3320'), tip = new THREE.Color('#3f5f35');
  const tiers = [[0.12, 0.5, 0.3], [0.32, 0.42, 0.28], [0.52, 0.32, 0.26], [0.7, 0.21, 0.3]];
  tiers.forEach(([y, r, h], i) => {
    let g = clean(new THREE.ConeGeometry(r, h + 0.18, 8, 1, true));
    g.translate(0, y + (h + 0.18) / 2, 0);
    g = wobble(g, 0.07, 3 + i);
    parts.push(paint(g, (x, yy, z, c) => {
      const out = Math.min(1, Math.hypot(x, z) / r);
      c.copy(deep).lerp(tip, 0.35 + 0.4 * (1 - out) * ((yy - y) / (h + 0.18)) + 0.25 * (yy));
    }));
  });
  const g = mergeVertices(mergeGeometries(parts), 0.02);
  g.computeVertexNormals();
  return g;
}

/** A broadleaf tree: a short trunk under a lumpy crown of three blobs. */
export function broadleafGeometry() {
  const parts = [trunk(0.42, 0.045)];
  const shade = new THREE.Color('#2b4220'), lit = new THREE.Color('#6a8a3e');
  for (const [x, y, z, r, d] of [[0, 0.64, 0, 0.32, 1], [0.17, 0.52, 0.08, 0.22, 0], [-0.15, 0.55, -0.1, 0.24, 0]]) {
    let g = clean(new THREE.IcosahedronGeometry(r, d));
    g = wobble(g, r * 0.35, Math.round(x * 100 + 7));
    g.translate(x, y, z);
    parts.push(paint(g, (px, py, pz, c) => c.copy(shade).lerp(lit, Math.min(1, Math.max(0, (py - 0.35) / 0.6)))));
  }
  const g = mergeVertices(mergeGeometries(parts), 0.01);
  g.computeVertexNormals();
  return g;
}

/** House walls (1 × 1 × 1 box, base at 0) and a gable roof above them. */
export function houseGeometry() {
  const walls = clean(new THREE.BoxGeometry(1, 1, 1));
  walls.translate(0, 0.5, 0);
  const o = 0.08; // eaves overhang
  const v = [
    [-0.5 - o, 1, -0.5 - o], [0.5 + o, 1, -0.5 - o], [0, 1.55, -0.5 - o],
    [-0.5 - o, 1, 0.5 + o], [0.5 + o, 1, 0.5 + o], [0, 1.55, 0.5 + o]
  ];
  const tri = [[0, 2, 1], [3, 4, 5], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 4], [0, 1, 4], [0, 4, 3]];
  const pos = [];
  for (const t of tri) for (const k of t) pos.push(...v[k]);
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.computeVertexNormals();
  walls.computeVertexNormals();
  return {
    walls: paint(walls, (x, y, z, c) => c.setScalar(y < 0.05 ? 0.7 : 1)),
    roof: paint(roof, (x, y, z, c) => c.setScalar(y < 1.01 ? 0.65 : 1))
  };
}

const WALLS = ['#e9e2d3', '#efe7da', '#d9cdb7', '#e3d6c2', '#cfc5b8', '#f1ece2'].map((c) => new THREE.Color(c));
const ROOFS = ['#8e4532', '#a0533b', '#6a5f59', '#4d4c50', '#7b4a36', '#9a8f84'].map((c) => new THREE.Color(c));

// chance per candidate spot, by cover
const TREE_P = { [COVER.WOOD]: 0.75, [COVER.WETLAND]: 0.1, [COVER.GRASS]: 0.05, [COVER.NONE]: 0.03, [COVER.FARM]: 0.006, [COVER.URBAN]: 0.06, [COVER.SAND]: 0.004 };
const TREE_STEP = 7;
const HOUSE_STEP = 15;

/**
 * opts: coverAt(x,z), heightAt(x,z), metresAt(x,z) → real height or null,
 * lat (for the mix of trees), keepOut(x,z) → true where nothing may grow
 * (fields, the town, the launch), budget { trees, houses }.
 */
export class Scatter {
  constructor(root, opts, shapes) {
    this.o = opts;
    this.chunks = new Map();
    this.active = '';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const make = (geo, n, material = mat) => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(m);
      return m;
    };
    this.conifers = make(shapes.conifer, opts.budget.trees);
    this.broadleaves = make(shapes.broadleaf, opts.budget.trees);
    this.walls = make(shapes.house.walls, opts.budget.houses);
    this.roofs = make(shapes.house.roof, opts.budget.houses);
    for (const m of [this.conifers, this.broadleaves, this.walls, this.roofs]) m.setColorAt(0, new THREE.Color(1, 1, 1));
  }

  chunk(ci, cj) {
    const key = `${ci},${cj}`;
    let c = this.chunks.get(key);
    if (c) return c;
    const { coverAt, heightAt, metresAt, keepOut } = this.o;
    const rng = mulberry32(((ci * 73856093) ^ (cj * 19349663)) >>> 0);
    const trees = [], houses = [];
    const x0 = ci * CHUNK, z0 = cj * CHUNK;
    const conif = (x, z) => {
      const m = metresAt(x, z);
      const high = m === null ? smooth(40, 120, heightAt(x, z)) : smooth(500, 1500, m);
      const north = smooth(48, 60, Math.abs(this.o.lat || 45));
      return Math.max(high, north * 0.8, 0.25);
    };
    for (let a = 0; a < CHUNK; a += TREE_STEP) {
      for (let b = 0; b < CHUNK; b += TREE_STEP) {
        const x = x0 + a + rng() * TREE_STEP, z = z0 + b + rng() * TREE_STEP;
        const p = TREE_P[coverAt(x, z)] || 0;
        if (rng() >= p || keepOut(x, z)) { rng(); rng(); continue; }
        const y = heightAt(x, z);
        if (y < 0.6) { rng(); rng(); continue; }
        const cone = rng() < conif(x, z);
        const s = (cone ? 11 : 8.5) * (0.65 + rng() * 0.6);
        trees.push({ x, y: y - 0.3, z, s, cone, rot: rng() * 6.28, tint: 0.82 + rng() * 0.3 });
      }
    }
    for (let a = 0; a < CHUNK; a += HOUSE_STEP) {
      for (let b = 0; b < CHUNK; b += HOUSE_STEP) {
        const x = x0 + a + HOUSE_STEP / 2 + (rng() - 0.5) * 4, z = z0 + b + HOUSE_STEP / 2 + (rng() - 0.5) * 4;
        const c = coverAt(x, z);
        const p = c === COVER.URBAN ? 0.55 : c === COVER.NONE || c === COVER.FARM ? 0.004 : 0;
        if (rng() >= p || keepOut(x, z)) continue;
        const w = 7 + rng() * 5, d = 6 + rng() * 4, h = 4.5 + rng() * 2.5 + (rng() < 0.15 ? 3 : 0);
        const ys = [heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), heightAt(x, z)];
        const y = Math.min(...ys);
        if (y < 0.6 || Math.max(...ys) - y > 4) continue;
        houses.push({ x, y: y - 0.2, z, w, d, h, rot: (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.3, wall: WALLS[Math.floor(rng() * WALLS.length)], roof: ROOFS[Math.floor(rng() * ROOFS.length)] });
      }
    }
    c = { trees, houses, d: 0 };
    this.chunks.set(key, c);
    if (this.chunks.size > 600) this.chunks.delete(this.chunks.keys().next().value);
    return c;
  }

  /** Draws the chunks nearest the camera, up to the budget. */
  update(cam, radius = 900) {
    const ci0 = Math.floor(cam.x / CHUNK), cj0 = Math.floor(cam.z / CHUNK), R = Math.ceil(radius / CHUNK);
    const want = [];
    for (let i = ci0 - R; i <= ci0 + R; i++) {
      for (let j = cj0 - R; j <= cj0 + R; j++) {
        const d = Math.hypot((i + 0.5) * CHUNK - cam.x, (j + 0.5) * CHUNK - cam.z);
        if (d <= radius + CHUNK * 0.7) want.push([d, i, j]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    const key = want.map((w) => w[1] + ',' + w[2]).join(';');
    if (key === this.active) return;
    this.active = key;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    let nc = 0, nb = 0, nh = 0;
    const B = this.o.budget;
    for (const [, i, j] of want) {
      const c = this.chunk(i, j);
      for (const t of c.trees) {
        const mesh = t.cone ? this.conifers : this.broadleaves;
        const n = t.cone ? nc : nb;
        if (nc + nb >= B.trees) break;
        q.setFromAxisAngle(up, t.rot);
        m4.compose(p.set(t.x, t.y, t.z), q, s.set(t.s * (t.cone ? 0.75 : 1), t.s, t.s * (t.cone ? 0.75 : 1)));
        mesh.setMatrixAt(n, m4);
        mesh.setColorAt(n, col.setScalar(t.tint));
        if (t.cone) nc++; else nb++;
      }
      for (const h of c.houses) {
        if (nh >= B.houses) break;
        q.setFromAxisAngle(up, h.rot);
        m4.compose(p.set(h.x, h.y, h.z), q, s.set(h.w, h.h, h.d));
        this.walls.setMatrixAt(nh, m4);
        this.walls.setColorAt(nh, h.wall);
        this.roofs.setMatrixAt(nh, m4);
        this.roofs.setColorAt(nh, h.roof);
        nh++;
      }
    }
    for (const [m, n] of [[this.conifers, nc], [this.broadleaves, nb], [this.walls, nh], [this.roofs, nh]]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
