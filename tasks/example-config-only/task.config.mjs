// 只写配置，就能出片 —— 配置档（B 档）示例：这个任务目录里**只有这一个文件**。
//
// 没有 scenes/、没有 audio/、没有一行 import：时间线里的每一项直接写**镜头模板**
// （src/shots/ 的 8 个模板），由 src/timeline.js 的 build() 查表展开成段
// （src/tasks.js 只要发现数组里有 { type } 节点就走 build()）。
//
// 规则（都在 src/timeline.js 里实现；写错会抛错，不会静默吃默认值）：
//   · 时间线字段：type / id / dur / at / overlap / params / post / maxSamples /
//     handlesTransition / note / world / worldPass；
//   · 其余所有键都是**模板参数**，交给 shot(type, {…}) —— 参数名写错会抛错并列出可用参数
//     （也可以显式写在 params 里，它优先）；
//   · id 不写 = 模板自己的默认段名；dur 不写 = 4 秒；
//   · dur 支持秒，也支持 { beat: n } / { bar: n }。没有音频时按 bpm 120 算，
//     所以 1 拍 = 0.5 秒（beatTime() 的兜底：beat × 60 / 120）。
//
// 看某个模板有哪些参数、默认值是多少（这条命令不渲染任何东西）：
//   node scripts/anim.mjs shots            # 8 个模板各是什么
//   node scripts/anim.mjs shots chart      # 只这一个模板的全部参数与默认值
//
// 这支片子为什么没有音乐：这四段（title / chart / kinetic / outro）都不读音频，
// 时长全部写得出来（秒或拍号），成片因此是纯确定性的、没有音频分析这一层。
// 另外三个模板 wave / pulse / grid **必须**有音乐 —— 它们读 ctx.music 的包络数组
// （rms / low / mid / high）与 beat / kick 事件，没有音频分析结果时画面会黑，
// 所以这里刻意不用（whip 是甩镜转场：它把上一段的成帧甩走，得和上一段交叠才有意义，
// 这支 13.9 秒的小片子也不需要它）。
//
// 四段之间是硬切、不写 overlap：这几个模板各自铺满整帧（自带背景 Pass），
// 交叠只会让两张底互相溶解。段长按每个模板自己的入场节奏定（见下面每段的注释）。
export default {
  title: '只写配置，就能出片',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  // 调色板保持默认：chart 的纸面用 P.bone、柱体与文字用 P.ink，换配色得先出图复核，
  // 这个示例不引入需要肉眼再确认一遍的变量。

  timeline: [
    // ① 标题 3.5 秒 —— 拍号写法：{ beat: 7 } × 0.5s = 3.5s。
    //    主标题 9 个字逐字上浮：0.5 + 8×0.075 + 0.7 ≈ 1.8s 走完；
    //    副标 1.6s 开始淡入（0.45s 走完）；右下角读数 3.4s 走到 100% —— 3.5s 收尾时画面是完整的。
    //    id: 'hook' 演示「段名覆盖」：不写的话段名就是模板默认的 'title'。
    {
      type: 'title',
      id: 'hook',
      dur: { beat: 7 },
      note: '标题 · { beat: 7 } @120bpm = 3.5s',
      eyebrow: 'ANIM / CONFIG-ONLY',
      title: '只写配置，就能出片',
      sub: 'ONE FILE  ·  NO scenes/  ·  NO AUDIO  ·  4 SHOTS',
    },

    // ② 图表 4.4 秒 —— 秒写法。
    //    values 的 8 个数 = 8 个模板的参数个数 ÷ 6，全是写死的常数（不用随机）：
    //    title 5 / chart 6 / kinetic 6 / whip 3 / outro 4 / wave 4 / pulse 2 / grid 5
    //    （数字来自 `node scripts/anim.mjs shots`，不是估的）。
    //    柱体 0.35s 起逐条生长、每条 0.9s，最后一根 2.16s 到位；
    //    扫描线 1.6 → 4.4s 正好扫到最右，底部结论 3.2s 淡入（0.45s 走完）。
    //    peak 保持默认 0.95：>= 0.95 的两根（6 个参数的那两个模板）上信号色。
    {
      type: 'chart',
      dur: 4.4,
      note: '图表 · 秒写法的 dur',
      values: [0.833, 1.0, 1.0, 0.5, 0.667, 0.667, 0.333, 0.833],
      title: '八个模板，参数从 2 到 6 个',
      sub: 'SHOT TEMPLATES  ·  n = 8  ·  BAR = PARAMS / 6',
      footer: '参数名写错会直接抛错，并列出可用参数',
    },

    // ③ 动态大字 3.5 秒 —— 秒写法。
    //    headline 必须**正好两个元素**（模板的硬要求，多给少给都会画错），
    //    而且**每行别超过 6 个字**：`kinetic` 用的是逐字 `align: 'center'`（`type.write` 的 align
    //    对每个字生效，是引擎的已知坑），文字从画面中心往右排，170px × 6 字 ≈ 1900px，
    //    再长就从右边溢出屏幕（`tasks/demo` 那行 7 个字就顶到右边缘了）。
    //    副标（26px 等宽）实测约 20px/字符，40 个字以内都放得下。
    //    第 1 行 t=0 入场、第 2 行晚 0.35s；副标 1.6 → 3.2s 逐字擦出，
    //    短于 3.2s 的话最后一个字永远不出现；3.5s 让整行完整停留 0.3s。
    //    左下角那堆滚动数字用模板默认的 8×5 格、种子 31（确定性随机 rng(31)，不是 Math.random）。
    {
      type: 'kinetic',
      dur: 3.5,
      note: '动态大字 · 秒写法的 dur',
      headline: ['只写配置', '不用写场景'],
      sub: 'ALL PARAMS  ·  anim shots',
    },

    // ④ 片尾 2.5 秒 —— 拍号写法：{ beat: 5 } × 0.5s = 2.5s。
    //    细线 0.2 → 1.6s 从两侧收拢，副标 1.2s 开始淡入（0.45s 走完），
    //    最后 0.6 秒压黑收尾（模板按段内时间算 post.fade）—— 2.5s 够写完再黑。
    //    signature 只写文字：末尾那个闪烁的光标是模板自己加的。
    {
      type: 'outro',
      dur: { beat: 5 },
      note: '片尾 · { beat: 5 } @120bpm = 2.5s',
      title: '一段配置，一支片子',
      sub: 'task.config.mjs  ·  NO scenes/  ·  NO AUDIO',
      signature: 'anim · config-only',
    },
  ],
};
