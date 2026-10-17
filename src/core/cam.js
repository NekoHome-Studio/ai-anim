// @ts-check
/**
 * 世界摄影机 —— pdoom-video 那套「运镜」的内核。
 *
 * ## 为什么需要它
 *
 * 引擎原先的"摄影机"是 `cameraAt(t)` → post 的 `zoom` / `shake`：全帧一起动，切镜头
 * 不会断。这解决了 80% 的问题，但有两个它做不到的事：
 *
 *   ① **推近没有不动点**。post 的 `zoom` 永远绕 `center` 缩放 —— 你想"推近到那个人
 *      手里的笔"，就得自己反算 center 每一帧该在哪，而且和 shake 叠在一起时算不准。
 *   ② **没有速度**。想做"甩镜"就得知道摄影机这一帧往哪走、走多快；post 的参数是
 *      结果，不是速度。
 *
 * pdoom 的做法是：**摄影机是一个 t 的函数**，输出 `{x, y, zoom, rot}`（2D 世界）或
 * `{pos, yaw, pitch, roll, fov}`（3D），然后：
 *
 *   · 关键帧之间**在对数空间插值 zoom**（`z = a.z * (b.z/a.z)^k`）—— 线性插值会让
 *     推近"前快后慢"地怪，取对数之后倍率变化才是匀速的。
 *   · 推近时算一个**不动点** `f = (b.z*b.c - a.z*a.c)/(b.z - a.z)`，整段插值绕它做，
 *     于是"拉远 + 平移"读起来是**一个手势**，而不是两个动作叠在一起。
 *   · 需要换机位时用 `mixCam(a, b, k)` 把两台机位**混**出来（含 zoom 的对数插值），
 *     于是"从贴地跟拍转到俯视全景"是一次连续的运动，不是一次跳变。
 *   · 甩镜用**速度**：`camVelocity()` / `smearTimes()` 给这一帧的位移，场景把几何
 *     沿它重画几份（见 `smearAlpha`）。
 *
 * ## 三种"3D"里这一层负责哪一种
 *
 * pdoom 的 3D 其实有三种，别混：
 *
 *   1. **解析投影 + 线段批**（`room.ts` 的图书馆过道、`loss.ts` 的损失地形）：JS 里把
 *      世界点投到屏幕，交给 GPU 画胶囊线段。**大部分"3D 镜头"都是这一类**，成本极低。
 *      本文件的 `project` / `project3` / `clipSegment` / `depthScale` 就是为它准备的。
 *   2. **真 raymarch**（`ilya-glsl.ts` / `paperclips-glsl.ts` / `shoggoth-glsl.ts`）：
 *      全屏 shader 里 march 一个 SDF 场景。见 `glsl3d.js`。
 *   3. **真 3D 引擎**（`stack.ts`）：`PerspectiveCamera` + 深度测试。
 *      **本引擎现在有了这一层**：`src/core/three-bridge.js` + `src/kit/three.js`
 *      （Three.js，真网格；规格见 `docs/ENGINE.md` §3.8，写法见 `docs/THREE.md`）。
 *      要做"很多个同样的东西 / 材质光照 / 以后导入 .glb"才用它；
 *      能用线段或数学式子写出来的画面，仍然优先 ① / ②（零依赖零素材）。
 *      ⚠ 它与 ① **共用同一套世界坐标与同一个投影公式**（`x_px = (x_view/-z_view)·focal + W/2`，
 *      `focal = (H/2)/tan(fov/2)`）—— 所以同一台相机下，引擎画的线框与 Three.js 画的实体逐像素同位。
 *
 * ## 三条纪律（和引擎其它部分一样）
 *
 * 1. **只用整片时间 `f.t`**。摄影机是"全片一台"，参数只跟 t 走 —— 这样切镜头时它
 *    不会断，这是"看起来像一镜到底"的一半。段内时间 `f.lt` 只在真的以段为单位的
 *    东西（旁白、字幕）上用。
 * 2. **不用 `Math.random`**，也别用 `Date.now()`。抖动要么是 `t` 的平滑函数
 *    （`shakeSmooth` / `handheld(..., {mode:'smooth'})`，默认），要么是**故意**的
 *    逐帧噪声（`{mode:'grain'}`，用 `f.idx` 播种，同一帧的所有子帧同值）。
 *    ⚠ 反过来是更常见的坑：**平滑函数用 `t` 是对的**（一帧内子帧差 ~0.02px，
 *    不会双重曝光），而**白噪声用 `f.idx`** —— 两者别写反。见 `docs/history/IMPROVEMENTS-1-3.md`。
 * 3. **写不成时间的函数就别写**。关键帧插值天然是 t 的纯函数，不要做"上一帧位置 +
 *    速度"这种积分。
 *
 * @example
 * ```js
 * import { makeCam, project, camVelocity, smearTimes, smearAlpha, handheld, shakeSmooth } from '../../../src/core/cam.js';
 *
 * const CAM = makeCam([
 *   //  时间                     世界坐标            缩放   滚转   这一段用的缓动
 *   [ 0.0,                  { x: 0,   y: 2.0 }, 0.80,  0.02],
 *   [ 1.2,                  { x: 0.3, y: 2.0 }, 0.80,  0.02, 'linear'],   // 停一拍
 *   [ 1.9,                  { x: 3.2, y: 0.4 }, 2.60, -0.06, 'outExpo'],  // 甩过去并推近
 *   [ 3.4,                  { x: 3.4, y: 0.5 }, 2.10, -0.03, 'inOutCubic'],
 * ]);
 *
 * render(ctx) {
 *   const { f, W, H, lines } = ctx;
 *   const cam = handheld(CAM.at(f.t), f.t, f.idx, { amp: 0.004 });
 *   const ts = smearTimes(CAM, f.t, f.dt);        // 甩镜时给出 [t-Δ, t-Δ/2, t] 这样的时刻
 *   lines.begin();
 *   for (const tt of ts) {                        // 沿速度重画几份 = 方向性拖影
 *     const c = CAM.at(tt);
 *     lines.polyline(projectLine(c, W, H, WORLD_PATH), 2, [0.9, 0.3, 0.1, smearAlpha(ts.length)]);
 *   }
 *   lines.flush(ctx.out);
 *   return { bloom: 0.35, ca: 0.8 };              // post 照常返回
 * }
 * ```
 */

