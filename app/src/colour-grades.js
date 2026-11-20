// Colour grades for NEON COAST Cover Studio: one hour of light shared by every poster panel.
// A grade is a gradient map (luma -> shadows/mids/highlights ramp) blended over the photo, plus a contrast lift,
// skin protection (faces keep some natural colour) and an accent split (cool water/sky or hot neon picks the accent).
// It also carries the poster chrome colours: sky gradient, gutter ink, caption fill and stroke.

/**
 * The grades. Colours are hex strings.
 * - shadows/mids/highlights: the three gradient-map stops (luma ~0.2, ~0.5, ~0.85).
 * - accent + accentFrom: 'cool' tints blue/cyan pixels toward accent, 'warm' keeps hot red/pink pixels as accent.
 * - mix: how far the (brightness-matched) gradient-map hue replaces the photo's hue at strength 1;
 *   contrast: S-curve amount at strength 1; vibrance: saturation push on dull pixels; skinGlow: warm lift on skin;
 *   optional gamma (>1 = darker night mids) and lift (raised, bleached blacks).
 */
export const COLOUR_GRADES = [
  {
    id: 'vice-sunset', label: 'Vice Sunset',
    shadows: '#123A5E', mids: '#F2307E', highlights: '#FF8E3C', accent: '#14D2E0', accentFrom: 'cool',
    mix: 0.6, contrast: 0.3, vibrance: 0.55, skinGlow: 0.6,
    sky: ['#3A0C5C', '#FF6A3D'], gutter: '#1A0526',
    titleFill: ['#FFF0A8', '#FF8A2E', '#F0287A'], titleStroke: '#1A0526',
  },
  {
    id: 'neon-night', label: 'Neon Night',
    shadows: '#0A2E4E', mids: '#E0249E', highlights: '#FFB8D8', accent: '#19E6F5', accentFrom: 'cool',
    mix: 0.58, contrast: 0.3, vibrance: 0.42, skinGlow: 0.55, lift: 0.03,
    sky: ['#0A0B2E', '#7A1490'], gutter: '#100022',
    titleFill: ['#E9FDFF', '#19F0FF', '#FF2BD6'], titleStroke: '#0A0016',
  },
  {
    id: 'golden-hour', label: 'Golden Hour',
    shadows: '#3A2414', mids: '#D2703A', highlights: '#FFD9A0', accent: '#2EBFB0', accentFrom: 'cool',
    mix: 0.56, contrast: 0.26, vibrance: 0.28, skinGlow: 0.5,
    sky: ['#F08A3C', '#FFE0A6'], gutter: '#2A1408',
    titleFill: ['#FFF6DC', '#FFC861', '#E0662A'], titleStroke: '#2A1006',
  },
  {
    id: 'ocean-dusk', label: 'Ocean Dusk',
    shadows: '#071C2C', mids: '#2F7A86', highlights: '#FFB79A', accent: '#FF6F5E', accentFrom: 'warm',
    mix: 0.5, contrast: 0.3, vibrance: 0.35, skinGlow: 0.4,
    sky: ['#0D3550', '#FF8C78'], gutter: '#06141F',
    titleFill: ['#FFE6D6', '#FF8A73', '#1FA3AE'], titleStroke: '#051019',
  },
  {
    id: 'heat-haze', label: 'Heat Haze',
    shadows: '#4A1A0A', mids: '#F07A1E', highlights: '#FFF4C2', accent: '#13B9C9', accentFrom: 'cool',
    mix: 0.5, contrast: 0.18, lift: 0.08, vibrance: 0.3, skinGlow: 0.4,
    sky: ['#FFB23D', '#FFF1B8'], gutter: '#3A1204',
    titleFill: ['#FFFBE0', '#FFD23A', '#FF6A1A'], titleStroke: '#3A0F02',
  },
  {
    id: 'midnight-mono', label: 'Midnight Mono',
    shadows: '#12041C', mids: '#5A2A6E', highlights: '#EBD9F2', accent: '#FF2E88', accentFrom: 'warm',
    mix: 0.84, contrast: 0.42, vibrance: 0, skinGlow: 0,
    sky: ['#0E0218', '#3A1050'], gutter: '#0B0013',
    titleFill: ['#FFFFFF', '#FF8AC0', '#FF2E88'], titleStroke: '#0B0013',
  },
];

/** Returns the grade with `id`, or the first grade (vice-sunset) for an unknown id. */
export function getColourGrade(id) {
  return COLOUR_GRADES.find((g) => g.id === id) || COLOUR_GRADES[0];
}

/**
 * Builds the 256-step gradient map for `grade`: Uint8ClampedArray(256*3), RGB per luma step.
 * Five stops: a crushed deep shadow, shadows, mids, highlights and a bleached top, smoothly interpolated.
 */
export function buildGradeLUT(grade) {
  const cached = lutCache.get(grade);
  if (cached) return cached;
  const sh = hexToRgb(grade.shadows), md = hexToRgb(grade.mids), hi = hexToRgb(grade.highlights);
  const stops = [
    [0, scaleRgb(sh, 0.45)],
    [0.2, sh],
    [0.5, md],
    [0.85, hi],
    [1, mixRgb(hi, [255, 255, 255], 0.6)],
  ];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const u = smooth((t - t0) / (t1 - t0));
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * u;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * u;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * u;
  }
  lutCache.set(grade, lut);
  return lut;
}

