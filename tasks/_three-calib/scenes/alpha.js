// @ts-check
/**
 * alpha 段：**3D 浮在引擎画的背景之上**（`bridge.composite(..., { mode: 'over' })`）。
 *
 * 量的是"线性空间的 over"这一条：
 *   背景左半 = 线性 0.5 灰、右半 = 线性 0.25 灰（引擎用 lines 画，值精确已知）；
 *   上面盖一层 **红、opacity 0.5** 的平面（Three.js 用透明画布渲）；
 *   结果必须等于 `0.5·红 + 0.5·背景`（**在线性光里**）。
 *
 *   左半 = 0.75 → sRGB 225      右半 = 0.625 → sRGB 207
 *
 * 三种典型错误都会给出**不同的数字**，所以这一帧是一条真判据而不是"看着差不多"：
 *   · RGB 通道里存的是预乘值、又被乘了一次 alpha ⇒ 左半 188（暗一档）；
 *   · 混合发生在 sRGB 空间而不是线性空间 ⇒ 左半 (221,94,94)（G/B 差一截）。
 */
import { loadThree, getThreeBridge, linearColor } from '../../../src/core/three-bridge.js';
import { css } from '../../../src/core/util.js';

export default {
  id: 'alpha',
  handlesTransition: false,

  async setup(ctx) {
    const THREE = await loadThree();
    this.THREE = THREE;
    // ⚠ alpha: true 才会拿到带透明通道的画布
    this.bridge = getThreeBridge(ctx, THREE, { alpha: true, antialias: false });
    this.scene = new THREE.Scene();
    const aspect = ctx.W / ctx.H;
    this.camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    this.camera.position.z = 1;
    const mat = new THREE.MeshBasicMaterial({
      color: linearColor(THREE, [1, 0, 0]), transparent: true, opacity: 0.5, fog: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(aspect * 2, 2), mat));
  },

  render(ctx) {
    const { W, H, gl, lines, text, type, comp, P, f } = ctx;

    // ① 引擎先铺两块**值精确已知**的底色（half 左 0.5、右 0.25，线性）
    lines.begin();
    lines.fillRect(0, 0, W / 2, H, [0.5, 0.5, 0.5]);
    lines.fillRect(W / 2, 0, W / 2, H, [0.25, 0.25, 0.25]);
    lines.flush(ctx.out);

    // ② 半透明红**浮上去**（不是覆盖）：这一笔不算整帧覆盖，所以底必须自己铺 —— 上面就是
    this.bridge.render(this.scene, this.camera);
    this.bridge.composite(gl, ctx.out, { mode: 'over', t: f.t });

    // ③ 判据写在画面上：出图时人眼也能对
    text.clear();
    type.writeLine('底 线性0.5 + 红@0.5 → 期望 (225,137,137)', W * 0.25, 150, {
      anchor: 'center', size: 40, weight: 700, family: 'mono', color: css([1, 1, 1]),
    });
    type.writeLine('底 线性0.25 + 红@0.5 → 期望 (207, 99, 99)', W * 0.75, 150, {
      anchor: 'center', size: 40, weight: 700, family: 'mono', color: css([1, 1, 1]),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return {
      bloom: 0, halation: 0, grain: 0, vignette: 0, ca: 0, radialBlur: 0, blur: 0,
      shoulder: 1, exposure: 1, saturation: 1, contrast: 1, lift: 0,
      flash: 0, fade: 0, zoom: 1, shake: [0, 0],
    };
  },
};
