# IMPROVEMENTS-2.md —— 做 `tasks/beast`（兽音译者介绍片）那轮暴露的引擎问题

> ## 📌 状态：**14 条已全部落地**（第三轮，见 [`docs/STATUS.md`](./STATUS.md) §11）
>
> 逐条状态、改法与**可复现的验收证据**都在 `STATUS.md` §11；下面这份正文保留原始的问题描述
> （照它才能看懂"当时为什么会踩"）。两条需要特别说明：
>
> * **P1-2 的结论被推翻了。** 那份"跨会话不确定性（34.8 dB）"**不是引擎的问题** ——
>   实测同一 `t` 在任意会话里**逐字节相同**。真相是：成片在每帧的**起点** `t = N/fps` 渲染
>   （`src/app.js` 的 `stream()`），而当年的验收探针按"帧中心" `(N+0.5)/fps` 取时，
>   半帧偏移让运动中的画面差一大截。详见 `STATUS.md` §11.6。
>   **别再按本文 P1-2 的描述去"修跨帧依赖"了 —— 那是一条错的路。**
> * **P1-5（口播/旁白）三档都已落地**：A 档（`task.audio` 分轨 + `task.narration` 旁白表 + `dur: { vo }`）、
>   B 档（`anim say` TTS 入口 / `anim mix` 闪避）、C 档（词级时间戳直通 `type.karaoke`）。
>   命令、文件约定与验收口径见 [`docs/NARRATION.md`](./NARRATION.md) §4 / §5。

> **读者**：下一个会话的 agent。这份是**待办列表**，可以直接照着改。
> 第一轮（`tasks/fidus`）的问题在 [`docs/IMPROVEMENTS.md`](./IMPROVEMENTS.md)，17 条已全部落地，别重复做。
> 当前状态与验收证据先看 [`docs/STATUS.md`](./STATUS.md)。
>
> **来源**：从零把 `tasks/beast` 做到成片，两版：v1 63s/12 段无旁白 → v2 127.5s/12 段带 TTS 旁白，
> 7650 帧、三段并行渲染、自建拼接。过程中**没有改过 `src/`**（只给 `scripts/anim.mjs` 加了一个 `--vcodec`），
> 但被引擎咬了十几口。每条都给了**证据**、**复现命令**、**修法**、**验收**；
> 凡是推断而非实测的都标了「待验证」。

---

## 📋 14 条落地状态（第三轮）

**逐条的状态、改法与可复现的验收证据都在 [`docs/STATUS.md`](./STATUS.md) §11** ——
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

## 0. 一句话结论

> 这一轮最贵的三个坑全都属于同一类：**引擎在出错时不响** ——
> 静默吞掉字形、静默接受写错的时间线、静默把异常画成一整帧错误底色，
> 而 `check` 三次都报「没有发现问题」。**先做 §1 的三条，它们能省下后面所有人的排查时间。**

---

## 1. P0：静默失败 —— 会产出「看起来正常」的坏东西

### P0-1 `type.write` / `writeLine` 的**数值型 `alpha` 会让整个字形不画**（不是画成透明）

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

### P0-2 `seq()` 会接受「不是时间线节点」的对象，静默退化成一条假时间线

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

### P0-3 场景 `draw()` 抛异常 → 整帧**错误底色**，而 `check` 报「没有发现问题」

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

## 2. P1：验收与一致性

### P1-1 `--segments` 复用分块时**不校验渲染参数**，会拿旧参数的分块拼进新片

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

### P1-2 同一时刻、**从不同起点开渲**结果不同（跨会话不确定性）

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

### P1-3 `verify` 的取时 / 抽帧口径在帧边界上会差一帧，导致误报 ✗

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

### P1-4 `analyze` 从**混音**里测 bpm，被人声带偏

- **症状**：`f.beat` / `f.beatPhase` 是错的（本片实测 136bpm，而配乐实际 96bpm）。
- **证据**：`node scripts/anim.mjs analyze beast` 输出 `bpm 136.0  289 拍`（音轨是旁白+闪避后的混音）；
  配乐床是 96bpm。我最后把母题带的呼吸写死 0.625s（=96bpm 一拍），**不能跟 `f.beat`**。
- **修法**：`task.audio` 允许 `{ music, vo, mix }`（`music` 只用来分析节拍，`mix` 交给 ffmpeg），
  或 `analyze --beat-from music.mp3`。
  > 🔧 本轮落地的是**第一种**（见 `STATUS.md` §11.10）；`analyze --beat-from` 这个写法
  > **没有实现**，别照着打（`anim say` 取一拍用的是另一套优先级，见 `docs/NARRATION.md` §4 B 档）。
- **验收**：带旁白的片子 `analyze` 出来的 bpm 与配乐一致。

### P1-5 口播 / 旁白这一层完全缺失（这一轮最大的能力缺口）

