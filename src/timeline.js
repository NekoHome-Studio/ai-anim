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
  // 主体声明（版面守门，docs/LAYOUT.md）：配置档节点上也写得了 ——
  // 不加进这张表它就会被当成模板参数，"参数名拼错"抛出去（正是这张表存在的理由）。
  'focus',
]);

/**
 * 把配置档节点展开成 `cut()` 的形状。
 *
 * 模板参数 = 节点上除时间线字段以外的**所有**键（也可以显式写在 `params` 里，它优先）。
 * 键名写错会**抛错**：`{ type: 'chart', value: […] }`（少个 s）→ 指名"没有参数 value"，
 * 而不是静默吃默认值画出一张看起来正常的图（`docs/history/IMPROVEMENTS-1-3.md` 那类 bug 的通用解法）。
 */
function configToCut(node, where) {
  const { type, id, dur, at, overlap, params, post, maxSamples, handlesTransition, note, world, worldPass, focus, ...rest } = node;
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
    focus,
  };
}

/**
 * 声明一段。
 * @param {any} scene 场景对象、类，或 () => import('./scenes/x.js') 懒加载
 * @param {{ id?: string, dur?: number, params?: Record<string, any>, post?: any,
 *           maxSamples?: number, handlesTransition?: boolean, note?: string,
 *           overlap?: number, at?: number, world?: any, worldPass?: boolean,
 *           focus?: 'center'|{x:number,y:number,w:number,h:number}|{cx:number,cy:number,w:number,h:number} }} [opts]
 *        `world`：这一段用的**共享背景**（两种写法）——
 *          `world: 'auto'`（或 `worldPass: true`）→ 用 ctx.worldPass（task.config 里那个）；
 *          `world: new Pass(...)`                → 这一段专用；
 *          `world: false`                        → 明确表示"本段自己负责整帧底"。
 *        不写 = 场景自己在 render 里画背景（引擎不做任何假设）。
 *        `focus`：**主体声明**（版面守门，见 docs/LAYOUT.md）—— 「这一段观众看哪里」。
 *        不写时引擎会退回场景对象自己声明的那份（`export default { focus: 'center' }`）。
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
    // 主体声明（版面守门）：与 world 一样在这里白名单化 —— 忘了这一行就会静默丢失
    focus: opts.focus,
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
      // 主体声明（版面守门，见 docs/LAYOUT.md）：搬运到段上，引擎的 ctx.focus 读它。
      // 场景对象自己也可以声明一份（engine 里是 `item.focus ?? scene.focus`），
      // 段上这份优先 —— 同一支片子里某一段想换主体时不必去改场景文件。
      focus: c.focus,
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
 * 为什么必须抛（`docs/history/IMPROVEMENTS-1-3.md` P0-2）：做 beast 时我写了个助手
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

/**
 * **段级审计：依赖令牌 `under` 真的满足吗？**（BACKLOG 头部 ② 的收口，2026-10-16）
 *
 * 为什么这件事必须放在**时间线展开之后**做：`whip` 这类转场模板的画面来自
 * 「把上一段的成帧（`ctx.under`）甩走」，而引擎只在**两段交叠的那一小段**里给得出 `ctx.under`
 * （`src/core/engine.js` 的 `under: k > 0 ? under : null` —— 交叠窗之外这一段就是
 * `items[0]`，没有"上一段"）。所以"交叠够不够"只在 `build()` 排完时间之后才是个事实，
 * 而**任务源码文本**里看不出来（对象可以跨行、可以 `seq()` 拼、`--only` 之后段表还会变）——
 * 这正是 1-21 当初把 `under` 记成"只声明、没接线"的理由（"假报比不报贵"）。
 *
 * 现在段对象自己带着模板的 `requires`（`src/shots/index.js` 的 `shot()` 搬运），
 * 于是这条依赖可以**判准**，而不是靠猜：
 *
 *   · `missing`           —— 这一段是**第一段**（`i === 0`）之外的段，却与**上一段没有交叠**
 *     （`start >= prev.end`）。`ctx.under` 恒为 `null` ⇒ 模板退回"没有 under"那条分支，
 *     甩镜类画面**几乎是黑的**，而且不报错。**这是硬问题**。
 *   · `noPrev`            —— 它就是第一段：没有"上一段"可比，**不判**。
 *     （`--only` 会把选中的段平移到时间轴开头，所以这条同样覆盖"只挑一段试渲染"的场景。
 *      `noPrev` **不是通过** —— "`空 ≠ 干净`"，调用方必须把这句说出来。）
 *   · `doubleTransition`  —— 与上一段交叠了，但**没声明 `handlesTransition`**：
 *     引擎于是会在这上面再叠一次交叉溶解（`engine.js` 的 `k > 0 && !scene.handlesTransition`），
 *     "甩走"被稀释成两屏叠一起。**是观感问题，不是没画**。
 *
 * 判据全部来自**已展开的段对象**（`start` / `end` / `handlesTransition` / `requires`），
 * 不读源码文本、不猜，所以可以离线单测（`tools/test-timeline-audit.mjs`）。
 *
 * ⚠ 场景对象有两个放法，两个都要认：`build()` 的产物放在 `scene`（还没解析），
 *   引擎跑起来之后是 `_scene`（setup 过的那个）。**单测就是这么发现漏的** ——
 *   只认 `_scene` 时，`build()` 直接喂进来的一条都查不到（"零命中"看着像"全都满足"）。
 *
 * ⚠ 口径必须与引擎**逐字一致**：`handlesTransition` 读**场景**那一份兜底
 *   （`it.handlesTransition ?? it._scene?.handlesTransition`）——
 *   配置档节点上没写时段对象上是 `undefined`，而模板自带的那份在**场景**上
 *   （背景守门 ① 就是因为两者不齐而少算了一段）。
 *
 * @param {any[]} items `build()` 的产物（或引擎 `engine.timeline`）
 * @returns {{ id: string, index: number, start: number, end: number, requires: string[],
 *             handlesTransition: boolean, overlaps: boolean, noPrev: boolean,
 *             missing: boolean, doubleTransition: boolean }[]}
 */
