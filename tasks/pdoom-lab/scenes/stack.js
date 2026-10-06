// 验证片 · 第 3 段「塔」—— **一镜到底**（pdoom `stack.ts` 的做法）。
//
// 这一段演示"为什么它看起来不像切镜头"：
//   · 世界位置是一个**连续函数** `fall(t)`，摄影机**只跟随**它（`focus` 永远在画面中心）
//     → 内部怎么换视角都像"换角度"，不像"换镜头"
//   · 推进感 = **提前量 + 弹簧落定**（每拍提前 0.22 拍启动，拍上弹到位）
//   · 拖影 = 沿下落方向把**几何**复制若干份（不是后处理糊全屏）
//     —— 后处理会把不动的背景也糊掉，看起来像镜头脏了
//
// 用的是「第 1 类 3D」：`cam.js` 的 `project3` + `clipSegment`，交给 `lines` 画胶囊。
import { css, clamp, ease, prog, sat } from '../../../src/core/util.js';
import { camera3, project3, clipSegment, depthScale } from '../../../src/core/cam.js';
import { sparkAt, camAt, camPost, WORLD, HANDOFF, SEG } from './_world.js';

/** 层高：每拍一层 */
const P = 1.15;
/** 每拍提前多少启动（pdoom `stack.ts` 的 LEAD = 0.22） */
const LEAD = 0.22;

/**
 * 本段的"世界位置"：一个 t 的连续函数（**不是**逐帧累积）。
 * 每拍往前走一层，走法是"提前量 + 弹簧落定"：
 *   拍前 0.22 拍先滑出 22%，拍上被弹簧拉到 1 —— 读起来是"被吸过去"，不是"匀过去"。
 */
function fall(t) {
  const at = WORLD.at.stack;
  const lt = t - at;
  const beats = Math.max(1, Math.floor(SEG.stack / WORLD.beat));
  let p = 0;
  for (let i = 1; i <= beats; i++) {
    const tb = i * WORLD.beat;
    if (lt > tb - LEAD) {
      const u = clamp((lt - (tb - LEAD)) / (LEAD + 0.34));
      p += LEAD + (1 - LEAD) * clamp(ease.outExpo(u), 0, 1.06);
    }
  }
  return p;
}

