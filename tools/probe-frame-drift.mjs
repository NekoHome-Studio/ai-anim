// 逐帧对照：推流落到盘上的**原始字节** vs 同一时刻在**另一个会话**里渲的那一帧。
//
// ⚠ 两边格式不同、要过一次转换：`--keep-raw` 落的是推给 ffmpeg 的 **NV12**
//   （2026-10 起推流就是 NV12，见 docs/PERF.md §5.4a），而 `dumpframes` 落的是浏览器读回的
//   **sRGB RGBA**。所以这里用 `tools/lib/nv12-ref.mjs`（与 GPU 侧同一套公式）把后者转成 NV12
//   再逐字节比 —— 允许 ±1（CPU 参考实现拿的是 8bit 量化后的 sRGB）。
//
// 用法：
//   1) node scripts/anim.mjs video <任务> --from 0 --to 1 --samples 2 --out x.mp4 --keep-raw out/x.nv12
//   2) node scripts/anim.mjs dumpframes <任务> --from 0 --to 1 --samples 2 --out out/x_frames
//   3) node tools/probe-frame-drift.mjs out/x.nv12 out/x_frames
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cpuNV12, nv12Bytes } from './lib/nv12-ref.mjs';

const [rawFile, dir] = process.argv.slice(2);
const RW = 1920, RH = 1080;
const W = nv12Bytes(RW, RH);
const raw = readFileSync(rawFile);
const files = readdirSync(dir).filter((f) => f.endsWith('.rgba')).sort();
console.log(`${rawFile}: ${raw.length / W} 帧 NV12   ${dir}: ${files.length} 帧 RGBA`);

let bad = 0;
for (const f of files) {
  const t = Number(/t([\d.]+)\.rgba$/.exec(f)[1]);
  const k = Math.round(t * 60);
  const a = raw.subarray(k * W, (k + 1) * W);
  const b = cpuNV12(readFileSync(path.join(dir, f)), RW, RH);
  let sum = 0, mx = 0, o16 = 0;
  for (let i = 0; i < W; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > mx) mx = d; if (d > 16) o16++; }
  const mean = sum / W;
  if (mean > 0.5 || mx > 1) bad++;
  console.log(`  第 ${String(k).padStart(3)} 帧  mean ${mean.toFixed(4).padStart(9)}  max ${String(mx).padStart(3)}  >16 ${((o16 / W) * 100).toFixed(3)}%${mean > 0.5 || mx > 1 ? '   ← 不一致' : ''}`);
}
console.log(bad ? `\n✗ ${bad}/${files.length} 帧的原始字节不一致` : `\n✓ ${files.length} 帧的原始字节全部一致（±1 舍入以内）`);
