// Setup, journey map and share screens.
import { CONFIG } from './config.js';
import {
  loadJourney, saveJourney, clearJourney, newJourney, flownToday, kmToGo, totalKm,
  msUntilTomorrow, computeLeg, applyLeg, flightScale
} from './journey.js';
import { fetchWind, searchPlaces, formatPopulation } from './weather.js';
import { bearingDeg, compass, distanceKm } from './geo.js';
import { renderToCanvas } from './routemap.js';
import { makeShareCanvas, shareText } from './share.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

/**
 * game: {
 *   enterMenu(),                         stop flying and show the menu backdrop
 *   startFlight({ mode, bearing, realWind, day })
 * }
 */
export function initScreens(game) {
  let journey = loadJourney();
  let realWind = null;          // wind at journey.pos
  let windFor = null;           // "lat,lon" the wind belongs to
  let windError = false;
  let mapFocus = 'route';
  let lastLeg = journey && journey.legs.length ? journey.legs[journey.legs.length - 1] : null;
  const dev = new URLSearchParams(location.search).has('dev');
  let devAllow = false;
  let storageOk = true;

  // ---------- setup ----------
  const pickers = { from: cityPicker('from'), to: cityPicker('to') };

  function cityPicker(prefix) {
    const input = $(`${prefix}Input`), list = $(`${prefix}Results`);
    let chosen = null, timer = 0, seq = 0;
    input.addEventListener('input', () => {
      chosen = null;
      input.classList.remove('chosen');
      updateStart();
      clearTimeout(timer);
      timer = setTimeout(() => run(false), 300);
    });
    async function run(includeSmall) {
      const my = ++seq;
      if (input.value.trim().length < 2) { list.hidden = true; return; }
      let result;
      try {
        result = await searchPlaces(input.value, { includeSmall });
      } catch {
        if (my !== seq) return;
        list.replaceChildren(msg('Place search is unavailable. Check your connection and try again.'));
        list.hidden = false;
        return;
      }
      if (my !== seq) return;
      list.replaceChildren();
      if (!result.places.length) list.appendChild(msg('No places found. Try another spelling.'));
      for (const p of result.places) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        const name = document.createElement('b');
        name.textContent = p.name;
        const region = document.createElement('span');
        region.textContent = [p.region, formatPopulation(p.population)].filter(Boolean).join(' · ');
        b.append(name, region);
        b.addEventListener('click', () => {
          chosen = p;
          input.value = `${p.name}${p.country ? `, ${p.country}` : ''}`;
          input.classList.add('chosen');
          list.hidden = true;
          updateStart();
        });
        li.appendChild(b);
        list.appendChild(li);
      }
      if (result.hidden > 0) {
        const li = document.createElement('li');
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'more';
        more.textContent = `Show ${result.hidden} smaller matching ${result.hidden === 1 ? 'place' : 'places'}`;
        more.addEventListener('click', () => run(true));
        li.appendChild(more);
        list.appendChild(li);
      }
      list.hidden = false;
    }
    function msg(text) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = text;
      return li;
    }
    return { get: () => chosen };
  }

  function updateStart() {
    const a = pickers.from.get(), b = pickers.to.get();
    const err = $('setupError');
    err.hidden = true;
    let ok = !!(a && b);
    if (ok && distanceKm(a, b) < CONFIG.journey.deliverRadiusKm * 2) {
      ok = false;
      err.textContent = `Pick two places at least ${CONFIG.journey.deliverRadiusKm * 2} km apart.`;
      err.hidden = false;
    }
    $('startBtn').disabled = !ok;
  }

  $('startBtn').addEventListener('click', () => {
    journey = newJourney(pickers.from.get(), pickers.to.get(), $('letterInput').value);
    storageOk = saveJourney(journey);
    lastLeg = null;
    realWind = null;
    windFor = null;
    showJourney('route');
  });
  $('setupPracticeBtn').addEventListener('click', () => game.startFlight({ mode: 'practice' }));

  function showSetup() {
    game.enterMenu();
    hideAll();
    $('setupPanel').hidden = false;
    $('fromInput').focus({ preventScroll: true });
  }

  // ---------- journey ----------
  function hideAll() {
    for (const id of ['setupPanel', 'journeyPanel', 'sharePanel']) $(id).hidden = true;
  }

  function showJourney(focus = mapFocus) {
    if (!journey) return showSetup();
    mapFocus = journey.delivered ? 'route' : focus;
    game.enterMenu();
    hideAll();
    $('confirmNew').hidden = true;
    $('journeyPanel').hidden = false;
    fillJourney();
    requestAnimationFrame(drawMap);
    loadWind();
  }

  function whereText() {
    if (journey.delivered) return 'Delivered';
    if (!lastLeg) return `In ${journey.from.name}`;
    if (journey.pos.afloat) return 'Floating at sea';
    return lastLeg.country ? `In ${lastLeg.country}` : 'On land';
  }

  function fillJourney() {
    const j = journey;
    const day = j.delivered ? j.legs.length : j.legs.length + 1;
    $('jDay').textContent = j.delivered ? `Delivered on day ${day}` : `Day ${day}`;
    $('jRoute').textContent = `${j.from.name} → ${j.to.name}`;
    $('jFlown').textContent = `${fmt(totalKm(j))} km`;
    $('jToGo').textContent = j.delivered ? 'Arrived' : `${fmt(kmToGo(j))} km`;
    $('jWhere').textContent = whereText();
    $('viewRoute').setAttribute('aria-pressed', String(mapFocus === 'route'));
    $('viewLeg').setAttribute('aria-pressed', String(mapFocus === 'leg'));
    $('viewLeg').disabled = !lastLeg;
    $('jShareBtn').hidden = !lastLeg;
    $('newJourneyBtn').hidden = j.delivered;
    $('devAgainBtn').hidden = !(dev && flownToday(j) && !j.delivered && !devAllow);

    const letter = $('jLetter');
    if (j.delivered) {
      letter.hidden = false;
      letter.replaceChildren();
      const h = document.createElement('p');
      h.className = 'letter-head';
      h.textContent = `Your letter reached ${j.to.name} after ${j.legs.length} ${j.legs.length === 1 ? 'day' : 'days'} and ${fmt(totalKm(j))} km.`;
      letter.appendChild(h);
      if (j.letter) {
        const body = document.createElement('blockquote');
        body.textContent = j.letter;
        letter.appendChild(body);
      }
    } else letter.hidden = true;

    updateDailyButton();
    updateWindLine();
    if (!storageOk) {
      $('jWind').textContent = 'This browser is not saving progress, so the journey will be lost when you close the page.';
    }
  }

  function updateDailyButton() {
    const b = $('dailyBtn');
    if (journey.delivered) {
      b.textContent = 'Write a new letter';
      b.disabled = false;
      return;
    }
    if (flownToday(journey) && !devAllow) {
      const ms = msUntilTomorrow();
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      b.textContent = `Next flight in ${h} h ${m} min`;
      b.disabled = true;
      return;
    }
    if (!realWind) {
      b.textContent = windError ? "Can't load today's wind" : 'Checking the wind…';
      b.disabled = true;
      return;
    }
    b.textContent = journey.pos.afloat ? "Throw today's flight from the sea" : "Throw today's flight";
    b.disabled = false;
  }

  function updateWindLine() {
    const el = $('jWind');
    if (journey.delivered) { el.textContent = ''; return; }
    const toFriend = compass(bearingDeg(journey.pos, journey.to));
    if (windError) {
      el.replaceChildren(document.createTextNode("Couldn't load the real wind. Check your connection. "));
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'link inline';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => { windError = false; loadWind(true); });
      el.appendChild(retry);
      return;
    }
    if (!realWind) { el.textContent = 'Checking the wind where your plane is…'; return; }
    const blowsTo = compass((realWind.fromDeg + 180) % 360);
    const pace = flightScale(journey) * CONFIG.journey.typicalFlightUnits;
    const paceLine = isFinalStretch()
      ? `Last stretch: even a short flight today can reach ${journey.to.name}. `
      : `A good flight today carries your letter about ${fmt(pace)} km. `;
    el.textContent = paceLine +
      `Real wind at your plane: ${realWind.speed.toFixed(1)} m/s from the ${compass(realWind.fromDeg)}, blowing ${blowsTo}. Your friend is ${toFriend}.`;
  }

  const isFinalStretch = () => journey.legs.length >= CONFIG.journey.targetDays - 1;

  async function loadWind(force = false) {
    if (!journey || journey.delivered) return;
    const key = `${journey.pos.lat.toFixed(3)},${journey.pos.lon.toFixed(3)}`;
    if (!force && realWind && windFor === key) { fillJourney(); drawMap(); return; }
    try {
      const w = await fetchWind(journey.pos);
      realWind = w;
      windFor = key;
      windError = false;
    } catch {
      windError = true;
    }
    if (!$('journeyPanel').hidden) { updateDailyButton(); updateWindLine(); drawMap(); }
  }

  function drawMap() {
    if ($('journeyPanel').hidden) return;
    renderToCanvas($('routeMap'), journey, {
      focus: mapFocus === 'leg' && lastLeg ? 'leg' : 'route',
      wind: journey.delivered ? null : realWind
    });
  }
  window.addEventListener('resize', () => requestAnimationFrame(drawMap));

  $('viewRoute').addEventListener('click', () => { mapFocus = 'route'; fillJourney(); drawMap(); });
  $('viewLeg').addEventListener('click', () => { mapFocus = 'leg'; fillJourney(); drawMap(); });

  $('dailyBtn').addEventListener('click', () => {
    if (journey.delivered) { askNewJourney(); return; }
    if (!realWind || (flownToday(journey) && !devAllow)) return;
    game.startFlight({
      mode: 'daily',
      bearing: bearingDeg(journey.pos, journey.to),
      realWind,
      day: journey.legs.length + 1,
      scale: flightScale(journey),
      finalStretch: isFinalStretch(),
      toName: journey.to.name
    });
  });
  $('practiceBtn').addEventListener('click', () =>
    game.startFlight({ mode: 'practice', scale: journey && !journey.delivered ? flightScale(journey) : undefined }));
  $('devAgainBtn').addEventListener('click', () => { devAllow = true; fillJourney(); });
  $('jShareBtn').addEventListener('click', () => lastLeg && openShare(lastLeg));

  function askNewJourney() {
    $('confirmNew').hidden = false;
    $('confirmNewNo').focus({ preventScroll: true });
  }
  $('newJourneyBtn').addEventListener('click', askNewJourney);
  $('confirmNewNo').addEventListener('click', () => { $('confirmNew').hidden = true; });
  $('confirmNewYes').addEventListener('click', () => {
    clearJourney();
    journey = null;
    lastLeg = null;
    realWind = null;
    windFor = null;
    showSetup();
  });

  // update the countdown while the map is open
  setInterval(() => { if (journey && !$('journeyPanel').hidden) updateDailyButton(); }, 30000);

  // ---------- after a counted flight ----------
  function onDailyLanding({ pathXZ, bearing, fold, time, gameKind, scale }) {
    const leg = computeLeg(journey, { pathXZ, bearing, realWind, fold, time, gameKind, scale });
    applyLeg(journey, leg);
    lastLeg = leg;
    devAllow = false;
    realWind = null; // the plane moved; tomorrow needs the wind at the new spot
    windFor = null;
    return { leg, ...describeLeg(leg) };
  }

  function describeLeg(leg) {
    const c = leg.country;
    let where;
    if (leg.outcome === 'delivered') where = `Delivered! Your letter reached ${journey.to.name}.`;
    else if (leg.outcome === 'ashore') where = `Splashed down, drifted ${leg.driftKm} km and washed ashore${c ? ` in ${c}` : ''}.`;
    else if (leg.outcome === 'afloat') where = `Splashed down at sea and drifted ${leg.driftKm} km. It floats there until tomorrow.`;
    else where = c ? `Landed in ${c}.` : 'Landed in open country.';
    const toGo = leg.outcome === 'delivered'
      ? `${leg.day} ${leg.day === 1 ? 'day' : 'days'} · ${fmt(totalKm(journey))} km in all`
      : `${fmt(leg.toGoKm)} km to ${journey.to.name} · day ${leg.day}`;
    return { where, toGo };
  }

  // ---------- share ----------
  let shareBlob = null;
  function openShare(leg) {
    hideAll();
    game.enterMenu();
    const canvas = makeShareCanvas(journey, leg);
    $('shareImg').src = canvas.toDataURL('image/png');
    $('shareText').value = shareText(journey, leg);
    $('shareStatus').textContent = '';
    shareBlob = null;
    canvas.toBlob((b) => {
      shareBlob = b;
      const file = b && new File([b], `airmail-day-${leg.day}.png`, { type: 'image/png' });
      $('shareNative').hidden = !(file && navigator.canShare && navigator.canShare({ files: [file] }));
    }, 'image/png');
    $('sharePanel').hidden = false;
  }
  $('shareClose').addEventListener('click', () => showJourney());
  $('shareCopy').addEventListener('click', async () => {
    const text = $('shareText').value;
    try {
      await navigator.clipboard.writeText(text);
      $('shareStatus').textContent = 'Copied.';
    } catch {
      $('shareText').select();
      $('shareStatus').textContent = 'Press Ctrl+C or ⌘C to copy the selected text.';
    }
  });
  $('shareSave').addEventListener('click', () => {
    if (!shareBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(shareBlob);
    a.download = `airmail-day-${lastLeg ? lastLeg.day : 1}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('shareStatus').textContent = 'Saved.';
  });
  $('shareNative').addEventListener('click', async () => {
    if (!shareBlob) return;
    const file = new File([shareBlob], `airmail-day-${lastLeg ? lastLeg.day : 1}.png`, { type: 'image/png' });
    try {
      await navigator.share({ files: [file], text: $('shareText').value });
    } catch { /* cancelled */ }
  });

  return {
    start() { journey ? showJourney('route') : showSetup(); },
    showJourney,
    hasJourney: () => !!journey,
    onDailyLanding,
    openShare: () => lastLeg && openShare(lastLeg),
    get journey() { return journey; }
  };
}
