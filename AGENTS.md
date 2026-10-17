# 写给大模型的确定性代码动画引擎

> **这个文件是给 AI agent 看的操作契约。** 你要做的任何事——渲染一帧、做一支片子、加一个效果——都以这里写的命令和规则为准。更细的 API 参考见 `docs/ENGINE.md`，常见效果的做法见 `docs/COOKBOOK.md`。

---

## 0. 这是什么

一句话：**写代码就是做动画。** 不需要图片素材、不需要视频素材、没有扩散模型 ——
画面默认由 WebGL2 着色器与几何实时算出来，导出时用无头 Chrome 逐帧渲染、ffmpeg 编码。

> **"不需要素材"≠"不能用素材"**：真实素材（团队 logo、产品截图、照片、纹理）可以当成**一张图层**画进来 ——
> 加载成纹理后 `comp.draw(gl, tex, ctx.out, { rect, opacity, tint })`，或者直接画进 `ctx.text.ctx`
> （Canvas2D 的 `drawImage`，最省事）。做法与坑见 `docs/COOKBOOK.md` §9。
> 对外材料里，**真 logo / 真截图通常比手画一个更像**；代价是它要等 IO —— 加载一律在
> `setup`（可以 `async setup`）里做完，`render` 里不许有异步。

为什么这件事能成立，关键只有一条：

> **每一帧都是时间的纯函数。** `render(t)` 只依赖 `t`，不依赖上一帧、不依赖墙钟、不依赖随机。

这一条换来四件事：可以任意 seek、可以多子帧并行求平均做真运动模糊、预览和成片逐像素一致、渲染可以随时中断重来。

```
文字/脚本 ──▶ 代码（JS + GLSL） ──▶ 浏览器里的实时渲染器 ──▶ 无头 Chrome 逐帧 ──▶ ffmpeg ──▶ mp4
                     ▲                                        │
                     └────────── agent 看图/看片再改 ◀──────────┘
```

**你的工作循环就是最后那条箭头：改代码 → 渲染 → 用 Read 工具看图 → 再改。** 不要凭空想象画面长什么样，一定要出图看。

---

## 1. 三条命令先跑起来

```sh
npm install                                     # 第一次

node scripts/anim.mjs tasks                     # 列出所有任务（一支片子 = 一个任务）
node scripts/anim.mjs shots [名字]              # 列出镜头模板（A 档镜头库）与参数
node scripts/anim.mjs still demo -t 1,6,9.5     # 出单帧 PNG（agent 主要靠这个看效果）
node scripts/anim.mjs shot  demo --from 0 --to 6   # 出短 mp4（快速看运动）
node scripts/anim.mjs video demo                # 出完整成片（默认自动运动模糊）
node scripts/anim.mjs check demo                # 体检：静态检查 + 逐段试渲染 + 亮度统计
npm run dev                                     # 浏览器里实时预览（空格播放、[ ] 换段）
```

出图落在 `out/<任务名>/`。**渲染完立刻用 Read 工具打开那些 PNG 看** —— 这是唯一可靠的验证方式。

> **前置条件**：本机要有 **Chrome**（`playwright-core` 走 `channel: 'chrome'`）与 **ffmpeg / ffprobe**（在 PATH 里，或用
> `ANIM_FFMPEG` / `ANIM_FFPROBE` 指定）。CLI 会自己起一个私有 Vite 服务并 spawn 无头 Chrome，
> 再通过管道读它的输出 —— **在受限沙箱里（例如只允许写工作区的那档）会直接 `spawn EPERM`**，
> 而报错位置在 `openSession`，看不出是权限问题。另外在 PowerShell 里**别用管道接原生程序的输出**
> （`node scripts/anim.mjs ... | Select-Object` 会被以"命名管道"为由拒绝）—— 直接跑，让输出自己打印。
> （`docs/history/IMPROVEMENTS-1-3.md` 第一轮 §5）

---

## 2. 建一个新片子

有**两条路**。先试第一条——大多数片子用第一条就够了。

> ### ★ 动手之前先决定两件事（`docs/STYLE.md` / `docs/CAPTIONS.md`）
>
> **① 这支片子用哪套风格？** 一行 `style: 'paper'` 就换掉整片观感（配色 / 字体栈 /
> 背景母题 / 后处理基线 / 版面栅格 / 字幕样式一起换）。可选的：`node scripts/anim.mjs styles`。
> **相邻两支片子尽量不要用同一套** —— 11 个镜头模板加上默认调色板，是一整支旧片子的逐像素冻结副本，
> 连着用两支，观众看到的就是"又是这个味"（审美疲劳的来源，不是引擎画不出来）；风格契合时先问用户。
> 不写 `style` 时等于 `print`（= 引擎从前的默认观感，老任务一像素不变）。
> 想先看效果：`node scripts/anim.mjs still _style-sampler -t 1.8,6,9.6 --style paper`。
>
> **② 有旁白吗？字幕交给引擎。** `captions: true` 之后，引擎每帧自动画当前那句旁白
> （位置来自风格包的**字幕保留带**），场景里**一行都不用写**。
> 而**画面文字只放标注**（名词 / 数字 / 单位 / 出处）—— 句子交给旁白与字幕。
> 画面上的说明文字与语音字幕说同一句话，就是观众反馈里"两条字幕同时出现，看着好迷糊"
> （sodium 43 句旁白里有 12 句被逐字抄成了画面说明条）。
> 交付前跑 `node tools/lint-narration-dup.mjs <任务>` 自查。

### 2.1 配置档（推荐先试）：只写 `task.config.mjs`

时间线里**直接写镜头模板**，一个任务可以只有 `task.config.mjs`、**没有 `scenes/`**、整个文件**没有任何 `import`**：

```js
// tasks/<任务>/task.config.mjs —— 唯一需要编辑的文件
export default {
  title: '我的片子', width: 1920, height: 1080, fps: 60, scale: 1,
  style: 'paper',                                // ← 风格包（anim styles 看全部；不写 = print）
  captions: true,                                // ← 引擎字幕层（有旁白时开；见 docs/CAPTIONS.md）
  timeline: [                                    // 数组、seq([...]) 都行
    { type: 'title', title: '我的片子', sub: '副标题', dur: { beat: 8 } },
    { type: 'chart', values: [0.3, 0.7, 0.95], title: '成绩', dur: 5, id: 'bars' },
    { type: 'outro', dur: 3 },
  ],
};
```

这条路**不用跑 `node scripts/anim.mjs new`**（那是第二条路的脚手架）：建目录、写这一个文件，
然后 `node scripts/anim.mjs check <任务>` → `still <任务> -t …` → `video <任务>`。
节点上能写什么、默认值是多少、写错会怎么报、什么时候必须回去写场景 —— 见 **§3.2**；
教程 `docs/CONFIG-ONLY.md`，可以照抄的完整示例 `tasks/example-config-only/`（只有 `task.config.mjs`）。

### 2.2 手写场景：`anim new` 的脚手架

模板覆盖不到的视觉只能写代码，走这条：

```sh
node scripts/anim.mjs new 我的片子
```

会生成：

```
tasks/我的片子/
  task.config.mjs        ← 片子的总配置（尺寸、帧率、调色板、音乐、时间线）
  scenes/title.js        ← 第一个场景
  scenes/shapes.js       ← 第二个场景
  audio/                 ← 放音乐（可选）
```

改这两个文件就能出片。**不需要动 `src/` 里的引擎**（除非确实要加底层能力）。

> **要写多少代码？** 常见镜头现在是**一行**——A 档镜头库 `src/shots/` 有 11 个参数化模板
> （`title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid` `quote` `counter` `compare`），场景文件退化成「取模板 + 给参数」：
>
> ```js
> // tasks/<任务>/scenes/chart.js
> import { shot } from '../../../src/shots/index.js';
> export default shot('chart', { values: [0.3, 0.7, 0.95], title: '这一轮的成绩' });
> ```
>
> 有哪些模板、参数叫什么、默认值是多少：`node scripts/anim.mjs shots`（全部）、
> `node scripts/anim.mjs shots chart`（某一个的全部参数与默认值）。**参数名写错会抛错**，不会静默忽略。
> 需要新视觉时照旧写场景代码（§3）。
>
> **比这更省事的是「配置档」（B 档，已落地）**：连这个场景文件都不用建 —— 时间线里直接写
> `{ type: 'chart', values: [0.3, 0.7, 0.95], dur: 5 }` 就行，见 §3.2 与 `docs/CONFIG-ONLY.md`。
> 镜头库之外的省事办法：整支片子特有的视觉母题放进该任务的 `scenes/_kit.js`。

---

## 3. 一个场景长什么样

场景就是「给定时刻 t，把这一帧画进 `ctx.out`」的纯函数：

