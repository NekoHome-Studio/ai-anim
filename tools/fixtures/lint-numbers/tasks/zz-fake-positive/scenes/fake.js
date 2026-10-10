// 自测夹具：**正例** —— 画面文案里有一个编造的数字（离线、不渲染）
//
// 这份文件刻意排满坐标 / 字号 / 时长 / 阈值 / 颜色分量 / 注释里的数字，
// 它们一个都不许被 lint-fabricated-numbers 报出来。
// 只有 writeLine 里那个「3762」是编造的：FACTS.md 里没有它，而且事实表任何一行都不含这串数字。
//
// 注释里的数字也不算画面文字（分镜注释常引用文案）—— 比如这一行。
//
// 下面这些字符串字面量同样不是显示位：'mono' / 'center' / 'up' / '#00e0ff'。
//
// 路径说明：`--dir tools/fixtures/lint-numbers/tasks` 时任务目录不在 tasks/ 下，
// 所以 import 用仓库根的相对路径（`../../../../src/…`）；测试只做静态扫描，不会真的执行它。

import { cut, seq } from '../../../../src/timeline.js';

export default {
  title: '夹具',
  width: 1920, height: 1080, fps: 60, scale: 1,
  palette: { signal: '#00e0ff' },
  timeline: seq([
    cut({
      id: 'fake',
      render(ctx) {
        const { type } = ctx;
        type.clear();
        type.writeLine('这个数是编的：3762 次', 960, 300, { size: 96, anchor: 'center' });
        type.write('这一行的字距与字号都不是读数', 120, 500, { size: 32, tracking: 4 });
        type.upload();
        return { bloom: 0.4, grain: 0.02, exposure: 1.0, shoulder: 0.85 };
      },
    }, { dur: 4 }),
  ]),
};
