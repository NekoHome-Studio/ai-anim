# docs/history —— 归档目录

> **这里放的是已经做完 / 已经过期的东西，只作历史参考。**
> ⚠ **不要把这里的"没做的 / 留给下一轮"当成待办** —— 那是**当时**的状态。
> 现在唯一有效的待办清单是 [`../BACKLOG.md`](../BACKLOG.md)（已经逐条核对过，把后来做掉的划掉了）。
>
> **要看当前状态**：`../STATUS.md`（最近几轮 §14–§19）、`../../AGENTS.md` §9（目录与文档导航）、
> `../ENGINE.md`（规格）、`../COOKBOOK.md`（做法）。**本文档与代码不一致时，一律以代码为准。**
>
> 归档规则：内容**不删**（它记录了"问题是怎么被发现的"：证据链、复现命令、当时的读数），
> 只在文件顶部加一段状态说明；**已归档的文件不再更新**。

---

## 1. 这里面有什么

| 文件 | 原位置 | 是什么 | 现状以谁为准 |
|---|---|---|---|
| [`HANDOFF.md`](HANDOFF.md) | `docs/HANDOFF.md` | 引擎最早那一轮的交接单（出片管线暴露的问题） | `STATUS.md` §1–§9 → [`STATUS-rounds-1-6.md`](STATUS-rounds-1-6.md) |
| [`HANDOFF-THREEJS.md`](HANDOFF-THREEJS.md) | `docs/HANDOFF-THREEJS.md` | 把 Three.js 接进引擎的**设计档 + 坑清单**（提案） | [`../THREE.md`](../THREE.md)（怎么写）· [`../ENGINE.md`](../ENGINE.md) §3.8（规格） |
| [`IMPROVEMENTS-1-3.md`](IMPROVEMENTS-1-3.md) | `docs/IMPROVEMENTS.md` · `IMPROVEMENTS-2.md` · `IMPROVEMENTS-3.md` | 第一～三轮的改进记录（fidus 那轮 17 条 / beast 那轮 14 条 / promo 那轮的 A–F）——**53 条全部落地** | 代码 · `STATUS.md` §10 / §11 / §16 |
| [`IMPROVEMENTS-4-5.md`](IMPROVEMENTS-4-5.md) | `docs/IMPROVEMENTS-4.md` · `IMPROVEMENTS-5.md` | 第四轮（`tasks/optifine` 那轮）与第五轮（风格包 + 字幕层） | 代码 · 未落地项见 [`../BACKLOG.md`](../BACKLOG.md) |
| [`STATUS-rounds-1-6.md`](STATUS-rounds-1-6.md) | `docs/STATUS.md` §1–§13 | `STATUS.md` 前六轮的详细记录（§1–§13） | `../STATUS.md`（§14 起）；**章节号原样保留** |

> `tasks/sodium` / `tasks/optifine` / `tasks/fidus` / `tasks/beast` / `tasks/nekohome` 这几支片子
> **不在公开仓库里**（作者本地的成片项目）。归档文档里出现的 `tasks/xxx/...` 路径是**证据出处**，
> 不是可点开的文件。

---

## 2. 旧文件名 → 现在在哪（照着老文档找文件时用）

| 老文档里写的 | 现在读 |
|---|---|
| `docs/IMPROVEMENTS.md` | [`IMPROVEMENTS-1-3.md`](IMPROVEMENTS-1-3.md)（第一部分 · 第一轮） |
| `docs/IMPROVEMENTS-2.md` | [`IMPROVEMENTS-1-3.md`](IMPROVEMENTS-1-3.md)（第二部分 · 第二轮） |
| `docs/IMPROVEMENTS-3.md` | [`IMPROVEMENTS-1-3.md`](IMPROVEMENTS-1-3.md)（第三部分 · 第三轮） |
| `docs/IMPROVEMENTS-4.md` | [`IMPROVEMENTS-4-5.md`](IMPROVEMENTS-4-5.md)（第四轮） |
| `docs/IMPROVEMENTS-5.md` | [`IMPROVEMENTS-4-5.md`](IMPROVEMENTS-4-5.md)（第五轮） |
| `docs/HANDOFF.md` | [`HANDOFF.md`](HANDOFF.md) |
| `docs/HANDOFF-THREEJS.md` | [`HANDOFF-THREEJS.md`](HANDOFF-THREEJS.md) |
| `docs/STATUS.md` §1…§13 | [`STATUS-rounds-1-6.md`](STATUS-rounds-1-6.md)（**§ 号不变**） |
| `docs/STATUS.md` §14…§19 | [`../STATUS.md`](../STATUS.md) |

