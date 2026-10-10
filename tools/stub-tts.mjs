// @ts-check
/**
 * 假 TTS 驱动 —— 给**离线**回归用（`ANIM_TTS="node tools/stub-tts.mjs"`）。
 *
 * 为什么需要它：
 *   `anim say` 这条路要验证的东西（时间表解得对不对、叠句警告、缓存、词级时间戳接线、mix 的闪避）
 *   **全都跟"声音是不是真的"无关**。真 TTS 要联网、要装 python 包、同一句话每次时长还可能差几十毫秒，
 *   拿它当回归的基准 = 每次跑出来的断言都不一样。
 *
 * 这里的行为是**完全确定**的：
 *   · 时长 = 每个汉字/字母数字 0.18s + 标点 0.08s + 空白 0.04s（`--rate` 只做等比缩放，能看出解算有没有用上）；
 *   · 音频 = 一段 220Hz 正弦（左右声道相同，带淡入淡出，ffmpeg 编成 mp3），**不发声也没关系**；
 *   · `--write-words` 老实写词级时间戳（按上面的权重分配），所以下游拿到的是"真"时间戳而不是近似。
 *
 * ⚠ 它**故意**支持 `--write-words`：这样"驱动不支持词级时间戳"那条退化路径要用另一个
 * 开关来测（`--no-words`），而不是靠"碰巧没有"。
 *
 * ## 注入失败（`docs/BACKLOG.md` 1-6 的批量容错要用它）
 *
 * ```
 *   node tools/stub-tts.mjs … --fail "<子串>" [--fail-cmd always|zeroremaining] [--fail-n 1] [--fail-state <文件>]
 * ```
 *
 * `text` 里含 `--fail` 那个子串时按 `--fail-cmd` 失败：
 *   · `always`（默认）—— 退出码 4（像 edge-tts 的网络抖动）；
 *   · `zeroremaining` —— **退出码 0，却把输出写成 0 字节**（`IMPROVEMENTS-4.md` §6 A 那件事，
 *     专门用来验"0 字节绝不当成功"）。
 * `--fail-n N` 时**前 N 次**失败、之后**总是成功** —— 用它验"失败也继续、最后统一补跑"
 * 那一步真的把句子救回来了。次数记在 `--fail-state`（默认 `<media>.stub-fails`）里，
 * 因为驱动是**一次一进程**（`spawnSync`），进程内变量跨不过去。
 *
 * ⚠ 计数器按"文本"记，不按输出文件 —— 同样的句子在别处出现时共用一次计数，测试才可复现。
 * 归零：删掉那个 `--fail-state` 文件（或换一个输出目录）。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);

const text = arg('--text');
const media = arg('--write-media');
const wordsFile = arg('--write-words');
const rate = arg('--rate', '+0%');
if (!text || !media) {
  console.error('用法：node tools/stub-tts.mjs --text 文本 --write-media out.mp3 [--write-words x.json] [--rate=-6%]');
  process.exit(2);
}

/**
 * 失败注入（见文件头的说明）。
 *
 * ⚠ 计数器必须落到**盘上**：驱动是一句一进程（`runSay` 用 `spawnSync`），
 * 进程内的变量跨不过去，而"前 N 次失败、之后成功"这件事只能靠跨进程的计数表达。
 */
const failPattern = arg('--fail');
if (failPattern && String(text).includes(failPattern)) {
  const mode = arg('--fail-cmd', 'always');
  const limit = Number(arg('--fail-n', '0')) || 0;
  const stateFile = arg('--fail-state', `${media}.stub-fails`);
  let counts = {};
  try { counts = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* 没有/坏了都从 0 开始 */ }
  const key = String(text);
  // `seen` = **这一句之前已经被调用过几次**（也就是"这次是第几次"）。先读后写，
  // 这样 `--fail-n 2` 的语义就是"第 1、2 次失败，第 3 次起成功"——一次不多、一次不少。
  const seen = Number(counts[key] ?? 0);
  counts[key] = seen + 1;
  try {
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(counts, null, 1));
  } catch { /* 计数写不动不致命：`--fail-n` 的语义退化成 always，测试会看出来 */ }
  if (!limit || seen < limit) {
    if (mode === 'zeroremaining') {
      // 退出码 0、**0 字节** —— 最阴的那种失败（"0 字节当成功"这条判据就是为它写的）
      mkdirSync(path.dirname(media), { recursive: true });
      writeFileSync(media, Buffer.alloc(0));
      process.exit(0);
    }
    console.error(`stub-tts: 注入失败（--fail ${JSON.stringify(failPattern)} 命中第 ${seen + 1} 次）`);
    process.exit(4);
  }
}

/** 权重：汉字/字母数字 1、标点 0.45、空白 0.2（≈ 0.18s / 0.08s / 0.04s 一个字） */
const weight = (ch) => (/\s/.test(ch) ? 0.2 : /[\p{P}\p{S}]/u.test(ch) ? 0.45 : 1);
const rateScale = (() => {
  const m = /([+-]?\d+(?:\.\d+)?)\s*%/.exec(rate);
  return m ? Math.max(0.25, 1 + Number(m[1]) / 100) : 1;
})();

const chars = Array.from(text);
const totalWeight = chars.reduce((s, c) => s + weight(c), 0) || 1;
const dur = (0.18 * totalWeight) / rateScale;
const sr = 24000;
const n = Math.max(1, Math.round(dur * sr));

// 220Hz 正弦 + 5ms 淡入淡出（避免编码出咔哒声；内容是什么其实无所谓）
const mono = new Float32Array(n);
const fade = Math.round(0.005 * sr);
for (let i = 0; i < n; i++) {
  const env = Math.min(1, i / fade, (n - 1 - i) / fade);
  mono[i] = 0.35 * Math.max(0, env) * Math.sin((2 * Math.PI * 220 * i) / sr);
}

const wav = `${media}.stub.wav`;
mkdirSync(path.dirname(media), { recursive: true });
writeFileSync(wav, wavBytes([mono, mono], sr));
const ff = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-b:a', '128k', media], { encoding: 'utf8' });
if (ff.status !== 0) {
  console.error(`stub-tts: ffmpeg 失败\n${ff.stderr}`);
  process.exit(4);
}
try { rmSync(wav); } catch { /* 中间产物删不掉不影响结果 */ }

let words = [];
if (wordsFile && !has('--no-words')) {
  let t = 0;
  words = chars.map((ch) => {
    const d = (0.18 * weight(ch)) / rateScale;
    const w = { w: ch, start: round4(t), end: round4(t + d) };
    t += d;
    return w;
  });
  writeFileSync(wordsFile, JSON.stringify(words, null, 1));
}
console.log(words.length ? `${words.length} words` : 'ok');

/** 16bit PCM WAV（自己拼头，不依赖 ffmpeg 也照样能工作） */
function wavBytes(channels, sampleRate) {
  const nch = channels.length;
  const len = channels[0].length;
  const dataBytes = len * nch * 2;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + dataBytes, 4);
  head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(nch, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE(sampleRate * nch * 2, 28);
  head.writeUInt16LE(nch * 2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(dataBytes, 40);
  const data = Buffer.alloc(dataBytes);
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767), (i * nch + c) * 2);
    }
  }
  return Buffer.concat([head, data]);
}

function round4(x) { return Math.round(x * 10000) / 10000; }
