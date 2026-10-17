// @ts-check
/**
 * **版面守门**（`docs/LAYOUT.md`）—— 离线单测。
 *
 *   node tools/test-layout.mjs
 *
 * 不需要 GPU / 不需要浏览器 / 不起 Vite：这里测的全是纯函数（`src/layout.js`）。
 * 页面侧只负责"照计划渲一帧、把 `gl.paint.blocks` 读回来"（`src/app.js` 的 `layoutRows()`），
 * 判断逻辑一个字都不在浏览器里 —— 与 `worldAuditVerdict()` / `auditUnderRequires()` 同一个套路。
 *
 * ── 为什么值得钉住 ────────────────────────────────────────────────────────────
 *
 * 钠那期视频（`tasks/sodium`）的外部反馈：「有些动画元素相互遮挡害得我搞不清楚到底要看哪个
 * 主体」。这句话在产物上**可复现**（一屏 4–6 个信息块），但引擎以前一条判据都没有 ——
 * 亮度统计看不出"元素太多"。这一层把它变成机器判据，所以每一档都必须钉死：
 *   · 该响的响（块数超限 / 主体之外太多"看的地方" / 主体区里压着别的块）；
 *   · 该静的静（**版面母题**：页眉、说明条、脚注不算"多了一个看的地方"）；
 *   · 没声明的说"没判"（没写 `focus` 不许说成通过）；
 *   · 报告的**形状**（`layoutReport` 平铺一层字段）—— 2026-10-16 断过一次：判据对了、
 *     接线读的是旧字段名，报告里全是 `undefined`。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LAYOUT_LIMITS, RESERVED_BANDS, resolveFocus, textGroups, focusOverlap,
  layoutVerdict, layoutReport, layoutSummary,
} from '../src/layout.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const ANIM = read('scripts/anim.mjs');
const APP = read('src/app.js');
const TEXT = read('src/core/text.js');
const ENGINE = read('src/core/engine.js');
const GL = read('src/core/gl.js');
const TL = read('src/timeline.js');

let passed = 0;
const failed = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; }
  catch (err) { failed.push('  x ' + name + '\n      ' + String(err && err.message ? err.message : err).split('\n').join('\n      ')); }
}

/* ── 造数据的小工具（blocks 就是 gl.paint.blocks 的形状，不碰 GPU） ── */

/** 一块字：基线 (x, y)、字号 size、实测宽度 w、不透明度 alpha */
const B = (x, y, size, w, sample = 'x', alpha = 1) => ({ x, y, size, w, alpha, sample });

/**
 * 一屏「典型钠式」版面：眉标 +（可选）读数面板 + 主体大字 + 说明条 + 脚注。
 * 这是那一期视频里最常见的一屏 —— 判据要能把它与「一屏只有一件事」分开。
 */
function sodiumScreen(o = {}) {
  const out = [B(128, 92, 30, 140, '钠 5/6')];                       // 眉标（保留区）
  if (o.readout) {
    const n = o.readoutN ?? 6;
    for (let i = 0; i < n; i++) out.push(B(1240, 330 + i * 26, 18, 90, 'R' + i));
  }
  for (const s of (o.extra ?? [])) out.push(s);
  if (o.subject !== false) out.push(B(660, 620, 96, 600, '主体'));
  if (o.caption !== false) out.push(B(128, 964, 44, 420, '说明条'));
  if (o.footer !== false) out.push(B(128, 1004, 21, 300, '出处'));
  return out;
}

/* ═══════════════════════ 1. 合成「块」：读数面板算一块，隔开的一列算两块 */

t('26px 一道的 6 个读数合成一块（观众看见的是一块，不是 6 个元素）', () => {
  const g = textGroups([0, 1, 2, 3, 4, 5].map((i) => B(1240, 330 + i * 26, 18, 90, 'R' + i)));
  assert.equal(g.length, 1, '一列挨着的读数必须合成一块');
  assert.equal(g[0].n, 6);
});

t('隔了 60px 的两块字不许合并（那是一次真正的「多了一个东西」）', () => {
  const g = textGroups([B(128, 400, 24, 200, 'A'), B(128, 460, 24, 200, 'B')]);
  assert.equal(g.length, 2);
});

