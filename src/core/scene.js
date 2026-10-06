// @ts-check
/**
 * 场景契约。一个场景 = 一段「给定时刻 t，画出这一帧」的纯函数。
 *
 * 为什么必须是纯函数：离屏导出时每一帧会被拆成很多子帧（运动模糊）乱序渲染再平均。
 * 只要渲染只依赖 t，这一切就自动成立，而且预览和成片一模一样。
 *
 * 场景就是一个对象（或 class 实例）：
 *   {
 *     setup(ctx)            // 只调用一次：建 shader、建 LineBatch、预计算几何
 *     render(ctx)           // 每帧：把这一帧画进 ctx.out
 *     handlesTransition     // 可选：true 表示自己处理与上一个场景的衔接
 *     post: {...}           // 可选：这一段的默认后处理参数
 *     dispose()             // 可选：释放 GPU 资源
 *   }
 *
 * ctx 字段见下面的 SceneCtx 类型。最常用的：
 *   f.t 时间  f.lt 段内时间  f.p 段内进度  f.a 音频特征  f.beat/f.bar
 *   out 这一帧要画进去的 HDR 目标（必须整帧覆盖，别留黑）
 *   gl / comp / P 图形层、合成器、调色板
 *   text Canvas2D 图层 + 排版工具（画字走 text，画矢量走 lines/Pass）
 */

/**
 * @typedef {Object} Frame
 * @property {number} t        整片时间（秒）
 * @property {number} dt       本帧步长（离屏时是子帧间距）
 * @property {number} lt       段内时间 = t - start
 * @property {number} p        段内进度 0..1
 * @property {number} start    本段起点
 * @property {number} end      本段终点
 * @property {number} beat     连续拍号
 * @property {number} bar      连续小节号
 * @property {number} beatPhase beat 的小数部分（0→1 走向下一拍）
 * @property {number} fps      输出帧率
 * @property {number} idx      帧号（按帧抖动必须用它，别用 Math.floor(t*60)）
 * @property {number} seed     本帧固定种子（= idx 派生）
 * @property {boolean} preview true = 实时预览（1 个子帧），false = 离屏
 * @property {boolean} seeked  本帧之前时间跳变过
 * @property {number} tin      入场进度 0..1（与上一段重叠时）
 * @property {number} tout     出场进度 0..1（与下一段重叠时）
 * @property {any} under       上一个场景的成帧（handlesTransition 时用），否则 null
 * @property {any} a           音频特征快照 {rms,low,mid,high,vocal,kick,snare,hat,…}
 * @property {{r:number,g:number,b:number}} [rgb] 便捷线性色（很少用）
 */

/**
 * @typedef {Object} SceneCtx
 * @property {Frame} f
 * @property {any} gl            GL 实例（gl.ctx 是 WebGL2RenderingContext）
 * @property {any} out           本帧输出的 HDR 渲染目标（必须整帧覆盖）
 * @property {any} comp          Compositor（叠图层 / 自定义转场）
 * @property {any} P             Palette
 * @property {any} text          Layer2D：Canvas2D 图层（画字、画 2D 图形）
 * @property {any} type          TextKit：measure / layout / write / karaoke / wrap
 * @property {any} lines         LineBatch：矢量线段批（GPU 胶囊）
 * @property {any} music         MusicData（可能是 SILENT）
 * @property {any} lyrics        歌词数据（没有就是 null）
 * @property {any} params        这一段的时间线参数（timeline 里写的 params）
 * @property {number} W @property {number} H   逻辑分辨率
 * @property {number} start @property {number} end
 * @property {any} util          util.js 全部导出（clamp/lerp/ease/rng/prog/keys…）
 * @property {any} rng           rng(seed) 的便捷引用
 */

export const W = 1920;
export const H = 1080;
export const FPS = 60;

/**
 * 场景基类。用不用都行——直接用普通对象更简洁；
 * 用 class 的好处是 setup 里建立的资源能挂在 this 上。
 *
 *   export default class extends Scene {
 *     bg = new Pass(...)          // 注意：字段初始化在 setup(gl) 之后才拿得到 gl，
 *     setup(ctx) { ... }          // 所以需要 gl 的资源请在 setup 里建。
 *   }
 */
export class Scene {
  /** @param {any} ctx */
  setup(ctx) {}
  /** @param {any} ctx */
  render(ctx) {}
  /** 可选：释放 GPU 资源 */
  dispose() {}
}

/** 帧号派生的稳定随机种子（同一帧的所有子帧共用）。 */
export function frameSeed(idx) {
  let h = (idx | 0) * 2654435761;
  h ^= h >>> 15;
  return (h >>> 0) % 100000;
}
