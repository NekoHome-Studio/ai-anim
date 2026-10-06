// @ts-check
/**
 * 验证片 · **走廊的世界（SDF / raymarch 版）** —— 第 1 段与第 5 段共用。
 *
 * 为什么单独一个文件：第 1 段（`corridor.js`）和第 5 段（`loop.js`）要"回到同一帧"，
 * 前提是两段**认的是同一个世界**。以前那份世界是 `_world.js` 里的线段批
 * （`corridorSegments()`）；这一版是 SDF，尺寸逐条对齐：
 *
 * | 量 | 值 | 线段版 |
 * |---|---|---|
 * | 半宽 / 半高 | `HW = 2.2` / `HH = 1.6` | 同 |
 * | 门框半尺寸 | `1.75 × 1.15`，厚 `0.10` | 同 |
 * | 门框间距 | 每 `4` 个单位一道 | 同 |
 * | 地面横肋 | 每 `4` 个单位一根 | 同（线段版是画出来的横线） |
 * | 火花 | `CORRIDOR.sparkAt(t)` 的同一个世界点 | 同 |
 *
 * 两段都引这一份，所以"成环"不是靠两边手抄同一串数字，而是**字面上同一个 SDF**。
 *
 * 用法（第 1 段 / 第 5 段都是这三行）：
 *
 * ```js
 * setup(ctx)  { this.pass = makeCorridorPass(ctx.gl, ctx.P); }
 * render(ctx) {
 *   this.pass.set(corridorUniforms(cam, { spark, sparkLit, exitGlow })).render(gl, ctx.out, t, f.dt);
 * }
 * ```
 */
import { Pass } from '../../../src/core/gl.js';
import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../../../src/core/glsl3d.js';

/** 走廊半宽 / 半高（世界单位）。改这里 = 改两段的世界，线段版请同步改 `_world.js`。 */
export const HW = 2.2;
export const HH = 1.6;

/**
 * 走廊的 SDF。约定与 `glsl3d.js` 头注释一致：`MAP(p)` 给距离、`MAP_MAT(p, m)` 顺便给材质号。
 *
 * | 材质号 | 是什么 | 着色 |
 * |---|---|---|
 * | 1 | 墙 / 地 / 顶 | 灰（`C_ASH`）底 + 密排线 |
 * | 2 | 门框与地面横肋 | 骨白（`C_BONE`）+ 疏排线 |
 * | 3 | 火花（母题） | 自发光，交给泛光 |
 * | 4 | 走廊尽头那面发光的墙 | 自发光（暖）—— 图纸段从它的屏幕位置长出来 |
 */
const SDF = /* glsl */ `
const float HW = 2.2;
const float HH = 1.6;

/** 盒**内**距离（正 = 离最近的墙还有多远）。 */
float sdInBox(vec3 p, vec3 b) { return -sdBox3(p, b); }
/** 门框：方环 = 外盒 − 内盒。 */
float sdFrame(vec3 p) {
  float outer = sdBox3(p, vec3(1.75, 1.15, 0.10));
  float inner = sdBox3(p, vec3(1.55, 0.95, 0.14));
  return max(outer, -inner);
}
/** 地面横肋：每 4 个单位一根矮条，是"在往前走"的主要读数。 */
float sdRib(vec3 q);
/** 沿 z 每 4 个单位重复一次（门框与横肋共用）。 */
vec3 repZ(vec3 p) { p.z = p.z - 4.0 * floor(p.z / 4.0 + 0.5); return p; }
/** 火花的半径跟着亮度长出来：没点亮时是**零半径**（存在但不遮挡任何东西）。 */
float sparkR() { return 0.13 * sat(uSparkLit); }
/** 走廊尽头那面发光的墙。 */
float sdExit(vec3 p) { return sdBox3(p - vec3(0.0, 0.0, -46.0), vec3(HW, HH, 0.30)); }

float sdScene(vec3 p) {
  // 内腔：z 从 +8（相机身后）通到 −52
  float room = sdInBox(p - vec3(0.0, 0.0, -22.0), vec3(HW, HH, 30.0));
  vec3 q = repZ(p);
  float spark = sdSphere(p - uSpark, sparkR());
  return min(min(min(room, sdFrame(q)), sdRib(q)), min(spark, sdExit(p)));
}
float sdRib(vec3 q) {
  // 只留地面那一层：中心 y = -HH + 0.04，半高 0.05
  return sdBox3(q - vec3(0.0, -HH + 0.04, 0.0), vec3(HW, 0.05, 0.09));
}
float sdSceneM(vec3 p, out float mat) {
  float spark = sdSphere(p - uSpark, sparkR());
  float exitBox = sdExit(p);
  vec3 q = repZ(p);
  float frame = sdFrame(q);
  float rib = sdRib(q);
  mat = 1.0;
  if (frame < 0.0) mat = 2.0;
  if (rib < 0.0) mat = 2.0;
  if (exitBox < 0.0) mat = 4.0;
  if (spark < 0.0) mat = 3.0;
  return sdScene(p);
}
#define MAP(p) sdScene(p)
#define MAP_MAT(p, m) sdSceneM(p, m)
`;

