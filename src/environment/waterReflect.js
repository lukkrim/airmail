// Water that mirrors the hills, trees, towns and the plane: the scene is drawn
// a second time, at half size, from a camera mirrored under the water's
// level, and the sea and lakes blend that in by how glancing the view is
// (Fresnel), rippled by their wave normals. One mirror height per frame (the
// water the camera sees most); desktop only.
import * as THREE from 'three';

/** Shared with the water materials (worldView.js). */
export const REFL = {
  reflMap: { value: null },
  reflMatrix: { value: new THREE.Matrix4() },
  reflOn: { value: 0 },
  reflLevel: { value: 0 }
};

/** GLSL for a water material: mixes the mirror in after lighting. */
export function useReflection(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, REFL);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D reflMap;
        uniform mat4 reflMatrix;
        uniform float reflOn;
        uniform float reflLevel;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        #ifdef USE_FOG
        if (reflOn > 0.5) {
          vec4 rc = reflMatrix * vec4(vFogWorld.x, reflLevel, vFogWorld.z, 1.0);
          vec2 ruv = rc.xy / rc.w + normal.xz * 0.045;
          vec3 V = normalize(cameraPosition - vFogWorld);
          float cosT = clamp(abs(V.y), 0.0, 1.0);
          float fres = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
          // water a little off the mirror's height still borrows it, more faintly
          float near = 1.0 - smoothstep(1.5, 12.0, abs(vFogWorld.y - reflLevel));
          vec3 refl = texture2D(reflMap, clamp(ruv, 0.001, 0.999)).rgb;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, refl * 0.92, clamp(fres * 1.15 + 0.12, 0.0, 0.92) * near);
        }
        #endif`);
  };
  const key = mat.customProgramCacheKey;
  mat.customProgramCacheKey = function () { return (key ? key.call(this) : '') + '|refl'; };
}

export class WaterReflection {
  constructor(renderer, scale = 0.5) {
    this.renderer = renderer;
    this.scale = scale;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(Math.max(1, s.x * scale), Math.max(1, s.y * scale), { type: THREE.HalfFloatType });
    REFL.reflMap.value = this.rt.texture;
    this.cam = new THREE.PerspectiveCamera();
    this.v = { view: new THREE.Vector3(), camPos: new THREE.Vector3(), mirror: new THREE.Vector3(), look: new THREE.Vector3(), target: new THREE.Vector3(), rot: new THREE.Matrix4(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4() };
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.max(1, w * pr * this.scale), Math.max(1, h * pr * this.scale));
  }

  /** level: the water height to mirror, or null for none this frame. hide: objects left out. */
  render(scene, camera, level, hide) {
    if (level === null) { REFL.reflOn.value = 0; return; }
    const { view, camPos, mirror, look, target, rot, plane, clip, q } = this.v;
    const normal = new THREE.Vector3(0, 1, 0);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < level + 0.2) { REFL.reflOn.value = 0; return; }
    mirror.set(camPos.x, level, camPos.z);
    view.subVectors(mirror, camPos).reflect(normal).negate().add(mirror);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(mirror, look).reflect(normal).negate().add(mirror);
    const vc = this.cam;
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    REFL.reflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // oblique near plane at the water, so nothing below it shows in the mirror
    plane.setFromNormalAndCoplanarPoint(normal, mirror).applyMatrix4(vc.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix.elements;
    q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;

    const r = this.renderer;
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const prevRT = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.state.buffers.depth.setMask(true);
    r.clear();
    r.render(scene, vc);
    r.setRenderTarget(prevRT);
    r.shadowMap.autoUpdate = auto;
    hide.forEach((o, i) => { o.visible = was[i]; });
    REFL.reflOn.value = 1;
    REFL.reflLevel.value = level;
  }
}
