// @ts-check
/**
 * `anim say` —— 把 TTS 接进引擎（`docs/NARRATION.md` B 档）。
 *
 * ## 它解决什么
 *
 * 做 `tasks/beast` 时"旁白决定镜头多长"这件事是在引擎外面手搓的
 * （`tasks/beast/tools/say.mjs`，127 行，每支带旁白的片子都要重写一遍，而且
 * 里面的 `BPM = 96` 是写死的 —— 这正是 `IMPROVEMENTS-2.md` P1-4
 * "节拍被人声带偏"那个坑的另一半）。这里把那套逻辑收进引擎，并修掉写死 BPM 的问题。
 *
 * ## 数据流
 *
 * ```
 * tasks/<任务>/narration.mjs          旁白脚本（唯一的时间源）：谁在第几秒说什么
 *        │  anim say
 *        ├──▶ audio/vo/<段>-<n>.mp3      逐句合成（带 sha1 缓存：文本+音色+语速+驱动没变就跳过）
 *        ├──▶ audio/vo/<段>-<n>.words.json  词级时间戳（驱动支持时；C 档用）
 *        ├──▶ audio/timing.json / .mjs   每段的起点/时长/放慢系数 —— task.config.mjs import 它
 *        ├──▶ audio/narration.json       句子表（**整片时间**）—— task.config.mjs 的 narration 指它
 *        └──▶ audio/<任务>-vo.mp3        只有旁白的一条轨（没有音乐也能先听）
 * ```
 *
 * ## 关键规则（照抄 beast 那版，它被验证过）
 *
 * ```
 * need    = max_i(cue_i + dur_i) + TAIL            # 这一段旁白最早能说完在哪
 * stretch = clamp(need / internal, 1, MAX_STRETCH) # 画面放慢到"念到哪、画面走到哪"
 * slot    = ceil(max(internal*stretch, max_i(cue_i*stretch + dur_i)) + TAIL 到整拍)
 * ```
 *
 * 场景侧只有一行：`const t = f.lt / (ctx.params?.stretch ?? 1)`。
 * **旁白的长度决定镜头的长度**，改旁白就改节奏，场景代码一个字都不用动。
 *
 * ## 与音色解耦（`docs/NARRATION.md` §5.4）
 *
 * 时长表只取决于"每句念了多久"，与音色无关的是**代码结构**：换音色重跑 `say` + `mix`
 * 即可，场景代码不用改。⚠ 但如果新音色把某句念长了，`slot` 会变 → 段长变 → 要重出片。
 * 这不是 bug，是"镜头长度由旁白决定"的直接后果（beast 那版文档里说得含糊，这里说清）。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCmdline, probeDuration, probeSpeechEnd, readTaskAudioSpec, run, tryRun, taskRel } from './media.mjs';
import { renderVo } from './mix.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 找一个能 `import edge_tts` 的 python（找不到就返回 null，让调用方走别的路）。
 *
 * 顺序：`ANIM_PYTHON` 环境变量 → PATH 上的 `python` / `python3` → python.org 在 Windows 上的
 * 默认安装位置（`py` 启动器与 `%LOCALAPPDATA%\Programs\Python\*`）→ 最后才报"没找到"。
 *
 * ⚠ 这里**不要**写任何绝对的个人路径：这个文件是随引擎发布的。
 *   （曾经有一版把某个 virtualenv 的绝对路径写死在这里，等于把作者的用户名一起发布了。）
 *   需要指定解释器就设 `ANIM_PYTHON`，文档见 `README.md` 的前置条件一节。
 */
function resolvePython() {
  const cands = [process.env.ANIM_PYTHON, 'python', 'python3', 'py'].filter(Boolean);
  // Windows：python.org 安装器的两种落点（用户级与全局），**按存在的实际版本列**，不写死版本号
  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Python'),
    ].filter(Boolean);
    for (const root of roots) {
      try {
        for (const d of readdirSync(root)) {
          const p = path.join(root, d, 'python.exe');
          if (existsSync(p)) cands.push(p);
        }
      } catch { /* 目录不存在就跳过 */ }
    }
  }
  for (const c of cands) {
    const r = tryRun([c, '-c', 'import edge_tts']);
    if (r.status === 0) return c;
  }
  return null;
}

/** `which`：用 `--version` 探一下（Windows 上 .exe/.cmd 都能被 spawnSync 找到）。 */
function which(cmd) {
  const r = tryRun([cmd, '--version']);
  return r.status === 0 ? cmd : null;
}

/** 找不到 BPM 时的兜底一拍（0.6s = 100bpm）——只在**没有任何节拍源**时用，而且会警告。 */
const FALLBACK_BEAT = 0.6;

