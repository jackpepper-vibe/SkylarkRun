# Skylark Run

Air racing over sunlit countryside, in the browser. Pick an aeroplane in the
hangar, roll her down the strip, thread the ring course, and grease the landing
at the far end of every sector of a five-sector tour.

## How it fits together

```
src/
  engine    view atmosphere quality sun clouds weather post input audio
            overlays state util logbook damage active hangar
  plane/    config sky terrain water models world hud flight
            aircraft   the hangar: five types, their handling and engines
            sectors    the tour: each sector's land, light, hazards, objective
            airfields  six field layouts: surface, size, buildings, lights
            cockpit/   index (manager) · kit (shared parts) ·
                       modern vintage biplane cabin trike
  main.js   frame loop and menu flow
```

The engine drives the aeroplane through a **Craft** interface — which states it
owns, how to tick one, how to rig a camera, how to draw its own cockpit, how a
sector starts and advances — so `main.js` has no idea what it is flying. Behind
that interface the five aeroplanes share one flight model: each is a row of
numbers in `aircraft.js` (speeds, authority, bank, Vr, fuel burn, how many hits
the airframe takes, score rating, engine note) and a cockpit module.

`sky.js` lives under `plane/` rather than with the engine: it adds lights to the
shared scene the moment it is imported, which is emphatically a property of one
particular world rather than of the renderer. `sun.js` holds the only thing the
post-processing genuinely needs from a sky — the sun's direction and the
god-ray strength.

three.js (0.186) arrives through the import map in `index.html`; every module
that uses it imports it by name, and the module check fails any that does not.

## Checks

```bash
npm test        # module wiring, then the headless suite
npm run check   # module wiring only
```

`tools/check-modules.mjs` catches what a runtime only reveals when a particular
path is taken: assigning to an imported binding, using a name the module never
imported, assigning to a name declared nowhere. Each of those shipped at least
once during the module split, and one of them broke the Fly button.

`tools/headless-test.mjs` drives the game through `window.SKY` without waiting
on frames, so results do not depend on the software GPU. It also clicks the
real Fly button, because driving only through the test hook is how that broken
button got past it.

## Flying it

| Input | Action |
| --- | --- |
| Tilt (phone) | bank, dive, climb |
| Drag (touch) | same, when tilt is unavailable |
| &larr; &rarr; / A D | bank, on desktop |
| &uarr; &darr; / W S | pitch, on desktop |
| `Esc` / `P` | pause |

Landscape orientation is required on phones; the tilt datum is captured when you
tap **Enable tilt & fly**, and can be re-taken from the pause screen.

### Tilt is only offered where tilt exists

The start screen adapts to the device. Desktop gets **Fly**, keyboard control
hints and no mention of tilt; phones and tablets get **Enable tilt & fly**.

Capability is decided by `(pointer: coarse)` alone. `navigator.maxTouchPoints`
is useless for this — desktop Chrome reports **10** — and `ontouchstart` is no
better. A coarse primary pointer is what actually separates a phone from a
machine with a mouse, and it correctly excludes touchscreen laptops, which have
a fine pointer and no gyroscope.

### Pitch direction

Keyboard pitch follows the **joystick convention** by default: pushing forward
(&uarr; / W) puts the nose *down*, easing back (&darr; / S) brings it *up*. That
also makes "ease back at Vr" literally true on the takeoff roll — the rotate
check looks for a nose-up input.

The checkbox on the start screen switches it back to direct control, where the
arrows move the aeroplane the way they point. The choice persists in
`localStorage` under `skylark-invert-pitch`. Tilt and drag are unaffected;
tilting the nose down has always meant descend, which needs no convention.

**Exit game** on the pause screen shuts the flight down properly — engine off,
out of fullscreen, orientation released, rendering stopped, logbook flushed —
then asks the browser to close the page. A page may only close itself when it
was opened by script or is running as an installed app, so on a normal browser
tab it says so and leaves you on a shutdown card rather than pretending.

## The hangar

**Choose your aircraft** on the start card opens the hangar: the overlay is
clear down the middle, so you sit in each cockpit — engine running, countryside
flying past — while you choose. Arrow keys or A/D step through them, Enter flies.
The choice is kept in `localStorage` under `skylark-aircraft`; after a crash,
**Change aircraft** goes back to the hangar.

