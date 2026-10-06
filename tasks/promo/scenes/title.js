// @ts-check
/**
 * 段 6 · `title`（42.0 – 48.0s）—— 落版：**写代码，就是做动画**。
 *
 * 摄影机减速、停在世界尽头那面墙前 4 个单位（`z=−128`，墙在 `−132`）。
 * 那面墙是 SDF 世界的一部分（材质 5），它的自发光随 `uWall` 升起来 ——
 * 于是片子**没有切到一张平面字卡**：我们是真的飞到一面发光的墙前面，
 * 片名就浮在那面墙上，最后 1.3 秒淡出。
 *
 * 落版的三行字全部来自 README 的第一句（出处见 FACTS.md）。
 */
import {
  SEG, cam3At, draw3D, endWallSegs, grade, motifAt, outroFade, postAt,
  timecodeHud, zAt, LANDMARK,
} from './_world.js';
import { makeSdfPass, sdfUniforms } from './_sdf.js';
import { project3, depthScale } from '../../../src/core/cam.js';
import { clamp, prog, sat } from '../../../src/core/util.js';

export default {
  id: 'title',

  setup(ctx) {
    this.pass = makeSdfPass(ctx.gl, ctx.P);
  },

  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W, H } = ctx;
    const t = Number(ctx.params?.useT ?? f.t);
    const cam3 = cam3At(t, H);
    const cz = zAt(t);
    const out = outroFade(t);

    // 母题：火花在 42–43.4s 之间"落到"墙上，然后熄灭 —— 它变成片名后面那根光标
    const sparkLit = 1 - sat(prog(t, SEG.title.at + 1.2, SEG.title.at + 2.6, 'inOutCubic'));
    const m = motifAt(t);
    this.pass.set(sdfUniforms(cam3, {
      spark: m.p,
      sparkLit,
      dim: 1,
      shaft: 0.10,
      wall: prog(t, SEG.title.at + 0.3, SEG.title.at + 2.4, 'outCubic'),
    })).render(gl, ctx.out, t, f.dt);

    /* ---- 矢量层：墙的边框 ------------------------------------------ */
    lines.begin();
    draw3D(cam3, lines, W, H, endWallSegs(t, P), { fogNear: 3, fogFar: 40, minW: 1, maxW: 9 });
    lines.flush(ctx.out);

    /* ---- 文字层：片名浮在墙上 --------------------------------------- */
    text.clear();
    const wp = project3(cam3, W, H, 0, 0, LANDMARK.wall + 0.2);   // 墙面中心
    const scale = depthScale(cam3, wp.w, H) * H;                  // 每世界单位多少像素
    const a = prog(t, SEG.title.at + 1.4, SEG.title.at + 2.8, 'outCubic');
    if (a > 0.01) {
      // 字标：世界高度 0.62 → 最后一帧约 170px
      const s1 = 0.62 * scale;
      type.writeLine('anim', wp.x - 0.02 * scale, wp.y - 0.36 * scale, {
        anchor: 'left', size: s1, weight: 800,
        family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
        tracking: s1 * 0.02, color: P.css('ink', 0.97 * a),
      });
      // 片名：两支笔写的那句话
      const s2 = 0.50 * scale;
      type.writeLine('写代码，就是做动画', wp.x, wp.y + 0.28 * scale, {
        anchor: 'center', size: s2, weight: 800,
        family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
        tracking: s2 * 0.04, color: P.css('ink', 0.98 * a),
      });
      // 一行小字
      type.writeLine('确定性代码动画引擎 · 没有图片素材 · 没有视频素材', wp.x, wp.y + 0.78 * scale, {
        anchor: 'center', size: 0.16 * scale, family: 'mono', tracking: 0.02 * scale,
        color: P.css('ink', 0.80 * a),
      });
      // 母题的最后形态：片名后面那根光标（画在文字层，和字同一个坐标系，绝不会错位）
      if (t > SEG.title.at + 3.6) {
        const lit = (t % 1.0) < 0.62 ? 1 : 0.15;
        const wLine = type.measure('写代码，就是做动画', {
          size: s2, weight: 800, family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif", tracking: s2 * 0.04,
        });
        const cw = 0.15 * scale, ch = 0.46 * scale;
        text.ctx.fillStyle = P.css('ink', 0.9 * a * lit);
        text.ctx.fillRect(wp.x + wLine / 2 + 0.07 * scale, wp.y + 0.28 * scale - ch * 0.66, cw, ch);
      }
    }
    timecodeHud(ctx, f, { label: 'render(t)', alpha: 0.30 * (1 - out) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const g = grade(t);
    return postAt(f, {
      ...g,
      fade: clamp(g.fade + out),                    // 收尾：最后 1.3 秒淡到黑
      bloom: g.bloom * (1 - 0.4 * out),
      exposure: g.exposure * (1 - 0.15 * out),
    });
  },
};
