// @ts-check
/**
 * 确定性数学工具箱。
 *
 * 铁律：视觉输出必须是帧时间 t 的纯函数。禁止 Math.random / Date.now / performance.now。
 * 整个引擎靠这一条换来：可逐帧并行渲染、可任意 seek、可重渲、离线与预览完全一致。
 * 需要随机就用 rng(seed)，需要按帧抖动就用 frameIdx(t)。
 */

export const TAU = Math.PI * 2;
export const PI = Math.PI;

/* ------------------------------------------------------------------ 基础插值 */

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
export const remap = (x, a, b, c, d) => c + (d - c) * sat(invLerp(a, b, x));
export const mix = lerp;

/** 平滑阶跃：默认在 [0,1] 上做 smoothstep。 */
export function smoothstep(a, b, x) {
  const t = sat((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
}

/** 圈数：把一个时间量映射成 0..1 的循环相位。 */
export function cycle(t, period, phase = 0) {
  return ((t / period + phase) % 1 + 1) % 1;
}

/** 包在 [0,1] 之间的三角波，适合做往复运动。 */
export function pingPong(t, period = 1, phase = 0) {
  const p = cycle(t, period, phase) * 2;
  return p < 1 ? p : 2 - p;
}

/** 脉冲：t 时刻距离最近一次「每 period 一次」的事件有多近，返回 0..1 的尖峰。 */
export function pulse(t, period = 1, halfLife = 0.15, phase = 0) {
  const since = cycle(t, period, phase) * period;
  return Math.exp(-since / Math.max(1e-6, halfLife));
}

/** 衰减冲击：在 t0 时刻打一下，之后按 halfLife 衰减。 */
export function hit(t, t0, halfLife = 0.12) {
  if (t < t0) return 0;
  return Math.exp(-(t - t0) / Math.max(1e-6, halfLife));
}

/** 在 [0,1] 内从 0 升到 1；越界后保持。 */
export function window01(x) {
  return sat(x);
}

/**
 * 指数弹簧的**解析解**：从 0 出发、初速 0，追向 target。
 * 不要写成逐帧积分（`x += v*dt` 那种）——那违反确定性契约，多子帧乱序渲染时会散架。
 * 用法：`x = spring(t - t0, 1, 90, 18)` → t0 之后平滑趋近 1。
 */
export function spring(elapsed, target = 1, stiffness = 90, damping = 18) {
  const t = Math.max(0, elapsed);
  const w0 = Math.sqrt(Math.max(1e-6, stiffness));
  const zeta = damping / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return target * (1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t)));
  }
  return target * (1 - Math.exp(-w0 * t) * (1 + w0 * t));   // 临界/过阻尼
}

/* ------------------------------------------------------------------ 缓动 */

export const ease = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - 4 * (1 - x) ** 3),
  inQuart: (x) => x ** 4,
  outQuart: (x) => 1 - (1 - x) ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - 8 * (1 - x) ** 4),
  inExpo: (x) => (x <= 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) =>
    x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
  // 注意：inBack 是「先退后进」，outBack 是「冲过头再回弹」，两者是不同函数
  inBack: (x) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return c3 * x * x * x - c1 * x * x;
  },
  outBack: (x) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  },
  inOutBack: (x) => {
    const c2 = 1.70158 * 1.525;
    return x < 0.5
      ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2
      : ((2 * x - 2) ** 2 * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;
  },
  outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1),
  outBounce: (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  },
};

/**
 * 缓动名写错时**警告一次**（同名只报一次，避免每帧刷屏）。
 *
 * 为什么要有它：`prog(t, 0, 1, 'outCubicc')` 这种拼错以前会**静默退化成 linear**
 * （`ease[name] ?? ease.linear`），画面上只是"动起来有点平"—— 完全看不出是打错了字
 * （`docs/IMPROVEMENTS-2.md` P2-3）。
 * production 构建也保留这条警告：它只在写错时出现，代价可以忽略。
 */
const warnedEase = new Set();
function warnEase(name, where) {
  if (warnedEase.has(name)) return;
  warnedEase.add(name);
  const known = Object.keys(ease).join(', ');
  // eslint-disable-next-line no-console
  console.warn(`[anim] 未知的缓动名 ${JSON.stringify(name)}${where ? `（${where}）` : ''} —— 已退化成 linear。可用：${known}`);
}

/** 进度：把 t 在 [a,b] 区间内的位置映射到 0..1，可选缓动名。 */
export function prog(t, a, b, easing = 'linear') {
  const x = sat((t - a) / (b - a || 1e-9));
  const f = ease[/** @type {keyof typeof ease} */ (easing)];
  if (!f) { warnEase(easing, 'prog'); return ease.linear(x); }
  return f(x);
}