| Aircraft | Type | Handling | Airframe | Score |
| --- | --- | --- | --- | --- |
| Skylark Mk II | vintage parasol monoplane: walnut panel, brass dials, leather, a linen wing on struts overhead | middling, forgiving | 3 | ×1.1 |
| Linnet | open-cockpit biplane trainer, flown from the back seat: struts, wires, a float fuel gauge under the top wing | slow, tightest turn | 3 | ×1.0 |
| Wayfarer | enclosed high-wing tourer from the left seat: six-pack, radio stack and map, yokes that move with the controls | stable, sluggish, longest range, quiet | 4 | ×0.9 |
| Dragonfly | flex-wing microlight trike: base bar in gloved hands, A-frame and wires, sail overhead, EFIS and phone map | slowest, shortest take-off, sips fuel | 2 | ×0.8 |
| Sunburst 330 | modern aerobatic single-seater: carbon panel, EFIS, moving map, G-meter | fastest, least forgiving | 3 | ×1.3 |

The cabin shuts out the slipstream (no streaks, a quieter wind and a muffled
engine) and its rain streams back across the screen rather than running down it;
the trike's wing leads the pod into a turn and noses up as the bar goes out.

## The tour

Five sectors, each its own country, and each one ends at a different field — the
next sector takes off from wherever the last one put you down.

| Sector | Land · light · weather | Hazards | Objective | Destination |
| --- | --- | --- | --- | --- |
| 1 Home Meadows | hedged farmland · morning · clear | none | thread 10 rings | Downs Gliding Club (grass, gliders, T-hangars) |
| 2 The Chalk Downs | open chalk fields, few hedges · midday · thermals | power lines, masts | fly under the wires twice | Old Sarum Aerodrome (wartime concrete, arched hangars, water tower) |
| 3 Lake Country | stone walls, dark woods, high water · afternoon · showers | lines, balloons, birds | hit 3 gold gates | Lakeside Flying Club (asphalt, box hangars, lookout tower, lit) |
| 4 Highland Glens | heather, pine, snow on the tops, walls · golden hour · gusts | turbines, masts, birds | hedge-hop for 20 s | Glen Strip (short, narrow gravel, a ruined tower) |
| 5 The Evening Vale | orchards and golden stubble · dusk · clear | all of them | build a ×6 chain | Vale Regional Airport (lit runway, approach lights, terminal glowing) |

Every point is worth a quarter more than in the sector before, times the
aircraft's rating. The objective pays 2,000 the moment it is met and shows its
progress top left. A sector earns up to three stars — the objective, 70% of its
rings, and a good or greased landing — and the best stars per sector are kept
in the logbook. The sector-flown card briefs the next leg: its country, its
hour and weather, the objective, and any hazards new to it.

After sector 5 the tour goes round again (*Home Meadows II*…): every hazard in
play, denser, a thirstier engine, stiffer objectives and a longer course.

## The run

- **Take off first.** Every sector starts at the holding point with the engine
  running. Full power, hold the centreline, and ease back at Vr — she unsticks
  after 200–400 m of roll depending on the type, and climbs away. Leave it too
  late and she flies herself off at the end of the strip; wander off the side
  and you bend her. **Fuel, score and sector distance only start once you are
  airborne.**
- **Gates** score 120 x your chain multiplier, up to x8. Dead-centre is a bullseye.
  Fly past one and the chain breaks.
- **Gold gates** pay treble, and are never on the easy line — down in the hollows,
  out on a limb, low enough over the trees to make you think about it. Roughly two
  or three a sector. The chart and the gate marker both flag them in gold.
- **Fuel drops** put 38 back in the tank — a green and cream parachute canopy
  with a white-cross jerrycan slung under it. Deliberately nothing like the
  hot-air balloons you have to dodge, which are never green. Fuel is the clock —
  it never stops.
- **Hazards** from sector 2, each sector drawing only on its own kinds: pylon
  cables, guyed masts, wind turbines, crewed hot-air balloons and bird flocks.
  Terrain and treetops are always live. The balloons are solid all the way down —
  envelope and basket both. Flying under a power line, between the towers and
  clear of the cable, pays 300.
- **Hedge hopping** under 45 m AGL pays a trickle bonus. So does staying alive.
- **The runway** ends every sector. It is put down while still over the horizon,
  so it fades up out of the haze as you close on it; the approach call comes at
  1100 m. Line up on the centreline, ride the 5-degree slope, and touch down
  softly and straight:

  | Result | Requirement | Bonus |
  | --- | --- | --- |
  | Greased it | sink < 7 m/s, within 10 m of the centreline, wings level | +1500 |
  | Good landing | sink < 13 m/s, within 20 m | +900 |
  | Firm landing | sink < 19 m/s | +400 |
  | Heavy | anything worse | bounce, airframe damage, go around |

  The centreline tolerances shrink with the strip: on the 24 m gravel of the
  Glen Strip they are under half of these.

  Then hold the centreline through the rollout — about 210 m and nine seconds of
  it, drag first and brakes as she slows. Run off the side or off the end and the
  bonus is gone.

Each sector's land is a theme in `terrain.js` with its own relief, ground
palette, hedge or dry-stone-wall boundaries, tree mix (oak, poplar, pine),
farms, boulders and orchards, and its own colours on the far ridges.

