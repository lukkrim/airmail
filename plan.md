# Airmail: stage two plan

Stage one built the flight, real wind, the saved journey, the route map and the
friend links. The game is live at https://lukkrim.github.io/airmail/.

Stage two is about polish: a real theme and better UI/UX, a flight course built
from the real land under each day's route, a papercraft look made with Blender,
and a better route map. The friend playtest is skipped for now.

## Decisions (agreed 2026-11-19)

| Question | Decision |
|---|---|
| Art direction | **Realistic papercraft**: the world looks really made of paper (grain, folds, creases, cut edges, soft shadows, real daylight). Not photoreal. |
| 3D models | **Blender**, driven by Python (`bpy`) scripts that generate each model, so models are repeatable and easy to tweak. Exported as compressed glTF. |
| Landscape | Generated in code from real map data, never modelled by hand. |
| Long routes | A day's course is a **squeezed summary** of the real land along the route. True scale is impossible on long routes. |
| Order | **A → B → C → D → E**, starting with Phase A. |

## Folder layout

The code is grouped by what it's about. New work goes in the matching folder.

| Folder | Holds | Future additions |
|---|---|---|
| `src/core/` | Tuning knobs, noise and math helpers | Settings store (Phase A) |
| `src/environment/` | Practice valley, coastlines and countries, weather, Earth math | Real-terrain course builder, map-tile loaders, sun position (Phase B) |
| `src/flight/` | Plane physics and meshes, wind streaks, trail, minimap | Themed instruments (Phase A), model loading (Phase C) |
| `src/journey/` | Saved journey, daily rule, real-map legs, share links | Stamp collection (Phase A) |
| `src/ui/` | Screens, route map, share card, styles | Theme, new screens (Phase A), 3D globe (Phase D) |
| `src/audio/` | New in Phase A | Sound effects and the mixer |
| `scripts/sim/` | Headless flight and pacing checks | — |
| `scripts/blender/` | New in Phase C | `bpy` scripts that generate the models |
| `public/` | New when needed | Fonts, sounds, models (`public/models/`), textures |

---

## Phase A: Theme, UI and UX (about 1–2 weeks)

Goal: one identity across the whole game, **postal paper**.

Progress (2026-11-19): **Phase A is built.** What's left is checking by a
person, which can't be done from here: hearing the sound, trying it on real
phones, and watching a new player catch a thermal with the lesson. Optional extras: paper clips, hand-drawn icons, a
true dark palette, the real moon. The theme lives
in `src/ui/theme.js` (canvas colours, fonts, stamps, postmarks) and
`src/ui/styles/` (tokens, base components, flight HUD, screens).

### A1. Design system
- [x] Colour tokens: airmail red, airmail blue, cream paper, ink, pencil grey.
- [ ] Dark variant of the tokens.
- [x] Paper textures: grain, fibres, a folded-crease overlay (small, tiled,
      bundled).
- [x] Fonts, bundled (no font CDN): a display face for titles, a clean UI face,
      and a handwriting face for letters.
- [x] Visual language: stamps, postmarks, airmail stripes, tape. Shared CSS
      components (card, button, stamp, postmark, field, lined paper).
- [x] Torn edges on every panel (menus and flight cards).
- [ ] Paper clips (later, optional).
- [ ] Icon set drawn in the same pencil-and-paper style (later, optional).

