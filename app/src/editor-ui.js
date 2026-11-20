// Editor DOM for NEON COAST Cover Studio: layout / grade / effect pickers, photo tray, panel inspector,
// and pointer interactions on the live preview (select, drag-to-pan, wheel-to-zoom, drop a photo on a panel).

import { panelsForSize, pointInConvexPolygon } from './layouts.js';
import { tracePolygon } from './photo-panels.js';
import { makePhotoThumb } from './photo-library.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Grid of layout buttons (data-layout-id), each with a tiny SVG diagram of its tilted panels. */
export function buildLayoutPicker(container, layouts, onPick) {
  container.textContent = '';
  for (const layout of layouts) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'layout-button';
    btn.dataset.layoutId = layout.id;
    btn.title = layout.label;
    btn.setAttribute('aria-label', `${layout.label} layout`);
    btn.append(layoutDiagramSVG(layout.id), document.createTextNode(layout.label));
    btn.addEventListener('click', () => onPick(layout.id));
    container.append(btn);
  }
}

/** Colour-grade swatches (data-grade-id) whose background is the grade's own sky + gradient-map colours. */
export function buildGradePicker(container, grades, onPick) {
  container.textContent = '';
  for (const grade of grades) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'grade-swatch';
    btn.dataset.gradeId = grade.id;
    btn.title = grade.label;
    btn.style.background = `linear-gradient(135deg, ${grade.shadows} 0%, ${grade.mids} 45%, ${grade.highlights} 80%, ${grade.accent} 100%)`;
    btn.textContent = grade.label;
    btn.addEventListener('click', () => onPick(grade.id));
    container.append(btn);
  }
}

/** Effect preset buttons (data-effect-id). */
export function buildEffectPicker(container, presets, onPick) {
  container.textContent = '';
  for (const preset of presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'effect-button';
    btn.dataset.effectId = preset.id;
    btn.textContent = preset.label;
    btn.addEventListener('click', () => onPick(preset.id));
    container.append(btn);
  }
}

/** Marks the button whose data-<key> equals `value` as .is-active inside `container`. */
export function markActive(container, key, value) {
  for (const el of container.querySelectorAll(`[data-${key}]`)) {
    const on = el.dataset[toCamel(key)] === String(value);
    el.classList.toggle('is-active', on);
    if (el.getAttribute('role') === 'tab') el.setAttribute('aria-selected', String(on));
    else el.setAttribute('aria-pressed', String(on));
  }
}

/** Rebuilds the photo tray: one draggable thumbnail button (data-photo-id) per photo. */
export function renderPhotoTray(tray, photos, onPick, activePhotoId = null) {
  tray.textContent = '';
  for (const photo of photos) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'photo-thumb';
    btn.dataset.photoId = photo.id;
    btn.draggable = true;
    btn.title = `${photo.name} — click to put in the selected panel, or drag onto any panel`;
    const thumb = makePhotoThumb(photo);
    thumb.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none';
    btn.append(thumb);
    btn.classList.toggle('is-active', photo.id === activePhotoId);
    btn.addEventListener('click', () => onPick(photo.id));
    btn.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neon-photo', photo.id);
      e.dataTransfer.setData('text/plain', photo.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    tray.append(btn);
  }
}

/**
 * Syncs the panel inspector to `state` = {doc, selectedPanel}: label, photo select, zoom/x/y sliders, flip state.
 * `panelIndex` defaults to state.selectedPanel.
 */
export function updatePanelInspector(state, panelIndex = state.selectedPanel) {
  const { doc } = state;
  const slots = doc.panels.panels;
  const i = Math.max(0, Math.min(slots.length - 1, panelIndex | 0));
  const slot = slots[i] || { photoId: null, crop: { zoom: 1, offsetX: 0, offsetY: 0, flipX: false } };
  byId('panel-label').textContent = `Panel ${i + 1} of ${slots.length}`;

  const select = byId('panel-photo-select');
  const photos = doc.panels.photos;
  const wanted = ['', ...photos.map((p) => p.id)].join('|');
  if (select.dataset.options !== wanted) {
    select.textContent = '';
    select.append(new Option('— none —', ''));
    photos.forEach((p, k) => select.append(new Option(`${k + 1}. ${p.name}`, p.id)));
    select.dataset.options = wanted;
  }
  select.value = slot.photoId || '';

  setRange('panel-zoom', slot.crop.zoom);
  setRange('panel-x', slot.crop.offsetX);
  setRange('panel-y', slot.crop.offsetY);
  const flip = byId('panel-flip');
  flip.classList.toggle('is-active', !!slot.crop.flipX);
  flip.setAttribute('aria-pressed', String(!!slot.crop.flipX));
  const empty = !slot.photoId;
  for (const id of ['panel-zoom', 'panel-x', 'panel-y', 'panel-flip', 'panel-reset', 'panel-fill-all']) byId(id).disabled = empty;
  byId('panel-auto').disabled = photos.length === 0;
}

