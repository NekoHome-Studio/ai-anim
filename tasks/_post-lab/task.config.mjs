// @ts-check
/**
 * `_post-lab` —— 后处理标定夹具（不进任何一支片子的交付范围，只用来出 A/B 图）。
 *
 * 七段用**同一个场景**（`scenes/card.js` 的测试卡）、每段时长相同，
 * 所以「同一段内时刻」的画面逐像素一致，唯一的变量是 `post`：
 *
 *   tone_off / tone_agx / tone_aces  高光滚降算子（现状 / AgX / ACES）
 *   dith_rpdf / dith_tpdf            8bit 抖动分布（矩形 / 三角）
 *   karis_off / karis_on             泛光亮部提取有没有 Karis 加权
 *
 * 出图：
 *   node scripts/anim.mjs still _post-lab -t 1.5,4.5,7.5,10.5,13.5,16.5,19.5
 * 4K 下看颗粒栅格（grainScale）：
 *   node scripts/anim.mjs still _post-lab -t 1.5 --scale 2
 */
import { seq, cut } from '../../src/timeline.js';
import card from './scenes/card.js';

export default {
  title: '后处理标定 · 测试卡',
  width: 1920, height: 1080, fps: 60, scale: 1,
  timeline: seq([
    // ── 高光滚降：三种算子同一张卡 ──
    cut(card, { id: 'tone_off', dur: 3, params: { label: 'tonemap OFF（现状：软肩 0.85）' }, post: { tonemap: 'off' } }),
    cut(card, { id: 'tone_agx', dur: 3, params: { label: 'tonemap AgX' }, post: { tonemap: 'agx' } }),
    cut(card, { id: 'tone_aces', dur: 3, params: { label: 'tonemap ACES' }, post: { tonemap: 'aces' } }),

    // ── 抖动：矩形 vs 三角 ──
    cut(card, { id: 'dith_rpdf', dur: 3, params: { label: 'dither rpdf（现状）' }, post: { dither: 'rpdf' } }),
    cut(card, { id: 'dith_tpdf', dur: 3, params: { label: 'dither TPDF' }, post: { dither: 'tpdf' } }),

    // ── 泛光 firefly：Karis 加权 on/off ──
    cut(card, { id: 'karis_off', dur: 3, params: { label: 'bloomKaris OFF（现状）' }, post: { bloomKaris: false } }),
    cut(card, { id: 'karis_on', dur: 3, params: { label: 'bloomKaris ON' }, post: { bloomKaris: true } }),

    // ── 高光的第二组：换了算子之后要不要配曝光补偿？ ──
    // 现状的软肩在输入 1.0 就已经基本到顶（实测 254/255），所以先试"同一算子更早滚降"，
    // 再试 AgX/ACES 配一档负曝光把被抬起来的暗部压回去。
    cut(card, { id: 'shoulder_lo', dur: 3, params: { label: '现状算子 shoulder 0.60（更早滚降）' }, post: { shoulder: 0.6 } }),
    cut(card, { id: 'agx_ev', dur: 3, params: { label: 'AgX + exposure 0.75' }, post: { tonemap: 'agx', exposure: 0.75 } }),
    cut(card, { id: 'aces_ev', dur: 3, params: { label: 'ACES + exposure 0.85' }, post: { tonemap: 'aces', exposure: 0.85 } }),
  ]),
};
