// Light phone vibration for key moments (Android browsers; iOS Safari has none).
import { settings } from './settings.js';

export const canVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const PATTERNS = {
  throw: 14,
  lift: [8, 40, 8],
  stall: 35,
  land: 28,
  splash: [20, 30, 40],
  delivered: [30, 60, 30, 60, 90]
};

export function buzz(name) {
  if (!settings.haptics || !canVibrate()) return;
  try { navigator.vibrate(PATTERNS[name] ?? name); } catch { /* ignore */ }
}
