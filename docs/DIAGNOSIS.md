# DIAGNOSIS —— 输出词 → 含义 → 修法

> **一条纪律：诊断输出里打印的那个词，和这张表里教你怎么修的那个词，必须是同一个词。**
> 出处：`docs/REFERENCE-hyperframes.md` §3.2(d)（对方的 Error Handling 表：左边是诊断词，右边是可执行动作）
> 与 §4.5 第 4 条（"每个诊断命令必须给出'输出里的词是什么意思' + '看到这个词怎么修'"）。
> 否则 agent 拿到一个 `flat`，根本不知道该干嘛。

**这张表里的每个词都是从代码里 grep 出来的**，每条带 `文件:行号`（`anim.mjs` 那份是快照，见下一条）+ 函数名。
判据：把第一列反引号里的原句片段拿去 grep，**必须命中** —— 命不中就说明代码改了，回来登记（见 §4）。

- **行号只对一部分文件可信**：
  - `src/**`、`tools/**`、`scripts/lib/shake.mjs` 的行号**是准的**（写表这一轮它们没被改）。
  - `scripts/anim.mjs` 的行号**只当方向**：写表期间它正在被并行重写，同一小时内 4090 → 4535 → 3965 → 4550 行
    （`docs/BACKLOG.md` 1-19 的收尾提交 `9693291` / `afccab1` / `5432cf6` 就在这一轮）。
  - 所以**以第一列引号里的原句为准**（§7 有现成 grep 配方）；`anim.mjs` 的行还都标了**函数名**
    （`cmdCheck` / `cmdVideo` / `scanScenes` …）—— **函数名比行号稳**，重构之后也还在。
- 第三列**只给动作**：一条命令 / 一个文档章节号 / 一处代码位置。查到词就照做，不必回去猜病因。

---

## 1. 主表（输出词 / 含义 / 修法）

### 1.1 `check`：结论行与"没通过"的行

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `✗ 有 N 个问题（另有 N 项**没跑**，见上面的 skipped）`<br>`scripts/anim.mjs` 的 `checkVerdictLine()`（`grep -n 'function checkVerdictLine'`） | `check` 的收尾结论行，N 件事没通过；括号里是"没验过"的项数 | 往上翻 `←` 开头的行 —— 每一条都点名了段名 / 时刻 / 判据；改完重跑 `node scripts/anim.mjs check <任务>`。退出码 1 |
| `✓ 没有发现问题（skipped: 无）（单子帧与多子帧两条路径都验过了）`<br>同上 + `cmdCheck` 的收尾 `log` | 收尾结论行，全部通过，且没有任何一项被跳过 | 这才叫过。接着走 `AGENTS.md` §10 的清单（`still` 抽帧 + 真的用 Read 看图） |
| `skipped: 无（这次体检的每一项审计都真的跑了）`<br>`scripts/anim.mjs` 的 `formatSkipped()` | ✅ **唯一的"确实全跑了"**。这一段**永远出现**（哪怕没跳过）—— 否则"确实全跑了"和"这段整个没执行"在输出里长得一样（BACKLOG 1-19） | 无（这是正面的） |
| `skipped: N 项没跑 —— 这些地方**没有验过**，不要当成通过：` + `  · <是什么没跑>[ ×N]：<为什么>` + `  （想让"有跳过"变成非零退出：加 --strict —— 默认不改退出码，见 docs/BACKLOG.md 1-19）`<br>`scripts/anim.mjs` 的 `formatSkipped()` / `pushSkipped()` | ⚠ **"空 ≠ 干净"**：背景守门 / 旁白复述 / 多子帧路径 / 非有限值扫描 任一项没跑成，都进这一段。同一件事失败多次会聚合成 `×N` 一行 | **不许当成通过**：逐条按 `why` 修（页面失联 / 工具退出码 2 / 子进程起不来…），修完重跑；要把它当门就加 `--strict`（默认不改退出码，回归清单依赖这一点） |
| `✗ 有 N 个问题（另有 M 项**没跑**，见上面的 skipped）`（`--strict` 下"有跳过"也算失败）<br>`scripts/anim.mjs` 的 `checkVerdictLine()` + `--strict` 分支 | 你加了 `--strict` 且有 skipped ⇒ 退出码 1 | 要么把 skipped 清掉（多半是页面/工具没跑成），要么去掉 `--strict` 并**在报告里写明哪一项没验** |
| `← ⚠ 非有限值：NaN n / Inf n / 量级>5e4 n 像素（首个坏像素 x=… y=…，kind）`<br>`scripts/anim.mjs:1335`（`cmdCheck`） | 某段某时刻的**浮点读回**里出现了 NaN / ±Inf / 巨值。8bit 读回和 `stats()` 都分不出它，所以这一条是直接读浮点缓冲点名的 | 先看紧跟的两行提示：最常见来源是**相机 uniform 全 0**（`cam3Uniforms` 字段名写错）与 `pow(0, 负数)`；raymarch 用 `node tools/probe-raymarch.mjs` 复现。见 `AGENTS.md` §5.5 末条 |
| `这是「整屏白 / 单帧白多帧黑」的一类根因`<br>`scripts/anim.mjs:1336` | 上面那条非有限值的解释行 | 同上；这条同时在说"别去查累加 bug，先修非有限值" |
| `← 几乎是全黑，场景可能没画东西`<br>`scripts/anim.mjs:1346`（`cmdCheck`） | 采样点平均亮度 `mean < 0.004` | 这一段没铺背景或没画东西：`cut(shot, { world: 'auto' })` 让引擎铺底，或自己在 `render` 开头 `gl.clear` + 画一次全屏 Pass。看图：`node scripts/anim.mjs still <任务> -t <该时刻> --only <段>` |
| `← ⚠ 过曝（>0.99 占 x%，死白 y%）`<br>`scripts/anim.mjs:1353`（`cmdCheck`） | 多子帧路径下亮度顶到 0.99 以上的像素 >20%，或死白 >15% | 先降 `exposure`（1 = 不变）、或换 `tonemap: 'agx'`（配 `exposure: 0.75`）；只有"信号色"才允许去泛光。参数方向见 `AGENTS.md` §5 的后处理表 |
| `← ⚠ 两条路径不一致（N×）：这是运动模糊求平均/累加的问题`<br>`scripts/anim.mjs:1360`（`cmdCheck`） | 同一时刻"单子帧"与"多子帧"的平均亮度差超过 1.3× | 先看下一行那条"但这一帧同时有非有限值"—— 有就先修它；没有才是真的累加 bug，用 `node scripts/anim.mjs dumpframe <任务> -t <时刻> --samples 2` 对照两条路 |
| `⚠ 但这一帧同时有非有限值 —— 先修那个`<br>`scripts/anim.mjs:1364`（`cmdCheck`） | 上一条的方向纠正：累加 pass 会丢掉 NaN/Inf ⇒ "单帧白、多帧黑" | 按非有限值那条修（相机 uniform / 除 0 / `pow(0,负数)`），别去查运动模糊 |
| `← ⚠ 段内亮度不均（lo → hi）：查入场的头 1 秒和收尾`<br>`scripts/anim.mjs:1375`（`cmdCheck`） | 同一段三个采样点里最低 `mean < 0.02` 而最高 `> 0.06` —— 一个亮点能把单点判据顶过去，所以要三点一起看 | 查这一段**入场头 1 秒**与**收尾**：是不是文字还没出来 / 已经淡掉了。`still -t` 抽这三个时刻的图看 |
| `⚠ 背景守门：N/M 个交叠段**没有铺满整帧的背景**`<br>`scripts/anim.mjs:1244`（`cmdCheck`） | 声明了 `handlesTransition` 或 `world` 的交叠段，整帧覆盖绘制次数为 0 ⇒ 那一段的底是纯黑，而亮度统计抓不到 | 三选一（下一行就是原文）：① `render` 开头画一次全屏背景；② 时间线写 `cut(shot, { world: 'auto' })`；③ 刻意不铺底就显式写 `world: false` |
| `[id] t=…s  整帧覆盖绘制 N 次（本帧总绘制 M 次），声明了 handlesTransition`<br>`scripts/anim.mjs:1246` | 背景守门的明细行：点名是哪一段、哪个时刻 | 用 `node scripts/anim.mjs audit <任务>` 看这一段在交叠期到底画了什么；`--debug` 会打出每次整帧覆盖的来源 |
| `背景守门：N 个交叠段都铺满了整帧背景（其中 K 段声明了转场/共享背景）`<br>`scripts/anim.mjs:1254` | 背景守门**通过** | 无事。`AGENTS.md` §10.1 要求这一行出现在交付前的 `check` 里 |
| `⚠ 场景在渲染时抛异常：N 帧`<br>`scripts/anim.mjs:1391`（`cmdCheck`） | 渲染期（不是装载期）场景抛异常 —— 这是**硬失败**，不是附注 | 下面几行是异常首行；复现用 `still --only <段> -t <时刻>` 看图（那些帧是错帧卡片）。历史上 beast 那轮三次采样全绿就是漏了这条 |
| `⚠ 时间线有空档（这些时间段会渲染成黑色）`<br>`scripts/anim.mjs:564`（`reportErrors`） | 两段之间有时间没被任何段覆盖 | 补段或改 `dur` / `at`；用 `cut(scene, { dur: { beat: 16 } })` 之类让时间线自己排。判据的实现在 `src/core/engine.js:339`（`没有场景（会渲染成黑）`） |
| `⚠ 有错误：`<br>`scripts/anim.mjs:560`（`reportErrors`） | 装载期的问题清单（时间线重叠顺序、`end <= start`、场景没加载成功…） | 逐条读；实现在 `src/core/engine.js:326` 的 `validate()`（`场景没加载成功` / `只有 …s，不到一帧` / `起点比上一段还早`） |
| `⚠ 画面文字在复述旁白 —— 同屏两套完整句子就是观众说的"两条字幕"`<br>`scripts/anim.mjs:1154`（`cmdCheck`） | `lint-narration-dup` 报了命中（`check` **只 warn 不 fail**，见 `:1144`） | 画面文字只留标注（名词 / 数字 / 单位 / 出处）；句子交给旁白与字幕（`docs/CAPTIONS.md`）。交付前必须跑到零命中：`node tools/lint-narration-dup.mjs <任务>` |
| `画面只留标注（名词 / 数字 / 单位 / 出处），句子交给旁白与字幕；见 docs/CAPTIONS.md`<br>`scripts/anim.mjs:1156` | 上一条的修法提示行 | 按它做；`docs/CAPTIONS.md` 是这一层的规格 |
| `⚠ lint-narration-dup 没跑成：…`<br>`scripts/anim.mjs:1158` | 那个工具以退出码 2 退出（工具自己出错），**不是"没命中"** | 单独跑一遍看它为什么失败；这条不改变退出码（1-19 之后会进 `skipped:` 段） |
| `（旁白复述检查跳过：…）`<br>`scripts/anim.mjs:1169` | 子进程起不来（受限沙箱 EPERM / 超时）⇒ **这一项没验** | 在有权限的环境里单独跑 `node tools/lint-narration-dup.mjs <任务>`；别把它读成"干净" |
| `一支片子有 N 句旁白，但**没开字幕层**`<br>`scripts/anim.mjs:1203` | 有旁白表但 `captions` 没开 ⇒ 观众看不到语音字幕 | `task.config.mjs` 加一行 `captions: true`（`docs/CAPTIONS.md`）；开了之后**别再烧一遍 `.ass`** |
| `⚠ N 句字幕**跨越了场景切换**（规范要求字幕不得跨 scene change）`<br>`scripts/anim.mjs:1226`（`cmdCheck`） | 某句说完 + 停留时间超过了它所在段的结束（Netflix 计时文本规范） | 让这句说早一点 / 说短一点，或把这一段放长 —— **段长本来就该由旁白决定**（`docs/NARRATION.md`）。片段尾最后一句豁免 |
| `⚠ …`（`ctx.warnings` 原样打印）<br>`scripts/anim.mjs:1207` | 场景/kit 自己攒的警告。最典型的是 `"x"（x=…, y=…, 字号 …）压进了**字幕保留带**`（`src/kit/bands.js:106`） | 把那个面板 / 计量条移出字幕保留带（默认顶部居中 y 40–104，见 `docs/CAPTIONS.md` 与 `src/kit/bands.js`）；保留带是留给引擎字幕的保留区 |
| `--quick：每段只采 50% 一个点、只跑单子帧（冒烟用；完整体检请去掉 --quick）`<br>`scripts/anim.mjs:1279` | 你加了 `--quick` ⇒ 这次**没看**多子帧路径、也没看入场头 1 秒 | 冒烟可以，**别拿它当交付判据**；交付前去掉 `--quick` 再跑一次 |
| `每段：15% / 50% / 85% 三个点，各测单子帧与多子帧（成片走的路径）`<br>`scripts/anim.mjs:1280` | 完整 `check` 的采样口径（默认） | 无（这是说明行）。它告诉你"三个点都过了"才算过 |
| `分辨率 W×H×scale @fps  时长 X.XXs  N 段  bpm B`<br>`scripts/anim.mjs:1178` | `check` 的开头汇总 | 一眼核对"片长/段数"对不对 —— 伪时间线（12 段 × 默认 4s = 48s）就是在这里露馅的 |
| `GPU: …` / `⚠ unmasked renderer 不可用…` / `⚠ 无法渲染到浮点纹理：本引擎需要 EXT_color_buffer_float（HDR 渲染）`<br>`scripts/anim.mjs:1179` `:1100` `:1102`（`cmdGpu`） | GPU 信息行；后两条是环境能力缺失 | 浮点纹理缺失 = 这台机器的 WebGL2 不能跑 HDR 渲染，换机器 / 换 `--gpu high`；见 `docs/PERF.md` §2① |
| `时间线（段名 / 时长 / 起止）`<br>`scripts/anim.mjs:1182` | 段名 + 时长摊开打印 | 段名就是 `--only` / HUD / 报错用的名字；写错时间线时在这一段就能看出来 |
| `音频：…`<br>`scripts/anim.mjs:1189` | 说清"节拍是从哪条轨测的" | 分轨写法里没有 `music` 会有提醒（`:2967`）—— 节拍会被旁白带偏，补上 music 轨再 `analyze` |
| `风格：<名字>（…）· 背景母题 …`<br>`scripts/anim.mjs:1195` | 这支片子实际用的风格包 | 相邻两支片子别用同一套（`docs/STYLE.md`，`AGENTS.md` §10.8） |
| `字幕：引擎字幕层已开 · 保留带 y … / x … · 说完再留 Xs`<br>`scripts/anim.mjs:1200` | 字幕层开着，并给出保留带坐标 | 画面元素别进保留带（见上面 `压进了**字幕保留带**` 那条） |
| `单帧 0.123  多子帧 0.456（24 子帧）`<br>`scripts/anim.mjs:1309` | 每个采样点的两个亮度读数 | 两者应当接近；差得多就是上面"两条路径不一致"那条 |
| `试渲染 N 段 × 3 个点 × 2 条路径（共 M 帧）用了 X.Xs`<br>`scripts/anim.mjs:1379` | 体检花了多久（`check` 是**真渲染**，不是静态分析） | 无（预算参考）。填充重的片子用 `--only` 缩小范围 |
| `浏览器控制台：`<br>`scripts/anim.mjs:1414` | 页面里的 console 输出（含 `[pageerror]`） | `[pageerror]` 一律算失败（`:1417`）；场景里的 TypeError 会先在这里露出来 |
| `✓ 接触表 out/<任务>/check/contact.png`<br>`scripts/anim.mjs:1411` | `check --sheet` 出的接触表 | 用 Read 工具打开那张图看全片；或用 `sheet` 单独出 |

