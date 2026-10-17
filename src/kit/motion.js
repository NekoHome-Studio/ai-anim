// @ts-check
/**
 * `src/kit/motion.js` —— **运动规则**的三个纯函数（规则表：`docs/MOTION.md`）。
 *
 * ## 抄来的数值是哪几个、出处是哪一行
 *
 * 全部出自 `docs/REFERENCE-hyperframes.md` **§4.4「关键帧 / 运动的原子规则」**
 * （外部项目 `heygen-com/hyperframes`；我们只拿它的**调参成果**，不抄实现）：
 *
 * | 函数 | 抄来的数值 | 出处（`docs/REFERENCE-hyperframes.md`） |
 * |---|---|---|
 * | `nudgeCurve(t, t0, dur, dist)` | 距离分配 **10 / 65 / 25**（`power3.in` → 线性 → `power4.out`），**尾部时长 ≥ 3× 加速段** | **516 行**（`nudge-curve` 那条） |
 * | `waterfallStagger(items, stagger, maxStagger)` | **`items × stagger ≤ ~0.5s`**（把一组的到达压成"一个节拍"） | **535 行**（共享契约里那一条）；"到达不要用淡入，要用二值出现"在 **517 行** |
 * | `glowPeakCap(values, cap)` | **峰值 opacity ≤ ~0.45** | **522 行**（`ambient-glow-bloom` 那条） |
 *
 * **550 行** / **551 行** / **552 行** 分别是这三个函数的提案本身；**556 行** 的原话是这些数字
 * "可以直接变成 kit 函数的默认值 —— 这是把别人的调参成果免费拿走，单位成本几乎为零"。
 *
 * ⚠ **这些是外部经验值，我方还没实测**（证据分级见 `docs/MOTION.md` §0）。
 * 本文件里属于**我们自己**的只有数学性质：端点、单调、两处接缝速度相等 ——
 * 由 `tools/test-motion.mjs` 钉住。
 *
 * ## 三段式的时长不是拍脑袋定的（这条可以当场验算）
 *
 * 距离 10/65/25、又要"慢-快-慢"，那**两处接缝的速度必须相等**。设三段时长 d1/d2/d3：
 *
 *   · 第 1 段 `power3.in`：位移 = 0.10·dist·x³            ⇒ 段末速度 = 0.30·dist/d1
 *   · 第 2 段线性：      位移 = 0.65·dist·x              ⇒ 速度     = 0.65·dist/d2
 *   · 第 3 段 `power4.out`：位移 = 0.25·dist·(1−(1−x)⁴)   ⇒ 段首速度 = 1.00·dist/d3
 *
 * 令三者相等 ⇒ **d1 : d2 : d3 = 2/13 : 1/3 : 20/39**（≈ 0.154 : 0.333 : 0.513 个 `dur`）。
 * 于是 **d3/d1 = 10/3 ≈ 3.33 ≥ 3** —— §4.4 那条"尾部时长 ≥ 3× 加速段"**自动成立**，
 * 不用另外凑一个数；整条曲线 C¹ 连续（速度不断），这正是"慢-快-慢"接得住的原因。
 *
 * ## 边界
 *
 * **不 import 任何模块**（全是初等运算），更不碰 GPU / 浏览器 —— 所以
 * `node tools/test-motion.mjs` 能直接测。三个函数都**无副作用**：不改参数、不读时钟、
 * 不认识 `ctx`。要告警就把返回对象里的 `warning` 交给调用方
 * （例如 `ctx.warnings.push(...)`）—— **这里只判定，不喊**。
 *
 * 参数写错（NaN / ±Inf / 数组里混进非数字）一律**当场抛**，不静默返回 NaN：
 * 画面里的 NaN 是整屏白，而引擎不会报错（`AGENTS.md` §5.5），那种失败查起来比抛错贵得多。
 */

