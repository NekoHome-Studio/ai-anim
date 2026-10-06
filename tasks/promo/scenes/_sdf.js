// @ts-check
/**
 * promo 的 **SDF 世界**（第 ② 种 3D：真 raymarch）—— 段 3 与段 4 **共用同一个 Pass、同一份 SDF**。
 *
 * 这不是"两个镜头用了相似的场景"，而是**字面上同一个世界**：摄影机从大厅（`z −22…−46`）
 * 一路飞进晶格隧道（`z −46…−104`），中间没有剪辑点，SDF 里也没有接缝 —— 隧道的入口
 * 就是大厅尽头那道拱。这就是"一镜到底"最硬的那一半。
 *
 * 尺寸与线框世界对齐（`_world.js` 的 `LANDMARK`）：
 *   门 `z=−21` ／ 大厅 `−22…−46` ／ 隧道 `−46…−104` ／ 帧墙 `−104…−120` ／ 末端墙 `−132`
 *
 * 用法：
 * ```js
 * setup(ctx) { this.pass = makeSdfPass(ctx.gl, ctx.P); }
 * render(ctx) {
 *   this.pass.set(sdfUniforms(cam3At(t, H), { spark: m.p, sparkLit: m.lit, glow, dim, dbg }))
 *            .render(gl, ctx.out, t, f.dt);
 * }
 * ```
 *
 * ⚠ 三条踩过的坑（`docs/STATUS.md` §13.4）：
 *   ① 相机 uniform 一律走 `cam3Uniforms()` —— 字段名写错时 `Pass` 静默跳过 → 全 0 → NaN → 整屏白；
 *   ② `FRAG_PX` 的 y **向上**，别再翻一次（`rayDir` 已经处理好了）；
 *   ③ 排线要挂在**世界坐标**上，挂屏幕上镜头一动就变成雪花。
 */
import { Pass } from '../../../src/core/gl.js';
import { GLSL3D_PRE, GLSL3D_KERNELS, cam3Uniforms } from '../../../src/core/glsl3d.js';

/** 大厅与隧道的尺寸（改这里 = 改世界；`_world.js` 的 LANDMARK 是它的时间轴对应物）。 */
export const HALL = { hw: 5.2, hh: 4.0, z0: -22, z1: -46, bay: 8.0 };
export const TUN = { hw: 3.35, hh: 2.95, z0: -46, z1: -104, ring: 3.2 };

/**
 * 世界（SDF）。
 *
 * 约定（`glsl3d.js` 头注释）：`sdScene(p)` 给距离，`sdSceneM(p, mat)` 顺便给材质号，
 * 然后 `#define MAP(p)` / `MAP_MAT(p, m)` —— 必须在 `GLSL3D_KERNELS` **之前**定义。
 *
 * | 材质 | 是什么 | 着色 |
 * |---|---|---|
 * | 1 | 墙 / 地 / 顶 | 灰纸 + 密排线 |
 * | 2 | 柱子 / 拱 / 地面横肋 / 晶格环 | 骨白 + 疏排线 |
 * | 3 | 母题（那颗火花） | 自发光，交给泛光 |
 * | 4 | 门与尽头的出口 | 暖色自发光 |
 */
