// @ts-check
/**
 * `src/kit/bands.js` —— **版面分区**与字幕/标注元件。
 *
 * ## 为什么要有"带"
 *
 * 在这之前，画面文字的位置全靠各人自己写坐标常量：`tasks/optifine/scenes/_world.js` 与
 * `tasks/sodium/scenes/_world.js` 各抄了一份同样的栅格（左上段标签 128/92、左下说明条 y=964、
 * 出处 y=1004…），两份代码加起来 1500 行。更贵的是**字幕**：它当时根本不在引擎里 ——
 * 是出锅之后用 ffmpeg 烧上去的，位置（顶部居中）是人工判断的（"底部已经有说明条+出处行"）。
 * 于是画面代码**不知道字幕在哪**，也就无从避让，观众看到的是同一句话上下各一遍。
 *
 * 现在：每个部件有自己的一条带，**字幕带是引擎保留区**（`style.grid.captionBand`）。
 * 场景想确认自己的东西没压到字幕上，用 `assertInBand()`。
 *
 * ## 六条带（1920×1080 基准，随 `ctx.grid` 缩放）
 *
 * ```
 *  y=40  ┌ ▓▓▓ sub  字幕保留带（引擎画语音字幕，居中；别的文字不许进）▓▓▓ ┐
 *  y=104 └───────────────────────────────────────────────────────────────┘
 *  y=92   ┌ tag 段标签（左上，x≥128）        hudR 计量/读数（右上，x≥1190）┐
 *         │                                                               │
 * y≈900  │                  正文 / 面板（自由）                            │
 * y=930  ├─ captionLine 说明条的横线                                        │
 * y=964  │ caption 短标注（左下，**只放短语，不放句子**）+ y=1004 出处小字    │
 * y=976  ├─ footerLine 页脚线                                               │
 * y=1018 │ foot 页脚（左右小字）                                            │
 *         └───────────────────────────────────────────────────────────────┘
 * ```
 *
 * ⚠ 字幕带为什么在**顶部**：底部已经被占满了 —— 镜头模板的 `readout` / 签名 / `footer`
 * 都在 y≈990，kit 的 `footer()` 在 H-62，`captionNote()` 在 964/1004。
 * 往底部再塞一条字幕，就是观众反馈里那句"两条字幕同时出现，看着好迷糊"的另一种版本。
 * 完整理由见 `src/style/index.js` 的 `GRID_BASE.captionBand`。
 *
 * ⚠ 判断冲突时**两个方向都要比**：字幕带横跨画面中部，而段标签在左上角 ——
 * y 有重叠、x 没有，那不是冲突（`assertInBand()` 第一版只看 y，误报过）。
 */

import { GRID_BASE } from '../style/index.js';
import { css } from '../core/util.js';
import { sat01 } from './layout.js';

/**
 * 算出这一帧的版面分区。
 * @param {number} W @param {number} H 逻辑分辨率
 * @param {any} [grid] `ctx.grid`（风格栅格，已按分辨率缩放）；不传就用默认栅格
 */
export function bands(W = 1920, H = 1080, grid = null) {
  const g = grid ?? GRID_BASE;
  return {
    /** 标题带（片名，通常只在开场几秒） */
    title: { x0: g.pad, x1: W - g.pad, y: g.top - 36, size: 58 },
    /** 段标签带（左上角，"优化 2/4"这种） */
    tag: { x0: g.pad + 8, x1: W - g.pad, y: g.top, size: 30 },
    /** 右上 HUD 带（计量条、读数） */
    hudR: { x0: Math.round(W * 0.62), x1: W - g.pad, y: g.top + 24, size: 19 },
    /** 说明条带（左下）：横线 + 一行短标注 + 出处小字 */
    caption: { x0: g.pad + 8, x1: W - g.pad, line: g.captionLineY, y: g.captionY, src: g.captionY + 40, size: 44 },
    /** 页脚带（左右两行小字 + 一条细线） */
    foot: { x0: g.pad, x1: W - g.pad, line: g.footerLineY, y: g.footerY, size: 22 },
    /** **字幕保留带**（引擎的字幕层占这里；不要往里放别的东西） */
    sub: (() => {
      // x 范围取"字幕实际会占的那一块"（每行最多 16 个中文字 ≈ 704px、居中），
      // 而不是整幅宽度 —— 否则左上段标签、右上读数会被误判成冲突。
      const halfW = Math.round(W * 0.19);
      return {
        x0: Math.round(W / 2 - halfW), x1: Math.round(W / 2 + halfW),
        y0: g.captionBand[0], y1: g.captionBand[1],
      };
    })(),
  };
}

