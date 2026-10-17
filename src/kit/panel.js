// @ts-check
/**
 * `src/kit/panel.js` —— **2D 面板层**：讲一张表 / 一条管线 / 一组格子时用的屏幕空间元件。
 *
 * ## 为什么它和"方块世界"无关
 *
 * 这一层是从 `tasks/optifine/scenes/_world.js`（第 633–865 行那段）抽出来的，但它**一点
 * Minecraft 的东西都没有**：面板、格子、标签、箭头、缓冲块、计量条，任何科普片都用得上。
 * 原型里它是和「3D 方块世界」写在同一个文件里的，于是 `tasks/sodium` 那支片子想要类似
 * 的面板时只能再抄一遍（或者说：抄不了，因为那份文件里全是方块）。
 *
 * 判断"某样东西该不该进 3D"的规矩（原型里踩出来的）：
 * **纹理、模型、渲染管线这类本来就是平面的东西不要硬塞进 3D** —— 透视一压上去格子就不
 * 等宽、字就歪，观众要花力气去"读"而不是"看懂"。平面的东西用这一层画，只在需要表示
 * "它属于那个世界"时才从世界里引一条细线过来（`arrowH` 就是干这个的）。
 *
 * ## 视觉规律：**alpha 管在不在，tone 管亮不亮**（`docs/history/IMPROVEMENTS-4-5.md` §4.3）
 *
 * `LineBatch` 画的是胶囊，**没有深度测试**。面板的"填充"是 `fillRect` 一排横线拼出来的，
 * 只要 `alpha < 1`，排线之间那道发丝缝就会把**后面的东西**透出来（世界里的亮边会从面板上
 * 穿过去，整块面板读起来像贴在玻璃上）。所以本条规矩对所有元件都成立：
 *
 * ```js
 * panel(ctx, { …, fillK: 0.94 });                  // ✓ 底板要够不透明
 * panel(ctx, { …, fillK: 0.4, tone: 0.5 });        // ✓ "压暗"降 tone（颜色），不降 fillK
 * panel(ctx, { …, fillK: 0.2 });                   // ✗ 后面的世界会从面板里透出来
 * ```
 *
 * 注意这一层是**屏幕空间**：它的"压暗"不影响 3D 里那套排线缝的问题
 * （那个在 `src/kit/blocks.js` 的 `hatchQuad({ solid: true, solidK: 0.99 })` 里）。
 *
 * ## 顺序（AGENTS.md §5 —— 写错的症状是"东西不见了"且不报错）
 *
 * ```js
 * lines.begin();  // 3D：seg3 / box3 / section …（要深度排序的那批）
 * lines.flush(ctx.out);
 * text.clear();                              // ⚠ 每帧都要清，否则上一帧的字叠上来
 * lines.begin();  // 2D：panel / tile / chips / arrowH / bufBox / meter / HUD
 * lines.flush(ctx.out);                      // ⚠ 这一句之后再往批里塞线是画不出来的
 * text.upload();  comp.draw(gl, text, ctx.out, { premult: false });
 * ```
 *
 * 文字一律走 `type.writeLine`（`type.write` 的 `align` 是**逐字**生效的，做不了整行居中）；
 * 颜色一律 `css(P.xxx, a)` —— **不是** `css(colorObjectWithAlpha)`（`css()` 只读前三个分量，
 * 第 4 个会被静默丢掉，`docs/history/IMPROVEMENTS-4-5.md` §2）。
 */

import { clamp, sat, lerp, smoothstep, css as cssOf, hash1 } from '../core/util.js';

/* ═══════════════════════════════════════════════ 纯函数内核（不碰 GPU，可以离线测） */

/**
 * 取调色板里的颜色，**保证返回三元组** `[r,g,b]`（线性值，可以 > 1 用来发光）。
 *
 * 为什么专门写一个 `col`：任务侧的惯用写法是「`col(P, name, a)` 返回四元组，直接喂给
 * `lines`」，但那个四元组一旦递给 `css()`，第 4 个分量就被静默丢掉了
 * （`docs/history/IMPROVEMENTS-4-5.md` §2，本轮 13 处文字淡入全部失效就是这个）。这里的取法是
 * **反过来**的：`col()` 只出三元组，alpha 一律由调用方显式给（`withAlpha(col, a)` 或
 * `css(P.xxx, a)`），于是"丢 alpha"这件事在类型上就发生不了。
 *
 * @param {Record<string, number[]>} P 调色板
 * @param {string} name 颜色名（不存在时回退 `bone`）
 * @param {number} [a] 给了就补上第 4 个分量（给 `lines` 用）
 * @returns {number[]} `[r,g,b]` 或 `[r,g,b,a]`
 */
