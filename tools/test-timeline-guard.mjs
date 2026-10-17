// 单测（不需要 GPU / 浏览器）：时间线这一层守着两件事。
//
// ── 守门一｜旧：时间线 DSL 必须**拒绝**非法节点，而不是静默降级 ──────────────
// 背景（docs/history/IMPROVEMENTS-1-3.md P0-2）：写 beast 时我写了个助手
//     const seg = (id) => ({ scene: SHOT[id], opt: {...} });   // 忘了 return cut(...)
// 旧 `seq()` 照单全收 → 引擎把它当成 N 段匿名场景，每段默认 4 秒：
// `check` 报「时长 48.00s、段名 scene/scene_2/…」，真实时间线是 127.5s / 12 个具名段，
// 而末尾照样 `✓ 没有发现问题`。**片长和段名全错，却一路绿灯。**
// 现在：seq()/par() 立刻校验，build() 兜底再校验一次，报错要指路（"你是不是忘了调 cut()？"）。
//
// ── 守门二｜新：配置档（B 档）展开 ────────────────────────────────────────
// 时间线的一项也可以是**配置档节点**：没有 `scene`、只有字符串 `type`，由 build() 查
// `src/shots/` 的模板表展开成与 cut() 完全一样的段（见 docs/CONFIG-ONLY.md、
// src/timeline.js 的 isConfigNode / TIMELINE_KEYS / configToCut）：
//
//     timeline: [
//       { type: 'title', title: '我的片子', dur: { beat: 8 } },
//       { type: 'chart', values: [0.3, 0.7], title: '成绩', dur: 5, id: 'bars' },
//       { type: 'outro', dur: 3 },
//     ]
//
// 这一层**没有画面可看**，能守的契约只有两条，所以下面全部断言这两条：
//   · 展开对不对：段名 / 起止时间 / scene.render / 拍号 dur / overlap / id 去重；
//   · 写错抛不抛：未知模板名、参数拼错、时间线字段拼错（duur）、配置档与已展开的段混写；
//   · 外加"不该抛的别抛"：全部时间线字段都不许被当成模板参数（TIMELINE_KEYS 得是全的）。
// 注意：模板参数的**类型**不在这一层校验（`headline: 'x'` 也接受），所以这里只断"能展开"
// 与"参数名写错就抛"，不去断画面（断画面要 GPU，那是 still/check 的活）。
//
//   node tools/test-timeline-guard.mjs
import { seq, cut, par, at, build, describe, isConfigNode } from '../src/timeline.js';

let fails = 0;
let total = 0;
function check(name, fn, wantThrow) {
  total++;
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ok = wantThrow ? !!threw : !threw;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${threw ? `\n          → ${String(threw.message).split('\n')[0]}` : ''}`);
  return threw;
}

/**
 * 「必须抛错，**而且**报错信息里能定位」：`pats` 里每一段都要出现在 message 里。
 *
 * 光断"抛了"不够 —— 报错只说一句"非法"就没法一眼找到该改哪一行（P0-2 的教训），
 * 所以位置（`timeline[0]`）、写错的键名、可用取值都要点出来。
 * 输出格式与 check() 一致（`  PASS/FAIL  名字` + `→ 报错首行`），失败时多一行 ✗ 说明缺什么。
 */
function mustThrow(name, fn, ...pats) {
  total++;
  let e = null;
  try { fn(); } catch (err) { e = err; }
  const msg = e ? String(e.message) : '';
  const missing = e ? pats.filter((p) => !msg.includes(p)) : ['（根本没有抛错）'];
  const ok = missing.length === 0;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${msg ? `\n          → ${msg.split('\n')[0]}` : ''}`);
  if (!ok) console.log(`          ✗ 报错信息里找不到：${missing.join(' / ')}`);
  return e;
}

const shot = { id: 'shot', render() {} };
const other = { id: 'other', render() {} };

console.log('P0-2 seq()/par() 对非法节点必须抛错：');

