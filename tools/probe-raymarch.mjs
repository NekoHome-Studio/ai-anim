// @ts-check
/**
 * raymarch 通电探针 —— 定位 `docs/STATUS.md` §13.4 那条「真 raymarch 段落在引擎里整屏白」。
 *
 * 为什么要有它：raymarch 出问题时**看不出是哪一层**——相机 uniform 没传进去、SDF 返回 NaN、
 * HDR 里溢出成 Inf、后处理把 NaN 压成黑 —— 四种原因的最终画面只差一点颜色，靠改场景文件
 * 反复跑 `still` 去猜太慢。这个探针把「引擎里的一条 Pass」拆成一组**可单独开关的着色器变体**，
 * 在**同一个浏览器会话**里逐个渲染，并直接从 HDR 渲染目标里读浮点像素，于是：
 *
 *   · 相机/射线对不对  → 看 `ray` 变体的颜色渐变
 *   · 步进对不对      → 看 `hit_t` / `normal`
 *   · 排线对不对      → 看 `engrave`
 *   · 是 NaN 还是 Inf → 读回值里分别数 NaN / Inf（**引擎的 8bit 读回会把两者都吃掉**：
 *                        `readPixels()` 里 `NaN → Math.round(NaN) → 0`（黑），`Inf → 255`（白））
 *   · 后处理是不是帮凶 → `inf` / `nan` 两个注入变体告诉你引擎会把它显示成什么样
 *
 * 用法：
 *   node tools/probe-raymarch.mjs                     # 全部变体 + 14 条判据（有 FAIL 就非零退出）
 *   node tools/probe-raymarch.mjs --only full,wrongcam
 *   node tools/probe-raymarch.mjs --png full,nan      # 额外存走完整引擎链的 PNG
 *   node tools/probe-raymarch.mjs --nf full,nan,inf   # 额外调 `__anim.nonFinite()` 核对引擎的扫描
 *   node tools/probe-raymarch.mjs --inspect           # 只打时间线（含 params），查"参数到没到"
 *   node tools/probe-raymarch.mjs --task _calib       # 换一个任务页（默认 pdoom-lab）
 *
 * 产物：`out/_probe-raymarch/*.png`（要看图用 Read 工具打开）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../src/core/glsl3d.js';
import { camera3 } from '../src/core/cam.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', '_probe-raymarch');
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
};
const ONLY = argOf('--only')?.split(',').map((s) => s.trim()) ?? null;
/** 哪些变体额外存一张**走完整引擎链**（场景 → 后处理 → sRGB）的 PNG，逗号分隔。 */
const PNG_SET = new Set((argOf('--png') ?? 'full').split(',').map((s) => s.trim()));
/** `--inspect`：不打图，只把这一页引擎里的时间线（含 `params`）打出来。 */
const INSPECT = process.argv.includes('--inspect');
/** 哪些变体额外走一遍**引擎自己的**非有限值扫描（`window.__anim.nonFinite`），逗号分隔。 */
const NF_SET = new Set((argOf('--nf') ?? 'full,nan,inf').split(',').map((s) => s.trim()));
const TASK = argOf('--task') ?? 'pdoom-lab';
const T = Number(argOf('--time') ?? 1.0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 场景 SDF */

/**
 * 一个"走廊"场景，形状和 `tasks/pdoom-lab/scenes/corridor.js` 里那套线段几何同源：
 * 盒形内腔 + 每 4 个单位一道门框 + 中轴上一颗发光火花。
 * 刻意写得短：探针要的是「SDF 能不能在引擎里出画面」，不是画面好不好看。
 */
const SCENE_SDF = /* glsl */ `
/** 盒**内**距离（正数 = 离最近的墙还有多远）。raymarch 的"房间"都从它开始。 */
float sdInBox(vec3 p, vec3 b) { return -sdBox3(p, b); }
/** 门框：方环 = 外盒 - 内盒。 */
float sdFrame(vec3 p) {
  float outer = sdBox3(p, vec3(1.75, 1.15, 0.10));
  float inner = sdBox3(p, vec3(1.55, 0.95, 0.14));
  return max(outer, -inner);
}
/** 走廊：内腔 ∪ 沿 z 每 4 个单位一道门框 ∪ 中轴上的火花球。 */
float sdScene(vec3 p) {
  float room  = sdInBox(p - vec3(0.0, 0.0, -20.0), vec3(2.2, 1.6, 30.0));
  vec3  q = p;
  q.z = p.z - 4.0 * floor(p.z / 4.0 + 0.5);
  float fr = sdFrame(q);
  float spark = sdSphere(p - vec3(0.0, 0.2, -6.0), 0.16);
  return min(min(room, fr), spark);
}
float sdSceneM(vec3 p, out float mat) {
  vec3 q = p;
  q.z = p.z - 4.0 * floor(p.z / 4.0 + 0.5);
  mat = sdSphere(p - vec3(0.0, 0.2, -6.0), 0.16) < sdFrame(q) ? 2.0 : 1.0;
  return sdScene(p);
}
#define MAP(p) sdScene(p)
#define MAP_MAT(p, m) sdSceneM(p, m)
`;

const UNIFORM_HEAD = /* glsl */ `
uniform vec3  camPos;
uniform vec3  camR;
uniform vec3  camU;
uniform vec3  camF;
uniform float focal;
uniform float mode;
`;

/** 一个变体 = 一段 `main()` 的替换体（前面的库/SDF 完全一致）。 */
const VARIANTS = {
  /** 常量色：证明"引擎里渲染一条 Pass"这条路本身是通的。 */
  flat: `void main() { fragColor = vec4(0.20, 0.40, 0.60, 1.0); }`,

  /** 射线方向：相机 uniform 对不对，一眼可辨（错了就是一片死色或者花屏）。 */
  ray: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    fragColor = vec4(rd * 0.5 + 0.5, 1.0);
  }`,

  /** 步进距离（归一化灰度）：SDF 有没有被步进到、远处有没有打空。 */
  hit_t: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat);
    float k = hit < 0.0 ? 0.0 : sat(hit / 30.0);
    fragColor = vec4(vec3(k), 1.0);
  }`,

  /** 命中判定（黑白）：最干净的"几何在不在"。 */
  hit_mask: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat);
    fragColor = vec4(vec3(hit < 0.0 ? 0.0 : 1.0), 1.0);
  }`,

  /** 法线：差分步进对不对。 */
  normal: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat);
    vec3 col = vec3(0.0);
    if (hit > 0.0) col = marchNormal(ro + rd * hit, 0.002) * 0.5 + 0.5;
    fragColor = vec4(col, 1.0);
  }`,

  /** 排线（§13.4 的头号嫌疑）：只在命中处调用 hatch，和嫌疑代码路径一致。 */
  engrave: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat);
    vec3 col = C_INK;
    if (hit > 0.0) {
      vec3 p = ro + rd * hit;
      vec3 n = marchNormal(p, 0.002);
      float dif = clamp(dot(n, normalize(vec3(0.4, 0.8, 0.3))), 0.0, 1.0);
      col = mix(C_BONE, C_INK, hatch(p.y * 26.0, sat(1.0 - dif)));
    }
    fragColor = vec4(col, 1.0);
  }`,

  /** 全链路：排线 + AO + 软阴影 + 雾（= §13.4 里那一版的形状）。 */
  full: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat);
    vec3 col = C_INK;
    if (hit > 0.0) {
      vec3 p = ro + rd * hit;
      vec3 n = marchNormal(p, 0.002);
      float ao = calcAO(p, n);
      float sh = softShadow(p + n * 0.01, normalize(vec3(0.4, 0.8, 0.3)), 4.0, 12.0);
      col = shadeEngraved(p, n, rd, normalize(vec3(0.4, 0.8, 0.3)),
                          C_EMBER * 0.6, C_INK, C_BONE, 40.0, 0.5, ao * sh);
    }
    fragColor = vec4(fog(col, hit < 0.0 ? 60.0 : hit, 4.0, 0.06), 1.0);
  }`,

  /** 注入 NaN：引擎会把它显示成什么？（8bit 读回里 NaN → 0） */
  nan: `void main() { fragColor = vec4(vec3(0.0 / 0.0), 1.0); }`,

  /** 注入正无穷：8bit 读回里 Inf → 255（白）。 */
  inf: `void main() { fragColor = vec4(vec3(1.0 / 0.0), 1.0); }`,

  /** 注入大数：肩部曲线会把 Inf 和 1e30 都压到 1.0 —— 这就是"整屏白"能出现的地方。 */
  huge: `void main() { fragColor = vec4(vec3(1e30), 1.0); }`,

  /** 头号怀疑：相机 uniform 全为 0（`cam3Uniforms(camera3(...))` 字段名不匹配时会这样）。 */
  zerocam: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0), 900.0, ro);
    float mat; float hit = march(ro, rd, mat);
    fragColor = vec4(vec3(hit < 0.0 ? 0.0 : 1.0, 0.0, 0.0), 1.0);
  }`,

  /**
   * §13.4 的第 2 条怀疑：`fwidth` 在**非一致控制流**里。
   * 同一个 `hatch`，一次放在 `if (hit > 0.0)` 里面，一次放在外面用掩码取。
   */
  fwidth_branch: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat);
    vec3 col = C_INK;
    if (hit > 0.0) {
      vec3 p = ro + rd * hit;
      col = mix(C_BONE, C_INK, hatch(p.y * 26.0, 0.55));
    }
    fragColor = vec4(col, 1.0);
  }`,
  fwidth_mask: `void main() {
    vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
    float mat; float hit = march(ro, rd, mat);
    vec3 p = ro + rd * max(hit, 0.0);
    float h = hatch(p.y * 26.0, 0.55);          // 两条路都算，最后按掩码取（不在分支里求导）
    vec3 col = mix(C_INK, mix(C_BONE, C_INK, h), step(0.0, hit));
    fragColor = vec4(col, 1.0);
  }`,
};

