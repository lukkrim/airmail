// Keeps the frame rate smooth on any computer: it watches how long frames
// take and steps the picture's quality down (a lower drawing resolution,
// then fewer effects) when they're slow, and back up when there's room.
// Each level: pr = drawing resolution (× CSS pixels), ao = soft contact
// shading, bloom, mirror = how often the water's mirror is redrawn (0 = off),
// msaa = multisampled edges (else FXAA, much cheaper).

const SMALL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

// px: most pixels drawn (millions), so a big window doesn't cost more than a small one
const DESKTOP = [
  { pr: 1.5, px: 3.2, ao: true, bloom: true, mirror: 1, msaa: 4 },
  { pr: 1.25, px: 1.6, ao: true, bloom: true, mirror: 2 },
  { pr: 1.0, px: 1.4, ao: false, bloom: true, mirror: 2 },
  { pr: 0.85, px: 1.0, ao: false, bloom: false, mirror: 3 },
  { pr: 0.7, px: 0.7, ao: false, bloom: false, mirror: 0 },
  { pr: 0.6, px: 0.5, ao: false, bloom: false, mirror: 0 }
];
const PHONE = [
  { pr: 1.5, px: 1.6, ao: false, bloom: false, mirror: 0 },
  { pr: 1.25, px: 1.1, ao: false, bloom: false, mirror: 0 },
  { pr: 1.0, px: 0.8, ao: false, bloom: false, mirror: 0 },
  { pr: 0.8, px: 0.55, ao: false, bloom: false, mirror: 0 },
  { pr: 0.65, px: 0.4, ao: false, bloom: false, mirror: 0 }
];

export class Quality {
  /** apply(level) is called whenever the level changes (and once now). */
  constructor(apply) {
    // never draw finer than the screen, nor than 1.5 × (the gain past that is small)
    this.levels = (SMALL ? PHONE : DESKTOP).map((l) => ({ ...l, pr: Math.min(l.pr, DPR) }));
    this.apply = apply;
    const forced = new URLSearchParams(location.search).get('quality');
    this.locked = forced !== null && Number.isFinite(+forced);
    this.i = this.locked ? Math.max(0, Math.min(this.levels.length - 1, +forced)) : 1;
    this.ceiling = 0;        // the best level allowed (raised again slowly)
    this.floor = this.levels.length - 1; // the lowest worth trying (see frame)
    this.floorFor = 0;
    this.tried = null;
    this.reset();
    this.apply(this.level, this.i);
  }

  get level() { return this.levels[this.i]; }

  /** The drawing resolution for a window of w × h CSS pixels at the current level. */
  pixelRatio(w = window.innerWidth, h = window.innerHeight) {
    const l = this.level;
    return Math.max(0.4, Math.min(l.pr, Math.sqrt((l.px * 1e6) / Math.max(1, w * h))));
  }

  /** Forget the recent frames (after a course change, a pause, a resize). */
  reset() {
    this.sum = 0; this.n = 0; this.slow = 0; this.quiet = 2; this.good = 0;
  }

  /** dt: seconds since the last frame. */
  frame(dt) {
    if (this.locked || typeof document !== 'undefined' && document.hidden) return;
    if (this.quiet > 0) { this.quiet -= dt; return; }     // let things settle first
    if (dt > 0.25) return;                                 // a hitch (loading), not the steady rate
    this.sum += dt; this.n++;
    if (this.sum < 1.2) return;                            // judge over about a second
    const ms = (this.sum / this.n) * 1000;
    this.sum = 0; this.n = 0;
    this.ms = ms;
    // did the last step down help? If not, the frame rate is capped by
    // something else (a battery saver, a hidden window): undo it and stop
    if (this.tried) {
      const { from, before } = this.tried;
      this.tried = null;
      if (ms > before * 0.88) { this.floor = from; this.floorFor = 50; this.set(from); return; }
    }
    if (this.floorFor > 0) this.floorFor--; else this.floor = this.levels.length - 1;
    if (ms > 21 && this.i < Math.min(this.floor, this.levels.length - 1)) { // under ~48 fps: step down now
      this.tried = { from: this.i, before: ms };
      this.set(this.i + 1);
      this.ceiling = this.i;                               // and stay here a while
      this.good = 0;
    } else if (ms < 14.5 && this.i > this.ceiling) {        // easily over 60: maybe step up
      if (++this.good >= 6) { this.set(this.i - 1); this.good = 0; }
    } else this.good = 0;
    // every minute or so, allow trying one level higher again
    if (++this.slow > 50) { this.slow = 0; this.ceiling = Math.max(0, this.ceiling - 1); }
  }

  set(i) {
    if (i === this.i) return;
    this.i = i;
    this.quiet = 1.5;
    this.apply(this.level, this.i);
  }
}
