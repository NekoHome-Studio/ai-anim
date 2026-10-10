// @ts-check
/**
 * `anim say` / `anim mix` 的离线回归（`docs/NARRATION.md` B 档）。
 *
 *   node tools/test-say.mjs
 *
 * 用 `tools/stub-tts.mjs` 当 TTS 驱动（时长是可算的确定值），所以这一整套**不需要联网**、
 * 不需要 GPU，几秒钟跑完。验的是"时间表解得对不对"，不是"声音好不好听"：
 *
 *   ① 逐句合成 + 时长测量（stub 的时长 = 0.18s × 字重，能反推验证）
 *   ② `stretch` / `slot` / `start` 的解算与旁白脚本里的 cue 对得上
 *   ③ 叠句必须报警（NARRATION.md §3 的核心约束；第一版 beast 有 10 处叠句）
 *   ④ 每段最后一句说完之后至少还有 TAIL 秒
 *   ⑤ 缓存：第二次跑不再合成、音频字节不变
 *   ⑥ 词级时间戳：驱动给了就用真的；驱动不给就标成近似（**不许静默**）
 *   ⑦ 产物：timing.json / timing.mjs / narration.json 三张表一致
 *   ⑧ `anim mix`：旁白摆位正确、时长 = 片子时长、空档处音乐在响
 *   ⑨ **标点对齐的判据**（`docs/BACKLOG.md` 1-2）：驱动不报标点 = 正常，**不报警**；
 *      排除标点后仍对不上（漏了实义字符）才报警 —— 两种情形都要**保住真时间戳**
 *   ⑩ **批量容错**（`docs/BACKLOG.md` 1-6）：中间某句反复失败 ⇒ 其余句子照样合成完、
 *      收尾统一报告"哪几句失败"、退出码非 0、**不写表**；整批跑完后的统一补跑能把句子救回来；
 *      而且"0 字节 / 0 时长"绝不许当成"成功合成了一句空话"混进时长表
 *
 * ⚠ 这个脚本的夹具任务建在**系统临时目录**里（不是 `tasks/`）：这样它跟正在跑的渲染
 *   完全互不干扰 —— 往仓库里写文件会让私有 Vite 的文件监听撞上 EBUSY 而崩掉（已实测）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeChannels, encodeMp3, writeWav16 } from '../scripts/lib/media.mjs';
import { alignWords, buildLineResult, runSay, solveTiming } from '../scripts/lib/say.mjs';
import { runMix } from '../scripts/lib/mix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = '_saytest';
const TASK_DIR = path.join(os.tmpdir(), 'anim-saytest');
const node = process.execPath;
/** stub 驱动用**绝对路径**（不然从别的 cwd 跑这个测试就找不到它）；
 *  ⚠ node 的路径自己也可能带空格（`C:\Program Files\nodejs\node.exe`），所以也要加引号 ——
 *  `parseCmdline()` 是按引号切的，不加引号会被切成 "C:\Program" + "Files\nodejs\node.exe"。 */
const STUB = `"${node}" "${path.join(ROOT, 'tools', 'stub-tts.mjs')}"`;
const STUB_NO_WORDS = `${STUB} --no-words`;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (ok) pass++; else fail++;
};
const close = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

/* ── 夹具任务：两段，覆盖"正常"、"放慢到底"、"叠句"三种情况 ── */

const NARRATION = `// 回归夹具（tools/test-say.mjs 生成）：两段，覆盖正常/放慢到底/叠句三种情况。
export const VOICE = 'stub';
export const RATE = '+0%';
export const TAIL = 1.0;
export const MAX_STRETCH = 1.5;
export const BPM = 120;          // 一拍 0.5s，slot 应该取整到 0.5 的倍数
export const SCENES = [
  {
    id: 'alpha', internal: 3.0,
    lines: [
      { cue: 0.5, text: '第一句。' },
      { cue: 2.0, text: '第二句。' },
    ],
  },
  {
    id: 'bravo', internal: 2.0,
    lines: [
      { cue: 0.4, text: '这一句故意写得很长很长很长，长到画面怎么放慢都念不完。' },
      { cue: 0.8, text: '这一句的 cue 只比上一句晚一点点，一定会叠句。' },
    ],
  },
];
`;

function setup() {
  rmSync(TASK_DIR, { recursive: true, force: true });
  mkdirSync(path.join(TASK_DIR, 'audio'), { recursive: true });
  writeFileSync(path.join(TASK_DIR, 'narration.mjs'), NARRATION);
  // 夹具任务本身要是一个**能加载的合法任务**（不然 anim tasks / check 会被它绊倒）。
  // 场景内联在这里：只铺一块底色。测试不渲染它，但引擎读得动。
  writeFileSync(path.join(TASK_DIR, 'task.config.mjs'), `// 夹具（tools/test-say.mjs 生成；只验 say/mix 这两条 Node 侧的路，不渲染）
import { seq, cut } from '../../src/timeline.js';

const blank = {
  id: 'blank',
  render(ctx) { ctx.gl.clear(ctx.out, [0.05, 0.05, 0.06]); return {}; },
};

export default {
  title: 'say/mix 夹具', width: 640, height: 360, fps: 30,
  audio: { music: './audio/bed.mp3', vo: './audio/${TASK}-vo.mp3', mix: './audio/${TASK}-mix.mp3' },
  narration: './narration.json',
  timeline: seq([cut(blank, { dur: 2 })]),
};
`);
  // 音乐床：120bpm 的咔哒（每 0.5s 一个短脉冲）—— 空档处听得到，说话时应该被压下去
  const sr = 44100;
  const dur = 40;
  const bed = new Float32Array(dur * sr);
  for (let b = 0; b * 0.5 < dur; b++) {
    const at = Math.round(b * 0.5 * sr);
    for (let i = 0; i < sr * 0.08 && at + i < bed.length; i++) {
      bed[at + i] = 0.5 * Math.sin((2 * Math.PI * 160 * i) / sr) * Math.exp(-i / (sr * 0.02));
    }
  }
  const wav = path.join(TASK_DIR, 'audio', 'bed.wav');
  writeWav16(wav, [bed, bed], sr);
  encodeMp3(wav, path.join(TASK_DIR, 'audio', 'bed.mp3'));
  rmSync(wav, { force: true });
}

