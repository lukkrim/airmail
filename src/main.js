import * as THREE from 'three';
import { CONFIG } from './core/config.js';
import {
  groundHeight, surfaceHeight, verticalAir, buildingHit, zoneAt, coverAt, COVER,
  LAUNCH, SEA_LEVEL, groundInfo, realGround, setGround
} from './environment/world.js';
import { buildWorld } from './environment/worldView.js';
import { loadRealGround, groundFromURL } from './environment/course.js';
import { fetchSkies } from './environment/weather.js';
import { gameToLatLon } from './environment/geo.js';
import { Plane, makePlaneMesh, makeShadowMesh, foldIconSVG, foldPose, FOLD_KEYS } from './flight/plane.js';
import { WindStreaks, Trail } from './flight/effects.js';
import { Minimap } from './flight/minimap.js';
import { initScreens } from './ui/screens.js';
import { compass, normDeg } from './environment/geo.js';
import { stampSVG, postmarkSVG, postmarkDate } from './ui/theme.js';
import { stampInfo } from './ui/stampArt.js';
import { initGuide } from './ui/guide.js';
import { Sky } from './environment/sky.js';
import { loadModelKit } from './environment/models.js';
import { initAudio, sfx, flightAudio, audioInfo } from './audio/sound.js';
import { buzz } from './core/haptics.js';
import { settings, onSettings, reducedMotion } from './core/settings.js';
import { num, dist, unit } from './core/units.js';
import { sunPosition, guessHome } from './environment/sun.js';

const $ = (id) => document.getElementById(id);
const STEP = 1 / 120;

// ---------- renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 1, 30000);

const world = buildWorld(scene);
const sky = new Sky(scene);
const pmrem = new THREE.PMREMGenerator(renderer);
let envTarget = null;
// the detailed Blender models (the shop-house beside the throw spot)
let modelKit = null;
loadModelKit().then((kit) => {
  if (!kit) return;
  modelKit = kit;
  kit.place(scene);
});
const streaks = new WindStreaks(scene);
const trail = new Trail(scene);
const minimap = new Minimap($('minimap'));

// ---------- wind ----------
const wind = { dirDeg: CONFIG.wind.defaultDirDeg, speed: CONFIG.wind.defaultStrength, x: 0, z: 0 };
let windLocked = false;
const practiceWind = { dirDeg: wind.dirDeg, speed: wind.speed };
function setWindLocked(locked) {
  windLocked = locked;
  if (locked) setWindOpen(false);
  $('wind').classList.toggle('locked', locked);
  for (const el of document.querySelectorAll('#windBody input, #windBody button')) el.disabled = locked;
  $('windNote').hidden = !locked;
}
// Real wind (from = meteorological degrees) relative to a real throw bearing.
let windSource = 'open-meteo';
let guide = null; // the first-time flying lesson (set up once the screens exist)
function windLine(w) {
  if (w && w.source === 'stand-in') return "The weather services aren't answering, so the wind is a light stand-in today.";
  if (w && w.source === 'saved') return 'The wind is the last real reading saved near your plane.';
  return 'The wind is the real wind at your plane right now.';
}
function setRealWind(real, bearing) {
  windSource = real.source || 'open-meteo';
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
  $('windWord').textContent = !windLocked ? 'Wind' : windSource === 'stand-in' ? 'Stand-in wind' : 'Real wind';
  $('windNote').textContent = windSource === 'stand-in'
    ? "The weather services aren't answering, so today's flight uses a light stand-in wind. Aim the throw to change how it hits you."
    : windSource === 'saved'
      ? 'Today\'s flight uses the last real wind saved near your plane. Aim the throw to change how it hits you.'
      : "Today's flight uses the real wind. Aim the throw to change how it hits you.";
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
  if (windLocked) return; // real wind can't be changed, so there's nothing to open
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

// the plane and its fake shadow catch the sun too
scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !world.root.getObjectById(o.id) && o !== world.root) { o.castShadow = true; o.receiveShadow = true; } });
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
  b.innerHTML = `${foldIconSVG(key)}<span>${f.name}</span>`;
  b.title = f.blurb;
  b.addEventListener('click', () => { selectFold(key); b.blur(); });
  $('folds').appendChild(b);
  foldButtons[key] = b;
}
function selectFold(k) {
  const changed = k !== foldKey;
  foldKey = k;
  for (const key of FOLD_KEYS) foldButtons[key].setAttribute('aria-checked', String(key === k));
  $('foldBlurb').textContent = CONFIG.folds[k].blurb;
  showFold(k);
  if (state === 'aim') {
    plane.reset(k, launchPos);
    if (changed) startFold();
  }
}

