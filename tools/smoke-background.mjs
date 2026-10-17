// P0-2 回归测试：**漏画共享背景的段必须被 check 抓住**。
//
// 背景（docs/history/IMPROVEMENTS-1-3.md P0-2）：做 fidus 时 9 个场景里 8 个漏了 `openFrame`，
// 那一段的底是纯黑（只有 grain 和暗角），**不报任何错**；check 的亮度判据是
// `mean < 0.004`，而实测漏画时是 0.054（13 倍）——文字和颗粒自己就有亮度，
// 足够把"黑底"顶到阈值之上。所以这一条以前完全抓不到。
//
// 做法：往 tasks/_calib 里临时加一个"只画一点点文字、不画任何背景"的段，
// 与上一段交叠（这样它才有转场语义），然后跑 check，断言：
//   ① check 退出码非 0
//   ② 输出里点名了这个段（「背景守门」+ 段 id）
// 跑完自动把临时文件删掉。
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = '_calib';
const SCENE = path.join(ROOT, 'tasks', TASK, 'scenes', '_bgcheck.js');
const CFG = path.join(ROOT, 'tasks', TASK, 'task.config.mjs');
const cfgBackup = readFileSync(CFG, 'utf8');

const cleanup = () => {
  try { if (existsSync(SCENE)) rmSync(SCENE); } catch { /* ignore */ }
  try { writeFileSync(CFG, cfgBackup); } catch { /* ignore */ }
};
process.on('exit', cleanup);

// 1) 一个不画背景的段：只写一行字（正是 fidus 里那 8 个的样子）
writeFileSync(SCENE, `// 临时注入（tools/smoke-background.mjs）：故意不画任何背景的段。
import { css } from '../../../src/core/util.js';
export default {
  id: 'bgcheck',
  handlesTransition: true,
  render(ctx) {
    const { text, type, P, f } = ctx;
    // 只写字，不铺底 —— 这一段的底会是纯黑
    text.clear();
    type.write('NO BACKGROUND', 200, 400, { size: 90, weight: 800, color: css(P.bone), t: f.lt });
    text.upload();
    ctx.comp.draw(ctx.gl, text, ctx.out, { premult: false });
    return {};
  },
};
`);

// 2) 挂在时间线末尾，并与上一段交叠
const patched = cfgBackup
  .replace("import { shotA, shotB } from './scenes/trans.js';",
    "import { shotA, shotB } from './scenes/trans.js';\nimport bgcheck from './scenes/_bgcheck.js';")
  .replace(/cut\(shotB, \{ dur: 3, overlap: 0\.6, handlesTransition: true \}\),/,
    "cut(shotB, { dur: 3, overlap: 0.6, handlesTransition: true }),\n    cut(bgcheck, { dur: 2, overlap: 0.5, handlesTransition: true }),");
if (patched === cfgBackup || !patched.includes('bgcheck')) {
  console.error('✗ 没能把注入的段挂进 task.config.mjs（模板变了？）');
  process.exit(2);
}
writeFileSync(CFG, patched);

console.log('· 已注入一个"不画背景"的段，跑 check …');
const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'anim.mjs'), 'check', TASK], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
child.stdout.on('data', (d) => { out += String(d); });
child.stderr.on('data', (d) => { err += String(d); });
const code = await new Promise((r) => child.on('close', r));
cleanup();
const all = out + err;

const nonzero = code !== 0;
const named = /背景守门/.test(all) && /bgcheck/.test(all);
console.log('--- stdout ---\n' + out.trim());
console.log('--- stderr ---\n' + err.trim());
console.log(`\n退出码 ${code}（期望非 0）  → ${nonzero ? 'PASS' : 'FAIL'}`);
console.log(`点名了漏画背景的段  → ${named ? 'PASS' : 'FAIL'}`);
process.exit(nonzero && named ? 0 : 1);
