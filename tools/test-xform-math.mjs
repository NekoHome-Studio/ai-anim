// 校验 engine.js 的 xformMatrix：shader 用它采样时，画面内容必须正好落在
// 「逻辑像素空间里做正向变换」应该在的位置。
//
// 判据（这是唯一正确的语义）：
//   设正向变换把逻辑点 P 映射到 P'，则**输出**像素 P' 处采到的应该是**源图** P 处的内容。
//   即 uv(P') --M--> uv(P)。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(ROOT, 'src', 'core', 'engine.js'), 'utf8');
const start = src.indexOf('export function xformForward');
const end = src.indexOf('function isIdentityXform');
if (start < 0 || end < 0) { console.error('抠不出 xform 函数'); process.exit(2); }
const body = src.slice(start, end).replaceAll('export function', 'function');
const { xformMatrix, xformForward } = new Function(`${body}; return { xformMatrix, xformForward };`)();

const W = 1920, H = 1080;
const gl = { w: W, h: H };
const mul = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];
const toUv = (x, y) => [x / W, 1 - y / H];
const toPx = (u, v) => [u * W, (1 - v) * H];

function forward(xf, p) {           // 用独立实现算一遍正向变换（不依赖被测代码）
  const anchor = xf.anchor ?? [W / 2, H / 2];
  const c = Math.cos(xf.rot ?? 0), s = Math.sin(xf.rot ?? 0), k = xf.scale ?? 1;
  const dx = p[0] - anchor[0], dy = p[1] - anchor[1];
  return [anchor[0] + (dx * c - dy * s) * k + xf.x, anchor[1] + (dx * s + dy * c) * k + xf.y];
}

const cases = [
  { name: '平移 (+120, -60)', xf: { x: 120, y: -60, scale: 1, rot: 0 } },
  { name: '绕中心缩放 1.3', xf: { x: 0, y: 0, scale: 1.3, rot: 0 } },
  { name: '绕左上角缩放 0.7', xf: { x: 0, y: 0, scale: 0.7, rot: 0, anchor: [0, 0] } },
  { name: '锚点 (300,800) 缩放 1.15 + 位移', xf: { x: -40, y: 25, scale: 1.15, rot: 0, anchor: [300, 800] } },
  { name: '旋转 0.35 + 缩放 0.9', xf: { x: 10, y: 10, scale: 0.9, rot: 0.35 } },
  { name: '旋转 -0.8 + 位移 + 缩放 1.4', xf: { x: 200, y: -150, scale: 1.4, rot: -0.8, anchor: [1720, 980] } },
];

let worst = 0;
for (const { name, xf } of cases) {
  const m = xformMatrix(gl, xf);
  // 自检：xformForward 与独立实现必须一致
  const fwd = xformForward(W, H, xf);
  let fwdErr = 0;
  for (const p of [[0, 0], [960, 540], [W, H]]) {
    const got = mul(fwd, [p[0], p[1], 1]);
    const exp = forward(xf, p);
    fwdErr = Math.max(fwdErr, Math.abs(got[0] - exp[0]), Math.abs(got[1] - exp[1]));
  }
  // 主判据：uv(P') 经采样矩阵必须回到 uv(P)
  let maxErr = 0;
  for (const p of [[0, 0], [W, 0], [0, H], [W, H], [300, 800], [960, 540], [1720, 980], [123, 456], [1500, 200]]) {
    const pp = forward(xf, p);
    const su = mul(m, [...toUv(pp[0], pp[1]), 1]);
    const back = toPx(su[0] / su[2], su[1] / su[2]);
    maxErr = Math.max(maxErr, Math.abs(back[0] - p[0]), Math.abs(back[1] - p[1]));
  }
  worst = Math.max(worst, maxErr, fwdErr);
  console.log(`  ${name.padEnd(30)} 正向 ${fwdErr.toExponential(1)} px  采样往返 ${maxErr.toExponential(1)} px  ${(maxErr < 1e-9 && fwdErr < 1e-9) ? 'PASS' : 'FAIL'}`);
}
console.log(`\n最大误差 ${worst.toExponential(2)} px → ${worst < 1e-9 ? 'PASS ✓ 采样方向正确（输出点采到源点内容）' : 'FAIL ✗'}`);
process.exit(worst < 1e-9 ? 0 : 1);
