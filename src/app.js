// @ts-check
/**
 * 浏览器入口。两件事：
 *   1) 人看的预览（实时播放、拖时间轴、音频）
 *   2) 机器用的离屏协议 window.__anim（CLI 靠它逐帧取图 / 推流给 ffmpeg）
 *
 * 预览和成片跑的是同一套渲染代码，唯一区别是预览只出 1 个子帧（快），
 * 离屏出很多子帧求平均（真运动模糊）。所以「预览里看着对」=「成片里一定对」。
 *
 * URL 参数：?task=demo&t=1.5&scale=2&fps=60&only=a,b
 */

import { Engine } from './core/engine.js';
import { makePalette } from './core/palette.js';
import { MusicData } from './core/audio.js';
import { loadTaskList, loadTask } from './tasks.js';
import { DEFAULT_POST } from './core/post.js';

const q = new URLSearchParams(location.search);
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const status = {
  state: 'booting',
  task: '',
  error: null,
  message: '启动中…',
};

function setHud(lines, cls = '') {
  const el = $('hud');
  el.innerHTML = lines;
  el.className = cls;
}
function setMsg(s) { $('msg').textContent = s ?? ''; }

/**
 * 把任务自带的字体加载进来（task.fonts）。
 *
 * 为什么需要它：以前想用一款官网同款字体，只能把 woff2 丢进 `public/fonts/` 并改**全局**的
 * `public/fonts/fonts.css` —— 两个任务想用不同字体就会打架，而且是全局可变状态。
 *
 *   fonts: './fonts/brand.css'                  // 自己写 @font-face 的样式表
 *   fonts: ['./fonts/Brand-600.woff2']          // 字体文件，自动包成 @font-face
 *   fonts: [{ file: './fonts/Brand-600.woff2', family: 'Brand', weight: '600' }]
 *
 * **必须在第一帧之前 await 完成**：离屏截帧时字体还没就绪会拍到一片方框（font-display 也救不了
 * 已经画进 Canvas2D 的那一帧）。
 *
 * @param {any} spec 任务配置
 * @param {(p: string) => string} url 相对任务目录 -> 可 fetch 的 URL
 */
async function loadTaskFonts(spec, url) {
  const list = spec?.fonts ? (Array.isArray(spec.fonts) ? spec.fonts : [spec.fonts]) : [];
  const families = [];
  const links = [];
  for (const entry of list) {
    const e = typeof entry === 'string' ? { file: entry } : (entry ?? {});
    if (!e.file) continue;
    const href = url(e.file);
    if (/\.css(\?|$)/i.test(e.file)) { links.push(href); continue; }
    const family = e.family ?? `task-font-${families.length + 1}`;
    families.push({ family, weight: e.weight ?? '100 900', style: e.style ?? 'normal', href });
  }

  // 字体文件：自己拼 @font-face，插到 head 末尾（比任务目录里的 css 优先级高，方便覆盖）
  if (families.length) {
    const style = document.createElement('style');
    style.dataset.animTaskFonts = '1';
    style.textContent = families.map((f) => `@font-face {
  font-family: '${f.family}';
  src: url('${f.href}');
  font-weight: ${f.weight};
  font-style: ${f.style};
  font-display: block;
}`).join('\n');
    document.head.appendChild(style);
  }
  for (const href of links) {
    await new Promise((res) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.onload = () => res(null);
      l.onerror = () => { console.warn(`[fonts] 样式表加载失败：${href}`); res(null); };
      document.head.appendChild(l);
    });
  }
  if (!list.length) return [];

  const anyDoc = /** @type {any} */ (document);
  try {
    if (anyDoc.fonts?.ready) await anyDoc.fonts.ready;
    // 显式请求几个字形，逼浏览器真的把文件下下来（否则首帧会拍到回退字体）
    if (anyDoc.fonts?.load) {
      await Promise.all(families.flatMap((f) => [
        anyDoc.fonts.load(`${f.weight.split(' ')[0]} 64px "${f.family}"`, 'Aa动画'),
      ])).catch(() => {});
    }
  } catch { /* 字体加载失败不致命，回退系统字体 */ }
  if (families.length) {
    console.log(`· 任务字体已加载：${families.map((f) => f.family).join(', ')}`);
  }
  return families.map((f) => f.family);
}

/** 把错误显示在页面上（离屏时也会回传给 CLI，不然就是黑屏无解） */
function fail(err) {
  const msg = err && err.stack ? err.stack : String(err);
  status.state = 'error';
  status.error = msg;
  setHud(`<span class="err">渲染失败</span>\n\n${escapeHtml(msg.split('\n').slice(0, 12).join('\n'))}`, 'err');
  console.error(err);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}

/* ------------------------------------------------------------------ 启动 */

let engine = /** @type {Engine | null} */ (null);
let audio = /** @type {HTMLAudioElement | null} */ (null);
let clock = 0;
let playing = false;
let frameCount = 0;
let lastName = '';
/** 推流状态：CLI 卡住时靠它定位（readyState 0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED） */
const streamState = { started: 0, url: '', readyState: -1, sent: 0, total: 0, lastError: '' };