/**
 * Pointer interactions on the preview canvas. getDoc() returns {doc, width, height} in canvas backing pixels.
 * Click selects a panel, drag pans its photo (onPan(i, dxPx, dyPx, panel) in backing px), wheel zooms
 * (onZoom(i, factor)), and a photo thumb dropped on a panel calls onDropPhoto(i, photoId).
 */
export function wirePreviewInteractions(canvas, getDoc, { onSelectPanel, onPan, onZoom, onDropPhoto }) {
  let drag = null;

  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
  };
  const hit = (e) => {
    const { doc, width, height } = getDoc();
    const pt = toCanvas(e);
    const panels = panelsForSize(doc.layoutId, width, height);
    const panel = panels.find((p) => pointInConvexPolygon(p.points, pt));
    return panel ? { index: panel.index, panel, pt } : { index: -1, panel: null, pt };
  };
  const pxPerCss = () => canvas.width / (canvas.getBoundingClientRect().width || 1);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const h = hit(e);
    if (h.index < 0) return;
    onSelectPanel(h.index);
    drag = { index: h.index, panel: h.panel, x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) {
      canvas.style.cursor = hit(e).index >= 0 ? 'grab' : 'default';
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    canvas.classList.add('is-dragging');
    const k = pxPerCss();
    onPan(drag.index, dx * k, dy * k, drag.panel);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = (e) => {
    if (!drag) return;
    drag = null;
    canvas.classList.remove('is-dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    const h = hit(e);
    if (h.index < 0) return;
    e.preventDefault();
    onSelectPanel(h.index);
    onZoom(h.index, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  canvas.addEventListener('dragover', (e) => {
    if (!Array.from(e.dataTransfer.types || []).includes('application/x-neon-photo')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData('application/x-neon-photo');
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    const h = hit(e);
    if (h.index >= 0) onDropPhoto(h.index, id);
  });
}

/** Neon dashed outline + soft glow around the selected panel (drawn on top of the rendered preview). */
export function drawSelectionOverlay(ctx, polygon) {
  if (!polygon || polygon.length < 3) return;
  const scale = Math.max(1, Math.min(ctx.canvas.width, ctx.canvas.height) / 540);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(25, 240, 255, 0.9)';
  ctx.shadowBlur = 10 * scale;
  ctx.strokeStyle = '#19F0FF';
  ctx.lineWidth = 2.5 * scale;
  ctx.setLineDash([9 * scale, 6 * scale]);
  tracePolygon(ctx, polygon);
  ctx.stroke();
  ctx.restore();
}

// ---------- internals ----------

/** Inline SVG of a layout's panels at a small 3:2 size (with the caption band left empty). */
function layoutDiagramSVG(layoutId) {
  const W = 60, H = 40;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'layout-diagram');
  svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', W);
  bg.setAttribute('height', H);
  bg.setAttribute('rx', 2);
  bg.setAttribute('fill', '#2a0f3f');
  svg.append(bg);
  const colours = ['#FF2BD6', '#FF6B3D', '#FFB347', '#19F0FF', '#B05CFF', '#FF4F7A'];
  // Computed at 10× then scaled down, so the pixel gutter minimum stays proportional.
  for (const panel of panelsForSize(layoutId, W * 10, H * 10)) {
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', panel.points.map(([x, y]) => `${(x / 10).toFixed(1)},${(y / 10).toFixed(1)}`).join(' '));
    poly.setAttribute('fill', colours[panel.index % colours.length]);
    poly.setAttribute('fill-opacity', '0.85');
    poly.setAttribute('stroke', '#fff');
    poly.setAttribute('stroke-width', '0.6');
    svg.append(poly);
  }
  return svg;
}

function byId(id) {
  return document.getElementById(id);
}

function setRange(id, value) {
  const el = byId(id);
  if (document.activeElement !== el) el.value = String(value);
}

function toCamel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
