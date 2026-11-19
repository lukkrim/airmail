import * as THREE from 'three';
import { CONFIG } from './config.js';
import {
  buildWorld, groundHeight, surfaceHeight, verticalAir, buildingHit, zoneAt,
  LAUNCH, SEA_LEVEL, HORIZON_COLOR
} from './world.js';
import { Plane, makePlaneMesh, makeShadowMesh, foldIconSVG, FOLD_KEYS } from './plane.js';
import { WindStreaks, Trail } from './effects.js';
import { Minimap } from './minimap.js';
import { initScreens } from './screens.js';
import { compass, normDeg } from './geo.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 120;

// ---------- renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = HORIZON_COLOR.clone();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.5, 5000);

scene.add(new THREE.HemisphereLight('#ffffff', '#b7a88a', 1.6));
const sun = new THREE.DirectionalLight('#fff4e2', 2.4);
sun.position.set(-0.55, 1, 0.35);
scene.add(sun);

const world = buildWorld(scene);
const streaks = new WindStreaks(scene);
const trail = new Trail(scene);
const minimap = new Minimap($('minimap'));

// ---------- wind ----------
const wind = { dirDeg: CONFIG.wind.defaultDirDeg, speed: CONFIG.wind.defaultStrength, x: 0, z: 0 };
let windLocked = false;
const practiceWind = { dirDeg: wind.dirDeg, speed: wind.speed };
function setWindLocked(locked) {
  windLocked = locked;
  $('wind').classList.toggle('locked', locked);
  for (const el of document.querySelectorAll('#windBody input, #windBody button')) el.disabled = locked;
  $('windNote').hidden = !locked;
}
// Real wind (from = meteorological degrees) relative to a real throw bearing.
function setRealWind(real, bearing) {
  wind.speed = Math.round(Math.min(CONFIG.wind.maxStrength, real.speed * CONFIG.journey.windScale) * 10) / 10;
  wind.dirDeg = Math.round(normDeg((real.fromDeg + 180) % 360 - bearing));
  applyWind();
}
function windName(dir, speed) {
  if (speed < 0.25) return 'Calm';
  const a = Math.abs(dir);
  let name;
  if (a <= 30) name = 'Tailwind';
  else if (a >= 150) name = 'Headwind';
  else if (a < 70) name = dir > 0 ? 'Tail, from left' : 'Tail, from right';
  else if (a > 110) name = dir > 0 ? 'Head, from left' : 'Head, from right';
  else name = dir > 0 ? 'From the left' : 'From the right';
  return `${name} ${speed % 1 ? speed.toFixed(1) : speed} m/s`;
}
function applyWind() {
  const r = (wind.dirDeg * Math.PI) / 180;
  wind.x = wind.speed * Math.sin(r);
  wind.z = -wind.speed * Math.cos(r);
  $('windWord').textContent = windLocked ? 'Real wind' : 'Wind';
  $('windLabel').textContent = windName(wind.dirDeg, wind.speed);
  $('windStrVal').textContent = wind.speed;
  $('windDir').value = wind.dirDeg;
  $('windStr').value = wind.speed;
}
$('windStr').max = CONFIG.wind.maxStrength;
$('windDir').addEventListener('input', (e) => { wind.dirDeg = +e.target.value; applyWind(); });
$('windStr').addEventListener('input', (e) => { wind.speed = +e.target.value; applyWind(); });
for (const el of [$('windDir'), $('windStr')]) el.addEventListener('change', () => el.blur());
for (const p of CONFIG.wind.presets) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = p.label;
  b.addEventListener('click', () => { wind.dirDeg = p.dirDeg; wind.speed = p.strength; applyWind(); b.blur(); });
  $('windPresets').appendChild(b);
}
$('windToggle').addEventListener('click', () => {
  const open = $('windToggle').getAttribute('aria-expanded') !== 'true';
  setWindOpen(open);
  $('windToggle').blur();
});
function setWindOpen(open) {
  $('windToggle').setAttribute('aria-expanded', String(open));
  $('windBody').hidden = !open;
}
applyWind();

