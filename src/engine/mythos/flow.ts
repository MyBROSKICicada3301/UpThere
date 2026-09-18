/**
 * Animated flow ribbons — the shared machinery behind both overlay tabs.
 *
 * A flow is a list of great-circle-ish paths hugging the globe. Each path
 * becomes one triangle ribbon lying in the local tangent plane, carrying a
 * per-vertex arc-length attribute `aS` measured in dash periods. The
 * fragment shader turns that into a faint continuous line with a brighter
 * pulse travelling along it:
 *
 *     phase = aS - time × speed      →  the pulse advances toward +aS
 *
 * Because `aS` is the only thing that moves, the whole layer is one draw
 * call and costs nothing per frame beyond a uniform write — the rest of the
 * renderer's budget stays with the 36 000 catalogue objects.
 *
 * Ribbons and arrowheads are widened in the vertex shader by the view-space
 * depth, which cancels the perspective divide and holds them at a constant
 * width in pixels. A drawn line should read the same whether the globe
 * fills the window or sits in the middle of it; a fixed width in kilometres
 * would be a hairline at full-globe zoom and a stripe up close.
 *
 * For a closed loop the arc length is rescaled to a whole number of periods
 * so the pattern meets itself at the seam instead of jumping.
 */

import * as THREE from 'three';
import { pathLength, spherePath, type LatLon } from './geo';

export interface FlowSpec {
  waypoints: LatLon[];
  closed?: boolean;
  samples?: number;
}

export interface FlowStyle {
  /** Ribbon centre-line radius, in km from the Earth's centre. */
  radiusKm: number;
  /** Ribbon half-width, as a fraction of the viewport height. */
  width: number;
  /** Distance between travelling pulses, in km. */
  dashKm: number;
  /** Pulses per second. */
  speed: number;
  /** Resting ribbon colour and the colour of the pulse head. */
  color: THREE.ColorRepresentation;
  head: THREE.ColorRepresentation;
  /** Opacity of the resting ribbon and the extra the pulse adds. */
  base: number;
  pulse: number;
  /** One arrowhead every N path samples, and its length as a viewport fraction. */
  arrowEvery: number;
  arrow: number;
}

/** Widens a ribbon vertex off its centre line by a constant screen width. */
const EXPAND = /* glsl */ `
  vec4 expand(vec3 centre, vec3 offset, float scale) {
    vec4 mv0 = modelViewMatrix * vec4(centre, 1.0);
    return modelViewMatrix * vec4(centre + offset * (scale * -mv0.z), 1.0);
  }
`;

const FLOW_VERT = /* glsl */ `
  attribute vec3 aSide;
  attribute float aS;
  attribute float aEdge;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uWidth;
  varying float vPhase;
  varying float vEdge;
  ${EXPAND}
  void main() {
    vPhase = aS - uTime * uSpeed;
    vEdge = aEdge;
    gl_Position = projectionMatrix * expand(position, aSide * aEdge, uWidth);
  }
`;

const FLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHead;
  uniform float uBase;
  uniform float uPulse;
  varying float vPhase;
  varying float vEdge;
  void main() {
    // sharp leading edge, long fading wake
    float comet = smoothstep(0.34, 0.99, fract(vPhase));
    float edge = 1.0 - smoothstep(0.45, 1.0, abs(vEdge));
    gl_FragColor = vec4(mix(uColor, uHead, comet), (uBase + comet * uPulse) * edge);
  }
`;

const ARROW_VERT = /* glsl */ `
  attribute vec3 aTan;
  attribute vec3 aSide;
  attribute vec2 aOff;
  uniform float uScale;
  ${EXPAND}
  void main() {
    gl_Position = projectionMatrix * expand(position, aTan * aOff.x + aSide * aOff.y, uScale);
  }
