// App controller for NEON COAST Cover Studio: one cover `doc`, a live preview rendered with the same renderer
// as the PNG export, and the editor controls wired to it. A `?shot=` query hands the API to ./shots.js.

import { PANEL_LAYOUTS, POST_SIZES, panelsForSize } from './layouts.js';
import {
  createPanelState, assignPhotoToPanel, setPanelCrop, panPanelBy, zoomPanelBy, resetPanelCrop, pixelDragToOffset,
} from './photo-panels.js';
import { COLOUR_GRADES } from './colour-grades.js';
import { EFFECT_PRESETS } from './poster-effects.js';
import { loadPosterFonts } from './caption-lettering.js';
import { renderCover, renderCoverToBlob } from './render-cover.js';
import { loadPhotoFiles, loadSamplePhotos, wirePhotoDropZone } from './photo-library.js';
import { exportCoverPNG, exportAllSizes, formatBytes } from './export-png.js';
import {
  buildLayoutPicker, buildGradePicker, buildEffectPicker, markActive, renderPhotoTray,
  updatePanelInspector, wirePreviewInteractions, drawSelectionOverlay,
} from './editor-ui.js';

const $ = (id) => document.getElementById(id);

/** The whole cover: everything the renderer and exporter need. */
let doc = {
  layoutId: 'hero-wall',
  sizeId: 'square',
  panels: createPanelState('hero-trio', []),
  gradeId: 'vice-sunset',
  gradeStrength: 0.8,
  effectId: 'comic',
  caption: 'SUNSET HEIST',
  tagline: 'One last job',
  showCredits: true,
};
let selectedPanel = 0;
let photos = [];
let fontsReady = false;
let frameQueued = false;
const canvas = $('preview-canvas');

/** Merges `partial` into the doc and schedules a re-render + UI sync. */
export function setDoc(partial) {
  doc = { ...doc, ...partial };
  if (partial.layoutId && partial.layoutId !== doc.panels.layoutId) doc.panels = relayoutPanels(doc.panels, partial.layoutId);
  if (partial.panels && partial.panels.photos) photos = partial.panels.photos;
  selectedPanel = Math.min(selectedPanel, doc.panels.panels.length - 1);
  syncControls();
  scheduleRender();
}

/** The doc at a POST_SIZES size (what export renders). */
function docAtSize(sizeId) {
  const size = POST_SIZES.find((s) => s.id === sizeId) || POST_SIZES[0];
  return { ...doc, layoutId: doc.panels.layoutId, width: size.w, height: size.h };
}

// ---------- live preview ----------

function scheduleRender() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => { frameQueued = false; renderPreview(); });
}

/** Renders the preview at the stage's fitted CSS size × devicePixelRatio, same aspect as the export. */
export function renderPreview() {
  const size = POST_SIZES.find((s) => s.id === doc.sizeId) || POST_SIZES[0];
  const stage = canvas.parentElement;
  const availW = Math.max(120, stage.clientWidth - 20), availH = Math.max(120, stage.clientHeight - 20);
  const fit = Math.min(availW / size.w, availH / size.h);
  const cssW = Math.floor(size.w * fit), cssH = Math.floor(size.h * fit);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(cssW * dpr), h = Math.round(size.h * (w / size.w));
  renderCover(canvas, { ...doc, layoutId: doc.panels.layoutId, width: w, height: h });
  const panel = panelsForSize(doc.panels.layoutId, w, h)[selectedPanel];
  if (panel) drawSelectionOverlay(canvas.getContext('2d'), panel.points);
  return canvas;
}

// ---------- photos ----------

/** Adds photos to the library and deals the whole library across the panels. */
function addPhotos(newPhotos) {
  if (!newPhotos.length) return;
  photos = [...photos, ...newPhotos];
  autoFillPanels(newPhotos);
}

/** Deals `first` photos into the panels first (newest photos lead), then the rest of the library. */
function autoFillPanels(first = []) {
  const ids = new Set(first.map((p) => p.id));
  const order = [...first, ...photos.filter((p) => !ids.has(p.id))];
  const state = createPanelState(doc.panels.layoutId, order);
  setDoc({ panels: { ...state, photos: photos.slice() } });
}

function relayoutPanels(old, layoutId) {
  const fresh = createPanelState(layoutId, old.photos);
  // Keep what the user already framed in panels that still exist.
  const panels = fresh.panels.map((p, i) => (old.panels[i] && old.panels[i].photoId ? old.panels[i] : p));
  return { ...fresh, panels };
}

