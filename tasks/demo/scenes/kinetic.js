// 场景 3：动态文字 + GLSL 背景。演示——shader 域扭曲、逐字上浮、计数器阵列。
// 画面全在镜头模板里（A 档镜头库 `src/shots/kinetic.js`），这里只给两行大字与副标。
import { shot } from '../../../src/shots/index.js';

export default shot('kinetic', {
  headline: ['每一帧', '都是时间的函数'],
  sub: 'DETERMINISTIC / SEEKABLE / RE-RENDERABLE',
});