export function col(P, name, a) {
  const c = P[name] ?? P.bone ?? [1, 1, 1];
  return a == null ? [c[0], c[1], c[2]] : [c[0], c[1], c[2], a];
}

/**
 * 颜色的**明暗**缩放（"压暗"用这个，不要用 alpha）。
 * 和 `src/kit/layout.js` 的 `mul` 是同一件事，这里再给一次是为了让面板元件自洽
 * （`tone` 参数到处都要用）。
 * @param {number[]} c @param {number} k
 * @returns {number[]} 缩放后的颜色（保留原 alpha 分量，如果有）
 */
export function toneColor(c, k) {
  return c.length >= 4 ? [c[0] * k, c[1] * k, c[2] * k, c[3]] : [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * 从 `ink` 往上提到 `base` 的 `k` 比例 —— 面板元件统一用它调明暗。
 *
 * `k = 0` ⇒ 背景色（等于没画）、`k = 1` ⇒ 原色、`k > 1` ⇒ 比原色更亮（会泛光）。
 * 为什么要经过 `ink` 而不是直接乘：直接乘会把颜色往**黑**推，在深色底上等于往背景里陷；
 * 而"往 ink 收"保证无论调色板换成什么底色，压暗的方向都是"退回背景"。
 *
 * @param {number[]} ink 背景色（线性）
 * @param {number[]} base 目标色（线性）
 * @param {number} k
 * @returns {number[]} `[r,g,b]`
 */
export function mixToInk(ink, base, k) {
  return [
    ink[0] + (base[0] - ink[0]) * k,
    ink[1] + (base[1] - ink[1]) * k,
    ink[2] + (base[2] - ink[2]) * k,
  ];
}

/**
 * **"暗"由颜色承担，不由 alpha 承担**（§4.3 那一条的唯一入口）。
 *
 * 语义与 `blocks.js` 里 section 的 `tone` 完全一致，这样 2D 和 3D 的明暗语言是一套：
 *   · `a >= 1`  ⇒ 1（正常亮度）
 *   · `a ≈ 0.5` ⇒ `floor + (1 - floor) * 0.5`（压暗，但**依然完全不透明**）
 *   · `a → 0`   ⇒ `floor`（最暗的一档，仍然看得见轮廓）
 *
 * @param {number} a 0..1 的"存在度"（淡化/退场的那个量）
 * @param {number} [floor] 最暗的权重（默认 0.15）
 * @returns {number} 喂给 `mixToInk` 的 `k`
 */
export function shadeOf(a, floor = 0.15) {
  return Math.max(floor, Math.min(1, a));
}

/**
 * 一排标签的排版（**纯计算，不画**）—— 于是"排到哪了 / 多宽"这类事可以离线断言。
 *
 * `o.w` 可以**强制等宽**：一列一列对齐时用它，不然长短不一的标签会参差不齐
 * （原型里的经验，`ctm` 那一段的"连 / 不连"就是这样对齐的）。
 *
 * @param {Array<{ label?: string, w?: number, gap?: number }>} items
 * @param {{ x?: number, gap?: number, w?: number, measure?: (label: string) => number }} [o]
 * @returns {Array<{ x: number, w: number, label: string, index: number }>} 每格的左边界与宽度
 */
export function chipLayout(items, o = {}) {
  const list = items ?? [];
  const measure = o.measure ?? (() => 0);
  const gap = o.gap ?? 10;
  let cx = o.x ?? 0;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    const w = o.w ?? it.w ?? Math.max(0, measure(it.label ?? ''));
    out.push({ x: cx, w, label: it.label ?? '', index: i });
    cx += w + (it.gap ?? gap);
  }
  return out;
}

/* ═══════════════════════════════════════════════ 元件 */

/**
 * 一块 2D 面板的底板：细边 + 底 + 四角标记（+ 可选的标题 / 副标题）。
 *
 * ⚠ 它叫 `panelBox` 而不是 `panel`，因为 `src/kit/elements.js` 里已经有一个
 * `panel(lines, x, y, w, h, col, …)`（底层图元）。两个都存在，**别混**：
 * 这一个只吃 `ctx`，画的是"一整块面板"。经 `src/kit/index.js` 出去的就是这个名字。
 *
 * `fillK` **默认 0.94 —— 要够不透明**。原型第一版用 0.74，结果世界里的亮边从面板上穿过去，
 * 整块面板读起来像贴在玻璃上（出图实测）。想让面板"退到后面去"请降 `tone`，别降 `fillK`。
 * `tone` 会同时压暗底色与边框（"暗"由颜色承担）。
 *
 * @param {any} ctx SceneCtx
 * @param {{ x: number, y: number, w: number, h: number, alpha?: number, fill?: boolean,
 *   fillK?: number, tone?: number, edge?: boolean, edgeColor?: string, accent?: string,
 *   corner?: number, title?: string, titleSize?: number, titleColor?: string, sub?: string }} o
 * @returns {{ x: number, y: number, w: number, h: number }} 传进去的矩形（便于链式排版）
 */
export function panelBox(ctx, o) {
  const { lines, P, type } = ctx;
  const { x, y, w, h } = o;
  const a = o.alpha ?? 1;
  if (a <= 0.01) return { x, y, w, h };
  const tone = shadeOf(a) * (o.tone ?? 1);
  const accent = col(P, o.accent ?? 'signal');
  if (o.fill !== false) {
    // 底色往 ink 收（不是往黑收）—— 调色板换成浅色底时也仍然"退得下去"
    const fill = mixToInk(P.ink ?? [0, 0, 0], P.ink2 ?? P.ink ?? [0, 0, 0], tone);
    lines.fillRect(x, y, w, h, [fill[0], fill[1], fill[2], o.fillK ?? 0.94], 2);
  }
  if (o.edge !== false) {
    lines.rect(x, y, w, h, 1.4, col(P, o.edgeColor ?? 'graphite', (0.42 + 0.48 * tone) * (o.fill === false ? a : 1)));
  }
  // 四角标记：让面板读起来是"一块界面"，而不是画面上一块颜色
  const L = o.corner ?? 18;
  const cc = [accent[0], accent[1], accent[2], 0.85 * a * (0.35 + 0.65 * tone)];
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
    lines.seg(cx, cy, cx + sx * L, cy, 2, cc);
    lines.seg(cx, cy, cx, cy + sy * L, 2, cc);
  }
  if (o.title && type) {
    type.writeLine(o.title, x + 18, y + 16, {
      anchor: 'left', size: o.titleSize ?? 30, weight: 800, family: 'sans',
      color: cssOf(col(P, o.titleColor ?? 'bone'), a),
    });
  }
  if (o.sub && type) {
    type.writeLine(o.sub, x + 18, y + (o.title ? 54 : 16), {
      anchor: 'left', size: 20, family: 'mono', color: cssOf(col(P, 'ash'), 0.85 * a),
    });
  }
  return { x, y, w, h };
}

