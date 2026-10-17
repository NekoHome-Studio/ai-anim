// @ts-check
/**
 * `src/kit/` —— 引擎自带的镜头工具。
 *
 * ## 为什么它在引擎里，而不在某个任务的 `scenes/_kit.js` 里
 *
 * 这些东西在 `tasks/nekohome/scenes/_kit.js`（431 行）和 `tasks/fidus/scenes/_kit.js`（约 450 行）
 * 里**各写了一遍**：`put`、`fade`、`typed`、`panel`/`cardFrame`、`kicker`、`footer`、
 * `enterOffset`、`cutOut`、`transPass`、`worldPass` 的结构都重复。
 * 更糟的是照抄第二次时**漏了 `openFrame` 的调用**，导致 9 段里 8 段的底是纯黑
 * —— 这正是"复制粘贴当抽象"的典型失败模式（`docs/history/IMPROVEMENTS-1-3.md` P1-1 / P0-2）。
 *
 * ## 用法
 *
 * ```js
 * import { makeShot, put, fade, typed, panel, kicker, footer, marker, reticle, makeWorldKit }
 *   from '../../../src/kit/index.js';
 * ```
 *
 * 也可以只拿一部分：
 *   · `src/kit/layout.js`   —— 纯排版工具（不碰 GPU）
 *   · `src/kit/elements.js` —— 画在 lines 上的版面元件（面板/眉标/页脚/准星/标记）
 *   · `src/kit/world.js`    —— 全片共享背景 + 一台摄影机（转场那套配方）
 *   · `src/kit/shot.js`     —— `makeShot()`：把镜头骨架包成一个函数
 *   · `src/kit/three.js`    —— `makeThreeShot()`：Three.js 镜头（第 3 种 3D：真网格）
 *
 * ## 边界（什么不该进这里）
 *
 * 这里只放**反复出现、与具体片子无关**的东西。某一支片子特有的视觉母题
 * （例如 fidus 的准星路线、nekohome 的窗口边框）属于那支片子：放在任务自己的
 * `scenes/_kit.js` 里，从 `src/kit/` import 通用件再叠加自己的东西。
 */

export { mul, withAlpha, sat01, put, writeLine, fade, typed, codeRow, seqRnd, contrast, css } from './layout.js';

/**
 * `src/kit/motion.js` —— **运动规则**的纯函数（规则表：`docs/MOTION.md`；BACKLOG 1-27）。
 *
 * `nudgeCurve` 三段式整组位移（10/65/25，出处 REFERENCE-hyperframes.md 516 行）/
 * `waterfallStagger` 错峰到达的归一化（`items × stagger ≤ ~0.5s`，535 行）+
 * 纯判据 `waterfallOver` / `glowPeakCap` 辉光峰值上限（≤ ~0.45，522 行）。
 * 三个都只吃 t 与参数、**不碰 GPU / 浏览器**（连 import 都没有），可以离线单测：
 * `node tools/test-motion.mjs`。⚠ 那些数值是**外部经验值，我方未实测**（MOTION.md §0）。
 */
export {
  nudgeCurve, waterfallStagger, waterfallOver, glowPeakCap,
  NUDGE_SPLIT, NUDGE_PHASE, MAX_STAGGER_SPAN, GLOW_PEAK_CAP,
} from './motion.js';

export { panel, fillRect, kicker, footer, reticle, marker } from './elements.js';

/**
 * 版面分区与字幕/标注元件（`docs/CAPTIONS.md`）：
 * `bands()` / `bandsOf()` 给出版面五条带（含**字幕保留带**），
 * `captionNote()` 是"只放短标注"的说明条（写成长句会警告），
 * `subLine()` 给"想在段内自己画字幕"的少数场合（大多数片子用 `task.captions: true` 就够）。
 */
export { bands, bandsOf, assertInBand, captionNote, subLine } from './bands.js';

export {
  worldPass, cameraAt, cameraDir, cameraPost, enterOffset, makeWorldKit, transitionPass,
} from './world.js';

export { makeShot, shot } from './shot.js';

/**
 * `makeThreeShot()` —— 一个 **Three.js 镜头**（引擎的第 3 种 3D：真网格）。
 * 机制在 `src/core/three-bridge.js`（桥 / 颜色 / 投影），这里只是"一个镜头该怎么写"。
 * 标定夹具与沙盒：`tasks/_three-calib`、`tasks/_three-lab`；排错见 `docs/ENGINE.md` §3.8。
 */
