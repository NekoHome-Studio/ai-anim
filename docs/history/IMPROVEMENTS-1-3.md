# IMPROVEMENTS 第 1–3 轮：已全部落地的改进记录（归档）

> **这是一份历史归档。** 三份记录里的**每一条都已落地并逐条验证** —— 请不要再把它当待办列表读。
> 每一轮的「问题 / 证据 / 改了什么 / 怎么验的 / 当前状态」都能按 § 号查到：
> **§1–§13 在 [`STATUS-rounds-1-6.md`](./STATUS-rounds-1-6.md)，§14–§19 在 [`../STATUS.md`](../STATUS.md)**（见下表）。
> **仍未落地的待办统一在 [`../BACKLOG.md`](../BACKLOG.md)**，本文不含待办。
> 归档保存原文，是因为它记录了**问题是怎么被发现的**：证据链、复现命令、当时的读数。
> ⚠ 这三支片子**不在公开仓库里**，它们是作者本地的成片项目；文中出现的 `tasks/xxx/...` 路径是**证据出处**，不是可点开的文件。
> 与代码不一致时以代码为准。

| 轮次 | 来源任务 | 条数 | 落地状态 | 详细验收在哪一节（§ 号） |
|---|---|---|---|---|
| 第一轮 | `tasks/fidus`（FlexiAtom/fidus 介绍片，60s / 1080p60 / 9 个镜头） | 17 条 | ✅ 全部落地 | §10 |
| 第二轮 | `tasks/beast`（兽音译者介绍片，127.5s / 12 段 / 7650 帧） | 14 条 | ✅ 全部落地 | §11 |
| 第三轮 | `tasks/promo`（引擎自己的宣传片，48 秒一镜到底） | A–F 共 6 条 | ✅ 全部落地 | §16 |

> **注**：表中的 `tasks/xxx/...` 只是**证据出处**，不是可点开的文件（那三支片子都不在公开仓库里）。第二、三轮的记录就在本文对应章节；第 4–5 轮的记录见另一份归档 [`IMPROVEMENTS-4-5.md`](./IMPROVEMENTS-4-5.md)。
> 正文里提到的 `docs/IMPROVEMENTS-2.md` / `-3.md` 这类**旧文件名**，现在就是本文的第二 / 第三部分 —— 完整对照表见 [`README.md`](./README.md) §2。

---

## 第一轮 · tasks/fidus（17 条）

> 原 `docs/IMPROVEMENTS.md`。以下为原文。

> **来源**：某一轮从零把 `tasks/fidus`（FlexiAtom/fidus 介绍片，60s / 1080p60 / 9 个镜头）
> 做到成片。过程中没有改过 `src/`，但**被引擎咬了几口**，也把「每做一支新片子都要重写一遍」
> 的重复劳动摸清楚了。

---

### 0. 一句话结论

**这一轮卡住我的不是渲染能力，是「引擎不把错误说出来」。**

三个最花时间的问题——出片产出一个打不开的 mp4、九个场景里八个静默黑底、成片要人肉抽帧验证——
**没有一个被引擎报错**。它们全都表现为「CLI 说 ✓ / check 说 ✓ / 画面看起来有东西」。

排在最前面的三条都属于同一类：**产物与状态的守门缺失**。修它们的收益不是"更好用"，而是"不再被骗"。

---

### 1. P0：会静默产出废品，先修这三条

#### P0-1 `--idle` 默认 30 秒会把 ffmpeg 背压误判成卡死，提前收工，产出没有 moov 的废文件

**这是本轮最贵的一个坑：浪费了约 40 分钟和两次 1.5GB 的无效渲染。**

**证据链**：

| 位置 | 事实 |
|---|---|
| `scripts/anim.mjs:883` | `const idleLimit = Number(opt('idle', '30'));` —— 默认 30 秒 |
| `scripts/anim.mjs:824-837` | 背压设计：`ff.stdin.write()` 返回 false → `ffBlocked = true` → **停发 ack** |
| `scripts/anim.mjs:870-872` | 页面是「发一帧等一个 ack」的（`inflight: 4`），停发 ack 页面就停下来等 |
| `scripts/anim.mjs:851-852` | `frames++` / `lastFrameAt = Date.now()` 只在**收到帧**时才更新 |
| `scripts/anim.mjs:894-900` | 看门狗的"续命"判据是 `pagePath.sent > lastSent` |
| `scripts/anim.mjs:901-908` | 超过 `idleLimit × 1.5`（=45s）就 `finish()` 收工 |
| `scripts/anim.mjs:923-928` | `finish()` 之后才 `client.close()` + `ff.stdin.end()` |
| `scripts/anim.mjs:654-659` | 分段模式的唯一产物检查是 `r.frames < expect`，而 `r.frames` 是**CLI 自己数的** |

**根因**：ffmpeg 一慢 → 停止 ack → 页面停在等 ack → `frames` 不动、`lastFrameAt` 不更新 →
看门狗判"停滞" → `finish()` → `ff.stdin.end()`。此时 ffmpeg 拿到的是**半截流**，
它不会写 moov atom，产物是个打不开的 mp4。

**关键缺陷**：第 894-900 行那个"续命"条件（页面还在发就续命）**在最需要它的时候恰好失效**——
页面正在等 ack，`sent` 当然不涨。

**复现**：

```sh
node scripts/anim.mjs video fidus --segments 6 --samples 8
# → 第 1 块进度跑到 330/330，然后不再出现 [2/13]，日志开始刷「⚠ 渲染停滞」
ffprobe out/fidus/fidus.parts/part_000_0.00-5.50.mp4
# → [mov,mp4,m4a,...] moov atom not found
# → Invalid data found when processing input
```

**改法**（`--idle 300` 能绕过，但那是让用户替引擎擦屁股）：

1. **让续命判据在背压时也成立**。除了 `pageSent`，还应看：
   - `ff.stdin.writableLength` 是否在下降（还在排水 = 不是卡死）
   - `ffBlocked` 当前状态
   - ffmpeg 进程存活且输出文件还在长大
   任一条成立就续命。
2. **区分两种"没帧"**：背压导致的是「等 ffmpeg 排水」，不是「渲染停滞」。打印后者会把人引向
   错误的排查方向（我第一反应是去查页面崩没崩、WebSocket 断没断，全查错了）。
3. **产物守门（这条独立于 1、2，最该做）**：一块渲完就用 `ffprobe` 验
   `nb_read_frames >= expect`，不合格直接 `die`。现在的检查看的是 CLI 自己的计数，
   在「帧收满了但 ffmpeg 没 finalize」这个场景下**它是假的**。
4. 默认 `idleLimit` 提到 300s（实测 8 子帧下 1080p60 约 1.5 fps，一次背压停顿几十秒很正常）。

**验收**：故意 `--idle 1` 跑 5 秒的片子，**必须报错退出**，而不是留下一个打不开的 mp4。

---

#### P0-2 漏调 `openFrame` → 整段静默黑底，而 `check` 抓不到

**事实**：我写的 9 个场景里 **8 个漏了** `openFrame(ctx, this)`。漏掉的那一段没有共享背景，
底是纯黑（只有 grain 和暗角），**不报任何错**。

**为什么 `check` 抓不到（实测，不是推断）**：把 `tasks/fidus/scenes/principles.js` 的
`openFrame` 临时注释掉再跑 `check`：

| | 有背景 | 无背景 |
|---|---|---|
| `check` 报的亮度 | `principles t=36.00s 单帧 0.094` | `principles t=36.00s 单帧 0.054` |
| `check` 的结论 | ✓ 没有发现问题 | **✓ 没有发现问题** |

**判据是 `one.mean < 0.004`**（`scripts/anim.mjs:469`）。0.054 是它的 **13 倍**——
文字、面板色块、grain 本身就有亮度，足够把"黑底"顶到阈值之上。
（复现：注释掉任一段的 `openFrame`，跑 `node scripts/anim.mjs check fidus`。）

**改法**（建议按这个顺序，前两条才是根治）：

1. **首选：把共享背景提升成引擎的一等公民**，不要让场景作者"记得调用"。
   这是本仓库自己反复讲的原则（`README`/`AGENTS.md`：能用类型和框架封死的，绝不靠约定和注释）。
   形态可以是 `cut(shot, { world })` 或 `task.config.world`，引擎每帧先画背景、再调场景 `render`。
   `docs/ROADMAP.md` 想做的「只写配置出片」同样需要这一层——否则每个镜头模板都得记得调。
2. **次选：给 `check` 加"背景覆盖率"检查**。渲染两帧：一帧正常，一帧**只画背景、跳过场景 render**；
   逐像素比。差异太小 = 场景根本没在背景之上画东西 / 背景没画上。
   比"亮度阈值"可靠得多，因为它比较的是结构而非总量。
   退一步的廉价版：检测帧的四个角/最底一行，是否与该时刻背景 pass 的输出一致。
