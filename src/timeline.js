// @ts-check
/**
 * 时间线 DSL。目标是让「剪辑」这件事在代码里一眼能读：
 *
 *   import { seq, cut, par, to } from '../../src/timeline.js';
 *   import hello from './scenes/hello.js';
 *
 *   export default {
 *     title: '演示',
 *     timeline: seq([
 *       cut(hello, { dur: 4 }),
 *       cut(other, { dur: 6, params: { variant: 'b' } }),
 *       par(2.0, [cut(a, { dur: 4 }), cut(b, { dur: 4, fadeIn: true })]),  // 重叠 2s 交叉溶解
 *     ]),
 *   };
 *
 * 规则：
 *   - 硬切 = 两段首尾相接（默认就是硬切，最像剪辑师）
 *   - 转场 = 让两段重叠：par(overlap, [...])，或给 cut 传 { overlap: 0.5 }
 *   - 时间既可以写秒，也可以写 { beat: 16 } / { bar: 4 }，由 music 解析
 *
 * 场景名与 id：id 默认取场景文件名，重复时自动加 _2。id 会出现在 HUD 和错误里。
 *
 * ## 配置档（B 档）：不写场景文件，直接写镜头模板
 *
 * `src/shots/` 的镜头模板可以**直接写进时间线**，没有 `scene`、只有 `type`：
 *
 *   export default {
 *     timeline: [                                   // 数组、seq([...]) 都行
 *       { type: 'title', title: '我的片子', dur: { beat: 8 } },
 *       { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5 },
 *       { type: 'outro', title: '完', dur: 3 },
 *     ],
 *   };
 *
 * 规则（都靠"写错就抛"兜底）：
 *   - **时间线字段**：`type` `id` `dur` `at` `overlap` `params` `post` `maxSamples`
 *     `handlesTransition` `note` `world`/`worldPass`；
 *   - **其余所有键**都当模板参数交给 `shot(type, {…})`（键名写错会抛错并列出可用参数）；
 *   - `id` 不写就用模板自己的默认段名；
 *   - `dur` 不写 = 4 秒（与 `cut(scene)` 一致）；
 *   - 一条时间线里不要混"配置档节点"和**已经展开好的**段（带 start/end 的那种）。
 *   —— 展开发生在 `build()` 里，由 `src/tasks.js` 负责选路；见 `docs/CONFIG-ONLY.md`。
 */

import { shot } from './shots/index.js';

/** 配置档节点：`{ type: 'chart', values: […], dur: 5 }`（只有 type，没有 scene）。 */
export function isConfigNode(node) {
  return !!(node && typeof node === 'object' && typeof node.type === 'string' && node.scene == null);
}

/**
 * 配置档节点里属于**时间线**的键；其余键都是镜头模板的参数。
 * ⚠ 这张表是公开 API：往时间线节点上加新字段时，记得同时加到这里，
 *   否则它会被当成模板参数、被 `shot()` 当成"参数名拼错"抛出去。
 */
const TIMELINE_KEYS = new Set([
  'type', 'id', 'dur', 'at', 'overlap', 'params', 'post', 'maxSamples',
  'handlesTransition', 'note', 'world', 'worldPass',
]);

/**
 * 把配置档节点展开成 `cut()` 的形状。
 *
 * 模板参数 = 节点上除时间线字段以外的**所有**键（也可以显式写在 `params` 里，它优先）。
 * 键名写错会**抛错**：`{ type: 'chart', value: […] }`（少个 s）→ 指名"没有参数 value"，
 * 而不是静默吃默认值画出一张看起来正常的图（`docs/IMPROVEMENTS-2.md` 那类 bug 的通用解法）。
 */
