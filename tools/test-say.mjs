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
 *
 * ⚠ 这个脚本的夹具任务建在**系统临时目录**里（不是 `tasks/`）：这样它跟正在跑的渲染
 *   完全互不干扰 —— 往仓库里写文件会让私有 Vite 的文件监听撞上 EBUSY 而崩掉（已实测）。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeChannels, encodeMp3, writeWav16 } from '../scripts/lib/media.mjs';
import { runSay, solveTiming } from '../scripts/lib/say.mjs';
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

/* ── 收尾 ── */
console.log(`\n${'─'.repeat(60)}\n通过 ${pass}/${pass + fail}${fail ? `　❌ 失败 ${fail}` : '　✅ 全部通过'}`);
console.log(`夹具在 ${TASK_DIR}（临时目录，复跑会用同一份；删掉它也不影响）`);
process.exit(fail ? 1 : 0);
