// blocks.js 的离线单测（纯 JS，**不需要 GPU / 浏览器 / 渲染命令**）。
//
// 为什么要有这个文件：这一层是从两支任务各自的 `_world.js` 里抽出来的，而其中
// **同一个 bug 被抄了两遍**（`docs/history/IMPROVEMENTS-4-5.md` §4.2）：
// `facesToward()` 的判据写成了 `dot(面心 − 相机, 法线) > 0`，那是**背面**的条件 ——
// 于是顶面（+y）从来没被铺过，整片世界读成一块半透明水晶。它不报错、不崩溃，
// `anim check` 也查不出来，只能靠看图 + 量数字（§7：「不报错但画面全错」比报错贵得多）。
//
// 所以这个文件把五件事钉死：
//   ① `facesToward` 在**已知朝向**的正反用例上都对（含"老写法会给出相反答案"的断言）；
//   ② 深度排序确实是**远 → 近**（画家算法：近的后画、压在上面）；
//   ③ 世界切片生成了预期数量的 section（每个都要有中心点，只有顶层带 `surf`）；
//   ④ 摄影机关键帧"按段名 + 段内秒"换算出来的绝对秒正确，插值是纯函数、段外取端值；
//   ⑤ §4.2 / §4.3 那两个**后果**级的性质：顶面真的被铺、alpha 只压暗不改透明度。
//
// 跑法：`node tools/test-blocks.mjs`（全绿时退出码 0）。
import { strict as A } from 'node:assert';
import { camera3, project3 } from '../src/core/cam.js';
import {
  facesToward, sortByDepth, byDepth, expandKeys, keySpan, toAbsTime,
  makeBlocksKit, faceGeometry, visibleEdges, solidityAt, faceTone,
  hatchQuad, seg3, flush, box3, QUEUE_KEY, PENDING, depthTint,
} from '../src/kit/blocks.js';
// 第 ⑥ 节测的是 2D 面板层（`src/kit/panel.js`）—— 它与 blocks 共享同一条纪律
// 「alpha 管在不在，tone 管亮不亮」，所以放在同一份测试里跑。
import {
  col, toneColor, mixToInk, shadeOf, chipLayout, panelBox, tile, tileRow,
  chips, arrowH, bufBox, hatchBox, meter, tag2, jitter, win, step,
} from '../src/kit/panel.js';

let n = 0;
function ok(name, fn) { fn(); n++; console.log(`  ✓ ${name}`); }
function near(a, b, eps, what) {
  A.ok(Math.abs(a - b) <= eps, `${what}: 期望 ${b} ± ${eps}，实际 ${a}`);
}
function eqSet(got, want, what) {
  A.deepEqual([...got].sort((x, y) => x - y), [...want].sort((x, y) => x - y), what);
}
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

/**
 * 这一镜里，"被铺的那一节"的深度淡出系数（`depthTint`）。
 * 填充不透明度 = `fillA`（在不在），而颜色里还乘着这一项（亮不亮）—— 两者**必须分开断言**。
 * @param {any} cam @param {any} kit
 */
function fadeFactorAt(cam, kit) {
  const s = kit.sections.find((x) => x.i === 0 && x.j === 1 && x.k === 0);
  return depthTint(project3(cam, W, H, s.c[0], s.c[1], s.c[2]).w);
}

/* ═══════════════════════════════════════════ 假 ctx / 假 LineBatch */
//
// 用它把整条绘制路径跑一遍（**不碰 GPU**）：`_push` 是 LineBatch 唯一的出口，
// 所以只要记下每次 `_push` 的参数，就能断言"谁先被提交、什么颜色、多宽、什么深度"。
//
// `blocks.js` 在排水前会把这一条的**世界坐标与深度**写进模块级的 `PENDING` 槽位
// （那是引擎里唯一一处"给测试看"的字段，引擎自己不读它）—— 于是"这条排线落在世界的
// 哪个平面上"也可以断言（顶面铺没铺 = §4.2 那个 bug 的后果）。
// ⚠ 断言前要**拷贝**槽位里的值：槽位会被下一条覆盖，而数组是同一个引用。
//
// `FakeLineBatch` 的**形状**要与真 `LineBatch` 一致：`_push` 在**原型**上（所以
// `delete L._push` 之后它自己会重新可见）、`flush` 是**自有**方法。
// 形状不一致的话，"钩子摘干净了没有"这类断言会得出错误结论（实测踩过一次）。
/**
 * 记下"这一条是**哪个方法**提交的"（`seg` / `rect` / `polyline` / `fill`）。
 *
 * 为什么需要它：桩只有一个出口 `_push`，而"面板的边框算不算填充"这类问题
 * **不能靠颜色分类**（`graphite` 的边框在 `isFill()` 的判据下会被算成底板，
 * 实测把"边框 4 段"整段吃掉，于是 `pushed.length - fills.length` 从 12 变成 8）。
 * 用方法名标记就是确定的。
 */
let SRC = 'seg';
class FakeLineBatch {
  constructor() { this.pushed = []; }
  _push(ax, ay, bx, by, width, color) {
    this.pushed.push({
      src: SRC,
      ax, ay, bx, by, width,
      color: [color[0], color[1], color[2]],
      alpha: color[3] ?? 1,
      lum: color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722,
      w: PENDING.w,
      a3: PENDING.a3 ? [...PENDING.a3] : null,
      b3: PENDING.b3 ? [...PENDING.b3] : null,
    });
    return this;
  }
  flush() { return this.pushed.length; }
  begin() { return this; }
  count() { return this.pushed.length; }
  seg(ax, ay, bx, by, width = 1, color = [1, 1, 1]) {
    SRC = 'seg';
    return this._push(ax, ay, bx, by, width, color);
  }
  /** 真 `LineBatch.polyline`（gl.js）：逐段展开，`closed` 时补最后一段回到起点 */
  polyline(pts, width = 1, color = [1, 1, 1], closed = false) {
    SRC = 'polyline';
    for (let i = 0; i + 1 < pts.length; i++) {
      this._push(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], width, color);
    }
    const n = pts.length;
    if (closed && n > 1) this._push(pts[n - 1][0], pts[n - 1][1], pts[0][0], pts[0][1], width, color);
    return this;
  }
  /** 真 `LineBatch.rect` = 四条边的闭合折线（gl.js:1233）—— 这里直接展开，不再转 `polyline()`
   *  （转一次会把"谁提交的"标成 `polyline`，于是 `bySrc('rect')` 恒为 0）。 */
  rect(x, y, w, h, width = 1, color = [1, 1, 1]) {
    SRC = 'rect';
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      this._push(p[0], p[1], q[0], q[1], width, color);
    }
    return this;
  }
  /**
   * 真 `LineBatch.fillRect` 是**逐行画横线**（gl.js:1253，`step` 默认 2px）——
   * 桩必须照同样的方式展开，否则"面板底板铺了几条、alpha 是多少"这类断言会和真渲染对不上。
   */
  fillRect(x, y, w, h, color = [1, 1, 1], step = 2) {
    if (!(w > 0) || !(h > 0)) return this;
    SRC = 'fill';
    const s = Math.max(0.5, step);
    const n = Math.max(1, Math.ceil(h / s));
    const dy = h / n;
    for (let i = 0; i < n; i++) {
      const yy = y + i * dy + dy * 0.5;
      this._push(x, yy, x + w, yy, dy + 0.5, color);
    }
    return this;
  }
}

function makeFakeCtx() {
  const lines = new FakeLineBatch();
  const ctx = {
    W, H, lines, P: PALETTE, f: { idx: 1, t: 0, lt: 0 },
    /** 本帧的 3D 队列（flush 之前可以看里面有什么） */
    queue: () => (ctx[QUEUE_KEY] ?? []),
  };
  return ctx;
}

const W = 1920, H = 1080;
/**
 * 站在 `pos` 看向 `target` 的相机。
 *
 * ⚠ 轴对齐用例**不要把 target 放在世界原点**：`camera3` 的 `up = cross(right, fwd)`，
 * 而 `fwd` 沿 ±y 时它与 worldUp 平行、叉积退化成 0 向量（引擎会 `|| 1` 兜住，不报错，
 * 但基座就废了）。所以竖直机位一律斜着给 target —— 这也是写场景时的常识。
 */
const camAt = (pos, target) => camera3({ pos, target, fov: 45, H });