import { clamp, ease, hash2, lerp, noise1, sat } from './util.js';

/** @typedef {{ x: number, y: number, zoom: number, rot: number }} Cam2D */

/** 缓动名 → 函数，非法名字退化成 linear（和 `prog` 的容错口径一致）。 */
function ez(name) {
  const f = ease[/** @type {keyof typeof ease} */ (name)];
  return typeof f === 'function' ? f : ease.linear;
}

/** 对数空间插值：倍率匀速变化，避免线性插值的"前快后慢"。 */
export function zoomLerp(a, b, k) {
  return Math.exp(lerp(Math.log(Math.max(1e-6, a)), Math.log(Math.max(1e-6, b)), sat(k)));
}

/**
 * 把两台 2D 机位混成一台。**zoom 走对数**。
 *
 * ⚠ 要注意的坑：直接线性混 `x/y` 会让"推近"读成一条弧。pdoom 的做法是先把两台机位
 * 各自换算到**同一个 zoom** 下的中心点，再线性混 —— 这样中间帧的中心点始终落在
 * "从 a 看向 b"的那条直线上，推近是一个手势而不是一次漂移。
 *
 * @param {Cam2D} a @param {Cam2D} b @param {number} k 0 = 全 a，1 = 全 b
 * @returns {Cam2D}
 */
export function mixCam(a, b, k) {
  const kk = sat(k);
  const z = zoomLerp(a.zoom, b.zoom, kk);
  // 把两个中心点都归一化到 z 的尺度上再混：屏幕上的同一世界点不会因为中途换机位而漂
  const ax = a.x * (a.zoom / z);
  const ay = a.y * (a.zoom / z);
  const bx = b.x * (b.zoom / z);
  const by = b.y * (b.zoom / z);
  return {
    x: lerp(ax, bx, kk),
    y: lerp(ay, by, kk),
    zoom: z,
    rot: lerp(a.rot, b.rot, kk),
  };
}

/**
 * 关键帧摄影机：`at(t)` 返回这一帧的 `{x, y, zoom, rot}`。
 *
 * 关键帧写法 `[t, { x, y }, zoom, rot?, ease?]`；`ease` 是**这一帧段**的缓动
 * （默认 `inOutCubic`），语义和 `keys()` 一致 —— 段外取端值。
 *
 * **自动不动点**：当一段的 zoom 变化超过 `pivotMin` 时，这段插值绕不动点做，
 * 即 `f = (z1*c1 - z0*c0)/(z1 - z0)`，然后 `c = f - (z0/z)*(f - c0)`。
 * 效果：镜头是"对着那个点推过去"，而不是"一边缩一边飘"。
 *
 * @param {Array<[number, {x: number, y: number}, number, number?, string?]>} ks
 * @param {{ pivotMin?: number, zoomBase?: number }} [opts]
 */
