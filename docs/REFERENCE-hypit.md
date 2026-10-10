# 参考拆解：hypit-ai/hypit（"Clone any viral video with AI agents"，核心是 SVML）

> 拆解日期 **2026-10-10**。上游 <https://github.com/hypit-ai/hypit>（Apache-2.0 **with conditions**，
> TypeScript/pnpm，默认分支 `main`）。由并行子代理逐文件读完原文产出（`examples/*/reference.svml` 全文、
> `docs/guide/` 全部 14 份、`packages/*/README.md`、`LICENSE`），**未改动任何本地文件**，由主代理原样归档。
> 证据约定：源码引用尽量用 `路径` + 函数/字段名；SVML 片段与文档引用来自实际读到的原文。
> 推测部分一律标注 **[推测]**。
>
> **本文件只记"别人怎么做"** —— 可执行的待办一律以 [`BACKLOG.md`](BACKLOG.md) 为准（本轮新增在 **§1.B**）。
> 与另外两份的关系与横向对比见 [`REFERENCE-agent-video-projects.md`](REFERENCE-agent-video-projects.md)。

---

## 1. 它到底是什么

**一句话：它是一个"用标记语言描述视频、编译成依赖图、交给一批无头 Chrome 渲出来"的编译器 + 执行图 + 包生态，不是一个编辑器。** 爆款克隆只是它的获客入口。

**能力边界。** 公开的 8 类示例用途：付费社交广告（从 Meta Ad Library 克隆一条跑赢的广告、当天出 50 个 hook 变体）、爆款克隆、TikTok Shop 带货、AI UGC 口播、播客/访谈切片、**纯代码渲染视频**、本地化（同一条片子十种语言）。最后两条与 anim 同域。原话（`README.md`）："**Code-rendered videos** — visuals driven entirely by front-end code, rendered locally without generation API calls."

**依赖：可以完全不调生成模型。** 这是它 README 里明确声明的：

> "Generation models are optional too: a workflow can compile captions, motion graphics and code-rendered visuals into a finished video without calling a generation model or incurring its service charges."

成立的技术原因，是它的架构把"素材从哪来"和"时间/排版/合成"彻底切开：

- `docs/guide/packages.md` 明确分层：Author component（把作者输入变成媒体请求/视觉行为）、Model（一次生成请求的定义）、Provider Endpoint（真去跑）、Credential store、Result repository、Distribution。
- `packages/media-operations/README.md`：任何素材先过 `Normalize` 变成 `SynchronizedMedia`（统一帧域 + 48kHz PCM），**归一化是所有媒体形态的公共腰**。本地 FFmpeg Provider 就能做这件事，0 成本。
- `docs/quickstart/composition.md` 末尾专门给了一个"A film drawn entirely by components"的完整例子：`<time:Timeline end="8s">` + 一个 chat 组件 + `<film:Film>` + `<html:Video>`，**无 Script、无媒体、无生成调用**，结果静音但完整可渲。
- `docs/guide/runtime.md` 的本地 Profile 示例里 `endpoints` 只注册 `media.local`，`credentials: {}` —— 本地档位的凭据槽就是空的。

所以"不花生成费用出片"确实成立。反过来说：**它的 64 路并发、词锚定、Caption 全套能力，都长在"素材已经存在"这个前提上**，而不是长在"确定性逐帧"上。

**成本口径要说清。** 三个示例的 `Total cost: $1.15 / $1.07 / $1.09` 是**生成模型的账单**，不含 Hypit 授权、也不含机器。`README.md` 也写明"Hypit is free to use; your Coding Agent and model services have their own accounts and charges."

**许可证：Apache-2.0 + 三条附加条件**（`LICENSE`）：

1. **多租户禁令（2.a）**：未经书面授权，不得用它的源码或其衍生作品运营多租户环境，或把它的功能作为 hosted/managed/SaaS 提供给第三方。"一个 tenant = 一个 workspace"，两个外部主体各持有独立 workspace 就算多租户，**收费与否不影响判定**。
2. **商业再分发禁令（2.b）**：不得销售、收费许可、或以其他方式为商业利益供应 Hypit 或其衍生作品。但"fork、修改、在**同一许可证**下发布"是允许的。
3. **LOGO 不可去除（2.c）**：不得移除或修改 CLI、生成的 run report / manifest、以及由它们派生的用户可见界面里的名称、LOGO、版权信息（不向用户呈现这些东西的用法不受此限）。
4. **明确允许**：在自己基础设施上自用、为自己组织做商用工作、**为客户做的工作**、单租户部署。
5. **产出物归你（第 3 条）**："The producer claims no rights in the content you create with Hypit." 视频/音频/图片/manifest 都归使用者，无附加条件。
6. 贡献者条款（第 2 条）：生产方可以单方面收紧或放宽开源协议；你的贡献可被用于其商业目的（含云业务）。

**对 anim 的实际含义**：如果 anim 永远是自己用/给客户做片，抄它的**机制与思路**没有任何许可证问题（许可证只约束"它的代码"，不约束"你从中学到的设计"）。一旦 anim 变成对外提供的服务或打包售卖的组件，就不能把它的代码或衍生代码带上船。**这也是下面所有建议都只提"机制"不提"代码"的原因。**

---

## 2. SVML 深入：词锚定到底怎么写的

### 2.1 一份真实片段（`examples/ranking-football/reference.svml:31–38`，原文）

```svml
<script id="story">
  <ronaldo>
    <HOST>Ronaldo is <D | Dee> tier. || Bro has @{hair-gel} more || hair gel than @{trophy} trophies || at this point.@{/trophy}@{/hair-gel} || Built like || @{greek-god} a Greek god, || plays like || @{greek-tragedy} a Greek tragedy.@{/greek-tragedy}@{/greek-god} || But hey, || at least @{penaldo-social} he's got || the most followers || on Instagram.@{/penaldo-social}
  </ronaldo>
  <messi>
    <HOST>Messi? Man won || a World Cup || @{tired-dad} looking like || somebody's tired dad.@{/tired-dad} || Walks around || @{walks-around} for 89 minutes, || touches the ball || three times, || and somehow || @{hat-trick} you just watched || a hat trick.@{/hat-trick}@{/walks-around} || Definitely <S | Ess> tier.
  </messi>
</script>
```

五个语法构件，全部在 `docs/quickstart/script.md` 与 `packages/script/README.md` 里有定义：

| 写法 | 名字 | 含义 |
|---|---|---|
| `<ronaldo>…</ronaldo>` | **Segment** | 一个有名字的结构段落。每段可以是一整条生成片段。 |
| `<HOST>` | **Role Cue** | 谁说这句。**没有闭合标签**，持续到下一个 Cue 或 Segment 结束。不是角色资产，不选音色。 |
| `<D \| Dee>`、`<S \| Ess>` | **Dual Text** | 左边是**显示**，右边是**念法**。字幕显示 `D`，语音说 "Dee"。左边可以为空（`< \| um>` = 念出来但不显示）。 |
| `@{hair-gel} … @{/hair-gel}` | **Selection** | 命名的语义**区间**。零宽，不进任何文本投影。 |
| `@{trophy!}` | **Moment** | 命名的语义**点**。 |
| `\|\|` | **Caption Cue 分隔符** | 字幕换气位置。**不切镜头、不分段**。 |