### 1.2 静态扫描：铁律违规（`check` 第一步 & `scene-harness`）

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `Math.random() —— 换成 rng(seed)（离线渲染会乱序多次调用本函数）`<br>`scripts/anim.mjs:1480`（`scanScenes`） | 场景源码里出现 `Math.random(` | 改成 `setup` 里 `rng(seed)` 预计算。`AGENTS.md` §4 铁律表第一行 |
| `Date.now() —— 时间只能来自 f.t`<br>`scripts/anim.mjs:1481` | 同上，墙钟 | 用 `f.t` / `f.lt`；抖动要平滑就用 `shakeSmooth(f.t, amp)`（`src/core/cam.js`） |
| `performance.now() —— 时间只能来自 f.t`<br>`scripts/anim.mjs:1482` | 同上 | 同上 |
| `new Date() —— 时间只能来自 f.t`<br>`scripts/anim.mjs:1483` | 同上 | 同上 |
| `没有铁律违规（Math.random / Date.now / performance.now / new Date / 逐帧累积 / 按帧抖帧）`<br>`tools/scene-harness.mjs:1502` | 离线跑场的静态扫描干净 | 无事。这条比 `check` 的扫描多覆盖"逐帧累积"和"按帧抖帧"两类 |
| `Math.floor(t*60) 按帧抖帧 —— …逐帧抖动要用 f.idx；手持感用 shakeSmooth(f.t, amp)`<br>`tools/scene-harness.mjs:175` | 出现 `Math.floor(…*60)` | 按提示换写法；见 `AGENTS.md` §4 铁律表 |
| `逐帧累积状态（this.x += …）—— …把位置写成时间的函数：x = f(t - birth)`<br>`tools/scene-harness.mjs:176` | 出现 `this.xxx +=` | 把位置写成**时间的函数**（可任意 seek）；`AGENTS.md` §4 |

### 1.3 时间线 / 配置档：写错就抛

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `tasks/<任务>/task.config.mjs 的时间线不合法：`<br>`src/tasks.js:173` | 时间线构建失败的最外层包装（带文件名） | 读它下面那几行——真正的判据在 `src/timeline.js` |
| `timeline[i] 这一段（type: "…"）取不到镜头模板：`<br>`src/timeline.js:79` | 配置档节点写错（模板名或参数名） | 报错里就列了可用模板 / 可用参数；`node scripts/anim.mjs shots <名字>` 查参数与默认值。`AGENTS.md` §3.2 |
| `未知的镜头模板 "x"。可用的：title / chart / …（看参数：node scripts/anim.mjs shots <名字>）`<br>`src/shots/index.js:86` | 模板名拼错 | 照行内命令查；只有 8 个模板（`src/shots/`） |
| `镜头模板 "x" 没有参数 "y"（大概是拼错了）。可用参数：…`<br>`src/shots/index.js:95` | 参数名拼错（`value` vs `values`） | 照可用参数改；**这是刻意的抛错，不是静默吃默认值**（见 `src/shots/index.js:22`） |
| `时间线里不能混写「配置档节点」和「已经展开好的段」`<br>`src/timeline.js:265` | 同时写了 `{ type: 'chart', … }` 和手搓的 `{ id, scene, start, end }` | 统一成一种写法：都写配置档，或者都写 `cut()` / `seq()` |
| `你是不是忘了调 cut()？`<br>`src/timeline.js:324` | 时间线里塞了一个既不是 `cut()/seq()/par()` 返回值、也不是配置档节点、又没有时长的对象 | 补 `cut(scene, { dur })` |
| `[段名] 只有 0.008s，不到一帧` / `场景没加载成功` / `起点比上一段还早`<br>`src/core/engine.js:334` `:332` `:333` | `check` 的"⚠ 有错误："里会看到这三条 | 分别：把时长写够 / 修场景的 import 或语法错 / 修时间线顺序 |
| `0.00–2.35s 没有场景（会渲染成黑）`<br>`src/core/engine.js:339` | 时间线空档 | 补段或延长相邻段（`AGENTS.md` §10.5） |

