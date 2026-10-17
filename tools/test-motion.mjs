// @ts-check
/**
 * **运动规则**（`docs/MOTION.md` / `src/kit/motion.js`）—— 离线单测。
 *
 *   node tools/test-motion.mjs
 *
 * 不需要 GPU / 不需要浏览器 / 不起 Vite：`src/kit/motion.js` 是纯数学（**连 import 都没有**）。
 *
 * ── 为什么值得钉住 ────────────────────────────────────────────────────────────
 *
 * BACKLOG 1-27 从外部项目 hyperframes 抄了三个数值（`docs/REFERENCE-hyperframes.md` §4.4）：
 * 三段式的 **10/65/25**、`items × stagger ≤ ~0.5s`、辉光峰值 **≤ ~0.45**。
 * 那些**是别人的经验值，我方还没实测**（`docs/MOTION.md` §0 的证据分级）——
 * 所以这里钉的不是"它们好不好看"（那要出图才知道），而是四件事：
 *   · 抄来的数值**有没有原样落进代码**（10/65/25、0.5、0.45）；
 *   · 抄过来之后**数学上自洽**没有（端点 / 单调 / 两处接缝速度相等 / 尾部 ≥ 3× 加速段）；
 *   · 判据**该响的响、该静的静**（正好等于上限不压、超了才压、**NaN 不许静默通过** —— 空 ≠ 干净）；
 *   · 接线真的接上了（`src/kit/index.js` 再导出、`tools/regress-all.mjs` 里有 `unit:motion`）——
 *     "判据对了、接线没接上"这个坑 `tools/test-layout.mjs` 已经踩过一次（报告里全是 undefined）。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  nudgeCurve, waterfallStagger, waterfallOver, glowPeakCap,
  NUDGE_SPLIT, NUDGE_PHASE, MAX_STAGGER_SPAN, GLOW_PEAK_CAP,
} from '../src/kit/motion.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const SRC = read('src/kit/motion.js');
const KIT_INDEX = read('src/kit/index.js');
const REGRESS = read('tools/regress-all.mjs');
const DOC = existsSync(path.join(ROOT, 'docs/MOTION.md')) ? read('docs/MOTION.md') : '';

let passed = 0;
const failed = [];
/** @param {string} name @param {() => void} fn */
function t(name, fn) {
  try { fn(); passed++; }
  catch (err) { failed.push('  x ' + name + '\n      ' + String(err && err.message ? err.message : err).split('\n').join('\n      ')); }
}

/** 浮点容差：这几条闭式解是精确的，容差只吸收浮点噪声（不是"差不多就行"）。 */
const TOL = 1e-9;
/** 数值微分的步长（用来验"两处接缝速度相等"）。 */
const H = 1e-4;

/* ═══════════════════════ 1. nudgeCurve：端点 / 单调 / 10-65-25 */

const T0 = 0.6, DUR = 1.3, DIST = 220;

t('t ≤ t0 ⇒ 0（正好 t0、t0 之前一点点、很远的过去，都是 0）', () => {
  for (const tt of [T0, T0 - 1e-9, T0 - 0.5, -10]) {
    assert.equal(nudgeCurve(tt, T0, DUR, DIST), 0);
  }
});

t('t ≥ t0+dur ⇒ dist（正好 t0+dur、之后一点点、很远的将来，都是 dist）', () => {
  for (const tt of [T0 + DUR, T0 + DUR + 1e-9, T0 + DUR + 5, 99]) {
    assert.equal(nudgeCurve(tt, T0, DUR, DIST), DIST);
  }
});

t('单调不减（400 个采样点，含两处接缝与两端；一次回退都不许有）', () => {
  let prev = -Infinity;
  for (let i = 0; i <= 400; i++) {
    const tt = T0 - 0.2 + (DUR + 0.4) * (i / 400);
    const v = nudgeCurve(tt, T0, DUR, DIST);
    assert.ok(v >= prev - 1e-9, 't=' + tt + ' 处回退了：' + prev + ' → ' + v);
    prev = v;
  }
});

