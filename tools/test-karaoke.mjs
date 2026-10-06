// karaoke 回归：`type.karaoke()` 的 `start` / `end` 是**秒**，不是字符下标。
//
// 背景（这就是本文件存在的理由）：旧实现两者混用 ——
//   const c0 = charToCluster[start] ?? 0;      // 当字符下标用
//   const span = Math.max(0.04, end - start);  // 当秒用
// 按文档的写法（`{ w: '代码', start: 12.4, end: 12.9 }`）`charToCluster[12.4]` 是 undefined
// → `?? 0` → 每个词的 x0 都等于**行首**、wpx 都是 **0**：所有词叠在一起、sweep 也扫不出来。
// 之所以一直没被发现：全仓库没有任何任务用过 `type.karaoke`（只有文档里的示例）。
//
// 判据（对应任务书的 ①..⑤）：
//   ① 字符区间是累加的，并集正好覆盖 text
//   ② 位置不再重叠：x0 严格递增、相邻区间首尾相接、总宽 = 整行宽  ← 修之前的直接反例
//   ③ 拼不上时 mismatch 非 null（且点名"得到什么/期望什么"），拼得上时为 null 且只警告一次
//   ④ 边界：words 空 / text 空 / 某段 w 是空串 —— 都不抛
//   ⑤ 时间语义是"秒"：start/end 原样保留；t 早于 start-lead 时 lit=false
//
// 纯 JS，**不起 Chrome、不用 GPU**，几秒内跑完：
//   node tools/test-karaoke.mjs
//
// 唯一用到 canvas 的地方是最后那组「整函数」验证 —— 那里喂的是一个**假 ctx**
// （measureText 每个字符算 10px），只为看 karaoke() 实际把每个词画在哪个 x 上。
import { karaokeSpans, karaokeLit, warnKaraokeMismatch, TextKit } from '../src/core/text.js';

