# Airmail: glide prototype

The first weekend prototype of Airmail. Its only job is to find out whether the
60–90 second paper-plane glide is fun on its own. There is no real map, globe,
weather data, letters, saving or backend yet. Every flight is a practice flight.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. To try it on a phone on the same Wi-Fi, run
`npm run dev -- --host` and open the "Network" address it prints.

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
| `src/main.js` | Game states (aim, flying, landed), input, camera, HUD |
