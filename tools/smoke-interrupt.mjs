// P0-2 回归测试：渲染中断必须让 video 以非零码退出，而不是报「出片成功」。
//
// 做法：起一次真正的 video 渲染，等它开始推帧之后**故意改一个文件**（模拟"渲染期间碰工作区"），
// CLI 的私有 Vite 会 HMR 重载页面 → WebSocket 断开 → 推帧提前结束。
// 断言：CLI 退出码非 0，且输出里有「只渲染了 N/M 帧」。
//
// 注意：`video` 默认用私有 Vite（不设 --url，必须 `!opt('url','')` 才会带上 ANIM_NO_HMR=1）。
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASK = '_calib';
const OUT = path.join(ROOT, 'out', TASK, `${TASK}.mp4`);
const TOUCH = path.join(ROOT, 'tasks', TASK, 'scenes', 'probe.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const original = readFileSync(TOUCH, 'utf8');
const restore = () => { try { writeFileSync(TOUCH, original); } catch { /* ignore */ } };
process.on('exit', restore);

if (existsSync(OUT)) rmSync(OUT);

const args = [path.join(ROOT, 'scripts', 'anim.mjs'), 'video', TASK, '--from', '0', '--to', '30', '--fps', '30'];
console.log(`$ node ${args.slice(1).join(' ')}`);
const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
let err = '';
let touched = false;
child.stdout.on('data', (d) => {
  out += String(d);
  if (!touched && /\d+\/\d+ 帧/.test(out)) {
    touched = true;
    // 渲染已经开始 → 模拟「渲染期间改了工作区里的文件」
    appendFileSync(TOUCH, `\n// 渲染期间被改动 ${Date.now()}\n`);
    console.log('· 已在渲染中途改动 tasks/_calib/scenes/probe.js（触发 HMR 重载）');
  }
});
child.stderr.on('data', (d) => { err += String(d); });

const code = await new Promise((r) => child.on('close', r));
restore();

const expected = /只渲染了 \d+\/\d+ 帧/.test(out + err);
const failed = code !== 0;
const mp4 = existsSync(OUT) ? statSync(OUT).size : 0;

console.log('--- stdout ---\n' + out.trim());
console.log('--- stderr ---\n' + err.trim());
console.log(`\n退出码 ${code}（期望非 0）  → ${failed ? 'PASS' : 'FAIL'}`);
console.log(`点名帧数不足  → ${expected ? 'PASS' : 'FAIL'}`);
console.log(`残留 mp4：${mp4 ? `${mp4} 字节（应当被删掉）` : '没有（已清理）'}`);
const cleanup = mp4 === 0;
console.log(`清理不完整产物  → ${cleanup ? 'PASS' : 'FAIL'}`);
if (!touched) { console.log('⚠ 没能在渲染中途插进去（渲染太快？）——本次结论不算数'); process.exit(2); }
process.exit(failed && expected && cleanup ? 0 : 1);
