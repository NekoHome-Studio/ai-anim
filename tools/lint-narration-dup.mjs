// @ts-check
/**
 * lint-narration-dup —— 静态检查：**画面文字有没有把旁白整句再写一遍**
 *
 *   node tools/lint-narration-dup.mjs                 # 扫 tasks/ 下所有有旁白表的任务
 *   node tools/lint-narration-dup.mjs sodium optifine # 只扫这几个任务
 *   node tools/lint-narration-dup.mjs --json          # 机器可读（退出码恒 0）
 *   node tools/lint-narration-dup.mjs --all           # 连注释里的命中一起报（默认跳过注释）
 *   node tools/lint-narration-dup.mjs --near          # 额外列出"部分复述"（只提示，不计入命中/退出码）
 *
 * 退出码：有命中 → 1；干净 → 0；用法/任务名写错 → 2。（`--json` 恒 0，见下。）
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 为什么要有这个脚本
 *
 * 观众反馈「两条字幕同时出现（页面介绍 + 语音字幕）看着好迷糊」。逐字比对发现：
 *   · tasks/sodium   43 句旁白里 **12 句**被逐字写进了画面代码（底部说明条 `caption({ text })`）
 *   · tasks/optifine 47 句里 **3 句**
 *   · 对照组 tasks/beast 26 句 **0 句** —— 它的 `SCRIPT.md` 把「旁白」和「屏幕上写了什么」
 *     当两列写，画面只放数字 / 代码 / 出处。
 * 这个脚本就是把那次人工比对变成**可复现**的判据，好挂进 `anim check` 与回归清单。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 判据（一句话）：去掉标点与空白后，**某一个字符串字面量 == 旁白整句**。
 *
 * ① 归一化：`strip()` 去掉 \p{P}（标点）/\p{S}（符号）/\p{Z}（空白）/\p{C}（控制符）之后再比。
 *    于是画面上的 `'每 16 格算一段'` 与旁白里的 `每 16 格算一段` 同形；
 *    中英文标点（`，` / `,`）、引号、破折号、空格都不再影响判据。
 *    比对**区分大小写**（"逐字"就是逐字）—— 不区分大小写会让 `'sodium'` 之类的标识符乱命中。
 *
 * ② 命中位置必须落在**字符串字面量**里（`'…'` / `"…"` / 反引号）。
 *    画面上的字只可能来自字面量：`type.writeLine('…')`、`caption({ text: '…' })`、
 *    `kicker(…, '…', …)`。裸代码里的中文（变量名、键名）不是画面文字。
 *    反引号里**跨行**写的一句话也算（比对时整段字面量的内容一起去标点空白，换行不影响判据）。
 *
 * ③ **必须先做注释剥离，再匹配**（这一步是刚需，不是洁癖）：
 *    `tasks/<任务>/scenes/<场景>.js` 的文件头有一整段 `/** … *\/` 分镜注释，里面**逐句引用了旁白文案**
 *    （「0.6 「麻烦在提交：原版每一段都有自己的缓冲区。」 → 0.7–1.9 …」）—— 那是写给
 *    写代码的人看的分镜表，**不是画面文字**。不剥离的话几乎所有任务都会"命中"，
 *    指标就废了：实测 sodium 会从 12 句涨到 40 句左右（`--all` 就是给你看这个数的）。
 *
 *    实现上不是拿正则去删注释，而是**逐字符扫一遍**（`scanSource()`）：
 *      · 这样才分得清 `//` 出现在字符串里（`'https://…'` 的 `//` 不是注释）与注释里；
 *      · 也才分得清注释里的 `'…'`（那是注释，不是画面文字）；
 *      · 注释整段被替换成**等长空白**（换行保留）→ 所有下标还是原文件的下标，
 *        行号可以直接数出来，报的 `文件:行号` 就是你在编辑器里看到的那个行号。
 *      · 块注释里的行内 `*`（`* 0.6 「…」`）本来就在 `/* … *\/` 区间内，一并被吃掉。
 *
 * ④ 出处 / URL 不算复述：被命中的**那个字面量本身**含 `http`、`www.`、`optifine.net`
 *    这类域名时跳过。⚠ 过滤只作用于字面量，**不作用于整行** —— sodium/cull.js:288 那种
 *    `{ text: '遮挡剔除原版也有 …', src: 'Mojira MC-70850 …' }` 里 text 是真命中、
 *    src 是出处；按"这一行有出处就跳过"会把 3 条真命中一起丢掉（开发时实测过）。
 *
 * ⑤ 命中率要能解释：每个任务报 `N/M 句命中（百分比）`，M 是这个任务旁白表的句数。
 *    旁白太短的句子（`strip()` 后 < 4 字，例如「快了。」）不进判据 —— 2、3 个字在源码里
 *    撞上同形字面量的概率太高，报了也是噪声。这类句子会被单独数出来（`过短跳过`）。
 *
 * 数据源
 *   · 旁白：`tasks/<任务>/audio/narration.json` 的 `lines[].text` / `.id`（首选）。
 *     **回退**：没有 narration.json 但跑过 `anim say` 的任务只有 `audio/timing.json`
 *     （`scenes[].lines[].text`，句子文本完全一样，只是没有全局 `id`）——
 *     beast 就是这一类：它没有 narration.json，旁白在 timing.json 里，不认这个回退
 *     就会把 26 句旁白整支片子"安静跳过"，那不是"0 命中"，是**没检查**。
 *   · 画面代码：`tasks/<任务>/scenes/*.js` + `tasks/<任务>/task.config.mjs`
 *     （配置档任务把画面文字直接写在时间线里，所以 task.config.mjs 也要扫）。
 *   · 两个旁白文件都没有的任务：**安静跳过**（打印一行、不计入命中、不影响退出码）。
 *
 * 已知的误报 / 漏报边界（诚实清单，逐条对得上实测）
 *   · 漏：画面文字被拆成几段字符串拼起来（`'先看' + '一句话'`）判不出来；
 *   · 漏：一句话被拆到多个字面量里写（模板字符串跨行拼）判不出来；
 *   · 漏：画面文字比旁白句**多**一截（把整句包在更长的一句里）或**少**一截（只搬半句）
 *     都不算"整句逐字"，默认不计入命中 —— 这两类用 `--near` 提示，**不影响退出码**；
 *   · 误：注释剥离是逐字符扫的，源码里若有**含引号的正则字面量**（`/['"]/`），
 *     扫描器可能误判字符串边界 → 该文件末尾若没闭合会打印 `⚠ 扫描器未闭合` 提示。
 *     实测本仓库三个有旁白的任务都没有这种写法（扫描器全部正常闭合）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASKS_DIR = path.join(ROOT, 'tasks');

/* ── 判据常数：都摆在这里，方便复核与调参（改了要重跑三个任务的实测数字） ── */
/** 旁白句 strip() 后短于这个长度就不进判据（太短的字面量撞车是噪声，不是证据） */
const MIN_NEEDLE = 4;
/** `--near`：画面文字至少这么长（strip 后）才算"搬了一段话" */
const NEAR_MIN = 8;
/** `--near`：画面文字至少盖住整句的这个比例，才算"部分复述"（挡住 'OptiFine'、'CPU' 这类专名） */
const NEAR_RATIO = 0.5;
/** `--near`：每个任务最多列几条明细（其余只报数量） */
const NEAR_SHOW = 6;
/** 出处 / URL 特征：命中的字面量自己长这样就跳过（判据 ④） */
const CITATION = /https?:\/\/|www\.|\b[\w-]+\.(?:net|com|org|io|dev|gg|cn|me|app|tv|edu|gov|xyz)\b/i;

