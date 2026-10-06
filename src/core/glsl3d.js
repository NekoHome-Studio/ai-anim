// @ts-check
/**
 * 真 3D 内核 —— 全屏 shader 里的 **raymarching**。
 *
 * ## 这是 pdoom 三种"3D"里最难的那一种
 *
 * 别把三种混起来（pdoom 自己也只在少数几段用第 2 种）：
 *
 * | 种类 | 谁在用 | 成本 | 本引擎怎么用 |
 * |---|---|---|---|
 * | ① 解析投影 + 线段批 | `room` 的图书馆过道、`loss` 的损失地形 | 极低 | `cam.js` 的 `project3` + `lines` |
 * | ② **真 raymarch** | `ilya` 的房间、`paperclips` 的晶格、`shoggoth` | 高（GPU） | **本文件** |
 * | ③ 真 3D 引擎（深度测试） | 只有 `stack` | 中 | `three-bridge.js` + `kit/three.js`（Three.js 真网格；见 `docs/ENGINE.md` §3.8） |
 *
 * 第 ② 种值得单独写一层，因为它能做到 ① 和 ③ 都做不到的事：**没有几何**。
 * 无限重复的晶格、圆角融合的怪物、被遮挡的内壁 —— 都只是几个数学式子，
 * 想重复一千遍就 `mod()` 一下，不需要一千份顶点数据。
 *
 * ## 一个 raymarch 场景的骨架
 *
 * ```js
 * import { Pass } from '../../../src/core/gl.js';
 * import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../../../src/core/glsl3d.js';
 * import { camera3 } from '../../../src/core/cam.js';
 *
 * // ① 场景的 SDF。约定：MAP(p) 返回距离、MAP_MAT(p, mat) 顺便输出材质号。
 * //    库里的 march()/marchNormal()/calcAO()/softShadow() 会按名字调用它们 —— 用 #define
 * //    不用函数指针（GLSL ES 3.0 没有），所以**必须在 GLSL3D_KERNELS 之前**定义。
 * const SCENE = `
 *   float sdScene(vec3 p) { return min(sdSphere(p - vec3(0.0, 1.0, 0.0), 1.0), p.y); }
 *   float sdSceneM(vec3 p, out float mat) { mat = 1.0; return sdScene(p); }
 *   #define MAP(p) sdScene(p)
 *   #define MAP_MAT(p, m) sdSceneM(p, m)
 * `;
 *
 * setup(ctx) {
 *   this.pass = new Pass(ctx.gl, `
 *     uniform vec3 camPos, camR, camU, camF; uniform float focal;
 *     ${GLSL3D_PRE}          // 相机 ray / SDF 图元 / 3D 噪声
 *     ${SCENE}               // ← 中间：场景自己的 SDF + MAP/MAP_MAT
 *     ${GLSL3D_KERNELS}      // march / AO / 排线 / 雾（它们**用** MAP 和 MAP_MAT）
 *     void main() {
 *       vec3 ro; vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
 *       float mat; float hit = march(ro, rd, mat);
 *       vec3 col = C_INK;
 *       if (hit > 0.0) {
 *         vec3 p = ro + rd * hit, n = marchNormal(p, 0.002);
 *         col = shadeEngraved(p, n, rd, normalize(vec3(0.4, 0.8, 0.3)),
 *                             C_EMBER, C_INK, C_BONE, 40.0, 0.5, calcAO(p, n));
 *       }
 *       fragColor = vec4(fog(col, hit < 0.0 ? 60.0 : hit, 4.0, 0.06), 1.0);
 *     }`, cam3Uniforms(camera3({ pos: [0, 0, 4], target: [0, 1, 0], fov: 50, H: 1080 })),
 *        { palette: ctx.P });
 * }
 * ```
 *
 * ## 「整屏白」怎么查（这一条是实测出来的，别再凭直觉猜）
 *
 * raymarch 段最常见的两种事故是**整屏白**和**整屏黑**，而**引擎里没有一种失败长得像它的原因**：
 *
 * | 你看到的 | 真正发生了什么 | 怎么确认 |
 * |---|---|---|
 * | 整屏白（四个角有暗角、中间一片亮） | 场景往 HDR 缓冲里写了 **NaN 或 ±Inf**（两者在显示上完全一样） | `node tools/probe-raymarch.mjs` —— 它直接读浮点缓冲，`nan` / `inf` 两个变体会分别数出来 |
 * | 多子帧时反而发黑 / 单帧白多帧黑 | 同上：`samples > 1` 走累加，累加 pass 会把非有限值**丢掉**（`engine._accumPass`），于是单帧白、成片黑 | `check` 会报「单子帧与多子帧亮度差了 N×」 |
 * | 一个**平**的亮色（无明暗） | `march()` 每一条光线都打空 → 全都落到背景/纸色分支；或相机 uniform 全 0 导致光线退化 | `probe-raymarch.mjs --only ray,hit_mask`：`ray` 该有渐变、`hit_mask` 该有形状 |
 *
 * NaN 的三大来源（按实测频率）：`normalize(vec3(0.0))`（相机基向量没传到 → 全 0）、
 * 除以 0、`pow(0.0, 负数)`。**相机 uniform 是最好发的一条**：`camera3()` 吐的是
 * `{pos,right,up,fwd,focal}`，而 shader 要的是 `{camPos,camR,camU,camF,focal}` ——
 * 字段名对不上时 `Pass` 会**静默跳过**那四个 uniform（它们保持 0），
 * 画面不是报错，而是一片说不清的亮色。把 `camera3()` 的结果直接交给
 * `cam3Uniforms()` 就对了（它现在两种形状都认，认不出来会抛错）。
 *
 * ## 排线要挂在**世界/表面坐标**上，不能挂在屏幕上
 *
 * 这是"看起来像版画"和"看起来像噪点"的分界线。挂在 `gl_FragCoord` 上，镜头一动
 * 排线就跟着屏幕爬 —— 那是电视雪花，不是雕刻。pdoom 的 `hatch(u, darkness)` 收的是
 * **任意坐标**，场景传进去的是世界坐标的组合：
 *
 * ```glsl
 * float fib = hatch(across * 4.0 + 0.035 * snoise(vec2(s * 0.08, v * 2.0)), light * 0.95);   // fuse.ts
 * float lat = hatch(ang * 20.0, 0.25 + 0.5 * dif);                                            // shoggoth-glsl.ts
 * float relief = hatch(u, sat(dark * 1.05 + 0.04));                                           // ascent-note.ts（u 是表面参数）
 * ```
 *
 * 配套的第二个坑：**`fwidth()` 骗人**。`hatch` 内部用 `fwidth(u)` 算抗锯齿宽度，但如果
 * `u` 是角度、或者 `u` 在一个像素里跨了整数（`fract` 的接缝），`fwidth` 会爆炸，排线
 * 会糊成一条宽带。pdoom 的解法是留一个"自带导数"的入口（`shoggoth-glsl.ts:228`）：
 *
 * ```glsl
 * float fib = hatchD(u1, darkness, min(fwidth(u1), fwidth(u1b)));   // u1b 是同一物理量的另一种算法
 * ```
 *
 * 本文件把这条经验固化成 `hatchD()` / `engrave2()` / `engrave3()` 三个入口。
 */