### 1.4 场景异常与"错帧卡片"

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `✗ SCENE ERROR`（暗红底 + 贴边亮红框，画面中间写着段名 / 帧号 / 异常首行）<br>`src/core/engine.js:617` | 这一帧的 `render` 抛了异常，引擎画的是**错帧卡片**，不是内容 | 它是"看起来有内容"的一张图，别当成画面。用 `still --only <段> -t <时刻>` 复现，读控制台首行异常 |
| `那些帧画出来的是**错帧卡片**（暗红底 + 红框 + ✗ SCENE ERROR），不是画面内容。`<br>`scripts/anim.mjs:1393`（`cmdCheck`）/ `:1532`（`cmdStill`）/ `:3544`（`cmdVideo`） | 三条命令各自在收尾点名 | 同上；`check` 与 `still` 会置退出码 1，`video` 直接不出片 |
| `连续 N 帧场景抛异常，停止渲染（这段之后每一帧都会是错帧卡片）。` + `用 node scripts/anim.mjs check <任务> 复现，或 still --only <段> -t <时刻> 看图。`<br>`scripts/anim.mjs` 的 `cmdVideo` 推流循环（`ERR_STOP_AFTER`） | 推流途中连续出错，CLI 主动停 | 照它给的两条命令复现；**别直接重跑出片**（见下一条） |
| `这是**已知原因**（确定性）：场景代码在某个时刻抛异常，重跑不会有不同结果。` + `下一步：① 复现并点名：node scripts/anim.mjs check <任务>（会报段名与时刻）；② 看那一帧的图：…still…；③ 改代码 —— **不要直接重跑出片**：不修代码的重跑会得到同样的错帧卡片。`<br>`scripts/anim.mjs` 的 `knownCauseHeadline('scene')`（`cmdVideo` 的场景异常守门） | 成片守门发现渲染期抛异常 ⇒ **归为"已知原因（确定性）"**（BACKLOG 1-3） | 按三步做：`check` 点名段与时刻 → `still` 看图 → **改代码**。以前这里只说"复现"，读的人会顺手重跑一整片，白等而且产物照样被删 |
| `这是**已知原因**（确定性）：画面渲染到一半停了（断流/崩溃），同一份代码、同样的环境重跑会停在同一个地方。`<br>`scripts/anim.mjs` 的 `knownCauseHeadline('interrupted')` | "渲染到一半停了"这一类（不是场景异常，是断流/崩溃） | 见 §1.5 的 `只渲染了 N/M 帧` 那条 —— 它的「下一步」四步就是修法 |
| `这条不匹配任何已知的确定性根因，可能是瞬时的（磁盘满 / 内存耗尽 / 被外部中断 / GPU 掉线）。`<br>`scripts/anim.mjs` 的 `knownCauseHeadline()` 的兜底分支 | 上面两类都不匹配 ⇒ **可以重跑**，但先查那几件事 | 查磁盘 / 内存 / 外部进程，再重跑 |

### 1.5 出片（`video` / `shot` / `--segments` / `--parallel`）

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `只渲染了 N/M 帧，成片不完整，已删除 out/…。` + `ffmpeg 退出码 C。最近一次进展：…` + `这是**已知原因**（确定性）：画面渲染到一半停了（断流/崩溃），同一份代码、同样的环境重跑会停在同一个地方。` + `下一步：① 先看"最近一次进展"停在哪一帧…④ 长片子用 --segments 分块…`<br>`scripts/anim.mjs` 的 `cmdVideo`（`knownCauseHeadline('interrupted')`） | 渲染侧收到的帧数没齐（断流 / 页面崩 / HMR 重载）。**它被明确归为"确定性"** —— 所以直播这条路**不给"重跑"这个建议** | 按它自己的四步：① 看"最近一次进展"停在哪一帧（那附近就是断点）；② 渲染期间动过 `tasks/`、`src/` 下**任何**文件（含 `docs/*.md`）就是根因 → `AGENTS.md` §7；③ 否则看页面是否崩溃（`--headed` 看控制台）；④ 改完用 `--segments` 分块重跑，已渲好的块会保留 |
| `第 N 块 ffmpeg 退出码 C` + `这一类**不在"确定性失败"里** —— ffmpeg 非零退出可能是瞬时的（被外部中断 / 磁盘满 / 编码器掉线），也可能是确定性的（参数写错 / 编码器不支持）。` + `下一步：① 先看它最后打印的那几行…③ 再重跑同一条命令（其他块会跳过，只补这一块）。`<br>`scripts/anim.mjs` 的 `cmdVideo` 分块分支 | 分块渲染时 ffmpeg 自己非零退出（不是帧数不足，也不是产物不合格） | **这一档允许重跑**，但先做便宜的事：① 看 ffmpeg 最后几行（`out/<任务>/<任务>.parts/` 附近）；② 确认磁盘有空间；③ 再重跑（其他块会跳过）。与上面两档的区别就是"确定性 vs 可能瞬时" |
| `产物验收不通过，已删除 out/…：` + `· <问题>` + `（渲染侧收到 N/M 帧，ffmpeg 退出码 C）`<br>`scripts/anim.mjs` 的 `gateFailureLines()`（`grep -n 'function gateFailureLines'`；调用点：`cmdVideo` 的 `checkVideoFile` 分支） | ffprobe 复核真的写出来的文件失败（半截流 / 没写 moov / 帧数不符 / 帧率-时间戳不齐）。**分类头是新的**（BACKLOG 1-3） | **先读分类头，它决定"要不要重跑"**：<br>· `…失败：<哪一步><什么> —— 这是**已知原因**（确定性），重跑不会有不同结果。` → 照它下面的「下一步：①…」做，**别直接重跑**；<br>· `…失败：原因未知（可能是瞬时，也可能是没被识别出来的确定性根因）。` → 先看原始 `·` 行、查磁盘空间与 `out/` 有没有被别的进程（清理 / 同步盘）碰过，再考虑重跑 |
| `  重跑有意义（已渲好的部分会跳过）：但先按上面的「下一步」做一件事再跑，别原地空转。`<br>`  重跑**可能**有用（这类失败不保证可复现）；但先把上面那几件事查一遍再跑，别拿重跑当诊断。`<br>`  ⚠ 不要直接重跑同一条命令：这一步是确定性的，不修任何东西的重跑会得到**同样的**结果。`<br>`scripts/anim.mjs` 的 `decideGateFailure()` 的 `retryLine` | 守门报告的最后一句 —— **它本身就是"能不能靠重跑恢复"的判据**（以前一律写"重跑即可"，把人指偏过：拼接/封装那一步是确定性的，重跑只会白等） | 按它做：三种措辞 = 可重跑（分块路径，已渲好的块会跳过）/ 也许能重跑（未知原因）/ **别重跑**（确定性）。见 `docs/BACKLOG.md` 1-3 |
| `已知原因（确定性）：这个文件 ffmpeg 没写完 —— 半截流 / 没写 moov / 0 字节，渲染进程还没 finalize 就被结束了。`（分块路径会在"这个文件"前面多一句 `第 N/M 块（a–b s）的`）<br>`已知原因（确定性）：拼接 / 封装这一步出错，画面本身没问题（各块都已经单独通过守门）。`<br>`scripts/anim.mjs` 的 `decideGateFailure()` 的 `knownNext.encode` / `.stitch` | 分类头的第一种（`kind: 'encode'` / `'stitch'`）：**确定性**失败 | 它的「下一步」里就有判据：① 帧数差在个位数且带音轨 ⇒ 查 `-af apad` 与 `-shortest` 是否**成对**（AAC 记账时长比视频短几十毫秒，会把尾巴切掉）；② 差几十上百帧 ⇒ 渲染中途断流（渲染期别写文件）；③ 拼接 ⇒ concat 必须带 `-copyts`（`docs/PERF.md`） |
| `第 N 块的帧数不足（x/y 帧，a–b s），已删掉这一块。` + `最近一次进展：…` + `已知原因（确定性）：这一块**自己**少渲了 N 帧 —— 画面停在半路，多半是场景在某个时刻抛异常 / 页面在渲染途中崩了（HMR 重载也走这条路）。` + `下一步：① 先定位是哪一段、哪个时刻…② 出那一帧的图看…③ 渲染期间**一个文件都别写**…④ 改完再跑同一条命令…` + `其他已渲好的块会保留：…`<br>`scripts/anim.mjs` 的 `cmdVideo` 分块分支（`decideGateFailure({ phase: 'chunk' })`） | 分块渲染里某一块没渲完（画面停在半路） | **按它自己给的四步走**：① `node scripts/anim.mjs check <任务>`（点名段与时刻）→ ② `node scripts/anim.mjs still <任务> -t <时刻> --only <段>` 看图 → ③ 渲染期间一个文件都别写（含 `docs/*.md`，`AGENTS.md` §7）→ ④ 改完重跑同一条命令，**只补这一块**（已渲好的块会跳过，画面不必重渲） |
| `第 N 块的产物验收不通过，已删掉它：` / `第 N 段的产物验收不通过：`<br>`scripts/anim.mjs` 的 `cmdVideo` 分块路径与 `--parallel` 逐段守门（都走 `gateFailureLines()`） | 这一块 / 这一段的 ffprobe 守门失败 | 与上面同一套分类头 + 「下一步」；分块路径的 `retryLine` 会说"重跑有意义（已渲好的部分会跳过）"，并行路径的 `step` 会写成 `并行渲染（这一段）` |
| `渲染期间 src/ 或 tasks/ 下的源文件被改动了，out/… 已删除（画面混合了两个版本）`<br>`scripts/anim.mjs:3054`（`cmdVideo`） | CLI 拿 mtime 快照对比，发现模块图里的文件在渲染期间被改过 | **渲染期间一个文件都别写**；产出先落到 `out/_staging/`（`out/**` 是唯一被实测挡住的路径）。见 `AGENTS.md` §7 |
| `渲染期间这些源文件被改动了（会触发 HMR 重载 → 推帧可能提前结束）`<br>`scripts/anim.mjs:3480` | 推流路径的同类警告 | 同上；这条只说"可能"，但产物不该被信任 |
| `⚠ 分块参数与上一次不同，**全部重渲**（不复用旧块）：`<br>`scripts/anim.mjs:2678` | 渲染参数指纹或源文件变了 | 这是**故意的**（历史上这里静默复用旧块、秒完成还报 ✓）。确认参数是你想要的，让它重渲 |
| `⚠ 等 ffmpeg 排水超时：Xs 没有进展（已收到 n/N）`<br>`scripts/anim.mjs:3424`（`cmdVideo`） | 页面没卡，是编码器太慢 / 被抢了 CPU | 换 `--preset veryfast`、降 `--scale`，或换 `--vcodec h264_nvenc`（`docs/PERF.md`） |
| `⚠ 渲染停滞：Xs 没有任何进展（已收到 n/N）`<br>`scripts/anim.mjs:3428` | 真卡住：页面崩了 / WebSocket 断了 / 渲染期间改了文件 | 看紧跟的"页面推流状态 / 已连接客户端 / ffmpeg 退出码"三行；按提示先排除 HMR 重载 |
| `✓ out/… N 帧（ffprobe 复核 M 帧），用时 Xs`<br>`scripts/anim.mjs:3080` | 出片成功，且 CLI **自己**用 ffprobe 复核过 | 想再确认一遍：`node scripts/anim.mjs verify <任务>`（`AGENTS.md` §10.4） |
| `子帧分布 8子帧:12  24子帧:200 …`<br>`scripts/anim.mjs:3081` | 运动模糊实际吃到的子帧数分布 | 拖影有台阶 → 调小 `--tol`，或调小 `--shutter`（`AGENTS.md` §8 末行） |
| `[--dry-run] 先测速：整片均匀取 10 个时刻…` / `预估：N 帧（Xs @60fps）约 M 分钟`<br>`scripts/anim.mjs:2607` `:2614` | 只测速不出片 | 开渲之前先看这个数；`--samples 8` 压一压、或切段 |
| `⚠ 超过 20 分钟：建议 --segments 分块（可断点续渲）…`<br>`scripts/anim.mjs:2616` | 预估超过 20 分钟 | 照做：`node scripts/anim.mjs video <任务> --segments 10` |
| `⚠ 抖动看着像"振动"而不是手持（…）`<br>`scripts/anim.mjs:2865`（`cmdVideo` 收尾守门） | 出片收尾时抖动判据不通过（判据同 `anim shake`） | 见 §1.8；**不影响文件合格与否，产物保留**（`:2888`） |
| `并行渲染有 N/M 段失败`<br>`scripts/anim.mjs:4075`（`--parallel`） | 并行路径里有段挂了 | 已渲好的段保留在 `out/<任务>/_parallel/`；修完重跑，日志逐段在各自目录 |
| `逐帧数出 N 帧，期望 M 帧` / `并行拼接后的产物不合格：` / `并行拼接后的时间戳不合格：`<br>`scripts/anim.mjs` 的 `--parallel` 守门（都走 `gateFailureLines()`；时间戳那条还带 `hint: 'stitch'`） | 拼接路径的帧数与时间戳守门（**帧数对但时间戳漂了同样是废品**） | 分类头会说 `已知原因（确定性）：拼接 / 封装这一步出错，画面本身没问题（各块都已经单独通过守门）。`，并直接点名两种典型签名：尾部被切（`-af apad` 与 `-shortest` 没成对）/ 帧距不齐（concat 少 `-copyts`）。见 `docs/PERF.md` |