/**
 * §4.4 `nudge-curve` 的**距离分配**：加速 / 爆发 / 收尾 = 10 / 65 / 25（占 `dist` 的比例）。
 * 出处：`docs/REFERENCE-hyperframes.md` 516 行。
 */
export const NUDGE_SPLIT = [0.10, 0.65, 0.25];

/**
 * **三段时长**（占 `dur` 的比例）—— 这一组是我们**推导**出来的，不是抄的（推导见文件头）：
 * 距离按 10/65/25、又要求两处接缝速度相等 ⇒ d1 : d2 : d3 = 2/13 : 1/3 : 20/39。
 * 副产品：`NUDGE_PHASE[2] / NUDGE_PHASE[0] = 10/3 ≥ 3`，§4.4 的"尾部 ≥ 3× 加速段"自动满足。
 */
export const NUDGE_PHASE = [2 / 13, 1 / 3, 20 / 39];

/**
 * §4.4 共享契约里的 **`items × stagger ≤ ~0.5s`**（把一组的到达压成"一个节拍"）。
 * 出处：`docs/REFERENCE-hyperframes.md` 535 行。
 */
export const MAX_STAGGER_SPAN = 0.5;

/**
 * §4.4 `ambient-glow-bloom` 的 **「峰值 opacity ≤ ~0.45」**。
 * 出处：`docs/REFERENCE-hyperframes.md` 522 行。
 */
export const GLOW_PEAK_CAP = 0.45;

/** 参数必须是有限数：NaN / ±Inf 一路传下去就是整屏白，而且引擎不报错。 */
function need(who, ...vals) {
  for (const v of vals) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError('motion: ' + who + ' 的参数必须是有限数，收到 ' + String(v)
        + ' —— NaN / ±Inf 传下去会变成整屏白，而且引擎不会报错（AGENTS.md §5.5）。');
    }
  }
}

/** 数字写成短字符串（告警里给人看的，不留 toFixed 的尾零）。 */
function num(x) {
  return String(Math.round(x * 1000) / 1000);
}

/**
 * `nudge-curve`：慢-快-慢的**三段式整组位移**，返回这一时刻的**位移量**。
 *
 * 用在哪：一整组东西（一行字、一排读数、一块面板）**一起**被推一下 —— 让人感觉到
 * "被推动 / 弹出去 / 滑到位"，而不是各自弹各自的。单个元素要**回弹**手感用
 * `spring()`（`src/core/util.js`，指数弹簧解析解）；这里给的是**只有一次爆发、没有回弹**的位移。
 *
 * ```js
 * const dx = nudgeCurve(f.lt, 0.6, 1.3, 220);     // 0.6s 起、1.3s 内向右推 220px
 * lines.fillRect(panel.x + dx, panel.y, panel.w, panel.h, P.bone);
 * ```
 *
 * 三段（`NUDGE_PHASE` 是时长比例、`NUDGE_SPLIT` 是距离比例）：
 * `power3.in` 加速（10% 距离）→ 线性爆发（65%）→ `power4.out` 收尾（25%）。
 * 出处：`docs/REFERENCE-hyperframes.md` **516 行**（`nudge-curve`）、**550 行**（提案）。
 *
 * @param {number} t 时间（秒）—— 场景里是 `f.lt`，整片里是 `f.t`
 * @param {number} t0 这次位移的起始时刻
 * @param {number} dur 总时长（秒）；**≤ 0** = "一到 t0 就直接落定"（不除零、不出 NaN）
 * @param {number} dist 总位移量（像素）；**负数 = 反方向**
 * @returns {number} 位移量：t ≤ t0 → 0；t ≥ t0+dur → dist；中间**单调、不回弹**
 */