export function makeCam(ks, opts = {}) {
  if (!Array.isArray(ks) || ks.length === 0) throw new Error('makeCam: 至少要有一个关键帧');
  const pivotMin = opts.pivotMin ?? 0.04;
  const zBase = opts.zoomBase ?? 1;
  /** 规整成内部结构（只做一次，运行时是纯查表） */
  const K = ks
    .map((k, i) => {
      if (!Array.isArray(k) || typeof k[0] !== 'number' || !k[1] || typeof k[1].x !== 'number') {
        throw new Error(`makeCam: 第 ${i} 个关键帧格式不对，应为 [t, {x, y}, zoom, rot?, ease?]`);
      }
      return {
        t: k[0],
        x: k[1].x,
        y: k[1].y,
        z: Math.max(1e-6, (k[2] ?? 1) * zBase),
        rot: k[3] ?? 0,
        ez: k[4] ?? 'inOutCubic',
      };
    })
    .sort((a, b) => a.t - b.t);

  const K0 = K[0];
  const KL = K[K.length - 1];

  /** @param {number} t @returns {Cam2D} */
  function at(t) {
    if (t <= K0.t) return { x: K0.x, y: K0.y, zoom: K0.z, rot: K0.rot };
    if (t >= KL.t) return { x: KL.x, y: KL.y, zoom: KL.z, rot: KL.rot };
    for (let i = 1; i < K.length; i++) {
      const b = K[i];
      if (t > b.t) continue;
      const a = K[i - 1];
      const k = ez(b.ez)(clamp((t - a.t) / Math.max(1e-4, b.t - a.t)));
      const z = zoomLerp(a.z, b.z, k);
      const rot = lerp(a.rot, b.rot, k);
      // zoom 变化够大 → 绕不动点做，推近/拉远读成一个手势
      if (Math.abs(b.z - a.z) > a.z * pivotMin) {
        const fx = (b.z * b.x - a.z * a.x) / (b.z - a.z);
        const fy = (b.z * b.y - a.z * a.y) / (b.z - a.z);
        return { x: fx - (a.z / z) * (fx - a.x), y: fy - (a.z / z) * (fy - a.y), zoom: z, rot };
      }
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), zoom: z, rot };
    }
    return { x: KL.x, y: KL.y, zoom: KL.z, rot: KL.rot };
  }

  return { keys: K, at, start: K0.t, end: KL.t };
}

/**
 * 摄影机在这一帧的**位移**（世界单位 / 秒），中心差分。
 *
 * 这是"甩镜"的入口：拿到速度就知道该往哪甩、甩多快。因为它是 `t` 的纯函数，
 * 子帧之间天然一致，不会像逐帧累积那样在运动模糊下糊成两团。
 *
 * @param {{ at: (t: number) => Cam2D }} cam @param {number} t @param {number} dt
 * @returns {{ vx: number, vy: number, speed: number, dir: [number, number] }}
 */
export function camVelocity(cam, t, dt) {
  const h = Math.max(1e-4, dt * 0.5);
  const a = cam.at(t - h), b = cam.at(t + h);
  const vx = (b.x - a.x) / (2 * h);
  const vy = (b.y - a.y) / (2 * h);
  const speed = Math.hypot(vx, vy);
  return { vx, vy, speed, dir: speed > 1e-6 ? [vx / speed, vy / speed] : [0, 0] };
}

/**
 * 甩镜的**采样时刻**：返回这一帧之内往回推的几个时刻（最后一个是 `t` 本身），
 * 用它们各画一遍几何就是方向性拖影。
 *
 * 这是 pdoom `stack.ts` 的原式：`dyRaw = (pos(t) - pos(t - shutter)) * P`，
 * 然后每根线复制 `NS` 份、每份 `al / NS * 1.6`。**在几何上做、不在后处理上做** ——
 * 后处理会把不动的背景一起糊掉，看起来像镜头脏了，不像镜头在甩。
 *
 * @param {{ at: (t: number) => Cam2D }} cam
 * @param {number} t @param {number} dt
 * @param {{ shutter?: number, maxSamples?: number, unit?: number, maxTravel?: number }} [opts]
 *        shutter 快门开角（1 = 一整帧，pdoom 用 0.9）；unit 每份拖影代表多少世界单位；
 *        maxTravel 单帧最大位移（超过就只画这么多，避免极快时糊成一片）
 * @returns {number[]} 时刻数组，从最早到 `t`
 */
export function smearTimes(cam, t, dt, opts = {}) {
  const shutter = opts.shutter ?? 0.9;
  const maxSamples = opts.maxSamples ?? 12;
  const unit = opts.unit ?? 0.1;
  const maxTravel = opts.maxTravel ?? 1.8;
  const span = Math.max(1e-4, dt * shutter);
  const back = cam.at(t - span);
  const now = cam.at(t);
  const travel = Math.min(Math.hypot(now.x - back.x, now.y - back.y), maxTravel);
  const n = Math.max(1, Math.min(maxSamples, Math.ceil(travel / unit)));
  const out = [];
  for (let i = 0; i < n; i++) out.push(n > 1 ? t - span * (1 - i / (n - 1)) : t);
  return out;
}

/**
 * 一份拖影的 alpha。`n` 份叠起来的总墨水要接近"不拖影时的一份"，但甩镜时本来就该
 * 更亮一点（速度感），所以乘 1.6 —— 这个数是 pdoom 调出来的，别随便改小。
 * @param {number} n @param {number} boost
 */
