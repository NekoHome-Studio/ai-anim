// 自测夹具：**混合** —— 同一个任务里既有"有出处的数"，也有"编造的数"
//
// 这种任务才是真实形状：`--explain` 要把**两类都报出来**（一类附出处行号，一类标为找不到），
// 否则人没法一眼看出"这个数到底算不算有出处"。
//
// 预期（钉在 tools/test-fabricated-numbers.mjs 的 §3）：
//   · 显示位 4 个数字：'42' / '3762' / '07' / '3359'
//   · 找不到出处 3 个：3762（编造）、07（本片镜号，未登记）、3359（只出现在另一个任务的事实表里）
//   · 找到出处 1 个：42 → 本任务 FACTS.md

import { cut, seq } from '../../../../src/timeline.js';

export default {
  title: '夹具 · 混合',
  width: 1920, height: 1080, fps: 60,
  timeline: seq([
    cut({
      id: 'mixed',
      render(ctx) {
        const { type } = ctx;
        type.clear();
        type.writeLine('有出处的：42 份', 960, 300, { size: 96, anchor: 'center' });
        type.writeLine('编造的：3762 次', 960, 460, { size: 96, anchor: 'center' });
        type.write('07 / 本片镜号', 120, 700, { size: 30, family: 'mono' });
        type.write('别处的数字：3359', 120, 780, { size: 30, family: 'mono' });
        type.upload();
        return { bloom: 0.3 };
      },
    }, { dur: 4 }),
  ]),
};