// Folding animation: the sheet creases into the chosen plane before a throw.
let foldT = 1;
function startFold() {
  if (reducedMotion()) { foldPose(planeMeshes[foldKey], 1); foldT = 1; return; }
  foldT = 0;
  foldPose(planeMeshes[foldKey], 0);
  sfx.paper();
}
function finishFold() {
  foldT = 1;
  for (const k of FOLD_KEYS) foldPose(planeMeshes[k], 1);
}

// ---------- state ----------
let state = 'menu'; // menu | aim | flying | landed
let mode = 'practice'; // practice | daily
let daily = null;      // { baseBearing, bearing, realWind, day }
const flight = { time: 0, maxAgl: 0, climbTime: 0, trailTimer: 0, start: new THREE.Vector3(), dist: 0 };
const bests = {};

function throwPlane() {
  if (state === 'menu' || state === 'flying' || courseBusy) return;
  if (state === 'landed' && mode === 'daily') return; // one counted flight a day
  state = 'flying';
  finishFold();
  if (guide) guide.onThrow();
  sfx.whoosh();
  buzz('throw');
  plane.reset(foldKey, launchPos);
  flight.time = 0; flight.maxAgl = 0; flight.climbTime = 0; flight.trailTimer = 0; flight.dist = 0;
  flight.start.copy(launchPos);
  trail.clear();
  trail.add(plane.pos, 0);
  climbLock = true;
  acc = 0;
  slideAway($('foldPanel'));
  slideAway($('landPanel'));
  $('touch').hidden = !isTouch;
  setWindOpen(false);
}

// Bottom cards slide back down when they leave; showing one cancels that.
function slideAway(el) {
  if (el.hidden) return;
  clearTimeout(el._leave);
  if (reducedMotion()) { el.hidden = true; return; }
  el.classList.add('leaving');
  el._leave = setTimeout(() => { el.hidden = true; el.classList.remove('leaving'); }, 180);
}
function showCard(el) {
  clearTimeout(el._leave);
  el.classList.remove('leaving');
  el.hidden = false;
}

const COVER_WORDS = {
  [COVER.WOOD]: 'in a forest', [COVER.FARM]: 'in farmland', [COVER.URBAN]: 'in town', [COVER.ROAD]: 'beside a road',
  [COVER.WATER]: 'in a lake', [COVER.SAND]: 'on the sand', [COVER.ROCK]: 'on bare rock', [COVER.ICE]: 'on a glacier',
  [COVER.WETLAND]: 'in a marsh', [COVER.GRASS]: 'in a meadow'
};
function describeLanding(kind, x, z) {
  const g = realGround();
  const near = g ? g.placeNear(x, z) : null;
  const by = near && near.dist * g.info.metresPerUnit < 40000 ? ` near ${near.name}` : '';
  if (kind === 'water') return g ? `Splashdown at sea${by}.` : 'Splashdown at sea. In the full game it would drift ashore by tomorrow.';
  if (kind === 'roof') return `Landed on a rooftop in town${by}.`;
  const zn = zoneAt(x, z);
  const h = groundHeight(x, z);
  if (zn && zn.kind === 'field') return `Landed in a wheat field${by}.`;
  if (zn && zn.kind === 'town') return `Landed in a town street${by}.`;
  if (g) {
    const c = coverAt(x, z);
    const m = g.metres(x, z);
    if (COVER_WORDS[c]) return `Landed ${COVER_WORDS[c]}${by}.`;
    if (m > 1800) return `Landed high in the mountains${by}.`;
    if (h < 2.5) return `Landed on the shore${by}.`;
    return `Landed in open country${by}.`;
  }
  if (h < 3.5) return 'Landed on the beach.';
  if (h > 115) return 'Landed high in the mountains.';
  if (h > 40) return 'Landed on a hillside.';
  if (coverAt(x, z) === COVER.WOOD) return 'Landed in the woods.';
  return 'Landed in a meadow.';
}

