# 参考拆解：browser-use/video-use（"Edit videos with coding agents"）

> 拆解日期 **2026-10-10**。上游 <https://github.com/browser-use/video-use>（MIT，Python，约 28.5k stars，默认分支 `main`）。
> 由并行子代理逐文件读完原文产出（`SKILL.md` 全文、`README.md`、`install.md`、`helpers/`、`skills/`、`tests/`），
> **未改动任何本地文件**，由主代理原样归档。证据取自 GitHub tree/contents API 与 raw 文件全文；
> 无原文支撑的判断一律标"推测"。
>
> **本文件只记"别人怎么做"** —— 可执行的待办一律以 [`BACKLOG.md`](BACKLOG.md) 为准（本轮新增在 **§1.B**）。
> 与另外两份的关系与横向对比见 [`REFERENCE-agent-video-projects.md`](REFERENCE-agent-video-projects.md)。

---

## 0. 结论先行

- **它不是一个视频编辑器，是一份 26KB 的 `SKILL.md` + 6 个 Python 脚本。** `helpers/` 六个文件合计 75,658 字节，`tests/` 三个文件 11,999 字节，此外没有任何可执行代码。真正的"智能"全在 agent 侧；仓库侧只是 ffmpeg 命令编排。
- **MIT 许可**（`LICENSE:1` "MIT License / Copyright (c) 2026 Browser Use"；repos API `license.spdx_id: "mit"`）。28,545 stars / 3,359 forks / 147 open issues，建仓 2026-04-12，最近 push 2026-10-08。
- **对 anim 最值得抄的一件事：给 `anim sheet` 叠一条音频通道**（波形 + 静音带 + 旁白词标签），把"画面揭晓时刻对不对得上旁白"从人眼比对变成一张图。理由见 §3.1。
- **它没有素材库、没有 B-roll 管理、没有许可与出处记录**——这块是空白，不值得抄。
- **工程质量上 anim 全面领先**（它没有 CI、3 个 unittest 全部 mock 掉 `subprocess.run`、没有一处真的跑 ffmpeg 校验产物）；但它在**音频量具**与**自检流程纪律**上有两条 anim 该补的。

---

## 1. 它到底是什么

### 机制
一句话：**把"剪片子"拆成"agent 读文字 + 按需看一张合成图 + 生成一份 JSON 剪辑单 + ffmpeg 照着执行"**。README 的原文是 "The LLM never watches the video. It **reads** it"。

两层读物（README "How it works"）：
1. **Layer 1，常驻**：每个源素材一次 ElevenLabs Scribe 调用 → 词级时间戳 + 说话人分离 + 音频事件（`(laughter)` `(applause)` `(sigh)`）→ `pack_transcripts.py` 压成一个约 12KB 的 `takes_packed.md`（按静音 ≥0.5s 或换人断句，每行带 `[start-end]`）。
2. **Layer 2，按需**：`timeline_view.py <video> <start> <end>` 出一张"胶片带 + 波形 + 词标签 + 静音阴影"的 PNG，**只在决策点调用**（SKILL.md："**Not a scan tool** — use it at decision points, not constantly"）。

README 把 token 账算得很直白："Naive approach: 30,000 frames × 1,500 tokens = **45M tokens of noise**. Video Use: **12KB text + a handful of PNGs**."

### 运行方式
`install.md` 把安装本身也写成给 agent 的指令：clone 到 `~/Developer/video-use` → `uv sync` → `brew install ffmpeg` → **把整个目录 symlink 到 `~/.claude/skills/video-use`**（注释明确"Symlink the **whole directory**, not just `SKILL.md`. The helpers need to sit next to it."）→ 写 ElevenLabs key 到 `.env`。之后用户 `cd` 到素材目录跑 `claude`，说一句 "edit these into a launch video"。

### 依赖
| 类别 | 内容 | 证据 |
|---|---|---|
| 硬依赖 | `ffmpeg` + `ffprobe` | `install.md`："`ffmpeg` and `ffprobe` are hard requirements" |
| 硬依赖 | Python ≥3.10 + `requests` `librosa` `matplotlib` `pillow` `numpy` | `pyproject.toml` `[project] dependencies` |
| 硬依赖 | ElevenLabs Scribe API key（转写） | `install.md`："Scribe (ElevenLabs) does all transcription. Without a key, nothing transcribes." |
| 可选 | `yt-dlp`（拉网上的源）、Node 22+（HyperFrames）、`npx create-video`（Remotion）、Manim+LaTeX | `install.md` 三处 "optional"/"lazily" |
| **没有** | 浏览器、本地模型、任何 GPU | 全仓无浏览器/推理依赖 |

