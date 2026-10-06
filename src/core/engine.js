// @ts-check
/**
 * 引擎：把「时间」变成「一帧」。
 *
 * 渲染一帧做的事：
 *   1) 找出这一时刻有哪些段在播（允许重叠 = 转场）
 *   2) 每段画进一个 HDR 目标，按需跟上下的段交叉溶解
 *   3) 叠上 Canvas2D 图层（文字/UI）
 *   4) 跑后处理（泛光/光晕/颗粒/暗角/调色）
 *   5) 写进 outRT（**线性光**，编码在最后一步：屏幕走 blitPass 的 toSRGB，导出走 readPixels(rt,'srgb')）
 *
 * 运动模糊：离屏渲染时一帧会被拆成 N 个子帧（散在快门时间内）求平均。
 * N 可以自适应（8 → 24 → 72 → 216），判据是「再加一组子帧，画面变化是否小于容差」。
 * 静止帧停在 8，普通运镜 24，甩镜/砸字会吃到 72 或 216。
 */

import { GL, RT, Pass, Compositor, Layer2D } from './gl.js';
import { Post, DEFAULT_POST } from './post.js';
import { P as DEFAULT_PALETTE } from './palette.js';
import { Scene as SceneBase, frameSeed } from './scene.js';
import { TextKit } from './text.js';
import { makeNarration, makeNarrationReader } from './narration.js';
import { SILENT } from './audio.js';
import * as U from './util.js';

/** @typedef {import('./post.js').PostParams} PostParams */

/**
 * @typedef {Object} TimelineItem
 * @property {string} id            名字（要唯一）
 * @property {any} scene            场景对象 或 () => Promise<场景对象>（懒加载）
 * @property {number} start         起点（秒）
 * @property {number} end           终点（秒）
 * @property {Record<string, any>} [params] 传给场景的参数
 * @property {Partial<PostParams>} [post]   这一段的默认后处理
 * @property {boolean} [handlesTransition]  自己处理与上一段的衔接
 * @property {number} [maxSamples]  这一段的自适应采样上限（噪声收敛慢的场景用）
 * @property {string} [note]        备注，只在 timeline 列表里显示
 */

/** 运动模糊容差：显示空间（0..255）里最大允许的平均变化。 */
const DEFAULT_TOL = 2.5;
const BASE_SAMPLES = 8;
const MAX_SAMPLES = 216;

