#!/usr/bin/env node
// @ts-check
/**
 * 风格包 + 字幕层的**纯逻辑**回归（不需要 GPU / 浏览器，几毫秒跑完）。
 *
 *   node tools/test-style.mjs
 *
 * 为什么这份测试值得存在：风格系统改的是**每一支片子的观感**，而它有一条不能破的底线 ——
 * **不写 `style` 的老任务必须一个像素都不变**（验收命令是 `anim hashes <任务> --baseline`）。
 * 那条底线在像素层面靠 hashes 守，但在逻辑层面就是这里断言的几件事：
 * `resolveStyle({})` 的 `palette` / `fonts` / `post` 必须是**空对象** ——
 * 只要有人给 `print` 加了一个色值，全仓库所有老片子的画面就一起变了。
 *
 * 另外还钉住字幕层的两条语义（`docs/CAPTIONS.md`）：
 *   · 默认**关**（`resolveCaptionStyle(null, null) === false`）—— 老任务不该凭空多出字幕；
 *   · 字幕带落在 `style.grid.captionBand` 里，且 x 只占中间那一段（不是整幅宽度）。
 */

import { STYLES, resolveStyle, listStyles, gridFor, GRID_BASE } from '../src/style/index.js';
import { resolveCaptionStyle, DEFAULT_CAPTION_STYLE, makeCaptionLayer } from '../src/core/captions.js';
import { makeNarration, makeNarrationReader } from '../src/core/narration.js';
import { makePalette } from '../src/core/palette.js';

let fail = 0;
let pass = 0;
/** @param {boolean} cond @param {string} msg */
function ok(cond, msg) {
  if (cond) { pass++; console.log(`✓ ${msg}`); } else { fail++; console.error(`✗ ${msg}`); }
}
/** @param {string} msg */
function section(msg) { console.log(`\n── ${msg} ──`); }

/* ---------------------------------------------------------------- 风格包 */

section('风格包：底线（老任务零变化）');
const def = resolveStyle({});
ok(def.name === 'print', '不写 style → print');
ok(Object.keys(def.palette).length === 0, 'print 的 palette 是空的（= 引擎 DEFAULT_PALETTE）');
ok(Object.keys(def.fonts).length === 0, 'print 的 fonts 是空的（= text.js 的 FAMILIES）');
ok(Object.keys(def.post).length === 0, 'print 的 post 是空的（= 镜头模板自己的 post 不变）');
ok(def.captions === false, 'print 默认**不开**字幕（老任务不会凭空多出字幕）');
ok(resolveStyle(false) === null, 'style: false → 显式关掉风格系统（返回 null）');

section('风格包：清单与形状');
const all = listStyles();
ok(all.length >= 5, `至少 5 套风格（实测 ${all.length} 套：${all.map((s) => s.name).join(' / ')}）`);
for (const [name, s] of Object.entries(STYLES)) {
  ok(!!s.label && !!s.note, `${name} 有 label 与 note（CLI/文档要读）`);
  ok(!!s.motif, `${name} 声明了背景母题（${s.motif}）`);
  ok(!!s.grid && Array.isArray(s.grid.captionBand) && s.grid.captionBand.length === 2,
    `${name} 有栅格与字幕带`);
}
// 每套风格必须**一眼看得出不同**：色板里至少要有 ink 或 bone 被改掉
for (const [name, s] of Object.entries(STYLES)) {
  if (name === 'print') continue;
  ok(!!(s.palette.ink || s.palette.bone), `${name} 改了底色或正文色（否则"换风格"看不出来）`);
}

section('风格包：合并与报错');
const paper = resolveStyle({ style: 'paper' });
ok(paper.name === 'paper' && paper.palette.ink === '#f3f0e7', "style: 'paper' → 纸面反色（ink 变浅）");
const tuned = resolveStyle({ style: { name: 'paper', grid: { pad: 160 } } });
ok(tuned.grid.pad === 160 && tuned.grid.footerY === GRID_BASE.footerY, '对象写法：局部覆盖 pad，其余沿用');
let threw = '';
try { resolveStyle({ style: '不存在的风格' }); } catch (e) { threw = String(e.message); }
ok(threw.includes('print') && threw.includes('paper'), '未知风格抛错，并列出可用风格（不静默）');
ok(gridFor(def, 1920, 1080) === def.grid, '1080p 下 gridFor 原样返回');
const half = gridFor(def, 1280, 720);
ok(half.captionBand[0] < GRID_BASE.captionBand[0], '720p 下栅格按比例缩小');

