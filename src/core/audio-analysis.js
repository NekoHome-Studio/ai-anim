// @ts-check
/**
 * 音频特征提取。目标：让画面能「踩在拍子上」，而不是靠手抄时间码。
 *
 * 确定性保证：输入 PCM 字节流一样 + 算法参数一样 = 输出完全一样。
 * 不依赖宿主 AudioContext 的状态、不用墙钟、不用随机。所以离线渲染和预览听到的是同一套拍子。
 *
 * 产物（AudioData）：
 *   duration, fps（特征帧率，默认 43.07 = 44100/1024）
 *   rms/low/mid/high/vocal/flux      Float32Array，每帧一个 0..1 的值
 *   bass                             低频包络（跟 low 类似但更窄）
 *   beats/downbeats                  秒
 *   kicks/snares/hats                秒（打击事件）
 *   bpm                              估计值
 * 查询：at(t) 取特征、beatAt(t) 连续拍号、barAt(t)、hits(kind, t0, t1) …
 */

const FFT_N = 2048;
const HOP = 1024;
const TARGET_SR = 44100;

/* ------------------------------------------------------------------ FFT */

/** 原地 radix-2 FFT（实部/虚部数组长度必须是 2 的幂）。 */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; const u = im[i]; im[i] = im[j]; im[j] = u; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const hann = new Float32Array(FFT_N);
for (let i = 0; i < FFT_N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));

function normalize(a, percentile = 0.995) {
  const s = Float32Array.from(a).sort();
  const hi = s[Math.min(s.length - 1, Math.floor(s.length * percentile))] || 1;
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.min(1, a[i] / (hi || 1));
  return out;
}

function smooth(a, n) {
  if (n <= 1) return a;
  const out = new Float32Array(a.length);
  let acc = 0;
  for (let i = 0; i < a.length; i++) {
    acc += a[i];
    if (i >= n) acc -= a[i - n];
    out[i] = acc / Math.min(i + 1, n);
  }
  return out;
}

/**
 * 从 PCM 提取全部特征。
 * @param {Float32Array} pcm 单声道、已重采样到 TARGET_SR
 * @param {number} sampleRate
 */
export function analyzePCM(pcm, sampleRate = TARGET_SR) {
  const duration = pcm.length / sampleRate;
  const nFrames = Math.max(1, Math.floor((pcm.length - FFT_N) / HOP) + 1);
  const fps = sampleRate / HOP;

  const rms = new Float32Array(nFrames);
  const low = new Float32Array(nFrames);
  const bass = new Float32Array(nFrames);
  const mid = new Float32Array(nFrames);
  const high = new Float32Array(nFrames);
  const vocal = new Float32Array(nFrames);
  const flux = new Float32Array(nFrames);
  const centroid = new Float32Array(nFrames);

  const bins = FFT_N / 2;
  const binHz = sampleRate / FFT_N;
  const band = (lo, hi) => [Math.max(1, Math.floor(lo / binHz)), Math.min(bins - 1, Math.ceil(hi / binHz))];
  const [b0, b1] = band(20, 140);      // 低频
  const [b2, b3] = band(140, 400);     // 低中
  const [b4, b5] = band(400, 2000);    // 中（人声主体）
  const [b6, b7] = band(2000, 6000);   // 中高
  const [b8, b9] = band(6000, 14000);  // 高（镲片）

  const re = new Float32Array(FFT_N);
  const im = new Float32Array(FFT_N);
  const prevMag = new Float32Array(bins);
  const mag = new Float32Array(bins);

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    let sum = 0;
    for (let i = 0; i < FFT_N; i++) {
      const s = pcm[off + i] ?? 0;
      sum += s * s;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(sum / FFT_N);
    fft(re, im);

    let eLow = 0, eBass = 0, eMid = 0, eHigh = 0, eVocal = 0, eHi2 = 0, num = 0, den = 0, fl = 0;
    for (let k = 1; k < bins; k++) {
      const m = Math.hypot(re[k], im[k]);
      mag[k] = m;
      if (k >= b0 && k <= b1) eLow += m * m;
      if (k >= b2 && k <= b3) eBass += m * m;
      if (k >= b4 && k <= b5) eMid += m * m;
      if (k >= b6 && k <= b7) eHigh += m * m;
      if (k >= b8 && k <= b9) eHi2 += m * m;
      if (k >= b4 && k <= b7) eVocal += m * m;
      num += k * binHz * m;
      den += m;
      const d = m - prevMag[k];
      if (d > 0) fl += d;
      prevMag[k] = m;
    }
    low[f] = Math.sqrt(eLow / bins);
    bass[f] = Math.sqrt(eBass / bins);
    mid[f] = Math.sqrt(eMid / bins);
    high[f] = Math.sqrt((eHigh + eHi2) / bins);
    vocal[f] = Math.sqrt(eVocal / bins);
    flux[f] = fl / bins;
    centroid[f] = den > 0 ? num / den : 0;
  }

  // 打击事件：低频 flux 的峰值 = kick，中高 flux 峰值 = snare/hat
  const lowFlux = new Float32Array(nFrames);
  const hiFlux = new Float32Array(nFrames);
  for (let f = 1; f < nFrames; f++) {
    lowFlux[f] = Math.max(0, low[f] - low[f - 1]) + Math.max(0, bass[f] - bass[f - 1]) * 1.6;
    hiFlux[f] = Math.max(0, high[f] - high[f - 1]) * 1.2 + Math.max(0, mid[f] - mid[f - 1]) * 0.4;
  }
  const pickPeaks = (env, thr = 0.32, minGap = 0.11) => {
    const n = normalize(env, 0.99);
    /** @type {{t:number,s:number}[]} */
    const out = [];
    let last = -9;
    for (let f = 2; f < nFrames - 2; f++) {
      const v = n[f];
      if (v < thr) continue;
      if (!(v >= n[f - 1] && v >= n[f + 1] && v > n[f - 2] && v > n[f + 2])) continue;
      const t = f / fps;
      if (t - last < minGap) { const p = out[out.length - 1]; if (p && v > p.s) { p.t = t; p.s = v; last = t; } continue; }
      out.push({ t, s: v });
      last = t;
    }
    return out;
  };
  const kicks = pickPeaks(lowFlux, 0.34, 0.13);
  const snares = pickPeaks(hiFlux, 0.42, 0.09);
  const hats = pickPeaks(hiFlux, 0.62, 0.055);

  // 拍子：以 kick + 全频 flux 的联合起音包络做自相关估 tempo，再在其网格上取峰
  const onset = normalize(flux, 0.99);
  const onsetS = smooth(onset, 3);
  const bpm = estimateTempo(onsetS, fps);
  const beats = beatGrid(onsetS, kicks, bpm, fps, duration);
  const downbeats = beats.filter((_, i) => i % 4 === 0);

  // 段落：能量突变处切段（做 edit 时很有用）
  const sections = detectSections(normalize(rms, 0.99), fps, duration);

  return {
    duration, fps, bpm,
    rms: normalize(rms, 0.99),
    low: normalize(low, 0.99),
    bass: normalize(bass, 0.99),
    mid: normalize(mid, 0.99),
    high: normalize(high, 0.99),
    vocal: normalize(vocal, 0.99),
    flux: onsetS,
    centroid: normalize(centroid, 0.99),
    beats: beats.map((t) => round4(t)),
    downbeats: downbeats.map((t) => round4(t)),
    kicks: kicks.map((k) => ({ t: round4(k.t), s: round4(k.s) })),
    snares: snares.map((k) => ({ t: round4(k.t), s: round4(k.s) })),
    hats: hats.map((k) => ({ t: round4(k.t), s: round4(k.s) })),
    sections,
  };
}

