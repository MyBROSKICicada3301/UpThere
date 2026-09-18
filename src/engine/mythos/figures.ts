/**
 * The bestiary and instruments of the chart: compass rose, galleons, sea
 * serpents, whirlpools and the cherub winds.
 *
 * Figures that live on the map sheet (rose, ships, serpents) draw straight
 * into the equirectangular parchment canvas. Figures that must stay upright
 * on screen (the cherubs and their breath, the whirlpools) are baked into
 * their own small canvases and used as sprite textures.
 */

import { INK, INK_DEEP, inkLabel, newCanvas, rng, type Ctx } from './ink';

/* ---------------------------------------------------------------- rose -- */

/**
 * A 16-point compass rose with a fleur-de-lis north and a ring of degree
 * ticks. `rot` lets a rose sit askew, the way an engraver would place it.
 */
export function compassRose(ctx: Ctx, cx: number, cy: number, r: number, rot = 0): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.lineWidth = Math.max(1, r * 0.012);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';

  for (const f of [1, 0.9, 0.62]) {
    ctx.beginPath();
    ctx.arc(0, 0, r * f, 0, Math.PI * 2);
    ctx.stroke();
  }

  // degree ticks between the two outer rings
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 9 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(a) * r * (long ? 0.9 : 0.945), Math.sin(a) * r * (long ? 0.9 : 0.945));
    ctx.stroke();
  }

  // 16 points: long cardinals, short intercardinals, each split light/dark
  const spike = (a: number, len: number, wide: number) => {
    const tipX = Math.cos(a) * len;
    const tipY = Math.sin(a) * len;
    const pX = Math.cos(a + Math.PI / 2) * wide;
    const pY = Math.sin(a + Math.PI / 2) * wide;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(pX, pY);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(63,42,20,0.82)';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(-pX, -pY);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = 'rgba(232,214,176,0.75)';
    ctx.fill();
    ctx.stroke();
  };

  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const cardinal = i % 4 === 0;
    const half = i % 2 === 0;
    spike(a, r * (cardinal ? 0.88 : half ? 0.66 : 0.44), r * (cardinal ? 0.075 : 0.05));
  }

  // fleur-de-lis marking north
  ctx.save();
  ctx.translate(0, -r * 0.88);
  ctx.scale(r * 0.02, r * 0.02);
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.bezierCurveTo(3.5, -5, 3, -1, 0, 3);
  ctx.bezierCurveTo(-3, -1, -3.5, -5, 0, -11);
  ctx.closePath();
  ctx.fillStyle = INK_DEEP;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.bezierCurveTo(-6, -2, -8, 3, -4, 6);
  ctx.moveTo(0, 2);
  ctx.bezierCurveTo(6, -2, 8, 3, 4, 6);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  ctx.restore();

  const lab = r * 0.2;
  inkLabel(ctx, 'N', cx, cy - r * 1.2, lab, { italic: false, alpha: 0.75 });
  inkLabel(ctx, 'S', cx, cy + r * 1.2, lab, { italic: false, alpha: 0.75 });
  inkLabel(ctx, 'E', cx + r * 1.22, cy, lab, { italic: false, alpha: 0.75 });
  inkLabel(ctx, 'W', cx - r * 1.22, cy, lab, { italic: false, alpha: 0.75 });
}

/* -------------------------------------------------------------- galleon -- */

