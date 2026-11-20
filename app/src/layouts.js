// Multi-panel poster layouts for NEON COAST Cover Studio.
// Panels are convex polygons in a normalised 0..1 "panel area"; panelsForSize() maps them onto any canvas size,
// keeps a caption band clear, insets every panel by a gutter so none touch, and gives each a slight tilt.

/** The three export sizes, in pixels. */
export const POST_SIZES = [
  { id: 'square', w: 1080, h: 1080, label: 'Square post 1080×1080' },
  { id: 'portrait', w: 1080, h: 1350, label: 'Portrait post 1080×1350' },
  { id: 'landscape', w: 1920, h: 1080, label: 'Landscape cover 1920×1080' },
];

/**
 * Named poster layouts. Each panel: `pts` = convex polygon (clockwise, 0..1 inside the panel area),
 * `tilt` = degrees the card is turned inside its cell, `hero` marks the big lead card. `landscapeBand` = where the
 * caption sits on wide canvases (`landscapeBandWidth` = its share of the width for a right-hand column).
 */
export const PANEL_LAYOUTS = [
  {
    // Tall hero card on the left (~36% of the art area), four stepped cards on the right; every gutter drifts 3–7°.
    id: 'hero-wall', label: 'Hero Wall', landscapeBand: 'right', landscapeBandWidth: 0.43,
    panels: [
      { pts: quad(0, 0, 0.44, 0, 0.38, 1, 0, 1), tilt: -2, hero: true },
      { pts: quad(0.44, 0, 0.72, 0, 0.7, 0.4806, 0.4088, 0.52), tilt: 3 },
      { pts: quad(0.72, 0, 1, 0, 1, 0.44, 0.7, 0.4806), tilt: -3.5 },
      { pts: quad(0.4088, 0.52, 0.67, 0.4846, 0.71, 1, 0.38, 1), tilt: -2.5 },
      { pts: quad(0.67, 0.4846, 1, 0.44, 1, 1, 0.71, 1), tilt: 4 },
    ],
  },
  {
    id: 'six-pack', label: 'Six-Pack Grid', landscapeBand: 'right',
    panels: grid(3, 2, [-3.5, 2.5, -1.5, 3, -2.5, 4]),
  },
  {
    // Hero (~38%) on the left with a slanted edge, three stepped cards on the right.
    id: 'hero-trio', label: 'Hero + Trio', landscapeBand: 'right',
    panels: [
      { pts: quad(0, 0, 0.46, 0, 0.4, 1, 0, 1), tilt: -2, hero: true },
      { pts: quad(0.46, 0, 1, 0, 1, 0.3, 0.4396, 0.34), tilt: 3 },
      { pts: quad(0.4396, 0.34, 1, 0.3, 1, 0.7, 0.4198, 0.67), tilt: -2.5 },
      { pts: quad(0.4198, 0.67, 1, 0.7, 1, 1, 0.4, 1), tilt: 3 },
    ],
  },
  {
    id: 'diagonal-split', label: 'Diagonal Split', landscapeBand: 'bottom',
    panels: [
      { pts: quad(0, 0, 0.4, 0, 0.3, 1, 0, 1), tilt: 0 },
      { pts: quad(0.4, 0, 0.72, 0, 0.62, 1, 0.3, 1), tilt: 0 },
      { pts: quad(0.72, 0, 1, 0, 1, 1, 0.62, 1), tilt: 0 },
    ],
  },
  {
    id: 'crime-wall', label: 'Crime Wall', landscapeBand: 'right',
    panels: [
      { pts: quad(0, 0, 0.55, 0, 0.55, 0.56, 0, 0.6), tilt: -4 },
      { pts: quad(0.55, 0, 1, 0, 1, 0.52, 0.55, 0.56), tilt: 3.5 },
      { pts: quad(0, 0.6, 0.34, 0.585, 0.34, 1, 0, 1), tilt: 3 },
      { pts: quad(0.34, 0.585, 0.67, 0.57, 0.67, 1, 0.34, 1), tilt: -3.5 },
      { pts: quad(0.67, 0.57, 1, 0.52, 1, 1, 0.67, 1), tilt: 2.5 },
    ],
  },
  {
    id: 'widescreen-strip', label: 'Widescreen Strip', landscapeBand: 'bottom',
    panels: [
      { pts: quad(0, 0, 0.27, 0, 0.23, 1, 0, 1), tilt: -1 },
      { pts: quad(0.27, 0, 0.5, 0, 0.5, 1, 0.23, 1), tilt: 1 },
      { pts: quad(0.5, 0, 0.73, 0, 0.77, 1, 0.5, 1), tilt: -1 },
      { pts: quad(0.73, 0, 1, 0, 1, 1, 0.77, 1), tilt: 1 },
    ],
  },
  {
    // Hero (~39%) top-left, a tall pair on the right, two cards under the hero; all gutters drift.
    id: 'mosaic', label: 'Mosaic Hero', landscapeBand: 'right',
    panels: [
      { pts: quad(0, 0, 0.62, 0, 0.6, 0.64, 0, 0.67), tilt: -2, hero: true },
      { pts: quad(0.62, 0, 1, 0, 1, 0.44, 0.6044, 0.5), tilt: 3 },
      { pts: quad(0.6044, 0.5, 1, 0.44, 1, 1, 0.5887, 1), tilt: -2.5 },
      { pts: quad(0, 0.67, 0.3, 0.655, 0.33, 1, 0, 1), tilt: 3.5 },
      { pts: quad(0.3, 0.655, 0.6, 0.64, 0.5887, 1, 0.33, 1), tilt: -3 },
    ],
  },
  {
    id: 'duo-diagonal', label: 'Duo Diagonal', landscapeBand: 'right',
    panels: [
      { pts: quad(0, 0, 0.64, 0, 0.38, 1, 0, 1), tilt: 0 },
      { pts: quad(0.64, 0, 1, 0, 1, 1, 0.38, 1), tilt: 0 },
    ],
  },
  {
    id: 'triple-stack', label: 'Triple Stack', landscapeBand: 'right',
    panels: [
      { pts: quad(0, 0, 1, 0, 1, 0.3, 0, 0.36), tilt: 1.2 },
      { pts: quad(0, 0.36, 1, 0.3, 1, 0.64, 0, 0.7), tilt: -1.2 },
      { pts: quad(0, 0.7, 1, 0.64, 1, 1, 0, 1), tilt: 1 },
    ],
  },
  {
    id: 'solo-hero', label: 'Solo Hero', landscapeBand: 'right',
    panels: [{ pts: quad(0, 0, 1, 0, 1, 1, 0, 1), tilt: -1.5 }],
  },
];

