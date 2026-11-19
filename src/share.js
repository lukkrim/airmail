// Share card: a 1080×1350 image plus a short text line.
import { drawRouteMap } from './routemap.js';
import { CONFIG } from './config.js';
import { totalKm } from './journey.js';

const FONT = 'ui-rounded, "SF Pro Rounded", "Avenir Next", system-ui, sans-serif';
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function shareText(j, leg) {
  const head = `✉️ Airmail · Day ${leg.day}`;
  const route = `${j.from.name} → ${j.to.name}`;
  const today = `${CONFIG.folds[leg.fold].name} · ${fmt(leg.km)} km today · ${Math.round(leg.time)} s aloft`;
  const end = leg.outcome === 'delivered'
    ? `📬 Delivered after ${leg.day} ${leg.day === 1 ? 'day' : 'days'}, ${fmt(totalKm(j))} km`
    : `📍 ${leg.outcome === 'afloat' ? 'Floating at sea' : leg.country || 'Somewhere'} · ${fmt(leg.toGoKm)} km to go`;
  return [head, route, today, end].join('\n');
}

export function makeShareCanvas(j, leg) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  g.fillStyle = '#fbf8f1';
  g.fillRect(0, 0, W, H);
  // airmail border
  const band = 26;
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  g.rect(band, band, W - band * 2, H - band * 2);
  g.clip('evenodd');
  for (let i = -H; i < W + H; i += 72) {
    g.fillStyle = '#c8102e';
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 24, 0); g.lineTo(i + 24 - H, H); g.lineTo(i - H, H); g.fill();
    g.fillStyle = '#1d4e9e';
    g.beginPath(); g.moveTo(i + 36, 0); g.lineTo(i + 60, 0); g.lineTo(i + 60 - H, H); g.lineTo(i + 36 - H, H); g.fill();
  }
  g.restore();

  g.fillStyle = '#1d2433';
  g.textBaseline = 'alphabetic';
  g.font = `800 64px ${FONT}`;
  g.fillText('Airmail', 80, 140);
  g.font = `700 40px ${FONT}`;
  g.fillStyle = '#5c6577';
  g.textAlign = 'right';
  g.fillText(`Day ${leg.day}`, W - 80, 140);
  g.textAlign = 'left';
  g.fillStyle = '#1d2433';
  g.font = `700 44px ${FONT}`;
  g.fillText(`${j.from.name} → ${j.to.name}`, 80, 214, W - 160);

  // map
  const mx = 80, my = 260, mw = W - 160, mh = 720;
  g.save();
  g.beginPath(); g.roundRect(mx, my, mw, mh, 28); g.clip();
  g.translate(mx, my);
  g.scale(2, 2);
  drawRouteMap(g, mw / 2, mh / 2, j, { focus: 'route', legIndex: leg.day - 1, pad: 26 });
  g.restore();
  g.strokeStyle = '#e0d9c9'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(mx, my, mw, mh, 28); g.stroke();

  // stats
  const stats = [
    [`${fmt(leg.km)} km`, 'today'],
    [`${Math.round(leg.time)} s`, 'aloft'],
    [CONFIG.folds[leg.fold].name, 'fold'],
    leg.outcome === 'delivered' ? ['Delivered', `${fmt(totalKm(j))} km total`] : [`${fmt(leg.toGoKm)} km`, 'to go']
  ];
  const sy = 1030, sw = (W - 160 - 3 * 20) / 4;
  stats.forEach(([big, small], i) => {
    const x = 80 + i * (sw + 20);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(x, sy, sw, 150, 20); g.fill();
    g.strokeStyle = '#e0d9c9'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#1d2433';
    g.font = `800 40px ${FONT}`;
    g.fillText(big, x + 24, sy + 78, sw - 40);
    g.fillStyle = '#5c6577';
    g.font = `600 28px ${FONT}`;
    g.fillText(small, x + 24, sy + 120, sw - 40);
  });

  g.fillStyle = '#5c6577';
  g.font = `600 30px ${FONT}`;
  const where = leg.outcome === 'delivered' ? `Delivered to ${j.to.name}.`
    : leg.outcome === 'afloat' ? 'Floating at sea, waiting for tomorrow.'
    : `Waiting in ${leg.country || 'the countryside'} for tomorrow's wind.`;
  g.fillText(where, 80, 1262, W - 160);
  return c;
}
