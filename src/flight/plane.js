import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { clamp } from '../core/noise.js';

export const FOLD_KEYS = ['dart', 'glider', 'stunt'];
const D2R = Math.PI / 180;

// Turn designer-facing stats into lift and drag constants.
// Lift per unit mass  L = g · c · (V / bestSpeed)²   (c = 1 hands-off, more while climbing)
// Drag per unit mass  D = cd·V² + k·L²/V²
// With c = 1 the plane settles into its flattest glide (glideRatio) at bestSpeed.
export function deriveFold(key) {
  const f = CONFIG.folds[key];
  const g = CONFIG.gravity;
  const dMin = g / f.glideRatio;
  return {
    ...f,
    key,
    cd: dMin / (2 * f.bestSpeed ** 2),
    k: (dMin * f.bestSpeed ** 2) / (2 * g * g),
    vStall: f.bestSpeed * f.stallFactor
  };
}

// Top-view outlines and triangles for each fold. Nose points to -Z.
const SHAPES = {
  dart: {
    tris: [
      [[0, 0, -1.7], [-0.6, 0.08, 0.9], [0, 0, 0.9], 'w'],
      [[0, 0, -1.7], [0, 0, 0.9], [0.6, 0.08, 0.9], 'w'],
      [[0, 0, -1.7], [0, -0.28, 0.75], [0, 0, 0.9], 'k']
    ],
    outline: [[0, -1.7], [0.6, 0.9], [-0.6, 0.9]]
  },
  glider: {
    tris: [
      [[0, 0, -1.1], [-0.45, 0.03, -0.45], [0, 0, 0.85], 'w'],
      [[-0.45, 0.03, -0.45], [-1.35, 0.15, 0.35], [0, 0, 0.85], 'w'],
      [[-1.35, 0.15, 0.35], [-1.15, 0.15, 0.85], [0, 0, 0.85], 'w'],
      [[0, 0, -1.1], [0, 0, 0.85], [0.45, 0.03, -0.45], 'w'],
      [[0.45, 0.03, -0.45], [0, 0, 0.85], [1.35, 0.15, 0.35], 'w'],
      [[1.35, 0.15, 0.35], [0, 0, 0.85], [1.15, 0.15, 0.85], 'w'],
      [[0, 0, -1.1], [0, -0.22, 0.6], [0, 0, 0.85], 'k']
    ],
    outline: [[0, -1.1], [0.45, -0.45], [1.35, 0.35], [1.15, 0.85], [-1.15, 0.85], [-1.35, 0.35], [-0.45, -0.45]]
  },
  stunt: {
    tris: [
      [[0, 0, -1.0], [-0.85, 0.05, 0.7], [0, 0, 0.75], 'w'],
      [[0, 0, -1.0], [0, 0, 0.75], [0.85, 0.05, 0.7], 'w'],
      [[-0.85, 0.05, 0.7], [-0.88, 0.42, 0.8], [-0.8, 0.05, 0.3], 'b'],
      [[0.85, 0.05, 0.7], [0.8, 0.05, 0.3], [0.88, 0.42, 0.8], 'b'],
      [[0, 0, -1.0], [0, -0.3, 0.65], [0, 0, 0.75], 'k']
    ],
    outline: [[0, -1.0], [0.85, 0.7], [0, 0.75], [-0.85, 0.7]]
  }
};

const PART_COLORS = { w: new THREE.Color('#fbfaf5'), k: new THREE.Color('#c8102e'), b: new THREE.Color('#1d4e9e') };

export function makePlaneMesh(key) {
  const shape = SHAPES[key];
  const pos = [], col = [];
  for (const [a, b, c, part] of shape.tris) {
    pos.push(...a, ...b, ...c);
    const cc = PART_COLORS[part];
    for (let i = 0; i < 3; i++) col.push(cc.r, cc.g, cc.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), new THREE.LineBasicMaterial({ color: '#2b3245' })));
  group.scale.setScalar(CONFIG.plane.scale);
  return group;
}

export function makeShadowMesh(key) {
  const pts = SHAPES[key].outline;
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#1d2433', transparent: true, opacity: 0.22, depthWrite: false }));
  m.scale.setScalar(CONFIG.plane.scale);
  return m;
}

