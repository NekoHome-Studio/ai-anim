// 音乐任务：演示「画面踩在拍子上」。
// 音频是 scripts/make-demo-audio.mjs 生成的 120bpm 循环（无版权问题）。
// 首次渲染时 CLI 会自动分析音频，生成 audio/demo-loop.analysis.json（拍子/段落/包络）。
import { seq, cut } from '../../src/timeline.js';
import intro from './scenes/intro.js';
import pulse from './scenes/pulse.js';
import grid from './scenes/grid.js';

export default {
  title: 'beat · 音乐驱动演示',
  width: 1920,
  height: 1080,
  fps: 60,
  scale: 1,
  audio: './audio/demo-loop.mp3',

  // 时间线可以直接用秒，也可以用拍号（build 时用音频分析出来的 beat 网格解析）。
  // 这里全用拍号：120bpm 下 16 拍 = 8 秒，合计 32 秒 = 整段 demo 音频。
  timeline: seq([
    cut(intro, { dur: { beat: 24 }, note: '波形 + 鼓点' }),
    cut(pulse, { dur: { beat: 24 }, note: '同心圆 + 三条频段' }),
    cut(grid, { dur: { beat: 16 }, note: '频谱网格' }),
  ]),
};
