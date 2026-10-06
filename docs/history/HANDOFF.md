# 交接：出片管线暴露的问题

> **⚠ 本文件已过期，且已移入 `docs/history/`。** 当前状态请读 [`docs/STATUS.md`](../STATUS.md)。
>
> §1 的三条 P0、§2 的全部能力缺口，**都已经修完并验证**（包括一直被写成"已知限制"的
> 真 4K `--scale 2`）。本文件保留下来是因为**踩坑过程本身有价值**——它记录了当年的
> 排查与结论，也记录了哪些结论后来被证伪。当前状态、证据与验收命令一律以 `STATUS.md` 为准。
>
> 两处需要特别更正：
>
> 1. **§5.1 的连带影响说反了。** 它写"修好编码后 `nekohome/scenes/_kit.js` 的
>    `disp/dcss/dscale` 必须回改，否则浏览器预览会发灰"。实测正好相反：**预览一直是对的**，
>    错的是导出；那三个函数让矢量通道偏亮、Canvas2D 通道偏暗。
>    详见 `STATUS.md` §1.3 与 §8（这件事还没做，需要拍板）。
> 2. **§2.5「4K 依然不可用」已不成立。** 根因是 `LineBatch` 顶点着色器用**物理**分辨率
>    换算裁剪空间（`(p / res) * 2.0 - 1.0`），SCALE=2 时几何落错位置、片元一个都没跑到；
>    改用逻辑分辨率即可。`--scale` 已解禁。详见 `STATUS.md` §6.3。
>
> **读者**：下一个会话的 agent。
> **来源**：某一轮把 `tasks/nekohome`（NekoHome 宣传片）从零做到两版成片，过程中把引擎从
> 「能出图」推到了「能出片」，暴露出的问题按优先级记在这里。每条都给了**证据（文件:行）**、
> **复现命令**、**修法建议**和**验收标准**。
>
> 本仓库**没有 git**（`git status` 报 not a repository），所有改动就是磁盘上的文件。

---

## 0. 一句话结论

**导出的图和成片是「线性光」的，而浏览器预览是 sRGB 的 —— 两条路径不一致。**
这是本轮所有「颜色/亮度不对劲」的总根源，也是唯一一条会让**所有任务**出片偏暗的 P0。
其余两条 P0 都是**工具没能把错误暴露出来**：出片失败仍报成功、默认取样路径测不到出片路径。

---

## 1. P0：先修这三条，否则「所见即所得」不成立

### P0-1 导出缺 linear→sRGB 编码（预览与成片是两个画面）

**证据链**：

| 位置 | 事实 |
|---|---|
| `src/core/gl.js:292-294` | `blitPass` 是全仓库**唯一**做 `toSRGB()` 的地方 |
| `src/core/engine.js:362-363` | 只有 `blitPass.render(gl, null, …)` —— 目标是 `null`，即**屏幕** |
| `src/core/engine.js:508` | `readPixels() { return this.gl.readPixels(this.outRT); }` —— 读的是**编码前**的 `outRT` |
| `src/app.js:308` | `png()`（出静帧）走 `readPixels()` |
| `src/app.js:371` | `stream()`（出成片推给 ffmpeg）走 `readPixels()` |

也就是说：**预览经过 sRGB 编码，导出没有。**

**实测证据**（本轮做的标定帧）：造一个只 `gl.clear(ctx.out, [0.5, 0.25, 0.75])`、post 全零的场景，
出静帧后取像素：

```
实测导出值：128, 64, 191   ← 线性直出
若已编码应为：188, 137, 225 ← sRGB
```

**影响面**：`palette.js` 的 `hexToLinear()`、`ENGINE.md:145-148` 的「全程线性光」设计**都预设末端会编码**。
编码缺失 → 导出比预览暗一大截、暗部糊死、对比过强。所有历史成片（`demo`、`beat`）都受影响。

**修法建议**（保留 `_dumpStages` 的原始读回）：

- 方案 A（推荐）：加 `engine.readDisplayPixels()` —— 先把 `outRT` 用 `blitPass` 渲进一张离屏 RGBA8 RT，
  再 `readPixels` 那张；`png()` / `stream()` 改用它。
- 方案 B：给 `gl.readPixels(rt, { encode })` 加个开关，在 float→byte 的循环里套 `linearToSrgb`（`util.js:255`）。
- 不要直接改 `gl.readPixels(rt)` 的默认行为 —— `engine.js:499` 的 `dumpRT` 依赖原始线性值。

**验收**：上面的标定场景导出必须是 `188,137,225`；并且 `tasks/demo` 的静帧与浏览器里看到的一致。

---

### P0-2 渲染中断（断流）仍然报「✓ 出片成功」

**证据**：`scripts/anim.mjs:693` `if (frames >= total) finish();`，紧接着
`:695` `ws.on('close', () => { if (!finished) finish(); });` —— 连接一断就正常收尾；
而 `cmdVideo`（`:596-606`）虽然拿到了 `frames`，却**只检查 ffmpeg 退出码**（`:600`），
然后在 `:601` 无条件打印 `✓`，**从不比对 `frames` 与 `total`**。