function configToCut(node, where) {
  const { type, id, dur, at, overlap, params, post, maxSamples, handlesTransition, note, world, worldPass, ...rest } = node;
  const tparams = { ...rest, ...(params ?? {}) };
  if (id != null) tparams.id = id;          // ⚠ 不能写成 tparams.id = id：undefined 会盖掉模板默认段名
  let scene;
  try {
    scene = shot(type, tparams);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw new Error(`${where} 这一段（type: ${JSON.stringify(type)}）取不到镜头模板：\n  ${msg}`);
  }
  // 展开后的形状与 cut() 完全一致 —— 后面的排版（start/dur/overlap/id 去重）走同一条路
  return {
    kind: 'cut',
    scene,
    id: id ?? scene.id,
    dur,
    at,
    overlap,
    params: {},
    post,
    maxSamples,
    handlesTransition,
    note,
    world: worldPass ? 'auto' : world,
  };
}

/**
 * 声明一段。
 * @param {any} scene 场景对象、类，或 () => import('./scenes/x.js') 懒加载
 * @param {{ id?: string, dur?: number, params?: Record<string, any>, post?: any,
 *           maxSamples?: number, handlesTransition?: boolean, note?: string,
 *           overlap?: number, at?: number, world?: any, worldPass?: boolean }} [opts]
 *        `world`：这一段用的**共享背景**（两种写法）——
 *          `world: 'auto'`（或 `worldPass: true`）→ 用 ctx.worldPass（task.config 里那个）；
 *          `world: new Pass(...)`                → 这一段专用；
 *          `world: false`                        → 明确表示"本段自己负责整帧底"。
 *        不写 = 场景自己在 render 里画背景（引擎不做任何假设）。
 */
export function cut(scene, opts = {}) {
  return {
    kind: 'cut',
    scene,
    id: opts.id ?? nameOf(scene),
    dur: opts.dur,
    at: opts.at,
    params: opts.params ?? {},
    post: opts.post,
    maxSamples: opts.maxSamples,
    handlesTransition: opts.handlesTransition,
    note: opts.note,
    overlap: opts.overlap ?? 0,
    world: opts.worldPass ? 'auto' : opts.world,
  };
}

/**
 * 顺序排列。每一项依次接上；cut 里给了 overlap 的话就和前一段重叠那么多秒。
 * @param {any[]} items
 * @param {{ start?: number }} [opts]
 */
export function seq(items, opts = {}) {
  if (!Array.isArray(items)) {
    throw new Error(`seq() 需要数组，收到 ${typeName(items)}。写法：seq([cut(a,{dur:4}), cut(b,{dur:6})])`);
  }
  // ⚠ 立刻校验，而不是等到 build()：写错的地方离抛错的地方越近越好排。
  for (let i = 0; i < items.length; i++) assertNode(items[i], `seq([...]) 第 ${i} 项`);
  return { kind: 'seq', items, start: opts.start ?? 0 };
}

/**
 * 并行/重叠：把若干项放在同一个时间起点，用 overlapBefore 控制与前一组重叠多久。
 * @param {number} overlap 与「上一组」的重叠秒数
 * @param {any[]} items
 */
export function par(overlap, items) {
  if (!Array.isArray(items)) {
    throw new Error(`par() 的第二个参数需要数组，收到 ${typeName(items)}。写法：par(0.5, [cut(a,{dur:4})])`);
  }
  for (let i = 0; i < items.length; i++) assertNode(items[i], `par(${overlap}, [...]) 第 ${i} 项`);
  return { kind: 'par', overlap, items };
}

/** 便捷：一段独占 [a, b) 的场景。 */
export function at(a, b, scene, opts = {}) {
  return cut(scene, { ...opts, at: a, dur: b - a });
}

/**
 * 把 seq/par/cut 结构展开成引擎要的扁平时间线。
 * @param {any} plan
 * @param {{ beats?: number[], downbeats?: number[], bpm?: number, duration?: number,
 *           narration?: ReturnType<import('./core/narration.js').makeNarration> }} [music]
 */
