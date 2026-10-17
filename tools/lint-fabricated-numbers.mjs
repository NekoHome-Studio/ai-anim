// @ts-check
/**
 * lint-fabricated-numbers —— 静态检查：**画面上的数字有没有出处**
 *
 *   node tools/lint-fabricated-numbers.mjs                 扫 tasks/ 下所有有 FACTS.md 的任务
 *   node tools/lint-fabricated-numbers.mjs nekohome fidus  只扫这几个任务
 *   node tools/lint-fabricated-numbers.mjs --slots         只列"数值显示位"（不比对事实表）
 *   node tools/lint-fabricated-numbers.mjs --explain       连**找到出处**的数字一起报（附出处行号）
 *   node tools/lint-fabricated-numbers.mjs --json          机器可读（退出码恒 0）
 *   node tools/lint-fabricated-numbers.mjs --max 5         每个任务最多列几个值（默认 12，0 = 不限）
 *
 * 退出码：有"找不到出处"的数字 → 1；干净 → 0；用法/任务名写错 → 2。（`--json` 恒 0，见下。）
 *         ⚠ 判据 ③（算出来的显示位）**不进退出码** —— 它们不是"找不到出处"，
 *           只说明"这个位置静态查不到等于几，这一项没验"（见下面的判据 ③ 一节）。
 *
 * `--json` 的 schema（老字段的形状一个都没动，新增的四处用 `← 新` 标出来）：
 *   { tool, criteria,
 *     summary: { tasks, skipped, slots, unmatched, exempt, computed ← 新 },
 *     tasks: [ { name, facts, slotCount,
 *                computedCount ← 新, computed ← 新: [{ at: 'file:line', kind, role, snippet, code }],
 *                unmatched: [{ value, at, role, code, also }], matched?, slots?, exempt, unclosed } ],
 *     skipped: [ { name, reason } ],                                  // 形状不变
 *     skippedComputed ← 新: [ { name, computedCount, computed: [...] } ] }  // 没有 FACTS.md 的任务也扫了判据 ③
 *   `summary.computed` 与 `skippedComputed` **不进 summary.unmatched**、不影响退出码。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 为什么要有这个脚本
 *
 * 我们的画面**全是代码算的**，所以"编一个数字"的成本是零：`type.write('3359 条向量')`
 * 打错一位没人会知道。对外材料里一个编造的数字比画面难看严重得多
 * （`docs/BACKLOG.md` 1-22：「这条对我们的伤害面最大」；出处 `REFERENCE-hyperframes.md` §4.3
 * 「Numbers come from the script」+ Pre-Render Self-Audit：「绝不在帧尺度上编造数字、增量、
 * 日期、计数；槽位先渲染成 `— figure —`」）。
 * 这个脚本就是那条纪律的可复现版本：**扫"数值显示位"的字面量数字 → 查 FACTS.md → 报 `file:line`**。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 判据（①② 两句话；判据 ③ 在下面单独一节）
 *
 *   ① **什么算"数值显示位"**：会真的画到帧上的字符串里的数字字面量。
 *      不是"源码里所有数字"——坐标 / 字号 / 时长 / 阈值 / 颜色分量**全是数字字面量**，
 *      一刀切扫会淹在假阳性里（实测：nekohome 一个任务就有 557 处含数字的匹配，
 *      其中真正的显示位只有个位数）。
 *   ② **什么算"有出处"**：数字串在 `tasks/<任务>/FACTS.md` 的**正文里出现过**。
 *      片子自己的编号（`WORKS 04`、`v0.1.2`）与示意读数（计数器）同样要能在那里找到 ——
 *      找不到就只有两种解释：**要么是编的，要么事实表漏登记了**。两种都要改。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 判据 ① 的展开：哪些**是**数值显示位（每一类都在本仓库有实例）
 *
 *   A. 文字入口里的文本：
 *      `type.write(text, …)` / `type.writeLine(text, …)` / `type.karaoke(text, …)` /
 *      `type.paragraph(text, …)` / `type.writeOnPath(text, …)` /
 *      `put(type, str, …)` / `writeLine(type, str, …)`（`src/kit/layout.js` 的名字）/
 *      `codeRow(type, [{ s: … }], …)`（每个分段的 `s`）/
 *      `caption(…)` / `kicker(…)` / `footer(…)`（`src/kit/elements.js` 与任务自己的 `_kit.js`）。
 *      间接的也算：`const SUB = 'n = 12'` 定义在别处、`put(type, SUB, …)` 用的是它 ——
 *      判据跟的是**流向**（这个字面量有没有被送进文字入口的实参），不是"实参是不是字面量"。
 *      实例：`tasks/fidus/scenes/method.js` 的 `L9_STEPS` → `put(type, L9_STEPS[i], …)`。
 *
 *   B. 镜头模板 / 配置档节点的参数：`values`（柱子高度，就是那张图的数据）/ `title` / `sub` /
 *      `footer` / `label` / `unit` / `caption`。手写场景写在 `shot('chart', { … })` 里，
 *      配置档任务直接写在时间线节点上（`{ type: 'chart', values: […] }`），两种都算。
 *      实例：`tasks/nekohome/scenes/clicker.js` 的 `'CONTENT PACKS · 共十一个'`。
 *
 *   D. 任务自己包了一层再画（本仓库最常见的转发现场）：
 *      `scenes/_kit.js` 里 `export function kicker(type, lines, P, str, …) { type.write(str, …) }`，
 *      调用点是 `kicker(type, lines, P, '怎么做 / 原则 02', …)` —— 字符串在**实参**里，
 *      但在一个"包装函数"的位置上。判据为此先做一遍预扫：**函数体里出现文字入口的函数**
 *      就是包装函数，它的字面量实参也算显示位（同一任务内，跨文件也认）。
 *
 *   C. 旁白 / 字幕文本：`task.config.mjs` 的 `narration` 指向的脚本里的 `lines[].text`
 *      （`tasks/beast/tools/narration.mjs` 就是这一种），以及 `audio/narration.json` 的句子。
 *      字幕是引擎画的 —— **它也是画面文字**（`docs/CAPTIONS.md`）。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 判据 ① 的边界：哪些**不是**数值显示位（一律不进判据，这就是"不误报"的来源）
 *
 *   · 坐标 / 尺寸 / 线宽 / 半径 / 圆角（`x: 168`、`bw = slot * 0.55`）
 *   · 字号 / 字距 / 字重 / 行距（`size: 96`、`tracking: 4`）
 *   · 时长 / 时刻 / 延迟 / 缓动参数（`dur: 5`、`from: 0.35`、`prog(t, 1.6, 4.4)`）
 *   · 阈值 / 强度 / 不透明度 / 后处理参数（`bloom: 0.4`、`alpha: [0, 1]`、`peak: 0.95`）
 *   · 颜色分量与颜色字符串（`#5aa9e8`、`mul(P.signal, 1.35)`、`gl.clear(…, [0.1, …])`）
 *   · 字体名 / 锚点 / 缓动名这类枚举字符串（`family: 'mono'`、`from: 'up'`、`anchor: 'center'`）
 *   · **注释里的一切**：分镜注释逐句引用文案（`// 镜头 02 · 42 份协议 XML`），那不是画面文字 ——
 *     与 `lint-narration-dup` 同一条纪律（它不剥注释时 sodium 会从 12 句涨到 40 句）。
 *   · 数字**不是字面量**而是算出来的：`put(type, String(cnt).padStart(2, '0'), …)`、
 *     `${(o.values[idx] * 100).toFixed(1)}%`、`'防线 ' + (i + 1)`。
 *     ⚠ 这一类**不再静默排除**：它照样判不出来（要真跑一遍场景才知道等于几），
 *     但会被**单独列出来**并明说"这一项没验" —— 见下面的「判据 ③」。
 *     （第九轮补上的结构性盲区：`docs/BACKLOG.md` 头部待办 ③；
 *     "报告读起来像全都查过了"正是 `docs/DIAGNOSIS.md` §3「跳过不是通过」要挡的那种读法。）
 *
 *   ⚠ 已知的假阴性（诚实清单）：
 *     · 数字出现在 `FACTS.md` 里但**含义无关**时照样算"有出处"——判据是"串面出现"，
 *       不是"语义对应"。`--explain` 会打印命中的那一行，交付前应当人眼扫一遍它指的行
 *       是不是真的在说这个数。
 *     · 画面文字被拆成几段拼起来（`'3359' + ' 条'`）时只看得到字面量那半截。
 *     · 场景自己的 `_kit.js` 里转发一层再画（`export function foot(type, s, …) { put(type, s, …) }`）
 *       时，判据只认 `_kit.js` 内部那一次实参，调用点传进去的字符串靠"流向"兜 ——
 *       兜不住就漏（`--slots` 可以把全部显示位摊开人工复核）。
 *     · `values: [0.3, 0.7, 0.95]` 这种**纯数字数组元素**根本不在判据里（判据 ①② 只走字符串字面量）——
 *       它既不算"找得到出处"也不算"算出来的"（判据 ③ 只收"变量 / 表达式"那种元素）。
 *       本仓库的图表任务都是这个写法，所以 `values` 那条数字实际上**没人验**。
 *     · 文字入口的实参**整个是一个数字变量**（`type.write(cnt, …)`）时判据看不见它：
 *       不是字面量（判据 ①②），也不匹配判据 ③ 认的那几种包装形态。
 *     · 假阳性一处（本轮实测发现，**没改**）：`String(cnt).padStart(2, '0')` 里那个补零字符
 *       `'0'` 是**实参里的字面量**，会被判据 ①② 当成显示位 —— 事实表里恰好有一个独立的 `0`
 *       时才不报（fidus / sodium 就是这种巧合）。真要消掉它得改判据 ① 的"实参里任意字面量"
 *       口径，那会动到**所有任务**的条数，本轮没做。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 判据 ③：**算出来的显示位**（静默排除 → 单独报、且明说没验）
 *
 * 为什么要有它（`docs/BACKLOG.md` 第九轮待办 ③）：`String(cnt).padStart(2, '0')`、
 * `${(v * 100).toFixed(1)}%`、`'防线 ' + (i + 1)` 这些位置**是**显示位，只是静态看不见值。
 * 早先的处理是"不进判据" —— 而那恰恰是"编一个数字"最隐蔽的形式（它连字面量都不是），
 * 报告却读起来像"全都查过了"。现在它们进**另一份清单**，一行一句话：
 *
 *   算出来的值：N 处 —— 这些位置静态查不到等于几，这一项**没验**（判据 ③）
 *
 * 认这些形态（每条都在本仓库有实例，括号里是 `文件:行号`）：
 *   · 模板串插值：`` type.writeLine(`U+${…padStart(4, '0')}`) ``（`tasks/beast/scenes/encode.js:99`）
 *   · 字符串 `+` 拼接里带变量 / 表达式：`'防线 ' + (i + 1)`、`'口径待定：' + VOLUME`
 *   · 包了 `String(…)` / `.padStart(…)` / `.toFixed(…)` 的表达式：
 *     `put(type, String(cnt).padStart(2, '0'), …)`（`tasks/fidus/scenes/evidence1.js:106`）
 *   · `values: […]` 里是**变量或表达式**而不是字面量的元素（`values: [a, 0.7, trend(2)]` 报 2 个）
 *   · 上面这些先赋给变量 / 放进数组、之后才被送进文字入口（流向，同判据 ① 的 A/B）：
 *     `` const txt = `t = ${f.t.toFixed(3)}` `` 之后 `type.write(txt, …)`
 *     （`tasks/promo/scenes/_world.js:380`）
 * 认的位置与判据 ① 相同：文字入口实参、包装函数实参、显示位选项键（`title` / `sub` / …）、`values` 元素。
 *
 * 三条纪律：
 *   ① **0 处也要打一行**（`算出来的值：0 处`）—— 否则"没扫到"和"这段没执行"分不开；
 *   ② **退出码不变**（它们不是"找不到出处"）；`--json` 里读 `tasks[].computed` 与 `summary.computed`；
 *   ③ **没有 `FACTS.md` 的任务也照扫**（判据 ③ 只读源码，不需要事实表）——
 *      那几个任务在报告末尾照样逐条打 `算出来的值：N 处`（见「空 ≠ 干净」）。
 *
 * ⚠ 判据 ③ 自己的假阴性（诚实清单）：
 *     · **裸标识符实参**（`type.write(HUD, …)`、`put(type, LABEL, …)`）不算"算出来的" ——
 *       它们归判据 ①② 的"流向"管；只有初始化自模板串 / 拼接 / 数组元素时，
 *       判据 ③ 才在**定义处**报一条（`const HUD = `…``）。
 *     · 数值变量直接画（`type.write(cnt, …)`）不报（`type.write(String(cnt), …)` 会报）。
 *     · **跨文件流向**不报：A 文件算好、B 文件画，判据按文件各扫各的。
 *     · `values` 里那个**纯数字数组元素**（`[0.3, 0.7]`）既不是字面量判据的、也不是这一条的 —— 见上。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 「空 ≠ 干净」
 *
 * 没有 `FACTS.md` 的任务**安静跳过**（打印一行「没有事实表 ⇒ 这一项没验」），
 * 不计入命中、不影响退出码 —— 与 `lint-narration-dup` 对"没有旁白表"的处理一致，
 * 也是 `docs/DIAGNOSIS.md` §3「空 ≠ 干净」那一条的读法：**跳过不是通过**。
 * 有 `FACTS.md` 但一个显示位数字都没有，一样要能一眼分辨（那一行会写 0 个）。
 *
 * 判据 ③ 把这条纪律又往前推了一步（第九轮）：
 *   · **0 处也打一行** `算出来的值：0 处` —— 「这一类一个都没有」与「这段压根没跑」
 *     在输出里必须长得不一样（报告里没有这一行 = 判据 ③ 没执行）；
 *   · 判据 ③ **不看事实表**，所以没有 `FACTS.md` 的任务也照样扫、照样逐条打那一行
 *     （安静跳过的是"字面量比对"那一项）—— 否则那些任务的"算出来的值"
 *     会连"没验"都没人看见。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 豁免：`// numbers-ok: 理由`
 *
 * 写在**同一个语句里**（`;` / `{` / `}` 之间）的任意位置。理由必填，报告里会连理由一起打出来 ——
 * 豁免是给人看的例外，不是静音开关。片子自己的编号（`WORKS 04`）更推荐**登记进 FACTS.md**
 * 而不是打豁免：登记才留下证据。
 *
 * 实现上判据不猜语义，只做三件可复核的事：找显示位（`findRole`）、查串面（`lookupFacts`）、
 * 把算出来的显示位摊开（`collectComputed` —— 它不查表，只列位置）。
 * 源码扫描**逐字符**做（`scanSource`），注释被替换成等长空白，所以报的 `文件:行号`
 * 就是你在编辑器里看到的那个行号。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TASKS_DIR = path.join(ROOT, 'tasks');

/* ══════════════════════════════════════ 判据常数（都摆在这里，方便复核与调参） */