3. **兜底**：`openFrame` 没被调用时打一条一次性 `console.warn`，`check` 已经在收集浏览器控制台
   （`scripts/anim.mjs:491`），把这条升级成 error。

**验收**：把任意一段的 `openFrame` 注释掉，`check` 必须报错。

---

#### P0-3 CLI 的「✓ 出片成功」不可信：把 ffprobe 验收内置

**证据**：`AGENTS.md` §10 自己写着「用 `ffprobe` 核对 `nb_read_frames == 时长 × fps`
（**别只看 CLI 的 ✓**）」——这等于承认 CLI 的 ✓ 不能信，然后把验收责任推给了人。
这一轮 P0-1 的废品正是这类：分段模式 13 块全部 ✓，第 1 块其实是坏的。

**改法**：`video` 收尾时自动 `ffprobe` 自己的产物，帧数不符就 `die`；`--segments` 每块渲完也验。
（ffprobe 已经在用：`scripts/anim.mjs:697` 附近有 ffmpeg spawn，加一次 probe 成本可忽略。）

**验收**：手工从一个成片里删掉末尾若干帧，`anim.mjs verify`/`video` 必须报错。

---

### 2. P1：每做一支新片子都要重写一遍的东西

#### P1-1 通用镜头工具已经重复写了三遍，应该进 `src/kit/`

**证据**：

| 文件 | 行数 | 内容 |
|---|---|---|
| `tasks/nekohome/scenes/_kit.js` | 431 | `put` `fade` `typed` `cardFrame` `winFrame` `phoneFrame` `bubble` `arrowRight` `flowDots` … 外加过时的 `disp/dcss/dscale` |
| `tasks/fidus/scenes/_kit.js` | ~450 | `put` `fade` `typed` `panel` `fillRect` `kicker` `footer` `marker` `reticle` `enterOffset` `worldPass` `transPass` `cutOut` … |

两份里**语义相同、实现几乎相同**的至少有：`put`（带锚点写行）、`fade`、`typed`、
`panel`/`cardFrame`、`kicker`、`footer`、`enterOffset`、`cutOut`、`transPass`、`worldPass` 的结构。

`AGENTS.md` §2 其实已经给了临时办法（「复制最近的示例场景改参数」「自建 `scenes/_kit.js`」），
但**照着做两次之后，重复就是净损耗了**——而且第二次抄的时候我抄漏了 `openFrame` 的调用
（见 P0-2），正是这种复制的典型失败模式。

**改法**：提炼到 `src/kit/`（引擎自带，不属于任何任务），至少：
`put` / `fade` / `typed` / `panel` / `fillRect` / `kicker` / `footer` / `marker` / `reticle` /
`enterOffset` / `camAt` / `cutOut` / `worldPass` 模板 / `transPass`。

**验收**：`anim.mjs new` 出来的任务的 `_kit.js` 能直接 import 用；
`nekohome` 与 `fidus` 两支片子在删掉重复实现后**逐像素不变**（用 `still` 比对同一 t）。

---

#### P1-2 「全片一层背景 + 一台摄影机 + 一个母题」的配方没有进引擎

**证据**：`src/core/trans.js` 里有 `makeTransitionKit` / `cameraPost` / `enterOffset`，
但 `tasks/nekohome/scenes/_kit.js` 和 `tasks/fidus/scenes/_kit.js` **都各写了一套**
（`worldPass` / `openFrame` / `camAt` / `camDir` / `transPass` / `cutOut`），**谁都没用 trans.js**。

配方本身是从 `nekohome/_kit.js` 顶部的注释里学来的（那是上一轮做完片子总结的），
也就是说：**一条已经被验证两次的最佳实践，目前只存在于一份任务代码的注释里。**

**改法**：二选一，别维持现状。
- 把 `trans.js` 做成真正可用的默认（提供 world 抽象 + 默认 openFrame），或
- 在 `docs/ENGINE.md` / `COOKBOOK.md` 里把它写成正式配方，并说明 `trans.js` 里哪些是半成品。

**验收**：新任务只 import `src/core/trans.js` 就能做出"切镜头时世界不跳"的效果。

---

#### P1-3 `text.js` 的 `alpha` 必须靠 `stagger > 0` 才生效（一行可修）

**证据**：`src/core/text.js:182`

```js
const k = stagger > 0 ? sat((t - at) / dur) : 1;
```

而 `alpha` 用同一个 `k` 插值（`text.js:198-201`）。`stagger = 0` 时 `k` 恒为 1，
**`alpha: [0, 1]` 的起始值永远取不到**，整行直接以终值出现。

**连带后果**：两份 `_kit.js` 都不得不写 `stagger: 1e-4` 这种 hack，并且都要加注释解释
（`tasks/nekohome/scenes/_kit.js:232-236`、`tasks/fidus/scenes/_kit.js` 的 `fade()`）。
每个新任务作者都要重新踩一次。

**改法**：

```js
const k = (stagger > 0 || opts.alpha !== undefined) ? sat((t - at) / dur) : 1;
```

**验收**：`type.write('x', 0, 0, { alpha: [0, 1], t: 0, staggerDur: 1 })` 在 `t=0` 时不可见，
`t>=1` 时完全可见。

---

#### P1-4 `type.write` 的 `align` 是逐字生效的

**证据**：`src/core/text.js:203` 是逐字素簇 `fillText(cl, gx, y)`，所以 `align: 'center'/'right'`
会对**每个字**生效，多字字符串会整体跑偏。

**连带后果**：`nekohome/_kit.js` 的 `put()` 与 `fidus/_kit.js` 的 `put()` 都是为绕开它写的
（先 `measure` 再自己按锚点偏移）。`AGENTS.md` 的正文里**没有**提这条，只在某个任务的
注释里出现。

**改法**：给 `TextKit` 加 `writeLine(text, x, y, { anchor })`（内部先 measure 再偏移）；
至少也要在 `docs/ENGINE.md` 的 `type.write` 参数表里把 `align` 标成「仅对单字有效」。

**验收**：`writeLine('中文标题', 960, 400, { anchor: 'center' })` 视觉居中。

---

#### P1-5 `LineBatch` 没有填充图元；颜色能带 alpha 但没写进文档

**证据**：
- 图元只有 `seg` / `polyline` / `circle` / `rect`（`rect` 是**描边**：`gl.js:960-962` 走 `polyline(..., closed=true)`）/ `tick`。没有填充矩形。
- 颜色支持 alpha：`gl.js:924` `const a = color[3] ?? 1;`，`gl.js:983`
  `blendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, ...)`，片元输出是 premultiplied。
  所以 `lines.seg(x, y, x2, y2, w, [r, g, b, 0.05])` 是**真半透明叠加**。
- 但 `AGENTS.md` §5 只说「颜色是**线性**值，可以 >1 让它发光」，**一个字都没提 alpha**。

**后果**：我这次是读源码才知道能传 4 个分量；在此之前只能用"逐行画横线"凑面板底
（`fillRect` 在 `fidus/_kit.js` 里就是这么实现的，一帧几百条线段）。

**改法**：加 `lines.fillRect(x, y, w, h, color)`（或一个 `RectBatch`）；
`AGENTS.md` / `docs/ENGINE.md` 补上 alpha 说明。

**验收**：`lines.fillRect(0, 0, 100, 100, [1, 1, 1, 0.2])` 得到半透明白块，且只占 1 条批。

---

#### P1-6 `post` 参数没有方向与单位说明，`fade` 尤其反直觉

**证据**：我把收尾镜头写成 `cutOut(f.t, { fade: 1 - prog(t, 2.9, 3.5) })` 想做淡出，
结果**整场都是黑的**。正确语义在：
- `src/core/post.js:38` `@property {number} fade 整帧变黑（0..1）`
- `src/core/post.js:235` `c *= (1.0 - fade);`

即 `fade` 是**黑掉的量**，不是亮度。`AGENTS.md` §5 只列了参数名，没给方向。

**改法**：在 `AGENTS.md` / `docs/ENGINE.md` 的参数表里，给每个后处理参数写清
「0 是什么、1 是什么、单位」——`fade`（黑掉的量）、`zoom`（>1 推近）、
`shake`（像素位移）、`flash`、`exposure`、`shoulder`、`lift`、`tint`。
可以给 `fade` 加个 `toBlack` 别名，减少误读。

**验收**：只看文档就能写对「开场从黑淡入」和「结尾黑下去」，不需要读源码。

---

### 3. P2：诊断效率

#### P2-1 `check` 每段只采一个点，而且正好是正中

**证据**：`scripts/anim.mjs:450` `const mid = (it.start + it.end) / 2;` —— 整段只此一点。
实测输出即 `title t=3.00s`（段是 0–6s）、`evidence1 t=10.00s`（段是 5.5–14.5s）。

**后果**：**入场头 1 秒完全没被采到**，而那正是最容易出问题的地方（文字没出来、
位移方向不对、元素互相压字）。这次我遇到的压字、漏字、准星压字三个问题，
全都是靠自己额外抽了约 20 张 `still` 才发现的，`check` 一次都没报。

