// Realistic houses (scripts/blender/build_houses.py → public/models/houses.glb):
// eight styles with photo-real walls and roofs, picked by region so a town
// in Norway looks Norwegian and one in Italy looks Italian. Window glass is
// marked in the model, so windows reflect the sky by day and some light up
// at night.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import SET from './houseSet.json';
import { COVER } from './cover.js';

export const HOUSE_STYLES = Object.keys(SET);
export const houseSize = (style) => SET[style];

/** 0 by day … 1 at night: how many windows glow. Shared by every house material. */
export const NIGHT = { value: 0 };

let loading = null;
/** Loads the house set once. Resolves to { style: { geometry, material } } (or null). */
export function loadHouses() {
  loading ||= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/houses.glb`).then((gltf) => {
    const kit = {};
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const style = o.name.replace(/^house_/, '');
      if (!SET[style]) return;
      kit[style] = { geometry: o.geometry, material: houseMaterial(o.material) };
    });
    return kit;
  }).catch((err) => { console.warn('Houses not loaded.', err); return null; });
  return loading;
}

function houseMaterial(m) {
  m.vertexColors = false; // the vertex colour is the window mask, used below
  m.roughness = 0.85;
  m.metalness = 0;
  m.side = THREE.FrontSide;
  m.envMapIntensity = 0.6;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.nightGlow = NIGHT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 color;
        varying float vGlass;
        varying float vLit;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlass = color.r;
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(modelMatrix[3].x, 0.0, modelMatrix[3].z);
        #endif
        // some houses have their lights on, and not every window of them
        float hh = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float wh = fract(sin(dot(position.xz * 3.1 + ip.xz, vec2(39.3468, 11.135))) * 24634.6345);
        vLit = step(0.3, hh) * step(0.35, wh);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float nightGlow;
        varying float vGlass;
        varying float vLit;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, vGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * 2.2 * vGlass * vLit * nightGlow;`);
  };
  m.customProgramCacheKey = () => 'house';
  return m;
}

// Which styles a region builds (relative weights).
function regionWeights(lat, lon) {
  if (lat > 56 && lon > -10 && lon < 40) return { nordic: 6, plastered: 2, cottage: 1 };
  if (lat > 49.5 && lat < 61 && lon > -11 && lon < 2) return { brick: 5, plastered: 2, cottage: 2 };
  if (lat > 29 && lat < 45.5 && lon > -10 && lon < 45) return { villa: 6, cottage: 2, plastered: 1 };
  if (lon < -50 && lat > 15) return { clapboard: 6, brick: 2, cottage: 1 };
  if (lat > 43 && lat < 56 && lon > -5 && lon < 30) return { plastered: 4, cottage: 3, brick: 2, villa: 1 };
  return { plastered: 3, cottage: 2, villa: 2, brick: 1, clapboard: 1 };
}

/** A style picker for a place: pick(cover, r) with r in 0 … 1. */
export function stylePicker(lat = 46, lon = 8) {
  const base = regionWeights(lat, lon);
  const table = (extra) => {
    const w = { ...base, ...extra };
    const list = Object.entries(w).filter(([k]) => SET[k]);
    const total = list.reduce((a, [, v]) => a + v, 0);
    return list.map(([k, v]) => [k, v / total]);
  };
  const sum = Object.values(base).reduce((a, b) => a + b, 0);
  const town = table({ block: sum * 0.07 });
  const country = table({ barn: sum * 0.45 });
  return (cover, r) => {
    const t = cover === COVER.URBAN ? town : country;
    let acc = 0;
    for (const [k, p] of t) { acc += p; if (r < acc) return k; }
    return t[t.length - 1][0];
  };
}
