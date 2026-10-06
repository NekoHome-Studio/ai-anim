// 临时标定任务：给 docs/HANDOFF.md 的色彩空间 / xform / post.center / 转场库 / 4K 核对用。
import { seq, cut } from '../../src/timeline.js';
import probe from './scenes/probe.js';
import xf from './scenes/xf.js';
import ribbon from './scenes/ribbon.js';
import { shotA, shotB } from './scenes/trans.js';

export default {
  title: '_calib',
  width: 1920, height: 1080, fps: 60, scale: 1,
  // 任务自带字体（P1-3 的验收）：不走全局 public/fonts/fonts.css
  fonts: [{ file: './fonts/BrandFont.woff2', family: 'BrandFont', weight: '600' }],
  timeline: seq([
    cut(probe, { dur: 3 }),
    cut(xf, { dur: 7 }),
    cut(ribbon, { dur: 2 }),
    // 转场验收：两段交叠 0.6s，第二段自己处理转场
    cut(shotA, { dur: 3 }),
    cut(shotB, { dur: 3, overlap: 0.6, handlesTransition: true }),
  ]),
};
