// Prints vertical air at a few known spots: node scripts/sim/lift-check.mjs
import { verticalAir, surfaceHeight, THERMALS, RAIN_CLOUDS } from '../../src/environment/world.js';
const W = (dirDeg, speed) => { const r = dirDeg * Math.PI / 180; return { speed, x: speed * Math.sin(r), z: -speed * Math.cos(r) }; };
const at = (label, x, z, agl, wind) => {
  const parts = {};
  const y = surfaceHeight(x, z) + agl;
  const w = verticalAir(x, y, z, wind, parts);
  console.log(label.padEnd(48), `total ${w.toFixed(2).padStart(6)}  thermal ${parts.thermal.toFixed(2).padStart(6)}  ridge ${parts.ridge.toFixed(2).padStart(6)}  rain ${parts.rain.toFixed(2).padStart(6)}`);
};
const th = THERMALS[0], rc = RAIN_CLOUDS[0];
at('field thermal core, calm, 40 m up', th.x, th.z, 40, W(0, 0));
at('field thermal core, calm, 200 m up', th.x, th.z, 200, W(0, 0));
at('town thermal, calm, 40 m up', THERMALS[4].x, THERMALS[4].z, 40, W(0, 0));
at('rain cloud centre, 60 m up', rc.x, rc.z, 60, W(0, 0));
at('hill (-260,-1050) east slope, wind from right', -260 + 80, -1050, 15, W(-90, 8));
at('hill (-260,-1050) west slope (lee), wind from right', -260 - 80, -1050, 15, W(-90, 8));
at('mountain face x=-700, wind from right, 20 m up', -700, -1500, 20, W(-90, 8));
at('launch hill front, headwind 6', 0, -60, 10, W(180, 6));
at('launch hill front, tailwind 8 (lee)', 0, -60, 10, W(0, 8));
