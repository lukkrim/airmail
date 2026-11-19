// How far does a day's flight carry the letter toward the friend, by skill?
// Flies each pilot with random real-world-like winds and reports forward progress
// (game units along the throw direction). node scripts/skill-spread.mjs
import { CONFIG } from '../src/config.js';
import { groundHeight, verticalAir, buildingHit, LAUNCH, SEA_LEVEL, THERMALS, thermalCenter } from '../src/world.js';
import { Plane } from '../src/plane.js';
import { mulberry32 } from '../src/noise.js';
import * as THREE from 'three';

const STEP = 1 / 60;
const rng = mulberry32(7);

const pilots = {
  // stalls itself: pumps climb whenever it feels like it
  poor: (p, w, t, m) => ({ climb: (Math.floor(t / 1.3) % 3) === 0, dive: false, steer: Math.sin(t * 0.4) > 0.85 ? 1 : 0 }),
  handsOff: () => ({ climb: false, dive: false, steer: 0 }),
  speedKeeper: (p) => ({ climb: p.V > p.f.bestSpeed * 1.05, dive: false, steer: 0 }),
  // uses thermals, then heads on
  good: (p, wind, t, mem) => {
    const input = { climb: p.V > p.f.bestSpeed * 1.05, dive: false, steer: 0 };
    const c = { x: 0, z: 0 };
    let best = null, bestD = Infinity;
    for (const th of THERMALS) {
      if (mem.used.has(th)) continue;
      thermalCenter(th, p.pos.y, wind, c);
      const dz = c.z - p.pos.z;
      if (dz > 40) continue;
      const d = Math.hypot(c.x - p.pos.x, dz);
      if (d < bestD) { bestD = d; best = { th, x: c.x, z: c.z }; }
    }
    if (best && (bestD < CONFIG.lift.thermalRadius * 0.6 || (mem.circling && bestD < CONFIG.lift.thermalRadius))) {
      input.steer = 1;
      mem.circling = (mem.circling || 0) + STEP;
      if (p.pos.y - best.th.base > CONFIG.lift.thermalTop * 0.55 || mem.circling > 45) { mem.used.add(best.th); mem.circling = 0; }
      return input;
    }
    // otherwise steer toward next thermal if it is roughly ahead, else straight
    let want = 0;
    if (best && Math.abs(best.x - p.pos.x) < 400) want = Math.atan2(best.x - p.pos.x, -(best.z - p.pos.z));
    let diff = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
    input.steer = Math.abs(diff) > 0.08 ? Math.sign(diff) : 0;
    return input;
  }
};

function fly(fold, wind, pilot) {
  const plane = new Plane();
  const start = new THREE.Vector3(LAUNCH.x, groundHeight(LAUNCH.x, LAUNCH.z) + CONFIG.launch.heightAboveGround, LAUNCH.z);
  plane.reset(fold, start);
  const air = (x, y, z) => verticalAir(x, y, z, wind);
  const mem = { used: new Set() };
  let t = 0;
  while (t < 600) {
    plane.step(STEP, pilots[pilot](plane, wind, t, mem), wind, air);
    t += STEP;
    const p = plane.pos, g = groundHeight(p.x, p.z);
    if ((g < SEA_LEVEL && p.y <= SEA_LEVEL) || (g >= SEA_LEVEL && p.y <= g) || buildingHit(p.x, p.y, p.z)) break;
  }
  return -plane.pos.z; // progress toward the friend
}

const N = 40;
const winds = [];
for (let i = 0; i < N; i++) {
  // real 10 m winds: mostly 1–7 m/s, any direction
  const speed = Math.min(12, -Math.log(1 - rng()) * 3.5);
  const dir = rng() * 360 - 180;
  const r = (dir * Math.PI) / 180;
  winds.push({ speed, dirDeg: dir, x: speed * Math.sin(r), z: -speed * Math.cos(r) });
}
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
for (const pilot of Object.keys(pilots)) {
  for (const fold of ['glider', 'dart', 'stunt']) {
    const r = winds.map((w) => fly(fold, w, pilot)).sort((a, b) => a - b);
    const mean = r.reduce((s, v) => s + v, 0) / r.length;
    console.log(`${pilot.padEnd(12)} ${fold.padEnd(7)} mean ${mean.toFixed(0).padStart(5)}  p10 ${pct(r, 0.1).toFixed(0).padStart(5)}  median ${pct(r, 0.5).toFixed(0).padStart(5)}  p90 ${pct(r, 0.9).toFixed(0).padStart(5)}`);
  }
}

// ---- Pacing check: days to deliver with a fixed pace per journey ----
// Daily progress = skill multiplier × a hands-off glider flight under a random wind.
const J = CONFIG.journey;
const base = winds.map((w) => fly('glider', w, 'handsOff'));
const players = { great: 2.0, good: 1.6, average: 1.0, belowAverage: 0.8, poor: 0.65, veryPoor: 0.45 };
const routeUnits = J.averageDays * J.typicalFlightUnits; // the route length in "units at fixed pace"
const radiusUnits = J.deliverRadiusUnits;
console.log(`\nfixed pace: route = ${J.averageDays} × ${J.typicalFlightUnits} units; safety net from day ${J.catchUpFromDay}, ×${J.catchUpGrowth}/day`);
for (const [name, m] of Object.entries(players)) {
  const days = [];
  for (let k = 0; k < 4000; k++) {
    let left = routeUnits, day = 0;
    while (left > radiusUnits && day < 30) {
      day++;
      const boost = day >= J.catchUpFromDay ? J.catchUpGrowth ** (day - J.catchUpFromDay + 1) : 1;
      left -= m * base[Math.floor(rng() * base.length)] * boost;
    }
    days.push(day);
  }
  days.sort((a, b) => a - b);
  const hist = {};
  for (const d of days) hist[d] = (hist[d] || 0) + 1;
  const share = Object.entries(hist).map(([d, n]) => `${d}d ${Math.round((n / days.length) * 100)}%`).join('  ');
  console.log(`${name.padEnd(13)} ×${m}  p10 ${pct(days, 0.1)}  median ${pct(days, 0.5)}  p90 ${pct(days, 0.9)}   ${share}`);
}
