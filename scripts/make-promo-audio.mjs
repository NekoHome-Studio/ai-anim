#!/usr/bin/env node
// @ts-check
/**
 * 生成 promo（48 秒一镜到底宣传片）的音乐床：纯合成 / 无版权 / 确定性。
 *
 *   node scripts/make-promo-audio.mjs            # 出 tasks/promo/audio/bed.wav + bed.mp3
 *   node scripts/make-promo-audio.mjs --check    # 出完之后再解码回来量一遍（拍子/小节/RMS 表）
 *   node scripts/make-promo-audio.mjs --debug    # 顺带把每条总线（kick/drum/tone/boom）的电平打出来
 *   node scripts/make-promo-audio.mjs --no-mp3   # 只要 wav
 *   node scripts/make-promo-audio.mjs <路径.wav> # 换个输出位置
 *
 * 铁律（和 scripts/make-demo-audio.mjs 一样）：**不许用 Math.random()**。
 * 这里所有噪声都来自 xorshift32 —— 同一个 seed 永远给同一串数。
 * 于是同一条命令跑两次，产出的 wav **逐字节相同**（用 Get-FileHash 复核）。
 *
 * ── 规格 ──────────────────────────────────────────────────────────────
 * 48.000s / 44100Hz / 立体声 / 16bit PCM / 120bpm（一拍 0.5s，一小节 2.0s，24 小节）。
 * A 小调，root A1 = 55Hz，bass 走简谱（和弦音索引，不写死半音，换和弦不会跑调）。
 *
 * ── 编排（必须和 task.config.mjs 的六段画面切点对齐）──────────────────
 *  小节      时间       画面                        音乐
 *  0–2     0–6s      段1 caret 光标打字（黑场）   只有 kick（每拍）+ 很轻的 pad 长音；安静
 *  3       6.0s      段2 code 爆冲进代码走廊      ★ hat + bass 正好在 6.0 进来 + boom/吊镲
 *  4–6     8–14s     走廊（持续加速）            逐步加东西；snare 在 2、4 拍
 *  7      14–16s     走廊末                      上行噪声 riser（把观众推到门口）
 *  8      16.0s      段3 engine 穿门 → SDF 大厅  ★ 全奏 + 一记 sub boom + 吊镲
 *  9–12   18–26s     大厅                        pad 和弦铺满，稳定
 *  13     26.0s      段4 lattice 坠入晶格隧道    ★ 十六分 hat + 高音 arp 进 + 第二记 boom
 *  14–17  28–36s     俯冲                        最高能量；中频让一点位给画面
 *  18–19  36–40s     段5 frames 拉远 / 帧墙      ★ 36.0 抽掉 hat 与 arp，只留 kick + pad
 *  20     40–42s     重新 build                  上行噪声 riser
 *  21     42.0s      段6 title 落版（片名浮出）   ★ 一记大重击 + 和弦 + 长吊镲
 *  22–23  44–48s     光标停住                    吊镲/pad 尾巴，46.0–48.0 淡出到绝对静音
 *
 * ★ = 画面切点。24 小节 × 2.0s 正好铺满 48s，所以每个切点都落在**整小节线、也是整拍**上：
 *     6.0s = 第 12 拍 / 第 3 小节，16.0s = 第 32 拍 / 第 8 小节，26.0s = 第 52 拍 / 第 13 小节，
 *     36.0s = 第 72 拍 / 第 18 小节，42.0s = 第 84 拍 / 第 21 小节。
 *     `--check` 会把这条逐点核对一遍（在拍上 + 编排确实在这里转折）。
 *
 * ── 怎么保证「测得出 120bpm」────────────────────────────────────────
 * 1) kick 落在**每一拍**上（含 0.0s 那一拍），一拍不多一拍不少，共 96 记；
 * 2) kick 的瞬态干净：音高从 162Hz 快速下滑到 47Hz + 一记很短的 1.25kHz click，
 *    低音 bus（bass/pad/boom）全部按 kick 做**侧链闪避**，低频不会糊掉那个起音；
 * 3) kick 走中心声道（L=R），相位一致，不会因为立体声而抵消。
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ 常量 */

const SR = 44100;
const BPM = 120;
const BEAT = 60 / BPM;            // 0.5s
const BAR = BEAT * 4;             // 2.0s
const BARS = 24;
const SECONDS = BARS * BAR;       // 48.0s
const N = Math.round(SECONDS * SR);   // 2116800 —— 正好 48.000s
const FADE_FROM = 46.0;           // 最后 2 秒淡出到绝对静音（48.0s 处 = 0）
const ROOT_HZ = 55;               // A1

/** 一小节一个和弦：半音相对 A1。pad / bass / arp 都从这里取音。 */
const CHORDS = /** @type {[number, number, number][]} */ ([
  [0, 3, 7],      //  0  Am   0–6s   黑场 · 光标打字（静止）
  [0, 3, 7],      //  1  Am
  [-4, 0, 3],     //  2  F    开始有变化，预告要出发
  [-2, 2, 5],     //  3  G    ← 6.0s 爆冲进代码走廊（bVII，冲出去的开阔感）
  [0, 3, 7],      //  4  Am   8.0s snare 进（逐步加东西）
  [-4, 0, 3],     //  5  F
  [3, 7, 10],     //  6  C
  [-2, 2, 5],     //  7  G    14–16s：riser 之下把观众推到门口
  [0, 3, 7],      //  8  Am   ← 16.0s 穿门 → SDF 大厅（主和弦落地 + sub boom）
  [-4, 0, 3],     //  9  F
  [3, 7, 10],     // 10  C
  [-2, 2, 5],     // 11  G
  [0, 3, 7],      // 12  Am   24–26s：大厅收在主和弦
  [-4, 0, 3],     // 13  F    ← 26.0s 坠入晶格（bVI，往下坠）+ 16 分 hat + arp + boom
  [3, 7, 10],     // 14  C
  [-2, 2, 5],     // 15  G
  [0, 3, 7],      // 16  Am
  [4, 8, 11],     // 17  E    34–36s：属和弦，把俯冲的张力拉满
  [0, 3, 7],      // 18  Am   ← 36.0s 拉远 / 帧墙（抽掉 hat 与 arp，世界安静下来）
  [-4, 0, 3],     // 19  F
  [4, 8, 11],     // 20  E    40–42s：重新 build（属和弦顶到落版）
  [0, 3, 7],      // 21  Am   ← 42.0s 落版 · 大重击 + 和弦（片名浮出）
  [0, 3, 7],      // 22  Am   吊镲/pad 尾巴
  [0, 3, 7],      // 23  Am   46.0–48.0 淡出到绝对静音
]);