/* ══════════════════════════════════════ 归一化 */

/** 标点 / 符号 / 空白 / 控制符 —— 判据 ① 要全去掉的字符类 */
const DROP = /[\p{P}\p{S}\p{Z}\p{C}]/u;

/**
 * 判据 ① 的归一化：去掉标点、符号、空白、控制符。
 * 用 `for…of` 而不是 `split('')`，这样代理对（emoji）不会被劈成两半。
 */
function strip(s) {
  let out = '';
  for (const ch of s) if (!DROP.test(ch)) out += ch;
  return out;
}

/** 把一段文本压成 `{ cond, map }`：`cond[i]` 是第 i 个"有效字符"，`map[i]` 是它在原文里的下标 */
function condense(text) {
  let cond = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (DROP.test(text[i])) continue;
    cond += text[i];
    map.push(i);
  }
  return { cond, map };
}

/* ══════════════════════════════════════ 源码扫描（判据 ②③） */

/**
 * 逐字符扫一遍源码，得到：
 *   · `code`     —— 注释被替换成**等长空白**（换行原样保留）之后的文本：匹配只用它；
 *   · `strings`  —— 每个字符串字面量的 `[start, end)`（含两头的引号）；
 *   · `comments` —— 每个注释的 `[start, end)` 与 `kind`（'line' / 'block'）；
 *   · `unterminated` —— 扫到文件尾还没闭合（多半是含引号的正则把状态带歪了）→ 要提示。
 *
 * 为什么自己扫而不用正则删注释：见文件头 ③。关键点是**长度不变**，
 * 于是"下标 → 行号"这一步不需要任何映射表，报出来的行号必然与编辑器一致。
 */
