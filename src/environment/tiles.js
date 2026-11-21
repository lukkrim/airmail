// Map tiles for real-land courses, with an on-device cache so a day's course
// can be rebuilt offline. Works on the page, in a worker and in Node (the
// pacing scripts pass their own PNG decoder).
//
//   Elevation: AWS Terrain Tiles, Terrarium PNG (free, no key)
//              height = R × 256 + G + B / 256 − 32768 metres
//   Land cover: OpenFreeMap vector tiles (OpenStreetMap data, OpenMapTiles schema)
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const TERRAIN = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const OFM_INDEX = 'https://tiles.openfreemap.org/planet';
const CACHE = 'airmail-tiles-v1';

export const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export function tileY(lat, z) {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
export function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
export const wrapX = (x, z) => ((x % 2 ** z) + 2 ** z) % 2 ** z;

// fetch with the Cache Storage API when there is one (page and worker)
async function cachedFetch(url, signal) {
  const caches = globalThis.caches;
  let cache = null;
  if (caches) {
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(url);
      if (hit) return hit;
    } catch { cache = null; }
  }
  const res = await fetch(url, { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  if (cache) { try { await cache.put(url, res.clone()); } catch { /* storage full or blocked */ } }
  return res;
}

// PNG → RGBA bytes. Page and worker: createImageBitmap + a canvas.
let decodePng = async (blob) => {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  return g.getImageData(0, 0, c.width, c.height).data;
};
/** Node scripts pass their own decoder: (ArrayBuffer) → RGBA bytes (256 × 256). */
export function setPngDecoder(fn) { decodePng = async (blob) => fn(await blob.arrayBuffer()); }

const memo = new Map(); // url → promise, so a rebuild for a new aim reuses tiles
function remember(key, make) {
  if (!memo.has(key)) {
    const p = make();
    memo.set(key, p);
    p.catch(() => memo.delete(key));
    if (memo.size > 400) memo.delete(memo.keys().next().value);
  }
  return memo.get(key);
}

/** One elevation tile as a Float32Array of 256 × 256 metres. */
export function elevationTile(z, x, y, signal) {
  return remember(`e/${z}/${x}/${y}`, async () => {
    const res = await cachedFetch(TERRAIN(z, wrapX(x, z), y), signal);
    const px = await decodePng(await res.blob());
    const out = new Float32Array(256 * 256);
    for (let i = 0, k = 0; i < out.length; i++, k += 4) out[i] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
    return out;
  });
}

let ofmTemplate = null;
async function vectorTemplate(signal) {
  if (!ofmTemplate) {
    ofmTemplate = (async () => {
      // the index names this week's tile set, so ask the network first and
      // fall back to the last saved index when offline
      let cache = null;
      try { cache = globalThis.caches ? await caches.open(CACHE) : null; } catch { cache = null; }
      let res;
      try {
        res = await fetch(OFM_INDEX, { signal, mode: 'cors' });
        if (!res.ok) throw new Error(`tile index: ${res.status}`);
        if (cache) { try { await cache.put(OFM_INDEX, res.clone()); } catch { /* full */ } }
      } catch (err) {
        res = cache && (await cache.match(OFM_INDEX));
        if (!res) throw err;
      }
      const json = await res.json();
      return json.tiles[0];
    })();
    ofmTemplate.catch(() => { ofmTemplate = null; });
  }
  return ofmTemplate;
}

/** One land-cover tile, parsed (layers → features with geometry in tile units). */
export function vectorTile(z, x, y, signal) {
  return remember(`v/${z}/${x}/${y}`, async () => {
    const tpl = await vectorTemplate(signal);
    const url = tpl.replace('{z}', z).replace('{x}', wrapX(x, z)).replace('{y}', y);
    const res = await cachedFetch(url, signal);
    return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
  });
}