export function auditUnderRequires(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i] ?? {};
    // ⚠ 场景对象有两个放法，两条路都要认（单测就是这么发现漏的）：
    //   · `build()` 的产物把场景放在 `scene`（还没解析）；
    //   · 引擎跑起来之后是 `_scene`（setup 过的那个，`engine.js` 里赋值）。
    //   优先 `_scene`，回落到 `scene`。
    const scene = it._scene ?? it.scene ?? null;
    const req = Array.isArray(it.requires) ? it.requires
      : (Array.isArray(scene?.requires) ? scene.requires : null);
    if (!req || !req.includes('under')) continue;
    const handlesTransition = !!(it.handlesTransition ?? scene?.handlesTransition);
    const prev = i > 0 ? list[i - 1] : null;
    // ⚠ 与背景守门同一条判据：比 start 与上一段的 end，不是比结束时刻
    //   （结束时刻被 overlap 推走过，用它判断会把整段漏掉）。
    const overlaps = !!prev && Number(it.start) < Number(prev.end);
    const noPrev = i === 0;
    out.push({
      id: String(it.id ?? `scene_#${i}`),
      index: i,
      start: Number(it.start ?? 0),
      end: Number(it.end ?? 0),
      requires: [...req],
      handlesTransition,
      overlaps,
      noPrev,
      missing: !noPrev && !overlaps,
      doubleTransition: !noPrev && overlaps && !handlesTransition,
    });
  }
  return out;
}

/**
 * **背景守门的采样计划**（纯函数，BACKLOG 头部 ①⑦ 的收口，2026-10-16）。
 *
 * 为什么要抽出来：`src/app.js` 的 `worldAudit()` 要"渲染一帧、看它有没有铺底"，
 * 而**在哪几个时刻渲染、哪几段判、哪几段只给读数**全是纯逻辑 —— 混在页面侧的 GPU 代码里就
 * 只能靠肉眼验证。抽到这里之后，`tools/test-timeline-audit.mjs` 能离线钉住三件事：
 *
 *   ① **采两个时刻**：交叠窗中点（**判**"这一段铺没铺底"）+ **交叠窗之后的中点**（**只读数**）。
 *      以前只有前者，于是"交叠窗之外那一秒"连个数字都没有（`_config-lab` 的甩镜
 *      19.50–20.50 就是这样一段没人看的区间）。段短到没有窗后部分时只采一个点。
 *      ⚠ 窗后点**不参与判据** —— 理由与实测数字在 `worldAuditVerdict()` 的注释里。
 *   ② **口径与引擎逐字一致**：`handlesTransition` 读段上那份，段上没有读**场景**那份
 *      （`_scene` 或 `scene`；引擎读的是场景那份 —— 配置档节点没写时它到不了段对象）。
 *   ③ **`world: false` 的段单独一类**：`judged: false`（"整帧底我自己负责"是合法声明，
 *      不判它铺没铺底），但**照样给采样时刻** —— 声明不等于"这段没人看着"。
 *
 * 判据（与 `worldAudit()` 里的注释同一份）：只查"与前一段交叠"的段 ——
 * 只有那时才有转场语义（`tin` / `tout` / `under` 才有意义）。比较用 `start < prev.end`，
 * **不是**比结束时刻（结束时刻被 overlap 推走过，用它判断会把整段漏掉）。
 *
 * @param {any[]} items `build()` 的产物或引擎的 `engine.timeline`
 * @returns {{ id: string, index: number, start: number, end: number, times: number[],
 *             handlesTransition: boolean, selfBase: boolean, declaredWorld: string,
 *             risky: boolean, judged: boolean }[]}
 */