t('距离分配 10/65/25：两处接缝的位移正好是 10% 与 75%', () => {
  const [f1, f2] = NUDGE_PHASE;
  const a = nudgeCurve(T0 + DUR * f1, T0, DUR, DIST);
  const b = nudgeCurve(T0 + DUR * (f1 + f2), T0, DUR, DIST);
  assert.ok(Math.abs(a - 0.10 * DIST) < TOL * DIST, '加速段末应为 10%（' + a + '）');
  assert.ok(Math.abs(b - 0.75 * DIST) < TOL * DIST, '爆发段末应为 75%（' + b + '）');
});

t('三段各自贡献的距离 = 10% / 65% / 25%（不是只有接缝凑对）', () => {
  const [f1, f2] = NUDGE_PHASE;
  const s1 = nudgeCurve(T0 + DUR * f1, T0, DUR, DIST);
  const s2 = nudgeCurve(T0 + DUR * (f1 + f2), T0, DUR, DIST) - s1;
  const s3 = DIST - nudgeCurve(T0 + DUR * (f1 + f2), T0, DUR, DIST);
  assert.ok(Math.abs(s1 / DIST - NUDGE_SPLIT[0]) < TOL);
  assert.ok(Math.abs(s2 / DIST - NUDGE_SPLIT[1]) < TOL);
  assert.ok(Math.abs(s3 / DIST - NUDGE_SPLIT[2]) < TOL);
});

t('三段时长比例 = 2/13 : 1/3 : 20/39（接缝速度相等解出来的那一组）', () => {
  assert.ok(Math.abs(NUDGE_PHASE[0] - 2 / 13) < 1e-12, 'd1 应为 2/13');
  assert.ok(Math.abs(NUDGE_PHASE[1] - 1 / 3) < 1e-12, 'd2 应为 1/3');
  assert.ok(Math.abs(NUDGE_PHASE[2] - 20 / 39) < 1e-12, 'd3 应为 20/39');
  const sum = NUDGE_PHASE.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12, '三段时长必须加满一个 dur，否则中间有一段"卡住"');
});

t('§4.4 的硬约束：尾部时长 ≥ 3× 加速段（我们解出来是 10/3 ≈ 3.33）', () => {
  const r = NUDGE_PHASE[2] / NUDGE_PHASE[0];
  assert.ok(r >= 3, '尾部/加速 = ' + r + ' < 3 —— 违反 REFERENCE-hyperframes.md 516 行');
  assert.ok(Math.abs(r - 10 / 3) < 1e-12, '这一组解应当正好给出 10/3');
});

t('距离分配常量加起来 = 1（10/65/25 少一个百分点，整条位移就走不满 dist）', () => {
  assert.equal(NUDGE_SPLIT.length, 3);
  const sum = NUDGE_SPLIT.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-12, 'NUDGE_SPLIT 之和 = ' + sum);
  assert.ok(Math.abs(NUDGE_SPLIT[0] - 0.10) < TOL);
  assert.ok(Math.abs(NUDGE_SPLIT[1] - 0.65) < TOL);
  assert.ok(Math.abs(NUDGE_SPLIT[2] - 0.25) < TOL);
});

t('两处接缝速度相等（数值微分，2%）—— "慢-快-慢"接得住的原因', () => {
  const [f1, f2] = NUDGE_PHASE;
  /** 段内前向差分：两端都落在同一段里，不跨接缝。 */
  const vel = (tt) => (nudgeCurve(tt + H, T0, DUR, DIST) - nudgeCurve(tt, T0, DUR, DIST)) / H;
  const seams = [T0 + DUR * f1, T0 + DUR * (f1 + f2)];
  for (const s of seams) {
    const va = vel(s - 2 * H);            // 接缝前：还在上一段里
    const vb = vel(s + H);                // 接缝后：已经进下一段
    const rel = Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb));
    assert.ok(rel < 0.02, '接缝 ' + s + ' 两侧速度不接：' + va + ' vs ' + vb + '（相对差 ' + rel + '）');
  }
});