注意最后一行那个细节：`@{/trophy}@{/hair-gel}` —— 两个 Selection 紧贴着闭合，说明**Selection 可以交叉、可以重叠、不必嵌套**（`docs/quickstart/script.md` 明确给了 `@{a}One @{b}two@{/a} three.@{/b}` 这个交叉例子）。这是它比 HTML 式标签强的地方，也是"语义区间"能自由表达的原因。

### 2.2 词锚定在语法层的六个位置，以及 `~` 的亲和性

这是整个语言最精巧的一处。标记本身**不占用任何词**，它声明的是"贴到相邻的哪个词边界"。`packages/script/README.md` 给了完整表：

| 标记 | 吸附到的边界 |
|---|---|
| `@{name}` | 下一个词的**开头**（右亲和） |
| `@{~name}` | 上一个词的**结尾**（左亲和） |
| `@{/name}` | 上一个词的**结尾**（左亲和） |
| `@{/name~}` | 下一个词的**开头**（右亲和） |
| `@{name!}` | 下一个词的**开头**（右亲和 Moment） |
| `@{~name!}` | 上一个词的**结尾**（左亲和 Moment） |

`~` 的用途不是装饰，是**消歧**。原始文档给的例子非常能说明问题：

```text
@{coffee} my coffee @{/coffee} @{~smoothie} my smoothie @{/smoothie}
@{coffee} my coffee @{/coffee~} @{smoothie} my smoothie @{/smoothie}
```

两个词之间那一段停顿（词间空隙），到底算前一个 Window 的、还是后一个 Window 的？上面第一种写法让 **smoothie 吃掉停顿**，第二种让 **coffee 吃掉停顿**。第三种 `@{/coffee} @{smoothie}` 则**两边都不吃**，停顿落在两个 Window 之外。

**这是"秒"做不到的事。** 用秒数你只能写 `from: 4.2, until: 4.8`，而这里的"4.2–4.8 是哪个词的尾音"是一个需要听音频才能知道的事实。词锚定把这个事实的**作者意图**（"停顿归咖啡"）和**测量结果**（"咖啡在 4.31 秒结束"）分开了。这是最值得学的一点。

### 2.3 编译/求解成什么：`Script` 里没有秒

关键在于三句话，全部来自 `docs/quickstart/script.md` 与 `packages/script/README.md`：

> "Script is **prose-first**: it contains no timecodes, no media references, no styling, no generation parameters."
> "`CaptionDocument` … contains **no seconds or frames**."
> "A marker selects the adjacent semantic anchor; **it does not write a timecode**."

**产物是一个纯符号结构。** `packages/script/README.md` 第一段就把不变量写死了：一段 Script 恰好产生 `2M + 2N` 个语义锚（每个 Token 两个边界、每个 Segment 两个边界）。**没有合成锚点，没有程序边界锚点 —— 绝对工作边界属于 Timeline。**

于是求解分成严格的三段，谁也不认识谁：

```
1. Script ──解析──▶ Narrative（纯语义锚点图）+ CaptionDocument（显示词/对齐单元/Cue）
                     ↓ 零时间信息
2. WhisperX ──────▶ NarrativeAlignment（语义边界 × 媒体本地时钟）
   <whisperx:Alignment narrative={story} segment={story.segment.ronaldo}
                       media={ronaldo-media.media} domain={ronaldo-media.domain} language="en"/>
                     ↓ 仍无 Timeline 位置
3. Projection ────▶ 绝对 TemporalWindow / TemporalInstant
   <semantic:Projection id="story-time" narrative={story} timeline={speech.timeline}>
     <semantic:Map alignment={ronaldo-semantic.alignment}
                   domain={ronaldo-media.domain} window={speech.ronaldo-semantic}/>
   </semantic:Projection>
   <semantic:Window id="selection-hair-gel" projection={story-time} during={story.selection.hair-gel}/>
```

三个包的边界写得很硬（各自的 README）：

- `@hypit/whisperx`：产出 `NarrativeAlignment` = "语义时序在**媒体本地域**上，不是媒体、不是 Timeline、不是呈现策略。"
- `@hypit/narrative-temporal`：把 `NarrativeAlignment + LocalTemporalDomain + 等长 Window` 投影到选定 Timeline，**只发布普通绝对 `TemporalInstant` / `TemporalWindow`**。
- `@hypit/temporal`：公共坐标只有三种 —— `TemporalInstant`（一个已解出的帧边界）、`TemporalWindow`（半开 `[start,end)`）、`TemporalExtent`（未定位的帧数）。**它拒绝** Timeline 外的 Instant、端点 Timeline 不一致的 Window、反转或空 Window、非精确的本地域投影、不兼容帧率。它不裁剪、不修复、不推断、不渲染。

投影本身的数学是死板的（`packages/timeline-author/README.md`）：

> "The relation is exact native-speed translation: local frame zero maps to the Window start and the local exclusive end maps to the Window end. **A length mismatch is an error; projection does not clip, loop, hold, stretch, resample or hide a source tail.**"

**没有 stretch。** 媒体多长，Window 就必须多长，否则报错。这是一个非常重要的设计选择。

### 2.4 于是组件只会说"给我一个绝对的 Window"

组件一侧（`packages/caption/README.md`）：

```svml
<caption:Hidden id="hidden"/>
<narrative-caption:Timing id="story-captions" document={story.caption}
  binding={story.caption-binding} projection={story-time}/>
<time:Window id="impact-window" timeline={film.timeline} from="12s" for="2s"/>
<caption-fine:Caption id="captions" document={story.caption} timing={story-captions}
  timeline={film.timeline} within={vertical.bounds}>
  <caption-fine:Use style={plain}/>
  <caption-fine:Use role="GUEST" style={guest}/>
  <caption-fine:Use during={demo-window} style={hidden}/>
  <caption-fine:Use during={impact-window} style={impact}/>
</caption-fine:Caption>
```

`packages/visual-track/README.md` 第一行就是：**"Visual Clip = one picture source + absolute Window + Frame"**，属性表里 `during` 是"这个 occurrence 何时贡献"，`z` 是"绝对画面堆叠序"。

**所以 B-roll 在 ranking 示例里长这样 —— 注意它只认 Window，完全不认识词：**

```svml
<visual:Clip id="hair-gel" image={broll-hair-gel.image}
  extent={hair-gel-extent} during={selection-hair-gel}
  frame={hair-gel-frame} z="40" fit="cover" treatment={recipes.media.hair-gel}
  motion={broll-left}/>
```

作者只写了 `during={selection-hair-gel}` —— **"这张图在'发胶'那个词的区间里出现"**。至于那区间是第 143 帧到第 187 帧，是 Projection 算出来的。

