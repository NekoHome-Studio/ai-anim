# CAPTIONS.md —— 字幕层与「信息分工」

> **一句话**：观众说「**两条字幕同时出现（页面介绍 + 语音字幕）看着好迷糊**」。
> 根因不是排版不好看，而是**同一句话在屏幕上被写了两遍** —— 一遍是出锅后烧上去的语音字幕，
> 一遍是场景代码画的"说明条"。这份文档把这件事在**流程层面**堵死：
> **旁白负责「说句子」，字幕负责「显示这句话」，画面只负责「标注」。**
>
> 相关：[`docs/NARRATION.md`](./NARRATION.md)（旁白层）· [`docs/STYLE.md`](./STYLE.md)（风格包的 `captions` 字段）·
> [`docs/SCENE-BRIEF-TEMPLATE.md`](./SCENE-BRIEF-TEMPLATE.md)（brief 里的「画面文字表」）·
> `docs/history/IMPROVEMENTS-4-5.md` §5 · `docs/ENGINE.md` §3.3（`ctx.captions` / `ctx.grid` / `ctx.warnings`）· `AGENTS.md` §6.5 / §10。

> **📌 实现状态**（写这份文档时逐条对着代码核过，**全部已落地**）：
> 引擎字幕层 `src/core/captions.js` · 版面六条带 + `captionNote()` / `subLine()` / `assertInBand()`
> 在 `src/kit/bands.js`（出口 `src/kit/index.js`）· `task.config.mjs` 的 `captions: true`（`src/tasks.js`）·
> `ctx.captions.active(t)` / `.band` / `.style` / `.lines` · `ctx.narration.at/recent/line/durOf/lines` 与词级 `words` ·
> `type.karaoke(...)` · `node scripts/anim.mjs subs <任务>` · `node tools/lint-narration-dup.mjs <任务>`。
> 字幕 `karaoke` 的默认值曾与 `src/style/index.js` 漂移过（本文写第一版时抓到），**现已核实一致**：
> 四套风格与引擎默认**都是 `false`**，并由 `tools/test-style.mjs` 的断言守着 —— 见 §3.4。

---

## 1. 问题现场：两条字幕是怎么同时出现的

观众原话：「两条字幕同时出现（页面介绍 + 语音字幕）看着好迷糊」。查下来 ——
**当时"语音字幕"根本不在引擎里**：

| 那条字幕 | 从哪来 | 位置 / 字号 | 证据 |
|---|---|---|---|
| **语音字幕** | **出锅之后**用 `ffmpeg -vf ass=…` 烧上去的 | **顶部居中**，字号 **46** | `out/_staging/make-srt.mjs`（105 行，**已被 `anim clean` 清掉**）：`Style: Main,Microsoft YaHei,46,…,Alignment=8, MarginV=34`；注释原文「Alignment=8 = 顶部居中」 |
| **页面介绍** | 画面底部那条场景代码画的**说明条**（`caption()`） | **左下** `x=128, y=H-116`（=964），字号 **44** | `tasks/sodium/scenes/_world.js:644`：`const y = ctx.H - 116`、`size: opts.size ?? 44` |

**字号 46 vs 44** —— 差 2px。观众看到的不是"一主一辅"，而是"**同一种东西出现了两次**"。

更要命的是**说的是同一句话**。`lint-narration-dup.mjs` 把那次人工比对变成了可复现的判据：

| 任务 | 旁白句数 | **被逐字写进画面代码** |
|---|---|---|
| `tasks/sodium` | 43 | **12 句** |
| `tasks/optifine` | 47 | **3 句** |
| `tasks/beast`（对照组） | 26 | **0 句** |

对照组值得抄：它的 `SCRIPT.md` 把「旁白」和「屏幕上写了什么」**当两列写**，画面只放数字 / 代码 / 出处。
`sodium` 侧随手几条原文对照（`narration.json` vs `scenes/*.js`）：`渲染时还要按高度切：每 16 格算一段。`
**一字不差**；`每一段的几何，都是顶点数据。` **一字不差**；`坐标、颜色、贴图、光照、法线。` **一字不差**；
`漫不到的段，就是不画。` **一字不差**；`官方说，这大幅减少了交互造成的卡顿。` **一字不差**；
`世界被切成 16 乘 16 的区块。` → `… 16 × 16 …`（只换了符号）。
还有一条是**代码直接抄的**：`tasks/sodium/scenes/cull.js:294` 写的是
`if (cur) caption(ctx, { text: cur.text, src: cur.src, … })` —— `cur.text` 就是旁白原文，
**这条写法在结构上就注定重复**，不是"不小心"。

