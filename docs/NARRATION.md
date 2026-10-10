# NARRATION.md —— 口播（旁白）这一层，引擎还没有

> ## 📌 状态：**A / B / C 三档都已落地**
>
> A 档（`task.audio = { music, vo, mix }` 分轨 + `task.narration` 句子表 + `dur: { vo }`）、
> B 档（`anim say` / `anim mix`：TTS 入口、时长反推、闪避）、C 档（词级时间戳 → `type.karaoke`）
> 现在都在引擎里。**标题里的"引擎还没有"是这份文档写下时的状态，已经不成立。**
> 下面保留"缺口"的记录，是为了说明这一层为什么必须存在、当初是怎么绕过去的；
> 每条现在长什么样、改法与证据见 [`docs/STATUS.md`](./STATUS.md)：
> A 档在第三轮（§11），**B / C 两档在第四轮（§12.2，含离线回归与真 TTS 通电的原始输出）**。
> 要做一支带旁白的片子，直接看 §4 的"已补什么"。

> 起因：`tasks/beast` 第一版是 63 秒塞 12 段（平均一段 5 秒），信息密度太高，观众读不完，
> 而且只有一条 120bpm 的循环音轨，听感单调。用户提出「用 TTS 生成语音，反过来决定片段长度」。
> 结论：**这属于引擎层的缺口** —— 引擎目前只有「一条音轨」的概念，没有口播轨、没有闪避、
> 没有语音时间轴、没有字幕对齐，也没有任何 TTS 入口。这份文档记下缺口、这次怎么绕的、
> 以及引擎该按什么顺序补。

---

## 1. 现状：引擎对声音的抽象

| 能力 | 现状 | 位置 |
|---|---|---|
| 音轨 | **可分轨**：`task.audio = { music, vo, mix }`（分析源 = `music ?? mix ?? vo`，封装源 = `mix ?? music ?? vo`；没有独立 music 轨时会明确警告"节拍是从人声/混音里测的"） | `src/tasks.js` / `src/core/engine.js` |
| 节拍/包络 | `analyze` 从**分析源**测 bpm/拍/段落/包络，给 `f.beat` `f.a` | `scripts/anim.mjs analyze`、`src/core/audio.js` |
| 词级时间轴 | `anim say` 把驱动给的词级时间戳写进 `audio/narration.json` 的 `lines[].words`（**整片绝对时间**，秒），`type.karaoke` 直接吃它 | `scripts/lib/say.mjs`、`src/core/text.js` |
| 多轨混音 | `anim mix`：旁白摆到绝对时刻 + 闪避，混成**一条**轨（`audio/<任务>-mix.mp3`）；引擎侧仍然只认一条轨 | `scripts/lib/mix.mjs` |
| 闪避（说话时压音乐） | `anim mix` 里做（默认说话时音乐剩 22% ≈ −13 dB，起音快释放慢）；参数在 `DEFAULT_DUCK`，`narration.mjs` 导出 `DUCK` 可覆盖 | `scripts/lib/mix.mjs` |
| 口播时间轴（谁在第几秒说话） | `task.narration` → `ctx.narration`（`at` / `current` / `line` / `durOf` / `progress` / `typed` / `until` / `in`）；`cut(shot, { dur: { vo: 'line-id' } })` 按某句旁白定时长 | `src/core/narration.js`、`src/timeline.js` |
| TTS | `anim say`（CLI 侧，不进浏览器）；驱动约定与优先级见 §4 B 档 | `scripts/lib/say.mjs` |

**下面这段是 `tasks/beast` 那一轮的历史**：当时所有跟「人说话」有关的事都得在引擎外面手工做完，
最后塞回那一条 `audio` 里。**当时就是这么干的**（见第 3 节），代价是：镜头时长被旁白倒推、画面放慢系数要自己算、
音画对齐靠外部脚本、引擎完全不知道哪几秒有人在说话。

## 2. 缺口的三个具体后果（都在这支片子里真实发生过）