function round4(x) { return Math.round(x * 1e4) / 1e4; }

function estimateTempo(onset, fps) {
  const minBpm = 60, maxBpm = 200;
  let best = 0, bestScore = -1;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const lag = Math.round((60 / bpm) * fps);
    if (lag < 2 || lag >= onset.length) continue;
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    // 偏好 90–160 这一段（人耳对它的解释最自然）
    const w = Math.exp(-((bpm - 120) ** 2) / (2 * 55 ** 2));
    s *= (0.6 + 0.4 * w);
    if (s > bestScore) { bestScore = s; best = bpm; }
  }
  return best || 120;
}

function beatGrid(onset, kicks, bpm, fps, duration) {
  const period = 60 / bpm;
  // 用 kick 事件把相位对齐：找让 kick 最贴合网格的相位
  let bestPhase = 0, bestScore = -1;
  for (let p = 0; p < period; p += period / 48) {
    let s = 0;
    for (const k of kicks) {
      const d = Math.abs(((k.t - p) % period + period * 1.5) % period - period * 0.5);
      s += k.s * Math.exp(-(d * d) / (2 * 0.035 ** 2));
    }
    if (s > bestScore) { bestScore = s; bestPhase = p; }
  }
  const beats = [];
  for (let t = bestPhase; t < duration; t += period) if (t >= 0) beats.push(t);
  return beats;
}

function detectSections(rms, fps, duration) {
  const win = Math.round(fps * 1.0);
  const out = [];
  let prev = -1;
  for (let f = 0; f < rms.length; f += win) {
    let s = 0, n = 0;
    for (let i = f; i < Math.min(rms.length, f + win); i++) { s += rms[i]; n++; }
    const v = n ? s / n : 0;
    if (prev < 0 || Math.abs(v - prev) > 0.22) {
      out.push({ t: round4(f / fps), energy: round4(v) });
      prev = v;
    }
  }
  if (!out.length || out[0].t > 0.5) out.unshift({ t: 0, energy: round4(rms[0] ?? 0) });
  return out;
}

/* ------------------------------------------------------------------ 解码（浏览器） */

let ctxCache = /** @type {AudioContext | null} */ (null);

/** mp3/wav 字节 -> 单声道 Float32 + 采样率（按 TARGET_SR 重采样）。 */
export async function decodeToMono(bytes) {
  const AC = /** @type {any} */ (window).AudioContext ?? /** @type {any} */ (window).webkitAudioContext;
  const ac = ctxCache ?? (ctxCache = new AC({ sampleRate: TARGET_SR }));
  const buf = await ac.decodeAudioData(bytes.slice(0));
  const n = buf.length;
  const chs = buf.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / chs;
  }
  return { pcm: out, sampleRate: buf.sampleRate };
}
