// Headless flight simulator for tuning: node scripts/simulate.mjs
// Flies scripted pilots with each fold and wind preset using the real
// physics and terrain, and prints distance, km and time aloft.
import { CONFIG } from '../src/config.js';
import { groundHeight, verticalAir, buildingHit, LAUNCH, SEA_LEVEL, FIELDS, THERMALS, thermalCenter } from '../src/world.js';
import { Plane, FOLD_KEYS } from '../src/plane.js';
import * as THREE from 'three';

const STEP = 1 / 120;

function makeWind(dirDeg, speed) {
  const r = (dirDeg * Math.PI) / 180;
  return { dirDeg, speed, x: speed * Math.sin(r), z: -speed * Math.cos(r) };
}

// Pilots: functions (plane, wind, t) -> input
const pilots = {
  // never touches anything
  handsOff: () => ({ climb: false, dive: false, steer: 0 }),
  // holds speed near best glide by pulsing climb
  speedKeeper: (p) => ({ climb: p.V > p.f.bestSpeed * 1.05, dive: false, steer: 0 }),
  // speed keeper that steers to the nearest thermal ahead and circles while climbing
  thermalHunter: (p, wind, t, mem) => {
    const input = { climb: p.V > p.f.bestSpeed * 1.05, dive: false, steer: 0 };
    const c = { x: 0, z: 0 };
    let best = null, bestD = Infinity;
    for (const th of THERMALS) {
      if (mem.used.has(th)) continue;
      thermalCenter(th, p.pos.y, wind, c);
      const dz = c.z - p.pos.z;
      const d = Math.hypot(c.x - p.pos.x, dz);
      if (dz > 40) continue; // behind
      if (d < bestD) { bestD = d; best = { th, x: c.x, z: c.z }; }
    }
    if (!best) return input;
    if (bestD < CONFIG.lift.thermalRadius * 0.6 || (mem.circling && bestD < CONFIG.lift.thermalRadius)) {
      input.steer = 1; // circle in lift
      mem.circling = (mem.circling || 0) + STEP;
      if (p.pos.y - best.th.base > CONFIG.lift.thermalTop * 0.6 || mem.circling > 40) { mem.used.add(best.th); mem.circling = 0; }
      return input;
    }
    const want = Math.atan2(best.x - p.pos.x, -(best.z - p.pos.z));
    let diff = want - p.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    input.steer = Math.abs(diff) > 0.08 ? Math.sign(diff) : 0;
    return input;
  }
};

function fly(fold, wind, pilotName) {
  const plane = new Plane();
  const start = new THREE.Vector3(LAUNCH.x, groundHeight(LAUNCH.x, LAUNCH.z) + CONFIG.launch.heightAboveGround, LAUNCH.z);
  plane.reset(fold, start);
  const air = (x, y, z) => verticalAir(x, y, z, wind);
  const mem = { used: new Set() };
  let t = 0, maxAgl = 0, kind = 'timeout', stalls = 0, wasStalled = false;
  while (t < 400) {
    const input = pilots[pilotName](plane, wind, t, mem);
    plane.step(STEP, input, wind, air);
    t += STEP;
    if (plane.stalled && !wasStalled) stalls++;
    wasStalled = plane.stalled;
    const p = plane.pos;
    const g = groundHeight(p.x, p.z);
    maxAgl = Math.max(maxAgl, p.y - Math.max(g, 0));
    if (g < SEA_LEVEL && p.y <= SEA_LEVEL) { kind = 'water'; break; }
    if (g >= SEA_LEVEL && p.y <= g) { kind = 'ground'; break; }
    if (buildingHit(p.x, p.y, p.z)) { kind = 'roof'; break; }
  }
  const dist = Math.hypot(plane.pos.x - start.x, plane.pos.z - start.z);
  return { dist, km: dist * CONFIG.kmPerUnit, t, maxAgl, kind, stalls };
}

const winds = [['calm', 0, 0], ['tail 8', 0, 8], ['head 6', 180, 6], ['cross 8', -90, 8], ['default tail 4', 0, 4]];
const which = process.argv[2] ? process.argv[2].split(',') : Object.keys(pilots);
for (const pilot of which) {
  console.log(`\n== pilot: ${pilot}`);
  console.log('fold    wind            dist    km    time   maxAGL  end     stalls');
  for (const fold of FOLD_KEYS) {
    for (const [name, dir, sp] of winds) {
      const r = fly(fold, makeWind(dir, sp), pilot);
      console.log(`${fold.padEnd(7)} ${name.padEnd(15)} ${r.dist.toFixed(0).padStart(5)} ${r.km.toFixed(0).padStart(5)} ${r.t.toFixed(1).padStart(6)}s ${r.maxAgl.toFixed(0).padStart(6)}  ${r.kind.padEnd(7)} ${r.stalls}`);
    }
  }
}
