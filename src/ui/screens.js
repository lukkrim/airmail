// Setup, journey map and share screens.
import { CONFIG } from '../core/config.js';
import {
  loadJourney, saveJourney, clearJourney, newJourney, flownToday, kmToGo, totalKm,
  msUntilTomorrow, computeLeg, applyLeg, flightScale, catchUpBoost, typicalKm, typicalDaysLeft
} from '../journey/journey.js';
import { fetchWind, searchPlaces, formatPopulation } from '../environment/weather.js';
import { bearingDeg, compass, distanceKm } from '../environment/geo.js';
import { renderToCanvas } from './routemap.js';
import { makeShareCanvas, shareText } from './share.js';
import { journeyLink, letterCodeFromHash, decodeSnapshot, fromSnapshot } from '../journey/link.js';
import { stampSVG, postmarkSVG, postmarkDate, PLANE_ART, fontsReady } from './theme.js';
import { initDesk } from './desk.js';

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

  let lastMenu = 'desk';  // where "Back" from a practice flight returns to

  const desk = initDesk({
    getJourney: () => journey,
    openJourney: () => showJourney('route'),
    write: () => showSetup(),
    practice: () => startPractice()
  });

  function showDesk() {
    game.enterMenu();
    hideAll();
    lastMenu = 'desk';
    desk.show();
  }

  function startPractice() {
    game.startFlight({ mode: 'practice', scale: journey && !journey.delivered ? flightScale(journey) : undefined });
  }

  for (const el of document.querySelectorAll('[data-stamp="plane"]')) {
    el.innerHTML = stampSVG({ art: PLANE_ART, label: 'PAR AVION', tone: 'red' });
  }
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
    return {
      get: () => chosen,
      set(p) {
        chosen = p;
        input.value = p ? `${p.name}${p.region ? `, ${p.region.split(', ').pop()}` : ''}` : '';
        input.classList.toggle('chosen', !!p);
        list.hidden = true;
      }
    };
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
    journey = newJourney(pickers.from.get(), pickers.to.get(), $('letterInput').value, {
      fromName: $('fromNameInput').value,
      toName: $('toNameInput').value
    });
    storageOk = saveJourney(journey);
    lastLeg = null;
    realWind = null;
    windFor = null;
    showJourney('route');
  });
  $('setupBackBtn').addEventListener('click', showDesk);
  const updateLetterHint = () => {
    $('letterInput').placeholder = `Dear ${$('toNameInput').value.trim() || 'friend'}, this letter is coming the slow way…`;
  };
  $('toNameInput').addEventListener('input', updateLetterHint);

  function showSetup(prefill) {
    game.enterMenu();
    hideAll();
    if (prefill) {
      pickers.from.set(prefill.from);
      pickers.to.set(prefill.to);
      $('fromNameInput').value = prefill.fromName || '';
      $('toNameInput').value = prefill.toName || '';
      $('letterInput').value = '';
      updateStart();
      updateLetterHint();
    }
    $('setupPanel').hidden = false;
    (prefill ? $('letterInput') : $('fromInput')).focus({ preventScroll: true });
  }

  // ---------- journey ----------
  function hideAll() {
    for (const id of ['setupPanel', 'journeyPanel', 'sharePanel', 'letterPanel']) $(id).hidden = true;
    desk.hide();
  }

  function showJourney(focus = mapFocus) {
    if (!journey) return showSetup();
    mapFocus = journey.delivered ? 'route' : focus;
    game.enterMenu();
    hideAll();
    lastMenu = 'journey';
    $('confirmNew').hidden = true;
    $('journeyPanel').hidden = false;
    fillJourney();
    requestAnimationFrame(drawMap);
    fontsReady().then(() => requestAnimationFrame(drawMap));
    loadWind();
  }

  const friendName = () => journey.toName || `your friend in ${journey.to.name}`;

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
    $('jMark').innerHTML = postmarkSVG({
      top: j.delivered ? 'DELIVERED' : 'AIRMAIL',
      bottom: `DAY ${day}`,
      lines: postmarkDate(),
      waves: false
    });
    $('jMark').firstElementChild.classList.toggle('red', j.delivered);
    $('jFlown').textContent = `${fmt(totalKm(j))} km`;
    $('jToGo').textContent = j.delivered ? 'Arrived' : `${fmt(kmToGo(j))} km`;
    $('jWhere').textContent = whereText();
    $('viewRoute').setAttribute('aria-pressed', String(mapFocus === 'route'));
    $('viewLeg').setAttribute('aria-pressed', String(mapFocus === 'leg'));
    $('viewLeg').disabled = !lastLeg;
    $('jShareBtn').hidden = !lastLeg;
    $('newJourneyBtn').textContent = j.delivered ? 'Write a new letter' : 'Start a new letter';
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
      b.textContent = `Send the letter to ${friendName()}`;
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
    el.textContent = paceLine() + ' ' +
      `Real wind at your plane: ${realWind.speed.toFixed(1)} m/s from the ${compass(realWind.fromDeg)}, blowing ${blowsTo}. Your friend is ${toFriend}.`;
  }

  function paceLine() {
    const boost = catchUpBoost(journey);
    const days = typicalDaysLeft(journey);
    const typical = `A typical flight carries your letter about ${fmt(typicalKm(journey))} km; ride lift to go further.`;
    const left = `At a typical pace that's about ${days} more ${days === 1 ? 'day' : 'days'}.`;
    return boost > 1 ? `Catch-up boost: today's flight counts ${boost.toFixed(1)}× as far. ${left}` : `${typical} ${left}`;
  }

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
    if (journey.delivered) { openShare(lastLeg); return; }
    if (!realWind || (flownToday(journey) && !devAllow)) return;
    game.startFlight({
      mode: 'daily',
      bearing: bearingDeg(journey.pos, journey.to),
      realWind,
      pos: { lat: journey.pos.lat, lon: journey.pos.lon },
      day: journey.legs.length + 1,
      scale: flightScale(journey),
      typicalKm: typicalKm(journey) * catchUpBoost(journey),
      boost: catchUpBoost(journey)
    });
  });
  $('practiceBtn').addEventListener('click', startPractice);
  $('jDeskBtn').addEventListener('click', showDesk);
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
  setInterval(() => {
    if (journey && !$('journeyPanel').hidden) updateDailyButton();
    desk.refresh();
  }, 30000);

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
    const r = leg.rating;
    const rating = r >= 1.4 ? `Great flight: ${r.toFixed(1)}× a typical day.`
      : r >= 0.95 ? `Good flight: ${r.toFixed(1)}× a typical day.`
      : `Short flight: ${r.toFixed(1)}× a typical day.`;
    const toGo = leg.outcome === 'delivered'
      ? `Delivered on day ${leg.day}, ${fmt(totalKm(journey))} km in all.`
      : `${rating} ${fmt(leg.toGoKm)} km to ${journey.to.name}.`;
    return { where, toGo };
  }

  // ---------- share ----------
  let shareBlob = null;
  async function openShare(leg) {
    hideAll();
    game.enterMenu();
    const delivered = journey.delivered && leg.outcome === 'delivered';
    $('shareTitle').textContent = delivered ? 'Send your letter' : 'Share this flight';
    $('shareSub').textContent = delivered
      ? `It arrived! Send this link to ${friendName()}. They'll watch the whole journey, then open your letter.`
      : 'The link lets anyone follow the route so far. Your letter stays sealed until it arrives.';
    await fontsReady();
    const canvas = makeShareCanvas(journey, leg);
    $('shareImg').src = canvas.toDataURL('image/png');
    const link = await journeyLink(journey, { includeLetter: delivered });
    $('shareLink').value = link;
    $('shareLocalNote').hidden = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    $('shareText').value = shareText(journey, leg, link);
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
  $('shareLinkCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('shareLink').value);
      $('shareStatus').textContent = 'Link copied.';
    } catch {
      $('shareLink').select();
      $('shareStatus').textContent = 'Press Ctrl+C or ⌘C to copy the selected link.';
    }
  });
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

  // ---------- a letter link someone sent ----------
  let viewed = null;      // the sender's journey, rebuilt from the link
  let replayId = 0;

  function clearHash() {
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  const who = (name, city) => (name ? `${name} in ${city}` : city);

  async function showLetter(code) {
    const id0 = replayId;
    game.enterMenu();
    hideAll();
    $('letterPanel').hidden = false;
    $('lvLetter').hidden = true;
    $('lvReply').hidden = true;
    $('lvReplay').hidden = true;
    $('lvOpen').hidden = true;
    try {
      viewed = fromSnapshot(await decodeSnapshot(code));
    } catch {
      viewed = null;
      $('lvEyebrow').textContent = 'Airmail';
      $('lvTitle').textContent = 'This letter link is damaged';
      $('lvStatus').textContent = 'Part of the link may be missing. Ask your friend to send it again.';
      $('lvMap').parentElement.hidden = true;
      return;
    }
    $('lvMap').parentElement.hidden = false;
    const v = viewed;
    const days = v.legs.length;
    $('lvEyebrow').textContent = v.delivered ? `A letter for ${v.toName || 'you'}` : 'A letter on its way';
    $('lvTitle').textContent = `From ${who(v.fromName, v.from.name)} to ${who(v.toName, v.to.name)}`;
    const flown = v.legs.reduce((s, L) => s + L.km + (L.driftKm || 0), 0);
    $('lvStatus').textContent = v.delivered
      ? `It flew as a paper plane on the real wind for ${days} ${days === 1 ? 'day' : 'days'}, ${fmt(flown)} km in all.`
      : `Day ${days} of its flight, ${fmt(distanceKm(v.pos, v.to))} km to go. The letter stays sealed until it arrives.`;
    $('lvOpen').textContent = v.delivered ? 'Open the letter' : 'Watch the journey so far';
    $('lvOpen').hidden = false;
    // sealed view: just the two cities
    const sealed = { ...v, legs: [], pos: { ...v.from }, delivered: false };
    drawViewed(sealed);
    fontsReady().then(() => { if (replayId === id0) drawViewed(sealed); });
  }

  function drawViewed(j) {
    renderToCanvas($('lvMap'), j, { focus: 'route', frame: viewed });
  }

  function replay() {
    const v = viewed;
    const id = ++replayId;
    $('lvOpen').hidden = true;
    $('lvReplay').hidden = true;
    $('lvReply').hidden = true;
    $('lvLetter').hidden = true;
    $('lvEnvelope').hidden = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const perLeg = reduce ? 0 : 1300;
    const t0 = performance.now();
    const total = perLeg * v.legs.length;
    function frame(now) {
      if (id !== replayId || $('letterPanel').hidden) return;
      const t = Math.min(total, now - t0);
      const k = perLeg ? Math.min(v.legs.length - 1, Math.floor(t / perLeg)) : v.legs.length - 1;
      const f = perLeg ? Math.min(1, (t - k * perLeg) / (perLeg * 0.8)) : 1;
      const legs = v.legs.slice(0, k).concat([cutLeg(v.legs[k], f)]);
      const cur = legs[legs.length - 1];
      const at = f >= 1 ? cur.end : cur.landing;
      const last = k === v.legs.length - 1 && f >= 1;
      drawViewed({ ...v, legs, pos: { lat: at.lat, lon: at.lon }, delivered: last && v.delivered });
      const L = v.legs[k];
      $('lvStatus').textContent = `Day ${k + 1}: ${fmt(L.km)} km as a ${L.fold}${outcomeText(L)}`;
      if (t < total && !last) requestAnimationFrame(frame);
      else finish();
    }
    requestAnimationFrame(frame);
  }

  function cutLeg(L, f) {
    if (f >= 1) return L;
    const n = Math.max(2, Math.ceil(L.path.length * f));
    const path = L.path.slice(0, n);
    const p = path[path.length - 1];
    return { ...L, path, driftKm: 0, landing: { lat: p[0], lon: p[1] }, end: { lat: p[0], lon: p[1] } };
  }

  function outcomeText(L) {
    if (L.outcome === 'delivered') return ', and it arrived.';
    if (L.outcome === 'afloat') return ', then a night floating at sea.';
    if (L.outcome === 'ashore') return `, then it drifted ${fmt(L.driftKm)} km and washed ashore.`;
    return '.';
  }

  function finish() {
    const v = viewed;
    drawViewed(v);
    $('lvReplay').hidden = false;
    if (v.delivered) {
      const box = $('lvLetter');
      box.replaceChildren();
      const h = document.createElement('p');
      h.className = 'letter-head';
      h.textContent = v.fromName ? `From ${v.fromName}:` : `From ${v.from.name}:`;
      box.appendChild(h);
      const body = document.createElement('blockquote');
      body.textContent = v.letter || '(The envelope was empty, but it came a long way.)';
      box.appendChild(body);
      openEnvelope(v, () => { if (!$('letterPanel').hidden) box.hidden = false; });
      const inFlight = journey && !journey.delivered;
      $('lvReply').textContent = inFlight ? 'Go to your letter in flight' : 'Write one back';
      $('lvReply').hidden = false;
      $('lvStatus').textContent = `Delivered after ${v.legs.length} ${v.legs.length === 1 ? 'day' : 'days'}.`;
    } else {
      $('lvStatus').textContent = `Still flying: ${fmt(distanceKm(v.pos, v.to))} km to ${v.to.name}. Ask for a new link tomorrow.`;
    }
  }

  // The sealed envelope opens: seal pops, flap lifts, letter slides out.
  function openEnvelope(v, done) {
    const env = $('lvEnvelope');
    const id = replayId;
    env.className = 'env-anim';
    env.querySelector('.ea-to').textContent = v.toName || v.to.name;
    env.querySelector('.ea-letter').textContent = (v.letter || '').split('\n').slice(0, 3).join('\n');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { env.hidden = true; done(); return; }
    env.hidden = false;
    const smooth = { behavior: 'smooth', block: 'center' };
    requestAnimationFrame(() => env.scrollIntoView(smooth));
    const step = (ms, fn) => setTimeout(() => { if (id === replayId && !env.hidden) fn(); }, ms);
    step(450, () => env.classList.add('open'));
    step(1100, () => env.classList.add('out'));
    step(2000, () => env.classList.add('done'));
    step(2350, () => {
      env.hidden = true;
      done();
      requestAnimationFrame(() => $('lvLetter').scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    });
  }

  $('lvOpen').addEventListener('click', replay);
  $('lvReplay').addEventListener('click', replay);
  $('lvReply').addEventListener('click', () => {
    const v = viewed;
    clearHash();
    if (journey && !journey.delivered) { showJourney('route'); return; }
    showSetup({ from: v.to, to: v.from, fromName: v.toName, toName: v.fromName });
  });
  $('lvOwn').addEventListener('click', () => {
    clearHash();
    replayId++;
    showDesk();
  });
  window.addEventListener('hashchange', () => {
    const code = letterCodeFromHash();
    if (code) showLetter(code);
  });

  return {
    start() {
      const code = letterCodeFromHash();
      if (code) { showLetter(code); return; }
      showDesk();
    },
    showJourney,
    showDesk,
    back: () => (lastMenu === 'journey' && journey ? showJourney() : showDesk()),
    backLabel: () => (lastMenu === 'journey' && journey ? 'Back to map' : 'Back to desk'),
    hasJourney: () => !!journey,
    onDailyLanding,
    openShare: () => lastLeg && openShare(lastLeg),
    get journey() { return journey; }
  };
}