let pass = 0, fails = 0;
const say = (ok, msg) => { if (ok) pass++; else fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const eq = (a, b, msg) => say(Object.is(a, b) || a === b, `${msg}${a === b ? '' : `（得到 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`}`);
const near = (a, b, msg, eps = 1e-9) => say(Math.abs(a - b) <= eps, `${msg}${Math.abs(a - b) <= eps ? '' : `（得到 ${a}，期望 ${b}）`}`);

/** 用真实的字素簇切分（和 text.js 里 segment() 同一套口径）算「簇个数」。 */
const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
const clustersOf = (s) => [...seg.segment(String(s))].map((x) => x.segment);
const clusterCount = (s) => clustersOf(s).length;

/** 自带一个独立实现的「字符下标 → 簇下标」，用来交叉检查 spans 的 i0/i1（不依赖被测代码）。 */
function clusterRange(text, i0, i1) {
  const cl = clustersOf(text);
  let acc = 0, a = cl.length, b = cl.length;
  for (let i = 0; i < cl.length; i++) {
    if (acc === i0) a = i;                      // 区间左端落在第 i 个簇的起点
    acc += cl[i].length;
    if (acc === i1) { b = i + 1; break; }       // 区间右端落在第 i 个簇的终点
  }
  return [a, b, cl.slice(a, b).join('')];
}

/**
 * 假 cum：**每个字素簇宽 10px**。用它算出每段的 x0 与宽度 —— 这就是画布上真正会发生的事，
 * 只是把「字体量出来的宽度」换成了可控的常数（所以能断言精确值，不受字体缺失影响）。
 *
 * `perChar` 只是选哪种假 cum：
 *   - `true`（纯逻辑那几组）：直接拿**码元下标**当 cum 下标（每码元 10px）。中文/拉丁里
 *     码元下标 = 簇下标，看着直观；emoji 那种多码元簇会失真，所以 ⑦ 用 false。
 *   - `false`（⑦）：先按真字素簇切分建 cum，再用 `charToCluster` 把码元区间换成簇区间
 *     —— 和 `karaoke()` 内部做的换算完全同一套口径。
 */
const W = 10;
function charToClusterMap(text) {
  const cl = clustersOf(text);
  const out = [];
  let ci = 0, acc = 0;
  for (let i = 0; i < cl.length; i++) { acc += cl[i].length; while (ci < acc) out[ci++] = i; }
  out[text.length] = cl.length;
  return out;
}
function measureSpans(text, words, perChar = true) {
  const { spans, mismatch } = karaokeSpans(text, words);
  const cum = perChar
    ? Array.from({ length: text.length + 1 }, (_, i) => i * W)
    : Array.from({ length: clusterCount(text) + 1 }, (_, i) => i * W);
  // 簇模型下要先把码元区间换成簇区间，否则拿码元下标去索引 cum 会越界
  const conv = perChar ? (i) => i : (i) => charToClusterMap(text)[i];
  const at = (i) => cum[conv(i)];
  return {
    mismatch,
    spans,
    cum,
    boxes: spans.map((s) => ({ w: s.w, x0: at(s.i0) ?? 0, wpx: (at(s.i1) ?? 0) - (at(s.i0) ?? 0), ...s })),
  };
}

/* ---------------------------------------------------------------- ① 字符区间累加 */

console.log('① 字符区间是累加的、并集正好覆盖 text：');
{
  const text = '代码即素材 万物皆可渲染';       // 12 个字符（含中间一个空格）
  const words = [
    { w: '代码', start: 1.0, end: 1.2 },
    { w: '即素材', start: 1.2, end: 1.5 },
    { w: ' ', start: 1.5, end: 1.6 },          // 空白也各算一项（文档要求）
    { w: '万物皆可渲染', start: 1.6, end: 2.1 },
  ];
  const { spans, mismatch } = karaokeSpans(text, words);
  eq(spans.length, 4, `出 ${spans.length} 段`);
  eq(spans[0].i0, 0, '第一段从 0 开始');
  eq(spans[spans.length - 1].i1, text.length, `最后一段的 i1 = text.length（${text.length}）`);
  let joined = true, chain = true;
  for (let i = 0; i < spans.length; i++) {
    if (i > 0 && spans[i].i0 !== spans[i - 1].i1) chain = false;   // 首尾相接，没有空洞
    if (text.slice(spans[i].i0, spans[i].i1) !== spans[i].w) joined = false;
  }
  say(chain, '相邻两段首尾相接（i0 === 上一段的 i1），并集无缝覆盖整行');
  say(joined, '每段的 i0/i1 正好抠出它自己的 w（text.slice(i0,i1) === w）');
  eq(mismatch, null, '这条表拼得上 → mismatch === null');
  eq(text.slice(spans[2].i0, spans[2].i1), ' ', '空白那一项单独占了 1 个字符（位置因此对得上）');
}

/* ---------------------------------------------------------------- ② 位置不再重叠 */

console.log('\n② 位置不再重叠（这次 bug 的直接回归判据）：');
{
  const text = '代码即素材 万物皆可渲染';
  const words = [
    { w: '代码', start: 1.0, end: 1.2 },
    { w: '即素材', start: 1.2, end: 1.5 },
    { w: ' ', start: 1.5, end: 1.6 },
    { w: '万物皆可渲染', start: 1.6, end: 2.1 },
  ];
  const { boxes } = measureSpans(text, words);
  console.log(`      ${boxes.map((b) => `${JSON.stringify(b.w)}@x=${b.x0}+${b.wpx}`).join('  ')}`);

  // 每段宽度 = 自己那几个字符 × 10px（而不是旧实现的 0）
  const wOK = boxes.every((b) => b.wpx === b.w.length * W);
  say(wOK, `每段宽度 = 字符数 × ${W}px（${boxes.map((b) => b.wpx).join(', ')}）—— 旧实现这里全是 0`);
  say(boxes.every((b) => b.wpx > 0), '没有任何一段宽度是 0（宽度 0 = sweep 的 clip 矩形扫不出东西）');

  let incr = true, touching = true;
  for (let i = 1; i < boxes.length; i++) {
    if (!(boxes[i].x0 > boxes[i - 1].x0)) incr = false;                                   // 严格递增
    if (boxes[i].x0 < boxes[i - 1].x0 + boxes[i - 1].wpx) touching = false;               // 不重叠
  }
  say(incr, `x0 严格递增：${boxes.map((b) => b.x0).join(' < ')}`);
  say(touching, '相邻两段不重叠（后一段的左边 >= 前一段的右边）');
  near(boxes[boxes.length - 1].x0 + boxes[boxes.length - 1].wpx, text.length * W,
    `总宽度 = 整行宽度（${text.length * W}px）`);

  // 旧实现的反例形状：所有 x0 相同、所有 wpx 为 0（这里显式断言"不是那样"）
  say(new Set(boxes.map((b) => b.x0)).size === boxes.length, '每段的 x0 互不相同（旧实现里它们全等于行首）');
}

console.log('\n②b 同样的断言跑一遍文档示例（拉丁 + 空格 + 时间从 12.4s 起）：');
{
  const text = 'ABCD EFGH';
  const T0 = 12.4;
  const words = [
    { w: 'ABCD', start: T0, end: T0 + 0.5 },
    { w: ' ', start: T0 + 0.5, end: T0 + 0.6 },
    { w: 'EFGH', start: T0 + 0.6, end: T0 + 1.1 },
  ];
  const { boxes } = measureSpans(text, words);
  console.log(`      ${boxes.map((b) => `${JSON.stringify(b.w)}@x=${b.x0}+${b.wpx}`).join('  ')}`);
  eq(boxes[0].x0, 0, '第一段在行首');
  eq(boxes[1].x0, 40, '空格那一段接在 "ABCD" 后面（40px）');
  eq(boxes[2].x0, 50, '"EFGH" 接在空格后面（50px）');
  eq(boxes[2].x0 + boxes[2].wpx, 90, '行尾正好是整行宽（9 字符 × 10px）');
}

/* ---------------------------------------------------------------- ③ 拼不上要报 */

console.log('\n③ words 拼不上 text 时必须报出来：');
{
  // 反例 1：少了一个空格（字幕表最典型的手误）
  const miss = karaokeSpans('代码即素材 万物皆可渲染', [
    { w: '代码即素材', start: 0, end: 1 },
    { w: '万物皆可渲染', start: 1, end: 2 },     // 空格那项漏了
  ]);
  say(miss.mismatch !== null, `少了空格 → mismatch 非 null：${JSON.stringify(miss.mismatch)}`);
  eq(miss.mismatch, '代码即素材万物皆可渲染', 'mismatch 里带的是**实际拼出来的串**（要点名"得到什么"）');

  // 反例 2：多了一个字符
  const extra = karaokeSpans('ab', [{ w: 'a', start: 0, end: 1 }, { w: 'bc', start: 1, end: 2 }]);
  say(extra.mismatch !== null, `多了一个字符 → mismatch 非 null：${JSON.stringify(extra.mismatch)}`);

  // 反例 3：words 是空的但 text 有字
  const empty = karaokeSpans('有字', []);
  eq(empty.mismatch, '', 'words 空 + text 非空 → mismatch 是空串（**不是 null**，空串也是拼不上）');

  // 正例（对照，防止"永远非 null"也能过）
  eq(karaokeSpans('ab', [{ w: 'a', start: 0, end: 1 }, { w: 'b', start: 1, end: 2 }]).mismatch, null,
    '拼得上 → mismatch === null');
  eq(karaokeSpans('', []).mismatch, null, '空 text + 空 words → 拼得上（都是空串）');
  eq(karaokeSpans('a', [{ w: 'a', start: 1, end: 2 }]).mismatch, null, '单段拼得上 → null');

  // 「警告一次」：同一行字叫 5 次只该出 1 条
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    for (let i = 0; i < 5; i++) warnKaraokeMismatch('代码即素材 万物皆可渲染', '代码即素材万物皆可渲染');
    warnKaraokeMismatch('另一行字', '另一行');            // 换一行字 → 应该再报一次
  } finally { console.warn = orig; }
  eq(warns.length, 2, `同一行叫 5 次只警告 1 条，换一行再报 1 条（共 ${warns.length} 条）`);
  say(warns.length > 0 && /拼起来不等于 text/.test(warns[0]), '警告文案点名了「words 拼起来不等于 text」');
  say(warns.length > 0 && /得到/.test(warns[0]) && /期望/.test(warns[0]),
    `警告里同时有「得到」与「期望」：${warns[0]?.slice(0, 110)}…`);
  say(warns.length > 0 && /代码即素材万物皆可渲染/.test(warns[0]), '警告里带上了实际拼出来的串（好定位）');
}