// ① 就是踩到的那个形状：{ scene, opt } —— 忘了调 cut()
check('伪节点 { scene, opt } 被拒绝', () => seq([{ scene: shot, opt: { dur: 4 } }]), true);

// ② undefined / null / 字符串
check('undefined 项被拒绝', () => seq([cut(shot, { dur: 2 }), undefined]), true);
check('字符串项被拒绝', () => seq(['shot']), true);
check('数字项被拒绝', () => seq([1, 2]), true);

// ③ seq 本身收到非数组
check('seq(不是数组) 被拒绝', () => seq({ kind: 'cut', scene: shot }), true);
// ④ par 的第二参数不是数组
check('par(0.5, 不是数组) 被拒绝', () => par(0.5, { scene: shot }), true);
// ⑤ 嵌套里也有伪节点（seq 里套 par 里套伪节点）
check('嵌套 seq/par 里的伪节点被拒绝', () => seq([cut(shot, { dur: 2 }), par(0.5, [{ scene: other }])]), true);

// ⑥ build() 兜底：绕过 seq() 直接手搓 plan 时也要拦得住
check('build() 对手搓的伪节点兜底抛错', () => build({ kind: 'seq', items: [{ scene: shot, opt: { dur: 4 } }] }), true);
check('build() 拒绝 undefined / 非时间线 plan', () => build(undefined, {}), true);
check('build() 拒绝认不出的 kind', () => build({ kind: 'sequence', items: [cut(shot, { dur: 2 })] }, {}), true);
check('build() 接受手写的完整段 { scene, dur }', () => {
  const tl = build({ kind: 'seq', items: [{ scene: shot, dur: 4 }] }, {});
  if (tl.length !== 1 || tl[0].end !== 4) throw new Error(`手写段没生效：${JSON.stringify(tl)}`);
}, false);

console.log('\n正常写法必须不受影响：');
check('正常 cut() 通过', () => {
  const tl = build(seq([cut(shot, { dur: 4 }), cut(other, { dur: 6, overlap: 0.5 })]), {});
  if (tl.length !== 2) throw new Error(`段数 ${tl.length} ≠ 2`);
  if (tl[1].start !== 3.5) throw new Error(`第二段起点 ${tl[1].start} ≠ 3.5（overlap 0.5 没生效）`);
  if (tl[1].end !== 9.5) throw new Error(`第二段终点 ${tl[1].end} ≠ 9.5`);
}, false);

check('at(a, b, scene) 通过', () => {
  const tl = build(seq([at(2, 5, shot)]), {});
  if (tl[0].start !== 2 || tl[0].end !== 5) throw new Error(`at 没生效：${tl[0].start}–${tl[0].end}`);
}, false);

check('par(overlap, [...]) 通过', () => {
  const tl = build(seq([cut(shot, { dur: 4 }), par(1, [cut(other, { dur: 4 })])]), {});
  if (tl[1].start !== 3) throw new Error(`par 的重叠起点 ${tl[1].start} ≠ 3`);
}, false);

check('段名与时长可读（describe）', () => {
  const tl = build(seq([cut(shot, { dur: 4 }), cut(other, { dur: 6 })]), {});
  const d = describe(tl);
  if (!/shot/.test(d) || !/other/.test(d)) throw new Error(`describe 缺段名：\n${d}`);
}, false);

// ⑦ 报错信息必须"指路"，不能只说"非法"
const e = check('报错信息点名"忘了调 cut()"', () => seq([{ scene: shot, opt: { dur: 4 } }]), true);
if (e && !/忘了调 cut/.test(e.message)) {
  console.log('  FAIL  报错信息没有指路（缺"你是不是忘了调 cut()？"）');
  fails++;
} else if (e) {
  console.log('  PASS  报错信息指路了');
}

/* ==================================================== 配置档（B 档）：展开 */

console.log("\n§ 配置档（B 档）：{ type: 'chart', … } 由 build() 查模板表展开");