/* --------------------------------------------------------------- 旁白脚本 */

/**
 * 载入任务的旁白脚本。
 *
 * 位置（按顺序找，第一个存在的就用）：
 *   1. `--script <文件>`
 *   2. `tasks/<任务>/narration.mjs`     ← 推荐（和 task.config.mjs 并排）
 *   3. `tasks/<任务>/tools/narration.mjs` ← 历史位置（tasks/beast 就在这里）
 *
 * @returns {{ path: string, voice: string, rate: string, tail: number, maxStretch: number,
 *             beat: number|null, overlap: number|'beat'|null, scenes: any[], duck?: any, tts?: string }}
 */
export async function loadNarrationScript(taskDir, scriptPath) {
  const candidates = scriptPath
    ? [taskRel(taskDir, scriptPath)]
    : [path.join(taskDir, 'narration.mjs'), path.join(taskDir, 'tools', 'narration.mjs')];
  const file = candidates.find((f) => existsSync(f));
  if (!file) {
    throw new Error(
      `找不到旁白脚本。看了这些位置：\n  ${candidates.map((c) => path.relative(process.cwd(), c)).join('\n  ')}\n`
      + `写一个 tasks/<任务>/narration.mjs，导出 SCENES（见 docs/NARRATION.md B 档）。`,
    );
  }
  // 加了查询串是为了绕开 Node 的 ESM 缓存（同一个进程里改完脚本再跑要读到新的）
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  const scenes = mod.SCENES ?? mod.default?.SCENES ?? mod.default;
  if (!Array.isArray(scenes) || !scenes.length) {
    throw new Error(`${path.relative(process.cwd(), file)} 里没有 SCENES 数组（或它为空）。`);
  }
  for (const [i, sc] of scenes.entries()) {
    if (!sc?.id) throw new Error(`SCENES[${i}] 没有 id —— 段名会出现在日志和 timing.mjs 里，必须有。`);
    if (!Array.isArray(sc.lines) || !sc.lines.length) throw new Error(`SCENES[${i}]（${sc.id}）没有 lines。`);
    if (!(Number(sc.internal) > 0)) throw new Error(`SCENES[${i}]（${sc.id}）的 internal 必须是正数（画面最后一次揭晓的内部时刻）。`);
    for (const [j, l] of sc.lines.entries()) {
      if (!l?.text) throw new Error(`SCENES[${i}]（${sc.id}）第 ${j + 1} 句没有 text。`);
      if (!(Number(l.cue) >= 0)) throw new Error(`SCENES[${i}]（${sc.id}）第 ${j + 1} 句没有 cue（内部时间点）。`);
    }
  }
  return {
    path: file,
    voice: mod.VOICE ?? 'zh-CN-XiaoxiaoNeural',
    rate: mod.RATE ?? '+0%',
    tail: Number(mod.TAIL ?? 1.0),
    maxStretch: Number(mod.MAX_STRETCH ?? 1.9),
    beat: mod.BPM ? 60 / Number(mod.BPM) : (mod.BEAT ? Number(mod.BEAT) : null),
    overlap: mod.OVERLAP ?? 'beat',
    duck: mod.DUCK,
    tts: mod.TTS,
    scenes,
  };
}

/* --------------------------------------------------------------- 节拍源 */

/**
 * 一拍多少秒。**不许再从混音里瞎猜**（P1-4 的坑：混音里人声把 bpm 从 96 带到 136）。
 *
 * 优先级：命令行 `--bpm` > 旁白脚本的 `BPM`/`BEAT` > **task.audio 里那条 music 轨的
 * `audio/<名字>.analysis.json`**（`analyze` 的产物）> 兜底 + 警告。
 *
 * ⚠ 两个实测踩过的坑（做 beast 的 dry-run 时抓到的）：
 *   1. 分析文件名是 `audio/<去掉扩展名的音轨名>.analysis.json`（`beast.mp3` → `beast.analysis.json`），
 *      不是 `beast.mp3.analysis.json`；
 *   2. **不能**在找不到时随便扫一个 `*.analysis.json` 就用 —— 目录里还有
 *      `beast-vo.analysis.json`（从**人声**测出来的 136bpm），正好就是要躲开的那份污染数据。
 *      现在只在"没有声明 music 轨"时才允许扫描，而且会点名警告。
 */
