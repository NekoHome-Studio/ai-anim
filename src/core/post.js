// @ts-check
/**
 * 后处理链。顺序是固定的，也是让画面「像片子而不像 demo」的关键：
 *
 *   场景 HDR ──▶ 亮部提取 ──▶ bloom 金字塔（4 级）  ┐
 *                    └─────▶ halation（偏红、更宽） ├─▶ 合成 ──▶ sRGB
 *   HUD/字幕层（线性）─┘                            ┘
 *
 * 合成阶段一次性做完：软肩压缩、曝光、色差、暗角、胶片颗粒、抖动。
 *
 * 经验值：只有「信号色」（信号橙、火花、被唱到的词）才允许超过 0.85 线性亮度去发光。
 * 骨白正文永远不要 bloom，否则像糊了一层油。
 */

import { Pass, RT } from './gl.js';

/** @typedef {import('./gl.js').GL} GL */

/**
 * @typedef {Object} PostParams
 * @property {number} exposure     曝光倍率（1 = 不变）
 * @property {number} shoulder     软肩起点：超过它的亮部被压回来（0.8 比较胶片）
 * @property {number} bloom        泛光强度
 * @property {number} bloomThreshold 进入泛光的亮度阈值（对 HDR 值）
 * @property {number} bloomRadius  泛光扩散半径倍率
 * @property {number} halation     光晕（偏红、更宽、只对极亮处）
 * @property {number} ca           色差（RGB 分离；whip pan / 冲击时用）
 * @property {number} grain        胶片颗粒
 * @property {number} vignette     暗角
 * @property {number} saturation   饱和度（1 = 不变）
 * @property {number} contrast     对比（围绕中灰）
 * @property {number} lift         黑位抬升（做褪色/雾感）
 * @property {number[]} tint       整体染色（线性 RGB 乘子）
 * @property {number} invert       反相（0/1，闪白用）
 * @property {number[]} shake      画面位移（**物理像素**，y 向下为正 —— ⚠ 与 `center` 的单位不同）
 *                                 shader 里是 `uv += shake / outSize`，而 `outSize = [gl.pw, gl.ph]`
 *                                 是**物理**分辨率，所以 `--scale 2`（4K）下同样数值的视觉位移只有
 *                                 1080p 的一半。要跨分辨率一致就自己乘 `scale`。
 *                                 （`docs/ENGINE.md` §5 的 post 表里写的就是这条；曾经这里的
 *                                 JSDoc 误写成"逻辑像素"，与实现矛盾 —— 见 IMPROVEMENTS-3 建议 D。）
 * @property {number} zoom         画面缩放（1 = 不变，>1 推近）
 * @property {number} flash        整帧加白（0..1）
 * @property {number} fade         整帧变黑（0..1）
 * @property {number} blur         全屏模糊（冲击用）
 * @property {number} radialBlur   径向模糊强度（向画面中心收缩）
 * @property {number[]} center     zoom / 径向模糊 / 色差的锚点，**逻辑像素、y 向下**（默认画面中心）。
 *                                 想做「绕某个元素推近」就把它设成那个元素的坐标。
 * @property {'off'|'agx'|'aces'} [tonemap] 高光滚降算子（默认 `'off'` = 只用下面的 `shoulder` 软肩）。
 *                                 `'agx'` 是 AgX（高光柔和滚降、亮霓虹不偏色，当前业界电影级默认）；
 *                                 `'aces'` 是 Narkowicz 的 ACES 拟合（更饱和、对比更硬）。
 *                                 ⚠ 开了之后 `shoulder` 不再生效（两者是同一位置的两种做法），
 *                                 而且**会改变画面** —— 老任务要么不写，要么就得重存 `hashes` 基线。
 * @property {'rpdf'|'tpdf'|'off'} [dither] 输出前的 8bit 抖动（默认 `'rpdf'` = 矩形分布，引擎一直以来的行为）。
 *                                 `'tpdf'` 是三角分布（两个均匀分布相加），去色带更干净、噪声感更弱。
 * @property {boolean} [bloomKaris] 泛光的亮部提取用 **Karis 加权平均**（`c/(1+luma(c))` 之后再还原）：
 *                                 极亮的单个像素不会在降采样时"炸"成一个方块（fireflies）。默认 `false` = 现状。
 * @property {'screen'|'design'} [grainScale] 颗粒撒在哪个栅格上（默认 `'screen'` = 物理像素，引擎一直以来的行为）。
 *                                 `'design'` 按**逻辑分辨率**撒 —— `--scale 2` 出 4K 时颗粒大小与 1080p 一致，
 *                                 跨分辨率观感才不变（否则 4K 的颗粒细一半）。
 */

