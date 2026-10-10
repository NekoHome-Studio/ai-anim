# 参考拆解：`world.execute (me) ;` 网页版（FrostNovaOrg/world-execute-web）

> 拆解日期 2026-10-07。对象是 GitHub 上的**构建产物仓库**（源码未压缩、模块结构保留、带 `?v=` 查询串）。
> 本地副本：`out/_refs/world-execute-web/`（git clone，未修改）。
> 本报告区分三类信息：**【实测】**（我跑起来量的）、**【读码】**（文件:行号可核查）、**【子代理】**（并行深读的报告，路径见文末）。
>
> **本文里的路径都相对于仓库根。** 引用的产物分两类：
> ① **进仓库的**：`tasks/_post-lab/`（本轮建的标定夹具）；
> ② **临时件（在 `out/` 下，不进版本控制，随时可能被清）**：`out/_refs/`（参考项目克隆 + 截图 + 提取的源码）、
> `out/_staging/world-execute/`（四份子系统报告）、`out/_postlab/`（后处理 A/B 的帧与数据）。清单见 [`BACKLOG.md`](BACKLOG.md) §3。
>
> ⚠ **待办不在这份文件里** —— 本文是"参考项目的拆解"，**做完没做完一律以 [`BACKLOG.md`](BACKLOG.md) 为准**
> （画面能力那五条在 §1.A，后处理那四条的拍板在 §0-6）。本文 §7 的建议顺序是当时的判断，留作背景。

---

## 1. 它是什么【实测 + README】

- Mili《world.execute (me) ;》的**全代码生成 MV**：3 分 32 秒（211.907 s），每一帧在浏览器里用 WebGL2 实时算出来。
- 同一份引擎有**三种消费形态**：
  | 模式 | 谁在用 | 特征 |
  |---|---|---|
  | `preview` | 编辑器/Studio | 实时预览 |
  | `render` | `render.mjs`（他们的私有脚本，不在仓库） | 4K 离线出片：`13 015 frames · 3840×2160 · 60 fps`【实测：outro 画面自述 + `PROJECT.encode`】 |
  | `player` | 网页播放器 | 实时、自适应画质、子帧上限 3 |
- 仓库里**没有音频**：歌曲以加密分片存放，密钥只发给站点自己的域名。
- `PROJECT`：master 3840×2160 / design 1920×1080 / fps 60 / duration 211.907 / preroll 5 s【`src/engine/config.js:20-104`】。

## 2. 实测：我把它跑起来看到的东西

用无头 Chrome（`channel: 'chrome'`，真 GPU：ANGLE / AMD Radeon D3D11）加载本地静态服务，
调播放器自带的 `player.still(t, w, h)` 出图。脚本：`out/_refs/shoot.mjs`；截图：`out/_refs/shots/`（16 张 1920×1080）。

### 2.1 剪辑节奏【实测：从 `player.e.timeline.shots` dump】

- **305 个镜头**；时长中位 **0.50 s**，平均 0.71 s，**88% 短于 1 秒**；最短 0.10 s（6 帧）。
- 每章镜头数 / 平均长度：

  | 章 | 镜头 | 平均 | 章 | 镜头 | 平均 |
  |---|---|---|---|---|---|
  | intro | 23 | 0.65 s | c2x | 11 | 0.67 s |
  | title | 10 | 1.48 s | bridge | 13 | 0.57 s |
  | v1 | 15 | 0.98 s | inst2 | 26 | 0.57 s |
  | pre1 | 20 | 0.74 s | **chant** | **53** | **0.28 s** |
  | c1 | 29 | 0.51 s | c3 | 22 | 0.67 s |
  | v2 | 21 | 0.70 s | love | 12 | 1.23 s |
  | pre2 | 18 | 0.82 s | outro | 14 | 1.47 s |
  | c2 | 17 | 0.87 s | warning | 1 | 5.00 s |

- 转场类型分布：**硬切 228 / 相机接力（relay）68** / points 5 / fade 3 / glitch 1。
  → 22% 的切点不是"切"，是**相机一路飞过去、内容中途换手**。

### 2.2 画面（联络表见 `out/_refs/shots/_sheet.png`）