/* ── 批量容错的夹具（`docs/BACKLOG.md` 1-6） ── */

/**
 * 建一个"4 句一段"的独立夹具任务，用它验"失败也继续、最后统一补跑"。
 *
 * ⚠ 必须是**独立目录**、而且要真删掉：失败注入的计数器落在
 * `audio/vo/<文件>.stub-fails`，跨进程持久（驱动是一句一进程）。
 * 不删的话上一轮跑剩的计数会让下一次跑的注入次数完全变样 —— 测试就不可复现了
 * （实测：第二次跑同一个夹具，计数从 5 接着涨，于是"必失败"的句子直接成功了）。
 */
function mkBatchTask(dir, narr) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'audio'), { recursive: true });
  writeFileSync(path.join(dir, 'narration.mjs'), narr);
  // 顺手证明"真的删干净了"：残留的失败计数器会让下一轮的注入次数完全变样（踩过一次）
  const left = readdirSync(path.join(dir, 'audio')).filter((f) => f.endsWith('.stub-fails'));
  if (left.length) throw new Error(`夹具没删干净：${dir} 里还有 ${left.join(', ')}`);
  return dir;
}

const ONE_SCENE_4 = (texts) => `// 回归夹具（tools/test-say.mjs §8 生成）：一段 4 句，用来注入"中间某句合成失败"。
export const VOICE = 'stub';
export const RATE = '+0%';
export const TAIL = 1.0;
// internal 只给 1.0s，而 4 句要念 4.8s ⇒ 放慢系数会顶到上限。这里把上限放宽，
// 免得 §8 的日志断言被 MAX_STRETCH 那条**别的**警告干扰（它由 §1 的夹具单独覆盖）。
export const MAX_STRETCH = 20;
export const BPM = 120;          // 一拍 0.5s
export const SCENES = [
  {
    id: 'one', internal: 1.0,
    lines: [
${texts.map((t, i) => `      { cue: ${(i * 1.0).toFixed(1)}, text: ${JSON.stringify(t)} },`).join('\n')}
    ],
  },
];
`;

/** 一段 4 句、正文确定，好让失败注入的子串唯一命中（`B1..B4` 都在里面）。 */
const BATCH_TEXTS = ['B1 甲乙丙丁。', 'B2 戊己庚辛。', 'B3 壬癸子丑。', 'B4 寅卯辰巳。'];

/** 量一段时间里的 RMS */
function rmsAt(channel, sr, from, to) {
  let acc = 0;
  let n = 0;
  const i0 = Math.max(0, Math.round(from * sr));
  const i1 = Math.min(channel.length, Math.round(to * sr));
  for (let i = i0; i < i1; i++) { acc += channel[i] * channel[i]; n++; }
  return n ? Math.sqrt(acc / n) : 0;
}

/**
 * Goertzel：量某一段时间里**某一个频率**的幅度。
 *
 * 为什么不能直接用 RMS 验闪避：说话窗里本来就有旁白自己的能量，RMS 只会变大。
 * 音乐床的咔哒是 160Hz、stub 的旁白是 220Hz —— 分开量就能干净地看出
 * "同一个音乐脉冲，说话时被压掉了多少"。
 */