export function resolveBeat({ taskDir, script, bpm, audioSpec }) {
  if (Number(bpm) > 0) return { beat: 60 / Number(bpm), from: `--bpm ${bpm}` };
  if (script.beat > 0) return { beat: script.beat, from: 'narration.mjs 的 BPM/BEAT' };

  const stripExt = (f) => String(f).replace(/\.[^./\\]+$/, '');
  const analysisOf = (rel) => (rel ? path.join(taskDir, 'audio', `${path.basename(stripExt(rel))}.analysis.json`) : null);
  const readBpm = (file) => {
    if (!file || !existsSync(file)) return null;
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      return Number(j.bpm) > 0 ? Number(j.bpm) : null;
    } catch { return null; }
  };
  const noBeat = (warning) => ({ beat: FALLBACK_BEAT, from: null, warning });

  const spec = audioSpec && typeof audioSpec === 'object' ? audioSpec : null;
  const single = typeof audioSpec === 'string' ? audioSpec : null;

  // ① 声明了 music 轨：只认它（没有就说清楚，别去拿 vo 的分析凑数）
  if (spec?.music) {
    const f = analysisOf(spec.music);
    const b = readBpm(f);
    if (b) return { beat: 60 / b, from: `${path.basename(f)} 的 bpm=${b}` };
    return noBeat(
      `task.audio 里声明了 music 轨（${path.basename(spec.music)}），但没有 ${path.relative(process.cwd(), f)}`
      + ` —— 先跑 node scripts/anim.mjs analyze <任务>；现在按 ${FALLBACK_BEAT}s 一拍兜底。`,
    );
  }

  // ② 只有一条轨（老写法）或只有 mix/vo：用它自己的分析；没有就扫，但**排除 vo**
  const declared = single ?? spec?.mix ?? spec?.vo ?? null;
  const direct = readBpm(analysisOf(declared));
  if (direct) {
    return {
      beat: 60 / direct,
      from: `${path.basename(analysisOf(declared))} 的 bpm=${direct}`,
      ...(spec?.vo && !spec?.music
        ? { warning: `⚠ 没有单独的 music 轨，节拍是从旁白/混音里测的，**会被人声带偏**（P1-4）。` }
        : {}),
    };
  }
  try {
    const dir = path.join(taskDir, 'audio');
    if (existsSync(dir)) {
      const others = readdirSync(dir).filter((f) => f.endsWith('.analysis.json') && !/-vo\.analysis\.json$/.test(f));
      for (const f of others) {
        const b = readBpm(path.join(dir, f));
        if (b) {
          return {
            beat: 60 / b,
            from: `${f} 的 bpm=${b}`,
            warning: `节拍是从 ${f} 里读的（扫出来的，不是 task.audio 指定的那条轨）—— 确认一下这是不是配乐。`,
          };
        }
      }
    }
  } catch { /* 扫不到就走兜底 */ }
  return noBeat(
    `没有任何节拍源（narration.mjs 没写 BPM，audio/ 下也没有可用的 *.analysis.json）——`
    + `按 ${FALLBACK_BEAT}s 一拍（100bpm）兜底，slot 的取整拍与段间重叠可能对不上音乐。`
    + `先跑 node scripts/anim.mjs analyze <任务> 再跑本命令。`,
  );
}

/* --------------------------------------------------------------- TTS 驱动 */

/**
 * 找一个能用的 TTS 驱动。驱动是一条约定的命令行：
 *
 * ```
 * <驱动> --voice V --rate R --text 文本 --write-media 输出.mp3 [--write-words 输出.words.json]
 * ```
 *
 * * `--write-media` 必须支持（这是唯一必需的）；
 * * `--write-words` 可选：写一个 `[{w,start,end}]`（秒，相对这句音频的开头）的 JSON。
 *   不支持就**退回按字数等分**，并明确说一句（别让人以为拿到的是真时间戳）。
 *
 * 优先级：`--tts` > narration.mjs 的 `TTS` > `ANIM_TTS` > `tools/tts-edge.py`（本机 python）> PATH 上的 `edge-tts`。
 * `tools/tts-edge.py` 是仓库自带的那条路（比 `edge-tts.exe` 多一样东西：**词级时间戳**）。
 */
export function resolveTts({ explicit, script }) {
  const cmdline = explicit || script?.tts || process.env.ANIM_TTS;
  if (cmdline) return { argv: parseCmdline(cmdline), words: true, from: '显式指定（--tts / ANIM_TTS / narration.mjs 的 TTS）' };

  const pyDriver = path.join(HERE, '..', '..', 'tools', 'tts-edge.py');
  const py = resolvePython();
  if (py && existsSync(pyDriver)) {
    return { argv: [py, pyDriver], words: true, from: `仓库自带驱动（${path.basename(py)} tools/tts-edge.py）` };
  }
  const edge = which('edge-tts');
  if (edge) {
    return {
      argv: [edge],
      words: true,
      from: 'PATH 上的 edge-tts',
      warning: 'edge-tts 自己只会写**整句**字幕（7.x 默认 SentenceBoundary）——'
        + ' 给它 --write-words 会失败，本命令会自动退化成"按字数近似"，并且每一步都会标出来。'
        + ' 要真的词级时间戳就用 tools/tts-edge.py（走 edge_tts 的 WordBoundary）。',
    };
  }
  throw new Error(
    '找不到 TTS 驱动。三条路：\n'
    + '  · pip install edge-tts 之后用 tools/tts-edge.py（推荐，支持词级时间戳）；\n'
    + '  · 设 ANIM_TTS="<命令>" 指一个自己的驱动；\n'
    + '  · 在 narration.mjs 里导出 TTS = "<命令>"。',
  );
}

