# 路线图：从「必须写场景代码」到「只写配置」

> 这份文件回答一个具体问题：**要出一支片子，必须改源码吗？**
>
> **进度：A 档与 B 档都已落地。** A 档 = 参数化镜头库，见 `src/shots/`（8 个模板）与 `node scripts/anim.mjs shots`；
> B 档 = `task.config.mjs` 里直接写 `{ type: 'chart', ... }`，由 `build()` 查 `SHOTS` 表分发 ——
> 一个任务可以**只有 `task.config.mjs`、没有 `scenes/`**（教程 `docs/CONFIG-ONLY.md`，完整示例 `tasks/example-config-only/`）。
> **C 档（手写场景）不可替代**：模板覆盖不到的新视觉只能写代码，A/B 档的目的是把精力留给那几段。
> 三档的定义见 §2，实施顺序与勾选状态见 §3。
>
> 最近一轮先把**引擎里的拦路虎**清了一遍（导出色彩空间、多子帧自检、4K、转场库、
> 分段渲染、任务级字体、场景级变换…），现状、证据与验收命令见 `docs/STATUS.md`。
> 那份文件里的东西都已经是"可以依赖的地基"，本文描述的是**再往上一层**的事——这一层现在 A、B 两档都做完了。

---

## 0. 这一轮打好的地基（A/B 档的前提）

做「镜头库 + 配置分发」之前，这些坑必须先填掉，否则模板化只会把坑复制到每个模板里：

| 能力 | 现在有什么 |
|---|---|
| 比例/分辨率 | `--scale 1..4`（真 4K）可用；矢量、文字、后处理在 4K 下都正常 |
| 颜色正确性 | 导出与预览逐像素一致（导出做了 linear→sRGB 编码） |
| 自检 | `check` 每段渲两次（单子帧/多子帧），全黑、过曝、两条路径不一致都会报 |
| 转场 | `src/core/trans.js`：甩镜转场 + 一台摄影机 + 反向落位（模板要用它做默认转场） |
| 镜头级变换 | `ctx.setXform({x,y,scale,rot,anchor,edge})`：整段前景当一组变换 |
| 字体 | `task.fonts`：任务自带字体，不必改全局 |
| 长片渲染 | `video --segments N`：分块 + 拼接（**N = 目标块时长/秒**，不是"等分几份"），已渲好的块自动跳过 |
| 迭代隔离 | `--only a,b` 会把选中的段平移到 0 起点，`-t` 就是段内时间 |
| 口播/旁白 | `anim say` / `anim mix` / `task.narration` / `dur: { vo }` / 词级 karaoke：**镜头长度由旁白反推**、闪避在引擎里、词级时间戳直通 `type.karaoke` |

---

## 1. 现状（截至本文）

出片需要**两层**，其中「画面」这一层现在**大多数时候不用写代码了**：

| 层 | 文件 | 性质 | 不写会怎样 |
|---|---|---|---|
| 编排 | `tasks/<任务>/task.config.mjs` | **纯配置**（尺寸、帧率、配色、音乐、时间线） | 没有片子 |
| 画面（B 档） | 同一个 `task.config.mjs`，时间线里直接写 `{ type: 'chart', … }` | **纯配置**（模板由 `build()` 查 `SHOTS` 表分发） | —— |
| 画面（A 档） | `tasks/<任务>/scenes/*.js` | **取模板**（`shot('chart', {…})` 一行，模板在 `src/shots/`） | 时间线是空的 |
| 画面（C 档，新视觉） | 同上，手写场景模块 | **代码**（模板覆盖不到的想法） | —— |
| 引擎 | `src/core/*` | 代码，但**不需要动** | —— |

也就是说：

- ✅ **一张 `shot(...)` 能做的**：8 个常见镜头（`title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid`）的全部画面，靠参数调数据与文案；参数名写错会**抛错**，不静默忽略。
- ✅ **时间线里直接写 `{ type: 'chart', … }` 能做的（B 档）**：同样这 8 个模板，但**连 `scenes/*.js` 都不需要** —— 一个任务可以只有 `task.config.mjs`。`id` / `dur` 不写有默认值（`dur` 还能写 `{ beat }` / `{ bar }` / `{ vo }`），写错的地方一律抛错。
- ✅ **只改配置能做的**：段落顺序、每段时长、段间重叠（转场）、参数传递、配色、帧率与分辨率、选哪段音乐、任务自带字体。
- ❌ **仍然要写代码的**：模板覆盖不到的新视觉（raymarch 晶格、燃烧的引线…）—— 这是 C 档，不可替代。

