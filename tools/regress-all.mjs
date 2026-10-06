// @ts-check
/**
 * 一次跑完 `docs/STATUS.md` §11.15 的回归清单（第三轮那批 ⏸ 项 + 旧回归）。
 *
 *   node tools/regress-all.mjs                  # 全部
 *   node tools/regress-all.mjs --only smoke     # 只跑名字里含 "smoke" 的
 *   node tools/regress-all.mjs --list           # 只列清单
 *   node tools/regress-all.mjs --keep-going     # 出错也继续（默认就是继续，留着给以后改行为）
 *
 * 为什么要有这个脚本：
 *   上一轮（第三轮）在跑最后一批回归时被叫停，清单里留了一堆 ⏸。手工一条条敲不仅慢，
 *   而且**没人记得住哪些跑过**（STATUS.md 里就是这样积下来的）。这里把清单写死在代码里，
 *   每条一份日志（`out/_regress/<名字>.log`）+ 一张汇总表，跑完一眼看谁红了。
 *
 * ⚠ 两件必须知道的事：
 *   1. **同一时刻只允许一条渲染车道**。`smoke-overexposure` 会临时改 `src/core/engine.js`、
 *      `smoke-background` 会临时改 `tasks/_calib/`、`smoke-worktree-edit` 会临时改 `demo` 的场景文件。
 *      这些东西并行跑会互相污染，所以这里是**严格串行**的，而且跑的时候别去编辑 src/ 或 tasks/。
 *   2. 清单里若有**本来就该失败**的条目，用 `expectFail` 标出来：它红了不算这次回归的锅，
 *      但要打印出来给人看。**目前一条都没有** —— 曾经挂在 `check beast` 上的"退出码 1"
 *      从第四轮起没能复现，2026-10-06 整份 33/33 全绿（beast 是干净的 PASS），这条注记已撤掉。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOGDIR = path.join(ROOT, 'out', '_regress');
const node = process.execPath;
const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

/**
 * @typedef {Object} Item
 * @property {string} name
 * @property {string[]} cmd argv（第一项会被换成本机 node 可执行文件）
 * @property {Record<string,string>} [env]
 * @property {string} [note]
 * @property {boolean} [expectFail] 已知会失败（红 ≠ 回归），但仍然要打印
 * @property {number} [timeout] 毫秒
 */

