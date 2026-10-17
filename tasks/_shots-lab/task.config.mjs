/**
 * 镜头库新模板的标定夹具（BACKLOG 0-5）。
 *
 * 前 3 段 = 三个新模板（quote / counter / compare）的**默认画面**（什么都不传，看模板本色）；
 * 后 3 段 = 每个模板**不是默认值**的那几条分支 —— 没跑过 = 没验过：
 *   quote-center     align: 'center'（没有竖线，改用上方短横线）+ 长引文的折行与字号分档
 *   counter-decimals from 为负 + 千分位 + 两位小数（验 fmt() 的三条路）
 *   compare-2rows    rows 只有两行（行高按 rows.length 自己撑开）
 *
 * 它只有 task.config.mjs（B 档配置档），没有 scenes/ —— 这正是配置档要证明的事：
 * 新模板加进 src/shots/ 之后，时间线里写个 type 就能用。
 *
 *   node scripts/anim.mjs check _shots-lab
 *   node scripts/anim.mjs still _shots-lab -t 2,8,14,21,27.5,34.5
 *
 * ⚠ 这是一支夹具，不是片子：画面上的数字是模板的默认值 / 示意值，**没有事实表**（也不该有）。
 */
export default {
  title: 'shots-lab（新模板标定）',
  width: 1920, height: 1080, fps: 60, scale: 1,
  // 不写 style ⇒ 默认 'print'（引擎从前的默认观感），这样看到的是模板本色。
  // 想验证风格包下的样子：node scripts/anim.mjs still _shots-lab -t 2 --style paper
  timeline: [
    { type: 'quote', dur: 6, world: false },
    { type: 'counter', dur: 6, world: false },
    { type: 'compare', dur: 6, world: false },

    { type: 'quote', id: 'quote-center', align: 'center', dur: 6, world: false,
      label: 'CENTER',
      text: '居中的那一式没有竖线，\n改由上方一条短横线开场。\n再长一点：这一段同时验折行与字号分档。',
      cite: 'anim · 引文', role: '左对齐之外的另一种排法' },

    { type: 'counter', id: 'counter-decimals', dur: 6, world: false,
      from: -50, to: 1234.567, decimals: 2, unit: 'ms', label: '带千分位与小数位的读数',
      sub: 'COUNTER / 负起点 + 千分位 + 两位小数',
      footer: '这一段验的是 fmt()：负号 / 千分位 / 小数位三条路' },

    { type: 'compare', id: 'compare-2rows', dur: 6, world: false,
      title: '两行版', sub: 'COMPARE / rows 少的时候行高会自己撑开',
      aTitle: 'A 案', bTitle: 'B 案',
      rows: [
        { label: '首屏时间', a: 0.9, b: 0.22 },
        { label: '内存峰值', a: 0.35, b: 0.68 },
      ],
      footer: '这一段验的是 rows 的行数变化（行高按 rows.length 算）' },
  ],
};