/**
 * 文字入口：**某个实参是"画出来的字"**的那批函数。
 * `writeLine` / `put` / `karaoke` / `codeRow` 这类名字足够专有，裸名匹配不会误伤；
 * `write` 必须带 `type.` 前缀（裸 `write(` 太泛，`fs.write` / `logger.write` 都可能）。
 */
const DISPLAY_FNS = new Set([
  'write', 'writeLine', 'writeOnPath', 'karaoke', 'paragraph',
  'put', 'codeRow', 'caption', 'kicker', 'footer',
]);
/** 调用点特征：抓"点号前的最后一段名字"，`type.write(` / `ctx.type.writeLine(` / `put(` 都能认 */
const CALL_RE = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g;

/**
 * 选项键 → 角色。只在**对象字面量里当键用**（`key:` 后面紧跟一个字符串/数组）才算，
 * 于是 `family: 'mono'` 这类枚举不会被当成文字（它不在表里）。
 * ⚠ **`note` 不在表里**：时间线节点的 `note` 只进 HUD 与命令行列表（`src/timeline.js`），
 * 不画到帧上 —— 把它算进来会让"制作备注"这种纯写作产物淹掉真命中（实测 nekohome 一个任务
 * 就多出 5 个假阳性）。
 */
const DISPLAY_KEYS = new Map([
  ['text', '文案 text'],
  ['title', '标题 title'],
  ['sub', '副标题 sub'],
  ['footer', '页脚 footer'],
  ['caption', '说明条 caption'],
  ['label', '标签 label'],
  ['kicker', '眉标 kicker'],
  ['unit', '单位 unit'],
  ['values', '图表数据 values'],
]);

