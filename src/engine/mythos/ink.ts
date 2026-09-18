/**
 * Pen-and-ink drawing primitives for the antique chart.
 *
 * Everything the mythos style draws — the parchment itself, coastlines,
 * hill hachures, compass roses, galleons, sea serpents, wind cherubs — is
 * generated here with canvas 2D paths. Nothing is fetched: the app ships
 * only the three satellite textures it already had.
 *
 * Two conventions keep the output looking hand-drawn rather than plotted:
 *
 *  - every random choice comes from a seeded `rng`, so a given chart is
 *    identical on every launch;
 *  - `wobble()` is a pure function of position, so two strokes that share
 *    an endpoint receive the same displacement and stay connected even
 *    though neither knows about the other.
 */

export const PAPER_LIGHT = '#f0dcb4';
export const PAPER_MID = '#e2c99c';
export const PAPER_DARK = '#c9a877';
export const INK = '#5b4025';
export const INK_DEEP = '#3f2a14';
export const INK_RED = '#9c3c18';
export const INK_SEA = '#1d5a61';

export type Ctx = CanvasRenderingContext2D;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Position-hashed displacement in [-1, 1]. Pure in (x, y), which is what
 * lets independently generated contour segments stay stitched together
 * after jittering.
 */
export function wobble(x: number, y: number, salt = 0): number {
  let h = Math.imul(Math.round(x * 3) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.round(y * 3) ^ (salt * 0x27d4eb2d), 0xc2b2ae35);
  h ^= h >>> 15;
  return ((h >>> 0) / 2147483648 - 1);
}

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Warm paper wash with uneven tone, drawn small and scaled up by callers. */
export function paperMottle(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = newCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const r = rng(seed);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (0.04 + r() * 0.16) * w;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.55;
    const a = 0.05 + r() * 0.1;
    g.addColorStop(0, dark ? `rgba(120,92,52,${a})` : `rgba(255,246,222,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Fine speckle of foxing spots, for the ageing pass. */
export function foxing(ctx: Ctx, w: number, h: number, count: number, seed: number): void {
  const r = rng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = 0.6 + r() * 3.4;
    ctx.fillStyle = `rgba(122,86,44,${0.04 + r() * 0.13})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A stroke with a slightly uneven nib: three passes at varying alpha. */
export function inkPath(ctx: Ctx, draw: (c: Ctx) => void, color: string, width: number): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = width * 1.7;
  ctx.beginPath();
  draw(ctx);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.beginPath();
  draw(ctx);
  ctx.stroke();
  ctx.restore();
}

/** Small hachure hill — the antique way of saying "there is terrain here". */
export function hillGlyph(ctx: Ctx, x: number, y: number, s: number, r: () => number): void {
  const w = s * (0.8 + r() * 0.5);
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.quadraticCurveTo(x - w * 0.45, y - s * 1.25, x, y - s * 0.15);
  ctx.quadraticCurveTo(x + w * 0.5, y - s * 1.45, x + w, y);
  ctx.stroke();
  // shading strokes down the right flank
  const n = 2 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    ctx.beginPath();
    ctx.moveTo(x + w * t * 0.9, y - s * (0.9 - t * 0.5));
    ctx.lineTo(x + w * t * 1.05, y - s * 0.05);
    ctx.stroke();
  }
}

/** Tuft of grass / forest mark for lowland interiors. */
export function tuftGlyph(ctx: Ctx, x: number, y: number, s: number, r: () => number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.9, x - s * 0.15, y - s * 1.4);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + s * 0.1, y - s * 1.0, x + s * 0.05, y - s * 1.7);
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + s * 0.6, y - s * 0.8, x + s * 0.9, y - s * 1.2);
  ctx.stroke();
  if (r() < 0.4) {
    ctx.beginPath();
    ctx.arc(x + s * 0.05, y - s * 1.9, s * 0.22, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** Antique-style label: letter-spaced serif, with a soft paper halo. */
export function inkLabel(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { italic?: boolean; spacing?: number; alpha?: number; color?: string } = {},
): void {
  const { italic = true, spacing = size * 0.14, alpha = 0.85, color = INK_DEEP } = opts;
  ctx.save();
  ctx.font = `${italic ? 'italic ' : ''}600 ${size}px "Palatino Linotype", "Book Antiqua", Georgia, serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  let total = 0;
  for (const ch of chars) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  let cx = x - total / 2;
  ctx.globalAlpha = alpha * 0.35;
  ctx.lineWidth = size * 0.22;
  ctx.strokeStyle = 'rgba(240,222,186,0.9)';
  ctx.lineJoin = 'round';
  for (const ch of chars) {
    ctx.strokeText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  cx = x - total / 2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (const ch of chars) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.restore();
}