深色底 + 高对比；主色青蓝/洋红/橙红/骨白。逐章看：终端代码面板 → 星系标题 → 波形飞行 →
**相机光圈内部**（照片级）→ 方块城市 + 无限线框骨架 → 细胞线框 → 洋红隧道 → 代码记忆网格 →
IDE 报错（`assert(you != null, "you got me")` + 波浪下划线）→ 3D 代码雨 → 碎片爆散 → 线框盒子 →
笔记本上的心脏线 → 终端 credits。

**共同点：每一屏都有"信息"**——HUD 读数（`N f/5.6 · Light 1/4 · EV -2.0`）、时间码、左上角章名+帧参数、
说明性的 3D 代码文字。没有一屏是"漂亮的空镜"。

---

## 3. 架构：四层 + 两条纪律【读码 + 子代理 C】

```
src/ch/**            内容层：15 章 / 131 个文件（章总装 + 效果模块）
   │  chapter({ id, from, to, init, shots: [...] })
src/edit/table.js    剪辑层：章/段 id → { at, join, off, shift, mb }（6 个命名剪辑版本）
   │  editTable(name)
src/engine/timeline.js  装配层：shots[]（id/chapter/def/start/row/join/stateful/ownsLyrics/transitionIn/index/end）
   │  at(t) → {a} | {a, b, p}
src/engine/engine.js    渲染层：renderFrame(t)
```

**纪律一：时间是唯一输入。** 全片零 `Math.random` / `Date.now` / 帧间累积状态；
连随机数都是 `hash(段 id)` 派生的（`engine.js:223,279`）。引擎留了 `stateful: true` + `ctx.advance(sim)`
这个"有状态模拟"的逃生口（从段起点按固定 dt 重放到当前帧），**全片零使用**【子代理 C】。

**纪律二：段是唯一绘制单元，且必须可重入。** 同一个 `draw` 会被调用多次：
运动模糊子帧、相机探针（`_probe` 跑到相机那一步就**抛 Symbol 异常中断**）、接力时的 drive。

### 3.1 一个镜头长什么样

```js
chapter({
  id: "intro",
  from: (T) => T.section("intro").start,     // 时间全是语义查询
  to:   (T) => T.section("inst1").start,
  shots: [
    { id: "cursor", ownsLyrics: true, at: ..., draw(ctx) { ... } },
    ...
  ],
});
```
【`src/ch/01_intro.js:611-726`】镜头可以 `at` 为**函数**（从音乐时间算），也可以被剪辑表覆盖。

### 3.2 效果模块的粒度：**一个点子一个文件**

`src/ch/pre1/iris.js`（93 行）整段就是"相机光圈"：一个 2.4×2.4 的平面 + 一个片元着色器，
里面算六边形开口、六片叶片（各有金属色/拉丝/边缘反光/落影）、镜筒刻度环、
**六点衍射星芒**（`exp(-abs(dot(p,n))/(px*1.4+.004))`，与六边形直边垂直 —— 物理正确）。
抗锯齿用 `fwidth` 解析做（`px = max(fwidth(r), 1e-4)`）。

> ⚠ **看起来像 3D 的东西，很多是聪明的 2D 着色器**。这对我方是好消息：`Pass` 就能复刻，不需要真网格。

---

## 4. 最值得拿的机制（按"能搬 + 收益"排序）

### ① 剪辑语言：把「切在第 8 拍」升级成「切在真实鼓点上」【读码 `src/engine/edit.js`】

```js
const B   = (sec, beat) => (T) => T.beatTime(beat0(T, sec) + beat);       // 相对拍位
const HIT = (sec, beat, {tol=.06}) => (T) => {                            // 最近的鼓点
  const g = B(sec, beat)(T), h = T.onsetNear("drums", g, tol);
  if (h == null) throw new Error(`no drum hit within ${tol*1e3} ms of …`);
  return h - LEAD;                                                        // 统一提前一帧
};
const SYL = (sec, beat, {tol=.09}) => …  // 最近的唱词起音
const VOX = (i, j) => …                  // 第 i 句第 j 个词
```
- 五种 join 原语：`cut()` / `whip(frames)` / `glide(beats)` / `points(dur)` / `xfade(frames)`（`edit.js:23-53`）。
- 表里的每一行 `at` 几乎都由这些函数生成【`src/edit/table.js:125-535`】。
- **贴不上就抛错**（容差 60–90 ms）—— 不允许"大概对齐"。

