// 转场库验收：同一时刻渲染**两个会话** —— 「只有 A」（`--only xa`）与「A+B 交叠」（`--only xa,xb`），
// 逐像素差分。两边跑的是同一套确定性代码，所以差异只可能来自转场本身。
//
// ─────────────────────────────────────────────────────────────────────────────
// 为什么这套差分**成立**（这是整个脚本的地基，别删）：
//
//   `--only` 会把选中的段**平移到时间轴开头**（src/core/engine.js §load 有注释），
//   而 `xa` 在 `--only xa` 与 `--only xa,xb` 两个会话里都是**第一段**、起点都是 0。
//   场景拿到的 `f.t` 就是绝对时间 t，`world()` 那个全片共用背景只吃 `f.t`
//   （`fract(t*0.12)` 那道扫描线也一样），再加上摄影机 `cameraAt(f.t)` 也只吃 `f.t`
//   —— 于是**两个会话在同一 t 上，背景与运镜逐像素一致**，差分剩下的只有前景。
//   一旦谁把 `xa` 挪成非第一段、或把背景改成吃 `f.lt` / 段内参数，这套差分立刻失效，
//   那时要改的是探针的取时口径，而不是把判据放宽。
//
// ─────────────────────────────────────────────────────────────────────────────
// 旧版（判据②报 FAIL 的那一版）错在哪（docs/STATUS.md §10.9 的收尾）：
//
//   §10.9 留了两条怀疑，复核结论如下：
//
//   ① 「索引按 (h-1-y) 取 —— 行序与注释不符」→ **这条怀疑不成立，代码是对的。**
//      `GL.readPixels()`（src/core/gl.js §readPixels）是从**帧缓冲**读的，而帧缓冲第 0 行
//      是画面**最下面**那一行 —— WebGL 原生顺序就是自下而上；`src/app.js` 的 `png()`
//      也正是靠 `(ph-1-y)` 把它翻成 ImageData 的自上而下（app.js 第 458 行注释 + 第 461 行）。
//      `api.pixels()` 的文档注释同样写着「自下而上（WebGL 原生顺序）」。
//      所以「自上而下的逻辑 y」配 `(ph-1-y)` 索引**是正确的**，不是 bug。
//      本脚本不满足于读注释，每次运行都会**实测**一遍：在只有 A 的帧里量方块紧盒子
//      （逻辑 y 210–430）的均值，把 (ph-1-y) 与不翻两种取法都算出来对比（见 §自检 A）。
//
//   ② 「判据②过时」→ **成立，而且根因不是行序，是"量错了东西"。**
//      旧判据在 x 6%–42% / y 14%–64%（1920×1080 下是 x115–806、y151–691）这一大片里量
//      "平均亮度"，而那一片的亮度**主要由全片共用的背景决定**，背景在两个会话里逐像素一致
//      （这正是配方①要的效果），所以它**永远不可能因为 A 被推走而变暗** —— 这条判据
//      无论转场好坏都会 FAIL，是个不可证伪的坏量具。
//      实测：旧版 25.35% → 24.83%（只掉了 2%，而那片区域 60%+ 的像素是背景）。
//
//   新版改成**贴合 A 元素的紧盒子 + 模板匹配**，见下面的三组判据。
//
//   ⚠ 一条**被证伪的推断，记在这里免得后人再猜一遍**：曾经怀疑"旧版没设 viewport
//      （Chrome 默认 1280×720）→ 按 1920 宽算下标会越界读到 NaN，所以那个 25.35% 不是真的"。
//      **这是错的。** `engine.readPixels()` 读的是**引擎自己的离屏 RT**（尺寸 = 逻辑分辨率 ×
//      scale，由 task.config 决定），**与 viewport 无关**：同一支 1920×1080 的片子在
//      1280×720 与 1920×1080 两种视口下都返回 8294400 字节。所以旧版的下标没有越界，
//      那个 `25.32% → 24.79%` 是**真实读到的数字** —— 也正因为那片区域怎么读都几乎不变
//      （亮度由全片共用背景主导），判据②才永远不可能 PASS。
//
//      仍然保留一处**尺寸硬校验**（见 §尺寸校验），但它的理由是另一回事：本探针的盒子/模板
//      坐标是按"scale=1、逻辑像素 == 物理像素"写死的，物理/逻辑不一致时取样步长就错了。
//      这跟 `tools/png-rows.mjs` 当年写死 1920 宽、把 4K 画面判成全黑是同一类问题 ——
//      把隐含假设**显式校验并退出**，而不是静默按错的步长采样。
//
// ─────────────────────────────────────────────────────────────────────────────
// ★ 判据②和③是**互补**的，别只留一条（这是本脚本最重要的设计结论）：
//
//   ② 量的是"紧盒子里的残留亮度比"，它只能证明**元素不在了**，
//      **分不清"被推走"和"原地淡出"** —— `transitionPass` 在 k≥0.55 之后把上一帧整体
//      alpha 归零，所以"原地慢慢淡到 0"同样会让 ratio 掉下去。
//   把这两者分开的是 **③ 的位移**：只有模板匹配量到真实位移，才叫"推走"。
//   → 如果有人把 `fadeAt` 调大、让 A 留在原地慢慢淡，② 仍会 PASS，**③ 会在 40% 抓住它**
//     （那时 NCC 还高、位移却是 0）。反过来，③ 在元素已经淡光的后期探针上匹配不上，
//     又要靠 ② 的 ratio 来兜底。缺任何一条都会漏掉一类失败。
//
//   ⚠ ③ 量到的位移**偏大**：`transitionPass` 沿相机方向做 9 tap 拖尾，k=0.4 时 b≈0.052
//     （在 1920 宽上是约 100px 的涂抹），会把 NCC 峰值往运动方向带。实测 40% 是 200.6px，
//     而按 `push·k²` 算的理论值只有 107.4px。所以"位移 ≥ 24px"这条门槛是**宽松**的：
//     它能挡住"完全没动"，但不要拿它当精确位移读数。
//
//   ⚠ ③ 的三条要求是**按匹配可信度分层**的，不是"每个探针都要求位移"（详见 §判据③ 的注释）：
//     「只要匹配上了就要求够锐」+「位移只在 k≥40% 上要求」+「匹配不上时由②的 ratio 兜底，
//     元素还在却匹配不上要判 FAIL 并说明是量具问题」+「总闸门：至少一个探针量到真实位移」。
//     为什么位移不能从 k=0.1 就要求：`push·k²` 在 k=0.1 时设计上只有 6.7px，
//     在那里量位移等于在量缓动曲线（早期版本就这么把一个**正确**的转场判成了 FAIL）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 夹具几何（tasks/_calib/scenes/trans.js，逻辑像素、y 向下）：
//   A 的方块：`lines.rect(260, 220, 200, 200, 8, [3,3,3])` —— **描边**矩形，线宽 8、线性亮度 3.0
//             → 描边覆盖 x 256–464 / y 216–424（很亮，量得准）
//   A 的大字：`type.write('ALPHA', 260, 540, { size: 96 })` → 基线 y≈540、字面 y≈540–636
//   B 的东西都在右半屏（`W-460 = 1460` 起，还被 `enterOffset` 往右推）→ **不会跑进左边的盒子**
//   所以这里的紧盒子既能套住 A 的元素，又不会被 B 的像素污染。
//
// ⚠ 本探针**只支持 scale=1**（物理尺寸 == 逻辑分辨率）。盒子/模板坐标一律按逻辑像素给；
//   对不上时直接非零退出并说明，绝不静默越界 —— 见上面那条"旧版真正的致盲点"。
//
// 用法：node tools/probe-trans2.mjs [task]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = process.argv[2] ?? '_calib';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 参数 */