/**
 * 判据 ③「算出来的显示位」的成因标签 —— 这几个词会**原样**打进报告的 `〔…〕` 里，
 * 也是 `docs/DIAGNOSIS.md` §1.15 登记的那几个词（那边要能 grep 到这边）。
 * 标签只解释"为什么判据看不见这个位置的值"，不猜它等于几（猜就是编）。
 */
const COMPUTED_KIND = {
  tpl: '模板串插值',
  concat: '字符串拼接',
  string: '包了 String()',
  padStart: '包了 .padStart()',
  toFixed: '包了 .toFixed()',
  values: 'values 里是变量 / 表达式',
};

/** 纯数字字面量（`0.3` / `-2` / `1e-3`）—— `values` 里这种元素不是"算出来的"（它是判据 ①② 的漏网，见文件头） */
const NUM_LITERAL = /^[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 数字 token 化 —— 一**条**正则先切"候选数字"，再按"它从哪开始"决定算不算数：
 *
 *   候选：`0.1.2` / `127.5` / `5,240,828` / `42`（含千分位与多个点的小数），
 *         后面可以紧跟 1~3 个 ASCII 字母或 `%` 当**单位**（`500ms` / `15%` / `10.9MB`）。
 *
 *   ① 前面紧贴**字母** → 长在 ASCII 词里，丢掉（`BASE64` 的 `64`、`sha256` 的 `256`）。
 *      **中文不算词内邻接**：`WORKS 04 / 游戏框架`、`3 点验证` 的数字前面是空格或汉字，
 *      挡掉它们会把真命中全丢掉。
 *   ② 前面紧贴 "." 且再前面是数字 → 那是小数的尾巴（`73.6` 的 `6`），丢掉；
 *      再前面不是数字（`v0.1.0` 的 `1`）→ 版本号的一段，从点开始收。
 *   ③ 一个 body 里出现**两个以上**的点时切到第一个点（`0.1.0` → `0.1`）：
 *      多段版本号在事实表里没法逐段对应，收窄一点只损失精度、不产生误报。
 *   ④ body 里再切出所有"数字段"（`0.1.2` → `0.1` 与 `2`）逐个去查事实表 ——
 *      所以 `127.5s` 与 `127.5` 都算有出处。
 */
const NUM_SCAN = /\d+(?:[.,]\d+)*[A-Za-z]{0,3}%?/g;const SEG_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\d*\.\d+/g;

/** 把一段字面文本切成 `[{ value, nums }]`；`value` 是原样（含单位），`nums` 是拿去查表的所有数字段 */
function tokenizeNumbers(text) {
  const out = [];
  for (const m of text.matchAll(NUM_SCAN)) {
    const at = m.index;
    const before = at > 0 ? text[at - 1] : '';
    const prev2 = at > 1 ? text[at - 2] : '';
    if (/[A-Za-z]/.test(before)) continue;                     // ① 词内数字
    const dotLead = before === '.' && !/\d/.test(prev2);       // ② 版本号的一段（`v0.1.0`）
    if (before === '.' && !dotLead) continue;                  // ② 小数的尾巴（`73.6` 的 `6`）
    // 单位：数字后面紧跟的 1~3 个字母或 `%`（`500ms` / `15%`）；剥掉之后 body 必须是纯数字串
    const tail = /[A-Za-z%]+$/.exec(m[0])?.[0] ?? '';
    let body = tail ? m[0].slice(0, -tail.length) : m[0];
    body = body.replace(/^[.,]+|[.,]+$/g, '');
    if (!body) continue;
    let unit = tail;
    if (!unit) {
      const rest = text.slice(at + m[0].length);
      const u = /^ [A-Za-z]{1,3}%?|^ %/.exec(rest);
      if (u && !/[A-Za-z_.]/.test(rest[u[0].length] ?? '')) unit = u[0];
    }
    if ((body.match(/\./g) ?? []).length > 1 && !/^\d{1,3}(?:,\d{3})+/.test(body)) {
      body = body.slice(0, body.indexOf('.'));                 // ③ 多段版本号收窄
    }
    const nums = [...new Set(body.replace(/,/g, '').match(SEG_RE) ?? [])];
    if (!nums.length) continue;
    const clean = body.replace(/[.,]/g, '');
    if (clean && !nums.includes(clean)) nums.push(clean);      // `0.1.1` → 也试 `011`
    out.push({ value: (dotLead ? '.' : '') + body + unit, nums: nums.map((n) => (n.startsWith('.') ? `0${n}` : n)) });
  }
  return out;
}

/** `// numbers-ok: 理由` —— 显式豁免，理由必填 */
const OK_MARK = /numbers-ok\s*[:：]\s*(\S[^\n]*)/;

/* ══════════════════════════════════════ 源码扫描（注释 → 等长空白） */

/**
 * 逐字符扫一遍源码，得到：
 *   · `code`     —— 注释被替换成**等长空白**（换行原样保留）之后的文本：匹配只用它；
 *   · `strings`  —— 每个字符串字面量的 `[start, end)`（含两头的引号）；
 *   · `comments` —— 每个注释的 `[start, end)`。
 * 长度不变 ⇒ 下标 → 行号不需要映射表，报出来的行号必然与编辑器一致。
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
      code += ' '; i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        comments.push({ start, end: i + 2, kind: 'block' });
        state = 'code'; code += '  '; i += 2; continue;
      }
      code += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (c === '\\') { code += c + (c2 ?? ''); i += 2; continue; }
    if (c === state) { strings.push({ start, end: i + 1 }); state = 'code'; code += c; i++; continue; }
    code += c; i++; continue;
  }
  if (state === 'line' || state === 'block') comments.push({ start, end: n, kind: state });
  return { code, strings, comments, unterminated: state !== 'code' && state !== 'line' };
}

const literalInner = (raw, span) => raw.slice(span.start + 1, span.end - 1);

/** 把字符串字面量拆成"字面文本片段"，跳过 `${…}` 插值（判据：算出来的数字判不出来） */
function literalParts(inner) {
  const parts = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '\\') { cur += c + (inner[i + 1] ?? ''); i++; continue; }
    if (c === '$' && inner[i + 1] === '{') {
      let depth = 1; i += 2;
      while (i < inner.length && depth > 0) {
        if (inner[i] === '{') depth++;
        else if (inner[i] === '}') depth--;
        i++;
      }
      i--;
      parts.push(cur); cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.filter((p) => p.length);
}

function lineAt(raw, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < raw.length; i++) if (raw[i] === '\n') line++;
  return line;
}

function lineTextAt(raw, offset) {
  const a = raw.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  let b = raw.indexOf('\n', offset);
  if (b < 0) b = raw.length;
  return raw.slice(a, b).trim();
}

/** 下标所在语句的范围（往回 / 往前找 `;` `{` `}` 或空行）—— 只用来做豁免 */
function statementRange(code, offset) {
  let a = offset;
  while (a > 0 && !';{}'.includes(code[a - 1])) a--;
  let b = offset;
  while (b < code.length && code[b] !== ';') b++;
  return [a, Math.min(b + 1, code.length)];
}

/* ══════════════════════════════════════ 显示位识别 */

/**
 * 文字入口调用的实参范围。**只向前扫** —— 早先试过"从字面量往回找最近的那个 `(`"，
 * 那会在同一行有两次调用时（`type.writeLine(…); type.write('48…')`）一路走回**上一行**的
 * `(`，把第二个字面量挂到第一个调用上（实测：编造的 `142` 因此漏报）。
 * 向前扫没有这个问题：每个 `(` 只属于它自己那个调用。
 */
function displayCallSpans(code) {
  const spans = [];
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(code))) {
    const fname = m[1].replace(/\s+/g, '');
    const short = fname.split('.').pop();
    if (!DISPLAY_FNS.has(short)) continue;
    // `write` 这个裸名太泛（`fs.write` / `logger.write` 都可能）：只认 `*.type.write`
    if (short === 'write' && !/(^|\.)type$/.test(fname.slice(0, -'.write'.length))) continue;
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    spans.push({
      fn: fname, short,
      open: m.index + m[0].length - 1, argsStart: start, argsEnd: i - 1,
    });
    if (CALL_RE.lastIndex <= m.index + m[1].length) CALL_RE.lastIndex = m.index + m[1].length;
  }
  return spans;
}

