// 验证片 · 第 4 段「柱林」—— 投影线段批的常规用法 + 甩镜拖影。
//
// 这一段最普通，作用是把"第 1 类 3D"的日常写法摆出来：
//   · 一台 3D 摄影机（`camera3`），一排沿 z 摆开的立柱
//   · 每根柱子按深度做**亮度衰减 + 线宽衰减**（Fog 的最便宜形式）
//   · 甩镜时把几何沿摄影机速度**多画两遍**（`smearTimes`），而不是开全局模糊
import { css, clamp, sat, prog } from '../../../src/core/util.js';
import { camera3, project3, clipSegment, depthScale, smearTimes } from '../../../src/core/cam.js';
import { camAt, camPost, sparkAt, WORLD, SEG } from './_world.js';

export default {
  id: 'columns',

  setup(ctx) {
    /** 立柱：沿 z 排开，x 上错落（世界坐标） */
    /** @type {any[]} */
    this.posts = [];
    const rng = ctx.rng(7788);
    for (let i = 0; i < 22; i++) {
      const x = (rng() - 0.5) * 7.6;
      const z = -2 - i * 1.35;
      const h = 2.2 + rng() * 2.6;
      this.posts.push([x, z, h]);
    }
  },

  render(ctx) {
    const { f, gl, lines, text, type, comp, P: PAL } = ctx;
    const t = f.t;
    const W = ctx.W, H = ctx.H;
    const lt = t - WORLD.at.columns;

    gl.clear(ctx.out, [PAL.ink[0] * 0.78, PAL.ink[1] * 0.78, PAL.ink[2] * 0.78]);

    // ---- 摄影机：全片那一台 2D 机位换算成 3D 的位置/朝向 ----
    // （用 2D 机位驱动 3D 机位，切点两侧的运动方向就自动连续了）
    const cam2 = camAt(t);
    const sway = (cam2.x - 960) / 900;
    const cam = camera3({
      pos: [sway * 3.0, 1.35 + (540 - cam2.y) / 1400, 3.4],
      target: [sway * 2.2, 1.05, -9],
      fov: 44,
      roll: cam2.rot * 0.8,
      H,
    });

    // ---- 甩镜：沿摄影机速度把几何多画几遍（几何侧拖影，不动背景）----
    const times = smearTimes({ at: (tt) => camAt(tt) }, t, f.dt, { unit: 40, maxSamples: 5, maxTravel: 260 });
    const nSm = times.length;
    const aSm = nSm > 1 ? 1.5 / nSm : 1;

    lines.begin();
    for (const tt of times) {
      const c2 = camAt(tt);
      const c3 = camera3({
        pos: [(c2.x - 960) / 900 * 3.0, 1.35 + (540 - c2.y) / 1400, 3.4],
        target: [(c2.x - 960) / 900 * 2.2, 1.05, -9],
        fov: 44, roll: c2.rot * 0.8, H,
      });
      for (const [x, z, h] of this.posts) {
        const a = project3(c3, W, H, x, 0, z);
        const b = project3(c3, W, H, x, h, z);
        if (!clipSegment(a, b, 0.1)) continue;
        if (a.x < -300 || a.x > W + 300) continue;
        const w = a.w;
        const fog = Math.exp(-Math.max(0, w - 4) * 0.085);
        if (fog < 0.05) continue;
        const al = fog * aSm;
        const col = w < 7 ? PAL.bone : PAL.ash;
        const lw = clamp(0.03 * depthScale(c3, w, H) * 3.4, 1.1, 11);
        lines.seg(a.x, a.y, b.x, b.y, lw, [col[0] * al, col[1] * al, col[2] * al]);
        // 底座：给"地面"一个可读的锚
        const c0 = project3(c3, W, H, x - 0.34, 0, z);
        const c1 = project3(c3, W, H, x + 0.34, 0, z);
        if (clipSegment(c0, c1, 0.1)) {
          lines.seg(c0.x, c0.y, c1.x, c1.y, lw * 0.8, [col[0] * al * 0.7, col[1] * al * 0.7, col[2] * al * 0.7]);
        }
      }
    }
    // 地平线：一道很淡的横线，给画面一个"世界"的底
    const hz = project3(cam, W, H, 0, 0, -60);
    lines.seg(-200, hz.y, W + 200, hz.y, 1.2, [PAL.bone[0] * 0.10, PAL.bone[1] * 0.10, PAL.bone[2] * 0.10]);
    lines.flush(ctx.out);

    // ---- 火花：在第 3 根柱子上方穿过（母题继续）----
    const s0 = sparkAt(t);
    const lit = s0.lit * (0.86 + 0.14 * Math.sin(t * 91.7) * Math.sin(t * 57.3));
    lines.begin();
    lines.seg(s0.x, s0.y, s0.x + 0.01, s0.y, 32, [PAL.signal[0] * 0.4 * lit, PAL.signal[1] * 0.4 * lit, PAL.signal[2] * 0.4 * lit, 0.32]);
    lines.seg(s0.x, s0.y, s0.x + 0.01, s0.y, 14, [PAL.ember[0] * 2.5 * lit, PAL.ember[1] * 2.5 * lit, PAL.ember[2] * 2.5 * lit, 0.85]);
    lines.seg(s0.x, s0.y, s0.x + 0.01, s0.y, 5, [5.6 * lit, 4.7 * lit, 3.7 * lit, 1]);
    lines.flush(ctx.out);

    text.clear();
    const a1 = sat(lt / 0.4) * sat((SEG.columns - lt) / 0.5);
    if (a1 > 0.01) {
      type.writeLine('投影线段批 = 最便宜的那种 3D', 960, 176, {
        anchor: 'center', size: 46, weight: 600, family: 'sans',
        color: css(PAL.bone, 0.92 * a1), tracking: 0.2,
      });
      type.writeLine('深度只用来衰减亮度和线宽 —— 不需要深度缓冲', 960, 234, {
        anchor: 'center', size: 28, weight: 500, family: 'mono',
        color: css(PAL.ash, 0.7 * a1), tracking: 0.15,
      });
    }
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    const whip = clamp(prog(t, WORLD.at.columns - 0.9, WORLD.at.columns - 0.15), 0, 1);
    return camPost(t, f.idx, { bloom: 0.33, grain: 0.03, vignette: 0.45, ca: 0.8 + 4.5 * whip * (nSm > 1 ? 1 : 0) });
  },
};
