// Detailed Blender models (scripts/blender/ → public/models/*.glb) placed in
// the world. For now: the realistic test shop-house beside the throw spot.
// Trees and ordinary houses are drawn by flora.js.
//
// The earlier papercraft kit (tree_conifer, tree_broadleaf, house_cottage)
// is no longer placed since the world went realistic (2026-11-20).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LAUNCH, groundHeight } from './world.js';

const BASE = `${import.meta.env.BASE_URL}models/`;

/** Loads the models once. Resolves to { place(root) }, called after each rebuild. */
export async function loadModelKit() {
  const loader = new GLTFLoader();
  let shop = null;
  try {
    shop = (await loader.loadAsync(`${BASE}house_shop.glb`)).scene;
  } catch (err) {
    console.warn('Shop-house not loaded.', err);
    return null;
  }
  shop.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.material.roughness = 0.9;
    o.material.metalness = 0;
  });
  shop.name = 'house_shop';
  return {
    place(root) {
      // beside the throw spot, on the launch hill, so it's in view while aiming
      const x = LAUNCH.x + 17, z = LAUNCH.z - 16;
      shop.position.set(x, groundHeight(x, z) - 0.15, z);
      shop.rotation.y = 0.35; // turned towards the camera
      root.add(shop);
    },
    shared: shop
  };
}