t('负 dist：单调不增、端点 = dist（反向推一模一样的曲线）', () => {
  let prev = Infinity;
  for (let i = 0; i <= 200; i++) {
    const tt = T0 - 0.2 + (DUR + 0.4) * (i / 200);
    const v = nudgeCurve(tt, T0, DUR, -DIST);
    assert.ok(v <= prev + 1e-9, 't=' + tt + ' 处回弹了：' + prev + ' → ' + v);
    prev = v;
  }
  assert.equal(nudgeCurve(T0 + DUR, T0, DUR, -DIST), -DIST);
});

t('dur ≤ 0：一到 t0 就落定，不除零、不出 NaN', () => {
  assert.equal(nudgeCurve(T0, T0, 0, DIST), 0);
  assert.equal(nudgeCurve(T0 + 1e-6, T0, 0, DIST), DIST);
  assert.equal(nudgeCurve(T0 + 1, T0, -1, DIST), DIST);
  assert.equal(nudgeCurve(T0 - 1, T0, -1, DIST), 0);
});

t('dist = 0 ⇒ 恒为 0（不会跑出 -0 / NaN）', () => {
  for (let i = 0; i <= 20; i++) {
    const v = nudgeCurve(T0 + DUR * (i / 20), T0, DUR, 0);
    assert.ok(v === 0, 'dist = 0 却得到 ' + v);
  }
});

t('全程有限：扫一遍没有 NaN / ±Inf（NaN 会让整屏白且引擎不报错）', () => {
  for (let i = 0; i <= 300; i++) {
    const v = nudgeCurve(T0 - 1 + 4 * (i / 300), T0, DUR, DIST);
    assert.ok(Number.isFinite(v), '出现非有限值：' + v);
  }
});

t('参数写错（NaN / ±Inf / 缺项）当场抛，不静默返回 NaN', () => {
  assert.throws(() => nudgeCurve(NaN, 0, 1, 10), /有限数/);
  assert.throws(() => nudgeCurve(0, Infinity, 1, 10), /有限数/);
  assert.throws(() => nudgeCurve(0, 0, 1, undefined), /有限数/);
});

t('确定性：同参数调两次逐位相同（纯函数，没有隐藏状态）', () => {
  for (let i = 0; i < 60; i++) {
    const tt = i * 0.031;
    assert.equal(nudgeCurve(tt, 0.2, 1.1, 137), nudgeCurve(tt, 0.2, 1.1, 137));
  }
});

/* ═══════════════════════ 2. waterfallStagger：上限的四个边界 */

t('远小于上限：3 项 × 0.02s ⇒ 一个数都不动', () => {
  const w = waterfallStagger(3, 0.02);
  assert.equal(w.capped, false);
  assert.equal(w.stagger, 0.02);
  assert.ok(Math.abs(w.total - 0.06) < TOL);
  assert.equal(w.warning, null);
});

t('正好等于上限：5 项 × 0.1s = 0.5s ⇒ 不算超，原样返回', () => {
  const w = waterfallStagger(5, 0.1);
  assert.equal(w.capped, false);
  assert.equal(w.stagger, 0.1);
  assert.ok(Math.abs(w.total - 0.5) < TOL);
  assert.equal(w.warning, null);
});

t('超过上限：10 项 × 0.1s ⇒ 按比例压回 0.5s（每项 0.05s）', () => {
  const w = waterfallStagger(10, 0.1);
  assert.equal(w.capped, true);
  assert.ok(Math.abs(w.stagger - 0.05) < 1e-12, 'stagger 应为 0.05，实际 ' + w.stagger);
  assert.ok(Math.abs(w.total - 0.5) < 1e-12);
  assert.ok(Math.abs(w.rawTotal - 1) < 1e-12, 'rawTotal 要留着"你原本想给的那个数"');
  assert.equal(w.rawStagger, 0.1);
  assert.ok(typeof w.warning === 'string', '被压过必须有话说（返回字符串，由调用方决定喊不喊）');
  assert.ok(/超限/.test(w.warning) && /0\.5/.test(w.warning) && /§4\.4/.test(w.warning));
});

