// 临时标定场景（不是片子）：清一个已知的线性色，用于核对导出的色彩空间编码。
// 约定：t=0 → 线性 (0.5, 0.25, 0.75)；t=1 → 线性 (0.05, 0.05, 0.05)；t=2 → 线性 (1,1,1)。
export default {
  id: 'probe',
  render(ctx) {
    const t = ctx.f.lt;
    const c = t < 0.5 ? [0.5, 0.25, 0.75] : t < 1.5 ? [0.05, 0.05, 0.05] : [1, 1, 1];
    ctx.gl.clear(ctx.out, c);
    return { bloom: 0, halation: 0, grain: 0, vignette: 0, shoulder: 1000, exposure: 1, contrast: 1, saturation: 1, lift: 0 };
  },
};