1. **镜头时长只能靠人估**。第一版按「12 段 × 5 秒」排，结果是每段 2–4 个信息块挤在 5 秒里。
   正确做法是先把话说出来、量出真实时长，再反推镜头长度 —— 这需要引擎接受「外部给的时长表」。
2. **配乐只能硬铺**。这条片子的旁白占了 77% 的时长，如果音乐不闪避，人声会被糊掉；
   而引擎只认一条轨，闪避必须先用 ffmpeg 混好再塞进去，等于绕过了引擎。
3. **踩拍子会踩错**。`analyze` 从**混音**里测出的是 **136bpm**（人声干扰），而实际配乐是 96bpm。
   `f.beat` / `f.beatPhase` 因此是错的 —— 本片里底部那条母题带的呼吸只能写死 0.625 秒（=96bpm）。
   引擎需要「节拍从哪条轨来」和「最终音轨是哪条」分开。

## 3. 这次的绕行方案（可复制的做法）

全部放在 `tasks/beast/tools/`，**没有改 `src/`**：

```
narration.mjs   旁白脚本：每个镜头一组 { cue（镜头内部时刻）, text }；音色、语速、尾部留白也在这里
say.mjs         edge-tts 逐句合成 → ffprobe 量真实时长 → 解出每段的 stretch 与 slot → 写 timing.json/.mjs
bed.mjs         音乐床：96bpm 纯合成，按小节分段编排（避免两分钟一条循环听腻）
mix.mjs         把每句旁白摆到绝对时刻 + 用旁白自己的包络做闪避 → audio/beast-vo.mp3（引擎只认这一条）
```

关键规则（`say.mjs` 里实现的；**这套逻辑现在已经收进引擎**，见 §4 B 档。
`tasks/beast/tools/` 那份仍在原位 —— 它也是 `anim say` 认的历史位置）：

```
need     = max_i(cue_i + dur_i) + TAIL                 # 这一段的旁白最早能结束在哪
stretch  = clamp(need / internal, 1, MAX_STRETCH)       # 画面放慢到「念到哪、画面走到哪」
slot     = ceil(max(internal*stretch, max_i(cue_i*stretch + dur_i)) + TAIL 到整拍)
```

场景侧只有一行改动：`const t = f.lt / (ctx.params?.stretch ?? 1)` —— 于是**整段画面的节奏
都是旁白算出来的**，改旁白就改节奏。段长/起点/旁白时刻全部来自 `audio/timing.mjs`，
`task.config.mjs` 只负责把它们摆到时间线上。

叠句检查是必须的：相邻两句不许叠，判据 `本句时长 ≤ (下一句 cue − 本句 cue) × MAX_STRETCH − 0.3`。
第一版 10 处叠句就是这么查出来的（把话缩短、或把 cue 往后挪）。

产物：`tasks/beast/FACTS.md`（文案出处）+ `tasks/beast/SCRIPT.md`（屏幕上每一句 + 旁白），
成片 `out/beast/beast.mp4`（127.5s / 12 段 / 每段 8.75–13.1s）。

## 4. 引擎补了什么（按投入产出排序）

> 三档**都已落地**。每条下面写的是"现在是什么命令 / 文件 / 约定"。

### A 档 · 数据模型（不改渲染）—— ✅ 已落地
- `task.audio` 可以写成 `{ music, vo, mix }`：`music` 只用来 `analyze`（节拍），
  `vo` 是口播，`mix` 是交给 ffmpeg 的最终轨。**这一条一次解决了第 2、3 个后果。**
- `task.narration: './narration.json'`（句子级：文本、绝对起点、时长）→ 场景里能拿到
  `ctx.narration.at(t)` / `ctx.narration.current(t)`（另有 `line(id)` / `durOf(id)` /
  `progress` / `typed` / `until` / `in`），字幕与「说到哪亮哪」就不用自己在外面算。
  实现在 `src/core/narration.js`。
- `dur: { vo: 'line-id' }`：`cut()` 直接按某句旁白的时长定时长，省掉外部倒推（`src/timeline.js`）。