/**
 * 一格"方块贴图"的示意 —— **不是像素画，是示意图**（一格一格讲表的时候用）。
 *
 * `state`：
 *   `'plain'` 平铺底纹 / `'solid'` 实心 / `'hi'` 高分辨率（细密底纹）/
 *   `'edge'` 只留边 / `'ghost'` 虚位 / `'void'` 什么都不画（占位用）。
 *
 * `link` = `[上, 右, 下, 左]`，为真的一侧画一条**接边**（"这一格和邻居连上了"的符号）。
 * 内部底纹**永远是单向的** —— 双向排线（井字）一拉远就脱离方块、变成一片悬浮的符号，
 * 原型里被用户点名过一次（「不知道什么神秘的井字形物体」）。
 *
 * @param {any} ctx SceneCtx
 * @param {{ x: number, y: number, s: number, state?: string, color?: string, alpha?: number,
 *   gap?: number, lw?: number, lineAlpha?: number, accent?: string, link?: boolean[],
 *   linkW?: number, tone?: number }} o
 * @returns {{ x: number, y: number, w: number, h: number }} 实际画出来的内框
 */
export function tile(ctx, o) {
  const { lines, P } = ctx;
  const { x, y, s } = o;
  const a = o.alpha ?? 1;
  if (a <= 0.01 || o.state === 'void') return { x, y, w: 0, h: 0 };
  const tone = shadeOf(a) * (o.tone ?? 1);
  const base = mixToInk(P.ink ?? [0, 0, 0], col(P, o.color ?? 'ash'), tone);
  const st = o.state ?? 'plain';
  const g = o.gap ?? 1.5;
  const x0 = x + g, y0 = y + g, sz = s - g * 2;
  const out = { x: x0, y: y0, w: sz, h: sz };
  if (st === 'ghost') {
    lines.rect(x0, y0, sz, sz, 1.2, [base[0], base[1], base[2], 0.16 * a]);
    return out;
  }
  if (st === 'solid' || st === 'hi') {
    lines.fillRect(x0, y0, sz, sz, [base[0], base[1], base[2], (st === 'hi' ? 0.74 : 0.6) * a], st === 'hi' ? 1 : 2);
  } else if (st !== 'edge') {
    lines.fillRect(x0, y0, sz, sz, [base[0], base[1], base[2], 0.14 * a], 2);
  }
  lines.rect(x0, y0, sz, sz, o.lw ?? 1.5, [base[0], base[1], base[2], (o.lineAlpha ?? 0.8) * a]);
  // 内部底纹：**单向**（见上面的警告）
  if (st === 'plain' || st === 'hi') {
    const n = st === 'hi' ? 7 : 4;
    for (let i = 1; i < n; i++) {
      const yy = y0 + (sz * i) / n;
      lines.seg(x0 + 2, yy, x0 + sz - 2, yy, 1, [base[0], base[1], base[2], 0.14 * a]);
    }
  }
  // 接边
  if (o.link) {
    const acc = col(P, o.accent ?? 'signal');
    const cc = [acc[0], acc[1], acc[2], 0.95 * a];
    const w = o.linkW ?? 5;
    if (o.link[0]) lines.fillRect(x0 + 2, y0 - w / 2, sz - 4, w, cc, 1);
    if (o.link[2]) lines.fillRect(x0 + 2, y0 + sz - w / 2, sz - 4, w, cc, 1);
    if (o.link[3]) lines.fillRect(x0 - w / 2, y0 + 2, w, sz - 4, cc, 1);
    if (o.link[1]) lines.fillRect(x0 + sz - w / 2, y0 + 2, w, sz - 4, cc, 1);
  }
  return out;
}

