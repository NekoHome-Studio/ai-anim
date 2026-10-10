// 自测夹具：**没有 FACTS.md 的任务** —— 必须安静跳过（打印一行"没验"），不是报错
//
// 这条对应 docs/DIAGNOSIS.md §3 的「空 ≠ 干净」：跳过不是通过，
// 但也不是失败 —— 退出码不受它影响。
//
// 目录名用 `zz-no-facts`（不是 `zz-fake-nofacts`）：一眼看出它缺的就是事实表。

export default {
  title: '夹具 · 没有事实表',
  width: 1920, height: 1080, fps: 60,
  timeline: [
    { type: 'title', title: '这里有个数字 3359', sub: '没有 FACTS.md，所以不判', dur: 3 },
    { type: 'outro', dur: 2 },
  ],
};
