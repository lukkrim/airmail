// Do real-land courses keep the pacing? Flies a hands-off and a good pilot
// over varied real courses (coasts, plains, mountains, open sea, at short
// and long journey scales) with the same random winds as the practice valley,
// and compares forward progress. node scripts/sim/real-pacing.mjs
import { CONFIG } from '../../src/core/config.js';
import { groundHeight, verticalAir, buildingHit, LAUNCH, SEA_LEVEL, THERMALS, thermalCenter, setGround, sunFactor, BUILDINGS } from '../../src/environment/world.js';
import { Plane } from '../../src/flight/plane.js';
import { mulberry32 } from '../../src/core/noise.js';
import { nodeGround } from './realCourse.mjs';
import * as THREE from 'three';

const STEP = 1 / 60;
const rng = mulberry32(7);

const pilots = {
  handsOff: () => ({ climb: false, dive: false, steer: 0 }),
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
    let want = 0;
    if (best && Math.abs(best.x - p.pos.x) < 400) want = Math.atan2(best.x - p.pos.x, -(best.z - p.pos.z));
    const diff = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
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
  return -plane.pos.z;
}

const N = 24;
const winds = [];
for (let i = 0; i < N; i++) {
  const speed = Math.min(12, -Math.log(1 - rng()) * 3.5);
  const dir = rng() * 360 - 180;
  const r = (dir * Math.PI) / 180;
  winds.push({ speed, dirDeg: dir, x: speed * Math.sin(r), z: -speed * Math.cos(r) });
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

const COURSES = [
  ['practice valley', null],
  ['Big Sur coast', { lat: 36.27, lon: -121.81, bearing: 140, metresPerUnit: 75 }],
  ['Salinas valley', { lat: 36.3, lon: -121.4, bearing: 135, metresPerUnit: 75 }],
  ['Iowa plains', { lat: 41.6, lon: -93.6, bearing: 270, metresPerUnit: 120 }],
  ['Tuscany', { lat: 43.47, lon: 11.25, bearing: 150, metresPerUnit: 50 }],
  ['Swiss Alps', { lat: 46.69, lon: 7.86, bearing: 175, metresPerUnit: 60 }],
  ['Norway fjords', { lat: 60.39, lon: 5.33, bearing: 75, metresPerUnit: 100 }],
  ['Lake District', { lat: 54.6, lon: -3.14, bearing: 200, metresPerUnit: 40 }],
  ['Pacific, open sea', { lat: 30, lon: -140, bearing: 270, metresPerUnit: 1500 }],
  ['Sahara', { lat: 25, lon: 10, bearing: 90, metresPerUnit: 800 }],
  ['Tokyo westward', { lat: 35.6, lon: 139.7, bearing: 260, metresPerUnit: 300 }],
  ['Beijing to the sea', { lat: 39.9, lon: 116.4, bearing: 100, metresPerUnit: 1600 }],
  ['Andes from Santiago', { lat: -33.4, lon: -70.6, bearing: 80, metresPerUnit: 200 }]
];

// --cities: only courses through big cities (towers count as obstacles);
// add --no-city to fly the same courses with the city centres left out.
const CITIES = [
  ['New York, northward', { lat: 40.66, lon: -73.99, bearing: 15, metresPerUnit: 60 }],
  ['Chicago, northward', { lat: 41.7, lon: -87.62, bearing: 5, metresPerUnit: 120 }],
  ['London towards Paris', { lat: 51.47, lon: -0.12, bearing: 150, metresPerUnit: 45 }],
  ['Paris, southward', { lat: 48.88, lon: 2.35, bearing: 180, metresPerUnit: 45 }],
  ['Tokyo westward', { lat: 35.6, lon: 139.7, bearing: 260, metresPerUnit: 300 }],
  ['Into Manhattan', { lat: 40.6, lon: -74.02, bearing: 20, metresPerUnit: 25 }]
];
if (process.argv.includes('--cities')) COURSES.splice(0, COURSES.length, ...CITIES);
const noCity = process.argv.includes('--no-city');
const cloud = process.argv.includes('--cloudy') ? 0.9 : 0.5;
console.log(`hands-off and good glider, ${N} winds, cloud cover ${cloud} (sun factor ${sunFactor(cloud).toFixed(2)})`);
const rows = [];
for (const [name, o] of COURSES) {
  try {
    const g = o ? await nodeGround(o) : null;
    if (g && noCity) g.structures = [];
    setGround(g, o ? { cloud, rain: [] } : null);
  } catch (err) {
    console.log(`${name.padEnd(22)} failed: ${err.message}`);
    continue;
  }
  const kinds = THERMALS.map((t) => t.kind[0]).join('');
  const h = mean(winds.map((w) => fly('glider', w, 'handsOff')));
  const g = mean(winds.map((w) => fly('glider', w, 'good')));
  rows.push({ name, h, g, flights: winds.map((w) => fly('glider', w, 'handsOff')) });
  const towers = BUILDINGS.filter((b) => b.kind === 'city').length;
  console.log(`${name.padEnd(22)} city ${String(towers).padStart(3)}  thermals ${kinds.padEnd(6)} hands-off ${h.toFixed(0).padStart(5)}   good ${g.toFixed(0).padStart(5)}   good/hands-off ${(g / h).toFixed(2)}`);
}
const real = rows.filter((r) => r.name !== 'practice valley');
console.log(`\nreal courses: hands-off mean ${mean(real.map((r) => r.h)).toFixed(0)} (spread ${Math.min(...real.map((r) => r.h)).toFixed(0)}–${Math.max(...real.map((r) => r.h)).toFixed(0)}), good mean ${mean(real.map((r) => r.g)).toFixed(0)}`);

// ---- Pacing check on real land: days to deliver with the journey's fixed pace ----
const J = CONFIG.journey;
const base = real.flatMap((r) => r.flights);
const players = { great: 2.0, good: 1.6, average: 1.0, belowAverage: 0.8, poor: 0.65, veryPoor: 0.45 };
const routeUnits = J.averageDays * J.typicalFlightUnits;
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
console.log(`\nfixed pace: route = ${J.averageDays} × ${J.typicalFlightUnits} units; safety net from day ${J.catchUpFromDay}, ×${J.catchUpGrowth}/day`);
for (const [name, m] of Object.entries(players)) {
  const days = [];
  for (let k = 0; k < 4000; k++) {
    let left = routeUnits, day = 0;
    while (left > J.deliverRadiusUnits && day < 30) {
      day++;
      const boost = day >= J.catchUpFromDay ? J.catchUpGrowth ** (day - J.catchUpFromDay + 1) : 1;
      left -= m * base[Math.floor(rng() * base.length)] * boost;
    }
    days.push(day);
  }
  days.sort((a, b) => a - b);
  console.log(`${name.padEnd(13)} ×${m}  p10 ${pct(days, 0.1)}  median ${pct(days, 0.5)}  p90 ${pct(days, 0.9)}`);
}
