// 标定场景 3：转场库（src/core/trans.js）的验收夹具。
// 两段共用同一层背景、同一台摄影机，交叠 0.6s，转场自己处理（handlesTransition）。
//   shotA：左上一块白色方块（好量位置）
//   shotB：右下三角色方块
// 判据（见 tools/probe-trans.mjs）：
//   · 交叠刚开始时画面上还应该是 A 的方块（被甩出去），不是两屏糊在一起
//   · 文字边缘必须保持锐利（方向拖尾只沿一个方向，不是全屏高斯模糊）
import { css } from '../../../src/core/util.js';
import { Pass } from '../../../src/core/gl.js';
import { makeTransitionKit, cameraPost, enterOffset } from '../../../src/core/trans.js';

/** 全片唯一的背景：参数只跟整片时间 f.t 走，所以切点两侧逐像素一致。 */
function world(ctx) {
  return new Pass(ctx.gl, /* glsl */ `
    void main() {
      vec2 p = FRAG_PX / RES_LOGICAL;
      vec3 col = mix(C_INK, C_INK2, smoothstep(0.0, 1.0, length(p - vec2(0.5, 0.45))));
      // 一道随整片时间横扫的亮线：切点时它在动，观众知道"镜头没停"
      float x = fract(t * 0.12);
      col += C_SIGNAL * 0.35 * exp(-pow((p.x - x) * 9.0, 2.0));
      fragColor = vec4(col, 1.0);
    }`, {}, { key: 'calib_world', blend: false });
}

function makeShot(id, side) {
  return {
    id,
    handlesTransition: true,
    setup(ctx) {
      this.tk = makeTransitionKit(ctx);
      this.world = world(ctx);
    },
    render(ctx) {
      const { f, gl, P, lines, text, type, comp } = ctx;
      const { W, H } = gl;
      const k = this.tk.openFrame(ctx, this.world);
      const [dx, dy] = enterOffset(f.t, k, 220);

      // 白方块：位置固定，方便 probe 量它被甩出去多少
      lines.begin();
      const bx = side === 'a' ? 260 : W - 460;
      const by = side === 'a' ? 220 : H - 420;
      lines.rect(bx, by, 200, 200, 8, [3, 3, 3]);
      lines.flush(ctx.out);

      // 大字：量边缘锐利度用（转场若是全屏模糊，这里的梯度会掉下来）
      text.clear();
      type.write(side === 'a' ? 'ALPHA' : 'BRAVO', bx + dx, by + 320 + dy, {
        size: 96, weight: 800, family: 'mono', color: css(P.bone),
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      return cameraPost(f.t, { bloom: 0.2, grain: 0, vignette: 0.3 });
    },
  };
}

export const shotA = makeShot('xa', 'a');
export const shotB = makeShot('xb', 'b');