const PALETTE = {
  ink: [0.01, 0.01, 0.01], bone: [0.9, 0.88, 0.85], ash: [0.55, 0.54, 0.52],
  graphite: [0.3, 0.3, 0.3], signal: [1.0, 0.3, 0.07],
  slab: [0.07, 0.11, 0.16], slabHi: [0.2, 0.35, 0.45],
  // ⚠ `ink2` 必须与 `ink` **不同**：面板底板是 `mixToInk(ink, ink2, tone)`，
  //   两者相等时"压暗"就是个恒等变换（实测让"压暗必须真的更暗"那条断言拿到两个一样的亮度）。
  ink2: [0.07, 0.07, 0.08],
};

console.log('blocks.js 离线单测');

/* ═══════════════════════════════════════════ ① facesToward：正反用例 */
//
// 面序号约定（`FACE_NORMALS`）：0 +x / 1 −x / 2 +y / 3 −y / 4 +z / 5 −z
const C = [0, 0, 0];           // 盒子中心
const HS = [1, 1, 1];          // 半尺寸 1（2×2×2 的盒子）

ok('相机在 +x 侧 ⇒ 只有 +x 面朝镜头（且轴对齐机位恒好 3 个面）', () => {
  // ⚠ 机位**不能和某个面共面**（`cam.pos` 的某个分量恰好等于面所在坐标）：那时点积为 0，
  //    `> 0` 的严格判据会把它判成背面 —— 于是只剩 2 个面。轴对齐用例也一律斜一点点。
  const vis = facesToward(camAt([10, 3, 4], [0, 0, 0]), C, HS);
  A.equal(vis.length, 6, '必须返回 6 个面');
  A.equal(vis.filter(Boolean).length, 3, '轴对齐机位下恰好 3 个面朝镜头');
  A.equal(vis[0], true, '+x 面必须朝镜头');
  A.equal(vis[1], false, '−x 面必须背对镜头');
  eqSet(vis.flatMap((v, i) => (v ? [i] : [])), [0, 2, 4], '应该是 +x / +y / +z');
});

ok('相机在 −x 侧 ⇒ 只有 −x 面朝镜头', () => {
  const vis = facesToward(camAt([-10, 3, 4], [0, 0, 0]), C, HS);
  A.equal(vis[1], true, '−x 面必须朝镜头');
  A.equal(vis[0], false, '+x 面必须背对镜头');
  A.equal(vis.filter(Boolean).length, 3, '恒好 3 个面');
});

ok('相机在 +y 侧 ⇒ **顶面（+y）朝镜头**（老写法的直接受害者）', () => {
  // ⚠ target 也必须斜一点：正上方看原点时 `camera3` 的 up 会退化（见 camAt 的注释）
  const vis = facesToward(camAt([2, 10, 3], [0, 0, 0]), C, HS);
  A.equal(vis[2], true, '顶面 +y 必须朝镜头 —— 老写法在这里恒为 false（§4.2）');
  A.equal(vis[3], false, '底面 −y 必须背对镜头');
  A.equal(vis.filter(Boolean).length, 3, '恒好 3 个面');
});

ok('相机在 −y 侧 ⇒ 底面（−y）朝镜头', () => {
  const vis = facesToward(camAt([2, -10, 3], [0, 0, 0]), C, HS);
  A.equal(vis[3], true, '底面朝镜头');
  A.equal(vis[2], false, '顶面背对镜头');
});

ok('相机在 +z / −z 侧 ⇒ +z / −z 面分别朝镜头', () => {
  const pz = facesToward(camAt([2, 3, 10], [0, 0, 0]), C, HS);
  A.equal(pz[4], true, '+z');
  A.equal(pz[5], false, '−z');
  const nz = facesToward(camAt([2, 3, -10], [0, 0, 0]), C, HS);
  A.equal(nz[5], true, '−z');
  A.equal(nz[4], false, '+z');
});

ok('相机与某个面共面时，那个面判为可见（点积 = 0 的边界，老写法同样是边界）', () => {
  // `cam.pos.y === 面心 y` ⇒ 点积恰好为 0。判据用 `> 0`，所以算"背面"。
  // 这是**刻意的边界**：共面意味着这个面在屏幕上是**一条线**，铺不铺都一样。
  // 把它写在这里是为了"别哪天有人把 `> 0` 改成 `>= 0` 而没人知道会变什么"。
  const vis = facesToward(camAt([10, 0, 4], [0, 0, 0]), C, HS);
  A.equal(vis[2], false, 'y 分量恰好为 0 ⇒ 顶面点积为 0 ⇒ 判为不可见（边界）');
  A.equal(vis[3], false, '底面同理');
  A.equal(vis[0], true, '但 +x 仍然是可见的');
});

ok('斜机位：8 个卦限各恰好 3 个面朝镜头，且与机位符号一致', () => {
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const vis = facesToward(camAt([sx * 9, sy * 7, sz * 8], [0, 0, 0]), C, HS);
        A.equal(vis.filter(Boolean).length, 3, `卦限 (${sx},${sy},${sz}) 应该恰好 3 个面`);
        A.equal(vis[sx > 0 ? 0 : 1], true, `x 方向的面 (${sx})`);
        A.equal(vis[sy > 0 ? 2 : 3], true, `y 方向的面 (${sy})`);
        A.equal(vis[sz > 0 ? 4 : 5], true, `z 方向的面 (${sz})`);
      }
    }
  }
});

ok('判据用的是**面心**而不是盒子中心（细长盒子上两者会给出不同答案）', () => {
  const h = [1, 1, 4];                                   // 沿 z 很长
  const vis = facesToward(camAt([6, 5, -8], [0, 0, -3]), C, h);
  A.equal(vis[0], true, '+x 面（面心 (1,0,0)）朝相机');
  A.equal(vis[5], true, '−z 面（面心 (0,0,−4)）朝相机那一侧');
  A.equal(vis[4], false, '+z 的远端面（面心 (0,0,4)）背对相机');
  A.equal(vis[3], false, '底面（面心 (0,−1,0)）在相机下方 ⇒ 背对');
  A.equal(vis.filter(Boolean).length, 3, '斜机位仍然恰好 3 个面');
});

ok('**老写法（dot(面心 − 相机) > 0）会给出完全相反的答案** —— 这就是那个 bug', () => {
  const cam = camAt([10, 6, 8], [0, 0, 0]);
  const good = facesToward(cam, C, HS);
  const bad = [];                                  // 逐字照抄老代码（tasks/sodium 版至今如此）
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let f = 0; f < 6; f++) {
    const [o, u, v] = faceGeometry(C, HS, f);
    const px = o[0] + (u[0] + v[0]) * 0.5 - cam.pos[0];
    const py = o[1] + (u[1] + v[1]) * 0.5 - cam.pos[1];
    const pz = o[2] + (u[2] + v[2]) * 0.5 - cam.pos[2];
    bad.push(px * N[f][0] + py * N[f][1] + pz * N[f][2] > 0);
  }
  A.deepEqual(bad.map((b) => !b), good, '正确写法必须**逐面等于**老写法的取反');
  A.equal(bad[2], false, '老写法下顶面恒为 false —— 顶面从来没被铺过');
  A.equal(good[2], true, '正确写法下顶面为 true');
});

ok('facesToward 是纯函数：同输入同输出，且不改动入参', () => {
  const cam = camAt([3, 4, 5], [0, 0, 0]);
  const c = [1, 2, 3];
  const h = [1, 2, 3];
  A.deepEqual(facesToward(cam, c, h), facesToward(cam, c, h), '同输入同输出');
  A.deepEqual(c, [1, 2, 3], '中心没被改');
  A.deepEqual(h, [1, 2, 3], '半尺寸没被改');
});

ok('visibleEdges：恰好 9 条棱可见（12 条里去掉 3 条全背面的）', () => {
  const e = visibleEdges(facesToward(camAt([10, 8, 9], [0, 0, 0]), C, HS));
  A.equal(e.length, 9, `朝镜头 3 个面围出 9 条棱，实际 ${e.length}`);
  A.equal(new Set(e).size, 9, '不能重复');
  A.ok(e.length < 12, '绝不能把 12 条全画出来（那是"铁丝笼子"）');
});

