// @ts-check
/**
 * 口播 / 旁白时间轴（`docs/NARRATION.md` A 档的最小可用）。
 *
 * ## 为什么需要它
 *
 * 做带旁白的片子时，引擎以前**只知道"有一条音轨"** —— 不知道哪几秒有人在说话。
 * 于是所有跟"人说话"有关的事都得在引擎外面手算：镜头长度靠外部脚本倒推、
 * 字幕时轴自己维护、"说到哪亮哪"得把 cue 抄进场景。做 `tasks/beast` 时这一层
 * 是在 `tasks/beast/tools/` 里手搓的（`narration.mjs` → `say.mjs` → `timing.mjs`），
 * 每个带旁白的片子都要重来一遍。
 *
 * 这里把**句子级时间轴**变成引擎的一等公民：`task.narration` 给一张句子表，
 * 场景里读 `ctx.narration`（`f.narration`），`cut(shot, { dur: { vo: 'line-id' } })`
 * 直接按某句旁白的时长定时长。
 *
 * ## 数据形状
 *
 * ```js
 * // task.config.mjs
 * narration: './narration.json'                  // 或直接内联
 * narration: { source: './audio/beast-vo.mp3', lines: [
 *   { id: 'hook-1', text: '这是一句旁白', start: 1.0, dur: 3.2 },
 *   { id: 'hook-2', text: '这是第二句',   start: 4.6, dur: 2.8, gap: 0.4 },
 * ]}
 * ```
 *
 * * `start` / `dur` 是**秒**（绝对是整片时间轴上的秒，不是段内时间）；
 * * `id` 可省（按出现顺序自动编号 `L1` `L2`…），但**建议给** —— `dur: { vo: id }` 要用它；
 * * `gap` 可省，仅用于「说完之后留白多久」这类检查。
 *
 * ## 引擎替你算好的东西
 *
 * 表里只写"谁在第几秒说多久"，剩下的派生量由 `makeNarration()` 算：
 * `end`（说完的时刻）、`gapToNext`、`totalSpeech`（说话总时长）、`speechRatio`（占比）、
 * 以及 `warnings`（叠句 / 超出片子时长 / 起点为负 / 留白不足）。
 * 这些都是 `docs/NARRATION.md` §5 里列出的验收口径 —— 以前每个任务各写一遍。
 */

/** 默认：一句说完之后至少留这么多秒的画面（「看得清」的底线，见 NARRATION.md §5.2）。 */
export const TAIL = 1.0;

/**
 * @typedef {Object} NarrationWord
 * @property {string} w      这一段文字（按顺序拼起来必须等于整句 `text`）
 * @property {number} start  起点（秒，**整片时间**，与 `f.t` 同一时钟）
 * @property {number} end    终点（秒）
 * @property {boolean} [approx] `true` = 这不是 TTS 给的真实时间戳，而是按字数近似切出来的
 */

/**
 * @typedef {Object} NarrationLine
 * @property {string} id          句子标识（`dur: { vo: id }` 用它）
 * @property {string} text        文本
 * @property {number} start       绝对起点（秒）
 * @property {number} dur         这句念了多久（秒）
 * @property {number} end         = start + dur
 * @property {number} gap         调用方给的、说完之后刻意留的空白（秒）
 * @property {number} gapToNext   = 下一句的 start − 本句的 end（可为负 = 叠句）
 * @property {number} index       在表里的序号（从 0 起）
 * @property {NarrationWord[]} [words] 词级时间戳（C 档；`type.karaoke` 直接吃它）
 * @property {boolean} [wordsApprox] 这张表的词级时间戳是不是近似的
 */

/**
 * 把一张"随便写写"的句子表归一成排好序、带派生量的表，并做一遍体检。
 *
 * 两种写法都收（`docs/NARRATION.md` A 档 / C 档）：
 *   · 句子级：`{ id, text, start, dur }`
 *   · 词级（`anim say` 的产物，也就是文档里说的 `lyrics.json`）：`{ id, text, words: [{w,start,end}] }`
 *     —— 缺 `start`/`dur` 时**由词级时间戳推**（`start = min(words.start)`、`dur = 说完 − 起点`）。
 *
 * @param {any} spec `task.narration`：`{ lines, source? }` 或直接是数组
 * @param {{ duration?: number, tail?: number }} [opts] `duration` = 整片时长（用来查"是否越界"）
 * @returns {{ lines: NarrationLine[], source: string|null, totalSpeech: number,
 *             speechRatio: number, lastEnd: number, warnings: string[], duration: number } | null}
 */