/** Looks a layout up by id (falls back to the first layout). */
export function getLayout(layoutId) {
  return PANEL_LAYOUTS.find((l) => l.id === layoutId) || PANEL_LAYOUTS[0];
}

/**
 * Normalised rect {x, y, w, h, side} where the caption/title block goes for this layout at `aspect` (= width/height).
 * Portrait and square: a band along the bottom. Landscape: right-hand column or bottom band, per layout.
 */
export function captionBandFor(layoutId, aspect) {
  const layout = getLayout(layoutId);
  if (aspect >= 1.25) {
    if (layout.landscapeBand === 'bottom') return { x: 0, y: 0.73, w: 1, h: 0.27, side: 'bottom' };
    const bw = layout.landscapeBandWidth || 0.34;
    return { x: 1 - bw, y: 0, w: bw, h: 1, side: 'right' };
  }
  const h = aspect < 0.9 ? 0.265 : 0.255;
  return { x: 0, y: 1 - h, w: 1, h, side: 'bottom' };
}

/**
 * Pixel panels for a canvas of `width`×`height`: [{index, points:[[x,y]..], bounds:{x,y,w,h}, center:[x,y], tilt}].
 * Every polygon is convex, inside the canvas, clear of the caption band, and separated from its neighbours by a gutter.
 */