**为什么配置之外仍然有「场景」这一层**：配置里 `{ type: 'chart', … }` 的 `chart` 是 `SHOTS` 表的一个键（也就是 `shot('chart')` 的那个名字），所以模板名与参数名就是公开 API；**换一个镜头库没有的视觉想法，仍然得写场景代码**。

**这不是设计缺陷，是当前的抽象层级。** 引擎已经具备做出成片所需的全部渲染能力（矢量、文字排版、GLSL、音频驱动、后处理、运动模糊、转场、4K），A 档把**「镜头模板 + 参数」**这一层做出来了：

```js
// tasks/<任务>/scenes/chart.js（A 档：仍然是这一行）
import { shot } from '../../../src/shots/index.js';
export default shot('chart', { values: [0.3, 0.7, 0.95], title: '这一轮的成绩' });
```

**B 档落地的就是最后这一步——把这一层接进时间线**，于是配置里可以直接写（展开发生在 `build()` 里，由 `src/tasks.js` 按内容选路，见 §2 B 档）：

```js
{ type: 'chart', values: [0.3, 0.7, 0.95], title: '这一轮的成绩', dur: 5 }
```

---

## 2. 三档作者模型（目标形态）

### A 档 · 镜头库 ✅ 已落地

`src/shots/` 已经是仓库里的一层，**8 个模板**：`title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid`。
场景文件退化成「取模板 + 给参数」一行：

```js
// tasks/<任务>/scenes/chart.js —— 改造前 126 行，现在 13 行（其中 6 行是数据数组）
import { shot } from '../../../src/shots/index.js';
export default shot('chart', {
  values: [0.18, 0.34, 0.27, 0.52, 0.44, 0.71, 0.63, 0.88, 0.79, 0.95, 0.86, 1.0],
  title: '每次迭代的最高准确率',
  sub: 'PER-RUN  ·  n = 12  ·  纯代码绘制，无图片素材',
  footer: '确定性渲染 → 任意时刻可重放，任意精度可重渲',
});
```

落地形态：

- **接口**：`shot(name, opts?)` 取模板（返回普通场景对象，与手写场景可混用）、`SHOTS` 名字→工厂表（B 档分发读的就是这张表）、`listShots()` 参数清单；
  每个模板模块另外导出 `xxxShot(opts)` 并挂 `.defaults` / `.meta`。
- **参数写错会抛错**，点名那个参数并列出可用参数；未知模板名也抛错。不静默忽略。
- **CLI**：`node scripts/anim.mjs shots`（列全部）、`node scripts/anim.mjs shots chart`（某个模板的全部参数与默认值）。
- **需要音乐的模板**：`wave` / `pulse` / `grid` 读 `ctx.music`（包络数组 / `music.hits('kick', …)`），
  任务要在 `task.config.mjs` 里配 `audio` 并先跑一次 `analyze`。
- **实现方式**：模板里的绘制代码是从 `tasks/demo/scenes/` 与 `tasks/beat/scenes/` 里已经出过片的场景**逐字搬过来的**，
  所以那两个任务的画面不该变。
- **验收方式**：`node scripts/anim.mjs hashes demo --baseline` / `hashes beat --baseline`，
  判据是没有任何像素差超过 16/255，且平均差 < 0.002。（**不是"应该一样"，是机械证明。**）
  ✅ 已验收：22/22 帧通过（beat 11 帧 max 全 0），实际输出与做法见 `docs/STATUS.md` §14。
- **不动**：引擎、时间线。
- **注意**：`shot()` 返回的仍然是一个普通场景对象，所以「A 档模板」和「手写场景」能混在同一条时间线里——这是关键，用户可以只对没想法的那段用模板。
- **另一条用途：给 B 档当模板表。** B 档的 `{ type: '名字' }` 查的就是 `SHOTS`，模板参数就是配置档节点上除时间线字段以外的那些键；
  两档共用同一份模板、同一份"写错就抛"，所以往 `src/shots/` 加一个模板 = 同时给 A、B 两档加了一个镜头。
- **边界**：`src/shots/` 只放**反复出现、与具体片子无关**的整镜头；某支片子特有的视觉母题留在那个任务的 `scenes/_kit.js` 里。
  要自己有新视觉、又不想自己记「转场 / 背景 / 摄影机」那几件事时，用 `src/kit/shot.js` 的 `makeShot()`
  （**两条平行的路**：模板自己铺满整帧，不要塞进 `makeShot` 里，见 `docs/ENGINE.md` §14.5）。
  规格见 `docs/ENGINE.md` §14。

