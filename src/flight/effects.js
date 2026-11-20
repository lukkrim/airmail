import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { CONFIG } from '../core/config.js';
import { verticalAir, surfaceHeight } from '../environment/world.js';
import { clamp } from '../core/noise.js';

const UP = new THREE.Color('#ff8a2a');
const DOWN = new THREE.Color('#2f62e0');
const NEUTRAL = new THREE.Color('#ffffff');

// Streaks drift with the real air around the plane, so wind and lift are visible.
export class WindStreaks {
  constructor(scene) {
    const n = CONFIG.streaks.count;
    this.n = n;
    this.p = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 6);
    this.col = new Float32Array(n * 6);
    this.geo = new LineSegmentsGeometry();
    this.geo.setPositions(this.pos);
    this.geo.setColors(this.col);
    this.mat = new LineMaterial({ linewidth: CONFIG.streaks.width, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false });
    this.mesh = new LineSegments2(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.ready = false;
    this.c = new THREE.Color();
  }

  setResolution(w, h) {
    this.mat.resolution.set(w, h);
  }

  spawn(i, center) {
    const S = CONFIG.streaks;
    const x = center.x + (Math.random() * 2 - 1) * S.halfWidth;
    const z = center.z + (Math.random() * 2 - 1) * S.halfWidth;
    const g = surfaceHeight(x, z);
    const y = Math.max(g + 2 + Math.random() * 10, center.y + (Math.random() * 2 - 1) * S.halfHeight);
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
  }

  update(dt, center, wind) {
    const S = CONFIG.streaks;
    if (!this.ready) {
      for (let i = 0; i < this.n; i++) this.spawn(i, center);
      this.ready = true;
    }
    const hw = S.halfWidth, c = this.c;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      let x = this.p[o], y = this.p[o + 1], z = this.p[o + 2];
      const dx = x - center.x, dz = z - center.z;
      if (dx > hw) x -= 2 * hw; else if (dx < -hw) x += 2 * hw;
      if (dz > hw) z -= 2 * hw; else if (dz < -hw) z += 2 * hw;
      if (Math.abs(y - center.y) > S.halfHeight * 1.3) {
        this.spawn(i, center);
        x = this.p[o]; y = this.p[o + 1]; z = this.p[o + 2];
      }
      const w = verticalAir(x, y, z, wind);
      x += wind.x * dt; y += w * dt; z += wind.z * dt;
      if (y < surfaceHeight(x, z) + 1) {
        this.spawn(i, center);
        x = this.p[o]; y = this.p[o + 1]; z = this.p[o + 2];
      }
      this.p[o] = x; this.p[o + 1] = y; this.p[o + 2] = z;

      const sp = Math.hypot(wind.x, w, wind.z);
      const len = Math.min(S.maxLength, sp * S.lengthPerSpeed);
      const inv = sp > 0.01 ? 1 / sp : 0;
      const q = i * 6;
      this.pos[q] = x - wind.x * inv * len; this.pos[q + 1] = y - w * inv * len; this.pos[q + 2] = z - wind.z * inv * len;
      this.pos[q + 3] = x; this.pos[q + 4] = y; this.pos[q + 5] = z;

      const t = clamp(w / 2.5, -1, 1);
      c.copy(NEUTRAL).lerp(t > 0 ? UP : DOWN, Math.abs(t));
      this.col[q + 3] = c.r; this.col[q + 4] = c.g; this.col[q + 5] = c.b;
      c.lerp(NEUTRAL, 0.45);
      this.col[q] = c.r; this.col[q + 1] = c.g; this.col[q + 2] = c.b;
    }
    const start = this.geo.attributes.instanceStart.data;
    start.array.set(this.pos);
    start.needsUpdate = true;
    const cs = this.geo.attributes.instanceColorStart.data;
    cs.array.set(this.col);
    cs.needsUpdate = true;
  }
}

// Coloured trail behind the plane: orange while climbing, blue while sinking fast.
export class Trail {
  constructor(scene, max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setDrawRange(0, 0);
    this.line = new THREE.Line(this.geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    this.line.frustumCulled = false;
    scene.add(this.line);
    this.n = 0;
    this.c = new THREE.Color();
    this.points = []; // for the minimap
  }
  clear() {
    this.n = 0;
    this.points.length = 0;
    this.geo.setDrawRange(0, 0);
  }
  add(p, vy) {
    if (this.n >= this.max) return;
    const i = this.n * 3;
    this.pos[i] = p.x; this.pos[i + 1] = p.y; this.pos[i + 2] = p.z;
    const t = clamp(vy / 2.5, -1, 1);
    this.c.set('#ffffff').lerp(t > 0 ? UP : DOWN, Math.abs(t) * 0.9);
    this.col[i] = this.c.r; this.col[i + 1] = this.c.g; this.col[i + 2] = this.c.b;
    this.n++;
    this.points.push([p.x, p.z]);
    this.geo.setDrawRange(0, this.n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
