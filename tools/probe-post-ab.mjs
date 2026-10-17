// ⚠ 这个脚本原来住在 `out/_postlab/` —— `out/**` 不在版本控制里，清磁盘时迟早会被一起扫掉，
//    所以 2026-10-16 搬进 `tools/`（只改路径解析：默认仍读 `out/_postlab`，可用环境变量 `POSTLAB` 覆盖）。
//
// 配套夹具是 `tasks/_post-lab/`：同一张测试卡、10 段每段换一个 post 参数（三种高光算子 / 两种抖动分布 /
// Karis 开关 / 三种曝光补偿）。复现（帧要按下面的目录摆好，脚本按文件名读）：
//   node scripts/anim.mjs still _post-lab -t 1.5,4.5,7.5,10.5,13.5,16.5,19.5 -o out/_postlab/ab
//   node scripts/anim.mjs still _post-lab -t 22.5,25.5,28.5 -o out/_postlab/ab2
// 然后跑本脚本；读数打在 stdout，对比图落在 out/_postlab/。
// 它不进 regress-all：要 Chrome、要先把帧渲出来，属于**手动量具**（BACKLOG 0-6 用得上）。
// 后处理 A/B 对比：把 _post-lab 的帧读进浏览器 canvas，量关键区域的数值 + 出一张放大对比图。
// 用法：node tools/probe-post-ab.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DIR = path.resolve(process.env.POSTLAB ?? 'out/_postlab', 'ab');
const OUT = path.resolve(process.env.POSTLAB ?? 'out/_postlab');
const PORT = 4331;
const F = (t) => `f_${t.toFixed(3).padStart(8, '0')}.png`;   // CLI 落盘是 f_0001.500.png（补零到 8 位）

const PAGES = [
  { key: 'tone_off', file: F(1.5), label: 'tonemap OFF（现状）' },
  { key: 'tone_agx', file: F(4.5), label: 'tonemap AgX' },
  { key: 'tone_aces', file: F(7.5), label: 'tonemap ACES' },
  { key: 'dith_rpdf', file: F(10.5), label: 'dither rpdf（现状）' },
  { key: 'dith_tpdf', file: F(13.5), label: 'dither TPDF' },
  { key: 'karis_off', file: F(16.5), label: 'bloomKaris OFF（现状）' },
  { key: 'karis_on', file: F(19.5), label: 'bloomKaris ON' },
];

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
  const f = path.resolve(path.join(DIR, p));
  if (!f.startsWith(DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(d);
  });
});

// 页面：每张图放两个放大裁剪（霓虹+阶梯 / 亮点），外加隐藏的 canvas 供读数
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0b0e;font:13px system-ui;color:#c8d0e0">
${PAGES.map((p) => `
<div style="display:flex;gap:10px;padding:8px 10px;border-bottom:1px solid #1b1f28;align-items:flex-start">
  <div style="width:180px;padding-top:6px;font-weight:600">${p.label}</div>
  <div style="width:600px;height:250px;overflow:hidden;position:relative;background:#000">
    <img src="/${p.file}" style="position:absolute;width:2400px;height:1350px;left:-125px;top:-190px">
  </div>
  <div style="width:300px;height:250px;overflow:hidden;position:relative;background:#000">
    <img src="/${p.file}" style="position:absolute;width:3000px;height:1687px;left:-1300px;top:-800px">
  </div>
  <div style="width:220px;height:250px;overflow:hidden;position:relative;background:#000">
    <img src="/${p.file}" style="position:absolute;width:3600px;height:2025px;left:-1650px;top:-1050px">
  </div>
</div>`).join('')}
</body>`;

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1330, height: 300 * PAGES.length + 20 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// 数值：把每张图读进 canvas，采样亮度阶梯每一级的中心 + 霓虹块中心 + 亮点
const data = await page.evaluate(async (pages) => {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load failed: ' + src)); i.src = src; });
  const out = {};
  for (const p of pages) {
    const img = await load('/' + p.file);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    // 亮度阶梯：12 级，每级 x = 70 + i*148 + 66（中心），y = 360+85
    const steps = [];
    for (let i = 0; i < 12; i++) steps.push(at(70 + i * 148 + 66, 445)[0]);
    // 霓虹块：7 色，中心
    const hue = [];
    const cw = img.width / 7;
    for (let i = 0; i < 7; i++) hue.push(at(Math.round(i * cw + cw / 2), 242));
    // 亮点周围（8×8 区域的中心）
    const dot = at(960, 624);
    // 暗部渐变：一段横切，统计不同灰度级的数量（banding 指标）
    const strip = g.getImageData(200, 60, 1200, 1).data;
    const lv = new Set(); let mn = 999, mx = -1, sum = 0;
    for (let x = 0; x < 1200; x++) {
      const v = strip[x * 4];
      lv.add(v); mn = Math.min(mn, v); mx = Math.max(mx, v); sum += v;
    }
    out[p.key] = { steps, hue, dot, rampLevels: lv.size, rampMin: mn, rampMax: mx, rampMean: +(sum / 1200).toFixed(2) };
  }
  return out;
}, PAGES);

await page.screenshot({ path: path.join(OUT, 'ab-visual.png') });
await browser.close();
server.close();

// ── 打印 ──
const show = (keys) => {
  console.log('\n亮度阶梯（输入 2^-4 … 2^7，输出 0..255）');
  console.log('级'.padEnd(6) + '输入'.padEnd(10) + keys.map((k) => k.padEnd(12)).join(''));
  for (let i = 0; i < 12; i++) {
    const v = Math.pow(2, i - 4);
    console.log(String(i).padEnd(6) + String(v).padEnd(10) + keys.map((k) => String(data[k].steps[i]).padEnd(12)).join(''));
  }
  console.log('\n霓虹块中心像素（R,G,B 0..255）');
  const names = ['红', '橙', '黄', '绿', '青', '蓝紫', '洋红'];
  for (let i = 0; i < 7; i++) {
    console.log(names[i].padEnd(6) + keys.map((k) => (data[k].hue[i].join(',')).padEnd(18)).join(''));
  }
  console.log('\n暗部渐变横切：不同灰度级数 / 范围 / 均值（级数越多 = 过渡越连续）');
  for (const k of keys) {
    const d = data[k];
    console.log('  ' + k.padEnd(12) + `级数 ${String(d.rampLevels).padStart(3)}   范围 ${d.rampMin}..${d.rampMax}   均值 ${d.rampMean}`);
  }
  console.log('\n极亮小点（8×8，线性 60 → 输出）');
  for (const k of keys) console.log('  ' + k.padEnd(12) + data[k].dot.join(','));
};

console.log('=== tonemap ===');
show(['tone_off', 'tone_agx', 'tone_aces']);
console.log('\n=== dither ===');
show(['dith_rpdf', 'dith_tpdf']);
console.log('\n=== bloomKaris ===');
show(['karis_off', 'karis_on']);
console.log(`\n对比图：${path.join(OUT, 'ab-visual.png')}`);
