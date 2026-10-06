// @ts-check
/**
 * 段 3 · `engine`（16.0 – 26.0s）—— 穿过门，进入引擎的大厅。
 *
 * 这一段与段 4 是**同一个 SDF 世界**（`_sdf.js`）：摄影机从走廊扎进门里（`z=−22`），
 * 在大厅里横移、抬升，看清两排柱子和每一跨的横梁；到 26s 时正好停在大厅尽头
 * —— 那里就是晶格隧道的入口，段 4 从同一个位置继续往前飞，中间没有剪辑点。
 *
 * 事实文案（「没有扩散模型」这一组）的出处见 FACTS.md。
 */
import {
  SEG, cam3At, grade, motifAt, postAt, timecodeHud, zAt,
} from './_world.js';
import { makeSdfPass, sdfUniforms } from './_sdf.js';
import { clamp, prog, sat } from '../../../src/core/util.js';

/** 这一段屏幕上出现的事实（措辞逐字来自 README / docs，出处见 FACTS.md）。 */
const FACTS = [
  { t0: 17.4, t1: 21.0, zh: '没有扩散模型', mono: '// README.md' },
  { t0: 21.4, t1: 25.6, zh: '每一个像素，都是算出来的', mono: '// WebGL2 着色器 + 几何，实时' },
];

export default {
  id: 'engine',

  setup(ctx) {
    this.pass = makeSdfPass(ctx.gl, ctx.P);
  },

  render(ctx) {
    const { f, gl, P, lines, text, type, comp, W, H } = ctx;
    const t = Number(ctx.params?.useT ?? f.t);
    const cam3 = cam3At(t, H);
    const m = motifAt(t);
    const lt = t - SEG.engine.at;
    const p = prog(t, SEG.engine.at, SEG.engine.at + SEG.engine.dur);

    // 光柱：刚进门时最强（阳光从穹顶打下来），随后收敛
    const shaft = 0.55 + 0.75 * Math.exp(-Math.max(0, lt) / 4.5);
    // 踩拍：踢鼓让整个大厅亮一下（幅度很小，是"呼吸"不是"闪光"）
    const beat = sat((f.a?.kick ?? 0) * 1.1);

    this.pass.set(sdfUniforms(cam3, {
      spark: m.p,
      sparkLit: m.lit,
      dim: 1 + 0.06 * beat,
      shaft,
      dbg: Number(ctx.params?.dbg ?? 0),
    })).render(gl, ctx.out, t, f.dt);

    /* ---- 矢量层 ---------------------------------------------------- */
    // 这一段整帧都由 SDF 铺满（`check` 的整帧覆盖就是它），矢量层留空 ——
    // 不画比乱画好：raymarch 的画面里再叠线会脏。
    lines.begin();
    lines.flush(ctx.out);

    /* ---- 文字层 ---------------------------------------------------- */
    text.clear();
    for (const it of FACTS) {
      const a = Math.min(prog(t, it.t0, it.t0 + 0.6, 'outCubic'), 1 - prog(t, it.t1, it.t1 + 0.5, 'inQuad'));
      if (a <= 0.01) continue;
      // 稍微偏上，别压住柱子的透视线
      const y = H * 0.30;
      type.writeLine(it.zh, W / 2, y, {
        anchor: 'center', size: 92, weight: 800, family: "'Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
        tracking: 4, color: P.css('bone', 0.97 * a),
      });
      type.writeLine(it.mono, W / 2, y + 78, {
        anchor: 'center', size: 27, family: 'mono', tracking: 3,
        color: P.css('signal', 0.8 * a),
      });
    }
    // 章节标题
    const capA = prog(t, SEG.engine.at + 0.6, SEG.engine.at + 1.4, 'outCubic');
    if (capA > 0.01) {
      type.write('02 / 世界在里面', 54, H - 104, {
        size: 30, family: 'mono', weight: 600, baseline: 'alphabetic', tracking: 4,
        color: P.css('bone', 0.8 * capA),
      });
    }
    timecodeHud(ctx, f, { label: 'render(t)', alpha: 0.34 });
    text.upload();
    comp.draw(gl, text, ctx.out, { premult: false });

    void p;
    // 段末把亮度收回到与段 4 起点完全一致的值（`grade` 是连续函数，这里只加文本相关的小量）
    return postAt(f, grade(t));
  },
};