对照我方：`dur: {beat:16}` / `music.timeOfBeat(16)` 只能对齐到**量化网格**；
`music.hits('kick', t0, t1)` 有事件但只是"取历史事件"用来画效果，**时间线本身没有吸附能力**；
没有"人声起音 onset"（只有 `vocal` 包络），也没有 `-1 帧` 的 LEAD。

### ② 相机接力（relay）：真 3D 位姿插值 + 内容换手【读码 `src/engine/rig.js`】

- `rig` 是一个全局状态机，四种模式：`off / probe / drive / dress`。镜头在设置相机处调 `rig.cam(camera, {look, main})`：
  - **probe**：记录位姿后**抛 Symbol 异常**，让这个镜头"只跑到相机那一步"就停（不用把 draw 拆两半）。
  - **drive**：把镜头自己的相机**替换成外来位姿**（`setPose`），画面照画。
  - **dress**：保留自己的相机，只改投影矩阵（lens shift / push-in）。
- `blendPoses(A, B, e)`（`rig.js:71-104`）的数学很讲究：
  - look 点直线插值、朝向四元数 slerp（恒定角速度）；
  - **取景大小按几何插值** `s = exp(lerp(log a.s, log b.s, e))`（推近才有均匀手感）；
  - **相机位置由 look + dist 反推**（`pos = behind(dist)`）→ 相机会**绕主体摆动**而不是切角；
  - ortho ↔ perspective 无缝过渡。
- 转场时：相机 = blend(A, B, move(p))，内容在 `mix` 窗口内换手（`HANDOVER.glide = [.35,.65]`），
  两个镜头的 post 参数**逐字段插值**（`lerpPost`）。`MOVES = { glide: ease.inOutSine, whip: p => clamp(p)**2.4 }`。
- 文字归属有专门规则 `textLead()`（`edit.js:56-63`）：whip 里新镜头的文字**从第一帧就画**（"跟着相机飞到位，
  要是六帧中间换手，标签会横跳整个画面"）。

对照我方：`src/core/trans.js` 的"一台摄影机"是 **post 的 zoom/shake（屏幕空间 2D）**；
`cameraDir/enterOffset/transitionPass` 做的是"甩出去 + 反向落位"。**没有三维位姿**，所以
做不出视差、绕主体摆动、正交↔透视过渡。
我方已有 `camera3()`（纯数据）与 `makeThreeShot`（真相机），**接线点是现成的**。

### ③ 剪辑表：内容与剪辑分离，一表多版【读码 + 子代理 C】

- 段只声明"音乐时间"，`src/edit/table.js` 用一张 `章/段 → {at, join, off, shift, mb}` 的表覆盖它；
- `hardCuts(rows)` 机械生成"只把接力换成硬切"的版本（`edit.js:69-87`），`defineEdits` 注册多个剪辑；
- 剪辑层还能加**调色语言**：`rampIn/rampOut`（切点前后往 ramp 色闪）、`punch`（切点推近，8 帧回落）、
  `shift: [dx,dy,settle]`（新镜头先偏离构图、再缓回 —— 让眼睛在上一个镜头离开的地方找到主体）；
- 镜头内部可以反查自己被改到几点：`ctx.startOf(id)`。

### ④ 两个文字层 + 后处理一趟到底【读码 `src/engine/post.js` + 子代理 C】

- `text.scene` 在 bloom **之前**合成（会发光、被调色影响）；`text.overlay` 在调色**之后**叠加
  （颜色精确、永不被泛光/颗粒污染）——HUD/歌词/读数都走 overlay。
- bloom 是独立双滤波链（最多 7 级，**Karis 权重 `c/(1+luma(c))` 杀 fireflies**）；
  其余全部收在**一趟 UBER**：`zoom → glitch → CA → bloom+exposure → tonemap → grade → scanline → vignette → fade → sRGB → overlay → grain → TPDF dither`。
