// A few flocks of birds wheeling over the land near the camera: dark birds
// inland, white gulls over the sea. Each flock circles a slowly wandering
// centre; birds flap in bursts and glide in between. Looks only: they never
// touch the plane or the score.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { AIR } from './atmosphere.js';

const SMALL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** A simple bird: body and two swept wings; 'tip' is 1 at the wingtips (for flapping). */
function birdGeometry() {
  const P = [
    // left wing
    0, 0, 0.25, -0.65, 0.02, -0.15, 0, 0, -0.2,
    -0.65, 0.02, -0.15, -0.6, 0.02, -0.32, 0, 0, -0.2,
    // right wing
    0, 0, 0.25, 0, 0, -0.2, 0.65, 0.02, -0.15,
    0.65, 0.02, -0.15, 0, 0, -0.2, 0.6, 0.02, -0.32,
    // body and tail
    0, 0.03, 0.45, -0.07, 0, -0.1, 0.07, 0, -0.1,
    -0.07, 0, -0.1, -0.12, 0, -0.45, 0.12, 0, -0.45
  ];
  const tip = P.filter((_, i) => i % 3 === 0).map((x) => Math.min(1, Math.abs(x) / 0.6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
  g.computeVertexNormals();
  return g;
}

function birdMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.airTime = AIR.airTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tip;\nuniform float airTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = instanceMatrix[3].xyz;
        float ph = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
        // bursts of flapping, then a glide with the wings held up a little
        float burst = smoothstep(-0.2, 0.4, sin(airTime * 0.45 + ph));
        transformed.y += tip * (sin(airTime * 11.0 + ph) * 0.38 * burst + 0.08 * (1.0 - burst));`);
  };
  m.customProgramCacheKey = () => 'bird';
  return m;
}

export class Birds {
  /** opts: heightAt(x, z) (below 0 = sea). */
  constructor(root, opts) {
    this.o = opts;
    const rng = (this.rng = mulberry32(808));
    this.flocks = [];
    const nf = SMALL ? 2 : 4;
    let total = 0;
    for (let f = 0; f < nf; f++) {
      const n = 6 + Math.floor(rng() * 10);
      this.flocks.push({
        n, start: total, cx: 0, cz: 0, y: 0, placed: false,
        r: 45 + rng() * 90, w: (0.12 + rng() * 0.1) * (rng() < 0.5 ? -1 : 1), a: rng() * 6.28,
        wx: rng() * 6.28, wz: rng() * 6.28,
        birds: Array.from({ length: n }, () => ({ da: (rng() - 0.5) * 0.5, dr: (rng() - 0.5) * 22, dy: (rng() - 0.5) * 8, ph: rng() * 6.28 }))
      });
      total += n;
    }
    this.mesh = new THREE.InstancedMesh(birdGeometry(), birdMaterial(), total);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'birds';
    this.mesh.castShadow = false;
    root.add(this.mesh);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.v = new THREE.Vector3();
    this.s = new THREE.Vector3(1.3, 1.3, 1.3);
    this.col = new THREE.Color();
    this.t = 0;
  }

  // a new spot for a flock: somewhere around the camera, ahead more often
  place(f, cam) {
    const rng = this.rng;
    const a = rng() * Math.PI * 2, d = 120 + rng() * 380;
    f.cx = cam.x + Math.cos(a) * d;
    f.cz = cam.z + Math.sin(a) * d;
    const g = this.o.heightAt(f.cx, f.cz);
    f.sea = g < 0;
    f.y = Math.max(0, g) + 25 + rng() * 70;
    f.placed = true;
    const c = f.sea ? this.col.set('#f2f2ee') : this.col.set('#2b2a28');
    for (let i = 0; i < f.n; i++) this.mesh.setColorAt(f.start + i, c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, cam) {
    this.t += dt;
    for (const f of this.flocks) {
      if (!f.placed || Math.hypot(f.cx - cam.x, f.cz - cam.z) > 900) this.place(f, cam);
      f.a += f.w * dt;
      // the centre wanders slowly
      f.cx += Math.sin(this.t * 0.05 + f.wx) * 3 * dt;
      f.cz += Math.cos(this.t * 0.043 + f.wz) * 3 * dt;
      const ground = Math.max(0, this.o.heightAt(f.cx, f.cz));
      f.y += (Math.max(f.y, ground + 20) - f.y) * Math.min(1, dt);
      for (let i = 0; i < f.n; i++) {
        const b = f.birds[i];
        const a = f.a + b.da, r = f.r + b.dr;
        const x = f.cx + Math.cos(a) * r, z = f.cz + Math.sin(a) * r;
        const y = f.y + b.dy + Math.sin(this.t * 0.7 + b.ph) * 2;
        // heading along the circle, banked into the turn
        const heading = Math.atan2(-Math.sin(a) * Math.sign(f.w), Math.cos(a) * Math.sign(f.w));
        this.e.set(0, heading, -Math.sign(f.w) * 0.35);
        this.q.setFromEuler(this.e);
        this.m4.compose(this.v.set(x, y, z), this.q, this.s);
        this.mesh.setMatrixAt(f.start + i, this.m4);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