**改法**：每段至少采 **15% / 50% / 85%** 三个点；
再加 `check --sheet`，自动把每段中间帧 + 每段切点前后 1 帧拼成接触表写到 `out/<任务>/check/`。

**验收**：人为把某个元素的入场延迟调到段末，`check` 能报出来。

---

#### P2-2 没有「成片 vs 静帧」的自动比对

**证据**：渲染是 t 的纯函数，所以**同一 t 的成片帧与 `still` 输出应当逐像素一致**。
这是个可以自动化的强判据，但现在得手工做：我最后是 `ffmpeg -ss <t> -frames:v 1` 抽 6 帧，
再用 Read 工具一张张看。

**改法**：`node scripts/anim.mjs verify <任务>`：
按段边界（和每段中点）从成片抽帧 → 与 `still` 同 t 的输出逐像素比 → 报最大通道差。
一次性能抓住三类问题：**分段拼接错位 / 帧数不对 / 色彩空间不一致**。

**验收**：手工把 `fidus.parts` 里某一块换成另一段的 mp4，`verify` 必须报差异。

---

#### P2-3 耗时没有预估，`samples=auto` 没有预算

**证据**：实测 1080p60 / 8 子帧约 **1.5 fps**，60 秒片子 **34 分钟**。
CLI 的 ETA 是滚动平均，前 30 帧给的是 7000s，收敛很慢；不设 `--samples` 时
`auto` 在"全片背景一直在动 + 摄影机一直在动"的片子里会持续吃到高子帧。

**改法**：渲之前先跑一小段测速，按段时长给出总预估；
或提供 `--dry-run` 打印「当前参数下预计 N 分钟」。
`samples=auto` 可以接受一个总预算（例如 `--motion-budget`），超了就自动降。

**验收**：`--dry-run` 的预估与实跑相差 < 30%。

---

#### P2-4 `--segments` 的语义与代码注释里的承诺不符

**证据**：
- `scripts/anim.mjs:616` 变量名叫 `minutes`（`const minutes = Number(opt('segments', '4'))`），
  但实际是当**等分份数**用的（`:625-626` `step = (to - from) / Math.max(1, minutes)`）。
- `scripts/anim.mjs:611` 注释承诺「切点落在段边界上而不是等分时间轴，这样**每一块都是完整的镜头**，
  转场不会跨块」——但 `:626` 的等分兜底把这条破坏了。
- 实测：`--segments 6` 产出 **13 块**，其中 `evidence1`（5.5–14.5s）被 `10.00` 切开，
  跨了 `5.50–10.00` 和 `10.00–14.00` 两块。

（注：跨块本身**不会**让画面出错——每块都是独立完整渲染，t 是纯函数，拼接在时间轴上正确。
问题是块数变多 = 浏览器会话与推流握手次数变多 = 总时长变长，以及注释承诺与实际不符。）

**改法**：统一语义并写进 `--help`；段边界优先，等分只在**没有段边界可用的超长区间**里兜底；
块数按目标时长反推而不是等分。

**验收**：`--segments 6` 在一块片子上的实际块数 ≤ 段数 + 2。

---

### 4. 文档与脚手架的**事实错误**（廉价但要紧）

这一类会直接把下一个会话引偏，而且都是几行字的事。

| 位置 | 问题 |
|---|---|
| `scripts/anim.mjs:261` | `new` 生成的 `task.config.mjs` 模板里写着 `scale: 1, // 只能填 1；真 4K（2）目前有已知问题，CLI 会拒绝`。但**同一个文件** `:123-127` 明写「现在 scale 1..4 都可用」。新任务一开局就读到错误的限制。 |
| `docs/HANDOFF.md` | 整篇已过期（顶部自己标了），但 `AGENTS.md` §9 仍把它与 ENGINE/COOKBOOK/ROADMAP/STATUS 并列。建议移进 `docs/history/`（该目录已存在且有先例）或直接删。 |
| `AGENTS.md` §5 | `post` 参数只有名字没有方向（见 P1-6）；`LineBatch` 颜色没提 alpha（见 P1-5）。 |
| `AGENTS.md` §9 | `src/core/` 的说明里没提 `trans.js` 与"自建 `_kit`"的关系，容易让人以为转场库是标准做法（见 P1-2）。 |
| `AGENTS.md` §10 | 「用 ffprobe 核对」这条应当被 P0-3 取代（内置到 CLI），人工步骤可以删。 |

**另外一件值得沉淀的事**：`tasks/<任务>/FACTS.md` 这套「逐句标出处 + 刻意没写的东西 +
画面里哪些是示意」的格式，**已经连续两支片子用了**
（`tasks/nekohome/FACTS.md`、`tasks/fidus/FACTS.md`）。建议：
- 提升成 `docs/FACTS-TEMPLATE.md`，或
- `anim.mjs new` 时顺手生成一份骨架。

对"代表某个团队/项目对外发声"的片子，这套格式是刚需——这次它直接逼出了
「用户给的那张矩阵表和仓库 `docs/spec.md` §2.1 对不上」这个必须发问才能定的问题。

---

### 5. 环境（不是引擎 bug，但会挡住第一次上手）

- **引擎 CLI 必须能 `spawn` 无头 Chrome 并通过管道读它的输出。** 在受限沙箱下
  （本次是 DSH 的 `workspace-write`）会直接 `spawn EPERM`，而报错位置在
  `scripts/anim.mjs:144 openSession`，看不出是权限问题。建议在 `AGENTS.md` §1 加一句前置条件。
- **在 PowerShell 里别用管道接原生程序的输出**：`node scripts/anim.mjs ... | Select-Object`
  与 `ffmpeg -version 2>&1 | ...` 都会被沙箱以"命名管道"为由拒绝。直接跑、让输出自己打印即可。
- 这两条与引擎无关，但下一个会话大概率会先撞上，写在这里省时间。

---

### 6. 建议的动手顺序

| 顺序 | 条目 | 为什么排这里 |
|---|---|---|
| 1 | **P0-3** 内置 ffprobe 验收 | 最小改动（一个函数），立刻让"废品"无处藏身，也是 P0-1 的地基 |
| 2 | **P0-1** `--idle` 背压判据 + 产物守门 | 本轮最贵；有了 P0-3 的探针，改起来有验收 |
| 3 | **P1-3** `text.js` 的 `alpha` 一行修 | 一行，去掉所有新任务都要写的 hack，风险最低 |
| 4 | **P0-2** 共享背景成为一等公民 | 改动最大，但它是 ROADMAP「只写配置」的必经之路；先用 §1 的方案 3 兜底，再上方案 1 |
| 5 | **P1-1** 通用件进 `src/kit/` | 依赖 P0-2 定下来的形状，做完前两条再动 |
| 6 | P1-2 / P1-4 / P1-5 / P1-6 | 契约与文档，可以并行 |
| 7 | P2-1 / P2-2 / P2-3 / P2-4 | 诊断效率，随做随受益 |
| 8 | §4 的文档事实错误 | 廉价，可以顺手带上 |

---

### 7. 本次问题的可复现证据（原始命令与输出）

```sh
# P0-1：--idle 默认值导致的废品（跑约 3 分钟后停在第 1 块）
node scripts/anim.mjs video fidus --segments 6 --samples 8
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of default=nw=1 \
  out/fidus/fidus.parts/part_000_0.00-5.50.mp4
#   [mov,mp4,m4a,3gp,3g2,mj2 @ ...] moov atom not found
#   ...: Invalid data found when processing input

# P0-1：同一个命令加上 --idle 300 就能跑完（13 块全部 ✓，3600 帧，34 分钟）
node scripts/anim.mjs video fidus --segments 6 --samples 8 --idle 300

# P0-2：注释掉 tasks/fidus/scenes/principles.js 里的 openFrame(ctx, this) 之后
node scripts/anim.mjs check fidus
#   principles     t=36.00s  单帧 0.054  多子帧 0.054（24 子帧）   ← 有背景时是 0.094
#   ✓ 没有发现问题（单子帧与多子帧两条路径都验过了）              ← 抓不到

# 成片验收（这一条是对的，只是需要人记得做）
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=width,height,r_frame_rate,nb_read_frames,duration \
  -of default=nw=1 out/fidus/fidus.mp4
#   width=1920  height=1080  r_frame_rate=60/1  duration=60.000000  nb_read_frames=3600
```

另外两条本轮实测的性能基线，供 P2-3 参考：

- 1080p60、8 子帧、`--scale 1`：**约 1.5 fps**（60 秒片子 = 3600 帧 ≈ 34 分钟）
- `check fidus`（9 段 × 单/多子帧各一次）：**约 11 秒**

---

## 第二轮 · tasks/beast（14 条）

> 原 `docs/IMPROVEMENTS-2.md`。以下为原文。

> **来源**：从零把 `tasks/beast` 做到成片，两版：v1 63s/12 段无旁白 → v2 127.5s/12 段带 TTS 旁白，
> 7650 帧、三段并行渲染、自建拼接。过程中**没有改过 `src/`**（只给 `scripts/anim.mjs` 加了一个 `--vcodec`），
> 但被引擎咬了十几口。