const fmtM = (m) => `${Math.round(m).toLocaleString('en-US')} m`;
let kmScale = CONFIG.kmPerUnit; // km per game unit for the current flight
const fmtKm = (m) => num(m * kmScale);

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
    const res = screens.onDailyLanding({ pathXZ: trail.points, bearing: daily.bearing, fold: foldKey, time: flight.time, gameKind: kind, scale: kmScale, here: realGround() ? describeLanding(kind, plane.pos.x, plane.pos.z) : null });
    $('landWhere').textContent = res.where;
    $('resKm').textContent = num(res.leg.km);
    $('resToGo').textContent = res.toGo;
    $('resToGo').hidden = false;
    window.__airmail.lastLeg = res.leg;
    landStamp = res.stamp;
  }
  fillPostcard(isDaily, window.__airmail.lastLeg && isDaily ? window.__airmail.lastLeg : null, isDaily ? landStamp : null);
  if (guide) guide.onLand({ km: d * kmScale, hasJourney: screens.hasJourney() });
  $('againBtn').hidden = isDaily;
  $('changeBtn').hidden = isDaily;
  $('mapBtn').hidden = !isDaily;
  $('shareBtn').hidden = !isDaily;
  $('landBackBtn').hidden = isDaily;
  $('resDist').textContent = fmtM(d);
  $('resTime').textContent = `${Math.round(flight.time)} s`;
  $('resHigh').textContent = fmtM(flight.maxAgl);
  $('resClimb').textContent = `${Math.round(flight.climbTime)} s`;
  $('resBestLabel').textContent = `Best ${CONFIG.folds[foldKey].name} ·`;
  $('resBest').textContent = dist(bests[foldKey] * kmScale);
  landingSound(kind, isDaily && window.__airmail.lastLeg ? window.__airmail.lastLeg.outcome : null);
  $('resNew').hidden = !(isBest && prev > 0);
  showCard($('landPanel'));
  $('touch').hidden = true;
  $('stall').hidden = true;
  $('liftTag').hidden = true;
  window.__airmail.lastFlight = { kind, fold: foldKey, dist: d, km: d * kmScale, time: flight.time, maxAgl: flight.maxAgl, climbTime: flight.climbTime, wind: { ...wind } };
}

// The landing card is a postcard: stamp of the fold, a dated postmark, the address.
let landStamp = null;
function fillPostcard(isDaily, leg, stamp) {
  const f = CONFIG.folds[foldKey];
  const delivered = leg && leg.outcome === 'delivered';
  const j = isDaily ? screens.journey : null;
  $('landEyebrow').textContent = delivered ? `Day ${leg.day} · delivered` : isDaily ? `Day ${daily.day} · postcard` : 'Practice flight';
  $('landMarks').innerHTML =
    postmarkSVG({
      top: delivered ? 'DELIVERED' : isDaily ? 'AIRMAIL' : 'PRACTICE',
      bottom: isDaily ? `DAY ${daily.day}` : f.name.toUpperCase(),
      lines: postmarkDate(),
      waves: false
    }) +
    (stamp ? stampInfo(stamp.id).svg()
      : stampSVG({ art: `<g class="fold-art">${foldIconSVG(foldKey)}</g>`, label: f.name.toUpperCase(), tone: isDaily ? 'red' : 'blue' }));
  $('landMarks').firstElementChild.classList.toggle('red', !!delivered);
  // a new stamp drops onto the postcard
  $('landMarks').classList.toggle('new', !!(stamp && stamp.isNew));
  $('resStamp').hidden = !(stamp && stamp.isNew);
  if (stamp && stamp.isNew) $('resStamp').textContent = `New stamp: ${stampInfo(stamp.id).name}`;
  const lines = j
    ? [`To ${j.toName || 'my friend'},`, j.to.name]
    : ['Practice flight,', 'no letter aboard'];
  $('landAddress').replaceChildren(...lines.map((t) => Object.assign(document.createElement('span'), { textContent: t })));
}

function landingSound(kind, outcome) {
  if (kind === 'water') { sfx.splash(); buzz('splash'); } else { sfx.thud(); buzz('land'); }
  setTimeout(() => (outcome === 'delivered' ? (sfx.delivered(), buzz('delivered')) : sfx.stamp()), 450);
}

