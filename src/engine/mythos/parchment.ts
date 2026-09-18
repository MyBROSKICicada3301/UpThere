/**
 * Builds the antique chart: one equirectangular canvas that replaces the
 * satellite day texture when the mythos style is selected.
 *
 * Source data is the two textures the app already ships. The specular map
 * (`earth_specular_2048.jpg`) is a clean water mask — black land, white sea,
 * no clouds or ice to misread — and drives every geometric decision here.
 * The colour texture only supplies a faint hand-tint for the land wash.
 *
 * Pipeline:
 *
 *   specular ─► land mask ─► despeckle ─► signed distance field
 *                                              │
 *          ┌───────────────────────────────────┼──────────────────┐
 *          ▼                                   ▼                  ▼
 *    tone wash (land/sea)            marching squares        glyph placement
 *    day texture hand-tint      level  0 → coastline         (inland only)
 *                               level <0 → engraved
 *                                          sea shading
 *
 * The distance field does three jobs at once, which is why it is worth its
 * ~2M-cell cost: contouring it at level 0 gives a coastline, contouring it
 * at small negative levels gives the parallel "engraved" bands that hug
 * every shore on a period chart, and testing it keeps hill hachures from
 * spilling into the water.
 *
 * Cost is roughly 0.4 s, paid once per session on the first switch to the
 * mythos style; the result is cached.
 */

import {
  INK,
  INK_DEEP,
  PAPER_LIGHT,
  PAPER_MID,
  foxing,
  hillGlyph,
  inkLabel,
  newCanvas,
  paperMottle,
  rng,
  tuftGlyph,
  wobble,
  type Ctx,
} from './ink';
import { compassRose, galleon, seaSerpent } from './figures';

/** Output resolution of the chart sheet. */
const MAP_W = 4096;
const MAP_H = 2048;
/** Mask/field resolution — the source textures' native size. */
const MW = 2048;
const MH = 1024;
const SCALE = MAP_W / MW;

/* ------------------------------------------------------------- sources -- */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

function pixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const c = newCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/* ---------------------------------------------------------- land shape -- */

/**
 * 1 where the specular map says land. A 3×3 majority pass runs twice: it
 * erases JPEG ringing along the coasts and closes the single-pixel river
 * threads that would otherwise sprout their own engraved shorelines.
 */
function landMask(spec: Uint8ClampedArray): Uint8Array {
  let mask = new Uint8Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) mask[i] = spec[i * 4] < 128 ? 1 : 0;

  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(MW * MH);
    for (let y = 0; y < MH; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(MH - 1, y + 1);
      for (let x = 0; x < MW; x++) {
        const xm = (x - 1 + MW) % MW;
        const xp = (x + 1) % MW;
        const n =
          mask[y0 * MW + xm] + mask[y0 * MW + x] + mask[y0 * MW + xp] +
          mask[y * MW + xm] + mask[y * MW + x] + mask[y * MW + xp] +
          mask[y1 * MW + xm] + mask[y1 * MW + x] + mask[y1 * MW + xp];
        next[y * MW + x] = n >= 5 ? 1 : 0;
      }
    }
    mask = next;
  }
  return mask;
}

/**
 * Signed distance to the shoreline in mask pixels, positive inland.
 * Chamfer (1, √2) sweeps, wrapped in longitude; two forward/backward pairs
 * are enough to make the antimeridian seam invisible.
 */