```js
// tasks/<任务>/scenes/xxx.js
import { css } from '../../../src/core/util.js';

export default {
  id: 'xxx',                       // 唯一名字，会出现在 HUD 和报错里

  setup(ctx) {                     // 只调用一次：建 shader、建几何、预计算
    this.dots = [...];             // 需要随机就用 rng(seed)，不要 Math.random
  },

  render(ctx) {
    const { f, gl, P, text, type, comp, lines } = ctx;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);   // 背景（必须整帧覆盖）

    lines.begin();                                        // 矢量图形
    lines.seg(100, 100, 800, 100, 3, P.signal);
    lines.flush(ctx.out);

    text.clear();                                         // 文字图层
    type.write('写代码，就是做动画', 100, 400, {
      size: 96, weight: 800, family: 'sans',
      color: css(P.bone),
      stagger: 0.06, from: 'up', t: f.lt,                 // 逐字上浮入场
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.4, grain: 0.03 };                    // 这一帧的后处理参数（可选）
  },
};
```

时间线把场景串起来：

```js
// tasks/<任务>/task.config.mjs
import { seq, cut } from '../../src/timeline.js';
import { worldPass } from '../../src/kit/index.js';
import title from './scenes/title.js';
import shapes from './scenes/shapes.js';

// 可选但强烈推荐：全片共用的一层背景（切镜头时"世界不跳"的关键）。
// 声明了它的段（`cut(shot, { world: 'auto' })`）由**引擎**每帧先铺背景，场景不必记得调用。
export const world = (ctx) => worldPass(ctx, { grid: 60, accent: ctx.P.cyan });

export default {
  title: '我的片子',
  width: 1920, height: 1080, fps: 60, scale: 1,   // scale 1..4（2 = 真 4K）
  palette: {},                                    // 可覆盖调色板，如 { signal: '#00e0ff' }
  // audio: './audio/track.mp3',                  // 有音乐就能踩拍子
  // fonts: './fonts/brand.css',                  // 任务自带字体（不必去改全局 public/fonts/）
  timeline: seq([
    cut(title,  { dur: 4, world: 'auto' }),
    cut(shapes, { dur: 6, world: 'auto', params: { variant: 'grid' } }),
    cut(others, { dur: 3, overlap: 0.5, handlesTransition: true, world: 'auto' }),  // 重叠 = 转场
  ]),
};
```

---

## 3.2 配置档（B 档）：时间线里直接写镜头模板

**不写场景文件**：时间线的每一项可以直接写 `src/shots/` 的镜头模板。一个任务因此可以只有 `task.config.mjs`（见 §2.1）。

形状与 §2.1 那份**逐字相同**（`type` 是模板名、其余键是模板参数，没有任何 `import`），
只是不写 `style` / `captions`：

```js
  timeline: [{ type: 'title', title: '我的片子', dur: { beat: 8 } }, { type: 'outro', dur: 3 }]
```

**判据**（`src/timeline.js` 的 `isConfigNode()`）：节点是**对象**、`type` 是**字符串**、**没有 `scene`**。
带 `scene` 的照旧走 §3 / §3.5 那两条路。

**节点上的键分两类** —— 分错了就是报错，不会静默：

| 类别 | 键 | 说明 |
|---|---|---|
| **时间线字段** | `type` `id` `dur` `at` `overlap` `params` `post` `maxSamples` `handlesTransition` `note` `world` `worldPass` | 与 `cut(scene, { … })` 的第二个参数同义。⚠ `maxSamples` 是自适应子帧数的**上限**（合法档 8 / 24 / 72 / 216）、**只会往下压** —— 它是**提速**旋钮，**不是"加密采样"**：写 `maxSamples: 64` 会被夹到 24，画面更粗且不报错；拖影要更细就调**小** `--tol`。`world: false` 是合法声明（"这一段我刻意不铺底"，背景守门**不判**它的铺底、但会照常打出读数），别为了骗过 `check` 去画一笔没意义的全屏 Pass |
| **模板参数** | **其余所有键** | 原样交给 `shot(type, { … })`；也可以显式写在 `params: { … }` 里（`params` 优先） |

- `type`：模板名，共 11 个 —— `title` `chart` `kinetic` `whip` `outro` `wave` `pulse` `grid`
  `quote` `counter` `compare`。
  名字就是 `SHOTS` 的键（也就是 `shot('名字')` 的那个名字）。
- `id`：不写 = 模板自己的默认段名（重名自动加 `_2`）。**`--only` / HUD / 报错里用的就是这个段名。**
- `dur`：不写 = **4 秒**（与 `cut(scene)` 一致）；也接受秒数 / `{ beat: n }` / `{ bar: n }` / `{ vo: 'line-id' }`（取某句旁白的长度）。
- **需要音乐的三个模板**：`wave` `pulse` `grid`。任务要在 `task.config.mjs` 里配 `audio`，并且**先跑** `node scripts/anim.mjs analyze <任务>`；没有分析结果时画面会黑。
- **转场**：`whip` **自带 `handlesTransition: true`**（它读上一段的成帧 `ctx.under` 来甩），所以只要给它交叠：
  ```js
  { type: 'whip', dur: 1, overlap: 0.5 },   // ← 甩镜转场；不需要自己再写 handlesTransition
  ```
  别的模板要转场就写 `overlap`（引擎默认交叉溶解；文字量大的画面别用交叉溶解，见 §4.5）。配置档节点上也可以显式写 `handlesTransition` / `post` / `maxSamples` / `world`，语义与 `cut()` 完全一致。
- 配置档节点**可以和 `cut(场景, {…})` / `seq()` 混在同一条时间线里**（`shot(...)` 返回的就是普通场景对象）；
  但**不能**和「已经展开好的段」（手搓的、带 `start`/`end` 的那种对象）混写 —— 见下面的报错。
- **查参数**：`node scripts/anim.mjs shots`（列全部模板）、`node scripts/anim.mjs shots chart`（某个模板的全部参数与默认值）。

**写错就抛**（不静默吃默认值）。`{ type: 'chart', value: […] }`（少个 `s`）会得到这样一条报错 ——
`tasks.js` 加上"哪个文件"、`timeline.js` 指出是数组第几项、`shots/index.js` 列出可用参数：

```
tasks/<任务>/task.config.mjs 的时间线不合法：
timeline[1] 这一段（type: "chart"）取不到镜头模板：
  镜头模板 "chart" 没有参数 "value"（大概是拼错了）。可用参数：id / values / title / sub / footer / peak
```

模板名写错时，同一位置会是：

```
timeline[0] 这一段（type: "quote2"）取不到镜头模板：
  未知的镜头模板 "quote2"。可用的：title / chart / kinetic / whip / outro / wave / pulse / grid / quote / counter / compare（看参数：node scripts/anim.mjs shots <名字>）
```

把配置档节点和「已经展开好的段」混写时：

```
时间线里不能混写「配置档节点」和「已经展开好的段」：
  · 配置档节点 = { type: 'chart', values: […], dur: 5 }（要由 build() 排时间）；
  · 展开好的段 = { id, scene, start, end, … }（绝对时间是有意义的）。
  build() 会把后者也当成一个节点重新排，它的 start/end 就被静默丢掉了。
  → 统一成一种写法：都写配置档，或者都写 cut()/seq()。
```

（时间线的每一项还会先过一遍 `assertNode()`：既不是 `cut()/seq()/par()` 的返回值、也不是配置档节点、
又没有时长的手写段，一律抛错并提示"你是不是忘了调 cut()？"。）

**什么时候必须回去写场景**：模板只有这 11 个，参数只能调它们**本来就有的画面**。要新视觉
（raymarch 晶格、燃烧的引线、某支片子特有的母题）就回 §3 手写场景 / §3.5 的 `makeShot`；
要自己掌控转场与背景时同理。**别为了"纯配置"把模板撑成万能 DSL。**

**离线回归**：`node tools/test-timeline-guard.mjs`（纯 JS，不需要 GPU / 浏览器）管的就是"时间线写错必须抛"。

---

## 3.5 引擎自带的镜头工具：`src/kit/`

以前每支片子都要重抄一份 `_kit.js`（两份任务各约 450 行，语义几乎一样），第二次照抄还漏了画背景
（9 段里 8 段纯黑）。通用件现在在引擎里：

```js
import { makeShot, put, fade, typed, panel, kicker, footer, marker, reticle,
         makeWorldKit, cameraPost, enterOffset, worldPass } from '../../../src/kit/index.js';
```

最省事的写法是 **`makeShot`**：它把"一个镜头该有的骨架"（声明 handlesTransition、画共享背景、
交叠期把上一帧甩走、一台走完全片的摄影机）全包好，场景只需要画前景：

```js
import { makeShot } from '../../../src/kit/index.js';

export default makeShot('chart', {
  setup(ctx) { this.bars = [...]; },                   // 可选，只调一次
  draw(ctx, { k, dx, dy, enter }) {                    // 背景：任务声明了 world（+ world: 'auto'）时已由它铺好；没声明就自己铺，否则是纯黑且不报错
    const { f, lines, text, type, P, comp, gl } = ctx;
    lines.begin();
    // …画这一段的矢量（坐标加上 dx, dy 让它从反方向落位）…
    lines.flush(ctx.out);
    text.clear();
    type.writeLine('标题', 960, 400, { anchor: 'center', size: 96, color: css(P.bone), ...enter(0.3) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });
    return { bloom: 0.3, grain: 0.02 };                // 这一帧的 post（可选）
  },
});
```

