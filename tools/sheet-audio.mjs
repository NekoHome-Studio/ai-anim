#!/usr/bin/env node
// @ts-check
/**
 * sheet-audio —— **一张图判定"这个揭晓发生在旁白说到哪一刻"**。
 *
 * 把四样东西画进同一张 PNG，横轴共用同一个时间窗：
 *
 *   ① 抽帧接触表   从**已经存在的成片 mp4** 里抽（不重新渲染），或复用 `anim sheet` 的 PNG
 *   ② 波形/包络    `src/core/audio-analysis.js`（纯 JS，Node 与浏览器共用）+ 原始 PCM 的峰值
 *   ③ ≥400ms 静音带 在**原始 PCM** 上按窗口 RMS 找（阈值/最短时长都可调，图例里写清楚）
 *   ④ 旁白词级标签  `tasks/<任务>/audio/narration.json` 的 `lines[].words`（**整片绝对时间**）
 *   外加时间标尺（每秒一格 + 每 `--tick` 秒一个数字）
 *
 * ├── 边界（照抄外部参考项目 `timeline_view.py` 的原文）───────────────────────┤
 * │ 这条工具是 **"只在决策点调用，不拿它当扫描工具"**。                        │
 * │ "Use this at decision points… Do NOT call it in a scan loop over every     │
 * │  utterance; it's an on-demand drill-down, not a background index."         │
 * └───────────────────────────────────────────────────────────────────────────┘
 * 换句话说：你怀疑"某一处揭晓与某句旁白对不上"时跑一次；**不要**拿它把整片
 * 从头到尾扫一遍（那是 `anim check` / `hashes` / `regress-all` 的活）。
 *
 * ── 为什么不重新渲染 ────────────────────────────────────────────────────────
 * 渲染要起私有 Vite + 无头 Chrome（AGENTS.md §7：**渲染期间别人一个文件都不能写**）。
 * 这条工具完全**不碰 GPU、不进渲染路径**，只读磁盘上已经有的 mp4 / PNG。
 * 只有你**明确**给 `--video out/<任务>/x.mp4` 时它才读别的文件。
 *
 * ── 音频轨：必须明确挑一条 ──────────────────────────────────────────────────
 * `task.config.mjs` 的 `audio` 可以是 `{ music, vo, mix }`（`src/tasks.js:114-118`）。
 * 这三条轨在 sodium 上是**真的不一样**（实测 2026-10-10，245s 全片）：
 *   · `vo`  只有旁白 —— 句与句之间是**数字静音**（-180dBFS），43/43 句都能量出 0.4s+ 空档；
 *   · `mix` 旁白 + 音乐床 —— 音乐一直在，句间只掉到约 -33dBFS，**一条 ≥400ms 静音带都没有**；
 *   · `music` 只有音乐床 —— 和旁白**对不上，但不报错**。
 * 所以判"揭晓发生在旁白说到哪一刻"时静音带只在 `vo` 上成立。
 * 默认：**有 narration.json 就取 vo，没有才取 mix**；选了哪条**写在图上**（AUDIO 行），
 * 而且没有静音带时会把该轨的噪声底（p90）打出来，让"为什么没有带"当场可读。
 * `--list-tracks` 列出所有候选，含每条轨的时长与静音带条数。
 *
 * ── 实现（为什么这么拼）────────────────────────────────────────────────────
 * · 底图（接触表 + 波形 + 静音带 + 标尺刻度）由 **Node 自己画**：手写 PNG 编码器
 *   （`node:zlib`，不引新依赖）。确定性强、像素级可控、不依赖 ffmpeg 的滤镜语法。
 * · **文字**交给 libass（`ffmpeg -vf subtitles=…`）：本机 fontconfig 没有默认配置
 *   （`Fontconfig error: Cannot load default config file`，`drawtext=font=` 直接找不到字体），
 *   但 `subtitles=…:fontsdir=<dir>` 能按**文件**加载 ttf/ttc，中文排版也正确
 *   （已实测：Noto Sans SC 的汉字能正常出字）。
 *   ⚠ `fontsdir` 只吃**相对路径**：Windows 绝对路径（`C:\…`）里的 `:` 会把滤镜链解析炸掉
 *   （`No option name near '…'`，三种转义写法都试过）——所以字体先复制到工作目录下的
 *   `out/_staging/sheet-audio-fonts/`，再传相对路径。
 * · 文字层渲染完再用 `colorkey` 抠黑 + `overlay` 合成 —— 两次 ffmpeg 调用，
 *   中间产物默认落在临时目录（`--keep` 保留）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { run, ffmpegArgv, ffprobeArgv, probeDuration, decodeMono, readTaskAudioSpec, taskRel } from '../scripts/lib/media.mjs';
import { analyzePCM } from '../src/core/audio-analysis.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ══════════════════════════════════════════════════════════════ 命令行 */

const HELP = `sheet-audio —— 把「抽帧接触表 + 波形 + 静音带 + 旁白词级标签 + 时间标尺」叠进同一张 PNG。

用法
  node tools/sheet-audio.mjs <任务> --from <秒> --to <秒> [选项]
  node tools/sheet-audio.mjs <任务> --list-tracks

边界（照抄外部参考项目 timeline_view.py 的原文）
  这条工具**只在决策点调用，不拿它当扫描工具**：
  "Use this at decision points… Do NOT call it in a scan loop over every utterance;
   it's an on-demand drill-down, not a background index."
  —— 怀疑"某一处揭晓与某句旁白对不上"时跑一次；整片扫一遍请用 anim check / hashes。

  它**不重新渲染**：抽帧只从磁盘上已经有的 mp4 / 接触表 PNG 来（不起 Vite、不起 Chrome）。

选项
  --from <秒>        时间窗起点（默认 0）
  --to <秒>          时间窗终点（默认 from+12）
  -n, --frames <n>   抽帧数（默认 16，最少 2）
  --cols <n>         每行几格（默认 4）
  --cell <px>        单格宽（默认 424；太高会自动缩到 --max-height 以内）
  --max-height <px>  整图高度上限（默认 1900）
  --width <px>       整图宽度（默认 1920）
  --tick <秒>        标尺数字间隔（默认随窗宽在 1/2/5/10/30/60 里挑一个"好看"的）
  --video <文件>     明确指定成片 mp4（默认自己找 out/<任务>/*.mp4）
  --sheet <png>      改用 anim sheet 已经产出的接触表 PNG（切片当帧条）。
                     ⚠ 这条路是**次选**：接触表里没有逐帧时刻，切片只能按版面复算，
                     所以 \`-n/--from/--to\` 必须与当初 \`anim sheet\` 那次一致，
                     \`--cols\` 也要与它一致。要精确对齐请用 mp4 主路径（默认）。
  --img <x,y,w,h>    只对 --sheet 有效：**直接给一格的位置与大小**（跳过版面复算）。
  --img-step <dx,dy> 只对 --sheet 有效：相邻格的步距（默认 w+8, h+28）。
  --track <名字|文件>
                     音频轨：vo（只有旁白）/ mix（旁白+音乐床）/ music（只有音乐床），
                     或直接给一个音频文件路径。**拿错轨会得到"对不上但不报错"的图**，
                     所以选了哪条会写在图上（标题下面的 AUDIO 行）。
                     默认：有 narration.json 就取 vo（只有它句间是真静音，静音带才有意义），
                     没有就取 mix。sodium 实测（整片 246s / 门限 -45dB / ≥0.4s）：
                     **vo 75 条静音带、mix 4 条、music 2 条**；optifine：vo 85 / mix 2。
  --list-tracks      列出候选音轨（时长 + 静音带条数 + 噪声底）然后退出
  --sr <hz>          解码采样率（默认 22050）
  --silence-db <db>  静音判据（默认 -45，与 scripts/lib/media.mjs 的 probeSpeechEnd 同口径）。
                     \`vo\` 轨句间是数字静音（≤-120dB），-45 一次就成；
                     有些片子的 vo 轨是**混过**的（beast 那条），句间只掉到 -30 上下，
                     那就调高到 -32；**没有静音带时工具会把窗口内的 p1 打出来并给建议值**
  --min-silence <秒> 多长才算一条静音带（默认 0.4）
  --label-min <秒>   词标签最短时长（默认 0.05，照抄对方 \`if (we - ws) < 0.05: continue\`）
  --label-gap <px>   相邻词标签的最小横向间距（默认 28，照抄对方 \`if cx - last_label_x < 28\`）
  -o, --out <png>    输出 PNG（默认 out/<任务>/sheet-audio_<from>-<to>_<轨名>.png ——
                     **轨名进文件名**，否则拿 mix 跑一次会静默盖掉 vo 那张图）
  --keep             保留中间产物（底图 *-base.png / 文字层 *-text.png / *.ass），便于排错
  --font <ttf|ttc>   文字层字体（默认 %WINDIR%\\Fonts 里的 Noto Sans SC / 微软雅黑 / 黑体 / 等线）。
                     本机 fontconfig 没有默认配置，字体是**按文件**交给 libass 的
  --fontsdir <目录>  改成用你自己的字体目录（默认：把 --font 复制到
                     out/_staging/sheet-audio-fonts/ 再用**相对路径**传给 libass ——
                     Windows 绝对路径里的 ":" 会把 ffmpeg 的滤镜链解析炸掉）
  --json             把统计量按 JSON 打到 stdout（图仍然出）
  -h, --help         这份说明

例
  node tools/sheet-audio.mjs sodium --from 0 --to 12
  node tools/sheet-audio.mjs sodium --from 60 --to 74 -n 8 --track vo --keep
  node tools/sheet-audio.mjs sodium --list-tracks
  node tools/sheet-audio.mjs sodium --from 0 --to 12 --sheet out/sodium/sheet_0-12.png

图上读什么
  · **波形**：src/core/audio-analysis.js 的 rms 包络（细线）+ 原始 PCM 的每列峰值（填充）——
    两者都归一化到 0..1，所以看的是"哪里有声、哪里有停顿"，不是绝对电平。
  · **静音带**：≥ --min-silence 秒、且在 --silence-db 以下的区间（半透明蓝条，图例给了条数与总时长）。
    旁白句与句之间那 0.4s 以上的空档会在这里显形 —— 它就是"这一句说完了"的判据。
  · **词标签**：narration.json 的 lines[].words，整片绝对时间；只画 ≥ --label-min 秒
    且与前一个标签横向间隔 ≥ --label-gap 像素的词（密集处会自动省略，避免糊成一团）。
  · **时间标尺**：横轴 = [--from, --to]，接触表每一格正上方就是它的抽帧时刻，
    与波形/词标签/静音带**共用同一个 x 映射**（同一张图上任何两点竖直对齐 = 同一时刻）。
`;

