/**
 * Selected-object helpers: exact live state and orbit/ground-track geometry.
 * Runs for a single object at a time, so per-call SGP4 cost is negligible.
 */

import { Satellite, EpochUTC, Sgp4 } from 'ootk';

const UNIX_EPOCH_JD = 2440587.5;
const GROUND_TRACK_RADIUS = 6371 + 25;

export interface LiveState {
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
  eci: { x: number; y: number; z: number };
}

export class SelectedSat {
  readonly sat: Satellite;
  private rec: ReturnType<typeof Sgp4.createSatrec>;
  private epochMs: number;

  constructor(tle1: string, tle2: string) {
    this.sat = new Satellite({ tle1: tle1 as any, tle2: tle2 as any });
    this.rec = Sgp4.createSatrec(tle1, tle2);
    this.epochMs = (this.rec.jdsatepoch - UNIX_EPOCH_JD) * 86400000;
  }

  /** Exact SGP4 state at `simMs`. */
  live(simMs: number): LiveState | null {
    const sv = Sgp4.propagate(this.rec, (simMs - this.epochMs) / 60000);
    const p = sv?.position as { x: number; y: number; z: number } | false;
    const v = sv?.velocity as { x: number; y: number; z: number } | false;
    if (!p || !v || !isFinite(p.x)) return null;
    const lla = this.sat.lla(new Date(simMs));
    if (!lla) return null;
    return {
      latDeg: lla.lat,
      lonDeg: lla.lon,
      altKm: lla.alt,
      speedKmS: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
      eci: p,
    };
  }

  /**
   * Samples one orbital period starting at `simMs`. Returns the inertial
   * orbit line (`eci`) and the ground track (`ecef`, pinned just above the
   * surface and drawn in Earth's rotating frame).
   */
  orbitGeometry(simMs: number, periodMin: number, samples = 240) {
    const eci = new Float32Array(samples * 3);
    const ecef = new Float32Array(samples * 3);
    const periodMs = periodMin * 60000;

    for (let i = 0; i < samples; i++) {
      const tMs = simMs + (i / (samples - 1)) * periodMs;
      const sv = Sgp4.propagate(this.rec, (tMs - this.epochMs) / 60000);
      const p = sv?.position as { x: number; y: number; z: number } | false;
      if (!p || !isFinite(p.x)) {
        if (i > 0) {
          eci.copyWithin(i * 3, (i - 1) * 3, i * 3);
          ecef.copyWithin(i * 3, (i - 1) * 3, i * 3);
        }
        continue;
      }
      eci[i * 3] = p.x;
      eci[i * 3 + 1] = p.y;
      eci[i * 3 + 2] = p.z;

      const gmst = EpochUTC.fromDateTime(new Date(tMs)).gmstAngle();
      const c = Math.cos(-gmst);
      const s = Math.sin(-gmst);
      const ex = c * p.x - s * p.y;
      const ey = s * p.x + c * p.y;
      const ez = p.z;
      const k = GROUND_TRACK_RADIUS / Math.sqrt(ex * ex + ey * ey + ez * ez);
      ecef[i * 3] = ex * k;
      ecef[i * 3 + 1] = ey * k;
      ecef[i * 3 + 2] = ez * k;
    }
    return { eci, ecef };
  }
}