`makeShot` 返回的仍是一个普通场景对象，所以**模板镜头和手写场景能混在同一条时间线里**。

| 想要 | 用什么 |
|---|---|
| 一个完整镜头的骨架 | `makeShot(id, { setup, draw, post })` |
| 一个 **Three.js 镜头**（真网格，第 3 种 3D） | `makeThreeShot(id, { camera, setup, update, overlay, post })`（见 §5.5 ③ 与 `docs/THREE.md`） |
| 一个现成的整镜头（画面本身） | `shot('chart', { values: [...], title: '…' })`（A 档镜头库 `src/shots/`，也可直接写进时间线） |
| 只要背景 + 转场 | `makeWorldKit(ctx)` → `wk.openFrame(ctx)` |
| 按锚点写整行字 | `type.writeLine(text, x, y, { anchor })`（⚠ `type.write` 的 `align` 是**逐字**生效的） |
| 整行淡入 | `fade(f.lt, delay)` → `{ alpha: [0,1], t, staggerDur }` |
| 面板 / 眉标 / 页脚 / 准星 / 标记 | `panel` `kicker` `footer` `reticle` `marker` |
| 填充矩形（一条批） | `lines.fillRect(x, y, w, h, [r,g,b,a])` |
| 协议名 / 参数 / 命令行那种"代码行"排版（分段着色、等宽） | `codeRow(type, [{ s: 'GET ', c: css(P.ash) }, { s: '/v1/items', c: css(P.signal) }], x, y)` |
| **带回弹的落位**（弹簧手感，不用自己积分） | `spring(f.lt - t0)` → 0→1，**指数弹簧的解析解**（`src/core/util.js`；想更弹 `spring(f.lt - t0, 1, 140, 12)`） |
| 有机的漂移 / 呼吸 / 轻微不规则的抖动 | `noise1/2/3`、`fbm1/fbm2`（确定性；`setup` 里预算或每帧算都行） |
| 半透明 / 把某个颜色提亮到发光 | `withAlpha(P.signal, 0.18)`（`lines` 的第 4 个分量）、`mul(P.bone, 1.6)`（>1 才泛光） |
| 全片摄影机的方向 / 数值 | `cameraAt(t)` / `cameraDir(t)`（`kit/world.js`；`cameraPost(t, extra)` = `cameraAt` + 你自己的 post） |

⚠ **`makeShot` 与镜头库模板是两条平行的路**：`src/shots/` 的模板自己就铺满整帧（自带背景），
所以别把模板塞进 `makeShot().draw()` 里 —— 那会覆盖掉 `makeShot` 铺的背景。一段里二选一，详见 `docs/ENGINE.md` §14.5。

---

## 4. 铁律（违反会导致成片随机出错，而且通常不报错）

| 禁止 | 原因 | 正确做法 |
|---|---|---|
| `Math.random()` | 一帧会被拆成多个子帧乱序渲染，每子帧都调一次，结果抖动 | `rng(seed)`（`setup` 里预计算） |
| `Date.now()` / `performance.now()` | 时间只能来自 `f.t` | 用 `f.t` / `f.lt` |
| 逐帧累积状态（`this.x += v*dt`） | 子帧乱序、可任意 seek，累积值无意义 | 把位置写成**时间的函数**，例如 `x = f(t - birth)` |
| 按帧抖动用 `Math.floor(t*60)` | 一帧内所有子帧会取到不同值，出现双重曝光 | 用 `f.idx` |
| **拿逐帧白噪声当"手持"**（`shake: [(hash2(f.idx,1)-.5)*2*amp, …]`） | 60fps 下每 16.7ms 跳到一个**新位置** = **振动**，不是手持 —— 幅度只有 5px 也会被用户说成"像地震"（`docs/history/IMPROVEMENTS-1-3.md` 第三轮） | 抖动用 `shakeSmooth(f.t, amp)`（`src/core/cam.js`，**是 t 的平滑函数**）；真要震屏/冲击才用逐帧噪声，且写成 `handheld(cam, f.t, f.idx, { mode: 'grain' })` |
| 场景里不 `text.clear()` 就画 | 上一帧的字会叠上来 | 每帧开头 `text.clear()` |
| 一帧多段共存时共用 `engine.text` | 每段场景有自己的 `ctx.text`，别用引擎的 | 一律用 `ctx.text` / `ctx.type` |
| 声明了 `handlesTransition` 却不铺整帧背景 | 那一段的底是**纯黑**（只有 grain 和暗角），而且不报错 —— fidus 那次 9 段里 8 段这样 | 写 `cut(shot, { world: 'auto' })` 让引擎铺；或自己画一次全屏 Pass；`check` 会报出来 |

`f` 上已经给你准备好了：`t`（整片时间）、`lt`（段内时间）、`p`（段内进度）、`idx`（帧号）、`seed`、`beat` / `bar` / `beatPhase`、`a`（音频特征快照）、`tin` / `tout`、`start` / `end`。

> **`tin` / `tout` 的准确含义**（容易误解）：
> `tin` = 与上一段重叠时，**本段入场进度**（0→1）。
> `tout` = 与下一段重叠时，**下一段压进来的程度**（本质是「本段被顶掉多少」）；没有重叠时恒为 0。

---

## 4.5 让片子「像一支片子」而不是幻灯片

一切镜头就"跳"，**通常不是引擎问题，是剪辑设计问题**：每个场景各建背景、各写 post，
一切换世界就变了；切点还配 flash+zoom，于是每次切换都在"顿"一下。

`src/core/trans.js` 里有一套验证过的配方（做 NekoHome 那支 48 秒片时总结的），四条缺一条就露馅：

1. **全片只有一层背景** —— 同一个 shader、参数**只由整片时间 `f.t` 驱动**（不是 `f.lt`）。
   于是切点两侧的背景逐像素一致：世界没变，只有前景在换。
2. **全片一台摄影机** —— `cameraPost(f.t, {…})` 交给 post 的 `zoom`/`shake`，全帧一起动，切镜头时它不会断。
3. **一个走完全片的母题** —— 一条指针 / 一道扫描线 / 一颗星。眼睛有得跟，切了也像没切。
4. **交叠期把上一帧甩走**，不是原地淡出；新内容从**反方向**落位（`enterOffset`）。

```js
import { makeTransitionKit, cameraPost, enterOffset } from '../../../src/core/trans.js';

export default {
  id: 'shot_a',
  handlesTransition: true,                     // ⚠ 不写引擎会先做交叉溶解（见 §4 铁律）
  setup(ctx) { this.tk = makeTransitionKit(ctx); this.world = /* 全片共用的背景 Pass */; },
  render(ctx) {
    const { f } = ctx;
    const k = this.tk.openFrame(ctx, this.world);   // 画背景 + 把上一帧甩走；k = 入场进度
    const [dx, dy] = enterOffset(f.t, k, 220);      // 前景从反方向落位
    // …画这一段的画面（文字/矢量坐标加上 dx, dy）…
    return cameraPost(f.t, { bloom: 0.34, grain: 0.02 });
  },
};
```

时间线上让两段重叠即可：`cut(shot_b, { dur: 6, overlap: 0.6, handlesTransition: true })`。

> ⚠ **文字量大的画面不要用交叉溶解**（引擎默认的那个）：两屏字叠在一起会糊。
> 必须让旧的"走掉"——这正是 `transitionPass` 存在的理由。

**另一种更省事的"一台摄影机"**：`ctx.setXform({…})` 把这一段整张 `ctx.out` 当一组做变换 ——
它**做不出视差**（分层视差要把偏移乘进每层自己的坐标），是整层运镜与整层透视的入口。
详见 `docs/ENGINE.md` §3.5 与 §3.7.5。

---

## 5. 四个主力工具

| 工具 | 用途 | 关键点 |
|---|---|---|
| `lines`（LineBatch） | 矢量图形：线、折线、圆、矩形、填充矩形、刻度 | 颜色是**线性**值 `[r,g,b]` 或 **`[r,g,b,a]`**（`a` 是真半透明叠加），可以 >1 让它发光；`fillRect` 是填充；一次 `flush` 就是一次 draw call；容量 6 万条 |
| `text` + `type` | 文字排版 | `type.write` 逐字动画；`type.writeLine` **按锚点写整行**（`write` 的 `align` 是逐字生效的，别用它做居中）；`type.karaoke` 逐词同步；`type.wrap` 折行；画完必须 `text.upload()` 再 `comp.draw` |
| `new Pass(gl, glsl)` | 全屏 shader：背景、扭曲、后处理式效果 | shader 里直接写 `void main(){ fragColor = ...; }`；`GLSL_COMMON` 已提供 `vUv`/`t`/`res`/`FRAG_PX`/调色板常量 `C_INK` `C_SIGNAL`…/噪声/SDF |
| `comp.draw(gl, 图层, out, opts)` | 叠图层 | `mode: 'normal'\|'add'\|'screen'\|'multiply'\|'max'`；Canvas2D 图层传 `premult: false` |