### "coding agent 编辑视频"具体指什么工作流
SKILL.md 的 `## The process` 八步，**第 3、4 步是硬门**：Inventory（ffprobe 全部 + 批量转写 + pack）→ Pre-scan（挑口误）→ **Converse**（用素材长出来的问题问用户，不用固定清单）→ **Propose strategy**（4–8 句话给出 shape/take 选择/剪辑方向/动画计划/调色方向/字幕风格/时长估计，然后**等确认**）→ Execute（产 `edl.json`，动画**并行**派子代理）→ Preview → Self-eval → Iterate+persist。

对应的硬规则是 Hard Rule 11："Strategy confirmation before execution. Never touch the cut until the user has approved the plain-English plan."

---

## 2. 数据模型 / 中间表示

### IR = `edl.json`，一个**取材清单**，不是效果图
SKILL.md `## EDL format` 给出完整 schema，字段全在这儿了：

```json
{"version":1,
 "sources":{"C0103":"/abs/path/C0103.MP4"},
 "ranges":[{"source":"C0103","start":2.42,"end":6.85,
            "beat":"HOOK","quote":"...","reason":"Cleanest delivery, stops before slip at 38.46."}],
 "grade":"warm_cinematic",
 "overlays":[{"file":"edit/animations/slot_1/render.mp4","start_in_output":0.0,"duration":5.0}],
 "subtitles":"edit/master.srt",
 "total_duration_s":87.4}
```

三点判断，都有证据：

1. **是声明式时间线，但粒度是"从某个源文件的 [start,end) 取一段"**。没有关键帧、没有转场类型、没有变速、没有位置/缩放/不透明度/blend mode。`overlays[]` 每项只有 `file` / `start_in_output` / `duration` 三个字段——**想做画中画，agent 只能自己在子代理里把位置烘进那段 overlay 视频**（SKILL.md Principle 6 "Invent freely… split-screen, picture-in-picture… build it. The helpers are ffmpeg and PIL."）。
2. **不是"自然语言 → ffmpeg 命令"的自由生成**，而是被收窄到 EDL 这一层接口；但留了一个**有界逃逸口**：`grade` 既可以是 preset 名，也可以是**裸 ffmpeg filter 字符串**——`render.py` 的 `resolve_grade_filter()` 用 `re.fullmatch(r"[a-zA-Z0-9_\-]+", grade_field)` 判断：短标识符当 preset，否则当 raw filter。这个逃逸口仍然存在 EDL 里，所以可重放。
3. **IR 是敞口的**：绕过 EDL 直接写 ffmpeg 的部分（比如手工 PiP）不进 IR，**无法重放**。这是它与 anim 的根本差别——anim 的 `task.config.mjs` 是**闭**的，所以 `hashes --baseline` 能证明"画面逐像素没变"；video-use 证不了。

### 渲染管线的实现全在 `render.py` 一个文件
`render.py` 顶部 docstring 写明了顺序，这就是它的"引擎"：
1. **逐段抽帧**（`extract_segment`）：`-ss` 前置快速定位 + `-t` + `-vf`（HDR tonemap? → scale 1920 → grade）+ `-af affade 30ms`，编码 `libx264 CRF 20`；
2. **无损拼接**（`concat_segments`）：concat demuxer + `-c copy`；
3. **合成**（`build_final_composite`）：`filter_complex`，overlay 先 `setpts=PTS-STARTPTS+{t}/TB` 位移，字幕**最后**；
4. **响度归一**（`apply_loudnorm_two_pass`）：两遍 `loudnorm`，`-14 LUFS / -1 dBTP / LRA 11`。