function selectPanel(i) {
  selectedPanel = Math.max(0, Math.min(doc.panels.panels.length - 1, i));
  syncControls();
  scheduleRender();
}

function updatePanels(fn) {
  setDoc({ panels: fn(doc.panels) });
}

// ---------- UI sync ----------

function syncControls() {
  markActive($('layout-picker'), 'layout-id', doc.panels.layoutId);
  markActive($('grade-picker'), 'grade-id', doc.gradeId);
  markActive($('effect-picker'), 'effect-id', doc.effectId);
  markActive($('size-tabs'), 'size-id', doc.sizeId);
  const slot = doc.panels.panels[selectedPanel];
  const activeId = slot ? slot.photoId : null;
  const tray = $('photo-tray');
  if (tray.dataset.ids !== photos.map((p) => p.id).join('|')) {
    renderPhotoTray(tray, photos, (id) => updatePanels((s) => assignPhotoToPanel(s, selectedPanel, id)), activeId);
    tray.dataset.ids = photos.map((p) => p.id).join('|');
  }
  for (const t of tray.children) t.classList.toggle('is-active', t.dataset.photoId === activeId);
  updatePanelInspector({ doc, selectedPanel }, selectedPanel);
  setValue('caption-input', doc.caption);
  setValue('tagline-input', doc.tagline);
  $('credits-toggle').checked = doc.showCredits;
  setValue('grade-strength', doc.gradeStrength);
  const size = POST_SIZES.find((s) => s.id === doc.sizeId);
  $('export-current').textContent = `Export PNG · ${size.w}×${size.h}`;
}

function setValue(id, v) {
  const el = $(id);
  if (document.activeElement !== el) el.value = String(v);
}

// ---------- export ----------

let exporting = false;

async function runExport(sizeIds) {
  if (exporting) return;
  exporting = true;
  const buttons = [$('export-current'), $('export-all'), ...$('export-list').querySelectorAll('button')];
  buttons.forEach((b) => { b.disabled = true; });
  const status = $('export-status');
  try {
    if (sizeIds.length > 1) {
      status.textContent = 'Rendering 3 sizes…';
      const results = await exportAllSizes(docAtSize(doc.sizeId), (r, n, total) => {
        status.textContent = `Saved ${n}/${total}: ${r.name} · ${formatBytes(r.bytes)} · ${r.ms} ms`;
      });
      const bytes = results.reduce((a, r) => a + r.bytes, 0);
      status.textContent = `Saved all 3 sizes · ${formatBytes(bytes)} · ${results.reduce((a, r) => a + r.ms, 0)} ms`;
    } else {
      status.textContent = 'Rendering…';
      const r = await exportCoverPNG(docAtSize(doc.sizeId), sizeIds[0]);
      status.textContent = `Saved ${r.name} · ${formatBytes(r.bytes)} · ${r.ms} ms`;
    }
  } catch (err) {
    console.error(err);
    status.textContent = `Export failed: ${err.message}`;
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    exporting = false;
  }
}

// ---------- wiring ----------