/**
 * 3D 噪声：引擎的 `GLSL_COMMON` 只给了 `vnoise(vec3)` 和 2D 的 `fbm(vec2)`，
 * raymarch 需要**质量更好的 3D 噪声**（值噪声在 raymarch 里会出现方块状色阶）。
 * 这里是 Ashima / Stefan Gustavson 的 simplex noise（MIT）—— pdoom 用的就是同一份。
 *
 * ⚠ 命名：`hash13` / `vnoise` / `fbm(vec2)` 已经在 `GLSL_COMMON` 里了，**不要再声明一次**
 * （GLSL 重名 = 编译失败，而且 `Pass` 的报错会指到拼接后的行号，不好找）。
 */
export const GLSL_NOISE3 = /* glsl */ `
vec3 _mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _mod289_3(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _permute_3(vec3 x) { return _mod289_3(((x * 34.0) + 10.0) * x); }
vec4 _permute_3(vec4 x) { return _mod289_3(((x * 34.0) + 10.0) * x); }
vec4 _taylorInvSqrt_3(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = _mod289_3(i);
  vec4 p = _permute_3(_permute_3(_permute_3(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = _taylorInvSqrt_3(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
/** 3D fbm（4 个八度）。名字避开 GLSL_COMMON 里那个 2D 的 fbm。 */
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * snoise3(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
`;

