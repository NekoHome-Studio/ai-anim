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
> 最后整理：**2026-10-07**。

---

## 0. 需要你拍板的（我这边定不了）

| # | 事 | 两个选项 / 代价 | 出处 |
|---|---|---|---|
| 0-1 | `tasks/nekohome/scenes/_kit.js` 顶部那三个**颜色绕行函数**（`disp()` / `dcss()` / `dscale()`）要不要回改 | **A**：改回 `P.xxx` / `css(P.xxx)` 再重出片核对（约 43 分钟 + 一次观感复核）—— 已成片会**整体略暗一点、层次回来**，而且片里大量 `dscale(P, …, 1.35)` 是照现在的观感调的；**B**：保持现状（能跑、不报错），只把注释更正为"这是历史绕行，不是设计要求" | [`history/STATUS-rounds-1-6.md` §8](history/STATUS-rounds-1-6.md) · [`STATUS.md` §16.7](STATUS.md) 第 5 条 |
| 0-2 | `tasks/sodium`（12/43 句）与 `tasks/optifine`（3/47 句）的**画面文字逐字复述旁白**要不要返工 | 清了这 15 处（外加 `lint-narration-dup --near` 报的 10 处半复述）之后 `tools/lint-narration-dup.mjs` 就能**归零**，两支片子也会顺利用上引擎字幕层（`captions: true`）。代价：重出片 ~80 分钟 + 重烧字幕。**不做也可以**：它们已交付，复述是"观感打折"不是错误 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第五轮 §8 第 1 条 · [`CAPTIONS.md`](CAPTIONS.md) |
| 0-3 | `kinetic` 模板的**居中长行会顶出右边**（demo 里就是） | **A**：修模板 —— 会让 `demo` / `beat` 的画面变化，必须重存 `hashes` 基线；**B**：只改 demo 的文案 | [`STATUS.md` §15.4 / §15.5](STATUS.md) |
| 0-4 | `tasks/nekoseek` 这支介绍片**要不要立项** | 前置分析（读完全部源码 + README，事实逐条标了出处）已完成，停在"待你拍板"；`tasks/nekoseek/` 目前没有 `task.config.mjs`，所以它不是任务 | [`tasks/nekoseek/ANALYSIS.md`](../tasks/nekoseek/ANALYSIS.md) |
| 0-5 | `src/shots/` **要不要加模板**（缺 `quote` / `counter` / `compare` 这类常见镜头） | 加的话照 `src/shots/title.js` 的形状写并同步 `meta`（`tools/test-shots.mjs` 会守住键集合）。**不加也完全能用**：需要新视觉就手写场景（C 档） | [`STATUS.md` §14.6 / §15.5](STATUS.md) · [`ROADMAP.md`](ROADMAP.md) |

---

## 1. 引擎 / 工具（已确认还开着）

| # | 事 | 从哪接着做 | 出处 |
|---|---|---|---|
| 1-1 | **`check` 增加几何自检**：随机取几个"已知应该可见"的面，验证"被铺的面 = 朝镜头的面" | 这类"不报错但画面全错"的几何 bug 目前**只能靠眼睛**（`facesToward` 反向那次出图核对了 20+ 帧才定位到）。判据可以先做成纯 JS 的（`tools/test-blocks.mjs` 已有正反用例可复用） | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **F**（⬜ 未做） |
| 1-2 | **`anim say` 的标点对齐优化**：47/47 句都命中「词级时间戳与原文有 1–8 个字符没对应」 | 现有处理（按顺序对齐 + 保住真时间戳）**是对的**，但可以把标点先从比对里排除，只有"排除标点后仍对不上"才走对齐 | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 **B**（⬜ 未做） |
| 1-3 | **产物守门失败时的措辞**：不要把 CLI 自己也修不了的原因写成"重跑即可" | 按**已知 / 未知**分开措辞 —— 拼接那一步的失败是**确定性**的，重跑没有意义（这一轮照着重跑白等了 30 秒） | [`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §1.5（原文标"未落地"） |
| 1-4 | **`_accumPass()` 在渲染成片时仍静默丢弃非有限值** | `check` 现在能扫出来（`scanNonFinite`），但 `video` 路径没有。想更早发现要在 `video` 里也开扫描 —— 每帧多一次浮点回读，**代价要先实测** | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) |
| 1-5 | **`probe-alpha` 的 `blank` 参考帧常量偏移**（读 0.10012 而不是 0.062） | 一轮没查清，两轮没动 —— **别把它当"已知正常"** | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) · §11.17.3 |
| 1-6 | **`edge-tts` 的偶发失败**：现在同一句重试 2 次 | 几百句的长旁白值得加"失败也继续、最后统一补跑"（[`history/IMPROVEMENTS-4-5.md`](history/IMPROVEMENTS-4-5.md) 第四轮 §6 A 已做了 0 字节重试，这一条是更上层的批量容错） | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) |
| 1-7 | **渲染提速的后续三档**（按性价比） | ② `readPixels` 走 GPU 编码 + 8bit 回读（6.4 → 5.2ms，但接受 sRGB 舍入差 1 LSB，**会动基线**）；③ PBO 异步回读（把 5ms 藏到下一帧）；④ WebCodecs（收益最大、传输量 −314×，但要**重做出片流程**） | [`STATUS.md` §16.7](STATUS.md) · [`PERF.md`](PERF.md) |
| 1-8 | **`dur: { vo }` 只能配内联旁白表** | 外部 `narration.json` 是页面启动后才 fetch 的，`build()` 时还没有表。想做"配置档 + 外挂旁白表"要先改这个时序 | [`STATUS.md` §15.5](STATUS.md) |
| 1-9 | **配置档的 `post` / `world` / `maxSamples` 没有真实用例** | 特性已通（`tools/test-timeline-guard.mjs` 里有转发断言），但没人用过 —— 要用就先出图看 | [`STATUS.md` §15.5](STATUS.md) |
| 1-10 | **raymarch vs 线段批的成本对照**（走廊段） | `still --samples 1` 实测 ~0.4–0.6s/帧，`check` 30 帧 19.3s；没有和线段版做过严格对照。换个实现跑 `video --dry-run` 就能对照 | [`history/STATUS-rounds-1-6.md` §13.4.8](history/STATUS-rounds-1-6.md) |

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