function toAim() {
  state = 'aim';
  document.body.classList.remove('in-menu');
  // every menu panel (sheets and the desk) leaves when a flight starts
  for (const el of document.querySelectorAll('#ui .sheet, #deskPanel')) el.hidden = true;
  document.body.classList.remove('at-desk');
  plane.reset(foldKey, launchPos);
  trail.clear();
  slideAway($('landPanel'));
  showCard($('foldPanel'));
  $('touch').hidden = true;
  updateSky();
  startFold();
  if (guide) { guide.hideEnd(); guide.maybeStart(mode); }
}
function enterMenu() {
  state = 'menu';
  document.body.classList.add('in-menu');
  plane.reset(foldKey, launchPos);
  trail.clear();
  for (const id of ['foldPanel', 'landPanel', 'touch', 'stall', 'liftTag']) { clearTimeout($(id)._leave); $(id).classList.remove('leaving'); $(id).hidden = true; }
  if (guide) { guide.leave(); guide.hideEnd(); }
  finishFold(); // never leave a half-folded plane behind the menus
  updateSky();
}

// ---------- time of day ----------
// The sky follows the real sun: where the plane is for today's flight, at home
// otherwise. The menus follow the player's own clock at home. Looks only.
let clockOverride = null; // for testing: __airmail.setClock('2026-11-19T22:00')
const now = () => (clockOverride ? new Date(clockOverride) : new Date());
function homePlace() {
  let j = null;
  try { j = screens.journey; } catch { /* screens not set up yet */ }
  return j ? j.from : guessHome();
}
function updateSky() {
  const today = state !== 'menu' && mode === 'daily' && daily && daily.pos;
  const forced = settings.time === 'auto' ? null : settings.time;
  const real = groundInfo(); // a real-land test course: the sun over that place
  sky.set(now(), today ? daily.pos : real || homePlace(), today ? daily.bearing : real ? real.bearing : 0, forced);
  world.setLight(sky.day, sky.glow);
  // the sea and lakes reflect this sky
  const prev = envTarget;
  envTarget = pmrem.fromScene(sky.envScene, 0.02, 1, 5000);
  world.setEnvironment(envTarget.texture);
  if (prev) prev.dispose();
  const home = homePlace();
  const alt = sunPosition(now(), home.lat, home.lon).altitude;
  const time = forced || (alt < -6 ? 'night' : alt < 5 ? 'dusk' : 'day');
  if (document.documentElement.dataset.time !== time) {
    document.documentElement.dataset.time = time;
    document.querySelector('meta[name="theme-color"]').content = time === 'night' ? '#1c2236' : '#f6efdf';
  }
}
let skyTimer = 0;

function updateAimLabel() {
  const off = +$('aim').value;
  daily.bearing = (daily.baseBearing + off + 360) % 360;
  const side = off === 0 ? 'straight at your friend' : `${Math.abs(off)}° ${off < 0 ? 'left' : 'right'} of your friend`;
  $('aimLabel').textContent = `${compass(daily.bearing)} (${Math.round(daily.bearing)}°) · ${side}`;
  setRealWind(daily.realWind, daily.bearing);
  updateSky();
  // the land ahead turns with the aim: redraw it once the slider settles
  if (state === 'aim' && courseKey !== courseKeyOf(dailyCourse(daily))) {
    setCourseBusy(true, 'Turning the map…');
    clearTimeout(aimTimer);
    aimTimer = setTimeout(() => useCourse(dailyCourse(daily)), 450);
  }
}
$('aim').min = -CONFIG.journey.aimRangeDeg;
$('aim').max = CONFIG.journey.aimRangeDeg;
$('aim').addEventListener('input', updateAimLabel);
$('aim').addEventListener('change', () => $('aim').blur());

// ---------- the course under the plane ----------
// Practice flies over the practice valley (or the ?ground= test land). A
// daily flight flies over the real land under today's route, laid out along
// the aim and squeezed by the journey's pace, so the land under the plane is
// the land the letter really crosses.
const devGround = realGround() ? groundFromURL(location.search) : null; // loaded by boot.js
let courseKey = devGround ? 'dev' : 'valley';
let courseJob = 0;
let courseBusy = false;
let courseNote = '';
let aimTimer = 0;

function setCourseBusy(on, text = 'Unfolding the map of the land below…') {
  courseBusy = on;
  $('throwBtn').disabled = on;
  $('courseNote').hidden = !on;
  $('courseNote').textContent = text;
}