/**
 * 一排等大的格子（`tile` 的批处理版；讲"一张贴图切成 4×4 块""一排槽位"时省事）。
 *
 * @param {any} ctx SceneCtx
 * @param {{ x: number, y: number, s: number, gap?: number, states?: string[], count?: number,
 *   color?: string, alpha?: number, tone?: number, linkAt?: (i: number) => boolean[] | undefined,
 *   accent?: string }} o
 * @returns {number} 这一排总共占的宽度
 */
export function tileRow(ctx, o) {
  const n = o.count ?? (o.states?.length ?? 0);
  const step = o.s + (o.gap ?? 6);
  for (let i = 0; i < n; i++) {
    tile(ctx, {
      x: o.x + i * step, y: o.y, s: o.s,
      state: o.states?.[i] ?? 'plain',
      color: o.color, alpha: o.alpha, tone: o.tone, accent: o.accent,
      link: o.linkAt?.(i),
    });
  }
  return n > 0 ? n * step - (o.gap ?? 6) : 0;
}

/**
 * 一排小标签（"连 / 不连""开 / 关"这类）。返回排完之后的宽度。
 *
 * `o.w` 可以**强制等宽**（一列一列对齐时用它；不然长短不一的标签会参差不齐）。
 * `item.on === false` 用弱色画（"不连"）；`item.bare === true` 只写字不画底框。
 *
 * @param {any} ctx SceneCtx
 * @param {{ x: number, y: number, items: Array<{ label?: string, color?: string, on?: boolean,
 *   bare?: boolean, solid?: boolean, weight?: number, family?: string, w?: number, gap?: number }>,
 *   alpha?: number, size?: number, pad?: number, gap?: number, w?: number, h?: number,
 *   tone?: number }} o
 * @returns {number} 这一排的总宽度
 */