function toneMag(channel, sr, from, to, freq) {
  const n = Math.max(1, Math.round((to - from) * sr));
  const i0 = Math.max(0, Math.round(from * sr));
  const w = (2 * Math.PI * freq) / sr;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = (channel[i0 + i] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / (n / 2);
}

console.log(`· 建夹具任务 ${TASK_DIR} …`);
setup();

/* ── 1) anim say（用 stub 驱动） ── */
console.log('\n① anim say —— 合成、量长、解时间表');
const logs = [];
const sayRes = await runSay(TASK, { taskDir: TASK_DIR, tts: STUB, log: (...a) => { logs.push(a.join(' ')); } });
const said = logs.join('\n');
const timing = sayRes.timing;

check('两段的表都出来了', timing.scenes.length === 2, `scenes=${timing.scenes.length}`);
check('beat 来自 narration.mjs 的 BPM=120', close(timing.beat, 0.5, 1e-6), `beat=${timing.beat}`);
check('相邻重叠 = 一拍', close(timing.overlap, 0.5, 1e-6), `overlap=${timing.overlap}`);

// 时长：stub 的算法是 0.18s × 字重（汉字 1、标点 0.45）
const stubDur = (s) => 0.18 * Array.from(s).reduce((a, ch) => a + (/\s/.test(ch) ? 0.2 : /[\p{P}\p{S}]/u.test(ch) ? 0.45 : 1), 0);
const d1 = Number(timing.scenes[0].lines[0].dur);
check('量出来的时长与 stub 的算法一致', close(d1, stubDur('第一句。'), 0.05),
  `${d1.toFixed(3)} vs ${stubDur('第一句。').toFixed(3)}`);

// stretch：第一段 need = max(0.5+d1, 2.0+d2) + TAIL，internal = 3.0
const needAlpha = Math.max(0.5 + stubDur('第一句。'), 2.0 + stubDur('第二句。')) + 1.0;
check('stretch 解对了（need / internal）', close(timing.scenes[0].stretch, Math.max(1, needAlpha / 3.0), 0.02),
  `${timing.scenes[0].stretch} vs ${(needAlpha / 3.0).toFixed(3)}`);
check('slot 取整到整拍（0.5s 的倍数）',
  Math.abs(timing.scenes[0].slot / 0.5 - Math.round(timing.scenes[0].slot / 0.5)) < 1e-6,
  `slot=${timing.scenes[0].slot}`);

for (const s of timing.scenes) {
  const last = s.start + Math.max(...s.lines.map((l) => l.offset + l.dur));
  const tailRoom = s.start + s.slot - last;
  check(`[${s.id}] 最后一句说完后留白 ≥ TAIL(1.0s)`, tailRoom >= 1.0 - 1e-6, `${tailRoom.toFixed(2)}s`);
}

check('段落起点按 slot − overlap 累加',
  close(timing.scenes[1].start, timing.scenes[0].slot - timing.overlap, 1e-3),
  `${timing.scenes[1].start} vs ${(timing.scenes[0].slot - timing.overlap).toFixed(3)}`);

check('叠句必须报警（bravo 那两句）', /叠句/.test(said),
  said.split('\n').find((l) => l.includes('叠句'))?.trim() ?? '(没有报警)');
check('放慢到 MAX_STRETCH 也要报警', /MAX_STRETCH/.test(said));
check('说话占比打印出来了', /说话 \d/.test(said));

/* ── 2) 产物三张表 ── */
console.log('\n② 产物：timing.json / timing.mjs / narration.json');
const tJson = JSON.parse(readFileSync(path.join(TASK_DIR, 'audio', 'timing.json'), 'utf8'));
const tMjs = readFileSync(path.join(TASK_DIR, 'audio', 'timing.mjs'), 'utf8');
const narr = JSON.parse(readFileSync(path.join(TASK_DIR, 'audio', 'narration.json'), 'utf8'));
check('timing.json 与返回值一致', tJson.total === timing.total && tJson.scenes.length === timing.scenes.length);
check('timing.mjs 能 import 出同一份数据', /export default \{/.test(tMjs) && tMjs.includes(`"total": ${timing.total}`));
check('narration.json 句子数与 timing 一致',
  narr.lines.length === timing.scenes.reduce((a, s) => a + s.lines.length, 0), `${narr.lines.length} 句`);
check('narration 的起点 == timing 的 start + offset',
  narr.lines.every((l) => {
    for (const s of timing.scenes) {
      for (const tl of s.lines) {
        if (`${s.id}-${tl.index + 1}` === l.id) {
          return close(l.start, s.start + tl.offset, 1e-3) && close(l.dur, tl.dur, 1e-3);
        }
      }
    }
    return false;
  }));

/* ── 3) 缓存 ── */
console.log('\n③ 缓存：同一份旁白再跑一次');
const before = readFileSync(path.join(TASK_DIR, 'audio', 'vo', 'alpha-1.mp3'), 'utf8');
const logs2 = [];
await runSay(TASK, { taskDir: TASK_DIR, tts: STUB, log: (...a) => logs2.push(a.join(' ')) });
const after = readFileSync(path.join(TASK_DIR, 'audio', 'vo', 'alpha-1.mp3'), 'utf8');
check('第二次跑 0 句新合成', /（0 句新合成/.test(logs2.join('\n')),
  logs2.join('\n').split('\n').find((l) => l.includes('句新合成'))?.trim() ?? '');
check('音频文件没有被重写（字节相同）', before === after);

/* ── 4) 词级时间戳 ── */
console.log('\n④ 词级时间戳');
const words0 = tJson.scenes[0].lines[0].words;
check('stub 支持 --write-words → 拿到真时间戳', !!words0 && !words0[0].approx, JSON.stringify(words0?.slice(0, 3)));
// ⚠ timing.json 里的词级时间戳是**整片绝对时间**（narration.json 要用它），所以是
//   "末词 end − 首词 start ≈ 句长"，而不是"末词 end ≈ 句长"。
check('真时间戳覆盖整句（末词 end − 首词 start ≈ 句长）',
  close(words0.at(-1).end - words0[0].start, tJson.scenes[0].lines[0].dur, 0.05),
  `${(words0.at(-1).end - words0[0].start).toFixed(3)} vs ${tJson.scenes[0].lines[0].dur}`);
check('narration.json 里也带上了词级时间戳（整片时间）',
  !!narr.lines[0].words && narr.lines[0].words[0].start >= narr.lines[0].start - 1e-6,
  `首词 start=${narr.lines[0].words?.[0]?.start} 句 start=${narr.lines[0].start}`);

const logs3 = [];
await runSay(TASK, { taskDir: TASK_DIR, tts: STUB_NO_WORDS, force: true, noVo: true, log: (...a) => logs3.push(a.join(' ')) });
const approxWords = JSON.parse(readFileSync(path.join(TASK_DIR, 'audio', 'timing.json'), 'utf8')).scenes[0].lines[0].words;
check('驱动不给词级时间戳时标成近似', !!approxWords?.[0]?.approx, `approx=${approxWords?.[0]?.approx}`);
check('退化这件事被打印出来（不许静默）', /近似|词级/.test(logs3.join('\n')),
  logs3.join('\n').split('\n').find((l) => /近似|词级/.test(l))?.trim() ?? '');

// 回到"有真时间戳"的状态（后面 mix 用）
await runSay(TASK, { taskDir: TASK_DIR, tts: STUB, force: true, noVo: true, log: () => {} });

/* ── 5) anim mix：摆位 + 闪避 ── */
console.log('\n⑤ anim mix —— 旁白摆位 + 闪避');
const mixLogs = [];
const mixRes = runMix(TASK, { taskDir: TASK_DIR, out: path.join(TASK_DIR, 'audio', `${TASK}-mix.mp3`), log: (...a) => mixLogs.push(a.join(' ')) });
const mixed = mixLogs.join('\n');
const mixDur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mixRes.file], { encoding: 'utf8' }).stdout.trim());
check('混音轨时长 == 片子时长', close(mixDur, timing.total, 0.1), `${mixDur.toFixed(2)} vs ${timing.total.toFixed(2)}`);
check('打印了闪避深度与说话占比', /闪避最深/.test(mixed) && /说话/.test(mixed));