function applyCourse(ground, skies, key) {
  setGround(ground, skies);
  world.rebuild();
  sky.useWindowsFor(() => true);
  minimap.refresh();
  launchPos.set(LAUNCH.x, groundHeight(LAUNCH.x, LAUNCH.z) + CONFIG.launch.heightAboveGround, LAUNCH.z);
  plane.reset(foldKey, launchPos);
  if (modelKit) modelKit.place(scene);
  courseKey = key;
  updateSky();
}

const dailyCourse = (d) => ({ lat: d.pos.lat, lon: d.pos.lon, bearing: d.bearing, metresPerUnit: kmScale * 1000 });
const courseKeyOf = (o) => `${o.lat.toFixed(4)},${o.lon.toFixed(4)},${Math.round(o.bearing)},${o.metresPerUnit.toFixed(1)}`;

// clouds and rain along the course, from today's weather
function skiesFor(o) {
  const pts = [];
  for (let z = 0; z >= -3500; z -= 700) pts.push({ ...gameToLatLon({ lat: o.lat, lon: o.lon }, o.bearing, 0, z, o.metresPerUnit / 1000), z });
  return fetchSkies(pts);
}

/** Switches the course: target null = practice; else real-land options. */
async function useCourse(target) {
  const job = ++courseJob;
  if (!target && devGround) target = { metresPerUnit: 8, ...devGround };
  const key = !target ? 'valley' : devGround && target.name === devGround.name ? 'dev' : courseKeyOf(target);
  if (key === courseKey) { setCourseBusy(false); return true; }
  if (!target) { applyCourse(null, null, 'valley'); setCourseBusy(false); return true; }
  setCourseBusy(true);
  try {
    const [g, skies] = await Promise.all([loadRealGround(target), key === 'dev' ? null : skiesFor(target)]);
    if (job !== courseJob) return false;
    courseNote = '';
    applyCourse(g, skies, key);
    setCourseBusy(false);
    refreshFoldSub();
    return true;
  } catch (err) {
    if (job !== courseJob) return false;
    console.warn('Real land not loaded; flying over the practice valley.', err);
    courseNote = "The map of the land below didn't load, so this flight is over the practice valley.";
    if (courseKey !== 'valley') applyCourse(null, null, 'valley');
    setCourseBusy(false);
    refreshFoldSub();
    return false;
  }
}

// Warms the cache for today's course while the player reads the journey page.
function prepareCourse({ pos, bearing, scale }) {
  loadRealGround({ lat: pos.lat, lon: pos.lon, bearing, metresPerUnit: scale * 1000 }).catch(() => {});
}

function refreshFoldSub() {
  if (mode !== 'daily' || !daily) return;
  const g = realGround();
  const p = g && g.placeNear(LAUNCH.x, LAUNCH.z - 400);
  const over = courseNote || (p ? `over the land near ${p.name}` : '');
  $('foldSub').textContent = daily.sub + (over ? ` · ${over}` : '');
}

function startFlight(opts) {
  if (mode === 'practice') { practiceWind.dirDeg = wind.dirDeg; practiceWind.speed = wind.speed; }
  mode = opts.mode;
  kmScale = opts.scale || CONFIG.kmPerUnit;
  if (mode === 'daily') {
    daily = { baseBearing: opts.bearing, bearing: opts.bearing, realWind: opts.realWind, day: opts.day, pos: opts.pos };
    $('foldTitle').textContent = `Day ${opts.day} · today's flight`;
    const src = opts.realWind && opts.realWind.source;
    daily.sub = `This one counts · a typical flight goes about ${dist(opts.typicalKm)}${opts.boost > 1 ? ` (catch-up ${opts.boost.toFixed(1)}×)` : ''}` +
      (src === 'stand-in' ? ' · stand-in wind today' : src === 'saved' ? ' · last saved wind' : '');
    $('foldSub').textContent = daily.sub;
    $('hintR').hidden = true;
    $('aimRow').hidden = false;
    $('aim').value = 0;
    setWindLocked(true);
    updateAimLabel();
    clearTimeout(aimTimer);
    useCourse(dailyCourse(daily));
  } else {
    daily = null;
    $('foldTitle').textContent = 'Practice flight';
    $('foldSub').textContent = '';
    $('aimRow').hidden = true;
    $('hintR').hidden = false;
    setWindLocked(false);
    wind.dirDeg = practiceWind.dirDeg;
    wind.speed = practiceWind.speed;
    applyWind();
    useCourse(null);
  }
  $('backBtn').textContent = mode === 'daily' ? 'Back to map' : screens.backLabel();
  $('landBackBtn').textContent = $('backBtn').textContent;
  toAim();
}
const backToMenu = () => (mode === 'daily' ? screens.showJourney() : screens.back());

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

