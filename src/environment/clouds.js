// Soft, realistic clouds made of camera-facing puffs: a cumulus capping each
// thermal (so players can spot lift from afar), dark rain clouds, and a field
// of background clouds as thick as today's real cloud cover.
import * as THREE from 'three';
import { mulberry32, valueNoise } from '../core/noise.js';

function puffTexture(seed) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = mulberry32(seed);
  // many soft blobs in a rounded heap with a flatter base
  for (let i = 0; i < 70; i++) {
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
      img.data[k + 3] = Math.min(255, 255 * Math.min(1, a * 1.5) * (0.85 + n * 0.3)) * (1 - Math.max(0, t - 0.78) * 4);
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

const DAY = new THREE.Color('#ffffff'), NIGHT = new THREE.Color('#3a4566'), DUSK = new THREE.Color('#ffc49a');

export class Clouds {
  constructor(root, seed = 5) {
    this.root = root;
    this.rng = mulberry32(seed);
    this.mats = textures().map((map) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: true }));
    this.darkMats = textures().map((map) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: true, color: '#a3aab4' }));
    this.drift = [];
  }

  /** One cloud: a heap of puffs. width ≈ size × 2. */
  make(size, dark = false) {
    const grp = new THREE.Group();
    const rng = this.rng;
    const n = 7 + Math.floor(rng() * 6);
    const mats = dark ? this.darkMats : this.mats;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(mats[Math.floor(rng() * mats.length)]);
      const k = size * (0.9 + rng() * 0.9);
      s.scale.set(k * 1.5, k, 1);
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * size * 0.9;
      s.position.set(Math.cos(a) * r, Math.abs(Math.sin(a * 1.7)) * size * 0.45 * rng(), Math.sin(a) * r * 0.8);
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
    const mats = textures().map((map) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: true, opacity: 0.22 }));
    this.extraMats = [...(this.extraMats || []), ...mats];
    this.bankMats = mats;
    for (const b of spots) {
      const grp = new THREE.Group();
      const n = 4 + Math.floor(this.rng() * 4);
      for (let i = 0; i < n; i++) {
        const sp = new THREE.Sprite(mats[Math.floor(this.rng() * mats.length)]);
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
    const c = new THREE.Color().copy(NIGHT).lerp(DAY, day).lerp(DUSK, glow * 0.45);
    for (const m of this.mats) m.color.copy(c);
    for (const m of this.bankMats || []) m.color.copy(c);
    if (this.cirrusMesh) this.cirrusMesh.material.color.copy(c).lerp(DUSK, glow * 0.5);
    const d = c.clone().multiply(new THREE.Color('#a3aab4'));
    for (const m of this.darkMats) m.color.copy(d);
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