**为什么这是流程问题，不是排版问题** —— 三件事叠在一起：

1. **字幕不在引擎里**（属于"出锅后的 ffmpeg 步骤"），所以**写场景的人根本不知道有字幕**，两边作者看不到对方；
2. **生成脚本住在 `out/_staging/`**，而 `out/` 会被 **`anim clean` 清掉**，也不在版本管理视野里 ——
   **这套做法连复现都做不到**（sodium 与 optifine 各有一份几乎逐字相同的脚本）；
3. **文档里没有一处说"画面文字不许复述旁白"** —— 相反，原型 brief 把 `caption(ctx, {text, src})`
   描述成「底部说明条（带出处）」，于是每个子代理都很自然地**把这一镜的旁白抄进去当说明**。

**结论**：只在排版上改解决不了。必须 ① 把字幕变成引擎的一等公民（`src/core/captions.js`），
② 把**信息分工**写成纪律（§2），③ 把"复述"变成**能自动查出来的东西**（§5）。

---

## 2. 分工原则（核心，硬约束）

> **旁白负责「说句子」，字幕负责「显示这句话」，画面只负责「标注」。**
> —— 名词、数字、单位、结构、出处。画面文字 **不许复述旁白**（同一个意思换词说也算）。

| 层 | 只负责 | 不许做 |
|---|---|---|
| **旁白**（`narration.json`） | 把话说完整、说成句 | 不许承担"标注"（念出单位/出处）——那会让句子变长、语速变赶 |
| **字幕**（引擎字幕层） | **显示当前这句话**（含"说完再留一会儿"、逐句淡入淡出） | 不许加自己的评论、不许做"要点摘录" —— 摘要不是字幕 |
| **画面文字**（场景代码） | **标注**：名词（`Chunk` / `section`）、数字（`16 × 16` / `256`）、单位、结构标签、出处（`src`） | **不许复述旁白**，不许写完整的句子 |

**判据（怎么算"复述"）**：

- **逐字相同** → 违规（`lint-narration-dup.mjs` 直接报 `文件:行号`）。
- **只换标点/符号/一个词**（`16 乘 16` → `16 × 16`、`降了九成` → `降低九成以上`）→ **违规**。
- **同义改写**（"命令不贵，贵的是 CPU 一次只能忙一件事" → "CPU 一次只能做一件事"）→ **违规**。
- **抽取名词/数字当标注**（把 `渲染时还要按高度切：每 16 格算一段` 变成画面上的 `section = 16 格高`）
  → **合规**，这就是"标注"该有的样子。
- **旁白没说的补充信息**（出处、单位、口径、对照值）→ **合规**，而且是画面文字最该干的事。

**为什么值得写成纪律（外部依据）**：一份对 22 支头部视频的逐帧测量里，
「同一时刻两块文字从不占用同一个区域」被列为一条规律；长视频侧更直接 —— 9 支长视频 **502 帧里 0 帧**
含逐句字幕：

> 「逐句字幕条会把'注意力通道'花在**冗余**上 —— 关键词弹字之所以有效，正是因为屏幕上没有已经写满字。」
> 「文字要回答的是'**观众此刻该记住/该看什么**'，不是'**此刻在说什么**'。」