/**
 * 3D 相机 → 视线。**这一个函数就是第 ② 种 3D 的入口**。
 *
 * uniform 约定（`cam.js` 的 `basis()` 直接吐这四个值，照抄进 `Pass` 的 uniforms 即可）：
 *   · `camPos` vec3 —— 相机位置
 *   · `camR` / `camU` / `camF` vec3 —— 右 / 上 / 前 三个单位基向量
 *   · `focal` float —— 焦距（像素）= H/2 / tan(fov/2)
 *
 * pdoom 的 `ilya-glsl.ts:454` 原式：
 * `vec3 rd = normalize(camF * focal + camR * px.x + camU * px.y);`
 * 其中 `px = (FRAG_PX - res*0.5) * vec2(1, -1)`（屏幕 y 向下 → NDC y 向上）。
 *
 * ⚠ **在本引擎里那个 `* vec2(1, -1)` 要去掉**（2026-10 修）：`FRAG_PX` 直接来自
 * `gl_FragCoord`，**y 本来就是向上的**（第 0 行在画面底部）；而"逻辑像素 y 向下"说的是
 * JS 侧那一套（`post.center` / `setXform` 的 anchor）。照抄 pdoom 会多翻一次 ——
 * 症状是**整个世界上下颠倒**：地板在天上、天花板在地上，光从下方打上来。
 * 走廊这种上下近似对称的场景第一眼看不出来，但 `params: { dbg: 2 }`（法线图）一开就露馅：
 * 该在下面的地板（法线朝上 = 绿）跑到了画面上半。
 */
export const CAM3D_GLSL = /* glsl */ `
/** 像素坐标 → 世界空间单位方向。ro 是输出参数（= camPos），省得场景再写一遍。 */
vec3 rayDir(vec2 fragPx, vec2 res, vec3 camPos, vec3 camR, vec3 camU, vec3 camF, float focal, out vec3 ro) {
  ro = camPos;
  vec2 px = fragPx - res * 0.5;                 // FRAG_PX 的 y 已经向上，不要再翻
  return normalize(camF * focal + camR * px.x + camU * px.y);
}
/** 只要方向、不要 ro 的版本。 */
vec3 rayDir(vec2 fragPx, vec2 res, vec3 camR, vec3 camU, vec3 camF, float focal) {
  vec2 px = fragPx - res * 0.5;
  return normalize(camF * focal + camR * px.x + camU * px.y);
}
/** 正交投影的视线（做"剖面图/工程图"那种正投影时用）。 */
vec3 rayDirOrtho(vec2 fragPx, vec2 res, vec3 camPos, vec3 camR, vec3 camU, vec3 camF, float scalePx, out vec3 ro) {
  vec2 px = fragPx - res * 0.5;
  ro = camPos + camR * px.x / scalePx + camU * px.y / scalePx;
  return camF;
}
`;

/**
 * 3D SDF 图元。引擎的 `GLSL_COMMON` 已经给了 `sdSphere` / `sdBox3` / `sdCapsule` /
 * `sdTorus` / `smin` / `smax`，这里补 pdoom 用到但引擎缺的那几个。
 */
export const SDF3_GLSL = /* glsl */ `
/** 圆角盒（raymarch 里最常用的"有厚度的一块板"）。 */
float sdRoundBox(vec3 p, vec3 b, float r) { return sdBox3(p, b - r) - r; }
/** 无限平面（法线 + 到原点的距离）。 */
float sdPlane(vec3 p, vec3 n, float h) { return dot(p, n) + h; }
/** 绕 Y 轴无限重复：把世界折叠成一个周期格子。这是"无限晶格"的全部秘密。 */
vec3 repY(vec3 p, float period) { p.y = p.y - period * floor(p.y / period + 0.5); return p; }
/** 三轴重复。 */
vec3 rep3(vec3 p, vec3 period) { return p - period * floor(p / period + 0.5); }
/** 沿 X 轴无限圆柱内的重复（做隧道/书架）。 */
vec3 repXZ(vec3 p, vec2 period) { p.xz = p.xz - period * floor(p.xz / period + 0.5); return p; }
/** 布尔：减去（挖洞）。 */
float opSub(float a, float b) { return max(a, -b); }
/** 布尔：相交。 */
float opInt(float a, float b) { return max(a, b); }
/** 圆角并集。 */
float opU(float a, float b, float k) { return smin(a, b, k); }
/** 便宜的扭转（做螺纹/螺旋）。 */
vec3 opTwistY(vec3 p, float k) { float a = k * p.y; float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z); }
/** 便宜的锥化。 */
vec3 opTaperY(vec3 p, float k) { float f = 1.0 + k * p.y; return vec3(p.x * f, p.y, p.z * f); }
`;

