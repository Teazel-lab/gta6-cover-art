// Poster print effects for NEON COAST Cover Studio panels: posterize, halftone, ink outline, bloom, film grain, vignette.
// Each region effect reads and writes only the ImageData of (x, y, w, h), so it runs per panel (clip, then effect)
// and never smears colour across gutters. Order used by the renderer: grade -> posterize -> halftone -> ink -> bloom -> grain.
// For speed, give the canvas getContext('2d', {willReadFrequently: true}) so getImageData does not stall on the GPU.
// Everything is deterministic: grain comes from a seeded hash of absolute pixel coordinates.

import { clampRegion, hexToRgb } from './colour-grades.js';

/** Effect stacks the editor offers. A null/0 entry means that effect is off. Sizes are px at 1080 short side. */
export const EFFECT_PRESETS = [
  {
    id: 'clean', label: 'Clean',
    posterize: 0, halftone: null, ink: null,
    bloom: { threshold: 0.8, radius: 14, alpha: 0.28 },
    grain: { amount: 0.05, seed: 7 },
  },
  {
    id: 'comic', label: 'Comic',
    posterize: 8,
    halftone: { cell: 6, angleDeg: 30, strength: 0.16, ink: '#2A0838' },
    ink: { threshold: 0.26, width: 2, ink: '#160020' },
    bloom: { threshold: 0.78, radius: 14, alpha: 0.32 },
    grain: { amount: 0.05, seed: 11 },
  },
  {
    id: 'print', label: 'Print',
    posterize: 0,
    halftone: { cell: 7, angleDeg: 45, strength: 0.24, ink: '#2A0A24' },
    ink: null,
    bloom: null,
    grain: { amount: 0.1, seed: 23 },
  },
  {
    id: 'glow', label: 'Glow',
    posterize: 0, halftone: null, ink: null,
    bloom: { threshold: 0.66, radius: 24, alpha: 0.5 },
    grain: { amount: 0.06, seed: 5 },
  },
];

/** Returns the preset with `id`, or 'clean'. */
export function getEffectPreset(id) {
  return EFFECT_PRESETS.find((p) => p.id === id) || EFFECT_PRESETS[0];
}

/**
 * Hue-preserving posterize: luma is quantized to `levels` flat tones and RGB is rescaled to match, so the
 * graded hues stay put (no green/blue bands appearing in a sunset). A short soft edge avoids jaggy contours,
 * and skin tones keep part of their smooth gradation so faces stay attractive.
 */
export function applyPosterize(ctx, x, y, w, h, levels) {
  const n = Math.round(levels);
  const r = clampRegion(ctx, x, y, w, h);
  if (!r || !(n >= 2)) return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const d = img.data;
  // Per-luma scale factor: quantized luma / luma, with a softened step.
  const scale = new Float32Array(256);
  const step = 255 / (n - 1);
  for (let L = 0; L < 256; L++) {
    const band = L / step, k = Math.floor(band), f = band - k;
    const soft = f < 0.42 ? 0 : f > 0.58 ? 1 : (f - 0.42) / 0.16;
    const q = Math.min(255, (k + soft) * step);
    scale[L] = L ? q / L : 0;
  }
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
    if (L === 0) continue;
    // Skin (warm r > g > b, lit) keeps 40% of its smooth tone so faces flatten without going blotchy.
    const keep = r > g && g > b && L > 60 && r - b > 25 ? 0.4 : 0.12;
    const s = scale[L] + (1 - scale[L]) * keep;
    d[i] = r * s; d[i + 1] = g * s; d[i + 2] = b * s;
  }
  ctx.putImageData(img, r.x, r.y);
}

/**
 * Rotated dot screen as a partial multiply (not a replacement), so faces survive.
 * cell = dot pitch px, angleDeg = screen angle, strength 0..1 = ink opacity, ink = dot colour.
 * Dot radius grows with darkness, sampled at each cell centre; only shadows get dots, so lit faces and sky
 * stay clean and the screen reads as subtle print texture.
 */
