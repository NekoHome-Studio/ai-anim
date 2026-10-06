// @ts-check
/**
 * NV12（YUV420）的 **CPU 参考实现** —— 与 GPU 那一条（`src/core/gl.js` 的 `readNV12`）逐字对应：
 * 全范围 sRGB → BT.709 limited、4:2:0、色度取 2×2 盒式平均。
 *
 * 为什么要有它：出片推流给 ffmpeg 的是 NV12（`docs/PERF.md` §5.4a），
 * 而**渲染、check、hashes 都走不到这条编码路径**（它们用 `readPixels` 的 sRGB RGBA）。
 * 于是"NV12 算错了"这件事只能靠**另一条独立的实现**来抓 —— 就是这里。
 *
 *   · `tools/probe-nv12.mjs`：GPU 的 NV12 vs 这个参考实现（判据 ±1，量的是编码本身对不对）
 *   · `tools/probe-determinism.mjs` / `probe-frame-drift.mjs`：把 RGBA 的裸帧比到 NV12 空间
 *
 * @param {Uint8Array|Buffer} rgba sRGB RGBA，逐行**自下而上**（引擎读回的原始顺序）
 * @param {number} w
 * @param {number} h
 * @returns {Uint8Array} NV12：Y 平面（w×h）+ 交错 UV 平面（w/2 × h/2）
 */
export function cpuNV12(rgba, w, h) {
  const y = new Uint8Array(w * h);
  const uv = new Uint8Array((w >> 1) * (h >> 1) * 2);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      const yy = 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2];
      y[j * w + i] = Math.round(Math.max(0, Math.min(255, 16 + (219 / 255) * yy)));
    }
  }
  for (let j = 0; j < (h >> 1); j++) {
    for (let i = 0; i < (w >> 1); i++) {
      let sr = 0, sg = 0, sb = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const o = ((j * 2 + dy) * w + (i * 2 + dx)) * 4;
          sr += rgba[o]; sg += rgba[o + 1]; sb += rgba[o + 2];
        }
      }
      const rr = sr / 4, gg = sg / 4, bb = sb / 4;
      const yy = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      const o2 = (j * (w >> 1) + i) * 2;
      uv[o2] = Math.round(Math.max(0, Math.min(255, 128 + (224 / 255) * ((bb - yy) / 1.8556))));
      uv[o2 + 1] = Math.round(Math.max(0, Math.min(255, 128 + (224 / 255) * ((rr - yy) / 1.5748))));
    }
  }
  const out = new Uint8Array(y.length + uv.length);
  out.set(y, 0);
  out.set(uv, y.length);
  return out;
}

/** 一帧 NV12 的字节数（`w×h×1.5`）。 */
export const nv12Bytes = (w, h) => ((w * h * 3) >> 1);
