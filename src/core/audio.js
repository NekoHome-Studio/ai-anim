// @ts-check
/**
 * 音乐。加载音频 -> 解出 PCM -> 提取特征 -> 给场景一套「跟画面同源」的节拍查询接口。
 *
 * 数据来源两级：
 *   1) tasks/<name>/audio/<file>.analysis.json —— 由 CLI 预先算好（推荐，渲染时零开销、绝对稳定）
 *   2) 浏览器里现算（首次预览、没有 json 时用），用 FFT + flux + 自相关做同样的分析
 *
 * 场景里拿到的是 ctx.music（MusicData），常用：
 *   m.at(t).kick 0..1     m.beatAt(t) 连续拍号     m.timeOfBeat(12) 第 12 拍的时刻
 *   m.hits('kick', t-0.1, t+0.1)   m.nearestBeat(t)   m.sections
 *   m.hit('kick', t, 0.12) → 衰减脉冲（做「咚一下」的冲击最方便）
 */

import { analyzePCM, decodeToMono } from './audio-analysis.js';

/** @typedef {{t:number,s:number}} Hit */

const EMPTY = {
  duration: 0, fps: 43.07, bpm: 120, beats: [], downbeats: [],
  kicks: [], snares: [], hats: [], sections: [],
  rms: new Float32Array(1), low: new Float32Array(1), bass: new Float32Array(1),
  mid: new Float32Array(1), high: new Float32Array(1), vocal: new Float32Array(1),
  flux: new Float32Array(1), centroid: new Float32Array(1),
};

/** 把分析 JSON（Float32Array -> 普通数组）还原成运行时结构。 */
function rehydrate(j) {
  if (!j) return { ...EMPTY };
  const arr = (k) => (j[k] ? Float32Array.from(j[k]) : new Float32Array(1));
  return {
    ...EMPTY, ...j,
    rms: arr('rms'), low: arr('low'), bass: arr('bass'), mid: arr('mid'),
    high: arr('high'), vocal: arr('vocal'), flux: arr('flux'), centroid: arr('centroid'),
    beats: j.beats ?? [], downbeats: j.downbeats ?? [],
    kicks: j.kicks ?? [], snares: j.snares ?? [], hats: j.hats ?? [], sections: j.sections ?? [],
  };
}

export class MusicData {
  /** @param {any} a 分析结果 @param {{ url?: string }} [extra] */
  constructor(a, extra = {}) {
    Object.assign(this, rehydrate(a));
    /** @type {number} 特征帧率高一个量级，做平滑时用 */
    this.url = extra.url ?? '';
    this.hasAudio = !!extra.url;
    /** 每个特征通道的帧时长 */
    this.frameDt = 1 / this.fps;
  }

