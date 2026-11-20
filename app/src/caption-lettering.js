// Poster caption lettering for NEON COAST Cover Studio.
// The caption is the hero of the art: 1–3 auto-fitted lines in a condensed heavy face, a vertical sunset
// gradient fill, a thick aubergine stroke, a thin accent outline, a hard (unblurred) stepped drop shadow and a
// forward slant. Below it sits a brush-script tagline and a tiny original credits strip.

/** The OFL poster faces bundled in app/fonts/ (licence texts beside them as OFL-*.txt). */
export const POSTER_FONTS = {
  caption: { family: 'NC Bebas Neue', file: 'BebasNeue-Regular.ttf', weight: '400' },
  altCaption: { family: 'NC Anton', file: 'Anton-Regular.ttf', weight: '400' },
  tagline: { family: 'NC Shrikhand', file: 'Shrikhand-Regular.ttf', weight: '400' },
  credits: { family: 'NC Barlow Condensed', file: 'BarlowCondensed-ExtraBold.ttf', weight: '800' },
};

/** Our own small print. Never any publisher or series wording. */
export const CREDITS_TEXT = 'A NEON COAST PRODUCTION  ·  RATED FUN';

let fontsReady = null;

/** Loads every poster face with FontFace from ../fonts/ (relative to this module). Resolves when all are usable. */
export function loadPosterFonts() {
  if (fontsReady) return fontsReady;
  const faces = Object.values(POSTER_FONTS).map((f) => {
    const url = new URL(`../fonts/${f.file}`, import.meta.url).href;
    const face = new FontFace(f.family, `url("${url}")`, { weight: f.weight, style: 'normal' });
    return face.load().then((loaded) => { document.fonts.add(loaded); return loaded; });
  });
  fontsReady = Promise.all(faces).then(() => document.fonts.ready).then(() => true);
  return fontsReady;
}

/**
 * Splits `text` into 1–3 balanced lines and finds the largest font size that fits maxW × maxH.
 * Returns {lines, fontSize, lineHeight, capHeight, widths, font}. Line widths include letter-spacing.
 */
export function fitCaptionLines(ctx, text, maxW, maxH, fontFamily = POSTER_FONTS.caption.family) {
  const words = String(text || '').toUpperCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], fontSize: 0, lineHeight: 0, capHeight: 0, widths: [], font: '' };
  const ref = 100;
  const lineGap = LINE_HEIGHT;
  ctx.save();
  setCaptionFont(ctx, ref, fontFamily);
  const capRatio = capHeightRatio(ctx, ref);
  let best = null;
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    for (const lines of partitions(words, n)) {
      const widths = lines.map((l) => ctx.measureText(l).width + SLANT * capRatio * ref);
      const widest = Math.max(...widths);
      const blockH = ref * (capRatio + (n - 1) * lineGap) + ref * SHADOW_DEPTH;
      const scale = Math.min(maxW / widest, maxH / blockH);
      // Prefer fewer lines unless more lines buy clearly bigger type.
      const score = scale * (1 - 0.04 * (n - 1));
      if (!best || score > best.score) best = { lines, scale, score };
    }
  }
  const fontSize = Math.max(8, Math.floor(ref * best.scale));
  setCaptionFont(ctx, fontSize, fontFamily);
  const widths = best.lines.map((l) => ctx.measureText(l).width);
  ctx.restore();
  return {
    lines: best.lines, fontSize, lineHeight: fontSize * lineGap, capHeight: fontSize * capRatio, widths,
    font: captionFontString(fontSize, fontFamily),
  };
}

/**
 * Draws the full title block inside `rect` ({x, y, w, h, side}) in canvas pixels:
 * big caption, brush tagline under it (never overlapping), and a credits strip at the foot of the block.
 * `grade` supplies titleFill [top, mid, bottom], titleStroke, accent and gutter colours.
 */
