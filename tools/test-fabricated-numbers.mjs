#!/usr/bin/env node
// @ts-check
/**
 * 1-22「画面上的数字必须有出处」的**离线单测**（不需要 GPU / 浏览器 / Vite）。
 *
 * 跑法：
 *   node tools/test-fabricated-numbers.mjs
 *
 * 为什么要有这份（而不是只留一个工具）：
 *   `tools/lint-fabricated-numbers.mjs` 的判据是**边界**问题 —— 它只扫"数值显示位"。
 *   边界一放宽（把坐标/字号也算进去），工具会从"有用"变成"没人看"；边界一收紧
 *   （漏掉包装函数、漏掉流向变量），工具会变成"看着过了其实没查"。两种都不报错。
 *   所以这份测试钉住三件事：**正例必须响、反例必须静、条数必须对得上**。
 *   夹具在 `tools/fixtures/lint-numbers/tasks/`（用 `--dir` 指过去，不进 `tasks/`
 *   —— 那会污染 `anim tasks` 的任务列表）。
 *
 * 断言分组：
 *   §1 正例：编造的数字被点名，且报的是真实的 `文件:行号` + 角色 + 原样
 *   §2 反例：零命中（坐标/字号/时长/阈值/颜色/枚举串/注释/算出来的数都不算）
 *   §3 判据边界：显示位**条数**与角色逐条钉死（谁放宽判据，这里当场红）
 *   §4 空 ≠ 干净：没有 FACTS.md 的任务安静跳过、打印"没验"、**不改变退出码**
 *   §5 退出码三档：1 / 0 / 2（`--json` 恒 0）
 *   §6 机器可读输出（`--json` 的契约：调用方靠它决定怎么办）
 *   §7 源码自检（防"判据被改宽/改窄"而测试还绿着）
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TOOL = path.join('tools', 'lint-fabricated-numbers.mjs');
const FIXTURES = 'tools/fixtures/lint-numbers/tasks';

/* ══════════════════════════════════════ 断言小工具 */

let pass = 0;
let fail = 0;
const failures = [];
/** @param {string} name @param {boolean} cond @param {string} [extra] */
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${extra ? `\n        ← ${extra}` : ''}`); }
}
/** 断言"文本里有这一段"（把实际值打进失败信息，不然调试得重跑） */
function has(name, text, needle) {
  ok(name, text.includes(needle), `没找到：${JSON.stringify(needle)}\n        实际：${JSON.stringify(text.slice(0, 400))}`);
}
function hasNot(name, text, needle) {
  ok(name, !text.includes(needle), `不该出现却出现了：${JSON.stringify(needle)}`);
}
const eq = (name, got, want) => ok(name, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`);

/* ══════════════════════════════════════ 跑工具（子进程，拿真实退出码与真实输出） */

/**
 * 跑一次工具。**cwd 固定仓库根**（和人的用法一致 —— 输出里的路径也就是仓库相对路径）。
 * 工具是脚本不是模块（import 会直接执行 CLI），所以只能子进程跑；这也正好测到退出码。
 * @param {string[]} args
 */
function run(args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: ROOT, encoding: 'utf8' });
  if (r.error) throw new Error(`起不了子进程：${r.error.message}`);
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 只吃 `--json` 那一路（退出码恒 0，判据看 summary / tasks） */
function runJson(args) {
  const r = run([...args, '--json']);
  try { return { ...r, json: JSON.parse(r.out) }; }
  catch (e) { throw new Error(`--json 的输出不是 JSON：${String(e.message)}\n${r.out.slice(0, 400)}`); }
}

const all = run([`--dir`, FIXTURES, '--max', '0']);
const allJson = runJson([`--dir`, FIXTURES, '--max', '0']).json;
/**
 * 某个夹具任务的 JSON 结果。
 * ⚠ 断言"反例里的 3 没被报出来"时**不能**在输出文本上做子串匹配 —— `「0.3」` 里就含 `3`，
 * 那种断言会假通过。一律走 JSON 的**值集合**（`unmatched[].value` / `slots[].value`）。
 */
