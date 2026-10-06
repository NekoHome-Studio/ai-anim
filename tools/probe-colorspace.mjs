// 一次性诊断脚本：标定「引擎导出」与「浏览器显示」两条路径的色彩空间。
// 用法：node tools/probe-colorspace.mjs [task] [url]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = process.argv[2] ?? '_calib';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portReady(url, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(1200) }); if (res.ok) return true; } catch { /* retry */ }
    await sleep(180);
  }
  return false;
}

let vite = null;
let url = process.argv[3] ?? '';
if (!url) {
  const port = 5399;
  const viteEntry = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  vite = spawn(process.execPath, [viteEntry, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ANIM_NO_HMR: '1' },
  });
  url = `http://127.0.0.1:${port}`;
  if (!(await portReady(url))) { vite.kill(); console.error('vite 起不来'); process.exit(1); }
}

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=default', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-background-timer-throttling'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(`${url}/?task=${TASK}&offline=1&hud=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const st = await page.waitForFunction(
  () => { const a = window.__anim; return a && a.status && a.status().state !== 'booting' ? a.status() : null; },
  null, { timeout: 120000 },
).then((h) => h.jsonValue());
console.log('status:', JSON.stringify(st));
if (st.state !== 'ready') { await browser.close(); vite?.kill(); process.exit(1); }

const r = await page.evaluate(async () => {
  const api = window.__anim;
  const boot = await api.boot;
  const engine = boot.engine;
  const out = [];
  const cv = document.createElement('canvas');
  for (const t of [0, 1, 2]) {
    await api.frame(t, { samples: 1 });
    const lin = engine.readPixels();                      // 导出路径读到的（自下而上）
    cv.width = engine.gl.pw; cv.height = engine.gl.ph;
    const cc = cv.getContext('2d');
    cc.drawImage(engine.gl.canvas, 0, 0);                  // 浏览器显示出来的
    const disp = cc.getImageData(0, 0, cv.width, cv.height).data;
    const i = ((cv.height / 2 | 0) * cv.width + 8) * 4;
    out.push({ t, export: [lin[i], lin[i + 1], lin[i + 2]], display: [disp[i], disp[i + 1], disp[i + 2]] });
  }
  return { size: [engine.gl.pw, engine.gl.ph], frames: out };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
if (vite) vite.kill();
