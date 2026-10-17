// 抖动统计 —— 「这一整片的 shake 是**手持**还是**振动**」的机械判据。
//
// 由来：`docs/history/IMPROVEMENTS-1-3.md`。用户看成片说「最后那里都快和地震一样了」，查下来是
// `post.shake` 用了**逐帧白噪声**（`hash2(f.idx)`）：60fps 下每 16.7ms 跳到一个新位置，
// 眼睛看到的是"振动"；而真正的手持是 0.5–2Hz 的慢漂移，哪怕幅度大 10 倍也像"呼吸"。
//
// 关键读数是**逐帧变化量**，不是幅度：
//   · 白噪声：每帧跳到新位置 ⇒ 逐帧变化量 ≈ 幅度（比值 ≈ 1）
//   · 平滑：  相邻帧几乎不动 ⇒ 逐帧变化量 ≪ 幅度（比值 ≈ 0.02）
// 实测（promo 收尾 8 帧）：修前 |shake| 峰值 4.99px / 逐帧变化 RMS 3.03px（比值 0.96）；
// 修后 2.44px / 0.04px（比值 0.02）。成片侧用相邻帧互相关量到的是 3.64px vs 0.27px，
// 与设计值同量级 —— 所以**只统计设计值就够了**，不必去解析成片。
//
// 这个文件是纯函数 + 纯数据，Node 与浏览器两侧都能跑（没有 import 任何东西）。

/**
 * @typedef {{ dx: number, dy: number }} ShakeSample 一帧的 post.shake（**物理像素**，y 向下）
 * @typedef {[number, number] | { dx: number, dy: number } | null | undefined} ShakeInput
 */

/** 把各种写法归一成 `{dx, dy}`（场景里 shake 是 `[dx, dy]`；缺省/0 都当 0）。 */
export function normShake(s) {
  if (Array.isArray(s)) return { dx: Number(s[0]) || 0, dy: Number(s[1]) || 0 };
  if (s && typeof s === 'object') return { dx: Number(s.dx) || 0, dy: Number(s.dy) || 0 };
  return { dx: 0, dy: 0 };
}

/**
 * 统计一串 shake 样本。
 *
 * @param {ShakeInput[]} seq 逐帧（每帧一个样本，顺序连续）
 * @param {{ fps?: number, from?: number, warnRatio?: number }} [opts]
 * @returns {{
 *   n: number, fps: number, from: number, to: number,
 *   amp: number, ampRms: number, stepMax: number, stepRms: number, ratio: number,
 *   kind: 'smooth'|'mixed'|'grain'|'none', tailRatio: number,
 *   segments: { from: number, to: number, amp: number, stepRms: number }[],
 *   notices: string[],
 * }}
 */
