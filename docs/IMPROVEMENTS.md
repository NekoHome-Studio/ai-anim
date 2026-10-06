# 改进项：做 `tasks/fidus` 那支片子时暴露出来的问题

> **✅ 全部 17 条已落地并逐条验证（2026 之后的一轮）。**
> 每一项的「问题 / 证据 / 改了什么 / 怎么验的」记在 [`docs/STATUS.md`](./STATUS.md) §10；
> 复现命令与回归脚本见那张表。本文保留原始描述（它记录了**问题是怎么被发现的**），
> 但**不要**再把它当待办列表读。

> 🔜 **第二轮的待办在 [`docs/IMPROVEMENTS-2.md`](./IMPROVEMENTS-2.md)** —— 那是做 `tasks/beast`
> （兽音译者介绍片：127.5s / 12 段 / TTS 旁白 / 7650 帧 / 三段并行）那一轮新暴露的问题，
> 按 P0/P1/P2 排好，每条都有证据、复现命令、修法与验收。**要动引擎先读那份。**
>
> **读者**：下一个会话的 agent。
> **来源**：某一轮从零把 `tasks/fidus`（FlexiAtom/fidus 介绍片，60s / 1080p60 / 9 个镜头）
> 做到成片。过程中没有改过 `src/`，但**被引擎咬了几口**，也把「每做一支新片子都要重写一遍」
> 的重复劳动摸清楚了。
>
> 每条都给了**证据（文件:行 或 实测读数）**、**复现命令**、**修法建议**、**验收标准**。
> 凡是推断而非实测的，都标了「待验证」。
>
> **先读 [`docs/STATUS.md`](./STATUS.md)**：那里是当前状态与验收证据。本文只讲**还没做的**。
> [`docs/history/HANDOFF.md`](./history/HANDOFF.md) 是上一轮的交接单，已标过期，结论以 STATUS.md 为准。

---

## 0. 一句话结论

**这一轮卡住我的不是渲染能力，是「引擎不把错误说出来」。**

三个最花时间的问题——出片产出一个打不开的 mp4、九个场景里八个静默黑底、成片要人肉抽帧验证——
**没有一个被引擎报错**。它们全都表现为「CLI 说 ✓ / check 说 ✓ / 画面看起来有东西」。

排在最前面的三条都属于同一类：**产物与状态的守门缺失**。修它们的收益不是"更好用"，而是"不再被骗"。

---

## 1. P0：会静默产出废品，先修这三条

### P0-1 `--idle` 默认 30 秒会把 ffmpeg 背压误判成卡死，提前收工，产出没有 moov 的废文件

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

### P0-2 漏调 `openFrame` → 整段静默黑底，而 `check` 抓不到

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

### P0-3 CLI 的「✓ 出片成功」不可信：把 ffprobe 验收内置

**证据**：`AGENTS.md` §10 自己写着「用 `ffprobe` 核对 `nb_read_frames == 时长 × fps`
（**别只看 CLI 的 ✓**）」——这等于承认 CLI 的 ✓ 不能信，然后把验收责任推给了人。
这一轮 P0-1 的废品正是这类：分段模式 13 块全部 ✓，第 1 块其实是坏的。

**改法**：`video` 收尾时自动 `ffprobe` 自己的产物，帧数不符就 `die`；`--segments` 每块渲完也验。
（ffprobe 已经在用：`scripts/anim.mjs:697` 附近有 ffmpeg spawn，加一次 probe 成本可忽略。）

**验收**：手工从一个成片里删掉末尾若干帧，`anim.mjs verify`/`video` 必须报错。

---

## 2. P1：每做一支新片子都要重写一遍的东西

### P1-1 通用镜头工具已经重复写了三遍，应该进 `src/kit/`

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

### P1-2 「全片一层背景 + 一台摄影机 + 一个母题」的配方没有进引擎

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

### P1-3 `text.js` 的 `alpha` 必须靠 `stagger > 0` 才生效（一行可修）

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

### P1-4 `type.write` 的 `align` 是逐字生效的

**证据**：`src/core/text.js:203` 是逐字素簇 `fillText(cl, gx, y)`，所以 `align: 'center'/'right'`
会对**每个字**生效，多字字符串会整体跑偏。

