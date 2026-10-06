// @ts-check
/**
 * 镜头模板：`outro` —— 片尾（极简收尾、细线动画、末尾淡出）。
 * 原场景：片尾。演示——极简收尾、细线动画、结尾淡出（用 post.fade 而不是切黑）。
 *
 * 绘制代码从 `tasks/demo/scenes/outro.js` **逐字**搬过来，只把内容变成参数 ——
 * 所以它与 demo 的原始画面逐像素一致（验收：`node scripts/anim.mjs hashes demo --baseline`）。
 * ⚠ 改这里的任何数值或绘制顺序都会改变已有任务的画面：改之前先跑一次 hashes 存基线。
 *
 * ```js
 * export default shot('outro', { title: '代码即素材' });
 * ```
 */

import { css, ease, prog } from '../core/util.js';

/** 全部参数 = "什么都不传时的画面"（demo 用的就是这一套）。 */
const DEFAULTS = {
  id: 'outro',
  title: '代码即素材',
  sub: '没有一张图片 · 没有一帧视频素材 · 全部由 GLSL 与几何生成',
  signature: 'anim · deterministic renderer',   // 末尾那个闪烁光标是代码加的，不要写进这个字符串
};

export function outroShot(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  return {
    id: o.id,

    render(ctx) {
      const { f, gl, P, text, type, comp, lines } = ctx;
      const { W, H } = gl;
      const t = f.lt;

      gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);

      // 一条细线从两侧收拢到中心，再展开成下划线
      const k = ease.inOutCubic(prog(t, 0.2, 1.6));
      const half = (W * 0.42) * (1 - k) + 260 * k;
      const y = H * 0.5 + 40;
      lines.begin();
      lines.seg(W / 2 - half, y, W / 2 + half, y, 2, P.graphite);
      // 中心刻度：每 40 px 一根
      for (let x = W / 2 - 260; x <= W / 2 + 260; x += 40) {
        const on = k > 0.98 && ((x / 40) | 0) % 2 === 0;
        lines.seg(x, y - (on ? 7 : 4), x, y + (on ? 7 : 4), 1.5, on ? P.signal : P.graphite);
      }
      lines.flush(ctx.out);

      text.clear();
      type.write(o.title, W / 2, H * 0.5 - 40, {
        size: 96, weight: 800, family: 'sans', align: 'center',
        color: css(P.bone), stagger: 0.11, staggerDur: 0.7, from: 'scale', dist: 0.35, t,
      });
      type.write(o.sub, W / 2, y + 84, {
        size: 26, family: 'mono', tracking: 2, align: 'center',
        color: css(P.ash), alpha: [0, 1], t: t - 1.2,
      });
      // 右下角签名 + 一个闪烁的光标
      const blink = Math.floor(t * 2) % 2 === 0 ? '█' : ' ';
      type.write(`${o.signature}${blink}`, W / 2, H - 90, {
        size: 22, family: 'mono', align: 'center', color: css(P.signal, 0.75),
      });
      text.upload();
      comp.draw(gl, text, ctx.out, { premult: false });

      const dur = f.end - f.start;
      return {
        bloom: 0.38,
        halation: 0.2,
        grain: 0.03,
        vignette: 0.45,
        // 结尾 0.6 秒压黑：比切黑更顺，也让最后帧不是突然的空白
        fade: Math.max(0, (t - (dur - 0.6)) / 0.6),
        exposure: 1 - 0.15 * prog(t, dur - 1.2, dur),
      };
    },
  };
}

outroShot.defaults = DEFAULTS;
outroShot.meta = {
  name: 'outro',
  summary: '片尾：从两侧收拢到中心的细线 + 每 40px 一根的刻度，标题按字放大落位、等宽副标整行淡入，右下角签名带一个闪烁光标，最后 0.6 秒压黑收尾。',
  notes: '结尾的淡出用 post 的 fade（在 render 里按段内时间算），不是切黑 —— 所以这段**别写太短**：'
    + '细线要 t=1.6 才收拢完，副标 t=1.2 才开始淡入，压黑发生在最后 0.6 秒；'
    + '段长（f.end - f.start）短于约 2 秒就会看到"还没写完就黑了"。'
    + 'signature 只写文字，末尾那个闪烁的光标（█ / 空格，按 Math.floor(t*2) % 2 交替）是代码加的，不要写进参数里。'
    + '这一段自己铺了整帧背景（gl.clear 到 P.ink），没有别的底。',
  // ⚠ params 的 name 集合必须与 DEFAULTS 的键集合**完全相等**（tools/test-shots.mjs 会断言）
  params: [
    { name: 'id', type: 'string', desc: '段名（HUD / --only / 报错里用它）' },
    { name: 'title', type: 'string', desc: '主标题（按字放大落位）' },
    { name: 'sub', type: 'string', desc: '下划线下面的等宽副标（整行淡入）' },
    { name: 'signature', type: 'string', desc: '右下角签名（末尾的闪烁光标由代码加，别写进来）' },
  ],
};