/* --------------------------------------------------------------- 词级时间戳 */

/**
 * 把一句话的时长按字符**近似**切成词级时间戳（拿不到真时间戳时的退路）。
 *
 * 权重：汉字/字母数字 1、标点 0.45、空白 0.2 —— 比"等分"像样一点，而且完全确定。
 * ⚠ 这是近似，调用方必须把它标出来（`approx: true`），别让下游以为是 TTS 给的。
 */
export function splitWordsApprox(text, dur, at = 0) {
  const chars = Array.from(String(text));
  const weight = (ch) => (/[\s]/.test(ch) ? 0.2 : /[\p{P}\p{S}]/u.test(ch) ? 0.45 : 1);
  const total = chars.reduce((s, ch) => s + weight(ch), 0) || 1;
  let t = at;
  const out = [];
  for (const ch of chars) {
    const d = (weight(ch) / total) * dur;
    out.push({ w: ch, start: round3(t), end: round3(t + d), approx: true });
    t += d;
  }
  return out;
}

/**
 * 把驱动给的词级时间戳**对齐**到原文上。
 *
 * 为什么需要它（实测）：`edge-tts` 的 `WordBoundary` **不报标点** ——
 * 文本 `先看一句话。` 返回的是 `先 / 看 / 一句话`（少了那个句号），
 * 于是"拼起来必须等于 text"这条严格判据会把**本来可用的真时间戳**判成不可用、
 * 悄悄退化成"按字数近似"（探针就是这么抓到的：真跑一遍，报 0 句真词级时间戳）。
 *
 * 做法：按顺序在原文里找每个词；中间**跳过的字符（标点/空白）并进前一个词的尾巴**，
 * 开头跳过的并进第一个词。这样 `out[].w` 拼起来仍然等于 `text`（karaoke 的位置前提），
 * 而时间是驱动给的真值。
 *
 * @param {string} text
 * @param {{w:string,start:number,end:number}[]} words
 * @returns {{ ok: boolean, words?: any[], absorbed?: number, why?: string }}
 */
export function alignWords(text, words) {
  const t = String(text);
  /** @type {{w:string,start:number,end:number}[]} */
  const out = [];
  let i = 0;
  let absorbed = 0;
  for (const w of words ?? []) {
    const needle = String(w?.w ?? '');
    if (!needle) continue;
    const idx = t.indexOf(needle, i);
    if (idx < 0) return { ok: false, why: `在原文里找不到词 "${needle}"（从第 ${i} 个字符往后）` };
    if (idx > i) {
      absorbed += idx - i;
      const skipped = t.slice(i, idx);
      if (out.length) out[out.length - 1].w += skipped;
      else out.push({ w: skipped, start: Number(w.start), end: Number(w.start) });
    }
    out.push({ w: needle, start: Number(w.start), end: Number(w.end) });
    i = idx + needle.length;
  }
  if (i < t.length) {
    absorbed += t.length - i;
    if (out.length) out[out.length - 1].w += t.slice(i);
    else out.push({ w: t.slice(i), start: 0, end: 0 });
  }
  const joined = out.map((x) => x.w).join('');
  return joined === t ? { ok: true, words: out, absorbed } : { ok: false, why: '对齐之后仍然拼不回原文' };
}

/**
 * 校验词级时间戳的**时间部分**（顺序、数值、是否落在音频里）。
 * 拼接是否等于原文**不由这里管** —— 那是 `alignWords()` 的事。
 */
