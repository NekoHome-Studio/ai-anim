// @ts-check
/**
 * `_config-lab` —— **配置档（B 档）** 的技术夹具：把三个"以前没人用过"的时间线字段
 * 真的用起来，作为 [`docs/CONFIG-ONLY.md`](../../docs/CONFIG-ONLY.md) §3 的真实例子。
 *
 *   `post`        后处理（第 4 段是 AgX + 降曝光，与其余四段的默认观感形成对比）
 *   `world`       `'auto'`（引擎铺共享背景）+ `false`（整帧底由这一段自己负责）
 *   `maxSamples`  自适应子帧数的**上限**（合法档只有 8 / 24 / 72 / 216）
 *
 * 与 `tasks/_post-lab/` 的分工：那边用**同一个测试卡场景**逐项标定后处理参数（`cut(scene, { post })`）；
 * 这边走的是**配置档那条路**（`{ type: 'chart', …, post }` → `src/timeline.js` 的 `configToCut()`
 * → `src/core/engine.js` 的合并）。两条路要能给出同一套结果，这个夹具就是那条路的见证。
 *
 * 这个目录里**只有这一个文件**：没有 `scenes/`、没有 `audio/`、没有一个 `import`。
 * 用的是 8 个模板里**不需要音乐**的五个 —— `wave` / `pulse` / `grid` 读 `ctx.music` 的包络数组，
 * 没配 `audio`、没跑过 `analyze` 时画面会黑（`docs/CONFIG-ONLY.md` §7），
 * 那会引入一堆二进制依赖，不值得。
 *
 * ── 三个字段各自的坑（都不是报错，而是"结果不对 / 变慢"）──
 *
 * ① `maxSamples` 是**提速**旋钮，不是"加密采样"：
 *    它只把自适应子帧数的上限**往下压**（`engine.js`：`maxSamples = min(MAX_SAMPLES, item.maxSamples)`，
 *    再 `Math.max(8, …)`），然后取 `8·3^L` 的那一档 ⇒ **合法值只有 8 / 24 / 72 / 216**。
 *    写 64 会被静默夹到 24 —— 画面**更粗**，一个字都不报。
 *    想让拖影更细要调**小** `--tol`（自适应容差），不是把这个数调大。
 *
 * ② `world: false` 的语义是「**这一段的整帧底由我自己负责**」—— 背景守门（`worldAudit`）
 *    会跳过声明了它的段。它是合法声明，不是"骗过 check"的开关；别为了让它绿去画一笔
 *    没意义的全屏 Pass。（⚠ 跳过 ≠ 这段没被看：见文件末尾那条备忘。）
 *
 * ③ 时间线的 `post` 会被**模板自己 `render()` 返回的 post 盖掉同名的键**
 *    （`engine.js`：`post = { ...默认, ...item.post, ...场景 return }`）。
 *    所以这一段只挑模板**没有**返回的键：`kinetic` 不返回 `exposure` / `tonemap` ⇒ 这两个生效；
 *    而 `bloom: 0.6` 被模板自己的 `bloom: 0.34` 盖掉 —— 想只靠配置档加强泛光，做不到。
 *
 * 出图（`-t` 是**整片时间**；实测过的时刻）：
 *   node scripts/anim.mjs still _config-lab -t 2,10,15,19.23,23,28.5,29.5
 * 对照关系：2 / 10 / 15（默认观感，0.14–0.87） vs 23（第 4 段：AgX + exposure 0.75 生效，0.10）。
 * 第 3 段（甩镜，19.00–20.50）里每一帧都有上一段的成帧可甩（图表铺满到 19.50），但它自己会把画面
 * 压暗：交叠窗中点 **19.23 实测 0.945**（图表被甩成横向拉丝、还有那道 signal 主轴），
 * 窗后 19.75 掉到 0.051、段尾 20.27 是 0.056 —— 那正是"甩走"的过程
 * （shader 里 `col *= mix(1.0, 0.15, k)`），不是没画东西。所以这一段的关键帧是 19.23。
 */