### 1.6 画面有没有变 / 是不是确定的

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `✗ N/M 个时刻与成片不一致。最可能的原因：…`（含 `判据 mean<18`）<br>`scripts/anim.mjs:2419` `:2423`（`cmdVerify`） | `verify`：成片抽帧 vs 同一时刻重渲，逐像素差超阈值 | 报错块里列了 5 个候选原因（成片是旧版本 / 拼接错位 / 子帧数不同 / 色彩空间 / 跨会话不确定），按顺序排除；`--tol 6` 可收紧 |
| `✓ N 个时刻（按帧号对齐）全部与重新渲染的结果一致（成片可信）`<br>`scripts/anim.mjs:2432` | `verify` 通过 | 无事。这是"成片可信"的机械证据 |
| `这个成片本身就有问题，先修它：`<br>`scripts/anim.mjs:2319`（`cmdVerify`） | 成片连 ffprobe 都过不了 | 重渲；或按列出的 reasons 修（`文件是 0 字节` / `moov atom not found` / `没有视频流`） |
| `与基线比对：out/<任务>/hashes.json（N 帧，W×H×s）`<br>`scripts/anim.mjs:1649` | `hashes --baseline` 的开头 | 无事（说明行） |
| `✗ N/M 帧与基线不一致（逐像素差异超出噪声范围）` + 行内 `✗ 变了  max … mean … >16 …% >32 …%`<br>`scripts/anim.mjs:1665` `:1663` | 重构后画面**真的**变了 | 判据是 `negligible()`：`>16 的像素为 0 且 mean < 0.002`（`scripts/anim.mjs:1749`）。变了就 diff 到具体段：`hashes <任务> --only <段>` |
| `✓ N 帧全部与基线一致（画面没有被改动）`<br>`scripts/anim.mjs:1666` | 重构没动画面 | 无事 —— 这是"证明画面没变"的正确方式（比人眼看图可靠） |
| `没有基线文件 out/…。先跑一次 --save。`<br>`scripts/anim.mjs:1647` | `--baseline` 但还没存过基线 | `node scripts/anim.mjs hashes <任务> --every 2 --save`（重构**之前**跑） |
| `基线装不下：已经攒到 NMB（上限 380MB）…→ 采样放稀：--every X`<br>`scripts/anim.mjs:1702`（`cmdHashes`） | 基线是单个 JSON，顶到 V8 字符串上限 | 照提示放稀采样（`--every`），或改用 `--times` 只挑每段中间时刻 |
| `✗ 有 N 个时刻在两种渲染顺序下不一致 —— 引擎里有跨帧状态（见 docs/IMPROVEMENTS.md 的确定性一节）`<br>`scripts/anim.mjs:1804`（`cmdProbe`） | `probe`：正着渲一遍、倒着渲一遍，同一 t 指纹不同 | 引擎里藏了跨帧状态（渲染目标残留 / 惰性编译 / 缓冲没清）。需要定位序列差异时用 `determinism`。⚠ 这条信息里的 `docs/IMPROVEMENTS.md` 已归档，真路径见 §5 |
| `✓ 渲染顺序不影响结果（同一 t 是纯函数）`<br>`scripts/anim.mjs:1787` | `probe` 通过 | 无事 |
| `✗ 存在跨帧依赖 —— 见上面"⚠ … 不同"的那几行：那就是根因所在。` + `第一个分叉在第 N 帧（t=…）`<br>`scripts/anim.mjs:1902` `:1871`（`cmdDeterminism`） | `determinism`：顺向 / 反向 / 单次 seek 三种序列不一致 | 看被点名的那一帧的 `samples / lastErrors / post / a` 哪一项不同 —— 那就是根因。这是 P1-2 的定位实验，别当成"偶发" |
| `差分（samples=1）  阈值：>8 与 >32 的像素占比`<br>`scripts/anim.mjs:1604`（`cmdDiff`） | `diff`：同一时刻渲两次差多少 | ⚠ **`diff` 只打印、不判定、退出码恒 0**（见 §3）—— 要判"变了没有"用 `hashes --baseline` |
| `· samples=1：这是单子帧，**只代表静止画面**，不代表成片的运动模糊`<br>`scripts/anim.mjs:1508`（`cmdStill`） | 你出单帧但没给 `--samples` | 查运动质量用 `sheet` / `shot`，或加 `--samples auto` |

### 1.7 `probe-alpha`（alpha 与旁白接线，9 条判据）

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `① t=0 不可见（mean … < 0.004）  → PASS/FAIL`<br>`scripts/anim.mjs:2228`（`cmdProbeAlpha`） | 整行淡入（数组型 `alpha: [0,1]`）在 t=0 应当看不见 | FAIL 时按 ②③④ 一起看；历史上这里是引擎 bug（`alpha` 只在 `stagger>0` 时参与动画），已修 —— 见 `docs/history/IMPROVEMENTS-1-3.md` |
| `④ t≥1 不再变（…）  → PASS/FAIL`<br>`scripts/anim.mjs:2231` | 淡入到 1 之后应当稳住 | FAIL ⇒ 检查 `stagger` / `t` 的传入（`src/kit/layout.js` 的 `fade()`） |
| `⑤ alpha:1（数值）画得出来（…）` / `⑥ alpha:0.5 是半透明常量（…）`<br>`scripts/anim.mjs:2242` | **数值型 alpha 的语义**：它是**常量不透明度**，不是"随 t 动画" | 两种写法语义不同，别写反：见 `src/kit/layout.js:63` 与 `docs/history/IMPROVEMENTS-4-5.md` |
| `⑤⑥ 数值型 alpha 用例没有拿到读数  → FAIL`<br>`scripts/anim.mjs:2245` | 用例没跑起来（不是"alpha 对"） | ⚠ 这是**没验**不是通过；看上面的异常输出 |
| `⑦⑧⑨ 旁白用例没有拿到读数（…）  → FAIL`<br>`scripts/anim.mjs:2271` | 旁白接线用例没跑起来 | 同上；正常时 ⑦⑧⑨ 会分别打印 `lines=` / `p=` / `peak` |
| `✗ alpha 没有随 t 动画 —— 检查 src/core/text.js 里 k 的计算条件`<br>`scripts/anim.mjs:2275` | ①②③④ 有一项失败 | 照提示看 `src/core/text.js`；`docs/history/IMPROVEMENTS-1-3.md`（原 IMPROVEMENTS P1-3） |
| `✗ 数值型 alpha 语义不对（IMPROVEMENTS-2 P0-1）—— …检查 text.js 里 alphaIsRamp / constAlpha 两行`<br>`scripts/anim.mjs:2279` | ⑤⑥ 失败 | 照提示看那两行；这是"数值 alpha 必须是常量"的判据 |
| `✗ 旁白层接线有问题（IMPROVEMENTS-2 P1-5）—— 检查 engine.load 有没有收到 narration、_ctxFor 有没有把 this.narration 挂到 ctx 与 f 上`<br>`scripts/anim.mjs:2284` | ⑦⑧⑨ 失败 | 照提示查那两处接线；`docs/NARRATION.md` |
| `✓ alpha 语义全对（数组型随 t 动画 P1-3、数值型是常量 P0-1）+ 旁白层已接通（P1-5）`<br>`scripts/anim.mjs:2289` | 九条全过 | 无事 |

