// Per-panel photo assignment and crop model for NEON COAST Cover Studio.
// A panel state says which photo fills each poster panel and how it is framed (zoom, pan, mirror).
// Crop offsets are resolution-independent: -1..1 across the photo's overflow, so a crop looks the same at every size.

import { getLayout, panelsForSize } from './layouts.js';

/** Default crop: cover-fit, centred, not mirrored. */
export const DEFAULT_CROP = Object.freeze({ zoom: 1, offsetX: 0, offsetY: 0, flipX: false });

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

/**
 * Builds the panel state for `layout` (object or id) from `photos` ({id, name, image, w, h}).
 * Photos are dealt round-robin: one photo fills every panel, or several photos share them out.
 * When a photo repeats, each repeat gets a different zoom/framing so the panels read as different shots.
 */
export function createPanelState(layout, photos = []) {
  const lay = typeof layout === 'string' ? getLayout(layout) : layout;
  const rects = panelsForSize(lay.id, 1080, 1080).map((p) => p.bounds);
  const panels = lay.panels.map((_, i) => {
    const photo = photos.length ? photos[i % photos.length] : null;
    const repeat = photos.length ? Math.floor(i / photos.length) : 0;
    return { photoId: photo ? photo.id : null, crop: photo ? variedCrop(photo, rects[i], repeat) : { ...DEFAULT_CROP } };
  });
  return { layoutId: lay.id, photos: photos.slice(), panels };
}

/** Puts photo `photoId` into panel `panelIndex` with a fresh auto-focused crop. */
export function assignPhotoToPanel(state, panelIndex, photoId) {
  const photo = findPhoto(state, photoId);
  const rect = panelRectOf(state, panelIndex);
  return updatePanel(state, panelIndex, () => ({
    photoId: photo ? photo.id : null,
    crop: photo ? autoFocusCrop(photo, rect) : { ...DEFAULT_CROP },
  }));
}

/** Merges crop fields {zoom, offsetX, offsetY, flipX} into panel `panelIndex`, clamped to valid ranges. */
export function setPanelCrop(state, panelIndex, crop) {
  return updatePanel(state, panelIndex, (p) => ({ ...p, crop: clampCrop({ ...p.crop, ...crop }) }));
}

/** Pans panel `i` by (dx, dy) in offset units (-1..1 spans the full overflow). */
export function panPanelBy(state, i, dx, dy) {
  return updatePanel(state, i, (p) => ({
    ...p, crop: clampCrop({ ...p.crop, offsetX: p.crop.offsetX + dx, offsetY: p.crop.offsetY + dy }),
  }));
}

/** Multiplies panel `i`'s zoom by `factor` (e.g. 1.1 to zoom in, 1/1.1 to zoom out). */
export function zoomPanelBy(state, i, factor) {
  return updatePanel(state, i, (p) => ({ ...p, crop: clampCrop({ ...p.crop, zoom: p.crop.zoom * factor }) }));
}

/** Resets panel `i` to the auto-focused crop for its photo. */
export function resetPanelCrop(state, i) {
  const photo = findPhoto(state, state.panels[i] && state.panels[i].photoId);
  const crop = photo ? autoFocusCrop(photo, panelRectOf(state, i)) : { ...DEFAULT_CROP };
  return updatePanel(state, i, (p) => ({ ...p, crop }));
}

/**
 * Heuristic framing for `photo` in a panel of `panelRect` ({w, h}): when the photo overflows vertically,
 * slide toward the upper-centre third where faces usually are; horizontal overflow stays centred.
 */
export function autoFocusCrop(photo, panelRect) {
  const photoAspect = photo.w / photo.h;
  const panelAspect = panelRect.w / panelRect.h;
  const tallOverflow = photoAspect < panelAspect; // photo is relatively taller than the panel
  return { zoom: 1, offsetX: 0, offsetY: tallOverflow ? -0.45 : 0, flipX: false };
}

/**
 * Clips `ctx` to `polygon` (array of [x,y], or a panel {points, tilt}) and draws `photo` cover-fitted × zoom,
 * shifted by the crop offset and turned with the panel's tilt. Draws a dark placeholder when there is no image.
 */