export class Engine {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{ width?: number, height?: number, scale?: number, palette?: any, fps?: number }} [opts]
   */
  constructor(canvas, opts = {}) {
    this.gl = new GL(canvas, { scale: opts.scale ?? 1 });
    this.gl.resize(opts.width ?? 1920, opts.height ?? 1080, opts.scale ?? 1);
    // P 必须在 Post 之前赋值：Pass 在构造时就把调色板常量注入 shader 源码，
    // 顺序反了的话，任务覆盖的 palette 只在场景里生效，后处理链里还是默认配色。
    this.P = opts.palette ?? DEFAULT_PALETTE;
    this.fps = opts.fps ?? 60;
    this.comp = new Compositor(this.gl);
    this.post = new Post(this.gl, this.P);
    /**
     * HUD 专用的 Canvas2D 图层。
     * 每个时间线条目（每段场景）有**自己**的图层（item._layer），互不干扰——
     * 用一张共享画布的话，两段重叠时（转场）会互相擦除，HUD 也会把场景的文字擦掉。
     */
    this.hud2d = new Layer2D(this.gl);
    this.text = this.hud2d;
    this.type = this.hud2d.type;
    /** @type {TimelineItem[]} */
    this.timeline = [];
    /** @type {Map<string, any>} */
    this.scenes = new Map();
    this.music = SILENT;
    this.lyrics = null;
    /**
     * 口播 / 旁白时间轴（`docs/NARRATION.md` A 档）。
     * 由 `load()` 用 `makeNarrationReader()` 包成查询接口；没配 `task.narration` 时
     * 是一个"永远返回 null"的空实现，所以场景里可以无条件写 `ctx.narration.at(f.t)`。
     */
    this.narration = makeNarrationReader(null);
    /** 装载期的错误（setup 失败、共享背景建不出来、--only 写错…） */
    this.errors = [];
    /**
     * **场景 render 抛的异常**，结构化记着（段名 / 时刻 / 帧号 / 栈）。
     *
     * 与 `errors`（字符串，人看）分开的原因：CLI 要拿它做**机器判据** ——
     * `check` 必须失败、`video` 必须不出片（`docs/IMPROVEMENTS-2.md` P0-3）。
     * 去重交给 `app.js` / CLI 那侧做（同一段每帧都抛，这里如实全记）。
     * @type {{ id: string, t: number, idx: number, message: string, stack: string }[]}
     */
    this.renderErrors = [];
    this.hud = true;
    this.hudInfo = { title: '', note: '' };
    this.duration = 0;
    this.startTime = 0;

    // 三个 HDR 目标轮转，保证转场时「上一个场景」的成帧还在
    this.pool = [new RT(this.gl, this.gl.pw, this.gl.ph, { depth: true }),
                 new RT(this.gl, this.gl.pw, this.gl.ph, { depth: true }),
                 new RT(this.gl, this.gl.pw, this.gl.ph, { depth: true })];
    this.mixRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    this.avgRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    this.sumRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    this.newRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    /** 场景级变换（ctx.setXform）的外部目标：绝不「读自己写自己」 */
    this.xformRT = new RT(this.gl, this.gl.pw, this.gl.ph);
    this.errRT = new RT(this.gl, Math.ceil(this.gl.pw / 16), Math.ceil(this.gl.ph / 16), { nearest: true });
    this.outRT = new RT(this.gl, this.gl.pw, this.gl.ph, { float: false });
    this.errBuf = new Uint8Array(this.errRT.w * this.errRT.h * 4);
    this.errPass = null;

    this.lines = null; // 由 load() 建（需要 palette 就绪）
    this.lastT = -1;
    this.lastSamples = 1;
    this.lastErrors = [];
    this.lastPost = { ...DEFAULT_POST };
  }

  /* ------------------------------------------------------------ 装载 */

  /**
   * @param {{ timeline: TimelineItem[], music?: any, lyrics?: any, title?: string,
   *           duration?: number, only?: string|null, worldPass?: any }} spec
   */
  async load(spec) {
    this.timeline = (spec.timeline ?? []).slice().sort((a, b) => a.start - b.start);
    this.renderErrors.length = 0;
    this.duration = spec.duration ?? Math.max(0, ...this.timeline.map((i) => i.end));
    this.music = spec.music ?? SILENT;
    this.lyrics = spec.lyrics ?? null;
    /**
     * 旁白表：`load()` 时归一 + 包一次，之后每帧只做纯查询（不依赖上一帧）。
     * 场景里既可以从 `ctx.narration` 拿，也可以从 `f.narration` 拿 —— 同一个对象。
     *
     * ⚠ `load()` 收的既可以是**原始 spec**（`{ lines: [...] }` 或数组，直接跑引擎的测试用），
     *   也可以是 `src/tasks.js` 归一好的表（有 `source` / `totalSpeech` 那些派生量）。
     *   判据是"有没有 `lines` 且每行带 `end`"—— 归一次很便宜，不做这个判断的话
     *   原始 spec 会被当成归一表，`lines` 全部变空、`ctx.narration.at()` 恒为 null
     *   （这个坑当场踩了：`probe-alpha` 的旁白用例全 FAIL，而 `lineCount` 是 undefined）。
     */
    const narrSpec = spec.narration ?? null;
    const narrReady = narrSpec && Array.isArray(narrSpec.lines)
      && narrSpec.lines.every((l) => l && typeof l === 'object' && l.end != null);
    this.narration = makeNarrationReader(
      narrReady ? narrSpec : makeNarration(narrSpec, { duration: this.duration }),
    );
    this.hudInfo.title = spec.title ?? '';
    /**
     * 全片共享的背景 Pass（`task.worldPass(ctx)` 的返回值）。
     *
     * 为什么要在引擎里有一等公民的位置：做一支片子时「全片只有一层背景」是让镜头切换
     * 不"跳"的关键（见 trans.js 顶部那四条配方），而**场景作者忘了调用它就是静默黑底** ——
     * 做 fidus 时 9 段里 8 段这样，且 check 的亮度统计抓不到（文字和 grain 自己就有亮度）。
     * 现在两种用法都不靠"记得"：
     *   · `cut(shot, { world: 'auto' })` —— 引擎每帧先画共享背景，再调场景 render；
     *   · `ctx.world`                    —— 场景自己画（转场时也拿得到）。
     * 没声明 world 的段引擎不碰底，行为与以前完全一致（老任务不受影响）。
     */
    this.worldPass = spec.worldPass ?? null;
    /**
     * **解析好的**共享背景 Pass（而不是 task 给的那个函数）。
     *
     * 为什么在这里解析一次：`task.world` 是个 `(ctx) => Pass` 的工厂，`ctx` 里的
     * `gl` / `P` 在 `load()` 时就已经就绪，而 Pass 的构造（以及它的程序缓存 key）
     * 每帧重建一次既浪费又容易和「场景自己 setup 里建一次」的行为不一致。
     * 引擎级 world 的语义就是「全片同一张」，所以解析一次、全片复用。
     */
    this.world = null;

    const { LineBatch } = await import('./gl.js');
    this.lines = new LineBatch(this.gl, 60000);

    // --only a,b：只加载指定的段。用来快速迭代单段，也用来隔离别人写坏的场景。
    //
    // ⚠ 语义（踩过）：`--only` 会**把选中的段平移到时间轴开头**，
    //   所以 `still <任务> -t 1 --only chart` 里的 `-t 1` 指"chart 段内第 1 秒"。
    //   以前这里只做过滤、保留全局时间，于是 `--only` 之后你几乎总是取到段外（全黑），
    //   而且日志里还会顺带报一堆"空档"。
    const only = spec.only ? String(spec.only).split(',').map((s) => s.trim()).filter(Boolean) : null;
    this.only = only;
    if (only) {
      const known = new Set(this.timeline.map((i) => i.id));
      const missing = only.filter((id) => !known.has(id));
      if (missing.length) {
        this.errors.push(
          `--only 里这些段不存在: ${missing.join(', ')}。现有段: ${[...known].join(', ')}`,
        );
      }
      this.timeline = this.timeline.filter((i) => only.includes(i.id));
      if (!this.timeline.length) {
        throw new Error(`--only ${only.join(',')} 没有匹配到任何段，时间线是空的`);
      }
      // 平移到 0 起点：段的相对先后与重叠保持不变
      const shift = Math.min(...this.timeline.map((i) => i.start));
      for (const it of this.timeline) { it.start -= shift; it.end -= shift; }
      this.timeline.sort((a, b) => a.start - b.start);
      this.onlyDuration = Math.max(...this.timeline.map((i) => i.end));
      // 导出/预览都用这个时长；整片时长仍可从 task.duration 查到
      this.fullDuration = this.duration;
      this.duration = this.onlyDuration;
    }

    // 懒加载并按需 setup。每段场景分到自己的 Canvas2D 图层。
    for (const item of this.timeline) {
      try {
        item._layer = new Layer2D(this.gl);
        let scene = item.scene;
        if (typeof scene === 'function') scene = await scene();
        if (scene?.default) scene = scene.default;
        if (typeof scene === 'function') scene = new scene();
        item._scene = scene;
        if (scene?.setup) await scene.setup(this._ctxFor(item, 0, 1));
      } catch (err) {
        this.errors.push(`[${item.id}] setup 失败: ${fmtErr(err)}`);
      }
    }
    // 共享背景解析一次（见 this.world 的注释）。setup 之后再解析：
    // 那时 palette、lines、图层都已就绪，工厂里想用 ctx 的任何东西都拿得到。
    if (this.worldPass) {
      try {
        const ctx0 = this._ctxFor({ id: '__world', start: 0, end: 1, params: {} }, 0, 0, {});
        this.world = typeof this.worldPass === 'function' ? this.worldPass(ctx0) : this.worldPass;
      } catch (err) {
        // 不静默：共享背景建不出来意味着每一段都会黑底，必须立刻说出来
        this.worldError = fmtErr(err);
        this.errors.push(`[共享背景] 创建失败: ${this.worldError}`);
      }
    } else {
      this.worldError = `(spec.worldPass 是 ${spec.worldPass === null ? 'null' : typeof spec.worldPass}，task.world 没有传到引擎)`;
    }
    return this;
  }

  /** 检查时间线本身的问题（重叠顺序、空档、越界）。 */
  validate() {
    const problems = [];
    const items = this.timeline;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!(it.end > it.start)) problems.push(`[${it.id}] end(${it.end}) 必须大于 start(${it.start})`);
      if (!it._scene) problems.push(`[${it.id}] 场景没加载成功`);
      if (i > 0 && it.start < items[i - 1].start) problems.push(`[${it.id}] 起点比上一段还早`);
      if (it.end - it.start < 1 / this.fps) problems.push(`[${it.id}] 只有 ${(it.end - it.start).toFixed(3)}s，不到一帧`);
    }
    const cover = [];
    let cursor = 0;
    for (const it of items) {
      if (it.start > cursor + 1e-6) cover.push(`${cursor.toFixed(2)}–${it.start.toFixed(2)}s 没有场景（会渲染成黑）`);
      cursor = Math.max(cursor, it.end);
    }
    return { problems, gaps: cover };
  }

  /* ------------------------------------------------------------ 帧上下文 */

  _ctxFor(item, t, idx, extras = {}) {
    const f = {
      t,
      dt: extras.dt ?? 1 / this.fps,
      lt: t - item.start,
      p: U.sat((t - item.start) / Math.max(1e-6, item.end - item.start)),
      start: item.start,
      end: item.end,
      fps: this.fps,
      idx,
      seed: frameSeed(idx),
      beat: 0, bar: 0, beatPhase: 0,
      preview: extras.preview ?? false,
      seeked: false,
      tin: extras.tin ?? 1,
      tout: extras.tout ?? 0,
      under: extras.under ?? null,
      a: this.music.at ? this.music.at(t) : {},
      params: item.params ?? {},
      /** 口播查询接口（`docs/NARRATION.md` A 档）：`f.narration.at(t)` / `.current(t)` … */
      narration: this.narration,
    };
    const beat = this.music.beatAt ? this.music.beatAt(t) : t * 2;
    f.beat = beat; f.bar = beat / 4;
    f.beatPhase = beat - Math.floor(beat);

    const ctx = {
      f, gl: this.gl, out: extras.out, under: f.under,
      comp: this.comp, P: this.P,
      // 这一段自己的 2D 图层与排版工具（画文字/图形都用它，别用 engine.text）
      text: item._layer ?? this.hud2d, type: (item._layer ?? this.hud2d).type,
      lines: this.lines, music: this.music, lyrics: this.lyrics,
      narration: this.narration,
      params: f.params, W: this.gl.w, H: this.gl.h,
      start: item.start, end: item.end, item,
      util: U, rng: U.rng,
      /** 便捷：把整帧清成一个颜色 */
      clear: (c = [0, 0, 0]) => this.gl.clear(extras.out, c),
    };
    return ctx;
  }

  /* ------------------------------------------------------------ 合成 */

  /** 把 t 时刻所有在播的段合成到一张 HDR 纹理上。返回 {tex, post}。 */
  composite(t, idx, subDt, seeked = false, opts = {}) {
    const skipScene = !!opts.skipScene;
    const items = this.timeline.filter((i) => t >= i.start && t < i.end);
    let under = null;
    let outTex = null;
    let post = { ...DEFAULT_POST };

    for (let k = 0; k < items.length; k++) {
      const item = items[k];
      const rt = this.pool[k % this.pool.length];
      const prev = items[k - 1], next = items[k + 1];
      const tin = prev ? U.sat((t - item.start) / Math.max(1e-3, prev.end - item.start)) : 1;
      const tout = next ? U.sat((t - next.start) / Math.max(1e-3, item.end - next.start)) : 0;
      // `_scene` 有值就说明已经过了 setup（这一步在 composite 里做，因为 ctx 每帧都在变）
      const layer = item._layer;
      const scene = item._scene;
      if (!scene) {
        // 场景没加载成功（setup 抛异常，见 load()）——同样必须是"一眼看出崩了"，不是暗红整帧
        this.gl.clear(rt, [0.12, 0, 0]);
        this._errorCard(rt, item, item.id, t, idx, `场景没有加载成功（setup 失败或 --only 选错了段）`);
        // `_errorCard` 里已经 upload 过图层，所以这里可以安全地提交（见下面的长注释）
        if (layer?._uploaded) this.comp.draw(this.gl, layer, rt, { premult: false });
        this.gl.paint.markError = true;
        under = rt; outTex = rt;
        continue;
      }

      // 场景必须整帧覆盖 out；先清一遍兜底（场景忘了画就是纯黑，肉眼可见地错）
      this.gl.clear(rt, [0, 0, 0]);
      const ctx = this._ctxFor(item, t, idx, { out: rt, dt: subDt, tin, tout, under: k > 0 ? under : null, seeked });
      // 共享背景（一等地基，见 load() 的注释）：声明了 world 的段由引擎先铺底，
      // 场景只管前景。'auto' = task.worldPass；对象 = 这一段专用；false = 本段自己负责。
      ctx.world = resolveWorld(this, item);
      // `skipScene` 只给 `check` 的背景守门用（worldAudit）：只跑背景、不跑场景，
      // 这样「这一段到底铺了底没有」是可测的，而不是靠作者记得调用。
      if (skipScene) {
        this.gl.paint = { full: 0, any: 0, lines: 0, target: rt, other: 0, markError: false };
        if (ctx.world && item.world !== false) {
          try { ctx.world.render(this.gl, rt, t, subDt); } catch { /* 记在下面统一处理 */ }
        }
        item._lastPaint = this.gl.paint;
        this.gl.paint = null;
        under = rt;
        continue;
      }
      if (ctx.world && item.world !== false) {
        try {
          ctx.world.render(this.gl, rt, t, subDt);
        } catch (err) {
          this.errors.push(`[${item.id}] 共享背景渲染出错: ${fmtErr(err)}`);
        }
      }
      // 绘制记账：这一段到底往画面里画了东西没有（"什么都没画"以前抓不到）
      this.gl.paint = { full: 0, any: 0, lines: 0, target: rt, other: 0, markError: false };
      // 场景级变换（§3.5）：让「一道前景」整体平移/缩放/旋转 —— 一台摄影机、视差、反向落位都靠它。
      // 每段各自持有一个对象，每帧先归零；场景必须显式调用 ctx.setXform(...) 才算数。
      ctx.xform = item._xform ?? (item._xform = { x: 0, y: 0, scale: 1, rot: 0, anchor: null, p: 0, q: 0, on: false, edge: 'clamp' });
      ctx.xform.on = false;
      ctx.xform.edge = 'clamp';
      ctx.setXform = (o = {}) => {
        const x = ctx.xform;
        x.x = o.x ?? 0; x.y = o.y ?? 0;
        x.scale = o.scale ?? 1; x.rot = o.rot ?? 0;
        x.anchor = o.anchor ?? null;
        // p/q：透视（keystone）系数，见 xformForward 的注释。
        // 用 cam.js 的 camXform(cam, ...) 算，或者自己按 project() 的 k 反算。
        x.p = o.p ?? 0; x.q = o.q ?? 0;
        // clamp：画面外采样夹到边缘（"整个画面被推走"的运镜，推荐）
        // black：画面外采到黑（视差：背景不动、只有前景在动时用，否则会把背景色拉出条纹）
        x.edge = o.edge === 'black' ? 'black' : 'clamp';
        x.on = true;
        return x;
      };
      let drewErrorCard = false;
      try {
        const ov = scene.render(ctx);
        if (ov && typeof ov === 'object') post = { ...post, ...(item.post ?? {}), ...ov };
        else if (item.post) post = { ...post, ...item.post };
      } catch (err) {
        /**
         * 场景抛错 = **硬错误**，绝不能画一帧意思不明的纯色糊过去
         * （`docs/IMPROVEMENTS-2.md` P0-3）。
         *
         * 旧行为有多贵：beast 的 outro 里 `const slot = ctx.params?.slot` 遮蔽了
         * `_kit.js` 的 `slot()` 画格子函数 → TypeError。引擎 catch 住，把整帧涂成
         * **暗红 (0.15,0,0)**，文字图形全无，而 `check` 三处采样全绿、控制台一个字都没有
         * —— 我是靠抽帧看到"121.2s 之后整屏暗红"才发现的。
         *
         * 现在两件事一起做：
         *   ① 记进 `renderErrors`（带段名/帧号/栈），CLI 的 check/video 会拿它**非零退出**；
         *   ② 画一张**一眼能看出来是崩了**的错帧卡片（不是"某个奇怪的底色"）。
         */
        const msg = fmtErr(err);
        this.renderErrors.push({
          id: item.id, t, idx, message: msg,
          stack: err && err.stack ? String(err.stack) : '',
        });
        this.errors.push(`[${item.id}] t=${t.toFixed(3)} 渲染出错: ${msg}`);
        // ⚠ 后处理参数必须**回到默认**：错帧卡片不能继承上一段/上一帧的调色、暗角、泛光，
        //   否则"亮红框 + 暗红底"会被压成一片灰暗红，一眼看不出是崩了（实测边框被暗角
        //   从 (242,41,41) 压到 (106,22,22)，等于把"明显的错"变成"奇怪的底色"）。
        post = { ...DEFAULT_POST };
        this._errorCard(rt, item, item.id, t, idx, msg);
        drewErrorCard = true;
        this.gl.paint.markError = true;
      }
      // 把这一段的 Canvas2D 图层（场景的文字/图形）"提交"进 rt。
      //
      // ⚠⚠ 只有当这一帧**真的往图层里画过东西**时才能调 `comp.draw`：图层纹理是
      //   第一次 `upload()` 才 `texImage2D(SRGB8_ALPHA8)` 分配出来的，没分配过的图层
      //   采样出来是**未定义的**；某些驱动/格式组合下会把整个 rect 写成 0，
      //   于是"场景只 clear 了一个颜色、一个字都没写"的那种段整帧变黑
      //   （诊断过程见 docs/IMPROVEMENTS-2.md P0-3 的"顺带发现"：
      //    `probe` / `ribbon` 两个纯 clear 的标定段在 check 里读数是 0.000，
      //    而 `xf`/`xa`/`xb`（都写了字）正常 —— 差别就在这）。
      //   判据用 `layer._uploaded`：场景调用 `text.upload()` 会把它置 true，
      //   而老的、正确的工作方式（场景自己调 `comp.draw(gl, text, out)`）也是先 upload，
      //   所以这个判据与历史行为完全一致 —— 只是额外把错帧卡片的图层也提交进去。
      if (layer && (layer._uploaded || drewErrorCard)) {
        this.comp.draw(this.gl, layer, rt, { premult: false });
      }
      // 记下这一段的绘制情况，给 `check` 的背景守门用（worldAudit）
      item._lastPaint = this.gl.paint;
      this.gl.paint = null;

      // 变换整张前景（含它自己的文字图层）——用一张外部目标做，绝不「读自己写自己」
      if (ctx.xform.on && !isIdentityXform(ctx.xform)) {
        assertXform(ctx.xform, item.id, t, this.errors);
        // ⚠ 这是引擎内部的搬运，不是"这一段画了东西"：记账先摘掉（否则会污染 worldAudit）
        const keepPaint = this.gl.paint;
        this.gl.paint = null;
        const xp = this._xformPass();
        xp.u.m.value = xformMatrix(this.gl, ctx.xform);
        xp.u.src.value = { tex: rt.tex, __tex: true };
        xp.u.edge.value = ctx.xform.edge === 'black' ? 1 : 0;
        xp.render(this.gl, this.xformRT, t, subDt);
        this.gl.paint = keepPaint;
        outTex = this.xformRT;
      } else {
        outTex = rt;
      }

      if (k > 0 && !scene.handlesTransition && under) {
        this.comp.mixTo(this.gl, under, outTex, tin, this.mixRT);
        outTex = this.mixRT;
      }
      under = outTex;
    }
    if (!outTex) { this.gl.clear(this.pool[0], [0, 0, 0]); outTex = this.pool[0]; }
    return { tex: outTex, post };
  }

  /**
   * 错帧卡片：场景抛异常时画的东西。
   *
   * 设计目标只有一个 —— **任何人（包括只看缩略图的 agent）一眼就知道"这不是画面，这是崩了"**。
   * 旧的「整帧暗红」做不到这一点：它在缩略图里像一层"刻意的暗红底"，于是被发现得很晚。
   *
   *   · 底：暗红（不是纯黑，也不会被误认成"漏画背景"那个纯黑坑）
   *   · 红框：贴着画面边缘的一圈厚红边（相对亮度 ≈ 0.42，暗红底只有 0.19，差一倍多，
   *     缩略图里也看得见）
   *   · 文字：段名 / 帧号 / 时刻 / 异常首行 —— 让人不用翻日志就知道是哪一段
   *
   * ⚠ 走**这一段的 Canvas2D 图层**（`item._layer`），不是 HUD 层：HUD 只在预览里画，
   *   而错帧卡片恰恰只有在**没有人看着屏幕**的离屏渲染里才重要。
   *   `composite()` 在场景 render 之后会 `comp.draw(layer, rt)`，所以这里只准备图层内容；别的
   *   调用方（worldAudit 之类）拿到的是"底色 + 红框"这一层保底，也够用。
   */
  _errorCard(rt, item, id, t, idx, message) {
    const gl = this.gl;
    gl.clear(rt, [0.16, 0.010, 0.010]);
    const layer = item?._layer;
    if (!layer) return;
    try {
      const c = layer.ctx;
      const W = gl.w, H = gl.h;
      // 图层自己的变换得复位：场景可能中途 throw，留下了一个没 restore 的状态
      c.setTransform(layer.scale, 0, 0, layer.scale, 0, 0);
      c.restore();                       // 把场景留下的栈清干净
      c.save();
      c.globalAlpha = 1;
      c.clearRect(0, 0, W, H);
      const bh = Math.max(14, Math.round(H * 0.035));
      c.fillStyle = 'rgb(242, 41, 41)';
      c.fillRect(0, 0, W, bh);
      c.fillRect(0, H - bh, W, bh);
      c.fillRect(0, 0, bh, H);
      c.fillRect(W - bh, 0, bh, H);
      c.fillStyle = 'rgba(0,0,0,0.62)';
      const bandH = Math.max(120, Math.round(H * 0.20));
      c.fillRect(0, (H - bandH) / 2, W, bandH);
      const size = Math.max(18, Math.round(H * 0.042));
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = 'rgb(255, 96, 82)';
      c.font = `700 ${size}px "IBM Plex Mono", Consolas, monospace`;
      c.fillText('✗ SCENE ERROR', W / 2, H * 0.5 - size * 0.65);
      c.fillStyle = 'rgba(255,255,255,0.94)';
      c.font = `500 ${Math.round(size * 0.52)}px "IBM Plex Mono", Consolas, monospace`;
      c.fillText(`${id}   frame ${idx}   t=${t.toFixed(3)}s`, W / 2, H * 0.5 + size * 0.25);
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.font = `400 ${Math.round(size * 0.44)}px "IBM Plex Mono", Consolas, monospace`;
      c.fillText(String(message).split('\n')[0].slice(0, 140), W / 2, H * 0.5 + size * 1.1);
      c.textAlign = 'start';
      c.restore();
      layer.upload();
    } catch { /* 连错帧卡片都画不出来时，至少底色和红框已经在 rt 里了 */ }
  }

  /* ------------------------------------------------------------ 渲染一帧 */

  /**
   * 渲染时刻 t 的一帧。
   * @param {number} t
   * @param {{ samples?: number|'auto', shutter?: number, tol?: number, toScreen?: boolean, preview?: boolean, seeked?: boolean }} [opts]
   * @returns {{ samples: number, errors: number[] }}
   */
  render(t, opts = {}) {
    const gl = this.gl;
    const idx = Math.floor(t * this.fps + 1e-6);
    const shutter = opts.shutter ?? 0.5;
    const preview = opts.preview ?? false;
    let wanted = opts.samples ?? (preview ? 1 : 'auto');
    let n = 1;
    let post = { ...DEFAULT_POST };
    let outTex = null;
    this.errors.length && (this.errors = this.errors.slice(-40));

    if (wanted === 1) {
      const r = this.composite(t, idx, 1 / this.fps, opts.seeked, { skipScene: opts.skipScene });
      outTex = r.tex; post = r.post;
      this.lastSamples = 1;
      this.lastErrors = [];
    } else {
      const tol = opts.tol ?? DEFAULT_TOL;
      const adaptive = wanted === 'auto';
      // 自适应采样要求每个子帧都能独立渲染（乱序、任意个数），所以有状态场景直接被拒绝
      const active0 = this.timeline.filter((i) => t >= i.start && t < i.end);
      for (const it of active0) {
        const sc = it._scene;
        if (sc && (sc.stateful || sc.integrates)) {
          throw new Error(`[${it.id}] 声明了 stateful/integrates，无法做运动模糊采样。` +
            `把状态改成「由 t 直接求值」（例如粒子位置 = f(出生时间)），或对该段用 { samples: 1 }。`);
        }
      }
      let maxSamples = adaptive ? MAX_SAMPLES : /** @type {number} */ (wanted);
      for (const it of active0) if (it.maxSamples) maxSamples = Math.min(maxSamples, it.maxSamples);
      maxSamples = Math.max(BASE_SAMPLES, maxSamples);

      const levels = adaptive ? Math.max(0, Math.floor(Math.log(maxSamples / BASE_SAMPLES) / Math.log(3) + 1e-9)) : 0;
      const offsets = adaptive ? ternaryOffsets(levels) : fixedOffsets(/** @type {number} */ (wanted));
      const step = (1 / this.fps) * shutter;
      const acc = this._accumPass();

      this.gl.clear(this.sumRT, [0, 0, 0], 0);
      this.lastErrors = [];
      this._nearest = Infinity;
      let done = 0;

      /** 渲染 offsets[from..to) 并累加（加性混合）到 target。 */
      const addSamples = (from, to, target) => {
        for (let i = from; i < to; i++) {
          const subT = Math.max(0, t + step * offsets[i]);
          const r = this.composite(subT, idx, step, opts.seeked && i === 0);
          acc.u.src.value = { tex: r.tex.tex ?? r.tex, __tex: true };
          acc.render(this.gl, target, subT, 1 / this.fps);
          const d = Math.abs(offsets[i] - 0.125);
          if (d < this._nearest - 1e-9) { this._nearest = d; post = r.post; }
        }
      };

      if (adaptive) {
        addSamples(0, BASE_SAMPLES, this.sumRT);
        done = BASE_SAMPLES;
        this._groupA = BASE_SAMPLES;   // 当前 sumRT 里累的是 offsets[0..done)
        this._groupB = BASE_SAMPLES;
        for (let L = 0; L < levels; L++) {
          const from = done, to = done * 3;
          this.gl.clear(this.newRT, [0, 0, 0], 0);
          addSamples(from, to, this.newRT);
          const err = this._sampleError();
          this.lastErrors.push(err);
          // 把新样本并进总累加，然后刷新分组记账
          acc.u.src.value = { tex: this.newRT.tex, __tex: true };
          acc.render(this.gl, this.sumRT, t, 1 / this.fps);
          done = to;
          this._groupA = done;
          this._groupB = (to - from) * 2;  // 用于误差比较的「新组」均值权重
          if (err < tol) break;
        }
      } else {
        addSamples(0, /** @type {number} */ (wanted), this.sumRT);
        done = /** @type {number} */ (wanted);
      }

      n = done;
      // 求平均：sumRT / n -> avgRT
      // ⚠ avgRT 必须先清空：copyOver 走的是 alpha 混合（compositor_copy 写的是
      //   vec4(rgb, opacity)），目标不清零就变成 avg ← sum/n + avg·(1-1/n) 的反馈积分，
      //   稳态正好是平均值的 n 倍——子帧一多整帧就过曝（这个 bug 让所有开了运动模糊的
      //   渲染都比单帧亮 n 倍，出片直接白掉）。
      this.gl.clear(this.avgRT, [0, 0, 0], 0);
      this.comp.copyOver(this.gl, this.sumRT, this.avgRT, 1 / n);
      outTex = this.avgRT;
      this.lastSamples = n;
    }

    // HUD / 信息层：在场景之后、后处理之前叠上去（这样 HUD 的高光也能参与泛光）
    this._hudOut = null;
    if (this.hud && !preview) this._drawHud(t, idx, outTex);

    // 后处理 -> outRT（线性）。屏幕那条路在下一行 blitPass 里编码成 sRGB；
    // 导出那条路在 readPixels(outRT,'srgb') 里编码。两条路必须都编码，否则预览与成片不一致。
    this.lastBeat = this.music.beatAt ? this.music.beatAt(t) : 0;
    if (this.dumpStages) this._dumpStages(outTex, post);
    this.post.render(gl, this._hudOut ?? outTex, this.outRT, post, frameSeed(idx));
    this.lastPost = post;
    if (opts.toScreen !== false) {
      gl.blitPass.u.src.value = { tex: this.outRT.tex, __tex: true };
      gl.blitPass.render(gl, null, t, 1 / this.fps);
    }
    this.lastT = t;
    return { samples: n, errors: this.lastErrors };
  }

  /**
   * 场景级变换用的全屏 Pass：把整帧按 3×3 矩阵重采样（trans.js 的 xformMatrix 算好）。
   * 越界处采样会夹到边缘，所以背景色会被"拉丝"。想避免就把变换控制在画面内，
   * 或者让场景多画一圈余量（推荐：余量按 scale/位移量算）。
   */
  _xformPass() {
    if (!this._xform) {
      this._xform = new Pass(this.gl, /* glsl */ `
        uniform sampler2D src;
        uniform mat3 m;
        uniform float edge;   // 0 = 画面外夹到边缘（默认）；1 = 画面外采样为黑
        void main() {
          vec3 q = m * vec3(vUv, 1.0);
          vec2 uv = q.xy;
          if (edge > 0.5) {
            // 视差用：背景不动、只有前景在动时，空旷处要给黑/透明，不能把背景色拉成条纹
            if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
              fragColor = vec4(0.0, 0.0, 0.0, 1.0);
              return;
            }
          }
          fragColor = vec4(texture(src, clamp(uv, vec2(0.0), vec2(1.0))).rgb, 1.0);
        }`, { src: { value: null }, m: [1, 0, 0, 0, 1, 0, 0, 0, 1], edge: 0 }, { key: 'engine_xform', blend: false });
    }
    return this._xform;
  }

  /**
   * 子帧累加用的 Pass：把自己加进目标（加性混合），并把非有限像素丢掉——
   * 几百个子帧里只要有一个 NaN，均值就会被污染成一片亮斑。
   */
  _accumPass() {
    if (!this._accum) {
      this._accum = new Pass(this.gl, /* glsl */ `
        uniform sampler2D src;
        void main() {
          vec3 c = texture(src, vUv).rgb;
          bool bad = any(isnan(c)) || any(greaterThan(abs(c), vec3(5e4)));
          fragColor = vec4(bad ? vec3(0.0) : c, 0.0);
        }`, { src: { value: null } }, { key: 'engine_accum', blend: false });
      // 纯加法：src*1 + dst*1（alpha 不动）
      const m = this._accum.prog;
      this._accum.blend = true;
      this._accum.blendFn = 'add';
    }
    return this._accum;
  }

  /**
   * 采样误差：把「前一组子帧的均值」和「后一组子帧的均值」投到显示空间比较。
   * 移动边缘的阶梯状采样在两组之间差别大；已经收敛成连续拖影的差别小。
   * 返回 0..1（显示空间 0..255 除以 255）。
   */
  _sampleError() {
    const gl = this.gl;
    if (!this._errPass) {
      this._errPass = new Pass(gl, /* glsl */ `
        uniform sampler2D a; uniform sampler2D b;
        uniform float wA; uniform float wB;
        void main() {
          vec3 A = texture(a, vUv).rgb * wA;
          vec3 B = texture(b, vUv).rgb * wB;
          A = pow(max(A, vec3(0.0)), vec3(1.0 / 2.2));
          B = pow(max(B, vec3(0.0)), vec3(1.0 / 2.2));
          float e = max(abs(A.r - B.r), max(abs(A.g - B.g), abs(A.b - B.b)));
          fragColor = vec4(vec3(e * 255.0), 1.0);
        }`, { a: { value: null }, b: { value: null }, wA: 1, wB: 1 }, { key: 'engine_err', blend: false });
    }
    this._errPass.u.a.value = { tex: this.sumRT.tex, __tex: true };
    this._errPass.u.b.value = { tex: this.newRT.tex, __tex: true };
    // sumRT 里累的是 offsets[0..done)，newRT 里是这一级新加的 (done/3) 个
    this._errPass.u.wA.value = 1 / Math.max(1, this._groupA);
    this._errPass.u.wB.value = 1 / Math.max(1, this._groupB);
    this._errPass.render(gl, this.errRT, 0, 1 / this.fps);
    const g = gl.ctx;
    this.errRT.bind();
    g.readPixels(0, 0, this.errRT.w, this.errRT.h, g.RGBA, g.UNSIGNED_BYTE, this.errBuf);
    let m = 0;
    for (let i = 0; i < this.errBuf.length; i += 4) if (this.errBuf[i] > m) m = this.errBuf[i];
    return m / 255;
  }

  /* ------------------------------------------------------------ HUD */

  /**
   * HUD 画在一张独立的 HDR 目标上（先拷贝场景成帧再叠字），
   * 这样不会污染池子里的场景目标（转场时还要用）。
   */
  _drawHud(t, idx, sceneTex) {
    const gl = this.gl;
    const layer = this.hud2d;
    const c = layer.ctx;
    const { W, H } = gl;
    c.save();
    c.setTransform(layer.scale, 0, 0, layer.scale, 0, 0);
    c.clearRect(0, 0, W, H);
    const pad = 30;
    const lines = [
      `${U.timecode(t, this.fps)}   frame ${idx}   t=${t.toFixed(2)}s`,
      `${this._activeId(t)}   beat ${(this.lastBeat ?? 0).toFixed(2)}   bar ${((this.lastBeat ?? 0) / 4).toFixed(2)}`,
      `samples ${this.lastSamples}${this.lastErrors.length ? '   err ' + this.lastErrors.map((e) => (e * 255).toFixed(1)).join(' / ') : ''}`,
    ];
    c.font = '400 17px "IBM Plex Mono", Consolas, monospace';
    c.fillStyle = 'rgba(238,233,223,0.42)';
    lines.forEach((s, i) => c.fillText(s, pad, H - pad - (lines.length - 1 - i) * 22));
    if (this.hudInfo.title) {
      c.font = '600 17px "IBM Plex Mono", Consolas, monospace';
      c.fillStyle = 'rgba(255,77,18,0.85)';
      c.fillText(this.hudInfo.title, pad, pad + 2);
    }
    // 交互提示只给预览看，不进成片
    if (this.hudInfo.hint) {
      c.font = '400 15px "IBM Plex Mono", Consolas, monospace';
      c.fillStyle = 'rgba(238,233,223,0.3)';
      c.fillText(this.hudInfo.hint, pad, H - pad - lines.length * 22 - 8);
    }
    c.restore();

    layer.upload();
    this.hudRT = this.hudRT ?? new RT(gl, gl.pw, gl.ph);
    this.comp.copyOver(gl, sceneTex, this.hudRT, 1);
    this.comp.draw(gl, layer, this.hudRT, { premult: false });
    this._hudOut = this.hudRT;
    return this.hudRT;
  }

  _activeId(t) {
    const it = this.timeline.find((i) => t >= i.start && t < i.end);
    return it ? `${it.id} +${(t - it.start).toFixed(2)}s` : '—';
  }

  /* ------------------------------------------------------------ 调试 */

  /** 把某张目标转成 PNG dataURL（人肉排查用）。 */
  dumpRT(rt, label = '') {
    const gl = this.gl;
    const buf = gl.readPixels(rt);
    const cv = document.createElement('canvas');
    cv.width = rt.w; cv.height = rt.h;
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const img = c.createImageData(rt.w, rt.h);
    const row = rt.w * 4;
    for (let y = 0; y < rt.h; y++) {
      const src = (rt.h - 1 - y) * row;
      img.data.set(buf.subarray(src, src + row), y * row);
    }
    c.putImageData(img, 0, 0);
    return { label, png: cv.toDataURL('image/png') };
  }

  /** 打开后，每次 render 都会记录各阶段的图像（很慢，只在排查时用）。 */
  _dumpStages(sceneTex, post) {
    const h = /** @type {any} */ (globalThis);
    h.__stages = h.__stages ?? [];
    if (h.__stages.length > 40) return;
    h.__stages.push({
      t: this.lastT,
      scene: this.dumpRT(sceneTex, 'scene').png,
      layer: this.text.canvas.toDataURL('image/png'),
      bloom: { bloom: post.bloom, threshold: post.bloomThreshold },
    });
  }

  /* ------------------------------------------------------------ 输出 */

  /**
   * 读回当前帧，**已做 linear→sRGB 编码**（RGBA8，自下而上）。
   *
   * 这是导出/存图/推流给 ffmpeg 的唯一正确入口：整条渲染链都在线性光里跑，
   * 画布那条路由 `gl.blitPass` 的 shader 编码，而 readPixels 读的是编码前的值。
   * 少了这一步，导出的 PNG / mp4 会比浏览器预览暗一大截、暗部糊死
   * （实拍：线性 0.5 若不编码导出成 128，正确是 188）。见 docs/ENGINE.md §2.3。
   *
   * ⚠ 返回的是**复用缓冲**：下一次读回会覆盖它。要留存请 `new Uint8Array(buf)`
   * 或传 `{ copy: true }`。为什么这么设计见 `gl.js` 的 `readPixels`（1080p 每帧
   * 省 ~190ms：分配 33MB Float32Array 是这条路径上最大的开销）。
   * @param {{ copy?: boolean }} [opts]
   */
  readPixels(opts) { return this.gl.readPixels(this.outRT, 'srgb', opts); }

  /** 读回**线性**原始值（0..255 表示线性 0..1）。只给排查用，不要拿它存图。 */
  readLinearPixels(opts) { return this.gl.readPixels(this.outRT, 'none', opts); }

  /**
   * 读回当前帧，编码成 **NV12**（BT.709 limited range，4:2:0）—— 出片推流走这条。
   *
   * 与 `readPixels()` 的关系：数学上等价，都是"线性光 → sRGB → 交付格式"，区别只在于
   * 交付格式是 RGBA（8.3MB/帧）还是 YUV420（3.11MB/帧），后者省掉 62% 的传输量。
   * 成片本来就是 yuv420p，所以这不是新增一次色度损失（详见 `gl.js` 的 `readNV12`）。
   *
   * ⚠ 同样返回**复用缓冲**（下一次调用会覆盖）。
   * @returns {Uint8Array} NV12，行序自下而上
   */
  readNV12() { return this.gl.readNV12(this.outRT); }

  /**
   * 扫一张**浮点**渲染目标里的非有限值（NaN / ±Inf）与"量级爆掉"的像素。
   *
   * 为什么需要它（`docs/STATUS.md` §13.4）：场景 shader 一旦写出 NaN 或 Inf，引擎里
   * **没有任何一步会报错**，而两种非有限值在显示上**完全一样**——都是"整屏白 + 暗角"
   * （实测 `nan` 与 `inf` 两张 PNG 逐字节相同）。更绕的是它还会随采样数变脸：
   * `samples: 1` 直通后处理 → 整屏白；多子帧走 `_accumPass()`，那一层会把非有限值
   * **丢掉**（`bad ? vec3(0.0) : c`）→ 同一段在成片里反而发黑。于是"单帧白、成片黑"
   * 会被 `check` 报成"运动模糊累加有问题"，指向完全错误的方向。
   *
   * 直接读浮点缓冲就没有这些歧义：NaN / Inf 分别数出来，还给出第一个坏像素的屏幕位置。
   * 代价是整屏 4 通道回读（1080p ≈ 8 MB），所以**只给诊断用**，不进每帧的渲染路径。
   *
   * @param {any} rt 浮点渲染目标（`composite()` 返回的 `tex`）
   * @param {{ huge?: number }} [opts] `huge` = 量级阈值（默认 5e4，与 `_accumPass` 一致）
   */
  scanNonFinite(rt, opts = {}) {
    const hugeAt = opts.huge ?? 5e4;
    const out = {
      w: 0, h: 0, pixels: 0, nan: 0, inf: 0, huge: 0, hugeMax: 0, bad: 0,
      first: /** @type {null|{x:number,y:number,r:number,g:number,b:number,kind:string}} */ (null),
    };
    if (!rt || rt.float === false) return out;   // 8bit 目标存不下 NaN，无需扫
    const g = this.gl.ctx;
    const n = rt.w * rt.h * 4;
    if (!this._scanBuf || this._scanBuf.length < n) this._scanBuf = new Float32Array(n);
    const buf = this._scanBuf;
    g.bindFramebuffer(g.FRAMEBUFFER, rt.fbo);
    g.readPixels(0, 0, rt.w, rt.h, g.RGBA, g.FLOAT, buf);
    out.w = rt.w; out.h = rt.h; out.pixels = rt.w * rt.h;
    for (let p = 0; p < out.pixels; p++) {
      const i = p * 4;
      let kind = '';
      for (let k = 0; k < 3; k++) {
        const v = buf[i + k];
        if (Number.isNaN(v)) { out.nan++; kind = kind || 'NaN'; }
        else if (!Number.isFinite(v)) { out.inf++; kind = kind || (v > 0 ? '+Inf' : '-Inf'); }
        else if (Math.abs(v) > hugeAt) { out.huge++; kind = kind || `量级 ${Math.abs(v).toExponential(1)}`; if (Math.abs(v) > out.hugeMax) out.hugeMax = Math.abs(v); }
      }
      if (kind) {
        out.bad++;
        if (!out.first) {
          out.first = {
            x: p % rt.w, y: rt.h - 1 - Math.floor(p / rt.w),
            r: buf[i], g: buf[i + 1], b: buf[i + 2], kind,
          };
        }
      }
    }
    return out;
  }

  /**
   * 在 t 时刻**渲染一个子帧**并扫它的非有限值（`check` 用它把"整屏白"变成一句点名的话）。
   * 刻意只渲一个子帧：多子帧路径会把非有限值丢掉（见 `scanNonFinite` 的注释）。
   * @param {number} t
   */
  probeNonFinite(t) {
    const idx = Math.floor(t * this.fps + 1e-6);
    const r = this.composite(t, idx, 1 / this.fps);
    const scan = this.scanNonFinite(r.tex);
    return { t, id: this._activeId(t), ...scan };
  }

  /** 释放资源。 */
  dispose() {
    this.lines?.dispose?.();
    this.hud2d.dispose();
    for (const it of this.timeline) {
      it._layer?.dispose();
      it._scene?.dispose?.();
    }
    this.post.dispose();
    for (const rt of this.pool) rt.dispose();
    this.mixRT.dispose(); this.avgRT.dispose(); this.sumRT.dispose();
    this.newRT.dispose(); this.errRT.dispose(); this.outRT.dispose();
    this.xformRT.dispose();
    this.hudRT?.dispose();
    this.comp.sink?.dispose();
    this.comp.alt?.dispose();
    this.gl.dispose();
  }
}

