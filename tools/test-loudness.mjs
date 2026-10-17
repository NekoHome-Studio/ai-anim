// @ts-check
/**
 * 响度数字守门的离线回归：`measureLoudness()` 量出来的数字**是不是真的**。
 *
 *   node tools/test-loudness.mjs
 *
 * 为什么要有这个文件：音频这一层以前**只能靠耳朵**（画面有 `check` 亮度、`shake` 逐帧变化量、
 * `verify` 逐像素、`video` 复核帧数）。纪律是"**你听不见，就说出这一点并报数字**"——
 * 而"报了数字"必须先证明**数字本身是对的**：拿 ffmpeg 现场合成几段**已知响度**的测试音，
 * 再用被测函数量一遍，对不上就是函数错了。
 *
 * 只用 ffmpeg + 纯 JS：**不启浏览器、不启 Vite、不渲染任何一帧**。
 * 产物一律写 `os.tmpdir()`，**不往仓库里写任何文件**（真实音轨是**只读**测量的）。
 * 没有 ffmpeg 时明确报"跳过"并 `exit 2` —— 不要假装通过（照 `tools/probe-tts-edge.mjs`）。
 *
 * 退出码：0 = 全通过 · 1 = 有断言失败 · 2 = 环境不满足（没有 ffmpeg），**不算通过**。
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessLoudness, decodeChannels, formatLoudness, measureLoudness, parseLoudnormJson } from '../scripts/lib/media.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(os.tmpdir(), 'anim-loudness');
const FFMPEG = process.env.ANIM_FFMPEG || 'ffmpeg';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (ok) pass++; else fail++;
};

/* ── 0. 环境：没有 ffmpeg 就明确退出 2，绝不假装通过 ── */
const probe = spawnSync(FFMPEG, ['-hide_banner', '-version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.log(`⏭  跳过：没有可用的 ffmpeg（${FFMPEG}）—— ${probe.error?.message ?? `exit ${probe.status}`}`);
  console.log('   装一个，或用 ANIM_FFMPEG 指定路径。**这一条不算通过。**');
  process.exit(2);
}
const fver = String(probe.stdout).split('\n')[0].trim();
console.log(`ffmpeg：${FFMPEG}`);
console.log(`        ${fver}`);
if (!/loudnorm/i.test(String(spawnSync(FFMPEG, ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout))) {
  console.log(`⏭  跳过：这个 ffmpeg 没有 loudnorm 滤镜（EBU R128）。**这一条不算通过。**`);
  process.exit(2);
}

rmSync(DIR, { recursive: true, force: true });
mkdirSync(path.join(DIR, 'fixtures'), { recursive: true });

/** 用 ffmpeg 现场合成一段**已知响度**的测试音。 */
const ff = (args) => {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg 失败：${args.join(' ')}\n${String(r.stderr).split('\n').slice(-4).join('\n')}`);
  return r;
};
/**
 * 用 `astats` 独立量**每条声道**的 RMS（dBFS）—— 本文件里唯一可信的"实际电平"。
 *
 * ⚠ 别用 `volumedetect` 的 `mean_volume` 来核：它对多声道是**各声道功率求和**再取平均，
 * 双声道同相时会比"每声道 RMS"高 **+3.01 dB**（实测同一段信号：astats 每声道 −17.01 dBFS，
 * volumedetect `mean_volume` 是 −14.00 dB）。第一版就是拿它去比"单声道该是多少"，
 * 凭空多出 3 dB 的假差值。而 loudnorm 的 `input_i` 同样是**功率和**（也 +3.01），
 * 两者本来就是同一套算法 —— 所以"每声道 RMS"才是不含糊的基准。
 */
const chanRmsDb = (file) => {
  const r = ff(['-hide_banner', '-v', 'info', '-i', file, '-af', 'astats=metadata=0', '-f', 'null', '-']);
  const text = String(r.stderr);
  const m = /Channel:\s*1\s*\n(?:.*\n)*?\s*RMS level dB:\s*(-?[\d.]+)/.exec(text)
    ?? /RMS level dB:\s*(-?[\d.]+)/.exec(text);
  if (!m) throw new Error(`astats 没给出 RMS level：${file}`);
  return Number(m[1]);
};

/**
 * 合成一段 997Hz 正弦（EBU R128 的技术频率），振幅**精确可控**、**双声道同相**。
 *
 * ⚠ 两个踩过的坑（第一版就是这两个一起把数字搞低了）：
 *   ① **不要用 `sine` 滤镜来定电平**：本机 ffmpeg 8.1.2 的 `sine` **没有 `amplitude` 选项**
 *      （`-h filter=sine` 里只有 frequency/sample_rate/duration/samples_per_frame），
 *      输出电平**写死**（实测 RMS −21.1 dBFS）—— `sine` + `volume=-14dB` 量出来整整低 21 dB。
 *      改用 `aevalsrc` 直接给表达式，振幅 = 10^(dB/20)。（换台机器换版 ffmpeg 依旧成立。）
 *   ② **不要靠 `-ac 2` 把单声道变双声道**：ffmpeg 的下混会乘 0.5（保总功率），
 *      每条声道又低 **6.01 dB**。直接把立体声表达式写进 `aevalsrc`（两路用 `|` 分开），不下混。
 *
 * 期望值：对**双声道同相的正弦**，本机实测的闭式关系是
 *     LUFS ≈ **峰值(dBFS) − 0.05**        （峰 −20/−14/−6 dBFS 三段量出 −20.05/−14.05/−6.05）
 * ⚠ 教科书按 ITU-R BS.1770 推是"−0.691 + 10·log10(Σ声道功率) = 峰值 − 0.691"，
 *   而 ffmpeg 的 loudnorm **实测偏高 0.64 dB**（版本/实现差异，来源未查）。
 *   我们报数字时用的就是 ffmpeg 的 loudnorm，所以这里按**实测标定**的那条写，
 *   并把差异留在注释里 —— 不要拿"理论上应该 −0.691"去改断言（那样会无缘无故红一条）。
 * @returns {{ file: string, amp: number, expectLufs: number, chanRmsDb: number }}
 */
const toneAt = (db, { duration = 6, name = null, freq = 997 } = {}) => {
  const amp = 10 ** (db / 20);
  const ch = `${amp}*sin(2*PI*${freq}*t)`;
  const file = path.join(DIR, 'fixtures', `${name ?? `tone${Math.abs(db)}`}@${db}dB.wav`);
  ff(['-y', '-v', 'error', '-f', 'lavfi',
    '-i', `aevalsrc=${ch}|${ch}:s=48000:d=${duration}`,
    '-c:a', 'pcm_s16le', file]);
  const chanRms = chanRmsDb(file);
  return { file, amp, expectLufs: db - 0.05, chanRmsDb: chanRms };
};

/* ── 1. 合成已知响度的测试音，量出来的数字必须对得上 ──
 *
 * 997 Hz（EBU R128 的技术频率）/ 48kHz / 双声道同相。期望值是**闭式**的：
 *     整合响度 = 峰值(dBFS) − 0.691（推导见 `toneAt` 的注释）
 * 而且每一段都再用 `astats` 独立核一遍**每声道 RMS**（必须 = 峰值 − 3.01）——
 * 生成器自己错了（第一版就踩了：ffmpeg 8 的 `sine` 电平写死，整整低 21 dB）也会被抓住。 */
const LEVELS = [
  { db: -20, kind: '音乐床那一档（偏轻）' },
  { db: -14, kind: '平台靶子那一档' },
  { db: -6, kind: '偏响（会被平台压）' },
];
/** 额外一段**真正合规范**的音：要落在 −14 LUFS，按实测标定反解 ⇒ 峰值 −14 + 0.05 = −13.95 dBFS。 */
const SPEC_DB = -14 + 0.05; // −13.95 dBFS 峰值 → 整合响度 ≈ −14.00 LUFS
console.log('\n① 已知响度的测试音：测出来的 LUFS 与**可推算的**期望值差 ≤1.0');
/** @type {{db:number, m:any, a:any, t:any}[]} */
const measured = [];
for (const { db, kind } of LEVELS) {
  const t = toneAt(db);
  const m = measureLoudness(t.file);
  const a = assessLoudness(m);
  measured.push({ db, m, a, t });
  const d = m.i - t.expectLufs;
  console.log(`     峰 ${String(db).padStart(3)}dBFS（振幅 ${t.amp.toFixed(3)}）→ ${formatLoudness(m)}  ${a.tier === 'ok' ? '✓' : a.tier === 'warn' ? '⚠' : '✗'}  （${kind}）`);
  console.log(`            期望 ≈ ${t.expectLufs.toFixed(2)} LUFS（= 峰 ${db} − 0.05，本机实测标定），实测差 ${d > 0 ? '+' : ''}${d.toFixed(2)} LU`);
  check(`峰 ${db} dBFS 的测试音量出 ${m.i.toFixed(2)} LUFS（期望 ${t.expectLufs.toFixed(2)}）`, Math.abs(d) <= 1.0);
  // 生成器自证：astats 量到的每声道 RMS 必须就是"我们以为给了多少"（差 >0.5dB 说明表达式没按预期走）
  const expectRms = db - 3.01; // 正弦的 RMS = 峰值 − 3.01 dB
  check(`  生成器实际电平：每声道 RMS ${t.chanRmsDb.toFixed(2)} dBFS（峰 ${db} dBFS 的正弦应为 ${expectRms.toFixed(2)}）`,
    Math.abs(t.chanRmsDb - expectRms) <= 0.5);
}
// 单调性：更响的输入必须量出更大的数字（防止"永远返回同一个常数"也能过上面那条）
check('三段测试音的响度严格递增（−20 < −14 < −6）',
  measured[0].m.i < measured[1].m.i && measured[1].m.i < measured[2].m.i,
  measured.map((x) => x.m.i.toFixed(2)).join(' < '));

/* ── 2. 判据：离 −14 / −1 差多少、是否越界 ── */
console.log('\n② 判据（assessLoudness）');
const specTone = toneAt(SPEC_DB, { name: 'spec-tone' }); // 恰好 −14 LUFS 的一段
const specM = measureLoudness(specTone.file);
const specA = assessLoudness(specM);
console.log(`     合规范的测试音（振幅 ${specTone.amp.toFixed(4)}）→ ${formatLoudness(specM)}`);
check('恰好 −14 LUFS 的测试音判为**达标**（三档里最高的一档）', specA.ok && specA.tier === 'ok', specA.verdict);
check('  它的 |i − (−14)| ≤ 容差，且真峰 ≤ −1 dBTP',
  Math.abs(specA.di) <= specA.tolLu && specA.peakOk,
  `di=${specA.di.toFixed(2)} LU，tp=${specM.tp.toFixed(2)} dBTP`);

const tooLoud = assessLoudness(measured[2].m); // 峰值 −6 dBFS
check('峰值 −6 dBFS（约 −3 LUFS）被判为**越界**（loudness）', !tooLoud.ok && tooLoud.violations.some((v) => v.kind === 'loudness'),
  `di=+${tooLoud.di.toFixed(2)} LU`);
const tooQuiet = assessLoudness(measured[0].m); // 峰值 −20 dBFS
check('峰值 −20 dBFS（约 −17 LUFS）被判为**越界**（太轻也算不达标）', !tooQuiet.ok && tooQuiet.violations.some((v) => v.kind === 'loudness'),
  `di=${tooQuiet.di.toFixed(2)} LU`);

// 真峰是**上限**：比目标轻不算越界（不能要求"必须刚好 −1"）
const lightPeak = assessLoudness({ i: -14, tp: -12.0, lra: 3 });
check('真峰比 −1 dBTP 轻很多**不算越界**（上限而非等号）', lightPeak.peakOk && lightPeak.ok, `tp=${lightPeak.tp ?? -12} dBTP`);
// 越界必须点名：只报"ok: false"没用，得说清是哪一条
const hot = assessLoudness({ i: -14, tp: 0.3, lra: 3 });
check('真峰 +0.30 dBTP 单独越界 → 报 true-peak', !hot.ok && hot.violations.length === 1 && hot.violations[0].kind === 'true-peak',
  hot.violations[0]?.text ?? '');
// 非有限值必须报错，不能当"没测过"混过去
const nan = assessLoudness({ i: NaN, tp: -1.2, lra: 2 });
check('input_i = NaN → 判为 error（不是"没测"也不是"通过"）', !nan.ok && nan.violations.some((v) => v.kind === 'nan'));
// LRA 越界只是 warn，不该 gate（口播 + 音乐床天然就宽）
const wide = assessLoudness({ i: -14, tp: -2, lra: 15.5 });
check('LRA 超上限只降级为 warn（不 gate）', wide.ok && wide.tier === 'warn' && wide.violations[0].kind === 'lra',
  `dlra=+${wide.dlra.toFixed(1)} LU`);

/**
 * 自己算一遍 **true peak**（4× 过采样重建，ITU-R BS.1770-4 的做法）—— 用来独立核对 loudnorm 的那个数。
 *
 * 为什么值得自己写一遍：`input_tp` 如果只是把采样峰值抄一遍，值上**看不出来**
 * （一段平滑的信号两者本来就接近）。只有拿一个**独立实现**去比，才能证明它真的是"采样间峰值"。
 * 这里用加窗 sinc（Lanczos，a=16）：在每个采样点之间插入 3 个点，取绝对值最大者。纯 JS，不需要 GPU。
 */
function truePeakDb (samples) {
  const A = 16; // 窗口半宽（采样点）
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const sinc = (d) => (Math.abs(d) < 1e-12 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d));
  let tp = 0;
  for (let n = A + 1; n < samples.length - A - 1; n++) {
    for (let k = 1; k <= 3; k++) {
      const x = n + k / 4;
      let acc = 0;
      for (let m = Math.ceil(x) - A; m <= Math.floor(x) + A; m++) {
        const d = x - m;
        // Lanczos 窗：sinc(d) × sinc(d/A)，且**出窗必须夹成 0**（不夹会算出比采样峰还高的假值）
        const w = Math.abs(d) >= A ? 0 : sinc(d / A);
        acc += samples[m] * sinc(d) * w;
      }
      tp = Math.max(tp, Math.abs(acc));
    }
  }
  const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
  return { samplePeakDb: db(peak), truePeakDb: db(tp) };
}

/**
 * 量一个文件的真峰（自算版）：**每条声道各算一遍取最大**。
 *
 * ⚠ 不能图省事用 `decodeMono()`：它内部是 `ffmpeg -ac 1`，而 **ffmpeg 的下混是"求和"不是"平均"**
 * ——双声道同相的文件会被加出 **+3.01 dB**（实测：astats 每声道峰 −6.02 dBFS，decodeMono 报 −3.01）。
 * 拿它去和自己写的真峰比会凭空多出 3 dB 的假差值（第一版就是这么错的）。
 * 这里显式解成立体声、逐声道取最大。
 */
const truePeakOfFile = (file) => {
  const [L, R] = decodeChannels(file, 48000, 2);
  const a = truePeakDb(L);
  const b = truePeakDb(R);
  return {
    samplePeakDb: Math.max(a.samplePeakDb, b.samplePeakDb),
    truePeakDb: Math.max(a.truePeakDb, b.truePeakDb),
    chans: [a, b],
  };
};

/* ── 3. 真峰：削顶 / 接近 0dBFS 的信号必须被判越界 ── */
console.log('\n③ true peak：削顶 / 近 0dBFS 的信号必须越界');
/**
 * 这里用的是一段**真的削平了的**音：0.98 振幅的正弦再 +6 dB，于是 16bit PCM 直接把它切成
 * 满刻度的平顶方波（削顶本身是有损编码/母带过载最常见的现场）。
 * 真峰会稳在 0 dBTP 上下 —— **这一条与采样峰值无关**，只回答"听众那里会不会削"。
 *
 * ⚠ 别指望"任何接近 0dBFS 的正弦都能量出采样间过冲"：实测 11703Hz（≈fs/4）0.98 振幅的
 * 正弦 + MP3，loudnorm 报的 −0.11 dBTP **就是**它每声道的采样峰（0.9879 = −0.11 dBFS），
 * 我自己的 4× 过采样也算出真峰 −0.33（比采样峰还低一点）—— 两条独立路径一致，
 * 说明那个数**没问题**：那种信号的峰值正好落在采样点附近，没有过冲可测。
 */
const CLIP_EXPR = '0.98*sin(2*PI*997*t)*2'; // ×2 ≈ +6 dB ⇒ 削顶到 ±1
const hotFile = path.join(DIR, 'fixtures', 'clipped.mp3');
ff(['-y', '-v', 'error', '-f', 'lavfi',
  '-i', `aevalsrc=${CLIP_EXPR}|${CLIP_EXPR}:s=48000:d=4`,
  '-c:a', 'pcm_s16le', path.join(DIR, 'fixtures', 'clipped.wav')]);
ff(['-y', '-v', 'error', '-i', path.join(DIR, 'fixtures', 'clipped.wav'),
  '-c:a', 'libmp3lame', '-b:a', '192k', hotFile]);
const hotM = measureLoudness(hotFile);
const hotA = assessLoudness(hotM);
// 独立核对：自己用 4× 过采样算一遍真峰，看 loudnorm 报的是不是同一个东西
const own = truePeakOfFile(hotFile);
console.log(`     削顶信号（0.98 正弦 ×2，16bit 削平，MP3 192k）→ ${formatLoudness(hotM)}`);
console.log(`     自己 4× 过采样算：每声道采样峰 ${own.samplePeakDb.toFixed(2)} dBFS → 真峰 ${own.truePeakDb.toFixed(2)} dBTP；loudnorm 报 ${hotM.tp.toFixed(2)} dBTP`);
check('它的真峰被量到（不是 NaN）', Number.isFinite(hotM.tp), `${hotM.tp.toFixed(2)} dBTP`);
check('loudnorm 的真峰与**自己算的**一致（差 ≤1.0 dB）—— 两条独立路径互相印证，不是抄采样峰值',
  Math.abs(hotM.tp - own.truePeakDb) <= 1.0,
  `loudnorm ${hotM.tp.toFixed(2)} vs 自算 ${own.truePeakDb.toFixed(2)} dBTP`);
check('采样峰已到满刻度（削平了），所以这是"听众那里会削"的现场', own.samplePeakDb >= -0.2,
  `${own.samplePeakDb.toFixed(2)} dBFS`);
check('近 0dBFS 的信号被判为**越界**（true-peak）',
  !hotA.ok && hotA.violations.some((v) => v.kind === 'true-peak'),
  `tp=${hotM.tp.toFixed(2)} dBTP > 上限 ${hotM.target.tp} dBTP`);
// 反向对照：同一段信号的**轻**版本必须过真峰那一条（证明判据不是"永远报越界"）
const softFile = path.join(DIR, 'fixtures', 'soft.mp3');
ff(['-y', '-v', 'error', '-f', 'lavfi',
  '-i', `aevalsrc=0.5*sin(2*PI*997*t)|0.5*sin(2*PI*997*t):s=48000:d=4`,
  '-c:a', 'libmp3lame', '-b:a', '192k', softFile]);
const softM = measureLoudness(softFile);
const softA = assessLoudness(softM);
check('反向对照：峰 −6 dBFS 的同一段信号**真峰那一条是过的**', softA.peakOk,
  `tp=${softM.tp.toFixed(2)} dBTP ≤ ${softM.target.tp}（它只是响度不达标，不是真峰越界）`);

/* ── 4. 解析：必须取**最后一段完整 JSON**（包装器 + 进度行会掺进 stderr） ──
 *
 * 真正的现场是：`ANIM_FFMPEG` 指向包装器（`tools/slow-ffmpeg.mjs` 就是），
 * 它自己的输出与 ffmpeg 的 `size=N/A time=…` 进度行都混在 stderr 里，
 * 而 loudnorm 的 JSON 在**最末尾**。天真地从第一个 `{` 匹配到第一个 `}` 会拿到垃圾。 */
console.log('\n④ stderr 解析：取最后一段完整 JSON，不是第一段');
const FIRST = '{"input_i":"-99.90","input_tp":"-99.90","input_lra":"9.90","input_thresh":"-99.90","target_offset":"-9.90"}';
// 诱饵：中间先有一段**能解析**的假 JSON（包装器的日志），最后才是真 loudnorm 那段；
// 真 loudnorm 的格式就是 ffmpeg 原样：多行、制表符缩进、值全是字符串。
const LAST = `{
\t"input_i" : "-33.33",
\t"input_tp" : "-0.10",
\t"input_lra" : "5.55",
\t"input_thresh" : "-44.44",
\t"target_offset" : "0.11"
}`;
const noisy = [
  'size=N/A time=00:00:01.00 bitrate=N/A speed=1x',
  `[wrapper] 我自己的日志 ${FIRST}`,
  'size=N/A time=00:00:02.00 bitrate=N/A speed=1x',
  '[Parsed_loudnorm_0 @ 0x1]',
  LAST,
  '[out#0/null @ 0x2] muxing overhead: unknown',
  '{ 尾随的垃圾（没有配对的右括号', // ← 真实 stderr 的尾巴长这样：最后那个 `{` 解析不出来
].join('\n');
const parsed = parseLoudnormJson(noisy);
check('解析到的是**最后**那段（−33.33），不是中间那段（−99.90）',
  parsed?.input_i === '-33.33', `input_i = ${parsed?.input_i}`);
check('末尾的残缺花括号不会让它解析失败（会继续往前找）', parsed !== null);
check('完全没有 JSON 时返回 null（不抛错，让调用方决定）', parseLoudnormJson('nothing here') === null);
const mFromText = measureLoudness('(stderr)', { stderr: noisy });
check('measureLoudness({ stderr }) 走同一条解析路径', Math.abs(mFromText.i - -33.33) < 1e-9, formatLoudness(mFromText));

/* 真·端到端：用一个**会往 stderr 里掺假 JSON** 的包装器跑真 ffmpeg，
 * 断言拿到的是真 ffmpeg 的数字（−14 那一档），而不是包装器伪造的那段。 */
const wrapper = path.join(DIR, 'noisy-wrapper.mjs');
writeFileSync(wrapper, `// 假包装器（tools/test-loudness.mjs 生成）：先往 stderr 掺一段假 JSON，再转发真 ffmpeg
import { spawnSync } from 'node:child_process';
const { ANIM_REAL_FFMPEG: real, ...env } = process.env;
process.stderr.write('[wrapper] 假装我量到了 ${FIRST}\\n');
const r = spawnSync(real, process.argv.slice(2), { stdio: 'inherit', env });
if (r.error) { process.stderr.write(String(r.error.message) + '\\n'); process.exit(127); }
process.exit(r.status ?? 1);
`, 'utf8');
const wrappedFile = specTone.file; // −14 LUFS 的那一段：掺假 JSON 的包装器不能把它变成 −99.90
const prevFfmpeg = process.env.ANIM_FFMPEG;
const prevReal = process.env.ANIM_REAL_FFMPEG;
process.env.ANIM_FFMPEG = `"${process.execPath}" "${wrapper}"`;
process.env.ANIM_REAL_FFMPEG = FFMPEG;
let wrapped = null;
let wrappedErr = null;
try {
  wrapped = measureLoudness(wrappedFile);
} catch (e) {
  wrappedErr = e;
} finally {
  if (prevFfmpeg === undefined) delete process.env.ANIM_FFMPEG; else process.env.ANIM_FFMPEG = prevFfmpeg;
  if (prevReal === undefined) delete process.env.ANIM_REAL_FFMPEG; else process.env.ANIM_REAL_FFMPEG = prevReal;
}
check('ANIM_FFMPEG 包装器掺假 JSON 时，拿到的是**真 ffmpeg** 的数字',
  !!wrapped && Math.abs(wrapped.i - -14) <= 1.0,
  wrapped ? `${formatLoudness(wrapped)}（包装器伪造的是 −99.90；同一文件不经包装器是 ${formatLoudness(specM)}）` : `抛错：${wrappedErr?.message.split('\n')[0]}`);
check('  而且拿到的不是包装器伪造的那一段',
  !!wrapped && Math.abs(wrapped.i - -99.9) > 1e-6, wrapped ? `i = ${wrapped.i}` : '(抛错了)');

/* ── 5. 失败必须**可区分**，不能吞成一个 null 让上游以为"测过了" ── */
console.log('\n⑤ 失败模式：可区分，不吞成 null');
const kinds = [];
for (const [name, fn] of [
  ['文件不存在', () => measureLoudness(path.join(DIR, 'no-such-file.mp3'))],
  ['不是音频（一个文本文件）', () => {
    const bad = path.join(DIR, 'fixtures', 'not-audio.mp3');
    writeFileSync(bad, '这不是音频\n', 'utf8');
    return measureLoudness(bad);
  }],
  ['路径为空', () => measureLoudness('')],
]) {
  try {
    fn();
    kinds.push([name, '(没有抛错 ✗)']);
  } catch (e) {
    kinds.push([name, e.kind ?? '(没有 kind ✗)']);
  }
}
for (const [name, kind] of kinds) {
  check(`${name} → 抛错且带 kind`, kind !== '(没有抛错 ✗)' && kind !== '(没有 kind ✗)', String(kind));
}
check('"没有 ffmpeg" 与 "文件读不到" 是**不同**的 kind',
  kinds[0][1] === 'no-input' && kinds[1][1] === 'ffmpeg-error', kinds.map((k) => k[1]).join(' / '));

/* ── 6. 仓库里**真实存在**的音轨：跑一次，把数字打出来 ──
 *
 * ⚠ 只读：直接量仓库里的文件，**不复制、不写仓库**（产物一律在 os.tmpdir()）。 */
console.log('\n⑥ 真实音轨（只读测量，数字就是结论）');
const CANDIDATES = [
  'tasks/sodium/audio/sodium-mix.mp3',
  'tasks/optifine/audio/optifine-mix.mp3',
  'tasks/sodium/audio/sodium-vo.mp3',
  'tasks/optifine/audio/optifine-vo.mp3',
  'tasks/beast/audio/beast-vo.mp3',
];
let real = null;
for (const rel of CANDIDATES) {
  const p = path.join(ROOT, rel);
  try {
    real = { rel, m: measureLoudness(p) };
    break;
  } catch (e) {
    if (e.kind === 'no-input') continue;
    console.log(`     ⚠ ${rel}：${String(e.message).split('\n')[0]}`);
  }
}
if (!real) {
  console.log('     （本机 tasks/*/audio/ 下没有可量的音轨 —— 跳过这一段）');
  check('真实音轨：本机没有可量的文件', true, '跳过（不算失败）');
} else {
  const { rel, m } = real;
  const a = assessLoudness(m);
  console.log(`     文件：${rel}`);
  console.log(`     数字：${formatLoudness(m)}   （真峰 = true peak，不是采样峰值）`);
  console.log(`     判据：${a.tier === 'ok' ? '✓ ' : a.tier === 'warn' ? '⚠ ' : '✗ '}${a.verdict}`);
  console.log(`     离目标：i ${a.di > 0 ? '+' : ''}${a.di.toFixed(2)} LU · tp ${a.dtp > 0 ? '+' : ''}${a.dtp.toFixed(2)} dB · lra ${a.dlra > 0 ? '+' : ''}${a.dlra.toFixed(2)} LU`);
  console.log(`     （这就是"你听不见，就报数字"要的那一行：LUFS / true peak / LRA 都在上面）`);
  check('真实音轨量出了有限的整合响度', Number.isFinite(m.i), `${m.i.toFixed(2)} LUFS`);
  check('真实音轨量出了有限的真峰', Number.isFinite(m.tp), `${m.tp.toFixed(2)} dBTP`);
  check('LRA 是非负数', Number.isFinite(m.lra) && m.lra >= 0, `${m.lra.toFixed(2)} LU`);
  check('判据能对这个真实文件给出三档之一', ['ok', 'warn', 'error'].includes(a.tier), a.tier);
}

/* ── 7. `seconds`（`-t`）真的截断了吗？截断读数是**不能当结论**的（BACKLOG 头部 ⑤） ──
 *
 * `check --quick` 用这一档省钱：4 分钟的轨整条要 6–14s，而快捷体检只想看数字有没有离谱。
 * 判据必须钉住两件事，否则"省时档"会静默变成一个**看着像结论的错数字**：
 *   ① `-t` 落在正确的位置（`-i` 之后、`-af` 之前）—— 放错位置它就成了输入选项，语义完全不同；
 *   ② 它**真的**只量了前 N 秒：拿"先静音、后有声"的夹具量，截断那次的整合响度必须掉下去。 */
console.log('\n⑦ seconds（-t）：位置对、真的截断（截断读数不当结论用）');
const winFile = path.join(DIR, 'fixtures', 'silence-then-tone.wav');
const toneCh = `${10 ** (-14 / 20)}*sin(2*PI*997*t)`;
ff(['-y', '-v', 'error', '-f', 'lavfi',
  '-i', `aevalsrc=0|0:s=48000:d=1.5`,                    // 先 1.5 秒**数字静音**
  '-f', 'lavfi', '-i', `aevalsrc=${toneCh}|${toneCh}:s=48000:d=3`,   // 再 3 秒 −14dBFS 的测试音
  '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1',
  '-c:a', 'pcm_s16le', winFile]);
const winFull = measureLoudness(winFile);
const winPart = measureLoudness(winFile, { seconds: 1.5 });
console.log(`     整条 3+1.5s：${formatLoudness(winFull)}  seconds=${winFull.seconds}`);
console.log(`     只量前 1.5s：${formatLoudness(winPart)}  seconds=${winPart.seconds}`);
check('seconds 会回显在结果里（没截断时是 null）', winFull.seconds === null && winPart.seconds === 1.5,
  `${winFull.seconds} / ${winPart.seconds}`);
// ⚠ 这一条**是量出来的**：`-t` 放在 `-i` 之后（输出侧）时 muxer 只写 1.5s，
//   但滤镜图仍然吃到整条轨 ⇒ loudnorm 报的还是全片读数（实测 -14.27 vs 静音应有的 -inf）。
//   所以判据写死"输入侧"：`-t` 必须在 `-i` **之前**。
check('-t 是**输入侧**选项（在 -i 之前；放到输出侧就成了"看着像结论的错数字"）',
  winPart.argv.indexOf('-t') >= 0 && winPart.argv.indexOf('-t') < winPart.argv.indexOf('-i'),
  winPart.argv.join(' ').slice(0, 120));
check('整条不给 -t', !winFull.argv.includes('-t'));
check('截断那一次**真的**只看到了静音（读数必须掉下去）',
  !Number.isFinite(winPart.i) || winPart.i < winFull.i - 20,
  `整条 ${Number(winFull.i).toFixed(2)} → 前 1.5s ${winPart.i}`);
check('这正是"截断读数不能当结论"的证据：两次的 LUFS 不一样',
  winPart.i !== winFull.i, `${winFull.i} vs ${winPart.i}`);

/* ── 收尾 ── */
console.log(`\n${'─'.repeat(64)}`);
console.log(`通过 ${pass}/${pass + fail}${fail ? `　❌ 失败 ${fail}` : '　✅ 全部通过'}`);
console.log(`夹具在 ${DIR}（os.tmpdir()，**没有往仓库里写任何文件**）`);
console.log('接线：anim mix 收尾打印这一行、check 里对 packaging 轨跑一遍（见本文件顶部说明与父代理报告）。');
process.exit(fail ? 1 : 0);