export function nudgeCurve(t, t0, dur, dist) {
  need('nudgeCurve', t, t0, dur, dist);
  const x = t - t0;
  if (x <= 0) return 0;
  if (!(dur > 0) || x >= dur) return dist;
  const p = x / dur;
  const [f1, f2, f3] = NUDGE_PHASE;
  if (p < f1) return dist * NUDGE_SPLIT[0] * (p / f1) ** 3;
  if (p < f1 + f2) return dist * (NUDGE_SPLIT[0] + NUDGE_SPLIT[1] * ((p - f1) / f2));
  return dist * (NUDGE_SPLIT[0] + NUDGE_SPLIT[1]
    + NUDGE_SPLIT[2] * (1 - (1 - (p - f1 - f2) / f3) ** 4));
}

/**
 * **纯判据**：这组错峰是不是超了 `items × stagger ≤ maxStagger`（§4.4，535 行）。
 *
 * 与 `waterfallStagger(...).capped` **同一个口径**（后者就是调它判的）——
 * 静态扫描（读场景代码里的 stagger 字面量）与运行时归一化不许各算一套。
 *
 * @param {number} items 元素个数（非整数向下取整）
 * @param {number} stagger 每个元素的延迟（秒）
 * @param {number} [maxStagger] 上限（秒），默认 §4.4 的 0.5
 * @returns {boolean} true = 超过上限，需要压回来
 */
export function waterfallOver(items, stagger, maxStagger = MAX_STAGGER_SPAN) {
  need('waterfallOver', items, stagger, maxStagger);
  return Math.max(0, Math.floor(items)) * stagger > maxStagger;
}

/**
 * `waterfall-entry` 的**归一化**：把"一组元素错峰到达"的总跨度压回 `items × stagger ≤ maxStagger`。
 *
 * 用在哪：一行字 / 一排卡片**级联**到位（每个元素在前一个还没落定之前就开始 → 加速的波 →
 * 最后收敛）。传进去的 `stagger` 直接喂 `type.write`：
 *
 * ```js
 * const w = waterfallStagger(str.length, 0.12);          // 想给 0.12s/字
 * type.write(str, x, y, { t: f.lt, stagger: w.stagger }); // 超了就是 0.5s/N，没超就是 0.12
 * if (w.capped) ctx.warnings.push(w.warning);            // 喊一声交给调用方（本函数不喊）
 * ```
 *
 * 口径（照 §4.4 的**字面**那条，535 行）：`items × stagger`，**不是** `(items−1) × stagger`。
 * 所以 1 个元素配 0.9s 也会被压到 0.5s —— 一个元素本来就没有级联，压不压看不出来；
 * 好处是判据与出处逐字对得上。**物理上的级联跨度**是 `span = (items−1) × stagger`
 * （最后一个元素真正开始的时间），它恒 ≤ `total`，也一并返回。
 *
 * ⚠ 到达**不要用淡入**（§4.4 517 行："never fade an arrival"）—— 见 `docs/MOTION.md` §3.3。
 *
 * @param {number} items 元素个数（非整数向下取整；0 = 没有元素）
 * @param {number} stagger 原本想给的每项延迟（秒）
 * @param {number} [maxStagger] 跨度上限（秒），默认 §4.4 的 0.5
 * @returns {{ items: number, stagger: number, total: number, span: number,
 *   rawStagger: number, rawTotal: number, maxStagger: number, capped: boolean,
 *   warning: string | null }} 归一化结果：`stagger` 可直接喂 `type.write`
 */
export function waterfallStagger(items, stagger, maxStagger = MAX_STAGGER_SPAN) {
  need('waterfallStagger', items, stagger, maxStagger);
  const n = Math.max(0, Math.floor(items));
  const rawTotal = n * stagger;
  const capped = n > 0 && waterfallOver(n, stagger, maxStagger);
  const s = capped ? maxStagger / n : stagger;
  return {
    items: n,
    stagger: s,
    total: n * s,
    span: Math.max(0, n - 1) * s,
    rawStagger: stagger,
    rawTotal,
    maxStagger,
    capped,
    warning: capped
      ? '错峰到达超限：' + n + ' 项 × ' + num(stagger) + 's = ' + num(rawTotal)
        + 's > 上限 ' + num(maxStagger) + 's —— 已压到每项 ' + num(s)
        + 's（§4.4：items × stagger ≤ ~0.5s；一组到达要的是"一个节拍"，不是一串独奏）'
      : null,
  };
}

