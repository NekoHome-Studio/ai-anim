# MOTION —— 运动规则表（什么时候用哪个）

> 我们有一份很好的**原子函数库**（`src/kit/`：`makeShot` / `fade` / `typed` / `spring` /
> `noise` / `enterOffset` / `cameraPost`…），缺的是**"什么时候用哪个"**这一层判据。
> 外部项目 hyperframes 的 `rules-index.md`（7 大类 40+ 条原子规则）里最值得抄的是**形式**：
> **按「画面要什么」检索**，而不是按"我记得有个函数"。
> （拆解见 [REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) §4.4；清单条目见 [BACKLOG.md](BACKLOG.md) 1-27；
> 横向对比见 [REFERENCE-agent-video-projects.md](REFERENCE-agent-video-projects.md) §3.4。）
>
> 这份文档做三件事：**一张按画面检索的表** + **每条数值的出处与证据强度** + **哪些还没落地**。

---

## 0. 先说证据强度（照 [STYLE.md](STYLE.md) §7 的做法）

**文里的数字分四种，读的时候必须分清是哪一种** —— 把别人的经验值当成"我方实测"，
比写错一个数字更严重（[STYLE.md](STYLE.md) §7 就是这么开头的）：

| 标记 | 含义 | 谁可以反驳它 |
|---|---|---|
| **【外部经验值】** | 从外部项目 `heygen-com/hyperframes` 抄来的**调参成果**。**我方还没有实测过** | 我们自己的出图 / 出片实测 |
| **【引擎默认值】** | 引擎代码里就是这么写的（给了 `文件:行号`），有单测钉着 | 改代码 + 改单测 |
| **【我方推导】** | 纯数学，可以当场验算（`tools/test-motion.mjs` 钉着） | 自己算一遍 |
| **【我方实测】** | 在我们这儿量过、或出过事故并由守门兜着（给了命令 / 出处） | 重跑那条命令 |

⚠ **1-27 这次交付的三个 kit 函数，抄的是"数值"，不是"实测结论"**：`10 / 65 / 25`、`0.5s`、`0.45`
都是 **【外部经验值】，我方未实测**。我们**自己**证出来的只有三件事（都标【我方推导】）：
三段式的**时长比例**、**两处接缝速度相等**、以及 10/65/25 下"尾部 ≥ 3× 加速段"**自动成立**。
**"二值到达比淡入好"同样没有在我们这儿做过对照实验** —— 见 §3.3。

---

## 1. 共享契约（写任何运动之前都成立）

