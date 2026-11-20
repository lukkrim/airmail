// Player settings, saved on this device.
const KEY = 'airmail.settings.v1';

const DEFAULTS = {
  sound: true,        // all sound
  volume: 0.7,        // 0–1
  beeps: true,        // climb beeps while in rising air
  haptics: true,      // phone vibration
  motion: 'auto',     // 'auto' (follow the system) or 'reduce'
  units: 'km',        // 'km' or 'mi'
  time: 'auto'        // 'auto' (real sun), 'day' or 'night'
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (typeof raw[k] === typeof DEFAULTS[k]) out[k] = raw[k];
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();
const listeners = new Set();

export function setSetting(key, value) {
  if (!(key in DEFAULTS) || settings[key] === value) return;
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* private mode: keep in memory */ }
  for (const fn of listeners) fn(key, value);
}

export function onSettings(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const systemReduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => settings.motion === 'reduce' || !!(systemReduce && systemReduce.matches);

// Reflect motion preference on <html> so CSS can calm animations down too.
function applyMotionClass() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('reduce-motion', settings.motion === 'reduce');
}
applyMotionClass();
onSettings((k) => { if (k === 'motion') applyMotionClass(); });