export function smearAlpha(n, boost = 1.6) {
  return n > 1 ? boost / n : 1;
}

/**
 * 手持抖动。
 *
 * ⚠ **默认是 `mode: 'smooth'`（低频漂移）**，因为「像不像手持」取决于**频率**，不是幅度：
 * 60fps 下逐帧换一个随机位置（白噪声）看着是**振动**，哪怕只有 5px；而 0.5–2Hz 的慢漂移
 * 即使有 38px 也像"有人扶着机器"。这条教训来自 `docs/history/IMPROVEMENTS-1-3.md`：引擎以前只有
 * 白噪声那一条路，并且被当成"手持"推荐出去，做 promo 时被用户当成地震（成片实测
 * 逐帧位移 RMS 3.64px、相邻帧差 13px；改成平滑后 0.27px / 1px）。
 *
 * 两种模式：
 * · `'smooth'`（默认）：`noise1(t·hz)` 的低频值噪声，**用 `t` 不用 `idx`**。一帧的 8 个
 *   子帧之间只差 ~0.02px —— 既不会双重曝光，又会像真实手持那样被运动模糊带一点。
 *   幅度随镜头停住衰减这件事**要调用方自己乘**（例如 `amp * (1 - settle)`）。
 * · `'grain'`：保留老的 `hash2(idx)` 逐帧白噪声，**只给"震屏/冲击"这类故意要抖的场合**
 *   （爆炸、砸字、故障感）。它的幅度与逐帧变化量同级，是"噪声"不是"手持"。
 *
 * @param {Cam2D} cam @param {number} t @param {number} idx 帧号（`f.idx`，只有 grain 模式用）
 * @param {{ amp?: number, ampRot?: number, seed?: number, mode?: 'smooth'|'grain', hz?: number }} [opts]
 *        `amp` 单位是整个世界单位；`hz` 只对 smooth 生效（默认 0.85，建议 ≤ 1.5）
 * @returns {Cam2D} 新的机位（不改原对象）
 */
export function handheld(cam, t, idx, opts = {}) {
  const amp = opts.amp ?? 0;
  if (amp <= 0) return cam;
  const ampRot = opts.ampRot ?? amp * 0.004;
  if ((opts.mode ?? 'smooth') === 'grain') {
    const s = opts.seed ?? 1;
    const ax = (hash2(idx, s) - 0.5) * 2 * amp;
    const ay = (hash2(idx, s + 17) - 0.5) * 2 * amp;
    const ar = (hash2(idx, s + 31) - 0.5) * 2 * ampRot;
    return { x: cam.x + ax, y: cam.y + ay, zoom: cam.zoom, rot: cam.rot + ar };
  }
  const [ax, ay] = shakeSmooth(t, amp, { hz: opts.hz, seed: opts.seed });
  const ar = (noise1(t * (opts.hz ?? 0.85) * 0.7 + (opts.seed ?? 1) * 5.7) - 0.5) * 2 * ampRot;
  return { x: cam.x + ax, y: cam.y + ay, zoom: cam.zoom, rot: cam.rot + ar };
}

/**
 * 平滑手持抖动 —— **直接喂给 `post.shake`** 的 `[dx, dy]`。
 * ⚠ 单位是**物理像素**（与 `post.shake` 一致，见 core/post.js 的说明）：`--scale 2`（4K）下
 *   同样数值的视觉位移只有 1080p 的一半，要跨分辨率一致就乘 `scale`。
 *
 * 用两层低频值噪声叠出来：主层 `hz`（默认 0.85Hz ≈ 1.2 秒一个来回）+ 一层 3 倍频的
 * 细节（权重 0.4，让轨迹不至于太"数学"）。全部是 `t` 的连续函数，所以：
 * 任意 seek 都对得上；一帧内的多个子帧只差一点点（不会双重曝光，但会被运动模糊带一点）。
 *
 * 幅度参考（`docs/ENGINE.md` §5 有同一张表）：**≤ 2px 是呼吸、3–5px 是手持、
 * ≥ 5px 是冲击/不稳**；而且要**随"镜头停住"衰减**，否则镜头刹住之后画面上只剩抖动，
 * 那才是"越到后面越像地震"。
 *
 * ```js
 * // 一整片一套抖动：站住时 0.6px，俯冲时 2.4px，落版时收回 0.6px
 * const amp = (1.1 + 1.3 * dive) * (1 - 0.75 * settle);
 * return { ...cameraPost(f.t), shake: shakeSmooth(f.t, amp) };
 * ```
 *
 * @param {number} t 用**整片时间**（不是段内时间），全片就自然连成一条
 * @param {number} amp 幅度（物理像素，1080p 下 = 逻辑像素）——「峰值大致到这里」
 * @param {{ hz?: number, seed?: number, aspect?: number }} [opts]
 *        `hz` 主层频率（默认 0.85Hz；> 1.5 在 60fps 下开始有"振"的观感）；
 *        `aspect` 纵向幅度比例（默认 0.7，横向抖得比纵向多一点）
 * @returns {[number, number]} `[dx, dy]`，y 向下为正（与 `post.shake` 一致）
 */