// ---------- plane ----------
let foldKey = 'glider';
const plane = new Plane();
const planeObj = new THREE.Group();
const planeMeshes = {};
const shadowMeshes = {};
for (const k of FOLD_KEYS) {
  planeMeshes[k] = makePlaneMesh(k);
  planeObj.add(planeMeshes[k]);
  shadowMeshes[k] = makeShadowMesh(k);
  scene.add(shadowMeshes[k]);
}
scene.add(planeObj);

const launchPos = new THREE.Vector3(LAUNCH.x, groundHeight(LAUNCH.x, LAUNCH.z) + CONFIG.launch.heightAboveGround, LAUNCH.z);
plane.reset(foldKey, launchPos);

function showFold(k) {
  for (const key of FOLD_KEYS) {
    planeMeshes[key].visible = key === k;
    shadowMeshes[key].visible = key === k;
  }
}

// fold picker
const foldButtons = {};
for (const key of FOLD_KEYS) {
  const f = CONFIG.folds[key];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fold';
  b.setAttribute('role', 'radio');
  const bar = (label, v) => `<span>${label}</span><span class="bar"><i style="width:${Math.round(Math.min(1, v) * 100)}%"></i></span>`;
  b.innerHTML = `${foldIconSVG(key)}<b>${f.name}</b><span class="blurb">${f.blurb}</span>
    <span class="bars">${bar('Speed', f.bestSpeed / 18)}${bar('Float', f.glideRatio / 12)}${bar('Turn', f.maxBankDeg / 50)}</span>`;
  b.addEventListener('click', () => { selectFold(key); b.blur(); });
  $('folds').appendChild(b);
  foldButtons[key] = b;
}
function selectFold(k) {
  foldKey = k;
  for (const key of FOLD_KEYS) foldButtons[key].setAttribute('aria-checked', String(key === k));
  showFold(k);
  if (state === 'aim') plane.reset(k, launchPos);
}

// ---------- state ----------
let state = 'menu'; // menu | aim | flying | landed
let mode = 'practice'; // practice | daily
let daily = null;      // { baseBearing, bearing, realWind, day }
const flight = { time: 0, maxAgl: 0, climbTime: 0, trailTimer: 0, start: new THREE.Vector3(), dist: 0 };
const bests = {};

function throwPlane() {
  if (state === 'menu' || state === 'flying') return;
  if (state === 'landed' && mode === 'daily') return; // one counted flight a day
  state = 'flying';
  plane.reset(foldKey, launchPos);
  flight.time = 0; flight.maxAgl = 0; flight.climbTime = 0; flight.trailTimer = 0; flight.dist = 0;
  flight.start.copy(launchPos);
  trail.clear();
  trail.add(plane.pos, 0);
  climbLock = true;
  acc = 0;
  $('foldPanel').hidden = true;
  $('landPanel').hidden = true;
  $('touch').hidden = !isTouch;
  if (isTouch || window.innerWidth <= 640) setWindOpen(false);
}

function describeLanding(kind, x, z) {
  if (kind === 'water') return 'Splashdown at sea. In the full game it would drift ashore by tomorrow.';
  if (kind === 'roof') return 'Landed on a rooftop in town.';
  const zn = zoneAt(x, z);
  const h = groundHeight(x, z);
  if (zn && zn.kind === 'field') return 'Landed in a wheat field.';
  if (zn && zn.kind === 'town') return 'Landed in a town street.';
  if (h < 3.5) return 'Landed on the beach.';
  if (h > 115) return 'Landed high in the mountains.';
  if (h > 40) return 'Landed on a hillside.';
  return 'Landed in a meadow.';
}

const fmtM = (m) => `${Math.round(m).toLocaleString('en-US')} m`;
let kmScale = CONFIG.kmPerUnit; // km per game unit for the current flight
const fmtKm = (m) => Math.round(m * kmScale).toLocaleString('en-US');

