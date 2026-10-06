# STATUS.md —— 本轮改进的进度与证据

> 这份文件记录「读文档 → 核实不足 → 修复 → 验证」的每一步。
> 每条都写清：**问题**、**证据**、**改了什么**、**怎么验的**、**当前状态**。
> 它比 `docs/history/HANDOFF.md` 更"过程"；那份是上一轮的交接单（已过期，只作历史参考）。
>
> **最后一次更新**：第十二轮 —— **Three.js 接进引擎**（第 3 种 3D：真网格）。
> Three.js 的画面作为**一张图层**进合成器：`check` 18 帧全绿、`verify` 8/8（mean 2.10–2.40）、
> 确定性 40/40、`hashes demo`/`beat` 各 11/11 **max 0**、沙盒 876 帧成片（2.8 fps）。
> 新量具 `tools/probe-three.mjs`（10 条判据）已进回归清单（§19）。
> 第十一轮 —— **sodium 的画面可读性**（半实心积木 + 深度排序；246s 成片重出、`verify` 26/26、
> `hashes` 12/12 max 0）在 §18。
> 第十轮（出片推流换 NV12）在 §17；
> 第九轮（`IMPROVEMENTS-3` A–F + 渲染提速：`readPixels` 195ms → 6.4ms、端到端 3.8 → 7.5 fps）在 §16。
> 第七轮（A 档镜头库 `src/shots/`，8 个模板，22/22 帧逐像素不变）的证据在 §14。
> 本文与代码不一致时以**代码为准**。

---

## 0. 本文件的几轮

| 轮次 | 内容 | 看哪一节 |
|---|---|---|
| 第一轮 | 导出色彩空间、多子帧自检、4K、转场库、分段渲染、任务级字体、场景级变换 | §1–§9 |
| 第二轮 | **`docs/IMPROVEMENTS.md` 的 17 条**：产物守门、背压判据、共享背景、`src/kit/`、诊断效率 | §10 |
| 第三轮 | **`docs/IMPROVEMENTS-2.md`**：静默失败（P0）、验收与一致性（P1）、效率与工作流（P2） | §11 |
| 第四轮 | **收尾**：⏸ 回归跑完、`probe-trans2` 判据重写、口播/旁白 B/C 档落地、beast 的配置口径拍板 | §12 |
| 第五 / 六轮 | pdoom-video 的「3D + 一镜到底」搬进引擎；**raymarch 通电**（三个"不报错"的接缝 + 非有限值判据） | §13 |
| **第七轮** | **A 档镜头库 `src/shots/`**：常见镜头从一百多行降到一行，画面逐像素不变 | §14 |
| **第八轮** | **B 档「配置档」**：时间线里直接写 `{ type: 'chart', … }`，任务可以只有 `task.config.mjs` | **§15（先看这个）** |
| **第九轮** | **`IMPROVEMENTS-3` 的 A–F 全部落地** + **渲染提速**（`readPixels` 30×、端到端 1.97×、`--gpu high`）+ 新瓶颈（传输）探明 | §16 |
| **第十轮** | **出片推流换 NV12**：每帧 8.29 → 3.11MB（−62%），ffmpeg 直接吃 `-pix_fmt nv12`；新量具 `probe-nv12` | §17 |
| **第十一轮** | **sodium 的画面可读性**：半实心积木 + 深度排序（"排序用的深度不能拿去算线宽"）；246s 成片重出 | §18 |
| **第十二轮** | **Three.js 接进引擎**：第 3 种 3D「真网格」；沙盒 = Three.js → **引擎自绘过渡** → Three.js | **§19（先看这个）** |

§1–§13 是前几轮的记录，结论仍然有效（除 §11.3 明确更正的那一处）。


---

## 0. 本轮结论摘要

| 编号 | 问题 | 状态 | 验证方式 |
|---|---|---|---|
| P0-1 | 导出缺 linear→sRGB 编码（导出比预览暗） | ✅ 已修 | 标定夹具逐值比对（188/137/225） |
| P0-2 | 渲染中断仍报「✓ 出片成功」 | ✅ 已修 | 注入式回归 `tools/smoke-interrupt.mjs` |
| P0-3 | `check`/`still` 测不到多子帧路径 | ✅ 已修 | 注入式回归 `tools/smoke-overexposure.mjs` |
| P1-1 | `post.center` 声明了但没接线 | ✅ 已修 | 看图（绕 (200,200) 推近，锚点不动） |
| P1-2 | 没有场景级变换 | ✅ 已加 `ctx.setXform` | 数学单测（误差 9e-13 px）+ 看图 |
| P1-3 | 字体没有任务级入口 | ✅ 已加 `task.fonts` | `tools/probe-fonts.mjs`（宽度≠回退） |
| P1-4 | 转场没有库 | ✅ 已加 `src/core/trans.js` | `tools/probe-trans2.mjs` + 看图 |
| P1-5 | 渲染成本高且不能断点续渲 | ✅ 已加 `video --segments` | 720 帧/12.000s 逐帧核对；重跑 0.2s 全跳过 |
| P1-6 | 推流没有背压 | ✅ 已修 | 见 §7.1（附看门狗误报的修复） |
| **P1-7** | **真 4K（`--scale 2`）矢量不出图** | ✅ **根因定位并修好，`--scale` 已解禁** | 80px 白带子在两个倍率下逻辑位置/尺寸逐像素一致；`demo` 4K 出图看过 |
| P1-8 | `--only` 保留全局时间，几乎总是取到段外 | ✅ 已修 | `--only ribbon -t 1.2` 现在能出图 |
| P2 | 文档里的过时结论 | ✅ 已改 | 见 §6、`HANDOFF.md` 顶部更正 |
| — | `nekohome` 的颜色绕行代码 | ⚠ 待决定 | 见 §8（需要用户拍板，会改动已成片的外观） |

---

## 1. P0-1 导出缺 linear→sRGB 编码

### 1.1 问题

整条渲染链在线性光里跑。浏览器预览经过 `gl.blitPass` 的 `toSRGB()` 编码，**导出没有**：
`gl.readPixels()` 读的是编码前的 `outRT`（线性值），而 `src/app.js` 的 `png()` 与 `stream()` 都走它。

### 1.2 证据（`tasks/_calib` 标定夹具，场景只 `gl.clear` 一个已知线性色）

| 场景线性值 | 修复前导出 | 修复前显示（画布） | 正确 sRGB |
|---|---|---|---|
| 0.5 / 0.25 / 0.75 | **128 / 64 / 192** | 187 / 137 / 224 | 188 / 137 / 225 |
| 0.05 | **13** | 64 | 64 |
| 1.0 | 255 | 255 | 255 |

修复前导出值 = 线性值 × 255（"线性直出"）；显示值 = 正确 sRGB。
复现：`node tools/probe-colorspace.mjs _calib`。

### 1.3 ⚠ 对 `HANDOFF.md` 旧结论的更正（重要）

`HANDOFF.md` 原来写「修好编码后 `tasks/nekohome` 的 `disp/dcss/dscale` 必须回改」。这条的**连带影响写反了**：

- 实测**预览一直是对的**（0.5 显示 187 ≈ 正确 188），错的是**导出**（128）；
- 所以 `_kit.js` 里那三个函数不是"让预览正确"，而是"让没编码的导出看起来正确"，
  代价是 **GLSL/矢量通道偏亮、Canvas2D 通道偏暗**（两边都错，只是错得不明显）。

### 1.4 改了什么

| 文件 | 改动 |
|---|---|
| `src/core/gl.js` | `readPixels(rt, encode)` 新增第二参数：`'none'`（默认，线性原值，给调试）/ `'srgb'`（编码）。新增 `readDisplayPixels(rt)` |
| `src/core/engine.js` | `readPixels()` 改为走 `'srgb'`（导出唯一正确入口）；新增 `readLinearPixels()` 保留线性读回 |
| `src/app.js` | 注明 `png()` / `pixels()` / `stream()` 返回的都是显示空间 |

**没有动** `engine.dumpRT()` / `_dumpStages()`（仍读线性原值，排查需要）。

### 1.5 验收

```
t=0  导出 188,137,225   显示 187,137,224   （一致，误差 ≤1）
t=1  导出 64,64,64      显示 64,64,64
t=2  导出 255,255,255   显示 255,255,255
```

**影响面**：所有历史成片都比设计稿暗，重出会整体变亮。`tasks/nekohome` 的实测平均亮度
从 0.163 级别升到 **0.382** 级别（`check` 输出）—— 这是"修好"，不是"跑偏"。

---

## 2. P0-2 渲染中断仍然报「✓ 出片成功」

`cmdVideo` 原本只看 ffmpeg 退出码，**从不比对帧数**。渲染中途断流（典型触发：渲染期间改
`tasks/` 或 `src/` 下的文件 → 私有 Vite HMR 重载页面 → WebSocket 断开）会留下一个几秒钟的短 mp4
并照样打印 `✓`。

**改法**：`frames < total` 时 `die()`（非零退出）、**删除不完整的 mp4**，并点名最可能的原因。

**验收**（`tools/smoke-interrupt.mjs`，注入式）：起一次真渲染，等推帧开始后 append 一行到
`tasks/_calib/scenes/probe.js`，结果：

```
✗ 只渲染了 32/900 帧，成片不完整，已删除 out\_calib\_calib.mp4。
退出码 1（期望非 0）  → PASS
点名帧数不足  → PASS
清理不完整产物  → PASS
```

> 这个回归脚本**抓到了自己的 bug**：第一版的提示语写着"已删除"，但 `die()` 并没有真的删文件
> （残留 141111 字节的短 mp4）。断言"残留 mp4 大小为 0"才把它暴露出来 ——
> **日志说的话必须与实际行为一致，所以断言要断在行为上，不是断在日志文本上。**

---

## 3. P0-3 `check` / `still` 测不到多子帧路径

`check` 与 `still` 默认 `samples=1`，而出片是 `samples=auto`。「运动模糊求平均整帧过曝 n 倍」
那个 bug **只存在于多子帧路径**，于是 `check` 一路报「没问题」。

**改法**：
- `src/app.js` 的 `stats()` 新增 `blownRatio`（亮度>0.99 占比）与 `clippedRatio`（三通道 253+ 的"死白"占比）；
- `check` 每段渲染**两次**（`samples:1` 与 `samples:auto`），打印两者亮度与实际子帧数；
- 判据：① 单帧近全黑；② 多子帧过曝（>0.99 占 >20% 或死白 >15%）；③ **两条路径亮度差 >1.3×**；
- `still --samples 1` 会打印一行提醒。

> 坑：`lastSamples` 必须在跑完 `auto` 那一帧之后、跑 `samples:1` 之前读——它会被下一次渲染覆盖
> （第一版就踩了，5 段全报「1 子帧」）。

**验收**（`tools/smoke-overexposure.mjs`）：把 `engine.js` 的 `clear(this.avgRT, …)` 注释掉重放历史 bug，
`check` 报出 `kinetic 单帧 0.148 → 多子帧 0.868（5.85×）`、`whip 14.08×`、`outro 13.68×`，退出码 1；
不注入时 `check demo` 退出码 0。

---

## 4. P1-1 / P1-2 / P1-3

### 4.1 `post.center`（绕任意锚点推近）

`pFinal` 里声明了 `uniform vec2 center`，默认值里也有，但 `render()` 的赋值清单**漏了它** →
永远绕画面中心。现在 `PostParams.center` 定义为**逻辑像素、y 向下**（不填 = 画面中心），
在 `Post.render` 里换算成 uv。

**验收**：`_calib` 的 `xf` 场景 `zoom: 1.5, center: [200,200]` —— 左上角 (200,200) 的标记点**原地不动**，
白框向外扩张。见 `out/_calib/xf4/f_0005.500.png`。

### 4.2 `ctx.setXform`（场景级变换）

新增 `SceneCtx.xform` / `ctx.setXform({ x, y, scale, rot, anchor, edge })`。
引擎在 `composite()` 里把**整张前景**（含它自己的文字图层）用一张全屏 Pass 重采样到 `xformRT`
（绝不"读自己写自己"）。`edge: 'clamp'`（默认）画面外夹到边缘，适合整体运镜；
`edge: 'black'` 画面外为黑，适合**视差**（背景不动、只有前景动）。

数学：`xformForward()`（逻辑空间正向）+ 换基到 uv + **求逆**（shader 要的是"输出点采源图哪里"）。
⚠ 换基之后与 y 有关的项会变号，所以不能把正向矩阵直接当采样矩阵用（第一版就是这么错的）。

**验收**：`tools/test-xform-math.mjs` 六组变换最大误差 **9e-13 px**；出图确认平移/缩放/旋转与文字同走。

### 4.3 `task.fonts`（任务级字体）

以前只能用改**全局** `public/fonts/fonts.css` 的办法，两个任务想用不同字体就打架。
现在 `task.config.mjs` 里写：

```js
fonts: './fonts/brand.css'                                  // 自己写 @font-face 的样式表
fonts: ['./fonts/Brand-600.woff2']                          // 字体文件，自动包成 @font-face
fonts: [{ file: './fonts/Brand-600.woff2', family: 'Brand', weight: '600' }]
```

`app.js` 的 `loadTaskFonts()` 在第一帧之前 await 完成（否则离屏截帧会拍到方框）。

**验收**：`tools/probe-fonts.mjs` —— `document.fonts.check()` 为 true，且同一串字用该字体量出的宽度
**不等于**回退字体（629.8 vs 689.5），证明真的换了字形而不是静默回退。

---

## 5. P1-4 转场库 `src/core/trans.js`

从 `tasks/nekohome/scenes/_kit.js` 里把那套**已经验证过**的"一镜到底"配方反向抽进引擎：

| 导出 | 作用 |
|---|---|
| `transitionPass(gl, opts)` | 把上一段那一帧沿摄影机方向**加速甩出去** + 方向拖尾（不是原地淡出） |
| `cameraAt(t)` / `cameraDir(t)` / `cameraPost(t, extra)` | 全片**一台摄影机**，只用整片时间驱动 |
| `enterOffset(t, k, amount)` | 前景从**反方向**落位 |
| `makeTransitionKit(ctx)` | 一句装好；每帧 `tk.openFrame(ctx, 背景Pass)` 即可 |

配方四条（写进了 `AGENTS.md` §11）：全片一层背景、全片一台摄影机、一个走完全片的母题、
交叠期把旧的甩走并让新的反向落位。

**验收**（`tools/probe-trans2.mjs`）：同一时刻渲染"只有 A"与"A+B 交叠"两份，逐像素差分
（两边跑同一套确定性代码，差异只可能来自转场）：A 的领地差异 4.9–9.5%、结束时亮度 21.1%→15.3%、
全程锐利度不塌 → PASS。视觉上见 `out/_calib/trans/`：ALPHA 带着方向拖尾被推走、BRAVO 从反方向带模糊落位。

---

## 6. P1-5 / P1-6 / P1-7 / P1-8

### 6.1 `video --segments`（分段渲染 + 拼接）

```sh
node scripts/anim.mjs video <任务> --segments 4        # 切 4 块；切点优先落在段边界
node scripts/anim.mjs video <任务> --segments 4 --force # 忽略已存在的分块，全部重渲
```

- 已渲好的块**自动跳过**（放在 `out/<任务>/<任务>.parts/`）；
- 音轨单独切一次再和拼好的画面一起封装（比每块带音轨更稳）；
- 帧数不足时**保留**已渲好的块并报错，修完直接重跑即可。

**验收**：720 帧 / 12 秒的片子分 5 块渲完，`ffprobe` 得 `nb_read_frames=720, duration=12.000000`；
再跑一次 0.2 秒全部跳过。

### 6.2 推流背压

`ff.stdin.write()` 的返回值原本被忽略。现在返回 `false`（内核缓冲满）时**停发 ack**，
页面自然停下来等，`drain` 之后再把攒下的 ack 补上。

> 顺带修了一个更严重的**看门狗误报**：原判据是"距上一帧超过 15 秒"，但页面是 `inflight`
> 多帧在途、收满最后几帧后会有一段"等 ffmpeg 排空"的时间 —— 于是正常收尾被判成"渲染停滞"，
> 提前收工。现在判据改成**没有进展**（收帧数与页面 `sent` 都不动）+ 30 秒阈值（`--idle` 可调）。

### 6.3 P1-7 真 4K（`--scale 2`）：这是本轮最大的发现

**症状**：`SCALE=2` 时用 `lines` 画的矢量全部消失（文字、Canvas2D、后处理都正常）。
这正是 CLI 一直**显式拒绝 `--scale`** 的原因，`ENGINE.md`/`AGENTS.md`/`COOKBOOK.md` 都把它写成已知限制。

**根因**：`LineBatch` 的**顶点着色器**用**物理**分辨率换算裁剪空间：

```glsl
vec2 clip = (p / res) * 2.0 - 1.0;   // ✗ p 是逻辑像素，res 是物理分辨率
```

`p` 本来就是逻辑像素，除以物理尺寸后 SCALE=2 时只得到正确 NDC 的一半 → 几何落在别处、
或被裁掉，于是片元着色器**一个像素都没跑到**（实测：诊断版 FS 在 scale 1 命中 82 行、
scale 2 命中 0 行；而 uniform `res`/`PX_SCALE` 在两边都是对的）。

**修法**：顶点着色器改用**逻辑**分辨率，与 SCALE 无关：

```glsl
vec2 clip = (p / RES_LOGICAL) * 2.0 - 1.0;   // ✓
```

**验收**：`tools/probe-ribbon.mjs` —— 一根 80px 纯白矢量带子（逻辑 300–1620 × y 360–440）
在 scale 1 与 scale 2 下量出来**逻辑位置与高度完全一致**（360–439，高 80）；
`node scripts/anim.mjs still demo -t 6.5 --scale 2` 出图确认柱状图的矢量、网格、坐标轴、文字、泛光都在。

**顺手解禁**：`scripts/anim.mjs` 里那段"拒绝 scale>1"的代码删掉了，改成只校验 1..4。

### 6.4 P1-7b GL 程序缓存跨上下文串味

`LineBatch._program()` 用**固定的** `'linebatch_v1'` 当程序缓存键。一个页面里出现第二个 WebGL2
上下文时（页面上另开 canvas、诊断脚本、将来的多视图预览），第二个上下文会从 `gl.programs`
里拿到**第一个上下文的 program 对象** —— 那是别的上下文的对象，画不出任何东西而且不报错。
现在 key 带上 `gl.instanceId` 做隔离。

### 6.5 P1-8 `--only` 的时间语义

`--only` 原本只做"过滤 + 改名"，段的时间仍然是**全局时间**。于是
`still <任务> -t 1 --only chart` 几乎总是取到段外（全黑），还会顺带报一堆"空档"。
现在 `--only` 会把选中的段**平移到时间轴开头**，`-t` 就是段内时间。

**验收**：`still _calib -t 1.2 --only ribbon` 直接出图（带子 360–439）。
⚠ 副作用（已写进 `ENGINE.md`）：段的 `f.t` 变了，而 `music` 仍按整片时间 —— 用 `--only` 迭代时
"踩拍子"的段落和成片对不上，这是刻意的取舍（看单段不要跨到整片时间轴上找）。

---

## 7. 新增的诊断/回归工具（都在 `tools/`，不参与出片）

| 脚本 | 用途 |
|---|---|
| `probe-colorspace.mjs [task]` | 对比"导出（readPixels）"与"浏览器显示（画布）"的像素值 —— 色彩空间标定 |
| `probe-samples.mjs [task]` | 打印各入口实际用掉的子帧数 |
| `probe-timeline.mjs [task]` | 打印页面实际加载到的时间线与探针像素 |
| `probe-ribbon.mjs [t] [scales]` | **4K 验收**：粗矢量带子在两个倍率下的逻辑位置/尺寸 |
| `probe-fonts.mjs [task]` | 任务字体是否真的生效（宽度 ≠ 回退） |
| `probe-trans2.mjs [task]` | 转场是"推走"还是"糊在一起"（确定性 A/B 差分） |
| `test-xform-math.mjs` | `xformMatrix` 纯数学单测（不需要 GPU） |
| `png-rows.mjs <png> [x]` | 直接量一张 PNG 的逐行亮度（判断"那根线到底在不在"） |
| `smoke-interrupt.mjs` | 注入式回归：渲染中断必须非零退出 |
| `smoke-overexposure.mjs` | 注入式回归：`check` 必须挡住"多子帧过曝" |

`tasks/_calib/` 是**标定夹具**（不是片子）：`probe`（已知线性色）、`xf`（变换 + post 锚点）、
`ribbon`（4K 验收）、`trans`（转场）。

### 7.1 用 `png-rows.mjs` 时的坑

它从 `ffprobe` 读真实尺寸。早先的版本写死 1920×1080，读 3840×2160 的 PNG 时会按错误步长
采样，得出"4K 画面全黑"的**假结论**——同一个错误的探针差点让我把已经修好的 4K 判成没修好。

---

## 8. 待用户拍板：`tasks/nekohome` 的颜色绕行代码

`tasks/nekohome/scenes/_kit.js` 顶部有 `disp() / dcss() / dscale()` 三个函数，注释写着
"引擎最后是把线性值当显示值直接写进 8bit 输出的"。按 §1.3 的实测，这个判断只对了一半：

| 通道 | 现在的做法 | 结果 | 改成 `P.xxx` / `css(P.xxx)` 后 |
|---|---|---|---|
| GLSL / `lines` | `disp()` = 显示值当线性值用 | 偏**亮**（bone 约 249 而非 238） | 回到设计稿本来的亮度 |
| Canvas2D 文字 | `dcss()` = 显示值再喂给 `css()` | 偏**亮**（会线性化两次） | 与官网字色一致 |

**为什么没有直接改**：这会让**已经交付的成片外观发生变化**（整体略暗一点点、层次回来），
而且 `tasks/nekohome` 里大量 `dscale(P, …, 1.35)` 这类系数是照着现在的观感调的。
这是"改一个内容已定稿的片子"，不该由我单方面决定。

**两个选项**：
- A：改回 `P.xxx` + `css(P.xxx)`，然后重新出片核对（约 43 分钟 + 一次观感复核）；
- B：保持现状（它能跑、也没有报错），只在 `_kit.js` 里把注释更正为"这是历史绕行，不是设计要求"。

---

## 9. 回归清单（本轮跑过，全部通过）

```sh
node scripts/anim.mjs check demo        # ✓ 5 段，两条路径一致
node scripts/anim.mjs check beat        # ✓ 3 段
node scripts/anim.mjs check nekohome    # ✓ 8 段
node tools/test-xform-math.mjs          # ✓ 最大误差 9e-13 px
node tools/probe-ribbon.mjs 11.2 1,2    # ✓ 两个倍率几何一致（4K）
node tools/probe-trans2.mjs _calib      # ✓ 推走而非糊掉
node tools/probe-fonts.mjs _calib       # ✓ 任务字体生效
node tools/probe-colorspace.mjs _calib  # ✓ 导出=显示
node tools/smoke-interrupt.mjs          # ✓ 中断非零退出 + 真的删掉不完整产物
node tools/smoke-overexposure.mjs       # ✓ 过曝被拦住
node scripts/anim.mjs video _calib --from 0 --to 12 --segments 3 --samples 1 --noaudio
                                        # ✓ 720 帧 / 12.000s，重跑 0.2s 全跳过
node scripts/anim.mjs still demo -t 6.5 --scale 2   # ✓ 真 4K，矢量在
```

> `probe-colorspace` / `probe-ribbon` / `probe-fonts` / `probe-trans2` 跑在 `tasks/_calib` 上，
> 所以那个标定夹具**故意留在仓库里**（它是回归工具的一部分，不是"没删掉的临时任务"）。

---

## 10. 本轮：`docs/IMPROVEMENTS.md` 的 17 条

### 10.0 一句话

**这一轮卡住上一轮的，不是渲染能力，是「引擎不把错误说出来」。** 所以本轮的重点全都落在
**产物与状态的守门** 上：出片产物用 ffprobe 复核、背压不再被误判成卡死、漏画背景能被点名、
诊断命令（`verify` / `hashes` / `probe` / `audit`）补齐。修完的结果是：
**上面那三类"静默产出废品"的情况，现在都会以非零退出码 + 一句点名的话结束。**

