// @ts-check
/**
 * promo 的脊椎 —— **全片一个世界、一台摄影机、一个母题**。
 *
 * 这支片子是「一镜到底」：时间线上是 6 段，但**没有任何一次剪辑**（零 overlap、零转场），
 * 连续性完全靠这一份文件（和 `tasks/pdoom-lab/scenes/_world.js` 同一套手法，见
 * `docs/STATUS.md` §13.1 —— pdoom 的 22 段也是这样，它那条交叉溶解分支从未被执行过）：
 *
 *   ① **一台摄影机**：`camAt(t)` 只吃整片时间 `t`。六段读的是同一个函数，
 *      所以切点两侧的位置、朝向、滚转、速度都是连续的 —— 镜头从来没停过。
 *   ② **一个世界**：世界坐标只有一份（`LANDMARK`）。摄影机沿 `-z` 一路前进，
 *      "换场景"= 走到了世界的另一段，而不是换了一个世界。
 *   ③ **一个母题**：`motifAt(t)` 那支光标/火花。段 1 是编辑器里那根竖线，
 *      段 2 起是镜头前面那颗拖着尾迹的光点，段 5 是扫描线，段 6 落回落版。
 *   ④ **手工交接常量**：`LANDMARK.door` 那道门两个渲染世界都画它 —— 硬接缝上
 *      两边认的是同一组数字，不可能对不上。
 *
 * 右手系：`+x` 向右、`+y` 向上、`-z` 是前方（`src/core/cam.js` 的约定）。
 */

import { camera3, project3, clipSegment, depthScale } from '../../../src/core/cam.js';
import { clamp, hit, keys, lerp, prog, sat, hash2, noise1 } from '../../../src/core/util.js';

export const DUR = 48;

/** 六段的时间轴（秒）。所有边界都落在 120bpm 的拍上（一拍 = 0.5s）。 */
export const SEG = {
  caret: { at: 0, dur: 6 },
  code: { at: 6, dur: 10 },
  engine: { at: 16, dur: 10 },
  lattice: { at: 26, dur: 10 },
  frames: { at: 36, dur: 6 },
  title: { at: 42, dur: 6 },
};

/**
 * 世界的地标（沿 -z 的一根轴）。`z` 越小越远。
 * 这些数字是**六段共用**的：改一处，六段一起改。
 */
export const LANDMARK = {
  /** 开场那行字（段 1 打出来的那句）所在的位置 */
  firstLine: -4.0,
  /** 门：走廊尽头那道发光的方框（两个世界都画它） */
  door: -21.0,
  /** 大厅：SDF 柱廊（段 3 全程 + 段 4 开头） */
  hall: { from: -22, to: -46 },
  /** 晶格隧道（段 4 的主体） */
  tunnel: { from: -46, to: -104 },
  /** 帧墙 */
  frames: { from: -104, to: -120 },
  /** 末端那面墙（落版）—— 摄影机停在它前面 4 个单位 */
  wall: -132.2,
  /** 走廊里每行代码的间距 */
  rowGap: 0.86,
};

/* ------------------------------------------------------------------ 摄影机 */

/**
 * 摄影机的**速度剖面**（世界单位 / 秒）。位置 = 这条曲线的积分 —— 不写位置关键帧。
 *
 * 为什么改写成积分：第一版用 `keys(t, [[t, z, ease], …])` 直接插位置，结果每个内部关键点
 * 都被"缓动"掐了一次 —— `outQuad` 收尾的导数是 0、`inOutQuad` 起步的导数也是 0，
 * 于是**每次切镜头摄影机都几乎停下来**（实测 26s 处两侧速度比 4.8×、36s 处 153×）。
 * 硬切点上"停一下"正是"一镜到底"最怕的东西：画面上就是顿一下。
 * 改成"速度连续 + 位置是它的积分"之后，位置与速度**双双连续**，切点只剩编排上的重音。
 *
 * 边界位置（由积分得到，`out/_probe/continuity.mjs` 会验）：
 *   t=6 → z≈−1.2（那行字还在前面）· t=16 → −22.7（刚穿过门）· t=26 → −46.7（隧道口）
 *   t=36 → −103（隧道尽头）· t=42 → −121（帧墙尽头）· t=48 → −127.5（停在墙前 4.5 个单位）
 */
const V_KEYS = [
  [0.0, 0.00],
  [1.2, 0.50],    // 开场：从静止慢慢推起来
  [6.0, 0.18],    // 段 1 结束：几乎停住（在看那行字）
  [7.8, 3.20],    // 段 2 开头：一记爆冲，穿过那行字
  [13.5, 1.50],   // 走廊中段
  [16.0, 2.60],   // 穿门（15.95s 那记亮）
  [21.0, 2.20],   // 大厅：收一点速，让体量读出来
  [26.0, 2.60],   // 隧道口 —— 从这里开始俯冲
  [31.0, 8.00],   // 全片最快
  [36.0, 4.20],   // 隧道尽头
  [38.5, 2.40],   // 帧墙：减速
  [42.0, 2.60],
  [45.0, 1.00],   // 落版：刹住
  [48.0, 0.00],
];

