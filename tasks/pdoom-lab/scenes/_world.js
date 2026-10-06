// @ts-check
/**
 * 验证片的「世界」——**全片只有一份**。
 *
 * 这份文件是整支片子的脊椎，它存在的理由就是 pdoom-video 那条最重要的发现：
 *
 * > **"看起来像一镜到底"不是靠转场做出来的，是靠"世界不变 + 摄影机不停 + 母题不断"。**
 *
 * pdoom 全片 22 段是**严格分区、零重叠**的（`app/src/timeline.ts` 里相邻段的边界是同一个
 * 变量，`start_{n+1} == end_n`），引擎那条默认交叉溶解分支**从未被执行过**；全项目没有
 * 一个场景设置 `handlesTransition` 或读 `f.under`。它做到连续靠四件事：
 *
 *   ① **全片一台摄影机**，参数只跟整片时间 `f.t` 走 —— 切点两侧镜头的运动方向、滚转、
 *      速度都是连续的，所以切下去像"镜头没停"，不像"换了一段素材"。
 *   ② **一个走完全片的母题**（那颗火花）—— 眼睛有得跟，切了也像没切。
 *   ③ **手工几何交接常量**：把"对象在切点那一刻的屏幕坐标 / 布局"抽成常量，两段都引它。
 *      pdoom 抄了 6 组（`ROOM` / `EYE` / `THREAD` / `CARET` / `HANDOFF` / `ROLL_IN`），
 *      更强的做法是抽成共享模块（`room-shrooms.ts`）。本文件就是这一条。
 *   ④ **画面层的 pre-lap / post-lap**：运动提前起、过后落（`stack` 每拍提前 0.22 拍启动，
 *      `fuse` 的推镜穿过切点还在加速，出段还会主动"停表"把抖动和变焦归零）。
 *
 * 所以本片里 `ctx.under` / `f.tin` / `handlesTransition` **一次都不用**。
 * 这不是偷懒 —— 是刻意的：任何一次交叉溶解都会把上面四条全部作废。
 */

import {
  makeCam, project3, clipSegment, depthScale,
} from '../../../src/core/cam.js';
import { clamp, hash2, lerp, prog, sat } from '../../../src/core/util.js';

/** 全片总时长（秒） */
export const DUR = 32;

/**
 * 每段时间轴。**所有段长都是整数拍**（这里 0.5 秒一拍，所以 7.5s = 15 拍）。
 * pdoom 的 21 个内部切点全部落在整数拍上，规则是
 * `timeOfBeat(floor(beatAt(firstWordStart + 0.02)))` —— 画面**不晚于**词的落点。
 */
export const WORLD = {
  t0: 0,
  beat: 0.5,
  at: { corridor: 0, map: 7.5, stack: 15, columns: 22.5, loop: 27 },
};

/** 每段时长（秒） */
export const SEG = { corridor: 7.5, map: 7.5, stack: 7.5, columns: 4.5, loop: 5 };

/** 这一帧距离本段开始过了多久 / 本段是否还活着 */
export function segT(t, at) { return t - at; }

/* ------------------------------------------------------------------ 交接常量（第 ③ 条） */

/**
 * 切点处必须**两段都同意**的几何。
 *
 * pdoom 把这些常量抄进了每个场景文件（`hook.ts:32-38` 抄了后面三段，注释写
 * "copied, not imported: they are other agents' files"）。本片是共享模块，所以更强：
 * 改一处两侧一起改，**不可能对不上**。
 */
export const HANDOFF = {
  /** 走廊 → 图纸：走廊尽头那个亮起来的"出口"的屏幕位置，图纸从这里长出来 */
  exit: { x: 1284, y: 604 },
  /** 图纸 → 堆栈：图纸上那根 RESULT 立柱的屏幕位置，塔就落在这根柱子上 */
  column: { x: 1180, y: 372 },
  /** 堆栈 → 立柱：塔底在屏幕上的位置 */
  floor: { x: 640, y: 742 },
  /** 收尾回到第一帧时画面的倾角（rad）——出段把 roll 归到它，入段从它起步 */
  roll: 0.018,
};

