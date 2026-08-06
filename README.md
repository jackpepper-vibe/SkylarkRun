# Skylark Run

Open-cockpit air racing over sunlit countryside. Thread the gates, keep the chain
alive, then put the aeroplane down on the runway at the end of the sector.

A single self-contained `index.html` — Three.js from a CDN, no build step, no
backend, no APIs. Runs on desktop and installs to a phone home screen as a PWA.

![Lined up on a gate](screenshot.png)

## Flying it

| Input | Action |
| --- | --- |
| Tilt (phone) | bank, dive, climb |
| Drag (touch) | same, when tilt is unavailable |
| WASD / arrows | same, on desktop |
| `Esc` / `P` | pause |

Landscape orientation is required on phones; the tilt datum is captured when you
tap **Enable tilt & fly**, and can be re-taken from the pause screen.

## The run

- **Gates** score 120 x your chain multiplier, up to x8. Dead-centre is a bullseye.
  Fly past one and the chain breaks.
- **Fuel balloons** put 38 back in the tank. Fuel is the clock — it never stops.
- **Hazards** from sector 2: pylon cables, guyed masts, wind turbines, balloons and
  bird flocks. Terrain and treetops are always live.
- **Hedge hopping** under 45 m AGL pays a trickle bonus. So does staying alive.
- **The runway** ends every sector. Line up on the centreline, ride the 5-degree
  slope, and touch down softly and straight:

  | Result | Requirement | Bonus |
  | --- | --- | --- |
  | Greased it | sink < 7 m/s, within 10 m of the centreline, wings level | +1500 |
  | Good landing | sink < 13 m/s, within 20 m | +900 |
  | Firm landing | sink < 19 m/s | +400 |
  | Heavy | anything worse | bounce, airframe damage, go around |

  Then hold the centreline through the rollout. Run off the side or off the end
  and the bonus is gone.

Each sector changes the land (meadows, highlands, lakeland, downland), the light
(morning through golden hour) and, from sector 3, the weather (gusts, showers,
thermals).

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

Measured cost is about 0.7 ms of JavaScript per frame (0.07 ms simulation,
0.66 ms cockpit); the rest is GPU.

## Development

Screenshot any state headlessly with the shared shot tool:

```
node C:/Claude/Tools/shot/shot.mjs ./index.html --viewport 1280x720 --wait 4000 \
  --eval "window.SKY.play()" --out shots/play.png
```

`window.SKY` is the test hook: `play()`, `approach()`, `step(n, dt)` to advance
the simulation without waiting on frames, `hold(true)` to freeze the clock while
still rendering, and `fx(false)` to drop the post chain.

The smoke test drives all of that — the ring course, a flown approach, a
go-around and a heavy arrival — and fails on any console error:

```
node tools/headless-test.mjs
```