ok('faceGeometry：六个面的**面心**与**法线**必须严格配对（这张表的唯一实质约定）', () => {
  // ⚠ 这张表有一个容易误解的地方，钉在这里免得后人"顺手修正"：
  //   `u × v` 的朝向**不成对**（面 0/1 都是 −x、面 2/3 都是 −y、面 4/5 都是 +z）——
  //   老代码就是照抄的，谁也没有依赖过它。真正被依赖的只有两件事：
  //     ① 面心 = `中心 + FACE_NORMALS[f] × 半尺寸`；② 六个法线两两相反、逐轴单位。
  //   `hatchQuad` 只用面上的点铺线，**不关心绕向**，所以这个"不成对"无害；
  //   但如果哪天有人想靠 u×v 做背面剔除，他会得到错的答案 —— 所以这里显式记一笔。
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const c = [3, -2, 7];
  const h = [2, 4, 5];
  for (let f = 0; f < 6; f++) {
    const [o, u, v] = faceGeometry(c, h, f);
    const [baseO] = faceGeometry([0, 0, 0], [1, 1, 1], f);
    for (let d = 0; d < 3; d++) {
      A.ok(Math.abs(baseO[d]) === 1, `单位盒的 o 每个分量只能是 ±1（面 ${f} 第 ${d} 维）`);
      near(o[d] + (u[d] + v[d]) * 0.5, c[d] + N[f][d] * h[d], 1e-12,
        `面 ${f} 的面心第 ${d} 维必须落在"中心 + 法线 × 半尺寸"上`);
    }
    // 面必须是**单位盒的一个面**：u、v 各自只在一个轴上有非零分量，长度 = 2×该轴半尺寸
    const nz = (w) => w.filter((x) => Math.abs(x) > 1e-12).length;
    A.equal(nz(u), 1, `面 ${f} 的 u 只能沿一个轴`);
    A.equal(nz(v), 1, `面 ${f} 的 v 只能沿一个轴`);
    A.ok(Math.hypot(...u) === 2 * h[u.findIndex((x) => Math.abs(x) > 1e-12)], `面 ${f} 的 u 长度`);
    A.ok(Math.hypot(...v) === 2 * h[v.findIndex((x) => Math.abs(x) > 1e-12)], `面 ${f} 的 v 长度`);
  }
  // 六个法线两两相反（逐分量比 —— `-0 !== 0` 会让 deepEqual 误报）
  for (let f = 0; f < 6; f += 2) {
    for (let d = 0; d < 3; d++) {
      near(N[f + 1][d], -N[f][d], 0, `面 ${f} / ${f + 1} 的法线第 ${d} 维必须相反`);
    }
  }
});

ok('faceTone：三个可见面天然分成三档（"这是一块积木"的全部依据）', () => {
  const view = [0.6, 0.5, 0.62];
  const top = faceTone([0, 1, 0], view);
  const front = faceTone([0, 0, 1], view);
  const side = faceTone([1, 0, 0], view);
  A.ok(top > front && front > side,
    `顶面 > 正面 > 侧面（实际 ${top.toFixed(3)} / ${front.toFixed(3)} / ${side.toFixed(3)}）`);
  A.ok(side > 0.4, '最暗的一档也不能低于 0.4（低了就"铺满等于没铺"）');
  A.ok(top < 1.3, '最亮的一档也不能过曝');
});

/* ═══════════════════════════════════════════ ② 深度排序：远 → 近 */
//
// 画家算法：**远的先提交**，近的后画压在上面。`project3` 的 `w` 是相机空间深度。
ok('sortByDepth：远的在前、近的在后（画家算法方向）', () => {
  const q = [{ w: 3 }, { w: 40 }, { w: 12 }, { w: 0.5 }, { w: 100 }];
  const s = sortByDepth(q);
  for (let i = 1; i < s.length; i++) {
    A.ok(s[i - 1].w >= s[i].w, `必须单调不增：${s[i - 1].w} → ${s[i].w}`);
  }
  A.equal(s[0].w, 100, '最远的排第一（最先画）');
  A.equal(s[s.length - 1].w, 0.5, '最近的排最后（最后画 = 压在最上面）');
  eqSet(q.map((x) => x.w), [3, 40, 12, 0.5, 100], '不能改动入参');
});

ok('byDepth 就是"远的排前面"（等价于 w 降序）', () => {
  A.ok(byDepth({ w: 10 }, { w: 2 }) < 0, 'w 大的排前面');
  A.ok(byDepth({ w: 2 }, { w: 10 }) > 0, 'w 小的排后面');
  A.equal(byDepth({ w: 5 }, { w: 5 }), 0, '等深度返回 0（稳定排序保持提交顺序）');
});

ok('等深度保持原提交顺序（同节内"面先棱后"全靠这条）', () => {
  const q = [{ w: 5, tag: 'face' }, { w: 5, tag: 'edge' }, { w: 9, tag: 'far' }, { w: 5, tag: 'edge2' }];
  const s = sortByDepth(q);
  A.equal(s[0].tag, 'far', '最远的先画');
  A.deepEqual(s.slice(1).map((x) => x.tag), ['face', 'edge', 'edge2'], '等深度保持提交顺序');
});

ok('端到端：两个盒子的提交顺序 = 远 → 近', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 30], [0, 0, 0]);
  ctx.lines.begin();
  box3(ctx, cam, [0, 0, 10], 1, [1, 1, 1], 0.05, { hide: false });    // 离相机 20
  box3(ctx, cam, [0, 0, -10], 1, [1, 1, 1], 0.05, { hide: false });   // 离相机 40
  A.equal(ctx.lines.count(), 0, 'flush 之前一条都不该写进批（都在队列里）');
  A.equal(ctx.queue().length, 24, '2 个盒子 × 12 条棱都在队列里');
  A.equal(flush(ctx), 24, 'flush 返回这一次排了多少条');
  A.equal(ctx.queue().length, 0, '排完水队列应该空');
  A.equal(ctx.lines.count(), 24, '24 条都提交了');
  const ws = ctx.lines.pushed.map((r) => r.w);
  const farAvg = avg(ws.slice(0, 12));
  const nearAvg = avg(ws.slice(12));
  A.ok(farAvg > nearAvg,
    `远的先画：前 12 条平均深度 ${farAvg.toFixed(1)} 应 > 后 12 条 ${nearAvg.toFixed(1)}`);
  for (let i = 1; i < ws.length; i++) {
    A.ok(ws[i - 1] >= ws[i] - 1e-9, `提交深度必须单调不增（第 ${i} 条：${ws[i - 1]} → ${ws[i]}）`);
  }
});

ok('钩子：屏幕层的线会**先把 3D 队列排掉**（顺序不会倒过来）', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 30], [0, 0, 0]);
  ctx.lines.begin();
  box3(ctx, cam, [0, 0, 10], 1, [1, 1, 1], 0.05, { hide: false });    // 近
  box3(ctx, cam, [0, 0, -10], 1, [1, 1, 1], 0.05, { hide: false });   // 远
  A.equal(ctx.lines.count(), 0, '两条 box3 之后队列里还压着 24 条');
  A.equal(ctx.queue().length, 24, '队列里 24 条');
  ctx.lines.seg(5, 7, 105, 107, 2, [1, 1, 1]);                        // 屏幕层：HUD（坐标带零头，便于辨认）
  A.equal(ctx.lines.count(), 25, '屏幕层线出现时必须先把 24 条 3D 线排掉，再加自己');
  const screen = ctx.lines.pushed.filter((r) => r.ax === 5 && r.ay === 7 && r.bx === 105 && r.by === 107);
  A.equal(screen.length, 1, '屏幕层那条必须**恰好提交一次**');
  A.equal(ctx.lines.pushed.indexOf(screen[0]), 24, '它必须是**最后**一条（3D 都被排到它前面了）');
  A.equal(screen[0].w, null, '屏幕层没有 3D 深度（meta 必须是空的）');
  flush(ctx);
  A.equal(ctx.lines.count(), 25, '再 flush 不应重复提交');
});

