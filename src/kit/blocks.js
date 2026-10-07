// @ts-check
/**
 * `src/kit/blocks.js` —— **方块世界 kit**：用「解析投影 + 线段批」画一片由方块组成的世界。
 *
 * 这不是 Minecraft 专用的东西，它是一个**通用构图**：把空间切成一格一格（`cell`），
 * 每一格是一个 `section`，每个 section 里可以放盒子（`box`）。讲"区块 / 分块 / 缓存行 /
 * 瓦片 / 货架 / 装箱"这类片子都是同一个构图 —— 所以这里的词汇是
 * **section / cell / box**，没有 `chunk` / `block` / 方块 ID 这类专有名词。
 * （原型是 Minecraft 渲染原理讲解片，注释里会提到"Minecraft 那类方块世界"，但 API 不认识它。）
 *
 * ## 它解决的是什么问题
 *
 * 线段批（`LineBatch`）**没有深度测试**。不做任何处理的话，前后棱按"代码顺序"叠在一起，
 * 27 个盒子读成一只铁丝笼子 —— 用户看完原型的原话是
 * 「各种建模可能有点杂乱，而且不清楚，不够直观」。这一层给的是三件事：
 *
 *   ① **画家算法**：3D 线段先进队列，`flush()` 时按相机空间深度**从远到近**排一次再写批；
 *   ② **面朝向判据**（`facesToward`）：盒子只画**朝着镜头**的那 3 个面（棱与填充）；
 *   ③ **排线填充**（`hatchQuad`）：朝镜头的面铺一层**单向**排线，读起来是一块**积木**。
 *
 * 这三件凑齐，一片线框才会变成"一叠积木"。少任何一件，画面就退回"半透明水晶"。
 *
 * ## ⚠ 那段历史：`facesToward()` 的判据曾经是**反的**（`docs/IMPROVEMENTS-4.md` §4.2）
 *
 * 两份任务侧的 `_world.js` 里写的都是：
 *
 * ```js
 * const px = 面心[0] - 相机[0]; …                       // 面心 − 相机
 * out.push(px * n[0] + py * n[1] + pz * n[2] > 0);      // ✗ 这是**背面**的条件
 * ```
 *
 * 那个点积为正的意思是"法线**背离**相机"—— 于是判出来的"可见面"正好是**背面**。
 * 两个后果，都直接命中"不好看"：
 *
 *   · **顶面（+y）从来没被铺过**：俯视机位下每层 section 的"地面"其实是下一层的底面，
 *     真正的地表只有一圈棱线；
 *   · 每个盒子只画**背对镜头**的三个面 → 整片世界读成一块**半透明水晶**，而不是一叠积木。
 *
 * 正确判据是 `dot(相机 − 面心, 法线) > 0`（法线要**朝着**相机）。**这个文件里只有这一处
 * 实现，而且 `tools/test-blocks.mjs` 拿正反用例钉住了它** —— 公共知识写在某个任务的私有
 * 文件里，就会被抄错，而且抄错两次（`tasks/sodium` 至今仍是错的）。这就是"引擎缺一层"的
 * 代价。
 *
 * ## 配套的视觉规律：**alpha 管在不在，tone 管亮不亮**（§4.3）
 *
 * 判据修对之后，世界**仍然**像玻璃，第二层原因是填充：面的"填充"是**一排线**拼的，
 * 只要 `alpha < 1`，排线之间那道发丝缝就把后面的 section 透出来 ——
 * 于是"把背景那 17 节压暗"如果写成"把 alpha 降到 0.4"，得到的是"把整片世界变成玻璃"。
 * 本文件的映射（`FILL_FULL` / `FILL_ZERO` / `TONE_FLOOR`）就是照着这条定的：
 *
 * ```js
 * const fillA = sat((a - 0.05) / 0.12) * …;   // a ≥ 0.17 就已经**完全不透明**
 * const tone  = 0.22 + 0.78 * a;              // "暗"由颜色承担
 * hatchQuad(…, { solid: true, solidK: 0.99 });// 排线缝闭死
 * ```
 *
 * 一句话：**只有 `a < 0.17` 才真的淡出**（那是给"出现 / 消失"用的）。
 * 想"压暗一节"就传小的 `alpha`，**不要**去动 `solidK` / `fillK`。
 *
 * ## 摄影机：一条走完全片的连续曲线
 *
 * 关键帧支持**按段名 + 段内秒**写（§4.4 C）：
 *
 * ```js
 * makeBlocksKit({
 *   clock: { ctm: { start: 62.0, stretch: 1.05 }, … },   // 段名 → 它在整片里的起点
 *   keys: [
 *     { id: 'ctm', at: 3.0, pos: [-8, 32, -84], tgt: [0, 15, 4], fov: 48 },
 *     { id: 'ctm', at: 19.0, pos: [-6, 31, -82], tgt: [0, 15, 4], fov: 48 },
 *     { at: 254.0, pos: [0, 74, -134], tgt: [0, 24, 24], fov: 40 },      // 绝对秒也可以混写
 *   ],
 * });
 * ```
 *
 * 为什么这件事重要（原型的实测）：`anim say` 改了段长之后，机位**自动跟着走**，
 * 不必手抄十几组绝对秒；`tasks/sodium` 那一版写的是绝对秒，改一次旁白就要重算一遍。
 * 没给 `clock` 时 `at` 就当绝对秒用（向后兼容）。
 *
 * ## 什么时候**不要**用它
 *
 * 这一层是"解析投影 + 线段批"，没有 z-test，遮挡全靠自己排：
 *   · 要**真遮挡 / 材质光照 / 成百上千个同样的单元** → 用 Three.js 那条路（`makeThreeShot`，
 *     见 `docs/THREE.md`），别硬压成线段；
 *   · 几何本身是数学式子（无限重复晶格、掏空、雕版排线） → raymarch（`src/core/glsl3d.js`）。
 *
 * ## 顺序（AGENTS.md §5）
 *
 * ```js
 * lines.begin();
 * B.section(ctx, cam, s);              // 3D：进深度队列
 * B.box3(ctx, cam, c, h, color);       // 3D
 * B.flush(ctx);                        // ⚠ 显式排水（也可以直接 lines.flush(ctx.out)）
 * text.clear();
 * lines.begin();                       // 2D 面板层（src/kit/panel.js）
 * lines.flush(ctx.out);
 * ```
 */

import { camera3, project3, clipSegment, depthScale } from '../core/cam.js';
import { clamp, sat, lerp, smoothstep, hash1 } from '../core/util.js';

/* ═══════════════════════════════════════════════ 几何常量（都是模块级只读表） */

/**
 * 6 个面的法线。序号与 `faceGeometry()` 的约定一致：
 * `0 +x / 1 −x / 2 +y / 3 −y / 4 +z / 5 −z`。
 * @type {number[][]}
 */
export const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * 每个面在**单位盒**（半尺寸 = 1）里的几何 `[o, u, v]`：面 = `o + u·s + v·t`（`s,t ∈ [0,1]`）。
 * `o` 的每个分量取 ±1；`u` / `v` 是**全长**（2），所以 `u/2`、`v/2` 是半尺寸方向。
 *
 * ⚠ `faceGeometry()` 用 `o + u/2 + v/2` 算面心 —— 这是"点积有没有写错"的根，
 *   改动这张表必须同时跑 `tools/test-blocks.mjs`。
 * @type {number[][][]}
 */
export const FACE_GEO = [
  [[1, -1, -1], [0, 0, 2], [0, 2, 0]],
  [[-1, -1, -1], [0, 0, 2], [0, 2, 0]],
  [[-1, 1, -1], [2, 0, 0], [0, 0, 2]],
  [[-1, -1, -1], [2, 0, 0], [0, 0, 2]],
  [[-1, -1, 1], [2, 0, 0], [0, 2, 0]],
  [[-1, -1, -1], [2, 0, 0], [0, 2, 0]],
];

/**
 * 12 条棱：`[x0,y0,z0, x1,y1,z1, 相邻面 A, 相邻面 B]`，方向分量取 ±1。
 * 一条棱只有在**相邻的两个面都背对镜头**时才看不见（`box3` 的隐藏线近似）。
 * @type {number[][]}
 */