### A1b. Day and night (added 2026-11-19)
- [x] The sky follows the real sun: where the plane is for today's flight, at
      home (the letter's start city, or a guess from the time zone) otherwise.
      Sunrise and sunset glow, stars, a paper sun and moon, lit town windows.
- [x] Menus switch to a night theme (lamplit desk, warmer paper) after dusk at
      the player's home, by their own clock. A dusk desk in between.
- [x] Night changes only the look; lift and physics stay the same (decided for
      fairness across time zones).
- [x] Settings override: always day, always night, or real sun.
- [ ] A real moon position and phase (now a stand-in opposite the sun).

### A2. Redesigned screens
- [x] **Home**: a kraft-paper writing desk with the letter in flight as an
      envelope (status and today's button), fresh paper for a new letter, and
      a paper plane for practice. The game opens here; back links return here.
- [x] Menu panels are pages torn from a writing pad (torn top edge, the next
      page peeking out). Airmail stripes are kept for real envelopes only.
- [x] **Setup**: write the letter on lined paper, address the envelope (from
      and to cities).
- [x] **Setup**: choose a stamp (three starters plus any from your album). It
      shows on the envelope, the friend's letter view and travels in the link.
- [x] **Journey map**: a postal route chart. Each day's landing gets a dated
      postmark.
- [x] **Landing**: a postcard from where the plane came down (place, country,
      km, time aloft, rating).
- [x] **Delivery**: after the replay, the wax seal pops, the flap lifts and the
      handwritten letter slides out of the envelope.
- [x] **Share card**: a postcard with stamps and a postmark, replacing the
      current card.
- [x] Phone layouts for the restyled screens (checked at 375 px).

### A3. Flight screen
- [x] Replace the dashboard numbers with themed instruments: a
      pencil-drawn altimeter, a wind sock, a climb meter, distance on a paper
      tag.
- [x] Minimap as a folded paper map.
- [x] Keep it readable at a glance: big numbers, high contrast over the sky.

### A4. Moments that feel good
- [x] Folding animation: in aim, the sheet opens flat, closes like a book and
      settles into the chosen fold (3D, about 0.9 s, skipped with reduced motion).
- [x] Sound (`src/audio/sound.js`), all synthesised (no audio files): paper
      rustle, throw whoosh, wind that rises with speed, climb beeps in lift,
      landing thud, splash, postmark thump, envelope tear, delivery chime, button taps.
- [x] Light vibration on phones (throw, entering lift, stall, landing, splash,
      delivery). Android only; iOS browsers don't support it.
- [x] Smooth transitions between screens (`src/ui/styles/motion.css`): sheets
      are laid down, desk items set down in turn, cards slide up and back down,
      the postcard drops in, instruments ease in. Reduced motion turns them off.

### A5. Guidance, settings and collection
- [x] First-time flying lesson on the first practice flight: five taped notes
      (throw, climb and dive, find rising air with a pointer, circle, glide) that
      wait for the player to do each thing, then a wrap-up on the postcard.
      Replay it from Settings. The desk marks practice "New? Start here".
- [x] Settings (desk → Settings): sound and volume, climb beeps, vibration,
      km or miles, time of day (real sun, always day, always night), motion.
- [x] Stamp collection: a stamp for every country a daily flight comes down
      in (and one for a night at sea), drawn from the country's real outline.
      The new stamp drops onto the landing postcard and the share image; an
      album on the desk opens a page of every stamp with where and when.

**Done when:** every screen uses the new design system, sound and settings
work, the first-time guide teaches a new player to catch a thermal, and the
game is checked at desktop and phone widths.

---

## Phase B: A real-world flight course (about 2–3 weeks)

Goal: each day's course is built from the real ground under that day's route,
replacing the fixed practice valley in daily flights.

### B1. Data (free, no account keys)
- [ ] Elevation and sea depth: AWS Terrain Tiles (Terrarium PNG).
- [ ] Land cover: OpenStreetMap vector tiles (OpenFreeMap or Protomaps) for
      water, farmland, forest, towns and roads.
- [ ] Today's weather: Open-Meteo (already used) for cloud cover, rain and
      sunshine along the route.

### B2. Building the course
- [ ] Sample a strip of land along today's direction to the friend.
- [ ] Short routes (about 84 km a flight): close to true scale.
- [ ] Long routes (about 1,700 km a flight): squeeze the strip into a summary
      that keeps the main coastline, mountain range and towns of that stretch.
- [ ] Exaggerate hills vertically so they read clearly.
- [ ] Keep a launch hill so every flight starts fairly.

### B3. Gameplay from real features
- [ ] Thermals over real farmland and towns, stronger when it's sunny there.
- [ ] Ridge lift from real slopes; lee sink behind them.
- [ ] Rain sink where it's actually raining now.
- [ ] Sea where the route really crosses water.
- [ ] Re-run the pacing checks so good, average and weaker players still land
      in 3–5, 5–7 and 7–10 days.

### B4. Speed and reliability
- [ ] Load and build the course in a background worker while the player reads
      the briefing.
- [ ] Cache each day's course.
- [ ] Offline or on error, fall back to the practice valley.
- [ ] Real sun position (SunCalc) sets the time of day and shadow direction.

**Done when:** a daily flight from any city pair shows recognisable real land,
lift comes from real features, pacing targets still hold, and the game still
works offline.

---

## Phase C: Paper-world rendering and models (about 2–3 weeks, can overlap B)

Goal: the realistic papercraft look.

### C1. Blender model kit (`scripts/blender/`)
- [ ] Install Blender (free) on the build machine.
- [ ] `bpy` scripts that generate each model:
  - the three paper planes (Dart, Glider, Stunt);
  - buildings in a few regional styles;
  - trees, boats, windmills, lighthouses;
  - clouds, gulls, sheep.
- [ ] Export as compressed glTF (Draco or meshopt) into `public/models/`;
      about 2–5 MB in total, shared by every course.
- [ ] One command regenerates the whole kit.

### C2. Lighting and look
- [ ] Real directional shadows.
- [ ] Soft shading in corners and creases (ambient occlusion).
- [ ] A light paper-grain filter over the whole picture.
- [ ] Crisp paper-edge outlines.

### C3. Weather and time of day
- [ ] Visible cloud cover, rain and haze from the real weather.
- [ ] Night flights with lit-up towns.

### C4. Performance
- [ ] 60 frames per second on a mid-range phone.
- [ ] Quality levels (low, medium, high), chosen automatically, with a
      setting to override.

**Done when:** courses use the model kit, the look matches the papercraft
direction, and performance targets hold on a real phone.

---

## Phase D: Route map upgrade (about 1 week)

- [ ] 3D paper globe in three.js, same paper style; spin and pinch to zoom.
- [ ] Higher-resolution coastlines when zoomed in.
- [ ] Shaded relief so mountains read as paper folds.
- [ ] Country and city labels along the route.
- [ ] Postmark icons where the plane landed each day.
- [ ] Journey replay on the globe.

**Done when:** the globe replaces the flat route map on every screen and in
the replay, and stays smooth on a phone.

---

## Phase E: Wrap-up pass (about 1 week)

- [ ] Loading screen.
- [ ] Testing on real phones (iOS Safari, Android Chrome).
- [ ] Installable web app with offline caching.
- [ ] Automatic visual check of key screens before each deploy.
- [ ] Turn off the `?dev` testing button on the live site.

**Done when:** the game installs to a phone home screen, plays offline in
practice mode, and every deploy passes the visual checks.