后处理参数（`return { ... }` 或写在 timeline 的 `post` 里）。
**方向与单位**（写错方向是高频坑 —— 曾经把"从黑淡入"写成 `fade: 1 - prog(...)`，结果整场全黑）：

| 参数 | 0 / 1 的含义 |
|---|---|
| `exposure` | 1 = 不变，2 = 亮一倍 |
| `shoulder` | 软肩**起点**（0.85 胶片感，越高越硬）。⚠ 实测输入 1.0 就输出 254、2.0 并到纯白 —— 高光多的画面靠它救不回来 |
| `tonemap` | `'off'`（默认）/ `'agx'` / `'aces'`：高光滚降算子，与 `shoulder` **二选一**。`'agx'` 高光层次最好但霓虹去饱和，换它一般要配 `exposure: 0.75`（ACES 配 `0.85`）。标定夹具 `tasks/_post-lab/`（`still _post-lab -t 1.5,4.5,7.5` 出三种算子的同图对比） |
| `bloom` / `halation` | 泛光/光晕**强度**，0 = 关 |
| `bloomThreshold` | 进入泛光的亮度阈值，**越高越只有极亮处发光** |
| `bloomRadius` | 泛光扩散半径**倍率**（1 = 基准，2 = 更糊更宽） |
| `bloomKaris` | true = 亮部提取用 Karis 加权（默认 false）：只有**亚像素级**孤立高光才看得出，标定卡上无差别 |
| `grain` / `vignette` | 颗粒幅度 / 暗角深度，0 = 关 |
| `grainScale` | `'screen'`（默认，物理像素）/ `'design'`（逻辑分辨率）—— 出 4K 时用 `'design'`，颗粒才和 1080p 一样粗 |
| `dither` | `'rpdf'`（默认）/ `'tpdf'` / `'off'`：输出前 8bit 抖动的分布，实测两者差别很小 |
| `ca` | 色差强度，0 = 无 |
| `saturation` / `contrast` | 1 = 不变 |
| `lift` | 黑位**抬升量**（0 = 纯黑） |
| `tint` | 色调（线性 RGB 乘子，`[1,1,1]` = 不变）：偏暖 `[1, 0.9, 0.8]`、偏冷 `[0.85, 0.95, 1.1]` |
| `invert` | 0 = 正常，1 = 反相（负片闪帧） |
| `shake` | 位移 `[dx,dy]`。⚠ 单位是**物理像素**（`uv += shake/outSize`，`outSize` 是物理分辨率）——`--scale 2` 下同样数值的视觉位移**减半**，要跨分辨率一致就乘 `scale`；`center` 才是逻辑像素。正值右/下 |
| `zoom` | **>1 推近**，1 = 不变 |
| `flash` | 整帧**加白量**（0 = 无，1 = 全白） |
| `fade` | 整帧**黑掉的量**（0 = 正常，1 = 全黑）⚠ **不是亮度**。开场淡入写 `fade = 1 - prog(t,0,1)` |
| `radialBlur` / `blur` | 径向/全屏模糊强度，0 = 关（两者互斥，开了就忽略 `ca`） |
| `center` | zoom/径向模糊/色差的锚点，**逻辑像素、y 向下** |

**经验规则**：只有「信号色」（火花、被唱到的词、要发光的东西）才允许超过 0.85 线性亮度去泛光；骨白正文永远不要 bloom，否则糊成一片。

> **抖动（`shake`）怎么给才对**：幅度和**频率**都要对。「像不像手持」取决于频率 ——
> 60fps 下逐帧换一个随机位置，5px 就会像地震；而 0.5–2Hz 的慢漂移，38px 也像有人扶着机器。
>
> | 幅度 | 观感 |
> |---|---|
> | ≤ 2px | 呼吸（安全） |
> | 3–5px | 手持（要慢，`shakeSmooth` 的 0.85Hz 就是这一档） |
> | ≥ 5px | 冲击/不稳（要么是故意的震屏，要么就是错的） |
>
> 两件必须做对的事：①**用 `t` 的平滑函数**（`shakeSmooth(f.t, amp)`）；②**幅度随"镜头停住"衰减**
> （`amp * (1 - 0.75 * settle)`）—— 镜头都刹住了画面还在晃，才是"越到后面越像地震"。
> 出片前体检：`node scripts/anim.mjs shake <任务>`（`video` 收尾也会自动看一眼并提醒）。

### 5.5 想做真 3D 时

引擎自带**三种**"3D"。前两种**手写**、都只吃 `f.t`（**没有深度缓冲、没有场景图**）；
第三种是**真网格**（Three.js，有深度缓冲与场景图，`three` 已经在 `dependencies` 里）：

```js
// ① 解析投影 + 线段批（便宜，几何自己给）：柱子 / 走廊 / 塔 / 线框
import { camera3, project3, clipSegment, depthScale } from '../../../src/core/cam.js';
const cam = camera3({ pos: [0, 0, -2], target: [0, 0, -3], fov: 50, roll: 0.02, H });
const a = project3(cam, W, H, x0, y0, z0), b = project3(cam, W, H, x1, y1, z1);
if (clipSegment(a, b, 0.15)) lines.seg(a.x, a.y, b.x, b.y, depthScale(cam, a.w, H) * 3, P.bone);

// ② 真 raymarch（贵，几何是数学式子）：无限晶格 / 空腔 / 雕版排线
import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../../../src/core/glsl3d.js';
new Pass(ctx.gl, `${GLSL3D_PRE}\n${SDF}\n${GLSL3D_KERNELS}\n${MAIN}`, cam3Uniforms(cam), { palette: ctx.P });

// ③ 真网格（Three.js，真深度/真遮挡/实例化/材质光照）：一个镜头一行
import { makeThreeShot } from '../../../src/kit/index.js';
export default makeThreeShot('cube', {
  background: 'over',                       // 'cover' 自带背景；'over' 浮在引擎背景上（配 world: 'auto'）
  bridge: { alpha: true },                  // 'over' 必须开
  camera: { fov: 34, pos: [4, 3, 6], target: [0, 1, 0] },
  async setup(ctx, api) { /* 建 THREE.Scene / 材质 / 灯光（api.palette('signal') 取**线性**色） */ },
  update(ctx, api) { api.scene.rotation.y = ctx.f.t * 0.4; },   // ⚠ 只吃 t，绝不做累积
  overlay(ctx, api) { /* 引擎的文字/引线，可用 api.project(x,y,z) 贴到 3D 物体上 */ },
});
```

**选哪一种**：按「画面需要什么」选，**不是**按「哪个省事 / 哪个零依赖」选 —— 三种都能出片，
选错才真的限制画面：

| 画面要什么 | 用哪一种 | 代价 / 边界 |
|---|---|---|
| 线框、柱林、走廊、塔 —— 几何你能用线给出来 | ① 解析投影 + 线段批 | **没有 z-test**，遮挡只能靠"按深度从远到近"自己排 |
| 几何本身是数学式子：无限重复晶格、圆角融合、掏空、雕版排线 | ② raymarch | 每像素几十次 SDF，出片时间会明显变长 |
| **成百上千个同样的单元**（实例化）、材质 / 光照 / 阴影、真深度真遮挡、以后要导入 `.glb` | ③ Three.js 真网格（`three` 已在 `dependencies`，**不是"最后的备选"**） | 每子帧重渲一次 + 一次全屏合成；写法和另两种一样简单（`makeThreeShot`） |

⚠ **能画出来 ≠ 画出来好看，也不等于一样快**。别为了"手写更纯粹"把本该用 ③ 的画面硬压成 ①/②：
需要真遮挡、材质光照、或成百上千个单元时，③ 才是省事又好看的那条路。
写法、三种合成模式、坑清单见 **`docs/THREE.md`**；实现在 `src/core/three-bridge.js`
（桥）与 `src/kit/three.js`（镜头骨架）。

* **世界坐标约定（三种共用）**：右手系，`+x` 画面上右、`+y` 上、`-z` 朝屏幕里；
  `project3` 的 `w` 是深度（`> 0` 才在镜头前）。Three.js 的世界坐标**同一套**，可以直接照搬。
* **相机 uniform 一律用 `cam3Uniforms(...)`**（②），不要手写字段名（写错不报错，而是整屏白）。
* **`FRAG_PX` 的 y 向上**（`gl_FragCoord`），和 JS 侧"逻辑像素 y 向下"**相反** —— 混了就是整个世界上下颠倒。
* **遮挡**：① 要自己做 —— 线段批没有 z-test，前后关系只能靠"按深度**从远到近**排序"（画家算法）；
  盒子只画朝镜头那 3 个面的棱就等价于背面剔除。完整做法与数字见 `docs/STATUS.md` §18
  （sodium 那一轮：27 个盒子从"铁丝笼子"变成"半实心积木"）。
  ⚠ **排序用的深度不能拿去算线宽**：`depthScale(cam, w, H)` 是 `focal / max(1e-6, w) / H`，
  而相机**身后**的东西 `w < 0` 会被 `max(1e-6, …)` 当成 1e-6 ⇒ 线宽变成**上亿像素**的胶囊、
  几条线就把整屏糊白（不报错、`check` 的三点采样还可能正好绕开）。
  线宽一律用 `clipSegment()` **裁剪之后**那个深度算 —— 裁剪保证它恒 ≥ 近平面。
  （② 和 ③ 不用管这条：它们有自己的深度。）
