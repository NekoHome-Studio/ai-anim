// 验证片 · 第 1 段「石柱走廊」—— **真 raymarch**（pdoom 三种 3D 里的第 ② 种）。
//
// 这一段的来历值得记一笔（`docs/STATUS.md` §13.4）：第一版就是 raymarch，但整屏白，
// 于是临时换成"投影线段批"绕过去了。第五轮把 raymarch 通电之后改了回来 ——
// 根因不在 raymarch 内核，而在**相机 uniform 的字段名**：`camera3()` 给的是
// `{pos,right,up,fwd,focal}`，shader 要的是 `{camPos,camR,camU,camF,focal}`，
// 对不上时 `Pass` 静默跳过那四个 vec3（保持 0）→ `normalize(vec3(0.0))` → NaN →
// 后处理把 NaN 显示成**整屏白**（NaN 和 +Inf 在这条链上长得一模一样）。
// 现在 `cam3Uniforms()` 两种形状都认、认不出来直接抛错，`check` 也会扫非有限值。
//
// 两种实现都留着，用时间线的 `params` 选：`cut(corridor, { params: { impl: 'lines' } })`
// 走投影线段批（第 ① 种 3D），不写 `params` 就是下面的 raymarch。
//
// raymarch 换来了什么（为什么值得为这一段写 SDF）：
//   · **没有几何**：走廊 = 一个盒内腔 + 一个 `floor(p/4)` 重复出来的门框，无限长也不要更多数据；
//   · 门框与侧墙的**遮挡、软阴影、AO** 是算出来的，不是画出来的；
//   · 表面是**雕刻排线**（`engrave3` 挂世界坐标），镜头怎么动排线都钉在石头上。
//
// 世界本身在 `_corridor.js`（第 5 段 `loop.js` 引同一份，所以"回到第一帧"是字面上的同一个 SDF）。
import { css, sat, clamp, prog } from '../../../src/core/util.js';
import { camera3, project3, clipSegment, depthScale } from '../../../src/core/cam.js';
import { makeCorridorPass, corridorUniforms } from './_corridor.js';
import { CORRIDOR, SEG, camPost } from './_world.js';