const taskOf = (name) => allJson.tasks.find((t) => t.name === name);

/* ══════════════════════════════════════ §1 正例 */

console.log('\n§1 正例：编造的数字必须被点名\n');
{
  eq('整目录跑：有命中 ⇒ 退出码 1', all.code, 1);
  has('点名了那个值', all.out, '原样：「3762」');
  has('报的是真实文件:行号（仓库相对路径）', all.out, 'tools/fixtures/lint-numbers/tasks/zz-fake-positive/scenes/fake.js:26');
  has('说了它算哪一类显示位（文字入口）', all.out, '〔文字入口 type.writeLine()〕');
  has('把那一行源码打出来（人能直接照着改）', all.out, "type.writeLine('这个数是编的：3762 次'");
  has('结论行给出"几个值找不到出处"', all.out, '❌ zz-fake-positive —— 显示位 1 个数字，1 个值找不到出处');

  const only = run([`--dir`, FIXTURES, 'zz-fake-positive', '--max', '0']);
  eq('只跑正例：退出码 1', only.code, 1);
  has('只跑正例时同样点名', only.out, '原样：「3762」');
  hasNot('只跑正例时不该提别的夹具任务', only.out, 'zz-fake-negative');
}
/* ══════════════════════════════════════ §2 反例 */

console.log('\n§2 反例：坐标 / 字号 / 时长 / 阈值 / 颜色 / 注释 / 算出来的数，一个都不许报\n');
{
  has('反例任务是 ✅', all.out, '✅ zz-fake-negative —— 显示位 0 个数字，0 个值找不到出处');
  has('0 个显示位时提醒"用 --slots 复核判据"（0 命中 ≠ 判据跑过）', all.out, '是「真的没有」，还是判据没覆盖到它的写法？用 --slots 复核');

  const neg = run([`--dir`, FIXTURES, 'zz-fake-negative', '--max', '0']);
  eq('反例单独跑：干净 ⇒ 退出码 0', neg.code, 0);
  ok('反例的输出里没有任何 ❌', !neg.out.includes('❌'), neg.out.slice(0, 300));
  ok('反例的输出里没有一条 `原样：`（没有命中）', !neg.out.includes('原样：'), neg.out.slice(0, 300));

  // 反例文件里那些数字，逐个证明"没被报出来"。
  // 判据 = **实际报出来的值集合**里没有它（不是子串匹配 —— `0.3` 里含 `3`，那种断言会假通过）。
  const negVals = taskOf('zz-fake-negative').unmatched.map((u) => u.value);
  eq('反例报出来的值集合是空的', JSON.stringify(negVals), '[]');
  for (const n of ['1920', '1080', '640', '240', '0.06', '0.9', '12.5', '0.3', '24', '2026', '10', '3', '42']) {
    ok(`反例里的 ${n} 没进命中`, !negVals.includes(n), JSON.stringify(negVals));
  }
}

/* ══════════════════════════════════════ §3 判据边界（条数钉死） */

