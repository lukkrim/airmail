// Where the sun is in the sky for a time and place (accurate to well under a
// degree, plenty for lighting). Angles in degrees; azimuth is clockwise from north.

const RAD = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12); // 2000-01-01 12:00 UTC

export function sunPosition(date, lat, lon) {
  const d = (date.getTime() - J2000) / 86400000;
  const g = (357.529 + 0.98560028 * d) * RAD;          // mean anomaly
  const q = 280.459 + 0.98564736 * d;                   // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD;            // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const H = (gmst * 15 + lon) * RAD - ra;               // hour angle
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { altitude: alt / RAD, azimuth: ((az / RAD) % 360 + 360) % 360 };
}

// A rough "where am I" from the device's time zone, for players with no letter yet.
export function guessHome() {
  const lon = Math.max(-180, Math.min(180, -new Date().getTimezoneOffset() / 4));
  return { lat: 35, lon };
}

// 0 at night, 1 in full day, eased through dusk and dawn.
export function daylight(altitude) {
  const t = Math.min(1, Math.max(0, (altitude + 6) / 14));
  return t * t * (3 - 2 * t);
}

// 1 when the sun is low (golden hour / sunset glow), 0 otherwise.
export function glow(altitude) {
  return Math.max(0, 1 - Math.abs(altitude - 2) / 12);
}