/**
 * 画面切点（= tasks/promo/task.config.mjs 的六段时间线）。
 * 24 小节 × 2.0s，所以每个切点都应该是**整小节线、也是整拍**，而且编排必须在这里转折。
 */
const CUTS = [
  { t: 0.0, scene: 'caret   光标打字（黑场）' },
  { t: 6.0, scene: 'code    爆冲进代码走廊' },
  { t: 16.0, scene: 'engine  穿门 → SDF 大厅' },
  { t: 26.0, scene: 'lattice 坠入晶格隧道（俯冲）' },
  { t: 36.0, scene: 'frames  拉远 / 帧墙' },
  { t: 42.0, scene: 'title   落版（片名浮出）' },
];

/**
 * bass 的根音（半音相对 A1）。刻意把 F/C/G/E 抬高一个八度，
 * 让 bass 落在 55–98Hz —— 再低就会跟 kick 的尾巴抢，低频一糊节拍就测不准。
 */
const BASS_ROOT = [
  0, 0, 8, 10,      // 0–3   Am Am F  G   ← 6.0s 在 G 上爆冲
  0, 8, 3, 10,      // 4–7   Am F  C  G   ← 14–16s riser 之下推向门口
  0, 8, 3, 10, 0,   // 8–12  Am F  C  G  Am  ← 16.0s 门开落在主和弦
  8, 3, 10, 0, 7,   // 13–17 F  C  G  Am E  ← 26.0s 俯冲，34–36s 属和弦拉满
  0, 8,             // 18–19 Am F  ← 36.0s 抽掉 hat/arp，安静
  7,                // 20    E    ← 40–42s riser 顶到落版
  0,                // 21    Am   ← 42.0s 大重击（主和弦解决）
  0, 0,             // 22–23 Am   ← 尾巴 + 淡出
];

/**
 * 段落名（只用来选编排，不影响音高）。每一段都从画面的切点开始：
 * bar 0=0.0s / 3=6.0s / 8=16.0s / 13=26.0s / 18=36.0s / 20=40.0s / 21=42.0s。
 */
const SECTION_OF = [
  'intro', 'intro', 'intro',              //  0–2   0–6s   黑场 · 光标打字
  'launch',                               //  3     6.0s   ← 爆冲：hat + bass 进来
  'drive', 'drive', 'drive',              //  4–6   8–14s  走廊，逐步加东西
  'driveBuild',                           //  7    14.0s   ← 上行 riser 推到门口
  'hall', 'hall', 'hall', 'hall', 'hall', //  8–12 16–26s  穿门 → SDF 大厅，pad 铺满、稳定
  'dive', 'dive', 'dive', 'dive', 'dive', // 13–17 26–36s  坠入晶格，全片最高能量
  'frames', 'frames',                     // 18–19 36–40s  ← 36.0s 抽 hat/arp，世界安静下来
  'build',                                // 20   40–42s  ← 重新 build
  'title',                                // 21   42.0s   ← 落版：大重击 + 和弦
  'outro', 'outro',                       // 22–23 44–48s  吊镲/pad 尾巴 + 淡出
];

/** kick 力度：黑场收着，中段打满。 */
const KICK_VEL = {
  intro: 0.86, launch: 0.96, drive: 0.96, driveBuild: 1.0, hall: 1.0,
  dive: 1.0, frames: 0.94, build: 1.0, title: 1.0, outro: 0.86,
};

/**
 * bass 节奏型：[小节内第几拍, 和弦音索引(3=根音高八度), 时值(拍)]。
 * ⚠ 键必须**逐个**和 SECTION_OF 里的段落名对齐 —— 少一个键就等于那一段没有 bass
 * （`if (BASS_PATTERN[S])` 是静默跳过的，不会报错）。
 */
const BASS_PATTERN = {
  launch: [[0, 0, 0.9], [1.5, 0, 0.4], [2, 2, 0.9], [3, 1, 0.4]],
  drive: [[0, 0, 0.45], [1, 0, 0.45], [1.5, 2, 0.45], [2, 0, 0.45], [3, 0, 0.45], [3.5, 2, 0.45]],
  driveBuild: [[0, 0, 0.45], [0.5, 0, 0.45], [1, 0, 0.45], [1.5, 2, 0.45],
               [2, 0, 0.45], [2.5, 0, 0.45], [3, 2, 0.45], [3.5, 3, 0.45]],
  hall: [[0, 0, 0.45], [0.5, 0, 0.45], [1, 0, 0.45], [1.5, 2, 0.45],
         [2, 0, 0.45], [2.5, 0, 0.45], [3, 2, 0.45], [3.5, 3, 0.45]],
  dive: [[0, 0, 0.45], [0.5, 0, 0.45], [1, 0, 0.45], [1.5, 2, 0.45],
         [2, 0, 0.45], [2.5, 0, 0.45], [3, 2, 0.45], [3.5, 1, 0.45]],   // 不用 +12 度：那音的三次谐波正好落在中频
  title: [[0, 0, 1.9]],
};

/** bass 的段落增益（26–36s 顶到全片最高能量；俯冲靠低音补，不靠中频）。 */
const BASS_GAIN = {
  launch: 0.88, drive: 0.92, driveBuild: 1.0, hall: 1.04, dive: 1.30, title: 1.15,
};

/** pad 增益（黑场「很轻」，大厅「铺满」，俯冲最厚）。 */
const PAD_GAIN = {
  intro: 0.062, launch: 0.10, drive: 0.125, driveBuild: 0.13, hall: 0.165,
  dive: 0.215, frames: 0.14, build: 0.125, title: 0.21, outro: 0.16,
};

// 段落表是手写的，很容易漏一个键 —— 这里直接对一遍。
// 漏了 BASS_PATTERN 的键不会报错，只会让那一段**静默地没有 bass**（这个坑踩过一次）。
for (const s of new Set(SECTION_OF)) {
  if (!(s in PAD_GAIN)) throw new Error(`PAD_GAIN 少了段落 "${s}"`);
  if (!(s in KICK_VEL)) throw new Error(`KICK_VEL 少了段落 "${s}"`);
  if (['intro', 'frames', 'build', 'outro'].includes(s)) continue;   // 这几段本来就刻意没有 bass
  if (!(s in BASS_PATTERN)) throw new Error(`BASS_PATTERN 少了段落 "${s}"`);
  if (!(s in BASS_GAIN)) throw new Error(`BASS_GAIN 少了段落 "${s}"`);
}

/* ------------------------------------------------------- 确定性噪声 / PRNG */