/* ---------------------------------------------------------------- ④ 边界不抛 */

console.log('\n④ 边界情况一律不抛：');
{
  const cases = [
    ['words 为空数组', '代码', []],
    ['text 为空串', '', [{ w: 'a', start: 0, end: 1 }]],
    ['text 与 words 都空', '', []],
    ['某段的 w 是空串', 'ab', [{ w: '', start: 0, end: 0.1 }, { w: 'ab', start: 0.1, end: 1 }]],
    ['全是空串段', 'ab', [{ w: '', start: 0, end: 0 }, { w: '', start: 0, end: 0 }]],
    ['text 是 undefined', undefined, []],
    ['words 是 undefined', 'ab', undefined],
    ['words 不是数组', 'ab', 'ab'],
  ];
  for (const [name, text, words] of cases) {
    let err = null, res = null;
    try { res = karaokeSpans(text, words); } catch (e) { err = e; }
    say(err === null && res !== null && Array.isArray(res.spans),
      `${name} → 不抛错${err ? `（抛了：${err.message}）` : `，spans.length = ${res?.spans.length}`}`);
  }
  // 空 w 的段应该占 0 个字符（宽度 0），但不影响后面的段
  const { boxes } = measureSpans('ab', [{ w: '', start: 0, end: 0.1 }, { w: 'ab', start: 0.1, end: 1 }]);
  eq(boxes[0].wpx, 0, '空 w 那段宽度是 0');
  eq(boxes[1].x0, 0, '空 w 那段不占位置，后面的段还是在行首');
  eq(boxes[1].wpx, 20, '后面的段宽度照旧（2 字符 × 10px）');
  // 空 text + 非空 words：字符下标无处可映射，但也不能抛
  const weird = karaokeSpans('', [{ w: 'a', start: 0, end: 1 }]);
  say(weird.mismatch === 'a', 'text 空但 words 有字 → 照样报 mismatch（不是静默）');
}

