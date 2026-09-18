# Contributing to UpThere

Thank you for considering a contribution.

## Development setup

```sh
git clone <repo-url>
cd upthere
npm install
cp .env.example .env.local   # add your KeepTrack API key (optional)
npm run dev                  # http://localhost:5173
```

Without a key in `.env.local`, the app prompts for one at first launch and
stores it in `localStorage`.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow, threading
model, and coordinate conventions. Read it before touching the propagation or
rendering code: the performance model depends on invariants documented there.

`src/engine/mythos/` holds the Mythos chart style and the wind/current
overlays. It is deliberately one-way: it reads nothing from the propagation
pipeline and nothing there depends on it, so a change to the chart cannot
affect how objects are positioned.

## Guidelines

- TypeScript strict mode; `npm run build` must pass (it typechecks first).
- Keep the render loop allocation-free where practical; per-object work
  belongs in the workers or on the GPU, never in React.
- Comments explain constraints the code cannot express, not what the code
  does.
- Test rendering changes against the full catalog (~36k objects), not a
  filtered subset.
- Check visual changes in **both** chart styles and with each overlay on.
  Contrast is the usual trap: what reads against black space disappears
  against parchment, and the reverse.
- Chart artwork is generated, not shipped. Derive new ink from the textures
  already in `public/textures/` rather than adding asset files.

## Pull requests

- One logical change per PR.
- Describe what changed and how you verified it (screenshots welcome for
  visual changes).

## Maintainer

[Shishir S Nambiar](https://www.linkedin.com/in/shishir-s-nambiar/)
([@MyBROSKICicada3301](https://github.com/MyBROSKICicada3301)).