/**
 * xorshift32。同一个 seed 永远给同一串 −0.5…0.5 的数。
 * 每条声部一条独立流，加一条声部不会把别的声部的噪声挪位。
 */
function makeNoise(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296 - 0.5;
  };
}

const nz = {
  hat: makeNoise(0x1a2b3c4d),
  snare: makeNoise(0x2b3c4d5e),
  crashL: makeNoise(0x3c4d5e6f),
  crashR: makeNoise(0x4d5e6f70),
  riserL: makeNoise(0x5e6f7081),
  riserR: makeNoise(0x6f708192),
};

/* ------------------------------------------------------------ 总线与工具 */

/** @typedef {{ L: Float32Array, R: Float32Array }} Bus */
/** @returns {Bus} */
const makeBus = () => ({ L: new Float32Array(N), R: new Float32Array(N) });

const bus = {
  kick: makeBus(),   // 打击乐：不受侧链影响
  drum: makeBus(),   // hat / snare / crash
  tone: makeBus(),   // bass / pad / arp / riser —— 按 kick 闪避
  boom: makeBus(),   // sub boom —— 单独一条，闪避更浅
};

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const semiHz = (semi) => ROOT_HZ * 2 ** (semi / 12);
/** 和弦音索引 → 半音（0/1/2 原位，3/4/5 高八度）。 */
const chordTone = (chord, i) => chord[i % 3] + Math.floor(i / 3) * 12;

/* ------------------------------------------------------------------ 音色 */

/** kick：音高下滑正弦 × 指数衰减 + 一记很短的 click（瞬态要干净）。 */
function addKick(b, t0, gain, click = 0.16) {
  const dur = 0.42;
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const idx = i0 + i;
    const t = i / SR;
    const f = 47 + 115 * Math.exp(-t * 30);            // 162 → 47Hz
    ph += (2 * Math.PI * f) / SR;                      // 相位累加，扫描才顺
    const body = Math.sin(ph) * Math.exp(-t * 7.0);
    const clk = Math.sin(2 * Math.PI * 1250 * t) * Math.exp(-t * 320) * click;
    const v = (body * 0.95 + clk) * (1 - Math.exp(-t * 2500)) * gain;
    if (idx < 0 || idx >= N) continue;
    b.L[idx] += v; b.R[idx] += v;                      // 走中心：低频不抵消
  }
}

/**
 * hat：高通噪声 × 短指数衰减（和参考实现同构）。
 * `air` 0→1 把高通从一阶换成二阶（再亮 6dB/oct）：16–19 小节用它把能量推出中频。
 */
function addHat(b, t0, gain, dur = 0.045, air = 0) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let w1 = 0, w2 = 0;
  for (let i = 0; i < len; i++) {
    const w = nz.hat();
    const h1 = w - w1, h2 = w - 2 * w1 + w2; w2 = w1; w1 = w;
    const hp = h1 * (1 - air) + h2 * air * 0.8;
    const idx = i0 + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const v = hp * Math.exp(-t * 95) * 0.34 * gain;
    b.L[idx] += v * 0.82; b.R[idx] += v;               // 偏右一点，别跟 kick 抢中间
  }
}

/** snare：噪声 + 185Hz 音体。 */
function addSnare(b, t0, gain, dur = 0.20) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  for (let i = 0; i < len; i++) {
    const w = nz.snare();
    const idx = i0 + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const env = (1 - Math.exp(-t * 700)) * Math.exp(-t * 22);
    const v = (w * 1.7 + Math.sin(2 * Math.PI * 185 * t) * 0.42) * env * gain;
    b.L[idx] += v * 0.94; b.R[idx] += v;
  }
}

/** 吊镲：两级高通噪声（左右各一条流）+ 一组非谐分音。 */
function addCrash(b, t0, gain, dur = 3.0) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const partials = [1, 1.41, 1.93, 2.61, 3.37, 4.29];
  const base = 2650;
  const decay = 1.6 * (3.0 / dur);
  // 两级差分 = 二阶高通。写成显式的前两个采样（不要拿上一次的差分去递归，
  // 那是个 z=-1 的极点，噪声会随机游走到 80 倍上去 —— 踩过这个坑）。
  let wL1 = 0, wL2 = 0, wR1 = 0, wR2 = 0;
  for (let i = 0; i < len; i++) {
    const wL = nz.crashL(), wR = nz.crashR();
    const hL1 = wL - wL1, hL2 = wL - 2 * wL1 + wL2; wL2 = wL1; wL1 = wL;
    const hR1 = wR - wR1, hR2 = wR - 2 * wR1 + wR2; wR2 = wR1; wR1 = wR;
    const idx = i0 + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const env = (1 - Math.exp(-t * 420)) * Math.exp(-t * decay);
    let met = 0;
    for (let k = 0; k < partials.length; k++) {
      met += Math.sin(2 * Math.PI * base * partials[k] * t + k * 1.7) * Math.exp(-t * (2.2 + k * 0.7));
    }
    met /= partials.length;
    // 一阶差分给「体」，二阶差分给「嘶」—— 只用二阶的话波峰因数太高，会独吞动态余量
    const g = env * gain;
    b.L[idx] += (hL1 * 0.50 + hL2 * 0.40 + met * 0.50) * g;
    b.R[idx] += (hR1 * 0.50 + hR2 * 0.40 + met * 0.50) * g;
  }
}

/** bass：简谱音，基频 + 两个谐波，方波感的软起音。 */
function addBass(b, t0, semi, dur, gain) {
  const f = semiHz(semi);
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  for (let i = 0; i < len; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const env = Math.min(1, t / 0.010) * clamp((dur - t) / 0.05, 0, 1) * (0.72 + 0.28 * Math.exp(-t * 7));
    const v = (Math.sin(2 * Math.PI * f * t) + 0.30 * Math.sin(4 * Math.PI * f * t)
             + 0.10 * Math.sin(6 * Math.PI * f * t)) * env * 0.42 * gain;
    b.L[idx] += v; b.R[idx] += v;                      // 低音也走中心
  }
}

/** pad：失谐正弦堆，慢起慢落。 */
function addPad(b, t0, dur, chord, octave, gain, attack = 0.45, release = 0.55) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const freqs = [];
  for (let k = 0; k < chord.length; k++) {
    const f = semiHz(chord[k] + octave);
    freqs.push(f * 0.9984, f * 1.0018);                // 每条音两个失谐副本
  }
  for (let i = 0; i < len; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const env = Math.min(1, t / attack) * clamp((dur - t) / release, 0, 1);
    let v = 0;
    for (let k = 0; k < freqs.length; k++) {
      const d = 1 + 0.0012 * Math.sin(2 * Math.PI * (0.17 + k * 0.05) * t);
      v += Math.sin(2 * Math.PI * freqs[k] * d * t + k * 0.9);
    }
    v = (v / freqs.length) * env * gain;
    const sw = Math.sin(2 * Math.PI * 0.11 * t);
    b.L[idx] += v * (0.88 + 0.12 * sw);
    b.R[idx] += v * (0.88 - 0.12 * sw);
  }
}