/**
 * Grades the pixel region (x, y, w, h) of `ctx` in place. strength 0..1 (0 = untouched).
 * Per pixel: contrast lift, luma -> gradient map, blend with the original (less on skin), then the accent split.
 * Tip: create the context with getContext('2d', {willReadFrequently: true}) so getImageData stays on the CPU.
 */
export function applyColourGrade(ctx, x, y, w, h, grade, strength = 1) {
  const g = typeof grade === 'string' ? getColourGrade(grade) : grade;
  const s = Math.max(0, Math.min(1, strength));
  const r0 = clampRegion(ctx, x, y, w, h);
  if (!r0 || s === 0) return;
  const img = ctx.getImageData(r0.x, r0.y, r0.w, r0.h);
  const d = img.data;
  const chroma = chromaLUT(g);
  const curve = contrastCurve((g.contrast ?? 0.3) * s, (g.lift ?? 0) * s, 1 + ((g.gamma ?? 1) - 1) * s);
  const mixBase = (g.mix ?? 0.6) * s;
  const vib = (g.vibrance ?? 0.3) * s;
  const glow = (g.skinGlow ?? 0.4) * s;
  const acc = hexToRgb(g.accent);
  const warmAccent = g.accentFrom === 'warm';
  const accentAmt = (warmAccent ? 0.75 : 0.5) * s;

  for (let i = 0; i < d.length; i += 4) {
    const r = curve[d[i]], gg = curve[d[i + 1]], b = curve[d[i + 2]];
    const L = (0.2126 * r + 0.7152 * gg + 0.0722 * b) | 0;
    const mx = r > gg ? (r > b ? r : b) : (gg > b ? gg : b);
    const mn = r < gg ? (r < b ? r : b) : (gg < b ? gg : b);
    const sat = mx ? (mx - mn) / mx : 0;

    // Skin: warm ordering r > g > b, moderate saturation, not too dark. It keeps more of its own colour.
    const skin = r > gg && gg > b && sat > 0.1 && sat < 0.7 && L > 45;
    const m = skin ? mixBase * 0.45 : mixBase;

    // Gradient-map hue at the pixel's own brightness (no greying or darkening from the tint).
    const li = L * 3;
    let or = r + (L * chroma[li] - r) * m;
    let og = gg + (L * chroma[li + 1] - gg) * m;
    let ob = b + (L * chroma[li + 2] - b) * m;

    // Accent split: originally-cool pixels (or hot red/pink ones) lean toward the accent at their own brightness.
    let aw = 0;
    if (warmAccent) {
      if (r > gg + 50 && r > b + 20) aw = Math.min(1, (r - gg - 50) / 90) * sat;
    } else if (b > r + 18) {
      aw = Math.min(1, (b - r - 18) / 90);
    }
    if (aw > 0) {
      const k = aw * accentAmt, lum = 0.3 + (L / 255) * 0.85;
      or += (acc[0] * lum - or) * k;
      og += (acc[1] * lum - og) * k;
      ob += (acc[2] * lum - ob) * k;
    }

    // Vibrance: push colour away from grey, most on dull pixels, gently on skin.
    const Lo = 0.2126 * or + 0.7152 * og + 0.0722 * ob;
    const v = vib * (1 - sat * 0.7) * (skin ? 0.5 : 1);
    or = Lo + (or - Lo) * (1 + v);
    og = Lo + (og - Lo) * (1 + v);
    ob = Lo + (ob - Lo) * (1 + v);

    // Skin glow: a warm sunlit lift so faces read golden, never grey.
    if (skin) {
      const k = glow * Math.min(1, (L - 45) / 60);
      or += 22 * k; og += 7 * k; ob -= 6 * k;
    }
    d[i] = or; d[i + 1] = og; d[i + 2] = ob;
  }
  ctx.putImageData(img, r0.x, r0.y);
}

// ---------- internals ----------

const lutCache = new WeakMap();
const chromaCache = new WeakMap();

/** Float32Array(256*3): the gradient map divided by its own luma, so `L * chroma` = map hue at brightness L. */
function chromaLUT(grade) {
  const cached = chromaCache.get(grade);
  if (cached) return cached;
  const lut = buildGradeLUT(grade);
  const out = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const r = lut[i * 3], g = lut[i * 3 + 1], b = lut[i * 3 + 2];
    const l = Math.max(8, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    out[i * 3] = r / l; out[i * 3 + 1] = g / l; out[i * 3 + 2] = b / l;
  }
  chromaCache.set(grade, out);
  return out;
}

/** Contrast LUT: `gamma` > 1 darkens mids (night), `amount` 0..1 pulls toward an S-curve, `lift` raises blacks (bleach). */
function contrastCurve(amount, lift, gamma = 1) {
  const c = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const t = Math.pow(i / 255, gamma);
    const v = t + (smooth(t) - t) * amount * 1.6;
    c[i] = (lift + v * (1 - lift)) * 255 + 0.5;
  }
  return c;
}

function smooth(t) {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}

/** Clamps a region to the canvas and rounds it to whole pixels; null when empty. Shared with poster-effects.js. */
export function clampRegion(ctx, x, y, w, h) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(cw, Math.ceil(x + w)), y1 = Math.min(ch, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** '#RRGGBB' (or '#RGB') -> [r, g, b]. Shared with poster-effects.js. */
export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function scaleRgb(c, k) {
  return c.map((v) => v * k);
}

function mixRgb(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}