function signedDistance(mask: Uint8Array): Float32Array {
  const dIn = new Float32Array(MW * MH);
  const dOut = new Float32Array(MW * MH);
  const BIG = 1e6;
  for (let i = 0; i < MW * MH; i++) {
    dIn[i] = mask[i] ? BIG : 0;
    dOut[i] = mask[i] ? 0 : BIG;
  }

  const D = 1;
  const Q = Math.SQRT2;
  const sweep = (f: Float32Array) => {
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        const i = y * MW + x;
        const xm = (x - 1 + MW) % MW;
        const xp = (x + 1) % MW;
        let v = f[i];
        v = Math.min(v, f[y * MW + xm] + D);
        if (y > 0) {
          v = Math.min(v, f[(y - 1) * MW + x] + D);
          v = Math.min(v, f[(y - 1) * MW + xm] + Q);
          v = Math.min(v, f[(y - 1) * MW + xp] + Q);
        }
        f[i] = v;
      }
    }
    for (let y = MH - 1; y >= 0; y--) {
      for (let x = MW - 1; x >= 0; x--) {
        const i = y * MW + x;
        const xm = (x - 1 + MW) % MW;
        const xp = (x + 1) % MW;
        let v = f[i];
        v = Math.min(v, f[y * MW + xp] + D);
        if (y < MH - 1) {
          v = Math.min(v, f[(y + 1) * MW + x] + D);
          v = Math.min(v, f[(y + 1) * MW + xm] + Q);
          v = Math.min(v, f[(y + 1) * MW + xp] + Q);
        }
        f[i] = v;
      }
    }
  };
  sweep(dIn);
  sweep(dIn);
  sweep(dOut);
  sweep(dOut);

  const sdf = new Float32Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) sdf[i] = dIn[i] - dOut[i];
  return sdf;
}

/** Box-downsamples a field by 2, keeping the longitude wrap. */
function halve(f: Float32Array, w: number, h: number): Float32Array {
  const hw = w >> 1;
  const hh = h >> 1;
  const out = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const a = f[y * 2 * w + x * 2];
      const b = f[y * 2 * w + x * 2 + 1];
      const c = f[(y * 2 + 1) * w + x * 2];
      const d = f[(y * 2 + 1) * w + x * 2 + 1];
      out[y * hw + x] = (a + b + c + d) * 0.25;
    }
  }
  return out;
}

/**
 * Marching squares over a scalar field, wrapped in x. Returns flat
 * [x0,y0,x1,y1,…] segments in field coordinates.
 *
 * Segments are emitted independently and never chained — they do not need
 * to be. Neighbouring cells interpolate a shared edge with the same
 * arithmetic, so the endpoints coincide exactly and a round-capped stroke
 * over the lot draws as one continuous line.
 */
function contour(field: Float32Array, w: number, h: number, level: number): Float32Array {
  const out: number[] = [];
  const lerp = (va: number, vb: number) => (level - va) / (vb - va);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      const xp = (x + 1) % w;
      const i = y * w;
      const j = (y + 1) * w;
      const a = field[i + x];
      const b = field[i + xp];
      const c = field[j + xp];
      const d = field[j + x];
      let k = 0;
      if (a > level) k |= 1;
      if (b > level) k |= 2;
      if (c > level) k |= 4;
      if (d > level) k |= 8;
      if (k === 0 || k === 15) continue;

      const T = () => [x + lerp(a, b), y];
      const R = () => [x + 1, y + lerp(b, c)];
      const B = () => [x + lerp(d, c), y + 1];
      const L = () => [x, y + lerp(a, d)];
      const push = (p: number[], q: number[]) => out.push(p[0], p[1], q[0], q[1]);

      switch (k) {
        case 1: case 14: push(L(), T()); break;
        case 2: case 13: push(T(), R()); break;
        case 3: case 12: push(L(), R()); break;
        case 4: case 11: push(R(), B()); break;
        case 6: case 9: push(T(), B()); break;
        case 7: case 8: push(L(), B()); break;
        case 5: push(L(), T()); push(R(), B()); break;
        case 10: push(T(), R()); push(L(), B()); break;
      }
    }
  }
  return new Float32Array(out);
}

/**
 * Strokes contour segments into the sheet. `jitter` displaces each endpoint
 * by a position-hashed amount, which gives the line a quill-drawn waver
 * without pulling shared endpoints apart.
 */
function strokeContours(
  ctx: Ctx,
  segs: Float32Array,
  scale: number,
  jitter: number,
  width: number,
  color: string,
  alpha: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    const x0 = segs[i] * scale;
    const y0 = segs[i + 1] * scale;
    const x1 = segs[i + 2] * scale;
    const y1 = segs[i + 3] * scale;
    ctx.moveTo(x0 + wobble(x0, y0, 1) * jitter, y0 + wobble(x0, y0, 2) * jitter);
    ctx.lineTo(x1 + wobble(x1, y1, 1) * jitter, y1 + wobble(x1, y1, 2) * jitter);
  }
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------ map sheet -- */