// 拍号 dur 全靠 music 算：120bpm = 一拍 0.5s；`{ bar: n }` = n 小节 = n × 4 拍。
const MUSIC = { bpm: 120 };
/** 只取"可观察的那几列"（段名 + 起止），方便直接比形状 */
const shape = (tl) => tl.map((s) => [s.id, s.start, s.end]);

// ⑧ 数组形式：每项依次接上；段名取模板自己的默认 id（title / outro）
check('数组里的配置档节点展开成段（title 0→3 / outro 3→5，各自带 render）', () => {
  const tl = build([{ type: 'title', dur: 3 }, { type: 'outro', dur: 2 }], MUSIC);
  if (tl.length !== 2) throw new Error(`段数 ${tl.length} ≠ 2`);
  if (tl[0].id !== 'title') throw new Error(`第一段段名 ${tl[0].id} ≠ title（模板默认 id 没生效）`);
  if (tl[1].id !== 'outro') throw new Error(`第二段段名 ${tl[1].id} ≠ outro`);
  if (tl[0].start !== 0 || tl[0].end !== 3) throw new Error(`第一段 ${tl[0].start}→${tl[0].end} ≠ 0→3`);
  if (tl[1].start !== 3 || tl[1].end !== 5) throw new Error(`第二段 ${tl[1].start}→${tl[1].end} ≠ 3→5`);
  for (const s of tl) {
    if (typeof s.scene?.render !== 'function') throw new Error(`段 ${s.id} 的 scene.render 不是函数：${JSON.stringify(Object.keys(s.scene ?? {}))}`);
  }
}, false);

// ⑨ seq([...]) 走的是同一条路（seq 里的 assertNode 也得认配置档节点）
check('seq([...]) 里的配置档节点展开结果与数组写法逐字段相同', () => {
  const a = shape(build([{ type: 'title', dur: 3 }, { type: 'outro', dur: 2 }], MUSIC));
  const b = shape(build(seq([{ type: 'title', dur: 3 }, { type: 'outro', dur: 2 }]), MUSIC));
  if (JSON.stringify(b) !== JSON.stringify(a)) throw new Error(`seq 写法 ${JSON.stringify(b)} ≠ 数组写法 ${JSON.stringify(a)}`);
  const sc = build(seq([{ type: 'title', dur: 3 }]), MUSIC)[0].scene;
  if (typeof sc?.render !== 'function') throw new Error('seq 展开出来的 scene 没有 render');
}, false);

// ⑩ 展开后的形状必须与 cut() 的段**完全一样**（后面的排版/id 去重共用一条路）
check('展开后的段与 cut() 的段是同一套字段', () => {
  const cfg = build([{ type: 'title', dur: 1 }], MUSIC)[0];
  const old = build([cut(shot, { dur: 1 })], MUSIC)[0];
  const kc = Object.keys(cfg).sort().join(',');
  const ko = Object.keys(old).sort().join(',');
  if (kc !== ko) throw new Error(`配置档段的字段 [${kc}] ≠ cut 段的字段 [${ko}]`);
}, false);

// ⑪ 显式 id 覆盖模板默认段名（id 也是模板参数，段名与 scene.id 都该是它）
check("显式 id 覆盖默认段名（{ type: 'chart', id: 'bars' } → bars）", () => {
  const tl = build([{ type: 'chart', id: 'bars', dur: 2, values: [0.3, 0.7] }], MUSIC);
  if (tl[0].id !== 'bars') throw new Error(`段名 ${tl[0].id} ≠ bars`);
  if (tl[0].scene.id !== 'bars') throw new Error(`场景 id ${tl[0].scene.id} ≠ bars（id 没传到模板）`);
  if (tl[0].start !== 0 || tl[0].end !== 2) throw new Error(`时间 ${tl[0].start}→${tl[0].end} ≠ 0→2`);
}, false);