export const BOX_EDGES = [
  [-1, -1, -1, 1, -1, -1, 3, 5], [-1, -1, 1, 1, -1, 1, 3, 4],
  [-1, 1, -1, 1, 1, -1, 2, 5], [-1, 1, 1, 1, 1, 1, 2, 4],
  [-1, -1, -1, -1, 1, -1, 1, 5], [1, -1, -1, 1, 1, -1, 0, 5],
  [-1, -1, 1, -1, 1, 1, 1, 4], [1, -1, 1, 1, 1, 1, 0, 4],
  [-1, -1, -1, -1, -1, 1, 1, 3], [1, -1, -1, 1, -1, 1, 0, 3],
  [-1, 1, -1, -1, 1, 1, 1, 2], [1, 1, -1, 1, 1, 1, 0, 2],
];

/**
 * 一盏固定的"太阳"（只用在水平分量上）：让同一根柱子上的左右两个侧面天然分得开。
 * 没有它的话，镜头正对 45° 时两个侧面一样亮，盒子又糊成一块。
 */
export const SUN = [-0.55, 0, -0.83];

/** 填充开始真的淡出的下界 / 到顶的上界（§4.3：`a ≥ 0.17` 就已经完全不透明了） */
export const FILL_ZERO = 0.05;
export const FILL_FULL = 0.17;
/** `tone` 的下限：`a → 0` 时颜色收到这个比例（仍然看得见轮廓） */
export const TONE_FLOOR = 0.22;
/** 排线缝的闭合系数：0.99 ⇒ 相邻两条排线的胶囊几乎首尾相接，背后透不过来 */
export const SOLID_K = 0.99;

/* ═══════════════════════════════════════════════ 纯几何（不碰 ctx，可离线断言） */

/**
 * 从调色板里取一个颜色。名字不存在时**回退**到 `fallback` 名（默认 `bone`）。
 * @param {Record<string, number[]>} P @param {string} name @param {string} [fallback]
 * @returns {number[]}
 */
export function pickColor(P, name, fallback = 'bone') {
  return P[name] ?? P[fallback] ?? [1, 1, 1];
}

/**
 * 取一个**必须存在**的调色板名字，不存在就抛错并点名怎么修。
 *
 * 为什么要抛而不是回退：原型里 `P.slab` / `P.slabHi` 是**任务自己的**调色板覆盖
 * （`task.config.mjs` 的 `palette: { slab: '#46586a', slabHi: '#7d9cb0' }`），
 * 一旦下一支片子忘了写这两个名字，`?? P.bone` 会让整片世界**白得发亮** ——
 * 不报错、不崩溃，只是"看起来不对"，属于最难查的那一类（`docs/IMPROVEMENTS-4.md` §7）。
 *
 * @param {Record<string, number[]>} P @param {string} name @param {string} why 报错里点名的位置
 * @returns {number[]}
 */
export function requireColor(P, name, why) {
  const c = P[name];
  if (!c) {
    throw new Error(
      `blocks: ${why} 要的调色板颜色 "${name}" 不存在。`
      + `在 task.config.mjs 的 palette 里加上它（可用：${Object.keys(P).join(' / ')}）`,
    );
  }
  return c;
}

/** 把 `half` 规整成三元组（写场景时经常只想给一个数）。 @returns {number[]} */
export function halfOf(half) {
  return Array.isArray(half) ? [half[0], half[1], half[2]] : [half, half, half];
}

/**
 * 一个面的几何 `[o, u, v]`（世界坐标）。
 * @param {number[]} c 中心 @param {number[]} h 半尺寸 @param {number} f 面序号 0..5
 * @returns {number[][]}
 */
export function faceGeometry(c, h, f) {
  const g = FACE_GEO[f];
  return [
    [c[0] + g[0][0] * h[0], c[1] + g[0][1] * h[1], c[2] + g[0][2] * h[2]],
    [g[1][0] * h[0], g[1][1] * h[1], g[1][2] * h[2]],
    [g[2][0] * h[0], g[2][1] * h[1], g[2][2] * h[2]],
  ];
}

/**
 * 6 个面里哪些**朝着镜头**（可见）。
 *
 * 判据用**面的中心**（不是盒子的中心）—— 相机贴近时后者会给出错的答案。
 * 正确形式是 `dot(相机 − 面心, 法线) > 0`；老代码写的是 `dot(面心 − 相机, 法线) > 0`，
 * 那是**背面**的条件（文件头那段历史）。
 *
 * @param {{ pos: number[] }} cam `camera3()` 的输出（只用到 `pos`）
 * @param {number[]} c 盒子中心 @param {number[]|number} h 半尺寸
 * @returns {boolean[]} 长度 6，序号同 `FACE_NORMALS`
 */
export function facesToward(cam, c, h) {
  const hs = halfOf(h);
  const out = [];
  for (let f = 0; f < 6; f++) {
    const n = FACE_NORMALS[f];
    const g = FACE_GEO[f];
    // 面心 = c + (o·h) + (u·h)/2 + (v·h)/2
    const px = cam.pos[0] - (c[0] + (g[0][0] + g[1][0] * 0.5 + g[2][0] * 0.5) * hs[0]);
    const py = cam.pos[1] - (c[1] + (g[0][1] + g[1][1] * 0.5 + g[2][1] * 0.5) * hs[1]);
    const pz = cam.pos[2] - (c[2] + (g[0][2] + g[1][2] * 0.5 + g[2][2] * 0.5) * hs[2]);
    out.push(px * n[0] + py * n[1] + pz * n[2] > 0);
  }
  return out;
}

/**
 * 一个面的明暗档：正对镜头的程度 + 是不是顶面 + 太阳。
 * 三个可见面于是天然分出三档（正对最亮 / 顶面次之 / 侧面最暗）——**这三档就是"这是一块
 * 积木"的全部依据**：同屏十几个盒子得靠面的明暗分开，不能靠描边。
 *
 * ⚠ 基线从 0.22 抬到 **0.42** 是实测调出来的：钠那版 0.22 配 `tint 0.58`，于是
 * `k` 只有 0.13–0.35 —— 面铺满了却**几乎是背景色**，十几个盒子读成一层玻璃板。
 * @param {number[]} n 面的法线 @param {number[]} view 单位向量：盒子中心 → 相机
 * @returns {number} 明暗系数（大约 0.4 – 1.1）
 */
export function faceTone(n, view) {
  const facing = Math.max(0, n[0] * view[0] + n[1] * view[1] + n[2] * view[2]);
  const sun = Math.max(0, n[0] * SUN[0] + n[2] * SUN[2]);
  return 0.42 + 0.30 * facing + 0.24 * Math.max(0, n[1]) + 0.14 * sun;
}

/**
 * 一个盒子可见的棱的下标（进 `BOX_EDGES` 用）。
 * 一条棱只有在它相邻的两个面**都背对镜头**时才看不见 —— 于是每个盒子只画朝镜头那 9 条棱，
 * 而不是把背面的棱也糊上来（"铁丝笼子"的直接来源）。
 * @param {boolean[]} vis `facesToward()` 的结果
 * @returns {number[]}
 */
export function visibleEdges(vis) {
  const out = [];
  for (let i = 0; i < BOX_EDGES.length; i++) {
    if (vis[BOX_EDGES[i][6]] || vis[BOX_EDGES[i][7]]) out.push(i);
  }
  return out;
}

/**
 * 远的先画（画家算法）。等深度保持原顺序（`Array#sort` 是稳定排序）——
 * 这一点很重要：同一节 section 内部靠"提交顺序"决定遮挡（面先、棱后）。
 * @param {{ w: number }} p @param {{ w: number }} q
 */
export function byDepth(p, q) {
  return q.w - p.w;
}

/**
 * 把 3D 队列按深度排好序（**远 → 近**），不改动入参。
 * `tools/test-blocks.mjs` 拿它钉住画家算法的方向。
 * @template {{ w: number }} T
 * @param {T[]} queue
 * @returns {T[]} 新数组
 */
export function sortByDepth(queue) {
  return queue.slice().sort(byDepth);
}

/**
 * 相机在"世界 AABB 里面 → 0；退到 `outside` 单位之外 → 1"。
 * 用它决定**这一帧要不要铺实心面**。
 *
 * 为什么必须有这一条：镜头横穿世界那几秒，飞在里面还铺面的话，四周的墙面会把整屏糊成
 * 一片灰白（原型实测 t=48s 平均亮度 141，其余部分 35–50，连字幕都读不出来）。
 * 这是个**全局标量**（不是逐节的），所以过渡是整体的、不会一节一节地跳。
 *
 * @param {number[]} p 相机位置
 * @param {{ center: number[], half: number[], outside?: number }} box 世界 AABB
 * @returns {number} 0..1
 */
