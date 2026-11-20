// Fixed screenshot scenes for NEON COAST Cover Studio, chosen by `?shot=<scene>` (see shots.json).
// Cover scenes build a doc from the bundled sample photos, export it with the real PNG exporter and show ONLY
// that exported PNG on a black page. The editor scene shows the full studio with photos loaded and a real export.
// When a scene is done, document.title becomes 'shot-ready'. `&dump=1` also writes the PNG as a data: URL into
// <pre id="shot-png"> so tools/take-screenshots.mjs can save the exact exported file.

import { createPanelState, setPanelCrop } from './photo-panels.js';
import { POST_SIZES } from './layouts.js';
import { formatBytes } from './export-png.js';

/** Scene recipes: layout, size, grade, effect, caption, and per-panel photo + crop. */
export const SHOT_SCENES = {
  'cover-landscape': {
    sizeId: 'landscape', layoutId: 'hero-wall', gradeId: 'vice-sunset', effectId: 'comic',
    caption: 'SUNSET HEIST', tagline: 'One last job',
    panels: [
      ['boulevard', { zoom: 1.05, offsetX: 0, offsetY: -0.3 }],
      ['rider', { zoom: 1.1, offsetX: 0, offsetY: -0.55 }],
      ['speedboat', { zoom: 1.15, offsetX: 0.05, offsetY: -0.1 }],
      ['underpass', { zoom: 1.15, offsetX: -0.1, offsetY: -0.35 }],
      ['pier', { zoom: 1.1, offsetX: 0.1, offsetY: -0.5 }],
    ],
  },
  'cover-portrait': {
    sizeId: 'portrait', layoutId: 'mosaic', gradeId: 'neon-night', effectId: 'comic',
    caption: 'NEON NIGHTS', tagline: 'Ride or die',
    panels: [
      ['underpass', { zoom: 1.12, offsetX: -0.35, offsetY: -0.3 }],
      ['rider', { zoom: 1, offsetX: 0, offsetY: -0.4 }],
      ['boulevard', { zoom: 1, offsetX: 0, offsetY: -0.4 }],
      ['rider', { zoom: 1.9, offsetX: 0.2, offsetY: -0.6 }],
      ['boulevard', { zoom: 1.7, offsetX: 0.3, offsetY: -0.75 }],
    ],
  },
  'cover-square': {
    sizeId: 'square', layoutId: 'hero-trio', gradeId: 'golden-hour', effectId: 'comic',
    caption: 'PARADISE FOUND', tagline: 'Retired. Not tired.',
    panels: [
      ['pier', { zoom: 1, offsetX: 0.1, offsetY: -0.3 }],
      ['speedboat', { zoom: 1, offsetX: 0.1, offsetY: -0.2 }],
      ['speedboat', { zoom: 1.9, offsetX: -0.55, offsetY: -0.45 }],
      ['speedboat', { zoom: 1.9, offsetX: 0.5, offsetY: -0.5 }],
    ],
  },
  editor: {
    sizeId: 'square', layoutId: 'six-pack', gradeId: 'vice-sunset', effectId: 'comic',
    caption: 'SUNSET HEIST', tagline: 'One last job', selectPanel: 1,
    panels: [
      ['pier', { zoom: 1, offsetX: 0, offsetY: -0.1 }],
      ['rider', { zoom: 1.35, offsetX: 0.1, offsetY: -0.55 }],
      ['speedboat', { zoom: 1, offsetX: 0.2, offsetY: 0 }],
      ['boulevard', { zoom: 1, offsetX: 0, offsetY: -0.4 }],
      ['underpass', { zoom: 1, offsetX: 0, offsetY: 0 }],
      ['speedboat', { zoom: 1.5, offsetX: -0.45, offsetY: -0.3 }],
    ],
  },
};

/** Runs the scene named by ?shot= against the app API from main.js. */
export default async function runShot(api) {
  const query = new URLSearchParams(location.search);
  const name = query.get('shot');
  const scene = SHOT_SCENES[name];
  if (!scene) { console.warn('Unknown shot scene', name); return; }
  applyScene(api, scene);
  if (name === 'editor') await showEditorScene(api, scene);
  else await showExportedCover(api, scene, query.get('dump') === '1');
  await nextFrames(2);
  document.title = 'shot-ready';
}

/** Puts the scene's layout, photos, crops and text into the app's doc. */
function applyScene(api, scene) {
  const byName = (n) => api.photos.find((p) => p.name === n);
  const photos = scene.panels.map(([n]) => byName(n)).filter(Boolean);
  const unique = [...new Set(photos)];
  let state = createPanelState(scene.layoutId, unique);
  state = {
    ...state,
    photos: api.photos.slice(),
    panels: scene.panels.map(([n]) => ({ photoId: byName(n) ? byName(n).id : null, crop: state.panels[0].crop })),
  };
  scene.panels.forEach(([, crop], i) => { state = setPanelCrop(state, i, { flipX: false, ...crop }); });
  api.setDoc({
    layoutId: scene.layoutId, panels: state, sizeId: scene.sizeId, gradeId: scene.gradeId,
    effectId: scene.effectId, caption: scene.caption, tagline: scene.tagline, showCredits: true,
  });
}

/** Exports the cover PNG and replaces the page with just that image (black, centred, contained). */
async function showExportedCover(api, scene, dump) {
  const blob = await api.exportBlob(scene.sizeId);
  const url = await blobToDataURL(blob);
  document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((el) => el.remove());
  document.body.className = '';
  document.body.textContent = '';
  const style = document.createElement('style');
  style.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}'
    + 'img{display:block;width:100vw;height:100vh;object-fit:contain}';
  document.head.append(style);
  const img = new Image();
  img.alt = `Exported cover ${scene.caption}`;
  img.src = url;
  await img.decode();
  document.body.append(img);
  if (dump) {
    const pre = document.createElement('pre');
    pre.id = 'shot-png';
    pre.hidden = true;
    pre.textContent = url;
    document.body.append(pre);
  }
}

/** Selects a panel and runs a real export of the current size, reporting it in the status line. */
async function showEditorScene(api, scene) {
  api.selectPanel(scene.selectPanel || 0);
  const size = POST_SIZES.find((s) => s.id === scene.sizeId);
  const t0 = performance.now();
  const blob = await api.exportBlob(scene.sizeId);
  const ms = Math.round(performance.now() - t0);
  document.getElementById('export-status').textContent = `Saved neon-coast-${size.w}x${size.h}.png · ${formatBytes(blob.size)} · ${ms} ms`;
  api.renderPreview();
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function nextFrames(n) {
  return new Promise((resolve) => {
    const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve());
    step();
  });
}