* **③ 的确定性一条都不能破**：`update()` 里只许写 `t` 的纯函数（`mesh.rotation.y = f.t * 0.4`），
  **不是** `+= 0.01`；要随机就用 `ctx.rng(seed)` 在 `setup` 里预计算。
  "用了 Three.js"**不是**破例的理由 —— 每个子帧都会重渲一次它。
* 规格与排错见 `docs/ENGINE.md` §3.7（①②）/ **§3.8（③）**；能跑的完整样本：
  `tasks/pdoom-lab/scenes/corridor.js`（raymarch）、`stack.js` / `columns.js`（投影线段批）、
  `tasks/_three-lab`（Three.js：3 段，含**中间那段完全由引擎画**的过渡镜头）、
  `tasks/_three-calib`（桥的标定夹具，量具 `node tools/probe-three.mjs`）。
* **画面整屏白 = 场景写出了 NaN/±Inf**（引擎不会报错）。先跑 `node tools/probe-raymarch.mjs`，
  它会直接读浮点缓冲把 NaN / Inf 分开数出来；`check` 也会报「非有限值：NaN n / Inf n」。

---

## 6. 有音乐时

```sh
node scripts/anim.mjs analyze <任务名>     # 生成 audio/<文件名>.analysis.json（拍子/小节/段落/包络）
```

之后画面就能真的踩拍子，靠的是 `f.beat` / `f.a` / `ctx.music`：

```js
f.beat                  // 连续拍号，3.4 = 第 3 拍走了 40%
f.beatPhase             // 0→1 走向下一拍
f.a.kick / snare / hat  // 打击事件强度（±60ms 窗口内）
f.a.rms / low / mid / high / vocal / flux   // 各路包络 0..1

music.beatAt(t)         // 连续拍号
music.timeOfBeat(16)    // 第 16 拍的时刻 —— 用它来定切割点
music.nearestBeat(t)
music.hits('kick', t-2, t)          // 这段时间内的 kick 事件
music.hit('kick', t, 0.12)          // 衰减脉冲（做撞击位移/闪白最省事）
```

**切镜头要对齐节拍**：用 `cut(scene, { dur: { beat: 16 } })` 或 `cut(scene, { at: music.timeOfBeat(16), dur: 8 })`，而不是手写秒数。`at` 和 `dur` 都接受 `{ beat: n }` / `{ bar: n }`（配置档节点上的 `at` / `dur` 同理，见 §3.2）。

### 6.5 有人讲解的片子（旁白/口播）

**镜头多长由旁白决定，不是"总时长 ÷ 段数"平摊**（硬经验：beast 第一版 63 秒塞 12 段、每段
2–4 个信息块，读不完被打回）。引擎自带这一层（`docs/NARRATION.md`）：

```sh
node scripts/anim.mjs say <任务> [--voice zh-CN-YunxiNeural] [--rate -6%] [--dry-run]
node scripts/anim.mjs mix <任务>          # 旁白摆位 + 给音乐做闪避 → 一条混音轨
```

写法（`tasks/<任务>/narration.mjs`，**旁白是唯一的时间源**）：

```js
export const VOICE = 'zh-CN-YunxiNeural';   // 换音色只改这一行，重跑 say+mix（场景代码不用动）
export const TAIL = 1.2;                    // 每段最后一句说完后至少留这么久画面
export const MAX_STRETCH = 1.9;             // 画面最多放慢几倍（再慢就像卡住）
export const SCENES = [
  { id: 'hook', internal: 4.2,              // internal = 这个镜头画面最后一次揭晓的内部时刻
    lines: [ { cue: 0.6, text: '先看一句话。' },        // cue = 说这句时画面该走到哪
             { cue: 2.6, text: '这串「嗷呜啊」，叫「兽语」。' } ] },
];
```

`say` 会逐句合成、**量出真实时长**、解出每段的 `stretch`/`slot`，写 `audio/timing.{json,mjs}` +
`audio/narration.json` + `audio/<任务>-vo.mp3` 并打印时长表；场景侧只写 `const t = f.lt / (ctx.params?.stretch ?? 1)`。
它挡住的坑：**叠句**（相邻两句不许重叠）、放慢到 `MAX_STRETCH` 还不够、没有节拍源。
⚠ 旁白音频尾巴上自带约 0.9s 静音，引擎按"说到哪算到哪"计入时长（别用文件时长）。

`task.config.mjs` 里这样接（`duration` 直接用生成的表）：

```js
import timing from './audio/timing.mjs';
export default {
  audio: { music: './audio/bed.mp3', vo: './audio/x-vo.mp3', mix: './audio/x-mix.mp3' },
  narration: './narration.json',              // 场景里 ctx.narration.at(f.t) / .recent(f.t, 1.2)
  timeline: seq([ cut(hook, { dur: timing.scenes[0].slot, overlap: timing.overlap,
                              params: { stretch: timing.scenes[0].stretch } }) ]),
};
```

**词级时间戳**（"唱到哪亮哪"/字幕）：`say` 会把驱动给的词级时间戳写进 `narration.json` 的
`lines[].words`（**整片绝对时间**），直接喂给 `type.karaoke`：

```js
const l = ctx.narration.at(f.t) ?? ctx.narration.recent(f.t, 1.2);   // 说完之后字幕再留一会儿
if (l?.words) type.karaoke(l.text, l.words, 200, 800, f.t, { size: 84, base: css(P.ash), sung: css(P.signal) });
```

没有 TTS 时也能用：手写 `narration: { lines: [{ id, text, start, dur }] }`，
`cut(scene, { dur: { vo: 'line-id' } })` 直接按某句旁白的长度定时长（名字写错会抛错）。
离线回归：`node tools/test-say.mjs`（不需要联网/GPU）；真 TTS 通电：`node tools/probe-tts-edge.mjs`。

#### 字幕：交给引擎，别自己画（`docs/CAPTIONS.md`）

```js
// task.config.mjs
captions: true,                    // ← 就这一行；场景里一个字都不用写
```

引擎每帧自动画"此刻该说的那句"（含"说完再留一会儿"、逐句淡入淡出），位置来自风格包的
**字幕保留带**（`style.grid.captionBand`，默认顶部居中 y 40–104）。字幕画在**后处理之后** ——
它是信息层，不过泛光/颗粒（"骨白正文永远不要 bloom"）。

三条纪律：

1. **画面文字只放标注**（名词 / 数字 / 单位 / 出处），**不许复述旁白**。
   同屏两套完整句子就是观众反馈里"两条字幕同时出现，看着好迷糊"；交付前跑
   `node tools/lint-narration-dup.mjs <任务>` 自查（它会把逐字重复报到 `文件:行号`）。
2. **字幕带是保留区**：别把面板/计量条放进去。kit 的 `assertInBand()` 会在压上时警告，
   `check` 会把这类警告打出来（走 `ctx.warnings`，不是 `console.warn` —— 它每帧都会发生）。
3. **别做逐词高亮**（`karaoke: true` 要显式开）：12 分钟 / 96 人的对照实验里，字幕本身
   对记忆与理解没有负面影响，**关键词突显是负效应**（受试者把它当成筛选信息的替代品）。

平台字幕（上传用）另有一条命令：`node scripts/anim.mjs subs <任务>` → `out/<任务>/*.srt|.ass`
（每行 ≤16 字、最多 2 行，Netflix 简体中文规范）。**开了 `captions: true` 就别再烧一遍 `.ass`** —— 那是两层字幕。

---

## 7. 渲染与导出