来源：[We measured 9 top YouTube videos. None of them burn captions.](https://www.writepanda.ai/blog/youtube-videos-dont-burn-captions-study/) ·
证据强度：**从业者测量**（n=9 支 / 3 个频道 / 502 帧；作者自己写明是观察性数据、不是实验）。
**注意**：那条结论是"长视频**不烧**逐句字幕"；本引擎的字幕层**默认关闭**（`print` 的 `captions` 就是 `false`），
与该结论一致。中文技术科普静音自动播放占比高，打开字幕层常常是对的 ——
但**打开之后画面文字必须从"复述"退回到"标注"**，否则就是同时付两份冗余成本。

引擎侧另有一条依据写在 `src/core/captions.js` 的注释里：**Netflix 的 timed-text 规范**把
"与画面文字相同、或已被对白覆盖的冗余文本"列为**必须删除**
（[Chinese (Simplified) Timed Text Style Guide](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007-Chinese-Simplified-Timed-Text-Style-Guide)）。

---

## 3. 引擎怎么用

### 3.1 打开字幕层（一行）

```js
// tasks/<任务>/task.config.mjs
export default {
  title: '我的片子', width: 1920, height: 1080, fps: 60, scale: 1,
  captions: true,                       // ← 打开引擎字幕层
  narration: './narration.json',        // 句子表（含可选 words 词级时间戳）
  timeline: [ /* … */ ],
};
```

**引擎负责什么**（`src/core/captions.js`）：

- 在**后处理之后**画 —— 字幕是**信息层**，让它吃泛光/颗粒会把字糊掉（"骨白正文永远不要 bloom"），
  字幕可读性优先于质感统一；
- 在**字幕保留带**内自动画**当前那一句**；位置来自 `style.grid.captionBand`；
- **"说完再留一会儿"** —— `hold`，引擎默认 **1.06s**（四套风格也是 1.06 —— 同一默认值只写一处）；
- **逐句淡入淡出** —— `fade` 默认 **0.16s**；出场淡出只发生在"停留窗口的最后一小段"里
  （话音刚落下时字幕必须还亮着）；
- **折行** —— `maxCharsPerLine` 默认 **16 个中文字**、`maxLines` **2**（Netflix 简体中文规范）；
  太长会整体缩一号重排，**不省略号**（省略等于丢信息）；
- **底边对齐**（不是顶边）—— 两句变一句时字幕不会"上下跳"（规范要求连续多条位置稳定）。

**默认值只有一处定义**：`src/style/index.js` 的 `CAPTIONS_BASE` 直接引用引擎那一份
（`const CAPTIONS_BASE = { ...DEFAULT_CAPTION_STYLE }`），所以 `hold` **1.06** / `fade` **0.16** /
`karaoke` **false** / `maxCharsPerLine` **16** / `maxLines` **2** / `position` **`'top'`**
在**引擎与四套风格里都是同一个值**（曾经在两处各写一份、漂移过两次；现在由
`tools/test-style.mjs` 的断言钉住）。
四套风格只在它上面做"长什么样"的微调：`blueprint` `size 42 / bg 0.44`；
`paper` `size 46 / bg 0.0 / dim 0.5`；`terminal` `size 40 / bg 0.62 / weight 500`；
`noir` `size 44 / weight 500 / bg 0.34`。

打开方式有三种（`resolveCaptionStyle()`）：`true` = 用风格包的字幕样式；
`{ size: 40, karaoke: false }` = 风格包样式 + 局部覆盖；
`false` / 不写且风格包没写 = **不画字幕**（`print` 的 `captions` 就是 `false`，老任务不会凭空多出一行字幕）。
**场景里一行都不用写。**

### 3.2 场景侧能读到什么

```js
ctx.captions.active(t)    // → { line, alpha } | null —— 此刻该显示哪句、不透明度多少
ctx.captions.band         // → { x0, x1, y0, y1 } 字幕保留带（x 是字幕实际会占的那一块）
ctx.captions.style        // → 解析后的字幕样式（size / maxCharsPerLine / hold / karaoke …）
ctx.captions.lines        // → 全部句子

// 场景侧最典型的用法 —— 让画面主动避开保留带，而不是"再画一遍字幕"：
const band = ctx.captions?.band;
const bottom = band ? band.y0 - 24 : 120;   // 面板上沿不许压进字幕带
```

没开字幕时 `ctx.captions` 是一个**安全空实现**（`band` 也给了默认值），所以场景可以**无条件**读它。
配套的**旁白接口**（`src/core/narration.js`）：

```js
ctx.narration.at(t)          // 正在说的那句（严格 [start, end)）；带 p / typedText / charIndex
ctx.narration.recent(t, 1.2) // 刚说完还没超过 1.2s 的那句 —— 字幕/卡拉OK 不该话音一落就消失
ctx.narration.line('cull-2') // 按 id 取；durOf(id) 取这句多长（秒）
type.karaoke(text, words, x, y, t, { size, base, sung })   // words[].start/end 是**秒**、整片绝对时间
```

⚠ **时钟要对齐**：`anim say` 写的 `words` 是**整片绝对时间**，配 `f.t`，**不要**配 `f.lt`（`AGENTS.md` §6.5）。

### 3.3 场景侧的两个元件（想自己画的时候）

大多数片子**不需要**它们 —— 引擎字幕层已经每帧自动画了。少数场合才用：

| 元件 | 用途 | 位置 |
|---|---|---|
| `captionNote(ctx, { text, src, color, alpha, maxChars, size })` | **说明条**：一条短标注 + 出处小字（左下角，落在字幕带**之外**）。文案超过 `maxChars`（默认 **18** 个中文字）会**警告** —— 那是句子，句子该交给旁白与字幕 | `src/kit/bands.js` |
| `subLine(ctx, { t, hold, size, karaoke })` | 想在**某一段内**自己画语音字幕（例如片头没有字幕，或想在字幕上做本片特有的花样）。位置从保留带来，所以**永远压不到别的文字** | 同上 |

```js
import { captionNote } from '../../../src/kit/index.js';
captionNote(ctx, { text: '区块重建 · 16³', src: 'optifine.net/faq' });   // ✅ 标注
captionNote(ctx, { text: '世界被切成 16 乘 16 的区块。' });               // ✗ 句子 → 会警告
```

### 3.4 别做逐词高亮（`karaoke` 默认关，要开只能显式开）

**四套风格与引擎默认一致：`karaoke` 默认都是 `false`。** 依据写在 `src/core/captions.js` 的注释里：

> 「有一项对照实验研究的正是"**偶尔出现的关键词**"这类字幕增强，方向是关键词突显对学习不利
> （Cojean & Martin 2021，*L'Année psychologique* 121(4):417-442，
> DOI [10.3917/anpsy1.214.0417](https://dx.doi.org/10.3917/anpsy1.214.0417)；
> 我们只核到书目信息与标题，样本量与效应量没有逐条核对）。」

⚠ 注意这条证据的边界：**"字幕有害"没有被证明** —— 被研究的是"字幕之上再加关键词突显"这种增强。
所以默认值是"**逐句字幕照常给，但别做逐词高亮**"，不是"别上字幕"。

```js
captions: true,                    // 默认就是"逐句字幕、不做逐词高亮"
captions: { karaoke: true },       // ← 只有显式写才会"唱到哪亮哪"
```

这条默认值由 **`tools/test-style.mjs` 的断言**守着（`node tools/test-style.mjs` 可复现）——
`karaoke` 在 `src/style/index.js` 与 `src/core/captions.js` 里**曾漂移过一次**
（一处 `true` 一处 `false`，等于四套风格全都默认开了逐词高亮，与上面的研究结论相反），
现在两个文件读同一个默认值，再漂移会被那条断言抓到。

---

## 4. 画面文字栅格（谁占哪一块）

> **数值以 `src/kit/bands.js` 的 `bands()` 为准。** 下面是它在 **1920×1080 + `print` 默认栅格**下的实际输出
> （场景里用 `bandsOf(ctx)` 直接取）。**基准 1920×1080，原点左上，y 向下**（`docs/ENGINE.md` §2.2）。
> 默认值：`pad=120`、`top=92`、`captionLineY=930`、`captionY=964`、`footerLineY=976`、`footerY=1018`、
> `contentBottom=900`、`captionBand=[40,104]`。

| 条带 | `bands()` 键 | x 范围 | y（基线 / 上下沿） | 字号 | 谁画 |
|---|---|---|---|---|---|
| **标题带** | `title` | `120 … 1800` | `top − 36` = **56** | 58 | 场景（片名，通常只在开场几秒） |
| **段标签** | `tag` | `128 … 1800` | `top` = **92** | 30 | 场景（`shotTag()` / `kicker()`） |
| **右上 HUD** | `hudR` | `W×0.62` = **1190 … 1800** | `top + 24` = **116** | 19 | 场景（计量条、读数） |
| **说明条** | `caption` | `128 … 1800` | 横线 **930**，正文 **964**，出处 **1004** | 44（出处 21 / mono） | 场景（`captionNote()`） |
| **页脚** | `foot` | `120 … 1800` | 横线 **976**，正文 **1018** | 22 / mono | 场景（`footer()`） |
| **字幕保留带** | `sub` | `960 ± 365` = **595 … 1325** | **`y0 = 40` … `y1 = 104`** | `style.captions.size`（40–46） | **引擎字幕层独占** |
| —（不是带，但是硬边界） | — | 通栏 | `contentBottom` = **900** | — | 正文（面板/图示）不许越过它 |

**三条规则**：

1. **字幕带是引擎的保留区，别的文字一律不许进。** 这一条与"同一时刻两块文字不占同一区域"是同一条规律（§2）。
   kit 的 **`assertInBand(name, x, y, ctx, size, width)`** 会在压上时**警告**（走 `ctx.warnings`，
   `check` 会打出来；不是抛错 —— 运行时抛会把整段画面变成错帧卡片）。
   ⚠ 它**两个方向都比**（y 与 x）：字幕带在顶部居中、段标签在左上角，y 有重叠、x 没有，那不是冲突
   （第一版只看 y，误报过）。
2. **`contentBottom`（默认 900）= 正文的下边界。** 面板、图示、计量条都不许越过它 ——
   再往下是说明条与页脚的地盘（`GRID_BASE` 注释原文）。
3. **不要把说明条和引擎字幕层同时当"说话的地方"用** —— 说明条只剩一个合法用途：**标注**
   （名词 / 数字 / 出处），而且**越短越好**（`captionNote` 的 18 字上限）。

**为什么字幕带默认在顶部（而不是字幕惯例的底部）** —— 代码里写清楚了
（`src/style/index.js` 的 `GRID_BASE.captionBand` 注释）：

> 引擎自己的元件已经把底部占满了 —— 镜头模板的 `readout` / 签名 / `footer` 都在 y≈990，
> kit 的 `footer()` 在 H-62，说明条 `captionNote()` 在 964 / 1004。往底部再塞一条字幕，
> 就是"两块文字抢同一片区域"。

顶部居中这一带（y 40–104）与左上段标签（x ≥ 128）、右上读数（x ≥ 1190）在**水平方向**也不重叠。
**想要底部字幕**：在风格里覆盖 `grid.captionBand` 与 `captions.position`，**并同时把那一带让出来**
（关掉模板的 readout / 页脚），然后用 `assertInBand()` 核对。
`captions.position: 'bottom'` 的意思是"贴带的下沿、向上生长"，两者都**只在字幕带内**活动。

---

## 5. 静态检查：把"复述"变成可报错的东西

```sh
node tools/lint-narration-dup.mjs                  # 扫 tasks/ 下所有有旁白表的任务
node tools/lint-narration-dup.mjs sodium optifine  # 只扫这几个任务（就写任务名）
node tools/lint-narration-dup.mjs --near           # 额外列出"部分复述"（只提示，不计入退出码）
node tools/lint-narration-dup.mjs --all            # 连注释里的命中一起报（默认跳过注释）
node tools/lint-narration-dup.mjs --json           # 机器可读（退出码恒 0）
```

- **退出码**：有命中 → **1**；干净 → 0；用法/任务名写错 → 2。
  **把它当成交付前的必跑项**（和 `anim check` 同一个层级）—— 命中就是失败，不是"参考建议"。
- **判据**：去掉标点（`\p{P}`）/ 符号（`\p{S}`）/ 空白 / 控制符后，**某一个字符串字面量 == 旁白整句**。
  命中位置必须落在字符串字面量里（画面上的字只可能来自字面量）；
  **注释先被剥掉** —— 场景文件头的分镜注释会逐句引用旁白文案，不剥的话几乎所有任务都会"命中"
  （实测 sodium 会从 12 句涨到 40 句左右，`--all` 就是给你看这个数的）。
- **出处/URL 不算复述**：被命中的那个字面量本身含 `http` / `www.` / 域名时跳过。
  ⚠ 过滤只作用于**字面量**，不作用于整行（否则 `{ text: '…', src: 'Mojira MC-70850 …' }`
  里那 3 条真命中会一起被丢掉）。
- **太短的句子不进判据**（去标点后 < 4 字，例如「快了。」）—— 2、3 个字撞上同形字面量的概率太高；
  这类句子会被单独数出来（`过短跳过`）。
- 它**不检查**"画面信息是否太多" —— 那一条只能靠看图（`AGENTS.md` §10 第 2 条）。

`cull.js:294` 那种 `caption(ctx, { text: cur.text, … })` 是它最该报出来的一种：**把旁白对象直接喂给画面**。
以后要写这一镜的标注，就从 `cur` 里取**名词和数字**，不要取整句。

---

## 6. 平台字幕（上传用）

```sh
node scripts/anim.mjs subs <任务>                  # → out/<任务>/<任务>.srt 与 .ass
node scripts/anim.mjs subs <任务> --per 20         # 每行最多几个字（默认 16）
node scripts/anim.mjs subs <任务> --out out/sub    # 换输出目录（也可写 -o）
node scripts/anim.mjs subs <任务> --name 字幕       # 换文件名前缀
```

- **数据源**：`tasks/<任务>/audio/narration.json`；没有该文件时回退到 `task.config.mjs` 里内联的
  `narration: { lines: [...] }`。两处都没有会报错并提示先跑 `anim say`。
- **断行按 Netflix 简体中文规范**：每行 ≤ **16** 字、最多 **2** 行；先按标点贪心装，
  超过两行时在中点附近找标点切一刀，绝不把收尾标点留在行首。
- **产物落在 `out/<任务>/`**（不再是 `out/_staging/`）—— 这一步现在是 CLI 的一条命令，有版本管理、
  有回归；以前那个脚本会被 `anim clean` 清掉（§1 第 2 条的病根）。
- **无障碍的正解**：上传字幕轨 —— 观众可以开关 / 缩放 / 重设样式 / 自动翻译。
  烧进画面的字幕**一样都做不到**（§2 的来源里写得很清楚）。
- ⚠ **二者选一，别叠两层**：`captions: true` 时字幕**已经烧进画面**了，再上传一份 `.srt` /
  再拿 `.ass` 过一遍 ffmpeg，就是**又一次"同屏两套字幕"** —— 只不过这次一条是烧死的、
  一条是播放器盖上去的。**开了引擎字幕层就不再传 `subs` 的字幕轨；要传字幕轨就关掉引擎字幕层。**

---

## 7. 常见错误（都是真实发生过的）

| # | 错误 | 为什么错 | 正确做法 |
|---|---|---|---|
| 1 | **把说明条当"要点句"写** | 那就是**第二条字幕**，和旁白说的是同一件事，只是位置和字号不同 → 观众看到两条 | 说明条只写**标注**：名词 / 数字 / 单位 / 出处（`captionNote()` 超过 18 字会警告） |
| 2 | **把 `cur.text` 直接喂给说明条** | 结构上保证重复（`tasks/sodium/scenes/cull.js:294`） | 从 `cur` 里取名词与数字，或干脆不写说明条 |
| 3 | **字幕带里放计量条 / 面板** | 字幕带是保留区；两块文字同区 = "好迷糊"的直接来源 | 面板下沿 ≤ `contentBottom`(900)；要精确避开就读 `ctx.captions.band`，或用 `assertInBand()` 自查 |
| 4 | **字幕与画面文字字号接近**（46 vs 44） | 视觉上读成"同一层"，主次没了 | 正文与字幕字号至少差一档；或**直接删掉说明条** |
| 5 | **字幕烧一遍、`.srt` 又传一份** | 播放器再盖一层 | §6 的"二者选一" |
| 6 | **说完就消失** | 观众还在读 | `hold`（默认 **1.06s**）；场景侧对应 `ctx.narration.recent(t, hold)` |
| 7 | **用 `f.lt` 配 `words`** | `words` 是**整片绝对时间** | 配 `f.t`（`AGENTS.md` §6.5） |
| 8 | **手写 `karaoke: true` 却没意识到代价** | 逐词高亮是**负效应**（§3.4），不是"更好看" | 默认别开；开了要说得清为什么 |
| 9 | **渲染期间写文件**（包括改 `narration.json`） | HMR 重载 → 断流 → `video` 报"只渲染了 N/M 帧" | `AGENTS.md` §7：渲染一跑起来，一个文件都别写 |

---

## 8. 交付前自检（字幕相关）

1. `node tools/lint-narration-dup.mjs <任务>` **零命中**（退出码 0）。
2. **画面文字表**（[`docs/SCENE-BRIEF-TEMPLATE.md`](./SCENE-BRIEF-TEMPLATE.md) §6）逐段填过，
   每一段的画面文字都是**标注级**，并与该段旁白做过一次重复检查。
3. `check` 的输出里**没有**「压进字幕保留带」的警告（来自 `assertInBand()`）。
4. 开了 `captions: true` 时：**没有同时上传 `.srt`**（§6）；`karaoke` 保持默认 `false`，除非有明确理由（§3.4）。
5. 说明条（如果还有）**字号与字幕拉开差距**，且**只写标注**（§7 第 1、4 条）。
6. `still` 抽查了**每一段的中间帧**，并且真的用 Read 工具看了图 ——
   重点看**有没有两块文字撞在一起**（`AGENTS.md` §10 第 2 条）。
7. 有旁白的片子：`anim say` 无叠句警告、无 `MAX_STRETCH` 顶格警告（`docs/NARRATION.md` §5）。

---

## 附：外部依据的核实状态（本轮补核过一遍）

1. **Netflix 简体中文 Timed Text Style Guide —— ✅ 已核到原文**（2026-10 逐条打开过
   [这一页](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215986007-Chinese-Simplified-Timed-Text-Style-Guide)）：
   §1「16 characters per line」· §10「Maximum two lines」· §14「Adult programs: Up to 9 characters
   per second」· §7「Forced narratives that are redundant (e.g. identical to onscreen text or
   covered in the dialogue) **must be deleted**」· §18「subtitles should be positioned accordingly
   to avoid overlap with on-screen text… In consecutive events, shift the subtitles altogether to
   the same position. Refrain from jumping up and down」。
   本引擎的字幕层（16 字/行、最多 2 行、底/顶边对齐不上下跳、保留带）就是照这几条做的。
   注：§12「不要用逗号句号、用单个空格」我们**没有**照做（`anim subs` 保留原文标点）——
   那条针对的是翻译字幕的排版习惯，不是硬性可用性要求。
2. **Cojean & Martin 2021（关键词突显）—— 书目已核实，样本量未核实**：
   论文确实存在且题目就是"偶尔出现的关键词"这条路线 ——
   *Reducing the split-attention effect of subtitles during video learning: might the use of
   occasional keywords be an effective solution?*，*L'Année psychologique* 2021, Vol. 121(4), pp.417-442，
   DOI [10.3917/anpsy1.214.0417](https://dx.doi.org/10.3917/anpsy1.214.0417)，
   [HAL 全文 PDF](https://hal.science/hal-03616023v1/file/cojean_martin_2021.pdf)。
   **"12 分钟 / 96 人"那组数字我们没核到**（HAL 落地页只有元数据），所以仓库里已经不再转述它 ——
   引用请以原文为准。
3. **~~`karaoke` 默认值在两个文件里相反~~ —— 已修**（本文第一版抓到的那处漂移）：
   `src/style/index.js` 的 `CAPTIONS_BASE` 现在直接引用 `src/core/captions.js` 的
   `DEFAULT_CAPTION_STYLE`，`karaoke` / `hold` / `fade` 等默认值**只有一处定义**，
   由 `tools/test-style.mjs` 的断言守着。**这条不再是待办。**
4. **`subs` 生成的 `.ass` 具体样式**（字号 / 位置 / 描边）—— 本文不写数字，要看就
   `node scripts/anim.mjs subs <任务>` 之后打开 `out/<任务>/*.ass`（`Alignment=2` 底部居中、
   `MarginV=64`、46px 白字深描边）。

**交叉引用**：[`docs/NARRATION.md`](./NARRATION.md) · [`docs/STYLE.md`](./STYLE.md) ·
[`docs/SCENE-BRIEF-TEMPLATE.md`](./SCENE-BRIEF-TEMPLATE.md) ·
`docs/ENGINE.md` §2.1 / §2.2 / §3.3 / §5.2 · `AGENTS.md` §6.5 / §10 ·
`src/core/captions.js` · `src/core/narration.js` · `src/kit/bands.js` · `src/core/text.js`。