t('挨得比 gap 还近的两行算一块（同一个信息块的两行）', () => {
  const g = textGroups([B(128, 900, 24, 200, 'A'), B(128, 928, 24, 200, 'B')]);
  assert.equal(g.length, 1);
});

t('空数组 / 非数组 / 缺坐标 ⇒ 空结果（不抛）', () => {
  assert.deepEqual(textGroups([]), []);
  assert.deepEqual(textGroups(null), []);
  assert.deepEqual(textGroups([null, {}, { x: 1 }]), []);
});

/* ═══════════════════════ 2. focus 声明的归一化 */

t('focus 写 center ⇒ 中心 46%x50%（1920x1080）', () => {
  const r = resolveFocus('center', 1920, 1080);
  assert.ok(r, 'center 必须解析得出矩形');
  assert.equal(r.source, 'center');
  assert.ok(Math.abs(r.w - 1920 * 0.46) < 1e-6, '宽应为中心 46%，拿到 ' + r.w);
  assert.ok(Math.abs(r.h - 1080 * 0.5) < 1e-6, '高应为中心 50%，拿到 ' + r.h);
  assert.ok(Math.abs(r.x - (1920 - r.w) / 2) < 1e-6);
});

t('focus 给 {x,y,w,h} 原样；给 {cx,cy,w,h} 换算成左上角', () => {
  const a = resolveFocus({ x: 10, y: 20, w: 100, h: 50 }, 1920, 1080);
  assert.equal(a.x, 10);
  assert.equal(a.y, 20);
  const c = resolveFocus({ cx: 960, cy: 540, w: 400, h: 200 }, 1920, 1080);
  assert.equal(c.x, 760);
  assert.equal(c.y, 440);
});

t('focus 写坏了（只有 x/y、没尺寸）⇒ null（= 没声明，判据说「没判」，不许说通过）', () => {
  assert.equal(resolveFocus({ x: 10, y: 20 }, 1920, 1080), null);
  assert.equal(resolveFocus('middle', 1920, 1080), null);
  assert.equal(resolveFocus(null, 1920, 1080), null);
});

t('重叠比按块自己的面积算：一半压在 focus 里 ⇒ 0.5', () => {
  const g = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const ov = focusOverlap(g, { x: 50, y: 0, w: 100, h: 100 });
  assert.ok(Math.abs(ov.ratio - 0.5) < 1e-9);
  assert.equal(ov.inside, true);
  assert.equal(focusOverlap(g, { x: 200, y: 0, w: 10, h: 10 }).inside, false);
});

/* ═══════════════════════ 3. 判据：该响的响 */

t('一屏 7 块（读数面板 + 三块散标注 + 主体 + 说明条）⇒ blocks 超限', () => {
  // 坐标是手工摆的：每一块都跟别的块隔开 > 40px，它们就是 7 块独立的信息
  const v = layoutVerdict({
    id: 'x', t: 1,
    focus: { x: 0, y: 0, w: 900, h: 900 },
    blocks: [
      B(128, 92, 30, 140, '钠 5/6'),
      B(1240, 330, 18, 90, 'R0'),
      B(1240, 356, 18, 90, 'R1'),
      B(1240, 382, 18, 90, 'R2'),
      B(1240, 408, 18, 90, 'R3'),
      B(1240, 434, 18, 90, 'R4'),
      B(1240, 460, 18, 90, 'R5'),
      B(300, 200, 20, 150, 'L1'),
      B(1700, 880, 20, 150, 'L2'),
      B(500, 700, 20, 150, 'L3'),
      B(660, 560, 96, 600, '主体'),
      B(128, 1000, 44, 420, '说明条'),
    ],
  });
  const kinds = v.violations.map((x) => x.kind);
  assert.equal(v.blocks, 7, '夹具要正好 7 块，拿到 ' + v.blocks);
  assert.ok(kinds.includes('blocks'), '必须报 blocks 超限，拿到 ' + JSON.stringify(kinds));
});

