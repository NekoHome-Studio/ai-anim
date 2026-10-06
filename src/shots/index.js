// @ts-check
/**
 * `src/shots/` —— A 档**镜头库**：把反复出现的镜头沉淀成「模板 + 参数」。
 *
 * 以前每做一支片子都要把同一批镜头重写一遍（`tasks/demo/scenes/chart.js` 126 行、
 * `tasks/beat/scenes/grid.js` 83 行…），而且要记住一堆不成文的约定。现在常见镜头只剩一行：
 *
 * ```js
 * // tasks/<任务>/scenes/chart.js
 * import { shot } from '../../../src/shots/index.js';
 * export default shot('chart', {
 *   values: [0.3, 0.7, 0.95],
 *   title: '这一轮的成绩',
 * });
 * ```
 *
 * ## 三个要点
 *
 * 1. **模板返回的就是普通场景对象**（`{ id, setup, render }`），所以「模板镜头」与
 *    「手写场景」能混在同一条时间线里 —— 没想法的那几段用模板，需要创意的照旧写代码。
 * 2. **参数写错会抛错**，不静默忽略：`shot('chart', { value: [...] })`（少个 s）会点名
 *    「没有参数 "value"」并列出可用参数。这一条是刻意的 —— 这个引擎最贵的 bug 全是
 *    「写错了但画面照样出」（见 `docs/IMPROVEMENTS-2.md`）。
 * 3. **模板里的绘制代码是从已经出过片的场景逐字搬过来的**，画面逐像素一致
 *    （`tasks/demo` / `tasks/beat` 的验收：`node scripts/anim.mjs hashes <任务> --baseline`）。
 *    想改模板的数值/顺序之前，先跑一次那个命令，改完再跑一次。
 *
 * ## 看看有哪些模板
 *
 * ```sh
 * node scripts/anim.mjs shots           # 列出全部模板
 * node scripts/anim.mjs shots chart     # 某个模板的全部参数与默认值
 * ```
 *
 * ## 边界（什么不该进这里）
 *
 * 只放**反复出现、与具体片子无关**的整镜头。某一支片子特有的视觉母题
 * （fidus 的准星、nekohome 的窗口边框）留在那个任务的 `scenes/_kit.js` 里；
 * 「一个镜头该有的骨架」（共享背景 / 甩镜转场 / 一台摄影机）在 `src/kit/shot.js` 的
 * `makeShot()` 里，两者可以叠起来用：模板负责画面，`makeShot` 负责骨架。
 * 全新的视觉想法（raymarch 晶格、燃烧的引线）**仍然要手写场景** —— 这是 A 档，不是 DSL。
 */

import { titleShot } from './title.js';
import { chartShot } from './chart.js';
import { kineticShot } from './kinetic.js';
import { whipShot } from './whip.js';
import { outroShot } from './outro.js';
import { waveShot } from './wave.js';
import { pulseShot } from './pulse.js';
import { gridShot } from './grid.js';

export { titleShot, chartShot, kineticShot, whipShot, outroShot, waveShot, pulseShot, gridShot };

/**
 * 模板名 → 工厂函数。
 * 键就是 `shot('名字', {...})` 里的名字（B 档的 `{ type: '名字' }` 分发也会读这张表）。
 */
export const SHOTS = {
  title: titleShot,
  chart: chartShot,
  kinetic: kineticShot,
  whip: whipShot,
  outro: outroShot,
  wave: waveShot,
  pulse: pulseShot,
  grid: gridShot,
};

/**
 * 取一个镜头模板，返回可以直接放进时间线的场景对象。
 *
 * ```js
 * export default shot('title', { title: '写代码，就是做动画' });
 * export default shot('wave', { id: 'intro' });      // id 覆盖段名（--only / HUD / 报错里用它）
 * ```
 *
 * @param {string} name 模板名（`listShots()` 里那 8 个）
 * @param {Record<string, any>} [opts] 模板参数；**键写错会抛错**，不静默忽略
 * @returns {any} 场景对象（`{ id, setup?, render }`）
 */
export function shot(name, opts = {}) {
  const factory = SHOTS[name];
  if (typeof factory !== 'function') {
    throw new Error(
      `未知的镜头模板 "${name}"。可用的：${Object.keys(SHOTS).join(' / ')}`
      + '（看参数：node scripts/anim.mjs shots <名字>）',
    );
  }
  const valid = factory.defaults ?? {};
  if (opts && typeof opts === 'object') {
    for (const k of Object.keys(opts)) {
      if (!(k in valid)) {
        throw new Error(
          `镜头模板 "${name}" 没有参数 "${k}"（大概是拼错了）。`
          + `可用参数：${Object.keys(valid).join(' / ')}`,
        );
      }
    }
  }
  return factory(opts);
}

/**
 * 列出全部模板及其参数 —— CLI 的 `anim shots` 用的就是它。
 *
 * 参数表来自每个模板自己的 `meta`，默认值来自它的 `defaults`（唯一来源，
 * 所以"文档里写的默认值"与"代码实际用的默认值"不可能对不上；
 * `tools/test-shots.mjs` 会断言两者的键集合完全相等）。
 *
 * @returns {{ name: string, summary: string, notes: string,
 *             params: { name: string, type: string, desc: string, default: any }[] }[]}
 */
export function listShots() {
  return Object.entries(SHOTS).map(([name, factory]) => {
    const meta = /** @type {any} */ (factory).meta ?? {};
    const defaults = /** @type {any} */ (factory).defaults ?? {};
    return {
      name,
      summary: meta.summary ?? '',
      notes: meta.notes ?? '',
      params: (meta.params ?? []).map((p) => ({ ...p, default: defaults[p.name] })),
    };
  });
}