/* ------------------------------------------------------------------ 采样序列 */

/**
 * 逻辑空间里「点 → 点的正向变换」，列主序 9 元素。
 *
 * 三条入口，优先级从高到低：
 *
 *   ① **`xf.proj`（推荐做透视时用）**：直接给一个完整的 3×3 射影矩阵（列主序 9 元素）。
 *      这是唯一**不需要任何参数化技巧**的路子 —— 想要什么透视就写什么矩阵，
 *      不用去凑 `scale`/`rot`/`p`/`q` 那几个参数能不能表示出来。
 *      `src/core/cam.js` 的 `camXform()` 走的就是这条路。
 *   ② `xf.p`/`xf.q`：keystone 系数，按 `x' = A(x,y) / (1 + p·x + q·y)` 压过去，
 *      参照点是画面中心（`A` 是绕 anchor 旋转缩放 + 平移）。
 *   ③ 什么都不给：纯相似变换（原来那套，行为一字未改）。
 *
 * ⚠ 为什么要有 ①：②那种参数化**表达不了"带旋转的透视"**（分母的梯度方向和仿射里
 *   内容自身的朝向被绑在一起了），硬凑会在偏心/旋转/缩放的机位上整体错位。
 *   我在这里连续错过五次，每次都不崩溃、只是"画面偏了一点" —— 所以现在宁可多一条
 *   直给矩阵的路。一致性由 `tools/test-cam-math.mjs` 的
 *   「camXform 与 project(k) 逐像素一致」（8 组机位 × 5 个世界点）钉住。
 *
 * @param {number} W 逻辑宽
 * @param {number} H 逻辑高
 * @param {{x?:number,y?:number,scale?:number,rot?:number,anchor?:number[]|null,p?:number,q?:number,proj?:number[]}} xf
 * @returns {number[]} 列主序 9 元素
 */
