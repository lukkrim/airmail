// The settings sheet: sound, climb beeps, vibration, distances, time of day, motion.
import { settings, setSetting, onSettings } from '../core/settings.js';
import { canVibrate } from '../core/haptics.js';
import { sfx } from '../audio/sound.js';

const $ = (id) => document.getElementById(id);

export function initSettingsPanel({ onClose }) {
  const switches = { setSound: 'sound', setBeeps: 'beeps', setHaptics: 'haptics' };
  for (const [id, key] of Object.entries(switches)) {
    $(id).addEventListener('click', () => setSetting(key, !settings[key]));
  }
  $('setVolume').addEventListener('input', (e) => setSetting('volume', +e.target.value));
  $('setVolume').addEventListener('change', () => sfx.paper());
  for (const b of document.querySelectorAll('#settingsPanel [data-set]')) {
    b.addEventListener('click', () => setSetting(b.dataset.set, b.dataset.value));
  }
  $('setHapticsRow').hidden = !canVibrate();
  $('settingsDone').addEventListener('click', onClose);

  function fill() {
    for (const [id, key] of Object.entries(switches)) $(id).setAttribute('aria-checked', String(!!settings[key]));
    $('setVolume').value = settings.volume;
    $('setVolume').disabled = !settings.sound;
    $('setBeeps').disabled = !settings.sound;
    for (const b of document.querySelectorAll('#settingsPanel [data-set]')) {
      b.setAttribute('aria-pressed', String(settings[b.dataset.set] === b.dataset.value));
    }
  }
  onSettings(fill);
  fill();

  return {
    show() { fill(); $('settingsPanel').hidden = false; },
    hide() { $('settingsPanel').hidden = true; }
  };
}
