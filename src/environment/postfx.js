// The camera's look: the scene is drawn in full light range, then sun rays
// stream from the sun past hills and trees, bright things glow a little,
// a filmic tone curve maps it to the screen, and a light grade (contrast,
// colour, darker corners) finishes it. Phones skip the extra passes.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SMALL = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const RaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    sunPos: { value: new THREE.Vector2(0.5, 0.5) },
    sunCol: { value: new THREE.Color(1, 0.9, 0.75) },
    strength: { value: 0 },
    aspect: { value: 1 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 sunPos;
    uniform vec3 sunCol;
    uniform float strength;
    uniform float aspect;
    varying vec2 vUv;
    const int S = 40;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (strength <= 0.0) { gl_FragColor = base; return; }
      vec2 stepv = (vUv - sunPos) / float(S) * 0.9;
      vec2 uv = vUv;
      float acc = 0.0, w = 1.0;
      float dither = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
      uv -= stepv * dither;
      for (int i = 0; i < S; i++) {
        uv -= stepv;
        float sky = step(0.99999, texture2D(tDepth, uv).r);
        vec2 dd = (uv - sunPos) * vec2(aspect, 1.0);
        acc += sky * exp(-dot(dd, dd) * 11.0) * w;
        w *= 0.965;
      }
      acc /= float(S);
      gl_FragColor = vec4(base.rgb + sunCol * acc * strength, base.a);
    }`
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.42 } },
  vertexShader: RaysShader.vertexShader,
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
    return { render: () => renderer.render(scene, camera), setSize() {}, setSun() {}, enabled: false };
  }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const rays = new ShaderPass(RaysShader);
  composer.addPass(rays);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.18, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));

  const v = new THREE.Vector3();
  return {
    enabled: true,
    render() {
      rays.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      composer.render();
    },
    setSize(w, h) {
      composer.setSize(w, h);
      rays.uniforms.aspect.value = w / h;
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
