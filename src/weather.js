// Real wind and place search from Open-Meteo (free for non-commercial use, no key).
import { CONFIG } from './config.js';

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

export async function searchPlaces(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Place search answered ${res.status}`);
  const d = await res.json();
  return (d.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    country: r.country || '',
    lat: r.latitude,
    lon: r.longitude
  }));
}
