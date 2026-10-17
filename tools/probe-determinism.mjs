// 跨会话确定性复验（P1-2）：**这是那个"34.8 dB"结论的更正实验。**
//
// 历史结论（docs/history/IMPROVEMENTS-1-3.md P1-2）：
//   「同一时刻、从不同起点开渲结果不同 … 从 85s 起渲的成片窗口 vs 从 110s 起渲的
//     同一窗口 = 34.8 dB … 「每帧是 t 的纯函数」只在同一会话起点内成立」。
//
// 这个脚本用**不带编码器**的判据重做：把推给 ffmpeg 的原始像素落盘，
// 再在**另一个会话**里渲同一时刻，逐字节比。判据是"完全相同"而不是 PSNR ——
// 因为 PSNR 34.8 dB 完全可能是 h264 在高频画面上（480 根 2px 细竖线）的正常损失。
//
// ⚠ 落盘的格式是 **NV12**（2026-10 起推流就是 NV12，见 `docs/PERF.md` §5.4a）：
//   所以两次对照都走"另一个会话的 `video --keep-raw`"，两边都是**同一段 GPU 编码代码**
//   的产物，逐字节比才有意义（拿 still 的 RGBA 去比要经过一次 CPU 参考实现，会引入 ±1）。
//
// 它同时验四件事：
//   ① 两个**独立会话**推给 ffmpeg 的 NV12 逐字节相同 → **跨会话确定**
//   ② `verify` 的帧号抽帧是稳的：第 N 帧 == "帧起点"重渲的那一帧（NV12 空间，判据 max < 64）
//   ③ 不同帧号结果确实不同（否则上面的"一致"没有意义）
//   ④ 记录一条**不是 bug、但反复骗到人的**性质：**帧内取时偏一点，画面就不一样**
//      （t=0.500 与 t=0.508333 是同一个帧号，但 samples>1 时子帧窗跟着 t 走 ⇒ 画面不同）。
//      成片第 30 帧是在 t=0.500 渲的 —— 探针取时偏到 0.508333 就会得到 mean 8.4，
//      看着像"跨会话不确定"，其实是**探针取时错了**。这正是当年那个 34.8 dB 的来源。
//
//   node tools/probe-determinism.mjs beat 1
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpuNV12 } from './lib/nv12-ref.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = process.argv[2] ?? 'beat';
const SECONDS = Number(process.argv[3] ?? '1');
const SAMPLES = process.argv[4] ?? '2';
const FPS = 60;
const RW = 1920, RH = 1080;
/** NV12：先 Y（w×h），再交错 UV（w/2 × h/2） */
const FRAME = (RW * RH * 3) >> 1;

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

function run(args, timeoutMs = 1800000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { e += d; });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, all: o + e }); });
  });
}

const diff = (a, b, n = FRAME) => {
  let max = 0, sum = 0, over16 = 0;
  const len = Math.min(n, a.length, b.length);
  for (let i = 0; i < len; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; if (d > 16) over16++; }
  return { max, mean: sum / len, over16: over16 / len };
};

/** PNG / 成片 → sRGB RGBA（自下而上，与引擎的读回同序）。 */
const ungrain = (p) => {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 });
  const row = RW * 4, out = Buffer.allocUnsafe(b.length);
  for (let y = 0; y < RH; y++) b.copy(out, y * row, (RH - 1 - y) * row, (RH - y) * row);
  return out;
};

const tmp = path.join(ROOT, 'out', TASK, '_determinism');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const rawA = path.join(tmp, 'a.nv12');
const rawB = path.join(tmp, 'b.nv12');
const stillDir = path.join(tmp, 'stills');
const mp4A = path.join(tmp, 'a.mp4');
const mp4B = path.join(tmp, 'b.mp4');

const total = Math.round(SECONDS * FPS);
console.log(`跨会话确定性复验  ${TASK}  ${SECONDS}s / ${total} 帧  samples=${SAMPLES}`);

console.log('\n[1/3] 会话 A：推流一遍，留下**原始 NV12 字节**（绕开编码器）…');
let r = await run(['video', TASK, '--from', '0', '--to', String(SECONDS), '--samples', SAMPLES,
  '--vcodec', 'h264_nvenc', '--cq', '19', '--out', mp4A, '--keep-raw', rawA]);
if (r.code !== 0) { console.log(r.all.split('\n').slice(-15).join('\n')); process.exit(1); }
const raw = readFileSync(rawA);
const nRaw = raw.length / FRAME;
say(nRaw === total, `raw 落了 ${nRaw} 帧（期望 ${total}）`);