/* ------------------------------------------------------------------ 母题：那颗火花 */

/**
 * 火花在 **2D 世界**里的路径（世界单位 = 逻辑像素）。
 *
 * 它走完全片：走廊段从上方落下来 → 图纸段滑到"你在这" → 堆栈段顺着塔的中轴往下 →
 * 立柱段横穿 → 收尾回到起点（= 首帧，于是片子成环）。
 * 这就是 pdoom 那条"一个走完全片的母题"：眼睛有得跟，切了也像没切。
 *
 * @param {number} t 整片时间
 * @returns {{ x: number, y: number, lit: number }} lit = 亮度（0 = 未点亮 / 已熄灭）
 */
export function sparkAt(t) {
  const A = WORLD.at, S = SEG, P = MOTIF_PATH;
  if (t <= A.map) return leg(t, A.corridor, S.corridor, P[0], P[1], sat((t - A.corridor) * 1.4));
  if (t <= A.stack) return leg(t, A.map, S.map, P[1], P[2], 1);
  if (t <= A.columns) return leg(t, A.stack, S.stack, P[2], P[3], 1);
  // 收尾：横穿之后回到起点
  const l = leg(t, A.columns, DUR - A.columns, P[3], P[0], 1);
  l.lit = t > A.loop + 1.4 ? sat(1 - (t - A.loop - 1.4) / 1.3) : 1;
  return l;
}

/** 一段直线插值（带缓动）。`e` 是段内进度（不走 `prog` 是为了让 callers 自己控制缓动）。 */
function leg(t, at, dur, a, b, lit) {
  const e = prog(t, at, at + dur * 0.92, 'inOutCubic');
  return { x: lerp(a[0], b[0], e), y: lerp(a[1], b[1], e), lit };
}

/** 火花的整条路径：每个点 = 它在某段结尾**必须**出现的位置。 */
export const MOTIF_PATH = /** @type {[number,number][]} */ ([
  [960, 250],    // 0 走廊段结尾：上方偏中
  [1470, 760],   // 1 图纸段结尾：图纸右下的入口
  [1180, 900],   // 2 堆栈段结尾：塔底中轴
  [640, 470],    // 3 立柱段结尾：柱林中点
]);

/* ------------------------------------------------------------------ 2D 世界摄影机 */

/**
 * 单位机位（写作关键帧的基准）。`makeCam` 的 zoom 会乘上 `zoomBase`，
 * 于是"基准焦距"和"这一段的相对推拉"可以分开调。
 */
const BASE = makeCam([
  // ① 走廊段：贴中轴往前推，四段匀速（匀速本身就是节奏）
  [0.0, { x: 960, y: 540 }, 1.00, HANDOFF.roll],
  [1.9, { x: 985, y: 522 }, 1.06, 0.014, 'linear'],
  [3.8, { x: 1008, y: 502 }, 1.13, 0.022, 'linear'],
  [5.6, { x: 1028, y: 486 }, 1.20, 0.008, 'linear'],
  [7.5, { x: 1052, y: 470 }, 1.30, -0.010, 'outCubic'],   // ← 切点：图纸首帧
  // ② 图纸段：横移读图，然后甩到 RESULT 立柱上并推近
  [9.9, { x: 1150, y: 512 }, 1.26, 0.004, 'linear'],
  [12.6, { x: 1300, y: 592 }, 1.44, 0.014, 'inOutCubic'],
  [14.3, { x: 1216, y: 436 }, 1.95, -0.026, 'outExpo'],   // 甩
  [15.0, { x: 1180, y: 372 }, 2.30, 0.010, 'outCubic'],   // ← 切点：堆栈首帧
  // ③ 堆栈段：世界往下走，摄影机几乎不动（只轻轻往上抬，让塔显得更高）
  [17.6, { x: 1180, y: 352 }, 2.02, 0.016, 'linear'],
  [19.9, { x: 1180, y: 330 }, 1.66, -0.006, 'inOutCubic'],
  [21.5, { x: 820, y: 556 }, 1.28, 0.032, 'outExpo'],     // 甩到地面那根立柱
  [22.5, { x: 700, y: 620 }, 1.12, -0.012, 'outCubic'],   // ← 切点：立柱首帧
  // ④ 立柱段：横摇穿过柱林
  [24.4, { x: 900, y: 542 }, 1.20, 0.020, 'linear'],
  // ⑤ 收尾：减速拉回起点，roll 归到 HANDOFF.roll —— 于是最后一帧 ≈ 第一帧
  [26.6, { x: 932, y: 514 }, 1.10, 0.024, 'inOutCubic'],
  [30.4, { x: 958, y: 532 }, 1.02, HANDOFF.roll, 'inOutCubic'],
  [32.0, { x: 960, y: 540 }, 1.00, HANDOFF.roll, 'outCubic'],
]);