export function solidityAt(p, box) {
  const c = box.center;
  const h = box.half;
  const d = Math.hypot(
    Math.max(0, Math.abs(p[0] - c[0]) - h[0]),
    Math.max(0, Math.abs(p[1] - c[1]) - h[1]),
    Math.max(0, Math.abs(p[2] - c[2]) - h[2]),
  );
  return smoothstep(0, box.outside ?? 26, d);
}

/**
 * 深度淡出：远处的东西压暗一点（但**不能压到看不见** —— 结构线是这类片子的骨架）。
 *
 * ## ⚠ 它现在返回的是"**亮度系数**"，不是"不透明度"（2026-10 改，§4.3）
 *
 * 老实现把它乘进**颜色第 4 个分量**，于是"远处压暗"变成了"远处变透明" ——
 * 而 `LineBatch` 没有深度测试、填充是一排线拼的：`alpha < 1` 时排线之间的发丝缝
 * 会把后面的 section 透出来。实测后果是**整片世界读成一块半透明水晶**，
 * 正是 `docs/IMPROVEMENTS-4.md` §4.3 / §4.2 那两条要解决的观感问题。
 *
 * 所以现在只提供**一个**系数，由调用方乘进 RGB（`depthTint`），**不再碰 alpha**：
 * 远处仍然退得下去（暗），但永远不透明。
 *
 * @param {number} w 相机空间深度
 * @param {number} [near] @param {number} [far]
 * @returns {number} 0.32..1 的**亮度**系数
 */
export function depthAlpha(w, near = 40, far = 240) {
  return clamp(1 - smoothstep(near, far, w) * 0.55, 0.32, 1);
}

/**
 * 深度 → **颜色**系数（`depthAlpha` 语义明确化后的名字）。
 * 乘进 `[r,g,b]`，**不要**乘进第 4 个分量。见 `depthAlpha` 的说明（§4.3）。
 * @param {number} w @param {number} [near] @param {number} [far]
 * @returns {number}
 */
export function depthTint(w, near = 40, far = 240) {
  return depthAlpha(w, near, far);
}

/* ═══════════════════════════════════════════════ 时间：段名 + 段内秒 → 绝对秒 */

/**
 * **段内秒 → 整片绝对秒**。这是 §4.4 C 的核心公式，单独导出就是为了能离线测。
 *
 * ```js
 * toAbsTime({ start: 62, stretch: 1.05 }, 3.0)   // → 65.15
 * toAbsTime(undefined, 3.0)                      // → 3.0（没有时钟表时按绝对秒用）
 * ```
 *
 * `stretch` 是旁白那层给每个镜头的"放慢倍数"（`localT = f.lt / stretch`）——
 * 段内第 `at` 秒的**画面**出现在整片的 `start + at * stretch`。
 *
 * @param {{ start?: number, stretch?: number }|undefined|null} seg
 * @param {number} at 段内秒
 * @returns {number} 整片绝对秒
 */
export function toAbsTime(seg, at) {
  if (!seg) return at;
  return (seg.start ?? 0) + at * (seg.stretch ?? 1);
}

/**
 * 段内时间：场景里**永远**这样取时间，于是画面节奏由旁白决定（本文件不持有它，
 * 只是把公式放在同一个地方，免得每支片子各写一遍写错）。
 * @param {{ lt: number }} f `ctx.f`
 * @param {{ stretch?: number }} [params] 段参数
 */
export function localT(f, params) {
  return f.lt / (params?.stretch ?? 1);
}

/**
 * 关键帧展开成"绝对秒 → 机位"的表（纯函数，模块加载时算一次）。
 *
 * 两种写法可以混在同一份 `keys` 里：
 *   · `{ id, at, pos, tgt, fov }` —— **按段名 + 段内秒**（推荐；段长变了机位跟着走）
 *   · `{ at, pos, tgt, fov }`    —— 整片绝对秒（老写法，或者首尾那种"片级"机位）
 *
 * @param {Array<{ id?: string, at: number, pos: number[], tgt: number[], fov?: number,
 *   roll?: number }>} keys
 * @param {Record<string, { start?: number, stretch?: number }>} [clock]
 * @returns {Array<{ id: string|null, at: number, T: number, pos: number[], tgt: number[],
 *   fov: number, roll: number }>}
 */
export function expandKeys(keys, clock) {
  const list = (keys ?? []).map((k) => {
    const seg = k.id ? clock?.[k.id] : undefined;
    return {
      id: k.id ?? null,
      at: k.at,
      T: toAbsTime(seg, k.at),
      pos: k.pos,
      tgt: k.tgt,
      fov: k.fov ?? 44,
      roll: k.roll ?? 0,
    };
  });
  list.sort((a, b) => a.T - b.T);
  return list;
}

/**
 * 时间 `t` 落在哪两个关键帧之间（`keys` 必须已按 `T` 升序）。
 * 段外取端值（返回同一帧两次），所以插值系数恒为 0 或 1。
 * @param {ReturnType<typeof expandKeys>} keys
 * @param {number} t
 * @returns {{ a: any, b: any, k: number }} `k` 是 smoothstep 之后的系数
 */
export function keySpan(keys, t) {
  const n = keys.length;
  if (n === 0) throw new Error('blocks: camAt 至少要有一个关键帧');
  const first = keys[0];
  const last = keys[n - 1];
  if (t <= first.T) return { a: first, b: first, k: 0 };
  if (t >= last.T) return { a: last, b: last, k: 0 };
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.T && t <= b.T) return { a, b, k: smoothstep(a.T, b.T, t) };
  }
  return { a: last, b: last, k: 0 };
}

/* ═══════════════════════════════════════════════ 深度队列（画家算法的实现） */

/**
 * 每帧状态挂在 ctx 上的键名。多个 kit（比如"主世界 + 一个剖面小世界"）可以各用自己的键
 * ——**用同一个 `lines` 批的两个 kit 必须用同一个队列**，否则排序会各自为政、
 * 两片世界的远近关系就乱了。所以默认只有一个键。
 */
export const QUEUE_KEY = '__blocks3';

/**
 * 被接过管的 `LineBatch` → 它原来的 `_push` / `flush`。
 * 用 `WeakMap` 而不是往批上挂字段：批的引用在整支片子里是长期活着的，挂字段容易被
 * 下一次装载读到过期的闭包（那种 bug 只在"同一帧里渲染两次"时才露头）。
 * @type {WeakMap<any, { push: Function, flush: Function }>}
 */
const original = new WeakMap();

/**
 * 拿到本帧的 3D 队列，并在需要时把 `lines._push` / `lines.flush` 接上排水。
 *
 * ## 为什么要挂钩子，而不是让场景每帧调一次 `sort()`
 *
 * 场景的骨架是固定的（`lines.begin() → 3D → lines.flush()`），但 3D 与**屏幕层**
 * 可能交错在同一批里（面板、HUD 直接写批，不走队列）。只钩 `flush` 的话，队列里的 3D 线会被
 * 推迟到面板**之上**，前后关系就反了。钩在 `_push`（所有 `seg/polyline/fillRect/…` 的
 * 唯一出口）上，任何一条直接写批的线出现时先排水，提交顺序与不排序时**逐字一致**。
 *
 * 钩子只装一次、`lines.flush()` 的时候自己摘掉（`delete` 让它退回原型方法），每帧装一次。
 * 队列按 `f.idx` 缓存 —— 同一帧的多个子帧复用同一个（`f.idx` 在子帧之间是不变的）。
 *
 * @param {any} ctx SceneCtx
 * @param {string} [key]
 * @returns {Array<{ a: number, b: number, c: number, d: number, w: number, px: number, col: number[] }>}
 */
function queue3(ctx, key = QUEUE_KEY) {
  let Q = ctx[key];
  if (Q && Q.idx === ctx.f.idx) return Q;
  const L = ctx.lines;
  let saved = original.get(L);
  if (!saved) {
    saved = { push: L._push, flush: L.flush };
    original.set(L, saved);
  } else if (Q && Q.length) {
    // 上一帧的钩子没走到 flush（场景中途 return / 抛错），队列里可能还压着线。
    // 先排掉再重装，免得它们被这一帧的钩子漏掉（表现为"上一帧的几条线忽然跑到最上面"）。
    drainQueue(Q, L, saved.push);
  }
  Q = [];
  Q.idx = ctx.f.idx;
  Q.installed = true;
  ctx[key] = Q;
  L._push = function blocksSortedPush(ax, ay, bx, by, w, c, u0, u1) {
    drainQueue(Q, L, saved.push);
    // ⚠ 顺序很关键：**先把槽位清掉，再提交这一条**。
    //   这是**屏幕层**的线（它没走队列），所以它没有 3D 元信息；
    //   写在 `saved.push(...)` **之后**的话，每一条拿到的都是**上一条**的深度
    //   （实测踩过：屏幕层读到了 3D 线的 w —— 因为槽位是在 push 返回之后才清的）。
    clearPending();
    return saved.push.call(L, ax, ay, bx, by, w, c, u0, u1);
  };
  L.flush = function blocksSortedFlush(target) {
    drainQueue(Q, L, saved.push);
    detachHooks(key, L, Q, saved);
    return saved.flush.call(L, target);
  };
  return Q;
}