/**
 * 步进核心。**用 `#define MAP(p)` / `#define MAP_MAT(p, m)` 把场景接进来** ——
 * GLSL ES 3.0 没有函数指针，这是唯一干净的做法。
 *
 * 四个关键数字（都来自 pdoom，别凭感觉改）：
 *
 *   · **命中判据 `d < 0.00025 * t + 0.00005`** —— 阈值随距离放宽。用固定 epsilon 的话，
 *     远处的表面永远打不中（一直步进到步数上限，画面出现"远处的洞"）。
 *   · **步长 `t += d * 0.9`** —— 留 10% 余量。`t += d` 看着更"正确"，但在 SDF 不精确
 *     （`smin` 融合、`opTwist` 之后）的地方会穿模。
 *   · **步数上限**：pdoom 的 ilya 用 160 步、paperclips 用 128 步。给多了不值 ——
 *     108 个子帧的运动模糊会把多余的成本乘 108 倍。
 *   · **`tmax` 提前退出** —— 加了雾之后，超过 `tmax` 的东西本来也看不见。
 */
export const MARCH_GLSL = /* glsl */ `
/** 步进到最近的表面，返回行进距离；打不中返回 -1。mat 输出材质号。 */
float march(vec3 ro, vec3 rd, out float mat, int steps, float tmax) {
  float t = 0.02;
  mat = 0.0;
  for (int i = 0; i < 256; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float m;
    float d = MAP_MAT(p, m);
    if (d < 0.00025 * t + 0.00005) { mat = m; return t; }
    t += d * 0.9;
    if (t > tmax) break;
  }
  return -1.0;
}
float march(vec3 ro, vec3 rd, out float mat) { return march(ro, rd, mat, 160, 60.0); }
/** 诊断用：只返回步进次数（0 = 一步都没走 / 256 = 撞上限）。排查"整屏白/黑"时先看它。 */
float marchSteps(vec3 ro, vec3 rd, int steps, float tmax) {
  float t = 0.02;
  for (int i = 0; i < 256; i++) {
    if (i >= steps) return float(i);
    float d = MAP(ro + rd * t);
    if (d < 0.00025 * t + 0.00005) return float(i);
    t += d * 0.9;
    if (t > tmax) return float(i);
  }
  return 256.0;
}

/** 法线：四面体差分（4 次 MAP，比 6 次的中心差分便宜 1/3，精度对画面足够）。
 *  引擎 GLSL_COMMON 里那个 sdfNormal(p, e, d) 签名不对（它收的是四次采样结果，
 *  但四个参数传的是同一个 d）—— 别用，用这个。 */
vec3 marchNormal(vec3 p, float e) {
  vec2 k = vec2(1.0, -1.0);
  float m;
  return normalize(k.xyy * MAP_MAT(p + k.xyy * e, m)
                 + k.yyx * MAP_MAT(p + k.yyx * e, m)
                 + k.yxy * MAP_MAT(p + k.yxy * e, m)
                 + k.xxx * MAP_MAT(p + k.xxx * e, m));
}
/** 中心差分版（硬边更准，6 次 MAP）。盒子的棱角上有区别，球体上没有。 */
vec3 marchNormalCD(vec3 p, float e) {
  vec2 k = vec2(e, 0.0);
  float m;
  return normalize(vec3(
    MAP_MAT(p + k.xyy, m) - MAP_MAT(p - k.xyy, m),
    MAP_MAT(p + k.yxy, m) - MAP_MAT(p - k.yxy, m),
    MAP_MAT(p + k.yyx, m) - MAP_MAT(p - k.yyx, m)));
}

/** 只步进不记材质（阴影射线用，能省一半 MAP 的调用）。 */
float marchDist(vec3 ro, vec3 rd, float tmax, int steps) {
  float t = 0.02;
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float d = MAP(ro + rd * t);
    if (d < 0.0005) return t;
    t += d;
    if (t > tmax) break;
  }
  return -1.0;
}
`;