// Top-view SVG for the fold picker.
export function foldIconSVG(key) {
  const pts = SHAPES[key].outline.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(' ');
  return `<svg viewBox="-1.6 -1.9 3.2 3" aria-hidden="true"><polygon points="${pts}" /><line x1="0" y1="${SHAPES[key].outline[0][1]}" x2="0" y2="0.9" /></svg>`;
}

export class Plane {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.V = 10;
    this.gamma = 0;
    this.heading = 0;
    this.bank = 0;
    this.stalled = false;
    this.stallTime = 0;
    this.w = 0;
    this.f = deriveFold('glider');
  }

  reset(key, at) {
    this.f = deriveFold(key);
    this.pos.copy(at);
    this.V = this.f.bestSpeed * this.f.throwSpeedFactor;
    this.gamma = CONFIG.launch.pitchDeg * D2R;
    this.gammaRate = 0;
    this.c = 1;
    this.heading = 0;
    this.bank = 0;
    this.stalled = false;
    this.stallTime = 0;
    this.vel.set(0, 0, -this.V);
  }

  step(dt, input, wind, airAt) {
    const f = this.f;
    const g = CONFIG.gravity;

    // roll toward the steering bank
    const bankTarget = input.steer * f.maxBankDeg * D2R;
    const rr = f.rollRateDeg * D2R * dt;
    this.bank += clamp(bankTarget - this.bank, -rr, rr);

    // stall: too slow, the wing lets go and the nose drops until speed comes back
    if (!this.stalled && this.V < f.vStall) {
      this.stalled = true;
      this.stallTime = 0;
    }
    if (this.stalled) {
      this.stallTime += dt;
      if (this.V > f.vStall * 1.3 && this.stallTime > 0.4) this.stalled = false;
    }

    // how hard the wing is pulling: 1 = hands-off trim
    let cTarget = 1;
    if (this.stalled) cTarget = f.stallLift;
    else if (input.climb) cTarget = f.climbLift;
    else if (input.dive) cTarget = f.diveLift;
    const cr = f.liftResponse * dt;
    this.c += clamp(cTarget - this.c, -cr, cr);

    // lift, with damping so hands-off swoops settle into a glide
    const vr = this.V / f.bestSpeed;
    const cEff = Math.max(0, this.c - (f.swoopDamping * this.gammaRate * this.V) / g);
    const L = g * cEff * vr * vr;
    const vt = Math.max(this.V, 3);
    const cosG = Math.cos(this.gamma);

    // path bends up when lift beats gravity; banking spends lift on turning
    this.gammaRate = (L * Math.cos(this.bank) - g * cosG) / vt;
    this.gamma += this.gammaRate * dt;
    if (f.canLoop) {
      // full vertical loops: keep the angle in (-π, π]
      if (this.gamma > Math.PI) this.gamma -= 2 * Math.PI;
      else if (this.gamma < -Math.PI) this.gamma += 2 * Math.PI;
    } else {
      this.gamma = clamp(this.gamma, -80 * D2R, 75 * D2R);
    }
    const turnDen = Math.sign(cosG || 1) * Math.max(Math.abs(cosG), 0.3);
    this.heading += ((L * Math.sin(this.bank)) / (vt * turnDen)) * f.turnFactor * dt;

    // energy: gravity along the path minus drag (pulling hard costs more)
    const drag = f.cd * this.V * this.V + (f.k * L * L) / (vt * vt);
    this.V += (-g * Math.sin(this.gamma) - drag) * dt;
    this.V = Math.max(this.V, 2);

    // move with the air mass
    const ch = Math.cos(this.gamma), sh = Math.sin(this.gamma);
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    this.w = airAt(this.pos.x, this.pos.y, this.pos.z);
    this.vel.set(fx * ch * this.V + wind.x, sh * this.V + this.w, fz * ch * this.V + wind.z);
    this.pos.addScaledVector(this.vel, dt);
  }

  applyTo(obj, t) {
    const wobble = this.stalled ? Math.sin(t * 22) * 0.12 : 0;
    obj.position.copy(this.pos);
    obj.rotation.set(this.gamma, -this.heading, -this.bank + wobble, 'YXZ');
  }
}
