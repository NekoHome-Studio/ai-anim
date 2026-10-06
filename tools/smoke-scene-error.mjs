// P0-3 回归（注入式）：**场景 render 抛异常必须是硬失败**，而且画面必须一眼看出是崩了。
//
// 背景（docs/IMPROVEMENTS-2.md P0-3）：做 beast 时 `scenes/outro.js` 里
//     const slot = ctx.params?.slot;   // 遮蔽了 _kit.js 的 slot() 画格子函数
// 于是包裹卡片一画就 TypeError。引擎 catch 住，把整帧涂成**暗红 (0.15,0,0)**，
// 文字图形全无 —— 而 `check` 三处采样全绿、控制台一个字都没有、
// 单帧与多子帧也一致。靠人眼抽帧（sheet 116–127.5s）才看出来"121.2s 之后整屏暗红"。
//
// 怎么做：建一个**最小夹具任务** tasks/_boom（一个正常的"底"段 + 一段必抛异常的场景），
// 跑 still + check，量出图的实际像素。断言的落点全是"行为"，不是日志文本：
//   ① still 必须非零退出，并且点名 boom 段；
//   ② check 必须非零退出，并且把场景异常**当成错误**（不是附注）；
//   ③ 那一帧必须是**错帧卡片**（贴边亮红框 + 暗红底），不是普通暗红整帧；
//   ④ 夹具自检：把 boom 段换成正常场景后 check 必须回到 0（证明这套判据不是"永远报错"）。
//
//   node tools/smoke-scene-error.mjs
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = '_boom';
const DIR = path.join(ROOT, 'tasks', TASK);

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

function run(args, timeoutMs = 900000) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), ...args], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeoutMs);
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err, all: out + err }); });
  });
}

/**
 * 用 ffmpeg 把 PNG 解成 RGBA（比自己写 PNG 解码器可靠 —— zlib / 滤波 / 隔行 都是坑）。
 * @returns {Buffer}
 */
function pngPixels(file) {
  return execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 1 << 28 },
  );
}

const fixtureConfig = (broken) => `// 由 tools/smoke-scene-error.mjs 生成（P0-3 回归夹具，跑完会删掉）
import { seq, cut } from '../../src/timeline.js';
import bg from './scenes/bg.js';
${broken ? "import boom from './scenes/boom.js';\n" : "import ok from './scenes/ok.js';\n"}
export default {
  title: '_boom',
  width: 320, height: 180, fps: 30, scale: 1,
  timeline: seq([
    cut(bg, { dur: 2, world: false }),
${broken ? "    cut(boom, { dur: 2, world: false }),\n" : "    cut(ok, { dur: 2, world: false }),\n"}
  ]),
};
`;

const bgScene = `// 正常的一段底（夹具用）——亮度要够，别触发 check 的"几乎全黑"判据
export default {
  id: 'bg',
  render(ctx) {
    ctx.gl.clear(ctx.out, [0.18, 0.20, 0.24]);
    return { grain: 0, vignette: 0, bloom: 0 };
  },
};
`;

const boomScene = `// 一调用 render 就抛 —— 模拟 beast 那次"helper 名字被遮蔽"的 TypeError
export default {
  id: 'boom',
  render() {
    return helperThatDoesNotExist();
  },
};
`;

const okScene = `// 与 boom 对应的正常版本（夹具自检用：同样的位置、同样的时长，只是不抛）
export default {
  id: 'ok',
  render(ctx) {
    ctx.gl.clear(ctx.out, [0.18, 0.20, 0.24]);
    return { grain: 0, vignette: 0, bloom: 0 };
  },
};
`;

function writeFixture(broken) {
  mkdirSync(path.join(DIR, 'scenes'), { recursive: true });
  writeFileSync(path.join(DIR, 'task.config.mjs'), fixtureConfig(broken));
  writeFileSync(path.join(DIR, 'scenes', 'bg.js'), bgScene);
  writeFileSync(path.join(DIR, 'scenes', 'boom.js'), boomScene);
  writeFileSync(path.join(DIR, 'scenes', 'ok.js'), okScene);
}

try {
  console.log(`建夹具 tasks/${TASK}（坏版本）…`);
  writeFixture(true);

  console.log('\n① still 必须非零退出并点名 boom');
  // ⚠ `--only` 会把选中的段**平移到时间轴开头**，所以 -t 是段内时间（这里段长 2s）
  const still = await run(['still', TASK, '-t', '1.0', '--only', 'boom', '--samples', '1']);
  say(still.code !== 0, `still 退出码 ${still.code}（期望非 0）`);
  say(/boom/.test(still.all), 'still 点名了 boom 段');
  say(/错帧卡片|场景异常|抛异常/.test(still.all), 'still 说明了这是"场景异常/错帧"');

  console.log('\n② check 必须非零退出，并把场景异常当成错误');
  const chk = await run(['check', TASK, '--quick']);
  say(chk.code !== 0, `check 退出码 ${chk.code}（期望非 0）`);
  say(/boom/.test(chk.all), 'check 点名了 boom 段');
  say(/\[场景异常\]|场景在渲染时抛异常/.test(chk.all), 'check 把场景异常列进了错误（不是只在末尾附注）');

  console.log('\n③ 那一帧必须是错帧卡片（贴边亮红框 + 暗红底）');
  const png = path.join(ROOT, 'out', TASK, 'stills', 'f_0001.000.png');
  if (!existsSync(png)) {
    say(false, `没有找到 ${path.relative(ROOT, png)}`);
  } else {
    const buf = pngPixels(png);     // 320×180 RGBA
    const at = (x, y) => { const o = (y * 320 + x) * 4; return [buf[o], buf[o + 1], buf[o + 2]]; };
    const top = at(160, 2);         // 上边框
    const mid = at(160, 90);        // 画面中心（红框以内、色带以外）
    const lum = (c) => (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 255;
    say(top[0] > 140 && top[1] < 120 && top[2] < 120, `上边框是亮红 rgb(${top.join(',')})（期望 R>140 且 G/B<120）`);
    say(mid[0] < 130 && lum(mid) < 0.35, `画面中心是暗红底 rgb(${mid.join(',')})（期望偏暗）`);
    // 关键是「一眼能看出崩了」：红框与底的差别必须足够大
    say(Math.abs(top[0] - mid[0]) > 60 || lum(top) > lum(mid) * 2 + 0.15,
      `红框与底的对比足够明显（${lum(top).toFixed(3)} vs ${lum(mid).toFixed(3)}）`);
  }

  console.log('\n④ 夹具自检：换成正常场景后 check 必须回到 0');
  writeFixture(false);
  const back = await run(['check', TASK, '--quick']);
  say(back.code === 0, `正常场景 check 退出码 ${back.code}（期望 0）`);
  if (back.code !== 0) console.log(back.all.split('\n').slice(-25).join('\n'));
} finally {
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(path.join(ROOT, 'out', TASK), { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过');
process.exit(fails ? 1 : 0);
