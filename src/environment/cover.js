// Land cover for real-land courses: what covers the ground (forest, farmland,
// town, water…) on a grid in game space, drawn from OpenStreetMap vector
// tiles. The grid drives the ground colours, where trees, towns and thermals
// go, and the landing descriptions. Pure code (no canvas), so it gives the
// same result on every device, in a worker and in Node.
import { hash2, valueNoise } from '../core/noise.js';

export const COVER = {
  NONE: 0, GRASS: 1, WOOD: 2, FARM: 3, URBAN: 4, WATER: 5, OCEAN: 6,
  SAND: 7, ROCK: 8, ICE: 9, WETLAND: 10, ROAD: 11
};
export const COVER_NAMES = ['open ground', 'meadow', 'forest', 'farmland', 'town', 'water', 'sea', 'sand', 'rock', 'glacier', 'wetland', 'road'];

// OpenMapTiles classes → cover
const LANDCOVER = { farmland: COVER.FARM, wood: COVER.WOOD, forest: COVER.WOOD, grass: COVER.GRASS, wetland: COVER.WETLAND, sand: COVER.SAND, rock: COVER.ROCK, ice: COVER.ICE, glacier: COVER.ICE, beach: COVER.SAND };
const LANDUSE = { residential: COVER.URBAN, commercial: COVER.URBAN, industrial: COVER.URBAN, retail: COVER.URBAN, suburb: COVER.URBAN, quarter: COVER.URBAN, neighbourhood: COVER.URBAN, railway: COVER.URBAN };
// road widths in metres (drawn about twice as wide as real so they read from the air)
const ROADS = { motorway: 30, trunk: 24, primary: 18, secondary: 14, tertiary: 11, minor: 8 };
const RIVERS = { river: 40, canal: 20, stream: 6 };

/**
 * A cover grid over a game-space rectangle. toGame(lon, lat) → [x, z].
 */
export class CoverGrid {
  constructor(x0, z0, cell, w, h) {
    Object.assign(this, { x0, z0, cell, w, h });
    this.data = new Uint8Array(w * h);
  }

  at(x, z) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return COVER.NONE;
    return this.data[j * this.w + i];
  }

  // even-odd scanline fill of polygon rings given in grid pixels
  fillRings(rings, value) {
    const rows = new Map();
    let ymin = Infinity, ymax = -Infinity;
    for (const ring of rings) {
      for (let k = 0; k < ring.length; k++) {
        const [ax, ay] = ring[k], [bx, by] = ring[(k + 1) % ring.length];
        if (ay === by) continue;
        const lo = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5));
        const hi = Math.min(this.h - 1, Math.floor(Math.max(ay, by) - 0.5));
        for (let r = lo; r <= hi; r++) {
          const yc = r + 0.5;
          if ((yc < ay) === (yc < by)) continue;
          const x = ax + ((yc - ay) / (by - ay)) * (bx - ax);
          let list = rows.get(r);
          if (!list) rows.set(r, (list = []));
          list.push(x);
          if (r < ymin) ymin = r;
          if (r > ymax) ymax = r;
        }
      }
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      const row = r * this.w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(this.w - 1, Math.floor(xs[k + 1] - 0.5));
        for (let i = a; i <= b; i++) this.data[row + i] = value;
      }
    }
  }

  // a thick line in grid pixels
  line(points, radius, value) {
    const r = Math.max(0.5, radius), r2 = r * r, R = Math.ceil(r);
    for (let k = 0; k + 1 < points.length; k++) {
      const [ax, ay] = points[k], [bx, by] = points[k + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len > 4 * (this.w + this.h)) continue; // a wrapped or broken segment
      const steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.7)));
      for (let s = 0; s <= steps; s++) {
        const cx = ax + ((bx - ax) * s) / steps, cy = ay + ((by - ay) * s) / steps;
        const ci = Math.floor(cx), cj = Math.floor(cy);
        if (ci < -R || cj < -R || ci > this.w + R || cj > this.h + R) continue;
        for (let dj = -R; dj <= R; dj++) {
          const j = cj + dj;
          if (j < 0 || j >= this.h) continue;
          for (let di = -R; di <= R; di++) {
            const i = ci + di;
            if (i < 0 || i >= this.w) continue;
            if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r2 + 0.25) this.data[j * this.w + i] = value;
          }
        }
      }
    }
  }
}

