// 诊断：页面实际加载到的时间线是什么（段 id / 起止 / 源文件）
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

const port = 5402;
const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ANIM_NO_HMR: '1' },
});
const url = `http://127.0.0.1:${port}`;
if (!(await portReady(url))) { vite.kill(); console.error('vite 起不来'); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${url}/?task=${TASK}&offline=1&hud=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => { const a = window.__anim; return a && a.status && a.status().state !== 'booting'; }, null, { timeout: 120000 });

const r = await page.evaluate(async () => {
  const api = window.__anim;
  const boot = await api.boot;
  const e = boot.engine;
  const probe = [];
  for (const t of [1.1, 1.7, 2.7, 3.7]) {
    await api.frame(t, { samples: 1 });
    const px = e.readPixels();
    const i = ((e.gl.ph / 2 | 0) * e.gl.pw + 300) * 4;
    probe.push({ t, px: [px[i], px[i + 1], px[i + 2]] });
  }
  return {
    task: api.info().task,
    timeline: e.timeline.map((i) => ({ id: i.id, start: i.start, end: i.end })),
    duration: e.duration,
    errors: e.errors,
    probe,
  };
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
vite.kill();