> 这些旧路径在正文里**已经全部改成新路径**（2026-10-07 整理时批量改过）。
> 上表留着的意义是：读到外部笔记、旧对话或 git 历史里的老路径时，知道该去哪找。
> ⚠ `tasks/sodium/HANDOFF.md` **没有**进这个目录 —— 它在 `.gitignore` 里（`tasks/sodium/` 是不公开的本地片子），
> 所以它留在原地。别处引用它时写的是 `tasks/sodium/HANDOFF.md`，那是**本地路径**，clone 下来的人看不到。

---

## 3. 整理记录（2026-10-07）

这一轮把仓库文档梳理了一遍，做的事：

1. **合并**：五份 `IMPROVEMENTS*.md`（103 KB）→ 两份归档（按"都已落地 / 还有尾巴"分成 1–3 与 4–5），
   各自带一张总台账；
2. **归档**：`docs/HANDOFF-THREEJS.md`（Three.js 接入提案，已落地）移入本目录。
   ⚠ `tasks/sodium/HANDOFF.md` **没有**移进来 —— 它在 `.gitignore` 里（`tasks/sodium/` 是不公开的
   本地片子），一度移进本目录，复核公开范围时又退回了原地；它引用的地方写 `tasks/sodium/HANDOFF.md`；
3. **瘦身**：`STATUS.md` 从 167 KB / 2338 行降到 61 KB / 802 行 —— 前六轮（§1–§13）移入
   [`STATUS-rounds-1-6.md`](STATUS-rounds-1-6.md)，**章节号原样保留**，所有交叉引用仍然有效；
4. **新建** [`../BACKLOG.md`](../BACKLOG.md)：把散落在五份文档里的"没做的 / 待拍板"逐条核对、
   去重、判活，收成**唯一一份待办清单**（顺带列了"已经关掉、别再翻"的那些）；
5. **修引用**：全仓库指向旧路径的引用批量改到新位置，共 **71 处** ——
   指向 `IMPROVEMENTS*.md` 的 26 处（`docs/ENGINE.md` / `COOKBOOK.md` / `STYLE.md` /
   `SCENE-BRIEF-TEMPLATE.md` / `CAPTIONS.md` / `CONFIG-ONLY.md` / `tasks/promo/*` …）、
   指向 `STATUS.md` §1–§13 的 13 处、以及拆分与合并之后归档文件内部的 32 处；
   同时更新了 `AGENTS.md` §9 的目录结构与 `README.md` 的目录节。
6. **顺手修掉的两处原文瑕疵**：`STATUS.md` 里 §18.5 标题**重复出现两次**（内容不同，
   改成 §18.5.1 读数对照 / §18.5.2 学到的）；IMPROVEMENTS 第三轮 §6 表格里
   `` `子帧数 | shake.dx | shake.dy` `` 的竖线未转义（表格会错位，改成 `\|`）。

> 验证：整理后跑了「全部 md 的相对链接是否存在」与「每个源文件的标题是否都在归档里」两项检查 ——
> 死链 **0**；标题命中：第一～三轮 **51/51**、第四～五轮 **56/56**、STATUS 原文件 **124/126**
> （缺的 2 条正是上面故意改名的重复标题）。

整理前的完整备份在 `out/_docbackup-20261007/`（25 个文件 / 1.5 MB，不进版本控制）。
