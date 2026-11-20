// Share card: a 1080×1350 postcard image plus a short text line.
import { drawRouteMap } from './routemap.js';
import { CONFIG } from '../core/config.js';
import { totalKm } from '../journey/journey.js';
import { COLORS, FONTS, paperGrain, postmarkDate } from './theme.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function shareText(j, leg, link) {
  const head = `✉️ Airmail · Day ${leg.day}`;
  const route = `${j.from.name} → ${j.to.name}`;
  const today = `${CONFIG.folds[leg.fold].name} · ${fmt(leg.km)} km today · ${Math.round(leg.time)} s aloft`;
  const end = leg.outcome === 'delivered'
    ? `📬 Delivered after ${leg.day} ${leg.day === 1 ? 'day' : 'days'}, ${fmt(totalKm(j))} km`
    : `📍 ${leg.outcome === 'afloat' ? 'Floating at sea' : leg.country || 'Somewhere'} · ${fmt(leg.toGoKm)} km to go`;
  const lines = [head, route, today, end];
  if (link) lines.push(leg.outcome === 'delivered' ? `Open it: ${link}` : `Follow it: ${link}`);
  return lines.join('\n');
}

// Call after fontsReady() so the canvas text uses the theme fonts.
export function makeShareCanvas(j, leg) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const delivered = leg.outcome === 'delivered';

  // card stock with an airmail edge
  g.fillStyle = COLORS.card;
  g.fillRect(0, 0, W, H);
  stripes(g, W, H, 30);

  // heading
  g.textBaseline = 'alphabetic';
  g.fillStyle = COLORS.red;
  g.font = `800 26px ${FONTS.ui}`;
  spaced(g, `PAR AVION · DAY ${leg.day}`, 84, 118, 4);
  g.fillStyle = COLORS.ink;
  g.font = `650 66px ${FONTS.display}`;
  fitText(g, `${j.from.name} → ${j.to.name}`, 84, 196, 700, 66, FONTS.display, 650);

  // stamp and postmark, top right
  stamp(g, 872, 64, 132, 158, 0.06);
  postmark(g, 836, 196, 66, delivered ? 'DELIVERED' : 'AIRMAIL', `DAY ${leg.day}`, postmarkDate(), delivered ? COLORS.red : COLORS.postmark);

  // the map, mounted like a photo with tape
  const mx = 84, my = 262, mw = W - 168, mh = 660;
  g.save();
  g.translate(W / 2, my + mh / 2);
  g.rotate(-0.012);
  g.translate(-W / 2, -(my + mh / 2));
  g.shadowColor = 'rgba(48,36,14,0.28)'; g.shadowBlur = 24; g.shadowOffsetY = 10;
  g.fillStyle = '#fff';
  g.fillRect(mx - 14, my - 14, mw + 28, mh + 28);
  g.shadowColor = 'transparent';
  g.save();
  g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
  g.translate(mx, my);
  g.scale(2, 2);
  drawRouteMap(g, mw / 2, mh / 2, j, { focus: 'route', legIndex: leg.day - 1, pad: 26 });
  g.restore();
  tape(g, mx - 30, my - 6, -0.6);
  tape(g, mx + mw + 30, my + mh + 6, -0.6);
  g.restore();

  // a handwritten line
  const where = delivered ? `Made it to ${j.to.name}!`
    : leg.outcome === 'afloat' ? 'Bobbing at sea tonight…'
    : `Resting in ${leg.country || 'the countryside'} tonight.`;
  g.fillStyle = '#1e2f5c';
  g.font = `600 58px ${FONTS.hand}`;
  fitText(g, where, 84, 1010, W - 168, 58, FONTS.hand, 600);

  // stats as gummed labels
  const stats = [
    [`${fmt(leg.km)} km`, 'TODAY'],
    [`${Math.round(leg.time)} s`, 'ALOFT'],
    [CONFIG.folds[leg.fold].name, 'FOLD'],
    delivered ? [`${fmt(totalKm(j))} km`, 'IN ALL'] : [`${fmt(leg.toGoKm)} km`, 'TO GO']
  ];
  const sy = 1062, gap = 20, sw = (W - 168 - 3 * gap) / 4, sh = 142;
  stats.forEach(([big, small], i) => {
    const x = 84 + i * (sw + gap);
    g.fillStyle = COLORS.paper;
    g.fillRect(x, sy, sw, sh);
    g.strokeStyle = COLORS.line; g.lineWidth = 2;
    g.strokeRect(x + 1, sy + 1, sw - 2, sh - 2);
    g.fillStyle = i === 1 ? COLORS.red : COLORS.blue;
    g.fillRect(x, sy, sw, 7);
    g.fillStyle = COLORS.pencil;
    g.font = `800 21px ${FONTS.ui}`;
    spaced(g, small, x + 22, sy + 52, 2.5);
    g.fillStyle = COLORS.ink;
    g.font = `800 40px ${FONTS.ui}`;
    fitText(g, big, x + 22, sy + 108, sw - 40, 40, FONTS.ui, 800);
  });

  g.fillStyle = COLORS.pencil;
  g.font = `600 24px ${FONTS.ui}`;
  g.textAlign = 'center';
  g.fillText('Airmail · a paper plane on the real wind, one flight a day', W / 2, H - 70);
  g.textAlign = 'left';

  paperGrain(g, 0, 0, W, H, 0.6);
  return c;
}

