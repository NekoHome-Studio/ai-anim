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
> 最后整理：**2026-10-10 深夜（第九轮 · 两批）**。第一批「守门 / 工具」：1-2 / 1-3 / 1-16 / 1-19 / 1-20 / 1-28 / 1-29；
> 第二批「纪律 / 能力」：1-4 / 1-6 / 1-9 / 1-10 / 1-21 / 1-22 —— 两批都**已落地并移入 §4**。
> **1-1 核实后剔除**：直接接线会做成一个"永远绿"的假覆盖（今天没有任何 `tasks/` 用 `src/kit/blocks.js`，理由见该行）。
> 同一轮还按核实结果更正了 5 处与代码不符的描述（§0-3 / §0-5 / §1-1 / §1-5 / §1-10）。
>
> **第十轮（2026-10-16）：第九轮记下的 ①–⑨ + `1-5` 全部收掉**，逐条证据见 §4 末尾那一段。
> 一句话概括这一轮：**把"没验"变成"能判"** —— 依赖令牌 `under` 接线（段级审计）、
> 背景守门与引擎同口径并多采一个时刻、`--scan-nf` 的 4K 代价与 `--parallel` 第一次实测、
> 死链接注释 91 处改到 `docs/history/`。**过程中量出一个真 bug 与一个假报**：
> ① `sheet-audio --sheet` 的栅格行数写死 4×4（8 格的接触表 ⇒ 7 格落在图外）；
> ② 背景守门第一版把"窗后中点"也压了同一条判据 ⇒ `check demo` 把**设计如此**的甩镜尾巴报成"没铺背景"。
> 两个都修了、都补了离线判据（`tools/test-timeline-audit.mjs`）。
>
> **本轮记下的新待办（两条都是"判据的假阴性/假阳性"，别丢）**：
> ⑩ **`values: [0.3, 0.7, 0.95]` 这种纯数字数组两边都不认**（1-31）：判据 ① 只认**字面量数字**、
> 判据 ③ 只认**算出来的**，而"数组里逐个写死的数字"恰好落在中间 —— **本仓库的图表任务全是这个写法**，
> 也就是说那串数**实际上没人验**。要不要把 `values` 的元素也纳入判据 ①（代价：所有图表任务都会染红，
> 得逐个登记进 FACTS.md）是个**取舍**，不是纯技术问题。
> ⑪ **`String(cnt).padStart(2, '0')` 里的补零字符 `'0'` 会被当成显示位字面量**（1-32）：
> 它其实是格式参数，不是画面上的数字。消掉要改判据 ① 的"实参里任意字面量"口径，
> 会动**所有任务**的条数（这一轮没做，夹具里刻意留着并登记了一行 `0`）。
>
> **2026-10-16 深夜 · 待办复核（第十二轮：用户逐条拍板）** —— 起因是"我感觉有些不需要了"。
> 本轮只动**清单 / 磁盘 / 一处注释**（`tasks/nekohome/scenes/_kit.js` 顶部），**不动任何画面与引擎行为**。
> **关闭 5 条**（全部移进 §4，注明"用户拍板不做"）：`0-1`、`0-2`、`0-3`、`0-4`（含 §2-2）、`0-7②③`。
> **主线定为「先补引擎与工具能力」**（不是先出下一支片子）：已拍板要做的 `0-5`（`src/shots/` 加模板）
> 与 `0-6`（后处理新参数用起来）也按这条主线排。
> **其余全部保留、没有做优先级削减**：§1（`1-1` / `1-7` / `1-8` / `1-24` / `1-25` / `1-26` / `1-27` / `1-31` / `1-32`）、
> §1.A（`1-11` ~ `1-15`）、§1.B（`1-17` / `1-18` / `1-23`）、§1.C（`1-30`）、§2-1。
> 磁盘：`out/` 的中间产物已按 §3 清掉（7 个任务、释放 29.4 GB，55 GB → 27 GB）。
>
> **2026-10-16 · 0-5 落地（镜头库加模板：8 → 11 个）** —— `quote` / `counter` / `compare` 三个模板已进 `src/shots/`。
> 这一条**不只是"照 `title.js` 抄三个文件"**：还要动 `src/shots/index.js`（登记）、`tools/test-shots.mjs`
> （模板集合是**手写**的、`typeOk()` 原来不认 `object[]`、一条夹具把 `quote` 当"不存在的模板名"用 ⇒ 顺着红出来）、
> 以及 10 处文档 / 注释里的"8 个模板"。**顺带被出图抓出来的三处画面问题**（都已修，证据在 §4 那一行）。
> 新增夹具 `tasks/_shots-lab/`（6 段：三个模板的默认画面 + 三个非默认分支）。
>
> **2026-10-16 深夜 · 便宜小包（§1.B-25 / 1.B-26 / 1.B-27 + 第二轮清磁盘）** —— 主线（0-6）之外的四件小事一次收掉：
> ① **`anim cuts`**：切点两侧 ±1.5s 各出一张接触表（三点采样一个都不落在切点上），画着信号色方框的那格就是切点；
>    两条流程纪律（自检最多 3 轮 / 发布前派只挑毛病不夸的审查者）进 `AGENTS.md` §10.12。
> ② **并发子代理 brief 模板**：`docs/SCENE-BRIEF-TEMPLATE.md` §10（纯新增 104 行）。
> ③ **运动规则表 + 3 个 kit 函数**：`docs/MOTION.md` + `src/kit/motion.js` + `tools/test-motion.mjs`（42 项，挂 `unit:motion`）。
> ④ **清磁盘**：`out/` 27.6 → 25.9 GB（释放 1.77 GB）。
> ⚠ 顺带发现并处理：`AGENTS.md` 已经顶到工作区的**指令字节预算**（65536 B）—— 这轮加的内容一度把尾部约 1 KB
> 挤成静默截断，已把新增压到最小并合并几处重复表述（现在 64829 + 本轮新增，余量不足 600 B）。**下次再往里加
> 契约之前先瘦身**（把"想做真 3D""旁白/口播"这类已有专题文档的整节改成指针）。

