// Real wind and place search. Wind comes from Open-Meteo, with MET Norway as a
// backup; both are free and need no key. If neither answers, the last reading
// saved on this device is used, and failing that a light stand-in wind, so a
// day's flight is never blocked by a weather service being down.
import { CONFIG } from '../core/config.js';
import { distanceKm } from './geo.js';

const cache = new Map();
const SAVED_KEY = 'airmail.wind.v1';
const SAVED_MAX = 30;           // readings kept on the device
const SAVED_HOURS = 24;         // a saved reading older than this isn't used
const SAVED_NEAR_KM = 120;      // ...nor one further than this from the plane

async function getJSON(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fromOpenMeteo(p) {
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}` +
    '&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms', 4000);
  return { speed: d.current.wind_speed_10m, fromDeg: d.current.wind_direction_10m, source: 'open-meteo' };
}

// MET Norway (api.met.no), the Norwegian Meteorological Institute; global coverage.
async function fromMetNorway(p) {
  const d = await getJSON(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`, 6000);
  const now = Date.now();
  const series = d.properties.timeseries;
  const row = series.reduce((best, r) =>
    Math.abs(Date.parse(r.time) - now) < Math.abs(Date.parse(best.time) - now) ? r : best, series[0]);
  const x = row.data.instant.details;
  return { speed: x.wind_speed, fromDeg: x.wind_from_direction, source: 'met-norway' };
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'); } catch { return []; }
}
function save(p, w) {
  try {
    const list = loadSaved().filter((r) => distanceKm(r, p) > 5);
    list.unshift({ lat: +p.lat.toFixed(3), lon: +p.lon.toFixed(3), speed: w.speed, fromDeg: w.fromDeg, at: w.fetchedAt });
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, SAVED_MAX)));
  } catch { /* storage full or blocked: fine */ }
}
function nearestSaved(p) {
  const now = Date.now();
  let best = null;
  for (const r of loadSaved()) {
    if (now - r.at > SAVED_HOURS * 3600000) continue;
    const km = distanceKm(r, p);
    if (km <= SAVED_NEAR_KM && (!best || km < best.km)) best = { ...r, km };
  }
  return best;
}

// A light wind from the usual direction for the latitude (trade winds near the
// tropics, westerlies further out), varied a little by day and place. The same
// for everyone at that spot that day, so retrying can't reroll it.
export function standInWind(p, date = new Date()) {
  const day = Math.floor(date.getTime() / 86400000);
  const seed = Math.sin(day * 12.9898 + Math.round(p.lat) * 78.233 + Math.round(p.lon) * 37.719) * 43758.5453;
  const jitter = ((seed - Math.floor(seed)) - 0.5) * 60;
  const a = Math.abs(p.lat);
  const usual = a < 28 ? (p.lat >= 0 ? 60 : 120) : a < 62 ? 260 : 80;
  return { speed: 3.5, fromDeg: (usual + jitter + 360) % 360, source: 'stand-in' };
}

/**
 * Wind at 10 m where the plane is. fromDeg is where the wind comes FROM
 * (meteorological), clockwise from north. source says where it came from:
 * 'open-meteo', 'met-norway', 'saved' (with ageMin) or 'stand-in'.
 */
export async function fetchWind(p) {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit;

  let wind = null;
  for (const get of [fromOpenMeteo, fromMetNorway]) {
    try {
      const w = await get(p);
      if (Number.isFinite(w.speed) && Number.isFinite(w.fromDeg)) { wind = w; break; }
    } catch { /* try the next one */ }
  }
  const now = Date.now();
  if (wind) {
    wind.fetchedAt = now;
    save(p, wind);
    wind.expires = now + CONFIG.journey.weatherCacheMinutes * 60000;
  } else {
    const s = nearestSaved(p);
    wind = s
      ? { speed: s.speed, fromDeg: s.fromDeg, source: 'saved', ageMin: Math.round((now - s.at) / 60000), fetchedAt: s.at }
      : { ...standInWind(p), fetchedAt: now };
    wind.expires = now + 5 * 60000; // look for real wind again soon
  }
  cache.set(key, wind);
  return wind;
}