function scanSource(raw) {
  let code = '';
  const strings = [];
  const comments = [];
  let state = /** @type {'code'|'line'|'block'|"'"|'"'|'`'} */ ('code');
  let start = 0;
  const n = raw.length;
  for (let i = 0; i < n;) {
    const c = raw[i];
    const c2 = raw[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; start = i; code += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; start = i; code += '  '; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { state = c; start = i; code += c; i++; continue; }
      code += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { comments.push({ start, end: i, kind: 'line' }); state = 'code'; code += c; i++; continue; }
      code += ' '; i++; continue;                       // 行注释内容 → 空白
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        comments.push({ start, end: i + 2, kind: 'block' });
        state = 'code'; code += '  '; i += 2; continue;
      }
      // 换行保留（行号靠它），其余（含行内 `*`）→ 空白
      code += c === '\n' ? '\n' : ' '; i++; continue;
    }
    // 字符串内部：内容**原样保留**（那才是画面文字），只是要找对收尾的引号
    if (c === '\\') { code += c + (c2 ?? ''); i += 2; continue; }
    if (c === state) { strings.push({ start, end: i + 1 }); state = 'code'; code += c; i++; continue; }
    code += c; i++; continue;
  }
  if (state === 'line') comments.push({ start, end: n, kind: 'line' });
  if (state === 'block') comments.push({ start, end: n, kind: 'block' });
  return { code, strings, comments, unterminated: state !== 'code' && state !== 'line' };
}

/** 字面量的内容（去掉两头的引号）。反引号里的 `${…}` 原样留着 —— 它里面的字面量本来也算画面文字 */
const literalInner = (raw, span) => raw.slice(span.start + 1, span.end - 1);

/** 某个下标在第几行（1 起） */
function lineAt(raw, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < raw.length; i++) if (raw[i] === '\n') line++;
  return line;
}

/** 某个下标所在行的原文（trim 过，给报告里当证据看） */
function lineTextAt(raw, offset) {
  let a = raw.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  let b = raw.indexOf('\n', offset);
  if (b < 0) b = raw.length;
  return raw.slice(a, b).trim();
}

/* ══════════════════════════════════════ 数据源 */

/** 读旁白表：narration.json 优先，timing.json 回退；都没有 → null（安静跳过） */
function loadNarration(taskDir) {
  const narPath = path.join(taskDir, 'audio', 'narration.json');
  if (existsSync(narPath)) {
    const j = JSON.parse(readFileSync(narPath, 'utf8'));
    const lines = (j.lines ?? []).map((l, i) => ({ id: l.id ?? `#${i + 1}`, text: String(l.text ?? '') }));
    if (lines.length) return { file: 'audio/narration.json', fallback: false, lines };
  }
  // 回退：beast 这类"跑过 anim say 但没有 narration.json"的任务，句子在 timing.json 里。
  // 少了这条回退，整支片子的旁白会被当成"没有旁白表"跳过 —— 那是漏检，不是 0 命中。
  const timingPath = path.join(taskDir, 'audio', 'timing.json');
  if (existsSync(timingPath)) {
    const j = JSON.parse(readFileSync(timingPath, 'utf8'));
    const lines = [];
    for (const s of j.scenes ?? []) {
      (s.lines ?? []).forEach((l, i) => lines.push({ id: `${s.id}-${i + 1}`, text: String(l.text ?? '') }));
    }
    if (lines.length) return { file: 'audio/timing.json', fallback: true, lines };
  }
  return null;
}

