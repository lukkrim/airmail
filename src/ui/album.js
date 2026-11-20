// The stamp album: a page of every stamp collected, and the album on the desk.
import { collected, stampCount } from '../journey/stamps.js';
import { stampInfo, COUNTRY_COUNT, SEA_ID } from './stampArt.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const countries = () => collected().filter((s) => s.id !== SEA_ID).length;

export function initAlbum({ onClose }) {
  $('albumClose').addEventListener('click', onClose);

  function fill() {
    const list = collected();
    const n = countries();
    $('albumTitle').textContent = n === 1 ? '1 country' : `${n} countries`;
    $('albumSub').textContent = list.length
      ? `${n} of ${COUNTRY_COUNT} countries and territories. Every daily flight that comes down somewhere new adds a stamp.`
      : 'Every daily flight that comes down in a new country adds its stamp here, and a night at sea earns one too.';
    const grid = $('albumGrid');
    grid.replaceChildren();
    if (!list.length) {
      for (let i = 0; i < 3; i++) {
        const slot = el('div', 'album-slot empty');
        slot.append(el('span', 'slot-hinge'), el('span', 'slot-q', '?'));
        grid.append(slot);
      }
      return;
    }
    for (const s of list) {
      const info = stampInfo(s.id);
      const fig = el('figure', 'album-slot');
      const art = el('div', 'slot-art');
      art.innerHTML = info.svg();
      const cap = el('figcaption');
      cap.append(el('b', null, info.name));
      cap.append(el('span', null, `${day(s.first)}${s.route ? ` · ${s.route}` : ''}`));
      if (s.count > 1) cap.append(el('span', 'slot-count', `Landed here ${s.count} times`));
      fig.append(el('span', 'slot-hinge'), art, cap);
      grid.append(fig);
    }
  }

  return {
    show() { fill(); $('albumPanel').hidden = false; $('albumPanel').firstElementChild.scrollTop = 0; },
    hide() { $('albumPanel').hidden = true; }
  };
}

// The little album on the desk: a fan of the newest stamps and the count.
export function fillDeskAlbum() {
  const list = collected().slice(0, 3);
  const fan = $('deskAlbumStamps');
  fan.replaceChildren(...list.map((s) => {
    const span = el('span', 'fan-stamp');
    span.innerHTML = stampInfo(s.id).svg();
    return span;
  }));
  const n = countries();
  $('deskAlbumCount').textContent = stampCount()
    ? `${n} ${n === 1 ? 'country' : 'countries'} collected`
    : 'Land somewhere new to get its stamp';
}
