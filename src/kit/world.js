// @ts-check
/**
 * 「一条走完全片的背景 + 一台走完全片的摄影机」。
 *
 * 这是让镜头切换不"跳"的那套配方（四条，缺一条就露馅 —— 详见 `docs/ENGINE.md`
 * 与 `src/core/trans.js` 顶部的说明）：
 *
 *   ① 全片只有一层背景：同一个 shader、参数只由**整片时间 `f.t`** 驱动
 *      → 切点两侧的背景逐像素一致，世界没有变，只有前景在换。
 *   ② 全片一台摄影机：`cameraPost(f.t, {...})` 交给 post 的 zoom/shake，全帧一起动。
 *   ③ 一个走完全片的母题：一条指针 / 一道扫描线 / 一颗星。眼睛有得跟，切了也像没切。
 *   ④ 交叠期把上一帧甩走，新内容从**反方向**落位。
 *
 * ## 为什么这一层在引擎里
 *
 * 这套配方在 NekoHome 那支片子里验证过，但**只存在于那份任务代码的注释里**；
 * 下一支片子（fidus）又把 `worldPass` / `camAt` / `camDir` / `transPass` / `cutOut`
 * 各写了一遍，而且 9 段里 8 段漏了调用 —— 于是那 8 段的底是纯黑且不报错。
 * 现在形状是：
 *
 * ```js
 * // task.config.mjs
 * export const world = (ctx) => worldPass(ctx, { grid: 60, accent: ctx.P.cyan });
 *
 * // scenes/shot.js
 * export default {
 *   id: 'shot_a',
 *   handlesTransition: true,
 *   setup(ctx) { this.wk = makeWorldKit(ctx); },
 *   render(ctx) {
 *     const k = this.wk.openFrame(ctx);          // ← 不会再漏：漏了 check 会报
 *     const [dx, dy] = enterOffset(ctx.f.t, k);
 *     // …前景…
 *     return cameraPost(ctx.f.t, { bloom: 0.3 });
 *   },
 * };
 * ```
 *
 * 更省事的写法是 `makeShot()`：把 openFrame / 摄影机 / post 全包好，
 * 场景只需要画前景（见 `src/kit/shot.js`）。
 */

import { Pass } from '../core/gl.js';
import { clamp, sat } from '../core/util.js';
import { transitionPass as coreTransitionPass } from '../core/trans.js';

/**
 * 把「上一段那一帧」沿摄影机方向甩出去，并加方向拖尾。
 *
 * 与交叉溶解的区别：溶解是「两张图叠在一起」，甩出去是「镜头没停，画面被带走了」。
 * 位移随 k **加速**（k²），拖尾宽度同时变宽 —— 这两个一起给速度感；
 * 透明度在 k=0.55 之前就降到 0，避免两屏文字长时间叠着。
 *
 * 实现在 `src/core/trans.js`（引擎级），这里只做转发 —— 同一件事不该有第二份实现。
 * @param {{ push?: number, blur?: number, fadeAt?: number, key?: string }} [opts]
 */
export function transitionPass(gl, opts = {}) {
  return coreTransitionPass(gl, opts);
}

/**
 * 全片共用的背景 Pass：一层可参数化的"坐标系网格 + 取样带"。
 *
 * 它是**通用底**，不是某一支片子的视觉：想要自己的世界就照这个签名写一个
 * `(ctx) => Pass`，只要保证「参数只跟整片时间走」这一条。
 * 这里的 `warp` 是留给"世界还没对齐"这类叙事的旋钮（0 = 正，1 = 完全歪）。
 *
 * @param {any} ctx SceneCtx（只要有 gl 和 P；task.config 里传的就是这个）
 * @param {{ grid?: number, sweep?: number, warp?: number, accent?: number[], vignette?: number }} [opts]
 */
export function worldPass(ctx, opts = {}) {
  const P = ctx.P;
  const grid = opts.grid ?? 60;
  const accent = opts.accent ?? P.cyan ?? P.signal;
  const vig = opts.vignette ?? 0.9;
  return new Pass(ctx.gl, /* glsl */ `
    uniform vec3 cInk, cInk2, cLine, cAccent;
    uniform float warp, spacing, sweep, vig;
    void main() {
      vec2 res = RES_LOGICAL;
      vec2 q = FRAG_PX;
      vec2 c = res * vec2(0.5, 0.46);

      // 「还没解算出来」的坐标系：平移 + 一点点旋转的错位
      vec2 d = (q - c) / res.y;
      vec2 off = vec2(
        sin(d.y * 5.3 + t * 0.37) + 0.45 * sin(d.y * 11.0 - t * 0.21),
        sin(d.x * 4.1 + t * 0.29) + 0.45 * sin(d.x * 9.0 + t * 0.17)
      ) * 20.0 * warp;
      float a = 0.040 * warp * sin(t * 0.13);
      vec2 r = q - c;
      q = c + vec2(r.x * cos(a) - r.y * sin(a), r.x * sin(a) + r.y * cos(a)) + off;

      // 底色：中心浅、四角压暗
      vec2 e = (q / res - vec2(0.5, 0.46)) / vec2(0.92, 0.86);
      vec3 col = mix(cInk2, cInk, smoothstep(0.0, 1.0, length(e)));

      // 网格：主格 + 每 5 格一根亮一点的
      vec2 gu = q / spacing;
      vec2 g = abs(fract(gu) - 0.5) * spacing;
      vec2 fw = vec2(fwidth(q.x), fwidth(q.y));
      float fine = 1.0 - smoothstep(fw.x * 0.6, fw.x * 1.9, min(g.x, g.y));
      vec2 g5 = abs(fract(gu / 5.0) - 0.5) * spacing * 5.0;
      float coarse = 1.0 - smoothstep(fw.x * 0.6, fw.x * 1.9, min(g5.x, g5.y));
      float mask = 1.0 - smoothstep(0.18, 0.95, length(e));
      col += cLine * 0.016 * fine * mask;
      col += cLine * 0.022 * coarse * mask;

      // 取样带：一道很淡的横向扫描线，慢慢往下走
      // 压得比网格还轻，因为它会横穿文字
      float band = fract((FRAG_PX.y / res.y) - sweep);
      col += cAccent * 0.013 * (1.0 - smoothstep(0.0, 0.085, band)) * mask;

      // 边界：还没解算的时候四角留一点暗示
      col += cAccent * 0.024 * warp * smoothstep(0.55, 1.15, length(e) * vig);

      fragColor = vec4(col, 1.0);
    }`, {
    cInk: P.ink, cInk2: P.ink2, cLine: P.bone, cAccent: accent,
    warp: opts.warp ?? 1, spacing: grid, sweep: 0, vig,
  }, { key: `kit_world_${grid}_${vig}`, blend: false });
}