- **AgX tonemapper 是默认**（还有 ACES 与 display 两档可选）；8-bit 输出前有 **TPDF 抖动**；
  grain 按**设计分辨率**网格撒（4K 下 2×2 像素，跨分辨率观感一致）。

对照我方：有 `captions` 层（同样在后处理之后）+ 画面文字层，分工一致；
**没有 tonemapper**（只有 `shoulder` 软肩）、**没有 dither**、bloom 没有 Karis 预过滤。

### ⑤ 段间引用：一段可以把另一段画进自己画面里【读码 `engine.js:316-328` + `lib/modes.js` + 子代理 C】

`capture(ctx, fn)` 把内容渲到私有 HDR 缓冲并返回纹理（分层缓冲、可嵌套避免反馈循环）；
`engine.renderShotAt(id, t, target)` 把**任意另一段在任意时刻**的画面画进来（rig 隔离，保持它自己的相机）。
用例：chant 章在第 4/8/12 次 EXECUTION 把"记忆"塞进两拍里。

### ⑥ 「发布冻结」：同一份代码里维护两个版本【子代理 D】

- `src/lib/published.js` 定义 `remade(ctx)`；片子发布之后，**所有改进都走 `remade(ctx)` 分支**，
  已发布版本的绘制路径原样保留。全仓 `remade`/`PUBLISHED` 出现 **241 处**。
- 推论纪律：**共享库有 bug 时复制而不是修改** —— `ch/inst2/ascii.js` 头注释写着
  "a local copy of lib/modes.js … the fix lives here"（因为改 lib 会动到已发布画面）。
- 配套：源码**刻意不加许可证头**，理由是"画面会显示源码，加了就跟成片不一样"（`NOTICE.md:11`）；
  `grep TODO|FIXME|HACK|XXX` **零命中**；提交历史压成 1 个 commit，作者是 `FrostClaudeAgent`。

> 对照我方：我们的等价物是 `anim hashes --baseline`（事后证明画面没变）+ "老任务不回头改"的工作习惯。
> 但只要引擎持续演进（例如加 tonemap），老片子的基线就会失效 —— 对方的做法是**在代码里分支**，
> 我方更轻的等价做法是**把新东西做成默认关闭的开关**。

### ⑦ 自适应画质：一张每镜成本表 + 两参数设备模型【子代理 B】

- `cost.json.js` = 264 个镜头的 `[固定 ms, ms / 兆像素]`（参考机 `Apple M5 · Chrome/154` 实测）；
  `quality.js` 用两个设备系数 `kf, kp` 外推（加权最小二乘标定，`player.js:139-162` 现场渲染 3 个"最贵的"镜头取样）；
- 输入信号只有 **GPU timer**（`EXT_disjoint_timer_query_webgl2`；拿不到就退化为帧间隔，且"只慢不快"）与窗口高度 ——
  **没有设备指纹/显存探测**；
- **只在切镜点重定档**（升档 ≤ +2 级、需 15% 余量），镜内只有两条只降路径（150 ms × 4 看门狗、2× 预算 × 3 紧急）；
  紧急时**先 60→30 fps 再降分辨率**。所以观众看到的是"切镜处的清晰度台阶"，不是持续抖动。
- 时间同步：`clock.js` 用 `getOutputTimestamp().contextTime` 取**音频输出时间**，画面时间每帧重取、**从不积分**。

### ⑨ 「逐镜对齐」：他们没有全片一台摄影机，也没有全片一层背景【子代理 A】

**这条修正了一个容易想当然的假设。** 对方**没有**"全片共享背景 + 全片一台摄影机"这种东西：
每段的背景是自己画的（作者在每章自述里都写了这一章的背景轮换，如 pre1 的
"black, the film's own source code, flat instrument data, a print on paper, a 1-bit display, and the only starfield"），
相机也是每段自己建（`persp()`/`ortho()` 每帧现建）。

他们的连续性来自**逐镜对齐**——让**前一段的末帧与后一段的首帧在构造上相同**。四条硬证据：