export function applyHalftone(ctx, x, y, w, h, { cell = 7, angleDeg = 30, strength = 0.25, ink = '#180024' } = {}) {
  const r = clampRegion(ctx, x, y, w, h);
  if (!r || strength <= 0 || cell < 2) return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const d = img.data, W = r.w, H = r.h;
  const luma = lumaOf(d, W * H);
  const [ir, ig, ib] = hexToRgb(ink);
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const half = cell / 2, maxR = half * 1.35;
  for (let py = 0; py < H; py++) {
    // Absolute coordinates keep the screen continuous across panels.
    const ay = py + r.y + 0.5;
    for (let px = 0; px < W; px++) {
      const ax = px + r.x + 0.5;
      const u = ax * ca + ay * sa, v = -ax * sa + ay * ca;
      const cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
      // Cell centre back in region pixels, clamped inside the region.
      let sx = (cu * ca - cv * sa - r.x) | 0, sy = (cu * sa + cv * ca - r.y) | 0;
      sx = sx < 0 ? 0 : sx >= W ? W - 1 : sx;
      sy = sy < 0 ? 0 : sy >= H ? H - 1 : sy;
      const dark = 1 - luma[sy * W + sx] / 255;
      if (dark < 0.4) continue;
      const radius = maxR * Math.sqrt((dark - 0.4) / 0.6);
      const du = u - cu, dv = v - cv;
      const dist = Math.sqrt(du * du + dv * dv);
      const cover = radius - dist + 0.5; // 1px antialiased edge
      if (cover <= 0) continue;
      const k = (cover > 1 ? 1 : cover) * strength;
      const i = (py * W + px) * 4;
      // Multiply by ink, blended by k.
      d[i] += ((d[i] * ir) / 255 - d[i]) * k;
      d[i + 1] += ((d[i + 1] * ig) / 255 - d[i + 1]) * k;
      d[i + 2] += ((d[i + 2] * ib) / 255 - d[i + 2]) * k;
    }
  }
  ctx.putImageData(img, r.x, r.y);
}

/**
 * Comic ink lines where luma changes fast: Sobel on a lightly blurred luma, soft threshold, then thickened to
 * `width` px with a max filter. threshold 0..1 (edge strength), ink = line colour. Stays inside the region.
 */
export function applyInkOutline(ctx, x, y, w, h, { threshold = 0.2, width = 2, ink = '#120018' } = {}) {
  const r = clampRegion(ctx, x, y, w, h);
  if (!r || r.w < 3 || r.h < 3) return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const d = img.data, W = r.w, H = r.h;
  // Blur first so skin texture and JPEG noise do not become lines.
  const L = boxBlur(lumaOf(d, W * H, Float32Array), W, H, Math.max(1, Math.round(width / 2)), 2);
  const edge = new Float32Array(W * H);
  const t = threshold * 255 * 2, span = t * 0.8;
  for (let py = 1; py < H - 1; py++) {
    for (let px = 1; px < W - 1; px++) {
      const o = py * W + px;
      const tl = L[o - W - 1], tc = L[o - W], tr = L[o - W + 1];
      const ml = L[o - 1], mr = L[o + 1];
      const bl = L[o + W - 1], bc = L[o + W], br = L[o + W + 1];
      const gx = tr + 2 * mr + br - tl - 2 * ml - bl;
      const gy = bl + 2 * bc + br - tl - 2 * tc - tr;
      const mag = Math.sqrt(gx * gx + gy * gy);
      const e = (mag - t) / span;
      edge[o] = e <= 0 ? 0 : e >= 1 ? 1 : e;
    }
  }
  const thick = width > 1.5 ? maxFilter(edge, W, H, Math.round((width - 1) / 2)) : edge;
  const [ir, ig, ib] = hexToRgb(ink);
  for (let o = 0, i = 0; o < W * H; o++, i += 4) {
    const k = thick[o] * 0.85;
    if (k <= 0) continue;
    d[i] += (ir - d[i]) * k;
    d[i + 1] += (ig - d[i + 1]) * k;
    d[i + 2] += (ib - d[i + 2]) * k;
  }
  ctx.putImageData(img, r.x, r.y);
}

