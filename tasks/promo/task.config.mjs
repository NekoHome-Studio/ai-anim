import { seq, cut } from '../../src/timeline.js';
import caret from './scenes/caret.js';
import code from './scenes/code.js';
import engine from './scenes/engine.js';
import lattice from './scenes/lattice.js';
import frames from './scenes/frames.js';
import title from './scenes/title.js';

/**
 * promo —— 引擎的一支宣传片：**一镜到底，48 秒，零剪辑**。
 *
 * 分镜与设计写在 `SCRIPT.md`，屏幕上每一句话的出处写在 `FACTS.md`。
 *
 * 三条纪律（和 `tasks/pdoom-lab` 一样，见 docs/STATUS.md §13.1）：
 *   ① 六段全部 `overlap: 0`（硬切），**不使用 handlesTransition / ctx.under** ——
 *      "一镜到底"不是转场做出来的，是「一个世界 + 一台摄影机 + 一个母题」做出来的；
 *   ② 段长全是整数拍（120bpm，一拍 0.5s），切点落在拍上；
 *   ③ 六段读的是 `scenes/_world.js` 里**同一个** `camAt(t)` 与同一个世界坐标。
 */
export default {
  title: 'anim · 写代码，就是做动画',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,

  palette: {
    ink: '#04070b',        // 背景（比纯黑略偏蓝，泛光起来才不会脏）
    ink2: '#0a141c',       // 面板
    graphite: '#33454f',   // 次要线条
    ash: '#93a9b4',        // 弱化文字
    bone: '#e9f5f9',       // 正文/纸
    signal: '#2ee6ff',     // 唯一的信号色：光标、门、火花、被点亮的东西
    ember: '#ffb168',      // 只在落版出现一次（机器世界的尽头是一点暖色）
    blood: '#7c1d12',
    acid: '#c6ff4a',
  },

  audio: './audio/bed.mp3',

  // 任务自带字体（数组形式：`loadTaskFonts` 会对每个文件做 `document.fonts.load`
  // 强制预取，首帧一定拿得到字形；CSS 文件那条路不保证，见 src/app.js）。
  // ⚠ 场景里**不要**用 `family: 'sans'` —— 它第一个是 'Archivo'（本任务没有），
  //   拉丁字会一路掉回微软雅黑；用下面的 Inter / IBM Plex Mono 串。
  fonts: [
    { file: './fonts/inter-latin-400.woff2', family: 'Inter', weight: '400' },
    { file: './fonts/inter-latin-600.woff2', family: 'Inter', weight: '600' },
    { file: './fonts/inter-latin-800.woff2', family: 'Inter', weight: '800' },
    { file: './fonts/ibm-plex-mono-latin-400.woff2', family: 'IBM Plex Mono', weight: '400' },
    { file: './fonts/ibm-plex-mono-latin-600.woff2', family: 'IBM Plex Mono', weight: '600' },
    { file: './fonts/noto-sans-sc-subset.woff2', family: 'Noto Sans SC', weight: '100 900' },
  ],

  timeline: seq([
    cut(caret, { dur: 6.0, maxSamples: 10, note: '黑场 · 光标打字出 render(t) · 走廊在最后长出来' }),
    cut(code, { dur: 10.0, maxSamples: 10, note: '冲进代码走廊（投影线段批 + 逐字 3D 文字）' }),
    cut(engine, { dur: 10.0, maxSamples: 8, note: '穿过门 → SDF 大厅（raymarch + 排线 + 体积光）' }),
    cut(lattice, { dur: 10.0, maxSamples: 8, note: '无限晶格隧道（同一份 SDF 的下一段世界）' }),
    cut(frames, { dur: 6.0, maxSamples: 10, note: '帧墙：agent 看图的循环' }),
    cut(title, { dur: 6.0, maxSamples: 12, note: '落版：写代码，就是做动画' }),
  ]),
};
