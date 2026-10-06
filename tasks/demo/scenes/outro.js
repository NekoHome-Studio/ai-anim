// 场景 5：片尾。演示——极简收尾、细线动画、结尾淡出（用 post.fade 而不是切黑）。
// 画面全在镜头模板里（A 档镜头库 `src/shots/outro.js`），这里只给三行字。
import { shot } from '../../../src/shots/index.js';

export default shot('outro', {
  title: '代码即素材',
  sub: '没有一张图片 · 没有一帧视频素材 · 全部由 GLSL 与几何生成',
  signature: 'anim · deterministic renderer',
});
