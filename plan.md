# Airmail: stage two plan

Stage one built the flight, real wind, the saved journey, the route map and the
friend links. The game is live at https://lukkrim.github.io/airmail/.

Stage two is about polish: a real theme and better UI/UX, a flight course built
from the real land under each day's route, a papercraft look made with Blender,
and a better route map. The friend playtest is skipped for now.

## Decisions (agreed 2026-11-19)

| Question | Decision |
|---|---|
| Art direction | **Realistic world, paper interface** (changed 2026-11-19 after the realistic test house). Terrain, trees, buildings and sky look real; desk, postcards, stamps and menus stay paper. Was: realistic papercraft. |
| Engine | **three.js in the browser** (2026-11-20). Unreal was considered for the landscape and set aside: it can't export to the web, a hand-sculpted map doesn't fit routes that go anywhere on Earth, and it isn't scriptable from here. |
| 3D models | **Blender**, driven by Python (`bpy`) scripts that generate each model, so models are repeatable and easy to tweak. Exported as compressed glTF. |
| Landscape | Generated in code from real map data, never modelled by hand. |
| Long routes | A day's course is a **squeezed summary** of the real land along the route. True scale is impossible on long routes. |
| Order | **A → B → C → D → E**, starting with Phase A. Phase F (competition) was added 2026-11-20 and only needs Phase B, so it can come before C and D. |
| Competition | **Daily Sky + par** (2026-11-20): one shared daily throw with a leaderboard, and letter flights scored against par. |

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

Progress (2026-11-21): **Phase B is built and live.** Daily flights fly over
the real land under the route. How it works:
- A background worker (`courseWorker.js` → `courseBuild.js`) loads elevation
  tiles near the course and out to the horizon, and OpenStreetMap land-cover
  tiles (forest, farmland, towns, lakes, rivers, roads, coastline, town
  names), then builds height grids and a land-cover grid. About 1–2 s.
- The course is laid out like the journey leg: game −Z along the aim, one
  unit = the day's pace in real metres. Moving the aim redraws the land.
- Relief along the flight path is fitted into a flyable range (at most 140
  units), and the launch hill clears the first ridge ahead on a normal glide.
- Fields and the town move to real farmland and towns near the flight line;
  over open sea there are weaker thermals. Real cloud cover sets thermal
  strength; rain clouds sit where it's raining now (Open-Meteo).
- Drawing (`worldView.js`): the natural ground colour (height, slope, rock,
  snow, climate and season) under a land-cover texture with three sizes of
  grain; lakes and rivers; a see-through sea with sky reflections; land to
  the horizon with haze; forests and houses drawn in chunks near the camera;
  soft clouds.
- Pacing over real land checked with `scripts/sim/real-pacing.mjs` (12 varied
  courses): good 3–5 days, average 5–7, weaker 7–10. A typical flight is now
  1,250 units.