export default {
  title: '配置档标定 · post / world / maxSamples',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  // 不写 style：默认 `print`（= 引擎从前的默认观感）。这个夹具量的是字段转发，
  // 风格包会额外叠一层后处理基线（style.post 最后合并，压得住模板的 bloom），
  // 那属于另一个变量 —— 不引入。

  timeline: [
    // ── ①  0.00 → 4.00  标题：这一段**不写** post / world / maxSamples ──────────────
    //    对照组：默认观感、默认采样。`readout: false` 关掉右下角那个演示用的读数。
    {
      type: 'title',
      id: 'labTitle',
      dur: 4,
      note: '对照组：没有 post / world / maxSamples',
      eyebrow: 'ANIM / CONFIG-LAB',
      title: '配置档的三个字段',
      sub: 'POST  ·  WORLD  ·  MAXSAMPLES',
      readout: false,
    },

    // ── ②  4.00 → 19.50  图表：`world: 'auto'` 的显式声明 ────────────────────────────
    //    `'auto'` = "用 task.config 里 `export const world` 那张共享背景"（engine 的 resolveWorld）。
    //    ⚠ 纯配置档任务**没有** `export const world`（那要手写场景 + `worldPass()`），
    //      所以这里解析出来是 null —— 声明本身是合法的，底由 `chart` 模板自带的背景给。
    //      守门那边看得到它：`anim check` 的背景守门会把这一段算作"声明了共享背景"的一段
    //      （`anim audit _config-lab` 印 `world=auto`）。
    //    这一段一直铺到 19.50 = 甩镜的结束时刻，**这不是凑数**：
    //      `whip` 只在**交叠窗**里有上一帧可甩（`ctx.under` 只在 t < 上一段 end 时才有值），
    //      交叠窗之外它按 k = 1 画"已经甩到头"的样子 —— 而 k → 1 时 shader 里
    //      `col *= mix(1.0, 0.15, k)` 把画面一路压到 15%，实测亮度从 0.365 掉到 0.051
    //      （只有 grain 与暗角）。`tasks/demo` 的 whip 后半段同样是 0.051 —— 那是模板的设计。
    //      图表铺满全长，这一段的每一帧才都有东西可甩，暗下去的是"甩走"而不是"没画"。
    {
      type: 'chart',
      dur: 15.5,
      world: 'auto',
      note: "world: 'auto' —— 引擎铺共享背景的声明（本任务是纯配置档，没有 task.world 可解析）",
      values: [0.25, 0.5, 0.75, 1.0, 0.62, 0.88, 0.44, 0.7],
      title: '这三个字段以前没人用过',
      sub: 'post  ·  world  ·  maxSamples  —— 只剩转发断言，没有真实用例',
      footer: 'maxSamples 只往下压：合法档 8 / 24 / 72 / 216',
    },

    // ── ③ 19.00 → 20.50  甩镜：`world: false` + `maxSamples: 72` ────────────────────
    //    `overlap: 0.5` 不是装饰：`whip` 要读上一段的成帧（`ctx.under`）才甩得起来。
    //    `world: false` 的语义是"**这一段的整帧底由我自己负责，引擎别再加一层**"，
    //    而这里它是一句实话：render 开头 `gl.clear(黑)` 之后立刻用一个全屏 Pass
    //    把上一段的画面（under）甩上来 ⇒ 整帧覆盖**由模板自己完成**。
    //    背景守门会**跳过**声明了 `world: false` 的段（`src/app.js:864`）—— 这一段因此
    //    **不在** `anim audit` 的那张表里。实测：`audit _config-lab` 只列 `kinetic` 与 `outro`
    //    两段（5 段时间线里确实有 3 处交叠：图表→甩镜、甩镜→动态大字、动态大字→片尾；
    //    少的那一条就是被这一行跳过的甩镜）。
    //    ⚠ 跳过是**按设计**，不是"这段没被看见"的借口：它的整帧覆盖是靠 under 得来的，
    //      而 under 只在交叠窗里有值 —— 所以图表必须铺满这一段（见 ②）。
    //    `dur: 1.5`（而不是 2.5）是**量出来**的：甩镜自己会把画面一路压暗
    //    （shader 里 `col *= mix(1.0, 0.15, k)`，k→1 时只剩 15%），实测亮度
    //    交叠窗中点 0.945（还在甩）→ 窗后 0.051 → 段尾 0.056 —— 也就是说
    //    **1.5 秒正好是它压到黑的时间**，再长就是一条没有人看的黑尾
    //    （`tasks/demo` 是 `dur: 1.1 / overlap: 0.45`，那 0.65 秒的尾巴同样是 0.051）。
    //    段长贴着"甩完"就够。
    //    `maxSamples: 72` 是合法档里的一档：甩镜是全片动得最快的一段，
    //    封顶 72（而不是默认的 216）就是"这一段最贵，我给个上限"——
    //    子帧数**只会往下压**，所以这个数只可能让它更便宜，不可能让它更细。
    //    ⚠ 别单独播它：`still --only whip` 没有上一段 ⇒ 没有 under ⇒ 画面几乎是黑的
    //      （模板自己的说明里写着，属正常）。要看它，就看整片时间 19.0–20.5。
    {
      type: 'whip',
      dur: 1.5,
      overlap: 0.5,
      world: false,
      maxSamples: 72,
      note: 'world: false（整帧底由自己负责：把上一段的成帧甩上来）+ maxSamples: 72（甩镜是最贵的一段，封顶）',
      dir: [1, 0.12],
      streaks: 26,
    },

    // ── ④ 20.00 → 27.50  动态大字：`post` 在本片唯一一段生效的地方 ──────────────────
    //    `tonemap: 'agx'` + `exposure: 0.75`：AgX 把高光滚下来，但亮霓虹会去饱和，
    //    所以一般配一档负曝光（与 `tasks/_post-lab/` 的标定一致）。
    //    这一段是**反差**：其余四段里，`chart` 与 `kinetic` 都不返回 `exposure`，
    //    但只有这一段真的把它写上去了 —— 于是本片只有这一段是 AgX + 0.75 的观感。
    //    `bloom: 0.6` 是刻意留在这里的反例 —— 它被模板自己的 `bloom: 0.34` 盖掉，不生效（见文件头 ③）。
    //    `maxSamples: 24`：`kinetic` 的底 fbm 是逐像素噪声，噪声收敛慢 ⇒ 不封顶的话
    //    这一段会一路吃到 216。封顶 24 = 这一段**变快、画面略粗**，正是这个旋钮的用法。
    {
      type: 'kinetic',
      dur: 7.5,
      overlap: 0.5,
      maxSamples: 24,
      post: { bloom: 0.6, tonemap: 'agx', exposure: 0.75 },
      note: 'post: AgX + exposure 0.75（唯一生效的一段；bloom 0.6 被模板的 0.34 盖掉）+ maxSamples: 24',
      headline: ['配置档', '三个字段'],
      sub: 'POST  ·  WORLD  ·  MAXSAMPLES  ·  ONE FILE',
    },

    // ── ⑤ 27.20 → 30.70  片尾：`maxSamples: 216` = 自适应上限的**合法顶档** ──────────
    //    写 216 等于"不封顶"（引擎自己的 MAX_SAMPLES 就是 216）。
    //    片尾的细线收拢 + 压黑本来就慢，这一档让自适应有满档可用；`overlap: 0.3` 是硬切之外的
    //    一点交叉溶解 —— `outro` 的画面文字少，溶解不会糊（文字量大的段别这么干）。
    {
      type: 'outro',
      dur: 3.5,
      overlap: 0.3,
      maxSamples: 216,
      note: 'maxSamples: 216（合法顶档 = 不封顶，引擎自己的 MAX_SAMPLES）',
      title: '一段配置，三个字段',
      sub: 'post  ·  world  ·  maxSamples',
      signature: 'anim · config-lab',
    },
  ],
};