/**
 * 环境光遮蔽 + 软阴影。两样都是"一眼贵"的东西 —— 没它们 raymarch 出来的东西像塑料。
 *
 * 软阴影用 pdoom 的写法（`ilya-glsl.ts:214`）：沿光源方向步进，用 `min(res, k*h/t)`
 * 累积"最窄的那道缝"，`k` 越大阴影边缘越硬。这个式子的好处是**不需要知道光源大小**，
 * 一个 `k` 就能调出从全软到全硬。
 */
export const AO_GLSL = /* glsl */ `
/** 环境光遮蔽：沿法线采样几个点，看周围"堵"得厉害不厉害。 */
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.12 * float(i) / 4.0;
    float d = MAP(p + n * h);
    occ += (h - d) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}
/** 软阴影。k = 12 是 pdoom 的取值（相当软）；k = 32 更硬更"摄影棚"。 */
float softShadow(vec3 ro, vec3 rd, float tmax, float k) {
  float res = 1.0, t = 0.004;
  for (int i = 0; i < 48; i++) {
    float h = MAP(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, 0.003, 0.08);
    if (res < 0.01 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}
float softShadow(vec3 ro, vec3 rd, float tmax) { return softShadow(ro, rd, tmax, 12.0); }
`;

/**
 * **雕刻排线** —— 让 raymarch 出来的是"版画"而不是"塑料"的关键一层。
 *
 * ## 唯一重要的规则：`u` 必须是世界/表面坐标
 *
 * `hatch(u, darkness)` 在 `u` 的整数处画一根线，线宽随 `darkness` 变化。
 * 传屏幕坐标 → 镜头一动排线爬（电视雪花）；传世界坐标 → 排线钉在物体上（雕刻）。
 *
 * ## 三个入口，按需要选
 *
 * | 入口 | 什么时候用 |
 * |---|---|
 * | `hatch(u, d)` | `u` 是**线性**的世界/表面坐标（最常见） |
 * | `hatchD(u, d, du)` | `u` 是角度、或 `fwidth(u)` 在接缝处会爆炸 —— 自己给导数 |
 * | `engrave3(p, n, d, freq, angle)` | 偷懒版：给世界点 + 法线，自动选投影平面 |
 *
 * ## 为什么 `engrave3` 要挑投影平面
 *
 * 直接把世界坐标投影到某个固定平面（比如 `p.xz`）在**竖直的墙面**上会退化 ——
 * 墙面在 `xz` 上只有一条线，排线会被拉成条纹。所以按法线选主轴：大部分朝上的面
 * 用 `xz`，朝侧面的用 `zy` 或 `xy`。这一条是画"地形/桌面/墙面"时最容易踩的坑。
 */