---

## 0. 拍板区（2026-10-16 复核后只剩下面**一条**"已定要做"；其余已关闭或已做 —— 见 §4）

| # | 事 | 状态 / 代价 | 出处 |
|---|---|---|---|
| 0-6 | **后处理新参数真的用起来**（`tonemap` / `dither` / `bloomKaris` / `grainScale`） | **已定：做**（2026-10-16 用户拍板）。四个参数已进引擎，**默认值全部等于现状**（`hashes demo` / `beat` 各 11/11 `max 0` 验过）。实测：现状的软肩在输入 1.0 就输出 254、2.0 并到纯白（高光**没有层次**）；`tonemap: 'agx'` 配 `exposure: 0.75` 能把高光拉回来（1.0→200、2.0→238、4.0→247）且暗部反而更沉（均值 75.1→73.5），**代价是霓虹去饱和**（橙 253,253,120 → 237,218,151）；`'aces'` 是折中（1.0→232，霓虹 248,241,131）。**做法**：下一支片子的高光多镜头先用它出 A/B 图再定（`tasks/_post-lab/` 是现成的标定夹具） | [`ENGINE.md` §5](ENGINE.md)（参数表）· `tasks/_post-lab/`（标定夹具）· `out/_postlab/`（本轮实测数据与对比图） |

---

