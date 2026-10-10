// @ts-check
/**
 * 音频/进程的小工具（**Node 侧共用**，不进浏览器、不进 Vite 模块图）。
 *
 * 为什么单独一份、而不是从 `scripts/anim.mjs` import：
 * `anim.mjs` 是**带副作用的脚本**（import 的那一刻就解析 argv、开始跑命令），
 * 任何模块 import 它都会把 CLI 执行一遍。所以这里的几个函数是**故意重复**的 ——
 * 它们的语义必须和 CLI 里那几个保持一致（尤其是 `ANIM_FFMPEG` / `ANIM_FFPROBE`
 * 这两个包装器环境变量：`tools/slow-ffmpeg.mjs` 这类测试就靠它）。
 *
 * 单位约定：时间是**秒**（浮点）；样本是 `Float32Array`（单声道）；
 * 响度是 **LUFS**（整合）/ **dBTP**（真峰，不是采样峰值）/ **LU**（LRA），判据见 `LOUDNESS_TARGET`。
 *
 * 音频那一层的数字守门也在这里：`measureLoudness()` / `formatLoudness()` / `assessLoudness()`
 * —— 画面有 `check` 亮度、`shake` 逐帧变化量、`verify` 逐像素、`video` 复核帧数，
 * **音频这一层以前只能靠耳朵**（"你听不见，就说出这一点并报数字"）。
 * ⚠ 这里**只测量、只报数字**，绝不做自动归一化：那会改动所有带旁白片子的音轨（等于已交付片子全部重出）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** 把 `node tools/x.mjs --a` 这种命令行切成 argv（支持引号包住的路径）。 */
export function parseCmdline(s) {
  return String(s).match(/"[^"]+"|'[^']+'|\S+/g)?.map((x) => x.replace(/^["']|["']$/g, '')) ?? [];
}

/** 环境变量里那两条包装器的 argv（`ANIM_FFMPEG` / `ANIM_FFPROBE`）。 */
export function ffmpegArgv() {
  return parseCmdline(process.env.ANIM_FFMPEG || 'ffmpeg');
}
export function ffprobeArgv() {
  return parseCmdline(process.env.ANIM_FFPROBE || 'ffprobe');
}

/**
 * 跑一条外部命令。
 * @param {string[]} argv
 * @param {{ cwd?: string, input?: Buffer|string, inherit?: boolean, maxBuffer?: number }} [opts]
 * @returns {{ status: number|null, stdout: string, stderr: string, stdoutBuf: Buffer, spawnError?: string }}
 */
export function run(argv, opts = {}) {
  const inherit = !!opts.inherit;
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    input: opts.input,
    encoding: inherit ? undefined : 'buffer',
    stdio: inherit ? 'inherit' : undefined,
    maxBuffer: opts.maxBuffer ?? (1 << 30),
  });
  if (r.error) throw new Error(`跑不起 ${argv.join(' ')}：${r.error.message}`);
  const stdoutBuf = inherit ? Buffer.alloc(0) : (r.stdout ?? Buffer.alloc(0));
  return {
    status: r.status,
    stdout: inherit ? '' : stdoutBuf.toString('utf8'),
    stderr: inherit ? '' : (r.stderr ? r.stderr.toString('utf8') : ''),
    stdoutBuf,
  };
}

/**
 * 跟 `run` 一样，但**命令不存在时返回 `spawnError` 而不是抛错** ——
 * 探测"这个可执行文件在不在 PATH 上"必须用这一条（`spawnSync` 在 ENOENT 时
 * 会把 `error` 填上、`status` 留 null，用 `run` 去探会直接把整条命令炸掉）。
 * @returns {{ status: number|null, stdout: string, stderr: string, stdoutBuf: Buffer, spawnError?: string }}
 */
export function tryRun(argv, opts = {}) {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'buffer',
    maxBuffer: opts.maxBuffer ?? (1 << 26),
  });
  return {
    status: r.status,
    stdout: (r.stdout ?? Buffer.alloc(0)).toString('utf8'),
    stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
    stdoutBuf: r.stdout ?? Buffer.alloc(0),
    ...(r.error ? { spawnError: r.error.message } : {}),
  };
}

