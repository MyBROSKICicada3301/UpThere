/**
 * Spherical geometry helpers shared by the antique-chart layers.
 *
 * Everything here works in the same ECEF frame the Earth mesh uses
 * (`earthGroup`): +Z north, longitude λ at (cos λ, sin λ), 1 unit = 1 km.
 * Layers built from these helpers are parented to `earthGroup`, so they
 * ride the globe's GMST rotation for free.
 */

import * as THREE from 'three';

export type LatLon = [lat: number, lon: number];

const DEG = Math.PI / 180;

/** ECEF unit vector for a lat/lon in degrees. */
export function llVec(latDeg: number, lonDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const c = Math.cos(la);
  return out.set(c * Math.cos(lo), c * Math.sin(lo), Math.sin(la));
}

/**
 * Samples a smooth path through `waypoints` on a sphere of `radiusKm`.
 *
 * The spline is fitted in 3D through the unit vectors and each sample is
 * re-projected onto the sphere, so paths that cross the antimeridian or a
 * pole need no longitude unwrapping.
 */
export function spherePath(
  waypoints: LatLon[],
  radiusKm: number,
  closed: boolean,
  samples: number,
): Float32Array {
  const ctrl = waypoints.map(([la, lo]) => llVec(la, lo));
  const curve = new THREE.CatmullRomCurve3(ctrl, closed, 'catmullrom', 0.5);
  const out = new Float32Array(samples * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < samples; i++) {
    curve.getPoint(closed ? i / samples : i / (samples - 1), v);
    v.normalize().multiplyScalar(radiusKm);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  return out;
}

/**
 * A ring of waypoints around the globe at `latDeg`, meandering by `ampDeg`
 * over `waves` cycles — the Rossby-wave wobble that keeps zonal belts from
 * looking like wire hoops. `eastward` sets the traversal direction, which is
 * what the flow animation and arrow chevrons follow.
 */
export function zonalRing(
  latDeg: number,
  ampDeg: number,
  waves: number,
  eastward: boolean,
  phase = 0,
  nodes = 24,
): LatLon[] {
  const pts: LatLon[] = [];
  for (let i = 0; i < nodes; i++) {
    const f = i / nodes;
    const lon = -180 + f * 360;
    const lat = latDeg + Math.sin(f * waves * Math.PI * 2 + phase) * ampDeg;
    pts.push([lat, eastward ? lon : -lon]);
  }
  return pts;
}

/** Cumulative great-circle-ish length of a sampled path, in km. */
export function pathLength(pts: Float32Array, closed: boolean): Float32Array {
  const n = pts.length / 3;
  const cum = new Float32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    const a = ((i - 1) % n) * 3;
    const b = (i % n) * 3;
    const dx = pts[b] - pts[a];
    const dy = pts[b + 1] - pts[a + 1];
    const dz = pts[b + 2] - pts[a + 2];
    cum[i] = cum[i - 1] + Math.hypot(dx, dy, dz);
  }
  if (!closed) cum[n] = cum[n - 1];
  return cum;
}