/**
 * 全片一台摄影机：**只用整片时间 `t`**，所以切镜头时它不会断。
 * 两个不同频率的正弦叠加，避免看出周期。
 *
 * @param {number} t 整片时间（`f.t`，**不是** `f.lt`）
 */
export function cameraAt(t, opts = {}) {
  const zAmp = opts.zoomAmp ?? 0.03;
  const sAmp = opts.shakeAmp ?? 1;
  const zBase = opts.zoomBase ?? 1.035;
  return {
    zoom: zBase + zAmp * Math.sin(t * 0.085 - 1.1) + zAmp * 0.4 * Math.sin(t * 0.27 + 2.0),
    shake: [
      sAmp * (22 * Math.sin(t * 0.17) + 9 * Math.sin(t * 0.43 + 0.7)),
      sAmp * (14 * Math.sin(t * 0.14 + 1.3) + 6 * Math.sin(t * 0.37)),
    ],
  };
}

/** 摄影机当前的运动方向（单位向量，屏幕坐标系 y 向下）—— 转场拖尾与前景入场都沿它。 */
export function cameraDir(t, dt = 0.05, opts = {}) {
  const a = cameraAt(t - dt, opts), b = cameraAt(t + dt, opts);
  const dx = b.shake[0] - a.shake[0];
  const dy = b.shake[1] - a.shake[1];
  const n = Math.hypot(dx, dy) || 1;
  return [dx / n, dy / n];
}

/**
 * 段落收尾用的 post：摄影机 + 这一段的固定观感，合成一个对象直接 return。
 * @param {number} t 整片时间（`f.t`）
 * @param {Record<string, any>} [extra] 这一段自己的调色/泛光等
 */
export function cameraPost(t, extra = {}) {
  return { ...cameraAt(t), ...extra };
}

/**
 * 前景的入场位移：方向与摄影机**相反**（上一镜往这边被甩走，新内容就从反方向落位）。
 * 直接加在文字的 x/y 或矢量的坐标上即可。
 *
 * @param {number} t 整片时间
 * @param {number} k 入场进度（0 = 刚进来，1 = 站稳）
 * @param {number} [amount] 最大位移（逻辑像素）
 * @returns {[number, number]} `[dx, dy]`
 */
export function enterOffset(t, k, amount = 130) {
  const d = cameraDir(t);
  const rem = (1 - sat(k)) ** 2;
  return [-d[0] * amount * rem, -d[1] * amount * 0.5 * rem];
}

/**
 * 场景侧的转场套件。一句 `this.wk = makeWorldKit(ctx)` 装好，
 * 每帧第一句 `const k = this.wk.openFrame(ctx)` 就没别的事了。
 *
 * `openFrame` 做两件事：
 *   ① 画全片唯一的那层背景（同一个 Pass、只跟 `f.t` 走）；
 *   ② 交叠期把上一段那一帧沿摄影机方向甩出去（不是原地淡出 —— 两屏文字叠着会糊）。
 *
 * 返回的 `k` 是入场进度：1 = 已经站稳，按平常那样画即可。
 */
export function makeWorldKit(ctx, opts = {}) {
  const pass = transitionPass(ctx.gl, opts);
  let background = opts.background ?? null;
  return {
    pass,
    /**
     * @param {any} c SceneCtx
     * @param {{ render: (gl: any, target: any, t: number, dt: number) => any } | null} [bg]
     *        覆盖这一次用的背景（不传就用 setup 时给的 / 引擎的 ctx.world）
     * @returns {number} 入场进度 k
     */
    openFrame(c, bg = undefined) {
      const { f, gl } = c;
      const world = bg === undefined ? (background ?? c.world) : bg;
      if (world) world.render(gl, c.out, f.t, f.dt);
      const k = c.under ? sat(f.tin) : 1;
      if (c.under && k < 1) {
        const u = pass.u;
        u.under.value = { tex: /** @type {any} */ (c.under).tex ?? c.under, __tex: true };
        u.k.value = k;
        u.dir.value = cameraDir(f.t, 0.05, opts);
        pass.render(gl, c.out, f.t, f.dt);
      }
      return k;
    },
    /** 换一层背景（例如片头/片尾要换世界）。 */
    setBackground(p) { background = p; return this; },
  };
}