export const ENGRAVE_GLSL = /* glsl */ `
/**
 * 排线。u 的整数处是一根线，线宽 = darkness（0 = 不画，1 = 满宽）。
 * 用 fwidth(u) 做抗锯齿 —— 所以**不要在 u 跨整数时信任它**（见 hatchD）。
 *
 * ⚠ 名字上不冲突但语义上是**替换**：GLSL_COMMON 里那个 hatch(vec2, float)
 * 既不抗锯齿、线宽也不随 darkness 连续变化（它是个阶跃），做 2D 装饰够用，
 * 做 raymarch 表面材质会在运动时闪。用这个两参数版本。
 */
float hatch(float u, float darkness) {
  float f = abs(fract(u) - 0.5);              // 0 在线中心 … 0.5 在两线之间
  float hw = 0.5 * clamp(darkness, 0.0, 1.0);
  float aa = max(fwidth(u), 1e-4);
  return 1.0 - smoothstep(hw - aa, hw + aa, 0.5 - f);
}
/**
 * 自带导数的排线：u 是角度/接缝坐标时用。du 给"这个像素在 u 上跨了多少"，
 * 自己挑一个不会爆的值（pdoom 用 min(fwidth(u1), fwidth(u1b)) 取两种算法的较小者）。
 */
float hatchD(float u, float darkness, float du) {
  float f = abs(fract(u) - 0.5);
  float hw = 0.5 * clamp(darkness, 0.0, 1.0);
  float aa = max(du, 1e-4);
  return 1.0 - smoothstep(hw - aa, hw + aa, 0.5 - f);
}
/** 交叉排线：暗部再加一层 1.1 rad 的排线。**"越暗越交叉"是版画的核心读法。** */
float crossHatch(vec2 uv, float darkness, float freq, float angle) {
  float c = cos(angle), s = sin(angle);
  vec2 r = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) * freq;
  float a = hatch(r.y, darkness * 1.1);
  float b = hatch((r.x * 0.4540 + r.y * 0.8910), clamp(darkness * 2.0 - 1.1, 0.0, 1.0));
  return max(a, b);
}
/** 按法线选投影平面，避免竖直面上排线被拉成条纹。 */
vec2 engraveUV(vec3 p, vec3 n, float scale) {
  vec3 a = abs(n);
  if (a.y >= a.x && a.y >= a.z) return p.xz * scale;   // 朝天/朝地：俯视投影
  if (a.x >= a.z) return p.zy * scale;                 // 朝侧面：侧视投影
  return p.xy * scale;                                 // 朝前/后：正视投影
}
/** 偷懒版雕刻：世界点 + 法线进去，排线出来。freq ≈ 40 起步，angle 换排线方向。 */
float engrave3(vec3 p, vec3 n, float darkness, float freq, float angle) {
  return crossHatch(engraveUV(p, n, freq), darkness, 1.0, angle);
}
/** 一步到位的材质着色：雕刻排线 + 主光 + AO + 边缘光 + 信号色高光。 */
vec3 shadeEngraved(vec3 p, vec3 n, vec3 rd, vec3 lightDir, vec3 lightCol, vec3 inkCol, vec3 paperCol,
                   float freq, float angle, float ao) {
  float dif = clamp(dot(n, lightDir), 0.0, 1.0);
  float amb = 0.5 + 0.5 * n.y;
  float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);
  float dark = clamp(1.0 - dif * ao, 0.0, 1.0);       // 越背光越暗 → 排线越密
  float ink = engrave3(p, n, dark * 1.05 + 0.04, freq, angle);
  vec3 col = mix(paperCol, inkCol, ink);
  col *= 0.35 + 0.65 * (dif * ao + 0.35 * amb);
  col += lightCol * dif * ao * 0.35;                  // 主光的暖色
  col += paperCol * fre * 0.18;                       // 边缘光（rim）
  return col;
}
`;

/**
 * 雾。raymarch 没有它就会"远处的几何硬生生切在背景上"，一眼假。
 * 指数雾 + 一点高度衰减（`hFog` 让低处更雾，做出"地板上的光尘"）。
 */
export const FOG_GLSL = /* glsl */ `
/** 指数雾：t 是行进距离，k 越大雾越浓。返回的是混合权重（0 = 无雾）。 */
float fogK(float t, float k) { return 1.0 - exp(-t * k); }
vec3 fog(vec3 col, float t, float near, float k) {
  return mix(col, C_INK, fogK(max(0.0, t - near), k));
}
/** 高度雾：低处更浓。做"无限晶格沉在雾里"很有效。 */
float fogHeight(float t, float y, float near, float k, float hFall) {
  return 1.0 - exp(-max(0.0, t - near) * k * exp(-max(0.0, y) * hFall));
}
vec3 fogH(vec3 col, float t, float y, float near, float k, float hFall) {
  return mix(col, C_INK, fogHeight(t, y, near, k, hFall));
}
/** 体积光尘：沿视线采样几个点，用 3D 噪声抖一抖。贵（每次采样一次 fbm3），少用。 */
vec3 dust(vec3 ro, vec3 rd, float t0, float t1, float density, float scale, vec3 col) {
  vec3 acc = vec3(0.0);
  const int N = 10;
  for (int i = 0; i < N; i++) {
    float t = mix(t0, t1, (float(i) + 0.5) / float(N));
    float d = fbm3((ro + rd * t) * scale);
    acc += col * max(0.0, d) * density;
  }
  return acc / float(N);
}
`;

