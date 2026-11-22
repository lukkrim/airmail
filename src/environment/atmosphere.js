// The air between the camera and the land: blue-grey haze that thickens with
// distance (and glows warm towards the sun), and low mist that settles in
// the valleys. It replaces three's plain fog on every material in the scene,
// so the ground, trees, clouds and houses all fade into the same air.
import * as THREE from 'three';

/** Shared values (the same objects are handed to every material). */
export const AIR = {
  fogSun: { value: new THREE.Vector3(0, 1, 0) },        // unit vector towards the sun
  fogSunColor: { value: new THREE.Color('#ffd7a8') },    // the sun's colour in the haze
  fogMist: { value: new THREE.Vector4(0, 30, 0.0, 1) },  // level, thickness, density, brightness
  // hills and towers shading the land (terrainShadow.js)
  sunMap: { value: null },
  sunRect: { value: new THREE.Vector4(0, 0, 1, 1) },     // x0, z0, 1/width, 1/depth
  sunOn: { value: 0 },
  // time and wind (x, z), for things that move: swaying trees, surf
  airTime: { value: 0 },
  airWind: { value: new THREE.Vector2() }
};

const VERT_PARS = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif
`;
const VERT = /* glsl */`
#ifdef USE_FOG
  vFogWorld = (inverse(viewMatrix) * mvPosition).xyz;
#endif
`;
const FRAG_PARS = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogWorld;
  #ifndef AIR_SUN
  #define AIR_SUN
  uniform vec3 fogSun;
  uniform vec3 fogSunColor;
  #endif
  uniform vec4 fogMist;
  uniform sampler2D sunMap;
  uniform vec4 sunRect;
  uniform float sunOn;
  // 1 where the sun reaches this point past every hill and tower, 0 in their shadow
  float landSun(vec3 p) {
    if (sunOn < 0.5) return 1.0;
    vec2 uv = (p.xz - sunRect.xy) * sunRect.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
    float s = texture2D(sunMap, uv).r;
    return smoothstep(-1.5, 1.5, p.y - s + 2.5);
  }
  float airHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float airNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(airHash(i), airHash(i + vec2(1.0, 0.0)), f.x), mix(airHash(i + vec2(0.0, 1.0)), airHash(i + 1.0), f.x), f.y);
  }
#endif
`;
// Mist density falls off as exp(-height above the mist level / thickness);
// this is its exact integral along the view ray.
const FRAG = /* glsl */`
#ifdef USE_FOG
  {
    vec3 fv = vFogWorld - cameraPosition;
    float fd = max(length(fv), 1e-3);
    vec3 vd = fv / fd;
    float sunAmt = pow(max(dot(vd, fogSun), 0.0), 5.0);
    #ifdef FOG_EXP2
      float haze = 1.0 - exp(-fogDensity * fogDensity * fd * fd);
    #else
      float haze = smoothstep(fogNear, fogFar, fd);
    #endif
    vec3 hazeCol = mix(fogColor, fogSunColor, sunAmt * 0.55);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, haze);
    if (fogMist.z > 0.0) {
      float H = fogMist.y;
      float y0 = max(cameraPosition.y - fogMist.x, 0.0), y1 = max(vFogWorld.y - fogMist.x, 0.0);
      float dy = y1 - y0;
      float along = abs(dy) > 0.05 ? H * (exp(-y0 / H) - exp(-y1 / H)) / dy : exp(-y0 / H);
      // patchy: thicker in some hollows than others
      vec2 mp = vFogWorld.xz / 420.0;
      float mistPatch = smoothstep(0.25, 0.8, airNoise(mp) * 0.65 + airNoise(mp * 2.7 + 3.1) * 0.35);
      float mist = 1.0 - exp(-fogMist.z * fd * along * (0.25 + 1.5 * mistPatch));
      vec3 mistCol = mix(mix(fogColor, vec3(1.0), 0.55) * fogMist.w, fogSunColor * fogMist.w * 1.2, sunAmt * 0.45);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, mistCol, mist * 0.8);
    }
  }
#endif
`;

// the sun (the first directional light) dims in the shadow of hills and towers
const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  `getDirectionalLightInfo( directionalLight, directLight );
    #if defined( USE_FOG ) && UNROLLED_LOOP_INDEX == 0
      directLight.color *= landSun(vFogWorld);
    #endif`);
if (LIGHTS === THREE.ShaderChunk.lights_fragment_begin) console.warn('Land shadows: three.js light chunk changed; hills will not shade.');

const DONE = new WeakSet();
/** Gives one material the haze and mist (keeps any onBeforeCompile it has). */
export function useAtmosphere(mat) {
  if (!mat || DONE.has(mat) || mat.fog === false || mat.isShaderMaterial || mat.isLineBasicMaterial || mat.isPointsMaterial) return;
  DONE.add(mat);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, AIR);
    sh.vertexShader = sh.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n' + VERT_PARS)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n' + FRAG_PARS)
      .replace('#include <fog_fragment>', FRAG)
      .replace('#include <lights_fragment_begin>', LIGHTS);
  };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|air'; };
  mat.needsUpdate = true;
}

/** Every material under root. Cheap to call again: done ones are skipped. */
export function applyAtmosphere(root) {
  root.traverse((o) => {
    const m = o.material;
    if (Array.isArray(m)) m.forEach(useAtmosphere);
    else useAtmosphere(m);
    if (o.customDepthMaterial) DONE.add(o.customDepthMaterial);
  });
}