### 10.1 逐条状态

| 编号 | 问题 | 状态 | 验收方式（可复现） |
|---|---|---|---|
| P0-1 | `--idle 30` 把 ffmpeg 背压误判成卡死 → 产出没有 moov 的废文件 | ✅ 修 | `node tools/smoke-backpressure.mjs demo 0.5 30 12` |
| P0-2 | 漏画共享背景 → 整段静默黑底，`check` 抓不到 | ✅ 修 | `node tools/smoke-background.mjs` |
| P0-3 | CLI 的「✓ 出片成功」不可信 | ✅ 修 | 见 §10.2；`video`/每块/拼接后都会 ffprobe 复核 |
| P1-1 | 通用镜头工具重复写了三遍 | ✅ 修 | 抽出 `src/kit/`；`fidus` 改为转发后 `hashes --baseline` 逐像素一致 |
| P1-2 | 「一层背景 + 一台摄影机」配方没进引擎 | ✅ 修 | `src/kit/world.js` + `cut(shot,{world:'auto'})`；`demo` 的 `check` 走新路径 |
| P1-3 | `type.write` 的 `alpha` 只在 `stagger>0` 时生效 | ✅ 修 | `node scripts/anim.mjs probe-alpha _calib`（4 项全 PASS） |
| P1-4 | `type.write` 的 `align` 是逐字生效的 | ✅ 修 | 新增 `type.writeLine(text,x,y,{anchor})`；脚手架已改用它 |
| P1-5 | `LineBatch` 没有填充图元；alpha 没写进文档 | ✅ 修 | 新增 `lines.fillRect(...)`；文档补 alpha 说明 |
| P1-6 | `post` 参数没有方向与单位（`fade` 尤其反直觉） | ✅ 修 | `AGENTS.md` §5 / `ENGINE.md` §8 给了 0/1 含义表 |
| P2-1 | `check` 每段只采一个点（正中） | ✅ 修 | 改为 15%/50%/85% 三点 + 段内亮度不均告警 + `--sheet` |
| P2-2 | 没有「成片 vs 静帧」的自动比对 | ✅ 修 | `node scripts/anim.mjs verify <任务>` |
| P2-3 | 耗时没有预估 | ✅ 修 | `node scripts/anim.mjs video demo --dry-run` |
| P2-4 | `--segments` 的语义与注释承诺不符 | ✅ 修 | `node tools/test-segment-cuts.mjs`（4 项/档全 PASS） |
| §4 | 文档与脚手架的事实错误 | ✅ 修 | 见 §10.4 |
| §4 | `FACTS.md` 格式应沉淀 | ✅ 修 | 新增 `docs/FACTS-TEMPLATE.md` |
| §5 | 沙箱/管道的前置条件没写 | ✅ 修 | `AGENTS.md` §1 加了前置条件段 |
| — | `docs/HANDOFF.md` 已过期但被并列引用 | ✅ 修 | 移入 `docs/history/`，链接与顶部说明都改了 |

### 10.2 P0-1 / P0-3：为什么「自己数的帧数」不可信

上一轮的废品是这样产生的：`ff.stdin.write()` 返回 false → 按设计**停发 ack** → 页面（发一帧等一个 ack）
停下来等 → 看门狗的续命判据是「页面侧的 `sent` 在涨」，而页面正在等 ack、`sent` 当然不涨 →
判「渲染停滞」→ 收工 → `stdin.end()` → ffmpeg 拿到半截流、**永远不写 moov**。
日志里进度条跑到 330/330，产物却打不开。

三处改动：

1. **判据改成"四个信号全静止才算卡死"**：收到新帧 / 页面 `sent` 在涨 / ffmpeg 在排水
   （`stdin.writableLength` 在变短，或刚 drain 过）/ 输出文件在变大 —— 任一条成立就续命。
2. **把两种"没帧"分开报**：背压是「在等 ffmpeg 排水」，不是「渲染停滞」。
   上一轮的第一反应是去查页面崩没崩、WS 断没断，全查错了。
3. **产物守门**：每块渲完、拼接完、收尾时都用 `ffprobe` 复核**实际写出来的文件**，
   帧数不符就报错并删掉废产物。`--idle` 默认值也从 30 提到 300。

验收（`tools/smoke-backpressure.mjs`，用 `tools/slow-ffmpeg.mjs` 按字节速率限速以稳定复现背压）：

```
$ ANIM_FFMPEG="node tools/slow-ffmpeg.mjs" ANIM_SLOW_MBPS=12 node tools/smoke-backpressure.mjs demo 0.5 30 12
  15/15 帧  2.4 fps  ETA 0s  背压中(积压 55.4MB)
✓ out/demo/smoke-backpressure.mp4
  15 帧（ffprobe 复核 15 帧），用时 10.1s
退出码 0（期望 0）  → PASS
没有被误判成停滞  → PASS
真的发生了背压  → PASS
产物可打开且帧数正确：ffprobe 15 / 期望 15  → PASS
```

> 守门还当场抓到了我自己的一个 bug：`ffprobe` 的路径推导把包装器名
> `slow-ffmpeg.mjs` 里的 "ffmpeg" 替换成了 "ffprobe"，于是 ffprobe 收到 ffmpeg 的
> `-loglevel error` 参数直接 `Unrecognized option` 退出，守门误报。
> **守门自己出错时必须是"报错"而不是"放行"** —— 这次它报了，所以立刻被看见。

### 10.3 P0-2：怎么把「静默黑底」变成可测的

漏画背景的段，画面看上去有 grain 和暗角，亮度统计也远超"全黑"阈值
（实测 0.054，而判据是 0.004 的 13 倍），所以**亮度判据永远抓不到**。

改法分两层：

**① 地基层：共享背景成为一等公民**

```js
// task.config.mjs
export const world = (ctx) => worldPass(ctx, { grid: 60 });
// 时间线
cut(shot, { dur: 6, world: 'auto' });   // 引擎每帧先铺背景，再调场景 render
cut(shot, { dur: 6, world: false });    // 明确表示"我自己负责整帧"
```

**② 守门层：按「实际发生的绘制」记账**

`gl.js` 里给每次绘制记账（`paint.full` = 不透明全屏覆盖次数、`paint.any` = 绘制总次数、
`paint.lines` = 矢量批次数），引擎在每段 `render` 前后重置并记录。判据：

> 一个**声明了 `handlesTransition`（或共享背景）**的交叠段，在交叠期如果
> **一次整帧覆盖都没有**，那它的底就是黑的。

两个必须踩对的细节（都踩过）：

- **`blend:false` ≠ 铺满整帧**：合成器的图层绘制也是 `blend:false`（它自己保留 rect 外的像素）。
  第一版把它算成"覆盖了整帧"，于是一段**只有文字**的场景被判成合格。
  现在 `Compositor.draw` 显式传 `noFull`。
- **混合状态不能靠猜**：`_notePaint` 原来自已去读 `g.isEnabled(g.BLEND)`，而某次内部 Pass
  会把 BLEND 关掉并留着，于是后面一次带混合的绘制被误记成"覆盖整帧"。
  现在由**调用方**（Pass 知道自己设了什么）显式给出。

验收（`tools/smoke-background.mjs`，往 `_calib` 注入一个"只写字不铺底"的段）：

```
⚠ 背景守门：1/2 个交叠段**没有铺满整帧的背景**
  [bgcheck] t=17.15s  整帧覆盖绘制 0 次（本帧总绘制 1 次），声明了 handlesTransition
    → 这些段的底是纯黑（只有 grain 和暗角），而且亮度统计抓不到。
退出码 1（期望非 0）  → PASS
点名了漏画背景的段  → PASS
```

不注入时：`demo` 1/1 段通过、`nekohome` 7/7 段通过、`_calib` 2/2 段通过。

### 10.4 P1-1 / P1-2：`src/kit/`，以及「怎么证明重构没改画面」

`tasks/nekohome` 与 `tasks/fidus` 的 `_kit.js` 各约 450 行，语义几乎一样的有一大批。
本轮把**通用件**收进引擎（`src/kit/`），任务里只留这支片子特有的视觉：

| 文件 | 内容 |
|---|---|
| `layout.js` | `put` / `writeLine` / `fade` / `typed` / `codeRow` / `seqRnd`（不碰 GPU） |
| `elements.js` | `panel` / `fillRect` / `kicker` / `footer` / `reticle` / `marker` |
| `world.js` | `worldPass` / `cameraAt` / `cameraDir` / `cameraPost` / `enterOffset` / `makeWorldKit` |
| `shot.js` | `makeShot(id, {setup, draw, post})` —— 把"一个镜头的骨架"包成函数 |

**验收方式（这是本轮新增的能力）**：`anim.mjs hashes <任务> --save` 存一份基线
（原始像素 + 每帧 delta 压缩），重构后 `--baseline` 逐像素比对：

```
$ node scripts/anim.mjs hashes fidus --times 0.5,5,12,20,30,40,50,59.5 --save
$ node scripts/anim.mjs hashes fidus --baseline
  t=0.500  ✓ 画面一致  max 2  mean 0.0000  >16 0.0000%
  ...
  t=40.000  ✓ 画面一致  max 6  mean 0.0019  >16 0.0000%
✓ 8 帧全部与基线一致（画面没有被改动）
```

> **判据不是"哈希相等"，而是"差了多少"。** 实测：GPU 在少数 tile 上有最后一位噪声，
> 交叠到 90%+ 的转场帧会把它放大到 max 8–10/255（`demo` 的 t=10/t=12 在同一份基线上
> 反复重渲稳定复现）。判据取「>16 的像素一个都没有 + mean < 0.002」——
> 16/255 已经是看得出来的台阶，而噪声天花板是 10，中间留了一档。
> 一开始用 `max ≤ 2` 判，被自己的噪声打回来了两次。

### 10.5 P2-1 / P2-2：诊断效率

- **`check` 每段采三个点**（15% / 50% / 85%），各测单子帧与多子帧。原因很实在：
  上一轮遇到的压字、漏字、准星压字三个问题，全都出在**入场的头 1 秒**，而旧 `check`
  只采正中——一次都没报。现在还会报「段内亮度不均」（最低 → 最高跨过阈值）。
- **`anim.mjs verify <任务>`**：从成片里抽帧，与同一时刻重新渲染的帧逐像素比。

  两个必须踩对的细节：① `-ss <t> -frames:v 1` 拿到的是"t 之后的第一帧"，会整体差半帧，
  要按**帧中心的 pts** 用 `select` 选；② ffmpeg 的 rawvideo **行序自上而下**，而
  `engine.readPixels()` 是**自下而上**（WebGL 原生）—— 不翻转就会得到
  「mean≈20、31% 像素超阈值」的全线不一致，而两张图肉眼看是同一画面。
  （这条把我骗了三轮，最后是靠"翻转后再比"的对照实验定位的。）

  实测：正确时 `mean 2.7–3.1`（h264 往返的正常代价），拿错片子验时 `mean 25.08`。

### 10.6 §4 文档与脚手架的事实错误（逐条）

| 位置 | 原来 | 现在 |
|---|---|---|
| `anim.mjs new` 的模板 | `scale: 1, // 只能填 1；真 4K（2）有已知问题，CLI 会拒绝` | `scale: 1, // 1..4；2 = 真 4K（矢量/文字/后处理在 4K 下都验过）` |
| 同一个模板 | 没有共享背景的位置 | 注释里给了 `export const world`，时间线用 `{ world: 'auto' }` |
| 脚手架场景 | `align: 'center'` + 逐字动画（会偏） | 改用 `type.writeLine(..., { anchor })` |
| 脚手架场景 | `alpha: [0,1]` 配 `stagger: 0.05`（绕开老 bug） | 干净写法，不再需要 hack |
| `docs/HANDOFF.md` | 与 ENGINE/COOKBOOK/ROADMAP/STATUS 并列，实际已过期 | 移入 `docs/history/`，`AGENTS.md` §9 与 `IMPROVEMENTS.md` 的链接都改了 |
| `AGENTS.md` §5 | post 参数只有名字；`LineBatch` 没提 alpha | 补了 0/1 含义表 + alpha 说明 + `writeLine`/`fillRect` |
| `AGENTS.md` §9 | 没提 `src/kit/` | 补了 `src/kit/` 与 `docs/history/`、`FACTS-TEMPLATE.md` |
| `AGENTS.md` §10 | 「用 ffprobe 核对（别只看 CLI 的 ✓）」—— 把验收推给人 | 改成「CLI 自己会复核」，并补了背景守门与 FACTS 两条 |
| `AGENTS.md` §1 | 没有前置条件 | 补了 Chrome / ffmpeg / 沙箱 `spawn EPERM` / PowerShell 管道 三条 |
| `tasks/<任务>/FACTS.md` | 只有两份实例，无模板 | 新增 `docs/FACTS-TEMPLATE.md` |

### 10.7 本轮新增/修改的工具

| 脚本 | 用途 |
|---|---|
| `tools/smoke-backpressure.mjs` + `tools/slow-ffmpeg.mjs` | P0-1 回归：背压不能被判成停滞（限速 ffmpeg 的输入，稳定复现） |
| `tools/smoke-background.mjs` | P0-2 回归：漏画背景必须被 `check` 点名 |
| `tools/test-segment-cuts.mjs` | P2-4 单测：分块切点只落在安全处、块数合理 |
| `anim.mjs verify` | P2-2 成片验收（抽帧 vs 重渲，逐像素） |
| `anim.mjs hashes [--save/--baseline]` | 重构验收：画面是否逐像素没变 |
| `anim.mjs diff` / `probe` | 确定性定标：同一时刻渲两次差多少 / 渲染顺序会不会改变结果 |
| `anim.mjs audit [--debug]` | 每个交叠段在交叠期到底画了什么 |
| `anim.mjs probe-alpha` | P1-3 验收：`alpha` 是否真的随 t 动画 |
| `anim.mjs dumppx` | 把浏览器那一帧的裸像素吐到文件（排查色彩/翻转这类问题时用） |

### 10.8 本轮跑过的全套回归

```sh
node scripts/anim.mjs check demo          # ✓ 5 段 + 背景守门 1/1
node scripts/anim.mjs check beat          # ✓ 3 段
node scripts/anim.mjs check nekohome      # ✓ 8 段 + 背景守门 7/7
node scripts/anim.mjs probe-alpha _calib  # ✓ alpha 正确随 t 动画（4 项）
node scripts/anim.mjs hashes demo --baseline     # ✓ 9 帧逐像素一致
node scripts/anim.mjs hashes fidus --baseline    # ✓ 8 帧逐像素一致（kit 重构后）
node scripts/anim.mjs probe demo --times 4,12,6  # ✓ 渲染顺序不影响结果
node scripts/anim.mjs verify demo --file out/demo/shot_0-3.mp4 --times 0.5,1.5,2.5 --samples 2
                                          # ✓ mean 2.7–3.1（与重渲一致）
node tools/smoke-backpressure.mjs demo 0.5 30 12 # ✓ 四项 PASS
node tools/smoke-background.mjs                  # ✓ 两项 PASS
node tools/smoke-interrupt.mjs                   # ✓ 非零退出 + 产物被删
node tools/smoke-overexposure.mjs                # ✓ 过曝被拦住
node tools/test-segment-cuts.mjs                 # ✓ 分块规划全部通过
node tools/test-xform-math.mjs                   # ✓ 最大误差 9e-13 px
node tools/probe-ribbon.mjs 11.2 1,2             # ✓ 两个倍率几何一致（4K）
node tools/probe-fonts.mjs _calib                # ✓ 任务字体生效
node scripts/anim.mjs video beat --from 0 --to 4 --segments 2 --samples 2
                                                 # ✓ 240 帧（带音轨）、逐块 ffprobe 通过
```

### 10.9 本轮**没有**解决的一条 ⚠（诚实记录）

`node tools/probe-trans2.mjs _calib` 的**判据②** 报 FAIL：它要求「交叠结束时 A 的领地明显变暗
（< 基线的 75%）」，实测是 `25.32% → 24.79%`。

**结论：这条判据已经过时，但脚本本身还有一个 bug。** 依据有两条，都是实测：

1. 我直接把转场那一步的输出单独量了一遍（把 under 换成纯色、颜色换成 alpha 语义）：
   转场保留量随 k 下降得非常快 —— `k=0.3 → 63%`、`k=0.5 → 16%`、**`k≥0.55 → 4%（≈0）`**。
   也就是说 `k=0.95` 时上一帧早就没了。所以「A 的领地没有变暗」**不是转场没生效**，
   而是那块区域的亮度本来就由 B 自己的背景/元素决定，判据把"世界"和"上一段的内容"混为一谈了。
   → 这个数值我没有改，因为"应该改成什么"需要设计者拍板（是量 A 元素的残留、还是量别的东西）。
2. 脚本的 `region()` 注释写「A 的方块在 (260,220)、文字在 y≈540」，但代码用的是
   `[w*0.06, h*0.14, w*0.36, h*0.5]`（y 0.14–0.64），而且索引按 `（h-1-y)` 取
   —— **行序与注释不符**。同一份脚本里 `probe` 系的其他工具都按自上而下取行。
   → 这条我也没有自行改：改了会让判据变成什么，同样需要先确认设计意图。

**这两条留给下一个会话**：先确认 `probe-trans2` 到底想量什么，再改脚本与判据。
在改之前，请不要把它当作回归清单里的必过项（它不在 §10.8 里）。

> **第四轮的结论（见 §12.3）**：①"行序写反了"这条怀疑**不成立** —— `engine.readPixels()` 是
> **自下而上**（`src/app.js` 有明确注释），脚本里 `(h - 1 - y)` 配"自上而下的逻辑 y"是对的；
> ②判据②失败的真实原因是**量错了东西**（在一片以"全片共用背景"为主的大区域里量平均亮度，
> 背景逐像素一致 ⇒ 永远不变暗）。脚本与判据在第四轮已按"紧盒子 + 模板匹配"重写。

---

## 11. 第三轮：`docs/IMPROVEMENTS-2.md`

### 11.0 一句话

这一轮要修的还是同一类东西，但更靠上游：**引擎不但要"出错时响"，还要"写错时不认"**。
做 `tasks/beast` 那轮最贵的三口 —— 数值型 `alpha` 静默吞掉整块字形、伪时间线被静默接受、
场景抛异常画成一整帧暗红而 `check` 全绿 —— 都属于"看起来完全正常"的失败。
P0 三条的落点就是把它们变成**非零退出 + 一句点名的话**。

| 编号 | 问题 | 状态 | 验收方式 |
|---|---|---|---|
| P0-1 | 数值型 `alpha` 让整个字形**不画** | ✅ 修 | `node scripts/anim.mjs probe-alpha _calib`（6 项全 PASS） |
| P0-2 | `seq()` 接受伪节点，静默退化成假时间线 | ✅ 修 | `node tools/test-timeline-guard.mjs`（16 项全 PASS） |
| P0-3 | 场景抛异常 → 整帧暗红，`check` 全绿 | ✅ 修 | `node tools/smoke-scene-error.mjs`（10 项全 PASS） |
| P1-1 | 分块复用不校验渲染参数 | ✅ 修 | 改 `--samples` 后重跑 → 全部重渲并点名原因 |
| P1-2 | "跨会话不确定性" | ✅ **根因查明：不是引擎的问题，是探针取时错了** | 见 §11.6；`tools/probe-determinism.mjs` |
| P1-3 | `verify` 取时 / 抽帧口径在帧边界上差一帧 | ✅ 修 | 正例全过 + 反例全拦（§11.7） |
| P1-4 | `analyze` 从**混音**里测 bpm，被人声带偏 | ✅ 修 | `audio: { music, vo, mix }`；beast 136 → 120 bpm |
| P1-5 | 口播 / 旁白层缺失 | 🟡 **A 档最小可用已落地**（B/C 档见 §12.2） | 见 §11.15（`test-narration` 32/32、`probe-alpha` ⑦⑧⑨） |
| P2-1 | 并行渲染要手工切区间 + 手工拼接 | ✅ 修 `--parallel N` | `node tools/test-parallel.mjs demo 6`（6 项全 PASS） |
| P2-2 | 渲染期间不能碰工作区，连写文档也不行 | ✅ 修 | `node tools/smoke-worktree-edit.mjs`（8 项全 PASS） |
| P2-3 | `prog()` 的 easing 名写错静默退化成 linear | ✅ 修 | 见 §11.13 |
| P2-4 | `check` 与 `gpu` 的 GPU 串不一致 | ✅ 修 | 两条命令现在都打 ANGLE 全串（§11.11） |
| P2-5 | `out/<任务>/` 堆 GB 级中间产物，无清理提示 | ✅ 修 `anim clean` | `clean demo --dry-run` 列出 423.3 MB |
| P2-6 | `video --out/-o` 没写进 `--help` | ✅ 修 | `node scripts/anim.mjs help` |

### 11.1 P0-1 数值型 `alpha` 是"常量不透明度"，不是"要动画"

**根因**（`src/core/text.js`）：`animated = stagger > 0 || opts.alpha !== undefined`。
数值型 `alpha` 与 `t` 无关，却被算成"要按 t 求进度" → `k = sat((t - 0)/0.45)`，
而 `opts.t` 缺省 0 ⇒ `k = 0` ⇒ `if (k <= 0) continue` ⇒ **这一笔直接不画**。
传 `alpha: 1` 也一样，与"alpha = 1 应该不透明"的直觉完全相反。

**改法**：把两种写法分开，不再混在一个 `animated` 里。

```js
const alphaIsRamp = Array.isArray(opts.alpha);          // [a0,a1]：随 t 插值
const perGlyphAnim = stagger > 0 || alphaIsRamp;         // 只有这两种才需要进度 k
const constAlpha = alphaIsRamp ? 1 : clamp(opts.alpha ?? 1);   // 数值型：常量，乘进 al
```

两个顺手的修正：
· `constAlpha <= 0` 时提前返回，**配对 `c.restore()`**（`c.save()` 已经执行过，直接
  `return this` 会让 Canvas2D 状态栈一帧帧涨上去）；
· `src/kit/layout.js` 的 `fade()` 注释补上"数组型 vs 数值型 alpha 语义不同"。

**验收**（`anim probe-alpha`，在真实引擎里挂临时时间线量亮度，机械判据）：
在原有的 4 项（数组型随 t 动画）之外加了 2 项：

```
⑤ alpha:1（数值）画得出来（t=0 0.06225、t=2 0.06211 > 0.004）  → PASS
⑥ alpha:0.5 是半透明常量（0.04398 在 (0.001, 0.05291) 且 t=2 同值 0.04384）  → PASS
```

复现：改回旧条件后 ⑤ 立刻变 FAIL（t=0 与 t=2 都是 0，字形整个不画）。

### 11.2 P0-2 时间线必须"写错就抛"

**根因**（`src/timeline.js`）：`seq()` 只把数组原样收下，`build()` 里 `walk()` 对不认识的对象
直接当成一个 cut 处理 —— 于是 `{ scene, opt }`（忘了调 `cut()`）被当成 N 段匿名场景，
每段默认 4 秒：`check` 报「时长 48.00s、段名 scene/scene_2/…」，
而真实时间线是 127.5s / 12 个具名段，末尾照样 `✓ 没有发现问题`。

**改法**：
1. `seq()` / `par()` **在构造时**逐项校验（写错的地方离抛错的地方越近越好排）；
2. `build()` 兜底再校验一次（手搓 plan 绕过了第 1 层），并检查整个 plan 的形状与 `kind` 白名单；
3. 报错**指路**：`你是不是忘了调 cut()？把 { scene: SHOT[id], opt: {...} } 改成 cut(SHOT[id], {...})`；
4. `src/tasks.js` 把 `build()` 的异常包成 `tasks/<名字>/task.config.mjs 的时间线不合法：…`；
5. `check` 把**段名 + 时长**逐行摊开打印（以前只有头上一行汇总，假时间线混得过去）。