export function chips(ctx, o) {
  const { type, lines, P } = ctx;
  const { x, y, items } = o;
  const a = o.alpha ?? 1;
  const size = o.size ?? 22;
  const pad = o.pad ?? 26;
  const h = o.h ?? 36;
  const layout = chipLayout(items, {
    x, gap: o.gap, w: o.w,
    measure: (label) => (type ? type.measure(label, { size, weight: 700, family: 'mono' }) + pad : pad),
  });
  for (let i = 0; i < layout.length; i++) {
    const it = items[i];
    const { x: cx, w } = layout[i];
    const c = col(P, it.color ?? 'ash');
    if (it.on !== false && !it.bare) {
      lines.fillRect(cx, y, w, h, [c[0], c[1], c[2], (it.solid ? 0.5 : 0.14) * a], 2);
      lines.rect(cx, y, w, h, 1.4, [c[0], c[1], c[2], 0.85 * a]);
    }
    if (type) {
      type.writeLine(it.label ?? '', cx + w / 2, y + 9, {
        anchor: 'center', size, weight: it.weight ?? 700, family: it.family ?? 'mono',
        color: cssOf(col(P, it.on === false ? 'graphite' : (it.color ?? 'ash')), a),
      });
    }
  }
  return layout.length ? layout[layout.length - 1].x + layout[layout.length - 1].w - x : 0;
}

/**
 * 一条带箭头的连线（管线图用；也可以用细线从 3D 世界里引到 2D 面板上）。
 * @param {any} ctx SceneCtx
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {number[]} color 线性 `[r,g,b]`
 * @param {{ alpha?: number, lineAlpha?: number, w?: number, head?: number }} [opts]
 */
export function arrowH(ctx, x0, y0, x1, y1, color, opts = {}) {
  const { lines } = ctx;
  const a = opts.alpha ?? 1;
  if (a <= 0.01) return;
  const c = [color[0], color[1], color[2], (opts.lineAlpha ?? 0.75) * a];
  const w = opts.w ?? 2;
  lines.seg(x0, y0, x1, y1, w, c);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const hl = opts.head ?? 14;
  for (const s of [-1, 1]) {
    lines.seg(x1, y1, x1 - Math.cos(ang - s * 0.42) * hl, y1 - Math.sin(ang - s * 0.42) * hl, w, c);
  }
}

/**
 * 一个"缓冲 / 数据块"的方块（管线图、显存块、队列都长这样）：底 + 边 + 居中的标签。
 * @param {any} ctx SceneCtx
 * @param {{ x: number, y: number, w: number, h: number, color?: string, alpha?: number,
 *   fill?: number, lw?: number, label?: string, sub?: string, size?: number, tone?: number }} o
 */
export function bufBox(ctx, o) {
  const { lines, P, type } = ctx;
  const { x, y, w, h } = o;
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const tone = shadeOf(a) * (o.tone ?? 1);
  const c = mixToInk(P.ink ?? [0, 0, 0], col(P, o.color ?? 'ash'), tone);
  lines.fillRect(x, y, w, h, [c[0], c[1], c[2], (o.fill ?? 0.2) * a], 2);
  lines.rect(x, y, w, h, o.lw ?? 2, [c[0], c[1], c[2], 0.9 * a]);
  if (!type) return;
  if (o.label) {
    type.writeLine(o.label, x + w / 2, y + h / 2 - (o.sub ? 15 : 11), {
      anchor: 'center', size: o.size ?? 24, weight: 800, family: 'mono',
      color: cssOf(col(P, o.color ?? 'ash'), a),
    });
  }
  if (o.sub) {
    type.writeLine(o.sub, x + w / 2, y + h / 2 + 13, {
      anchor: 'center', size: 18, family: 'mono', color: cssOf(col(P, 'ash'), 0.85 * a),
    });
  }
}

/**
 * 屏幕空间的一块**排线填充**（2D 版的"半实心面"）。
 *
 * ⚠ **它挡不住后面的东西** —— 屏幕空间没有排序可言，排线之间的缝一定会透。
 *   要"挡住后面的世界"请用 `src/kit/blocks.js` 的 `hatchQuad(..., { solid: true, solidK: 0.99 })`
 *   （那一个进 3D 深度队列）。这里的用途是**在已经铺好的面板底上**再铺一层纹理示意。
 *
 * @param {any} ctx SceneCtx
 * @param {{ x: number, y: number, w: number, h: number, n?: number, axis?: 'h'|'v'|'both',
 *   color?: number[], alpha?: number, w_px?: number }} o
 *   `n` 是排线条数；`axis: 'h'` 横线（默认）/ `'v'` 竖线 / `'both'` 网格
 */