### 2.5 "rewrite a line and the timing re-flows itself" 到底怎么成立的

完整链条：

1. 作者改 `@{hair-gel} more` → `@{hair-gel} even more`。
2. Script **重新解析**，锚点身份不变（锚点的身份是"hair-gel 的开/闭"，不是帧号），Dual Text 的 N:M 对齐单元保持完整。
3. 语音**必须重新合成**（或重新对齐）。WhisperX 在新的证据音频上重新测出每个 Token 边界 → 新的 `NarrativeAlignment`。
4. `Projection` 用**新的本地对齐 × 同一个等长 Window**重算，`selection-hair-gel` 得到新的绝对帧区间。
5. `visual:Clip` 的 `during` 是引用不是快照，**它自动跟到新区间**。TierBoard 的揭示窗口同理。
6. Timeline 的 `end` 也重解：`end="messi-semantic.end"`，而 `messi-semantic` 的 Window 是 `for={messi-media.extent}` —— 媒体变长，整条片子的总长跟着变。

**没有任何一步是"改数字"。** 这就是它敢说 "Rewrite a line and the timing re-flows itself" 的全部原因 —— 不是有个聪明的重排算法，而是**时间从来就没有被写下来过**。作者写的每一个时间都是引用，求解器每次编译都从头算一遍。

顺带一提，Timeline 的构建也是一张 DAG，`packages/timeline-author/README.md`：

```svml
<time:Clock id="clock" frame-rate="30"/>
<time:Timeline id="program" clock={clock} end="latest(speech.end,outro.end)">
  <time:Window id="speech" from="start" for={voice.extent}/>
  <time:Instant id="claim" at="speech.end-12f"/>
  <time:Window id="outro" from="claim" for="3s"/>
</time:Timeline>
```

点表达式文法极简：`start` / `12f` / `250ms` / `1.5s` / `speech.end` / `claim+2s` / `earliest(a,b)` / `latest(a,b,c)`。**允许前向引用**（"Source order is not execution order"）。Window 必须给 `from`/`until`/`for` 中的**恰好两个**。有环就拒绝。未知引用、非正的 Timeline end、非精确帧时长、空 Window、越界值全是错误。

### 2.6 本节结论

**词锚定的本质不是"另一个时间单位"，而是三层解耦：**

| 层 | 知道什么 | 不知道什么 |
|---|---|---|
| Script | 词、词边界锚点、谁在说、念什么 | 秒、帧、媒体、Timeline 位置 |
| Alignment | 锚点在**媒体本地域**的帧号 | 媒体该放在片子的哪里 |
| Projection / Timeline | 绝对帧号 | 词是什么、音频从哪来 |

**代价必须说清**：这套东西要成立，**每一句台词都必须对应一段真实存在、可测量的音频**。WhisperX 是真跑推理（或至少本地 `small` 模型），这就是 `docs/guide/runtime.md` 里"Initial inference setup can require substantial downloads"的意思。纯代码动画没有音频，就只能退到 `docs/quickstart/composition.md` §"A film drawn entirely by components" 那条路 —— **用 `time:Instant` 直接写绝对时刻，词锚定完全不参与**。这是 hypit 自己划的边界，也是 anim 要面对的第一道判断题。

---

## 3. 组件与包系统

### 3.1 一个组件的解剖

`docs/guide/component-anatomy.md` 把角色列成表（不是目录结构，是**职责**，小包可以合并文件）：

| 角色 | 职责 |
|---|---|
| Manifest and Types | 声明它提供的值、Producer、输入、输出 |
| Surface | 读作者写的元素，解出显式输入 |
| Fragment | 描述把输入连到输出的操作与依赖 |
| Producer | 执行声明的计算 |
| Value / Style helpers | 校验输入、套用有文档的默认值、解码 Recipe 属性 |
| Schedule and drawing | 逐帧投影事件并绘制 |
| Activation | 发布本包提供的贡献 |
| Studio Companion | 为 Studio 描述时间轴 Item 与可编辑属性 |

**它的核心设计信条是"按关系设计"**，原文两段很值得抄：

> "For spoken work, an upstream Narrative Projection turns selected semantic identities into named absolute Windows and Instants after the performance exists. A component accepts those same absolute types for behavior tied to the words. For an authored animation, Timeline declarations can produce them directly from seconds or frames."

> "A duration such as `12f` can still describe the component's local transition length."

**即：组件一律只吃绝对 Instant/Window；绝对 Instant/Window 可以由"词投影"产生，也可以由"秒/帧声明"产生 —— 组件对两者的区别一无所知。** 这是整个包生态能存在的前提：第三方组件不需要依赖 Script、WhisperX 或任何生成模型。

最小实例的构造在 `packages/interview-emoji-reveal/README.md`，它的接口描述干净得可以当模板：

- 吃一个外层 `TemporalWindow` + 每个 Item 一个已解出的 `TemporalInstant`。
- `n` 个答案 ⇒ **恰好 `n + 1` 个显式图片输入**（一张占位图）。
- 显示顺序 = 源码顺序：先 preset 项，再按严格时间顺序排已揭示项。
- **"consumes the shared Timeline, the outer Window and resolved Instants; it does not interpret Script semantics itself and has no Studio dependency."**

同一处还有个诚实得罕见的细节：它明明可以内联图片，却选择"捆进来的预览图标来自 Tabler Icons，MIT，SVG 是设计源，**显式栅格化成同尺寸透明 PNG** 再进合成，刻意共用同一 viewBox / 描边宽度 / 线帽 / 颜色，而不是依赖平台 emoji 字体"。这是"包可以自带资产"的正确姿势。

### 3.2 包如何版本化与分发

`docs/guide/packages.md` 把边界切得很清楚：

| 部件 | 职责 | 在哪里被选中 |
|---|---|---|
| Author component | 作者输入 → 媒体请求 / 视觉行为 / 其他图输出 | Source 的 import |
| Model | 定义一次精确的生成请求及其输出 | Source 的 import |
| Provider Endpoint | 通过 API 或本地工具执行 | Runtime Profile |
| Credential store | 解出 Endpoint 的具名凭据 | Runtime Profile |
| Result repository | 保存项目 Build 记录与产物 | Runtime 实现（本地用 `.hypit/results`） |
| Distribution | 提供可执行程序与官方包 | 安装的 `@hypit/hypit` release |

**两套版本号，是刻意的（`docs/guide/conventions.md`）：**

> "All persisted data uses the `@1` wire format version."
> "Package versions select physical releases through npm or pnpm. **They are distinct from logical Module and Frontend interface versions.**"
> "npm or pnpm owns installed package versions and bytes. Hypit identities describe semantic Modules, Frontends, Fragments and implementations rather than **pretending to hash an installed package**."

所以在 Source 里写的是**逻辑地址**：

```svml
<import as="mine" from="@your-studio/my-component@1"/>
```