/** 这一帧的速度（分段线性）。 */
export function speedAt(t) {
  if (t <= V_KEYS[0][0]) return V_KEYS[0][1];
  const n = V_KEYS.length;
  if (t >= V_KEYS[n - 1][0]) return V_KEYS[n - 1][1];
  for (let i = 1; i < n; i++) {
    if (t <= V_KEYS[i][0]) {
      const [t0, v0] = V_KEYS[i - 1], [t1, v1] = V_KEYS[i];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return 0;
}

/** 摄影机的 z = −∫₀ᵗ v（分段线性速度的积分是分段二次，逐段累加即可，精确且与顺序无关）。 */
export function zAt(t) {
  let s = 0;
  let prevT = V_KEYS[0][0], prevV = V_KEYS[0][1];
  const n = V_KEYS.length;
  for (let i = 1; i < n; i++) {
    const [ti, vi] = V_KEYS[i];
    const tc = Math.min(t, ti);
    if (tc > prevT) {
      const vc = lerp(prevV, vi, (tc - prevT) / (ti - prevT));
      s += (prevV + vc) / 2 * (tc - prevT);
    }
    if (t <= ti) return -s;
    prevT = ti; prevV = vi;
  }
  return -s;
}

/** 摄影机的滚转：小幅度、双频叠加（避免看出周期），段 4 里明显加大。 */
function rollAt(t) {
  const dive = prog(t, SEG.lattice.at, SEG.lattice.at + SEG.lattice.dur, 'inOutCubic');
  const calm = prog(t, SEG.title.at, SEG.title.at + 2.4, 'outCubic');
  return (0.012 * Math.sin(t * 0.21) + 0.006 * Math.sin(t * 0.53 + 1.1)) * (1 + 3.2 * dive) * (1 - calm);
}

/**
 * **全片唯一的一台摄影机**（只吃整片时间）。
 * @param {number} t 整片时间
 */
export function camAt(t) {
  const z = zAt(t);
  // 一点点漂移：机器感里带一点手持，切点两侧也连续
  const x = 0.30 * Math.sin(t * 0.23 + 0.6) + 0.12 * Math.sin(t * 0.62 + 2.1);
  const y = 0.10 * Math.sin(t * 0.31) + 0.05 * Math.sin(t * 0.79 + 1.3);
  // 看向哪里：正前方 + 极小的偏航/俯仰，让"往前飞"不是一条死板的直线
  const yaw = 0.030 * Math.sin(t * 0.17 + 0.4);
  const pitch = 0.022 * Math.sin(t * 0.19 + 2.0) + 0.02 * Math.sin(t * 0.5);
  const fwd = [Math.sin(yaw), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  return {
    pos: [x, y, z],
    target: [x + fwd[0], y + fwd[1], z + fwd[2]],
    roll: rollAt(t),
    fov: 52,
  };
}

/** 这一帧的 3D 相机基（`project3` / raymarch 都用它）—— 六段共用同一台。 */
export function cam3At(t, H = 1080) {
  const c = camAt(t);
  return camera3({ pos: c.pos, target: c.target, fov: c.fov, roll: c.roll, H });
}

/* ------------------------------------------------------------------ 母题：那支光标 */

/**
 * 母题在世界里的位置（`f.t` 的纯函数）。它走完全片：
 * 段 1 是那行字末尾的插入符；段 2 起飞到镜头前面当引路的光点；
 * 段 4 拖出最长的尾迹；段 5 变成帧墙上的扫描线；段 6 停回落版最后一个字后面。
 *
 * @param {number} t
 * @returns {{ p: [number, number, number], lit: number, trail: number }}
 */
export function motifAt(t) {
  const camZ = zAt(t);
  if (t < SEG.code.at) {
    // 段 1：打字机末尾那根竖线 →（最后 0.9 秒）起飞、变成镜头前面那颗光点。
    // 这一段的"起飞"就是母题的交接：同一个东西，位置连续。
    const typed = clamp((t - TYPE_AT) / TYPE_SPAN) * FIRST_LINE.length;
    const x0 = LINE_X0 + typed * CHAR_H * CHAR_ADV;
    const k = prog(t, SEG.code.at - 0.9, SEG.code.at, 'inQuad');
    const lead = 3.4;
    const x1 = 0.42 * Math.sin(SEG.code.at * 0.44 + 0.3);
    const y1 = 0.16 + 0.18 * Math.sin(SEG.code.at * 0.37 + 1.0);
    const zc = zAt(SEG.code.at) - lead;
    return {
      p: [lerp(x0, x1, k), lerp(-0.02, y1, k), lerp(LANDMARK.firstLine, zc, k)],
      lit: k > 0 ? 1 : blink(t),
      trail: 0,
    };
  }
  if (t < SEG.frames.at) {
    // 段 2-4：飞在镜头前面一段距离（世界在动，它领着镜头走）
    const lead = lerp(3.4, 6.2, prog(t, SEG.code.at, SEG.lattice.at + SEG.lattice.dur));
    const z = camZ - lead;
    const x = 0.42 * Math.sin(t * 0.44 + 0.3);
    const y = 0.16 + 0.18 * Math.sin(t * 0.37 + 1.0);
    const trail = prog(t, SEG.lattice.at - 1.5, SEG.lattice.at + 2.5, 'inOutCubic');
    return { p: [x, y, z], lit: 1, trail };
  }
  if (t < SEG.title.at) {
    // 段 5：它就是那道扫描线。
    // ⚠ 起点必须**接上段 4 收尾时光点的位置**（x/y/z 三个分量都要接）——
    //   第一版这里从 `x=−7` 起步，于是 36.0s 那一帧母题瞬移了 7 个单位（探针量的）。
    const k = prog(t, SEG.frames.at, SEG.frames.at + SEG.frames.dur, 'inOutCubic');
    const xIn = 0.42 * Math.sin(SEG.frames.at * 0.44 + 0.3);
    const yIn = 0.16 + 0.18 * Math.sin(SEG.frames.at * 0.37 + 1.0);
    const x = k < 0.22 ? lerp(xIn, -7.8, k / 0.22) : lerp(-7.8, 7.8, (k - 0.22) / 0.78);
    const y = lerp(yIn, 0.05, Math.min(1, k * 3.2));
    const z = camZ - lerp(6.2, 5.0, k);
    return { p: [x, y, z], lit: 1, trail: 0.4 };
  }
  // 段 6：从扫描线的终点飞向落版那一行的末尾，然后熄灭（变成文字层里那根光标）
  const u = prog(t, SEG.title.at, SEG.title.at + 3.2, 'outCubic');
  return {
    p: [lerp(7.8, 2.05, u), lerp(0.05, -0.30, u), lerp(camZ - 5.0, LANDMARK.wall + 0.45, u)],
    lit: 1,
    trail: 0,
  };
}

/** 光标的呼吸（段 1 与段 6 用：安静的地方它才闪）。 */
export function blink(t, period = 1.0) {
  return (t % period) < period * 0.62 ? 1 : 0.12;
}

/* ------------------------------------------------------------------ 3D 线段批 */

/**
 * 「第 1 类 3D」的主循环：世界线段 → 屏幕 → `lines`。
 * 三条必备动作（缺一条，镜头穿过物体时就会穿帮）：近平面裁剪 / 视口外剔除 / 线宽按深度衰减。
 *
 * @param {any} cam3 @param {any} lines
 * @param {number} W @param {number} H
 * @param {any[][]} segs 每条 `[x0,y0,z0, x1,y1,z1, worldWidth, r, g, b, alpha]`
 */
export function draw3D(cam3, lines, W, H, segs, opts = {}) {
  const near = opts.near ?? 0.05;
  const cull = opts.cull ?? 500;
  const minW = opts.minW ?? 0.8;
  const maxW = opts.maxW ?? 22;
  const ws = opts.widthScale ?? 1;
  // 全片一套雾：世界只有一份，"远处淡下去"的口径也只有一套
  const fogNear = opts.fogNear ?? 16;
  const fogFar = opts.fogFar ?? 58;
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const a = project3(cam3, W, H, s[0], s[1], s[2]);
    if (a.w < near) continue;                       // 起点在镜头后：这一条基本已经飞过去了
    const b = project3(cam3, W, H, s[3], s[4], s[5]);
    if (!clipSegment(a, b, near)) continue;
    if ((a.x < -cull && b.x < -cull) || (a.x > W + cull && b.x > W + cull)) continue;
    if ((a.y < -cull && b.y < -cull) || (a.y > H + cull && b.y > H + cull)) continue;
    const depth = (a.w + b.w) * 0.5;
    const fog = sat(1 - (depth - fogNear) / Math.max(1e-3, fogFar - fogNear));
    const al = (s[10] ?? 1) * fog;
    if (al <= 0.002) continue;
    const w = clamp((s[6] ?? 1) * ws * depthScale(cam3, depth, H), minW, maxW);
    lines.seg(a.x, a.y, b.x, b.y, w, [s[7] ?? 1, s[8] ?? 1, s[9] ?? 1, al]);
    n++;
  }
  return n;
}

/**
 * 空气里的浮尘：世界只有一份，所以"有空气"这件事也得全片一致。
 * 每颗尘埃是一个极短的线段（`lines` 画的是一根胶囊，点太小会闪），按 `f.idx` 播种只在
 * 段与段之间保持静止 —— 它们随着镜头前进向后掠过，是速度的第三层读数（另两层：门框、地板刻度）。
 */
export function dustSegs(camZ, t, P, n = 90) {
  /** @type {any[][]} */
  const out = [];
  const span = 46;
  for (let i = 0; i < n; i++) {
    const s1 = hash2(i, 3), s2 = hash2(i, 91), s3 = hash2(i, 517), s4 = hash2(i, 2311);
    // 沿 z 均匀铺开、随时间向 +z 流动（镜头在前进，尘埃相对后退）
    const z = LANDMARK.firstLine - (((s1 * span) + t * 0.35 * (0.6 + s4)) % span);
    if (z > camZ - 0.4) continue;
    const x = (s2 - 0.5) * 6.4;
    const y = (s3 - 0.5) * 4.2;
    const len = 0.012 + 0.03 * s4;
    const a = 0.10 + 0.22 * s4;
    const c = s4 > 0.86 ? P.signal : P.ash;
    out.push([x, y, z, x, y, z - len, 1.1, c[0], c[1], c[2], a]);
  }
  return out;
}

/** 踩在拍上的"扫描环"：从镜头前面往远处推的一道横光，段 2 的节奏读数。 */
export function scanSegs(camZ, t, P, o = {}) {
  const period = o.period ?? 1.0;
  const ph = ((t % period) + period) % period / period;      // 0 → 1
  const z0 = camZ - 1.6 - ph * (o.span ?? 26);
  const a = (1 - ph) ** 1.4 * (o.amp ?? 0.5);
  if (a < 0.01) return [];
  const hw = 2.5, hh = 1.7;
  const c = P.signal;
  return [
    [-hw, -hh, z0, hw, -hh, z0, 2.0, c[0] * 1.3, c[1] * 1.3, c[2] * 1.3, a],
    [hw, -hh, z0, hw, hh, z0, 1.4, c[0], c[1], c[2], a * 0.55],
    [-hw, hh, z0, hw, hh, z0, 1.4, c[0], c[1], c[2], a * 0.55],
    [-hw, hh, z0, -hw, -hh, z0, 1.4, c[0], c[1], c[2], a * 0.55],
  ];
}

/** 世界点 → 屏幕（给文字用）：位置、每世界单位的像素、深度。 */
export function at3(cam3, W, H, x, y, z) {
  const p = project3(cam3, W, H, x, y, z);
  return { x: p.x, y: p.y, w: p.w, s: depthScale(cam3, p.w, H) };
}

/* ------------------------------------------------------------------ 3D 里的文字 */

/**
 * 在 3D 空间里写**一行**字。
 *
 * 为什么可以只投一个点：一行字上所有字素的 z 相同（这一行垂直于视轴），
 * 而 `project3` 的屏幕 x 对同一深度是**线性**的 —— 所以整行按同一个缩放画就精确成立。
 * 代价是每个字素没有单独的透视变形（同一行上没有keystone，所以看不出来）。
 *
 * 镜头很靠近时（`w` 很小）整行会爆掉，所以按世界单位给一个字高上限。
 *
 * @returns {boolean} 这一行是否画出来了
 */
export function textRow3D(ctx, cam3, str, wx, wy, wz, o = {}) {
  const { type, text, W, H } = ctx;
  const p = project3(cam3, W, H, wx, wy, wz);
  if (p.w < 0.22 || p.w > (o.maxDepth ?? 90)) return false;
  const px = (o.h ?? 0.30) * depthScale(cam3, p.w, H) * H;   // 字高（像素）
  if (px < 5 || px > 900) return false;
  const tracking = (o.tracking ?? 0.08) * px;
  const c = text.ctx;
  c.save();
  // 滚转：整行跟着相机一起歪（否则世界里在倾，字是正的，一眼假）
  if (o.roll) {
    c.translate(p.x, p.y);
    c.rotate(o.roll);
    c.translate(-p.x, -p.y);
  }
  type.write(str, p.x, p.y, {
    size: px,
    weight: o.weight ?? 400,
    family: o.family ?? 'mono',
    tracking,
    baseline: 'middle',
    color: o.color,
    alpha: o.alpha ?? 1,
    stagger: o.stagger ?? 0,
    t: o.t ?? 0,
    from: o.from ?? 'none',
    dist: o.dist ?? 40,
  });
  c.restore();
  return true;
}

/* ------------------------------------------------------------------ 代码走廊（段 1-2） */

/**
 * 段 1 打出来的那一行（也是一切开始的地方）。
 * ⚠ 必须是**仓库里真实存在的一行代码**（FACTS.md 守这条）：这一行逐字来自
 * `src/core/engine.js:375`。第一版我写的是 `const frame = render(t)`，
 * 那一行在仓库里根本不存在 —— 一支讲"代码就是画面"的片子，屏幕上不该出现假代码。
 */
export const FIRST_LINE = 'const ov = scene.render(ctx);';

/** 段 1 那行字所在的位置（镜头从 z=0 出发，一路向 -z） */
export const LANDMARK_FIRST_LINE = -4.0;

/* 段 1 那行字的排版常量 —— 母题（光标）与场景都用它，所以只有一份。
 * ⚠ 尺寸是被"装得下"倒推出来的：29 个等宽字符 ≈ 17.4 个字高宽，
 *   镜头最近时（w≈2.4）要落在 1920 之内 ⇒ 字高 ≈ 0.20 世界单位。
 *   第一版写 0.27，结果整行左右都被裁掉。 */
export const LINE_X0 = -2.62;      // 行首的世界 x
export const CHAR_H = 0.20;        // 字高（世界单位）
export const CHAR_ADV = 0.655;     // 等宽字步进 / 字高
export const TYPE_AT = 1.0;        // 几点开始打字（秒）
export const TYPE_SPAN = 2.6;      // 打完整行要多久

/** 打字的进度（0..1）。 */
export function typeProgress(t) {
  return clamp((t - TYPE_AT) / TYPE_SPAN);
}

/** 段 1 / 段 6 共用：左下角那个 `t = 12.345` 读数（它是全片的 HUD，也是"时间"这件事的读数）。 */
export function timecodeHud(ctx, f, o = {}) {
  const { type, W, H, P } = ctx;
  const txt = `t = ${f.t.toFixed(3)}`;
  type.write(txt, o.x ?? 54, (o.y ?? H - 54), {
    size: o.size ?? 26, family: 'mono', baseline: 'alphabetic',
    tracking: 1.2, color: P.css(o.color ?? 'ash', o.alpha ?? 0.42),
  });
  if (o.label) {
    type.write(o.label, o.x ?? 54, (o.y ?? H - 54) - 34, {
      size: (o.size ?? 26) - 4, family: 'mono', baseline: 'alphabetic',
      tracking: 3, color: P.css('graphite', 0.75),
    });
  }
  return txt;
}

/** 走廊里飘过的"代码行"——都是这套引擎真实存在的写法。 */
export const CODE_LINES = [
  'const ov = scene.render(ctx);',
  'export function render(ctx) {',
  '  const { f, gl, P, lines, text } = ctx',
  '  gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]])',
  '  lines.seg(ax, ay, bx, by, w, color)',
  '  const hit = march(ro, rd, mat, 96, 44.0)',
  '  vec3 n = marchNormal(p, 0.0018)',
  '  float ink = engrave3(p, n, dark, 36.0, 1.15)',
  '  const a = project3(cam3, W, H, x, y, z)',
  '  if (!clipSegment(a, b, 0.06)) continue',
  '  const w = depthScale(cam3, a.w, H) * 3',
  '  type.writeLine(text, x, y, { anchor: "center" })',
  '  text.upload(); comp.draw(gl, text, ctx.out)',
  '  return { bloom: 0.34, grain: 0.02, ca: 0.6 }',
  '  const k = sat((t - at) / dur)   // 纯函数',
  '  for (const tt of smearTimes(CAM, t, dt)) {',
  '  const cam = camera3({ pos, target, fov: 52 })',
  '  const z = keys(t, [[0, 0], [6, -1.6], [16, -22]])',
  '  music.beatAt(t); f.beat; f.beatPhase',
  '  const s = spring(t - t0, 1, 90, 18)',
  '  rng(seed)  // 不用 Math.random',
  '  const shape = [0.18, 0.34, 0.52, 0.71, 0.88, 1.0]',
  '  return { x, y, zoom, rot }',
  '}  // 每一帧都是时间的纯函数',
];

/**
 * 「编辑器三维化」：走廊的几何。
 *
 * ⚠ 第一版这里是"每一行代码 = 一层，整行浮在中轴上"——**看起来是糊的**：
 *   一行行都躺在视轴上，投影到屏幕上全挤在消失点那一条线上（`y=0` 的行永远落在
 *   `H/2` 附近），二十行字叠成一团。改成这个结构才对：
 *     · **墙面是沿 z 的短划线**（一条条向消失点收敛的长条纹）——它给速度和"这里面有字"；
 *     · **可读的代码只出现在门楣上**（每 8 行一道门，字写在门框上沿）——它给内容；
 *     · 中轴留空 —— 那是母题（光点）飞过去的地方，也是镜头看的地方。
 *
 * 只在摄影机附近生成（±视野），所以走廊是**无限长**的。
 */
export function codeSegs(camZ, t, P, o = {}) {
  const gap = LANDMARK.rowGap;
  const zFar = camZ - (o.depth ?? 52);
  const zNear = camZ - 0.6;
  /** @type {any[][]} */
  const segs = [];
  const S = (a, b, w, col, al) => segs.push([a[0], a[1], a[2], b[0], b[1], b[2], w, col[0], col[1], col[2], al]);
  const HW = 2.85, HH = 2.05;
  const rowAt = Math.ceil((LANDMARK.firstLine - zNear) / gap);      // 从镜头前面那一行开始
  const rowEnd = Math.floor((LANDMARK.firstLine - zFar) / gap);
  const dim = o.dim ?? 1;

  // 隧道的四条长边
  for (const [sx, sy] of [[-HW, -HH], [HW, -HH], [HW, HH], [-HW, HH]]) {
    S([sx, sy, zNear], [sx, sy, zFar], 0.75, P.graphite, 0.5 * dim);
  }
  // 地板 / 天花板上的**纵向线**：它们向消失点收敛，是"隧道"最强的一笔
  for (const x of [-HW, -1.9, -0.95, 0, 0.95, 1.9, HW]) {
    S([x, -HH, zNear], [x, -HH, zFar], x === 0 ? 0.9 : 0.6, x === 0 ? P.ash : P.graphite, (x === 0 ? 0.4 : 0.28) * dim);
  }
  for (const x of [-1.9, 0, 1.9]) {
    S([x, HH, zNear], [x, HH, zFar], 0.6, P.graphite, 0.22 * dim);
  }

  // 墙面上的"代码行"：沿 z 的短划线（速度感的第一来源）
  const WALL_ROWS = 13;
  for (const sx of [-HW, HW]) {
    for (let j = 0; j < WALL_ROWS; j++) {
      const y = -HH * 0.86 + (j / (WALL_ROWS - 1)) * HH * 1.72;
      for (let k = rowAt; k <= rowEnd; k += 1) {
        const z = LANDMARK.firstLine - k * gap;
        const seed = hash2(k * 7 + j * 131 + (sx > 0 ? 5 : 0), 17);
        const len = (0.30 + 0.62 * seed) * gap * 2;
        const hot = seed > 0.94;
        const col = hot ? P.signal : (seed > 0.74 ? P.ash : P.graphite);
        const a = (hot ? 0.62 : 0.34 + 0.22 * seed) * dim;
        S([sx, y, z], [sx, y, z - len], hot ? 1.7 : 1.15, col, a);
      }
    }
  }

  // 地板与天花板：横向的"行线"（读数：每 4 行一根）
  for (const sy of [-HH, HH]) {
    for (let k = rowAt; k <= rowEnd; k += 4) {
      const z = LANDMARK.firstLine - k * gap;
      S([-HW, sy, z], [HW, sy, z], 1.0, P.graphite, 0.22 * dim);
    }
  }
  // 地板上每行的短刻度（走得快时全靠它读速度）
  for (let k = rowAt; k <= rowEnd; k++) {
    const z = LANDMARK.firstLine - k * gap;
    const seed = hash2(k, 29);
    S([-0.34 - 0.5 * seed, -HH + 0.01, z], [0.34 + 0.5 * seed, -HH + 0.01, z], 1.2, P.ash, 0.3 * dim);
  }

  // 每 8 行一道门框：这是"拍"的读数，也是走廊的骨架
  for (let k = rowAt - (((rowAt % 8) + 8) % 8); k <= rowEnd; k += 8) {
    if (k < 0) continue;
    const z = LANDMARK.firstLine - k * gap;
    const beatLit = 0.5 + 0.5 * Math.exp(-(((t * 2) % 1)));
    const corners = [[-2.35, -1.5], [2.35, -1.5], [2.35, 1.5], [-2.35, 1.5]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      S([a[0], a[1], z], [b[0], b[1], z], 2.0, P.bone, (0.42 + 0.3 * beatLit) * dim);
    }
    // 四个角标
    for (const [cx, cy] of corners) {
      S([cx - 0.16, cy, z], [cx + 0.16, cy, z], 2.6, P.signal, 0.7 * dim);
      S([cx, cy - 0.16, z], [cx, cy + 0.16, z], 2.6, P.signal, 0.7 * dim);
    }
  }
  return { segs, rowAt, rowEnd };
}

/** 某一行的代码文本（确定性，行号变了内容就变）。 */
export function codeLineAt(k) {
  if (k === 0) return FIRST_LINE;
  return CODE_LINES[((k % CODE_LINES.length) + CODE_LINES.length) % CODE_LINES.length];
}

/**
 * 走廊里**可读的那几行字**：段 1 打出来的英雄行 + 每 8 行一道的门楣。
 * （不这么挑的后果见 `codeSegs` 的注释：所有行都浮在中轴上就是一团糊。）
 *
 * @returns {number} 画了几行
 */
export function codeGateText(ctx, cam3, camZ, o = {}) {
  const { W, H, P } = ctx;
  const gap = LANDMARK.rowGap;
  const maxW = o.textDepth ?? 26;
  const rows = Math.max(0, Math.ceil((LANDMARK.firstLine - camZ + maxW) / gap));
  let n = 0;
  for (let k = 0; k < rows; k++) {
    if (k !== 0 && k % 8 !== 0) continue;                 // 只有英雄行与门楣
    const z = LANDMARK.firstLine - k * gap;
    if (z > camZ - 0.35) continue;
    const w = camZ - z;
    const hero = k === 0;
    const y = hero ? 0 : 1.28;                            // 门楣上沿
    const px = (hero ? (o.heroH ?? 0.19) : (o.gateH ?? 0.115)) * depthScale(cam3, w, H) * H;
    if (px < 4 || px > 420) continue;
    const p0 = project3(cam3, W, H, hero ? LINE_X0 : -2.2, y, z);
    const c = ctx.text.ctx;
    c.save();
    if (o.roll) { c.translate(W / 2, H / 2); c.rotate(o.roll); c.translate(-W / 2, -H / 2); }
    const line = codeLineAt(k);
    const a = clamp(1 - w / (maxW + 10)) ** 0.8;
    ctx.type.write(line, p0.x, p0.y, {
      size: px, family: 'mono', baseline: 'middle', tracking: px * 0.05,
      color: P.css(hero ? 'bone' : 'ash', clamp(a * (hero ? 1 : 0.8))),
    });
    if (!hero) {
      // 门楣左端一个行号
      ctx.type.write(`${(k / 8) | 0}`.padStart(2, '0'), p0.x - px * 1.9, p0.y, {
        size: px * 0.8, family: 'mono', baseline: 'middle',
        color: P.css('signal', clamp(a * 0.75)),
      });
    }
    c.restore();
    n++;
  }
  return n;
}

/* ------------------------------------------------------------------ 门 / 帧墙 / 末端墙 */

/** 走廊尽头那道门：段 2 的出口、段 3 的入口 —— **两个渲染世界都画同一组数字**。 */
export function doorSegs(t, P) {
  const z = LANDMARK.door;
  /** @type {any[][]} */
  const segs = [];
  const glow = 0.35 + 0.65 * prog(t, SEG.code.at + 6.5, SEG.engine.at + 0.7, 'inOutCubic');
  const hw = 2.6, hh = 1.85;
  const ring = (k, w, col, a) => {
    const a0 = [-hw * k, -hh * k], b0 = [hw * k, -hh * k], c0 = [hw * k, hh * k], d0 = [-hw * k, hh * k];
    const pts = [a0, b0, c0, d0];
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      segs.push([p[0], p[1], z, q[0], q[1], z, w, col[0], col[1], col[2], a]);
    }
  };
  for (let i = 0; i < 5; i++) ring(1 - i * 0.06, 3.4 - i * 0.5, P.signal, (0.15 + 0.3 * glow) * (1 - i * 0.12));
  ring(1, 4.2, P.bone, 0.85);
  // 门内的光带：横着几道，让"门后面有东西"读得出来
  for (let i = 0; i < 9; i++) {
    const y = -hh + (i / 8) * hh * 2;
    segs.push([-hw * 0.94, y, z, hw * 0.94, y, z, 1.3, P.signal[0], P.signal[1], P.signal[2], 0.05 + 0.22 * glow]);
  }
  return segs;
}

/**
 * 段 5 的帧墙：**两侧的画廊**。
 *
 * ⚠ 第一版把帧铺满整个截面（9×5×4 层），结果是"从一堆箭头中间穿过去"——
 *   读不出"帧"，而且挡路。现在中间留空（|x| < 2.8 不放假），帧挂在两侧的墙上：
 *   镜头从一条挂满帧的走廊中间穿过去，两侧的帧一格一格往后飞。
 */
export function frameWallSegs(t, P, o = {}) {
  const { from, to } = LANDMARK.frames;
  /** @type {any[][]} */
  const segs = [];
  const S = 0.86, GX = 1.10, GY = 0.98;
  const LAYERS = 6;
  const sweep = o.sweep ?? 0;
  for (let iz = 0; iz < LAYERS; iz++) {
    const z = from - 1.2 - iz * ((from - to) - 1.2) / (LAYERS - 1);
    for (let side = -1; side <= 1; side += 2) {
      for (let ix = 0; ix < 8; ix++) {
        const x = side * (2.55 + ix * GX);
        for (let iy = 0; iy < 6; iy++) {
          const y = (iy - 2.5) * GY;
          const seed = iz * 977 + ix * 131 + iy * 17 + (side > 0 ? 57 : 0);
          // 扫描线扫到哪一列，哪一列亮起来（两侧对称）
          const lit = Math.max(0, 1 - Math.abs(x - sweep) * 0.38) * (1 - iz * 0.13);
          const col = lit > 0.45 ? P.bone : P.graphite;
          const a = 0.14 + 0.62 * lit;
          const hw = S / 2, hh = (S * 0.64) / 2;
          const pts = [[x - hw, y - hh], [x + hw, y - hh], [x + hw, y + hh], [x - hw, y + hh]];
          for (let i = 0; i < 4; i++) {
            const p = pts[i], q = pts[(i + 1) % 4];
            segs.push([p[0], p[1], z, q[0], q[1], z, 1.9, col[0], col[1], col[2], a]);
          }
          // 格子里的"内容"：几道按种子变化的横线（像一张缩略图）
          for (let i = 0; i < 4; i++) {
            const yy = y - hh + ((i + 1) / 5) * hh * 2;
            const l = (0.2 + 0.8 * hash2(seed + i, 5)) * hw * 1.6;
            segs.push([x - hw + 0.09, yy, z, x - hw + 0.09 + l, yy, z, 1.4, col[0], col[1], col[2], a * 0.5]);
          }
        }
      }
    }
  }
  return segs;
}

/** 末端那面墙（段 6 的落版底）。 */
export function endWallSegs(t, P) {
  const z = LANDMARK.wall;
  /** @type {any[][]} */
  const segs = [];
  const up = prog(t, SEG.title.at + 0.2, SEG.title.at + 2.6, 'outCubic');
  const hw = 6.4, hh = 3.4;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    segs.push([p[0], p[1], z, q[0], q[1], z, 2.6, P.bone[0], P.bone[1], P.bone[2], 0.5 + 0.4 * up]);
  }
  // 墙上的一道横线：落版文字坐在它上面
  segs.push([-hw + 0.5, -0.62, z, hw - 0.5, -0.62, z, 1.8, P.signal[0], P.signal[1], P.signal[2], 0.5 * up]);
  // 四角的角标
  for (const [cx, cy] of pts) {
    segs.push([cx - Math.sign(cx) * 0.5, cy, z, cx, cy, z, 2.4, P.signal[0], P.signal[1], P.signal[2], 0.55 * up]);
    segs.push([cx, cy - Math.sign(cy) * 0.5, z, cx, cy, z, 2.4, P.signal[0], P.signal[1], P.signal[2], 0.55 * up]);
  }
  return segs;
}

