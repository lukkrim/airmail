// Great-circle helpers. Points are { lat, lon } in degrees, distances in km.
const R = 6371;
const D2R = Math.PI / 180;

export function destination(p, bearingDeg, km) {
  const d = km / R, b = bearingDeg * D2R;
  const la1 = p.lat * D2R, lo1 = p.lon * D2R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 / D2R, lon: ((lo2 / D2R + 540) % 360) - 180 };
}

export function distanceKm(a, b) {
  const dla = (b.lat - a.lat) * D2R, dlo = (b.lon - a.lon) * D2R;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const la1 = a.lat * D2R, la2 = b.lat * D2R, dlo = (b.lon - a.lon) * D2R;
  const y = Math.sin(dlo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dlo);
  return (Math.atan2(y, x) / D2R + 360) % 360;
}

export const normDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// The flight course is laid along `bearing`: game -Z is forward, +X is right.
export function gameToLatLon(start, bearing, x, z, kmPerUnit) {
  const fwd = -z * kmPerUnit, right = x * kmPerUnit;
  const d = Math.hypot(fwd, right);
  if (d < 1e-6) return { lat: start.lat, lon: start.lon };
  return destination(start, bearing + Math.atan2(right, fwd) / D2R, d);
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