`@1` 是作者接口版本，**npm 装的实际版本决定实现**。升级组件不动 Source。`docs/guide/conventions.md` 还有一句很狠的自律："Circular production dependencies are forbidden"，以及 `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 全开、**根 tsconfig 里没有中央 `paths` 注册表，每个包必须自己声明每一条跨包 import**。

### 3.3 官方 Distribution 与社区共享的边界

**这条边界是明写的，而且是"职责边界"而非"审批边界"** —— `README.md`：

> "Creating a component is ordinary video-production work, and **the component normally stays with the video project that owns it**. When its owner wants to share it, the same package can be handed off as a **versioned tarball** or published under the owner's **npm scope or private registry**. Proposals for a component maintained in Hypit's official Distribution begin with an issue describing the shared product need; **official inclusion is separate from normal community sharing**."

工程上（`docs/guide/author-packages.md` + `examples/minimal-author-package/packages/example-component/README.md`）：

- 组件默认住在视频项目的 `packages/` 下，用 owner 自己的 scope 命名。
- 要分享就 `npm pack` 出 tarball，或去掉 `private: true` 发到 npm / 私有 registry。**消费者装选定版本并提交 lockfile。**
- 关键一句：**"A Hypit repository checkout or upstream pull request is not needed to use the component."** —— 用组件完全不需要碰上游仓库。
- 开发时依赖 `@hypit/hypit` 作为 devDependency（提供公共类型），运行时 API 由**当前激活的 Distribution** 提供。
- 只允许用**窄的公共子路径**：`@hypit/hypit/author`、`/producer`、`/admission`、`/markup`，加领域包 `@hypit/composition`、`@hypit/temporal`、`@hypit/generation/model`、`@hypit/hypit/endpoint`。
- Studio 兼容：`@hypit/studio-companion` 编译成 JS 与组件同包发布。**重启 Studio 才会加载新的贡献。**

`examples/` 里已经能看到这条边界的真实产物：`@hypit/ranking`、`@hypit/interview-emoji-reveal` **发在 npm 上**，而 interview 那支片子反复闪的效果是**项目本地的** `packages/flash`，文档明确写："It is part of this video's source, **not** an official Screen Overlay family or an ecosystem dependency."

**对"第三方给引擎投稿镜头"的启示**：这套设计的精髓是**双层门槛**。工程门槛极低（拷一个目录、改名、`npm pack`，不用 PR）；**生态门槛很高且是产品判断**（进官方 Distribution 要先开 issue 说明"共享的产品需求"）。它没有假装"人人可投稿所以人人自动进目录"，也没有把两者混成一个审批队列。这比"要么全收要么全不收"健康得多。

---

## 4. 渲染与工程

### 4.1 "64 个无头 Chromium 进程"是真的，但它的数字来自公式

**① 编译器产出可任意跳帧的程序。** `packages/html-program/README.md`：一个 `HtmlProgram` 含整数帧域、画布、一份自包含 HTML、带类型的字节依赖、compositable Surface 依赖、以及**带类型的源视频帧函数**。页面只暴露一个 ABI：

```ts
window.__hypitFrameProgram.prepare(): Promise<void>
window.__hypitFrameProgram.applyFrame(frame: number): Promise<void>
```

`frame` 是 `[0, frameCount)` 内的绝对整数。原文：

> "It **never converts the request to seconds** and **does not require sequential playback**, so independent workers can enter at any legal frame."

这一句是全部并发的地基。**渲染器不是播放器。**

**② 帧区间被切成连续块，一 worker 一块**（`packages/provider-html-local/src/sampling.ts`）：

```ts
export function distributeFrameRange(range: MediaFrameRange, workers: number): MediaFrameRange[] {
  const count = range.endFrameExclusive - range.startFrame;
  const active = Math.min(count, workers);
  return Array.from({ length: active }, (_, index) => ({
    startFrame: range.startFrame + Math.floor(index * count / active),
    endFrameExclusive: range.startFrame + Math.floor((index + 1) * count / active),
  }));
}
```

`packages/provider-html-local/README.md` 补充语义：**"Workers are independent browser processes and may start at any requested frame; they do not wait for an earlier worker to traverse the program."** 也支持**稀疏请求**（严格递增、非连续帧）。

**③ worker 数是一个公式，不是一个魔数**（`packages/provider-html-local/src/concurrency.ts`）：

```ts
export function autoWorkerLimit(cpu = availableParallelism(), memory = hostMemory()): number {
  // Chrome owns raster surfaces, decoded media and the JS heap in separate
  // processes. Leave half the memory and two CPU slots to the host/other stages.
  const byMemory = Math.floor(memory / 2 / (1.5 * 1024 ** 3));
  return Math.max(1, Math.min(Math.max(1, cpu - 2), byMemory));
}

export function renderWorkerLimit(config, frameCount: number, fps: number): number {
  return Math.min(config.maxWorkers,
    config.workers === "auto" ? Math.max(1, Math.ceil(frameCount / fps)) : frameCount);
}
```

**把 README 的"64"代进去核一遍 [推算]**：`ceil(frameCount / fps) ≥ 64` ⇒ 帧数至少是帧率的 64 倍。30fps 下需要 ≥1920 帧（64 秒）；60fps 下 ≥3840 帧。而 `maxWorkers` 还要 `min(cpu-2, 内存/3GiB)` ≥ 64，即 **≥66 个逻辑核 + ≥192GiB 内存**。所以"64 路并发"是在**长片 + 大机器**上的观察值，不是笔记本上的承诺。

**④ 显式配置优先，auto 只是默认**：`workers: "auto" | number`、`maxWorkers`、`defaultConcurrency`（Endpoint 池里**整个请求**的并发）、`browserCapacity`（跨已准入请求预留的 Chrome 槽位）。注意最后两个是两级的 —— 请求级并发和浏览器槽位是**分开的容量**。

**⑤ auto 模式是自适应爬坡的，而且不做合成标定**（`CaptureConcurrency`）。它的规则值得逐条读：

- 初始 `target = ceil(limit / 2)`，**从一半开始**。
- 每个 worker 至少 2 个 batch、且耗时超过一次浏览器启动的"有用功"才计入（"No synthetic calibration is rendered." —— **不为了标定而空渲**）。
- 加了一个浏览器，吞吐提升 <5% ⇒ **退回**。
- 减了一个，吞吐掉 <5% ⇒ 退回。
- 变慢的段落**不当作争用的证据**（"A slower passage is not proof of contention"）。
- 新浏览器必须"剩下的活多得能回本"，判据是 `remainingFrames / rate * 1000 > startupMs * (next + 1) * 2`。
- **"All samples and decisions die with this attempt. A change never invalidates captured frames."** —— 调参只影响本次 attempt，永不因调参丢弃已捕获的帧。

**⑥ 乱序捕获 → 有序输出**（`packages/provider-html-local/src/ordered-frame-sink.ts`）。这是让"64 个进程乱序出帧"和"ffmpeg 必须顺序吃帧"共存的关键：

- `#pending: Map<number, Uint8Array>` 按 ordinal 缓冲，`#nextOrdinal` 是前沿。
- 未来帧**等字节容量**（`maxPendingFrameBytes`，默认 256MiB），但**精确前沿永远放行**，空集时也接受一个超大帧 —— "so neither the order dependency nor a single large PNG can deadlock this render"。
- Provider README 定调：**"FFmpeg is the necessary local serialization point for one MP4 stream, not a scheduler or shared metadata service. Capture of later frames can continue while earlier frames are encoded."**

