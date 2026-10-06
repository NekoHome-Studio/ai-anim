// 验收：引擎级的「共享背景」两条路都能用。
//   ① `task.world` + `cut(shot, { world: 'auto' })` → 引擎每帧先铺背景
//   ② `cut(shot, { world: false })`                → 明确"我自己负责整帧"（守门跳过）
//
// 为什么需要它：这是 P0-2 的根治方案（「漏画背景」不再依赖作者记得调用）。
// 判据是**画面**：声明了 world 的段，底部应该出现 worldPass 的网格特征像素；
// 与不声明 world 的同一场景相比，亮度/结构必须明显不同。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = '_worldtest';
const DIR = path.join(ROOT, 'tasks', TASK);

mkdirSync(path.join(DIR, 'scenes'), { recursive: true });
mkdirSync(path.join(DIR, 'audio'), { recursive: true });

writeFileSync(path.join(DIR, 'scenes', 'shot.js'), `import { css } from '../../../src/core/util.js';
export default {
  id: 'shot',
  // 刻意**不画任何背景**：底完全交给引擎（或什么都没有）
  render(ctx) {
    const { text, type, P, f } = ctx;
    text.clear();
    type.write('NO BG HERE', 200, 400, { size: 80, weight: 800, family: 'mono', color: css(P.bone), t: f.lt });
    text.upload();
    ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false });
    return {};
  },
};
`);

writeFileSync(path.join(DIR, 'task.config.mjs'), `import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import { Pass } from '../../src/core/gl.js';
import shot from './scenes/shot.js';

// 引擎级的共享背景：声明 world: 'auto' 的段由引擎每帧先铺它。
// 这里刻意用**一眼能认出来**的纯色块（而不是网格），便于断言"到底铺没铺"。
export const world = (ctx) => new Pass(ctx.gl, /* glsl */ \`
  void main() {
    // 满屏绿：一眼能认出"背景到底铺没铺"
    fragColor = vec4(0.0, 1.2, 0.2, 1.0);
  }\`, {}, { key: 'worldtest_green', blend: false });

export default {
  title: '${TASK}',
  width: 1920, height: 1080, fps: 60, scale: 1,
  timeline: seq([
    cut(shot, { id: 'withworld', dur: 2, world: 'auto' }),   // ← 引擎铺背景
    cut(shot, { id: 'noworld', dur: 2 }),                    // ← 什么都不铺（底是黑的）
  ]),
};
`);

const run = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out }));
});

let fail = 0;
const check = (label, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${extra ? '  ' + extra : ''}`); if (!ok) fail++; };

/**
 * 起一个 Playwright 会话直接问页面：时间线条目上到底有没有 world？
 * （用 CLI 的打印间接判断太绕，而且看不到 console.warn。）
 */
async function inspectInPage() {
  const { chromium } = await import('playwright-core');
  const { spawn: sp } = await import('node:child_process');
  const port = 5411;
  const vite = sp(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, ANIM_NO_HMR: '1' },
  });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}`); if (r.ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 200)); }
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const warns = [];
  page.on('console', (m) => warns.push(`${m.type()}: ${m.text()}`));
  const pageUrl = `http://127.0.0.1:${port}/?task=${TASK}&offline=1&hud=0`;
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__anim?.status?.().state === 'ready', null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const eng = window.__anim.boot.engine;
    return {
      items: eng.timeline.map((i) => ({ id: i.id, world: String(i.world), scene: !!i._scene })),
      hasPass: !!eng.world,
      worldPassType: typeof eng.worldPass,
      worldError: eng.worldError ?? null,
      errors: window.__anim.info().errors,
      warn: window.__anim.info().errors,
    };
  });
  await browser.close();
  vite.kill();
  return { r, warns };
}

try {
  const { r: insp, warns } = await inspectInPage();
  console.log('页面里看到的时间线：');
  for (const it of insp.items) console.log(`  ${it.id}  world=${it.world}  scene=${it.scene}`);
  console.log(`  engine.worldPass = ${insp.worldPassType}   engine.world = ${insp.hasPass}   worldError = ${insp.worldError}`);
  if (insp.errors?.length) console.log('  引擎报的错：\n    ' + insp.errors.slice(0, 5).join('\n    '));
  if (warns.length) console.log('  控制台：\n    ' + warns.slice(0, 6).join('\n    '));
  check('时间线条目带上了 world', insp.items.some((i) => i.world === 'auto'));
  check('引擎把 task.world 解析成了共享背景 Pass', !!insp.hasPass);

  // 两个时刻：t=1（声明了 world 的段）与 t=3（没声明的段）
  const r = await run(['still', TASK, '-t', '1,3', '--samples', '1', '-o', path.join(ROOT, 'out', TASK)]);
  console.log(r.out.trim().split('\n').slice(-4).join('\n'));
  check('渲染成功', r.code === 0);

  // 直接从 PNG 里读像素：绿色通道明显高于红/蓝 = 铺了绿色背景
  const { execFileSync } = await import('node:child_process');
  const measure = (file) => {
    // 用 ffprobe 拿尺寸，再用 ffmpeg 抽一个点的 RGB（简化为整帧平均色）
    const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
    return [out[0], out[1], out[2]];
  };
  const withWorld = measure(path.join(ROOT, 'out', TASK, 'f_0001.000.png'));
  const noWorld = measure(path.join(ROOT, 'out', TASK, 'f_0003.000.png'));
  console.log(`  t=1（world:'auto'）平均色 rgb(${withWorld.join(',')})`);
  console.log(`  t=3（没声明）      平均色 rgb(${noWorld.join(',')})`);
  check('声明 world 的段底是绿的（背景被铺上了）', withWorld[1] > withWorld[0] + 40 && withWorld[1] > withWorld[2] + 40);
  check('没声明的段不是绿的（引擎没乱铺）', !(noWorld[1] > noWorld[0] + 40));

  const st = await run(['check', TASK]);
  console.log(st.out.split('\n').filter((l) => /单帧|背景守门|✓ 没有|✗/.test(l)).join('\n'));
  check('check 通过（没有交叠段，所以背景守门不管）', st.code === 0);
} finally {
  rmSync(DIR, { recursive: true, force: true });
  void readFileSync;
}

console.log(fail ? `\n✗ ${fail} 项不通过` : '\n✓ 引擎级共享背景可用（world: \'auto\' 生效、缺省不铺底）');
process.exit(fail ? 1 : 0);