### 确定性
- **同一份 EDL + 同一批源文件 + 同一批 transcript ⇒ 输出相同**：所有 ffmpeg 参数都是 EDL 的纯函数；`grade: "auto"` 走的 `auto_grade_for_clip()` 用 `fps=…,signalstats,metadata=print` 采样（采样点由 `fps` 过滤器决定，不是随机的），所以也是确定的。
- **但没有任何帧级/像素级验证**。全仓没有 `verify`、没有 `hashes`、没有"成片抽帧 vs 重新渲染"的比对。唯一接近的是自检时跑 `ffprobe` 核时长（SKILL.md Self-eval："Run `ffprobe` on the output to verify duration matches the EDL expectation"）。
- **每次渲染都是全量重编**。`extract_all_segments()` 没有 skip-if-exists；改一个字幕样式 = 重抽所有段 + 重拼 + 重合成 + 重做两遍 loudnorm。世代损失客观存在（CRF 20 抽段 → CRF 18 合成 → 音频再编一次 AAC 192k）。

### 非破坏式 + 重渲染
**有，而且是硬规则**：Hard Rule 12 "All session outputs in `<videos_dir>/edit/`。**Never write inside the `video-use/` project directory**"；目录布局固定为 `edit/{project.md, takes_packed.md, edl.json, transcripts/, animations/slot_<id>/, clips_graded/, master.srt, downloads/, verify/, preview.mp4, final.mp4}`。转写缓存也是硬规则：Hard Rule 9 "Cache transcripts per source. Never re-transcribe unless the source file itself changed"，`transcribe.py` 的 `transcribe_one()` 真的实现了（`if out_path.exists(): return out_path`）；anti-patterns 里写着 "Re-transcribing cached sources. **Immutable outputs of immutable inputs.**"

### 三层质量阶梯（这个 anim 可以对照）
`--draft` 720p ultrafast CRF28（"cut-point verification only"）/ `--preview` 1080p medium CRF22（注释："evaluable for QC"）/ 默认 1080p fast CRF20。竖屏自动判（`is_portrait_source()`，**只看 side_data rotation，明确忽略纯 metadata rotate tag**，`tests/test_render_orientation.py::test_plain_rotation_tag_without_side_data_is_ignored` 就是为这条写的）。

---

## 3. 可借鉴点

### 3.1 ★ 四合一验证图：给接触表叠音频轨（`timeline_view.py`）
**① 对方怎么做的**：一条命令出一张 PNG，横轴是同一个时间窗，从上到下四层：
- **胶片带**：`extract_frames()` 用 `ffmpeg -ss t -i … -frames:v 1 -vf scale=320:-2` 抽 N 帧（默认 10），按统一高度等比缩放横向拼接，超宽自动整体缩；
- **波形**：`compute_envelope()` 抽 mono 16kHz PCM 后**手工 windowed RMS**，注释明确 "avoid librosa as a hard dep"——**不引 numpy 之外的东西**；
- **静音带**：`find_silences()` 找 ≥0.4s 的空隙，画半透明蓝条，图例写 "shaded bands = silences ≥ 400ms (N gap(s))"；
- **词标签**：只画时长 ≥0.05s、且与上一个标签横向间距 ≥28px 的词（`if (we - ws) < 0.05: continue` / `if cx - last_label_x < 28: continue`），带时间标尺。
docstring 还替 agent 写好了用法边界："Use this at decision points… **Do NOT call it in a scan loop over every utterance**; it's an on-demand drill-down, not a background index."

**② anim 现在缺什么**：`anim sheet --from 0 --to 12 -n 16` 已经有自动抽帧接触表，`check` 有逐段亮度统计，`say` 已经把**词级时间戳**写进 `narration.json`。缺的只有一件事：**这三样从来没有叠在同一张图上**。"这句旁白说出口的瞬间画面揭晓到哪一步"现在是靠 `narration.mjs` 的 `cue` / `internal` 参数**盲写**、出片后人眼比对——而 `sheet` 出的图里没有任何音频信息。

**③ 搬过来要改哪里 / 代价**：改一个地方——`sheet` 增加音频通道。数据全在仓库里：词级时间戳走 `scripts/lib/say.mjs` 已产出的 `narration.json`；音频包络直接用 `src/core/audio-analysis.js`（纯 JS FFT，Node 与浏览器共用，**不需要像对方那样临时抽 WAV**）；绘图复用现有的 PNG 输出路径。**代价：小**（一个 `tools/` 脚本或 `sheet` 的一个开关，不碰 GPU、不碰渲染）。