function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const o = { _: [] };
  const num = (v, k) => { const x = Number(v); if (!Number.isFinite(x)) die(`--${k} 需要一个数字，收到 "${v}"`); return x; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (k) => { const v = argv[++i]; if (v === undefined) die(`--${k} 后面缺一个值`); return v; };
    switch (a) {
      case '-h': case '--help': o.help = true; break;
      case '--from': o.from = num(need('from'), 'from'); break;
      case '--to': o.to = num(need('to'), 'to'); break;
      case '-n': case '--frames': o.n = num(need('frames'), 'frames'); break;
      case '--cols': o.cols = num(need('cols'), 'cols'); break;
      case '--cell': o.cell = num(need('cell'), 'cell'); break;
      case '--max-height': o.maxHeight = num(need('max-height'), 'max-height'); break;
      case '--width': o.width = num(need('width'), 'width'); break;
      case '--tick': o.tick = num(need('tick'), 'tick'); break;
      case '--video': o.video = need('video'); break;
      case '--sheet': o.sheet = need('sheet'); break;
      case '--img': o.img = need('img'); break;
      case '--img-step': o.imgStep = need('img-step'); break;
      case '--track': o.track = need('track'); break;
      case '--list-tracks': o.listTracks = true; break;
      case '--sr': o.sr = num(need('sr'), 'sr'); break;
      case '--silence-db': o.silenceDb = num(need('silence-db'), 'silence-db'); break;
      case '--min-silence': o.minSilence = num(need('min-silence'), 'min-silence'); break;
      case '--label-min': o.labelMin = num(need('label-min'), 'label-min'); break;
      case '--label-gap': o.labelGap = num(need('label-gap'), 'label-gap'); break;
      case '-o': case '--out': o.out = need('out'); break;
      case '--keep': o.keep = true; break;
      case '--font': o.font = need('font'); break;
      case '--fontsdir': o.fontsdir = need('fontsdir'); break;
      case '--json': o.json = true; break;
      default:
        if (a.startsWith('-')) die(`不认识的选项：${a}（--help 看用法）`);
        o._.push(a);
    }
  }
  return o;
}

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(2);
}
function log(msg) { console.log(msg); }

/* ══════════════════════════════════════════════════════════════ 小工具 */

function r340(x) { return Math.round(x * 1000) / 1000; }

/** 挑一个"好看"的标尺间隔（1/2/5/10/15/30/60…）。 */
function niceStep(span) {
  const raw = span / 10;
  for (const s of [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300]) if (s >= raw) return s;
  return 600;
}

/** 秒 -> `m:ss.s`（超过 1 小时给 `h:mm:ss.s`）。 */
function tmmss(t) {
  const neg = t < 0;
  let s = Math.abs(t);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const ss = s.toFixed(1).padStart(4, '0');
  return `${neg ? '-' : ''}${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${ss}`;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 中英混排的**粗略**宽度估算（只用来摆图例/居中，不参与时间轴映射）。 */
function textWidth(s, px) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c >= 0x2e80 && c <= 0x9fff) w += 1.0;        // CJK
    else if (c >= 0xff00 && c <= 0xff60) w += 1.0;   // 全角标点
    else if (' .,:;!|\'`il'.includes(ch)) w += 0.32;
    else w += 0.58;
  }
  return w * px;
}

/* ══════════════════════════════════════════════════════════════ PNG 编码（node:zlib） */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** RGBA8 像素 -> PNG 字节（filter 0，zlib 默认压缩）。 */
function encodePNG(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ══════════════════════════════════════════════════════════════ 光栅画布 */

class Raster {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h * 4);
  }
  /** 全部填成不透明底色。 */
  fill(rgbg) {
    const [r, g, b] = rgbg;
    for (let i = 0; i < this.px.length; i += 4) { this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255; }
  }
  /** 一个像素，alpha 混合（a=0..1）。越界忽略。 */
  blend(x, y, rgbg, a = 1) {
    x |= 0; y |= 0;
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const p = this.px;
    if (a >= 1) { p[i] = rgbg[0]; p[i + 1] = rgbg[1]; p[i + 2] = rgbg[2]; p[i + 3] = 255; return; }
    p[i] = p[i] + (rgbg[0] - p[i]) * a;
    p[i + 1] = p[i + 1] + (rgbg[1] - p[i + 1]) * a;
    p[i + 2] = p[i + 2] + (rgbg[2] - p[i + 2]) * a;
    p[i + 3] = 255;
  }
  rect(x, y, w, h, rgbg, a = 1) {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.blend(xx, yy, rgbg, a);
  }
  /** 1px 边框 */
  frame(x, y, w, h, rgbg, a = 1) {
    const x0 = Math.round(x), y0 = Math.round(y), x1 = Math.round(x + w) - 1, y1 = Math.round(y + h) - 1;
    for (let xx = x0; xx <= x1; xx++) { this.blend(xx, y0, rgbg, a); this.blend(xx, y1, rgbg, a); }
    for (let yy = y0; yy <= y1; yy++) { this.blend(x0, yy, rgbg, a); this.blend(x1, yy, rgbg, a); }
  }
  vline(x, y0, y1, rgbg, a = 1) { for (let y = Math.round(y0); y <= Math.round(y1); y++) this.blend(x, y, rgbg, a); }
  hline(y, x0, x1, rgbg, a = 1) { for (let x = Math.round(x0); x <= Math.round(x1); x++) this.blend(x, y, rgbg, a); }
  /** 贴一块 RGB24 块（接触表的单格）。 */
  blitRGB24(rgb, bw, bh, x, y) {
    for (let yy = 0; yy < bh; yy++) {
      const dy = y + yy;
      if (dy < 0 || dy >= this.h) continue;
      for (let xx = 0; xx < bw; xx++) {
        const dx = x + xx;
        if (dx < 0 || dx >= this.w) continue;
        const si = (yy * bw + xx) * 3, di = (dy * this.w + dx) * 4;
        this.px[di] = rgb[si]; this.px[di + 1] = rgb[si + 1]; this.px[di + 2] = rgb[si + 2]; this.px[di + 3] = 255;
      }
    }
  }
}

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/* ══════════════════════════════════════════════════════════════ ASS 文字层 */

/** ASS 的颜色是 &HAABBGGRR（**BGR**，别写成 RGB）。 */
function assColor(hex, alpha = 0) {
  const [r, g, b] = rgb(hex);
  const hx = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  return `&H${hx(alpha)}${hx(b)}${hx(g)}${hx(r)}`;
}
/** ASS 文本里的 `{` / `}` / `\` 是控制字符，必须转成全角/掏空。 */
function assText(s) {
  return String(s).replace(/\\/g, '＼').replace(/\{/g, '｛').replace(/\}/g, '｝').replace(/\r?\n/g, '\\N');
}

