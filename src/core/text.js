// @ts-check
/**
 * 排版与文字工具（Canvas2D 之上）。
 *
 * 为什么不用 canvas 的 fillText 一把梭：逐字动画、逐词卡拉OK、逐字擦除都需要
 * 「每个字形落在哪里、每个词从哪个像素开始」这种信息，而 fillText 只给你整串。
 * 所以这里的核心是 layout()：按字素簇（grapheme cluster）切开，用累积宽度差分拿到
 * 带字距调整（kerning）的真实位置。中文一个字素簇就是一个字，同样适用。
 *
 * 颜色：Canvas2D 在 sRGB 空间，用 P.css('signal', 0.6) 取色，别直接塞线性值。
 */

import { css, clamp, sat, lerp } from './util.js';

/** 字素簇切分（中文、emoji、组合字符都按「一个字」算）。 */
function segment(text) {
  if (typeof Intl !== 'undefined' && /** @type {any} */ (Intl).Segmenter) {
    const seg = new (/** @type {any} */ (Intl).Segmenter)('zh', { granularity: 'grapheme' });
    return Array.from(seg.segment(text), (/** @type {any} */ s) => s.segment);
  }
  return Array.from(text);
}

/**
 * `karaoke()` 的「整行拼不上」警告只报一次（按 text 去重，同一个 text 只刷一次屏）。
 *
 * 为什么按 text 而不是按 mismatch 文本去重：同一行字每帧都会调一次 `karaoke()`，
 * 按 mismatch 去重会在「空格少了 / 多了」这类会变来变去的表上每帧换一个 key，等于没去重。
 * 一行字错一次就够了，换行再报 —— 和 `util.js` 里 `prog()` 的 `warnedEase` 是同一个套路（P2-3）。
 */
const warnedKaraoke = new Set();

/** 把字符下标映射成簇下标；纯查表，不碰 canvas。 */
function charToClusterMap(clusters, charCount) {
  /** @type {number[]} */
  const map = [];
  let ci = 0, acc = 0;
  for (let i = 0; i < clusters.length; i++) {
    acc += clusters[i].length;
    while (ci < acc) map[ci++] = i;
  }
  // 结尾哨兵：把「整行末尾」那个字符下标映射到「簇数组的长度」（= 结尾位置本身）。
  //
  // ⚠ 这里**不能**写 `map[clusters.length] = clusters.length`（旧实现就是这样）：
  //   clusters.length 是**簇的个数**，而 charToCluster 的键是**字符（UTF-16 码元）下标** ——
  //   只有「每个簇都只占一个码元」时两者才碰巧相等。有 emoji / 代理对时不等：
  //   比如 'a😀b' 是 4 个码元 / 3 个簇，旧写法把 map[3] 覆盖成 3，而 map[3] 本来是 'b' 那个簇（2）
  //   —— 于是「最后一段」的右边界落在簇 3（不存在）上，词宽算成负数、行尾短一截。
  //   哨兵该占的位置是 charCount（= 总码元数），它 >= 上面循环写过的所有下标，不会盖掉真值。
  map[charCount] = clusters.length;
  return map;
}