// ── 改这个夹具之前先读这一条（两件实测出来的事，**都不是**这个夹具的 bug）──────────────────
//
// ① `world: false` 会被背景守门跳过（`src/app.js:864` 的 `if (it.world === false) continue`），
//    所以 `whip` **不在** `anim audit` 的表里 —— 5 段时间线里实际有 **3 处**交叠
//    （图表→甩镜、甩镜→动态大字、动态大字→片尾），但守门只列 2 段（kinetic / outro）。
//    另外注意 `world: false` 在守门的数据里**根本不显示为 false**：它被跳过，所以一行都没有；
//    而没写 world 的段显示 `world=none`（`src/app.js:867`）。
//
// ② 守门**不是"整段都看着"**：它只对交叠段取**一个**时刻 —— 交叠窗的中点
//    `it.start + max(0.02, span/2)`（`src/app.js:866`）。所以"交叠窗之外的部分"没有任何守卫：
//    本夹具里甩镜 19.50–20.50 那 1 秒（画面已被它自己压到 15%）就是这样一个**没人看着的区间**。
//    那是模板自身的行为（不是漏画，`tasks/demo` 的 whip 尾巴实测同样是 0.051）——
//    但**如果**那 1 秒真的漏了底，守门也抓不到。
//    → 想让守门覆盖整段，得让它按多个时刻采样（或改成"整段里任一点 full === 0 就报"）；
//      那是引擎侧的事（`src/app.js` 的 `worldAudit`），不在这个夹具的范围里。
//
// ③ 与 `handlesTransition` 有关的**报告不一致**（只影响诊断，不影响画面）：
//    引擎读的是**场景**上的标记（`src/core/engine.js:563` 的 `!scene.handlesTransition`），
//    而守门读的是**段**上的标记（`src/app.js:881/884` 的 `it.handlesTransition`）。
//    配置档这条路里 `configToCut()` 把节点上的 `handlesTransition` 原样带过去（`src/timeline.js:92`），
//    节点上没写时它是 `undefined` —— 于是模板自带的那个 `true`（`src/shots/whip.js:34`）
//    **到不了段对象**，守门就会把它报成 `handlesTransition=n`。
//    画面是对的（引擎走场景那一份 ⇒ 不会对甩镜叠交叉溶解），纯粹是 `check` 的统计口径不齐。