// 闪避判据：音乐床是"每 0.5s 一个 160Hz 短脉冲"，stub 的旁白是 220Hz 正弦。
// 于是可以量**同一个音乐脉冲**在"没人说话"和"正在说话"两种情形下的 160Hz 幅度：
//   脉冲 #1 在 t=0.00–0.08（第一句 cue=0.5s 之前 → 没被压）
//   脉冲 #3 在 t=1.00–1.08（第一句正在说 → 应该被压到 ~22%）
const [L, R] = decodeChannels(mixRes.file, 44100, 2);
const A = tJson; // 只是为了下面读着顺
void A;
const pulseFree = Math.max(toneMag(L, 44100, 0.0, 0.08, 160), toneMag(R, 44100, 0.0, 0.08, 160));
const pulseDucked = Math.max(toneMag(L, 44100, 1.0, 1.08, 160), toneMag(R, 44100, 1.0, 1.08, 160));
const voice = Math.max(toneMag(L, 44100, 0.7, 1.2, 220), toneMag(R, 44100, 0.7, 1.2, 220));
check('音乐床确实在响（空档处的 160Hz 脉冲量得到）', pulseFree > 0.01, `160Hz 幅度 ${pulseFree.toFixed(4)}`);
check('旁白确实摆进去了（说话窗里有 220Hz）', voice > 0.02, `220Hz 幅度 ${voice.toFixed(4)}`);
check('闪避真的压了音乐：说话时的同一个脉冲明显更小', pulseDucked < pulseFree * 0.55,
  `没说话 ${pulseFree.toFixed(4)} → 说话时 ${pulseDucked.toFixed(4)}（${(pulseDucked / pulseFree * 100).toFixed(0)}%）`);

/* ── 6) solveTiming 纯函数边界 ── */
console.log('\n⑥ solveTiming 纯函数边界');
const s1 = solveTiming({
  scenes: [{ id: 'x', internal: 2, lines: [{ cue: 0, text: 'a', dur: 1, file: 'f' }] }],
  beat: 0.5, overlap: 'beat', tail: 1, maxStretch: 1.9,
});
// need = 1 + 1 = 2 → stretch = max(1, 2/2) = 1 → finish = max(2, 1) + 1 = 3 → 整拍还是 3
check('单句：start=0、slot 取整拍、total = slot',
  s1.scenes[0].start === 0 && s1.scenes[0].slot === 3 && s1.total === 3,
  `slot=${s1.scenes[0].slot} total=${s1.total}`);
let threw = false;
try {
  solveTiming({
    scenes: [{ id: 'x', internal: 2, lines: [{ cue: 0, text: 'a', dur: 0, file: 'f' }] }],
    beat: 0.5, overlap: 'beat', tail: 1, maxStretch: 1.9,
  });
} catch { threw = true; }
check('时长为 0 的句子直接抛错（TTS 没出声不许静默通过）', threw);

/* ── 7) 标点对齐（BACKLOG 1-2） ── */
console.log('\n⑦ 标点对齐：只差标点 → 不报；漏了实义字符 → 照报');

// 7.1 纯函数判据。`edge-tts` 的真实行为：WordBoundary **不报标点**，所以 47/47 句都会走到对齐这条路。
const PUNCT = /[\s\p{P}\p{S}]/u;
/** 按顺序给每个词编一段确定的时间戳（0.2s 一个）—— 只为看清"跳过的是哪几个字符" */
const wAt = (...needles) => needles.map((w, i) => ({ w, start: i * 0.2, end: (i + 1) * 0.2 }));
const alPunct = alignWords('先看一句话。', wAt('先', '看', '一句话'));
check('alignWords：只少了标点 → ok，absorbed>0 但 stray 为空',
  alPunct.ok && alPunct.absorbed === 1 && alPunct.stray === '',
  `absorbed=${alPunct.absorbed} stray=${JSON.stringify(alPunct.stray)}`);
check('alignWords：句号并进前一个词的尾巴 → 拼起来仍等于原文（karaoke 的位置前提）',
  alPunct.words.map((w) => w.w).join('') === '先看一句话。', JSON.stringify(alPunct.words.map((w) => w.w)));
check('alignWords：并进去的那个词时间戳没被改写',
  alPunct.words[2].w === '一句话。' && close(alPunct.words[2].start, 0.4) && close(alPunct.words[2].end, 0.6),
  JSON.stringify(alPunct.words[2]));

const alSpace = alignWords('这是 Minecraft 里', wAt('这是', 'Minecraft', '里'));
check('alignWords：空白也算"正常差异"（stray 为空）',
  alSpace.ok && alSpace.absorbed === 2 && alSpace.stray === '',
  `absorbed=${alSpace.absorbed} stray=${JSON.stringify(alSpace.stray)}`);

const alStray = alignWords('先看一句话。', wAt('先', '看', '一', '话', '。'));
check('alignWords：跳过了实义字符「句」→ stray 点名它（这才是异常）',
  alStray.ok && alStray.stray === '句' && alStray.absorbed === 1,
  `absorbed=${alStray.absorbed} stray=${JSON.stringify(alStray.stray)}`);
check('alignWords：异常时也拼得回原文（不静默错位）',
  alStray.words.map((w) => w.w).join('') === '先看一句话。', JSON.stringify(alStray.words.map((w) => w.w)));

const alMiss = alignWords('先看一句话。', wAt('先', '听'));
check('alignWords：原文里找不到词 → ok:false（走"不可用"，不静默）',
  !alMiss.ok && /找不到词/.test(alMiss.why ?? ''), alMiss.why ?? '');