// A 的方块紧盒子：套住描边矩形 x256–464 / y216–424，四周各留一点余量
const BOX_SQUARE = { x0: 250, y0: 210, x1: 470, y1: 430 };
// A 的大字紧盒子：套住 'ALPHA'（基线 y=540、字面到 y≈636）
const BOX_TEXT = { x0: 250, y0: 470, x1: 800, y1: 620 };
// 模板取方块左上角那一带（描边拐角，特征最强、最好认）
const TPL = { cx: 262, cy: 222, size: 48 };
const SEARCH = { radius: 360, stride: 2 };
// NCC 门槛：0.75 = "图形还在、还是锐的"
const NCC_MIN = 0.75;
// 位移门槛：24px = "真的挪窝了，不是抖动"
const SHIFT_MIN = 24;
// 判据①：交叠期紧盒子里的平均绝对亮度差
const DIFF_MIN = 0.01;
// 判据②：交叠结束时的残留比，以及基线的自检下限
const RATIO_MAX = 0.5;
const RATIO_BASE_MIN = 0.9;
// 变暗不可能是"重新变亮"：允许的回升（≈2/255 的量化噪声）
const RATIO_TOL = 0.01;
// 判据③的**位移**要求从交叠多少开始生效（见下面 §判据③ 的注释：k<0.4 时位移在设计上就很小）
const SHIFT_MIN_K = 0.4;

// 探针时刻：交叠前 0.4s（基线）+ 交叠 10/40/70/95%。
// `k` = 交叠进度（基线是 null），判据③按它决定"要不要要求位移"。
const PROBES = [
  { key: '基线', label: '交叠外 基线', k: null, frac: -0.4 / 0.6 },
  { key: '10%', label: '交叠 10%', k: 0.1, frac: 0.1 },
  { key: '40%', label: '交叠 40%', k: 0.4, frac: 0.4 },
  { key: '70%', label: '交叠 70%', k: 0.7, frac: 0.7 },
  { key: '95%', label: '交叠 95%', k: 0.95, frac: 0.95 },
];

/* ------------------------------------------------------------------ 小工具 */

const fmt = (v, n = 3) => (Number.isFinite(v) ? v.toFixed(n) : '   n/a');
const pct = (v) => `${(v * 100).toFixed(2)}%`;

/**
 * 从「自下而上」的 RGBA 缓冲里取出**自上而下逻辑坐标**的亮度场。
 *
 * 亮度用 sRGB 显示空间的加权和（readPixels 出来已经编码过），两条会话用同一个公式，
 * 所以差分的含义就是"肉眼看到的亮度差"。
 * @param {Uint8Array|number[]} px @param {number} pw @param {number} ph @returns {Float32Array}
 */
function toLum(px, pw, ph) {
  const out = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    // WebGL 帧缓冲第 0 行是画面最下面一行（见文件头 §复核①）
    const src = (ph - 1 - y) * pw * 4;
    const dst = y * pw;
    for (let x = 0; x < pw; x++) {
      const i = src + x * 4;
      out[dst + x] = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
    }
  }
  return out;
}

/**
 * 盒子的两次积分图（Float64）。
 *
 * 为什么用积分图而不是硬扫：判据①要在每个探针上量两个盒子、判据③要在 ±360px / 步长 2px
 * 的 13 万个候选位置上算窗口均值与方差。硬扫是 O(位置数 × 模板面积) ≈ 3 亿次，
 * 积分图把窗口统计降到 O(1)，只有模板点积是 O(面积) —— 整个脚本因此能在几十秒内跑完。
 * @param {Float32Array} lum @param {number} pw @param {number} ph
 */
export function boxIntegral(lum, pw, ph) {
  const N = (pw + 1) * (ph + 1);
  const I = new Float64Array(N);
  const I2 = new Float64Array(N);
  for (let y = 0; y < ph; y++) {
    let rs = 0, rs2 = 0;
    for (let x = 0; x < pw; x++) {
      const v = lum[y * pw + x];
      rs += v; rs2 += v * v;
      I[(y + 1) * (pw + 1) + x + 1] = I[y * (pw + 1) + x + 1] + rs;
      I2[(y + 1) * (pw + 1) + x + 1] = I2[y * (pw + 1) + x + 1] + rs2;
    }
  }
  return { I, I2, S: pw + 1 };
}

