// 对照实验（不需要浏览器）：**推给 ffmpeg 的原始字节** vs 同一时刻重新渲染的那一帧。
//
// 为什么需要它：`verify` 只能拿编码后的成片比，而 h264 的色度二次采样在
// "480 根 2px 细竖线"这种高频画面上会让 mean 抬到 9、>16 占 8%。
// 那到底是"两条渲染路径不一样"还是"压缩损失"，光看成片分不出来。
// 把编码器摘掉、直接比 RGBA，就能一刀切开。
//
//   node tools/probe-stream-raw.mjs out/beat/_raw.rgba out/beat/_cmp/f_0000.508.png 30
//     argv[2] raw 文件、argv[3] 浏览器出图、argv[4] 帧号
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [rawFile, pngFile, idxStr] = process.argv.slice(2);
if (!rawFile || !pngFile) {
  console.error('用法：node tools/probe-stream-raw.mjs <raw.rgba> <still.png> <帧号>');
  process.exit(2);
}
const W = 1920, H = 1080, FS = W * H * 4;
const idx = Number(idxStr ?? '0');

if (!existsSync(rawFile)) { console.error('没有 ' + rawFile + '（先跑 video --keep-raw）'); process.exit(1); }
const raw = readFileSync(rawFile);
const nFrames = raw.length / FS;
console.log(`raw ${path.basename(rawFile)}：${raw.length} 字节 = ${nFrames} 帧`);

// raw 里的像素是**自下而上**（readPixels 原生顺序）；ffmpeg 的 rawvideo 也是自下而上输出，
// 所以这里直接用。PNG 是自上而下，要比就得翻一次。
const browserTopDown = execFileSync('ffmpeg', ['-v', 'error', '-i', pngFile, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 });
const flip = (b) => {
  const row = W * 4, out = Buffer.allocUnsafe(b.length);
  for (let y = 0; y < H; y++) b.copy(out, y * row, (H - 1 - y) * row, (H - y) * row);
  return out;
};
const browser = flip(browserTopDown);

const diff = (a, b) => {
  let max = 0, sum = 0, over16 = 0, nn = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; sum += d; if (d > 16) over16++; nn++; }
  return { max, mean: sum / nn, over16: over16 / nn };
};

let best = null;
for (const k of [idx - 1, idx, idx + 1].filter((k) => k >= 0 && k < nFrames)) {
  const d = diff(raw.subarray(k * FS, (k + 1) * FS), browser);
  console.log(`  raw 第 ${String(k).padStart(3)} 帧 vs 浏览器 t 那一帧：max ${d.max}  mean ${d.mean.toFixed(3)}  >16 ${(d.over16 * 100).toFixed(3)}%`);
  if (!best || d.mean < best.d.mean) best = { k, d };
}
const ok = best.d.mean < 0.5;
console.log(ok
  ? `\n✓ 原始字节一致（raw 第 ${best.k} 帧，mean ${best.d.mean.toFixed(3)}）→ **渲染是确定的**，` +
    `verify 的差异全部来自 h264 编码，不是引擎的跨帧依赖。`
  : `\n✗ 原始字节就不一样（最接近的 raw 第 ${best.k} 帧 mean ${best.d.mean.toFixed(3)}）→ 真的是两条渲染路径不同。`);