// How to describe the wind's source to the player (empty for the usual service).
export function windSourceNote(w) {
  if (!w || w.source === 'open-meteo') return '';
  if (w.source === 'met-norway') return 'Wind from the backup forecast (MET Norway).';
  if (w.source === 'saved') {
    const age = w.ageMin < 60 ? `${w.ageMin} min` : `${Math.round(w.ageMin / 60)} h`;
    return `The weather services aren't answering, so this is the last real wind saved near here, ${age} old.`;
  }
  return "The weather services aren't answering, so today uses a light stand-in wind for this part of the world.";
}

const MIN_POP = 5000; // smaller places are behind "Show smaller places"

// Feature codes for inhabited places, best first (GeoNames).
const RANK = { PPLC: 5, PPLA: 4, PPLA2: 3, PPLA3: 2, PPLA4: 2, PPLG: 2, PPL: 1, PPLL: 0, PPLX: 0 };

/**
 * City search. Open-Meteo returns name matches in no useful order (searching
 * "Beijing" lists the capital and then villages called Beijing), so this keeps
 * inhabited places, sorts by size and hides small places unless asked.
 * Returns { places, hidden } where hidden counts the small places left out.
 */
export async function searchPlaces(query, { includeSmall = false } = {}) {
  const q = query.trim();
  if (q.length < 2) return { places: [], hidden: 0 };
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=40&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Place search answered ${res.status}`);
  const d = await res.json();
  const seen = new Set();
  const all = [];
  for (const r of d.results || []) {
    if (!(r.feature_code in RANK)) continue; // skip mountains, rivers and the like
    const key = `${r.name}|${r.admin1 || ''}|${r.country || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({
      name: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(', '),
      country: r.country || '',
      lat: r.latitude,
      lon: r.longitude,
      population: r.population || 0,
      rank: RANK[r.feature_code]
    });
  }
  // Biggest places first; among places without numbers, capitals and regional seats first.
  all.sort((a, b) => b.population - a.population || b.rank - a.rank);
  const big = all.filter((p) => p.population >= MIN_POP);
  const places = includeSmall || big.length === 0 ? all.slice(0, 12) : big.slice(0, 6);
  return { places, hidden: includeSmall || big.length === 0 ? 0 : all.length - places.length };
}

export function formatPopulation(n) {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M people`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k people`;
  return `${n} people`;
}

/**
 * Today's clouds and rain along a course (Open-Meteo, several points in one
 * request). points: [{ lat, lon, z }] (z: game position along the course).
 * Resolves to { cloud: 0…1, rain: [{ z, mm }], source }; if the service
 * doesn't answer, a fair-weather default so the flight still happens.
 */
export async function fetchSkies(points) {
  const key = points.map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join(';');
  const hit = cache.get('skies:' + key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value;
  try {
    const lat = points.map((p) => p.lat.toFixed(3)).join(','), lon = points.map((p) => p.lon.toFixed(3)).join(',');
    const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=cloud_cover,precipitation`, 5000);
    const rows = Array.isArray(d) ? d : [d];
    const cloud = rows.reduce((s, r) => s + (r.current.cloud_cover ?? 50), 0) / rows.length / 100;
    const rain = [];
    rows.forEach((r, i) => { if ((r.current.precipitation ?? 0) >= 0.2 && points[i].z < -300) rain.push({ z: points[i].z, mm: r.current.precipitation }); });
    value = { cloud, rain, source: 'open-meteo' };
  } catch {
    value = { cloud: 0.4, rain: [], source: 'default' };
  }
  cache.set('skies:' + key, { value, expires: Date.now() + CONFIG.journey.weatherCacheMinutes * 60000 });
  return value;
}
