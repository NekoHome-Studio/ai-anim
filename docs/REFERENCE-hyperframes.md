# 参考拆解：heygen-com/hyperframes（"Write HTML. Render video. Built for agents."）

> 拆解日期 **2026-10-10**。上游 <https://github.com/heygen-com/hyperframes>（Apache-2.0，HeyGen 出品，默认分支 `main`）。
> 由并行子代理逐文件读完原文产出（21 个 skill 里的 10 份 SKILL.md + 契约/动画/关键帧/创意/CLI/注册表/音频 references、
> `packages/lint/src/rules/` 全部规则文件、engine/producer/player/aws-lambda 的 README），
> **未改动任何本地文件**，由主代理原样归档。证据格式：`路径:行号` 指该仓库 `main` 分支对应文件；
> 行号来自实际抓取的原文。**推测**处已显式标注。
>
> **本文件只记"别人怎么做"** —— 可执行的待办一律以 [`BACKLOG.md`](BACKLOG.md) 为准（本轮新增在 **§1.B**）。
> 与另外两份的关系与横向对比见 [`REFERENCE-agent-video-projects.md`](REFERENCE-agent-video-projects.md)。

---

## 0. 一句话结论（先给）

**对 anim 最值得抄的一件事：把「lint 规则集」当成产品来做，而不是把「抛错守卫」当成产品来做。**

hyperframes 的 `check` 把「不报错但画面错」做成了可枚举、可 gate、带 fixHint 的规则（`sweep_static`、`motion_appears_late`、`motion_out_of_order`、`motion_frozen`、`caption_exit_missing_hard_kill`、`gsap_non_transform_motion`、`overlapping_gsap_tweens` …）。anim 现在有 `check`（三点亮度采样 + 背景守门）和 `hashes`（逐像素回归），但**缺的是"画面语义层"的规则**：动没动、动了顺序对不对、淡出后有没有真的杀掉、该不该用 layout 属性动。这一层比 C 档镜头库、比风格包、比云渲染都便宜、都立竿见影。

下面每一条都会回到这个判断。

---

## 1. 它到底是什么

### 1.1 组合契约：HTML 文件即时间线

一句话：**一个 composition 就是一个 HTML 文件**，DOM 上的 `data-*` 属性声明时间，一个可 seek 的动画 runtime 提供姿态，媒体播放权归框架。

