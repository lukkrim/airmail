// The home screen: a writing desk with the letter in flight (an envelope),
// fresh paper for a new letter, and a paper plane for practice.
import { dist } from '../core/units.js';
import { flownToday, kmToGo, totalKm, msUntilTomorrow } from '../journey/journey.js';
import { stampSVG, postmarkSVG, postmarkDate, PLANE_ART } from './theme.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * actions: { openJourney(), write(), practice() }
 * getJourney(): the saved journey or null
 */
export function initDesk({ getJourney, openJourney, write, practice }) {
  $('deskEnvelope').addEventListener('click', openJourney);
  $('deskWrite').addEventListener('click', write);
  $('deskPractice').addEventListener('click', practice);
  $('deskPlaneArt').innerHTML = `<svg viewBox="0 0 60 52" aria-hidden="true">${PLANE_ART}</svg>`;

  function status(j) {
    if (j.delivered) return { text: `Delivered on day ${j.legs.length} · ${dist(totalKm(j))}`, ready: true, cta: 'Send it to your friend' };
    const day = j.legs.length + 1;
    if (flownToday(j)) {
      const ms = msUntilTomorrow();
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      return { text: `Day ${day} · next flight in ${h} h ${m} min`, ready: false, cta: 'See the route' };
    }
    return { text: `Day ${day} · ${dist(kmToGo(j))} to go`, ready: true, cta: "Throw today's flight" };
  }

  function fillEnvelope(j) {
    const env = $('deskEnvelope');
    const s = status(j);
    const day = j.delivered ? j.legs.length : j.legs.length + 1;
    const marks = el('span', 'env-marks');
    marks.innerHTML =
      postmarkSVG({ top: j.delivered ? 'DELIVERED' : 'AIRMAIL', bottom: `DAY ${day}`, lines: postmarkDate(), waves: true }) +
      stampSVG({ art: PLANE_ART, label: 'PAR AVION', tone: 'red' });
    marks.firstElementChild.classList.toggle('red', j.delivered);
    const from = el('span', 'env-from', j.fromName ? `${j.fromName} · ${j.from.name}` : `From ${j.from.name}`);
    const to = el('span', 'env-to');
    to.append(el('span', null, j.toName || 'My friend'), el('span', null, j.to.name));
    const note = el('span', `env-status${s.ready ? ' ready' : ''}`);
    note.append(el('b', null, s.cta), el('span', null, s.text));
    env.replaceChildren(el('span', 'env-par', 'Par avion'), from, marks, to, note);
    env.setAttribute('aria-label', `Your letter to ${j.toName || 'your friend'} in ${j.to.name}. ${s.text}. ${s.cta}.`);
    env.classList.toggle('delivered', !!j.delivered);
  }

  return {
    show() {
      const j = getJourney();
      $('deskPanel').hidden = false;
      $('deskEnvelope').hidden = !j;
      // a new letter is offered when there's none in flight
      const canWrite = !j || j.delivered;
      $('deskWrite').hidden = !canWrite;
      $('deskWriteTitle').textContent = j ? 'Write a new letter' : 'Write your first letter';
      $('deskWriteCta').hidden = !!j; // the envelope carries the main button once a letter exists
      $('deskSub').textContent = j && !j.delivered
        ? 'Your letter is on its way. One flight a day, carried by the real wind.'
        : 'Fold a letter into a paper plane and fly it to a friend, one flight a day on the real wind.';
      if (j) fillEnvelope(j);
      document.body.classList.add('at-desk');
    },
    hide() {
      $('deskPanel').hidden = true;
      document.body.classList.remove('at-desk');
    },
    refresh() {
      const j = getJourney();
      if (j && !$('deskPanel').hidden) fillEnvelope(j);
    }
  };
}
