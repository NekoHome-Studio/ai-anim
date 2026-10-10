# lint-numbers 自测夹具

这三个任务**不是片子**，是 `tools/test-fabricated-numbers.mjs` 的输入（用 `--dir` 指向这里）：

| 目录 | 是什么 | 期望 |
|---|---|---|
| `zz-fake-positive/` | 画面文案里有一个编造的 `3762`，事实表里没有 | ❌ 点名 `scenes/fake.js:24`，退出码 1 |
| `zz-fake-negative/` | 满屏坐标 / 字号 / 时长 / 阈值 / 颜色 / 注释 / 算出来的数，**画面文字一个数字都没有** | ✅ 显示位 0 个数字，退出码 0 |
| `zz-no-facts/` | 没有 `FACTS.md` | · 安静跳过，打印「没有事实表 ⇒ 这一项没验」，**不改变退出码** |

跑法（都是纯 JS，不需要 GPU / 浏览器 / Vite）：

```sh
node tools/test-fabricated-numbers.mjs
node tools/lint-fabricated-numbers.mjs --dir tools/fixtures/lint-numbers/tasks
node tools/lint-fabricated-numbers.mjs --dir tools/fixtures/lint-numbers/tasks --slots   # 看判据收了哪些位置
```

⚠ **别把它们放进 `tasks/`**：那会污染 `anim tasks` 的任务列表，也会进全量扫描。
⚠ **别改这几个文件里的数字**：`test-fabricated-numbers.mjs` 里钉着它们的**预期条数**
（正例 1 个值、反例 0 个显示位）—— 改了就会红，那正是设计意图
（谁放宽了判据，必须当场看见，而不是悄悄多报或少报）。
