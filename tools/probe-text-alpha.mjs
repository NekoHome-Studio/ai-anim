// P1-3 验收：`type.write` 的 `alpha` 必须在 `stagger: 0` 时也参与动画。
//
// 背景（docs/IMPROVEMENTS.md P1-3）：text.js 里那行
//     const k = stagger > 0 ? sat((t - at) / dur) : 1;
// 让「整行淡入」在 stagger=0 时永远取到 k=1 —— alpha 的起始值根本取不到，
// 整行直接以终值出现。两个任务的 _kit.js 都只能用 `stagger: 1e-4` 这种 hack 绕过。
//
// 怎么做：在**真实引擎**里挂一条临时时间线，只有一个场景、一行字、
//   `alpha: [0, 1]`、`stagger: 0`、`t = f.lt`，然后在 t=0 / 0.5 / 1 三个时刻
//   量整帧平均亮度（显示空间）。
//
// 判据（机械的，不靠看图）：
//   ① t=0   几乎全黑（字还没出现）
//   ② t=0.5 明显亮于 t=0（真的在淡入）
//   ③ t=1   明显亮于 t=0.5（到位了）
// 修复前 ① 失败（t=0 就已经是终值）；`stagger:1e-4` 那个 hack 下 ①②③ 都成立。
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = process.argv[2] ?? '_calib';

// 复用 CLI 的浏览器会话：用一个「跑完就退出」的 still 把页面拉起来，
// 然后另起一个 WebSocket 通道太麻烦 —— 直接让 CLI 执行我们的探针更干净。
// 所以这里转发到 anim.mjs 的 `probe-alpha` 子命令（见 scripts/anim.mjs）。
const args = [path.join(ROOT, 'scripts', 'anim.mjs'), 'probe-alpha', TASK];
console.log(`$ node ${args.slice(1).join(' ')}`);
const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
const code = await new Promise((r) => child.on('close', r));
process.exit(code ?? 1);