### B 档 · TTS 入口与闪避 —— ✅ 已落地
- 新命令
  `node scripts/anim.mjs say <任务> [--voice X] [--rate X] [--script 文件] [--bpm N] [--tail 1.2] [--max-stretch 1.9] [--force] [--dry-run] [--tts "<命令>"] [--no-vo]`
  与 `node scripts/anim.mjs mix <任务> [--music 文件] [--out 文件] [--vo-only] [--bitrate 192k]`。
  实现分别在 `scripts/lib/say.mjs`、`scripts/lib/mix.mjs`（CLI 侧、不进浏览器）。
  > ⚠ **段间交叠（转场）在命令行上没有开关**：`--overlap` 读的是脚本里的 `OVERLAP`，
  > CLI 并不转发它（写了也不生效）。要改就在 `narration.mjs` 里
  > `export const OVERLAP = 0.6;`（默认 `'beat'` = 一拍），**改完重跑 `say`** ——
  > `say` 结尾打印的那段 `cut(..., { overlap })` 就是按它算出来的。
  > `--vo-only` 是 `mix` 的：只重出旁白轨、不碰音乐（改完旁白想单独听一遍时用它）。
- 旁白脚本的约定位置：`tasks/<任务>/narration.mjs`（**推荐**），找不到时回退到历史位置
  `tasks/<任务>/tools/narration.mjs`（`tasks/beast` 就在这里，所以它不用搬家）。
  导出 `VOICE` / `RATE` / `TAIL` / `MAX_STRETCH` / `BPM`（或 `BEAT`）/ `OVERLAP`（默认 `'beat'`）/
  `DUCK`（可选）/ `TTS`（可选）/ `SCENES`。
  `SCENES` 每项 `{ id, internal, lines: [{ cue, text }] }`，`cue` 与 `internal` 都是**镜头内部时间**。
- 算法（与 `tasks/beast/tools/say.mjs` 那版一致，那版被验证过）：
  `need = max(cue_i + dur_i) + TAIL`；`stretch = clamp(need / internal, 1, MAX_STRETCH)`；
  `slot = 把 max(internal*stretch, max(cue_i*stretch + dur_i)) + TAIL 向上取整到整拍`；
  段起点按 `slot − OVERLAP` 累加。场景里只写一行 `const t = f.lt / (ctx.params?.stretch ?? 1)`。
