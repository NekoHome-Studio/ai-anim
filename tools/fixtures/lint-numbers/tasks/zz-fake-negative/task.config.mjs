// 自测夹具：**反例** —— 满屏坐标 / 字号 / 时长 / 阈值 / 颜色分量字面量，一个都不许误报
//
// 这份文件里所有数字都**不是**数值显示位（判据边界，逐条对得上工具的 `--slots`）：
//   · 坐标与尺寸：x / y / w / h / L / T / R / B
//   · 字号 / 字距 / 字重：size / weight / tracking
//   · 时长 / 时刻 / 偏移：dur / at / prog(t, 1.6, 4.4)
//   · 阈值 / 强度 / 后处理：peak / bloom / grain / vignette / exposure / contrast / maxSamples
//   · 颜色分量与颜色串：gl.clear(…, [0.06, 0.06, 0.07])、palette 里的 '#00e0ff'
//   · 枚举字符串：family: 'mono'、anchor: 'center'、from: 'up'
//   · 注释：这一行里的 2026-10-10 与 42 都不是画面文字
//   · 算出来的数：String(7 + 3)、`进度 ${(f.lt * 12.5).toFixed(1)}%`
//
// 画面文字里**一个数字都没有** —— 所以正确答案是「显示位 0 个数字 / 0 个找不到出处」。
// 图表数据用占位符写法：`values` 还没拿到时先给 `— figure —`。
//
// 路径说明：`--dir tools/fixtures/lint-numbers/tasks` 时任务目录不在 tasks/ 下，
// 所以 import 用仓库根的相对路径；测试只做静态扫描，不会真的执行它。

import { cut, seq } from '../../../../src/timeline.js';

const TITLE = '这一屏的文案一个数字都没有';
const STEPS = ['先扫一遍', '再归一次类'];
const VOLUME = '待定';                       // ← 真实读数还没拿到时不写数

export default {
  title: '夹具反例',
  width: 1920, height: 1080, fps: 60, scale: 1,
  palette: { signal: '#00e0ff', ink: '#101014' },
  timeline: seq([
    { type: 'title', title: TITLE, sub: '副标题里也没有数字', dur: 4 },
    cut({
      id: 'no-numbers',
      render(ctx) {
        const { gl, type, lines, P, f } = ctx;
        const W = 1920, H = 1080;
        gl.clear(ctx.out, [0.06, 0.06, 0.07]);
        lines.begin();
        lines.seg(120, 300, W - 120, 300, 2, P.signal);
        lines.rect(240, 480, 640, 240, 1.5, [0.9, 0.9, 0.9, 0.4]);
        for (let i = 0; i < 5; i++) lines.seg(120 + i * 90, 700, 120 + i * 90, 760, 1.2, P.bone);
        lines.flush(ctx.out);
        type.clear();
        type.writeLine(TITLE, W / 2, 200, { size: 72, anchor: 'center', weight: 700 });
        type.write(STEPS[0], 140, 860, { size: 28, family: 'mono', tracking: 3 });
        type.write(`进度 ${(f.lt * 12.5).toFixed(1)}%`, 140, 920, { size: 24 });
        type.write('口径待定：' + VOLUME, 140, 960, { size: 24 });
        type.write(String(7 + 3), 1780, 920, { size: 24, align: 'right' });
        type.upload();
        return { bloom: 0.3, grain: 0.03, vignette: 0.28, exposure: 1.0, contrast: 1.05 };
      },
    }, { dur: 5, at: 4, maxSamples: 24, note: '备注里的 2026-10-10 也不是画面文字' }),
  ]),
};