export function drawTitleBlock(ctx, rect, { caption, tagline, grade, align = 'center', showCredits = true } = {}) {
  const g = titleColours(grade);
  const short = Math.min(ctx.canvas.width, ctx.canvas.height);
  const pad = Math.max(short * 0.028, Math.min(rect.w, rect.h) * 0.05);
  const inner = { x: rect.x + pad, y: rect.y + pad * 0.7, w: rect.w - pad * 2, h: rect.h - pad * 1.4 };

  const creditSize = Math.max(10, Math.round(short * 0.017));
  const creditsH = showCredits ? creditSize * 2.2 : 0;
  const hasTag = !!(tagline && String(tagline).trim());
  const avail = inner.h - creditsH;
  const capShare = hasTag ? 0.64 : 0.95; // tagline budget: 0.2 × 1.35 line + 0.05 gap

  // Caption: auto-fit, but never so huge a single short word swallows the block.
  const fit = fitCaptionLines(ctx, caption || 'NEON COAST', inner.w, avail * capShare);
  const maxFont = short * 0.36;
  if (fit.fontSize > maxFont) shrinkFit(ctx, fit, maxFont);

  const tagSize = hasTag ? Math.min(fit.fontSize * 0.36, avail * 0.2, short * 0.085) : 0;
  const tagFit = hasTag ? fitTagline(ctx, tagline, inner.w * 0.95, tagSize) : null;
  const tagH = tagFit ? tagFit.size * 1.35 : 0;

  const shadow = fit.fontSize * SHADOW_DEPTH;
  const captionH = fit.capHeight + (fit.lines.length - 1) * fit.lineHeight + shadow;
  const gap = hasTag ? Math.min(fit.fontSize * 0.14, avail * 0.05) : 0;
  const blockH = captionH + gap + tagH;
  // Right column: sit a little below centre (the sun lives above). Bottom band: centre in the band.
  const bias = rect.side === 'right' ? 0.56 : 0.5;
  let top = inner.y + Math.max(0, (avail - blockH) * bias);

  for (let i = 0; i < fit.lines.length; i++) {
    const baseline = top + fit.capHeight + i * fit.lineHeight;
    const w = fit.widths[i] + SLANT * fit.capHeight;
    const x = alignX(inner, w, align);
    drawCaptionLine(ctx, fit.lines[i], x, baseline, fit, g);
  }
  top += captionH + gap;

  if (tagFit) {
    const x = alignX(inner, tagFit.width, align === 'center' ? 'center' : align);
    drawTagline(ctx, tagFit, x, top + tagFit.size * 0.95, g);
  }
  if (showCredits) drawCreditsStrip(ctx, inner, creditSize, align, g);
}

// ---------- caption drawing ----------

const LINE_HEIGHT = 0.86; // baseline-to-baseline in ems (Bebas caps are ~0.7 em tall)
const SLANT = 0.13; // forward skew factor
const SHADOW_DEPTH = 0.075; // hard shadow offset in ems
const LETTER_SPACING = 0.025; // ems

/** One caption line: stepped hard shadow, accent ring, thick dark stroke, gradient fill, thin top sheen. */
function drawCaptionLine(ctx, text, x, baseline, fit, g) {
  const fs = fit.fontSize;
  const stroke = fs * 0.14; // centred stroke → ~7% of the font size shows outside the glyph
  const ring = Math.max(1.5, fs * 0.022);
  ctx.save();
  ctx.translate(x, baseline);
  ctx.transform(1, 0, -SLANT, 1, 0, 0);
  setCaptionFont(ctx, fs);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  // Soft outer glow in the caption's hot mid colour, so the title burns against the sky.
  ctx.save();
  ctx.shadowColor = g.glow;
  ctx.shadowBlur = fs * 0.32;
  ctx.strokeStyle = g.glow;
  ctx.lineWidth = stroke;
  ctx.strokeText(text, 0, 0);
  ctx.restore();

  // Hard, unblurred extruded shadow: repeat the silhouette along the offset so it reads as a solid block.
  const depth = fs * SHADOW_DEPTH;
  const steps = Math.max(2, Math.ceil(depth / 1.5));
  ctx.fillStyle = g.shadow;
  ctx.strokeStyle = g.shadow;
  ctx.lineWidth = stroke + ring * 2;
  for (let s = steps; s >= 1; s--) {
    const d = (depth * s) / steps;
    ctx.strokeText(text, d * 0.8, d);
    ctx.fillText(text, d * 0.8, d);
  }

  // Accent outline just outside the dark stroke.
  ctx.strokeStyle = g.accent;
  ctx.lineWidth = stroke + ring * 2;
  ctx.strokeText(text, 0, 0);

  // Thick near-black aubergine stroke.
  ctx.strokeStyle = g.stroke;
  ctx.lineWidth = stroke;
  ctx.strokeText(text, 0, 0);

  // Vertical three-stop gradient over the cap height.
  const cap = fit.capHeight;
  const grad = ctx.createLinearGradient(0, -cap, 0, 0);
  grad.addColorStop(0, g.fill[0]);
  grad.addColorStop(0.52, g.fill[1]);
  grad.addColorStop(1, g.fill[2]);
  ctx.fillStyle = grad;
  ctx.fillText(text, 0, 0);

  // Thin sheen across the upper caps: clipped highlight band.
  ctx.save();
  ctx.beginPath();
  ctx.rect(-fs, -cap * 1.02, fit.widths.reduce((a, b) => Math.max(a, b), 0) + fs * 2, cap * 0.2);
  ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 0, 0);
  ctx.restore();
  ctx.restore();
}

// ---------- tagline + credits ----------