/**
 * Paints vector tiles into a cover grid.
 * tiles: [{ tile: VectorTile, z, x, y }]; toGame(lon, lat) → [x, z];
 * metresPerUnit: for road and river widths. Returns the named places found.
 */
export function paintCover(grid, tiles, toGame, metresPerUnit) {
  const places = [];
  const toPx = (tz, tx, ty, extent) => (pt) => {
    const n = 2 ** tz;
    const lon = ((tx + pt.x / extent) / n) * 360 - 180;
    const yy = Math.PI - (2 * Math.PI * (ty + pt.y / extent)) / n;
    const lat = (180 / Math.PI) * Math.atan(Math.sinh(yy));
    const [gx, gz] = toGame(lon, lat);
    return [(gx - grid.x0) / grid.cell, (gz - grid.z0) / grid.cell];
  };
  const pass = (layerName, pick, kind) => {
    for (const t of tiles) {
      const layer = t.tile.layers[layerName];
      if (!layer) continue;
      const px = toPx(t.z, t.x, t.y, layer.extent);
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const v = pick(f.properties);
        if (!v) continue;
        const geom = f.loadGeometry().map((ring) => ring.map(px));
        if (kind === 'poly' && f.type === 3) grid.fillRings(geom, v.value ?? v);
        else if (kind === 'line' && f.type === 2) for (const l of geom) grid.line(l, v.radius, v.value);
        else if (kind === 'point' && f.type === 1) for (const l of geom) for (const p of l) v.add(p);
      }
    }
  };
  const widthPx = (m) => m / metresPerUnit / grid.cell / 2;

  pass('landcover', (p) => LANDCOVER[p.class] || LANDCOVER[p.subclass] || 0, 'poly');
  pass('landuse', (p) => LANDUSE[p.class] || 0, 'poly');
  pass('water', (p) => (p.class === 'ocean' ? COVER.OCEAN : p.class === 'swimming_pool' ? 0 : COVER.WATER), 'poly');
  pass('waterway', (p) => {
    const r = widthPx(RIVERS[p.class] || 0);
    return r >= 0.35 ? { radius: r, value: COVER.WATER } : null;
  }, 'line');
  pass('transportation', (p) => {
    if (p.brunnel === 'tunnel') return null;
    const r = widthPx(ROADS[p.class] || 0);
    return r >= 0.3 ? { radius: r, value: COVER.ROAD } : null;
  }, 'line');
  pass('place', (p) => {
    const rank = { city: 4, town: 3, village: 2, hamlet: 1, suburb: 1 }[p.class];
    if (!rank || !p.name) return null;
    return { add: (pt) => places.push({ name: p['name:en'] || p['name:latin'] || p.name, local: p.name, kind: p.class, rank, x: pt[0] * grid.cell + grid.x0, z: pt[1] * grid.cell + grid.z0 }) };
  }, 'point');
  return places;
}

// ---------- colours (sRGB) ----------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const PAL = {
  grass: hex('#6f8743'), wood: hex('#3d5129'), woodDark: hex('#2f4021'), urban: hex('#9b958b'),
  water: hex('#3c5f66'), sand: hex('#d3c49c'), rock: hex('#8a847a'), ice: hex('#e6edf2'),
  wetland: hex('#5d6c45'), road: hex('#6c6a66')
};
const CROPS = ['#b9a05a', '#c7ad63', '#8f9a4c', '#6f8a3f', '#9a8458', '#7e6a4a', '#a7a35e', '#5f7d3a'].map(hex);
const ROOFS = ['#9a4e3a', '#7a6f66', '#a35f45', '#5f5a57', '#b8aea0', '#86503e'].map(hex);