/* ---------------------------------------------------------------- ⑤ 时间语义是秒 */

console.log('\n⑤ start / end 是秒，不做下标化处理：');
{
  const words = [{ w: '代码', start: 12.4, end: 12.9 }, { w: '即素材', start: 12.9, end: 13.4 }];
  const { spans } = karaokeSpans('代码即素材', words);
  near(spans[0].start, 12.4, 'start 原样保留（12.4s，没有被"当成下标吃掉"）');
  near(spans[0].end, 12.9, 'end 原样保留（12.9s）');
  near(spans[1].start, 12.9, '第二段的 start 也是秒（12.9）');
  say(spans.every((s) => s.start > 10), '所有 start 都还是秒级数值（若被当字符下标，这里会是 0..4 那一档）');

  // 布局与时间**无关**：同一行字换一组时间，x0/宽度必须完全一样
  const A = measureSpans('代码即素材', words).boxes;
  const B = measureSpans('代码即素材', [
    { w: '代码', start: 0.1, end: 0.2 },
    { w: '即素材', start: 0.2, end: 0.3 },
  ]).boxes;
  say(A.every((b, i) => b.x0 === B[i].x0 && b.wpx === B[i].wpx),
    `时间从 12.4s 改成 0.1s，位置一字不变（x0 = ${A.map((b) => b.x0).join(',')}）`);

  // lit：t 早于 start - lead 时不算"已唱到"
  eq(karaokeLit(2, 0, 2.5), true, 't=2.5 >= start=2（lead=0）→ lit=true');
  eq(karaokeLit(2, 0, 2.0), true, 't=2.0 正好等于 start（lead=0）→ lit=true（边界含等号）');
  eq(karaokeLit(2, 0, 1.99), false, 't=1.99 < start=2（lead=0）→ lit=false');
  eq(karaokeLit(2, 0.25, 1.8), true, 'lead=0.25 时 t=1.8 >= 2-0.25 → lit=true（提前量生效）');
  eq(karaokeLit(2, 0.25, 1.7), false, 'lead=0.25 时 t=1.7 < 1.75 → lit=false');
  // 文档里写的默认 lead 是 0.25：所以"t 到 2.0 才算唱到"这种话只有在 lead=0 时才严格成立
  eq(karaokeLit(2, 0.25, 2.0), true, '默认提前量下 t=2.0 已经算亮（提前 0.25s，与文档一致）');
}