function land(kind) {
  state = 'landed';
  orbit = Math.atan2(camPos.x - plane.pos.x, camPos.z - plane.pos.z);
  trail.add(plane.pos, 0);
  const d = flight.dist;
  const prev = bests[foldKey] || 0;
  const isBest = d > prev;
  if (isBest) bests[foldKey] = d;
  const isDaily = mode === 'daily';
  $('landWhere').textContent = describeLanding(kind, plane.pos.x, plane.pos.z);
  $('resKm').textContent = fmtKm(d);
  $('resToGo').hidden = true;
  if (isDaily) {
    const res = screens.onDailyLanding({ pathXZ: trail.points, bearing: daily.bearing, fold: foldKey, time: flight.time, gameKind: kind, scale: kmScale });
    $('landWhere').textContent = res.where;
    $('resKm').textContent = Math.round(res.leg.km).toLocaleString('en-US');
    $('resToGo').textContent = res.toGo;
    $('resToGo').hidden = false;
    window.__airmail.lastLeg = res.leg;
  }
  $('againBtn').hidden = isDaily;
  $('changeBtn').hidden = isDaily;
  $('mapBtn').hidden = !isDaily;
  $('shareBtn').hidden = !isDaily;
  $('landBackBtn').hidden = isDaily;
  $('resDist').textContent = fmtM(d);
  $('resTime').textContent = `${flight.time.toFixed(1)} s`;
  $('resHigh').textContent = fmtM(flight.maxAgl);
  $('resClimb').textContent = `${flight.climbTime.toFixed(1)} s`;
  $('resBestLabel').textContent = `Best ${CONFIG.folds[foldKey].name}`;
  $('resBest').textContent = `${fmtKm(bests[foldKey])} km`;
  $('resNew').hidden = !(isBest && prev > 0);
  $('landPanel').hidden = false;
  $('touch').hidden = true;
  $('stall').hidden = true;
  $('liftTag').hidden = true;
  window.__airmail.lastFlight = { kind, fold: foldKey, dist: d, km: d * kmScale, time: flight.time, maxAgl: flight.maxAgl, climbTime: flight.climbTime, wind: { ...wind } };
}

function toAim() {
  state = 'aim';
  document.body.classList.remove('in-menu');
  for (const id of ['setupPanel', 'journeyPanel', 'sharePanel']) $(id).hidden = true;
  plane.reset(foldKey, launchPos);
  trail.clear();
  $('landPanel').hidden = true;
  $('foldPanel').hidden = false;
  $('touch').hidden = true;
}
function enterMenu() {
  state = 'menu';
  document.body.classList.add('in-menu');
  plane.reset(foldKey, launchPos);
  trail.clear();
  for (const id of ['foldPanel', 'landPanel', 'touch', 'stall', 'liftTag']) $(id).hidden = true;
}

function updateAimLabel() {
  const off = +$('aim').value;
  daily.bearing = (daily.baseBearing + off + 360) % 360;
  const side = off === 0 ? 'straight at your friend' : `${Math.abs(off)}° ${off < 0 ? 'left' : 'right'} of your friend`;
  $('aimLabel').textContent = `${compass(daily.bearing)} (${Math.round(daily.bearing)}°) · ${side}`;
  setRealWind(daily.realWind, daily.bearing);
}
$('aim').min = -CONFIG.journey.aimRangeDeg;
$('aim').max = CONFIG.journey.aimRangeDeg;
$('aim').addEventListener('input', updateAimLabel);
$('aim').addEventListener('change', () => $('aim').blur());

