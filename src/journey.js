// The letter's journey: saved in this browser only (localStorage).
import { CONFIG } from './config.js';
import { destination, distanceKm, gameToLatLon } from './geo.js';
import { isLand, countryAt } from './land.js';

const KEY = 'airmail.journey.v1';

export function loadJourney() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveJourney(j) {
  try {
    localStorage.setItem(KEY, JSON.stringify(j));
    return true;
  } catch {
    return false;
  }
}

export function clearJourney() {
  try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export function newJourney(from, to, letter, names = {}) {
  const J = CONFIG.journey;
  return {
    kmPerUnit: Math.max(J.minKmPerUnit, distanceKm(from, to) / (J.averageDays * J.typicalFlightUnits)),
    v: 1,
    createdAt: new Date().toISOString(),
    from: { name: from.name, region: from.region, lat: from.lat, lon: from.lon },
    to: { name: to.name, region: to.region, lat: to.lat, lon: to.lon },
    letter: letter.trim(),
    fromName: (names.fromName || '').trim().slice(0, 30),
    toName: (names.toName || '').trim().slice(0, 30),
    pos: { lat: from.lat, lon: from.lon, afloat: false },
    legs: [],
    delivered: false
  };
}

// Local calendar day, so "one flight a day" follows the player's clock.
export function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const flownToday = (j) => j.legs.some((l) => l.date === todayKey());
export const kmToGo = (j) => distanceKm(j.pos, j.to);
export const totalKm = (j) => j.legs.reduce((s, l) => s + l.km + (l.driftKm || 0), 0);

// The journey's fixed pace (km per game unit), set from the whole route.
export function basePace(j) {
  const J = CONFIG.journey;
  if (j.kmPerUnit) return j.kmPerUnit;
  return Math.max(J.minKmPerUnit, distanceKm(j.from, j.to) / (J.averageDays * J.typicalFlightUnits));
}

// Safety net for struggling players: from catchUpFromDay each flight counts more.
export function catchUpBoost(j) {
  const J = CONFIG.journey;
  const day = j.legs.length + 1;
  return day >= J.catchUpFromDay ? J.catchUpGrowth ** (day - J.catchUpFromDay + 1) : 1;
}

// km per game unit for today's flight.
export const flightScale = (j) => basePace(j) * catchUpBoost(j);

// km a typical flight covers at the journey's pace (without the safety net).
export const typicalKm = (j) => basePace(j) * CONFIG.journey.typicalFlightUnits;

// Days left if every flight from now on is typical.
export const typicalDaysLeft = (j) => Math.max(1, Math.ceil((kmToGo(j) - deliverRadiusKm(basePace(j))) / typicalKm(j)));

export const deliverRadiusKm = (scale) =>
  Math.max(CONFIG.journey.deliverRadiusKm, scale * CONFIG.journey.deliverRadiusUnits);

export function msUntilTomorrow(now = new Date()) {
  const t = new Date(now);
  t.setHours(24, 0, 0, 0);
  return t - now;
}

/**
 * Turn a finished in-game flight into a leg on the real map.
 * pathXZ: [[x, z], ...] game positions; bearing: real compass bearing of the throw.
 */
export function computeLeg(j, { pathXZ, bearing, realWind, fold, time, gameKind, scale = flightScale(j) }) {
  const J = CONFIG.journey;
  const radius = deliverRadiusKm(scale);
  const start = { lat: j.pos.lat, lon: j.pos.lon };
  const step = Math.max(1, Math.ceil(pathXZ.length / 120));
  const path = [];
  for (let i = 0; i < pathXZ.length; i += step) path.push(gameToLatLon(start, bearing, pathXZ[i][0], pathXZ[i][1], scale));
  const lastXZ = pathXZ[pathXZ.length - 1];
  const landing = gameToLatLon(start, bearing, lastXZ[0], lastXZ[1], scale);
  path.push(landing);

  // Did the plane pass over the destination? Then the flight ends there.
  let landingPt = landing;
  const hit = path.findIndex((p) => distanceKm(p, j.to) <= radius);
  let delivered = hit >= 0;
  if (delivered) {
    path.length = hit + 1;
    path.push({ lat: j.to.lat, lon: j.to.lon });
    landingPt = { lat: j.to.lat, lon: j.to.lon };
  }

  // Landed at sea: drift downwind and wash ashore if land is close enough.
  let end = landingPt, outcome = 'land', driftKm = 0;
  if (!delivered && !isLand(landing)) {
    const toward = (realWind.fromDeg + 180) % 360;
    outcome = 'afloat';
    const paceFactor = scale / CONFIG.kmPerUnit;
    const maxDrift = Math.min(J.driftKm, Math.max(5, realWind.speed * J.driftKmPerMs)) * paceFactor;
    const driftStep = Math.max(5, maxDrift / 10);
    for (let k = driftStep; k <= maxDrift + 1e-6; k += driftStep) {
      const p = destination(landing, toward, k);
      driftKm = Math.round(k);
      end = p;
      if (distanceKm(p, j.to) <= radius) { delivered = true; break; }
      if (isLand(p)) { outcome = 'ashore'; break; }
    }
  }
  if (delivered) {
    outcome = 'delivered';
    end = { lat: j.to.lat, lon: j.to.lon };
  }

  return {
    day: j.legs.length + 1,
    date: todayKey(),
    start,
    landing: { lat: landingPt.lat, lon: landingPt.lon },
    end: { lat: end.lat, lon: end.lon },
    path: path.map((p) => [+p.lat.toFixed(4), +p.lon.toFixed(4)]),
    km: distanceKm(start, landingPt),
    driftKm,
    outcome,
    gameKind,
    country: countryAt(end),
    fold,
    bearing,
    kmPerUnit: scale,
    rating: distanceKm(start, landingPt) / (scale * CONFIG.journey.typicalFlightUnits), // skill only, boost removed
    wind: { speed: realWind.speed, fromDeg: realWind.fromDeg },
    time,
    toGoKm: distanceKm(end, j.to)
  };
}

export function applyLeg(j, leg) {
  j.legs.push(leg);
  j.pos = { lat: leg.end.lat, lon: leg.end.lon, afloat: leg.outcome === 'afloat' };
  if (leg.outcome === 'delivered') {
    j.delivered = true;
    j.deliveredAt = new Date().toISOString();
  }
  saveJourney(j);
}