/** 默认后处理参数。场景返回的 post 对象会与它合并。 */
export const DEFAULT_POST = /** @type {PostParams} */ ({
  exposure: 1,
  shoulder: 0.85,
  bloom: 0.35,
  bloomThreshold: 0.9,
  bloomRadius: 1,
  halation: 0.25,
  ca: 0.0,
  grain: 0.035,
  vignette: 0.35,
  saturation: 1.0,
  contrast: 1.0,
  lift: 0.0,
  tint: [1, 1, 1],
  invert: 0,
  shake: [0, 0],
  zoom: 1,
  center: null,
  flash: 0,
  fade: 0,
  blur: 0,
  radialBlur: 0,
  tonemap: 'off',
  dither: 'rpdf',
  bloomKaris: false,
  grainScale: 'screen',
});

const LEVELS = 4;

export class Post {
  /**
   * @param {GL} gl
   * @param {any} [palette] 必须和场景用同一个调色板，否则后处理里的 C_* 常量对不上
   */
  constructor(gl, palette = null) {
    this.gl = gl;
    this.palette = palette;
    this.params = { ...DEFAULT_POST };
    /** @type {{ a: RT, b: RT, bright: RT, hal: RT, halTmp: RT, halBlur: RT }[]} */
    this.chain = [];
    this.ok = false;
  }