// ⑫ dur 支持拍号：{ beat: 8 } @120bpm = 8 × 0.5s = 4s
check('dur: { beat: 8 } + bpm 120 → 4 秒', () => {
  const tl = build([{ type: 'title', dur: { beat: 8 } }], MUSIC);
  if (tl[0].end - tl[0].start !== 4) throw new Error(`8 拍 = ${tl[0].end - tl[0].start}s ≠ 4s（120bpm 一拍 0.5s）`);
}, false);

// ⑬ ⚠ 按实现（timeline.js 的 resolveDur/beatTime）：`{ bar: n }` = n 小节 = n × 4 拍。
//    120bpm 下一拍 0.5s → **bar:1 = 2 秒**（不是 4 秒），4 秒对应 bar:2。
check('dur: { bar: 1 } = 4 拍 = 2 秒、{ bar: 2 } = 4 秒（120bpm）', () => {
  const one = build([{ type: 'title', dur: { bar: 1 } }], MUSIC)[0];
  const two = build([{ type: 'title', dur: { bar: 2 } }], MUSIC)[0];
  if (one.end - one.start !== 2) throw new Error(`bar:1 = ${one.end - one.start}s ≠ 2s（1 小节 = 4 拍 × 0.5s）`);
  if (two.end - two.start !== 4) throw new Error(`bar:2 = ${two.end - two.start}s ≠ 4s（2 小节 = 8 拍 × 0.5s）`);
}, false);

// ⑭ dur 不写 = 4 秒（与 cut(scene) 的默认一致）
check('dur 不写 = 4 秒（默认与 cut(scene) 一致）', () => {
  const tl = build([{ type: 'title' }], MUSIC);
  if (tl[0].start !== 0 || tl[0].end !== 4) throw new Error(`默认时长 ${tl[0].start}→${tl[0].end} ≠ 0→4`);
}, false);

// ⑮ 时间线字段**不许**被当成模板参数 —— 守的是 TIMELINE_KEYS 这张表：
//    少一个键，`shot()` 就会把它当"参数名拼错"抛出去（note/post/maxSamples… 全会炸）
check('全部时间线字段都不被当成模板参数（TIMELINE_KEYS 得是全的）', () => {
  const tl = build([{
    type: 'title', id: 'a', dur: 2, at: 1, overlap: 0.5, params: { eyebrow: 'E' },
    post: { bloom: 0.2 }, maxSamples: 8, handlesTransition: true, note: '注',
    world: 'auto', worldPass: true,
  }], MUSIC);
  const s = tl[0];
  if (s.id !== 'a') throw new Error(`id ${s.id} ≠ a`);
  if (s.start !== 1 || s.end !== 3) throw new Error(`at/dur 没生效：${s.start}→${s.end} ≠ 1→3`);
  if (s.note !== '注') throw new Error(`note 没带过来：${JSON.stringify(s.note)}`);
  if (s.maxSamples !== 8) throw new Error(`maxSamples 没带过来：${JSON.stringify(s.maxSamples)}`);
  if (s.handlesTransition !== true) throw new Error(`handlesTransition 没带过来：${JSON.stringify(s.handlesTransition)}`);
  if (!s.post || s.post.bloom !== 0.2) throw new Error(`post 没带过来：${JSON.stringify(s.post)}`);
  if (s.world !== 'auto') throw new Error(`worldPass: true → world 该是 'auto'，实际 ${JSON.stringify(s.world)}`);
}, false);

// ⑯ 模板参数名合法就展开；**类型不对也接受**（这一层不校验类型，别把它当契约）
check('参数名合法就展开（headline 给字符串也不抛：模板不做类型校验）', () => {
  const tl = build([{ type: 'kinetic', headline: 'x', dur: 2 }], MUSIC);
  if (tl.length !== 1 || tl[0].id !== 'kinetic') throw new Error(`没展开：${JSON.stringify(shape(tl))}`);
  if (typeof tl[0].scene?.render !== 'function') throw new Error('scene.render 不是函数');
}, false);