export function drawPhotoInPolygon(ctx, photo, polygon, crop = DEFAULT_CROP) {
  const points = Array.isArray(polygon) ? polygon : polygon.points;
  const tilt = Array.isArray(polygon) ? 0 : polygon.tilt || 0;
  const c = clampCrop({ ...DEFAULT_CROP, ...crop });
  const [cx, cy] = centre(points);
  const a = (tilt * Math.PI) / 180;
  // Size of the polygon measured in the panel's own (un-tilted) frame.
  const local = points.map(([x, y]) => rotate(x - cx, y - cy, -a));
  const xs = local.map((p) => p[0]), ys = local.map((p) => p[1]);
  const pw = Math.max(...xs) - Math.min(...xs), ph = Math.max(...ys) - Math.min(...ys);
  const lx = (Math.max(...xs) + Math.min(...xs)) / 2, ly = (Math.max(...ys) + Math.min(...ys)) / 2;

  ctx.save();
  tracePolygon(ctx, points);
  ctx.clip();
  if (!photo || !photo.image) {
    ctx.fillStyle = '#1d1030';
    ctx.fill();
    ctx.restore();
    return;
  }
  // Mirroring flips the drawing, so mirror the pan too: the visible framing stays where the user put it.
  const { dw, dh, dx, dy } = photoPlacement(photo, pw, ph, c.flipX ? { ...c, offsetX: -c.offsetX } : c);
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.translate(lx, ly);
  if (c.flipX) ctx.scale(-1, 1);
  ctx.drawImage(photo.image, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Where the photo lands relative to the panel centre for a panel of pw×ph: {dw, dh, dx, dy}.
 * Exposed so the editor can convert mouse drags into offsets (see pixelDragToOffset).
 */
export function photoPlacement(photo, pw, ph, crop) {
  const scale = Math.max(pw / photo.w, ph / photo.h) * crop.zoom;
  const dw = photo.w * scale, dh = photo.h * scale;
  const ox = (dw - pw) / 2, oy = (dh - ph) / 2;
  return { dw, dh, dx: -dw / 2 - crop.offsetX * ox, dy: -dh / 2 - crop.offsetY * oy };
}

/** Converts a pointer drag of (dxPx, dyPx) over a panel of panelRect into offset deltas for panPanelBy. */
export function pixelDragToOffset(photo, panelRect, crop, dxPx, dyPx) {
  const { dw, dh } = photoPlacement(photo, panelRect.w, panelRect.h, clampCrop({ ...DEFAULT_CROP, ...crop }));
  const ox = (dw - panelRect.w) / 2, oy = (dh - panelRect.h) / 2;
  return { dx: ox > 0.5 ? -dxPx / ox : 0, dy: oy > 0.5 ? -dyPx / oy : 0 };
}

/** Traces a closed polygon path on `ctx` (no fill/stroke). */
export function tracePolygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// ---------- internals ----------

function clampCrop(c) {
  return {
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(c.zoom) || 1)),
    offsetX: Math.min(1, Math.max(-1, Number(c.offsetX) || 0)),
    offsetY: Math.min(1, Math.max(-1, Number(c.offsetY) || 0)),
    flipX: !!c.flipX,
  };
}

/** Repeat 0 = auto-focus; later repeats zoom in and shift so one photo yields several distinct shots. */
function variedCrop(photo, rect, repeat) {
  const base = autoFocusCrop(photo, rect);
  if (!repeat) return base;
  const looks = [
    { zoom: 1.6, offsetX: -0.5, offsetY: -0.6 },
    { zoom: 2.1, offsetX: 0.45, offsetY: -0.3 },
    { zoom: 1.35, offsetX: 0.6, offsetY: 0.4, flipX: true },
    { zoom: 2.6, offsetX: 0, offsetY: -0.7 },
    { zoom: 1.8, offsetX: -0.6, offsetY: 0.3, flipX: true },
  ];
  return clampCrop({ ...base, ...looks[(repeat - 1) % looks.length] });
}

function updatePanel(state, i, fn) {
  if (i < 0 || i >= state.panels.length) return state;
  const panels = state.panels.slice();
  panels[i] = fn(panels[i]);
  return { ...state, panels };
}

function findPhoto(state, id) {
  return state.photos.find((p) => p.id === id) || null;
}

function panelRectOf(state, i) {
  const panel = panelsForSize(state.layoutId, 1080, 1080)[i];
  return panel ? panel.bounds : { w: 1, h: 1 };
}

function centre(points) {
  let x = 0, y = 0;
  for (const p of points) { x += p[0]; y += p[1]; }
  return [x / points.length, y / points.length];
}

function rotate(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