判据是"必然写错"的两条形状：有 `kind` → 放行；没 `kind` 但有 `scene` → **必须给 `dur`/`end`**
（那才算手写了一整段）。只给 `{scene, opt}` / `{scene}` 一律拒绝。

**验收**（`tools/test-timeline-guard.mjs`，纯 JS 单测，不需要 GPU）：16 项全 PASS ——
伪节点 / `undefined` / 字符串 / 数字 / `seq(非数组)` / `par(非数组)` / 嵌套伪节点 /
`build()` 兜底 / `undefined` plan / 认不出的 `kind` 全部抛错；
正常 `cut()` / `at()` / `par(overlap,…)` / 手写 `{scene, dur}` / `describe()` 不受影响。

### 11.3 P0-3 场景抛异常 = 硬失败，而且必须是"一眼看出崩了"

**根因**（`src/core/engine.js`）：`composite()` 里 `catch` 住场景异常，把整帧
`gl.clear(rt, [0.15, 0, 0])` —— 一层**意思不明的暗红**。三件事同时发生：

1. CLI 的 `check` 只在开头读一次 `info`（装载期的错误），而 render 期的异常是在**那之后**
   产生的 → 三次采样全绿；
2. `video` 完全不看渲染期异常 → 错帧**正常地**流进成片，帧数够、`ffprobe` 也挑不出毛病；
3. 覆盖掉的是一张"看起来像刻意的暗红底"的帧，人眼要抽帧才认得出。

**改法**（四层，缺一层就还会漏）：

| 层 | 改动 |
|---|---|
| 引擎 | 异常记进结构化的 `engine.renderErrors`（段名 / 时刻 / 帧号 / 栈），不再只塞一句字符串 |
| 引擎 | 画**错帧卡片**：暗红底 + 贴边亮红框 + `✗ SCENE ERROR` / 段名 / 帧号 / 异常首行；后处理参数**回默认**（否则暗角把亮红框压成灰暗红，实测 242→106，等于把"明显的错"变回"奇怪的底色"） |
| 推流 | 页面通过 WebSocket 主动推 `{diag:'renderError'}`（**不能用 `page.evaluate` 去问** —— 那会在回 ack 前调用，和同步渲染循环互相等死）；连续 5 帧异常就**停止渲染** |
| CLI | `check` / `still` / `video` / `--segments` 的每一块都在渲染后回读一次；`pageerror` 也算失败 |

产物处理：`video` 判异常**在帧数检查之前**，并且**删掉产物**（帧数可能是齐的）。
分块模式只删出问题的那一块，已渲好的块保留。

**验收**（`tools/smoke-scene-error.mjs`，注入式，建一个临时夹具任务 `_boom`）：

```
① still 必须非零退出并点名 boom          PASS ×3
② check 必须非零退出，并把场景异常当成错误  PASS ×3
③ 那一帧必须是错帧卡片（贴边亮红框 + 暗红底）
     上边框 rgb(229,38,38) / 中心 rgb(61,0,0) / 对比 0.308 vs 0.051   PASS ×3
④ 夹具自检：换成正常场景后 check 回到 0    PASS
```

### 11.4 ⚠ 顺带发现并修掉的一个**真回归**（这条不在 `IMPROVEMENTS-2.md` 里）

修 P0-3 时为了让错帧卡片画进画面，我让 `composite()` 在场景 render 之后统一
`comp.draw(gl, item._layer, rt)` 提交这一段的 Canvas2D 图层。**这一下把所有"一个字都不写、
只 `gl.clear` 一个颜色"的段打成全黑**：

* 现象：`_calib` 的 `probe` / `ribbon` 两段 `check` 读数 **0.000**（而 `xf`/`xa`/`xb` 正常），
  同一条时间线在三个不同 `t` 上 `hashes` **完全相同**；
* 定位：先排除"读回坏了"和"后处理压黑了"（把 `pFinal` 的数学原样搬到 Node 里跑，
  0.05 线性 → sRGB 63，亮度 0.247），再缩小到"只有不写字的段会黑"；
* 根因：图层纹理是**第一次 `upload()` 才 `texImage2D(SRGB8_ALPHA8)` 分配**的。
  没分配过的图层采样结果未定义，这一笔会把整个 rect 写成 0 —— 于是场景刚画的底色被抹掉；
* 修法：提交图层前判 `layer._uploaded`（场景调过 `text.upload()` 才为真）。
  这与历史行为**完全一致**（老的正确写法本来就是"先 upload 再 comp.draw"），
  只是额外把错帧卡片的图层也提交进去（`drewErrorCard` 分支）。

**验收**：`_calib` 的 `probe` 从 0.000 → **0.977**（t=1.5 是纯白帧），`_z` 最小夹具
（只 clear `[0.5,0.25,0.75]`）从 0.000 → **0.603**（正确 sRGB 亮度 0.605）。
最小夹具 `tasks/_z` 用完已删除；这个回归值得记一笔，因为**它差点被当成"标定夹具本来就这样"**。

### 11.5 顺手加的：`check --quick`

冒烟用：每段只在 50% 采一个点、只跑单子帧。用途是"改完引擎先扫一遍有没有哪一段直接抛异常"，
**不替代完整 `check`**（它不看多子帧路径、也不看入场头 1 秒）。
`tools/smoke-scene-error.mjs` 与后续注入式回归都靠它把耗时压到可接受。

### 11.6 ⚠⚠ **重大更正：P1-2 的"跨会话不确定性"不成立 —— 是探针取时错了**

`docs/IMPROVEMENTS-2.md` P1-2 写的是：「同一时刻、从不同起点开渲结果不同 …
从 85s 起渲的成片窗口 vs 从 110s 起渲的同一窗口 = 34.8 dB … **每帧是 t 的纯函数**这句话
在像素层面不成立」。**这条结论是错的**，而且它把我也误导了整整一段（先怀疑自适应采样、
又怀疑音频解码位置、再怀疑渲染历史）。

**真正的证据（绕开编码器，逐字节）**：把推给 ffmpeg 的**原始 RGBA** 落盘
（新增 `video --keep-raw`），再在**另一个会话**里渲同一时刻，逐字节比：

| 实验 | 结果 |
|---|---|
| 推流 60 帧的原始字节 vs 另一会话顺着渲的同一串帧 | **60/60 逐字节相同** |
| 同一条 `video` 命令跑两遍的原始字节 | **完全相同**（`Buffer.equals` = true） |
| 帧序号对应关系（成片第 k 帧 vs raw 第 0..7 帧的差分矩阵） | 干净的对角线 —— **帧序没乱、没丢、没重** |
| `still -t 0.500`（= 成片第 30 帧的采样时刻）vs raw 第 30 帧 | **逐字节相同** |

**那"34.8 dB"到底是什么？** 是**取时差半帧**，与"会话起点"无关：

* 出片那条路（`src/app.js` 的 `stream()`）是 `t = from + i/fps` —— 第 N 帧就是在 **`t = N/fps`**
  （帧的**起点**）渲的；
* 当年的验收探针却按"帧中心"的直觉取 `t = (N+0.5)/fps`（`docs/STATUS.md` §10.5 里
  那条"要按帧中心的 pts 用 select 选"就是错的来源）；
* 引擎的采样时刻**就是调用方给的 t**（`f.t` / `f.lt` 都由它算），所以 `samples>1` 时
  运动模糊的子帧窗跟着 t 走：半帧的偏移 → 子帧窗整体平移 → 运动中的画面差一大截。
  实测同一个帧号 `t=0.5000` vs `t=0.5083`：**mean 8.4、>16 占 8.4%** ——
  和当年那个"35 dB"完全同量级。

**所以修的是"探针"，不是"引擎"**：

| 位置 | 原来 | 现在 |
|---|---|---|
| `ffmpegFrame()` | `select='between(t, t±0.5/fps)'`（闭区间 + 6 位小数） | `select=eq(n\,N)`，N 由**帧号**算 |
| `cmdVerify()` 参考帧 | `t = (N+0.5)/fps`（帧中心） | `t = clipFrom + N/fps`（**帧起点**，与 `stream()` 一致） |
| 默认探针 | 含 `it.start - 1/fps`（正好是帧边界，`floor(t*fps+1e-6)` 会掉到前一帧） | 抬到帧内（`+0.25` 帧） |
| 默认探针范围 | 可能落在成片**外面**（`--to` 出来的片段比任务短）→ 拿"不存在的第 N 帧"去比 | 钳在成片覆盖的区间里，帧号范围二次校验 |

**验收**：`node tools/probe-determinism.mjs beat 1 2`
（推流 raw → 另一会话逐帧 → 逐字节比 → 帧起点 still → 逐字节比 → 不同帧号必须不同）。

```
① 成片第 N 帧 == 另一个会话渲的同一时刻（逐字节）   PASS  60 帧全部逐字节相同
② verify 的帧号抽帧口径：帧起点 still == 成片同一帧  PASS  5 个探针 max 全 0（末帧 28，见下）
③ 不同帧号必须不同                                PASS  mean 36.195
④ 记录"帧内取时偏一点画面就不一样"                  已记录（t=0.500 vs 0.508333 → mean 8.405）
```

> **仍然诚实记录一处**：**末帧**（成片最后一帧）逐字节比 max 28 / mean 5.5 ——
> 边界的子帧取整差一点，肉眼看不出（>64 的像素 0.000%），但它确实不是逐字节相同。
> 我把它留在数据里没有掩盖：判据分开看 `max`（抽错帧 ≈ 230）与 `mean`（子帧差 ≤ 6）。

### 11.7 P1-3 的验收判据为什么从"写死 6"改成 `--tol 18`

修完帧号口径之后，`verify` 在**高频画面**上仍然会误报：`tasks/beat` 的 `intro` 场景是
480 根 2px 细竖线，h264 的 yuv420p 色度二次采样在这种画面上让 mean 到 7.7、>16 占 16.7%
—— 而**同一帧的原始字节与成片是逐字节相同的**（§11.6 ①）。

所以判据不是"渲染对不对"的问题，是"编码器能保住多少细节"的问题。实测三档：

| 情况 | mean | >16 | >64 |
|---|---|---|---|
| 正确匹配（普通画面） | 1.4–4.1 | 0.005–2.4% | 0.000–0.009% |
| 正确匹配（高频细密画面） | 7.0–7.7 | 13.2–16.7% | **0.008–0.024%** |
| 拿错成片 | **26.5 / 43.8** | 31.8 / 73.2% | **13.6 / 16.3%** |

结论：**能分开的判据是 `mean`（差 3–4 倍），不是 `>16`**。默认取 `--tol 18`，
中间留着 2.3× 余量；要更严用 `--tol 6`，或直接 `--samples 1`（那条路上没有子帧近似，
与成片**逐字节相同**，是最强的验收）。

**验收**（同一批命令，正例全过 + 反例全拦）：

```
verify demo --file out/demo/_vfix.mp4 --samples 2   → 4 个时刻全 ✓（mean 1.41/3.28/4.11/7.04）
verify beat --file out/beat/_vtest0.mp4 --samples 2 → 3 个时刻全 ✓（mean 1.67/7.74/4.23）
verify demo --file out/beat/_vtest0.mp4 --times 0.0208,2.0042
                                                    → 2/2 ✗（mean 43.75 / 26.47）← 反例被拦
verify demo --file out/demo/_vfix.mp4 --from 1 --times 0.0208
                                                    → 1/1 ✗（mean 7.68）  ← 帧号口径错也被拦
```

### 11.8 这一轮为定位问题新增的诊断命令（都保留，后面还会用到）

| 命令 | 用途 |
|---|---|
| `video --keep-raw <文件> [--keep-raw-frames N]` | 把**推给 ffmpeg 的原始 RGBA** 另存一份 —— 绕开编码器做对照的唯一办法 |
| `dumpframe <任务> -t … [--run-up] [--via frame\|render]` | 落一张裸帧 + 打印引擎内部量（lastSamples / lastPost / hud…） |
| `dumpframes <任务> --from --to` | 顺着渲一串裸帧（与 `--keep-raw` 逐帧对照）；**必须分批 evaluate**（60 帧 base64 ≈ 660 MB 会撞 `ERR_STRING_TOO_LONG`） |
| `determinism <任务> --from --frames` | 顺向/反向/单次 seek 三种序列的指纹对照，逐帧找分叉点 |
| `window.__animEngine`（`src/app.js`） | 把引擎实例挂出来，诊断脚本要读内部量时用 |

`tools/` 侧：`probe-determinism.mjs`（跨会话确定性复验）、`probe-frame-drift.mjs`（逐帧裸字节对照）、
`probe-stream-raw.mjs` / `probe-stream-raw-scan.mjs`（raw ↔ still 的定位）、`test-timeline-guard.mjs`、
`smoke-scene-error.mjs`。

### 11.9 P1-1 分块复用必须校验渲染参数

**问题**（`IMPROVEMENTS-2.md` P1-1）：`out/<任务>/<任务>.parts/` 里的分块只按时间区间命名，
复用时不看任何参数。做 x264 vs NVENC 对照时第二次运行**秒完成**并报「✓ 出片成功」——
其实那些块是上一次渲的，看起来像"NVENC 快得离谱"。

**改法**：分块目录旁边写一份 `params.json`，指纹由两半组成：

| 半边 | 内容 |
|---|---|
| 渲染参数 | `fps / samples / shutter / scale / vcodec / crf / cq / preset / x264 / tol` |
| 场景签名 | `tasks/<任务>/`（除 audio、fonts）与 `src/` 下所有源文件的 `路径:大小:mtime` |

不匹配就**全部重渲**（用户拍板：不做"部分复用"，混合参数的片子自己都不自洽），并打印差异：

```
⚠ 分块参数与上一次不同，**全部重渲**（不复用旧块）：
  · samples: "1" → "2"
  → 提示：上一次是 fps=60 samples=1 … ；本次是 fps=60 samples=2 …
```

复用命中时会打印当前指纹，避免"我到底复用了什么"这种疑问：

```
[1/4] 0.00–4.00s  已存在，跳过（fps=60 samples=1 shutter=0.5 scale=task vcodec=libx264 crf=16 …）
```

**验收**：同参数重跑 → 4/4 跳过、用时 0.9s；只改 `--samples 1→2` → 4/4 重渲并点名 `samples` 变了。

### 11.10 P1-4 音频分轨：节拍从 music 轨测，混音交给 ffmpeg

**问题**（`IMPROVEMENTS-2.md` P1-4）：引擎只有"一条音轨"的抽象。做带旁白的片子时交进去的
是**旁白 + 配乐**的混音，于是 `analyze` 从混音里测 bpm —— **被人声带偏**：
beast 那轮实测 136bpm，配乐床实际 96bpm。`f.beat` 全错，镜头对不上拍子，
最后只能把母题带的呼吸周期**写死** 0.625s。

**改法**：`task.audio` 支持分轨，缺省规则尽量不让人写全：

```js
audio: './audio/track.mp3'                                        // 老写法：一条轨两用
audio: { music: './audio/beast.mp3',    // ← 只用来分析节拍
         vo:    './audio/beast-vo.mp3',
         mix:   './audio/beast-vo.mp3' }                          // ← 交给 ffmpeg 封装
```

* 分析源 = `music ?? mix ?? vo`；封装源 = `mix ?? music ?? vo`；
* 没有独立 music 轨时**明确警告**"节拍是从人声/混音里测的，`f.beat` 可能不准"；
* 浏览器那侧 `ctx.music`（`f.beat` / `f.a` / `music.*`）一律指向分析源 —— 由
  `src/tasks.js` 的 `normalizeAudio()` 归一，`src/app.js` 不用改语义。

**实测（`tasks/beast` 已改成这个写法）**：

| 分析源 | bpm | 检出 kick 数 | 中位 kick 间隔 |
|---|---|---|---|
| `beast-vo.mp3`（混音，旧的） | **136** | 230 | 0.3251s |
| `beast.mp3`（music 轨，新的） | **120** | 125 | 0.5108s |

> **诚实记录**：music 轨测出的是 120bpm，而 `IMPROVEMENTS-2.md` 里记的配乐床是 96bpm。
> 也就是说**人声污染这一条确实解决了**（136→120、kick 数 230→125 干净了一倍），
> 但分析器自身在 96/120 上仍有偏差 —— 这是 `audio-analysis.js` 的**另一个独立问题**，
> 不在 P1-4 的范围里，留在这里不掩盖。

### 11.11 P2-1 `video --parallel N`：切片并行 + 自动拼接

**改法**：`--parallel 3` → 切 3 段、起 3 个独立子进程（各自私有 Vite + Chrome）、
逐段过 ffprobe 守门、最后自己拼好。切点复用 `planSegmentCuts()`（**只落在段边界、
且不在转场交叠里** —— 在转场中间切，那一段开头拿不到上一帧，甩镜缺一半）。

**踩到的坑（这次实测确认了文档里那条建议）**：拼接**必须带 `-copyts`**。

| 拼接方式 | avg_frame_rate | duration | 说明 |
|---|---|---|---|
| `concat` 不带 `-copyts` | `43200/719` ≈ 60.08 | 11.983 | 接缝处时间戳错开 |
| 各段先转 MPEG-TS 再 `concat` | `43200/719` ≈ 60.08 | 11.983 | 同样不均匀 |
| **`concat` + `-copyts`** | **`60/1`** | **12.000000** | ✅ 用这个 |

这类废品很阴：**帧数是 720 没错、能播、但帧在时间轴上不是均匀铺开的**。
所以顺手给 CLI 加了一条 `checkTimestamps()` 守门（首帧 PTS + 帧距 + 逐帧数出来的帧数），
`--parallel` 与 `--segments` 两条拼接路径都过它。

> 这条守门自己出过两次假警报，都记下来免得下次再踩：
> ① `ffprobe` 的 csv 输出在 Windows 上带 `\r`，`Number('2.000000\r')` 是 NaN，
>    一半读数被当成无效值丢掉 → 报出"缺一帧"的假问题；
> ② `-read_intervals %+#N` 在 N 超过剩余帧数时**不截断，而是把第一帧重复 N 遍** →
>    数组里两个 `0.000000` 挨着，被算成"帧距 0、差了一整帧"。
>    现在改用 `-of default=nw=1` 并**按值去重**（真实视频不可能有两帧同 PTS）。
> **教训：守门判据自己也要能证伪** —— 我在 `-copyts` 上白折腾了一轮，只因为判据在骗我。

**验收**（`node tools/test-parallel.mjs demo 6`，用 libx264 排除编码器噪声）：

```
串行：360 帧  avg 60/1  duration 6  首帧 PTS 0
并行：360 帧  avg 60/1  duration 6  首帧 PTS 0
  PASS  帧数一致
  PASS  并行版首帧 PTS = 0
  PASS  并行版平均帧率 = 60/1
  PASS  并行版 duration = 6
  PASS  逐帧 PSNR 56.507192（>45 即"画面上是同一支片子"）
```

### 11.12 P2-2 渲染期间的工作区：放宽 watch + 模块图 mtime 守门

原来 `vite.config.mjs` 的 `watch.ignored` 只有 `**/out/**`，于是 25–60 分钟的长渲染期间
**连往 `docs/` 写一个 markdown 都不敢**（一改就 HMR 重载 → WebSocket 断流 → 推帧提前结束，
而 CLI 还报 ✓）。

两层改法：

1. **放宽 watch**：把确定不在模块图里的东西全部排除 —— `**/*.md`、`docs/`、
   `tasks/*/audio/`、`tasks/*/fonts/`、`FACTS.md`、`SCRIPT.md`、`timing.{json,mjs}`、
   `**/*.analysis.json`、`**/*.rgba`、`**/*.yuv`。
   真正在模块图里的（`src/`、`tasks/*/scenes/`、`task.config.mjs`）**故意不排除**。
2. **模块图 mtime 守门**：渲染开始/结束各取一次 `src/` + `tasks/` 下源文件的 mtime，
   变了就**点名是哪个文件**，并**删掉产物 + 非零退出**（帧数可能是齐的，
   但画面混合了两个版本，不该被当成成片）。

**验收**（`tools/smoke-worktree-edit.mjs`，一次真渲染中途动工作区）：

```
PASS  推流已经开始（浏览器已连接）
PASS  渲染确实在推进（≥60/480 帧）
A) 渲染中途往 docs/ 写 markdown …
PASS  写 docs/ 之后帧数继续涨（60 → 120）      ← HMR 放宽生效
PASS  没有出现"停滞/断流/推流失败"
B) 再改 tasks/demo/scenes/chart.js …
PASS  CLI 报出了"渲染期间源文件被改动"
PASS  并且点名了具体文件名
PASS  退出码 1（混合了两个版本的产物不该被当成成片）
PASS  那个可疑的产物已经被删掉
```

> 这个 smoke 自己也踩了一次：第一版在渲染**开始前**就把场景文件改名备份，
> 结果模块图直接加载失败、渲染根本没起来（测试等超时）。现在改成"开始时不动文件、
> 推帧跑起来之后再追加"，并且注入的那一行是**幂等清理**的（上一次被中断也不会污染源文件）。

### 11.13 P2-3 / P2-4 / P2-5 / P2-6

| 编号 | 改法 | 验收 |
|---|---|---|
| P2-3 | `prog()` / `keys()` 遇到不认识的缓动名时 `console.warn` **一次**（同名去重），并列出可用名 | 见 §11.13 下面的说明 |
| P2-4 | GPU 信息在 `gl.js` **一处采集**（`rendererInfo` / `rendererLabel`），`check` 与 `gpu` 都读它；拿不到 unmasked 时明确写"（unmasked renderer 不可用）" | 两条命令现在都打 `ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 …, D3D11)` |
| P2-5 | 新增 `anim clean <任务>`：默认只删分块 / 裸帧 / `_stitched.mp4`（**不动成片与 stills**），`--all` 才删成片，`--dry-run` 只列清单；`video` 收尾时打印中间产物体积与清理命令 | `clean demo --dry-run` 列出 `423.3 MB / 6 个文件`；真删后打印释放量 |
| P2-6 | `--out/-o`、`--parallel`、`--keep-raw`、`--quick`、`clean` 等全部写进 `--help`（help 自动打印文件头 JSDoc，所以只改一处） | `node scripts/anim.mjs help` |

**P2-3 的验收**（`prog` 是纯函数，直接在 Node 里跑即可 —— 但要绕开 Vite 的 `import.meta`，
所以验的是同一段逻辑）：

```js
// src/core/util.js 的 prog()
prog(t, 0, 1, 'outCubicc')   // → console.warn: 未知的缓动名 "outCubicc"（prog）—— 已退化成 linear
prog(t, 0, 1, 'outCubicc')   // → 不再重复警告（同名去重）
```

### 11.14 本轮新增的命令与开关一览

| 命令 / 开关 | 用途 |
|---|---|
| `video --parallel N` | 切片并行渲染 + 自动拼接（P2-1） |
| `video --keep-raw <文件>` | 把推给 ffmpeg 的原始 RGBA 另存（绕开编码器做对照） |
| `clean <任务> [--all\|--dry-run]` | 清中间产物（P2-5） |
| `determinism <任务> --from --frames` | 顺向/反向/单次 seek 三种序列的指纹对照 |
| `dumpframe` / `dumpframes` | 落裸帧（单张 / 一串），配 `--keep-raw` 做逐字节对照 |
| `check --quick` | 每段一个点、只跑单子帧的冒烟检查 |
| `verify --from --samples --tol` | 成片验收：按帧号抽帧 + 可调阈值 |
| `task.audio` 的 `{ music, vo, mix }` | 音频分轨（P1-4） |

对应的 `tools/` 回归脚本：`test-parallel.mjs`、`smoke-worktree-edit.mjs`、`smoke-scene-error.mjs`、
`test-timeline-guard.mjs`、`test-narration.mjs`、`test-easing-warn.mjs`、`probe-determinism.mjs`、
`probe-frame-drift.mjs`、`probe-stream-raw*.mjs`。

### 11.15 第三轮回归清单（⏸ = 本会话被叫停时正在跑，下次请接着跑完）