export function makeNarration(spec, opts = {}) {
  if (!spec) return null;
  const raw = Array.isArray(spec) ? { lines: spec } : spec;
  const list = Array.isArray(raw.lines) ? raw.lines : [];
  if (!list.length) return null;
  const tail = opts.tail ?? TAIL;

  /** @type {NarrationLine[]} */
  const lines = [];
  const warnings = [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i] ?? {};
    const text = String(l.text ?? '');
    // 词级时间戳（可选）：先归一，再拿它补 start/dur
    const words = normalizeWords(l.words, text, `[${l.id ?? `L${i + 1}`}]`, warnings);
    const wStart = words.length ? Math.min(...words.map((w) => w.start)) : null;
    const wEnd = words.length ? Math.max(...words.map((w) => w.end)) : null;
    const start = Number(l.start ?? (wStart ?? 0));
    const dur = Number(l.dur ?? (wEnd != null ? wEnd - start : 0));
    lines.push({
      id: String(l.id ?? `L${i + 1}`),
      text,
      start,
      dur,
      end: start + dur,
      gap: Number(l.gap ?? 0),
      gapToNext: 0,
      index: i,
      ...(words.length ? { words, wordsApprox: words.some((w) => w.approx) } : {}),
    });
  }
  lines.sort((a, b) => a.start - b.start || a.index - b.index);
  lines.forEach((l, i) => { l.index = i; });
  for (let i = 0; i < lines.length; i++) {
    lines[i].gapToNext = i + 1 < lines.length ? lines[i + 1].start - lines[i].end : Infinity;
  }

  // 体检（`docs/NARRATION.md` §5 的 1 / 2 两条）
  const dur = Number(opts.duration ?? 0);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!(l.dur > 0)) warnings.push(`[${l.id}] dur=${l.dur}（必须 > 0）`);
    if (l.start < 0) warnings.push(`[${l.id}] start=${l.start} 是负数`);
    if (Number.isFinite(l.gapToNext) && l.gapToNext < 0) {
      warnings.push(`叠句：[${l.id}] 与下一句 [${lines[i + 1].id}] 重叠了 ${(-l.gapToNext).toFixed(2)}s`
        + `（本句 ${l.start.toFixed(2)}–${l.end.toFixed(2)}s，下一句从 ${lines[i + 1].start.toFixed(2)}s 起）`);
    }
    if (dur && l.end > dur + 1e-6) {
      warnings.push(`[${l.id}] 说到 ${l.end.toFixed(2)}s，超出了片子时长 ${dur.toFixed(2)}s`);
    }
  }
  const totalSpeech = lines.reduce((s, l) => s + Math.max(0, l.dur), 0);
  const lastEnd = Math.max(...lines.map((l) => l.end));
  return {
    lines,
    source: raw.source ? String(raw.source) : null,
    totalSpeech: Math.round(totalSpeech * 1000) / 1000,
    // ⚠ 占比的分母是**整片时长**，没给就退回"最后一句说完的时刻"（仍然有意义：说话到底占了多久）
    speechRatio: dur > 0 ? Math.min(1, totalSpeech / dur) : (lastEnd > 0 ? Math.min(1, totalSpeech / lastEnd) : 0),
    lastEnd,
    warnings,
    duration: dur,
    tail,
  };
}

/**
 * 归一 + 校验词级时间戳（C 档）。
 *
 * 校验的是**karoke 的位置前提**：`words[].w` 按顺序拼起来必须等于整句 `text`
 * （`type.karaoke` 就是靠这个把词摆到正确的位置上）。对不上只**警告**、不抛异常
 * —— 但一定要说出来，不然画面上是"所有词叠在行首"这种查不出原因的怪事
 * （历史上 `type.karaoke` 真有过这个 bug，见 `tools/test-karaoke.mjs`）。
 *
 * @param {any} words
 * @param {string} text
 * @param {string} label 出错时报的句子名
 * @param {string[]} warnings 收集警告（调用方负责打印）
 * @returns {NarrationWord[]}
 */
export function normalizeWords(words, text, label = '', warnings = []) {
  if (!Array.isArray(words) || !words.length) return [];
  const out = words.map((w) => ({
    w: String(w?.w ?? ''),
    start: Number(w?.start ?? 0),
    end: Number(w?.end ?? 0),
    ...(w?.approx ? { approx: true } : {}),
  }));
  const joined = out.map((w) => w.w).join('');
  if (joined !== String(text)) {
    warnings.push(
      `${label} 词级时间戳拼起来不等于文本（karaoke 的位置会错）：`
      + `得到 "${head(joined)}"，期望 "${head(String(text))}"`,
    );
  }
  const bad = out.find((w) => !(w.end >= w.start));
  if (bad) warnings.push(`${label} 有词的时间戳不合法（end < start）：${JSON.stringify(bad)}`);
  return out;
}

