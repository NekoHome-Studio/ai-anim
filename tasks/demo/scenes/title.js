// 场景 1：标题。演示——逐字入场 + 生长的矢量线 + 一整帧 GLSL 背景。
// 画面全在镜头模板里（A 档镜头库 `src/shots/title.js`），这里只给内容。
// 想改视觉：改模板，或者照 `src/shots/` 的写法手写一个场景（两者能混在同一条时间线里）。
import { shot } from '../../../src/shots/index.js';

export default shot('title', {
  eyebrow: 'ANIM / CODE-RENDERED MOTION',
  title: '写代码，就是做动画',
  sub: 'deterministic · seekable · motion-blurred by averaging sub-frames',
});