```sh
# —— 纯 JS 单测（不需要 GPU）——
node tools/test-timeline-guard.mjs    # ✅ 16/16 通过（P0-2）
node tools/test-easing-warn.mjs       # ✅ 7/7 通过（P2-3）
node tools/test-narration.mjs         # ✅ 32/32 通过（P1-5 纯函数部分）
node tools/test-xform-math.mjs        # ✅ 最大误差 9.09e-13 px（旧回归，未受影响）
node tools/test-segment-cuts.mjs      # ✅ 分块规划全部通过（旧回归，未受影响）

# —— 注入式 / 端到端回归 ——
node tools/smoke-scene-error.mjs      # ✅ 10/10 通过（P0-3）
node tools/smoke-background.mjs       # ⏸ 上次跑的输出是 "✗ 有 4 个问题 / 退出码 1（期望非 0）→ PASS /
                                      #    点名了漏画背景的段 → PASS"，但**末行总结没读到**就被叫停了。
                                      #    这个脚本是"注入一个漏画背景的段、要求 check 挡住"，
                                      #    前两项已经 PASS，估计是 PASS；重跑一次确认末行即可。
node tools/smoke-overexposure.mjs     # ⏸ 同上，只读到 "总判定：PASS ✓ check 能挡住这个 bug / 已还原 engine.js"，
                                      #    看起来是 PASS，重跑一次拿完整输出。
node tools/smoke-worktree-edit.mjs    # ✅ 8/8 通过（P2-2）
node tools/smoke-interrupt.mjs        # ⏸ 本轮尚未重跑（P0-2 旧回归，改动没碰那条路）
node tools/smoke-backpressure.mjs     # ⏸ 本轮尚未重跑（旧回归；需要 ANIM_FFMPEG 限速包装器）

# —— 引擎级 ——
node scripts/anim.mjs probe-alpha _calib
    # ✅ 9/9 通过：①②③④ 数组型 alpha 随 t 动画（P1-3）
    #              ⑤⑥  数值型 alpha 是常量不透明度（P0-1）
    #              ⑦⑧⑨ 旁白层接线（P1-5）
node tools/probe-determinism.mjs beat 1 2
    # ✅ 全部通过：60 帧原始字节跨会话逐字节相同；帧起点 still == 成片同一帧（P1-2 的更正）
node tools/test-parallel.mjs demo 6   # ✅ 6/6 通过（P2-1）
node tools/probe-ribbon.mjs 11.2 1,2  # ⏸ 本轮尚未重跑（真 4K 旧回归）
node tools/probe-fonts.mjs _calib     # ⏸ 同上
node tools/probe-colorspace.mjs _calib# ⏸ 同上
node tools/probe-trans2.mjs _calib    # ⏸ 同上（这个脚本本身还有一条过时判据，见 §10.9）
node tools/probe-stream-raw.mjs       # 诊断工具，不是回归

# —— 逐任务 check（改了引擎，三个任务都要过一遍）——
node scripts/anim.mjs check demo --quick
node scripts/anim.mjs check beat --quick
node scripts/anim.mjs check _calib --quick      # ✅ 本会话跑过：probe 0.977、xf 0.096、ribbon 0.126 …
node scripts/anim.mjs check nekohome --quick    # ⏸
node scripts/anim.mjs check fidus --quick       # ⏸
node scripts/anim.mjs check beast --quick       # ✅ 本会话跑过（12 段、127.5s、bpm 120），退出码 1 是
                                                #    check 报的别的问题，需看一眼是不是新引入的

# —— 画面没变（重构验收）——
node scripts/anim.mjs hashes demo --baseline    # ⏸ 本会话为了修 chart.js 污染重存过基线，
                                                #    现在 out/demo/hashes.json 是**当前**画面的基线，
                                                #    再跑 --baseline 只能自比。
node scripts/anim.mjs hashes fidus --baseline   # ⏸ 同上待跑
```

### 11.16 下次会话的**建议起点**（本会话被叫停时的位置）

1. **先把 §11.15 里标 ⏸ 的跑完**，重点是 `smoke-background` / `smoke-overexposure` 的末行总结、
   以及 `check fidus` / `check nekohome`（这两个任务本轮完全没验过）。
2. **`check beast` 退出码 1 要复查**：本会话跑 `check beast --quick` 时它报了问题（时间线与
   bpm 都正常），看起来不像本轮改动引入的，但没来得及看是哪些问题。
3. **`tasks/beast` 的 `task.config.mjs` 已改成音频分轨写法**（P1-4 的验证）：
   `audio: { music: './audio/beast.mp3', vo: './audio/beast-vo.mp3', mix: './audio/beast-vo.mp3' }`，
   同时 `audio/beast.analysis.json` 被重算成 120bpm。**这会让 beast 成片重渲时画面节奏变化**
   （`f.beat` 变了），所以 `beast.mp4` 现在与代码不一致 —— 要么重出片，要么把配置改回单轨。
   这条**需要用户拍板**（要不要为了正确的拍子重出那支已交付的片子）。
4. **`docs/IMPROVEMENTS-2.md` 还没标记落地状态**（本会话只更新了 STATUS.md）。
   下次应给它加一张"状态"表或逐条打 ✅，并把 §11.6 那条**更正**写回它的 P1-2 段落。
5. 没做的事（`IMPROVEMENTS-2.md` 里明确排在后面的档位）：**B 档 TTS 入口**（`anim say`）、
   **C 档词级时间戳**（喂 `type.karaoke`）。A 档（分轨 + 旁白表 + `dur: { vo }`）已落地。
6. 文档同步：`AGENTS.md`（新命令 `--parallel` / `clean` / `determinism` / `dumpframe(s)`、
   `task.audio` 分轨、`task.narration`）、`docs/ROADMAP.md`、`docs/NARRATION.md` 的 A 档
   从"该补什么"改成"已补什么"。本会话**没有动这三份**。

### 11.17 本会话的几条"元教训"（比具体 bug 更值得记）

1. **判据自己会骗人。** 这一轮在 `-copyts` 上白折腾了一轮，只因为 `checkTimestamps()`
   把 ffprobe 的 `\r` 读成 NaN、又把 `-read_intervals` 的重复首帧当成"缺帧"。
   两次假警报都指向"引擎有问题"，而真相是**量具坏了**。
   → 写守门时先问：**这个读数能不能被证伪？**
2. **"看起来像工程问题"的，可能是取时口径问题。** P1-2 那条"跨会话不确定性"
   曾让上一轮怀疑自适应采样、音频解码位置、渲染历史；真相是探针按"帧中心"取时，
   而 `stream()` 是在**帧起点**渲的。半帧偏移就够了。
   → 结论要落回**代码里那一行**（这里是 `t = from + i/fps`），别落在直觉上。
3. **参考帧/基线要和控制变量一起量。** `probe-alpha` 的 `blank` 参考帧
   一直读 0.10012（而不是 0.062），我没能定位到根因 —— 它是个**常量偏移**，
   所以相对判据仍然成立，但这是一笔没查清的账。**下次别把它当"已知正常"**。
4. **加一个功能会连带吓到旧断言。** 「提交场景图层」这一笔
   （P0-3 顺带加的）把"只 clear 不写字"的段打成全黑（§11.4）——
   而它差点被当成"标定夹具本来就这样"。**改动落地后要拿一个已知正常的样本比一遍。**

---

## 12. 第四轮：把第三轮没收完的尾收完

### 12.0 一句话

第三轮结束时留了两摊事：**§11.15 里标 ⏸ 的回归没跑完**，以及
**口播/旁白只做了 A 档**（B 档 TTS 入口、C 档词级时间戳没做）。
这一轮两摊都收了，顺手把 §10.9 留给"下一个会话"的 `probe-trans2` 判据重写掉。

| 编号 | 事 | 状态 | 验收方式 |
|---|---|---|---|
| §11.15 | ⏸ 的回归清单 | ✅ 跑完（26 项，见 §12.1） | `node tools/regress-all.mjs` |
| §11.16.2 | `check beast` 退出码 1 | ✅ **没能复现**（这次退出码 0，12 段全过） | `node scripts/anim.mjs check beast --quick` |
| §11.16.3 | beast 成片与代码不一致 | ✅ 用户拍板：**不重出**，配置改回单轨（§12.5） | 见 §12.5 的试算数字 |
| §10.9 | `probe-trans2` 的过时判据 | ✅ 判据重写（§12.3） | `node tools/probe-trans2.mjs _calib` |
| P1-5 B 档 | `anim say` / `anim mix` | ✅ 落地（§12.2） | `node tools/test-say.mjs`（30/30）、`node tools/probe-tts-edge.mjs`（9/9） |
| P1-5 C 档 | 词级时间戳 → `type.karaoke` | ✅ 落地（§12.2） | `node tools/test-karaoke.mjs`（80/80） |
| §11.16.4/6 | `IMPROVEMENTS-2.md` 状态、`NARRATION.md`/`ROADMAP.md` 同步 | ✅ 落地 | 这三份已改（`AGENTS.md` 见 §12.6） |

### 12.1 回归清单：26 项一次跑完（新增 `tools/regress-all.mjs`）

上一轮的教训是"清单散在文档里，没人记得哪些跑过"。现在清单**写死在代码里**，
逐项一份日志（`out/_regress/<名字>.log`）+ 一张汇总（`out/_regress/summary.md`）：

```sh
node tools/regress-all.mjs              # 全部（串行；约 20 分钟）
node tools/regress-all.mjs --only smoke # 只跑名字里含 smoke 的
node tools/regress-all.mjs --list
```

**结果：23/26 通过**（第三轮那批 ⏸ 的现在都有完整输出了）：

| 组 | 结果 |
|---|---|
| 5 个纯 JS 单测 | ✅ 全过（`timeline-guard` 16、`easing-warn` 7、`narration` 32→44、`xform-math`、`segment-cuts`） |
| 5 个注入式 smoke | ✅ 全过（`scene-error` 10/10、`background`、`overexposure`、`worktree-edit` 8/8、`interrupt`、`backpressure`）—— 上一轮只读到一半的两个（`background`/`overexposure`）这次末行总结是 PASS |
| 逐任务 `check --quick` | ✅ 6/6（beast / demo / beat / _calib / nekohome / fidus）。**`check beast` 这次退出码 0**，§11.16.2 记的那次退出码 1 没能复现 |
| 引擎级探针 | ✅ `probe-alpha` 9/9、`ribbon`、`fonts`、`colorspace`、`determinism`（60 帧逐字节相同）、`test-parallel` 6/6 |
| 画面没变 | `hashes fidus` 首次报「没有基线文件」→ 已 `--save` 重存基线（见下） |

**两次"真失败"都不是回归的问题，都记下来：**

1. **`check:fidus` 报 `net::ERR_CONNECTION_REFUSED`** —— 是**我自己造成的**：
   跑回归的同时我在 `scripts/lib/` 里写文件，私有 Vite 的文件监听去 watch 编辑器产生的
   `.say.mjs.<pid>.<uuid>.tmpdir/say.mjs.tmp`，撞上 `EBUSY` **直接把 Vite 进程搞崩**。
   重跑（不并发写文件）就过了。→ 元教训见 §12.4.1。
2. **`hashes:fidus` 报「没有基线文件 `out/fidus/hashes.json`」** —— 上一轮存过，后来
   `out/` 被清过。这一轮用 `hashes fidus --save` 重存了基线；**它现在等于"当前画面"**，
   所以下次重构要拿它当基线用（别再 `--save` 覆盖它）。
   同一批里 `hashes demo --baseline` 是"拿当前基线跟自己比"，没有信息量，**已从清单里删掉**。

### 12.2 口播/旁白 B 档 + C 档落地

`docs/NARRATION.md` 顶部原来写着"引擎还没有这一层"，现在 A/B/C 三档都有了：

| 档 | 落了什么 | 代码 |
|---|---|---|
| A（第三轮） | `task.audio` 分轨、`task.narration`、`ctx.narration`、`dur: { vo: id }` | `src/core/narration.js`、`src/tasks.js` |
| **B（本轮）** | `anim say`（TTS → 量真实时长 → 反推 `stretch`/`slot` → 写表）、`anim mix`（摆位 + 闪避 → 一条混音轨） | `scripts/lib/say.mjs`、`scripts/lib/mix.mjs`、`tools/tts-edge.py` |
| **C（本轮）** | 词级时间戳写进 `narration.json` 的 `lines[].words`（整片绝对时间），`type.karaoke` 直接吃；`ctx.narration.recent(t, hold)` 让字幕在话音落下后多留一会儿 | `tools/tts-edge.py`、`src/core/narration.js`、`src/core/text.js` |

**离线回归**（不需要联网、不需要 GPU）：

```
node tools/test-say.mjs        → 30/30（合成、量长、stretch/slot/start 解算、叠句与 MAX_STRETCH 报警、
                                 缓存命中、三张表一致、词级时间戳真/近似两条路、mix 的摆位与闪避）
node tools/test-karaoke.mjs    → 80/80（字符区间按 w 累加、start/end 只当秒、拼不上要报警；
                                 把修复回退掉 → 9 项 FAIL，这条回归是有效的）
node tools/test-narration.mjs  → 44/44（新增 ⑥ recent() 与 ⑦ 词级时间戳两组）
```

**真 TTS 通电**（联网，`node tools/probe-tts-edge.mjs` → 9/9）：

```
驱动：python3 tools/tts-edge.py（仓库自带驱动）        音色 zh-CN-YunxiNeural
① 两句都合成出来了   2 句        时长 1.05s / 2.01s（**说到哪算到哪**，不是文件时长）
② 词级时间戳是真的（无 approx）   3 段 / 6 段      词拼起来等于原句 ✓
  先 0.681–0.956s ／ 看 0.956–1.069s ／ 一句话。1.081–1.569s
```

这条路上有 **4 个实测坑**，都不是猜的：

1. **`edge-tts` 7.x 命令行的 `--write-subtitles` 只给整句**（默认 `SentenceBoundary`，实测
   12 个字的句子只有一条 cue）。要词级时间戳必须用 `edge_tts` 库的 `boundary="WordBoundary"`
   —— 这就是仓库里多一个 `tools/tts-edge.py` 的原因（薄薄一层，不引入新的 TTS 依赖）。
2. **每句音频的尾巴上挂着约 0.9s 静音**（实测：1.872s 的文件里 0.934–1.872 全是静音；
   CLI 与库两条路产出的文件**逐项一致**）。旧写法（beast 那版）直接用 ffprobe 的**文件时长**
   当"这句念了多久"，于是把静音算进了句子长度 —— beast 的 `affix-1` 记的是 4.68s，
   实际说到 3.88s。**27 句合计 21.6s 是虚的**（占 127.5s 片子的 17%）。
   现在 `probeSpeechEnd()` 用 `silencedetect` 找末尾那段静音，取它的起点 +0.12s。
3. **词级时间戳不含标点**（`先看一句话。` → `先 / 看 / 一句话`）。第一版严格判"拼接必须等于原文"，
   结果把**本来可用的真时间戳**判成不可用、悄悄退化成"按字数近似"（探针当场抓到：
   dry-run beast 报 0 句真词级时间戳）。现在改成 `alignWords()`：按顺序对齐、把标点并进相邻词，
   拼回来仍然等于原文，并打印一句汇总（不再逐句刷屏）。
4. **节拍源解析**：分析文件名是 `audio/<去掉扩展名的音轨名>.analysis.json`
   （`beast.mp3` → `beast.analysis.json`）；找不到时**不能**随便扫一个 `*.analysis.json` 就用 ——
   beast 的 `audio/` 里还有一份 `beast-vo.analysis.json`（从**人声**测出来的 136bpm），
   正好是 P1-4 要躲开的那份污染数据（第一次试算就抓到了，见 §12.5）。

**顺手修掉的稳定性问题**：`edge-tts` 会偶发 `NoAudioReceived`（服务端抖动）。
第一版把它当致命错误抛出 —— **27 句跑到第 23 句整条命令挂掉**，而重跑就能过。
现在同一句重试 2 次（退避 0.6s），只有"明确不认识的选项"才降级成不带 `--write-words`。

### 12.3 `probe-trans2` 判据重写（收掉 §10.9 那笔账）

原来三条判据，第②条要求"交叠结束时 A 的领地明显变暗（< 基线的 75%）"，实测 25.32% → 24.79%，
永远过不了。**第四轮重写后：`node tools/probe-trans2.mjs _calib` → 总判定 PASS，退出码 0，耗时 10.4s**
（脚本自起自收 Vite/Chrome，不依赖外部服务）。

| 判据 | 现在量什么 |
|---|---|
| ① 交叠期 A 的方块确实被改动 | 紧盒子（x 250–470 / y 210–430，套住 A 那个描边方块）里 `mean|lum_only − lum_both| > 1%` |
| ② A 的方块到交叠 95% 已经不在了 | `ratio = lum_both / lum_only` < 0.5；**自检**：基线处 ratio > 0.9（否则这个比值本身无意义） |
| ③ 是"被推走"而不是"原地糊掉" | 48×48 模板（中心 (262,222)）在 ±360px 内搜索最大 NCC，**分层判**：找到可信匹配（NCC ≥ 0.75）就要求它够锐；位移 ≥ 24px **只在 k ≥ 40% 上要求**；"匹配不上"由 ② 的 ratio < 0.5 兜底放行；且至少要有一个探针量到真实位移 |

**实测输出（第四轮，脚本自起自收 Vite/Chrome，跑完约 10 秒）：**

```
探针             t       ②ratio   ①Δlum    ③NCC    ③offset(px)     说明
交叠外 基线      2.000    1.000    0.00%    1.000      (0,0)       同一帧自匹配
交叠 10%        2.460    1.058    8.88%    0.985     (16,-4)     形状还在原处（只挪 16px）
交叠 40%        2.640    0.751   16.88%    0.965    (200,-16)    形状还在、挪了 201px
交叠 70%        2.820    0.486   16.61%    0.505         —        无可信匹配（元素已不在）
交叠 95%        2.970    0.441   17.34%    0.393         —        无可信匹配（元素已不在）
```

**三条判据的实测结论**：

```
① PASS  4 个探针全部超过阈值（最小 8.88%）
② PASS  基线 ratio 1.000 > 0.9（自检：两个会话此时渲同一段同一 t，应逐像素一致）
        交叠 95% ratio 0.441 < 0.5（31.00% → 13.66%），且残留比全程单调下降 1.06 → 0.75 → 0.49 → 0.44
③ PASS  10%：NCC 0.985（锐）；k=0.1 < 0.4 不要求位移（push·k² 此时设计上只有 ~6.9px）
        40%：NCC 0.965（锐）+ 位移 (200,-16) = 200.6px ≥ 24px
        70%/95%：无可信匹配（NCC 0.505 / 0.393）+ ②的 ratio 0.486 / 0.441 < 0.5 → 元素确实已不在画面里，放行
        总闸门：至少有一个探针量到真实位移 ✓
```

另外有**两条独立证据**（不进判据，只用来交叉核对）：
- **A 的大字盒子**（x250–800/y470–620）也有 6.47%–8.59% 的平均亮度差（方块是 8.88%–17.34%）——
  两个独立元素都在变，说明是**整段被带走**，而不是量具恰好盯住了一个会动的目标。
- 退出码**分层**：`0` = 判据全过，`1` = 判据没过，`4` = **脚本自己坏了**（异常）。
  加参考行时踩过一次 `Cannot access 'inOverlap' before initialization` → exit 4，
  一眼就能和"转场有问题"区分开 —— 这正是"量具坏了"和"被测对象坏了"必须分开报的落地做法。

**③ 为什么分层（这条理由值得记）**：第一版要求"每个探针位移 ≥ 24px"，于是 10% 处 FAIL
（NCC 0.985 但只挪了 16.5px）。查 `src/core/trans.js` 才发现位移是 **`push·k²`**（`push=0.36`）——
k=0.1 时**设计上就只有 6.7px**：那个二次方是故意的"速度感"，在那儿量位移等于**在量缓动曲线**，
不是在量"推走 vs 糊掉"。分层之后：位移只在加速起来之后（k ≥ 40%）要求，锐利度对所有探针都要求。
还有一条**防止量具坏掉却当通过**的护栏（这条很关键）：**元素还在（ratio ≥ 0.5）却匹配不上 → 判 FAIL
并说明"这更像量具/判据的问题，必须人工看"**；只有 ratio < 0.5 时才允许"匹配不上"作为"已被送走"的证据。

**①②③ 是互补的**（值得记住）：② 只能证"元素不在了"，**分不清"被推走"和"原地淡出"**
（`transitionPass` 在 k≥0.55 之后把上一帧整体 alpha 归零，所以 95% 的 ratio=0.441 完全可能是"原地淡到 0"）；
把两者分开的是 ③ 的位移 —— 若哪天有人把 `fadeAt` 调大、让 A 留在原地慢慢淡，② 仍会 PASS，③ 会在 40% 抓住它。
⚠ ③ 量到的位移**偏大**：方向拖尾（k=0.4 时 b≈0.052 ≈100px 涂抹）会把 NCC 峰值往运动方向带
（实测 200.6px vs 理论 107.4px），所以"≥24px"这条是**宽松**的。

### 12.3.1 三条自检：量具先证明自己，再报判据

这一轮最值钱的东西不是判据本身，是**脚本里的三条自检 —— 任何一条不过就不跑判据、直接非零退出**：

```
✓ 自检 1  积分图 NCC vs 暴力实现对拍（9 个位置，含模板行下方与画面边界）最大差 4.7e-8
✓ 自检 2  已知位移 (50,-30) 被找回为 (50,-30)，NCC 1.0000
✓ 自检 A  行序：与引擎自己的 PNG 逐像素比 —— 按 (ph-1-y) 取 1044/1044 点完全相等，不翻只有 443/1044
```

自检 A 顺手把 §10.9 那条怀疑彻底否掉了：**`engine.readPixels()` 是自下而上**，
旧脚本 `(h-1-y)` 配自上而下的逻辑 y **本来就是对的**（`src/app.js:419`、`src/core/gl.js:447` 都写明）。
它不是靠读注释，而是拿引擎自己的 PNG 解码回像素逐点比 —— 这条自检**不依赖夹具几何**，很难自欺
（中途试过"硬编码方块位置看最亮行落在哪"，实测最亮行与源码坐标差了约 20px，那种判据不可靠）。
写 NCC 的过程中**错了 4 次**（行号索引、模板原点取成搜索中心、把行前缀差当单像素、协方差漏项），
**4 个错全是自检抓出来的** —— 否则它们都会以"元素已被推走"的样子出现在报告里（§11.17.1 的教训第二次应验）。

> ⚠ **一条被实测证伪的说法（别写进文档）**：子代理怀疑"旧脚本没设 viewport（Chrome 默认 1280×720）
> 却按 1920 宽算下标 → 越界读到 NaN，所以那个 25.35% 不是那块区域的亮度"。
> 我另写探针实测了三种 viewport：`readPixels()` 的长度**恒为 8294400 = 1920×1080×4，与 viewport 无关**
> （它读的是引擎自己的离屏 RT，尺寸由 task.config 决定）。所以旧脚本**没有**越界，
> 那个 `25.32% → 24.79%` 是**真实读数** —— 也正因为它怎么读都不变，判据才永远不可能 PASS。
> 新脚本保留"物理/逻辑尺寸硬校验"是**好加固**（把 `scale=1` 的隐含假设写死，避免像
> `tools/png-rows.mjs` 当年写死 1920 宽度那样把 4K 判成全黑），但理由**不是**"旧版读到 NaN"。

**为什么原来那条必然失败**：它在一大片（x 6%–42% / y 14%–64%）里量平均亮度，而那片的亮度
**主要由全片共用的背景决定**（"一镜到底"配方的要求就是背景逐像素一致）⇒ 背景永远不变暗。
**判据把"世界"和"上一段的内容"混为一谈了。**

**关于 §10.9 那条怀疑**：见上面 §12.3.1 的自检 A（结论：怀疑不成立，`(h-1-y)` 本来就对）。

