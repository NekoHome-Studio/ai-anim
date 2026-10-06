// @ts-check
/**
 * 三段共用的**舞台**。接缝之所以看不出来，靠的是这几件事在三段里是**同一个值**：
 *
 *   ① **同一个世界原点与包围盒** —— A 段的分层板、B 段的线框盒子、C 段的晶格
 *      占的是同一块 `BOX` 空间（`worldPoint()` 是唯一的换算入口）；
 *   ② **同一台摄影机** —— `camAt(t)` 只吃**整片时间**，所以切点两侧机位连续
 *      （`src/core/trans.js` 顶部那四条配方的第 ② 条）；
 *   ③ **同一套投影** —— three 的 `PerspectiveCamera` 与 `src/core/cam.js` 的 `project3()`
 *      是同一个公式：
 *        `x_px = (x_view / -z_view) · focal + W/2`，`focal = (H/2) / tan(fov/2)`
 *      （three 那侧：`m[0] = 2n/width`，`width = aspect·2n·tan(fov/2)` ⇒ 同一个 focal）。
 *      所以 **B 段用引擎画出来的线框，能落在 A/C 段 Three.js 实体的同一个像素位置上** ——
 *      这正是"中间用同一个易实现且表现相同的画面做转场"能成立的原因。
 */

/** 三段共用的包围盒（世界单位） */
export const BOX = { w: 3.4, h: 2.6, d: 2.4 };
/** 盒子的世界中心（+y 向上；引擎与 Three.js 的世界坐标约定相同） */
export const CENTER = [0, 1.05, 0];
/** 竖直视场角（度）：三段必须一致，否则投影对不上 */
export const FOV = 34;
/** C 段把盒子切成几格（5×4×4 = 80 个单元） */
export const CELLS = { x: 5, y: 4, z: 4 };

/** 全片唯一一台摄影机：绕原点缓慢环绕 + 轻微推近。**只吃整片时间 t**。 */
export function camAt(t) {
  const a = 0.95 + 0.17 * t;
  const r = 11.4 - 1.3 * Math.sin(0.19 * t);
  const y = 4.4 + 1.0 * Math.sin(0.16 * t + 1.1);
  return { pos: [Math.sin(a) * r, y, Math.cos(a) * r], target: CENTER, fov: FOV };
}

/**
 * 盒子的预设材料色：**石墨灰**，不是信号色。
 *
 * ⚠ 这里是踩过才写的：第一版给了一盏很强的 signal 色轮廓光，结果 80 个单元全成了红色 ——
 * 引擎的规矩是「signal 是**唯一**的高饱和强调色，只给火花/被唱到的词/要发光的东西」，
 * 大面积用掉整支片子就没有强调可言了。信号色只留给描边、标签和引线。
 */
export function solidColor(palette, k = 1) {
  return palette('graphite', k);
}

/**
 * 标题底下的一条**渐隐压暗带**：3D 的亮部跑过来时标题仍然读得清。
 * 用几条 alpha 递减的横带拼出来（比一整块实心面板柔和，也不会像信箱黑边）。
 */
export function titleScrim(lines, P, W, h = 240, a = 0.72) {
  const N = 10;
  for (let i = 0; i < N; i++) {
    const y = (h * i) / N;
    lines.fillRect(0, y, W, h / N + 1, [P.ink[0], P.ink[1], P.ink[2], a * (1 - i / N) ** 1.4]);
  }
}

/**
 * 盒子局部坐标（`u/v/w` ∈ -0.5..0.5）→ 世界坐标。
 * 三段都只走这一个入口，几何才不会各写各的。
 */
export function worldPoint(u, v, w) {
  return [CENTER[0] + u * BOX.w, CENTER[1] + v * BOX.h, CENTER[2] + w * BOX.d];
}
