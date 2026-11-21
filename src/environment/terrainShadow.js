// Shadows cast by the land itself (and the city's towers) over the whole
// course, for low suns and big hills: the sun's shadow map only covers a
// small box around the plane. For each spot it stores the height a point
// there must be above to see the sun past every hill and tower towards it;
// every lit material compares its own height with that (atmosphere.js).
// Worked out a slice at a time over a few frames whenever the sun moves.
import * as THREE from 'three';
import { AIR } from './atmosphere.js';

const CELL = 12;
const ROWS_PER_FRAME = 40;

export class TerrainShadow {
  constructor() {
    this.tex = null;
    this.job = null;
    this.doneDir = new THREE.Vector3(0, -1, 0);
  }

  /** heightAt(x, z) of the land; occluders: [{ minX, maxX, minZ, maxZ, top }] (towers). */
  setGround(region, heightAt, occluders = []) {
    const w = Math.ceil((region.maxX - region.minX) / CELL) + 1, h = Math.ceil((region.maxZ - region.minZ) / CELL) + 1;
    const H = new Float32Array(w * h);
    let max = -Infinity;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = Math.max(0, heightAt(region.minX + i * CELL, region.minZ + j * CELL));
        H[j * w + i] = v;
      }
    }
    for (const b of occluders) {
      for (let j = Math.max(0, Math.floor((b.minZ - region.minZ) / CELL)); j <= Math.min(h - 1, Math.ceil((b.maxZ - region.minZ) / CELL)); j++) {
        for (let i = Math.max(0, Math.floor((b.minX - region.minX) / CELL)); i <= Math.min(w - 1, Math.ceil((b.maxX - region.minX) / CELL)); i++) {
          H[j * w + i] = Math.max(H[j * w + i], b.top);
        }
      }
    }
    for (const v of H) max = Math.max(max, v);
    this.g = { x0: region.minX, z0: region.minZ, w, h, H, max };
    if (!this.tex) {
      this.tex = new THREE.DataTexture(new Uint16Array(w * h), w, h, THREE.RedFormat, THREE.HalfFloatType);
    } else if (this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex.dispose();
      this.tex = new THREE.DataTexture(new Uint16Array(w * h), w, h, THREE.RedFormat, THREE.HalfFloatType);
    }
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.back = new Uint16Array(w * h);
    AIR.sunMap.value = this.tex;
    AIR.sunRect.value.set(region.minX, region.minZ, 1 / ((w - 1) * CELL), 1 / ((h - 1) * CELL));
    AIR.sunOn.value = 0;
    this.doneDir.set(0, -1, 0);
    this.job = null;
  }

  /** Call every frame with the direction towards the sun. */
  update(sun) {
    if (!this.g) return;
    if (sun.y < 0.02) { AIR.sunOn.value = 0; this.job = null; return; }
    if (!this.job) {
      if (sun.angleTo(this.doneDir) < 0.008) return; // under half a degree: keep the current map
      this.job = { dir: sun.clone(), row: 0 };
    }
    const { w, h, H, max } = this.g;
    const d = this.job.dir;
    const hl = Math.hypot(d.x, d.z) || 1e-6;
    const dx = d.x / hl, dz = d.z / hl, tanA = d.y / hl;
    const toHalf = THREE.DataUtils.toHalfFloat;
    const end = Math.min(h, this.job.row + ROWS_PER_FRAME);
    for (let j = this.job.row; j < end; j++) {
      for (let i = 0; i < w; i++) {
        let s = -1e4;
        let t = CELL;
        while (t < 4000) {
          const rise = t * tanA;
          if (max - rise <= s) break;               // nothing further can be higher
          const fi = i + (dx * t) / CELL, fj = j + (dz * t) / CELL;
          if (fi < 0 || fj < 0 || fi >= w - 1 || fj >= h - 1) break;
          const v = H[Math.round(fj) * w + Math.round(fi)] - rise;
          if (v > s) s = v;
          t += CELL * (1 + t / 300);
        }
        this.back[j * w + i] = toHalf(Math.max(-1000, s));
      }
    }
    this.job.row = end;
    if (end >= h) {
      this.tex.image.data.set(this.back);
      this.tex.needsUpdate = true;
      this.doneDir.copy(d);
      this.job = null;
      AIR.sunOn.value = 1;
    }
  }
}
