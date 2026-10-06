// @ts-check
/**
 * 段 4 · `lattice`（26.0 – 36.0s）—— 俯冲：穿过无限重复的晶格隧道。
 *
 * 与段 3 **共用同一份 SDF**（`_sdf.js` 的 `makeSdfPass`）：26.0s 那一刻摄影机正好在大厅
 * 尽头，之后一路加速到 `z=−104`，窗外从柱廊变成每 3.2 个单位一道的方环晶格。
 * 画面上没有一次剪辑 —— 这是"一镜到底"里最贵、也最值得的十秒。
 *
 * 叠在线框层上的两条速度读数：世界里的**流线**（沿镜头方向拉长的曳光）与
 * 踢鼓时整条隧道的**呼吸**。
 */
import {
  SEG, cam3At, draw3D, grade, motifAt, postAt, timecodeHud, zAt,
} from './_world.js';
import { makeSdfPass, sdfUniforms } from './_sdf.js';
import { clamp, hash2, prog, sat } from '../../../src/core/util.js';

/** 屏幕上出现的事实（出处见 FACTS.md：README / docs/STATUS.md）。 */
const FACTS = [
  { t0: 27.0, t1: 30.4, zh: '每一帧都是时间的纯函数', mono: 'render(t)  ← 唯一的输入' },
  { t0: 31.0, t1: 34.4, zh: '任意 seek · 多子帧求平均做真运动模糊', mono: '// 同一帧渲两遍，逐字节相同' },
];

export default {
  id: 'lattice',

  setup(ctx) {
    this.pass = makeSdfPass(ctx.gl, ctx.P);
  },

  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W, H } = ctx;
    const t = Number(ctx.params?.useT ?? f.t);
    const cam3 = cam3At(t, H);
    const m = motifAt(t);
    const lt = t - SEG.lattice.at;
    const dive = prog(t, SEG.lattice.at, SEG.lattice.at + SEG.lattice.dur, 'inOutCubic');
    const beat = sat((f.a?.kick ?? 0) * 1.2);

    this.pass.set(sdfUniforms(cam3, {
      spark: m.p,
      sparkLit: m.lit,
      dim: 1 + 0.10 * beat,
      // 隧道里没有天光：光柱收到很低，靠晶格自己的冷光
      shaft: 0.30 * (1 - dive),
      dbg: Number(ctx.params?.dbg ?? 0),
    })).render(gl, ctx.out, t, f.dt);

    /* ---- 矢量层：速度的读数 ---------------------------------------- */
    lines.begin();
    const cz = zAt(t);
    const speed = clamp(dive * 1.0 + 0.35 * (1 + beat * 0.4));
    // 流线：沿世界 −z 拉长的曳光（它们是**世界里的实体**，镜头一动就被拉成线）
    const c = P.signal;
    /** @type {any[][]} */
    const streams = [];
    for (let i = 0; i < 30; i++) {
      const s1 = hash2(i, 3), s2 = hash2(i, 71), s3 = hash2(i, 149);
      const period = 9.0;
      const z = cz - 2.5 - ((s1 * period + t * (5.5 + 3 * s3)) % period);
      const x = (s2 - 0.5) * 5.4;
      const y = (s3 - 0.5) * 4.0;
      const len = (0.9 + 2.6 * s3) * speed;
      const a = (0.10 + 0.20 * s3) * (0.45 + 0.55 * speed);
      streams.push([x, y, z, x, y, z - len, 0.9, c[0], c[1], c[2], a]);
    }
    draw3D(cam3, lines, W, H, streams, { fogNear: 2, fogFar: 30, minW: 0.8, maxW: 3.2 });
    lines.flush(ctx.out);

    /* ---- 文字层 ---------------------------------------------------- */
    text.clear();
    for (const it of FACTS) {
      const a = Math.min(prog(t, it.t0, it.t0 + 0.7, 'outCubic'), 1 - prog(t, it.t1, it.t1 + 0.5, 'inQuad'));
      if (a <= 0.01) continue;
      const y = H * 0.68;
      type.writeLine(it.zh, W / 2, y, {
        anchor: 'center', size: 84, weight: 800, family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
        tracking: 3, color: P.css('bone', 0.97 * a),
      });
      type.writeLine(it.mono, W / 2, y + 72, {
        anchor: 'center', size: 26, family: 'mono', tracking: 3,
        color: P.css('signal', 0.85 * a),
      });
    }
    const capA = prog(t, SEG.lattice.at + 0.5, SEG.lattice.at + 1.3, 'outCubic');
    if (capA > 0.01) {
      type.write('03 / 无限', 54, H - 104, {
        size: 30, family: 'mono', weight: 600, baseline: 'alphabetic', tracking: 4,
        color: P.css('bone', 0.8 * capA),
      });
    }
    timecodeHud(ctx, f, { label: 'render(t)', alpha: 0.34 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    void lt;
    return postAt(f, grade(t));
  },
};