async function boot() {
  const list = await loadTaskList();
  const taskName = q.get('task') ?? list[0];
  if (!taskName) throw new Error(`没有找到任何任务。先跑： node scripts/anim.mjs new 我的第一个动画\n可用任务：${list.join(', ') || '(空)'}`);
  status.task = taskName;
  setMsg(`任务 ${taskName}`);

  // 先把音乐（可选）拿到：时间线里可能用拍号而不是秒来写
  setHud('读取任务…');
  const preTask = await loadTask(taskName);
  /**
   * 任务里的路径（audio / lyrics / analysis）都是**相对任务目录**的：
   * './audio/x.mp3' 指的是 tasks/<任务>/audio/x.mp3。
   * 注意不能拿 location.href 当基准——页面 URL 是 '/?task=x'，没有结尾斜杠，
   * 相对路径会解析到站点根目录去（踩过：音频 404，然后落到解码失败）。
   */
  const taskBase = new URL(`tasks/${taskName}/`, location.href);
  const taskUrl = (p) => new URL(p.replace(/^\.\//, ''), taskBase).href;

  let music = null;
  if (preTask.audio) {
    const audioUrl = taskUrl(preTask.audio);
    // 预计算好的特征：CLI 会放在音频旁边，叫 <文件名>.analysis.json
    const guess = audioUrl.replace(/\.[^./]+$/, '') + '.analysis.json';
    music = await MusicData.load(audioUrl, {
      analysisUrl: preTask.analysis ? taskUrl(preTask.analysis) : guess,
      onProgress: (m) => setHud(escapeHtml(m)),
    });
  }

  const task = await loadTask(taskName, { music });
  /**
   * 旁白表可以从**文件**来（`narration: './narration.json'`）。
   * 与 `lyrics` 同一个套路：JSON 是外部脚本（TTS 量长那一步）产出的，任务目录里相对路径引用。
   * 加载失败只警告、不致命 —— 没有旁白表时 `ctx.narration` 是个安全的空实现。
   */
  if (typeof preTask.narration === 'string') {
    const url = taskUrl(preTask.narration);
    try {
      const j = await (await fetch(url)).json();
      const { makeNarration } = await import('./core/narration.js');
      task.narrationData = makeNarration(j, { duration: task.duration });
      for (const w of task.narrationData?.warnings ?? []) console.warn(`[旁白] ${w}`);
    } catch (err) {
      console.warn(`[旁白] 读不到 ${preTask.narration}（${err && err.message}）—— ctx.narration 会是空的`);
      task.narrationData = null;
    }
  }
  const scale = clampInt(Number(q.get('scale') ?? task.scale ?? 1), 1, 4);
  const width = Number(q.get('w') ?? task.width ?? 1920);
  const height = Number(q.get('h') ?? task.height ?? 1080);
  const fps = Number(q.get('fps') ?? task.fps ?? 60);
  const offline = q.get('offline') === '1';

  // `--style paper`（CLI 会把它放进 URL 的 ?style=）—— 临时换风格出图对比，不改任务文件。
  // 这也是"每片换一套"这条纪律最容易执行的方式：先出几张对比图，再写进 task.config.mjs。
  const styleOverride = q.get('style');
  if (styleOverride) {
    const { resolveStyle } = await import('./style/index.js');
    try {
      task.styleResolved = resolveStyle({ style: styleOverride });
      console.info(`[style] 临时覆盖为 "${styleOverride}"（${task.styleResolved.label}）`);
    } catch (err) {
      console.warn(`[style] --style 覆盖失败：${err && err.message ? err.message : err}`);
    }
  }

  const canvas = /** @type {HTMLCanvasElement} */ ($('c'));
  engine = new Engine(canvas, {
    width, height, scale, fps,
    // 调色板 = 风格包的 palette + 任务自己的 palette（任务优先）。
    // ⚠ 必须在 new Engine 之前合成：Post 构造时就把调色板常量注进 shader 源码了，
    //   之后再换 P 只会让场景变、后处理链还是旧配色（Engine 构造函数里也写了这条）。
    palette: makePalette({ ...(task.styleResolved?.palette ?? {}), ...(task.palette ?? {}) }),
  });

  setHud('编译着色器…');

  // 任务自带字体：必须赶在第一帧之前（离屏截帧会拍到方框）
  await loadTaskFonts(preTask, taskUrl);

  // 歌词（可选）
  let lyrics = null;
  if (task.lyrics) {
    try { lyrics = await (await fetch(taskUrl(task.lyrics))).json(); } catch { lyrics = null; }
  }

  await engine.load({
    timeline: task.timeline,
    music,
    lyrics,
    // 口播/旁白表（可选，docs/NARRATION.md A 档）：场景里读 ctx.narration / f.narration
    narration: task.narrationData ?? null,
    title: task.title ?? taskName,
    duration: task.duration,
    only: q.get('only'),        // '--only a,b'：只加载这几段（快，且隔离写坏的场景）
    // 全片共享背景（可选）：时间线里声明 { world: 'auto' } 的段由引擎先铺它。
    // 这样"忘了画背景"不再是静默黑底 —— 见 docs/IMPROVEMENTS.md P0-2。
    worldPass: task.world ?? null,
    // 风格包（docs/STYLE.md）：色板已在上面合成，这里传进来的是 grid / post / captions / fonts / motif
    styleResolved: task.styleResolved ?? null,
    // 引擎级字幕层（docs/CAPTIONS.md）：`captions: true` 才开；默认关 = 老任务零变化
    captions: task.captions ?? null,
  });

  // 每段的图层各有一份 TextKit，字体是全局的：等一次就够，但每层都要刷一遍缓存
  await engine.hud2d.type.load().catch(() => {});
  for (const it of engine.timeline) it._layer?.type?.clearCache?.();

  engine.hud = !offline && q.get('hud') !== '0';
  engine.hudInfo.hint = '空格 播放/暂停 · ←→ ±1s · , . 逐帧 · [ ] 上下段 · h 隐藏信息';

  // 音频播放器
  if (task.audio && !offline) {
    audio = new Audio(new URL(task.audio, location.href).href);
    audio.preload = 'auto';
    audio.volume = 1;
  }

  const t0 = Number(q.get('t') ?? 0);
  clock = Number.isFinite(t0) ? t0 : 0;
  engine.render(clock, { preview: true, toScreen: true, samples: 1 });

  status.state = 'ready';
  const v = engine.validate();
  const errs = [...engine.errors.map((e) => `[场景] ${e}`), ...v.problems.map((p) => `[时间线] ${p}`)];
  refreshHud(errs, v.gaps);

  if (!offline) requestAnimationFrame(loop);
  return { task, engine, fps, offline };
}

function clampInt(x, a, b) { return Math.max(a, Math.min(b, Math.round(Number.isFinite(x) ? x : a))); }

function refreshHud(errs = [], gaps = []) {
  if (!engine) return;
  const e = errs.length ? `\n<span class="err">${escapeHtml(errs.slice(0, 6).join('\n'))}</span>` : '\n<span class="ok">✓ 无错误</span>';
  const g = gaps.length ? `\n<span class="err">空档: ${escapeHtml(gaps.join('; '))}</span>` : '';
  const items = engine.timeline
    .map((i) => `  ${i.id.padEnd(12)} ${i.start.toFixed(2)} → ${i.end.toFixed(2)}s  ${(i.end - i.start).toFixed(2)}s${i.note ? '  ' + i.note : ''}`)
    .join('\n');
  setHud(
    `<b>${escapeHtml(status.task)}</b>  ${engine.gl.w}×${engine.gl.h} @${engine.fps} ×${engine.gl.scale}\n` +
    `时长 ${engine.duration.toFixed(2)}s · 段 ${engine.timeline.length} · bpm ${engine.music.bpm?.toFixed?.(1) ?? '—'}${e}${g}\n${escapeHtml(items)}`
  );
}

/* ------------------------------------------------------------------ 预览循环 */

let lastWall = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!engine) return;
  const wall = now / 1000;
  const dt = lastWall ? Math.min(0.25, wall - lastWall) : 1 / engine.fps;
  lastWall = wall;

  if (playing) {
    clock += dt;
    if (clock > engine.duration) { clock = engine.duration; setPlaying(false); }
    // 跟音频对齐（允许 ±60ms 漂移，超了就硬拉）
    if (audio) {
      const d = audio.currentTime - clock;
      if (Math.abs(d) > 0.06) audio.currentTime = Math.max(0, clock);
    }
  }
  try {
    engine.render(clock, { preview: true, toScreen: true, samples: 1 });
    const name = engine._activeId(clock);
    if (name !== lastName) { lastName = name; refreshHud(engine.errors, engine.validate().gaps); }
  } catch (err) {
    fail(err);
    setPlaying(false);
  }
}