/** 母题（光标/火花）在屏幕上的位置 + 它的尾迹线段 —— 段 2-4 用。 */
export function motifSegs(t, P, o = {}) {
  const m = motifAt(t);
  const [x, y, z] = m.p;
  /** @type {any[][]} */
  const segs = [];
  const lit = m.lit;
  if (lit <= 0.02) return segs;
  const r = o.r ?? 0.10;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    segs.push([x + Math.cos(a0) * r, y + Math.sin(a0) * r, z, x + Math.cos(a1) * r, y + Math.sin(a1) * r, z, 2.4, P.signal[0] * 1.6, P.signal[1] * 1.6, P.signal[2] * 1.6, lit]);
  }
  segs.push([x - r * 2.6, y, z, x + r * 2.6, y, z, 2.0, P.bone[0], P.bone[1], P.bone[2], 0.75 * lit]);
  segs.push([x, y - r * 2.6, z, x, y + r * 2.6, z, 2.0, P.bone[0], P.bone[1], P.bone[2], 0.75 * lit]);
  // 尾迹：沿着"它相对镜头的位置"往回拖几节
  const tr = m.trail;
  if (tr > 0.02) {
    for (let i = 1; i <= 7; i++) {
      const k = i / 7;
      const dz = 0.16 * i * (1 + 1.6 * tr);
      const yy = y - 0.03 * i * tr;
      const a = (1 - k) * 0.5 * tr;
      segs.push([x, yy, z + dz, x, yy, z + dz + 0.1, 3.2, P.signal[0] * 1.4, P.signal[1] * 1.4, P.signal[2] * 1.4, a]);
    }
  }
  return segs;
}