let photo = null; // console-only: __airmail.photo([x,y,z], [tx,ty,tz]) parks the camera
function updateCamera(dt) {
  const C = CONFIG.camera;
  if (photo) {
    camera.position.set(...photo.from);
    camera.lookAt(...photo.at);
    sky.follow(camera.position, new THREE.Vector3(...photo.at));
    return;
  }
  const p = plane.pos;
  if (state === 'aim' || state === 'menu') {
    // looking down the valley, plane high in the frame so the fold card doesn't hide it
    const portrait = camera.aspect < 1;
    desired.set(p.x + 3, p.y + (portrait ? 4.5 : 3.6), p.z + (portrait ? 17 : 14));
    look.set(p.x, p.y - (portrait ? 13 : 7), p.z - 34);
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
  sky.follow(camPos, plane.pos);
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
  flightAudio(Math.hypot(plane.vel.x, plane.vel.y, plane.vel.z), varioSmooth, state === 'flying');
  if (foldT < 1) { foldT = Math.min(1, foldT + dt / 0.9); foldPose(planeMeshes[foldKey], foldT); }
  if (guide && state === 'flying') guide.update(dt, { climb: input.climb, plane, wind, inThermal: parts.thermal > 0.5 });

  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.08;

  const dist = state === 'aim' || state === 'menu' ? 0 : flight.dist;
  $('hudKm').textContent = fmtKm(dist);
  $('hudDist').textContent = fmtM(dist);
  $('hudTime').textContent = `${(state === 'aim' || state === 'menu' ? 0 : flight.time).toFixed(1)} s`;
  $('hudAlt').textContent = `${Math.max(0, Math.round(agl))} m`;
  $('hudSpd').textContent = state === 'landed' ? '0' : `${Math.round(Math.hypot(plane.vel.x, plane.vel.z))}`;

  const v = state === 'flying' ? varioSmooth : 0;
  const frac = Math.max(-1, Math.min(1, v / 5));
  const fill = $('varioFill');
  fill.style.height = `${Math.abs(frac) * 50}%`;
  fill.style.top = frac >= 0 ? `${50 - frac * 50}%` : '50%';
  fill.style.background = frac >= 0 ? 'var(--warm)' : 'var(--cool)';
  $('varioVal').textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

  const stalling = state === 'flying' && plane.stalled;
  if (stalling && $('stall').hidden) buzz('stall');
  $('stall').hidden = !stalling;

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
    if (cls === 'up' && !tag.classList.contains('up')) buzz('lift');
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
  world.update(dt, t, wind, camera.position);
  skyTimer -= dt;
  if (skyTimer <= 0) { skyTimer = 30; updateSky(); }
  shadowTmp.copy(plane.pos);
  streaks.update(dt, shadowTmp, wind);
  updateCamera(dt);
  updateHud(dt);
  minimap.draw(plane.pos, trail.points, wind, plane.heading);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

const screens = initScreens({ enterMenu, startFlight, prepareCourse });
selectFold(foldKey);
setWindOpen(false);
guide = initGuide({
  onFinish(next) {
    if (next === 'write') (screens.hasJourney() ? screens.showJourney() : screens.showSetup());
    else toAim();
  }
});
$('setLesson').addEventListener('click', () => { guide.restart(); startFlight({ mode: 'practice' }); });
initAudio();
function applyUnits() {
  for (const el of document.querySelectorAll('.unit')) el.textContent = unit();
  hudTimer = 0;
}
applyUnits();
onSettings((k) => {
  if (k === 'units') applyUnits();
  if (k === 'time') updateSky();
});
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
  lastLeg: null,
  sky,
  scene,
  camera,
  renderer,
  world,
  audioInfo,
  get ground() { return groundInfo(); },
  useCourse,
  realGround,
  photo(from, at) { photo = from ? { from, at } : null; },
  setClock(v) { clockOverride = v ? new Date(v).getTime() : null; updateSky(); return now().toString(); }
};

requestAnimationFrame(frame);
