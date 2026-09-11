# Merging Rotor Run into Skylark

Working notes for folding Rotor Run's helicopter and city into this game behind
a craft-selection screen. The engine refactor on `unified-engine` is the
groundwork; this is what remains and what the analysis turned up.

## Why the two games merge cleanly

They are the same engine. Of Skylark's 80 functions, 43 share a name with one
in Rotor Run; 15 have byte-identical bodies and 20 more differ only in detail.
Both load the same three.js r128 CDN build, and both are rail-based runners
built on the same constant names — `VIEW`, `SPEED0`, `SPEED_MAX`, `SPEED_RAMP`,
`MAX_VX`, `MAX_VY`, `MAX_Y`, `LAT_CLAMP`, `PR` — with different values.

| | Skylark | Rotor Run |
|---|---|---|
| `SPEED0 / SPEED_MAX` | 62 / 136 | 48 / 112 |
| `MAX_VX / MAX_VY` | 96 / 58 | 85 / 55 |
| `MAX_Y` | 330 | 250 |
| `LAT_CLAMP` | 560 | 350 |
| floor | ground contact | `MIN_Y: 7` (hover) |
| start | take-off roll, rotate at Vr | already airborne |
| finale | airfield, land and roll out | helipad, descend onto the mark |

So "plane versus helicopter" is a set of constants, a hover floor, the take-off
states, and the finale. The flight integration itself is the same three lines.

## Where Rotor Run's code lives

Line numbers are into the `<script>` body of `RotorRun/index.html`
(2,774 lines).

| Range | What | Destination |
|-------|------|-------------|
| 9–18 | constants | `heli/config.js` |
| 32–61 | canvases, three setup | **drop** — `view.js` covers it |
| 61–940 | lights, sky, skyline, ground, facades, neon, rooftops, sprawl, streetlights, trees, block infill, living windows, ridges, fairground, coastline, themes, blimp, city life, sun haze, time-of-day | `heli/city.js` |
| 940–1052 | post-processing | **drop** — `post.js` covers it |
| 1052–1564 | building pool, rows, pickups, helipad finale, aerial hazards | `heli/city.js` |
| 1564–1687 | rain weather (also defines `resetTraffic`) | mostly drop; lift `resetTraffic` |
| 1687–1736 | input | **drop** — `input.js` covers it |
| 1736–1851 | audio | drop the bus, keep the rotor timbre |
| 1851–1924 | crash / game over | **drop** — `damage.js` covers it |
| 1924–2056 | update | `heli/helicopter.js` |
| 2056–2583 | HUD | `heli/hud-heli.js` |
| 2583+ | frame, flow, attract | **drop** — `main.js` covers it |

The city block references 59 outside names, but most are object-literal keys
picked up by the scan. The real set is small: `P`, `G`, `scene`, `renderer`,
`hash`, `mulberry32`, `popup`, `chime`, `crash`, `applyWeather`, plus Rotor
Run's own constants and `Game.shake` / `Game.flash` / `Game.wind`.

## The three things that make this non-mechanical

**1. Worlds are built at module evaluation.** `countryside.js` constructs its
terrain, scatter and airfield as top-level side effects, and Rotor Run's city
does the same. Two worlds in one page cannot both do that — the unused one
would still build its geometry and add it to the scene. Both need wrapping in
`build()` / `teardown()` before either can be selected, which is invasive for
`countryside.js` and is the real prerequisite.

**2. Each world owns its own sky.** `sky.js` is currently Skylark's sky: one
`TODS` table of sunlit countryside times of day. The city's look is dusk →
night → midnight → dawn with its own fog, dome gradient and light colours. So
`sky.js` has to become a dome plus an *applier*, with each world supplying its
own table — it is not shared infrastructure in its present form.

**3. The HUD is per-craft, not shared.** `hud.js` is brass gauges, a chart, an
approach picture and cowling damage — 33 KB of aeroplane. The helicopter's is a
different instrument set. These are two implementations of one interface
(`drawCockpit`), not one with variants.

## Suggested shape

```
engine/   view post input audio overlays logbook state util
plane/    config countryside hud flight      (today's Skylark)
heli/     config city        hud flight      (ported from Rotor Run)
main.js   frame loop, menu flow, and the selection that picks a pair
```

`Craft` — envelope constants, `begin()`, `update(dt, input)`, `drawCockpit()`.
`World` — `build()`, `reset(lvl)`, `update(dt)`, `teardown()`, `groundH(x,z)`,
`applyTheme(lvl)`, and a finale that reports landed / missed / still running.

Design both interfaces against **both** implementations at once. Deriving them
from the countryside alone would miss the city's pooling and ground rebasing,
and the airfield's take-off roll has no counterpart on a helipad.

## Order of work

1. Wrap `countryside.js` in `build()` / `teardown()`; prove the suite still
   passes. This is the prerequisite and the riskiest single step.
2. Split `sky.js` into a dome and a per-world time-of-day table.
3. Lift the plane's flight and finale out of `main.js` into `plane/flight.js`.
4. Port `heli/city.js`, then `heli/flight.js`, then `heli/hud.js`.
5. Selection screen; one logbook, scores tagged by craft.
6. Retire `rotor-run` — the hub card and the subdomain — only after sign-off.
   Keep its repo and deployment alive until then.
