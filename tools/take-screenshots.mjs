// Takes the contest screenshots for NEON COAST Cover Studio (dev tool, not part of the app).
// Serves app/ on a free port, renders each ?shot= scene from shots.json with headless Chrome, converts the PNG
// captures to JPEG (<= 250 KiB each) in screenshots/, and saves the exact full-size exported cover PNGs for review.
// Usage: node tools/take-screenshots.mjs [reviewDir]   (default reviewDir: /workspace/makefun/ca1/exports)

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const SHOTS_DIR = join(ROOT, 'screenshots');
const REVIEW_DIR = process.argv[2] || '/workspace/makefun/ca1/exports';
const CHROME = '/usr/bin/google-chrome';
const MAX_BYTES = 250 * 1024;
const OLD_SHOTS = ['1-cover.jpg', '2-editor.jpg', '3-cover.jpg'];

const scenes = JSON.parse(readFileSync(join(ROOT, 'shots.json'), 'utf8'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.json': 'application/json',
};

/** Tiny static server for app/ on an OS-chosen free port. */
function serveApp() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path.endsWith('/') ? `${path}index.html` : path));
    if (!file.startsWith(APP) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Starts headless Chrome with a DevTools port and returns a tiny CDP client for one page.
 * (A plain --screenshot run fires before the scene's async photo decode + PNG encode finish, so instead we
 * wait for the page to set document.title = 'shot-ready' and then capture.)
 */
async function launchChrome() {
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(50);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  return {
    /** Loads `url` at w×h CSS px (scale 1) and waits for the scene to report 'shot-ready'. */
    async open(url, w, h) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url });
      const t0 = Date.now();
      while ((await evaluate('document.title').catch(() => '')) !== 'shot-ready') {
        if (Date.now() - t0 > 60000) throw new Error(`Scene never became ready: ${url}`);
        await sleep(100);
      }
      await sleep(300);
    },
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      return Buffer.from(data, 'base64');
    },
    evaluate,
    close() { ws.close(); proc.kill(); return new Promise((r) => proc.once('exit', r)); },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PNG capture -> JPEG under MAX_BYTES, stepping quality down until it fits. */
function toJpeg(png, jpg) {
  const py = `
import sys, os
from PIL import Image
src, dst, cap = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGB')
for q in range(92, 40, -3):
    im.save(dst, 'JPEG', quality=q, optimize=True, progressive=True, subsampling=0 if q >= 85 else 2)
    if os.path.getsize(dst) <= cap:
        break
print(q, im.size[0], im.size[1], os.path.getsize(dst))
`;
  return execFileSync('python3', ['-I', '-c', py, png, jpg, String(MAX_BYTES)], { encoding: 'utf8' }).trim();
}

const profile = mkdtempSync(join(tmpdir(), 'neon-coast-chrome-'));
const work = mkdtempSync(join(tmpdir(), 'neon-coast-shots-'));
const server = await serveApp();
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await launchChrome();

try {
  mkdirSync(SHOTS_DIR, { recursive: true });
  for (const old of OLD_SHOTS) rmSync(join(SHOTS_DIR, old), { force: true });

  for (const s of scenes) {
    const png = join(work, s.file.replace(/\.jpe?g$/, '.png'));
    await browser.open(`${base}${s.query}`, s.viewport.w, s.viewport.h);
    writeFileSync(png, await browser.screenshot());
    const [q, w, h, bytes] = toJpeg(png, join(SHOTS_DIR, s.file)).split(' ');
    console.log(`${s.file}: ${w}x${h}, ${(bytes / 1024).toFixed(1)} KiB (JPEG q${q})`);
  }

  // Exact exported PNGs, for review only (outside the repo).
  mkdirSync(REVIEW_DIR, { recursive: true });
  for (const s of scenes.filter((x) => x.export)) {
    await browser.open(`${base}${s.query}&dump=1`, 800, 600);
    const dataUrl = await browser.evaluate("document.getElementById('shot-png').textContent");
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) throw new Error(`No exported PNG found for ${s.file}`);
    const out = join(REVIEW_DIR, s.export);
    writeFileSync(out, Buffer.from(m[1], 'base64'));
    const size = execFileSync('python3', ['-I', '-c', 'import sys;from PIL import Image;print(*Image.open(sys.argv[1]).size)', out], { encoding: 'utf8' }).trim();
    console.log(`review ${out}: ${size.replace(' ', 'x')}, ${(statSync(out).size / 1024).toFixed(0)} KiB`);
  }
} finally {
  await browser.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
}
