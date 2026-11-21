# Airmail

Write a letter, fold it into a paper plane and send it to a friend's city. You
get one counted flight a day, carried by the real wind where your plane landed
the day before. Practice flights are unlimited and don't move the letter.

**Stage 2 (this version):**
- Real wind from Open-Meteo, with MET Norway as a backup. If neither answers,
  the game uses the last real wind saved near the plane (up to a day old), then a
  light stand-in wind for that part of the world, so a daily flight is never
  blocked. The game says which one it used.
- A paper-globe route map.
- The journey saved in the browser.
- A share card.

**Real land (Phase B):** each daily flight happens over the real land under
that day's route, built in the browser from free map data: hills and coasts
from elevation tiles, and forests, farmland, towns, lakes, rivers and roads
from OpenStreetMap. The fields that make thermals and the town move onto real
farmland and towns, real cloud cover sets how strong thermals are, and it
rains where it's really raining. Practice flights stay over the practice
valley.

**Play it:** https://lukkrim.github.io/airmail/

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. To try it on a phone on the same Wi-Fi, run
`npm run dev -- --host` and open the "Network" address it prints.

Add `?dev` to the address (http://localhost:5173/?dev) to show a testing link
that allows another counted flight on the same day.

Add `?ground=` to make practice flights fly over real land instead of the
practice valley: `?ground=bigsur`, `fjord`, `alps`, `lakes`, `tuscany`,
`plains`, or any place and throw direction as `?ground=lat,lon,bearing` (for
example `?ground=36.27,-121.81,140`), optionally with metres of real land per
game unit as a fourth number (default 8).

## How a day works

0. **The desk.** The game opens on a writing desk: your letter in flight as an
   envelope (with today's button), fresh paper for a new letter, a practice
   plane, the stamp album and settings. New players see "Start here" on
   practice; their first practice flight is a one-minute flying lesson.
1. **Setup.** Search for the start city and your friend's city, optionally
   write a letter of up to 280 characters, and pick a stamp (three starters,
   plus any you've collected).
   - City search uses Open-Meteo's free geocoding.
   - Results are sorted by population, and places under 5,000 people are
     hidden behind a "Show smaller matching places" link. Searching "Beijing"
     shows the capital first, not the villages with the same name.
2. **Journey map.** The map shows:
   - the route so far, drawn as airmail stripes;
   - a dotted line for the distance still to go;
   - the real wind at the plane right now;
   - a countdown to tomorrow's flight once today's flight is used.
3. **Today's flight.** The wind panel is locked to the real 10 m wind at the
   plane, converted to tailwind, headwind or crosswind relative to your throw.
   You can aim up to 90° either side of your friend's direction, which changes
   how the wind hits you. The land ahead is the real land in that direction;
   moving the aim turns the map (it redraws in about a second).
   - The course is laid out like the journey: one game unit is the day's pace
     in real metres, so the land under the plane is the land the letter
     crosses. Hills are fitted into a flyable range, and a launch hill is
     added that clears the first ridge ahead.
   - The map tiles are saved on the device, so a course seen once can be
     rebuilt offline. If the map can't load, the flight is over the practice
     valley and the throw card says so.
4. **Landing.**
   - The flight is laid onto the real map along the throw bearing, using that
     day's pace (see below).
   - If the plane comes down at sea, it drifts downwind. The drift grows with
     the wind and with the day's pace. It washes ashore if it reaches land, and
     otherwise floats until the next day's flight.
   - Passing close to your friend's city delivers the letter, and the map then
     shows it. "Close" is 120 game units at that day's pace, and never less
     than 30 km.
   - Each daily landing earns the stamp of the country it came down in (or
     "At sea"). A new one drops onto the landing postcard and goes in the album.
5. **Share.** You get a 1080×1350 image, a short text line and a link. The
   phone's share sheet is offered where the browser supports sharing files.
   - **While the letter is flying,** the link lets anyone follow the route so
     far. The letter stays sealed and is never put into an in-flight link.
   - **Once it's delivered,** the journey screen shows "Send the letter to
     Alex". That link opens a view with the cities and the sealed letter.
     "Open the letter" replays the journey day by day on the map, then reveals
     the letter.
   - **Write one back** opens setup with the cities and names swapped.

### Links

The whole journey is packed into the link's `#letter=` fragment:
- cities and names;
- each day's outcome, fold, km and time;
- up to 24 route points per day, at about 100 m precision;
- the letter, in delivery links only.

The data is compressed with `deflate-raw` and is usually 0.3–1.1 KB. Browsers
don't send the part after `#` to the web server, so the letter text never
passes through any server. See `src/journey/link.js`.

A link only opens for other people once the game is online. On `localhost`,
the share screen says so.

### Pacing: skill decides how many days the letter takes

Each journey gets one fixed pace when it starts:

> km per game unit = route km ÷ (6 days × 1,250 units)

1,250 units is the forward distance of a typical flight over real land under
real-world winds, measured with `node scripts/sim/real-pacing.mjs` (12 varied
real courses: coasts, plains, the Alps, fjords, the Andes, open sea). A typical flight covers a sixth of
the route whatever the distance: about 84 km for Lisbon → Madrid, about 1,700 km
for Beijing → San Diego. Flying further by using thermals, ridges and a good aim
gets the letter there sooner.

The landing card rates every counted flight against a typical day ("Great
flight: 2.3× a typical day"). The journey screen says how far a typical flight
goes and how many days remain at that pace.

**Safety net.** From day 9, each flight counts 1.5× further than the day before,
so a struggling player still finishes. It can't help anyone who is on pace.

Simulated delivery days (4,000 journeys per player type, real-world-like random
winds):

| Player (flight vs typical) | Usually delivers on | Distribution |
|---|---|---|
| Great (2×) | day 3–4 | 3d 63%, 4d 35% |
| Good (1.6×) | day 4–5 | 3d 10%, 4d 67%, 5d 23% |
| Average (1×) | day 5–7 | 5d 12%, 6d 57%, 7d 28% |
| Below average (0.8×) | day 7–9 | 7d 37%, 8d 45%, 9d 13% |
| Weak (0.65×) | day 8–10 | 8d 15%, 9d 65%, 10d 20% |
| Very weak (0.45×) | day 10–11 (safety net) | 10d 18%, 11d 78% |

In-game checks:
- A hands-off Beijing → San Diego run with today's real winds delivered on day 5.
- A player who landed after 22 seconds every day delivered on day 12.

The letter is delivered when the flight passes within 200 game units of the
city at the journey's pace: 341 km for Beijing → San Diego, and never less than
30 km.

Everything is stored in this browser's `localStorage` (`airmail.journey.v1`).
Clearing site data ends the journey.

## Deploying

Every push to `main` builds the game and publishes it to GitHub Pages at
https://lukkrim.github.io/airmail/. The workflow is
`.github/workflows/deploy.yml`.

The build is static files with relative paths, so other static hosts work too.
Run `npm run build` and upload `dist/`. The game calls Open-Meteo and MET Norway straight from
the player's browser, so no backend is needed.

## Controls

| | Keyboard / mouse | Touch |
|---|---|---|
| Throw / throw again | Space or Enter | Throw button |
| Climb (trade speed for height) | Hold Space, W, ↑ or the mouse button | Hold the climb button |
| Let go | Nose drops into a dive to win speed back, then settles into a glide | Let go |
| Steer | A / D or ← / → | ◀ ▶ |
| Hard dive | S or ↓ | none |
| Re-throw at any time | R | none |
| Pick fold before throwing | 1 / 2 / 3 | Tap a fold |

## What's in the course

You throw from a hilltop toward the far end of a valley. The sea runs along the
right side, mountains run along the left, and the coast curves across the far end.

- **Wheat fields** make thermals. Circle in them to climb, as a real glider does.
  Paper scraps spiral up each one, and a white cloud marks its top. Thermal
  columns lean downwind.
- **Windward hillsides and the mountain wall** give ridge lift when the wind
  blows into them. Behind a hill (the lee side) the air sinks.
- **Two rain clouds** push you down. Fly around them.
- **The town** makes a weaker thermal. Its rooftops count as a landing.
- **Wind streaks** show the air: white for wind, orange where it rises, blue
  where it sinks. The tag at the top of the screen names the lift or sink
  you're in, and the bar on the right shows your climb rate.
- **The minimap** shows the course with the far end up: thermals in orange, rain
  in slate, your path in red.

Distance is the straight line from the launch point. It's also shown in km as if
one flight were 50–300 km on the real map (`kmPerUnit`).

## Tuning

Every knob is in [`src/core/config.js`](src/core/config.js):

- **`folds`**:
  - `bestSpeed` and `glideRatio` set the basic feel.
  - `climbLift`, `diveLift`, `liftResponse` and `swoopDamping` shape how
    holding and letting go feel.
  - `maxBankDeg` and `rollRateDeg` set how tightly each fold turns.
  - `canLoop` lets the Stunt pull full loops.
- **`wind`**: the slider range, the starting wind and the presets.
- **`lift`**:
  - thermals: strength, radius, top, lean and the sink ring around them;
  - ridge lift and lee sink;
  - rain-cloud sink.
- **`journey`**:
  - `averageDays`, `typicalFlightUnits` and `minKmPerUnit`: set the pace.
  - `catchUpFromDay` and `catchUpGrowth`: set the safety net.
  - `deliverRadiusUnits` and `deliverRadiusKm`: set how close counts as
    delivered.
  - `windScale`: multiplies the real wind before it reaches the game.
  - `aimRangeDeg`: how far either side of your friend you may aim.
  - `driftKm` and `driftKmPerMs`: how far a sea landing drifts.
  - `weatherCacheMinutes`: how long a wind reading is reused.
- **`kmPerUnit`**: km per game unit for practice flights when there's no
  journey yet. It is also the baseline that sea drift is scaled from.
- **`launch`, `camera`, `streaks`**: launch height and angle, the chase
  camera, and the look of the air streaks.

Four Node scripts in `scripts/sim/` check tuning changes without opening the browser:

```bash
node scripts/sim/simulate.mjs
```

```bash
node scripts/sim/lift-check.mjs
```

```bash
node scripts/sim/skill-spread.mjs
```

```bash
node scripts/sim/real-pacing.mjs
```

- `simulate.mjs` flies scripted pilots (hands-off, speed-keeper, thermal-hunter)
  with every fold and wind preset. It prints distance, km and time aloft.
- `lift-check.mjs` prints the lift at known spots: thermal core, rain cloud,
  windward and lee slopes.
- `real-pacing.mjs` downloads 12 real courses, flies a hands-off and a
  thermal-using pilot over each with the same winds, and prints days to
  deliver for six skill levels (add `--cloudy` for overcast skies). It needs
  the internet.
- `skill-spread.mjs` measures how far each kind of pilot gets under random
  winds, then simulates how many days each player type takes to deliver. Run it
  after changing the pacing knobs.

The hands-off baseline with the default 4 m/s tailwind:

| Fold | Time aloft | Distance |
|---|---|---|
| Dart | 51 s | 110 km |
| Stunt | 61 s | 107 km |
| Glider | 81 s | 121 km |

Using thermals and ridges should stretch these.

In the browser console, `__airmail` exposes the config, the plane and the wind,
plus `advance(seconds)` to fast-forward a flight and `setClock('2026-11-19T22:00')`
to preview another time of day (`setClock(null)` goes back to the real clock).
`photo([x, y, z], [tx, ty, tz])` parks the camera to look at something (`photo(null)` releases it).

## Files

The plan for the next stage is in [`plan.md`](plan.md).

| Folder | File | What it holds |
|---|---|---|
| `src/` | `main.js` | Game states (menu, aim, flying, landed), daily and practice modes, input, camera, HUD |
| `src/core/` | `config.js` | All tuning knobs |
| | `settings.js` | Player settings saved on the device (sound, units, time of day, motion) |
| | `units.js` | Distances in km or miles |
| | `haptics.js` | Phone vibration patterns |
| `src/audio/` | `sound.js` | All sound, synthesised with Web Audio: effects, wind, climb beeps |
| | `noise.js` | Seeded random numbers, noise and small math helpers |
| `src/` | `boot.js` | Starts the game; loads real land first when `?ground=` is set |
| `src/environment/` | `world.js` | The course as data: ground height (practice valley or real land), land cover, fields, town, the vertical-air model (thermals, ridge lift, rain sink), buildings to hit |
| | `worldView.js` | Draws the course: blended ground with land cover, lakes and rivers, the sea with sky reflections, land to the horizon, the town, clouds, rain; `rebuild()` after a course change |
| | `bounds.js` | Course size and the near and far areas |
| | `course.js` | Real-land courses for the game: presets, `?ground=`, loading through the worker, lookups |
| | `courseBuild.js` | Builds a real-land course (heights near and far, land cover, launch hill, relief fitting); runs in the worker and in Node |
| | `courseWorker.js` | The background worker |
| | `tiles.js` | Elevation tiles (AWS Terrain Tiles) and land-cover tiles (OpenFreeMap), cached on the device |
| | `cover.js` | Land cover on a grid: rasterises OpenStreetMap polygons and lines, paints the ground texture (fields, forests, towns) |
| | `flora.js` | Trees and houses scattered by land cover, drawn in chunks around the camera |
| | `impostors.js` | Realistic trees: each one a camera-facing quad showing the nearest of 64 baked views, lit with baked normals, with shadows |
| | `cityData.js` | City centres from real OpenStreetMap building heights around the course's biggest towns: towers, mid-rises, malls, warehouses |
| | `city.js` | Draws the city centres: one batch of boxes with a facade shader (floors and window bays at real size, sky-reflecting glass, lit windows at night) |
| | `houses.js` | The realistic house set: loading, styles by region, sky-reflecting windows that light up at night |
| | `houseSet.json` | Written by `build_houses.py`: each house style's size |
| | `meadow.js` | Close-up grass that sways in the wind, flowers, rocks and ferns near a low camera |
| | `atmosphere.js` | Haze that glows towards the sun and patchy valley mist, added to every material |
| | `postfx.js` | Sun rays, glow, filmic tone curve and colour grade (desktop) |
| | `groundSet.json`, `impostorSet.json` | Written by the asset scripts: photo average colours, tree sizes and view layout |
| | `clouds.js` | Soft cumulus over thermals, rain clouds, background clouds as thick as the real cloud cover, high cirrus, and low cloud on hillsides |
| | `land.js` | Coastlines and countries (Natural Earth 1:50m via `world-atlas`, bundled) |
| | `weather.js` | Wind (Open-Meteo, MET Norway backup, saved reading, stand-in), cloud cover and rain along a course, and city search |
| | `geo.js` | Great-circle math, game-to-map conversion |
| | `sun.js` | Real sun position for a time and place |
| | `sky.js` | Day and night: sky dome, sun and moon, stars, lights, lit windows |
| `src/flight/` | `plane.js` | Flight physics (lift and drag model, stall, loops) and the three plane meshes |
| | `effects.js` | Wind streaks and the flight trail |
| | `minimap.js` | The course map |
| `src/journey/` | `journey.js` | The saved journey, the one-flight-a-day rule, and turning a flight into a real-map leg (drift, delivery) |
| | `link.js` | Packing a journey into a `#letter=` link and back |
| | `stamps.js` | The stamp collection saved on the device |
| `src/ui/` | `screens.js` | Setup, journey map, delivered-letter and share screens |
| | `desk.js` | The home desk: the letter in flight, a new letter, practice |
| | `settingsPanel.js` | The settings sheet |
| | `stampArt.js` | Stamp designs: country outlines, starters, at sea |
| | `album.js` | The stamp album page and the album on the desk |
| | `guide.js` | The first-time flying lesson |
| | `routemap.js` | The paper-globe route map |
| | `share.js` | Share image and text |
| | `theme.js` | The postal-paper theme for JS drawing: colours, fonts, paper grain, stamps, postmarks |
| `src/ui/styles/` | `index.css` | Imports, in order: `tokens.css` (colours, fonts, textures), `base.css` (shared components), `hud.css` (flight screen), `screens.css` (menus), `desk.css` (home desk), `motion.css` (screen transitions) |
| `scripts/sim/` | `*.mjs` | Headless tuning checks (see Tuning); `realCourse.mjs` builds real courses in Node; `real-pacing.mjs --cities` flies six courses through big cities (add `--no-city` to compare without the towers) |
| `scripts/blender/` | `build_kit.py` and `model_*.py` | The model kit, built from code in Blender: run `build_kit.py` there (or through the Blender MCP) to rebuild `public/models/*.glb` and preview renders |
| `scripts/blender/` | `build_shophouse.py`, `model_shophouse.py`, `kit_real.py` | The realistic test house: run headless with `Blender -b --factory-startup --python scripts/blender/build_shophouse.py`; it renders, bakes and exports `public/models/house_shop.glb` |
| `src/environment/` | `models.js` | Loads detailed Blender models (the realistic test shop-house) |
| `scripts/assets/` | `polyhaven.py` | Downloads Poly Haven assets (CC0) into `assets-src/` (not committed) |
| | `prepare_ground.py` | Makes the ground photo set: `public/textures/ground/` and `groundSet.json` |
| | `prepare_impostors.py` | Stitches baked tree views into `public/models/impostors/*.webp` and `impostorSet.json` |
| `scripts/blender/` | `bake_impostors.py` | Renders a Poly Haven tree from 64 directions (colour with occlusion, and normals): `Blender -b <tree>.blend --python scripts/blender/bake_impostors.py -- <object> <name>` |
| | `prepare_props.py` | Cuts Poly Haven rocks and ferns down to `public/models/props.glb` |
| | `build_houses.py` | Builds the ten house styles from Poly Haven photo materials, bakes each to one texture and normal map, exports `public/models/houses.glb`: `Blender -b --factory-startup --python scripts/blender/build_houses.py` |

Rebuilding the realistic assets: download with `polyhaven.py` (fir_tree_01,
island_tree_01, island_tree_02, rock_moss_set_01/02, fern_02 as blend or
glTF; leafy_grass, forest_leaves_04, aerial_rocks_02, snow_02,
coast_sand_01, rocky_terrain_02 as textures; for the houses painted_plaster_wall,
brick_wall_006, clay_roof_tiles_02, roof_slates_02, grey_roof_tiles,
distressed_painted_planks, dark_planks, corrugated_iron_02,
box_profile_metal_sheet, rough_pine_door), then run the Blender and
prepare scripts above. All Poly Haven assets are CC0 (public domain).