export function shakeSmooth(t, amp = 2, opts = {}) {
  const hz = opts.hz ?? 0.85;
  const o = (opts.seed ?? 1) * 7.3;
  // 两层叠加：|值| ≤ 1.4，所以把 amp 换算成"峰值大致 = amp"的系数
  const k = amp / 1.4;
  const n = (x, off) => (noise1(x + off + o) - 0.5) * 2;
  const sx = n(t * hz, 3.1) + 0.4 * n(t * hz * 3.2, 11.0);
  const sy = n(t * hz * 0.85, 7.7) + 0.4 * n(t * hz * 2.7, 23.0);
  return [sx * k, sy * k * (opts.aspect ?? 0.7)];
}

/* ------------------------------------------------------------------ 投影 */

/**
 * 世界坐标 → 屏幕像素（逻辑像素，y 向下）。**第 1 类"3D"的主力**。
 *
 * 两种投影：
 *   · `k = 0`：纯相似变换（平移 + 缩放 + 旋转），就是 `setXform` 那套，只是由你
 *     自己决定每个点怎么投。
 *   · `k != 0`：**keystone / 透视**。`d = 1 − k·fy`，`fy` 是**相对摄影机**的深度
 *     （往画面下方为正）。所以 **`k > 0` 时画面下缘放大、上缘缩小** ——
 *     就是"低头看一张摊在桌上的纸"：纸的下缘离你近（放大），上缘离你远（缩小）。
 *     pdoom `leftturn.ts: project()` 用的就是这一个式子（它的注释写作 `d = 1 - K*fy`），
 *     我在内核里来回改过三次符号，最后**以 pdoom 的原式为准**钉死。
 *
 *     ⚠ 实用值很小（0.0002 量级）：`|k|` 到 `1/|画面尺度|` 附近时地平线进画面，
 *     那一整条线会翻面。`project` 把分母夹在 1e-3，`camXform` 干脆放弃这一帧的透视。
 *
 * @param {Cam2D} cam @param {number} W @param {number} H
 * @param {number} wx @param {number} wy @param {number} [k]
 * @returns {{ x: number, y: number }}
 */
export function project(cam, W, H, wx, wy, k = 0) {
  const dx = wx - cam.x, dy = wy - cam.y;
  const cs = Math.cos(cam.rot), sn = Math.sin(cam.rot);
  const fx = (cs * dx - sn * dy) * cam.zoom;
  const fy = (sn * dx + cs * dy) * cam.zoom;
  if (k === 0) return { x: W / 2 + fx, y: H / 2 + fy };
  const d = 1 - k * fy;
  // d 穿过 0 意味着点在地平线之外，会翻面花屏。夹到一个小正数，宁可压扁。
  const dd = d < 1e-3 ? 1e-3 : d;
  return { x: W / 2 + fx / dd, y: H / 2 + fy / dd };
}

/**
 * **把 `project(k)` 的透视搬进 `ctx.setXform`** —— 让整个前景层（矢量 + 文字）
 * 和世界按**逐像素完全一致**的透视变形。
 *
 * 这是"2.5D 里有文字"最省的做法：不用把文字塞进 shader、不用逐字算雅可比，
 * 只要让场景把世界画进去，然后用同一个 `cam` 调一次 `setXform`，
 * 整层就一起被压过去了（连文字排版都保持原样，只是被透视了）。
 *
 * ## 怎么做：**用齐次矩阵相乘**，不手写系数
 *
 * `project()` 是"世界 → 摄影机空间 → 屏幕空间"两次射影变换的复合：
 *
 *   ① 世界 → 摄影机空间：`F = [[cos, -sin, -cos·cam.x + sin·cam.y], [sin, cos, -sin·cam.x - cos·cam.y], [0, 0, 1]]`
 *      （`(cx, cy) = (cos·Δx − sin·Δy, sin·Δx + cos·Δy)`，平移项由"参照点必须映到原点"反推）
 *   ② 摄影机空间 → 屏幕：`S = [[zoom, 0, W/2], [0, zoom, H/2], [0, k, 1]]`
 *      （`screen = (W/2 + zoom·cx/d, H/2 + zoom·cy/d)`，`d = 1 + k·cy`）
 *
 * 两者相乘 `M = S · F` 就是整条链的矩阵，`xformForward` 认它的 `proj` 字段。
 *
 * ⚠ **为什么不用 `(scale, rot, p, q)` 那套参数化**：它**表达不了带旋转的透视**
 *   ——分母的梯度方向被内容的朝向绑死了。我在这条路上连续错了六次，每一次的表现都只是
 *   "整层偏一点、缩一点"：**不崩溃、不报错、`check` 也查不出来**（矩阵转置、少一层缩放、
 *   把 W/2 乘进 p、平移从世界原点量、符号写反……全都只是"画面偏了"）。
 *   所以现在：① 用矩阵相乘（只有平移项要反推，且只反推一次）；
 *   ② 函数末尾留一道**运行时自检**，拿两个世界点比对 `project()`，对不上就退回不做透视。
 *   一致性由 `tools/test-cam-math.mjs` 的「camXform 与 project(k) 逐像素一致」钉住
 *   （8 组机位 × 5 个世界点，逐点 1e-6）。**改这里必须先跑它。**
 *
 * ⚠ 反过来说：**别把 `project()` 投出来的屏幕坐标再喂给这个 xform**，那是二次变形。
 * 用 `camXform` 时，层里的坐标必须是**世界坐标**。
 *
 * @param {Cam2D} cam @param {number} W @param {number} H @param {number} k 透视强度（符号见 `project`）
 * @param {{ edge?: 'clamp'|'black' }} [extra] `edge` 透传给 `setXform`
 * @returns {{x?:number, y?:number, scale?:number, rot?:number, proj?:number[], anchor:number[], edge:string}}
 */