/**
 * 把一堆 `{ x, y, size, color, text }` 写成一份 ASS。
 * 定位靠 `\pos(x,y)` + Style 的 Alignment=7（左上角锚点）—— 这样 x/y 就是**字块左上角**，
 * 与 Node 侧的布局坐标是同一个坐标系，不需要再估字宽。
 */
function makeASS(items, W, H) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: mk,${FONT_FAMILY},40,${assColor('#ffffff')},${assColor('#ffffff')},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = items.map((it) => {
    const t = `{\\pos(${Math.round(it.x)},${Math.round(it.y)})${it.size ? `\\fs${Math.round(it.size)}` : ''}` +
      `${it.bold ? '\\b1' : ''}${it.spacing ? `\\fsp${it.spacing}` : ''}}${assText(it.text)}`;
    return `Dialogue: 0,0:00:00.00,0:00:10.00,mk,,0,0,0,,${t}`;
  });
  return head + lines.join('\n') + '\n';
}
/** libass 按**家族名**取字；这里的值在渲染前会被 --font 的名字覆盖。 */
let FONT_FAMILY = 'Noto Sans SC';

/* ══════════════════════════════════════════════════════════════ 任务 / 输入发现 */

function listTasks() {
  const dir = path.join(ROOT, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((n) => existsSync(path.join(dir, n, 'task.config.mjs')));
}

/** 抽帧来源：成片 mp4 优先，其次 anim sheet 的接触表 PNG。 */
function findVideoSource(task, o) {
  if (o.video) {
    const p = path.resolve(ROOT, o.video);
    if (!existsSync(p)) die(`--video 指的文件不存在：${p}`);
    return { kind: 'mp4', file: p, label: path.relative(ROOT, p).replace(/\\/g, '/') };
  }
  if (o.sheet) {
    const p = path.resolve(ROOT, o.sheet);
    if (!existsSync(p)) die(`--sheet 指的 PNG 不存在：${p}`);
    return { kind: 'sheet', file: p, label: path.relative(ROOT, p).replace(/\\/g, '/') };
  }
  const dir = path.join(ROOT, 'out', task);
  /** @type {{file:string,size:number}[]} */
  const mps = existsSync(dir)
    ? readdirSync(dir).filter((f) => /\.mp4$/i.test(f)).map((f) => ({ file: path.join(dir, f), size: 1 }))
    : [];
  // 成片优先：名字里没有 -subbed / -share / _stitched 的那些
  const rank = (f) => {
    const b = path.basename(f).toLowerCase();
    if (b === `${task.toLowerCase()}.mp4`) return 0;
    if (b.includes('subbed') || b.includes('share') || b.includes('_stitched') || b.includes('preview')) return 2;
    return 1;
  };
  mps.sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file));
  if (mps.length) return { kind: 'mp4', file: mps[0].file, label: path.relative(ROOT, mps[0].file).replace(/\\/g, '/') };
  // 退路：anim sheet 已经产出的接触表
  const sheets = existsSync(dir) ? readdirSync(dir).filter((f) => /^sheet.*\.png$/i.test(f)) : [];
  if (sheets.length) {
    const p = path.join(dir, sheets.sort().pop());
    return { kind: 'sheet', file: p, label: path.relative(ROOT, p).replace(/\\/g, '/') };
  }
  return null;
}

/**
 * 音轨候选：`task.config.mjs` 里的 `{ music, vo, mix }` 加上 audio/ 目录里的音频文件。
 * ⚠ 只做**文本解析**（`readTaskAudioSpec`）—— 任务配置是 Vite 模块，Node 里 import() 会炸。
 */
function findAudioTracks(task) {
  const taskDir = path.join(ROOT, 'tasks', task);
  /** @type {{name:string, file:string, kind:string}[]} */
  const out = [];
  const spec = readTaskAudioSpec(taskDir);
  const push = (kind, rel) => {
    const f = taskRel(taskDir, rel);
    if (f && existsSync(f) && !out.some((x) => x.file === f)) out.push({ name: kind, file: f, kind });
  };
  if (spec && typeof spec === 'object') {
    // 顺序 = 优先级：mix（人声+配乐，对得上旁白）优先
    for (const k of ['mix', 'vo', 'music']) if (spec[k]) push(k, spec[k]);
  } else if (typeof spec === 'string') push('audio', spec);
  const au = path.join(taskDir, 'audio');
  if (existsSync(au)) {
    for (const f of readdirSync(au).filter((x) => /\.(mp3|m4a|wav|aac|flac|ogg)$/i.test(x)).sort()) {
      const abs = path.join(au, f);
      if (!out.some((x) => x.file === abs)) out.push({ name: path.basename(f, path.extname(f)), file: abs, kind: 'file' });
    }
  }
  return out;
}

/**
 * 挑一条轨：`--track` 可以是轨名（mix/music/vo）、文件路径、或轨名的一部分。
 *
 * 默认顺序取决于**有没有旁白表**：
 * · 有 `narration.json`（= 这支片子有旁白，词标签才有意义）→ 找"只有旁白"的那条：
 *   先看 `audio: { vo: … }` 显式声明的，再看文件名以 `-vo` / `_vo` 结尾的。
 *   理由（sodium / optifine 实测）：`vo` 句间是数字静音，静音带判据成立（sodium 75 条、
 *   optifine 85 条）；`mix` 上音乐一直在，整片一条 ≥400ms 静音带都找不到 —— 拿 mix 画出来的图
 *   会"看着没错、其实少了整个静音通道"。
 * · 没有旁白表 → 取 `mix`（成片实际听到的那条），其次第一个候选。
 */
function pickTrack(task, o, tracks, hasNarration) {
  if (!tracks.length) return null;
  if (o.track) {
    const byName = tracks.find((t) => t.name === o.track);
    if (byName) return byName;
    const p = path.resolve(ROOT, o.track);
    if (existsSync(p)) {
      const known = tracks.find((t) => t.file === p);
      return known ?? { name: path.basename(p, path.extname(p)), file: p, kind: 'cli' };
    }
    // 轨名的一部分（beast 的轨叫 beast-vo，`--track vo` 也该认）
    const part = tracks.filter((t) => t.name.includes(o.track) || t.file.includes(o.track));
    if (part.length) return part[0];
    die(`--track 既不是轨名（${tracks.map((t) => t.name).join(' / ')}）、不是轨名的一部分、也不是存在的文件：${o.track}`);
  }
  const isVo = (t) => t.kind === 'vo' || /[-_]vo$/i.test(t.name);
  if (hasNarration) return tracks.find(isVo) ?? tracks.find((t) => t.kind === 'mix') ?? tracks[0];
  return tracks.find((t) => t.kind === 'mix') ?? tracks[0];
}

/* ══════════════════════════════════════════════════════════════ 数据 */

/** 从成片 mp4 里抽一帧，缩放成 16:9 的 `w×h`，返回 RGB24。 */
function grabFrame(video, t, w, h) {
  const r = run([
    ...ffmpegArgv(), '-v', 'error',
    '-ss', t.toFixed(4), '-i', video,
    '-vf', `scale=${w}:${h}:flags=bicubic,format=rgb24`,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { maxBuffer: w * h * 3 + (1 << 20) });
  if (r.status !== 0 || r.stdoutBuf.length < w * h * 3) {
    throw new Error(`抽帧失败 t=${t}（${video}）：${r.stderr.trim().split(/\r?\n/).slice(-3).join(' | ')}`);
  }
  return r.stdoutBuf.subarray(0, w * h * 3);
}

/** `anim sheet` 的接触表 PNG -> RGBA 像素（PNG 解码：8bit、无隔行、filter 0..4）。 */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8, w = 0, h = 0, bd = 0, ct = 0, il = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; il = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || il !== 0) throw new Error(`PNG 只支持 8bit 无隔行（这张是 bitDepth=${bd} interlace=${il}）`);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
  if (!ch) throw new Error(`PNG 颜色类型 ${ct} 不支持（调色板/16bit 请先转成 RGBA8）`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const si = x * ch, di = (y * w + x) * 4;
      if (ch >= 3) { out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2]; out[di + 3] = ch === 4 ? cur[si + 3] : 255; }
      else { out[di] = out[di + 1] = out[di + 2] = cur[si]; out[di + 3] = ch === 2 ? cur[si + 1] : 255; }
    }
    prev.set(cur);
  }
  return { w, h, rgba: out };
}

