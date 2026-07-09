/**
 * Three.js scene: Earth globe plus the full catalog as a single GPU point
 * cloud.
 *
 * Frames and units: world space is ECI (TEME), 1 scene unit = 1 km, +Z is
 * the north celestial pole. Satellite positions from SGP4 enter the point
 * buffer unchanged; the Earth mesh is what rotates: its Z rotation is set
 * to GMST each frame, which is exactly the ECEF→ECI transform.
 *
 * The whole catalog renders as one `THREE.Points` draw call. The vertex
 * shader dead-reckons each point (`position + velocity * (uSimT - aT0)`),
 * so between worker refreshes the GPU animates every object for free.
 * Filtered-out points are clipped in the vertex shader via the `aVis`
 * attribute.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EpochUTC, Sun } from 'ootk';
import type { SliceUpdate, PropagationEngine } from './PropagationEngine';

const EARTH_R = 6371;

const POINT_VERT = /* glsl */ `
  attribute vec3 velocity;
  attribute float aT0;
  attribute float aVis;
  attribute vec3 aColor;
  uniform float uSimT;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec3 p = position + velocity * (uSimT - aT0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(110000.0 / -mv.z, 1.6, 5.5);
    if (aVis < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(vColor, 1.0);
  }
`;

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Textures are decoded to linear (colorSpace = SRGB); a ShaderMaterial
// writes to the sRGB drawing buffer directly, so the output is encoded
// back manually.
const EARTH_FRAG = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform vec3 uSunDir;
  varying vec2 vUv;
  varying vec3 vNormalW;
  void main() {
    float d = dot(normalize(vNormalW), uSunDir);
    float dayAmt = smoothstep(-0.05, 0.18, d);
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;
    vec3 col = day * (0.06 + 1.0 * dayAmt) + night * (1.0 - dayAmt) * 1.25;
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
  }
`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const ATMO_FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vec3 toCam = normalize(cameraPosition - vP);
    float rim = pow(1.0 - abs(dot(vN, toCam)), 2.5);
    gl_FragColor = vec4(0.25, 0.5, 1.0, 1.0) * rim * 0.8;
  }
`;

