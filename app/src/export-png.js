// PNG export for NEON COAST Cover Studio: renders the cover at each post size and downloads it.
// Panel crops are stored relative to each panel, so one cover doc re-flows to every size unchanged.

import { POST_SIZES } from './layouts.js';
import { renderCoverToBlob } from './render-cover.js';

/**
 * Renders `doc` at the POST_SIZES entry `sizeId` ('square' | 'portrait' | 'landscape'), checks the PNG,
 * downloads it as neon-coast-<w>x<h>.png and returns {name, bytes, ms}.
 */
export async function exportCoverPNG(doc, sizeId) {
  const size = POST_SIZES.find((s) => s.id === sizeId);
  if (!size) throw new Error(`Unknown export size: ${sizeId}`);
  const t0 = performance.now();
  const blob = await renderCoverToBlob({ ...doc, width: size.w, height: size.h });
  await verifyPNG(blob, size.w, size.h);
  const name = `neon-coast-${size.w}x${size.h}.png`;
  downloadBlob(blob, name);
  return { name, bytes: blob.size, ms: Math.round(performance.now() - t0) };
}

/** Exports all three sizes one after another (never in parallel, to keep memory low). */
export async function exportAllSizes(doc, onProgress) {
  const results = [];
  for (const size of POST_SIZES) {
    const r = await exportCoverPNG(doc, size.id);
    results.push(r);
    if (onProgress) onProgress(r, results.length, POST_SIZES.length);
    await new Promise((res) => setTimeout(res, 250)); // let the browser start each download
  }
  return results;
}

/** Saves `blob` as a file called `name`; the object URL is revoked shortly after. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 1536 -> "1.5 KB", 2400000 -> "2.3 MB". */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** Reads width/height from the PNG IHDR chunk: {w, h}. */
export async function readPNGSize(blob) {
  const head = new DataView(await blob.slice(0, 24).arrayBuffer());
  if (head.getUint32(0) !== 0x89504e47 || head.getUint32(12) !== 0x49484452) throw new Error('Not a PNG');
  return { w: head.getUint32(16), h: head.getUint32(20) };
}

async function verifyPNG(blob, w, h) {
  if (!blob || blob.type !== 'image/png') throw new Error('Export did not produce a PNG');
  const dims = await readPNGSize(blob);
  if (dims.w !== w || dims.h !== h) throw new Error(`PNG is ${dims.w}×${dims.h}, expected ${w}×${h}`);
}
