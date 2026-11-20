// The first-time flying lesson: a few notes pinned to the screen during the
// first practice flight. Each step waits for the player to actually do it.
import { THERMALS, thermalCenter } from '../environment/world.js';
import { sfx } from '../audio/sound.js';

const KEY = 'airmail.guide.v1';
const $ = (id) => document.getElementById(id);

export const guideDone = () => { try { return localStorage.getItem(KEY) === 'done'; } catch { return false; } };
const markDone = () => { try { localStorage.setItem(KEY, 'done'); } catch { /* fine */ } };
export const resetGuide = () => { try { localStorage.removeItem(KEY); } catch { /* fine */ } };

const touch = () => document.body.classList.contains('is-touch');
const TEXT = {
  aim: () => ({
    title: 'Your first flight',
    body: 'This is a practice flight, so nothing counts yet. The Glider floats best for learning. Press Throw when you\'re ready.'
  }),
  climb: () => ({
    title: 'Climb and dive',
    body: touch()
      ? 'Hold the round climb button to lift the nose. Let go and the plane dives, picking up speed.'
      : 'Hold Space (or the mouse) to lift the nose. Let go and the plane dives, picking up speed.'
  }),
  find: () => ({
    title: 'Find rising air',
    body: touch()
      ? 'Swirling paper scraps mark warm air rising over fields. Steer into them with ◀ ▶. The arrow points to the nearest.'
      : 'Swirling paper scraps mark warm air rising over fields. Steer into them with A and D. The arrow points to the nearest.'
  }),
  circle: () => ({
    title: "You're climbing!",
    body: 'Turn in gentle circles to stay inside the rising air. The beeps speed up where it\'s strongest.'
  }),
  glide: () => ({
    title: 'Now go far',
    body: 'Every metre of height turns into distance. Glide on and see how far you get.'
  })
};
const ORDER = ['aim', 'climb', 'find', 'circle', 'glide'];

export function initGuide({ onFinish }) {
  let step = null;      // null when the lesson isn't running
  let t = 0;            // seconds in this step
  let held = 0;         // seconds of climbing in the climb step
  let gained = 0;       // metres climbed in lift
  let lastY = null;
  const tmp = { x: 0, z: 0 };

  $('guideSkip').addEventListener('click', () => finish(true));
  $('guideDoneBtn').addEventListener('click', () => { $('guideEnd').hidden = true; onFinish('write'); });
  $('guideAgainBtn').addEventListener('click', () => { $('guideEnd').hidden = true; onFinish('again'); });

  function show(name) {
    step = name;
    t = 0;
    const { title, body } = TEXT[name]();
    $('guideTitle').textContent = title;
    $('guideBody').textContent = body;
    $('guideStep').textContent = `${ORDER.indexOf(name) + 1} of ${ORDER.length}`;
    $('guidePointer').hidden = name !== 'find';
    const card = $('guide');
    card.hidden = false;
    card.classList.toggle('low', name !== 'aim'); // in flight the bottom of the screen is free
    card.classList.remove('pop');
    void card.offsetWidth; // restart the little pop-in
    card.classList.add('pop');
    if (name !== 'aim') sfx.paper();
  }

  function finish(skipped) {
    step = null;
    markDone();
    $('guide').hidden = true;
    if (skipped) $('guideEnd').hidden = true;
  }

  return {
    active: () => step !== null,
    // Start on the first practice flight, unless the lesson is done.
    maybeStart(mode) {
      if (mode !== 'practice' || guideDone() || step) return;
      show('aim');
    },
    restart() { resetGuide(); step = null; },
    onThrow() { if (step === 'aim') { held = 0; gained = 0; lastY = null; show('climb'); } },
    onLand(landed) {
      if (!step) return;
      $('guideDoneBtn').textContent = landed.hasJourney ? 'Back to my letter' : 'Write your first letter';
      step = null;
      markDone();
      $('guide').hidden = true;
      // the wrap-up note sits on the landing postcard
      $('guideEndText').textContent = landed.km > 0
        ? `That's flying! Every day your letter gets one flight like this on the real wind, starting where it came down the day before.`
        : 'Every day your letter gets one flight like this on the real wind.';
      $('guideEnd').hidden = false;
    },
    hideEnd() { $('guideEnd').hidden = true; },
    leave() { if (step) { step = null; $('guide').hidden = true; } },
    // Called each frame while flying.
    update(dt, { climb, plane, wind, inThermal }) {
      if (!step || step === 'aim') return;
      t += dt;
      if (step === 'climb') {
        if (climb) held += dt;
        if ((held > 0.8 && !climb) || t > 9) show('find');
      } else if (step === 'find') {
        if (inThermal) { lastY = plane.pos.y; show('circle'); return; }
        if (t > 35) { show('glide'); return; }
        // point at the nearest thermal, relative to where the plane is heading
        let best = null, bestD = Infinity;
        for (const th of THERMALS) {
          thermalCenter(th, plane.pos.y, wind, tmp);
          const d = Math.hypot(tmp.x - plane.pos.x, tmp.z - plane.pos.z);
          if (d < bestD) { bestD = d; best = { x: tmp.x, z: tmp.z }; }
        }
        if (best) {
          const want = Math.atan2(best.x - plane.pos.x, -(best.z - plane.pos.z));
          let rel = want - plane.heading;
          rel = Math.atan2(Math.sin(rel), Math.cos(rel));
          $('guideArrow').style.transform = `rotate(${rel}rad)`;
          $('guideDist').textContent = `${Math.round(bestD / 10) * 10} m`;
        }
      } else if (step === 'circle') {
        if (lastY != null) gained += Math.max(0, plane.pos.y - lastY);
        lastY = plane.pos.y;
        if (gained > 25 || t > 14) show('glide');
      }
    }
  };
}
