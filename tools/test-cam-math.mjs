// cam.js 的数学单测（纯 JS，不需要 GPU / 联网）。
//
// 判据：摄影机是**纯函数**，所以一切都可以离线断言。这里钉的是七条最容易写错、
// 写错了画面又"看起来还行"的性质：
//   ① makeCam.at() 段外取端值、段内单调、关键帧上取到原值
//   ② zoom 走**对数**插值（线性插值会让推近前快后慢）
//   ③ 推近时绕**不动点**：不动点的屏幕位置在整个插值过程中不动
//   ④ mixCam 两个端点严格等于两台机位，且 zoom 也是对数插值
//   ⑤ project/unproject 互为逆（k = 0）
//   ⑥ keystone（k > 0）不翻面：d 穿过 0 时被夹住，坐标是有限值
//   ⑦ project3 + clipSegment：镜头后方的线段被截到近平面上，不会画出翻面长线
import { strict as A } from 'node:assert';
import {
  makeCam, mixCam, zoomLerp, camVelocity, smearTimes, smearAlpha,
  handheld, shakeSmooth, project, unproject, projectLine, camera3, project3, clipSegment,
  depthScale, widthAt, camXform,
} from '../src/core/cam.js';
// 引擎的 xformForward：把 camXform 的输出过一遍，验证它和 project() 逐像素一致
import { xformForward } from '../src/core/engine.js';

let n = 0;
function ok(name, fn) { fn(); n++; console.log(`  ✓ ${name}`); }
function near(a, b, eps, what) {
  A.ok(Math.abs(a - b) <= eps, `${what}: 期望 ${b} ± ${eps}，实际 ${a}`);
}

console.log('cam.js 数学单测');

const W = 1920, H = 1080;

// ---------------------------------------------------------------- ① 关键帧
const CAM = makeCam([
  [0.0, { x: 0, y: 0 }, 1.0, 0.0],
  [1.0, { x: 1, y: 0 }, 2.0, 0.1, 'linear'],
  [2.0, { x: 3, y: 1 }, 2.0, 0.0, 'linear'],
]);

ok('段外取端值', () => {
  near(CAM.at(-5).x, 0, 1e-12, 't < start');
  near(CAM.at(99).x, 3, 1e-12, 't > end');
});

ok('关键帧上取到原值', () => {
  near(CAM.at(1).x, 1, 1e-9, 't = 1 的 x');
  near(CAM.at(1).zoom, 2, 1e-9, 't = 1 的 zoom');
  near(CAM.at(2).x, 3, 1e-9, 't = 2 的 x');
});

ok('start / end 暴露出来', () => {
  near(CAM.start, 0, 0, 'start');
  near(CAM.end, 2, 0, 'end');
});

// ---------------------------------------------------------------- ② 对数插值
ok('zoom 走对数插值（k=0.5 时是几何平均）', () => {
  const c = makeCam([[0, { x: 0, y: 0 }, 1, 0, 'linear'], [1, { x: 0, y: 0 }, 4, 0, 'linear']]);
  near(c.at(0.5).zoom, 2, 1e-9, '1 → 4 的中点');
  near(zoomLerp(1, 4, 0.5), 2, 1e-12, 'zoomLerp 本身');
  near(zoomLerp(2, 8, 0.25), 2 * Math.pow(4, 0.25), 1e-12, '任意倍率');
});

// ---------------------------------------------------------------- ③ 不动点
ok('推近时不动点屏幕位置不动', () => {
  // 从 (0,0) zoom 1 推到 (2,2) zoom 2：不动点 f = (2*2 - 1*0)/(2-1) = (4,4)
  const c = makeCam([[0, { x: 0, y: 0 }, 1, 0, 'linear'], [1, { x: 2, y: 2 }, 2, 0, 'linear']]);
  const fx = 4, fy = 4;
  const at0 = project(c.at(0), W, H, fx, fy);
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const q = project(c.at(t), W, H, fx, fy);
    near(q.x, at0.x, 1e-6, `t=${t} 不动点 x`);
    near(q.y, at0.y, 1e-6, `t=${t} 不动点 y`);
  }
});