/* ---------------------------------------------------------------- ⑥ 整函数：假 ctx 验证 */

console.log('\n⑥ 整函数（假 ctx，每字符 10px）：karaoke() 真的把词画在不同 x 上：');
{
  /** 假 Canvas2D：只记 fillText 与 clip 矩形。measureText 每字符 10px。 */
  const rec = { texts: [], clips: [], depth: 0 };
  const fake = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '', globalAlpha: 1,
    measureText: (s) => ({ width: String(s).length * W }),
    fillText(s, x, y) { rec.texts.push({ s, x, y, alpha: this.globalAlpha }); },
    beginPath() {}, rect(x, y, w, h) { rec.clips.push({ x, y, w, h }); }, clip() {},
    save() { rec.depth++; }, restore() { rec.depth--; },
  };
  const tk = new TextKit(fake);
  const text = '代码即素材 万物皆可渲染';
  const T0 = 12.4, STEP = 0.45;
  const words = [
    { w: '代码', start: T0, end: T0 + STEP },
    { w: '即素材', start: T0 + STEP, end: T0 + 2 * STEP },
    { w: ' ', start: T0 + 2 * STEP, end: T0 + 3 * STEP },
    { w: '万物皆可渲染', start: T0 + 3 * STEP, end: T0 + 4 * STEP },
  ];
  const x = 160, y = 620, size = 64;
  // 显式 `lead: 0`：默认提前量是 0.25s，会把"下一段"提前点亮，就分不出两种状态了
  //（lead 本身在 ⑤ 单独测）。这个时刻落在第 3 段的中间：
  // 第 1、2 段已唱完，第 3 段（空格）正擦到一半，第 4 段还没轮到。
  const t = T0 + 2.5 * STEP;
  tk.karaoke(text, words, x, y, t, { size, lead: 0 });

  const off = [0, 20, 50, 60];                                  // 每段在行内的起点 = 前面各段的宽度
  const lit = [true, true, true, false];
  const ease = lit.map((_, i) => Math.max(0, Math.min(1, (t - words[i].start) / STEP)));
  const easeOut = ease.map((e) => 1 - (1 - e) ** 3);

  eq(rec.texts.length, 7, `出了 ${rec.texts.length} 次 fillText（3 段已唱到各 2 次 + 1 段没轮到 1 次）`);
  eq(rec.depth, 0, 'save/restore 配平（没有把 Canvas2D 状态栈一帧帧涨上去）');
  const xs = rec.texts.map((r) => r.x);
  console.log(`      fillText 的 x：${xs.join(', ')}`);
  eq(xs.join(','), [0, 0, 1, 1, 2, 2, 3].map((i) => x + off[i]).join(','),
    '每段的 x = 行首 + 前面各段的宽度（旧实现里它们全是行首 160）');
  say(new Set(xs).size === 4, `${new Set(xs).size} 个不同的 x（旧实现：1 个）`);
  say(rec.texts.every((r) => r.x >= x && r.x <= x + text.length * W),
    `每个词的 x 都落在这一行的范围内 [${x}, ${x + text.length * W}]`);

  // clip：只有已唱到的段才擦，左边界留一个 size 的余量，宽度 = 词宽 × ease + size
  eq(rec.clips.length, 3, `出了 ${rec.clips.length} 个 clip（只有已唱到的段才擦）`);
  eq(rec.clips.map((c) => c.x).join(','), [0, 1, 2].map((i) => x + off[i] - size).join(','),
    `clip 左边仍多留一个 size 的余量：${rec.clips.map((c) => c.x).join(', ')}（各段 x0 − ${size}）`);
  eq(rec.clips.map((c) => (c.w - size).toFixed(3)).join(','),
    [0, 1, 2].map((i) => (words[i].w.length * W * easeOut[i]).toFixed(3)).join(','),
    `clip 宽度 − size = 词宽 × ease（${rec.clips.map((c) => (c.w - size).toFixed(1)).join(', ')}）—— 旧实现恒为 0`);
  eq(rec.clips[2].w.toFixed(3), (10 * easeOut[2] + size).toFixed(3),
    `正在唱的那一段 clip 宽度 = ${rec.clips[2].w.toFixed(1)}（width×0.875 + ${size}）`);
  eq(rec.clips[0].y, y - size * 1.3, `clip 上边 = y − size×1.3（${rec.clips[0].y}）`);
  eq(rec.clips[0].h, size * 2.6, `clip 高 = size×2.6（${rec.clips[0].h}）`);

  // 不透明度：没轮到的段用 dim（默认 0.35），已唱到的用 1
  const alphas = [...new Set(rec.texts.map((r) => r.alpha))].sort();
  eq(alphas.join(','), '0.35,1', `未唱到用 dim=0.35、已唱到用 1（出现的不透明度：${alphas.join(', ')}）`);
  eq(rec.texts.filter((r) => r.s === '万物皆可渲染').map((r) => r.x)[0], x + off[3],
    `还没轮到的那一段画在 ${x + off[3]}（行内正确位置，不是行首）`);
  // 正在唱的那一段：底（alpha=1）+ 擦出的那一份，两次的 x 相同
  const spaceX = rec.texts.filter((r) => r.s === ' ').map((r) => r.x);
  eq(spaceX.join(','), `${x + off[2]},${x + off[2]}`, `正在唱的空格那一段两次都画在 ${x + off[2]}`);
}