### 1.8 抖动体检（`anim shake`，`video` 收尾共用同一套判据）

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `N 帧 · 峰值 x.xxpx · RMS x.xxpx · 逐帧变化 RMS x.xxpx · 比值 0.96 ⇒ 逐帧白噪声（像振动）`<br>`scripts/lib/shake.mjs:121` | 一行摘要，`kind` 四档：`平滑（像手持）` / `偏毛（半平滑）` / `逐帧白噪声（像振动）` / `基本没有抖动` | 「像振动」⇒ 把 `post.shake` 换成 `t` 的平滑函数：`shakeSmooth(f.t, amp)`（`src/core/cam.js`）。判据：**看逐帧变化量，不看幅度** |
| `逐帧变化量是幅度的 N%（白噪声指纹：每帧都在跳到新位置）—— 60fps 下这是**振动**，不是手持`<br>`scripts/lib/shake.mjs:104` | `kind === 'grain'`（比值 ≥ 0.35） | 同上；顺带自查 `hash2(f.idx, …)` 那类写法（`AGENTS.md` §4 铁律表倒数第三行） |
| `逐帧变化量是幅度的 N%，介于平滑与白噪声之间 —— 抖得偏"毛"`<br>`scripts/lib/shake.mjs:107` | `kind === 'mixed'` | 降频 / 降幅；0.5–2Hz 的慢漂移才是手持 |
| `收尾段幅度 x.xxpx，是中间段的 N×（镜头停住之后还在晃，最容易被看成"地震"）—— 让幅度随"停住"衰减，例如 amp * (1 - 0.75 * settle)`<br>`scripts/lib/shake.mjs:110` | 收尾幅度 > 中段 1.25× 且 > 2.5px | 照提示让幅度随镜头停住衰减。事故原文：用户说"最后那里都快和地震一样了"（`docs/history/IMPROVEMENTS-1-3.md` 第三轮） |
| `峰值 x.xpx 已经超过"手持"的量级（≤2px 呼吸 / 3–5px 手持 / ≥5px 冲击）`<br>`scripts/lib/shake.mjs:114` | 幅度 > 5px 且不平滑 | 按档位表调；`AGENTS.md` §5 的"抖动怎么给才对"有同一张表（单位是**物理像素**，4K 下要乘 `scale`） |
| `✓ 没有发现问题（抖动平滑、且没有"停住了还在晃"）`<br>`scripts/anim.mjs:3699`（`cmdShake`） | 抖动体检通过 | 无事。这条 **退出码 0**；有 notice 时退出码 1 |
| `分段（每段 X.Xs）：` + `a–b s  峰值 x.xxpx  逐帧变化 x.xxxpx` / `收尾段 / 中段幅度 = N.NN`<br>`scripts/anim.mjs:3701` `:3705` | 逐段读数 | 找"幅度只升不降"的那几段；用 `--from/--to` 只看那一段 |
| `⚠ N 个时刻 render 抛异常（这些帧的抖动按 0 计）：`<br>`scripts/anim.mjs:3688` | 体检途中场景抛异常 ⇒ 那些帧的抖动**没被量到** | 先修场景异常（`check` 也会点名），否则这次体检的结论不完整 |

### 1.9 旁白 / 字幕这一层

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `lint-narration-dup —— 画面文字有没有把旁白整句再写一遍`<br>`tools/lint-narration-dup.mjs:488` | 工具标题 + 判据（去标点/空白后字面量相等） | 交付前跑：`node tools/lint-narration-dup.mjs <任务>`，要**零命中**（`AGENTS.md` §10.9） |
| `<文件名>:<行号>  〔段 · 字符串〕` + `命中：「…」` + `源码：…`<br>`tools/lint-narration-dup.mjs:500` `:501` | 每一处逐字复述，报到 `文件:行号` | 把那句画面文字删掉或改成标注（名词 / 数字 / 单位 / 出处）；`docs/CAPTIONS.md` |
| `── 部分复述（只提示，不计入命中）：N 处`<br>`tools/lint-narration-dup.mjs:506` | 画面文字只是旁白句的一段 / 把整句包在更长的文字里 | **只提示**：不算命中、不影响退出码；但值得看一眼是不是"两条字幕"的另一种形态 |
| `合计：N 个任务 / M 句旁白，K 句被逐字写进画面（P%）`<br>`tools/lint-narration-dup.mjs:525` | 收尾汇总 | 有命中时**退出码 1**；`--json` 恒 0（调用方自己读 `summary.hits`） |
| `扫描到文件尾仍未闭合（源码里可能有含引号的正则）—— 这个文件的判据可能不准`<br>`tools/lint-narration-dup.mjs:514` | 那个场景文件的字符串扫描没闭合 | ⚠ 这是"这一项没验准"，不是"干净"；人工看那个文件 |
| `跳过 N 个任务（没有 audio/narration.json，也没有 audio/timing.json）：…`<br>`tools/lint-narration-dup.mjs:520` | 没旁白表的任务会被安静跳过 | 若这个任务**应该有**旁白表，说明 `say` 还没跑过 → `node scripts/anim.mjs say <任务>` |
| `建议：画面文字只放标注（名词 / 数字 / 出处），句子交给旁白与字幕。`<br>`tools/lint-narration-dup.mjs:535` | 收尾建议行 | 照做；`docs/CAPTIONS.md` |
| `没有这些任务：… 现有任务：…`（退出码 2）<br>`tools/lint-narration-dup.mjs:437` | 任务名打错 | 用 `node scripts/anim.mjs tasks` 列名字 |
| `词级时间戳与原文有 N 个实义字符没对应（不是标点："句"），已按顺序对齐（真时间戳保住了）`<br>`scripts/lib/say.mjs` 的 `alignWords` 调用点（`grep -n '实义字符没对应' scripts/lib/say.mjs`） | `anim say` 的**词级时间戳对齐**：驱动（edge-tts）漏报了某个**实义字符**（汉字/字母/数字）。**只差标点不再报警**（驱动根本不报标点，上一版拿"跳过的字符数 > 0"当判据 ⇒ 47/47 句全命中，把真异常淹没了，BACKLOG 1-2） | 这条是**提示不是失败**：真时间戳保住了（没有退化成按字数近似）。要查就核对那一句的 `narration.json` 里 `lines[].words` 与原文；只有 `词级时间戳不可用：…` 才是真失败（那时 `approx = true`，字幕/卡拉OK 会按字数近似） |
| `按字数近似切分（没有真时间戳）` / `驱动没有写出词级时间戳` / `词级时间戳不可用：…`<br>`scripts/lib/say.mjs` 的 `note` 分支 | 词级时间戳这一层**没拿到真数据** | 检查 TTS 驱动（`tools/tts-edge.py` / `--tts`）是否输出了 `words`；离线回归：`node tools/test-say.mjs`（不需要联网） |

### 1.10 探头与量具（`tools/`）

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `判定：PASS ✓ N 条全部成立` / `判定：FAIL ✗ N/M 条不成立`<br>`tools/probe-raymarch.mjs:436` | raymarch / 3D 层 14 个变体的总判据 | 有 FAIL 时逐条读下面的 `✓/✗ 标签 —— 实测值`；**退出码 1** |
| `flat：引擎里一条 Pass 能画出注入的常量色`<br>`tools/probe-raymarch.mjs:382` | 最基本的一条：整条引擎链没把颜色改错 | FAIL ⇒ 不是场景问题，是引擎/POST 链问题 |
| `ray：世界 +x 在画面右半边（camera3 右手系）` / `ray：世界 +y 在画面上半边（FRAG_PX 的 y 向上，rayDir 不再翻）`<br>`tools/probe-raymarch.mjs:390` `:393` | 3D 朝向的两个静默 bug（手性 / 多翻一次 y） | FAIL ⇒ 世界上下或左右反了；见 `docs/ENGINE.md` §3.7 与 `AGENTS.md` §5.5 的世界坐标约定 |
| `full：无 NaN / Inf` / `full：亮度在"有画东西"的区间（0.01–0.5）` / `full：光从上方来（地板比天花板亮）`<br>`tools/probe-raymarch.mjs:401` `:402` `:403` | 真实场景变体的三条基本判据 | 分别对应：非有限值（`check` 也报）、全黑/全白、光照方向反了 |
| `hit_mask：走廊里绝大多数光线都命中（相机在 SDF 内部）`<br>`tools/probe-raymarch.mjs:398` | SDF 场景的命中率 | FAIL ⇒ 相机位置 / SDF 尺度不对 |
| `zerocam：相机 uniform 全 0 时仍然"有命中"（说明它退化成了常数，画面会变成一片亮色）`<br>`tools/probe-raymarch.mjs:414` | 复现"整屏白"的头号根因（`cam3Uniforms` 字段名写错 ⇒ uniform 全 0） | FAIL 是**期望**的（注入夹具必须被看见）；真正要修的是你场景里的 uniform 传参 |
| `huge：1e30 被 RGBA16F 夹到 65504` / `nan：注入了 NaN（判据自己得能看见它）` / `engine.nonFinite(x)：必须报出非有限值`<br>`tools/probe-raymarch.mjs:412` `:408` `:419` | **判据自己**的标定（注入已知坏值，量具必须抓到） | FAIL ⇒ 量具坏了，别信这次结果 |
| `页面错误：`<br>`tools/probe-raymarch.mjs:263` | 页面里的 pageerror | 先修它，否则上面的判据都不可信 |
| `· <任务>  W×H  段：a, b, c` + `✓ 名字 (x,y) 实测 [r,g,b] 期望 [r,g,b] Δn`<br>`tools/probe-three.mjs:80` `:137` | Three.js 桥的逐点颜色判据（点名校验朝向与两条颜色管线） | `Δ > TOL` 的那一点就是问题所在；`三象限_*` / `引擎块_*` 查朝向，`over_左_底0.5` / `over_右_底0.25` 查线性 alpha |
| `✓ probe-three：全部通过` / `✗ probe-three：N 项不通过`<br>`tools/probe-three.mjs:153` | Three.js 桥总判据 | 退出码 1；见 `docs/THREE.md` |
| `✓ 全部通过：GPU 的 NV12 编码与 CPU 参考实现在舍入误差内一致` / `✗ N 个时刻不一致（GPU 的 NV12 与可信路径对不上）`<br>`tools/probe-nv12.mjs:114` | 出片推流那条 NV12 路径（矩阵 / 范围 / 色度平均） | 判据是"差 >3 的字节为 0，且平均差 < 0.5"（`tools/probe-nv12.mjs:17`）。FAIL ⇒ 成片会整片偏色，而 `check` / `hashes` **都看不出来**（它们不走这条路）。见 `docs/PERF.md` §5.4 |
| `页面没就绪: …`<br>`tools/probe-nv12.mjs:64` | 页面没起来 | 先确认 Vite / 任务名；这是前置失败，不是判据失败 |
| `status: {"state":"ready",…}` + 一段 JSON<br>`tools/probe-colorspace.mjs:46` `:67` | `probe-colorspace` **只打印** `export` / `display` 两个颜色值 | ⚠ 它**不判定、不比较**（退出码只反映"页面是否 ready"）—— 自己比 `export` vs `display` 三个分量。见 §3 |
| `判定：PASS ✓ 两个倍率下几何的逻辑位置/尺寸一致` / `FAIL ✗ SCALE=2 下矢量几何不对`<br>`tools/probe-ribbon.mjs:94` | 4K（`--scale 2`）下矢量几何是否与 1080p 同位同尺寸 | FAIL ⇒ `LineBatch` 顶点着色器拿物理像素当逻辑像素用了；见 `docs/history/STATUS-rounds-1-6.md` §6.3 |
| `判定：PASS ✓ 任务字体确实加载并生效` / `FAIL ✗` + `faces: ["BrandFont 600 loaded", …]` + `--- console ---`<br>`tools/probe-fonts.mjs:63` `:49` `:59` | 任务自带字体（`task.fonts`）是否真的进浏览器、真的被用上 | `faces` 里的 `status` 是 `loaded` / `unloaded` / `error`：不是 `loaded` 就是"字体被跳过"，画面会退化成回退字体（"文字是方框"的同类）。查 `task.fonts` 路径（相对任务目录，文件要真存在）。`AGENTS.md` §10 末行 |
| `文件：<png>  W×H  N 字节（期望 W*H*4）` / `最亮 x.xxx @ {"x":…,"y":…}   亮度>0.5 的像素 N` / `x=900 列上亮度>0.5 的 y 区间：360–440（高 81）`<br>`tools/png-rows.mjs:28` `:36` `:49` | 直接量一张 PNG：某根线 / 某个色块到底在不在 | 用它取代"盯着图猜"；`用法: node tools/png-rows.mjs <png> [x列]`（无参数时退出码 2） |