export function xformForward(W, H, xf) {
  if (Array.isArray(xf.proj) && xf.proj.length === 9) {
    // 完整射影矩阵：只做一次归一化（让第 3 行第 3 列 = 1），其余原样
    const m = xf.proj.map(Number);
    const w = m[8];
    if (Number.isFinite(w) && Math.abs(w) > 1e-12) for (let i = 0; i < 9; i++) m[i] /= w;
    return m;
  }
  const anchor = Array.isArray(xf.anchor) ? xf.anchor : [W / 2, H / 2];
  const [ax, ay] = anchor;
  const c = Math.cos(xf.rot ?? 0), s = Math.sin(xf.rot ?? 0);
  const k = xf.scale ?? 1;
  const a = k * c, b = k * s, cc = -k * s, d = k * c;
  const tx = ax - (a * ax + cc * ay) + (xf.x ?? 0);
  const ty = ay - (b * ax + d * ay) + (xf.y ?? 0);
  const p = xf.p ?? 0, q = xf.q ?? 0;
  // 第 3 行（齐次分量）：分母 `1 + p·x + q·y`，但**以参照点为基准** —— 射影除法在参照点
  // （默认画面中心）处必须等于 1：`1 + p·pr.x + q·pr.y = 1` 要求常数项是
  // `1 − p·pr.x − q·pr.y`。漏掉那个 `1` 会让整层被一个固定比例缩掉（同样不报错）。
  return [
    a, b, 0,
    cc, d, 0,
    tx, ty, 1 - p * (W / 2) - q * (H / 2),
  ];
}
/**
 * 场景级变换 → uv 空间（0..1，y 向上）的采样矩阵，喂给 shader 的 `mat3 m`。
 *
 * shader 要回答的是「输出像素 (u,v) 应该采源图哪里」，也就是**正向变换的逆**。
 * 场景给的是**逻辑像素、y 向下**的直觉参数（x/y 位移、scale、rot 弧度、anchor 锚点），
 * 而 shader 里是 uv、y 向上 —— 先换基（F = 逻辑 → uv），再在 uv 空间求逆：
 *
 *   M_fwd_uv = F · M_logical_fwd · F⁻¹        M_uv = M_fwd_uv⁻¹
 *
 * ⚠ 换基之后正向变换里与 y 有关的项会变号（y 方向反了），所以这里**必须**求逆，
 *   不能直接把 M_logical_fwd 当成采样矩阵用 —— 那会得到反向的位移与缩放（踩过）。
 *
 * @param {import('./gl.js').GL} gl
 * @param {{x:number,y:number,scale:number,rot:number,anchor:number[]|null}} xf
 * @returns {number[]} 列主序 9 元素（直接喂 mat3 uniform）
 */