t('items = 0 ⇒ total 0、span 0、不除零、不改写你的 stagger', () => {
  const w = waterfallStagger(0, 0.9);
  assert.equal(w.items, 0);
  assert.equal(w.total, 0);
  assert.equal(w.span, 0);
  assert.equal(w.capped, false);
  assert.equal(w.stagger, 0.9);
  assert.ok(Number.isFinite(w.stagger));
  assert.equal(w.warning, null);
});

t('items = 1：按 §4.4 的字面口径（items，不是 items−1）判，0.9s 也压到 0.5s', () => {
  const w = waterfallStagger(1, 0.9);
  assert.equal(w.capped, true);
  assert.equal(w.stagger, MAX_STAGGER_SPAN);
  assert.equal(w.span, 0, '一个元素没有级联，span 恒为 0');
});

t('默认上限就是 §4.4 的 0.5s；自定义 maxStagger 同样生效', () => {
  assert.equal(MAX_STAGGER_SPAN, 0.5);
  const w = waterfallStagger(4, 0.1, 0.2);
  assert.equal(w.capped, true);
  assert.ok(Math.abs(w.stagger - 0.05) < 1e-12);
  assert.equal(waterfallStagger(4, 0.1, 0.2).maxStagger, 0.2);
});

t('span（最后一个元素真正开始的时间）= (items−1) × stagger，且恒 ≤ total', () => {
  for (const [n, s] of [[8, 0.1], [3, 0.02], [1, 0.9], [12, 0.05], [40, 0.02]]) {
    const w = waterfallStagger(n, s);
    assert.ok(Math.abs(w.span - Math.max(0, w.items - 1) * w.stagger) < 1e-12, 'n=' + n);
    assert.ok(w.span <= w.total + 1e-12, 'n=' + n + '：span 不该超过 total');
  }
});

t('压过之后的 stagger 真的能喂 type.write：items × stagger ≤ maxStagger', () => {
  for (const n of [1, 2, 5, 9, 20, 200]) {
    for (const s of [0.01, 0.1, 0.5, 2]) {
      const w = waterfallStagger(n, s);
      assert.ok(w.items * w.stagger <= MAX_STAGGER_SPAN + 1e-12, 'n=' + n + ' s=' + s);
      assert.ok(w.total <= MAX_STAGGER_SPAN + 1e-12, 'n=' + n + ' s=' + s);
    }
  }
});

t('waterfallOver 与 .capped 同一个口径（静态扫描与运行时告警不许打架）', () => {
  for (const n of [0, 1, 2, 5, 10, 40, 200]) {
    for (const s of [0, 0.001, 0.02, 0.1, 0.5, 1]) {
      assert.equal(waterfallOver(n, s), waterfallStagger(n, s).capped, 'n=' + n + ' s=' + s);
    }
  }
});

t('负 stagger 原样通过（这是「上」限，反序级联不归它管）', () => {
  const w = waterfallStagger(10, -0.2);
  assert.equal(w.capped, false);
  assert.equal(w.stagger, -0.2);
  assert.ok(Math.abs(w.total + 2) < TOL);
});

t('items 非整数向下取整；非有限参数当场抛', () => {
  assert.equal(waterfallStagger(3.9, 0.1).items, 3);
  assert.throws(() => waterfallStagger(NaN, 0.1), /有限数/);
  assert.throws(() => waterfallStagger(3, Infinity), /有限数/);
  assert.throws(() => waterfallOver(3, undefined), /有限数/);
});

/* ═══════════════════════ 3. glowPeakCap：辉光峰值上限（正反例都要） */

t('全在限内 ⇒ ok、over 空、warning null、peak 是真读数（不是 0）', () => {
  const g = glowPeakCap([0.2, 0.3, 0.44]);
  assert.equal(g.ok, true);
  assert.deepEqual(g.over, []);
  assert.equal(g.warning, null);
  assert.ok(Math.abs(g.peak - 0.44) < TOL);
  assert.equal(g.count, 3);
});