```sh
# 单帧（看图用）
node scripts/anim.mjs still <任务> -t 1.5,2,3.25            # 逗号分隔多个时刻

# 切点两侧 ±1.5s（三点采样不落在切点上；画方框那格 = 切点）
node scripts/anim.mjs cuts <任务> [--window 1.5] [--n 7]

# 接触表（一张图看一段时间，适合快速扫运动节奏）
node scripts/anim.mjs sheet <任务> --from 0 --to 12 -n 16

# 短片（快，无音轨）
node scripts/anim.mjs shot <任务> --from 0 --to 6 --samples 4

# 成片
node scripts/anim.mjs video <任务>                          # 1080p60，自动运动模糊，带音轨

# 长片子分块渲染（`--segments` 后面是**目标块时长（秒）**；已渲好的块会跳过，改一个镜头不用整片重来）
# 切点只落在段边界、且避开转场交叠 —— 每块都是完整的镜头
node scripts/anim.mjs video <任务> --segments 10

# 开渲之前先看要多久（测速 + 预估，不出片）
node scripts/anim.mjs video <任务> --dry-run

# 成片验收：从 mp4 里抽帧，与同一时刻重新渲染的帧逐像素比
# （拼接错位 / 帧数不对 / 色彩空间不一致 / 成片是旧版本 —— 一次全查出来）
node scripts/anim.mjs verify <任务>

# 只看某几段（快，且不会被别人写坏的场景拖累；名字写错直接报错）
# ⚠ --only 把选中的段**平移到时间轴开头**，所以 -t 是"段内时间"
node scripts/anim.mjs still <任务> -t 6 --only chart,title

# 改了引擎或重构了场景之后：证明画面**没变**（比人眼看图可靠）
node scripts/anim.mjs hashes <任务> --every 2 --save     # 存基线
node scripts/anim.mjs hashes <任务> --baseline           # 逐像素比对

# 忘了某个镜头模板的参数与默认值 —— 写场景、写配置档都用它（这条命令本来就有，见 §1）
node scripts/anim.mjs shots [名字]

# 抖动体检：整片的 post.shake 是"平滑手持"还是"逐帧白噪声（振动）"（有问题退出码 1）
node scripts/anim.mjs shake <任务> [--from 0 --to 48] [--json]     # 见 §5 的"抖动怎么给才对"
node scripts/anim.mjs shake <任务> --from 40 --to 48               # 只体检收尾那一段

# 渲染加速（先量再定，别照搬）
node scripts/anim.mjs perf <任务> --from 20 --to 24 --gpu high   # 对比核显/独显（填充重的片子差 2×）
node scripts/anim.mjs video <任务> --segments 8 --gpu high       # 组合使用
```

**出片速度**（本机实测、1080p60、`samples=1`）：`3.8 → 7.5 fps`（`gl.js` 的 `readPixels` 改成复用缓冲），
raymarch 类场景加 `--gpu high` 再翻倍。传输那一段已换成 **NV12**（每帧 3.11MB，不再是 RGBA 的 8.3MB），
ffmpeg 用 `-pix_fmt nv12` 直接吃 —— 瓶颈与验收数字见 `docs/PERF.md` §5.3–§5.4。

运动模糊是**逐帧自适应**的：静止帧 8 个子帧，普通运镜 24，甩镜/砸字会吃到 72 或 216。用 `--samples 1` 关掉（出图更快），`--shutter 0.2` 调窄。

**渲染期间不要碰工作区**：CLI 起的是私有 Vite，文件一改就 HMR 重载页面 → WebSocket 断流。
⚠ **准确规则（第七轮实测收紧）：只要有一场渲染在跑，就一个文件都别写。**
`watch.ignored` 里那几类（`**/*.md`、`docs/**`、`tasks/*/audio/**`、`tasks/*/fonts/**`、
`FACTS.md`、`SCRIPT.md`、`timing.{json,mjs}`、`**/*.analysis.json`、`**/*.rgba`/`*.yuv`）
**挡不住编辑器的原子写**：它们会留下 `.xxx.tmpdir/…tmp`（**不以 `.md` 结尾**），Vite 的文件监听
照样去 watch，撞上 `EBUSY` **直接让 Vite 进程崩掉**，渲染报 `net::ERR_CONNECTION_REFUSED`
（`docs/STATUS.md` §14.5 第三次复现：`hashes demo --baseline` 跑到第 8 帧就断在这里）。
唯一被实测挡住的是 **`out/**`** —— **并发子代理的产出先落 `out/_staging/`**，渲染结束再搬进仓库。
（"`docs/**`、`**/*.md` 可以安全写"那条**已作废**。）
`video` 现在会在收尾时用 **ffprobe 复核自己的产物**（帧数不符就报错并删掉废文件），
分块模式还会**逐块**复核 —— 所以「CLI 说 ✓ 但文件打不开」这种情况不会再发生。

**真 4K 可用**：`node scripts/anim.mjs video <任务> --scale 2`（或任务里写 `scale: 2`）。
scale 接受 1..4；场景写法不用改，只要 shader 里别拿物理像素当逻辑像素用。
（历史上 `--scale 2` 曾被 CLI 拒绝，因为 `LineBatch` 顶点着色器用物理分辨率换算裁剪空间导致矢量在 4K 下消失 —— 已修，见 `docs/history/STATUS-rounds-1-6.md` §6.3。）

---

## 8. 遇到问题时

先跑：

```sh
node scripts/anim.mjs check <任务>
```

它会：静态扫描禁止的写法（`Math.random` 等）→ 逐段试渲染 → 报每段平均亮度（近乎全黑 = 没画东西）→ 打印控制台错误。

常见症状：

| 症状 | 多半是 |
|---|---|
| 整帧黑 | 场景没 `gl.clear(ctx.out, ...)`，或者画到了别的目标上 |
| 文字全不见 | 忘了 `text.clear()`；或者忘了 `text.upload()` / `comp.draw`；或者把 `text` 用成了引擎的而不是 `ctx.text` |
| 上下颠倒 | Canvas2D 图层不用自己翻 Y，引擎在合成器里翻了 |
| 预览对、导出不对 | 用了 `Math.random` / 逐帧累积状态 / 用 `Math.floor(t*60)` 抖帧 |
| shader 编译失败 | 错误信息里会带出错那一行的源码；注意不要重复声明 `vUv`/`fragColor`/`t`/`res` 这些已经在 `GLSL_COMMON` 里的名字 |
| 音频解码失败 | 跑 `analyze` 生成预计算 json；或把音频换成 mp3/m4a |
| `task.config.mjs` 的时间线报"取不到镜头模板" | 配置档节点写错了：模板名或参数名拼错 —— 报错里就列了可用模板/可用参数，见 §3.2 |
| 拖影有台阶 | **先调小 `--tol`**（自适应采样容差，显示空间 0..255 的级数，默认 2.5；比加 `--samples` 便宜）；或调小 `--shutter`；也可能是场景里有随时间连续变化的噪声（改用 `f.idx` 播种） |

> **看到输出里不认识的词**（`非有限值：NaN n / Inf n`、`背景守门`、`空档`、`段内亮度不均`、`压进了**字幕保留带**`…）→ 查 **`docs/DIAGNOSIS.md`**：`输出词 / 含义 / 修法` 三列，每条带 `文件:行号` 证据（词是从代码里 grep 出来的，能反过来验证）。

---

## 9. 目录结构