### 1.11 离线跑场（`tools/scene-harness.mjs`，不需要 GPU）

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `── 静态扫描 …` + `✓ 没有铁律违规` / `✗ N 错误 · M 警告`<br>`tools/scene-harness.mjs:1501` `:1502` `:1504` | 纯 JS 的源码扫描（比 `check` 多覆盖"逐帧累积 / 按帧抖帧"） | 逐条按 `file:line` 修；见 §1.2 |
| `✅ 段名  a–b s  N 个时刻  线 x（峰值 y）· 字 z 行 · Pass n · 层 m`<br>`tools/scene-harness.mjs:1531` | 用假 ctx 把这一段真跑了一遍，给出绘制量 | `线 0 / 字 0 / Pass 0` ⇒ 这一段什么都没画 |
| `✗ 段名：<异常首行>` + `kind`（`render` / `setup` / `load` / `world` / `value` / `determinism` / `idx`）<br>`tools/scene-harness.mjs:1551` | 离线跑场抓到的错误，带 `kind` | `render` / `setup` ⇒ 场景代码；`load` ⇒ `这一段没有 render()`（`:1017`）或 `场景加载失败`（`:1053`）；`world` ⇒ 共享背景建不出来（`:1047` / `:1222`） |
| `⚠ value …（后处理拿到非有限值 = 整屏白/黑）`<br>`tools/scene-harness.mjs:1162` | `render` 返回的 post 参数里出现 NaN/Inf | 修产生它的表达式；`check` 的非有限值扫描是像素层，这条是**参数层**，更早 |
| `⚠ offrame 文字长期出画（出现的时刻里有八成以上越界）：「…」x … y …`<br>`tools/scene-harness.mjs:1375` | 文字包围盒长期越出画面（按引擎 `align` 语义估计，CJK 按 1em） | 改成 `type.writeLine(..., { anchor })` 并用版面带（`src/kit/bands.js`）；`2%` 以内不算 |
| `✓ 确定性：同一时刻两遍逐调用一致（N 个时刻）` / `✗ 确定性：同一时刻两遍不一致（见下）`<br>`tools/scene-harness.mjs:1537` `:1538` | 同一时刻渲两遍逐调用比对 | 不一致 ⇒ 场景里有 `Math.random` / 墙钟 / 累积；见 `AGENTS.md` §4 |
| `⚠ f.idx 敏感（合法与否取决于用途，见下）`<br>`tools/scene-harness.mjs:1182` | 场景读了 `f.idx` | 抖帧用 `f.idx` 是**对的**；做"手持"要用 `shakeSmooth(f.t, amp)`。别写反 |
| `⚠ id 场景 scene.id = "x"，但时间线里的段名是 "y"`<br>`tools/scene-harness.mjs:1022` | 段名与场景 id 不一致 | 统一，否则 `--only` / HUD / 报错都对不上 |
| `⚠ times 没有落在这一段里的时刻（--times 是**段内秒**：每段自己的 0..X s）`<br>`tools/scene-harness.mjs:1079` | 给的时间全是段外的 | `--times` 是段内秒，不是整片时间 |
| `⚠ gpu-skip setup 需要 GPU，已跳过`<br>`tools/scene-harness.mjs:1034` | 这一段没法离线跑 | ⚠ 这一段**这次没被自查**；只能靠 `still` / `check` 看图（`:1570`） |
| `⚠ 跳过的段这次**没有被自查**（setup 要真 GPU）`<br>`tools/scene-harness.mjs:1570` | 收尾提醒 | 同上去补 `check` |
| `N 段：N ✓ / M ✗ / K 跳过（需要 GPU）` + `✗ 有错误 → 退出码 1`<br>`tools/scene-harness.mjs:1568` `:1571` | 收尾汇总 | 有错误时退出码 1 |
| `ⓘ 交叠期这一帧没有铺满整帧的底（没有整帧 Pass / 全屏 fillRect / 非黑 gl.clear）—— 底会是纯黑，而且不报错`<br>`tools/scene-harness.mjs:1316` | 离线版"背景守门" | 同 §1.1 的背景守门三条改法 |

### 1.12 回归清单与冒烟夹具

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `PASS  <名字>  X.Xs` / `FAIL  <名字>` / `FAIL(已知)  <名字>`<br>`tools/regress-all.mjs:169` | 回归清单逐项结果；`FAIL(已知)` 是不阻塞的已知失败 | `node tools/regress-all.mjs`（日志在 `out/_regress/`）；单项失败时读它打印的 headline |
| `通过 N/M　❌ 真失败 K` / `✅ 没有真失败` / `汇总：out/_regress/summary.md`<br>`tools/regress-all.mjs:177` `:179` `:193` | 收尾汇总；有真失败时退出码 1 | 打开 `out/_regress/summary.md`，按项读日志 |
| `✗ --only x 没匹配到任何项。用 --list 看清单。`<br>`tools/regress-all.mjs:158` | `--only` 写错 | `node tools/regress-all.mjs --list` |
| `总判定：PASS ✓ check 能挡住这个 bug` / `点名「两条路径不一致」`<br>`tools/smoke-overexposure.mjs:46` `:44` | 夹具：故意注入"运动模糊过曝"的 bug，`check` 必须非零退出并点名 | FAIL ⇒ 守门退化了；这条守的是 `check` 的多子帧路径 |
| `点名了漏画背景的段`<br>`tools/smoke-background.mjs:75` | 夹具：注入一个不画背景的段，`check` 必须点名 | FAIL ⇒ 背景守门退化 |
| `那一帧必须是错帧卡片（贴边亮红框 + 暗红底）`<br>`tools/smoke-scene-error.mjs:122` | 夹具：坏场景必须画出错帧卡片，且 `still` / `check` 非零退出 | FAIL ⇒ 场景异常守门退化 |
| `点名帧数不足` / `清理不完整产物`<br>`tools/smoke-interrupt.mjs:52` `:55` | 夹具：渲染中途改文件，CLI 必须报帧数不足并删掉废 mp4 | FAIL ⇒ 产物守门退化 |
| `✓ 全部通过：写 docs/ 不打断渲染；改场景文件会被点名`<br>`tools/smoke-worktree-edit.mjs:123` | 夹具：验证"写 `docs/` 会不会打断渲染"这条既有结论 | ⚠ 这条夹具的口径比 `AGENTS.md` §7 更窄（§7 现在的结论是**渲染期间一个文件都别写**）；两者不一致时以 `AGENTS.md` §7 为准 |