/** 摘掉钩子，让它退回原型方法（幂等：没装过也不会出错）。 */
function detachHooks(key, L, Q, saved) {
  if (Q.installed) {
    delete L._push;
    delete L.flush;
    Q.installed = false;
    original.delete(L);
  }
  if (L[key] === Q) L[key] = null;
}

/**
 * "这一条 `_push` 的世界坐标"槽位 —— **只为离线测试**（引擎自己不读它）。
 *
 * ⚠ 它是一个**模块级单例对象**，两边都必须**改属性、不能换对象**：
 *   `drainQueue` 拿着它的引用逐条写，钩子在屏幕层的线提交完之后把它清空。
 *   谁要是写了 `ctx.__blocksPending = {...}` / `PENDING = {...}`，两边的引用就分家了 ——
 *   屏幕层会读到上一条 3D 线的世界坐标（实测踩过一次，症状是"顶面明明铺了却断言不到"）。
 * @type {{ w: number|null, a3: number[]|null, b3: number[]|null }}
 */
export const PENDING = { w: null, a3: null, b3: null };

/** 清空 `PENDING`（**改属性、不换对象** —— 换对象会让别处的引用失效）。 */
export function clearPending() {
  PENDING.w = null;
  PENDING.a3 = null;
  PENDING.b3 = null;
}

/**
 * 把排好序的 3D 线写进批。用**原始** `_push`（不能再触发自己，否则无限递归）。
 * 排完队列就空了，所以钩子随后可以安全摘掉（不会漏掉待排的线）。
 *
 * ⚠ 排水前会把这一条的**世界坐标与深度**写进 `PENDING`（只为离线测试）：
 *   `_push` 只看得见屏幕坐标，而"这条排线落在世界的哪个平面上"是必须能断言的
 *   （顶面铺没铺 = §4.2 那个 bug 的后果）。
 * @param {any[]} Q @param {any} L @param {Function} push
 * @param {{ w: number|null, a3: number[]|null, b3: number[]|null }} [slot]
 */
function drainQueue(Q, L, push, slot = PENDING) {
  slot.w = 0;
  slot.a3 = null;
  slot.b3 = null;
  if (Q.length === 0) { Q.drained = 0; return; }
  Q.sort(byDepth);                      // 远的先画 → 近的压在上面
  Q.drained = Q.length;
  for (let i = 0; i < Q.length; i++) {
    const s = Q[i];
    slot.w = s.w;
    slot.a3 = s.a3 ?? null;
    slot.b3 = s.b3 ?? null;
    push.call(L, s.a, s.b, s.c, s.d, s.px, s.col, 0, 1);
  }
  Q.length = 0;
  clearPending();
}

/**
 * 画一条 3D 线段：投影 → 近平面裁剪 → 按深度定线宽 → **进深度队列**。
 * 返回是否真的画了（整条被裁掉的返回 `false`）。
 *
 * ## 两个必须记住的坑
 *
 * ① **线宽必须用裁剪之后的深度 `wSeg`，不能用 `opts.dw`**。相机走在世界里的时候，
 *    身后的 section 其 `dw` 是**负数**，而 `depthScale()` 里是 `max(1e-6, w)` ——
 *    负深度会被当成 1e-6，线宽变成**上亿像素**的胶囊，几条线就把整屏糊白（不报错）。
 * ② `opts.dw` 是**只用来排序**的强制深度。整个 section 的线与面共用它一个值，
 *    于是节内保持"提交顺序"（面先、棱后），而节与节之间仍按远近排 ——
 *    不锁同一个值的话，一节自己的**棱**会被它自己的**面**盖掉一半（棱看着像断的）。
 *
 * ## 深度淡出走 **tone**，不走 alpha（§4.3）
 *
 * `fade` 默认开：远处的东西按 `depthTint(w)` **压暗颜色**（乘进 RGB），
 * 而**不透明度**只在"出现 / 消失"时才变（那是调用方自己传的 `color[3]`）。
 * ⚠ 老实现是把它乘进 `color[3]` 的，症状见 `depthTint` 的注释 —— 别改回去。
 * 想要"整条线整体淡出"（出现/消失）就自己写 `color[3]`；那时 alpha 低于 1 是**对的**，
 * 因为那一条本来就该在那一瞬间透。
 *
 * @param {any} ctx SceneCtx
 * @param {any} cam `camera3()` 的输出
 * @param {number[]} a 世界坐标起点
 * @param {number[]} b 世界坐标终点
 * @param {number[]} color 线性 `[r,g,b]` 或 `[r,g,b,a]`（> 1 会泛光）
 * @param {number} [wWorld] 世界单位的线宽
 * @param {{ dw?: number, minW?: number, fade?: boolean, near?: number }} [opts]
 * @returns {boolean} 是否真的画了
 */
export function seg3(ctx, cam, a, b, color, wWorld = 0.06, opts = {}) {
  const { W, H } = ctx;
  const A = project3(cam, W, H, a[0], a[1], a[2]);
  const B = project3(cam, W, H, b[0], b[1], b[2]);
  if (!clipSegment(A, B, opts.near ?? 0.15)) return false;
  const wSeg = (A.w + B.w) * 0.5;       // 这一条自己的深度（裁剪之后恒 ≥ 近平面）
  const w = opts.dw ?? wSeg;            // 只影响排序
  const px = Math.max(opts.minW ?? 0.7, wWorld * depthScale(cam, wSeg, H));
  // 深度淡出：**乘 RGB，不动 alpha**（§4.3 —— "压暗"不能是"变透明"）
  let c = color;
  if (opts.fade !== false) {
    const k = depthTint(w);
    c = [c[0] * k, c[1] * k, c[2] * k, c.length >= 4 ? c[3] : 1];
  }
  // `a3` / `b3` 是这条线的**世界坐标**（屏幕坐标由它们投出来）。它们不参与绘制
  // （`a`/`b`/`c`/`d` 才是屏幕坐标），留着是为了能离线断言"这一条落在世界的哪个平面上"
  // —— `tools/test-blocks.mjs` 靠它验证"顶面到底铺没铺"（§4.2 那个 bug 的后果）。
  queue3(ctx).push({ a: A.x, b: A.y, c: B.x, d: B.y, w, px, col: c, a3: a, b3: b });
  return true;
}

/**
 * **显式**把 3D 队列排一次序写进批（同时摘掉挂上的钩子）。
 *
 * 不调也行 —— `lines.flush(ctx.out)` 会在最后一刻自动排水；显式调用只是让"3D 到此为止"
 * 这件事在代码里看得出来。
 * @param {any} ctx SceneCtx
 * @param {string} [key] 队列键（默认就是本套件用的那个）
 * @returns {number} 一共提交了多少条
 */
export function flush(ctx, key = QUEUE_KEY) {
  const Q = ctx[key];
  if (!Q) return 0;
  const L = ctx.lines;
  const saved = original.get(L);
  if (saved) drainQueue(Q, L, saved.push);        // 排完队列就空了
  detachHooks(key, L, Q, saved);
  clearPending();
  return Q.drained ?? 0;                          // `drainQueue` 记下这一次排了多少条
}

/* ═══════════════════════════════════════════════ 盒子 */

/**
 * 画一个轴对齐立方体（线框）。`opts.hide` 默认**开**：只画朝镜头那 9 条棱。
 * @param {any} ctx @param {any} cam
 * @param {number[]} center 中心 @param {number[]|number} half 半尺寸
 * @param {number[]} color 线性色（`[r,g,b]` / `[r,g,b,a]`）
 * @param {number} [wWorld] 线宽（世界单位）
 * @param {{ dw?: number, minW?: number, fade?: boolean, hide?: boolean }} [opts]
 */