const SDF = /* glsl */ `
const float HALL_HW = 5.2, HALL_HH = 4.0;
const float TUN_HW  = 3.35, TUN_HH = 2.95;

/** 盒**内**距离（正 = 离最近的墙还有多远）。 */
float sdInBox(vec3 p, vec3 b) { return -sdBox3(p, b); }

/** 沿 z 每 period 重复一次（取最近的格子）。 */
vec3 repZ(vec3 p, float period) { p.z = p.z - period * floor(p.z / period + 0.5); return p; }

/** 大厅的腔体：z 从 −22 到 −46。 */
float sdHall(vec3 p) { return sdInBox(p - vec3(0.0, 0.0, -34.0), vec3(HALL_HW, HALL_HH, 12.0)); }
/** 隧道的腔体：z 从 −46 到 −104 —— 它比大厅窄，所以接缝处是一道明显的"门洞"。 */
float sdTunnel(vec3 p) { return sdInBox(p - vec3(0.0, 0.0, -75.0), vec3(TUN_HW, TUN_HH, 29.0)); }

/**
 * 两个腔体的**并集**。
 *
 * ⚠ 这里必须是 max 而不是 min（注意：这段注释在 GLSL 模板字符串**里面**，
 *   所以一个反引号都不能写 —— 写了会把模板字符串截断，页面直接 SyntaxError）。
 *   理由：sdInBox 在**腔内为正**（它给的是"离最近的墙还有多远"），
 *   所以"两个腔体都算内部"要取大。第一版写的是 min(sdHall, sdTunnel) ——
 *   于是站在大厅里时 sdTunnel 是个很大的**负数**（人在隧道盒子外面），
 *   整条 SDF 变成负的、march() 直接失效：**画面只剩雾，什么都打不中**。
 *   （症状是"整屏一片渐变的灰"、不报错、check 也不会红 —— 只有出图能看出来。）
 */
float sdRooms(vec3 p) {
  float endRoom = sdInBox(p - vec3(0.0, 0.0, -118.5), vec3(8.0, 4.6, 15.0));   // −103.5 … −133.5：帧墙与落版所在的那个厅
  return max(max(sdHall(p), sdTunnel(p)), endRoom);
}

/** 大厅两排柱子：每 5 个单位一组，左右各一根（圆角方柱）。 */
float sdColumns(vec3 p) {
  vec3 q = repZ(p, 5.0);
  float L = sdRoundBox(q - vec3(-4.35, -1.85, 0.0), vec3(0.40, 2.15, 0.40), 0.10);
  float R = sdRoundBox(q - vec3( 4.35, -1.85, 0.0), vec3(0.40, 2.15, 0.40), 0.10);
  return min(L, R);
}
/** 每一跨一道方环（中殿的"拱"）：整条大厅就是一连串同样的环 —— 纵深靠它读出来。 */
float sdBeams(vec3 p) {
  vec3 q = repZ(p, 5.0);
  float ring = max(sdBox3(q, vec3(5.05, 3.85, 0.20)), -sdBox3(q, vec3(4.65, 3.45, 0.30)));
  float beam = sdBox3(q - vec3(0.0, 3.55, 0.0), vec3(4.6, 0.26, 0.30));
  return min(ring, beam);
}
/** 地面横肋：每 1.6 个单位一道（"在往前走"的第一读数）。 */
float sdRibs(vec3 p) {
  vec3 q = repZ(p, 1.6);
  return sdBox3(q - vec3(0.0, -HALL_HH + 0.05, 0.0), vec3(HALL_HW, 0.05, 0.055));
}

/**
 * 晶格隧道：两组方环沿 z 交替（一组正的、一组转 45°），每 3.2 个单位一道。
 * 这是"无限重复的晶格"那种感觉 —— 没有几何，只有一个 mod()。
 */
float sdRings(vec3 p) {
  vec3 q = repZ(p, 3.2);
  float a = max(sdBox3(q, vec3(TUN_HW, TUN_HH, 0.14)), -sdBox3(q, vec3(TUN_HW - 0.30, TUN_HH - 0.30, 0.22)));
  float c = 0.70710678;
  vec3 r = vec3(c * q.x + c * q.y, -c * q.x + c * q.y, q.z);
  float b = max(sdBox3(r, vec3(TUN_HW + 0.35, TUN_HW + 0.35, 0.07)),
                -sdBox3(r, vec3(TUN_HW - 0.10, TUN_HW - 0.10, 0.16)));
  return min(a, b);
}
/** 隧道里纵向的四根棱线（让"筒"有方向感）。 */
float sdEdges(vec3 p) {
  vec3 q = p; q.x = abs(p.x) - TUN_HW + 0.10; q.y = abs(p.y) - TUN_HH + 0.10;
  q.z = p.z - (-75.0);                                    // 只在隧道那一段里（别飘进大厅）
  return sdRoundBox(q, vec3(0.05, 0.05, 29.0), 0.02);
}

/** 门（z=−21）：走廊世界与 SDF 世界共用的那一组数字。 */
float sdDoor(vec3 p) {
  float outer = sdBox3(p - vec3(0.0, 0.0, -21.0), vec3(2.75, 2.05, 0.16));
  float inner = sdBox3(p - vec3(0.0, 0.0, -21.0), vec3(2.45, 1.75, 0.24));
  return max(outer, -inner);
}
/**
 * 世界尽头那面墙（落版后面的底）。
 * ⚠ 它必须**在这个厅的腔体里面**（正面 z=−132.4，腔体后墙在 −133.5）——
 *   第一版把它的正面放在了腔体外面（−133.6），于是光线先打到腔体的岩壁（材质 1）、
 *   永远打不到这块发光的板（材质 5）：落版那一帧是一片暗青，不是一面暖墙。
 */
float sdEnd(vec3 p) { return sdBox3(p - vec3(0.0, 0.0, -133.0), vec3(6.9, 3.7, 0.6)); }

/** 大厅顶部的两条灯带：给这个世界一个**看得见的光源**，也是纵深的读数。 */
float sdStrips(vec3 p) {
  float a = sdBox3(p - vec3(-2.35, 3.72, -34.0), vec3(0.07, 0.05, 11.0));
  float b = sdBox3(p - vec3( 2.35, 3.72, -34.0), vec3(0.07, 0.05, 11.0));
  return min(a, b);
}

/** 母题：那颗火花。半径跟着亮度长出来（没点亮时半径 0 = 存在但不遮挡）。 */
float sparkR() { return 0.17 * sat(uSparkLit); }

float sdScene(vec3 p) {
  float room = sdRooms(p);
  float solid = min(min(sdColumns(p), sdBeams(p)), min(sdRibs(p), sdRings(p)));
  solid = min(solid, min(sdEdges(p), sdStrips(p)));
  float door = sdDoor(p);
  float endW = sdEnd(p);
  float spark = sdSphere(p - uSpark, sparkR());
  return min(min(room, solid), min(min(door, endW), spark));
}

/**
 * 材质号 = **哪个子 SDF 离得最近**（argmin），不是"谁的符号是负的"。
 *
 * ⚠ 第一版按符号判（endW 小于 0 才算墙），于是**正好落在表面上**的那一点
 *   （march() 返回的命中点，距离 ≈ 0，符号可能是 +1e-5）拿不到自己的材质号 ——
 *   落版那面发光的墙因此被当成岩壁着色：整帧是一片暗青，而"墙不发光"谁也看不出来是 bug。
 *   取 argmin 之后，命中点无论落在 0 的哪一侧都能拿到正确的材质。
 */
float sdSceneM(vec3 p, out float mat) {
  float d = sdRooms(p);        mat = 1.0;
  float v;
  v = sdColumns(p); if (v < d) { d = v; mat = 2.0; }
  v = sdBeams(p);   if (v < d) { d = v; mat = 2.0; }
  v = sdRibs(p);    if (v < d) { d = v; mat = 2.0; }
  v = sdRings(p);   if (v < d) { d = v; mat = 2.0; }
  v = sdEdges(p);   if (v < d) { d = v; mat = 2.0; }
  v = sdStrips(p);  if (v < d) { d = v; mat = 6.0; }
  v = sdDoor(p);    if (v < d) { d = v; mat = 4.0; }
  v = sdEnd(p);     if (v < d) { d = v; mat = 5.0; }
  v = sdSphere(p - uSpark, sparkR()); if (v < d) { d = v; mat = 3.0; }
  return d;
}
#define MAP(p) sdScene(p)
#define MAP_MAT(p, m) sdSceneM(p, m)
`;

