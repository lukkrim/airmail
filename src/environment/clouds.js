// Soft, realistic clouds made of camera-facing puffs: a cumulus capping each
// thermal (so players can spot lift from afar), dark rain clouds, and a field
// of background clouds as thick as today's real cloud cover.
import * as THREE from 'three';
import { mulberry32, valueNoise } from '../core/noise.js';
import { AIR } from './atmosphere.js';

function puffTexture(seed) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  // many soft blobs in a rounded heap with a flatter base
  for (let i = 0; i < 110; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.33;
    const x = 0.5 + Math.cos(a) * r, y = 0.52 + Math.sin(a) * r * 0.7;
    const rad = (0.1 + rng() * 0.12) * S;
    const grd = g.createRadialGradient(x * S, y * S, 0, x * S, y * S, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  // shade: bright top, grey-blue underside, a little texture
  const img = g.getImageData(0, 0, S, S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const k = (j * S + i) * 4;
      const a = img.data[k + 3] / 255;
      const n = valueNoise(i / 18, j / 18, seed) * 0.5 + valueNoise(i / 6, j / 6, seed + 1) * 0.25;
      const t = j / S;
      const v = 1 - Math.max(0, t - 0.45) * 0.55 + n * 0.06;
      img.data[k] = Math.min(255, 255 * v * 0.97);
      img.data[k + 1] = Math.min(255, 255 * v * 0.985);
      img.data[k + 2] = Math.min(255, 255 * v);
      // firm, slightly ragged edges like a real cumulus, soft only at the base
      const dens = Math.min(1, a * 1.5) * (0.8 + n * 0.45);
      const edge = dens < 0.5 ? Math.pow(dens / 0.5, 1.6) * 0.5 : dens;
      img.data[k + 3] = Math.min(255, 255 * edge) * (1 - Math.max(0, t - 0.78) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Long, thin streaks of high cloud (tileable), for the cirrus layer.
function cirrusTexture() {
  const W = 512, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const a = (i / W) * Math.PI * 2, b = (j / H) * Math.PI * 2;
      // torus sampling keeps it tileable; stretched along x for streaks
      const x = Math.cos(a) * 1.2, y = Math.sin(a) * 1.2, u = Math.cos(b) * 5, v = Math.sin(b) * 5;
      let n = 0, amp = 1, f = 1;
      for (let o = 0; o < 5; o++) {
        n += valueNoise(x * f + u * f * 0.9 + 11, y * f + v * f + o * 7, 300 + o) * amp;
        amp *= 0.5; f *= 2.1;
      }
      const k = Math.max(0, n * 0.9 - 0.35);
      const idx = (j * W + i) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.min(255, k * k * 900);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let TEXTURES = null, CIRRUS = null;
const textures = () => (TEXTURES ||= [11, 23, 37].map(puffTexture));
export const cloudTextures = textures;

const DAY = new THREE.Color('#ffffff'), NIGHT = new THREE.Color('#3a4566'), DUSK = new THREE.Color('#ffc49a');

// Light on the clouds, shared by every puff (setLight).
const LIGHT = {
  cSunCol: { value: new THREE.Color(1, 1, 1) },
  cShadow: { value: new THREE.Color('#8f9bb0') }
};

// A puff that is lit like part of a real cloud: bright where it faces the
// sun and on top, grey-blue underneath and on the far side, and glowing at
// its thin edges when you look towards the sun through it (silver lining).
// dir: which way the puff sits from the cloud's centre.
function puffMaterial(map, dir, dark, opacity = 1) {
  const m = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: true, opacity });
  const U = { puffDir: { value: dir }, cDark: { value: dark ? 1 : 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIGHT, U, { cSun: AIR.fogSun });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudView;')
      .replace('#include <fog_vertex>', 'vCloudView = mvPosition.xyz;\n#include <fog_vertex>');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 cSun;
        uniform vec3 cSunCol;
        uniform vec3 cShadow;
        uniform vec3 puffDir;
        uniform float cDark;
        varying vec3 vCloudView;`)
      .replace('outgoingLight = diffuseColor.rgb;', `
        float a0 = diffuseColor.a / max(opacity, 1e-3);
        float lum = dot(diffuseColor.rgb, vec3(0.3333));       // the puff's own shading
        float facing = clamp(0.5 + 0.5 * dot(puffDir, cSun), 0.0, 1.0);
        float lit = clamp(facing * 0.6 + puffDir.y * 0.3 + 0.25, 0.0, 1.0) * mix(0.55, 1.05, lum);
        vec3 col = mix(cShadow, cSunCol, lit);
        vec3 sv = normalize((viewMatrix * vec4(cSun, 0.0)).xyz);
        float back = pow(max(dot(normalize(vCloudView), sv), 0.0), 7.0);
        // against the sun: light scatters forward through the whole cloud, most at thin edges
        col += cSunCol * back * (0.35 + 0.7 * (1.0 - a0)) * smoothstep(-0.05, 0.1, cSun.y);
        col *= mix(1.0, 0.6, cDark);
        outgoingLight = col;`);
  };
  m.customProgramCacheKey = () => 'cloudPuff';
  return m;
}

export class Clouds {
  constructor(root, seed = 5) {
    this.root = root;
    this.rng = mulberry32(seed);
    this.mats = [];  // every puff's material (they share the textures)
    this.drift = [];
  }

  /** One cloud: a heap of puffs. width ≈ size × 2. */
  make(size, dark = false) {
    const grp = new THREE.Group();
    const rng = this.rng;
    const n = 7 + Math.floor(rng() * 6);
    const tex = textures();
    for (let i = 0; i < n; i++) {
      const map = tex[Math.floor(rng() * tex.length)];
      const k = size * (0.9 + rng() * 0.9);
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * size * 0.9;
      const pos = new THREE.Vector3(Math.cos(a) * r, Math.abs(Math.sin(a * 1.7)) * size * 0.45 * rng(), Math.sin(a) * r * 0.8);
      const dir = new THREE.Vector3(pos.x / size, (pos.y / size) * 1.8 - 0.25, pos.z / size).normalize();
      const mat = puffMaterial(map, dir, dark);
      this.mats.push(mat);
      const s = new THREE.Sprite(mat);
      s.renderOrder = 2; // after the sea and lakes, which don't hide what's behind them
      s.scale.set(k * 1.5, k, 1);
      s.position.copy(pos);
      grp.add(s);
    }
    this.root.add(grp);
    return grp;
  }

  /** Background clouds spread over the sky, drifting with the wind. */
  scatter(cover, area) {
    const n = Math.round(4 + cover * 46);
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      const c = this.make(70 + rng() * 120, cover > 0.85 && rng() < 0.5);
      c.position.set(area.minX + rng() * (area.maxX - area.minX), 380 + rng() * 380, area.minZ + rng() * (area.maxZ - area.minZ));
      c.userData.area = area;
      this.drift.push(c);
    }
  }

  /** A thin layer of high streaky cloud that follows the camera. */
  cirrus(cover) {
    const tex = (this.cirrusTex = CIRRUS ||= cirrusTexture());
    tex.repeat.set(2.5, 2.5);
    const geo = new THREE.PlaneGeometry(26000, 26000);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.35 + cover * 0.4, fog: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 1500;
    m.renderOrder = -1;
    m.name = 'cirrus';
    this.root.add(m);
    this.cirrusMesh = m;
    this.extraMats = [...(this.extraMats || []), mat];
    return m;
  }

  /** Low banks of cloud lying along the hillsides: [{ x, y, z, w }]. */
  banks(spots) {
    const tex = textures();
    for (const b of spots) {
      const grp = new THREE.Group();
      const n = 4 + Math.floor(this.rng() * 4);
      for (let i = 0; i < n; i++) {
        const mat = puffMaterial(tex[Math.floor(this.rng() * tex.length)], new THREE.Vector3(this.rng() - 0.5, 0.6, this.rng() - 0.5).normalize(), false, 0.22);
        this.mats.push(mat);
        const sp = new THREE.Sprite(mat);
        sp.renderOrder = 2;
        const w = b.w * (0.5 + this.rng() * 0.6);
        sp.scale.set(w, w * (0.28 + this.rng() * 0.12), 1);
        sp.position.set((this.rng() - 0.5) * b.w * 1.2, (this.rng() - 0.5) * b.w * 0.06, (this.rng() - 0.5) * b.w * 0.5);
        grp.add(sp);
      }
      grp.position.set(b.x, b.y, b.z);
      this.root.add(grp);
    }
  }

  /** day: 0 night … 1 day; glow: sunrise/sunset warmth. */
  setLight(day, glow) {
    const c = new THREE.Color().copy(NIGHT).lerp(DAY, day).lerp(DUSK, glow * 0.6);
    LIGHT.cSunCol.value.copy(c).multiplyScalar(0.35 + 0.8 * day);
    LIGHT.cShadow.value.set('#2a3350').lerp(new THREE.Color('#8e9ab0'), day).lerp(new THREE.Color('#a08c9c'), glow * 0.35);
    if (this.cirrusMesh) this.cirrusMesh.material.color.copy(c).lerp(DUSK, glow * 0.5);
  }

  update(dt, wind, camPos) {
    if (this.cirrusMesh && camPos) {
      this.cirrusMesh.position.x = camPos.x;
      this.cirrusMesh.position.z = camPos.z;
      this.cirrusOff = (this.cirrusOff || 0) + dt;
      this.cirrusMesh.material.map.offset.set((camPos.x + this.cirrusOff * wind.x * 3) / 10400, -(camPos.z + this.cirrusOff * wind.z * 3) / 10400);
    }
    for (const c of this.drift) {
      c.position.x += wind.x * dt * 0.6;
      c.position.z += wind.z * dt * 0.6;
      const a = c.userData.area;
      if (c.position.x < a.minX) c.position.x += a.maxX - a.minX;
      if (c.position.x > a.maxX) c.position.x -= a.maxX - a.minX;
      if (c.position.z < a.minZ) c.position.z += a.maxZ - a.minZ;
      if (c.position.z > a.maxZ) c.position.z -= a.maxZ - a.minZ;
    }
  }
}