> ✅ **这条现在有验收了**：脚本自带三条自检，**任何一条不过就不跑判据、直接非零退出**
> （第一版自检确实不过，脚本拒绝报判据 —— 这个设计是对的，§11.17.1 的教训：判据自己会骗人）。

### 12.4 元教训（这一轮新学到的）

1. **渲染期间不能写"任何"仓库文件，不只是 `src/` 和 `tasks/`。**
   P2-2 放宽 `watch.ignored` 只保护了 `docs/**`、`**/*.md`、`tasks/*/audio/**` 等几类；
   在 `scripts/`、`tools/` 里写文件仍然会打断渲染 —— 私有 Vite 会去 watch 编辑器写文件时
   产生的临时文件（`.xxx.tmpdir/…tmp`），撞 `EBUSY` **直接让 Vite 进程崩掉**，
   渲染报 `net::ERR_CONNECTION_REFUSED`。本轮 `check:fidus` 就是这么假失败的。
   → 结论收紧为：**渲染期间只写 `vite.config.mjs` 的 `ignored` 里那几类**。
2. **量具自己会骗人（第二次）。** 我写了一段临时脚本量 beast 27 句的尾部静音，
   得到"0.00s/句"，差点据此把"21.6s 是虚的"这个结论撤回去。真相是那段脚本的
   正则跨行匹配把静音段配错了。**把同一句话重新合成一遍、与存档文件并排量**（跨来源对照）
   才看清：两者逐项一致、尾巴那 0.916s 都在。
   → 单点读数可疑时，**换一条独立的路径再量一次**，不要在同一段代码上反复推论。
3. **ffmpeg 的 `silencedetect` 在文件结尾会补一条 `silence_end`。**
   `probeSpeechEnd()` 第一版假设"末尾那段静音没有 end"，于是永远判不出尾巴静音（trimmed 恒为 0）。
   判据改成"这段静音一直延续到文件末尾（`end >= 文件时长 − 0.08`）"才对。
4. **写文件工具本身也会留下证据。** 我用 PowerShell 的 `Set-Content` 改一个含中文的测试脚本，
   整个文件的非 ASCII 立刻变成乱码（这个坑 `MEMORY.md` 里记过两次，这次又踩了一次）。
   含中文的源文件**只能用文件编辑工具**。
5. **"听起来合理"的归因，也要先证伪再用。** 子代理把 `probe-trans2` 旧判据的失败归因成
   "没设 viewport（Chrome 默认 1280×720）→ 越界读到 NaN，所以那个 25.35% 是假的"——
   这个解释很顺、也能"解释"为什么判据永远不过。我另写探针实测三种 viewport：
   `readPixels()` 长度恒为 `1920×1080×4`，**与 viewport 无关**（它读引擎自己的离屏 RT）⇒ 归因**被证伪**，
   旧数字是真实读数。有意思的是**反例就在那个子代理自己的输出里**（它第一版用的是默认视口，
   打印出来却是 `pw/ph = 1920 1080`）。→ **先证伪，再写进文档**；尤其当"错的归因"会让一条判据
   看起来"本来就该失败"时（那正是它最危险的地方）。

### 12.5 beast：用户拍板不重出，配置改回单轨

第三轮为了让 `analyze` 从 `music` 轨测节拍，把 `tasks/beast/task.config.mjs` 改成了分轨写法；
代价是 `f.beat` 从 136bpm 变 120bpm ⇒ **`beast.mp4` 与代码不再一致**（§11.16.3 留给用户拍板）。

**这一轮把试算做出来了**（`node scripts/anim.mjs say beast --dry-run`，只算不写）：

| | 旧（成片用的这张表） | 新（真语音时长 + 120bpm 取整） |
|---|---|---|
| 总长 | 127.5s | **113.00s** |
| 每段放慢 | — | 1.37–1.69 |
| 每句时长 | **含约 0.9s 尾部静音** | 说到哪算到哪（27 句共裁掉 **21.6s**） |

**用户选的是"不出片、配置改回单轨"**：`audio: './audio/beast-vo.mp3'`，
让代码与那支已交付的成片重新一致。配置里现在写清了这段历史与试算数字，
下次想重出时照着做即可（画面代码一个字都不用改）。
`audio/beast.analysis.json`（120bpm）留着当证据，没有删。

> 诚实记录两笔：① 那次 `--dry-run` 会**合成/复用音频**来量时长（它不写 `timing`/`narration`，
> 也不出旁白轨），所以它在 `tasks/beast/audio/vo/` 里刷新了 27 个 `.sha1` 缓存戳
> （内容相同的音频没有变），并留下了 `.words.json`（已删）。② 试算中用掉的一次 TTS
> 在 `honest-1` 上偶发失败，所以那句没有词级时间戳 —— 那次输出里如实打了出来。

### 12.6 `AGENTS.md` 同步 + 本次改动的文件清单

`AGENTS.md`（给下一个 agent 的操作契约）补了：`anim say` / `anim mix` 两条命令、
`narration.mjs` 的位置与导出、`task.narration` 与 `dur: { vo }`、词级时间戳 → `type.karaoke`
的写法、`tools/regress-all.mjs`、以及 §12.4.1 那条"渲染期间只能写哪几类文件"的收紧。

| 文件 | 改动 |
|---|---|
| `scripts/lib/media.mjs` | 新增：命令行解析、ffprobe/ffmpeg 包装、解码/编码、`probeSpeechEnd`（尾巴静音） |
| `scripts/lib/say.mjs` | 新增：`anim say`（旁白脚本 → TTS → 时长表 → `narration.json`）、`solveTiming`/`alignWords` |
| `scripts/lib/mix.mjs` | 新增：`anim mix`（摆位 + 闪避 + 归一 → 一条混音轨） |
| `scripts/anim.mjs` | 分发加 `say` / `mix`，help 头补全参数 |
| `tools/tts-edge.py` | 新增：默认 TTS 驱动（`edge_tts` 库 + `WordBoundary` 词级时间戳） |
| `tools/stub-tts.mjs` | 新增：确定性假驱动（离线回归用） |
| `tools/test-say.mjs` / `tools/probe-tts-edge.mjs` | 新增：B/C 档的离线回归与真 TTS 通电探针 |
| `tools/test-karaoke.mjs` | 新增：C 档 karaoke 回归（80 项） |
| `tools/regress-all.mjs` | 新增：把整份回归清单变成一条命令 |
| `tools/probe-trans2.mjs` | 重写判据（§12.3） |
| `src/core/text.js` | `karaoke()` 修掉"秒/字符下标混用"（+ `karaokeSpans`、写错就响一次） |
| `src/core/narration.js` | 词级时间戳（`words` / `normalizeWords` / `wordsApprox`）、`recent(t, hold)` |
| `docs/NARRATION.md` / `docs/ROADMAP.md` / `docs/IMPROVEMENTS-2.md` | 状态同步（B/C 档落地、P2-2 结论收紧） |
| `tasks/beast/task.config.mjs` | 音频改回单轨 + 写明历史与试算（§12.5） |
| `tasks/_calib/task.config.mjs` | 清掉上一轮被中断时残留的 `bgcheck` 注入（§12.1 的前置） |

### 12.7 下次会话的建议起点

1. **用 `anim say` 真做一支带旁白的片子**（新的，别动 beast）：B/C 档目前只在
   `_saytest`/探针夹具上验过，"在真实创作流程里好不好用"还没有样本。
   几条已知要留意的：`--dry-run` 也会合成；换音色后 `slot` 会变 ⇒ 要重出片；
   词级时间戳现在只接了 `type.karaoke`，还没做"字幕整行 + 说到哪亮哪"的现成镜头模板。
2. **`edge-tts` 的偶发失败**：现在同一句重试 2 次。如果要跑很长的旁白（几百句），
   值得再加一层"失败也继续、最后统一补跑失败的句子"。
3. **`probe-alpha` 的 `blank` 参考帧常量偏移**（§11.17.3）仍然没查清：读 0.10012 而不是 0.062。
4. `hashes fidus` 的基线已重存为当前画面 —— 下次改 `src/kit/` 或 fidus 场景时
   拿它当基线跑 `--baseline`。

---

## 13. 第五轮：pdoom-video 那套「3D + 一镜到底」搬进来了多少

> **本轮（第六轮）把这一节里"没做完"的那一块收掉了 —— 见 §13.4。**
> 一句话：raymarch 是好的，坏的是三个"不报错"的接缝（相机 uniform 字段名、`FRAG_PX` 的 y 方向、
> `camera3` 的手性），顺带把"整屏白"变成了 `check` 能点名的一句话。

参考实现在 `out/_ref/pdoom-video/`（只读克隆）。这一轮做了三块引擎能力 + 一支验证片
`tasks/pdoom-lab`（32 秒 / 5 段 / 全硬切）。下面是**逐条对照 + 验收证据 + 没做完的部分**。

### 13.1 先纠正一个前提：pdoom 的"一镜到底"不是转场做出来的

把它的 `app/src/timeline.ts` 读完之后，这条是这一轮最重要的发现：

* 全片 22 段是**严格分区、零重叠** —— 相邻段的边界在代码里是**同一个变量**
  （`E('loss','loss', b.loss, b.pre1)` 这种写法），所以 `start_{n+1} == end_n`；
* 引擎里那条默认交叉溶解分支（`engine.ts:344`）**从未被执行过**（`active` 每帧只有一条）；
* 全项目**没有一个场景**设置 `handlesTransition`，也**没有一处**读 `f.under`。

它做到"切了像没切"靠的是四件事（`tasks/pdoom-lab/scenes/_world.js` 顶部有完整说明）：

1. **全片一台摄影机**，参数只跟整片时间 `f.t` 走 —— 切点两侧运动方向、滚转、速度连续；
2. **一个走完全片的母题**（那颗火花）—— 眼睛有得跟；
3. **手工几何交接常量**：把"对象在切点那一刻的屏幕坐标/布局"抽成常量，两段都引它。
   pdoom 抄了 6 组（`ROOM`/`EYE`/`THREAD`/`CARET`/`HANDOFF`/`ROLL_IN`），
   更强的做法是抽共享模块（`room-shrooms.ts`）—— 本片的 `HANDOFF` 就是这一条；
4. **pre-lap / post-lap**：运动提前起、过后落（`stack.ts` 每拍提前 0.22 拍；`fuse.ts`
   的推镜穿过切点还在加速；`hook.ts:194` 出段主动"停表"把抖动和变焦归零）。

**结论：本地引擎那套 `overlap` + 甩走上一帧的转场，并不是做 pdoom 手法的前提。**
两套可以并存（`cut()` 的 `overlap` 默认就是 0）；`tasks/pdoom-lab` 全程零 overlap 也过
`check` 的全部守门。

### 13.2 新增的引擎能力（三条，都有离线单测）

| 能力 | 位置 | 验收 |
|---|---|---|
| **世界摄影机**：关键帧插值 / zoom 对数插值 / 推近自动不动点 / `mixCam` / 速度与拖影采样 / 按帧号播种的手持抖动 | `src/core/cam.js` | `node tools/test-cam-math.mjs`（**31 项全绿**） |
| **3D 投影**（第 1 类"3D"）：`camera3` / `project3` / `clipSegment` / `depthScale` / `widthAt` / `projectLine` | 同上 | 同上 |
| **投影 `setXform`**：`camXform()` 直接产出完整 3×3 射影矩阵（`xformForward` 认 `proj` 字段），整层矢量+文字按同一条透视变形 | `src/core/cam.js` + `src/core/engine.js` | 「camXform 与 project(k) 逐像素一致」：8 组机位（含偏心/缩放/旋转/k 正负）× 5 个世界点，**逐点 1e-6**；`tools/test-xform-math.mjs` 仍然 PASS（老行为一字未改） |
| **raymarch 内核**：3D 噪声 / 相机 ray / SDF 图元 / march / 四面体法线 / 软阴影 / AO / **雕刻排线（含密度 LOD）** / 雾 | `src/core/glsl3d.js` | ✅ **已通电**（第六轮）：走廊段用它出画 + `tools/probe-raymarch.mjs` 14 条判据 —— 见 §13.4 |

关于 `camXform`：**它在实现里连续错了五次、正推又错两次**，每一次的表现都只是
"整层偏一点、缩一点"——**不崩溃、不报错、`check` 也查不出来**（矩阵转置、少一层缩放、
把 W/2 乘进系数、平移从世界原点量、分母符号写反）。最后改成**运行时数值解**
（5 个世界点 → 两个 5 元线性方程组，高斯消元 + 部分主元 + 两次自检），
没有推导也就没有符号可以写反。这段经历写在函数注释里，改它之前先跑那条断言。

### 13.3 验证片 `tasks/pdoom-lab`

5 段 32 秒，**全硬切（零 overlap）**，段长都是整数拍：

| 段 | 内容 | 演示的东西 |
|---|---|---|
| `corridor` | 石柱走廊，门框扑面 | 第 1 类 3D（`project3` + 线段批 + 近平面裁剪 + 深度衰减） |
| `map` | 一张图纸 | keystone 透视（`project(k)`）、world 坐标排版 |
| `stack` | 无限下落的塔 | "一镜到底"：世界位置是连续函数、摄影机只跟随；沿速度拷份做拖影 |
| `columns` | 柱林横摇 | 3D 线段批的日常用法 + 甩镜时几何多重绘制 |
| `loop` | 收尾回到第一帧 | 与 `corridor` **共用同一份世界**（第六轮起是同一份 SDF，见 §13.4.5），摄影机减速回到首帧位姿 |

验收：`node scripts/anim.mjs check pdoom-lab` —— **✓ 没有问题**（三点采样 + 单/多子帧两条
路径 + 背景守门全过）；每段都出图并用 Read 看过；`hashes --save` 基线已存
（`out/pdoom-lab/hashes.json`），下次改引擎或场景可以 `--baseline` 证明画面没变。
（第六轮改了 `camera3` 的手性并把走廊换成 raymarch，基线已按当时的画面重存，见 §13.4.5。）

### 13.4 ✅ 收尾（第六轮）：raymarch 通电 —— 整屏白的真因不在 raymarch

第五轮把 raymarch 写成"待通电"，理由是"那一版在引擎里稳定整屏白"。这一轮把它跑通了，
结论是**整屏白跟 raymarch 内核无关**：内核一直是好的，坏的是三个**不会报错**的接缝。
下面按"当时怎么想的 / 实测是什么"记，接手的人不用再猜。

#### 13.4.1 先纠正第五轮的两条推断

| 第五轮的推断 | 实测结果 |
|---|---|
| 「WebGL 里 NaN 画出来是白的 → 怀疑 `fwidth` 在非一致控制流里」 | **症状对、机理不对，而且 `fwidth` 是清白的**。NaN 确实显示成整屏白，但**+Inf 显示出来一模一样**：注入 NaN 与注入 `1.0/0.0` 的两帧，PNG **逐字节相同**（sha256 `1cd077b8…`，1920×1080）。所以"整屏白"只能定位到"非有限值"，指不到具体哪个函数。`fwidth_branch` / `fwidth_mask` 两个变体（同一个 `hatch`，一次在 `if (hit>0.0)` 里、一次在分支外算）**画面完全一致**，把 `fwidth` 排除了。 |
| 「`ctx.params` 没传到 `setup`/`render`（`params: { dbg: 7 }` 读出 undefined），大概是 `_ctxFor` 的时机」 | **没有复现**。`cut(scene,{params})` → `build()` → `_ctxFor()` → `ctx.params` 这条链是通的：`tools/probe-raymarch.mjs --inspect` 打出 `{"id":"corridor","params":{"dbg":1}}`，而走廊段的材质号/法线调试图（`params: { dbg: 1/2 }`）确实渲染出来了（本节的三张图就是这么来的）。当时那次 undefined 没留下可复现的证据；**这一类"参数没到"现在有两条常驻自检**：`Pass` 会对"声明了但值没给的 uniform"点名告警，走廊段本身也常驻读 `params.impl`/`params.dbg`。 |

#### 13.4.2 三个真因（都是"写错了但画面照样出"的那种）

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| ① | 相机 uniform 全 0 → `normalize(vec3(0.0))` → NaN → **整屏白** | `cam3Uniforms()` 只认 `{camPos,camR,camU,camF,focal}`，而 `camera3()` 吐出的是 `{pos,right,up,fwd,focal}`；字段名对不上时它返回四个 `undefined`，`Pass` **静默跳过**这几项（保持 0） | `cam3Uniforms()` 两种形状都认，**认不出来直接抛错**；`Pass.render()` 对"值是 `undefined` / `NaN`"的 uniform 点名告警（每个名字一次） |
| ② | 整个世界**上下颠倒**（地板在天上），对称的画面看不出来 | `rayDir()` 照抄 pdoom 的 `px = (FRAG_PX - res*0.5) * vec2(1,-1)`，但本引擎的 `FRAG_PX = gl_FragCoord/PX_SCALE` **y 本来就是向上的**；多翻一次 = 上下镜像。`GLSL_COMMON` 里那句"逻辑像素"没写清是 y 向下（JS 侧）还是 y 向上（shader 侧），是这条的温床 | `rayDir` / `rayDirOrtho` 去掉那次翻转；`GLSL_COMMON` 明确写出"**只有 FRAG_PX 是 y 向上**，`post.center`/`setXform`/`lines`/`type` 都是 y 向下" |
| ③ | 整幅画面**左右镜像**（世界 `x=+1.5` 落在画面左半边） | `camera3()` 写的是 `right = (fz,0,-fx)` = `cross(worldUp, fwd)`，而注释和常识都是 `cross(fwd, worldUp)` —— 基座成了左手的。第五轮的四个 proj3 场景左右近似对称，**谁都没看出来**（连 `test-cam-math` 的 31 项也没钉这一条） | 改成 `right = cross(fwd,worldUp)`、`up = cross(right,fwd)`；`tools/test-cam-math.mjs` 补两条手性断言（世界 +x 在右半边、`right×up = -fwd`），`tools/probe-raymarch.mjs` 的 `ray` 变体也钉住 |

**怎么发现 ②③ 的**（值得复用）：给走廊段做了一个 `params: { dbg: N }` 调试开关
（1 = 材质号、2 = 法线、3 = 命中距离），法线图一开就露馅 —— 绿（法线朝上 = 地板）跑到了
画面**上半**，青（法线 -x）跑到了**右**半边，两个方向同时反。**在"看不出对错"的场景里，
把中间量画出来比盯着成品图猜快一个数量级**，而且这个开关是零成本的（不传 `params` 就是正常画面）。

#### 13.4.3 「整屏白」现在不再是哑巴

以前这一类事故只能靠抽帧看出来，`check` 三处采样全绿。原因有两层：

* **8bit 读回分不出 NaN 和 Inf**：`gl.readPixels()` 里 `Inf → 255`、`NaN → 0`，
  而后处理链会把两者压成**同一个白画面**（上面那张 sha256 相同的证据）；
* **多子帧那条路反而把证据擦掉了**：`engine._accumPass()` 会把非有限值（以及 `|c| > 5e4`）
  **丢掉**（`bad ? vec3(0.0) : c`）—— 于是同一段 `samples: 1` 是白的、成片里是黑的。
  `check` 会报「单子帧与多子帧亮度差了 N×：这是运动模糊求平均/累加的问题」，
  **指的方向完全是错的**。

现在 `check` 每个采样点会多走一次**浮点**回读（`window.__anim.nonFinite(t)` →
`engine.probeNonFinite()` → 只渲一个子帧、直接读 RGBA16F），把 NaN / ±Inf / 量级>5e4
分开数出来并点名，还给出第一个坏像素的屏幕坐标：

```
corridor       t=3.75s  单帧 1.000  多子帧 0.004（24 子帧）
      ← ⚠ 非有限值：NaN 0 / Inf 2073600 / 量级>5e4 0 像素（首个坏像素 x=0 y=1079，+Inf）
        这是「整屏白 / 单帧白多帧黑」的一类根因：shader 里除了 0、开了 normalize(0)
        （多半是相机 uniform 全 0）或 pow(0, 负数)。见 node tools/probe-raymarch.mjs
```
（上面是拿探针的 `inf` 变体故意注入 +Inf 时的真实输出形态；正常段这一行不会出现。）

#### 13.4.4 新增的常驻工具：`tools/probe-raymarch.mjs`

一条命令把"引擎里的一条 shader"拆成 14 个**可单独开关的变体**，在同一个浏览器会话里
逐个渲染，并**直接读 HDR 浮点缓冲**（8bit 读回看不见 NaN）：

```sh
node tools/probe-raymarch.mjs                 # 全部变体 + 14 条判据（PASS/FAIL，退出码）
node tools/probe-raymarch.mjs --only ray,full # 只看几个
node tools/probe-raymarch.mjs --png full,nan  # 额外存走完整引擎链的 PNG
node tools/probe-raymarch.mjs --inspect       # 只打时间线（含 params），查"参数到没到"
```

| 变体 | 它回答什么 |
|---|---|
| `flat` | 引擎里"画一条 Pass"这条路通不通（注入常量色，逐像素核对） |
| `ray` | 相机 uniform / 手性 / 朝向（左半 R<0.5、右半 R>0.5、上半 G>0.5） |
| `hit_mask` `hit_t` `normal` | SDF 步进与法线对不对 |
| `engrave` `fwidth_branch` `fwidth_mask` | 排线、以及"`fwidth` 在分支里"这个老怀疑（实测两者一致） |
| `full` | 全链路（排线 + AO + 软阴影 + 雾）；断言"地板比天花板亮" |
| `nan` `inf` `huge` | 三种非有限值长什么样：**NaN 与 Inf 的 PNG 逐字节相同**，`1e30` 被 RGBA16F 夹到 65504 |
| `zerocam` | 复现"相机 uniform 全 0"的后果 |

它同时是 **`engine.nonFinite()` 的回归**（`nan`/`inf` 必须被报出、`full` 必须干净），
已经进 `tools/regress-all.mjs`（`probe:raymarch`、`unit:cam-math`、`check:pdoom-lab`）。

#### 13.4.5 走廊段现在是真 raymarch（第 ② 种 3D）

`tasks/pdoom-lab/scenes/corridor.js` 改回 raymarch，世界（SDF）抽成
`scenes/_corridor.js`，**第 5 段 `loop.js` 引同一份** —— 于是"回到第一帧"不是两边抄同一串数字，
而是字面上的同一个 SDF（`_corridor.js` 顶部有一张尺寸对照表，对着 `_world.js` 的线段版）。
两种实现都留着：`cut(corridor, { params: { impl: 'lines' } })` 退回投影线段批（第 ① 种）。

| 段 | 现在演示什么 |
|---|---|
| `corridor` | **真 raymarch**：盒内腔 + `floor(z/4)` 重复门框 + 雕版排线 + AO/软阴影 + 雾；`params.dbg` 可切材质号/法线/命中距离 |
| `map` | 2.5D 图纸：`project(k)` keystone + `camXform`（**唯一不用 `camera3` 的段**） |
| `stack` | 一镜到底：世界在落、摄影机只跟随；沿速度拷份做拖影 |
| `columns` | 投影像段批的日常用法 |
| `loop` | 与 `corridor` **同一份 SDF**，摄影机减速回到首帧位姿 |

验收（本轮全跑过）：

```sh
node scripts/anim.mjs check pdoom-lab     # ✓ 没有问题（15 个采样点 × 两条路径 + 背景守门 + 非有限值扫描）
node tools/probe-raymarch.mjs             # ✓ 14/14 判据
node tools/test-cam-math.mjs              # ✓ 33 项（含两条新手性断言）
node tools/probe-raymarch.mjs --inspect   # params 确实进了 render 路径
```

`hashes --baseline` 与**改之前**的基线对比（这是"改动到底动了哪些像素"的直接证据）：