export class GlobeScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private earthGroup = new THREE.Group();
  private points: THREE.Points | null = null;
  private pointGeo: THREE.BufferGeometry | null = null;
  private uniforms = { uSimT: { value: 0 } };
  private earthUniforms: Record<string, THREE.IUniform>;
  private orbitLine: THREE.Line | null = null;
  private groundTrackLine: THREE.Line | null = null;
  private selectedSprite: THREE.Sprite;
  private lastSunUpdateMs = -Infinity;
  private engine: PropagationEngine | null = null;
  private count = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(50, 1, 100, 2_000_000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-12000, -38000, 18000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = EARTH_R + 400;
    this.controls.maxDistance = 400_000;

    const loader = new THREE.TextureLoader();
    const base = import.meta.env.BASE_URL;
    const dayTex = loader.load(`${base}textures/earth_atmos_2048.jpg`);
    const nightTex = loader.load(`${base}textures/earth_lights_2048.png`);
    dayTex.colorSpace = THREE.SRGBColorSpace;
    nightTex.colorSpace = THREE.SRGBColorSpace;
    this.earthUniforms = {
      uDay: { value: dayTex },
      uNight: { value: nightTex },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    };

    // rotateX(90°) moves the sphere's poles from +Y to +Z; with three.js's
    // default UV layout this lands texture longitude λ exactly at ECEF
    // (cos λ, sin λ), so no further texture offset is needed.
    const earthGeo = new THREE.SphereGeometry(EARTH_R, 96, 48);
    earthGeo.rotateX(Math.PI / 2);
    const earth = new THREE.Mesh(
      earthGeo,
      new THREE.ShaderMaterial({
        uniforms: this.earthUniforms,
        vertexShader: EARTH_VERT,
        fragmentShader: EARTH_FRAG,
      }),
    );
    this.earthGroup.add(earth);
    this.scene.add(this.earthGroup);

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_R * 1.035, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
      }),
    );
    this.scene.add(atmo);

    const starGeo = new THREE.BufferGeometry();
    const nStars = 3500;
    const starPos = new Float32Array(nStars * 3);
    for (let i = 0; i < nStars; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(1_500_000);
      starPos.set([v.x, v.y, v.z], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0x888899, size: 1.6, sizeAttenuation: false }),
      ),
    );

    this.selectedSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeRingTexture(),
        color: 0xffffff,
        depthTest: false,
        transparent: true,
      }),
    );
    this.selectedSprite.visible = false;
    this.scene.add(this.selectedSprite);

    this.resize();
  }

  setEngine(engine: PropagationEngine): void {
    this.engine = engine;
  }

  /** Allocates the GPU buffers for the whole catalog. Called once. */
  initPoints(count: number, colors: Float32Array): void {
    this.count = count;
    const geo = new THREE.BufferGeometry();
    const mkAttr = (arr: Float32Array, itemSize: number) => {
      const a = new THREE.BufferAttribute(arr, itemSize);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    geo.setAttribute('position', mkAttr(new Float32Array(count * 3).fill(1e9), 3));
    geo.setAttribute('velocity', mkAttr(new Float32Array(count * 3), 3));
    geo.setAttribute('aT0', mkAttr(new Float32Array(count), 1));
    geo.setAttribute('aVis', mkAttr(new Float32Array(count).fill(1), 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.pointGeo = geo;
    this.scene.add(this.points);
  }

  /** Copies a worker batch into the GPU buffers. */
  applySlice(u: SliceUpdate): void {
    if (!this.pointGeo) return;
    const pos = this.pointGeo.getAttribute('position') as THREE.BufferAttribute;
    const vel = this.pointGeo.getAttribute('velocity') as THREE.BufferAttribute;
    const t0 = this.pointGeo.getAttribute('aT0') as THREE.BufferAttribute;
    (pos.array as Float32Array).set(u.pos, u.offset * 3);
    (vel.array as Float32Array).set(u.vel, u.offset * 3);
    (t0.array as Float32Array).fill(u.t0Sec, u.offset, u.offset + u.count);
    pos.needsUpdate = true;
    vel.needsUpdate = true;
    t0.needsUpdate = true;
  }

  setVisibility(mask: Uint8Array): void {
    if (!this.pointGeo) return;
    const vis = this.pointGeo.getAttribute('aVis') as THREE.BufferAttribute;
    const arr = vis.array as Float32Array;
    for (let i = 0; i < mask.length; i++) arr[i] = mask[i];
    vis.needsUpdate = true;
  }

  /** Draws the selected object's ECI orbit path, or clears it with null. */
  setOrbitPath(eci: Float32Array | null): void {
    if (this.orbitLine) {
      this.scene.remove(this.orbitLine);
      this.orbitLine.geometry.dispose();
      this.orbitLine = null;
    }
    if (!eci) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(eci, 3));
    this.orbitLine = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
    );
    this.orbitLine.frustumCulled = false;
    this.scene.add(this.orbitLine);
  }

  /** Ground track in ECEF, parented to the rotating Earth. */
  setGroundTrack(ecef: Float32Array | null): void {
    if (this.groundTrackLine) {
      this.earthGroup.remove(this.groundTrackLine);
      this.groundTrackLine.geometry.dispose();
      this.groundTrackLine = null;
    }
    if (!ecef) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(ecef, 3));
    this.groundTrackLine = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xffe082, transparent: true, opacity: 0.8 }),
    );
    this.groundTrackLine.frustumCulled = false;
    this.earthGroup.add(this.groundTrackLine);
  }

  setSelectedMarker(pos: { x: number; y: number; z: number } | null): void {
    if (!pos) {
      this.selectedSprite.visible = false;
      return;
    }
    this.selectedSprite.visible = true;
    this.selectedSprite.position.set(pos.x, pos.y, pos.z);
    const s = this.camera.position.distanceTo(this.selectedSprite.position) * 0.025;
    this.selectedSprite.scale.set(s, s, 1);
  }

  /** Per-frame update: GMST rotation, sun direction, time uniform, render. */
  frame(simMs: number, refMs: number): void {
    const date = new Date(simMs);
    this.earthGroup.rotation.z = EpochUTC.fromDateTime(date).gmstAngle();

    if (Math.abs(simMs - this.lastSunUpdateMs) > 60_000) {
      this.lastSunUpdateMs = simMs;
      const s = Sun.eci(date);
      (this.earthUniforms.uSunDir.value as THREE.Vector3).set(s.x, s.y, s.z).normalize();
    }

    this.uniforms.uSimT.value = (simMs - refMs) / 1000;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Click-picking: projects every visible point to screen space on the CPU
   * and returns the nearest within 14 px, skipping points occluded by the
   * globe (ray-sphere test).
   */
  pick(clientX: number, clientY: number, visMask: Uint8Array, simMs: number): number | null {
    if (!this.engine || !this.pointGeo) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const projView = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    const e = projView.elements;
    const cam = this.camera.position;
    const simT = (simMs - this.engine.refMs) / 1000;
    const P = this.engine.positions;
    const V = this.engine.velocities;
    const T0 = this.engine.t0Sec;

    let best = -1;
    let bestD2 = 14 * 14;
    for (let i = 0; i < this.count; i++) {
      if (visMask[i] === 0) continue;
      const dt = simT - T0[i];
      const i3 = i * 3;
      const x = P[i3] + V[i3] * dt;
      const y = P[i3 + 1] + V[i3 + 1] * dt;
      const z = P[i3 + 2] + V[i3 + 2] * dt;
      if (x > 1e8) continue;

      const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (cw <= 0) continue;
      const cx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw;
      const cy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw;
      const dx = (cx * 0.5 + 0.5) * rect.width - (clientX - rect.left);
      const dy = (-cy * 0.5 + 0.5) * rect.height - (clientY - rect.top);
      const d2 = dx * dx + dy * dy;
      if (d2 >= bestD2) continue;

      const ox = x - cam.x, oy = y - cam.y, oz = z - cam.z;
      const len2 = ox * ox + oy * oy + oz * oz;
      const t = -(cam.x * ox + cam.y * oy + cam.z * oz) / len2;
      if (t > 0 && t < 1) {
        const px = cam.x + ox * t, py = cam.y + oy * t, pz = cam.z + oz * t;
        if (px * px + py * py + pz * pz < EARTH_R * EARTH_R) continue;
      }

      bestD2 = d2;
      best = i;
    }
    return best >= 0 ? best : null;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.renderer.dispose();
    this.controls.dispose();
  }
}

function makeRingTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}
