// @ts-check
/**
 * C 段：**Three.js 镜头** —— B 段那个实心盒子"碎成" 80 个单元（实例化 + 雾 + 呼吸）。
 *
 * 这一段要证明的是 Three.js 相对引擎自带那两种 3D 的真正差别：
 *   · **实例化**：80 个盒子一次 draw call，单元数再多也不怕（科普片里"很多个同样的东西"是常态）；
 *   · **真深度 + 雾**：前后关系由 z-buffer 决定，远处的单元融进背景，不需要自己排序；
 *   · 与 B 段**同一个世界、同一台摄影机、同一个包围盒** —— 所以"碎开"这件事
 *     看起来是同一个物体在变形，而不是切了一个镜头。
 */
import { makeThreeShot } from '../../../src/kit/index.js';
import { css, prog, sat } from '../../../src/core/util.js';
import { BOX, CELLS, CENTER, camAt, titleScrim, worldPoint } from './_stage.js';

const NX = CELLS.x, NY = CELLS.y, NZ = CELLS.z;
const COUNT = NX * NY * NZ;

export default makeThreeShot('lab_lattice', {
  background: 'over',
  camera: { fov: 34, pos: camAt(0).pos, target: CENTER },
  bridge: { alpha: true },

  async setup(ctx, api) {
    const { THREE, scene, palette } = api;
    scene.fog = new THREE.Fog(palette('ink'), 8, 24);

    scene.add(new THREE.HemisphereLight(palette('bone', 0.42), palette('ink'), 1.5));
    const key = new THREE.DirectionalLight(palette('bone', 2.2), 2.8);
    key.position.set(5.5, 9, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(palette('ember', 1.5), 0.55);
    rim.position.set(-6.5, 2.5, -6);
    scene.add(rim);

    const cw = (BOX.w / NX) * 0.58, ch = (BOX.h / NY) * 0.58, cd = (BOX.d / NZ) * 0.58;
    const geo = new THREE.BoxGeometry(cw, ch, cd);
    const mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ color: palette('graphite', 0.9), roughness: 0.6, metalness: 0.12 }),
      COUNT,
    );
    // 每帧都要改矩阵；关掉视锥剔除，免得包围球没跟上把整批剔掉（踩过就很安静：一片空白）
    mesh.frustumCulled = false;
    scene.add(mesh);

    /** 预计算每个单元的局部坐标（-0.5..0.5）+ 一个固定相位（用 rng，不用 Math.random） */
    const rnd = ctx.rng(7);
    this.cells = [];
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NY; j++) {
        for (let k = 0; k < NZ; k++) {
          this.cells.push({
            u: (i + 0.5) / NX - 0.5,
            v: (j + 0.5) / NY - 0.5,
            w: (k + 0.5) / NZ - 0.5,
            phase: rnd() * Math.PI * 2,
          });
        }
      }
    }
    this.mesh = mesh;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  },

  update(ctx, api) {
    const { f } = ctx;
    // 只吃 f.t / f.lt 的纯函数：散开进度 + 每个单元自己的呼吸（相位是 setup 里固定的）
    const spread = 1 + 0.24 * prog(f.lt, 0.25, 2.2, 'outCubic');
    const { _m: m, _p: p, _q: q, _s: s } = this;
    this.cells.forEach((c, i) => {
      const wave = Math.sin(f.lt * 1.15 - (c.u + c.v + c.w) * 3.4 + c.phase * 0.15);
      const k = 1 + 0.16 * wave;
      const pt = worldPoint(c.u * spread, c.v * spread + wave * 0.035, c.w * spread);
      p.set(pt[0], pt[1], pt[2]);
      s.set(k, k, k);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;

    const c = camAt(f.t);
    api.setCamera({ pos: c.pos, target: c.target, fov: c.fov });
  },

  overlay(ctx, h) {
    const { lines, text, type, comp, gl, P, W, H, f } = ctx;
    const a0 = prog(f.lt, 0.7, 1.6, 'outCubic');
    lines.begin();
    titleScrim(lines, P, W, 230, 0.68);
    // 一条竖线把盒子的上/下前角连起来：告诉观众"这是同一个盒子碎开的"
    const a = h.project(...worldPoint(0.5, -0.5, 0.5));
    const b = h.project(...worldPoint(0.5, 0.5, 0.5));
    if (a.visible && b.visible) {
      lines.circle(a.x, a.y, 5, 2.5, [P.signal[0], P.signal[1], P.signal[2], a0]);
      lines.circle(b.x, b.y, 5, 2.5, [P.signal[0], P.signal[1], P.signal[2], a0]);
      lines.seg(a.x, a.y, b.x, b.y, 1.6, [P.signal[0], P.signal[1], P.signal[2], a0 * 0.7]);
    }
    lines.flush(ctx.out);

    text.clear();
    type.writeLine('实例化真网格：一次 draw call 画 80 个单元', 96 + h.dx, 118 + h.dy, {
      size: 54, weight: 800, family: 'sans', color: css(P.bone), ...h.enter(0.15),
    });
    type.writeLine('真深度 · 真遮挡 · 雾 —— 前后关系由 z-buffer 决定，不用自己排序', 96 + h.dx, 166 + h.dy, {
      size: 27, weight: 400, family: 'sans', color: css(P.ash), ...h.enter(0.4),
    });
    if (a0 > 0.2) {
      type.writeLine(`${NX}×${NY}×${NZ} = ${COUNT} 个单元`, W - 96 + h.dx, H - 96 + h.dy, {
        anchor: 'right', size: 30, weight: 700, family: 'mono',
        color: css(P.signal, sat(a0)),
      });
    }
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    return { bloom: 0.3, grain: 0.02 };
  },
});