t('正好等于 0.45 不算超（判据是 ≤，闭区间）', () => {
  const g = glowPeakCap([0.45]);
  assert.equal(g.ok, true);
  assert.deepEqual(g.over, []);
  assert.equal(g.warning, null);
});

t('反例：一项超限 ⇒ 报下标、原值、建议值 = cap', () => {
  const g = glowPeakCap([0.2, 0.62, 0.3]);
  assert.equal(g.ok, false);
  assert.equal(g.over.length, 1);
  const o = g.over[0];
  assert.equal(o.i, 1, '要说清是第几项');
  assert.equal(o.value, 0.62);
  assert.equal(o.suggested, 0.45);
  assert.equal(o.reason, '超过上限');
  assert.ok(/0\.62/.test(g.warning), '告警里要有那个超限的数：' + g.warning);
  assert.ok(/0\.45/.test(g.warning));
});

t('suggested 与输入等长、只有超限项被压到 cap（可以直接拿去改）', () => {
  assert.deepEqual(glowPeakCap([0.2, 0.62, 0.3]).suggested, [0.2, 0.45, 0.3]);
  assert.deepEqual(glowPeakCap([0.9, 0.9]).suggested, [0.45, 0.45]);
});

t('对象形式 { id, peak }：点名是哪个元素，而不是第几项', () => {
  const g = glowPeakCap([{ id: 'hero', peak: 0.3 }, { id: 'rim', peak: 0.8 }]);
  assert.equal(g.over.length, 1);
  assert.equal(g.over[0].id, 'rim');
  assert.equal(g.over[0].i, 1);
  assert.ok(/rim/.test(g.warning), '告警里要点名：' + g.warning);
});

t('多项超限：按原顺序全部报出来（不是只报第一个）', () => {
  const g = glowPeakCap([0.9, 0.2, 0.7, 0.5]);
  assert.deepEqual(g.over.map((o) => o.i), [0, 2, 3]);
  assert.equal(g.over.length, 3);
  assert.ok(Math.abs(g.peak - 0.9) < TOL);
});

t('空数组 ⇒ ok、peak 0、suggested 空（没有可判的项，不是"没判"）', () => {
  const g = glowPeakCap([]);
  assert.equal(g.ok, true);
  assert.equal(g.count, 0);
  assert.equal(g.peak, 0);
  assert.equal(g.warning, null);
  assert.deepEqual(g.suggested, []);
});

t('NaN / ±Inf 不许静默通过（reason = 不是有限数，suggested 给 cap）', () => {
  const g = glowPeakCap([0.2, NaN, Infinity]);
  assert.equal(g.ok, false);
  assert.deepEqual(g.over.map((o) => o.i), [1, 2]);
  assert.ok(g.over.every((o) => o.reason === '不是有限数'));
  assert.deepEqual(g.suggested, [0.2, 0.45, 0.45]);
  assert.ok(Math.abs(g.peak - 0.2) < TOL, 'peak 只统计有限值，不能被 NaN 污染');
});

t('默认上限就是 §4.4 的 0.45；自定义 cap 生效', () => {
  assert.equal(GLOW_PEAK_CAP, 0.45);
  assert.equal(glowPeakCap([0.5], 0.7).ok, true);
  assert.equal(glowPeakCap([0.5], 0.4).over.length, 1);
  assert.equal(glowPeakCap([0.5], 0.4).over[0].suggested, 0.4);
});

t('写错就抛：values 不是数组 / 对象没有 .peak / cap 非有限', () => {
  assert.throws(() => glowPeakCap(0.6), /必须是数组/);
  assert.throws(() => glowPeakCap([{ id: 'x' }]), /\.peak/);
  assert.throws(() => glowPeakCap([0.2], NaN), /有限数/);
});

/* ═══════════════════════ 4. 静态扫描与接线自检 */