export { makeThreeShot } from './three.js';

/**
 * `src/kit/panel.js` —— **2D 面板层**（讲一张表 / 一条管线 / 一组格子时用）。
 * 与 `./elements.js` 那一组是**同一类东西的两个层次**，别混：
 *   · `elements.js` 的 `panel(lines, x, y, w, h, col, …)` —— 底层图元，自己传 `lines` 与颜色；
 *   · 这里的 `panelBox(ctx, { x, y, w, h, … })` —— 整块面板（底 + 边 + 四角 + 标题 + 副标题
 *     + `tone` 压暗），只吃 `ctx`。
 * 所以本层那个**改名成 `panelBox` 再出**，`elements.js` 的 `panel` **一个字都不动**
 * （老场景照旧；`docs/history/IMPROVEMENTS-4-5.md` §4.4 B）。
 *
 * 另外：这里的 `col` 与 `./layout.js` 的 `mul/withAlpha` 是同一族，为避免两个 `col` 打架，
 * 本层那个出成 `panelCol`；`jitter/win/step` 与 `./blocks.js` 的同名函数**实现相同**，不重复出。
 */
export {
  panelBox, tile, tileRow, chips, arrowH, bufBox, hatchBox, meter, tag2,
  chipLayout, shadeOf, mixToInk, toneColor, col as panelCol,
} from './panel.js';

/**
 * `src/kit/blocks.js` —— **方块世界 kit**（3D 线段批 + 画家算法 + 面朝向判据 + 世界切片 +
 * 按段名定位的摄影机）。`docs/history/IMPROVEMENTS-4-5.md` §4.2 / §4.3 / §4.4 A/C。
 *
 * ```js
 * import { makeBlocksKit } from '../../../src/kit/index.js';
 *
 * // setup(ctx) 里建一次；clock 是 anim say 生成的段时刻表
 * this.B = makeBlocksKit({
 *   P: ctx.P,                                    // 缺 slab / slabHi 会当场抛错并点名
 *   clock: { ctm: { start: 60.0, stretch: 1.05 } },
 *   keys: [                                      // "段名 + 段内秒"：段长变了机位自动跟着走
 *     { id: 'ctm', at: 0.0,  pos: [-8, 32, -84], tgt: [0, 15, 4], fov: 48 },
 *     { id: 'ctm', at: 19.0, pos: [-6, 31, -82], tgt: [0, 15, 4], fov: 48 },
 *   ],
 * });
 *
 * // render(ctx) 里
 * const cam = this.B.camAt(f.t);                  // 全片一台连续摄影机（纯函数）
 * lines.begin();
 * for (const s of this.B.sections) this.B.section(ctx, cam, s, { alpha: s.surf ? 1 : 0.4 });
 * this.B.flush(ctx);                              // 显式排水（也可以直接 lines.flush(ctx.out)）
 * ```
 *
 * ## 两条数字上的纪律（写错了画面"看起来不对"但不报错）
 *
 * · **alpha 管在不在，tone 管亮不亮**（§4.3）：`section({ alpha: 0.4 })` 是**把它画暗**，
 *   不是把它画透 —— `alpha ≥ 0.17` 时填充**完全不透明**；深度淡出（`depthTint`）也只乘颜色。
 * · **`facesToward` 的判据是 `dot(相机 − 面心, 法线) > 0`**（§4.2）。老代码写成
 *   `dot(面心 − 相机, 法线) > 0`（= 背面的条件），于是顶面从来没被铺过、世界读成水晶。
 *   `tools/test-blocks.mjs` 拿正反用例钉着它，**别"顺手"改回去**。
 */
export {
  makeBlocksKit, seg3, box3, solidBox, hatchQuad, ground, playerMarker, frustumCone,
  beam, orb, flush, sortByDepth, byDepth, facesToward, faceTone, visibleEdges, faceGeometry,
  halfOf, solidityAt, depthAlpha, depthTint, toAbsTime, localT, expandKeys, keySpan,
  pickColor, requireColor, FACE_NORMALS, FACE_GEO, BOX_EDGES, SUN,
  FILL_ZERO, FILL_FULL, TONE_FLOOR, SOLID_K, QUEUE_KEY, PENDING, clearPending,
} from './blocks.js';