**⑦ 资源上限是一组具名预算**：`processTimeoutMs` 30min、`maxProcessOutputBytes` 4MiB、`artifactStagingConcurrency` 4、`maxPendingFrameBytes` 256MiB、`maxDecodedSourceBytes` 1GiB、`maxRenderedBytes` 16GiB。取消/失败时"closes page sessions, source leases, processes and resource I/O"，`WeightedCapacity` 是 attempt-local 的加权租约（cpu/内存/GPU 槽位），有 `peak` 统计。

**⑧ 互不干扰的隔离级别**：每个请求独占自己的临时目录、localhost server、Chrome 进程、解码帧存储和编码器。**"Nothing is shared across requests."** 源视频由 Provider 用 FFmpeg 按编译器的 `frameSources` 计划惰性解码、只在本次执行内共享、按 `maxDecodedSourceBytes` 租借 —— **"Chrome does not independently decode those same videos."** 这一条很重要：否则 64 个 Chrome 各自解码同一个源视频，内存直接爆。

**⑨ 就绪性判据**：截图前等页面 frame listener、声明的字体、动态图片解码、合成器稳定；范围限定在编译器发布的 capture root 上。

### 4.2 测试与回归

`docs/guide/testing.md` 用 Node 内建 runner（`node:test`，**不是 Jest/Vitest/Mocha**），glob 是 `packages/*/test/**/*.test.ts`。它的**准入规则**写得极清楚：

> "A test belongs in the default suite only when it protects an observable contract, an architectural boundary, or a failure mode that could corrupt work, **repeat paid execution**, or make an environment unsafe."

以及三条**禁令**（比"要写什么"更有价值）：

> "Do not add tests merely to **make every package appear covered**, mirror a Manifest array, preserve a removed pre-release flag or database shape, or exercise documentation-only UI helpers."
> "**Obsolete tests are deleted with obsolete behavior rather than retained as project history.**"
> "The repository **deliberately does not use source-text regex tests** as a substitute for dependency analysis or architectural review."

三种模式：纯编译测试（编一份 Author/Run Source，断言产出的图/导出/Records/plan steps，**绝不调外部服务**）、Provider 测试（对受控 fixture 打请求映射、媒体传输、任务推进**含失败路径**；真调用必须显式声明花费范围 —— "an available key alone does not authorize them"）、架构边界测试。环境门控测试要么显式 opt-in，要么不花不计费。

fixture 策略：`packages/<name>/test/fixtures/` 放真的 `.svml`/`.svs`/`.svrun`；`examples/` 本身就是集成级 fixture。跨包组装**用一份签入的图 fixture**，而不是在每一层重建同一个半成品视频。

禁止进仓库的东西也写明了："customer or brand fixtures, credential traces, **paid output artifacts**, absolute workstation paths or one-off delivery harnesses."

### 4.3 错误与失败处理

`docs/guide/conventions.md` 四条：编译失败抛错且**带源码位置**；运行时失败被记成 Build 状态机里的 **Operation failure**（而不是崩溃）；Provider 在服务协议允许的范围内自己做**有界传输重试**；**一次失败的 attempt 结束该 Build，后续用新的 Run + Build，并可显式选择已完成 Output 复用**。

`docs/guide/runtime.md` 把"执行与终端解耦"做到了工程上：Worker 拥有执行，`--follow` / `status --watch` 只是观察；关掉终端或 watch 超时不取消 Build。`hypit cancel <build-id>` 才停。远程取消是 best-effort。还专门有一段处理"执行完了但结果存储要处理"的半成品状态：`status` 会给出 `hypit result finish <build-id>` —— **补完保存，不重跑生成**。

---

## 5. 可借鉴点

### 5.1 把 `anim say` 升级成"词锚定"的时间 DSL —— **最值得抄的一条**

**① 对方怎么做的（带证据）**

作者在 Script 里写 `@{hair-gel} … @{/hair-gel}` 和 `@{trophy!}`，**不写任何秒数**；Script 值里"contains no timecodes"、"contains no seconds or frames"。求解分三段：Script 出 `2M+2N` 个语义锚 → WhisperX 出 `NarrativeAlignment`（锚点在媒体本地域的帧号）→ `semantic:Projection` 把 `alignment + domain + 等长 Window` 映射成绝对 `TemporalWindow`。消费者只写 `during={selection-hair-gel}`。六个亲和性标记 + `||` 表达 Cue 换气。改名后重跑 `say` + 重对齐，所有引用自动跟到新时间。

**② anim 现在缺什么**

anim 的 `anim say` **已经有词级时间戳**了（`tools/tts-edge.py` 走 edge-tts 的 `WordBoundary`，写进 `narration.json` 的 `lines[].words`，整片绝对时间，`type.karaoke` 已经在用）。**缺的不是测量，是"作者用词表达意图"的那一层语法。** 现在 `narration.mjs` 里写的是：

```js
{ id: 'hook', internal: 4.2,                 // ← 秒
  lines: [ { cue: 0.6, text: '先看一句话。' },  // ← 秒
           { cue: 2.6, text: '这串「嗷呜啊」，叫「兽语」。' } ] }
```

而 `cue` 是"说这句时画面该走到哪"、`internal` 是"画面最后一次揭晓的内部时刻" —— **这两个都是作者靠猜秒数填的**，随后由 `solveTiming` 反解 `stretch`/`slot`。`cut(scene, { dur: { vo: 'line-id' } })` 也只是"取某句的长度"，粒度是**句**，不是**词**。

**③ 搬过来要改哪里、代价多大**

这是唯一一条**低成本、不破坏现有架构**的落地路径。四步：

**(a) 给 `narration.mjs` 加一层锚点语法（不写秒）。** 保留现有字段做兼容，新增 `anchor`：

```js
// tasks/<任务>/narration.mjs —— 新增写法（时间全部由求解器算）
export const SCENES = [
  { id: 'hook',
    // 画面最后一次揭晓 = "兽语" 这个词说完的那一瞬
    reveal: { at: { line: 'hook-2', word: '兽语', edge: 'end' } },
    lines: [
      { id: 'hook-1', text: '先看一句话。' },
      { id: 'hook-2', text: '这串「嗷呜啊」，叫「兽语」。',
        // 说到"嗷呜啊"时画面切换到波形
        on: { word: '嗷呜啊', edge: 'start', action: 'wave-in' } },
    ] },
];
```

