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
   then optionally write a letter of up to 280 characters. City search uses
   Open-Meteo's free geocoding.
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
   - The flight is laid onto the real map along the throw bearing, with game
     distance scaled by `kmPerUnit`.
   - If the plane comes down at sea, it drifts downwind about 2.5 km per m/s of
     wind, up to 40 km. It washes ashore if it reaches land, and otherwise
     floats until the next day's flight.
   - Passing within 30 km of your friend's city delivers the letter, and the
     map then shows it.
5. **Share.** You get a 1080×1350 image and a short text line. The phone's
   share sheet is offered where the browser supports sharing files.

Everything is stored in this browser's `localStorage` (`airmail.journey.v1`).
Clearing site data ends the journey.

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
  - `windScale`: multiplies the real wind before it reaches the game.
  - `aimRangeDeg`: how far either side of your friend you may aim.
  - `driftKm` and `driftKmPerMs`: how far a sea landing drifts.
  - `deliverRadiusKm`: how close counts as delivered.
  - `weatherCacheMinutes`: how long a wind reading is reused.
- **`kmPerUnit`**: how many real km one game unit is worth. This sets the
  pace of the journey.
- **`launch`, `camera`, `streaks`**: launch height and angle, the chase
  camera, and the look of the air streaks.

Two Node scripts check tuning changes without opening the browser:

```bash
node scripts/simulate.mjs
```

```bash
node scripts/lift-check.mjs
```

- `simulate.mjs` flies scripted pilots (hands-off, speed-keeper, thermal-hunter)
  with every fold and wind preset. It prints distance, km and time aloft.
- `lift-check.mjs` prints the lift at known spots: thermal core, rain cloud,
  windward and lee slopes.

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
