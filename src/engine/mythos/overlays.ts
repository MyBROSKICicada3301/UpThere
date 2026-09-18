/**
 * The two overlay tabs: the winds of the world and the great sea currents.
 *
 * Both are the same two ingredients — a `FlowLayer` of animated ribbons plus
 * a handful of billboarded figures — over different data. The paths are
 * schematic but real: the wind layer draws the three-cell circulation
 * (polar easterlies, mid-latitude westerlies, trade winds converging on the
 * equator), and the current layer draws the five subtropical gyres, the
 * western boundary currents that feed them, and the Antarctic Circumpolar.
 *
 * The cherubs are the mythological half of the wind tab, and appear only on
 * the mythos chart — over the photographic globe the belts speak for
 * themselves. Each sits above a belt with its breath swung round to the true
 * bearing of the wind beneath it, so the decoration and the data agree: a
 * putto over the Southern Ocean really is blowing east.
 */

import * as THREE from 'three';
import { FlowLayer, type FlowSpec, type FlowStyle } from './flow';
import { llVec, zonalRing, type LatLon } from './geo';
import { breathTexture, cherubTexture, whirlpoolTexture } from './figures';
import { newCanvas } from './ink';

const EARTH_R = 6371;
const DEG = Math.PI / 180;

/** Parchment fill for the cherubs, who only ever appear on the chart. */
const CHERUB_SKIN = 'rgba(241,227,194,0.94)';

export type ChartStyle = 'modern' | 'mythos';

/** Ribbon and figure colours, per chart style. */
const PALETTE = {
  modern: {
    wind: { color: 0x5f93c4, head: 0xa8e0ff, figure: '#cfe8ff', plate: 'rgba(10,16,30,0.68)', text: '#dbeaff' },
    sea: { color: 0x2f8f8a, head: 0x6ff0dc, figure: '#9ff0e4', plate: 'rgba(10,16,30,0.68)', text: '#c8fff4' },
  },
  mythos: {
    wind: { color: 0x8f3c1c, head: 0xd9702f, figure: '#7e3316', plate: 'rgba(240,222,182,0.82)', text: '#5b3212' },
    sea: { color: 0x155e63, head: 0x39a7a2, figure: '#124d52', plate: 'rgba(240,222,182,0.82)', text: '#12454a' },
  },
} as const;

/* ---------------------------------------------------------------- data -- */

/** An arc of trade wind, slanting toward the equator as it runs west. */
function tradeArc(lat0: number, lon0: number): FlowSpec {
  const s = Math.sign(lat0);
  return {
    closed: false,
    samples: 90,
    waypoints: [
      [lat0, lon0],
      [lat0 - s * 6, lon0 - 24],
      [lat0 - s * 12, lon0 - 48],
      [lat0 - s * 18, lon0 - 74],
    ],
  };
}

function windSpecs(): FlowSpec[] {
  const specs: FlowSpec[] = [
    // polar easterlies
    { waypoints: zonalRing(73, 2.5, 3, false) },
    { waypoints: zonalRing(-73, 2.5, 3, false, 1.4) },
    // mid-latitude westerlies, with a Rossby meander
    { waypoints: zonalRing(43, 7, 4, true) },
    { waypoints: zonalRing(54, 5, 5, true, 2.1) },
    { waypoints: zonalRing(-45, 6, 4, true, 0.7) },
    { waypoints: zonalRing(-56, 4.5, 5, true, 2.8) },
  ];
  // trade winds, four arcs per hemisphere — enough to read as a belt
  // without hatching over the chart beneath it
  for (let i = 0; i < 4; i++) {
    specs.push(tradeArc(26, -180 + i * 90 + 55));
    specs.push(tradeArc(-26, -180 + i * 90 + 15));
  }
  return specs;
}