function wireControls() {
  buildLayoutPicker($('layout-picker'), PANEL_LAYOUTS, (id) => setDoc({ layoutId: id }));
  buildGradePicker($('grade-picker'), COLOUR_GRADES, (id) => setDoc({ gradeId: id }));
  buildEffectPicker($('effect-picker'), EFFECT_PRESETS, (id) => setDoc({ effectId: id }));

  for (const tab of $('size-tabs').querySelectorAll('[data-size-id]')) {
    tab.addEventListener('click', () => setDoc({ sizeId: tab.dataset.sizeId }));
  }

  $('photo-input').addEventListener('change', async (e) => {
    addPhotos(await loadPhotoFiles(e.target.files));
    e.target.value = '';
  });
  const drop = $('photo-drop');
  wirePhotoDropZone(drop, addPhotos);
  drop.addEventListener('dragenter', () => drop.classList.add('is-dragover'));
  drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-dragover'); });
  drop.addEventListener('drop', () => drop.classList.remove('is-dragover'));
  // Photo files dropped straight onto the preview are welcome too.
  // (Paste is already handled page-wide by the drop zone above.)
  const wrap = $('preview-wrap');
  const hasFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  wrap.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  wrap.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    addPhotos(await loadPhotoFiles(e.dataTransfer.files));
  });
  $('sample-photos').addEventListener('click', async () => addPhotos(await loadSamplePhotos()));

  $('panel-photo-select').addEventListener('change', (e) => {
    updatePanels((s) => assignPhotoToPanel(s, selectedPanel, e.target.value || null));
  });
  const crop = (field) => (e) => updatePanels((s) => setPanelCrop(s, selectedPanel, { [field]: Number(e.target.value) }));
  $('panel-zoom').addEventListener('input', crop('zoom'));
  $('panel-x').addEventListener('input', crop('offsetX'));
  $('panel-y').addEventListener('input', crop('offsetY'));
  $('panel-flip').addEventListener('click', () => updatePanels((s) => {
    const slot = s.panels[selectedPanel];
    return setPanelCrop(s, selectedPanel, { flipX: !(slot && slot.crop.flipX) });
  }));
  $('panel-reset').addEventListener('click', () => updatePanels((s) => resetPanelCrop(s, selectedPanel)));
  $('panel-fill-all').addEventListener('click', () => {
    const slot = doc.panels.panels[selectedPanel];
    const photo = slot && photos.find((p) => p.id === slot.photoId);
    if (photo) setDoc({ panels: { ...createPanelState(doc.panels.layoutId, [photo]), photos: photos.slice() } });
  });
  $('panel-auto').addEventListener('click', () => autoFillPanels());

  $('caption-input').addEventListener('input', (e) => setDoc({ caption: e.target.value }));
  $('tagline-input').addEventListener('input', (e) => setDoc({ tagline: e.target.value }));
  $('credits-toggle').addEventListener('change', (e) => setDoc({ showCredits: e.target.checked }));
  $('grade-strength').addEventListener('input', (e) => setDoc({ gradeStrength: Number(e.target.value) }));

  $('export-current').addEventListener('click', () => runExport([doc.sizeId]));
  $('export-all').addEventListener('click', () => runExport(POST_SIZES.map((s) => s.id)));
  for (const b of $('export-list').querySelectorAll('[data-export-size]')) {
    b.addEventListener('click', () => runExport([b.dataset.exportSize]));
  }

  wirePreviewInteractions(canvas, () => ({ doc: { ...doc, layoutId: doc.panels.layoutId }, width: canvas.width, height: canvas.height }), {
    onSelectPanel: (i) => { if (i !== selectedPanel) selectPanel(i); },
    onPan: (i, dxPx, dyPx, panel) => updatePanels((s) => {
      const slot = s.panels[i];
      const photo = slot && s.photos.find((p) => p.id === slot.photoId);
      if (!photo) return s;
      // Offsets keep their on-screen direction even when mirrored, so no sign flip is needed here.
      const d = pixelDragToOffset(photo, panel.bounds, slot.crop, dxPx, dyPx);
      return panPanelBy(s, i, d.dx, d.dy);
    }),
    onZoom: (i, factor) => updatePanels((s) => zoomPanelBy(s, i, factor)),
    onDropPhoto: (i, id) => { selectedPanel = i; updatePanels((s) => assignPhotoToPanel(s, i, id)); },
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (!(t.type === 'range' || t.type === 'checkbox')) return;
    }
    if (e.key === 'e' || e.key === 'E') { e.preventDefault(); runExport([doc.sizeId]); }
    const size = { 1: 'square', 2: 'portrait', 3: 'landscape' }[e.key];
    if (size) { e.preventDefault(); setDoc({ sizeId: size }); }
  });

  new ResizeObserver(scheduleRender).observe(canvas.parentElement);
}

// ---------- start-up ----------

async function start() {
  wireControls();
  syncControls();
  scheduleRender();
  // Fonts and samples load in parallel; each re-renders the preview as soon as it lands.
  const fonts = loadPosterFonts().then(() => { fontsReady = true; scheduleRender(); })
    .catch((err) => console.warn('Poster fonts failed', err));
  const samples = loadSamplePhotos().then((list) => { if (!photos.length) addPhotos(list); });
  await Promise.all([fonts, samples]);
  window.__coverReady = fontsReady;

  const shot = new URLSearchParams(location.search).get('shot');
  if (shot) {
    try {
      const mod = await import('./shots.js');
      if (typeof mod.default === 'function') await mod.default(shotApi());
      else console.log('shots.js has no default export runShot(api); ignoring ?shot=', shot);
    } catch (err) {
      console.error('Shot failed', err);
    }
  }
}

/** The small API ./shots.js drives for screenshots. */
function shotApi() {
  return {
    get doc() { return doc; },
    setDoc,
    renderPreview,
    exportBlob: (sizeId) => renderCoverToBlob(docAtSize(sizeId)),
    get photos() { return photos; },
    selectPanel,
  };
}

start();
