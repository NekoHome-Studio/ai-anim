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
 * —— 这正是"复制粘贴当抽象"的典型失败模式（`docs/IMPROVEMENTS.md` P1-1 / P0-2）。
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

export { panel, fillRect, kicker, footer, reticle, marker } from './elements.js';

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