/** 按空白切词；中文没有空白，所以「词」以调用方给的词边界为准（见 karaoke）。 */
function splitWords(line) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) out.push({ w: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** @typedef {{ size?: number, weight?: number|string, italic?: boolean, family?: string, tracking?: number, align?: CanvasTextAlign, baseline?: CanvasTextBaseline }} TypeStyle */

/** 字体栈：字体缺失时静默回退，不会糊成方框。 */
export const FAMILIES = {
  /** 无衬线正文（拉丁 + 中文黑体） */
  sans: "'Archivo', 'Noto Sans SC', 'Microsoft YaHei', system-ui, sans-serif",
  /** 等宽（机器口吻：标签、时间码、表单、token） */
  mono: "'IBM Plex Mono', 'Sarasa Mono SC', 'Consolas', monospace",
  /** 衬线（神圣/预言口吻，很少用） */
  serif: "'Cormorant Garamond', 'Noto Serif SC', 'Songti SC', serif",
};

const CACHE_LIMIT = 4096;

export class TextKit {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    /** @type {Map<string, number>} */
    this.widthCache = new Map();
    /** @type {Map<string, {clusters: string[], cum: number[], x: number[]}>} */
    this.layoutCache = new Map();
    this.fontsReady = false;
  }

  /** 加载外部字体（有 fonts/fonts.css 就加载，没有就用系统回退）。 */
  async load(files = ['/fonts/fonts.css']) {
    const jobs = [];
    for (const f of files) {
      jobs.push(new Promise((res) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = f;
        l.onload = () => res(null); l.onerror = () => res(null);
        document.head.appendChild(l);
      }));
    }
    await Promise.all(jobs);
    try {
      const anyDoc = /** @type {any} */ (document);
      if (anyDoc.fonts?.ready) await anyDoc.fonts.ready;
      // 显式请求几个字形，逼浏览器把字体下下来（否则离屏截帧会拍到大片回退字体）
      if (anyDoc.fonts?.load) {
        await Promise.all([
          anyDoc.fonts.load('400 64px Archivo', 'A'),
          anyDoc.fonts.load('700 64px Archivo', 'A'),
          anyDoc.fonts.load('900 64px Archivo', 'A'),
          anyDoc.fonts.load('400 64px "IBM Plex Mono"', '0'),
          anyDoc.fonts.load('400 64px "Noto Sans SC"', '动画'),
        ]).catch(() => {});
      }
    } catch { /* 字体加载失败不致命 */ }
    this.fontsReady = true;
    return this;
  }

  /** 组装 CSS font 字符串；style 会被缓存到 this._style 上供 layout/measure 复用。 */
  font(style = /** @type {TypeStyle} */ ({})) {
    const {
      size = 64, weight = 400, italic = false, family = 'sans', tracking = 0,
      align = 'left', baseline = 'alphabetic',
    } = style;
    const fam = FAMILIES[family] ?? family;
    const f = `${italic ? 'italic ' : ''}${weight} ${size}px ${fam}`;
    const c = this.ctx;
    c.font = f;
    c.textAlign = align;
    c.textBaseline = baseline;
    const key = `${f}|${tracking}|${align}|${baseline}`;
    if (this._key !== key) {
      this._key = key;
      this._style = { size, weight, italic, family, tracking };
    }
    return f;
  }

  /** 整串宽度（含 tracking）。 */
  measure(text, style = {}) {
    this.font(style);
    const tracking = style.tracking ?? 0;
    const key = `${this._key}|${text}`;
    const hit = this.widthCache.get(key);
    if (hit !== undefined) return hit;
    const w = this.ctx.measureText(text).width + Math.max(0, segment(text).length - 1) * tracking;
    if (this.widthCache.size > CACHE_LIMIT) this.widthCache.clear();
    this.widthCache.set(key, w);
    return w;
  }

  /**
   * 逐字素簇布局。返回每个簇的 x 位置（含 tracking）与累计宽度。
   * cum[i] 是第 i 个簇**之前**的宽度 —— 这正是带 kerning 的真实位置：
   * 直接用 fillText 整串画一遍得到的就是字体自己的字距，不需要我们插值。
   */
  layout(text, style = {}) {
    this.font(style);
    const tracking = style.tracking ?? 0;
    const key = `${this._key}|${text}`;
    const hit = this.layoutCache.get(key);
    if (hit) return hit;
    const clusters = segment(text);
    const cum = new Array(clusters.length + 1);
    const x = new Array(clusters.length);
    let n = 0;
    let prefix = '';
    for (let i = 0; i < clusters.length; i++) {
      cum[i] = n;
      x[i] = n + i * tracking;
      // 位置来自累积宽度（字体的字距调整因此被保留）；每字步进用差分宽度
      const w0 = this.ctx.measureText(prefix).width;
      const w1 = this.ctx.measureText(prefix + clusters[i]).width;
      n += w1 - w0;
      prefix += clusters[i];
    }
    cum[clusters.length] = n + Math.max(0, clusters.length - 1) * tracking;
    if (this.layoutCache.size > CACHE_LIMIT) this.layoutCache.clear();
    const out = { clusters, cum, x };
    this.layoutCache.set(key, out);
    return out;
  }

  /**
   * 画一行文字，可选逐字动画。
   * @param {string} text
   * @param {number} x @param {number} y
   * @param {TypeStyle & {
   *   color?: string|string[],
   *   alpha?: number|[number,number],
   *   stagger?: number,        // 每个字延迟多少秒（逐字入场）
   *   staggerDur?: number,     // 每个字自己的动画时长
   *   from?: 'up'|'down'|'left'|'right'|'scale'|'none',  // 入场方向
   *   dist?: number,           // 入场位移距离（px 或倍率）
   *   t?: number,              // 场景局部时间（配合 stagger 用）
   *   seed?: number,           // 抖动随机种子
   * }} [opts]
   */
  write(text, x, y, opts = {}) {
    const c = this.ctx;
    const style = opts;
    this.font(style);
    const { clusters, x: X } = this.layout(text, style);
    const stagger = opts.stagger ?? 0;
    const dur = opts.staggerDur ?? 0.45;
    const t = opts.t ?? 0;
    const from = opts.from ?? 'none';
    const dist = opts.dist ?? (style.size ?? 64) * 0.6;
    const colors = opts.color === undefined ? null : Array.isArray(opts.color) ? opts.color : [opts.color];
    c.save();
    // k = 「这一行自己」的动画进度。
    //
    // ⚠ `stagger > 0` 不是唯一需要进度的情况：`alpha: [0, 1]` 这种**整行淡入**也要用它。
    //   以前这里写死 `stagger > 0 ? … : 1`，于是 alpha 的起始值永远取不到，
    //   整行直接以终值出现 —— 所有任务都只能用 `stagger: 1e-4` 这种 hack 绕过
    //   （tasks/nekohome 和 tasks/fidus 的 _kit.js 里各有一处，注释都写着"绕开"）。
    //
    // ⚠⚠ 然后是第二个坑（docs/IMPROVEMENTS-2 P0-1）：`opts.alpha !== undefined` 不能算"要动画"。
    //   数值型 alpha（`alpha: 1` / `alpha: 0.5`）是**常量不透明度**，与 t 无关；
    //   但旧判据把它当动画 → `k = sat((t - 0)/0.45)`，而 `opts.t` 缺省 0 ⇒ `k = 0`
    //   ⇒ 下面的 `if (k <= 0) continue` **整个字形直接不画**（不是画成透明）。
    //   症状是"一整块字凭空消失、其余画面完全正常"，而 `check` 的亮度统计看不出来
    //   （tasks/beast 的字典 4 个大格 + 兽语卡 16 个字就是这么没的）。
    //   现在：只有**数组型** alpha（[a0,a1] 这种随 t 插值的）才需要进度；数值型直接当常量乘进 al。
    const alphaIsRamp = Array.isArray(opts.alpha);
    // 「这一笔到底要不要按 t 求进度」：逐字入场 or 整行淡入。常量 alpha 不算。
    const perGlyphAnim = stagger > 0 || alphaIsRamp;
    // 常量不透明度：数值型 alpha 或缺省（1）
    const constAlpha = alphaIsRamp ? 1 : clamp(opts.alpha ?? 1);
    // 明确要求全透明：什么都不画（这是调用方的本意）。
    // ⚠ 在这里 return 而不是循环里 continue：`c.save()` 已经执行过，必须配对 `c.restore()`，
    //   否则 Canvas2D 的状态栈会一帧帧涨上去。
    if (constAlpha <= 0) { c.restore(); return this; }
    for (let i = 0; i < clusters.length; i++) {
      const at = i * stagger;
      const k = perGlyphAnim ? sat((t - at) / dur) : 1;
      if (k <= 0) continue;
      const e = 1 - (1 - k) ** 3;
      let dx = 0, dy = 0, sc = 1, al = 1;
      if (from !== 'none') {
        const rem = 1 - e;
        if (from === 'up') dy = rem * dist;
        else if (from === 'down') dy = -rem * dist;
        else if (from === 'left') dx = rem * dist;
        else if (from === 'right') dx = -rem * dist;
        else if (from === 'scale') sc = lerp(1 + dist / (style.size ?? 64), 1, e);
        al = e;
      }
      const cl = clusters[i];
      if (cl === ' ' || cl === '\n') continue;
      const gx = x + X[i];
      // 常量 alpha 先乘进去；数组型 alpha 按 k 插值（整行淡入）。
      // ⚠ 数值型 alpha 走 constAlpha，绝不参与 k —— 这就是 P0-1 的修法。
      al *= constAlpha;
      if (alphaIsRamp) {
        const [a0, a1] = /** @type {[number, number]} */ (opts.alpha);
        al *= clamp(lerp(a0, a1, k));
      }
      c.globalAlpha = clamp(al);
      c.fillStyle = colors ? colors[i % colors.length] : (typeof opts.color === 'string' ? opts.color : css([1, 1, 1]));
      if (sc !== 1 || dx || dy) {
        c.save();
        c.translate(gx + dx, y + dy);
        c.scale(sc, sc);
        c.fillText(cl, 0, 0);
        c.restore();
      } else {
        c.fillText(cl, gx, y);
      }
    }
    c.restore();
    return this;
  }

  /**
   * 按**锚点**写一行字：`anchor: 'center'` 时 x 是整行中心，`'right'` 时 x 是右边缘。
   *
   * 为什么需要它：`write()` 是**逐字素簇** `fillText(cl, x + X[i])`，而 `textAlign`
   * 对每个字都生效 —— 所以 `write(..., { align: 'center' })` 会让**每个字各自居中**，
   * 多字字符串整体跑偏。这是个很容易踩、而且看起来"只是有点歪"的坑，
   * 两个任务的 `_kit.js` 都为此各写了一份 `put()`。
   *
   * 这里内部先 `measure()` 量宽度再偏移，并且强制 `align: 'left'`，所以动画
   * （stagger / alpha / from）与锚点可以放心一起用。
   *
   * @param {string} text @param {number} x @param {number} y
   * @param {TypeStyle & { anchor?: 'left'|'center'|'right', color?: any, alpha?: any,
   *   stagger?: number, staggerDur?: number, from?: string, dist?: number, t?: number }} [opts]
   * @returns {number} 这一行的宽度（含 tracking）
   */
  writeLine(text, x, y, opts = {}) {
    const anchor = opts.anchor ?? 'left';
    const w = this.measure(text, opts);
    const ax = anchor === 'center' ? x - w / 2 : anchor === 'right' ? x - w : x;
    this.write(text, ax, y, { ...opts, align: 'left' });
    return w;
  }

  /**
   * 逐词卡拉OK。words 里的每一项是「原文本的一段」——把整行按顺序切开即可，
   * 中间的空白/标点单独作为一项，这样位置永远对得上。
   *
   * ⚠ `start` / `end` 是**秒**（与 `t` 同一个时钟），不是字符下标：
   *   字符区间是由 `w` 的顺序累加长度推出来的（`karaokeSpans()`）。
   *   旧实现两者混用，导致每个词都画在行首、互相重叠，而且 sweep 的 clip 宽度是 0
   *   —— 见 `karaokeSpans()` 的注释与 `tools/test-karaoke.mjs`。
   *
   * @param {string} text 完整一行
   * @param {{w:string, start:number, end:number}[]} words 每段的文字与起止时间
   * @param {number} x @param {number} y
   * @param {number} t 当前时间
   * @param {TypeStyle & {
   *   base?: string,        // 未唱到的颜色
   *   sung?: string,        // 已唱完的颜色
   *   dim?: number,         // 未唱到的不透明度（默认 0.35）
   *   sweep?: boolean,      // 唱到的部分从左到右擦出来（逐字进度）而不是整段跳变
   *   lead?: number,        // 提前量（秒）：字可以早一点亮起来，但不能早于声音
   * }} [opts]
   */
  karaoke(text, words, x, y, t, opts = {}) {
    const c = this.ctx;
    const style = opts;
    this.font(style);
    const { clusters, cum } = this.layout(text, style);

    // 字符区间与「拼不拼得上」都在这里算；拼不上就警告一次（不抛，见 warnKaraokeMismatch）
    const { spans, mismatch } = karaokeSpans(text, words);
    if (mismatch !== null) warnKaraokeMismatch(text, mismatch);

    // 「字符下标 → 簇下标」的映射（spans 用的是 JS 字符串下标）。
    // 字符总数取 spans 累加的和，而不是 `text.length`：`text` 与 words 拼出来的串在
    // **长度相同但内容不同**时（同样会警告），也绝不能让下标越界。
    const charCount = spans.length ? spans[spans.length - 1].i1 : 0;
    const charToCluster = charToClusterMap(clusters, charCount);

    const base = opts.base ?? css([0.62, 0.6, 0.57]);
    const sung = opts.sung ?? css([1, 1, 1]);
    const dim = opts.dim ?? 0.35;
    const lead = opts.lead ?? 0.25;
    const sweep = opts.sweep ?? true;

    const xs = x;
    c.save();
    c.textAlign = 'left';

    for (let i = 0; i < spans.length; i++) {
      const { w, i0, i1, start, end } = spans[i];
      if (!w) continue;
      const c0 = charToCluster[i0] ?? 0;
      // 右边界：正常的表一定落在字素簇边界上（映射里有值）。
      // 落不上只有一种情况：某段的右边界切在一个多码元簇**中间**（比如把 'é' 拆成 'e' + '́'）。
      // 这种表"拼起来"仍然等于 text，所以**不会**触发 mismatch 警告 —— 那警告管的是丢字/多字。
      // 这里就退化成宽度 0（`?? c0`）：宁可退化，也不能让 `cum` 越界取到 undefined
      // —— 那会算出 NaN 宽度，把 clip 矩形和整帧一起搞脏（`tools/test-karaoke.mjs` ⑦ 盯着这条）。
      const c1 = charToCluster[i1] ?? c0;
      const x0 = xs + cum[c0];
      const wpx = cum[c1] - cum[c0];
      const span = Math.max(0.04, end - start);
      const ease = 1 - (1 - sat((t - start + lead) / span)) ** 3;
      const lit = karaokeLit(start, lead, t);

      c.save();
      // 底：整段用未唱到的颜色打满
      c.globalAlpha = lit ? 1 : dim;
      c.fillStyle = base;
      if (sweep || !lit) c.fillText(w, x0, y);
      if (lit) {
        if (sweep && ease > 0.001) {
          // 已经唱到的部分：逐字擦出来（clip 一段矩形再涂 sung 色）
          const sz = style.size ?? 64;
          c.beginPath();
          c.rect(x0 - sz, y - sz * 1.3, wpx * ease + sz, sz * 2.6);
          c.clip();
          c.fillStyle = sung;
          c.fillText(w, x0, y);
        } else if (!sweep) {
          c.fillStyle = sung;
          c.fillText(w, x0, y);
        }
      }
      c.restore();
    }
    c.restore();
    return this;
  }

  /** 多行文本：返回按宽度折行后的行数组。中文按字折行，拉丁按词折行。 */
  wrap(text, style = {}, maxWidth = 1200) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      if (!para) { lines.push(''); continue; }
      const tokens = para.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]|\S+\s*|\s+/g) ?? [para];
      let cur = '';
      for (const tk of tokens) {
        const test = cur + tk;
        if (cur && this.measure(test, style) > maxWidth) {
          lines.push(cur.trimEnd());
          cur = tk.trimStart();
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur.trimEnd());
    }
    return lines;
  }

  /** 画一段自动折行的正文（做说明文字、字幕块用）。 */
  paragraph(text, x, y, style = {}, opts = {}) {
    const lh = opts.lineHeight ?? (style.size ?? 40) * 1.35;
    const lines = this.wrap(text, style, opts.width ?? 1200);
    c2dLines(this.ctx, lines, (line, i) => this.write(line, x, y + i * lh, { ...style, ...opts }));
    return lines.length;
  }

  /**
   * 沿路径写字（沿曲线滚动的歌词、蓝图上的标注）。pts 是折线 [[x,y],...]。
   * 返回每个字素簇的位置，便于再做别的动画。
   */
  writeOnPath(text, pts, style = {}, opts = {}) {
    const c = this.ctx;
    this.font(style);
    const { clusters } = this.layout(text, style);
    const size = style.size ?? 48;
    const offset = opts.offset ?? 0;
    const out = [];
    let s = offset;
    for (const cl of clusters) {
      const wpx = this.measure(cl, style);
      const [px, py, ang] = pointAt(pts, s + wpx * 0.5);
      c.save();
      c.translate(px, py);
      c.rotate(ang + (opts.tilt ?? 0));
      c.textAlign = 'center';
      c.fillStyle = opts.color ?? css([1, 1, 1]);
      c.globalAlpha = opts.alpha ?? 1;
      if (opts.perChar) {
        const k = opts.perChar(cl, out.length);
        c.globalAlpha *= k.alpha ?? 1;
        c.translate(0, (k.dy ?? 0));
        c.scale(k.scale ?? 1, k.scale ?? 1);
      }
      c.fillText(cl, 0, size * 0.34);
      c.restore();
      out.push([px, py, ang, cl]);
      s += wpx + (style.tracking ?? 0);
    }
    return out;
  }

  /** 清掉缓存（改了 DPR/字体后调用） */
  clearCache() { this.widthCache.clear(); this.layoutCache.clear(); }
}