**④ 值不值：最值。** 对方这条"avoid librosa as a hard dep"的注释正好说明：能用纯 JS/纯 ffmpeg 做到的，不值得引数学库。anim 现在每次验证要 Read 若干张单帧 PNG，"这一帧对应哪句旁白"要人去数时间。一张图 = 一次 Read，且带上纵向对齐，比"多出几张图"更省 token 也更可靠。这是全仓对 anim 性价比最高的一条。

### 3.2 音频量具：把"听不见"变成可读的数字
**① 对方怎么做**：`render.py` 的 `measure_loudness()` 跑 `loudnorm=…:print_format=json`，从 **stderr 里 `rfind("{")` 抓 JSON**，解析 `input_i/input_tp/input_lra/input_thresh/target_offset`；`apply_loudnorm_two_pass()` 第一遍量、第二遍带 `measured_*` + `linear=true` 重写。目标 `-14 LUFS / -1 dBTP / LRA 11`，注释写明 "Matches YouTube / Instagram / TikTok / X / LinkedIn normalization targets"。SKILL.md 自评段把它上升成纪律："Measure the audio, don't assume it: `ffmpeg -i out.mp4 -af ebur128=peak=true -f null -` … plus RMS per section (dialogue, music-only, end card). An end card 15 dB under the dialogue, or effects louder than speech, is a bug. **You cannot listen: say so, and report the numbers.**"

**② anim 缺什么**：`anim mix` 有闪避（`duckGain` / `mixTracks`），但 AGENTS.md 全文**没有任何响度目标**——没有 LUFS、没有 true peak、没有 ebur128。`video` 收尾用 ffprobe 复核帧数，**不复核响度**。
**③ 代价**：很小。`scripts/lib/media.mjs` 加一个 `measureLoudness()`（同样的 JSON 解析），`anim mix` 收尾打印数字，`check` 里报出来。
**④ 值不值：很值。** 这是"agent 听不见"的正解，而且完全契合 anim 已经建立的哲学：`check` 用亮度数字、`anim shake` 用逐帧变化量判"手持 vs 振动"、`video` 复核帧数、`verify` 逐像素。**唯独音频这一层还在靠人耳**（音乐压过旁白、旁白忽大忽小、片尾比正文低 15dB，现在没人拦）。

### 3.3 自检的流程纪律：切点两侧固定出图 + 3 轮上限 + 对抗性审查者
**① 对方怎么做**（SKILL.md 步骤 7 "Self-eval, before showing the user"）：
- 在**渲染产物**（不是源素材）上、**每一个切点前后 ±1.5s** 跑 `timeline_view`，查四件事：切点视觉断裂/闪白/跳、**波形尖峰（漏过 30ms fade 的爆音）**、字幕被叠层挡住、叠层错位或显示错帧；
- 再抽样 first 2s / last 2s / 2–3 个中点；
- **"Cap at 3 self-eval passes"**——3 轮不过就交给用户，不许无限循环；
- 对外发布的片子额外 spawn 一个 **critic 子代理**，brief 是"**roast, not to praise**"：给 verdict、按时间码排序的问题清单、**带证据（帧、电平）**、以及"最先该做的 5 个修复"。

**② anim 缺什么**：anim 的静态与确定性检查远强于对方（`check` 三点采样 + 多子帧比对 + 背景守门、`verify`、`hashes`、`audit`、`lint-narration-dup`、`probe-*`、`regress-all`——对方**一个都没有**）。缺的是三件流程：
- **"切点两侧 ±1.5s"不是默认动作**：`check` 采的是 15%/50%/85%，**不落在切点上**；要知道切点长什么样得手写 `--only`；
- **渲染循环没有轮数上限**（AGENTS.md §10 的自检清单没有"最多几轮"）；
- **没有"审查者 brief"**：`docs/SCENE-BRIEF-TEMPLATE.md` 是**生产** brief（派子代理去写分镜），不是**审查** brief。

**③ 代价**：`anim cuts <任务>`（对每个段边界出 ±1.5s 接触表）是小改动，`sheet --only` 已有全部零件；另两条**零代码，纯文档**。
**④ 值不值：值。** "3 轮上限"和"roast 型审查者 brief"是纯文档收益；`anim cuts` 把"每一段都看过"从一个纪律要求（AGENTS.md §10 第 2 条）变成一条命令。