/** 把一个 `(` … `)` 之间的实参按深度 0 的逗号切开 */
function argRanges(code, from, to) {
  const out = [[from, to]];
  let d = 0;
  for (let i = from; i < to; i++) {
    const ch = code[i];
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) d--;
    else if (ch === ',' && d === 0) {
      out[out.length - 1][1] = i;
      out.push([i + 1, to]);
    }
  }
  return out;
}

/** 这个字面量是不是某个文字入口的实参；是的话返回角色标签 */
function displayCallRole(spans, pos) {
  for (const s of spans) {
    if (pos < s.argsStart || pos >= s.argsEnd) continue;
    if (s.short === 'codeRow') return `代码行 codeRow（分段文本 ${s.fn}）`;
    return `文字入口 ${s.fn}()`;
  }
  return null;
}

/** `key: '…'` / `key: ['…']` —— 选项键 */
function displayKeyRole(code, pos) {
  const m = code.slice(Math.max(0, pos - 64), pos).match(/([A-Za-z_$][\w$]*)\s*:\s*$/);
  if (!m) return null;
  const role = DISPLAY_KEYS.get(m[1]);
  return role ? `选项键 ${role}` : null;
}

/**
 * 流向：这个字面量会不会**间接**进文字入口。
 *   ① `const SUB = 'n = 12'` → 文字入口的实参里出现了标识符 `SUB`；
 *   ② `const STEPS = ['3 点验证', …]` → 文字入口的实参里出现了 `STEPS`（下标访问也算）。
 * 只看**同一个文件**（本仓库的写法就是这样；跨文件转发是已知漏报，见文件头）。
 */
function buildFlow(code, strings, spans) {
  const used = new Set();
  for (const s of spans) {
    for (const id of code.slice(s.argsStart, s.argsEnd).matchAll(/[A-Za-z_$][\w$]*/g)) used.add(id[0]);
  }
  /** 字面量的"身份标识符"：赋值目标名，或者它所在数组的变量名 */
  const owner = new Map();
  for (const s of strings) {
    const before = code.slice(Math.max(0, s.start - 400), s.start);
    const mAssign = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
    if (mAssign) { owner.set(s.start, mAssign[1]); continue; }
    const mArr = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[[^\]]*$/);
    if (mArr) { owner.set(s.start, mArr[1]); continue; }
  }
  return { used, owner };
}

/** 每个字符串字面量的角色；返回 `null` = 不是数值显示位（判据边界里那一堆） */
function findRole(env, span) {
  const direct = displayCallRole(env.spans, span.start);
  if (direct) return direct;
  const keyed = displayKeyRole(env.code, span.start);
  if (keyed) return keyed;
  // 间接：字面量先赋给变量 / 放进数组，之后才被送进文字入口
  const name = env.flow.owner.get(span.start);
  if (name && env.flow.used.has(name)) return `流向文字入口的 ${name}`;
  // 包装函数（判据 D）：`kicker(type, lines, P, '怎么做 / 原则 02', …)`
  const wrap = env.flow.wrapperAt.get(span.start);
  if (wrap) return `流向文字入口的包装函数 ${wrap}`;
  return null;
}

/**
 * 判据 D 的预扫：**函数体里出现过文字入口的函数** = 包装函数。
 * 认三种写法：`export function kicker(type, …) {…}` / `const foot = (…) => {…}` / `function f(…) {…}`。
 * 包装函数的字面量实参随后由 `buildWrapperSlots()` 收成显示位。
 */
function collectWrappers(code) {
  const names = new Set();
  CALL_RE.lastIndex = 0;                       // 全局正则的状态要自己管，否则上一次的 lastIndex 会漏进来
  const defs = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  ];
  for (const re of defs) {
    let m;
    while ((m = re.exec(code))) {
      const open = code.indexOf('{', m.index + m[0].length);
      if (open < 0) continue;
      let depth = 1;
      let i = open + 1;
      while (i < code.length && depth > 0) {
        const ch = code[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
      }
      const body = code.slice(open + 1, i - 1);
      for (const c of body.matchAll(CALL_RE)) {
        const short = c[1].replace(/\s+/g, '').split('.').pop();
        if (DISPLAY_FNS.has(short)) { names.add(m[1]); break; }
      }
    }
  }
  return names;
}

/**
 * 包装函数（判据 D）的**调用点整段实参**范围：`[{ start, end, name }]`。
 * 判据 D 收它里面的字面量实参；判据 ③ 收它里面的"算出来的"实参 —— 两处共用同一份调用点，
 * 免得"字面量认、算出来的不认"分叉。
 */
function wrapperCallSites(code, wrappers) {
  const out = [];
  if (!wrappers.size) return out;
  CALL_RE.lastIndex = 0;
  let c;
  while ((c = CALL_RE.exec(code))) {
    const name = c[1].replace(/\s+/g, '').split('.').pop();
    if (!wrappers.has(name)) continue;
    // 取整段实参（到配平的 `)`）
    let i = c.index + c[0].length;
    let depth = 1;
    const start = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    out.push({ start, end: i - 1, name, fn: name });
    if (CALL_RE.lastIndex <= c.index + c[1].length) CALL_RE.lastIndex = c.index + c[1].length;
  }
  return out;
}

/**
 * 判据 D：包装函数调用点里的**字面量实参**。
 * 返回 `Map<字面量起点, 包装函数名>`，只收"实参位置上的字符串字面量"，
 * 函数体里那些不算（它们已经按判据 A 处理过了）。
 */
function buildWrapperSlots(code, strings, wrappers) {
  const at = new Map();
  for (const site of wrapperCallSites(code, wrappers)) {
    const spans = argRanges(code, site.start, site.end);
    for (const s of strings) {
      if (s.start < site.start || s.start >= site.end) continue;
      if (spans.some(([a, b]) => s.start >= a && s.start < b)) at.set(s.start, site.name);
    }
  }
  return at;
}

/* ══════════════════════════════════════ 判据 ③：算出来的显示位 */

/** 把一段源码压成一行（报告里那一行原文可能很长，摘出来的还带换行） */
const oneLine = (s, n = 60) => s.replace(/\s+/g, ' ').trim().slice(0, n);

/** [a,b) 里第一个非空白字符的下标（区域左边常带着逗号后的空格 / 换行） */
function firstInk(code, a, b) {
  let i = a;
  while (i < b && /\s/.test(code[i])) i++;
  return i < b ? i : a;
}

/** 整段就是**一个**字符串字面量时返回那个 span（允许两头空白）；否则 null */
function stringSpanAt(code, strings, a, b) {
  const A = firstInk(code, a, b);
  let B = b;
  while (B > A && /\s/.test(code[B - 1])) B--;
  return strings.find((s) => s.start === A && s.end === B) ?? null;
}

/**
 * 数组字面量的**顶层元素**范围。`a` 是含 `[` 的片段起点，`b` 是它所在实参的末尾。
 * 用配平扫描（不是正则）：元素里再套数组 / 对象 / 函数调用都不会切错。
 */
function arrayElements(code, a, b) {
  const open = code.indexOf('[', a);
  if (open < 0 || open >= b) return [];
  const out = [];
  let d = 0;
  let start = open + 1;
  for (let i = open; i < b; i++) {
    const ch = code[i];
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) {
      d--;
      if (d === 0) { out.push([start, i]); break; }
    } else if (ch === ',' && d === 1) { out.push([start, i]); start = i + 1; }
  }
  return out;
}

/** 从 `[` / `{` / `(` 扫到配对的收括号，返回它的下标（没配对返回 code.length） */
function matchBracketIndex(code, openAt) {
  let d = 0;
  for (let i = openAt; i < code.length; i++) {
    const ch = code[i];
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) { d--; if (d === 0) return i; }
  }
  return code.length;
}

/** `key: <expr>` 里那个表达式的范围（从冒号扫到**同级**的逗号 / 收括号 / 分号） */
function valueRangeAfter(code, colonAt, limit) {
  let i = colonAt + 1;
  while (i < limit && /\s/.test(code[i])) i++;
  const start = i;
  let d = 0;
  for (; i < limit; i++) {
    const ch = code[i];
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) { if (d === 0) break; d--; }
    else if ((ch === ',' || ch === ';') && d === 0) break;
  }
  return [start, i];
}