t('静态扫描：motion.js 里没有 Math.random / Date.now / performance.now', () => {
  assert.ok(!/Math\s*\.\s*random/.test(SRC), '不许有 Math.random（铁律，子帧乱序会抖）');
  assert.ok(!/Date\s*\.\s*now/.test(SRC), '不许有 Date.now');
  assert.ok(!/performance\s*\.\s*now/.test(SRC), '不许有 performance.now');
});

t('静态扫描：motion.js 不 import GPU / 浏览器模块（允许清单只有 core/util.js）', () => {
  const specs = [
    ...SRC.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...SRC.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
  ].map((m) => m[1]);
  const ALLOWED = new Set(['../core/util.js']);
  for (const s of specs) assert.ok(ALLOWED.has(s), 'motion.js 不该 import ' + s);
  for (const bad of ['window', 'document', 'canvas', 'navigator', 'Pass', 'gl', 'three']) {
    assert.ok(!new RegExp('\\b' + bad + '\\b').test(SRC), 'motion.js 里不该出现 ' + bad);
  }
  assert.ok(!/\brequire\s*\(/.test(SRC), 'motion.js 不许用 CommonJS require');
});

t('文件头把出处点到行：REFERENCE-hyperframes.md 的 516 / 517 / 522 / 535 / 550-552 / 556', () => {
  assert.ok(/REFERENCE-hyperframes\.md/.test(SRC), '头部必须写出处文件名');
  for (const ln of ['516 行', '517 行', '522 行', '535 行', '550 行', '551 行', '552 行', '556 行']) {
    assert.ok(SRC.includes(ln), '文件头注释里没点出 ' + ln + '（数值与出处要能对回去）');
  }
});

t('接线：src/kit/index.js 再导出了三个函数与四个常量', () => {
  for (const n of ['nudgeCurve', 'waterfallStagger', 'waterfallOver', 'glowPeakCap',
    'NUDGE_SPLIT', 'NUDGE_PHASE', 'MAX_STAGGER_SPAN', 'GLOW_PEAK_CAP']) {
    assert.ok(new RegExp('\\b' + n + '\\b').test(KIT_INDEX), 'src/kit/index.js 里没有 ' + n);
  }
  assert.ok(/from '\.\/motion\.js'/.test(KIT_INDEX), '必须从 ./motion.js 再导出');
});

t('接线：tools/regress-all.mjs 里有 unit:motion，指向 tools/test-motion.mjs', () => {
  assert.ok(/name: 'unit:motion'/.test(REGRESS), '回归清单里没有 unit:motion');
  assert.ok(/cmd: \['tools\/test-motion\.mjs'\]/.test(REGRESS), 'unit:motion 指的必须是这个文件');
});

t('docs/MOTION.md 在，且四条规则 / 四个数值 / 证据分级都写到了', () => {
  assert.ok(DOC.length > 0, 'docs/MOTION.md 不存在或为空');
  for (const k of ['spring', 'nudgeCurve', 'waterfall', '二值到达']) {
    assert.ok(DOC.includes(k), '规则表里少了「' + k + '」这一路');
  }
  assert.ok(/10\s*\/\s*65\s*\/\s*25/.test(DOC), '少了 10/65/25');
  assert.ok(/40[–-]50%/.test(DOC), '少了碰撞式转场的受害者时长 40–50%');
  assert.ok(/≤\s*~?0\.5\s*s/.test(DOC), '少了 items × stagger ≤ ~0.5s');
  assert.ok(/0\.45/.test(DOC), '少了辉光峰值 ≤ ~0.45');
  assert.ok(/未实测/.test(DOC), '必须区分「外部经验值（我方未实测）」与「我方实测」');
});

/* ────────────────────────────────────────────────────────────────── 汇总 */

console.log('test-motion: ' + passed + ' 项通过' + (failed.length ? '，' + failed.length + ' 项失败' : ''));
for (const f of failed) console.log(f);
process.exit(failed.length ? 1 : 0);