/* ------------------------------------------------------------------ Node 侧准备 */

const fragOf = (name) => `${UNIFORM_HEAD}\n${GLSL3D_PRE}\n${SCENE_SDF}\n${GLSL3D_KERNELS}\n${VARIANTS[name]}`;

/** 走廊段的 3D 相机（和 `_world.js` 的 `corridorCam3` 同形，固定在 t=1.0 附近）。 */
function cameraFor(t) {
  const x = 0.28 * Math.sin(t * 0.55 + 0.7);
  const y = 0.10 * Math.sin(t * 0.9) + 0.05 * Math.sin(t * 2.1 + 1.1);
  const z = -2.0 - t * 0.8;
  return camera3({ pos: [x, y, z], target: [x + 0.03, y - 0.02, z - 1], fov: 50, roll: 0.02, H: 1080 });
}

const names = Object.keys(VARIANTS).filter((n) => !ONLY || ONLY.includes(n));

/** `camera3()` 的结果 → `cam3Uniforms()` 要的形状。 */
function cam3Shape(c) {
  return { camPos: c.pos, camR: c.right, camU: c.up, camF: c.fwd, focal: c.focal };
}
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ 起 vite + chrome */

const port = 5423;
const vite = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ANIM_NO_HMR: '1' },
});
const url = `http://127.0.0.1:${port}`;
let ready = false;
for (let i = 0; i < 220; i++) {
  try { const res = await fetch(url, { signal: AbortSignal.timeout(1200) }); if (res.ok) { ready = true; break; } } catch { /* retry */ }
  await sleep(180);
}
if (!ready) { vite.kill(); console.error('vite 起不来'); process.exit(1); }

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=default', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
await page.goto(`${url}/?task=${TASK}&offline=1&hud=0`, { waitUntil: 'domcontentloaded', timeout: 60000 });
// ⚠ 必须等 `api.boot` 自己出现：`status().state` 变 ready 和 `api.boot = r` 是两步，
//    只等 state 会在两者之间抢跑（`await api.boot` → undefined）。
try {
  await page.waitForFunction(() => {
    const a = window.__anim;
    return a && a.boot && a.status && a.status().state !== 'booting';
  }, null, { timeout: 120000 });
} catch (err) {
  const st = await page.evaluate(() => {
    const a = /** @type {any} */ (window).__anim;
    return {
      hasAnim: !!a, hasBoot: !!a?.boot,
      status: (() => { try { return a?.status?.(); } catch (e) { return String(e); } })(),
      body: (document.body?.innerText ?? '').slice(0, 400),
    };
  }).catch((e) => ({ evalError: String(e) }));
  console.error('页面没就绪：', JSON.stringify(st, null, 2));
  console.error('页面错误：', pageErrors.slice(0, 10).join('\n  '));
  await browser.close(); vite.kill();
  process.exit(1);
}

