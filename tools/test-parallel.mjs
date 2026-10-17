// P2-1 回归：`video --parallel N` 的产物必须与串行版**帧数一致、时间戳一致、画面一致**。
//
// 背景（docs/history/IMPROVEMENTS-1-3.md P2-1）：并行渲染实测 2 进程 1.81×、3 进程 2.3×，
// 但手工做有两个坑：切点只能落在"下一段转场已结束"处；自己 concat mp4 必须 `-copyts`，
// 否则整条视频被推后 0.022982s（B 帧 CTS 偏移），帧号与时间戳错位。
// 这个脚本把两条路都跑一遍再比，判据是机械的：
//   ① 帧数一致（ffprobe -count_frames 逐帧数，不看容器头）
//   ② 首帧 PTS = 0.000000、平均帧率 = 60/1、duration 精确
//   ③ 逐帧 PSNR —— libx264 是确定性编码器，同参数下应当**极高**（实测 56.5 dB，
//      差异只来自各段独立 GOP 在接缝处的重置）
//
//   node tools/test-parallel.mjs [任务] [秒数]
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = process.argv[2] ?? 'demo';
const SECONDS = Number(process.argv[3] ?? '6');
const DIR = path.join(ROOT, 'out', TASK, '_parallel-test');

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

function run(args, timeoutMs = 2400000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { o += d; });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, all: o }); });
  });
}

/** ffprobe 读数（⚠ Windows 上的输出带 `\r`；⚠ 帧数必须**单独**查，
 *  混在同一个命令里会被 `-read_intervals %+#4` 把 `nb_read_frames` 也截成 4）。 */
async function probe(file) {
  const call = (args) => new Promise((resolve) => {
    const p = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    p.stdout.on('data', (d) => { o += d; });
    p.on('close', () => resolve(o));
  });
  const meta = await call(['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=avg_frame_rate,duration,nb_read_frames,r_frame_rate', '-of', 'default=nw=1', file]);
  const pk = await call(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time',
    '-of', 'default=nw=1', '-read_intervals', '%+#6', file]);
  const get = (s, k) => (new RegExp(`${k}=([^\\r\\n]+)`).exec(s) ?? [])[1] ?? null;
  const pts = [...new Set(pk.split('\n').map((s) => Number(s.trim().replace(/^[^=]*=/, ''))).filter(Number.isFinite))].sort((a, b) => a - b);
  return {
    frames: Number(get(meta, 'nb_read_frames')),
    avg: get(meta, 'avg_frame_rate'),
    duration: Number(get(meta, 'duration')),
    pts,
  };
}

function psnr(a, b) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi',
      '[0:v]setpts=PTS-STARTPTS[x];[1:v]setpts=PTS-STARTPTS[y];[x][y]psnr', '-f', 'null', '-'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    let e = '';
    p.stderr.on('data', (d) => { e += d; });
    p.on('close', () => resolve(Number((/average:([\d.]+|inf)/.exec(e) ?? [])[1] ?? NaN)));
  });
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
const par = path.join(DIR, 'par.mp4');
const ser = path.join(DIR, 'ser.mp4');
// libx264 是确定性编码器 —— 这样"画面差异"只可能来自渲染/拼接，不掺编码器噪声
const ENC = ['--samples', '1', '--noaudio', '--vcodec', 'libx264', '--crf', '16', '--preset', 'veryfast'];

try {
  console.log(`并行验收 ${TASK}  0→${SECONDS}s`);
  console.log('\n[1/2] 串行 …');
  let r = await run(['video', TASK, '--from', '0', '--to', String(SECONDS), ...ENC, '--out', ser]);
  if (r.code !== 0) { console.log(r.all.split('\n').slice(-15).join('\n')); process.exit(1); }
  console.log('[2/2] 并行 2 段 …');
  r = await run(['video', TASK, '--from', '0', '--to', String(SECONDS), '--parallel', '2', ...ENC, '--out', par]);
  if (r.code !== 0) { console.log(r.all.split('\n').slice(-15).join('\n')); process.exit(1); }

  const a = await probe(ser), b = await probe(par);
  console.log(`\n  串行：${a.frames} 帧  avg ${a.avg}  duration ${a.duration}  首帧 PTS ${a.pts[0]}`);
  console.log(`  并行：${b.frames} 帧  avg ${b.avg}  duration ${b.duration}  首帧 PTS ${b.pts[0]}`);

  say(a.frames === b.frames, `帧数一致（${a.frames} vs ${b.frames}）`);
  say(b.pts[0] === 0, `并行版首帧 PTS = ${b.pts[0]}（期望 0.000000）`);
  say(b.avg === '60/1', `并行版平均帧率 = ${b.avg}（期望 60/1；不是 60/1 说明接缝处时间戳漂了）`);
  say(Math.abs(b.duration - SECONDS) < 0.002, `并行版 duration = ${b.duration}（期望 ${SECONDS}）`);
  const p = await psnr(par, ser);
  say(p > 45 || p === Infinity, `逐帧 PSNR ${p}（libx264 同参数；>45 即"画面上是同一支片子"）`);
  const sz = statSync(par).size;
  say(sz > 1024, `并行产物 ${(sz / 1048576).toFixed(1)} MB`);
} finally {
  rmSync(DIR, { recursive: true, force: true });
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过：并行版与串行版帧数/时间戳/画面一致');
process.exit(fails ? 1 : 0);
