# UpThere Architecture

This document describes the data flow, threading model, rendering pipeline,
and coordinate conventions. The design goal is rendering the entire tracked
satellite catalog (~36,000 objects) at 60 fps with live-propagated positions,
on modest hardware, with no per-frame API calls.

## Overview

```
KeepTrack API ──(bulk TLEs, 1 request / 3 h)──► IndexedDB cache
                                                     │
                                                     ▼
                                              catalog.ts (parse)
                                                     │
        ┌────────────────────────────────────────────┤
        ▼                                            ▼
  SatMeta[] (search/filter/detail)          TLE list → PropagationEngine
                                                     │  slices
                                       ┌─────────────┼─────────────┐
                                       ▼             ▼             ▼
                                   Worker 1      Worker 2  …   Worker N
                                   (SGP4)        (SGP4)        (SGP4)
                                       └─────────────┼─────────────┘
                                            transferable Float32Arrays
                                              (position, velocity)
                                                     ▼
                                          GlobeScene (THREE.Points)
                                                     ▼
                                     vertex shader: pos + vel·(t − t₀)
```

## Data acquisition

- **Endpoint**: `GET /v4/sats/brief` on the KeepTrack v4 API returns the full
  catalog (TLEs plus name/type/country metadata) in a single response.
- **Caching**: the response is stored in IndexedDB and reused for 3 hours
  (`CATALOG_TTL_MS` in `src/api/keeptrack.ts`). Orbital elements drift slowly,
  so this staleness is acceptable. If a refresh fails, the stale cache is used.
- **Never used**: the API's position/pass calculation endpoints (heavily
  rate-limited). Every live position is computed client-side.
- **API key**: read from `VITE_KT_API_KEY` at build time, or entered by the
  user at first launch and stored in `localStorage` (`src/components/ApiKeySetup.tsx`).

## Coordinate frames and units

- **World space = ECI (TEME)**, the frame SGP4 outputs natively.
  1 scene unit = 1 km. +Z is the north celestial pole.
- Satellite positions therefore enter the GPU buffers **unchanged**.
- The **Earth mesh rotates** instead of the satellites:
  `earthGroup.rotation.z = GMST(t)`. Greenwich Mean Sidereal Time is exactly
  the ECEF→ECI rotation about Z, so the globe spins in true sidereal time.
- The Earth sphere geometry is rotated `+90°` about X at construction, which
  places the poles on ±Z and, with three.js's default UV layout, lands
  equirectangular texture longitude λ at ECEF `(cos λ, sin λ)` with no
  additional offset.
- The selected object's ground track is computed in ECEF and parented to the
  rotating Earth group, so it stays glued to the surface.
- Sun direction for the day/night terminator comes from `ootk`'s `Sun.eci`.

## Threading model

### Simulation clock (`src/engine/SimClock.ts`)

`simMs` (unix ms) advances by `realDt × speed` each frame. Speed may be
negative (time runs backwards) and the frame delta is intentionally
unclamped so that after tab throttling the simulation catches up to real
time in a single jump.

### Worker pool (`src/engine/PropagationEngine.ts`, `src/workers/propagator.worker.ts`)

- The catalog is split into contiguous slices, one per worker
  (`min(6, cores − 2)` workers).
- Each worker parses its slice's TLEs into SGP4 records once at init.
- A slice is re-propagated when `|simMs − lastPropagatedSimMs|` exceeds a
  refresh window: 5 s of simulation time at 1×, scaling with the speed
  multiplier and capped at 60 s. At extreme speeds workers simply run
  back-to-back.
- Requests target `simMs + speed × lastLatency` (one compute-latency ahead)
  so results are current when they arrive.
- Results return as **transferable** `Float32Array`s (zero copy): ECI
  position (km) and velocity (km/s) per object, plus the propagation
  timestamp `t0`.
- The engine keeps CPU-side mirrors of the latest arrays for click-picking
  and detail readouts.

### Main thread

Per frame: tick the clock, poll the engine (issues worker jobs as needed),
update two uniforms and one rotation, render. Per-object work never happens
on the main thread, so frame cost is independent of catalog size.

## Rendering (`src/engine/GlobeScene.ts`)

- **One draw call** for all objects: a single `THREE.Points` with per-object
  vertex attributes (`position`, `velocity`, `aT0`, `aVis`, `aColor`).
- **Dead reckoning on the GPU**: the vertex shader renders
  `position + velocity × (uSimT − aT0)`. Between worker refreshes the GPU
  animates every object for free. Linear extrapolation error over the ≤60 s
  refresh window is far below a pixel at global zoom.
- **Filtering**: `computeVisibility` (O(n), runs only on filter change)
  writes a 0/1 mask into the `aVis` attribute; the vertex shader clips
  hidden points. No geometry is rebuilt.
- **Picking**: on click (not per frame) all visible points are projected to
  screen space on the CPU (~1 ms for 36k) and the nearest within 14 px wins;
  a ray-sphere test rejects points occluded by the globe.
- **Selected object**: exact (non-dead-reckoned) SGP4 state is computed on
  the main thread each frame; a single object is cheap. Its orbit line (one
  period, ECI) and ground track (ECEF) are re-sampled when the simulation
  time drifts half a period from the last sample.
- **Color management**: the Earth's `ShaderMaterial` writes directly to the
  sRGB drawing buffer, so the fragment shader encodes its linear result with
  `pow(col, 1/2.2)`.

## Chart styles and overlays (`src/engine/mythos/`)

The globe has two skins and two optional data overlays, chosen from the
chart panel. Neither touches the propagation pipeline: the satellite
buffers, worker scheduling and picking are identical in both styles.

### Styles