/* ------------------------------------------------------------------ --inspect：时间线 / params */

if (INSPECT) {
  const info = await page.evaluate(async () => {
    const api = /** @type {any} */ (window).__anim;
    const boot = await api.boot;
    const e = boot.engine;
    return e.timeline.map((i) => ({
      id: i.id, start: i.start, end: i.end,
      params: i.params, world: i.world ?? null,
      scene: !!i._scene, setupImpl: i._scene?.impl ?? null,
    }));
  });
  console.log(`task=${TASK} 时间线（含 params）：`);
  for (const i of info) console.log('  ' + JSON.stringify(i));
  await browser.close();
  vite.kill();
  process.exit(0);
}

/* ------------------------------------------------------------------ 逐个变体渲染 */

const results = [];
for (const name of names) {
  const cam = cameraFor(T);
  // ⚠ 机位 uniform 必须**手工对字段名**：`camera3()` 吐的是 `{pos, right, up, fwd, focal}`，
  //   而 shader 要的是 `{camPos, camR, camU, camF, focal}`。`cam3Uniforms()` 现在两种形状
  //   都认、认不出来直接抛错；在这之前它只认后者，写错就静默给四个 undefined
  //   → `Pass` 跳过它们 → shader 里四个 vec3 全是 0 → `normalize(vec3(0))` → NaN → 整屏白。
  //   `zerocam` 变体就是用来钉这条的。
  const uniforms = { ...cam3Uniforms(cam3Shape(cam)), mode: 0 };
  const wantPng = PNG_SET.has(name);
  const wantNf = NF_SET.has(name);
  const r = await page.evaluate(async ([frag, uni, tt, who, png, nf]) => {
    const api = /** @type {any} */ (window).__anim;
    const boot = await api.boot;
    const e = boot.engine;
    const { Pass, RT } = await import('/src/core/gl.js');
    const rt = new RT(e.gl, e.gl.pw, e.gl.ph);
    const pass = new Pass(e.gl, frag, uni, { key: `probe_rm_${who}`, blend: false });
    pass.render(e.gl, rt, tt, 1 / 60);
    const g = e.gl.ctx;
    g.bindFramebuffer(g.FRAMEBUFFER, rt.fbo);
    const f = new Float32Array(rt.w * rt.h * 4);
    g.readPixels(0, 0, rt.w, rt.h, g.RGBA, g.FLOAT, f);

    let nan = 0, inf = 0, mx = -Infinity, mn = Infinity, sum = 0, n = 0;
    // 逐像素统计（只取 rgb，跳过 alpha）
    for (let i = 0; i < f.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const v = f[i + k];
        if (Number.isNaN(v)) { nan++; continue; }
        if (!Number.isFinite(v)) { inf++; continue; }
        if (v > mx) mx = v;
        if (v < mn) mn = v;
        sum += v; n++;
      }
    }
    // 中心 / 四边中点取样（看形状与朝向，不看统计）。y 自下而上（GL 行序）。
    const px = (x, y) => {
      const i = (y * rt.w + x) * 4;
      const c = [f[i], f[i + 1], f[i + 2]];
      return c.map((v) => (Number.isNaN(v) ? 'NaN' : !Number.isFinite(v) ? (v > 0 ? '+Inf' : '-Inf') : v));
    };
    const samples = {
      center: px(rt.w >> 1, rt.h >> 1),
      left: px(rt.w >> 3, rt.h >> 1),
      right: px((rt.w >> 3) * 7, rt.h >> 1),
      top: px(rt.w >> 1, (rt.h >> 3) * 7),
      bottom: px(rt.w >> 1, rt.h >> 3),
    };
    // 取到 3 位有效小数就够了（十字四个点够看清朝向/形状）
    for (const k of Object.keys(samples)) {
      samples[k] = samples[k].map((x) => (typeof x === 'number' ? +x.toFixed(3) : x));
    }

    // 走完整引擎链：① 出图（后处理 + sRGB）② 引擎自己的非有限值扫描
    let shown = null;
    let nfScan = null;
    if (png || nf) {
      e.timeline.forEach((it) => {
        it._scene = { id: `probe_${who}`, render: (ctx) => { pass.render(ctx.gl, ctx.out, tt, ctx.f.dt); } };
      });
      if (nf) nfScan = api.nonFinite(tt);
      if (png) {
        await api.frame(tt, { samples: 1 });
        shown = { png: api.png(), errors: (e.errors ?? []).slice(-4) };
      }
      e.timeline.forEach((it) => { it._scene = null; });
    }
    rt.dispose();
    return { nan, inf, min: mn, max: mx, mean: n ? sum / n : 0, samples, shown, nfScan, pw: rt.w, ph: rt.h };
  }, [fragOf(name), uniforms, T, name, wantPng, wantNf]);

  if (r.shown?.png) {
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(String(r.shown.png).split(',')[1], 'base64'));
  }
  results.push({ name, ...r });
  const tag = r.nan || r.inf ? ` ⚠ NaN=${r.nan} Inf=${r.inf}` : '';
  console.log(`${name.padEnd(14)} min=${fmt(r.min)} max=${fmt(r.max)} mean=${r.mean.toFixed(3)}${tag}`);
  console.log(`               center=${r.samples.center}  left=${r.samples.left}  right=${r.samples.right}`);
  console.log(`               top=${r.samples.top}  bottom=${r.samples.bottom}${r.nfScan ? `  nonFinite: bad=${r.nfScan.bad} (NaN ${r.nfScan.nan} / Inf ${r.nfScan.inf})` : ''}`);
  if (r.shown?.errors?.length) console.log(`               引擎错误: ${JSON.stringify(r.shown.errors)}`);
}