/**
 * 跟拍机位：把火花压在画面的 (0.62, 0.42) 处，越到后段越近。
 * 甩镜期间从 `BASE` 混到它 —— 于是镜头是"追着火花甩过去然后刹住"，
 * 而不是"从 A 平移到 B"（pdoom `leftturn.ts: camAt()` 的做法）。
 */
function followAt(t) {
  const s = sparkAt(t);
  const z = 1.18 + 0.5 * sat((t - WORLD.at.map) / SEG.map);
  return { x: s.x - 0.12 * 1920 / z, y: s.y - (-0.08) * 1080 / z, zoom: z, rot: 0.012 };
}

/** 甩镜强度：每段最后 0.9 秒升到 1，切点前 0.15 秒退回 0（运动穿过切点继续，但不叠到新段）。 */
export function whipAt(t) {
  let w = 0;
  for (const c of [WORLD.at.map, WORLD.at.stack, WORLD.at.columns, WORLD.at.loop]) {
    if (t > c + 0.05) continue;
    w = Math.max(w, clamp((t - (c - 0.95)) / 0.45) * clamp((c - t) / 0.18));
  }
  return sat(w);
}

/**
 * **这一帧的机位**。这是全片唯一的一台 2D 摄影机：只吃整片时间，所以切镜头时它不会断。
 * @param {number} t
 */
export function camAt(t) {
  const w = whipAt(t);
  const b = BASE.at(t);
  if (w <= 0.001) return b;
  const f = followAt(t);
  // 手写 mixCam 的语义（src/core/cam.js 的 `mixCam` 只做两台机位的线性混合；
  // 这里还要加"甩的时候同时推近 + 滚转"，所以单独写，并把 zoom 也走对数）
  const z = Math.exp(lerp(Math.log(b.zoom), Math.log(f.zoom), w));
  return {
    x: lerp(b.x, f.x, w),
    y: lerp(b.y, f.y, w),
    zoom: z * (1 - 0.12 * Math.sin(Math.PI * w)),   // 甩的中途拉远一点 → 模糊条带盖住更多画面
    rot: lerp(b.rot, f.rot, w) + 0.06 * Math.sin(Math.PI * w) * Math.sign(f.x - b.x || 1),
  };
}

/**
 * 2D 段的 post。
 *
 * ⚠ **不要在 post 里重复施加机位** —— 机位已经由 `project()` 画进几何了，
 * post 的 `zoom`/`shake` 是"在最终帧上再叠一层"。这里只叠一点**手持抖动**
 * （按帧号播种，同一帧所有子帧同值，否则运动模糊会把抖动抹成双重曝光）。
 *
 * 甩镜时把色差拉起来：pdoom `room.ts:928` 的 `ca: 0.4 + 0.8 * smear`，
 * 而且**运动模糊和色差共用同一个"速度"量** —— 很省，也很像真的。
 */
export function camPost(t, idx, extra = {}) {
  const w = whipAt(t);
  const amp = 3.4 + 12 * w;
  const shake = [(hash2(idx, 11) - 0.5) * 2 * amp, (hash2(idx, 28) - 0.5) * 2 * amp * 0.55];
  return { ...extra, shake, ca: (extra.ca ?? 0.8) + 5.2 * w };
}