/**
 * 按 `anim sheet` 的**版面公式**反解出"一格"的位置与步距。
 *
 * `anim sheet`（`scripts/anim.mjs` 的 `cmdSheet`）的版面是它自己写死的：
 *   `W = cols*(w+pad) + pad`，`H = rows*(h+lab+pad) + pad`，`pad=6`、`lab=20`、
 *   每一格里的画面是 `w × 9/16`，时刻标签画在画面**上方** 20px 处。
 * 只有 `w` 一个未知数 → 由实际尺寸解出来，再验算回去（差 >3px 就认为"这不是 anim sheet 的版面"）。
 * 解不出来就返回 null，由调用方退回等分并**在图上和日志里说清楚**。
 *
 * ⚠ `cols` 由调用方给（`--cols`，默认 4），**行数由 `H` 自己解** —— 这样 4×2 的 8 格表
 *   与 4×4 的 16 格表都能对上（见函数体里那条实测记录）。
 *
 * @returns {{tile:{x0:number,y0:number,w:number,h:number}, step:{dx:number,dy:number},
 *            cols:number, rows:number}|null}
 */
function guessSheetTile(W, H, cols) {
  const pad = 6, lab = 20;
  const w = (W - pad) / cols - pad;
  const h = (w * 9) / 16;
  if (!(w > 40 && h > 20)) return null;
  if (Math.abs(cols * (w + pad) + pad - W) > 3) return null;
  // ⚠ **行数由 PNG 的高度解出来**，不能让调用方拿"输出排版"的行数来凑：
  //   实测踩过（2026-10-16，BACKLOG 头部 ⑥）——8 格（4×2）的接触表被按 4×4 复算，
  //   于是 7 格落在图外、剩下的格子整体错位，而报告只说"尺寸对不上"。
  //   解出来的行数还要能整除高度，否则这张 PNG 不是 anim sheet 的版面。
  const rows = Math.round((H - pad) / (h + lab + pad));
  if (!(rows >= 1)) return null;
  if (Math.abs(rows * (h + lab + pad) + pad - H) > 3) return null;
  return {
    tile: { x0: pad, y0: pad + lab, w, h },
    step: { dx: w + pad, dy: h + lab + pad },
    cols, rows,
  };
}

/** 从 RGBA 里取一个像素。 */
function pxAt(dec, x, y) {
  const i = (y * dec.w + x) * 4;
  return [dec.rgba[i], dec.rgba[i + 1], dec.rgba[i + 2]];
}

/**
 * 包络与静音带。
 *
 * · `env`：走 `audio-analysis.js` 的 `analyzePCM`（纯 JS FFT，Node 与浏览器共用）。
 *   ⚠ `TARGET_SR` 是**没导出的私有常量**（`audio-analysis.js:20`），采样率必须自己传；
 *   这里显式传 `--sr`，所以包络帧率 = sr/HOP(1024)，**会写在图上**。
 * · `silence`：另按 `win` 毫秒一格的 RMS（dBFS）找 —— rms 包络在 44.1k 下一格 93ms，
 *   分辨"≥400ms 的空档"太粗，所以静音判据直接在原始 PCM 上量。
 *   ⚠ `p90` / `p1` / `belowFrac` **只统计窗口内**的那一段：不然图例里"噪声底"是整个文件的、
 *   而"静音带"是窗口内的，两个数不是一个口径（实测踩过：beast 全片 p1=-46.9、窗口内 p1=-65.8，
 *   按全片给的"建议门限"能把 -33dB 的句子也当成静音）。p90 是给波形当音量基准用的，
 *   全片与窗口内都能用，这里统一取窗口内的，图例上写明。
 */
function analyse(pcm, sr, from, to, opt) {
  const a = analyzePCM(pcm, sr);
  const envFps = a.fps ?? sr / 1024;
  const env = a.rms;   // 已按 0.995 分位归一化到 0..1
  const win = Math.max(1, Math.round(sr * 0.02));            // 20ms
  const nWin = Math.floor(pcm.length / win);
  const db = new Float32Array(nWin);
  for (let i = 0; i < nWin; i++) {
    let s = 0;
    for (let k = 0; k < win; k++) { const v = pcm[i * win + k]; s += v * v; }
    const rms = Math.sqrt(s / win);
    db[i] = rms > 1e-9 ? 20 * Math.log10(rms) : -120;
  }
  // 分位基准（音量参考线）：**只看窗口内**的非静音窗口，取 90 分位
  const i0 = Math.max(0, Math.floor(from / (win / sr)));
  const i1 = Math.min(nWin, Math.ceil(to / (win / sr)));
  const inWin = db.subarray(i0, i1);
  const sorted = Float32Array.from(inWin).sort();
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const p1 = sorted[Math.max(0, Math.floor(sorted.length * 0.01))] || -120;
  const thr = opt.silenceDb;
  const minN = Math.max(1, Math.round(opt.minSilence / (win / sr)));
  /** @type {{t0:number,t1:number}[]} */
  const runs = [];
  let run = -1;
  for (let i = 0; i <= nWin; i++) {
    const silent = i < nWin && db[i] < thr;
    if (silent) { if (run < 0) run = i; }
    else if (run >= 0) {
      if (i - run >= minN) {
        const t0 = (run * win) / sr, t1 = (i * win) / sr;
        if (t1 > from && t0 < to) runs.push({ t0, t1 });
      }
      run = -1;
    }
  }
  return { a, env, envFps, db, dbWin: win / sr, p90, p1, inWin, thr, silence: runs, sr };
}

/* ══════════════════════════════════════════════════════════════ 主流程 */

const o = parseArgs(process.argv.slice(2));
if (o.help || (!o._.length && !o.listTracks)) { process.stdout.write(HELP); process.exit(0); }
const task = o._[0];
if (!task) die(`缺任务名。可用：${listTasks().join(', ') || '(空)'}`);

o.width = Math.round(o.width ?? 1920);
o.n = Math.max(2, Math.round(o.n ?? 16));
o.from = Number.isFinite(o.from) ? o.from : 0;
o.to = Number.isFinite(o.to) ? o.to : o.from + 12;
if (!(o.to > o.from)) die(`--to (${o.to}) 必须大于 --from (${o.from})`);
const WINDOW = o.to - o.from;
const sr = Math.round(o.sr ?? 22050);
const silenceDb = o.silenceDb ?? -45;
const minSilence = o.minSilence ?? 0.4;
const labelMin = o.labelMin ?? 0.05;
const labelGap = o.labelGap ?? 28;
const maxHeight = o.maxHeight ?? 1900;
const keep = !!o.keep;

/* ---- 旁白词级标签（要在挑轨之前读：有没有旁白表决定默认取哪条轨） ---- */
const narFile = path.join(ROOT, 'tasks', task, 'audio', 'narration.json');
let narration = null;
/**
 * 旁白表的**来历**：`narration.json` 是 `anim say` 的产物，随时可能被重跑（我就撞到过一次 ——
 * 会话进行中另一个进程重生成它，同一个词的时间戳挪了约 90ms、hook-3 的词数从 8 变 7）。
 * 所以把"读的是哪一份"记进图里（行数 + mtime + 短哈希），免得拿一张旧图去判定新旁白。
 */
let narProv = null;
if (existsSync(narFile)) {
  try {
    const raw = readFileSync(narFile, 'utf8');
    narration = JSON.parse(raw);
    const st = statSync(narFile);
    narProv = {
      file: path.relative(ROOT, narFile).replace(/\\/g, '/'),
      lines: narration.lines?.length ?? 0,
      mtime: new Date(st.mtimeMs).toISOString().slice(0, 19).replace('T', ' '),
      sha1: createHash('sha1').update(raw).digest('hex').slice(0, 8),
    };
  } catch (e) { log(`⚠ ${path.relative(ROOT, narFile)} 读不了，跳过词标签：${e.message}`); }
}