ok('钩子会被摘掉：本帧结束后 lines._push / flush 不再挂着排序包装', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 30], [0, 0, 0]);
  const rawPush = ctx.lines._push;
  const rawFlush = ctx.lines.flush;
  ctx.lines.begin();
  box3(ctx, cam, [0, 0, 0], 1, [1, 1, 1], 0.05, { hide: false });
  A.ok(ctx.lines._push !== rawPush, '有 3D 线时应该挂着排序钩子');
  A.equal(ctx.lines._push.name, 'blocksSortedPush', '挂上的是排水包装');
  flush(ctx);
  // ⚠ 真 `LineBatch` 上 `_push` 是**原型方法**、`flush` 是**自有方法**，而 `delete` 只删自有属性
  //   —— 所以"退回原型"在两者上的表现不同（`_push` 的自有属性没了，原型那个重新可见）。
  //   判据取"不再挂着排水包装"，两种对象形状都成立。
  A.equal(ctx.lines._push, FakeLineBatch.prototype._push, '_push 必须退回原型方法');
  A.notEqual(ctx.lines.flush, undefined, 'flush 必须还能用');
  A.notEqual(ctx.lines.flush.name, 'blocksSortedFlush', 'flush 必须摘掉排水包装');
  A.equal(ctx.queue().length, 0, '队列已经排空');
  // 摘掉之后再提交一条屏幕层线，也不该抛错、也不该被当成 3D
  ctx.lines.seg(1, 2, 3, 4, 1, [1, 1, 1]);
  A.equal(ctx.lines.pushed[ctx.lines.pushed.length - 1].w, null, '脱钩之后屏幕层线照常提交');
});

/* ═══════════════════════════════════════════ ③ 世界切片 */
/** 默认切片：3×3 列 × 2 层 = 18 节（原型 optifine 那一版） */
const KIT = makeBlocksKit({ P: PALETTE, keys: [{ at: 0, pos: [0, 0, 30], tgt: [0, 0, 0], fov: 45 }] });

ok('世界切片：3×3×2 = 18 节，且每节都有中心点', () => {
  A.equal(KIT.sections.length, 18, `3 列 × 3 列 × 2 层 = 18，实际 ${KIT.sections.length}`);
  for (const s of KIT.sections) {
    A.ok(Array.isArray(s.c) && s.c.length === 3, `(${s.i},${s.j},${s.k}) 必须有中心点`);
    A.ok(s.c.every(Number.isFinite), '中心点必须是有限值');
  }
  A.equal(new Set(KIT.sections.map((s) => `${s.i},${s.j},${s.k}`)).size, 18, '不能有重复的 (i,j,k)');
});

ok('世界切片：只有顶层带 surf，且顶层恰好是 9 节', () => {
  const surf = KIT.sections.filter((s) => s.surf);
  A.equal(surf.length, 9, '顶层 = 3×3 = 9 节');
  A.ok(surf.every((s) => s.j === 1), 'surf 只应该出现在 j=1（layers 的最后一层）');
  A.equal(KIT.sections.filter((s) => !s.surf).length, 9, '底下那层 9 节');
});

ok('世界切片：3×3×3 = 27 节（原型 sodium 那一版，cols / layers 可配）', () => {
  const k3 = makeBlocksKit({
    P: PALETTE, cols: [-1, 0, 1], layers: [0, 1, 2],
    keys: [{ at: 0, pos: [0, 0, 30], tgt: [0, 0, 0], fov: 45 }],
  });
  A.equal(k3.sections.length, 27, '3×3×3 = 27');
  A.equal(k3.sections.filter((s) => s.surf).length, 9, '顶层仍然是 9 节（j=2）');
});

ok('sectionCenter：x/z 以原点为中心，y 从地面往上堆', () => {
  near(KIT.sectionCenter(0, 0, 0)[0], 0, 0, 'i=0 → x=0');
  near(KIT.sectionCenter(0, 0, 0)[1], 8, 0, 'j=0 → y = cell/2 = 8');
  near(KIT.sectionCenter(0, 1, 0)[1], 24, 0, 'j=1 → y = 16 + 8 = 24');
  near(KIT.sectionCenter(-1, 0, 0)[0], -16, 0, 'i=-1 → x = -16');
  near(KIT.sectionCenter(0, 0, 1)[2], 16, 0, 'k=1 → z = 16');
});

ok('sectionAt 能点名叫到某一节；取不到的返回 undefined', () => {
  const s = KIT.sectionAt(-1, 1, 0);
  A.ok(s, '(−1,1,0) 应该存在');
  A.equal(s.surf, true, 'j=1 是顶层');
  A.equal(KIT.sectionAt(9, 9, 9), undefined, '不存在的坐标返回 undefined');
});

ok('世界 AABB 把整片切片包住（"相机在里面/在外面"靠它）', () => {
  const [, cy] = KIT.world.center;
  for (const s of KIT.sections) {
    for (let d = 0; d < 3; d++) {
      const lo = KIT.world.center[d] - KIT.world.half[d];
      const hi = KIT.world.center[d] + KIT.world.half[d];
      A.ok(s.c[d] - 8 >= lo - 1e-9 && s.c[d] + 8 <= hi + 1e-9,
        `(${s.i},${s.j},${s.k}) 的第 ${d} 维必须落在世界 AABB 里`);
    }
  }
  A.ok(KIT.world.half.every((h) => h > 0), '半尺寸必须为正');
  near(cy, 16, 1e-9, '2 层 ⇒ 世界中心高度 16');
});

ok('solidityAt：世界里面 = 0、远处 = 1、过渡单调', () => {
  A.equal(solidityAt([0, 16, 0], KIT.world), 0, '在中心 ⇒ 0（不铺面）');
  A.equal(solidityAt([0, 500, 0], KIT.world), 1, '很远 ⇒ 1（铺面）');
  let prev = -1;
  for (let d = 0; d <= 60; d += 2) {
    const v = solidityAt([d, 16, 0], KIT.world);
    A.ok(v >= prev - 1e-12, '随距离单调不减');
    A.ok(v >= 0 && v <= 1, '恒在 0..1');
    prev = v;
  }
});

/* ═══════════════════════════════════════════ ④ 摄影机关键帧：段名 + 段内秒 */
//
// 时钟表刻意用**非 1 的 stretch** —— 忘了乘 stretch 的实现会立刻在这里露馅。
const CLOCK = {
  hook: { start: 0.0, stretch: 1.0 },
  ctm: { start: 60.0, stretch: 1.05 },
  outro: { start: 200.0, stretch: 0.8 },
};
const KEYS = [
  { id: 'hook', at: 0.0, pos: [60, 60, -90], tgt: [0, 20, 10], fov: 42 },
  { id: 'hook', at: 8.0, pos: [40, 52, -78], tgt: [0, 18, 16], fov: 44 },
  { id: 'ctm', at: 0.0, pos: [-8, 32, -84], tgt: [0, 15, 4], fov: 48 },
  { id: 'ctm', at: 3.0, pos: [-4, 30, -80], tgt: [0, 15, 4], fov: 46 },
  { id: 'ctm', at: 19.0, pos: [-6, 31, -82], tgt: [0, 15, 4], fov: 48 },
  { id: 'outro', at: 12.0, pos: [0, 66, -122], tgt: [0, 20, 16], fov: 40 },
  { at: 300.0, pos: [0, 74, -134], tgt: [0, 24, 24], fov: 38 },       // 绝对秒（与段名混写）
];

ok('toAbsTime：绝对秒 = start + 段内秒 × stretch', () => {
  near(toAbsTime({ start: 60, stretch: 1.05 }, 3.0), 63.15, 1e-9, 'ctm 段内 3.0s');
  near(toAbsTime({ start: 200, stretch: 0.8 }, 12.0), 209.6, 1e-9, 'outro 段内 12.0s');
  near(toAbsTime({ start: 0, stretch: 1 }, 8.0), 8.0, 1e-9, 'hook');
  near(toAbsTime(undefined, 3.0), 3.0, 1e-9, '没有时钟表时按绝对秒用（向后兼容）');
  near(toAbsTime({}, 3.0), 3.0, 1e-9, '缺字段按 0 / 1 处理');
});

ok('expandKeys：按段名展开成绝对秒、按时间升序、绝对秒原样保留', () => {
  const k = expandKeys(KEYS, CLOCK);
  A.equal(k.length, KEYS.length, '不能丢帧');
  eqSet(k.map((x) => x.T), [0, 8, 60, 63.15, 79.95, 209.6, 300], '全部绝对秒');
  for (let i = 1; i < k.length; i++) A.ok(k[i].T >= k[i - 1].T, '必须升序');
  A.equal(k.find((x) => x.id === 'ctm' && x.at === 19.0).T, 79.95, 'ctm 段内 19.0s');
  A.equal(k.find((x) => x.id === null).T, 300, '绝对秒那条原样保留');
});

