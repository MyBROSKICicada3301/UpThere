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

## Guidelines

- TypeScript strict mode; `npm run build` must pass (it typechecks first).
- Keep the render loop allocation-free where practical; per-object work
  belongs in the workers or on the GPU, never in React.
- Comments explain constraints the code cannot express, not what the code
  does.
- Test rendering changes against the full catalog (~36k objects), not a
  filtered subset.

## Pull requests

- One logical change per PR.
- Describe what changed and how you verified it (screenshots welcome for
  visual changes).