const lonToX = (lon: number) => ((lon + 180) / 360) * MAP_W;
const latToY = (lat: number) => ((90 - lat) / 180) * MAP_H;

/**
 * Runs `draw` at a lat/lon with the horizontal squash that cancels the
 * equirectangular stretch, so figures and lettering keep their proportions
 * once the sheet is wrapped onto the globe.
 */
function atLatLon(ctx: Ctx, lat: number, lon: number, draw: (c: Ctx) => void): void {
  ctx.save();
  ctx.translate(lonToX(lon), latToY(lat));
  ctx.scale(Math.max(0.12, Math.cos((lat * Math.PI) / 180)), 1);
  draw(ctx);
  ctx.restore();
}

/** Meridians, parallels, and the faint portolan web of rhumb lines. */
function drawGraticule(ctx: Ctx): void {
  ctx.save();
  ctx.lineCap = 'butt';

  for (let lon = -180; lon <= 180; lon += 15) {
    const major = lon % 90 === 0;
    ctx.strokeStyle = INK;
    ctx.globalAlpha = major ? 0.3 : 0.16;
    ctx.lineWidth = major ? 2.4 : 1.5;
    const x = lonToX(lon);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, MAP_H);
    ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const major = lat === 0;
    ctx.strokeStyle = INK;
    ctx.globalAlpha = major ? 0.32 : 0.16;
    ctx.lineWidth = major ? 2.6 : 1.5;
    const y = latToY(lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MAP_W, y);
    ctx.stroke();
  }
  // tropics and polar circles, in red ink as the engravers had them
  for (const lat of [23.44, -23.44, 66.56, -66.56]) {
    ctx.strokeStyle = '#9c3c18';
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 2;
    const y = latToY(lat);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(MAP_W, y);
    ctx.stroke();
  }

  // rhumb web: 16 rays from three ocean nodes
  const nodes: [number, number][] = [[6, -36], [0, -142], [-12, 74]];
  ctx.globalAlpha = 0.11;
  ctx.lineWidth = 1.6;
  for (const [lat, lon] of nodes) {
    const cx = lonToX(lon);
    const cy = latToY(lat);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.strokeStyle = i % 4 === 0 ? '#9c3c18' : INK;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * MAP_W * 0.42, cy + Math.sin(a) * MAP_W * 0.42);
      ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(cx, cy, MAP_H * 0.075, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.11;
  }
  ctx.restore();
}

/**
 * Local relief of the colour texture, used to decide where the engraver
 * would have bothered drawing mountains. Ridge shadows give the Andes,
 * Rockies, Alps and Himalaya a high score; the Sahara and the Amazon
 * basin score low and stay open, the way a plain reads on a real chart.
 */
function ruggedness(day: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(MW * MH);
  const lum = (x: number, y: number) => {
    const i = (y * MW + ((x + MW) % MW)) * 4;
    return (day[i] * 0.3 + day[i + 1] * 0.59 + day[i + 2] * 0.11) / 255;
  };
  for (let y = 3; y < MH - 3; y++) {
    for (let x = 0; x < MW; x++) {
      const g = Math.abs(lum(x + 3, y) - lum(x - 3, y)) + Math.abs(lum(x, y + 3) - lum(x, y - 3));
      // Relative contrast, not absolute: bright desert dunes have strong
      // gradients too, and without this the Sahara out-mountains the Alps.
      out[y * MW + x] = g / (lum(x, y) + 0.22);
    }
  }
  return out;
}

