// Every tuning knob for the Airmail glide prototype lives here.
// Units: 1 world unit ≈ 1 metre, speeds in units per second.
// Change a number, save, and Vite reloads the page.

export const CONFIG = {
  gravity: 9.8,

  // km per game unit for practice flights with no journey yet, and the base
  // the sea drift is measured against. Counted flights use the journey pace.
  kmPerUnit: 0.1,

  // The three folds. Drag and lift constants are derived from bestSpeed and
  // glideRatio in plane.js, so those two numbers set the basic feel.
  // Lift multipliers: 1 = hands-off. Holding climb pulls the nose up and trades
  // speed for height; letting go, the slowed plane drops its nose and dives
  // to win speed back, then settles into a glide.
  folds: {
    dart: {
      name: 'Dart',
      blurb: 'Fast and stiff. Punches through a headwind, but sinks quicker.',
      bestSpeed: 18,        // speed with the flattest glide (hands-off cruise)
      glideRatio: 9,        // distance per unit of height lost, in still air
      stallFactor: 0.6,     // stalls below bestSpeed × this
      climbLift: 1.8,       // lift multiplier while climb is held
      diveLift: 0.4,        // lift multiplier while dive (S / ↓) is held
      stallLift: 0.2,       // lift during a stall
      liftResponse: 4,      // how fast lift changes after input, per second
      swoopDamping: 0.8,    // 0 = endless swoops, higher = settles quickly
      maxBankDeg: 36,       // full steering bank angle
      rollRateDeg: 90,      // how fast it rolls into a bank
      turnFactor: 1.0,      // extra multiplier on turn rate
      throwSpeedFactor: 1.3 // launch speed = bestSpeed × this
    },
    glider: {
      name: 'Glider',
      blurb: 'Floats and climbs well in lift. The wind pushes it around.',
      bestSpeed: 11,
      glideRatio: 11,
      stallFactor: 0.6,
      climbLift: 2.0,
      diveLift: 0.4,
      stallLift: 0.2,
      liftResponse: 3,
      swoopDamping: 0.6,
      maxBankDeg: 40,
      rollRateDeg: 80,
      turnFactor: 1.0,
      throwSpeedFactor: 1.35
    },
    stunt: {
      name: 'Stunt',
      blurb: 'Turns on a coin. Dive, then hold climb to loop. Burns height in long turns.',
      bestSpeed: 14,
      glideRatio: 8,
      stallFactor: 0.6,
      climbLift: 4.0,
      diveLift: 0.2,
      stallLift: 0.2,
      liftResponse: 8,
      swoopDamping: 0.15,
      maxBankDeg: 48,
      rollRateDeg: 200,
      turnFactor: 1.1,
      canLoop: true,        // pitch can go all the way round
      throwSpeedFactor: 1.35
    }
  },

  // Wind slider range and starting value. dirDeg is where the wind blows TO,
  // relative to the throw direction: 0 tailwind, 180 headwind,
  // 90 blows to the right (from the left), -90 blows to the left.
  wind: {
    maxStrength: 12,
    defaultDirDeg: 0,
    defaultStrength: 4,
    presets: [
      { label: 'Calm', dirDeg: 0, strength: 0 },
      { label: 'Tailwind', dirDeg: 0, strength: 8 },
      { label: 'Headwind', dirDeg: 180, strength: 6 },
      { label: 'Crosswind', dirDeg: -90, strength: 8 }
    ]
  },

  // Rising and sinking air.
  lift: {
    thermalStrength: 4.2,    // peak climb in the core of a field thermal
    thermalRadius: 70,       // core radius
    thermalTop: 280,         // thermals fade out this high above their field
    thermalRiseRate: 4,      // used for how far the column leans downwind
    thermalDrift: 0.5,       // 0 = vertical columns, 1 = full drift with the wind
    thermalSinkRing: 0.25,   // gentle sink ring around each thermal (fraction of strength)
    thermalWindPenalty: 0.03,// strong wind weakens thermals by this per unit of wind
    townThermalFactor: 0.6,  // the town makes a weaker thermal than the fields

    ridgeFactor: 1.0,        // lift = wind speed × slope × this, on the windward side
    ridgeDepth: 55,          // ridge lift fades out over this height above the slope
    leeSinkFactor: 0.3,      // sink behind hills, as a fraction of the ridge formula
    maxRidge: 5,             // clamp for ridge lift and lee sink

    rainSink: 3.5,           // sink under a rain cloud's centre
    rainRadius: 110,
    rainCloudBase: 140       // cloud base height above the ground
  },

  // The real-world journey (one counted flight per local calendar day).
  // Pacing: each journey gets one fixed pace when it starts, so skill decides
  // how many days the letter takes. km per game unit =
  //   route km ÷ (averageDays × typicalFlightUnits)
  // A typical flight (~1,250 units forward over real land, hands-off, real-world winds) covers
  // 1/averageDays of the route; better flights cover more.
  journey: {
    averageDays: 6,            // an average pilot delivers in about this many days
    typicalFlightUnits: 1250,  // forward progress of a typical flight over real land (scripts/sim/real-pacing.mjs)
    catchUpFromDay: 9,         // safety net for struggling players only: from this day …
    catchUpGrowth: 1.5,        // … each flight counts this much more than the day before
    minKmPerUnit: 0.03,        // floor so short routes still take a few days
    deliverRadiusUnits: 200,   // delivery radius in game units (× the pace), about a fifth of a typical flight …
    windScale: 1,              // real 10 m wind × this, then capped at wind.maxStrength
    aimRangeDeg: 90,           // how far either side of the destination you may aim
    driftKm: 40,               // most a sea landing can drift downwind in a day at the base scale (scales with pace)
    driftKmPerMs: 2.5,         // drift per m/s of real wind, up to driftKm
    deliverRadiusKm: 30,       // … but never less than this many km
    weatherCacheMinutes: 30
  },

  launch: {
    heightAboveGround: 4,    // throw height above the launch hilltop
    pitchDeg: 4              // initial nose-up angle of the throw
  },

  camera: {
    distance: 16,
    height: 6.5,
    lookAhead: 18,
    lookDown: 3,
    smoothing: 5,
    fov: 62,
    portraitFov: 78
  },

  // Drifting streaks that show the air: white = wind, orange = rising, blue = sinking.
  streaks: {
    count: 260,
    halfWidth: 140,
    halfHeight: 50,
    lengthPerSpeed: 1.4,
    maxLength: 14,
    width: 1.6
  },

  plane: { scale: 2.0 }
};