/** `bands()` 的便捷版：直接从场景 ctx 取分辨率与风格栅格。 */
export function bandsOf(ctx) {
  return bands(ctx.W ?? 1920, ctx.H ?? 1080, ctx.grid ?? ctx.style?.grid ?? null);
}

/**
 * 把某个元件的坐标跟字幕保留带对一下，压上了就**警告**（不是抛错：运行时抛会把整段画面
 * 变成错帧卡片，代价太大；而这类问题一眼就能改）。
 *
 * 用一次报一次（按 `name` 去重），避免每帧刷屏 —— 与 `util.js` 的 `prog()` 警告同一个套路。
 *
 * @param {string} name 元件名（报错里点名用）
 * @param {number} x 该元件的**左边** x（居中的文字传中心 x 也行，判断会宽松一点）
 * @param {number} y 该元件的**基线** y
 * @param {any} ctx 场景 ctx（要能取到 W/H/grid）
 * @param {number} [size] 字号（用来估算文字顶部；不传就按基线 ±0 算）
 * @param {number} [width] 文字宽度（不传就按 `x` 当左边界、宽 0 —— 判断更保守）
 */
const warnedBands = new Set();
export function assertInBand(name, x, y, ctx, size = 0, width = 0) {
  const b = bandsOf(ctx).sub;
  const top = y - size * 0.9;
  const bot = y + size * 0.25;
  const vertical = top < b.y1 && bot > b.y0;
  // ⚠ 必须**两个方向都比**：字幕带在顶部居中，而段标签在左上（y 相同、x 不同）——
  //   只看 y 会把完全没问题的段标签报成冲突（第一版就是这么误报的）。
  const horizontal = x < b.x1 && x + width > b.x0;
  if (vertical && horizontal) {
    const key = `${name}@${Math.round(y)}`;
    if (!warnedBands.has(key)) {
      warnedBands.add(key);
      const msg = `"${name}"（x=${Math.round(x)}, y=${Math.round(y)}, 字号 ${size}）压进了**字幕保留带** `
        + `[y ${b.y0}–${b.y1}, x ${b.x0}–${b.x1}] —— 语音字幕画在那里，两块字会叠。`
        + `改法：挪出这一带，或改用 kit 的 captionNote()（它自动落在带外）。`;
      // 走 ctx.warnings（每帧都发生也不刷屏，check 会打印）；同时也留一条 console.warn 给预览
      if (ctx?.warnings) {
        if (!ctx.warnings.includes(msg)) ctx.warnings.push(msg);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[anim] ${msg}`);
      }
    }
    return false;
  }
  return true;
}

/**
 * **说明条**：一条短标注 + 出处小字（左下角，落在字幕带**之外**）。
 *
 * ⚠ 这是本引擎里最容易被误用成"第二条字幕"的元件，所以这里做了两件事：
 *   ① 文案超过 `maxChars`（默认 18 个中文字）就**警告** —— 那是句子，句子该交给旁白与字幕
 *      （Netflix 的 timed-text 规范把"与画面文字相同、或已被对白覆盖"的冗余文本列为必须删除；
 *      观众对 sodium 的反馈"两条字幕同时出现看着好迷糊"就是这么来的）；
 *   ② 位置从版面带走，不再手抄 `128, 964` 这种魔数。
 *
 * ```js
 * captionNote(ctx, { text: '区块重建 · 16³', src: 'optifine.net/faq' });
 * ```
 *
 * @param {any} ctx 场景 ctx
 * @param {{ text: string, src?: string, color?: string, alpha?: number, maxChars?: number,
 *           size?: number, x?: number, y?: number, t?: number }} o
 */
export function captionNote(ctx, o = {}) {
  const { lines, type, P } = ctx;
  const b = bandsOf(ctx).caption;
  const t = o.t ?? ctx.f?.lt ?? 0;
  const alpha = sat01(o.alpha ?? 1);
  const text = String(o.text ?? '');
  const maxChars = o.maxChars ?? 18;
  const units = [...text].reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0);
  if (units > maxChars && !warnedBands.has(`note:${text}`)) {
    warnedBands.add(`note:${text}`);
    const msg = `captionNote 收到的是**句子**（${units.toFixed(0)} 字 > ${maxChars}）：「${text}」`
      + ' —— 画面文字只放标注（名词/数字/单位），句子交给旁白与字幕；'
      + '同屏两套完整句子正是观众反馈里"看着好迷糊"的直接原因（docs/CAPTIONS.md）。';
    if (ctx?.warnings) {
      if (!ctx.warnings.includes(msg)) ctx.warnings.push(msg);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[anim] ${msg}`);
    }
  }
  const x = o.x ?? b.x0;
  const y = o.y ?? b.y;
  const size = o.size ?? b.size;
  const col = css(P[o.color ?? 'bone'] ?? P.bone);
  if (alpha > 0.01) {
    lines.seg(x, b.line, x + 420, b.line, 2, [P.signal[0], P.signal[1], P.signal[2], 0.5 * alpha]);
    type.writeLine(text, x, y, { size, weight: 700, family: 'sans', color: col, anchor: 'left', alpha });
    if (o.src) {
      type.writeLine(o.src, x, b.src, {
        size: 21, family: 'mono', color: css(P.ash, 0.85 * alpha), anchor: 'left', alpha,
      });
    }
  }
  void t;
  return y;
}