t('主体之外 3 个看的地方 ⇒ off-subject 超限，明细里点名', () => {
  const v = layoutVerdict({
    blocks: [
      B(660, 560, 96, 600, '主体'),
      B(300, 200, 20, 150, '左标注'),
      B(1600, 880, 20, 150, '右标注'),
      B(500, 700, 20, 150, '下标注'),
    ],
  });
  const off = v.violations.find((x) => x.kind === 'off-subject');
  assert.ok(off, '必须报 off-subject');
  assert.equal(off.got, 3);
  assert.equal(v.offSubject, 3);
  assert.ok(off.detail.includes('左标注'), '明细要点名是哪几块');
});

t('主体区里压着 3 块 ⇒ in-focus 超限（元素互相遮挡的读数）', () => {
  const v = layoutVerdict({
    focus: 'center',
    blocks: [
      B(500, 480, 26, 300, '队列'),
      B(700, 560, 26, 300, '标签 A'),
      B(560, 700, 26, 300, '标签 B'),
    ],
  });
  const inf = v.violations.find((x) => x.kind === 'in-focus');
  assert.ok(inf, '必须报 in-focus');
  assert.equal(inf.got, 3);
});

/* ═══════════════════════ 4. 判据：该静的静（假报比不报贵） */

t('版面母题（眉标 + 说明条 + 脚注）不算「多了一个看的地方」', () => {
  const v = layoutVerdict({ blocks: sodiumScreen({}) });
  assert.deepEqual(v.violations, [], '只有主体 + 母题的一屏必须干净（钠每一段都是这个形状）');
  assert.equal(v.blocks, 3, '三块都要真的存在，否则这条断言什么都没测');
  assert.equal(v.offSubject, 0);
});

t('一屏只有一个大标题 ⇒ 不报', () => {
  const v = layoutVerdict({ blocks: [B(200, 300, 64, 700, '标题')] });
  assert.deepEqual(v.violations, []);
});

t('页脚按 H 的比例判（脚注挪低一点也还是母题，不是写死像素）', () => {
  const H = 1080;
  const y = H * RESERVED_BANDS.footer;
  const v = layoutVerdict({ blocks: [B(128, y - 10, 21, 300, '脚注'), B(660, 620, 96, 600, '主体')] });
  assert.deepEqual(v.violations, []);
});

t('alpha 很低（还没揭晓）的绘制不算占了一屏', () => {
  const dim = [0, 1, 2, 3, 4].map((i) => B(400 + i * 200, 300 + i * 90, 24, 150, 'd' + i, 0.05));
  const v = layoutVerdict({ blocks: [...sodiumScreen({}), ...dim] });
  assert.deepEqual(v.violations, [], 'alpha < minAlpha 的块必须被丢掉');
});

t('阈值可以被任务覆盖（limits: { maxBlocks: 3 } 更严、{ maxBlocks: 9 } 更松）', () => {
  const blocks = [
    B(1240, 330, 18, 90, 'R0'),
    B(1240, 356, 18, 90, 'R1'),
    B(300, 200, 20, 150, 'L1'),
    B(1700, 880, 20, 150, 'L2'),
    B(660, 560, 96, 600, '主体'),
  ];
  assert.equal(layoutVerdict({ blocks }).blocks, 4, '夹具要正好 4 块（两个读数合成一块）');
  const loose = layoutVerdict({ blocks, limits: { maxBlocks: 9, maxOffSubject: 9 } });
  const tight = layoutVerdict({ blocks, limits: { maxBlocks: 3, maxOffSubject: 9 } });
  assert.deepEqual(loose.violations, []);
  assert.ok(tight.violations.some((x) => x.kind === 'blocks'));
});

/* ═══════════════════════ 5. 「没声明 focus」不等于通过 */

t('没声明 focus ⇒ noFocus: true、inFocus = -1（「没判」而不是 0）', () => {
  const v = layoutVerdict({ blocks: [B(660, 620, 96, 600, '主体')] });
  assert.equal(v.noFocus, true);
  assert.equal(v.inFocus, -1);
  assert.equal(v.focus, null);
  assert.equal(v.offSubject, 0, '「主体之外有几个看的地方」不依赖 focus，一块都没有时就是 0');
});