function fitTagline(ctx, text, maxW, size) {
  ctx.save();
  let s = Math.max(10, size);
  ctx.font = `${s}px "${POSTER_FONTS.tagline.family}", cursive`;
  const w = ctx.measureText(text).width;
  if (w > maxW) { s = Math.max(10, s * (maxW / w)); ctx.font = `${s}px "${POSTER_FONTS.tagline.family}", cursive`; }
  const width = ctx.measureText(text).width;
  ctx.restore();
  return { text: String(text), size: s, width };
}

/** Brush tagline in the accent colour with its own dark stroke and a slight upward tilt. */
function drawTagline(ctx, t, x, baseline, g) {
  ctx.save();
  ctx.translate(x + t.width / 2, baseline);
  ctx.rotate((-3 * Math.PI) / 180);
  ctx.font = `${t.size}px "${POSTER_FONTS.tagline.family}", cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const off = t.size * 0.07;
  ctx.fillStyle = g.shadow;
  ctx.strokeStyle = g.shadow;
  ctx.lineWidth = t.size * 0.2;
  ctx.strokeText(t.text, off, off);
  ctx.fillText(t.text, off, off);
  ctx.strokeStyle = g.stroke;
  ctx.lineWidth = t.size * 0.2;
  ctx.strokeText(t.text, 0, 0);
  ctx.fillStyle = g.tagFill;
  ctx.fillText(t.text, 0, 0);
  ctx.restore();
}

/** Tiny letter-spaced credits line between two hairline rules, at the foot of the block. */
function drawCreditsStrip(ctx, inner, size, align, g) {
  ctx.save();
  ctx.font = `800 ${size}px "${POSTER_FONTS.credits.family}", sans-serif`;
  ctx.letterSpacing = `${(size * 0.18).toFixed(1)}px`;
  ctx.textBaseline = 'middle';
  const text = CREDITS_TEXT;
  const w = Math.min(inner.w, ctx.measureText(text).width);
  const x = alignX(inner, w, align);
  const cy = inner.y + inner.h - size * 0.9;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = g.credits;
  ctx.fillText(text, x, cy, inner.w);
  ctx.globalAlpha = 0.55;
  ctx.fillRect(x, cy - size * 0.95, w, Math.max(1, size * 0.08));
  ctx.fillRect(x, cy + size * 0.85, w, Math.max(1, size * 0.08));
  ctx.restore();
}

// ---------- helpers ----------

function setCaptionFont(ctx, size, family = POSTER_FONTS.caption.family) {
  ctx.font = captionFontString(size, family);
  ctx.letterSpacing = `${(size * LETTER_SPACING).toFixed(2)}px`;
}

function captionFontString(size, family = POSTER_FONTS.caption.family) {
  return `${size}px "${family}", "Arial Narrow", Impact, sans-serif`;
}

function capHeightRatio(ctx, ref) {
  const m = ctx.measureText('H');
  const a = m.actualBoundingBoxAscent;
  return a > 0 ? a / ref : 0.7;
}

/** Rescales a fit result in place down to `fontSize`. */
function shrinkFit(ctx, fit, fontSize) {
  const k = fontSize / fit.fontSize;
  fit.fontSize = Math.floor(fontSize);
  fit.lineHeight *= k;
  fit.capHeight *= k;
  fit.font = captionFontString(fit.fontSize);
  ctx.save();
  setCaptionFont(ctx, fit.fontSize);
  fit.widths = fit.lines.map((l) => ctx.measureText(l).width);
  ctx.restore();
}

/** All ways to split `words` into exactly `n` consecutive non-empty lines. */
function partitions(words, n) {
  if (n === 1) return [[words.join(' ')]];
  const out = [];
  for (let i = 1; i <= words.length - (n - 1); i++) {
    const head = words.slice(0, i).join(' ');
    for (const rest of partitions(words.slice(i), n - 1)) out.push([head, ...rest]);
  }
  return out;
}

function alignX(inner, w, align) {
  if (align === 'left') return inner.x;
  if (align === 'right') return inner.x + inner.w - w;
  return inner.x + (inner.w - w) / 2;
}

/** Title colours from a grade, with safe sunset defaults. */
function titleColours(grade = {}) {
  const fill = Array.isArray(grade.titleFill) && grade.titleFill.length >= 3
    ? grade.titleFill : ['#FFF3B0', '#FF9A3D', '#FF3D7F'];
  return {
    fill,
    stroke: grade.titleStroke || '#180024',
    accent: grade.accent || '#19F0FF',
    shadow: deepShadow(grade),
    glow: hexAlpha(fill[2], 0.7),
    tagFill: grade.accent || '#19F0FF',
    credits: '#FFF1E6',
  };
}

function hexAlpha(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function deepShadow(grade) {
  const s = Array.isArray(grade.shadows) ? grade.shadows[grade.shadows.length - 1] : grade.shadows;
  return typeof s === 'string' && s.startsWith('#') ? mix(s, '#3a0a4a', 0.5) : '#3a0a4a';
}

function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function hex(h) {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
}