1. **光标交接**：`intro/cursor.js:3-8` 固定 `CUR = {cx:960, cy:540, w:50.4, h:8.4}` 与 `CURSOR_LOOK`，
   intro 的最后一帧与 title 的第一帧画**同一个** `drawCursor()`、同一 grade；`title/code.js:27` 的 `DIST`
   反解出距离，使 3D 里的光标条宽度恰好等于 `CUR.w`。
2. **撒沙交接**：`pre2/sprinkle.js` 是 `c2/plate.js` 撒沙部分的**本地副本**（同一 1024² 分层网格、同一哈希、
   同一色带/尺寸/亮度/点精灵），而且"c2 开始时沙还没动（无模式、morph 0），所以这就是 c2 在那里画的全部"。
3. **落点交接**：`bridge/landed.js` 用 c2x 导出的几何 + 同 seed、同顺序重建 c2x 的最终状态（147,456 粒），
   **连每粒的亮度哈希都一致**——靠 `lib/glslhash.js` 在 **CPU 复算 GPU 的哈希位**（精确到 bit）。
4. **状态交接**：`outro/heart.js` 直接 import love 的 `heartState/meState/glassFrame/drawHeartSwarm`，
   并整体平移 `LIFT`（love 地板 y=−1.45 → boot 地板 y=0），于是"第一个 outro 帧就是 love 收尾的下一帧"。

**对照我方**：`world: 'auto'`（全片一层背景）+ `cameraPost`（一台摄影机）是"**让世界不变，只有前景在换**"——
便宜、有效、适合 2D 信息图为主的片子。对方是"**让内容精确对接**"——更贵，但**根本没有切**。
两条路目标不同：我们求"切了也像没切"，他们求"不存在切点"。要不要走后者，取决于片子是否值得为每一对相邻镜头
写"交接面"（共享常量 / 共享几何 / 共享 seed）。

### ⑩ 工程纪律里几条便宜又好用的【子代理 C】

- **错误画在画面上**：某段 draw 抛错 → 该段刷成红底 + 一行红字错误信息，继续渲染其余段（`engine.js:233-250`）。
- **装配即自检**：`timeline.problems` 收集"start 是 NaN / 两段间隔小于一帧 / 转场窗口重叠 /
  剪辑表指向不存在的段 / 段跑出所属章的范围 / 第一段不从 0 开始"，构造时全部 `console.warn`（`timeline.js:89-112`）。
- **`?text=0` / `setWords(false)`**：直接 patch 掉 `fillText`，产出"无字幕版"验证"不看字能不能读懂画面"（`text.js:47-53`）。
- **prewarm**：播放前在小尺寸把所有段的关键时刻跑一遍，把 shader 编译和首次分配全部提前（`engine.js:170-185`）。
- **"发布即冻结"的确定性纪律**：`Swarm` 的档位是**编译期拼 GLSL**而不是加 uniform 开关，
  理由是"加一个 1.0 的因子都会改变编译器的舍入"；GLSL 哈希用**整数位混合**而非浮点 sin 哈希（`gpu.js:3`）。

---

## 5. 我方（D:\ai动画）现状对照

