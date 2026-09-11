# Skylark Run

Two aircraft over two worlds, in the browser. A monoplane threading a ring
course over sunlit countryside and landing on a grass strip; a helicopter
holding a hover between lit towers after dark and setting down on a pad. You
pick one at the front door.

Rotor Run was a separate game. It ran on the same engine as this one — 43 of
80 functions shared a name, 15 of them byte for byte — so rather than keep two
copies of the bloom, the input, the audio and the logbook, it was folded in
here and the two aircraft became implementations of one interface.

## How it fits together

```
src/
  engine    view sky clouds weather post input audio overlays state util
            logbook damage — shared by both aircraft
  plane/    config world hud flight    the monoplane and its countryside
  heli/     config world hud flight    the helicopter and its city
  main.js   frame loop, menu flow, and the picker that chooses between them
```

A **Craft** answers a handful of questions: which states it owns, how to tick
one, how to rig a camera, how to draw its own cockpit, and how a sector starts
and advances. main.js knows nothing else about what is flying.

Craft are brought in with a dynamic `import()`, not at the top of the file.
Each one builds a world — a procedural heightfield, or a city of pooled
buildings — and loading both to fly one would cost that twice over.

The whole of "plane versus helicopter" is a table of constants with matching
names, a hover floor, whether a sector opens on a runway or already airborne,
and whether it ends on a strip or a pad:

| | Skylark | Rotor |
|---|---|---|
| `SPEED0 / SPEED_MAX` | 62 / 136 | 48 / 112 |
| `MAX_Y` | 330 | 250 |
| `LAT_CLAMP` | 560 | 350 |
| floor | the ground | `MIN_Y: 7`, a hover floor |
| start | take-off roll, rotate at Vr | airborne |
| finale | airfield, land and roll out | helipad, down onto the mark |

Both fly for the same logbook.

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
- **Scatter** (woodland, hedgerows, farmsteads, rocks) is a deterministic cell
  grid rebuilt in instanced meshes whenever the aircraft crosses a cell boundary.
- **Post** is a hand-rolled bloom + god-ray + grade chain on core Three.js only.
- **The cockpit** is drawn in 2D over the render: brass gauges, a magnetic
  compass, a paper chart on the knee, and a parasol wing overhead.
- **Contact shadows** without shadow maps: the sun is fixed for a sector, so
  scenery gets a soft instanced blob thrown away from it, and the aeroplane gets
  a silhouette on the ground. That one is cast forward at a fixed rake rather
  than honestly — the sun is ahead of you in every sector, so a true projection
  would hide your own shadow behind the tail forever.

Measured cost is about 0.7 ms of JavaScript per frame (0.07 ms simulation,
0.66 ms cockpit); the rest is GPU.

## Development

Screenshot any state headlessly with the shared shot tool:

```
node C:/Claude/Tools/shot/shot.mjs ./index.html --viewport 1280x720 --wait 4000 \
  --eval "window.SKY.play()" --out shots/play.png
```

`window.SKY` is the test hook: `takeoff()`, `play()` (takes off for you), `approach()`, `step(n, dt)` to advance
the simulation without waiting on frames, `hold(true)` to freeze the clock while
still rendering, and `fx(false)` to drop the post chain.

The smoke test drives all of that — the take-off roll, the ring course, a flown
approach, a go-around and a heavy arrival — and fails on any console error:

```
node tools/headless-test.mjs     # the game: flight, gates, approach, logbook
node tools/api-test.mjs          # the leaderboard endpoint, without a live store
```
