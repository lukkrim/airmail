# Airmail

Write a letter, fold it into a paper plane and send it to a friend's city. You
get one counted flight a day, carried by the real wind where your plane landed
the day before. Practice flights are unlimited and don't move the letter.

**Stage 2 (this version):**
- Real wind from Open-Meteo.
- A paper-globe route map.
- The journey saved in the browser.
- A share card.

The flight itself still happens over the same practice valley. Building the
landscape from real terrain under each day's route is a later stage.

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

## How a day works

1. **Setup (first visit).** Search for the start city and your friend's city,
   then optionally write a letter of up to 280 characters.
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
   how the wind hits you.
4. **Landing.**
   - The flight is laid onto the real map along the throw bearing, using that
     day's pace (see below).
   - If the plane comes down at sea, it drifts downwind. The drift grows with
     the wind and with the day's pace. It washes ashore if it reaches land, and
     otherwise floats until the next day's flight.
   - Passing close to your friend's city delivers the letter, and the map then
     shows it. "Close" is 120 game units at that day's pace, and never less
     than 30 km.
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
passes through any server. See `src/link.js`.

A link only opens for other people once the game is online. On `localhost`,
the share screen says so.

### Pacing: skill decides how many days the letter takes

Each journey gets one fixed pace when it starts:

> km per game unit = route km ÷ (6 days × 1,000 units)

1,000 units is the forward distance of a typical flight under real-world winds,
measured with `node scripts/skill-spread.mjs`. A typical flight covers a sixth of
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
Run `npm run build` and upload `dist/`. The game calls Open-Meteo straight from
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

Every knob is in [`src/config.js`](src/config.js):

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

Two Node scripts check tuning changes without opening the browser:

```bash
node scripts/simulate.mjs
```

```bash
node scripts/lift-check.mjs
```

```bash
node scripts/skill-spread.mjs
```

- `simulate.mjs` flies scripted pilots (hands-off, speed-keeper, thermal-hunter)
  with every fold and wind preset. It prints distance, km and time aloft.
- `lift-check.mjs` prints the lift at known spots: thermal core, rain cloud,
  windward and lee slopes.
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
plus `advance(seconds)` to fast-forward a flight.

## Files

| File | What it holds |
|---|---|
| `src/config.js` | All tuning knobs |
| `src/plane.js` | Flight physics (lift and drag model, stall, loops) and the three plane meshes |
| `src/world.js` | Terrain, fields, town, the vertical-air model (thermals, ridge lift, rain sink) and the world meshes |
| `src/effects.js` | Wind streaks and the flight trail |
| `src/minimap.js` | The course map |
| `src/main.js` | Game states (menu, aim, flying, landed), daily and practice modes, input, camera, HUD |
| `src/screens.js` | Setup, journey map, delivered-letter and share screens |
| `src/journey.js` | The saved journey, the one-flight-a-day rule, and turning a flight into a real-map leg (drift, delivery) |
| `src/weather.js` | Open-Meteo wind and city search |
| `src/geo.js` | Great-circle math, game-to-map conversion |
| `src/land.js` | Coastlines and countries (Natural Earth 1:50m via `world-atlas`, bundled) |
| `src/routemap.js` | The paper-globe route map |
| `src/share.js` | Share image and text |
| `src/link.js` | Packing a journey into a `#letter=` link and back |