// ⑰ params: {…} 与顶层键**一起**送去校验（合并顺序是 { ...rest, ...params }）
check("params: {…} 与顶层键一起被接受（两边都合法就不抛）", () => {
  const tl = build([{ type: 'chart', values: [0.3, 0.7], params: { title: 'x', peak: 0.9 }, dur: 2 }], MUSIC);
  if (tl.length !== 1 || tl[0].id !== 'chart') throw new Error(`没展开：${JSON.stringify(shape(tl))}`);
  const onlyParams = build([{ type: 'chart', params: { values: [1] }, dur: 2 }], MUSIC);
  if (onlyParams.length !== 1) throw new Error(`只写在 params 里的键没生效：${JSON.stringify(shape(onlyParams))}`);
}, false);

// ⑱ 反过来：顶层独有的键**不会**被 params 丢掉 —— 它照样参与校验
mustThrow('顶层写错的参数名不会被 params 掩盖（params 不是"只看 params"）',
  () => build([{ type: 'chart', value: [1], params: { title: '在 params 里写对了' }, dur: 2 }], MUSIC),
  'timeline[0]', 'value');

// ⑲ params 里的键走同一套校验（拼错照样抛）
mustThrow('params: {…} 里的键也校验（titel 拼错照样抛）',
  () => build([{ type: 'chart', values: [1], params: { titel: 'x' }, dur: 2 }], MUSIC),
  'timeline[0]', 'titel');

// ⑳ 唯一能在不渲染的情况下观察到的"谁覆盖谁"：`id` 是**时间线字段**，合并完再补回去，
//    所以顶层 id 说了算（params: { id } 只是模板参数，盖不住它）
check("id 是时间线字段：顶层 id 说了算（params: { id } 盖不住）", () => {
  const tl = build([{ type: 'chart', id: 'top', params: { id: 'inparams' }, dur: 1 }], MUSIC);
  if (tl[0].id !== 'top') throw new Error(`段名 ${tl[0].id} ≠ top（params.id 赢了）`);
  if (tl[0].scene.id !== 'top') throw new Error(`场景 id ${tl[0].scene.id} ≠ top（params.id 赢了）`);
}, false);

// ㉑ whip 是转场镜头：场景对象自己声明 handlesTransition（引擎读的就是 scene 上这个）
check("whip 模板展开出转场镜头（scene.handlesTransition === true）", () => {
  const tl = build([{ type: 'whip', dur: 1 }], MUSIC);
  if (tl[0].id !== 'whip') throw new Error(`段名 ${tl[0].id} ≠ whip`);
  if (tl[0].scene.handlesTransition !== true) throw new Error(`scene.handlesTransition = ${JSON.stringify(tl[0].scene.handlesTransition)} ≠ true`);
}, false);

// ㉒ 节点上的时间线字段照旧转发：handlesTransition 与 overlap 都要落到段上
check('节点上的 handlesTransition / overlap 转发给引擎', () => {
  const tl = build([{ type: 'title', dur: 4 }, { type: 'whip', dur: 2, overlap: 1, handlesTransition: true }], MUSIC);
  if (tl[1].handlesTransition !== true) throw new Error(`段上的 handlesTransition = ${JSON.stringify(tl[1].handlesTransition)} ≠ true`);
  if (tl[1].start !== 3) throw new Error(`overlap 没生效：第二段起点 ${tl[1].start} ≠ 3（第一段 end 4 − 1）`);
  if (tl[1].end !== 5) throw new Error(`第二段终点 ${tl[1].end} ≠ 5`);
}, false);

// ㉓ overlap 生效（不写 handlesTransition 的普通节点也要能重叠）
check('overlap 生效：第二段 start = 第一段 end − overlap', () => {
  const tl = build([{ type: 'title', dur: 4 }, { type: 'outro', dur: 2, overlap: 1 }], MUSIC);
  if (tl[1].start !== 3) throw new Error(`第二段起点 ${tl[1].start} ≠ 3`);
  if (tl[1].end !== 5) throw new Error(`第二段终点 ${tl[1].end} ≠ 5`);
}, false);

