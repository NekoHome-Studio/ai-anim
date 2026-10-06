// 验证片 · 第 2 段「图纸」—— **第 1 类 3D**：解析投影 + 线段批。
//
// 这一段演示 pdoom `room.ts` / `leftturn.ts` 那套（也就是它"3D 镜头"里的大多数）：
// 世界是 2D 坐标，但用一台带 **keystone 透视**的摄影机投到屏幕上；
// 几何全是线段，一条 `flush` 一次 draw call；文字用 `setXform` 的**投影变换**跟着一起压。
//
// 与走廊段的接法（硬切，零重叠）：
//   · 摄影机是全片那一台（`camAt(t)`，只吃整片时间）——切点两侧运动方向/滚转连续
//   · 火花的路径连续（`sparkAt(t)`）——眼睛有得跟
//   · 图纸的第一帧就铺在 `HANDOFF.exit` 那个点上（走廊段结尾亮起来的"出口"）
import { css, clamp, lerp, prog, sat, hash2 } from '../../../src/core/util.js';
import { project } from '../../../src/core/cam.js';
import { camAt, camPost, sparkAt, HANDOFF, WORLD, DUR } from './_world.js';

/** 图纸世界的尺寸（世界单位 = 逻辑像素）。图纸就"放在桌上"，靠 keystone 投出来。 */
const SHEET = { x: 380, y: 300, w: 1160, h: 760 };
/** keystone 强度：0.00022 意味着画面下缘（fy ≈ +540）缩到 1/(1+0.119) ≈ 0.89 —— 轻微斜置 */
const K = 0.00022;

/** 图纸上的图元（一次算好，每段只投影） */
function buildSheet(rng) {
  /** @type {any[]} */
  const items = [];
  // 边框 + 四角
  items.push({ kind: 'rect', x: SHEET.x, y: SHEET.y, w: SHEET.w, h: SHEET.h, wgt: 2.4, c: 'bone', a: 0.75 });
  items.push({ kind: 'rect', x: SHEET.x + 18, y: SHEET.y + 18, w: SHEET.w - 36, h: SHEET.h - 36, wgt: 1.0, c: 'graphite', a: 0.5 });
  // 网格
  for (let i = 1; i < 12; i++) {
    const x = SHEET.x + (SHEET.w * i) / 12;
    items.push({ kind: 'line', x0: x, y0: SHEET.y + 18, x1: x, y1: SHEET.y + SHEET.h - 18, wgt: 0.9, c: 'graphite', a: i % 3 === 0 ? 0.34 : 0.16 });
  }
  for (let j = 1; j < 8; j++) {
    const y = SHEET.y + (SHEET.h * j) / 8;
    items.push({ kind: 'line', x0: SHEET.x + 18, y0: y, x1: SHEET.x + SHEET.w - 18, y1: y, wgt: 0.9, c: 'graphite', a: j % 2 === 0 ? 0.30 : 0.14 });
  }
  // 等高线（"地形"）：几条同心的歪椭圆 —— 这是 pdoom leftturn 的核心意象
  for (let r = 0; r < 7; r++) {
    const cx = 1080 + rng() * 60 - 30, cy = 640 + rng() * 40 - 20;
    const rr = 90 + r * 74;
    const pts = [];
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const wob = 1 + 0.13 * Math.sin(a * 3 + r) + 0.07 * Math.sin(a * 7 - r * 2);
      pts.push([cx + Math.cos(a) * rr * wob * 1.35, cy + Math.sin(a) * rr * wob * 0.82]);
    }
    items.push({ kind: 'poly', pts, wgt: r === 3 ? 2.0 : 1.2, c: r === 3 ? 'signal' : 'ash', a: r === 3 ? 0.7 : 0.34 });
  }
  // 路书：一条折线 + 里程碑（"你在这"就是火花的落点）
  const route = [
    [SHEET.x + 70, SHEET.y + 660], [SHEET.x + 260, SHEET.y + 600],
    [SHEET.x + 430, SHEET.y + 648], [SHEET.x + 620, SHEET.y + 520],
    [SHEET.x + 790, SHEET.y + 560], [1180, 900],
  ];
  items.push({ kind: 'poly', pts: route, wgt: 2.6, c: 'bone', a: 0.8, dash: 16 });
  for (let i = 0; i < route.length; i++) {
    items.push({ kind: 'circle', x: route[i][0], y: route[i][1], r: i === route.length - 1 ? 12 : 6, wgt: 2, c: i === route.length - 1 ? 'signal' : 'bone', a: 0.85 });
  }
  // RESULT 立柱：堆栈段要落在这根柱子上（HANDOFF.column）
  items.push({ kind: 'rect', x: HANDOFF.column.x - 46, y: 300, w: 92, h: 520, wgt: 2.2, c: 'bone', a: 0.7 });
  items.push({ kind: 'rect', x: HANDOFF.column.x - 30, y: 316, w: 60, h: 488, wgt: 1.0, c: 'signal', a: 0.45 });
  // 四角裁切标记
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = sx < 0 ? SHEET.x : SHEET.x + SHEET.w;
    const cy = sy < 0 ? SHEET.y : SHEET.y + SHEET.h;
    items.push({ kind: 'line', x0: cx + sx * 44, y0: cy, x1: cx, y1: cy, wgt: 2.4, c: 'bone', a: 0.8 });
    items.push({ kind: 'line', x0: cx, y0: cy, x1: cx, y1: cy + sy * 44, wgt: 2.4, c: 'bone', a: 0.8 });
  }
  return items;
}

