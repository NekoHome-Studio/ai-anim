// 演示任务：无音频，纯代码动画。展示「一段小动画」也要用的全套东西：
// 文字逐字入场、矢量线段、GLSL 背景、图表、转场、后处理。
import { seq, cut } from '../../src/timeline.js';
import title from './scenes/title.js';
import chart from './scenes/chart.js';
import kinetic from './scenes/kinetic.js';
import whip from './scenes/whip.js';
import outro from './scenes/outro.js';

export default {
  title: 'anim 演示 · 16 秒',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  palette: {
    // 不改也能跑：这里示范怎么换一套配色（键名会变成 GLSL 里的 C_XXX）
    signal: '#ff4d12',
    acid: '#d8ff3c',
  },

  timeline: seq([
    cut(title, { dur: 4.0, note: '标题：逐字入场 + 生长的线' }),
    cut(chart, { dur: 5.0, note: '图表：逐段生长 + 数字跳动' }),
    cut(kinetic, { dur: 4.0, note: '动态文字 + GLSL 背景' }),
    // overlap: 0.45 让 whip 和上一段重叠，whip 自己处理这个重叠（handlesTransition）
    cut(whip, { dur: 1.1, overlap: 0.45, handlesTransition: true, note: '甩镜转场' }),
    cut(outro, { dur: 3.0, note: '片尾' }),
  ]),
};
