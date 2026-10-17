// 自测夹具：**算出来的显示位**（判据 ③）—— 画面上的数字不是字面量，而是算出来的
//
// 这个夹具的正事只有一件：那些位置**必须被列出来、并且明说「没验」**，不许静默排除。
// 预期（钉在 tools/test-fabricated-numbers.mjs 的 §8）：
//   · 判据 ①②（字面量）：2 个（'纯字面量：42 份' 里的 42、补零字符 '0'）—— FACTS.md 里都登记了 ⇒ 零命中
//   · 判据 ③（算出来的）：这个文件 3 处（sub 的模板串 + values 的两个非字面量元素）
//   · 退出码 0：判据 ③ 不是「找不到出处」，不许把正常任务染红
//
// 路径说明：`--dir tools/fixtures/lint-numbers/tasks` 时任务目录不在 tasks/ 下，
// 所以 import 用仓库根的相对路径（`../../../../src/…`）；测试只做静态扫描，不会真的执行它。

import { cut, seq } from '../../../../src/timeline.js';
import computed from './scenes/computed.js';

const N = 3;                        // 章节数（示意）
const SERIES = [0.2, 0.5, 0.9];     // 图表数据：**纯数字数组**（判据 ①②③ 都不报 —— 见工具文件头的已知假阴性）
const trend = (k) => SERIES[k % SERIES.length];

export default {
  title: '夹具 · 算出来的',
  width: 1920, height: 1080, fps: 60,
  timeline: seq([
    cut(computed, { dur: 4 }),
    // 选项键 sub 的值是模板串（判据 ③ 第 2 处）；title 是纯字面量（不许被算成「算出来的」）
    { type: 'title', title: '标题是字面量', sub: `第 ${N} 章`, dur: 3 },
    // values 里两个元素不是字面量：SERIES[0] + 0.1（表达式）与 trend(2)（函数调用）；0.7 是字面量、不算
    { type: 'chart', values: [SERIES[0] + 0.1, 0.7, trend(2)], title: '成绩', dur: 4 },
  ]),
};
