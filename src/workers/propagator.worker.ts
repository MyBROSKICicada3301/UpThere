/**
 * SGP4 propagation worker.
 *
 * Each worker owns a contiguous slice of the catalog. On every `prop`
 * request it propagates its whole slice to the requested simulation time
 * and posts back ECI positions (km) and velocities (km/s) as transferable
 * Float32Arrays. The renderer dead-reckons `position + velocity * dt`
 * between refreshes, so workers run every few simulation seconds rather
 * than every frame.
 */

import { Sgp4 } from 'ootk';

type SatRec = ReturnType<typeof Sgp4.createSatrec>;

interface InitMsg {
  t: 'init';
  offset: number;
  /** Flat TLE pairs for this slice: [line1, line2, line1, line2, ...] */
  tles: string[];
}

interface PropMsg {
  t: 'prop';
  /** Simulation time to propagate to (unix ms). */
  simMs: number;
  /** Reference epoch; t0 is reported as seconds since this. */
  refMs: number;
}

/** Off-screen parking position for objects that fail to propagate. */
const FAR_AWAY = 1e9;
const UNIX_EPOCH_JD = 2440587.5;

let offset = 0;
let recs: (SatRec | null)[] = [];
let epochMs: Float64Array;

self.onmessage = (ev: MessageEvent<InitMsg | PropMsg>) => {
  const msg = ev.data;

  if (msg.t === 'init') {
    offset = msg.offset;
    const n = msg.tles.length / 2;
    recs = new Array(n);
    epochMs = new Float64Array(n);
    let failed = 0;
    for (let i = 0; i < n; i++) {
      try {
        const rec = Sgp4.createSatrec(msg.tles[i * 2], msg.tles[i * 2 + 1]);
        recs[i] = rec;
        epochMs[i] = (rec.jdsatepoch - UNIX_EPOCH_JD) * 86400000;
      } catch {
        recs[i] = null;
        failed++;
      }
    }
    postMessage({ t: 'ready', count: n, failed });
    return;
  }

  const n = recs.length;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const rec = recs[i];
    let ok = false;
    if (rec) {
      const sv = Sgp4.propagate(rec, (msg.simMs - epochMs[i]) / 60000);
      const p = sv?.position as { x: number; y: number; z: number } | false | undefined;
      const v = sv?.velocity as { x: number; y: number; z: number } | false | undefined;
      if (p && v && isFinite(p.x)) {
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        vel[i * 3] = v.x;
        vel[i * 3 + 1] = v.y;
        vel[i * 3 + 2] = v.z;
        ok = true;
      }
    }
    if (!ok) {
      pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = FAR_AWAY;
      vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0;
    }
  }

  const t0Sec = (msg.simMs - msg.refMs) / 1000;
  postMessage({ t: 'pos', offset, pos, vel, t0Sec, simMs: msg.simMs }, {
    transfer: [pos.buffer, vel.buffer],
  });
};