  static async load(url, { analysisUrl = null, onProgress = null } = {}) {
    // 1) 优先吃预计算好的 json（离线渲染走这条，快且绝对一致）
    let why = '没有提供 analysisUrl';
    if (analysisUrl) {
      try {
        if (onProgress) onProgress('读取分析数据…');
        const r = await fetch(analysisUrl);
        if (r.ok) {
          const j = await r.json();
          if (j && j.beats) return new MusicData(j, { url });
          why = `${analysisUrl} 内容不对（没有 beats 字段）`;
        } else {
          why = `fetch ${analysisUrl} → HTTP ${r.status}`;
        }
      } catch (err) {
        why = `读取 ${analysisUrl} 失败: ${err && err.message}`;
      }
    }
    // 2) 现算（需要浏览器能 decodeAudioData 这个文件；mp3/m4a 最稳，脚本拼的 wav 不一定行）
    if (onProgress) onProgress('解码音频…');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`音频也取不到：${url} → HTTP ${res.status}（原因：${why}）`);
    const buf = await res.arrayBuffer();
    let pcm, sampleRate;
    try {
      ({ pcm, sampleRate } = await decodeToMono(buf));
    } catch (err) {
      throw new Error(
        `浏览器无法解码 ${url}（${err && err.name}）。原因链：${why}。\n` +
        `解决办法：跑一次 \`node scripts/anim.mjs analyze <任务名>\` 生成预计算的特征 json，` +
        `或者把音频换成 mp3/m4a。`,
      );
    }
    if (onProgress) onProgress('分析节拍…');
    // 让出一帧，别把预览界面卡死
    await new Promise((r) => setTimeout(r, 0));
    const a = analyzePCM(pcm, sampleRate);
    return new MusicData(a, { url });
  }

  /* -------------------------------------------------- 采样 */

  /** 取某一时刻的特征快照。返回的对象每帧都能拿（引擎已经算好放进 frame.a）。 */
  at(t) {
    const f = Math.max(0, Math.min(this.rms.length - 1, Math.round(t * this.fps)));
    const hit = (list) => {
      // 最近的打击事件在 ±0.06 s 内 -> 返回强度，否则 0
      let best = 0;
      for (let i = 0; i < list.length; i++) {
        const d = Math.abs(list[i].t - t);
        if (d < 0.06) best = Math.max(best, list[i].s * (1 - d / 0.06));
      }
      return best;
    };
    return {
      rms: this.rms[f], low: this.low[f], bass: this.bass[f], mid: this.mid[f],
      high: this.high[f], vocal: this.vocal[f], flux: this.flux[f], centroid: this.centroid[f],
      kick: hit(this.kicks), snare: hit(this.snares), hat: hit(this.hats),
    };
  }

  /** 连续拍号（第 3.4 拍这种），用于 beatPhase = beat - floor(beat)。 */
  beatAt(t) {
    const b = this.beats;
    if (!b.length) return t * (this.bpm / 60);
    if (t <= b[0]) return (t - (b[0] ?? 0)) / this._period();
    let lo = 0, hi = b.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (b[m] <= t) lo = m; else hi = m; }
    const p = this._period(lo);
    return lo + (t - b[lo]) / p;
  }

  _period(i = 0) {
    const b = this.beats;
    if (b.length > i + 1) return Math.max(1e-3, b[i + 1] - b[i]);
    return 60 / (this.bpm || 120);
  }

  barAt(t) { return this.beatAt(t) / 4; }

  timeOfBeat(i) {
    const b = this.beats;
    if (!b.length) return i * (60 / (this.bpm || 120));
    const k = Math.floor(i);
    if (k < 0) return (b[0] ?? 0) + k * this._period(0);
    if (k < b.length) return b[k];
    return b[b.length - 1] + (k - b.length + 1) * this._period(b.length - 2);
  }

  nearestBeat(t) {
    const b = this.beats;
    if (!b.length) return t;
    let best = b[0], bd = Infinity;
    for (const x of b) { const d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } }
    return best;
  }

  /** 落在 [t0, t1) 内的打击事件。 */
  hits(kind, t0, t1) {
    const list = /** @type {Hit[]} */ (/** @type {any} */ (this)[kind + 's'] ?? []);
    return list.filter((h) => h.t >= t0 && h.t < t1);
  }

  /** 起始于 t 附近的衰减脉冲：做「撞一下」的位移/闪白最省事的写法。 */
  hit(kind, t, halfLife = 0.12) {
    const list = /** @type {Hit[]} */ (/** @type {any} */ (this)[kind + 's'] ?? []);
    let best = 0;
    for (const h of list) {
      if (h.t > t) continue;
      const v = h.s * Math.exp(-(t - h.t) / halfLife);
      if (v > best) best = v;
      if (t - h.t > halfLife * 8) break;
    }
    return Math.min(1, best);
  }

  /** 距离 t 最近的一次「每 period 一次」的相位脉冲（0..1），给周期性的呼吸/闪动用。 */
  pulse(t, period = 1, halfLife = 0.15) {
    const since = ((t % period) + period) % period;
    return Math.exp(-since / halfLife);
  }

  sectionAt(t) {
    let cur = this.sections[0];
    for (const s of this.sections) if (s.t <= t) cur = s;
    return cur ?? null;
  }
}

/** 没有音频时的空音乐对象，让场景代码不用到处判空。 */
export const SILENT = new MusicData(EMPTY);
