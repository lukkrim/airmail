// Close-up ground detail around the camera: tufts of grass that sway in the
// wind, wild flowers, and mossy rocks and ferns (Poly Haven models). Only
// drawn near the camera and only when it is low (on the throw hill, landing,
// skimming the ground); from higher up the photo ground texture is enough.
// Placement is seeded per chunk, so it never shimmers or changes.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { COVER } from './cover.js';
import { AIR } from './atmosphere.js';
import { GLOW_GLSL } from './impostors.js';

const CHUNK = 24;
const SMALL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** A tuft of curved blades (about 1 unit tall), with a colour ramp from root
 * to tip and a little per-blade variation (some greener, some straw). */
function tuftGeometry(seed, BLADES, spread, SEG) {
  const rng = mulberry32(seed);
  const pos = [], h = [], shade = [], idx = [];
  for (let b = 0; b < BLADES; b++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * spread;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const lean = 0.1 + rng() * 0.4, la = a + (rng() - 0.5) * 1.2;
    const tall = 0.45 + rng() * 0.55, w = 0.018 + rng() * 0.018;
    const side = la + Math.PI / 2 + (rng() - 0.5) * 0.8;
    const sx = Math.cos(side) * w, sz = Math.sin(side) * w;
    const tone = rng() < 0.18 ? 1.35 : 0.85 + rng() * 0.3; // the odd dry blade
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const bend = lean * t * t;
      const cx = ox + Math.cos(la) * bend, cz = oz + Math.sin(la) * bend, cy = tall * t * (1 - lean * 0.3 * t);
      const ww = 1 - t * 0.9;
      pos.push(cx - sx * ww, cy, cz - sz * ww, cx + sx * ww, cy, cz + sz * ww);
      h.push(t, t);
      shade.push(tone, tone);
    }
    for (let k = 0; k < SEG; k++) {
      const i = base + k * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('blade', new THREE.Float32BufferAttribute(h, 1));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
  g.setIndex(idx);
  // grass catches light from above, not from the blade's own facing
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) { nrm[i] = (rng() - 0.5) * 0.4; nrm[i + 1] = 1; nrm[i + 2] = (rng() - 0.5) * 0.4; }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

/** A small flower: a stem and a few petals, coloured per instance. */
function flowerGeometry() {
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.008, 0.01, 0.5, 3, 1, true);
  stem.translate(0, 0.25, 0);
  const head = new THREE.IcosahedronGeometry(0.06, 0);
  head.scale(1, 0.5, 1);
  head.translate(0, 0.52, 0);
  for (const [geo, t] of [[stem, 0.3], [head, 1]]) {
    const g = geo.toNonIndexed();
    g.deleteAttribute('uv');
    g.setAttribute('blade', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(t), 1));
    parts.push(g);
  }
  const all = new THREE.BufferGeometry();
  const P = [], B = [], Nn = [];
  for (const g of parts) {
    g.computeVertexNormals();
    P.push(...g.attributes.position.array); B.push(...g.attributes.blade.array); Nn.push(...g.attributes.normal.array);
  }
  all.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  all.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  all.setAttribute('blade', new THREE.Float32BufferAttribute(B, 1));
  return all;
}

// Wind sway for anything with a 'blade' attribute (0 at the root, 1 at the tip).
function swayMaterial(opts, flower = false) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, ...opts });
  if (flower) mat.defines = { FLOWER: 1 };
  const U = { time: { value: 0 }, windVec: { value: new THREE.Vector2(1, 0) } };
  mat.userData.u = U;
  mat.customProgramCacheKey = () => (flower ? 'flower' : 'grass');
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { fogSun: AIR.fogSun, fogSunColor: AIR.fogSunColor });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float blade;\n#ifndef FLOWER\nattribute float shade;\n#endif\nuniform float time;\nuniform vec2 windVec;\nvarying float vBlade;\nvarying float vShade;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBlade = blade;
        #ifdef FLOWER
        vShade = 1.0;
        #else
        vShade = shade;
        #endif
        vec3 ip = instanceMatrix[3].xyz;
        float ph = ip.x * 0.31 + ip.z * 0.23;
        float gust = sin(time * 1.7 + ph) * 0.6 + sin(time * 3.1 + ph * 1.9) * 0.25 + 0.5;
        float k = blade * blade;
        transformed.x += windVec.x * gust * k * 0.22;
        transformed.z += windVec.y * gust * k * 0.22;
        transformed.y -= length(windVec) * gust * k * 0.05;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBlade;\nvarying float vShade;\n' + GLOW_GLSL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += leafGlow(diffuseColor.rgb, -vViewPosition, 1.2 * vBlade);')
      .replace('#include <color_fragment>', flower
        ? '#include <color_fragment>\n diffuseColor.rgb = mix(vec3(0.18, 0.3, 0.1), diffuseColor.rgb, step(0.9, vBlade));'
        : '#include <color_fragment>\n diffuseColor.rgb *= mix(0.42, 1.1, vBlade);\n diffuseColor.rgb = vShade > 1.2 ? mix(diffuseColor.rgb, vec3(0.55, 0.48, 0.25) * (0.5 + 0.6 * vBlade), 0.6) : diffuseColor.rgb * vShade;');
  };
  return mat;
}