export function hatchBox(ctx, o) {
  const { lines } = ctx;
  const a = o.alpha ?? 1;
  if (a <= 0.01) return;
  const n = o.n ?? 6;
  if (!(n >= 2)) return;
  const base = o.color ?? [1, 1, 1];
  const c = [base[0], base[1], base[2], (base[3] ?? 1) * a];
  const w = o.w_px ?? 1;
  const axis = o.axis ?? 'h';
  const drawH = axis !== 'v';          // 'h' / 'both'
  const drawV = axis !== 'h';          // 'v' / 'both'
  for (let i = 1; i < n; i++) {
    const k = i / n;
    if (drawH) lines.seg(o.x, o.y + o.h * k, o.x + o.w, o.y + o.h * k, w, c);
    if (drawV) lines.seg(o.x + o.w * k, o.y, o.x + o.w * k, o.y + o.h, w, c);
  }
}

/**
 * 屏幕空间的一条计量条（进度 / 占用 / 容量）。
 * @param {any} ctx SceneCtx
 * @param {{ x: number, y: number, w: number, h?: number, frac: number, color?: string,
 *   label?: string, value?: string, alpha?: number }} o
 */
export function meter(ctx, o) {
  const { lines, type, P } = ctx;
  const { x, y, w, h = 12 } = o;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.01) return;
  const f = clamp(o.frac, 0, 1);
  lines.fillRect(x, y, w, h, col(P, 'graphite', 0.5 * alpha), 2);
  lines.fillRect(x, y, Math.max(2, w * f), h, col(P, o.color ?? 'signal', 0.85 * alpha), 2);
  if (!type) return;
  if (o.label) {
    type.writeLine(o.label, x, y - 12, {
      anchor: 'left', size: 19, weight: 600, family: 'mono', color: cssOf(col(P, 'ash'), 0.9 * alpha),
    });
  }
  if (o.value) {
    type.writeLine(o.value, x + w, y - 12, {
      anchor: 'right', size: 19, weight: 700, family: 'mono', color: cssOf(col(P, o.color ?? 'signal'), alpha),
    });
  }
}

/**
 * 屏幕空间的标签（面板旁边、格子下面用）。
 * `t` 是**段内时间**，用来做入场淡入（`sat(t / in)`）—— 交叠期里别出字，否则两屏字叠糊。
 * @param {any} ctx SceneCtx
 * @param {number} x @param {number} y @param {string} str @param {number} t
 * @param {{ alpha?: number, in?: number, anchor?: 'left'|'center'|'right', size?: number,
 *   weight?: number, family?: string, color?: string }} [opts]
 */
export function tag2(ctx, x, y, str, t, opts = {}) {
  const { type, P } = ctx;
  if (!type) return;
  const a = (opts.alpha ?? 1) * sat(t / (opts.in ?? 0.35));
  if (a <= 0.01) return;
  type.writeLine(str, x, y, {
    anchor: opts.anchor ?? 'left', size: opts.size ?? 22, weight: opts.weight ?? 700,
    family: opts.family ?? 'mono', color: cssOf(col(P, opts.color ?? 'ash'), a),
  });
}

/* ═══════════════════════════════════════════════ 排版小工具（确定性，别用 Math.random） */

/** 一个确定性的抖动（`hash1` 播种，避免 `Math.random` —— 一帧会被拆成多个子帧乱序渲染）。 */
export function jitter(i, k = 0, amp = 1) {
  return (hash1(i * 131.7 + k * 17.3) - 0.5) * 2 * amp;
}

/** 这一帧要不要画某样东西（按时间的窗口函数，两端各用 `fade` 秒平滑进出）。 */
export function win(t, a, b, fade = 0.4) {
  return sat((t - a) / fade) * sat((b - t) / fade);
}

/** 阶梯式出现：第 n 个元素在 `t0 + n*step` 之后用 `dur` 秒淡入（0..1）。 */
export function step(t, t0, n, stepS = 0.18, dur = 0.45) {
  return sat((t - t0 - n * stepS) / dur);
}

/** 换气用的转发：`clamp / sat / lerp / smoothstep / css` 一次性拿到（面板元件到处要用）。 */
export { clamp, sat, lerp, smoothstep };
export { cssOf as css };