/** arp：高音拨弦（快速起音 + 指数衰减），左右来回摆。 */
function addArp(b, t0, semi, dur, gain, pan) {
  const f = semiHz(semi);
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const gl = Math.cos(pan * Math.PI * 0.5), gr = Math.sin(pan * Math.PI * 0.5);
  for (let i = 0; i < len; i++) {
    const idx = i0 + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const env = (1 - Math.exp(-t * 900)) * Math.exp(-t * 15);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(4 * Math.PI * f * t)
             + 0.08 * Math.sin(6 * Math.PI * f * t)) * env * gain;
    b.L[idx] += v * gl; b.R[idx] += v * gr;
  }
}

/** sub boom：深沉的重击。起音 14ms（够沉，又不抢 kick 的瞬态）。 */
function addBoom(b, t0, gain, f0 = 46, f1 = 31, dur = 2.2) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const idx = i0 + i;
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t * 4);
    ph += (2 * Math.PI * f) / SR;
    const env = (1 - Math.exp(-t * 70)) * Math.exp(-t * 1.5);
    const v = (Math.sin(ph) + 0.20 * Math.sin(2 * ph) + 0.07 * Math.sin(3 * ph)) * env * gain;
    if (idx < 0 || idx >= N) continue;
    b.L[idx] += v; b.R[idx] += v;
  }
}

/** 上行噪声 riser：噪声过一档谐振带通，中心频率指数上行 + 加速颤音。 */
function addRiser(b, t0, dur, gain, f0 = 280, f1 = 8200, Q = 2.4) {
  const i0 = Math.round(t0 * SR);
  const len = Math.round(dur * SR);
  const q = 1 / Q;
  let lowL = 0, bandL = 0, lowR = 0, bandR = 0;
  for (let i = 0; i < len; i++) {
    const xl = nz.riserL(), xr = nz.riserR();
    const p = len > 1 ? i / (len - 1) : 1;
    const fc = f0 * (f1 / f0) ** (p ** 1.35);
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR * 0.42)) / SR);
    lowL += f * bandL; const hiL = xl - lowL - q * bandL; bandL += f * hiL;
    lowR += f * bandR; const hiR = xr - lowR - q * bandR; bandR += f * hiR;
    const idx = i0 + i;
    if (idx < 0 || idx >= N) continue;
    const t = i / SR;
    const trem = 1 - 0.30 * (1 - p) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (5 + 13 * p) * t));
    const comp = 1 / Math.sqrt(1 + fc / 2600);         // 高中心频率别炸
    const g = gain * (p ** 2.0) * trem * comp * clamp((dur - t) / 0.012, 0, 1);
    b.L[idx] += bandL * g * 2.2;
    b.R[idx] += bandR * g * 2.2;
  }
}

/* -------------------------------------------------------------- 编排主体 */

/** 所有 kick 的时刻（也用来做侧链）。 */
const kickTimes = [];

for (let bar = 0; bar < BARS; bar++) {
  const t0 = bar * BAR;
  const S = SECTION_OF[bar];
  const chord = CHORDS[bar];

  // ── kick：每一拍，一拍不落（含 0.0s 那一拍）
  for (let b = 0; b < 4; b++) {
    const tb = t0 + b * BEAT;
    kickTimes.push(tb);
    // 俯冲段把 1.25kHz 的 click 收一点：kick 的「体」还在，中频让位
    // 俯冲段把 1.25kHz 的 click 收掉：kick 的「体」还在，中频让位
    addKick(bus.kick, tb, KICK_VEL[S], S === 'dive' ? 0.05 : 0.16);
  }

  // ── pad（24 度：220–520Hz；俯冲段降到 18 度 = 123–294Hz，整段不占 400–2000Hz）
  {
    const dur = bar === 21 ? 6.5 : BAR;                 // 落版那一记和弦拖到片尾
    addPad(bus.tone, t0, dur, chord, S === 'dive' ? 18 : 24, PAD_GAIN[S],
           S === 'intro' ? 0.9 : 0.45, bar === 21 ? 1.2 : 0.55);
  }

  // ── bass（6.0s 进）
  if (BASS_PATTERN[S]) {
    const root = BASS_ROOT[bar];
    for (const [off, tone, len] of BASS_PATTERN[S]) {
      addBass(bus.tone, t0 + off * BEAT, root + chordTone(chord, tone), len * BEAT,
              0.92 * BASS_GAIN[S]);
    }
  }

  // ── hat
  if (S === 'launch' || S === 'drive') {
    for (let k = 0; k < 8; k++) {                       // 8 分
      addHat(bus.drum, t0 + k * BEAT * 0.5, k % 2 === 0 ? 0.30 : 0.44, 0.042);
    }
  } else if (S === 'driveBuild') {
    for (let k = 0; k < 8; k++) addHat(bus.drum, t0 + k * BEAT * 0.5, k % 2 === 0 ? 0.32 : 0.46, 0.042);
    for (let k = 0; k < 4; k++) {                       // 末拍 16 分 fill，推向 16.0s 的门
      addHat(bus.drum, t0 + 3 * BEAT + k * BEAT * 0.25, 0.36, 0.032);
    }
  } else if (S === 'hall') {
    for (let k = 0; k < 8; k++) {                       // 大厅：8 分，稳
      addHat(bus.drum, t0 + k * BEAT * 0.5, k % 2 === 0 ? 0.32 : 0.46, 0.044);
    }
  } else if (S === 'dive') {
    // 26.0s 起的 16 分，换成二阶高通 + 更短的衰减：能量往上推，400–2000Hz 让出来。
    // 增益比大厅段还高 —— 「中频让一点位」是少中频，不是少能量。
    for (let k = 0; k < 16; k++) {
      addHat(bus.drum, t0 + k * BEAT * 0.25, k % 4 === 0 ? 0.38 : k % 2 === 0 ? 0.31 : 0.24, 0.026, 1);
    }
  }
  // frames / build / title / outro：没有 hat（36.0s 抽掉）

  // ── snare（8.0s 起，2、4 拍）
  if (S !== 'intro' && S !== 'launch' && S !== 'frames' && S !== 'build'
      && S !== 'title' && S !== 'outro') {
    const g = S === 'dive' ? 0.20 : 0.72;
    const d = S === 'dive' ? 0.13 : 0.20;
    addSnare(bus.drum, t0 + 1 * BEAT, g, d);
    addSnare(bus.drum, t0 + 3 * BEAT, g, d);
    if (S === 'hall' || S === 'driveBuild') addSnare(bus.drum, t0 + 3.5 * BEAT, g * 0.34, d);  // ghost
  }

  // ── arp（26.0s 进，36.0s 抽掉；抬到 3.5k 以上，离开中频）
  if (S === 'dive') {
    for (let k = 0; k < 16; k++) {
      const ti = [0, 1, 2, 1][k % 4];
      const acc = k % 4 === 0 ? 1.0 : 0.72;
      addArp(bus.tone, t0 + k * BEAT * 0.25, chordTone(chord, ti) + 72,
             BEAT * 0.25 * 1.6, 0.115 * acc, k % 2 === 0 ? 0.34 : 0.66);
    }
  }
}