export function box3(ctx, cam, center, half, color, wWorld = 0.06, opts = {}) {
  const hs = halfOf(half);
  const vis = opts.hide === false ? null : facesToward(cam, center, hs);
  const v = (sx, sy, sz) => [
    center[0] + sx * hs[0], center[1] + sy * hs[1], center[2] + sz * hs[2],
  ];
  for (let i = 0; i < BOX_EDGES.length; i++) {
    const e = BOX_EDGES[i];
    if (vis && !vis[e[6]] && !vis[e[7]]) continue;
    seg3(ctx, cam, v(e[0], e[1], e[2]), v(e[3], e[4], e[5]), color, wWorld, opts);
  }
}

/**
 * 用一个平行四边形（`o + u·s + v·t`）铺**单向**排线 —— 3D 版的"填充"。
 *
 * ## 三个参数各自管什么（这是本文件最容易用错的一处）
 *
 * | 参数 | 管什么 | 默认 |
 * |---|---|---|
 * | `axis` | 排线方向：`'u'`（线沿 u 铺、在 v 上等距）/ `'v'` / `'both'`（= 井字，**别用**） | `'u'` |
 * | `solid` | 把排线变成**近实心面**（按屏幕间距逐条定宽） | `false` |
 * | `solidK` | 缝的闭合程度；`0.99` = 几乎闭死（**"挡住后面的东西"全靠它**） | 0.92 |
 *
 * ⚠ **双向排线（`'both'`）是原型里被用户点名过的东西**：镜头一拉远，井字就脱离盒子，
 * 变成一片悬浮的符号（「0:21 前后那种不知道什么神秘的井字形物体」）。默认单向：
 * 近看是排线，远看是一层淡淡的实心面。
 *
 * ⚠ `solid` 的宽度取"它到自己上下相邻两条的**屏幕**间距"：透视下同一个面上的排线间距
 * 从近到远能差好几倍，取固定世界宽度不是近端糊死就是远端留缝。上限 420px 是**安全阀**
 * —— 相机贴在面上时投影间距会炸掉，没有它一条排线就能糊满整屏。
 *
 * @param {any} ctx @param {any} cam
 * @param {number[]} o 面原点 @param {number[]} u @param {number[]} v 两个方向向量（全长）
 * @param {number} n 排线条数（< 2 直接返回）
 * @param {number[]} color 线性色（含 alpha 的话就是填充的"存在度"，见下）
 * @param {number} [wWorld] 非 solid 时的线宽（世界单位）
 * @param {{ axis?: 'u'|'v'|'both', solid?: boolean, solidK?: number, minW?: number,
 *   dw?: number, fade?: boolean, near?: number }} [opts]
 * @returns {number} 实际提交了几条（`tools/test-blocks.mjs` 用它断言"有没有真的铺上"）
 */
export function hatchQuad(ctx, cam, o, u, v, n, color, wWorld = 0.03, opts = {}) {
  if (!(n >= 2)) return 0;
  const axis = opts.axis ?? 'u';
  const pt = (s, t) => [
    o[0] + u[0] * s + v[0] * t,
    o[1] + u[1] * s + v[1] * t,
    o[2] + u[2] * s + v[2] * t,
  ];
  let count = 0;
  if (opts.solid && axis !== 'v') {
    // 沿 v 采样中线，量相邻两条的屏幕间距 → 逐条定宽（见上面那段）
    const mid = [];
    for (let i = 0; i <= n; i++) {
      const p = pt(0.5, i / n);
      mid.push(project3(cam, ctx.W, ctx.H, p[0], p[1], p[2]));
    }
    for (let i = 1; i < n; i++) {
      const sp = Math.hypot(mid[i + 1].x - mid[i - 1].x, mid[i + 1].y - mid[i - 1].y) * 0.5;
      const w = Math.min(420, Math.max(opts.minW ?? 0.6, sp * (opts.solidK ?? 0.92)));
      if (seg3(ctx, cam, pt(0, i / n), pt(1, i / n), color, 1e-6, { ...opts, solid: false, minW: w })) count++;
    }
    return count;
  }
  for (let i = 1; i < n; i++) {
    const s = i / n;
    if (axis !== 'v' && seg3(ctx, cam, pt(0, s), pt(1, s), color, wWorld, opts)) count++;   // 线沿 u 铺
    if (axis !== 'u' && seg3(ctx, cam, pt(s, 0), pt(s, 1), color, wWorld, opts)) count++;   // 线沿 v 铺
  }
  return count;
}

/**
 * 一个**实心**的盒子：朝镜头的 3 个面铺满（按 `faceTone` 分三档），再描一圈棱。
 *
 * 和 `section()` 的区别：这个用于"画面里的一件东西"（货箱、模型部件、数据块），
 * 尺寸小、离镜头近，所以排线更密、顶面更亮 —— 它必须**一眼就是一块实心体**，
 * 不能像 `box3` 那样只剩一副线框（线框在小物件上会读成"没画完"）。
 *
 * @param {any} ctx @param {any} cam
 * @param {number[]} center @param {number[]|number} half
 * @param {string|number[]} color 调色板名（`ctx.P` 里取）或线性色数组
 * @param {{ alpha?: number, tone?: number, hatch?: number, w?: number, minW?: number,
 *   hero?: boolean, heroColor?: string }} [opts]
 */