/** @type {Item[]} */
const ITEMS = [
  // ── 纯 JS 单测（不需要 GPU、几秒钟）──
  { name: 'unit:timeline-guard', cmd: ['tools/test-timeline-guard.mjs'], note: 'P0-2 伪时间线必须抛错 + 配置档展开（40 项）' },
  { name: 'unit:easing-warn', cmd: ['tools/test-easing-warn.mjs'], note: 'P2-3 缓动名写错要警告（7 项）' },
  { name: 'unit:narration', cmd: ['tools/test-narration.mjs'], note: 'P1-5 旁白表 + C 档词级时间戳（44 项）' },
  { name: 'unit:karaoke', cmd: ['tools/test-karaoke.mjs'], note: 'C 档 karaoke 的秒/下标混用 bug（80 项）' },
  { name: 'unit:xform-math', cmd: ['tools/test-xform-math.mjs'], note: '场景级变换数学（旧回归）' },
  { name: 'unit:cam-math', cmd: ['tools/test-cam-math.mjs'], note: '3D 相机/投影/透视变换 + **手性**（33 项）' },
  { name: 'unit:segment-cuts', cmd: ['tools/test-segment-cuts.mjs'], note: 'P2-4 分块切点只落在安全处' },
  { name: 'unit:shots', cmd: ['tools/test-shots.mjs'], note: 'A 档镜头库：模板登记/参数名/任务段名（写错就响）' },

  // ── Node 侧整条链（合成/摆位/闪避；不需要 GPU，但要 ffmpeg）──
  { name: 'say:offline', cmd: ['tools/test-say.mjs'], note: 'B 档 anim say + anim mix 全链路（stub 驱动，30 项）', timeout: 10 * 60e3 },
  { name: 'say:real-tts', cmd: ['tools/probe-tts-edge.mjs'], note: 'B/C 档真 TTS（联网；连不上会「跳过」退出码 2）', timeout: 10 * 60e3 },

  // ── 注入式回归（会临时改文件；必须串行）──
  { name: 'smoke:scene-error', cmd: ['tools/smoke-scene-error.mjs'], note: 'P0-3 场景抛错 = 硬失败（10 项）', timeout: 20 * 60e3 },
  { name: 'smoke:background', cmd: ['tools/smoke-background.mjs'], note: 'P0-2 漏画背景必须被点名', timeout: 20 * 60e3 },
  { name: 'smoke:overexposure', cmd: ['tools/smoke-overexposure.mjs'], note: 'P0-3 多子帧过曝必须被拦住', timeout: 20 * 60e3 },
  { name: 'smoke:worktree-edit', cmd: ['tools/smoke-worktree-edit.mjs'], note: 'P2-2 渲染期间改源文件要点名', timeout: 20 * 60e3 },
  { name: 'smoke:interrupt', cmd: ['tools/smoke-interrupt.mjs'], note: 'P0-2 中断必须非零退出 + 删产物', timeout: 20 * 60e3 },
  {
    name: 'smoke:backpressure',
    cmd: ['tools/smoke-backpressure.mjs', 'demo', '0.5', '30', '12'],
    env: { ANIM_FFMPEG: `"${node}" tools/slow-ffmpeg.mjs`, ANIM_SLOW_MBPS: '12' },
    note: 'P0-1 背压不能被判成停滞',
    timeout: 20 * 60e3,
  },

  // ── 逐任务 check（2026-10-06 整份回归 33/33 全绿，含下面每一条）──
  { name: 'check:beast', cmd: ['scripts/anim.mjs', 'check', 'beast', '--quick'], note: '12 段 / 127.5s', timeout: 30 * 60e3 },
  { name: 'check:demo', cmd: ['scripts/anim.mjs', 'check', 'demo', '--quick'], note: '5 段', timeout: 30 * 60e3 },
  { name: 'check:beat', cmd: ['scripts/anim.mjs', 'check', 'beat', '--quick'], note: '3 段', timeout: 30 * 60e3 },
  { name: 'check:_calib', cmd: ['scripts/anim.mjs', 'check', '_calib', '--quick'], note: '标定夹具', timeout: 30 * 60e3 },
  { name: 'check:nekohome', cmd: ['scripts/anim.mjs', 'check', 'nekohome', '--quick'], note: '8 段', timeout: 30 * 60e3 },
  { name: 'check:fidus', cmd: ['scripts/anim.mjs', 'check', 'fidus', '--quick'], note: '9 段', timeout: 30 * 60e3 },
  { name: 'check:pdoom-lab', cmd: ['scripts/anim.mjs', 'check', 'pdoom-lab'], note: '3D 验证片：raymarch 走廊 + 非有限值扫描', timeout: 30 * 60e3 },
  { name: 'check:example-config-only', cmd: ['scripts/anim.mjs', 'check', 'example-config-only', '--quick'], note: 'B 档：整个任务只有 task.config.mjs（配置档）', timeout: 30 * 60e3 },
  { name: 'check:_three-calib', cmd: ['scripts/anim.mjs', 'check', '_three-calib', '--quick'], note: '第 3 种 3D 的标定夹具（桥的颜色/朝向/透明合成）', timeout: 30 * 60e3 },
  // Three.js 沙盒：3 段（Two Three.js 镜头 + 中间那一段**完全由引擎画**的过渡镜头），
  // 走完整的三点两路径 —— 它同时是"背景守门 + 多子帧"这两件事在桥上的现场证据。
  { name: 'check:_three-lab', cmd: ['scripts/anim.mjs', 'check', '_three-lab'], note: '第 3 种 3D 沙盒：3 段（含引擎自绘过渡），完整三点两路径', timeout: 30 * 60e3 },
  // promo 是引擎自己的一镜到底宣传片，也是**唯一**跨 4 段连续世界（走廊 → 门 → SDF 大厅 → 晶格隧道）的片子，
  // 所以这里不省：跑完整的 3 点 × 2 条路径（36 帧，实测 18.3s）。
  { name: 'check:promo', cmd: ['scripts/anim.mjs', 'check', 'promo'], note: '48s 一镜到底 / 6 段；raymarch 大厅 + 晶格隧道，完整三点两路径', timeout: 30 * 60e3 },

  // ── 引擎级探针 ──
  { name: 'probe:alpha', cmd: ['scripts/anim.mjs', 'probe-alpha', '_calib'], note: 'P0-1 数值型 alpha + P1-5 旁白接线（9 项）', timeout: 20 * 60e3 },
  { name: 'probe:ribbon', cmd: ['tools/probe-ribbon.mjs', '11.2', '1,2'], note: '真 4K 矢量几何一致', timeout: 20 * 60e3 },
  { name: 'probe:raymarch', cmd: ['tools/probe-raymarch.mjs'], note: 'raymarch 通电 + 手性/朝向 + 非有限值判据（14 项）', timeout: 20 * 60e3 },
  { name: 'probe:three', cmd: ['tools/probe-three.mjs'], note: '第 3 种 3D 的桥：朝向 / 两条颜色管线一致 / 线性 alpha（10 项）', timeout: 20 * 60e3 },
  { name: 'probe:nv12', cmd: ['tools/probe-nv12.mjs', '_calib'], note: '出片推流的新编码路径：GPU 的 NV12 vs CPU 参考实现（判据 ±1）', timeout: 20 * 60e3 },
  { name: 'probe:fonts', cmd: ['tools/probe-fonts.mjs', '_calib'], note: '任务字体真的生效', timeout: 20 * 60e3 },
  { name: 'probe:colorspace', cmd: ['tools/probe-colorspace.mjs', '_calib'], note: '导出 = 显示', timeout: 20 * 60e3 },
  { name: 'probe:trans2', cmd: ['tools/probe-trans2.mjs', '_calib'], note: '转场：推走而不是糊在一起（第四轮重写了判据）', timeout: 20 * 60e3 },
  { name: 'probe:determinism', cmd: ['tools/probe-determinism.mjs', 'beat', '1', '2'], note: 'P1-2 更正：帧起点口径逐字节相同', timeout: 30 * 60e3 },
  { name: 'test:parallel', cmd: ['tools/test-parallel.mjs', 'demo', '6'], note: 'P2-1 并行渲染 6 项', timeout: 40 * 60e3 },
  // 抖动守门：`docs/IMPROVEMENTS-3.md` 那次事故（用户"最后像地震"）的回归项。
  // 整片要跑 2880 帧、raymarch 段 170ms/帧（几分钟），所以只体检收尾 8 秒 —— 事故就出在那里
  // （摄影机停住了、幅度却只升不降）。判据与 `video` 收尾的守门共用 scripts/lib/shake.mjs。
  { name: 'shake:promo', cmd: ['scripts/anim.mjs', 'shake', 'promo', '--from', '40', '--to', '48'], note: '抖动：收尾段必须是平滑手持而不是逐帧白噪声（480 帧，约 35s）', timeout: 20 * 60e3 },

  // ── 画面没变（重构验收）──
  { name: 'hashes:fidus', cmd: ['scripts/anim.mjs', 'hashes', 'fidus', '--baseline'], note: 'kit 重构后画面是否没变（基线已重存）', timeout: 30 * 60e3 },
  // promo 的基线是**每段一帧**（t=3/11/21/31/39/45，6 段各一帧，63.3 MB）：
  // 原来 `--save` 的默认四点（0/12/24/36）**漏掉了晶格隧道与落版两段**，改了引擎也照绿。
  { name: 'hashes:promo', cmd: ['scripts/anim.mjs', 'hashes', 'promo', '--baseline'], note: '一镜到底整片：6 段各一帧逐像素比对（判据 max≤8 且 >16 为 0）', timeout: 30 * 60e3 },
];