// ── 画面切点上的重音：boom 与吊镲（时刻必须和 task.config.mjs 的段边界一致）
addBoom(bus.boom, 6.0, 0.42, 44, 30, 1.6);    // 爆冲进代码走廊（要有明确的进入感）
addBoom(bus.boom, 16.0, 0.60, 46, 31, 2.0);   // 穿门 → SDF 大厅
addBoom(bus.boom, 26.0, 0.62, 44, 29, 2.2);   // 坠入晶格隧道
addBoom(bus.boom, 42.0, 0.95, 48, 30, 3.0);   // 落版：大重击
addCrash(bus.drum, 6.0, 0.55, 1.8);           // 冲进去那一下
addCrash(bus.drum, 16.0, 0.62, 2.4);
addCrash(bus.drum, 26.0, 0.62, 2.4);
addCrash(bus.drum, 42.0, 1.00, 5.0);          // 吊镲尾巴铺满整个收尾

// ── riser：14–16s（推到门口）、40–42s（重新 build 到落版）
addRiser(bus.tone, 14.0, 2.0, 0.85, 280, 8200);
addRiser(bus.tone, 40.0, 2.0, 0.82, 220, 9000);

// --debug：把每条总线的电平/非有限值数出来（调音用，不影响产物）

/* ---------------------------------------------------------------- 混音 */

/**
 * 侧链闪避：每个 kick 之后把低音 bus 压下去再放回来。
 * 这是「kick 瞬态干净、不被别的低频糊掉」的关键 —— 也是节拍检测能测准的前提。
 */
function duckCurve(times, depth, rate, delay = 0) {
  const g = new Float32Array(N).fill(1);
  for (const tk of times) {
    const start = tk + delay;
    const i0 = Math.max(0, Math.round(start * SR));
    const i1 = Math.min(N, Math.round((start + 0.35) * SR));
    for (let i = i0; i < i1; i++) {
      const dt = i / SR - start;
      const v = 1 - depth * Math.exp(-dt * rate);
      if (v < g[i]) g[i] = v;
    }
  }
  return g;
}

const duckTone = duckCurve(kickTimes, 0.72, 16, 0);
// boom 自己也闪避，但延后 20ms 起效 —— 重击的头 20ms 完整保留（那才是「沉」）
const duckBoom = duckCurve(kickTimes, 0.55, 14, 0.020);

const mixL = new Float32Array(N);
const mixR = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const dT = duckTone[i], dB = duckBoom[i];
  mixL[i] = bus.kick.L[i] + bus.drum.L[i] + bus.tone.L[i] * dT + bus.boom.L[i] * dB;
  mixR[i] = bus.kick.R[i] + bus.drum.R[i] + bus.tone.R[i] * dT + bus.boom.R[i] * dB;
}

/* ------------------------------------------------- 「开一点」：中频让位 */

/** RBJ peaking EQ 系数（已按 a0 归一化）。 */
function peakingCoeffs(f0, Q, dB) {
  const A = 10 ** (dB / 40);
  const w0 = (2 * Math.PI * f0) / SR;
  const alpha = Math.sin(w0) / (2 * Q);
  const cw = Math.cos(w0);
  const a0 = 1 + alpha / A;
  return {
    b0: (1 + alpha * A) / a0, b1: (-2 * cw) / a0, b2: (1 - alpha * A) / a0,
    a1: (-2 * cw) / a0, a2: (1 - alpha / A) / a0,
  };
}

/** 俯冲段（26–36s）把 900Hz 附近压 8.5dB：能量还在，中频给画面让位。 */
{
  const c = peakingCoeffs(900, 0.75, -8.5);
  const zL = { x1: 0, x2: 0, y1: 0, y2: 0 };
  const zR = { x1: 0, x2: 0, y1: 0, y2: 0 };
  const step = (x, z) => {
    const y = c.b0 * x + c.b1 * z.x1 + c.b2 * z.x2 - c.a1 * z.y1 - c.a2 * z.y2;
    z.x2 = z.x1; z.x1 = x; z.y2 = z.y1; z.y1 = y;
    return y;
  };
  const ramp = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const wet = ramp(t, 26.0, 26.25) * (1 - ramp(t, 35.75, 36.0));
    const wl = step(mixL[i], zL), wr = step(mixR[i], zR);
    mixL[i] += (wl - mixL[i]) * wet;
    mixR[i] += (wr - mixR[i]) * wet;
  }
}

/* ------------------------------------------------------- 淡出 → 归一化 → 削波 */

// 最后 2 秒淡出到绝对静音：t = 48.0s 处增益正好 0（最后一个采样乘 0）
const fadeSamples = (SECONDS - FADE_FROM) * SR;
for (let i = 0; i < N; i++) {
  const rem = (N - 1 - i) / fadeSamples;
  if (rem >= 1) continue;
  const g = rem <= 0 ? 0 : rem ** 1.5;
  mixL[i] *= g; mixR[i] *= g;
}
mixL[N - 1] = 0; mixR[N - 1] = 0;

// 软削波 tanh；先算出增益，让削波之后的峰值正好落在目标电平
const DRIVE = 1.15;
const TARGET_DBFS = -1.0;
const targetLin = 10 ** (TARGET_DBFS / 20);
let rawPeak = 0;
for (let i = 0; i < N; i++) {
  const a = Math.abs(mixL[i]), b = Math.abs(mixR[i]);
  if (a > rawPeak) rawPeak = a;
  if (b > rawPeak) rawPeak = b;
}
const gain = rawPeak > 0 ? Math.atanh(targetLin) / DRIVE / rawPeak : 1;
const soft = (x) => Math.tanh(x * DRIVE);

