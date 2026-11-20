// Paper-globe route map (orthographic projection on a canvas).
import { geoOrthographic, geoPath, geoGraticule10, geoCentroid, geoDistance } from 'd3-geo';
import { LAND, BORDERS } from '../environment/land.js';
import { destination } from '../environment/geo.js';
import { COLORS, FONTS, paperGrain } from './theme.js';

const C = {
  paper: COLORS.paper,
  ocean: COLORS.ocean,
  oceanRim: COLORS.oceanEdge,
  land: COLORS.land,
  landEdge: COLORS.landEdge,
  border: 'rgba(120,108,80,0.35)',
  grid: 'rgba(31,79,156,0.10)',
  red: COLORS.red,
  blue: COLORS.blue,
  ink: COLORS.ink,
  muted: COLORS.pencil,
  warm: COLORS.warm,
  postmark: COLORS.postmark
};

const ll = (p) => [p.lon, p.lat];

/**
 * Draws the journey into ctx (already scaled for the pixel ratio) at 0,0,w,h.
 * opts.focus: 'route' (whole journey) or 'leg' (one day's flight)
 * opts.aimBearing: show the throw direction from the plane
 * opts.wind: { speed, fromDeg } to draw a wind arrow at the plane
 */
export function drawRouteMap(ctx, w, h, j, opts = {}) {
  const { focus = 'route', aimBearing = null, wind = null, pad = 30 } = opts;
  const legIndex = opts.legIndex ?? j.legs.length - 1;
  const leg = j.legs[legIndex];

  // points the view must contain
  let pts = [];
  let minKm = 250;
  if (focus === 'leg' && leg) {
    pts = leg.path.map(([la, lo]) => [lo, la]);
    pts.push(ll(leg.end));
    minKm = 60;
  } else {
    const F = opts.frame || j; // frame on another journey (keeps the view still during a replay)
    pts = [ll(F.from), ll(F.to), ll(F.pos)];
    for (const L of F.legs) for (const [la, lo] of L.path) pts.push([lo, la]);
  }
  const center = geoCentroid({ type: 'MultiPoint', coordinates: pts });
  const c = { lon: center[0], lat: center[1] };
  for (const b of [0, 90, 180, 270]) pts.push(ll(destination(c, b, minKm)));

  const proj = geoOrthographic().rotate([-c.lon, -c.lat]).clipAngle(90).precision(0.4);
  proj.fitExtent([[pad, pad], [w - pad, h - pad]], { type: 'MultiPoint', coordinates: pts });
  const globeScale = Math.min(w, h) / 2 - pad / 2;
  if (!(proj.scale() > globeScale) || pts.some((p) => geoDistance(p, center) > 1.45)) {
    proj.scale(globeScale).translate([w / 2, h / 2]);
  }
  viewW = w;
  const path = geoPath(proj, ctx);
  const visible = (p) => geoDistance(ll(p), center) < Math.PI / 2 - 0.01;
  const at = (p) => proj(ll(p));

  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, w, h);

  ctx.beginPath(); path({ type: 'Sphere' });
  ctx.fillStyle = C.ocean; ctx.fill();
  ctx.beginPath(); path(geoGraticule10());
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); path(LAND);
  ctx.fillStyle = C.land; ctx.fill();
  ctx.strokeStyle = C.landEdge; ctx.lineWidth = 0.9; ctx.stroke();
  ctx.beginPath(); path(BORDERS);
  ctx.strokeStyle = C.border; ctx.lineWidth = 0.7; ctx.stroke();
  ctx.beginPath(); path({ type: 'Sphere' });
  ctx.strokeStyle = C.oceanRim; ctx.lineWidth = 1.5; ctx.stroke();

  // still to go: dotted great circle to the friend's city
  if (!j.delivered) {
    ctx.beginPath(); path({ type: 'LineString', coordinates: [ll(j.pos), ll(j.to)] });
    ctx.setLineDash([2, 6]); ctx.strokeStyle = C.muted; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.setLineDash([]);
  }

  // flown legs in airmail stripes; the focused one thicker
  j.legs.forEach((L, i) => {
    const coords = L.path.map(([la, lo]) => [lo, la]);
    const width = i === legIndex ? 4 : 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath(); path({ type: 'LineString', coordinates: coords });
    ctx.strokeStyle = C.red; ctx.lineWidth = width; ctx.setLineDash([10, 8]); ctx.stroke();
    ctx.beginPath(); path({ type: 'LineString', coordinates: coords });
    ctx.strokeStyle = C.blue; ctx.lineDashOffset = -9; ctx.stroke();
    ctx.lineDashOffset = 0; ctx.setLineDash([]);
    if (L.driftKm > 0) {
      ctx.beginPath(); path({ type: 'LineString', coordinates: [ll(L.landing), ll(L.end)] });
      ctx.strokeStyle = C.blue; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.6; ctx.setLineDash([1, 4]); ctx.stroke();
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
  });

  // a postmark where each day ended (not the current spot, which has the plane)
  j.legs.forEach((L, i) => {
    const last = i === j.legs.length - 1;
    if (last && !j.delivered) return;
    if (L.outcome === 'delivered' || !visible(L.end)) return;
    const [x, y] = at(L.end);
    dayMark(ctx, x, y, i + 1);
  });

  // origin
  if (visible(j.from)) {
    const [x, y] = at(j.from);
    ctx.fillStyle = C.ink; ctx.fillRect(x - 4, y - 4, 8, 8);
    label(ctx, j.from.name, x, y + 16, 'center');
  }

  // destination envelope
  if (visible(j.to)) {
    const [x, y] = at(j.to);
    envelope(ctx, x, y);
    label(ctx, j.to.name, x, y - 16, 'center');
  }

  // arrows from the plane's position
  if (visible(j.pos)) {
    const [px, py] = at(j.pos);
    const screenDir = (bearing) => {
      const q = at(destination(j.pos, bearing, 30));
      const dx = q[0] - px, dy = q[1] - py, n = Math.hypot(dx, dy) || 1;
      return [dx / n, dy / n];
    };
    if (wind) windBadge(ctx, wind, wind.speed > 0.2 ? screenDir((wind.fromDeg + 180) % 360) : null);
    if (aimBearing != null) {
      const [dx, dy] = screenDir(aimBearing);
      arrow(ctx, px + dx * 10, py + dy * 10, dx, dy, 56, C.ink, 2.5, [6, 4]);
    }
    if (!j.delivered) {
      const lastBearing = aimBearing ?? (leg ? leg.bearing : null);
      plane(ctx, px, py, lastBearing != null ? screenDir(lastBearing) : [0, -1]);
    }
  }
  paperGrain(ctx, 0, 0, w, h, 0.5);
  ctx.restore();
}