/* ------------------------------------------------------------------ 声音 → 画面 */

/** 踢鼓脉冲（0..1，踩在拍上）—— 画面里所有"闪一下"都用它。 */
export function kick(f) {
  return clamp((f.a?.kick ?? 0) * 1.2);
}

/** 拍号相位脉冲：没有音频分析时的兜底（120bpm → 一拍 0.5s）。 */
export function beatPulse(t, period = 0.5, half = 0.11) {
  const since = ((t % period) + period) % period;
  return Math.exp(-since / half);
}

/* ------------------------------------------------------------------ 后处理（全片一套观感） */

/**
 * 全片的观感：一台摄影机 + 一套调色。
 * ⚠ 这里**不重复施加机位**（机位已经画进几何了），只叠一点手持的呼吸。
 *
 * ⚠⚠ **抖动必须是时间的平滑函数，不能是逐帧白噪声。** 第一版照抄了
 *   `tasks/pdoom-lab/scenes/_world.js` 的 `camPost()`：`(hash2(f.idx, 11) - 0.5) * 2 * amp`
 *   —— 那是"每帧跳到一个新的随机位置"，在 60fps 下不是手持，是**高频振动**。
 *   成片实测（`out/_probe/jitter.mjs`：收尾 t≈46.5s 相邻帧互相关）逐帧位移 ±2–8px、
 *   RMS 3.64px、相邻位移之差最大 13px；设计值 `|shake|` 最大 4.99px、逐帧变化 10.19px。
 *   更糟的是幅度只升不降（`amp = 1.6 + 3.4·dive` 在 36s 到顶后**一直是 5px**），
 *   而 42–48s 摄影机本身已经停住 —— 画面上只剩这个抖动，看起来就像地震。
 *
 *   现在：两段**低频值噪声**（`noise1`，0.85Hz + 2.7Hz 叠加）当手持，
 *   幅度 1.1px（安静段）→ 2.4px（俯冲）→ 落版衰减到 0.25 倍（镜头停住，画面也就稳了）。
 *   用 `t` 而不是 `f.idx`：平滑函数在一帧的 8 个子帧之间只差 ~0.02px ——
 *   双重曝光是白噪声才有的问题，而平滑抖动会像真实抖动那样被运动模糊带一点。
 *   引擎侧的证据与建议见 `docs/IMPROVEMENTS-3.md`。
 */