最小可跑例子（`skills/hyperframes-core/references/minimal-composition.md:5-70`）：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin:0; background:#0b0f14; color:white; font-family:Inter, system-ui, sans-serif; }
      #root { position:relative; width:100%; height:100%; overflow:hidden; }
      .clip { position:absolute; inset:0; display:grid; place-items:center; }
      h1 { margin:0; font-size:96px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0"
         data-width="1920" data-height="1080" data-duration="5">
      <section id="title-card" class="clip" data-start="0" data-duration="5">
        <h1 id="title">Hello HyperFrames</h1>
      </section>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.from("#title", { y: 48, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.2);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
```

每个 `data-*` 的含义（`references/data-attributes.md:12-33`）：

| 属性 | 落在哪 | 解决什么 |
|---|---|---|
| `data-composition-id` | 根 | 这个 composition 的唯一 ID，**必须等于** `window.__timelines` 的注册键（`data-attributes.md:14`） |
| `data-width` / `data-height` | 根 | 画布像素尺寸，运行时把这两个像素值**盖到**根元素上（`SKILL.md:52`） |
| `data-duration` | 根 | 渲染时长（秒），**不是** GSAP timeline 的长度。**编译期读一次、之后脚本改不动**（`data-attributes.md:17`） |
| `data-start` | clip | **"这个元素是 clip"的唯一判据**——运行时收集 `[data-start]` 并据此驱动可见性（`data-attributes.md:41`） |
| `data-duration` | clip | clip 时长；`div` 与子合成必填，`img` 默认 3s，video/audio 默认媒体长度（`data-attributes.md:43`） |
| `data-track-index` | clip | **Studio 的显示泳道，渲染完全不读**（`data-attributes.md:44`） |
| `class="clip"` | clip | **只是约定，运行时从不读它**；但 scaffold 的 `.clip{position:absolute;inset:0}` 是场景拿到全屏盒子的来源，且 lint 会在缺失时警告（`data-attributes.md:35`） |

三条容易被忽略但**会静默出错**的语义：

1. **可见窗口是半开区间 `[start, start+duration)`**：`t = start+duration` 那一帧已经隐藏。所以动画的终态要落在 `data-duration` **之前一点**，否则最后一帧永远渲不出来（`data-attributes.md:70`）。这解释了为什么两段可以背靠背写而不会有一帧重叠。
2. **根的直接子元素自动布局**：带 `data-start` 的根级子元素被强制 `position:absolute; top:0; left:0`；**不带 `data-start` 的元素被完全跳过**——一个不带 `data-start` 的全屏背景会塌成 0 高（`data-attributes.md:72`）。这和 anim 的「`handlesTransition` 但不铺背景 → 纯黑且不报错」是同一类坑，但 hyperframes 至少把它写进了契约表。
3. 根根 `data-start="0"` 是惯例、不是必需（`minimal-composition.md:74`）。

### 1.2 渲染管线

`packages/engine/README.md:7-30` + `packages/producer/README.md:118-124`，五步：

1. **Serve** —— 起一个本地文件服务器喂 HTML
2. **Capture** —— 无头 Chrome 打开页面，用 CDP 的 `HeadlessExperimental.beginFrame` **逐帧 seek + 截图**（`engine/README.md:16`）；透明背景等场景回退到 `Page.captureScreenshot`
3. **Encode** —— 帧 pipe 给 FFmpeg（GPU 编码器探测 + 分块 concat；流式编码**不落中间 PNG**）
4. **Mix** —— 抽取 `<audio>` 元素，FFmpeg 混音
5. **Finalize** —— faststart

关键结构差异（对 anim 有用）：capture 有四种形态，`createCapturePlan` 决定用哪种——streaming / disk / segmented / HDR layered（`producer/README.md:133-140`）。**streaming 与 segmented 是"边捕边编"**，disk 是"先落盘后编码"。anim 现在分块渲染（`--segments`）走的是自己那套，思路一致但没区分"边捕边编"。

输出格式覆盖面远大于 anim：`mp4`(H.264/H.265+HDR10) / `webm`(VP9+**真 alpha** `yuva420p`) / `mov`(ProRes 4444 + `yuva444p10le`) / `png-sequence`(RGBA 无损 + `audio.aac` sidecar) / `hls`（`producer/README.md:60-68`）。**"真 alpha 而非绿幕抠像"** 是明确的设计主张，并且有 Linux 上的已知代价：BeginFrame 合成器不保 alpha，必须回退到慢的截图路径（`producer/README.md:88`）。

### 1.3 确定性怎么保证

三层，缺一层就漏：

**第一层：契约禁令**（`hyperframes-core/SKILL.md:84-92`，原文"Non-negotiable rules"）：
- 禁渲染期时钟 / 无种子 `Math.random()` / 网络 / 输入态
- `repeat: -1` 只允许在根声明了有限 `data-duration` 时使用（否则导出会被裁到那个窗口）
- 禁止对 `.clip` 元素 tween `display` / 裸 `visibility` / `autoAlpha`——框架拥有 clip 的生命周期
- 正文里禁止 `<br>`；被 transform 的元素必须是 block-level 且有尺寸；脉冲式绝对定位装饰件要按**峰值**尺寸留净空

**第二层：静态 lint**（关键一条）：`non_deterministic_code`，severity **error**。它扫 `Math.random()` / `Date.now()` / `new Date()`（仅零参）/ `performance.now()` / `crypto.getRandomValues()` / `gsap.utils.random()` / GSAP 字符串值 `"random(...)"`（`packages/lint/src/rules/core.ts`，代码串 `non_deterministic_code`）。

这里有一个**anim 应该直接抄的细节**：它扫代码前先 `stripJsComments` 再 `stripStringLiterals`。原因写在注释里——展示源码的 composition（代码片段块、PR 讲解）的字符串字面量里含 `Math.random()`，它不执行，但会把自己报成非确定性且**无法在不删掉代码片段的前提下清掉这个 error**。同时 `"random(...)"` 这一条必须扫字符串，因为那里字符串**就是**被执行的值。**"哪些匹配扫代码、哪些扫字符串"被写成了规则的一部分，而不是靠正则运气。** 这正是 anim 的 `check` 静态扫描要小心的地方（anim 铁律里列了 6 条禁令，但没说"注释里的 `Math.random` 算不算"）。

**第三层：seek 顺序安全**（这是 hyperframes 最容易被低估的一层）。渲染把帧分给多个 worker，**冷 worker 会非线性地直接 seek 进自己的区间**，而不是从 0 顺序播（`packages/lint/src/rules/gsap.ts:560-566` 原文注释："The renderer distributes frames across workers; cold render workers seek non-linearly straight into their range instead of playing sequentially from 0. Any state that depends on seek ORDER — relative tween bases, callback-measured geometry, per-init random values — renders differently per worker, visible as position jumps or dead animation at chunk boundaries."）。

由此派生出一族规则：`gsap_relative_value_second_writer`（相对值 `+=` 在另一个写者还活跃时启动，基线在 tween init 时捕获，两条 seek 路径拿到不同基线）、`gsap_repeat_refresh_relative_value`、`gsap_function_value_hazard`（函数值 tween var 在 init 时重跑，读 transform-敏感几何 → error；读 transform-不变量布局 → warning）、`gsap_callback_dom_measurement`（回调里的 DOM 测量，因为 seek 时 `suppressEvents=false`，回调每次 seek 都重放）。

**"transform-敏感" vs "transform-不变量"的切分很讲究**（`gsap.ts:574-587`）：`getBoundingClientRect` / `getComputedStyle` / `gsap.getProperty` 算敏感；`offsetWidth/Height`、`getTotalLength`、`getBBox` 算不变量。而且回调分析**故意排除 `gsap.getProperty`**——因为靠读动画值驱动派生输出（scramble text、打字机光标）的回调是逐帧确定且 seek 幂等的，在每个 worker 上渲染结果相同。这种"精确到哪个 API 算不算破例"的粒度，是 anim 的"禁累积状态"一句话给不出的。

### 1.4 许可证与商业模式边界

- 主仓 **Apache-2.0**（`README.md` 徽章；`README.md:"## License"` → `[Apache 2.0](LICENSE)`）。README 的"Why HyperFrames"明确写 **"Apache 2.0 license, with no per-render fees or commercial-use thresholds."**
- **渲染器本体免费、可分发、无商业阈值**——这是真的，不是话术。Lambda 适配器（`packages/aws-lambda`）也是开源包，adopter 自带 AWS 账号部署。
- 但有一条**商业接缝**，写得很坦白：`skills/media-use/SKILL.md` 的 BGM / SFX / image / voice 解析走 **HeyGen catalog / `heygen` CLI**，需要 OAuth 登录或 API key；有 `HEYGEN_API_BASE` 时走宿主应用代付的 key。`media-use` 里 `sfx` 有一份 19 文件的内置库可以在无凭证下回答，但 `bgm` 不行（"Without `HEYGEN_API_BASE`, `resolve --type bgm` and `--sfx` search the HeyGen catalog through the `heygen` CLI; without it they fail and say so"）。
- **云渲染三条路**：HeyGen 托管（`cloud render`）/ 自管 AWS Lambda / 自管 GCP Cloud Run（`hyperframes-cli/SKILL.md` 的 Render choices 表）。CLI 明确要求：**"Use cloud rendering when the user wants hosted rendering without local Chrome, FFmpeg, or AWS. Use Lambda only when AWS ownership is a requirement."**
- Studio（浏览器编辑面）开源（`packages/studio`），桌面 app **免费但闭源**（"The free HyperFrames desktop app adds that"），并带着一个叫 Framey 的聊天助手。
- 注册表本体：`registry` 清单托管在 `raw.githubusercontent.com/heygen-com/hyperframes/main/registry`，**搜索完全本地、无账号、不发任何东西**；约 400 个 hosted items。只有 `feedback --search-miss` 是唯一会把 query 发出去的路径，而且被刻意做成独立命令（`hyperframes-registry/SKILL.md`，"This is the only path that sends a query anywhere"）。

**判断**：这不是"开源核心 + 闭源云"的强制绑定，而是"开源渲染器 + 可选商业媒资/托管"。**anim 如果要做云渲染，商业模式上可以完全独立**，这一层没有可抄的约束。

---

## 2. 它的时间模型

### 2.1 各字段各解决什么问题

| 机制 | 解决什么 | 证据 |
|---|---|---|
| `data-start` | **"这是不是一个 clip"** 的判据本身（运行时收集 `[data-start]`） | `data-attributes.md:41` |
| `data-duration`（根） | 渲染长度 / 帧数。**编译期锁定**，脚本与 `--variables` 都改不动——要变长度就改源文件 | `data-attributes.md:17` |
| `data-duration`（clip） | clip 起止；**会从 live DOM 重读**，所以脚本/变量**可以**驱动 clip 长度 | `data-attributes.md:17` 括注 |
| `data-track-index` | **只解决"Studio 时间线怎么画"**。渲染从不读它，同一 track 允许时间重叠，前后关系由 CSS `z-index` 决定 | `tracks-and-clips.md:15-21` |
| 子合成 `data-composition-src` | 把"一个场景"变成**一个文件**：自己的尺寸、时长、timeline；宿主用绝对时间挂它 | `composition-patterns.md:10-14` 表，`:40-80` 示例 |
| 变量 `data-composition-variables` | 一次编写、多次出片：`data-var-src` / `data-var-text` **声明式替换（不需要脚本）**；每个标量变量自动落成根上的 `--{id}` CSS 自定义属性 | `variables-and-media.md:7-33` |
| framework-owned media playback | 媒体是**被框架 seek/decode** 的，不是被脚本播放的：`document.querySelectorAll("video, audio")` 扁平查询 + `closest("[data-composition-id]")` 求宿主 + 沿祖先累加绝对起点重定位 local `data-start` | `variables-and-media.md:76` |

**framework-owned media playback 解决的真问题**：如果作者写 `video.play()`，那么「预览看到的」和「逐帧 seek 渲染出来的」是两条时间轴，必然分叉。所以 hyperframes 把播放权收归框架，并**用 lint 硬堵**：`imperative_media_control`（error）——扫 `play()` / `pause()` / `currentTime =` / `muted =` 的直接调用与经变量间接调用（`packages/lint/src/rules/media.ts`，`findImperativeMediaControlFindings`）。fixHint 指向替代品：用 `data-start` / `data-duration` / `data-media-start` / `data-playback-start` 表达。

同一个思路还有 `media_runtime_src_mutation`（warning，运行时改已有媒体 src 会在预览与抽帧之间分叉）。

**`data-track-index` 这一条对 anim 是最直接的对照**：anim 的 `cut(scene, { dur, overlap, ... })` 里段与段的关系是**语义化**的（overlap = 转场），而 hyperframes 把"显示泳道"和"时间"彻底解耦，泳道纯粹是可读性。**两者取向相反：anim 用语义 DSL 换正确性，hyperframes 用原始属性换可编辑性。**

### 2.2 seek-safe 动画的判据

hyperframes 的判据**不是"每帧是 t 的纯函数"**，而是更弱的：

> **动画状态必须能从 HyperFrames 时间 seek 出来**（`determinism-rules.md:11`："The core requirement is generic: animation state must be seekable from HyperFrames time."）。

对 GSAP 的具体形态（`determinism-rules.md:13-25`）：`gsap.timeline({ paused: true })`、注册到 `window.__timelines["<composition-id>"]`、**禁止 `tl.play()`**、禁止为了凑时长建空 tween（改用 clip 的 `data-duration`）。

**它怎么防"wall-clock 动画"**，有五种不同强度的机制：

1. **注册缺失**：`missing_timeline_registry`（error）——根页面上必须有 `window.__timelines` 注册（`core.ts`）。
2. **注册时机**：`gsap_timeline_registered_before_async_build`（error）。**这是很细的一条**——在 `document.fonts.ready()` 里建 timeline 是**被支持的**，但你不能**先注册再建**：运行时把"键存在"当成"就绪"，会把一个还是空的 timeline 嵌套进去，于是这个 composition 作为子合成挂载时**永远渲染空白**（`gsap.ts:1665-1669` 注释）。
3. **键不一致**：`timeline_id_mismatch`（error）。而且行为是**部分静默**的——如果只有一个注册 timeline，键不匹配运行时**仍然会绑**；有两个以上注册时，键不匹配就把渲染**冻在 t=0**（`determinism-rules.md:21`）。
4. **离线 tween**：`gsap` 规则里对"游离于 timeline 之外的 `gsap.to()`"的围堵。`motion-principles.md` 的 "Load-Bearing GSAP Rules" 把这条列为**linter 抓不到、必须作者遵守**的一条：

   > "**Ambient pulses must attach to the seekable `tl`, never bare `gsap.to()`.** … Standalone tweens run on wallclock time and do not scrub with the capture engine, so the effect is absent in the rendered video even though it looks correct in the studio preview."

5. **CSS transition**：`css_transition_used`（warning）——"runs on the browser clock and cannot be seeked deterministically across render workers"。**而且豁免写得很精确**：`transition: none` 与**全零时间**（reduced-motion / 渲染锁的复位写法）不算，只要有一个非零时间就算（`core.ts`，`isSeekUnsafeTransition` + `hasNonZeroTime`）。anim 完全没有"CSS 过渡"这个维度（因为是 canvas/WebGL），但**"豁免要精确到全零"这个思路可以搬到 anim 的 post 参数上**。

**注意 `sweep_static` 这条 gate 的巧妙**：如果 3 秒以上的 composition 在所有采样点上都没可见变化，`check` **直接失败**（`sweep_static`）——理由是"a frame that never changes while a GSAP timeline or tween holds the same time without ever finishing means the seek is not driving the page, so it refuses to pass"。而**其他**不变化的帧只是 warning。文档还主动说出这个规则逼出来的经典陷阱和解法：

> "The classic trap is a reveal that completes early and then holds a static frame for the rest of the duration: every sample lands on the settled state and check warns that nothing on screen moved (`--strict` fails it). Spread the reveal across the timeline or keep one continuously animated element alive (a blinking caret is idiomatic for code typing) — don't bolt on a slow position drift just to appease the check."
> （`hyperframes-cli/references/lint-validate-inspect.md`）

**"别为了骗过 check 加一段慢速位移"**——这句话本身就是一个很好的 agent 技能写法。

### 2.3 与"每帧是 t 的纯函数"相比，取舍在哪

| 维度 | anim（纯函数） | hyperframes（seekable） |
|---|---|---|
| 判据强度 | **强**：`render(t)` 只依赖 t | **弱**：状态只需可从 t seek 出来；不要求无状态 |
| 状态存储 | 禁止累积状态 | 允许——GSAP 内部就是一棵有状态的 tween 树 |
| 参数插值 | 作者自己写缓动函数 | GSAP 的 ease 库现成，且 `keyframes` / labels 表达力强 |
| 帧间一致性 | 免费得到：多子帧并行求平均、运动模糊、任意 seek、随时中断重来（`AGENTS.md` §0） | **要额外防**：seek 顺序依赖成了独立 bug 族，需要一整套规则 |
| 运动模糊 | 一等公民：自适应子帧（静止 8 / 常速 24 / 甩镜 72–216） | **只有两档**：引擎的 `motionBlur` 渲染选项，或 `motion-blur` 组件（DOM 层面 N+1 份叠加副本） |
| 可预览性 | 需要自己起预览 | **`index.html` 直接能播**（"no build step"），这是它最强的可验证性优势 |
| 作者门槛 | 高：要会写 JS/GLSL，还要懂确定性 | 低：会写 HTML/CSS 就能出片 |

**取舍的本质**：hyperframes 用"HTML 能直接播"换来了作者的广度；代价是**把确定性从语言层面下移到了工具层面**——它不能像 anim 那样靠"禁 Math.random 就基本安全"，而必须逐条堵 seek 顺序类的漏洞。anim 的纯函数约束是**更便宜的正确性**，但表达力上限更低。**两者不是同一条曲线上的高低，是两条不同曲线。**

一个具体的对照：anim 的自适应运动模糊到 216 子帧；hyperframes 的 `motion-blur` 组件默认 16 子采样 + 1 份清晰本体 = 17 份副本、每帧 seek 17 次，并且文档坦白了它对"每帧位移不到一个元素宽度"的运动**不该用**——"Blur is not polish. It is the smear a real shutter leaves while the subject crosses the frame, so it only reads as correct when the subject crosses enough of the frame to have smeared. Applied to motion that was never fast enough, it reads as a soft, cheap render"（`references/motion-blur.md`）。**这段"什么时候不该用运动模糊"的判据，比 anim 现在文档里"自适应运动模糊是逐帧自适应的"更有决策价值。**

---

## 3. 21 个技能怎么组织（"一份好 agent 技能长什么样"）

### 3.1 三层结构

```
第 0 层  路由        /hyperframes           —— 强制入口，"read this first"
第 1 层  创作工作流   10 个（product-launch-video / faceless-explainer / pr-to-video /
                     embedded-captions / talking-head-recut / motion-graphics /
                     music-to-video / slideshow / general-video / remotion-to-hyperframes）
第 2 层  领域技能     9 个（core / animation / keyframes / creative / media-use /
                     cli / audio / registry / figma）
```

（`README.md` 的 Skills 三张表；加上 router 正好 21。）

**分层的关键不是"分类"，而是三件事**：

1. **router 是"能力地图 + 意图路由"，且自己不做领域工作。** `hyperframes/SKILL.md` §5 是一张"Need → Skill"表，并且显式声明 **"Domain skills never take ownership of the end-to-end deliverable. Load only what the active workflow needs."**
2. **"creator edit phrases are cross-domain requests"** —— 一句"把这段 footage 切一下"要同时加载哪些技能，被写成一张表：

   | 创作者说 | 必须加载 |
   |---|---|
   | "cut this footage" / trim / splice / reorder | `/general-video` + `/hyperframes-core`（core 拥有 `data-start`/`data-duration`/`data-media-start`） |
   | zoom in / punch-in / Ken Burns / camera move | `/general-video` + core + `/hyperframes-keyframes`（**动内层视觉/裁剪 wrapper，不动被计时的 clip**） |
   | match cut / whip pan | general-video + animation + keyframes + **registry**（先搜/装一个 transition primitive，再手写） |
3. **on-demand 加载是硬约定，不是建议。** 创建工作流**按需安装**：router 在进入某个工作流前跑 `npx hyperframes skills update <workflow-name>`；`init` 只保 core set 新鲜，**从不扩展一个部分安装**（`README.md`，"Standalone installs stay lean after that"）。

### 3.2 一份好技能文件的结构（抽出来的模板）

把 `hyperframes-core/SKILL.md`、`hyperframes-registry/SKILL.md`、`hyperframes-audio/SKILL.md`、`hyperframes-animation/rules-index.md` 放在一起对比，反复出现六个部件：

**(a) YAML frontmatter 的 `description` 就是路由契约。** 写得极长、极具体，并且包含**否定条件**：

```yaml
name: hyperframes-keyframes
description: >
  Use when a HyperFrames composition needs a punch-in, punch-out, zoom, reframe,
  Ken Burns treatment, camera move, visual match/whip handoff, or other seek-safe
  2D/3D keyframes; ...
  Don't use for broad scene strategy, brand design, media sourcing, captions, or
  general video planning.
```

`Don't use for …` 是**给路由器看的**，不是给人看的。anim 目前只有一份 `AGENTS.md` 契约，没有"什么时候不该用我"的概念。

**(b) 开篇就是"Agent pitfalls (read first)"，而不是背景介绍。** `hyperframes-core/SKILL.md:7-13` 三条，每条**带 lint 规则名**：

- 用 flex/`inset` 居中，别在随后要 GSAP `x`/`y` 的节点上用 CSS `transform: translate(-50%,-50%)`。Lint：`gsap_css_transform_conflict`。用 `fromTo` 或 `xPercent`/`yPercent`。
- 别加场景退出的 `tl.set(..., {visibility:"hidden"})`。运行时已经隐藏被计时的 clip。
- `window.__timelines["id"]` 必须匹配根 `data-composition-id`。

**"坑 → 规则名 → 正确写法"三件套**，这是最高信息密度的一种段落。

**(c) "First-pass lint gotchas (a guaranteed first build failure)"** —— 这个标题本身就是设计。它承认"你第一次构建一定会踩这些"，然后把它们**前置**：

> Rules that `lint` **does** catch, but only after the fact. Write them right the first time:

后面是 7 条"never…"。**这是把"事后报错"改写成"事前清单"**，而 lint 规则依然是权威判据。

**(d) 一条规则，一个失败模式表。** `hyperframes-keyframes/SKILL.md` 的 Error Handling 表：

| Failure | Fix |
|---|---|
| endpoint-only | add middle poses, hold peak proof, rerun `--shot` |
| identity break | keep one element alive, use shared source/final boxes, remove substitute crossfade |
| fake 3D | add z/camera travel, occlusion, angled proof |
| wrong final | add final hold, snapshot final-minus-hold and exact final |
| unseekable runtime | pause autoplay, remove timers, register the instance after the build completes |
| unreadable text | preserve line boxes, reduce displacement, add final hold, snapshot text frames |

注意左边是**诊断输出里的词**（`flat` / `keyframes` / `motionPath` / `trace` / `composed with`），右边是**可执行动作**。诊断输出与修复动作是同一份词表——**"诊断命令打印的词"和"技能教你怎么修的词"必须对齐**，否则 agent 拿到 `flat` 也不知道该干嘛。

**(e) 能力地图 / 路由表 + "读哪个文件"的精确指引。** `hyperframes-core/SKILL.md:21-33` 是一张 References 表，每行是 `文件 | 读它是为了…`；`hyperframes-animation/SKILL.md` 的 Routing 表有 20+ 行，精确到 `adapters/gsap-easing-and-stagger.md`。而 `hyperframes-cli/SKILL.md` 更狠——它有一张"**Read the matching reference before running a command**"表，并明确说：

> The following references and owning skills are **mandatory command contracts, not optional background reading.** Before running a command in the table, read its matching row.

**(f) 显式的"意图确认"层，以及"何时不要动手"。** `hyperframes-studio/SKILL.md` §0 "Talk before you build" 是一张**消息 → 动作**表：

| 对方说 | 你做 |
|---|---|
| 点名一个改动（哪怕很客气） | 做 |
| 给一个"感觉"上的反馈（"开头有点跳"） | 找原因、改可测量的那个东西、说出这个感觉指的是什么、按配方记录 |
| 问一个问题、不点名任何改动 | 回答。**什么都不改。** |
| 说别动、先放着、"就是想想" | **一个文件都不改，连顺手发现的修复也不改**。用话提出来 |

并给出这条原则的判据：

> "A message that asks a question and names a change gets the answer and the change. Only when you cannot tell whether it asks for anything is it a conversation: **a wrong answer costs one message; a wrong build costs a long run and a round of notes.**"

**这一节 anim 完全没有。** anim 的 `AGENTS.md` 是"怎么做"的契约，缺"什么时候不做"。而对于"agent 直接跑 `video` 花二十分钟"的引擎来说，这个成本对比是真实存在的。

### 3.3 目录级的具体技巧（值得直接搬）

- **`rules/` + `rules-index.md` 的两段式**：`rules-index.md` 是 21KB 的**索引**，每行是 `<rule-name path="rules/x.md">一句话内涵。Tags: …</rule-name>`。agent 先读索引挑 2–4 条，再按需读正文。**"索引足够决策，正文按需"**——比"一个巨大的规则文件"对上下文友好得多。
- **契约只写一次**：`rules-index.md` 开头"The contract — every rule assumes this"声明"每条规则都假设以下成立"，然后逐条规则**只写自己特有的 Critical Constraints**。这消除了 N 份重复的样板。
- **"能力地图"与"负面清单"成对出现**：`hyperframes-animation/rules-index.md` 有 7 大类 40+ 条原子规则；与之配对的是 `house-style.md` 的 "**Lazy Defaults to Question**"（渐变文字、卡片左侧强调条、青配深底/紫蓝渐变/霓虹、纯 `#000`/`#fff`、等大卡片栅格、全部居中）和 `typography.md` 的 "**Banned**" 字体表（Inter/Roboto/Open Sans/…/Syne，并点名 "**Syne in particular** is the most overused 'distinctive' display font. It is an instant AI design tell."）。
- **"你明知道这些规则但你还是会违反"** 的写法。`motion-principles.md` 的 Guardrails 开头原话：

  > "You know these rules but you violate them. Stop.
  > - **Don't use the same ease on every tween.** You default to `power2.out` on everything. Vary eases like you vary font weights — no more than 2 independent tweens with the same ease in a scene.
  > - **Don't use the same speed on everything.** You default to 0.4-0.5s for everything. The slowest scene should be 3× slower than the fastest.
  > - **Don't enter everything from the same direction.** You default to `y: 30, opacity: 0` on every element.
  > - **Don't use the same stagger on every scene.**
  > - **Don't start at t=0.** Offset the first animation 0.1-0.3s. Zero-delay feels like a jump cut."

  第二人称 + 点名具体的默认值（`power2.out`、0.4-0.5s、`y: 30, opacity: 0`）。**这不是"要变化"，是"你会具体地这样错"。** 对 agent 来说可执行性天差地别。
- **判据要落成数字**：`motion-principles.md` 的 "Speed communicates weight"（fast 0.15–0.3s / medium 0.3–0.5s / slow 0.5–0.8s / very slow 0.8–2.0s）；`video-composition.md` 的 web→video 尺寸对照表（headline 32-48 → 64-120px；body 14-16 → 28-42px；装饰不透明度 3-8% → 12-25%；边框 1px → 2-4px；内边距 16-32 → 60-140px）。**anim 的风格包有配色/字体/背景母题，但没有"这一档是给什么感觉用的"这种数值理由。**

---

## 4. 可借鉴点（①对方怎么做 ②anim 缺什么 ③改哪、代价 ④值不值）

### 4.1 【最高优先】镜头/效果的可复用单元与注册表

**① 对方怎么做。** 两级单元，语义清晰：

- **Block** = 独立子合成：有自己的 `data-width`/`data-height`/`data-duration`/timeline，宿主用 `data-composition-src` 挂载（`hyperframes-registry/SKILL.md`，"Blocks — standalone sub-compositions (own dimensions, duration, timeline)"）。
- **Component** = 效果片段：**没有自己的尺寸/时长**，HTML/CSS/JS 直接粘进宿主（同文件，"Components — effect snippets (no own dimensions)"）。组件模板明确规定："No `data-composition-id` or `window.__timelines` — the parent owns timing"，背景必须是 `transparent`（`references/templates.md`，Component Template）。

**元数据是 `registry-item.json`**（`references/templates.md`）：

```json
{
  "$schema": "https://hyperframes.heygen.com/schema/registry-item.json",
  "name": "BLOCKNAME",
  "type": "hyperframes:block",
  "title": "Human-Readable Title",
  "description": "One sentence: what it does and who uses it",
  "dimensions": { "width": 1920, "height": 1080 },
  "duration": 10,
  "tags": ["category", "subcategory"],
  "files": [{ "path": "BLOCKNAME.html",
              "target": "compositions/BLOCKNAME.html",
              "type": "hyperframes:composition" }]
}
```

component 变体就是**去掉 `dimensions` 和 `duration`**，`type` 换 `hyperframes:component`，`files[].type` 换 `hyperframes:snippet`。

**怎么发现**：`hyperframes catalog --query "<用大白话描述的节拍>"`。搜索**完全本地、无账号、不发 query**（`hyperframes-registry/SKILL.md`，"Search is local and sends nothing"）。词法层免费；语义层需要一次性 ~33MB 量化 ONNX 模型下载（`bge-small-en-v1.5`），并且**要求用户明确同意**——"Offer the offline tier; never enable it silently"。查询必须用英文，因为索引是英文的（"Always query in English, whatever language the video is in"），并且有一个专门的报错 "No searchable words in query" 来解释这不是缺组件。

**装**：`hyperframes add <name>`（按名字精确匹配优先，否则按 tag 装全部同 tag 的 block；依赖先装）。装完 CLI 打印**粘进宿主的片段**。

**命名与冲突防护是硬要求**：`references/contributing.md` 规定每个 block 用 2-3 字母 ID 前缀（`cap-hormozi` → `hz`：`hz-cg-0`、`hz-cw-3`），理由是"ALL element IDs must use this prefix to avoid collisions in sub-compositions"。另外还有一个很实用的约束：block 里脚本拼出来的资源路径必须走 `__hyperframes.assetUrl("assets/...")`，因为"Attributes like `src` and `href` are rebased when the block is mounted; strings in a script are not, so a bare `"assets/..."` 404s once the block lives under `compositions/<name>/`"。

**贡献门槛是明码的**：idea → scaffold → build → validate → preview → ship，其中 validate 是 `lint` 0 error + `check --no-contrast` 0 console error，ship 前必须跑 `scripts/generate-registry-items.ts` 重新生成 `registry/registry.json`，并警告"**Do not hand-edit it**: an entry added by hand survives until the next regeneration and then vanishes"。

**② anim 缺什么。** anim 有 `src/shots/` 八个模板（`title chart kinetic whip outro wave pulse grid`），但：

- **硬编码在仓库里**，`shots` 命令只能**查参数**（`node scripts/anim.mjs shots chart`），不能装新的。
- **没有元数据契约**。`SHOTS` 的键就是模板名，参数名写错会抛错（这是个好基础），但没有 `title` / `description` / `tags` / `dimensions` / `duration` 这类可检索、可展示、可校验的字段。
- **没有"片段 vs 独立单元"的两级区分**。anim 的 `src/kit/` 里有 `panel` / `kicker` / `footer` / `reticle` / `marker` / `codeRow` 这些**片段级**的工具——但它们只能在场景代码里 `import`，**不能粘进配置档**，也没有被发现机制。
- **没有发现命令**。只有 `shots [名字]`（枚举 + 参数）。没有"按意图搜"。

**③ 搬过来要改哪里、代价多大。** 性价比最高的一条，而且 anim 的架构比 hyperframes 更利于做这件事，因为 anim 的 `shot(type, params)` 已经是一个**闭合的、可校验的接口**。

具体设计（推测部分标注）：

- **元数据**：给每个 `src/shots/*.js` 加一个同目录的 `shot.meta.json`，字段直接映射 hyperframes 的：
  ```
  { name, kind: "shot" | "effect", title, description, tags: [...],
    params: { … 现有默认值，机器可读 … }, defaults: {...}, requiresAudio: bool,
    handlesTransition: bool, duration: { default, min, max } }
  ```
  **`params` 这一条是关键**：anim 现在参数表是**运行时反射**出来的（`src/shots/index.js` 列可用参数），所以它只能报错，不能被搜索、不能被 diff、不能生成文档。
- **两级单元**：把 `src/kit/elements.js` 的 `panel`/`kicker`/`footer`/`reticle`/`marker`/`codeRow` 提升为 **effect**（无时长、无独立画面、由 `post` 或 `draw` 内联调用），把 `src/shots/` 的 8 个保持为 **shot**（有 `dur` 语义、可进时间线）。判据可以直接抄 hyperframes：**"own dimensions, duration, timeline" → shot；否则 → effect**。
- **注册表形态**：一个 `registry/` 目录 + 一个 `registry.json`（生成物，不手改），每项 `{name, kind, version, tags, files[], integrity}`。CLI 加两条命令：
  - `anim catalog [--query "…"] [--tag …] [--json]` —— 枚举/过滤。**先只做词法层**（name/title/description/tags 的词重合），语义层（向量检索）先不做——那需要模型下载，收益/成本比不划算。
  - `anim add <name|tag> [--dir .]` —— 装到 `tasks/<任务>/extras/` 或全局 `shots-ext/`，并打印该粘的配置档节点。
- **发现路径**：`tasks/<任务>/task.config.mjs` 的 `type` 解析顺序改成 `[内置 SHOTS] → [任务本地 extras] → [全局安装的包]`；重名**报错**（不静默覆盖），并列出两个来源。这与 anim 现有"参数名写错会抛错"的哲学一致。
- **命名冲突防护**：直接抄"2-3 字母前缀"约定。anim 的 effect 会往 `lines`/`text` 批里画东西、可能往 `ctx.warnings` 里写，所以**前缀要落在 warning 来源和 HUD 段名上**。
- **校验**：新命令 `anim check-shots`（或并入 `check`）：对每个已安装单元——参数表完整性、`handlesTransition` 是否真的铺了整帧背景、是否遵守确定性铁律（用现成的 `tools/scene-harness.mjs` 假 ctx 跑一遍）、`dur` 的 min/max 是否可满足。

**代价**：中等偏小。不需要动引擎，主要是 `src/shots/index.js` 的解析顺序 + 一个新的 `scripts/lib/registry.mjs` + 元数据文件。**风险点是 `--only` / HUD / 报错里用的段名**——外部单元的段名可能撞车，要沿用 anim 现在"重名自动加 `_2`"的规则还是改成报错，需要定一个。

**④ 值不值：值。而且这是唯一能把 anim 从"一个仓库"变成"一个生态"的动作。** 8 个硬编码模板是"够用"，不是"够长"——每支新片子只要出现一次"模板覆盖不到的视觉"（`AGENTS.md` §3.2 明确说"要新视觉就回手写场景"），那个视觉的**复用价值就被丢掉了**。hyperframes 的 `registry` + `catalog` + `add` 正是为了解决这一条，而且它的元数据契约足够薄，可以照抄。

**但有个反面教训要一起抄**：hyperframes 的 registry 是**托管清单 + 每次安装都联网取文件**（"Only manifests are cached; the item's actual files are fetched on every install"），所以"离线能搜，不能装"。anim 如果要**离线可用的包**，应该做成"装在仓库里/用户目录里的目录 + 一个本地生成的索引"，而不是"拉远端清单"。这反而更简单。

---

### 4.2 【最高优先】lint 与自检的规则集

**① 对方怎么做。** 规则分 10 组共约 86 条（`packages/lint/src/hyperframeLinter.ts` 的 `RULE_GROUPS` + 原注释 "naming all 86 of them is a refactor this measurement does not need"，`LINT_RULE_COUNT` 是导出量）。组：core / media / gsap / captions / composition / adapters / textures / fonts / slideshow / structure。

**逐条读出来、并且是 anim 完全没有的"防难看/防错"规则**（按价值排序）：

| 规则码 | severity | 检查什么 | 为什么 anim 需要 |
|---|---|---|---|
| `sweep_static` | **error** | 3s+ 的 composition 在所有采样点上都没有可见变化 → 拒绝通过。**指纹包含每元素 opacity**，所以纯 opacity 的揭示（打字、错峰淡入）**算运动**——但只在采样时刻它还在飞行中才算 | anim 的 `check` 只量**亮度**，一个"全黑/全静止/什么都没动"的段和"画了但没动"的段区分不开 |
| `motion_appears_late` | error | `*.motion.json` 断言 `appearsBy(selector, bySec)`：某元素到 `bySec` 还没到 opacity ≥ 0.5 | anim 完全没有"断言某物该在何时出现"的机制 |
| `motion_out_of_order` | error | `before(a, b)`：`a` 首次出现**不严格早于** `b` | 叙事顺序错（先出结论后出前提）现在只能靠人看 |
| `motion_off_frame` | error | `staysInFrame(selector)`：元素一旦可见，其盒子离开画布 | anim 的 `check` 有"段内亮度不均"，但没有"某个元素飘出去了" |
| `motion_frozen` | error | `keepsMoving(withinSelector?)`：一个完全静止的窗口超过 `maxStaticSec`（默认 2s） | 同上 |
| `motion_selector_missing` | error | 选择器匹配不到任何东西 → **响亮失败**，不是静默通过 | anim 的 `--only` 名字写错会报错，但"断言写错"这个概念还没有 |
| `overlapping_gsap_tweens` | warning | 同一元素、同一属性、时间重叠的两个 tween（且没有 `overwrite:"auto"`） | anim 没有"两段同帧写同一个量"的概念——但它有等价物：**同一交叠期两个场景都画背景/都设 post** |
| `gsap_animates_clip_element` | error | 对被计时的 clip 元素 tween `display`/裸 `visibility`/`autoAlpha` | anim 的对应物是"声明了 `handlesTransition` 但不铺整帧背景"——已有 `check` 守门，但规则面窄得多 |
| `runtime_hidden_style_opacity` | error | CSS 选择器观察框架拥有的 hidden 内联样式并强制 `opacity:0` | 极具体，但体现了一种意识：**框架写的内联样式不能被作者的 CSS "误伤"** |
| `caption_exit_missing_hard_kill` | **error** | caption 的退出 `tl.to(..., {opacity:0})` 后**没有**零时长 `tl.set(..., {opacity:0, visibility:"hidden"})`，因为 karaoke 的逐词 tween 可能冲突，导致字幕**卡在屏幕上** | anim 的字幕层是引擎级的（`captions: true`），所以这条不直接适用；但**"退出动画需要一次确定性的硬杀"**这个模式适用于 anim 的**画面文字**：`type.write` 的 stagger 退出若被后一段覆盖会残留 |
| `caption_overflow_clips_scaled_words` | error | caption 容器有 `overflow:hidden` 而 GSAP 把 caption 词放大超过 1.0x → 强调词和发光被裁 | 这条**纠正了它自己另一条规则的 fixHint**——`caption_text_overflow_risk` 的注释原文："Deliberately does NOT say `overflow: hidden`: … Recommending it here made this warning's own fix produce an error." |
| `caption_fittext_scale_mismatch` | warning | `fitTextFontSize({maxWidth: N})` × 最大 `scale` 超过 1920−margins → 提示把 `maxWidth` 降到 `floor(1700/maxScale)` | **"数字要留头寸"的自动化** |
| `gsap_non_transform_motion` | **error** | tween 了 `left/right/top/bottom/margin*`、或 `letterSpacing`/`wordSpacing`/`fontSize`、或用 `roundProps` | **在逐帧 seek 的 capture 引擎上，慢速运动或 ease-out 尾部会整数像素吸附 → 一顿一顿**。这条对 anim **完全适用且 anim 没有**：anim 的场景里如果拿 `Math.floor(x)` 或整数量化去算位置，同样会顿 |
| `css_transition_used` | warning | CSS `transition` 跑在浏览器时钟上，跨 worker 不可 seek（**全零时间豁免**） | anim 没有 CSS 层，但"豁免要精确"可搬 |
| `gsap_fullscreen_overlay_starts_visible` | error | 全屏不透明遮罩一开始就是可见的 → 会把整片盖住 | **anim 的"背景守门"的更强版本**（anim 只查"没铺背景=纯黑"，没查"铺了一个盖住一切的东西"） |
| `gsap_from_opacity_noop` | error | CSS/内联样式里已经有 `opacity:0`，再写 `gsap.from({opacity:0})` → 无效 | 典型的"看起来对但不生效" |
| `gsap_cold_seek_hidden_fromto_missing_reveal` | error | 元素作者态是隐藏的，但目标态省略了 opacity → **顺序 seek 时正常，冷 worker 恢复作者态后永久不可见** | 这一族（cold seek）是 anim 的强项、hyperframes 的弱项，**不需要抄** |
| `non_deterministic_code` | error | 见 §1.3 | anim 的 `check` 已经扫 `Math.random`，**但没有"扫字符串还是扫代码"的区分** |
| 布局审计组 | error/warning | 文字超出容器/超出画布、被自己的盒子裁掉、**保持型**文字重叠与遮挡、子元素逃出裁剪容器 | anim 没有 DOM 盒子，**这层不能抄**（见 §5） |
| 对比度审计 | **error** | WCAG AA，5 个网格点采样，每个 finding 带**采样到的 fg/bg 颜色、实测 vs 要求比值、以及同色系方向上最近的合规颜色** | **这条对 anim 可以直接搬，而且 anim 更该有**：anim 的风格包定义了调色板，但没有任何东西校验"这一段画的文字/线条在实测背景上对比度够不够" |
| `canvas_content_at_edge` | warning | canvas 的像素在帧边缘出现锐利内容（画的文字、硬形状） | **anim 全是 canvas！** 这条几乎是给 anim 写的 |
| `unbalanced_style_tags` / `visible_markup_comment` / `unclosed_tag_swallowed_element` | error | 结构类 | 不适用 |

**"严重性是持久性感知的"**（`lint-validate-inspect.md`）：

> "**Severity is persistence-aware.** A dynamic issue observed at a single grid sample (an entrance/exit transient) demotes to info and never gates. Issues held across samples gate the exit code, a held `content_overlap` is an error, and a held, partially-visible `canvas_overflow` breaching ≥5% of the canvas promotes to warning."

**这一条极其重要。** 它解决了"入场瞬间本来就该重叠/超出，凭什么报错"的根本问题——**不是靠作者写豁免，而是靠"跨采样点是否保持"自动降级**。anim 的 `check` 已经是"每段采 15%/50%/85% 三个点"，**基础设施已经有了**，只差把"三点是否一致"从亮度扩展到别的量。

**另一条极重要的设计**：`check` 的 `--json` 信封里有一个 `browserSkipped: true`。当浏览器从未跑起来（lint error / linter 崩了 / 浏览器启动失败）时，`layout`、`motion`、`contrast` 三个 section 是**空的，而不是干净的**：

> "When the browser never ran (lint errors, a linter crash, or a browser launch failure), `browserSkipped` is `true` and the `layout`, `motion` and `contrast` sections are empty, not clean."

并且明确指出 lint error 会**关掉**布局与对比度审计，于是 `check` 报 `0 sample(s)` / `0/0 text checks`，"which reads like a clean file but means nothing ran"。**"空 ≠ 干净"是 anim 的 `check` 现在最大的语义漏洞**：如果某段试渲染失败，anim 会怎么报？如果只是少一行输出，agent 就会当成通过。

**② anim 缺什么。** 已有：静态扫描（禁写法的守卫，"写错就抛"）、逐段试渲染、三点亮度、背景守门、`verify`（成片抽帧 vs 重渲逐像素）、`hashes`（回归基线）、`shake`（抖动体检）。缺的是：

1. **"动没动"的判据**（对应 `sweep_static` / `motion_frozen`）。一个静止但画面正确的段落能过；一个本该动却冻住的段也能过。
2. **"按顺序动"的判据**（`motion_appears_late` / `motion_out_of_order`）。**这是最便宜、最高价值的一条**：anim 已经有 `still` / `sheet`，把它升级成"带断言的 sheet"就是 `*.motion.json` 的等价物。
3. **"跨采样点保持才 gate"的严重性模型**。anim 现在只有"报错就 exit 1"。入场瞬态该不该 gate，需要这个模型。
4. **"空 ≠ 干净"**（`browserSkipped` 语义）。
5. **画面语义层**：`canvas_content_at_edge`（帧边缘有硬内容，即"元素出画"）、对比度（WCAG + 建议色）、`gsap_fullscreen_overlay_starts_visible`（有个东西盖住了一切）。
6. **慢速运动整数吸附**（`gsap_non_transform_motion` 的 anim 版）。
7. **"fixHint 不能和另一条规则打架"的元规则**。

**③ 搬过来要改哪里、代价多大。**

- **最小可用版本（1–2 天量级）**：给 anim 加一个 `tasks/<任务>/motion.json`（或直接写进 `task.config.mjs`），格式照抄：
  ```json
  { "assertions": [
      { "kind": "appearsBy", "only": "title", "bySec": 0.5 },
      { "kind": "before", "a": "chart", "b": "outro" },
      { "kind": "keepsMoving", "only": "wave", "maxStaticSec": 2 }
  ] }
  ```
  实现落在 `check` 里：它已经在逐段试渲染了，只要**每段多点采样 + 记录段级统计量**就能判。`appearsBy` 对 anim 的对应物不是 opacity ≥ 0.5，而是**"该段画面与纯背景的差异超过阈值"**（anim 已有背景守门，用的就是这套差值）。
- **`sweep_static` 的 anim 版**：`keepsMoving` 需要"画面变化"的度量。anim 已有 `shake` 的逐帧统计（`scripts/lib/shake.mjs`，纯函数，逐帧变化量 vs 幅度）。**把 `shake` 从"只看 post.shake"扩成"看整帧"**，就能得到"这一段的帧间变化量"。代价：`check` 要多渲几个采样点（现在是 3 个点×单/多子帧两条路径），加运动检测需要**相邻帧**而不是孤立点——所以真正的代价是**试渲染时间翻倍左右**。
- **`motion_off_frame` 的 anim 版**：`canvas_content_at_edge` 要求"画布边缘出现锐利内容"。anim 可以更便宜：在 `check` 的采样帧上量**边缘 N 像素的平均梯度**，超过阈值就报"有元素出画/压到帧边"。这条能防住"文字排到 1900px 处被切半个字"。
- **对比度的 anim 版**：anim 的文字是画进 `text` 图层的，没有 DOM 盒子。但 anim **知道**自己画了什么文字和什么颜色（`type.write` 有 `color`，`P` 有调色板），也**能读到**采样帧。所以可以做：**在采样帧上，对文字 bbox 内的前景/背景做两簇聚类，算对比度**。代价：需要一个"文字 bbox"的来源——`text` 图层是 Canvas2D，引擎可以顺带记下这一帧画的文字盒子（如果还没记）。**这是一条需要动引擎的规则，代价中等。**
- **严重性模型**：`check` 的 report 结构加 `persistence: 'held' | 'transient'`，`transient` 不进 exit code，但在输出里保留。**改动很小。**
- **"空 ≠ 干净"**：`check` 的返回结构加一个 `skipped` 字段列出哪些审计没跑。**改动极小，收益极大。**

**④ 值不值：最值。** 理由有三：

1. **它防的是 anim 最贵的一类失败。** anim 的失败模式不是"报错"，是 `AGENTS.md` §4 标题写的那句——"**违反会导致成片随机出错，而且通常不报错**"。hyperframes 的 `sweep_static` / `motion_frozen` / `caption_exit_missing_hard_kill` 全都在补这个洞。
2. **它复用 anim 已有的基础设施。** `check` 已经逐段试渲染、已经三点采样、已经有 `ctx.warnings` 通道、已经有 `shake` 的逐帧统计函数。**不是从零建。**
3. **它改变 agent 的行为，而且不需要 agent 更聪明。** 现在 agent 拿到"check 通过"就走了；如果 check 能说"第 3 段从 4.2s 到 6.0s 没有任何变化"，agent 自己就会去修。

---

### 4.3 设计系统 → 视频的翻译层（frame.md / 数字来自脚本）

**① 对方怎么做。** `frame.md` 是**面向"帧"重写的设计系统**，与 `design.md`（面向 web/静态页）同格式但换单位：

> "`frame.md` is the **frame-scale design system** for a video / hyperframes project — the video-first companion to `design.md` (which is written for web / static pages). Same file format as `design.md`; it reframes the brand with the frame as the unit."（`design-spec.md`）

**解析优先级是硬编码的**：`frame.md` → `design.md` → `DESIGN.md`，**读第一个存在的，忽略其余**（`design-spec.md`）。

**两层不对称**，这条是关键：

> "**Frontmatter is the normative layer** — `colors`, `typography`, `spacing`, `components` are the real, machine-readable values. **Quote them verbatim** (exact hex, font family, weight); never invent or round them.
> **Prose is context** — the `##` sections … carry intent, when-to-use, and constraints the tokens can't hold. Read them for judgment, not for values."

**README 的那句口号拆开**：

> "The output is a `DESIGN.md` superset your whole toolchain can read. **Atoms stay sacred. Composition stays free. Numbers come from the script.**"

- **Atoms stay sacred** = 前端 frontmatter 的 token（hex、字体族、字重关系、Do's/Don'ts）**不许动**。`video-composition.md` 的 "The Design Spec Is Brand, Not Layout" 原文把边界画得很清：*"**Strict from the design spec:** hex values (including background color), font families, weight relationships, Do's and Don'ts. … **Adapt for video:** type sizes, spacing, decorative opacity, border weight, component treatments. A web UI card at `border: 1px solid #e2e3e6` with `box-shadow: 0 2px 4px rgba(0,0,0,0.06)` is invisible on video. **The brand color is sacred; the application is yours.**"*
- **Composition stays free** = 版面/构图不归设计系统管。
- **Numbers come from the script** —— 最值得单独抄的一条。在 `frame-presets/cobalt-grid/FRAME.md` 里，它落成一条**硬规则**，标题就是 "Numerals & Claims (hard rule)"：

  > "**Never invent figures, deltas, dates, or signal counts at frame scale.** Render slots as `— figure —`, `{metric}`, `↑ —`. Pixel-stack bar heights and ledger deltas especially carry placeholders until the script supplies values. Mono catalogue ordinals (001, 002…) are decorative and may be sequential."

  并且在前面的 Data Frame 条目里，`Fixed` 里写「pixel-stack cells / cobalt baseline / mono ticks」，`Free` 里写「**bar values (from script)**」。
  最后它还有一条 **Pre-Render Self-Audit**，把这件事变成可检查项：*"**Fabrication** — every numeral/delta traces to the script, else placeholder."*

**单位系统**：display 全部用 `cqw`（`px ÷ 1920 × 100`），并且有一条"容器法"："Every frame ground sets `container-type: size` AND carries the graph-paper `background-image`; ALL frame-relative units are `cqw`/`cqh` against it — never `vw`."——**这让同一份 frame.md 在 16:9 / 9:16 / 1:1 之间可迁移**，每个 treatment 有明确的 Aspect-Ratio Behavior 表。

**尺度是量化的、带理由的**：`typography` 里每个角色是 `{fontFamily, cqw, weight, lineHeight, tracking}`，从 `body: 0.83cqw` 到 `vbig-numeral: 12.5cqw`；还有一条 fit-to-measure 的规则："size the headline to its line length. Cap the block at **≤ 78cqw**; ≤3 words → `display-hero`/`vbig-numeral`; 4–6 → `display-chapter`; 7+ → `headline`."——**词数直接映射到字号档位**。

**Do/Don't 与"取景框测试"**：Frame Craft Bar 是三个目测门——Squint（一个元素占主导，是最近邻的 3–6 倍，层级靠字号不靠字重）、Silence（陈述型帧 45–60% 空）、Restraint（严格双色）。而且给了**失败长什么样**："failure looks like a **colorful dashboard with a second accent hue**"。Known Gaps 里还诚实标注"Motion intentionally out of scope"。

**② anim 缺什么。** anim 有 `src/style/`（style pack，一行 `style: 'paper'` 换整片观感）+ `docs/STYLE.md`。**比 frame.md 少的是**：

- **没有"机器可读的 token 层"**。style pack 是 JS 对象（配色/字体栈/背景母题/后处理基线/版面栅格/字幕样式）。它是**代码**，但没有被文档化为"这一层是 normative、引它必须逐字、不许四舍五入"。
- **没有 `cqw` 式的相对单位**。anim 的渲染分辨率靠 `scale 1..4`，坐标是逻辑像素（1920×1080 基准）。文档里有"shader 里别拿物理像素当逻辑像素用"和"`shake` 的单位是物理像素，`--scale 2` 下视觉位移减半"——**这正是缺少相对单位导致的漏**。frame.md 的 `cqw` 从设计层面消除了这一整类 bug。
- **没有"数字来自脚本"这条硬规则的自动化**。anim 有 `docs/FACTS-TEMPLATE.md` 和"对外材料里，真 logo / 真截图通常比手画一个更像"，但**没有"画面上的数字必须有出处，没有就画占位符"**这条。**"Never invent figures" 对 anim 这种"画面全靠代码算"的引擎尤其重要**——编一个数字的成本是零，所以更容易发生。
- **没有字号档位 ← 词数/行长 的映射**。
- **没有 aspect-ratio 迁移表**。

**③ 搬过来要改哪里、代价多大。**

- **把 style pack 的 token 层"提"出来，加一条 normative 声明**。代价极小：`src/style/index.js` 已经是集中定义，只要在 `docs/STYLE.md` 里加一节"以下字段是 normative，引用必须逐字；其余是实现细节"。**但这一条的意义不在文档，在于让新的 check 规则有权威判据。**
- **加单位换算层**：anim 是 1920×1080 逻辑像素基准。加 `cqw(x) = x/1920*100` 是**纯数学**，但真正的收益是**让 `scale 2/4` 下的物理像素坑消失**（`shake`、`grainScale`、字体光栅化）。代价：低。值：中——anim 的推荐做法已经是"只写逻辑像素、引擎处理 scale"，这条更像是**把这个约定文档化 + 加一条 check**（"场景里出现 1920/1080 硬编码的乘法"就警告）。
- **加"数字出处"规则**（最高价值的一条）。设计：
  - `task.config.mjs` 或 `tasks/<任务>/FACTS.md`（**anim 已有这个文件！** `AGENTS.md` §10 第 6 条要求"代表某个团队/项目对外发声的片子：`FACTS.md` 逐句标了出处"）。
  - 新命令 `node tools/lint-fabricated-numbers.mjs <任务>`：扫场景代码里**字面量数字**出现在"数值显示"位置（`type.write` 的字符串里、`chart` 模板的 `values`、`codeRow` 的文本），逐个去 FACTS.md / 一个显式的 `figures: {}` 表里查出处。没有出处 → 报 `file:line` 并要求改占位符。
  - 代价：**这个比 hyperframes 那条难**，因为 hyperframes 的对应物是"frame.md 里写死的一条 Do/Don't + 一份自检清单"，**根本没有自动化**——它是靠**阅读 + 自检**。所以 anim 的诚实做法是：**先抄成规则文本 + 交付前自检项**（写进 `AGENTS.md` §10 和 `docs/FACTS-TEMPLATE.md`），自动化放后面。
- **加字号档位表**：在 style pack 里给每个风格定义 3–4 档 display 字号（配 `cqw` 或逻辑像素）、以及"≤3 词 / 4–6 词 / 7+ 词"的映射。代价：**低**。值：中高——它让 `type.writeLine` 的 `size` 不再靠 agent 猜。
- **加竖屏/方屏的 aspect 表**：anim 现在 `width`/`height` 是任务配置字段，技术上可行，但没有"每个镜头在 9:16 下怎么办"的指导。**这是产品范围问题，不建议直接抄 13 个 preset 的完整 aspect 表。建议只抄格式。**

**④ 值不值。** 分三档：

- **"数字来自脚本" → 值，而且最值。** 一条**低成本、高伤害面**的规则：一个编造的数字进了对外材料，代价远大于一支片子难看。anim 已有 `FACTS.md` 和 `FACTS-TEMPLATE.md`，**基础设施在，只差把它变成画面上的强制约束。**
- **normative vs context 的二分 → 值。** 它让"引 token"和"改实现"变成两件有名字的事，从而可以被检查。
- **`cqw` 相对单位 → 值中等。**
- **13 个 frame preset → 不抄**（见 §5），但**"每个 treatment 有 Fixed/Free 两栏"这个写法要抄**——它把"什么是这套风格不可动的、什么可以按内容变"变成了每一条都写清楚的东西。anim 的 style pack 现在是"整包换"，没有这个中间粒度。

---

### 4.4 关键帧 / 运动的原子规则

**① 对方怎么做。** `hyperframes-animation/rules-index.md` 是 7 大类、40+ 条原子规则的索引，每条是"一句内涵 + Tags"。粒度非常具体，举几条最能直接变成 anim 函数的：

| 规则 | 内容 | anim 现状 |
|---|---|---|
| `nudge-curve` | 慢-快-慢三段式整组位移：`power3.in` 加速 → 线性爆发 → `power4.out` 收尾，**距离分配 10/65/25，尾部时长 ≥ 3× 加速段** | anim 有 `spring()`（指数弹簧解析解），但**没有"三段式整组位移"**这个手法 |
| `waterfall-entry` | 错峰到达级联：每个元素在**前一个还没落定之前**就开始，加速的波，最后收敛。**"Binary 0→1 opacity via `tl.set` — never fade an arrival."** | anim 的 `type.write` 有 `stagger` + `from: 'up'`。**"到达不要用淡入，要用二值出现"**这个判据 anim 没有 |
| `reactive-displacement` | 物理碰撞式转场：进入元素的 tween 驱动退出元素的位移。**三个并发的 tween 在同一时间点，受害者的时长是入侵者的 40-50%** | anim 的 `handlesTransition` + `enterOffset` 是"甩走 + 反方向落位"，但没有**时长比例**这个判据 |
| `motion-blur-streak` | 假方向速度模糊：模糊在最大速度处达到峰值，落定时归零 | **anim 有真运动模糊（自适应多子帧），这是强项**。但"模糊峰值在最大速度处"这个**绑定关系**值得作为 `post` 的默认曲线写进 kit |
| `viewport-change` | 虚拟摄影机：单元素复合变换 `translate(x,y) scale(S)`，**反向平移数学是 `T = -offset × S`**（并显式说明**与 `coordinate-target-zoom` 的 `T = -offset` 不同**） | anim 有 `setXform(...)` 和 `cameraPost`。**但"两种反向平移公式的区别"这种坑，anim 的文档没有点名** |
| `3d-camera-flight` | 透视摄影机飞行：一个静态 `perspective` 舞台 + `preserve-3d` 的世界，姿态从**单个相机状态对象**逐腿 tween。落地用 `power4.out`，重新定位用 `power2.inOut` | anim 有三种 3D，但**没有"落地用哪条缓动、重新定位用哪条"这种分工** |
| `ambient-glow-bloom` | 无触发的柔和径向辉光，在 hero 元素后面绽放并保持有界呼吸。**峰值 opacity ≤ ~0.45** | anim 有 `bloom`/`halation`，但**没有上限判据**（`AGENTS.md` 只有"只有信号色才允许超过 0.85 线性亮度去泛光"） |
| `particle-burst` | 确定性粒子/彩带：固定池 + index-seeded 发射值 + **一个 `ease:"none"` driver，其 onUpdate 把每个粒子算成时间的纯弹道函数**（飞行中可 scrub），**≤ ~40 个粒子** | anim 有确定性随机 `rng(seed)` + `fbm`。**"固定池 + 单一 driver + 纯弹道函数"这个结构就是 anim 的写法**，但"≤40 个粒子"这种规模上限没有 |
| `theme-crossfade-morph` | 整主题原地形变：**堆叠完整图层 + 只做 opacity 交叉淡入**，锚点元素在最上层只渲染一次 | 无。**这条对 anim 极有启发**：anim 的场景是代码画的，做"整主题形变"意味着两套 post/调色板叠加过渡——"堆叠完整图层 + 只做 opacity"比"参数插值"更容易保证两端都对 |

**"原子规则"的写法本身（比内容更值得抄）**：

- 每条规则是**独立的 md 文件**，`rules/<name>.md`。
- 索引条目是 `一句话内涵 + Tags`（Tags 是检索面）。
- **共享契约只写一次**（`rules-index.md` 的 "The contract — every rule assumes this"），包括：
  - 只在**一个 paused timeline** 上跑
  - **双向 seek-safe**：`fromTo` 带显式 from 态，**绝对值，绝不用相对 `+=`**
  - 确定性：无 `Math.random()`、无 `Date.now()`，只有 index 派生的伪随机和烘焙好的排期，**有限重复**
  - **只动 transform 和 paint-only 属性**；`width`/`height`/`top`/`left` 禁用
  - **`items × stagger ≤ ~0.5s`**——把一组的到达压成"一个节拍"
  - 被动画的元素上**不许有 CSS `transition`**
  - **DOM 测量只在单场景 composition 的 build 期做**
- 每条规则自己的 **Critical Constraints 只写"超出共享契约之外、本条特有的"**。

**② anim 缺什么。** anim 有 `src/kit/`（`makeShot` / `put` / `fade` / `typed` / `panel` / `kicker` / `footer` / `marker` / `reticle` / `makeWorldKit` / `cameraPost` / `enterOffset` / `worldPass` / `spring` / `noise` / `withAlpha` / `mul` / `cameraAt` / `cameraDir` / `codeRow`），**这是一份很好的"原子函数库"**。缺的是：

- **没有"规则"这一层**——即"什么时候用 `spring` 什么时候用 `nudge-curve` 什么时候用 `waterfall-entry`"的判据。`AGENTS.md` §5.5 有一张很好的"选哪一种 3D"表（按"画面需要什么"选）——**这个形式应该推广到运动本身**：按"观众该感觉到什么"选缓动/手法。
- **没有一个可检索的运动语汇表**。`docs/COOKBOOK.md` 是做法手册，不是按"触发条件/感受"检索的规则索引。
- **没有把"负面判据"写成规则的一部分**。例：`motion-principles.md` 的"Three layers minimum per scene"、"Two focal points minimum per scene"。
- **没有"上限"类判据**。anim 的文档大量是"不许"，但很少有"最多/最少"（`≤40 粒子`、`峰值 opacity ≤ 0.45`、`items × stagger ≤ 0.5s`、`no more than 2 tweens with the same ease in a scene`）。**上限是把"抽象品味"变成"可检查"的桥。**

**③ 搬过来要改哪里、代价多大。**

- **`src/kit/` 里加 3 个函数**（照抄规则内容，不是照抄实现）：
  - `nudgeCurve(t, t0, dur, dist)` → 返回 10/65/25 分段的位移。纯数学，**十几行**。
  - `waterfall(k, { items, stagger, maxStagger: 0.5 })` → 更适合作为 **`type.write` 的 stagger 归一化**：`items × stagger > 0.5` 时**警告**（走 `ctx.warnings`）。
  - `bloomCap(peak)` / 一个断言：`panel` / `kicker` / 辉光的峰值透明度超过上限就 warning。
- **新建 `docs/MOTION.md`（或 `docs/KIT-RULES.md`）**，格式照抄：共享契约一节 + `rules/<name>.md` 一节一条。**不需要 40 条，8–12 条就够**。代价：**写文档的时间，不是工程时间**。
- **把"上限"接进 `check`**：这些上限的检查大多是**静态的**（读场景代码里的 stagger/size/alpha 字面量），可以进 `check` 的静态扫描阶段，**不需要渲染**。代价：低。

**④ 值不值：值，但优先级在 4.1/4.2 之后。** 理由是它**不改变引擎能力**，只改变 agent 的选择质量。不过 `nudge-curve`（10/65/25、尾 ≥3× 加速段）和 `reactive-displacement`（受害者时长 = 入侵者的 40–50%）这两个**具体数字**可以直接变成 kit 函数的默认值——**这是"把别人的调参成果免费拿走"，单位成本几乎为零。**

---

### 4.5 面向 agent 的文档工程

**① 对方怎么做。** 已在 §3 详述。这里只列**可以直接照抄到 anim 的具体形态**：

1. **一份文件里同时有：坑（带规则名）→ 能力地图 → 契约 → 校验清单。** `hyperframes-core/SKILL.md` 的顺序是：Agent pitfalls（3 条）→ References 表 → Building a composition → Two root forms → Root must be sized → One paused timeline → **First-pass lint gotchas** → **Non-negotiable rules** → Editing existing compositions → Validation（checkbox 列表）。**先给最容易踩的，再给结构，最后给清单。** anim 的 `AGENTS.md` 顺序已经接近，但缺"先给坑"。
2. **每条禁令都挂一个规则名或一个历史事故。** anim 的 `AGENTS.md` 已经**非常好地**做了这件事（"fidus 那次 9 段里 8 段这样"、"sodium 43 句旁白里有 12 句被逐字抄成了画面说明条"）。**这是 anim 的强项，继续保持。**
3. **"读哪个文件"必须精确到文件名，且带"读它是为了…"。**
4. **每个诊断命令必须给出"输出里的词是什么意思" + "看到这个词怎么修"。** anim 的 `check` / `verify` / `shake` / `hashes` / `probe-*` 输出里已经有很多术语（"非有限值：NaN n / Inf n"、"背景守门"、"空档"、"段内亮度不均"），**但没有一张集中的"看到这个词 → 做什么"表**。`AGENTS.md` §8 和 §10 末尾的"出问题时按这个顺序查"表已经很接近——**建议把它扩成"输出词 → 含义 → 修法"三列，并覆盖所有 probe 命令。**
5. **"不要为了通过检查而作弊"要写出来。** `check` 的文档原话："don't bolt on a slow position drift just to appease the check"；`gsap_non_transform_motion` 的注释原话："No suppression by design: there is intentionally no per-line/per-file opt-out (unlike eslint-disable). The stance is fix-the-motion, not silence-the-rule."。**对照 anim**：`AGENTS.md` §3.2 已经有一句极好的同类话——"别为了骗过 `check` 去画一笔没意义的全屏 Pass"。**这条已经在，只需要系统化。**
6. **留一个"能力缺口"的回报通道。** `catalog --query` 搜不到时，CLI 把 `feedback --search-miss` 的命令**预填好**打印出来，`--json` 里带 `report_gap`。原话："This is the whole demand signal for the catalog. Skipping it means the gap you hit gets guessed at from install counts instead, which cannot see a move nobody could install."

**② anim 缺什么。** 只有一份 `AGENTS.md` 契约（内容密度很高，且带大量事故证据）。缺：**分层**（没有 router，没有"什么时候不该动手"的意图层）、**负面清单**（"什么时候别用我"）、**"输出词 → 修法"的集中表**、**"搜索 → 发现没有 → 报告缺口"的闭环**。

**③ 搬过来要改哪里、代价多大。** 是**文档结构问题**，不是工程问题。最小可行版本：

- `AGENTS.md` 保持为唯一契约，但在开头加 **10 行 "Agent 首先读这些坑"**（从现有铁律表里抽最贵的 3 条）。
- 新建 `docs/SKILLS.md`（或直接拆 `AGENTS.md`）做一张 **"意图 → 读哪个文件"** 表，覆盖：`docs/ENGINE.md` / `COOKBOOK.md` / `STYLE.md` / `CAPTIONS.md` / `NARRATION.md` / `THREE.md` / `PERF.md` / `CONFIG-ONLY.md` / `BACKLOG.md` / `SCENE-BRIEF-TEMPLATE.md`。**表里必须有一列"读它是为了…"。**
- 在 `AGENTS.md` 加一条 **"什么时候不要动手"**：用户只是问问题 / 说"先别改" / "就是想想" → 不改任何文件，包括顺手发现的修复。**这条对 anim 尤其重要**，因为 `video` 一次跑很久、还会占满工作区。

**④ 值不值：值，而且是四条里最便宜的一条。** 纯文本工作，无回归风险，直接改变 agent 行为。**唯一要注意的**：anim 的 `AGENTS.md` 已经很长了，再往里堆会伤害可读性——正确做法是**分层**（`AGENTS.md` 只留最高频的坑 + 路由表，细节下移到 `docs/`）。

---

### 4.6 其他：分布式渲染 / 云渲染 / 嵌入

**① 对方怎么做。**

- **分块原语是纯函数**：`planV2` / `renderChunkV2` / `assembleV2`，"pure functions over local file paths — networking and orchestration live in adapter packages"（`producer/README.md`）。
- **V2 的关键设计**：发布一个**不可变 manifest** + **内容寻址（SHA-256）的 artifacts**，每个 worker 只拉自己声明需要的依赖。blob **上传和下载时都校验摘要**，**manifest 最后发布**。未知协议和摘要不匹配是**终止性的 Step Functions 错误**（`packages/aws-lambda/README.md`）。
- **成本是可见的**：`getRenderProgress` 返回 `accruedSoFarUsd` + 格式化的 `displayCost`。
- **规模边界被明确写出**：webm 和 HDR mp4 在分布式渲染里**会抛类型化错误** `FormatNotSupportedInDistributedError`；HLS 不可用于分布式；HLS 还拒绝 GPU 编码器，因为"GPU encoders ignore the forced-keyframe lock that fixed-length segments depend on"。
- **嵌入**：`@hyperframes/player` 是一个零依赖 web component，沙箱 iframe + Shadow DOM + postMessage，有 `sandbox-origin="opaque"` 与 `audio-locked`（宿主强制静音）。

**② anim 缺什么。** 没有分布式/云渲染。anim 有 `hashes`——**这在分布式渲染里是必需品**。

**③ 搬过来要改哪里、代价多大。**

- **"不可变 manifest + 内容寻址 + manifest 最后发布"可以独立于分布式先抄**：anim 的 `--segments` 分块渲染已经在"已渲好的块会跳过"，如果每块产出一个 `{range, params_hash, code_hash, output_hash}` 的记录，就能做到"**改一个镜头不用整片重来**"的**可信**版本（现在是靠"已渲好的块会跳过"，但判断依据是什么不清楚）。代价：低（记录 + 比对）。值：中高。
- **`FormatNotSupportedInDistributedError` 这个模式值得抄**：哪些能力在云上不可用必须**类型化报错**，而不是静默退化。代价：低。
- **分布式渲染本身：不建议现在做**（见 §5）。

**④ 值不值：分档。** "分块清单 + 内容寻址"值；"云渲染"不值（现在）。

---

## 5. 不适用 / 别照抄的

### 5.1 HTML+CSS 的表现力上限 —— **硬边界，不是偏好**

hyperframes 的画面能力就是浏览器能渲染的东西：DOM 布局 + CSS + Canvas + WebGL。它的动画规则里反复出现同一类妥协：

- **`gsap_non_transform_motion` 是 error**，因为"layout 和 text-reflow 属性在浏览器布局期间整数吸附"，而且文档明确说 `letterSpacing` / `wordSpacing` **没有忠实的 transform 等价物**——"uniform scale is NOT equivalent — use a per-glyph split with an x transform per character, or hold the final value statically"。
- 禁止 tween `width`/`height`，用 `scale` 代替——但 `agenda-layout-expand` 那条自己承认"layout authored expanded; mask + sheet slide, or **proxy-driven scaleY + inverse counter-scale**"。**这是用变换模拟布局，不是布局。**

**anim 的 GLSL/WebGL 是"逐像素算画面"，hyperframes 是"让浏览器排版再截图"。** 后者永远做不出：真 raymarch、任意 SDF、逐像素后处理链的自由组合、真运动模糊的逐子帧积分。**别让 anim 的规则向 hyperframes 的妥协看齐。** 具体说：**不要**因为 `gsap_non_transform_motion` 是 error，就在 anim 里也禁止"布局类"运动——anim 没有布局，所有坐标都是自己算的，`x` 就是数，不存在整数吸附（**除非**你自己 `Math.floor`）。这条规则要抄的是**意图**（慢速运动别量化到整数像素），不是**字面**。

### 5.2 依赖 React/GSAP 生态 —— **不要把 anim 的核心绑上去**

hyperframes 的默认 runtime 是 GSAP（"GSAP is the default for 95% of motion work"），而且**大量规则是 GSAP 语法专用的**：`overlapping_gsap_tweens`、`gsap_repeated_fromto_without_baseline`、`immediateRender` 语义、`gsap.utils.random`、`gsap.from` 的 `immediateRender: true` 陷阱。它的"seek-safe"很多是在**绕 GSAP 的坑**：

> "**Prefer `tl.fromTo()` over `tl.from()` inside `.clip` scenes.** `gsap.from()` sets `immediateRender: true` by default, which writes the 'from' state at timeline construction — before the `.clip` scene's `data-start` is active."（`motion-principles.md`）

anim 的场景是**你自己定义的接口**（`render(ctx)` + `f.t`），没有第三方状态机。**把 hyperframes 的"绕坑规则"搬进 anim 是纯粹的成本。** 要抄的是它的**seek 顺序安全分析**（相对值基线、函数值在 init 时重跑、回调重放），而不是 GSAP 的具体 workaround。

不过有一条**生态级**的判断值得注意：hyperframes 的 `adapters/` 支持 7 种 runtime（GSAP / Lottie / Three.js / Anime.js / CSS keyframes / WAAPI / TypeGPU），"Multiple runtimes can coexist in one composition. Each registers its instances on the runtime-specific global so HyperFrames can seek all of them in one pass."（`hyperframes-animation/SKILL.md`）。**"一个统一的 seek 协议 + 多个 runtime 适配器"是一个好架构**——如果 anim 将来想接别人的 runtime，要抄的是这个协议形状，不是任何一个适配器。

### 5.3 没有运动模糊 / 子帧采样 —— **这是 anim 的优势，别倒过来学**

hyperframes 有两条路：引擎的 `motionBlur` 渲染选项与 `motion-blur` 组件（DOM 层 N+1 副本）。而**组件那条路的成本与限制，恰好反证 anim 的自适应多子帧是对的**：

- 成本："At the default 16 that is 17 copies and 17 seeks per target per frame."
- 限制："The component smears what a `transform` can express, on the elements you mark."
- 明确说不出的话："There is no axis, no strength and no radius. The smear is the trajectory, integrated; its extent is speed times shutter time and is not a free parameter."
- 失败模式里最危险的一条：**"No smear, no warning"**。

**anim 的运动模糊是"逐帧自适应子帧 + 并行求平均"**，这是**物理上的积分**，不是 DOM 副本叠加。**绝对不要用 hyperframes 的组件方案替换它。** 但有一条**判据**要抄（见 §2.3）：**什么时候不该用运动模糊**。anim 现在只有"自动"，没有"什么时候该关"。

### 5.4 它的"确定性"是靠 seek 而非纯函数 —— **结构性弱点，不是可以抄的优点**

证据链很完整：它需要**至少五族**规则来堵"seek 顺序依赖"，并且**它的作者明确知道有些洞是静态 lint 堵不住的**：

> "Rules below came out of two independent website capture builds (2026-04-20) where compositions **lint-clean and still ship broken** — elements that never appear, ambient motion that doesn't scrub, entrance tweens that silently kill their target. **The linter cannot catch these;** the rules must be followed by the author."（`motion-principles.md`，Load-Bearing GSAP Rules）

**"lint 干净但仍然出片坏掉"** —— 这是 seek 模型的必然代价。anim 的"每帧是 t 的纯函数"从语言层面消灭了这一整类 bug。

**要抄的**：它的**具体分析手法**（"这个 API 读的是 transform-敏感几何吗"、"这个值在 tween init 时算还是 build 时算"）可以变成 anim 的 `check` 规则。anim 已经扫了 `Date.now`/`performance.now`/`Math.random`，但**"`render` 里出现了 `Math.floor`/`toFixed`"和"`setup` 里算了本该每帧算的东西"**没有。
**不要抄的**：把"允许有状态"当默认。anim 的纯函数约束是**更便宜的正确性**，守住它。

### 5.5 商业 SaaS 绑定

- `media-use` 的 BGM/SFX/image/voice 解析默认指向 HeyGen catalog / `heygen` CLI。
- `cloud render` 是 HeyGen 托管。
- 桌面 app 闭源，带 Framey 助手。

**对 anim**：这三条都不要抄。anim 的定位是"写代码就是做动画，不需要素材"——**引入一个外部媒资目录会直接违背这个定位**。anim 的真实媒资需求已经在 `AGENTS.md` §0 的补充里说清了：真 logo / 真截图当图层画进来，做法在 `docs/COOKBOOK.md` §9，加载放 `setup`。**这个模式（用户自带 + 引擎加载）比"引擎去搜"更符合"确定性"的哲学**——外部目录的可用性会变成渲染的隐藏依赖。

另外**不该抄的一个具体东西：`studio_missing_editable_id`**。anim 没有 Studio，也没有"用户在 GUI 里改"的需求。**抄了只会变成噪音。**

### 5.6 布局/对比度审计的 DOM 前提

`check` 的布局审计量的是 `getBoundingClientRect`——"The `check` layout audit measures `getBoundingClientRect` at sampled timestamps, **not rendered pixels**. `overflow: hidden` clips the visual but does **not** suppress a layout finding."（`data-attributes.md`）。

**anim 的画面全是代码画的，没有 DOM 盒子。** 所以 `content_overlap` / `canvas_overflow` / `escaped_container` / `primary-offscreen` 这套实现**不能抄**。**但它的两个替代物可以抄**：

- `canvas_content_at_edge`（"a canvas's pixels show sharp content … along the frame edge"）——**这条本来就是像素级的，正好是 anim 需要的**。
- 对比度审计的**输出形态**：每个 finding 带实测 fg/bg、实测 vs 要求比值、**以及同色系方向上最近的合规颜色**。

**另一个明显的不要抄：`data-layout-allow-overflow` 这类豁免属性。** hyperframes 自己就写了它的"杀伤半径"警告：

> "**Blast radius — it silences more than the overflow audit.** The attribute is inherited down the subtree (the perception probe walks ancestors), so it also suppresses the rendered-perception checks `text-clipping`, `content-cramped-container`, and `foreground-over-panel` for every descendant."

**"豁免会静默地多关掉几条别的检查"**——anim 应该引以为戒。anim 已有的 `world: false`（合法声明"这一段我刻意不铺底"，背景守门会跳过）就是这类豁免，它的范围是**受控的**（只关背景守门）。**如果将来要加更多豁免，必须像 hyperframes 一样明确写出"这个豁免还会关掉什么"。**

### 5.7 13 个 frame preset

`skills/hyperframes-creative/frame-presets/` 有 13 个完整设计系统。

**不要抄内容。** anim 的 `src/style/` 是**代码**（配色 / 字体栈 / 背景母题 / 后处理基线 / 版面栅格 / 字幕样式），一行 `style: 'paper'` 换掉**整个观感**；而 frame preset 是一份**文档**（token + prose + treatment 表），需要 agent 读它再写 HTML。**anim 的机制更强**——它换的是渲染参数，不是写页面的指导。抄 13 份文档进来只会让 agent 的选择面变宽、决定变慢。

**要抄的是格式**：`Fixed` / `Free` 两栏 + `Do`/`Don't` + 失败长什么样 + Pre-Render Self-Audit 清单。

### 5.8 云渲染 / Lambda（现在）

`packages/aws-lambda` 做得很好（不可变 manifest、内容寻址、摘要校验、成本可见、格式不支持就类型化报错、BeginFrame 回归守卫、ZIP 尺寸 CI gate）。**但 anim 现在做这个是错的**：

- anim 的瓶颈是**GPU 填充率**，而 Lambda 是 CPU 实例 + `@sparticuz/chromium` 的软件/受限 GPU 路径。**把 raymarch 场景搬到 Lambda 很可能更慢，不是更快。**
- anim 的最大加速已经在 `--segments`（分块，已渲好的块跳过）和 NV12 传输上。**先把本机跑满，再谈分布式。**
- hyperframes 的分布式只支持 mp4 SDR / mov ProRes / png-sequence，**这正是因为它要保证跨 worker 一致**。anim 如果要分布式，会碰到同样的"哪些能力不能上云"问题——现在没必要付这个代价。

**建议**：只抄 §4.6 里的"不可变分块清单 + 内容寻址"到本机的 `--segments`，把云渲染放进 `docs/BACKLOG.md` 的"待你拍板"，不是现在做。

---

## 6. 一句话结论

**对 anim 最值得抄的一件事：把 hyperframes 的 `check` 从"像素体检"升级成"带断言的画面语义门"——最具体的第一步是抄 `*.motion.json`：让 anim 的任务能声明"某段该在 X 秒前出现、A 该早于 B、这段整体不许静止超过 2 秒、画布边缘不许有硬内容"，并让 `check` 在它已有的三点采样/逐段试渲染里逐条验证、跨采样点保持才 gate、跳过的审计显式标 `skipped` 而不是静默通过。**

这一步之所以是对的那一步：

- 它防的正是 anim 自己文档里承认的最贵的一类失败——"违反会导致成片随机出错，**而且通常不报错**"。
- 它**复用 anim 已有的基础设施**（`check` 的三点采样、背景守门的差值、`shake` 的纯函数逐帧统计、`ctx.warnings` 通道），不需要新引擎能力。
- 它让 agent 从"check 通过 = 完事"变成"check 告诉我第 3 段 4.2s 之后什么都没动"——**不需要 agent 更聪明，只需要报告更具体。**
- 单位成本最低：规则集可以一条一条加，每条都是独立的、可回归的、不需要 GPU 的纯逻辑。

紧接着做第二件：**注册表**（§4.1），因为它把"8 个硬编码模板"的复用价值从仓库内部释放到仓库外部，而且 anim 的 `shot(type, params)` 已经是比 hyperframes 更适合做这件事的接口。第三件：**"数字来自脚本"写成 FACTS 约束 + 交付自检**（§4.3），成本最低、伤害面最大。