/** 沿折线按弧长取点 -> [x, y, 切线角] */
function pointAt(pts, s) {
  let acc = 0;
  const total = (() => { let n = 0; for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return n; })();
  const d = clamp(s, 0, total);
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= d || i === pts.length - 1) {
      const k = seg ? (d - acc) / seg : 0;
      const x = lerp(pts[i - 1][0], pts[i][0], k);
      const y = lerp(pts[i - 1][1], pts[i][1], k);
      return [x, y, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])];
    }
    acc += seg;
  }
  return [pts[0][0], pts[0][1], 0];
}

function c2dLines(ctx, lines, fn) { lines.forEach(fn); }

/* ------------------------------------------------------------------ karaoke 的纯逻辑 */

/**
 * 「这个词到底占原文本的哪几个字符」——`karaoke()` 的全部纯逻辑，不碰 canvas，所以能单测。
 *
 * 为什么要有它：旧实现把 `start` / `end` **同时当成了字符下标和秒**：
 * ```js
 * const c0 = charToCluster[start] ?? 0;   // ← 这里把它们当字符下标
 * const span = Math.max(0.04, end - start); // ← 这里又当秒
 * ```
 * 按文档写的用法（`start` / `end` 是秒，例如 `{ w: '代码', start: 12.4, end: 12.9 }`）
 * `charToCluster[12.4]` 是 `undefined` → `?? 0` → 每个词的 `x0` 都等于**行首**、`wpx` 都是 **0**
 * ⇒ 所有词叠在同一个位置，而且 sweep 的 clip 矩形宽度是 0（等于根本扫不出来）。
 * 一直没被发现是因为全仓库没有任何任务用过 `type.karaoke`（只有文档里的示例）。
 *
 * 所以字符区间**只能由 `w` 的顺序累加长度推出来**（words 的每一项就是原文本的一段），
 * `start` / `end` 原样透传，只当秒用。
 *
 * @param {string} text 完整一行
 * @param {{w:string, start:number, end:number}[]} words 每段的文字与起止**秒**
 * @returns {{spans: {w:string, i0:number, i1:number, start:number, end:number}[], mismatch: string|null}}
 *   `spans[i].i0/i1` 是**字符（UTF-16 码元）下标**区间 `[i0, i1)`，首尾相接、并集覆盖 `text`；
 *   `mismatch` 是「words 拼起来 ≠ text」时的实际拼出结果（拼得上则为 `null`）。
 *
 *   ⚠ 这里是**码元下标**（与 `String.prototype.length` / `slice` 一致），因为画布上的簇位置
 *   只能由 `karaoke()` 里那份 `layout()` 结果给出。正常写法的表每一段都正好切在字素簇边界上，
 *   所以码元区间能一对一映射回簇区间；某一段的边界切在一个多码元簇（emoji / 组合字符）
 *   **中间**时映射不上（它拼起来仍等于 `text`，所以 `mismatch` 还是 `null`），
 *   `karaoke()` 会把那一段退化成宽度 0 —— 不抛错，但也不会算出 NaN。
 */