`@{…}` 那套 XML 标记**不要照抄**。理由是 anim 的旁白是 JS 对象不是 prose：Script 需要内联标记是因为它的输入是"一段散文"，而 anim 的输入已经是结构化 JSON，再加一层内联标记只会同时得罪编辑器和解析器。**抄的是语义（命名锚点 + 左右亲和），不是语法。**

**(b) 写一个纯函数求解器 `resolveNarration()`，复用已落的 `scripts/lib/say.mjs`。** 输入 = 上面的对象 + `narration.json` 的 `lines[].words`；输出 = 现在就有的 `timing.mjs`（`scenes[].slot` / `.stretch` / `.overlap`）+ 一份新的 `anchors.json`（`{ 'hook-2/兽语/end': 6.412 }`）。**关键：输出格式不变，场景侧一行都不用改** —— 还是 `const t = f.lt / (ctx.params?.stretch ?? 1)`。

**(c) 亲和性必须实现，这是"词锚定"最容易做漏的一半。** 中文 edge-tts 的 `WordBoundary` 给的是**词**的 `offset`/`duration`。当作者说"停顿归前一句"（左亲和）时，求解器要用**上一个词的 end**；说"归后一句"（右亲和）时用**下一个词的 start**。不实现这个，两个连续锚点之间那段静音就会被静默地归错，而且**不会报错** —— 正是 hypit 用 `~` 显式消歧要防的那个坑。

**(d) 与现有 `dur: { vo }` / `timing.mjs` / `stretch` 的关系**：**求解器早于 stretch 求解。** 顺序是：锚点 → 绝对毫秒 → 每段内部时刻 → 再算 `stretch`/`slot`。锚点表达的是**段内相对结构**（"这句话说完之后切"），`stretch` 表达的是**段整体的缩放**，两者正交、不冲突。唯一要注意的是：`stretch` 会把段内时间整体乘一个系数，所以锚点解出的段内偏移**也要乘同一个 `stretch`**，否则词和画面会错位。这一点必须在求解器里显式处理并写测试。

**(e) 风险（诚实说）**：
- **中文分词边界**。edge-tts 中文的 `WordBoundary` 切分不保证和作者心里的"词"一致。缓解：求解器**匹配不到就抛错并列出该句所有可用词**（这正是 anim 已经在做的事 —— "参数名写错会抛错，不会静默忽略"，风格一致）。
- **锚点太多会变成另一种秒数**。限制每段最多 2–3 个锚点，够用即可。
- **不能改变"旁白是唯一时间源"这条铁律**。锚点只表达"在哪个词上做什么"，**永远不能表达"持续 3 秒"**。一旦允许写秒数，`stretch` 求解就失去唯一解。
- **纯代码动画没有音频**。所以这个 DSL 必须在**无 `words` 时优雅降级**：有词级时间戳就用词锚，没有就退回秒，并**在 `check` 里警告"这一段用的是秒锚点，改词不会自动重排"**。

**④ 值不值：值，最高优先级。** 这是唯一一条**同时**满足"anim 已有全部前置数据"、"改动局限在 `narration.mjs` + 一个新求解器 + `solveTiming` 内一处"、"直接消灭作者每天靠猜秒数填 `cue` 的痛点"的建议。工作量估 **[推测]** 1–2 天（求解器 + 词匹配报错 + `test-say.mjs` 的离线回归扩展），不需要 GPU、不需要联网。

---

### 5.2 镜头/效果包机制

**① 对方怎么做的。** 组件 = Manifest/Surface/Fragment/Producer/Value+Style/Schedule+Drawing/Activation/Companion 八个角色；接口一律只吃绝对 Instant/Window；双版本号（逻辑 `@1` 接口版本 vs npm 物理版本）；默认住项目 `packages/`，要分享就 `npm pack` 或发 npm/私有 registry，**"A Hypit repository checkout or upstream pull request is not needed"**；官方 Distribution 与社区共享是**两条独立通道**，进官方要先开 issue 讲清"共享的产品需求"。样板是 `examples/minimal-author-package/packages/example-component`。

**② anim 现在缺什么。** 8 个模板硬编码在 `src/shots/`，`shot('名字', {...})` 的 `SHOTS` 表在 `src/shots/index.js`。**有参数校验，但没有契约、没有版本、没有分发。** 第三方无法投稿，也无法锁定"我要 `chart@1` 而不是三个月后的 `chart`"。

**③ 搬过来要改哪里、代价多大。**

**最小可行版本（建议只做这个）**：给每个 shot 补一个**声明的 spec**，其余不动。

```js
// src/shots/chart.js
export const spec = {
  name: 'chart', version: 1,
  params: {
    values: { type: 'array<number>', required: true },
    title:  { type: 'string', default: '' },
    peak:   { type: 'number', default: null },
  },
  // 声明它依赖什么、产出什么 —— 供 check 校验
  requires: ['music?'],           // wave/pulse/grid 需要 audio + analyze
  outputs:  { visual: true },     // 是否自己铺满整帧
};
```

然后 `anim check` 用 spec 做参数校验和依赖校验（"这一段是 `wave`，但任务没配 `audio`" 就能提前报出来，而不是渲染时黑屏）。**`shot('chart', {...})` 的调用签名一个字不用改**，`task.config.mjs` 的配置档写法也不用改。

**要真做成可分发**（不推荐现在做）：需要 (i) 把 `src/shots/` 抽成独立包、(ii) 定义作者写的 shot 如何注册进引擎（现在是 `src/shots/index.js` 里的静态表）、(iii) 处理"第三方 shot 要 `import` 引擎内部 API"的版本兼容。这三件事加起来是**一次架构手术**。

**④ 值不值：spec 值（小、便宜、立刻减少报错）；npm 分发不值（现在）。** 理由：anim 是**单仓项目**，8 个模板、一个作者（你 + agent）。hypit 需要包系统，是因为它面对"无数条不同的爆款视频 + 无数个客户"，每个项目都需要自己的组件边界。**先把契约写清楚（spec），等真出现"我要给第二支片子复用这个镜头"的需求时，再把它抽成包 —— 那时你已经有了 spec，抽包是机械工作。**

---

### 5.3 并发渲染 —— 有得抄，但要抄对地方

**① 对方怎么做的。** 见 §4.1。核心三件：编译器暴露 `applyFrame(绝对帧号)` 且"不要求顺序播放"；`distributeFrameRange` 切连续块、一 worker 一块、**可以从任意帧开工**；乱序捕获经 `OrderedFrameSink` 按字节预算缓冲、顺序喂给唯一的 ffmpeg；worker 数 = `min(cpu-2, mem/3GiB, ceil(frames/fps), maxWorkers)`；auto 从 `limit/2` 起爬坡、加浏览器不涨就退、**为标定不空渲**。

**② anim 现在缺什么。** `video --segments N` 是**本地分块 + 拼接 + 已渲块跳过**，单浏览器单页串行推帧。瓶颈已量过：**传输（NV12 后 3.11MB/帧）与 GPU 回读**。

**③ 搬过来要改哪里、代价多大。**

