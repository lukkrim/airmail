// Shareable links: the whole journey packed into the URL fragment (#letter=…).
// Fragments never reach a web server, so the letter text stays between the
// two players. In-flight links leave the letter out so it stays sealed.

const OUTCOMES = ['land', 'ashore', 'afloat', 'delivered'];
const FOLDS = ['dart', 'glider', 'stunt'];
const MAX_POINTS_PER_LEG = 24;

const q = (v) => Math.round(v * 1000); // 1/1000 degree ≈ 100 m

function packPath(path) {
  const step = Math.max(1, Math.ceil(path.length / MAX_POINTS_PER_LEG));
  const pts = [];
  for (let i = 0; i < path.length; i += step) pts.push(path[i]);
  if (pts[pts.length - 1] !== path[path.length - 1]) pts.push(path[path.length - 1]);
  const out = [];
  let la = 0, lo = 0;
  for (const [lat, lon] of pts) {
    const a = q(lat), b = q(lon);
    out.push(a - la, b - lo);
    la = a; lo = b;
  }
  return out;
}

function unpackPath(flat) {
  const pts = [];
  let la = 0, lo = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    la += flat[i]; lo += flat[i + 1];
    pts.push([la / 1000, lo / 1000]);
  }
  return pts;
}

// Compact, versioned snapshot of a journey.
export function snapshot(j, { includeLetter }) {
  return {
    v: 1,
    c: j.createdAt.slice(0, 10),
    f: [j.from.name, j.from.region || '', q(j.from.lat), q(j.from.lon)],
    t: [j.to.name, j.to.region || '', q(j.to.lat), q(j.to.lon)],
    n: [j.fromName || '', j.toName || ''],
    d: j.delivered ? 1 : 0,
    l: includeLetter && j.delivered ? j.letter || '' : '',
    g: j.legs.map((L) => [
      OUTCOMES.indexOf(L.outcome),
      FOLDS.indexOf(L.fold),
      Math.round(L.km),
      Math.round(L.time),
      Math.round(L.driftKm || 0),
      Math.round(L.bearing),
      packPath(L.path),
      [q(L.end.lat), q(L.end.lon)]
    ])
  };
}

// Back into the shape the route map understands.
export function fromSnapshot(s) {
  const city = ([name, region, lat, lon]) => ({ name, region, lat: lat / 1000, lon: lon / 1000 });
  const from = city(s.f), to = city(s.t);
  const legs = s.g.map(([o, fold, km, time, driftKm, bearing, path, end], i) => {
    const pts = unpackPath(path);
    const last = pts[pts.length - 1] || [from.lat, from.lon];
    return {
      day: i + 1,
      outcome: OUTCOMES[o] || 'land',
      fold: FOLDS[fold] || 'glider',
      km, time, driftKm, bearing,
      path: pts,
      landing: { lat: last[0], lon: last[1] },
      end: { lat: end[0] / 1000, lon: end[1] / 1000 }
    };
  });
  const lastEnd = legs.length ? legs[legs.length - 1].end : from;
  return {
    createdAt: s.c,
    from, to,
    fromName: s.n[0], toName: s.n[1],
    delivered: !!s.d,
    letter: s.l,
    legs,
    pos: { lat: lastEnd.lat, lon: lastEnd.lon, afloat: legs.length ? legs[legs.length - 1].outcome === 'afloat' : false }
  };
}

// ---------- string encoding ----------
const b64url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str) => {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// 'z' + deflate when the browser can compress, otherwise 'j' + plain JSON.
export async function encodeSnapshot(s) {
  const json = new TextEncoder().encode(JSON.stringify(s));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return 'z' + b64url(await pipe(json, new CompressionStream('deflate-raw')));
    } catch { /* fall through */ }
  }
  return 'j' + b64url(json);
}

export async function decodeSnapshot(code) {
  const kind = code[0], body = unb64url(code.slice(1));
  let bytes = body;
  if (kind === 'z') bytes = await pipe(body, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('Unknown link format');
  const s = JSON.parse(new TextDecoder().decode(bytes));
  if (s.v !== 1) throw new Error('This link is from a newer version of Airmail');
  return s;
}

export async function journeyLink(j, opts) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#letter=${await encodeSnapshot(snapshot(j, opts))}`;
}

export function letterCodeFromHash(hash = location.hash) {
  const m = /^#letter=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? m[1] : null;
}