export function validateWords(words, dur) {
  if (!Array.isArray(words) || !words.length) return { ok: false, why: '驱动没写出词级时间戳' };
  let prev = -1;
  const out = [];
  for (const w of words) {
    const s = Number(w?.start);
    const e = Number(w?.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return { ok: false, why: `时间戳不合法：${JSON.stringify(w)}` };
    if (s < prev - 0.05) return { ok: false, why: '时间戳不是按顺序递增的' };
    prev = s;
    out.push({ w: String(w.w ?? ''), start: round3(Math.min(s, dur)), end: round3(Math.min(e, dur)) });
  }
  return { ok: true, words: out };
}

/* --------------------------------------------------------------- 合成 */

const round3 = (x) => Math.round(x * 1000) / 1000;

/** 同步睡一会儿（Node 没有同步 sleep；重试之间的退避要用它）。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 合成一句（文本 + 音色 + 语速 + 驱动都没变就跳过 —— 改一句只重合成那一句）。
 * @returns {{ dur: number, words: any[]|null, approx: boolean, cached: boolean, note?: string }}
 */
export function synthLine(driver, { file, text, voice, rate, force = false }) {
  const stamp = `${file}.sha1`;
  const want = createHash('sha1').update(`${voice}|${rate}|${text}|${driver.argv.join(' ')}`).digest('hex').slice(0, 16);
  const wordsFile = `${file}.words.json`;
  const cachedOk = !force && existsSync(file) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === want;
  /** 这一句遇到的所有"但书"（词级时间戳拿不到、驱动降级…），最后一起报出去 */
  const notes = [];

  if (!cachedOk) {
    mkdirSync(path.dirname(file), { recursive: true });
    const base = [...driver.argv, '--voice', voice, `--rate=${rate}`, '--text', text];
    // ⚠ 先把上一次的词级时间戳删掉：换了音色/语速/驱动（或者这次驱动干脆不写）之后，
    //   上一轮的 `.words.json` 还在原地 —— 直接读它就会把**旧句子的时间戳**当成新的用，
    //   而且看起来完全正常（这是测试抓到的：stub 加 `--no-words` 之后仍然读到了旧的词表）。
    try { rmSync(wordsFile, { force: true }); } catch { /* 删不掉就靠下面 driver.words 的判断兜住 */ }

    /**
     * 合成一句，**偶发失败要重试**。
     *
     * 实测：edge-tts 会偶发 `NoAudioReceived: No audio was received`（联网服务端的抖动），
     * 第一版直接把这句当致命错误抛出，于是 27 句跑到第 23 句整个命令挂掉
     * —— 而"重新跑一次"就能过（缓存会把前面 22 句跳过）。这里自己重试两次。
     */
    const attempt = (withWords, tries) => {
      let out = null;
      for (let i = 0; i < tries; i++) {
        out = run(withWords
          ? [...base, '--write-words', wordsFile, '--write-media', file]
          : [...base, '--write-media', file]);
        if (out.status === 0 && existsSync(file)) return out;
        if (i + 1 < tries) sleepSync(600 * (i + 1));
      }
      return out;
    };

    let r;
    if (driver.words) {
      r = attempt(true, 3);
      if (r.status !== 0) {
        // 驱动不认 --write-words（比如直接拿 edge-tts.exe 当驱动的用户）：退一步，别整个命令挂掉。
        // ⚠ 只有**明确是"不认识的选项"**才永久降级 —— 网络抖动之类的偶发失败不该让后面每句都丢掉词级时间戳。
        const both = `${r.stderr ?? ''}${r.stdout ?? ''}`;
        const unknownOpt = /unrecognized|unknown option|no such option|invalid option|Usage:/i.test(both);
        r = attempt(false, 2);
        if (r.status === 0) {
          if (unknownOpt) driver.words = false;
          else notes.push('这一句的 --write-words 一直失败（不是"选项不认识"，当偶发处理），只拿到了音频');
        }
      }
    } else {
      r = attempt(false, 3);
    }
    if (r.status !== 0 || !existsSync(file)) {
      const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-5).join('\n');
      throw new Error(`TTS 合成失败（exit ${r.status}）：${text}\n${tail}`);
    }
    writeFileSync(stamp, want);
  }
  // "这句念了多久" = **说到哪算到哪**，不是文件时长：edge-tts 每条尾巴上挂着约 0.9s 静音，
  // 直接用文件时长会把 slot 撑大、叠句判据也跟着偏（beast 那版就踩了这个）。
  const durFile = probeDuration(file);
  const speech = probeSpeechEnd(file, durFile);

  let words = null;
  let approx = false;
  let note = null;
  // 只在"这次驱动确实支持写词表"时才读它 —— 不支持时留在磁盘上的旧文件不能算数
  if (driver.words && existsSync(wordsFile)) {
    let raw = null;
    try { raw = JSON.parse(readFileSync(wordsFile, 'utf8')); } catch (e) {
      note = `词级时间戳文件读不动（${e.message}）`;
    }
    if (raw) {
      const v = validateWords(raw, durFile);
      if (!v.ok) note = `词级时间戳不可用：${v.why}`;
      else if (v.words.map((w) => w.w).join('') === text) words = v.words;
      else {
        // 实测 edge-tts 不报标点 → 先对齐，别急着退化成近似（那会把真时间戳丢掉）
        const al = alignWords(text, v.words);
        if (al.ok) {
          words = al.words;
          note = `词级时间戳与原文有 ${al.absorbed} 个字符没对应（标点/空白），已按顺序对齐`;
        } else note = `词级时间戳不可用：${al.why}`;
      }
    }
  } else if (driver.words) {
    note = '驱动没有写出词级时间戳';
  }
  // 时长：说到的时刻 + 收尾余量；有词级时间戳时再保证至少覆盖到最后一个词
  let dur = Math.max(speech.speechEnd, ...(words ? [Math.max(...words.map((w) => w.end)) + 0.05] : [0]));
  dur = Math.min(dur, durFile);
  if (!words) {
    words = splitWordsApprox(text, dur, 0);
    approx = true;
    if (!note) note = '按字数近似切分（没有真时间戳）';
  }
  if (note) notes.push(note);
  return {
    dur: round3(dur),
    durFile: round3(durFile),
    trimmed: round3(speech.trimmed),
    words,
    approx,
    cached: cachedOk,
    note: notes.length ? notes.join('；') : null,
  };
}