/* ---------------------------------------------------------------- ⑦ 整函数：多码元簇 */

console.log('\n⑦ 多码元簇（emoji / 组合字符）：字符下标 ≠ 簇下标，也不能算出 NaN：');
{
  const text = 'a\u{1F600}b';                       // 4 个 UTF-16 码元 / 3 个字素簇
  eq(text.length, 4, `text.length = ${text.length}（码元数）`);
  eq(clusterCount(text), 3, `字素簇 = ${clusterCount(text)}（😀 是一个字但占两个码元）`);

  const words = [{ w: 'a', start: 0, end: 1 }, { w: '\u{1F600}', start: 1, end: 2 }, { w: 'b', start: 2, end: 3 }];
  const { spans, boxes } = measureSpans(text, words, false);   // 簇模型：一个簇 10px
  let ok = true;
  for (const s of spans) if (clusterRange(text, s.i0, s.i1)[2] !== s.w) ok = false;
  say(ok, `每段的字符区间都顺着字素簇边界（${spans.map((s) => `[${s.i0},${s.i1})`).join(' ')}）`);
  // 😀 占两个码元、但只有一个字素簇 —— 所以它的字符区间是 [1,3)
  eq(spans[1].i0 + '-' + spans[1].i1, '1-3', '😀 的字符区间是 [1,3)（两个码元一个簇）');
  eq(boxes[1].x0, 10, `emoji 那一段接在 "a" 后面（${boxes[1].x0}px）`);
  eq(boxes[1].wpx, 10, `emoji 那一段宽 10px（一个簇；虽然它占两个码元）`);
  near(boxes[2].x0 + boxes[2].wpx, clusterCount(text) * W, `最后一段的右边 = 整行宽（${clusterCount(text) * W}px）`);
  say(text.slice(spans[2].i0, spans[2].i1) === 'b', '最后一段的字符区间正好是那个 "b"（哨兵落在真实的行尾）');

  // ---- 段边界切在**簇中间**：不抛、不算 NaN、也不越界 ----
  // 组合字：'e' + U+0301 是一个字素簇但两个码元（和 😀 同类，只是普通平面）。
  const comb = 'e\u0301b';
  eq(clusterCount(comb), 2, `'e\\u0301b' 是 ${clusterCount(comb)} 个簇 / ${comb.length} 个码元`);
  const mid = [
    { w: 'e', start: 0, end: 1 },            // ← 右边界切在 'é' 这个簇的中间
    { w: '\u0301b', start: 1, end: 2 },
  ];
  const m = measureSpans(comb, mid, false);
  say(m.mismatch === null, '这一版表"拼起来"仍然等于 text —— 所以它**不会**触发 mismatch 警告');
  say(m.boxes.every((b) => Number.isFinite(b.x0) && Number.isFinite(b.wpx)),
    `切在簇中间时宽度全是有限值、没有 NaN（${m.boxes.map((b) => b.wpx).join(', ')}）`);
  say(m.boxes.every((b) => b.x0 <= comb.length * W), 'x0 没有越出行尾');

  // 旧实现的那条哨兵 `charToCluster[clusters.length] = clusters.length` 会盖掉一个**真值**：
  // 'ab' 是 2 个簇 / 2 个码元，'b' 的右边界（码元 2）本该映射到簇 2，却被覆盖成 2 以外的值。
  const ab = karaokeSpans('ab', [{ w: 'a', start: 0, end: 0.5 }, { w: 'b', start: 0.5, end: 1 }]);
  eq(ab.spans[1].i1, 'ab'.length, '第二段的右边界 = 码元数（哨兵就落在"整行末尾"上）');

  // 假 ctx 再跑一遍，确认整函数也把三个字画在三个不同位置。
  // 这里 measureText 按**字素簇**数算宽度（😀 是一个字 = 10px），所以 cum = [0, 10, 20, 30]。
  const rec2 = [];
  const fake2 = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '', globalAlpha: 1,
    measureText: (s) => ({ width: clustersOf(s).length * W }),
    fillText: (s, px) => rec2.push({ s, px }),
    beginPath() {}, rect() {}, clip() {}, save() {}, restore() {},
  };
  new TextKit(fake2).karaoke(text, words, 0, 0, 3, { size: 64 });
  const px = [...new Set(rec2.map((r) => r.px))].sort((a, b) => a - b);
  say(px.length === 3, `三个字画在 3 个不同 x 上：${px.join(', ')}（旧实现全是 0）`);
  eq(px.join(','), '0,10,20', 'x 依次是 0 / 10 / 20（😀 占 10px，但它占两个码元）');
}

console.log(`\n${fails ? `✗ ${fails} 项失败（${pass} 项通过）` : `✓ 全部通过（${pass} 项）：karaoke 的字符区间按 w 累加、start/end 只当秒、拼不上会点名报警`}`);
process.exit(fails ? 1 : 0);
