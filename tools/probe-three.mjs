// @ts-check
/**
 * Three.js 桥的量具（`tasks/_three-calib`）：**颜色、朝向、线性 alpha** 三件事。
 *
 * 为什么必须有它：桥的每一处接缝（sRGB 编解码、Y 翻转、预乘 alpha、混合空间）
 * 出问题时**都不会报错**，只会"看起来还行"或者"莫名有点暗"。这一支把那些接缝
 * 变成四条能对的数字：
 *
 *   1. 朝向   四象限的颜色位置（红必须左上）—— 上下颠倒 / 左右镜像当场露馅
 *   2. 颜色   Three.js 画的纯色 vs 引擎画的同色（两条管线必须给出同一批字节）
 *   3. 标定   线性 0.5 → 188（导出编码那一条）
 *   4. 合成   半透明红 over 已知底色，必须等于**线性空间**的 over（225 / 207）
 *
 * 用法：
 *   node tools/probe-three.mjs              # 起私有 Vite + 无头 Chrome，判完自己退
 *   node tools/probe-three.mjs --url http://127.0.0.1:5173   # 复用已在跑的 dev 服务
 *
 * 退出码：0 = 全部通过；1 = 有判据没过（会打印每一项实测值）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = '_three-calib';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
/** 每个通道允许的误差（sRGB 8bit，抖动与舍入） */
const TOL = 2;

async function portReady(url, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const res = await fetch(url, { signal: AbortSignal.timeout(1200) }); if (res.ok) return true; } catch { /* retry */ }
    await sleep(180);
  }
  return false;
}

let vite = null;
let url = argOf('--url') ?? '';
if (!url) {
  const port = 5401;
  const viteEntry = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  vite = spawn(process.execPath, [viteEntry, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ANIM_NO_HMR: '1' },
  });
  url = `http://127.0.0.1:${port}`;
  if (!(await portReady(url))) { vite.kill(); console.error('✗ 私有 Vite 起不来'); process.exit(1); }
}

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=default', '--enable-gpu-rasterization', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--disable-background-timer-throttling'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

let failed = 0;
try {
  await page.goto(`${url}/?task=${TASK}&offline=1&hud=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const st = await page.waitForFunction(
    () => { const a = window.__anim; return a && a.status && a.status().state !== 'booting' ? a.status() : null; },
    null, { timeout: 180000 },
  ).then((h) => h.jsonValue());
  if (st.state !== 'ready') throw new Error(`页面没就绪：${JSON.stringify(st).slice(0, 400)}`);

  const info = await page.evaluate(() => window.__anim.info());
  const mid = (id) => {
    const it = info.timeline.find((i) => i.id === id);
    if (!it) throw new Error(`时间线里没有段 "${id}"（有：${info.timeline.map((i) => i.id).join(', ')}）`);
    return (it.start + it.end) / 2;
  };
  console.log(`· ${TASK}  ${info.width}×${info.height}  段：${info.timeline.map((i) => i.id).join(', ')}`);
  if (info.renderErrors?.length) {
    for (const e of info.renderErrors.slice(0, 5)) console.log(`  ⚠ [${e.id}] ${e.message}`);
  }

  /* 取样点：`[x, y]` 用**逻辑像素、y 向下**（与场景里的直觉一致；页面内部会翻成自下而上） */
  const CASES = [
    {
      id: 'calib', t: mid('calib'),
      points: [
        ['三象限_TL', 60, 60, [255, 0, 0]],
        ['三象限_TR', 1860, 60, [0, 255, 0]],
        ['三象限_BL', 60, 1020, [0, 0, 255]],
        ['三象限_BR', 1860, 1020, [188, 188, 188]],
        ['引擎块_TL', 500, 200, [255, 0, 0]],
        ['引擎块_TR', 1400, 200, [0, 255, 0]],
        ['引擎块_BL', 500, 700, [0, 0, 255]],
        ['引擎块_BR', 1400, 700, [188, 188, 188]],
      ],
    },
    {
      id: 'alpha', t: mid('alpha'),
      points: [
        ['over_左_底0.5', 400, 700, [225, 137, 137]],
        ['over_右_底0.25', 1500, 700, [207, 99, 99]],
      ],
    },
  ];

  const got = await page.evaluate(async (cases) => {
    const api = window.__anim;
    const boot = await api.boot;
    const engine = boot.engine;
    const gl = engine.gl;
    const out = [];
    for (const c of cases) {
      await api.frame(c.t, { samples: 1 });
      const buf = engine.readPixels();
      out.push({
        id: c.id,
        pts: c.points.map(([name, x, y]) => {
          const i = ((gl.ph - 1 - y) * gl.pw + x) * 4;   // readPixels 自下而上
          return { name, x, y, rgb: [buf[i], buf[i + 1], buf[i + 2]] };
        }),
      });
    }
    return out;
  }, CASES);

  for (const res of got) {
    const spec = CASES.find((c) => c.id === res.id);
    console.log(`\n[${res.id}]  t=${spec.t.toFixed(2)}s`);
    for (const p of res.pts) {
      const want = spec.points.find((q) => q[0] === p.name)[3];
      const d = Math.max(...p.rgb.map((v, i) => Math.abs(v - want[i])));
      const ok = d <= TOL;
      if (!ok) failed++;
      console.log(`  ${ok ? '✓' : '✗'} ${p.name.padEnd(16)} (${String(p.x).padStart(4)},${String(p.y).padStart(4)})  ` +
        `实测 ${JSON.stringify(p.rgb).padEnd(18)} 期望 ${JSON.stringify(want).padEnd(18)} Δ${d}`);
    }
  }
} catch (err) {
  failed++;
  console.error(`✗ ${err && err.message ? err.message : err}`);
}
if (pageErrors.length) {
  console.log('\n页面异常：');
  for (const e of pageErrors.slice(0, 8)) console.log(`  ${e}`);
  failed++;
}

await browser.close();
vite?.kill();
console.log(failed ? `\n✗ probe-three：${failed} 项不通过` : '\n✓ probe-three：全部通过');
process.exit(failed ? 1 : 0);