### 3.4 并行子代理的 10 项 brief 模板（做变体时直接可用）
**① 对方怎么做**：Hard Rule 10 "Parallel sub-agents for multiple animations. **Never sequential.** Spawn N at once via the `Agent` tool; total wall time ≈ slowest one." SKILL.md 给出一份 10 项 brief：一句话目标（"Build ONE animation: [spec]. Nothing else."）→ **绝对输出路径** → **确切技术规格**（分辨率/fps/codec/pix_fmt/CRF/时长）→ 调色板具体值 → **字体路径 + index** → 逐帧时间线（何时发生什么，带缓动）→ **anti-list**（"no chrome, no extras, no titles unless specified"）→ 代码模式参考（"copy helpers inline, don't import across slots"）→ 交付物清单（脚本/渲染/ffprobe 核时长/报告）→ **"Do not ask questions. If anything is ambiguous, pick the most obvious interpretation and proceed."** 每个动画一个 `edit/animations/slot_<id>/` 目录，一个子代理 = 一个文件（唯一文件名，并行不互相覆盖）。
另外 SKILL.md 反复强调一条 anim 已经踩过的坑："**Fonts fail silently.** A web font that didn't load renders in a fallback face with no error — the video ships in 'almost Arial'."（`document.fonts.check('700 76px "Inter"')` 断言；PIL 侧必须传显式字体路径。）anim 的 `task.fonts` + "文字是方框"症状表是同一个坑。

**② anim 缺什么**：AGENTS.md §7 已经有"并发子代理的产出先落到 `out/_staging/`"，**说明 anim 已经在并行做片**，但没有一份成文的并行 brief 模板。上述 10 项里有三条 anim 特别该抄：**确切技术规格**（anim 必须写死 width/height/fps/scale/style/captions，否则默认值会漂）、**anti-list**（anim 的"相邻两支片子不能同风格"本质就是要一份 anti-list）、**"不要提问，自己挑最显然的解释往下做"**（并行子代理一提问整批就卡住）。
**③ 代价**：零代码。**④ 值不值：值**，尤其做变体（同一支片子的 3 个风格版本）。

### 3.5 素材管理：对方基本是空白，只有一条纪律值得抄
**① 对方怎么做**：**没有素材库**。B-roll 只有两个来源：用户丢进目录的文件，或 `yt-dlp`（`install.md`：可选，`downloads/` 目录）。**没有任何 license / attribution / 出处字段**——SKILL.md 的 EDL schema 里我逐字看过，`sources` 只存绝对路径，`ranges[]` 存的是 `beat` / `quote` / `reason`。它完全没有"避免重复用同一段素材"的机制（**推测**：靠 agent 自己记得；IR 里没有 used-count）。
唯一可抄的是**纪律**：`ranges[].quote`（取了哪句原话）+ `ranges[].reason`（为什么取它，例："Cleanest delivery, stops before slip at 38.46."）——**每个剪辑决定都自带一句自证**。anim 的时间线节点合法键里已经有 `note`（AGENTS.md §3.2 的键表），但没规定要写"为什么选这个镜头模板"。

**② anim 缺什么**：anim 缺"从已有素材里挑片段"这个能力本身（`docs/BACKLOG.md` 该管这件事）。
**③ 代价**：写 reason 是零成本纪律；真正的"素材裁切层"是大工程（见 §3.6）。
**④ 值不值**：`note`/`reason` 这条值（低成本、可审计）；素材库本身**对方没有可抄的**。

### 3.6 一旦 anim 要剪真实素材，必撞的五条硬规则（这是最有价值的"坑清单"）
对方花了 12 条 Hard Rules 换来的经验，其中五条是**任何"把预烘焙视频段拼进成片"的管线都会撞上的**：