---

### 📋 14 条落地状态（第三轮）

**逐条的状态、改法与可复现的验收证据都在 [`STATUS-rounds-1-6.md`](./STATUS-rounds-1-6.md) §11** ——
§11.0 是同一张表，此后多数编号还有一节详情。下面这张是照它抄的，
只有三处不同：P1-5 更新成"A / B / C 三档都已落地"（B/C 在第四轮落地，逐条证据在 **§12.2**）、
它的验收改指 §11.15 的回归清单（§11.0 原表写的 §11.10 是 P1-4 那一节），以及 P2-3 的节号订正成 §11.13。

| 编号 | 问题 | 状态 | 验收方式 |
|---|---|---|---|
| P0-1 | 数值型 `alpha` 让整个字形**不画** | ✅ 修 | `node scripts/anim.mjs probe-alpha _calib`（6 项全 PASS） |
| P0-2 | `seq()` 接受伪节点，静默退化成假时间线 | ✅ 修 | `node tools/test-timeline-guard.mjs`（16 项全 PASS） |
| P0-3 | 场景抛异常 → 整帧暗红，`check` 全绿 | ✅ 修 | `node tools/smoke-scene-error.mjs`（10 项全 PASS） |
| P1-1 | 分块复用不校验渲染参数 | ✅ 修 | 改 `--samples` 后重跑 → 全部重渲并点名原因 |
| P1-2 | "跨会话不确定性" | ✅ **根因查明：不是引擎的问题，是探针取时错了** | 见 §11.6；`tools/probe-determinism.mjs` |
| P1-3 | `verify` 取时 / 抽帧口径在帧边界上差一帧 | ✅ 修 | 正例全过 + 反例全拦（§11.7） |
| P1-4 | `analyze` 从**混音**里测 bpm，被人声带偏 | ✅ 修 | `audio: { music, vo, mix }`；beast 136 → 120 bpm |
| P1-5 | 口播 / 旁白层缺失 | ✅ **A / B / C 三档都已落地**（A 档的回归见 §11.15） | `node tools/test-say.mjs`、`node tools/test-karaoke.mjs`、`node tools/test-narration.mjs`；`docs/NARRATION.md` §4 / §5 |
| P2-1 | 并行渲染要手工切区间 + 手工拼接 | ✅ 修 `--parallel N` | `node tools/test-parallel.mjs demo 6`（6 项全 PASS） |
| P2-2 | 渲染期间不能碰工作区，连写文档也不行 | ✅ 修 | `node tools/smoke-worktree-edit.mjs`（8 项全 PASS） |
| P2-3 | `prog()` 的 easing 名写错静默退化成 linear | ✅ 修 | `node tools/test-easing-warn.mjs`（7 项全 PASS）；见 §11.13 |
| P2-4 | `check` 与 `gpu` 的 GPU 串不一致 | ✅ 修 | 两条命令现在都打 ANGLE 全串（§11.13） |
| P2-5 | `out/<任务>/` 堆 GB 级中间产物，无清理提示 | ✅ 修 `anim clean` | `clean demo --dry-run` 列出 423.3 MB |
| P2-6 | `video --out/-o` 没写进 `--help` | ✅ 修 | `node scripts/anim.mjs help` |

> **B 档 / C 档的入口**：`node scripts/anim.mjs say <任务>` 与 `node scripts/anim.mjs mix <任务>`
> （实现在 `scripts/lib/say.mjs` / `scripts/lib/mix.mjs`，CLI 侧、不进浏览器）。

---

### 0. 一句话结论

> 这一轮最贵的三个坑全都属于同一类：**引擎在出错时不响** ——
> 静默吞掉字形、静默接受写错的时间线、静默把异常画成一整帧错误底色，
> 而 `check` 三次都报「没有发现问题」。**先做 §1 的三条，它们能省下后面所有人的排查时间。**

---

### 1. P0：静默失败 —— 会产出「看起来正常」的坏东西

#### P0-1 `type.write` / `writeLine` 的**数值型 `alpha` 会让整个字形不画**（不是画成透明）

- **症状**：画面上一整块内容凭空消失，其余部分完全正常。
- **证据**：`tasks/beast` 第一版里「字典」那 4 个大格与「兽语卡」里 16 个字全没了，
  而 `check` 报该段亮度 0.084 / 0.112、单子帧与多子帧一致 —— **全过**。
  根因在 `src/core/text.js:186`：`const animated = stagger > 0 || opts.alpha !== undefined;`
  → `k = sat((t - at) / dur)`，`opts.t` 缺省 0 ⇒ `k = 0` ⇒ 第 190 行 `if (k <= 0) continue;`
  ⇒ 这一笔**直接跳过**。传 `alpha: 1` 也一样跳过，与「alpha = 1 应该不透明」的直觉完全相反。
- **复现**：`ctx.type.writeLine('字', x, y, { alpha: 1, color: css(P.bone) })` → 什么都不画；
  去掉 `alpha` 就正常。
- **修法**（任选，推荐前两条一起）：
  1. `animated` 只在 `Array.isArray(opts.alpha) || stagger > 0` 时为真；数值型 alpha 直接当常量乘进 `al`；
  2. `alpha` 为数值且未给 `t` 时，不要走 `k<=0` 的跳过分支（跳过只在真的做了逐字动画时才有意义）；
  3. 顺手把 `layout.js` 的 `fade()` 与文档里的说法对齐（现在文档只说「整行淡入用 fade()」，没说数值 alpha 会消失）。
- **验收**：`node scripts/anim.mjs probe-alpha <任务>` 增加一个「数值型 alpha」用例；
  或直接加单测：`write('x', 0, 0, { alpha: 0.5 })` 在 `t` 缺省时必须画出**半透明**的 x。

#### P0-2 `seq()` 会接受「不是时间线节点」的对象，静默退化成一条假时间线

- **症状**：`check` 说一切正常，但片长/段名全是错的。
- **证据**：我写了个助手 `const seg = (id) => ({ scene: SHOT[id], opt: {...} })`，
  忘了让它返回 `cut(scene, opt)`。`seq([...])` **照单全收**，引擎把它当成 12 段匿名场景：
  `check` 输出 `时长 48.00s`、段名 `scene / scene_2 / … / scene_12`（每段默认 4 秒）、
  末尾照样 `✓ 没有发现问题`。真实时间线是 127.5s、12 个具名段。
- **复现**：把 `tasks/beast/task.config.mjs` 里 `seg()` 的 `return cut(SHOT[id], {...})` 改成
  `return { scene: SHOT[id], opt: {...} }`，跑 `node scripts/anim.mjs check beast`。
- **修法**：`src/timeline.js` 的 `seq()` / `cut()` 对没有合法形状的项**直接抛错**，
  错误信息要指路：`「这不是时间线节点：{scene, opt}。你是不是忘了调 cut()？」`；
  同时把「段名 + 时长」打印成一行，方便扫一眼对不对（现在只有 `check` 头部一行汇总）。
- **验收**：故意传伪节点 → 立刻抛错；正常 `cut()` 不受影响。

#### P0-3 场景 `draw()` 抛异常 → 整帧**错误底色**，而 `check` 报「没有发现问题」

- **症状**：某一段从某一刻起整屏变成一种纯色（本例是暗红），文字与图形全无，`check` 全绿。
- **证据**：`tasks/beast/scenes/outro.js` 里 `const slot = ctx.params?.slot` 遮蔽了
  `_kit.js` 的 `slot()` 画格子函数 → 包裹卡片一开始画就 `TypeError`。
  表现：`out/beast/sheet_116-127.5.png` 里 121.2s 之后整屏暗红（实测像素 `(112,28,28)`、
  角上 `(93,0,0)`），而 `check` 对另一个时刻采样得到 0.078 / 0.118 / 0.118、
  「背景守门」通过、**没有任何控制台错误打印**、单帧与多子帧也一致。
- **复现**：`node scripts/anim.mjs still beast -t 3.8 --only outro --samples 1`（修好前是暗红）。
- **修法**：
  1. 场景抛错必须**冒泡成 CLI 的硬错误**并点名「任务 / 段名 / 帧号 / 异常栈」，别只画一帧糊弄过去；
  2. `check` 把捕获到的 `pageerror` / console error 当**失败**（现在只在末尾附注，容易漏读）；
  3. 可选但很有用：错误帧上画一个明显的角标（或干脆涂成固定色 + HUD 文字），让人一眼看出
     「这不是画面，这是崩了」。
- **验收**：在任意场景 `render()` 里 `throw new Error('boom')` → `check` 必须失败并点名该段；
  `video` 必须不产出文件（或产出后报错并删除）。

---

### 2. P1：验收与一致性

#### P1-1 `--segments` 复用分块时**不校验渲染参数**，会拿旧参数的分块拼进新片

