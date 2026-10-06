// @ts-check
/**
 * 段 1 · `caret`（0.0 – 6.0s）—— 黑场里，一支光标打出一行代码。
 *
 * 全片最安静的 6 秒。它要立住两件事：
 *   ① **时间是这个引擎唯一的输入** —— 所以左下角那个 `t = …` 读数从第一秒就在走；
 *   ② **母题登场** —— 那根竖线（光标）在最后 0.9 秒起飞，变成后面 40 秒一直领路的那个光点。
 *
 * 调试开关（时间线 `params`，不用改代码）：
 *   `params: { dbg: 1|2|3|4|5 }` 只画某一组（1 浮尘 / 2 光标 / 3 基线 / 4 母题 / 5 走廊），
 *   `params: { useT: 5 }` 强制用整片时刻 5s 渲这一帧（配合 `--only` 时用）。
 */
import {
  CHAR_H, FIRST_LINE, LINE_X0, TYPE_AT, TYPE_SPAN,
  cam3At, codeSegs, codeGateText, dustSegs, doorSegs, draw3D, motifSegs,
  postAt, timecodeHud, typeProgress, zAt, SEG, LANDMARK, blink,
} from './_world.js';
import { project3, depthScale } from '../../../src/core/cam.js';
import { clamp, prog, sat } from '../../../src/core/util.js';

export default {
  id: 'caret',

  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W, H } = ctx;
    const t = Number(ctx.params?.useT ?? f.t);
    const dbg = Number(ctx.params?.dbg ?? 0);
    const only = (k) => dbg === 0 || dbg === k;
    const cam3 = cam3At(t, H);
    const zLine = LANDMARK.firstLine;
    const cz = zAt(t);

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    /* ---- 那行字在这一帧的排版（矢量与文字两层共用同一组数） ---------- */
    const cp = project3(cam3, W, H, LINE_X0, 0.0, zLine);
    const px = CHAR_H * depthScale(cam3, cp.w, H) * H;          // 字高（像素）
    const tracking = px * 0.05;
    const tp = typeProgress(t);
    const shown = Math.min(FIRST_LINE.length, tp * FIRST_LINE.length);
    const prefix = FIRST_LINE.slice(0, Math.round(shown));
    const worldPerPx = CHAR_H / Math.max(1e-6, px);             // 像素 → 世界单位
    const caretX = LINE_X0 + (prefix.length ? type.measure(prefix, { size: px, family: 'mono', tracking }) : 0) * worldPerPx;

    /* ---- 矢量层 ---------------------------------------------------- */
    lines.begin();

    // 走廊在最后 1.8 秒才开始"长出来"（这段的主体是那行字，不是走廊）
    const grow = prog(t, 4.2, SEG.caret.dur, 'inOutCubic');
    if (grow > 0.001 && only(5)) {
      const { segs } = codeSegs(cz, t, P, { depth: 46, dim: 0.6 * grow });
      draw3D(cam3, lines, W, H, segs, { fogNear: 14, fogFar: 52 });
      draw3D(cam3, lines, W, H,
        doorSegs(t, P).map((s) => [...s.slice(0, 11), s[10] * grow]),
        { fogNear: 10, fogFar: 44 });
    }
    if (only(1)) {
      draw3D(cam3, lines, W, H, dustSegs(cz, t, P, 70), { fogNear: 4, fogFar: 34, minW: 0.9, maxW: 2.2 });
    }

    // 打字机末尾那根竖线 + 光晕（母题的第一形态）
    // ⚠ 这些是世界坐标，必须走 `draw3D` 投影 —— `lines.seg()` 收的是**屏幕逻辑像素**，
    //   把世界坐标直接喂进去会画出莫名其妙的东西（第一版就这么错了：左上角一块纯白）。
    if (tp > 0.001 && only(2)) {
      const lit = tp >= 1 ? blink(t, 1.0) : 1;
      const bx = caretX + 0.02;
      const beam = 0.175;
      const sig = P.signal;
      draw3D(cam3, lines, W, H, [
        [bx, -beam, zLine, bx, beam, zLine, 0.30, sig[0] * 3.0 * lit, sig[1] * 3.0 * lit, sig[2] * 3.0 * lit, 1],
        [bx, -beam * 0.55, zLine, bx, beam * 0.55, zLine, 0.95, sig[0] * 0.8 * lit, sig[1] * 0.8 * lit, sig[2] * 0.8 * lit, 0.45],
        [bx - 0.05, 0, zLine, bx + 0.05, 0, zLine, 0.16, P.bone[0], P.bone[1], P.bone[2], 0.5 * lit],
      ], { fogNear: 0.5, fogFar: 40, minW: 1, maxW: 30 });
    }
    if (only(3)) {
      // 文字底下那道基线：让这行字"坐"在世界里，而不是浮在画面上
      const baseA = 0.32 * prog(t, 0.4, 2.0, 'outCubic');
      const gr = P.graphite;
      draw3D(cam3, lines, W, H, [
        [LINE_X0 - 0.16, -0.26, zLine, 2.5, -0.26, zLine, 0.10, gr[0], gr[1], gr[2], baseA],
        [LINE_X0 - 0.16, -0.26, zLine, LINE_X0 - 0.16, 0.26, zLine, 0.10, gr[0], gr[1], gr[2], baseA * 0.8],
      ], { fogNear: 0.5, fogFar: 40, minW: 1, maxW: 8 });
    }
    if (only(4)) {
      draw3D(cam3, lines, W, H, motifSegs(t, P, { r: 0.05 }), { fogNear: 2, fogFar: 30, minW: 1, maxW: 4 });
    }
    lines.flush(ctx.out);

    /* ---- 文字层 ---------------------------------------------------- */
    text.clear();
    if (only(0) && grow > 0.001) {
      codeGateText(ctx, cam3, cz, { textDepth: 22, heroH: 0.19, gateH: 0.10 });
    }
    if (only(0)) {
      // 那一行代码：逐字打出来（数组型 alpha + stagger 就是打字机）
      type.write(FIRST_LINE, cp.x, cp.y, {
        size: px, family: 'mono', baseline: 'middle', tracking,
        color: P.css('bone'),
        alpha: [0, 1], stagger: TYPE_SPAN / FIRST_LINE.length, staggerDur: 0.16,
        t: t - TYPE_AT,
      });

      // 一行注释：这支片子的全部方法论（措辞逐字来自 AGENTS.md）
      const noteA = prog(t, 3.4, 4.6, 'outCubic');
      if (noteA > 0.01) {
        const np = project3(cam3, W, H, LINE_X0, -0.66, zLine + 0.08);
        type.write('// 每一帧都是时间的纯函数', np.x, np.y, {
          size: px * 0.42, family: 'mono', baseline: 'middle', tracking: px * 0.02,
          color: P.css('ash', 0.9 * noteA),
        });
      }
    }
    timecodeHud(ctx, f, { label: 'render(t)', alpha: 0.3 + 0.22 * sat(t / 2) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return postAt(f, {
      bloom: 0.34 + 0.12 * sat(t / 4),
      bloomThreshold: 0.78,
      grain: 0.028,
      vignette: 0.55,
      ca: 0.35,
      exposure: 1.0 + 0.06 * prog(t, 4.2, 6.0, 'inOutCubic'),
      fade: clamp(1 - prog(t, 0, 0.7, 'outQuad')),   // 前 0.7 秒从纯黑里浮出来
    });
  },
};