// Wind badge in the map's top-left corner, arrow pointing where the wind blows.
function windBadge(ctx, wind, dir) {
  const x = 12, y = 12, w = 122, h = 42;
  ctx.save();
  ctx.fillStyle = 'rgba(255,250,240,0.95)';
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.blue; ctx.fillRect(x, y, 4, h);
  const cx = x + 20, cy = y + h / 2;
  if (dir) arrow(ctx, cx - dir[0] * 11, cy - dir[1] * 11, dir[0], dir[1], 22, C.warm, 3);
  else { ctx.fillStyle = C.muted; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.font = `800 9.5px ${FONTS.ui}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.muted;
  ctx.fillText(wind.source === 'stand-in' ? 'STAND-IN WIND' : wind.source === 'saved' ? 'LAST REAL WIND' : 'REAL WIND NOW', x + 40, y + 17);
  ctx.font = `800 15px ${FONTS.ui}`;
  ctx.fillStyle = C.ink;
  ctx.fillText(wind.speed < 0.2 ? 'Calm' : `${wind.speed.toFixed(1)} m/s`, x + 40, y + 32);
  ctx.restore();
}

let viewW = 0;
function label(ctx, text, x, y, align) {
  ctx.font = `600 14px ${FONTS.display}`;
  const half = ctx.measureText(text).width / 2 + 6;
  if (viewW) x = Math.min(viewW - half, Math.max(half, x)); // keep names inside the map
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(246,239,223,0.95)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = C.ink;
  ctx.fillText(text, x, y);
}

// Small round postmark with the day number, where a day's flight ended.
function dayMark(ctx, x, y, day) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.2);
  ctx.strokeStyle = C.postmark; ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = C.postmark;
  ctx.font = `800 ${day > 9 ? 7.5 : 9}px ${FONTS.ui}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(day), 0, 0.5);
  ctx.restore();
}

function envelope(ctx, x, y) {
  const w = 22, h = 15;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = COLORS.card;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(0, 1.5); ctx.lineTo(w / 2, -h / 2);
  ctx.stroke();
  ctx.fillStyle = C.red; ctx.fillRect(-w / 2 + 2, h / 2 - 3.5, 4, 2);
  ctx.fillStyle = C.blue; ctx.fillRect(-w / 2 + 8, h / 2 - 3.5, 4, 2);
  ctx.restore();
}

function plane(ctx, x, y, [dx, dy]) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.atan2(dx, -dy));
  ctx.beginPath();
  ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 5); ctx.lineTo(-8, 9); ctx.closePath();
  ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 5);
  ctx.strokeStyle = C.red; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.restore();
}

function arrow(ctx, x, y, dx, dy, len, color, width, dash) {
  const ex = x + dx * len, ey = y + dy * len;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex - dx * 6, ey - dy * 6); ctx.stroke();
  ctx.setLineDash([]);
  const nx = -dy, ny = dx;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - dx * 10 + nx * 5.5, ey - dy * 10 + ny * 5.5);
  ctx.lineTo(ex - dx * 10 - nx * 5.5, ey - dy * 10 - ny * 5.5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Size a canvas for its CSS box and the pixel ratio, then draw.
export function renderToCanvas(canvas, j, opts) {
  const r = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * r);
  canvas.height = Math.round(h * r);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  drawRouteMap(ctx, w, h, j, opts);
}