- **节拍源不再写死**（beast 那版写死了 96）：一拍从哪来，优先级是
  `--bpm` > `narration.mjs` 的 `BPM`/`BEAT` > `task.audio` 里那条 **music 轨**的分析文件
  (`audio/<音轨名去掉扩展名>.analysis.json`，即 `analyze` 的产物）> 兜底 0.6s **并明确警告**。
  ⚠ 找不到时**不会**随便扫一个 `*.analysis.json` 就用：beast 的 `audio/` 里那份
  `beast-vo.analysis.json`（从**人声**测出的 136bpm）正是 P1-4 要躲开的污染数据。
  只有在"没有声明 music 轨"时才允许扫描兜底，而且会点名警告（第四轮试算时真抓到过这一次）。
- **每句的时长是"说到哪算到哪"，不是文件时长**：`edge-tts` 每条音频尾巴上挂着约 **0.9s 静音**
  （实测 1.872s 的文件里 0.934–1.872 全静音），直接用 ffprobe 的文件时长会把静音算进句子长度
  （beast 那张表就这样：`affix-1` 记 4.68s，实际说到 3.88s；27 句共 21.6s）。
  `scripts/lib/media.mjs` 的 `probeSpeechEnd()` 用 `silencedetect` 取末尾那段静音的起点 +0.12s 当收尾，
  并把裁掉的量打印出来。
- 产物（`anim say` 写）：`audio/vo/<段>-<n>.mp3`（逐句，带 sha1 缓存：文本+音色+语速+驱动不变就跳过）、
  `audio/timing.json` + `audio/timing.mjs`（每段 `start/slot/stretch/internal` 与每句 `offset`，
  字段与 beast 那版兼容）、`audio/narration.json`（**整片时间**的句子表，含可选的 `words`）、
  `audio/<任务>-vo.mp3`（只有旁白的一条轨）。
  `anim say` 还会打印一张时长表、叠句警告、`MAX_STRETCH` 顶到上限的警告、说话占比，
  以及可以直接粘进 `task.config.mjs` 的 `cut(...)` 片段。
- **一句失败不让整批白跑**（`docs/BACKLOG.md` 1-6）。逐句合成的偶发失败（edge-tts 的服务端抖动、
  或"退出码 0 却写出 0 字节"）现在是**失败也继续**：
  ① 第 1 遍逐句合成，失败的句子先记进待补跑清单，**其余照常合成完**；
  ② 整批跑完之后**只补跑清单里那几句**（默认隔 2s、最多 2 轮；缓存会把已成功的一句不落地跳过）；
  ③ 收尾仍有失败 ⇒ **逐句点名**（段名 + 第几句 + 原句 + 原因）、**不写** `timing.{json,mjs}` 与
  `narration.json`、命令以 **1** 退出。已经合成好的句子留在缓存里，把问题处理掉直接重跑同一条命令
  即可（成功的那几句不会再合成一遍）。
  ⚠ **失败的句子绝不许按 `dur = 0` 混进时长表** —— 那会让 `solveTiming()` 把 slot 静默算错、
  画面与旁白错位。守门在 `say.mjs` 的 `buildLineResult()`：`dur <= 0` / 非有限值一律当失败返回。
  一条句子在批量那一遍总共最多试 `MAX_TRIES_PER_LINE`（5）次；这个数字与报告里印的是**同一个出处**。
- `anim mix` 做三件事：按 `timing.json` 把每句摆到绝对时刻、用旁白**自己的包络**做闪避
  （默认说话时音乐剩 22% ≈ −13 dB，起音快释放慢）、归一化后输出 `audio/<任务>-mix.mp3`
  （外加一份 wav 备查）；打印说话占比、闪避深度、以及该写进 `task.config.mjs` 的那行
  `audio: { music, vo, mix }`。闪避参数集中在 `DEFAULT_DUCK`（在 `narration.mjs` 里导出 `DUCK` 可以覆盖）。
- TTS 驱动的约定（`scripts/lib/say.mjs` 的 `resolveTts()`）：
  `<驱动> --voice V --rate R --text 文本 --write-media 输出.mp3 [--write-words 输出.words.json]`。
  优先级 `--tts` > `narration.mjs` 的 `TTS` > 环境变量 `ANIM_TTS` > 仓库自带的 `tools/tts-edge.py`
  > PATH 上的 `edge-tts`。
- **一个实测事实**：`edge-tts` 7.x 命令行的 `--write-subtitles` 给的是**整句**（默认 `SentenceBoundary`），
  **拿不到词级时间戳**；所以仓库自带 `tools/tts-edge.py`（薄薄包一层 `edge_tts` 库，
  用 `boundary="WordBoundary"`），它才会写 `--write-words` 那个 JSON（`[{w,start,end}]`，秒）。
  驱动不支持时 `anim say` 会**自动退化**成"按字数加权近似切分"，并且**在输出里逐步标出来**
  （`timing.json` 里那些词的 `approx: true`）—— 不许静默。
- 离线回归：`node tools/test-say.mjs`（用 `tools/stub-tts.mjs` 这个假驱动，时长可算 →
  不需要联网、不需要 GPU；夹具任务建在**系统临时目录** `%TEMP%/anim-saytest`，
  所以它跟正在跑的渲染互不干扰）。**批量容错也在这一份里验**：靠 `stub-tts.mjs` 的
  `--fail "<子串>" [--fail-cmd always|zeroremaining] [--fail-n N]` 注入失败
  （`zeroremaining` = 退出码 0 却写 0 字节；`--fail-n N` = 前 N 次调用失败、之后成功）。
  真 TTS 通电：`node tools/probe-tts-edge.mjs`（要联网）。
- ⚠ **"换音色不用重渲画面"要说准**：与音色解耦的是**代码结构**（`slot`/`stretch` 落在 `timing.mjs` 里，
  场景代码一个字都不用改）；但如果新音色把某句念长了/短了，`slot` 就会变 → 段长变 → **片子要重出**。
  这不是 bug，是"镜头长度由旁白决定"的直接后果。

### C 档 · 音画同源：词级时间戳 → karaoke —— ✅ 已落地
- `anim say` 会把驱动给的词级时间戳写进 `narration.json` 的 `lines[].words`
  （**整片绝对时间**，秒），即"句子表"和"歌词表"合成**一张表**：
  `docs/COOKBOOK.md` §4.2 里那个 `lyrics.json` 例子，等价于 `task.narration` 指向的表里的
  `lines[].words`；`task.narration` 也接受只给 `lines[].words` 而不给 `start`/`dur` 的表
  （缺的起点/时长由词级时间戳推）。
- 场景里这样用（时间用整片时间 `f.t`，与 `words` 的时钟一致）：

  ```js
  const l = ctx.narration.at(f.t);          // 或 ctx.narration.line('<段>-1')
  if (l?.words) type.karaoke(l.text, l.words, x, y, f.t, { size: 84, base: css(P.ash), sung: css(P.signal) });
  ```

- `src/core/text.js` 的 `type.karaoke` 修了一个**从来没被用出来过的 bug**：它把 `words[].start/end`
  同时当成"字符下标"和"秒"用了，于是按文档的用法（秒）画出来时**每个词都叠在行首**、
  sweep 的裁剪宽度是 0。现在字符区间由 `w` 顺序累加推出、`start/end` 只当秒用；
  `words` 拼起来不等于 `text` 时会 `console.warn` **一次**（不抛异常）。
  回归在 `tools/test-karaoke.mjs`（纯 JS，不需要 GPU）。
- P1-4 的另一半（节拍被人声带偏）也修掉了：`task.audio` 分轨之后节拍从 `music` 轨测
  （证据见 `history/STATUS-rounds-1-6.md` §11.10），`anim say` 取一拍也不再写死 BPM（优先级见上面 B 档）。

## 5. 验收标准（这次用的，现在各由什么自动检查）

1. **不许有叠句警告** —— ✅ 自动：`anim say` 每次都会把 `solveTiming` 算出的叠句警告打出来
   （`⚠ [段名] 叠句：…`）；`node tools/test-say.mjs` 里也有一条判据专门验它**必须报**
   （夹具里故意写了一句会叠的）。
2. **每个镜头的最后一句旁白说完之后**至少还有 `TAIL`（≥1.0s）画面是静的 —— ✅ 自动：
   `solveTiming` 就是用它算 `slot` 的（保证留白 ≥ `TAIL`），并把每段的起点/时长/放慢系数
   打印成表；`node tools/test-say.mjs` 再逐段核一遍 `≥ TAIL`。
3. **说话占比打印出来** —— ✅ 自动：`anim say` 与 `anim mix` 都打印
   （形如 `说话 98.4s / 127.5s = 77%`）；`anim say` 在超过 80% 时会多打一句警告。
   高于 ~80% 就该考虑加留白或砍内容。
4. **换音色之后要重跑到什么程度** —— ⚠ 这条原来的判据（"画面文件的哈希不变，证明时长表与音色解耦"）
   **是错的**，现在说准：与音色解耦的是**代码结构**（`slot`/`stretch` 落在 `timing.mjs` 里，
   场景代码一个字都不用改）；但新音色把某句念长了/短了 → `slot` 就变 → 段长变 → **片子要重出**。
   这不是 bug，是"镜头长度由旁白决定"的直接后果。**没有**自动检查。
5. **成片验收** —— 帧数 = `时长 × fps`：✅ 自动，CLI 出片收尾会自己用 ffprobe 复核
   （分块模式逐块复核；不符就报错并删掉废文件）。同参数重渲一遍**逐比特相同**：
   **没有**自动检查（实测结论记在 `history/STATUS-rounds-1-6.md` §11.6）。
