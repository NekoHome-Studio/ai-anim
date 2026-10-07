// @ts-check
/**
 * `src/style/` —— **风格包（style pack）**：一支片子的「介质感」。
 *
 * ## 为什么需要它
 *
 * 引擎以前只有**一套**视觉：`DEFAULT_PALETTE` 的墨黑 + 骨白 + 信号橙，加上 8 个镜头模板
 * 共用的那套动效与后处理。于是每一支片子长得都像上一支 —— 用户的原话是
 * **「视频风格似乎被定死了……这样下去容易让观众审美疲劳」**。
 *
 * 问题不在"调色板不能换"（`task.palette` 一直能覆盖），而在**没有"风格"这个一等公民**：
 * 换风格要自己拼五六样东西（色板、字体、背景母题、后处理基线、版面栅格、字幕样式），
 * 文档里又没有任何一处鼓励你换 —— 结果就是所有人都照抄同一份示范。
 *
 * 现在：**一行 `style: 'paper'` 换一张脸。**
 *
 * ```js
 * // tasks/<任务>/task.config.mjs
 * export default {
 *   title: '…',
 *   style: 'paper',            // ← 一行；也可以用对象形式微调：{ name: 'paper', grid: { pad: 140 } }
 *   palette: { signal: '#c8381b' },   // 仍然可以按需覆盖风格包里的任意颜色
 *   timeline: [ … ],
 * };
 * ```
 *
 * ## 风格包里有什么
 *
 * | 字段 | 管什么 | 谁读它 |
 * |---|---|---|
 * | `palette` | 色板（覆盖 `DEFAULT_PALETTE` 的键，可少写） | `src/core/palette.js` → `ctx.P`、GLSL 常量 |
 * | `fonts` | 字体栈（覆盖 `text.js` 的 `FAMILIES`） | `TextKit.font()` |
 * | `post` | 后处理**基线**（泛光/颗粒/暗角/色差…）；模板与任务写的 post 优先 | `engine.js` 的 `post` 合并 |
 * | `grid` | 版面栅格（边距、页脚线、说明条基线、**字幕保留带**） | `src/kit/` 的元件 + 字幕层 |
 * | `captions` | 字幕样式（位置/字号/底衬/折行宽度/卡拉OK） | `src/core/captions.js` |
 * | `motif` | 共享背景的母题名（`grid`/`blueprint`/`paper`/`scan`/`none`…） | `src/kit/world.js` 的 `worldPass` |
 *
 * ## 两条使用纪律（`docs/STYLE.md` 展开）
 *
 * 1. **一支片子只用一套风格** —— 片内一致才有"成套"的感觉（这是原来那条"一套颜色 + 一套字体 +
 *    一种颗粒贯穿全片"的正确部分，保留）。
 * 2. **相邻两支片子不要用同一套** —— 观众记住的是"你的片子长什么样"，连着两支一模一样
 *    就会腻。`anim styles` 列出全部可选风格与它们适合讲什么。
 *
 * ⚠ **不写 `style` 时 = `print`**，而 `print` 的定义就是"引擎从前的默认观感"
 * （色板 = `DEFAULT_PALETTE`、字体 = `FAMILIES`、post = 空、字幕关闭）。
 * 所以老任务一个像素都不会变（`anim hashes <任务> --baseline` 可验证）。
 */

// 依赖方向：`core` 不知道 `style` 的存在，反过来可以 —— 这里只需要引擎那份字幕默认值，
// 免得同一个默认值在两处各写一份（见 CAPTIONS_BASE 的注释）。
import { DEFAULT_CAPTION_STYLE } from '../core/captions.js';

/** 默认字体栈（与 `src/core/text.js` 的 `FAMILIES` 一致；风格包只写要覆盖的那几个）。 */
const SANS = "'Archivo', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif";
const MONO = "'IBM Plex Mono', 'Sarasa Mono SC', 'Consolas', monospace";
const SERIF = "'Cormorant Garamond', 'Noto Serif SC', 'Songti SC', serif";
/**
 * 风格包里的字体栈**必须挑本机真的有的字体**，否则四套风格的字形会长得一样 ——
 * 这正是审计挖出来的一个隐形钉死源：`public/fonts/` 只装了一个 Manrope，
 * 而 `FAMILIES` 里的首选 `Archivo` / `IBM Plex Mono` / `Cormorant Garamond`
 * **文件都不存在**，于是全引擎一路回退到 **微软雅黑 + Consolas**，每支片子同一个字形。
 * 下面这几组是"Windows 上确定存在、且彼此差异明显"的组合（缺了就按顺序回退，不会报错）：
 *   宋体 / 楷体（印刷感）· Bahnschrift / Segoe UI（工程感）· Georgia（衬线）· Consolas（等宽）
 */
