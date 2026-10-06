# COOKBOOK.md —— 常见效果的做法手册

可以直接复制进 `tasks/<任务>/scenes/*.js` 的片段集。每条都尽量给「最小可跑」的完整场景。
API 细节以 `docs/ENGINE.md` 为准；这里只讲组合方式。

## 目录

- [0. 公理与每帧骨架](#0-公理与每帧骨架)
- [1. 全屏 shader 背景](#1-全屏-shader-背景)
- [2. 矢量图形与图表](#2-矢量图形与图表)
- [3. 文字：逐字入场与打字机](#3-文字逐字入场与打字机)
- [4. 卡拉OK逐词同步](#4-卡拉ok逐词同步)
- [5. 沿路径写字与路径运动](#5-沿路径写字与路径运动)
- [6. 粒子：出生时间的函数](#6-粒子出生时间的函数)
- [7. 屏幕震动 / 闪白 / 推近 / 色差](#7-屏幕震动--闪白--推近--色差)
- [8. 自定义转场](#8-自定义转场)
- [9. 图片与纹理叠加](#9-图片与纹理叠加)
- [10. 音频踩拍](#10-音频踩拍)
- [11. 多段编排与重叠](#11-多段编排与重叠)
- [12. 4K 渲染](#12-4k-渲染)
- [13. 性能优化](#13-性能优化)
- [14. 真 3D：投影线段批 与 raymarch](#14-真-3d投影线段批-与-raymarch)
- [15. 常用模式速查](#15-常用模式速查)

---

## 0. 公理与每帧骨架

两条必须背下来的规则：

1. **`render(ctx)` 是 `f.t` 的纯函数**——一帧会被拆成 8～216 个子帧乱序渲染再平均。
   不许 `Math.random` / `Date.now` / `performance.now`；不许逐帧累积状态；按帧抖动只能用 `f.idx`。
2. **`render()` 必须整帧覆盖 `ctx.out`**——先清屏或用一个不透明的全屏 `Pass`。

每帧骨架（复制这个起手）：

```js
import { makeShot } from '../../../src/kit/index.js';
import { css } from '../../../src/core/util.js';

export default makeShot('scene_name', {
  setup(ctx) {
    // 只跑一次：建 Pass、预计算几何、生成确定性随机
    const r = ctx.rng(7);
    this.dots = Array.from({ length: 300 }, () => ({ x: r(), y: r(), ph: r() }));
  },

  draw(ctx, { k, dx, dy, enter }) {          // k = 入场进度；dx/dy = 从反方向落位的位移
    const { f, gl, P, text, type, comp, lines, params, music } = ctx;
    const { W, H } = gl;

    // ① 背景：任务里 `export const world = (ctx) => worldPass(...)` + 时间线上 `world: 'auto'` 时，
    //    makeShot 已经把它铺好了（openFrame），这里什么都不用做；
    //    ⚠ 没声明 world 的任务，这一段就是**纯黑底**（不报错）—— 那就自己 gl.clear 或画一次全屏 Pass。
    // ② 矢量（颜色是线性值，可 >1 用来发光；坐标加上 dx/dy 让它从反方向落位）
    lines.begin();
    lines.seg(W * 0.1 + dx, H * 0.5 + dy, W * 0.9 + dx, H * 0.5 + dy, 3, P.signal);
    lines.flush(ctx.out);

    // ③ 文字（clear → write → upload → draw，一步都不能少）
    text.clear();
    type.writeLine('一段标题', W * 0.1 + dx, H * 0.4 + dy, {
      anchor: 'left', size: 120, weight: 800, family: 'sans', color: css(P.bone), ...enter(0.2),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    // ④ 这一帧的后处理参数（可选）
    return { bloom: 0.4, grain: 0.03, vignette: 0.4 };
  },
});
```

**为什么用 `makeShot` 而不是裸 `render`**：它一次封死四件"漏了都不报错"的事 ——
声明 `handlesTransition`、每帧先铺**全片共享的那层背景**、交叠期把上一帧甩走、返回 `cameraPost(f.t, …)`
（一台走完全片的摄影机）。裸 `render` 起手最容易写成"每段各建背景、一切换世界就跳"的幻灯片
（`src/core/trans.js` 顶部与 `AGENTS.md` §4.5 讲的四条配方）。

**别的都可以慢慢查，这三条错了就全盘错**：忘了 `text.clear()`、忘了 `comp.draw`、忘了覆盖整帧
（用 `makeShot` 时背景由它负责；自己写裸 `render` 就得自己 `gl.clear(ctx.out, …)` 或画一次全屏 `Pass`）。

---

## 1. 全屏 shader 背景

### 1.1 径向渐变 + 细网格（最常用的「摄影棚底」）

```js
import { Pass } from '../../../src/core/gl.js';

export default {
  id: 'studio_bg',

  setup(ctx) {
    const P = ctx.P;
    this.bg = new Pass(ctx.gl, /* glsl */ `
      uniform vec3 ink, ink2, grid;
      void main() {
        // 注意 FRAG_PX 的 y 是向上的；这里只当 0..1 的屏幕参数用
        vec2 p = FRAG_PX / RES_LOGICAL;
        vec2 c = p - vec2(0.5, 0.52);
        float r = length(c * vec2(RES_LOGICAL.x / RES_LOGICAL.y, 1.0));

        vec3 col = mix(ink2, ink, smoothstep(0.15, 0.95, r));

        // 细网格：间距用逻辑像素给，线宽用 fwidth 给 —— 4K 下依然是一根细线
        vec2 d = abs(fract(FRAG_PX / 60.0) - 0.5) * 60.0;
        vec2 w = vec2(fwidth(FRAG_PX.x), fwidth(FRAG_PX.y));
        float g = 1.0 - smoothstep(w.x, w.x * 2.0, min(d.x, d.y));
        col += grid * g * 0.5 * smoothstep(1.1, 0.2, r);

        // 一点暖光，让画面不平
        col += C_SIGNAL * 0.05 * exp(-r * r * 6.0);
        fragColor = vec4(col, 1.0);
      }`,
      { ink: P.ink, ink2: P.ink2, grid: P.graphite.map((x) => x * 0.5) },
      { key: 'ck_studio_bg', blend: false },     // 背景必须 blend:false
    );
  },

  render(ctx) {
    this.bg.render(ctx.gl, ctx.out, ctx.f.t, ctx.f.dt);
    // ... 上面再叠矢量与文字
  },
};
```

### 1.2 流动的 fbm 场 + 等高线

```js
setup(ctx) {
  this.bg = new Pass(ctx.gl, /* glsl */ `
    uniform float warp;
    void main() {
      vec2 p = (FRAG_PX - 0.5 * RES_LOGICAL) / RES_LOGICAL.y;
      p += 0.06 * vec2(sin(t * 0.15), cos(t * 0.11));          // 缓慢漂移，仍是 t 的纯函数
      vec2 q = vec2(fbm(p * 3.0 + t * 0.05), fbm(p * 3.0 + vec2(5.2, 1.3) - t * 0.04));
      float f = fbm(p * 2.0 + q * warp);

      vec3 col = mix(C_INK, C_INK2, smoothstep(0.25, 0.75, f));
      // 等高线：量化场值，在边界画线（宽用 fwidth，避免混叠）
      float band = abs(fract(f * 9.0) - 0.5) * 2.0;
      float w = fwidth(f * 9.0) * 1.5;
      float line = 1.0 - smoothstep(w, w * 3.0, band);
      col += mix(C_GRAPHITE, C_SIGNAL, smoothstep(0.45, 0.85, f)) * line * 0.55;
      col += C_SIGNAL * 0.05 * exp(-8.0 * dot(p, p));
      // 极轻的噪声打散色带（注意用 t 连续播种会让运动模糊出现台阶，这里幅度很小可接受）
      col += (hash12(FRAG_PX + fract(t) * 91.0) - 0.5) * 0.012;
      fragColor = vec4(col, 1.0);
    }`, { warp: 1.1 }, { key: 'ck_flow_bg', blend: false });
},

render(ctx) {
  this.bg.u.warp.value = 1.0 + 0.4 * Math.sin(ctx.f.lt * 0.6);   // 每帧改 uniform 也行
  this.bg.render(ctx.gl, ctx.out, ctx.f.t, ctx.f.dt);
}
```

> 想让「噪声纹理」在运动模糊下不出现台阶，就用**按帧固定的种子**：
> `col += (hash12(FRAG_PX + float(SEED)) - 0.5) * 0.02;`，其中 `SEED` 由场景用 `f.seed` 通过 uniform 传进来。

### 1.3 SDF 形状 + 抗锯齿（不开 MSAA）

```js
this.blob = new Pass(ctx.gl, /* glsl */ `
  uniform float k;         // 0..1 生长
  void main() {
    vec2 p = (FRAG_PX - 0.5 * RES_LOGICAL) / RES_LOGICAL.y;
    p.y = -p.y;                                     // 需要 y 向下时自己翻
    float d = sdCircle(p, 0.22) ;
    d = smin(d, sdBox(p - vec2(0.25, 0.05), vec2(0.10, 0.06)), 0.06);  // 平滑并集
    float aa = fwidth(d) * 1.2;                     // 自适应过渡宽度
    float fill = aaFill(d - (1.0 - k) * 0.6, aa);
    vec3 col = mix(C_INK, C_SIGNAL, fill);
    col += C_EMBER * 0.6 * exp(-abs(d) * 26.0);     // 描边发光
    fragColor = vec4(col, 1.0);
  }`, { k: 0 }, { key: 'ck_blob', blend: false });
```

`GLSL_COMMON` 里已有的 SDF：`sdCircle / sdBox / sdSegment / sdRound / sdRing / sdTri / sdSphere / sdBox3 / sdTorus / sdCapsule3`，以及 `smin / smax`。
⚠ **`GLSL_COMMON` 的 `sdfNormal(p, e, d)` 是坏的**（四个基向量相加恒为 0 ⇒ `normalize(0)` ⇒ NaN ⇒ 整屏白，不报错）：
raymarch 的法线用 `glsl3d.js` 的 `marchNormal(p, e)` 或 `marchNormalCD(p, e)`（见 §14.2 与 `docs/ENGINE.md` §3.7.4）。

### 1.4 版画 / 排线质感

```js
float inkAmt = 1.0 - smoothstep(0.2, 0.6, f);
col = mix(col, col * engrave(FRAG_PX, inkAmt, 0.35, 0.6), 0.6);
```

---

## 2. 矢量图形与图表

> **先看有没有现成的**：图表这一节的画面（坐标轴、纸面纹理、柱内排线、y 轴百分比、扫描线读数、底部结论）
> 全都在镜头库模板里，而且比下面手写版更全：
> `export default shot('chart', { values: [...], title: '…', sub: '…', footer: '…', peak: 0.95 })`
> —— `peak` 是判"最高那根"的阈值，**`values` 的上界低于它，整张图就没有强调色**（不报错）。
> 手写版留着，是给你"要改画面本身"时当参考的；能一行解决就别抄 60 行。

### 2.1 坐标轴 + 刻度 + 逐条生长的柱

```js
import { css, ease, prog } from '../../../src/core/util.js';

const VALUES = [0.18, 0.34, 0.27, 0.52, 0.44, 0.71, 0.63, 0.88, 0.79, 0.95, 0.86, 1.0];

export default {
  id: 'chart',

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;
    const t = f.lt;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    const L = W * 0.12, R = W * 0.92, T = H * 0.24, B = H * 0.80;
    const n = VALUES.length;
    const slot = (R - L) / n, bw = slot * 0.55;

    lines.begin();
    lines.seg(L, T, L, B, 2, P.ash);                 // y 轴
    lines.seg(L, B, R, B, 2, P.ash);                 // x 轴
    for (let i = 0; i <= 4; i++) {                   // 水平网格
      const y = B - (B - T) * (i / 4);
      lines.seg(L - 14, y, R, y, 1, [P.graphite[0] * 0.6, P.graphite[1] * 0.6, P.graphite[2] * 0.6]);
    }

    for (let i = 0; i < n; i++) {
      const start = 0.35 + i * 0.13;
      const k = ease.outCubic(prog(t, start, start + 0.9));
      const hh = (B - T) * VALUES[i] * k;
      const x = L + slot * (i + 0.5) - bw / 2, y = B - hh;
      const isMax = VALUES[i] >= 0.95;
      const col = isMax ? P.signal : P.bone;

      lines.rect(x, y, bw, hh, isMax ? 3 : 2, col);
      // 到位的瞬间弹一下
      const pop = 1 + 0.5 * Math.exp(-Math.max(0, t - (start + 0.9)) * 6);
      if (k > 0.98) lines.seg(x - 6 * pop, y, x + bw + 6 * pop, y, 3, col);
    }

    // 扫描线
    const scan = prog(t, 1.6, 4.4);
    const sx = L + (R - L) * scan;
    lines.seg(sx, T - 10, sx, B + 14, 2, P.signal);
    lines.flush(ctx.out);

    text.clear();
    type.write('每次迭代的最高准确率', L, T - 46, {
      size: 44, weight: 700, family: 'sans', color: css(P.bone),
      stagger: 0.03, from: 'none', t: t - 0.1,
    });
    const idx = Math.min(n - 1, Math.floor(scan * n));
    type.write(`${(VALUES[idx] * 100).toFixed(1)}%`, R, T - 46, {
      size: 58, weight: 800, family: 'mono', color: css(P.signal), align: 'right',
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.3, grain: 0.04, vignette: 0.3 };
  },
};
```

**发光**：让某条线过泛光阈值 —— 把线性色乘个系数（`P.signal` 约 0.9 线性，乘 1.6 就明显发光）：

```js
const glow = [P.signal[0] * 1.6, P.signal[1] * 1.6, P.signal[2] * 1.6];
lines.seg(x0, y, x1, y, 4, glow);
```

### 2.2 网格点阵 / 工程图风格

```js
lines.begin();
const cols = 24, rows = 14, cw = W / cols, ch = H / rows;
for (let i = 0; i <= cols; i++) lines.seg(i * cw, 0, i * cw, H, 1, [P.graphite[0] * 0.25, P.graphite[1] * 0.25, P.graphite[2] * 0.25]);
for (let j = 0; j <= rows; j++) lines.seg(0, j * ch, W, j * ch, 1, [P.graphite[0] * 0.25, P.graphite[1] * 0.25, P.graphite[2] * 0.25]);
// 刻度：每 8 格加个十字
for (let i = 0; i <= cols; i += 4) for (let j = 0; j <= rows; j += 4) lines.tick(i * cw, j * ch, 12, 1.5, P.graphite);
lines.flush(ctx.out);
```

### 2.3 折线图（用 `polylineLengths` / `pointAtLength` 做路径）

```js
import { polylineLengths, pointAtLength } from '../../../src/core/util.js';

setup(ctx) {
  this.pts = Array.from({ length: 40 }, (_, i) => [80 + i * 44, 540 + Math.sin(i * 0.42) * 180]);
  this.acc = polylineLengths(this.pts);        // 累计弧长
},

render(ctx) {
  const grow = prog(ctx.f.lt, 0.3, 2.2);
  const total = this.acc[this.acc.length - 1];
  const head = total * grow;
  const shown = [];
  for (let i = 0; i < this.pts.length; i++) {
    if (this.acc[i] <= head) shown.push(this.pts[i]);
  }
  const [hx, hy] = pointAtLength(this.pts, this.acc, head);   // 头部端点
  shown.push([hx, hy]);

  ctx.lines.begin();
  ctx.lines.polyline(shown, 3, ctx.P.signal);
  ctx.lines.circle(hx, hy, 9, 3, [ctx.P.ember[0] * 2, ctx.P.ember[1] * 2, ctx.P.ember[2] * 2], 32);  // 发光头
  ctx.lines.flush(ctx.out);
}
```

### 2.4 圆环进度 / 仪表盘

```js
const k = prog(f.lt, 0.3, 2.0);                      // 0..1
const cx = W * 0.5, cy = H * 0.5, r = 220;
const segs = 120;
const pts = [];
for (let i = 0; i <= segs * k; i++) {
  const a = -Math.PI / 2 + (i / segs) * Math.PI * 2;
  pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
}
lines.begin();
lines.circle(cx, cy, r, 6, [P.graphite[0] * 0.5, P.graphite[1] * 0.5, P.graphite[2] * 0.5], 140);  // 底环
if (pts.length > 1) lines.polyline(pts, 8, [P.signal[0] * 1.5, P.signal[1] * 1.5, P.signal[2] * 1.5]);
lines.flush(ctx.out);
```

---

## 3. 文字：逐字入场与打字机

### 3.1 逐字入场（stagger 的正确用法）

```js
text.clear();
type.write('写代码，就是做动画', W * 0.12, H * 0.46, {
  size: 128, weight: 800, family: 'sans',
  color: css(P.bone),
  stagger: 0.075,      // 每个字延迟 75ms
  staggerDur: 0.7,     // 每个字自己用 0.7s 完成（缓动固定 outCubic）
  from: 'up',          // 从下方浮上来（from !== 'none' 时自带淡入）
  dist: 70,            // 位移距离（默认 size*0.6）
  t: f.lt - 0.5,       // 让整串晚 0.5s 开始；也可以直接 p 控
});
text.upload();
comp.draw(gl, text, ctx.out, { premult: false });
```

要点：

- `from` 一共五种：`'up' | 'down' | 'left' | 'right' | 'scale' | 'none'`。
- `from: 'none'` + `stagger > 0` = **逐字硬出现**（不打字机、不淡入），适合机械口吻。
- `'up'` 是**从下往上浮**（`dy = (1-e) * dist`，y 向下）。
- `'scale'` 用 `dist` 当额外缩放量（`dist: 0.35` 就是小 35% 起跳）。
- `alpha: [0, 1]` 配合 `t` 做整串淡入；它乘在逐字 alpha 之上。
- `color` 可以是数组，按字循环：`color: [css(P.bone), css(P.bone), css(P.signal)]` 每三个字一个橙色。

### 3.2 打字机（用 `slice`，空格不会跳位）

```js
const line = 'DETERMINISTIC / SEEKABLE / RE-RENDERABLE';
const typed = Math.floor(ease.outCubic(prog(f.lt, 0.4, 1.8)) * line.length);
type.write(line.slice(0, typed), W * 0.12, H * 0.60, {
  size: 28, family: 'mono', tracking: 6, color: css(P.signal, 0.95),
});
// 光标
if (Math.floor(f.lt * 2) % 2 === 0) type.write('█', W * 0.12 + type.measure(line.slice(0, typed), { size: 28, family: 'mono', tracking: 6 }) + 4, H * 0.60, {
  size: 28, family: 'mono', color: css(P.signal),
});
```

### 3.3 居中 / 右对齐的正确做法：`writeLine` 的锚点

`write` 是逐字 `fillText(cl, x + X[i], y)`，`align` 对**每个字**都生效 ——
`align: 'center'` 会让每个字各自居中、整行跑偏，`align: 'right'` 会让整行向右溢出一个行宽。
按锚点写整行用它（内部先 `measure()` 再偏移，并强制 `align: 'left'`，所以能和逐字动画一起用）：

```js
const style = { size: 96, weight: 800, family: 'sans' };
type.writeLine('标题', W / 2, H * 0.45, { ...style, anchor: 'center', color: css(P.bone),
  stagger: 0.08, from: 'up', t: f.lt });                       // 返回这一行的宽度（含 tracking）
type.writeLine('右下角读数', W - 90, H - 90, { anchor: 'right', size: 34, family: 'mono' });
```

（`src/kit/layout.js` 的 `put()` 是同一个函数的转发，老代码不用改。）

### 3.4 多行正文 / 字幕块

```js
text.clear();
const lines2 = type.wrap('这一段会自动折行：中文按字折行，Latin words break by word boundary.', { size: 34, family: 'sans' }, W * 0.5);
lines2.forEach((ln, i) => {
  type.write(ln, W * 0.1, H * 0.62 + i * 46, {
    size: 34, family: 'sans', color: css(P.ash),
    alpha: [0, 1], t: f.lt - 0.3 - i * 0.12,      // 逐行淡入
  });
});
text.upload();
```

或者一行搞定：

```js
type.paragraph('说明文字……', W * 0.1, H * 0.62, { size: 34, family: 'sans', color: css(P.ash) }, { width: W * 0.5, lineHeight: 46, alpha: [0, 1], t: f.lt });
```

### 3.5 跟随数值的读数 / 计数器

```js
const pct = Math.round(prog(f.lt, 0.4, 3.4) * 100);
type.write(`${String(pct).padStart(3, ' ')}%`, W - 90, H - 90, {
  size: 34, family: 'mono', color: css(P.signal, 0.8), align: 'right',
});
// 滚动数字阵列（机器口吻的纹理）
for (let i = 0; i < 40; i++) {
  const v = Math.floor((f.lt * 37 * (0.4 + this.cells[i]) + i * 13) % 1000);
  type.write(String(v).padStart(3, '0'), 60 + (i % 8) * 26, 60 + Math.floor(i / 8) * 26, {
    size: 22, family: 'mono', color: css(P.signal, 0.12),
  });
}
```

---

## 4. 卡拉OK逐词同步

### 4.1 手写词表（没有歌词 json 时）

```js
import { css } from '../../../src/core/util.js';

export default {
  id: 'karaoke',

  setup(ctx) {
    // words 的每一项是「原文本的一段」，按顺序拼起来必须等于整行
    const line = '代码即素材 万物皆可渲染';
    const T0 = 1.6, STEP = 0.42, CHUNK = 2;
    this.line = line;
    this.words = [];
    for (let i = 0, k = 0; i < line.length; i += CHUNK, k++) {
      this.words.push({ w: line.slice(i, i + CHUNK), start: T0 + k * STEP, end: T0 + (k + 1) * STEP });
    }
    this.track = this.words[this.words.length - 1].end + 0.8;
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;
    const { W, H } = gl;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    text.clear();
    type.karaoke(this.line, this.words, W * 0.5 - 480, H * 0.52, f.lt, {
      size: 88, weight: 800, family: 'sans',
      base: css(P.ash),       // 未唱到
      sung: css(P.signal),    // 已唱到（会给泛光吃掉，所以用信号色）
      dim: 0.35,              // 还没轮到的整体不透明度
      lead: 0.25,             // 提前量：字可以稍早亮
      sweep: true,            // 词内从左到右擦出来
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.45, bloomThreshold: 0.85, halation: 0.3, grain: 0.03, vignette: 0.42 };
  },
};
```

### 4.2 词级时间戳怎么来、怎么喂给 `karaoke`

**上游不用自己造**：`node scripts/anim.mjs say <任务>` 会把 TTS 的**词级时间戳**写进
`audio/narration.json` 的 `lines[].words`（整片绝对时间），场景里从 `ctx.narration` 拿即可
（`docs/NARRATION.md` C 档；驱动协议见那一节，`tools/tts-edge.py` 是自带的那条路）。

> ⚠ **更正**：这一段以前写的是 `ctx.lyrics?.lines` —— 引擎里**从来没有** `ctx.lyrics` 这个字段，
> 所以那个例子会静默什么都不画（`?.` 把 undefined 吞了）。现在只有一条路：`ctx.narration`。
> 手写的歌词表也一样能喂进去：`task.narration` 接受只给 `lines[].words`（不给 `start`/`dur`）
> 的表，缺的起点/时长由词级时间戳推。`docs/COOKBOOK` 里那个 `lyrics.json` 的形状
> （`{ lines: [{ text, words: [{w,start,end}] }] }`）就是这张表。

```js
render(ctx) {
  const { f, type, text, comp, gl, P } = ctx;
  // 正在说的那句；说完之后再挂 1.2s（字幕不该在话音落下那一瞬消失）
  const cur = ctx.narration.at(f.t) ?? ctx.narration.recent(f.t, 1.2);
  if (!cur?.words) return;
  text.clear();
  type.karaoke(cur.text, cur.words, 200, 800, f.t, {
    size: 76, weight: 800, family: 'sans', base: css(P.ash), sung: css(P.signal),
  });
  // 下一行预告（按整片时间找"还没开始说的最近一句"）
  const nxt = ctx.narration.lines.find((l) => l.start > f.t);
  if (nxt) type.write(nxt.text, 200, 890, { size: 40, family: 'sans', color: css(P.ash, 0.45) });
  text.upload();
  comp.draw(gl, text, ctx.out, { premult: false });
}
```

⚠ 两个位置前提（`type.karaoke` 现在是按这两个前提算的，写错会有警告）：
`words` 按顺序拼起来必须等于 `text`（`anim say` 会把 TTS 漏掉的标点并进相邻词，拼回来一定相等）；
`words[].start/end` 与传给 `karaoke` 的 `t` 必须**同一个时钟** —— `anim say` 写的是整片时间，所以配 `f.t`。

### 4.3 扫过的光带跟着唱（不用 karaoke，自己算）

```js
// 词内的擦除进度：e = outCubic((t - start + lead) / (end - start))
const e = 1 - (1 - Math.min(1, Math.max(0, (f.t - w.start + 0.25) / Math.max(0.04, w.end - w.start)))) ** 3;
// 用 e 驱动一条竖线的位置即可（配合 karaoke 的 sung 色形成"光带扫过"的错觉）
lines.begin();
lines.seg(x0 + wpx * e, y - 40, x0 + wpx * e, y + 40, 3, [P.ember[0] * 2, P.ember[1] * 2, P.ember[2] * 2]);
lines.flush(ctx.out);
```

---

## 5. 沿路径写字与路径运动

### 5.1 沿曲线滚动歌词

```js
setup(ctx) {
  // 折线路径：正弦波
  this.path = Array.from({ length: 80 }, (_, i) => {
    const x = (i / 79) * 1920;
    return [x, 760 + Math.sin(i * 0.18) * 90];
  });
},

render(ctx) {
  const { f, gl, P, text, type, comp, lines } = ctx;
  gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

  lines.begin();
  lines.polyline(this.path, 2, [P.graphite[0] * 0.7, P.graphite[1] * 0.7, P.graphite[2] * 0.7]);
  lines.flush(ctx.out);

  text.clear();
  type.writeOnPath('沿路径滚动的歌词 · text on a path · 可以随便 seek', this.path, { size: 46, family: 'sans' }, {
    offset: f.lt * 260,                       // 每秒滚 260 逻辑像素
    color: css(P.bone),
    alpha: 0.95,
    perChar: (ch, i) => ({                    // 逐字微调：波浪起伏
      dy: Math.sin(i * 0.6 + f.lt * 4) * 6,
      scale: 1,
      alpha: 0.75 + 0.25 * Math.sin(i * 0.5),
    }),
  });
  text.upload();
  comp.draw(gl, text, ctx.out, { premult: false });
}
```

### 5.2 沿路径运动的物体（不用 TextKit）

```js
import { polylineLengths, pointAtLength } from '../../../src/core/util.js';

setup(ctx) {
  this.path = Array.from({ length: 60 }, (_, i) => [120 + i * 28, 540 + Math.cos(i * 0.3) * 220]);
  this.acc = polylineLengths(this.path);
  this.total = this.acc[this.acc.length - 1];
},

render(ctx) {
  const { f, lines, P } = ctx;
  const s = (f.lt * 420) % this.total;                 // 循环前进
  const [x, y, ang] = pointAtLength(this.path, this.acc, s);
  lines.begin();
  lines.polyline(this.path, 1.5, [P.graphite[0] * 0.5, P.graphite[1] * 0.5, P.graphite[2] * 0.5]);
  // 切线方向的短线段 = 速度感
  lines.seg(x, y, x - Math.cos(ang) * 60, y - Math.sin(ang) * 60, 6, [P.signal[0] * 1.8, P.signal[1] * 1.8, P.signal[2] * 1.8]);
  lines.flush(ctx.out);
}
```

---

## 6. 粒子：出生时间的函数

### 6.1 核心写法

```js
import { css } from '../../../src/core/util.js';

export default {
  id: 'particles',

  setup(ctx) {
    const r = ctx.rng(2024);                    // 确定性随机，setup 里一次算好
    this.parts = Array.from({ length: 1600 }, () => {
      const t0 = r() * 6;                       // 出生时刻
      return {
        x0: 240 + r() * 1440,                   // 出生点
        y0: 1080,
        vx: (r() - 0.5) * 320,
        vy: -520 - r() * 620,
        g: 620 + r() * 320,
        life: 1.6 + r() * 1.8,
        w: 1.5 + r() * 4,
        hue: r(),
        t0,
      };
    });
  },

  render(ctx) {
    const { f, gl, P, lines, text, type, comp } = ctx;
    const { W, H } = gl;
    gl.clear(ctx.out, [P.ink[0] * 0.8, P.ink[1] * 0.8, P.ink[2] * 0.8]);

    lines.begin();
    for (const p of this.parts) {
      const age = f.lt - p.t0;                  // ← 只依赖时间，不积分
      if (age < 0 || age > p.life) continue;    // 未出生 / 已消亡

      const x = p.x0 + p.vx * age;
      const y = p.y0 + p.vy * age + 0.5 * p.g * age * age;
      const k = 1 - age / p.life;               // 生命进度 1 → 0

      // 颜色：信号色 → 余烬，亮度随生命衰减（超过 1 的部分用来发光）
      const c = [
        (P.signal[0] * 0.6 + P.ember[0] * p.hue) * (0.4 + k) * 1.6,
        (P.signal[1] * 0.6 + P.ember[1] * p.hue) * (0.4 + k) * 1.6,
        (P.signal[2] * 0.6 + P.ember[2] * p.hue) * (0.4 + k) * 1.6,
      ];

      // 用「当前位置 → 上一瞬间的位置」当拖尾（微分，仍是解析解）
      const dt = 0.02;
      const px = p.x0 + p.vx * (age - dt);
      const py = p.y0 + p.vy * (age - dt) + 0.5 * p.g * (age - dt) * (age - dt);
      lines.seg(x, y, px, py, p.w * (0.4 + k), c);
    }
    lines.flush(ctx.out);

    return { bloom: 0.55, bloomThreshold: 0.85, halation: 0.35, grain: 0.03, vignette: 0.45 };
  },
};
```

**验收**：`still` 分别渲染 `t=1.0` 和「先播到 5.0 再跳回 1.0」，两张图必须完全一样。

### 6.2 一次性爆发（用 `hit` / 事件时刻做触发）

```js
import { hit } from '../../../src/core/util.js';

// 在 t=0.4 炸一次，1.2 秒内所有粒子出生（出生时刻是常量，不是随机）
const BURST = 0.4;
this.parts = Array.from({ length: 900 }, (_, i) => ({
  t0: BURST + (i / 900) * 0.25,        // 出生时刻的确定性分布
  ang: (i * 2.399963) % (Math.PI * 2), // 黄金角，均匀铺开
  spd: 260 + ((i * 37) % 100) / 100 * 520,
}));

render(ctx) {
  const { f, lines, P } = ctx;
  lines.begin();
  for (const p of this.parts) {
    const age = f.lt - p.t0;
    if (age < 0) continue;
    const spd = p.spd * Math.exp(-age * 1.6);          // 阻尼的解析解（指数衰减）
    const d = p.spd * (1 - Math.exp(-age * 1.6)) / 1.6; // 位移的解析积分
    const x = 960 + Math.cos(p.ang) * d;
    const y = 540 + Math.sin(p.ang) * d;
    const k = Math.exp(-age * 1.4);
    if (k < 0.02) continue;
    lines.seg(x, y, x - Math.cos(p.ang) * spd * 0.02, y - Math.sin(p.ang) * spd * 0.02, 1 + 3 * k,
      [P.signal[0] * 2 * k, P.signal[1] * 2 * k, P.signal[2] * 2 * k]);
  }
  lines.flush(ctx.out);
}
```

> 阻尼运动的解析解：`v(t) = v0 * e^{-ct}`，`x(t) = x0 + (v0/c)(1 - e^{-ct})`。
> 只要写出解析解，就永远不需要积分，也就永远可以任意 seek 和多子帧采样。

### 6.3 粒子用 shader 做（几万个）

```js
this.dust = new Pass(ctx.gl, /* glsl */ `
  uniform float seed;
  void main() {
    vec2 p = FRAG_PX / RES_LOGICAL;
    vec3 col = C_INK;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      // 每层 40 个"粒子"：用网格 + 哈希做，位置是 t 的函数
      vec2 g = floor(p * (14.0 + fi * 9.0));
      vec2 h = hash22(g + seed + fi * 17.0);
      float birth = h.x * 6.0;
      float age = t - birth;
      if (age < 0.0 || age > 3.0) continue;
      vec2 c = (g + 0.5) / (14.0 + fi * 9.0);
      vec2 pos = c + vec2(sin(age * 0.7 + h.y * 6.28), -age * 0.16 + cos(age * 0.5) * 0.02);
      float d = length((p - pos) * vec2(RES_LOGICAL.x / RES_LOGICAL.y, 1.0));
      float k = exp(-age * 1.2) * smoothstep(0.006, 0.0, d);
      col += C_SIGNAL * k * 2.0;
    }
    fragColor = vec4(col, 1.0);
  }`, { seed: 3.0 }, { key: 'ck_dust', blend: false });
```

用 shader 做粒子时同样要守规矩：**别用 `fract(t)` 当随机源**（每个子帧不同 → 台阶），要随帧变化就用 uniform 传 `f.seed`。

---

## 7. 屏幕震动 / 闪白 / 推近 / 色差

这些全部是**后处理参数**，写在 `render()` 的返回值里，跟音频或事件驱动：

```js
import { hit, pulse, ease, prog } from '../../../src/core/util.js';
import { shakeSmooth } from '../../../src/core/cam.js';

render(ctx) {
  const { f } = ctx;
  const a = f.a;                                   // 音频特征（没配音乐时不是 undefined，而是全 0 —— 见 §10.1）
  const energy = Math.sin(Math.min(1, prog(f.lt, 0.8, 1.1)) * Math.PI);  // 一次冲击的包络
  const settle = prog(f.lt, (f.end - f.start) * 0.55, f.end - f.start);  // 镜头"停住"的进度（0→1）

  return {
    // —— 抖动分两种，别混（完整的幅度×频率对照表见 ENGINE.md §8）：
    // ① 手持 / 呼吸：用 t 的**平滑**函数，并且幅度随"镜头停住"衰减
    shake: shakeSmooth(f.t, (1.1 + 1.3 * energy) * (1 - 0.75 * settle)),   // src/core/cam.js
    // ② 冲击 / 震屏（爆炸、砸字，故意要抖）：一次性大值，可以快
    // shake: [energy * 9, -energy * 6],

    // —— 闪白 / 闪黑
    flash: 0.06 * pulse(f.lt, 4, 0.05),            // 每 4 秒闪一下（周期脉冲）
    fade: 0.35 * Math.max(0, f.tout - 0.75) * 4,   // 出场时压黑（tout 只在重叠时有值）

    // —— 推近 / 拉远（以画面中心为锚点）
    zoom: 1 + 0.06 * energy + (a.low ?? 0) * 0.02,

    // —— 速度感
    ca: 0.9 * energy,                              // 色差
    radialBlur: 0.8 * energy,                      // 径向模糊（与 ca 互斥：有它 ca 就失效）
    blur: 0,

    // —— 打击事件驱动（有音乐时最省事）
    exposure: 1 + 0.25 * energy,
    bloom: 0.4 + 0.3 * energy,
    halation: 0.25 + 0.2 * energy,
    grain: 0.03 + 0.02 * energy,
  };
}
```

单次撞击（知道时刻时）：

```js
const kick = hit(f.lt, 1.35, 0.10);               // t=1.35 打一下，半衰期 0.10s
return { flash: kick * 0.12, shake: [kick * 9, -kick * 6], zoom: 1 + kick * 0.04, ca: kick * 0.6 };
```

有音乐时用真实鼓点：

```js
const a = f.a;
return {
  flash: a.kick * 0.05,                            // ±60ms 窗内的瞬时强度
  shake: [a.kick * 5, a.snare * 3],
  zoom: 1 + a.low * 0.02,
  ca: a.kick * 0.4,
  exposure: 1 + a.rms * 0.15,
};
```

**注意**：`ca` 与 `blur`/`radialBlur` 在 `pFinal` 里是**二选一**（只要 `blur>0` 或 `radialBlur>0`，色差就被跳过）。想同时要，就把色差做在场景里（用合成器的 `mode: 'add'` 叠三个偏移通道的副本），或者分开两段。

---

## 8. 自定义转场

> **按省事程度，先试前两条，不行才往下走：**
> 1. **甩镜**：`{ type: 'whip', dur: 1, overlap: 0.5 }` —— `src/shots/whip.js` 自带 `handlesTransition: true`
>    与震屏/压黑/速度线，只要给它 `overlap`（参数只有 `streaks` / `dir`）。
> 2. **引擎默认交叉溶解**：别的场景写 `overlap` 就行。⚠ **文字量大的画面别用**（两屏字叠一起会糊），改用 1。
> 3. **要自己掌控**（本节下面的写法）：`cut(scene, { world: 'auto' })` + `src/kit/world.js` 的
>    `makeWorldKit(ctx)` / `worldPass(ctx, { grid, accent, warp, vignette })` ——
>    `openFrame()` 每帧画**全片唯一那层背景**并把上一帧沿摄影机方向甩走，`enterOffset(f.t, k, 220)`
>    让新内容从反方向落位，`return cameraPost(f.t, { bloom: 0.34 })` 保证摄影机不断。
>    这四条是"不像幻灯片"的配方，缺一条就露馅（`AGENTS.md` §4.5 / `docs/ENGINE.md` §3.7.6）。

### 8.1 默认交叉溶解（什么都不用写）

```js
// task.config.mjs
cut(outro, { dur: 3, overlap: 0.6 })      // outro 的 f.tin 在这 0.6s 里从 0 走到 1
```

### 8.2 甩镜（采样 `ctx.under` + 方向性模糊）

```js
import { Pass } from '../../../src/core/gl.js';
import { ease } from '../../../src/core/util.js';

export default {
  id: 'whip',
  handlesTransition: true,                   // ← 必须声明，否则引擎会先做交叉溶解

  setup(ctx) {
    this.whip = new Pass(ctx.gl, /* glsl */ `
      uniform sampler2D under;
      uniform float k;        // 0 → 1 转场进度
      uniform vec2  dir;
      void main() {
        vec2 uv = vUv;
        float amt = sin(k * PI) * 0.06;               // 中段拉得最长
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 10; i++) {
          float f = float(i) / 9.0;
          vec2 o = dir * (f - 0.5) * amt * (0.35 + uv.y);
          float w = 1.0 - abs(f - 0.5) * 0.7;
          acc += texture(under, clamp(uv + o, 0.0, 1.0)).rgb * w;
          wsum += w;
        }
        vec3 col = acc / wsum;
        col *= mix(1.0, 0.15, smoothstep(0.6, 1.0, k));       // 收暗
        col += C_SIGNAL * 0.25 * smoothstep(0.75, 1.0, k) * (1.0 - smoothstep(0.9, 1.0, k));
        fragColor = vec4(max(col, vec3(0.0)), 1.0);
      }`, { under: { value: null }, k: 0, dir: [1, 0.15] }, { key: 'ck_whip', blend: false });
  },

  render(ctx) {
    const { f, gl, P, lines } = ctx;
    const { W, H } = gl;
    const k = ctx.under ? ease.inOutCubic(f.tin) : 1;   // 没有 under（比如被单独渲染）就当普通段

    gl.clear(ctx.out, [0, 0, 0]);
    if (ctx.under) {
      this.whip.u.under.value = { tex: ctx.under.tex ?? ctx.under, __tex: true };
      this.whip.u.k.value = k;
      this.whip.u.dir.value = [1, 0.12];
      this.whip.render(gl, ctx.out, f.t, f.dt);
    }

    // 速度线：转场最激烈时最亮
    const energy = Math.sin(Math.min(1, k) * Math.PI);
    lines.begin();
    for (let i = 0; i < 26; i++) {
      const s = i * 0.37;
      const y0 = ((s * 977) % 1) * H;                     // 固定算式，不用随机
      const len = 220 + ((s * 331) % 1) * 520;
      const x0 = ((s * 613) % 1) * W - len * 0.3;
      const a = energy * (0.35 + 0.65 * ((s * 149) % 1));
      lines.seg(x0, y0, x0 + len, y0 - len * 0.12, 1.5 + 2.5 * a, [P.bone[0] * a, P.bone[1] * a, P.bone[2] * a]);
    }
    lines.flush(ctx.out);

    return { bloom: 0.6, halation: 0.4, ca: 0.9 * energy, radialBlur: 0.8 * energy, exposure: 1 + 0.25 * energy };
  },
};
```

时间线上要重叠它：

```js
cut(whip, { dur: 1.1, overlap: 0.45, handlesTransition: true })
```

### 8.3 闪白转场（两段不重叠，靠 `fade`/`flash`）

```js
// 上一段末尾
return { flash: Math.max(0, prog(f.lt, dur - 0.25, dur)) * 1.0 };
// 下一段开头
return { flash: 1 - prog(f.lt, 0, 0.25) };
```

### 8.4 用合成器叠两张图（不写 shader）

```js
// 需要事先把某一帧存成 RT：comp.copyOver(gl, ctx.out, this.freezeRT) 之类
comp.copyOver(gl, this.freezeRT, ctx.out, 1);
comp.draw(gl, this.liveLayer, ctx.out, { mode: 'screen', opacity: k, tint: [1.06, 1.0, 0.96] });
```

`mode` 可选：`normal / add / screen / multiply / max / min / overlay`。

---

## 9. 图片与纹理叠加

引擎的默认审美是"全部算出来"，但**真实素材（logo、产品截图、照片、纹理）是可以当图层画进来的**——
对外材料里用真 logo / 真截图，通常比手画一个更像、也更有说服力。两条路，先试第一条：

| 想要 | 走哪条 | 说明 |
|---|---|---|
| 把一张图**原样摆上去**（logo、截图、二维码） | 画进 `ctx.text.ctx`：`setup` 里 `this.img = new Image(); this.img.src = url; await this.img.decode();`，`render` 里 `text.ctx.drawImage(this.img, x, y, w, h)`，之后照常 `upload()` + `comp.draw` | 最省事；它在文字层里，所以还能在图上接着叠字 |
| 当**纹理**用（shader 采样、扭曲、溶解、发光） | §9.1 的 `loadTexture()` + `comp.draw(..., { rect, uvRect, tint })` | 要自己建纹理句柄 |

共同的铁律：**加载一律在 `setup`（可以 `async setup`）里做完**，`render` 里不许有 await / IO；
素材放 `public/`（按站点根路径引用）或用 `import url from './x.png'` 让 Vite 处理。
（⚠ 这条路本仓库还没有任务正式用过 —— 第一次用先 `still` 出一帧确认图真的在，别等出片。）

### 9.1 加载一张图当纹理

```js
export default {
  id: 'texture',

  async setup(ctx) {
    this.tex = await loadTexture(ctx.gl, '/images/logo.png');   // 见下面的工具函数
  },

  render(ctx) {
    const { gl, comp, f, P } = ctx;
    ctx.gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    const k = Math.min(1, f.lt / 0.8);
    comp.draw(gl, this.tex, ctx.out, {
      mode: 'normal',
      opacity: 0.9 * k,
      rect: [660, 340, 600, 400],        // 目标区域（逻辑像素，y 向下）
      uvRect: [0, 0, 1, 1],              // 源的采样范围（做精灵图/裁切）
      tint: [1 + 0.4 * k, 1, 1],         // 线性乘子，>1 的部分会泛光
    });
  },
};

/** 图片 URL → 可当 uniform / 源图层用的纹理句柄（确定性：加载在 setup 里完成） */
async function loadTexture(gl, url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const g = gl.ctx;
  const tex = g.createTexture();
  g.bindTexture(g.TEXTURE_2D, tex);
  // 用 SRGB8_ALPHA8，硬件会把 sRGB 像素解码成线性 —— 跟 Layer2D 一致
  g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, g.RGBA, g.UNSIGNED_BYTE, img);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  return { tex, __tex: true };
}
```

要点：

- **`setup` 里加载**（可以是 `async setup`，引擎会 `await scene.setup(...)`）。`render` 里不能有异步/IO。
- 图片放 `public/` 下（按站点根路径引用），或者用 `import url from './x.png'` 让 Vite 处理。
- 上传时**不要**自己翻 Y（`UNPACK_FLIP_Y_WEBGL` 保持 false），`Compositor` 负责映射。
- 想要「发光」：`tint` 给大于 1 的值（例如 `[1.8, 1.2, 0.9]`），配合 `bloom`。

### 9.2 用 shader 采样纹理（做扭曲/溶解）

```js
setup(ctx) {
  this.dissolve = new Pass(ctx.gl, /* glsl */ `
    uniform sampler2D img;
    uniform float k;                 // 0..1 溶解进度
    uniform vec4 rect;               // 目标区域（逻辑像素，y 向下）
    void main() {
      vec2 p = FRAG_PX;
      vec2 uv = (p - rect.xy) / rect.zw;
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
      uv.y = 1.0 - uv.y;             // 逻辑坐标 y 向下 → 纹理 y 向上
      float n = fbm(uv * 8.0);
      if (n > k) discard;            // 噪声溶解
      vec3 col = texture(img, uv).rgb;
      col += C_SIGNAL * smoothstep(k - 0.06, k, n) * 2.0;   // 溶解边缘发光
      fragColor = vec4(col, 1.0);
    }`, { img: { value: null }, k: 0, rect: [660, 340, 600, 400] }, { key: 'ck_dissolve', blend: true });
}
```

---

## 10. 音频踩拍

> **三个"跟着音乐动"的画面已经有模板**（都需要先配 `audio` + 跑 `analyze`，而且**自带爆点 post**：
> flash / shake / zoom / ca / exposure，不用你自己写）：
>
> | 想要 | 一行 |
> |---|---|
> | 波形（包络历史窗口 + kick 横线 + 读数） | `shot('wave', { label: 'BEAT', cols: 240, window: 1.2 })` |
> | 每拍扩一圈的同心圆 | `shot('pulse', { title: '节奏不需要手抄' })` |
> | 频谱网格（每列一个频段） | `shot('grid', { label: 'AUDIO → GEOMETRY', cols: 32, rows: 12 })` |
>
> 时间基准不同：`wave` 读**整片时间** `f.t`，`pulse` / `grid` 读**段内时间** `f.lt` —— 决定它们该放在第几段。
> 下面的手写版是"要改画面时"的参考。

### 10.1 准备

```sh
# 1) 任务里配好音频（相对任务目录）
# audio: './audio/track.mp3'
# 2) 生成预计算特征（CLI 在 video 时会自动补，手动跑更快看到结果）
node scripts/anim.mjs analyze <任务>
# → tasks/<任务>/audio/track.analysis.json
```

之后场景里 `f.beat` / `f.a` / `ctx.music` 全部可用。**没有音频时**：`f.beat = t*2`（相当于 120bpm）；
而 `ctx.music` **不是 `null`** —— 它是一个空对象 `SILENT`：`music.hasAudio === false`、`music.beats.length === 0`、
包络全是 `0`，所以 **`f.a` 的字段是 `0` 而不是 `undefined`**。想判"有没有音乐"用 `ctx.music.hasAudio`
（或 `music.beats.length > 0`），**不要**写 `if (!ctx.music)` 或 `f.a.rms === undefined` —— 那两种判法都会判反。
（例外：`wave`/`pulse`/`grid` 三个模板里，没音乐时 `pulse` 仍会画中心方块与底部标题，`wave`/`grid` 才几乎是空的。）

### 10.2 逐帧包络（波形 / 频谱）

```js
render(ctx) {
  const { f, gl, P, lines, music } = ctx;
  const { W, H } = gl;
  gl.clear(ctx.out, [P.ink[0] * (0.5 + (f.a.rms ?? 0) * 1.6), P.ink[1], P.ink[2]]);

  // 以当前时刻为右端、向左 1.2s 的波形窗
  const cols = 240, win = 1.2, midY = H * 0.5;
  lines.begin();
  for (let i = 0; i < cols; i++) {
    const tt = Math.max(0, f.t - win + (win * i) / cols);
    const fi = Math.min(music.rms.length - 1, Math.round(tt * music.fps));   // 包络数组按下标查
    const env = music.rms[fi] ?? 0;
    const lo = music.low[fi] ?? 0;
    const x = (W * i) / (cols - 1);
    const h = 20 + env * 300 + lo * 90;
    const near = i / cols;                                   // 越靠右（越接近现在）越亮
    const col = near > 0.94 ? P.signal : [P.bone[0] * near, P.bone[1] * near, P.bone[2] * near];
    lines.seg(x, midY - h * 0.5, x, midY + h * 0.5, 2 + near * 1.5, col);
  }

  // 每个 kick 打一道横线（真实事件，不是拍网格）
  for (const k of music.hits('kick', f.t - 2.2, f.t)) {
    const e = Math.exp(-(f.t - k.t) / 0.5);
    lines.seg(0, midY - e * 340, W, midY - e * 340, 1.5, [P.signal[0] * e * 2, P.signal[1] * e * 2, P.signal[2] * e * 2]);
  }
  lines.flush(ctx.out);
}
```

### 10.3 每拍扩一圈（同心圆）

```js
const cx = W * 0.5, cy = H * 0.46;
lines.begin();
for (let i = 0; i < 8; i++) {
  const kt = music.nearestBeat(f.t - (i + 1) * 0.5);        // 往前数第 i+1 个半拍的拍点
  const age = f.t - kt;
  if (age < 0 || age > 3.2) continue;
  const r = 60 + age * 340;
  const fade = Math.exp(-age / 1.2);
  const hit = music.hit('kick', kt + 0.001, 0.2);            // 衰减脉冲
  lines.circle(cx, cy, r, 1.5 + hit * 8, [P.signal[0] * fade * 2, P.signal[1] * fade * 2, P.signal[2] * fade * 2], 96);
}
lines.flush(ctx.out);
```

### 10.4 把后处理交给音频

```js
const a = f.a;
return {
  flash: (a.kick ?? 0) * 0.05,
  shake: [(a.kick ?? 0) * 3, (a.snare ?? 0) * 2],
  zoom: 1 + (a.low ?? 0) * 0.02,
  exposure: 1 + (a.rms ?? 0) * 0.15,
  bloom: 0.35 + (a.high ?? 0) * 0.3,
  ca: (a.kick ?? 0) * 0.4,
};
```

### 10.5 切割点对齐拍子

```js
// task.config.mjs —— `at` 与 `dur` 都接受 { beat: n } / { bar: n }；`dur` 还接受 { vo: 'line-id', tail: 1.2 }
import { seq, cut, par } from '../../src/timeline.js';

export default {
  audio: './audio/track.mp3',
  timeline: seq([
    cut(intro, { at: { beat: 0 },  dur: { beat: 16 } }),    // 16 拍
    cut(main,  { at: { beat: 16 }, dur: { beat: 32 } }),    // 第 16 拍起、32 拍长
    par(0.5, [cut(bridge, { dur: { beat: 4 } }), cut(flash, { dur: { beat: 2 } })]),  // 转场重叠 0.5s
    cut(outro, { at: { bar: 12 }, dur: { bar: 2 } }),       // 第 12 小节起、2 小节长
  ]),
};
```

⚠ `{ beat: n }` 的长度是按**第 0 拍 → 第 n 拍**在拍网格上量的（`timeline.js` 的 `resolveDur` + `beatTime`）：
匀速曲目下就等于 n 拍；变速/现场演奏的曲子会略偏。要精确贴住某处，**用 `at: { beat: k }` 把起点钉在拍上**，
长度自己算（见下）。

想要精确到秒的拍点，就在代码里算（用 `MusicData.timeOfBeat`）：

```js
// 需要先有 music 对象：在 scenes 里可以直接读 ctx.music.timeOfBeat(n)
const t = ctx.music.timeOfBeat(32) - ctx.music.timeOfBeat(16);   // 第 16→32 拍的长度
```

### 10.6 段落驱动（副歌切风格）

```js
const sec = music.sectionAt(f.t);
const energy = sec?.energy ?? 0.5;
return { bloom: 0.3 + energy * 0.4, vignette: 0.5 - energy * 0.2, saturation: 0.95 + energy * 0.15 };
```

---

## 11. 多段编排与重叠

### 11.1 一份完整的时间线

```js
// tasks/<任务>/task.config.mjs
import { seq, cut, par, at } from '../../src/timeline.js';
import title from './scenes/title.js';
import chart from './scenes/chart.js';
import whip from './scenes/whip.js';
import outro from './scenes/outro.js';

export default {
  title: '我的片子',
  width: 1920, height: 1080, fps: 60, scale: 1,
  palette: { signal: '#ff4d12' },
  audio: './audio/track.mp3',

  timeline: seq([
    cut(title, { dur: 4.0, note: '标题' }),
    cut(chart, { dur: 5.0, params: { variant: 'bars' }, post: { bloom: 0.22, bloomThreshold: 1.0 } }),
    // 甩镜转场：重叠 0.45s，whip 自己处理这个重叠
    cut(whip, { dur: 1.1, overlap: 0.45, handlesTransition: true }),
    cut(outro, { dur: 3.0, maxSamples: 24 }),          // 这一段噪声多，压一下采样上限
  ]),
};
```

### 11.2 三种重叠写法

```js
// A) 单段与前一段重叠（最常用：转场）
cut(b, { dur: 4, overlap: 0.5 })

// B) 一组同时开始，整组与前一组重叠
par(0.6, [ cut(x, { dur: 2.0 }), cut(y, { dur: 2.4 }) ])    // 组内 x、y 并行，组整体与上一组重叠 0.6s

// C) 绝对定位（自己管时间，注意 at 之后游标按 at+dur 走）
at(6.0, 9.0, scene, { params: { x: 1 } })
```

### 11.3 段内的「章节」用 `f.p` / `f.lt` 编排

```js
render(ctx) {
  const { f } = ctx;
  const t = f.lt, dur = f.end - f.start;
  const phase =
    t < 1.2 ? 'in' :
    t < dur - 1.0 ? 'hold' : 'out';
  // 用 prog 切时段，比分 if 更好读
  const inK = prog(t, 0.1, 1.2);
  const outK = prog(t, dur - 1.0, dur);
  // ...
  return { fade: outK * 0.9 };      // 段尾压黑，避免硬切
}
```

### 11.4 段尾收尾（不要硬切到黑）

```js
const dur = f.end - f.start;
return {
  fade: Math.max(0, (f.lt - (dur - 0.6)) / 0.6),      // 最后 0.6s 压黑
  exposure: 1 - 0.15 * prog(f.lt, dur - 1.2, dur),
};
```

---

## 12. 4K 渲染

```sh
# 单帧 4K（看图确认细节：线宽、字号、AA）
node scripts/anim.mjs still <任务> -t 6 --scale 2

# 整片 4K
node scripts/anim.mjs video <任务> --scale 2 --crf 18
```

`scale` 接受 **1..4**（2 = 真 4K）。历史上 `--scale 2` 被 CLI 直接拒绝，因为 `LineBatch`
在 `SCALE>1` 下不出图；**根因已定位并修好**（顶点着色器用逻辑分辨率换算裁剪空间，
与 SCALE 无关），现在矢量、文字、后处理在 4K 下都正常。

引擎侧的规则：

- `scale: 2` 是**真分辨率**：场景仍按逻辑 1920×1080 布局，帧缓冲是 3840×2160。写法上**什么都不用改**——只要遵守下面两条。
- 任何跟「像素尺寸」有关的 shader 计算都不能写死：用 `FRAG_PX`（逻辑像素）、`fwidth(...)`、`pxLine`、`uStep`。写死 `gl_FragCoord / 2.0` 这类假设会在 4K 下错位或变成硬边。**顶点里也别用 `res`（物理尺寸）去换算裁剪空间**——那是 4K 矢量消失的老坑。
- `LineBatch` 的 `width` 与文字 `size` 都是逻辑像素，4K 下自动变细/变清晰（这是对的）。
- shader 里线宽用 `fwidth`：`float w = fwidth(d) * 1.2;` 这样两种分辨率下都是「一根线」。
- 后处理链（4 级 bloom）在分辨率变化时自动重建，不用管。
- 4K 的成本大约是 1080p 的 3–4 倍；`--scale 2` 建议配 `--samples` 降低（比如 `--samples 24`）或 `--tol 4`。

分层的成本也要注意：每个时间线条目一张 `Layer2D`（4K 下每层约 33MB 的 Canvas2D 位图），段数多的时候内存会顶上来。4K 长片建议**控制段数**。

**验收 4K 有没有坏**：`node tools/probe-ribbon.mjs 11.2 1,2` —— 一根粗矢量带子在两个倍率下的
**逻辑位置与尺寸必须一致**（`_calib` 的 `ribbon` 场景是为此准备的）。

---

## 13. 性能优化

按收益从高到低：

### 13.1 别每帧建对象 / 别每帧进 GPU 分配

```js
// ✗ 每帧 new：GC 抖动 + 上传/编译开销
render(ctx) {
  const batch = new LineBatch(ctx.gl, 1000);
  const p = new Pass(ctx.gl, `...`);
}

// ✓ 资源在 setup 里建，render 里只改 uniform / 复用数组
setup(ctx) {
  this.batch = new LineBatch(ctx.gl, 4000);
  this.p = new Pass(ctx.gl, `...`, {}, { key: 'my_pass', blend: false });
  this.pts = new Array(2000);                  // 复用的坐标数组
}
```

`Pass` 有程序缓存（按 `key`），`LineBatch` 预分配顶点缓冲，`TextKit` 缓存 `measure`/`layout`。**复用它们，别重建。**

### 13.2 预计算：`setup` 里把能算的都算完

```js
setup(ctx) {
  const r = ctx.rng(9);
  // 预计算：随机量、静态几何、累计弧长、查表
  this.rnd = rngArray(4096, 9);                 // Float32Array，避免每帧调 rng()
  this.acc = polylineLengths(this.pts);
  this.table = Array.from({ length: 720 }, (_, i) => [Math.cos(i / 720 * TAU), Math.sin(i / 720 * TAU)]);
}
```

### 13.3 少画线段 = 最直接的提速

一条线段 = 6 个顶点 + 6×13 个 float。`ctx.lines` 的容量是 60000 条，超了会静默丢弃。真要画几万条时：

- 用**更少的线段近似曲线**（`circle` 的 `segs` 从 96 降到 24，小圆看不出差别）。
- 大量重复的点阵用 **shader 做**（§6.3），不要用几万条 `seg`。
- 屏幕外的元素直接 `continue` 掉（先做包围盒判定）。

```js
lines.begin();
for (const d of this.dots) {
  const x = d.x * W, y = d.y * H;
  if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;   // 裁剪
  lines.seg(x, y, x, y + 6, 2, P.signal);
}
lines.flush(ctx.out);
```

### 13.4 图层数量与上传开销

- 每段一张 `Layer2D`，**每帧上传一次**：1080p 约 1–3ms，4K 约 4 倍。同一帧内多次 `upload()` 只会传一次，但 `clear()` 之后 `_uploaded` 会复位，所以别在同一帧里反复 `clear` → 画 → `upload`。
- 能用 `LineBatch` 画的图形就别用 Canvas2D 画（Canvas2D 要上传位图，矢量是直接写 GPU 缓冲）。
- 文字层少而精：`type.write` 内部是逐字 `fillText`，几百个字不便宜（计数器阵列那种要克制）。

### 13.5 运动模糊是最大的成本项

子帧数 8/24/72/216 直接决定耗时。控制手段：

- 场景层面减少「高对比边缘快速移动」——这类画面会一路吃到 216 子帧。
- 用 `cut(..., { maxSamples: 8 })` 给噪声/粒子场景压上限。⚠ `maxSamples` **只会往下压**
  （合法档位 8 / 24 / 72 / 216，取在播段里最小的那个），它是**提速**旋钮，**不是"加密采样"** ——
  写 `maxSamples: 64` 只会被夹到 24，画面反而更粗且不报错。
- **`--tol` 是双向的**（默认 2.5，单位是显示空间 0..255 的级数）：**调小 = 更晚停、更细腻、更慢**，
  它是「拖影有台阶」的第一解法（比加 `--samples` 便宜）；调大 = 更快、更容易有台阶。
- `--shutter` 调小（默认 0.5）拖影短、台阶也不明显，可以用更少子帧。
- 出图阶段（`still`）用 `--samples 1`；`shot` 默认就是 8。
- 要提速又不想掉画质：**先试 `--gpu high`**（填充重的段实测 2.15×，逐像素不变），详见 `docs/PERF.md` §2–§3。

### 13.6 用 `perf` 找瓶颈

```sh
node scripts/anim.mjs perf <任务> --from 4 --to 9 --samples auto
#   帧数 300  平均 42.1ms  p50 38.0ms  p95 88.4ms  最慢 220.1ms
#   子帧分布 8子帧:210帧  24子帧:78帧  72子帧:12帧
```

读法：`p95 / p50` 的比值说明尖峰在哪。如果子帧分布大量落在 72/216，说明画面里有高速移动的高对比元素——先看是不是可以拆段/减元素，而不是先调引擎。

### 13.7 常见反模式

| 反模式 | 代价 | 改法 |
|---|---|---|
| `render` 里 `new Pass` / `new LineBatch` / `new Array(10000)` | 每帧 GC 抖动，帧时间不稳定 | 移到 `setup` |
| 每帧 `ctx.text.clear()` 后画上千个字 | Canvas2D 逐字 `fillText` × 子帧数 | 减少字数，或换成 `LineBatch`/shader |
| 每帧做 `polylineLengths` | O(n) 重复计算 | `setup` 里算好存起来 |
| 在 `render` 里 `await fetch` / 读文件 | 破坏纯函数，离屏渲染直接失效 | `setup`（可以 `async setup`） |
| 把 4K 图层当画布反复 `clear`/`upload` | 每次 33MB 带宽 | 一帧只 `clear`+`upload` 一次 |
| 全片 `scale: 2` 但只在小屏看 | 3–4 倍时间 | 先 1080p 定稿，最后才出 4K |

---

## 14. 真 3D：投影线段批 与 raymarch

规格与坐标约定在 `docs/ENGINE.md` §3.7；这里只给"照抄就能跑"的两段。
挑法**按画面要什么选，不是按哪个省事/哪个零依赖选**：能用线画出来的用 ①；几何本身是"无数份、或者要融合/掏空"的用 ②；
要**成百上千个同样的单元**（实例化）、要材质/光照/阴影、要真深度真遮挡，用 ③（§14.3，`three` 已在 `dependencies` 里）。
选错的那一种会直接限制画面（① 没有 z-test，遮挡得自己排序；② 每像素几十次 SDF，出片时间明显变长）。

### 14.1 投影线段批：一台 3D 相机 + `lines`（便宜）

```js
import { camera3, project3, clipSegment, depthScale } from '../../../src/core/cam.js';

setup(ctx) {
  // 世界线段的原样存着（世界单位），每帧投影一次
  this.segs = [[-2, -1.5, 6, -2, -1.5, -60, 'graphite', 0.5], /* …[x0,y0,z0,x1,y1,z1,颜色名,alpha] */];
},

render(ctx) {
  const { f, lines, gl, P, W, H } = ctx;
  gl.clear(ctx.out, P.ink);
  const cam = camera3({                       // 全片一台：只吃整片时间 f.t
    pos: [0.2 * Math.sin(f.t * 0.5), 0.1, -2 - f.t * 0.8],
    target: [0, 0, -3 - f.t * 0.8], fov: 50, roll: 0.02, H,
  });
  lines.begin();
  for (const s of this.segs) {
    const a = project3(cam, W, H, s[0], s[1], s[2]);
    const b = project3(cam, W, H, s[3], s[4], s[5]);
    if (!clipSegment(a, b, 0.15)) continue;                 // ① 近平面裁剪（不然镜头穿过物体会画翻面长线）
    if ((a.x < -200 && b.x < -200) || (a.x > W + 200 && b.x > W + 200)) continue;   // ② 视口外剔除
    const w = (a.w + b.w) * 0.5;
    const fog = Math.exp(-Math.max(0, w - 6) * 0.10);       // ③ 深度衰减 + 雾
    if (fog < 0.04) continue;
    lines.seg(a.x, a.y, b.x, b.y, Math.max(0.9, depthScale(cam, w, H) * 9), [P.bone[0] * fog, P.bone[1] * fog, P.bone[2] * fog]);
  }
  lines.flush(ctx.out);
  return { bloom: 0.3, grain: 0.03 };
}
```

完整例子：`tasks/pdoom-lab/scenes/{stack,columns}.js`；把"无限重复"交给 `%`（沿 z 摆 16 个门框就是这么做的）。

### 14.2 raymarch：几何是数学式子（贵，但能做到"没有几何"）

```js
import { Pass } from '../../../src/core/gl.js';
import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../../../src/core/glsl3d.js';
import { camera3 } from '../../../src/core/cam.js';

const SDF = `
  // 走廊：盒内腔 + 沿 z 每 4 个单位重复一道门框（这就是"无限长"的全部代价）
  vec3 repZ(vec3 p) { p.z = p.z - 4.0 * floor(p.z / 4.0 + 0.5); return p; }
  float sdFrame(vec3 p) { return max(sdBox3(p, vec3(1.75,1.15,0.10)), -sdBox3(p, vec3(1.55,0.95,0.14))); }
  float sdScene(vec3 p) { return min(-sdBox3(p - vec3(0.0,0.0,-22.0), vec3(2.2,1.6,30.0)), sdFrame(repZ(p))); }
  float sdSceneM(vec3 p, out float mat) { mat = 1.0; return sdScene(p); }
  #define MAP(p) sdScene(p)
  #define MAP_MAT(p, m) sdSceneM(p, m)
`;

setup(ctx) {
  const FRAG = `
    uniform vec3 camPos, camR, camU, camF; uniform float focal;
    ${GLSL3D_PRE}
    ${SDF}
    ${GLSL3D_KERNELS}
    void main() {
      vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
      float mat; float hit = march(ro, rd, mat, 96, 44.0);
      vec3 col = C_INK;
      if (hit > 0.0) {
        vec3 p = ro + rd * hit, n = marchNormal(p, 0.0018);
        col = shadeEngraved(p, n, rd, normalize(vec3(0.36,0.74,0.40)), C_EMBER, C_INK, C_BONE, 36.0, 1.1, calcAO(p, n));
      }
      fragColor = vec4(fog(col, hit < 0.0 ? 44.0 : hit, 6.0, 0.04), 1.0);
    }`;
  this.pass = new Pass(ctx.gl, FRAG, cam3Uniforms(camera3({ pos: [0,0,0], target: [0,0,-1], fov: 50, H: ctx.H })),
    { key: 'my_corridor', palette: ctx.P });     // ⚠ palette 一定要传，否则任务配色不生效
},

render(ctx) {
  const { f, gl, H } = ctx;
  const c2 = /* 你的机位函数 */ { pos: [0, 0, -2 - f.t * 0.8], target: [0, 0, -3 - f.t * 0.8], fov: 50, roll: 0.02 };
  this.pass.set(cam3Uniforms(camera3({ ...c2, H })))
    .render(gl, ctx.out, f.t, f.dt);
  return { bloom: 0.34, bloomThreshold: 0.92, grain: 0.03 };
}
```

完整例子：`tasks/pdoom-lab/scenes/corridor.js` + `_corridor.js`（世界抽成共享模块，收尾段引同一份）。

四个必踩的坑（都写在 `docs/ENGINE.md` §3.7.2，这里再点一遍）：

1. `MAP` / `MAP_MAT` 必须在 `${GLSL3D_KERNELS}` **之前**定义；
2. 相机 uniform 用 `cam3Uniforms(camera3(...))`，**别手写字段名**（写错不报错，而是整屏白）；
3. `palette: ctx.P` 要显式传给 `Pass`；
4. 排线挂**世界坐标**（`engrave3(p, n, …)`），挂屏幕坐标会变成电视雪花。

**出问题就看这两条**：整屏白 = 场景写出了 NaN/±Inf（`node tools/probe-raymarch.mjs`，
`check` 也会点名）；画面上下颠倒/左右镜像 = `FRAG_PX` 的 y 是向上的、`camera3` 是右手系
（`node tools/probe-raymarch.mjs --only ray` 一比就知道）。

### 14.3 第 3 种 3D：真网格（Three.js）

前两种都**没有深度缓冲**。要做"很多个同样的东西"（实例化）、要材质/光照/阴影、
以后要导入 `.glb`，用第三种：**Three.js 渲出来的画面当成引擎的一张图层**，
后面的后处理/推流/`verify` 与别的镜头完全一样（**不要**各渲各的 mp4 再 concat）。

```js
import { makeThreeShot } from '../../../src/kit/index.js';

export default makeThreeShot('lattice', {
  background: 'over',                    // 浮在引擎那层共享背景之上（配 world: 'auto'）
  bridge: { alpha: true },               // 'over' 必须开
  camera: { fov: 34, pos: [6, 4, 7], target: [0, 1, 0] },
  async setup(ctx, api) {
    const { THREE, scene, palette } = api;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: palette('graphite'), roughness: 0.6 }), 200);
    mesh.frustumCulled = false;          // 实例化网格的包围球不会自己跟上
    scene.add(mesh, new THREE.HemisphereLight(palette('bone', 0.4), palette('ink'), 1.5));
    this.mesh = mesh;
  },
  update(ctx, api) {                     // ⚠ 只许写 t 的纯函数
    this.mesh.rotation.y = ctx.f.t * 0.3;
  },
  overlay(ctx, api) {                    // 引擎的标签可以贴在 3D 上
    const p = api.project(0.9, 0.6, 0.9);
    if (p.visible) { /* lines / type 在 p.x, p.y 处画引线与文字 */ }
  },
});
```

四个必踩的坑（详见 `docs/THREE.md` §9）：

1. **颜色**：取色一律 `api.palette('signal')`（**线性**值），别用 `new THREE.Color('#ff4d12')`；
2. **透明**：画布给的 RGB 是**在 sRGB 编码空间里预乘过 alpha** 的 —— 自己上传会用错（桥已处理）；
3. **记账**：`'over'` 那一段要在时间线上写 `world: 'auto'`，否则 `check` 的背景守门会点名；
4. **确定性**：`update()` 里只写 `f.t` 的函数，**不是** `rotation.y += 0.01`（每个子帧都会重渲一次）。

完整例子：`tasks/_three-lab`（Three.js → **引擎自绘的过渡镜头** → Three.js，
三段共用一个世界原点与一台摄影机，所以接缝只剩"物体自己在变"）；量具 `node tools/probe-three.mjs`。

---

## 15. 常用模式速查

```js
// 时段开关（用 prog，别写 if 环）
prog(f.lt, 0.4, 1.6)                       // 0.4→1.6s 之间 0→1，可选第 4 参给缓动名
prog(f.lt, a, b, 'outExpo')

// 打点曲线（段内插值，段外取端值）
keys(f.lt, [[0, 0], [1.2, 1, 'outCubic'], [2.0, 0.6]])

// 一次性冲击 / 周期脉冲
hit(f.lt, 1.35, 0.10)                      // t0 打一下，之后指数衰减
pulse(f.lt, 4, 0.05)                       // 每 4 秒一次

// 弹簧（回弹 / 落位手感）：解析解，只吃「距起点多少秒」，别自己写 x += v*dt
spring(f.lt - t0)                          // 0→1，默认 stiffness 90 / damping 18
spring(f.lt - t0, 1, 140, 12)              // 更弹（stiffness 越大越快，damping 越小越荡）

// 平滑噪声（有机漂移 / 呼吸 / 不规则但不抖）
noise1(f.t * 0.7)                          // 一维
noise2(f.t * 0.5, 3.1)                     // 二维（第二维拿来当"另一个通道"）
fbm2(f.t * 0.4, 0.0, 4)                    // 分形叠加（octaves 默认 4）
// ⚠ 逐帧白噪声（hash2(f.idx, …)）只能用于"震屏"，做手持/漂移一定是振动 —— 见 §7 与 ENGINE §8

// 缓动（17 个，写错名字会 warn 一次并退化成 linear）
ease.outCubic / outExpo / inOutQuart / outBack / outElastic / outBounce ...
prog(f.lt, a, b, 'outBack')                // 第 4 参就是上面的名字

// 循环相位 / 往复
cycle(f.t, 3.0)                            // 0..1 循环
pingPong(f.t, 2.0)                         // 0→1→0

// 确定性随机（setup 里）
rng(seed)()                                // 每次调用一个 [0,1)
hash2(x, y)                                // 任意整数坐标 → [0,1)，逐帧抖动用它
f.idx / f.seed                             // 按帧抖动（一帧内所有子帧共享）

// 颜色
css(P.bone)                                // Canvas2D 用
css(P.signal, 0.8)                         // 带 alpha
[P.signal[0] * 1.8, P.signal[1] * 1.8, P.signal[2] * 1.8]   // 线性值 >1 = 发光
withAlpha(P.signal, 0.18)                  // lines 用：第 4 个分量 = 真半透明叠加
mul(P.bone, 1.6)                           // lines 用：乘系数（>1 才泛光）
P.dim('bone', 0.5)                         // 变暗保持色相

// 排版
type.measure(text, style)                  // 宽度（含 tracking）
type.layout(text, style)                   // { clusters, cum, x }
type.write(...) / type.karaoke(...) / type.wrap(...) / type.paragraph(...) / type.writeOnPath(...)
codeRow(type, [{ s: 'GET ', c: css(P.ash) }, { s: '/v1/items', c: css(P.signal) }], x, y)   // 代码行/协议名

// 图层
comp.draw(gl, text, ctx.out, { premult: false })             // 正常叠
comp.draw(gl, rt, ctx.out, { mode: 'add', opacity: 0.6, tint: P.signal })
comp.copyOver(gl, src, dst, 1)             // 拷贝
comp.mixTo(gl, a, b, k, dst)               // 两图混合（默认转场就是它）

// 几何
polylineLengths(pts) / pointAtLength(pts, acc, s)   // 沿路径
rot2(x, y, a) / dist2(x0, y0, x1, y1) / clamp / sat / lerp / remap
```

---

## 附：交付前自检

1. `node scripts/anim.mjs check <任务>`：无报错、无空档、每段平均亮度都不是全黑。
2. `still` 抽查**每一段**的中间帧，并且**真的把 PNG 打开看了**。
3. 有音乐：镜头切割点对齐在拍上（用 `{beat}` / `{bar}`，不是手抄秒数）。
4. 段与段没有黑隙；最后一段有淡出或明确收尾。
5. `video` 出片成功，检查时长/帧率/分辨率；运动模糊的 `子帧分布` 没有异常地全压在上限。