export function karaokeSpans(text, words) {
  const src = String(text ?? '');
  const list = Array.isArray(words) ? words : [];
  /** @type {{w:string, i0:number, i1:number, start:number, end:number}[]} */
  const spans = [];
  let charOff = 0;
  for (const wd of list) {
    const w = String(wd?.w ?? '');
    const i0 = charOff;
    charOff += w.length;
    // 时间原样带过来（秒）。**不做任何下标化处理** —— 这正是这次修的 bug。
    spans.push({ w, i0, i1: charOff, start: Number(wd?.start ?? 0), end: Number(wd?.end ?? 0) });
  }
  const got = spans.map((s) => s.w).join('');
  return { spans, mismatch: got === src ? null : got };
}

/**
 * 「这个词此刻算不算已经唱到」——**秒**的比较，纯函数，理由同上（旧实现里它埋在大函数中间，
 * 谁也没法单测 `lit = t >= start - lead` 这条判据）。
 *
 * @param {number} start 这个词的起始**秒** @param {number} lead 提前量（秒） @param {number} t 当前**秒**
 */
export function karaokeLit(start, lead, t) {
  return t >= start - lead;
}

/**
 * words 拼不上 text 时**警告一次**：位置一定不对，但一支片子不该因为一个字幕表里少了个空格
 * 就整帧崩掉（所以 console.warn 而不是 throw）。
 *
 * 为什么不能只静默：这个仓库最贵的历史教训就是「看起来完全正常」的失败
 * （`docs/STATUS.md` §11.0）。而拼不上的后果恰恰是最难看出来的一种 ——
 * 后面每个词都整体错位，画面依然"有字、有颜色、在动"。
 * 每次调都报同样一个 key，所以按 key 去重（`warnedKaraoke`）。
 *
 * @param {string} text @param {string} mismatch words 实际拼出来的结果
 */