/** 着色：雕刻排线 + 主光 + AO + 体积光尘 + 雾。 */
const SHADE = /* glsl */ `
vec3 shadeWorld(vec3 p, vec3 n, vec3 rd, float mat, float hit) {
  vec3 L = normalize(vec3(0.22, 0.92, 0.30));      // 主光：几乎从正上方来（这个世界是"顶光"的）
  float dif = clamp(dot(n, L), 0.0, 1.0);
  float ao = calcAO(p, n);
  float lit = dif * ao;
  float amb = 0.5 + 0.5 * n.y;
  bool trim = mat > 1.5;
  // 墙用石墨（比 ASH 暗一档），结构用骨白：对比就出在这里
  vec3 paper = trim ? C_BONE : C_GRAPHITE;
  float inkAmt = sat(1.0 - lit * 1.20) * 1.18 + 0.10;
  float ink = engrave3(p, n, inkAmt, trim ? 24.0 : 38.0, trim ? 0.42 : 1.02);
  vec3 col = mix(paper, C_INK, ink);
  col *= 0.16 + 0.92 * (lit + 0.22 * amb);
  col += C_SIGNAL * lit * 0.11;                                     // 冷调的主光
  col += paper * pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0) * 0.10; // 边缘光
  // 雾：与线框世界同一个口径（但更稀，不然远处全糊成一片灰）
  col = fog(col, hit, 14.0, 0.018);
  return col;
}
`;