/** 只取开头一小段用于报错（表格里塞一整句太吵） */
function head(s, n = 18) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * 给场景用的查询接口（挂在 `ctx.narration` / `f.narration` 上）。
 *
 * 设计原则：**只读、纯函数、不依赖上一帧** —— 与整个引擎的确定性契约一致。
 *
 * ```js
 * const n = ctx.narration;
 * n.at(f.t)          // 此刻在说的那句（带 p / typedText / words），没有就 null
 * n.current(f.t)     // 只问"哪一句在说"，返回 line 或 null
 * n.progress(f.t)    // 此刻这句念到几成（0..1），没在说就是 null
 * n.typed(f.t)       // 打字机效果：这句已经念出来的那部分文本
 * n.recent(f.t, 1.5) // 刚刚说完的那句（字幕该多留一会儿，见下）
 * n.in(f.t, a, b)    // 这句是否落在 [a,b) 里（做"说到哪亮哪"）
 * n.line('hook-1')   // 按 id 取
 * n.durOf('hook-1')  // 按 id 取时长（`cut(..., { dur: { vo: id } })` 用同一个口径）
 * n.until(f.t)       // 现在这句还有多久说完
 * ```
 *
 * ## 词级时间戳（C 档，`type.karaoke` 用）
 *
 * 表里带 `words` 时（`anim say` 写的，见 `docs/NARRATION.md` C 档），场景里直接：
 *
 * ```js
 * const l = ctx.narration.at(f.t) ?? ctx.narration.recent(f.t, 1.2);
 * if (l?.words) type.karaoke(l.text, l.words, 200, 800, f.t, { size: 84, base: css(P.ash), sung: css(P.signal) });
 * ```
 *
 * ⚠ `words[].start/end` 与 `t` 必须是**同一个时钟**：`anim say` 写的是整片绝对时间，
 * 所以这里配 `f.t`（不要拿 `f.lt` 去配整片时间）。
 * `n.at()` 只在"正在说"的区间内返回句子；**说完之后字幕不该立刻消失** —— 这就是 `recent()` 的用途。
 *
 * @param {ReturnType<typeof makeNarration>} data
 */
export function makeNarrationReader(data) {
  if (!data) {
    // 没配旁白时也要能安全调用（场景可以无条件写 ctx.narration?.at(f.t)）
    const nil = () => null;
    return {
      lines: [], source: null, totalSpeech: 0, speechRatio: 0, lastEnd: 0, warnings: [], duration: 0, tail: TAIL,
      at: nil, current: nil, progress: nil, typed: nil, until: nil, line: nil, durOf: nil, recent: nil, in: () => false,
    };
  }
  const byId = new Map(data.lines.map((l) => [l.id, l]));

  /** 此刻在说的那一句（严格按 [start, end) 判；句尾那一瞬算结束）。 */
  const current = (t) => {
    for (const l of data.lines) if (t >= l.start && t < l.end) return l;
    return null;
  };

  /**
   * 刚刚说完、还没超过 `hold` 秒的那一句。
   *
   * 为什么需要它：字幕/卡拉OK**不该在话音落下的那一瞬消失** —— 观众还在读。
   * 但也不能一直挂着（下一句来了就该换）。所以：
   * `recent(t, hold)` 返回"最近说完且 `t − end ≤ hold`"的那句，没有就 null。
   * 典型写法：`ctx.narration.at(f.t) ?? ctx.narration.recent(f.t, 1.2)`。
   */
  const recent = (t, hold = 1.2) => {
    let best = null;
    for (const l of data.lines) {
      if (l.end <= t && t - l.end <= hold && (!best || l.end > best.end)) best = l;
    }
    return best;
  };

  return {
    ...data,
    current,
    /**
     * 此刻在说的那句 + 这句的进度信息。这是场景里最常用的一个：
     * `p` 是 0..1、`typedText` 是已经念出来的文本、`charIndex` 是念到第几个字。
     */
    at(t) {
      const l = current(t);
      if (!l) return null;
      const p = l.dur > 0 ? Math.min(1, Math.max(0, (t - l.start) / l.dur)) : 1;
      const n = l.text.length;
      const charIndex = Math.min(n, Math.floor(p * n));
      return {
        ...l,
        t,
        /** 这句念到几成（0..1） */
        p,
        /** 还剩多久说完（秒） */
        remain: Math.max(0, l.end - t),
        /** 已经念出来的那部分文本（打字机/字幕用） */
        typedText: l.text.slice(0, charIndex),
        /** 还没念出来的那部分 */
        restText: l.text.slice(charIndex),
        /** 念到第几个字（按字符数等分，够用；词级时间戳属于 C 档） */
        charIndex,
      };
    },
    progress(t) {
      const l = current(t);
      return l && l.dur > 0 ? Math.min(1, Math.max(0, (t - l.start) / l.dur)) : null;
    },
    /** 打字机效果：这一句已经"念出来"的那部分文本。 */
    typed(t) {
      const l = current(t);
      if (!l) return '';
      const p = l.dur > 0 ? Math.min(1, Math.max(0, (t - l.start) / l.dur)) : 1;
      return l.text.slice(0, Math.min(l.text.length, Math.floor(p * l.text.length)));
    },
    until(t) {
      const l = current(t);
      return l ? Math.max(0, l.end - t) : null;
    },
    recent,
    /**
     * 这一句是否正在被念（做"说到哪亮哪"）。
     * 两种用法：`in(t, 'hook-1')` 问"此刻念的是不是 hook-1"；
     * `in(t, a, b)` 问"t 是否落在 [a,b) 里"。
     */
    in(t, a, b) {
      if (b === undefined) return current(t)?.id === String(a);
      return t >= Number(a) && t < Number(b);
    },
    line(id) { return byId.get(String(id)) ?? null; },
    durOf(id) { return byId.get(String(id))?.dur ?? null; },
  };
}