外部那份契约的原文在 [REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **530–538 行**
（"The contract — every rule assumes this"）。它是给 DOM + GSAP 写的，**逐条翻译到 anim 是这样**：

| 对方的契约（530–538 行） | 在 anim 里的等价物 |
|---|---|
| 只在**一个 paused timeline** 上跑 | 整条时间线都是"给定 t 求值"：`render(ctx)` 只依赖 `ctx.f`，没有播放器状态 |
| **双向 seek-safe**：`fromTo` 带显式 from 态、**绝对值**、绝不用相对 `+=` | 铁律：位置写成 `x = f(t - t0)`，**不许** `this.x += v`（[AGENTS.md](../AGENTS.md) §4；`anim determinism` 能定位） |
| 确定性：无 `Math.random()`、无 `Date.now()`，只有 index 派生的伪随机 | `rng(seed)`（`setup` 里预计算）/ `f.idx` / `noise1`…；`check` 会静态扫前三样 |
| 只动 transform 与 paint-only 属性；`width`/`height`/`top`/`left` 禁用 | **不适用** —— 我们没有布局，所有坐标都是自己算出来的。该抄的是意图："慢速运动别量化"（§3.6，148–153 行） |
| **`items × stagger ≤ ~0.5s`** —— 把一组的到达压成"一个节拍" | 落成函数：`waterfallStagger()`（§3.2），超了按比例压回 |
| 被动画的元素上不许有 CSS `transition` | **不适用**（没有 CSS）。等价物是"别让两套动画同时改同一个量" |
| DOM 测量只在 build 期做 | **不适用**（没有 DOM 盒子） |

我们这边**另外**还有三条自己的硬约束（写在 [AGENTS.md](../AGENTS.md) §4 / §5、[LAYOUT.md](LAYOUT.md)）：

1. **抖动必须是 t 的平滑函数**：`shakeSmooth(f.t, amp)`，不是逐帧白噪声 —— 60fps 下每 16.7ms 跳一个新位置
   = 振动，5px 也会被说成"像地震"。
2. **幅度随"镜头停住"衰减**：`amp * (1 - 0.75 * settle)`。
3. **一屏一个主体**：运动再多，观众该看的那一件事只能有一个（`focus` / `check` 的版面守门）。

---

## 2. 运动规则表：画面要什么 → 用哪个 → 数值上限 → 出处

**按"观众该感觉到什么"查这张表**（不是按函数名）。"出处"那一列**自带证据强度标记**（§0）。

| 画面要什么（观众该感觉到什么） | 用哪个 | 数值上限 | 出处 |
|---|---|---|---|
| 一个元素**到位、有回弹**，像被吸过去、被磁铁抓住 | `spring(f.lt - t0)` → 0→1（指数弹簧**解析解**；"想更弹"再给参数） | 默认 `stiffness 90 / damping 18`；更弹 `spring(x, 1, 140, 12)`；⚠ 别写成逐帧积分 | 【引擎默认值】`src/core/util.js:61` + [AGENTS.md](../AGENTS.md) §3.5 |
| **一整组东西被推一下**：慢-快-慢、一次爆发、**不回弹** | `nudgeCurve(t, t0, dur, dist)`（新，§3.1） | 距离分配 **10 / 65 / 25**；**尾部时长 ≥ 3× 加速段**（我们解出来正好 10/3） | 【外部经验值】[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **516 行**（`nudge-curve`）→ 时长比例对我们是【我方推导】 |
| 一组元素**错峰到达**（级联、加速的波、最后收敛） | `waterfallStagger(items, stagger)` → 把结果的 `.stagger` 喂 `type.write`（新，§3.2） | **`items × stagger ≤ ~0.5s`**，超了按比例压回；默认上限 `0.5` | 【外部经验值】[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **535 行**（共享契约）、**517 行**（`waterfall-entry`） |
| 新元素**出现**（"到达"） | **二值到达**：`type.write(text, x, y, { t, stagger })` —— **不要传 `alpha`、不要传 `from`**（§3.3） | 不许给到达做淡入（"never fade an arrival"）；真要一帧过渡就 `staggerDur ≤ 0.05s`（≤3 帧，观感等同二值） | 【外部经验值】同上 **517 行**；【引擎默认值】`src/core/text.js:291/293/303` 证明 `from: 'up'` 会 `al = e` **淡入** |
| **已经在那儿的东西**显隐（不是到达） | `fade(f.lt, delay)` → `{ alpha: [0,1], t, staggerDur }` | 淡出随便；**淡入只给"本来就在"的东西**（面板重新出现、整屏压暗再回来） | 【引擎默认值】`src/kit/layout.js:74` |
| 文字**逐字上浮**入场（我们现在的默认写法） | `type.write(..., { stagger, from: 'up', t: f.lt })` | ⚠ 它**是淡入**（`al = e`），与上一行冲突；**我方没做过对照实验** —— 见 §3.3 | 【引擎默认值】`src/core/text.js:296–304` |
| 转场：**新内容把旧内容推走**（物理碰撞式） | `handlesTransition` + `transitionPass` + `enterOffset`（新内容从反方向落位） | **受害者的时长 = 入侵者的 40–50%**；三个 tween 落在**同一时间点** | 【外部经验值】[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **518 行**（`reactive-displacement`）。**kit 里还没有这个函数**，见 §4 |
| hero 元素背后的**柔光 / 辉光**（无触发、有界呼吸） | 自己叠一层径向辉光（`lines` 的第 4 个分量 + `mul`），或 `post` 的 `bloom` / `halation` | **峰值 opacity ≤ ~0.45**（`glowPeakCap()`，新，§3.4）；只有信号色才允许 > 0.85 线性亮度去泛光 | 【外部经验值】同上 **522 行**（`ambient-glow-bloom`）；0.85 那条是【我方】[AGENTS.md](../AGENTS.md) §5 |
| **粒子 / 彩带**（确定性、可 scrub） | 固定池 + `rng(seed)` 发射值 + **一个单 driver**，把每个粒子算成时间的纯弹道函数 | **≤ ~40 个粒子** | 【外部经验值】同上 **523 行**（`particle-burst`） |
| **抖动 / 手持** | `shakeSmooth(f.t, amp)` 交给 `post.shake` | ≤2px 呼吸；3–5px 手持（0.85Hz）；≥5px 只许是故意的冲击 | 【我方实测】[AGENTS.md](../AGENTS.md) §5 的幅度表 + `node scripts/anim.mjs shake <任务>`（第三轮事故："最后像地震"） |
| 甩镜的**方向速度模糊** | 引擎的**真**运动模糊（逐帧自适应多子帧，我们的强项） | 模糊峰值必须落在**最大速度处**、落定归零 —— 这个绑定**还没写进 kit** | 【外部经验值】同上 **519 行**（`motion-blur-streak`）；采样档 8/24/72/216 是【引擎默认值】（[AGENTS.md](../AGENTS.md) §7） |
| 单元素**复合变换**式的虚拟摄影机（推近某块内容） | `ctx.setXform({ x, y, scale })` | ⚠ **反向平移的公式有两种**：带 scale 的 `T = −offset × S`，纯平移的 `T = −offset` —— 混了就是"推过去对不上" | 【外部经验值】同上 **520 行**（`viewport-change` vs `coordinate-target-zoom`） |

**怎么用这张表**：先问"这一屏观众该感觉到什么"，再选行 —— 与 [AGENTS.md](../AGENTS.md) §5.5
那张"按画面需要什么选 3D"的表同一个用法。**选错才是真的限制画面**，不是"哪个省事选哪个"。

---

## 3. 四条规则展开（有新代码的那些）

### 3.1 `nudgeCurve` —— 三段式整组位移（慢-快-慢）

```js
import { nudgeCurve } from '../../../src/kit/index.js';

const dx = nudgeCurve(f.lt, 0.6, 1.3, 220);   // 0.6s 起、1.3s 内向右推 220px
lines.fillRect(panel.x + dx, panel.y, panel.w, panel.h, P.bone);
```

三段是 `power3.in` 加速（**10%** 距离）→ 线性爆发（**65%**）→ `power4.out` 收尾（**25%**）。
【外部经验值】出处：`REFERENCE-hyperframes.md` 516 行（距离分配与"尾部 ≥ 3× 加速段"）、550 行（函数提案）。

**时长不是拍脑袋定的**（这一条【我方推导】，`tools/test-motion.mjs` 钉着）：要"慢-快-慢"接得住，
两处接缝的**速度必须相等**：

```
第 1 段 power3.in ：位移 = 0.10·dist·x³           ⇒ 段末速度 = 0.30·dist/d1
第 2 段 线性      ：位移 = 0.65·dist·x             ⇒ 速度     = 0.65·dist/d2
第 3 段 power4.out：位移 = 0.25·dist·(1−(1−x)⁴)   ⇒ 段首速度 = 1.00·dist/d3
令三者相等 ⇒ d1 : d2 : d3 = 2/13 : 1/3 : 20/39（≈ 0.154 : 0.333 : 0.513 个 dur）
```

副产品：`d3/d1 = 10/3 ≈ 3.33 ≥ 3` —— 516 行那条"尾部时长 ≥ 3× 加速段"**自动成立**，不用另凑一个数。
**没选的另一条路**（外部那一版到底是先定时长还是先定距离，我们没核实）：如果反过来先定时长
（比如 0.2 / 0.4 / 0.4），距离分配就不再是 10/65/25，两处接缝的速度也不再相等 —— 会看出"顿一下"。

**什么时候不用它**：① 要回弹 → `spring`；② 单个元素自己的位移 → `spring` 或 `from: 'up'`；
③ 一整段镜头的运镜 → `cameraPost`（那是摄影机，不是元素）。

### 3.2 `waterfallStagger` —— 错峰到达的归一化

```js
import { waterfallStagger } from '../../../src/kit/index.js';

const w = waterfallStagger(str.length, 0.12);              // 想给 0.12s/字
type.write(str, x, y, { t: f.lt, stagger: w.stagger });    // 超了就是 0.5/N，没超还是 0.12
if (w.capped) ctx.warnings.push(w.warning);                // 函数只判定，不喊
```

- **口径按 §4.4 的字面那条**：`items × stagger`，**不是** `(items−1) × stagger`（这样才能与出处逐字对上）。
  物理上的"波"是 `span = (items−1) × stagger`（最后一个元素真正开始的时间），它恒 ≤ `total`，也一并返回。
- 返回值：`{ items, stagger, total, span, rawStagger, rawTotal, maxStagger, capped, warning }` ——
  `stagger` 直接喂 `type.write`；`warning` 是**字符串或 null**（要喊就 `ctx.warnings.push`）。
- 另有一个**纯判据** `waterfallOver(items, stagger, maxStagger)` → boolean：静态扫描场景代码里的
  stagger 字面量时用它，**与 `.capped` 同一个口径**（两套算法打架的话，`check` 报的和运行时压的就不是一回事）。
- 边界：`items = 0` 不改写你的 `stagger`（没有元素可错峰）；`items = 1` 按字面口径也会把 0.9s 压到 0.5s
  （一个元素没有级联，压不压看不出来）；负 stagger 原样通过（这是**上**限）。
- **别用它去"通过检查"**：上限说的是"一组的到达要像一个节拍"，给不出好看的错峰就**减少同屏元素**
  （或者改用下面的二值到达），不是把 stagger 压到看不见 —— 同一条 stance 见
  [REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) 568 行："fix-the-motion, not silence-the-rule"。

### 3.3 二值到达（"到达不要用淡入"）⚠ 这一条撞上了我们自己的默认写法

外部那条原话是 **"Binary 0→1 opacity via `tl.set` — never fade an arrival"**
（[REFERENCE-hyperframes.md](REFERENCE-hyperframes.md) **517 行**，【外部经验值】）。

**在 anim 里怎么做到二值**（读代码得到的等价物，【引擎默认值】）：

| 写法 | 出来的是什么 | 证据 |
|---|---|---|
| `type.write(s, x, y, { t, stagger })`（**不传 alpha、不传 from**） | **二值**：第 i 个字在 `t = i × stagger` 那一刻**满不透明地出现**（位置不动） | `src/core/text.js:280`（`perGlyphAnim = stagger > 0`）、`:291`（`k`）、`:293`（`if (k <= 0) continue` —— 到点才画）、`:295–304`（`from === 'none'` 时 `al` 保持 1） |
| `type.write(s, x, y, { t, stagger, from: 'up' })` | **上浮 + 淡入**：`al = e`，边动边显影 | `src/core/text.js:296–304`（`if (from !== 'none') { … al = e; }`，第 **303** 行） |

⚠ **两件事必须说清**：

1. **我们现在的房子默认是"上浮 + 淡入"**（`from: 'up'` 到处都是，[AGENTS.md](../AGENTS.md) §3.5 也这么教）。
   按 517 行那条，**到达**应该改成二值 —— 但**我们没做过 A/B**：所以这一条在表里是
   **【外部经验值】，不是我们的结论**。真要改，第一站是拿一段 `still` / `sheet` 做对照（不要全片一起改）。
2. **不传 `t` 就等于全不画**：`opts.t` 缺省是 `0`，而 `k = sat((0 − i·stagger)/dur) = 0` ⇒ `continue`。
   套用二值到达时**必须**把 `t: f.lt` 给上（`src/core/text.js:259`）。

### 3.4 `glowPeakCap` —— 辉光峰值上限

```js
import { glowPeakCap } from '../../../src/kit/index.js';

const g = glowPeakCap([{ id: 'hero', peak: 0.62 }, { id: 'rim', peak: 0.3 }]);
if (!g.ok) { ctx.warnings.push(g.warning); hero.alpha = g.suggested[0]; }
```

- 【外部经验值】出处：`REFERENCE-hyperframes.md` **522 行**（"峰值 opacity ≤ ~0.45"）、552 行（函数提案）。
- 返回值：`{ cap, count, peak, ok, over, suggested, warning }` ——
  `over` 是超限项（`{ i, id, value, suggested, reason }`，按原下标），`suggested` 是**与输入等长**的建议值数组
  （超限项压到 `cap`，其余原样），`peak` **只统计有限值**。
- **不静默通过**（"空 ≠ 干净"这条纪律在纯函数这一层也成立）：`NaN` / `±Inf` / 根本不是数字的项
  **不算"没超限"**，而是记进 `over` 并标 `reason: '不是有限数'`。
- 参数写错就抛：`values` 不是数组、对象没有数值型 `.peak`、`cap` 非有限 —— 一律当场抛
  （与镜头模板参数写错同一条哲学）。
- ⚠ **它现在还没有接进 `post` / `check`**：`bloom` / `halation` 的强度是 0..1 的自由数，
  引擎不会替你判"这个辉光是不是太亮"（见 §4）。

---

## 4. 还没落地的（诚实清单）

| 规则 | 现在的状态 | 缺什么 |
|---|---|---|
| 碰撞式转场：**受害者时长 = 入侵者的 40–50%**（518 行） | 只有判据，**没有函数** | `enterOffset` / `transitionPass` 的入口要能接受"入侵者时长"，再按比例排受害者的退出 —— 现在两边各写各的 |
| 辉光峰值上限 | 函数有了，**没人调用** | 接进 `post`（或 `check` 的静态扫描：读场景里的 alpha 字面量），并定一条"谁在什么时候调用" |
| 错峰跨度上限 | 同上 | `check` 的静态扫描：读 `type.write` 的 `stagger` 字面量 + 同屏字数 ⇒ 直接报"这一屏的到达跨度 1.2s" |
| 模糊峰值绑定最大速度（519 行） | 引擎有真运动模糊（强项），但**谁也没规定模糊什么时候最大** | `cameraPost` 之外的一个 post 助手 |
| 粒子 ≤ 40（523 行） | 没有池、没有上限判据 | 一个 `makeBurst()` 之类的 kit 函数 |
| 二值到达 vs 淡入 | **没做对照实验** | 一段 `still` / `sheet` 的 A/B（不是全片一起改） |

外部那份 §4.4 说规则表 **8–12 条就够**（553 行），这份表目前 **12 条**（§2）。

---

## 5. 相关的其它文档

| 想知道 | 读 |
|---|---|
| 运动的**铁律**（什么会让成片随机出错） | [AGENTS.md](../AGENTS.md) §4 |
| "像一支片子而不是幻灯片"的四条配方（共享背景 / 一台摄影机 / 母题 / 甩走） | [AGENTS.md](../AGENTS.md) §4.5 |
| 抖动怎么给（幅度表 + `anim shake`） | [AGENTS.md](../AGENTS.md) §5 |
| 一屏一个主体（运动之外的另一半） | [LAYOUT.md](LAYOUT.md) |
| 节奏的宏观数值（每 20–40 秒换版面、8 秒静帧红线…**附证据强度**） | [STYLE.md](STYLE.md) §7 |
| 这三个函数的单测 | `node tools/test-motion.mjs`（纯 JS，不需要 GPU） |
