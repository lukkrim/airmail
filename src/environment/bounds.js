// The flight area of every course, in game units (≈ metres in the air).
// Throw direction is -Z; +X is to the right.
export const BOUNDS = { minX: -1300, maxX: 1300, minZ: -5100, maxZ: 700 };
export const LAUNCH = { x: 0, z: 0 };
export const SEA_LEVEL = 0;
// Real-land courses also draw the land around it out to the horizon.
export const FAR = { minX: -9000, maxX: 9000, minZ: -17000, maxZ: 7000 };
// Real-land detail (heights, land cover) covers the flight area plus a margin.
const PAD = 200;
export const NEAR = { minX: BOUNDS.minX - PAD, maxX: BOUNDS.maxX + PAD, minZ: BOUNDS.minZ - PAD, maxZ: BOUNDS.maxZ + PAD };
