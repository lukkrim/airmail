// Day and night: the sky dome, sun and moon, stars, the lights, and lit
// windows in town. Driven by the real sun position for a time and place.
// Night only changes the look; lift and physics are untouched.
import * as THREE from 'three';
import { BUILDINGS } from './world.js';
import { sunPosition, daylight, glow } from './sun.js';
import { mulberry32 } from '../core/noise.js';

const col = (c) => new THREE.Color(c);
const SKY = {
  day: { top: col('#2c69b4'), horizon: col('#a8c5df') },
  dusk: { top: col('#6d84b6'), horizon: col('#f2c09a') },
  night: { top: col('#0e1834'), horizon: col('#2d3c63') },
  sunGlow: col('#ffb47a')
};
const LIGHT = {
  hemiSky: { day: col('#ffffff'), night: col('#9fb3ea') },
  hemiGround: { day: col('#b7a88a'), night: col('#3a4058') },
  sun: { day: col('#fff4e2'), low: col('#ffb27a') },
  moon: col('#c9d5ff')
};
const RAD = Math.PI / 180;
const DOME_R = 3000;

// Compass direction (azimuth, altitude) to a game-space unit vector, given the
// compass bearing the course faces (game −Z is forward, +X is right).
function toGame(azimuth, altitude, bearing, out) {
  const rel = (azimuth - bearing) * RAD, alt = altitude * RAD;
  return out.set(Math.sin(rel) * Math.cos(alt), Math.sin(alt), -Math.cos(rel) * Math.cos(alt));
}

function discTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.sunDir = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
    this.moonDir = new THREE.Vector3(0.4, 0.6, -0.5).normalize();
    this.day = 1;
    this.glow = 0;
    this.altitude = 45;

    // dome with per-vertex colours, recoloured whenever the time changes
    const geo = new THREE.SphereGeometry(DOME_R, 32, 16);
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    this.dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -2;
    scene.add(this.dome);

    // stars on the upper half of the sky
    {
      const rng = mulberry32(7);
      const n = 900, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, y = 0.06 + rng() * 0.94, r = Math.sqrt(1 - y * y);
        pos[i * 3] = Math.cos(a) * r * (DOME_R - 100);
        pos[i * 3 + 1] = y * (DOME_R - 100);
        pos[i * 3 + 2] = Math.sin(a) * r * (DOME_R - 100);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({
        color: '#fff7e0', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false
      }));
      this.stars.renderOrder = -1;
      scene.add(this.stars);
    }

    // a paper sun and a paper moon
    const sunTex = discTexture((g) => {
      const r = g.createRadialGradient(64, 64, 10, 64, 64, 64);
      r.addColorStop(0, 'rgba(255,248,226,1)'); r.addColorStop(0.42, 'rgba(255,236,190,1)');
      r.addColorStop(0.46, 'rgba(255,214,150,0.5)'); r.addColorStop(1, 'rgba(255,200,140,0)');
      g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    });
    const moonTex = discTexture((g) => {
      g.fillStyle = '#f4efe0'; g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(160,160,170,0.35)';
      for (const [x, y, r] of [[52, 54, 9], [76, 70, 7], [60, 80, 5], [78, 48, 4]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = 'rgba(80,80,90,0.5)'; g.lineWidth = 2; g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); g.stroke();
    });
    const sprite = (map, size) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, fog: false, depthWrite: false, transparent: true }));
      s.scale.setScalar(size);
      s.renderOrder = -1;
      scene.add(s);
      return s;
    };
    this.sunDisc = sprite(sunTex, 420);
    this.moonDisc = sprite(moonTex, 190);

    // lights
    this.hemi = new THREE.HemisphereLight('#ffffff', '#b7a88a', 1.6);
    this.sunLight = new THREE.DirectionalLight('#fff4e2', 2.4);
    this.moonLight = new THREE.DirectionalLight(LIGHT.moon, 0);
    // soft sun shadows in a box that follows the plane
    const small = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const sh = this.sunLight.shadow;
    this.sunLight.castShadow = true;
    sh.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sh.camera, { left: -230, right: 230, top: 230, bottom: -230, near: 10, far: 1400 });
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0004;
    sh.normalBias = 0.8;
    sh.radius = 3;
    sh.intensity = 0.85; // real shadows, softened by the skylight
    this.target = new THREE.Object3D();
    this.sunLight.target = this.target;
    this.moonLight.target = this.target;
    scene.add(this.hemi, this.sunLight, this.moonLight, this.target);

    // haze that thickens with distance, like real air
    scene.fog = new THREE.FogExp2(SKY.day.horizon.clone(), 0.00013);

    // a copy of the dome on its own, for the sea's reflections (main.js)
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(geo, this.dome.material));
    scene.background = SKY.day.horizon.clone();

    this.windows = this.makeWindows();
    scene.add(this.windows);

    this.tmp = new THREE.Vector3();
    this.top = new THREE.Color();
    this.horizon = new THREE.Color();
  }

  // Small warm squares on every wall; they glow after dark.
  makeWindows(which = () => true) {
    const rng = mulberry32(99);
    const quads = [];
    for (const b of BUILDINGS.filter(which)) {
      const floors = Math.max(1, Math.floor(b.h / 5));
      const sides = [
        { nx: 0, nz: 1, len: b.w }, { nx: 0, nz: -1, len: b.w },
        { nx: 1, nz: 0, len: b.d }, { nx: -1, nz: 0, len: b.d }
      ];
      for (const s of sides) {
        const cols = Math.max(1, Math.floor(s.len / 4));
        for (let f = 0; f < floors; f++) {
          for (let c = 0; c < cols; c++) {
            if (rng() < 0.35) continue; // some rooms are dark
            const along = (c + 0.5) / cols - 0.5;
            const y = b.base + 2.2 + f * 5;
            const cx = b.x + (s.nx ? s.nx * (b.w / 2 + 0.06) : along * b.w);
            const cz = b.z + (s.nz ? s.nz * (b.d / 2 + 0.06) : along * b.d);
            quads.push({ cx, cz, y, nx: s.nx, nz: s.nz });
          }
        }
      }
    }
    const pos = new Float32Array(quads.length * 18);
    const hw = 0.8, hh = 1;
    quads.forEach((q, i) => {
      const tx = q.nz, tz = -q.nx; // along the wall
      const c = [
        [q.cx - tx * hw, q.y - hh, q.cz - tz * hw], [q.cx + tx * hw, q.y - hh, q.cz + tz * hw], [q.cx + tx * hw, q.y + hh, q.cz + tz * hw],
        [q.cx - tx * hw, q.y - hh, q.cz - tz * hw], [q.cx + tx * hw, q.y + hh, q.cz + tz * hw], [q.cx - tx * hw, q.y + hh, q.cz - tz * hw]
      ];
      c.forEach((p, k) => pos.set(p, i * 18 + k * 3));
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0, side: THREE.DoubleSide }));
    m.visible = false;
    return m;
  }

  // Once the model kit draws its own lit windows, only these buildings need squares.
  useWindowsFor(which) {
    const old = this.windows;
    this.windows = this.makeWindows(which);
    this.windows.material.opacity = old.material.opacity;
    this.windows.visible = old.visible;
    this.scene.remove(old);
    old.geometry.dispose();
    this.scene.add(this.windows);
  }

  /**
   * Sets the sky for a moment at a place. bearing: the compass direction the
   * course faces, so the sun sits where it really is relative to the throw.
   * forced: 'day' or 'night' overrides the real sun (from settings).
   */
  set(date, place, bearing = 0, forced = null) {
    let sun = sunPosition(date, place.lat, place.lon);
    // "always day" / "always night" from settings: a flattering fixed sun
    if (forced === 'day') sun = { altitude: 48, azimuth: (bearing + 205) % 360 };
    if (forced === 'night') sun = { altitude: -35, azimuth: (bearing + 20) % 360 };
    this.altitude = sun.altitude;
    const d = daylight(sun.altitude);
    const gl = glow(sun.altitude);
    this.day = d;
    this.glow = gl;
    toGame(sun.azimuth, sun.altitude, bearing, this.sunDir);
    // a stand-in moon: opposite the sun, always comfortably up at night
    toGame(sun.azimuth + 180, Math.max(28, -sun.altitude * 0.7), bearing, this.moonDir);

    // sky colours: night → day, with a warm band near sunrise and sunset
    this.top.copy(SKY.night.top).lerp(SKY.day.top, d).lerp(SKY.dusk.top, gl * 0.55);
    this.horizon.copy(SKY.night.horizon).lerp(SKY.day.horizon, d).lerp(SKY.dusk.horizon, gl * 0.7);
    const geo = this.dome.geometry, P = geo.attributes.position, C = geo.attributes.color;
    const c = new THREE.Color(), v = this.tmp;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).normalize();
      const t = Math.max(0, v.y) ** 0.45;
      c.copy(this.horizon).lerp(this.top, t);
      const toward = Math.max(0, v.dot(this.sunDir));
      const halo = gl * toward ** 6 * (1 - t * 0.7);
      if (halo > 0) c.lerp(SKY.sunGlow, Math.min(0.8, halo));
      C.setXYZ(i, c.r, c.g, c.b);
    }
    C.needsUpdate = true;
    this.scene.fog.color.copy(this.horizon);
    this.scene.background.copy(this.horizon);

    // lights: moonlit but readable at night
    this.hemi.color.copy(LIGHT.hemiSky.night).lerp(LIGHT.hemiSky.day, d);
    this.hemi.groundColor.copy(LIGHT.hemiGround.night).lerp(LIGHT.hemiGround.day, d);
    this.hemi.intensity = 0.75 + 0.1 * d; // soft skylight; the sun does the modelling
    this.sunLight.color.copy(LIGHT.sun.day).lerp(LIGHT.sun.low, gl);
    this.sunLight.intensity = 3.9 * d;
    this.moonLight.intensity = 0.75 * (1 - d);

    this.stars.material.opacity = Math.max(0, 1 - d * 1.6);
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.sunDisc.visible = sun.altitude > -3;
    this.moonDisc.visible = d < 0.6;
    this.moonDisc.material.opacity = 1 - d / 0.6;
    this.windows.material.opacity = Math.min(1, (1 - d) * 1.4);
    this.windows.visible = this.windows.material.opacity > 0.02;
  }

  // Keep the sky centred on the camera so it always looks infinitely far away.
  // focus: the point the shadows should cover (the plane).
  follow(camPos, focus = camPos) {
    this.dome.position.copy(camPos);
    this.stars.position.copy(camPos);
    const r = DOME_R - 300;
    this.sunDisc.position.copy(this.sunDir).multiplyScalar(r).add(camPos);
    this.moonDisc.position.copy(this.moonDir).multiplyScalar(r).add(camPos);
    // light comes from where the sun or moon is; the shadow box sits on the plane
    this.target.position.copy(focus);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(650).add(focus);
    this.moonLight.position.copy(this.moonDir).multiplyScalar(650).add(focus);
    this.sunLight.castShadow = this.day > 0.15;
  }
}