`GlobeScene.setChartStyle('modern' | 'mythos')` switches a `uMode` uniform
in the single Earth `ShaderMaterial`, so no program is recompiled and no
per-object buffer is re-uploaded. **Modern** is the photographic day/night
pair. **Mythos** samples a pen-and-ink chart drawn at runtime, and warms the
rim light, stars, orbit lines and UI palette to match.

The chart sheet (`mythos/parchment.ts`) is a 4096×2048 canvas built once,
lazily, on the first switch (~0.7 s) and cached for the session. Nothing is
downloaded: it derives from the two textures the app already ships.

```
earth_specular_2048.jpg ──► land mask ──► despeckle ──► signed distance field
   (a clean water mask:                                         │
    no clouds, no sea ice)          ┌───────────────────────────┼──────────────┐
                                    ▼                           ▼              ▼
earth_atmos_2048.jpg ─────►  tone wash + hand-tint      marching squares   glyph siting
                                                      0  → coastline      (inland only,
                                                     <0  → engraved        density from
                                                           sea shading     local relief)
```

The distance field earns its cost three times over: contoured at level 0 it
gives a coastline, contoured just below 0 it gives the parallel bands that
hug every shore on a period chart, and tested directly it keeps hill
hachures out of the water. Contour segments are never chained — adjacent
cells interpolate a shared edge identically, so a round-capped stroke over
the loose segments draws as one line, and a position-hashed jitter gives it
a quill waver without pulling shared endpoints apart.

Ink figures (compass roses, galleons, sea serpents, cherubs, whirlpools)
are canvas paths in `mythos/ink.ts` and `mythos/figures.ts`. Anything drawn
into the equirectangular sheet is squashed horizontally by `cos(lat)` first,
which cancels the projection's stretch so it keeps its proportions on the
sphere.

Satellite dots face one real contrast problem in mythos: a warm dot that
reads against black space vanishes against parchment. The point vertex
shader measures the perpendicular distance from the globe's centre to the
camera ray and darkens each dot to ink where it falls inside the Earth's
disc, leaving its bright form out in the void.

### Overlays

`GlobeScene.setOverlay('none' | 'winds' | 'currents')` toggles one `Overlay`
(`mythos/overlays.ts`), parented to `earthGroup` so it rides the GMST
rotation. Instances are built on demand and kept, keyed by kind **and**
style, since the two palettes differ.

- **Winds** — the three-cell circulation (polar easterlies, mid-latitude
  westerlies with a Rossby meander, trade-wind arcs slanting toward the
  equator). On the mythos chart the eight Anemoi ride above the belts: each
  cherub's breath is a separate sprite rotated to the screen-space bearing of
  the wind beneath it, so the decoration and the data agree, while the face
  stays upright and is never inverted. The cherubs are gated to that style —
  over the photographic globe the belts are drawn plain, and the ribbons and
  captions carry the data in both.
- **Currents** — the five subtropical gyres, their western boundary
  currents and the Antarctic Circumpolar, with a turning whirlpool at each
  gyre centre.

Paths are fitted with a Catmull-Rom spline through ECEF unit vectors and
re-projected to the sphere, so antimeridian crossings need no longitude
unwrapping. Each becomes one triangle ribbon carrying an arc-length
attribute in dash periods; the fragment shader renders a faint continuous
line with a pulse travelling along it, so the whole layer is one draw call
and one uniform write per frame. Closed loops rescale their arc length to a
whole number of periods so the pulse train has no seam.

Ribbons, arrowheads and figures are all sized in screen space (ribbons by
multiplying the view-space depth in the vertex shader, figures via
`sizeAttenuation: false`); a width fixed in kilometres would be a hairline
at full-globe zoom and a stripe from low orbit. Figures also fade out near
the limb by `normal · toCamera`, which stops a billboard anchored near the
edge from hanging half off the globe into space.

Overlays animate on wall-clock time, not simulated time: a gyre whipping
round at 1000× would read as noise, and running time backwards should not
suck the sea back up the Gulf Stream.

## Desktop packaging (`electron/main.cjs`)

The Electron main process serves the built `dist/` bundle through a custom
`app://` protocol (not `file://`) so module workers and same-origin fetches
behave exactly as on an HTTP origin. It contains no application logic.
`electron-builder` packages a portable Windows executable (`npm run dist`).

## Module map

| Path | Responsibility |
| --- | --- |
| `src/api/keeptrack.ts` | API client, key management, catalog cache policy |
| `src/data/idb.ts` | IndexedDB key-value wrapper |
| `src/data/catalog.ts` | TLE parsing, metadata, orbit-regime classification, filters, search |
| `src/engine/SimClock.ts` | Simulation time |
| `src/engine/PropagationEngine.ts` | Worker pool, scheduling, CPU state mirrors |
| `src/workers/propagator.worker.ts` | SGP4 for one catalog slice |
| `src/engine/GlobeScene.ts` | Three.js scene, shaders, picking, chart style, overlay switching |
| `src/engine/selection.ts` | Selected-object live state and orbit geometry |
| `src/engine/mythos/geo.ts` | Lat/lon → ECEF, spherical path sampling, arc length |
| `src/engine/mythos/ink.ts` | Pen-and-ink primitives: parchment, hachures, lettering |
| `src/engine/mythos/figures.ts` | Compass roses, galleons, sea serpents, cherubs, whirlpools |
| `src/engine/mythos/parchment.ts` | Builds the antique chart sheet from the shipped textures |
| `src/engine/mythos/flow.ts` | Animated flow ribbons and arrowheads |
| `src/engine/mythos/overlays.ts` | Wind and current data, figure placement, per-frame aiming |
| `src/App.tsx` | Render loop ownership, UI state wiring |
| `src/components/` | React UI (search, filters, chart, time controls, detail, author, key setup) |
| `electron/main.cjs` | Desktop shell |
