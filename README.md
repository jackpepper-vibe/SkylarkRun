# Skylark Run

Open-cockpit air racing over sunlit countryside, in the browser. Roll her down
the strip, thread the ring course, and grease the landing at the far end of
every sector.

## How it fits together

```
src/
  engine    view atmosphere quality sun clouds weather post input audio
            overlays state util logbook damage active
  plane/    config sky terrain water models world cockpit hud flight
                                        the monoplane and its countryside
  main.js   frame loop and menu flow
```

The engine drives the aeroplane through a **Craft** interface — which states it
owns, how to tick one, how to rig a camera, how to draw its own cockpit, how a
sector starts and advances — so `main.js` has no idea what it is flying. There
is one aircraft today; the seam is there because it made the code easier to
reason about, not because something else is coming.

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

## The run

- **Take off first.** Every sector starts at the holding point with the engine
  running. Full power, hold the centreline, and ease back at Vr (180 km/h) — she
  unsticks after about 400 m of roll and climbs away. Leave it too late and she
  flies herself off at the end of the strip; wander off the side and you bend her.
  **Fuel, score and sector distance only start once you are airborne.**
- **Gates** score 120 x your chain multiplier, up to x8. Dead-centre is a bullseye.
  Fly past one and the chain breaks.
- **Gold gates** pay treble, and are never on the easy line — down in the hollows,
  out on a limb, low enough over the trees to make you think about it. Roughly two
  or three a sector. The chart and the gate marker both flag them in gold.
- **Fuel drops** put 38 back in the tank — a green and cream parachute canopy
  with a white-cross jerrycan slung under it. Deliberately nothing like the
  hot-air balloons you have to dodge, which are never green. Fuel is the clock —
  it never stops.
- **Hazards** from sector 2: pylon cables, guyed masts, wind turbines, crewed
  hot-air balloons and bird flocks. Terrain and treetops are always live. The
  balloons are solid all the way down — envelope and basket both.
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

  Then hold the centreline through the rollout — about 210 m and nine seconds of
  it, drag first and brakes as she slows. Run off the side or off the end and the
  bonus is gone.

Each sector changes the land (meadows, highlands, lakeland, downland), the light
(morning through golden hour) and, from sector 3, the weather (gusts, showers,
thermals).

## Logbooks

Two of them, and the game never waits on either.

**Yours** — top five scores, best score, furthest sector and longest chain — is
kept in `localStorage` and shown on the title card. Every access is guarded, so
private browsing or a full quota just means it stays in memory for the session.

**The world board** lives in Neon Postgres behind `/api/scores`:

| | |
| --- | --- |
| `GET /api/scores` | the top ten pilots, best run each |
| `POST /api/scores` | submit `{ name, score, lvl, rings, chain }` |

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
- **The cockpit** (`cockpit.js`) is the open cockpit of a modern aerobatic
  single-seater, as 3D geometry in metres round the pilot's eye: a glossy
  composite nose in a red sunburst livery with a pointed spinner, a tinted
  wind deflector, a carbon-fibre panel under a matte glare shield, and low
  symmetric-section wings. The panel carries an attitude display (horizon,
  pitch ladder, bank scale, speed and altitude tapes, heading), a moving map
  with the course in GPS magenta, the run page (score, rings, sector,
  airframe), a G-meter with max and min tell-tales, and LED annunciators on
  the glare shield. It is drawn in its own pass after the world, over a
  cleared depth buffer, into the same HDR target, lit by the world's sun and
  sky turned into the aircraft's frame, with its own shadow map and sky
  reflections. Static parts are baked into one mesh per material, so it draws
  in a few dozen calls; the screens are canvases redrawn at their own rates.
  Bird strikes and rain land on the deflector, dents and oil on the nose.
  What no real cockpit has — guidance, popups, the slipstream — stays in the
  2D layer (`hud.js`).

Measured cost is under 0.5 ms of JavaScript per frame; on an Intel Iris Xe the
whole frame takes about 9.5 ms at 1280 x 720 on the HIGH tier.

## Development

Judge the look on the real GPU, not in the software renderer:

```
node tools/look.mjs                  # posed captures into shots/look/
node tools/look.mjs shots/x cruise   # just some poses
node tools/look.mjs --perf           # frame time in the cruise pose, vsync off
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
for the graphics tier, and `gfx()` for the renderer and scene.

The smoke test drives all of that — the take-off roll, the ring course, a flown
approach, a go-around and a heavy arrival — and fails on any console error:

```
node tools/headless-test.mjs     # the game: flight, gates, approach, logbook
node tools/api-test.mjs          # the leaderboard endpoint, without a live store
```