/** 跑一条命令，非零退出就抛错（错误里带最后几行 stderr —— 不然只看到 exit code）。 */
export function runChecked(argv, opts = {}) {
  const r = run(argv, opts);
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n');
    throw new Error(`命令失败（exit ${r.status}）：${argv.join(' ')}\n${tail}`);
  }
  return r;
}

/** 用 ffprobe 量一个音频/视频文件的时长（秒）。量不出来就抛错，不返回 0。 */
export function probeDuration(file) {
  if (!existsSync(file)) throw new Error(`文件不存在：${file}`);
  const r = run([...ffprobeArgv(), '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = Number(String(r.stdout).trim());
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`ffprobe 量不出时长：${file}（输出 "${String(r.stdout).trim()}" ${String(r.stderr).trim()}）`);
  }
  return d;
}

/**
 * 把一个音频文件解码成单声道 Float32。
 * ⚠ 逐句的旁白是一个文件一句，整句读进来最简单也最稳（不做"部分解码"优化）。
 */
export function decodeMono(file, sr = 44100) {
  return decodeChannels(file, sr, 1)[0];
}

/**
 * 解码成 `nch` 声道（缺的声道用最后一条补齐，多的丢掉）。
 * 单声道文件解成 2 声道时两边是同一份数据 —— 音乐床要保持立体声就用它。
 * @returns {Float32Array[]}
 */
export function decodeChannels(file, sr = 44100, nch = 1) {
  const r = run([...ffmpegArgv(), '-v', 'error', '-i', file, '-ac', String(nch), '-ar', String(sr), '-f', 'f32le', '-']);
  if (r.status !== 0 || !r.stdoutBuf.length) {
    throw new Error(`解码失败：${file}\n${r.stderr.trim().split(/\r?\n/).slice(-4).join('\n')}`);
  }
  const buf = r.stdoutBuf;
  const frames = Math.floor(buf.length / (4 * nch));
  const out = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) out[c][i] = buf.readFloatLE((i * nch + c) * 4);
  }
  return out;
}

/** 写一个 16bit PCM WAV（自己拼头，不依赖 ffmpeg —— 测试里要跑得飞快）。 */
export function writeWav16(file, channels, sr) {
  const nch = channels.length;
  const n = channels[0].length;
  mkdirSync(path.dirname(file), { recursive: true });
  const dataBytes = n * nch * 2;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + dataBytes, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(nch, 22);
  head.writeUInt32LE(sr, 24);
  head.writeUInt32LE(sr * nch * 2, 28);
  head.writeUInt16LE(nch * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(dataBytes, 40);
  const data = Buffer.alloc(dataBytes);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      data.writeInt16LE(Math.round(v * 32767), (i * nch + c) * 2);
    }
  }
  writeFileSync(file, Buffer.concat([head, data]));
  return file;
}

/** WAV → mp3（引擎只认浏览器能解码的东西，mp3 最稳）。 */
export function encodeMp3(wavPath, mp3Path, bitrate = '192k') {
  mkdirSync(path.dirname(mp3Path), { recursive: true });
  runChecked([...ffmpegArgv(), '-y', '-v', 'error', '-i', wavPath, '-b:a', bitrate, mp3Path]);
  if (!existsSync(mp3Path)) throw new Error(`ffmpeg 没写出 ${mp3Path}`);
  return mp3Path;
}

/**
 * 从 `task.config.mjs` 里**文本读**出 `audio` 字段。
 *
 * 与 `scripts/anim.mjs` 的 `resolveAudioTracks()` 同一个理由：任务配置是 Vite 模块
 * （可能 import 字体/图片/GLSL 场景），Node 侧直接 `import()` 会炸，所以只做够用的解析。
 * 解析不出来时返回 `null`，调用方必须自己决定"没读到怎么办"，不要瞎猜。
 *
 * @param {string} taskDir `tasks/<名字>`
 * @returns {string|{music?:string,vo?:string,mix?:string}|null} 原样的字面量（相对任务目录）
 */