**连带后果**：`nekohome/_kit.js` 的 `put()` 与 `fidus/_kit.js` 的 `put()` 都是为绕开它写的
（先 `measure` 再自己按锚点偏移）。`AGENTS.md` 的正文里**没有**提这条，只在某个任务的
注释里出现。

**改法**：给 `TextKit` 加 `writeLine(text, x, y, { anchor })`（内部先 measure 再偏移）；
至少也要在 `docs/ENGINE.md` 的 `type.write` 参数表里把 `align` 标成「仅对单字有效」。

**验收**：`writeLine('中文标题', 960, 400, { anchor: 'center' })` 视觉居中。

---

### P1-5 `LineBatch` 没有填充图元；颜色能带 alpha 但没写进文档

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

### P1-6 `post` 参数没有方向与单位说明，`fade` 尤其反直觉

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

## 3. P2：诊断效率

### P2-1 `check` 每段只采一个点，而且正好是正中

**证据**：`scripts/anim.mjs:450` `const mid = (it.start + it.end) / 2;` —— 整段只此一点。
实测输出即 `title t=3.00s`（段是 0–6s）、`evidence1 t=10.00s`（段是 5.5–14.5s）。

**后果**：**入场头 1 秒完全没被采到**，而那正是最容易出问题的地方（文字没出来、
位移方向不对、元素互相压字）。这次我遇到的压字、漏字、准星压字三个问题，
全都是靠自己额外抽了约 20 张 `still` 才发现的，`check` 一次都没报。

**改法**：每段至少采 **15% / 50% / 85%** 三个点；
再加 `check --sheet`，自动把每段中间帧 + 每段切点前后 1 帧拼成接触表写到 `out/<任务>/check/`。

**验收**：人为把某个元素的入场延迟调到段末，`check` 能报出来。

---

### P2-2 没有「成片 vs 静帧」的自动比对

**证据**：渲染是 t 的纯函数，所以**同一 t 的成片帧与 `still` 输出应当逐像素一致**。
这是个可以自动化的强判据，但现在得手工做：我最后是 `ffmpeg -ss <t> -frames:v 1` 抽 6 帧，
再用 Read 工具一张张看。

**改法**：`node scripts/anim.mjs verify <任务>`：
按段边界（和每段中点）从成片抽帧 → 与 `still` 同 t 的输出逐像素比 → 报最大通道差。
一次性能抓住三类问题：**分段拼接错位 / 帧数不对 / 色彩空间不一致**。

**验收**：手工把 `fidus.parts` 里某一块换成另一段的 mp4，`verify` 必须报差异。

---

### P2-3 耗时没有预估，`samples=auto` 没有预算

**证据**：实测 1080p60 / 8 子帧约 **1.5 fps**，60 秒片子 **34 分钟**。
CLI 的 ETA 是滚动平均，前 30 帧给的是 7000s，收敛很慢；不设 `--samples` 时
`auto` 在"全片背景一直在动 + 摄影机一直在动"的片子里会持续吃到高子帧。

**改法**：渲之前先跑一小段测速，按段时长给出总预估；
或提供 `--dry-run` 打印「当前参数下预计 N 分钟」。
`samples=auto` 可以接受一个总预算（例如 `--motion-budget`），超了就自动降。

**验收**：`--dry-run` 的预估与实跑相差 < 30%。

---

### P2-4 `--segments` 的语义与代码注释里的承诺不符

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

## 4. 文档与脚手架的**事实错误**（廉价但要紧）

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

## 5. 环境（不是引擎 bug，但会挡住第一次上手）

- **引擎 CLI 必须能 `spawn` 无头 Chrome 并通过管道读它的输出。** 在受限沙箱下
  （本次是 DSH 的 `workspace-write`）会直接 `spawn EPERM`，而报错位置在
  `scripts/anim.mjs:144 openSession`，看不出是权限问题。建议在 `AGENTS.md` §1 加一句前置条件。
- **在 PowerShell 里别用管道接原生程序的输出**：`node scripts/anim.mjs ... | Select-Object`
  与 `ffmpeg -version 2>&1 | ...` 都会被沙箱以"命名管道"为由拒绝。直接跑、让输出自己打印即可。
- 这两条与引擎无关，但下一个会话大概率会先撞上，写在这里省时间。

---

## 6. 建议的动手顺序

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

## 7. 本次问题的可复现证据（原始命令与输出）

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