console.log('\n§3 判据边界：显示位的**条数与角色**逐条钉死（谁放宽判据，这里当场红）\n');
{
  const slotsJson = runJson([`--dir`, FIXTURES, '--slots', '--max', '0']).json;
  const slotsOf = (n) => (slotsJson.tasks.find((t) => t.name === n)?.slots ?? []).map((s) => s.value);

  // 条数：反例 0 个、正例 1 个、混合 4 个（42 / 3762 / 07 / 3359）
  eq('反例的显示位 == 0 个（坐标/字号/时长/阈值/颜色/注释/算出来的数全不算）',
    taskOf('zz-fake-negative').slotCount, 0);
  eq('正例的显示位 == 1 个', taskOf('zz-fake-positive').slotCount, 1);
  eq('混合任务的显示位 == 4 个', taskOf('zz-fake-mixed').slotCount, 4);
  eq('混合任务按顺序收对了这 4 个值',
    JSON.stringify(slotsOf('zz-fake-mixed')), JSON.stringify(['42', '3762', '07', '3359']));
  eq('反例的 --slots 是空的', JSON.stringify(slotsOf('zz-fake-negative')), '[]');
  eq('正例的 --slots 只有那一个值', JSON.stringify(slotsOf('zz-fake-positive')), JSON.stringify(['3762']));

  // 反例文件里的数字：**判据**（--slots）与**命中**（unmatched）两层都不许出现
  for (const n of ['1920', '1080', '640', '240', '0.06', '0.9', '12.5', '0.3', '24', '2026', '10', '3', '42']) {
    ok(`反例里的 ${n} 没进判据（--slots）`, !slotsOf('zz-fake-negative').includes(n), JSON.stringify(slotsOf('zz-fake-negative')));
  }

  // 人类读的口径行与 JSON 必须一致（否则"读到的东西"和"判据"会各说各话）
  has('口径行：反例 0 个显示位', all.out, '✅ zz-fake-negative —— 显示位 0 个数字，0 个值找不到出处');
  has('口径行：正例 1 个显示位', all.out, '❌ zz-fake-positive —— 显示位 1 个数字，1 个值找不到出处');
  has('口径行：混合 4 个显示位 / 3 个找不到出处', all.out, '❌ zz-fake-mixed —— 显示位 4 个数字，3 个值找不到出处');

  // `--max` 只影响明细条数，不影响判据与退出码
  eq('--max 1 时退出码仍是 1（截断的是显示，不是判据）', run([`--dir`, FIXTURES, '--max', '1']).code, 1);
  has('--max 1 仍点名', run([`--dir`, FIXTURES, '--max', '1']).out, '原样：「');

  // `--explain`：**两类都报**（有出处的附出处行号，没有的标为找不到）
  const ex = run([`--dir`, FIXTURES, 'zz-fake-mixed', '--explain', '--max', '0']);
  eq('只跑混合任务 ⇒ 退出码 1', ex.code, 1);
  has('--explain 打出"找到出处的 N 个"', ex.out, '── 找到出处的 1 个（--explain）：');
  has('--explain 给出出处坐标（FACTS.md:行）', ex.out, 'FACTS.md:');
  has('--explain 附带出处原文那一行', ex.out, '42 份协议 XML');
  has('--explain 也把它挂到具体 file:line 上', ex.out, 'task.config.mjs:22 「42」 → FACTS.md:');
  has('同一个任务里没有出处的那个照样点名', ex.out, '原样：「3762」');
  has('未登记的镜号也被点名（真实片子里正是这一条逼出 FACTS §5.1 的编号表）', ex.out, '原样：「07」');
  has('别的任务的数字在别处找不到出处（逐任务各查各的事实表）', ex.out, '原样：「3359」');
}

/* ══════════════════════════════════════ §4 空 ≠ 干净 */

console.log('\n§4 没有 FACTS.md 的任务：安静跳过 + 明说"没验" + 不改变退出码\n');
{
  has('打印了"没有事实表 ⇒ 这一项没验（不是通过）"', all.out, '没有事实表 ⇒ 这一项没验（不是通过）：zz-no-facts');
  has('给了修法（写一份 FACTS.md）', all.out, '写一份 tasks/<任务>/FACTS.md');
  has('"没验"单独计一档，不混进命中数', all.out, '另有 1 个任务**没验**');

  const noFacts = run([`--dir`, FIXTURES, 'zz-no-facts']);
  eq('只跑无事实表的任务 ⇒ 退出码 0（跳过不是失败）', noFacts.code, 0);
  ok('只跑它时没有任何 ❌', !noFacts.out.includes('❌'), noFacts.out.slice(0, 300));
  has('只跑它时也明说"没验"', noFacts.out, '没有事实表 ⇒ 这一项没验（不是通过）：zz-no-facts');

  // 真仓库里那 12 个没有事实表的任务（demo 是代表）：同一套语义
  const demo = run(['demo']);
  eq('真任务 demo（没有 FACTS.md）⇒ 退出码 0', demo.code, 0);
  has('demo 被安静跳过并点名"没验"', demo.out, '没有事实表 ⇒ 这一项没验（不是通过）：demo');
  has('demo 的显示位是 0（没有 FACTS 就没得比，不是"干净"）', demo.out, '扫 0 个有事实表的任务');
}

