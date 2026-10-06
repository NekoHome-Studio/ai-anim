// P2-3 回归：`prog()` 的缓动名写错必须**警告**，而不是静默退化成 linear。
//
// 背景（docs/IMPROVEMENTS-2.md P2-3）：`ease[name] ?? ease.linear` —— 拼错一个字母
// （`'outCubicc'`）画面上只是"动起来有点平"，完全看不出是打错了字。
//
// 难点：`src/core/util.js` 里没有 `import.meta`，但它 import 了别的模块、也不能直接
// 在 Node 里当"纯 JS"跑一整套 —— 其实可以（util.js 不依赖 Vite 的注入）。
// 所以直接 import 真文件，验**真代码**而不是抄一份。
//
//   node tools/test-easing-warn.mjs
import { prog, keys, ease } from '../src/core/util.js';

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

/** 抓 console.warn（并临时静音，免得刷屏）。 */
function captureWarn(fn) {
  const seen = [];
  const orig = console.warn;
  console.warn = (...a) => { seen.push(a.join(' ')); };
  try { fn(); } finally { console.warn = orig; }
  return seen;
}

console.log('P2-3 `prog()` / `keys()` 的未知缓动名：');

const warns = captureWarn(() => {
  // ① 拼错的名字：必须警告，且退回 linear
  const v1 = prog(0.5, 0, 1, 'outCubicc');
  say(Math.abs(v1 - 0.5) < 1e-9, `未知缓动名退回 linear（prog(0.5,0,1,'outCubicc') = ${v1}）`);
  // ② 同一个错名字第二次不应该再警告（去重）
  prog(0.25, 0, 1, 'outCubicc');
  // ③ keys() 里的错名字也要警告
  keys(0.5, [[0, 0], [1, 1, 'nopeEase']]);
});
say(warns.some((w) => /未知的缓动名/.test(w) && /outCubicc/.test(w)), '对 prog 的错名字给出了警告');
say(warns.filter((w) => /outCubicc/.test(w)).length === 1, `同一个错名字只警告一次（实际 ${warns.filter((w) => /outCubicc/.test(w)).length} 次）`);
say(warns.some((w) => /nopeEase/.test(w)), '对 keys 的错名字也给出了警告');
say(warns.some((w) => /prog/.test(w)) && warns.some((w) => /keys/.test(w)), '警告里带上了调用处（prog / keys）');
for (const w of warns) console.log(`      · ${w}`);

console.log('\n正确用法不能被打扰：');
const quiet = captureWarn(() => {
  prog(0.5, 0, 1, 'outCubic');
  prog(0.5, 0, 1, 'inOutQuad');
  prog(0.5, 0, 1);                       // 缺省 linear
  keys(0.5, [[0, 0], [1, 1, 'inOutCubic']]);
  keys(0.5, [[0, 0], [1, 1]]);           // 缺省 inOutCubic
});
say(quiet.length === 0, `正确名字与缺省一个警告都没有（实际 ${quiet.length} 条）`);

const known = Object.keys(ease).length;
say(known > 15, `ease 表里有 ${known} 个名字（警告里会全部列出来，方便直接挑）`);

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 全部通过：错名字会响，对名字不打扰');
process.exit(fails ? 1 : 0);
