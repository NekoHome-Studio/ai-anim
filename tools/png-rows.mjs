// 直接量 PNG：逐行统计亮度，看那根 80px 白带子到底在不在、在哪一行。
// 用法：node tools/png-rows.mjs <png 路径> [x列]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2];
const colArg = Number(process.argv[3] ?? -1);
if (!file) { console.error('用法: node tools/png-rows.mjs <png> [x列]'); process.exit(2); }

// 用 ffmpeg 把 PNG 转成裸 RGBA（避免引入图片解码依赖），并**从 ffprobe 读出真实尺寸**
const ffe = process.env.ANIM_FFMPEG || 'ffmpeg';
const probe = execFileSync(process.env.ANIM_FFPROBE || 'ffprobe',
  ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
  { encoding: 'utf8' }).trim().split(',').map(Number);
const w = probe[0], h = probe[1];
const raw = execFileSync(ffe,
  ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
  { maxBuffer: 1 << 30 });

const lumAt = (x, y) => {
  const i = (y * w + x) * 4;
  return (raw[i] * 0.2126 + raw[i + 1] * 0.7152 + raw[i + 2] * 0.0722) / 255;
};

console.log(`文件：${path.relative(ROOT, file)}  ${w}×${h}  ${raw.length} 字节（期望 ${w * h * 4}）`);
// 全图统计
let max = 0, maxAt = null, bright = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const v = lumAt(x, y);
  if (v > max) { max = v; maxAt = [x, y]; }
  if (v > 0.5) bright++;
}
console.log(`最亮 ${max.toFixed(3)} @ ${JSON.stringify(maxAt)}   亮度>0.5 的像素 ${bright}`);

const cols = colArg >= 0 ? [colArg] : [900, 960, 300];
for (const c of cols) {
  const bands = [];
  let cur = null;
  for (let y = 0; y < h; y++) {
    const on = lumAt(c, y) > 0.5;
    if (on && !cur) cur = { y0: y, y1: y };
    else if (on) cur.y1 = y;
    else if (!on && cur) { bands.push(cur); cur = null; }
  }
  if (cur) bands.push(cur);
  console.log(`  x=${c} 列上亮度>0.5 的 y 区间：${bands.map((b) => `${b.y0}–${b.y1}（高 ${b.y1 - b.y0 + 1}）`).join('  ') || '(无)'}`);
}