ok('keySpan：段外取端值、关键帧处恰好取到那一帧、中间走 smoothstep', () => {
  const k = expandKeys(KEYS, CLOCK);
  A.equal(keySpan(k, -50).a.T, 0, '开头之前取第一帧');
  A.equal(keySpan(k, -50).b.T, 0, '两端都是第一帧');
  A.equal(keySpan(k, 1e6).a.T, 300, '结尾之后取最后一帧');
  const mid = keySpan(k, (63.15 + 79.95) / 2);
  near(mid.a.T, 63.15, 1e-9, '中间落在 ctm 的两个关键帧之间');
  near(mid.b.T, 79.95, 1e-9, '中间落在 ctm 的两个关键帧之间');
  near(mid.k, 0.5, 1e-9, '正中间的 smoothstep 系数是 0.5');
  // ⚠ 关键帧**恰好落在区间端点上**时，`k` 是 0 还是 1 取决于取的是左边还是右边那段
  //   ——两种都插值到同一台机位。所以这里断言的是"值对不对"，不是"k 是几"。
  for (const key of k) {
    const here = keySpan(k, key.T);
    const v = lerp3(here.a.pos, here.b.pos, here.k);
    for (let d = 0; d < 3; d++) near(v[d], key.pos[d], 1e-9, `t=${key.T} 处必须恰好是这一帧的机位`);
  }
});

/** 三段线性插值（测试里自己算一遍，验证 `camAt` 的插值语义） */
function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

ok('camAt：关键帧时刻取到原值（段名 + 段内秒换算正确）', () => {
  const B = makeBlocksKit({ P: PALETTE, clock: CLOCK, keys: KEYS });
  for (const k of expandKeys(KEYS, CLOCK)) {
    const cam = B.camAt(k.T);
    for (let d = 0; d < 3; d++) near(cam.pos[d], k.pos[d], 1e-9, `t=${k.T} 相机位置第 ${d} 维`);
    near(cam.focal, (H * 0.5) / Math.tan((k.fov * Math.PI) / 360), 1e-9, 'fov 换算成焦距');
  }
});

ok('camAt：段内 3.0s 的机位出现在整片 63.15s（**不是** 63.0s）', () => {
  const B = makeBlocksKit({ P: PALETTE, clock: CLOCK, keys: KEYS });
  const at = B.camAt(63.15);
  near(at.pos[0], -4, 1e-9, 'ctm at=3.0 的 x');
  near(at.pos[1], 30, 1e-9, 'ctm at=3.0 的 y');
  near(at.pos[2], -80, 1e-9, 'ctm at=3.0 的 z');
  const wrong = B.camAt(63.0);      // ← "忘了乘 stretch"的探针
  A.ok(Math.abs(wrong.pos[0] - (-4)) > 1e-3, `63.0s 处不该等于 at=3.0 的机位（实际 x=${wrong.pos[0]}）`);
});

ok('camAt：段外取端值、跨切点连续（纯函数，可任意 seek）', () => {
  const B = makeBlocksKit({ P: PALETTE, clock: CLOCK, keys: KEYS });
  A.deepEqual(B.camAt(-100).pos, B.camAt(0).pos, '开头之前 = 第一帧');
  A.deepEqual(B.camAt(1e6).pos, B.camAt(300).pos, '结尾之后 = 最后一帧');
  A.deepEqual(B.camAt(63.15), B.camAt(63.15), '同 t 同结果');
  let maxStep = 0;
  let prev = B.camAt(0);
  for (let i = 1; i <= 300 * 60; i++) {
    const c = B.camAt(i / 60);
    maxStep = Math.max(maxStep, Math.hypot(
      c.pos[0] - prev.pos[0], c.pos[1] - prev.pos[1], c.pos[2] - prev.pos[2]));
    prev = c;
  }
  A.ok(maxStep < 1.5, `每 1/60 秒的位移必须很小（实测峰值 ${maxStep.toFixed(3)} 世界单位）`);
});

ok('camAt：相邻帧之间走 smoothstep（不是线性）', () => {
  const two = makeBlocksKit({
    P: PALETTE,
    keys: [
      { at: 0.0, pos: [0, 0, 0], tgt: [0, 0, -1], fov: 40 },
      { at: 2.0, pos: [10, 0, 0], tgt: [0, 0, -1], fov: 60 },
    ],
  });
  near(two.camAt(1.0).pos[0], 5, 1e-9, '中点位置');
  // ⚠ `camAt` 返回的是 `camera3()` 的输出（`pos/right/up/fwd/focal`），**没有 `fov` 字段**
  //   —— fov 已经折算成 `focal` 了。断言 fov 要反算回来（`focal = (H/2)/tan(fov/2)`）。
  near(focalToFov(two.camAt(0.0).focal), 40, 1e-9, '起点取原值');
  near(focalToFov(two.camAt(1.0).focal), 50, 1e-9, '中点 fov（线性插值的两端）');
  near(focalToFov(two.camAt(2.0).focal), 60, 1e-9, '终点取原值');
  near(two.camAt(0.5).pos[0], 10 * 0.15625, 1e-9, '1/4 处的 smoothstep 值（线性会是 2.5）');
});

/** 焦距 → 竖直视场角（度），`H` 用本文件的 1080 —— 与 `camera3` 的换算互为逆 */
function focalToFov(focal) {
  return (2 * Math.atan((H * 0.5) / focal) * 180) / Math.PI;
}

ok('camDir：**从世界指向镜头**（= `camera3().fwd` 的取反），单位向量', () => {
  const B = makeBlocksKit({ P: PALETTE, keys: [{ at: 0, pos: [3, 4, 12], tgt: [0, 0, 0], fov: 45 }] });
  const cam = B.camAt(0);
  const d = B.camDir(cam);
  const L = Math.hypot(3, 4, 12);
  // `camera3().fwd = normalize(tgt − pos)` 是**朝画面里**的；`camDir` 是它的取反 ——
  // "世界里的一个点该怎么朝镜头铺一个锥"。原型就是这个符号，别去"修正"它（注释里写了）。
  near(cam.fwd[0], -3 / L, 1e-9, 'camera3 的 fwd 确实朝画面里');
  near(d[0], 3 / L, 1e-9, 'camDir x（朝镜头）');
  near(d[1], 4 / L, 1e-9, 'camDir y（朝镜头）');
  near(d[2], 12 / L, 1e-9, 'camDir z（朝镜头）');
  near(Math.hypot(d[0], d[1], d[2]), 1, 1e-9, '必须是单位向量');
  for (let i = 0; i < 3; i++) near(d[i], -cam.fwd[i], 0, `camDir 与 fwd 第 ${i} 维必须相反`);
  // 相机在世界外面 ⇒ "朝镜头"就是"朝外"：沿它走一步离原点更远
  const eye = cam.pos;
  const step = [eye[0] + d[0] * 2, eye[1] + d[1] * 2, eye[2] + d[2] * 2];
  const before = Math.hypot(eye[0], eye[1], eye[2]);
  const after = Math.hypot(step[0], step[1], step[2]);
  A.ok(after > before, `沿 camDir 走必须远离世界（${before.toFixed(2)} → ${after.toFixed(2)}）`);
  const q = project3(cam, W, H, 0, 0, 0);      // tgt 必须落在画面中心
  near(q.x, W / 2, 1e-6, 'tgt 的屏幕 x');
  near(q.y, H / 2, 1e-6, 'tgt 的屏幕 y');
});

ok('toAbs（套件上的）：用的就是 opts.clock 那张表', () => {
  const B = makeBlocksKit({ P: PALETTE, clock: CLOCK, keys: KEYS });
  near(B.toAbs('ctm', 3.0), 63.15, 1e-9, 'ctm');
  near(B.toAbs('outro', 12.0), 209.6, 1e-9, 'outro');
  near(B.toAbs('没这段', 3.0), 3.0, 1e-9, '未知段名按绝对秒（与 toAbsTime(undefined) 一致）');
});

ok('makeBlocksKit：没有 keys 会抛错（不静默出一台静止的机位）', () => {
  A.throws(() => makeBlocksKit({ P: PALETTE }), /至少要有一个关键帧/);
});