  _build() {
    const gl = this.gl;
    const { pw, ph } = gl;
    if (this.ok && this.pw === pw && this.ph === ph) return;
    this.dispose();
    this.pw = pw; this.ph = ph;
    this.chain = [];
    let w = Math.max(1, pw >> 1), h = Math.max(1, ph >> 1);
    for (let i = 0; i < LEVELS; i++) {
      this.chain.push({
        a: new RT(gl, w, h),
        b: new RT(gl, w, h),
        bright: new RT(gl, w, h),
        hal: new RT(gl, w, h),
        halTmp: new RT(gl, w, h),
        halBlur: new RT(gl, w, h),
      });
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    this.combine = new RT(gl, pw, ph);
    this.final = new RT(gl, pw, ph);
    this._passes();
    this.ok = true;
  }

  _passes() {
    const gl = this.gl;
    const pal = { palette: this.palette };

    // 亮部提取（带软阈值），同时降采样
    // karis：采样时按 1/(1+luma) 加权、平均之后再还原 —— 一个极亮的孤立像素不会在降采样里
    // 独占一个格子（"fireflies"），泛光里就不会出现随帧跳动的方块。
    this.pBright = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform vec2 texel; uniform float threshold; uniform float knee; uniform float karis;
      vec3 tap(vec2 o) {
        vec3 s = texture(src, vUv + texel * o).rgb;
        return karis > 0.5 ? s / (1.0 + luma(s)) : s;
      }
      void main() {
        vec2 t = texel;
        // 4 抽样降采样（顺便抗闪烁）
        vec3 c = (tap(vec2(-0.5, -0.5)) + tap(vec2(0.5, -0.5))
                + tap(vec2(-0.5,  0.5)) + tap(vec2(0.5,  0.5))) * 0.25;
        if (karis > 0.5) c = c / max(1.0 - luma(c), 1e-3);
        float l = max(c.r, max(c.g, c.b));
        // 软阈值：threshold 以下为 0，threshold+knee 以上全过
        float k = max(knee, 1e-4);
        float w = clamp((l - threshold) / k, 0.0, 1.0);
        w = w * w * (3.0 - 2.0 * w);
        fragColor = vec4(c * w, 1.0);
      }`, { src: { value: null }, texel: [0, 0], threshold: 0.9, knee: 1.0, karis: 0 },
      { key: 'post_bright', blend: false, ...pal });

    // 可分离高斯模糊（9 抽样，sigma≈2.2）
    this.pBlur = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform vec2 dir; uniform float radius;
      void main() {
        vec2 d = dir * radius;
        vec3 c = texture(src, vUv).rgb * 0.2270270270;
        c += (texture(src, vUv + d * 1.3846153846).rgb + texture(src, vUv - d * 1.3846153846).rgb) * 0.3162162162;
        c += (texture(src, vUv + d * 3.2307692308).rgb + texture(src, vUv - d * 3.2307692308).rgb) * 0.0702702703;
        fragColor = vec4(c, 1.0);
      }`, { src: { value: null }, dir: [1, 0], radius: 1 },
      { key: 'post_blur', blend: false, ...pal });

    // 染色（halation 走偏红的一路）
    this.pTint = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform vec3 mul;
      void main() { fragColor = vec4(texture(src, vUv).rgb * mul, 1.0); }`,
      { src: { value: null }, mul: [1, 1, 1] }, { key: 'post_tint', blend: false, ...pal });

    // 金字塔向上合并
    this.pUp = new Pass(gl, /* glsl */ `
      uniform sampler2D src; uniform sampler2D add; uniform float k;
      void main() { fragColor = vec4(texture(src, vUv).rgb + texture(add, vUv).rgb * k, 1.0); }`,
      { src: { value: null }, add: { value: null }, k: 1 }, { key: 'post_up', blend: false, ...pal });

    // 场景 + 泛光 + 光晕
    this.pCombine = new Pass(gl, /* glsl */ `
      uniform sampler2D src;
      uniform sampler2D bloomTex;
      uniform sampler2D halTex;
      uniform float bloom, halation;
      void main() {
        vec3 c = texture(src, vUv).rgb;
        c += texture(bloomTex, vUv).rgb * bloom;
        c += texture(halTex, vUv).rgb * halation * vec3(1.0, 0.42, 0.22);
        fragColor = vec4(c, 1.0);
      }`, { src: { value: null }, bloomTex: { value: null }, halTex: { value: null }, bloom: 0.35, halation: 0.25 },
      { key: 'post_combine', blend: false, ...pal });

    // 最终调色 + 颗粒，转 sRGB 之前的一切都在这里
    this.pFinal = new Pass(gl, /* glsl */ `
      uniform sampler2D src;
      uniform vec2  outSize;      // 物理像素
      uniform vec2  designSize;   // 逻辑分辨率（grainScale 'design' 用）
      uniform float exposure, shoulder, ca, grain, vignette, saturation, contrast, lift, invert;
      uniform vec3  tint;
      uniform vec2  shake;
      uniform float zoom, flash, fade, blurAmt, radialBlur, seed;
      uniform vec2  center;
      uniform float tonemap, ditherMode, grainDesign;

      float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

      vec3 shoulderCurve(vec3 x, float k) {
        // 软肩：k 以下线性，以上指数压回来，保住高光层次而不是硬切
        vec3 a = max(x - k, vec3(0.0));
        return min(x, vec3(k)) + (1.0 - exp(-a / max(1.0 - k, 1e-3))) * (1.0 - k);
      }

      // AgX（Benjamin Wrensch 的 minimal 版）：高光柔和滚降，亮霓虹不偏色。
      // 输入是线性 HDR，输出是**线性显示值**（0..1），后面照常走 blitPass / readPixels 的 sRGB 编码。
      vec3 agxContrast(vec3 x) {
        vec3 x2 = x * x, x4 = x2 * x2;
        return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
      }
      vec3 tonemapAgX(vec3 v) {
        const mat3 m = mat3(
          0.842479062253094,  0.0423282422610123, 0.0423756549057051,
          0.0784335999999992, 0.878468636469772,  0.0784336,
          0.0792237451477643, 0.0791661274605434, 0.879142973793104);
        const mat3 mi = mat3(
           1.19687900512017,   -0.0528968517574562, -0.0529716355144438,
          -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,
          -0.0990297440797205, -0.0989611768448433,  1.15107367264116);
        const float lo = -12.47393, hi = 4.026069;
        v = clamp(log2(max(m * v, vec3(1e-10))), lo, hi);
        v = agxContrast((v - lo) / (hi - lo));
        return pow(max(mi * v, 0.0), vec3(2.2));
      }
      // Narkowicz 的 ACES 拟合：比 AgX 更饱和、对比更硬。
      vec3 tonemapACES(vec3 x) {
        return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      }

      void main() {
        vec2 uv = vUv;
        uv = (uv - center) / zoom + center;
        uv += shake / outSize;
        vec2 d = uv - center;
        float r2 = dot(d, d);
        vec3 c;

        if (blurAmt > 0.0 || radialBlur > 0.0) {
          // 径向模糊：沿指向中心的方向取 12 个抽样
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 12; i++) {
            float f = float(i) / 11.0;
            float s = 1.0 - f * (radialBlur * 0.12 + blurAmt * 0.01);
            acc += texture(src, center + d * s).rgb;
          }
          c = acc / 12.0;
        } else if (ca > 0.0) {
          // 色差：RGB 三通道按半径分离
          float k = ca * 0.004 * (0.25 + r2 * 2.0);
          c = vec3(
            texture(src, uv + d * k).r,
            texture(src, uv).g,
            texture(src, uv - d * k).b
          );
        } else {
          c = texture(src, uv).rgb;
        }

        c *= exposure;
        // 高光滚降：三选一。默认 'off' 走原来的软肩（老任务一像素不变）
        if (tonemap > 1.5)      c = tonemapACES(c);
        else if (tonemap > 0.5) c = tonemapAgX(c);
        else                    c = shoulderCurve(c, shoulder);
        c = mix(c, vec3(1.0) - c, invert);

        // 对比与饱和（围绕中灰 0.18）
        float l = luma(c);
        c = mix(vec3(l), c, saturation);
        c = (c - 0.18) * contrast + 0.18;
        c = max(c, vec3(0.0)) + lift;
        c *= tint;

        // 暗角
        if (vignette > 0.0) c *= 1.0 - vignette * smoothstep(0.25, 0.95, r2 * 2.2);

        c += flash;
        c *= (1.0 - fade);

        // 颗粒与抖动的栅格：'design' 按逻辑分辨率撒（--scale 2 出 4K 时颗粒不会细一半），
        // 'screen' 按物理像素（引擎一直以来的行为）。
        vec2 gp = grainDesign > 0.5 ? floor(vUv * designSize) : gl_FragCoord.xy;

        // 胶片颗粒：在显示空间加，暗部更明显（跟真胶片一样）
        if (grain > 0.0) {
          float g = rand(gp + seed) - 0.5;
          float amp = grain * (1.0 - 0.65 * luma(toSRGB(max(c, vec3(0.0)))));
          c += g * amp;
        }

        // 抖动：打散 8bit 量化带来的色带。
        // tpdf = 两个均匀分布相加（三角分布），去色带的噪声感比 rpdf 更弱。
        if (ditherMode > 1.5) {
          c += (rand(gp * 1.37 + seed * 1.7) + rand(gp * 2.11 + seed * 3.1) - 1.0) / 255.0;
        } else if (ditherMode > 0.5) {
          c += (rand(gp * 1.37 + seed * 1.7) - 0.5) / 255.0;
        }

        fragColor = vec4(max(c, vec3(0.0)), 1.0);
      }`,
      {
        src: { value: null }, outSize: [1920, 1080], designSize: [1920, 1080],
        exposure: 1, shoulder: 0.85, ca: 0, grain: 0.035, vignette: 0.35,
        saturation: 1, contrast: 1, lift: 0, invert: 0, tint: [1, 1, 1],
        shake: [0, 0], zoom: 1, flash: 0, fade: 0,
        blurAmt: 0, radialBlur: 0, seed: 0, center: [0.5, 0.5],
        tonemap: 0, ditherMode: 1, grainDesign: 0,
      }, { key: 'post_final', blend: false, ...pal });
  }

  /**
   * 跑完整条后处理链。
   * @param {GL} gl
   * @param {any} srcTex 场景合成的 HDR 纹理（线性）
   * @param {RT} dst 输出目标（物理分辨率）
   * @param {PostParams} p
   * @param {number} seed 每帧固定的随机种子（用帧号算，不要用时间）
   */
  render(gl, srcTex, dst, p, seed = 0) {
    this._build();
    const src = { tex: /** @type {any} */ (srcTex).tex ?? srcTex, __tex: true };
    const chain = this.chain;

    // 1) 亮部提取（同时降采样到第 0 级）
    this.pBright.u.src.value = src;
    this.pBright.u.texel.value = [1 / gl.pw, 1 / gl.ph];
    this.pBright.u.threshold.value = p.bloomThreshold;
    this.pBright.u.knee.value = Math.max(0.15, p.bloomThreshold * 0.6);
    this.pBright.u.karis.value = p.bloomKaris ? 1 : 0;
    this.pBright.render(gl, chain[0].bright);

    // halation 单独走一路：偏红、更宽
    this.pTint.u.src.value = { tex: chain[0].bright.tex, __tex: true };
    this.pTint.u.mul.value = [1.0, 0.34, 0.16];
    this.pTint.render(gl, chain[0].halTmp);
    this._blur(chain[0].halTmp, chain[0].hal, chain[0].halBlur,
      1 / chain[0].hal.w, 1 / chain[0].hal.h, p.bloomRadius * 2.0);

    // 泛光第 0 级
    this._blur(chain[0].bright, chain[0].a, chain[0].b,
      1 / chain[0].a.w, 1 / chain[0].a.h, p.bloomRadius);

    // 2) 逐级降采样 + 模糊（得到越来越宽的光晕）
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1], cur = chain[i];
      this.pBright.u.src.value = { tex: prev.a.tex, __tex: true };
      this.pBright.u.texel.value = [1 / prev.a.w, 1 / prev.a.h];
      this.pBright.u.threshold.value = 0.0;   // 已经是亮部图，直接降采样
      this.pBright.u.knee.value = 1.0;
      this.pBright.u.karis.value = 0;         // ⚠ Karis 只对第 0 级有意义，别让上一轮的值漏进来
      this.pBright.render(gl, cur.bright);
      this._blur(cur.bright, cur.a, cur.b, 1 / cur.a.w, 1 / cur.a.h, p.bloomRadius * (1 + i * 0.6));
    }

    // 3) 自下而上合并成一张泛光图
    let acc = chain[chain.length - 1].a;
    for (let i = chain.length - 2; i >= 0; i--) {
      this.pUp.u.src.value = { tex: acc.tex, __tex: true };
      this.pUp.u.add.value = { tex: chain[i].a.tex, __tex: true };
      this.pUp.u.k.value = 0.75;
      this.pUp.render(gl, chain[i].b);
      acc = chain[i].b;
    }

    // 4) 合成 + 调色
    this.pCombine.u.src.value = src;
    this.pCombine.u.bloomTex.value = { tex: acc.tex, __tex: true };
    this.pCombine.u.halTex.value = { tex: chain[0].hal.tex, __tex: true };
    this.pCombine.u.bloom.value = p.bloom;
    this.pCombine.u.halation.value = p.halation;
    this.pCombine.render(gl, this.combine);

    const f = this.pFinal;
    f.u.src.value = { tex: this.combine.tex, __tex: true };
    // zoom / 径向模糊 / 色差都绕 center 转。场景给的是**逻辑像素、y 向下**，
    // shader 里是 0..1、y 向上，所以在这里换算（不填就是画面中心）。
    // 曾经这里漏了赋值，于是 center 永远是默认值，"绕某个元素推近" 做不出来。
    const c = p.center;
    f.set({
      outSize: [gl.pw, gl.ph],
      designSize: [gl.w, gl.h],
      exposure: p.exposure, shoulder: p.shoulder, ca: p.ca, grain: p.grain,
      vignette: p.vignette, saturation: p.saturation, contrast: p.contrast,
      lift: p.lift, invert: p.invert, tint: p.tint,
      shake: p.shake, zoom: p.zoom, flash: p.flash, fade: p.fade,
      blurAmt: p.blur ?? 0, radialBlur: p.radialBlur ?? 0,
      seed: seed % 1000,
      tonemap: p.tonemap === 'agx' ? 1 : p.tonemap === 'aces' ? 2 : 0,
      ditherMode: p.dither === 'tpdf' ? 2 : p.dither === 'off' ? 0 : 1,
      grainDesign: p.grainScale === 'design' ? 1 : 0,
      center: Array.isArray(c) && c.length >= 2
        ? [c[0] / gl.w, 1 - c[1] / gl.h]
        : [0.5, 0.5],
    });
    f.render(gl, dst);
    this.params = p;
    return dst;
  }

  _blur(srcRT, target, tmp, tx, ty, radius = 1) {
    const gl = this.gl;
    this.pBlur.u.src.value = { tex: srcRT.tex, __tex: true };
    this.pBlur.u.dir.value = [tx, 0];
    this.pBlur.u.radius.value = radius;
    this.pBlur.render(gl, tmp);
    this.pBlur.u.src.value = { tex: tmp.tex, __tex: true };
    this.pBlur.u.dir.value = [0, ty];
    this.pBlur.render(gl, target);
    return target;
  }

  dispose() {
    for (const c of this.chain) {
      c.a.dispose(); c.b.dispose(); c.bright.dispose();
      c.hal.dispose(); c.halTmp.dispose(); c.halBlur.dispose();
    }
    this.chain = [];
    this.combine?.dispose();
    this.final?.dispose();
    this.ok = false;
  }
}
