// Cover renderer for NEON COAST Cover Studio: turns a cover document into finished poster pixels.
// Order: sunset sky backdrop → dark gutter slab → each graded/effected photo panel → panel rims →
// caption band shade → title block. Same inputs always give the same pixels.

import { panelsForSize, panelAreaFor, captionRectForSize } from './layouts.js';
import { drawPhotoInPolygon, tracePolygon } from './photo-panels.js';
import { getColourGrade, applyColourGrade } from './colour-grades.js';
import { EFFECT_PRESETS, applyEffectPreset, applyVignette } from './poster-effects.js';
import { drawTitleBlock, loadPosterFonts } from './caption-lettering.js';

/**
 * Draws the cover described by `doc` onto `canvas`, resizing it to exactly doc.width × doc.height.
 * doc = {layoutId, width, height, panels (createPanelState result), gradeId, effectId, caption, tagline, showCredits}.
 * Fonts should already be loaded (await loadPosterFonts()) for the poster faces to appear.
 */
export function renderCover(canvas, doc) {
  const w = Math.round(doc.width), h = Math.round(doc.height);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const grade = getColourGrade(doc.gradeId);
  const effect = EFFECT_PRESETS.find((e) => e.id === doc.effectId) || EFFECT_PRESETS[0];
  const layoutId = doc.layoutId || (doc.panels && doc.panels.layoutId);
  const short = Math.min(w, h);
  const band = captionRectForSize(layoutId, w, h);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawSunsetBackdrop(ctx, w, h, grade, band);
  drawGutterSlab(ctx, panelAreaFor(layoutId, w, h), short, grade);

  const panels = panelsForSize(layoutId, w, h);
  const state = doc.panels || { photos: [], panels: [] };
  panels.forEach((panel, i) => {
    const slot = state.panels[i] || {};
    const photo = (state.photos || []).find((p) => p.id === slot.photoId) || null;
    drawGradedPanel(ctx, panel, photo, slot.crop, grade, effect, short, i);
  });
  panels.forEach((panel) => drawPanelRim(ctx, panel, short));

  applyVignette(ctx, w, h, { strength: 0.28, colour: grade.gutter });
  drawCaptionShade(ctx, band, grade);
  drawTitleBlock(ctx, band, {
    caption: doc.caption, tagline: doc.tagline, grade, align: 'center', showCredits: doc.showCredits !== false,
  });
  ctx.restore();
  return canvas;
}

/** Renders `doc` on a fresh canvas and encodes an opaque PNG of exactly doc.width × doc.height. */
export async function renderCoverToBlob(doc) {
  await loadPosterFonts();
  const canvas = document.createElement('canvas');
  renderCover(canvas, doc);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.type !== 'image/png') throw new Error('PNG export failed');
  return blob;
}

// ---------- backdrop ----------