function startFlight(opts) {
  if (mode === 'practice') { practiceWind.dirDeg = wind.dirDeg; practiceWind.speed = wind.speed; }
  mode = opts.mode;
  kmScale = opts.scale || CONFIG.kmPerUnit;
  if (mode === 'daily') {
    daily = { baseBearing: opts.bearing, bearing: opts.bearing, realWind: opts.realWind, day: opts.day };
    $('foldTitle').textContent = `Day ${opts.day} · today's flight`;
    $('foldSub').textContent = opts.finalStretch
      ? `This one counts, and it's the last stretch: even a short flight can reach ${opts.toName}. Aim straight at it. The wind is the real wind at your plane right now.`
      : `This one counts: a good flight carries your letter about ${Math.round(kmScale * CONFIG.journey.typicalFlightUnits).toLocaleString('en-US')} km today. The wind is the real wind at your plane right now.`;
    $('hintR').hidden = true;
    $('aimRow').hidden = false;
    $('aim').value = 0;
    setWindLocked(true);
    updateAimLabel();
  } else {
    daily = null;
    $('foldTitle').textContent = 'Practice flight';
    $('foldSub').textContent = "Practice as much as you like; it doesn't move your letter. Warm fields and windward hillsides lift you; rain clouds push you down.";
    $('aimRow').hidden = true;
    $('hintR').hidden = false;
    setWindLocked(false);
    wind.dirDeg = practiceWind.dirDeg;
    wind.speed = practiceWind.speed;
    applyWind();
  }
  $('backBtn').textContent = screens.hasJourney() ? 'Back to map' : 'Back';
  $('landBackBtn').textContent = $('backBtn').textContent;
  toAim();
}
const backToMenu = () => (screens.hasJourney() ? screens.showJourney() : screens.start());

$('throwBtn').addEventListener('click', (e) => { e.currentTarget.blur(); throwPlane(); });
$('backBtn').addEventListener('click', backToMenu);
$('landBackBtn').addEventListener('click', backToMenu);
$('mapBtn').addEventListener('click', () => screens.showJourney('leg'));
$('shareBtn').addEventListener('click', () => screens.openShare());
$('againBtn').addEventListener('click', (e) => { e.currentTarget.blur(); throwPlane(); });
$('changeBtn').addEventListener('click', (e) => { e.currentTarget.blur(); toAim(); setWindOpen(true); });

// ---------- input ----------
const input = { climb: false, dive: false, steer: 0 };
const keys = new Set();
const canvasPointers = new Set();
const touchState = { left: false, right: false, climb: false };
let climbLock = false;
let isTouch = window.matchMedia('(pointer: coarse)').matches;
function setTouch(v) {
  isTouch = v;
  document.body.classList.toggle('is-touch', v);
  if (state === 'flying') $('touch').hidden = !v;
}
setTouch(isTouch);
window.addEventListener('touchstart', () => { if (!isTouch) setTouch(true); }, { passive: true });