/**
 * 场景内自己画语音字幕（**大多数片子不需要它** —— 引擎的字幕层 `task.captions: true`
 * 已经每帧自动画了，见 `docs/CAPTIONS.md`）。
 *
 * 什么时候才用它：想让字幕只在**某一段内**出现（例如片头没有字幕）、或者想在字幕上
 * 做本片特有的花样。位置从字幕保留带来，所以它**永远压不到别的文字**。
 *
 * @param {any} ctx 场景 ctx
 * @param {{ t?: number, hold?: number, size?: number, karaoke?: boolean, family?: string }} [o]
 * @returns {any|null} 画出来的那句（没画就是 null）
 */
export function subLine(ctx, o = {}) {
  const { type, P, narration } = ctx;
  if (!narration || !narration.at) return null;
  const t = o.t ?? ctx.f?.t ?? 0;
  const hold = o.hold ?? 1.06;
  const l = narration.at(t) ?? narration.recent(t, hold);
  if (!l) return null;
  const b = bandsOf(ctx).sub;
  const size = o.size ?? 44;
  const st = { size, weight: 600, family: o.family ?? 'sans' };
  const rows = type.wrap(l.text, st, size * 16).slice(0, 2);
  const lh = size * 1.3;
  rows.forEach((r, i) => {
    const y = b.y1 - (rows.length - 1 - i) * lh;
    if (o.karaoke && l.words && rows.length === 1) {
      type.karaoke(l.text, l.words, b.x0, y, t, {
        ...st, base: css(P.ash), sung: css(P.signal), dim: 0.42,
      });
    } else {
      type.writeLine(r, (b.x0 + b.x1) / 2, y, { ...st, anchor: 'center', color: css(P.bone) });
    }
  });
  return l;
}
