// 标定场景 4：一根**不可能看不见**的矢量带子 + 一根细线。
// 用来在真实应用管线里判断 SCALE=2 时 LineBatch 到底出不出图。
//   粗带子：逻辑 (300,400)-(1620,400)，宽 80，纯白（>1 泛光）
//   细线  ：逻辑 (300,700)-(1620,700)，宽 2，信号色
export default {
  id: 'ribbon',
  render(ctx) {
    const { gl, P, lines } = ctx;
    gl.clear(ctx.out, [P.ink[0], P.ink[1], P.ink[2]]);
    lines.begin();
    lines.seg(300, 400, 1620, 400, 80, [1, 1, 1]);
    lines.seg(300, 700, 1620, 700, 2, P.signal);
    lines.flush(ctx.out);
    return { bloom: 0.2, grain: 0, vignette: 0, halation: 0, shoulder: 1000 };
  },
};