ok('不动点：zoom 不变时退化成纯平移', () => {
  const c = makeCam([[0, { x: 0, y: 0 }, 1.5, 0, 'linear'], [1, { x: 2, y: 0 }, 1.5, 0, 'linear']]);
  near(c.at(0.5).x, 1, 1e-9, '中点 x');
  near(c.at(0.5).y, 0, 1e-9, '中点 y');
});

// ---------------------------------------------------------------- ④ mixCam
ok('mixCam 两端点严格还原', () => {
  const a = { x: 1, y: 2, zoom: 1.5, rot: 0.1 };
  const b = { x: -3, y: 0.5, zoom: 4, rot: -0.2 };
  const A0 = mixCam(a, b, 0), B0 = mixCam(a, b, 1);
  near(A0.zoom, a.zoom, 1e-9, 'k=0 zoom'); near(A0.rot, a.rot, 1e-9, 'k=0 rot');
  near(B0.zoom, b.zoom, 1e-9, 'k=1 zoom'); near(B0.rot, b.rot, 1e-9, 'k=1 rot');
});

ok('mixCam 的 zoom 是对数插值', () => {
  const m = mixCam({ x: 0, y: 0, zoom: 1, rot: 0 }, { x: 0, y: 0, zoom: 4, rot: 0 }, 0.5);
  near(m.zoom, 2, 1e-9, '中点 zoom');
  // 两台机位中心都在 0 → 混出来也该在 0
  near(m.x, 0, 1e-9, '中心 x');
});

// ---------------------------------------------------------------- ⑤ 投影互逆
ok('project / unproject 互为逆（k = 0）', () => {
  const cam = { x: 3.25, y: -1.5, zoom: 2.4, rot: 0.37 };
  for (const [wx, wy] of [[0, 0], [10, -4], [-7.5, 3.125]]) {
    const p = project(cam, W, H, wx, wy);
    const q = unproject(cam, W, H, p.x, p.y);
    near(q.x, wx, 1e-6, `反投影 x (${wx},${wy})`);
    near(q.y, wy, 1e-6, `反投影 y (${wx},${wy})`);
  }
});

ok('projectLine 与逐个 project 一致', () => {
  const cam = { x: 0, y: 0, zoom: 1, rot: 0 };
  const pts = [[0, 0], [100, 50], [-30, 20]];
  const l = projectLine(cam, W, H, pts);
  pts.forEach((p, i) => {
    const q = project(cam, W, H, p[0], p[1]);
    near(l[i][0], q.x, 1e-9, `点 ${i} x`);
    near(l[i][1], q.y, 1e-9, `点 ${i} y`);
  });
});

// ---------------------------------------------------------------- ⑥ keystone
ok('keystone：d 穿 0 时被夹住，不产生 NaN / 翻面', () => {
  const cam = { x: 0, y: 0, zoom: 1, rot: 0 };
  // fy = +H/2 = 540 时 d = 1 - k*540；k = 1/540 正好把 d 压到 0
  const q = project(cam, W, H, 0, 540, 1 / 540);
  A.ok(Number.isFinite(q.x) && Number.isFinite(q.y), '坐标必须是有限值');
  A.ok(q.x <= W + 1e6, '不应该出现天文数字');
});

// ---------------------------------------------------------------- ⑦ 3D 投影
ok('project3：正前方的点在画面中心', () => {
  const c = camera3({ pos: [0, 0, 0], target: [0, 0, -1], fov: 34, H });
  const p = project3(c, W, H, 0, 0, -10);
  near(p.x, W / 2, 1e-6, '中心 x');
  near(p.y, H / 2, 1e-6, '中心 y');
  near(p.w, 10, 1e-6, '深度');
});

ok('project3：近大远小', () => {
  const c = camera3({ pos: [0, 0, 0], target: [0, 0, -1], fov: 34, H });
  const nearP = project3(c, W, H, 1, 0, -5);
  const farP = project3(c, W, H, 1, 0, -20);
  A.ok(Math.abs(nearP.x - W / 2) > Math.abs(farP.x - W / 2), '近处的偏移必须更大');
  near(depthScale(c, 5, H) / depthScale(c, 20, H), 4, 1e-9, '深度比');
});

ok('project3：镜头后方的点 w < 0（交给 clipSegment 处理）', () => {
  const c = camera3({ pos: [0, 0, 0], target: [0, 0, -1], fov: 34, H });
  A.ok(project3(c, W, H, 0, 0, 5).w < 0, '背后的点深度为负');
});