### B 档 · 真正「只写配置」✅ 已落地

时间线里直接写镜头类型，引擎按 `type` 查表分发（名字就是 `SHOTS` 的键，也就是 `shot('名字')` 的那个名字）：

```js
// tasks/<任务>/task.config.mjs —— 唯一需要编辑的文件（没有任何 import）
export default {
  title: '我的片子',
  width: 1920, height: 1080, fps: 60, scale: 1,
  palette: { signal: '#00e0ff' },
  // audio: './audio/track.mp3',                 // 用 wave/pulse/grid 时要配，并先跑一次 analyze
  timeline: [                                    // 数组、seq([...]) 都行
    { type: 'title',  title: '标题', sub: '副标题', dur: { beat: 8 } },
    { type: 'chart',  values: [0.3, 0.7, 0.95], title: '成绩', dur: 5, id: 'bars' },
    { type: 'outro',  title: '完', dur: 3 },
  ],
};
```

落地形态：

- **判据**（`src/timeline.js` 的 `isConfigNode()`）：节点是**对象**、`type` 是**字符串**、并且**没有 `scene`**。带 `scene` 的照旧走 A/C 档。
- **展开**（同文件的 `configToCut()`）：`build()` 把节点展开成 `cut()` 的形状（`{ kind: 'cut', scene, id, dur, … }`），
  之后的排版（`start` / `dur` / `overlap` / `id` 去重）与手写场景**走同一条路**。
- **参数分流**：`type` `id` `dur` `at` `overlap` `params` `post` `maxSamples` `handlesTransition` `note` `world` `worldPass`
  是**时间线字段**，其余所有键都是**模板参数**（显式写在 `params` 里的优先）。参数名写错 → **抛错并列出可用参数**，不静默吃默认值。
- **默认值**：`id` 不写 = 模板自己的默认段名（重名自动加 `_2`）；`dur` 不写 = 4 秒（与 `cut(scene)` 一致），
  也可以写 `{ beat: n }` / `{ bar: n }` / `{ vo: 'line-id' }`。
- **选路**（`src/tasks.js`）：`timeline` 不是数组（`seq()` / `par()`）→ `build()`；
  **数组里只要有一个配置档节点 → 也走 `build()`**；纯数组、里面全是已经展开好的段 → 保持旧行为，不经过 `build()`。
- **混写会抛错**：同一条时间线里「配置档节点」和「已经展开好的段」（带 `start`/`end` 的那种）不能共存 ——
  后者会被重新排一遍、绝对时间被静默丢掉，所以 `build()` 直接报错，而不是悄悄排错。
- **模板**：8 个（`title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid`）；
  `wave` / `pulse` / `grid` **需要音乐**（配 `audio` + 先跑 `analyze`）；`whip` 自带 `handlesTransition: true`（转场，要给它 `overlap`）。
  查参数：`node scripts/anim.mjs shots` / `node scripts/anim.mjs shots <名字>`。
- **教程与示例**：`docs/CONFIG-ONLY.md`（教程）+ `tasks/example-config-only/`（只有 `task.config.mjs` 的完整示例）。
- **验收方式**（这里只写命令与判据，不代表已经跑过）：
  `node scripts/anim.mjs check example-config-only`、`node scripts/anim.mjs still example-config-only -t …`、
  `node scripts/anim.mjs video example-config-only`；离线那一层是 `node tools/test-timeline-guard.mjs`（纯 JS，不需要 GPU）。
  判据就是 §3 第 2 条那句：**新建一个任务、只编辑 `task.config.mjs`，能出完整 mp4**。
- **风险**：`type` 名字（8 个模板名）与它们的参数名现在就是公开 API；**加模板安全，改模板名/参数名要当破坏性变更处理**。
- **不建议**：为了「纯配置」把参数做成大而全的万能 schema。镜头模板应该**少而专**，需要新视觉时回到 C 档写代码，而不是把模板撑成 DSL。

### C 档 · 手写场景（不可替代）

全新视觉想法（pdoom 那种 raymarching 曲别针晶格、燃烧的引线、钞票团花）**必须写代码**。这是这个引擎真正的价值，也是它区别于「套模板」的地方。A/B 档的目的是**解放精力**——让常见镜头不用重复劳动，把注意力留给真正需要创意的那几段。

---

## 3. 推荐的实施顺序

