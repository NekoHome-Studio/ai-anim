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
 * 单位约定：时间是**秒**（浮点）；样本是 `Float32Array`（单声道）。
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