export function readTaskAudioSpec(taskDir) {
  let src = '';
  try { src = readFileSync(path.join(taskDir, 'task.config.mjs'), 'utf8'); } catch { return null; }
  const m = /(^|\n)\s*audio:\s*(\{[^}]*\}|'[^']*'|"[^"]*")/.exec(src);
  if (!m) return null;
  const raw = m[2];
  if (raw.startsWith('{')) {
    /** @type {Record<string,string>} */
    const spec = {};
    for (const kv of raw.slice(1, -1).split(',')) {
      const mm = /(\w+)\s*:\s*['"]([^'"]+)['"]/.exec(kv);
      if (mm) spec[mm[1]] = mm[2];
    }
    return spec;
  }
  return raw.slice(1, -1);
}

/** 把任务配置里的相对路径解析成绝对路径（相对**任务目录**）。 */
export function taskRel(taskDir, p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(taskDir, String(p).replace(/^\.\//, ''));
}

/**
 * 量"这句话到底说到哪一秒"（**不是**文件时长）。
 *
 * 为什么必须区分：`edge-tts` 每条音频尾巴上都挂着约 **0.9 秒静音**（实测：1.87s 的文件里
 * 0.93–1.87s 全是静音）。`tasks/beast` 那版 `say.mjs` 直接用 ffprobe 的文件时长当"这句念了多久"，
 * 于是每句都白算进 0.9s —— `slot` 被静音撑大、叠句判据也跟着偏。
 * 这里用 `silencedetect` 找出**末尾那段静音**的起点，作为"说完了"的时刻。
 *
 * @param {string} file
 * @param {number} fileDur 文件时长（秒）
 * @param {{ noise?: string, minSilence?: number, tail?: number }} [opts]
 *        `noise` 静音门限、`minSilence` 多长才算一段静音、`tail` 说完之后再算多久（给辅音留个收尾）
 * @returns {{ speechEnd: number, trimmed: number, silences: [number, number][] }}
 */
export function probeSpeechEnd(file, fileDur, opts = {}) {
  const noise = opts.noise ?? '-45dB';
  const minSilence = opts.minSilence ?? 0.15;
  const tail = opts.tail ?? 0.12;
  const r = run([...ffmpegArgv(), '-v', 'info', '-i', file, '-af', `silencedetect=noise=${noise}:d=${minSilence}`, '-f', 'null', '-']);
  const text = `${r.stderr}`;
  /** @type {[number, number][]} */
  const silences = [];
  let open = null;
  for (const line of text.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) { open = Number(s[1]); continue; }
    const e = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (e && open != null) { silences.push([open, Number(e[1])]); open = null; }
  }
  if (open != null) silences.push([open, fileDur]); // 还没等到 silence_end 就 EOF 了
  // ⚠ 踩过的坑：ffmpeg **会**在文件结束时补一条 `silence_end`（第一条实现假设"末尾那段没有 end"，
  //   于是永远判不出尾巴静音 —— 实测 a.mp3 报的是 `silence_start: 0.934792 / silence_end: 1.872`）。
  //   所以判据改成"这段静音一直延续到文件末尾"。
  const last = silences[silences.length - 1];
  const trailingStart = last && last[1] >= fileDur - 0.08 ? last[0] : null;
  const speechEnd = trailingStart != null ? Math.min(fileDur, trailingStart + tail) : fileDur;
  return { speechEnd: Math.round(speechEnd * 1000) / 1000, trimmed: Math.max(0, fileDur - speechEnd), silences };
}
/**
 * 归一化 + 软削波（`tasks/beast/tools/mix.mjs` 里那套，实测听感可以）。
 * @param {Float32Array[]} chans
 */
export function normalize(chans, target = 0.89) {
  let peak = 0;
  for (const ch of chans) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const gain = peak > 0 ? Math.min(4, target / peak) : 1;
  // tanh 软削波：宁可轻微染色，也不要硬削出咔哒声
  for (const ch of chans) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(ch[i] * gain * 1.05);
  return { peak, gain };
}

/* ------------------------------------------------------------------ 响度（音频的数字守门） */

/**
 * 响度目标：**主流平台的归一化靶子**（YouTube / Instagram / TikTok / X / LinkedIn 都是这一组）。
 *
 * 为什么是这三个数：
 *   · `i` = −14 LUFS —— 平台会把更响的**压下来**、更轻的抬上去。做成 −14 上下，平台就不会再动它；
 *     比它响很多（例如 −9）会被平台削掉动态，比它轻很多（实测 sodium-mix 是 −20.9）观众就得自己拧音量。
 *   · `tp` = −1 dBTP —— **真峰**（true peak，考虑 DAC 重建后的采样间峰值）。留 1dB 余量，
 *     是因为有损编码（AAC/MP3）与平台转码都可能把采样间峰值顶上去；压到 0 就会削。
 *   · `lra` = 11 LU —— 响度范围。**超过它不算错误**（口播 + 音乐床天然就宽），只是提示"忽大忽小"。
 */
export const LOUDNESS_TARGET = { i: -14, tp: -1, lra: 11 };

/**
 * 从一段 stderr 里取出 **loudnorm 打印的那段 JSON**。
 *
 * ⚠ 为什么不能"从第一个 `{` 匹配到第一个 `}`"：`ANIM_FFMPEG` 允许是**包装器**
 * （`tools/slow-ffmpeg.mjs` 就是），它会往 stderr 里掺自己的输出；ffmpeg 自己也会先打
 * 一堆 `size=N/A time=…` 的进度行，最后才是这段 JSON。于是"第一个 JSON"可能根本不是它。
 *
 * 做法：**从后往前**扫描 `{`，用 `JSON.parse` 自己验 —— 取**最后一段能解析成对象**的花括号块
 * （最后一个 `{` 若是尾随的垃圾，会继续往前找）。字符串里的花括号与转义引号都会正确跳过。
 *
 * @param {string} stderr
 * @returns {Record<string, any>|null} 解析不出来返回 `null`（**不要**在这里抛错，调用方要能区分失败原因）
 */
export function parseLoudnormJson(stderr) {
  const s = String(stderr ?? '');
  for (let end = s.lastIndexOf('{'); end >= 0; end = s.lastIndexOf('{', end - 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = end; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '\\') { esc = true; continue; }
        if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            const o = JSON.parse(s.slice(end, i + 1));
            if (o && typeof o === 'object' && !Array.isArray(o)) return o;
          } catch { /* 不是 JSON，继续往前找 */ }
          break; // 这一块的配对已经结束，换下一个候选 `{`
        }
      }
    }
  }
  return null;
}