export function build(plan, music = {}) {
  /** @type {any[]} */
  const out = [];
  const used = new Map();

  /**
   * 整个 plan 的形状也得先过一遍。两个都会**静默产出空时间线**、然后在很远的地方
   * 报一句"没有场景"：
   *   · 漏了 seq()/数组：`timeline: { scene, dur: 4 }`；
   *   · 认不出的 kind：`timeline: { kind: 'sequence', items: [...] }`（拼错了名字）。
   */
  if (!Array.isArray(plan) && !(plan && typeof plan === 'object' && plan.kind)
      && !(plan && typeof plan === 'object' && plan.scene)
      && !isConfigNode(plan)) {
    throw new Error(
      `build() 收到的不是时间线：${plan === undefined ? 'undefined' : previewKeys(plan)}\n` +
      `  task.config.mjs 里应该写 timeline: seq([cut(a,{dur:4}), …]) 或 timeline: [cut(…)]。`,
    );
  }
  if (plan && typeof plan === 'object' && plan.kind && !['seq', 'par', 'cut'].includes(plan.kind)) {
    throw new Error(
      `build() 认不出这个时间线节点：kind = ${JSON.stringify(plan.kind)}\n` +
      `  只认 'seq' / 'par' / 'cut'（由 seq() / par() / cut() 产出）。` +
      (typeof plan.kind === 'string' ? ` 你是不是想写 '${plan.kind.trim().toLowerCase()}'？` : ''),
    );
  }
  assertNode(plan, 'timeline');

  const resolveTime = (v, fallback) => {
    if (v == null) return fallback;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && v.beat != null) return beatTime(music, v.beat);
    if (typeof v === 'object' && v.bar != null) return beatTime(music, v.bar * 4);
    return fallback;
  };

  // 「配置档节点」与「已经展开好的段」混在同一条时间线里 → 后者会被重新排一遍、
  // 绝对时间被静默丢掉。这类混写没有正当用法（两种写法各写各的），所以直接抛。
  let sawConfig = false;
  let sawLaidOut = false;

  /** 返回这一组结束的时刻 */
  const walk = (node, cursor, where) => {
    if (Array.isArray(node)) {
      let c = cursor;
      for (let i = 0; i < node.length; i++) c = walk(node[i], c, `${where}[${i}]`);
      return c;
    }
    if (!node) return cursor;
    if (node.kind === 'seq') {
      let c = resolveTime(node.start, cursor);
      const items = Array.isArray(node.items) ? node.items : [];
      for (let i = 0; i < items.length; i++) c = walk(items[i], c, `${where}.items[${i}]`);
      return c;
    }
    if (node.kind === 'par') {
      const start = Math.max(0, cursor - (node.overlap ?? 0));
      let end = start;
      const items = Array.isArray(node.items) ? node.items : [];
      for (let i = 0; i < items.length; i++) {
        const e = walk(items[i], start, `${where}.items[${i}]`);
        if (e > end) end = e;
      }
      return end;
    }
    // 走到这里必须是一个 cut。`seq([...])` / `par()` 已经在构造时校验过，
    // 但**手搓的 plan**（`timeline: { kind:'seq', items:[...] }`，或整个 plan 写错）
    // 绕过了那层 —— 所以这里再兜一次底（P0-2：静默降级比直接报错贵得多）。
    if (node.kind !== 'cut') assertNode(node, where);
    // 配置档（B 档）：`{ type: 'chart', values: […], dur: 5 }` —— 在这里展开成 cut 的形状，
    // 后面的排版逻辑（start/dur/overlap/id 去重）与手写场景走**同一条路**。
    if (isConfigNode(node)) sawConfig = true;
    else if (!node.kind && node.scene && typeof node.start === 'number' && typeof node.end === 'number') sawLaidOut = true;
    const c = isConfigNode(node) ? configToCut(node, where) : node;
    const start = resolveTime(c.at, Math.max(0, cursor - (c.overlap ?? 0)));
    // dur 也支持 { beat: 8 } / { bar: 2 }：用拍网格算，镜头长度天然对齐音乐
    // 以及 { vo: 'line-id' }：直接取某句旁白的时长（`docs/NARRATION.md` A 档）——
    // 省掉"在外面把每句话量一遍、再手抄回时间线"这一步。
    const dur = resolveDur(c.dur, music, 4);
    let id = c.id || 'scene';
    if (used.has(id)) { const n = used.get(id) + 1; used.set(id, n); id = `${id}_${n}`; } else used.set(id, 1);
    out.push({
      id,
      scene: c.scene,
      start,
      end: start + dur,
      params: c.params,
      post: c.post,
      maxSamples: c.maxSamples,
      handlesTransition: c.handlesTransition,
      note: c.note,
      // 共享背景：'auto' = 用 task.worldPass；对象 = 本段专用 Pass；false = 本段自己负责底
      world: c.world,
    });
    return start + dur;
  };

  walk(plan, 0, 'timeline');
  if (sawConfig && sawLaidOut) {
    throw new Error(
      '时间线里不能混写「配置档节点」和「已经展开好的段」：\n' +
      '  · 配置档节点 = { type: \'chart\', values: […], dur: 5 }（要由 build() 排时间）；\n' +
      '  · 展开好的段 = { id, scene, start, end, … }（绝对时间是有意义的）。\n' +
      '  build() 会把后者也当成一个节点重新排，它的 start/end 就被静默丢掉了。\n' +
      '  → 统一成一种写法：都写配置档，或者都写 cut()/seq()。',
    );
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/* ------------------------------------------------------------------ 校验 */

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'Array';
  return typeof v;
}