/** 积分图取矩形和（x0,y0 左上角、x1,y1 右下角，**两端都含**） */
export const rectSum = (II, S, x0, y0, x1, y1) => II[(y1 + 1) * S + x1 + 1] - II[y0 * S + x1 + 1] - II[(y1 + 1) * S + x0] + II[y0 * S + x0];

/** 盒子均值 */
function boxMean(lum, pw, box) {
  let s = 0, n = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) { s += lum[y * pw + x]; n++; }
  return n ? s / n : 0;
}

/** 盒子平均绝对差（两个亮度场逐像素） */
function boxMeanAbsDiff(a, b, pw, box) {
  let s = 0, n = 0;
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) { s += Math.abs(a[y * pw + x] - b[y * pw + x]); n++; }
  return n ? s / n : 0;
}

/**
 * 模板匹配（归一化互相关 NCC）—— 在 `dst` 里找 `src` 中左上角为 (tplX,tplY)、边长 size 的那块模板。
 *
 * **模板的位置** _(tplX, tplY) 是模板的**左上角**，**搜索的中心**是 (cx, cy)：两者必须分开传。
 * 探针里它们对应同一个方块（模板取自 xa 那一帧的方块左上角），但**绝不能**在实现里默认
 * "模板就从搜索中心取" —— 那样每个候选位置都在拿自己跟自己比，NCC 恒等于 1，判据③会永远
 * PASS 而完全失真。这个错由 §自检 1 的对拍抓出来（9 个位置全部返回 1.0）。
 *
 * 为什么用 NCC 而不是"差值最小"：转场会把上一帧整体乘一个 alpha（0.1–1.0），差值最小会被
 * "暗但形状对"和"亮但形状错"两可；NCC 对整体缩放/平移不变，只问"形状还在不在、在哪"。
 * 这正是判据③要区分的两件事：**推走**（形状还在、位置变了）vs **原地糊掉**（形状没了、NCC 塌）。
 *
 * 怎么算的（两步，缺一不可）：
 *   ① 先用 `dst` 的积分图 O(1) 拿到每个候选窗的和与平方和 → 窗口均值 iMean 与方差 iVar。
 *      **方差≈0（纯色窗）直接跳过**：皮尔逊相关对纯色窗没有定义，硬算会得到 ±∞ 这种垃圾。
 *   ② 对留下的候选窗算协方差。这一步有个化简：`Σ(T−T̄)` 在整个模板上恒为 0，于是
 *        cov = Σ(T−T̄)(I−Ī) = Σ(T−T̄)·I − Ī·Σ(T−T̄) = Σ(T−T̄)·I
 *      **根本不需要给图像减均值**，直接拿"去均值的模板"与窗口逐像素点积即可（48×48 次乘法）。
 *
 * ⚠ 这里**不能**用"把模板点积也做成一张积分图"的写法。那张图的乘积 `T·I` 只写在**模板自己
 *   所在的那几行**上，所以任何窗口取到的值都只与"窗口相对模板的位置"有关 —— 它算的是
 *   "窗口在不在模板原位"，根本没法把模板滑到别处去搜索。曾经就这么错过：9 个候选位置
 *   全部返回 1.000000（每个位置都在拿自己跟自己比），是靠 §自检 1 的对拍炸出来的。
 *
 * ⚠ 也**不要**为了"省乘法"把分子改成行前缀和之差：NCC 的分子是逐像素乘积，写成
 *   `P[x+c+1] − P[x]` 得到的是"从 x 累加到 x+c"，把一个区间和当成了一个像素 ——
 *   自匹配会从 1.0 掉到 0.71。同样由 §自检 1 抓出来。
 *
 * 返回 `ncc` 为 NaN 时表示"没有可信匹配"，`reason` 说清是哪种（模板本身是纯色 / 候选窗全部越界 /
 * 候选窗全部是纯色）—— 判据③才能分清"元素真没了"和"量具坏了"，不会含糊过去。
 *
 * @returns {{ncc:number, dx:number, dy:number, candidates:number, iMean:number, reason?:string}}
 */
// 导出只为让临时脚本能单独对拍这个匹配器（脚本主体仍是命令行工具）
export function matchTemplate(src, dst, pw, ph, tpl, search) {
  const { cx, cy, size, tplX = cx - (size >> 1), tplY = cy - (size >> 1) } = tpl;
  const half = size >> 1;
  const n = size * size;
  const tBase = tplY * pw + tplX;   // 模板左上角在 src 里的**绝对**下标

  // —— 模板的全局均值与标准差。tStd≈0 说明模板是纯色，皮尔逊相关没有定义。
  let tSum = 0;
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) tSum += src[tBase + ty * pw + tx];
  const tMean = tSum / n;
  let tss = 0;
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) { const d = src[tBase + ty * pw + tx] - tMean; tss += d * d; }
  const tStd = Math.sqrt(tss / n);
  if (tStd < 1e-4) return { ncc: NaN, dx: 0, dy: 0, candidates: 0, iMean: 0, reason: '模板本身是纯色，NCC 无定义' };

  // —— 窗口统计用的两张积分图（和、平方和）
  const { I, I2, S } = boxIntegral(dst, pw, ph);

  // —— ② 的协方差：去均值的模板与窗口逐像素点积（见 docstring 的化简）。
  // 去均值的模板按 size 步长存（不是 pw），搜索时整行连续读，缓存友好。
  const tCent = new Float32Array(n);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) tCent[r * size + c] = src[tBase + r * pw + c] - tMean;

  const lo = -search.radius, hi = search.radius;
  const stride = Math.max(1, Math.round(search.stride));
  let best = { ncc: -2, dx: 0, dy: 0, candidates: 0, iMean: 0 };
  for (let dy = lo; dy <= hi; dy += stride) {
    const y0 = cy + dy - half, y1 = y0 + size - 1;
    if (y0 < 0 || y1 >= ph) continue;
    for (let dx = lo; dx <= hi; dx += stride) {
      const x0 = cx + dx - half, x1 = x0 + size - 1;
      if (x0 < 0 || x1 >= pw) continue;
      best.candidates++;
      const S1 = rectSum(I, S, x0, y0, x1, y1);
      const S2 = rectSum(I2, S, x0, y0, x1, y1);
      const iMean = S1 / n;
      const iVar = Math.max(0, S2 / n - iMean * iMean);
      if (iVar < 1e-8) continue;                     // 纯色窗口 → 相关无定义
      let cov = 0;
      for (let r = 0; r < size; r++) {
        const drow = (y0 + r) * pw + x0, trow = r * size;
        for (let c = 0; c < size; c++) cov += tCent[trow + c] * dst[drow + c];
      }
      const ncc = cov / (n * tStd * Math.sqrt(iVar));
      if (ncc > best.ncc) best = { ncc, dx, dy, candidates: best.candidates, iMean };
    }
  }
  if (!best.candidates) return { ncc: NaN, dx: 0, dy: 0, candidates: 0, iMean: 0, reason: '搜索窗里没有一个候选位置落在画面内' };
  // best.ncc 还停在初值 -2 ⇒ 一个候选都没通过方差检查（全是纯色窗）⇒ 相关无定义
  if (best.ncc <= -1.5) return { ...best, ncc: NaN, reason: '候选窗全部是纯色，NCC 无定义' };
  return best;
}