### 1.13 环境 / 前置条件 / 用法错误

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `未知命令 "x"`（+ 打印 help）<br>`scripts/anim.mjs:4497` | 命令名打错 | `node scripts/anim.mjs help`（= 文件头那段 JSDoc） |
| `没有任务 "x"。现有：…` / `有多个任务，请指定一个：…`<br>`scripts/anim.mjs:413` `:418` | 任务名打错 / 没给任务名而有多个任务 | `node scripts/anim.mjs tasks` 列名字 |
| `--scale 只接受 1..4（收到 x）。1 = 1080p，2 = 真 4K。`<br>`scripts/anim.mjs:458` | `--scale` 越界 | 用 1..4；场景写法不用改（`AGENTS.md` §7 末） |
| `Vite 启动失败，试试手动 npm run dev 再带 --url`<br>`scripts/anim.mjs:483` | 私有 Vite 起不来 | 照提示：手动 `npm run dev`，然后 `--url http://127.0.0.1:5173`。⚠ 也常见于"别人正在写文件把 Vite 撞崩了" |
| `页面初始化失败：`<br>`scripts/anim.mjs:542` | 页面起来但引擎装载失败 | 读下面的 `status.error`；常见是任务加载 / shader 编译错 |
| `没有找到成片 out/…。先跑 video，或用 --file 指定。`<br>`scripts/anim.mjs:2316` | `verify` 找不到成片 | 先 `video`；或 `verify <任务> --file <路径>` |
| `没有可验收的时刻（成片 N 帧 / X.XXs，时间线是空的？）`<br>`scripts/anim.mjs:2375` | `verify` 没算出可比的时刻 | 检查时间线是否为空 / `--from` 是否越界 |
| `t=… （成片第 N 帧） ← ffmpeg 抽帧失败`<br>`scripts/anim.mjs:2394` | 某帧从 mp4 里抽不出来 | 成片可能损坏：重渲，或先 `ffprobe` 它 |
| `找不到 ffmpeg。装一个，或用 ANIM_FFMPEG 环境变量指定路径。`<br>`scripts/anim.mjs:2932` | ffmpeg 不在 PATH | 装 ffmpeg，或设 `ANIM_FFMPEG` / `ANIM_FFPROBE`（`AGENTS.md` §1 前置条件） |
| `✓ N 项通过` / `✗ N 项通过，M 项失败`（`test-style`）；`全部 N 项通过`（`test-cam-math` / `test-blocks`）；`PASS/FAIL` 逐项（`test-timeline-guard` / `test-say` / `test-karaoke`）<br>`tools/test-style.mjs:120` `tools/test-cam-math.mjs:387` `tools/test-blocks.mjs:163` `tools/test-timeline-guard.mjs:123` `tools/test-say.mjs:45` `tools/test-karaoke.mjs:25` | 纯逻辑单测的收尾口径（不需要 GPU / 联网） | 有失败项时退出码 1；这些是改引擎前**先跑**的（`AGENTS.md` §10 的清单里有它们） |

### 1.14 音频响度守门（LUFS / true peak / LRA，`docs/BACKLOG.md` 1-20）

> ⚠ **状态（写表时）**：库已落地（提交 `ca53061`，`scripts/lib/media.mjs`），离线回归是 `tools/test-loudness.mjs`。
> **`anim mix` / `anim check` 的打印点还没接上** —— 全仓库调用 `formatLoudness()` 的只有那个回归脚本。
> 所以下面这些词**目前主要会在这个量具的输出里看到**；等接线落地（1-20 的后半），它们会出现在 `mix` / `check` 里。
> 那句纪律值得先记住：**"你听不见，就说出这一点并报数字"** —— 这一层以前是唯一靠耳朵的验证。

| 输出词 | 含义（什么情况下会看到它） | 修法 |
|---|---|---|
| `−13.8 LUFS / −1.2 dBTP / LRA 4.1`<br>`scripts/lib/media.mjs` 的 `formatLoudness()` | 一行读数：**整合响度**（LUFS）/ **真峰**（dBTP，考虑 DAC 重建后的采样间峰值，**不是**采样峰值）/ **响度范围**（LRA） | 靶子是 `LOUDNESS_TARGET = { i: -14, tp: -1, lra: 11 }`（`scripts/lib/media.mjs`）。**这一层只报数字、不自动归一化** —— 要不要重混由你决定 |
| `达标（-14 LUFS / -1 dBTP）`<br>`scripts/lib/media.mjs` 的 `assessLoudness().verdict` | 判据通过（`tier === 'ok'`） | 无事 |
| `-13.8 LUFS 离目标 -14 差了 +0.2 LU`<br>`scripts/lib/media.mjs` 的 `assessLoudness()`（violations，`kind: 'loudness'`） | 响度偏差超容差（**太响和太轻都算**；平台会把更响的压下来） | 调混音总电平（`anim mix` 的输出 / `task.audio`），别用 `exposure` 那类画面参数 |
| `真峰 x.xx dBTP 超过上限 -1 dBTP：平台/有损转码会削顶`<br>`scripts/lib/media.mjs` 的 `assessLoudness()`（`kind: 'true-peak'`） | 真峰越界（**上限而非等号**：轻很多不算越界） | 降总电平 / 加限幅；这是"听众那里会不会削"的问题，与采样峰值无关 |
| `量不出整合响度（input_i = …）—— 文件是静音、或者根本不是音频`<br>`scripts/lib/media.mjs` 的 `assessLoudness()`（`kind: 'nan'`） | 数字不是有限数 | 检查音频文件本身（静音 / 格式不支持）；⚠ 这是**没验**，不是"达标" |
| `LRA` 超 11 | 响度范围过宽（口播 + 音乐床天然就宽） | **不算错误**，只是提示"忽大忽小"：见 `scripts/lib/media.mjs` 的 `LOUDNESS_TARGET` 注释 |

---

## 2. 退出码语义：哪个命令非零代表什么

**只有下面这些命令会自己置非零退出码**（`grep 'process.exitCode = ' scripts/anim.mjs` 一共 12 处，
落在 9 个命令里）：

| 命令 | 非零条件 | 证据（函数名，稳） |
|---|---|---|
| `check` | 有任何 problem（`errs.length`）；加 `--strict` 时"有 skipped"也算 | `cmdCheck` 的 `checkVerdictLine()` 那两行 |
| `still` | 刚渲染的帧里有场景异常（那些 PNG 是错帧卡片） | `cmdStill` 的 `collectRenderErrors` 分支 |
| `hashes --baseline` | 有帧与基线不一致 | `cmdHashes` 的 `negligible()` 失败分支 |
| `probe` | 有时刻在两种渲染顺序下不一致（跨帧状态） | `cmdProbe` 的两次顺序比对 |
| `determinism` | 三种序列里有分叉（跨帧依赖） | `cmdDeterminism` 的 `if (!bad) … else` |
| `probe-alpha` | ①–④ / ⑤⑥ / ⑦⑧⑨ 任一组 FAIL | `cmdProbeAlpha` 的三段 `if (!(c1 && …))` |
| `verify` | 有时刻与成片不一致 | `cmdVerify` 的 `if (bad)` |
| `video` / `shot` | 场景抛异常 / 帧数不足 / 产物验收不通过 / 渲染期改了源文件 —— 一律 `die()`（退出码 1）并**删掉产物** | `cmdVideo` 里那几处 `die(` |
| `shake` | 有 notice（振动 / 偏毛 / 收尾还在晃 / 峰值超档） | `cmdShake` 的 `if (st.notices.length)` |

（判据：`grep -n 'process.exitCode = 1' scripts/anim.mjs` —— 写表时一共 12 处，落在上面这 9 个命令里；
其余命令不会自己置非零。）

**不会自己置非零退出码的（⚠ 这是"空 ≠ 干净"的高发区）**：

| 命令 | 事实 |
|---|---|
| `diff` | **只打印** `max / mean / >8 / >32`，没有判据、没有 `process.exitCode`（`scripts/anim.mjs` 的 `cmdDiff`，整个函数里没有一处 `process.exitCode`）→ 退出码恒 0。要判"变了没有"用 `hashes --baseline` |
| `audit` | 只打印交叠段的绘制账目（`scripts/anim.mjs` 的 `cmdAudit`），恒 0 |
| `perf` / `gpu` / `sheet` / `dumpframe` / `dumpframes` / `dumppx` / `tasks` / `shots` / `styles` / `clean` | 都只有 `die()` 这一类硬失败，判据类非零不存在 |
| `probe-colorspace` | 只在"页面没 ready"时退出 1；**颜色比不比对是你自己的事**（`tools/probe-colorspace.mjs:47`） |
| `lint-narration-dup` | **1 = 有命中**；**2 = 用法 / 任务名错**（工具内部错误，不是"没命中"）；`--json` 恒 0（`tools/lint-narration-dup.mjs:484` `:538`） |
| `scene-harness` | 有错误 → 1（`tools/scene-harness.mjs:1571`）；**被跳过的段不算错** |
| `smoke-interrupt` | `2` = "没能在渲染中途插进去（渲染太快？）——本次结论不算数"（`tools/smoke-interrupt.mjs:56`）—— 这是**没验**，不是通过 |
| `probe-*` / `test-*` / `smoke-*` / `regress-all` | 各自 0/1；`regress-all` 的 `FAIL(已知)` **不**计入真失败（`tools/regress-all.mjs:174`） |
| `png-rows` | `2` = 没给参数（用法错） |

---

## 3. 「空 ≠ 干净」：哪些行是**没跑**，而不是通过

来自三个外部参考项目的同一条结论：浏览器没跑起来时那几个 section 是**空的**，而"空输出读起来像一份干净的报告"
（`scripts/anim.mjs:181` 附近引用了对方的原话 *empty, not clean*）。所以**看到下面任何一条，都不许当成"通过"**：

**① `check` 里"没跑"的行**（`docs/BACKLOG.md` 1-19，**已提交**：`9693291` → `afccab1` → `5432cf6`）

> 这一组现在也逐条收在主表 **§1.1**（`skipped:` 段、结论行的「另有 N 项没跑」、`--strict`）—— 那里是"看到它怎么做"，
> 这里是"为什么不能把它读成通过"。