export function postAt(f, extra = {}) {
  const dive = prog(f.t, SEG.lattice.at, SEG.lattice.at + SEG.lattice.dur, 'inOutCubic');
  const settle = prog(f.t, SEG.title.at, DUR, 'inOutCubic');   // 落版：镜头已经停住
  const amp = (1.1 + 1.3 * dive) * (1 - 0.75 * settle);
  const n = (x, o) => (noise1(x + o) - 0.5) * 2;
  const sx = n(f.t * 0.85, 3.1) + 0.4 * n(f.t * 2.70, 11.0);
  const sy = n(f.t * 0.72, 7.7) + 0.4 * n(f.t * 2.30, 23.0);
  return { shake: [sx * amp, sy * amp * 0.7], ...extra };
}

/**
 * **全片唯一的一套调色 / 曝光**，只吃整片时间。
 *
 * 为什么调色也要"全片一套"：硬切点两侧如果各写各的 post，世界没变、画面却"顿"一下。
 * 把底子（base）与切点上的那几口气（`cutDip` / `doorHit`）都做成 `t` 的**连续函数**之后，
 * 相邻两段在边界上算出来的后处理参数是**同一个值** —— 于是零 overlap 的硬切在画面上
 * 连一帧的曝光差都没有。
 *
 * @param {number} t 整片时间
 */