export default {
  id: 'stack',

  setup(ctx) {
    // 每层的东西：地板网格 + 角柱 + 中轴的信标。全部只算一次（世界坐标，不随 t 变）。
    /** @type {any[]} */
    this.unit = [];
    const R = 1.45, H = 0.92;
    const S = (x0, y0, z0, x1, y1, z1, w, c, a) => this.unit.push([x0, y0, z0, x1, y1, z1, w, c, a]);
    // 地板方框
    const corners = [[-R, -H, -R], [R, -H, -R], [R, -H, R], [-R, -H, R]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      S(a[0], a[1], a[2], b[0], b[1], b[2], 0.016, 'bone', 0.55);
    }
    // 上方横梁（快落时这一圈圈"扑面而过"，速度感的主要来源）
    const top = corners.map((c) => [c[0] * 0.92, H, c[2] * 0.92]);
    for (let i = 0; i < 4; i++) {
      const a = top[i], b = top[(i + 1) % 4];
      S(a[0], a[1], a[2], b[0], b[1], b[2], 0.013, 'ash', 0.40);
    }
    // 四根角柱：把上下两层连起来
    for (let i = 0; i < 4; i++) {
      S(corners[i][0], corners[i][1], corners[i][2], top[i][0], top[i][1], top[i][2], 0.011, 'graphite', 0.55);
    }
    // 中轴信标（火花就在这条轴上）
    S(0, -H, 0, 0, H, 0, 0.009, 'signal', 0.30);
  },

  render(ctx) {
    const { f, gl, lines, text, type, comp, P: PAL } = ctx;
    const t = f.t;
    const W = ctx.W, Hh = ctx.H;
    const at = WORLD.at.stack;
    const lt = t - at;

    gl.clear(ctx.out, [PAL.ink[0] * 0.8, PAL.ink[1] * 0.8, PAL.ink[2] * 0.8]);

    // ---- 摄影机：只跟随 `fall(t)`，所以主体永远在画面中心 ----
    const pos = fall(t);
    const cy = -pos * P;                       // 焦点（世界）随下落下移
    const drift = 0.10 * Math.sin(lt * 0.5);   // 一点点横移，避免"电梯"
    const cam = camera3({
      pos: [drift, cy + 0.35, 3.15],
      target: [drift * 0.4, cy - 1.05, 0],
      fov: 42,
      roll: 0.014 * Math.sin(lt * 0.8) + 0.02 * prog(t, WORLD.at.columns - 0.8, WORLD.at.columns, 'inOutCubic'),
      H: Hh,
    });

    // ---- 拖影：沿下落方向把几何复制几份（pdoom stack.ts 的原式）----
    const shutter = 0.9 / 60;
    const dy = (fall(t) - fall(t - shutter)) * P;         // 这一帧世界往下走了多少
    const smear = clamp(Math.abs(dy) / 0.10, 1, 10);      // 份数
    const alpha = smear > 1.5 ? 1.6 / smear : 1;

    const floors = 26;
    const k0 = Math.max(0, Math.floor(pos) - 3);
    lines.begin();
    for (let s = 0; s < Math.max(1, Math.round(smear)); s++) {
      const back = smear > 1.5 ? (s / (Math.round(smear) - 1)) * dy : 0;
      for (let k = k0; k < k0 + floors; k++) {
        const by = -k * P + back;
        // 雾按"这一层离摄影机多远"算（世界距离，不是屏幕距离）
        const fog = Math.exp(-Math.max(0, Math.hypot(by - cy, 3.15)) * 0.16);
        if (fog < 0.03) continue;
        const boost = k === Math.round(pos) ? 1.5 : 1;
        for (const sgm of this.unit) {
          const a = project3(cam, W, Hh, sgm[0], sgm[1] + by, sgm[2]);
          const b = project3(cam, W, Hh, sgm[3], sgm[4] + by, sgm[5]);
          if (!clipSegment(a, b, 0.08)) continue;
          if ((a.x < -400 && b.x < -400) || (a.x > W + 400 && b.x > W + 400)) continue;
          if ((a.y < -400 && b.y < -400) || (a.y > Hh + 400 && b.y > Hh + 400)) continue;
          const col = PAL[sgm[7]] ?? PAL.bone;
          const w = clamp(sgm[6] * depthScale(cam, (a.w + b.w) * 0.5, Hh) * 2.6, 0.85, 9);
          const al = sgm[8] * fog * alpha * boost;
          lines.seg(a.x, a.y, b.x, b.y, w, [col[0] * al, col[1] * al, col[2] * al]);
        }
      }
    }
    lines.flush(ctx.out);

    // ---- 火花（母题）：它在本段顺着塔的中轴一路落下去 ----
    const s0 = sparkAt(t);                                     // 2D 世界的火花（决定它的屏幕位置）
    const sx = s0.x + (s0.x - 1180) * 0.15;
    const sy = s0.y;
    const lit = s0.lit * (0.86 + 0.14 * Math.sin(t * 91.7) * Math.sin(t * 57.3));
    lines.begin();
    lines.seg(sx, sy, sx + 0.01, sy, 34, [PAL.signal[0] * 0.4 * lit, PAL.signal[1] * 0.4 * lit, PAL.signal[2] * 0.4 * lit, 0.34]);
    lines.seg(sx, sy, sx + 0.01, sy, 15, [PAL.ember[0] * 2.5 * lit, PAL.ember[1] * 2.5 * lit, PAL.ember[2] * 2.5 * lit, 0.85]);
    lines.seg(sx, sy, sx + 0.01, sy, 5.5, [5.6 * lit, 4.7 * lit, 3.7 * lit, 1]);
    // 下沉的拖尾
    lines.seg(sx, sy - 70, sx, sy - 12, 2.4, [PAL.signal[0] * 0.8 * lit, PAL.signal[1] * 0.8 * lit, PAL.signal[2] * 0.8 * lit, 0.5]);
    lines.flush(ctx.out);

    // ---- 文字：跟着 2D 世界层（这一段的 3D 是"世界在动"，字应该像贴在世界上）----
    text.clear();
    const a1 = sat(lt / 0.45) * sat((SEG.stack - lt) / 0.5);
    if (a1 > 0.01) {
      type.writeLine('世界在落，摄影机只是在跟随', 960, 176, {
        anchor: 'center', size: 46, weight: 600, family: 'sans',
        color: css(PAL.bone, 0.92 * a1), tracking: 0.2,
      });
      type.writeLine('内部换视角也不会"断" —— 主体始终在画面中心', 960, 236, {
        anchor: 'center', size: 28, weight: 500, family: 'mono',
        color: css(PAL.ash, 0.7 * a1), tracking: 0.16,
      });
    }
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    // 甩镜时色差跟着起来（pdoom 把"运动模糊"和"色差"共用同一个速度量）
    const speed = clamp(Math.abs(fall(t) - fall(t - 3 / 60)) * 6, 0, 1);
    return camPost(t, f.idx, { bloom: 0.34, grain: 0.03, vignette: 0.46, ca: 0.8 + 4 * speed });
  },
};