**关键判断：anim 已经具备了并发的全部前提，只差调度。** 因为铁律第一条就是"每一帧都是时间的纯函数，`render(t)` 只依赖 `t`"。这正好等价于 hypit 的 "workers may start at any requested frame"。

**最小可行版本：并行化已有的 `--segments`，不要重写推帧管线。**

`video --segments N` 的语义已经是"切点只落在段边界、且避开转场交叠 —— 每块都是完整的镜头"，而且"已渲好的块会跳过"。加一个 `--parallel K`：把要渲的块分给 K 个渲染进程（每进程一个独立的私有 Vite + 一个 Chrome）→ 每块独立出 mp4 到 `out/<任务>/_seg/K.mp4` → 全部完成后用现有的 concat 步骤合并。

**这条路复用了已经验证过的分块/跳过/逐块 ffprobe 复核逻辑，不需要引入 `OrderedFrameSink` 那套东西**（因为每块有自己的完整 mp4，块间不需要共享一个 ffmpeg 进程）。

**必须做的三件事**（漏一件就会踩 hypit 明确警告过的坑）：

- **每个进程必须有自己的私有 Vite 端口和临时目录。** anim 现在是"CLI 起一个私有 Vite"，两个进程会抢端口。hypit 的做法是每个请求独占 "temporary directory, localhost server, Chrome processes, decoded-frame store and encoder"。
- **`out/**` 是唯一被实测挡住的写入位置**。所以临时块**必须**写在 `out/` 下，绝不能写到仓库里。
- **内存上限**：hypit 的 `byMemory = mem/2/1.5GiB` 直接告诉我们经验值 —— **一个 Chrome 头进程按 1.5GiB 预留，并且只准用一半内存**。anim 的 `--parallel` 应该默认 `min(cpu-2, mem/3GiB, 段数)` 并且**默认不开**。

**为什么不要把 anim 改成"一个 ffmpeg 吃乱序帧"**：那是为**单块内部**的并行设计的。它带来的复杂度（有序汇、字节预算、前沿死锁防护、单帧超大不阻塞）**只有在"块内并行"时才划算**。先用块间并行拿到收益，等真需要再上块内。

**④ 值不值：值，但优先级低于 §5.1。** 收益 **[推测]** 2–4×。**风险中等**：并发写 `out/` 要注意 `_staging` 约定，以及每个进程的 `--gpu` 设置不要互相打架。**建议先做一件事验证收益**：手动起两个 `anim video <任务> --segments 10` 分别渲不同的段，量一下总墙钟是否真的接近减半。如果传输瓶颈是**单机总线/内存带宽**（而不是单进程），并发收益会远低于 2×——**这个必须先量，不要照搬。**

---

### 5.4 变体/批量 —— 有真机制

**① 对方怎么做的。** `README.md` 的 "One workflow, 100 variants" 拆开看是四件事：

- **`.svrun` 与 `.svml` 分离**：Source 描述工作，Run 选择 Target 和 Candidate。变体 = 同一份 Source 的另一个 Run。
- **显式复用已有 Output**：`<build-record id="reuse-manifest-media" build="ACTUAL_BUILD_ID" output="manifest-rule-media.media"/>` + `<satisfy output="..." candidate="reuse-manifest-media"/>`。
- **改一支片子的某一部分不需要重跑生成**：interview README 结尾明确写"Check `hypit plan` to confirm that the second render contains **no new image, voice, video or alignment requests**."
- **被审阅过的中间产物可以当成 Source 的输入**：一段人工核对过的对齐可以存成 Stored Value 再喂回去 —— `<value id="reviewed-manifest-alignment" type="@hypit/narrative-temporal@1#NarrativeAlignment" from="./reviewed/manifest-rule.alignment.json"/>`。**这允许"人改过的对齐"进入可复现的图，而不是变成一次性的手工补丁。**

**② anim 现在缺什么。** 变体没有一等支持。同一支片子的 10 个版本，现在只能靠复制任务目录。

**③ 搬过来要改哪里、代价多大。** **一条很便宜的改动**：

```js
// tasks/<任务>/task.config.mjs
export const variants = {
  'zh':   { /* 默认 */ },
  'zh-short': { timeline: [ /* 覆盖 */ ], palette: { signal: '#ff5a3c' } },
  'en':   { narration: './narration.en.mjs', style: 'paper' },
};
```

CLI 加 `--variant zh-short`：深合并覆盖 → 输出目录变成 `out/<任务>/zh-short/` → `check`/`video` 的产物全部按 variant 分目录。**`narration.json` / `timing.mjs` / `video --segments` 的块缓存都要按 variant 分目录**，否则会串味（这是最容易出 bug 的地方）。

**真正值钱的不是覆盖语法，是"素材复用"那半。** anim 的旁白是 `anim say` 现场合成的，所以"改一句词"现在会导致**整片重渲**。借鉴 hypit 的 Candidate 思路：让 `narration.json` 成为**可显式指定的输入**（"这一段用上次那份词级时间戳，不要重新合成"），那么换风格、换配色、换镜头顺序的变体就可以**零 TTS 成本**重出。

**④ 值不值：值，性价比仅次于 §5.1。** 工作量 **[推测]** 1 天（深合并 + 目录隔离 + narration.json 可指定）。

---

### 5.5 预览 / 时间窗口 / Studio —— **明确不建议抄**

**① 对方怎么做的。** `window.__hypitFrameProgram.applyFrame(frame)` 让预览器和渲染器共用同一个 ABI。时间窗口编辑（`docs/guide/studio-temporal-windows.md`）的核心是**反向求解**：每条时间声明都保留了它的作者来源，拖动时"Studio follows the executed Temporal graph to the exact author endpoints and commits every required source change together"。规则很讲究：`from+for` 移动时保持 `for`；裁前缘时原子改写 `from` 和 `for` 以保住原来的 end；`earliest`/`latest` 在需要替作者选分支时**保持只读**；未编辑的表达式**保留单位**。

**② anim 现在有什么。** `npm run dev` 浏览器实时预览已经是"同一份场景代码，两种宿主"了。**anim 缺的不是预览，是"从预览里改时间并写回源文件"** —— 但那需要一条完整的反向求解链，而 anim 的时间线是 JS 表达式，不是可反解的声明式图。

**③ 代价。** **[推测]** 极大。hypit 为此建了 `Studio Companion` 一整个 ABI、每类时间关系一个 Companion、`Temporal` 包专有的 `studio` 入口。

**④ 值不值：不值。** anim 的作者是 agent 和写代码的人，改时间就是改代码 + `still` 看图。**给一个"作者读代码"的引擎建 GUI 反向求解器，是在解决一个不存在的问题。**

**唯一值得偷的一条**：Studio 的 **`FEEDBACK.json` 约定**（`packages/studio/README.md`）—— 评论是**普通项目文件**，在 workspace 根下，字段就 `{ id, run, at, text, resolved }`，`at` 是秒（含小数），Studio 读它、写它、文件变化走 fs 事件刷新、不轮询不重编译。**anim 完全可以在 `out/<任务>/` 或任务目录下加一个同构的 `NOTES.json`，让 agent 和你都能标注"第 12.5 秒这里字幕太小"**，成本 **[推测]** 半小时。