// 7.2 端到端：把**缓存里**的词表改成"驱动不报标点"的样子再跑一遍。
//     缓存判据只看 sha1（文本/音色/驱动没变就命中），所以改词表**不会**重新合成 —— 不联网。
const voMp3 = path.join(TASK_DIR, 'audio', 'vo', 'alpha-1.mp3');
const voWordsFile = `${voMp3}.words.json`;
const wordsRaw = JSON.parse(readFileSync(voWordsFile, 'utf8'));   // stub 的逐字符词表（含标点）
const writeVoWords = (list) => writeFileSync(voWordsFile, JSON.stringify(list, null, 1));
const line1Of = (timing) => timing.scenes[0].lines[0];
const runAgain = async () => {
  const out = [];
  const res = await runSay(TASK, { taskDir: TASK_DIR, tts: STUB, noVo: true, log: (...a) => out.push(a.join(' ')) });
  return { log: out.join('\n'), timing: res.timing };
};
/** 真时间戳（句内相对秒）在整片时间的输出里还在不在 */
const timestampsKept = (line, kept) => {
  const off = line.offset;
  return kept.every((w) => line.words.some(
    (o) => Math.abs(o.start - off - w.start) <= 2e-3 && Math.abs(o.end - off - w.end) <= 2e-3,
  ));
};

writeVoWords(wordsRaw.filter((w) => !PUNCT.test(w.w)));           // ← 驱动"不报标点"
const keptPunct = wordsRaw.filter((w) => !PUNCT.test(w.w));
check('（对照）改前的口径下这一句本来会命中',
  keptPunct.map((w) => w.w).join('') !== '第一句。', keptPunct.map((w) => w.w).join(''));
const r7 = await runAgain();
const l7 = line1Of(r7.timing);
check('只差标点 → 不再报警（改前每句一次 → 改后 0 次）',
  !/没对应/.test(r7.log) && !/按顺序对齐/.test(r7.log),
  r7.log.split('\n').find((l) => /没对应|按顺序对齐/.test(l))?.trim() ?? '（日志里没有这条）');
check('读的是改过的缓存词表（0 句新合成）', /（0 句新合成/.test(r7.log));
check('词级时间戳仍然是真的（没退化成按字数近似）',
  l7.words.every((w) => !w.approx) && /4 句真词级时间戳 \/ 0 句按字数近似/.test(r7.log),
  r7.log.split('\n').find((l) => /句真词级时间戳/.test(l))?.trim() ?? '');
check('标点并进相邻词的尾巴 → 拼起来仍等于原文', l7.words.map((w) => w.w).join('') === '第一句。',
  JSON.stringify(l7.words.map((w) => w.w)));
check('驱动给的真时间戳原样还在', timestampsKept(l7, keptPunct), JSON.stringify(l7.words.map((w) => [w.start, w.end])));

// 7.3 真异常：把实义字符「句」从词表里删掉（驱动漏报了一个字）—— 必须照报，而且不许静音成近似。
writeVoWords(wordsRaw.filter((w) => w.w !== '句'));
const r8 = await runAgain();
const l8 = line1Of(r8.timing);
const hitLine = r8.log.split('\n').find((l) => /实义字符没对应/.test(l))?.trim() ?? '（没有报警）';
check('排除标点后仍对不上 → 照报（真异常没被一起静音掉）',
  /实义字符没对应/.test(r8.log) && /"句"/.test(r8.log), hitLine);
check('报警点名到段名 + 第几句（逐句，不再折叠）', /alpha 第 1 句/.test(r8.log), hitLine);
check('真异常时照样保住真时间戳（不退化、拼得回原文）',
  l8.words.every((w) => !w.approx) && l8.words.map((w) => w.w).join('') === '第一句。'
  && timestampsKept(l8, wordsRaw.filter((w) => w.w !== '句')),
  `join=${JSON.stringify(l8.words.map((w) => w.w).join(''))}`);

writeVoWords(wordsRaw);                                           // 还原夹具

/* ── 8) 批量容错：失败也继续 + 最后统一补跑（BACKLOG 1-6） ── */
console.log('\n⑧ 批量容错：中间某句失败也继续、收尾统一补跑、失败句绝不进时长表');

/**
 * 造一个带失败注入的驱动命令。⚠ 缓存判据含**整条驱动命令**（含参数），
 * 所以"成功驱动"与"会失败的驱动"天然是两份不同的缓存，不会互相命中。
 */
const stubWith = (extra = '') => `${STUB} ${extra}`.trim();
// ⚠ 补跑轮数/等待与"同一句两次尝试之间的退避"都是 `say.mjs` **用时现读**的环境变量
//   （默认 2s / 2 轮 / 600ms 退避）。这一节要跑几十次驱动调用，全用默认值会白等好几分钟。
process.env.ANIM_SAY_RETRY_WAIT = '50';
process.env.ANIM_SAY_RETRY_PASS = '2';
process.env.ANIM_SAY_RETRY_BACKOFF = '0';   // 退回退避：这一节要跑几十次"必然失败"的调用
const fileSize = (f) => { try { return statSync(f).size; } catch { return -1; } };
/**
 * 读走 `process.exitCode` 并把它归零 —— 这一节有好几处"预期会失败"的跑，
 * 不归零会把**测试自己**带成非 0 退出（收尾还会按 `fail` 重设一次，见文件末尾）。
 * ⚠ `delete process.exitCode` 在 Node 里会抛 `TypeError`（那个属性不可配置），
 * 只能赋 0；而这恰恰说明**必须**在收尾显式重设，不能指望"没设过就没事"。
 */