/**
 * Glow on sky and neon: pixels brighter than `threshold` (0..1 luma) are blurred by `radius` px and screened back
 * at `alpha`. The blur runs at half resolution for speed; skin mids sit below the threshold and stay crisp.
 */
export function applyBloom(ctx, x, y, w, h, { threshold = 0.8, radius = 14, alpha = 0.3 } = {}) {
  const r = clampRegion(ctx, x, y, w, h);
  if (!r || alpha <= 0) return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const d = img.data, W = r.w, H = r.h;
  const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
  const ch = [new Float32Array(hw * hh), new Float32Array(hw * hh), new Float32Array(hw * hh)];
  const t = threshold * 255, range = Math.max(1, 255 - t);
  for (let qy = 0; qy < hh; qy++) {
    for (let qx = 0; qx < hw; qx++) {
      const sx = Math.min(W - 1, qx * 2), sy = Math.min(H - 1, qy * 2);
      const i = (sy * W + sx) * 4;
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (L <= t) continue;
      const k = (L - t) / range, o = qy * hw + qx;
      ch[0][o] = d[i] * k; ch[1][o] = d[i + 1] * k; ch[2][o] = d[i + 2] * k;
    }
  }
  const rad = Math.max(1, Math.round(radius / 2));
  const blurred = ch.map((c) => boxBlur(c, hw, hh, rad, 3));
  for (let py = 0; py < H; py++) {
    // Bilinear upsample from the half-res buffer.
    const fy = Math.min(hh - 1, Math.max(0, (py - 0.5) / 2)), y0 = fy | 0, y1 = Math.min(hh - 1, y0 + 1), ty = fy - y0;
    for (let px = 0; px < W; px++) {
      const fx = Math.min(hw - 1, Math.max(0, (px - 0.5) / 2)), x0 = fx | 0, x1 = Math.min(hw - 1, x0 + 1), tx = fx - x0;
      const a0 = y0 * hw + x0, a1 = y0 * hw + x1, b0 = y1 * hw + x0, b1 = y1 * hw + x1;
      const i = (py * W + px) * 4;
      for (let c = 0; c < 3; c++) {
        const B = blurred[c];
        const g = (B[a0] * (1 - tx) + B[a1] * tx) * (1 - ty) + (B[b0] * (1 - tx) + B[b1] * tx) * ty;
        if (g <= 0) continue;
        const v = d[i + c];
        d[i + c] = 255 - ((255 - v) * (255 - g * alpha)) / 255; // screen
      }
    }
  }
  ctx.putImageData(img, r.x, r.y);
}

/**
 * Monochrome film grain, soft-light style (strongest in mids, gentle on blacks and whites).
 * amount 0..1 (0.08 ≈ subtle print grain), seed = integer. Same seed + same pixel = same grain, every render.
 */
export function applyFilmGrain(ctx, x, y, w, h, { amount = 0.08, seed = 1 } = {}) {
  const r = clampRegion(ctx, x, y, w, h);
  if (!r || amount <= 0) return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const d = img.data;
  const amp = amount * 255 * 1.6;
  const s = seed | 0;
  for (let py = 0, i = 0; py < r.h; py++) {
    const ay = py + r.y;
    for (let px = 0; px < r.w; px++, i += 4) {
      const n = hashNoise(px + r.x, ay, s); // -0.5..0.5
      const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const delta = n * amp * (0.35 + 2.6 * L * (1 - L));
      d[i] += delta; d[i + 1] += delta; d[i + 2] += delta;
    }
  }
  ctx.putImageData(img, r.x, r.y);
}