| 行 | 它实际在说 |
|---|---|
| `skipped: 无（这次体检的每一项审计都真的跑了）`（`scripts/anim.mjs` 的 `formatSkipped()`） | ✅ 唯一的"确实全跑了" |
| `skipped: N 项没跑 —— 这些地方**没有验过**，不要当成通过：`（`formatSkipped()`） | ⚠ 逐条列出"是什么没跑 + 为什么" |
| `← ⚠ 多子帧这一条路径**没跑**（skipped）：…`（`cmdCheck` 里 `multiNote` 那一行） | ⚠ 多子帧路径（成片走的那条）没验 |
| `← ⚠ 非有限值扫描**没跑**（skipped）：…`（`cmdCheck` 的 `pushSkipped(skipped, '非有限值扫描…')`） | ⚠ 像素层的 NaN/Inf 没扫 |
| `（背景守门不可用：…）`（`cmdCheck` 的 `worldAudit` catch 分支） | ⚠ 背景守门没跑 |
| `⚠ lint-narration-dup 没跑成：…` / `（旁白复述检查跳过：…）`（`cmdCheck` 的那两个分支） | ⚠ 旁白复述没验 |
| `⑤⑥ 数值型 alpha 用例没有拿到读数 → FAIL` / `⑦⑧⑨ 旁白用例没有拿到读数 … → FAIL`（`cmdProbeAlpha`） | ⚠ 用例没跑起来，被记成 FAIL（至少不会误读成 PASS） |
| `--quick：每段只采 50% 一个点、只跑单子帧`（`cmdCheck`） | ⚠ 这一次没看多子帧、没看入场头 1 秒 |
| `· samples=1：这是单子帧，**只代表静止画面**`（`cmdStill`） | ⚠ 单帧图不代表成片 |

> ⚠ **这一层的状态**：`docs/BACKLOG.md` 1-19 已提交（`9693291` → `afccab1` → `5432cf6`），
> 上面那几行来自那次改动，原文可在 `scripts/anim.mjs` 的 `formatSkipped()` / `checkVerdictLine()` /
> `pushSkipped()` 三个函数里看到（已按提交后的代码逐条 grep 复核过，都在；主表 §1.1 是同一批词的"怎么做"）。
> 若将来被回退，这几行会消失，**但"背景守门不可用 / 旁白复述检查跳过 / 用例没有拿到读数 / --quick / samples=1"
> 这五类"没跑"是一直都在的** —— 那五类才是这一节真正要提醒的读法。
> 另一条既有事实：`skipped` **默认不影响退出码**（回归清单依赖它），要 gate 就显式加 `--strict`。

**② 不打印 `skipped:`、但同样"没验"的地方**

| 行 | 它实际在说 |
|---|---|
| `⚠ setup 需要 GPU，已跳过`（`tools/scene-harness.mjs:1034`） | ⚠ 这一段这次没被自查 |
| `⚠ 跳过的段这次**没有被自查**（setup 要真 GPU）—— 那几段只能靠 still / check 看图`（`:1570`） | ⚠ 同上，收尾提醒 |
| `（--scene 没选中，这次没查）`（`:1519`） | ⚠ 这一段这次没查 |
| `probe-colorspace` 打印的 JSON（`tools/probe-colorspace.mjs:67`） | ⚠ 它**只给读数**：`export` vs `display` 要自己比 |
| `diff` 打印的 `max / mean / >8 / >32`（`scripts/anim.mjs` 的 `cmdDiff`） | ⚠ 只给读数、退出码恒 0 |
| `probe-nv12` 的 `判定` 列出现 `FAIL`（`tools/probe-nv12.mjs:112`） | ✅ 这个是判据，会退出 1 |
| `⚠ 没能在渲染中途插进去（渲染太快？）——本次结论不算数`（`tools/smoke-interrupt.mjs:56`） | ⚠ 夹具没验成 |
| `⚠ N 个时刻 render 抛异常（这些帧的抖动按 0 计）`（`scripts/anim.mjs` 的 `cmdShake`） | ⚠ `shake` 的结论不完整 |
| `lint-narration-dup` 的 `跳过 N 个任务`（`tools/lint-narration-dup.mjs:520`）与 `扫描到文件尾仍未闭合`（`:514`） | ⚠ 那部分没验准 |

---

## 4. 维护规则：诊断词表与代码不能分叉

1. **新加一个 `warn(` / `die(` / 结论行 → 就来这张表登记一行**（三列，带 `文件:行号`）。
   反过来说：**表里第一列的词，grep 不到就是代码改了** —— 要么更新行号/原句，要么删掉那一行。
2. 判据：把第一列反引号里的原句片段 `grep` 一遍。表里每个词都必须是**真的会打印出来的**字符串，
   不许写"将来可能会有"的词。
3. 修法列**只写动作**：命令 / 文档章节号 / 代码位置。写"多半是 XX"属于第二列的职责。
4. 一个词如果有**多条**修法，按"先试哪条"排序（最便宜的在前）。
5. `docs/` 下的章节号要指向**存在**的文件与章节；文档归档时同步改表（见 §5 的已知分叉）。
6. **已知还没落地、落地后按上面第 1 条补登记**（写表时逐个 grep 过，确认代码里还没有）：
   - `anim shots --json`（`cmdShots` 里还没有 json 分支）；
   - `anim note`（分发用的 `commands` 表里还没有这个命令）。
   已经落地但**打印点还没接**的：§1.14 的响度行（库与回归在 `scripts/lib/media.mjs` / `tools/test-loudness.mjs`，
   `anim mix` / `check` 还没调用它）。

---

## 5. 已知分叉（写表时发现，**没有改代码**）

1. **输出里的 `修法` 指向已归档的文档路径**（用户/agent 照做会找不到文件）：
   - `scripts/anim.mjs` 的 `cmdProbe` 收尾：`…（见 docs/IMPROVEMENTS.md 的确定性一节）` → 真路径 `docs/history/IMPROVEMENTS-1-3.md`（§1 的确定性一节）
   - `scripts/anim.mjs` 的 `cmdShake` 收尾与文件头（`help()` 里那条）：`（判据见 docs/IMPROVEMENTS-3.md）` → `docs/history/IMPROVEMENTS-1-3.md`（第三轮）
   - `scripts/anim.mjs` 的 `cmdVideo` 收尾抖动守门：`见 docs/IMPROVEMENTS-3.md（"像不像手持取决于频率…"）` → 同上
   - `tools/scene-harness.mjs:1316`：`（docs/IMPROVEMENTS.md P0-2）` → 同上
   - 归档对照表在 `docs/history/README.md` §2；`docs/IMPROVEMENTS*.md` 这些文件**已经不存在**。
2. **`hashes` 的判据在两处注释里写得不一致**：函数头注释写「判据：max ≤ 2 且 >8 的像素为 0」，
   而真正执行的 `negligible()`（`scripts/anim.mjs`，`grep -n 'function negligible'`）是
   「`>16` 的像素为 0 且 `mean < 0.002`」，日志行打印的也是 `>16 / >32` 两列。**以 `negligible()` 为准。**
3. **`AGENTS.md` §10 的命令清单 vs `anim.mjs` `help()`**：见下面 §6 的核对结论。

---

## 6. `AGENTS.md` §10 命令清单 vs `anim.mjs` `help()` 的核对（事实，未改动）

`help()` 打印的是**文件头那段 JSDoc**（`scripts/anim.mjs` 末尾的 `help()`），
分发用的 `commands` 表在它下面（`new / tasks / shots / styles / subs / check / still / sheet / hashes /
diff / probe / verify / audit / determinism / dumppx / dumpframe / dumpframes / probe-alpha / video /
shot / perf / shake / gpu / clean / say / mix / analyze / help`）。

| 核对项 | 事实 |
|---|---|
| `AGENTS.md` §10 里列的每条 `anim` 命令是否都存在 | ✅ 都存在（`check` `audit` `still` `probe-alpha` `verify` `hashes` `probe` `diff`） |
| `AGENTS.md` §10 里列的每个 `tools/*.mjs` 是否存在 | ✅ 都存在（`png-rows` `probe-colorspace` `probe-ribbon` `test-timeline-guard` `regress-all` `probe-raymarch` `probe-three` `test-cam-math` `test-say` `test-karaoke`） |
| `help()` 漏了哪些**已存在**的命令 | ⚠ **`styles` 与 `subs` 都不在文件头 JSDoc 里**（`commands` 表里有：`styles: cmdStyles`、`subs: cmdSubs`，`grep -n 'styles: cmdStyles' scripts/anim.mjs` 就能看到）—— 而 `AGENTS.md` §1/§2 与 §6.5 都在用它们（`node scripts/anim.mjs styles`、`node scripts/anim.mjs subs`）。`help()` 打印出来**看不到这两条** |
| `AGENTS.md` §10 漏了哪些**诊断/验收**命令 | ⚠ `determinism`（跨帧依赖定位）、`dumpframe` / `dumpframes` / `dumppx`（裸帧对照）、`perf`（测速）、`shake`（抖动体检）、`gpu`（环境能力）。其中 `determinism` / `shake` / `perf` 都是**判据型**命令（有非零退出码），值得进 §10 的清单 |
| `check` 的 `--quick` / `--strict` | ⚠ 两个 flag 都**不在** `AGENTS.md` §10 的清单里；`--quick` 会缩小体检覆盖面（见 §3），`--strict` 会把"有跳过"变成非零 |

> 以上五条只作为事实报告，**未改动 `AGENTS.md` 的命令清单**（本次只加了指向本文件的那一行）。

---

## 7. 怎么在 30 秒内重新钉一遍行号

表里的行号会随重构漂（`scripts/anim.mjs` 这一轮就漂过一次，见开头的说明）。要重新钉，
**用第一列引号里的原句去 grep**，不要照着行号读：

```sh
# 例：这个词到底还在不在、现在在第几行
grep -n '非有限值：NaN' scripts/anim.mjs
grep -n '背景守门' scripts/anim.mjs
grep -n '逐帧变化量是幅度的' scripts/lib/shake.mjs
grep -n '压进了\*\*字幕保留带\*\*' src/kit/bands.js
grep -n '文字长期出画' tools/scene-harness.mjs

# 一次把"哪些词已经不在代码里了"全查出来（表与代码分叉的体检）
# —— 把第一列的原句抄成一个列表，逐条 grep，命不中的就是需要更新/删除的行
```

PowerShell 里同样可以（**别用管道接原生程序的输出**，`Select-String` 是 cmdlet，可直接用）：

```powershell
Select-String -Path scripts/anim.mjs -Pattern '非有限值：NaN','背景守门','段内亮度不均'
```

改这张表的**正确姿势**：先 grep 到原句 → 用它现在所在的行号替换表里的数字 → 若整句都找不到了，
说明那处输出已经被改掉，**把那一行删掉**（而不是留着一条指向不存在输出的词）。

