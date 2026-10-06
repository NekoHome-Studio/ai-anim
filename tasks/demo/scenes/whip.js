// 场景 4：甩镜转场。演示——handlesTransition + 用 ctx.under 拿上一段的成帧做自定义转场。
// 画面在镜头模板 `src/shots/whip.js` 里；**转场这件事仍然由时间线声明**：
//   cut(whip, { dur, overlap, handlesTransition: true })   ← 见 task.config.mjs
// 没有 overlap / under 时，模板会按「普通一帧」画（k = 1），不会报错。
import { shot } from '../../../src/shots/index.js';

export default shot('whip');
