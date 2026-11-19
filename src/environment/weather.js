// Real wind and place search from Open-Meteo (free for non-commercial use, no key).
import { CONFIG } from '../core/config.js';

const cache = new Map();

// Wind at 10 m. fromDeg is where the wind comes FROM (meteorological), clockwise from north.
export async function fetchWind(p) {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CONFIG.journey.weatherCacheMinutes * 60000) return hit;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat.toFixed(3)}&longitude=${p.lon.toFixed(3)}` +
    '&current=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=ms&timezone=auto';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather service answered ${res.status}`);
  const d = await res.json();
  const wind = {
    speed: d.current.wind_speed_10m,
    fromDeg: d.current.wind_direction_10m,
    precipitation: d.current.precipitation,
    time: d.current.time,
    fetchedAt: Date.now()
  };
  cache.set(key, wind);
  return wind;
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
