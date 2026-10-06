// 标定场景 2：验证场景级变换 ctx.setXform 与 post.center（zoom 锚点）。
// 画面构成（全部是 t 的纯函数）：
//   · 细网格 + 十字参考线（用来肉眼判断有没有整体平移/缩放/旋转）
//   · 左上角一个实心白点（屏幕上唯一的高亮标记，用来量位移）
// t 段（每段 1 秒）：
//   0-1 静止；1-2 右移+下移；2-3 绕中心放大 1.25；3-4 绕左上角缩小 0.8；4-5 旋转 8°
import { css } from '../../../src/core/util.js';

export default {
  id: 'xf',
  render(ctx) {
    const { f, gl, P, lines, text, type, comp } = ctx;
    const { W, H } = gl;
    const t = f.lt;

    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

    lines.begin();
    // 每 120px 一条网格
    for (let x = 0; x <= W; x += 120) lines.seg(x, 0, x, H, 1, [P.graphite[0] * 0.5, P.graphite[1] * 0.5, P.graphite[2] * 0.5]);
    for (let y = 0; y <= H; y += 120) lines.seg(0, y, W, y, 1, [P.graphite[0] * 0.5, P.graphite[1] * 0.5, P.graphite[2] * 0.5]);
    // 中心十字 + 四角方框（判断缩放/旋转）
    lines.seg(W / 2 - 40, H / 2, W / 2 + 40, H / 2, 3, P.signal);
    lines.seg(W / 2, H / 2 - 40, W / 2, H / 2 + 40, 3, P.signal);
    lines.rect(60, 60, W - 120, H - 120, 4, P.bone);
    // 唯一的高亮标记：左上角一个实心点（用一段极短粗线画）
    lines.seg(200, 200, 201, 200, 26, [3, 3, 3]);
    lines.flush(ctx.out);

    // 场景级变换（1s 一段）
    if (t >= 1 && t < 2) {
      const k = Math.min(1, (t - 1) / 0.6);
      ctx.setXform({ x: 240 * k, y: 120 * k });
    } else if (t >= 2 && t < 3) {
      const k = Math.min(1, (t - 2) / 0.6);
      ctx.setXform({ scale: 1 + 0.25 * k });
    } else if (t >= 3 && t < 4) {
      const k = Math.min(1, (t - 3) / 0.6);
      ctx.setXform({ scale: 1 - 0.2 * k, anchor: [0, 0] });
    } else if (t >= 4) {
      const k = Math.min(1, (t - 4) / 0.6);
      ctx.setXform({ rot: 0.14 * k, scale: 1 - 0.1 * k });
    }

    // 后处理锚点：t>=5 时绕 (200,200)（也就是那个白点）推近
    const post = {
      bloom: 0, halation: 0, grain: 0, vignette: 0, shoulder: 1000,
      exposure: 1, contrast: 1, saturation: 1, lift: 0,
      zoom: 1, center: null,
    };
    if (t >= 5) {
      const k = Math.min(1, (t - 5) / 0.6);
      post.zoom = 1 + 0.5 * k;
      post.center = [200, 200];
    }

    // 角落读一个字，确认文字也跟着 xform 一起走
    text.clear();
    type.write('XFORM', W - 260, H - 100, { size: 64, weight: 800, family: 'mono', color: css(P.signal) });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return post;
  },
};
