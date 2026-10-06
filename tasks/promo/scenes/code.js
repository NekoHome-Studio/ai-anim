// @ts-check
/**
 * 段 2 · `code`（6.0 – 16.0s）—— 冲进代码走廊。
 *
 * 摄影机从 `z=-1.6` 一路加到 `z=-22`：先穿过段 1 打出来的那一行，然后是**无限长**的代码走廊
 * （墙面是向消失点收敛的短划线、地板每行一根刻度、每 8 行一道门、门楣上写着真实代码）。
 * 速度是靠"层"读出来的，不是靠模糊。
 *
 * 屏幕上飘过的两句大字是 README 的原话（出处见 FACTS.md）。
 */
import {
  SEG, cam3At, codeGateText, codeSegs, doorSegs, draw3D, dustSegs,
  motifSegs, postAt, scanSegs, timecodeHud, zAt,
} from './_world.js';
import { project3, depthScale } from '../../../src/core/cam.js';
import { clamp, prog, sat } from '../../../src/core/util.js';

/** 走廊里飘过的大字。放成"世界里的实体"，所以它们从镜头两侧飞过去。 */
const BIG_WORDS = [
  { t0: 10.6, z: -11.5, y: 0.62, s: '没有图片素材' },
  { t0: 13.6, z: -17.0, y: -0.74, s: '没有视频素材' },
];

export default {
  id: 'code',

  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W, H } = ctx;
    const t = Number(ctx.params?.useT ?? f.t);
    const cam3 = cam3At(t, H);
    const cz = zAt(t);

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    /* ---- 矢量层 ---------------------------------------------------- */
    lines.begin();
    // 走廊：长边 + 墙面的代码条纹 + 地板刻度 + 门框 —— 接着段 1 的位置继续长
    const { segs } = codeSegs(cz, t, P, { depth: 58, dim: 1 });
    draw3D(cam3, lines, W, H, segs, { fogNear: 16, fogFar: 58 });
    draw3D(cam3, lines, W, H, dustSegs(cz, t, P, 130), { fogNear: 4, fogFar: 46, minW: 0.9, maxW: 2.2 });
    // 踩拍的扫描环：每一拍一道，从镜头前面推向深处
    draw3D(cam3, lines, W, H, scanSegs(cz, t, P, { period: 1.0, span: 30, amp: 0.5 }),
      { fogNear: 2, fogFar: 34, minW: 1.2, maxW: 6 });
    // 门：走廊尽头那道（段 3 从它中间穿过去）。越近越亮
    draw3D(cam3, lines, W, H, doorSegs(t, P), { fogNear: 6, fogFar: 40, minW: 1.2, maxW: 8 });
    // 母题：镜头前面那颗拖着尾迹的光点（它领着镜头走）
    draw3D(cam3, lines, W, H, motifSegs(t, P, { r: 0.085 }), { fogNear: 2, fogFar: 34, minW: 1.2, maxW: 6 });
    lines.flush(ctx.out);

    /* ---- 文字层 ---------------------------------------------------- */
    text.clear();

    // 可读的代码只在英雄行与门楣上（见 _world.js 里 codeSegs 的注释）
    codeGateText(ctx, cam3, cz, { textDepth: 30, heroH: 0.20, gateH: 0.115, roll: 0 });

    // 飘过的两句大字
    for (const wdef of BIG_WORDS) {
      const a = prog(t, wdef.t0, wdef.t0 + 0.5, 'outCubic');
      if (a <= 0.01) continue;
      const w = cz - wdef.z;
      if (w < 0.6 || w > 26) continue;
      const p = project3(cam3, W, H, -2.35, wdef.y, wdef.z);
      const px = clamp(0.40 * depthScale(cam3, p.w, H) * H, 1, 300);
      const fadeOut = clamp(1 - (w - 14) / 8);
      type.write(wdef.s, p.x, p.y, {
        size: px, family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif", weight: 800,
        baseline: 'middle', tracking: px * 0.03,
        color: P.css('bone', 0.97 * fadeOut * a),
      });
      type.write('// README.md', p.x, p.y + px * 0.86, {
        size: px * 0.22, family: 'mono', baseline: 'middle', tracking: px * 0.01,
        color: P.css('signal', 0.7 * fadeOut * a),
      });
    }

    // 章节标题（左下）
    const capA = prog(t, SEG.code.at + 3.6, SEG.code.at + 4.4, 'outCubic');
    if (capA > 0.01) {
      type.write('01 / 世界是算出来的', 54, H - 104, {
        size: 30, family: 'mono', weight: 600, baseline: 'alphabetic', tracking: 4,
        color: P.css('bone', 0.8 * capA),
      });
    }
    timecodeHud(ctx, f, { label: 'render(t)', alpha: 0.34 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    // 进门那一下给一记亮（硬切点上的一口气）
    const doorFlash = sat(prog(t, SEG.engine.at - 0.55, SEG.engine.at + 0.12));

    return postAt(f, {
      bloom: 0.42 + 0.18 * doorFlash,
      bloomThreshold: 0.74,
      grain: 0.03,
      vignette: 0.5,
      ca: 0.5 + 1.4 * doorFlash,
      exposure: 1.0 + 0.35 * doorFlash,
      // 段首 0.35 秒的极轻压暗：硬切看起来更像一次穿门
      fade: 0.20 * (1 - sat(prog(t, SEG.code.at, SEG.code.at + 0.35, 'outQuad'))),
    });
  },
};