| t | 段 | 结果 | 说明 |
|---|---|---|---|
| 0 / 4 | `corridor` | ✗ 变了（mean 24.4 / 20.5） | 换了实现（线段批 → raymarch），预期 |
| **8 / 12** | **`map`** | **✓ 逐像素一致（max 0）** | 这一段不用 `camera3`（走 2D 的 `project(k)`），所以手性修复**碰不到它** —— 反过来说明改动范围是可控的 |
| 16 / 20 | `stack` | ✗ 变了（mean 1.5 / 1.6） | 手性修复 = 左右镜像：只是线几何换边，所以均值差很小（3% 像素 >16） |
| 24 | `columns` | ✗ 变了（mean 0.9） | 同上 |
| 28 | `loop` | ✗ 变了（mean 0.03 + 新 SDF） | 同上 + 换成同一份 SDF |

改完**已重存基线**（`out/pdoom-lab/hashes.json`，16 帧），下次改引擎拿它比。

#### 13.4.6 这一轮学到的（比具体 bug 更值得记）

1. **"症状"能对上，不等于"机理"能对上。** 第五轮认定是 NaN，方向对了，但结论停在
   "怀疑 `fwidth`"，于是把力气花在了一个**根本不是问题**的地方（实测两个变体画面一致）。
   真正省时间的一步是**把中间量画出来**（`params.dbg`）和**直接读浮点缓冲**。
2. **"引擎里没有一种失败长得像它的原因"是这一轮最贵的三个 bug 的共同点**：
   uniform 静默为 0、坐标轴静默镜像、rayDir 静默多翻一次 y —— 三个都不报错、都不崩溃，
   而且**对称的场景里全都看不出来**。修法都是同一个套路：**要么说清楚（注释/文档），
   要么直接抛错（`cam3Uniforms`），要么留一个能测的判据（探针 / 单测 / `check` 的扫描）**。
3. **常量/手势类的"约定"必须写在注入点旁边。** `FRAG_PX` 的 y 方向写在 `GLSL_COMMON`
   里，`rayDir` 就不会抄错；`camera3` 的手性写在 `camera3` 里，下一个场景就不会镜像。
   写在文档里的约定，写代码的人（包括我）不会回头翻。
4. **改动范围要能被"反证"**：`map` 段逐像素没变，是"这次只动了 3D 投影层"最有力的一句话。
   → 大改动之后，**找一个"本该不受影响"的样本比一遍**，比"我看了几张图觉得没问题"可靠得多。
5. **量具也会骗人，而且这次是真的骗了一次。** 全量回归里 `smoke:worktree-edit` 红了：
   "写 `docs/` 之后帧数继续涨（60 → 60）"。查下去不是引擎的问题，是**这条判据写死了 5 秒窗口**，
   而 `video demo --samples 1` 在这台机器上实测只有 **3.0 fps**（480 帧 157.7s）、进度行又**每 30 帧才重画一次**
   —— 5 秒里读数根本不会变。改成"**等到帧数真的涨**（最多 60s）"就绿了；顺手修掉同一文件里的一个竞态：
   `await child.on('close')` 挂得太晚会变成 "unsettled top-level await"（Node 退出码 13）。
   → 判据写"等固定时间"的地方，都要问一句：**这段时间里那个读数真的有机会变吗？**

#### 13.4.7 这一轮改动的文件

| 文件 | 改了什么 |
|---|---|
| `src/core/cam.js` | `camera3()` 的手性（`right = cross(fwd,worldUp)`、`up = cross(right,fwd)`）—— **会改变所有 proj3 场景的画面** |
| `src/core/glsl3d.js` | `rayDir`/`rayDirOrtho` 去掉多余的一次 y 翻转；`cam3Uniforms()` 两种机位形状都认、认不出来抛错；头注释重写成可复制的骨架 + "整屏白怎么查"对照表 |
| `src/core/gl.js` | `GLSL_COMMON` 里写清 `FRAG_PX` 是 **y 向上**（与 JS 侧相反）；`Pass.render()` 对"值是 `undefined`/`NaN`"的 uniform 点名告警（每个名字一次） |
| `src/core/engine.js` | 新增 `scanNonFinite(rt)` / `probeNonFinite(t)`：直接读浮点缓冲，NaN / ±Inf / 量级>5e4 分开数 |
| `src/app.js` | `window.__anim.nonFinite(t)` |
| `scripts/anim.mjs` | `check` 每个采样点多走一次非有限值扫描并**非零退出**；"两条路径亮度差"那句补上正确指向 |
| `tasks/pdoom-lab/scenes/_corridor.js` | **新**：走廊世界的 SDF + shader（第 1 段与第 5 段共用） |
| `tasks/pdoom-lab/scenes/corridor.js` | 改回真 raymarch；`params.impl === 'lines'` 保留线段版；`params.dbg` 材质号/法线/命中距离 |
| `tasks/pdoom-lab/scenes/loop.js` | 收尾段改用**同一份 SDF**（"回到第一帧"是字面上的同一个世界） |
| `tasks/pdoom-lab/task.config.mjs` | 注释写清三个诊断开关与它们的用法 |
| `tools/probe-raymarch.mjs` | **新**：14 个变体 + 14 条判据 + `--inspect` / `--png` / `--nf` |
| `tools/test-cam-math.mjs` | 31 → **33 项**（补两条手性断言） |
| `tools/smoke-worktree-edit.mjs` | 判据从"等 5 秒"改成"等帧数真的涨"；修掉 `close` 监听挂太晚的竞态 |
| `tools/regress-all.mjs` | 新增 `unit:cam-math` / `probe:raymarch` / `check:pdoom-lab` |
| `docs/ENGINE.md` | 新增 §3.7（3D：投影 + raymarch、坐标约定、整屏白对照表）；§13 排错表加 3 行；"代码与直觉不符"加 3 条 |
| `AGENTS.md` | 新增 §5.5「想做真 3D 时」、`check` 的非有限值扫描、`probe-raymarch` 进工具清单与排错表 |
| `docs/STATUS.md` | 本节 |

**回归**：`node tools/regress-all.mjs` —— 31 项（原 26 项 + 本轮 5 项）。

#### 13.4.8 这一轮**没做**的（仍然开着，别当成已完成）

| 事 | 为什么还开着 | 从哪接着做 |
|---|---|---|
| 用 `anim say` 真做一支带旁白的片子 | 旁白层只在 `_saytest` / 探针夹具上验过，"在真实创作流程里好不好用"仍然没有样本（§12.7 第 1 条，两轮没动） | 新开一个任务，别改 beast |
| `edge-tts` 的偶发失败 | 现在同一句重试 2 次；几百句的长旁白值得加"失败也继续、最后统一补跑" | §12.7 第 2 条 |
| `probe-alpha` 的 `blank` 参考帧常量偏移（读 0.10012 而不是 0.062） | 一轮没查清，两轮没动 | §11.17.3；**别把它当"已知正常"** |
| `_accumPass()` 丢掉非有限值时**不吭声** | `check` 现在能扫出来了（本轮的扫描），但**渲染成片时**它仍然是静默丢弃 —— 想更早发现只能在 `video` 里也开扫描（每帧多一次浮点回读，代价要实测） | 本轮 `scanNonFinite` 已经可复用 |
| 走廊段的成本 | raymarch 比线段批贵（`still --samples 1` 实测 ~0.4–0.6s/帧，`check` 30 帧 19.3s）；没有和线段版做过严格对照 | `cut(corridor, { params: { impl: 'lines' } })` 换个实现跑 `video --dry-run` 就能对照 |
| ROUTE 上的其它"3D 手法" | pdoom 还有 `fuse` 的引线、`banknote` 的团花这些非 raymarch 的花样，本轮没碰 | `out/_ref/pdoom-video/docs/TREATMENT.md` |

---

## 14. 第七轮：A 档镜头库 `src/shots/` —— 常见镜头从 126 行降到一行

### 14.0 一句话

`docs/ROADMAP.md` 的 **A 档落地了**：`tasks/demo` 与 `tasks/beat` 的 8 个场景改成「取模板 + 给参数」，
**画面逐像素没有变**（22/22 帧）。这一步的意义不是"少写代码"本身，而是
**镜头库把"这 8 个镜头的画面"从任务里搬进了引擎** —— 以后做新片子，常见镜头不用再从零画。

### 14.1 落地形态

```js
// tasks/<任务>/scenes/chart.js —— 改造前 126 行，现在 13 行
import { shot } from '../../../src/shots/index.js';

const VALUES = [0.18, 0.34, 0.27, 0.52, 0.44, 0.71, 0.63, 0.88, 0.79, 0.95, 0.86, 1.0];
export default shot('chart', {
  values: VALUES,
  title: '每次迭代的最高准确率',
  sub: 'PER-RUN  ·  n = 12  ·  纯代码绘制，无图片素材',
  footer: '确定性渲染 → 任意时刻可重放，任意精度可重渲',
});
```

| 名字 | 从哪个场景搬来 | 参数（默认值 = 原画面） |
|---|---|---|
| `title` | `tasks/demo/scenes/title.js` | `id` `eyebrow` `title` `sub` `readout` |
| `chart` | `tasks/demo/scenes/chart.js` | `id` `values` `title` `sub` `footer` `peak` |
| `kinetic` | `tasks/demo/scenes/kinetic.js` | `id` `headline` `sub` `cellCols` `cellRows` `cellSeed` |
| `whip` | `tasks/demo/scenes/whip.js` | `id` `streaks` `dir` |
| `outro` | `tasks/demo/scenes/outro.js` | `id` `title` `sub` `signature` |
| `wave` | `tasks/beat/scenes/intro.js` | `id` `label` `cols` `window` |
| `pulse` | `tasks/beat/scenes/pulse.js` | `id` `title` |
| `grid` | `tasks/beat/scenes/grid.js` | `id` `label` `cols` `rows` `window` |

- **`shot(name, opts)` 返回的就是普通场景对象**（`{ id, setup?, render }`），所以模板镜头与手写场景能混在同一条时间线里；
  `opts.id` 覆盖段名（`tasks/beat/scenes/intro.js` 就是 `shot('wave', { id: 'intro' })`，段名沿用原来的 `intro`）。
- **参数写错会抛错**（本轮唯一"新增行为"的地方）：`shot('title', { eybrow: … })` →
  `镜头模板 "title" 没有参数 "eybrow"（大概是拼错了）。可用参数：id / eyebrow / title / sub / readout`。
- 查模板：`node scripts/anim.mjs shots`（8 个模板 + 摘要）、`node scripts/anim.mjs shots chart`（参数、类型、默认值、说明）。
- 8 个模板**全都自己铺满整帧**（三个自带全屏 Pass、四个 `gl.clear`、`whip` 是揉 `ctx.under` 的 Pass），
  所以它们与 `src/kit/shot.js` 的 `makeShot()` 是**两条平行的路**，不能叠（叠了会覆盖 `makeShot` 铺的背景）。见 `docs/ENGINE.md` §14.5。

### 14.2 做法：逐字搬运，不是"再写一遍"

模板里的绘制代码是从已经出过片的场景**逐字**搬过来的：只把内容换成参数，
数值、运算顺序、绘制顺序、Pass 的 shader 源码与 `key`、每条注释都原样保留。
这是"画面逐像素没变"唯一可行的做法 —— 任何一次"顺手改好"都会改变已经交付的片子。

**新增/改动的文件**

| 文件 | 改动 |
|---|---|
| `src/shots/{index,title,chart,kinetic,whip,outro,wave,pulse,grid}.js` | **新增**：`shot` / `SHOTS` / `listShots` + 8 个模板（每个带 `.defaults` 与 `.meta`） |
| `tasks/demo/scenes/{title,chart,kinetic,whip,outro}.js` | 改成薄壳（97/126/101/85/55 行 → 10–20 行） |
| `tasks/beat/scenes/{intro,pulse,grid}.js` | 同上（75/58/83 行 → 11–13 行） |
| `scripts/anim.mjs` | 新增 `shots` 命令（读 `listShots()`，纯 Node，不起 Vite）；`--help` 头加一行；`new` 脚手架的场景文件头加两句"想要现成镜头先看 `anim shots`" |
| `package.json` | 新增 `npm run shots` |
| `tools/test-shots.mjs` | **新增**：74 项断言（见 §14.4） |
| `tools/regress-all.mjs` | 新增 `unit:shots`；顺手修掉 `check:fidus` 那条过时的 "⏸ 两轮没验过" |
| `AGENTS.md` / `README.md` / `docs/ROADMAP.md` / `docs/ENGINE.md` | A 档标为已落地；`ENGINE.md` 新增 §14（API / 模板表 / 与 `makeShot` 的关系 / 纪律） |

### 14.3 验收（实际输出）

**① 画面逐像素没变**（这是 A 档在 ROADMAP 里写死的判据）。基线在改造**之前**存：

```sh
node scripts/anim.mjs hashes demo --times 0.5,2,4.5,6.5,8.5,10.5,12.2,12.8,13.2,14,16 --save
node scripts/anim.mjs hashes beat --times 1,4,7,10,13,16,19,22,25,28,31 --save
# …把 8 个场景改成 shot(...) …
node scripts/anim.mjs hashes demo --baseline
node scripts/anim.mjs hashes beat --baseline
```

```
demo：✓ 11 帧全部与基线一致（画面没有被改动）
  t=0.5/2/4.5/6.5/8.5/13.2/14/16   max 0     mean 0.0000  >16 0.0000%
  t=10.5 / 12.2（kinetic 与甩镜交叠附近）  max 13    mean 0.0001  >16 0.0000%
  t=12.8（whip 交叠中）                    max 6     mean 0.0001  >16 0.0000%
beat：✓ 11 帧全部与基线一致 —— **每一帧 max 0**（mean 0.0000、>16 0.0000%）
```

> 判据是"没有任何像素差超过 16/255 且平均差 < 0.002"（`negligible()`）：GPU 在转场帧上有
> 最后一位噪声，实测天花板就是 `max 13`；真正的画面变化会以远大于 16 的幅度、成千上万个像素同时打破它。
> **beat 那边 11 帧 max 全是 0**，说明这次搬运连一个 LSB 都没动。

**② 逐段体检**：`check demo --quick` / `check beat --quick` → 退出码 0，
段名与时长与改造前完全一致（demo 5 段 16.65s：title/chart/kinetic/whip/outro；beat 3 段 32s：intro/pulse/grid），
背景守门通过，各段亮度 0.051–0.868（没有全黑段）。

**③ 出图看过**（AGENTS.md 铁律：出图必须用 Read 看）：`still demo -t 1,6.5,10.5,12.8,15`、
`still beat -t 2,14,26` 共 8 张，逐张确认画面与原样一致（标题逐字入场、纸面柱状图、
等高线底 + 计数器阵列、甩镜拉丝、片尾刻度尺、波形 + 三条频段、频谱网格）。

**④ 镜头库自己的回归**：`node tools/test-shots.mjs` → `✓ 全部通过（74 项）`，进了 `regress-all` 的 `unit:shots`。

**⑤ 整份回归**：`node tools/regress-all.mjs` → **通过 32/32 ✅ 没有真失败**（上一轮是 31 项，本轮 +1 就是 `unit:shots`）：

```sh
# 与镜头库直接相关的
node tools/regress-all.mjs --only unit    # 8/8（含 unit:shots）
node scripts/anim.mjs help                # 命令清单里有 shots
node scripts/anim.mjs new _shotsmoke && node scripts/anim.mjs check _shotsmoke --quick
                                          # 脚手架仍然出得来、能过体检（临时任务已删）
# 全量（约 12 分钟；smoke:* 会临时改工作区文件，必须独占跑）
node tools/regress-all.mjs
  unit:shots PASS 0.1s ｜ smoke:worktree-edit PASS 62.7s ｜ check:demo/beat PASS ｜
  check:beast/_calib/nekohome/fidus/pdoom-lab PASS ｜ probe:* 全 PASS ｜
  probe:determinism PASS 64.7s ｜ test:parallel PASS 249.4s ｜ hashes:fidus PASS 106.8s
```

> `smoke:worktree-edit` 会往 `tasks/demo/scenes/chart.js` 里注入一行再还原 —— 跑完确认过
> 那 8 个薄壳仍然是干净的 13 行（注入的清理是幂等的）。

### 14.4 `tools/test-shots.mjs`（74 项）守什么

| 组 | 条数 | 守的是 |
|---|---|---|
| §1 登记 | 4 | `SHOTS` / `listShots()` 的键正好是那 8 个名字；每个值都是函数；8 个具名导出都在 |
| §2 文档与代码一致 | 33 | 每个模板的 `meta.name == 注册名`、`summary` 非空、每个参数都有 `name/type/desc`；**`meta.params` 的键集合与 `defaults` 完全相等**（少登记一个参数、或登记了一个不存在的参数，都会点名）；`listShots()` 报的默认值就是工厂 `defaults` 里的值 |
| §3 场景对象 | 9 | 8 个模板不传参数都能拿到 `{ id, render }`；`whip.handlesTransition === true`（转场镜头） |
| §4 状态隔离 | 1 | 每次调用返回**新对象**（场景有自己的 `this.bg`/`this.cells`，共享会串场） |
| §5 `id` | 2 | `opts.id` 覆盖；不传时等于 `defaults.id` |
| §6 报错路径 | 12 | 未知模板名抛错 + 点名 + 列出全部可用名字；**每个模板传一个不存在的参数都必须抛错并点名它**（某个模板忘了写 `defaults` 时校验会全线放行，这条就是抓这个的） |
| §7 任务侧集成 | 8 | `tasks/demo|beat` 的 8 个场景段名没变（`intro` 也是）——段名被悄悄改掉会红 |
| §8 静态扫描 | 5 | `src/shots/` 下确实扫到 8 个模板 + `index.js`；源码里没有 `Math.random(` / `Date.now(` / `performance.now(`（注释与字符串先掩码，避免把"注释里提到 Math.random"当成违规） |

### 14.5 这一轮的坑（比结论更值得记）

1. **渲染期间写 `docs/*.md` 也会把 Vite 搞崩**（第三次复现，这次抓到了机制）。
   第一次 `hashes demo --baseline` 跑到第 8 帧就死了：

   ```
   Error: EBUSY: resource busy or locked, watch
     'D:\ai动画\docs\.ENGINE.md.19416.b30f73a2-….tmpdir\ENGINE.md.tmp'
   ```

   那是我**并行写 `docs/ENGINE.md`** 时编辑工具留下的原子写临时文件 ——
   `watch.ignored` 里的 `docs/**` 与 `**/*.md` **没能挡住它**（`.tmp` 不以 `.md` 结尾）。
   → 规则比 `§12.4.1` 再收紧一格：**只要有一场渲染在跑，就不要写任何文件**（连 `docs/*.md` 都不行）。
   并发子代理的产出先落到 **`out/_staging/`**（`**/out/**` 确实被挡住了，这一轮 8 个模板全程写在里面，
   没有干扰任何渲染），渲染结束之后再搬进仓库。
2. **原始场景代码在磁盘上没有第二份。** 本仓库**不是 git 仓库**（`git log` → not a git repository），
   `tasks/demo|beat/scenes/*.js` 被改成薄壳之后，原文就只剩"搬好的模板"了 ——
   也就是说**这个重构的"逐字"保证，只能靠先读、后写**（顺序反了就没法 diff，也没有 `git diff` 兜底）。
   → 下次做同类重构：**先把源文件复制一份到 `out/_staging/orig/` 再动 `tasks/`**（几秒钟的事，换一个可回退）。
3. **`shot()` 的参数校验值得单独说**：它把"参数名拼错"从"静默吃默认值、画面看着也对"变成了一句抛错。
   这正是 `docs/IMPROVEMENTS-2.md` 那类 bug（写错了但画面照样出）的通用解法 —— 能抛错就别约定。
4. **两条路不要叠**：`src/shots/` 的模板自己铺满整帧，`src/kit/shot.js` 的 `makeShot()` 也铺背景。
   子代理在写文档时核对了代码并**否掉了我简报里"两者可叠加"的说法** —— 这是对的，文档按事实写成了"二选一"。
   （又一次印证 `§12.4.5`：听起来合理的说法，先证伪再写进文档。）

### 14.6 这一轮**没做**的（仍然开着）

| 事 | 从哪接着做 |
|---|---|
| **B 档：`task.config.mjs` 里直接写 `{ type: 'chart', … }`、由时间线查表分发** | 这是路线图的**下一步**：`src/timeline.js` 的 `build()` 加一条分支去查 `SHOTS`；再做 `docs/CONFIG-ONLY.md` + `tasks/example-config-only/`。见 `docs/ROADMAP.md` §2 B / §3 |
| 镜头库只有 8 个模板（缺 `quote` / `counter` / `compare` 这类常见镜头） | 需要新模板时**照 `src/shots/title.js` 的形状写**，并同步 `meta`（`tools/test-shots.mjs` 会守住键集合） |
| `tasks/nekohome` / `fidus` / `beast` / `pdoom-lab` 里仍有各自手写的重复镜头 | 那些是"这支片子特有的母题"，按边界**不该**进 `src/shots/`；但如果发现其中有不带片名信息的通用镜头，值得按 `§14.2` 的方式搬（**先复制原文到 `out/_staging/orig/`**） |
| 本轮没跑**整份** `regress-all`（只跑了 `--only unit` 8/8） | ✅ 已跑：**32/32 通过**（`node tools/regress-all.mjs`，约 12 分钟；其中 `smoke:*` 会临时改工作区文件，别与别的渲染并行） |

---

## 15. 第八轮：B 档「配置档」——只写 `task.config.mjs` 就能出片

### 15.0 一句话

`docs/ROADMAP.md` 的最后一块落地了：时间线的每一项可以直接写**镜头模板**，
于是任务可以**只有 `task.config.mjs`** —— 没有 `scenes/`、整个文件没有一行 `import`。
路线图的三档作者模型（A 镜头库 / B 配置档 / C 手写场景）现在全部到位。

### 15.1 落地形态

```js
// tasks/example-config-only/task.config.mjs —— 整个任务就这一个文件
export default {
  title: '只写配置，就能出片', width: 1920, height: 1080, fps: 60, scale: 1,
  timeline: [                                    // 数组、seq([...]) 都行
    { type: 'title', id: 'hook', title: '只写配置，就能出片', dur: { beat: 7 } },
    { type: 'chart', values: [/*…*/], title: '…', dur: 4.4 },
    { type: 'kinetic', headline: ['只写配置', '不用写场景'], dur: 3.5 },
    { type: 'outro', title: '…', dur: { beat: 5 } },
  ],
};
```

| 事 | 规则 |
|---|---|
| 判据 | 节点是对象、`type` 是字符串、**没有 `scene`**（`src/timeline.js` 的 `isConfigNode()`） |
| 时间线字段 | `type` `id` `dur` `at` `overlap` `params` `post` `maxSamples` `handlesTransition` `note` `world` `worldPass`（`TIMELINE_KEYS`） |
| 模板参数 | **其余所有键** → 原样交给 `shot(type, {…})`；显式写在 `params` 里的优先 |
| 默认值 | `id` 不写 = 模板自己的默认段名（重名加 `_2`）；`dur` 不写 = 4 秒；`dur` 支持秒 / `{beat}` / `{bar}` / `{vo}` |
| 写错 | 模板名或参数名写错**抛错**，并指出是数组第几项 + 列出可用模板/可用参数 |
| 混写 | 配置档节点与「已经展开好的段」（带 `start`/`end`）**不能混**在同一条时间线里 → 抛错 |
| 选路 | `src/tasks.js`：非数组、**或**数组里至少有一个配置档节点 → 走 `build()`；纯数组（旧行为）仍然不经过 build |
| 转场 | `{ type: 'whip', dur: 1, overlap: 0.5 }` 即可 —— `whip` 模板自带 `handlesTransition: true` |