- **症状**：改了 `--samples` / `--vcodec` / `--crf` 再跑，CLI 秒完成并报「✓ 出片成功」，
  其实那些块是上一次渲的。**我因此差点得出错误结论**：做 x264 vs NVENC 对照时，
  第二次运行直接复用了第一次的分块，耗时几乎为 0，看起来像「NVENC 快得离谱」。
- **证据**：`out/<task>/<task>.parts/` 下的分块只按时间区间命名；
  日志里的 `[2/12] 5.00–10.00s 300 帧 …` 与「已渲好的块自动复用」没有任何参数说明。
- **复现**：`video <任务> --segments 5 --samples 8 --from 40 --to 45`（跑完）→
  立刻 `video <任务> --segments 5 --samples 8 --vcodec h264_nvenc --from 40 --to 45`（秒完成）。
- **修法**：分块文件名（或旁边的 `.json`）里带上渲染参数的指纹：
  `samples / shutter / scale / vcodec / crf|cq / 时间线文件 mtime / 引擎版本`；
  不匹配就重渲。至少要在开始前打印一行：`复用 3 块（samples=8, libx264, 12:34 渲），重渲 9 块`。
- **验收**：改任一参数后重跑 → 必须全部重渲并在日志里说明原因。

#### P1-2 同一时刻、**从不同起点开渲**结果不同（跨会话不确定性）

> ⚠⚠ **本条已被推翻，不要再按它去改引擎。**
> 第三轮用"绕开编码器"的判据（把推给 ffmpeg 的**原始 RGBA** 落盘，再在另一个会话渲同一时刻，
> **逐字节比**）重做了这个实验：**60/60 帧逐字节相同**；同一条命令跑两遍也逐字节相同。
> "34.8 dB"的真实来源是**探针取时差了半帧** —— 成片在每帧**起点** `t = N/fps` 渲染，
> 而当年的验收探针按"帧中心"取时。详见 `docs/STATUS.md` §11.6 / §11.7。
> 下面保留原始描述，只为说明"当时为什么会这么判断"。

- **症状**：`verify` 的「单帧重渲 vs 成片抽帧」长期只能部分通过；同一 t 的画面在不同会话里差一点点。
- **证据（全部为本机实测）**：
  - `video --from 110 --to 112 --samples 8 --vcodec h264_nvenc --cq 19` **跑两遍 → PSNR = ∞**
    （逐比特相同，文件大小都一样 13,732,447 B）→ 同一会话起点下是确定性的；
  - 成片（part3 从 85s 起渲）的第 6600–6719 帧 vs 从 110s 起渲的同一窗口 → **34.8 dB**；
  - 从 105s 起渲（预热 5 秒）再取同一窗口 → **33.2 dB**（所以不是简单的"预热不够"）；
  - 差异是**均匀的颗粒级噪声 + 极淡的元素轮廓**（`docs/PERF.md` §4 有放大差异图），
    `>32` 的像素占比 < 1%。
- **影响**：`verify` 这种「单帧重渲」的验收方式对本片只能部分通过；文档里「每帧是 t 的纯函数」
  这句话在**像素层面**不成立（只在同一会话起点内成立）。
- **待验证的怀疑**：跨帧状态藏在运动模糊的自适应采样（`tol` / 运动估计）或 post 的某种平滑里；
  也可能与音频解码位置有关（`f.a` / `f.beat` 的会话内推进 vs seek）。
  **建议先做实验**：在 `engine.render()` 里把「与上一帧有关的量」全部打日志（子帧位置、tol、
  音频特征、seed），同一 t 分别从 85s 起和从 110s 起渲一次，看哪个量不同。
- **修法**：找到并消除跨帧依赖；若确有必要（例如自适应子帧确实要看历史），
  给 CLI 一个显式的 `--warmup <秒>` 并在文档里写清「确定性 = 同一起点内」。
- **验收**：`video --from 110 --to 112` 与「从 85s 起渲到 112s 的同一窗口」**PSNR = ∞**。

#### P1-3 `verify` 的取时 / 抽帧口径在帧边界上会差一帧，导致误报 ✗

- **症状**：`verify` 报一堆 ✗，但抽帧看图两张一模一样（差异全是颗粒，`mean≈10`、`>16` 约 25%）。
- **证据**：三个因素叠加 ——
  1. 引擎算帧号是 `src/core/engine.js:371` 的 `idx = Math.floor(t * this.fps + 1e-6)`，
     而 `verify` 的探针时间写成 6 位小数：`t = 6.133333` → `6.133333*60 = 367.99998` → `idx = 367`，
     成片那一帧是 368 → 颗粒图案不同（`frameSeed(idx)`，`src/core/scene.js:89`）；
  2. 抽帧窗口 `scripts/anim.mjs` 的 `ffmpegFrame()`：`select='between(t, t-0.5/fps, t+0.5/fps)'`
     是**闭区间**，且用 `toFixed(6)` 写进 filter 字符串，帧边界上会同时框住前后两帧；
  3. 默认探针里有 `it.start - 1/fps`（切点前一帧）——正好是帧边界。
- **实测对照**：本片 24 个探针（帧边界 +0.0005）→ 9 个 ✓ / 15 个 ✗，✗ 的全部是**移动中的画面**；
  同一帧用「帧号」抽出来比对则完全对得上（成片 vs 分块拼接 = PSNR ∞）。
- **修法**：`verify` 改成**按帧号抽帧**（`select=eq(n\,N)`，N 由 `round(t*fps)` 得来），
  参考帧也用同一个 `idx` 渲；探针时间统一抬到帧内（`+0.5/fps` 更稳）。
- **验收**：`verify <任务> --samples 8` 在本片上应当全过（或用 `--times` 传帧内时刻全过）。

#### P1-4 `analyze` 从**混音**里测 bpm，被人声带偏

- **症状**：`f.beat` / `f.beatPhase` 是错的（本片实测 136bpm，而配乐实际 96bpm）。
- **证据**：`node scripts/anim.mjs analyze beast` 输出 `bpm 136.0  289 拍`（音轨是旁白+闪避后的混音）；
  配乐床是 96bpm。我最后把母题带的呼吸写死 0.625s（=96bpm 一拍），**不能跟 `f.beat`**。
- **修法**：`task.audio` 允许 `{ music, vo, mix }`（`music` 只用来分析节拍，`mix` 交给 ffmpeg），
  或 `analyze --beat-from music.mp3`。
  > 🔧 本轮落地的是**第一种**（见 `STATUS.md` §11.10）；`analyze --beat-from` 这个写法
  > **没有实现**，别照着打（`anim say` 取一拍用的是另一套优先级，见 `docs/NARRATION.md` §4 B 档）。
- **验收**：带旁白的片子 `analyze` 出来的 bpm 与配乐一致。

#### P1-5 口播 / 旁白这一层完全缺失（这一轮最大的能力缺口）

- **症状**：想做「有人讲解」的片子，必须把 TTS、测长、闪避、混音全在引擎外面手搓，
  最后塞回唯一的那条 `audio` 里；镜头长度也只能在外部反推。
- **证据与完整方案**：见 [`docs/NARRATION.md`](../NARRATION.md)（含这一轮的可复制做法、
  三个真实后果、A/B/C 三档补法与验收标准）。**摘要**：引擎只有「一条音轨」的抽象 ——
  没有口播轨、没有闪避（ducking）、没有句子级时间轴、没有 TTS 入口、没有字幕时轴生成。
- **最小可用（A 档）**：`task.audio = { music, vo, mix }` + `task.narration`（句子表：
  文本/起点/时长）→ 场景里 `ctx.narration.at(t)`；`cut(scene, { dur: { vo: 'line-id' } })`。
- **验收**：`docs/NARRATION.md` §5 列了 5 条（无叠句警告、每段尾留白 ≥1.0s、说话占比打印、
  换音色不重渲画面、帧数=时长×fps）。
  > 🔧 本轮复核：第 4 条判据（"换音色画面哈希不变"）**是错的、已改写** ——
  > 与音色解耦的是代码结构，不是片长；准确说法见 `docs/NARRATION.md` §5.4。
  > B / C 两档的落地情况见本文顶部的 📋 状态表。

---

### 3. P2：效率与工作流

#### P2-1 并行渲染要手工切区间 + 手工拼接，而且拼接有坑

- **实测收益**：2 个进程 1.81×、3 个进程 2.3×（本片 7650 帧：串行 59 分钟 → 26.1 分钟）。
  瓶颈在浏览器那侧（`samples=1` 就 214ms/帧），一个进程吃不满机器 —— 详见 [`docs/PERF.md`](../PERF.md)。
- **坑**：切点**只能落在「下一段转场已经结束」的时刻**（否则这一段开头拿不到上一帧，甩镜缺一半）；
  自己用 `ffmpeg -f concat` 拼 mp4 时**必须加 `-copyts`**，否则整条视频被推后 `+0.022982s`
  （B 帧 CTS 偏移），帧号与时间戳错位。**CLI 内部的分块拼接没这个问题**（它先把每块转成
  MPEG-TS 再拼；实测 `--segments` 出的成片首帧 PTS = 0.000000）。