/**
 * `ambient-glow-bloom` 的**峰值上限判据**：辉光 / 光晕的峰值 opacity 不许超过 `cap`。
 *
 * 用在哪：hero 元素背后那层"无触发的柔光"（以及 `post` 的 `bloom` / `halation` 之前，
 * 你自己叠的那层径向辉光）。**峰值超限的辉光会把主体糊掉**，而且我们原来的文档里
 * 只有"信号色才允许超过 0.85 线性亮度去泛光"（AGENTS.md §5），**没有一条数值上限**。
 *
 * ```js
 * const g = glowPeakCap([{ id: 'hero', peak: 0.62 }, { id: 'rim', peak: 0.3 }]);
 * if (!g.ok) { ctx.warnings.push(g.warning); hero.alpha = g.suggested[0]; }
 * ```
 *
 * 出处：`docs/REFERENCE-hyperframes.md` **522 行**（"峰值 opacity ≤ ~0.45"）、**552 行**（提案）。
 * ⚠ 0.45 是**外部经验值，我方未实测**（`docs/MOTION.md` §0）。
 *
 * **不静默通过**：`values` 里是 NaN / ±Inf（或根本不是数字）时不会当成"没超限"，
 * 而是记进 `over` 并标 `reason: '不是有限数'` —— "空 ≠ 干净"这条纪律在纯函数这一层也成立。
 *
 * @param {(number | { id?: string, peak: number })[]} values 各项峰值（数字，或 `{ id, peak }`）
 * @param {number} [cap] 上限，默认 §4.4 的 0.45
 * @returns {{ cap: number, count: number, peak: number, ok: boolean,
 *   over: { i: number, id: string, value: number, suggested: number, reason: string }[],
 *   suggested: number[], warning: string | null }}
 *   `over` = 超限项（按原下标）；`suggested` = 与输入**等长**的建议值数组；`peak` 只统计有限值
 */
export function glowPeakCap(values, cap = GLOW_PEAK_CAP) {
  need('glowPeakCap', cap);
  if (!Array.isArray(values)) {
    throw new TypeError('motion: glowPeakCap 的 values 必须是数组（数字，或 { id, peak }），收到 '
      + typeof values + '。');
  }
  /** @type {number[]} */ const suggested = [];
  /** @type {{ i: number, id: string, value: number, suggested: number, reason: string }[]} */ const over = [];
  let peak = 0;
  for (let i = 0; i < values.length; i++) {
    const e = values[i];
    const obj = e !== null && typeof e === 'object';
    if (obj && typeof e.peak !== 'number') {
      throw new TypeError('motion: glowPeakCap 第 ' + i
        + ' 项是对象但没有数值型的 .peak —— 写成 { id, peak }（写错不静默，与镜头参数同一条哲学）。');
    }
    const v = obj ? e.peak : /** @type {number} */ (e);
    const id = obj && e.id != null ? String(e.id) : String(i);
    if (!Number.isFinite(v)) {
      over.push({ i, id, value: v, suggested: cap, reason: '不是有限数' });
      suggested.push(cap);
      continue;
    }
    if (v > peak) peak = v;
    if (v > cap) {
      over.push({ i, id, value: v, suggested: cap, reason: '超过上限' });
      suggested.push(cap);
    } else {
      suggested.push(v);
    }
  }
  return {
    cap,
    count: values.length,
    peak,
    ok: over.length === 0,
    over,
    suggested,
    warning: over.length === 0 ? null
      : '辉光峰值超限：' + over.length + '/' + values.length + ' 项 —— '
        + over.map((o) => o.id + '=' + num(o.value)).join('、')
        + '（上限 ' + num(cap) + '；§4.4 ambient-glow-bloom 的「峰值 opacity ≤ ~0.45」）',
  };
}