export function xformMatrix(gl, xf) {
  const W = gl.w, H = gl.h;
  const m = xformForward(W, H, xf);          // 逻辑空间正向
  // 换基到 uv：u = x/W, v = 1 - y/H
  const F = [
    [1 / W, 0, 0],
    [0, -1 / H, 1],
    [0, 0, 1],
  ];
  const Finv = [
    [W, 0, 0],
    [0, -H, H],
    [0, 0, 1],
  ];
  const m3 = [
    [m[0], m[3], m[6]],
    [m[1], m[4], m[7]],
    [m[2], m[5], m[8]],
  ];
  const fwd = mm3(mm3(F, m3), Finv);
  const inv = invert3(fwd);
  // 转回列主序
  return [inv[0][0], inv[1][0], inv[2][0], inv[0][1], inv[1][1], inv[2][1], inv[0][2], inv[1][2], inv[2][2]];
}

/** 3×3（行主序二维数组）相乘 */
function mm3(a, b) {
  const o = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  }
  return o;
}

/** 3×3 求逆（行主序）。奇异时退回单位阵（宁可不动，不要产出 NaN 整帧）。 */
function invert3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

function isIdentityXform(x) {
  return x.x === 0 && x.y === 0 && x.scale === 1 && (x.rot ?? 0) === 0 && (x.p ?? 0) === 0 && (x.q ?? 0) === 0;
}

