// @ts-check
/**
 * `_style-sampler` —— **风格采样器**：同一段时间线，五套风格。
 *
 * 它的用途只有一个：让你**一眼看到**风格包到底换掉了什么，以及"同一段画面换一套风格
 * 就是另一支片子"这件事有多明显。跑法（不改任何文件）：
 *
 * ```sh
 * node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style print
 * node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style paper
 * node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style terminal
 * node scripts/anim.mjs sheet _style-sampler --from 0 --to 14 -n 12 --style blueprint
 * ```
 *
 * 出图落在 `out/_style-sampler/stills/`（同一个目录会被后一次覆盖，想留对比就先改名）。
 *
 * ## 这一段同时演示了三件事
 *
 * 1. **`style` 一行换整片观感**（调色板 / 字体栈 / 背景母题 / 后处理基线 / 版面栅格 /
 *    字幕样式一起换，见 `src/style/index.js` 与 `docs/STYLE.md`）；
 * 2. **引擎级字幕层**（`captions: true`）—— 场景里**一行都不用写**，引擎每帧自动画
 *    当前那句旁白，位置来自风格包的**字幕保留带**（`docs/CAPTIONS.md`）；
 * 3. **不写 `audio` 也能有旁白**：`narration` 可以直接内联（这里就是），
 *    所以字幕层可以在**零素材**的任务里验证 —— 不需要 TTS、不需要 mp3。
 *
 * ⚠ 这里的旁白表是**手写的时长**（不是 TTS 量出来的），所以它只适合当演示：
 *   真实片子的段长必须由旁白决定（`anim say`，见 `docs/NARRATION.md` §5）。
 */
export default {
  title: '风格采样器 · 五套风格',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,

  // 默认风格（出对比图时用 `--style paper` 这类参数临时覆盖，不改这个文件）
  style: 'print',

  // 引擎字幕层（docs/CAPTIONS.md）。风格包若自带 captions 样式，这一行可以省 ——
  // print 是唯一一套"默认不开字幕"的风格（它的定义就是"引擎从前的观感"）。
  captions: true,

  /**
   * 旁白表：**整片绝对时间**（秒）。字幕层读它；`dur: { vo: 'id' }` 也能按它定时长。
   * 内联写法的好处是这个任务零素材、纯确定性，随时能跑（见文件头第 3 条）。
   */
  narration: {
    lines: [
      // ⚠ 时长与起点是**按字幕规则**排的（`check` 会守）：每句语速 ≤9 字/秒
      //   （Netflix 简体中文的成人上限），而且「说完 + 停留 1.06s」必须落在**本段之内** ——
      //   字幕跨越场景切换时，下一段开头会看到上一句还在淡出（第一版就是这么写的，
      //   出图当场看到两句话叠在 chart 段开头）。
      { id: 's1', text: '同一段画面，换一套风格，就是另一支片子。', start: 0.6, dur: 2.5 },
      { id: 's2', text: '配色、字体、背景母题、字幕样式，全都跟着风格包走。', start: 5.0, dur: 2.9 },
      { id: 's3', text: '留白和节奏都没变，观众记住的却是另一张脸。', start: 10.0, dur: 2.4 },
      { id: 's4', text: '所以下一支，记得换一套。', start: 14.0, dur: 1.5 },
    ],
  },

  timeline: [
    // ① 标题 4.4s：风格换掉的第一眼就是这里（底色 + 字体 + 强调色 + 背景母题）
    {
      type: 'title',
      id: 'hook',
      dur: 4.4,
      note: '标题 · 底色/字体/母题一眼就不同',
      eyebrow: 'ANIM / STYLE SAMPLER',
      title: '同一段画面，五套风格',
      sub: 'ONE TIMELINE  ·  FIVE STYLE PACKS  ·  anim styles',
    },

    // ② 图表 5.2s：浅底风格（paper）在这一段差别最大（纸面 + 墨字 + 朱红）
    {
      type: 'chart',
      dur: 5.2,
      note: '图表 · 浅底 vs 深底差别最大',
      values: [0.42, 0.58, 0.66, 0.74, 0.83, 0.91, 1.0],
      title: '风格包换掉的东西',
      sub: 'PALETTE · FONTS · MOTIF · GRID · POST · CAPTIONS',
      footer: 'node scripts/anim.mjs styles',
    },

    // ③ 动态大字 4.0s（每行 ≤ 6 个字 —— kinetic 模板的硬要求）
    {
      type: 'kinetic',
      dur: 4.0,
      note: '动态大字 · 字体栈换了，字形就换了',
      headline: ['换一套风格', '换一张脸'],
      sub: 'STYLE PACK  ·  docs/STYLE.md',
    },

    // ④ 片尾 3.4s
    {
      type: 'outro',
      dur: 3.4,
      note: '片尾 · 收尾',
      title: '下一支，换一套',
      sub: "task.config.mjs  ·  style: 'paper'",
      signature: 'anim · style sampler',
    },
  ],
};