export function panelsForSize(layoutId, width, height) {
  const layout = getLayout(layoutId);
  const area = panelAreaFor(layoutId, width, height);
  const gutter = Math.max(6, Math.min(width, height) * 0.022);
  return layout.panels.map((panel, index) => {
    const cell = panel.pts.map(([u, v]) => [area.x + u * area.w, area.y + v * area.h]);
    const inset = insetConvexPolygon(cell, gutter / 2);
    const points = tiltInside(inset, panel.tilt);
    return { index, points, bounds: boundsOf(points), center: centroidOf(points), tilt: panel.tilt };
  });
}

/** Pixel rect {x, y, w, h} of the canvas region panels are laid into (canvas minus margins and caption band). */
export function panelAreaFor(layoutId, width, height) {
  const band = captionBandFor(layoutId, width / height);
  const margin = Math.min(width, height) * 0.035;
  let x = margin, y = margin, w = width - 2 * margin, h = height - 2 * margin;
  if (band.side === 'right') w = band.x * width - margin * 1.5;
  else h = band.y * height - margin * 1.5;
  return { x, y, w, h };
}

/** Pixel rect of the caption band, for the lettering code. */
export function captionRectForSize(layoutId, width, height) {
  const b = captionBandFor(layoutId, width / height);
  return { x: b.x * width, y: b.y * height, w: b.w * width, h: b.h * height, side: b.side };
}

/** True when point [x,y] lies inside (or on) convex polygon `poly`. */
export function pointInConvexPolygon(poly, [x, y], eps = 1e-6) {
  const s = orientation(poly);
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % poly.length];
    if (s * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) < -eps) return false;
  }
  return true;
}

// ---------- geometry helpers ----------

function quad(x0, y0, x1, y1, x2, y2, x3, y3) {
  return [[x0, y0], [x1, y1], [x2, y2], [x3, y3]];
}

function grid(cols, rows, tilts) {
  const panels = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = c / cols, x1 = (c + 1) / cols, y0 = r / rows, y1 = (r + 1) / rows;
      panels.push({ pts: quad(x0, y0, x1, y0, x1, y1, x0, y1), tilt: tilts[panels.length % tilts.length] });
    }
  }
  return panels;
}

/** +1 for clockwise in screen coords (y down), -1 otherwise. */
function orientation(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a >= 0 ? 1 : -1;
}

/** Moves every edge of a convex polygon inward by `d` pixels. */
function insetConvexPolygon(poly, d) {
  const s = orientation(poly);
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * s, ny = (dx / len) * s; // inward normal
    return { p: [p[0] + nx * d, p[1] + ny * d], dir: [dx, dy] };
  });
  return lines.map((cur, i) => intersect(lines[(i - 1 + n) % n], cur));
}

function intersect(a, b) {
  const cross = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  if (Math.abs(cross) < 1e-9) return b.p.slice();
  const t = ((b.p[0] - a.p[0]) * b.dir[1] - (b.p[1] - a.p[1]) * b.dir[0]) / cross;
  return [a.p[0] + a.dir[0] * t, a.p[1] + a.dir[1] * t];
}

/** Rotates `poly` by `deg` about its centroid, then scales it down until it fits inside the original polygon. */
function tiltInside(poly, deg) {
  if (!deg) return poly.map(roundPt);
  const [cx, cy] = centroidOf(poly);
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const at = (scale) => poly.map(([x, y]) => {
    const dx = (x - cx) * scale, dy = (y - cy) * scale;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
  let lo = 0.5, hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid).every((p) => pointInConvexPolygon(poly, p))) lo = mid; else hi = mid;
  }
  return at(lo).map(roundPt);
}

function roundPt([x, y]) {
  return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
}

function centroidOf(poly) {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

function boundsOf(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
