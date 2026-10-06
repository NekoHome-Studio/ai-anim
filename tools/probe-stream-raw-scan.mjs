// 用一批浏览器出图去**全量扫描** raw 帧，找出真实的帧映射。
//
//   node tools/probe-stream-raw-scan.mjs out/beat/_raw.rgba out/beat/_cmp/*.png
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const W = 1920, H = 1080, FS = W * H * 4;
const [rawFile, ...pngs] = process.argv.slice(2);
const raw = readFileSync(rawFile);
const nFrames = raw.length / FS;
console.log(`raw：${nFrames} 帧`);

const flip = (b) => {
  const row = W * 4, out = Buffer.allocUnsafe(b.length);
  for (let y = 0; y < H; y++) b.copy(out, y * row, (H - 1 - y) * row, (H - y) * row);
  return out;
};

for (const png of pngs) {
  const b = flip(execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 29 }));
  // 粗指纹：每 16 像素取一个 —— 与 app.js 的 probe 同一个思路
  const sig = (buf) => { let h = 0x811c9dc5; for (let i = 0; i < buf.length; i += 64) h = Math.imul(h ^ buf[i], 16777619) >>> 0; return h >>> 0; };
  const target = sig(b);
  const hits = [];
  for (let k = 0; k < nFrames; k++) if (sig(raw.subarray(k * FS, (k + 1) * FS)) === target) hits.push(k);
  console.log(`${path.basename(png)}  粗指纹 ${target.toString(16).padStart(8, '0')}  → raw 里命中帧号 [${hits.join(', ') || '无'}]`);
  if (!hits.length) {
    // 没有完全命中就找最接近的几帧
    let best = [];
    for (let k = 0; k < nFrames; k++) {
      let s = 0;
      const off = k * FS;
      for (let i = 0; i < b.length; i += 64) s += Math.abs(raw[off + i] - b[i]);
      best.push({ k, s });
    }
    best.sort((x, y) => x.s - y.s);
    console.log(`    最接近：${best.slice(0, 4).map((x) => `#${x.k}(Δ${x.s})`).join('  ')}`);
  }
}
