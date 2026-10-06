// 场景 2：图表。演示——数据可视化、逐条生长、基线/刻度、跟随数值的读数。
// 画面全在镜头模板里（A 档镜头库 `src/shots/chart.js`），这里只给数据与文案。
import { shot } from '../../../src/shots/index.js';

// 固定数据（确定性！不要在这里用 Math.random）
const VALUES = [0.18, 0.34, 0.27, 0.52, 0.44, 0.71, 0.63, 0.88, 0.79, 0.95, 0.86, 1.0];

export default shot('chart', {
  values: VALUES,
  title: '每次迭代的最高准确率',
  sub: 'PER-RUN  ·  n = 12  ·  纯代码绘制，无图片素材',
  footer: '确定性渲染 → 任意时刻可重放，任意精度可重渲',
});
