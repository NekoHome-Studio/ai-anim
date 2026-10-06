// @ts-check
/**
 * 段 5 · `frames`（36.0 – 42.0s）—— 帧墙：它看过的那些帧。
 *
 * 摄影机从隧道的尽头冲进一个更宽的厅（SDF 世界里 `z −103` 那道口子就是这里），
 * 迎面是一排排**世界里的帧**：每一格是一次迭代的缩略图，母题变成一道扫描线，
 * 扫过哪一格，哪一格就亮起来。
 *
 * 这一段要说的那句话是 README 的原话（「它能自己读代码、渲染、看图、改，直到片子对为止」），
 * 出处见 FACTS.md。
 */
import {
  SEG, cam3At, draw3D, dustSegs, frameWallSegs, grade, motifAt, postAt,
  timecodeHud, zAt, LANDMARK,
} from './_world.js';
import { makeSdfPass, sdfUniforms } from './_sdf.js';
import { clamp, prog, sat } from '../../../src/core/util.js';

export default {
  id: 'frames',

  setup(ctx) {
    this.pass = makeSdfPass(ctx.gl, ctx.P);
  },

  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W, H } = ctx;
    const t = Number(ctx.params?.useT ?? f.t);
    const cam3 = cam3At(t, H);
    const m = motifAt(t);
    const lt = t - SEG.frames.at;
    const cz = zAt(t);

    // 世界：这一段仍然在同一个 SDF 里（隧道尽头那个更宽的厅），只是几乎全黑 ——
    // 画面主体交给线框的帧墙。墙在前方很远处才开始吃光，所以这里把光柱关掉。
    this.pass.set(sdfUniforms(cam3, {
      spark: m.p, sparkLit: 0, dim: 0.9, shaft: 0.12, wall: clamp(prog(t, SEG.frames.at + 2, SEG.frames.at + 5)),
    })).render(gl, ctx.out, t, f.dt);

    /* ---- 矢量层：帧墙 ---------------------------------------------- */
    lines.begin();
    // 扫描线扫到哪一格，哪一格亮起来（扫描线的 x 直接取自母题 —— 两者永不脱节）
    const sweep = m.p[0];
    draw3D(cam3, lines, W, H, frameWallSegs(t, P, { sweep }), { fogNear: 6, fogFar: 30, minW: 0.9, maxW: 6 });
    // 空气与速度
    draw3D(cam3, lines, W, H, dustSegs(cz, t, P, 90), { fogNear: 3, fogFar: 26, minW: 0.9, maxW: 2.4 });
    // 母题：这一段它就是那道扫描线
    const scanA = 0.55 + 0.45 * Math.sin(t * 6.0);
    draw3D(cam3, lines, W, H, [
      [m.p[0], -2.8, m.p[2], m.p[0], 2.8, m.p[2], 1.6, P.signal[0] * 2.4 * scanA, P.signal[1] * 2.4 * scanA, P.signal[2] * 2.4 * scanA, 0.9],
    ], { fogNear: 2, fogFar: 30, minW: 1.2, maxW: 8 });
    lines.flush(ctx.out);

    /* ---- 文字层 ---------------------------------------------------- */
    text.clear();
    const a1 = Math.min(prog(t, SEG.frames.at + 0.8, SEG.frames.at + 1.5, 'outCubic'),
                        1 - prog(t, SEG.frames.at + 4.3, SEG.frames.at + 5.0, 'inQuad'));
    if (a1 > 0.01) {
      type.writeLine('它自己读代码、渲染、看图、改', W / 2, H * 0.30, {
        anchor: 'center', size: 86, weight: 800, family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
        tracking: 4, color: P.css('bone', 0.97 * a1),
      });
      type.writeLine('// README.md · 直到片子对为止', W / 2, H * 0.30 + 74, {
        anchor: 'center', size: 27, family: 'mono', tracking: 3,
        color: P.css('signal', 0.85 * a1),
      });
    }
    const a2 = prog(t, SEG.frames.at + 4.6, SEG.frames.at + 5.3, 'outCubic');
    if (a2 > 0.01) {
      type.writeLine('它看过的那些帧，都还留在 out/ 里', W / 2, H * 0.30, {
        anchor: 'center', size: 78, weight: 800, family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
        tracking: 4, color: P.css('bone', 0.95 * a2),
      });
    }
    type.write('04 / 帧', 54, H - 104, {
      size: 30, family: 'mono', weight: 600, baseline: 'alphabetic', tracking: 4,
      color: P.css('bone', 0.8 * sat(lt / 0.8)),
    });
    timecodeHud(ctx, f, { label: 'render(t)', alpha: 0.34 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    void LANDMARK;
    return postAt(f, grade(t));
  },
};