- **修法**：`video --parallel N`（自动选合法切点、起 N 个进程、完成后自己拼好并复核）；
  退一步至少给 `anim cuts <任务>`（打印所有合法切点）与 `anim concat <任务> <块…>`
  （内部走 ts 转换，别让人自己写 ffmpeg）。同时把 `-copyts` 这条写进文档。
- **验收**：`--parallel 3` 出的成片与串行版**帧数一致**，抽帧比对一致。

#### P2-2 渲染期间不能碰工作区（HMR 会把推帧打断），连写文档也不行

- **症状**：长渲染（本机 25–60 分钟）期间只能干等；连往 `docs/` 写一个 markdown 都不敢。
- **证据**：`vite.config.mjs` 的 `watch.ignored` 目前只含 `**/out/**`；
  历史上改 `tasks/` 下文件把 2880 帧截成 152 帧（见 `MEMORY` / 第一轮 P0 系列）。
- **修法**：把 `watch.ignored` 放宽到**确定不在模块图里**的文件：`docs/**`、`**/*.md`、
  `tasks/*/audio/**`、`tasks/*/FACTS.md`、`tasks/*/SCRIPT.md`、`**/*.analysis.json`；
  或者更稳：渲染时 CLI 直接监听「模块图内文件」的 mtime，变了就报错而不是让 HMR 静默断流。
- **验收**：渲染中往 `docs/` 写文件 → 推帧不断；改 `tasks/*/scenes/*.js` → CLI 立刻报错并停止。
- **✅ 已落地，但结论要收紧**（第三轮实测）：放宽 `watch.ignored` 之后，写 `docs/`、`*.md`、
  音频、`*.analysis.json` 确实是安全的（`tools/smoke-worktree-edit.mjs` 8 项全 PASS）；
  但**在 `src/`、`scripts/`、`tools/` 里写文件仍会打断正在跑的渲染** —— 私有 Vite 的文件监听
  会去 watch 编辑器/工具产生的临时文件（`.xxx.tmpdir/…tmp`），撞上 `EBUSY` 直接让 Vite 进程崩掉，
  渲染报 `net::ERR_CONNECTION_REFUSED`。实测：一个回归项就是这么假失败的。
  → 所以结论是：**渲染期间只**能写 `watch.ignored` 里列的那几类文件
  （`**/*.md`、`docs/**`、`tasks/*/audio/**`、`tasks/*/fonts/**`、`FACTS.md`、`SCRIPT.md`、
  `timing.{json,mjs}`、`**/*.analysis.json`、`**/*.rgba`、`**/*.yuv`）；
  `src/**`、`tasks/*/scenes/**`、`task.config.mjs` **故意没排除**，改了就该让渲染停下来报错。

#### P2-3 `prog()` 的 easing 名写错会静默退化成 linear

- **证据**：`src/core/util.js:117` `ease[name] ?? ease.linear`。
- **修法**：名字不认识时 `console.warn` 一次（带调用处的近似信息，例如传进来的字符串），
  production 也保留但去重。
- **验收**：`prog(t, 0, 1, 'outCubicc')` 会打一条警告。

#### P2-4 诊断信息不一致：`check` 有时打印 `GPU: WebKit WebGL`

- **证据**：`check beast` 打印 `GPU: WebKit WebGL`（拿不到 unmasked renderer），
  而同机的 `anim gpu beast` 能拿到 `ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 …, D3D11)`。
- **修法**：统一走 `anim gpu` 那条获取路径；拿不到就明确写「（unmasked renderer 不可用）」。
- **验收**：两条命令输出的 GPU 串一致。

#### P2-5 `out/<任务>/` 会堆 GB 级中间产物，没有清理提示

- **证据**：本片 `out/beast/` 峰值 ≈ 3.8 GB（`beast.parts/`）+ 650 MB 成片 + 284 MB 分发版
  + 大量 `stills/`（86 MB）+ 我手工产生的 `*.yuv`（每个 400 MB）。
- **修法**：`video` 结束时打印「中间产物 X MB，保留以便断点续渲；`anim clean <任务> --parts` 可删」，
  并提供 `anim clean` 命令（默认只删 `*.yuv` / 分块；`--all` 才动成片）。
- **验收**：`anim clean beast` 后 `out/beast/` 只剩成片与 stills。

#### P2-6 `video --out/-o` 没写进 `--help`（小）

- `node scripts/anim.mjs video --out out/x.mp4` 是**可用**的（`scripts/anim.mjs` 的 `cmdVideo` 支持），
  但 usage 里没列；并行渲染与对照实验都要用它。

---

### 4. 本轮确认**没问题**的（别去"修"它）

- **同一起点下逐比特可复现**：同一条 `video` 命令跑两遍 → PSNR = ∞（这才是引擎最强的那条承诺，
  只是它的边界比文档写的窄，见 P1-2）。
- **CLI 内部的分块拼接是对的**：`--segments` 出的成片首帧 PTS = 0.000000、帧距严格 1/60。
- **`check` 的背景守门有效**：11 个交叠段全部点名通过；亮度统计能反映「这段画了东西」的量级
  （正常 0.07–0.15）。
- **`--vcodec h264_nvenc --cq 19` 已加好**（这一轮加的），可用；`--samples` 的边际成本约 29ms/子帧，
  降 samples 是最省时间的旋钮。
- **`ease`/`prog`/`rng`/`gl.clear`/`LineBatch`/`comp.draw` 的语义本轮没有遇到坑**。

---

### 5. 复现命令汇总（本机 Windows / PowerShell）

```powershell
# P0-1：数值型 alpha 吞字形（改前：字典那 4 个大格是空的）
node scripts/anim.mjs still beast -t 18.5 --samples 1

# P0-2：伪时间线被静默接受（改前：时长 48s、段名 scene/scene_2/…）
node scripts/anim.mjs check beast

# P0-3：场景抛错 → 整帧暗红，而 check 全绿（改前）
node scripts/anim.mjs still beast -t 3.8 --only outro --samples 1
node scripts/anim.mjs sheet beast --from 116 --to 127.5 -n 12 --samples 1

# P1-2：同一起点确定性 vs 跨起点不确定性
node scripts/anim.mjs video beast --from 110 --to 112 --samples 8 --vcodec h264_nvenc --cq 19 --out out/beast/a.mp4
node scripts/anim.mjs video beast --from 110 --to 112 --samples 8 --vcodec h264_nvenc --cq 19 --out out/beast/b.mp4
#   → a 与 b 逐比特相同；再与成片同窗口比 → 约 35 dB

# P1-3：verify 的帧边界陷阱
node scripts/anim.mjs verify beast --samples 8            # 默认探针：部分 ✗
node scripts/anim.mjs verify beast --samples 8 --times 3.067167,11.4005,26.067167   # 帧内时刻：✓

# P2-1：拼接必须 -copyts（不带时首帧 PTS = 0.022982）
ffprobe -v error -select_streams v -show_entries frame=pts_time -of csv=p=0 -read_intervals "%+#3" out/beast/beast.mp4
```

---

### 6. 建议的动手顺序

> **第三轮已全部做完**（14 条，含 P1-5 的 B / C 档）。下面保留原始的排序理由。
> 剩下的收尾是 `STATUS.md` §11.16 里列的那几条（回归复跑、beast 要不要按正确的拍子重出片）；
> 文档同步里 `IMPROVEMENTS-2.md` / `NARRATION.md` / `ROADMAP.md` 这三份本轮已同步，
> `AGENTS.md` 那部分见 `STATUS.md` §11.16 第 6 条。

1. **§1 三条 P0**（一天内能做完，收益最大：从此错误会响）；
2. **P1-3 verify 帧号化**（验收工具不可信，后面所有改动都没法验）；
3. **P1-1 分块参数指纹**（防止再被"复用"骗一次）；
4. **P2-2 HMR 放宽 + P2-1 `--parallel`**（直接决定下一支片子要花 26 分钟还是 60 分钟）；
5. **P1-2 跨会话不确定性的根因**（需要实验，可能要动 motion blur 的自适应采样）；
6. **P1-4 / P1-5 音频与口播层**（A 档最小可用先落地，B 档 TTS 可以下一轮）。

---

## 第三轮 · tasks/promo（A–F 共 6 条）

> 原 `docs/IMPROVEMENTS-3.md`。以下为原文。

> 这一轮的来源：做引擎自己的宣传片 `tasks/promo`（48 秒一镜到底）时，**用户看完成片说
> 「感觉镜头会抖动，最后那里都快和地震一样了」**。下面是查因的结果。
>
> 结论先说：**触发它的是那一轮场景代码里的一个设计错误，但那条错路是引擎自己示范出来的** ——
> 引擎里同时存在两套互相矛盾的"手持抖动"写法，而且**没有任何一处文档说它们不一样**。
> 所以这份文档按"引擎侧该改什么"来写；`tasks/promo` 那边已经改掉并重出片（见 §4）。