export default {
  id: 'map',

  setup(ctx) {
    const { rng } = ctx;
    const r = rng(20261004);
    this.items = buildSheet(() => r());
  },

  render(ctx) {
    const { f, gl, lines, text, type, comp, P } = ctx;
    const t = f.t;
    const W = ctx.W, H = ctx.H;

    // ---- 世界背景：一层很淡的纸面 + 一点点透视网格（不进 setXform，跟着机位走）----
    gl.clear(ctx.out, [P.ink[0] * 0.75, P.ink[1] * 0.75, P.ink[2] * 0.75]);

    const cam = camAt(t);
    // 图纸"从走廊尽头那个出口长出来"：前 0.5 秒做一个极短的建立镜头
    const born = prog(t, WORLD.at.map, WORLD.at.map + 0.55, 'outExpo');
    const camBorn = { ...cam, zoom: cam.zoom * lerp(0.72, 1, born), rot: cam.rot + (1 - born) * -0.05 };

    lines.begin();
    // 世界网格（远层）：跟着机位投影，但用更暗的颜色 —— 这就是"世界不动、摄影机在动"
    const g0 = { x: 0, y: 0, w: 1920, h: 1080 };
    for (let i = 0; i <= 16; i++) {
      const wx = -400 + i * 200;
      const a = project(camBorn, W, H, wx, -400, K);
      const b = project(camBorn, W, H, wx, 1500, K);
      lines.seg(a.x, a.y, b.x, b.y, 1.0, [P.bone[0] * 0.10, P.bone[1] * 0.10, P.bone[2] * 0.10]);
    }
    for (let j = 0; j <= 10; j++) {
      const wy = -400 + j * 200;
      const a = project(camBorn, W, H, -400, wy, K);
      const b = project(camBorn, W, H, 2400, wy, K);
      lines.seg(a.x, a.y, b.x, b.y, 1.0, [P.bone[0] * 0.10, P.bone[1] * 0.10, P.bone[2] * 0.10]);
    }

    // ---- 图纸本体：全部走 project(k) ----
    for (const it of this.items) {
      const col = P[it.c] ?? P.bone;
      const a = (it.a ?? 1) * (0.25 + 0.75 * sat(born * 1.6));
      if (it.kind === 'line') {
        const p0 = project(camBorn, W, H, it.x0, it.y0, K);
        const p1 = project(camBorn, W, H, it.x1, it.y1, K);
        lines.seg(p0.x, p0.y, p1.x, p1.y, it.wgt, [col[0] * a, col[1] * a, col[2] * a]);
      } else if (it.kind === 'rect') {
        const c0 = project(camBorn, W, H, it.x, it.y, K);
        const c1 = project(camBorn, W, H, it.x + it.w, it.y, K);
        const c2 = project(camBorn, W, H, it.x + it.w, it.y + it.h, K);
        const c3 = project(camBorn, W, H, it.x, it.y + it.h, K);
        lines.polyline([[c0.x, c0.y], [c1.x, c1.y], [c2.x, c2.y], [c3.x, c3.y]], it.wgt, [col[0] * a, col[1] * a, col[2] * a], true);
      } else if (it.kind === 'circle') {
        const c = project(camBorn, W, H, it.x, it.y, K);
        const e = project(camBorn, W, H, it.x + 40, it.y, K);
        const rr = Math.hypot(e.x - c.x, e.y - c.y) * (it.r / 40);
        lines.circle(c.x, c.y, rr, it.wgt, [col[0] * a, col[1] * a, col[2] * a], 28);
      } else {
        // polyline：虚线要自己切，因为 lines 没有 dash
        const step = it.dash ? 2 : 1;
        for (let i = step; i < it.pts.length; i += step) {
          const p0 = project(camBorn, W, H, it.pts[i - step][0], it.pts[i - step][1], K);
          const p1 = project(camBorn, W, H, it.pts[i][0], it.pts[i][1], K);
          lines.seg(p0.x, p0.y, p1.x, p1.y, it.wgt, [col[0] * a, col[1] * a, col[2] * a]);
        }
      }
    }

    // ---- 火花（母题）：位置来自全片共享的 sparkAt，只在这里换到屏幕坐标 ----
    const sWorld = sparkAt(t);
    const sPix = project(camBorn, W, H, sWorld.x, sWorld.y, K);
    const flick = 0.86 + 0.14 * Math.sin(t * 91.7) * Math.sin(t * 57.3);
    const lit = sWorld.lit * flick;
    lines.seg(sPix.x, sPix.y, sPix.x + 0.01, sPix.y, 30, [P.signal[0] * 0.42 * lit, P.signal[1] * 0.42 * lit, P.signal[2] * 0.42 * lit, 0.38]);
    lines.seg(sPix.x, sPix.y, sPix.x + 0.01, sPix.y, 13, [P.ember[0] * 2.4 * lit, P.ember[1] * 2.4 * lit, P.ember[2] * 2.4 * lit, 0.85]);
    lines.seg(sPix.x, sPix.y, sPix.x + 0.01, sPix.y, 5, [5.4 * lit, 4.6 * lit, 3.6 * lit, 1]);
    // 它拖出来的那条线（整片的"引线"母题）
    const trail = [];
    for (let k = 12; k >= 0; k--) {
      const tt = Math.max(WORLD.at.map, t - k * 0.055);
      const sw = sparkAt(tt);
      if (sw.lit <= 0.01) continue;
      const pp = project(camBorn, W, H, sw.x, sw.y, K);
      trail.push([pp.x, pp.y]);
    }
    if (trail.length > 1) lines.polyline(trail, 2.2, [P.signal[0] * 0.9, P.signal[1] * 0.9, P.signal[2] * 0.9, 0.5]);
    lines.flush(ctx.out);

    // ---- 文字：整层跟着**同一条透视**压过去（这就是 camXform 存在的理由）----
    text.clear();
    const a1 = sat((t - WORLD.at.map - 0.35) / 0.7) * sat((WORLD.at.stack - t) / 0.5);
    if (a1 > 0.01) {
      type.writeLine('一张图纸就是一个世界', 960, 168, {
        anchor: 'center', size: 58, weight: 700, family: 'sans',
        color: css(P.bone, 0.95 * a1), tracking: 0.16,
      });
      type.writeLine('摄影机只是从它上面甩过去 —— 所以没有"换场景"这回事', 960, 232, {
        anchor: 'center', size: 30, weight: 500, family: 'mono',
        color: css(P.ash, 0.7 * a1), tracking: 0.16,
      });
    }
    // 图上标注：跟着透视走，浅一些
    const a2 = sat((t - WORLD.at.map - 1.2) / 0.8) * sat((WORLD.at.stack - t) / 0.4);
    if (a2 > 0.01) {
      const cols = [
        { s: 'TERRA INCOGNITA', wx: 1080, wy: 402, size: 34 },
        { s: 'ROUTE', wx: 700, wy: 700, size: 28 },
        { s: 'RESULT', wx: HANDOFF.column.x, wy: 276, size: 32 },
      ];
      for (const c of cols) {
        const p = project(camBorn, W, H, c.wx, c.wy, K);
        type.writeLine(c.s, p.x, p.y, {
          anchor: 'center', size: c.size, weight: 600, family: 'mono',
          color: css(c.s === 'RESULT' ? P.signal : P.ash, 0.85 * a2), tracking: 0.22,
        });
      }
    }
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    // 透视已经由 `project(cam, …, K)` 画进几何和文字坐标里了，这里**不再**调 setXform
    // （再来一次就是二次变形）。想演示 `camXform` + `setXform` 的用法见 `loop.js`：
    // 那一段是"整层东西都在世界坐标里画"，所以一次 setXform 就能让文字和几何一起被压。
    return camPost(t, f.idx, { bloom: 0.40, bloomThreshold: 0.92, grain: 0.028, vignette: 0.40 });
  },
};