| 维度 | 对方 | 我方 | 差距性质 |
|---|---|---|---|
| 时间对齐 | onset 吸附（鼓点/唱词起音）+ 提前一帧 + 贴不上报错 | 拍/小节网格量化；有 kick 事件但只用于画面 | **工具缺失**，可补 |
| 镜头间运动 | 真 3D 相机位姿插值（绕主体、正交↔透视） | post 的 2D zoom/shake + 甩镜 | **架构差距**，可补 |
| 剪辑层 | 独立剪辑表，可一表多版，带 ramp/punch/shift | 时间线里写 `dur/overlap` | 概念缺失 |
| 后处理 | AgX + Karis bloom + TPDF dither + 8 种转场 | bloom/halation/grain/ca/... 无 tonemap/dither | 参数级，便宜 |
| 段间引用 | `renderShotAt` / `capture` 任意段互相引用 | 段之间互相隔离 | 能力缺失 |
| 文字 | 两个 Canvas2D 层 + 3D 字形场（GlyphField） | 文字层 + 3D 里投影贴标签 | 粒度差异 |
| 字幕 | 平台无关纯逻辑（rules/schedule/style），网页与成片共用；不自动断行；与画面文字冲突就降行 | 引擎字幕层 `captions: true` + `lint-narration-dup` 自查 | **同级**（我方还多一道静态检查） |
| 音频分析 | beat_this + All-In-One 交叉验证的拍网格；onsets 鼓 514/人声 509；features 12715 帧 × 25 通道（含分轨 rms、16 带 mel） | FFT 自相关估 tempo + kick/snare/hat 事件 + rms/low/mid/high/vocal/flux | 分析深度差一档 |
| 画质自适应 | 每镜成本表 + 两参数设备模型 + GPU timer + 两级保底 | 无（离线逐帧渲染，不需要） | **不需要抄**（交付形态不同） |
| 版本冻结 | `remade(ctx)` 代码内分支，已发布版本路径不变（241 处） | `hashes --baseline` 事后验证 + 老任务不回头改 | 目的一致，做法不同 |
| 确定性 | 整数位哈希、编译期冻结、零累积状态 | 纯函数铁律、`rng(seed)`、子帧乱序 | **同级**，我方纪律不弱 |
| 骨架封装 | 每章一个 kit + hud/glyphs/look/modes 库 | `src/kit/` + `src/shots/` 模板 | **同级** |
| 内容产能 | 131 个效果模块 / 5 万行，AI 写 | 8 个模板 + 手写场景 | 产能差异 |

**我方并不落后的是**：确定性纪律（甚至更严格：渲染期间不写文件、子帧乱序、hashes 基线）、
镜头骨架封装（`makeShot`/`makeThreeShot`）、背景连续性（`world: 'auto'` + 一个走完全片的母题）、
信息分工（画面只放标注、字幕交引擎）。

## 6. 不该照抄的

1. **305 镜 / 0.5 秒一刀**：这是 MV 的类型特征（快剪 + 抽象隐喻），
   与我方"科普/介绍片"的信息密度需求相反。**要抄的是"剪辑密度跟着内容走"**（chant 章：
   fork bomb 指数增长 → 剪辑从一拍一镜加速到一拍四镜），不是绝对值。
2. **实时渲染作为交付形态**：我方交付 mp4（确定性逐帧 + 运动模糊 + ffmpeg），
   对方的网页形态是"同一引擎的第三个 mode"，不是替代品。
3. **音频加密/域校验**：版权场景不同，与我方无关。
4. **"仓库里放构建产物"**：他们有自己的构建管线（rolldown/Vite），发布产物只是可读；
   我方是源工程直接用，不需要引入构建层。

## 6.5 我的判断：它为什么好看

**不是因为它技术先进。** 它的技术栈很朴素：Three.js + 自研 GLSL + Canvas2D 文字 + 一趟 uber 后处理。
没有光追、没有 PBR 管线、没有后期软件。真正拉开差距的是三件事，而这三件事**互相依赖**：

1. **密度**：每一屏都有信息（HUD 读数、时间码、3D 空间里的源码），没有一屏是"漂亮的空镜"；
   305 个镜头、中位 0.5 秒——不是"为了快而快"，而是**一个镜头只负责一个视觉点子**，点子用完就切。
2. **对位**：画面与歌词是**语义对应**的，不是配图。整流桥 ↔ "Switch my current / To AC to DC"；
   六叶光圈每说一个词降两档 ↔ "blind my vision"；笔记本上的心脏线 ↔ "I've studied how to properly LO-O-OVE"；
   fork bomb 的 H 树 ↔ "EXECUTION ×12"。这种对位**必须写下来**才能维持 305 个镜头不走形 ——
   而它就写在每个章节文件顶部的注释里（`src/ch/04_pre1.js:1-17`、`src/ch/12_chant.js:1-11`）。
3. **节奏**：切点吸附到真实鼓点/唱词起音、统一提前一帧、贴不上就报错；**剪辑密度跟着内容走**
   （chant 章：fork bomb 每击翻倍 → 1–4 击一拍一镜、5–8 击一拍两镜、9–12 击一拍四镜）。