---

### 1. 现象与实测

用户的原话是「镜头会抖动……最后那里都快和地震一样了」。这句话是**可量化的**：
把成片里相邻两帧做互相关，量出来的整体位移就是"抖"的客观读数。

```sh
node out/_probe/jitter.mjs out/promo/promo.mp4 46.5 8     # 收尾 8 帧
```

| 量 | 实测（修之前） | 说明 |
|---|---|---|
| 逐帧整体位移 | **±2 – 8 px**，RMS **3.64 px** | 正常运镜在这里应该接近 0（摄影机 42s 后已经停住） |
| 相邻两帧位移之差 | 最大 **13 px** | 这是"高频成分"：位移本身在帧间来回跳 |
| 设计值 `\|shake\|` | 最大 **4.99 px** | 场景里写死的后处理位移 |
| 设计值逐帧变化 | 最大 **10.19 px**，RMS 3.03 px | **变化量 ≈ 幅度** = 白噪声的指纹 |

两条读数（实拍 3.64 / 设计 3.03）在同一个量级、同一段时间 —— 现场与设计对得上，
所以根源就是后处理里的 `shake`，不是编码、不是引擎的采样或合成。

---

### 2. 根因：逐帧白噪声 + 只升不降的幅度

`tasks/promo/scenes/_world.js` 的第一版（**照抄 `tasks/pdoom-lab/scenes/_world.js` 的 `camPost()`**）：

```js
const amp = 1.6 + 3.4 * prog(f.t, 26, 36, 'inOutCubic');   // 26→36s 升到 5.0px
return {
  shake: [(hash2(f.idx, 11) - 0.5) * 2 * amp,              // ← 每帧一个**新的随机数**
          (hash2(f.idx, 27) - 0.5) * 2 * amp * 0.6],
  ...extra,
};
```

两个问题叠在一起：

1. **它是白噪声**：`hash2(f.idx, …)` 让每一帧跳到一个**新的随机位置**，与上一帧无关。
   60fps 下这就是**高频振动**（每 16.7ms 跳一次 ±5px）。真实的"手持"是**低频、连续**的
   位移（0.5–2Hz 的慢漂移），眼睛认得出差别 —— 前者像地震，后者像有人扶着机器。
2. **幅度只升不降**：`prog(t, 26, 36)` 在 36s 就到顶，之后**一直是 5px**。
   而 42–48s 摄影机已经刹住（`V_KEYS` 的末速是 0），画面上**只剩这个抖动** ——
   于是"越到后面越像地震"，正好对应用户的观感。

---

### 3. 引擎侧的问题（这份文档真正要反馈的东西）

「逐帧白噪声当手持」**不是这一轮发明的**，它是仓库里已经存在的一条路，而且**是引擎自己推荐的**：

| 位置 | 写法 | 性质 |
|---|---|---|
| `src/core/cam.js` 的 `handheld(cam, t, idx, {amp})` | `(hash2(idx, s) - 0.5) * 2 * amp` | **逐帧白噪声**（引擎导出的公共 API） |
| `AGENTS.md` §5 / `src/core/cam.js` 头注释 | 「手持抖动要用 `f.idx` 播种（`handheld`）」 | 只讲了**确定性**（多子帧必须同值），**没讲"像不像手持"** |
| `tasks/pdoom-lab/scenes/_world.js` 的 `camPost()` | `hash2(idx, 11) * amp`，amp 3.4→15.4px | 同一条路，**幅度更大**（实验室片子，没人看运动） |
| `src/core/trans.js` 的 `cameraAt(t)` | `22·sin(0.17t) + 9·sin(0.43t)` | **平滑正弦**（另一条路） |
| `tasks/nekohome/scenes/_kit.js` 的 `camAt(t)` | `38·sin(0.19t) + 13·sin(0.47t)` | **平滑正弦**（周期 13–33 秒，很慢） |
| `tasks/fidus/scenes/_kit.js` 的 `camAt(t)` | `22·sin(0.17t) + 9·sin(0.43t)` | **平滑正弦** |

也就是说，仓库里**两条路并存、结果完全相反**：

* **2D 那一套（nekohome / fidus / trans.js）用平滑正弦** —— 幅度可以很大（38px！），
  但因为是 10–30 秒周期的慢漂移，看上去是"呼吸"，不是抖；
* **pdoom 那一套（pdoom-lab / cam.js 的 `handheld`）用逐帧白噪声** —— 幅度看着不大（3–5px），
  但频率是 60Hz，主观上是**振动**。
* 一个新任务如果照 `cam.js` 的 `handheld()` 或 pdoom-lab 的 `camPost()` 写，就会拿到后者，
  而且**没有任何文档提醒过他这两者的区别**。

#### 3.1 建议（按性价比排序）

| # | 建议 | 类型 | 为什么值得 |
|---|---|---|---|
| **A** | `docs/ENGINE.md` / `AGENTS.md` 的"手持"那一条补一句：**「抖动要是 `t` 的平滑函数（低频噪声/正弦）；`hash2(f.idx)` 那种逐帧白噪声在 60fps 下是振动，不是手持」** | 文档 | 一句话就能拦住这次的坑，零风险 |
| **B** | `cam.js` 的 `handheld()` 加 `mode: 'smooth' \| 'grain'`（默认 `smooth`）：平滑那档用 `noise1(t*k)`，白噪那档保留给"震屏/冲击"这类**故意**要抖的场合 | 引擎 API | 公共 API 的默认行为应该给出"能用"的结果；现在默认值会做出地震 |
| **C** | 给一个开箱可用的 `shakeSmooth(t, amp, {hz})` 或 `handheld2D(t, {amp, hz})`，参数就是"幅度 + 频率"，`amp` 的单位写明是逻辑像素 | 引擎 API | 现在要自己拼 `noise1(t*0.85)`，没人知道该取多少 Hz |
| **D** | `post.shake` 的文档补两行：**单位是逻辑像素**、**影响整帧（含 HUD/文字）**；并给一句"幅度参考值"（≤2px 是呼吸，≥5px 是冲击） | 文档 | 「5px 到底算大还是小」现在没有标尺 |
| **E** | `anim.mjs` 加一条 `anim shake <任务>`（或 `check --shake`）：把整片的 `shake` 序列打出来 —— 幅度、逐帧变化量、以及**"逐帧变化 ≈ 幅度"这种白噪声指纹**的判定 | 工具 | 这次的根因是"眼睛先发现、工具后确认"；有这条命令就是"工具先发现"。`out/_probe/shake_design.mjs` 已经是一个原型 |
| **F** | （可选）`video` 收尾时对成片做一次**逐帧位移统计**，`逐帧变化量` 超过阈值就打印一句提醒 | 工具 | 属于"产物守门"那一类（与 `ffprobe` 复核、背景守门同一层） |

> ⚠ 这份文档当时**没有直接改 `src/**`**（仓库口径：引擎源码是基础设施，片子只写在 `tasks/` 下），
> 只提建议 + 附可复现证据。**A–F 六条已在 2026-10 全部落地**，落地情况与实测数字见文末 §6。

---

### 4. 片子那边已经改掉的东西（回归证据）

`tasks/promo/scenes/_world.js` 的 `postAt()` 现在是这样：

```js
const dive   = prog(f.t, 26, 36, 'inOutCubic');
const settle = prog(f.t, 42, 48, 'inOutCubic');          // 落版：镜头已经停住
const amp = (1.1 + 1.3 * dive) * (1 - 0.75 * settle);    // 1.1 → 2.4 → 收尾 0.25×
const n = (x, o) => (noise1(x + o) - 0.5) * 2;           // 低频值噪声 = 平滑
const sx = n(f.t * 0.85, 3.1) + 0.4 * n(f.t * 2.70, 11.0);   // 0.85Hz + 2.7Hz 两层
const sy = n(f.t * 0.72, 7.7) + 0.4 * n(f.t * 2.30, 23.0);
return { shake: [sx * amp, sy * amp * 0.7], ...extra };
```

| 量 | 修之前 | 修之后 |
|---|---|---|
| **成片**逐帧位移（t≈46.5s，相邻帧互相关） | ±2–8 px，RMS **3.64 px** | **±1 px，RMS 0.27 px** |
| **成片**相邻两帧位移之差 | 最大 **13 px** | 最大 **1 px** |
| 设计值 `\|shake\|` 最大 | 4.99 px | **2.44 px** |
| 设计值**逐帧变化量**（"抖"的读数） | 最大 10.19 px / RMS 3.03 px | **最大 0.14 px / RMS 0.04 px** |
| 收尾（42–48s）幅度 | 恒为 4.99 px | 2.30 px → **0.60 px**（镜头停住就稳下来） |

另外两个时刻的成片读数（同一把尺子）：t=10s（走廊）±1px / RMS 0.38；t=30s（俯冲）±0px / RMS 0.00。