**本轮实际受害**：2880 帧的任务在第 **152** 帧断流，CLI 照样打印

```
✓ out\nekohome\nekohome.mp4
  152 帧，用时 265.1s（0.6 fps 渲染速度）      ← 退出码 0
```

**触发条件**（很隐蔽）：渲染期间**改动 `tasks/` 或 `src/` 下任何文件**，CLI 的私有 Vite 服务会 HMR
重载页面 → WebSocket 断开 → 推帧提前结束 → 留下一个 2.5 秒的 mp4 并报成功。

**修法建议**：`renderToFile` 返回后加一句 `if (frames < total) die(...)`，并在提示里点名
「多半是渲染期间文件被改了（HMR 重载）或页面崩了」；成功日志也应只在帧数齐了之后才打 ✓。

**验收**：故意在渲染中途改一个文件，CLI 必须以非零码退出并说明原因。

---

### P0-3 `check` / `still` / `sheet` 默认 `samples=1`，测不到出片路径

**证据**：`scripts/anim.mjs:448`（`check` 用 `{ samples: 1 }`）、`:494`（`still` 默认 `'1'`）、
`:529`（`sheet` 默认 `'1'`）；而出片是 `:585` `opt('samples', short ? '8' : 'auto')`。

**为什么致命**：本轮修掉的那个「运动模糊整帧过曝 n 倍」的 bug **只存在于多子帧路径**
（`copyOver` 的 alpha 混合 + `avgRT` 不清零 → 反馈积分，稳态 = 均值 × n）。`check` 与 `still`
全程报「没问题」，白到发光的成片因此一路走到最后才被发现。

**修法建议**（三选一，建议全做）：

1. `check` 对每段渲染**两次**（`samples: 1` 与 `auto`），比对平均亮度；比值 > 1.3 直接判失败。
2. 加「过曝」告警：平均亮度 > 0.5，或亮度 > 0.99 的像素占比 > 20%。
3. `still` / `sheet` 的默认值改成 `auto`（或至少在 `samples=1` 时打印一句「这只是单子帧，不代表成片」）。

**验收**：把 `engine.js` 那行 `gl.clear(this.avgRT, …)` 注释掉，`check` 必须报错。

---

## 2. P1：引擎能力缺口（本轮靠任务内 `_kit.js` 绕过去的）

1. **转场没有库。** `COOKBOOK.md §8` 只有一段手写甩镜代码；本轮把「甩出去 + 拖尾 + 前景反向入场」
   写成了 `tasks/nekohome/scenes/_kit.js` 的 `transPass()/openFrame()/enterOffset()`。
   建议收进引擎（如 `src/core/trans.js`），并把下面这套「一镜到底」配方写进 `AGENTS.md`：
   > 全片**只有一层背景**（参数只由整片时间 `t` 驱动，切点两侧逐像素一致）
   > ＋ 全片**一台摄影机**（post 的 `zoom`/`shake` 由整片时间驱动，连文字矢量一起走）
   > ＋ 一个**走完全片的母题**（本轮是官网那颗跟着网格弯的指针）
   > ＋ 交叠期把上一帧**沿摄影机方向加速甩走**，前景从反方向落位。
   > ⚠ **文字量大的画面不要用交叉溶解**：两屏字叠在一起会糊，必须让旧的「走掉」。
   参考：`mexicat/pdoom-video`（`app/src/timeline.ts` **全是硬切**，靠母题 + 踩拍 + 运镜连贯）、
   `AnctyEnly453/abstract-algebra-promo`（单 canvas + cues，天生一镜到底）。

2. **没有场景级变换。** 无法把一段场景的前景（`lines` + 文字）当作**一组**平移/缩放，
   所以「同一台摄影机」只能走 post 的 `zoom`/`shake`（全帧一起动）。副作用：做不了背景/前景视差，
   前景的「同向入场」只能逐元素手加偏移。建议给 `SceneCtx` 加一个 `xform: { x, y, scale, rot }`。

3. **`post.center` 声明了但没接。** `post.js:178` 有 `uniform vec2 center`，`post.js:251` 的默认值里也有，
   但 `post.js:319-323` 的赋值清单里**没有 `center`**。结果是 zoom 永远绕画面中心，
   做不了「绕某个元素推近」的 zoom-through 转场。补一行即可。

4. **字体没有任务级入口。** 本轮为了用官网同款 Manrope，只能把 woff2 放进 `public/fonts/`
   并改**全局**的 `public/fonts/fonts.css` —— 两个任务想用不同字体就会打架，而且是全局可变状态。
   建议支持 `task.fonts: ['./fonts/x.woff2']`，或允许任务自带一份 `fonts.css`。

5. **4K 依然不可用**（`--scale 2` 被 CLI 显式拒绝）。已知 `SCALE>1` 时 `LineBatch` 光栅化不出图，
   根因未定位；用 `lines` 画的内容会在 4K 下消失。要出 4K 得先把矢量改成 `Pass`（GLSL）或 Canvas2D。