ok('makeBlocksKit：调色板缺 slab / slabHi 会抛错并点名（不静默变骨白）', () => {
  const bare = { ink: [0, 0, 0], bone: [1, 1, 1], ash: [0.5, 0.5, 0.5] };
  A.throws(
    () => makeBlocksKit({ P: bare, keys: [{ at: 0, pos: [1, 1, 1], tgt: [0, 0, 0] }] }),
    /slab/, '缺色名必须抛错',
  );
  A.doesNotThrow(
    () => makeBlocksKit({
      P: bare, color: 'bone', topColor: 'bone', edgeColor: 'bone',
      keys: [{ at: 0, pos: [1, 1, 1], tgt: [0, 0, 0] }],
    }),
    '显式指定了三个颜色就不该再要求 slab / slabHi',
  );
});

/* ═══════════════════════════════════════════ ⑤ §4.2 / §4.3 的"后果"级断言 */
ok('后果①：俯视机位下，被铺的面里必须有**顶面**（+y）', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 90, -40], [0, 10, 0]);          // 典型俯视机位
  const s = KIT.sections.find((x) => x.i === 0 && x.j === 1 && x.k === 0);
  ctx.lines.begin();
  KIT.section(ctx, cam, s, { alpha: 1, fillK: 1 });
  A.ok(ctx.queue().length > 0, '俯视下必须铺了东西');
  flush(ctx);
  const topY = s.c[1] + 8;                              // 顶面所在的世界高度
  const hasTop = ctx.lines.pushed.some(
    (r) => r.a3 && Math.abs(r.a3[1] - topY) < 1e-6 && Math.abs(r.b3[1] - topY) < 1e-6,
  );
  A.ok(hasTop, `必须有排线落在顶面 y=${topY} 上（老写法下顶面永远是空的）`);
});

ok('后果①：俯视机位下，三个可见面**都**被铺过（不是只铺侧面）', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([40, 80, -70], [0, 16, 0]);
  const s = KIT.sections.find((x) => x.i === 0 && x.j === 1 && x.k === 0);
  ctx.lines.begin();
  KIT.section(ctx, cam, s, { alpha: 1, fillK: 1 });
  flush(ctx);
  const hs = [8, 8, 8];
  const vis = facesToward(cam, s.c, hs);
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  let checked = 0;
  for (let f = 0; f < 6; f++) {
    if (!vis[f]) continue;
    const nrm = N[f];
    const axis = nrm[0] ? 0 : nrm[1] ? 1 : 2;            // 这个面垂直于哪一维
    const tgt = s.c[axis] + nrm[axis] * hs[axis];        // 这个面所在的坐标
    const hit = ctx.lines.pushed.some((r) => r.a3
      && Math.abs(r.a3[axis] - tgt) < 1e-6
      && Math.abs(r.b3[axis] - tgt) < 1e-6);
    A.ok(hit, `面 ${f}（法线 ${nrm.join(',')}）朝镜头，必须在这个平面上铺出排线`);
    checked++;
  }
  A.equal(checked, 3, '斜俯视机位下恰好 3 个面朝镜头');
});

/**
 * 这条提交是**面的排线**还是**棱**？
 *
 * `section()` 的面 = `lerp(ink, slab|slabHi, k)`（暗、偏蓝），棱 = `bone` / `ash`（很亮）。
 * 用"离哪个基准色更近"来分类 —— **不要用亮度中位数**：棱在背景里会掉到 `ash*0.7`，
 * 半暗不暗，中位数一刀切会把几条棱算成面（实测把"填充不透明度"的均值拉到 0.967）。
 * @param {{color: number[]}} r @param {number[]} base 面的基准色
 */
function isFill(r, base = PALETTE.slab) {
  const db = Math.hypot(...r.color.map((c, i) => c - base[i]));
  const de = Math.hypot(...r.color.map((c, i) => c - PALETTE.bone[i]));
  return db < de;
}

ok('后果②：alpha 只压暗颜色，不改透明度 —— a=0.3 时填充依然接近全不透明', () => {
  const sample = (alpha, opts = {}) => {
    const ctx = makeFakeCtx();
    const cam = camAt([0, 60, -60], [0, 20, 0]);
    const s = KIT.sections.find((x) => x.i === 0 && x.j === 1 && x.k === 0);
    ctx.lines.begin();
    KIT.section(ctx, cam, s, { alpha, fillK: 1, ...opts });
    flush(ctx);
    // 面的基准色可能是 `slab`（侧面）也可能是 `slabHi`（顶面），两个都算"面"
    const fills = ctx.lines.pushed.filter((r) => isFill(r) || isFill(r, PALETTE.slabHi));
    return { fills, all: ctx.lines.pushed };
  };
  const bright = sample(1.0, { fillK: 1 });
  const dim = sample(0.3, { fillK: 1 });
  A.ok(bright.fills.length > 0 && dim.fills.length > 0, '两档都必须铺出面来');
  A.ok(bright.all.length > bright.fills.length, '棱也必须画出来（面只是一部分）');
  // ⚠ 这个 a≈0.967 是**深度淡出**（`depthAlpha`），不是 `solidK` —— 两者都走 alpha 通道，
  //   别混。真正的判据是"**压暗不改变它**"：a=1 与 a=0.3 的填充不透明度必须**一模一样**。
  for (const r of bright.fills) A.ok(r.alpha > 0.9, `填充不透明度必须接近 1（实际 ${r.alpha.toFixed(4)}）`);
  A.equal(dim.fills.length, bright.fills.length, 'a=0.3 的面数与 a=1 相同（都铺满）');
  for (let i = 0; i < bright.fills.length; i++) {
    near(dim.fills[i].alpha, bright.fills[i].alpha, 1e-12, `第 ${i} 条排线：压暗**不能**改变不透明度（§4.3）`);
  }
  // `fade: false` 时（`section()` 没有这个开关，这里直接量 `hatchQuad` 的行为）
  const noFade = (() => {
    const ctx = makeFakeCtx();
    const cam = camAt([0, 0, 40], [0, 0, 0]);
    ctx.lines.begin();
    hatchQuad(ctx, cam, [-4, -4, 0], [8, 0, 0], [0, 8, 0], 8, [1, 1, 1, 1], 0.05,
      { solid: true, minW: 1.6, fade: false });
    flush(ctx);
    return ctx.lines.pushed.map((r) => r.alpha);
  })();
  for (const a of noFade) near(a, 1, 1e-12, 'fade: false ⇒ 不透明度恒为 1');
  const l1 = avg(bright.fills.map((r) => r.lum));
  const l2 = avg(dim.fills.map((r) => r.lum));
  A.ok(l2 < l1 * 0.75, `a=0.3 的填充必须明显更暗：${l2.toFixed(4)} vs ${l1.toFixed(4)}（"暗"由 tone 承担）`);
  A.ok(l2 > 0.0005, '但不能暗到看不见');
});