## 1. 引擎 / 工具（已确认还开着）

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-1 | **`check` 增加几何自检**：随机取几个"已知应该可见"的面，验证"被铺的面 = 朝镜头的面" | 这类"不报错但画面全错"的几何 bug 目前**只能靠眼睛**（`facesToward` 反向那次出图核对了 20+ 帧才定位到）。判据可以先做成纯 JS 的（`tools/test-blocks.mjs` 已有正反用例可复用）。<br>⚠ **2026-10-10 核正：先解决「假覆盖」再动手** —— 今天**没有任何 `tasks/` 引用 `src/kit/blocks.js`**（老任务各自带一份私有拷贝），所以直接把它接进 `check` 会做出一个**永远绿**的检查（在现有任务集上不可能被触发）。要么先迁一个任务过来用 kit，要么专门做一个夹具任务 —— 否则这条等于没做 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **F**（⬜ 未做） |
| 1-7 | **渲染提速的后续三档**（按性价比） | ② `readPixels` 走 GPU 编码 + 8bit 回读（6.4 → 5.2ms，但接受 sRGB 舍入差 1 LSB，**会动基线**）；③ PBO 异步回读（把 5ms 藏到下一帧）；④ WebCodecs（收益最大、传输量 −314×，但要**重做出片流程**） | [`STATUS.md` §16.7](STATUS.md) · [`PERF.md`](PERF.md) |
| 1-8 | **`dur: { vo }` 只能配内联旁白表** | 外部 `narration.json` 是页面启动后才 fetch 的，`build()` 时还没有表。想做"配置档 + 外挂旁白表"要先改这个时序 | [`STATUS.md` §15.5](STATUS.md) |
| 1-31 | **`lint-fabricated-numbers` 判据 ③ 的假阴性：`values: [0.3, 0.7, 0.95]` 这种纯数字数组元素两边都不认**（判据 ① 只认字面量数字、③ 只认算出来的） | 本仓库的图表任务**全是这个写法** ⇒ 那串数**实际上没人验**（子代理 2026-10-16 实测：6 个有事实表的任务 194 个显示位里，`values` 元素一个都没被两条判据覆盖）。要做就得把 `values` 的元素纳进判据 ①（代价：所有图表任务染红，得逐个登记进 FACTS.md）；**先想清楚要不要**，别顺手加。另两条同类假阴性：裸变量实参 `type.write(cnt, …)`、跨文件流向 | 子代理报告（2026-10-16）· `tools/lint-fabricated-numbers.mjs` 文件头的诚实清单 |
| 1-32 | **`String(cnt).padStart(2, '0')` 里的补零字符 `'0'` 被当成显示位字面量**（判据 ① 的假阳性） | 它其实是**格式参数**，不是画面上的数字。消掉要改判据 ① 的"实参里任意字面量"口径，会动**所有任务**的条数（本轮没做：夹具里刻意留着并登记了一行 `0`）。⚠ 改之前先量一遍"会影响几个任务、几条" | 同上 |
| 1-33 | **1-27 留下的一半：三个运动上限还没接进守门** | `src/kit/motion.js` 的三个函数目前只能**手动调** —— 错峰跨度（`items × stagger ≤ 0.5`）与辉光峰值（`≤ 0.45`）都还是"要自己想起去调"。`REFERENCE-hyperframes.md` §4.4 说这类上限**大多静态可查**（读场景源码里的 `stagger` / `alpha` / `bloom` 字面量），所以下一步是接进 `check` 的静态扫描（照 `tools/lint-fabricated-numbers.mjs` 的形状：纯函数判据 + 夹具 + 挂 `regress-all`）。**同源的另一条**：碰撞式转场"受害者时长 = 入侵者的 40–50%"现在只写在 `docs/MOTION.md`，要变成函数得先给 `enterOffset` / `transitionPass` 开入口 | 子代理报告（2026-10-16）· [`MOTION.md`](MOTION.md) §4 · [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §4.4 |

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
| 1-17 | ★ **词锚定时间线**：让作者写"说到『兽语』时切镜头"，而不是 `cue: 0.6` / `internal: 4.2` 这类猜出来的秒数 | 四步：① `narration.mjs` 的 `SCENES[].lines[]` 加 `on: { word, edge: 'start'\|'end' }` 与 `reveal: { at: { line, word, edge } }`（**抄语义不抄 XML 标记** —— 我们的输入已经是结构化 JSON）；② 新纯函数 `resolveNarration()`：输入脚本 + `narration.json` 的 `words` → 输出**现有的 `timing.mjs`**（`slot`/`stretch`/`overlap`）+ 一份 `anchors.json`，**场景侧一行都不用改**；③ **必须实现左右亲和**（词间那段停顿归前一句还是后一句 —— 不实现就被静默归错且不报错）；④ 求解顺序 = 锚点 → 段内时刻 → 再算 `stretch`/`slot`，**段内偏移要跟着乘 `stretch`**。边界与风险：每段限 2–3 个锚点（锚点太多就变成另一种秒数）；**锚点只表达"在哪个词上做什么"，永远不能表达"持续 3 秒"**（否则 `stretch` 失去唯一解）；中文分词对不上时**抛错并列出该句所有可用词**（与现有报错哲学一致）；无词级时间戳时降级回秒，并**在 `check` 里警告"这一段改词不会自动重排"**。验收：扩展 `node tools/test-say.mjs`（纯 JS、不联网、不需要 GPU） | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §2 与 §5.1（对方 `packages/script`、`narrative-temporal`、`timeline-author`）；⚠ 它"等长、不许拉伸"**不要抄**（我们靠 `stretch`） |
| 1-18 | ★ **`check` 加画面语义断言**：`tasks/<任务>/motion.json` 声明 `appearsBy(段, 秒)` / `before(段A, 段B)` / `keepsMoving(段, maxStaticSec)` / 帧边缘不许有硬内容 —— 让"该出现的没出现 / 顺序反了 / 整段没动"变成可 gate 的错误 | 落在 `check` 已有的逐段试渲染 + 三点采样里；段级统计量复用 `scripts/lib/shake.mjs`（**把"只看 post.shake"扩成"看整帧"** 就得到帧间变化量）。⚠ 需要**相邻帧**而不只是孤立采样点，所以试渲染时间会涨（先实测）。对方两条元设计必须一起抄：**"严重性持久性感知"**（只在单点出现的入场瞬态降级为 info、永不 gate；跨采样点保持才 gate）与 **"空 ≠ 干净"**（见 1-19） | [`REFERENCE-hyperframes.md`](REFERENCE-hyperframes.md) §4.2（对方 `sweep_static` / `motion_frozen` / `motion_appears_late` / `motion_out_of_order` / `canvas_content_at_edge`） |
| 1-23 | **`variants` 覆写 + `narration.json` 可显式指定**：同一支片子出多个版本（换风格 / 换配色 / 换语言 / 剪短版） | ① `task.config.mjs` 加 `export const variants = {…}`，CLI 加 `--variant`：深合并覆盖 + **产物与块缓存按 variant 分目录**（`narration.json` / `timing.mjs` / `video --segments` 的块，**不分目录就会串味**，这是最容易出 bug 的地方）；② 更值钱的是后半：让 `narration.json` 成为**可显式指定的输入**（"这一段用上次那份词级时间戳，不要重新合成"）—— 改一句词现在会导致**整片重渲**，有了它，换风格/换顺序的变体可以**零 TTS 成本**重出 | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §5.4（Source/Run 分离 + 显式复用 Output） |
| 1-24 | **`--parallel` 先说清事实、再决定动不动**：现有两个已知毛病 + 并发度上限 + 收益要重测 | ① 它**静默忽略 `--segments`**（CLI 里 `--parallel` 分支在 `--segments` 之前 return）、只转发 10 个参数（`--idle` / `--force` / `--keep-raw` / `--only` 不生效）—— 这是 1-19 同类的"静默降级"；② 并发度现在硬编码 `2..8`，应按 `min(cpu-2, 内存/3GiB, 段数)` 起算并**默认不开**（对方经验值：**一个 Chrome 按 1.5GiB 预留、只准用一半内存**）；③ **收益必须先量**：NV12 之后实测 4 进程 720 帧 **6.1 fps < 单进程 7.5 fps**（瓶颈在传输与核显争用），所以"多进程"不是免费加速。**可抄的只有它的 `distributeFrameRange`（十行：连续块、可从任意帧开工），不要抄它的调度器** | [`REFERENCE-hypit.md`](REFERENCE-hypit.md) §4.1/§5.3（`ordered-frame-sink.ts` / `concurrency.ts`）· 本地实测见 [`PERF.md`](PERF.md):67–74（"并行渲不同区间：⚠ 历史结论，已不是首选"） |

> **§1.B 里不建议做的**（列出来免得以后又想起来）：镜头包 npm 分发（我们是单仓、11 个模板 —— 先把 1-21 的 spec 写对）、
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

---

## 3. 磁盘与临时件（确认成片没问题就可以删）

> **2026-10-16 复核：`out/` 曾合计 55 GB；当夜按用户拍板清掉了全部 `*.parts/` 等中间产物 ——
> 7 个任务、释放 29.4 GB，现在合计 27 GB。** 下面这张表是**清理后**的读数：
>
> `node scripts/anim.mjs clean <任务>` 的**默认档就是删这些**（`*.parts/`、裸帧、`concat.txt`、
> `_dumpframe` 这类诊断目录），**成片 / stills / hash 基线 / `NOTES.json` 一律不删**；`--all` 才连成片一起删。
> ⚠ 代价：**下次 `video --segments` 会全部重渲**（分块本来就是断点续渲用的）。

| 任务 | 目录（清理后） | 这一轮删掉的 |
|---|---|---|
| sodium | **8.1 GB** | 11.7 GB（`*.parts/` 33 块 + `_dumpframe/`） |
| optifine | **7.1 GB** | 11.5 GB（`*.parts/` 38 块） |
| beast | **4.0 GB** | 55 MB（`*.parts/` + `concat.txt`） |
| fidus | **2.0 GB** | 3.2 GB（`*.parts/` 15 块） |
| promo | **1.7 GB** | 2.5 GB（`*.parts/` 12 块） |
| example-config-only | **309 MB** | 566 MB（`*.parts/` 7 块） |
| `_calib` | 84 MB | 2.4 MB（`*.parts/` 7 块） |
| `_style-sampler` / `_nv12test` / demo / `_three-lab` / `_staging` | 1.4 GB / 594 MB / 483 MB / 432 MB / 322 MB | —（这一轮**没动**） |

**下面这些还可以删**（用户这一轮只选了"删 `*.parts/`"，所以它们都还在）：

| 路径 | 大小 / 说明 |
|---|---|

> **2026-10-16 深夜 · 第二轮清理（跟着 §1.B-25/26 那个小包走的）**：上面那张表里的
> `_style-sampler/`（1.4 GB）、`_staging/`（322 MB）、`_postlab/`（42 MB）、`_refs/`（24 MB）、
> `_docbackup-20261007/`（1.6 MB）、`sodium/_diag_*.png` + `bed.mono22k.wav`（25 MB）、以及 `out/` 根目录
> 散落的 `_dbg*.mjs` / `_measure.mjs` / `_b-smoke.mjs` / `_commit*.txt` / `_err.txt` —— **全部已删**，
> `out/` **27.6 GB → 25.9 GB（释放 1.77 GB）**。`_postlab` 的那两个读数脚本没有丢，已搬进
> `tools/probe-post-ab.mjs` 与 `tools/probe-post-ab2.mjs`（默认仍读 `out/_postlab`，可用环境变量 `POSTLAB`
> 覆盖；0-6 要用）。**没动的**：`_nv12test/`（594 MB）、`demo/`、`_three-lab/`、`_calib/`、`_probe*/`、
> `_ref/`、`_look/`、`check/`、`dev/`、`final/` —— 没核过它们还有没有用，**别顺手删**。
> 删之前都可以用 `node scripts/anim.mjs clean <任务>`（默认档）或手工删；`out/**` 不在版本控制里。
> **别删 `out/<任务>/NOTES.json`** —— 它是评论（"第 12.5 秒这里字幕太小"这类反馈）的唯一落点，`clean` 结构上就碰不到它。

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
| `anim say` 标点对齐判据收窄（只差标点不再报警，漏**实义**字符才报） | **第九轮**（2026-10-10，`839d0b1`）：判据从"跳过字符数 > 0"改成"跳过**实义**字符"；90 句真实旁白 **90/90 → 0/90** 命中，三条契约（拼回原文 / 真时间戳 / 不退化近似）仍 90/90；注入真异常时恰好那 1 句报出 |
| `check` 的「空 ≠ 干净」（`skipped:`）+ 产物守门按「已知原因 / 原因未知」分档措辞 | **第九轮**（`9693291` `afccab1` `5432cf6`）：5 个"没跑成"的落点一律进 `skipped:`（按 `what` 聚合 ×N），结论行永远带"另有 N 项没跑"；`--strict` 才把它变成非零（**默认不改退出码**）。离线单测固化在 `tools/test-check-skipped.mjs`（24 项，含**静态接线自检**） |
| 音频响度数字守门（LUFS / true peak / LRA） | **第九轮**（`ca53061` 库 + `099eec3` 接线）：`measureLoudness` / `assessLoudness` / `formatLoudness` 在 `scripts/lib/media.mjs`；`anim check`（对 `packaging` 轨）与 `anim mix` 各报一次，靶子 **-14 LUFS / -1 dBTP**。**只报数字，不 gate、不自动归一化**（归一化 = 所有带旁白片子重出）。量具 `tools/test-loudness.mjs`（34 项）；实测 `sodium-mix.mp3` = **-20.9 LUFS / -2.96 dBTP / LRA 8.3** |
| `tools/sheet-audio.mjs`：接触表 + 波形 + 静音带 + **旁白词级标签** + 时间标尺叠进同一张 PNG | **第九轮**（`314c290` `33f2754`）：**不重新渲染**（从已有成片 mp4 抽帧，不起 Vite / Chrome），横轴共用同一时间窗。sodium 实测 `out/sodium/sheet-audio_0-12_vo.png`：22/28 词标签画出、揭晓落在 8.80–9.60s（与设计 `cue × stretch = 9.557s` 对得上）。边界：**只在决策点调用，不拿它当扫描工具** |
| `docs/DIAGNOSIS.md`（输出词 → 含义 → 修法 三列表） | **第九轮**（`64b85cd` `fea8566` `e919a7a`）：211 行三列表；词全部 grep 自代码，每条带 `文件:行号` + 函数名；另有 §2 退出码语义、§3「空 ≠ 干净」的读法、§5 已知分叉。`AGENTS.md` §8 / §10 各加一行链接，§10 清单补了判据型命令与 `--quick` / `--strict` |
| `anim shots --json`（机器可读的模板参数表）+ `anim note`（`NOTES.json` 评论文件） | **第九轮**（`a5f9a37` `2fb8e7a` `002e7ec`）：schema `anim.shots/1`，字段契约在 `ENGINE.md` §14.9（**它是 1-21 的输入契约**，`requires` / `outputs` 的位置已留好）；`anim note` 读写 `out/<任务>/NOTES.json`，`anim clean` **绝不删它** |
| 出片路径也能发现非有限值（1-4） | **第九轮**（`0773383`）：扫描挂在**页面侧**（出片推的是 NV12，帧里已无浮点信息），扫那一帧自己的 float RT、**不额外渲一帧**，走既有 `diag` 文本通道上报（**不参与帧计数**）。一次扫描 40ms、**默认每 30 帧一次（实测 +0.35%）**——`engine.js` 那句"只给诊断用、不进每帧渲染路径"被数字推翻：不进每帧，但每 30 帧便宜到可以默认开。`--scan-nf 0` 关、`--nf-stop` 扫到就停（默认只报告不中断）。顺手修掉：提前收工后在途帧写已 `end()` 的 stdin 会**崩进程**（`ERR_STREAM_WRITE_AFTER_END`） |
| `anim say` 的批量容错：失败也继续、最后统一补跑（1-6） | **第九轮**（`71a39cb` `e4e1f70`）：失败不抛 → 记 pending → 整批跑完后统一补跑（最多 2 轮、每轮隔 2s）；失败句**不写表**（0 时长混进去会让 slot 静默算错）。顺手修了两个真 bug：重试额度不是"每句"的（报告说 3 次、实际给 5 次）、偶发 `--write-words` 失败会**永久**关掉后面所有句的词级时间戳。`test-say.mjs` 78/78 |
| 配置档 `post` / `world` / `maxSamples` 的首个真实用例（1-9） | **第九轮**（`72d68dd` `8cb1e1b`）：新夹具 `tasks/_config-lab/`（只有 `task.config.mjs`，30.70s / 5 段）。实测出三个字段各自的坑（**模板 `render()` 返回的 post 会盖掉同名的键**、`world: false` 不进守门表、`maxSamples` 只往下压且合法档只有 8·3ⁿ）与**守门口径不齐**（见头部 ①）。`docs/CONFIG-ONLY.md` 新增 §3.1 |
| raymarch vs 投影线段批的同段成本对照（1-10） | **第九轮**（`f5f4865`）：走廊段实测 **raymarch 0.83 fps vs 线段批 1.26 fps = 1.52×**（整片口径只有 1.07×，因为那段只占 23%）。⚠ 同时记了**画面差异**：raymarch 有软阴影 / AO / 雕刻排线，线段批是纯线框 —— 便宜的那版是**少给了这些**。数据在 `docs/PERF.md` §6 |
| 镜头模板的声明式 spec + `check` 依赖前置校验（1-21） | **第九轮**（`de22220` `9ed47a6` `7ad2b4d` `537fd92` `abe393e`）：8 个模板各带 `requires` / `outputs`；`anim shots --json` 长出 `requireTokens` / `requires` / `outputs`（schema 仍是 `anim.shots/1`，只加字段）。`check` 在 `openSession` **之前**静态校验：模板要 `music` 而任务没配 `audio` ⇒ **errs**（退出码 1）；配了没跑 `analyze` ⇒ **skipped**（提示）。`test-shots.mjs` 106 项。⚠ `under` 令牌未接线（见头部 ②） |
| **第九轮头部记的 9 条 + 1-5（第十轮全部收掉）** | **第十轮（2026-10-16）**，逐条： |
| ① 背景守门口径与引擎不齐 | 守门与段级审计都读 `it.handlesTransition ?? 场景那份`；`anim audit _config-lab` 实测由 `handlesTransition=n` 变 **`=Y`**（`src/app.js` 的 `worldAudit()`） |
| ② `under` 令牌只声明、没接线 | `shot()` 把模板的 `spec.requires` **搬到场景对象**（`src/shots/index.js`）→ 纯函数 `auditUnderRequires()`（`src/timeline.js`）→ 页面侧 `__anim.underAudit()` → `check` / `anim audit` 打印并分档：**没有交叠 ⇒ errs**（画面几乎是黑的且不报错）、**第 1 段 / `--only` ⇒ skipped**（明说「没判」）、交叠了但没声明 `handlesTransition` ⇒ 一行提醒。离线判据 `tools/test-timeline-audit.mjs`（26 项，含接线自检） |
| ③ 「算出来的数字」判不出来 | `tools/lint-fabricated-numbers.mjs` 新增**判据 ③**：模板串插值 / 字符串拼接 / `String()` / `.padStart()` / `.toFixed()` / `values` 里的变量，**单列一段并明说「没验」**（0 处也打一行）；**退出码语义不变**（不进 `unmatched`）；`--json` 长出 `tasks[].computed` / `skippedComputed` / `summary.computed`。真任务实测 **38 处**；自测 139 → **183 项**；夹具 `tools/fixtures/lint-numbers/tasks/zz-fake-computed/` |
| ④ `analyzeTaskAudio` 缺 ffmpeg 只 warn 一句 | 返回值从裸 `null` 改成 `{ file, skipped, message }`（`no-audio` / `no-ffmpeg`）；`cmdVideo` 显式报「这一次渲染里 f.beat / f.a 全是 0」，`cmdCheck` 在没有 ffmpeg 时进 `skipped`（`音频分析（analyze）`） |
| ⑤ `measureLoudness` 没有 `-t` 截断 | 新增 `{ seconds }`；`check --quick` 用它只量前 60 秒。**实测**（sodium-mix，246s）：整条 6.9s → 前 60s **1.7s（省 76%）**，读数确实会变（真峰 -2.96 → -4.52 dBTP / LRA 8.3 → 6.5）⇒ 必须打出来。⚠ 关键坑：`-t` 必须是**输入侧**选项（放输出侧 muxer 只写 1.5s，但滤镜图仍吃到整条轨 —— 单测 `tools/test-loudness.mjs` ⑦ 当场抓出来的） |
| ⑥ `sheet-audio --sheet` 没对着真产物验过 | 验的过程**抓到一个真 bug**：栅格行数写死 4×4 ⇒ 8 格（4×2）的接触表被按 4×4 复算、**7 格落在图外**。修法：行数由 PNG 高度解出来（`guessSheetTile(W,H,cols)`），并在排版前就把源栅格解好（以表里的实际格数为准）。sodium 8 格表实测切成 4×2、22/28 词标签画出（图见 `out/_staging/sodium-sheet-8tiles.png`） |
| ⑦ `worldAudit` 只采交叠窗中点 | 采样计划抽成纯函数 `planWorldAudit()`：每段采**两个**时刻（交叠窗中点 **判** + 窗后中点 **只读数**）。⚠ **第一版把同一条判据也压在窗后点上，`check demo` 当场假报**（甩镜尾巴按设计就是 0.037–0.051）—— 判定改成纯函数 `worldAuditVerdict()` 并且**只判第一个点**，单测钉死这个假报 |
| ⑧ 4K `--scan-nf` 代价没实测 / `--parallel` 没跑过 | 都实测了，写在 `docs/PERF.md` §7：单次扫描 1080p **+38ms** → 4K **+152ms**（**4.0× 线性**，默认档在 4K 仍只 +1.8%）；`video _style-sampler --parallel 2` **第一次真跑**：1020 帧 / 4 段 / ffprobe 复核通过 / 实测 **1.75×**（887.3s 的工作量 508.8s 跑完） |
| ⑨ 注释里约 15 处死链 | 全仓库 **34 个文件 / 91 行**指向已归档 `docs/IMPROVEMENTS*.md` 的引用改到 `docs/history/…`（含**运行时会打印的输出词**，`docs/DIAGNOSIS.md` §1.6 / §5 已标已修） |
| 1-5 `probe-alpha` 注释里的 `max≈0.06` | 改成 **0.10**（`readPixels` 是 sRGB 编码后的显示空间，`lin2srgb(0.01) ≈ 0.1005`），并写明「**别照着它去改 blank** —— 把 0.10 掰成 0.06 会让 ⑤⑥ 两条判据集体失真」 |
| 「画面上的数字必须有出处」（1-22） | **第九轮**（`88a384d` `c0d15f6` `ff8f86b`）：`AGENTS.md` §10.10 硬规则 + `docs/FACTS-TEMPLATE.md`「★ 数字的硬规则」；`tools/lint-fabricated-numbers.mjs`（判据限定"数值显示位"，没有 `FACTS.md` 的任务**安静跳过**）。实测 6 个有事实表的任务 / 194 个显示位 / 10 个命中（**全是没登记的镜号**）。自测 + 夹具在 `tools/fixtures/lint-numbers/`，已挂 `unit:lint-numbers`（**不是 gate**，与 `lint-narration-dup` 同例）。⚠ **第十轮把自测从 139 项扩到 183 项**（新增判据 ③，见上）—— 这一行里的 139 是当时的数字 |
| **顺带修掉的两个"回归自己的"问题**（跑整份 `regress-all` 时暴露的） | ① `tools/probe-tts-edge.mjs`：TTS 服务端挂掉（edge-tts 全线 **403**）时 `runSay()` 不抛、只把 `timing` 留成 `null`，探针却直接读 `res.timing.scenes[0]` ⇒ 崩成 `TypeError`、**退出码 1**，而它自己的契约写的是"连不上会「跳过」退出码 2"。现在没拿到表就明说跳过（+ 一行首句失败原因）、退出 2。<br>② `tools/regress-all.mjs`：新增**第三种结局 `SKIP(没跑)`**（只对显式声明 `allowSkip: true` 的项、退出码 2 生效；别的工具里 2 是用法错，不能一刀切）。汇总里单独列「跳过 N 项（没跑 ≠ 通过）」，**不计入真失败**。顺手把 `tools/test-loudness.mjs`（39 项）挂进清单（`unit:loudness`）—— 之前它**不在**回归清单里 |
| **钠那期三条外部批评变成判据（0-7 方案 1）** | **第十一轮（2026-10-16）**：新增 `src/layout.js`（纯函数判据）+ `tools/test-layout.mjs`（31 项）+ [`docs/LAYOUT.md`](LAYOUT.md)；`check` 多一段「版面守门」，复述率接进 gate。逐条见下面「第十一轮的验收证据」 |
| 一屏几块字（读数面板算一块）| `src/core/text.js` 的 `noteText` 记实际绘制 → `gl.paint.blocks` → `textGroups()` 单链聚类（阈值**随字号缩放**：`min(gap, 较小字号×0.8)`，地板 12px）。判据 ① `maxBlocks=6`：钠 `glass` 一帧 **9 块 / 49 次绘制**被点名 |
| 「不知道要看哪个主体」| 判据 ② `maxOffSubject=2`：主体 = 落在 `focus` 里的块 ∪ 最大的一块，按**图连通**合成「看的地方」。⚠ **不要求声明 focus** —— 钠 12 段全没声明，这条照样点名 11/12 段 |
| 「元素互相遮挡」| 判据 ③ `maxInFocus=2`：只对声明了 `focus` 的段跑；没声明 ⇒ `check` 进 `skipped`（**没判 ≠ 通过**）。`focus` 三处写法（场景 / `cut()` / 配置档节点）都接了 |
| 版面母题豁免 | 页眉（y ≤ 11.5%H）与说明条+脚注（底边 ≥ 90%H）**既不算判据也不算读数**。没有它的话钠每段都必然超限，判据立刻变噪声（实测：加上之前 7/12 段「超限」里有一半是页眉） |
| 复位述率 gate | `lint-narration-dup` 的命中在 `--strict` 下进 `errs`（默认仍只 warn）。钠实测 `[旁白复述] 12 句旁白被逐字写进画面` |
| **顺带抓到并修掉的两个 bug** | ① `TextKit` 上**没有 `gl`**（`Layer2D` 只存了自己的 `this.gl`）⇒ 记账判据恒假、`blocks` 永远是空的**而且不报错**；`paint.layer` 原来存的是 Layer2D（也不匹配）—— 靠一个探针才查出来。② `--strict` 一跑就 `ReferenceError: errs is not defined`：复述率那档 `errs.push` 而 `errs` 在它下面几十行（TDZ），被 catch 吞成假 skipped ⇒ 改成**先攒进 `staticErrs`、后面统一并** |
| `check` 现在会逐条打印为什么红 | 以前只打一行「✗ 有 N 个问题」（数字有、理由没有）。新增 12 条上限的明细段，`reportErrors()` 早就是这么做的 |
| **用户拍板不做（2026-10-16 深夜 · 待办复核）** —— 以下五条是**用户明确决定不做**的，别再翻出来 | 第十二轮 |
| 0-1 `tasks/nekohome` 的 `disp()/dcss()/dscale()` 颜色绕行**不回改**；只在 `_kit.js` 顶部把注释更正为"历史绕行补丁，不是设计要求"（**已改**） | 第十二轮 |
| 0-2 `sodium` 12 句 / `optifine` 3 句**画面文字逐字复述旁白不返工**（已交付；复述是观感打折，不是错误） | 第十二轮 |
| 0-3 `kinetic` 模板"居中长行顶出右边"**不修**（修它会改 `demo` 的画面，要重存 hashes 基线） | 第十二轮 |
| 0-4 / 2-2 `tasks/nekoseek` **不立项**（前置分析留在 `tasks/nekoseek/ANALYSIS.md`；它仍不是任务） | 第十二轮 |
| 0-7②③ 钠差评后续的两支样片（60–90 秒单主题 / 「一页一图」最小样张）**不做**（① 版面守门已落地） | 第十二轮 |
| 磁盘：`out/` 的 `*.parts/` 等中间产物已清（7 个任务、释放 29.4 GB）—— §3 的表已换成清理后的读数 | 第十二轮 |
| **0-5 镜头库加模板**（`quote` / `counter` / `compare`；8 → 11 个） | **2026-10-16**：`src/shots/{quote,counter,compare}.js` + `index.js` 登记 + `tools/test-shots.mjs`（手写的模板集合、`typeOk()` 新增 `object[]`、一条把 `quote` 当"不存在的模板名"的夹具改成 `quote2`）+ 10 处文档/注释。**验收**：`tools/test-shots.mjs` **124/124**；`hashes demo` / `hashes beat --baseline` 各 **11/11 max 0**（老片子逐像素没变）；夹具 `tasks/_shots-lab/` 6 段 `check` 通过、逐帧出图看过（出图当场抓出三处画面问题：居中引文的最长行顶出屏幕、`counter` 长读数几乎占满、`compare` 两行版行距 270px 空掉一大片 —— 三条都已修并复验） |
| **1.B-26 `anim cuts`**（切点两侧 ±1.5s 出接触表） | **2026-10-16**：`scripts/anim.mjs` 新增 `cmdCuts`，`writeContactSheet` 向后兼容地多出 `samples`/`shutter`/`marks`（`check --sheet` 行为不变）；配套两条流程纪律进 `AGENTS.md` §10.12。验收：`anim cuts _shots-lab` 真跑（6 段 5 个切点，产物 5 张接触表）+ 出图看过；顺带修掉一个**既有 bug**：`check <任务> --sheet` **不带值**时 `opt('sheet')` 返回 undefined ⇒ `path.resolve(ROOT, undefined)` 直接崩（AGENTS.md 里那条用法一直没被跑过；现在缺值走默认路径、`--sheet --quick` 也不会把下一个 flag 当成值）。同轮还修了三处"接线自检"把**注释首行**当切片锚的脆弱写法（改成锚 `async function writeContactSheet`）|
| **1.B-25 并发子代理的 brief 模板** | **2026-10-16**：`docs/SCENE-BRIEF-TEMPLATE.md` 新增 §10（349 → 453 行，`git diff --numstat` = 104/0 纯新增）；三条要点各带 `REFERENCE-video-use.md` 的行号出处 |
| **1.B-27 运动规则表 + 3 个 kit 函数** | **2026-10-16**：`docs/MOTION.md`（12 条规则 + 四级证据分级）、`src/kit/motion.js`（`nudgeCurve` / `waterfallStagger` / `waterfallOver` / `glowPeakCap`）、`tools/test-motion.mjs`（42 项，已挂 `unit:motion`）。⚠ 数值是外部项目 hyperframes 的**经验值、我方未实测**；**留下的一半**（三个上限未接进守门）记成 §1.B-33 |
| **第二轮清磁盘** | **2026-10-16**：`out/` 27.6 → 25.9 GB（释放 1.77 GB）；`_postlab` 的两个读数脚本搬进 `tools/` |

---

### 第十一轮的验收证据（都能重跑）

```sh
node tools/test-layout.mjs                     # 31 项通过（纯函数，不需要 GPU）
node scripts/anim.mjs check sodium --strict    # 三条批评全部点名（见下表），退出码 1
node scripts/anim.mjs check sodium             # 默认只 warn：退出码 0（回归清单不被染红）
node scripts/anim.mjs hashes demo --baseline   # 11/11 max 0（判据不动画面）
node scripts/anim.mjs hashes beat --baseline   # 11/11 max 0
node tools/regress-all.mjs --only unit         # 含新增的 unit:layout
```

`check sodium --strict` 的「✗ 为什么红（12 条）」逐条对上三条外部批评：

| 观众的原话 | 判据输出 |
|---|---|
| 「不如纯看字幕了 / 不明所以」 | `[旁白复述] 12 句旁白被逐字写进画面`（43 句里 28%） |
| 「元素相互遮挡，不知道要看哪个主体」 | `[版面守门] glass：一屏 9 块文字（上限 6）；主体之外还有 7 个「看的地方」（上限 2）` |
| 「一屏的东西太多 / 建议做成 PPT」 | `⚠ 版面守门：11/12 段一屏的东西太多`（cull 8 块 / threads 8 块 / vram 7 块） |

⚠ 一条**没验**：`版面守门·主体声明（focus）` —— 钠 12 段都没声明主体，判据 ③ 在它身上跑不了。
这是**设计的**（12 段都能一眼看出主体，补 `focus` 是"下一支怎么写"）；`skipped` 里点名了它。

---

### 第十轮的验收证据（都能重跑）

```sh
node scripts/anim.mjs check _config-lab            # ✓ 含 world:false 那一栏的读数 + 「依赖 under」1/1
node scripts/anim.mjs check _config-lab --only whip # ✓ under 审计正确报「没判」并进 skipped（退出码仍 0）
node scripts/anim.mjs audit _config-lab             # 两个采样时刻 + world=self 一栏 + handlesTransition=Y
node scripts/anim.mjs check demo --quick            # ✓（修掉"窗后中点"那个假报之后）
node scripts/anim.mjs hashes demo --baseline        # 11/11 max 0（引擎侧改动没有动画面）
node scripts/anim.mjs hashes beat --baseline        # 11/11 max 0
node tools/regress-all.mjs --only unit              # 14/14（含新增的 unit:timeline-audit）
node tools/test-timeline-audit.mjs                  # 26 项
node tools/test-loudness.mjs                        # 39 项（新增 ⑦：-t 的位置与真截断）
node tools/test-fabricated-numbers.mjs              # 183 项（原 139）
node tools/regress-all.mjs                          # 整份：**48 通过 + 1 跳过（环境）+ 0 真失败**
```

整份 `regress-all`（**49 项**）**这一轮真跑了两遍**：第一次是 **47/48、真失败 1** —— 那 1 项就是
`say:real-tts`（edge-tts 服务端全线 403 ⇒ 探针崩成 TypeError）。修掉探针 + 给回归器加
`SKIP(没跑)` 之后，这一项**正确报成"跳过（没验）"**，不再是"失败"。
⚠ 按 §1 的口径：**"跳过"要写出来，不能读成"通过"** —— 真 TTS 这条路这一轮**没有验过**。