/* --------------------------------------------------------------- 解时长 */

/**
 * 纯函数：把"每句念了多久"解成每段的 `start / slot / stretch` 与每句的绝对时刻。
 * 单独拿出来是因为**这是整套东西里唯一值得单测的部分**（不需要 TTS、不需要 GPU）。
 *
 * @param {{ scenes: any[], beat: number|null, overlap: number|'beat'|null, tail: number, maxStretch: number }} a
 * @returns {{ scenes: any[], total: number, warnings: string[] }}
 */
export function solveTiming({ scenes, beat, overlap, tail, maxStretch }) {
  const warnings = [];
  const bpmBeat = beat && beat > 0 ? beat : FALLBACK_BEAT;
  const ov = overlap === 'beat' || overlap == null
    ? bpmBeat
    : Number(overlap);
  const roundBeat = (x) => Math.ceil(x / bpmBeat - 1e-6) * bpmBeat;
  const out = [];
  let cursor = 0;
  for (const sc of scenes) {
    const lines = sc.lines.map((l, i) => ({ ...l, index: i }));
    const measured = lines.map((l) => ({ cue: Number(l.cue), text: l.text, dur: Number(l.dur), words: l.words ?? null, file: l.file }));
    if (measured.some((l) => !(l.dur > 0))) {
      throw new Error(`[${sc.id}] 有句子的时长量出来是 ${measured.find((l) => !(l.dur > 0))?.dur} —— TTS 没出声？`);
    }
    const need = Math.max(...measured.map((l) => l.cue + l.dur)) + tail;
    const wantStretch = need / Number(sc.internal);
    const stretch = Math.min(maxStretch, Math.max(1, wantStretch));
    if (wantStretch > maxStretch + 1e-6) {
      warnings.push(
        `[${sc.id}] 旁白需要把画面放慢 ${wantStretch.toFixed(2)}× 才念得完，但 MAX_STRETCH=${maxStretch}`
        + ` —— 这一段会出现"话说完了、画面还没走完"（或者反过来）。要么把话缩短，要么把 internal 调大。`,
      );
    }
    const finish = Math.max(
      Number(sc.internal) * stretch,
      ...measured.map((l) => l.cue * stretch + l.dur),
    ) + tail;
    const slot = roundBeat(finish);
    if (slot > finish + bpmBeat) {
      warnings.push(`[${sc.id}] slot ${slot.toFixed(2)}s 比需要 ${finish.toFixed(2)}s 多出超过一整拍 —— 检查 beat 对不对。`);
    }
    for (let i = 1; i < measured.length; i++) {
      const prevEnd = measured[i - 1].cue * stretch + measured[i - 1].dur;
      const startI = measured[i].cue * stretch;
      if (startI < prevEnd - 1e-6) {
        warnings.push(
          `[${sc.id}] 叠句：第 ${i + 1} 句比上一句说完早 ${(prevEnd - startI).toFixed(2)}s 开始`
          + `（判据见 docs/NARRATION.md §3）—— 把 cue 往后挪，或者把话缩短。`,
        );
      }
    }
    const placed = measured.map((l) => {
      const offset = round3(l.cue * stretch);
      return {
        ...l,
        offset,
        start: round3(cursor + offset),
        // 词级时间戳是**句内相对秒**，进整片时间要加上这句的起点
        words: l.words ? l.words.map((w) => ({ ...w, start: round3(cursor + offset + w.start), end: round3(cursor + offset + w.end) })) : null,
      };
    });
    out.push({
      id: sc.id,
      start: round3(cursor),
      slot: round3(slot),
      stretch: Math.round(stretch * 1000) / 1000,
      internal: Number(sc.internal),
      lines: placed,
    });
    cursor += slot - ov;
  }
  const total = round3(cursor + ov);
  return { scenes: out, total, overlap: round3(ov), beat: bpmBeat, warnings };
}