/** 取某个变体的结果（没跑就返回 null） */
const got = (n) => results.find((r) => r.name === n) ?? null;
const checks = [];
const check = (label, cond, detail = '') => checks.push({ label, ok: !!cond, detail });

/* ---- 判据（跑不到的变体自动跳过）---- */
const flat = got('flat');
if (flat) {
  const c = flat.samples.center;
  check('flat：引擎里一条 Pass 能画出注入的常量色',
    Math.abs(c[0] - 0.2) < 0.02 && Math.abs(c[1] - 0.4) < 0.02 && Math.abs(c[2] - 0.6) < 0.02,
    `center=${c.join(',')}（期望 0.2,0.4,0.6）`);
}
const ray = got('ray');
if (ray) {
  // 射线方向 = rd*0.5+0.5：右半边 rd.x 必须为正、上半边 rd.y 必须为正。
  // 这两条正是 2026-10 修掉的两个静默 bug（camera3 手性 / rayDir 多翻一次 y）。
  check('ray：世界 +x 在画面右半边（camera3 右手系）',
    ray.samples.left[0] < 0.48 && ray.samples.right[0] > 0.52,
    `left.r=${ray.samples.left[0]} right.r=${ray.samples.right[0]}`);
  check('ray：世界 +y 在画面上半边（FRAG_PX 的 y 向上，rayDir 不再翻）',
    ray.samples.top[1] > 0.52 && ray.samples.bottom[1] < 0.48,
    `top.g=${ray.samples.top[1]} bottom.g=${ray.samples.bottom[1]}`);
}
const mask = got('hit_mask');
if (mask) check('hit_mask：走廊里绝大多数光线都命中（相机在 SDF 内部）', mask.mean > 0.9, `mean=${mask.mean.toFixed(3)}`);
const full = got('full');
if (full) {
  check('full：无 NaN / Inf', full.nan === 0 && full.inf === 0, `NaN=${full.nan} Inf=${full.inf}`);
  check('full：亮度在"有画东西"的区间（0.01–0.5）', full.mean > 0.01 && full.mean < 0.5, `mean=${full.mean.toFixed(3)}`);
  check('full：光从上方来（地板比天花板亮）',
    full.samples.bottom[0] + full.samples.bottom[1] > full.samples.top[0] + full.samples.top[1],
    `bottom=${full.samples.bottom.join(',')} top=${full.samples.top.join(',')}`);
}
const nan = got('nan');
if (nan) check('nan：注入了 NaN（判据自己得能看见它）', nan.nan > 1e6, `NaN=${nan.nan}`);
const inf = got('inf');
if (inf) check('inf：注入了 +Inf', inf.inf > 1e6, `Inf=${inf.inf}`);
const huge = got('huge');
if (huge) check('huge：1e30 被 RGBA16F 夹到 65504', Math.abs(huge.max - 65504) < 1, `max=${huge.max}`);
const zc = got('zerocam');
if (zc) check('zerocam：相机 uniform 全 0 时仍然"有命中"（说明它退化成了常数，画面会变成一片亮色）', zc.mean > 0.2, `mean=${zc.mean.toFixed(3)}`);
// 引擎自带的非有限值扫描（check 用的那个 API）
for (const [n, want] of [['full', 0], ['nan', 1], ['inf', 1]]) {
  const r = got(n);
  if (!r?.nfScan) continue;
  check(`engine.nonFinite(${n})：${want ? '必须报出非有限值' : '必须干净'}`,
    want ? r.nfScan.bad > 0 : r.nfScan.bad === 0,
    `bad=${r.nfScan.bad} NaN=${r.nfScan.nan} Inf=${r.nfScan.inf}${r.nfScan.first ? ` first=(${r.nfScan.first.x},${r.nfScan.first.y}) ${r.nfScan.first.kind}` : ''}`);
}

function fmt(v) { return Number.isFinite(v) ? v.toFixed(3) : String(v); }

console.log(`\n图：${path.relative(ROOT, OUT)}/（走完整引擎链：场景 → 后处理 → sRGB）`);
if (pageErrors.length) console.log(`页面错误：\n  ${pageErrors.slice(0, 8).join('\n  ')}`);

let failed = 0;
if (checks.length) {
  console.log('');
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}${c.detail ? `   —— ${c.detail}` : ''}`);
  }
  console.log(`\n判定：${failed ? `FAIL ✗ ${failed}/${checks.length} 条不成立` : `PASS ✓ ${checks.length} 条全部成立`}`);
}

await browser.close();
vite.kill();
process.exit(failed ? 1 : 0);