export default {
  id: 'corridor',

  setup(ctx) {
    // `params.impl`：默认 raymarch；写 'lines' 就退回第 ① 种 3D（投影线段批）。
    // 这也顺便当 `ctx.params` 的活体自检 —— 参数没传进来的话这一段会静默变成 raymarch。
    this.impl = ctx.params?.impl === 'lines' ? 'lines' : 'raymarch';
    /** @type {any} */
    this.pass = null;
    /** @type {any[]} */
    this.segs = [];

    if (this.impl === 'raymarch') {
      this.pass = makeCorridorPass(ctx.gl, ctx.P);
      return;
    }
    this.buildSegments();
  },

  /** 第 ① 种 3D（原来的实现，保留下来做对照）：世界线段 + 逐条投影。 */
  buildSegments() {
    /** @type {any[]} */
    const segs = [];
    const S = (a, b, w, c, al) => segs.push([a[0], a[1], a[2], b[0], b[1], b[2], w, c, al]);
    const HW = 2.2, HH = 1.6, ZF = -4, NZ = 16;
    for (const y of [-HH, HH]) for (const x of [-HW, HW]) S([x, y, 6], [x, y, ZF - NZ * 4 - 8], 0.9, 'graphite', 0.5);
    for (let i = 0; i <= NZ + 2; i++) {
      const z = ZF - i * 4;
      S([-HW, -HH, z], [HW, -HH, z], 1.5, i % 2 === 0 ? 'ash' : 'graphite', i % 2 === 0 ? 0.5 : 0.32);
      S([-HW, HH, z], [HW, HH, z], 1.2, 'graphite', 0.3);
    }
    for (let i = 0; i <= NZ; i++) {
      const z = ZF - i * 4;
      const ax = 1.75, ay = 1.15;
      const corners = [[-ax, -ay], [ax, -ay], [ax, ay], [-ax, ay]];
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) % 4];
        S([a[0], a[1], z], [b[0], b[1], z], 2.0, 'bone', 0.72);
      }
      for (const [cx, cy] of corners) {
        S([cx - 0.16, cy, z], [cx + 0.16, cy, z], 3.0, 'bone', 0.85);
        S([cx, cy - 0.16, z], [cx, cy + 0.16, z], 3.0, 'bone', 0.85);
      }
      for (const sx of [-HW, HW]) {
        for (let t = -3; t <= 3; t++) S([sx, t * 0.42 - 0.08, z], [sx, t * 0.42 + 0.08, z], 1.2, 'ash', 0.4);
      }
    }
    for (let i = 0; i <= NZ; i++) {
      const z = ZF - i * 4 + 2;
      const r = 0.34, N = 16;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
        S([Math.cos(a0) * r, 0.2 + Math.sin(a0) * r, z], [Math.cos(a1) * r, 0.2 + Math.sin(a1) * r, z], 1.4, 'signal', 0.55);
      }
    }
    this.segs = segs;
  },

  render(ctx) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.t;
    const W = ctx.W, H = ctx.H;

    gl.clear(ctx.out, [P.ink[0] * 0.85, P.ink[1] * 0.85, P.ink[2] * 0.85]);

    // ---- 3D 相机：由全片那台 2D 机位换算，切点两侧运动方向自动连续 ----
    const c2 = CORRIDOR.cam2(t);
    const cam = camera3({ pos: c2.pos, target: c2.target, fov: c2.fov, roll: c2.roll, H });

    // 火花（母题）：本段被"点出来"，然后一直带到最后一段
    const sp = CORRIDOR.sparkAt(t);
    const exitGlow = prog(t, SEG.corridor - 2.6, SEG.corridor - 0.2, 'inOutCubic');

    if (this.impl === 'raymarch') {
      this.pass.set(corridorUniforms(cam, {
        spark: sp,
        sparkLit: sp[3],
        exitGlow,
        dbg: Number(ctx.params?.dbg ?? 0),
      })).render(gl, ctx.out, t, f.dt);
    } else {
      // 第 ① 种 3D：逐条投影 + 近平面裁剪 + 深度衰减（原先的实现）
      lines.begin();
      for (const s of this.segs) {
        const a = project3(cam, W, H, s[0], s[1], s[2]);
        const b = project3(cam, W, H, s[3], s[4], s[5]);
        if (!clipSegment(a, b, 0.15)) continue;
        if ((a.x < -200 && b.x < -200) || (a.x > W + 200 && b.x > W + 200)) continue;
        if ((a.y < -200 && b.y < -200) || (a.y > H + 200 && b.y > H + 200)) continue;
        const w = (a.w + b.w) * 0.5;
        const fogK = Math.exp(-Math.max(0, w - 6) * 0.10);
        if (fogK < 0.04) continue;
        const col = P[s[7]] ?? P.bone;
        const lw = clamp(s[6] * depthScale(cam, w, H) * 3.2, 0.9, 9);
        const al = s[8] * fogK;
        lines.seg(a.x, a.y, b.x, b.y, lw, [col[0] * al, col[1] * al, col[2] * al]);
      }
      const s3 = project3(cam, W, H, sp[0], sp[1], sp[2]);
      if (s3.w > 0.2) {
        const lit = sp[3] * (0.86 + 0.14 * Math.sin(t * 91.7) * Math.sin(t * 57.3));
        const r = clamp(2.8 * depthScale(cam, s3.w, H) * 12, 3, 34);
        lines.seg(s3.x, s3.y, s3.x + 0.01, s3.y, r * 2.6, [P.signal[0] * 0.38 * lit, P.signal[1] * 0.38 * lit, P.signal[2] * 0.38 * lit, 0.34]);
        lines.seg(s3.x, s3.y, s3.x + 0.01, s3.y, r, [P.ember[0] * 2.5 * lit, P.ember[1] * 2.5 * lit, P.ember[2] * 2.5 * lit, 0.85]);
        lines.seg(s3.x, s3.y, s3.x + 0.01, s3.y, r * 0.38, [5.6 * lit, 4.7 * lit, 3.7 * lit, 1]);
      }
      lines.flush(ctx.out);
    }

    // ---- 前景刻度尺（两种实现共用：它是"这一段在走"的第二种读数）----
    lines.begin();
    const yBase = 858;
    for (let i = 0; i <= 24; i++) {
      const x = 120 + i * 70;
      const big = i % 4 === 0;
      const k = big ? 0.85 : 0.45;
      lines.seg(x, yBase, x, yBase + (big ? 26 : 12), big ? 2.6 : 1.6, [P.bone[0] * k, P.bone[1] * k, P.bone[2] * k]);
    }
    lines.seg(120, yBase, 120 + 24 * 70, yBase, 1.6, [P.bone[0] * 0.5, P.bone[1] * 0.5, P.bone[2] * 0.5]);
    const head = 120 + sat(t / (SEG.corridor * 0.94)) * 24 * 70;
    lines.seg(Math.max(120, head - 260), yBase, head, yBase, 4.0, P.signal);
    lines.flush(ctx.out);

    text.clear();
    const a = sat(t / 0.5) * sat((SEG.corridor - t) / 0.7);
    if (a > 0.01) {
      type.writeLine('同一层世界 · 同一台摄影机', 960, 176, {
        anchor: 'center', size: 50, weight: 600, family: 'sans',
        color: css(P.ash, 0.85 * a), tracking: 0.34,
      });
      type.writeLine('切点是硬切 —— 连续性靠世界、摄影机、母题', 960, 242, {
        anchor: 'center', size: 30, weight: 500, family: 'mono',
        color: css(P.ash, 0.55 * a), tracking: 0.18,
      });
    }
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return camPost(t, f.idx, { bloom: 0.34, bloomThreshold: 0.92, grain: 0.03, vignette: 0.44 });
  },
};