export function planWorldAudit(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (let i = 1; i < list.length; i++) {
    const it = list[i] ?? {}, prev = list[i - 1] ?? {};
    const start = Number(it.start ?? 0), end = Number(it.end ?? 0), prevEnd = Number(prev.end ?? 0);
    if (!(start < prevEnd)) continue;                 // 没有交叠 ⇒ 没有转场语义 ⇒ 不查
    const scene = it._scene ?? it.scene ?? null;
    const handlesTransition = !!(it.handlesTransition ?? scene?.handlesTransition);
    const selfBase = it.world === false;
    const declaredWorld = selfBase ? 'self' : (it.world === 'auto' ? 'auto' : (it.world ? 'custom' : 'none'));
    // 只有"声明了 handlesTransition / 转场"的段会被判为问题：
    // 没有转场语义的简单段清个底色就够了，不该被要求画全屏 Pass。
    const risky = handlesTransition || declaredWorld !== 'none';
    const span = Math.min(prevEnd, end) - start;
    const times = [start + Math.max(0.02, span * 0.5)];
    const tailSpan = end - prevEnd;
    if (tailSpan > 0.05) times.push(prevEnd + tailSpan * 0.5);
    out.push({
      id: String(it.id ?? `scene_#${i}`), index: i, start, end, times,
      handlesTransition, selfBase, declaredWorld, risky,
      /** `judged === false` ⇒ 只给读数，不判"铺没铺底"（当前只有 `world: false` 这一类） */
      judged: !selfBase,
    });
  }
  return out;
}

/**
 * **背景守门的判定**（纯函数）：把采样计划 + 每一刻的绘制账目/亮度变成两个事实。
 *
 * ⚠ 这一条是**踩过假报之后**才长成这样的（2026-10-16，BACKLOG 头部 ⑦）：
 *   · **判据只落在第一个采样点（交叠窗中点）**：`full === 0 && risky` ⇒ `missing`。
 *   · 第二个采样点（**交叠窗之后**的中点）**只做读数，不判**。
 *     为什么：`ctx.under` 只在交叠窗里有值 ⇒ 窗后那一段，转场模板走的是"没有 under"的分支，
 *     而那条分支**本来就可能是近黑的**（`whip` 的设计：把画面甩走之后只剩
 *     `col *= mix(1.0, 0.15, k)` 压出来的 15% + 颗粒，实测 0.037–0.051，
 *     `tasks/demo` 与 `tasks/_config-lab` 都是这个数）。第一版把同一条 `full === 0` 判据
 *     也压在窗后点上，于是 `check demo` 当场把一个**设计如此**的尾巴报成了"没铺背景"——
 *     "假报比不报更贵"，所以窗后点退回成读数。
 *   · `blackTail` 是**读数型**的事实（窗后中点 < 0.004）：它不 gate，只给报告一行 ——
 *     真正"拿不到 under"那种事故由**段级审计**（`auditUnderRequires()`，没有交叠 ⇒ 硬问题）抓住。
 *
 * @param {{ judged?: boolean, risky?: boolean }|null} plan `planWorldAudit()` 的一项
 * @param {{ full?: number, mean?: number, error?: string }[]} samples 按计划渲染出来的读数
 * @returns {{ missing: boolean, blackTail: boolean, tail: object|null }}
 */
export function worldAuditVerdict(plan, samples) {
  const p = plan ?? {};
  const list = Array.isArray(samples) ? samples : [];
  const first = list[0] ?? null;
  const tail = list.length > 1 ? list[1] : null;
  // `world: false`（"整帧底我自己负责"）不进这条判据 —— 那是它的声明
  const missing = !!p.judged && !!p.risky && !!first && !first.error && first.full === 0;
  const blackTail = !!p.risky && !!tail && !tail.error
    && typeof tail.mean === 'number' && tail.mean < 0.004;
  return { missing, blackTail, tail };
}

/** 打印时间线（CLI 的 tasks/check 用）。 */
export function describe(timeline) {
  return timeline.map((i) =>
    `  ${String(i.id).padEnd(14)} ${i.start.toFixed(2).padStart(8)} → ${i.end.toFixed(2).padStart(8)}  (${(i.end - i.start).toFixed(2)}s)${i.note ? '  ' + i.note : ''}`
  ).join('\n');
}
