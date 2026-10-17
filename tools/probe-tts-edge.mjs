// @ts-check
/**
 * 真 TTS 通电测试：`tools/tts-edge.py`（edge-tts 库 + **词级时间戳**）这条真路能不能走通。
 *
 *   node tools/probe-tts-edge.mjs
 *
 * 为什么单独一个探针（`tools/test-say.mjs` 已经有离线回归了）：
 * 离线那套用的是 `tools/stub-tts.mjs`，它证明的是"时间表解得对不对"；
 * **"真的能调通 edge-tts、而且拿到的词级时间戳是真的"** 只能靠联网跑一次来证明。
 * 另外它顺带把 C 档的前提验了：`edge-tts` 7.x 命令行的 `--write-subtitles` 给的是**整句**
 * （默认 `SentenceBoundary`）—— 这一点当年让人以为"词级时间戳本来就有"，
 * 所以这里用 `tools/tts-edge.py`（`boundary="WordBoundary"`）绕过去。
 *
 * 需要：本机装了 `edge-tts`（python 包）+ 能联网。没有就明确报"跳过"，不要假装通过。
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSay, resolveTts } from '../scripts/lib/say.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(os.tmpdir(), 'anim-tts-probe');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (ok) pass++; else fail++;
};

/* ── 驱动解析：能不能找到一条真 TTS 路 ── */
let driver;
try {
  driver = resolveTts({ explicit: process.env.ANIM_TTS, script: null });
} catch (e) {
  console.log(`⏭  跳过：${e.message.split('\n')[0]}`);
  process.exit(2);
}
console.log(`驱动：${driver.argv.join(' ')}（${driver.from}）\n`);

rmSync(DIR, { recursive: true, force: true });
mkdirSync(path.join(DIR, 'audio'), { recursive: true });

// 一句里要有标点和多音节词：这样"词级时间戳"才有东西可验（edge-tts 按词/字边界给）
const TEXTS = ['先看一句话。', '这串「嗷呜啊」，叫「兽语」。'];
writeFileSync(path.join(DIR, 'narration.mjs'), `// 探针夹具（tools/probe-tts-edge.mjs 生成）
export const VOICE = 'zh-CN-YunxiNeural';
export const RATE = '+0%';
export const TAIL = 1.0;
export const BPM = 120;
export const SCENES = [
  { id: 'probe', internal: 4.0, lines: [
${TEXTS.map((t, i) => `    { cue: ${(0.4 + i * 2.4).toFixed(2)}, text: ${JSON.stringify(t)} },`).join('\n')}
  ] },
];
`);
writeFileSync(path.join(DIR, 'task.config.mjs'), `export default { title: 'tts probe', width: 640, height: 360, fps: 30, timeline: [] };\n`);

/* ── 真跑一遍 ── */
console.log('· 调真 TTS（联网；第一次会慢一点）…');
let res;
try {
  res = await runSay('_ttsprobe', { taskDir: DIR, tts: driver.argv.join(' '), log: (s) => console.log(`  │ ${s}`) });
} catch (e) {
  console.log(`\n✗ 真 TTS 失败（联网？edge-tts 还在吗？）：${e.message.split('\n').slice(0, 3).join('\n')}`);
  process.exit(2);
}
/**
 * ⚠ **TTS 服务端挂了 ≠ 这个探针失败了**（2026-10-16 实测）：edge-tts 全线返回
 * `WSServerHandshakeError: 403 Invalid response status` 时，`runSay()` **不会抛** ——
 * 它按"失败也继续、最后统一补跑"的设计走完，然后把 `timing` 留成 `null`（**失败的句子绝不按 0 时长
 * 混进时长表**，否则 slot 会静默算错）。第一版这里直接读 `res.timing.scenes[0]` ⇒
 * 在整个回归套件里崩成 `TypeError: Cannot read properties of null`、**退出码 1**，
 * 而这一项的契约写的是"连不上会「跳过」退出码 2"。
 * 现在：没拿到表就明说"跳过"，一行原因（取第一句的失败原因）＋ 不算通过。
 */
if (!res?.timing?.scenes?.[0]?.lines?.length) {
  const why = (res?.failed ?? [])[0];
  console.log('\n⏭  跳过：TTS 这一次**一句都没合成出来**（不算通过）。');
  if (why) console.log('   第一句的失败原因：' + String(why.reason ?? why.message ?? why).split('\n')[0].slice(0, 200));
  console.log('   → 常见原因是服务端（edge-tts 的 403 / 无网络）；换 ANIM_TTS 指定别的驱动，或等一会儿重跑。');
  process.exit(2);
}
const lines = res.timing.scenes[0].lines;

console.log('\n① 合成与量长');
check('两句都合成出来了', lines.length === 2, `${lines.length} 句`);
check('时长都是正数', lines.every((l) => l.dur > 0), lines.map((l) => `${l.dur.toFixed(2)}s`).join(' / '));

console.log('\n② 词级时间戳是**真的**（不是按字数近似）');
const allWords = lines.map((l) => l.words ?? []);
check('每句都有词级时间戳', allWords.every((w) => w.length > 0), allWords.map((w) => `${w.length} 段`).join(' / '));
check('没有一段被标成 approx（说明是驱动给的真时间戳）',
  allWords.every((ws) => ws.every((w) => !w.approx)),
  allWords.flat().some((w) => w.approx) ? '有 approx 标记 ✗' : '无 approx ✓');
check('词拼起来等于原句',
  lines.every((l, i) => (l.words ?? []).map((w) => w.w).join('') === TEXTS[i]),
  lines.map((l) => `"${(l.words ?? []).map((w) => w.w).join('')}"`).join(' / '));
check('时间戳单调不减、且落在这一句的时长内',
  lines.every((l) => {
    const ws = l.words ?? [];
    for (let i = 1; i < ws.length; i++) if (ws[i].start < ws[i - 1].start - 1e-6) return false;
    // timing.json 里是**整片绝对时间**，所以要减掉这句的起点再和时长比
    const start = ws[0].start;
    return ws.at(-1).end - start <= l.dur + 0.25;
  }));

console.log('\n③ 时间戳的粒度：真的有"词"边界，而不是整句一条');
const multi = allWords.filter((ws) => ws.length > 1).length;
check('至少一句被切成了多个词', multi > 0, `多词句 ${multi}/${lines.length}`);
const shortest = Math.min(...allWords.flat().map((w) => w.end - w.start));
check('存在明显短于整句的时间片段（真的是词级）', shortest < lines[0].dur * 0.8,
  `最短片段 ${shortest.toFixed(3)}s vs 句长 ${lines[0].dur.toFixed(2)}s`);

console.log('\n④ 产物');
check('写出来了 narration.json（含 words）', res.narration.lines.every((l) => (l.words ?? []).length > 0));

console.log('\n前 8 个词（人眼核一下时间是不是递增的）：');
for (const w of allWords[0].slice(0, 8)) {
  console.log(`  ${w.start.toFixed(3)}–${w.end.toFixed(3)}s  ${w.w}`);
}

console.log(`\n${'─'.repeat(60)}\n通过 ${pass}/${pass + fail}${fail ? `　❌ 失败 ${fail}` : '　✅ 全部通过'}`);
console.log(`夹具在 ${DIR}`);
process.exit(fail ? 1 : 0);