// ---------- drawing helpers ----------
function stripes(g, W, H, band) {
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.rect(band, band, W - band * 2, H - band * 2);
  g.clip('evenodd');
  for (let i = -H; i < W + H; i += 76) {
    g.fillStyle = COLORS.red;
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 26, 0); g.lineTo(i + 26 - H, H); g.lineTo(i - H, H); g.fill();
    g.fillStyle = COLORS.blue;
    g.beginPath(); g.moveTo(i + 38, 0); g.lineTo(i + 64, 0); g.lineTo(i + 64 - H, H); g.lineTo(i + 38 - H, H); g.fill();
  }
  g.restore();
}

function spaced(g, text, x, y, spacing) {
  if ('letterSpacing' in g) { g.letterSpacing = `${spacing}px`; g.fillText(text, x, y); g.letterSpacing = '0px'; return; }
  for (const ch of text) { g.fillText(ch, x, y); x += g.measureText(ch).width + spacing; }
}

// Shrinks the font until the text fits.
function fitText(g, text, x, y, maxW, size, family, weight) {
  let s = size;
  g.font = `${weight} ${s}px ${family}`;
  while (s > 18 && g.measureText(text).width > maxW) { s -= 2; g.font = `${weight} ${s}px ${family}`; }
  g.fillText(text, x, y);
}

function stamp(g, x, y, w, h, rot) {
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.rotate(rot);
  g.translate(-w / 2, -h / 2);
  g.shadowColor = 'rgba(48,36,14,0.3)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
  g.fillStyle = '#fffdf6';
  g.fillRect(0, 0, w, h);
  g.shadowColor = 'transparent';
  // perforations
  g.fillStyle = COLORS.card;
  const r = 5, step = 13;
  for (let px = step / 2 + 2; px < w; px += step) { dot(g, px, 0, r); dot(g, px, h, r); }
  for (let py = step / 2 + 2; py < h; py += step) { dot(g, 0, py, r); dot(g, w, py, r); }
  // frame and art
  g.fillStyle = 'rgba(196,38,46,0.1)';
  g.fillRect(11, 11, w - 22, h - 22);
  g.strokeStyle = COLORS.red; g.lineWidth = 2.5;
  g.strokeRect(11, 11, w - 22, h - 22);
  g.save();
  g.translate(w / 2 - 34, 34);
  g.scale(1.4, 1.4);
  g.lineJoin = 'round'; g.lineWidth = 1.6; g.strokeStyle = COLORS.ink;
  poly(g, [[0, 20], [48, 0], [22, 36]], '#fff');
  poly(g, [[22, 36], [48, 0], [26, 26]], '#eef1f7');
  poly(g, [[22, 36], [26, 26], [20, 30]], '#d9dfe9');
  g.restore();
  g.fillStyle = COLORS.red;
  g.font = `800 13px ${FONTS.ui}`;
  g.textAlign = 'center';
  spacedCentered(g, 'PAR AVION', w / 2, h - 22, 2.5);
  g.textAlign = 'left';
  g.restore();
}

function spacedCentered(g, text, cx, y, spacing) {
  if ('letterSpacing' in g) { g.letterSpacing = `${spacing}px`; g.fillText(text, cx + spacing / 2, y); g.letterSpacing = '0px'; return; }
  g.fillText(text, cx, y);
}

function dot(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
function poly(g, pts, fill) {
  g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
  g.fillStyle = fill; g.fill(); g.stroke();
}

function tape(g, x, y, rot) {
  g.save();
  g.translate(x, y); g.rotate(rot);
  g.fillStyle = 'rgba(236,222,180,0.78)';
  g.fillRect(-70, -20, 140, 40);
  g.restore();
}

// Round postmark with text around the ring and a date in the middle.
function postmark(g, cx, cy, r, top, bottom, mid, color) {
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.18);
  g.strokeStyle = color; g.fillStyle = color;
  g.lineWidth = 3.5;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, r * 0.66, 0, Math.PI * 2); g.stroke();
  g.font = `800 15px ${FONTS.ui}`;
  ringText(g, top, r * 0.83 - 5, true);
  ringText(g, bottom, r * 0.83 + 5, false);
  g.font = `800 16px ${FONTS.ui}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(mid[0], 0, -8);
  g.fillText(mid[1], 0, 12);
  g.restore();
}

function ringText(g, text, radius, onTop) {
  const sp = 3;
  const widths = [...text].map((ch) => g.measureText(ch).width + sp);
  const total = widths.reduce((a, b) => a + b, 0) / radius;
  let a = onTop ? -Math.PI / 2 - total / 2 : Math.PI / 2 + total / 2;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  [...text].forEach((ch, i) => {
    const half = widths[i] / 2 / radius;
    a += onTop ? half : -half;
    g.save();
    g.translate(Math.cos(a) * radius, Math.sin(a) * radius);
    g.rotate(onTop ? a + Math.PI / 2 : a - Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    a += onTop ? half : -half;
  });
}
