// @ts-check
/**
 * 把旁白 + 音乐床混成**一条**交给引擎的音轨（`anim mix`）。
 *
 * ## 为什么这一步必须存在
 *
 * 引擎只有**一条音轨**的抽象（`task.audio`），没有 sidechain、没有多轨混音
 * —— 这是 `docs/NARRATION.md` 记的能力缺口。缺了它，"说话时把音乐压下去"（闪避）
 * 就只能在引擎外面手搓。做 `tasks/beast` 时那一版手搓的脚本在
 * `tasks/beast/tools/mix.mjs`（86 行），每支带旁白的片子都要重写一遍；
 * 这里把它收进引擎，参数化了。
 *
 * 做三件事（与 beast 那版一致，数值也是那版实测调出来的）：
 *   ① 按 `audio/timing.json` 把每句旁白摆到它的**绝对时刻**上；
 *   ② 用旁白自己的包络做闪避（说话时音乐压到约 −13 dB，说完慢慢恢复）；
 *   ③ 输出一条混音轨（mp3）+ 一份 wav 备查，并打印说话占比。
 *
 * ⚠ 这一层**不进浏览器**：`anim mix` 是 CLI 侧的一次性构建步骤，产物是文件。
 * 引擎照旧只认一条轨（`audio: { music, vo, mix }` 里的 `mix`）。
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assessLoudness, decodeChannels, decodeMono, encodeMp3, formatLoudness, measureLoudness, normalize, probeDuration, readTaskAudioSpec, taskRel, writeWav16 } from './media.mjs';

/** beast 那一版实测的默认值 —— 改这些之前先听一遍，别凭感觉调。 */
export const DEFAULT_DUCK = {
  /** 语音门限（包络峰值）：低于它算"没人说话" */
  gate: 0.02,
  /** 起音系数（越大压得越快）：说话时音乐要**马上**让路 */
  attack: 0.35,
  /** 释放系数（越小恢复越慢）：说完不要"啪"地弹回来 */
  release: 0.06,
  /** 压多深：gain = 1 - depth * lvl，0.78 ≈ 音乐只剩 22%（−13 dB） */
  depth: 0.78,
  /** 音乐床总增益 */
  bedGain: 0.78,
  /** 旁白总增益 */
  voGain: 1.9,
};

/**
 * 把 timing 表里的每句旁白摆到绝对时刻上，得到一条纯旁白轨。
 *
 * 时刻的算法与 `anim say` 写表时**完全一致**：`scene.start + line.offset`
 * （`offset` 已经是"内部 cue × stretch"折算过的整片时间），所以这里不重算节奏。
 *
 * @param {any} timing `audio/timing.json` 的内容
 * @param {string} taskDir 任务目录（`file` 字段相对它）
 * @param {{ sr?: number, total?: number, onLine?: (line: any, i: number) => void }} [opts]
 * @returns {{ vo: Float32Array, sr: number, total: number, voiced: number }}
 */
export function placeVo(timing, taskDir, opts = {}) {
  const sr = opts.sr ?? 44100;
  const total = opts.total ?? Number(timing.total);
  if (!(total > 0)) throw new Error('timing.total 不是正数 —— timing.json 坏了，重跑 anim say');
  const n = Math.ceil(total * sr);
  const vo = new Float32Array(n);
  let voiced = 0;
  for (const sc of timing.scenes ?? []) {
    for (const line of sc.lines ?? []) {
      const file = path.join(taskDir, line.file);
      const samples = decodeMono(file, sr);
      const at = Math.round((sc.start + line.offset) * sr);
      for (let i = 0; i < samples.length; i++) {
        const idx = at + i;
        if (idx >= 0 && idx < n) vo[idx] += samples[i];
      }
      voiced += samples.length / sr;
      opts.onLine?.(line, sc);
    }
  }
  return { vo, sr, total, voiced };
}

/**
 * 旁白包络 → 闪避增益曲线（每个采样点一个增益）。
 *
 * 15ms 取包（峰值）→ 单极点平滑（起音快、释放慢）。
 * 用**峰值**而不是 RMS：齿音和爆破音也要让路，RMS 会漏掉它们。
 *
 * @param {Float32Array} vo
 * @param {number} sr
 * @param {typeof DEFAULT_DUCK} [params]
 * @returns {{ gain: Float32Array, duckedRatio: number }}
 */