export function analyzeShake(seq, opts = {}) {
  const fps = opts.fps ?? 60;
  const from = opts.from ?? 0;
  const warnRatio = opts.warnRatio ?? 0.35;
  const n = seq.length;
  const out = {
    n, fps, from, to: from + n / fps,
    amp: 0, ampRms: 0, stepMax: 0, stepRms: 0, ratio: 0,
    kind: /** @type {'smooth'|'mixed'|'grain'|'none'} */ ('none'),
    tailRatio: 1,
    segments: /** @type {{from:number,to:number,amp:number,stepRms:number}[]} */ ([]),
    notices: /** @type {string[]} */ ([]),
  };
  if (!n) return out;

  const a = seq.map(normShake);
  let sumSq = 0, stepSq = 0;
  for (let i = 0; i < n; i++) {
    const s = a[i];
    out.amp = Math.max(out.amp, Math.abs(s.dx), Math.abs(s.dy));
    sumSq += s.dx * s.dx + s.dy * s.dy;
    if (i > 0) {
      const d = Math.hypot(s.dx - a[i - 1].dx, s.dy - a[i - 1].dy);
      out.stepMax = Math.max(out.stepMax, d);
      stepSq += d * d;
    }
  }
  out.ampRms = Math.sqrt(sumSq / n / 2);
  out.stepRms = n > 1 ? Math.sqrt(stepSq / (n - 1)) : 0;
  out.ratio = out.ampRms > 1e-9 ? out.stepRms / out.ampRms : 0;

  // 分段（默认 10 段）：看幅度有没有"只升不降"
  const segs = Math.max(1, Math.min(40, opts.segments ?? 10));
  const per = Math.max(1, Math.ceil(n / segs));
  for (let s = 0; s < n; s += per) {
    const end = Math.min(n, s + per);
    let amp = 0, sq = 0, m = 0;
    for (let i = s; i < end; i++) {
      amp = Math.max(amp, Math.abs(a[i].dx), Math.abs(a[i].dy));
      if (i > s) { const d = Math.hypot(a[i].dx - a[i - 1].dx, a[i].dy - a[i - 1].dy); sq += d * d; }
      m++;
    }
    out.segments.push({ from: from + s / fps, to: from + end / fps, amp, stepRms: m > 1 ? Math.sqrt(sq / (m - 1)) : 0 });
  }

  // 判定：把"逐帧变化 ≈ 幅度"当作白噪声指纹（阈值 0.35 是实测 0.96 vs 0.02 之间的位置）
  if (out.amp < 0.05) out.kind = 'none';                 // 基本没抖
  else if (out.ratio >= warnRatio) out.kind = 'grain';
  else if (out.ratio >= warnRatio * 0.45) out.kind = 'mixed';
  else out.kind = 'smooth';

  // 收尾是不是还在抖（"镜头停住了、画面还在晃"才像地震）。
  // ⚠ 两个门槛缺一不可：比值大**且**收尾自己的幅度也够大。
  //    只看比值会误报 —— 实测 promo 5–10s 那一段收尾从 0.43px 升到 1.23px，
  //    比值 1.40 但 1.23px 本来就只是"呼吸"，不该报警。
  // ⚠ `checkTail: false` 用于**只跑片段**的场景（那种"收尾"只是区间的收尾，不是片子的收尾）。
  const mid = out.segments.slice(Math.max(1, Math.floor(out.segments.length * 0.2)), Math.max(2, Math.floor(out.segments.length * 0.8)));
  const tail = out.segments[out.segments.length - 1];
  const midAmp = mid.length ? Math.max(...mid.map((s) => s.amp)) : out.amp;
  out.tailRatio = midAmp > 0.05 ? tail.amp / midAmp : 1;

  if (out.kind === 'grain') {
    out.notices.push(
      `逐帧变化量是幅度的 ${(out.ratio * 100).toFixed(0)}%（白噪声指纹：每帧都在跳到新位置）—— ` +
      `60fps 下这是**振动**，不是手持。改成 t 的平滑函数：post.shake = shakeSmooth(f.t, amp)`);
  } else if (out.kind === 'mixed') {
    out.notices.push(`逐帧变化量是幅度的 ${(out.ratio * 100).toFixed(0)}%，介于平滑与白噪声之间 —— 抖得偏"毛"`);
  }
  if (opts.checkTail !== false && out.tailRatio > 1.25 && tail.amp > 2.5) {
    out.notices.push(`收尾段幅度 ${tail.amp.toFixed(2)}px，是中间段的 ${out.tailRatio.toFixed(2)}×` +
      `（镜头停住之后还在晃，最容易被看成"地震"）—— 让幅度随"停住"衰减，例如 amp * (1 - 0.75 * settle)`);
  }
  if (out.amp > 5 && out.kind !== 'smooth') {
    out.notices.push(`峰值 ${out.amp.toFixed(1)}px 已经超过"手持"的量级（≤2px 呼吸 / 3–5px 手持 / ≥5px 冲击）`);
  }
  return out;
}

/** 一行摘要（`anim shake` 和 `video` 收尾共用，保证口径一致）。 */
export function shakeSummary(r) {
  const kind = { smooth: '平滑（像手持）', mixed: '偏毛（半平滑）', grain: '逐帧白噪声（像振动）', none: '基本没有抖动' }[r.kind];
  return `${r.n} 帧 · 峰值 ${r.amp.toFixed(2)}px · RMS ${r.ampRms.toFixed(2)}px · 逐帧变化 RMS ${r.stepRms.toFixed(2)}px · 比值 ${r.ratio.toFixed(2)} ⇒ ${kind}`;
}