/** ffmpeg 的 `<数字>` 可能是 `-inf` / `inf` / `nan` / `-1.#IND` —— 一律变成 `Number`。 */
function num(x) {
  const s = String(x ?? '').trim();
  if (/^-?inf(inity)?$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  if (/^(nan|-?1\.#ind)$/i.test(s)) return NaN;
  const n = Number(s);
  return s === '' ? NaN : n;
}

/**
 * 量一个音频/视频文件的响度：**LUFS（整合）/ true peak / LRA**。
 *
 * 走的是 `loudnorm` 两遍法的**第一遍**（`-f null -`，只量不改）——
 * 所以这个函数**永远不会改动文件**：它只报数字。"自动归一化"是另一件事（会改掉所有已交付片子的音轨）。
 *
 *   const m = measureLoudness('tasks/x/audio/x-mix.mp3');
 *   console.log(formatLoudness(m));                    // −13.8 LUFS / −1.2 dBTP / LRA 4.1
 *   if (!assessLoudness(m).ok) …                       // 判据（可被单测直接断言）
 *
 * @param {string} file
 * @param {{ stderr?: string, target?: { i?: number, tp?: number, lra?: number } }} [opts]
 *        `stderr` 给定时**不跑 ffmpeg**，只解析这段文本（单测"最后一段完整 JSON"用）。
 * @returns {{ ok: true, file: string, i: number, tp: number, lra: number, thresh: number,
 *             targetOffset: number, target: { i: number, tp: number, lra: number },
 *             raw: Record<string, any>, argv: string[] }}
 * @throws {Error} 失败是**可区分**的三种（`err.kind`），绝不返回 `null` 让上游以为"测过了"：
 *   · `no-input`  —— 文件不存在 / 读不到；
 *   · `no-ffmpeg` —— 没有 ffmpeg（或 `ANIM_FFMPEG` 指的东西跑不起来）；
 *   · `ffmpeg-error` —— ffmpeg 自己非零退出（解不开的格式等）；
 *   · `no-json`   —— 跑完了但 stderr 里没有可解析的 loudnorm JSON（包装器吃掉了？ffmpeg 太老？）。
 */
export function measureLoudness(file, opts = {}) {
  const target = { ...LOUDNESS_TARGET, ...(opts.target ?? {}) };

  // ① 只解析给定文本（单测用；不碰 ffmpeg、不碰磁盘）
  if (typeof opts.stderr === 'string') {
    const raw = parseLoudnormJson(opts.stderr);
    if (!raw) {
      const e = new Error('给定的 stderr 里没有可解析的 loudnorm JSON');
      e.kind = 'no-json';
      throw e;
    }
    return packLoudness(String(file), raw, target, []);
  }

  const f = String(file ?? '');
  if (!f || !existsSync(f)) {
    const e = new Error(`文件不存在：${f || '(空路径)'}`);
    e.kind = 'no-input';
    throw e;
  }

  const argv = [...ffmpegArgv(), '-hide_banner', '-nostdin', '-v', 'info', '-i', f,
    '-af', `loudnorm=I=${target.i}:TP=${target.tp}:LRA=${target.lra}:print_format=json`,
    '-f', 'null', '-'];
  const r = tryRun(argv);

  if (r.spawnError) {
    const e = new Error(`跑不起 ffmpeg（${argv[0]}）：${r.spawnError}。装一个，或用 ANIM_FFMPEG 指定。`);
    e.kind = 'no-ffmpeg';
    throw e;
  }
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout).trim().split(/\r?\n/).slice(-6).join('\n');
    const e = new Error(`ffmpeg 量响度失败（exit ${r.status}）：${f}\n${tail}`);
    e.kind = 'ffmpeg-error';
    e.exit = r.status;
    throw e;
  }
  const raw = parseLoudnormJson(r.stderr);
  if (!raw) {
    const tail = String(r.stderr).trim().split(/\r?\n/).slice(-6).join('\n');
    const e = new Error(
      `ffmpeg 跑完了但 stderr 里没有 loudnorm 的 JSON：${f}\n`
      + `（是这个 ffmpeg 太老、没有 loudnorm 滤镜？还是 ANIM_FFMPEG 包装器把 stderr 吃掉了？）\n${tail}`);
    e.kind = 'no-json';
    throw e;
  }
  return packLoudness(f, raw, target, argv);
}

/** 把 loudnorm 那串字符串字段收成结构化对象（`i` / `tp` / `lra` 一律是 `Number`，可能是 ±Infinity / NaN）。 */
function packLoudness(file, raw, target, argv) {
  return {
    ok: true,
    file,
    i: num(raw.input_i),
    tp: num(raw.input_tp),
    lra: num(raw.input_lra),
    thresh: num(raw.input_thresh),
    targetOffset: num(raw.target_offset),
    target,
    raw,
    argv,
  };
}

/**
 * 判据：**离 `-14 / -1` 差多少、有没有越界**。纯函数，单测直接断言它。
 *
 * 越界分两档（照 `check` 的既有哲学：越界 ≠ 一律失败）：
 *   · `error`：不达标（`|i − target.i| > tolLu`）、超过真峰上限（`tp > target.tp`）、或者数字本身不是有限数；
 *   · `warn` ：LRA 超过上限（口播 + 音乐床天然就宽 —— 提示"忽大忽小"，不 gate）。
 *
 * @param {ReturnType<typeof measureLoudness>|{ i:number, tp:number, lra:number, target?:any }} m
 * @param {{ tolLu?: number, tpCeiling?: number, lraMax?: number }} [opts]
 * @returns {{ ok: boolean, tolLu: number, di: number, dtp: number, dlra: number,
 *             loudOk: boolean, peakOk: boolean, lraOk: boolean, tier: 'ok'|'warn'|'error',
 *             violations: { kind: 'loudness'|'true-peak'|'lra'|'nan', tier: 'error'|'warn', text: string }[],
 *             verdict: string }}
 */
export function assessLoudness(m, opts = {}) {
  const target = { ...LOUDNESS_TARGET, ...(m?.target ?? {}), ...(opts.target ?? {}) };
  const tolLu = opts.tolLu ?? 1.0;
  const tpCeiling = opts.tpCeiling ?? target.tp;
  const lraMax = opts.lraMax ?? target.lra;

  const i = Number(m?.i);
  const tp = Number(m?.tp);
  const lra = Number(m?.lra);
  const finite = Number.isFinite(i);
  const tpFinite = Number.isFinite(tp);

  const di = finite ? i - target.i : NaN;
  const dtp = tpFinite ? tp - tpCeiling : NaN;
  const dlra = Number.isFinite(lra) ? lra - lraMax : NaN;

  const loudOk = finite && Math.abs(di) <= tolLu;
  // 真峰是**上限**：只要不比上限响就算过（比目标轻不是问题；NaN 也算不达标）
  const peakOk = tpFinite && tp <= tpCeiling;
  const lraOk = !Number.isFinite(lra) || lra <= lraMax;

  /** @type {{ kind: string, tier: 'error'|'warn', text: string }[]} */
  const violations = [];
  if (!finite) {
    violations.push({ kind: 'nan', tier: 'error', text: `量不出整合响度（input_i = ${m?.i}）—— 文件是静音、或者根本不是音频` });
  } else if (!loudOk) {
    violations.push({
      kind: 'loudness', tier: 'error',
      text: `${i.toFixed(1)} LUFS 离目标 ${target.i} 差了 ${di > 0 ? '+' : ''}${di.toFixed(1)} LU`
        + `（容差 ±${tolLu.toFixed(1)}）—— ${di > 0 ? '平台会把它压下来，动态被削' : '比平台靶子轻，观众得自己拧音量'}`,
    });
  }
  if (!tpFinite) {
    violations.push({ kind: 'nan', tier: 'error', text: `量不出真峰（input_tp = ${m?.tp}）` });
  } else if (!peakOk) {
    violations.push({
      kind: 'true-peak', tier: 'error',
      text: `真峰 ${tp.toFixed(2)} dBTP 超过上限 ${tpCeiling} dBTP：平台/有损转码会削顶`,
    });
  }
  if (!lraOk) {
    violations.push({
      kind: 'lra', tier: 'warn',
      text: `LRA ${lra.toFixed(1)} LU 超过 ${lraMax}：这一段忽大忽小（口播 + 音乐床的片子天然就宽，只提示不 gate）`,
    });
  }

  const tier = violations.some((v) => v.tier === 'error') ? 'error'
    : (violations.length ? 'warn' : 'ok');
  const verdict = tier === 'ok' ? `达标（${target.i} LUFS / ${target.tp} dBTP）` : violations.map((v) => v.text).join('；');
  return { ok: tier !== 'error', tolLu, di, dtp, dlra, loudOk, peakOk, lraOk, tier, violations, verdict };
}

/**
 * 人读的一行：`−13.8 LUFS / −1.2 dBTP / LRA 4.1`（`peak` 是**真峰**，不是采样峰值）。
 * @param {{ i:number, tp:number, lra:number }} m
 * @param {{ verdict?: boolean, target?: any }} [opts] `verdict: true` 时会在后面接一句判据文字
 */
export function formatLoudness(m, opts = {}) {
  const one = (v, u = '') => (Number.isFinite(v) ? `${v.toFixed(1)}${u}` : (v === -Infinity ? '-∞' : 'NaN'));
  const line = `${one(Number(m?.i))} LUFS / ${Number.isFinite(Number(m?.tp)) ? Number(m.tp).toFixed(2) : (Number(m?.tp) === -Infinity ? '-∞' : 'NaN')} dBTP`
    + ` / LRA ${one(Number(m?.lra))}`;
  return opts.verdict ? `${line} —— ${assessLoudness(m, opts).verdict}` : line;
}
