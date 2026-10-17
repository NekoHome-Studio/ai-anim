// P2-2 回归：渲染期间改动工作区。
//
// 背景（docs/history/IMPROVEMENTS-1-3.md P2-2）：私有 Vite 的 `watch.ignored` 原来只有 `**/out/**`，
// 于是**长渲染（25–60 分钟）期间连往 docs/ 写一个 markdown 都不敢** ——
// 文件一改就 HMR 重载页面、WebSocket 断流、推帧提前结束，而 CLI 还报 ✓
// （历史症状：2880 帧的片子被截成 152 帧）。
//
// 现在两件事一起验（这条测试就是一次真渲染，中途动工作区）：
//   A) 渲染中途往 `docs/` 写文件 → **推帧不能断**（HMR 已放宽）
//   B) 渲染中途改 `tasks/<任务>/scenes/*.js` → CLI 必须**点名报出来**
//      （模块图 mtime 守门；以前是静默断流）
//
//   node tools/smoke-worktree-edit.mjs
import { spawn } from 'node:child_process';
import { existsSync, appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = 'demo';
const SCENE = path.join(ROOT, 'tasks', TASK, 'scenes', 'chart.js');
const MD = path.join(ROOT, 'docs', '_smoke-worktree-edit.md');

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

if (!existsSync(SCENE)) { console.log(`没有 ${path.relative(ROOT, SCENE)}，跳过`); process.exit(0); }
// ⚠ 渲染**开始前不能动文件**：场景文件是模块图的一部分，改名/改内容会让页面直接
//    加载失败（第一版就是这么写的，渲染根本没起来，测试等超时）。
//    所以只记内容，等推帧开始之后再追加。
const sceneSrc = readFileSync(SCENE, 'utf8')
  // 幂等：把上一次（可能被中断的）运行注入的行先去掉再当"原始内容"
  .replace(/\n*\/\/ smoke-worktree-edit：[^\n]*\n?/g, '\n');

let child = null;
let out = '';
/** 等 stdout 里出现某个模式（带超时）。 */
async function waitFor(re, ms = 180000, what = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(out)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`  （等 ${what || re} 超时，当前输出尾部：）\n${out.split('\n').slice(-8).join('\n')}`);
  return false;
}

/** 从输出里取**最后一次**进度读数（进度行每 30 帧重画一次，取第一个会永远停在 30）。 */
function lastFrames(text) {
  const all = [...text.matchAll(/(\d+)\/(\d+) 帧/g)];
  return all.length ? Number(all[all.length - 1][1]) : 0;
}

/**
 * 等到帧数读数**真的超过** `base` 再返回（最多等 `ms`）。
 *
 * ⚠ 为什么不能用"等固定 2.5 秒再看一眼"（这条测试 2026-10 就是这么假失败的）：
 *   `video demo --samples 1` 在这台机器上实测只有 **3.0 fps**（480 帧 157.7s），
 *   而进度行**每 30 帧才重画一次** —— 5 秒窗口里读数纹丝不动（60 → 60），
 *   于是引擎完全正常、测试却红。引擎的问题和量具的问题必须分开：
 *   这条测试想验的是"往 docs/ 写文件会不会打断推帧"，那就要**等到帧数真的涨**。
 */
async function waitFramesAbove(base, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (lastFrames(out) > base) return lastFrames(out);
    await new Promise((r) => setTimeout(r, 400));
  }
  return lastFrames(out);
}

try {
  console.log('起一次真渲染（8 秒，samples=1）…');
  child = spawn(process.execPath, [
    path.join(ROOT, 'scripts', 'anim.mjs'), 'video', TASK,
    '--from', '0', '--to', '8', '--samples', '1', '--noaudio',
    '--vcodec', 'h264_nvenc', '--cq', '19', '--out', path.join('out', TASK, '_worktree.mp4'),
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });

  // 等推帧真正开始：既要"浏览器已连接"，也要至少推进了一些帧
  // （只等连接会撞上"刚连上就被改文件"的竞态，那时模块已被重载）
  const conn = await waitFor(/浏览器已连接/, 180000, '浏览器已连接');
  say(conn, '推流已经开始（浏览器已连接）');
  const progressed = await waitFor(/\s(1[0-9][0-9]|[6-9]\d)\/480 帧/, 180000, '推进到 60 帧以上');
  say(progressed, '渲染确实在推进（≥60/480 帧）');
  const framesAtEdit = lastFrames(out);

  // A) 往 docs/ 写文件：绝不能打断（判据 = 帧数**真的继续涨**，见 waitFramesAbove 的注释）
  console.log('\nA) 渲染中途往 docs/ 写一个 markdown …');
  writeFileSync(MD, `# smoke\n\n这是 tools/smoke-worktree-edit.mjs 在渲染期间写入的临时文件。\n`);
  const afterFirst = await waitFramesAbove(framesAtEdit);
  say(afterFirst > framesAtEdit, `写 docs/ 之后帧数继续涨（${framesAtEdit} → ${afterFirst}）`);
  appendFileSync(MD, `第二行：再改一次。\n`);
  const afterSecond = await waitFramesAbove(afterFirst);
  say(afterSecond > afterFirst, `再改一次仍然继续涨（${afterFirst} → ${afterSecond}）`);
  say(!/渲染停滞|WebSocket 断|推流.*失败/.test(out), '没有出现"停滞/断流/推流失败"');

  // B) 改模块图里的场景文件：必须被点名 + 产物必须被拦下
  console.log('B) 再改 tasks/demo/scenes/chart.js …');
  // ⚠ **先把 close 监听挂上，再改文件**：CLI 可能在我们"等一会儿"的工夫里就退出了，
  //   那时再挂监听就永远等不到 —— Node 会报 "Detected unsettled top-level await" 并以 13 退出
  //   （2026-10 实测踩到过：A) 改成"等帧数真涨"之后 A 变长，B 的竞态就露出来了）。
  const closed = new Promise((r) => child.on('close', r));
  writeFileSync(SCENE, sceneSrc + '\n// smoke-worktree-edit：渲染期间注入的一行注释\n');
  const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r('TIMEOUT'), 120000))]);
  if (code === 'TIMEOUT') { try { child.kill(); } catch { /* ignore */ } }
  child = null;

  say(/渲染期间这些源文件被改动了/.test(out), 'CLI 报出了"渲染期间源文件被改动"');
  say(/chart\.js/.test(out), '并且点名了具体文件名（不是笼统的"断流"）');
  say(code !== 0, `退出码 ${code}（期望非 0：混合了两个版本的产物不该被当成成片）`);
  say(!existsSync(path.join(ROOT, 'out', TASK, '_worktree.mp4')), '那个可疑的产物已经被删掉');
} finally {
  try { if (child) child.kill(); } catch { /* ignore */ }
  try { writeFileSync(SCENE, sceneSrc); } catch { /* ignore */ }
  try { rmSync(MD, { force: true }); } catch { /* ignore */ }
  try { rmSync(path.join(ROOT, 'out', TASK, '_worktree.mp4'), { force: true }); } catch { /* ignore */ }
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过：写 docs/ 不打断渲染；改场景文件会被点名');
process.exit(fails ? 1 : 0);
