# BACKLOG —— 还没做的事（唯一的待办清单）

> **这份文件是仓库里唯一的待办 / 待拍板清单。**
> 各轮改进记录（[`history/IMPROVEMENTS-1-3.md`](history/IMPROVEMENTS-1-3.md)、
> [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md)）与 [`STATUS.md`](STATUS.md)
> 记录的是**已经做完**的事；它们各自有一个"没做的 / 留给下一轮"小节，那是**当时**的状态，
> **现在以本文为准**（本文已经逐条核对过代码与文档，把后来做掉的划掉了）。
>
> **维护规则**：只有本文是待办；做完一条就移到 §5 并注明**哪一轮做的**（保留一行，不要静默删除）；
> 每条都要能回答"从哪接着做 / 怎么算做完"。
>
> 最后整理：**2026-10-10**（本轮新增 §1.B / §1.C —— 拆解三个外部"agent 做视频"项目之后的画面/验证能力清单，
> 来源见那两节开头）。

---

## 0. 需要你拍板的（我这边定不了）

| # | 事 | 两个选项 / 代价 | 出处 |
|---|---|---|---|
| 0-1 | `tasks/nekohome/scenes/_kit.js` 顶部那三个**颜色绕行函数**（`disp()` / `dcss()` / `dscale()`）要不要回改 | **A**：改回 `P.xxx` / `css(P.xxx)` 再重出片核对（约 43 分钟 + 一次观感复核）—— 已成片会**整体略暗一点、层次回来**，而且片里大量 `dscale(P, …, 1.35)` 是照现在的观感调的；**B**：保持现状（能跑、不报错），只把注释更正为"这是历史绕行，不是设计要求" | [`history/STATUS-rounds-1-6.md` §8](history/STATUS-rounds-1-6.md) · [`STATUS.md` §16.7](STATUS.md) 第 5 条 |
| 0-2 | `tasks/sodium`（12/43 句）与 `tasks/optifine`（3/47 句）的**画面文字逐字复述旁白**要不要返工 | 清了这 15 处（外加 `lint-narration-dup --near` 报的 10 处半复述）之后 `tools/lint-narration-dup.mjs` 就能**归零**，两支片子也会顺利用上引擎字幕层（`captions: true`）。代价：重出片 ~80 分钟 + 重烧字幕。**不做也可以**：它们已交付，复述是"观感打折"不是错误 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第五轮 §8 第 1 条 · [`CAPTIONS.md`](CAPTIONS.md) |
| 0-3 | `kinetic` 模板的**居中长行会顶出右边**（demo 里就是） | **A**：修模板 —— 会让 `demo` / `beat` 的画面变化，必须重存 `hashes` 基线；**B**：只改 demo 的文案。<br>⚠ **2026-10-10 核正**（读代码核实，不是转述）：`beat` **不引用** `kinetic`（`tasks/beat/task.config.mjs` 只用 wave/pulse/grid）⇒ 只改 `kinetic` 时 `hashes beat` **不会红**，只需重存 `demo`；但 `align:'center'` 在镜头库共 **9 处 / 4 个模板**（kinetic / outro / pulse / chart），若一起改，`pulse` 会动到 `beat` | [`STATUS.md` §15.4 / §15.5](STATUS.md) |
| 0-4 | `tasks/nekoseek` 这支介绍片**要不要立项** | 前置分析（读完全部源码 + README，事实逐条标了出处）已完成，停在"待你拍板"；`tasks/nekoseek/` 目前没有 `task.config.mjs`，所以它不是任务 | [`tasks/nekoseek/ANALYSIS.md`](../tasks/nekoseek/ANALYSIS.md) |
| 0-5 | `src/shots/` **要不要加模板**（缺 `quote` / `counter` / `compare` 这类常见镜头） | 加的话照 `src/shots/title.js` 的形状写并同步 `meta`。⚠ **代价被低估了**（2026-10-10 核正）：`tools/test-shots.mjs:49` 把模板集合**写死成正好 8 个** ⇒ 加模板会让 `:197/:202/:209` **三处同时红**、`regress-all` 的 `unit:shots` 会挂；代价里含「改测试 + 同步 4 处文档」，而且它与 §1.B-21（模板 spec）改同一批文件，**别并排做**。**不加也完全能用**：需要新视觉就手写场景（C 档） | [`STATUS.md` §14.6 / §15.5](STATUS.md) · [`ROADMAP.md`](ROADMAP.md) |
| 0-6 | **后处理新参数要不要真的用起来**（`tonemap` / `dither` / `bloomKaris` / `grainScale`） | 四个参数已进引擎，**默认值全部等于现状**（`hashes demo` / `beat` 各 11/11 `max 0` 验过）。实测：现状的软肩在输入 1.0 就输出 254、2.0 并到纯白（高光**没有层次**）；`tonemap: 'agx'` 配 `exposure: 0.75` 能把高光拉回来（1.0→200、2.0→238、4.0→247）且暗部反而更沉（均值 75.1→73.5），**代价是霓虹去饱和**（橙 253,253,120 → 237,218,151）；`'aces'` 是折中（1.0→232，霓虹 248,241,131）。**A**：下一支片子的高光多镜头先用它出 A/B 图再定；**B**：先留在工具箱里不用 | [`ENGINE.md` §5](ENGINE.md)（参数表）· `tasks/_post-lab/`（标定夹具）· `out/_postlab/`（本轮实测数据与对比图） |

