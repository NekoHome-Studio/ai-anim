// 4K 判定（走真实应用管线）：用一根 80px 粗的纯白矢量带子，在 scale=1 与 scale=2 下
// 各渲染一帧，量"逻辑坐标系里的几何位置与尺寸"。
// 若 SCALE=2 下带子的**逻辑位置**和**逻辑尺寸**与 scale=1 一致 → LineBatch 在 4K 正常。
// 用法：node tools/probe-ribbon.mjs [time]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = Number(process.argv[2] ?? 11.2);
const SCALES = (process.argv[3] ?? '1,2').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function portReady(url, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(1200) }); if (res.ok) return true; } catch { /* retry */ }
    await sleep(180);
  }
  return false;
}
const port = 5420;
const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ANIM_NO_HMR: '1' },
});
const url = `http://127.0.0.1:${port}`;
if (!(await portReady(url))) { vite.kill(); console.error('vite 起不来'); process.exit(1); }

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=default', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
mkdirSync(path.join(ROOT, 'out', '_calib', 'ribbon'), { recursive: true });

const rows = [];
for (const scale of SCALES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  // 注意：不带 --only —— Engine 的 --only 只是改名/过滤，段的时间仍是全局时间，
  // 加了 --only 反而要在"整片时间轴"上取时刻，很容易取到段外（踩过）。
  await page.goto(`${url}/?task=_calib&offline=1&hud=0&scale=${scale}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => { const a = window.__anim; return a && a.status && a.status().state !== 'booting'; }, null, { timeout: 120000 });
  const r = await page.evaluate(async ([tt]) => {
    const api = window.__anim;
    const boot = await api.boot;
    const e = boot.engine;
    await api.frame(tt, { samples: 1 });
    const px = e.readPixels();
    const W = e.gl.pw, H = e.gl.ph, s = e.gl.scale;
    const at = (x, yScreen) => { const i = ((H - 1 - yScreen) * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const lum = (x, y) => { const c = at(x, y); return (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 255; };

    // 找"白带子"：沿逻辑 x=900 那一列扫**逻辑 y**，记录亮度 > 0.5 的连续区间
    const xProbe = 900;
    const bands = [];
    let cur = null;
    for (let yL = 0; yL < 1080; yL++) {
      const v = lum(Math.round(xProbe * s), Math.round(yL * s));
      const on = v > 0.5;
      if (on && !cur) cur = { y0: yL, y1: yL };
      else if (on) cur.y1 = yL;
      else if (!on && cur) { bands.push({ ...cur, h: cur.y1 - cur.y0 + 1 }); cur = null; }
    }
    if (cur) bands.push({ ...cur, h: cur.y1 - cur.y0 + 1 });

    // 找带子的水平範囲：沿它中心那一行扫逻辑 x
    let xRange = null;
    if (bands.length) {
      const yc = Math.round((bands[0].y0 + bands[0].y1) / 2 * s);
      let x0 = -1, x1 = -1;
      for (let xL = 0; xL < 1920; xL++) {
        if (lum(Math.round(xL * s), yc) > 0.5) { if (x0 < 0) x0 = xL; x1 = xL; }
      }
      xRange = x0 >= 0 ? [x0, x1] : null;
    }
    return { scale: s, pw: W, ph: H, png: api.png(), bands, xRange };
  }, [T]);
  writeFileSync(path.join(ROOT, 'out', '_calib', 'ribbon', `ribbon_scale${scale}.png`), Buffer.from(String(r.png).split(',')[1], 'base64'));
  rows.push(r);
  await page.close();
}

console.log(`\n（期望：白带子逻辑 y 360–440、高 80；水平 300–1620）\n`);
for (const r of rows) {
  console.log(`=== scale ${r.scale} (${r.pw}×${r.ph}) ===`);
  console.log(`  x=900 列上的亮带（逻辑 y）：${r.bands.map((b) => `${b.y0}–${b.y1}（高 ${b.h}）`).join('  ') || '(无)'}`);
  console.log(`  带子水平范围（逻辑 x）：${JSON.stringify(r.xRange)}`);
  console.log(`  图：out/_calib/ribbon/ribbon_scale${r.scale}.png`);
}
const ok = rows.length === 2 && rows[0].bands.length && rows[1].bands.length
  && Math.abs(rows[0].bands[0].y0 - rows[1].bands[0].y0) <= 2
  && Math.abs(rows[0].bands[0].h - rows[1].bands[0].h) <= 3;
console.log(`\n判定：${ok ? 'PASS ✓ 两个倍率下几何的逻辑位置/尺寸一致' : 'FAIL ✗ SCALE=2 下矢量几何不对'}`);
await browser.close();
vite.kill();
process.exit(ok ? 0 : 1);
