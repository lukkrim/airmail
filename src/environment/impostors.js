// Realistic trees drawn cheaply: each tree is one quad that always faces the
// camera and shows a photo of a detailed Poly Haven tree (baked in Blender by
// scripts/blender/bake_impostors.py) from the direction nearest the camera's.
// 64 views per tree, from the side round to straight down, so trees look
// right from the throw hill and from high above. The views come with
// normals, so the sun lights them like real trees, and they cast shadows.
import * as THREE from 'three';
import SET from './impostorSet.json';
import { AIR } from './atmosphere.js';

const DIR = `${import.meta.env.BASE_URL}models/impostors/`;
const SMALL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

let cache = null;
/** Loads each tree's atlases once. Returns { name: { meta, albedo, normal } }. */
export function impostorTextures() {
  if (cache) return cache;
  const loader = new THREE.TextureLoader();
  const load = (file, srgb) => {
    const t = loader.load(DIR + file);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  cache = {};
  for (const [name, meta] of Object.entries(SET)) {
    cache[name] = { meta, albedo: load(`${name}${SMALL ? '_s' : ''}.webp`, true), normal: load(`${name}_n.webp`, false) };
  }
  return cache;
}

// Shared shader pieces. The instance matrix holds the tree's base position,
// its turn about the vertical, and its scale (model metres → game units).
const VERT_HEAD = /* glsl */`
  uniform vec4 impA;   // centre.xyz (model, y up from the base), radius
  uniform vec2 impB;   // half width of a frame, grid size
  uniform float airTime;
  uniform vec2 airWind;
  varying vec2 vQuad;
  varying vec4 vCell;
  varying vec2 vMix;
  varying vec2 vTurn;
`;
const VERT_BODY = /* glsl */`
  float iScale = length(instanceMatrix[1].xyz);
  vec2 turn = vec2(instanceMatrix[0].x, -instanceMatrix[0].z) / iScale; // cos, sin
  vTurn = turn;
  vec3 iBase = instanceMatrix[3].xyz;
  vec3 c = impA.xyz * iScale;
  vec3 centreW = iBase + vec3(turn.x * c.x + turn.y * c.z, c.y, -turn.y * c.x + turn.x * c.z);
  vec3 dW = normalize(cameraPosition - centreW);
  // direction in the tree's own frame → cell in the hemi-octahedral grid
  vec3 dO = vec3(turn.x * dW.x - turn.y * dW.z, max(dW.y, 0.0), turn.y * dW.x + turn.x * dW.z);
  dO /= (abs(dO.x) + abs(dO.y) + abs(dO.z));
  vec2 oct = vec2(dO.x + dO.z, dO.x - dO.z);
  float N = impB.y;
  vec2 g = clamp((oct * 0.5 + 0.5) * N - 0.5, vec2(0.0), vec2(N - 1.0));
  vec2 g0 = floor(g);
  vCell = vec4(g0, min(g0 + 1.0, vec2(N - 1.0)));
  vMix = g - g0;
  // the quad: level horizontal axis, like the baked views
  vec3 upW = abs(dW.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, -1.0);
  vec3 right = normalize(cross(upW, dW));
  vec3 up = cross(dW, right);
  vQuad = uv;
  vec3 bbWorld = centreW + right * position.x * 2.0 * impB.x * iScale + up * position.y * 2.0 * impA.w * iScale
    + dW * impB.x * iScale * 0.6;
  // the crown sways in the wind (more at the top, each tree in its own time)
  float hq = clamp(position.y + 0.5, 0.0, 1.0);
  float ph = iBase.x * 0.13 + iBase.z * 0.17;
  float gust = sin(airTime * 1.1 + ph) * 0.6 + sin(airTime * 2.3 + ph * 1.7) * 0.3;
  bbWorld.xz += (airWind * 0.012 * (1.0 + gust) + vec2(cos(ph), sin(ph)) * gust * 0.035) * hq * hq * impA.w * iScale;
`;
// Light shining through leaves when you look towards the sun.
export const GLOW_GLSL = /* glsl */`
  #ifndef AIR_SUN
  #define AIR_SUN
  uniform vec3 fogSun;
  uniform vec3 fogSunColor;
  #endif
  vec3 leafGlow(vec3 albedo, vec3 viewPos, float amount) {
    vec3 L = normalize((viewMatrix * vec4(fogSun, 0.0)).xyz);
    float back = pow(max(dot(normalize(viewPos), L), 0.0), 4.0); // viewPos: camera → this point
    return albedo * fogSunColor * back * amount * smoothstep(-0.05, 0.15, fogSun.y);
  }
`;
const FRAG_HEAD = /* glsl */`
  uniform sampler2D impAlbedo;
  uniform sampler2D impNormal;
  uniform vec2 impB;
  varying vec2 vQuad;
  varying vec4 vCell;
  varying vec2 vMix;
  varying vec2 vTurn;
  vec2 cellUv(vec2 cell) { return (cell + clamp(vQuad, 0.002, 0.998)) / impB.y; }
  vec4 impSample(sampler2D t) {
    #ifdef IMP_BLEND
    vec4 a = texture2D(t, cellUv(vCell.xy)), b = texture2D(t, cellUv(vCell.zy));
    vec4 c = texture2D(t, cellUv(vCell.xw)), d = texture2D(t, cellUv(vCell.zw));
    vec4 w = vec4((1.0 - vMix.x) * (1.0 - vMix.y), vMix.x * (1.0 - vMix.y), (1.0 - vMix.x) * vMix.y, vMix.x * vMix.y);
    vec4 aw = w * vec4(a.a, b.a, c.a, d.a);
    float at = aw.x + aw.y + aw.z + aw.w;
    vec3 rgb = (a.rgb * aw.x + b.rgb * aw.y + c.rgb * aw.z + d.rgb * aw.w) / max(at, 1e-4);
    return vec4(rgb, dot(w, vec4(a.a, b.a, c.a, d.a)));
    #else
    vec2 cell = floor(vCell.xy + vMix + 0.5);
    cell = clamp(cell, vec2(0.0), vec2(impB.y - 1.0));
    return texture2D(t, cellUv(cell));
    #endif
  }
`;

function uniformsFor(sp) {
  const m = sp.meta;
  return {
    impA: { value: new THREE.Vector4(m.centre[0], m.centre[1], m.centre[2], m.radius) },
    impB: { value: new THREE.Vector2(m.halfWidth, m.grid) },
    impAlbedo: { value: sp.albedo },
    impNormal: { value: sp.normal },
    airTime: AIR.airTime,
    airWind: AIR.airWind
  };
}

/** The lit material for one tree kind (works with InstancedMesh). */
export function impostorMaterial(sp) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, alphaTest: 0.45, side: THREE.DoubleSide });
  mat.alphaToCoverage = true;
  mat.defines = SMALL ? {} : { IMP_BLEND: 1 };
  const U = uniformsFor(sp);
  mat.customProgramCacheKey = () => 'impostor';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, { fogSun: AIR.fogSun, fogSunColor: AIR.fogSunColor });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY)
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(bbWorld, 1.0);\ngl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(bbWorld, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD + GLOW_GLSL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += leafGlow(diffuseColor.rgb, -vViewPosition, 0.9);')
      .replace('#include <map_fragment>', `
        vec4 impCol = impSample(impAlbedo);
        diffuseColor.rgb *= impCol.rgb;
        diffuseColor.a = impCol.a;
      `)
      .replace('#include <normal_fragment_begin>', `
        float faceDirection = 1.0;
        vec3 nb = impSample(impNormal).xyz * 2.0 - 1.0;          // Blender axes, tree unturned
        vec3 nO = vec3(nb.x, nb.z, -nb.y);
        vec3 nW = vec3(vTurn.x * nO.x + vTurn.y * nO.z, nO.y, -vTurn.y * nO.x + vTurn.x * nO.z);
        nW = normalize(mix(nW, vec3(0.0, 1.0, 0.0), 0.2));      // a little softer, like a crown
        vec3 normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        vec3 nonPerturbedNormal = normal;
      `);
  };
  return mat;
}

/** The shadow-casting material: the same quad, seen from the sun. */
export function impostorDepthMaterial(sp) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.45, side: THREE.DoubleSide });
  const U = uniformsFor(sp);
  mat.customProgramCacheKey = () => 'impostorDepth';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_BODY)
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(bbWorld, 1.0);\ngl_Position = projectionMatrix * mvPosition;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <alphamap_fragment>', 'diffuseColor.a = impSample(impAlbedo).a;');
  };
  return mat;
}

/** A 1 × 1 quad (−0.5 … 0.5) with uv 0 … 1, shared by every impostor. */
export function impostorQuad() {
  return new THREE.PlaneGeometry(1, 1);
}

/** Model height in metres, to scale a tree to a wanted height. */
export const impostorHeight = (name) => SET[name].height;