Known gaps: lakes are drawn but landing on one counts as ground; houses in
real towns are scenery (only the game's town block can be hit); trees are
simple code-made shapes (Phase C can make better ones); not yet tried on a
real phone; a daily course works offline only if its map tiles were loaded
before (they're cached on the device).

**Courses must be deterministic** (needed for Phase F): the same place,
bearing, date and wind must build exactly the same course on every device and
on a server, so nothing in a course may use `Math.random` or the device's clock.

### B1. Data (free, no account keys)
- [x] Elevation and sea depth: AWS Terrain Tiles (Terrarium PNG).
- [x] Land cover: OpenStreetMap vector tiles (OpenFreeMap) for water,
      farmland, forest, towns and roads.
- [x] Today's weather: Open-Meteo for cloud cover and rain along the course.

### B2. Building the course
- [x] Sample a strip of land along a direction (test: `?ground=`).
- [x] Use it for daily flights, along today's direction to the friend.
- [x] Short routes (about 84 km a flight): close to true scale.
- [x] Long routes (about 1,700 km a flight): the real land squeezed by the
      journey's pace, keeping the coastline, mountains and towns.
- [x] Exaggerate hills vertically so they read clearly.
- [x] Keep a launch hill so every flight starts fairly.

### B3. Gameplay from real features
- [x] Thermals over real farmland and towns, stronger when it's sunny there.
- [x] Ridge lift from real slopes; lee sink behind them.
- [x] Rain sink where it's actually raining now.
- [x] Sea where the route really crosses water.
- [x] Re-run the pacing checks so good, average and weaker players still land
      in 3–5, 5–7 and 7–10 days (`scripts/sim/real-pacing.mjs`).

### B4. Speed and reliability
- [x] Load and build the course in a background worker; it starts while the
      player reads the journey page.
- [x] Cache each day's course (map tiles on the device, built courses for the
      session).
- [x] Offline or on error, fall back to the practice valley.
- [x] Real sun position sets the time of day and shadow direction (Phase A).

**Done when:** a daily flight from any city pair shows recognisable real land,
lift comes from real features, pacing targets still hold, and the game still
works offline.

---

## Phase C: Realistic models and rendering (about 2–3 weeks)

Goal: the realistic look (changed from papercraft on 2026-11-19). Phase B
already draws realistic ground, water, forests, houses and clouds in code;
Phase C replaces the simple code-made trees and houses with detailed Blender
models (baked like the test shop-house), adds regional building styles, and
tunes performance for phones. The papercraft pilot kit below is no longer
placed in the world.

### C1. Blender model kit (`scripts/blender/`)

Pilot done (2026-11-19): a conifer, a broadleaf tree and a cottage, built by
`scripts/blender/build_kit.py` through the Blender MCP connection, exported to
`public/models/` (9–27 KB each) and placed in the game as instances: the
forest and every town and farm house, with the town's roof and wall inks and
cottage windows that light up at night. Paper look: flat creased facets, a
slightly different shade per facet, pale cut edges on the roof card, the
game's paper grain.

- [ ] Install Blender (free) on the build machine.
- [ ] `bpy` scripts that generate each model:
  - the three paper planes (Dart, Glider, Stunt);
  - buildings in a few regional styles;
  - trees, boats, windmills, lighthouses;
  - clouds, gulls, sheep.
- [ ] Export as compressed glTF (Draco or meshopt) into `public/models/`;
      about 2–5 MB in total, shared by every course.
- [ ] One command regenerates the whole kit.

Realistic test (2026-11-19): `scripts/blender/build_shophouse.py` builds a
detailed shop-house (about 20,000 triangles: ~800 clay tiles, lattice
storefront, corrugated awning, utility pole and wires, leaf-card ivy) with
procedural realistic materials, renders it with Cycles, bakes colour,
weathering and occlusion into one 2048 px texture and exports
`public/models/house_shop.glb` (2.3 MB). It runs in a headless Blender so long
renders can't disturb the open one. The game shows it beside the throw spot.
Decision pending: realistic world vs papercraft.

### C2. Lighting and look

Realism pass done (2026-11-20), all in the browser (the user chose this over
switching to an app). Aim: get as close as a browser can to the reference
render the user shared (forest, river, misty mountains).

- [x] Photo ground: Poly Haven textures (CC0) for grass, forest floor, rock
      (mapped from three sides on cliffs), snow and sand close up, an aerial
      texture further out, all with normal maps. The real map's colours stay;
      the photos add detail (`scripts/assets/prepare_ground.py`).
- [x] Realistic trees: Poly Haven firs and broadleaves baked in Blender into
      impostors, 64 views each with normals
      (`scripts/blender/bake_impostors.py`, `scripts/assets/prepare_impostors.py`).
      One quad per tree, lit by the sun, casting shadows, with light shining
      through the leaves against the sun. 9,000 drawn on desktop, 3,000 on
      phones. A few big trees frame the throw hill.
- [x] Close-up ground: swaying grass tufts, wild flowers, mossy rocks and
      ferns (Poly Haven, cut down in `scripts/blender/prepare_props.py`) near
      the camera when it's low.
- [x] Air: haze that thickens with distance and glows towards the sun; patchy
      valley mist; high cirrus; soft low cloud on the hillsides.
- [x] Real directional shadows; stronger sun, softer skylight, deeper sky.
- [x] Camera look (desktop): sun rays past hills and trees, a soft glow, a
      filmic tone curve, a light grade with darker corners. Phones keep the
      tone curve and skip the extra passes.
- [x] City centres (2026-11-21): real OpenStreetMap building heights
      (`cityData.js`, loaded only around the course's biggest towns, up to 13
      detailed tiles) become towers, mid-rises, malls and warehouses
      (`world.js` makeCity), drawn by `city.js` in one batch with a facade
      shader (real-size floors and bays, glass that reflects the sky, lit
      windows at night). They are solid. The squeezed map packs each
      downtown: fewer, taller buildings the more it's squeezed (22–130); a
      downtown at the throw moves across the valley so the hill overlooks it;
      the glide path and thermal columns stay clear. Pacing unchanged
      (`real-pacing.mjs`; `--cities` checks six city courses).
- [x] Hills and towers cast shadows over the whole course (2026-11-21,
      `terrainShadow.js`): a sun-height map worked out a slice per frame as
      the sun moves, applied to every lit material; valleys fall into shade
      at dusk. Phones too.
- [x] Soft contact shading (desktop): a depth-only ambient-occlusion pass
      in `postfx.js`, so the custom tree, grass and city shaders work with it.
- [x] Lakes, rivers and sea mirror the hills, trees, towns and clouds
      (desktop, `waterReflect.js`): a half-size mirrored render at the water
      height the camera sees most, blended by viewing angle with ripples.
- [x] Shaders compile in the background before the frame that needs them.
- [x] Detailed houses in regional styles (2026-11-21): `scripts/blender/build_houses.py`
      builds cottage, plastered, brick, Nordic red wooden, Mediterranean
      villa, American clapboard with porch, barn and apartment block, plus a
      church and bell tower, from Poly Haven photo materials, each baked to
      one colour texture and normal map (`public/models/houses.glb`, 3.3 MB,
      930–5,500 triangles each). Styles are picked by region (Norway gets red
      wooden houses, Italy villas, the US clapboard, Britain brick), barns in
      the country, a few blocks in towns. Window glass reflects the sky and
      some windows light up at night.

### C3. Weather and time of day
- [ ] Visible cloud cover, rain and haze from the real weather.
- [ ] Night flights with lit-up towns.

### C4. Performance
- [ ] 60 frames per second on a mid-range phone. Not measured yet: the
      realism pass draws about 1.8M triangles a frame on desktop (grass is
      the biggest part); phones get a smaller budget.
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

## Phase F: Competition (decided 2026-11-20: Daily Sky + par)

The problem: players throw from different places on different winds, so
"who flew furthest" isn't fair across players. The fix is to compare players
only where conditions are the same, or to score each flight against what its
own conditions allowed. Chosen: **Daily Sky** for the shared competition and
**par** to make letter flights comparable. It needs only Phase B (real courses
and the pacing simulator), so it can move earlier than C and D.

### F1. Daily Sky (the shared flight)
- [ ] One throw a day for everyone: the same real place, the same real wind
      (a snapshot taken at midnight UTC), the same course. One attempt.
- [ ] The place is picked from a seeded list of good spots (coasts, ridges,
      valleys), so every device picks the same one without a server.
- [ ] Separate from the letter: it doesn't move the letter, and the letter
      flight stays personal.
- [ ] Results: distance, time aloft, and rank (world and friends).
- [ ] Share card with the rank, like "#212 of 4,000", and a link that opens
      today's Daily Sky.
- [ ] A Daily Sky stamp or postmark for the album, and a streak counter.
- [ ] Desk: a Daily Sky item beside the letter envelope.

### F2. Par for letter flights
- [ ] For each day's letter course, a reference pilot (the simulator in
      `scripts/sim/`, run in the browser) flies it with the real wind to set
      *par*.
