// Every sound is synthesised with Web Audio, so the game ships no audio files.
// Paper rustles, a throw whoosh, wind that rises with speed, climb beeps in
// rising air, a landing thud, a splash, a postmark thump and an envelope tear.
import { settings, onSettings } from '../core/settings.js';

let ctx = null;
let master = null;
let noiseBuf = null;
let wind = null;
let nextBeep = 0;

function gainFor() { return settings.sound ? settings.volume : 0; }

// Browsers only allow audio after a user gesture.
export function initAudio() {
  const unlock = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = gainFor();
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true });
  onSettings((k) => {
    if (master && (k === 'sound' || k === 'volume')) master.gain.setTargetAtTime(gainFor(), ctx.currentTime, 0.05);
  });
  // a soft paper tap for every button
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('button')) sfx.tap(); }, true);
}

const ready = () => ctx && ctx.state === 'running' && settings.sound && settings.volume > 0;

function noiseSource(loop = false) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = loop;
  if (!loop) s.loopStart = 0;
  return s;
}

// A filtered noise burst with an attack/decay envelope.
function burst({ at = 0, dur = 0.1, type = 'bandpass', freq = 2000, q = 1, gain = 0.3, attack = 0.005, freqTo = null }) {
  const t = ctx.currentTime + at;
  const src = noiseSource();
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 1.5, dur + 0.05);
}

function tone({ at = 0, dur = 0.15, type = 'sine', freq = 440, freqTo = null, gain = 0.2, attack = 0.005 }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  tap() {
    if (!ready()) return;
    burst({ dur: 0.035, freq: 1800, q: 2, gain: 0.08 });
  },
  // folding paper: a few crinkles and a crease
  paper() {
    if (!ready()) return;
    for (let i = 0; i < 5; i++) {
      burst({ at: i * 0.06 + Math.random() * 0.03, dur: 0.05 + Math.random() * 0.05, freq: 2500 + Math.random() * 2500, q: 1.5, gain: 0.12 + Math.random() * 0.08 });
    }
    burst({ at: 0.36, dur: 0.09, freq: 1200, q: 3, gain: 0.18, type: 'bandpass' });
  },
  whoosh() {
    if (!ready()) return;
    burst({ dur: 0.45, freq: 350, freqTo: 1600, q: 1.2, gain: 0.35, attack: 0.08 });
  },
  thud() {
    if (!ready()) return;
    tone({ dur: 0.25, freq: 110, freqTo: 48, gain: 0.45 });
    burst({ dur: 0.12, type: 'lowpass', freq: 500, gain: 0.3 });
    burst({ at: 0.04, dur: 0.18, freq: 3000, q: 0.8, gain: 0.07 }); // paper skid
  },
  splash() {
    if (!ready()) return;
    burst({ dur: 0.7, type: 'lowpass', freq: 4000, freqTo: 300, gain: 0.4, attack: 0.01 });
    for (let i = 0; i < 4; i++) tone({ at: 0.15 + i * 0.09, dur: 0.07, freq: 500 + Math.random() * 500, freqTo: 900 + Math.random() * 400, gain: 0.05 });
  },
  // the postmark coming down on the postcard
  stamp() {
    if (!ready()) return;
    tone({ dur: 0.12, freq: 160, freqTo: 70, gain: 0.35 });
    burst({ dur: 0.04, freq: 2600, q: 1, gain: 0.18 });
  },
  tear() {
    if (!ready()) return;
    for (let i = 0; i < 14; i++) {
      burst({ at: i * 0.025 + Math.random() * 0.01, dur: 0.03, freq: 2800 + Math.random() * 2000, q: 2, gain: 0.07 + Math.random() * 0.1 });
    }
  },
  // a short rising chime when a letter arrives
  delivered() {
    if (!ready()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone({ at: i * 0.11, dur: 0.5, type: 'triangle', freq: f, gain: 0.12, attack: 0.01 }));
  }
};

/**
 * Called every frame. speed in m/s, climb in m/s (vertical speed), flying bool.
 * Drives the wind loop and the climb beeps.
 */
export function flightAudio(speed, climb, flying) {
  if (!ctx || ctx.state !== 'running') return;
  if (!wind) {
    const src = noiseSource(true);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 0.7; f.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(master);
    src.start();
    wind = { f, g };
  }
  const t = ctx.currentTime;
  const target = flying ? Math.min(0.32, 0.03 + speed * 0.012) : 0;
  wind.g.gain.setTargetAtTime(target, t, 0.25);
  wind.f.frequency.setTargetAtTime(250 + speed * 45, t, 0.25);

  // climb beeps: faster and higher the stronger the lift
  if (flying && settings.beeps && settings.sound && climb > 0.3 && t >= nextBeep) {
    const c = Math.min(6, climb);
    tone({ dur: 0.07, type: 'triangle', freq: 520 + c * 110, gain: 0.07 });
    nextBeep = t + Math.max(0.12, 0.5 - c * 0.07);
  }
}

// For testing from the console.
export const audioInfo = () => ({ state: ctx ? ctx.state : 'not started', wind: wind ? +wind.g.gain.value.toFixed(3) : 0 });
