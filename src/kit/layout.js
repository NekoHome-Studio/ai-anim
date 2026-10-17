// @ts-check
/**
 * 排版工具：反复要写、与具体片子无关的那几个。
 *
 * 这个文件**不碰 GPU**（只操作 TextKit 这个已经在手上的对象），可以单独测。
 * 画在 `lines` 上的版面元件（panel / kicker / reticle / marker…）在 `elements.js`。
 *
 * 颜色约定：Canvas2D 的文字一律 `css(P.xxx)`（线性 → sRGB 字符串）；
 * `lines` 的矢量一律 `P.xxx`（线性，可 > 1 用来发光）。
 */

import { rng, css as cssOf, clamp } from '../core/util.js';

/** 颜色乘系数（lines 的线性亮度可以 > 1，用来发光）。 */
export function mul(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** 给颜色加 alpha：`lines` 的颜色支持第 4 个分量，混合是 premultiplied 的（真半透明叠加）。 */
export function withAlpha(c, a) {
  return [c[0], c[1], c[2], a];
}

/** 夹到 0..1（`sat` 的别名，方便场景里少 import 一个名字）。 */
export function sat01(x) {
  return clamp(x, 0, 1);
}

/**
 * 按锚点写一行字。
 *
 * ⚠ 这是为了绕开一个真实的坑：`type.write` 是**逐字素簇** `fillText`，`textAlign`
 * 对每个字都生效，所以 `align: 'center'` 会让每个字各自居中、整行跑偏。
 * 引擎现在有 `type.writeLine(text, x, y, { anchor })` 做同一件事，这里是一层转发
 * （保留 `put` 这个名字，已经写了它的任务代码不用改）。
 *
 * @param {any} type TextKit
 * @param {string} str
 * @param {number} x @param {number} y
 * @param {{ anchor?: 'left'|'center'|'right' } & Record<string, any>} [opts]
 * @returns {number} 这一行的宽度（含 tracking）
 */
export function put(type, str, x, y, opts = {}) {
  return type.writeLine(str, x, y, opts);
}

/** `type.writeLine` 的直接转发（新代码可以直接用引擎那个，不必经过这里）。 */
export function writeLine(type, str, x, y, opts = {}) {
  return type.writeLine(str, x, y, opts);
}

/**
 * 整行淡入的选项工厂。
 *
 * 以前这里必须塞一个 `stagger: 1e-4` 才能让 `alpha` 生效（引擎的老 bug：
 * `k` 只在 `stagger > 0` 时才随时间走）。那个 bug 已经修了（`docs/history/IMPROVEMENTS-1-3.md` P1-3），
 * 所以现在就是干净的 `alpha: [0, to]`。
 *
 * ```js
 * type.write('标题', x, y, { ...fade(f.lt, 0.4), size: 96, color: css(P.bone) });
 * ```
 *
 * ⚠ **`alpha` 的两种写法语义不同**（`docs/history/IMPROVEMENTS-1-3.md` P0-1）：
 *   · `alpha: [a0, a1]`（数组，就是这个函数返回的）—— 随 t 从 a0 插值到 a1，**必须配 `t`**；
 *   · `alpha: 0.6`（数值）—— **常量**不透明度，与 t 无关。
 *   数值型 alpha 曾经被误当成"要动画"并取到 `k = 0`，于是整个字形**不画**（画面上一整块字消失）。
 *   想写固定不透明度就直接写数值，别为了"保险"写成 `[0.6, 0.6]`（那会引入对 `t` 的依赖）。
 *
 * @param {number} t 场景局部时间
 * @param {number} delay 延迟（秒）
 * @param {number} [to] 终值不透明度
 * @param {number} [dur] 淡入时长
 */
export function fade(t, delay, to = 1, dur = 0.5) {
  return { alpha: [0, to], t: t - delay, staggerDur: dur };
}

/** 打字机：返回前 k 比例个字符（确定性）。 */
export function typed(str, k) {
  return str.slice(0, Math.max(0, Math.min(str.length, Math.floor(k * str.length))));
}

/**
 * 等宽字体里的一行"代码"：segs 是 `[{ s, c }]`，按顺序画，返回总宽度。
 * 做协议名/参数/命令这类机器口吻的排版很有用。
 */
export function codeRow(type, segs, x, y, opts = {}) {
  let cx = x;
  for (const sg of segs) {
    const w = type.measure(sg.s, opts);
    type.write(sg.s, cx, y, { ...opts, align: 'left', color: sg.c });
    cx += w;
  }
  return cx - x;
}

/** 确定性随机序列（永远不要用 Math.random —— 一帧会被拆成多个子帧乱序渲染）。 */
export function seqRnd(seed, n) {
  const r = rng(seed);
  return Array.from({ length: n }, () => r());
}

/** 便捷：两个颜色按 k 二选一（做"亮/暗"两套配色时省事）。 */
export function contrast(a, b, k) {
  return k < 0.5 ? a : b;
}

export { cssOf as css };
