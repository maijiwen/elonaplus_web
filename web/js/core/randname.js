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

  /**
   * 0-X0：中文显示词表（逐项对应上面的日文原表，组数/顺序完全一致）。
   * 原版词表保留在 WORDS 里供回归脚本核对源码；界面上生成的冒险者称号走这一份，
   * 否则 `names.json` 音译完之后，城镇里随机冒险者仍会显示「僧侶を止める僧侶」这类日文。
   */
  const WORDS_CH = {
    job: ['战士', '魔法使', '魔术师', '僧侣'],
    adj: ['美丽', '污秽', '糟糕', '肮脏'],
    act: ['行走', '静止', '袭击', '飞翔'],
    verb: ['阻止', '猎杀', '狩猎过', '斩杀', '饲养', '驯养', '收服',
      '披挂', '曾披挂', '披挂着'],
    adv: ['绝世', '盖世', '莫名', '凌厉', '狂暴',
      '危险', '极度危险', '不妙', '大不妙', '宛如', '全然', '彻底',
      '那正是', '这正是', '于是', '然而', '必定', '必然', '相当', '略微', '些许'],
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

  /**
   * 0-X0：中文显示版 randname（589862-589868 的句式，词与助词换成中文）。
   * 原版 `职业A + を + 动词 + 职业B`（如「戦士を狩る魔術師」），
   * 中文按自然语序写作 `动词 + 职业A + 的 + 职业B`（「猎杀战士的魔术师」）。
   * variant 1/2 对应源码被覆盖掉的两句：`动作(的) + 职业` / `副词 + 职业`。
   */
  function randnameCh(rng, variant) {
    const a = pick(WORDS_CH.job, rng);
    if (variant === 1) return pick(WORDS_CH.act, rng) + '的' + a;
    if (variant === 2) return pick(WORDS_CH.adv, rng) + a;
    return pick(WORDS_CH.verb, rng) + a + '的' + pick(WORDS_CH.job, rng);
  }

  /** 逐词最长匹配替换：日表 → 中表 */
  function replaceWords(s) {
    const pairs = [];
    for (const k of ['job', 'adj', 'act', 'verb', 'adv']) {
      for (let i = 0; i < WORDS[k].length; i++) pairs.push([WORDS[k][i], WORDS_CH[k][i]]);
    }
    pairs.sort((x, y) => y[0].length - x[0].length);
    let out = s;
    for (const [jp, ch] of pairs) out = out.split(jp).join(ch);
    return out;
  }

  /**
   * 0-X0：把旧存档里持久化的日文冒险者称号改成中文。
   * 默认句式带 `を`：拆成「职业A / 动词+职业B」再按中文语序重组；
   * 其余句式（variant 1/2 或自定义）直接逐词替换。已是中文则原样返回。
   */
  function localize(name) {
    if (!name || typeof name !== 'string' || !/[ぁ-んァ-ヶ]/.test(name)) return name;
    const cut = name.indexOf('を');
    if (cut > 0) {
      const a = name.slice(0, cut), tail = name.slice(cut + 1);
      let verbJp = '', verbCh = '', jobB = tail;
      for (let i = 0; i < WORDS.verb.length; i++) {
        if (tail.indexOf(WORDS.verb[i]) === 0 && WORDS.verb[i].length > verbJp.length) {
          verbJp = WORDS.verb[i]; verbCh = WORDS_CH.verb[i]; jobB = tail.slice(verbJp.length);
        }
      }
      if (verbJp) return verbCh + replaceWords(a) + '的' + replaceWords(jobB);
    }
    return replaceWords(name);
  }

  Elona.RandName = { WORDS, WORDS_CH, init, randname, randnameCh, localize, sample };
})(window);