- **症状**：想做「有人讲解」的片子，必须把 TTS、测长、闪避、混音全在引擎外面手搓，
  最后塞回唯一的那条 `audio` 里；镜头长度也只能在外部反推。
- **证据与完整方案**：见 [`docs/NARRATION.md`](./NARRATION.md)（含这一轮的可复制做法、
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

## 3. P2：效率与工作流

### P2-1 并行渲染要手工切区间 + 手工拼接，而且拼接有坑

- **实测收益**：2 个进程 1.81×、3 个进程 2.3×（本片 7650 帧：串行 59 分钟 → 26.1 分钟）。
  瓶颈在浏览器那侧（`samples=1` 就 214ms/帧），一个进程吃不满机器 —— 详见 [`docs/PERF.md`](./PERF.md)。
- **坑**：切点**只能落在「下一段转场已经结束」的时刻**（否则这一段开头拿不到上一帧，甩镜缺一半）；
  自己用 `ffmpeg -f concat` 拼 mp4 时**必须加 `-copyts`**，否则整条视频被推后 `+0.022982s`
  （B 帧 CTS 偏移），帧号与时间戳错位。**CLI 内部的分块拼接没这个问题**（它先把每块转成
  MPEG-TS 再拼；实测 `--segments` 出的成片首帧 PTS = 0.000000）。
- **修法**：`video --parallel N`（自动选合法切点、起 N 个进程、完成后自己拼好并复核）；
  退一步至少给 `anim cuts <任务>`（打印所有合法切点）与 `anim concat <任务> <块…>`
  （内部走 ts 转换，别让人自己写 ffmpeg）。同时把 `-copyts` 这条写进文档。
- **验收**：`--parallel 3` 出的成片与串行版**帧数一致**，抽帧比对一致。

### P2-2 渲染期间不能碰工作区（HMR 会把推帧打断），连写文档也不行

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

### P2-3 `prog()` 的 easing 名写错会静默退化成 linear

- **证据**：`src/core/util.js:117` `ease[name] ?? ease.linear`。
- **修法**：名字不认识时 `console.warn` 一次（带调用处的近似信息，例如传进来的字符串），
  production 也保留但去重。
- **验收**：`prog(t, 0, 1, 'outCubicc')` 会打一条警告。

### P2-4 诊断信息不一致：`check` 有时打印 `GPU: WebKit WebGL`

- **证据**：`check beast` 打印 `GPU: WebKit WebGL`（拿不到 unmasked renderer），
  而同机的 `anim gpu beast` 能拿到 `ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 …, D3D11)`。
- **修法**：统一走 `anim gpu` 那条获取路径；拿不到就明确写「（unmasked renderer 不可用）」。
- **验收**：两条命令输出的 GPU 串一致。

### P2-5 `out/<任务>/` 会堆 GB 级中间产物，没有清理提示

- **证据**：本片 `out/beast/` 峰值 ≈ 3.8 GB（`beast.parts/`）+ 650 MB 成片 + 284 MB 分发版
  + 大量 `stills/`（86 MB）+ 我手工产生的 `*.yuv`（每个 400 MB）。
- **修法**：`video` 结束时打印「中间产物 X MB，保留以便断点续渲；`anim clean <任务> --parts` 可删」，
  并提供 `anim clean` 命令（默认只删 `*.yuv` / 分块；`--all` 才动成片）。
- **验收**：`anim clean beast` 后 `out/beast/` 只剩成片与 stills。

### P2-6 `video --out/-o` 没写进 `--help`（小）

- `node scripts/anim.mjs video --out out/x.mp4` 是**可用**的（`scripts/anim.mjs` 的 `cmdVideo` 支持），
  但 usage 里没列；并行渲染与对照实验都要用它。

---

## 4. 本轮确认**没问题**的（别去"修"它）

- **同一起点下逐比特可复现**：同一条 `video` 命令跑两遍 → PSNR = ∞（这才是引擎最强的那条承诺，
  只是它的边界比文档写的窄，见 P1-2）。
- **CLI 内部的分块拼接是对的**：`--segments` 出的成片首帧 PTS = 0.000000、帧距严格 1/60。
- **`check` 的背景守门有效**：11 个交叠段全部点名通过；亮度统计能反映「这段画了东西」的量级
  （正常 0.07–0.15）。
- **`--vcodec h264_nvenc --cq 19` 已加好**（这一轮加的），可用；`--samples` 的边际成本约 29ms/子帧，
  降 samples 是最省时间的旋钮。
- **`ease`/`prog`/`rng`/`gl.clear`/`LineBatch`/`comp.draw` 的语义本轮没有遇到坑**。

---

## 5. 复现命令汇总（本机 Windows / PowerShell）

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

## 6. 建议的动手顺序

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