/** A three-masted carrack riding a few wave strokes. `s` is the hull half-width. */
export function galleon(ctx: Ctx, cx: number, cy: number, s: number, seed: number): void {
  const r = rng(seed);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = Math.max(1, s * 0.035);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const masts: [number, number][] = [
    [-s * 0.52, s * 1.25],
    [s * 0.04, s * 1.72],
    [s * 0.58, s * 1.15],
  ];

  // standing rigging, behind everything
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(0.6, s * 0.016);
  for (const [mx, mh] of masts) {
    for (const end of [-s * 0.95, s * 1.45]) {
      ctx.beginPath();
      ctx.moveTo(mx, -mh + s * 0.06);
      ctx.lineTo(end, end > 0 ? -s * 0.5 : -s * 0.3);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, s * 0.035);

  // masts, drawn before the sails so they show above and between them
  for (const [mx, mh] of masts) {
    ctx.beginPath();
    ctx.moveTo(mx, -s * 0.05);
    ctx.lineTo(mx, -mh);
    ctx.stroke();
    // yard arms
    const sails = mh > s * 1.5 ? 3 : 2;
    for (let i = 0; i < sails; i++) {
      const top = -mh + s * 0.24 + i * (mh * 0.42);
      const w = s * (0.34 - i * 0.03) * (mh / (s * 1.3));
      ctx.beginPath();
      ctx.moveTo(mx - w * 1.15, top);
      ctx.lineTo(mx + w * 1.15, top);
      ctx.stroke();
    }
  }

  // square sails, bellied out by the wind
  for (const [mx, mh] of masts) {
    const sails = mh > s * 1.5 ? 3 : 2;
    for (let i = 0; i < sails; i++) {
      const top = -mh + s * 0.24 + i * (mh * 0.42);
      const bot = top + mh * 0.3;
      const w = s * (0.34 - i * 0.03) * (mh / (s * 1.3));
      ctx.beginPath();
      ctx.moveTo(mx - w, top);
      ctx.lineTo(mx + w, top);
      ctx.bezierCurveTo(mx + w * 1.18, (top + bot) / 2, mx + w * 1.1, bot - s * 0.04, mx + w * 0.86, bot);
      ctx.quadraticCurveTo(mx, bot + s * 0.11, mx - w * 0.86, bot);
      ctx.bezierCurveTo(mx - w * 1.1, bot - s * 0.04, mx - w * 1.18, (top + bot) / 2, mx - w, top);
      ctx.closePath();
      ctx.fillStyle = 'rgba(242,229,197,0.82)';
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = Math.max(0.6, s * 0.018);
      for (let k = 1; k < 3; k++) {
        const yy = top + ((bot - top) * k) / 3;
        ctx.beginPath();
        ctx.moveTo(mx - w * 1.0, yy);
        ctx.quadraticCurveTo(mx, yy + s * 0.05, mx + w * 1.0, yy);
        ctx.stroke();
      }
      ctx.restore();
      ctx.lineWidth = Math.max(1, s * 0.035);
    }
    // pennant
    ctx.beginPath();
    ctx.moveTo(mx, -mh);
    ctx.lineTo(mx + s * 0.28, -mh + s * 0.07);
    ctx.lineTo(mx, -mh + s * 0.15);
    ctx.closePath();
    ctx.fillStyle = 'rgba(156,60,24,0.78)';
    ctx.fill();
    ctx.stroke();
  }

  // hull: raised stern castle aft, forecastle forward
  ctx.beginPath();
  ctx.moveTo(-s * 1.0, -s * 0.38);
  ctx.lineTo(-s * 0.74, -s * 0.36);
  ctx.lineTo(-s * 0.7, -s * 0.06);
  ctx.lineTo(s * 0.66, -s * 0.06);
  ctx.lineTo(s * 0.74, -s * 0.34);
  ctx.lineTo(s * 1.04, -s * 0.32);
  ctx.lineTo(s * 1.06, -s * 0.02);
  ctx.quadraticCurveTo(s * 0.8, s * 0.44, 0, s * 0.5);
  ctx.quadraticCurveTo(-s * 0.82, s * 0.44, -s * 1.0, -s * 0.38);
  ctx.closePath();
  ctx.fillStyle = 'rgba(228,208,168,0.88)';
  ctx.fill();
  ctx.stroke();

  // wale and gunports
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = Math.max(0.7, s * 0.022);
  ctx.beginPath();
  ctx.moveTo(-s * 0.94, s * 0.06);
  ctx.quadraticCurveTo(0, s * 0.3, s * 1.0, s * 0.04);
  ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.arc(i * s * 0.27, s * 0.14 - Math.abs(i) * s * 0.02, s * 0.035, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = Math.max(1, s * 0.035);

  // bowsprit
  ctx.beginPath();
  ctx.moveTo(s * 0.92, -s * 0.2);
  ctx.lineTo(s * 1.52, -s * 0.56);
  ctx.stroke();

  // water
  ctx.save();
  ctx.globalAlpha = 0.75;
  for (let i = 0; i < 4; i++) {
    const y = s * (0.5 + i * 0.16);
    const x0 = -s * (1.25 + r() * 0.4);
    const x1 = s * (1.25 + r() * 0.4);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    for (let x = x0; x < x1; x += s * 0.22) {
      ctx.quadraticCurveTo(x + s * 0.11, y - s * 0.09, x + s * 0.22, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

/* --------------------------------------------------------- sea serpent -- */

/** Humped sea serpent: head, three coils breaking the surface, spray. */
export function seaSerpent(ctx: Ctx, cx: number, cy: number, s: number, flip = false): void {
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const body = 'rgba(214,190,148,0.7)';

  // three coils, drawn back to front
  for (let i = 2; i >= 0; i--) {
    const x = -s * (0.3 + i * 0.7);
    const h = s * (0.4 - i * 0.055);
    const w = s * (0.46 - i * 0.04);
    ctx.beginPath();
    ctx.moveTo(x - w, 0);
    ctx.bezierCurveTo(x - w, -h * 1.6, x + w, -h * 1.6, x + w, 0);
    ctx.lineTo(x + w * 0.62, 0);
    ctx.bezierCurveTo(x + w * 0.62, -h * 0.95, x - w * 0.62, -h * 0.95, x - w * 0.62, 0);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.stroke();
    // dorsal spines
    for (let k = -1; k <= 1; k++) {
      const a = -Math.PI / 2 + k * 0.55;
      const px = x + Math.cos(a) * w * 0.8;
      const py = -h * 1.05;
      ctx.beginPath();
      ctx.moveTo(px - s * 0.05, py);
      ctx.lineTo(px, py - s * 0.17);
      ctx.lineTo(px + s * 0.05, py);
      ctx.stroke();
    }
  }

  // tail fin
  ctx.beginPath();
  ctx.moveTo(-s * 2.05, 0);
  ctx.quadraticCurveTo(-s * 2.5, -s * 0.15, -s * 2.7, -s * 0.55);
  ctx.quadraticCurveTo(-s * 2.25, -s * 0.35, -s * 2.15, -s * 0.5);
  ctx.quadraticCurveTo(-s * 2.2, -s * 0.15, -s * 2.05, 0);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();

  // neck and head
  ctx.beginPath();
  ctx.moveTo(s * 0.06, s * 0.02);
  ctx.bezierCurveTo(s * 0.5, -s * 0.05, s * 0.72, -s * 0.5, s * 0.66, -s * 1.02);
  ctx.lineTo(s * 0.98, -s * 1.06);
  ctx.bezierCurveTo(s * 1.08, -s * 0.5, s * 0.72, -s * 0.12, s * 0.42, s * 0.02);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(s * 0.62, -s * 0.98);
  ctx.quadraticCurveTo(s * 0.6, -s * 1.42, s * 1.0, -s * 1.44);
  ctx.quadraticCurveTo(s * 1.4, -s * 1.44, s * 1.46, -s * 1.2);
  ctx.lineTo(s * 1.02, -s * 1.12);
  ctx.quadraticCurveTo(s * 1.36, -s * 1.08, s * 1.3, -s * 0.94);
  ctx.quadraticCurveTo(s * 1.0, -s * 0.82, s * 0.98, -s * 1.02);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.stroke();

  // eye, brow, horn
  ctx.beginPath();
  ctx.arc(s * 0.88, -s * 1.28, s * 0.055, 0, Math.PI * 2);
  ctx.fillStyle = INK_DEEP;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.74, -s * 1.38);
  ctx.quadraticCurveTo(s * 0.88, -s * 1.46, s * 1.0, -s * 1.38);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.68, -s * 1.42);
  ctx.quadraticCurveTo(s * 0.5, -s * 1.72, s * 0.62, -s * 1.86);
  ctx.stroke();

  // spray
  ctx.save();
  ctx.globalAlpha = 0.7;
  for (let i = 0; i < 5; i++) {
    const a = -1.9 + i * 0.28;
    ctx.beginPath();
    ctx.moveTo(s * 1.24, -s * 1.5);
    ctx.quadraticCurveTo(
      s * (1.5 + Math.cos(a) * 0.4),
      -s * (1.9 + Math.sin(a) * 0.3),
      s * (1.7 + Math.cos(a) * 0.7),
      -s * (2.1 + Math.sin(a) * 0.5),
    );
    ctx.stroke();
  }
  ctx.restore();

  // waterline
  ctx.save();
  ctx.globalAlpha = 0.8;
  for (let i = 0; i < 3; i++) {
    const y = s * (0.02 + i * 0.16);
    ctx.beginPath();
    ctx.moveTo(-s * 2.9, y);
    for (let x = -s * 2.9; x < s * 1.6; x += s * 0.24) {
      ctx.quadraticCurveTo(x + s * 0.12, y - s * 0.1, x + s * 0.24, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

/* ----------------------------------------------------------- whirlpool -- */

/** Rotating gyre glyph, used as a sprite texture on the currents layer. */
export function whirlpoolTexture(size: number, clockwise: boolean, color: string): HTMLCanvasElement {
  const c = newCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const m = size / 2;
  ctx.translate(m, m);
  if (!clockwise) ctx.scale(-1, 1);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.022;

  for (let arm = 0; arm < 3; arm++) {
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    const a0 = (arm / 3) * Math.PI * 2;
    for (let t = 0; t <= 1.001; t += 0.02) {
      const a = a0 + t * Math.PI * 1.9;
      const rad = m * (0.1 + t * 0.78);
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // arrow head at the outer end
    const a = a0 + Math.PI * 1.9;
    const rad = m * 0.88;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x + tx * size * 0.07, y + ty * size * 0.07);
    ctx.lineTo(x - tx * size * 0.02 + nx * size * 0.05, y - ty * size * 0.02 + ny * size * 0.05);
    ctx.lineTo(x - tx * size * 0.02 - nx * size * 0.05, y - ty * size * 0.02 - ny * size * 0.05);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.arc(0, 0, m * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  return c;
}

/* -------------------------------------------------------- cherub winds -- */

/**
 * A putto's head, drawn front-on with cheeks full of air. Stays upright on
 * screen, so the face is never inverted; the breath is a separate texture
 * that swings around it (see `breathTexture`).
 *
 * The cheeks are bulges in the silhouette rather than circles drawn inside
 * it — the difference between a face holding its breath and a face with two
 * extra eyes.
 */
export function cherubTexture(size: number, color: string, skin: string): HTMLCanvasElement {
  const c = newCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const m = size / 2;
  const u = size / 100; // drawing unit: the face is ~60u across
  ctx.translate(m, m + 3 * u);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.15 * u;
  const feather = skin;

  // wings, swept up and back behind the head
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(20 * u, -4 * u);
    ctx.bezierCurveTo(34 * u, -12 * u, 44 * u, -28 * u, 45 * u, -38 * u);
    ctx.bezierCurveTo(38 * u, -30 * u, 34 * u, -26 * u, 28 * u, -22 * u);
    ctx.bezierCurveTo(33 * u, -16 * u, 28 * u, -6 * u, 20 * u, -4 * u);
    ctx.closePath();
    ctx.fillStyle = feather;
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 0.75 * u;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      ctx.beginPath();
      ctx.moveTo((22 + t * 10) * u, (-6 - t * 15) * u);
      ctx.quadraticCurveTo((32 + t * 8) * u, (-12 - t * 16) * u, (36 + t * 7) * u, (-14 - t * 19) * u);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  // face: round crown, two cheek bulges at mouth height, small chin
  ctx.lineWidth = 1.35 * u;
  ctx.beginPath();
  ctx.moveTo(0, -30 * u);
  ctx.bezierCurveTo(16 * u, -30 * u, 23 * u, -20 * u, 23 * u, -8 * u);
  ctx.bezierCurveTo(30 * u, -5 * u, 31 * u, 9 * u, 22 * u, 12 * u);
  ctx.bezierCurveTo(19 * u, 20 * u, 9 * u, 25 * u, 0, 25 * u);
  ctx.bezierCurveTo(-9 * u, 25 * u, -19 * u, 20 * u, -22 * u, 12 * u);
  ctx.bezierCurveTo(-31 * u, 9 * u, -30 * u, -5 * u, -23 * u, -8 * u);
  ctx.bezierCurveTo(-23 * u, -20 * u, -16 * u, -30 * u, 0, -30 * u);
  ctx.closePath();
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.stroke();

  // curls around the crown
  ctx.lineWidth = 1.0 * u;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.97 + (i / 8) * Math.PI * 0.94;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 19 * u, Math.sin(a) * 23 * u - 5 * u, 4.6 * u, a + 0.6, a + 5.4);
    ctx.stroke();
  }

  // brows, closed lids, lashes
  ctx.lineWidth = 1.0 * u;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(dir * 4.5 * u, -12 * u);
    ctx.quadraticCurveTo(dir * 10 * u, -16 * u, dir * 15.5 * u, -12.5 * u);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dir * 4 * u, -6 * u);
    ctx.quadraticCurveTo(dir * 10 * u, -1 * u, dir * 15 * u, -5.5 * u);
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 0.7 * u;
    for (let i = 0; i < 3; i++) {
      const x = dir * (6.5 + i * 3.2) * u;
      const y = (-3.6 + Math.abs(i - 1) * 0.9) * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * 0.5 * u, y + 1.8 * u);
      ctx.stroke();
    }
    ctx.restore();
  }

  // nose
  ctx.lineWidth = 0.95 * u;
  ctx.beginPath();
  ctx.moveTo(-0.5 * u, -4 * u);
  ctx.quadraticCurveTo(2.6 * u, 1.5 * u, -1 * u, 3 * u);
  ctx.stroke();

  // a crease inside each cheek, to give the bulge volume
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.85 * u;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(dir * 19 * u, 3 * u, 7 * u, dir > 0 ? 2.5 : -0.6, dir > 0 ? 3.9 : 0.6);
    ctx.stroke();
  }
  ctx.restore();

  // pursed mouth
  ctx.lineWidth = 1.1 * u;
  ctx.beginPath();
  ctx.ellipse(0, 9 * u, 3.6 * u, 4.4 * u, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();

  // chin hatching
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 0.65 * u;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 3.4 * u - 0.6 * u, 18.5 * u);
    ctx.lineTo(i * 3.4 * u + 0.8 * u, 21 * u);
    ctx.stroke();
  }
  ctx.restore();

  return c;
}

/**
 * The cherub's breath: curling gusts that stream to the right of centre.
 * Drawn on its own canvas so the sprite can be rotated to the local wind
 * bearing while the face stays upright. The left half is left empty — that
 * is where the head sits.
 */
export function breathTexture(size: number, color: string): HTMLCanvasElement {
  const c = newCanvas(size, size);
  const ctx = c.getContext('2d')!;
  const m = size / 2;
  ctx.translate(m, m);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const r = rng(7);

  for (let i = 0; i < 7; i++) {
    const spread = (i / 6 - 0.5) * 0.66;
    const len = m * (0.55 + r() * 0.42);
    ctx.globalAlpha = 0.28 + (1 - Math.abs(spread) * 2.4) * 0.4;
    ctx.lineWidth = size * (0.008 + r() * 0.007);
    ctx.beginPath();
    ctx.moveTo(m * 0.05, spread * m * 0.1);
    ctx.bezierCurveTo(
      m * 0.32,
      spread * m * 0.5,
      m * 0.55,
      spread * m * 0.95,
      m * 0.1 + len,
      spread * m * 1.15,
    );
    ctx.stroke();
    // terminal curl
    if (i % 2 === 0) {
      const ex = m * 0.1 + len;
      const ey = spread * m * 1.15;
      ctx.beginPath();
      ctx.arc(ex + m * 0.04, ey + m * 0.045, m * 0.05, Math.PI * 1.1, Math.PI * 2.5);
      ctx.stroke();
    }
  }
  return c;
}