t('没声明 focus 时 offSubject 照样算得出来（钠那期 12 段全没声明）', () => {
  const v = layoutVerdict({ blocks: [B(660, 620, 96, 600, '主体'), B(300, 300, 20, 150, 'L1'), B(1600, 700, 20, 150, 'L2'), B(500, 900, 20, 150, 'L3')] });
  assert.equal(v.noFocus, true);
  assert.equal(v.offSubject, 3);
});

t('声明了 focus ⇒ noFocus: false（判据这一半才真的跑了）', () => {
  const v = layoutVerdict({ focus: 'center', blocks: [B(660, 620, 96, 600, '主体')] });
  assert.equal(v.noFocus, false);
  assert.ok(v.inFocus >= 0);
});

/* ═══════════════════════ 6. 报告：形状 + 取最糟那一帧 + 汇总三档 */

t('layoutReport 取最挤的那一帧，并把字段平铺一层（CLI 只读一层）', () => {
  const thin = layoutVerdict({ t: 1, blocks: [B(660, 620, 96, 600, '主体')] });
  const fat = layoutVerdict({
    t: 2,
    focus: 'center',
    blocks: sodiumScreen({ readout: true, extra: [B(300, 250, 20, 150, 'L1'), B(1600, 700, 20, 150, 'L2'), B(500, 860, 20, 150, 'L3')] }),
  });
  assert.ok(fat.violations.length > 0, 'fat 那个夹具必须真的超限，否则这条断言什么都没测');
  const r = layoutReport([{ id: 'seg', samples: [{ t: 1, verdict: thin }, { t: 2, verdict: fat }] }])[0];
  assert.equal(r.judged, true);
  assert.equal(r.samples, 2);
  assert.equal(r.t, 2, '报告的时刻必须是「最挤那一帧」的时刻');
  assert.equal(r.blocks, fat.blocks);
  assert.equal(r.draws, fat.draws);
  assert.equal(r.over, 1, '两帧里只有一帧超限');
  assert.equal(typeof r.focus, 'object');
  assert.ok(Array.isArray(r.violations));
  assert.equal(r.worst, fat, 'worst 就是那一帧的判定对象本身');
});

t('一次采样都没有的段 ⇒ judged: false（「没判」，不是通过）', () => {
  const r = layoutReport([{ id: 'empty', samples: [] }])[0];
  assert.equal(r.judged, false);
  assert.equal(r.worst, null);
  assert.deepEqual(layoutSummary([r]).unjudged, ['empty']);
});

t('layoutSummary 的三档：violates / noFocus / peak / inFocus', () => {
  const withFocus = layoutVerdict({
    t: 1,
    focus: 'center',
    blocks: [B(500, 480, 26, 300, '队列'), B(700, 560, 26, 300, 'A'), B(560, 700, 26, 300, 'B')],
  });
  const noFocus = layoutVerdict({ t: 1, blocks: [B(660, 620, 96, 600, '主体')] });
  const rows = layoutReport([
    { id: 'a', samples: [{ t: 1, verdict: withFocus }] },
    { id: 'b', samples: [{ t: 1, verdict: noFocus }] },
    { id: 'c', samples: [] },
  ]);
  const s = layoutSummary(rows);
  assert.equal(s.segments, 3);
  assert.equal(s.judged, 2);
  assert.deepEqual(s.unjudged, ['c']);
  assert.deepEqual(s.violates.map((r) => r.id), ['a']);
  assert.deepEqual(s.noFocus, ['b']);
  assert.deepEqual(s.inFocus, ['a']);
  assert.ok(s.peak >= 3, 'peak 要报最挤那一帧的块数，拿到 ' + s.peak);
});

t('全干净的片子 ⇒ violates 空、peak 仍是真实块数（不是 0）', () => {
  const v = layoutVerdict({ t: 1, blocks: sodiumScreen({}) });
  const s = layoutSummary(layoutReport([{ id: 'x', samples: [{ t: 1, verdict: v }] }]));
  assert.deepEqual(s.violates, []);
  assert.ok(s.peak > 0, 'peak 不能因为「没违规」就变成 0');
});