`;

const ARROW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

/** Arrowhead outline in (along-track, across-track) units of its length. */
const ARROW_SHAPE: [number, number][] = [
  [1, 0],
  [-0.35, 0.55],
  [-0.35, -0.55],
];

export class FlowLayer {
  readonly group = new THREE.Group();
  private uniforms: Record<string, THREE.IUniform>;
  private disposables: { dispose(): void }[] = [];

  constructor(specs: FlowSpec[], style: FlowStyle) {
    this.uniforms = {
      uTime: { value: 0 },
      uSpeed: { value: style.speed },
      uWidth: { value: style.width },
      uColor: { value: new THREE.Color(style.color) },
      uHead: { value: new THREE.Color(style.head) },
      uBase: { value: style.base },
      uPulse: { value: style.pulse },
    };

    const pos: number[] = [];
    const sides: number[] = [];
    const arc: number[] = [];
    const edge: number[] = [];
    const idx: number[] = [];
    const aPos: number[] = [];
    const aTan: number[] = [];
    const aSide: number[] = [];
    const aOff: number[] = [];

    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const side = new THREE.Vector3();

    for (const spec of specs) {
      const closed = spec.closed ?? true;
      const n = spec.samples ?? 220;
      const pts = spherePath(spec.waypoints, style.radiusKm, closed, n);
      const cum = pathLength(pts, closed);
      const total = cum[n];
      // whole periods around a loop, so the pulse train has no seam
      const periods = closed
        ? Math.max(1, Math.round(total / style.dashKm))
        : total / style.dashKm;
      const toPeriods = periods / total;

      // first vertex index of this path: two vertices per sample, three
      // floats each
      const base = pos.length / 3;
      const last = closed ? n : n - 1;

      for (let i = 0; i < n; i++) {
        // forward difference, except at the open end where it is backward
        const ahead = !closed && i === n - 1 ? i - 1 : (i + 1) % n;
        p.fromArray(pts, i * 3);
        q.fromArray(pts, ahead * 3);
        tan.subVectors(q, p);
        if (!closed && i === n - 1) tan.negate();
        tan.normalize();
        nrm.copy(p).normalize();
        side.crossVectors(nrm, tan).normalize();

        for (const e of [-1, 1]) {
          pos.push(p.x, p.y, p.z);
          sides.push(side.x, side.y, side.z);
          arc.push(cum[i] * toPeriods);
          edge.push(e);
        }

        if (i < last) {
          const a = base + i * 2;
          const b = base + ((i + 1) % n) * 2;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }

        if (i % style.arrowEvery === 0) {
          for (const [ox, oy] of ARROW_SHAPE) {
            aPos.push(p.x, p.y, p.z);
            aTan.push(tan.x, tan.y, tan.z);
            aSide.push(side.x, side.y, side.z);
            aOff.push(ox, oy);
          }
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 3));
    geo.setAttribute('aS', new THREE.Float32BufferAttribute(arc, 1));
    geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: FLOW_VERT,
      fragmentShader: FLOW_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ribbons = new THREE.Mesh(geo, mat);
    ribbons.frustumCulled = false;
    ribbons.renderOrder = 2;
    this.group.add(ribbons);
    this.disposables.push(geo, mat);

    const arrowGeo = new THREE.BufferGeometry();
    arrowGeo.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3));
    arrowGeo.setAttribute('aTan', new THREE.Float32BufferAttribute(aTan, 3));
    arrowGeo.setAttribute('aSide', new THREE.Float32BufferAttribute(aSide, 3));
    arrowGeo.setAttribute('aOff', new THREE.Float32BufferAttribute(aOff, 2));
    const arrowMat = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: style.arrow },
        uColor: { value: new THREE.Color(style.head) },
        uOpacity: { value: Math.min(1, style.base + style.pulse * 0.6) },
      },
      vertexShader: ARROW_VERT,
      fragmentShader: ARROW_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const heads = new THREE.Mesh(arrowGeo, arrowMat);
    heads.frustumCulled = false;
    heads.renderOrder = 3;
    this.group.add(heads);
    this.disposables.push(arrowGeo, arrowMat);
  }

  setTime(seconds: number): void {
    this.uniforms.uTime.value = seconds;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
