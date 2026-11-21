// Draws the city centres (world.js makeCity): towers, mid-rises, malls and
// warehouses. Every building is a box in one instanced batch; a facade shader
// lays floors and window bays at real size over each wall whatever its height
// (so a tower is never a stretched picture), the glass reflects the sky, and
// at night a random share of the windows light up. Towers can step in near
// the top and carry plant rooms and masts; malls get a car park.
import * as THREE from 'three';
import { mulberry32, valueNoise } from '../core/noise.js';
import { NIGHT } from './houses.js';

const SLOTS = 8;      // facade types in the atlas, 256 px each
const BAY = 3.2;      // window bay width, game units (about metres)
const FLOOR = 3.6;    // storey height
const S = 256;

// ---------- the facade atlas (colour; alpha 1 = wall … 0.5 = glass) ----------
function paintAtlas() {
  const c = document.createElement('canvas');
  c.width = S * SLOTS; c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(c.width, S);
  const px = (x, y, r, gg, b, a = 0) => {
    const k = (y * c.width + x) * 4;
    img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = a;
  };
  const rng = mulberry32(31);
  const N = (x, y, s, seed) => valueNoise(x / s, y / s, seed) * 0.5 + 0.5;
  const B = 64; // pixels per bay and per floor
  for (let slot = 0; slot < SLOTS; slot++) {
    const ox = slot * S;
    // per-pane variation (blinds, tint) for glass types
    const pane = [];
    for (let i = 0; i < 64; i++) pane.push(rng());
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const bx = x % B, fy = y % B;               // position within bay / floor (y=0 top of floor)
        const bay = Math.floor(x / B), fl = Math.floor(y / B);
        const pv = pane[(bay * 4 + fl) % 64];
        const grain = N(x + ox, y, 6, 3 + slot) * 0.12 - 0.06;
        let r, gg, b, a = 0;
        if (slot === 0) { // blue-green glass curtain wall
          const spandrel = fy > 50;
          const mull = bx < 3 || bx === 32 || bx === 33;
          if (mull) { r = 170; gg = 178; b = 182; }
          else if (spandrel) { r = 52; gg = 66; b = 74; a = 60; }
          else { const t = fy / 50; r = 38 + 20 * t + pv * 12; gg = 62 + 22 * t + pv * 10; b = 70 + 22 * t; a = 255; }
        } else if (slot === 1) { // dark glass with silver fins
          const fin = bx % 32 < 4;
          const band = fy > 58;
          if (fin) { r = 196; gg = 200; b = 204; }
          else if (band) { r = 40; gg = 42; b = 46; }
          else { r = 22 + pv * 18; gg = 28 + pv * 16; b = 36 + pv * 14; a = 255; }
        } else if (slot === 2) { // concrete frame, deep windows
          const win = bx > 10 && bx < 54 && fy > 12 && fy < 48;
          const reveal = bx > 7 && bx < 57 && fy > 9 && fy < 51;
          const conc = 186 + grain * 200;
          if (win) { r = 30 + pv * 20; gg = 36 + pv * 18; b = 42 + pv * 14; a = 255; }
          else if (reveal) { r = conc * 0.62; gg = conc * 0.6; b = conc * 0.56; }
          else { r = conc; gg = conc * 0.96; b = conc * 0.88; }
        } else if (slot === 3) { // brick with punched windows
          const win = bx > 16 && bx < 48 && fy > 10 && fy < 46;
          const sill = bx > 13 && bx < 51 && fy >= 46 && fy < 50;
          const lintel = bx > 14 && bx < 50 && fy > 6 && fy <= 10;
          const row = Math.floor(y / 5), off = row % 2 ? 6 : 0;
          const mortar = y % 5 === 0 || (x + off) % 12 === 0;
          const tone = N(Math.floor((x + off) / 12) * 13, row * 7, 1, 9 + slot);
          if (win) { r = 28 + pv * 22; gg = 32 + pv * 20; b = 36 + pv * 16; a = 255; }
          else if (sill || lintel) { r = 214; gg = 208; b = 196; }
          else if (mortar) { r = 150; gg = 140; b = 128; }
          else { r = 128 + tone * 40; gg = 62 + tone * 22; b = 46 + tone * 14; }
        } else if (slot === 4) { // mall: shop fronts, a band, cladding panels
          if (fl === 3) { // bottom floor of the tile = ground floor (v grows upwards in the shader)
            const frame = bx < 4 || fy < 6;
            if (frame) { r = 90; gg = 94; b = 98; } else { r = 50 + pv * 30; gg = 60 + pv * 25; b = 66 + pv * 20; a = 255; }
          } else if (fl === 2 && fy < 20) { const k = Math.floor(x / 128) % 3; [r, gg, b] = [[176, 52, 44], [40, 92, 150], [214, 168, 52]][k]; }
          else { const joint = bx % 32 === 0 || fy % 32 === 0; const v = 206 + grain * 120; r = joint ? v * 0.75 : v; gg = joint ? v * 0.75 : v * 0.98; b = joint ? v * 0.76 : v * 0.95; }
        } else if (slot === 5) { // warehouse: ribbed metal, roller doors
          const rib = (x % 8) < 2;
          const door = fl === 3 && bay % 2 === 0 && bx > 8 && bx < 56 && fy > 8;
          const v = (rib ? 150 : 178) + grain * 80;
          if (door) { const line = fy % 5 === 0; r = gg = b = line ? 120 : 160; }
          else { r = v * 0.88; gg = v * 0.94; b = v; }
        } else if (slot === 6) { // flat roof: gravel and patches
          const v = 118 + N(x, y, 3, 77) * 50 + N(x, y, 40, 78) * 30;
          r = v; gg = v * 0.98; b = v * 0.94;
        } else { // car park: asphalt and bay lines
          const v = 58 + N(x, y, 2, 91) * 22;
          const line = (x % 40 < 2 && (y % 128) > 10 && (y % 128) < 118) || (y % 128 < 2);
          r = gg = b = line ? 210 : v;
        }
        // glass mask in alpha, kept above zero: a canvas forgets the colour of see-through pixels
        px(ox + x, y, Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, gg)), Math.max(0, Math.min(255, b)), 255 - Math.round(a / 2));
      }
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