/** Hachured hills over the uplands, forest tufts over the green lowlands. */
function drawTerrain(ctx: Ctx, sdf: Float32Array, day: Uint8ClampedArray): void {
  const r = rng(20240918);
  const relief = ruggedness(day);
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let placed = 0;
  let tries = 0;
  while (placed < 4200 && tries < 260000) {
    tries++;
    const mx = Math.floor(r() * MW);
    const my = Math.floor(r() * MH);
    const d = sdf[my * MW + mx];
    if (d < 5) continue;

    // Latitude rejection thins the poles, where equirectangular cells are
    // squeezed to slivers and glyphs would pile up into a smear.
    const lat = 90 - (my / MH) * 180;
    if (r() > Math.cos((lat * Math.PI) / 180) * 1.15) continue;

    const i = (my * MW + mx) * 4;
    const green = (day[i + 1] - day[i]) / 255;
    const lum = (day[i] * 0.3 + day[i + 1] * 0.59 + day[i + 2] * 0.11) / 255;
    const rug = relief[my * MW + mx];

    const mountain = rug > 0.2;
    const forest = green > 0.004 && lum < 0.36;
    // plains keep a thin scatter so they do not read as blank paper
    const chance = mountain ? 1 : forest ? 0.3 : 0.07;
    if (r() > chance) continue;

    const x = mx * SCALE;
    const y = my * SCALE;
    const squash = Math.max(0.18, Math.cos((lat * Math.PI) / 180));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(squash, 1);
    ctx.globalAlpha = 0.3 + r() * 0.32;
    ctx.lineWidth = 1.5 + r() * 0.9;
    if (mountain) hillGlyph(ctx, 0, 0, 6 + Math.min(1, rug * 2.2) * 6 + r() * 3, r);
    else if (forest) tuftGlyph(ctx, 0, 0, 4.5 + r() * 3.5, r);
    else hillGlyph(ctx, 0, 0, 4 + r() * 3, r);
    ctx.restore();
    placed++;
  }
  ctx.restore();
}

/** Ships, monsters, roses and lettering. */
function drawCartouche(ctx: Ctx): void {
  atLatLon(ctx, -36, -22, (c) => compassRose(c, 0, 0, 185, 0.06));
  atLatLon(ctx, 41, -168, (c) => compassRose(c, 0, 0, 96, -0.1));

  atLatLon(ctx, 31, -47, (c) => galleon(c, 0, 0, 98, 11));
  atLatLon(ctx, -13, -134, (c) => galleon(c, 0, 0, 82, 29));
  atLatLon(ctx, 13, 67, (c) => galleon(c, 0, 0, 72, 47));
  atLatLon(ctx, -40, 22, (c) => galleon(c, 0, 0, 66, 83));

  atLatLon(ctx, -31, 62, (c) => seaSerpent(c, 0, 0, 62));
  atLatLon(ctx, -44, -140, (c) => seaSerpent(c, 0, 0, 54, true));
  atLatLon(ctx, 57, -37, (c) => seaSerpent(c, 0, 0, 46));

  const sea = (lat: number, lon: number, text: string, size = 46) =>
    atLatLon(ctx, lat, lon, (c) => inkLabel(c, text, 0, 0, size, { alpha: 0.6 }));
  const land = (lat: number, lon: number, text: string, size = 44) =>
    atLatLon(ctx, lat, lon, (c) =>
      inkLabel(c, text, 0, 0, size, { italic: false, alpha: 0.72, spacing: size * 0.22 }),
    );

  sea(44, -38, 'North Atlantic');
  sea(39, -38, 'Ocean');
  sea(-19, -18, 'South Atlantic');
  sea(-24, -18, 'Ocean');
  sea(21, -158, 'North Pacific');
  sea(16, -158, 'Ocean');
  sea(-32, -112, 'South Pacific');
  sea(-37, -112, 'Ocean');
  sea(-22, 82, 'Indian Ocean');
  sea(72, -14, 'Arctic Ocean', 40);
  sea(-58, 140, 'Southern Ocean', 40);
  sea(-33, 47, 'Hic Svnt Dracones', 34);
  sea(6, -160, 'Terra Incognita', 32);

  land(48, -101, 'NORTH AMERICA', 40);
  land(-11, -58, 'SOUTH AMERICA', 40);
  land(8, 20, 'AFRICA', 44);
  land(53, 22, 'EVROPA', 32);
  land(46, 92, 'ASIA', 48);
  land(-25, 134, 'AVSTRALIA', 36);
  land(-79, 40, 'TERRA AVSTRALIS', 34);
}

