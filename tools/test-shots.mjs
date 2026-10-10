// A 档镜头库 `src/shots/` 的离线回归：**只查「写错了但画面照样出」那一类**。
//
// 为什么是这几条（docs/IMPROVEMENTS-2.md）：这个引擎最贵的 bug 全都一路绿灯 ——
//   ① 参数名拼错（`shot('chart', { value: [...] })` 少个 s）→ 模板悄悄吃默认值，画面照样出，
//      只有人眼看图才发现"怎么还是那三根柱子"；
//   ② `meta.params` 里漏登记一个参数（或登记了一个不存在的）→ `anim shots` 的文档与代码脱节，
//      照文档写参数的人拿到的是默认值，不报错；
//   ③ 任务场景改成薄封装时把段名改了 → `--only`、`check`、hashes 基线全部对不上，
//      而片长/画面看起来"没什么问题"。
// 这个脚本把这三类变成**能红的断言**。
//
// 它只读对象与源码文本：不建 GL、不开浏览器、不渲染任何一帧、不碰 out/，所以能和渲染并行跑。
//
//   node tools/test-shots.mjs
//
// 覆盖：
//   §1 SHOTS / listShots() 的登记（8 个模板名，多一个少一个都红）
//   §2 文档与代码一致：listShots()[i].params 的名字集合 == 该工厂 defaults 的键集合（核心守门），
//      且列出的 default 就是 defaults 里的值
//   §3 shot(name) 拿到的场景对象有 id（字符串）与 render（函数）；whip 必须是转场镜头
//   §4 每次调用返回新对象（场景自带 this 状态，共享会串场）
//   §5 opts.id 覆盖默认段名；不传时等于 defaults.id
//   §6 报错路径：未知模板名 / 每个模板的未知参数名都必须抛错并点名
//   §7 任务侧集成：tasks/*/scenes/*.js 的段名没变（旧的手写场景也照样只断 id）
//   §8 静态扫描：镜头库源码里不许有 Math.random / Date.now / performance.now（每帧必须是 t 的纯函数）
//
// 模块用 `import()` 动态加载：镜头库还没就位时给出的是一条 FAIL 加一句人话，
// 而不是一屏 ERR_MODULE_NOT_FOUND 堆栈。有失败项 → 退出码 1（可挂进 tools/regress-all.mjs）。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根：从脚本所在目录往上找 package.json。 */
function findRoot(from) {
  let d = from;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(d, 'package.json'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return path.resolve(from, '..');
}
const ROOT = findRoot(HERE);

/** 镜头库必须正好是这 8 个模板名（顺序不查，集合必须相等）。 */
const TEMPLATES = ['title', 'chart', 'kinetic', 'whip', 'outro', 'wave', 'pulse', 'grid'];

/** 任务侧的 8 个场景模块 → 它们必须保持的段名。 */
const TASK_SCENES = [
  ['../tasks/demo/scenes/title.js', 'title'],
  ['../tasks/demo/scenes/chart.js', 'chart'],
  ['../tasks/demo/scenes/kinetic.js', 'kinetic'],
  ['../tasks/demo/scenes/whip.js', 'whip'],
  ['../tasks/demo/scenes/outro.js', 'outro'],
  ['../tasks/beat/scenes/intro.js', 'intro'],
  ['../tasks/beat/scenes/pulse.js', 'pulse'],
  ['../tasks/beat/scenes/grid.js', 'grid'],
];

/* ------------------------------------------------------------------ 计数与断言 */

let pass = 0;
let fail = 0;
const failed = [];

/** 一条断言：ok 为假就打印原因并计入失败。 */
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
    return true;
  }
  fail++;
  failed.push(name);
  console.log(`  FAIL  ${name}${detail ? `\n          → ${detail}` : ''}`);
  return false;
}

/** 跑一段"必须抛错"的代码：抛了返回错误信息，没抛返回 null。 */
function threwMsg(body) {
  try {
    body();
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

const oneLine = (s) => String(s).split('\n')[0];

/** 集合相等（数量、去重后数量、逐项包含都要对）。 */
function sameSet(got, want) {
  return Array.isArray(got) && got.length === want.length
    && new Set(got).size === want.length && want.every((x) => got.includes(x));
}

/** 集合不相等时的人话说明（缺了什么、多了什么）。 */
function setDiff(got, want) {
  if (!Array.isArray(got)) return `不是数组：${JSON.stringify(got)}`;
  const g = new Set(got);
  const w = new Set(want);
  const missing = want.filter((x) => !g.has(x));
  const extra = got.filter((x) => !w.has(x));
  const parts = [];
  if (missing.length) parts.push(`缺：${missing.join(', ')}`);
  if (extra.length) parts.push(`多：${extra.join(', ')}`);
  if (!parts.length) parts.push(`数量不对：实际 ${got.length} 个、去重后 ${g.size} 个，期望 ${want.length} 个`);
  return parts.join('；');
}

/** 动态加载一个模块；失败不抛，把原因带回来（由断言决定怎么报）。 */
async function load(spec) {
  try {
    return { mod: await import(spec) };
  } catch (e) {
    return { err: oneLine(e?.message ?? e) };
  }
}

/* ------------------------------------------------------------------ 静态扫描的小工具 */

/**
 * 把注释与 '…' / "…" 字符串的内容换成空格（换行原样保留 → 行号不变）。
 * 这样"注释里写着『不要用 Math.random』"不会被误判成违规；模板字符串（GLSL）照扫。
 */
function maskNonCode(src) {
  // 按 UTF-16 码元切（`src.split('')`），不要用 `[...src]`：表情等非 BMP 字符会让下标与 src[i] 错位
  const out = src.split('');
  const n = src.length;
  let i = 0;
  let state = 'code';
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && d === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; state = 'line'; continue; }
      if (c === '/' && d === '*') { out[i] = ' '; out[i + 1] = ' '; i += 2; state = 'block'; continue; }
      if (c === "'" || c === '"') { out[i] = ' '; i++; state = c; continue; }
      i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; i++; continue; }
      out[i] = ' '; i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; state = 'code'; continue; }
      if (c !== '\n') out[i] = ' ';
      i++; continue;
    }
    // 单/双引号字符串：内容整体抹掉（'\'' 转义要跳过）
    if (c === '\\') { out[i] = ' '; if (d && d !== '\n') out[i + 1] = ' '; i += 2; continue; }
    if (c === state) { out[i] = ' '; i++; state = 'code'; continue; }
    if (c !== '\n') out[i] = ' ';
    i++;
  }
  return out.join('');
}