// how thickly grass grows on each land cover (per 1 × 1 unit)
const GRASS_D = { [COVER.GRASS]: 1, [COVER.NONE]: 0.85, [COVER.FARM]: 0.5, [COVER.WETLAND]: 0.9, [COVER.WOOD]: 0.35, [COVER.URBAN]: 0.15, [COVER.SAND]: 0.08 };
const FLOWERS = ['#f4f1e6', '#f2d24a', '#b88fd6', '#e9e4f5', '#e96a4f'].map((c) => new THREE.Color(c));

/**
 * opts: heightAt(x,z), coverAt(x,z), toneAt(x,z,h) → THREE.Color of the
 * ground there (or null where nothing should grow: rock, snow, water),
 * keepOut(x,z). toneAt returns false where nothing grows at all (fields,
 * the town).
 */
export class Meadow {
  constructor(root, opts) {
    this.o = opts;
    this.chunks = new Map();
    this.key = '';
    this.radius = SMALL ? 35 : 75;
    const budget = SMALL ? 5000 : 30000;
    this.grassMat = swayMaterial({ color: '#ffffff' });
    this.flowerMat = swayMaterial({ color: '#ffffff' }, true);
    // a full tuft near the camera, a lighter one further out
    // (the far one is bigger, standing in for the thinned-out tufts around it)
    this.tufts = [tuftGeometry(3, 14, 0.32, 3), tuftGeometry(11, 10, 0.5, 2).scale(1.5, 1.2, 1.5)];
    const inst = (geo, mat, n, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = shadow;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      root.add(m);
      return m;
    };
    this.grass = [inst(this.tufts[0], this.grassMat, Math.round(budget * 0.45)), inst(this.tufts[1], this.grassMat, Math.round(budget * 0.55))];
    this.flowers = inst(flowerGeometry(), this.flowerMat, SMALL ? 500 : 2500);
    this.root = root;
    this.inst = inst;
    this.rockMeshes = [];
    this.fernMeshes = [];
    this.budget = budget;
    this.visible = true;
  }

  /** Every mesh the meadow draws. */
  allMeshes() {
    return [...this.grass, this.flowers, ...this.rockMeshes, ...this.fernMeshes];
  }

  /** The Poly Haven rocks and ferns, once loaded: [{ geometry, material }]. */
  setProps(rocks, ferns) {
    this.rockMeshes = rocks.map((r) => this.inst(r.geometry, r.material, SMALL ? 150 : 500, true));
    this.fernMeshes = ferns.map((r) => this.inst(r.geometry, r.material, SMALL ? 120 : 500, true));
    for (const m of [...this.rockMeshes, ...this.fernMeshes]) m.visible = this.visible;
    this.key = '';
  }