/* --------------------------------------------------------------- 主流程 */

/**
 * `anim say` 的实现。
 * @param {string} task
 * @param {{ taskDir: string, script?: string, voice?: string, rate?: string, bpm?: number,
 *           force?: boolean, dryRun?: boolean, tts?: string, tail?: number, maxStretch?: number,
 *           overlap?: number|'beat', noVo?: boolean, log?: (...a:any[])=>void }} opts
 */
export async function runSay(task, opts) {
  const log = opts.log ?? console.log;
  const taskDir = opts.taskDir;
  const script = await loadNarrationScript(taskDir, opts.script);
  const voice = opts.voice ?? script.voice;
  const rate = opts.rate ?? script.rate;
  const tail = opts.tail ?? script.tail;
  const maxStretch = opts.maxStretch ?? script.maxStretch;
  const spec = readTaskAudioSpec(taskDir);
  const { beat, from, warning } = resolveBeat({ taskDir, script, bpm: opts.bpm, audioSpec: spec });
  if (warning) log(`⚠ ${warning}`);
  log(`旁白脚本 ${path.relative(process.cwd(), script.path)}`);
  log(`音色 ${voice}  语速 ${rate}  一拍 ${beat.toFixed(3)}s（${(60 / beat).toFixed(1)}bpm，来自 ${from ?? '兜底'}）`
    + `  留白 TAIL ${tail}s  最大放慢 ${maxStretch}×`);

  const driver = resolveTts({ explicit: opts.tts, script });
  if (driver.warning) log(`⚠ ${driver.warning}`);
  log(`TTS 驱动 ${driver.argv.join(' ')}（${driver.from}${driver.words ? '，支持词级时间戳' : ''}）`);

  // 1) 逐句合成（带缓存）
  const voDir = path.join(taskDir, 'audio', 'vo');
  const scenes = [];
  let synthCount = 0;
  let wordsReal = 0;
  let wordsApprox = 0;
  let trimmedTotal = 0;
  /** 对齐提示会刷屏（每句都有标点差异），按"一句话一条 + 合计"折叠起来 */
  const alignHits = [];
  const otherNotes = [];
  for (const sc of script.scenes) {
    const lines = [];
    for (const [i, l] of sc.lines.entries()) {
      const file = path.join(voDir, `${sc.id}-${i + 1}.mp3`);
      const r = synthLine(driver, { file, text: l.text, voice, rate, force: opts.force });
      if (!r.cached) synthCount++;
      if (r.approx) wordsApprox++; else wordsReal++;
      trimmedTotal += r.trimmed ?? 0;
      if (r.note) {
        if (/按顺序对齐/.test(r.note)) alignHits.push(r.note.match(/(\d+) 个字符/)?.[1] ?? '?');
        else otherNotes.push(`${sc.id} 第 ${i + 1} 句：${r.note}`);
      }
      lines.push({
        cue: Number(l.cue),
        text: l.text,
        file: path.relative(taskDir, file).replace(/\\/g, '/'),
        dur: round3(r.dur),
        durFile: round3(r.durFile ?? r.dur),
        words: r.words,
        wordsApprox: r.approx,
      });
    }
    scenes.push({ id: sc.id, internal: Number(sc.internal), lines });
  }
  for (const n of otherNotes) log(`  · ${n}`);
  if (alignHits.length) {
    log(`· ${alignHits.length} 句的词级时间戳与原文有 ${Math.min(...alignHits.map(Number))}–${Math.max(...alignHits.map(Number))}`
      + ` 个字符没对应（TTS 不报标点），已按顺序对齐 —— 真时间戳保住了（不是按字数近似）`);
  }
  if (trimmedTotal > 0.3) {
    log(`· 每句尾巴上的静音已按"说到哪算到哪"处理：合计裁掉 ${trimmedTotal.toFixed(1)}s`
      + `（文件里还在，只是不算进这句的时长 —— 否则 slot 会被静音撑大）`);
  }

  // 2) 解时长（纯函数）
  const solved = solveTiming({
    scenes,
    beat,
    overlap: opts.overlap ?? script.overlap,
    tail,
    maxStretch,
  });
  for (const w of solved.warnings) log(`⚠ ${w}`);

  // 3) 写表
  const timing = {
    voice,
    rate,
    bpm: Math.round((60 / solved.beat) * 1000) / 1000,
    beat: solved.beat,
    overlap: solved.overlap,
    tail,
    maxStretch,
    total: solved.total,
    generatedBy: 'anim say',
    scenes: solved.scenes.map((s) => ({
      id: s.id,
      start: s.start,
      slot: s.slot,
      stretch: s.stretch,
      internal: s.internal,
      // ⚠ 前五个字段与 beast 那版 timing.json 保持一致（任务配置已经在 import 它了）；
      //   `start` / `index` 是给人和给校验看的（`narration.json` 的起点必须等于 start + offset）
      lines: s.lines.map((l, i) => ({
        index: i,
        cue: l.cue,
        text: l.text,
        file: l.file,
        dur: l.dur,
        durFile: l.durFile,
        offset: l.offset,
        start: l.start,
        words: l.words ?? undefined,
      })),
    })),
  };
  const narration = {
    // `source` 只是给人看的出处（A 档的 `ctx.narration.source`）；真正交给引擎的轨在 task.audio 里
    source: `./audio/${task}-vo.mp3`,
    lines: solved.scenes.flatMap((s) => s.lines.map((l, i) => ({
      id: `${s.id}-${i + 1}`,
      text: l.text,
      start: l.start,
      dur: l.dur,
      words: l.words ?? undefined,
    }))),
  };
  const totalSpeech = solved.scenes.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.dur, 0), 0);

  if (opts.dryRun) {
    log('（--dry-run：会合成/复用音频来量时长，但**不写** timing/narration、也不出旁白轨）');
    printTable(log, timing);
    return { ok: true, dryRun: true, timing, narration };
  }

  mkdirSync(path.join(taskDir, 'audio'), { recursive: true });
  writeFileSync(path.join(taskDir, 'audio', 'timing.json'), JSON.stringify(timing, null, 2) + '\n');
  writeFileSync(
    path.join(taskDir, 'audio', 'timing.mjs'),
    '// 由 `node scripts/anim.mjs say <任务>` 生成，不要手改；改旁白请改 narration.mjs 再重跑。\n'
    + `export default ${JSON.stringify(timing, null, 2)};\n`,
  );
  writeFileSync(path.join(taskDir, 'audio', 'narration.json'), JSON.stringify(narration, null, 2) + '\n');

  if (!opts.noVo) {
    const voOut = path.join(taskDir, 'audio', `${task}-vo.mp3`);
    const r = renderVo({ timing, taskDir, out: voOut });
    log(`✓ ${path.relative(process.cwd(), r.file)}  ${r.duration.toFixed(2)}s（只有旁白；和音乐混音跑 anim mix <任务>）`);
  }

  printTable(log, timing);
  const dup = solved.warnings.filter((w) => w.includes('叠句')).length;
  log(`\n时间表 audio/timing.json + audio/narration.json 已写出`
    + `（${synthCount} 句新合成，${wordsReal} 句真词级时间戳 / ${wordsApprox} 句按字数近似）`);
  log(`说话 ${totalSpeech.toFixed(1)}s / ${solved.total.toFixed(1)}s = ${((totalSpeech / solved.total) * 100).toFixed(0)}%`
    + `${totalSpeech / solved.total > 0.8 ? '  ⚠ 超过 80%：观众喘不过气，考虑加留白或砍内容' : ''}`);
  log(`叠句 ${dup} 处；每段最后一句说完后至少留 ${tail}s 画面（判据见 docs/NARRATION.md §5）`);
  log('\ntask.config.mjs 里这样用：');
  log(`  import timing from './audio/timing.mjs';`);
  log(`  narration: './narration.json',`);
  log(`  timeline: seq([`);
  for (const [i, s] of timing.scenes.entries()) {
    const ov = i === 0 ? '' : `, overlap: ${timing.overlap}`;
    log(`    cut(${s.id}, { dur: timing.scenes[${i}].slot${ov}, handlesTransition: true, params: { stretch: timing.scenes[${i}].stretch } }),`);
  }
  log(`  ]),`);
  return { ok: true, timing, narration, script, voice, rate };
}

function printTable(log, timing) {
  log('\n镜头           起点     时长   放慢   旁白（起点 / 时长）');
  for (const s of timing.scenes) {
    const vo = s.lines.map((l) => `${(l.start ?? s.start + l.offset).toFixed(2)}+${l.dur.toFixed(2)}`).join('  ');
    log(`${s.id.padEnd(14)}${s.start.toFixed(2).padStart(6)}s${s.slot.toFixed(3).padStart(8)}s${s.stretch.toFixed(2).padStart(6)}   ${vo}`);
  }
  log(`\n成片总长 ${timing.total.toFixed(2)}s（${(timing.total / 60).toFixed(2)} 分钟），`
    + `${timing.scenes.length} 段，相邻重叠 ${timing.overlap}s`);
}
