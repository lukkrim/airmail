// Draws the course: realistic ground (natural colour from height and slope,
// overlaid with real land cover), lakes and rivers, a sea that reflects the
// sky, the land out to the horizon, forests and towns, wheat fields, clouds,
// rain and the paper scraps that ride each thermal.
//
// rebuild() redraws everything after world.setGround() swaps the course.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../core/config.js';
import { fbm, hash2, mulberry32, clamp, smooth, valueNoise } from '../core/noise.js';
import {
  BOUNDS, FAR, NEAR, LAUNCH, SEA_LEVEL, FIELDS, TOWN, THERMALS, RAIN_CLOUDS, BUILDINGS,
  groundHeight, rawHeight, coverAt, zoneAt, realGround, skiesInfo, thermalCenter
} from './world.js';
import { CoverGrid, paintCoverTexture } from './cover.js';
import { Scatter, coniferGeometry, broadleafGeometry, houseGeometry } from './flora.js';
import { Clouds } from './clouds.js';

const SMALL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// ---------- shared textures ----------
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
      const n = fbm(u * 2 + w * 1.3, v * 2 + q * 1.7, 5, 5) * 0.55 + fbm(u * 7 + q, w * 7 + v, 9, 3) * 0.45;
      const val = 204 + n * 70 + (hash2(i, j, 4) - 0.5) * 22;
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = clamp(val, 0, 255);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// Tileable ripples for the sea and lakes (a normal map).
function makeWaveNormals() {
  const S = 256;
  const h = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const a = (i / S) * Math.PI * 2, b = (j / S) * Math.PI * 2;
      let v = 0;
      for (let o = 0; o < 4; o++) {
        const f = 1 << o;
        v += valueNoise(Math.cos(a) * 3 * f + 20 + Math.cos(b) * 2 * f, Math.sin(a) * 3 * f + Math.sin(b) * 5 * f, 70 + o) / f;
      }
      h[j * S + i] = v;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const dx = h[j * S + ((i + 1) % S)] - h[j * S + ((i + S - 1) % S)];
      const dy = h[((j + 1) % S) * S + i] - h[((j + S - 1) % S) * S + i];
      const n = new THREE.Vector3(-dx * 2.2, -dy * 2.2, 1).normalize();
      const k = (j * S + i) * 4;
      img.data[k] = (n.x * 0.5 + 0.5) * 255; img.data[k + 1] = (n.y * 0.5 + 0.5) * 255; img.data[k + 2] = (n.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
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
  g.globalAlpha = 0.14;
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rng() < 0.5 ? '#f3e2a8' : '#6b5420';
    g.fillRect(rng() * 128, rng() * 128, 1.5, 1.5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------- ground colour ----------
const GROUND = Object.fromEntries(Object.entries({
  wetSand: '#a99a77', sand: '#cdbd92', lush: '#566f35', grass: '#6b8340', dry: '#8d8b4f',
  heath: '#6f6a45', soil: '#7a6648', rock: '#77726a', rockLight: '#9d978b', snow: '#e9edf0',
  field: '#b9994f', town: '#9d968a', seabed: '#b4a57c', deep: '#173540'
}).map(([k, v]) => [k, new THREE.Color(v)]));

// How dry and how wintry the grass looks: golden in the dry subtropics
// (California, the Mediterranean in summer), browner in a northern winter.
let climate = { dry: 0.15, winter: 0 };
export function setClimate(lat, date = new Date()) {
  const a = Math.abs(lat);
  const m = date.getMonth(); // 0 = January
  const summer = lat >= 0 ? m >= 5 && m <= 8 : m <= 1 || m === 11;
  const winterMonths = lat >= 0 ? m >= 10 || m <= 2 : m >= 4 && m <= 8;
  const dryBelt = Math.exp(-(((a - 33) / 9) ** 2));
  climate = {
    dry: Math.min(0.85, dryBelt * (summer || a < 36 ? 0.85 : 0.5) + 0.1),
    winter: winterMonths ? smooth(40, 55, a) * 0.6 : 0
  };
}
const DRY = new THREE.Color('#a39256'), WINTER = new THREE.Color('#7b7656');

// Natural colour (rgb) and how bare the ground is (a: rock, snow, beach),
// which the land cover can't paint over. slope: 0 flat … 1 vertical.
function groundTone(x, z, h, slope, metres, out) {
  out.a = 0;
  if (h < 0) { // under the sea: sand fading to deep water
    out.copy(GROUND.seabed).lerp(GROUND.deep, smooth(0, 10, -h));
    out.a = 1;
    return out;
  }
  const zn = zoneAt(x, z);
  if (zn) { out.copy(zn.kind === 'town' ? GROUND.town : GROUND.field); out.a = 1; return out; }
  const real = metres !== null;
  const beach = real ? 1.2 : 2.2;
  if (h < beach) { out.copy(GROUND.wetSand).lerp(GROUND.sand, clamp(h / beach, 0, 1)); out.a = real ? 0.5 : 1; return out; }
  const n1 = fbm(x / 260, z / 260, 21) * 0.5 + 0.5;   // big patches
  const n2 = fbm(x / 60, z / 60, 33) * 0.5 + 0.5;     // small patches
  out.copy(GROUND.lush).lerp(GROUND.grass, smooth(0.25, 0.6, n1)).lerp(GROUND.dry, smooth(0.6, 0.85, n1) * 0.7);
  out.lerp(DRY, climate.dry * (0.6 + 0.6 * n1) * (1 - smooth(0.3, 0.5, slope) * 0.5));
  out.lerp(WINTER, climate.winter);
  const m = metres ?? h * 12;                         // practice valley: a rough real-world height
  out.lerp(GROUND.heath, smooth(900, 1900, m) * 0.8);
  const rocky = Math.max(smooth(0.42, 0.66, slope + (n2 - 0.5) * 0.15), smooth(2000, 2700, m));
  out.lerp(n2 > 0.5 ? GROUND.rockLight : GROUND.rock, rocky);
  out.lerp(GROUND.soil, smooth(0.25, 0.4, slope) * (1 - rocky) * 0.35);
  const snowLine = 2600 + (n1 - 0.5) * 400;
  const snow = smooth(snowLine, snowLine + 250, m) * (1 - smooth(0.5, 0.75, slope));
  out.lerp(GROUND.snow, snow);
  out.a = Math.max(rocky * 0.9, snow);
  return out.multiplyScalar(0.92 + n2 * 0.14);
}

// Ground material: the natural colour (vertex rgba) under the land-cover
// texture, times a fine grain at two sizes.
function terrainMaterial(cover, rect, detail) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.coverMap = { value: cover };
    sh.uniforms.coverRect = { value: new THREE.Vector4(rect.x0, rect.z0, 1 / rect.w, 1 / rect.h) };
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D coverMap;\nuniform vec4 coverRect;\nuniform sampler2D detailMap;\nvarying vec2 vWorldXZ;')
      .replace('#include <color_fragment>', `
        vec2 cuv = (vWorldXZ - coverRect.xy) * coverRect.zw;
        vec4 cov = texture2D(coverMap, cuv);
        float inside = step(0.0, cuv.x) * step(cuv.x, 1.0) * step(0.0, cuv.y) * step(cuv.y, 1.0);
        float a = cov.a * inside * (1.0 - vColor.a);
        vec3 baseCol = mix(vColor.rgb, cov.rgb, a);
        float d0 = texture2D(detailMap, vWorldXZ / 1.6).r;
        float d1 = texture2D(detailMap, vWorldXZ / 7.0).r;
        float d2 = texture2D(detailMap, vWorldXZ / 83.0).r;
        diffuseColor.rgb *= baseCol * (0.2 + d1) * (0.6 + 0.5 * d2) * (0.7 + 0.37 * d0);
      `);
  };
  return mat;
}

function dataTexture(bytes, w, h, srgb) {
  const t = new THREE.DataTexture(bytes, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// The practice valley has no map data: rasterise its made-up cover once.
function practiceCover(region, cell) {
  const w = Math.ceil((region.maxX - region.minX) / cell), h = Math.ceil((region.maxZ - region.minZ) / cell);
  const g = new CoverGrid(region.minX, region.minZ, cell, w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) g.data[j * w + i] = coverAt(region.minX + (i + 0.5) * cell, region.minZ + (j + 0.5) * cell);
  }
  const tex = paintCoverTexture(g, 8);
  return { x0: g.x0, z0: g.z0, cell, w, h, rgba: tex.rgba, water: tex.water };
}

// A height-field mesh over a rectangle, coloured by groundTone.
function terrainGeometry(region, cell, heightAt, metresAt, sink = null) {
  const W = region.maxX - region.minX, D = region.maxZ - region.minZ;
  const geo = new THREE.PlaneGeometry(W, D, Math.round(W / cell), Math.round(D / cell));
  geo.rotateX(-Math.PI / 2);
  geo.translate((region.minX + region.maxX) / 2, 0, (region.minZ + region.maxZ) / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = heightAt(x, z);
    if (sink && sink(x, z)) y -= 80; // hidden under the detailed ground
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const cols = new Float32Array(pos.count * 4);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    groundTone(x, z, y, 1 - nrm.getY(i), metresAt ? metresAt(x, z) : null, c);
    cols[i * 4] = c.r; cols[i * 4 + 1] = c.g; cols[i * 4 + 2] = c.b; cols[i * 4 + 3] = c.a;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  return geo;
}

function disposeTree(obj, keep) {
  obj.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (keep.has(m)) continue;
      for (const k of ['map', 'alphaMap']) if (m[k] && !keep.has(m[k])) m[k].dispose();
      m.dispose();
    }
  });
}