/** 打点曲线：keys(t, [[time, value, 'outCubic'], ...])，段内插值，段外取端值。 */
export function keys(t, list) {
  const n = list.length;
  if (n === 0) return 0;
  if (t <= list[0][0]) return list[0][1];
  if (t >= list[n - 1][0]) return list[n - 1][1];
  for (let i = 1; i < n; i++) {
    if (t <= list[i][0]) {
      const [t0, v0] = list[i - 1];
      const [t1, v1] = list[i];
      const name = list[i][2] ?? 'inOutCubic';
      const f = ease[name];
      if (!f) warnEase(name, 'keys');
      return lerp(v0, v1, (f ?? ease.inOutCubic)(sat((t - t0) / (t1 - t0 || 1e-9))));
    }
  }
  return list[n - 1][1];
}

/* ------------------------------------------------------------------ 投影 / 几何 */

/** 帧号：一帧内所有子帧（运动模糊采样）共享同一个 frameIdx，所以按帧抖动要用它。 */
export function frameIdx(t, fps = 60) {
  return Math.floor(t * fps + 1e-6);
}

export function rot2(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c * x - s * y, s * x + c * y];
}

export function dist2(x0, y0, x1, y1) {
  return Math.hypot(x1 - x0, y1 - y0);
}

/** 折线总长与等分点，给「沿路径运动 / 沿路径写字」用。 */
export function polylineLengths(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + dist2(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return acc;
}

/** 在折线上按弧长取点，返回 [x, y, 切线角]。 */
export function pointAtLength(pts, acc, s) {
  const total = acc[acc.length - 1];
  const d = clamp(s, 0, total);
  let i = 1;
  while (i < acc.length - 1 && acc[i] < d) i++;
  const t = (d - acc[i - 1]) / (acc[i] - acc[i - 1] || 1e-9);
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  return [lerp(x0, x1, t), lerp(y0, y1, t), Math.atan2(y1 - y0, x1 - x0)];
}

/* ------------------------------------------------------------------ 随机 / 噪声（全部确定性） */

function smix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 整数哈希 -> [0,1)。 */
export function hash1(n) {
  return smix(n | 0) / 4294967296;
}

export function hash2(x, y) {
  return smix((x | 0) * 374761393 + (y | 0) * 668265263) / 4294967296;
}

export function hash3(x, y, z) {
  return smix((x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483647) / 4294967296;
}

/** 确定性随机流：同一 seed 永远给出同一串数。场景里所有「随机」都必须走这里。 */
export function rng(seed = 0) {
  let s = (seed | 0) || 1;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性随机数组，给粒子预计算用。 */
export function rngArray(n, seed = 0) {
  const r = rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r();
  return out;
}

function fade(x) { return x * x * x * (x * (x * 6 - 15) + 10); }

export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  return lerp(hash1(i), hash1(i + 1), fade(f));
}

export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function noise3(x, y, z) {
  const iz = Math.floor(z), fz = z - iz;
  const w = fade(fz);
  return lerp(noise2(x, y + iz * 37.1), noise2(x + 13.7, y + iz * 37.1 + 7.3), w);
}

/** 分形叠加噪声。 */
export function fbm1(x, octaves = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { v += a * noise1(x * f); f *= 2; a *= 0.5; }
  return v;
}

export function fbm2(x, y, octaves = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { v += a * noise2(x * f, y * f); f *= 2; a *= 0.5; }
  return v;
}

/* ------------------------------------------------------------------ 颜色 */

/** sRGB 通道 (0..1) -> 线性光。渲染全程在线性空间，最后一步才回 sRGB。 */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** '#ff4d12' -> [r,g,b] 线性，值域 0..1（可超过 1）。 */
export function hexToLinear(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
}

/** linear [r,g,b] -> 'rgb()' CSS 字符串（给 Canvas2D 用；Canvas2D 也在 sRGB 空间）。 */
export function css(linear, alpha = 1) {
  const [r, g, b] = linear.map((c) => Math.round(sat(linearToSrgb(c)) * 255));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/** 亮度相乘（做明暗变化时保持色相）。 */
export function scaleColor(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return rgb.map(srgbToLinear);
}

/* ------------------------------------------------------------------ 杂项 */

export function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** 秒 -> 'm:ss.ff'，给 HUD / 时间码。 */
export function timecode(t, fps = 60) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps);
  return `${m}:${pad(sec)}.${pad(f)}`;
}

/** 值域映射成 0..1 的「进度条」文本，给 HUD 用。 */
export function bar(x, width = 24) {
  const n = Math.round(sat(x) * width);
  return '█'.repeat(n) + '░'.repeat(width - n);
}
