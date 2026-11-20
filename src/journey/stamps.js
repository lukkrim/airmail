// The stamp collection: one stamp for every country a letter lands in (and one
// for a night at sea), saved on this device.
const KEY = 'airmail.stamps.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

let album = load();

/** All collected stamps, newest first: [{ id, first, count, route }]. */
export function collected() {
  return Object.entries(album)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.first < b.first ? 1 : -1));
}

export const hasStamp = (id) => !!album[id];
export const stampCount = () => Object.keys(album).length;

/**
 * Records a landing. Returns true when it's a new stamp.
 * route: a short "Lisbon → Madrid, day 2" note for the album.
 */
export function earnStamp(id, route) {
  const isNew = !album[id];
  album[id] = isNew ? { first: new Date().toISOString(), count: 1, route } : { ...album[id], count: (album[id].count || 1) + 1 };
  try { localStorage.setItem(KEY, JSON.stringify(album)); } catch { /* not saved */ }
  return isNew;
}

// For testing from the console.
export function resetStamps() { album = {}; try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
