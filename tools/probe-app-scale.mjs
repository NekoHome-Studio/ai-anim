// 终极验收：直接看**应用自己渲染出来的一帧**在 SCALE=2 下有没有矢量线条。
// 不再手工搭 GL 环境（那套探针自己引入了一堆干扰），只看 png()/readPixels 的真实结果。
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function portReady(url, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(1200) }); if (res.ok) return true; } catch { /* retry */ }
    await sleep(180);
  }
  return false;
}
const port = 5414;
const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ANIM_NO_HMR: '1' },
});
const url = `http://127.0.0.1:${port}`;
if (!(await portReady(url))) { vite.kill(); console.error('vite 起不来'); process.exit(1); }

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=default', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
mkdirSync(path.join(ROOT, 'out', '_calib', 'scale'), { recursive: true });

for (const scale of [1, 2]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(`${url}/?task=_calib&offline=1&hud=0&scale=${scale}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => { const a = window.__anim; return a && a.status && a.status().state !== 'booting'; }, null, { timeout: 120000 });
  // xf 场景 t=12.0 是 xa 段（有网格线 + 白色边框 + 方块）：矢量最密集的一帧
  const r = await page.evaluate(async () => {
    const api = window.__anim;
    const boot = await api.boot;
    const e = boot.engine;
    await api.frame(12.0, { samples: 1 });
    const png = api.png();
    const px = e.readPixels();
    const W = e.gl.pw, H = e.gl.ph;
    // 数"亮像素"：白边框/方块/文字都算；再数一次"中等亮度"（网格线）
    let bright = 0, mid = 0, maxV = 0;
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(px[i], px[i + 1], px[i + 2]);
      if (v > maxV) maxV = v;
      if (v > 180) bright++;
      else if (v > 60) mid++;
    }
    return {
      scale: e.gl.scale, W, H,
      brightPixels: bright, midPixels: mid, maxV,
      errors: e.errors.slice(0, 5),
      png,
    };
  });
  writeFileSync(path.join(ROOT, 'out', '_calib', 'scale', `app_scale${scale}.png`), Buffer.from(String(r.png).split(',')[1], 'base64'));
  console.log(`\n=== scale ${r.scale} (${r.W}×${r.H}) ===`);
  console.log(`  亮像素(>180) ${r.brightPixels}   中亮像素(60..180) ${r.midPixels}   最亮 ${r.maxV}`);
  console.log(`  引擎错误: ${JSON.stringify(r.errors)}`);
  console.log(`  浏览器错误: ${errs.length ? errs.slice(0, 3).join(' | ') : '(无)'}`);
  console.log(`  图: out/_calib/scale/app_scale${scale}.png`);
  await page.close();
}
await browser.close();
vite.kill();