/**
 * 手性（2026-10 修的一个**静默** bug）：`camera3` 的 `right` 曾经取了 `cross(worldUp, fwd)`,
 * 基座变成左手的，整幅画面**左右镜像** —— 世界 `x = +1.5` 的点落在画面左半边。
 * 走廊 / 图纸 / 塔 / 柱林左右近似对称，谁都没看出来；直到 raymarch 的调试图露馅。
 * 这三条钉住"世界坐标 → 屏幕方向"的常识，别再让它悄悄翻回去。
 */
ok('camera3 手性：世界 +x 在画面右半边、+y 在上半边', () => {
  const c = camera3({ pos: [0, 0, 0], target: [0, 0, -1], fov: 34, H });
  near(c.right[0], 1, 1e-9, 'right 应该指向 +x（朝 -z 看时）');
  near(c.up[1], 1, 1e-9, 'up 应该指向 +y');
  near(c.fwd[2], -1, 1e-9, 'fwd 应该指向 -z');
  A.ok(project3(c, W, H, 1.5, 0, -5).x > W / 2, 'x=+1.5 必须落在右半边');
  A.ok(project3(c, W, H, -1.5, 0, -5).x < W / 2, 'x=-1.5 必须落在左半边');
  A.ok(project3(c, W, H, 0, 1, -5).y < H / 2, 'y=+1 必须落在上半边');
});

ok('camera3 手性：斜视角下 right×up = -fwd（右手系）', () => {
  const c = camera3({ pos: [3, 2, 4], target: [-1, 0.5, -2], fov: 50, H });
  const cross = [
    c.right[1] * c.up[2] - c.right[2] * c.up[1],
    c.right[2] * c.up[0] - c.right[0] * c.up[2],
    c.right[0] * c.up[1] - c.right[1] * c.up[0],
  ];
  for (let i = 0; i < 3; i++) near(cross[i], -c.fwd[i], 1e-9, `分量 ${i}`);
});

ok('clipSegment：两端在后 → 丢掉', () => {
  const a = { x: 0, y: 0, w: -1 }, b = { x: 10, y: 0, w: -2 };
  A.equal(clipSegment(a, b), false, '应该返回 false');
});

ok('clipSegment：一端在后 → 截到近平面', () => {
  const a = { x: 0, y: 0, w: -1 }, b = { x: 100, y: 50, w: 1 };
  A.equal(clipSegment(a, b, 0.05), true, '应该可以画');
  near(a.w, 0.05, 1e-9, '被截到近平面');
  A.ok(a.x > 0 && a.x < 100, 'x 应该落在两点之间');
});

ok('clipSegment：都在前面 → 原样通过', () => {
  const a = { x: 0, y: 0, w: 5 }, b = { x: 10, y: 0, w: 6 };
  A.equal(clipSegment(a, b), true);
  near(a.x, 0, 0, 'a 不变'); near(b.x, 10, 0, 'b 不变');
});

// ---------------------------------------------------------------- 速度 / 拖影
ok('camVelocity 方向正确、静止时为 0', () => {
  const c = makeCam([[0, { x: 0, y: 0 }, 1, 0, 'linear'], [1, { x: 10, y: 0 }, 1, 0, 'linear']]);
  const v = camVelocity(c, 0.5, 1 / 60);
  near(v.vx, 10, 1e-3, '速度 x');
  near(v.dir[0], 1, 1e-6, '方向 x');
  const still = makeCam([[0, { x: 1, y: 1 }, 1, 0], [1, { x: 1, y: 1 }, 1, 0]]);
  near(camVelocity(still, 0.5, 1 / 60).speed, 0, 1e-9, '静止速度');
});

ok('smearTimes：静止时只有一份', () => {
  const still = makeCam([[0, { x: 1, y: 1 }, 1, 0], [1, { x: 1, y: 1 }, 1, 0]]);
  A.equal(smearTimes(still, 0.5, 1 / 60).length, 1, '静止 = 1 份');
});