/* ═══════════════════════ 7. 静态接线自检（判据对了，还要真的接上） */

t('接线：文字记账在 text.js 里、只认场景那一层、记的是实际绘制', () => {
  assert.ok(/function noteText/.test(TEXT), 'src/core/text.js 必须有 noteText');
  assert.ok(/paint\.layer !== type/.test(TEXT), '只记画在这一层上的字（引擎字幕/HUD 不算）');
  assert.ok(/blocks\.push/.test(TEXT), '要把这一笔记进 paint.blocks');
  assert.ok(/noteText\(\s*this/.test(TEXT), 'write()/karaoke() 要真的调用它');
});

t('接线：engine 开账时把这一层的排版工具放进 paint.layer（存 Layer2D 会恒假）', () => {
  assert.ok(/beginPaint/.test(ENGINE), 'engine 必须调 gl.beginPaint');
  assert.ok(/layer:\s*layer\?\.type/.test(GL), 'paint.layer 必须是 layer.type（TextKit）');
  assert.ok(/this\.type\.gl = gl/.test(GL), 'Layer2D 要把 gl 转给它的 TextKit（否则记账恒假）');
});

t('接线：ctx.focus 从段上读、回落到场景那份；cut() 与配置档都带 focus', () => {
  assert.ok(/focus:\s*item\.focus \?\? item\._scene\?\.focus/.test(ENGINE), 'ctx.focus 的来源');
  assert.ok(/focus: opts\.focus/.test(TL), 'cut() 要把 focus 搬到段上');
  assert.ok(/'focus',/.test(TL), '配置档节点的 TIMELINE_KEYS 里必须有 focus');
});

t('接线：app.js 暴露 layoutRows()（读回记账、不渲染），CLI 按段点名读并汇总', () => {
  assert.ok(/layoutRows\(o = \{\}\)/.test(APP), 'src/app.js 里必须有 layoutRows()');
  assert.ok(/layoutVerdict/.test(APP) && /layoutLimits/.test(APP), 'app.js 必须用这两个纯函数');
  assert.ok(/__anim\.layoutRows\(\{ id \}\)/.test(ANIM), 'CLI 必须按段点名读记账（交叠期同时画着两段）');
  assert.ok(/layoutReport\(/.test(ANIM) && /layoutSummary\(/.test(ANIM), 'CLI 必须用这两个纯函数汇总');
});

t('接线：默认只 warn、--strict 才进 errs（与 1-19 / lint-narration-dup 同一条哲学）', () => {
  assert.ok(/\[版面守门\]/.test(ANIM), 'errs 里要有可定位的前缀');
  assert.ok(/if \(strict\)/.test(ANIM), '--strict 才 gate');
});

t('接线：复述率也接进了 errs（--strict 下）—— 钠那期的第一条病因', () => {
  assert.ok(/\[旁白复述\]/.test(ANIM), 'lint-narration-dup 的命中要在 --strict 下进 errs');
});

t('版面母题保留区与 kit 的带宽同源（改一处要一起改）', () => {
  const BANDS = read('src/kit/bands.js');
  assert.ok(/captionBand/.test(BANDS) && /captionY/.test(BANDS), 'kit/bands.js 仍在管这几条带');
  assert.ok(RESERVED_BANDS.caption > 0.85 && RESERVED_BANDS.caption < 0.95, '说明条那条约 y = 0.90H');
});

t('阈值默认值就是交接单那三条（主体之外 <= 2；每屏 <= 6 块）', () => {
  assert.equal(LAYOUT_LIMITS.maxOffSubject, 2);
  assert.equal(LAYOUT_LIMITS.maxBlocks, 6);
  assert.ok(LAYOUT_LIMITS.gap >= 20 && LAYOUT_LIMITS.gap <= 48, 'gap 该在「一行字」的量级');
});

/* ────────────────────────────────────────────────────────────────── 汇总 */

console.log('test-layout: ' + passed + ' 项通过' + (failed.length ? '，' + failed.length + ' 项失败' : ''));
for (const f of failed) console.log(f);
process.exit(failed.length ? 1 : 0);
