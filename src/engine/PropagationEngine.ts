/**
 * Worker-pool SGP4 engine.
 *
 * The catalog is split into contiguous slices, one per Web Worker. A slice
 * is re-propagated when the simulation time has drifted more than a small
 * window from the slice's last propagation; between refreshes the renderer
 * dead-reckons `position + velocity * dt` on the GPU. At high speed
 * multipliers workers run continuously and each request targets a predicted
 * simulation time one compute-latency ahead, so results arrive fresh.
 *
 * CPU-side mirrors of the latest state are kept for click-picking and the
 * detail readout.
 */

export interface SliceUpdate {
  offset: number;
  count: number;
  /** ECI positions, km. */
  pos: Float32Array;
  /** ECI velocities, km/s. */
  vel: Float32Array;
  /** Propagation time in seconds since `refMs`. */
  t0Sec: number;
}

interface WorkerState {
  worker: Worker;
  offset: number;
  count: number;
  busy: boolean;
  ready: boolean;
  lastSimMs: number;
  lastLatencyMs: number;
  sentAt: number;
}

const MIN_REFRESH_SIM_MS = 5_000;
const MAX_REFRESH_SIM_MS = 60_000;

export class PropagationEngine {
  /** Fixed reference epoch shared with the shader's time uniform. */
  readonly refMs: number;
  count = 0;

  positions!: Float32Array;
  velocities!: Float32Array;
  t0Sec!: Float64Array;

  onSlice: ((u: SliceUpdate) => void) | null = null;
  onReady: (() => void) | null = null;

  private workers: WorkerState[] = [];
  private readyCount = 0;

  constructor() {
    this.refMs = Date.now();
  }

  init(tles: string[]): void {
    this.count = tles.length / 2;
    this.positions = new Float32Array(this.count * 3).fill(1e9);
    this.velocities = new Float32Array(this.count * 3);
    this.t0Sec = new Float64Array(this.count);

    const nWorkers = Math.min(6, Math.max(2, (navigator.hardwareConcurrency || 4) - 2));
    const per = Math.ceil(this.count / nWorkers);

    for (let w = 0; w < nWorkers; w++) {
      const offset = w * per;
      if (offset >= this.count) break;
      const count = Math.min(per, this.count - offset);
      const worker = new Worker(new URL('../workers/propagator.worker.ts', import.meta.url), {
        type: 'module',
      });
      const state: WorkerState = {
        worker,
        offset,
        count,
        busy: true,
        ready: false,
        lastSimMs: -Infinity,
        lastLatencyMs: 100,
        sentAt: 0,
      };
      worker.onmessage = (ev) => this.handleMessage(state, ev.data);
      worker.postMessage({
        t: 'init',
        offset,
        tles: tles.slice(offset * 2, (offset + count) * 2),
      });
      this.workers.push(state);
    }
  }

  private handleMessage(state: WorkerState, msg: any): void {
    if (msg.t === 'ready') {
      state.ready = true;
      state.busy = false;
      if (++this.readyCount === this.workers.length) this.onReady?.();
      return;
    }
    if (msg.t === 'pos') {
      state.busy = false;
      state.lastSimMs = msg.simMs;
      state.lastLatencyMs = performance.now() - state.sentAt;

      const { offset, pos, vel, t0Sec } = msg as SliceUpdate & { simMs: number };
      this.positions.set(pos, offset * 3);
      this.velocities.set(vel, offset * 3);
      this.t0Sec.fill(t0Sec, offset, offset + pos.length / 3);
      this.onSlice?.({ offset, count: pos.length / 3, pos, vel, t0Sec });
    }
  }

  /** Called once per frame; issues jobs to idle workers with stale slices. */
  update(simMs: number, speed: number): void {
    const absSpeed = Math.max(1, Math.abs(speed));
    const maxAgeSimMs = Math.min(MAX_REFRESH_SIM_MS, MIN_REFRESH_SIM_MS * absSpeed);

    for (const w of this.workers) {
      if (!w.ready || w.busy) continue;
      if (Math.abs(simMs - w.lastSimMs) < maxAgeSimMs) continue;
      const target = simMs + speed * w.lastLatencyMs;
      w.busy = true;
      w.sentAt = performance.now();
      w.worker.postMessage({ t: 'prop', simMs: target, refMs: this.refMs });
    }
  }

  /** Dead-reckoned ECI position (km) of one object at `simMs`. */
  getPosition(index: number, simMs: number, out: { x: number; y: number; z: number }) {
    const dt = (simMs - this.refMs) / 1000 - this.t0Sec[index];
    const i3 = index * 3;
    out.x = this.positions[i3] + this.velocities[i3] * dt;
    out.y = this.positions[i3 + 1] + this.velocities[i3 + 1] * dt;
    out.z = this.positions[i3 + 2] + this.velocities[i3 + 2] * dt;
    return out;
  }

  dispose(): void {
    for (const w of this.workers) w.worker.terminate();
    this.workers = [];
  }
}