function setPlaying(v) {
  playing = v;
  if (audio) {
    if (v) audio.play().catch(() => {});
    else audio.pause();
  }
  setMsg(v ? '播放中（实时预览 = 1 子帧，成片会更细腻）' : '已暂停');
}

function seek(t) {
  if (!engine) return;
  clock = Math.max(0, Math.min(engine.duration, t));
  if (audio) audio.currentTime = Math.max(0, clock);
  engine.render(clock, { preview: true, toScreen: true, samples: 1 });
}

/** 跳到上/下一段边界 */
function stepScene(dir) {
  if (!engine) return;
  const bounds = engine.timeline.map((i) => i.start);
  if (dir < 0) {
    const prev = bounds.filter((b) => b < clock - 0.05).pop();
    seek(prev ?? 0);
  } else {
    const next = bounds.find((b) => b > clock + 0.05);
    seek(next ?? engine.duration);
  }
}

addEventListener('keydown', (e) => {
  if (!engine) return;
  const step = e.shiftKey ? 5 : 1;
  switch (e.key) {
    case ' ': e.preventDefault(); setPlaying(!playing); break;
    case 'ArrowLeft': seek(clock - step); break;
    case 'ArrowRight': seek(clock + step); break;
    case ',': seek(clock - 1 / engine.fps); break;
    case '.': seek(clock + 1 / engine.fps); break;
    case '[': stepScene(-1); break;
    case ']': stepScene(1); break;
    case 'Home': seek(0); break;
    case 'End': seek(engine.duration); break;
    case 'h': case 'H':
      engine.hud = !engine.hud;
      $('hud').style.display = engine.hud ? '' : 'none';
      break;
    default: break;
  }
});

/* ------------------------------------------------------------------ 离屏协议 */

/**
 * 像素数组的确定性指纹：两个 32 位 FNV-1a（不同种子与质数）拼成 64 位十六进制。
 *
 * 为什么不用 crypto.subtle：它是异步的、而且要求安全上下文；更实际的问题是
 * 我们只需要「改了没有」，两个独立哈希同时撞车的概率可以忽略（同一位被两种不同
 * 混合方式抹平才可能漏，实际不会发生）。0.1ms 级别，1080p 也不算负担。
 */
function hashPixels(buf) {
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  const PRIME1 = 16777619, PRIME2 = 2246822519;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    h1 = Math.imul(h1 ^ b, PRIME1) >>> 0;
    h2 = Math.imul(h2 ^ (b + i), PRIME2) >>> 0;
  }
  // 长度也进哈希：内容相同但尺寸不同必须区分开
  const len = buf.length >>> 0;
  h1 = Math.imul(h1 ^ len, PRIME1) >>> 0;
  h2 = Math.imul(h2 ^ (len * 2654435761), PRIME2) >>> 0;
  return { hash: h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'), bytes: buf.length };
}

/**
 * 逐通道比两张 RGBA（显示空间 0..255），返回 max / mean / 超阈值像素占比。
 * `diffTo` 与 `diffToB64` 共用（两处判据必须完全一致，否则 `hashes` 的结论会飘）。
 */