export function grade(t) {
  const dive = prog(t, SEG.lattice.at, SEG.lattice.at + SEG.lattice.dur, 'inOutCubic');
  // 穿门那一下：15.3s 起亮、15.95s 到顶、之后 0.3s 衰减（两侧读的是同一条曲线）
  const door = sat(prog(t, 15.3, 15.95, 'inQuad')) * (t < 15.95 ? 1 : Math.exp(-(t - 15.95) / 0.30));
  return {
    bloom: 0.36 + 0.22 * dive + 0.18 * door,
    bloomThreshold: 0.76 - 0.06 * dive,
    halation: 0.22 + 0.34 * dive,
    grain: 0.028 + 0.006 * dive,
    vignette: 0.50 + 0.12 * dive,
    ca: (0.38 + 1.7 * dive) + 1.4 * door,
    exposure: 1.0 + 0.32 * door,
    shoulder: 0.86,
    saturation: 1.02 + 0.06 * dive,
    // 每一个硬切点上的一口气：指数凹陷，两侧对称 ⇒ 连续
    fade: 0.20 * Math.exp(-Math.abs(t - SEG.code.at) / 0.22)
        + 0.20 * Math.exp(-Math.abs(t - SEG.frames.at) / 0.22)
        + 0.10 * Math.exp(-Math.abs(t - SEG.title.at) / 0.30),
  };
}

/** 段末的收尾暗场（段 6 最后 1.3 秒淡到黑）。 */
export function outroFade(t) {
  return sat(prog(t, DUR - 1.3, DUR - 0.15, 'inOutCubic'));
}

/** 通用的"从黑里出现"（开场用）。 */
export function segFade(t, at, dur = 0.35) {
  return 1 - sat(prog(t, at, at + dur, 'outQuad'));
}

// 让 lint 闭嘴：这些符号在本文件里是给六个段用的公共 API
export const _internal = { hit, lerp, prog };