/**
 * 自检 1：匹配器的**逐点暴力对拍**（不碰浏览器，毫秒级）。
 *
 * 为什么必须有这一步：积分图版为了快，把"模板统计"和"窗口统计"分开算，
 * 任何窗口边界（半开 vs 闭区间）的错位都会让它**安静地**输出一个像模像样的负相关 ——
 * 那种输出在报告里看起来跟"元素真的没了"一模一样。这里用随机小图把积分图 NCC 与
 * O(面积) 暴力实现逐点对拍，误差必须 < 1e-6（Float32 精度量级）；对不上就直接退出、**不去跑判据**。
 */
function bruteCheckNCC() {
  const pw = 60, ph = 50, cx = 20, cy = 18, size = 8;
  const half = size >> 1, n = size * size;
  const img = new Float32Array(pw * ph);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < img.length; i++) img[i] = rnd();

  // 暴力侧：模板与窗口都按**全局**均值去中心（与 matchTemplate 同口径）
  const tpl = new Float32Array(n);
  let tss = 0;
  let ts = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) { const v = img[(cy - half + j) * pw + (cx - half + i)]; tpl[j * size + i] = v; ts += v; }
  }
  const tMean = ts / n;
  for (let k = 0; k < n; k++) tss += (tpl[k] - tMean) * (tpl[k] - tMean);

  let worst = 0, where = '', nonFinite = 0;
  // 覆盖三类位置，缺一类都可能漏掉实现错误：
  //   · 窗口与模板行**重叠**的（常见情形）；
  //   · 窗口落在模板行**下方**的（曾漏过：下面的前缀和没被搬下来，Sc 恒为 0）；
  //   · 贴着画面边界的（越界判定）。
  //
  // ⚠ 每一个位置都**必须传固定的 tplX/tplY**（模板永远取 (20,18) 那一块）。
  //   不传的话 matchTemplate 会用搜索中心当模板原点，于是"每个候选都在拿自己跟自己比"，
  //   NCC 恒等于 1 —— 对拍会当场炸出 9 个 1.000000，这正是它存在的意义。
  const spots = [[cx, cy], [14, 22], [26, 14], [40, 30], [12, 12], [cx + 1, cy - 1], [30, 30], [40, 40], [30, 44]];
  for (const [X, Y] of spots) {
    const x0 = X - half, y0 = Y - half;
    let s = 0, cov = 0, vv = 0;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) s += img[(y0 + j) * pw + (x0 + i)];
    const m = s / n;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const d = img[(y0 + j) * pw + (x0 + i)] - m;
      cov += (tpl[j * size + i] - tMean) * d; vv += d * d;
    }
    const want = cov / Math.sqrt(vv * tss);
    const got = matchTemplate(img, img, pw, ph, { cx: X, cy: Y, tplX: cx - half, tplY: cy - half, size }, { radius: 0, stride: 1 }).ncc;
    // ⚠ NaN 必须显式判成"不一致"：`NaN > worst` 是 false，只比大小的话
    //   "匹配器返回 NaN"会被静默当成通过 —— 这个对拍自己就先骗过一次。
    if (!Number.isFinite(got)) { nonFinite++; continue; }
    const d = Math.abs(got - want);
    if (d > worst) { worst = d; where = `(${X},${Y}) 暴力 ${want.toFixed(6)} vs 积分图 ${got.toFixed(6)}`; }
  }
  // 阈值 1e-6：两侧都走 Float32 存储（亮度场是 Float32Array），理论差 ~1e-7；
  // 真正的实现错误（下面注释里列的那几个）都在 1e-1 量级，不会漏。
  const ok = nonFinite === 0 && worst < 1e-6;
  return { ok, worst, where, nonFinite, count: spots.length };
}

/**
 * 自检 2：端到端。合成一张图、把模板挪到**已知位移**，看匹配器能不能把位移找回来。
 * 对拍保证公式对，这一步保证"取模板 → 搜索 → 报位移"这条链路对。
 */
