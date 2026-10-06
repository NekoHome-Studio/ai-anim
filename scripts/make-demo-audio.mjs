#!/usr/bin/env node
// @ts-check
/**
 * 生成一段测试音乐（纯合成，无版权问题）。给 examples/beat 用。
 *
 *   node scripts/make-demo-audio.mjs [输出路径] [秒数] [bpm]
 *
 * 做法很朴素但足够真实：kick = 带音高下滑的正弦 × 指数衰减，
 * hat = 高通化的噪声，snare = 噪声 + 音体，bass 走简谱。
 * 目标是让节拍检测、低频/中频包络都有东西可抓。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? path.join(ROOT, 'tasks', 'beat', 'audio', 'demo-loop.wav');
const seconds = Number(process.argv[3] ?? 32);
const bpm = Number(process.argv[4] ?? 120);
const sr = 44100;

const n = Math.round(seconds * sr);
const L = new Float32Array(n);
const R = new Float32Array(n);
const beat = 60 / bpm;

/** 确定性噪声（不要 Math.random，保证每次生成的文件完全一样） */
let seed = 0x1234abcd;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296 - 0.5;
};

/** 一段音符的简谱（半音相对根音），每拍一个，-1 表示休止 */
const bassLine = [0, -1, 7, -1, 3, -1, 5, -1, 0, -1, 7, -1, 10, -1, 7, -1];
const root = 55; // A1

function addKick(t0, gain = 1) {
  const dur = 0.42;
  for (let i = 0; i < dur * sr; i++) {
    const t = i / sr;
    const idx = Math.round(t0 * sr) + i;
    if (idx < 0 || idx >= n) continue;
    const f = 120 * Math.exp(-t * 26) + 42;         // 音高下滑
    const env = Math.exp(-t * 7.5) * (1 - Math.exp(-t * 900));
    const v = Math.sin(2 * Math.PI * f * t) * env * 0.95 * gain;
    L[idx] += v; R[idx] += v;
  }
}

function addHat(t0, gain = 0.5, dur = 0.05) {
  let prev = 0;
  for (let i = 0; i < dur * sr; i++) {
    const t = i / sr;
    const idx = Math.round(t0 * sr) + i;
    if (idx < 0 || idx >= n) continue;
    const w = rnd();
    const hp = w - prev; prev = w;                 // 一阶高通，听上去更"嘶"
    const env = Math.exp(-t * 90);
    const v = hp * env * 0.32 * gain;
    L[idx] += v * 0.8; R[idx] += v;
  }
}

function addSnare(t0, gain = 0.7) {
  for (let i = 0; i < 0.22 * sr; i++) {
    const t = i / sr;
    const idx = Math.round(t0 * sr) + i;
    if (idx < 0 || idx >= n) continue;
    const env = Math.exp(-t * 22);
    const body = Math.sin(2 * Math.PI * 185 * t) * 0.5;
    const v = (rnd() * 1.6 + body) * env * 0.5 * gain;
    L[idx] += v; R[idx] += v;
  }
}

function addBass(t0, semi, dur, gain = 0.5) {
  if (semi < 0) return;
  const f = root * 2 ** (semi / 12);
  for (let i = 0; i < dur * sr; i++) {
    const t = i / sr;
    const idx = Math.round(t0 * sr) + i;
    if (idx < 0 || idx >= n) continue;
    const env = Math.min(1, t * 60) * Math.exp(-t * 2.2) * (1 - Math.min(1, Math.max(0, (t - dur + 0.06) / 0.06)));
    // 加一点二次谐波，低频才"实"
    const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)) * env * 0.5 * gain;
    L[idx] += v; R[idx] += v;
  }
}

function addPad(t0, dur, gain = 0.16) {
  const freqs = [220, 277.18, 329.63, 440]; // A 大三和弦
  for (let i = 0; i < dur * sr; i++) {
    const t = i / sr;
    const idx = Math.round(t0 * sr) + i;
    if (idx < 0 || idx >= n) continue;
    const env = Math.min(1, t * 3) * Math.min(1, Math.max(0, (dur - t) / 0.6));
    let v = 0;
    for (let k = 0; k < freqs.length; k++) {
      const d = 1 + 0.0015 * Math.sin(2 * Math.PI * (0.2 + k * 0.07) * t); // 轻微失谐
      v += Math.sin(2 * Math.PI * freqs[k] * d * t + k) / freqs.length;
    }
    const vv = v * env * gain;
    L[idx] += vv * (0.9 + 0.1 * Math.sin(t * 0.7));
    R[idx] += vv * (0.9 - 0.1 * Math.sin(t * 0.7));
  }
}

// 编排：每 8 拍一段，前 8 拍只有 kick，逐段加东西（这样段落检测也有活干）
const bars = Math.floor(seconds / (beat * 4));
for (let bar = 0; bar < bars; bar++) {
  const t0 = bar * beat * 4;
  const section = Math.floor(bar / 4);
  for (let b = 0; b < 4; b++) {
    const tb = t0 + b * beat;
    addKick(tb, 1);
    if (section >= 1) addHat(tb + beat * 0.5, 0.42);
    if (section >= 2) { addSnare(tb + beat * 1); addSnare(tb + beat * 3); }
    if (section >= 1) addBass(tb, bassLine[(bar * 4 + b) % bassLine.length], beat * 0.9, 0.55);
  }
  if (section >= 2) addPad(t0, beat * 4, 0.15);
  if (section >= 3) for (let i = 0; i < 8; i++) addHat(t0 + (i * beat) / 2, 0.3, 0.035);
}

// 收尾：最后 2 秒淡出
const fade = Math.round(2 * sr);
for (let i = 0; i < fade; i++) {
  const k = i / fade;
  const idx = n - fade + i;
  if (idx < 0) continue;
  L[idx] *= k; R[idx] *= k;
}

// 软削波 + 写 16bit WAV
const head = Buffer.alloc(44);
const dataBytes = n * 2 * 2;
head.write('RIFF', 0, 'ascii');
head.writeUInt32LE(36 + dataBytes, 4);
head.write('WAVE', 8, 'ascii');
head.write('fmt ', 12, 'ascii');
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);       // PCM
head.writeUInt16LE(2, 22);       // 立体声
head.writeUInt32LE(sr, 24);
head.writeUInt32LE(sr * 4, 28);  // byte rate
head.writeUInt16LE(4, 32);       // block align
head.writeUInt16LE(16, 34);      // bits
head.write('data', 36, 'ascii');
head.writeUInt32LE(dataBytes, 40);

const data = Buffer.alloc(dataBytes);
const soft = (x) => Math.tanh(x * 1.15);
for (let i = 0; i < n; i++) {
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(soft(L[i]) * 32767))), i * 4);
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(soft(R[i]) * 32767))), i * 4 + 2);
}

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([head, data]));
console.log(`✓ ${path.relative(ROOT, out)}  ${seconds}s  ${bpm}bpm  ${(dataBytes / 1048576).toFixed(1)} MB`);

// 顺手转一份 mp3。浏览器对「脚本自己拼出来的 WAV」解码并不总是买账
// （Chrome 的 decodeAudioData 对非标准块布局很挑），mp3 稳得多、也小得多。
if (!process.argv.includes('--no-mp3')) {
  const mp3 = out.replace(/\.wav$/i, '.mp3');
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-b:a', '192k', mp3], { stdio: 'inherit' });
  if (r.status === 0) console.log(`✓ ${path.relative(ROOT, mp3)}   ← 音频任务用这个（不要用 wav）`);
  else console.log('· 没找到 ffmpeg，跳过 mp3 转换');
}