ok('后果②：只有 a < 0.17 才真的淡出（0.17 就已经铺满）', () => {
  const fillAlpha = (alpha) => {
    const ctx = makeFakeCtx();
    const cam = camAt([0, 60, -60], [0, 20, 0]);
    const s = KIT.sections.find((x) => x.i === 0 && x.j === 1 && x.k === 0);
    ctx.lines.begin();
    KIT.section(ctx, cam, s, { alpha, fillK: 1 });
    flush(ctx);
    const fills = ctx.lines.pushed.filter((r) => isFill(r) || isFill(r, PALETTE.slabHi));
    return fills.length ? avg(fills.map((r) => r.alpha)) : 0;
  };
  // ## 填充不透明度 = `fillA`，**只有这一个系数**（§4.3）
  //
  // 老实现还在 alpha 上乘了一个"深度淡出"，于是远处那几十节变成半透明、后面的东西从
  // 排线缝里透出来（整片世界读成水晶）。现在深度只压**颜色**（`depthTint`，见下一条），
  // alpha 恒等于 `fillA` —— 所以下面的期望值都是**纯常量**，不带机位/距离的因子。
  const cam = camAt([0, 60, -60], [0, 20, 0]);
  const FADE = fadeFactorAt(cam, KIT);
  A.ok(FADE < 0.999, `这一镜的深度淡出系数 ${FADE.toFixed(4)} 确实 < 1（它现在只压颜色）`);
  // a < FILL_FULL(0.17)：填充还**没**铺满，是不透明度在爬坡
  near(fillAlpha(0.16), 0.9167, 0.002, 'a=0.16 ⇒ fillA ≈ 0.917（刚好在爬坡）—— **不含**深度因子');
  near(fillAlpha(0.10), 0.4167, 0.002, 'a=0.10 ⇒ fillA ≈ 0.417');
  near(fillAlpha(0.05), 0, 1e-9, 'a=0.05 ⇒ fillA = 0（刚好在下界）');
  // a ≥ FILL_FULL：**完全不透明**（压暗归 tone 管）
  for (const a of [0.17, 0.3, 0.6, 1.0]) {
    near(fillAlpha(a), 1, 1e-9, `a=${a} ⇒ fillA = 1（已经铺满，完全不透明）`);
  }
  A.equal(fillAlpha(0.01), 0, 'a ≤ 0.012 整节不画');
  // ⚠ 这一条是 §4.3 的**守门断言**：整节铺出来的填充里，不允许出现任何一个 alpha < 1 的
  //   （除非 a 落在过渡区）。谁要是又把"压暗"写成"变透明"，这里立刻红。
  for (const a of [0.17, 0.5, 1.0]) {
    const ctx = makeFakeCtx();
    const s = KIT.sections.find((x) => x.i === 0 && x.j === 1 && x.k === 0);
    ctx.lines.begin();
    KIT.section(ctx, cam, s, { alpha: a, fillK: 1 });
    flush(ctx);
    const fills = ctx.lines.pushed.filter((r) => isFill(r) || isFill(r, PALETTE.slabHi));
    A.ok(fills.length > 0, `a=${a} 必须铺出面`);
    for (const r of fills) {
      near(r.alpha, 1, 1e-9, `a=${a}：填充的 alpha 必须是 1（"远处/背景"不许走 alpha）`);
    }
  }
  // 单调性：a 从 0 涨到 0.17 的过程中，不透明度只增不减
  let prev = -1;
  for (let a = 0.02; a <= 0.2; a += 0.01) {
    const v = fillAlpha(a);
    A.ok(v >= prev - 1e-12, `fillA 必须随 a 单调不减（a=${a.toFixed(2)}: ${prev.toFixed(4)} → ${v.toFixed(4)}）`);
    prev = v;
  }
});

ok('排线缝：solid 模式的宽度按屏幕间距算、被 minW 兜住、撞不上安全阀', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 40], [0, 0, 0]);
  ctx.lines.begin();
  const cnt = hatchQuad(ctx, cam, [-4, -4, 0], [8, 0, 0], [0, 8, 0], 10, [1, 1, 1, 1], 0.05,
    { solid: true, dw: 40, minW: 1.6 });
  A.equal(cnt, 9, 'n=10 条排线 ⇒ 9 条（两端不铺）');
  flush(ctx);
  const widths = ctx.lines.pushed.map((r) => r.width);
  A.ok(widths.every((w) => w >= 1.6), '每条都不能细过 minW');
  A.ok(widths.every((w) => w < 420), '不能撞上安全阀（说明间距算对了）');
});

ok('hatchQuad 的方向：axis 默认**单向**（不是井字）', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 40], [0, 0, 0]);
  ctx.lines.begin();
  A.equal(hatchQuad(ctx, cam, [-4, -4, 0], [8, 0, 0], [0, 8, 0], 6, [1, 1, 1], 0.1, {}), 5,
    "axis='u' 只铺 u 方向 ⇒ n−1 条");
  A.equal(hatchQuad(ctx, cam, [-4, -4, 0], [8, 0, 0], [0, 8, 0], 6, [1, 1, 1], 0.1, { axis: 'both' }), 10,
    "axis='both' 是井字（2×(n−1)）—— 原型里被用户点名过的东西");
  A.equal(hatchQuad(ctx, cam, [-4, -4, 0], [8, 0, 0], [0, 8, 0], 1, [1, 1, 1], 0.1, {}), 0,
    'n < 2 直接返回 0');
  flush(ctx);
  A.equal(ctx.lines.count(), 15, '两条路径都真的进了批');
});

ok('seg3：镜头后方的线段被裁掉（不画翻面长线），线宽不因负深度爆炸', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 0], [0, 0, -1]);
  ctx.lines.begin();
  A.equal(seg3(ctx, cam, [0, 0, 5], [1, 0, 5], [1, 1, 1]), false, '两端都在身后 ⇒ false');
  A.equal(seg3(ctx, cam, [0, 0, 5], [0, 0, -5], [1, 1, 1]), true, '一前一后 ⇒ 截到近平面后可以画');
  A.equal(ctx.queue().length, 1, '只有一条进了队列');
  flush(ctx);
  const r = ctx.lines.pushed[0];
  A.ok(Number.isFinite(r.width) && r.width < 1e6,
    `线宽必须是有限的小值（实际 ${r.width}）—— 拿 dw 算会让身后节变成上亿像素`);
});

ok('seg3：深度淡出走 **tone**（压暗颜色），不走 alpha（§4.3）', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 0], [0, 0, -1]);
  ctx.lines.begin();
  // ⚠ 每条的屏幕 y 给得不一样，别让两条线在屏幕上重合 —— 那样连调试输出都分不清谁是谁
  //   （实测踩过：远近两条都带 `minW: 1`，打印出来一模一样，白查了十分钟）。
  seg3(ctx, cam, [0, 0, -10], [1, 0, -10], [1, 1, 1], 0.05, { minW: 1, fade: false });
  seg3(ctx, cam, [0, 5, -200], [1, 5, -200], [1, 1, 1], 0.05, { minW: 1, fade: false });
  seg3(ctx, cam, [0, -5, -200], [1, -5, -200], [1, 1, 1], 0.05, { minW: 1 });   // fade 默认开
  A.equal(ctx.queue().length, 3, '三条都进了队列');
  flush(ctx);
  A.equal(ctx.lines.count(), 3, '三条都排出来了');
  const lum = (r) => r.color[0] * 0.2126 + r.color[1] * 0.7152 + r.color[2] * 0.0722;
  const nearR = ctx.lines.pushed.find((r) => r.w === 10);            // z=-10，离得近
  const farPlain = ctx.lines.pushed.find((r) => r.w === 200 && r.ay < 540);   // y=+5 → 屏幕上半
  const farFaded = ctx.lines.pushed.find((r) => r.w === 200 && r.ay > 540);   // y=−5 → 屏幕下半
  A.ok(nearR && farPlain && farFaded, '三条都能按"深度 + 屏幕位置"认出来');
  // 关掉 fade 时，远近**完全同色**（证明"压暗"是可关的、而且它不在 alpha 上）
  near(farPlain.alpha, 1, 1e-12, 'fade:false ⇒ alpha 恒 1');
  near(lum(farPlain), lum(nearR), 1e-12, 'fade:false ⇒ 远近同色');
  // 开着 fade：远处**变暗**，但 alpha 仍然是 1（不许靠变透明来退）
  A.ok(lum(farFaded) < lum(nearR) * 0.8,
    `远处必须更暗（${lum(farFaded).toFixed(3)} vs ${lum(nearR).toFixed(3)}）`);
  near(farFaded.alpha, 1, 1e-12, '远处**依然完全不透明** —— 这是 §4.3 的守门断言');
  const k = farFaded.color[0] / farPlain.color[0];
  near(k, depthTint(200), 1e-9, '压暗比例必须正好是 depthTint(深度)');
});

ok('seg3：`color[3]` 是调用方说了算的"存在度"（淡入/淡出），不会被 depth 改', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 0, 0], [0, 0, -1]);
  ctx.lines.begin();
  seg3(ctx, cam, [0, 0, -200], [1, 0, -200], [1, 1, 1, 0.3], 0.05, { minW: 1 });
  flush(ctx);
  near(ctx.lines.pushed[0].alpha, 0.3, 1e-12, '传进来的 alpha 原样保留（只被 tone 影响的是 RGB）');
});

ok('seg3：整节锁同一个 dw 时，同一节的面与棱保持提交顺序（稳定排序）', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 30, -50], [0, 16, 0]);
  const s = KIT.sections.find((x) => x.i === 0 && x.j === 1 && x.k === 0);
  ctx.lines.begin();
  KIT.section(ctx, cam, s, { alpha: 1, fillK: 1 });
  const dws = new Set(ctx.queue().map((m) => m.w));
  A.equal(dws.size, 1, '整节必须共用一个排序深度（否则自己的棱会被自己的面盖掉一半）');
  flush(ctx);
  const d = ctx.lines.pushed.map((r) => r.w);
  A.ok(d.every((w) => Math.abs(w - [...dws][0]) < 1e-9), '提交时用的还是那个共用深度');
  A.equal(d.length, ctx.lines.count(), '每条都带上了深度');
});

