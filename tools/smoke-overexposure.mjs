// P0-3 回归测试：把「运动模糊求平均忘了清空 avgRT」这个历史 bug 重新注入，
// 断言 check 必须报出来（以前 check 只跑 samples:1，一路报「没问题」，成片却白到发光）。
//
// 做法：改 src/core/engine.js 那一行 → 跑 check → 断言退出码非 0 且提到「两条路径不一致」→ 还原源码。
// 注意：跑之前会先把文件还原（幂等），跑完无论成败都还原。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'src', 'core', 'engine.js');
const GOOD = 'this.gl.clear(this.avgRT, [0, 0, 0], 0);';
const BAD = '/* 注入的回归 bug：不清空 avgRT */ void 0;';

const original = readFileSync(ENGINE, 'utf8');
const restore = () => { try { writeFileSync(ENGINE, original); console.log('· 已还原 src/core/engine.js'); } catch { /* ignore */ } };
process.on('exit', restore);

if (!original.includes(GOOD)) {
  console.error(`✗ engine.js 里找不到要注入的那一行：${GOOD}`);
  process.exit(2);
}

function run(args) {
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += String(d); });
  child.stderr.on('data', (d) => { out += String(d); });
  return new Promise((r) => child.on('close', (code) => r({ code, out })));
}

console.log('① 先跑一次正常 check（应当通过）…');
const ok = await run([path.join(ROOT, 'scripts', 'anim.mjs'), 'check', 'demo']);
const okPass = ok.code === 0;
console.log(`   退出码 ${ok.code} → ${okPass ? 'PASS' : 'FAIL'}`);

console.log('② 注入 bug（注释掉 clear(avgRT)）再跑 check …');
writeFileSync(ENGINE, original.replace(GOOD, BAD));
const bad = await run([path.join(ROOT, 'scripts', 'anim.mjs'), 'check', 'demo']);
restore();
const caught = bad.code !== 0 && /两条路径不一致/.test(bad.out);
console.log(bad.out.trim().split('\n').slice(-14).map((l) => '   ' + l).join('\n'));
console.log(`   退出码 ${bad.code}（期望非 0），点名「两条路径不一致」 → ${caught ? 'PASS' : 'FAIL'}`);

console.log(`\n总判定：${okPass && caught ? 'PASS ✓ check 能挡住这个 bug' : 'FAIL ✗ 检查没能挡住'}`);
process.exit(okPass && caught ? 0 : 1);