/** narration.json 的 id 是 `${段名}-${句序}`；timing.json 里有段表，用它可以报"第几段" */
function loadSegments(taskDir) {
  const p = path.join(taskDir, 'audio', 'timing.json');
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const map = new Map();
    (j.scenes ?? []).forEach((s, si) => {
      (s.lines ?? []).forEach((l, i) => map.set(`${s.id}-${i + 1}`, { scene: s.id, sceneIndex: si + 1, sentence: i + 1 }));
    });
    return map;
  } catch { return null; }
}

/** 要扫的画面代码：scenes/*.js + task.config.mjs（配置档任务把画面文字写在时间线里） */
function sourceFiles(taskDir) {
  const out = [];
  const scenes = path.join(taskDir, 'scenes');
  if (existsSync(scenes) && statSync(scenes).isDirectory()) {
    for (const f of readdirSync(scenes).sort()) if (f.endsWith('.js')) out.push(path.join(scenes, f));
  }
  const cfg = path.join(taskDir, 'task.config.mjs');
  if (existsSync(cfg)) out.push(cfg);
  return out;
}

/** 报告里的路径一律用 `/`（Windows 上也是），这样输出可以整段贴进 issue */
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/* ══════════════════════════════════════ 报告里"它在哪一段出现" */

/**
 * 报告里"它在哪一段出现"：先往**回**看几行找最近的"屏幕文字入口"（`caption(` / `writeLine(` …），
 * 因为最常见的写法是入口一行、文字在下一行：
 *     caption(ctx, {            ← 入口
 *       text: '原版每一段都有自己的缓冲区。',   ← 命中就在这一行
 * 找不到入口才退回看命中那一行自己的字段名（`text:` / `src:`）。只认这些写法特征，
 * 不猜语义 —— 猜错也就是个标签，`文件:行号` 加源码那一行才是证据。
 */