/* ---- 音频轨 ---- */
const tracks = findAudioTracks(task);
const autoTrack = narration?.lines ? (tracks.find((t) => t.kind === 'vo') ?? tracks.find((t) => t.kind === 'mix')) : null;
if (o.listTracks) {
  if (!tracks.length) { log(`tasks/${task} 下没找到任何音轨（看 audio/ 目录与 task.config.mjs 的 audio 字段）`); process.exit(1); }
  log(`tasks/${task} 的音轨候选（按当前参数 --silence-db ${silenceDb} / --min-silence ${minSilence} 量）：\n`);
  log(`  ${'轨'.padEnd(10)} ${'时长'.padStart(8)}  ${'p90 噪声底'.padStart(10)}  ${'静音带'.padStart(6)}  ${'低于门限的窗口'.padStart(12)}  文件`);
  for (const t of tracks) {
    let dur = NaN, info = '';
    try { dur = probeDuration(t.file); } catch { /* 量不出来就留空 */ }
    try {
      const pcm = decodeMono(t.file, sr);
      const seg = analyse(pcm, sr, 0, dur || pcm.length / sr, { silenceDb, minSilence });
      const below = seg.db.reduce((s, v) => s + (v < silenceDb ? 1 : 0), 0) / Math.max(1, seg.db.length);
      info = `${seg.p90.toFixed(1).padStart(9)}dB  ${String(seg.silence.length).padStart(6)}  ${`${(below * 100).toFixed(1)}%`.padStart(12)}`;
    } catch (e) { info = `分析失败：${e.message.split('\n')[0]}`; }
    const mark = autoTrack && t.file === autoTrack.file ? ' ← 默认' : '';
    log(`  ${t.name.padEnd(10)} ${(Number.isFinite(dur) ? `${dur.toFixed(1)}s` : '?').padStart(8)}  ${info}  ${path.relative(ROOT, t.file).replace(/\\/g, '/')}${mark}`);
  }
  log(`\n判"揭晓发生在旁白说到哪一刻"要在**只有旁白的那条轨**（vo）上看：`);
  log(`  句与句之间的静音带只有它成立；mix 上音乐一直在，"静音带 0 条"不是 bug 是那条轨本来就没有。`);
  log(`拿错轨会得到"对不上但不报错"的图 —— 图上 AUDIO 行写的就是实际用的那条。`);
  process.exit(0);
}
const track = pickTrack(task, o, tracks, !!narration?.lines);
if (!track) die(`tasks/${task} 下没找到音轨。做一个带旁白的任务（anim say <任务>）或手动放一个音频文件到 tasks/${task}/audio/`);
if (!narration?.lines) log(`⚠ 没有 tasks/${task}/audio/narration.json —— 这张图不会有旁白词级标签（先跑 anim say ${task}）`);

/* ---- 抽帧来源 ---- */
const src = findVideoSource(task, o);
if (!src) {
  die(`out/${task}/ 下既没有 mp4、也没有 anim sheet 的接触表 PNG —— 这条工具**不重新渲染**。\n` +
      `  先出一条成片：node scripts/anim.mjs video ${task}\n` +
      `  或者只出一张接触表：node scripts/anim.mjs sheet ${task} --from ${o.from} --to ${o.to} -n ${o.n}\n` +
      `  也可以明确指给别的文件：--video <mp4> / --sheet <png>`);
}