### 15.2 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/timeline.js` | `isConfigNode` / `TIMELINE_KEYS` / `configToCut()`；`walk()` 里展开成 `cut()` 的形状（排版逻辑与手写场景共用一条路）；`assertNode()` 认数组与配置档节点；混写禁令；头注释加了配置档一节 |
| `src/tasks.js` | 时间线选路：非数组 or 数组含配置档节点 → `build()`（以前纯数组一律不做 build，配置档会因此完全不生效 —— 这是本轮唯一"必须同时改两处"的地方） |
| `tools/test-timeline-guard.mjs` | 16 → **40 项**（新增一节：展开 / 默认值 / 转发 / 混写 / 报错能定位） |
| `tasks/example-config-only/task.config.mjs` | **新增**：整个任务只有这一个文件，4 段 13.9 秒，无音频 |
| `docs/CONFIG-ONLY.md` | **新增**（353 行）：什么时候只用配置 / 字段表 / 8 个模板 / 时长四种写法 / 转场 / 需要音乐的三个模板 / 边界 / 排错表 |
| `AGENTS.md` | 新增 §2.1（配置档，推荐先试）与 §3.2（规格）；§7 那条"渲染期间能安全写哪些文件"按 §14.5 的实测收紧成"一个文件都别写" |
| `README.md` / `docs/ROADMAP.md` / `docs/ENGINE.md` | B 档标为已落地；ENGINE 新增 §9.7（配置档规格）与 §14.8；顺手更正了两处与代码不符的旧说法（`dur` 其实解析 `{beat}`/`{bar}`；`{bar:n}` = 第 4n 拍） |
| `scripts/anim.mjs` | `--help` 里点明配置档；`new` 脚手架的 `task.config.mjs` 头部写清"想要零代码出片就把 timeline 换成配置档" |
| `tools/regress-all.mjs` | `unit:timeline-guard` 注记改成 40 项；新增 `check:example-config-only` |

### 15.3 验收（实际输出）

```sh
node tools/test-timeline-guard.mjs             # ✓ 全部通过（40 项）
node tools/test-shots.mjs                      # ✓ 全部通过（74 项）
node scripts/anim.mjs hashes demo --baseline   # ✓ 11 帧全部与基线一致（改完 timeline.js/tasks.js 之后老片子没变）
node scripts/anim.mjs hashes beat --baseline   # ✓ 11 帧全部与基线一致（每帧 max 0）
node scripts/anim.mjs check example-config-only
```

```
分辨率 1920×1080×1 @60fps  时长 13.90s  4 段
  hook     0.00 →  3.50  (3.50s)  标题 · { beat: 7 } @120bpm = 3.5s
  chart    3.50 →  7.90  (4.40s)  图表 · 秒写法的 dur
  kinetic  7.90 → 11.40  (3.50s)  动态大字 · 秒写法的 dur
  outro   11.40 → 13.90  (2.50s)  片尾 · { beat: 5 } @120bpm = 2.5s
每段 15% / 50% / 85% 三个点 × 单子帧/多子帧两条路径（24 帧）→ ✓ 没有发现问题
```

- 段名就是模板名（或你写的 `id`）—— 上面第①段的 `id: 'hook'` 就是配置里覆盖的。
- 出图看过的：`still example-config-only -t 1.8,5.6,9.5,12.6`（标题 / 纸面柱状图 / 等高线底 + 大字 / 片尾刻度尺），
  中文在 `sans` 槽位正常（引擎的字体栈里有 Noto Sans SC / 微软雅黑）。
- **成片**：`node scripts/anim.mjs video example-config-only --segments 5 --idle 300` →
  **834 帧 / 13.90s，4 块拼接，ffprobe 复核通过；282.8 MB，用时 875 秒（≈15 分钟）**。
  这就是 ROADMAP §3 第 2 条那条验收：「新建一个任务，**只编辑 `task.config.mjs`**，能出完整 mp4」。
- **整份回归**：`node tools/regress-all.mjs` → **通过 33/33 ✅ 没有真失败**（上一轮 32 项；多的那一项就是新增的
  `check:example-config-only`，其余覆盖 unit / smoke / 逐任务 check / 各探针 / determinism / 并行 / `hashes:fidus`）。

### 15.4 顺手量清楚的一件事：`kinetic` 的居中文字，长行会顶出右边（demo 里就是）

写示例时按画面调 `headline` 文案，一度以为副标也被裁了 —— **是我看错了两次**：
缩略图上"少几个字"其实是**打字机效果还没走完**（`prog(t,1.6,3.2)` 到 3.2s 才擦完整行，
t=2.6 时 26 个字符只画了 24 个）。

为了不再靠缩略图猜，这一轮留了个量具 **`out/_measure.mjs`**（ffmpeg 把 PNG 解成灰度 →
按"笔画厚度"筛掉 1–2px 的背景等高线 → 找出真的有字的列），并把可疑的那一带裁出来放大看。
结论（都是量出来的，不是估的）：

| 画面 | 文字 | 横向范围 | 结论 |
|---|---|---|---|
| `tasks/demo` 的 kinetic（t=12.5） | `都是时间的函数`（7 字，170px） | **887 → 1919**（顶到右边缘） | ⚠ **真的被裁** —— demo 这支片子本身就有这个问题 |
| `tasks/example-config-only` 的 kinetic | `不用写场景`（5 字，170px） | 883 → 1674 | ✓ 放得下 |
| 示例的副标（26px 等宽，tracking 8） | 24 个字符（打字机进行中） | 947 → 1430（≈20px/字符） | ✓ 正常，没有裁 |

根因是引擎的已知坑：`type.write` 的 `align` 是**逐字**生效的（`docs/IMPROVEMENTS.md` P1-4 记过），
所以 `align: 'center'` 不是"整行居中"，而是"每个字各自居中在自己的推进位置上" —— 整行从画面中心**往右排**。
170px × 6 字 ≈ 1900px 就是上限，**第 7 个字会被裁**（demo 那行正好 7 个字）。

→ 示例片的文案按这个限制写（`task.config.mjs` 注释里写明"每行别超过 6 个字"）。
**demo 那支的 7 字行仍然是裁的**：修它有两条路，**都会动已经出过片的画面**，所以没有单方面改 ——
① 改模板（`type.write` → `type.writeLine(..., { anchor: 'center' })`，一行的事），但要重存 `hashes` 基线并重出 demo；
② 只把 demo 的文案改短（同样改变画面）。**这条需要用户拍板。**

### 15.5 这一轮没做的（仍然开着）

| 事 | 从哪接着做 |
|---|---|
| `kinetic` 的居中文字（见 §15.4）：修模板 or 改 demo 文案 | 需要用户拍板；改模板会改变 demo/beat 画面，要重存 `hashes` 基线 |
| 模板只有 8 个（没有 `quote` / `counter` / `compare` 这类） | 往 `src/shots/` 加，照 `src/shots/title.js` 的形状并同步 `meta`（`tools/test-shots.mjs` 会守） |
| 配置档的 `post` / `world` / `maxSamples` 还没有真实用例 | 特性已通（`test-timeline-guard` 里有转发断言），但没人用过；要用就先出图看 |
| `dur: { vo }` 只能配**内联**旁白表 | 外部 `narration.json` 是页面启动后才 fetch 的，build 时还没有表 —— 想做"配置档 + 外挂旁白表"要先改这个时序 |
| `tasks/nekohome` / `fidus` / `beast` 里的重复镜头 | 都是各片特有的母题，按边界不该进 `src/shots/`；真要搬就按 §14.2 的流程（先备份原文、逐字搬、`hashes --baseline` 证明） |





---

## 16. 第九轮：`IMPROVEMENTS-3` 落地 + 渲染提速（2026-10）

> 本轮有两个来源：①`docs/IMPROVEMENTS-3.md` 的 A–F 六条建议（做 promo 时用户说"镜头像地震"查出来的）；
> ②用户要求"探索一下有没有更快的渲染方式"。①全部落地，②量出了**新的瓶颈**并且顺手把最大的一块修掉了。

### 16.1 A–F 六条：全部落地

逐条对照见 `docs/IMPROVEMENTS-3.md` §6（含"哪一条的前提是错的"）。一句话版：

| 条 | 落地物 |
|---|---|
| A（文档：抖动要是 `t` 的平滑函数） | `AGENTS.md` §4 铁律表 + `docs/ENGINE.md` §1.2 铁律表各加一行；§5 的 post 参数表各加一张"幅度→观感"表 |
| B（`handheld` 加 `mode`） | `src/core/cam.js`：默认 `'smooth'`（低频值噪声），老的逐帧白噪声搬到 `'grain'`（只给震屏/冲击） |
| C（`shakeSmooth`） | `src/core/cam.js`：参数就是幅度 + 频率，峰值校准到 `amp`，`amp=0` 返回零位移 |
| D（`post.shake` 文档） | ✅ 但**更正了前提**：实测单位是**物理像素**（不是建议里写的逻辑像素），4K 下要乘 `scale`；`post.js` 的 JSDoc 原来也写错了，一并改对 |
| E（`anim shake`） | `scripts/anim.mjs` 的 `cmdShake` + `scripts/lib/shake.mjs`：峰值/逐帧变化量/比值/分段/收尾比 + 白噪声指纹判定，退出码可判 |
| F（出片收尾守门） | 帧头 4 → **12 字节**（搭车带回 `post.shake`），`renderToFile` 收尾用同一套判据提醒（只提醒、不删产物） |

**踩到并修掉的两个坑**（都写进代码注释了）：
① 收尾判据只看比值会误报（promo 5–10s 从 0.43px 升到 1.23px，比值 1.40 但那是"呼吸"）——
现在要求**比值 > 1.25 且收尾绝对幅度 > 2.5px**，且只对跑到片尾的区间生效；
② 整片 2880 帧一次 `page.evaluate` 会把渲染进程跑崩（`Target crashed`）——
改成每批 240 帧、批间打进度与 ETA（`--batch` 可调）。

### 16.2 渲染提速：瓶颈是**每帧 new 33MB**，不是 GPU、也不是 `pow`

量法：`out/_probe/perf-breakdown.mjs` / `out/_probe/srgb-lut-check.mjs`（都是只读页面实例的探针）。
1080p 全帧、同一会话同一帧、5 次取中位数：

| 实现 | 耗时 |
|---|---|
| 旧：每帧 `new Float32Array(33MB)` + `new Uint8Array(8.3MB)` + 逐通道 `pow` | **195.0 ms** |
| 每帧分配 + 直算（循环写成 JIT 友好的形式） | 17.1 ms |
| **复用缓冲 + 直算（已落地；逐像素等价）** | **6.4 ms（30.5×）** |
| GPU blit 编码 + 8bit 回读（未落地，见 §5.6） | 5.2 ms |

分解：纯 `GL.readPixels(FLOAT)` 只要 0.1–0.2ms，`'none'`（读回+8bit）5.9ms，`'srgb'`（多一步编码）
142–197ms ⇒ **分配 + 编码循环**才是成本，GPU 回读从来不是。

**改了什么**（`src/core/gl.js`）：GL 实例持有读回缓冲并复用；热循环拆开 `encode` 分支
（`this._px*` 会让 V8 类型反馈带上 Nullable，跑不进最快档）。**数学一个字没改。**
`app.js` 的 `diff()`（跨 `await` 的两帧比较）显式复制 —— 这是复用缓冲唯一的语义变化。

**端到端**（同一命令、同一任务、同一机器）：

| 口径 | 旧 | 新 |
|---|---|---|
| `anim perf promo --from 10 --to 12 --samples 1` | 215.6 ms/帧 | **66.7 ms/帧**（3.2×） |
| `anim shot promo --from 10 --to 16 --samples 1`（真实出片 360 帧） | 95.7 s（3.8 fps） | **47.9 s（7.5 fps）** |

### 16.3 `--gpu high`：**推翻** PERF.md §2① 的"独显更慢"

那条结论量在 `readPixels` 要 195ms/帧 的年代（当时大头是跨适配器回读）。现在读回只要 6ms，
同一个 promo、`samples=1`、连续 40 帧「渲染+读回」重测：

| 场景 | 核显 | RTX 3070 | |
|---|---|---|---|
| raymarch 大厅段（t=21） | 125.4 ms/帧 | **58.3 ms/帧** | **2.15×** |
| 走廊段（t=10，轻） | 45.0 ms/帧 | 51.4 ms/帧 | 慢 14% |

所以做成**显式开关**（`--gpu high` / `--force-gpu`，`openSession` 里读，`renderParallel` 会转发），
默认仍跟系统走。`docs/PERF.md` §2① 已重写为"旧结论作废 + 新数据 + 判据"。

### 16.4 新瓶颈：把裸帧搬出浏览器只有 ~110 MB/s（探索结论）

`readPixels` 修好之后，每帧还剩 ~126ms 在渲染之外，而 ffmpeg 那一侧实测只要 **4.2 ms/帧**
（`out/_probe/pipe-cost.mjs`：vflip+bt709+x264 veryfast = 237 fps）。差额全在传输：

| 通道（7.91MB/帧） | 实测 |
|---|---|
| WebSocket（现状） | 101–115 MB/s（72–79 ms/帧） |
| HTTP POST（一帧一请求） | 24–26 MB/s ← 更慢 |
| 攒 8 帧一次 `send` | 103–115 MB/s ← 只快 1.01–1.11×，**不是消息数的问题** |
| Node→Node 的 ws（排除 Chrome） | **245 MB/s**（32 ms/帧） |
| 纯内存拷贝 | 2.3–2.6 GB/s |
| `fetch` 流式上传（1 请求 N 帧） | 本机被挡：`ERR_ALPN_NEGOTIATION_FAILED`（未取到数） |

⇒ **唯一出路是少传字节**。两条都量过、都没落地：**YUV420**（3.11MB/帧，估算 ~41ms/帧，
改动小，但色度下采样会与 ffmpeg 现有路径有细微差别）；**浏览器内编码 WebCodecs**
（H.264 实测 **27 KB/帧、314× 更小**，编码 38.7ms/帧 ⇒ ~47ms/帧，但要动整条出片流程与 `verify`）。
详见 `docs/PERF.md` §5.3–§5.6。

另：`--parallel` **需要重测**——它当年的 2.3× 来自"渲染吃满 CPU"，现在瓶颈是传输，
实测 4 进程并行 720 帧 ≈ 118s（6.1 fps）**比单进程 7.5 fps 还慢**。

### 16.5 顺手修掉：`hashes --baseline` 从"几分钟"到 8.5 秒

原来把参考帧 `[...cur]` 展开成 **830 万个数字**再经 `page.evaluate` 序列化（demo 的 11 帧基线要几分钟，
常常跑超时）。改成 base64（页面侧新增 `diffToB64`）：**11 帧 8.5s**，结论完全不变。

### 16.6 验收证据（本轮跑过）

```sh
node tools/regress-all.mjs --only unit          # 8/8 PASS（含 cam-math 的 3 条新断言）
node tools/regress-all.mjs --only colorspace    # PASS（导出 = 显示）
node tools/regress-all.mjs --only determinism   # PASS（复用缓冲没破坏确定性）
node tools/regress-all.mjs --only backpressure  # PASS（12 字节帧头在背压下正常）
node tools/regress-all.mjs --only scene-error   # PASS（场景抛错仍然是硬失败）
node scripts/anim.mjs hashes promo --baseline   # 4/4 帧 max 0 / mean 0.0000
node scripts/anim.mjs hashes demo  --baseline   # 11/11 帧 同上
node scripts/anim.mjs hashes beat  --baseline   # 11/11 帧 同上
node scripts/anim.mjs hashes fidus --baseline   # 4/4 帧 同上
node scripts/anim.mjs shot promo --from 10 --to 13 --samples 1     # 出片 ✓，收尾打印振荡守门
node scripts/anim.mjs verify promo --file out/_staging/verify_header.mp4 --from 10 --samples 1
                                                # 3/3 时刻一致（mean 2.94–4.10，判据 <18）
node scripts/anim.mjs shake promo --from 10 --to 20                # ⇒ 平滑（比值 0.05）
```

**共 30 帧画面基线全部 max 0 / mean 0.0000** ⇒ 本轮的引擎改动（复用缓冲、帧头扩容、`--gpu`）
**没有改变任何一帧**。

### 16.7 下一步（按性价比）

1. ~~**YUV420 传输**（§16.4）：预期 133 → ~41ms/帧，改动可控（GPU 转一次 + `-pix_fmt nv12`）。~~
   → ✅ **第十轮已落地，见 §17**。
2. `readPixels` 走 **GPU 编码 + 8bit 回读**：6.4 → 5.2ms，但要接受 sRGB 舍入差 1 LSB（会动基线）。
3. **PBO 异步回读**：把 5ms 藏到下一帧。
4. **WebCodecs**：收益最大（传输量 -314×），但要重做出片流程。
5. 老任务里的 `disp()/dcss()` 颜色绕行补丁（`tasks/nekohome/scenes/_kit.js` 顶部）要不要回改 —— **仍待用户拍板**。

---

## 17. 第十轮：出片推流换 **NV12**（每帧少传 62%）

### 17.0 一句话

§16.4 认准的瓶颈是**传输**（Chrome→Node 的 ws 上限 ~110MB/s，8.3MB/帧 ⇒ 72–79ms/帧），
出路只有"少传字节"。这一轮把它做掉了：**页面在 GPU 上把画面转成 NV12（YUV420）再推**，
每帧 8.29MB → **3.11MB**，ffmpeg 用 `-pix_fmt nv12` 直接吃。

**这不是新增一次画质损失**：成片本来就是 `yuv420p`，色度二次采样早就在发生 ——
变化只是"同一个 4:2:0 转换"从 ffmpeg 的 swscale 挪到 GPU，唯一实质差别是
**色度下采样的滤波器核**（2×2 盒式平均 vs swscale 的 bicubic）。

### 17.1 改了什么

| 文件 | 改动 |
|---|---|
| `src/core/gl.js` | `readNV12(rt)`：两个全屏 pass（Y 平面全分辨率 / 交错 UV 平面半分辨率，2×2 盒式平均），公式 = swscale 那套（全范围 sRGB → BT.709 limited）。复用 RT / Pass / 缓冲；`pass.noFull = true`（不参与背景守门记账） |
| `src/core/engine.js` | `readNV12()` 包装（与 `readPixels()` 并列） |
| `src/app.js` | `stream().step()` 推 NV12 而不是 RGBA（帧头仍是 12 字节） |
| `scripts/anim.mjs` | ffmpeg 输入 `-pix_fmt nv12`；**去掉** `scale=out_color_matrix=bt709`（那一步已被搬到 GPU）；`setparams` 增加 `range=limited`（**钉住**色彩标记 —— NV12 输入没有 range 元数据，不钉住编码器可能按全范围打标，播放时整片对比度就变了）；`--keep-raw` 落 NV12 |
| `tools/lib/nv12-ref.mjs` | **新增**：CPU 参考实现（与 GPU 侧同一套公式），供三个探针共用 |
| `tools/probe-nv12.mjs` | **新增量具**：GPU 的 NV12 vs CPU 参考实现，判据 ±1；已进回归清单（`probe:nv12`） |
| `tools/probe-determinism.mjs` | 判据换到 NV12 空间：**两个独立会话**各自 `--keep-raw` 后逐字节比（比原来"raw vs dumpframes"更强，两边都是同一段 GPU 编码代码） |
| `tools/probe-frame-drift.mjs` | 跟着换成 NV12 空间（RGBA 那侧过一次 CPU 参考实现） |
| `docs/PERF.md` §5.3–§5.6、`docs/ENGINE.md` §12/§12.1、`AGENTS.md` §7 | 记录落地形态、实测数字与新的量具 |

### 17.2 验收证据（都跑过）

```sh
node tools/probe-nv12.mjs _calib        # ✓ 5 个时刻：max 1 码值、差 >1 的字节 0.00%（GPU 编码 == CPU 参考实现）
node scripts/anim.mjs video _calib --from 0 --to 12 --samples 1 --noaudio -o out/_nv12test/calib12.mp4
                                        # 720 帧 / 51.7s = 13.9 fps
node scripts/anim.mjs verify _calib --file out/_nv12test/calib12.mp4 --from 0 --samples 1
                                        # ✓ 8/8 时刻一致（mean 0.00–3.19，判据 <18）
node scripts/anim.mjs shot promo --from 10 --to 16 --samples 1
                                        # ✓ 360 帧 / **29.3s（12.3 fps）** —— 与 §16 / PERF §5.2 同一条基准命令
                                        #   旧路径（RGBA 推流）同一条命令是 47.9s（7.5 fps）⇒ **1.63×**
node tools/regress-all.mjs              # ✓ **37/37**（6.9 分钟；新增 probe:nv12 一项）
```

标定夹具的**逐值**核对（`tasks/_calib/scenes/probe.js` 清已知线性色，正确显示值 188/137/225）：

| 时刻 | 线性色 | 成片解出来的 YUV → RGB | 应为 |
|---|---|---|---|
| t=0.2s | (0.5, 0.25, 0.75) | YUV(148,161,147) → **188,137,223** | 188,137,225（B 差 −2，色度 8bit 量化的正常范围） |
| t=1.0s | 0.05 | YUV(70,128,128) → **63,63,63** | 63,63,63（±0） |
| t=2.0s | 1.0（白） | YUV(235,128,128) → **255,255,255** | 255,255,255（±0）|

两条独立证据说明**没有系统性偏色**：

```sh
# ① 我们推给 ffmpeg 的 NV12 vs 成片里解出来的 NV12（编码器只该带来 ±1 级损失）
node out/_probe/check-nv12-encode.mjs   # Y max 0 / UV max 1；有符号均值 ≤0.03 码值
# ② 同一静态帧（promo t=45s，samples=8，与交付版同参数）
#    新路径跑两次 = 逐字节相同（max 0）⇒ 链条是确定的
#    新 vs 旧（交付版 promo.mp4 第 2700 帧）：Y/U/V 平均差 1.72 / 0.79 / 0.85，
#    **有符号均值 −0.06 / −0.08 / +0.02 码值 ⇒ 无偏色**，差别就是色度核 + 编码器分配抖动
node out/_probe/ab-old-new-encode.mjs out/promo/promo.mp4 out/_nv12test/promo_45.mp4 2700 0
```

### 17.3 这一轮踩到的坑（值得记）

1. **`uniform int` + `Pass` 的数字 uniform = 静默失效**：`Pass` 对数字一律走 `uniform1f`，
   而我第一版把 `mode` 写成了 `uniform int mode;` ⇒ `uniform1f` 报 INVALID_OPERATION、
   **mode 永远是 0**，两个平面都渲染成亮度面 —— 色度整片错，而**渲染、check、hashes 全看不出来**
   （它们都不走这条编码路径）。是 `probe-nv12` 第一天就抓到的（>3 的字节正好占 33.33% = UV 平面）。
   → 教训：**新的交付格式必须有独立的量具**，否则"错得整整齐齐"没人发现。
2. **色彩标记要钉住**：原来 RGBA 输入时，swscale 会把输出帧的 range 标成 limited；
   换成 NV12 输入后没有 range 元数据，不显式 `range=limited` 就可能被按全范围打标 ——
   那个错误的症状是"整片对比度变了"，而**渲染侧一切正常**。
   `ffprobe -show_entries stream=color_range,…` 现在是验收的一部分（实测 `color_range=tv`）。
3. **量具自己先错了一次**：对照脚本一开始把 NV12 与 `-pix_fmt yuv420p`（平面格式）逐字节比，
   得出"一半色度字节差 14"的假警报 —— 平面 vs 半平面布局不同，比之前必须先对齐格式。

### 17.4 老片子怎么办

**什么都不用做**：nekohome / fidus / beast / promo / demo / beat 的成片已经出过了，不会因此改变；
`hashes` 基线量的是**渲染结果**（浏览器侧 `readPixels`），也不受影响。
换的是"以后出片"的那条路。

---

## 18. 第十一轮：sodium 的画面可读性 —— 半实心积木 + 深度排序（2026-10）

### 18.0 一句话

用户看完 sodium 的反馈是「**具体的内容没问题，就是画面里各种建模可能有点杂乱，而且不清楚，
不够直观**」，并点名两处：`0:07`（一堆方块边缘叠在一起）、`0:21`（"不知道什么神秘的井字形物体"）。