let ATLAS = null;
const atlas = () => (ATLAS ||= paintAtlas());

function cityMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, envMapIntensity: 1 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.cityAtlas = { value: atlas() };
    sh.uniforms.nightGlow = NIGHT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP;
        varying vec3 vWN;
        varying vec3 vInfo;
        varying float vBase;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vInfo = instanceColor;
        vBase = instanceMatrix[3].y;
        vWP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        vWN = normalize(mat3(instanceMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D cityAtlas;
        uniform float nightGlow;
        varying vec3 vWP;
        varying vec3 vWN;
        varying vec3 vInfo;
        varying float vBase;
        float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `
        float slot = floor(vInfo.r * ${SLOTS}.0 + 0.01);
        float roofSlot = floor(vInfo.b * ${SLOTS}.0 + 0.01);
        float seed = vInfo.g;
        float glass = 0.0, lit = 0.0;
        vec3 fc;
        if (abs(vWN.y) > 0.5) {
          vec2 ruv = fract(vWP.xz / (roofSlot > 6.5 ? 14.0 : 11.0));
          fc = texture2D(cityAtlas, vec2((roofSlot + ruv.x) / ${SLOTS}.0, ruv.y)).rgb;
        } else {
          float along = abs(vWN.x) > 0.5 ? vWP.z * sign(vWN.x) : -vWP.x * sign(vWN.z);
          float u = along / ${BAY} + seed * 37.0;
          float fl = (vWP.y - vBase) / ${FLOOR};
          vec4 s = texture2D(cityAtlas, vec2((slot + fract(u / 4.0)) / ${SLOTS}.0, fract(fl / 4.0)));
          fc = s.rgb;
          glass = clamp((1.0 - s.a) * 2.0, 0.0, 1.0);
          if (fl < 1.0 && slot < 3.5) { fc = mix(fc, vec3(0.05, 0.06, 0.07), 0.5); glass = max(glass, 0.8); } // lobby
          float wid = cHash(vec2(floor(u * 2.0), floor(fl)) + seed * 113.0);
          lit = step(0.66, wid) * step(0.5, cHash(vec2(floor(fl), seed * 71.0)) + 0.3);
        }
        // each building its own shade: glass from blue-green to bronze, walls warmer or cooler
        float h1 = cHash(vec2(seed * 17.0, 1.0)), h2 = cHash(vec2(seed * 29.0, 2.0));
        vec3 glassTint = h1 < 0.35 ? vec3(0.9, 1.0, 1.08) : h1 < 0.6 ? vec3(1.12, 1.02, 0.85) : h1 < 0.8 ? vec3(1.05, 1.05, 1.05) : vec3(0.85, 1.05, 0.95);
        vec3 wallTint = mix(vec3(1.06, 1.0, 0.9), vec3(0.88, 0.92, 0.98), h2) * (0.85 + 0.3 * h1);
        fc *= mix(wallTint, glassTint, glass);
        diffuseColor.rgb *= fc;
        vec3 cityGlow = vec3(1.0, 0.8, 0.52) * (0.8 + 0.6 * cHash(vec2(seed, 3.0)));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.06, glass);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.25, glass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += cityGlow * 1.3 * glass * lit * nightGlow;`);
  };
  mat.customProgramCacheKey = () => 'city';
  return mat;
}