const readExitCode = () => { const v = process.exitCode; process.exitCode = 0; return v; };
const says = async (taskDir, tts, extra = {}) => {
  const out = [];
  if (process.env.SAYTEST_DIAG) console.log(`    [diag] tts=${tts}`);
  const res = await runSay(TASK, { taskDir, tts, noVo: true, log: (...a) => out.push(a.join(' ')), ...extra });
  if (process.env.SAYTEST_DIAG) {
    const vo = path.join(taskDir, 'audio', 'vo');
    const counters = existsSync(vo)
      ? readdirSync(vo).filter((f) => f.endsWith('.stub-fails'))
        .map((f) => `${f.slice(0, 5)}:${readFileSync(path.join(vo, f), 'utf8').replace(/\s+/g, '')}`).join(' ')
      : '(没有 vo)';
    console.log(`    [diag] ok=${res.ok} failed=${JSON.stringify(res.failed?.map((p) => p.i + 1))} 表=${existsSync(path.join(taskDir, 'audio', 'timing.json'))} 计数器=${counters}`);
  }
  return { res, log: out.join('\n') };
};
/** 报告里那句"哪几句失败"（`    · [段名] 第 N 句「原句」 —— 原因`），只留"段名 + 第几句" */
const failLines = (log) => log.split('\n').map((l) => /^\s*· \[(.+?)\] 第 (\d+) 句「/.exec(l.trim()))
  .filter(Boolean).map((m) => `${m[1]}#${m[2]}`);

/* 8.0 上游守门是纯函数，直接钉住（BACKLOG 1-6 的硬边界：0 时长绝不当成功） */
const okLine = buildLineResult({ cue: 0, text: 'x' }, 'vo/x.mp3', '.', { dur: 1.25, durFile: 2, words: null, approx: true, cached: false });
check('buildLineResult：正常结果折算成 timing 的那条记录',
  okLine.ok === true && okLine.line.dur === 1.25 && okLine.line.durFile === 2,
  JSON.stringify(okLine.line));
check('buildLineResult：dur=0 一律当失败（不许当成"合成了一句空话"）',
  buildLineResult({ cue: 0, text: 'x' }, 'vo/x.mp3', '.', { dur: 0 }).ok === false);
check('buildLineResult：NaN / undefined 也一律当失败',
  buildLineResult({ cue: 0, text: 'x' }, 'vo/x.mp3', '.', { dur: NaN }).ok === false
  && buildLineResult({ cue: 0, text: 'x' }, 'vo/x.mp3', '.', {}).ok === false);
check('buildLineResult：驱动判失败时原样带出原因（不再从异常里抠）',
  buildLineResult({ cue: 0, text: 'x' }, 'vo/x.mp3', '.', { failed: true, reason: 'TTS 合成失败（exit 4）' }).reason.includes('exit 4'));

/* 8.1 缓存预热：4 句都成功，表写出来 —— 之后失败的那一轮要证明"表没被改写" */
const BATCH_DIR = mkBatchTask(
  path.join(os.tmpdir(), 'anim-saytest-batch'),
  ONE_SCENE_4(BATCH_TEXTS),
);
const warm = await says(BATCH_DIR, STUB);
const timingBefore = readFileSync(path.join(BATCH_DIR, 'audio', 'timing.json'), 'utf8');
const voOf = (dir, n) => path.join(dir, 'audio', 'vo', `one-${n}.mp3`);
check('（预热）4 句全部合成、表写出来了',
  warm.res.ok === true && warm.res.timing.scenes[0].lines.length === 4
  && warm.res.timing.scenes[0].lines.every((l) => l.dur > 0),
  `durs=${warm.res.timing.scenes[0].lines.map((l) => l.dur).join('/')}`);

/* 8.2 B2 反复失败 ⇒ 其余 3 句照样合成完、收尾点名、退出码 1、表不动 */
rmSync(voOf(BATCH_DIR, 2), { force: true });
const failRun = await says(BATCH_DIR, stubWith('--fail B2'));
const exitFlagged = readExitCode();
check('失败句不影响别人：其余 3 句照样合成完（音频在、时长 > 0）',
  [1, 3, 4].every((n) => fileSize(voOf(BATCH_DIR, n)) > 1000)
  && failRun.res.timing === null && failRun.res.failed?.length === 1,
  `sizes=${[1, 3, 4].map((n) => fileSize(voOf(BATCH_DIR, n))).join('/')} failed=${failRun.res.failed?.length}`);
check('返回 ok:false + failed 列表点名到"段名 + 第几句"',
  failRun.res.ok === false && failRun.res.failed?.[0]?.sc === 'one' && failRun.res.failed?.[0]?.i === 1,
  JSON.stringify(failRun.res.failed?.map((p) => [p.sc, p.i + 1, p.text])));
// 同一句失败会在**每一个阶段**各报一次（批量那一遍跑完、每轮补跑结束、收尾），
// 所以判据是"报出来的永远是同一句"，而不是"只报一次"。
check('收尾统一报告"哪几句失败"（段名 + 第几句 + 原句）：批量跑完 / 每轮补跑 / 收尾都点名这一句',
  failLines(failRun.log).length >= 2 && failLines(failRun.log).every((x) => x === 'one#2')
  && /B2/.test(failRun.log),
  `报到 ${failLines(failRun.log).length} 次：${[...new Set(failLines(failRun.log))].join(' / ')}`);
check('退出码非 0（process.exitCode=1；断言完就 delete，免得把测试自己带成非 0）',
  failRun.res.ok === false && exitFlagged === 1, `exitCode=${exitFlagged}`);
check('报告开头说清"整批先跑完了、再统一补跑"',
  /整批先跑完/.test(failRun.log) && /统一补跑/.test(failRun.log),
  failRun.log.split('\n').find((l) => /统一补跑/.test(l))?.trim() ?? '');
check('失败句**不进时长表** —— timing.json / timing.mjs / narration.json 一个字节都没动',
  readFileSync(path.join(BATCH_DIR, 'audio', 'timing.json'), 'utf8') === timingBefore,
  `大小 ${fileSize(path.join(BATCH_DIR, 'audio', 'timing.json'))}`);
check('没有伪造的 0 时长行：失败句在被拦住的那一份表里根本没有',
  !JSON.parse(timingBefore).scenes[0].lines.some((l) => !(l.dur > 0)));
check('明确说了"表没动"以及"重跑只补失败的"',
  /时长表\*\*没有\*\*动/.test(failRun.log) && /重跑/.test(failRun.log));
