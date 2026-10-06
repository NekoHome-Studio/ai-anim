import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

/** 每个任务是一个目录 tasks/<name>/，里面必须有 task.config.mjs。 */
const taskDirs = existsSync(path.join(root, 'tasks'))
  ? readdirSync(path.join(root, 'tasks'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(path.join(root, 'tasks', d.name, 'task.config.mjs')))
      .map((d) => d.name)
  : [];

export default defineConfig({
  root,
  // Chrome 需要在真正的 http:// 源上跑（file:// 会挡住模块与 fetch）
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    watch: {
      // 新建的任务目录也要被监听到（否则 import.meta.glob 看不到新任务，要重启 dev）
      //
      // ⚠ 这里放宽过一次（`docs/IMPROVEMENTS-2.md` P2-2）：原来只有 `**/out/**`，
      //   于是**长渲染期间连往 docs/ 写一个 markdown 都不敢** —— HMR 一重载页面，
      //   WebSocket 就断流，推帧提前结束，而 CLI 还报 ✓（历史上把 2880 帧截成 152 帧）。
      //   现在把**确定不在模块图里**的东西全部排除：文档、音频素材、分析数据、
      //   事实表。它们改了不可能影响画面，没必要让页面重载。
      //
      //   ⚠ 真正在模块图里的（`src/**`、`tasks/*/scenes/**`、`task.config.mjs`、
      //   任务自己的样式表）**故意不排除** —— 那些改了就该重载，而且要能被
      //   `renderToFile` 的模块图 mtime 守门抓住（见 scripts/anim.mjs）。
      //
      //   ⚠⚠ 但**别**把上面这段读成"渲染期间可以往 docs/ 写 markdown" ——
      //   编辑器的原子写会留下 `.xxx.tmpdir/*.tmp`（**不以 `.md` 结尾**），这里挡不住，
      //   撞 `EBUSY` 会让 Vite 进程直接崩（`docs/STATUS.md` §14.5 第三次复现）。
      //   准确规则：**只要有一场渲染在跑，就一个文件都别写**；只有 `**/out/**`
      //   被实测证明挡得住，所以并发子代理的产出先落 `out/_staging/`（见 `AGENTS.md` §7）。
      ignored: [
        '**/node_modules/**', '**/out/**', '**/.git/**',
        '**/*.md',
        'docs/**',
        'tasks/*/audio/**',
        'tasks/*/fonts/**',
        'tasks/**/FACTS.md',
        'tasks/**/SCRIPT.md',
        'tasks/**/timing.json',
        'tasks/**/timing.mjs',
        '**/*.analysis.json',
        '**/*.rgba', '**/*.yuv',
      ],
    },
  },
  build: { target: 'esnext', outDir: 'dist' },
  /**
   * 预打包 three。
   *
   * `src/core/three-bridge.js` 里对 three 用的是**动态** import（不用 Three.js 的任务
   * 不该被它拖下水）。代价是：不写这一条，Vite 会在**第一次真的用到它的那一刻**
   * 才发现这是个新依赖 → 重新预打包 → **整页刷新** —— 而那通常正好发生在离屏渲染中途，
   * 页面一刷新推流就断了（而 CLI 可能照样报成功，见 `AGENTS.md` §7）。
   * 写在 include 里，服务一起来就打包好，运行时不会再变。
   */
  optimizeDeps: { include: ['three'] },
  // 离屏渲染时禁止热重载：渲染中途保存文件不能让页面刷新
  define: {
    __ANIM_TASKS__: JSON.stringify(taskDirs),
  },
});