6. **渲染成本高且不能断点续渲。** 48 秒 @60fps × 24 子帧 ≈ **43 分钟**一遍；改一个镜头要整片重来。
   `--from/--to` 只能整段重渲到新文件，没有「只重渲改动过的段再拼接」。建议 CLI 加
   `video --segments`（分段渲染 + `ffmpeg concat`）。

7. **推流没有背压。** `scripts/anim.mjs:683` 的 `ff.stdin.write(...)` 不看返回值。
   1080p 一帧 RGBA = 8.3 MB，若 ffmpeg 慢于渲染，Node 侧内存无界增长。建议处理 `write()` 的返回
   并在 `drain` 前暂停 ack。

---

## 3. P2：文档与自检

- `ENGINE.md:145-148` 说「全程线性光」，但没说末端编码缺失 —— **P0-1 修好后这段才真正成立**，
  建议同时在该处补一句「导出路径也必须编码」。
- `ENGINE.md:454` **已经写了** `align` 的坑（`write` 逐字对齐，center/right 会偏），
  `ENGINE.md:449` **已经写了** `stagger=0` 时 `alpha` 不生效 —— 这两条不是新 bug，是文档已记录、
  但很容易漏读的陷阱。本轮在 `_kit.js` 里写的 `put()` / `fade()` 两个 helper 是通用绕法，值得收进引擎。
- `AGENTS.md` 只在 §5 提了 post 参数，**没有转场章节**；§10「交付前自检」建议补两条：
  1. 预览与导出各看一眼（P0-1 修好后应当一致）；
  2. `video` 之后用 `ffprobe` 核对 `nb_frames == 时长 × fps`，别只看 CLI 的 ✓。

---

## 4. 本轮**已经改掉**的东西（别重复调查）

| 改动 | 文件 | 验证方式 |
|---|---|---|
| 运动模糊求平均过曝 n 倍：求平均前清空 `avgRT`（`:346`，原因写在 `:342-345` 的注释里） | `src/core/engine.js:340-349` | `shot demo --from 1 --to 2 --samples 1` 与 `--samples 8` 平均色一致（各 26,21,20） |
| 新增 Manrope 字体声明 | `public/fonts/fonts.css`（+ `Manrope-600.woff2`） | 片子里 "NekoHome" 字标与官网同款 |

**没有改**（只是发现了）：P0-1、P0-2、P0-3、以及 §2 的全部能力缺口。

### 本轮踩到、值得记住的三个流程坑

1. **渲染期间不要碰工作区**（P0-2 的触发条件）。
2. **`check` / `still` 的结论不能代表成片**（P0-3）：多子帧路径必须单独验一次。
3. **看图不要只看自己截的帧**：出片后要从 **mp4 里抽帧**再看一眼 —— 本轮第一版成片是全白的，
   而静帧却完全正常。

---

## 5. 修 P0-1 之后的连带影响（重要，否则会白干）

1. **`tasks/nekohome` 必须回改。** 它的 `scenes/_kit.js` 里有 `disp()/dcss()/dscale()` 三个函数，
   是**专门为绕开 P0-1 写的**（把「设计稿的显示值」当成线性值喂进去，让没编码的导出看起来正确）。
   P0-1 修好后应把它们换回 `P.xxx` + `css(P.xxx)`，否则**浏览器预览会发灰**（反过来错）。
   文件头有注释说明这段历史，照着删即可。
2. **`tasks/demo` 与 `tasks/beat` 的历史成片都是线性导出的**，修好后重出会整体变亮，
   `post` 里的 `exposure` / `vignette` / `contrast` / `bloomThreshold` 可能需要重新调一轮。
3. **`tasks/nekohome` 要重新出片**（约 43 分钟），并重跑 §6 的回归。

---

## 6. 改引擎后的回归清单

```sh
node scripts/anim.mjs check demo
node scripts/anim.mjs check beat
node scripts/anim.mjs check nekohome

# ① 编码标定：0.5 灰 clear 的临时场景，导出必须是 188（现在会得到 128）
# ② 多子帧回归：两个 samples 的平均色必须一致
node scripts/anim.mjs shot demo --from 1 --to 2 --samples 1
node scripts/anim.mjs shot demo --from 1 --to 2 --samples 8
# ③ 真的用 Read 打开图看，不要只看数字
node scripts/anim.mjs still nekohome -t 3.2,19,34.5 --samples 1
# ④ 成片验收
node scripts/anim.mjs video nekohome
ffprobe -v error -show_entries format=duration -show_entries stream=nb_frames,r_frame_rate out/nekohome/nekohome.mp4
```

---

## 7. 工作区改动清单（无 git，只能靠这份清单）

- `src/core/engine.js` —— 唯一的引擎改动（avgRT 修复）
- `public/fonts/fonts.css`、`public/fonts/Manrope-600.woff2` —— 新增字体
- `tasks/nekohome/**` —— 本轮新建的任务（`FACTS.md` 记着每一句文案的出处）
- `out/nekohome/**` —— 成片与核对图（`check/trans_hero_about.png` 是转场分解图）
- `docs/HANDOFF.md` —— 本文
