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