export function duckGain(vo, sr, params = DEFAULT_DUCK) {
  const p = { ...DEFAULT_DUCK, ...params };
  const hop = Math.round(0.015 * sr);
  const frames = Math.ceil(vo.length / hop);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let peak = 0;
    const i0 = f * hop;
    for (let i = i0; i < Math.min(i0 + hop, vo.length); i++) peak = Math.max(peak, Math.abs(vo[i]));
    env[f] = peak;
  }
  const gain = new Float32Array(vo.length);
  let lvl = 0;
  let duckedFrames = 0;
  for (let f = 0; f < frames; f++) {
    const target = env[f] > p.gate ? 1 : 0;
    const k = target > lvl ? p.attack : p.release;
    lvl += (target - lvl) * k;
    if (lvl > 0.5) duckedFrames++;
    const g = 1 - p.depth * lvl;
    const i0 = f * hop;
    for (let i = i0; i < Math.min(i0 + hop, gain.length); i++) gain[i] = g;
  }
  return { gain, duckedRatio: frames ? duckedFrames / frames : 0 };
}

/**
 * 混音。旁白居中（两边同相），音乐按闪避增益走。
 * @param {{ vo: Float32Array, musicL: Float32Array, musicR: Float32Array, gain: Float32Array,
 *           voGain?: number, bedGain?: number }} a
 * @returns {{ L: Float32Array, R: Float32Array, peakRaw: number }}
 */
export function mixTracks({ vo, musicL, musicR, gain, voGain = DEFAULT_DUCK.voGain, bedGain = DEFAULT_DUCK.bedGain }) {
  const n = vo.length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let peakRaw = 0;
  for (let i = 0; i < n; i++) {
    const g = gain[i] * bedGain;
    const v = vo[i] * voGain;
    const l = (musicL[i] ?? 0) * g + v;
    const r = (musicR[i] ?? 0) * g + v;
    L[i] = l; R[i] = r;
    peakRaw = Math.max(peakRaw, Math.abs(l), Math.abs(r));
  }
  return { L, R, peakRaw };
}

/** 只出旁白轨（没有音乐时也至少有一条能听的轨；`anim say` 收尾时调它）。 */
export function renderVo({ timing, taskDir, out, sr = 44100, bitrate = '192k' }) {
  const { vo, total, voiced } = placeVo(timing, taskDir, { sr });
  const wav = out.replace(/\.mp3$/i, '.wav');
  const chans = [vo, vo];
  normalize(chans, 0.89);
  writeWav16(wav, chans, sr);
  encodeMp3(wav, out, bitrate);
  return { file: out, wav, total, voiced, duration: probeDuration(out) };
}

/** 找一个能当音乐床的音轨：显式 --music > task.audio.music > task.audio.mix > 任务目录里第一个音频。 */
export function resolveMusic(taskDir, explicit) {
  if (explicit) {
    const f = taskRel(taskDir, explicit);
    if (!existsSync(f)) throw new Error(`--music 指的文件不存在：${f}`);
    return f;
  }
  const spec = readTaskAudioSpec(taskDir);
  if (spec && typeof spec === 'object') {
    for (const key of ['music', 'mix']) {
      const f = taskRel(taskDir, spec[key]);
      if (f && existsSync(f)) return f;
    }
  } else if (typeof spec === 'string') {
    const f = taskRel(taskDir, spec);
    if (f && existsSync(f)) return f;
  }
  throw new Error(
    '找不到音乐床。用 --music <文件> 指定，或在 task.config.mjs 里写 '
    + "audio: { music: './audio/xxx.mp3', vo: './audio/……-vo.mp3', mix: './audio/……-mix.mp3' }。",
  );
}

/**
 * `anim mix` 的实现。
 *
 * @param {string} task 任务名
 * @param {{ taskDir: string, music?: string, out?: string, duck?: Partial<typeof DEFAULT_DUCK>,
 *           sr?: number, bitrate?: string, voOnly?: boolean, log?: (...a:any[])=>void }} opts
 */