---

## 1. 引擎 / 工具（已确认还开着）

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-1 | **`check` 增加几何自检**：随机取几个"已知应该可见"的面，验证"被铺的面 = 朝镜头的面" | 这类"不报错但画面全错"的几何 bug 目前**只能靠眼睛**（`facesToward` 反向那次出图核对了 20+ 帧才定位到）。判据可以先做成纯 JS 的（`tools/test-blocks.mjs` 已有正反用例可复用）。<br>⚠ **2026-10-10 核正：先解决「假覆盖」再动手** —— 今天**没有任何 `tasks/` 引用 `src/kit/blocks.js`**（老任务各自带一份私有拷贝），所以直接把它接进 `check` 会做出一个**永远绿**的检查（在现有任务集上不可能被触发）。要么先迁一个任务过来用 kit，要么专门做一个夹具任务 —— 否则这条等于没做 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **F**（⬜ 未做） |
| 1-2 | **`anim say` 的标点对齐优化**：47/47 句都命中「词级时间戳与原文有 1–8 个字符没对应」 | 现有处理（按顺序对齐 + 保住真时间戳）**是对的**，但可以把标点先从比对里排除，只有"排除标点后仍对不上"才走对齐 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **B**（⬜ 未做） |
| 1-3 | **产物守门失败时的措辞**：不要把 CLI 自己也修不了的原因写成"重跑即可" | 按**已知 / 未知**分开措辞 —— 拼接那一步的失败是**确定性**的，重跑没有意义（这一轮照着重跑白等了 30 秒） | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §1.5（原文标"未落地"） |
| 1-4 | **`_accumPass()` 在渲染成片时仍静默丢弃非有限值** | `check` 现在能扫出来（`scanNonFinite`），但 `video` 路径没有。想更早发现要在 `video` 里也开扫描 —— 每帧多一次浮点回读，**代价要先实测** | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) |
| 1-5 | **`probe-alpha` 的 `blank` 参考帧常量偏移**（读 0.10012 而不是 0.062） | ⚠ **2026-10-10 核正：这不是 bug，是那句注释写错了口径** —— `readPixels` 走 `src/core/gl.js` 的 sRGB 编码，`lin2srgb(0.01) ≈ 0.1005` ⇒ **0.10012 才是对的**（0.062 是拿线性值当显示值）。相对判据（`meanOf` 那套）本来就成立。**只剩一件事**：`scripts/anim.mjs` 里 `cmdProbeAlpha` 附近那条陈旧注释还写着 `max≈0.06`。⚠ **别照着注释去"修" blank** —— 把 0.10 掰成 0.06 会让 ⑤⑥ 两条判据集体失真 | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) · §11.17.3 |
| 1-6 | **`edge-tts` 的偶发失败**：现在同一句重试 2 次 | 几百句的长旁白值得加"失败也继续、最后统一补跑"（[`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 A 已做了 0 字节重试，这一条是更上层的批量容错） | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) |
| 1-7 | **渲染提速的后续三档**（按性价比） | ② `readPixels` 走 GPU 编码 + 8bit 回读（6.4 → 5.2ms，但接受 sRGB 舍入差 1 LSB，**会动基线**）；③ PBO 异步回读（把 5ms 藏到下一帧）；④ WebCodecs（收益最大、传输量 −314×，但要**重做出片流程**） | [`STATUS.md` §16.7](STATUS.md) · [`PERF.md`](PERF.md) |
| 1-8 | **`dur: { vo }` 只能配内联旁白表** | 外部 `narration.json` 是页面启动后才 fetch 的，`build()` 时还没有表。想做"配置档 + 外挂旁白表"要先改这个时序 | [`STATUS.md` §15.5](STATUS.md) |
| 1-9 | **配置档的 `post` / `world` / `maxSamples` 没有真实用例** | 特性已通（`tools/test-timeline-guard.mjs` 里有转发断言），但没人用过 —— 要用就先出图看 | [`STATUS.md` §15.5](STATUS.md) |
| 1-10 | **raymarch vs 线段批的成本对照**（走廊段） | ⚠ **2026-10-10 核正：线段版早就在仓库里** —— `tasks/pdoom-lab/scenes/corridor.js:31` 已有 `params.impl === 'lines'`（`:44-45` 走 `buildSegments`），只是 `task.config.mjs` 没传这个参数。**所以这条只剩「跑一次 `video pdoom-lab --dry-run` 并记录」，不是写代码。** 两个坑：① 改 `task.config.mjs` 等于换掉该片第 1 段画面（`out/pdoom-lab/hashes.json` 在）⇒ 应该新建夹具任务，别改它；② 两种实现的**画面本来就不同**（raymarch 有软阴影 / AO / 雕刻排线），记录时必须**同时**写画面差异，否则数字会被读成"同样画面快 N 倍" | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) |

### 1.A 画面能力（2026-10 拆解参考项目 `world.execute (me) ;` 之后列的，**按建议顺序**）

> 来源：`docs/REFERENCE-world-execute.md`（对外部开源项目的逐文件拆解，每条都有 `文件:行号` 证据）。
> 后处理那四条同源、**已落地**（见 §0-6），下面是还没做的。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-11 | **仪器视图**：把任意已渲染的画面换一种"成像方式"呈现 —— `ascii` / `halftone`（半调印刷）/ `thermal`（热成像）/ `dither`（1-bit）。同一份数据的多种呈现，科普片最对味的一类手法 | 场景自己建离屏 RT（`new RT(gl, gl.pw, gl.ph)`）→ 正常画进去（`lines.flush(v.target)`、`comp.draw(gl, text, v.target, …)`）→ 一个 Pass 把亮度映射成墨量/字符/色带后合成回 `ctx.out`。ASCII 需要一张字符图集：Canvas2D 画一行字符上传即可，**不必依赖字体文件**。放在 `src/kit/views.js`，照 `src/core/three-bridge.js` 的"渲到纹理再合成"模式写 | [`REFERENCE-world-execute.md`](REFERENCE-world-execute.md) §4 ④（对方 `src/lib/modes.js`） |
| 1-12 | **相机接力 `relay`**：段与段之间不是"切"，而是**相机一路飞过去、内容中途换手**（对方 305 个镜头里 22% 的切点用它） | 四块：① `cam.js` 加位姿混合（look 点直线插值、朝向四元数 slerp、**画幅大小按对数插值** `exp(lerp(log a, log b))`、相机位置由 look+dist **反推**——这样是绕主体摆动而不是切角）；② `trans.js` 加 relay 转场（两段用**同一个混合位姿**各渲一遍、只交叉画面、**文字整段交接不做溶解**）；③ `kit` 加相机探针协议（镜头在设相机处登记，引擎能"只跑到相机那一步"读出位姿、再 drive 回去）；④ `timeline.js` 让 `overlap` 能声明 `relay`。**先只对 `makeThreeShot` 与 `camera3` 生效**（它们的相机是现成的现成数据），2D 段不参与 | 同上 §4 ②（对方 `src/engine/rig.js`） |
| 1-13 | **参数化新转场**：`wipe` / `iris` / `glitch` / `pixel` / `dissolve`（我方现在只有交叉溶解 + 甩镜） | 照 `src/core/trans.js` 的 `transitionPass` 再写几个 Pass 分支；引擎侧接法是现成的（`overlap` + `handlesTransition`） | 同上 §4 ④ |
| 1-14 | **零状态 GPU 粒子**：位置 = `f(粒子序号, 时间, uniform)` 的纯函数 —— 没有 per-particle 状态、没有 CPU 上传 | 对方 `ProcPoints` 的做法。实现是一个 `Pass` + 用 `gl_VertexID` 索引的点精灵，`setup` 建一次、`render` 只更新 uniform。**天然满足"每帧是 t 的纯函数"**，也不会踩子帧乱序的坑；性能上 CPU 每帧零 per-particle 工作 | 同上（对方 `ch/*/ProcPoints`） |
| 1-15 | **段间引用**：把任意另一段在任意时刻的画面画进当前画面（画中画 / 闪回 / 记忆墙） | 需要一个"按 `id` + `t` 重渲某一段到离屏 RT"的引擎接口，外加递归保护（被引用的段不能再引用回来）。确定性上是安全的（每帧是 t 的纯函数，重画任意时刻本来就是允许的） | 同上 §4 ⑤（对方 `engine.renderShotAt`） |

> 拆解里**不建议照抄**的也记一笔，免得以后又想起来：305 镜 / 0.5 秒一刀（MV 的类型特征，不是我们的信息密度需求）、
> 实时渲染作为交付形态（我方交付 mp4）、音频加密与域校验（版权场景不同）、把构建产物入库（他们有自己的构建管线）。
> 另外**我方不比对方弱**的几条也别丢：确定性纪律（子帧乱序 / 渲染期不写文件 / `hashes` 基线）、镜头骨架封装
> （`makeShot` / `makeThreeShot`）、`world: 'auto'` 的共享背景配方、字幕层的"画面只放标注"分工。

### 1.B 画面 / 验证能力（2026-10-10 拆解三个外部项目之后列的，**按建议顺序**）

> 来源（每个项目一份逐文件证据报告，各条都有 `文件:行号` 或原文引用）：
> [`REFERENCE-video-use.md`](REFERENCE-video-use.md)（browser-use/video-use，MIT，28.5k stars）·
> [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md)（heygen-com/hyperframes，Apache-2.0）·
> [`REFERENCE-hypit.md`](REFERENCE-hypit.md)（hypit-ai/hypit，Apache-2.0 with conditions）；
> 三者的横向对比、"为什么这三条撞在一起"以及统一的不建议清单，见
> [`REFERENCE-agent-video-projects.md`](REFERENCE-agent-video-projects.md)。
>
> **拆这三个项目是因为它们各自长出了一层我们缺的东西**，而且三处结论互相印证：
> ①验证要变成"一张图 / 一条断言"而不是"若干张待解读的图"；②作者不该猜秒数；③**空的结果不能算通过**。
> **许可证一律"抄机制不抄代码"**（hypit 还带多租户/再分发/LOGO 三条附加条件，代码不可入 MIT 仓库）。

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-16 | ★ **给 `sheet` 叠一条音频通道**：抽帧接触表 + 波形 + ≥400ms 静音带 + **旁白词级标签** + 时间标尺，横轴同一个时间窗 —— 一张 PNG 判定"这个揭晓发生在旁白说到哪一刻" | 三样数据全在手上：`sheet` 的抽帧、`audio/narration.json` 的 `lines[].words`（**整片绝对时间**，`anim say` 已产出）、`src/core/audio-analysis.js` 的纯 JS 包络（**不必像对方那样临时抽 WAV、也不必引 numpy/librosa**）。落在 `tools/sheet-audio.mjs` 或 `sheet` 的一个 `--audio` 开关（不碰 GPU、不进渲染路径）。对方明写这条要"**只在决策点调用，不拿它当扫描工具**"，文案照抄这个边界 | [`REFERENCE-video-use.md`](REFERENCE-video-use.md) §3.1（对方 `timeline_view.py`） |
| 1-17 | ★ **词锚定时间线**：让作者写"说到『兽语』时切镜头"，而不是 `cue: 0.6` / `internal: 4.2` 这类猜出来的秒数 | 四步：① `narration.mjs` 的 `SCENES[].lines[]` 加 `on: { word, edge: 'start'\|'end' }` 与 `reveal: { at: { line, word, edge } }`（**抄语义不抄 XML 标记** —— 我们的输入已经是结构化 JSON）；② 新纯函数 `resolveNarration()`：输入脚本 + `narration.json` 的 `words` → 输出**现有的 `timing.mjs`**（`slot`/`stretch`/`overlap`）+ 一份 `anchors.json`，**场景侧一行都不用改**；③ **必须实现左右亲和**（词间那段停顿归前一句还是后一句 —— 不实现就被静默归错且不报错）；④ 求解顺序 = 锚点 → 段内时刻 → 再算 `stretch`/`slot`，**段内偏移要跟着乘 `stretch`**。边界与风险：每段限 2–3 个锚点（锚点太多就变成另一种秒数）；**锚点只表达"在哪个词上做什么"，永远不能表达"持续 3 秒"**（否则 `stretch` 失去唯一解）；中文分词对不上时**抛错并列出该句所有可用词**（与现有报错哲学一致）；无词级时间戳时降级回秒，并**在 `check` 里警告"这一段改词不会自动重排"**。验收：扩展 `node tools/test-say.mjs`（纯 JS、不联网、不需要 GPU） | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §2 与 §5.1（对方 `packages/script`、`narrative-temporal`、`timeline-author`）；⚠ 它"等长、不许拉伸"**不要抄**（我们靠 `stretch`） |
| 1-18 | ★ **`check` 加画面语义断言**：`tasks/<任务>/motion.json` 声明 `appearsBy(段, 秒)` / `before(段A, 段B)` / `keepsMoving(段, maxStaticSec)` / 帧边缘不许有硬内容 —— 让"该出现的没出现 / 顺序反了 / 整段没动"变成可 gate 的错误 | 落在 `check` 已有的逐段试渲染 + 三点采样里；段级统计量复用 `scripts/lib/shake.mjs`（**把"只看 post.shake"扩成"看整帧"** 就得到帧间变化量）。⚠ 需要**相邻帧**而不只是孤立采样点，所以试渲染时间会涨（先实测）。对方两条元设计必须一起抄：**"严重性持久性感知"**（只在单点出现的入场瞬态降级为 info、永不 gate；跨采样点保持才 gate）与 **"空 ≠ 干净"**（见 1-19） | [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §4.2（对方 `sweep_static` / `motion_frozen` / `motion_appears_late` / `motion_out_of_order` / `canvas_content_at_edge`） |
| 1-19 | **`check` 的"空 ≠ 干净"**：某段试渲染失败、浏览器没起来、某项审计没跑时，**必须显式报 `skipped`**，而不是少打一行让 agent 当成通过 | 加一个 `skipped` 字段并列进输出。**改动极小、收益极大** —— 这是三份拆解里唯一一处**三个项目都指向**的失败模式（对方原话：浏览器没跑起来时那三个 section 是"empty, not clean"，"which reads like a clean file but means nothing ran"）；同源的还有现有 `--parallel` 静默忽略 `--segments`（见 1-24） | 三份报告：hyperframes §4.2 / video-use §3.7 / hypit §6 ③ |
| 1-20 | **音频响度数字守门**：`anim mix` 与成片收尾报 **LUFS / true peak / LRA**，目标是 `-14 LUFS / -1 dBTP`（对齐主流平台归一化） | `scripts/lib/media.mjs` 加 `measureLoudness()`（两遍 `loudnorm` + 从 stderr 抓 JSON），`anim mix` 打印数字、`check` 里报出来。对方把它上升成了纪律："**你听不见，就说出这一点并报数字**"——我们 `check` 用亮度、`shake` 用逐帧变化量、`verify` 逐像素、`video` 复核帧数，**唯独音频这一层还靠耳朵** | [`REFERENCE-video-use.md`](REFERENCE-video-use.md) §3.2 |
| 1-21 | **镜头模板的声明式 spec + 依赖前置校验**：给每个 `src/shots/*.js` 补 `spec`（参数类型/默认值/`requires: ['music']`/`outputs.visual`），`check` 用它把"`wave` 需要 `audio` + 先跑 `analyze`"提前报出来 | 现在参数表是**运行时反射**的（`src/shots/index.js` 的 `listShots()`），只能报错、不能被校验依赖。**调用签名一个字不用改**（`shot('chart', {…})` 与配置档写法都不动）。⚠ **只做 spec，不做 npm 分发**：我们是单仓、8 个模板，抽包是架构手术，等真出现"给第二支片子复用"再说（有了 spec，抽包是机械活） | [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §4.1（`registry-item.json`）· [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §5.2（双层门槛：工程门槛低、生态门槛是产品判断） |
| 1-22 | **"画面上的数字必须有出处"**：数值显示位（`type.write` 的字符串、`chart` 的 `values`、`codeRow` 的文本）里的字面量数字，要么能在 `FACTS.md` 找到出处，要么写成占位符 | **先做纪律、后做自动化**：① 写进 `AGENTS.md` §10 交付自检与 `docs/FACTS-TEMPLATE.md`；② 之后再做 `tools/lint-fabricated-numbers.mjs`（扫"数值显示位"的字面量 → 查 `FACTS.md` → 报 `file:line`）。理由：对方**也只是写成硬规则 + 交付前自审**（"绝不在帧尺度上编造数字、增量、日期、计数；槽位先渲染成 `— figure —`"），没有自动化。⚠ **这条对我们的伤害面最大** —— 我们的画面全是代码算的，**编一个数字的成本是零** | [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §4.3（"Numbers come from the script" 硬规则 + Pre-Render Self-Audit） |
| 1-23 | **`variants` 覆写 + `narration.json` 可显式指定**：同一支片子出多个版本（换风格 / 换配色 / 换语言 / 剪短版） | ① `task.config.mjs` 加 `export const variants = {…}`，CLI 加 `--variant`：深合并覆盖 + **产物与块缓存按 variant 分目录**（`narration.json` / `timing.mjs` / `video --segments` 的块，**不分目录就会串味**，这是最容易出 bug 的地方）；② 更值钱的是后半：让 `narration.json` 成为**可显式指定的输入**（"这一段用上次那份词级时间戳，不要重新合成"）—— 改一句词现在会导致**整片重渲**，有了它，换风格/换顺序的变体可以**零 TTS 成本**重出 | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §5.4（Source/Run 分离 + 显式复用 Output） |
| 1-24 | **`--parallel` 先说清事实、再决定动不动**：现有两个已知毛病 + 并发度上限 + 收益要重测 | ① 它**静默忽略 `--segments`**（CLI 里 `--parallel` 分支在 `--segments` 之前 return）、只转发 10 个参数（`--idle` / `--force` / `--keep-raw` / `--only` 不生效）—— 这是 1-19 同类的"静默降级"；② 并发度现在硬编码 `2..8`，应按 `min(cpu-2, 内存/3GiB, 段数)` 起算并**默认不开**（对方经验值：**一个 Chrome 按 1.5GiB 预留、只准用一半内存**）；③ **收益必须先量**：NV12 之后实测 4 进程 720 帧 **6.1 fps < 单进程 7.5 fps**（瓶颈在传输与核显争用），所以"多进程"不是免费加速。**可抄的只有它的 `distributeFrameRange`（十行：连续块、可从任意帧开工），不要抄它的调度器** | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §4.1/§5.3（`ordered-frame-sink.ts` / `concurrency.ts`）· 本地实测见 [`PERF.md`](PERF.md):67–74（"并行渲不同区间：⚠ 历史结论，已不是首选"） |
| 1-25 | **并发子代理的 brief 模板**（做变体时直接可用） | 对方 10 项 brief 里有三条我们特别该抄：**确切技术规格**（必须写死 width/height/fps/scale/style/captions，否则默认值会漂）、**anti-list**（"不要什么" —— "相邻两支片子不能同风格"本质就是一张 anti-list）、**"不要提问，自己挑最显然的解释往下做"**（并行子代理一提问整批就卡住）。零代码，写进 [`SCENE-BRIEF-TEMPLATE.md`](SCENE-BRIEF-TEMPLATE.md) | [`REFERENCE-video-use.md`](REFERENCE-video-use.md) §3.4 |
| 1-26 | **`anim cuts`：切点两侧 ±1.5s 固定出图** | 现在的三点采样是 15%/50%/85%，**不落在切点上**；要知道切点长什么样得手写 `--only`。`sheet --only` 已有全部零件。对方还给了配套的两条流程纪律（**零代码**）：自检**最多 3 轮**、3 轮不过就交人；对外发布前派一个"**roast, not to praise**"的审查者（给按时间码排序的问题清单 + 证据） | [`REFERENCE-video-use.md`](REFERENCE-video-use.md) §3.3 |
| 1-27 | **运动规则表 `docs/MOTION.md` + 3 个 kit 函数** | 我们有很好的"原子函数库"（`src/kit/`），缺的是**"什么时候用哪个"**的判据 —— 照 `AGENTS.md` §5.5 那张"按画面需要什么选 3D"的表推广到运动本身。具体的**调参成果可以免费拿走**：三段式位移 `10/65/25`（尾部 ≥3× 加速段）、碰撞式转场的受害者时长 = 入侵者的 `40–50%`、"**到达不要用淡入，要用二值出现**"、`items × stagger ≤ ~0.5s`。加 3 个 kit 函数（`nudgeCurve` / stagger 上限告警 / 辉光峰值上限），上限类判据大多**静态可查**（不必渲染） | [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §4.4（对方 `nudge-curve` / `waterfall-entry` / `reactive-displacement` 与 40+ 条原子规则） |
| 1-28 | **"输出词 → 含义 → 修法"表**（把一个诊断词连到一条动作） | 我们的 `check` / `verify` / `shake` / `probe-*` 输出里已经有一批术语（"非有限值：NaN n / Inf n"、"背景守门"、"空档"、"段内亮度不均"），但没有一张**集中的**对照表。对方的关键做法是：**诊断输出里的词，与"教怎么修"的词，必须是同一份词表**（否则 agent 拿到 `flat` 不知道该干嘛）。`AGENTS.md` §8/§10 末尾那两张表已经很接近，扩成三列并覆盖全部探头即可 | [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §3.2(d) 与 §4.5 |
| 1-29 | **工具小账**：`anim shots` 的 `--json`（机器可读的模板参数表，给 1-21 的 spec 与将来的 catalog 用）；`out/<任务>/NOTES.json`（同构的评论文件：`{id, run, at, text, resolved}`，`at` 是秒） | 两条都极小。`--json` 是 1-21 的前置；`NOTES.json` 让"第 12.5 秒这里字幕太小"这类反馈有个落点（对方的 Studio 就是这么做的：评论是**普通项目文件**，读写走文件、不轮询不重编译） | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §5.5（`FEEDBACK.json`）· [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §4.1 |

> **§1.B 里不建议做的**（列出来免得以后又想起来）：镜头包 npm 分发（我们是单仓、8 个模板 —— 先把 1-21 的 spec 写对）、
> 分布式 / 云渲染（我们的瓶颈是 GPU 填充率，搬上 CPU 云只会更慢；分块已经有 `--segments`）、
> GUI 的时间反向求解器（我们的作者读代码，改时间就是改代码）、
> 任何引入生成模型 / 素材目录的机制（会毁掉确定性保证与"不需要素材"的定位）、
> DOM 盒子式的布局审计与超时属性豁免（我们的画面没有盒子；而且**豁免会静默地多关掉几条别的检查** ——
> 我们已有的 `world: false` 是受控豁免，将来加豁免必须写明"这还会关掉什么"）。
> 另外三条**对方比我们弱、不要倒过来学**：DOM 副本式运动模糊（我们是逐子帧物理积分）、
> "允许有累积状态"的 seek 确定性模型（我们是纯函数）、逐词高亮 / 人脸驱动的字幕（与 [`CAPTIONS.md`](CAPTIONS.md) 的实验结论正面冲突）。

### 1.C 素材能力（**还没做，也没有排期** —— 只是想清楚了一半）

| # | 事 | 现在能确定的 | 还不知道的 |
|---|---|---|---|
| 1-30 | **从已有素材里挑片段**（裁切 / 拼接真实视频段，即 B-roll 那一层） | ① 我方的**结构性优势不能弄丢**：现在是"一次编码、无接缝、字幕画在后处理之后、每帧可 seek"；② 真做素材裁切时，"预烘焙视频段拼进成片"必撞的五条硬规则已经拆出来了（字幕必须在滤镜链**最后**、逐段抽帧后无损 `-c copy` 拼、每个接缝补 30ms 音频淡入淡出、overlay 用 `setpts=PTS-STARTPTS+T/TB` 落位、母版字幕按输出时间轴偏移）——我们**已经对了三条**，不会返工；③ 必须先决定**素材段的合成层级**（在 ffmpeg 层拼好当"底"、代码镜头合成上去？还是把素材当引擎里的一张图层？）—— 前者会失去"代码镜头逐帧可 seek"的便利 | 值不值得做（用户目前是"大量可视化的科普/介绍片"，不是实拍剪辑）；观众反馈里到底缺不缺"真实画面" |

> **还没做、也还没排期的一条**：**一条旁白出多语言版本**。现在 `VOICE` 一行换音色、`say`+`mix` 重跑即可；
> 多语言要重写整份 `SCENE` 文案与 `words` —— 先等 **1-23**（`variants` + `narration.json` 可指定）落地再谈，
> 否则会做两遍。

---

## 2. 内容 / 片子

| # | 事 | 说明 | 出处 |
|---|---|---|---|
| 2-1 | **用第 ③ 种（Three.js 真网格）做一支真片子** | 方向是"需要大量可视化的科普/介绍视频"。开拍时建议先照 `tasks/_three-lab/scenes/_stage.js` 把"舞台"（世界原点 / 摄影机 / 包围盒）钉死，再往里填内容 | [`STATUS.md` §19.7](STATUS.md) · [`THREE.md`](THREE.md) |
| 2-2 | **`tasks/nekoseek` 立项与否** | 见 §0-4 | — |

---

## 3. 磁盘与临时件（确认成片没问题就可以删）

| 路径 | 大小 / 说明 |
|---|---|
| `out/sodium/sodium.parts/` | 33 块 ≈ **13 GB**；成片已重出且 `verify` 过了 |
| `out/sodium/_diag_*.png` | 5 张诊断帧 |
| `out/_three-lab/_three-lab.mp4` | 393 MB 沙盒成片，留着看接缝 |
| `out/_staging/` | `probe-solidity.mjs` / `before/` / `sheet-*.png` / `orig/` 等临时件 |
| `out/_refs/world-execute-web/` | **参考项目克隆**（`git clone --depth 1`，8.1 MB，随时可重克隆）—— 2026-10 拆解用 |
| `out/_refs/shots/` | 参考项目 16 张实测截图 + `_sheet.png` 联络表（1920×1080，约 5 MB） |
| `out/_refs/src-glob/` | 从对方构建产物里提取的 **160 份原始源码**（含被构建剥掉的设计注释） |
| `out/_staging/world-execute/` | 四份子系统深读报告（A 视觉 / B 播放器 / C 引擎 / D 数据与 AI 协作）+ 131 份章节源码 |
| `out/_postlab/` | 后处理 A/B 的帧、对比图与实测数据（`ab/` `ab2/` 是原始帧，`ab-visual.png` 是七组对比图）。**`ab.mjs` / `ab2.mjs` 是那两个读数脚本**（把帧读进浏览器 canvas，量亮度阶梯/暗部黑位/霓虹饱和），下次调后处理可以直接改一改复用；要长期留就整理进 `tools/` |
| `out/_docbackup-20261007/` | **2026-10-07 整理文档之前的完整备份**（25 文件 / 1.5 MB）—— 确认整理无误后可以删 |

> 删之前都可以用 `node scripts/anim.mjs clean <任务>` 或手工删；`out/**` 不在版本控制里。

---

## 4. 已经关掉的（历史遗留，别再翻）

这些在旧文档里被写成"没做"，后来都做掉了 —— 列在这里是为了不再被重新提起：

| 事 | 哪一轮做的 |
|---|---|
| B 档「配置档」（时间线里直接写 `{ type: 'chart', … }`） | 第八轮，[`STATUS.md` §15](STATUS.md)（§14.6 里还写着"这是路线图的下一步"） |
| `src/kit/blocks.js`（3D 线段 + 深度排序 + `facesToward` + 盒子/排线 + 连续摄影机 + 世界切片） | 第四轮 §4 A，已落地 |
| `src/kit/panel.js`（2D 面板层：`panel` / `tile` / `chips` / `arrowH` / `bufBox`） | 同上 §4 B，已落地 |
| 摄影机关键帧支持**按段名 + 段内秒**（`{ id: 'ctm', at: 3.0, … }`） | 同上 §4 C，已落地（`src/kit/blocks.js`） |
| "**alpha 管在不在，tone 管亮不亮**"写进 COOKBOOK | 同上 §4 E → [`COOKBOOK.md` §2.5](COOKBOOK.md) |
| `docs/SCENE-BRIEF-TEMPLATE.md` 成文 | 同上 §6 → 已成文（并补了"本片必须与上一支不同的三项"） |
| "用 `anim say` 真做一支带旁白的片子" | `beast` / `sodium` / `optifine` 三支都用了 `anim say`（§13.4.8 写这条时还没有样本） |
| 整份 `regress-all` 没跑 | 已跑：**32/32 通过**（`node tools/regress-all.mjs`，约 12 分钟） |
| `--segments` 收尾截掉视频尾巴（`-shortest`） | 第四轮 §1 已修并验证，同源两处（`renderParallel` / `renderToFile`）也补了 `-af apad` |
| 导入模型 `.glb` / `.gltf` | **用户明确说不需要**（几何全部程序化）；将来要加不用返工（`setup(ctx)` 本来就是异步的） |