/**
 * Builds the city's meshes under root from world.js buildings (kind 'city').
 * Returns { material } (for sky reflections) or null when there is no city.
 */
export function buildCity(root, buildings, heightAt) {
  const list = buildings.filter((b) => b.kind === 'city');
  if (!list.length) return null;
  const boxes = [];
  const add = (x, y, z, w, h, d, slot, seed, roof = 6) => boxes.push([x, y, z, w, h, d, slot, seed, roof]);
  for (const b of list) {
    const top = b.base + b.h;
    if (b.tier) {
      const h1 = b.h * b.tier;
      add(b.x, b.base, b.z, b.w, h1, b.d, b.facade, b.seed);
      add(b.x, b.base + h1, b.z, b.w * 0.72, b.h - h1, b.d * 0.72, b.facade, b.seed);
    } else add(b.x, b.base, b.z, b.w, b.h, b.d, b.facade, b.seed);
    const tw = b.tier ? 0.72 : 1;
    if (b.use === 'tower' || b.use === 'midrise') {
      add(b.x + b.w * 0.12 * tw, top, b.z - b.d * 0.1 * tw, b.w * 0.34 * tw, 2.6, b.d * 0.3 * tw, 5, b.seed + 0.5, 6); // plant room
      if (b.real >= 230) add(b.x, top, b.z, 0.7, 14 + (b.real - 230) * 0.05, 0.7, 5, b.seed, 5); // mast
    }
    if (b.use === 'mall') {
      // a car park along one side, if the ground there is flat enough
      const pz = b.z + b.d / 2 + b.d * 0.4 + 2;
      const y0 = heightAt(b.x, pz), y1 = heightAt(b.x - b.w / 2, pz), y2 = heightAt(b.x + b.w / 2, pz);
      if (Math.max(y0, y1, y2) - Math.min(y0, y1, y2) < 2) add(b.x, Math.max(y0, y1, y2) - 0.05, pz, b.w, 0.12, b.d * 0.8, 7, b.seed, 7);
    }
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = cityMaterial();
  const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  boxes.forEach(([x, y, z, w, h, d, slot, seed, roof], i) => {
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, col.setRGB((slot + 0.5) / SLOTS, seed % 1, (roof + 0.5) / SLOTS));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = 'city';
  root.add(mesh);
  return { material: mat, mesh, geometry: geo };
}

export const cityAtlas = atlas;
