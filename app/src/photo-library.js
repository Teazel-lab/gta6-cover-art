// Photo library for NEON COAST Cover Studio: turns the user's own local image files into photo objects
// {id, name, image, w, h} for photo-panels.js. Files are decoded in the browser only — nothing is ever uploaded.

/** Longest side a loaded photo keeps; bigger camera photos are downsized to save memory. */
export const MAX_PHOTO_SIDE = 3000;

/** Bundled demo photos (app/samples/), so the studio shows a cover before the user picks anything. */
export const SAMPLE_PHOTOS = ['pier.jpg', 'boulevard.jpg', 'rider.jpg', 'underpass.jpg', 'speedboat.jpg'];

/** Size of the square photo thumbnails in the library strip. */
export const THUMB_SIZE = 96;

/**
 * Reads a FileList / File[] of local images into photo objects (non-images and broken files are skipped).
 * EXIF orientation is honoured; photos over MAX_PHOTO_SIDE are scaled down.
 */
export async function loadPhotoFiles(fileList) {
  const files = Array.from(fileList || []).filter(isImageFile);
  const photos = [];
  for (const file of files) {
    try {
      photos.push(await decodePhoto(file, file.name || 'photo'));
    } catch (err) {
      console.warn('Skipped unreadable photo', file.name, err);
    }
  }
  return photos;
}

/** Loads the bundled sample photos from ../samples/ relative to this module. */
export async function loadSamplePhotos() {
  const photos = [];
  for (const name of SAMPLE_PHOTOS) {
    try {
      const res = await fetch(new URL(`../samples/${name}`, import.meta.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      photos.push(await decodePhoto(await res.blob(), name));
    } catch (err) {
      console.warn('Sample photo missing', name, err);
    }
  }
  return photos;
}

/**
 * Makes `el` accept dropped image files and pasted images (anywhere on the page while it is shown).
 * Calls onPhotos(photo[]) with the decoded photos. Returns a function that removes the listeners.
 */
export function wirePhotoDropZone(el, onPhotos) {
  let depth = 0;
  const setHover = (on) => el.classList.toggle('is-drop-target', on);
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const deliver = async (files) => {
    const photos = await loadPhotoFiles(files);
    if (photos.length) onPhotos(photos);
  };
  const onEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setHover(true); };
  const onOver = (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth) setHover(false); };
  const onDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    setHover(false);
    deliver(e.dataTransfer.files);
  };
  const onPaste = (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const files = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile());
    if (!files.length) return;
    e.preventDefault();
    deliver(files.filter(Boolean));
  };
  el.addEventListener('dragenter', onEnter);
  el.addEventListener('dragover', onOver);
  el.addEventListener('dragleave', onLeave);
  el.addEventListener('drop', onDrop);
  document.addEventListener('paste', onPaste);
  return () => {
    el.removeEventListener('dragenter', onEnter);
    el.removeEventListener('dragover', onOver);
    el.removeEventListener('dragleave', onLeave);
    el.removeEventListener('drop', onDrop);
    document.removeEventListener('paste', onPaste);
  };
}

/** A THUMB_SIZE square canvas showing the centre-cropped photo. */
export function makePhotoThumb(photo) {
  const c = document.createElement('canvas');
  c.width = c.height = THUMB_SIZE;
  c.title = photo.name;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1d1030';
  ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
  if (photo.image) {
    const side = Math.min(photo.w, photo.h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo.image, (photo.w - side) / 2, (photo.h - side) / 2, side, side, 0, 0, THUMB_SIZE, THUMB_SIZE);
  }
  return c;
}

// ---------- internals ----------

let nextId = 1;

function isImageFile(f) {
  return f && (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name || ''));
}

/** Decodes a Blob to a photo object, applying EXIF orientation and the MAX_PHOTO_SIDE limit. */
async function decodePhoto(blob, name) {
  let image = await decodeBitmap(blob);
  let w = image.width, h = image.height;
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(w, h));
  if (scale < 1) {
    const sw = Math.round(w * scale), sh = Math.round(h * scale);
    const small = await shrinkImage(image, sw, sh);
    if (image.close) image.close();
    image = small;
    w = sw;
    h = sh;
  }
  return { id: `photo-${nextId++}-${Date.now().toString(36)}`, name: name.replace(/\.[^.]+$/, ''), image, w, h };
}

async function decodeBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (_) { /* fall back to <img> below */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode(); // modern browsers apply EXIF orientation to <img> by default
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function shrinkImage(image, sw, sh) {
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, sw, sh);
  return typeof createImageBitmap === 'function' ? createImageBitmap(c) : c;
}