/** 场景自己的着色：雕刻排线 + 主光 + AO + 软阴影 + 边缘光。 */
const SHADE = /* glsl */ `
vec3 shadeScene(vec3 p, vec3 n, vec3 rd, float mat) {
  vec3 L = normalize(vec3(0.36, 0.74, 0.40));       // 主光：右上偏前
  float dif = clamp(dot(n, L), 0.0, 1.0);
  float ao = calcAO(p, n);
  float sh = softShadow(p + n * 0.012, L, 3.0, 14.0);   // tmax 只给 3 个单位：够用，省步数
  float lit = dif * ao * sh;
  float amb = 0.5 + 0.5 * n.y;
  // 门框是骨白、墙面是灰：同一套排线，两种纸
  bool trim = mat > 1.5 && mat < 3.5;
  vec3 paper = trim ? C_BONE : C_ASH;
  float ink = engrave3(p, n, sat(1.0 - lit * 1.05) * 1.05 + 0.04, trim ? 26.0 : 36.0, trim ? 0.5 : 1.15);
  vec3 col = mix(paper, C_INK, ink);
  col *= 0.30 + 0.70 * (lit + 0.35 * amb);
  col += C_EMBER * lit * 0.20;                                          // 主光的暖色
  col += paper * pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0) * 0.15;    // 边缘光
  return col;
}
`;

/** 整段 shader。拼装顺序 = `glsl3d.js` 头注释那三步（PRE → 场景 → KERNELS），别调换。 */
export const CORRIDOR_FRAG = /* glsl */ `
uniform vec3  camPos, camR, camU, camF;
uniform float focal;
uniform vec3  uSpark;       // 火花的世界位置（母题，全片一条路径）
uniform float uSparkLit;    // 火花的亮度（0 = 还没点亮 / 已熄灭）
uniform float uExitGlow;    // 尽头那面墙的亮度
uniform float uDim;         // 整段亮度倍率（入场 / 收尾的明暗过渡用，1 = 不变）
uniform float uDbg;         // 诊断开关（时间线的 params.dbg）：0 正常 / 1 材质号 / 2 法线 / 3 命中距离

${GLSL3D_PRE}
${SDF}
${GLSL3D_KERNELS}
${SHADE}

void main() {
  vec3 ro;
  vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
  float mat;
  float hit = march(ro, rd, mat, 96, 44.0);         // 96 步 / 44 单位：加了雾之后更远也看不见

  vec3 col = C_INK;
  if (hit > 0.0) {
    vec3 p = ro + rd * hit;
    vec3 n = marchNormal(p, 0.0018);
    if (uDbg > 0.5) {
      if (uDbg < 1.5)      fragColor = vec4(vec3(mat / 4.0), 1.0);
      else if (uDbg < 2.5) fragColor = vec4(n * 0.5 + 0.5, 1.0);
      else                 fragColor = vec4(vec3(sat(hit / 44.0)), 1.0);
      return;
    }
    if (mat > 3.5) {
      float edge = 1.0 - sat(length(p.xy / vec2(HW, HH)));
      col = C_EMBER * (0.30 + 2.1 * uExitGlow) + C_BONE * 0.35 * uExitGlow;
      col *= 0.62 + 0.38 * edge;
    } else if (mat > 2.5) {
      col = (C_EMBER * 3.2 + vec3(1.15)) * uSparkLit;   // HDR：剩下的交给泛光
    } else {
      col = shadeScene(p, n, rd, mat);
    }
    col = fog(col, hit, 6.0, 0.040);
  }
  fragColor = vec4(col * uDim, 1.0);
}
`;

/**
 * 建这一条 Pass。
 * @param {any} gl @param {any} palette 任务的调色板（`ctx.P`）——**必须传**，
 *   否则 shader 里注入的是默认调色板，任务覆盖的颜色不会生效。
 */
export function makeCorridorPass(gl, palette) {
  return new Pass(gl, CORRIDOR_FRAG, {
    camPos: [0, 0, 0], camR: [1, 0, 0], camU: [0, 1, 0], camF: [0, 0, -1], focal: 900,
    uSpark: [0, 0.2, -6], uSparkLit: 0, uExitGlow: 0, uDim: 1, uDbg: 0,
  }, { key: 'pdoom_corridor_rm', palette });
}

/**
 * 每帧的 uniforms。
 * @param {any} cam `cam.js` 的 `camera3()` 结果（`cam3Uniforms` 两种形状都认）
 * @param {{ spark?: number[], sparkLit?: number, exitGlow?: number, dim?: number, dbg?: number }} [o]
 */
export function corridorUniforms(cam, o = {}) {
  const sp = o.spark ?? [0, 0.2, -6];
  return {
    ...cam3Uniforms(cam),
    uSpark: [sp[0], sp[1], sp[2]],
    uSparkLit: o.sparkLit ?? 0,
    uExitGlow: o.exitGlow ?? 0,
    uDim: o.dim ?? 1,
    uDbg: o.dbg ?? 0,
  };
}