  chunk(ci, cj) {
    const key = `${ci},${cj}`;
    let c = this.chunks.get(key);
    if (c) return c;
    const { heightAt, coverAt, toneAt, keepOut } = this.o;
    const rng = mulberry32(((ci * 92837111) ^ (cj * 689287499)) >>> 0);
    const grass = [], flowers = [], rocks = [], ferns = [];
    const x0 = ci * CHUNK, z0 = cj * CHUNK;
    const STEP = 0.6;
    const col = new THREE.Color();
    for (let a = 0; a < CHUNK; a += STEP) {
      for (let b = 0; b < CHUNK; b += STEP) {
        const x = x0 + a + rng() * STEP, z = z0 + b + rng() * STEP;
        const r1 = rng(), r2 = rng(), r3 = rng();
        const cov = coverAt(x, z);
        const d = GRASS_D[cov] ?? 0;
        if (r1 >= d || keepOut(x, z)) continue;
        const y = heightAt(x, z);
        if (y < 0.5) continue;
        const tone = toneAt(x, z, y, col);
        if (tone === false) continue; // fields, town
        if (!tone) { // bare rock, snow, beach: the odd boulder
          if (r2 < 0.02) rocks.push({ x, y, z, s: 0.6 + r3 * 1.6, rot: r2 * 300, k: Math.floor(r3 * 97) });
          continue;
        }
        grass.push({ x, y: y - 0.04, z, s: 0.55 + r2 * 0.6, rot: r3 * 6.28, r: tone.r, g: tone.g, b: tone.b });
        if (r2 < 0.006 && cov !== COVER.WOOD) flowers.push({ x: x + 0.3, y, z, s: 0.8 + r3 * 0.6, c: Math.floor(r3 * 991) % FLOWERS.length });
        else if (r2 > 0.9984) rocks.push({ x, y, z, s: 0.35 + r3 * 1.1, rot: r3 * 300, k: Math.floor(r2 * 9973) });
        else if (cov === COVER.WOOD && r2 > 0.97) ferns.push({ x, y, z, s: 0.8 + r3 * 0.7, rot: r3 * 400, k: Math.floor(r3 * 977) });
      }
    }
    // ready-made instance data, in shuffled order so the first part of it is
    // an even thinning of the whole (used further out)
    for (let k = grass.length - 1; k > 0; k--) {
      const r = Math.floor(rng() * (k + 1));
      [grass[k], grass[r]] = [grass[r], grass[k]];
    }
    const gm = new Float32Array(grass.length * 16), gc = new Float32Array(grass.length * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sv = new THREE.Vector3();
    grass.forEach((g, k) => {
      q.setFromAxisAngle(up, g.rot);
      m4.compose(p.set(g.x, g.y, g.z), q, sv.setScalar(g.s));
      gm.set(m4.elements, k * 16);
      gc[k * 3] = g.r; gc[k * 3 + 1] = g.g; gc[k * 3 + 2] = g.b;
    });
    c = { n: grass.length, gm, gc, flowers, rocks, ferns };
    this.chunks.set(key, c);
    if (this.chunks.size > 260) this.chunks.delete(this.chunks.keys().next().value);
    return c;
  }

  update(cam, groundY, dt, t, wind) {
    for (const m of [this.grassMat, this.flowerMat]) {
      m.userData.u.time.value = t;
      m.userData.u.windVec.value.set(wind.x, wind.z).multiplyScalar(0.18);
    }
    const agl = cam.y - groundY;
    const show = agl < 90;
    if (show !== this.visible) {
      this.visible = show;
      for (const m of [...this.grass, this.flowers, ...this.rockMeshes, ...this.fernMeshes]) m.visible = show;
    }
    if (!show) return;
    const R = this.radius;
    const ci0 = Math.floor(cam.x / CHUNK), cj0 = Math.floor(cam.z / CHUNK), n = Math.ceil(R / CHUNK);
    const key = `${ci0},${cj0}`;
    if (key === this.key) return;
    const want = [];
    for (let i = ci0 - n; i <= ci0 + n; i++) {
      for (let j = cj0 - n; j <= cj0 + n; j++) {
        const d = Math.hypot((i + 0.5) * CHUNK - cam.x, (j + 0.5) * CHUNK - cam.z);
        if (d < R + CHUNK) want.push([d, i, j]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    // a few new chunks per frame at most (all at once on the first fill)
    const first = this.key === '';
    let made = 0, complete = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
    const ng = [0, 0];
    let nf = 0;
    const nr = this.rockMeshes.map(() => 0), nfe = this.fernMeshes.map(() => 0);
    const caps = this.grass.map((m) => m.instanceMatrix.count);
    for (const [d, i, j] of want) {
      if (!this.chunks.has(`${i},${j}`)) {
        if (!first && made >= 2) { complete = false; continue; }
        made++;
      }
      const c = this.chunk(i, j);
      // thinner further out, so the budget reaches the edge
      const keep = d < R * 0.35 ? 1 : d < R * 0.6 ? 0.5 : 0.25;
      const t = d < R * 0.3 ? 0 : 1;
      const mesh = this.grass[t];
      const take = Math.min(Math.ceil(c.n * keep), caps[t] - ng[t]);
      if (take > 0) {
        mesh.instanceMatrix.array.set(c.gm.subarray(0, take * 16), ng[t] * 16);
        mesh.instanceColor.array.set(c.gc.subarray(0, take * 3), ng[t] * 3);
        ng[t] += take;
      }
      for (const f of c.flowers) {
        if (nf >= this.flowers.instanceMatrix.count) break;
        m4.compose(p.set(f.x, f.y, f.z), q.identity(), s.setScalar(f.s));
        this.flowers.setMatrixAt(nf, m4);
        this.flowers.setColorAt(nf, FLOWERS[f.c]);
        nf++;
      }
      for (const [list, meshes, counts] of [[c.rocks, this.rockMeshes, nr], [c.ferns, this.fernMeshes, nfe]]) {
        if (!meshes.length) continue;
        for (const r of list) {
          const which = r.k % meshes.length;
          if (counts[which] >= meshes[which].instanceMatrix.count) continue;
          q.setFromAxisAngle(up, r.rot);
          m4.compose(p.set(r.x, r.y - r.s * 0.12, r.z), q, s.setScalar(r.s));
          meshes[which].setMatrixAt(counts[which], m4);
          counts[which]++;
        }
      }
    }
    this.key = complete ? key : 'partial';
    const done = (m, n2) => { m.count = n2; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
    this.grass.forEach((m, k) => done(m, ng[k]));
    done(this.flowers, nf);
    this.rockMeshes.forEach((m, k) => done(m, nr[k]));
    this.fernMeshes.forEach((m, k) => done(m, nfe[k]));
  }
}
