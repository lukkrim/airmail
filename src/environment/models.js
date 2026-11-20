// The Blender model kit (scripts/blender/ → public/models/*.glb) placed in the
// world. Trees and houses are drawn as instances, so hundreds cost about as
// much as one. If the kit can't load, the simple shapes from world.js stay.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS } from './world.js';
import { mulberry32 } from '../core/noise.js';

const BASE = `${import.meta.env.BASE_URL}models/`;
const NIGHT_WINDOW = new THREE.Color('#ffcf73');

// One model → one geometry with a group per material, plus paper materials.
async function loadModel(loader, name, paper) {
  const gltf = await loader.loadAsync(`${BASE}${name}.glb`);
  const geos = [], mats = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    // GLTFLoader gives one mesh per material, so each becomes one group
    geos.push(o.geometry.clone().applyMatrix4(o.matrixWorld));
    mats.push(o.material);
  });
  const geometry = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), true);
  geometry.computeBoundingBox();
  const materials = mats.map((m) => new THREE.MeshLambertMaterial({
    name: m.name,
    color: m.color.clone(),
    vertexColors: !!geometry.attributes.color,
    map: geometry.attributes.uv ? paper : null,
    flatShading: true
  }));
  return { geometry, materials };
}

function instanced({ geometry, materials }, count) {
  const mesh = new THREE.InstancedMesh(geometry, materials, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Loads the kit and swaps it in. Resolves to { setNight(f) } (f: 0 day … 1
 * night, lights the cottage windows), or null if the kit couldn't load.
 */
export async function loadModelKit(scene, paper) {
  const loader = new GLTFLoader();
  let conifer, broadleaf, house;
  try {
    [conifer, broadleaf, house] = await Promise.all(
      ['tree_conifer', 'tree_broadleaf', 'house_cottage'].map((n) => loadModel(loader, n, paper)));
  } catch (err) {
    console.warn('Model kit not loaded; keeping the simple shapes.', err);
    return null;
  }
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const rng = mulberry32(42);

  // ---- trees: same spots and sizes as the cone trees they replace ----
  const old = scene.getObjectByName('trees');
  if (old) {
    const picks = { conifer: [], broadleaf: [] };
    for (let i = 0; i < old.count; i++) {
      old.getMatrixAt(i, m);
      m.decompose(p, q, s);
      const height = s.y;                       // the cone was 1 unit tall
      const broad = p.y < 60 && rng() < 0.45;   // leafy trees lower down, conifers up the hills
      const model = broad ? broadleaf : conifer;
      const k = (height * 0.85) / (model.geometry.boundingBox.max.y || 10);
      picks[broad ? 'broadleaf' : 'conifer'].push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(k, k, k)));
    }
    for (const [key, model] of [['conifer', conifer], ['broadleaf', broadleaf]]) {
      const list = picks[key];
      const mesh = instanced(model, list.length);
      list.forEach((mat, i) => mesh.setMatrixAt(i, mat));
      mesh.name = `trees_${key}`;
      scene.add(mesh);
    }
    old.visible = false;
  }

  // ---- houses: the cottage stretched to each house's footprint ----
  const houses = BUILDINGS.filter((b) => b.kind === 'house');
  const bb = house.geometry.boundingBox;
  const size = new THREE.Vector3().subVectors(bb.max, bb.min);
  const homes = instanced(house, houses.length);
  houses.forEach((b, i) => {
    const turn = rng() < 0.5 ? 0 : Math.PI; // face one street or the other
    p.set(b.x, b.base, b.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    s.set(b.w / size.x, (b.h + b.roofH * 0.7) / size.y, b.d / size.z);
    homes.setMatrixAt(i, m.compose(p, q, s));
  });
  homes.name = 'houses_kit';
  scene.add(homes);
  const oldHouses = scene.getObjectByName('houses');
  if (oldHouses) oldHouses.visible = false;

  const windows = house.materials.filter((mat) => mat.name === 'window');
  return {
    setNight(f) {
      for (const w of windows) {
        w.emissive.copy(NIGHT_WINDOW);
        w.emissiveIntensity = f * 1.3;
      }
    }
  };
}