/* ══════════════════════════════════════ §5 退出码三档 */

console.log('\n§5 退出码：有命中 1 / 干净 0 / 用法或任务名写错 2\n');
{
  eq('有命中 ⇒ 1', all.code, 1);
  eq('干净 ⇒ 0', run([`--dir`, FIXTURES, 'zz-fake-negative']).code, 0);

  const badName = run([`--dir`, FIXTURES, 'no-such-task']);
  eq('任务名写错 ⇒ 2', badName.code, 2);
  has('任务名写错：列出可用任务（别静默 0 命中）', badName.err, '没有这些任务：no-such-task');
  has('任务名写错：可用任务里有那些夹具', badName.err, 'zz-fake-positive');

  eq('未知选项 ⇒ 2', run(['--bogus']).code, 2);
  eq('--max 不是数 ⇒ 2', run([`--dir`, FIXTURES, '--max', 'abc']).code, 2);
  eq('--dir 不存在 ⇒ 2', run(['--dir', 'no/such/dir']).code, 2);

  eq('--json 恒 0（调用方自己读 summary）', run([`--dir`, FIXTURES, '--json']).code, 0);
  eq('--help ⇒ 0', run(['--help']).code, 0);
  has('--help 里有判据与退出码说明', run(['--help']).out, '退出码：有找不到出处的数字 → 1；干净 → 0；用法/任务名写错 → 2');
}

/* ══════════════════════════════════════ §6 --json 契约 */

console.log('\n§6 --json：机器可读的契约（调用方靠它决定怎么办）\n');
{
  const { json } = runJson([`--dir`, FIXTURES, '--max', '0']);
  eq('tool 名字', json.tool, 'lint-fabricated-numbers');
  eq('summary.tasks == 3（三个有事实表的夹具）', json.summary.tasks, 3);
  eq('summary.unmatched == 4（正例 1 + 混合 3）', json.summary.unmatched, 4);
  eq('summary.slots == 5（正例 1 + 混合 4）', json.summary.slots, 5);
  eq('summary.skipped == 1（没验的那一个）', json.summary.skipped, 1);
  eq('skipped 里点了名与原因', JSON.stringify(json.skipped), JSON.stringify([{ name: 'zz-no-facts', reason: '没有 FACTS.md' }]));

  const pos = taskOf('zz-fake-positive');
  const neg = taskOf('zz-fake-negative');
  const mix = taskOf('zz-fake-mixed');
  ok('三个有事实表的夹具都在', !!pos && !!neg && !!mix);
  eq('正例 slotCount == 1', pos.slotCount, 1);
  eq('反例 slotCount == 0', neg.slotCount, 0);
  eq('混合 slotCount == 4', mix.slotCount, 4);
  eq('正例 unmatched 一条', pos.unmatched.length, 1);
  eq('混合 unmatched 三条', mix.unmatched.length, 3);
  eq('混合的三条按值给全', JSON.stringify(mix.unmatched.map((u) => u.value)), JSON.stringify(['3762', '07', '3359']));
  eq('unmatched[0].value', pos.unmatched[0].value, '3762');
  eq('unmatched[0].at 是 file:line', pos.unmatched[0].at, 'tools/fixtures/lint-numbers/tasks/zz-fake-positive/scenes/fake.js:26');
  eq('unmatched[0].role 说了它算哪一类显示位', pos.unmatched[0].role, '文字入口 type.writeLine()');
  ok('unmatched[0].code 是那一行源码（人能照着改）', pos.unmatched[0].code.includes("'这个数是编的：3762 次'"), pos.unmatched[0].code);
  eq('反例 unmatched 为空数组', JSON.stringify(neg.unmatched), '[]');
  ok('criteria 里写明了判据（不然读 JSON 的人不知道这条命中是什么意思）',
    typeof json.criteria === 'string' && json.criteria.includes('数值显示位'), json.criteria);

  // `--explain` 打开时，JSON 里也要有 matched（附出处坐标与原文）
  const exJson = runJson([`--dir`, FIXTURES, 'zz-fake-mixed', '--explain']).json;
  const exMix = exJson.tasks.find((t) => t.name === 'zz-fake-mixed');
  eq('--explain 时 matched 有 1 条', exMix.matched.length, 1);
  eq('matched[0].value == 42', exMix.matched[0].value, '42');
  ok('matched[0].source 指到 FACTS.md 的某一行', /^FACTS\.md:\d+$/.test(exMix.matched[0].source), exMix.matched[0].source);
  ok('matched[0].sourceText 是那一行的原文', exMix.matched[0].sourceText.includes('42 份协议 XML'), exMix.matched[0].sourceText);
}

