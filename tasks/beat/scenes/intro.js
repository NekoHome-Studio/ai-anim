// 场景 1：波形。演示——用音频包络驱动画面，而不是靠手抄时间码。
// 画面在镜头模板 `src/shots/wave.js` 里（它读 ctx.music 的包络数组与 kick 事件）。
// 段名沿用原来的 `intro`：`--only intro`、`check` 的输出、hashes 基线里都是这个名字。
import { shot } from '../../../src/shots/index.js';

export default shot('wave', {
  id: 'intro',
  label: 'BEAT',
});