function currentSpecs(): FlowSpec[] {
  return [
    // North Atlantic gyre: Gulf Stream, North Atlantic Drift, Canary
    {
      waypoints: [
        [25, -79], [32, -78], [37, -71], [41, -61], [46, -47], [51, -33],
        [55, -21], [48, -13], [40, -12], [32, -16], [24, -21], [17, -29],
        [13, -43], [12, -57], [16, -69], [21, -77],
      ],
    },
    // North Pacific gyre: Kuroshio, North Pacific Drift, California
    {
      waypoints: [
        [24, 124], [32, 141], [38, 153], [42, 170], [44, -170], [43, -150],
        [40, -135], [34, -126], [27, -119], [20, -115], [14, -126], [11, -146],
        [11, -170], [13, 165], [18, 145], [22, 130],
      ],
    },
    // South Atlantic gyre: Brazil, South Atlantic, Benguela
    {
      waypoints: [
        [-5, -12], [-8, -25], [-14, -36], [-24, -43], [-34, -50], [-42, -45],
        [-45, -28], [-43, -8], [-38, 8], [-30, 13], [-22, 10], [-14, 2], [-8, -4],
      ],
    },
    // South Pacific gyre: East Australian, Humboldt
    {
      waypoints: [
        [-6, -90], [-12, -110], [-14, -140], [-16, -170], [-22, 165], [-32, 155],
        [-40, 160], [-46, -175], [-48, -150], [-45, -120], [-38, -95], [-28, -77],
        [-18, -76], [-10, -82],
      ],
    },
    // Indian Ocean gyre, closed by the Agulhas
    {
      waypoints: [
        [-8, 48], [-12, 62], [-18, 78], [-26, 92], [-34, 100], [-40, 88],
        [-40, 68], [-36, 48], [-30, 34], [-22, 36], [-14, 41],
      ],
    },
    // Antarctic Circumpolar Current
    { waypoints: zonalRing(-57, 3.5, 5, true), samples: 300 },
  ];
}

const WIND_LABELS: [LatLon, string][] = [
  [[70, -62], 'Polar Easterlies'],
  [[-70, 150], 'Polar Easterlies'],
  [[47, -33], 'Westerlies'],
  [[-49, -58], 'Westerlies'],
  [[20, -44], 'North-East Trades'],
  [[-20, -28], 'South-East Trades'],
  [[1, 172], 'Doldrums'],
];

const SEA_LABELS: [LatLon, string][] = [
  [[39, -66], 'Gulf Stream'],
  [[34, 146], 'Kuroshio'],
  [[-33, 30], 'Agulhas'],
  [[-24, -79], 'Humboldt'],
  [[-60, 25], 'Antarctic Circumpolar'],
  [[12, -90], 'N. Equatorial'],
];

/** Gyre centres for the whirlpool glyphs: lat, lon, turning clockwise. */
const GYRES: [number, number, boolean][] = [
  [30, -46, true],
  [32, -158, true],
  [-28, -19, false],
  [-30, -126, false],
  [-28, 76, false],
];

/** Each cherub: name, seat, and the compass bearing of the wind it blows. */
const ANEMOI: { name: string; lat: number; lon: number; bearing: number }[] = [
  { name: 'Boreas', lat: 72, lon: -118, bearing: 270 },
  { name: 'Skiron', lat: 50, lon: -56, bearing: 90 },
  { name: 'Zephyros', lat: 45, lon: 8, bearing: 90 },
  { name: 'Kaikias', lat: 73, lon: 138, bearing: 270 },
  { name: 'Apeliotes', lat: 17, lon: 152, bearing: 225 },
  { name: 'Euros', lat: -17, lon: 58, bearing: 315 },
  { name: 'Notos', lat: -72, lon: -22, bearing: 270 },
  { name: 'Lips', lat: -48, lon: -128, bearing: 90 },
];

/* ------------------------------------------------------------- sprites -- */

interface Billboard {
  sprite: THREE.Sprite;
  /** height ÷ width of the source canvas, kept here because three's
   *  `texture.image` is untyped. */
  aspect: number;
}

/**
 * Figures hold a constant size on screen: `sizeAttenuation: false` makes
 * three multiply the sprite's scale by its view-space depth, cancelling the
 * perspective divide. A cherub sized in kilometres would be a speck at
 * full-globe zoom and fill the window from low orbit.
 */
function spriteFrom(canvas: HTMLCanvasElement, renderOrder: number): Billboard {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: false,
    }),
  );
  sprite.renderOrder = renderOrder;
  return { sprite, aspect: canvas.height / canvas.width };
}

