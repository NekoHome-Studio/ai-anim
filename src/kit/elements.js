// @ts-check
/**
 * 画在 `lines`（LineBatch）上的版面元件：面板、眉标、页脚、准星、标记方块。
 *
 * 这些在两个历史任务的 `_kit.js` 里各写过一遍（`panel`/`cardFrame`、`kicker`、`footer`、
 * `reticle`、`marker`），现在收进引擎。颜色一律是**线性值**，可以 >1 发光；
 * 半透明走第 4 个分量 `withAlpha`。
 */

import { css as cssOf } from '../core/util.js';
import { mul, sat01, put, fade } from './layout.js';

/**
 * 描边面板（圆角用短折线近似 —— LineBatch 画的是胶囊，没有填充图元）。
 * 想要底色再加一条 `lines.fillRect(x, y, w, h, withAlpha(col, 0.06))`。
 */
export function panel(lines, x, y, w, h, col, width = 1.5, r = 12) {
  const pts = [
    [x + r, y], [x + w - r, y], [x + w, y + r], [x + w, y + h - r],
    [x + w - r, y + h], [x + r, y + h], [x, y + h - r], [x, y + r], [x + r, y],
  ];
  lines.polyline(pts, width, col, false);
  return w;
}

/** 实心面板：用引擎的 `lines.fillRect`（一条批，不是逐行画横线）。 */
export function fillRect(lines, x, y, w, h, col, alpha = 0.06) {
  lines.fillRect(x, y, w, h, [col[0], col[1], col[2], alpha]);
}

/**
 * 眉标：一行小字 + 一条会生长的短线。做"栏目名"很省事。
 * @returns {number} 文字的宽度
 */
export function kicker(type, lines, P, str, x, y, t, delay = 0, opts = {}) {
  const accent = P.cyan ?? P.signal;
  const w = type.writeLine(str, x, y, {
    size: 23, weight: 600, family: 'mono', tracking: 7,
    color: cssOf(accent), ...fade(t, delay, 0.95, 0.34), ...opts,
  });
  const k = easeOutCubic(sat01((t - delay) / 0.5));
  if (k > 0.001) lines.seg(x, y + 20, x + 74 * k, y + 20, 2, mul(accent, 1.3));
  return w;
}

/**
 * 页脚：一条细线 + 左右两行小字。全片复用能让片子"成套"。
 *
 * @param {any} [grid] 风格栅格（`ctx.grid`）。传了就用它的 `pad` / `footerLineY` / `footerY`
 *   —— 不同风格的页边距差很多（`print` 120 / `terminal` 84 / `noir` 160），
 *   页脚要是永远钉在 120，换风格时"版心"就对不上。不传 = 从前的 H-104 / H-62 / 120（零变化）。
 */
export function footer(type, lines, P, left, right, t, delay, W, H, grid = null) {
  const k = easeOutCubic(sat01((t - delay) / 0.7));
  const pad = grid?.pad ?? 120;
  const lineY = grid?.footerLineY ?? (H - 104);
  const textY = grid?.footerY ?? (H - 62);
  if (k > 0.001) lines.seg(pad, lineY, pad + (W - pad * 2) * k, lineY, 1.2, mul(P.bone, 0.14));
  if (left) {
    put(type, left, pad, textY, {
      size: 22, family: 'mono', tracking: 3, color: cssOf(P.ash, 0.9), ...fade(t, delay + 0.15),
    });
  }
  if (right) {
    put(type, right, W - pad, textY, {
      anchor: 'right', size: 22, family: 'mono', tracking: 3, color: cssOf(P.ash, 0.9), ...fade(t, delay + 0.25),
    });
  }
}

/**
 * 准星：四根十字臂 + 四角括号 + 中心点。
 * 全片反复出现的一个母题，是观众眼睛的把手（见 `docs/ENGINE.md` 的转场配方）。
 * @param {number} k 0..1 张开程度（做入场动画）
 */
export function reticle(lines, x, y, r, col, w = 2, k = 1, gap = 0.34) {
  if (k <= 0.001) return;
  const rr = r * k;
  const inner = rr * gap;
  lines.seg(x - rr, y, x - inner, y, w, col);
  lines.seg(x + inner, y, x + rr, y, w, col);
  lines.seg(x, y - rr, x, y - inner, w, col);
  lines.seg(x, y + inner, x, y + rr, w, col);
  const c = rr * 0.62;
  const a = rr * 0.30;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    lines.seg(x + sx * c, y + sy * c, x + sx * (c - a), y + sy * c, w, col);
    lines.seg(x + sx * c, y + sy * c, x + sx * c, y + sy * (c - a), w, col);
  }
  lines.circle(x, y, rr * 0.12, w * 0.9, col, 16);
}

/**
 * 标记方块：实心块 + 四角刻度 + 可选的小十字。
 * 做"检测器投射出去的标记""识别靶点"这类东西。
 */
export function marker(lines, x, y, s, col, cross = true) {
  const h = s / 2;
  lines.fillRect(x - h, y - h, s, s, col, Math.max(1, s / 12));
  const o = h + 5;
  const a = s * 0.34;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    lines.seg(x + sx * o, y + sy * o, x + sx * (o + a), y + sy * o, 2.2, mul(col, 1.5));
    lines.seg(x + sx * o, y + sy * o, x + sx * o, y + sy * (o + a), 2.2, mul(col, 1.5));
  }
  if (cross) {
    lines.seg(x - h * 0.55, y, x + h * 0.55, y, 2.0, mul(col, 1.9));
    lines.seg(x, y - h * 0.55, x, y + h * 0.55, 2.0, mul(col, 1.9));
  }
}

function easeOutCubic(k) {
  return 1 - (1 - sat01(k)) ** 3;
}