const SONG = "'Songti SC', 'SimSun', 'Noto Serif SC', Georgia, serif";
const KAI = "'KaiTi', 'STKaiti', 'Songti SC', 'Microsoft YaHei', serif";
const ENG = "'Bahnschrift', 'Segoe UI', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif";
const GEORGIA = "Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif SC', serif";
const UI = "'Segoe UI', 'Helvetica Neue', Arial, 'Microsoft YaHei', system-ui, sans-serif";
const MONO_UI = "Consolas, 'Sarasa Mono SC', 'Courier New', monospace";

/** 默认版面栅格（1920×1080 基准）。数值来自 `tasks/optifine` / `demo` 一直在用的那套。 */
const GRID_BASE = {
  /** 左右页边距 */
  pad: 120,
  /** 内容上沿（眉标/段标签的基线） */
  top: 92,
  /** 底部分隔线（页脚）的 y */
  footerLineY: 976,
  /** 页脚文字的基线 */
  footerY: 1018,
  /** 底部说明条（`caption()`）的横线 y 与正文基线 */
  captionLineY: 930,
  captionY: 964,
  /** 正文（面板/图示）不许越过这条线 —— 再往下是说明条与字幕的地盘 */
  contentBottom: 900,
  /**
   * **字幕保留带** `[y0, y1)`：引擎的字幕层占这一带，其它文字不许进来。
   *
   * ⚠ 为什么默认在**顶部**（而不是字幕惯例的底部）：引擎自己的元件已经把底部占满了 ——
   * 镜头模板的 `readout` / 签名 / `footer` 都在 y≈990，`footer()` 在 H-62，
   * 说明条 `captionNote()` 在 964 与 1004。底部再塞字幕就是"两块文字抢同一片区域"，
   * 而 Netflix 的 timed-text 规范第一条就是"避开画面文字；重叠无法避免时放在更易读的位置"。
   * 顶部居中这一带（y 40–104）与左上段标签（x≥128）、右上读数（x≥1190）在**水平方向**
   * 也不重叠 —— 字幕最宽 16 字 ≈ 704px，居中后落在 x ≈ 595–1325（`src/kit/bands.js` 的 `sub` 带
   * 按 `W*0.19` 算的，和 `src/core/captions.js` 逐字一致）。
   *
   * 想要底部字幕：风格里覆盖 `grid.captionBand` 与 `captions.position`，并**同时**
   * 把那一带让出来（关掉模板的 readout / 页脚，或用 `assertInBand()` 核对）。
   */
  captionBand: [40, 104],
};

/**
 * 默认字幕样式：**直接引用引擎那一份**（`src/core/captions.js` 的 `DEFAULT_CAPTION_STYLE`），
 * 风格包只在其上做局部微调。
 *
 * 为什么不再各写一份（这是文档审计抓出来的教训）：两份默认值曾经漂移过两次 ——
 * `karaoke` 一处 `true` 一处 `false`（四套风格全都默认开了"逐词高亮"，与研究的负效应结论相反）、
 * `hold` 一处 1.06 一处 1.1。**同一个默认值写在两个地方，早晚会对不上**，
 * 而这类不一致的表现是"换了风格字幕停留时间变了"这种没人会去查的小事。
 * 现在 `tools/test-style.mjs` 还会断言风格包与引擎默认的关键项一致。
 */
const CAPTIONS_BASE = { ...DEFAULT_CAPTION_STYLE };

/**
 * 内置风格包。
 *
 * 每一条都刻意做得**差异明显**（底色明暗、字体介质、背景母题、栅格宽窄都不同）——
 * 换了风格必须一眼看得出来，否则它就没有存在的意义。
 */