export function buildWorld(scene) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);
  const detail = makeDetailTexture();
  const waves = makeWaveNormals();
  waves.repeat.set(160, 160);
  const waves2 = waves.clone();
  waves2.repeat.set(40, 40);
  const furrows = [makeFurrowTexture('#c9a85a', '#b39149'), makeFurrowTexture('#bf9a52', '#a88443')];
  const shapes = { conifer: coniferGeometry(), broadleaf: broadleafGeometry(), house: houseGeometry() };
  const keep = new Set([detail, waves, waves2, ...furrows, shapes.conifer, shapes.broadleaf, shapes.house.walls, shapes.house.roof]);
  let envMap = null;
  const shiny = []; // materials that reflect the sky
  let live = null;

  function populate() {
    const g = realGround();
    setClimate(g ? g.info.lat : 46);
    const rng = mulberry32(20261118);
    const metresAt = g ? (x, z) => g.metres(x, z) : null;
    shiny.length = 0;

    // ---- near ground, with land cover ----
    const near = g ? g.cover : practiceCover(NEAR, 6);
    const nearTex = dataTexture(near.rgba, near.w, near.h, true);
    const rect = { x0: near.x0, z0: near.z0, w: near.w * near.cell, h: near.h * near.cell };
    const geo = terrainGeometry(NEAR, SMALL ? 16 : 12, groundHeight, metresAt);
    // uv = position on the cover map (the water layer uses it)
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - rect.x0) / rect.w, (pos.getZ(i) - rect.z0) / rect.h);
    const terrain = new THREE.Mesh(geo, terrainMaterial(nearTex, rect, detail));
    terrain.name = 'terrain';
    terrain.receiveShadow = true;
    root.add(terrain);

    // lakes and rivers: a shiny layer just above the ground where the map has water
    if (g && near.water.some((v, i) => i % 4 === 1 && v > 0)) {
      const waterTex = dataTexture(near.water, near.w, near.h, false);
      const wm = new THREE.MeshStandardMaterial({
        color: '#2f5560', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.92, alphaMap: waterTex,
        normalMap: waves2, normalScale: new THREE.Vector2(0.25, 0.25), depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4
      });
      const water = new THREE.Mesh(geo, wm);
      water.position.y = 0.35;
      water.name = 'lakes';
      water.renderOrder = 1;
      root.add(water);
      shiny.push(wm);
    }

    // ---- the land out to the horizon ----
    {
      const far = g ? g.farCover : practiceCover(FAR, 100);
      const farTex = dataTexture(far.rgba, far.w, far.h, true);
      const frect = { x0: far.x0, z0: far.z0, w: far.w * far.cell, h: far.h * far.cell };
      const inside = (x, z) => x > NEAR.minX + 40 && x < NEAR.maxX - 40 && z > NEAR.minZ + 40 && z < NEAR.maxZ - 40;
      const farHeight = g ? (x, z) => g.height(x, z) : (x, z) => rawHeight(x, z);
      const fgeo = terrainGeometry(FAR, SMALL ? 200 : 150, farHeight, metresAt, inside);
      const fm = terrainMaterial(farTex, frect, detail);
      fm.polygonOffset = true; fm.polygonOffsetFactor = 2; fm.polygonOffsetUnits = 4;
      const farMesh = new THREE.Mesh(fgeo, fm);
      farMesh.name = 'horizon';
      root.add(farMesh);
    }

    // ---- sea: ripples, sky reflections, see-through near the shore ----
    {
      const sgeo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
      sgeo.rotateX(-Math.PI / 2);
      sgeo.translate(0, SEA_LEVEL, -4000);
      const sm = new THREE.MeshStandardMaterial({
        color: '#24505f', roughness: 0.22, metalness: 0, transparent: true, opacity: 0.86,
        normalMap: waves, normalScale: new THREE.Vector2(0.1, 0.1), depthWrite: false, envMapIntensity: 0.8
      });
      const sea = new THREE.Mesh(sgeo, sm);
      sea.name = 'sea';
      sea.receiveShadow = true;
      sea.renderOrder = 0;
      root.add(sea);
      shiny.push(sm);
    }

    // ---- wheat fields (striped overlays on the flattened ground) ----
    for (const f of FIELDS) {
      if (f.off) continue;
      const tex = furrows[f.tone].clone();
      tex.needsUpdate = true;
      tex.repeat.set(f.w / 60, f.d / 60);
      const fg = new THREE.PlaneGeometry(f.w, f.d);
      fg.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      m.position.set(f.x, f.level + 0.35, f.z);
      m.receiveShadow = true;
      root.add(m);
    }

    // ---- the town's buildings: gabled houses, and the church with its tower ----
    {
      const homes = BUILDINGS.filter((b) => b.kind === 'house');
      const WALLS = ['#ece4d4', '#e7d8c6', '#d8d4cc', '#efe3c6'].map((c) => new THREE.Color(c));
      const ROOFS = ['#9a4a36', '#5b5a60', '#a0683f', '#6d5f52'].map((c) => new THREE.Color(c));
      if (homes.length) {
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
        const wallsMesh = new THREE.InstancedMesh(shapes.house.walls, mat, homes.length);
        const roofMesh = new THREE.InstancedMesh(shapes.house.roof, mat, homes.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
        homes.forEach((b, i) => {
          q.setFromAxisAngle(up, rng() < 0.5 ? 0 : Math.PI);
          m4.compose(new THREE.Vector3(b.x, b.base, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
          wallsMesh.setMatrixAt(i, m4);
          roofMesh.setMatrixAt(i, m4);
          wallsMesh.setColorAt(i, WALLS[b.wall]);
          roofMesh.setColorAt(i, ROOFS[b.roof]);
        });
        for (const m of [wallsMesh, roofMesh]) { m.castShadow = m.receiveShadow = true; m.name = 'houses'; root.add(m); }
      }
      const parts = [];
      for (const b of BUILDINGS.filter((x) => x.kind !== 'house')) {
        const wall = new THREE.BoxGeometry(b.w, b.h, b.d).toNonIndexed();
        wall.translate(b.x, b.base + b.h / 2, b.z);
        parts.push(addColor(wall, new THREE.Color('#d9d2c4')));
        const roof = new THREE.ConeGeometry(1, 1, 4, 1).toNonIndexed();
        roof.rotateY(Math.PI / 4);
        roof.scale((b.w / Math.SQRT2) * 1.1, b.roofH, (b.d / Math.SQRT2) * 1.1);
        roof.translate(b.x, b.base + b.h + b.roofH / 2, b.z);
        parts.push(addColor(roof, new THREE.Color('#5d5a5e')));
      }
      if (parts.length) {
        for (const p of parts) p.deleteAttribute('uv');
        const merged = mergeGeometries(parts);
        merged.computeVertexNormals();
        const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
        mesh.name = 'landmarks';
        mesh.castShadow = mesh.receiveShadow = true;
        root.add(mesh);
      }
    }

    // ---- forests, trees and houses over the land ----
    const keepOut = (x, z) => {
      if (Math.hypot(x - LAUNCH.x, z - LAUNCH.z) < 60) return true;
      for (const zn of [...FIELDS, TOWN]) {
        if (!zn.off && Math.abs(x - zn.x) < zn.w / 2 + 12 && Math.abs(z - zn.z) < zn.d / 2 + 12) return true;
      }
      return false;
    };
    const scatter = new Scatter(root, {
      coverAt, heightAt: groundHeight, metresAt: metresAt || (() => null), keepOut,
      lat: g ? g.info.lat : 45,
      budget: SMALL ? { trees: 2200, houses: 500 } : { trees: 6000, houses: 1400 }
    }, shapes);

    // ---- clouds: one capping each thermal, rain clouds, and today's cover ----
    const clouds = new Clouds(root, 5);
    for (const m of [...clouds.mats, ...clouds.darkMats]) keep.add(m.map);
    const cumulus = THERMALS.map((th) => clouds.make(th.kind === 'town' ? 34 : 42));
    const skies = skiesInfo();
    clouds.scatter(skies ? skies.cloud : 0.35, { minX: -7000, maxX: 7000, minZ: -9000, maxZ: 3000 });

    const rains = RAIN_CLOUDS.map((rc) => {
      const cloud = clouds.make(70, true);
      cloud.position.set(rc.x, rc.base + 10, rc.z);
      const n = 360;
      const posArr = new Float32Array(n * 6);
      const drops = [];
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * CONFIG.lift.rainRadius * 0.8;
        const x = rc.x + Math.cos(a) * rr, z = rc.z + Math.sin(a) * rr;
        const gr = Math.max(SEA_LEVEL, groundHeight(x, z));
        drops.push({ x, z, ground: gr, y: gr + rng() * (rc.base - gr) });
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      const lines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#8f9db3', transparent: true, opacity: 0.45 }));
      lines.frustumCulled = false;
      root.add(lines);
      return { rc, drops, pos: posArr, geo: rg };
    });

    // paper scraps spiralling up each thermal (the letter's own paper)
    const SCRAPS = 30;
    const scrapGeo = new THREE.BufferGeometry();
    scrapGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 1, 0, -0.8, -0.6, 0, 0.8, -0.5, 0.15]), 3));
    scrapGeo.computeVertexNormals();
    const scrapMesh = new THREE.InstancedMesh(scrapGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide }), Math.max(1, THERMALS.length * SCRAPS));
    scrapMesh.frustumCulled = false;
    const scrapCols = ['#f39a3d', '#f7c873', '#ffffff', '#ef7d52'].map((c) => new THREE.Color(c));
    const scraps = [];
    THERMALS.forEach((th, ti) => {
      for (let i = 0; i < SCRAPS; i++) {
        scraps.push({ th, h: rng() * CONFIG.lift.thermalTop * 0.75, a: rng() * Math.PI * 2, r: 8 + rng() * CONFIG.lift.thermalRadius * 0.7, spin: rng() * 6 });
        scrapMesh.setColorAt(ti * SCRAPS + i, scrapCols[i % scrapCols.length]);
      }
    });
    root.add(scrapMesh);

    for (const m of shiny) { m.envMap = envMap; m.needsUpdate = true; }
    return { scatter, clouds, cumulus, rains, scraps, scrapMesh };
  }

  function addColor(geo, color) {
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  }

  live = populate();

  const tmp = { x: 0, z: 0 };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), v4 = new THREE.Vector3(), s4 = new THREE.Vector3(2.4, 2.4, 2.4);

  function update(dt, t, wind, camPos) {
    const L = CONFIG.lift;
    THERMALS.forEach((th, i) => {
      const y = th.base + L.thermalTop * 0.85;
      thermalCenter(th, y, wind, tmp);
      live.cumulus[i].position.set(tmp.x, y, tmp.z);
    });
    live.clouds.update(dt, wind);
    if (camPos) live.scatter.update(camPos);
    for (const m of shiny) if (m.normalMap) { m.normalMap.offset.x += dt * 0.004; m.normalMap.offset.y += dt * 0.0025; }

    for (const r of live.rains) {
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
    live.scraps.forEach((s, i) => {
      const rise = 2 + L.thermalStrength * Math.max(0.3, s.th.mul) * 0.8;
      s.h += rise * dt;
      if (s.h > top) s.h = 0;
      s.a += dt * (0.6 + 12 / s.r);
      const y = s.th.base + 2 + s.h;
      thermalCenter(s.th, y, wind, tmp);
      v4.set(tmp.x + Math.cos(s.a) * s.r, y, tmp.z + Math.sin(s.a) * s.r);
      e4.set(t * 1.7 + s.spin, t * 2.3 + s.spin * 2, s.spin);
      q4.setFromEuler(e4);
      m4.compose(v4, q4, s4);
      live.scrapMesh.setMatrixAt(i, m4);
    });
    live.scrapMesh.instanceMatrix.needsUpdate = true;
  }

  return {
    root,
    update,
    paper: null,
    /** Redraws the whole course (after world.setGround). */
    rebuild() {
      const old = [...root.children];
      for (const o of old) { root.remove(o); disposeTree(o, keep); }
      live = populate();
    },
    /** The sky's reflection, for the sea and lakes. */
    setEnvironment(tex) {
      envMap = tex;
      for (const m of shiny) { m.envMap = tex; m.needsUpdate = true; }
    },
    setLight(day, glow) { live.clouds.setLight(day, glow); }
  };
}