/**
 * 显示位选项键（DISPLAY_KEYS）在源码里出现的位置。
 * ⚠ 只在**对象字面量的键位**上认：前面隔着空白是 `{` / `,` / `(` / `[` ——
 * 这样 `x ? a : b` 里的 `:` 不会被当成键（判据 ① 是拿字面量**往回**找键名，没有这个风险；
 * 判据 ③ 是**向前**找键名，所以要多这一道）。
 */
function displayKeySites(code) {
  const out = [];
  const re = /([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(code))) {
    const role = DISPLAY_KEYS.get(m[1]);
    if (!role) continue;
    const before = code.slice(0, m.index).trimEnd();
    const prev = before[before.length - 1];
    if (prev !== '{' && prev !== ',' && prev !== '(' && prev !== '[') continue;
    out.push({ key: m[1], role, colon: m.index + m[0].length - 1 });
  }
  return out;
}

/** 对象字面量里指定键的值范围 —— `codeRow` 的分段 `{ s: … }` 用它 */
function propValues(code, a, b, keys) {
  const out = [];
  for (const m of code.slice(a, b).matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
    if (!keys.includes(m[1])) continue;
    out.push(valueRangeAfter(code, a + m.index + m[0].length - 1, b));
  }
  return out;
}

/**
 * 这个字符串字面量是不是**直接**被 `+` 拼着（`'x' + n` / `n + 'x'`）。
 * 只看紧邻两侧 —— 否则坐标表达式里的 `{ family: 'mono' }` 会把整段算成「拼接」：
 * 实测假阳性 `tasks/optifine/scenes/natural.js:182`
 * （`type.writeLine('算术', G.x + type.measure(NOTE, { size: 20, family: 'mono' }) + 16, …)`）。
 */
function plusAdjacent(code, span) {
  let i = span.start - 1;
  while (i >= 0 && /\s/.test(code[i])) i--;
  if (code[i] === '+') return true;
  let j = span.end;
  while (j < code.length && /\s/.test(code[j])) j++;
  return code[j] === '+';
}

/** 去掉区域里的字符串字面量之后剩下的源码（拼接的「另一半」是不是变量 / 表达式，看它） */
function textWithoutStrings(env, a, b) {
  let out = '';
  let i = a;
  for (const s of env.strings) {
    if (s.start < a || s.end > b) continue;
    out += env.code.slice(i, s.start);
    i = s.end;
  }
  return out + env.code.slice(i, b);
}

/**
 * 判据 ③ 的核心：这个区域（实参 / 选项键的值 / 数组元素）是不是**算出来的**。
 * 返回成因标签（COMPUTED_KIND），不是就 null。判据**保守优先**：认不出来就当不是
 * （假阴性写在文件头的诚实清单里），绝不把纯字面量、坐标、字号算进来。
 */