```
src/core/          引擎（改之前先读 docs/ENGINE.md）
  util.js          数学/缓动/确定性随机/颜色
  gl.js            WebGL2、Pass、Layer2D、Compositor、LineBatch
  post.js          后处理链（泛光/光晕/颗粒/暗角/调色）
  text.js          排版与逐字/逐词动画
  scene.js         Frame 与 SceneCtx 的字段定义
  engine.js        渲染一帧、合成、自适应运动模糊、共享背景（ctx.world）
  audio.js         MusicData（拍子查询）
  audio-analysis.js 纯 JS 的 FFT/节拍分析（Node 和浏览器共用）
  trans.js         转场与「一镜到底」工具（transitionPass / cameraPost / enterOffset）
  cam.js           3D 第 ① 种：解析投影（camera3 / project3 / clipSegment / depthScale）
  glsl3d.js        3D 第 ② 种：raymarch 的公共 GLSL（GLSL3D_PRE / GLSL3D_KERNELS / cam3Uniforms）
  three-bridge.js  3D 第 ③ 种：**真网格**（Three.js 桥：上传成图层 / 三种合成 / 线性色 / 投影）
  palette.js       调色板（线性色表 + GLSL 常量注入）
  narration.js     旁白表（ctx.narration 的查询接口，见 docs/NARRATION.md）
  captions.js      **引擎级字幕层**（task.captions 打开后每帧自动画，见 docs/CAPTIONS.md）
src/kit/           引擎自带的镜头工具（写场景先看这里，别再自己抄一份 _kit.js）
  index.js         统一出口
  layout.js        排版：put / writeLine / fade / typed / codeRow（不碰 GPU）
  motion.js        运动规则：nudgeCurve / waterfallStagger / glowPeakCap（上限判据；docs/MOTION.md）
  elements.js      版面元件：panel / fillRect / kicker / footer / reticle / marker
  world.js         共享背景 + 一台摄影机 + 甩镜转场（worldPass / makeWorldKit）
  shot.js          makeShot()：把「一个镜头的骨架」包成一个函数
  three.js         makeThreeShot()：Three.js 镜头（与 makeShot 同形状；见 docs/THREE.md）
  bands.js         **版面分区**（六条带，含字幕保留带）+ captionNote / subLine / assertInBand
src/style/         **风格包**（style pack）：一行 `style: 'paper'` 换掉整片观感（docs/STYLE.md）
  index.js         STYLES / resolveStyle / gridFor（配色 / 字体 / 背景母题 / 栅格 / 后处理基线 / 字幕样式）
src/shots/         A 档镜头库：一行取一个整镜头（`shot('名字', {…})`）
  index.js         shot / SHOTS / listShots（参数写错会抛错，不静默忽略）
  title chart kinetic whip outro wave pulse grid   11 个模板（查参数：anim.mjs shots [名字]）
src/timeline.js    时间线 DSL：seq / cut / par / at（cut 支持 { world } 声明共享背景；配置档节点 { type: '…' } 见 §3.2）
src/tasks.js       任务发现与加载（配置档时间线的选路、风格包解析都在这里）
src/app.js         浏览器入口（预览 + 离屏协议）
scripts/anim.mjs   CLI
scripts/lib/       CLI 侧的 Node 工具（**不进浏览器、不进 Vite 模块图**）
  media.mjs        ffmpeg/ffprobe 包装、解码编码、probeSpeechEnd（量"说到哪"，不是文件时长）
  say.mjs          anim say：旁白脚本 → TTS → 时长表 → narration.json（solveTiming / alignWords）
  mix.mjs          anim mix：旁白摆位 + 闪避（duckGain / mixTracks）→ 一条混音轨
  shake.mjs        抖动统计（纯函数）：逐帧变化量 vs 幅度 ⇒ 「平滑手持」还是「逐帧白噪声」；
                   `anim shake` 与 `video` 出片收尾的守门共用同一套判据（`docs/history/IMPROVEMENTS-1-3.md` 第三轮 A–F）
tasks/<任务>/       片子：task.config.mjs + scenes/ + audio/ + narration.mjs（有旁白时）+ FACTS.md
                   （**配置档任务可以没有 scenes/**：时间线里直接写 { type: '…' }，见 §3.2）
public/fonts/      字体声明（文件自备，缺失自动回退系统字体）
docs/              ENGINE.md（引擎规格）、COOKBOOK.md（做法手册）、ROADMAP.md（路线图）、
                   CONFIG-ONLY.md（**零代码出片**：只写 task.config.mjs 的教程，B 档；见 §3.2）、
                   STATUS.md（**当前状态 + 最近几轮的验收证据（§14–§19）**；第一～六轮已归档）、
                   BACKLOG.md（**「还没做的事」的唯一清单**：待办 / 待你拍板 / 已关掉的；
                   旧文档里那些"没做的"小节都以这份为准 —— **要动引擎先看这份**）、
                   STYLE.md（**风格包与反审美疲劳**：怎么换、每片必须换掉的三项、节奏数值）、
                   CAPTIONS.md（**字幕层与信息分工**：画面只放标注、句子交给旁白与字幕）、
                   MOTION.md（**运动规则表**：什么时候用哪个、数值上限、四级证据分级）、
                   LAYOUT.md（**版面纪律与「版面守门」**：一屏一个主体、主体之外 ≤ 2 块、
                   `focus` 怎么声明、`check` 的三条判据与阈值 —— 写画面之前先看这份）、
                   SCENE-BRIEF-TEMPLATE.md（**写分镜/派子代理时照这份起草**，含"本片必须不同的三项"）、
                   NARRATION.md（**口播/旁白这一层：A/B/C 三档都已落地**，做带旁白的片子先看）、
                   PERF.md（**渲染性能实测与验收口径**：瓶颈、并行/NVENC、`-copyts`、verify 取时坑）、
                   FACTS-TEMPLATE.md（对外材料的事实出处模板）、
                   THREE.md（**第 3 种 3D：Three.js 镜头**——怎么用、三种背景合成模式、
                   确定性铁律、投影贴标签、坑清单；写 3D 镜头先看这份）、
                   REFERENCE-*.md（**外部项目的拆解与横向对比**：画面/剪辑/播放器/数据管线四层，
                   每条带 `文件:行号` 证据。⚠ 它只记"别人怎么做"，可执行条目一律在 BACKLOG.md §1.B/§1.C）
docs/history/      **归档**：已完成 / 已过期的东西，只作历史参考，**不要当待办读**
                   （索引见 docs/history/README.md）：
                   HANDOFF.md（引擎早期的交接单）、HANDOFF-THREEJS.md（Three.js 接入提案）、
                   IMPROVEMENTS-1-3.md（第一～三轮：fidus / beast / promo 那三轮，53 条全落地）、
                   IMPROVEMENTS-4-5.md（第四～五轮：optifine 那轮 + 风格包/字幕层）、
                   STATUS-rounds-1-6.md（STATUS 的第一～六轮详细记录，**§1–§13 的章节号原样保留**）
tools/             诊断与回归脚本（probe-*.mjs / test-*.mjs / smoke-*.mjs），不参与出片
  regress-all.mjs  整份回归清单一条命令跑完（日志与汇总在 out/_regress/）
  lint-narration-dup.mjs  静态检查：**画面文字逐字复述旁白**（"两条字幕"的元凶），报 file:line
  test-layout.mjs  版面守门判据的纯 JS 自测（31 项，不需要 GPU）：块怎么合并、主体图连通、
                   母题保留区豁免、"没声明 focus = 没判"、报告形状与接线自检（见 docs/LAYOUT.md）
  lint-fabricated-numbers.mjs 静态检查：**画面上的数字有没有出处**（查 FACTS.md），报 file:line（1-22；§10.10）
  test-fabricated-numbers.mjs 上面那个的纯 JS 自测（183 项）；夹具 tools/fixtures/lint-numbers/
  scene-harness.mjs  离线跑场：用假 ctx 把整条时间轴 render 一遍（抓未定义变量 / 确定性破例）
  test-style.mjs   风格包与字幕层的纯逻辑回归（含"不写 style 时像素不变"的底线断言）
  test-blocks.mjs  方块世界 kit 的纯 JS 回归（面朝向判据 / 深度排序 / 摄影机关键帧）
  probe-raymarch.mjs  raymarch/3D 层的量具：14 个 shader 变体 + 直接读浮点缓冲（NaN/Inf 分开数）
  probe-three.mjs   Three.js 桥的量具：朝向 / 两条颜色管线是否一致 / 线性 alpha（10 项判据）
  probe-post-ab.mjs / -ab2.mjs  后处理 A/B 的读数脚本（配套 tasks/_post-lab/；要 Chrome 且先渲帧，
                   属**手动量具**、不进回归清单；BACKLOG 0-6 用得上）
  tts-edge.py      默认 TTS 驱动（edge_tts 的 WordBoundary → 词级时间戳）
  stub-tts.mjs     确定性假驱动（离线回归用，不联网）
out/               渲染产物（图、mp4、日志；`out/_regress/` 是回归日志）
```

---

## 10. 交付前自检

1. `node scripts/anim.mjs check <任务>` 无报错、无空档告警、每段都不是全黑，且**背景守门通过**
   （每段采 **15% / 50% / 85% 三点** × 单/多子帧两条路径：过曝、两条路径不一致、
   **段内亮度不均**、**交叠段没铺整帧背景**都会报）
2. `still` 抽查了**每一段**的中间帧，并且**真的用 Read 工具看了图**
   （配置档任务同样适用：**段名就是模板名，或者你写的 `id`**，`--only` 用的就是它 ——
   例如 `node scripts/anim.mjs still <任务> -t 6 --only chart,title`）
3. 有音乐的片子：镜头切割点对齐在拍上（`dur: { beat: n }`）
4. `video` 出片成功 —— **CLI 会用 ffprobe 复核产物**（帧数不符就报错并删废文件，分块模式逐块复核）；
   想再确认一遍就 `node scripts/anim.mjs verify <任务>`
5. 段与段之间没有黑隙（`check` 会报「空档」），最后一段结尾有淡出或明确收尾
6. 代表某个团队/项目对外发声的片子：`tasks/<任务>/FACTS.md` 逐句标了出处
   （模板见 `docs/FACTS-TEMPLATE.md`），并列出「刻意没写的东西及原因」
7. 有旁白的片子：`anim say` 的输出里**没有叠句警告**、没有 `MAX_STRETCH` 顶到上限的警告，
   说话占比没有高到离谱（>80% 它会自己提醒）；每段最后一句说完之后还有 `TAIL` 秒画面
   （`solveTiming` 保证并打印）。改完旁白先跑 `node tools/test-say.mjs`（不需要 GPU）
8. **这一支的风格跟上一支不一样**（`docs/STYLE.md`）：相邻两支片子不要用同一套 `style` ——
   至少换掉「主色/介质、字体、背景母题」里的两项 —— 11 个模板 + 默认调色板就是上一支片子的冻结副本。
   出对比图：`node scripts/anim.mjs still <任务> -t <时刻> --style paper`（临时覆盖，不改文件）。
9. **有旁白的片子开了引擎字幕**（`docs/CAPTIONS.md`）：`captions: true`，而且
   `node tools/lint-narration-dup.mjs <任务>` **零命中**（画面文字逐字复述旁白 = 观众说的"两条字幕"）；
   `check` 的输出里没有「压进字幕保留带」的警告。
   平台要软字幕就 `node scripts/anim.mjs subs <任务>`（**开过 captions 就别再烧一遍**）
