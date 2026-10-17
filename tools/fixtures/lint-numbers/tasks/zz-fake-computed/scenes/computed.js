// 自测夹具：**算出来的显示位**（判据 ③）—— 这个文件 6 处，每一处对应一条「要认的形态」
//
// 静态扫描不会执行它，所以只要语法是 JS 就行（不会真的渲染、也不需要 GPU）。
// 每一处都在下面的注释里点名了它算哪一种；改这里会让 tools/test-fabricated-numbers.mjs §8 当场红。

import { put } from '../../../../src/kit/index.js';

export const ROWS = ['甲', '乙'];      // 纯字符串数组（元素是字面量 ⇒ 判据 ③ 不报它）

/** 任务自己包一层：body 里有文字入口 ⇒ 判据 D 的包装函数；它的调用点实参也要过判据 ③ */
function tag(type, s, x, y) {
  type.write(s, x, y, { size: 22 });
}

export default {
  id: 'computed',
  render(ctx) {
    const { type } = ctx;
    type.clear();
    // 判据 ①② 的正身：纯字面量（有出处）—— 它**不许**被算成「算出来的」
    type.writeLine('纯字面量：42 份', 960, 300, { size: 96, anchor: 'center' });
    // ① 模板串插值（`${…}`）
    type.writeLine(`序号 ${String(ROWS.length).padStart(2, '0')}`, 120, 400, { size: 30 });
    // ② 包了 .padStart()（补零字符 '0' 会被判据 ①② 当成显示位 —— 已知假阳性，FACTS.md 里登记了）
    put(type, String(1 + 1).padStart(2, '0'), 120, 460, { size: 30 });
    // ③ 字符串拼接（'第 ' + 变量 + ' 行'）
    type.write('第 ' + ROWS[0] + ' 行', 120, 520, { size: 30 });
    // ④ 包了 .toFixed()（再拼一个 '%'）
    type.writeLine((0.5 * 100).toFixed(1) + '%', 120, 580, { size: 30 });
    // ⑤ 包装函数的调用点实参（判据 D 的位置 + 判据 ③ 的形态）
    tag(type, '第 ' + ROWS.length + ' 行', 120, 640);
    // ⑥ 流向：先赋给变量、之后再送进文字入口（判据 ③ 在**定义处**报）
    const HUD = `n = ${ROWS.length}`;
    type.write(HUD, 120, 700, { size: 30 });
    type.upload();
    return { bloom: 0.3 };
  },
};
