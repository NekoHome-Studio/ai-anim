# STATUS.md —— 当前状态、最近几轮的证据（§14–§19）

> 这份文件记录「读文档 → 核实不足 → 修复 → 验证」的每一步。
> 每条都写清：**问题**、**证据**、**改了什么**、**怎么验的**、**当前状态**。
> 它比 `docs/history/HANDOFF.md` 更"过程"；那份是上一轮的交接单（已过期，只作历史参考）。
>
> **§1–§13（第一～六轮）已移入 `docs/history/STATUS-rounds-1-6.md`**，**章节号原样保留** ——
> 别处写的「`docs/history/STATUS-rounds-1-6.md` §10」这类引用，改到那份归档里按同一个 § 号找。
> 旧索引里那句「§1–§13 是前几轮的记录，结论仍然有效（除 §11.3 明确更正的那一处）」
> 说的那处更正仍然成立，它的实际位置是 **§11.6**
> （「重大更正：P1-2 的『跨会话不确定性』不成立 —— 是探针取时错了」；
> 原索引写的 §11.3 是「P0-3 场景抛异常 = 硬失败」，与"更正"对不上 —— 两节都在归档文件里）。
>
> **本文只保留第七～十二轮（§14–§19）**，并且**停在第十二轮**：
> 之后的**第十三轮**（`tasks/optifine` 那一轮）与**第十四轮**（风格系统 + 字幕层）
> **没有**写进本文，见 `docs/history/IMPROVEMENTS-4-5.md` —— 别把这份文件当成最新的。
>
> **本文覆盖到哪一轮**（读数与验收数字照抄当时的记录）：
> 第十二轮 —— **Three.js 接进引擎**（第 3 种 3D：真网格）：Three.js 的画面作为**一张图层**
> 进合成器；`check` 18 帧全绿、`verify` 8/8（mean 2.10–2.40）、确定性 40/40、
> `hashes demo`/`beat` 各 11/11 **max 0**、沙盒 876 帧成片（2.8 fps）；
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
| 第二轮 | **`docs/history/IMPROVEMENTS-1-3.md` 的 17 条**：产物守门、背压判据、共享背景、`src/kit/`、诊断效率 | §10 |
| 第三轮 | **`docs/history/IMPROVEMENTS-1-3.md`**：静默失败（P0）、验收与一致性（P1）、效率与工作流（P2） | §11 |
| 第四轮 | **收尾**：⏸ 回归跑完、`probe-trans2` 判据重写、口播/旁白 B/C 档落地、beast 的配置口径拍板 | §12 |
| 第五 / 六轮 | pdoom-video 的「3D + 一镜到底」搬进引擎；**raymarch 通电**（三个"不报错"的接缝 + 非有限值判据） | §13 |
| **第七轮** | **A 档镜头库 `src/shots/`**：常见镜头从一百多行降到一行，画面逐像素不变 | §14 |
| **第八轮** | **B 档「配置档」**：时间线里直接写 `{ type: 'chart', … }`，任务可以只有 `task.config.mjs` | **§15（先看这个）** |
| **第九轮** | **`IMPROVEMENTS-3` 的 A–F 全部落地** + **渲染提速**（`readPixels` 30×、端到端 1.97×、`--gpu high`）+ 新瓶颈（传输）探明 | §16 |
| **第十轮** | **出片推流换 NV12**：每帧 8.29 → 3.11MB（−62%），ffmpeg 直接吃 `-pix_fmt nv12`；新量具 `probe-nv12` | §17 |
| **第十一轮** | **sodium 的画面可读性**：半实心积木 + 深度排序（"排序用的深度不能拿去算线宽"）；246s 成片重出 | §18 |
| **第十二轮** | **Three.js 接进引擎**：第 3 种 3D「真网格」；沙盒 = Three.js → **引擎自绘过渡** → Three.js | **§19（先看这个）** |
| **第十三轮** | **`tasks/optifine`**（OptiFine 原理讲解片，4 分 14 秒 / 15,240 帧）那一轮带回来的反馈 | 不在本文，见 `docs/history/IMPROVEMENTS-4-5.md` |
| **第十四轮** | **风格系统 + 字幕层**（`style` 风格包、`captions` 引擎字幕；含 `IMPROVEMENTS-4` 的收尾） | 不在本文，见 `docs/history/IMPROVEMENTS-4-5.md` |

> 上表里 `§1–§9` … `§13` 那几行按 § 号去归档文件 `docs/history/STATUS-rounds-1-6.md` 里找
> （章节号原样保留，结论仍然有效）；`§14`–`§19` 在本文；第十三、十四轮两行**不在本文**。

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
   这正是 `docs/history/IMPROVEMENTS-1-3.md` 那类 bug（写错了但画面照样出）的通用解法 —— 能抛错就别约定。
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

根因是引擎的已知坑：`type.write` 的 `align` 是**逐字**生效的（`docs/history/IMPROVEMENTS-1-3.md` P1-4 记过），
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

> 本轮有两个来源：①`docs/history/IMPROVEMENTS-1-3.md` 的 A–F 六条建议（做 promo 时用户说"镜头像地震"查出来的）；
> ②用户要求"探索一下有没有更快的渲染方式"。①全部落地，②量出了**新的瓶颈**并且顺手把最大的一块修掉了。

### 16.1 A–F 六条：全部落地

逐条对照见 `docs/history/IMPROVEMENTS-1-3.md` §6（含"哪一条的前提是错的"）。一句话版：

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
5. ~~老任务里的 `disp()/dcss()` 颜色绕行补丁（`tasks/nekohome/scenes/_kit.js` 顶部）要不要回改 —— 仍待用户拍板。~~
   → ✅ **2026-10-16 用户拍板：不回改**（成片已定稿，片里 `dscale(P, …, 1.35)` 这类系数是照现观感调的）。
   只把 `_kit.js` 顶部注释更正为"**历史绕行补丁，不是设计要求**"，并写明会偏亮、新片子别照抄。
   见 [`BACKLOG.md`](BACKLOG.md) §4 里"第十二轮"那几行。

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

`tasks/sodium/HANDOFF.md` 给的三个方案（A 拆井字+分主次 / B 深度排序+隐藏线 / C 半实体积木）**这一轮三个都做了**，
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

### 18.5.1 这一轮的读数对照（改前 / 改后）

| 项 | 改前 | 改后 |
|---|---|---|
| `check` 每段亮度（36 点） | 0.040–0.075 | **0.040–0.276**（更亮 = 面上有东西了，但没有过曝告警） |
| 背景守门 | 11/11 | 11/11 |
| 出片速度（`--samples 8`） | 3.2 fps | **3.04 fps**（代价 ≈5%，全片 79 分钟） |
| 成片体积（CRF 16） | 6.58 GB | 5.84 GB（面更平整，压得更省） |

出图核对：12 个中段时刻全部出图并用 Read 看过；另外单独扫了 `dispatch` 横穿世界那一段的
**逐帧亮度**（40–54s 共 13 个点），确认从 47 降到 29–47 且**连续无跳变**。

### 18.5.2 这一轮学到的

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
| `docs/history/HANDOFF-THREEJS.md` | 顶部加"已落地"横幅：它是这一轮的设计档，现状以 `docs/THREE.md` / §3.8 为准 |

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
