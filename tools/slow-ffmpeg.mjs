// 慢速 ffmpeg 包装器 —— 只在**测试**里用，按**字节速率**限制 ffmpeg 的输入，
// 用来稳定复现「编码比渲染慢 → CLI 走背压（停发 ack）→ 看门狗该怎么办」这个场景。
//
// 为什么不用真编码器：`-preset veryslow -tune grain` 在 1080p 下只有 3.4 fps，
// 跑一次回归要一分钟以上，而且每次排水的时机都不同，断言会抖。
// 为什么用字节速率而不是"每块延迟 N 毫秒"：后者取决于块大小（帧尺寸、渲染分辨率），
// 换一个 --scale 就完全不是同一个行为了。速率是**与帧尺寸无关**的确定量。
//
//   ANIM_FFMPEG="node tools/slow-ffmpeg.mjs" ANIM_SLOW_MBPS=8 node scripts/anim.mjs ...
//
// 参数原样透传给真 ffmpeg（ANIM_REAL_FFMPEG 可以换掉它）。
import { spawn } from 'node:child_process';

const mbps = Number(process.env.ANIM_SLOW_MBPS ?? 0);      // 0 = 不限速（只做透传）
const real = process.env.ANIM_REAL_FFMPEG ?? 'ffmpeg';
const args = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const passthrough = (bin, argv) => {
  const p = spawn(bin, argv, { stdio: 'inherit' });
  p.on('close', (code) => process.exit(code ?? 0));
  p.on('error', (e) => { console.error('slow-ffmpeg:', e.message); process.exit(127); });
};

// `-version` 之类的探测参数直接转发（CLI 启动时会问一次）
if (!mbps || args.includes('-version') || args.includes('-h') || args.includes('-help')) {
  passthrough(real, args);
} else {
  const bytesPerSec = mbps * 1024 * 1024;
  const child = spawn(real, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const t0 = Date.now();
  let forwarded = 0;

  // 令牌桶：转发得比配额快就把 stdin 停了等一会儿（不消耗 CPU）
  const pump = async () => {
    while (!child.stdin.destroyed) {
      const quota = ((Date.now() - t0) / 1000) * bytesPerSec - forwarded;
      if (quota > 0) break;
      process.stdin.pause();
      await sleep(Math.min(200, (-quota / bytesPerSec) * 1000 + 5));
      process.stdin.resume();
    }
  };

  process.stdin.on('data', (chunk) => {
    forwarded += chunk.length;
    try { child.stdin.write(chunk); } catch { /* ffmpeg 已经退出 */ }
    void pump();
  });
  process.stdin.on('end', () => {
    try { child.stdin.end(); } catch { /* ignore */ }
  });

  child.stdout.pipe(process.stdout);
  child.on('close', (code) => process.exit(code ?? 0));
  child.on('error', (e) => { console.error('slow-ffmpeg:', e.message); process.exit(127); });
}