ok('smearTimes：快甩时份数变多、时刻单调递增、末尾是 t', () => {
  const fast = makeCam([[0, { x: 0, y: 0 }, 1, 0, 'linear'], [0.5, { x: 200, y: 0 }, 1, 0, 'linear']]);
  const ts = smearTimes(fast, 0.25, 1 / 60);
  A.ok(ts.length > 2, `快甩应该多份，实际 ${ts.length}`);
  for (let i = 1; i < ts.length; i++) A.ok(ts[i] > ts[i - 1], '时刻必须递增');
  near(ts[ts.length - 1], 0.25, 1e-9, '最后一份是 t 本身');
});

ok('smearAlpha：总墨水接近 1.6', () => {
  near(smearAlpha(1), 1, 0, '单份 = 1');
  near(smearAlpha(8) * 8, 1.6, 1e-9, '8 份的总和');
});

// ---------------------------------------------------------------- 手持抖动
//
// ⚠ 默认 `mode` 是 `'smooth'`（低频漂移）。为什么把默认值换掉：**「像不像手持」取决于
//    频率，不是幅度** —— 60fps 下逐帧换一个随机位置（白噪声）看着是"振动/地震"，哪怕
//    只有 5px；而 0.5–2Hz 的慢漂移即使 38px 也像"有人扶着机器"。教训见
//    docs/IMPROVEMENTS-3.md（promo 成片实测：RMS 3.64px / 相邻帧差 13px → 0.27 / 1）。
//    老的白噪声行为搬到 `mode: 'grain'`，留给"震屏/冲击"这类**故意**要抖的场合。
ok('handheld(grain)：按帧号播种 —— 同帧同值、异帧异值、幅度不超', () => {
  const cam = { x: 0, y: 0, zoom: 1, rot: 0 };
  const opts = { amp: 0.01, mode: /** @type {'grain'} */ ('grain') };
  const a = handheld(cam, 0.5, 12345, opts);
  const b = handheld(cam, 0.5 + 1 / 900, 12345, opts);   // 同一帧内的另一个子帧
  A.equal(a.x, b.x, '同一帧号必须同值');
  A.equal(a.y, b.y, '同一帧号必须同值');
  const c = handheld(cam, 0.5, 12346, opts);
  A.ok(a.x !== c.x || a.y !== c.y, '不同帧号应该抖动不同');
  A.ok(Math.abs(a.x) <= 0.01 + 1e-12 && Math.abs(a.y) <= 0.01 + 1e-12, '幅度不能超');
});