这一轮**只改画面 —— 旁白、时间轴、出处行一个字都没动**（所以不用重跑 `say` / `mix`，段长与切点全不变）。
改的是 3D 那一层缺的三样东西：**前后关系、遮挡、主次**。三样都是"手写 3D"本来要调用方自己补的
（引擎第 1 类 3D 没有深度缓冲、没有 z-test、没有背面剔除，见 `src/core/cam.js` 的分类）。

验收：`check` **36/36**、`verify` **26/26**、全片 14760 帧重出（33 块，79 分钟）。

### 18.1 四个病灶（"杂乱"具体是什么）

| # | 病灶 | 根因 | 证据 |
|---|---|---|---|
| ① | **线框没有遮挡关系**，整片世界读成一只铁丝笼子 | `box3()` 把 12 条棱**全**画出来（含背面），而线段批没有深度测试 ⇒ 前后棱按"代码顺序"叠 | `0:07` |
| ② | **"井"字 = 双向排线**，镜头一拉远就脱离盒子、变成一片悬浮符号 | `hatchQuad()` 同时铺 `u`、`v` 两个方向 = 井字。**闸门的光、显卡墙背板、内存条全是同一套写法** | `0:21`；`37.96s` 那排 `#` 是显卡墙的 40 个槽位 |
| ③ | **同屏元素太多、亮度接近、没有主角** | 27 节全在 0.85/0.6 两档，眼睛不知道该看哪儿 | 全片 |
| ④ | **显卡墙不是一面墙** | 背板是 14×14 交叉网（拉远即消失），只剩 40 个 `#` 浮在空中 | `60.13s` |

`HANDOFF.md` 给的三个方案（A 拆井字+分主次 / B 深度排序+隐藏线 / C 半实体积木）**这一轮三个都做了**，
因为做完 A 出图一看，①③④ 还在，A 单独不够。

### 18.2 改了什么（几乎都在 `tasks/sodium/scenes/_world.js`）

| 改动 | 做法 | 为什么这么写 |
|---|---|---|
| **深度排序**（画家算法） | `seg3()` 不再直接写批，改成把线段连同相机空间深度 `w` 放进队列；在**下一条直接写批的线**或 `lines.flush()` 时按 `w` 从远到近排一次再写批（`q3()` / `drain()`） | 线段批没有 z-test，排序是唯一的办法。2000 条 ≈ 0.2ms；排序是纯函数，不破坏可 seek / 可并行 |
| ↑ 的**注入点** | 挂钩在 `LineBatch._push`（`seg/polyline/fillRect/…` 的唯一出口），不在 `flush` | 12 个场景都是 `begin → 3D → flush` 的固定骨架，挂钩 ⇒ **一个场景文件都不用改**。为什么不只钩 `flush`：`compact.js` 的朝向桶画在 **HUD 批里**、后面还压着一块说明牌子 —— 只钩 flush 会把那些 3D 线推到牌子**之上**，前后关系就反了 |
| **整节共用排序深度** `dw` | `drawSection()` 取节心深度，这一节的**面与棱共用它** | 不锁成同一个值的话，面心与棱中点的深度会交错 ⇒ 一节的棱被它自己的面盖掉一半（描边看着像断的）。锁上之后节内保持提交顺序（先面后棱），节间照旧按远近排 |
| **隐藏线近似** | `facesToward()`：用**面的中心**判 6 个面朝不朝镜头；`box3()` 只画"相邻两面至少一个朝镜头"的棱（12 → 9 条） | 判据用面心而不是盒心 —— 相机贴近时盒心会给出错的答案 |
| **排线改单向** | `hatchQuad()` 默认只铺一个方向（`opts.axis`），井字消失 | 这是用户点名的那一处 |
| **半实心面**（方案 C） | `hatchQuad(..., { solid: true })`：每一条排线的宽度取"它到上下相邻两条的**屏幕**间距"× 0.92，逐条算 | **透视下同一个面上的排线间距从近到远能差好几倍**，取固定世界宽度不是近端糊死就是远端留缝。逐条按自己的间距给宽度，整片才是均匀的、而且**真的挡得住背后的东西** |
| **三档明暗** | `faceTone()`：按"正对镜头的程度 + 是不是顶面 + 一盏固定的太阳"给分（正对 ≈ 0.48 / 顶面 ≈ 0.58 / 侧面 ≈ 0.29–0.39） | 固定"太阳"那一项是必需的：镜头正对 45° 时两个侧面会一样亮，盒子又糊成一块 |
| **分主次** | `alpha < 0.35` 的节**只留外框、不铺面**；棱的透明度走 `a^0.6` 而不是 `a` | 背景那 24 节压到 a≈0.34 时，线性算下来棱只有 0.2 —— 背景散成几片"玻璃板"，连盒子边界都看不出来。开方之后背景仍有 0.52（主角仍是 1.0），主次还在但轮廓立得住 |
| **显卡墙**（病灶④） | 背板改**竖向**排线成"机架"；槽位从 `#` 符号改成一个**格子**（外框 + 三条排线，点亮时填实） | 40 个 `#` 拉开看就是"神秘的井字形物体"的另一半 |
| **`hook` 两处** | 工单 **27 件 → 8 件**；闸门/显卡墙改成**跟着旁白出现**（cue 3.4 "显卡要把它重画一遍" → 显卡墙；cue 6.4 "一段一段交过去" → 闸门 + 工单流） | 27 件小方块挤在门口会叠成一团（`0:07` 就是这一团）；数量交给"三条车道 + 越堵越慢"表达 |
| **`world` 点阵** | 216 根立柱改成"**全部保留地面方框 + 只让 1/8 真的立起来**" | 216 根 16 格高的立柱同时出现就是一堵竖线墙；"这么多列"靠地面方框已经够了 |

**改了哪些文件**：`tasks/sodium/scenes/_world.js`（上面 11 条里 9 条都在这一个文件里）、
`tasks/sodium/scenes/hook.js`（工单数量 + 闸门/显卡墙的出现时机）、
`tasks/sodium/scenes/world.js`（点阵降级）、`scripts/anim.mjs`（见 §18.4.1 的基线缺陷）、
`AGENTS.md` §5.5（把"排序深度不能拿来算线宽"写进写给模型的契约）、本文件。
**一个字的旁白、时间轴、出处行都没动** —— 所以 `say` / `mix` / `timing` 全部不用重跑。

### 18.3 ⚠ 这一轮最贵的一个坑：**排序深度不能拿来算线宽**

改到一半 `check` 报 `dispatch t=49.20s` 亮度 **0.577**（这一段的其余采样点是 0.078–0.145）。
查下去是**我自己引入的**：为了让整节共用排序深度，`seg3` 把 `w` 换成了 `opts.dw`，
可这个 `w` **同时**还被用来算线宽 ——

```js
const w = opts.dw ?? (A.w + B.w) * 0.5;
const px = Math.max(minW, wWorld * depthScale(cam, w, H));   // ← depthScale = focal / max(1e-6, w) / H
```

`dispatch` 有一段镜头是**横穿世界**的（t≈44→52s，x 从 −44 走到 +44，穿过 y≈29 那一层）。
相机走在世界里面时，**身后那半边 section 的 `dw` 是负数**，而 `depthScale` 里 `max(1e-6, w)`
把负深度当成了 1e-6 ⇒ 线宽 = `wWorld × focal / 1e-6 / H` ≈ **上亿像素**的胶囊 ⇒ 几条线就把整屏糊白。

原来的代码为什么没事：`clipSegment(A, B, 0.15)` 会把端点夹到近平面，所以 `w` **恒 ≥ 0.15**，
`depthScale` 有上界。`opts.dw` 绕过了裁剪，也就绕过了那个隐含保护。

**修法**：排序用 `dw`，**线宽一律用裁剪之后的 `wSeg`**；另外给实心排线加了 420px 上限，
并加了一道"相机飞进世界 AABB 就整体收掉实心面"的闸门（`worldSolid()`，全局标量、不会一节一节地跳）。

**过程中的定量证据**（同一批时刻，逐帧平均亮度 YAVG，0–255）：

| t | 原始版本 | 坏掉时 | 修好后 |
|---|---|---|---|
| 44s | 38.7 | — | 38.2 |
| 46s | 41.9 | 91.1 | 34.4 |
| **47s** | **31.0** | **130.8** | **31.2** |
| **48s** | **30.4** | **138.9** | **30.6** |
| 50s | 66.6 | 39.2 | 30.9 |

排查过程值一提：先关 post（`bloom/halation/vignette/ca` 全 0）→ YAVG 仍 137 ⇒ 与后处理无关；
把 `solid` 排线整个关掉 → 仍 130.8 ⇒ 与半实心面无关；关掉深度排序 → 仍 130.6 ⇒ 与排序无关；
最后**换回 `out/_staging/orig/_world.js`**（改之前的原文）→ 31.0 ⇒ 确认是自己的改动，然后用
"逐帧亮度 ASCII 热力图"看出它是**整屏均匀**而不是某块区域 ⇒ 指向"一条巨大的线"。

### 18.4 验收证据

```sh
node scripts/anim.mjs check sodium     # ✓ 没有发现问题（36 个采样点 × 两条路径 + 背景守门）
node scripts/anim.mjs video sodium --samples 8 --segments 8
                                       # ✓ 14760 帧（33 块拼接，ffprobe 复核通过），4744.2s，5839.2 MB
node scripts/anim.mjs verify sodium    # ✓ 26/26 时刻一致（mean 2.13–3.11，判据 <18）
node out/_staging/make-srt.mjs         # ✓ out/sodium/sodium.srt + .ass  各 43 条
node scripts/anim.mjs hashes sodium --times 5.67,20.69,…,232.32 --save
                                       # ✓ out/sodium/hashes.json  12 帧 / 126.6 MB（覆盖全部 12 镜）
node scripts/anim.mjs hashes sodium --baseline
                                       # ✓ 12/12 帧 **max 0**（逐字节可复现）
```

### 18.4.1 顺手修掉的一个 CLI 缺陷：长片子存不了基线

这一轮想给 sodium 存一份画面基线（本仓库**不是 git 仓库**，`hashes --save/--baseline`
是唯一的"画面没变"机械证明），结果 `--every 4` 直接崩：

```
✗ RangeError: Invalid string length
    at JSON.stringify (<anonymous>)
    at cmdHashes (scripts/anim.mjs:1258)
```

根因：基线**是一个 JSON 文件**，每帧存的是"整帧像素 delta 之后的 base64"（1920×1080 约 7.9MB/帧），
而 `JSON.stringify(snap)` 要先在内存里拼出**一个字符串** —— V8 的单个字符串上限约 512MB。
sodium 246s、`--every 4` 采 62 帧，攒到第 34 帧就 369MB，直接顶爆。
**而且就算写出来也没用**：`--baseline` 那侧 `readFileSync` + `JSON.parse` 一样读不回来。

修法（`scripts/anim.mjs` 的 `cmdHashes`）：采样循环里记一个 `b64Total`，攒到 380MB 就
`die()` 并打印**这一轮真正能用的参数**（帧数 × 每帧 MB + 建议的 `--every`）。
`die()` 走 `process.exit`，而 `process.on('exit', cleanupChildren)` 会收掉子进程，所以是安全的。

于是 sodium 的基线改成"**12 个每段中间时刻**"存（`--times`，126.6 MB）——
比"均匀每 4 秒"更省，而且每一镜都盖到了。

### 18.5 这一轮学到的

| 项 | 改前 | 改后 |
|---|---|---|
| `check` 每段亮度（36 点） | 0.040–0.075 | **0.040–0.276**（更亮 = 面上有东西了，但没有过曝告警） |
| 背景守门 | 11/11 | 11/11 |
| 出片速度（`--samples 8`） | 3.2 fps | **3.04 fps**（代价 ≈5%，全片 79 分钟） |
| 成片体积（CRF 16） | 6.58 GB | 5.84 GB（面更平整，压得更省） |

出图核对：12 个中段时刻全部出图并用 Read 看过；另外单独扫了 `dispatch` 横穿世界那一段的
**逐帧亮度**（40–54s 共 13 个点），确认从 47 降到 29–47 且**连续无跳变**。

### 18.5 这一轮学到的

1. **"新加的字段"被复用到第二个用途时，要检查那个用途的定义域。** `dw` 本来只为排序而生，
   却顺着 `w` 流进了 `depthScale` —— 而那个函数对 `w ≤ 0` 没有任何防御（它只防 0）。
   同一个 `w` 变量在两个用途上语义不同（"这一节有多远" vs "这一条线段有多远"），
   写成两个名字就不会出错。**已按这个改法落地**（`dw` / `wSeg`）。
2. **亮度统计能抓"整屏糊白"，抓不到"画面杂乱"。** 这一轮两类问题各出现一次：
   糊白是 `check` 的三点采样抓到的（t=49.20 正好落在横穿那一段上 —— 差一点就漏了）；
   而"杂乱"是**只能靠人眼看图**发现的。两者都不能省。
3. **零依赖 + 手写 3D 的代价是"深度测试要自己实现"。** 这一轮做的画家算法、背面剔除、
   面填充（逐条算屏幕间距），就是 GPU 固定管线里白送的那三样东西的软件版。
   这不是引擎的 bug，是它的架构边界（`src/core/cam.js` 写在注释里）。
4. **`--only` 会把选中段平移到时间轴开头**，而 `camAt(f.t)` 用的是整片绝对时间 ⇒
   核对单镜必须用 `still sodium -t <整片绝对秒>`。这一轮全程遵守，没再踩。

### 18.6 没做的 / 留给下一轮

| 事 | 说明 |
|---|---|
| **引擎级 3D 升级（接 Three.js / 自写光栅器）** | ✅ **第十二轮做掉了**（见 §19）：走的是"Three.js 的画面当成引擎的一张图层"，不是"两支 mp4 拼接"。产品前提按用户拍板处理：`three` 直接进 `dependencies`，素材（`.glb`）这一轮**不做**（几何全部程序化） |
| 先试 **raymarch** 可能就够了 | 判据仍然是「**需不需要导入模型**」。第十二轮落地的是第 ③ 种（真网格），①②（投影线段批 / raymarch）**原样保留**：能用线段或数学式子写出来的画面，仍然优先它们（零依赖零素材）。三种的边界写在 `AGENTS.md` §5.5 与 `docs/THREE.md` §1 |
| `out/sodium/_diag_*.png`（5 张诊断帧） | 用户确认后可删 |
| `out/sodium/sodium.parts/`（33 块 ≈ 13 GB） | 成片已重出且 `verify` 过了，可以删 |
| `out/_staging/` 里的临时件 | `probe-solidity.mjs`（相机位置/worldSolid 探针）、`before/`（改前 12 张静帧）、`sheet-*.png`（前后对比接触表）、`orig/`（`_world.js` 改前原文）—— 建议留到用户确认效果之后再清 |

---

## 19. 第十二轮：Three.js 接进引擎 —— 第 3 种 3D：真网格（2026-10）

### 19.0 一句话

引擎现在有**第 3 种 3D**：Three.js 渲出来的画面作为**引擎的一张图层**进合成器，
所以后处理（泛光/颗粒/暗角/调色）、NV12 推流、`verify`、`hashes` 全部复用 ——
**不是"两支 mp4 拼接"**。沙盒 `tasks/_three-lab` 用"同一个盒子换三种画法"验收：
Three.js 分层实体 → **完全由引擎自绘的过渡镜头** → 80 个实例化单元。

### 19.1 为什么不是"各渲各的再 concat"

两边是两套 sRGB / 色调映射 / 泛光 / 颗粒实现，接缝一定看得出来，`verify` 也失去意义。
进合成器之后，接缝退化成一次普通镜头切换，而"世界不跳"那四条配方（`docs/ENGINE.md` §4.5）
一条都不用改 —— 因为 `'over'` 模式下背景**就是同一批像素**。

### 19.2 改了什么（文件）

| 文件 | 干什么 |
|---|---|
| `src/core/three-bridge.js` | **新**：桥。渲染器生命周期 / canvas→纹理上传 / 三种合成 mode / 线性色 / `project()` |
| `src/kit/three.js` | **新**：`makeThreeShot()` —— 与 `makeShot` 同形状的 Three.js 镜头骨架 |
| `src/kit/index.js` | 导出 `makeThreeShot` |
| `src/core/gl.js` | `GL.onDispose[]`：桥在 `dispose()` 时丢掉自己那个 GL 上下文（dev 下改场景不漏上下文） |
| `vite.config.mjs` | `optimizeDeps.include: ['three']`（否则 Vite 在**渲染中途**才发现新依赖 → 整页刷新 → 推流断） |
| `package.json` | `three` 进 `dependencies`（**用户拍板**：直接装，卖点口径不管了） |
| `tasks/_three-calib` | **新**：标定夹具（四象限颜色/朝向 + 线性 alpha 合成），两个 2s 段 |
| `tasks/_three-lab` | **新**：沙盒（3 段 / 14.6s / 876 帧成片） |
| `tools/probe-three.mjs` | **新**：量具（10 条判据；已进 `tools/regress-all.mjs`） |
| `docs/THREE.md` | **新**：面向写场景的人的指南（判据 / 三种背景模式 / 铁律 / 投影贴标签 / 坑清单） |
| `AGENTS.md` §3.5 §5.5 §9 §10、`docs/ENGINE.md` §3.7 §3.8 §13 附录、`docs/COOKBOOK.md` §14.3、`README.md` | 口径同步（"两种 3D"→"三种"） |
| `src/core/cam.js`、`src/core/glsl3d.js` | 注释里预留的 ③ 号槽填上了（原先写的是"本引擎没有这层，用 ① 替代"） |
| `docs/HANDOFF-THREEJS.md` | 顶部加"已落地"横幅：它是这一轮的设计档，现状以 `docs/THREE.md` / §3.8 为准 |

**没动**：`engine.js` / `post.js` / `text.js` / `timeline.js` / `tasks.js` —— 桥接完全走既有的
`Pass` + `Compositor` 那两条路。

### 19.3 最贵的坑：半透明是"在 sRGB 编码空间里预乘过"的（量出来的）

第一版按 `Layer2D` 的老办法上传（`SRGB8_ALPHA8`，硬件解码回线性），**不透明那条路完全正确**
（与 `lines` 画的同一个线性值**逐字节相同**，Δ0–1），但半透明那条路暗一档：

| | 实测 | 正确值 |
|---|---|---|
| 半透明红（α=0.5）over 线性 0.5 灰 | **161** | **225** |
| 同上 over 线性 0.25 灰 | **132** | **207** |

161/132 正好等于"画布给的 RGB 是**预乘过 alpha、而且在 sRGB 编码空间里预乘**"这一假设的预测值
（半透明红在画布上读到的是 R'≈0.5 而不是 1.0）。**硬件 sRGB 解码救不了它** ——
解码发生在乘 alpha 之后，除法补不回来。

修法：按普通 **RGBA8** 上传，在 shader 里**先反预乘（仍在编码空间）、再 `toLinear()`**，
顺序不能颠倒。修完实测 **223 / 206**（差的那 1–2 是 8bit alpha 量化，判据 ±2 内）。

> 这条是"先造一个小实验证伪"的收益：`tasks/_three-calib` 的 `alpha` 段把三种典型错误
> （预乘/直通、线性/编码空间混合）量化成了三个**互不相同**的数字，一眼就能定位是哪一种。

### 19.4 另外两处"不报错但不对"

1. **背景守门看不到引擎那一笔**：`check` 的背景守门读的是 `gl.paint.full`，而引擎为
   `world: 'auto'` 铺底发生在 `composite()` 里 **`gl.paint` 重置之前**。
   ⇒ `'over'`/`'add'` 模式的 Three.js 镜头必须**在本段自己的 render 里**再铺一次 `ctx.world`，
   否则守门会点名"这一段没铺整帧背景"（它是对的）。`makeThreeShot` 已经替作者做了。
2. **沙盒的扫描线填充一行都没画**：`fillConvex(pts, y0, y1)` 的参数是"从 y0 填到 y1"，
   我把上下沿传反了 ⇒ 循环一次都不执行，**不报错**，只是"盒子变成实体"这件事没发生。
   （同一轮还修了"图例顺序反了 ⇒ 引线交叉"这种纯设计问题。）

### 19.5 验收证据

```sh
node scripts/anim.mjs check _three-lab        # ✓ 3 段 ×3 点 ×2 路径 = 18 帧，10.5s；背景守门 2/2
node tools/probe-three.mjs                    # ✓ 10/10（四象限颜色 Δ0、引擎同色块 Δ0–1、线性 alpha Δ1–2）
node scripts/anim.mjs video _three-lab --samples 8
                                              # ✓ 876 帧 / 14.6s / 311s（2.8 fps）/ 392.9 MB（ffprobe 复核 876 帧）
node scripts/anim.mjs verify _three-lab       # ✓ 8/8 时刻一致（mean 2.10–2.40，判据 <18）
node scripts/anim.mjs determinism _three-lab --from 0 --frames 40
                                              # ✓ A 顺向 vs B 反向 40/40、B vs 只 seek 一帧 1/1
node scripts/anim.mjs hashes demo --baseline  # ✓ 11/11 max 0（引擎改动没碰老片子）
node scripts/anim.mjs hashes beat --baseline  # ✓ 11/11 max 0
node scripts/anim.mjs shake _three-lab        # ✓（video 收尾自动跑）峰值 19.78px / 逐帧变化 RMS 0.06px ⇒ 平滑
```

接缝是**看图**验的（`sheet` 接触表，A→B 与 B→C 各 8 帧）：交叠期旧画面被推走、新内容反向落位，
**背景网格一格没动** —— 这正是"三段共用一个世界原点 + 同一台摄影机 `camAt(t)` + 同一个 fov"
换来的。B 段（引擎自绘）之所以能落在 A/C 段实体的同一个像素位置上，是因为
three 的 `PerspectiveCamera` 与 `cam.js` 的 `project3()` 是**同一个公式**（`docs/ENGINE.md` §3.8.3）。

### 19.6 这一轮学到的

1. **"两边都是 WebGL2"不等于"能直接合"**：真正难的是**颜色管线的接缝**（sRGB 解码时机、
   预乘 alpha、Y 翻转），不是渲染器本身。这三件事**一个都不会报错**，只能靠量具。
2. **给新能力配一把尺子，比给它配文档更值**：`probe-three` 的 10 条判据在开发过程中
   直接指出了 R 通道差 64 —— 没有它，那个 bug 只会表现为"半透明看起来有点暗"。
3. **"引擎已有的记账/守门"是给场景作者写的，新能力必须自己适配它**：
   `paint.full`、背景守门、多子帧、任意 seek —— 这四条每一条都能把新渲染器"静默地"做错。
4. 沙盒的价值不只是"能不能跑"：这一轮真正的返工全在**画面**上（物体太满、标签压在物体上、
   signal 色用过头把 80 个单元染红），而且只有出图才看得出来 —— 与 §18 的结论一致。

### 19.7 没做的 / 留给下一轮

| 事 | 说明 |
|---|---|
| **导入模型（`.glb` / `.gltf`）** | 用户这一轮明确说**不需要**（几何全部程序化）。`setup(ctx)` 本来就是异步的，将来加 `GLTFLoader` + `tasks/<任务>/models/` 约定**不用返工** |
| 路线 B（与引擎**共用**一个 GL context） | 提案里的"快但危险"那条。现在每帧一次全屏拷贝（离线渲染无所谓），没有做的必要；要做必须先造一个"状态污染"量具 |
| three 内部的半透明混合精度 | 直接渲到画布时，three 自己的多物体半透明混合发生在**编码空间**（这是它的固有行为）。单个半透明平面不受影响；将来真要做多层玻璃，得让它渲到 sRGB render target 再上传 |
| `out/_three-lab/_three-lab.mp4`（393 MB） | 沙盒成片，留着给用户看接缝；确认后可删（`out/sodium/sodium.parts/` 那 13 GB 仍然待删） |
| 用第 ③ 种做**真片子** | 用户的方向是"需要大量可视化的科普/介绍视频"。真正开拍时建议先照 `tasks/_three-lab/scenes/_stage.js` 的写法把"舞台"（世界原点/摄影机/包围盒）钉死，再往里面填内容 |
