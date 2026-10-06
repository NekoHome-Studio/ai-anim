// @ts-check
/**
 * `makeShot()` —— 把"一个镜头该有的骨架"包成一个函数。
 *
 * 手写一个镜头要记住四件事，而**漏掉任何一件都不会报错**：
 *
 *   1. `handlesTransition: true`（否则引擎会先做交叉溶解，两屏字叠一起）
 *   2. `render` 第一句画共享背景（漏了 → 整段纯黑，只有 grain 和暗角）
 *   3. 交叠期把上一帧甩走（否则旧画面原地淡出，显得"顿"）
 *   4. 返回 `cameraPost(f.t, {...})`（否则切镜头时摄影机断掉）
 *
 * 这支引擎反复讲的原则是「能用框架封死的，绝不靠约定和注释」，
 * 所以这里把它们封成一个函数：
 *
 * ```js
 * // scenes/chart.js
 * import { makeShot } from '../../../src/kit/index.js';
 *
 * export default makeShot('chart', {
 *   setup(ctx) { this.bars = [...]; },              // 可选：只调一次
 *   draw(ctx, { k, dx, dy, enter }) {               // 画前景（背景已经铺好了）
 *     const { f, lines, P, text, type } = ctx;
 *     lines.begin();
 *     // …用 dx/dy 做入场位移、用 k 做入场进度…
 *     lines.flush(ctx.out);
 *     text.clear();
 *     type.writeLine('标题', 960, 400, { anchor: 'center', ...enter(0.3) });
 *     text.upload();
 *     ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false });
 *     return { bloom: 0.3, grain: 0.02 };           // 这一帧的 post（可选）
 *   },
 *   post: { bloom: 0.3 },                           // 每帧固定的 post（可选）
 * });
 * ```
 *
 * `draw` 的第二个参数：
 *   · `k`     入场进度（1 = 站稳）
 *   · `dx/dy` 入场位移（已经从反方向落位，直接加到坐标上）
 *   · `enter(delay)` 返回一行文字的 `fade()` 选项（省得自己算时间）
 *
 * 想让引擎铺背景（`cut(shot, { world: 'auto' })`）也行 —— `openFrame` 优先用
 * `ctx.world`，两者不冲突。
 */

import { makeWorldKit, cameraPost, enterOffset } from './world.js';
import { fade } from './layout.js';

/**
 * @param {string} id 段名（出现在 HUD 与报错里）
 * @param {{
 *   setup?: (ctx: any) => void,
 *   draw: (ctx: any, helpers: { k: number, dx: number, dy: number, enter: (delay?: number, to?: number, dur?: number) => any }) => any,
 *   post?: Record<string, any>,
 *   world?: (ctx: any) => any,
 *   handlesTransition?: boolean,
 *   id?: string,
 * }} spec
 */
export function makeShot(id, spec) {
  return {
    id: spec.id ?? id,
    // 默认自己处理转场：makeShot 已经负责"把上一帧甩走"了
    handlesTransition: spec.handlesTransition ?? true,

    setup(ctx) {
      this.wk = makeWorldKit(ctx);
      // 这一段自己的背景（可选）。没有就用引擎的 ctx.world / 什么都不画。
      if (spec.world) this.wk.setBackground(spec.world(ctx));
      spec.setup?.call(this, ctx);
    },

    render(ctx) {
      const k = this.wk.openFrame(ctx);
      const [dx, dy] = enterOffset(ctx.f.t, k);
      const enter = (delay = 0, to = 1, dur = 0.45) => fade(ctx.f.lt, delay, to, dur);
      const ov = spec.draw.call(this, ctx, { k, dx, dy, enter });
      const post = { ...(spec.post ?? {}), ...(ov && typeof ov === 'object' ? ov : {}) };
      // 摄影机永远由整片时间驱动；具体观感用 spec.post / draw 的返回值给
      return cameraPost(ctx.f.t, post);
    },
  };
}

/** `makeShot` 的别名，读起来更像"这是一个镜头模板"。 */
export const shot = makeShot;
