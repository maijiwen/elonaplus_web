'use strict';
/**
 * 随机名字生成（core/randname.js）—— 对应原版 `randnameinit`（589870-589913）
 * 与 `randname`（589862-589868）
 *
 * 【源码依据】
 *   randnameinit 初始化 5 组词表（sdim 后逐段追加）：
 *     var_2752 职业：戦士 / 魔法使い / 魔術師 / 僧侶
 *     var_2757 形容词：美しい / 汚らわしい / ひどい / 汚い
 *     var_2754 动作：動く / 止まる / 襲う / 飛べ
 *     var_2756 动词：止める / 狩る / 狩りし / 殺す / 飼う / 飼いならす / 手懐ける /
 *                  まとう / まといし / まとった
 *     var_2755 副词：とても / とてつもなく / どうしようもなく / 凄く / 激しく /
 *                  危険な / 危険すぎる / やばい / やばすぎる / まるで / まったく / 全然 /
 *                  それは / これこそ / そして / しかし / 絶対に / 必ず / かなり / やや / 多少
 *   randname() 三步都写同一个变量（后一句覆盖前一句），最终结果：
 *     `职业A + "を" + 动词 + 职业B`   —— 例「戦士を狩る魔術師」
 *   原版在 *label_4273（589915-589935）用它铺满一屏 135 个名字做展示/调试画面。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 五组词表（与原版 var_2752/57/54/56/55 一一对应，顺序不变） */
  const WORDS = {
    job: ['戦士', '魔法使い', '魔術師', '僧侶'],
    adj: ['美しい', '汚らわしい', 'ひどい', '汚い'],
    act: ['動く', '止まる', '襲う', '飛べ'],
    verb: ['止める', '狩る', '狩りし', '殺す', '飼う', '飼いならす', '手懐ける',
      'まとう', 'まといし', 'まとった'],
    adv: ['とても', 'とてつもなく', 'どうしようもなく', '凄く', '激しく',
      '危険な', '危険すぎる', 'やばい', 'やばすぎる', 'まるで', 'まったく', '全然',
      'それは', 'これこそ', 'そして', 'しかし', '絶対に', '必ず', 'かなり', 'やや', '多少'],
  };

  /** randnameinit —— 本项目里词表是常量，此函数保留以对应原版调用（并发回词表） */
  function init() { return WORDS; }

  function pick(arr, rng) {
    const r = rng && rng.rnd ? rng.rnd(arr.length) : Math.floor(Math.random() * arr.length);
    return arr[r];
  }

  /**
   * randname()（589862-589868）
   * 原版三句依次覆盖，因此只保留最后一句的形式：`职业Aを动词职业B`。
   * 为了保留中间两句的可复现性，`variant` 可选 0/1/2：
   *   0（默认）= 职业Aを动词职业B（原版最终结果）
   *   1 = 动作词 + 职业
   *   2 = 副词 + 职业
   */
  function randname(rng, variant) {
    const job = pick(WORDS.job, rng);
    if (variant === 1) return pick(WORDS.act, rng) + job;
    if (variant === 2) return pick(WORDS.adv, rng) + job;
    return job + 'を' + pick(WORDS.verb, rng) + pick(WORDS.job, rng);
  }

  /** 原版 *label_4273 的展示画面用：生成 n 个随机名字 */
  function sample(n, rng) {
    const out = [];
    for (let i = 0; i < (n | 0); i++) out.push(randname(rng));
    return out;
  }

  Elona.RandName = { WORDS, init, randname, sample };
})(window);