/** 只打印前几个 key，别把一个巨大的对象灌进日志 */
function previewKeys(v) {
  try {
    const ks = Object.keys(v);
    return ks.length ? `{ ${ks.slice(0, 6).join(', ')}${ks.length > 6 ? ', …' : ''} }` : '{}';
  } catch { return String(v); }
}

/**
 * 校验一个"应该长成时间线节点"的东西 —— 不是就**立刻抛错**。
 *
 * 为什么必须抛（`docs/IMPROVEMENTS-2.md` P0-2）：做 beast 时我写了个助手
 * `const seg = (id) => ({ scene: SHOT[id], opt: {...} })`，忘了让它返回 `cut(scene, opt)`。
 * 旧 `seq()` 照单全收，引擎把它当成 N 段匿名场景：每段默认 4 秒 → `check` 报
 * 「时长 48.00s、段名 scene/scene_2/…」，真实时间线是 127.5s / 12 个具名段，
 * 而末尾照样打印 `✓ 没有发现问题`。**片长和段名全错，却一路绿灯** —— 这类静默降级
 * 比直接报错贵得多（我会照着错的时间线去调镜头长度）。
 *
 * 判据（两条，都是"必然写错"的形状）：
 *   ① 有 `kind` —— cut() / seq() / par() 的返回值，放行；
 *   ② 没有 `kind`，但有 `scene` —— **必须同时给出 `dur` 或 `end`**，那才算"手写了一整段"。
 *      只给 `{ scene, opt }` / `{ scene }` 一律拒绝：那正是"忘了调 cut()"的形状，
 *      而 `opt`（本该是 `params`/`dur`/`overlap`）会被静默丢掉、每段退化成默认 4 秒。
 */
export function assertNode(node, where = 'timeline') {
  // 数组 = 一串节点（`timeline: [ {...}, {...} ]` 的配置档写法就走这条），walk() 会逐项走
  if (Array.isArray(node)) return node;
  if (node && typeof node === 'object' && node.kind) return node;
  if (node && typeof node === 'object' && node.scene && (node.dur != null || node.end != null)) return node;
  // 配置档（B 档）：`{ type: 'chart', … }` —— 形状本身就无歧义，不要求给 dur（不给 = 4 秒）
  if (isConfigNode(node)) return node;

  const got = node && typeof node === 'object' ? previewKeys(node) : `${typeName(node)} ${String(node)}`;
  const looksLikeForgottenCut = !!(node && typeof node === 'object' && node.scene);
  throw new Error(
    `这不是时间线节点：${where} = ${got}\n` +
    `  时间线的每一项必须是 cut(scene, { dur }) / seq([...]) / par(秒, [...]) / at(a, b, scene) 的返回值，\n` +
    `  或者一个**配置档节点**：{ type: 'chart', values: […], dur: 5 }（见 docs/CONFIG-ONLY.md）；\n` +
    `  手写整段的话要给出时长：{ scene, dur: 4 } 或 { scene, start: 0, end: 4 }。\n` +
    (looksLikeForgottenCut
      ? `  ⚠ 有 scene 但没有时长 —— 你是不是忘了调 cut()？\n` +
        `     把 \`{ scene: SHOT[id], opt: {...} }\` 改成 \`cut(SHOT[id], {...})\`；\n` +
        `     否则 opt 里的 dur/overlap/params 会被全部忽略，每段退化成默认 4 秒。`
      : `  ⚠ 检查这里是不是拼错了变量（比如写成了 undefined），或者 type 写成了非字符串。`),
  );
}