// --debug：把每条总线的电平 / 非有限值 / 归一化余量打出来（调音用，不影响产物）
if (process.argv.includes('--debug')) {
  for (const [name, b] of Object.entries(bus)) {
    let pk = 0, ss = 0, bad = 0;
    for (let i = 0; i < N; i++) {
      for (const ch of [b.L[i], b.R[i]]) {
        if (!Number.isFinite(ch)) bad++;
        else { const a = Math.abs(ch); if (a > pk) pk = a; ss += ch * ch; }
      }
    }
    console.log(`[bus] ${name.padEnd(5)} peak ${pk.toFixed(4)}  rms `
      + `${(10 * Math.log10(ss / (2 * N))).toFixed(1)} dB  nonfinite ${bad}`);
  }
  console.log(`[mix] 削波前峰值 ${rawPeak.toFixed(3)}（${(20 * Math.log10(rawPeak)).toFixed(1)} dBFS）`
    + ` → 归一化增益 ${gain.toFixed(4)}（tanh 之后压到 ${TARGET_DBFS} dBFS）`);
}

/* ------------------------------------------------------------- 写 16bit WAV */

const dataBytes = N * 2 * 2;
const head = Buffer.alloc(44);
head.write('RIFF', 0, 'ascii');
head.writeUInt32LE(36 + dataBytes, 4);
head.write('WAVE', 8, 'ascii');
head.write('fmt ', 12, 'ascii');
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);          // PCM
head.writeUInt16LE(2, 22);          // 立体声
head.writeUInt32LE(SR, 24);
head.writeUInt32LE(SR * 4, 28);     // byte rate
head.writeUInt16LE(4, 32);          // block align
head.writeUInt16LE(16, 34);         // bits
head.write('data', 36, 'ascii');
head.writeUInt32LE(dataBytes, 40);

const data = Buffer.alloc(dataBytes);
let peakL = 0, peakR = 0;
for (let i = 0; i < N; i++) {
  const l = clamp(Math.round(soft(mixL[i] * gain) * 32767), -32768, 32767);
  const r = clamp(Math.round(soft(mixR[i] * gain) * 32767), -32768, 32767);
  data.writeInt16LE(l, i * 4);
  data.writeInt16LE(r, i * 4 + 2);
  if (Math.abs(l) > peakL) peakL = Math.abs(l);
  if (Math.abs(r) > peakR) peakR = Math.abs(r);
}

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--'))
  ?? path.join(ROOT, 'tasks', 'promo', 'audio', 'bed.wav');

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([head, data]));
const peakDb = 20 * Math.log10(Math.max(peakL, peakR) / 32768);
console.log(`✓ ${path.relative(ROOT, out)}  ${SECONDS.toFixed(3)}s  ${BPM}bpm  `
  + `${SR}Hz 立体声 16bit  ${(dataBytes / 1048576).toFixed(1)} MB  peak ${peakDb.toFixed(2)} dBFS`);

/* --------------------------------------------------------------- 转 mp3 */

// 引擎只认 mp3（Chrome 的 decodeAudioData 对脚本拼出来的 WAV 并不总是买账）。
if (!args.includes('--no-mp3')) {
  const mp3 = out.replace(/\.wav$/i, '.mp3');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-b:a', '192k', mp3], { stdio: 'inherit' });
  if (r.status === 0) console.log(`✓ ${path.relative(ROOT, mp3)}   ← 任务里用这个（engine 只认 mp3）`);
  else console.log('· ffmpeg 没跑成，跳过 mp3（音频任务仍然要 mp3，请先修好 ffmpeg）');
}

/* ------------------------------------------------------- --check：解码量一遍 */

if (args.includes('--check')) await runCheck(out);

/**
 * 把刚写出来的 WAV 解码回 Float32，用引擎自带的分析器量一遍，
 * 再打一张逐小节 RMS 表 —— 用来证明编排真的按分镜表走了。
 */