export function camXform(cam, W, H, k = 0, extra = {}) {
  const zoom = Math.max(1e-6, cam.zoom);
  const edge = extra.edge ?? 'clamp';

  // 无透视：绕画面中心的平移缩放（与 `project(k = 0)` 逐像素一致）
  const flat = {
    x: W / 2 - cam.x * zoom, y: H / 2 - cam.y * zoom,
    scale: zoom, rot: cam.rot, anchor: [0, 0], edge,
  };
  if (k === 0) return flat;
  // 地平线（分母过零处）落在画面内就会让那一整条线翻面 —— 宁可这一帧不做透视。
  if (1 / Math.abs(k) < 2.2 * Math.max(W, H)) return flat;

  /**
   * 做法：**运行时数值解**，不做任何代数推导。
   *
   * 要的是一个 3×3 射影矩阵 `M`，`screen = (M₀·q / M₂·q, M₁·q / M₂·q)`（`q = (x, y, 1)`）。
   * 固定 `M₈ = 1` 之后还有 8 个未知数。关键观察：**X 那一行和 Y 那一行互不相干** ——
   * X 行只用 `(M₀, M₁, M₂)`，Y 行只用 `(M₃, M₄, M₅)`，两行共用 `(M₆, M₇)`。
   * 所以拆成**两个 5 元系统**，各用 5 个世界点：
   *
   *   `M₀·x + M₁·y + M₂ − eₓ·(M₆·x + M₇·y + 1) = eₓ`（求 `M₀, M₁, M₂, M₆, M₇`）
   *   `M₃·x + M₄·y + M₅ − e_y·(M₆·x + M₇·y + 1) = e_y`（求 `M₃, M₄, M₅, M₆, M₇`）
   *
   * ⚠ 一开始我按"8 个未知数、4 个点"排成一个 8×8 —— 那个矩阵**是奇异的**（X 行在 Y 的
   *   三列上全零、Y 行在 X 的三列上全零），消元直接失败。所以宁可多写 20 行：
   *   `solve5` 用部分主元，解不出就返回 null。
   *
   * 为什么值得这么写：我手推这个矩阵**连续错了七次**（转置、少一层缩放、把 W/2 乘进 p、
   * 平移从世界原点量、`project` 里 `d` 的符号反了……），而每一次的表现都只是
   * "整层偏一点、缩一点"——**不崩溃、不报错、`check` 也查不出来**。数值解没有推导，
   * 也就没有符号可以写反；代价只是每帧两次 5×5 消元。
   */
  const cs = Math.cos(cam.rot), sn = Math.sin(cam.rot);
  const d = Math.max(W, H) * 0.5;
  const at = (a, b) => [cam.x + a * cs - b * sn, cam.y + a * sn + b * cs];
  // ⚠ 采样点必须**互不线性相关**：一开始我用 ±d 的对称点，结果那两行的 `e` 完全相同
  //   （投影是对称的），矩阵直接奇异、`solve5` 返回 null、整层退回不做透视。
  //   现在这 5 个点（中心 + 两个轴向 + 两个对角）互相独立。
  const pts = [at(0, 0), at(d, 0), at(0, d), at(d, d), at(-d, 0.6 * d)];

  const rows = [];
  const ex = [];
  const ey = [];
  for (const [wx, wy] of pts) {
    const e = project(cam, W, H, wx, wy, k);
    rows.push([wx, wy, 1, wx, wy]);   // 系数：M₀, M₁, M₂, M₆, M₇
    ex.push(e.x);
    ey.push(e.y);
  }
  /**
   * 解 5 个未知数：`A·x + B·y + C − e·(P·x + Q·y + 1) = e`。
   * `(P, Q)` 是两行共用的分母系数，所以两次解出来的必须一致（下面有断言）。
   * 返回 `[A, B, C, P, Q]`，解不出返回 null。
   * @param {number[]} eArr 每个采样点对应的屏幕坐标（x 或 y）
   */
  const build = (eArr) => {
    const A = [];
    const b = [];
    for (let i = 0; i < 5; i++) {
      const [x, y] = pts[i];
      const e = eArr[i];
      A.push([x, y, 1, -e * x, -e * y]);
      b.push(e);
    }
    return solve5(A, b);
  };
  const sx = build(ex);
  const sy = build(ey);
  if (!sx || !sy) return flat;
  // 分母系数两行共用：两次解必须一致，不一致说明这个机位解不出来（退回不做透视）
  const tol6 = 1e-6 * Math.max(1, Math.abs(sx[3]));
  const tol7 = 1e-6 * Math.max(1, Math.abs(sx[4]));
  if (Math.abs(sx[3] - sy[3]) > tol6 || Math.abs(sx[4] - sy[4]) > tol7) return flat;
  const M = [sx[0], sx[1], sx[2], sy[0], sy[1], sy[2], sx[3], sx[4], 1];

  // 自检：再拿两个**没参与求解**的世界点验一遍（对不上就退回不做透视）
  for (const [wx, wy] of [at(0.31 * d, 0.72 * d), at(-0.63 * d, -0.44 * d)]) {
    const w = M[6] * wx + M[7] * wy + M[8];
    const gx = (M[0] * wx + M[1] * wy + M[2]) / w;
    const gy = (M[3] * wx + M[4] * wy + M[5]) / w;
    const e = project(cam, W, H, wx, wy, k);
    if (!Number.isFinite(gx) || Math.abs(gx - e.x) > 0.05 || Math.abs(gy - e.y) > 0.05) return flat;
  }

  // ⚠ 列主序，**平移在第 3 列**：`xformForward` 把点当列向量乘（`(X, Y, 1) ← M · (x, y, 1)`）。
  //   排成"平移在第 3 行"只会让整层偏一点 —— 矩阵转置在这里是**静默错误**。
  return {
    proj: [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]],
    anchor: [0, 0],
    edge,
  };
}