console.log('\n[2/3] 会话 B：**另起一个会话**渲同一段，同样是 NV12 …');
r = await run(['video', TASK, '--from', '0', '--to', String(SECONDS), '--samples', SAMPLES,
  '--vcodec', 'h264_nvenc', '--cq', '19', '--out', mp4B, '--keep-raw', rawB]);
if (r.code !== 0) { console.log(r.all.split('\n').slice(-15).join('\n')); process.exit(1); }

console.log('\n[3/3] 帧起点 still（验 verify 的帧号口径）…');
const probs = [0, 15, 30, 45, 59].filter((k) => k < total);
r = await run(['still', TASK, '-t', probs.map((k) => (k / FPS).toFixed(6)).join(','),
  '--samples', SAMPLES, '--out', stillDir]);
if (r.code !== 0) { console.log(r.all.split('\n').slice(-15).join('\n')); process.exit(1); }

console.log('\n① 两个独立会话推给 ffmpeg 的 NV12 == 逐字节相同');
const dAB = diff(raw, readFileSync(rawB));
say(dAB.max === 0, `max ${dAB.max}  mean ${dAB.mean.toFixed(5)}${dAB.max === 0 ? '（逐字节一致）' : '  ← 跨会话不一致'}`);

console.log('\n② verify 的帧号抽帧口径：帧起点 still == 成片同一帧（NV12 空间；这里要过一次 CPU 参考实现，允许 ±1）');
const pngs = readdirSync(stillDir).filter((f) => f.endsWith('.png')).sort();
let bad2 = 0;
for (let i = 0; i < probs.length && i < pngs.length; i++) {
  const k = probs[i];
  const d = diff(raw.subarray(k * FRAME, (k + 1) * FRAME), cpuNV12(ungrain(path.join(stillDir, pngs[i])), RW, RH));
  // 判据分开看 max 与 mean：
  //   · "抽错了帧"（帧号/取时口径错）→ max ≈ 230（画面全变），这是要拦的；
  //   · CPU 参考实现的舍入 + 少量子帧差 → max ≤ 3、mean ≤ 2，肉眼不可见。
  const ok = d.max < 64;
  if (!ok) bad2++;
  console.log(`  第 ${String(k).padStart(3)} 帧  max ${String(d.max).padStart(3)}  mean ${d.mean.toFixed(3).padStart(7)}  >16 ${(d.over16 * 100).toFixed(3)}%${ok ? '' : '   ← 抽错了帧'}`);
}
say(bad2 === 0, `${Math.min(probs.length, pngs.length)} 个探针都抽到了正确的帧（max 全部 < 64）`);

console.log('\n③ 不同帧号必须不同（否则上面的"一致"没有意义）');
if (total > 2) {
  const d = diff(raw.subarray(0, FRAME), raw.subarray((total - 1) * FRAME, total * FRAME));
  say(d.mean > 0.5, `第 0 帧与第 ${total - 1} 帧确实不同（mean ${d.mean.toFixed(3)}）`);
}

console.log('\n④ 记录一条会骗人的性质（不是 bug）：**帧内取时偏一点，画面就不一样**');
const k0 = Math.min(30, total - 1);
const offDir = path.join(stillDir, 'off');
const off = await run(['still', TASK, '-t', `${(k0 / FPS).toFixed(6)},${((k0 + 0.5) / FPS).toFixed(6)}`,
  '--samples', SAMPLES, '--out', offDir]);
void off;
const offPngs = readdirSync(offDir).filter((f) => f.endsWith('.png')).sort();
if (offPngs.length === 2) {
  const d = diff(cpuNV12(ungrain(path.join(offDir, offPngs[0])), RW, RH),
                 cpuNV12(ungrain(path.join(offDir, offPngs[1])), RW, RH));
  console.log(`      t=${(k0 / FPS).toFixed(6)}（成片第 ${k0} 帧就是这么渲的）vs t=${((k0 + 0.5) / FPS).toFixed(6)}（帧中心）`);
  console.log(`      → 同一个帧号，画面差 mean ${d.mean.toFixed(3)}、>16 占 ${(d.over16 * 100).toFixed(2)}%`);
  console.log('      原因：引擎的采样时刻就是调用方给的 t，`samples>1` 时子帧窗跟着 t 走。');
  console.log('      半帧的偏移 → 运动模糊窗整体平移 → 看着像"跨会话不确定"，其实是探针取时错了。');
}

rmSync(tmp, { recursive: true, force: true });
console.log(fails
  ? `\n✗ ${fails} 项失败`
  : '\n✓ 全部通过：**同一 t 在任意会话里逐字节一致**（跨会话确定性成立），verify 的帧号口径可靠');
process.exit(fails ? 1 : 0);