function shiftCheckNCC() {
  const pw = 900, ph = 700, cx = 300, cy = 300, size = 48;
  const img = new Float32Array(pw * ph);
  img.fill(0.1);
  for (let y = cy - 24; y < cy + 24; y++) for (let x = cx - 24; x < cx + 24; x++) img[y * pw + x] = 0.85;   // 一块方砖
  for (let y = cy - 24; y < cy - 12; y++) for (let x = cx - 24; x < cx - 12; x++) img[y * pw + x] = 0.2;    // 左上挖一块，让它有方向性
  const SHIFT = { dx: 50, dy: -30 };
  const moved = new Float32Array(pw * ph);
  moved.fill(0.1);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const sy = y - SHIFT.dy, sx = x - SHIFT.dx;
    if (sy >= 0 && sy < ph && sx >= 0 && sx < pw) moved[y * pw + x] = img[sy * pw + sx];
  }
  // ⚠ 搜索半径必须**大于**要找回的位移，否则真值窗口根本不在候选里 ——
  //   这一条踩过：期望位移 (50,-30)（模长 58px）配上 radius 96 时，真值位置压根没被搜到，
  //   匹配器"合理地"回了一个极负的 NCC。自检的搜索半径要留足余量。
  const m = matchTemplate(img, moved, pw, ph, { cx, cy, tplX: cx - 24, tplY: cy - 24, size }, { radius: 128, stride: 1 });
  const ok = Number.isFinite(m.ncc) && Math.abs(m.dx - SHIFT.dx) <= 1 && Math.abs(m.dy - SHIFT.dy) <= 1 && m.ncc >= 0.99;
  return { ok, m, SHIFT };
}

/* ------------------------------------------------------------------ 起服务 */

/** 起私有 Vite（与 CLI 一样：不依赖外部服务）。撞上端口占用/启动失败就重试。 */
async function startVite(port, tries = 3) {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 1; i <= tries; i++) {
    const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
      cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, ANIM_NO_HMR: '1' },
    });
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      try { const res = await fetch(url, { signal: AbortSignal.timeout(1200) }); if (res.ok) return { proc, url }; } catch { /* 还没起来 */ }
      await sleep(180);
    }
    try { proc.kill(); } catch { /* 已经没了 */ }
    console.log(`  vite 第 ${i} 次没起来，重试…`);
    await sleep(1500);
  }
  return null;
}

async function waitAnim(page) {
  await page.waitForFunction(() => { const a = window.__anim; return a && a.status && a.status().state !== 'booting'; }, null, { timeout: 120000 });
}

/**
 * 开一个只加载指定段的页面会话。
 *
 * `goto` 会重试：渲染期间谁改了仓库里的文件，私有 Vite 的文件监听会因 EBUSY 崩掉，
 * 表现就是 `net::ERR_CONNECTION_REFUSED` —— 那是**并发写文件导致的假失败**，不是判据失败。
 * 按约定等 20 秒重试（最多 2 次），并把这件事打印出来。
 */