function comparePixels(a, b) {
  if (a.length !== b.length) throw new Error(`像素长度不一致：${a.length} vs ${b.length}`);
  let max = 0, sum = 0, over8 = 0, over16 = 0, over32 = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    sum += d;
    if (d > 8) over8++;
    if (d > 16) over16++;
    if (d > 32) over32++;
  }
  return {
    max, mean: sum / a.length,
    over8: over8 / a.length, over16: over16 / a.length, over32: over32 / a.length,
    bytes: a.length,
  };
}

/** base64 → Uint8Array（`atob` 出来的是 latin1 字符串，逐字节取 code）。 */
function b64Bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * CLI 通过 window.__anim 驱动：
 *   info()                     元信息
 *   still(t, {samples})        渲染并返回 PNG dataURL
 *   frame(t, opts)             渲染并返回 RGBA（自下而上）
 *   png()                      把当前帧转 PNG
 *   stream({from,to,fps,ws,…}) 逐帧渲染 -> WebSocket 推给 ffmpeg（带背压）
 *                              `scanNf` = 每几帧顺带扫一次这一帧的浮点 RT 有没有 NaN/±Inf
 *   readAt(t)                  在 t 处取像素统计（做自动检测用）
 */
const api = {
  info() {
    return {
      task: status.task,
      width: engine?.gl.w ?? 0,
      height: engine?.gl.h ?? 0,
      scale: engine?.gl.scale ?? 1,
      pw: engine?.gl.pw ?? 0,
      ph: engine?.gl.ph ?? 0,
      fps: engine?.fps ?? 60,
      duration: engine?.duration ?? 0,
      onlyDuration: engine?.onlyDuration ?? 0,
      only: engine?.only ?? null,
      bpm: engine?.music?.bpm ?? 0,
      timeline: (engine?.timeline ?? []).map((i) => ({ id: i.id, start: i.start, end: i.end, note: i.note ?? '' })),
      errors: engine?.errors ?? [],
      /** 场景 render 抛的异常（结构化；P0-3 的机器判据用它） */
      renderErrors: engine?.renderErrors ?? [],
      timelineProblems: engine?.validate().problems ?? [],
      gaps: engine?.validate().gaps ?? [],
      renderer: engine?.gl.renderer ?? '',
      /** 完整的 GPU 信息（含 unmasked 串）—— `check` 与 `gpu` 读同一份，见 gl.js 的注释 */
      gpu: engine?.gl.rendererInfo ?? null,
      rendererLabel: engine?.gl.rendererLabel ?? '',
      /** 风格包（docs/STYLE.md）：`check` 会打印当前用的是哪一套 */
      style: engine?.style
        ? { name: engine.style.name, label: engine.style.label, motif: engine.style.motif, fonts: Object.keys(engine.style.fonts ?? {}).length }
        : null,
      /**
       * 字幕层状态（docs/CAPTIONS.md）：`check` 用它提示"有旁白却没开字幕"，
       * 以及字幕带落在哪 —— 观众反馈里"两条字幕"那件事就发生在这一层没被开起来的时候。
       */
      captions: engine?.captions
        ? { on: true, band: engine.captions.band, hold: engine.captions.style.hold, karaoke: !!engine.captions.style.karaoke }
        : { on: false },
      narrationLines: engine?.narration?.lines?.length ?? 0,
      /**
       * 旁白句子明细：`check` 用它查"字幕会不会跨越场景切换"
       * （Netflix timed-text 规范：字幕不得跨 scene change，见 `docs/CAPTIONS.md`）。
       */
      narration: (engine?.narration?.lines ?? []).map((l) => ({
        id: l.id, text: l.text, start: l.start, end: l.end,
      })),
      /** 风格/版面的运行期警告（kit 的 assertInBand / captionNote 过长等会 push 到这里） */
      warnings: engine?.warnings ?? [],
    };
  },

  /** 渲染一帧（默认 1 子帧，预览用）。 */
  async frame(t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    const r = engine.render(t, {
      samples: opts.samples ?? 1,
      shutter: opts.shutter ?? 0.5,
      tol: opts.tol,
      toScreen: true,
      preview: opts.preview ?? false,
      seeked: true,
    });
    return { samples: r.samples, errors: r.errors };
  },

  /**
   * 渲染并返回 PNG dataURL（给 CLI 存 stills / 给 agent 用 Read 看图）。
   * 同时带上这一帧实际用掉的子帧数与采样误差，方便判断运动模糊够不够。
   */
  async still(t, opts = {}) {
    const r = await api.frame(t, opts);
    return { png: api.png(), samples: r.samples, errors: r.errors };
  },

  /** 当前帧（或指定时刻）的 RGBA 像素，自下而上（WebGL 原生顺序），**显示空间（已 sRGB 编码）**。 */
  async pixels(t, opts = {}) {
    if (t !== undefined && t !== null) await api.frame(t, opts);
    const buf = engine.readPixels();
    return new Uint8Array(buf);
  },

  /**
   * 渲染 t 时刻并返回裸像素（base64 的 RGBA，自下而上、显示空间）。
   *
   * CLI 的 `verify` 用它和**成片抽出来的那一帧**逐像素比 —— 渲染是 t 的纯函数，
   * 所以同一条时间线上「成片第 N 帧」与「still 出来的那帧」必须一致。
   * 一次性能抓住三类问题：分段拼接错位 / 帧数不对 / 色彩空间不一致。
   * @param {number} t @param {{samples?: any, shutter?: number}} [opts]
   */
  async framePixels(t, opts = {}) {
    const buf = await api.pixels(t, opts ?? { samples: 1 });
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) {
      s += String.fromCharCode.apply(null, /** @type {any} */ (buf.subarray(i, i + CH)));
    }
    return { pixels: btoa(s), bytes: buf.length };
  },

  /**
   * 当前帧转成 PNG dataURL。
   *
   * `engine.readPixels()` 内部已经做了 linear→sRGB 编码（见 engine.js），
   * 所以这里的 PNG 与浏览器里看到的画面逐像素一致。
   */
  png() {
    if (!engine) throw new Error('引擎未就绪');
    const gl = engine.gl;
    const buf = engine.readPixels();
    const cv = document.createElement('canvas');
    cv.width = gl.pw; cv.height = gl.ph;
    const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const img = ctx.createImageData(gl.pw, gl.ph);
    // WebGL 自下而上 -> ImageData 自上而下
    const row = gl.pw * 4;
    for (let y = 0; y < gl.ph; y++) {
      const src = (gl.ph - 1 - y) * row;
      img.data.set(buf.subarray(src, src + row), y * row);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  },

  /**
   * 非有限值（NaN / ±Inf）扫描：**「整屏白」这一类事故的唯一可靠判据**。
   *
   * 为什么不能靠看图或靠 `stats()`：`readPixels()` 读的是 8bit，
   * `Math.round(NaN * 255)` → 0、`Inf` → 255，而**两者在后处理之后长得一模一样**
   * （实测 NaN 与 Inf 两帧 PNG 逐字节相同，都是"整屏白 + 暗角"）。
   * 多子帧那条路更绕：累加 pass 会把非有限值丢掉，于是同一段成片里反而发黑。
   * 这里直接读浮点缓冲，NaN / Inf 分开数，并给出第一个坏像素的位置。
   *
   * @param {number} t
   */
  nonFinite(t) {
    if (!engine) throw new Error('引擎未就绪');
    return engine.probeNonFinite(t);
  },

  /**
   * 渲染当前帧并返回画面统计（做「是不是全黑 / 是不是过曝」这类自动检查）。
   * 像素已在显示空间（sRGB 编码后），所以这里的阈值就是「肉眼看到的亮度」。
   */
  async stats(t, opts = {}) {
    if (t !== undefined && t !== null) await api.frame(t, opts);
    const buf = engine.readPixels();
    let sum = 0, max = 0, dark = 0, blown = 0, clipped = 0, n = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const l = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
      sum += l; if (l > max) max = l;
      if (l < 0.02) dark++;
      if (l > 0.99) blown++;
      if (buf[i] >= 253 && buf[i + 1] >= 253 && buf[i + 2] >= 253) clipped++;
      n++;
    }
    return {
      mean: sum / n, max, darkRatio: dark / n, pixels: n,
      /** 亮度 > 0.99 的像素占比：过曝的第一信号 */
      blownRatio: blown / n,
      /** RGB 三通道都顶到 253+ 的像素占比：真正的「死白」（信息已经丢了） */
      clippedRatio: clipped / n,
    };
  },

  /**
   * 逐帧渲染并推流。契约（CLI 和页面各守一半，改动前想清楚）：
   *   · 每帧发一个二进制消息：[12 字节帧头 = 子帧数 | shake.dx | shake.dy，三个 float32][**NV12** 像素]
   *     （NV12 = YUV420 半平面：Y 全分辨率 + 交错 UV 半分辨率 ⇒ 每帧 3.11MB 而不是 RGBA 的 8.3MB；
   *      GPU 侧已经转好，ffmpeg 用 `-pix_fmt nv12` 直接吃，见 `engine.readNV12()`）
   *   · 像素是**显示空间（已 sRGB 编码）**，与 ffmpeg 侧的 bt709 标记一致
   *   · 页面发完就等 ack 文本消息，收到才继续（背压，防止 4K 撑爆内存）
   *   · CLI 只做「收帧 / 写 ffmpeg / 回 ack」三件事，绝不在回 ack 前调 page.evaluate，
   *     否则会和这里的同步渲染循环互相等待而死锁
   *   · 文本消息（`'ack'` 之外）全是**诊断**，一律不参与帧计数：
   *     `{diag:'renderError'}`（场景抛异常，P0-3）与 `{diag:'nonFinite'}`（这一帧的浮点 RT 里有
   *     NaN/±Inf/量级爆掉，BACKLOG 1-4，由 `o.scanNf` 决定每几帧扫一次）
   */
  stream(o) {
    let ws;
    try {
      ws = new WebSocket(o.ws);
    } catch (err) {
      status.error = `WebSocket 无法创建 (${o.ws}): ${err && err.message}`;
      throw err;
    }
    ws.binaryType = 'arraybuffer';
    const total = Math.max(0, Math.round((o.to - o.from) * o.fps));
    let i = 0;
    let inflight = 0;
    streamState.started++;
    streamState.url = o.ws;
    streamState.total = total;
    streamState.sent = 0;
    streamState.readyState = ws.readyState;
    streamState.lastError = '';

    /**
     * 推流期间报「这段场景抛异常了」（P0-3）。
     *
     * 为什么要走 WS 而不是让 CLI 用 `page.evaluate` 去问：契约里写死了
     * 「CLI 绝不在回 ack 前调 page.evaluate」（会和这里的同步渲染循环互相等待而死锁），
     * 而这个循环一跑就是几十分钟。所以由页面**主动推**一条文本消息 ——
     * CLI 本来就在按 `isBinary` 过滤文本消息，加一条 'diag' 完全不影响帧计数。
     */
    let lastErrCount = 0;
    const reportRenderErrors = () => {
      const n = engine?.renderErrors?.length ?? 0;
      if (n <= lastErrCount) return;
      lastErrCount = n;
      const e = engine.renderErrors[engine.renderErrors.length - 1];
      try {
        ws.send(JSON.stringify({
          diag: 'renderError',
          id: e.id, t: e.t, idx: e.idx, message: e.message,
          total: n, atFrame: i,
        }));
      } catch { /* 连接断了就算了，CLI 收尾还会问一次 */ }
    };

    /**
     * 出片路径的「非有限值」扫描（`docs/BACKLOG.md` 1-4）。
     *
     * 为什么扫描点必须在**页面里**：CLI 收到的是 NV12（GPU 上已经转成 8bit 的 YUV），
     * 帧数据里**已经没有浮点信息** —— `Math.round(NaN * 255)` → 0、`Inf` → 255，
     * 两者在显示上一模一样（实测两张 PNG 逐字节相同）。所以只能扫这一帧的 float RT。
     *
     * `o.scanNf` = 每多少帧扫一次（0 / 未给 = 不扫）。扫描由 `engine.render` 顺带做
     * （`opts.scanNf`，见 `Engine._scanFrameNonFinite`）：**不额外渲一帧**，
     * 只多一次整屏浮点回读 + 一次 JS 扫描。频率与实测代价见 `scripts/anim.mjs` 的 `--scan-nf`。
     */
    const scanNf = Math.max(0, Math.floor(Number(o.scanNf) || 0));

    /** 把一次扫描结果推给 CLI（CLI 侧做聚合、限流与收尾汇总）。 */
    const reportNonFinite = (nf) => {
      if (!nf || !nf.bad) return;
      try {
        ws.send(JSON.stringify({
          diag: 'nonFinite',
          id: nf.id, ids: nf.ids, t: nf.t, subT: nf.subT, idx: nf.idx, sub: nf.sub,
          nan: nf.nan, inf: nf.inf, huge: nf.huge, hugeMax: nf.hugeMax,
          bad: nf.bad, pixels: nf.pixels,
          first: nf.first ? { x: nf.first.x, y: nf.first.y, kind: nf.first.kind } : null,
          atFrame: i,
        }));
      } catch { /* 连接断了就算了 */ }
    };

    const step = () => {
      if (i >= total) { ws.send(JSON.stringify({ done: i })); return; }
      const t = o.from + i / o.fps;
      // 每 scanNf 帧扫一次这一帧的浮点 RT（NaN / ±Inf）。第 0 帧必扫 —— 一开场就错的场景
      // 不该等到第 30 帧才报出来。扫描由 render 顺带做，不额外渲一帧。
      const doScan = scanNf > 0 && i % scanNf === 0;
      const r = engine.render(t, {
        samples: o.samples ?? 'auto',
        shutter: o.shutter ?? 0.5,
        tol: o.tol,
        toScreen: false,
        seeked: true,
        scanNf: doScan,
      });
      const px = engine.readNV12();
      // 帧头 12 字节 = 子帧数 + 这一帧的 post.shake（逻辑像素，y 向下），其后是 **NV12** 像素
      // （Y 平面 w×h + 交错 UV 平面 w/2×h/2 = 每帧 3.11MB，比 RGBA 少 62%）。
      // 载荷格式由 `scripts/anim.mjs` 的 ffmpeg 参数（`-pix_fmt nv12`）对接，两边必须一起改。
      // shake 搭车回去是**故意的**：CLI 收尾时能顺手统计「这一整片是不是逐帧白噪声」
      // 并当场提醒 —— 不用等成片出来、更不用拿成片做互相关（docs/IMPROVEMENTS-3.md 建议 F）。
      // ⚠ 改帧头长度要同时改 scripts/anim.mjs 里读它的地方（搜 `FRAME_HEADER`）。
      const sh = engine.lastPost?.shake;
      const out = new Uint8Array(12 + px.length);
      const dv = new DataView(out.buffer);
      dv.setFloat32(0, r.samples, true);
      dv.setFloat32(4, Array.isArray(sh) ? (Number(sh[0]) || 0) : 0, true);
      dv.setFloat32(8, Array.isArray(sh) ? (Number(sh[1]) || 0) : 0, true);
      out.set(px, 12);
      ws.send(out);
      i++;
      streamState.sent = i;
      streamState.readyState = ws.readyState;
      reportRenderErrors();
      // 非有限值只在这一帧扫过时才可能非空（`engine.lastNonFinite` 每帧开头会清零）
      if (doScan) reportNonFinite(engine.lastNonFinite);
      if (i % 30 === 0) setMsg(`渲染中 ${i}/${total} 帧 · ${r.samples} 子帧 · ${((100 * i) / total).toFixed(0)}%`);
      if (inflight < (o.inflight ?? 4)) { inflight++; step(); }
    };

    ws.onopen = () => { streamState.readyState = ws.readyState; status.message = '推流中…'; step(); };
    ws.onmessage = () => { inflight--; if (i < total) step(); };
    ws.onerror = (e) => {
      streamState.lastError = 'onerror';
      status.error = `WebSocket 连接失败：${o.ws}（端口不通？）`;
      console.error('stream ws error', e);
    };
    ws.onclose = (e) => {
      streamState.readyState = ws.readyState;
      streamState.lastError = `onclose code=${e.code} reason=${e.reason}`;
      if (i < total) console.error(`stream ws 提前关闭 code=${e.code} reason=${e.reason}`);
    };
    return { total, ws: o.ws };
  },

  /**
   * 渲染一帧并算一个**确定性指纹**（像素的 64 位哈希）。
   *
   * 用途：改引擎或重构场景之后，证明「画面逐像素没变」。这比人眼看图可靠得多，
   * 也是 `docs/ROADMAP.md` A 档那条验收（「模板化之后 still 与改造前逐像素一致」）的机械判据。
   *
   * ⚠ 只对 `samples: 1` 有意义：多子帧本身是确定的，但子帧数会随自适应误差浮动，
   *   指纹也就跟着浮动。要比指纹就固定 `--samples 1`。
   *
   * @param {number} t @param {{samples?: any, shutter?: number}} [opts]
   */
  async hash(t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    const r = await api.frame(t, opts);
    const buf = engine.readPixels();
    const out = { ...hashPixels(buf), samples: r.samples };
    if (opts.pixels) {
      // base64 原始 RGBA（自下而上、显示空间）：比 JSON 数字数组小 5 倍，
      // 且能直接喂回 diffTo 做「差了多少」的比对（CLI 侧再按帧做 delta 压缩）。
      let s = '';
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) {
        s += String.fromCharCode.apply(null, /** @type {any} */ (buf.subarray(i, i + CH)));
      }
      out.pixels = btoa(s);
    }
    return out;
  },

  /**
   * 与 `hash(t, {pixels:true})` 配对：传入上次的像素，返回**逐通道差的最大值与均值**。
   *
   * 为什么不用哈希判断"改没改"：GPU 在若干 tile 上会有最后一位（1/255）的噪声，
   * 例如「转场交叠到 95% 的那一帧」对上游微扰极敏感，跨进程重渲可能差 1 个 LSB。
   * 所以正确的比对方式是**看差了多少**，而不是看是否完全相等。
   * @param {number[]|Uint8Array} prev @param {number} t @param {{samples?:any, shutter?:number}} [opts]
   */
  async diffTo(prev, t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    await api.frame(t, opts);
    const b = engine.readPixels();
    const a = prev instanceof Uint8Array ? prev : Uint8Array.from(prev);
    return comparePixels(a, b);
  },

  /**
   * 与 `diffTo` 等价，但**参考帧用 base64 传**（`anim hashes --baseline` 走这条）。
   *
   * 为什么需要它：`diffTo` 的参数要经 `page.evaluate` 序列化，如果传的是普通数组，
   * CLI 就得把 8.3MB 展开成 **830 万个数字**（demo 基线 11 帧实测要几分钟）。
   * base64 只是一条字符串，解码 ~几十毫秒。
   * @param {string} b64 参考帧（RGBA，自下而上、显示空间；由 `Buffer.toString('base64')` 得来）
   * @param {number} t @param {{samples?:any, shutter?:number}} [opts]
   */
  async diffToB64(b64, t, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    await api.frame(t, opts);
    const b = engine.readPixels();
    const a = b64Bytes(b64);
    return comparePixels(a, b);
  },

  /**
   * 连续渲染同一个时刻 n 次，返回每次的哈希 —— 用来抓「首帧与后续帧不一致」这类
   * 只在第一次渲染时出现的问题（惰性编译、未初始化的缓冲）。
   * @param {number} t @param {number} [n]
   */
  async hashTimes(t, n = 4) {
    if (!engine) throw new Error('引擎未就绪');
    const out = [];
    for (let i = 0; i < n; i++) {
      await api.frame(t, { samples: 1 });
      out.push(hashPixels(engine.readPixels()).hash);
    }
    return out;
  },

  /**
   * 渲染两帧并做**逐像素差分**（显示空间 0..255）。返回通道差的 max / mean 与超阈值像素占比。
   *
   * `hash` 是严格的（差一个 bit 就不一样），实践中更常用的是它：
   * 判断「同一时刻两次渲染到底差多少」「成片抽帧和 still 差多少」。
   * @param {number} t1 @param {number} t2
   * @param {{ samples?: any, shutter?: number }} [opts]
   */
  async diff(t1, t2, opts = {}) {
    if (!engine) throw new Error('引擎未就绪');
    await api.frame(t1, opts);
    // ⚠ `readPixels()` 返回的是**复用缓冲**（1080p 下每帧省 ~190ms，见 gl.js 的说明），
    // 这里必须显式复制：下面还有一次 `await`，第二次读回会把 a 覆盖掉。
    const a = new Uint8Array(engine.readPixels());
    await api.frame(t2, opts);
    const b = engine.readPixels();
    let max = 0, sum = 0, over8 = 0, over32 = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) max = d;
      sum += d;
      if (d > 8) over8++;
      if (d > 32) over32++;
    }
    return { max, mean: sum / a.length, over8: over8 / a.length, over32: over32 / a.length, samples: a.length };
  },

  /**
   * 按给定顺序渲染一串时刻，返回每一帧的**粗指纹**与亮度统计。
   *
   * 粗指纹 = 每 16 个像素取一个（1080p 约 51 万个采样点）。用它比"完整哈希"更宽容：
   * 1 个 LSB 的噪声会被平均掉，但画面真的变了（元素错位、颜色整体偏）一定会露出来。
   * `--warm` 这类"渲染顺序会不会影响结果"的问题就靠它回答。
   * @param {number[]} times
   */
  async probe(times) {
    if (!engine) throw new Error('引擎未就绪');
    const out = [];
    for (const t of times) {
      await api.frame(t, { samples: 1 });
      const px = engine.readPixels();
      let h1 = 0x811c9dc5, sum = 0, max = 0, n = 0;
      for (let i = 0; i < px.length; i += 64) {   // 每 16 像素（64 字节）取一个
        h1 = Math.imul(h1 ^ px[i], 16777619) >>> 0;
        const l = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) / 255;
        sum += l; if (l > max) max = l; n++;
      }
      out.push({ t, hash: h1.toString(16).padStart(8, '0'), mean: sum / n, max, n });
    }
    return out;
  },

  status() { return { ...status }; },

  /**
   * **场景抛异常**的汇总（P0-3）。
   *
   * 为什么要单独一个入口：`engine.errors` 是"人看的字符串"，而且只在装载时读一次；
   * 回读一次（CLI 在渲染完之后调它）。去重 + 归并成"哪一段崩了、崩了多少帧、第一帧是哪个"，
   * 这样 CLI 可以一句话点名，而不是刷 7000 行一样的栈。
   *
   * @returns {{ count: number, bySegment: {id:string, frames:number, firstT:number, message:string}[], text: string[] }}
   */
  renderErrors() {
    const list = engine?.renderErrors ?? [];
    const by = new Map();
    for (const e of list) {
      const hit = by.get(e.id);
      if (hit) { hit.frames++; continue; }
      by.set(e.id, { id: e.id, frames: 1, firstT: e.t, message: e.message });
    }
    const bySegment = [...by.values()];
    return {
      count: list.length,
      bySegment,
      text: bySegment.map((b) => `[${b.id}] 场景 render 抛异常 ${b.frames} 帧（最早 t=${b.firstT.toFixed(3)}s）：${b.message.split('\n')[0]}`),
    };
  },

  /** 自上次调用以来新增的场景异常（推流时用：一帧都不该带着异常流出去）。 */
  takeRenderErrors() {
    const r = api.renderErrors();
    if (engine) engine.renderErrors.length = 0;
    return r;
  },

  /**
   * 背景守门（P0-2）：检查有没有「声明了 handlesTransition、但在交叠期整帧什么都没画」的段。
   *
   * 为什么需要它：漏调共享背景的那一段，底是一块**纯黑**（只有 grain 和暗角），而且
   * 不报任何错 —— 亮度统计也抓不到，因为文字/面板/grain 自己就有亮度（实测 0.054，
   * 而"全黑"判据是 0.004 的 13 倍）。做 fidus 时 9 段里 8 段这样，直到抽帧才看出来。
   *
   * 判据是**实际发生的绘制**（`gl.paint` 记账）：交叠期一帧里 `any === 0`
   * 就说明这一段根本没往画面里画东西（`gl.clear` 不算绘制）。
   * 明确写了 `{ world: false }` 的段跳过检查（那是"我自己负责整帧"的声明）。
   */
  worldAudit() {
    if (!engine) throw new Error('引擎未就绪');
    const items = engine.timeline;
    const results = [];
    for (let i = 1; i < items.length; i++) {
      const it = items[i], prev = items[i - 1];
      // 只查「与前一段有交叠」的段：只有那时才有转场语义（tin/tout/under 才有意义）。
      // ⚠ 拿 it.start 与 prev.end 比，不是比结束时刻：结束时刻被 overlap 推走过，
      //   用它判断会把整段漏掉（第一版就是这么漏判的）。
      if (it.start >= prev.end) continue;
      if (it.world === false) continue;
      const span = Math.min(prev.end, it.end) - it.start;
      const t = it.start + Math.max(0.02, span * 0.5);
      const w = it.world === 'auto' ? 'auto' : (it.world ? 'custom' : 'none');
      try {
        engine.render(t, { samples: 1, toScreen: false, seeked: true });
      } catch (err) {
        results.push({ id: it.id, t, error: String(err && err.message ? err.message : err) });
        continue;
      }
      const paint = it._lastPaint ?? null;
      // 判据：这一帧里**一次整帧覆盖的绘制都没有**，而且没有声明引擎铺的共享背景。
      //   · 整帧覆盖 = 全屏 Pass（blend:false）。文字/矢量层都是带混合的，不算。
      //   · `world: 'auto'` / 自定义 world 的段由引擎先铺底，天然满足。
      //   · 只有"声明了 handlesTransition / 转场"的段会被判为问题：
      //     没有转场语义的简单段清个底色就够了，不该被要求画全屏 Pass。
      const full = paint?.full ?? -1;
      const risky = !!it.handlesTransition || w !== 'none';
      results.push({
        id: it.id, t,
        handlesTransition: !!it.handlesTransition,
        drawAny: paint?.any ?? -1,
        full,
        lines: paint?.lines ?? -1,
        declaredWorld: w,
        trace: paint?.trace ?? null,
        missing: full === 0 && risky,
      });
    }
    return { results, timeline: items.length };
  },

  /** 调试：把引擎内部状态摊开（时间线、当前活跃段、后处理参数）。 */
  debug(t) {
    const items = t == null ? [] : engine.timeline.filter((i) => t >= i.start && t < i.end).map((i) => i.id);
    return {
      clock: t,
      active: items,
      duration: engine.duration,
      timeline: engine.timeline.map((i) => ({ id: i.id, start: i.start, end: i.end, hasScene: !!i._scene, name: i._scene?.constructor?.name ?? typeof i._scene })),
      errors: engine.errors,
      lastSamples: engine.lastSamples,
      stream: { ...streamState },
    };
  },
};

/** 最近一帧用掉的子帧数 / 采样误差（CLI 统计运动模糊采样分布用）。 */
Object.defineProperty(api, 'lastSamples', { get() { return engine?.lastSamples ?? 1; }, enumerable: true });
Object.defineProperty(api, 'lastErrors', { get() { return engine?.lastErrors ?? []; }, enumerable: true });

/** 等状态就绪（CLI 用） */
api.ready = new Promise((res) => { api._resolveReady = res; });

/** @type {any} */ (window).__anim = api;
/**
 * 引擎实例也挂出来（只给诊断用：`anim determinism` 要读 lastSamples / lastPost /
 * music 这些内部量，来判断"跨帧依赖"到底出在哪一项上）。
 */
Object.defineProperty(window, '__animEngine', { get() { return engine; }, enumerable: false });

boot()
  .then((r) => {
    api.boot = r;
    api._resolveReady?.(status);
    if (status.state === 'ready') {
      setMsg(`就绪 · ${engine?.timeline.length ?? 0} 段 · ${engine?.duration.toFixed(2)}s`);
    }
  })
  .catch(fail);