| # | 规则（原文缩写） | 为什么 | 对 anim 的对应 |
|---|---|---|---|
| 1 | "**Subtitles are applied LAST** in the filter chain… Otherwise overlays hide captions. Silent failure." | 叠层顺序 | anim 的 `captions.js` 已经画在**后处理之后**（AGENTS.md §6.5："字幕画在后处理之后——它是信息层")——**anim 已经做对了** |
| 2 | "**Per-segment extract → lossless `-c copy` concat**, not single-pass filtergraph. Otherwise you double-encode every segment" | 世代损失 | anim 现在是**一次编码**（逐帧推 NV12 给 ffmpeg），天然无接缝。抄素材裁切会**引入**这个问题 |
| 3 | "**30ms audio fades at every segment boundary**… Otherwise audible pops at every cut." | 拼接爆音 | anim 的 `cut(..., { overlap })` 是引擎内交叠，没有接缝。一旦 concat 素材就必须补 `afade` |
| 4 | Overlays use **`setpts=PTS-STARTPTS+T/TB`**… Otherwise you see the middle of the animation during the overlay window. | overlay 的第 0 帧落位 | anim 的 `f.lt`（段内时间）已由引擎保证；**不适用** |
| 5 | "**Master SRT uses output-timeline offsets**: `output_time = word.start - segment_start + segment_offset`" | concat 后字幕错位 | anim 的 `subs` 直接按整片时间出，**没有这个偏移问题** |

**结论**：anim 现在的"无接缝、一次编码、字幕在后处理之后"是**结构性优势**，不是欠账。真要做素材裁切，**唯一不破坏这三条**的做法是把素材段在 ffmpeg 层拼好当"底"，代码镜头再合成上去——但那样代码镜头就失去了"逐帧可 seek"的便利（**推测**：这是 anim 做素材剪辑时的核心设计取舍，值得写进 `docs/BACKLOG.md` 而不是等实现时才发现）。

### 3.7 两条失败设计：资源缺失必须报错 + 花钱前先校验输入
**① 对方怎么做**：
- `resolve_subtitles_path()`：EDL 指的字幕文件找不到时**直接 `sys.exit`，绝不静默渲染一个没字幕的片子**。错误信息带"试过的所有路径"+"修法"：`sys.exit(f"subtitles file in EDL not found (tried {tried}). Fix the path or pass --no-subtitles.")`；`tests/test_render_captions.py::test_missing_is_an_error` 断言异常消息里含 `--no-subtitles`。
- `transcribe.py` 的 `peak_dbfs()` 守门：上传前先量 16-bit PCM 峰值，`if peak < -60.0: raise RuntimeError(...)`，错误信息里说明"这个文件有 N 条音轨，试试 --audio-track 0 或 1"。理由写在注释里："**Uploading silence costs the same as uploading speech and returns nothing**, so catch the wrong-track case before paying for it."

**② anim 缺什么**：报错哲学 anim 是有的（参数名写错会抛、时间线混写会抛、模板名写错会抛），但**"资源文件缺失"这一类 IO 错误是否同样硬**，AGENTS.md §8 里"音频解码失败 → 跑 analyze 或换 mp3/m4a"、"文字是方框 → 字体没加载完"这两条症状说明**存在静默降级的可能**（**推测**，未读 anim 源码）。`anim say` 已经有 `--dry-run`，但那是"不合成"，不是"合成前校验脚本本身合法"。
**③ 代价**：小。**④ 值不值**：值——"花钱的调用之前先校验输入"这条对 `anim say`（调 TTS）直接适用。

### 3.8 反面教材（同一份文档里的常量漂移）
SKILL.md 的 `bold-overlay` 字幕样式写 **`MarginV=35`**，并说 "`render.py` ships with this as `SUB_FORCE_STYLE`"；而 `render.py` 里的 `SUB_FORCE_STYLE` 实际是 **`MarginV=90`**，旁边注释明确："MarginV is NOT taste — it is a platform safe-zone rule… **Do not drop this below ~75 without a specific reason**."（讲清 TikTok/Reels/Shorts 的 UI 吃掉 1080×1920 底部约 25–30%。）**照 SKILL.md 抄会把竖屏字幕放到被 UI 遮住的位置。** 同类漂移还有：`render.py` 首行 docstring 说 "Implements the **HEURISTICS** render pipeline"，`grade.py` 的 `warm_cinematic` 注释说 "Originally from **HEURISTICS §6**"——但全仓 44 个 blob 里**没有 HEURISTICS.md**（tree API 完整列表）。
这提醒 anim：AGENTS.md 里同样散落着引擎常量（默认 4 秒、`maxSamples` 档位 8/24/72/216、字幕保留带 y 40–104、`--tol` 默认 2.5）。anim 已经有了部分防线（`anim shots` 打印真实默认值、`test-style.mjs` 断言"不写 style 时像素不变"）——**这条该守住，别退化**。

