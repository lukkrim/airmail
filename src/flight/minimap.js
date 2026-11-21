import { BOUNDS, groundHeight, coverAt, COVER, THERMALS, RAIN_CLOUDS, thermalCenter, LAUNCH, SEA_LEVEL } from '../environment/world.js';
import { CONFIG } from '../core/config.js';

const PX_PER_UNIT = 0.05;

// Course-up overview: plane, trail, thermals (orange), rain (slate), wind arrow.
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = this.renderBackground();
    this.tmp = { x: 0, z: 0 };
  }

  /** Redraws the map after the course changes. */
  refresh() { this.bg = this.renderBackground(); }

  renderBackground() {
    const W = Math.round((BOUNDS.maxX - BOUNDS.minX) * PX_PER_UNIT);
    const H = Math.round((BOUNDS.maxZ - BOUNDS.minZ) * PX_PER_UNIT);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = BOUNDS.minX + (i + 0.5) / PX_PER_UNIT;
        const z = BOUNDS.minZ + (j + 0.5) / PX_PER_UNIT; // row 0 = far end, so the course points up
        const h = groundHeight(x, z);
        const c = coverAt(x, z);
        let r, gg, b;
        if (h < SEA_LEVEL || c === COVER.OCEAN) [r, gg, b] = [143, 195, 214];
        else if (c === COVER.WATER) [r, gg, b] = [120, 172, 196];
        else if (c === COVER.FARM) [r, gg, b] = [222, 196, 120];
        else if (c === COVER.URBAN || c === COVER.ROAD) [r, gg, b] = [196, 176, 160];
        else if (c === COVER.WOOD) [r, gg, b] = [128, 160, 110];
        else if (c === COVER.SAND || h < 2.2) [r, gg, b] = [234, 220, 178];
        else if (c === COVER.ICE) [r, gg, b] = [240, 244, 246];
        else if (c === COVER.ROCK || h > 150) [r, gg, b] = [190, 184, 200];
        else {
          const t = Math.min(1, Math.max(0, (h - 10) / 120));
          r = 190 - 50 * t; gg = 212 - 40 * t; b = 150 - 30 * t;
        }
        const k = (j * W + i) * 4;
        img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  draw(plane, trailPoints, wind, heading) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const viewW = 800, viewH = viewW * (H / W);
    const scale = W / viewW;
    // keep the plane in the lower part so you see what's ahead
    const cx = plane.x, cz = plane.z - viewH * 0.2;
    const toX = (x) => (x - cx) * scale + W / 2;
    const toY = (z) => (z - cz) * scale + H / 2;

    ctx.fillStyle = 'rgb(143,195,214)';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    const sx = (cx - viewW / 2 - BOUNDS.minX) * PX_PER_UNIT;
    const sy = (cz - viewH / 2 - BOUNDS.minZ) * PX_PER_UNIT;
    ctx.drawImage(this.bg, sx, sy, viewW * PX_PER_UNIT, viewH * PX_PER_UNIT, 0, 0, W, H);

    // thermals at mid height, drifted by the wind
    for (const th of THERMALS) {
      thermalCenter(th, th.base + 60, wind, this.tmp);
      ctx.beginPath();
      ctx.arc(toX(this.tmp.x), toY(this.tmp.z), CONFIG.lift.thermalRadius * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(243,138,40,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(214,100,20,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (const rc of RAIN_CLOUDS) {
      ctx.beginPath();
      ctx.arc(toX(rc.x), toY(rc.z), CONFIG.lift.rainRadius * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(70,86,120,0.4)';
      ctx.fill();
    }

    // launch point and trail
    ctx.fillStyle = '#1d2433';
    ctx.fillRect(toX(LAUNCH.x) - 3, toY(LAUNCH.z) - 3, 6, 6);
    if (trailPoints.length > 1) {
      ctx.beginPath();
      trailPoints.forEach(([x, z], i) => (i ? ctx.lineTo(toX(x), toY(z)) : ctx.moveTo(toX(x), toY(z))));
      ctx.strokeStyle = '#c8102e';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // plane arrow
    ctx.save();
    ctx.translate(toX(plane.x), toY(plane.z));
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#1d2433';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // wind arrow (top-left)
    if (wind.speed > 0.05) {
      const a = Math.atan2(wind.x, -wind.z);
      const len = 8 + (wind.speed / CONFIG.wind.maxStrength) * 12;
      ctx.save();
      ctx.translate(22, 24);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
      ctx.rotate(a);
      ctx.strokeStyle = '#1d2433';
      ctx.fillStyle = '#1d2433';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, len / 2); ctx.lineTo(0, -len / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -len / 2 - 4); ctx.lineTo(4, -len / 2 + 2); ctx.lineTo(-4, -len / 2 + 2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}