/**
 * 解 5 元线性方程组（高斯消元 + 部分主元）。奇异时返回 `null`（调用方退回不做透视）。
 * @param {number[][]} Ain @param {number[]} bin
 * @returns {number[]|null}
 */
function solve5(Ain, bin) {
  const n = 5;
  const A = Ain.map((r, i) => r.concat(bin[i]));
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-9) return null;
    const t = A[c]; A[c] = A[piv]; A[piv] = t;
    const pv = A[c][c];
    for (let j = c; j <= n; j++) A[c][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f === 0) continue;
      for (let j = c; j <= n; j++) A[r][j] -= f * A[c][j];
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = A[i][n];
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

/** 批量投影。`pts` 是 `[[x,y], …]`；返回 `[[x,y], …]`（可直接喂 `lines.polyline`）。 */
export function projectLine(cam, W, H, pts, k = 0) {
  const out = [];
  for (const p of pts) {
    const q = project(cam, W, H, p[0], p[1], k);
    out.push([q.x, q.y]);
  }
  return out;
}

/** 反过来：想让**屏幕**上的 `(sx, sy)` 落在世界的哪个点（`k = 0` 时才有唯一解）。做"镜头跟着元素走"。 */
export function unproject(cam, W, H, sx, sy) {
  const cs = Math.cos(cam.rot), sn = Math.sin(cam.rot);
  const fx = sx - W / 2, fy = sy - H / 2;
  const dx = (cs * fx + sn * fy) / cam.zoom;
  const dy = (-sn * fx + cs * fy) / cam.zoom;
  return { x: cam.x + dx, y: cam.y + dy };
}

/* ------------------------------------------------------------------ 3D 投影（第 1 类 3D 用） */

/**
 * 3D 相机基：位置 + 右/上/前三个单位向量 + 焦距（像素）。
 *
 * 这三种"3D"里，**第 1 类（解析投影 + 线段批）就用这个**，不需要深度缓冲：
 * 你自己把世界点投到屏幕，自己决定远近的明暗/粗细。
 *
 * @param {{ pos: number[], target: number[], fov?: number, H?: number, roll?: number }} c
 *        `fov` 是竖直视场角（度）；`H` 是逻辑高度（默认 1080），用来把焦距换算成像素
 * @returns {{ pos: number[], right: number[], up: number[], fwd: number[], focal: number }}
 */