export function warnKaraokeMismatch(text, mismatch) {
  const key = String(text);
  if (warnedKaraoke.has(key)) return;
  warnedKaraoke.add(key);
  const brief = (s) => {
    const one = JSON.stringify(s);
    return one.length > 160 ? `${one.slice(0, 160)}…（共 ${s.length} 字符）` : one;
  };
  // eslint-disable-next-line no-console
  console.warn(
    `[anim] karaoke 的 words 拼起来不等于 text（位置会错）：得到 ${brief(mismatch)}，期望 ${brief(String(text))}`,
  );
}

/**
 * 便捷：把一行歌词按空白切成 karaoke 需要的 words 结构（时间是外部给的）。
 *
 * ⚠ **`times` 必须补齐**：没给、或者给少了，那几段的 `start`/`end` 就是 0 ——
 * 拼得上所以 `warnKaraokeMismatch` 不会响，但画面上**所有词会在同一瞬间一起亮**
 * （`karaoke()` 里 `span` 被兜成 0.04s），是那种"看起来像 bug 又找不到报错"的样子。
 * 所以这里自己检查一次：数量对不上就警告一次（按行去重）。
 *
 * @param {string} line
 * @param {[number, number][]} [times] 每一段的 `[start, end]`（秒），长度要与切出来的段数一致
 */
export function wordsOf(line, times = []) {
  const parts = [];
  const re = /\S+\s*/g;
  let m;
  while ((m = re.exec(line))) parts.push({ w: m[0], start: 0, end: 0 });
  parts.forEach((p, i) => { const tt = times[i]; if (tt) { p.start = tt[0]; p.end = tt[1]; } });
  if (times.length < parts.length && !warnedWordsOf.has(String(line))) {
    warnedWordsOf.add(String(line));
    // eslint-disable-next-line no-console
    console.warn(
      `[anim] wordsOf：切出 ${parts.length} 段，但只给了 ${times.length} 段时间 ——`
      + ` 没给到的那几段 start=end=0，会**同时**亮起来（不是"不亮"）。`
      + ` 要么补时间，要么直接用 ctx.narration 的词级时间戳（docs/NARRATION.md C 档）。`,
    );
  }
  return parts;
}

/** `wordsOf` 的警告去重（同一行只报一次）。 */
const warnedWordsOf = new Set();

export { splitWords, segment };