export function runMix(task, opts) {
  const log = opts.log ?? console.log;
  const taskDir = opts.taskDir;
  const sr = opts.sr ?? 44100;
  const timingFile = path.join(taskDir, 'audio', 'timing.json');
  if (!existsSync(timingFile)) {
    throw new Error(`没有 ${path.relative(process.cwd(), timingFile)} —— 先跑 anim say ${task}（它才会算出每段的起点与时长）。`);
  }
  const timing = JSON.parse(readFileSync(timingFile, 'utf8'));
  const duck = { ...DEFAULT_DUCK, ...(opts.duck ?? {}) };

  const { vo, total, voiced } = placeVo(timing, taskDir, { sr });
  const { gain, duckedRatio } = duckGain(vo, sr, duck);

  if (opts.voOnly) {
    const out = opts.out ? path.resolve(opts.out) : path.join(taskDir, 'audio', `${task}-vo.mp3`);
    const r = renderVo({ timing, taskDir, out, sr, bitrate: opts.bitrate });
    log(`✓ ${path.relative(process.cwd(), r.file)}  ${r.duration.toFixed(2)}s（只有旁白）`);
    return { ok: true, file: r.file, timing };
  }

  const music = resolveMusic(taskDir, opts.music);
  const musicDur = probeDuration(music);
  if (musicDur + 0.05 < total) {
    log(`⚠ 音乐床 ${path.basename(music)} 只有 ${musicDur.toFixed(2)}s，片子 ${total.toFixed(2)}s —— 后面 ${(total - musicDur).toFixed(2)}s 会没有音乐（引擎不会自动循环）。`);
  } else if (musicDur > total + 0.05) {
    log(`· 音乐床 ${musicDur.toFixed(2)}s 比片子 ${total.toFixed(2)}s 长，按片子长度裁掉尾巴。`);
  }
  const [musicL, musicR] = decodeChannels(music, sr, 2);
  const { L, R, peakRaw } = mixTracks({ vo, musicL, musicR, gain, voGain: duck.voGain, bedGain: duck.bedGain });
  const { gain: norm } = normalize([L, R], 0.89);

  const wav = path.join(taskDir, 'audio', `${task}-mix.wav`);
  const mp3 = opts.out ? path.resolve(opts.out) : path.join(taskDir, 'audio', `${task}-mix.mp3`);
  writeWav16(wav, [L, R], sr);
  encodeMp3(wav, mp3, opts.bitrate);
  const dur = probeDuration(mp3);

  /**
   * 音频的**数字守门**（BACKLOG 1-20）——「你听不见，就报数字」。
   * 只报，**不 gate、不自动归一化**：归一化会改动所有带旁白片子的音轨 = 已交付片子全部重出。
   * 它 spawnSync 跑 ffmpeg（约 3s/分钟），放在这里是因为 `mix` 本来就是 CLI 侧一次性的批处理步骤。
   */
  try {
    const t0 = Date.now();
    const m = measureLoudness(mp3);
    const a = assessLoudness(m);
    log(`  响度 ${formatLoudness(m)}  ${a.tier === 'ok' ? '✓' : a.tier === 'warn' ? '⚠' : '✗'} ${a.verdict}`);
    if (a.tier === 'error') {
      log(`    靶子是 ${m.target.i} LUFS / ${m.target.tp} dBTP（主流平台归一化目标）—— 只报数字，不动音轨。`);
    }
    log(`    （量了 ${((Date.now() - t0) / 1000).toFixed(1)}s；4 分钟的轨约 12s）`);
  } catch (e) {
    log(`  ⚠ 响度没量成（${e.kind}）：${String(e.message).split('\n')[0]}`);
  }

  const rel = (f) => path.relative(taskDir, f).replace(/\\/g, '/');
  log(`✓ ${path.relative(process.cwd(), mp3)}  ${dur.toFixed(2)}s  ${timing.scenes?.length ?? 0} 段`);
  log(`  说话 ${voiced.toFixed(1)}s / ${total.toFixed(1)}s = ${((voiced / total) * 100).toFixed(0)}%（其余是留白与呼吸）`);
  log(`  峰值 ${peakRaw.toFixed(2)} → 归一 ${norm.toFixed(2)}×，音乐 ×${duck.bedGain}，旁白 ×${duck.voGain}`
    + `，闪避最深 −${(20 * Math.log10(1 / Math.max(1e-6, 1 - duck.depth))).toFixed(0)} dB`
    + `（有 ${(duckedRatio * 100).toFixed(0)}% 的时间压着）`);
  log(`  在 task.config.mjs 里写：audio: { music: './${rel(music)}', vo: './${rel(path.join(taskDir, 'audio', `${task}-vo.mp3`))}', mix: './${rel(mp3)}' }`);
  return { ok: true, file: mp3, wav, music, timing, voiced, total, norm, peakRaw };
}