const OPENERS = [
  [/\bcaption\s*\(/, '说明条 caption'],
  [/\bkicker\s*\(/, '眉标 kicker'],
  [/\bfooter\s*\(/, '页脚 footer'],
  [/\bpanel\s*\(/, '面板 panel'],
  [/\bcodeRow\s*\(/, '代码行 codeRow'],
  [/\bwriteLine\s*\(|\btype\.write\s*\(/, '屏幕正文 writeLine'],
  [/\bmeter\s*\(/, '计量条 meter'],
  [/(^|[^\w.$])line\s*\(/, '画面小字 line()'],
];
const INLINE = [
  [/\bsrc\s*:/, '说明条文本（同一行还有出处）'],
  [/\btext\s*:/, '文本字段 text:'],
  [/\btitle\s*:/, '标题 title:'],
  [/\bsub\s*:/, '副标题 sub:'],
  [/\blabel\s*:/, '标签 label:'],
  [/\bid\s*:/, '代码标识 id:（多半不是画面文字）'],
];
/** 这一行看起来"一句已经写完了"（`});` / `);` / `]` 之类）—— 再往上找入口就会张冠李戴 */
const CLOSED = /^\s*[)\]},;]+\s*;?\s*$/;

function roleOf(raw, offset) {
  const back = raw.slice(Math.max(0, offset - 400), offset).split('\n').slice(-7).reverse();
  for (const l of back) {
    const open = OPENERS.find(([re]) => re.test(l));
    if (open) return open[1];
    if (CLOSED.test(l)) break;               // 语句闭合了，上面的 caption( 跟这一行没关系
  }
  const here = lineTextAt(raw, offset);
  return (INLINE.find(([re]) => re.test(here)) ?? [null, '字符串字面量'])[1];
}

/* ══════════════════════════════════════ 一个任务的检查 */

function lintTask(name, opts) {
  const dir = path.join(TASKS_DIR, name);
  const narration = loadNarration(dir);
  if (!narration) {
    // 判据要求的"安静跳过"：没有旁白表就是没得比，不是 0 命中，也不是错误
    return {
      name, skipped: true, reason: '没有 audio/narration.json，也没有 audio/timing.json',
      total: 0, hitCount: 0, hits: [], near: [], tooShort: [],
    };
  }
  const segments = loadSegments(dir);
  const files = sourceFiles(dir).map((f) => {
    const raw = readFileSync(f, 'utf8');
    const scanned = scanSource(raw);
    return { file: f, raw, ...scanned };
  });

  const hits = [];
  const near = [];
  const tooShort = [];
  let scannedSentences = 0;

  for (const line of narration.lines) {
    const needle = strip(line.text);
    if (needle.length < MIN_NEEDLE) { tooShort.push({ id: line.id, text: line.text }); continue; }
    scannedSentences++;
    const where = segments?.get(line.id) ?? null;
    const tag = where ? `第 ${where.sceneIndex} 段 ${where.scene}` : null;

    /**
     * 命中记录的主体。
     * `kind` 只在 `--all` 下不是 '字符串'（那一档不剥注释）：命中落在注释/裸代码里时，
     * 角色标签直接说明"这不是画面文字"，免得有人把 --all 的数字当成命中数。
     */
    const rec = (f, offset, literal, kind) => ({
      id: line.id, text: line.text,
      file: rel(f.file), line: lineAt(f.raw, offset),
      role: kind === '注释' ? '注释（分镜表引用，不是画面文字）'
        : kind === '裸代码' ? '裸代码（不是画面文字）'
          : roleOf(f.raw, offset),
      segment: tag,
      literal: literal.length > 120 ? `${literal.slice(0, 120)}…` : literal,
      code: lineTextAt(f.raw, offset).slice(0, 120),
      kind,
    });

    const found = [];
    if (opts.all) {
      // ── --all：**不做注释剥离**，整句在原始文本里出现就算，并标出它落在注释 / 字符串 / 裸代码 ──
      //    这一档是给你看"如果不剥离注释会怎样"的：分镜注释里逐句引用了旁白。
      for (const f of files) {
        const { cond, map } = condense(f.raw);
        let at = cond.indexOf(needle);
        while (at >= 0) {
          const off = map[at];
          const kind = f.comments.some((c) => off >= c.start && off < c.end) ? '注释'
            : f.strings.some((s) => off >= s.start && off < s.end) ? '字符串' : '裸代码';
          const lit = f.strings.find((s) => off >= s.start && off < s.end);
          found.push(rec(f, off, lit ? literalInner(f.raw, lit) : lineTextAt(f.raw, off), kind));
          if (found.length >= 2) break;                 // 一句最多点两个位置，够定位了
          at = cond.indexOf(needle, at + 1);
        }
        if (found.length >= 2) break;
      }
    } else {
      // ── 默认：**整句逐字 == 某个字符串字面量**（判据 ①+②，注释已被替换成空白） ──
      for (const f of files) {
        for (const s of f.strings) {
          const inner = literalInner(f.raw, s);
          if (strip(inner) !== needle) continue;
          if (CITATION.test(inner)) continue;           // 判据 ④：出处/URL 不算复述
          found.push(rec(f, s.start, inner, '字符串'));
        }
      }
    }
    if (found.length) {
      // 数字序排（'…js:213' 与 '…js:7' 按字符串比会错序）；同句多处只报第一处，其余列 alsoAt
      found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
      hits.push({ ...found[0], alsoAt: found.slice(1) });
      continue;
    }

    // ── 近似（`--near`）：两个方向都不是"整句逐字"，但对观众是同一类毛病 ──
    //    wrap：画面文字把整句包在更长的一句里（beast/scenes/origin.js「同一句话，换一套字符**来写**」）
    //    part：画面文字只是旁白句的一段（sodium/scenes/dispatch.js「原版每一段都有自己的缓冲区。」）
    let best = null;
    for (const f of files) {
      for (const s of f.strings) {
        const inner = literalInner(f.raw, s);
        const lit = strip(inner);
        if (lit.length < NEAR_MIN || CITATION.test(inner)) continue;
        const wrap = lit.length > needle.length && lit.includes(needle);
        const part = needle.includes(lit) && lit.length / needle.length >= NEAR_RATIO;
        if (!wrap && !part) continue;
        const cover = Math.min(lit.length, needle.length) / needle.length;
        if (!best || cover > best.cover) best = { ...rec(f, s.start, inner, '字符串'), cover, kind2: wrap ? 'wrap' : 'part' };
      }
    }
    if (best) near.push({ id: line.id, text: line.text, ...best });
  }

  return {
    name, skipped: false,
    narration: narration.file, narrationFallback: narration.fallback,
    total: narration.lines.length, scanned: scannedSentences,
    hitCount: hits.length, hits, near, tooShort,
    unclosed: files.filter((f) => f.unterminated).map((f) => rel(f.file)),
  };
}

/* ══════════════════════════════════════ 命令行 */

function parseArgs(argv) {
  const opts = { tasks: [], json: false, all: false, near: false, help: false };
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--near') opts.near = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) { console.error(`未知选项：${a}（-h 看用法）`); process.exit(2); }
    else opts.tasks.push(a);
  }
  return opts;
}

const HELP = `lint-narration-dup —— 检查画面文字有没有把旁白整句再写一遍

  node tools/lint-narration-dup.mjs                 扫 tasks/ 下所有有旁白表的任务
  node tools/lint-narration-dup.mjs sodium optifine 只扫指定任务
  node tools/lint-narration-dup.mjs --json          机器可读（退出码恒 0）
  node tools/lint-narration-dup.mjs --all           连注释里的命中一起报（默认跳过注释）
  node tools/lint-narration-dup.mjs --near          额外列出"部分复述"（不计入命中、不影响退出码）

判据：去掉标点与空白后，某个**字符串字面量** == 旁白整句（注释先被逐字符剥离）。
退出码：有命中 → 1；干净 → 0；用法/任务名写错 → 2（--json 恒 0）。`;

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(HELP); process.exit(0); }

/* ── 挑任务 ── */
const allTasks = readdirSync(TASKS_DIR)
  .filter((f) => { try { return statSync(path.join(TASKS_DIR, f)).isDirectory(); } catch { return false; } })
  .sort();
let names = opts.tasks;
if (names.length) {
  const bad = names.filter((n) => !allTasks.includes(n));
  if (bad.length) {
    // 任务名写错就报错退出：回归清单里"名字打错 → 静默 0 命中"是最坏的失败方式
    console.error(`❌ 没有这些任务：${bad.join(' ')}\n   现有任务：${allTasks.join(' ')}`);
    process.exit(2);
  }
} else {
  names = allTasks;
}

/* ── 跑 ── */
const results = names.map((n) => lintTask(n, opts));
const scannedTasks = results.filter((r) => !r.skipped);
const skipped = results.filter((r) => r.skipped);
const totalLines = scannedTasks.reduce((a, r) => a + r.total, 0);
const totalHits = scannedTasks.reduce((a, r) => a + r.hitCount, 0);
const totalNear = scannedTasks.reduce((a, r) => a + r.near.length, 0);
const pct = (n, m) => (m ? Math.round((n / m) * 100) : 0);

/**
 * `--all` 时顺手按**默认口径**（剥离注释）再算一遍，好在收尾给出对比数字 ——
 * 这就是判据 ③ 的证据："不剥注释会多出这么多"，多出来的全是分镜注释里的旁白引用。
 */
const strictTotals = opts.all
  ? (() => {
    const rs = names.map((n) => lintTask(n, { json: false, all: false, near: false })).filter((r) => !r.skipped);
    return { hits: rs.reduce((a, r) => a + r.hitCount, 0), lines: rs.reduce((a, r) => a + r.total, 0) };
  })()
  : null;

/* ── 机器可读 ── */
if (opts.json) {
  console.log(JSON.stringify({
    tool: 'lint-narration-dup',
    criteria: '去掉标点/空白后，某个字符串字面量 == 旁白整句（注释已逐字符剥离；出处/URL 跳过）',
    mode: { all: opts.all, near: opts.near },
    summary: {
      tasks: scannedTasks.length, skipped: skipped.length,
      sentences: totalLines, hits: totalHits, near: totalNear,
      percent: pct(totalHits, totalLines),
    },
    tasks: scannedTasks.map((r) => ({
      name: r.name, narration: r.narration, narrationFallback: r.narrationFallback,
      total: r.total, scanned: r.scanned, hitCount: r.hitCount,
      percent: pct(r.hitCount, r.total),
      hits: r.hits, near: opts.near ? r.near : undefined,
      tooShort: r.tooShort, unclosed: r.unclosed,
    })),
    skipped: skipped.map((r) => ({ name: r.name, reason: r.reason })),
  }, null, 2));
  process.exit(0);   // --json 恒 0：让调用方自己读 summary.hits 决定怎么办
}

/* ── 人看的 ── */
console.log('lint-narration-dup —— 画面文字有没有把旁白整句再写一遍');
console.log(`判据：去掉标点与空白后，某个字符串字面量 == 旁白整句${opts.all ? '（--all：不剥离注释，命中位置标出 注释/字符串/裸代码）' : '（注释已逐字符剥离）'}`);
console.log(`扫 ${scannedTasks.length} 个有旁白表的任务${skipped.length ? `，安静跳过 ${skipped.length} 个（没有旁白表）` : ''}\n`);

for (const r of scannedTasks) {
  const mark = r.hitCount ? '❌' : '✅';
  console.log(`${mark} ${r.name} —— ${r.hitCount}/${r.total} 句命中（${pct(r.hitCount, r.total)}%）`);
  const srcNote = r.narrationFallback ? `（回退到 ${r.narration}：这个任务没有 audio/narration.json）` : `（${r.narration}）`;
  console.log(`   旁白 ${r.total} 句${srcNote}`);
  if (r.tooShort.length) console.log(`   ${r.tooShort.length} 句太短（strip 后 < ${MIN_NEEDLE} 字）未进判据：${r.tooShort.map((s) => `「${s.text}」`).join(' ')}`);
  for (const h of r.hits) {
    const seg = h.segment ? `${h.segment} · ` : '';
    console.log(`   ${h.file}:${h.line}  〔${seg}${h.role}〕`);
    console.log(`     命中：「${h.text}」`);
    console.log(`     源码：${h.code}`);
    for (const a of h.alsoAt) console.log(`     同句还出现在：${a.file}:${a.line}〔${a.role}〕`);
  }
  if (opts.near && r.near.length) {
    console.log(`   ── 部分复述（只提示，不计入命中）：${r.near.length} 处`);
    for (const x of r.near.slice(0, NEAR_SHOW)) {
      const what = x.kind2 === 'wrap' ? '画面文字把整句包在里面' : `画面文字是旁白句的一段（${Math.round(x.cover * 100)}%）`;
      console.log(`   ${x.file}:${x.line}  〔${x.segment ? `${x.segment} · ` : ''}${x.role}〕${what}`);
      console.log(`     画面：「${x.literal}」   旁白：「${x.text}」`);
    }
    if (r.near.length > NEAR_SHOW) console.log(`   …… 另有 ${r.near.length - NEAR_SHOW} 处`);
  }
  for (const f of r.unclosed) console.log(`   ⚠ ${f} 扫描到文件尾仍未闭合（源码里可能有含引号的正则）—— 这个文件的判据可能不准`);
  console.log('');
}

if (skipped.length) {
  const show = skipped.map((r) => r.name);
  console.log(`· 跳过 ${skipped.length} 个任务（没有 audio/narration.json，也没有 audio/timing.json）：${show.slice(0, 12).join(' ')}${show.length > 12 ? ` … 等 ${show.length} 个` : ''}`);
  console.log('');
}

console.log('─'.repeat(72));
console.log(`合计：${scannedTasks.length} 个任务 / ${totalLines} 句旁白，${totalHits} 句被逐字写进画面（${pct(totalHits, totalLines)}%）`);
for (const r of scannedTasks) console.log(`· ${r.name} ${r.hitCount}/${r.total}（${pct(r.hitCount, r.total)}%）`);
if (strictTotals) {
  console.log(`· --all 不剥离注释：${totalHits}/${totalLines}；剥离注释（默认口径）：${strictTotals.hits}/${strictTotals.lines}` +
    ` —— 多出来的 ${totalHits - strictTotals.hits} 句全是分镜注释里的旁白引用（文件头那段分镜表），不是画面文字。`);
}
if (totalNear) {
  console.log(`另有 ${totalNear} 处「部分复述」（画面文字只是旁白句的一段，或把整句包在更长的画面文字里）` +
    `${opts.near ? '，见上面明细' : ' —— 加 --near 看明细'}；这一类不计入命中，也不影响退出码。`);
}
console.log('建议：画面文字只放标注（名词 / 数字 / 出处），句子交给旁白与字幕。');

/* 有命中就 1（好挂进回归清单）；干净就 0。--json 已在上面 return。 */
process.exit(totalHits ? 1 : 0);