/* ------------------------------------------------------------------ 走廊段的 3D 摄影机 */

/**
 * 走廊段用的 3D 摄影机：位置 + 朝向 + 视场角。它也是"全片一台"的一部分 ——
 * `z` 随整片时间匀速走，段结束时正好到图纸入口的深度，所以硬切下去"镜头没停"。
 */
/* ------------------------------------------------------------------ 走廊世界（两段共用） */

/**
 * 走廊的**世界线段**：`[x0,y0,z0, x1,y1,z1, worldWidth, 颜色名, alpha]`。
 *
 * 抽成共享函数是刻意的：走廊段（第 1 段）和收尾段（第 5 段）用**同一份几何**，
 * 所以"回到第一帧"是真的回到同一个世界。pdoom 的 `outro` 更狠 —— 它把开场场景
 * 整个模块实例化出来倒放（`outro.ts: renderOpen(tau)`），末帧不是"像"首帧，
 * 而是同一个模块、同一个 `tau = 0` 渲出来的同一帧。本引擎的场景是 `t` 的纯函数，
 * 同样能做到；这里用"同一份几何 + 同一台摄影机"达到等价效果。
 *
 * @returns {any[][]}
 */
export function corridorSegments() {
  /** @type {any[][]} */
  const segs = [];
  const S = (a, b, w, c, al) => segs.push([a[0], a[1], a[2], b[0], b[1], b[2], w, c, al]);
  const HW = 2.2, HH = 1.6, ZF = -4, NZ = 16;
  // 地面 / 顶 / 侧墙的长线
  for (const y of [-HH, HH]) for (const x of [-HW, HW]) S([x, y, 6], [x, y, ZF - NZ * 4 - 8], 0.9, 'graphite', 0.5);
  // 每隔 4 个单位一根横肋（速度感的主要来源）
  for (let i = 0; i <= NZ + 2; i++) {
    const z = ZF - i * 4;
    S([-HW, -HH, z], [HW, -HH, z], 1.5, i % 2 === 0 ? 'ash' : 'graphite', i % 2 === 0 ? 0.5 : 0.32);
    S([-HW, HH, z], [HW, HH, z], 1.2, 'graphite', 0.3);
  }
  // 门框 + 角标 + 侧墙刻度
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
      for (let tt = -3; tt <= 3; tt++) S([sx, tt * 0.42 - 0.08, z], [sx, tt * 0.42 + 0.08, z], 1.2, 'ash', 0.4);
    }
  }
  // 中轴上的刻度环（火花沿着它走）
  for (let i = 0; i <= NZ; i++) {
    const z = ZF - i * 4 + 2;
    const r = 0.34, N = 16;
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
      S([Math.cos(a0) * r, 0.2 + Math.sin(a0) * r, z], [Math.cos(a1) * r, 0.2 + Math.sin(a1) * r, z], 1.4, 'signal', 0.55);
    }
  }
  return segs;
}

/**
 * 走廊的**3D 相机参数**（位置/朝向/视场角），交给 `camera3()` 转成基向量。
 * 它也是"全片一台"的一部分：7.5 秒沿 z 走 6 个单位（约每 1.2 秒过一个门框）。
 * @param {number} t
 */
export function corridorCam3(t) {
  const u = sat(t / SEG.corridor);
  const x = 0.28 * Math.sin(t * 0.55 + 0.7);
  const y = 0.10 * Math.sin(t * 0.9) + 0.05 * Math.sin(t * 2.1 + 1.1);
  const z = -2.0 - t * 0.8;
  return {
    pos: [x, y, z],
    target: [x + 0.03, y - 0.02, z - 1],
    // 末段把滚转收敛到切点要用的值（出段主动"让帧"）
    roll: lerp(0.028 - 0.045 * Math.sin(t * 0.31), HANDOFF.roll, prog(t, SEG.corridor - 0.9, SEG.corridor, 'inOutCubic')),
    fov: 50,
  };
}