// 字幕带的位置是**引擎保留区**，风格包不该挪它（第一版把 terminal / noir 挪到底部，
// 出图当场看到字幕贴到画面下沿、第二行被裁掉一半）。这里钉住"必须在画面上半部"。
for (const [name, s] of Object.entries(STYLES)) {
  const cb = s.grid.captionBand;
  ok(cb[0] >= 0 && cb[1] <= 400,
    `${name}.grid.captionBand 在画面上半部（实测 [${cb[0]}, ${cb[1]}]）—— 底部被模板与 kit 元件占满了`);
}

section('字幕层：开关语义');
ok(resolveCaptionStyle(null, null) === false, '没有风格、任务也没写 → 关');
ok(resolveCaptionStyle(null, true) !== false, 'captions: true → 开（用默认样式）');
ok(resolveCaptionStyle(null, { size: 60 }).size === 60, 'captions: {…} → 开并覆盖样式');
const paperStyle = resolveStyle({ style: 'paper' });
ok(resolveCaptionStyle(paperStyle, null) !== false, '风格包写了 captions → 这套风格默认开字幕');
ok(resolveCaptionStyle(paperStyle, false) === false, 'captions: false 能盖掉风格包的默认开');
ok(resolveCaptionStyle(null, true).karaoke === false,
  '默认**不做**逐词高亮（关键词突显那条对照实验的方向是负效应，见 captions.js 注释）');
// 这条是文档审计抓出来的真实不一致：风格包里的 CAPTIONS_BASE 一度把 karaoke 写成 true，
// 于是 print 之外的**四套风格全都默认开了逐词高亮**，与引擎默认和文档口径都相反。
for (const [name, s] of Object.entries(STYLES)) {
  if (!s.captions) continue;
  ok(s.captions.karaoke === DEFAULT_CAPTION_STYLE.karaoke,
    `${name}.captions.karaoke 与引擎默认一致（要开只能显式开）`);
  // 时间语义是**引擎契约**（说完留多久、淡变多长），风格包只该改"长什么样"（字号/底衬/颜色）
  ok(s.captions.hold === DEFAULT_CAPTION_STYLE.hold && s.captions.fade === DEFAULT_CAPTION_STYLE.fade,
    `${name}.captions 的 hold / fade 与引擎默认一致（风格不改时间语义）`);
}

section('字幕层：时间语义与保留带');
const P = makePalette({});
const nar = makeNarrationReader(makeNarration({
  lines: [{ id: 'a', text: '这一句用来测字幕的时间语义。', start: 1, dur: 2 }],
}, { duration: 10 }));
const layer = makeCaptionLayer({
  narration: nar, style: { ...DEFAULT_CAPTION_STYLE }, P, W: 1920, H: 1080, grid: def.grid,
});
ok(layer.active(0.5) === null, '句子开始前：不显示');
ok(layer.active(1.5)?.line.id === 'a', '句子进行中：显示');
ok(layer.active(2.0).alpha > 0.95, '句子进行中：不透明度接近 1');
ok(layer.active(3.4)?.line.id === 'a', `说完之后仍停留 ${DEFAULT_CAPTION_STYLE.hold}s（观众还在读）`);
ok(layer.active(4.5) === null, '超出停留窗之后：消失');
const b = layer.band;
const cb = def.grid.captionBand;
ok(b.y0 === cb[0] && b.y1 === cb[1], '字幕带 y 取自风格栅格的 captionBand');
ok(b.x0 > 400 && b.x1 < 1520, `字幕带 x 只占中间一段（${b.x0}–${b.x1}），不横跨整幅`);
ok(Math.abs((b.x0 + b.x1) / 2 - 960) < 2, '字幕带水平居中');
// 默认在顶部：底部已经被模板的 readout / 页脚 / 说明条占满了（见 style/index.js 的注释）
ok(cb[1] <= 200, `默认字幕带在顶部（y ${cb[0]}–${cb[1]}），不与底部元件抢位置`);

console.log(`\n${fail ? '✗' : '✓'} ${pass} 项通过${fail ? `，${fail} 项失败` : ''}`);
process.exit(fail ? 1 : 0);