ok('handheld(smooth)：平滑（逐帧变化 ≪ 幅度）、确定、幅度真的用上', () => {
  const cam = { x: 0, y: 0, zoom: 1, rot: 0 };
  const amp = 0.01, fps = 60;
  let maxAmp = 0, stepMax = 0, sumSq = 0, stepSq = 0, n = 0;
  /** @type {any} */ let prev = null;
  for (let i = 0; i < fps * 20; i++) {                 // 20 秒
    const p = handheld(cam, i / fps, i, { amp });
    maxAmp = Math.max(maxAmp, Math.abs(p.x - cam.x), Math.abs(p.y - cam.y));
    sumSq += (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2; n++;
    if (prev) {
      const d = Math.hypot(p.x - prev.x, p.y - prev.y);
      stepMax = Math.max(stepMax, d); stepSq += d * d;
    }
    prev = p;
  }
  const rms = Math.sqrt(sumSq / n / 2);
  const stepRms = Math.sqrt(stepSq / (n - 1));
  A.ok(maxAmp > amp * 0.55 && maxAmp <= amp * 1.05, `峰值 ${maxAmp.toFixed(5)} 应接近 amp=${amp}`);
  A.ok(rms > amp * 0.25, `RMS ${rms.toFixed(5)} 不能太小（幅度要真的用上）`);
  A.ok(stepRms < amp * 0.2, `逐帧变化 RMS ${stepRms.toFixed(5)} 必须 ≪ 幅度（白噪声的指纹是 ≈1）`);
});

ok('shakeSmooth：峰值≈amp、逐帧平滑、一帧内子帧几乎不动、确定', () => {
  const amp = 3, fps = 60;
  let maxAbs = 0, stepMax = 0, subMax = 0;
  let prev = shakeSmooth(0, amp);
  for (let i = 1; i < fps * 20; i++) {
    const t = i / fps;
    const cur = shakeSmooth(t, amp);
    stepMax = Math.max(stepMax, Math.hypot(cur[0] - prev[0], cur[1] - prev[1]));
    maxAbs = Math.max(maxAbs, Math.abs(cur[0]), Math.abs(cur[1]));
    // 一帧内的子帧：快门 0.5 ⇒ 时间跨度 1/2 帧。位移差必须远小于 1px，
    // 否则运动模糊会把抖动抹成双重曝光（这正是「平滑抖动要用 t、白噪声要用 f.idx」的道理）
    for (let k = 1; k <= 8; k++) {
      const sub = shakeSmooth(t + k / (fps * 2 * 8), amp);
      subMax = Math.max(subMax, Math.hypot(sub[0] - cur[0], sub[1] - cur[1]));
    }
    prev = cur;
  }
  A.ok(maxAbs > amp * 0.5 && maxAbs <= amp * 1.05, `峰值 ${maxAbs.toFixed(3)} 应接近 amp=${amp}`);
  A.ok(stepMax < amp * 0.2, `逐帧变化峰值 ${stepMax.toFixed(3)} 必须 ≪ 幅度（白噪声会 ≈ 2×amp）`);
  A.ok(subMax < 0.25, `一帧内子帧位移差 ${subMax.toFixed(4)}px 必须 ≪ 1px（实测最大 ~0.13px）`);
  A.ok(shakeSmooth(2.5, 3)[0] === shakeSmooth(2.5, 3)[0], '同 t 必须同值（确定性）');
  const zero = shakeSmooth(1.5, 0);
  A.ok(zero[0] === 0 && zero[1] === 0, 'amp=0 ⇒ 零位移');
});

ok('handheld：amp = 0 时原样返回', () => {
  const cam = { x: 1, y: 2, zoom: 3, rot: 4 };
  A.equal(handheld(cam, 0.5, 7, { amp: 0 }), cam, '应该返回同一个对象');
});

// ---------------------------------------------------------------- 参数校验
ok('makeCam：空数组 / 格式错误会抛错（不静默出黑屏）', () => {
  A.throws(() => makeCam([]), /至少要有一个关键帧/);
  A.throws(() => makeCam([[0, 0, 1]]), /格式不对/);
});

ok('widthAt：夹在上下限内', () => {
  const c = camera3({ pos: [0, 0, 0], target: [0, 0, -1], fov: 34, H });
  near(widthAt(c, 1000, 0.01), 1, 1e-9, '太细 → 下限');
  near(widthAt(c, 0.01, 100), 12, 1e-9, '太粗 → 上限');
});

// ---------------------------------------------------------------- ⑧ camXform ↔ project 等价
//
// 这是本文件里最重要的一条断言：`camXform` 给 `ctx.setXform` 的那组 (x, y, p, q) 必须让
// 整层东西**逐像素**落在 `project()` 投出来的位置上。公式是推导出来的（比例常数正好是
// zoom），符号极易写反，所以必须钉住。
ok('camXform 与 project(k) 逐像素一致', () => {
  const cases = [
    { cam: { x: 0, y: 0, zoom: 1, rot: 0 }, k: 0 },
    { cam: { x: 0, y: 0, zoom: 1, rot: 0 }, k: 0.00022 },
    { cam: { x: 0, y: 0, zoom: 1, rot: 0 }, k: -0.00022 },
    { cam: { x: 0, y: 0, zoom: 1.4, rot: 0 }, k: -0.00022 },
    { cam: { x: 960, y: 540, zoom: 2.3, rot: 0 }, k: -0.00022 },
    { cam: { x: 700, y: 620, zoom: 1.12, rot: -0.012 }, k: -0.00018 },
    { cam: { x: 1052, y: 470, zoom: 1.3, rot: -0.01 }, k: -0.00016 },
    { cam: { x: -400, y: 1800, zoom: 0.62, rot: 0.35 }, k: 0.00009 },
  ];
  // xformForward 给出正向 3×3（列主序），作用在**列向量** (x, y, 1) 上：
  //   X = m[0]·x + m[3]·y + m[6]
  //   Y = m[1]·x + m[4]·y + m[7]
  //   W = m[2]·x + m[5]·y + m[8]
  // 数值解出来的矩阵在"理论上是 0"的格子里会有 1e-19 级残差，所以这里不检查具体格。
  const applyXf = (m, x, y) => {
    const X = m[0] * x + m[3] * y + m[6];
    const Y = m[1] * x + m[4] * y + m[7];
    const Wd = m[2] * x + m[5] * y + m[8];
    return { x: X / Wd, y: Y / Wd };
  };
  for (const { cam, k } of cases) {
    const xf = camXform(cam, W, H, k);
    const m = xformForward(W, H, xf);
    for (const [wx, wy] of [[0, 0], [960, 540], [-800, 1400], [2400, -300], [300, 1000]]) {
      const want = project(cam, W, H, wx, wy, k);
      const got = applyXf(m, wx, wy);
      near(got.x, want.x, 1e-6, `x (zoom=${cam.zoom}, rot=${cam.rot}, k=${k}, 世界点 ${wx},${wy})`);
      near(got.y, want.y, 1e-6, `y (zoom=${cam.zoom}, rot=${cam.rot}, k=${k}, 世界点 ${wx},${wy})`);
    }
  }
});

ok('keystone 方向：k > 0 = 低头看桌面（下缘放大、上缘缩小）', () => {
  const cam = { x: 0, y: 0, zoom: 1, rot: 0 };
  const near = project(cam, W, H, 0, 200, 0.00022);    // 屏幕上缘（远）
  const far = project(cam, W, H, 0, 900, 0.00022);     // 屏幕下缘（近）
  const spanNear = Math.abs(near.y - 540);
  const spanFar = Math.abs(far.y - 540);
  // 下缘离摄影机更近 ⇒ 放大得更多
  A.ok(spanFar > spanNear, `k>0 应该是下缘放大：上缘 ${spanNear.toFixed(1)} 下缘 ${spanFar.toFixed(1)}`);
  // 而"裁掉下缘、把上缘拉下来"就是屏幕上视野变宽 —— 这正是 pdoom 俯视地图要的效果
  const wide = 2 * spanNear / 1080;   // 半视野比例
  A.ok(wide < 1, '上缘必须仍然落在画面里（不然就是地平线进画面了）');
});

ok('camXform 在 k = 0 时退化成纯平移缩放（无透视矩阵）', () => {
  const xf = camXform({ x: 0, y: 0, zoom: 1, rot: 0 }, W, H, 0);
  A.equal(xf.proj, undefined, 'k = 0 时不该给 proj（老场景走的是 affine 分支，行为一字不变）');
  near(xf.scale, 1, 0, 'scale');
  // 摄影机在原点 → 世界原点落在画面中心
  near(xf.x, W / 2, 0, 'x');
  near(xf.y, H / 2, 0, 'y');
  // 偏心机位：世界原点应该落在相应偏移的位置
  const xf2 = camXform({ x: 700, y: 620, zoom: 2, rot: 0 }, W, H, 0);
  near(xf2.x, W / 2 - 700 * 2, 0, '偏心 x');
  near(xf2.y, H / 2 - 620 * 2, 0, '偏心 y');
  near(xf2.scale, 2, 0, 'scale = zoom');
});

ok('camXform 在 k != 0 时给的是完整射影矩阵', () => {
  const xf = camXform({ x: 0, y: 0, zoom: 1, rot: 0 }, W, H, 0.00022);
  A.ok(Array.isArray(xf.proj) && xf.proj.length === 9, 'proj 必须是 9 个元素');
  A.ok(xf.proj.every((v) => Number.isFinite(v)), 'proj 不能有 NaN');
  // 地平线太近（k 很大）时必须**放弃透视**而不是出鬼影
  const bad = camXform({ x: 0, y: 0, zoom: 1, rot: 0 }, W, H, 0.01);
  A.equal(bad.proj, undefined, '地平线进画面时应退回不做透视');
});

ok('setXform 的 p/q 默认 0（老场景行为一字不变）', () => {
  const m = xformForward(W, H, { x: 40, y: -20, scale: 1.3, rot: 0.2, anchor: null });
  near(m[2], 0, 0, '第 3 行 x 系数');
  near(m[5], 0, 0, '第 3 行 y 系数');
  near(m[8], 1, 0, '第 3 行常数项');
});

console.log(`\n全部 ${n} 项通过`);