## Logbooks

Two of them, and the game never waits on either.

**Yours** — top ten scores, best score, furthest sector and longest chain — is
kept in `localStorage` and shown on the title card. Every access is guarded, so
private browsing or a full quota just means it stays in memory for the session.

**The world board** lives in Neon Postgres behind `/api/scores`:

| | |
| --- | --- |
| `GET /api/scores` | the top ten pilots, best run each |
| `POST /api/scores` | submit `{ name, score, lvl, rings, chain, aircraft }` |

The top ten is on the start card, beside the title, and in the flight report
beside the name entry: rank (gold, silver, bronze), pilot, score, the sector
reached and the aircraft it was flown in, with your own row picked out. When
the world board is unreachable the same table shows this device's ten best
runs instead, and says so. The aircraft is checked against the hangar's ids
(the API test keeps the two lists in step); an unknown one is dropped, not
refused, and rows from before the column existed simply show none.

One row per pilot, keyed on a case-folded pilot name and only overwritten by a
better run (`ON CONFLICT ... WHERE score < EXCLUDED.score`), so the board shows
ten distinct pilots rather than one good session ten times, and `Kevin` cannot
hold a second row as `KEVIN`. Names allow letters, digits, spaces and light
punctuation up to 16 characters; scores are checked for plausibility against the
sector reached, rings and chain are clamped, and submissions are throttled per
address. Names are escaped on render — a name typed into the field reaches the
local logbook before any server sees it.

**On cheating:** the client is a web page, so anyone can post whatever they like
to that endpoint. The bounds keep casual nonsense off the board and nothing more
— treat the world board as a friendly scoreboard, not an authority.

If the store is unprovisioned or unreachable the endpoint says so plainly, the
game shows your local logbook instead, and play is unaffected.

### The store

This project does not own a database. It shares the existing free-plan Neon
store on the Vercel account — `neon-beige-queen`, the one dynamite-dan uses —
in its own tables (`skylark_scores`, `skylark_rate`). Nothing new is billed.

A Marketplace resource can be attached to more than one project:

```
vercel integration resource connect neon-beige-queen skylark-run
vercel deploy --prod          # injected env vars only reach a new deployment
```

The handler reads `DATABASE_URL`, falling back to `POSTGRES_URL`. Tables are
created on first cold start, so there is no migration step.

Because the store is shared, deleting it from another project's dashboard would
take this board with it.

## How it is put together

Systems are small managers with the same shape — build once, `reset(level)`,
`update(dt)` — and everything that scrolls is pooled and recycled.

- **Terrain** is one pure height function driving geometry, scatter placement and
  collision, so what you see is exactly what you hit. Tiles are recycled around
  the aircraft with analytic normals, which keeps the lighting seamless.
- **The field plan** gives every 95 m cell a deterministic plan — pasture,
  arable or wood, its crop, row direction, hedged edges and gate. The scatter
  plants hedges, trees and bales from it, and the ground shader paints from it
  (through a 64 x 64 data texture that slides with the aircraft), so painted
  and planted hedges agree. Crop rows, furrows, tramlines, headlands and mowing
  stripes are drawn per pixel and faded by their own screen-space frequency so
  nothing shimmers; woodland, heath, rock, sand and snow follow land use,
  height and slope.
- **Scatter** (oaks, poplars, pines, hedge runs, cottages, farmhouses, barns,
  rocks, bales) is a deterministic cell grid rebuilt in instanced meshes whenever
  the aircraft crosses a cell boundary. Every model is built once in
  `models.js` as merged geometry with baked vertex colour, in two levels of
  detail: the near set, inside the sun's shadow box, at full detail and casting
  shadows, and the far set with about a quarter of the triangles.
- **The atmosphere** (`atmosphere.js`) replaces three's fog chunks with an
  exponential height haze and a sun in-scatter term on shared uniforms. Every
  fogged material, the sky dome, the clouds and the water evaluate the same
  functions, so land and sky meet at the horizon without a seam.
- **The sky** is a shader dome: a per-time-of-day gradient, procedural cirrus,
  and a sun disc bright enough to bloom.
- **Clouds** are instanced billboards sampling an atlas of cumulus shapes built
  as unions of spheres, so each texel carries an exact normal; the shader lights
  them from the real sun (bright crowns, grey bases, a silver edge into the
  sun). Clusters share one condensation level, sort back to front, and fade as
  you fly into them.
- **Water** reflects the dome's sky through a Fresnel term over two drifting
  ripple layers, with a glitter path under the sun.
- **Shadows**: the sun casts real shadows from a 760 m map laid ahead of the
  aircraft and snapped to its texel grid so edges hold still. Under every object
  there is also a soft contact shade for skylight. The aeroplane's own shadow is
  a silhouette cast forward at a fixed rake rather than honestly — the sun is
  ahead of you in every sector, so a true projection would hide it behind the
  tail forever.
