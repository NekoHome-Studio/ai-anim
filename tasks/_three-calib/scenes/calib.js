// @ts-check
/**
 * 四象限标定：**朝向 + 颜色管线 + 叠字**一次全测。
 *
 * 做法是"自己和自己比"：
 *   · Three.js 把画面切成四块，各填一个**已知的线性色**（红/绿/蓝/0.5 灰）；
 *   · 引擎在每块里再画一个**内缩的同色矩形**（`lines.fillRect`，线性值同一套）；
 *   · 两者的边界除了一圈描边之外**不应该看得出来** —— 看得出来就说明
 *     两条颜色管线不在同一个空间（sRGB 当线性用、或者少了一次编码）。
 *
 * 朝向靠**颜色的位置**判：红必须在左上。上下颠倒 / 左右镜像都会立刻看出来
 * （所以四块的颜色与位置是**故意不对称**的：左上红、右上绿、左下蓝、右下灰）。
 *
 * ⚠ 这一帧必须**关掉所有后处理**：软肩（`shoulder`）会把线性 1.0 压到 0.945，
 *   颜色就对不上了。见 render() 的返回值。
 */
import { loadThree, getThreeBridge, linearColor } from '../../../src/core/three-bridge.js';
import { css } from '../../../src/core/util.js';

/** 四象限：位置 → 线性色。**不要**改成对称的（那样翻转就看不出来了）。 */
const QUADS = [
  { tag: 'TL', rgb: [1, 0, 0], note: '红 linear(1,0,0)' },
  { tag: 'TR', rgb: [0, 1, 0], note: '绿 linear(0,1,0)' },
  { tag: 'BL', rgb: [0, 0, 1], note: '蓝 linear(0,0,1)' },
  { tag: 'BR', rgb: [0.5, 0.5, 0.5], note: '灰 linear(0.5) → 应为 188' },
];

export default {
  id: 'calib',
  /** 标定帧不参与转场（也就不会被背景守门点名） */
  handlesTransition: false,

  async setup(ctx) {
    const THREE = await loadThree();
    this.THREE = THREE;
    // 标定不要 MSAA：边缘抗锯齿会污染取样点
    this.bridge = getThreeBridge(ctx, THREE, { antialias: false });
    this.scene = new THREE.Scene();
    const aspect = ctx.W / ctx.H;
    /** 正交相机：x ∈ [-aspect, aspect]、y ∈ [-1, 1]，一块 PlaneGeometry(aspect,1) 正好是四分之一屏 */
    this.camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    this.camera.position.z = 1;
    QUADS.forEach((q, i) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(aspect, 1),
        // MeshBasicMaterial = 不受光，颜色原样出去（标定要的就是"原样"）
        new THREE.MeshBasicMaterial({ color: linearColor(THREE, q.rgb), fog: false }),
      );
      m.position.set((i % 2 ? 1 : -1) * aspect * 0.5, (i < 2 ? 1 : -1) * 0.5, 0);
      this.scene.add(m);
    });
  },

  render(ctx) {
    const { W, H, gl, lines, text, type, comp, P, f } = ctx;

    // ① Three.js 画满整帧 → 上传 → 铺进 ctx.out（这一笔会被记成 paint.full）
    this.bridge.render(this.scene, this.camera);
    this.bridge.composite(gl, ctx.out, { t: f.t });

    const w = W / 2, h = H / 2, inset = 96;
    lines.begin();
    QUADS.forEach((q, i) => {
      const x = (i % 2) * w, y = (i >> 1) * h;
      // ② 引擎画的同色块（内缩一圈）+ 深色描边
      lines.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2, q.rgb);
      lines.rect(x + inset, y + inset, w - inset * 2, h - inset * 2, 2, P.ink);
    });
    // 画面中线：方向错了（比如整帧上下颠倒）一眼就能对出来
    lines.seg(W / 2, 0, W / 2, H, 2, P.ink);
    lines.seg(0, H / 2, W, H / 2, 2, P.ink);
    lines.flush(ctx.out);

    // ③ 文字叠在 Three.js 的画面之上（"3D 之上还能写字"这件事的现场证据）
    text.clear();
    QUADS.forEach((q, i) => {
      const x = (i % 2) * w + w / 2, y = (i >> 1) * h + h / 2;
      type.writeLine(`${q.tag} · ${q.note}`, x, y + 132, {
        anchor: 'center', size: 40, weight: 700, family: 'mono', color: css(P.ink),
      });
      type.writeLine('内圈 = 引擎画同色', x, y + 178, {
        anchor: 'center', size: 30, weight: 400, family: 'sans', color: css(P.ink),
      });
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    // 关掉全部后处理：标定要的是"原样"，尤其是 shoulder（0.85 会把 1.0 压到 0.945）
    return {
      bloom: 0, halation: 0, grain: 0, vignette: 0, ca: 0, radialBlur: 0, blur: 0,
      shoulder: 1, exposure: 1, saturation: 1, contrast: 1, lift: 0,
      flash: 0, fade: 0, zoom: 1, shake: [0, 0],
    };
  },
};
