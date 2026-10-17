// ⚠ 这个脚本原来住在 `out/_postlab/` —— `out/**` 不在版本控制里，清磁盘时迟早会被一起扫掉，
//    所以 2026-10-16 搬进 `tools/`（只改路径解析：默认仍读 `out/_postlab`，可用环境变量 `POSTLAB` 覆盖）。
//
// 配套夹具是 `tasks/_post-lab/`：同一张测试卡、10 段每段换一个 post 参数（三种高光算子 / 两种抖动分布 /
// Karis 开关 / 三种曝光补偿）。复现（帧要按下面的目录摆好，脚本按文件名读）：
//   node scripts/anim.mjs still _post-lab -t 1.5,4.5,7.5,10.5,13.5,16.5,19.5 -o out/_postlab/ab
//   node scripts/anim.mjs still _post-lab -t 22.5,25.5,28.5 -o out/_postlab/ab2
// 然后跑本脚本；读数打在 stdout，对比图落在 out/_postlab/。
// 它不进 regress-all：要 Chrome、要先把帧渲出来，属于**手动量具**（BACKLOG 0-6 用得上）。
// 第二组对比：同一张测试卡，换高光算子 + 曝光补偿之后，高光层次与暗部黑位各是什么样。
// 用法：node tools/probe-post-ab2.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 4332;
const SET = [
  { dir: 'ab', file: 'f_0001.500.png', label: '现状（shoulder 0.85）' },
  { dir: 'ab2', file: 'f_0022.500.png', label: 'shoulder 0.60' },
  { dir: 'ab2', file: 'f_0025.500.png', label: 'AgX + exp 0.75' },
  { dir: 'ab2', file: 'f_0028.500.png', label: 'ACES + exp 0.85' },
];
const ROOT = path.resolve(process.env.POSTLAB ?? 'out/_postlab');

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset="utf-8"><body>'); }
  const f = path.resolve(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(d);
  });
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });

const data = await page.evaluate(async (set) => {
  const load = (src) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load failed: ' + src)); i.src = src;
  });
  const out = {};
  for (const p of set) {
    const img = await load(`/${p.dir}/${p.file}`);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    const steps = [];
    // 每一级取中心，并且报告该级内部是否"平了"（max-min==0 说明整块同值 = 已经 clip）
    const flat = [];
    for (let i = 0; i < 12; i++) {
      const x0 = 70 + i * 148, y0 = 360;
      steps.push(at(x0 + 66, y0 + 85)[0]);
      const px = g.getImageData(x0 + 8, y0 + 8, 116, 154).data;
      let mn = 255, mx = 0;
      for (let k = 0; k < px.length; k += 4) { mn = Math.min(mn, px[k]); mx = Math.max(mx, px[k]); }
      flat.push(mx - mn);
    }
    const strip = g.getImageData(200, 60, 1200, 1).data;
    let mn = 999, mx = -1, sum = 0;
    for (let x = 0; x < 1200; x++) { const v = strip[x * 4]; mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v; }
    const cw = img.width / 7;
    const hue = [];
    for (let i = 0; i < 7; i++) hue.push(at(Math.round(i * cw + cw / 2), 242));
    out[p.label] = { steps, flat, dark: { mn, mx, mean: +(sum / 1200).toFixed(1) }, hue };
  }
  return out;
}, SET);

await browser.close();
server.close();

const keys = SET.map((s) => s.label);
const W = 17;
console.log('\n【高光层次】每一级的输出值 / 该级内部的极差（极差 0 = 整块同色 = 已经并到纯白）');
console.log('输入'.padEnd(9) + keys.map((k) => k.padEnd(W)).join(''));
for (let i = 0; i < 12; i++) {
  const v = Math.pow(2, i - 4);
  console.log(String(v).padEnd(9) + keys.map((k) => {
    const d = data[k];
    return `${d.steps[i]}${d.flat[i] === 0 ? '(平)' : `(±${d.flat[i]})`}`.padEnd(W);
  }).join(''));
}

console.log('\n【暗部黑位】渐变带实测（现状 53..90 / 均值 75.2）');
for (const k of keys) {
  const d = data[k].dark;
  console.log('  ' + k.padEnd(20) + `范围 ${String(d.mn).padStart(3)}..${String(d.mx).padStart(3)}   均值 ${d.mean}`);
}

console.log('\n【霓虹饱和度】七个色块中心（越高越艳，全部 255 说明并到白）');
const names = ['红', '橙', '黄', '绿', '青', '蓝紫', '洋红'];
for (let i = 0; i < 7; i++) {
  console.log(names[i].padEnd(5) + keys.map((k) => data[k].hue[i].join(',').padEnd(W)).join(''));
}
console.log('\n上排数字越大越接近纯白；「平」= 该级已无层次。');