/**
 * 解析一段的共享背景：
 *   `'auto'`        → 用 task.config 里 `export const world` 的那张（load 时已解析好、全片复用）
 *   传对象           → 这一段专用，直接用
 *   传工厂函数       → 这一段专用，现建一个
 *   `false` / 不写   → 引擎不碰底（场景自己负责 / 或者就是纯黑）
 */
function resolveWorld(engine, item) {
  const w = item.world;
  if (w === false || w == null) return null;
  if (w === 'auto') return engine.world ?? null;
  if (typeof w === 'function') return w(engine._ctxFor(item, 0, 0, {}));
  return w;
}

/** 变换参数写错时点名报错，而不是让画面静默变成黑/拉伸。 */
function assertXform(x, id, t, errors) {
  const bad = [];
  if (!Number.isFinite(x.x) || !Number.isFinite(x.y)) bad.push('x/y');
  if (!Number.isFinite(x.scale) || x.scale <= 0) bad.push('scale 必须是 > 0 的有限数');
  if (x.rot != null && !Number.isFinite(x.rot)) bad.push('rot');
  if (x.p != null && !Number.isFinite(x.p)) bad.push('p（透视系数）');
  if (x.q != null && !Number.isFinite(x.q)) bad.push('q（透视系数）');
  if (x.anchor && (x.anchor.length < 2 || !Number.isFinite(x.anchor[0]) || !Number.isFinite(x.anchor[1]))) bad.push('anchor 必须是 [x, y]');
  if (!bad.length) return;
  const msg = `[${id}] setXform 参数不合法：${bad.join('、')}（t=${t.toFixed(2)}）`;
  if (!errors.includes(msg)) errors.push(msg);
}

/** 固定 N 个等距子帧（居中）。 */
function fixedOffsets(n) {
  const u = new Array(n);
  for (let i = 0; i < n; i++) u[i] = (i + 0.5) / n - 0.5;
  return u;
}

/**
 * 自适应采样的嵌套序列：
 *   先 8 个等距；之后每一级把每个间隔三等分，在两侧各插一个新样本。
 * 于是每一级都是「等距且以帧时刻为中心」的，任一级的样本数都是 8·3^L。
 */
function ternaryOffsets(levels) {
  let u = fixedOffsets(BASE_SAMPLES);
  for (let L = 0; L < levels; L++) {
    /** @type {number[]} */
    const next = [];
    const n = u.length;
    for (let i = 0; i < n; i++) {
      const a = u[i];
      const b = i + 1 < n ? u[i + 1] : u[i] + (u[i] - u[i - 1]);
      const d = b - a;
      next.push(a + d / 3, a + (2 * d) / 3);
    }
    // 排序后得到等距序列（下一级的 a/b 依赖有序性）
    u = u.concat(next).sort((x, y) => x - y);
  }
  return u;
}

function fmtErr(e) {
  const s = e && e.stack ? e.stack : String(e);
  return s.split('\n').slice(0, 3).join(' | ');
}