---

## 4. 不适用 / 别照抄

1. **别抄它的引擎选型哲学**。video-use 把动画引擎当外挂、每次 lazily 装（HyperFrames 要 Node 22+、Remotion 要 `npx create-video@latest`、Manim 要 LaTeX）。anim 的立身之本是"没有外挂、一支 CLI、逐帧纯函数"——照搬"按 slot 挑引擎"会直接毁掉确定性，`hashes --baseline` 立刻失效。（顺带：它自己 vendored 的 `skills/manim-video/` 参考文档约 99KB，**比它自己的 helper 代码 75.7KB 还大**。）
2. **别抄它的 Python 生态**。`pyproject.toml` 是 `requests/librosa/matplotlib/pillow/numpy`。`timeline_view.py` 里"avoid librosa as a hard dep"那句注释恰好证明：**能用纯 ffmpeg 或纯 JS 做到的，不值得引数学库**。anim 有 `scripts/lib/media.mjs` + 纯 JS FFT（`src/core/audio-analysis.js`），别换成 numpy。
3. **别抄云 API 依赖**。转写全靠 ElevenLabs Scribe（付费；`install.md`："**Never run transcription as part of install verification** unless the user explicitly asks — Scribe costs real money"）。anim 的 TTS 走 `edge_tts`（`tools/tts-edge.py`）且有确定性假驱动 `tools/stub-tts.mjs` 做离线回归——**anim 这条路线更好，别换**。
4. **别抄"逐段重编码 + concat"的管线**。它是被真实素材逼出来的（无法逐帧求值），代价是世代损失 + 全量重渲（没有 skip-if-exists）。anim 是一次编码、可任意 seek、可中断重来，**别把自己降级**。
5. **别抄"音频为主"当默认**。video-use 的世界观是"素材既定、编辑是在已有语音里挑"，因为输入就是别人的口播。anim 的输入是代码与 TTS，`solveTiming` 是**用旁白定画面时长**，方向相反。把"切点来自静音间隙"当默认会拆掉 narration 层。
6. **别抄"LLM 从不看视频"当教条**。它这么做是因为 45M tokens 不可行、且它**没有逐帧可复现的渲染器**。anim 有 `verify`（成片抽帧 vs **同一时刻重新渲染**逐像素比）和 `hashes`——验证上限高一档。该优化的是"少看几次"（接触表），不是"不看"。
7. **别抄 2 词大写字幕风格**。`bold-overlay`（2 词、UPPERCASE、Helvetica 18 Bold）是短视频社交流派；AGENTS.md §6.5 明确"别做逐词高亮"，引 12 分钟/96 人实验说关键词突显是**负效应**。**规则可抄、风格别抄**——但 `MarginV` 那段"留白不是审美是平台安全区"的论证值得读，anim 的 `style.grid.captionBand` 概念一致，已经做对了。
8. **别抄"没有 CI 也能跑"**。28.5k stars，没有 `.github/`，3 个 unittest 全部 `unittest.mock.patch` 掉 `subprocess.run`，**没有一处集成测试真的跑 ffmpeg 验证产物**。这是规模化后的反面教材。
9. **"transcript 缓存 + 只读源素材"这条不用抄**——anim 已经有更硬的版本（`out/` 落产物，且"渲染期间一个文件都别写"这条约束对方根本没有，因为它不跑 dev server）。

---

## 5. 一句话结论

**最值得抄的一件事：给 `anim sheet` 叠上音频通道（波形 + ≥400ms 静音带 + 旁白词级标签 + 时间标尺），让"画面上这个揭晓发生在旁白说到哪一刻"在一张 PNG 上一次判定**——因为 anim 的验证哲学已经是"用数字守门"（`check` 亮度 / `anim shake` 判抖动 / `verify` 逐像素 / `video` 复核帧数），唯独音频与音画同步还靠人耳和手数时间，而对方用两个极便宜的 ffmpeg 调用就把这一层变成了可读的图；顺带把它那条 `-14 LUFS / -1 dBTP` 的响度数字守门一起补进 `anim mix`，成本是 `scripts/lib/media.mjs` 里一个函数。
