// 验证片 · task.config —— 演示 pdoom-video 那套「3D 炫酷 + 镜头间衔接自然」。
//
// 三条要看的东西：
//   ① **时间线上零 overlap、零 handlesTransition** —— 全是硬切。
//      pdoom 全片 22 段也是这样（相邻段的边界是同一个变量），它那条交叉溶解分支从未被执行过。
//   ② 连续性靠 `scenes/_world.js` 里的四件事：全片一台摄影机、一个走完全片的火花、
//      手工几何交接常量、以及各段自己的 pre-lap（运动穿过切点继续）。
//   ③ 三段各用一种"3D"：真 raymarch（走廊）/ 解析投影 + 线段批（图纸、堆栈、立柱）/
//      投影 setXform（文字跟着透视走）。
import { seq, cut } from '../../src/timeline.js';
import corridor from './scenes/corridor.js';
import map from './scenes/map.js';
import stack from './scenes/stack.js';
import columns from './scenes/columns.js';
import loop from './scenes/loop.js';

export default {
  title: 'pdoom 手法验证 · 32 秒',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  palette: {
    // pdoom 的调色板：ink 底 + bone 纸 + 一个信号橙。只让信号色超过 0.85 线性亮度（泛光）。
    signal: '#ff4d12',
    ember: '#ff8a3d',
    blood: '#c21d0b',
    bone: '#eee9df',
    ash: '#9c978f',
    graphite: '#5e5b57',
    ink: '#0a0a0b',
    ink2: '#151517',
  },

  // ⚠ 全部 `overlap: 0`（`cut` 的默认值）—— 硬切。
  //   段长都是整数拍（0.5 秒一拍），切点落在拍上：pdoom 的 21 个内部切点全部如此。
  // 走廊段（raymarch）有三个诊断开关，改 params 就能用，**不用改场景代码**：
  //   params: { dbg: 1 } = 材质号（1 墙 / 2 门框 / 3 火花 / 4 尽头出口）
  //   params: { dbg: 2 } = 法线，params: { dbg: 3 } = 命中距离
  //   params: { impl: 'lines' } = 换回"投影线段批"那一版（第 ① 种 3D）做对照
  timeline: seq([
    cut(corridor, { dur: 7.5, note: '真 raymarch：SDF 走廊 + 雕刻排线 + 软阴影（params.dbg 可开诊断）' }),
    cut(map, { dur: 7.5, note: '2.5D 图纸：解析投影 + keystone，文字跟着透视一起压' }),
    cut(stack, { dur: 7.5, note: '一镜到底：世界在落，摄影机只跟随；几何沿速度拷份做拖影' }),
    cut(columns, { dur: 4.5, note: '柱林横摇：投影线段批的常规用法' }),
    cut(loop, { dur: 5.0, note: '收尾：减速回到第一帧的机位与滚转，成环' }),
  ]),
};