/* ----------------------------------------------------------- compositor -- */

async function render(baseUrl: string): Promise<HTMLCanvasElement> {
  const [specImg, dayImg] = await Promise.all([
    loadImage(`${baseUrl}textures/earth_specular_2048.jpg`),
    loadImage(`${baseUrl}textures/earth_atmos_2048.jpg`),
  ]);
  const spec = pixels(specImg, MW, MH);
  const day = pixels(dayImg, MW, MH);

  const mask = landMask(spec);
  const sdf = signedDistance(mask);

  // Tone wash, built at mask resolution and scaled up: soft gradients do
  // not need the sheet's full resolution, and the ink drawn on top does.
  const tone = newCanvas(MW, MH);
  const toneCtx = tone.getContext('2d')!;
  const img = toneCtx.createImageData(MW, MH);
  const px = img.data;
  for (let i = 0; i < MW * MH; i++) {
    const d = sdf[i];
    const j = i * 4;
    let r: number;
    let g: number;
    let b: number;
    if (d > 0) {
      // land: parchment, leaning very slightly toward the real terrain hue
      const l = (day[j] * 0.3 + day[j + 1] * 0.59 + day[j + 2] * 0.11) / 255;
      const k = 0.17;
      r = 247 * (1 - k) + (168 + l * 150) * k;
      g = 233 * (1 - k) + (150 + l * 150) * k;
      b = 200 * (1 - k) + (112 + l * 140) * k;
    } else {
      // sea: a shade cooler, darkening into the deep
      const deep = Math.min(1, -d / 140);
      r = 232 - deep * 16;
      g = 214 - deep * 18;
      b = 178 - deep * 14;
    }
    px[j] = r;
    px[j + 1] = g;
    px[j + 2] = b;
    px[j + 3] = 255;
  }
  toneCtx.putImageData(img, 0, 0);

  const sheet = newCanvas(MAP_W, MAP_H);
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = PAPER_MID;
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tone, 0, 0, MAP_W, MAP_H);

  // engraved sea shading: contours of the distance field just offshore
  const half = halve(sdf, MW, MH);
  for (const [level, width, alpha] of [
    [-1.6, 2.0, 0.42],
    [-4.0, 1.8, 0.34],
    [-7.0, 1.7, 0.27],
    [-10.5, 1.6, 0.21],
    [-14.5, 1.5, 0.15],
    [-19.5, 1.5, 0.1],
  ] as const) {
    strokeContours(ctx, contour(half, MW >> 1, MH >> 1, level), SCALE * 2, 2.2, width, INK, alpha);
  }

  drawGraticule(ctx);
  drawTerrain(ctx, sdf, day);

  // the shoreline itself, at full mask resolution
  strokeContours(ctx, contour(sdf, MW, MH, 0), SCALE, 1.6, 3.4, INK_DEEP, 0.9);

  drawCartouche(ctx);

  // ageing: paper grain, foxing, and a burnt edge
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.34;
  ctx.drawImage(paperMottle(320, 160, 4242), 0, 0, MAP_W, MAP_H);
  ctx.restore();
  foxing(ctx, MAP_W, MAP_H, 2200, 909);

  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const vign = ctx.createLinearGradient(0, 0, 0, MAP_H);
  vign.addColorStop(0, PAPER_MID);
  vign.addColorStop(0.16, PAPER_LIGHT);
  vign.addColorStop(0.5, '#fffefa');
  vign.addColorStop(0.84, PAPER_LIGHT);
  vign.addColorStop(1, PAPER_MID);
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, MAP_W, MAP_H);
  ctx.restore();

  return sheet;
}

let pending: Promise<HTMLCanvasElement> | null = null;

/** Builds the chart once and hands the same canvas to every later caller. */
export function antiqueChart(baseUrl: string): Promise<HTMLCanvasElement> {
  if (!pending) pending = render(baseUrl);
  return pending;
}