/** Letter-spaced serif caption on a soft plate, so it reads over any sea. */
function labelCanvas(text: string, plate: string, color: string): HTMLCanvasElement {
  const pad = 26;
  const size = 46;
  const probe = newCanvas(8, 8).getContext('2d')!;
  probe.font = `italic 600 ${size}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
  const spacing = size * 0.12;
  const w = Math.ceil(probe.measureText(text).width + spacing * text.length) + pad * 2;
  const h = size + pad * 2;
  const c = newCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.font = probe.font;
  ctx.textBaseline = 'middle';

  ctx.fillStyle = plate;
  const rr = h * 0.34;
  ctx.beginPath();
  ctx.moveTo(pad * 0.4 + rr, pad * 0.5);
  ctx.arcTo(w - pad * 0.4, pad * 0.5, w - pad * 0.4, h - pad * 0.5, rr);
  ctx.arcTo(w - pad * 0.4, h - pad * 0.5, pad * 0.4, h - pad * 0.5, rr);
  ctx.arcTo(pad * 0.4, h - pad * 0.5, pad * 0.4, pad * 0.5, rr);
  ctx.arcTo(pad * 0.4, pad * 0.5, w - pad * 0.4, pad * 0.5, rr);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = color;
  let x = pad;
  for (const ch of text) {
    ctx.fillText(ch, x, h / 2);
    x += ctx.measureText(ch).width + spacing;
  }
  return c;
}

/* -------------------------------------------------------------- layers -- */

/**
 * One overlay tab: ribbons, figures and captions, all parented to the
 * rotating Earth group so they stay pinned to the sea and sky beneath them.
 */
export class Overlay {
  readonly group = new THREE.Group();
  private flow: FlowLayer;
  private spinners: { sprite: THREE.Sprite; rate: number }[] = [];
  private breaths: { sprite: THREE.Sprite; dir: THREE.Vector3; anchor: THREE.Vector3 }[] = [];
  /**
   * `frac` is the figure's height as a fraction of the viewport height;
   * `fade` is the range of `normal · toCamera` over which it appears, which
   * is what stops a billboard anchored near the limb from hanging half off
   * the globe into empty space.
   */
  private scaled: {
    sprite: THREE.Sprite;
    frac: number;
    aspect: number;
    fade: [number, number];
    opacity: number;
  }[] = [];
  private textures: THREE.Texture[] = [];

  constructor(kind: 'winds' | 'currents', style: ChartStyle) {
    const pal = PALETTE[style][kind === 'winds' ? 'wind' : 'sea'];
    const shape: FlowStyle =
      kind === 'winds'
        ? {
            radiusKm: EARTH_R * 1.035,
            width: 0.0022,
            dashKm: 2600,
            speed: 0.12,
            color: pal.color,
            head: pal.head,
            base: 0.32,
            pulse: 0.62,
            arrowEvery: 30,
            arrow: 0.0075,
          }
        : {
            radiusKm: EARTH_R * 1.018,
            width: 0.0026,
            dashKm: 2100,
            speed: 0.07,
            color: pal.color,
            head: pal.head,
            base: 0.36,
            pulse: 0.58,
            arrowEvery: 26,
            arrow: 0.008,
          };

    this.flow = new FlowLayer(kind === 'winds' ? windSpecs() : currentSpecs(), shape);
    this.group.add(this.flow.group);

    // A figure sitting on the surface must be gone by the limb; a cherub
    // floating well above it may hang past the edge before it goes.
    const ON_SURFACE: [number, number] = [0.14, 0.42];
    const ALOFT: [number, number] = [-0.58, -0.3];

    const place = (
      b: Billboard,
      at: THREE.Vector3,
      frac: number,
      fade: [number, number],
      opacity = 1,
    ) => {
      b.sprite.position.copy(at);
      this.group.add(b.sprite);
      this.textures.push(b.sprite.material.map!);
      this.scaled.push({ sprite: b.sprite, frac, aspect: b.aspect, fade, opacity });
      return b.sprite;
    };

    const labels = kind === 'winds' ? WIND_LABELS : SEA_LABELS;
    for (const [[lat, lon], text] of labels) {
      const b = spriteFrom(labelCanvas(text, pal.plate, pal.text), 4);
      place(b, llVec(lat, lon).multiplyScalar(EARTH_R * 1.06), 0.034, ON_SURFACE);
    }

    if (kind === 'currents') {
      for (const [lat, lon, cw] of GYRES) {
        const b = spriteFrom(whirlpoolTexture(256, cw, pal.figure), 3);
        place(b, llVec(lat, lon).multiplyScalar(EARTH_R * 1.02), 0.1, ON_SURFACE, 0.85);
        this.spinners.push({ sprite: b.sprite, rate: (cw ? -1 : 1) * 0.28 });
      }
    } else if (style === 'mythos') {
      // The Anemoi belong to the chart, not to the photograph: over the
      // satellite globe the belts speak for themselves and putti would only
      // read as clip art. The ribbons and their captions carry the data in
      // both styles.
      const head = cherubTexture(256, pal.figure, CHERUB_SKIN);
      const breath = breathTexture(256, pal.figure);
      for (const a of ANEMOI) {
        const anchor = llVec(a.lat, a.lon).multiplyScalar(EARTH_R * 1.22);

        const puff = spriteFrom(breath, 5);
        place(puff, anchor, 0.28, ALOFT, 0.92);
        place(spriteFrom(head, 6), anchor, 0.1, ALOFT);

        const cap = spriteFrom(labelCanvas(a.name, pal.plate, pal.text), 6);
        cap.sprite.center.set(0.5, 2.0);
        place(cap, anchor, 0.03, ALOFT);

        // local wind bearing, as a tangent vector on the sphere
        const up = llVec(a.lat, a.lon);
        const east = new THREE.Vector3(-Math.sin(a.lon * DEG), Math.cos(a.lon * DEG), 0);
        const north = new THREE.Vector3().crossVectors(up, east).negate();
        const dir = east
          .multiplyScalar(Math.sin(a.bearing * DEG))
          .addScaledVector(north, Math.cos(a.bearing * DEG))
          .normalize();
        this.breaths.push({ sprite: puff.sprite, dir, anchor });
      }
    }
  }

  /**
   * Per-frame update. Figure scales are recomputed from the camera's field
   * of view — with `sizeAttenuation` off, a sprite's NDC height is
   * `scale.y × projection[1][1]`, so this pins each figure to its requested
   * share of the viewport. The cherubs' breath is re-aimed in screen space
   * so it always streams along the wind, whichever way the globe is turned.
   */
  update(seconds: number, camera: THREE.PerspectiveCamera, dt: number): void {
    this.flow.setTime(seconds);

    const k = 2 * Math.tan((camera.fov * DEG) / 2);
    const world = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    for (const s of this.scaled) {
      const h = s.frac * k;
      s.sprite.scale.set(h / s.aspect, h, 1);

      s.sprite.getWorldPosition(world);
      toCam.subVectors(camera.position, world).normalize();
      const facing = world.normalize().dot(toCam);
      const a = s.opacity * THREE.MathUtils.smoothstep(facing, s.fade[0], s.fade[1]);
      s.sprite.material.opacity = a;
      s.sprite.visible = a > 0.01;
    }

    for (const sp of this.spinners) sp.sprite.material.rotation += sp.rate * dt;

    if (this.breaths.length) {
      const world = new THREE.Vector3();
      const tip = new THREE.Vector3();
      for (const b of this.breaths) {
        b.sprite.getWorldPosition(world);
        tip.copy(b.anchor).addScaledVector(b.dir, 1200).applyMatrix4(b.sprite.parent!.matrixWorld);
        world.project(camera);
        tip.project(camera);
        b.sprite.material.rotation = Math.atan2(
          (tip.y - world.y) / camera.aspect,
          tip.x - world.x,
        );
      }
    }
  }

  dispose(): void {
    this.flow.dispose();
    for (const t of this.textures) t.dispose();
    this.group.traverse((o) => {
      const s = o as THREE.Sprite;
      if (s.isSprite) s.material.dispose();
    });
    this.group.clear();
  }
}