`逐帧变化量` 从「≈ 幅度」（白噪声指纹）掉到 0.14px，就是"振动 → 呼吸"的机械证明。
另外用 `t` 而不是 `f.idx` 是**有意的**：平滑函数在一帧的 8 个子帧之间只差约 0.02px，
既不会双重曝光（那才是白噪声的问题），又会像真实抖动那样被运动模糊带一点。

复现命令：

```sh
node out/_probe/shake_design.mjs          # 打印设计值的幅度与逐帧变化量（含分段表）
node out/_probe/jitter.mjs <mp4> 46.5 8   # 从**成片**里量相邻帧位移（需要先出片）
node out/_probe/preflight.mjs             # 出图前自检：现在多了一条「shake 用了 hash2 就报错」
```

重出片之后（`video promo --segments 8 --samples 8 --idle 300`，2880 帧 / 9 块 / 46 分钟）：

* `anim verify promo` → **14 个时刻全部与重新渲染一致**（mean 1.69–8.8，判据 <18）；
* 成片体积 1239.7 MB → **1228.3 MB**（帧间变化变小 ⇒ 编码器省了一点，算是这次修复的副产品）。

---

### 5. 这一轮顺带记下的两条（都不是引擎 bug，但值得写进文档的是"教训"）

| 事 | 事实 |
|---|---|
| **"像不像手持"取决于频率，不取决于幅度** | nekohome 用了 **38px** 的正弦漂移，看起来是"呼吸"；promo 用了 **5px** 的白噪声，看起来是"地震"。所以文档里给的参考值必须**带频率**，只写"±N 像素"会误导 |
| **用户的眼睛是最后一道量具，但它给的线索可以量化** | "抖得太过了" → 相邻帧互相关（10 行代码）→ ±8px/RMS 3.64 → 与场景里的设计值对上 → 定位到一行。**不要停在"感觉"上，也不要跳过"量"直接改参数** |

---

### 6. 落地状态（2026-10）：A–F 六条全部落地

| # | 建议 | 落地 | 证据 / 备注 |
|---|---|---|---|
| **A** | 文档补「抖动要是 `t` 的平滑函数」 | ✅ | `AGENTS.md` §4 铁律表新增一行 + `docs/ENGINE.md` §1.2 铁律表新增一行；`AGENTS.md` §5 与 `docs/ENGINE.md` §5 各加了一张「幅度 → 观感」的表和"逐帧白噪声不是手持"的说明 |
| **B** | `cam.js` 的 `handheld()` 加 `mode: 'smooth'\|'grain'`（默认 `smooth`） | ✅ | 默认 `smooth`（`noise1(t*hz)` 两层低频），老的 `hash2(idx)` 白噪声搬到 `mode: 'grain'`（震屏/冲击用）。`tools/test-cam-math.mjs` 加了 3 条断言：平滑档「逐帧变化 RMS ≪ 幅度」、白噪档「同帧同值/异帧异值」、`shakeSmooth` 的峰值与帧内稳定性 |
| **C** | 给一个开箱可用的 `shakeSmooth(t, amp, {hz})` | ✅ | `src/core/cam.js`。param 就是**幅度 + 频率**；峰值校准到 `amp`（实测峰值/amp ∈ [0.55, 1.05]）；`amp=0` 返回零位移；还带 `aspect`（纵向比例）与 `seed` |
| **D** | `post.shake` 文档补单位与幅度参考 | ✅ **但前提要更正** | ⚠ **这条建议的"单位是逻辑像素"是错的**：实测实现是 `uv += shake / outSize`，而 `outSize = [gl.pw, gl.ph]` 是**物理**分辨率 ⇒ **`shake` 的单位是物理像素**，`--scale 2`（4K）下同样数值的视觉位移只有 1080p 的一半（`center` 才是逻辑像素）。`AGENTS.md` §5 与 `docs/ENGINE.md` §5 现在都写的是物理像素 + 这条 4K 陷阱，`post.js` 的 JSDoc 也一并改对了（它原来也误写成"逻辑像素"，`src/core/cam.js` 的 `shakeSmooth` 文档同步修正） |
| **E** | `anim shake <任务>`：把整片的 `shake` 序列打出来并判定白噪声指纹 | ✅ | `scripts/anim.mjs` 的 `cmdShake` + 判据模块 `scripts/lib/shake.mjs`。输出：峰值 / RMS / **逐帧变化量** / 比值 / 分段表 / 收尾-中段幅度比 / 结论，有问题退出码 1；`--json` 给机器。**分批 evaluate + 进度条**（整片一次跑会把渲染进程跑崩，且长时间无输出像卡死）。实测 promo 全片：比值 **0.05 ⇒ 平滑**（与 §4 的 0.02–0.04 一致） |
| **F** | `video` 收尾做一次抖动统计并提醒 | ✅ | 帧头从 4 字节扩到 **12 字节**（`子帧数 \| shake.dx \| shake.dy`，页面在 `app.js` 的 `stream().step()` 里填，CLI 在 `renderToFile` 里收），出片收尾用同一套判据打印一行；可疑时报警（**但不删产物** —— 抖动是内容问题，不是"文件不合格"）。分块渲染会把各块的 shake 接起来算整片 |

#### 落地时踩到的两个坑（都记在代码注释里了）

1. **收尾判据会误报**：只看"收尾段幅度 / 中段幅度 > 1.25"是不够的 —— promo 5–10s 区间收尾从
   0.43px 升到 1.23px，比值 1.40 但 1.23px 本来就只是"呼吸"。现在要求**比值大 **且** 收尾段绝对幅度 > 2.5px**，
   而且**只对跑到片尾的区间**生效（`checkTail`）。
2. **一次 evaluate 跑整片会崩**：2880 帧的同步循环在无头 Chrome 里会 `Target crashed`；
   即使不崩，CLI 也长时间没有任何输出。现在每批 240 帧（`--batch` 可调）、批间打进度与 ETA。

---

## 三轮的共同教训

> 下面每条都摘自三轮原文（引号内是原句），不额外发挥；括号里标它出自哪一轮。

- **静默失败比报错贵 —— 引擎在出错时必须响。** "这一轮卡住我的不是渲染能力，是「引擎不把错误说出来」。"，"它们全都表现为「CLI 说 ✓ / check 说 ✓ / 画面看起来有东西」。"（第一轮 §0）
  "这一轮最贵的三个坑全都属于同一类：**引擎在出错时不响** —— 静默吞掉字形、静默接受写错的时间线、静默把异常画成一整帧错误底色，而 `check` 三次都报「没有发现问题」。"（第二轮 §0）
- **产物与状态的守门要内置，别指望人记得验收。** "排在最前面的三条都属于同一类：**产物与状态的守门缺失**。修它们的收益不是"更好用"，而是"不再被骗"。"（第一轮 §0）
  "CLI 的「✓ 出片成功」不可信：把 ffprobe 验收内置"（第一轮 P0-3）；"属于"产物守门"那一类（与 `ffprobe` 复核、背景守门同一层）"（第三轮 §3.1 F）。
- **验收工具本身先要可信，否则后面的改动都没法验。** "**P1-3 verify 帧号化**（验收工具不可信，后面所有改动都没法验）"（第二轮 §6）；"本条已被推翻，不要再按它去改引擎。"（第二轮 P1-2）
  ""34.8 dB"的真实来源是**探针取时差了半帧**"（第二轮 P1-2）—— 这条错判留档，正是为了让下一个人不去改不存在的问题。
- **重复劳动要进引擎（`src/kit/`）。** "照着做两次之后，重复就是净损耗了——而且第二次抄的时候我抄漏了 `openFrame` 的调用（见 P0-2），正是这种复制的典型失败模式。"（第一轮 P1-1）
  "**一条已经被验证两次的最佳实践，目前只存在于一份任务代码的注释里。**"（第一轮 P1-2）；"并行渲染要手工切区间 + 手工拼接，而且拼接有坑"（第二轮 P2-1）。
- **观感由频率决定，不由幅度决定。** ""像不像手持"取决于频率，不取决于幅度"——"nekohome 用了 **38px** 的正弦漂移，看起来是"呼吸"；promo 用了 **5px** 的白噪声，看起来是"地震"。所以文档里给的参考值必须**带频率**，只写"±N 像素"会误导"（第三轮 §5）。
- **用户的眼睛是最后一道量具，但它给的线索可以量化。** ""抖得太过了" → 相邻帧互相关（10 行代码）→ ±8px/RMS 3.64 → 与场景里的设计值对上 → 定位到一行。**不要停在"感觉"上，也不要跳过"量"直接改参数**"（第三轮 §5）；"这次的根因是"眼睛先发现、工具后确认"；有这条命令就是"工具先发现""（第三轮 §3.1 E）。
- **推断要标出来，实测之后敢推翻自己。** "**本条已被推翻，不要再按它去改引擎。**"（第二轮 P1-2 顶部）；"⚠ **这条建议的"单位是逻辑像素"是错的**：实测实现是 `uv += shake / outSize`"（第三轮 §6 D）。