export const CORRIDOR = {
  dur: SEG.corridor,
  cam2: corridorCam3,
  /** 走廊里的火花：在中轴上前移，过了 40% 才点亮（它是被"点出来"的）。 */
  sparkAt(t) {
    const u = sat(t / SEG.corridor);
    return [0.02 * Math.sin(t * 1.7), 0.20 + 0.04 * Math.sin(t * 2.1), -6.0 - u * 5.0, sat((u - 0.4) * 2.8)];
  },
};

/** 由位置 + 偏航/俯仰/滚转 + 竖直视场角算基向量（`cam.js` 的 `basis()` 吃这个形状）。 */
export function camBasis(p, yaw, pitch, roll, fovDeg) {
  const cp = Math.cos(pitch);
  const dir = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  return {
    pos: [p.x, p.y, p.z],
    target: [p.x + dir[0], p.y + dir[1], p.z + dir[2]],
    roll,
    fov: fovDeg,
  };
}

/* ------------------------------------------------------------------ 3D 线段批的小工具 */

/**
 * 「第 1 类 3D」的主循环：把世界里的线段投到屏幕上再交给 `lines`。
 * 三条必备动作，缺一条就会在镜头穿过物体时穿帮：
 *   ① 近平面裁剪（两端都在镜头后 → 整条丢掉）
 *   ② 视口外剔除（投影出来在画面外很远就别画了）
 *   ③ 线宽按深度衰减 + 下限（不然远处细线会消失、近处会糊成一片）
 *
 * @param {any} cam3 `cam.js` 的 `camera3()` 结果
 * @param {any} lines LineBatch
 * @param {number} W @param {number} H
 * @param {number[][]} segs 每条是 `[x0,y0,z0, x1,y1,z1, worldWidth, r, g, b, alpha]`
 * @param {{ near?: number, cull?: number, minW?: number, maxW?: number, widthScale?: number }} [opts]
 * @returns {number} 真正画出来的条数
 */
export function draw3D(cam3, lines, W, H, segs, opts = {}) {
  const near = opts.near ?? 0.06;
  const cull = opts.cull ?? 420;
  const minW = opts.minW ?? 0.9;
  const maxW = opts.maxW ?? 16;
  const ws = opts.widthScale ?? 1;
  let n = 0;
  for (const s of segs) {
    const a = project3(cam3, W, H, s[0], s[1], s[2]);
    const b = project3(cam3, W, H, s[3], s[4], s[5]);
    if (!clipSegment(a, b, near)) continue;
    if ((a.x < -cull && b.x < -cull) || (a.x > W + cull && b.x > W + cull)) continue;
    if ((a.y < -cull && b.y < -cull) || (a.y > H + cull && b.y > H + cull)) continue;
    const w = clamp((s[6] ?? 1) * ws * depthScale(cam3, (a.w + b.w) * 0.5, H), minW, maxW);
    lines.seg(a.x, a.y, b.x, b.y, w, [s[7] ?? 1, s[8] ?? 1, s[9] ?? 1, s[10] ?? 1]);
    n++;
  }
  return n;
}

/**
 * 3D 空间里的一行字：**近大远小**。
 *
 * 文字没有真 3D（它是 Canvas2D 图层），所以"远处的字小一点"只能靠缩放。
 * 做法是投两个点量出这个深度上的"每世界单位多少像素"，再乘字号。
 * pdoom 的 `stack.ts` 用的是真 `TextGeometry` 放在 3D 场景里（有深度测试）；
 * 本引擎没有那一层，用这个替代 —— 对"字在画面里当排版元素"的场景完全够用。
 *
 * @returns {{ x: number, y: number, scale: number, depth: number }}
 */
export function text3D(cam3, W, H, wx, wy, wz) {
  const p = project3(cam3, W, H, wx, wy, wz);
  return { x: p.x, y: p.y, scale: depthScale(cam3, p.w, H), depth: p.w };
}