export const STYLES = {
  /* ------------------------------------------------------------------ 印刷品（默认） */
  print: {
    label: '印刷品',
    note: '墨黑纸面 + 骨白正文 + 单一信号橙。引擎从前的默认观感；不写 style 就是它，适合"信息密度高的技术讲解"。',
    palette: {},
    fonts: {},
    post: {},
    motif: 'grid',
    grid: { ...GRID_BASE },
    // ⚠ `false` = **这套风格默认不开字幕**。`print` 必须保持 false：它是"引擎从前的默认观感"，
    //   老任务（有旁白、但从来没写 captions）不该因为我们加了字幕层就凭空多出一行字幕。
    //   其余风格写对象 = 默认开字幕（想关就写 `captions: false`）。
    captions: false,
  },

  /* ------------------------------------------------------------------ 蓝图 / 工程图 */
  blueprint: {
    label: '蓝图 · 工程图',
    note: '深蓝坐标纸 + 白描线 + 青色标注。适合讲结构、管线、坐标与"这东西怎么拼起来"。',
    palette: {
      ink: '#061726',
      ink2: '#0a2438',
      graphite: '#2f5a7a',
      ash: '#8fb6d0',
      bone: '#e6f2fb',
      signal: '#4fd0ff',
      ember: '#9fe8ff',
      blood: '#0d3a57',
      acid: '#ffe066',
      cyan: '#4fd0ff',
    },
    fonts: { sans: ENG, mono: MONO_UI },
    post: { bloom: 0.22, grain: 0.014, vignette: 0.40, ca: 0.06, shoulder: 0.92 },
    motif: 'blueprint',
    grid: { ...GRID_BASE },
    captions: { ...CAPTIONS_BASE, size: 42, bg: 0.44 },
  },

  /* ------------------------------------------------------------------ 纸面（反色） */
  paper: {
    label: '纸面 · 反色',
    note: '米白纸面 + 墨黑正文 + 朱红强调 —— 把 ink/bone **反过来**，整片立刻从"屏幕"变成"纸"。'
      + '适合科普、说明、任何想让观众"读得下去"的长片。',
    palette: {
      ink: '#f3f0e7',
      ink2: '#e8e3d6',
      graphite: '#b9b2a2',
      ash: '#6b665c',
      bone: '#1b1a17',
      signal: '#c8381b',
      ember: '#e0663a',
      blood: '#8d2413',
      acid: '#2f6f3a',
      cyan: '#1f6f9c',
    },
    // 纸面就该是**宋体**（衬线）：这是四套风格里最容易一眼认出的一套 ——
    // 中文视频几乎全是黑体，换成宋体的那一刻"介质"就变了（引文/出处走楷体）
    fonts: { sans: SONG, serif: KAI, mono: MONO_UI },
    // 浅底最怕泛光：bloom 一高整片就糊成一片白。颗粒可以给足（纸的质感全靠它）。
    post: { bloom: 0.06, grain: 0.055, vignette: 0.10, ca: 0, shoulder: 0.97, lift: 0, contrast: 1.03 },
    motif: 'paper',
    grid: { ...GRID_BASE, pad: 140 },
    captions: { ...CAPTIONS_BASE, size: 46, bg: 0.0, dim: 0.5 },
  },

  /* ------------------------------------------------------------------ 终端 / 磷光 */
  terminal: {
    label: '终端 · 磷光',
    note: '纯黑 + 磷光绿 + **全片等宽字**。适合讲代码、日志、协议、命令行 —— 一眼就是"机器在说话"。',
    palette: {
      ink: '#030704',
      ink2: '#06120b',
      graphite: '#1d4a30',
      ash: '#4fbe7e',
      bone: '#c6ffd9',
      signal: '#3dff88',
      ember: '#9dffbc',
      blood: '#0b3a20',
      acid: '#e8ff5c',
      cyan: '#5cffd0',
    },
    // 全片等宽：连标题都是打字机，这是这套风格最值钱的地方
    fonts: { sans: MONO_UI, serif: MONO_UI },
    post: { bloom: 0.44, grain: 0.03, vignette: 0.62, ca: 0.18, shoulder: 0.88 },
    motif: 'scan',
    grid: { ...GRID_BASE, pad: 84, top: 76, footerLineY: 986 },
    // ⚠ **不要在这里改 `captionBand`**（第一版给这套风格挪到了底部 [990,1052]，出图当场看到字幕贴到
    //   画面下沿、第二行被裁掉一半）。字幕带是**引擎保留区**：它的位置牵动着全片每一个元件的让位约定
    //   （模板的 readout/签名/footer 都是硬编码的），风格能改的是字幕的**样式**（字号/底衬/颜色），
    //   改位置就得同时改版式 —— 那是手写场景的事。`tools/test-style.mjs` 有断言盯着这一条。
    captions: { ...CAPTIONS_BASE, size: 40, bg: 0.62, weight: 500 },
  },

  /* ------------------------------------------------------------------ 黑白电影 */
  noir: {
    label: '黑白电影 · 单点琥珀',
    note: '近黑 + 纯白 + 一点琥珀，重暗角、强颗粒、宽边距。适合讲事故、真相、"当时到底发生了什么"。',
    palette: {
      ink: '#08080a',
      ink2: '#101014',
      graphite: '#4a4a52',
      ash: '#9a9aa4',
      bone: '#ffffff',
      signal: '#ffb020',
      ember: '#ffd27a',
      blood: '#5c3a00',
      acid: '#d8ff3c',
      cyan: '#8fb4d8',
    },
    fonts: { sans: UI, serif: GEORGIA, mono: MONO_UI },
    post: { bloom: 0.30, grain: 0.07, vignette: 0.78, ca: 0.10, contrast: 1.12, saturation: 0.85 },
    motif: 'noir',
    grid: { ...GRID_BASE, pad: 160, top: 110 },   // ← 同上：不要改 captionBand
    captions: { ...CAPTIONS_BASE, size: 44, weight: 500, bg: 0.34 },
  },
};