/** 递归列出目录下所有 .js（不存在的目录返回空数组）。 */
function listJsFiles(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listJsFiles(p));
    else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const BANNED = [
  [/Math\.random\s*\(/, 'Math.random()', '换成 rng(seed)：一个逻辑帧会被拆成多个子帧乱序渲染，每子帧都调一次 → 抖动'],
  [/Date\.now\s*\(/, 'Date.now()', '时间只能来自 f.t'],
  [/performance\.now\s*\(/, 'performance.now()', '时间只能来自 f.t'],
];

/* ------------------------------------------------------------------ 主体 */

async function main() {
  console.log('A 档镜头库 src/shots/ 回归：');

  const idx = await load('../src/shots/index.js');
  if (!idx.mod) {
    check('能加载 src/shots/index.js', false, `${idx.err}  ← 本脚本要放在 tools/ 下跑：node tools/test-shots.mjs`);
    console.log('  （§1–§7 全部没跑：连镜头库都加载不了，先修它）');
    return;
  }
  const M = idx.mod;

  /* ---------------- §1 登记 ---------------- */
  console.log('\n§1 镜头库的登记（SHOTS / listShots）');
  const keys = M.SHOTS && typeof M.SHOTS === 'object' && !Array.isArray(M.SHOTS) ? Object.keys(M.SHOTS) : null;
  check('SHOTS 的键正好是这 8 个模板名', !!keys && sameSet(keys, TEMPLATES),
    keys ? setDiff(keys, TEMPLATES) : `SHOTS 不是对象：${JSON.stringify(M.SHOTS)}`);

  const listed = typeof M.listShots === 'function' ? M.listShots() : null;
  const listedNames = Array.isArray(listed) ? listed.map((s) => s?.name) : null;
  check('listShots() 返回数组，且名字正好是这 8 个', !!listedNames && sameSet(listedNames, TEMPLATES),
    listedNames ? setDiff(listedNames, TEMPLATES) : `listShots() 返回的是 ${JSON.stringify(listed)}（不是数组）`);

  const notFn = keys ? keys.filter((k) => typeof M.SHOTS[k] !== 'function') : [];
  check('SHOTS 的每个值都是工厂函数', !!keys && keys.length > 0 && notFn.length === 0,
    notFn.length ? `不是函数的：${notFn.join(', ')}` : 'SHOTS 是空的');

  const missingExports = TEMPLATES.filter((n) => typeof M[`${n}Shot`] !== 'function');
  check('8 个具名导出都在（titleShot … gridShot）', missingExports.length === 0,
    `缺：${missingExports.map((n) => `${n}Shot`).join(', ')}`);

  /* ---------------- §2 文档与代码一致 ---------------- */
  console.log('\n§2 文档与代码一致（listShots().params ↔ 工厂的 defaults）');
  const byName = new Map(Array.isArray(listed) ? listed.map((s) => [s?.name, s]) : []);
  for (const name of TEMPLATES) {
    const factory = M.SHOTS?.[name];
    const meta = factory?.meta;
    const defaults = factory?.defaults;
    const params = Array.isArray(meta?.params) ? meta.params : null;
    const paramNames = params ? params.map((p) => p?.name) : null;
    const defKeys = defaults && typeof defaults === 'object' && !Array.isArray(defaults) ? Object.keys(defaults) : null;
    const entry = byName.get(name);

    check(`${name}：meta.name == 注册名`, meta?.name === name,
      meta ? `meta.name = ${JSON.stringify(meta.name)}，注册名 = "${name}"（改一处即可）` : '工厂上没有 meta（anim shots 会列出一张空参数表）');

    check(`${name}：listShots() 的 summary 非空`,
      typeof entry?.summary === 'string' && entry.summary.trim() !== '',
      `summary = ${JSON.stringify(entry?.summary)}`);

    const badParams = [];
    if (!params || params.length === 0) {
      badParams.push('meta.params 不是非空数组');
    } else {
      const seen = new Set();
      for (const p of params) {
        const pn = p?.name;
        if (typeof pn !== 'string' || pn.trim() === '') badParams.push(`有一项 name 不是非空字符串：${JSON.stringify(pn)}`);
        else if (seen.has(pn)) badParams.push(`参数名重复：${pn}`);
        else seen.add(pn);
        if (typeof p?.type !== 'string' || p.type.trim() === '') badParams.push(`${pn ?? '?'}：type 不是非空字符串`);
        if (typeof p?.desc !== 'string' || p.desc.trim() === '') badParams.push(`${pn ?? '?'}：desc 是空的（anim shots 会打印一列空说明）`);
      }
    }
    check(`${name}：每个参数都有 name/type/desc，且名字不重复`, badParams.length === 0,
      badParams.slice(0, 5).join('；'));

    let keysOk = false;
    let keysWhy = '';
    if (!defKeys) keysWhy = '工厂上没有 defaults（没有它，参数校验会对所有拼错的键放行）';
    else if (!paramNames) keysWhy = 'meta.params 不是数组（文档里一个参数都没有）';
    else {
      const a = new Set(paramNames);
      const b = new Set(defKeys);
      const onlyDoc = [...a].filter((x) => !b.has(x));
      const onlyCode = [...b].filter((x) => !a.has(x));
      keysOk = onlyDoc.length === 0 && onlyCode.length === 0 && a.size === paramNames.length;
      keysWhy = [
        onlyDoc.length ? `meta.params 里有但 defaults 里没有：${onlyDoc.join(', ')}` : '',
        onlyCode.length ? `defaults 里有但 meta.params 里没有：${onlyCode.join(', ')}` : '',
      ].filter(Boolean).join('；') || '两边的集合不一致（多半有重名参数）';
    }
    check(`${name}：params 名字集合 == defaults 键集合`, keysOk, keysWhy);
  }

  // ENGINE.md §14.1：「listShots() 的默认值就是从 .defaults 取的 —— 唯一来源」。
  // 这条把那个承诺变成断言：CLI 打印的默认值必须真的等于工厂里用的默认值。
  const jam = [];
  let compared = 0;
  for (const name of TEMPLATES) {
    const entry = byName.get(name);
    const defaults = M.SHOTS?.[name]?.defaults ?? {};
    for (const p of Array.isArray(entry?.params) ? entry.params : []) {
      compared++;
      const want = defaults[p?.name];
      if (JSON.stringify(p?.default) !== JSON.stringify(want)) {
        jam.push(`${name}.${p?.name}: 列出的是 ${JSON.stringify(p?.default)}，defaults 里是 ${JSON.stringify(want)}`);
      }
    }
  }
  check('listShots() 报的 default 就是 defaults 里的值', jam.length === 0 && compared >= TEMPLATES.length,
    jam.length ? jam.slice(0, 4).join('；') : `只比到 ${compared} 个参数（期望 ≥ ${TEMPLATES.length} 个）`);

  // ENGINE.md §14.9：「`--json` 只换一种呈现，不换数据源」+「不带 --json 的人读输出一个字都不变」。
  // 1-21 之后 `listShots()` 的 `type` 改从模板的 `spec.params` 取（声明优先），所以这里把
  // "**报出来的 type 与 meta.params 里写的一模一样**"变成断言 —— 人读那张表打的正是这个 type。
  const typeJam = [];
  for (const name of TEMPLATES) {
    const entry = byName.get(name);
    const metaParams = Array.isArray(M.SHOTS?.[name]?.meta?.params) ? M.SHOTS[name].meta.params : [];
    for (const p of Array.isArray(entry?.params) ? entry.params : []) {
      const want = metaParams.find((q) => q?.name === p?.name)?.type;
      if (p?.type !== want) typeJam.push(`${name}.${p?.name}: 列出的是 ${JSON.stringify(p?.type)}，meta.params 里是 ${JSON.stringify(want)}`);
    }
  }
  check('listShots() 报的 type 就是 meta.params 里的 type（人读那张表一个字不变）',
    typeJam.length === 0, typeJam.slice(0, 4).join('；'));

  /* ---------------- §3 能拿到场景对象 ---------------- */
  console.log('\n§3 shot(名字) 拿到的场景对象');
  const callShot = (name, opts) => {
    try {
      return { scene: opts === undefined ? M.shot(name) : M.shot(name, opts) };
    } catch (e) {
      return { err: oneLine(e?.message ?? e) };
    }
  };
  const scenes = new Map();
  for (const name of TEMPLATES) {
    const r = callShot(name);
    const s = r.scene;
    scenes.set(name, s);
    const ok = !!s && typeof s === 'object' && typeof s.id === 'string' && s.id !== '' && typeof s.render === 'function';
    check(`shot('${name}') 拿到 { id: 字符串, render: 函数 }`, ok,
      r.err ? `抛错了：${r.err}` : `拿到的是 ${JSON.stringify({ id: s?.id, render: typeof s?.render })}`);
  }
  const whip = scenes.get('whip');
  check('whip 是转场镜头（handlesTransition === true）', whip?.handlesTransition === true,
    `handlesTransition = ${JSON.stringify(whip?.handlesTransition)}（转场镜头不声明它，引擎会先做一次交叉溶解）`);

  /* ---------------- §4 每次调用是新对象 ---------------- */
  console.log('\n§4 每次调用返回新对象（场景有自己的 this 状态）');
  const notFresh = [];
  for (const name of TEMPLATES) {
    const a = callShot(name);
    const b = callShot(name);
    if (a.err || b.err) notFresh.push(`${name}: 抛错（${a.err ?? b.err}）`);
    else if (a.scene === b.scene) notFresh.push(`${name}: 两次拿到同一个对象`);
  }
  check('8 个模板各调两次都不是同一个对象', notFresh.length === 0,
    `${notFresh.join('；')}（场景有自己的 this 状态，共享会串场：上一段 setup 的状态被下一段吃掉）`);

  /* ---------------- §5 id 覆盖 ---------------- */
  console.log('\n§5 opts.id 覆盖默认段名');
  const badOverride = [];
  for (const name of TEMPLATES) {
    const r = callShot(name, { id: 'zzz' });
    if (r.err || r.scene?.id !== 'zzz') badOverride.push(`${name} → ${r.err ? `抛错（${r.err}）` : JSON.stringify(r.scene?.id)}`);
  }
  check("shot(名字, { id: 'zzz' }).id === 'zzz'（8 个模板）", badOverride.length === 0, badOverride.join('；'));

  const badDefault = [];
  for (const name of TEMPLATES) {
    const r = callShot(name);
    const want = M.SHOTS?.[name]?.defaults?.id;
    if (r.err || r.scene?.id !== want) badDefault.push(`${name}: ${r.err ? `抛错（${r.err}）` : JSON.stringify(r.scene?.id)} ≠ defaults.id ${JSON.stringify(want)}`);
  }
  check('不传 id 时 id === defaults.id（8 个模板）', badDefault.length === 0, badDefault.join('；'));

  /* ---------------- §6 报错路径 ---------------- */
  console.log('\n§6 报错路径（写错了必须响）');
  const eNope = threwMsg(() => M.shot('nope'));
  check("shot('nope') 抛错（未知模板名不许静默给个空场景）", eNope !== null,
    '没有抛错 —— 拼错模板名会一路渲染到成片里');
  check("未知模板名的报错里点名 'nope'", !!eNope && eNope.includes('nope'),
    eNope ? `抛了错，但信息里没有 "nope"：${oneLine(eNope)}` : '压根没抛错');
  const notListed = eNope ? TEMPLATES.filter((n) => !eNope.includes(n)) : TEMPLATES;
  check('未知模板名的报错里列出全部可用模板名', !!eNope && notListed.length === 0,
    `报错里没提到：${notListed.join(', ')}（报错要能"指路"）`);

  const BOGUS = '__nope__';
  const paramMsgs = [];
  for (const name of TEMPLATES) {
    const msg = threwMsg(() => M.shot(name, { [BOGUS]: 1 }));
    check(`shot('${name}', { ${BOGUS}: 1 }) 抛错并点名这个参数`, !!msg && msg.includes(BOGUS),
      msg ? `抛了错，但信息里没点名 "${BOGUS}"：${oneLine(msg)}`
        : '没有抛错 —— 参数拼错被静默忽略（这个模板是不是没有 defaults？）');
    if (msg) paramMsgs.push([name, msg]);
  }
  const thinList = paramMsgs.filter(([name, msg]) => {
    const real = Object.keys(M.SHOTS?.[name]?.defaults ?? {});
    return real.filter((k) => msg.includes(k)).length < Math.min(2, real.length);
  });
  check('未知参数的报错里列出可用参数（每项至少点名 2 个真实参数）',
    paramMsgs.length === TEMPLATES.length && thinList.length === 0,
    thinList.length ? `这些模板的报错没列可用参数：${thinList.map(([n]) => n).join(', ')}` : `只有 ${paramMsgs.length}/8 个模板抛了错`);

  /* ---------------- §7 任务侧集成 ---------------- */
  console.log('\n§7 任务侧集成（场景模块的段名没变）');
  for (const [spec, want] of TASK_SCENES) {
    const r = await load(spec);
    const scene = r.mod?.default;
    check(`${spec.replace(/^\.\.\//, '')} 的段名还是 '${want}'`, scene?.id === want,
      r.err ? `模块加载失败：${r.err}` : `id = ${JSON.stringify(scene?.id)}（默认导出是 ${scene === undefined ? 'undefined' : typeof scene}）`);
  }

  /* ---------------- §8 静态扫描 ---------------- */
  console.log('\n§8 静态扫描：镜头库源码里的非确定性写法');
  const shotsDir = path.join(ROOT, 'src/shots');
  const files = listJsFiles(shotsDir);
  check('src/shots/ 下至少扫到 8 个 .js（扫描目标不是空的）', files.length >= 8,
    `${shotsDir} 下只扫到 ${files.length} 个 .js（目录不存在？还是路径算错了？）`);
  check('index.js 在扫描范围内', files.some((f) => path.basename(f) === 'index.js'),
    `扫到的文件：${files.map((f) => path.relative(ROOT, f)).join(', ') || '（空）'}`);

  for (const [re, label, why] of BANNED) {
    const hits = [];
    for (const f of files) {
      let raw = '';
      try {
        raw = readFileSync(f, 'utf8');
      } catch (e) {
        hits.push(`${path.relative(ROOT, f)} 读不了：${oneLine(e?.message ?? e)}`);
        continue;
      }
      const code = maskNonCode(raw);
      const lines = raw.split('\n');
      for (const m of code.matchAll(new RegExp(re.source, 'g'))) {
        const line = code.slice(0, m.index).split('\n').length;
        hits.push(`${path.relative(ROOT, f)}:${line}  ${(lines[line - 1] ?? '').trim().slice(0, 96)}`);
      }
    }
    check(`镜头库里没有 ${label}`, hits.length === 0, `${hits.length} 处：${why}\n            ${hits.slice(0, 5).join('\n            ')}`);
  }

  console.log(`\n（§8 扫了 ${files.length} 个文件：${files.map((f) => path.relative(shotsDir, f)).join(', ') || '（空）'}）`);

  /* ---------------- §9 声明式 spec（BACKLOG 1-21） ---------------- */
  //
  // 为什么要有这一节：1-21 给每个模板补了 `spec`（参数类型 / requires / outputs），
  // 而"声明"这种东西最容易变成**和代码各说各话的注释** —— 它不会报错，只会让下游
  // （`anim shots --json` 的读者、`check` 的依赖前置校验）按错的声明做判断。
  // 所以这里把 spec 与 `defaults` / `meta.params` / 场景对象**逐项对上**。
  console.log('\n§9 声明式 spec：参数类型 / requires / outputs（BACKLOG 1-21）');

  const vocab = M.SHOT_REQUIRES && typeof M.SHOT_REQUIRES === 'object' ? Object.keys(M.SHOT_REQUIRES) : null;
  const visuals = Array.isArray(M.SHOT_VISUALS) ? M.SHOT_VISUALS : null;
  check('SHOT_REQUIRES 词表在（requires 里的令牌要有定义，机器读者才知道它是什么意思）',
    !!vocab && vocab.length > 0, `SHOT_REQUIRES = ${JSON.stringify(M.SHOT_REQUIRES)}`);
  check('SHOT_VISUALS 在（outputs.visual 的取值范围）', !!visuals && visuals.length > 0,
    `SHOT_VISUALS = ${JSON.stringify(M.SHOT_VISUALS)}`);

  /** `spec.params` 声明的类型与 `defaults` 里的实际值是否自洽（"spec 与 defaults 不矛盾"）。 */
  const typeOk = (type, v) => {
    switch (type) {
      case 'string': return typeof v === 'string';
      case 'number': return typeof v === 'number' && Number.isFinite(v);
      case 'boolean': return typeof v === 'boolean';
      case 'number[]': return Array.isArray(v) && v.length > 0 && v.every((x) => Number.isFinite(x));
      case '[number, number]': return Array.isArray(v) && v.length === 2 && v.every((x) => Number.isFinite(x));
      case 'string[2]': return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string');
      default: return false;
    }
  };

  const specProblems = [];
  for (const name of TEMPLATES) {
    const factory = M.SHOTS?.[name];
    const spec = factory?.spec;
    const defaults = factory?.defaults ?? {};
    const metaParams = Array.isArray(factory?.meta?.params) ? factory.meta.params : [];
    const scene = scenes.get(name);

    if (!spec || typeof spec !== 'object') { specProblems.push(`${name}: 没有 spec`); continue; }
    if (!spec.params || typeof spec.params !== 'object' || Array.isArray(spec.params)) {
      specProblems.push(`${name}: spec.params 不是"参数名 → 类型"的对象`);
    } else {
      const specNames = Object.keys(spec.params).sort();
      const defNames = Object.keys(defaults).sort();
      if (JSON.stringify(specNames) !== JSON.stringify(defNames)) {
        specProblems.push(`${name}: spec.params 的键集合 ≠ defaults 的键集合（${setDiff(Object.keys(spec.params), Object.keys(defaults))}）`);
      }
      for (const p of metaParams) {
        if (spec.params[p.name] !== p.type) {
          specProblems.push(`${name}.${p.name}: spec 说 ${JSON.stringify(spec.params[p.name])}，meta.params 说 ${JSON.stringify(p.type)}`);
        }
      }
      for (const [k, t] of Object.entries(spec.params)) {
        if (!(k in defaults)) continue;   // 没有默认值 = required:true，此时无从对照
        if (!typeOk(t, defaults[k])) {
          specProblems.push(`${name}.${k}: spec 声明 ${JSON.stringify(t)}，而 defaults 里是 ${JSON.stringify(defaults[k])}`);
        }
      }
    }
    if (!Array.isArray(spec.requires)) {
      specProblems.push(`${name}: spec.requires 不是数组`);
    } else {
      if (new Set(spec.requires).size !== spec.requires.length) specProblems.push(`${name}: spec.requires 里有重复项`);
      const unknown = vocab ? spec.requires.filter((t) => !vocab.includes(t)) : [];
      if (unknown.length) specProblems.push(`${name}: requires 里有词表之外的令牌：${unknown.join(', ')}（词表：${(vocab ?? []).join(' / ')}）`);
    }
    if (!spec.outputs || typeof spec.outputs !== 'object') {
      specProblems.push(`${name}: 没有 spec.outputs`);
    } else {
      if (visuals && !visuals.includes(spec.outputs.visual)) {
        specProblems.push(`${name}: outputs.visual = ${JSON.stringify(spec.outputs.visual)}（合法值：${visuals.join(' / ')}）`);
      }
      // 声明必须与**运行时的场景对象**一致：`handlesTransition` 由模板自己在场景对象上给出，
      // spec 里那一份只是给机器读的副本 —— 两者不一致就是"声明与代码各说各话"。
      if (spec.outputs.handlesTransition !== (scene?.handlesTransition === true)) {
        specProblems.push(`${name}: spec.outputs.handlesTransition = ${JSON.stringify(spec.outputs.handlesTransition)}，`
          + `而场景对象的 handlesTransition = ${JSON.stringify(scene?.handlesTransition)}`);
      }
    }
  }
  check('8 个模板的 spec 都在，且与 defaults / meta.params / 场景对象逐项一致',
    specProblems.length === 0, specProblems.slice(0, 6).join('\n            '));

  // 依赖声明本身：`wave` / `pulse` / `grid` 读 ctx.music（§14.3），这是 1-21 的**动机** ——
  // 写成断言，免得以后被"顺手删掉"而没人发现（删掉它 = check 又只能等出图才发现全黑）。
  const MUSIC_SHOTS = ['wave', 'pulse', 'grid'];
  const musicMiss = MUSIC_SHOTS.filter((n) => !(M.SHOTS?.[n]?.spec?.requires ?? []).includes('music'));
  check(`wave / pulse / grid 的 spec.requires 里都有 'music'`, musicMiss.length === 0,
    `这些没有：${musicMiss.join(', ')}（它们的 render 读 ctx.music 的包络/打击事件，见 docs/ENGINE.md §14.3）`);
  const analyzeMiss = MUSIC_SHOTS.filter((n) => !(M.SHOTS?.[n]?.spec?.requires ?? []).includes('analyze'));
  check(`wave / pulse / grid 的 spec.requires 里都有 'analyze'`, analyzeMiss.length === 0,
    `这些没有：${analyzeMiss.join(', ')}（没有预计算的 analysis.json 时引擎会退到浏览器里现算）`);
  const quiet = TEMPLATES.filter((n) => !MUSIC_SHOTS.includes(n));
  const noise = quiet.filter((n) => (M.SHOTS?.[n]?.spec?.requires ?? []).includes('music'));
  check('另外 5 个模板不声明 music（多声明一条 = 用它的任务会被 check 假报"没配 audio"）', noise.length === 0,
    `这些多声明了：${noise.map((n) => `${n}${JSON.stringify(M.SHOTS?.[n]?.spec?.requires)}`).join(', ')}`);
  check("whip 声明了 requires: ['under']（它读上一段的成帧，§14.4）",
    (M.SHOTS?.whip?.spec?.requires ?? []).includes('under'),
    `whip.spec.requires = ${JSON.stringify(M.SHOTS?.whip?.spec?.requires)}`);

  const listedSpec = TEMPLATES.filter((n) => {
    const e = byName.get(n);
    return !e || !Array.isArray(e.requires) || !e.outputs;
  });
  check('listShots() 把 spec 带出来了（requires / outputs，--json 就是靠它）', listedSpec.length === 0,
    `这些条目没带：${listedSpec.join(', ')}`);

  /* ---------------- §10 依赖前置校验（BACKLOG 1-21 的后半） ---------------- */
  //
  // ① 纯函数的行为（判据 + 消息该进 errs 还是 skipped）；
  // ② **真实任务**跑一遍：仓库里唯一用这三个模板的 `beat` 必须是干净的（否则这条新守门
  //    会把 `tools/regress-all.mjs` 里那 11 个 `check:*` 染红 —— 那是"假报"最贵的形态）；
  // ③ **接线自检**：读 `scripts/anim.mjs` 的源码，证明 `cmdCheck` 真的调了它、而且 errs 真的接上了
  //    （1-19 的教训：函数写对了但没接线 = 功能等于没做）。
  console.log('\n§10 镜头模板的依赖前置校验（check 用它提前报"用了 wave 却没配 audio"）');
  const A = await load('../scripts/anim.mjs');
  const hasApi = !!A.mod
    && ['scanShotUsage', 'shotDependencyIssues', 'shotDependencyReport', 'taskShotSources', 'shotDependencyFacts']
      .every((k) => typeof A.mod[k] === 'function');
  check('scripts/anim.mjs 导出了依赖校验那套纯函数（可离线断言）', hasApi,
    A.err ? `加载失败：${A.err}` : '缺导出（IS_MAIN 入口门还在吗？）');

  if (hasApi) {
    const { scanShotUsage, shotDependencyIssues, shotDependencyReport, SHOT_DEP_WHAT } = A.mod;
    const specOf = (n) => M.SHOTS?.[n]?.spec;

    // ① 静态扫描：两种写法都认，注释里的举例不算
    const scanned = scanShotUsage([{
      file: 'tasks/x/scenes/a.js',
      text: [
        '// export default shot(\'wave\', { id: \'commented-out\' });',
        '/* { type: \'grid\' } —— 文件头注释里的举例，不算用过 */',
        'export default shot(\'pulse\', { title: \'t\' });',
        'const node = { type: \'chart\', values: [1] };',
      ].join('\n'),
    }], TEMPLATES);
    const got = scanned.map((u) => `${u.shot}@${u.line}`).join(' ');
    check("扫描认 shot('名字') 与 { type: '名字' }，且不吃注释里的举例",
      JSON.stringify(scanned.map((u) => u.shot)) === JSON.stringify(['pulse', 'chart']) && scanned[0].line === 3,
      `扫到的是 ${got}（期望 pulse@3 chart@4）`);
    const unknownOnly = scanShotUsage([{ file: 'x', text: "shot('nope'); { type: 'quote' }" }], TEMPLATES);
    check('未知模板名不在这里报（那是 timeline.js / shot() 的活，报两遍反而没人知道信哪条）',
      unknownOnly.length === 0, `扫到了 ${JSON.stringify(unknownOnly)}`);

    const usageRows = (rows) => rows.map((u) => ({ ...u, requires: specOf(u.shot)?.requires ?? [] }));
    const waveUse = usageRows([{ shot: 'wave', file: 'tasks/x/scenes/a.js', line: 3 }]);

    // ② 两档严重性：没配 audio = error（画面不可能对）；没跑 analyze = hint（"这一步还没跑"）
    const noAudio = shotDependencyIssues(waveUse, specOf, { audioDeclared: false });
    check('用了 wave 但任务没配 audio ⇒ error（进 errs，不是"提示"）',
      noAudio.length === 1 && noAudio[0].level === 'error' && noAudio[0].kind === 'missing-audio',
      JSON.stringify(noAudio.map((i) => [i.level, i.kind])));
    check('这条 error 里点名模板名、文件:行号、以及"怎么修"',
      !!noAudio[0] && noAudio[0].shot === 'wave' && noAudio[0].where === 'tasks/x/scenes/a.js:3'
      && /audio/.test(noAudio[0].fix) && /analyze/.test(noAudio[0].fix),
      JSON.stringify(noAudio[0] ?? null));

    const noAnalysis = shotDependencyIssues(waveUse, specOf, {
      audioDeclared: true, audioPath: 'tasks/x/audio/bed.mp3',
      analysisExpected: 'tasks/x/audio/bed.analysis.json', analysisFile: null,
    });
    check('配了 audio 但还没跑 analyze ⇒ hint（"这一步还没跑"，不是"坏了"）',
      noAnalysis.length === 1 && noAnalysis[0].level === 'hint' && noAnalysis[0].kind === 'missing-analysis',
      JSON.stringify(noAnalysis.map((i) => [i.level, i.kind])));
    check('没配 audio 时不再补报一条"没跑 analyze"（只报根因）',
      noAudio.every((i) => i.kind !== 'missing-analysis'),
      JSON.stringify(noAudio.map((i) => i.kind)));

    const satisfied = shotDependencyIssues(waveUse, specOf, {
      audioDeclared: true, audioPath: 'tasks/x/audio/bed.mp3',
      analysisExpected: 'tasks/x/audio/bed.analysis.json', analysisFile: 'tasks/x/audio/bed.analysis.json',
    });
    check('都满足时一条问题都不报（否则新守门会变成噪音）', satisfied.length === 0,
      JSON.stringify(satisfied));

    const twice = shotDependencyIssues(usageRows([
      { shot: 'wave', file: 'tasks/x/scenes/a.js', line: 3 },
      { shot: 'wave', file: 'tasks/x/scenes/b.js', line: 9 },
    ]), specOf, { audioDeclared: false });
    check('同一个模板在多个段里出现只报一次（根因是任务级的）', twice.length === 1,
      `报了 ${twice.length} 条：${JSON.stringify(twice.map((i) => i.where))}`);

    // ③ 报告：error → errors（非零退出），hint → skipped（默认不改退出码）
    const repErr = shotDependencyReport({ scanned: 1, usage: waveUse, issues: noAudio, facts: { audioDeclared: false } });
    check('report：error 进 errors、不进 skipped（退出码语义与 1-19 一致）',
      repErr.errors.length === 1 && repErr.skipped.length === 0 && /镜头模板依赖/.test(repErr.errors[0]),
      JSON.stringify({ errors: repErr.errors, skipped: repErr.skipped }));
    const repHint = shotDependencyReport({
      scanned: 1, usage: waveUse, issues: noAnalysis, facts: { audioDeclared: true },
    });
    check('report：hint 进 skipped（what 可被 formatSkipped 聚合）、不进 errors',
      repHint.errors.length === 0 && repHint.skipped.length === 1 && repHint.skipped[0].what === SHOT_DEP_WHAT,
      JSON.stringify({ errors: repHint.errors, skipped: repHint.skipped }));
    const repNone = shotDependencyReport({ scanned: 3, usage: [], issues: [], facts: {} });
    check('report：任务一个模板都没用时**明说"没有可查的对象"**（"空 ≠ 干净"，1-19）',
      repNone.lines.some((l) => /没有可查的对象/.test(l.text)),
      JSON.stringify(repNone.lines.map((l) => l.text)));
    const repOnly = shotDependencyReport({ scanned: 1, usage: waveUse, issues: [], facts: {}, only: 'chart' });
    check('report：--only 时说明"这是整个任务范围的静态扫描"',
      repOnly.lines.some((l) => /--only chart/.test(l.text) && /整个任务/.test(l.text)),
      JSON.stringify(repOnly.lines.map((l) => l.text)));
    const repUnder = shotDependencyReport({
      scanned: 1,
      usage: usageRows([{ shot: 'whip', file: 'tasks/x/scenes/w.js', line: 7 }]),
      issues: [],
      facts: {},
    });
    check("report：声明了但**没接线**的令牌（'under'）要明说「这次没有验它」（不许把没查说成「都满足」）",
      repUnder.lines.some((l) => /还没接线/.test(l.text) && /'under'/.test(l.text))
      && repUnder.lines.some((l) => /能查的那几条依赖都满足/.test(l.text))
      && repUnder.skipped.length === 0 && repUnder.errors.length === 0,
      JSON.stringify(repUnder.lines.map((l) => l.text)));

    // ④ 真实任务：唯一用 wave/pulse/grid 的 beat 必须干净（有 audio + 有 analysis.json）
    const realTasks = ['beat', 'demo', '_config-lab'];
    const notClean = [];
    for (const t of realTasks) {
      const src = A.mod.taskShotSources(t);
      const use = usageRows(scanShotUsage(src, TEMPLATES));
      const facts = A.mod.shotDependencyFacts(t);
      const iss = shotDependencyIssues(use, specOf, facts);
      if (iss.length) notClean.push(`${t}: ${iss.map((i) => `${i.kind}(${i.shot})`).join(', ')}`);
    }
    check('真实任务 beat / demo / _config-lab 一条依赖问题都没有（不产生假报）',
      notClean.length === 0, notClean.join('；'));

    // `audio` 字段判据（页面据此决定要不要加载音乐）：**误报是最贵的**（会把正常任务染红），
    // 所以三种写法都要认、注释里的不算 —— 这里逐条钉住。
    const audioCases = [
      ["export default {\n  audio: './audio/a.mp3',\n};", true, '行首写法'],
      ["export default { title: 'x', audio: './audio/a.mp3' };", true, '行内写法'],
      ["const audio = './audio/a.mp3';\nexport default { audio };", true, 'const + shorthand'],
      ["// audio: './audio/a.mp3'\nexport default {};", false, '注释里的不算'],
      ["/* audio: './audio/a.mp3' */\nexport default {};", false, '块注释里的不算'],
      ["export default { title: 'x' };", false, '真的没配'],
    ];
    const audioBad = audioCases.filter(([text, want]) => A.mod.audioDeclaredInConfig(text) !== want);
    check('audio 字段判据：行首 / 行内 / const+shorthand 都算，注释里的不算',
      typeof A.mod.audioDeclaredInConfig === 'function' && audioBad.length === 0,
      audioBad.map(([, want, label]) => `${label}（期望 ${want}）`).join('；'));
    check('真实任务 beat 的 audio 字段被判出来了（判据不是"永远 false"）',
      A.mod.audioDeclaredInConfig(readFileSync(path.join(ROOT, 'tasks', 'beat', 'task.config.mjs'), 'utf8')) === true,
      'beat 明明写着 audio: …，判据却说没有 —— 那会把 beat 假报成"没配 audio"');    const beatUsage = scanShotUsage(A.mod.taskShotSources('beat'), TEMPLATES).map((u) => u.shot);
    check('真的扫到了 beat 的三个音乐模板（扫描器不是"扫了个寂寞"）',
      MUSIC_SHOTS.every((n) => beatUsage.includes(n)),
      `beat 扫到的是 ${JSON.stringify(beatUsage)}`);

    // ⑤ 接线自检：cmdCheck 里真的调了它，而且 errs 真的并上了（1-19 的教训）
    const animSrc = readFileSync(path.join(ROOT, 'scripts', 'anim.mjs'), 'utf8');
    const start = animSrc.indexOf('async function cmdCheck(');
    const end = animSrc.indexOf('/** 把若干时刻渲染成一张接触表', start);
    const body = start > 0 && end > start ? animSrc.slice(start, end) : '';
    check('cmdCheck 里真的接了依赖前置校验（不是"函数写了没人调"）',
      /shotDependencyReport\(/.test(body) && /shotDependencyIssues\(/.test(body)
      && /taskShotSources\(task\)/.test(body),
      start > 0 ? 'cmdCheck 里找不到这几处调用' : '定位不到 cmdCheck 函数体');
    check('依赖校验的 error 并进了 errs（`const errs = [...depErrs, ...reportErrors(info)]`）',
      /const depErrs = \[\]/.test(body) && /const errs = \[\.\.\.depErrs, \.\.\.reportErrors\(info\)\]/.test(body),
      '那两行不在（error 会被静默丢掉 ⇒ 该红的没红）');
    check('依赖校验的 hint 走了 pushSkipped（"这一步还没跑"要能被看见，但不改退出码）',
      /pushSkipped\(skipped, s\.what, s\.why\)|pushSkipped\(skipped, SHOT_DEP_WHAT/.test(body),
      'cmdCheck 里没有把 dep.skipped 接进 skipped 收集器');
    check('依赖校验在 openSession **之前**（否则又变成"等出图才发现全黑"）',
      body.indexOf('shotDependencyReport(') < body.indexOf('await openSession('),
      '调用点在 openSession 之后 —— 那就失去了"前置"的意义');
    check("shotsCatalog 带上了 requires / outputs / requireTokens（`anim shots --json` 的载荷）",
      /'requires' in s \? \{ requires: s\.requires/.test(animSrc)
      && /requireTokens: \{ \.\.\.requireTokens \}/.test(animSrc),
      'shotsCatalog 里没有转发这三个字段');
  }
}

await main();

if (fail) {
  console.log(`\n✗ 有 ${fail} 项失败`);
  console.log('失败清单：');
  for (const n of failed) console.log(`  · ${n}`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ 全部通过（${pass} 项）`);
}