ok('section 的 hero：外面多套一圈信号色的边（眼睛要有落点）', () => {
  const ctx = makeFakeCtx();
  const cam = camAt([0, 40, -60], [0, 16, 0]);
  const s = { i: 0, j: 1, k: 0, c: [0, 24, 0], surf: true };
  ctx.lines.begin();
  KIT.section(ctx, cam, s, { alpha: 1, fillK: 1, hero: { i: 0, j: 1, k: 0 } });
  flush(ctx);
  // ⚠ hero 那圈的颜色**不是**裸的 `P.signal` —— `seg3` 会把深度淡出乘进 RGB（§4.3），
  //   所以判据是"**色相方向**与 signal 一致"，而不是"数值相等"。
  const sig = ctx.lines.pushed.filter((r) => sameHue(r.color, PALETTE.signal));
  // 朝镜头的 3 个面围出 9 条棱 —— 但**个别棱会被近平面裁掉**（这一镜实测 7 条），
  // 所以判据取区间而不是等号（断言"恰好 9"会变成一条脆弱测试）。
  A.ok(sig.length >= 7 && sig.length <= 9, `hero 那圈应该有 7–9 条棱，实际 ${sig.length}`);
  const expect = (() => {
    const k = depthTint(project3(cam, W, H, s.c[0], s.c[1], s.c[2]).w);
    return [PALETTE.signal[0] * k, PALETTE.signal[1] * k, PALETTE.signal[2] * k];
  })();
  for (const r of sig) {
    // 颜色的 RGB 是**裸的 signal × 深度淡出**；"更亮一点"是靠 alpha 0.95 叠出来的，
    // 不在这三个分量里（别顺手乘个 0.95 —— 实测踩过）。
    for (let d = 0; d < 3; d++) near(r.color[d], expect[d], 1e-3, `hero 边的第 ${d} 个分量`);
    near(r.alpha, 0.95, 1e-9, 'hero 的边不透明度是 0.95');
  }
  const plain = makeFakeCtx();
  plain.lines.begin();
  KIT.section(plain, cam, s, { alpha: 1, fillK: 1 });
  flush(plain);
  A.equal(plain.lines.pushed.filter((r) => sameHue(r.color, PALETTE.signal)).length, 0,
    '不传 hero 时不该有信号色的边');
  A.ok(ctx.lines.count() >= plain.lines.count() + 7, 'hero 至少要比普通节多画那一圈');
});

/** 两个颜色是不是"同一个色相方向"（只比方向，不比亮度 —— 深度淡出会乘一个小于 1 的系数） */
function sameHue(c, ref) {
  const len = Math.hypot(c[0], c[1], c[2]);
  const rlen = Math.hypot(ref[0], ref[1], ref[2]);
  if (len < 1e-9 || rlen < 1e-9) return false;
  const dot = (c[0] * ref[0] + c[1] * ref[1] + c[2] * ref[2]) / (len * rlen);
  return dot > 0.9999;
}

/* ═══════════════════════════════════════════ ⑥ 2D 面板层（panel.js，同一套假 ctx） */
//
// 面板层是**纯屏幕空间**的，所以不用相机、不用队列 —— 但它和 blocks 共享同一条纪律：
// **alpha 管在不在，tone 管亮不亮**（§4.3）。这里把那条纪律在 2D 侧也钉一遍。
ok('panel：底板默认够不透明（fillK 0.94），压暗走 tone 不走 fillK', () => {
  const ctx = makeFakeCtx();
  const P = PALETTE;
  panelBox(ctx, { x: 100, y: 100, w: 400, h: 300, title: '表', sub: 'mono' });
  const fills = ctx.lines.pushed.filter((r) => isFill(r, P.ink2 ?? P.ink));
  A.ok(fills.length > 0, '必须铺出底板');
  near(fills[0].alpha, 0.94, 1e-9, '底板不透明度默认 0.94（够不透明 —— 否则世界会从面板里透出来）');
  // 边框 = 1 条矩形折线（4 段）；四角各 2 条 = 8 段。
  // ⚠ 用**提交它的方法**判断，不要用颜色分类：`graphite` 的边框在 `isFill()` 的判据下会被算成底板
  //   （实测把 4 段边框整段吃掉，`pushed.length - fills.length` 从 12 变成 8）。
  const bySrc = (k) => ctx.lines.pushed.filter((r) => r.src === k).length;
  A.equal(bySrc('fill'), Math.ceil(300 / 2),
    '底板来自 fillRect：h=300 / step=2 ⇒ 150 行（不是逐行手画的 seg）');
  A.ok(fills.length > bySrc('fill'),
    `颜色分类**会**把 graphite 边框也算成填充（fill ${bySrc('fill')} → 分类 ${fills.length}），`
    + '所以"谁提交的"这类判据只能看方法名 —— 这正是这条断言存在的理由');
  A.equal(bySrc('rect'), 4, '边框是一条矩形折线 = 4 段');
  A.equal(bySrc('seg'), 8, '四角标记各 2 条 = 8 段');
});

ok('panel：tone 压暗是**颜色**的事 —— 不透明度一个字都不变', () => {
  const sample = (tone) => {
    const ctx = makeFakeCtx();
    panelBox(ctx, { x: 100, y: 100, w: 400, h: 300, tone });
    const fills = ctx.lines.pushed.filter((r) => isFill(r, PALETTE.ink2 ?? PALETTE.ink));
    return fills[0];
  };
  const bright = sample(1.0);
  const dim = sample(0.4);
  near(dim.alpha, bright.alpha, 1e-12, '压暗**不能**改变不透明度（§4.3）');
  A.ok(dim.lum < bright.lum, `压暗必须真的更暗（${dim.lum.toFixed(4)} < ${bright.lum.toFixed(4)}）`);
});

ok('panel：alpha ≤ 0.01 时整块不画（不提交任何线段）', () => {
  const ctx = makeFakeCtx();
  panelBox(ctx, { x: 100, y: 100, w: 400, h: 300, alpha: 0.005 });
  A.equal(ctx.lines.count(), 0, '淡到看不见就一条都不提交');
});

ok('tile / tileRow / chips：画得出来，且宽度报得对', () => {
  const ctx = makeFakeCtx();
  tile(ctx, { x: 0, y: 0, s: 64, state: 'solid', link: [true, false, true, false] });
  A.ok(ctx.lines.count() > 0, 'tile 必须画东西');
  const before = ctx.lines.count();
  const w = tileRow(ctx, { x: 0, y: 200, s: 64, count: 4, gap: 6, states: ['plain', 'hi', 'edge', 'ghost'] });
  A.equal(w, 4 * 64 + 3 * 6, 'tileRow 的总宽度 = n×s + (n−1)×gap');
  A.ok(ctx.lines.count() > before, 'tileRow 必须真的画出来');
  const c = makeFakeCtx();
  const cw = chips(c, {
    x: 0, y: 0, w: 120,
    items: [{ label: '连', color: 'signal' }, { label: '不连', on: false }, { label: '开', solid: true }],
  });
  A.equal(cw, 3 * 120 + 2 * 10, 'chips 的总宽度 = n×w + (n−1)×gap');
  A.equal(c.lines.pushed.filter((r) => r.src === 'rect').length, 8,
    'on:false 的标签不画底框 —— 另外 2 个 chip 各一条矩形折线（4 段 × 2 = 8）');
});

ok('chipLayout：等宽、按 gap 递推（纯计算，不画）', () => {
  const out = chipLayout([{ label: 'a' }, { label: 'bb' }, { label: 'ccc' }],
    { x: 10, gap: 5, w: 40 });
  A.deepEqual(out.map((o) => o.x), [10, 55, 100], '左边界必须按 w+gap 递推');
  A.ok(out.every((o) => o.w === 40), '强制等宽时每格都一样宽');
  const measured = chipLayout([{ label: 'a' }, { label: 'bb' }], { x: 0, measure: (s) => s.length * 10 });
  A.deepEqual(measured.map((o) => o.w), [10, 20], '不强制等宽时用 measure 的结果');
});
