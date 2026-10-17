# lint-numbers 自测夹具

这几个任务**不是片子**，是 `tools/test-fabricated-numbers.mjs` 的输入（用 `--dir` 指向这里）：

| 目录 | 是什么 | 期望 |
|---|---|---|
| `zz-fake-positive/` | 画面文案里有一个编造的 `3762`，事实表里没有 | ❌ 点名 `scenes/fake.js:26`，退出码 1 |
| `zz-fake-negative/` | 满屏坐标 / 字号 / 时长 / 阈值 / 颜色 / 注释，**画面文字一个数字都没有**（另有 3 处算出来的值） | ✅ 显示位 0 个数字、算出来的 3 处，退出码 0 |
| `zz-fake-computed/` | **算出来的显示位**（判据 ③）：模板串插值 / 拼接 / `String()` / `.padStart()` / `.toFixed()` / `values` 里的变量 | ✅ 显示位 2 个数字（都登记了）、**算出来的 9 处**，退出码 0 |
| `zz-fake-mixed/` | 既有「有出处的数」也有「编造的数」 | ❌ 3 个找不到出处，退出码 1 |
| `zz-no-facts/` | 没有 `FACTS.md` | · 安静跳过（打印「没有事实表 ⇒ 这一项没验」），**不改变退出码**；判据 ③ 那一段照常输出 |

跑法（都是纯 JS，不需要 GPU / 浏览器 / Vite）：

```sh
node tools/test-fabricated-numbers.mjs
node tools/lint-fabricated-numbers.mjs --dir tools/fixtures/lint-numbers/tasks
node tools/lint-fabricated-numbers.mjs --dir tools/fixtures/lint-numbers/tasks --slots   # 看判据收了哪些位置
```

⚠ **别把它们放进 `tasks/`**：那会污染 `anim tasks` 的任务列表，也会进全量扫描。
⚠ **别改这几个文件里的数字**：`test-fabricated-numbers.mjs` 里钉着它们的**预期条数**
（正例 1 个值、反例 0 个显示位、算出来的夹具 9 处 / 反例 3 处）—— 改了就会红，那正是设计意图
（谁放宽了判据，必须当场看见，而不是悄悄多报或少报）。

## 判据 ③（算出来的显示位）在这几个夹具里的分布

`tools/lint-fabricated-numbers.mjs` 的判据 ③ 认的是**静态查不到等于几**的显示位
（模板串插值 / 字符串 `+` 拼接 / `String()` / `.padStart()` / `.toFixed()` / `values` 里的变量），
它们**不进退出码**，但必须在报告里逐条列出来并明说「这一项没验」。

| 夹具 | 判据 ③ 的条数 | 覆盖的形态 |
|---|---|---|
| `zz-fake-positive` | 0 | 全是纯字面量 —— **反例**：不许把字面量算成「算出来的」 |
| `zz-fake-mixed` | 0 | 同上 |
| `zz-fake-negative` | 3 | 模板串插值 / 字符串拼接 / `String()`（都在 `task.config.mjs` 里） |
| `zz-fake-computed` | 9 | 模板串插值 ×4（含 `sub:` 键、流向 `HUD`）/ `.padStart()` / 字符串拼接 ×2（含包装函数调用点）/ `.toFixed()` / `values` 里的表达式 ×2 |
| `zz-no-facts` | 0 | 没有事实表 ⇒ 字面量那一项没验；判据 ③ 照扫（那一段计数照常输出） |

> 已知假阳性（夹具里刻意留着，`zz-fake-computed/scenes/computed.js:25`）：
> `padStart(2, '0')` 里那个补零字符 `'0'` 会被判据 ①② 当成显示位字面量 ——
> 所以这个夹具的 `FACTS.md` 里登记了一行 `0`，免得它自己报红。