/**
 * 把秒数 / `{ beat }` / `{ bar }` / `{ vo }` 解析成秒。
 *
 * `{ vo: 'line-id' }` 取的是**那句旁白自己的时长**（不是"到下一句之前"）——
 * 于是 `cut(shot, { dur: { vo: 'hook-1' } })` 的意思是"这一段和这句话一样长"。
 * 句子不存在时抛错（名字写错要立刻知道，别静默退化成默认 4 秒）。
 *
 * @param {any} v
 * @param {{ beats?: number[], bpm?: number, narration?: any }} music
 * @param {number} fallback
 */
function resolveDur(v, music, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.beat != null) return beatTime(music, v.beat) - beatTime(music, 0);
  if (typeof v === 'object' && v.bar != null) return beatTime(music, v.bar * 4) - beatTime(music, 0);
  if (typeof v === 'object' && v.vo != null) {
    const id = String(v.vo);
    const line = music?.narration?.lines?.find((l) => l.id === id);
    if (!line) {
      const known = (music?.narration?.lines ?? []).map((l) => l.id);
      throw new Error(
        `dur: { vo: '${id}' } 找不到这句旁白。` +
        (known.length
          ? `\n  旁白表里有：${known.join(', ')}`
          : `\n  任务没有配 narration（task.config.mjs 里加 narration: './narration.json' 或内联 { lines: [...] }）。`) +
        `\n  ⚠ 别把它静默当成默认 4 秒 —— 段长错了会让整条时间线跟着错。`,
      );
    }
    if (v.tail != null) return line.dur + Number(v.tail);
    return line.dur;
  }
  return fallback;
}

function beatTime(music, beat) {
  const b = music?.beats ?? [];
  if (!b.length) return (beat * 60) / (music?.bpm || 120);
  const k = Math.floor(beat);
  const frac = beat - k;
  if (k < 0) return b[0] + k * (60 / (music.bpm || 120));
  if (k + 1 < b.length) return b[k] + frac * (b[k + 1] - b[k]);
  if (b.length) {
    const p = b.length > 1 ? b[b.length - 1] - b[b.length - 2] : 60 / (music.bpm || 120);
    return b[b.length - 1] + (k - b.length + 1 + frac) * p;
  }
  return (beat * 60) / (music?.bpm || 120);
}

/** 从懒加载函数或类里猜一个名字，做默认 id。 */
function nameOf(scene) {
  if (typeof scene === 'string') return scene;
  if (typeof scene === 'function') {
    const s = String(scene);
    const m = s.match(/scenes\/([\w.-]+)\.js/);
    if (m) return m[1];
    return scene.name || 'scene';
  }
  if (scene?.default) return nameOf(scene.default);
  // 场景对象可以自己声明 id（推荐：一眼能在 HUD/错误里认出是哪段）
  if (scene?.id) return scene.id;
  if (scene?.constructor?.name && scene.constructor.name !== 'Object') return scene.constructor.name;
  return 'scene';
}

/** 懒加载一个场景模块：cut(() => import('./scenes/x.js')) 的简写 */
export function lazy(loader) { return loader; }

/** 打印时间线（CLI 的 tasks/check 用）。 */
export function describe(timeline) {
  return timeline.map((i) =>
    `  ${String(i.id).padEnd(14)} ${i.start.toFixed(2).padStart(8)} → ${i.end.toFixed(2).padStart(8)}  (${(i.end - i.start).toFixed(2)}s)${i.note ? '  ' + i.note : ''}`
  ).join('\n');
}