/* ══════════════════════════════════════ §7 源码自检 */

console.log('\n§7 源码自检：判据、文案与"空 ≠ 干净"的措辞都还在\n');
{
  const src = readFileSync(path.join(ROOT, TOOL), 'utf8');

  // ① 判据边界：不该算的那几类必须仍然不在 DISPLAY_KEYS 里
  const keysBlock = src.slice(src.indexOf('const DISPLAY_KEYS'), src.indexOf(']);', src.indexOf('const DISPLAY_KEYS')));
  for (const k of ['values', 'title', 'sub', 'footer', 'label', 'unit', 'caption', 'text']) {
    ok(`DISPLAY_KEYS 里仍然有 ${k}`, keysBlock.includes(`['${k}'`), keysBlock.replace(/\s+/g, ' ').slice(0, 300));
  }
  for (const k of ['note', 'size', 'dur', 'x', 'y', 'bloom', 'peak', 'color', 'family', 'anchor']) {
    ok(`DISPLAY_KEYS 里没有 ${k}（它不是画面文字）`, !keysBlock.includes(`['${k}'`), keysBlock.replace(/\s+/g, ' ').slice(0, 300));
  }

  // ② "安静跳过"的措辞与退出码语义：跳过不许改退出码
  has('源码里"没验"的措辞是这一句（DIAGNOSIS 要按原句登记）', src, '没有事实表 ⇒ 这一项没验（不是通过）');
  has('源码里写明了"跳过不是通过"', src, '跳过不是通过');
  has('退出码只由 unmatched 决定', src, 'process.exit(totalUnmatched ? 1 : 0)');

  // ③ 文字入口的名单不许悄悄缩水（缩了就是漏检）
  const fns = src.slice(src.indexOf('const DISPLAY_FNS'), src.indexOf(']);', src.indexOf('const DISPLAY_FNS')));
  for (const f of ['write', 'writeLine', 'karaoke', 'paragraph', 'put', 'codeRow', 'caption', 'kicker', 'footer']) {
    ok(`文字入口名单里仍然有 ${f}`, fns.includes(`'${f}'`), fns);
  }

  // ④ 包装函数（判据 D）与流向（判据 A/B）的实现还在（删了就会静默漏检）
  has('包装函数预扫还在', src, 'function collectWrappers(');
  has('流向追踪还在', src, 'function buildFlow(');
  has('注释被替换成等长空白（行号才可信）', src, '注释被替换成**等长空白**');

  // ⑤ 输出路径必须是仓库相对（不然报告里的 file:line 点不进编辑器）
  has('路径归一化：仓库内一律相对仓库根', src, 'const relOf = (p) =>');
  ok('报告路径里不会再出现 "../"', !all.out.includes('../'), all.out.slice(0, 200));
  hasNot('报告路径里不会再出现 out/_staging', all.out, 'out/_staging');
}

/* ══════════════════════════════════════ 汇总 */

console.log(`\n${fail ? '✗' : '✓'} ${pass} 项通过${fail ? `，${fail} 项失败：${failures.join(' / ')}` : ''}\n`);
process.exitCode = fail ? 1 : 0;