/** Darkens the corners of the whole w×h canvas toward `colour` (hex) at `strength` 0..1. Vector, no pixel reads. */
export function applyVignette(ctx, w, h, { strength = 0.45, colour = '#180024' } = {}) {
  if (strength <= 0) return;
  const [cr, cg, cb] = hexToRgb(colour);
  const cx = w / 2, cy = h / 2, outer = Math.hypot(cx, cy);
  const grad = ctx.createRadialGradient(cx, cy, outer * 0.45, cx, cy, outer);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
  grad.addColorStop(0.6, `rgba(${cr},${cg},${cb},${(strength * 0.45).toFixed(3)})`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},${Math.min(1, strength).toFixed(3)})`);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Runs a whole preset (object or id) on a region, in the right order. `scale` = region short side / 1080, so
 * cell sizes, line widths and blur radii look the same in the ~600 px preview and the 1920×1080 export.
 */
export function applyEffectPreset(ctx, x, y, w, h, preset, scale = 1) {
  const p = typeof preset === 'string' ? getEffectPreset(preset) : preset;
  if (!p) return;
  if (p.posterize) applyPosterize(ctx, x, y, w, h, p.posterize);
  if (p.halftone) applyHalftone(ctx, x, y, w, h, { ...p.halftone, cell: Math.max(3, p.halftone.cell * scale) });
  if (p.ink) applyInkOutline(ctx, x, y, w, h, { ...p.ink, width: Math.max(1, p.ink.width * scale) });
  if (p.bloom) applyBloom(ctx, x, y, w, h, { ...p.bloom, radius: Math.max(2, p.bloom.radius * scale) });
  if (p.grain) applyFilmGrain(ctx, x, y, w, h, p.grain);
}

// ---------- internals ----------

function lumaOf(d, n, Type = Uint8ClampedArray) {
  const L = new Type(n);
  for (let o = 0, i = 0; o < n; o++, i += 4) L[o] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return L;
}

/** Separable running-sum box blur, `passes` times (3 passes ≈ gaussian). Returns a new Float32Array. */
function boxBlur(src, W, H, radius, passes) {
  let a = Float32Array.from(src), b = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    blurLine(a, b, W, H, radius, 1, W); // horizontal: step 1 along rows
    blurLine(b, a, H, W, radius, W, 1); // vertical: step W along columns
  }
  return a;
}

function blurLine(src, dst, len, lines, radius, step, lineStep) {
  const norm = 1 / (radius * 2 + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[base + clampI(k, len) * step];
    for (let k = 0; k < len; k++) {
      dst[base + k * step] = sum * norm;
      sum += src[base + clampI(k + radius + 1, len) * step] - src[base + clampI(k - radius, len) * step];
    }
  }
}

function clampI(k, len) {
  return k < 0 ? 0 : k >= len ? len - 1 : k;
}

/** Separable max filter of radius `rad` (square structuring element). */
function maxFilter(src, W, H, rad) {
  if (rad < 1) return src;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const row = py * W;
    for (let px = 0; px < W; px++) {
      let m = 0;
      for (let k = Math.max(0, px - rad), e = Math.min(W - 1, px + rad); k <= e; k++) if (src[row + k] > m) m = src[row + k];
      tmp[row + px] = m;
    }
  }
  for (let px = 0; px < W; px++) {
    for (let py = 0; py < H; py++) {
      let m = 0;
      for (let k = Math.max(0, py - rad), e = Math.min(H - 1, py + rad); k <= e; k++) if (tmp[k * W + px] > m) m = tmp[k * W + px];
      out[py * W + px] = m;
    }
  }
  return out;
}

/** Deterministic integer hash of (x, y, seed) -> -0.5..0.5 (a tiny counter-based PRNG). */
function hashNoise(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 - 0.5;
}
