// P0-1 回归测试：**ffmpeg 背压不能被误判成「渲染停滞」**，产物必须完整。
//
// 背景（docs/IMPROVEMENTS.md P0-1，本轮最贵的一个坑）：
//   CLI 用「停发 ack」做背压 —— ffmpeg 一慢，`stdin.write()` 返回 false，我们就不回 ack，
//   页面（发一帧等一个 ack）自然停下来等。可旧看门狗的续命判据是「页面侧的 sent 在涨」，
//   而页面**正在等 ack**，sent 当然不涨 → 判「停滞」→ 收工 → `stdin.end()` →
//   ffmpeg 拿到半截流、永远不写 moov → 产物是个打不开的 mp4，而 CLI 报 ✓。
//
// 怎么稳定复现「ffmpeg 很慢」：`tools/slow-ffmpeg.mjs`（把 ffmpeg 的输入读慢 N 毫秒/块）。
// 不用真编码器是因为 -preset veryslow 在 1080p 下只有 3.4 fps，跑一次要一分钟、断言还抖。
//
// 断言：
//   ① CLI 退出码 0（没有被误判成停滞）
//   ② 日志里**没有**「渲染停滞 / 等 ffmpeg 排水超时」
//   ③ 背压真的发生过（日志里出现过"背压中"）
//   ④ ffprobe 数出的帧数 == 时长 × fps，且能打开（moov 存在）
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = process.argv[2] ?? 'demo';
const SECONDS = Number(process.argv[3] ?? 3);
const FPS = Number(process.argv[4] ?? 30);
const READ_MBPS = Number(process.argv[5] ?? 6);
const OUT = path.join(ROOT, 'out', TASK, 'smoke-backpressure.mp4');
const WRAPPER = path.join(ROOT, 'tools', 'slow-ffmpeg.mjs');

if (existsSync(OUT)) rmSync(OUT);

const args = [
  path.join(ROOT, 'scripts', 'anim.mjs'), 'shot', TASK,
  '--from', '0', '--to', String(SECONDS), '--fps', String(FPS),
  '--samples', '1', '--noaudio',
  '--idle', '1',                                // 远小于一次正常排水时间
  '--finalize', '120',
  '-o', path.relative(ROOT, OUT),
];
console.log(`$ ANIM_FFMPEG="node tools/slow-ffmpeg.mjs" ANIM_SLOW_MBPS=${READ_MBPS} node ${args.slice(1).join(' ')}`);
const child = spawn(process.execPath, args, {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    // 用包装器把 ffmpeg 的输入限速，稳定复现背压（见 tools/slow-ffmpeg.mjs）。
    // ⚠ node 的路径要加引号：它常常在 "C:\Program Files\..." 这种带空格的目录下。
    ANIM_FFMPEG: `"${process.execPath}" "${WRAPPER}"`,
    ANIM_SLOW_MBPS: String(READ_MBPS),
  },
});
let out = '';
let err = '';
child.stdout.on('data', (d) => { out += String(d); });
child.stderr.on('data', (d) => { err += String(d); });
const code = await new Promise((r) => child.on('close', r));
const all = out + err;

const expectedFrames = Math.round(SECONDS * FPS);
let frames = null;
let probeErr = '';
try {
  const probe = spawn('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames,duration', '-of', 'json', OUT], { stdio: ['ignore', 'pipe', 'pipe'] });
  let s = '';
  probe.stdout.on('data', (d) => { s += String(d); });
  probe.stderr.on('data', (d) => { probeErr += String(d); });
  await new Promise((r) => probe.on('close', r));
  try { frames = Number(JSON.parse(s).streams[0].nb_read_frames); } catch { frames = null; }
} catch (e) { probeErr = String(e); }

const okCode = code === 0;
const notStalled = !/渲染停滞|等 ffmpeg 排水超时/.test(all);
const sawBackpressure = /背压中/.test(all);
const framesOk = frames === expectedFrames;

console.log('--- stdout ---\n' + out.trim());
console.log('--- stderr ---\n' + err.trim());
if (frames === null) console.log(`--- ffprobe 读不出帧数 ---\n${probeErr.trim()}`);
console.log(`\n退出码 ${code}（期望 0）  → ${okCode ? 'PASS' : 'FAIL'}`);
console.log(`没有被误判成停滞  → ${notStalled ? 'PASS' : 'FAIL'}${notStalled ? '' : '（日志里出现了「渲染停滞/排水超时」）'}`);
console.log(`真的发生了背压  → ${sawBackpressure ? 'PASS' : 'FAIL'}${sawBackpressure ? '' : '（没逼出背压，本次结论不算数）'}`);
console.log(`产物可打开且帧数正确：ffprobe ${frames ?? '(读不出)'} / 期望 ${expectedFrames}  → ${framesOk ? 'PASS' : 'FAIL'}`);
process.exit(okCode && notStalled && framesOk && sawBackpressure ? 0 : 1);