/** 风格名列表（给 CLI / 文档用）。 */
export function listStyles() {
  return Object.entries(STYLES).map(([name, s]) => ({
    name,
    label: s.label,
    note: s.note,
    motif: s.motif,
    /** 这套风格最显著的一眼特征，`anim styles` 打出来 */
    palette: { ink: s.palette.ink ?? '(默认墨黑)', bone: s.palette.bone ?? '(默认骨白)', signal: s.palette.signal ?? '(默认信号橙)' },
  }));
}

/**
 * 把 `task.style` 解析成一份完整的风格对象。
 *
 * 三种写法：
 *   · 不写 / `null`      → `print`（= 引擎从前的默认观感，老任务零变化）
 *   · `'paper'`          → 取风格包
 *   · `{ name: 'paper', grid: { pad: 160 }, captions: false }` → 风格包 + 局部覆盖
 *
 * @param {any} spec `task.config.mjs` 的 default 导出（或只传 `spec.style`）
 * @returns {any} 完整风格对象（一定非空；`captions` 可能是 `false` = 关闭字幕层）
 */
export function resolveStyle(spec = {}) {
  const req = spec && typeof spec === 'object' && 'style' in spec ? spec.style : spec;
  if (req === false) return null;                       // 显式关掉风格系统（老行为的保险绳）
  const isObj = req && typeof req === 'object';
  const name = typeof req === 'string' ? req : (isObj ? (req.name ?? 'print') : 'print');
  const pack = STYLES[name];
  if (!pack) {
    throw new Error(
      `未知的风格 "${name}"。可用的：${Object.keys(STYLES).join(' / ')}`
      + '（看说明：node scripts/anim.mjs styles）',
    );
  }
  const over = isObj ? req : {};
  // ⚠ `captions: false` 要能**覆盖掉**风格包里的字幕样式（而不是被 merge 成对象）
  const caps = over.captions === false || pack.captions === false
    ? false
    : { ...(pack.captions ?? CAPTIONS_BASE), ...(over.captions ?? {}) };
  return {
    name,
    label: pack.label,
    note: pack.note,
    motif: over.motif ?? pack.motif,
    palette: { ...pack.palette, ...(over.palette ?? {}) },
    fonts: { ...(pack.fonts ?? {}), ...(over.fonts ?? {}) },
    post: { ...(pack.post ?? {}), ...(over.post ?? {}) },
    grid: { ...GRID_BASE, ...(pack.grid ?? {}), ...(over.grid ?? {}) },
    captions: caps,
  };
}

/**
 * 按实际分辨率缩放过的栅格。
 *
 * `grid` 里的数字都是 **1920×1080 基准**；4K（`scale: 2`）时逻辑分辨率其实不变
 * （引擎的 `W/H` 一直是逻辑像素），所以一般直接返回 `style.grid` 即可。
 * 只有任务自己把 `width/height` 写成非 1080p（例如 1280×720）时才需要按 `H/1080` 缩放。
 *
 * @param {any} style resolveStyle() 的结果
 * @param {number} W @param {number} H 逻辑分辨率
 */
export function gridFor(style, W, H) {
  const g = style?.grid ?? GRID_BASE;
  const k = H / 1080;
  if (Math.abs(k - 1) < 1e-6) return g;
  const s = (v) => Math.round(v * k);
  return {
    ...g,
    pad: s(g.pad), top: s(g.top), footerLineY: s(g.footerLineY), footerY: s(g.footerY),
    captionLineY: s(g.captionLineY), captionY: s(g.captionY), contentBottom: s(g.contentBottom),
    captionBand: [s(g.captionBand[0]), s(g.captionBand[1])],
  };
}

export { GRID_BASE, CAPTIONS_BASE, SANS, MONO, SERIF };