check('失败那条的 0 字节残骸没被留下（不会污染下一次判断）',
  fileSize(voOf(BATCH_DIR, 2)) === -1 || fileSize(voOf(BATCH_DIR, 2)) > 1000,
  `size=${fileSize(voOf(BATCH_DIR, 2))}`);
// ⚠ 回归：一句的**偶发**失败不该把后面所有句的词级时间戳一起废掉。
//   从前 `--write-words` 一失败就退回 `attempt(false,…)` 并把 `driver.words` 永久置 false ——
//   注释明说"偶发失败不该永久降级"，代码做的却是永久降级（做这一条时抓出来的）。
//   判据：失败那一遍里**没有**任何一句退化成"按字数近似"。
check('偶发失败不残害别人：失败那一遍里没有一句被静默降级成"按字数近似"',
  /按字数近似/.test(failRun.log) === false
  && warm.res.timing.scenes[0].lines.every((l) => (l.words ?? []).every((w) => !w.approx)),
  failRun.log.split('\n').find((l) => /按字数近似/.test(l))?.trim() ?? '（没有出现"近似"）');

/* 8.3 0 字节那种失败：驱动退出码 0、却写出 0 字节 —— 绝不当成功，也绝不进表 */
rmSync(voOf(BATCH_DIR, 3), { force: true });
const zero = await says(BATCH_DIR, stubWith('--fail B3 --fail-cmd zeroremaining'));
readExitCode();                                   // 同样立刻清掉，别留给测试收尾
check('0 字节（退出码 0）也算失败：照样报出来，没被当成成功的一句',
  zero.res.ok === false && zero.res.failed?.length === 1 && /B3/.test(zero.log),
  zero.res.failed?.[0]?.reason?.split('\n').filter(Boolean).slice(-1)[0] ?? '');
check('0 字节那一句同样没混进表（时序表原样）',
  readFileSync(path.join(BATCH_DIR, 'audio', 'timing.json'), 'utf8') === timingBefore);

/* 8.4 统一补跑：4 句在批量那一遍全失败，收尾补跑把**全部**救回来 ⇒ 整批照常出表 */
const RECOVER_DIR = mkBatchTask(
  path.join(os.tmpdir(), 'anim-saytest-batch-recover'),
  ONE_SCENE_4(BATCH_TEXTS),
);
// ⚠ `--fail-n N` 数的是**驱动被调用的次数**，一条句子在批量那一遍最多被调 5 次
//   （`synthLine()`：3 次带词表 + 2 次重试），所以 `--fail-n 5` = "整批那一遍 4 句全失败、
//   收尾补跑的第 1 次调用必成功"（实测计数器收在 6）。这个数字是量出来的，不是凑的。
const rec = await says(RECOVER_DIR, `${STUB} --fail B --fail-n 5`);
const recExit = readExitCode();
check('整批跑完之后，补跑把失败的 4 句**全部**救回来',
  /补跑成功：one 第 4 句/.test(rec.log) && rec.res.ok === true && rec.res.failed === undefined,
  rec.log.split('\n').find((l) => /轮补跑/.test(l))?.trim() ?? '(没有补跑)');
check('补跑是"只补失败的那几句"：每轮都报告修好几句、还剩几句',
  /第 1 轮补跑：修好 4 句，还剩 0 句/.test(rec.log),
  rec.log.split('\n').find((l) => /轮补跑/.test(l))?.trim() ?? '');
check('确实有句子走到了补跑（不是第一遍就成功）',
  (rec.res.retryPasses ?? 0) >= 1, `retryPasses=${rec.res.retryPasses}`);
check('补跑救回来之后退出码恢复正常（不是"失败也继续"就一律置 1）', recExit === 0, `exit=${recExit}`);

/* 8.5 补跑也救不回来 ⇒ 那句照样点名、表不写、退出码 1（"失败也继续"的另一半） */
const STUCK_DIR = mkBatchTask(
  path.join(os.tmpdir(), 'anim-saytest-batch-stuck'),
  ONE_SCENE_4(BATCH_TEXTS),
);
// ⚠ 这里用**字面量**匹配（`--fail "B2 戊"`，不带 `--fail-n` ⇒ always），不用计数器：
//   "前 N 次失败"的计数器在**这一句成功之后就被永久跨过**了（它记的是"被调用过几次"），
//   拿它做"永远失败"会变成"第 6 次起永远成功"（踩过：批量那一遍直接过了，测试全反过来）。
// 只有 B2 会失败、另 3 句正常合成完 ⇒ 正是"一句话拖住整批"的那个场景。
const STUCK_CMD = `${STUB} --fail "B2 戊"`;
const stuck = await says(STUCK_DIR, STUCK_CMD);
const stuckExit = readExitCode();
check('救不回来的那一句：返回 ok:false + failed 点名到"段名 + 第几句"',
  stuck.res.ok === false && stuck.res.failed?.length === 1 && stuck.res.failed[0].i === 1,
  JSON.stringify(stuck.res.failed?.map((p) => [p.sc, p.i + 1])));
check('收尾同时说清"哪句没成"与"这次补跑一句都没修好"，退出码 1',
  new RegExp(`\\[one\\] 第 2 句「${BATCH_TEXTS[1]}」`).test(stuck.log)
  && /这次补跑修好 0 句/.test(stuck.log)
  && stuckExit === 1,
  `${stuck.log.split('\n').find((l) => /没合成出来/.test(l))?.trim() ?? '(没有收尾报告)'} exit=${stuckExit}`);

// 直接**重跑同一条命令**：只有失败的那句会重新合成，成功的那 3 句不许再碰一次。
// ⚠ 驱动命令必须**一模一样**（sha1 缓存把整条驱动命令算进 key）：换一条命令等于让整个缓存失效，
//   那测的就不是"重跑"了（第一版就写错了，4 句全部重合成）。
check('（前置）第一次跑：3 句成功、B2 失败、表没写出来',
  stuck.res.ok === false && stuck.res.failed?.length === 1
  && !existsSync(path.join(STUCK_DIR, 'audio', 'timing.json')),
  `sizes=${[1, 3, 4].map((n) => fileSize(voOf(STUCK_DIR, n))).join('/')}`);