async function runCheck(wavPath) {
  console.log('\n────────── --check：把产物解码回来量一遍 ──────────');
  /** @type {string[]} */
  const fails0 = [];

  // 1) 自己解析 RIFF（产物就是这里写的标准 44 字节头）
  const buf = readFileSync(wavPath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('不是 RIFF/WAVE');
  }
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  const frames = buf.readUInt32LE(40) / (channels * (bits / 8));
  const mono = new Float32Array(frames);
  let pk = 0, sumSq = 0;
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const v = buf.readInt16LE(44 + i * channels * 2 + c * 2) / 32768;
      acc += v;
      if (Math.abs(v) > pk) pk = Math.abs(v);
    }
    acc /= channels;
    mono[i] = acc;
    sumSq += acc * acc;
  }
  const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / frames));
  const peakDb = 20 * Math.log10(pk);
  console.log(`文件      : ${path.relative(ROOT, wavPath)}`);
  console.log(`容器      : ${frames} 帧 / ${sampleRate}Hz / ${channels} 声道 / ${bits}bit`
    + `  → 时长 ${(frames / sampleRate).toFixed(6)}s`);
  console.log(`电平      : peak ${peakDb.toFixed(2)} dBFS   rms ${rmsDb.toFixed(2)} dBFS`);

  // 2) 过一遍引擎自带的分析器（纯 JS，Node 里可以直接 import）
  const { analyzePCM } = await import('../src/core/audio-analysis.js');
  const a = analyzePCM(mono, sampleRate);
  console.log(`analyzePCM: bpm ${a.bpm}   beats ${a.beats.length}   duration ${a.duration.toFixed(3)}s`
    + `   fps ${a.fps.toFixed(2)}`);
  console.log(`             kicks ${a.kicks.length}   snares ${a.snares.length}   hats ${a.hats.length}`
    + `   sections ${a.sections.length}`);
  console.log(`             首 4 记 kick @ ${a.kicks.slice(0, 4).map((k) => k.t.toFixed(3)).join(', ')}`
    + `   末记 @ ${a.kicks.length ? a.kicks[a.kicks.length - 1].t.toFixed(3) : '—'}`);

  // 3) 逐小节 RMS 表 + 中频占比（400–2000Hz 宽带通后的 RMS / 全带 RMS）
  const bp = (() => {                                  // RBJ bandpass，量中频用
    const w0 = (2 * Math.PI * 900) / sampleRate;
    const alpha = Math.sin(w0) / (2 * 0.7);
    const cw = Math.cos(w0);
    const a0 = 1 + alpha;
    return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
  })();
  const band = new Float32Array(frames);
  {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < frames; i++) {
      const x = mono[i];
      const y = bp.b0 * x + bp.b1 * x1 + bp.b2 * x2 - bp.a1 * y1 - bp.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      band[i] = y;
    }
  }
  const barLen = Math.round(BAR * sampleRate);
  const rows = [];
  console.log('\n 小节   时间           RMS dBFS   峰值 dBFS   中频占比');
  for (let bar = 0; bar < BARS; bar++) {
    const i0 = bar * barLen;
    const i1 = Math.min(frames, i0 + barLen);
    let s = 0, b = 0, p = 0;
    for (let i = i0; i < i1; i++) {
      s += mono[i] * mono[i];
      b += band[i] * band[i];
      const av = Math.abs(mono[i]);
      if (av > p) p = av;
    }
    const n = Math.max(1, i1 - i0);
    const rdb = 10 * Math.log10(s / n + 1e-20);
    const pdb = 20 * Math.log10(p + 1e-20);
    const midPct = (Math.sqrt(b / n) / Math.sqrt(s / n + 1e-20)) * 100;
    rows.push({ bar, rdb, pdb, midPct });
    console.log(`  ${String(bar).padStart(2)}   ${(bar * BAR).toFixed(1).padStart(4)}–`
      + `${((bar + 1) * BAR).toFixed(1).padStart(4)}s   ${rdb.toFixed(2).padStart(7)}`
      + `   ${pdb.toFixed(2).padStart(8)}   ${midPct.toFixed(1).padStart(6)}%`);
  }
  const avg = (a0, a1) => rows.slice(a0, a1).reduce((s, r) => s + r.rdb, 0) / (a1 - a0);
  const seg = (name, a0, a1) => `${name} ${avg(a0, a1).toFixed(2)}dB`;
  console.log(`\n 段均 RMS : ${seg('0–2 黑场', 0, 3)} · ${seg('3–7 走廊', 3, 8)} · `
    + `${seg('8–12 大厅', 8, 13)} · ${seg('13–17 俯冲', 13, 18)} · ${seg('18–19 帧墙', 18, 20)} · `
    + `${seg('20 build', 20, 21)} · ${seg('21–23 落版', 21, 24)}`);
  const mid = (a0, a1) => rows.slice(a0, a1).reduce((s, r) => s + r.midPct, 0) / (a1 - a0);
  console.log(` 段均中频 : 8–12 大厅 ${mid(8, 13).toFixed(1)}%  →  13–17 俯冲 ${mid(13, 18).toFixed(1)}%`
    + `  （俯冲段中频让位，能量靠低音与高音顶上）`);

  // 4) 画面切点核对：五个切点必须落在整拍/整小节上，而且编排必须真的在那里转折
  console.log('\n 画面切点核对（以 tasks/promo/task.config.mjs 的六段时间线为准）:');
  {
    const secOf = (bar) => SECTION_OF[bar] ?? '—';
    let bad = 0;
    for (const c of CUTS) {
      const beat = c.t / BEAT, bar = c.t / BAR;
      const onBeat = Number.isInteger(beat), onBar = Number.isInteger(bar);
      const turns = bar === 0 || secOf(bar) !== secOf(bar - 1);
      if (!onBeat || !onBar) bad++;
      // 切点两侧各 1s 的电平差：证明这里真的发生了事情
      const wr = (t0, t1) => {
        const a0 = Math.round(t0 * sampleRate), a1 = Math.round(t1 * sampleRate);
        let s = 0;
        for (let i = a0; i < a1; i++) s += mono[i] * mono[i];
        return 10 * Math.log10(s / (a1 - a0) + 1e-20);
      };
      const delta = bar === 0 ? NaN : wr(c.t, c.t + 1) - wr(c.t - 1, c.t);
      console.log(`  ${c.t.toFixed(1).padStart(4)}s  ${c.scene}  = 第 ${String(beat).padStart(2)} 拍`
        + ` / 第 ${String(bar).padStart(2)} 小节  ${onBeat && onBar ? '✓在拍上' : '✗没落在拍上'}  `
        + `编排 ${(bar === 0 ? '（片头）' : secOf(bar - 1))} → ${secOf(bar)} ${turns ? '✓转折' : '✗没转折'}`
        + (Number.isNaN(delta) ? '' : `  切点后 1s 电平 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}dB`));
    }
    if (bad) fails0.push(`${bad} 个画面切点没有落在整拍/整小节上`);
  }

  // 4) 自己数一遍 kick：96 拍，每一拍的低频都要有一起干净的起音
  //    （analyzePCM 的 pickPeaks 从第 2 帧才开始找，抓不到 0.0s 那一记，所以这层单独做）
  {
    const lp = (() => {                                 // RBJ lowpass @160Hz，只看 kick 的体
      const w0 = (2 * Math.PI * 160) / sampleRate;
      const alpha = Math.sin(w0) / (2 * 0.9);
      const cw = Math.cos(w0);
      const a0 = 1 + alpha;
      return { b0: ((1 - cw) / 2) / a0, b1: (1 - cw) / a0, b2: ((1 - cw) / 2) / a0,
               a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
    })();
    const win = Math.round(0.005 * sampleRate);         // 5ms 能量的包络
    const env = new Float32Array(Math.floor(frames / win));
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, acc = 0, w = 0;
    for (let i = 0; i < frames; i++) {
      const x = mono[i];
      const y = lp.b0 * x + lp.b1 * x1 + lp.b2 * x2 - lp.a1 * y1 - lp.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      acc += y * y; w++;
      if (w === win) { env[(i / win) | 0] = Math.sqrt(acc / win); acc = 0; w = 0; }
    }
    const at = (t) => env[clamp(Math.round(t * sampleRate / win), 0, env.length - 1)];
    const attack = [];                                  // 每一拍起音后 60ms 里最高的 5ms 低频能量
    for (let k = 0; k < BARS * 4; k++) {
      const tb = k * BEAT;
      let peak = 0;
      for (let j = 0; j <= Math.round(0.060 / 0.005); j++) peak = Math.max(peak, at(tb + j * 0.005));
      attack.push(peak);
    }
    const med = [...attack].sort((x, y) => x - y)[(BARS * 4) >> 1];
    // 第 1–95 拍：kick 要从「上一拍已经衰减掉」的底噪里抬起来。
    // 第 0 拍前面没有任何音频，「起音比」无从谈起，只能跟别的拍的起音高度比。
    let hit0 = attack[0] >= med * 0.6;
    let hit = 0, worst = Infinity, worstBeat = -1;
    for (let k = 1; k < BARS * 4; k++) {
      const tb = k * BEAT;
      const ratio = attack[k] / Math.max(at(tb - 0.005), at(tb - 0.010), 1e-9);
      if (ratio >= 1.6) hit++;
      if (ratio < worst) { worst = ratio; worstBeat = k; }
    }
    const total = hit + (hit0 ? 1 : 0);
    console.log(` 每拍 kick : ${total}/96 拍低频上有 kick 起音`);
    console.log(`             · 第 1–95 拍：起音比（起音后 60ms 峰值 ÷ 起音前 10ms）最低 `
      + `${worst.toFixed(2)}×（第 ${worstBeat} 拍 @ ${(worstBeat * BEAT).toFixed(3)}s）`);
    console.log(`             · 第 0 拍 @ 0.000s：前面没有音频，起音高度 ${attack[0].toFixed(4)}`
      + ` = 中位数 ${med.toFixed(4)} 的 ${(attack[0] / med).toFixed(2)}×（≥0.60× 判为有 kick）`);
    if (total !== BARS * 4) {
      console.log(` ✗ 有 ${BARS * 4 - total} 拍的低频起音不达标`);
      process.exitCode = 1;
    }
    // riser 到底有没有在「build」：两段 riser 各自的前后窗口比较
    const winRms = (t0, t1) => {
      const a0 = Math.round(t0 * sampleRate), a1 = Math.round(t1 * sampleRate);
      let s = 0;
      for (let i = a0; i < a1; i++) s += mono[i] * mono[i];
      return 10 * Math.log10(s / (a1 - a0) + 1e-20);
    };
    console.log(` riser    : 14–16s  ${winRms(14.0, 14.5).toFixed(1)} → ${winRms(15.5, 16.0).toFixed(1)} dB`
      + `   |  40–42s  ${winRms(40.0, 40.5).toFixed(1)} → ${winRms(41.0, 41.5).toFixed(1)}`
      + ` → ${winRms(41.5, 42.0).toFixed(1)} dB  （逐段抬升 = build）`);
    if (winRms(15.5, 16.0) <= winRms(14.0, 14.5)) { console.log(' ✗ 14–16s riser 没有抬升'); process.exitCode = 1; }
    if (winRms(41.5, 42.0) <= winRms(40.0, 40.5)) { console.log(' ✗ 40–42s riser 没有抬升'); process.exitCode = 1; }
  }

  // 5) mp3 才是引擎真正读的那一份 —— 用 ffmpeg 解回 Float32 再量一遍
  //    （mp3 会带约 1105 个采样的编码器延迟/补零，时长会多出 ~25ms，拍子不受影响）
  const mp3Path = wavPath.replace(/\.wav$/i, '.mp3');
  if (existsSync(mp3Path)) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', mp3Path, '-f', 'f32le',
      '-ac', '1', '-ar', String(sampleRate), '-'], { maxBuffer: 1 << 30 });
    if (r.status !== 0 || !r.stdout?.length) {
      fails0.push('mp3 解不开（引擎只认 mp3，这份必须能解）');
    } else {
      const b = r.stdout;
      const pcm = new Float32Array(b.length >> 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = b.readFloatLE(i * 4);
      const am = analyzePCM(pcm, sampleRate);
      console.log(`\nmp3 复核   : ${path.relative(ROOT, mp3Path)}  解码 ${(pcm.length / sampleRate).toFixed(3)}s`
        + `  bpm ${am.bpm}  beats ${am.beats.length}  kicks ${am.kicks.length}`);
      if (Math.abs(am.bpm - BPM) > 2 || am.beats.length < 90 || am.beats.length > 102) {
        fails0.push(`mp3 分析对不上：bpm ${am.bpm} / beats ${am.beats.length}`);
      }
      if (am.bpm !== a.bpm || am.beats.length !== a.beats.length) {
        fails0.push('mp3 与 wav 的分析结果不一致');
      }
    }
  }

  // 6) 判据（段落边界 = 画面的切点：0–2 / 3–7 / 8–12 / 13–17 / 18–19 / 20 / 21–23）
  const fails = [...fails0];
  const SEC = { 黑场: avg(0, 3), 走廊: avg(3, 8), 大厅: avg(8, 13), 俯冲: avg(13, 18), 帧墙: avg(18, 20), build: avg(20, 21), 落版: avg(21, 24) };
  if (Math.abs(frames / sampleRate - SECONDS) > 0.01) fails.push(`时长 ${(frames / sampleRate).toFixed(4)}s ≠ 48.000s`);
  if (sampleRate !== SR) fails.push(`采样率 ${sampleRate} ≠ ${SR}`);
  if (channels !== 2) fails.push(`声道 ${channels} ≠ 2`);
  if (Math.abs(peakDb - TARGET_DBFS) > 0.5) fails.push(`峰值 ${peakDb.toFixed(2)} dBFS 偏离 ${TARGET_DBFS}`);
  if (Math.abs(a.bpm - BPM) > 2) fails.push(`bpm ${a.bpm} 偏离 ${BPM}`);
  if (a.beats.length < 90 || a.beats.length > 102) fails.push(`beats ${a.beats.length} 偏离 96`);
  if (a.kicks.length < 90) fails.push(`kick 只测到 ${a.kicks.length} 记（应≈96）`);
  if (SEC.黑场 !== Math.min(...Object.values(SEC))) fails.push('0–6s 黑场段不是最轻');
  if (SEC.俯冲 < Math.max(...Object.values(SEC))) fails.push('26–36s 俯冲段不是全片最响');
  if (SEC.俯冲 <= SEC.大厅) fails.push(`俯冲 (${SEC.俯冲.toFixed(2)}dB) 没有比大厅 (${SEC.大厅.toFixed(2)}dB) 响`);
  if (SEC.帧墙 >= SEC.大厅) fails.push(`36–40s 帧墙 (${SEC.帧墙.toFixed(2)}dB) 没有安静下来（应低于大厅 ${SEC.大厅.toFixed(2)}dB）`);
  if (avg(22, 24) >= SEC.俯冲) fails.push('最后两小节没有降下来');
  if (mid(13, 18) >= mid(8, 13)) fails.push(`俯冲段中频 ${mid(13, 18).toFixed(1)}% 没有低于大厅段 ${mid(8, 13).toFixed(1)}%`);
  if (mono[frames - 1] !== 0) fails.push(`末尾不是绝对静音（${mono[frames - 1]}）`);
  const ok = fails.length === 0;
  console.log(ok ? '\n ✓ --check 全部通过' : `\n ✗ --check 不通过：\n   · ${fails.join('\n   · ')}`);
  if (!ok) process.exitCode = 1;
}
