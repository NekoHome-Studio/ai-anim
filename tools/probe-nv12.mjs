// @ts-check
/**
 * 量具：GPU 的 NV12 编码（`engine.readNV12()`）与**可信路径**是否一致。
 *
 *   node tools/probe-nv12.mjs [task] [url]
 *
 * 为什么需要它：出片推流从 RGBA 换成了 NV12（每帧 8.3MB → 3.11MB，见 `docs/PERF.md` §5.4a），
 * 于是"画面"多了一条新的编码路径 —— 而它一旦算错（矩阵、范围、色度平均），
 * 成片会整片偏色，但**渲染、check、hashes 全都看不出来**（它们都不走这条路）。
 *
 * 判据：拿**同一条渲染结果的另一条读回路径**当基准 ——
 * `engine.readPixels()`（sRGB RGBA，第一轮就标定过的路径，`verify` 与 `hashes` 都用它），
 * 在 CPU 上按同一套公式（BT.709 limited、2×2 盒式平均）算一份 NV12，与 GPU 的逐字节比。
 *
 * 允许的差异：CPU 那份的输入是**量化到 8bit 的 sRGB**，GPU 那份是**未量化的浮点**。
 * 盒式平均之后这点差别会体现在 ±1（偶尔 ±2）个码值上，所以判据是
 * 「差 >3 的字节为 0，且平均差 < 0.5」—— 真正算错（范围/矩阵反了）会是几十上百。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { cpuNV12 } from './lib/nv12-ref.mjs';

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
  const port = 5401;
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
if (st.state !== 'ready') {
  console.error('页面没就绪:', JSON.stringify(st));
  await browser.close(); vite?.kill(); process.exit(1);
}

const r = await page.evaluate(async () => {
  const api = /** @type {any} */ (window).__anim;
  const engine = (await api.boot).engine;
  const w = engine.gl.pw, h = engine.gl.ph;
  const b64 = (buf) => {
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return btoa(s);
  };
  const out = [];
  for (const t of [0.2, 1.0, 2.0, 5.0, 11.0]) {
    if (t >= engine.duration) continue;
    await api.frame(t, { samples: 1 });
    const nv = Uint8Array.from(engine.readNV12());                          // GPU 编码
    const rgba = Uint8Array.from(engine.readPixels({ copy: true }));        // 可信路径（sRGB RGBA）
    out.push({ t, nv: b64(nv), rgba: b64(rgba) });
  }
  return { w, h, out };
});

console.log(`\n任务 ${TASK}  ${r.w}×${r.h}（NV12 应为 ${(r.w * r.h * 3) >> 1} 字节/帧）`);
console.log('   t      长度       max   mean    >1      >3     判定');
let bad = 0;
for (const o of r.out) {
  const gpu = Buffer.from(o.nv, 'base64');
  const ref = cpuNV12(Buffer.from(o.rgba, 'base64'), r.w, r.h);
  let max = 0, sum = 0, over1 = 0, over3 = 0;
  const n = Math.min(gpu.length, ref.length);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(gpu[i] - ref[i]);
    if (d > max) max = d;
    sum += d;
    if (d > 1) over1++;
    if (d > 3) over3++;
  }
  const mean = sum / n;
  const expect = (r.w * r.h * 3) >> 1;
  const lenOk = gpu.length === expect;
  const ok = lenOk && over3 === 0 && mean < 0.5;
  if (!ok) bad++;
  console.log(`  ${String(o.t).padStart(5)}  ${lenOk ? '✓' : '✗'} ${String(gpu.length).padStart(8)}`
    + `  ${String(max).padStart(3)}  ${mean.toFixed(3).padStart(5)}`
    + `  ${(over1 / n * 100).toFixed(2).padStart(5)}%  ${(over3 / n * 100).toFixed(3).padStart(5)}%`
    + `   ${ok ? 'PASS' : 'FAIL'}`);
}
console.log(bad ? `\n✗ ${bad} 个时刻不一致（GPU 的 NV12 与可信路径对不上）` : '\n✓ 全部通过：GPU 的 NV12 编码与 CPU 参考实现在舍入误差内一致');

await browser.close();
vite?.kill();
process.exit(bad ? 1 : 0);
