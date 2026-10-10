// @ts-check
/**
 * 后处理标定卡（`_post-lab`）—— 故意把后处理链上最容易露馅的四件事画在一帧里：
 *
 *   1. 大面积暗部渐变（0.015 → 0.105）—— 看 **dither**：矩形分布会在暗部留下横向色带
 *   2. 七个饱和霓虹色块（线性值 ×1.6，进 bloom）—— 看 **tonemap 的 hue skew**：
 *      高光滚降做得糙的算子会把饱和青/洋红推向白或者偏色
 *   3. 十二级亮度阶梯（2^-4 … 2^7）—— 看 **高光滚降曲线**：哪一级开始并到纯白
 *   4. 一颗极亮的小点（线性值 60）—— 看 **bloom 的 Karis 预过滤**：
 *      不做加权的话，降采样会让它随帧跳动成一个方块
 *
 * 三段用**同一个场景、同一段内时间**，只有 post 不同 —— 逐像素可比的 A/B。
 */
import { css } from '../../../src/core/util.js';

export default {
  id: 'card',

  render(ctx) {
    const { gl, P, lines, text, type, comp, f, W, H } = ctx;

    gl.clear(ctx.out, [0.008, 0.010, 0.016]);

    lines.begin();

    // 1) 暗部渐变带（占据顶部 1/8）
    const N = 160;
    const bw = W / N;
    for (let i = 0; i < N; i++) {
      const v = 0.015 + (i / (N - 1)) * 0.09;
      lines.fillRect(i * bw, 0, bw + 1, 130, [v, v * 1.06, v * 1.22, 1]);
    }

    // 2) 霓虹色块（线性值 ×1.6：超过 1 才会进 bloom）
    const hues = [
      [1.0, 0.15, 0.10], [1.0, 0.55, 0.05], [1.0, 0.95, 0.12], [0.16, 1.0, 0.36],
      [0.10, 0.78, 1.0], [0.46, 0.22, 1.0], [1.0, 0.22, 0.86],
    ];
    const cw = W / hues.length;
    hues.forEach((c, i) => {
      lines.fillRect(i * cw + 5, 165, cw - 10, 155, [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6, 1]);
    });

    // 3) 亮度阶梯 2^-4 … 2^7（灰阶，看滚降从哪一级并到白）
    for (let i = 0; i < 12; i++) {
      const v = Math.pow(2, i - 4);
      lines.fillRect(70 + i * 148, 360, 132, 170, [v, v, v, 1]);
    }

    // 4) 极亮小点（8×8 逻辑像素，线性 60）：bloom 的 firefly 试验台
    lines.fillRect(W * 0.5 - 4, 620, 8, 8, [60, 60, 60, 1]);
    lines.fillRect(W * 0.5 - 1, 617, 2, 2, [220, 220, 220, 1]);

    // 5) 一圈细线：看抗锯齿与颗粒
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      lines.seg(W * 0.5 + Math.cos(a) * 250, 700 + Math.sin(a) * 90,
        W * 0.5 + Math.cos(a) * 330, 700 + Math.sin(a) * 120, 1.5, [0.35, 0.55, 0.85]);
    }

    lines.flush(ctx.out);

    text.clear();
    type.writeLine('POST-LAB · ' + (ctx.params?.label ?? ''), W * 0.5, 950,
      { anchor: 'center', size: 44, weight: 700, color: css(P.bone) });
    type.writeLine('暗部渐变 → dither    霓虹块 → hue skew    阶梯 → 滚降    亮点 → firefly',
      W * 0.5, 1010, { anchor: 'center', size: 26, weight: 400, color: css(P.ash) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.5, bloomThreshold: 0.85, halation: 0.2, grain: 0.035, vignette: 0.35 };
  },
};