/** Our own sunset motif: grade sky gradient, big soft sun disc cut by horizon stripes, glow, and a dark sea. */
export function drawSunsetBackdrop(ctx, w, h, grade, band) {
  const [skyTop, skyBottom] = grade.sky || ['#2a0b4a', '#ff7a45'];
  const short = Math.min(w, h);
  // Sun sits above the caption in a right column, or rises behind the caption in a bottom band.
  const right = band && band.side === 'right';
  const cx = right ? band.x + band.w / 2 : w / 2;
  // Right column: the disc sits high and the title is set across its striped lower half.
  const cy = right ? h * 0.36 : (band ? band.y + band.h * 0.55 : h * 0.6);
  const r = right ? Math.min(band.w * 0.42, short * 0.34) : short * 0.36;
  const horizon = cy + r * 0.35;

  // Sky ends at the horizon: deep top -> hot magenta band -> glowing horizon colour (no muddy midpoint).
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(0.55, mixHex(mixHex(skyTop, skyBottom, 0.5), pick(grade.mids, '#E0306A'), 0.55));
  sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.4);
  glow.addColorStop(0, withAlpha(grade.highlights, 0.55));
  glow.addColorStop(1, withAlpha(grade.highlights, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const disc = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  disc.addColorStop(0, '#FFEB8A');
  disc.addColorStop(0.45, pick(grade.highlights, '#FF9A4D'));
  disc.addColorStop(1, pick(grade.mids, '#E0306A'));
  ctx.fillStyle = disc;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // Horizon stripes: gaps grow thicker toward the bottom of the disc.
  ctx.fillStyle = withAlpha(skyTop, 0.9);
  for (let k = 0; k < 8; k++) {
    const y = cy - r * 0.35 + k * r * 0.12;
    ctx.fillRect(cx - r, y, r * 2, r * (0.012 + k * 0.012));
  }
  ctx.restore();

  // Dark sea under the horizon with faint reflection lines.
  const sea = ctx.createLinearGradient(0, horizon, 0, h);
  sea.addColorStop(0, withAlpha(grade.mids, 0.45));
  sea.addColorStop(0.35, withAlpha(grade.gutter, 0.6));
  sea.addColorStop(1, withAlpha(grade.gutter, 0.95));
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.fillStyle = withAlpha(grade.highlights, 0.35);
  for (let k = 0; k < 6; k++) {
    const y = horizon + (k + 1) * short * 0.022;
    const half = r * (0.9 - k * 0.12);
    ctx.fillRect(cx - half, y, half * 2, Math.max(1, short * 0.003));
  }
}

/** Dark aubergine slab behind the panel area so gutters read as one ink colour; the sky shows in the border. */
function drawGutterSlab(ctx, area, short, grade) {
  const bleed = short * 0.012;
  ctx.fillStyle = grade.gutter || '#180024';
  ctx.fillRect(area.x - bleed, area.y - bleed, area.w + bleed * 2, area.h + bleed * 2);
}

// ---------- panels ----------

/** Photo → grade → effects on an offscreen canvas the size of the panel's bounds, then clipped into place. */
function drawGradedPanel(ctx, panel, photo, crop, grade, effect, short, index) {
  const bx = Math.floor(panel.bounds.x) - 1, by = Math.floor(panel.bounds.y) - 1;
  const bw = Math.ceil(panel.bounds.w) + 3, bh = Math.ceil(panel.bounds.h) + 3;
  const off = makeCanvas(bw, bh);
  const octx = off.getContext('2d', { willReadFrequently: true });
  octx.fillStyle = grade.gutter || '#180024';
  octx.fillRect(0, 0, bw, bh);
  octx.translate(-bx, -by);
  drawPhotoInPolygon(octx, photo, { points: panel.points, tilt: panel.tilt }, crop);
  octx.setTransform(1, 0, 0, 1, 0, 0);
  if (photo) {
    applyColourGrade(octx, 0, 0, bw, bh, grade, 1);
    // Vary the grain seed per panel so neighbours don't share one noise pattern (still deterministic).
    const preset = effect.grain ? { ...effect, grain: { ...effect.grain, seed: (effect.grain.seed || 7) + index * 101 } } : effect;
    applyEffectPreset(octx, 0, 0, bw, bh, preset, short / 1080);
  }
  ctx.save();
  tracePolygon(ctx, panel.points);
  ctx.clip();
  ctx.drawImage(off, bx, by);
  ctx.restore();
}

/** Thin light rim just inside each panel edge, like a printed photo border. */
function drawPanelRim(ctx, panel, short) {
  const lw = Math.max(1.5, short * 0.0028);
  ctx.save();
  tracePolygon(ctx, panel.points);
  ctx.clip();
  ctx.lineJoin = 'miter';
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = 'rgba(255, 238, 226, 0.7)';
  tracePolygon(ctx, panel.points);
  ctx.stroke();
  ctx.restore();
}

// ---------- caption band ----------

/** Dark-to-transparent shade under the lettering so it pops off the sky/sea. */
function drawCaptionShade(ctx, band, grade) {
  const dark = grade.gutter || '#180024';
  const g = band.side === 'right'
    ? ctx.createLinearGradient(0, band.y + band.h * 0.25, 0, band.y + band.h)
    : ctx.createLinearGradient(0, band.y, 0, band.y + band.h);
  g.addColorStop(0, withAlpha(dark, 0));
  g.addColorStop(band.side === 'right' ? 0.45 : 0.4, withAlpha(dark, 0.45));
  g.addColorStop(1, withAlpha(dark, 0.85));
  ctx.fillStyle = g;
  ctx.fillRect(band.x, band.side === 'right' ? band.y + band.h * 0.25 : band.y, band.w,
    band.side === 'right' ? band.h * 0.75 : band.h);
}

// ---------- helpers ----------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function pick(v, fallback) {
  const s = Array.isArray(v) ? v[v.length - 1] : v;
  return typeof s === 'string' && s.startsWith('#') ? s : fallback;
}

/** Mixes two '#RRGGBB' colours, t = 0..1 toward `b`; returns '#RRGGBB'. */
function mixHex(a, b, t) {
  const pa = hexParts(a), pb = hexParts(b);
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function hexParts(colour) {
  const c = pick(colour, '#180024').replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
}

function withAlpha(colour, a) {
  const c = pick(colour, '#180024').replace('#', '');
  const f = c.length === 3 ? c.split('').map((x) => x + x).join('') : c.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
