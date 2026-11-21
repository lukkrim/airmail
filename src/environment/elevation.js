// Real ground heights from the free AWS Terrain Tiles (Terrarium PNGs, no key).
// Each pixel stores metres above sea level (negative under the sea):
//   height = R × 256 + G + B / 256 − 32768
// https://registry.opendata.aws/terrain-tiles/
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const SIZE = 256;

const tileX = (lon, z) => ((lon + 180) / 360) * 2 ** z;
function tileY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

// Picks a zoom whose pixels are about `metres` across at this latitude.
export function zoomFor(lat, metres) {
  const z = Math.ceil(Math.log2((156543 * Math.cos((lat * Math.PI) / 180)) / metres));
  return Math.max(6, Math.min(12, z));
}

async function loadTile(z, x, y, signal) {
  const res = await fetch(TILE_URL(z, x, y), { signal, mode: 'cors' });
  if (!res.ok) throw new Error(`elevation tile ${z}/${x}/${y}: ${res.status}`);
  // keep the raw bytes: no colour management, no premultiplying
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

/**
 * Loads every tile covering the given points (lat/lon pairs) at zoom z and
 * returns { heightAt(lat, lon), zoom, tiles } with bilinear sampling, in metres.
 */
export async function loadElevation(points, z, { signal } = {}) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    const tx = tileX(p.lon, z), ty = tileY(p.lat, z);
    x0 = Math.min(x0, Math.floor(tx)); x1 = Math.max(x1, Math.floor(tx));
    y0 = Math.min(y0, Math.floor(ty)); y1 = Math.max(y1, Math.floor(ty));
  }
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
  if (nx * ny > 36) throw new Error(`too many elevation tiles (${nx}×${ny})`);
  const W = nx * SIZE, H = ny * SIZE;
  const grid = new Float32Array(W * H);
  const jobs = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      jobs.push(loadTile(z, x0 + i, y0 + j, signal).then((px) => {
        for (let r = 0; r < SIZE; r++) {
          const row = (j * SIZE + r) * W + i * SIZE;
          for (let c = 0; c < SIZE; c++) {
            const k = (r * SIZE + c) * 4;
            grid[row + c] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
          }
        }
      }));
    }
  }
  await Promise.all(jobs);

  function heightAt(lat, lon) {
    const fx = (tileX(lon, z) - x0) * SIZE - 0.5;
    const fy = (tileY(lat, z) - y0) * SIZE - 0.5;
    const ix = Math.max(0, Math.min(W - 2, Math.floor(fx)));
    const iy = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - ix)), ty = Math.max(0, Math.min(1, fy - iy));
    const k = iy * W + ix;
    const a = grid[k] + (grid[k + 1] - grid[k]) * tx;
    const b = grid[k + W] + (grid[k + W + 1] - grid[k + W]) * tx;
    return a + (b - a) * ty;
  }
  return { heightAt, zoom: z, tiles: nx * ny };
}