function runItem(it) {
  const log = path.join(LOGDIR, `${it.name.replace(/[:]/g, '_')}.log`);
  const t0 = Date.now();
  const r = spawnSync(node, it.cmd.map((a) => (a === process.execPath ? node : a)), {
    cwd: ROOT,
    env: { ...process.env, ...(it.env ?? {}) },
    encoding: 'utf8',
    timeout: it.timeout ?? 15 * 60e3,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - t0;
  const body = `$ node ${it.cmd.join(' ')}\n\n--- stdout ---\n${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n`;
  writeFileSync(log, body);
  const code = r.status;
  const pass = code === 0;
  return { ...it, code, pass, ms, log: path.relative(ROOT, log), out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 从输出里挑一行最像"结论/错误"的，汇总表里显示。 */
function headline(res) {
  const lines = res.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const bad = lines.filter((l) => /^[✗×]|FAIL|错误|失败|Error|error:|on problem|个问题/.test(l));
  const pick = bad[bad.length - 1] ?? lines[lines.length - 1] ?? '(无输出)';
  return pick.length > 120 ? `${pick.slice(0, 117)}…` : pick;
}

if (process.argv.includes('--list')) {
  for (const it of ITEMS) console.log(`${it.name.padEnd(24)} ${it.note ?? ''}`);
  process.exit(0);
}

const list = only ? ITEMS.filter((it) => it.name.includes(only)) : ITEMS;
if (!list.length) {
  console.error(`✗ --only ${only} 没匹配到任何项。用 --list 看清单。`);
  process.exit(2);
}
mkdirSync(LOGDIR, { recursive: true });

console.log(`跑 ${list.length} 项回归（串行；日志在 out/_regress/）\n`);
const results = [];
for (const it of list) {
  process.stdout.write(`· ${it.name.padEnd(24)} 跑 … `);
  const res = runItem(it);
  results.push(res);
  const tag = res.pass ? 'PASS' : (it.expectFail ? 'FAIL(已知)' : 'FAIL');
  console.log(`${tag}  ${(res.ms / 1000).toFixed(1)}s`);
  if (!res.pass) console.log(`    ${headline(res)}`);
}

const failed = results.filter((r) => !r.pass && !r.expectFail);
const known = results.filter((r) => !r.pass && r.expectFail);
console.log(`\n${'─'.repeat(72)}`);
console.log(`通过 ${results.filter((r) => r.pass).length}/${results.length}`
  + (known.length ? `　已知失败 ${known.length}（${known.map((k) => k.name).join(', ')}）` : '')
  + (failed.length ? `　❌ 真失败 ${failed.length}` : '　✅ 没有真失败'));
for (const f of failed) console.log(`  ❌ ${f.name}  (exit ${f.code})  → ${f.log}\n     ${headline(f)}`);

const summary = {
  at: new Date().toISOString(),
  results: results.map((r) => ({ name: r.name, code: r.code, pass: r.pass, expectFail: !!r.expectFail, ms: r.ms, log: r.log, headline: headline(r) })),
};
writeFileSync(path.join(LOGDIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
writeFileSync(
  path.join(LOGDIR, 'summary.md'),
  `# 回归汇总 ${summary.at}\n\n| 项 | 结果 | 用时 | 结论 |\n|---|---|---|---|\n`
  + results.map((r) => `| ${r.name} | ${r.pass ? '✅' : (r.expectFail ? '🟡 已知失败' : '❌')} | ${(r.ms / 1000).toFixed(1)}s | ${headline(r).replace(/\|/g, '\\|')} |`).join('\n')
  + '\n',
);
console.log(`\n汇总：out/_regress/summary.md`);
process.exit(failed.length ? 1 : 0);
