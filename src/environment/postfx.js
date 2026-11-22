// The camera's look: the scene is drawn in full light range, soft contact
// shading darkens corners and the feet of walls and trees, then sun rays
// stream from the sun past hills and trees, bright things glow a little,
// a filmic tone curve maps it to the screen, and a light grade (contrast,
// colour, darker corners) finishes it. Phones skip the extra passes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const SMALL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const VERT = /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Both effects that need the scene's depth, in one pass (so the depth is read
// from one buffer while drawing into the other, never the same one):
// - soft contact shading where things meet (corners, under eaves, the feet
//   of walls and trees), worked out from depth alone so it suits the custom
//   tree, grass and city shaders;
// - sun rays streaming past hills and trees.
const DepthFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    projInv: { value: new THREE.Matrix4() },
    proj: { value: new THREE.Matrix4() },
    resolution: { value: new THREE.Vector2(1, 1) },
    radius: { value: 2.2 },
    aoStrength: { value: 0.75 },
    aoOn: { value: 1 },
    sunPos: { value: new THREE.Vector2(0.5, 0.5) },
    sunCol: { value: new THREE.Color(1, 0.9, 0.75) },
    strength: { value: 0 },
    aspect: { value: 1 }
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform mat4 projInv;
    uniform mat4 proj;
    uniform vec2 resolution;
    uniform float radius;
    uniform float aoStrength;
    uniform float aoOn;
    uniform vec2 sunPos;
    uniform vec3 sunCol;
    uniform float strength;
    uniform float aspect;
    varying vec2 vUv;
    vec3 viewPos(vec2 uv) {
      float d = texture2D(tDepth, uv).r;
      vec4 p = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      return p.xyz / p.w;
    }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec3 col = base.rgb;
      float d0 = texture2D(tDepth, vUv).r;
      if (aoOn > 0.5 && d0 < 0.99999) {
        vec3 P = viewPos(vUv);
        vec2 px = 1.0 / resolution;
        vec3 N = normalize(cross(viewPos(vUv + vec2(px.x, 0.0)) - P, viewPos(vUv + vec2(0.0, px.y)) - P));
        vec4 e = proj * vec4(P + vec3(radius, 0.0, 0.0), 1.0);   // world radius → screen radius
        vec4 c = proj * vec4(P, 1.0);
        float rs = clamp(abs(e.x / e.w - c.x / c.w) * 0.5, 2.0 * px.x, 0.08);
        float ang = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
        float occ = 0.0;
        const int N_S = 8;
        for (int i = 0; i < N_S; i++) {
          float t = (float(i) + 0.5) / float(N_S);
          float a = ang + float(i) * 2.39996;
          vec2 o = vec2(cos(a), sin(a) * resolution.x / resolution.y) * rs * sqrt(t);
          vec3 v = viewPos(vUv + o) - P;
          float l = length(v);
          occ += max(0.0, dot(N, v / max(l, 1e-4)) - 0.15) * (1.0 - smoothstep(radius * 0.6, radius * 1.6, l));
        }
        col *= 1.0 - clamp(occ / float(N_S) * 2.2, 0.0, 1.0) * aoStrength;
      }
      if (strength > 0.0) {
        const int S = 26;
        vec2 stepv = (vUv - sunPos) / float(S) * 0.9;
        vec2 uv = vUv - stepv * fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
        float acc = 0.0, w = 1.0;
        for (int i = 0; i < S; i++) {
          uv -= stepv;
          float sky = step(0.99999, texture2D(tDepth, uv).r);
          vec2 dd = (uv - sunPos) * vec2(aspect, 1.0);
          acc += sky * exp(-dot(dd, dd) * 11.0) * w;
          w *= 0.95;
        }
        col += sunCol * (acc / float(S)) * strength;
      }
      gl_FragColor = vec4(col, base.a);
    }`
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.42 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);                 // a gentle S-curve
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
      c = mix(vec3(l), c, 1.0 + 0.22 * (1.0 - sat));             // a little more colour where it's dull
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * vignette;                           // darker corners
      gl_FragColor = vec4(c, 1.0);
    }`
};

/**
 * Returns { render(), setSize(w, h), setSun(dirWorld, colour, amount) }.
 * Without the passes (phones) render() just draws the scene.
 */
export function makePost(renderer, scene, camera) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  if (SMALL) {
    return { render: () => renderer.render(scene, camera), setSize() {}, setSun() {}, enabled: false, target: null };
  }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
  rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
  const composer = new EffectComposer(renderer, rt);
  // the composer's second target is a clone whose depth texture shares the
  // first one's GPU texture; give it its own, so a pass never reads the depth
  // it is drawing into
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const fx = new ShaderPass(DepthFXShader);
  composer.addPass(fx);
  const ao = fx, rays = fx; // one pass does both
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.18, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));
  // cheap edge smoothing, used instead of multisampling below the top quality
  const fxaa = new ShaderPass(FXAAShader);
  fxaa.enabled = false;
  composer.addPass(fxaa);
  // full-screen passes must not depth-test (the targets keep the scene's depth)
  for (const p of composer.passes) if (p.material) { p.material.depthTest = false; p.material.depthWrite = false; }

  const v = new THREE.Vector3();
  return {
    enabled: true,
    passes: { fx, bloom, composer, fxaa },
    /** Where the scene is drawn (shaders compiled for it match the real frames). */
    target: composer.readBuffer,
    render() {
      // the depth of the scene just drawn (the buffers swap each pass)
      const depth = composer.readBuffer.depthTexture;
      ao.uniforms.tDepth.value = depth;
      ao.uniforms.proj.value.copy(camera.projectionMatrix);
      ao.uniforms.projInv.value.copy(camera.projectionMatrixInverse);
      rays.uniforms.tDepth.value = depth;
      composer.render();
    },
    setSize(w, h) {
      this.w = w; this.h = h;
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      rays.uniforms.aspect.value = w / h;
      const pr = renderer.getPixelRatio();
      ao.uniforms.resolution.value.set(w * pr, h * pr);
      fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    },
    /** Which effects to draw (quality.js). */
    setQuality(q) {
      fx.uniforms.aoOn.value = q.ao ? 1 : 0;
      bloom.enabled = q.bloom;
      // multisampling is costly (it about doubles the frame): FXAA instead below the top level
      const samples = q.msaa || 0;
      fxaa.enabled = samples === 0;
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        if (t.samples !== samples) { t.samples = samples; t.dispose(); }
      }
    },
    /** The sun's direction (world), its colour, and how strong the rays are (0 … 1). */
    setSun(dir, colour, amount) {
      v.copy(dir).multiplyScalar(5000).add(camera.position).project(camera);
      const ahead = v.z < 1;
      rays.uniforms.sunPos.value.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
      const off = Math.max(Math.abs(v.x), Math.abs(v.y));
      rays.uniforms.strength.value = ahead ? amount * 0.9 * Math.max(0, 1 - Math.max(0, off - 1) * 0.6) : 0;
      rays.uniforms.sunCol.value.copy(colour);
    }
  };
}