10. **一屏只让观众看一件事**（`docs/LAYOUT.md`）：`check` 的「版面守门」那一段没有 `⚠`，
    并且**声明了主体**（场景对象上写 `focus: 'center'` 或 `{ x, y, w, h }`）—— 没声明时
    「主体区里压了几块 / 主体之外还有几个看的地方」这两条**没跑**，会进 `skipped`。
    判据是「主体之外 ≤ 2 块、每屏 ≤ 6 块字」，默认只 warn、**交付自检加 `--strict`** 才当门。
    观众对钠那期的原话就是这一条：「有些动画元素相互遮挡害得我搞不清楚到底要看哪个主体」。
11. **画面上的数字必须有出处**（`docs/BACKLOG.md` 1-22；判据与边界见 `docs/FACTS-TEMPLATE.md` ★ 一节）。
    **我们的画面全是代码算的，所以"编一个数字"的成本是零** —— 这一条只能靠硬规则 + 交付前自审：
    **绝不在帧尺度上编造数字、增量、日期、计数**；数值显示位（`type.write` 的字符串、`chart` 的
    `values`、`codeRow` 的文本、镜头模板的 `title`/`sub`/`footer`、旁白与字幕）里的字面量数字，
    要么能在 `tasks/<任务>/FACTS.md` 找到出处，**要么写成占位符 `— figure —`**（槽位先渲染出来，
    别先填一个"看起来合理"的数）。片子自己的编号（`WORKS 04`、`v0.1.2`）与示意读数
    （计数器、延迟条）同样要登记 —— 一行话，换掉一次误报。
    自查：`node tools/lint-fabricated-numbers.mjs <任务>` **零命中**
    （`--slots` 复核它把哪些位置当成数值显示位，`--explain` 连找到出处的也打出来附行号）。
    ⚠ 它只扫"数值显示位"：坐标 / 字号 / 时长 / 阈值 / 颜色分量 / 注释都不算；
    而**算出来的数**（模板串插值 / 字符串拼接 / `String()` / `.padStart()` / `.toFixed()` / `values` 里的变量）
    单列一段 `算出来的值：N 处 —— 这些位置静态查不到等于几，这一项**没验**`（**0 处也打一行**）。
    它**不进退出码** ⇒ "零命中"不等于这些位置验过了 —— 要么在 FACTS.md 里**登记口径**，要么写成占位符。
12. **自检最多 3 轮，3 轮不过就交人**（第 4 轮开始就是在猜）；发布前派一个只挑毛病不夸的审查者，
    交回**按时间码排序的问题清单 + 证据**（哪一秒、哪张图、什么问题）。两条的原文与理由见
    [`docs/REFERENCE-video-use.md`](docs/REFERENCE-video-use.md) §3.3；切点优先看 `anim cuts`。

### 出问题时按这个顺序查

```sh
node scripts/anim.mjs check <任务>             # 三点采样 + 多子帧比对 + 背景守门
node scripts/anim.mjs check <任务> --quick     # 冒烟：每段只采 50% 一个点、只跑单子帧（**没看**多子帧与入场头 1 秒）
node scripts/anim.mjs check <任务> --strict    # 把 `skipped:`（没跑 ≠ 通过）也当成失败；默认不改退出码
node scripts/anim.mjs audit <任务>             # 每个交叠段在交叠期到底画了什么
node scripts/anim.mjs still <任务> -t ...      # 出图，用 Read 看
node scripts/anim.mjs cuts <任务>              # 每个切点两侧 ±1.5s 的接触表（画方框那格 = 切点）
node scripts/anim.mjs probe-alpha <任务>       # 整行淡入（alpha）到底生效没有
node scripts/anim.mjs determinism <任务> --from 0 --frames 40  # 顺向/反向/单次 seek：跨帧依赖定位（有分叉退出码 1）
node scripts/anim.mjs shake <任务> [--from 0 --to 48] [--json] # 抖动体检：振动 / 收尾还在晃（有问题退出码 1）
node scripts/anim.mjs perf <任务> --from 20 --to 24 --gpu high # 测速：每帧毫秒 / 子帧数（先量再定）
node scripts/anim.mjs gpu [<任务>]             # GPU 与环境能力（浮点纹理缺失 = 这台机器不能跑 HDR 渲染）
node scripts/anim.mjs dumpframe <任务> -t 0.5 --run-up         # 落一张裸帧 + 引擎内部量（两条路径对照）
node scripts/anim.mjs dumpframes <任务> --from 0 --to 1        # 顺着渲一串裸帧（对照实验用）
node scripts/anim.mjs dumppx <任务> --times 1.5 --out x.raw    # 导出浏览器那一帧的裸像素
node tools/png-rows.mjs <png> [x]              # 直接量一张图：某根线/某个色块到底在不在
node tools/probe-colorspace.mjs <任务>         # 导出 vs 预览 的颜色是否一致
node tools/probe-ribbon.mjs 11.2 1,2           # 4K 下矢量几何是否与 1080p 同位同尺寸
node scripts/anim.mjs verify <任务>            # 成片抽帧 vs 重新渲染（拼接/帧数/色彩）
node scripts/anim.mjs hashes <任务> --baseline # 改动前后画面是否逐像素没变
node scripts/anim.mjs probe <任务> --times 4,12 # 渲染顺序会不会改变结果
node scripts/anim.mjs diff <任务> --times 12   # 同一时刻渲两次，差了多少
node tools/test-timeline-guard.mjs             # 时间线 DSL：不合法的节点必须抛错（含配置档，纯 JS）
node tools/regress-all.mjs                     # 整份回归清单一条命令跑完（日志在 out/_regress/）
node tools/regress-all.mjs --only smoke        # 只跑名字里含 smoke 的
node tools/probe-raymarch.mjs                  # 整屏白/黑、3D 朝向、NaN/Inf：14 个变体 + 判据
node tools/probe-three.mjs                     # Three.js 桥：朝向 / 两条颜色管线一致 / 线性 alpha（10 项）
node tools/test-cam-math.mjs                   # 3D 相机/投影/手性（纯 JS，不需要 GPU）
node tools/test-say.mjs                        # 旁白那一层（不需要联网/GPU）
node tools/test-karaoke.mjs                    # karaoke 的位置/时间语义（纯 JS）
```

| 症状 | 多半是 |
|---|---|
| 整帧黑 | 场景没 `gl.clear(ctx.out, ...)`，或者画到了别的目标上；或用了 `--only` 但 `-t` 给的是整片时间 |
| **整屏白（四角有暗角）** | 场景写出了 **NaN 或 ±Inf**（两者显示完全一样）—— `check` 会报「非有限值：NaN n / Inf n」；raymarch 用 `node tools/probe-raymarch.mjs`。最常见来源：相机 uniform 全 0（`cam3Uniforms` 写错字段名）、除以 0、`pow(0, 负数)` |
| **单帧白、成片黑（同一段）** | 同上：多子帧走累加，`_accumPass()` 会把非有限值丢掉 |
| **某一段的底是黑的（文字/面板都在）** | **漏了共享背景** —— `check` 的背景守门会点名；写 `cut(shot, { world: 'auto' })` |
| 文字全不见 | 忘了 `text.clear()`；或者忘了 `text.upload()` / `comp.draw`；或者把 `text` 用成了引擎的而不是 `ctx.text` |
| "整行淡入"一上来就是终值 | 曾经是引擎 bug（`alpha` 只在 `stagger>0` 时参与动画），**已修**；用 `probe-alpha` 复核 |
| 整行居中/右对齐偏了 | `type.write` 的 `align` 是**逐字**生效的；用 `type.writeLine(..., { anchor })` |
| 预览对、导出暗 | 历史上是导出缺 sRGB 编码（已修）。自己写读回时别用 `readLinearPixels()` 存图 |
| 预览对、导出不对 | 用了 `Math.random` / 逐帧累积状态 / 用 `Math.floor(t*60)` 抖帧（`check` 会扫出前三种） |
| `video` 报「只渲染了 N/M 帧」 | 渲染期间写了仓库里的**任何**文件（HMR 重载 → 断流，`docs/*.md` 也不行，见 §7）。长片子用 `--segments` 分块 |
| `video` 报「产物验收不通过」 | 这一行现在是 `decideGateFailure()` / `gateFailureLines()` 生成的：**先读它打印的分类头** —— 「…这是**已知原因**（确定性），重跑不会有不同结果」⇒ 照紧跟的「下一步：①…」做，**别直接重跑**（半截流 / 没写 moov / 帧数不符都在这条路上）；「…原因未知（可能是瞬时，也可能是没被识别出来的确定性根因）」⇒ 先看原始 `·` 行、查磁盘与 `out/` 有没有被别的进程碰过，再考虑重跑。分块 / 并行路径会点名是哪一块（哪一段），最后一行会写明这一步能不能靠重跑恢复。逐条对照见 `docs/DIAGNOSIS.md` §1.5 |
| 文字是方框 | 任务字体没加载完就渲了；`task.fonts` 的路径要相对任务目录，且字体文件要真的存在 |

> **输出里出现不认识的诊断词 → 查 `docs/DIAGNOSIS.md`**：三列（输出词 / 含义 / 修法），每条带 `文件:行号` 证据，并且写明退出码语义与「空 ≠ 干净」的读法（哪些行代表**没跑**而不是通过）。