window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'range')) return; // typing
  if (e.target instanceof HTMLInputElement && e.code.startsWith('Arrow')) return;
  if (state === 'menu') return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (!e.repeat && state === 'landed' && mode === 'daily') { screens.showJourney('leg'); return; }
    if (!e.repeat && state !== 'flying') { throwPlane(); return; }
  }
  if (e.code === 'KeyR' && !e.repeat && mode === 'practice') { state = 'landed'; throwPlane(); return; }
  if (state === 'aim' && !e.repeat) {
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    if (i >= 0) selectFold(FOLD_KEYS[i]);
  }
  if (e.code.startsWith('Arrow')) e.preventDefault();
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); canvasPointers.clear(); touchState.left = touchState.right = touchState.climb = false; });

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'flying') return;
  canvasPointers.add(e.pointerId);
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
});
const dropPointer = (e) => canvasPointers.delete(e.pointerId);
canvas.addEventListener('pointerup', dropPointer);
canvas.addEventListener('pointercancel', dropPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function holdButton(el, prop) {
  const on = (e) => {
    e.preventDefault();
    touchState[prop] = true;
    el.classList.add('held');
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  };
  const off = () => { touchState[prop] = false; el.classList.remove('held'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('lostpointercapture', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdButton($('tLeft'), 'left');
holdButton($('tRight'), 'right');
holdButton($('tClimb'), 'climb');

function readInput() {
  let climb = keys.has('Space') || keys.has('KeyW') || keys.has('ArrowUp') || canvasPointers.size > 0 || touchState.climb;
  if (climbLock) {
    if (!climb) climbLock = false;
    climb = false;
  }
  input.climb = climb;
  input.dive = keys.has('KeyS') || keys.has('ArrowDown');
  const right = keys.has('KeyD') || keys.has('ArrowRight') || touchState.right;
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || touchState.left;
  input.steer = (right ? 1 : 0) - (left ? 1 : 0);
}

// ---------- camera ----------
const camPos = new THREE.Vector3(launchPos.x, launchPos.y + 8, launchPos.z + 18);
const camLook = new THREE.Vector3(launchPos.x, launchPos.y - 6, launchPos.z - 60);
const desired = new THREE.Vector3(), look = new THREE.Vector3();
let orbit = 0;

function updateCamera(dt) {
  const C = CONFIG.camera;
  const p = plane.pos;
  if (state === 'aim' || state === 'menu') {
    // looking down the valley, plane high in the frame so the fold card doesn't hide it
    desired.set(p.x + 2, p.y + 2, p.z + 8);
    look.set(p.x, p.y - (camera.aspect < 1 ? 34 : 20), p.z - 25);
  } else if (state === 'flying') {
    const fx = Math.sin(plane.heading), fz = -Math.cos(plane.heading);
    desired.set(p.x - fx * C.distance, p.y + C.height, p.z - fz * C.distance);
    look.set(p.x + fx * C.lookAhead, p.y - C.lookDown, p.z + fz * C.lookAhead);
  } else {
    orbit += dt * 0.25;
    desired.set(p.x + Math.sin(orbit) * 30, p.y + 14, p.z + Math.cos(orbit) * 30);
    look.copy(p);
  }
  const k = 1 - Math.exp(-C.smoothing * dt);
  camPos.lerp(desired, k);
  camLook.lerp(look, k);
  const floor = surfaceHeight(camPos.x, camPos.z) + 2;
  if (camPos.y < floor) camPos.y = floor;
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  scene.userData.sky.position.copy(camPos);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? CONFIG.camera.portraitFov : CONFIG.camera.fov;
  camera.updateProjectionMatrix();
  streaks.setResolution(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------- HUD ----------
const parts = { thermal: 0, ridge: 0, rain: 0 };
let varioSmooth = 0;
let hudTimer = 0;
const airAt = (x, y, z) => verticalAir(x, y, z, wind);

function updateHud(dt) {
  const p = plane.pos;
  const agl = p.y - surfaceHeight(p.x, p.z);
  varioSmooth += (plane.vel.y - varioSmooth) * Math.min(1, dt * 4);

  // wind arrow relative to where the camera is looking
  const viewHeading = state === 'flying' ? plane.heading : 0;
  const rel = (wind.dirDeg * Math.PI) / 180 - viewHeading;
  $('windArrow').style.transform = `rotate(${rel}rad)`;
  $('windArrow').style.opacity = wind.speed < 0.25 ? 0.25 : 1;

  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.08;

  const dist = state === 'aim' || state === 'menu' ? 0 : flight.dist;
  $('hudKm').textContent = fmtKm(dist);
  $('hudDist').textContent = fmtM(dist);
  $('hudTime').textContent = `${flight.time.toFixed(1)} s`;
  $('hudAlt').textContent = `${Math.max(0, Math.round(agl))} m`;
  $('hudSpd').textContent = state === 'landed' ? '0' : `${Math.round(Math.hypot(plane.vel.x, plane.vel.z))}`;

  const v = state === 'flying' ? varioSmooth : 0;
  const frac = Math.max(-1, Math.min(1, v / 5));
  const fill = $('varioFill');
  fill.style.height = `${Math.abs(frac) * 50}%`;
  fill.style.top = frac >= 0 ? `${50 - frac * 50}%` : '50%';
  fill.style.background = frac >= 0 ? 'var(--warm)' : 'var(--cool)';
  $('varioVal').textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

  $('stall').hidden = !(state === 'flying' && plane.stalled);

  const tag = $('liftTag');
  if (state === 'flying') {
    verticalAir(p.x, p.y, p.z, wind, parts);
    let label = '', cls = '';
    const best = [['Thermal', parts.thermal], ['Ridge lift', parts.ridge], ['Rain sink', parts.rain]]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    if (Math.abs(best[1]) > 0.5) {
      let name = best[0];
      if (name === 'Ridge lift' && best[1] < 0) name = 'Sink behind the hill';
      if (name === 'Thermal' && best[1] < 0) name = 'Sink beside the thermal';
      label = `${name} ${best[1] > 0 ? '+' : '−'}${Math.abs(best[1]).toFixed(1)}`;
      cls = best[1] > 0 ? 'up' : 'down';
    }
    tag.hidden = !label;
    tag.textContent = label;
    tag.className = `lift-tag ${cls}`;
  } else tag.hidden = true;
}

// ---------- loop ----------
let last = performance.now();
let acc = 0;
let t = 0;
const shadowTmp = new THREE.Vector3();

function simulate(dt) {
  acc += dt;
  while (acc >= STEP && state === 'flying') {
    acc -= STEP;
    plane.step(STEP, input, wind, airAt);
    flight.time += STEP;
    const p = plane.pos;
    flight.dist = Math.hypot(p.x - flight.start.x, p.z - flight.start.z);
    const ground = groundHeight(p.x, p.z);
    const surf = Math.max(SEA_LEVEL, ground);
    flight.maxAgl = Math.max(flight.maxAgl, p.y - surf);
    if (plane.vel.y > 0) flight.climbTime += STEP;
    flight.trailTimer -= STEP;
    if (flight.trailTimer <= 0) { flight.trailTimer = 0.2; trail.add(p, plane.vel.y); }
    if (ground < SEA_LEVEL && p.y <= SEA_LEVEL + 0.2) { p.y = SEA_LEVEL + 0.2; land('water'); }
    else if (ground >= SEA_LEVEL && p.y <= ground + 0.3) { p.y = ground + 0.3; land('ground'); }
    else if (buildingHit(p.x, p.y, p.z)) land('roof');
  }
  if (state !== 'flying') acc = 0;
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  readInput();
  if (state === 'flying') simulate(dt);
  else if (state === 'aim' || state === 'menu') {
    plane.pos.copy(launchPos);
    plane.pos.y += Math.sin(t * 2) * 0.15;
  }

  plane.applyTo(planeObj, t);
  if (state === 'landed') planeObj.rotation.x = 0;
  const sh = shadowMeshes[foldKey];
  const g = surfaceHeight(plane.pos.x, plane.pos.z);
  sh.position.set(plane.pos.x, g + 0.4, plane.pos.z);
  sh.rotation.y = -plane.heading;
  sh.material.opacity = 0.28 * Math.max(0, 1 - (plane.pos.y - g) / 120);

  trail.line.visible = state === 'landed';
  world.update(dt, t, wind);
  shadowTmp.copy(plane.pos);
  streaks.update(dt, shadowTmp, wind);
  updateCamera(dt);
  updateHud(dt);
  minimap.draw(plane.pos, trail.points, wind, plane.heading);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

const screens = initScreens({ enterMenu, startFlight });
selectFold(foldKey);
if (window.innerWidth <= 640) setWindOpen(false);
enterMenu();
screens.start();

// Small hook for playtesting from the console.
// advance(sec) fast-forwards the current flight with the current input.
window.__airmail = {
  CONFIG, plane, wind, applyWind, throwPlane, selectFold, flight, screens,
  get state() { return state; },
  get mode() { return mode; },
  advance(sec) { readInput(); for (let i = 0; i < sec / STEP && state === 'flying'; i++) simulate(STEP); return state; },
  lastFlight: null,
  lastLeg: null
};

requestAnimationFrame(frame);
