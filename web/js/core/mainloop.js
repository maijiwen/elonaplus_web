'use strict';
/**
 * 主循环尾部的常驻检查 —— `*label_4363` 之后（605329-605415）。
 *
 * 【源码依据 hsp/start.hsp】
 *   605346-605349  var_1773++ / 连击计数 `var_58(444, 0)` 每帧清零
 *                  （AI 侧对应 `var_58(444, 自己)`，已由 core/ai.js 承担）
 *   605350-605353  `var_1773 \ var_2826 == 1` 时 var_255++ + 重画 HP 条
 *                  （*label_2105 是纯绘制，浏览器由 renderer 事件驱动）
 *   605383-605396  真实时间每过 3600 秒 → var_630++，播报「已经玩了 N 小时」
 *   605402-605415  HP < 最大 HP 的 1/5 且 var_98(869-600)==0 → 习得能力 869「命乞い」
 *   605354-605382  网络聊天（var_1195）—— 单机版不适用
 *   605416-605493  调试键（var_65(250+23)==5 / var_65(828)）—— 设计不移植
 *
 * 【本项目的落地方式】
 *   原版是阻塞式主循环；这里由 `Game.endTurn` 每回合调用一次 `tick()`。
 *   真实时间的「玩了 N 小时」用 `Date.now()` 计，与原版 `timeGetTime()` 同义。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 605383：3600 秒 = 1 小时 */
  const HOUR_MS = 3600 * 1000;

  /** 605402：HP 低于最大值的 1/5 */
  const LOW_HP_DIV = 5;

  /** 605403：能力 869「命乞い」的 var_98 下标 = 869 - 600 */
  const ABILITY_ID = 869;
  const ABILITY_FLAG = ABILITY_ID - 600;

  function log(g, msg) {
    if (g && typeof g.log === 'function') g.log(msg);
  }

  function langOf(g) {
    if (g && g.lang) return g.lang;
    return (Elona.i18n && Elona.i18n.lang) ? Elona.i18n.lang : 'ch';
  }

  // ------------------------------------------------------------------
  // 605346-605349：连击计数清零
  // ------------------------------------------------------------------
  /**
   * var_58(444, 0) 是「连续命中同一目标」的计数（34622 的 `NChain!`、
   * 198553 的伤害衰减）。原版在每次输入帧开头清零玩家自己的那一格，
   * 否则连击会无限累加。
   */
  function clearChain(g) {
    const p = g && g.player;
    if (!p || typeof p.get !== 'function') return 0;
    if ((p.get(444) | 0) === 0) return 0;
    p.set(444, 0);
    return 1;
  }

  // ------------------------------------------------------------------
  // 605402-605415：濒死习得「命乞い」
  // ------------------------------------------------------------------
  /**
   * `var_58(50,0) < var_58(51,0)/5` 且 `var_98(269) == 0` → 置 1 并播报。
   * 经文 605411：「あなたは「<能力名>」の能力を得た。」
   */
  function lowHpAbility(g) {
    const p = g && g.player;
    if (!p || typeof p.get !== 'function') return null;
    const F = Elona.Feat;
    if (!F || typeof F.flag !== 'function' || typeof F.setFlag !== 'function') return null;
    const hp = Math.max(0, p.hp | 0);
    const max = Math.max(1, p.get(51) | 0);
    // 原版 `/` 是整数除法：var_58(51)/5 先截断（101/5 = 20）
    if (!(hp < Math.trunc(max / LOW_HP_DIV))) return null;
    if ((F.flag(p, ABILITY_FLAG) | 0) !== 0) return null;
    F.setFlag(p, ABILITY_FLAG, 1);
    const L = langOf(g);
    const nm = (Elona.Ability && typeof Elona.Ability.name === 'function')
      ? Elona.Ability.name(ABILITY_ID, L) : '命乞い';
    const msg = L === 'en'
      ? `You have learned new ability, ${nm}.`
      : (L === 'ch' ? `你获得了「${nm}」的能力。` : `あなたは「${nm}」の能力を得た。`);
    log(g, msg);
    return { id: ABILITY_ID, flag: ABILITY_FLAG, name: nm, message: msg };
  }

  // ------------------------------------------------------------------
  // 605383-605396：真实时间每满一小时播报
  // ------------------------------------------------------------------
  /**
   * @param {object} g
   * @param {number} [now] 毫秒时间戳（便于测试注入）
   */
  function playtime(g, now) {
    if (!g) return null;
    const t = (typeof now === 'number') ? now : (global.Date ? Date.now() : 0);
    if (typeof g.playtimeMark !== 'number') { g.playtimeMark = t; return null; }
    if (t - g.playtimeMark <= HOUR_MS) return null;
    g.playtimeMark = t;
    g.playtimeHours = (g.playtimeHours | 0) + 1;
    const n = g.playtimeHours;
    const L = langOf(g);
    const msg = L === 'en'
      ? `You have been playing ElonaPlus for ${n} hour${n === 1 ? '' : 's'}.`
      : (L === 'ch'
        ? `你已经玩了 ElonaPlus ${n} 小时。`
        : `ElonaPlusをはじめてから${n}時間が経過しています。`);
    log(g, msg);
    return { hours: n, message: msg };
  }

  /**
   * 每回合调用一次。
   * @returns {{chain:number, ability:object|null, playtime:object|null}}
   */
  function tick(g, now) {
    const out = { chain: clearChain(g), ability: null, playtime: null };
    if (abilityEnabled) out.ability = lowHpAbility(g);
    out.playtime = playtime(g, now);
    return out;
  }

  /** 只有带 Feat 模块时才启用濒死习得（单元测试可关掉） */
  let abilityEnabled = true;

  Elona.MainLoop = {
    HOUR_MS, LOW_HP_DIV, ABILITY_ID, ABILITY_FLAG,
    clearChain, lowHpAbility, playtime, tick,
    setAbilityEnabled(v) { abilityEnabled = !!v; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