/**
 * 把上面几块打包。**分两段**，场景夹在中间 —— 这不是风格问题，是 GLSL 的硬要求：
 *
 * ```glsl
 * uniform vec3 camPos, camR, camU, camF; uniform float focal;
 * ${GLSL3D_PRE}          // ① 相机 ray / SDF 图元 / 3D 噪声
 * // ② 场景自己的 SDF（可以用 ① 里的 repXZ / sdBox3 / sdTorus），末尾要定义 MAP / MAP_MAT
 * float mySDF(vec3 p) { ... }
 * float mySDFM(vec3 p, out float mat) { ... }
 * #define MAP(p) mySDF(p)
 * #define MAP_MAT(p, m) mySDFM(p, m)
 * ${GLSL3D_KERNELS}      // ③ march / marchNormal / AO / 排线 / 雾（它们**用** MAP 和 MAP_MAT）
 * void main() { ... }
 * ```
 *
 * ⚠ 为什么必须分两段：`GLSL ES 3.00` 的预处理器只在**文本出现位置之后**才认识那个宏，
 *   而 ③ 里的 `march()` 在函数体里写着 `MAP_MAT(p, m)`。如果把 ①③ 合成一块放在场景
 *   之前，宏还没定义就轮不到展开，编译器只会给一句
 *   `'MAP_MAT' : no matching overloaded function found`（我在这上面卡了很久：
 *   它读起来像"函数签名不对"，其实是"宏还没定义"）。
 *
 * 想省事也可以继续用一整块 `GLSL3D`（= ① + ③），但那样场景的 SDF **不能**用
 * ① 里的 SDF 图元 —— 它们必须在场景之前就位。
 */
export const GLSL3D_PRE = /* glsl */ `
${GLSL_NOISE3}
${CAM3D_GLSL}
${SDF3_GLSL}
`;

export const GLSL3D_KERNELS = /* glsl */ `
${MARCH_GLSL}
${AO_GLSL}
${ENGRAVE_GLSL}
${FOG_GLSL}
`;

/** 一次 include 全部（顺序 = ① ③），适合"场景 SDF 不用库里的图元"的简单情况。 */
export const GLSL3D = /* glsl */ `
${GLSL3D_PRE}
${GLSL3D_KERNELS}
`;

/**
 * 把 `cam.js` 的机位铺成 `Pass` 的 uniforms。
 *
 * ⚠ **两种机位形状都收**，因为写错这一步的代价极大、而症状极隐蔽：
 *   · `camera3()` → `{ pos, right, up, fwd, focal }`（第 1 类 3D 用）
 *   · `basis()` 风格 → `{ camPos, camR, camU, camF, focal }`（shader 直接要的）
 * 把 `camera3()` 的结果喂给"只认 camPos"的旧版本，shader 里那四个 `vec3` 会**保持 0**
 * （`Pass` 对没给的 uniform 是静默跳过的），于是 `normalize(vec3(0.0))` → NaN → 整屏白
 * （`docs/STATUS.md` §13.4 那一版走廊就是这一类）。所以这里**认不出来就抛错**，
 * 绝不返回一组 `undefined`。
 *
 * @param {{ camPos?: number[], camR?: number[], camU?: number[], camF?: number[], focal: number,
 *           pos?: number[], right?: number[], up?: number[], fwd?: number[] }} cam
 * @returns {{ camPos: number[], camR: number[], camU: number[], camF: number[], focal: number }}
 */
export function cam3Uniforms(cam) {
  const camPos = cam?.camPos ?? cam?.pos;
  const camR = cam?.camR ?? cam?.right;
  const camU = cam?.camU ?? cam?.up;
  const camF = cam?.camF ?? cam?.fwd;
  const focal = cam?.focal;
  const bad = [];
  if (!isVec3(camPos)) bad.push('camPos（camera3().pos）');
  if (!isVec3(camR)) bad.push('camR（camera3().right）');
  if (!isVec3(camU)) bad.push('camU（camera3().up）');
  if (!isVec3(camF)) bad.push('camF（camera3().fwd）');
  if (typeof focal !== 'number' || !Number.isFinite(focal)) bad.push('focal');
  if (bad.length) {
    throw new Error(
      `cam3Uniforms: 机位对象里这几个字段找不到 → ${bad.join(' / ')}\n` +
      `  收到的是：${JSON.stringify(cam)}\n` +
      `  正确用法：cam3Uniforms(camera3({ pos, target, fov, roll, H }))，` +
      `或直接传 { camPos, camR, camU, camF, focal }。\n` +
      `  这四个 vec3 在 shader 里若是 0，rayDir 会算出 NaN → 画面整屏白，而且不报错。`,
    );
  }
  return { camPos, camR, camU, camF, focal };
}

/** 三个有限数字的数组才算 vec3 —— 顺手挡住 `[0, 0, NaN]` 这种。 */
function isVec3(v) {
  return Array.isArray(v) && v.length === 3
    && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}