- **Post** renders the scene linear HDR into an R11G11B10 target, blooms only
  what is brighter than paper white through a three-level pyramid, adds the
  god-ray streak, and tone-maps with three's own chunks so the frame grades the
  same with the chain on or off.
- **Quality tiers** (`quality.js`): HIGH has 2048 shadows, 4x MSAA and up to 2x
  pixels; MEDIUM has 1024 shadows and 1.5x pixels; LOW has no shadows and 1x
  pixels. A software rasteriser starts on LOW. After that the tier only ever
  steps down, after two 90-frame windows of flying that average over 24 ms. A
  lost WebGL context comes back on LOW.
- **The cockpits** (`cockpit/`) are 3D geometry in metres round the pilot's
  eye, one module per type, each exporting `build()`. The manager
  (`cockpit/index.js`) owns what they share: the scene and camera, the pilot's
  head (lag in turns and pulls, engine buzz, the strip's rumble), and the
  world's sun and sky turned into the aircraft's frame every frame, with the
  cockpit's own shadow map fitted to each type and sky reflections rebuilt for
  each time of day. A cockpit is built the first time it is chosen and kept.
  The kit (`cockpit/kit.js`) holds the shared parts: canvas textures, the bake
  that flattens static geometry into one mesh per material (so each cockpit
  draws in a few dozen calls), the propeller disc, the windscreen grime (bird
  strikes; rain that runs down an open screen or streams back across a cabin's),
  cowling damage (composite cracks, scraped paint, torn fabric, oil), round
  dials sharing one atlas, lofted airfoil wings and fuselage skins, and the
  moving map, run page and attitude display in paper and glass styles. Every
  cockpit is drawn in its own pass after the world, over a cleared depth
  buffer, into the same HDR target. What no real cockpit has — guidance,
  popups, the objective, the slipstream — stays in the 2D layer (`hud.js`).
- **Airfields** (`airfields.js`) are six layouts — farm strip, gliding club,
  wartime aerodrome, lakeside club, glen strip, regional airport — each with its
  own length, width, surface (mown grass, gravel, slabbed concrete, marked
  asphalt, all painted in metres so markings keep their size on any strip),
  buildings and parked aircraft, lights, and one tall landmark. The buildings
  stand along the first 500 m from the approach end, the stretch you roll past
  on take-off and after landing. Each field is assembled once into a group
  baked into a single mesh, and the two a sector touches are built before it
  starts. At dusk the glazing lights up and the runway lights reach further.

Measured cost is under 0.5 ms of JavaScript per frame. On an Intel Iris Xe the
whole frame takes 9–16 ms at 1280 x 720 on the HIGH tier, depending on the
aircraft and on how warm the GPU is — measure types against each other in one
session (`--perf --aircraft`), not across launches.

## Development

Judge the look on the real GPU, not in the software renderer:

```
node tools/look.mjs                  # posed captures into shots/look/
node tools/look.mjs shots/x cruise   # just some poses
node tools/look.mjs shots/ac --aircraft   # every cockpit, on the roll and cruising, and the hangar
node tools/look.mjs shots/s --sectors     # every sector: holding point, cruise, the field on approach
node tools/look.mjs --perf           # frame time in the cruise pose, vsync off
node tools/look.mjs --perf --aircraft     # every aircraft's frame time, interleaved in one session
AIRCRAFT=linnet node tools/look.mjs  # any of the above in a given aircraft
PROBE="SKY.fx(false)" node tools/look.mjs --perf   # price a feature by turning it off
```

Screenshot any state headlessly with the shared shot tool:

```
node C:/Claude/Tools/shot/shot.mjs ./index.html --viewport 1280x720 --wait 4000 \
  --eval "window.SKY.play()" --out shots/play.png
```

`window.SKY` is the test hook: `takeoff()`, `play()` (takes off for you), `approach()`, `step(n, dt)` to advance
the simulation without waiting on frames, `hold(true)` to freeze the clock while
still rendering, `fx(false)` to drop the post chain, `quality()` / `setQuality(t)`
for the graphics tier, `gfx()` for the renderer and scene, `setAircraft(id)` /
`aircraft()`, `toSector(n)` to start sector n at its holding point, and
`hangar()` to open the hangar.

The smoke test drives all of that — the take-off roll, the ring course, a flown
approach, a go-around and a heavy arrival, every aircraft's take-off, the whole
tour's fields and hazards, a pass under the wires, a landing on the glen strip
and the briefing that follows, and the real start and Fly buttons — and fails
on any console error:

```
node tools/headless-test.mjs     # the game: flight, gates, approach, logbook
node tools/api-test.mjs          # the leaderboard endpoint, without a live store
```