export function camera3(c) {
  const p = c.pos;
  let fx = c.target[0] - p[0], fy = c.target[1] - p[1], fz = c.target[2] - p[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  const fwd = [fx, fy, fz];
  /**
   * `right = normalize(cross(fwd, worldUp))`，worldUp = (0,1,0) → `(-fz, 0, fx)`。
   *
   * ⚠⚠ **这里的符号是反的（2026-10 修）**，而且反得极其安静：以前写的是 `(fz, 0, -fx)`,
   * 也就是 `cross(worldUp, fwd)` —— 基座变成左手的，`project3` 出来的 X **整体镜像**：
   * 世界 `x = +1.5` 的点落在画面**左**半边（实测屏幕 x = 430，中心是 960）。
   * 因为这一轮的几个场景（走廊 / 图纸 / 塔 / 柱林）左右基本对称，**没有一个人看出来**，
   * 直到给走廊做 raymarch 时用"法线 / 材质"调试图才露出来：地板和天花板整个颠倒。
   * → `tools/test-cam-math.mjs` 现在钉了这条（世界 +x 必须落在右半边、+y 必须在上半边）。
   */
  let rx = -fz, ry = 0, rz = fx;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  // up = cross(right, fwd)（同样是右手系；以前写的是 cross(fwd, right) = -up）
  let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const roll = c.roll ?? 0;
  if (roll !== 0) {
    const cs = Math.cos(roll), sn = Math.sin(roll);
    const r2 = [rx * cs + ux * sn, ry * cs + uy * sn, rz * cs + uz * sn];
    const u2 = [ux * cs - rx * sn, uy * cs - ry * sn, uz * cs - rz * sn];
    rx = r2[0]; ry = r2[1]; rz = r2[2];
    ux = u2[0]; uy = u2[1]; uz = u2[2];
  }
  const H = c.H ?? 1080;
  const focal = (H * 0.5) / Math.tan(((c.fov ?? 34) * Math.PI) / 360);
  return { pos: [p[0], p[1], p[2]], right: [rx, ry, rz], up: [ux, uy, uz], fwd, focal };
}

/**
 * 3D 点 → 屏幕像素。返回 `w`（相机空间深度，> 0 才在镜头前方）：
 *
 * ```js
 * const a = project3(cam3, W, H, x0, y0, z0);
 * const b = project3(cam3, W, H, x1, y1, z1);
 * if (clipSegment(a, b)) lines.seg(a.x, a.y, b.x, b.y, widthAt(cam3, a.w, w0), color);
 * ```
 *
 * @returns {{ x: number, y: number, w: number }}
 */
export function project3(cam3, W, H, wx, wy, wz) {
  const dx = wx - cam3.pos[0], dy = wy - cam3.pos[1], dz = wz - cam3.pos[2];
  const w = dx * cam3.fwd[0] + dy * cam3.fwd[1] + dz * cam3.fwd[2];
  const rx = dx * cam3.right[0] + dy * cam3.right[1] + dz * cam3.right[2];
  const uy = dx * cam3.up[0] + dy * cam3.up[1] + dz * cam3.up[2];
  const iw = 1 / (Math.abs(w) < 1e-6 ? 1e-6 : w);
  return { x: W / 2 + rx * iw * cam3.focal, y: H / 2 - uy * iw * cam3.focal, w };
}

/**
 * 近平面裁剪：两端点都在镜头前 → true；一端在后面 → 把线段截到近平面上再返回 true；
 * 两端都在后面 → false（整条丢掉）。**不做这一步会在镜头穿过物体时画出翻面的长线**
 * （pdoom `room.ts: clipSeg()` 就是干这个）。
 *
 * @param {{x:number,y:number,w:number}} a @param {{x:number,y:number,w:number}} b
 * @param {number} [near] 近平面深度（世界单位）
 * @returns {boolean} 是否可以画（`a`/`b` 会被就地修改）
 */
export function clipSegment(a, b, near = 0.05) {
  if (a.w < near && b.w < near) return false;
  if (a.w < near) { const k = (near - a.w) / (b.w - a.w); a.x = lerp(a.x, b.x, k); a.y = lerp(a.y, b.y, k); a.w = near; }
  else if (b.w < near) { const k = (near - b.w) / (a.w - b.w); b.x = lerp(b.x, a.x, k); b.y = lerp(b.y, a.y, k); b.w = near; }
  return true;
}

/**
 * 近大远小：世界尺寸 → 屏幕像素。`size * depthScale(cam3, w)`。
 * 文字没有 3D，所以"远处小一点"就靠这个（第 1 类 3D 的代价：文字不做透视变形）。
 */
export function depthScale(cam3, w, H = 1080) {
  return cam3.focal / Math.max(1e-6, w) / H;
}

/** 一条 3D 线段的屏幕粗细：随距离衰减，可以夹上下限（细线永远看得见）。 */
export function widthAt(cam3, w, worldWidth, { min = 1, max = 12, H = 1080 } = {}) {
  return clamp(worldWidth * depthScale(cam3, w, H), min, max);
}