4. **真的算**：不是"画得像"，是**把答案算出来**——颜色来自 CIE 1931 拟合 + Cauchy 色散 + 番茄红素三峰吸收；
   星空用黑体色 + 幂律星等 + 密度 ∝ sinρ；电路用 |sin| 的 Fourier 级数解一阶 RC 的闭式解；
   沙粒在顶点着色器里做牛顿迭代落 Chladni 节线、贝塞尔零点运行时求；`c1/transformer.js` 用的是
   **真 GPT-2 BPE token id**；`love/curves.js` 的 8 轮 Fourier 心是**精确**的。
   观众未必认得出公式，但认得出"这不是随手编的"。**这是投入产出比最高、也最容易被跳过的一条。**
5. **交接**：相邻镜头在构造上对接（见 §4 ⑨），而不是靠"背景不变"掩盖切换。

**推论（对我方最重要的一条）**：我方的引擎在"**画面**"这一层已经很强
（确定性、骨架封装、背景连续性、字幕层、静态检查），但在"**剪辑**"这一层还很薄 ——
时间线上只有 `dur` / `overlap` / `{beat:n}`，没有"事件级对齐"，没有可替换的剪辑表，
没有镜头之间的运动连续性。**对方真正的可借鉴之处，是把剪辑决策也变成了可写、可查、可验证的东西。**

---

## 7. 建议的落地顺序（待确认，先不写代码）

按"便宜 → 贵"排；每一项都能独立落地、独立验证，不需要一次做完。

1. **便宜且立刻见效**（改 `src/core/post.js` + 一个工具）：
   - 后处理加 **AgX tonemap**（可选档，默认关，先出 A/B 图对比）；
   - 输出前加 **TPDF dither**（消除 8-bit banding，几乎零成本）；
   - bloom 下采样加 **Karis 权重**（杀极亮单像素的 fireflies）。
2. **工具层**（新增 `src/core/edit.js` 之类 + 扩 `audio-analysis`）：
   - 音频分析补**人声起音 onset** 与"最近事件"查询；
   - 时间线/配置档引入 `hit(sec, beat)` / `syl(sec, beat)` 语法（贴不上就报错），
     与现有 `{beat:n}` 并存。
3. **镜头语言**（改 `src/core/trans.js` + `src/kit/*`）：
   - 引入 `rig` 式的相机探针协议（probe/drive），先只对 `makeThreeShot` 与 `camera3` 生效；
   - 加 `relay` 转场类型（相机位姿插值 + 内容换手窗口）。
4. **剪辑层**（改 `src/timeline.js`）：
   - 允许"一张可替换的剪辑表"覆盖段的 `at/join/shift/punch`，支持一表多版。
5. **段间引用**：`ctx.renderShotAt(id, t)`（闪回/记忆/画中画）。
6. **内容层（不改引擎，改工作方法）**：
   - 每支片子先建一层"物理/统计模型"（真的算，见 §6.5 第 4 条）——这是投入产出比最高的一条；
   - 分镜写进场景文件顶部注释（对方 131 个模块每个都有）；
   - 为关键镜头对写"交接面"（共享常量 / 共享几何 / 共享 seed），见 §4 ⑨。
7. **不要动的**：不需要为了这些去改确定性铁律、`world: 'auto'` 的共享背景配方、
   或"字幕交引擎"的信息分工——这些我方不比对方弱。

---

## 附：证据与产物位置

| 内容 | 路径 |
|---|---|
| 参考项目本地副本 | `out/_refs/world-execute-web/` |
| 跑起来截图（含联络表） | `out/_refs/shots/`（`_sheet.png` 是 16 格联络表，`shots.json` 是 305 段的 id/start/end/join） |
| 截图脚本 | `out/_refs/shoot.mjs`（内嵌静态服务器 + 无头 Chrome + `player.still`） |
| 内联原始源码提取（160 份，含被构建剥掉的注释） | `out/_refs/src-glob/`（`extract-glob.mjs` 生成） |
| 子系统深读报告（子代理） | `out/_staging/world-execute/{A-visuals,B-player,C-engine,D-data-ai}.md` |
