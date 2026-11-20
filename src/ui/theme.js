// The postal-paper theme for everything drawn in JS: canvas maps, the share
// postcard, stamps and postmarks. Colours mirror the CSS tokens in
// styles/tokens.css; change both together.

export const COLORS = {
  paper: '#f6efdf',     // cream writing paper
  card: '#fffaf0',      // card stock
  paper2: '#ece2cb',    // darker paper, wells
  kraft: '#cdb48a',     // brown envelope paper
  ink: '#232a3b',
  pencil: '#6a6760',    // secondary text
  line: '#dccfb3',
  red: '#c4262e',
  blue: '#1f4f9c',
  warm: '#df7a2a',      // thermals, rising air
  cool: '#3a64c8',      // sink
  ocean: '#cfe0e3',
  oceanEdge: '#9dbcc2',
  land: '#efe4c6',
  landEdge: '#8d7f5d',
  postmark: 'rgba(35, 42, 59, 0.78)'
};

export const FONTS = {
  display: '"Fraunces Variable", Georgia, "Times New Roman", serif',
  ui: '"Figtree Variable", "Avenir Next", "Segoe UI", system-ui, sans-serif',
  hand: '"Caveat Variable", "Bradley Hand", "Segoe Print", cursive'
};

// Canvas text must wait for the web fonts, or it falls back silently.
export function fontsReady() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load(`700 40px ${FONTS.display}`),
    document.fonts.load(`700 20px ${FONTS.ui}`),
    document.fonts.load(`500 20px ${FONTS.ui}`),
    document.fonts.load(`600 30px ${FONTS.hand}`)
  ]).catch(() => {});
}

// ---------- canvas paper grain ----------
let grainTile = null;
function makeGrainTile() {
  const s = 160;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < s * s; i++) {
    // fine grain plus the odd darker fibre fleck
    const v = 255 - rnd() * 26 - (rnd() > 0.985 ? 30 : 0);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v - 3; img.data[i * 4 + 2] = v - 9; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Multiplies a light grain over whatever is already drawn in the rectangle.
export function paperGrain(ctx, x, y, w, h, strength = 0.55) {
  grainTile ||= makeGrainTile();
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = strength;
  ctx.fillStyle = ctx.createPattern(grainTile, 'repeat');
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// ---------- SVG pieces for the DOM ----------
let uid = 0;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * A round postmark: ring text on top and bottom, two short lines in the middle,
 * optional wavy cancellation lines to the right. Draws in currentColor.
 */
export function postmarkSVG({ top = 'AIRMAIL', bottom = '', lines = [], waves = true } = {}) {
  const id = `pm${++uid}`;
  const w = waves ? 190 : 100;
  const mid = lines.slice(0, 2).map((t, i, a) =>
    `<text x="50" y="${a.length === 1 ? 54 : 48 + i * 14}" text-anchor="middle" class="pm-mid">${esc(t)}</text>`).join('');
  const wave = waves
    ? [0, 1, 2].map((i) => {
      const y = 36 + i * 14;
      let d = `M 96 ${y}`;
      for (let x = 96; x < 186; x += 15) d += ` q 7.5 ${i % 2 ? 6 : -6} 15 0`;
      return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`;
    }).join('')
    : '';
  return `<svg class="postmark" viewBox="0 0 ${w} 100" aria-hidden="true">
    <defs>
      <path id="${id}t" d="M 15 50 A 35 35 0 0 1 85 50"/>
      <path id="${id}b" d="M 7 50 A 43 43 0 0 0 93 50"/>
    </defs>
    <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2.6"/>
    <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <text class="pm-ring"><textPath href="#${id}t" startOffset="50%" text-anchor="middle">${esc(top)}</textPath></text>
    <text class="pm-ring"><textPath href="#${id}b" startOffset="50%" text-anchor="middle">${esc(bottom)}</textPath></text>
    ${mid}${wave}
  </svg>`;
}

/**
 * A perforated stamp. `art` is SVG markup drawn into a 60×52 box in the middle.
 */
export function stampSVG({ art = '', value = '', label = 'AIRMAIL', tone = 'blue', color: custom = null } = {}) {
  const id = `st${++uid}`;
  const W = 84, H = 100, r = 3.2, step = 8;
  let holes = '';
  for (let x = step / 2 + 2; x < W; x += step) holes += `<circle cx="${x}" cy="0" r="${r}"/><circle cx="${x}" cy="${H}" r="${r}"/>`;
  for (let y = step / 2 + 2; y < H; y += step) holes += `<circle cx="0" cy="${y}" r="${r}"/><circle cx="${W}" cy="${y}" r="${r}"/>`;
  const color = custom || (tone === 'red' ? COLORS.red : COLORS.blue);
  // long names are squeezed to fit the stamp
  const fit = label.length > 11 ? ` textLength="${W - 20}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<svg class="stamp" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <defs><mask id="${id}"><rect width="${W}" height="${H}" fill="#fff"/><g fill="#000">${holes}</g></mask></defs>
    <g mask="url(#${id})">
      <rect width="${W}" height="${H}" fill="${COLORS.card}"/>
      <rect x="7" y="7" width="${W - 14}" height="${H - 14}" fill="${color}" opacity="0.1"/>
      <rect x="7" y="7" width="${W - 14}" height="${H - 14}" fill="none" stroke="${color}" stroke-width="1.6"/>
      <svg x="12" y="18" width="60" height="52" viewBox="0 0 60 52">${art}</svg>
      <text x="12" y="19" class="st-value" fill="${color}" font-family="Figtree Variable, Avenir Next, Helvetica, sans-serif" font-weight="800" font-size="12">${esc(value)}</text>
      <text x="${W / 2}" y="${H - 14}" text-anchor="middle" class="st-label" fill="${color}" font-family="Figtree Variable, Avenir Next, Helvetica, sans-serif" font-weight="800" font-size="8.5" letter-spacing="1.4"${fit}>${esc(label)}</text>
    </g>
  </svg>`;
}

// Simple paper plane for stamp art (60×52 box).
export const PLANE_ART = `<g transform="translate(6 8)" stroke="${COLORS.ink}" stroke-width="1.4" stroke-linejoin="round">
  <polygon points="0,20 48,0 22,36" fill="#fff"/>
  <polygon points="22,36 48,0 26,26" fill="#eef1f7"/>
  <polygon points="22,36 26,26 20,30" fill="#d9dfe9"/>
  <path d="M -4 32 q 8 4 14 -2" fill="none" stroke="${COLORS.red}" stroke-dasharray="3 3"/>
</g>`;

// Today's date for a postmark, as two lines: ["19 NOV", "2026"].
export function postmarkDate(d = new Date()) {
  const dm = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase().replace('.', '');
  return [dm, String(d.getFullYear())];
}