export function solidBox(ctx, cam, center, half, color, opts = {}) {
  const a = opts.alpha ?? 1;
  if (a <= 0.012) return;
  const P = ctx.P;
  const hs = halfOf(half);
  const base = Array.isArray(color) ? color : pickColor(P, color);
  const dx = center[0] - cam.pos[0], dy = center[1] - cam.pos[1], dz = center[2] - cam.pos[2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  const view = [dx / dl, dy / dl, dz / dl];
  const vis = facesToward(cam, center, hs);
  const dw = project3(cam, ctx.W, ctx.H, center[0], center[1], center[2]).w;
  const n = opts.hatch ?? 12;
  // ⚠ 这里 `tone` 直接乘 `a`：小物件没有"背景节"那种压暗需求，`a` 就是它的存在度
  const tone = (opts.tone ?? 1.0) * a;
  // 面**先**画、棱后画 —— 描边总在面之上
  for (let f = 0; f < 6; f++) {
    if (!vis[f]) continue;
    const [o, u, v] = faceGeometry(center, hs, f);
    const k = faceTone(FACE_NORMALS[f], view) * tone * (f === 2 ? 1.18 : 1.0);
    hatchQuad(ctx, cam, o, u, v, n,
      [lerp(P.ink[0], base[0], k), lerp(P.ink[1], base[1], k), lerp(P.ink[2], base[2], k), 1.0 * a],
      0.05, { solid: true, minW: 1.6, dw, solidK: SOLID_K, fade: false });
  }
  box3(ctx, cam, center, hs,
    [base[0] * 1.5, base[1] * 1.5, base[2] * 1.5, 0.95 * a],
    opts.w ?? 0.14, { minW: opts.minW ?? 2.0, dw, fade: false });
  if (opts.hero) {
    box3(ctx, cam, center, [hs[0] + 0.5, hs[1] + 0.5, hs[2] + 0.5],
      [...(P[opts.heroColor ?? 'signal'] ?? P.signal), 0.95 * a],
      0.16, { minW: 1.8, dw, fade: false });
  }
}

/* ═══════════════════════════════════════════════ 世界的部件 */

/**
 * 世界脚下的地面网格：给整个世界一个"地面"，否则盒子会漂在虚空里。
 * @param {any} ctx @param {any} cam @param {number} t（保留：以后要做随时间扫过的地面）
 * @param {{ alpha?: number, radius?: number, div?: number, y?: number, color?: string }} [opts]
 */
export function ground(ctx, cam, t, opts = {}) {
  const P = ctx.P;
  const a = opts.alpha ?? 1;
  if (a <= 0.01) return;
  const R = opts.radius ?? 96;
  const N = opts.div ?? 10;
  const y = opts.y ?? -0.5;
  const c = (() => { const b = P[opts.color ?? 'graphite'] ?? P.graphite; return [b[0], b[1], b[2], 0.10 * a]; })();
  for (let i = 0; i <= N; i++) {
    const s = -R + (2 * R * i) / N;
    seg3(ctx, cam, [s, y, -R], [s, y, R], c, 0.04, { minW: 0.5 });
    seg3(ctx, cam, [-R, y, s], [R, y, s], c, 0.04, { minW: 0.5 });
  }
}

/**
 * "观察者"标记：一个亮点 + 朝几个方向的视线。讲"从哪看出去"时用它。
 * @param {any} ctx @param {any} cam @param {number[]} eye 世界坐标
 * @param {number} t（保留）
 * @param {{ alpha?: number, range?: number, dirs?: number[][], core?: string, ray?: string }} [opts]
 */
export function playerMarker(ctx, cam, eye, t, opts = {}) {
  const a = opts.alpha ?? 1;
  if (a <= 0.01) return;
  const P = ctx.P;
  const q = project3(cam, ctx.W, ctx.H, eye[0], eye[1], eye[2]);
  if (q.w > 0.4) {
    const b = P[opts.core ?? 'bone'] ?? P.bone;
    ctx.lines.circle(q.x, q.y, Math.min(26, 4.4 * depthScale(cam, q.w, ctx.H)), 0.9, [b[0], b[1], b[2], a]);
  }
  const R = opts.range ?? 74;
  const dirs = opts.dirs ?? [
    [0, -0.42, 1], [-0.62, -0.34, 0.72], [0.62, -0.34, 0.72],
    [0, -0.2, -1], [-1, -0.3, 0], [1, -0.3, 0],
  ];
  const rc = P[opts.ray ?? 'ash'] ?? P.ash;
  const col = [rc[0], rc[1], rc[2], 0.16 * a];
  for (const d of dirs) {
    const L = Math.hypot(d[0], d[1], d[2]) || 1;
    const p = [eye[0] + (d[0] / L) * R, eye[1] + (d[1] / L) * R, eye[2] + (d[2] / L) * R];
    seg3(ctx, cam, eye, p, col, 0.03, { minW: 0.6 });
  }
}

/**
 * 一个锥体（视锥）：从眼睛出发的四条棱 + 远端四边形 + 近端淡四边形 + 侧面排线。
 * 讲"看得见 / 看不见""采样范围""探测范围"时用它 —— 锥里的是一个集合，锥外的是另一个。
 *
 * @param {any} ctx @param {any} cam
 * @param {number[]} eye 锥尖 @param {number[]} dir 朝向（不必归一化）
 * @param {{ alpha?: number, near?: number, far?: number, spread?: number, hatch?: number,
 *   color?: string, nearAlpha?: number }} [opts]
 */
export function frustumCone(ctx, cam, eye, dir, opts = {}) {
  const P = ctx.P;
  const a = opts.alpha ?? 1;
  if (a <= 0.01) return;
  const near = opts.near ?? 6;
  const far = opts.far ?? 62;
  const spread = opts.spread ?? 0.62;
  const d = dir.slice();
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  d[0] /= dl; d[1] /= dl; d[2] /= dl;
  // 正交基：朝向 d + 与它垂直的 r / u（d 接近竖直时换一个 up，否则外积退化）
  const up0 = Math.abs(d[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
  let rx = d[1] * up0[2] - d[2] * up0[1];
  let ry = d[2] * up0[0] - d[0] * up0[2];
  let rz = d[0] * up0[1] - d[1] * up0[0];
  const rl = Math.hypot(rx, ry, rz) || 1;
  const r = [rx / rl, ry / rl, rz / rl];
  const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
  const at = (k, sx, sy) => [
    eye[0] + d[0] * k + (r[0] * sx + u[0] * sy) * k * spread,
    eye[1] + d[1] * k + (r[1] * sx + u[1] * sy) * k * spread,
    eye[2] + d[2] * k + (r[2] * sx + u[2] * sy) * k * spread,
  ];
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const name = opts.color ?? 'signal';
  const c = [...(P[name] ?? P.signal), 0.44 * a];
  const cf = [...(P[name] ?? P.signal), 0.26 * a];
  for (const [sx, sy] of cs) seg3(ctx, cam, at(near, sx, sy), at(far, sx, sy), c, 0.05, { minW: 1.0, fade: false });
  for (let i = 0; i < 4; i++) {
    const p = cs[i];
    const q = cs[(i + 1) % 4];
    seg3(ctx, cam, at(far, p[0], p[1]), at(far, q[0], q[1]), c, 0.06, { minW: 1.4, fade: false });
    const cN = opts.nearAlpha == null ? cf : [...(P[name] ?? P.signal), opts.nearAlpha * a];
    seg3(ctx, cam, at(near, p[0], p[1]), at(near, q[0], q[1]), cN, 0.05, { minW: 1.0, fade: false });
  }
  // 侧面铺一层很淡的排线：读起来是"一块视野"而不是几根线
  const o0 = at(near, -1, -1);
  const o1 = at(far, -1, -1);
  const p10 = at(near, 1, -1);
  hatchQuad(ctx, cam, o0,
    [p10[0] - o0[0], p10[1] - o0[1], p10[2] - o0[2]],
    [o1[0] - o0[0], o1[1] - o0[1], o1[2] - o0[2]],
    opts.hatch ?? 7, [...(P[name] ?? P.signal), 0.06 * a], 0.05, { minW: 0.7, fade: false });
}

/**
 * 一条 3D 光束（光路、连线、"从 A 指向 B"）。
 * @param {any} ctx @param {any} cam @param {number[]} from @param {number[]} to
 * @param {number[]} color @param {{ w?: number, minW?: number, fade?: boolean }} [opts]
 */
export function beam(ctx, cam, from, to, color, opts = {}) {
  seg3(ctx, cam, from, to, color, opts.w ?? 0.16, { minW: opts.minW ?? 1.6, fade: opts.fade ?? false });
}

/**
 * 一颗"球体轮廓"：几圈同心线（光源、星球、气泡、"这一圈的范围"）。
 * ⚠ `opts.alpha` **会乘进颜色里**（原型早先版本算了 `al` 却没接进去，于是传 alpha 没反应）。
 * @param {any} ctx @param {any} cam @param {number[]} p 球心 @param {number} radius 世界单位
 * @param {number[]} color 线性色 @param {{ alpha?: number, rings?: number, core?: number,
 *   minW?: number, segs?: number }} [opts]
 */
export function orb(ctx, cam, p, radius, color, opts = {}) {
  const a = opts.alpha ?? 1;
  if (a <= 0.01) return;
  const rings = opts.rings ?? 3;
  const axes = [[[1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 0, 1]], [[0, 1, 0], [0, 0, 1]]];
  const N = opts.segs ?? 26;
  for (let i = 0; i < rings; i++) {
    const k = (i + 1) / rings;
    const rr = radius * k;
    const fade = (1 - 0.35 * (1 - k)) * (opts.core ?? 0.9) * a;
    const cc = [
      color[0] * fade, color[1] * fade, color[2] * fade,
      (color.length > 3 ? color[3] : 1) * fade,
    ];
    for (const [u, v] of axes) {
      let prev = null;
      for (let n = 0; n <= N; n++) {
        const th = (n / N) * Math.PI * 2;
        const q = [
          p[0] + (u[0] * Math.cos(th) + v[0] * Math.sin(th)) * rr,
          p[1] + (u[1] * Math.cos(th) + v[1] * Math.sin(th)) * rr,
          p[2] + (u[2] * Math.cos(th) + v[2] * Math.sin(th)) * rr,
        ];
        if (prev) seg3(ctx, cam, prev, q, cc, 0.05, { minW: opts.minW ?? 0.8, fade: false });
        prev = q;
      }
    }
  }
}

/* ═══════════════════════════════════════════════ 工厂：把上面这些用一台摄影机串起来 */

/**
 * 建一个"方块世界"套件。
 *
 * ## ⚠ 默认调色板名要在任务里自己加
 *
 * `section()` 的默认配色用的是 **`slab`（侧面）/ `slabHi`（顶面）/ `bone`（顶层的棱）/
 * `ash`（其余棱）** —— 前两个**不是引擎内置色**，请在 `task.config.mjs` 里覆盖：
 *
 * ```js
 * palette: { slab: '#46586a', slabHi: '#7d9cb0' }   // 侧面暗、顶面亮一档
 * ```
 *
 * `setup(ctx)` 里创建套件时会**立刻检查**这几个名字，缺了就抛错并点名列出来
 * （见 `requireColor`：静默回退成骨白会让整片世界白得发亮，而且不报错）。
 * 想用别的配色就在 `section(ctx, cam, s, { color, topColor, edgeColor })` 上显式传。
 *
 * @param {{
 *   cell?: number | number[], cellX?: number, cellY?: number, cellZ?: number,
 *   cols?: number[], rows?: number[], layers?: number[],
 *   hatch?: number, heroHatch?: number,
 *   clock?: Record<string, { start?: number, stretch?: number }>,
 *   keys?: Array<{ id?: string, at: number, pos: number[], tgt: number[], fov?: number,
 *     roll?: number }>,
 *   color?: string, topColor?: string, edgeColor?: string,
 *   P?: Record<string, number[]>,
 *   H?: number, solidOutside?: number, queueKey?: string,
 * }} [opts]
 * @returns {any} 世界套件（方法清单：`cell` `cols` `rows` `layers` `world` `sections` `keys` `clock`
 *   / `sectionCenter` `sectionAt` / `camAt` `camPosAt` `camDir` `toAbs` `solidity`
 *   / `section` `ground` `playerMarker` `frustumCone` `beam` `orb` `solidBox` `box3` `hatchQuad` `seg3`
 *   / `flush` `sortByDepth` `facesToward` `faceTone` `visibleEdges` `faceGeometry`）
 */
export function makeBlocksKit(opts = {}) {
  /* ── 尺寸与切片 ─────────────────────────────────────────────────────── */

  const cell = opts.cell != null
    ? halfOf(opts.cell)
    : [opts.cellX ?? 16, opts.cellY ?? opts.cellX ?? 16, opts.cellZ ?? opts.cellX ?? 16];
  const cols = opts.cols ?? [-1, 0, 1];
  const rows = opts.rows ?? [0];
  const layers = opts.layers ?? [0, 1];
  const H = opts.H ?? 1080;
  const queueKey = opts.queueKey ?? QUEUE_KEY;
  const hatch = opts.hatch ?? 10;
  const heroHatch = opts.heroHatch ?? 13;
  const solidOutside = opts.solidOutside ?? 26;
  /** 这几个是 `section()` 会用到的默认色名（显式传了就不检查） */
  const defColor = {
    side: opts.color ?? 'slab',
    top: opts.topColor ?? (opts.color ?? 'slabHi'),
    edge: opts.edgeColor ?? 'bone',
    edgeBack: opts.edgeColor ?? 'ash',
  };
  const missing = [...new Set(Object.values(defColor))].filter((n) => !opts.P?.[n]);
  if (opts.P && missing.length) {
    throw new Error(
      `makeBlocksKit: 调色板里缺少 ${missing.map((n) => `"${n}"`).join(' / ')}。`
      + `在 task.config.mjs 的 palette 里加上它们（或用 section(..., { color, topColor, edgeColor }) 显式指定）。`
      + `当前可用：${Object.keys(opts.P).join(' / ')}`,
    );
  }

  /**
   * 一节 section 的中心点（世界坐标，y 向上）。
   * x / z 以原点为中心（`i, k ∈ −1..1` → `−cell / 0 / +cell`），y 从地面 0 开始往上堆。
   */
  function sectionCenter(i, j, k) {
    return [i * cell[0], j * cell[1] + cell[1] / 2, k * cell[2]];
  }

  /** 全部要画的 section（预生成，一次算好；`surf` = 是不是顶层）。 */
  const sections = (() => {
    const out = [];
    const top = layers[layers.length - 1];
    for (const j of layers) {
      for (const i of cols) {
        for (const k of cols) {
          out.push({ i, j, k, c: sectionCenter(i, j, k), surf: j === top });
        }
      }
    }
    return out;
  })();

  /** 按 (i,j,k) 取一节（写场景时点名用；取不到返回 `undefined`）。 */
  function sectionAt(i, j, k) {
    return sections.find((s) => s.i === i && s.j === j && s.k === k);
  }

  /** 世界 AABB：半尺寸 = cell × (列数一半, 层数, 列数一半)，中心在 (0, cell.y × 层数 / 2, 0)。 */
  const worldHalf = [
    (Math.max(...cols.map(Math.abs)) + 0.5) * cell[0],
    layers.length * cell[1] / 2,
    (Math.max(...cols.map(Math.abs)) + 0.5) * cell[2],
  ];
  const world = {
    center: [0, (layers.length * cell[1]) / 2, 0],
    half: worldHalf,
    outside: solidOutside,
  };

  /* ── 摄影机：一条走完全片的曲线 ─────────────────────────────────────── */

  const keys = expandKeys(opts.keys ?? [], opts.clock);
  if (keys.length === 0) {
    // 至少要有两个关键帧才谈得上"插值"；只给一个会让整片静止（不报错但一定不是本意）
    throw new Error('makeBlocksKit: keys 至少要有一个关键帧（建议首尾各一个）');
  }

  const camCache = new Map();
  /** 按绝对秒缓存 `camera3()` 的构造结果（同一帧会被 section / box / 面反复问到同一台机位）。 */
  function build(pos, tgt, fov, roll) {
    const k = `${pos[0].toFixed(6)},${pos[1].toFixed(6)},${pos[2].toFixed(6)}|${tgt[0].toFixed(6)},${tgt[1].toFixed(6)},${tgt[2].toFixed(6)}|${fov.toFixed(6)}|${roll.toFixed(6)}`;
    let c = camCache.get(k);
    if (!c) {
      c = camera3({ pos, target: tgt, fov, H, roll });
      if (camCache.size > 512) camCache.clear();   // 简单上限，避免长片里无限增长
      camCache.set(k, c);
    }
    return c;
  }

  /**
   * 整片任意时刻的摄影机（**纯函数**，跨切点连续）。
   * 相邻两个关键帧之间用 `smoothstep` 过渡（不是线性）—— 起停都软，
   * 而且**不依赖上一帧**，所以可以任意 seek、可以多子帧并行。
   * @param {number} t 整片绝对时间
   */
  function camAt(t) {
    const { a, b, k } = keySpan(keys, t);
    if (a === b) return build(a.pos, a.tgt, a.fov, a.roll);
    return build(
      [lerp(a.pos[0], b.pos[0], k), lerp(a.pos[1], b.pos[1], k), lerp(a.pos[2], b.pos[2], k)],
      [lerp(a.tgt[0], b.tgt[0], k), lerp(a.tgt[1], b.tgt[1], k), lerp(a.tgt[2], b.tgt[2], k)],
      lerp(a.fov, b.fov, k),
      lerp(a.roll, b.roll, k),
    );
  }

  /** 相机在世界里的位置（画视锥、算距离都要用）。 */
  function camPosAt(t) {
    return camAt(t).pos;
  }

  /**
   * 相机的朝向 —— **从画面深处指回相机**的单位向量（世界坐标）。
   *
   * ⚠ 这个符号很容易看反，所以把坐标系写死在这里：
   *   `camera3().fwd = normalize(tgt − pos)` 是**从相机指向它看的地方**（朝画面里）。
   *   本函数返回的是它的**取反**，也就是"从世界看向镜头"。为什么反过来：
   *   它给的是"**世界里的一个点**该怎么朝镜头铺一个锥/撒几条线"——
   *   例如站在世界中央的那个观察者，视线要朝**镜头**撒出去才落在画面里。
   *   （`frustumCone(ctx, cam, eye, dir)` 的 `dir` 就是这个语义。）
   *
   *   一开始我把它当成笔误、改成返回 `fwd`，结果锥体扣在了镜头上 ——
   *   `tools/test-blocks.mjs` 现在钉着这条：沿 `camDir` 走一步，**离世界原点的距离必须变大**
   *   （相机在世界外面，所以"朝镜头"就是"朝外"）。
   * @param {any} cam `camera3()` 的输出
   * @returns {number[]} 单位向量
   */
  function camDir(cam) {
    return [-cam.fwd[0], -cam.fwd[1], -cam.fwd[2]];
  }

  /**
   * 段内秒 → 整片绝对秒（本套件用的是 `opts.clock` 那张表）。
   * @param {string} id 段名 @param {number} at 段内秒
   */
  function toAbs(id, at) {
    return toAbsTime(opts.clock?.[id], at);
  }

  /** 相机是否还在世界外面（1 = 完全在外面）。见 `solidityAt`。 */
  function solidity(p) {
    return solidityAt(p, world);
  }

  /* ── 绘制 ──────────────────────────────────────────────────────────── */

  /**
   * 一节 section：朝镜头的 3 个面铺一层近实心排线（按 `faceTone` 分三档），再描只朝镜头的棱。
   *
   * ## `alpha` 到底控制什么（**这是本文件最容易被用错的一处**）
   *
   * | `alpha` | 结果 |
   * |---|---|
   * | `1` | 主角：满亮度、排线密、棱最粗 |
   * | `0.3 – 1` | **仍然完全不透明**，只是颜色被压暗（`tone = 0.22 + 0.78·a`）→ "退到后面去" |
   * | `0.012 – 0.17` | 开始真的淡出（出现 / 消失的过渡区） |
   * | `≤ 0.012` | 整节不画 |
   *
   * 也就是说"把背景那十几节压暗"应该**直接传小的 `alpha`**，那会同时把面铺满（不透明）
   * 和把颜色压暗 —— 这正是原型第一版做错的地方（它把 alpha 当"透明度"用，于是世界变成玻璃）。
   *
   * @param {any} ctx SceneCtx @param {any} cam
   * @param {{ i: number, j: number, k: number, c: number[], surf?: boolean }} s 一节
   * @param {{ alpha?: number, hero?: { i: number, j: number, k: number }, color?: string,
   *   topColor?: string, edgeColor?: string, tint?: number, tone?: number, hatch?: number,
   *   w?: number, fillK?: number, solidK?: number, minW?: number, heroColor?: string }} [opts]
   */
  function section(ctx, cam, s, opts2 = {}) {
    const a = opts2.alpha ?? 1;
    if (a <= 0.012) return;
    const P = ctx.P;
    const hs = [cell[0] / 2, cell[1] / 2, cell[2] / 2];
    const isHero = !!opts2.hero
      && opts2.hero.i === s.i && opts2.hero.j === s.j && opts2.hero.k === s.k;
    // 面的**底色**：侧面走 side、顶面走 top（比侧面亮一档，体积感全靠这一档）。
    // ⚠ 不要用太暗的颜色铺面（例如 graphite）：它铺满也等于没铺（见 `faceTone` 的说明）。
    // 默认名来自 `makeBlocksKit({ color / topColor / edgeColor })`（再默认到 slab / slabHi），
    // 缺失会在建套件时就抛错（见 `requireColor`），不会静默变成骨白。
    const sideC = opts2.color ?? defColor.side;
    const topC = opts2.topColor ?? (s.surf ? defColor.top : sideC);
    // 棱的颜色要比面亮，否则相邻两节会糊成一整块（它们本来就贴着）
    const edgeC = opts2.edgeColor ?? (s.surf ? defColor.edge : defColor.edgeBack);
    // ⚠ **整节共用一个排序深度**：面心与棱的中点深度会交错，不锁成同一个值的话，
    //   一节自己的**棱**会被它自己的**面**盖掉一半（棱看着像断的）。
    const dw = project3(cam, ctx.W, ctx.H, s.c[0], s.c[1], s.c[2]).w;

    // ① 面：半实心"积木"。面先提交、棱后提交 —— 描边总在面之上。
    const dx = s.c[0] - cam.pos[0], dy = s.c[1] - cam.pos[1], dz = s.c[2] - cam.pos[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    // ## 两个**互相独立**的旋钮，别把它们混成一个（§4.3）
    //
    // · `fillA`  = 「**在不在**」：`a ≥ FILL_FULL(0.17)` 就已经是 **1.0**（完全不透明）；
    //              只有 `a` 落在 `FILL_ZERO..FILL_FULL`（0.05–0.17）那段过渡里才不是 1。
    //              ⚠ 这里**没有**别的系数在往下压 alpha —— 尤其是**没有距离项**：
    //              "远处压暗"是 `tone` 的事（见下一条）。老实现把深度淡出乘进 alpha，
    //              于是远处那几十节**变成半透明**、后面的东西从排线缝里透出来，
    //              整片世界读成一块水晶（这就是 §4.3 那条纪律的出处）。
    // · `shade`  = 「**亮不亮**」：`a` 越小越暗（1.0 → TONE_FLOOR=0.22），远处再乘一层
    //              `depthTint(dl)`。"压暗一节"就是把它**画暗**，不是把它**画透**。
    const fillA = sat((a - FILL_ZERO) / (FILL_FULL - FILL_ZERO))
      * smoothstep(9, 26, dl)
      * (opts2.fillK ?? solidity(cam.pos));
    if (fillA > 0.02) {
      const vis = facesToward(cam, s.c, hs);
      const view = [dx / dl, dy / dl, dz / dl];
      // shade：a=1 ⇒ 1.0；a→0 ⇒ 0.22。再乘深度（远处整体压暗一档）
      const tint = (opts2.tint ?? (isHero ? 1.15 : 0.92))
        * (TONE_FLOOR + (1 - TONE_FLOOR) * sat(a))
        * depthTint(dl)
        * (opts2.tone ?? 1);
      const n = opts2.hatch ?? (isHero ? heroHatch : hatch);
      for (let f = 0; f < 6; f++) {
        if (!vis[f]) continue;
        const [o, u, v] = faceGeometry(s.c, hs, f);
        // 显式传了 `color` / `topColor` 就宽容（取不到回退骨白）；用默认名时**必须**存在，
        // 否则抛错并点名 —— 忘了在 palette 里加 `slab` 会让整片世界白得发亮，且不报错。
        const explicit = f === 2 ? (opts2.topColor ?? opts2.color) : opts2.color;
        const src = f === 2 ? topC : sideC;
        const base = explicit ? pickColor(P, src) : requireColor(P, src, f === 2 ? 'section 顶面' : 'section 侧面');
        const k = faceTone(FACE_NORMALS[f], view) * tint;
        hatchQuad(ctx, cam, o, u, v, n,
          [lerp(P.ink[0], base[0], k), lerp(P.ink[1], base[1], k), lerp(P.ink[2], base[2], k), fillA],
          0.05, {
            solid: true, dw,
            minW: opts2.minW ?? 1.6,
            solidK: opts2.solidK ?? SOLID_K,
            fade: false,          // ← 深度已经算进 `tint` 了；不要让它再改一次 alpha
          });
      }
    }

    // ② 棱：只画朝镜头那 3 个面的棱。alpha 走 `a^0.6`（线性算的话背景会散成几片玻璃板，
    //    连盒子边界都看不出来 —— 开方之后背景仍有轮廓，主次还在）。
    //    ⚠ 这里的 alpha 是**刻意的**：它是"这一节的边该多实"，属于 §4.3 里"出现/消失"那一类
    //      （轮廓降到 0.7 是"退到后面"的手段，不是"压暗"的手段）。远处压暗走 `fade`（tone）。
    const ea = Math.pow(clamp(a, 0, 1), 0.6);
    box3(ctx, cam, s.c, hs,
      [...pickColor(P, edgeC), (isHero ? 1 : s.surf ? 0.92 : 0.7) * ea],
      isHero ? 0.16 : (opts2.w ?? 0.08),
      // `dw` 是排序用的深度，**不能**拿它算 `depthTint`（相机身后时它是负的）——
      // 所以这里让 `seg3` 用每条棱自己的深度（默认行为）来压暗。
      { minW: isHero ? 1.9 : s.surf ? 1.4 : 1.0, dw });
    // ③ 主角：外面再套一圈更粗的边（同屏十几个盒子时，眼睛要有一个落点）
    if (isHero) {
      box3(ctx, cam, s.c, [hs[0] + 0.4, hs[1] + 0.4, hs[2] + 0.4],
        [...pickColor(P, opts2.heroColor ?? 'signal', 'signal'), 0.95 * a],
        0.16, { minW: 1.6, dw });
    }
  }

  return {
    /* 配置（只读） */
    cell, cols, rows, layers, world, sections, keys, clock: opts.clock ?? {},
    /* 几何 */
    sectionCenter, sectionAt,
    /* 摄影机 */
    camAt, camPosAt, camDir, toAbs, solidity,
    /* 绘制 */
    section, ground, playerMarker, frustumCone, beam, orb, solidBox, box3, hatchQuad, seg3,
    /* 深度队列 */
    flush: (ctx) => flush(ctx, queueKey),
    sortByDepth, facesToward, faceTone, visibleEdges, faceGeometry,
  };
}

/* ═══════════════════════════════════════════════ 小工具（确定性；别用 Math.random） */

/** 一个确定性的抖动（`hash1` 播种）—— 给"很多个一样的东西"加个体差异。 */
export function jitter(i, k = 0, amp = 1) {
  return (hash1(i * 131.7 + k * 17.3) - 0.5) * 2 * amp;
}

/** 这一帧要不要画某样东西（按整片时间的窗口函数，两端各用 `fade` 秒平滑进出）。 */
export function win(t, a, b, fade = 0.4) {
  return sat((t - a) / fade) * sat((b - t) / fade);
}

/** 阶梯式出现：第 n 个元素在 `t0 + n*step` 之后用 `dur` 秒出现（0..1）。 */
export function step(t, t0, n, stepS = 0.18, dur = 0.45) {
  return sat((t - t0 - n * stepS) / dur);
}

/** 常用数学的转发：写场景时少 import 一行（`clamp / sat / lerp / smoothstep`）。 */
export { clamp, sat, lerp, smoothstep };