- [ ] Score = your distance against par (for example 130%), shown on the
      landing postcard.
- [ ] Friends board: average par over the week, so friends anywhere can
      compare.
- [ ] Check that par feels fair: weak, average and good pilots should score
      clearly apart on very different courses (calm plains, windy coasts,
      mountains).

### F3. Server and fair play
- [ ] A small server and database for scores and friends (for example
      Cloudflare Workers or Supabase), on the user's accounts.
- [ ] Simple player names, no passwords at first (a name and a device key).
- [ ] The game sends its recorded inputs; the server replays the flight (the
      physics runs in fixed steps, so a replay gives the same result) and only
      then accepts the score.
- [ ] Courses build identically on every device and on the server (see the
      Phase B note on deterministic courses).

Set aside for later: races between friends (a weekly destination, or duels
where the first delivery wins) and team totals by city or country.

**Done when:** everyone gets the same Daily Sky with a shared leaderboard,
letter flights show a par score, friends can compare both, and replayed
scores reject tampered results.

---

## Phase E: Wrap-up pass (about 1 week)

- [ ] Loading screen.
- [ ] Testing on real phones (iOS Safari, Android Chrome).
- [ ] Installable web app with offline caching.
- [ ] Automatic visual check of key screens before each deploy.
- [ ] Turn off the `?dev` testing button on the live site.

**Done when:** the game installs to a phone home screen, plays offline in
practice mode, and every deploy passes the visual checks.
