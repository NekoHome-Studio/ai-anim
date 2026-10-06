// @ts-check
/**
 * A 段：**Three.js 镜头** —— 分层板 + 分解视图 + 贴在 3D 点上的标签。
 *
 * 这一段要证明的三件事（都是写实科普片真正需要的能力）：
 *   ① 真深度与遮挡：板与板之间互相遮住，转起来前后关系是对的；
 *   ② 3D 之上还能写字：标签走引擎的 Canvas2D 图层，所以永远是清晰的（不受 3D 分辨率影响）；
 *   ③ 标签**贴在物体上**：`api.project()` 把世界点换成屏幕坐标，镜头一动标签跟着走。
 *
 * 背景用 `'over'`（透明画布 + 正常混合）：3D 浮在**引擎铺的那层共享网格**之上，
 * 背景是同一批像素 —— 这是"切镜头不跳"最硬的那一条。所以时间线上这一段要写 `world: 'auto'`。
 */
import { makeThreeShot } from '../../../src/kit/index.js';
import { css, prog, sat } from '../../../src/core/util.js';
import { BOX, CENTER, camAt, solidColor, titleScrim, worldPoint } from './_stage.js';

/** 四层板：文案是引擎自己的渲染链（都是 `AGENTS.md` 里写死的事实，不是编的） */
const LAYERS = [
  { label: '场景 render(t)', note: '每帧都是 t 的纯函数' },
  { label: '图层合成', note: '矢量 / 文字 / 3D 合成一层' },
  { label: '后处理', note: '泛光 · 颗粒 · 暗角 · 调色' },
  { label: 'NV12 推流', note: '每帧 3.11 MB → ffmpeg' },
];

export default makeThreeShot('lab_stack', {
  background: 'over',
  camera: { fov: 34, pos: camAt(0).pos, target: CENTER },
  bridge: { alpha: true },

  async setup(ctx, api) {
    const { THREE, scene, palette } = api;
    // 雾与清屏色都取调色板的 ink：远处融进背景，切镜头时"世界没换"
    scene.fog = new THREE.Fog(palette('ink'), 9, 26);

    // 灯光：一盏冷环境光 + 一盏骨白主光 + 一盏**很弱**的信号色轮廓光
    // （signal 是强调色，大面积用它片子就没有重点了 —— 见 _stage.js 的注释）
    scene.add(new THREE.HemisphereLight(palette('bone', 0.42), palette('ink'), 1.5));
    const key = new THREE.DirectionalLight(palette('bone', 2.2), 2.8);
    key.position.set(5.5, 9, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(palette('signal', 2.2), 0.9);
    rim.position.set(-6.5, 2.5, -6);
    scene.add(rim);

    /** 每层板 + 一圈描边（描边是 Three.js 的 EdgesGeometry，线宽固定 1px，正好是制图感） */
    this.slabs = LAYERS.map((cfg, i) => {
      const h = BOX.h / 6.4;
      const geo = new THREE.BoxGeometry(BOX.w, h, BOX.d);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: solidColor(palette, 0.55 + i * 0.14), roughness: 0.68, metalness: 0.08,
      }));
      mesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: palette('bone', 0.55 + i * 0.1) }),
      ));
      scene.add(mesh);
      // 预计算：这一层在盒子局部坐标里的 y（-0.5..0.5，**自上而下**与 LAYERS 同序），
      // 于是"最上面那块 = 第一步 render(t)"，右侧图例从上往下读就是渲染链的顺序（引线也不会交叉）
      return { cfg, mesh, v: 0.375 - i * 0.25 };
    });
    this._h = BOX.h / 6.4;
  },

  update(ctx, api) {
    const { f } = ctx;
    // ⚠ 只吃 t：分解进度与自转都写成 f.t / f.lt 的纯函数（子帧乱序也算得对）
    const explode = prog(f.lt, 0.5, 3.0, 'outCubic') * (1 - 0.25 * prog(f.lt, 4.4, 6.0, 'inOutCubic'));
    for (const s of this.slabs) {
      const v = s.v * (1 + explode * 0.62);
      s.mesh.position.set(CENTER[0], CENTER[1] + v * BOX.h, CENTER[2]);
      s.vNow = v;
    }
    const c = camAt(f.t);
    api.setCamera({ pos: c.pos, target: c.target, fov: c.fov });
  },

  overlay(ctx, h) {
    const { lines, text, type, comp, gl, P, W, f } = ctx;
    const a0 = prog(f.lt, 1.0, 1.9, 'outCubic');
    const items = [];

    lines.begin();
    titleScrim(lines, P, W, 230, 0.68);
    this.slabs.forEach((s, i) => {
      // 标签锚在**盒子的右上前角**：镜头一转，标签跟着走（这就是 project 的用处）
      const p = h.project(...worldPoint(0.52, s.vNow ?? s.v, 0.52));
      if (!p.visible) return;
      const a = sat(a0 * 1.8 - i * 0.16);
      if (a <= 0.01) return;
      // **图例式**排布：文字固定在右侧一列，引线连到物体上的点。
      // 为什么不用"点在字旁边"那种：镜头一转字就压到物体上了（第一版就是这样，读不清）。
      const lx = W - 470;
      const ly = 258 + i * 132;
      lines.seg(p.x, p.y, lx - 28, ly, 1.8, [P.signal[0], P.signal[1], P.signal[2], a * 0.8]);
      lines.circle(p.x, p.y, 5, 2.5, [P.signal[0], P.signal[1], P.signal[2], a]);
      lines.circle(lx - 28, ly, 3, 2, [P.bone[0], P.bone[1], P.bone[2], a * 0.75]);
      items.push({ lx, ly, a, cfg: s.cfg });
    });
    lines.flush(ctx.out);

    text.clear();
    items.forEach(({ lx, ly, a, cfg }) => {
      type.writeLine(cfg.label, lx + h.dx, ly - 8 + h.dy, {
        size: 36, weight: 700, family: 'sans', color: css(P.bone, a),
      });
      type.writeLine(cfg.note, lx + h.dx, ly + 30 + h.dy, {
        size: 23, weight: 400, family: 'sans', color: css(P.ash, a),
      });
    });
    type.writeLine('第 3 种 3D：真网格', 96 + h.dx, 118 + h.dy, {
      size: 58, weight: 800, family: 'sans', color: css(P.bone), ...h.enter(0.15),
    });
    type.writeLine('Three.js 画实体，引擎画文字 —— 同一帧、同一套后处理', 96 + h.dx, 168 + h.dy, {
      size: 27, weight: 400, family: 'sans', color: css(P.ash), ...h.enter(0.45),
    });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.32, grain: 0.02 };
  },
});