/** 整段 shader。拼装顺序 = `glsl3d.js` 头注释那三步（PRE → 场景 → KERNELS），别调换。 */
export const SDF_FRAG = /* glsl */ `
uniform vec3  camPos, camR, camU, camF;
uniform float focal;
uniform vec3  uSpark;
uniform float uSparkLit;
uniform float uDim;        // 整段亮度倍率
uniform float uShaft;      // 顶部光柱的强度（大厅里明显、隧道里几乎没有）
uniform float uWall;       // 尽头那面墙的自发光（落版时才升起来）
uniform float uDbg;        // 0 正常 / 1 材质 / 2 法线 / 3 命中距离

${GLSL3D_PRE}
${SDF}
${GLSL3D_KERNELS}
${SHADE}

void main() {
  vec3 ro;
  vec3 rd = rayDir(FRAG_PX, RES_LOGICAL, camPos, camR, camU, camF, focal, ro);
  float mat;
  float hit = march(ro, rd, mat, 74, 52.0);

  vec3 col = C_INK;
  if (hit > 0.0) {
    vec3 p = ro + rd * hit;
    vec3 n = marchNormal(p, 0.0022);
    if (uDbg > 0.5) {
      if (uDbg < 1.5)      fragColor = vec4(vec3(mat / 6.0), 1.0);
      else if (uDbg < 2.5) fragColor = vec4(n * 0.5 + 0.5, 1.0);
      else                 fragColor = vec4(vec3(sat(hit / 52.0)), 1.0);
      return;
    }
    if (mat > 5.5) {
      col = (C_SIGNAL * 1.6 + C_BONE * 0.55) * uShaft;     // 顶部灯带：HDR 细线，泛光会把它拉成光条
    } else if (mat > 4.5) {
      // 尽头那面墙：落版落在它上面（亮度由 uWall 升起来）。带一点很淡的排线，免得像一块纯色板
      // ⚠ 亮度是调出来的：第一版给到 1.34，中心直接被泛光烧成白色，片名的墨色反而看不清了。
      float vig = 1.0 - 0.62 * sat(length(p.xy / vec2(6.9, 3.7)));
      float tex = 0.86 + 0.14 * engrave3(p, n, 0.30, 64.0, 0.55);
      col = (C_EMBER * 0.86 + C_BONE * 0.10) * uWall * vig * tex;
    } else if (mat > 3.5) {
      col = C_EMBER * 1.45 + C_BONE * 0.25;               // 门：自发光
    } else if (mat > 2.5) {
      col = (C_SIGNAL * 3.4 + vec3(0.9)) * uSparkLit;      // 母题火花：HDR，泛光接管
    } else {
      col = shadeWorld(p, n, rd, mat, hit);
    }
  }
  // 体积光尘：顶部打下来的光柱（远、稀、只加不遮）
  col += dust(ro, rd, 0.6, min(hit > 0.0 ? hit : 52.0, 40.0), 0.038 * uShaft, 0.30, C_SIGNAL * 0.42);
  fragColor = vec4(col * uDim, 1.0);
}
`;

/**
 * 建这一条 Pass。
 * @param {any} gl @param {any} palette 任务的调色板（`ctx.P`）——**必须传**，
 *   否则 shader 里注入的是默认调色板，任务覆盖的颜色不生效。
 */
export function makeSdfPass(gl, palette) {
  return new Pass(gl, SDF_FRAG, {
    camPos: [0, 0, 0], camR: [1, 0, 0], camU: [0, 1, 0], camF: [0, 0, -1], focal: 900,
    uSpark: [0, 0, -6], uSparkLit: 0, uDim: 1, uShaft: 1, uWall: 0, uDbg: 0,
  }, { key: 'promo_sdf_v2', palette });
}

/**
 * 每帧的 uniforms。
 * @param {any} cam `cam.js` 的 `camera3()` 结果（`cam3Uniforms` 两种形状都认）
 * @param {{ spark?: number[], sparkLit?: number, dim?: number, shaft?: number, wall?: number, dbg?: number }} [o]
 */
export function sdfUniforms(cam, o = {}) {
  const sp = o.spark ?? [0, 0, -6];
  return {
    ...cam3Uniforms(cam),
    uSpark: [sp[0], sp[1], sp[2]],
    uSparkLit: o.sparkLit ?? 0,
    uDim: o.dim ?? 1,
    uShaft: o.shaft ?? 1,
    uWall: o.wall ?? 0,
    uDbg: o.dbg ?? 0,
  };
}