// ㉔ 默认段名去重（与旧行为一致：title / title_2）
check('默认段名去重：两个 { type: \'title\' } → title / title_2', () => {
  const tl = build([{ type: 'title', dur: 2 }, { type: 'title', dur: 2 }], MUSIC);
  if (tl[0].id !== 'title' || tl[1].id !== 'title_2') throw new Error(`段名 ${tl[0].id} / ${tl[1].id} ≠ title / title_2`);
  if (tl[1].start !== 2 || tl[1].end !== 4) throw new Error(`第二段 ${tl[1].start}→${tl[1].end} ≠ 2→4`);
}, false);

// ㉕ 整条 timeline 就是一个配置档节点（tasks.js 对"非数组 timeline"一律走 build()）
check("整条 timeline 就是配置档节点（timeline: { type: 'title', dur: 2 }）", () => {
  const tl = build({ type: 'title', dur: 2 }, MUSIC);
  if (tl.length !== 1) throw new Error(`段数 ${tl.length} ≠ 1`);
  if (tl[0].id !== 'title' || tl[0].start !== 0 || tl[0].end !== 2) throw new Error(`没展开：${JSON.stringify(shape(tl))}`);
}, false);

/* -------------------------------------------------- 配置档：写错必须抛错 */

// ㉖ 未知模板名：要点出模板名 + 可用模板名 + 位置
mustThrow('未知模板名 { type: \'nope\' } 抛错，并列出可用模板',
  () => build([{ type: 'nope', dur: 2 }], MUSIC),
  'timeline[0]', 'nope', 'title', 'chart');

// ㉗ 模板参数拼错（chart 的 values 少个 s）：要点出键名 + 位置
mustThrow('模板参数拼错 { type: \'chart\', value: […] } 抛错，并点名 value 与位置',
  () => build([{ type: 'chart', value: [1], dur: 2 }], MUSIC),
  'timeline[0]', 'value');

// ㉘ 时间线字段拼错（duur）→ 落到 rest 里被当成模板参数 → 抛错（不会静默用默认 4 秒）
mustThrow('时间线字段拼错（duur）被当成模板参数而抛错，不会静默用 4 秒',
  () => build([{ type: 'title', duur: 2 }], MUSIC),
  'timeline[0]', 'duur');

// ㉙ 老守门回归：{ scene, opt }（忘了调 cut()）在**数组**这条路上也必须抛
mustThrow('老守门回归：数组里的 { scene, opt } 仍然抛错并指路',
  () => build([{ scene: shot, opt: { dur: 4 } }], MUSIC),
  'timeline[0]', '忘了调 cut');

// ㉚ 配置档节点与"已经展开好的段"混写：后者会被重排、绝对时间被静默丢掉 → 抛
mustThrow('配置档与展开好的段混写 → 抛错并说明"不能混写"',
  () => build([{ type: 'title', dur: 2 }, { id: 'a', scene: shot, start: 5, end: 9 }], MUSIC),
  '不能混写', '已经展开好的段');

// ㉛ isConfigNode() 的判据：对象 + type 是字符串 + 没有 scene
check('isConfigNode() 的判据（有字符串 type、没有 scene）', () => {
  const cases = [
    [{ type: 'x' }, true],
    [{ type: 'x', dur: 4 }, true],
    [{ type: 'x', scene: {} }, false],   // 带 scene = 手写/已展开的段，不是配置档
    [{ scene: {} }, false],
    [{ kind: 'cut' }, false],
    [42, false],
    ['x', false],
    [null, false],
    [undefined, false],
  ];
  for (const [v, want] of cases) {
    const got = isConfigNode(v);
    if (got !== want) throw new Error(`${JSON.stringify(v) ?? String(v)} → isConfigNode = ${got} ≠ ${want}`);
  }
}, false);

console.log(fails ? `\n✗ ${fails} 项失败（共 ${total} 项）` : `\n✓ 全部通过（${total} 项）`);
process.exit(fails ? 1 : 0);
