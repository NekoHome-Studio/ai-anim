// 场景 2：同心圆 + 三条频段。演示——用「每拍一次」的脉冲做节奏感。
// 画面在镜头模板 `src/shots/pulse.js` 里（它用 music.nearestBeat / music.hit 找打击事件）。
import { shot } from '../../../src/shots/index.js';

export default shot('pulse', {
  title: '节奏不需要手抄',
});