const voBefore = [1, 3, 4].map((n) => readFileSync(voOf(STUCK_DIR, n), 'utf8'));
const again = await says(STUCK_DIR, STUCK_CMD);
const againExit = readExitCode();
const voAfter = [1, 3, 4].map((n) => readFileSync(voOf(STUCK_DIR, n), 'utf8'));
// ⚠ 失败那一批**不会**打"（N 句新合成…）"那行（那是成功收尾才有的），所以判据不能靠它 ——
//   直接看"成功过的三句音频有没有被动过"更硬，也正是"重跑很便宜"这件事的本体。
check('重跑只碰失败的那句：成功过的 3 句音频字节不变（缓存命中、没有重合成）',
  voBefore.every((b, i) => b === voAfter[i]) && !/句新合成/.test(again.log),
  `字节相同=${voBefore.every((b, i) => b === voAfter[i])} 成功收尾行=${/句新合成/.test(again.log)}`);
check('两次跑都没写出表（失败的那句始终没被放行），退出码都是 1，失败清单都是那一句',
  !existsSync(path.join(STUCK_DIR, 'audio', 'timing.json'))
  && again.res.ok === false && again.res.failed?.length === 1
  && stuckExit === 1 && againExit === 1,
  `exit=${stuckExit}/${againExit}`);

/* 8.6 补跑全成功 ⇒ 产物与"第一次就成功"的那一份逐字段一致（顺序/时长都没错位） */
const RECOVER2_DIR = mkBatchTask(
  path.join(os.tmpdir(), 'anim-saytest-batch-recover2'),
  ONE_SCENE_4(BATCH_TEXTS),
);
// 同样要 `--fail-n 5`：一条句子在批量那一遍**总共**只有 5 次机会（`MAX_TRIES_PER_LINE`），
// 要让它彻底失败、掉进补跑，就得正好把这 5 次用光。
const rec2 = await says(RECOVER2_DIR, `${STUB} --fail B --fail-n 5`);
const rec2Exit = readExitCode();
const tRec2 = rec2.res.timing;
check('补跑全成功 ⇒ 4 句一句不少、时长都是正数、表照常写出、退出码 0',
  rec2.res.ok === true && !!tRec2 && rec2Exit === 0 && tRec2.scenes[0].lines.length === 4
  && tRec2.scenes[0].lines.every((l) => l.dur > 0),
  `durs=${tRec2?.scenes[0].lines.map((l) => l.dur).join('/')} exit=${rec2Exit} retryPasses=${rec2.res.retryPasses} repaired=${rec2.res.repaired}`);
check('补跑成功不悄悄吞掉：收尾那行说明几句是补跑救回来的',
  /其中 4 句是收尾补跑救回来的/.test(rec2.log),
  rec2.log.split('\n').find((l) => /句新合成/.test(l))?.trim() ?? '(没有这一行)');
check('救回来的那一份产物与"第一次就成功"的那一份逐字段一致（顺序/时长都没错位）',
  !!tRec2 && close(tRec2.total, warm.res.timing.total, 1e-6)
  && tRec2.scenes[0].lines.every((l, i) => close(l.dur, warm.res.timing.scenes[0].lines[i].dur, 1e-6)
    && l.text === BATCH_TEXTS[i]),
  `${tRec2?.total} vs ${warm.res.timing.total}`);

/* 8.7 全成功 ⇒ 与现在逐字一致：两遍日志**逐行**相同（补跑那一层是全哑的） */
const QUIET_DIR = mkBatchTask(
  path.join(os.tmpdir(), 'anim-saytest-batch-quiet'),
  ONE_SCENE_4(BATCH_TEXTS),
);
await says(QUIET_DIR, STUB);                    // 先把缓存填满
const quiet1 = await says(QUIET_DIR, STUB);
await says(QUIET_DIR, STUB);
const quiet2 = await says(QUIET_DIR, STUB);
/**
 * "逐字一致"怎么读得出来：
 *   · `✓` 那行带绝对路径、`已写出` 那行带句数 —— 这两行本来就随环境/句数变，剔掉；
 *   · 其余每一行都必须**一模一样**（新加的输出词一个都不许出现）。
 */
const stableLog = (s) => s.split('\n').filter((l) => !/[（(]\d+ 句新合成/.test(l) && !l.startsWith('✓ '));
const extraLines = stableLog(quiet2.log).filter((l) => !stableLog(quiet1.log).includes(l));
check('全成功时两遍日志逐行一致（这一层在全成功时是全哑的，不许多打任何一行）',
  extraLines.length === 0, extraLines.join(' | ') || '（逐行相同）');
check('那两遍里也没有"补跑 / 失败"这类词',
  !/补跑|失败|没合成/.test(quiet1.log) && !/补跑|失败|没合成/.test(quiet2.log),
  quiet2.log.split('\n').find((l) => /补跑|失败|没合成/.test(l))?.trim() ?? '（干净）');
check('缓存全命中：0 句新合成，而且说得和从前一样',
  /（0 句新合成，4 句真词级时间戳 \/ 0 句按字数近似）/.test(quiet2.log),
  quiet2.log.split('\n').find((l) => /句新合成/.test(l))?.trim() ?? '');

/* ── 收尾 ── */
console.log(`\n${'─'.repeat(60)}\n通过 ${pass}/${pass + fail}${fail ? `　❌ 失败 ${fail}` : '　✅ 全部通过'}`);
console.log(`夹具在 ${TASK_DIR}（临时目录，复跑会用同一份；删掉它也不影响）`);
// 显式重设退出码：§8 里那些"预期失败"的跑会设过 `process.exitCode = 1`（标着 `ok:false` 返回），
// 不在这里按结论重设，"全绿"也会以 1 退出（第一版就是）。
process.exitCode = fail ? 1 : 0;