1. ✅ **抽 A 档镜头库** —— 已落地：`src/shots/`，8 个模板（`title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid`），
   绘制代码从两个示例任务的既有场景**逐字搬运**。
   - 验收（机械判据，不是"看着一样"）：`node scripts/anim.mjs hashes demo --baseline` 与 `hashes beat --baseline`，
     没有任何像素差超过 16/255，且平均差 < 0.002。
2. ✅ **B 档分发已落地**：`build()` 认 `{ type }` 节点（`isConfigNode()` / `configToCut()`，去 `SHOTS` 查表，参数写错就抛），
   `src/tasks.js` 按"数组里有没有配置档节点"选路；`AGENTS.md` 增加了「配置档」一节。
   - 验收（判据）：新建一个任务，**只编辑 `task.config.mjs`**，能出完整 mp4 ——
     `node scripts/anim.mjs check example-config-only`、`node scripts/anim.mjs still example-config-only -t …`、
     `node scripts/anim.mjs video example-config-only`。
3. ✅ **「零代码出片」教程已落地**：`docs/CONFIG-ONLY.md`，配一个完整的 `tasks/example-config-only/`
   （只有 `task.config.mjs`，没有 `scenes/`）。
   - 验收：教程里给的配置能直接跑（同上那三条命令）；离线回归入口 `node tools/test-timeline-guard.mjs`（纯 JS，不需要 GPU）。
4. ✅ 给 CLI 加 `anim.mjs shots`（列出可用镜头模板及其参数）——**这个几乎是必须的**，否则模型不知道有哪些模板可用。
   已落地：`node scripts/anim.mjs shots` / `node scripts/anim.mjs shots chart`。

---

## 4. 现在就能用的路径（按推荐顺序）

目标是「让模型少写代码」时，按这个顺序试：

> **但顺序取决于片子性质**：做信息型/汇报型短片 → 首选 B 档配置；
> 做**有视觉主张**的片子 → 把那 1–2 段关键镜头**优先手写**（C 档），配置档留给过渡与信息段。
> A/B 档的目的是把精力省下来给那几段，不是让整支片子长得像模板。

- **首选：直接写配置（B 档）**。时间线里写 `{ type: '名字', … }`，**只编辑 `task.config.mjs`**，不需要 `scenes/`；
  8 个模板里挑一个，参数看 `node scripts/anim.mjs shots <名字>`，照抄 `tasks/example-config-only/`，
  教程见 `docs/CONFIG-ONLY.md`。
- **第二选择：复制最近的示例场景再改参数**（模板覆盖不到的视觉要走这条路）。`tasks/demo/scenes/chart.js` 这类文件现在只有 13 行
  （其中 6 行是数据数组），而且它调的就是引擎模板——真正要参考的是**参数怎么填**，或者照 `AGENTS.md` §3 的接口手写。
- **把重复镜头提成自己的 helper**：模板覆盖不到、但本片反复出现的母题，在任务目录里建 `scenes/_kit.js`，
  导出几个你自己的 `makeTitle(...)` 之类的函数。（某个片子特有的母题**不该**进 `src/shots/`，见 A 档的边界。）
  做这类 helper 时可以直接复用引擎已经有的东西，不必再手搓：
  - 转场/摄影机/入场位移 → `src/core/trans.js`；
  - 整段前景的平移缩放旋转（视差、整体运镜） → `ctx.setXform(...)`（`docs/ENGINE.md` §3.5）；
  - 「按锚点写一行字」和「整行淡入」这两个高频坑（`TextKit.write` 的 `align` 对每个字生效，
    整行要用 `type.writeLine(..., { anchor })`；`alpha` 的语义是**数值型 = 常量不透明度、
    `[a0,a1]` = 随 `t` 淡入**，只有 `stagger > 0` 或数组型 `alpha` 才走逐字动画
    —— 曾经数值型 `alpha` 会让整个字形**不画**，那是 P0-1，已修，见 `history/STATUS-rounds-1-6.md` §11.1）
    → 参考 `tasks/nekohome/scenes/_kit.js` 的 `put()` / `fade()`。

---

## 5. 附：为什么不做「一句话生成视频」的模型内建路径

引擎刻意不内建「给一句提示词就出片」的接口。原因是这类系统的可靠性来自**确定性 + 可验证**：

- 画面是 `t` 的纯函数 → 能逐帧重放、能只重渲一段、能 4K 重出；
- `check` 能机械地发现「这段全黑」「时间线有空档」「用了 `Math.random`」；
- agent 能出图、看图、再改——**这一步是质量的来源**，而不是提示词。

所以路线图的方向是「减少样板代码」，不是「隐藏渲染过程」。模型仍然应该看得见、能修改每一个参数。