/* ---- 字体：libass 靠 fontsdir 按文件加载（本机 fontconfig 没有默认配置） ---- */
const tmpDir = path.join(os.tmpdir(), `sheet-audio-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
function pickFont() {
  if (o.font) {
    const p = path.resolve(ROOT, o.font);
    if (!existsSync(p)) die(`--font 不存在：${p}`);
    return p;
  }
  const cands = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'NotoSansSC-VF.ttf'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'msyh.ttc'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'simhei.ttf'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'Deng.ttf'),
    path.join(ROOT, 'public', 'fonts', 'NotoSansSC-VF.ttf'),
  ];
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}
const fontFile = pickFont();
if (!fontFile) die(`找不到可用的中文字体 —— 用 --font <ttf|ttc> 明确指定一个`);
FONT_FAMILY = path.basename(fontFile).replace(/\.(ttf|ttc|otf)$/i, '')
  .replace(/-(VF|Regular|Bold)$/i, '')
  .replace(/^NotoSansSC$/, 'Noto Sans SC');
/**
 * ⚠ `subtitles=…:fontsdir=` 只吃**相对路径**：Windows 绝对路径里的 `:` 会让 ffmpeg
 * 在解析滤镜链时把 `C` 当成一个不认识的选项名（`No option name near '…'`），
 * `C\:` / 正斜杠 / 转义三种写法都试过，全失败。所以字体一律先复制到**工作目录**下的
 * `out/_staging/sheet-audio-fonts/`（`out/**` 被 gitignore，不会污染仓库），再传相对路径。
 */
const fontDirRel = 'out/_staging/sheet-audio-fonts';
const fontsDir = o.fontsdir ? path.resolve(ROOT, o.fontsdir) : path.join(ROOT, fontDirRel);
if (o.fontsdir && !existsSync(fontsDir)) die(`--fontsdir 不存在：${fontsDir}`);
if (!o.fontsdir) {
  mkdirSync(fontsDir, { recursive: true });
  const dst = path.join(fontsDir, path.basename(fontFile));
  if (!existsSync(dst)) writeFileSync(dst, readFileSync(fontFile));
}
/** ASS / 中间产物放在 fontsdir 的父目录里，这样 `fontsdir=<basename>` 就是相对路径。 */
const workDir = o.fontsdir ? path.resolve(ROOT, o.fontsdir, '..') : path.join(ROOT, 'out', '_staging');
mkdirSync(workDir, { recursive: true });
const fontsDirArg = path.relative(workDir, fontsDir).replace(/\\/g, '/');

/* ---- 音频 ---- */
log(`音频轨 ${track.name}（${track.kind}）：${path.relative(ROOT, track.file).replace(/\\/g, '/')}`);
if (track.kind === 'music') {
  log(`  ⚠ 这是**音乐床**，上面没有旁白 —— 词标签与波形对不上是正常的。要判定旁白请用 --track vo。`);
}
if (track.kind === 'mix') {
  log(`  ⚠ 这是**混音轨**（旁白+音乐床）：音乐一直在，句间的静音带会被盖住。`);
  log(`     要量"这一句说到哪"用 --track vo（对钠这支片子：vo 有 43 条静音带，mix 一条都没有）。`);
}
const t0 = Date.now();
const pcm = decodeMono(track.file, sr);
const trackDur = pcm.length / sr;
log(`  解码 ${trackDur.toFixed(1)}s @ ${sr}Hz（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
const an = analyse(pcm, sr, o.from, o.to, { silenceDb, minSilence });
log(`  包络 ${an.envFps.toFixed(1)} 帧/秒（analyzePCM，HOP=1024）；静音带 ${an.silence.length} 条（<${silenceDb}dB 且 ≥${minSilence}s）`);
{
  // ⚠ 全部统计量都是**窗口内**的（见 analyse 的注释）：图例那句"p90 / below threshold"
  //   与静音带必须同一个口径，不然读图的人会把两个数当成一件事。
  const below = an.inWin.reduce((s, v) => s + (v < silenceDb ? 1 : 0), 0) / Math.max(1, an.inWin.length);
  log(`  这条轨在这个窗口里：p90 ${an.p90.toFixed(1)}dBFS / p1 ${an.p1.toFixed(1)}dBFS，` +
      `${(below * 100).toFixed(1)}% 的 20ms 窗口低于 ${silenceDb}dB`);
  if (!an.silence.length) {
    // 建议门限 = 窗口内 p1 + 6dB（≈ 静音簇的上沿），但不能高过 p90 − 6dB（否则会切到语音里）
    const hint = Math.min(Math.round(an.p1 + 6), Math.round(an.p90 - 6));
    log(`  → 没有 ≥${minSilence}s 的静音带。`);
    if (track.kind === 'mix') log(`     混音轨有音乐一直在，这是**预期**结果 —— 要看句间停顿请用 --track vo。`);
    else log(`     门限可能太高：这条轨窗口内 p1 = ${an.p1.toFixed(1)}dBFS，试 --silence-db ${hint}。`);
  }
}

/* ---- 源接触表的栅格（--sheet 路径）：必须按这张 PNG 自己解 ---- */
/**
 * 为什么必须在**排版之前**解：格子几何决定了"这张表里到底有几帧"，而帧数又决定输出的排版
 * （`rows = ceil(n/cols)`）。实测踩过（2026-10-16，BACKLOG 头部 ⑥）：8 格的接触表（4×2）
 * 配默认 `-n`，程序按 4×4 复算 ⇒ **7 格落在图外、剩下的格子整体错位**，而日志只说了
 * "尺寸对不上 anim sheet 的版面公式"。所以：解得出栅格就以**表里的实际格数**为准
 * （并在日志里说清忽略了你给的 `-n`）；解不出来才退回等分（那时也明说）。
 */
let sheetSrc = null;
if (src.kind === 'sheet' && !o.img) {
  const dec = decodePNG(readFileSync(src.file));
  const g = guessSheetTile(dec.w, dec.h, Math.round(o.cols ?? 4));
  if (g) {
    sheetSrc = { dec, cols: g.cols, rows: g.rows, tile: g.tile, step: g.step };
    const have = g.cols * g.rows;
    if (o.n !== have) {
      log(`  · 接触表实际是 ${g.cols}×${g.rows} = ${have} 格 ⇒ 按 ${have} 帧走（你给的 -n ${o.n} 被忽略；`
        + `要与 -n 一致就重出：node scripts/anim.mjs sheet <任务> --from ${o.from} --to ${o.to} -n ${o.n}）`);
      o.n = have;
    }
    o.cols = g.cols;
  } else {
    log(`  ⚠ 这张 PNG（${dec.w}×${dec.h}）对不上 anim sheet 的版面公式 ⇒ 退回等分（每格会带上相邻格与时刻标签的边）；`
      + '要精确对齐就给几何：--img x,y,w,h [--img-step dx,dy]');
    sheetSrc = { dec, cols: Math.round(o.cols ?? 4), rows: Math.ceil(o.n / Math.max(1, Math.round(o.cols ?? 4))), tile: null, step: null };
  }
}

/* ---- 布局 ---- */
const M = 56;                       // 左右留白
const PX0 = M, PX1 = o.width - M;
const plotW = PX1 - PX0;
const mapX = (t) => PX0 + ((t - o.from) / WINDOW) * plotW;

const pad = 6, labelH = 22;
let cols = Math.round(o.cols ?? (o.n <= 4 ? o.n : 4));
cols = clamp(cols, 1, o.n);
let rows = Math.ceil(o.n / cols);
let cellW = Math.round(o.cell ?? 424);
const HEADER_H = 92;
const AUDIO_H = 210, RULER_H = 40, LABEL_ROWS = 2, LABEL_H = 30, LEGEND_H = 62;
const GAP = 14;
const stripH = () => rows * (Math.round((cellW * 9) / 16) + labelH + pad) + pad;
function shrink() {
  while (HEADER_H + stripH() + GAP + AUDIO_H + RULER_H + LABEL_ROWS * LABEL_H + LEGEND_H + GAP > maxHeight && cellW > 120) {
    cellW -= 8;
    rows = Math.ceil(o.n / cols);
  }
}
shrink();
const cellH = Math.round((cellW * 9) / 16);
const H = HEADER_H + stripH() + GAP + AUDIO_H + RULER_H + LABEL_ROWS * LABEL_H + LEGEND_H + GAP;

/* ---- 抽帧 ---- */
const times = Array.from({ length: o.n }, (_, i) => o.from + (WINDOW * i) / (o.n - 1));
const canvas = new Raster(o.width, H);
const C = {
  bg: rgb('#0b0e11'), panel: rgb('#12171c'), grid: rgb('#232c34'), grid2: rgb('#37444f'),
  wave: rgb('#1d6f86'), waveHi: rgb('#5fd8f5'), silence: rgb('#2a5f8a'),
  frame: rgb('#39434d'), ruler: rgb('#4a5763'), text: rgb('#dbe6ec'), dim: rgb('#7c8a94'),
  warn: rgb('#ffb168'), good: rgb('#8ff08a'),
};
canvas.fill(C.bg);

let stripLabel = '';
if (src.kind === 'mp4') {
  const tA = Date.now();
  for (let i = 0; i < o.n; i++) {
    const px = grabFrame(src.file, times[i], cellW, cellH);
    const x = pad + (i % cols) * (cellW + pad);
    const y = HEADER_H + pad + Math.floor(i / cols) * (cellH + labelH + pad);
    canvas.blitRGB24(px, cellW, cellH, x, y + labelH);
    canvas.frame(x - 1, y + labelH - 1, cellW + 2, cellH + 2, C.frame);
    // 每一格正上方就是它的抽帧时刻（与下方波形共用同一个 x 映射）
    canvas.hline(y + labelH + cellH + 1, x, x + cellW - 1, C.grid, 1);
  }
  stripLabel = `从成片抽 ${o.n} 帧（ffmpeg -ss 精确 seek）`;
  log(`  抽帧 ${o.n} 帧（${((Date.now() - tA) / 1000).toFixed(1)}s）`);
} else {
  /**
   * 接触表 PNG：格子几何**要么显式给（`--img` / `--img-step`），要么按 anim sheet 的版面公式复算**。
   *
   * 为什么不"从像素里认网格"：三条判据都试过，在这类素材上全不可靠 ——
   * ① 底色占比：`anim sheet` 的底色 `#1a1a1c` 与画面的近黑背景太接近（sodium 的镜头就是一整片近黑）；
   * ② 纵向方差：**画面本身一整列方差可能比缝还小**；
   * ③ 列平均色的连续性：画面被 grain 打得相邻列都不一样，反而在画面内部认出成片的"缝"。
   * 所以几何一律来自参数，不由像素猜。**逐帧精确对齐请走 mp4 主路径。**
   */
  const dec = sheetSrc ? sheetSrc.dec : decodePNG(readFileSync(src.file));
  let tile = null, step = null, how = '';
  if (o.img) {
    const a = String(o.img).split(',').map(Number);
    if (a.length !== 4 || a.some((v) => !Number.isFinite(v))) die(`--img 需要 x,y,w,h 四个数字，收到 "${o.img}"`);
    tile = { x0: a[0], y0: a[1], w: a[2], h: a[3] };
    const s = o.imgStep ? String(o.imgStep).split(',').map(Number) : null;
    step = s && s.length === 2 && s.every(Number.isFinite) ? { dx: s[0], dy: s[1] } : { dx: tile.w + 8, dy: tile.h + 28 };
    how = '--img 显式指定';
  } else if (sheetSrc && sheetSrc.tile) {
    // 栅格在上面（排版之前）就解好了：这里的 `cols`/`rows` 已经是**这张表自己的**行列数
    tile = sheetSrc.tile; step = sheetSrc.step;
    how = `按 anim sheet 版面公式复算（源 ${sheetSrc.cols}×${sheetSrc.rows} 格）`;
  }
  if (!tile) {
    log(`  ⚠ 这张 PNG（${dec.w}×${dec.h}）的尺寸对不上 anim sheet 的版面公式（${cols}×${rows} 格）。`);
    log(`     正在退回"按 ${cols}×${rows} 等分"——每格会带上相邻格与时刻标签的边。`);
    log(`     想对齐就明确给几何：--img x,y,w,h [--img-step dx,dy]（看 anim sheet 的 --cell 参数）。`);
    const dx = dec.w / cols, dy = dec.h / rows;
    tile = { x0: 0, y0: 0, w: Math.round(dx), h: Math.round(dy) };
    step = { dx, dy };
    how = '等分（几何没对上）';
  } else {
    log(`  接触表格子 ${Math.round(tile.w)}×${Math.round(tile.h)} @ (${Math.round(tile.x0)},${Math.round(tile.y0)})，步距 (${Math.round(step.dx)},${Math.round(step.dy)})`);
  }
  let clipped = 0;
  for (let i = 0; i < o.n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const sx0 = Math.round(tile.x0 + c * step.dx), sy0 = Math.round(tile.y0 + r * step.dy);
    const tw = Math.round(tile.w), th = Math.round(tile.h);
    if (sx0 < 0 || sy0 < 0 || sx0 + tw > dec.w || sy0 + th > dec.h) { clipped++; continue; }
    const x = pad + c * (cellW + pad);
    const y = HEADER_H + pad + r * (cellH + labelH + pad);
    const dw = Math.min(cellW, tw), dh = Math.min(cellH, th);
    for (let yy = 0; yy < dh; yy++) {
      const sy = Math.min(dec.h - 1, sy0 + Math.round((yy * th) / dh));
      const dy = y + labelH + yy;
      if (dy < 0 || dy >= H) continue;
      for (let xx = 0; xx < dw; xx++) {
        const sxp = Math.min(dec.w - 1, sx0 + Math.round((xx * tw) / dw));
        const si = (sy * dec.w + sxp) * 4, di = (dy * o.width + x + xx) * 4;
        canvas.px[di] = dec.rgba[si]; canvas.px[di + 1] = dec.rgba[si + 1];
        canvas.px[di + 2] = dec.rgba[si + 2]; canvas.px[di + 3] = 255;
      }
    }
    canvas.frame(x - 1, y + labelH - 1, dw + 2, dh + 2, C.frame);
  }
  if (clipped) log(`  ⚠ 有 ${clipped} 格落在图外，那些格留空。`);
  stripLabel = `复用接触表 ${path.basename(src.file)}（${how}；帧时刻须与 -n/--from/--to 一致）`;
  log(`  复用接触表切片 ${o.n} 格（源 ${dec.w}×${dec.h}）`);
}

/* ---- 音频面板 ---- */
const AY = HEADER_H + stripH() + GAP;          // 面板顶
const AY0 = AY + 22, AY1 = AY + AUDIO_H - 8;   // 波形区
const amid = (AY0 + AY1) / 2, ahalf = (AY1 - AY0) / 2 - 6;
canvas.rect(PX0, AY, plotW, AUDIO_H, C.panel, 1);
canvas.frame(PX0, AY, plotW, AUDIO_H, C.grid2, 1);

// 静音带（画在波形下面，半透明）
for (const s of an.silence) {
  const x0 = Math.max(PX0, mapX(s.t0)), x1 = Math.min(PX1, mapX(s.t1));
  if (x1 <= x0) continue;
  for (let x = Math.round(x0); x < Math.round(x1); x++) {
    for (let y = AY0; y <= AY1; y++) canvas.blend(x, y, C.silence, 0.30);
  }
}
// 音量基准（相对 p90 的 dB 才算得出"这一列有多响"）
const refDb = Math.max(an.p90, -30);
// 静音判据那条线（相对 p90 的 dB，映射和峰值条同一套）——"为什么这里算静音"当场可读
const thrY = amid - Math.round(clamp((silenceDb - (refDb - 42)) / 42, 0, 1) * ahalf);
{
  for (let x = PX0 + 1; x < PX1 - 1; x += 6) {
    for (let k = 0; k < 3; k++) canvas.blend(x + k, thrY, C.warn, 0.85);
    for (let k = 0; k < 3; k++) canvas.blend(x + k, 2 * amid - thrY, C.warn, 0.85);
  }
}
// 每秒网格
const tickStep = o.tick ?? niceStep(WINDOW);
for (let t = Math.ceil(o.from); t <= o.to + 1e-6; t++) {
  const x = mapX(t);
  const major = Math.abs(t / tickStep - Math.round(t / tickStep)) < 1e-6;
  canvas.vline(x, AY0, AY1, C.grid, 1);
  if (major) canvas.vline(x, HEADER_H, AY - 1, C.grid, 1);
}
// 零线
canvas.hline(amid, PX0 + 1, PX1 - 1, C.grid2, 1);

// 波形：① 原始 PCM 每列峰值（填充）② analyzePCM 的 rms 包络（亮线）
const dbPerCol = new Float32Array(plotW);
for (let c = 0; c < plotW; c++) {
  const ta = o.from + (c / plotW) * WINDOW, tb = o.from + ((c + 1) / plotW) * WINDOW;
  let i0 = Math.max(0, Math.floor(ta / an.dbWin)), i1 = Math.min(an.db.length, Math.ceil(tb / an.dbWin));
  let mx = -120;
  for (let i = i0; i < i1; i++) if (an.db[i] > mx) mx = an.db[i];
  dbPerCol[c] = mx;
}
for (let c = 0; c < plotW; c++) {
  const v = clamp((dbPerCol[c] - (refDb - 42)) / 42, 0, 1);   // p90−42dB .. p90 映射到 0..1
  const hh = Math.round(v * ahalf);
  const x = PX0 + c;
  for (let y = amid - hh; y <= amid + hh; y++) canvas.blend(x, y, C.wave, 0.75);
}
// rms 包络（analyzePCM 的输出，已按 0.995 分位归一化到 0..1）
// ⚠ 每一列都算一遍（相邻列之间**线性插值**）。早先那版只在"帧号变化"时才画，
//   于是帧号没变的那些列被 continue 掉，留下断线 + 打点状横线（看图能看出来）。
{
  const envH = (t) => {
    const f = t * an.envFps;
    const i = Math.floor(f);
    if (i < 0 || i >= an.env.length) return 0;
    const a = an.env[i], b = i + 1 < an.env.length ? an.env[i + 1] : a;
    return (a + (b - a) * (f - i)) * (ahalf - 2);
  };
  let prevH = envH(o.from);
  for (let c = 0; c <= plotW; c++) {
    const hh = envH(o.from + (c / plotW) * WINDOW);
    const x = PX0 + c;
    if (c > 0) {
      // 相邻两列之间把中间那一列补上（比值很小，但能消掉锯齿）
      const hi = (prevH + hh) / 2;
      canvas.blend(x - 1, amid - hi, C.waveHi, 0.65);
      canvas.blend(x - 1, amid + hi, C.waveHi, 0.65);
    }
    canvas.blend(x, amid - hh, C.waveHi, 0.95);
    canvas.blend(x, amid + hh, C.waveHi, 0.95);
    prevH = hh;
  }
}

/* ---- 标尺 ---- */
const RY = AY + AUDIO_H;
canvas.rect(PX0, RY, plotW, RULER_H, C.bg, 1);
canvas.hline(RY, PX0, PX1, C.ruler, 1);
for (let t = Math.ceil(o.from / tickStep) * tickStep; t <= o.to + 1e-6; t += tickStep) {
  const x = mapX(t);
  canvas.vline(x, RY, RY + 9, C.ruler, 1);
  for (let s = 1; s < tickStep; s++) {
    const tm = t + s;
    if (tm > o.to) break;
    canvas.vline(mapX(tm), RY, RY + 4, C.grid2, 1);
  }
}
// 抽帧时刻的刻度（与接触表每一格竖直对齐）
for (const t of times) canvas.vline(mapX(t), RY, RY + 14, C.dim, 1);
canvas.hline(RY + RULER_H - 1, PX0, PX1, C.ruler, 1);

/* ---- 词标签（筛 + 防重叠） ---- */
/** @type {{t0:number,t1:number,text:string}[]} */
const words = [];
if (narration?.lines) {
  for (const l of narration.lines) {
    for (const w of (l.words ?? [])) {
      const t0 = Number(w.start), t1 = Number(w.end);
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
      if (t1 <= o.from || t0 >= o.to) continue;
      if (t1 - t0 < labelMin) continue;
      words.push({ t0, t1, text: String(w.w ?? '').trim() });
    }
  }
  words.sort((a, b) => a.t0 - b.t0);
}
const LABEL_FS = 20;
/**
 * 词标签的选择与防重叠 —— 规则照抄外部参考项目 `timeline_view.py`：
 * 只画时长 ≥ `--label-min`（默认 0.05s）的词，且与前一个标签横向间隔 ≥ `--label-gap`（默认 28px）。
 * 一个字占的横向宽度我按"中文字 = 1em / 拉丁 = 0.58em"估（`textWidth`），
 * 所以 `--label-gap` 是**标签框之间**的空隙，和对方的"中心距"不完全等价 —— 紧一点。
 */
/** @type {{x:number,row:number,text:string,t0:number,t1:number}[]} */
const placed = [];
let rowEnd = [-1e9, -1e9];
for (const w of words) {
  const cx = mapX((w.t0 + w.t1) / 2);
  const tw = textWidth(w.text, LABEL_FS * 0.98) + 8;
  let row = -1;
  for (let r = 0; r < LABEL_ROWS; r++) if (cx - tw / 2 >= rowEnd[r] + labelGap) { row = r; break; }
  if (row < 0) continue;
  rowEnd[row] = cx + tw / 2;
  placed.push({ x: cx - tw / 2, row, text: w.text, t0: w.t0, t1: w.t1 });
}
const dropped = words.length - placed.length;

/* ---- 文字层（交给 libass） ---- */
/** @type {{x:number,y:number,size:number,color:string,text:string,bold?:boolean,spacing?:number}[]} */
const texts = [];
const PADX = 18;

// 标题 + 元信息
const TITLE = `sheet-audio · ${task} · ${o.from.toFixed(2)}–${o.to.toFixed(2)}s`;
const NAR_PROV = narProv
  ? `NARRATION ${narProv.file}（${narProv.lines} 句 · ${narProv.mtime} · ${narProv.sha1}）`
  : `NARRATION 无（tasks/${task}/audio/narration.json 不存在 → 这张图**没有**词级标签）`;
const META = `VIDEO ${src.label}   ·   ${o.n} 帧 (${cols}×${rows} @ ${cellW}px)   ·   ${stripLabel}`;
const AUDIO_LINE = `AUDIO ${track.name} [${track.kind}] ${path.relative(ROOT, track.file).replace(/\\/g, '/')}` +
  `   ·   包络 analyzePCM @ ${sr}Hz → ${an.envFps.toFixed(1)} 帧/s   ·   静音 <${silenceDb}dB 且 ≥${minSilence}s`;
texts.push({ x: M, y: 18, size: 34, color: '#e8f2f7', text: TITLE, bold: true });
texts.push({ x: M, y: 58, size: 18, color: '#8ea3ad', text: META });
// 这一行单独放右侧下方易读位置
texts.push({ x: M, y: AY + 4, size: 17, color: track.kind === 'music' ? '#ffb168' : '#8ff08a', text: AUDIO_LINE });
// 旁白表的来历 —— 词标签是从哪一份数据来的（重跑过 anim say 的话，旧图一眼可辨）
texts.push({ x: PX1 - textWidth(NAR_PROV, 15) - 2, y: 24, size: 15, color: narProv ? '#6f7d87' : '#ffb168', text: NAR_PROV });

// 每一格的抽帧时刻
for (let i = 0; i < o.n; i++) {
  const x = pad + (i % cols) * (cellW + pad);
  const y = HEADER_H + pad + Math.floor(i / cols) * (cellH + labelH + pad);
  texts.push({ x: x + 3, y: y + 2, size: 17, color: '#cfdae1', text: `#${i}  ${times[i].toFixed(2)}s` });
}

// 标尺数字
for (let t = Math.ceil(o.from / tickStep) * tickStep; t <= o.to + 1e-6; t += tickStep) {
  const s = `${Math.abs(t % 60) < 1e-6 ? tmmss(t) : t.toFixed(tickStep < 1 ? 1 : 0) + 's'}`;
  texts.push({ x: mapX(t) + 3, y: RY + 11, size: 18, color: '#a9b7c0', text: s });
}

// 词标签 + 引导线（引导线画在底图上，字交给 libass）
// 引导线从**标尺底**竖下来直到该行标签顶端 —— 这样"这个词对应波形哪一段"一眼可循，
// 不用在脑子里数像素；两个字以上还会在词的首尾各点一个小刻度 = 这个词的时长范围。
const LY = RY + RULER_H;
for (const p of placed) {
  const tw = textWidth(p.text, LABEL_FS * 0.98);
  const cx = p.x + tw / 2 + 4;
  const rowTop = LY + p.row * LABEL_H;
  canvas.vline(cx, RY + RULER_H - 6, rowTop + 2, C.dim, 0.6);
  const xs = mapX(p.t0), xe = mapX(p.t1);
  if (xe - xs > 3) {
    canvas.vline(xs, rowTop - 1, rowTop + 2, C.waveHi, 0.5);
    canvas.vline(xe, rowTop - 1, rowTop + 2, C.waveHi, 0.5);
  }
  texts.push({ x: p.x, y: rowTop + 3, size: LABEL_FS, color: '#d7e3ea', text: p.text });
}

// 图例
const LGY = LY + LABEL_ROWS * LABEL_H + 10;
const totalSil = an.silence.reduce((s, x) => s + (x.t1 - x.t0), 0);
canvas.rect(PX0, LGY - 8, 12, 12, C.silence, 0.85);
canvas.frame(PX0, LGY - 8, 12, 12, C.grid2, 1);
// 该轨在这个窗口里的噪声底：**没有静音带时这句就是解释**
const belowFrac = an.inWin.reduce((s, v) => s + (v < silenceDb ? 1 : 0), 0) / Math.max(1, an.inWin.length);
texts.push({
  x: PX0 + 20, y: LGY - 12, size: 17, color: '#93a3ad',
  text: `shaded bands = silences ≥ ${(minSilence * 1000).toFixed(0)}ms below ${silenceDb}dBFS（${an.silence.length} 条，共 ${totalSil.toFixed(1)}s）` +
    `  ·  dashed line = ${silenceDb}dBFS on the same scale` +
    `  ·  this window: p90 ${an.p90.toFixed(1)} / p1 ${an.p1.toFixed(1)}dBFS, ${(belowFrac * 100).toFixed(1)}% of 20ms windows below threshold`,
});
canvas.rect(PX0, LGY + 10, 12, 6, C.wave, 0.75);
canvas.rect(PX0, LGY + 12, 12, 2, C.waveHi, 0.95);
texts.push({
  x: PX0 + 20, y: LGY + 6, size: 17, color: '#93a3ad',
  text: `waveform: filled = raw PCM peak (per column, ref p90 ${an.p90.toFixed(1)}dBFS)  ·  line = analyzePCM rms envelope  ·  ruler ticks = the ${o.n} sampled frames`,
});
const nu = Math.min(placed.length, 999);
texts.push({
  x: PX1 - textWidth(`words: ${words.length} in window, ${placed.length} drawn (${dropped} dropped: <${(labelMin * 1000).toFixed(0)}ms or <${labelGap}px apart)`, 17) - 2,
  y: LGY + 6, size: 17, color: '#93a3ad',
  text: `words: ${words.length} in window, ${nu} drawn (${dropped} dropped: <${(labelMin * 1000).toFixed(0)}ms or <${labelGap}px apart)`,
});
// 上/下边界时间戳（贴在面板两端，避免有人以为横轴是 0..N）
texts.push({ x: PX0 + 2, y: AY + AUDIO_H - 22, size: 16, color: '#66757e', text: `${o.from.toFixed(2)}s` });
texts.push({ x: PX1 - 62, y: AY + AUDIO_H - 22, size: 16, color: '#66757e', text: `${o.to.toFixed(2)}s` });

/* ---- 落盘 ---- */
const outPath = path.resolve(ROOT, o.out ?? path.join('out', task,
  `sheet-audio_${o.from}-${o.to}_${track.name}.png`));
mkdirSync(path.dirname(outPath), { recursive: true });
const stamp = `${task}_${o.from}-${o.to}`;
const basePng = keep ? outPath.replace(/\.png$/i, '-base.png') : path.join(tmpDir, 'base.png');
const textPng = keep ? outPath.replace(/\.png$/i, '-text.png') : path.join(tmpDir, 'text.png');
// ⚠ ASS 必须待在 `workDir` 里，`fontsdir` 才能用相对路径（见上面 fontsdir 那段注释）
const assPath = keep ? outPath.replace(/\.png$/i, '.ass') : path.join(workDir, `_tmp-${stamp}.ass`);
writeFileSync(basePng, encodePNG(canvas.px, o.width, H));
writeFileSync(assPath, makeASS(texts, o.width, H), 'utf8');

// 文字层：libass 渲染到黑底 -> colorkey 抠黑
{
  const r = run([...ffmpegArgv(), '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=${o.width}x${H}:d=0.10:r=10`,
    '-vf', `subtitles=filename=${path.relative(workDir, assPath).replace(/\\/g, '/')}:fontsdir=${fontsDirArg}`,
    '-frames:v', '1', '-update', '1', '-y', textPng,
  ], { cwd: workDir });
  if (r.status !== 0) {
    die(`文字层渲染失败（libass，cwd=${workDir}，fontsdir=${fontsDirArg}）：\n` +
        r.stderr.trim().split(/\r?\n/).slice(-8).join('\n'));
  }
}
// 合成：colorkey 掉黑底，叠在底图上
{
  const r = run([...ffmpegArgv(), '-v', 'error',
    '-loop', '1', '-framerate', '10', '-i', basePng,
    '-loop', '1', '-framerate', '10', '-i', textPng,
    '-filter_complex', '[1:v]colorkey=0x000000:0.10:0.02[k];[0:v][k]overlay=0:0:format=rgb,format=rgb24[out]',
    '-map', '[out]', '-frames:v', '1', '-update', '1', '-y', outPath,
  ]);
  if (r.status !== 0) die(`合成失败：\n${r.stderr.trim().split(/\r?\n/).slice(-6).join('\n')}`);
}
if (!keep) {
  rmSync(tmpDir, { recursive: true, force: true });
  if (assPath.startsWith(workDir)) rmSync(assPath, { force: true });
}

/* ---- 输出 ---- */
const rel = path.relative(ROOT, outPath).replace(/\\/g, '/');
const stat = existsSync(outPath) ? readFileSync(outPath).length : 0;
if (o.json) {
  process.stdout.write(JSON.stringify({
    out: outPath, file: rel, bytes: stat, width: o.width, height: H,
    window: [r340(o.from), r340(o.to)], frames: o.n, cells: [cols, rows],
    video: src, audio: { track: track.name, kind: track.kind, file: path.relative(ROOT, track.file).replace(/\\/g, '/'), sr, envFps: r340(an.envFps) },
    silences: an.silence.map((s) => [r340(s.t0), r340(s.t1)]),
    silenceThresholdDb: silenceDb, minSilence,
    wordsInWindow: words.length, labelsDrawn: placed.length, labelsDropped: dropped,
    narration: narProv,
  }, null, 2) + '\n');
} else {
  log(`\n✓ ${rel}  (${o.width}×${H}, ${(stat / 1024).toFixed(0)} KB)`);
  log(`  ${o.n} 帧 ${cols}×${rows} @ ${cellW}px  ·  静音带 ${an.silence.length} 条  ·  ` +
      `词标签 ${placed.length}/${words.length}（省略 ${dropped}）`);
  log(`  ⚠ 只在决策点调用，不拿它当扫描工具。看图：用 Read 工具打开上面这个 PNG。`);
}
process.exit(0);