async function session(browser, url, only) {
  // 固定视口（与 scripts/anim.mjs 的 openSession 同一套约定）+ deviceScaleFactor 1，
  // 让页面环境可复现。
  // ⚠ 但要记住：`readPixels()` 读的是**引擎自己的离屏 RT**，尺寸 = 逻辑分辨率 × scale，
  //   **与视口无关**（1920×1080 的片子在任何视口下都返回 8294400 字节）。
  //   别把"某个数是错的"归因到视口上 —— 这条推断被实测证伪过，详见文件头那段。
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const q = new URLSearchParams({ task: TASK, offline: '1', hud: '0' });
  if (only) q.set('only', only);
  for (let i = 0; i <= 2; i++) {
    try {
      await page.goto(`${url}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitAnim(page);
      const info = await page.evaluate(() => window.__anim.info());
      const grab = async (t) => page.evaluate(async (tt) => {
        const api = window.__anim;
        const boot = await api.boot;
        await api.frame(tt, { samples: 1 });
        const gl = boot.engine.gl;
        return { pw: gl.pw, ph: gl.ph, W: gl.W, H: gl.H, px: boot.engine.readPixels() };
      }, t);
      // 同一次渲染同时拿"引擎自己的 PNG"（浏览器解码回来 = 显示空间，自上而下）。
      // 只给 §自检 A 用：它是**唯一一个不依赖我复述翻转规则**的行序基准。
      const grabWithPng = async (t) => page.evaluate(async (tt) => {
        const api = window.__anim;
        const boot = await api.boot;
        const st = await api.still(tt, { samples: 1 });
        const gl = boot.engine.gl;
        const im = new Image();
        im.src = st.png;
        await im.decode();
        const cv = document.createElement('canvas');
        cv.width = gl.pw; cv.height = gl.ph;
        const c2 = cv.getContext('2d');
        c2.drawImage(im, 0, 0);
        return { pw: gl.pw, ph: gl.ph, px: boot.engine.readPixels(), png: c2.getImageData(0, 0, gl.pw, gl.ph).data };
      }, t);
      return { page, info, grab, grabWithPng };
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (i === 2) throw err;
      console.log(`  [${only ?? '全部'}] 页面打开失败（第 ${i + 1} 次）：${msg.split('\n')[0]}`);
      console.log('  → 多半是渲染期间有人在写仓库文件把私有 Vite 的文件监听搞崩了（EBUSY），等 20s 重试。');
      await sleep(20000);
    }
  }
  throw new Error('unreachable');
}

/* ------------------------------------------------------------------ 跑起来 */

// 被 `import` 时只导出上面的纯函数（matchTemplate 等），不跑探针 ——
// 这样"匹配器到底对不对"可以脱离浏览器单独对拍（见 §自检 1 的注释）。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();

async function main() {
const t0 = Date.now();
console.log(`转场库探针 probe-trans2  ${TASK}   （自下而上像素 + 紧盒子差分 + NCC 模板匹配）`);

let browser = null;
let fails = 0;
// 非零 = 脚本自己主动退出（配置/量具坏了），跟"判据 FAIL"区分开：
// 自检没过时用 `abortCode` + throw 退出，才能走到 finally 把 Vite / Chrome 收干净。
let abortCode = 0;
let vite = null;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

try {
  // 自检 1：积分图 NCC vs 暴力实现（毫秒级，不碰浏览器）
  {
    const bc = bruteCheckNCC();
    if (!bc.ok) {
      abortCode = 3;
      throw new Error(`积分图 NCC 与暴力实现对不上（${bc.nonFinite ? `${bc.nonFinite} 个位置返回了非有限值；` : ''}最大差 ${bc.worst.toExponential(2)}${bc.where ? `，${bc.where}` : ''}）——量具坏了，先修匹配器再看判据`);
    }
    console.log(`✓ 自检 1  积分图 NCC vs 暴力实现：${bc.count} 个位置（含模板行下方与画面边界）最大差 ${bc.worst.toExponential(1)}（阈值 1e-6，Float32 精度量级）`);
  }

  // 自检 2：端到端，已知位移能找回来
  {
    const st = shiftCheckNCC();
    if (!st.ok) {
      abortCode = 3;
      throw new Error(`模板匹配器找不回合成图里的已知位移（期望 dx=${st.SHIFT.dx} dy=${st.SHIFT.dy}，实测 dx=${st.m.dx} dy=${st.m.dy} ncc=${fmt(st.m.ncc, 4)}）`);
    }
    console.log(`✓ 自检 2  已知位移 (${st.SHIFT.dx},${st.SHIFT.dy}) 被找回为 (${st.m.dx},${st.m.dy})，NCC ${fmt(st.m.ncc, 4)}`);
  }

  const started = await startVite(5405);
  if (!started) { abortCode = 1; throw new Error('vite 起不来（重试 3 次）'); }
  vite = started.proc;
  const url = started.url;

  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });

  const onlyA = await session(browser, url, 'xa');
  const both = await session(browser, url, 'xa,xb');
  const A = onlyA.info.timeline.find((s) => s.id === 'xa');
  const B = both.info.timeline.find((s) => s.id === 'xb');
  if (!A || !B) { abortCode = 2; throw new Error('段没找到（--only 选错？）'); }
  const overlap = A.end - B.start;
  console.log(`\nxa [${A.start},${A.end})  xb [${B.start},${B.end})  交叠 ${overlap.toFixed(2)}s`);
  // 差分成立的前提（文件头那段注释）：xa 在两个会话里都必须是**第一段、起点 0**，
  // 否则 f.t 不同 → 背景不同 → 差分里混进"世界变了"，判据全废。
  if (A.start !== 0) { abortCode = 2; throw new Error(`xa 起点是 ${A.start}，不是 0 —— 差分前提不成立，先修取时口径`); }

  // 探针时刻 = B.start + overlap*frac（基线的 frac 是负的，见 §参数）
  const probes = PROBES.map((p) => ({ ...p, t: B.start + overlap * p.frac }));

  // 每个探针取两帧（只有 A / A+B），转成亮度场
  const rows = [];
  let pw = 0, ph = 0, LOGW = 0, LOGH = 0;
  for (const p of probes) {
    const a = await onlyA.grab(p.t);
    const b = await both.grab(p.t);
    pw = a.pw; ph = a.ph; LOGW = a.W; LOGH = a.H;
    const la = toLum(a.px, pw, ph);
    const lb = toLum(b.px, pw, ph);
    rows.push({
      ...p, la, lb,
      lumA: boxMean(la, pw, BOX_SQUARE),
      lumB: boxMean(lb, pw, BOX_SQUARE),
      diff: boxMeanAbsDiff(la, lb, pw, BOX_SQUARE),
      // A 的**大字**紧盒子：只作**参考**，不进任何判据。
      // 用途是"第二条独立证据"：方块和文字是 A 的两个独立元素，如果只有方块在变、文字纹丝不动，
      // 那更像量具只盯住了一个目标，而不是整段被转场带走。三个判据仍只用 boxSquare（按约定）。
      tLumA: boxMean(la, pw, BOX_TEXT),
      tLumB: boxMean(lb, pw, BOX_TEXT),
      tDiff: boxMeanAbsDiff(la, lb, pw, BOX_TEXT),
    });
  }
  console.log(`画面 ${pw}×${ph} 物理像素，逻辑分辨率 ${LOGW}×${LOGH}（本探针的盒子坐标一律按**逻辑像素**给）`);
  // §尺寸校验：盒子/模板/搜索半径都是按"scale=1、逻辑像素 == 物理像素"写死的常数。
  // 物理 ≠ 逻辑时（比如 task 里写了 scale:2 的 4K），这些常数会按**错的步长**去采样 ——
  // 不报错、不越界，只是量出来的东西不是你以为的那个区域。这类"静默按错步长"的坑
  // `tools/png-rows.mjs` 当年踩过（写死 1920 宽，把 4K 画面判成全黑）。
  // 所以这里**显式校验并退出**：把隐含假设变成一条会响的断言。
  if (pw !== LOGW || ph !== LOGH) {
    abortCode = 2;
    throw new Error(`物理尺寸 ${pw}×${ph} 与逻辑分辨率 ${LOGW}×${LOGH} 不一致 —— `
      + '本探针的盒子/模板坐标按 scale=1（逻辑 = 物理）写死，此时会按错的步长采样。'
      + '要在别的 scale 上跑，先把所有坐标常量乘上 pw/LOGW。');
  }

  // 自检 A：行序。
  //
  // 怎么验才**判得动**：拿**引擎自己的 PNG** 当基准。`api.still()` 出的 PNG 就是引擎认定的
  // 显示空间（`src/app.js` 的 `png()` 里那次 `(ph-1-y)` 翻转），让浏览器把它解码回 ImageData
  // 就是"屏幕上的样子"。我自己的翻转规则只可能与它一致或不一致 —— 这里不依赖任何夹具几何，
  // 也不需要我复述一遍翻转公式（复述错了就会自己验自己）。
  //
  // ⚠ 曾经写成"方块紧盒子按 (ph-1-y) 取应比不翻亮 2 倍"。那个阈值是拍脑袋定的，实测正确取向
  //   只有 1.55×，于是把一个**正确**的实现判成了 FAIL —— 判据的阈值不能靠猜几何。
  {
    const g0 = await onlyA.grabWithPng(probes[0].t);
    const lumAt = (arr, x, y) => {
      const i = (y * pw + x) * 4;
      return (arr[i] * 0.2126 + arr[i + 1] * 0.7152 + arr[i + 2] * 0.0722) / 255;
    };
    // 与基准逐点比：完全相等的点数 + 平均绝对差
    let nF = 0, nD = 0, sF = 0, sD = 0, n = 0;
    for (let y = 20; y < ph - 20; y += 37) {
      for (let x = 20; x < pw - 20; x += 53) {
        const want = lumAt(g0.png, x, y);              // 显示空间基准（引擎自己的翻转）
        const flip = lumAt(g0.px, x, ph - 1 - y);      // 本探针的取向
        const direct = lumAt(g0.px, x, y);             // 不翻
        sF += Math.abs(flip - want); sD += Math.abs(direct - want); n++;
        if (flip === want) nF++;
        if (direct === want) nD++;
      }
    }
    if (nF <= n * 0.9 || nF <= nD) {
      abortCode = 3;
      throw new Error(`行序不符：按 (ph-1-y) 取与引擎 PNG **完全相等**的取样点 ${nF}/${n}，`
        + `按不翻取是 ${nD}/${n}。平均绝对差：翻 ${(sF / n).toFixed(4)} vs 不翻 ${(sD / n).toFixed(4)}。`
        + '说明 readPixels 的行序与文件头 §复核① 的结论不符。');
    }
    console.log(`✓ 自检 A  行序：与引擎自己的 PNG 逐像素比，按 (ph-1-y) 取有 ${nF}/${n} 个取样点**完全相等**`
      + `（平均差 ${(sF / n).toFixed(4)}），按不翻取只有 ${nD}/${n}（平均差 ${(sD / n).toFixed(4)}）`);
    console.log('          → readPixels 确实是自下而上，旧脚本 `(ph-1-y)` 的写法**是对的**（§10.9 那条怀疑不成立）。');
  }

  // ——————————————————————————————————————————————————————————— 表格
  console.log('\n探针             t       ②ratio   ①Δlum    ③NCC    ③offset(px)     说明');
  for (const r of rows) {
    r.ratio = r.lumA > 1e-6 ? r.lumB / r.lumA : NaN;
    // 基线：模板与目标取同一帧 → "最佳匹配"必须落在 (0,0) 且 NCC≈1。
    // 它同时是判据②的自检：证明 ratio / NCC 这两个量具本身是有意义的，而不是在量噪声。
    r.m = matchTemplate(r.la, r.key === '基线' ? r.la : r.lb, pw, ph, TPL, SEARCH);
    r.matched = Number.isFinite(r.m.ncc) && r.m.ncc >= NCC_MIN;
    r.dist = r.matched ? Math.hypot(r.m.dx, r.m.dy) : 0;
    const nccTxt = Number.isFinite(r.m.ncc) ? fmt(r.m.ncc) : '无定义';
    const offTxt = r.matched ? `(${r.m.dx},${r.m.dy})` : '—';
    const note = r.key === '基线'
      ? '同一帧自匹配：应为 (0,0)、NCC≈1'
      : r.matched
        ? (r.dist >= SHIFT_MIN ? `形状还在、挪了 ${r.dist.toFixed(0)}px` : `形状还在**原处**（只挪了 ${r.dist.toFixed(0)}px）`)
        : `无可信匹配（${r.m.reason ?? 'NCC 低于门槛'}）`;
    console.log(`${r.label.padEnd(14)} ${fmt(r.t)}  ${fmt(r.ratio).padStart(7)}  ${pct(r.diff).padStart(7)}  ${nccTxt.padStart(7)}  ${offTxt.padStart(12)}     ${note}`);
  }
  console.log(`  ③offset = both 帧里最佳匹配相对模板原位的位移（逻辑 px，**屏幕坐标系、y 向下**）；`);
  console.log(`    搜索窗 ±${SEARCH.radius}px / 步长 ${SEARCH.stride}px，模板 ${TPL.size}×${TPL.size} 中心 (${TPL.cx},${TPL.cy})；`);
  console.log(`    "无可信匹配" = best NCC < ${NCC_MIN}：图形已经不在画面里（被推走/淡掉），不是"找不到算法"。`);

  const base = rows[0];
  const inOverlap = rows.slice(1);
  const last = rows[rows.length - 1];

  // 参考行（不进判据）：A 的**大字**紧盒子。方块和文字是 A 的两个独立元素，
  // 两条都动了才说明"整段被带走"，而不是量具只盯住了一个目标。
  console.log(`  参考（不参与判定）A 的大字紧盒子 x${BOX_TEXT.x0}–${BOX_TEXT.x1}/y${BOX_TEXT.y0}–${BOX_TEXT.y1}：`
    + inOverlap.map((r) => `${r.key} Δlum ${pct(r.tDiff)}`).join('，'));

  // ——————————————————————————————————————————————————————————— 判据①
  const minDiff = Math.min(...inOverlap.map((r) => r.diff));
  const ok1 = inOverlap.every((r) => r.diff > DIFF_MIN);

  // ——————————————————————————————————————————————————————————— 判据②
  // 自检：基线处两个会话渲染的是**同一段、同一 t**（xb 还没开始），画面必须逐像素一样
  // → ratio 必须 ≈1。它不成立就说明"ratio 这个量具"本身坏了（比如取错时刻、背景不一致）。
  const baseOk = base.ratio > RATIO_BASE_MIN;
  const ok2 = last.ratio < RATIO_MAX;
  // 额外的可证伪性检查：元素被推走/淡出 → 残留比只能单调往下走，绝不能回升。
  // 这条让②不只是"最后一个点碰巧低"，而是"一路在掉"。
  let mono = true, monoAt = '';
  for (let i = 1; i < inOverlap.length; i++) {
    if (inOverlap[i].ratio > inOverlap[i - 1].ratio + RATIO_TOL) { mono = false; monoAt = `${inOverlap[i - 1].key}→${inOverlap[i].key}`; }
  }

  // ——————————————————————————————————————————————————————————— 判据③
  //
  // 规则是**按匹配可信度分层**的，不是"每个探针都要求位移"：
  //
  //   1. 只要在某个探针上找到了可信匹配（best NCC ≥ NCC_MIN），就要求它**足够锐** ——
  //      即 NCC 门槛保留在**所有能找到匹配的探针**上。这是"不是原地糊掉"那一半。
  //   2. **位移 ≥ SHIFT_MIN 只在 k ≥ SHIFT_MIN_K（40%）的探针上要求**。
  //      理由：`transitionPass` 的位移是 `push·k²`（push=0.36），k=0.1 时在 1920 宽上
  //      **设计上只有 6.7px** —— 那个二次方是故意做"速度感"的。在 k=0.1 上要求位移，
  //      等于在量缓动曲线，而不是在量"推走 vs 糊掉"。（早期版本就是这么把一个**正确**的
  //      转场判成 FAIL 的：10% 实测 16.5px < 24px。）
  //   3. "找不到可信匹配"（best NCC < NCC_MIN）**本身不算失败** —— 元素可能已经淡光/推走了。
  //      但**必须由②的 ratio 兜底**：只有该探针 ratio < RATIO_MAX（确实已经不在画面里）
  //      才放行；否则（元素还在、却匹配不上）算 FAIL，并**说明这是量具/判据的问题**，
  //      不是转场的锅 —— 那种情况必须人来看，不能当通过。
  //   4. 总闸门：**至少要有一个探针量到真实位移**。否则"匹配不上"分不清是
  //      "元素没了"还是"量具坏了"，整个③就失去了意义。
  const verdicts = [];
  for (const r of inOverlap) {
    const needShift = r.k != null && r.k >= SHIFT_MIN_K;
    if (r.matched) {
      // 找到了匹配 → 锐度已满足（matched 的定义就是 NCC ≥ NCC_MIN）
      if (needShift && r.dist < SHIFT_MIN) {
        verdicts.push({ r, ok: false, why: `NCC ${fmt(r.m.ncc)} 够高但只挪了 ${r.dist.toFixed(1)}px（< ${SHIFT_MIN}px，k=${r.k} 已要求位移）—— 是"留在原地"` });
      } else {
        verdicts.push({
          r, ok: true,
          why: needShift
            ? `NCC ${fmt(r.m.ncc)} ≥ ${NCC_MIN}（锐的，不是糊的），位移 (${r.m.dx},${r.m.dy}) = ${r.dist.toFixed(1)}px ≥ ${SHIFT_MIN}px`
            : `NCC ${fmt(r.m.ncc)} ≥ ${NCC_MIN}（锐的，不是糊的）；k=${r.k} < ${SHIFT_MIN_K} 不要求位移（push·k² 此时设计上只有 ~${(0.36 * r.k * r.k * 1920).toFixed(1)}px）`,
        });
      }
    } else {
      // 没匹配上 → 只有在②证明"元素确实已经不在画面里"时才放行
      const gone = r.ratio < RATIO_MAX;
      verdicts.push({
        r, ok: gone,
        why: gone
          ? `无可信匹配（best NCC ${Number.isFinite(r.m.ncc) ? fmt(r.m.ncc) : '无定义'} < ${NCC_MIN}），`
            + `且②的 ratio ${fmt(r.ratio)} < ${RATIO_MAX} —— 元素确实已经不在画面里，放行`
          : `**元素还在画面里（ratio ${fmt(r.ratio)} ≥ ${RATIO_MAX}）却匹配不上**`
            + `（best NCC ${Number.isFinite(r.m.ncc) ? fmt(r.m.ncc) : '无定义'}）—— 这更像量具/判据的问题，不是转场的证据，必须人工看`,
      });
    }
  }
  const anyReal = inOverlap.some((r) => r.matched && r.dist >= SHIFT_MIN);
  const ok3 = verdicts.every((v) => v.ok) && anyReal;

  /* ————————————————————————————————————————————————————————— 输出 */
  console.log('\n① 交叠期 A 的方块确实被改动（紧盒子 x250–470/y210–430 内 mean|lum_only − lum_both| > 1%）');
  say(ok1, `${inOverlap.length} 个探针全部超过阈值（最小 ${pct(minDiff)}）`);

  console.log('\n② A 的方块到交叠结束时已经不在原地（ratio = mean(lum_both)/mean(lum_only)，紧盒子）');
  say(baseOk, `自检：基线 ratio ${fmt(base.ratio)} > ${RATIO_BASE_MIN}（两个会话此时渲染同一段同一 t，画面应逐像素一致 → 量具有意义）`);
  say(ok2, `交叠 95% 时 ratio ${fmt(last.ratio)} < ${RATIO_MAX}（${pct(last.lumA)} → ${pct(last.lumB)}）`);
  say(mono, mono ? `残留比全程单调下降（${inOverlap.map((r) => fmt(r.ratio, 2)).join(' → ')}）` : `残留比在 ${monoAt} 出现回升（超过容差 ${RATIO_TOL}）`);

  console.log('\n③ 是"被推走"而不是"原地糊掉"（NCC 模板匹配，按可信度分层判）');
  for (const v of verdicts) {
    say(v.ok, `交叠 ${v.r.key}：${v.why}`);
  }
  say(anyReal, `总闸门：至少有一个探针量到了真实位移（否则"匹配不上"分不清是"元素没了"还是"量具坏了"）`);

  console.log(`\n总判定：${fails === 0 ? 'PASS ✓ 转场把 A 推走/送走，且不是原地糊掉' : `FAIL ✗ （${fails} 条不满足）`}`);
  console.log(`（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
} catch (err) {
  // 自己主动退出（配置/量具坏了）时 abortCode 已经设好；否则是意外异常
  if (abortCode === 0) { abortCode = 4; console.error(`\n✗ 探针异常：${err?.message ?? err}`); }
  else console.error(`\n✗ ${err?.message ?? err}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  try { vite?.kill(); } catch { /* 已经没了 */ }
  console.log('（已收掉私有 Vite 与 Chrome）');
}
process.exit(abortCode || (fails ? 1 : 0));
}