/**
 * RGBA pixels for the ground: colour and how strongly it covers the natural
 * ground colour (alpha). Plus a water mask for the shiny water layer.
 * metresPerUnit sets the size of farm fields and houses.
 */
export function paintCoverTexture(grid, metresPerUnit) {
  const { w, h, data, cell } = grid;
  const rgba = new Uint8Array(w * h * 4);
  const water = new Uint8Array(w * h * 4);
  const pxMetres = cell * metresPerUnit;
  const parcel = Math.max(2.5, 260 / pxMetres);  // farm field size in pixels
  const lot = Math.max(1, 14 / pxMetres);        // house lot size in pixels
  const ang = 0.35;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const n = j * w + i, c = data[n], k = n * 4;
      let col = null, a = 255;
      const wx = i * pxMetres, wz = j * pxMetres; // metres, for size-true noise
      const v = valueNoise(wx / 180, wz / 180, 3) * 0.5 + valueNoise(wx / 40, wz / 40, 4) * 0.25;
      switch (c) {
        case COVER.GRASS: col = PAL.grass; a = 90; break;
        case COVER.WOOD: {
          const crown = hash2(Math.floor(wx / 9), Math.floor(wz / 9), 11);
          col = crown < 0.35 ? PAL.woodDark : PAL.wood;
          a = 255;
          col = shade(col, 0.82 + crown * 0.3 + v * 0.15);
          break;
        }
        case COVER.FARM: {
          // a patchwork of fields, slightly turned, each its own crop
          const u = (i * ca - j * sa) / parcel, q = (i * sa + j * ca) / (parcel * 0.6);
          const pid = hash2(Math.floor(u + 0.5 * Math.floor(q)), Math.floor(q), 21);
          col = shade(CROPS[Math.floor(pid * CROPS.length)], 0.9 + v * 0.2);
          const edge = Math.min(u - Math.floor(u), q - Math.floor(q));
          if (parcel > 4 && edge < 0.6 / parcel) col = shade(col, 0.8); // hedges and tracks
          break;
        }
        case COVER.URBAN: {
          const lx = Math.floor(i / lot), ly = Math.floor(j / lot);
          const r = hash2(lx, ly, 31);
          col = r < 0.42 ? ROOFS[Math.floor(hash2(lx, ly, 32) * ROOFS.length)] : r < 0.6 ? hex('#6d7d4a') : PAL.urban;
          col = shade(col, 0.9 + v * 0.2);
          break;
        }
        case COVER.WATER: col = PAL.water; water[k] = water[k + 1] = water[k + 2] = water[k + 3] = 255; break;
        case COVER.OCEAN: col = PAL.water; a = 0; break;
        case COVER.SAND: col = shade(PAL.sand, 0.95 + v * 0.1); break;
        case COVER.ROCK: col = shade(PAL.rock, 0.9 + v * 0.2); a = 220; break;
        case COVER.ICE: col = shade(PAL.ice, 0.96 + v * 0.06); break;
        case COVER.WETLAND: col = shade(PAL.wetland, 0.9 + v * 0.2); a = 200; break;
        case COVER.ROAD: col = PAL.road; break;
        default: {
          // unmapped open country: a faint patchwork, like the fields most of it is
          const u = (i * ca - j * sa) / (parcel * 1.3), q = (i * sa + j * ca) / (parcel * 0.8);
          const pid = hash2(Math.floor(u + 0.5 * Math.floor(q)), Math.floor(q), 23);
          col = shade(CROPS[Math.floor(pid * CROPS.length)], 0.92 + v * 0.16);
          a = 60;
        }
      }
      rgba[k] = col[0]; rgba[k + 1] = col[1]; rgba[k + 2] = col[2]; rgba[k + 3] = a;
    }
  }
  return { rgba, water };
}

function shade(c, f) {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}
