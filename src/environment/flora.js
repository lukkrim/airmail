// Trees (realistic impostors, see impostors.js) and houses scattered over the
// land by what covers it: forests are
// dense, open country has the odd tree, towns are full of houses. The land is
// split into square chunks; only chunks near the camera are drawn, so a big
// forest costs no more than a small one. Placement is seeded per chunk, so
// the same course always grows the same trees.
import * as THREE from 'three';
import { mulberry32, smooth } from '../core/noise.js';
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
const clean = (g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k); g.index && (g = g.toNonIndexed()); return g; };

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
    // trees: realistic impostors (impostors.js), two kinds of fir and two
    // broadleaves; each kind is one draw call
    this.kinds = shapes.trees.map((k) => {
      const m = make(shapes.quad, opts.budget.trees, k.material);
      m.customDepthMaterial = k.depth;
      m.receiveShadow = false;
      return { ...k, mesh: m, n: 0 };
    });
    this.walls = make(shapes.house.walls, opts.budget.houses);
    this.roofs = make(shapes.house.roof, opts.budget.houses);
    for (const m of [...this.kinds.map((k) => k.mesh), this.walls, this.roofs]) m.setColorAt(0, new THREE.Color(1, 1, 1));
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
        const s = (cone ? 14 : 10) * (0.65 + rng() * 0.6);
        trees.push({ x, y: y - 0.3, z, s, cone, rot: rng() * 6.28, tint: 0.85 + rng() * 0.25, v: rng() });
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
    let nt = 0, nh = 0;
    for (const k of this.kinds) k.n = 0;
    const cones = this.kinds.filter((k) => k.cone), broads = this.kinds.filter((k) => !k.cone);
    const B = this.o.budget;
    const lists = [this.o.heroTrees || [], ...want.map(([, i, j]) => this.chunk(i, j).trees)];
    for (let li = 0; li < lists.length; li++) {
      const c = { trees: lists[li], houses: li === 0 ? [] : this.chunk(want[li - 1][1], want[li - 1][2]).houses };
      for (const t of c.trees) {
        if (nt >= B.trees) break;
        const pool = t.cone ? cones : broads;
        const k = pool[Math.floor(t.v * pool.length)];
        const sc = t.s / k.height;
        q.setFromAxisAngle(up, t.rot);
        m4.compose(p.set(t.x, t.y, t.z), q, s.set(sc, sc, sc));
        k.mesh.setMatrixAt(k.n, m4);
        k.mesh.setColorAt(k.n, col.setScalar(t.tint));
        k.n++;
        nt++;
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
    for (const [m, n] of [...this.kinds.map((k) => [k.mesh, k.n]), [this.walls, nh], [this.roofs, nh]]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