function classifyComputed(env, a, b, opts = {}) {
  const text = env.code.slice(a, b).trim();
  if (!text) return null;
  const span = stringSpanAt(env.code, env.strings, a, b);
  if (span) return literalInner(env.raw, span).includes('${') ? COMPUTED_KIND.tpl : null;
  if (/^[A-Za-z_$][\w$]*$/.test(text)) return opts.inValues ? COMPUTED_KIND.values : null;
  if (NUM_LITERAL.test(text)) return null;
  if (text.startsWith('[') || text.startsWith('{')) return null;
  if (/\.padStart\s*\(/.test(text)) return COMPUTED_KIND.padStart;
  if (/\.toFixed\s*\(/.test(text)) return COMPUTED_KIND.toFixed;
  if (/\bString\s*\(/.test(text)) return COMPUTED_KIND.string;
  if (env.strings.some((s) => s.start >= a && s.end <= b && plusAdjacent(env.code, s))
      && /\S/.test(textWithoutStrings(env, a, b).replace(/\+/g, ' '))) return COMPUTED_KIND.concat;
  return opts.inValues ? COMPUTED_KIND.values : null;
}

/**
 * `values: […]` / 数组流向里的**元素**：字面量（数字 / 纯字符串）不算，
 * 变量与表达式才算 —— 它们正是「算出来的」。非数组（`values: SERIES`）整段当一个元素看。
 * `fallbackKind` 给「流向」那一路用（同一个标签能分出它是跟着变量进来的）。
 */
function valueSites(env, a, b, fallbackKind = COMPUTED_KIND.values, strict = false) {
  const out = [];
  const take = (ea, eb) => {
    const t = env.code.slice(ea, eb).trim();
    if (!t) return;
    const span = stringSpanAt(env.code, env.strings, ea, eb);
    if (span && !literalInner(env.raw, span).includes('${')) return;   // 纯字符串：判据 ①② 管
    if (NUM_LITERAL.test(t)) return;                                    // 纯数字：判据 ①② 的漏网（见文件头）
    if (t.startsWith('[') || t.startsWith('{')) return;
    const kind = classifyComputed(env, ea, eb, { inValues: true });
    if (!kind) return;
    // 严格档（「流向」那一路）：只认显式形态。兜底的 `values` 标签会误伤**数学向量** ——
    // 实测 `tasks/optifine/scenes/_world.js:326` 的 `const o = [c[0] + g[0][0] * h[0], …]`：
    // `o` 恰好是某个显示位的选项对象名，于是三个分量全被当成「算出来的」。
    if (strict && kind === COMPUTED_KIND.values) return;
    out.push({ at: firstInk(env.code, ea, eb), snippet: oneLine(t), kind: kind === COMPUTED_KIND.values ? fallbackKind : kind });
  };
  if (env.code.slice(firstInk(env.code, a, b), b).startsWith('[')) {
    for (const [ea, eb] of arrayElements(env.code, a, b)) take(ea, eb);
  } else take(a, b);
  return out;
}

/** 判据 ③：一个实参区域里「算出来的」位置（数组 / 对象再往下走一层） */
function collectArg(env, a, b, role, push) {
  const text = env.code.slice(a, b).trim();
  if (!text) return;
  if (text.startsWith('[')) {
    for (const [ea, eb] of arrayElements(env.code, a, b)) collectArg(env, ea, eb, role, push);
    return;
  }
  if (text.startsWith('{')) {
    // `codeRow` 的分段对象：`{ s: 'GET ' + path }`
    for (const [va, vb] of propValues(env.code, a, b, ['s', 'text'])) {
      const kind = classifyComputed(env, va, vb);
      if (kind) push(firstInk(env.code, va, vb), kind, role, env.code.slice(va, vb));
    }
    return;
  }
  const kind = classifyComputed(env, a, b);
  if (kind) push(firstInk(env.code, a, b), kind, role, env.code.slice(a, b));
}

/**
 * 判据 ③ 的入口：扫一个文件里的**算出来的显示位**，按源码顺序返回
 * `[{ file, line, kind, role, code }]`。
 * 四处来源与判据 ① 的位置一一对应：文字入口实参、包装函数实参、显示位选项键、流向（变量 / 数组元素）。
 */
function collectComputed(env) {
  const out = [];
  const seen = new Set();
  const push = (at, kind, role, snippet) => {
    if (at == null || seen.has(at)) return;      // 同一个位置只报一次（实参 / 选项键 / 流向可能重叠）
    seen.add(at);
    out.push({
      at, kind, role, snippet: oneLine(snippet ?? ''), file: relOf(env.file),
      line: lineAt(env.raw, at),
      code: lineTextAt(env.raw, at).slice(0, 160),
    });
  };

  // ① 文字入口 + ② 包装函数：共用同一套实参切法（`put(type, …)` / `kicker(type, …)`）
  const sites = [];
  for (const s of env.spans) sites.push({ start: s.argsStart, end: s.argsEnd, fn: s.fn, short: s.short });
  for (const w of wrapperCallSites(env.code, env.wrappers)) sites.push({ ...w, short: w.name });
  for (const site of sites) {
    const role = site.short === 'codeRow'
      ? `代码行 codeRow（分段文本 ${site.fn}）`
      : (site.name ? `流向文字入口的包装函数 ${site.name}` : `文字入口 ${site.fn}()`);
    for (const [a, b] of argRanges(env.code, site.start, site.end)) collectArg(env, a, b, role, push);
  }

  // ③ 显示位选项键（`title:` / `sub:` / `values:` …）
  for (const k of displayKeySites(env.code)) {
    const [a, b] = valueRangeAfter(env.code, k.colon, env.code.length);
    const role = `选项键 ${k.role}`;
    if (k.key === 'values') {
      for (const el of valueSites(env, a, b)) push(el.at, el.kind, role, el.snippet);
      continue;
    }
    const kind = classifyComputed(env, a, b);
    if (kind) push(firstInk(env.code, a, b), kind, role, env.code.slice(a, b));
  }

  // ④ 流向：模板串 / 数组元素先落到变量上，之后才被送进文字入口（同判据 ① 的 A / B）
  for (const s of env.strings) {
    const name = env.flow.owner.get(s.start);
    if (!name || !env.flow.used.has(name)) continue;
    if (literalInner(env.raw, s).includes('${')) push(s.start, COMPUTED_KIND.tpl, `流向文字入口的 ${name}`, env.code.slice(s.start, s.end));
  }
  for (const m of env.code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g)) {
    if (!env.flow.used.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const end = matchBracketIndex(env.code, open) + 1;
    for (const el of valueSites(env, open, end, COMPUTED_KIND.values, true)) push(el.at, el.kind, `流向文字入口的 ${m[1]}`, el.snippet);
  }

  out.sort((x, y) => x.at - y.at);
  return out.map(({ at, ...rest }) => rest);
}
/* ══════════════════════════════════════ FACTS.md */

/**
 * 读事实表。判据用的是**正文里有没有这一串**：
 *   ① 原样（`5,240,828` / `500ms`）；② 去掉千分位逗号（`5240828`）；
 *   ③ 拆掉单位后缀（`500ms` → `500`）—— `500ms 帧差分` 在事实表里写的是 `500ms`，
 *      但 `127.5s` 也可能写成 `127.5 秒`，两种都试；
 *   ④ 常见单位换算（`s` → `秒`、`ms` → `毫秒`）—— 中文文档里单位常写成汉字。
 * 返回命中的那一行（第一处），没有就 null。
 */
function loadFacts(taskDir) {
  const p = path.join(taskDir, 'FACTS.md');
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8');
  const lines = raw.split('\n').map((t, i) => ({ n: i + 1, t }));
  return { path: p, raw, lines };
}

const UNIT_MAP = { s: '秒', ms: '毫秒', px: '像素', fps: 'fps', dpi: 'dpi', b: 'B', kb: 'KB', mb: 'MB', s2: '秒' };

/**
 * 数字 → 出处。两级判据（顺序固定，先严后宽）：
 *   ① **数字边界**匹配：事实表里出现的地方，两侧不能再是数字或点 —— `73.6` 命中
 *      `标准差 73.6（很高）`，但 **不会**误命中 `v0.1.0-beta.2` 里的 `0.2` 那种子串。
 *   ② 没命中才退回**子串**匹配（用来兜住"去千分位逗号"与"单位写成汉字"两种写法），
 *      并且只对**多段数字**（含 `.` 或 `,`）放宽 —— 单段数字按判据 ① 就够了，
 *      放宽只会引入噪声。
 * 每个候选值都试：原样（`5,240,828`）、去逗号（`5240828`）、单位换算（`127.5s` → `127.5秒`）。
 */
function lookupFacts(facts, slot) {
  const nums = slot.nums ?? [slot.value.replace(/,/g, '')];
  // 候选值的**顺序就是优先级**：原样（`0,0`）→ 数字段（`0.1.1` 的 `0.1` / `0.1`）→ 去分隔符（`00`）
  const cands = [...new Set([slot.value.replace(/[A-Za-z%]+$/, ''), ...nums, slot.value.replace(/[.,]/g, '')])]
    .filter((c) => c && /\d/.test(c) && !/[A-Za-z]/.test(c));
  const m = slot.value.match(/^([\d,.]+)([A-Za-z]{1,3}%?|%)$/);
  if (m) {
    const u = m[2].toLowerCase();
    if (UNIT_MAP[u]) cands.push(`${m[1]}${UNIT_MAP[u]}`);
  }
  // 整数写法也要能命中事实表里的浮点写法：`160` ↔ `shadowDistance = 160.0`
  for (const c of [...cands]) if (/^\d+$/.test(c)) cands.push(`${c}.0`);
  // ① 数字边界
  for (const c of cands) {
    const re = new RegExp(`(?<![\\d.])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.])`);
    for (const ln of facts.lines) if (re.test(ln.t)) return ln;
  }
  // ② 子串（只对多段数字）
  for (const c of cands) {
    if (!/[.,]/.test(c)) continue;
    for (const ln of facts.lines) if (ln.t.includes(c)) return ln;
  }
  return null;
}

/* ══════════════════════════════════════ 一个任务的检查 */

/** 要扫的文件：scenes/*.js、tools/*.mjs（旁白脚本常在这里）、task.config.mjs */
function sourceFiles(taskDir) {
  const out = [];
  const push = (d, filter) => {
    if (!existsSync(d) || !statSync(d).isDirectory()) return;
    for (const f of readdirSync(d).sort()) if (filter(f)) out.push(path.join(d, f));
  };
  push(path.join(taskDir, 'scenes'), (f) => f.endsWith('.js'));
  push(path.join(taskDir, 'tools'), (f) => f.endsWith('.mjs') || f.endsWith('.js'));
  const cfg = path.join(taskDir, 'task.config.mjs');
  if (existsSync(cfg)) out.push(cfg);
  return out;
}

/** 报告里的路径：**只要在仓库里就一律相对仓库根**（Windows 上也用 `/`），
 *  仓库外的（把 `--dir` 指到别处的夹具）才退回绝对路径 —— 两种形状都还能点进编辑器。 */
const relOf = (p) => {
  const r = path.relative(ROOT, p);
  return (!r || r.startsWith('..')) ? p.split(path.sep).join('/') : r.split(path.sep).join('/');
};

/**
 * 扫一个任务。
 *
 * ⚠ 判据 ③（算出来的显示位）**不看事实表** —— 所以它在 `loadFacts()` 判空**之前**扫：
 *   没有 `FACTS.md` 的任务也照样带回 `computed`（文件头「空 ≠ 干净」那一节讲的就是这件事）。
 */
function lintTask(name, tasksRoot = TASKS_DIR) {
  const dir = path.join(tasksRoot, name);
  const facts = loadFacts(dir);

  const slots = [];
  const exempt = [];
  const unclosed = [];
  const computed = [];
  const files = sourceFiles(dir);

  // 第一步：预扫包装函数（判据 D）—— 要先知道任务里哪些函数"肚子里是文字入口"，
  // 才能把它们的调用点实参算成显示位（`kicker(type, lines, P, '怎么做 / 原则 02', …)`）。
  const parsed = files.map((file) => {
    const raw = readFileSync(file, 'utf8');
    const scanned = scanSource(raw);
    return { file, raw, ...scanned };
  });
  const wrappers = new Set();
  for (const f of parsed) for (const n of collectWrappers(f.code)) wrappers.add(n);

  // 第二步：逐文件判角色（同一个 env 同时喂判据 ①② 与判据 ③）
  for (const f of parsed) {
    const { raw, code, strings, file } = f;
    if (f.unterminated) unclosed.push(relOf(file));
    const spans = displayCallSpans(code);
    const env = { raw, code, strings, file, spans, wrappers, flow: null };
    env.flow = buildFlow(code, strings, spans);
    env.flow.wrapperAt = buildWrapperSlots(code, strings, wrappers);

    // 判据 ③ 先跑：它只读源码，不看事实表（没有 FACTS.md 的任务也要这一段）
    for (const c of collectComputed(env)) computed.push(c);
    if (!facts) continue;                    // 没有事实表 ⇒ 字面量这一项不判（安静跳过，见文件头）

    for (const span of strings) {
      const inner = literalInner(raw, span);
      if (!/\d/.test(inner)) continue;
      const role = findRole(env, span);
      if (!role) continue;
      const line = lineAt(raw, span.start);
      const [sa, sb] = statementRange(code, span.start);
      const mark = raw.slice(sa, sb).match(OK_MARK);
      const base = {
        file: relOf(file), line, role,
        code: lineTextAt(raw, span.start).slice(0, 160),
      };
      if (mark) { exempt.push({ ...base, reason: mark[1].trim() }); continue; }
      for (const part of literalParts(inner)) {
        for (const t of tokenizeNumbers(part)) {
          slots.push({ ...base, value: t.value, nums: t.nums, text: part.length > 160 ? `${part.slice(0, 160)}…` : part });
        }
      }
    }
  }

  if (!facts) {
    // 判据要求的"安静跳过"：没有事实表就没得比 —— 不是 0 命中，也不是错误（DIAGNOSIS §3）。
    // 但判据 ③ 的清单照样带回去（它只读源码）—— 报告里那几个任务的"算出来的值"照常打。
    return {
      name, skipped: true, reason: '没有 FACTS.md',
      slots: [], unmatched: [], matched: [], exempt: [], computed,
    };
  }

  const matched = [];
  const unmatched = [];
  for (const s of slots) {
    const hit = lookupFacts(facts, s);
    if (hit) matched.push({ ...s, at: `FACTS.md:${hit.n}`, atText: hit.t.trim().slice(0, 120) });
    else unmatched.push(s);
  }

  // 按值聚合：同一个数在几个地方出现只报一条（第一条位置 + 其余位置）
  const byValue = new Map();
  for (const s of unmatched) {
    const g = byValue.get(s.value) ?? { value: s.value, first: s, also: [] };
    if (g.first.file !== s.file || g.first.line !== s.line) g.also.push({ file: s.file, line: s.line, role: s.role });
    byValue.set(s.value, g);
  }

  return {
    name, skipped: false,
    facts: relOf(facts.path), factsLines: facts.lines.length,
    fileCount: files.length,
    slotCount: slots.length,
    computedCount: computed.length, computed,
    slots, unmatched: [...byValue.values()], matched, exempt, unclosed,
  };
}

/* ══════════════════════════════════════ 命令行 */

function parseArgs(argv) {
  const opts = { tasks: [], json: false, slots: false, explain: false, max: 12, help: false, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--slots') opts.slots = true;
    else if (a === '--explain') opts.explain = true;
    else if (a === '--dir') opts.dir = argv[++i];
    else if (a === '--max') {
      opts.max = Number(argv[++i]);
      if (!Number.isFinite(opts.max) || opts.max < 0) { console.error('--max 要一个非负整数'); process.exit(2); }
    } else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) { console.error(`未知选项：${a}（-h 看用法）`); process.exit(2); }
    else opts.tasks.push(a);
  }
  return opts;
}

const HELP = `lint-fabricated-numbers —— 检查"画面上的数字有没有出处"

  node tools/lint-fabricated-numbers.mjs                 扫 tasks/ 下所有有 FACTS.md 的任务
  node tools/lint-fabricated-numbers.mjs nekohome fidus  只扫指定任务
  node tools/lint-fabricated-numbers.mjs --slots         只列"数值显示位"（不比对事实表，用来复核判据）
  node tools/lint-fabricated-numbers.mjs --explain       连**找到出处**的数字一起报（附出处行号）
  node tools/lint-fabricated-numbers.mjs --json          机器可读（退出码恒 0）
  node tools/lint-fabricated-numbers.mjs --max 0         明细不限条数（默认每个任务 12 个值）
  node tools/lint-fabricated-numbers.mjs --dir <目录>    换一个任务根目录（自测夹具用，默认 tasks/）

自测（纯 JS，183 项）：node tools/test-fabricated-numbers.mjs
  夹具在 tools/fixtures/lint-numbers/tasks/（正例 / 反例 / 算出来的 / 混合 / 没有事实表 五个）——
  改那个目录里的数字会让测试当场红，那是有意的：判据一放宽就必须被看见。

判据 ①：只扫**数值显示位** —— 会真的画到帧上的字符串里的数字字面量：
  文字入口（type.write / writeLine / put / codeRow / caption / kicker / footer …）的文本、
  任务自己包装了一层再画的函数（_kit.js 里 body 出现文字入口的那些）的实参、
  镜头模板与配置档节点的参数（values / title / sub / footer / label / unit / caption）、
  旁白与字幕文本（task.config 的 narration 脚本、audio/narration.json），
  以及**流向**这些位置的变量与数组元素。
  **不算**：坐标 / 字号 / 时长 / 阈值 / 颜色分量 / 枚举字符串 / 注释（算出来的数见判据 ③）。
判据 ②：这个数字串在 tasks/<任务>/FACTS.md 的正文里出现过（按数字边界比对，先严后宽）= 有出处。
判据 ③：**算出来的显示位** —— 模板串插值（\`\${…}\`）/ 字符串 + 拼接 / 包了 String() / .padStart() /
  .toFixed() 的表达式 / values 里的变量与表达式。它们**静态查不到等于几**，所以单独列一段：
  「算出来的值：N 处 —— 这些位置静态查不到等于几，这一项**没验**」（0 处也打一行；不改退出码）。
  --json 里读 tasks[].computed（没有事实表的任务在 skippedComputed 里）。
豁免：同一个语句里写 \`// numbers-ok: 理由\`（理由必填，报告里会打出来）。
退出码：有找不到出处的数字 → 1；干净 → 0；用法/任务名写错 → 2（--json 恒 0）。判据 ③ 不进退出码。
没有 FACTS.md 的任务**安静跳过**（打印「没有事实表 ⇒ 这一项没验」），不计入命中 —— 空 ≠ 干净；
判据 ③ 不看事实表，所以那几个任务也照样扫（那一段的计数照常输出）。`;

const opts = parseArgs(process.argv.slice(2));
if (opts.help) { console.log(HELP); process.exit(0); }

/** 任务根目录：默认 `tasks/`；`--dir` 用来跑自测夹具（不进仓库的那套） */
const TASKS = opts.dir ? path.resolve(ROOT, opts.dir) : TASKS_DIR;
if (!existsSync(TASKS)) { console.error(`❌ 没有这个目录：${TASKS}`); process.exit(2); }

const allTasks = readdirSync(TASKS)
  .filter((f) => { try { return statSync(path.join(TASKS, f)).isDirectory(); } catch { return false; } })
  .sort();
let names = opts.tasks;
if (names.length) {
  const bad = names.filter((n) => !allTasks.includes(n));
  if (bad.length) {
    // 任务名写错就报错退出：回归清单里"名字打错 → 静默 0 命中"是最坏的失败方式
    console.error(`❌ 没有这些任务：${bad.join(' ')}\n   现有任务：${allTasks.join(' ')}`);
    process.exit(2);
  }
} else names = allTasks;

const results = names.map((n) => lintTask(n, TASKS));
const scanned = results.filter((r) => !r.skipped);
const skipped = results.filter((r) => r.skipped);
const totalSlots = scanned.reduce((a, r) => a + r.slotCount, 0);
const totalUnmatched = scanned.reduce((a, r) => a + r.unmatched.length, 0);
const totalExempt = scanned.reduce((a, r) => a + r.exempt.length, 0);
// 判据 ③ 的合计要**连没有事实表的任务一起算** —— 它只读源码，那几个任务也扫了（见文件头「空 ≠ 干净」）
const totalComputed = results.reduce((a, r) => a + r.computed.length, 0);
const show = (arr) => (opts.max === 0 ? arr : arr.slice(0, opts.max));

/** --json 里 computed 那一项的载荷（人看的报告与机器读的 JSON 用同一个形状） */
const computedJson = (r) => show(r.computed).map((c) => ({ at: `${c.file}:${c.line}`, kind: c.kind, role: c.role, snippet: c.snippet, code: c.code }));

/**
 * 判据 ③ 的那一段（每个任务都打 —— **0 处也要打**：
 * 否则「没扫到」和「这段没执行」在输出里长得一样，见 `docs/DIAGNOSIS.md` §3「空 ≠ 干净」）。
 * 位置 / 成因标签 / 那一行原文沿用判据 ①② 的排版，条数沿用 `--max`。
 */
function computedLines(r, o = {}) {
  const ind = o.indent ?? '   ';
  const tag = o.prefix ? `${r.name}  ` : '';
  const n = r.computed.length;
  const out = [n
    ? `${ind}${tag}算出来的值：${n} 处 —— 这些位置静态查不到等于几，这一项**没验**（判据 ③）`
    : `${ind}${tag}算出来的值：0 处 —— 这一段扫过了；这一类静态查不到等于几，真出现时会被列在这里 ⇒ **这一项没验**（判据 ③）`];
  for (const c of show(r.computed)) {
    out.push(`${ind}   ${c.file}:${c.line}  〔${c.kind} · ${c.role}〕${c.snippet ? `「${c.snippet}」` : ''}`);
    out.push(`${ind}     源码：${c.code}`);
  }
  if (opts.max && n > opts.max) out.push(`${ind}   …… 另有 ${n - opts.max} 处（--max 0 看全部）`);
  return out;
}

/* ── 机器可读 ── */
if (opts.json) {
  console.log(JSON.stringify({
    tool: 'lint-fabricated-numbers',
    criteria: '只扫"数值显示位"里的数字字面量；数字串在 tasks/<任务>/FACTS.md 正文里出现过 = 有出处。' +
      '判据 ③ 的「算出来的显示位」（模板串插值 / 字符串拼接 / String() / .padStart() / .toFixed() / values 里的变量）' +
      '单独列在 computed 里 —— 它们静态查不到等于几，这一项**没验**，不进 summary.unmatched、不影响退出码',
    summary: {
      tasks: scanned.length, skipped: skipped.length,
      slots: totalSlots, unmatched: totalUnmatched, exempt: totalExempt,
      computed: totalComputed,
    },
    tasks: scanned.map((r) => ({
      name: r.name, facts: r.facts, slotCount: r.slotCount,
      computedCount: r.computed.length, computed: computedJson(r),
      unmatched: show(r.unmatched).map((u) => ({
        value: u.value,
        at: `${u.first.file}:${u.first.line}`, role: u.first.role, code: u.first.code,
        also: u.also,
      })),
      matched: opts.explain
        ? r.matched.map((m) => ({ value: m.value, at: `${m.file}:${m.line}`, source: m.at, sourceText: m.atText }))
        : undefined,
      slots: opts.slots ? r.slots.map((s) => ({ value: s.value, at: `${s.file}:${s.line}`, role: s.role })) : undefined,
      exempt: r.exempt, unclosed: r.unclosed,
    })),
    skipped: skipped.map((r) => ({ name: r.name, reason: r.reason })),
    // 没有事实表的任务：字面量那一项安静跳过，但判据 ③ 照样扫了（它只读源码）
    skippedComputed: skipped.map((r) => ({ name: r.name, computedCount: r.computed.length, computed: computedJson(r) })),
  }, null, 2));
  process.exit(0);   // --json 恒 0：让调用方自己读 summary.unmatched 决定怎么办
}

/* ── 人看的 ── */
console.log('lint-fabricated-numbers —— 画面上的数字必须有出处');
console.log('判据：只扫「数值显示位」（文字入口的文本 / 镜头模板参数 / 旁白字幕，含流向这些位置的变量与数组元素）');
console.log('      里的数字字面量；数字串在 tasks/<任务>/FACTS.md 正文里出现过 = 有出处。');
console.log('      坐标 / 字号 / 时长 / 阈值 / 颜色分量 / 枚举字符串 / 注释**不算**（算出来的数见下一行）。');
console.log('判据 ③：**算出来的显示位**（模板串插值 / 字符串拼接 / String() / .padStart() / .toFixed() / values 里的变量）');
console.log('      单独列一段「算出来的值：N 处 —— 这些位置静态查不到等于几，这一项**没验**」；0 处也打一行，不改退出码。');
console.log(`扫 ${scanned.length} 个有事实表的任务${skipped.length ? `，安静跳过 ${skipped.length} 个（没有 FACTS.md）` : ''}\n`);

for (const r of scanned) {
  const mark = r.unmatched.length ? '❌' : '✅';
  console.log(`${mark} ${r.name} —— 显示位 ${r.slotCount} 个数字，${r.unmatched.length} 个值找不到出处（${r.facts}，${r.factsLines} 行，扫了 ${r.fileCount} 个文件）`);
  if (!r.slotCount) {
    console.log('   （这个任务一个数值显示位都没有 —— 是「真的没有」，还是判据没覆盖到它的写法？用 --slots 复核）');
  }
  // 判据 ③：**0 处也打**（否则「没扫到」和「这段没执行」分不开）—— 排在明细前面，免得被后面的命中淹掉
  for (const l of computedLines(r)) console.log(l);
  for (const u of show(r.unmatched)) {
    console.log(`   ${u.first.file}:${u.first.line}  〔${u.first.role}〕`);
    console.log(`     原样：「${u.first.value}」`);
    console.log(`     源码：${u.first.code}`);
    for (const a of u.also.slice(0, 3)) console.log(`     同值还出现在：${a.file}:${a.line}〔${a.role}〕`);
    if (u.also.length > 3) console.log(`     …… 同值另有 ${u.also.length - 3} 处`);
  }
  if (opts.max && r.unmatched.length > opts.max) console.log(`   …… 另有 ${r.unmatched.length - opts.max} 个值（--max 0 看全部）`);
  if (r.exempt.length) {
    console.log(`   ${r.exempt.length} 处写了 numbers-ok 豁免：`);
    for (const e of show(r.exempt)) console.log(`     ${e.file}:${e.line} 「${e.value}」 —— ${e.reason}`);
  }
  if (opts.explain && r.matched.length) {
    console.log(`   ── 找到出处的 ${r.matched.length} 个（--explain）：`);
    for (const m of show(r.matched)) console.log(`   ${m.file}:${m.line} 「${m.value}」 → ${m.at}  ${m.atText}`);
  }
  if (opts.slots) {
    console.log(`   ── 全部显示位（--slots）：`);
    for (const s of r.slots) console.log(`   ${s.file}:${s.line} 「${s.value}」 〔${s.role}〕 ${s.code}`);
  }
  for (const f of r.unclosed) console.log(`   ⚠ ${f} 扫描到文件尾仍未闭合（源码里可能有含引号的正则）—— 这个文件的判据可能不准`);
  console.log('');
}

if (skipped.length) {
  // 「空 ≠ 干净」：这一行必须明确说"没验"，别让收尾的 0 命中被读成通过
  console.log(`· ${skipped.length} 个任务没有事实表 ⇒ 这一项没验（不是通过）：${skipped.map((r) => r.name).join(' ')}`);
  console.log('  （写一份 tasks/<任务>/FACTS.md 它们才进判据 —— 模板见 docs/FACTS-TEMPLATE.md）');
  // 判据 ③ 只读源码、不看事实表 ⇒ 这几个任务照样扫了 —— 那一段的计数**照常输出**（0 处也打）。
  // 否则这几个任务的「算出来的值」会连「没验」都没人看见（文件头「空 ≠ 干净」）。
  console.log('  这几个任务的「算出来的值」（判据 ③ 不需要事实表，所以照样扫了）：');
  for (const r of skipped) for (const l of computedLines(r, { indent: '    ', prefix: true })) console.log(l);
  console.log('');
}

console.log('─'.repeat(72));
console.log(`合计：${scanned.length} 个任务 / ${totalSlots} 个显示位数字，${totalUnmatched} 个值找不到出处` +
  `${totalExempt ? `，${totalExempt} 处显式豁免` : ''}` +
  `${results.length ? `，${totalComputed} 处算出来的值**没验**（判据 ③：静态查不到等于几）` : ''}` +
  `；另有 ${skipped.length} 个任务**没验**（没有 FACTS.md）`);
for (const r of scanned) console.log(`· ${r.name} ${r.unmatched.length}/${r.slotCount}${r.computed.length ? `（另有 ${r.computed.length} 处算出来的值没验）` : ''}`);
for (const r of skipped) console.log(`· ${r.name} 0/0 —— 没有事实表：字面量那一项没验（判据 ③ 扫过：${r.computed.length} 处算出来的值）`);
console.log('修法二选一：① 去 FACTS.md 补上这个数的出处（逐字原文）；② 这个数还没定就写成占位符 —— figure —。');
console.log('       片子自己的编号（WORKS 04 / v0.1.2）与示意读数同样要登记 —— 找不到就说明事实表漏了。');
console.log('算出来的值（判据 ③）：在 FACTS.md 里登记它的**口径**（这个数是怎么来的），或者渲染成占位符 —— figure —。');
console.log('纪律原文：AGENTS.md §10.10 / docs/FACTS-TEMPLATE.md；背景：docs/BACKLOG.md 1-22。');

process.exit(totalUnmatched ? 1 : 0);