---

### 5.6 约定与测试 —— 两条现成的好规则

**对方的做法（`docs/guide/testing.md` 准入规则）：**

> "Do not add tests merely to make every package appear covered… **Obsolete tests are deleted with obsolete behavior rather than retained as project history.**"

以及 `docs/guide/conventions.md` 的"禁止环形生产依赖"、"根 tsconfig 无中央 paths 注册表"。

**anim 现在有**：`node tools/regress-all.mjs` 一条命令跑完整个回归清单、`test-timeline-guard.mjs`、`test-say.mjs`、`scene-harness.mjs`、一整套 `probe-*.mjs` 量具。**这套东西已经比 hypit 的测试策略更贴合 anim 的实际风险（GPU/确定性），不需要替换。**

**值得抄的只有两条**：

1. **删掉过期测试，而不是留着当历史**（`docs/history/` 已经承担了"历史"这个职责，测试不需要再当一次）。
2. **"重复付费执行"作为写测试的判据** —— anim 的对应物是"重复长时间渲染"。hypit 的"跨包组装用一份签入的图 fixture"直接对应 anim 的做法：**不要每个 probe 都重建一个任务，用一份签入的 `tasks/_lab-*` fixture**。这已经在做了（`_three-lab`、`_three-calib`、`_post-lab`、`_style-sampler`），**保持即可**。

---

## 6. 不适用 / 别照抄的

**① 它重依赖生成模型与真人素材，而 anim 是纯代码确定性。** 三个示例里，football ranking 生成 1 张主持人图 + 8 张 B-roll + 2 段带音频的表演 + 1 个音色设计；podcast 生成 9 张图 + 2 个音色 + 4 段视频；interview 生成 3 张图 + 2 个音色 + 3 段视频。它自己的 README 把这条当卖点写（"Clone any viral video"）。**而 anim 的立身之本是"不需要图片素材、不需要视频素材、没有扩散模型"。** 这不是"两条路"，是**两种产品**。凡是把 anim 往"生成素材"方向拉的机制（`text:Value` 提示词、`gpt:Image`、`seedance:ReferenceVideo`、`fish:VoiceDesign`）一律不要引入 —— 引入一个就会有人开始往里塞提示词，然后 `check` 的"确定性"保证就废了。

**② 词锚定依赖"真实可测量的音频"，纯代码段用不了。** 这是**技术限制而非偏好**：`semantic:Projection` 要求 `alignment + domain + 等长 Window`，而 `packages/timeline-author/README.md` 明文："A length mismatch is an error; projection does not **clip, loop, hold, stretch, resample** or hide a source tail." **完全没有 stretch。** 而 anim 的 `solveTiming` 核心恰恰是 `stretch`（`MAX_STRETCH = 1.9`）。**这是两套根本不同的时间哲学：hypit 的媒体是对的、画面去适配词；anim 的画面是对的、旁白去适配画面（通过 stretch）。** 所以 §5.1 建议的是"**在 `stretch` 之前**插入词锚点求解"，**不是**"把 stretch 换成词对齐"。真要照抄它的"等长、不许拉伸"，`solveTiming` 就会天天抛错 —— anim 的旁白是 TTS 合成后量出来的，长度天然不由画面决定。

**③ 它是"克隆爆款"的商业取向，和"科普信息密度"冲突。** 它的成功判据是 `1 command, 100 variants, 100M views`、`$1.15` 成本。它的画面逻辑是**抓注意力的结构复用**（卡点、闪白、逐词 karaoke、emoji reveal board、head-tracked captions）。而 anim 的信息分工是**反的**（`docs/CAPTIONS.md`）："画面文字只放标注"、"**别做逐词高亮**"（12 分钟/96 人对照实验里关键词突显是负效应）、`captions: true` 之后引擎自动画字幕。**hypit 的 caption 体系（`caption-fine` 的 Flow/Point/Path、Use 时序、Role 过滤、逐词高亮）整体不适用，不要搬。** 特别注意：它 interview 那支片子的 caption 是**由人脸检测驱动**的（Google Video Intelligence 人脸框 + YOLOv8 AnimeFace），这条和 anim 的"字幕保留带是保留区、别把面板放进去"是两套完全不同的排版哲学。

**④ 许可证条件。** 见 §1。三条要记住：**多租户禁令**（两个外部主体的独立 workspace 就算多租户，免费也算）、**商业再分发禁令**（不得为商业利益供应其衍生作品，fork 可以但必须同许可证）、**LOGO 不可去除**（不得改 CLI/run report/manifest 及其派生界面的名称与 LOGO）。**产出物归使用者、无附加条件**（第 3 条）。结论：**抄机制不抄代码**；anim 如果是自用或给客户做片，完全没问题；一旦对外提供，切勿携带其代码。

**⑤ 别把"渲染后端的工程细节"当成"语言设计"来抄。** `OrderedFrameSink` 的字节预算与前沿放行、`CaptureConcurrency` 的爬坡退让、`WeightedCapacity` 的加权租约、`maxPendingFrameBytes`/`maxDecodedSourceBytes`/`maxRenderedBytes` 那一整套预算 —— **这些是"一个多租户渲染服务"的必需品，不是"一个动画引擎"的必需品。** anim 是单机、单用户、一个任务一渲。抄它的 `distributeFrameRange`（10 行）就够了；抄它的调度器会得到一个没人维护的复杂度。同理 `CaptureConcurrency` 里最精彩的那句 —— **"A slower passage is not proof of contention. No synthetic calibration is rendered."** —— 值得学的是**这个判断**（不要为标定空跑），不是那段 60 行的状态机。

**⑥ `||` 用于字幕换气，是字幕需求不是时间线需求。** 它的 `||` 是 Caption Cue 分隔符，原文反复强调"it does not split the Segment, cut the picture or end a Selection"。anim 的字幕由引擎层自动生成（每行 ≤16 字、最多 2 行、Netflix 简体中文规范），**作者本来就不该手控换行**。不要引入。

---

## 7. 一句话结论

**对 anim 最值得抄的一件事：把 `anim say` 的旁白时间线从"秒"改成"命名词锚点"—— 作者写"这句话说到『兽语』时切镜头"，一个提前跑的求解器把它变成现有的 `timing.mjs`，因为 anim 已经拿到了词级时间戳，缺的只是语法和那个函数。**

一句话的理由：其他所有可借鉴点（包机制、并发渲染、变体）都是**加上去的能力**，而这一条是**把你现有的能力兑现** —— 你的 `narration.json` 里那串 `lines[].words` 现在只喂给了 `type.karaoke`，而它真正的价值是让 `narration.mjs` 里那些靠猜填的 `cue: 0.6` / `internal: 4.2` 永远消失。
