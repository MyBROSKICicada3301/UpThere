# UpThere

**Real-time 3D satellite & debris tracker.** Every tracked object in Earth
orbit (~36,000 satellites, rocket bodies, and debris fragments) rendered on
an interactive globe with positions propagated live in your browser or as a
desktop app.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

## Features

- **Full catalog, live.** The complete public catalog animates at 60 fps,
  each object at its SGP4-propagated position.
- **True orientation.** The globe rotates in real sidereal time; the
  day/night terminator follows the actual sun position.
- **Time control.** Pause, run at ±1× to ±1000×, jump by hours or days.
  Propagation works at any epoch, so the past and future are one scrub away.
- **Search & filter.** By name, NORAD ID, object type (payload / rocket
  body / debris), orbit regime (LEO / MEO / GEO / HEO), country/operator,
  and altitude band.
- **Object details.** Click any dot or search-select: live latitude/
  longitude/altitude/speed, orbital elements, orbit line, and ground track.

## Quick start (web)

Requirements: Node.js 20+.

```sh
npm install
cp .env.example .env.local   # optional: add your KeepTrack API key
npm run dev                  # http://localhost:5173
```

Orbital data comes from the [KeepTrack API](https://api.keeptrack.space)
(free tier available). Either put your key in `.env.local` or just start the
app, which will ask once and store the key locally on your device.

## Desktop app (Windows)

```sh
npm run dist
```

Produces a portable, no-install executable at
`release/UpThere-<version>-portable.exe`. For a quick unpackaged run:

```sh
npm run desktop
```

## How it works

The short version:

1. The catalog's orbital elements (TLEs) are fetched **once** in bulk and
   cached in IndexedDB for 3 hours, since elements drift slowly.
2. A pool of Web Workers runs the SGP4 propagator
   ([`ootk`](https://github.com/thkruz/ootk)) over catalog slices every few
   simulation seconds, returning positions and velocities as transferable
   arrays.
3. All objects render as a **single** `THREE.Points` draw call; the vertex
   shader dead-reckons `position + velocity × dt` between worker refreshes,
   so per-frame cost on the main thread is independent of object count.
4. The world frame is ECI: satellites need no transform, and the Earth mesh
   itself rotates by GMST, which is what makes the sidereal rotation and
   ground tracks exact.

The long version, including the threading model, coordinate conventions and
scheduling policy: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## API key & deployment note

`VITE_KT_API_KEY` is embedded in the client bundle at build time. That is
acceptable for local development and personal desktop builds, but **do not
publish a hosted build with your key baked in**: proxy the KeepTrack API
through a small backend that attaches the key server-side, or leave the
variable unset so each user supplies their own key at first launch.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

- Orbital data: [KeepTrack](https://keeptrack.space)
- SGP4 propagation: [ootk](https://github.com/thkruz/ootk)
- Earth textures: [three.js](https://github.com/mrdoob/three.js) examples

## License

[MIT](LICENSE)
