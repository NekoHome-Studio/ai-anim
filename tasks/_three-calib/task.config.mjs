import { seq, cut } from '../../src/timeline.js';
import calib from './scenes/calib.js';
import alpha from './scenes/alpha.js';

/**
 * Three.js 桥的**标定夹具**（照 `tasks/_calib` 的先例）。
 *
 * 只干一件事：证明「Three.js 渲出来的画面」原样、正着、以正确的颜色进了引擎的合成器。
 * 判据是量出来的，不是看出来的 —— `node tools/probe-three.mjs`。
 *
 *   node scripts/anim.mjs still _three-calib -t 1     # 出图人眼看
 *   node tools/probe-three.mjs                        # 逐像素判据（四象限颜色 + 朝向）
 *
 * 它不是一支片子，是一把尺子；不要在它上面加剧情。
 */
export default {
  title: 'Three.js 桥标定',
  width: 1920, height: 1080, fps: 60, scale: 1,
  timeline: seq([
    cut(calib, { dur: 2, note: '四象限：朝向 + 颜色 + 叠字' }),
    cut(alpha, { dur: 2, note: '透明合成：线性空间的 over' }),
  ]),
};
