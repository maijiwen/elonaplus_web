'use strict';
/**
 * type-0 动作型特殊能力的剩余分支 —— 原版 `*label_2965` 起的
 * `if ( var_1302 == id | var_1303 )` 大山（318379-340430，共 10,253 行）。
 *
 * 前几个阶段已经把其中成体系的几块拆成独立模块：
 *   core/melee.js    近接 7 条（0-EH）
 *   core/buffact.js  自身强化 7 条（0-EI）
 *   core/summon.js   召唤 7 条（0-EJ）
 *   core/gauge.js    斗志技 / 广域 4 条（0-EK）
 *   core/breathx.js  吐息 7 条（0-EL）
 * 本模块补的是剩下的 116 条零散分支（0-EM）。
 *
 * 原版的公共脚手架在这里统一实现，避免每条重复写：
 *
 *   synccheck(var_244, -1)         → H.visible(g, t)      目标对玩家可见才播报
 *   txt_select lang(...)           → H.say(g, t, '中文…') 单行播报（多选一取首句）
 *   dmghp / healhp / dmgmp / ...   → H.dmg / H.healHp / ...
 *   dmgcon                         → H.con（走 Resist.dmgcon）
 *   addbuff / delbuff              → H.buff / H.unbuff
 *   var_58(n, c) / var_82(n, c)    → c.get(n) / c.skill(n)
 *   var_65(n)                      → g.getV65(n)
 *
 * 三个反复出现的整块也提成了 helper：
 *   H.vampire(g, c, t)    `if ( findbuff(var_243, 50) != -1 )` 的吸血/吸魔段
 *   H.rage(g, c, t, id)   `var_2378` 斗志溢出判定 → 改放 728（或 730）
 *   H.recast(g, c, id, t) `var_396 = id ; gosub *label_2960` 的同回合改放
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // ------------------------------------------------------------------
  // 公共脚手架
  // ------------------------------------------------------------------
  function rndOf(g) {
    const owner = (g && g.rng) ? g.rng : Elona.rng;
    if (owner && typeof owner.rnd === 'function') return (n) => owner.rnd(n);
    return () => 0;
  }
  function v65(g, n) {
    if (!g || !g.getV65) return 0;
    const v = g.getV65(n);
    return (v === undefined || v === null) ? 0 : (v | 0);
  }
  function setV65(g, n, v) { if (g && g.setV65) g.setV65(n, v); }

  /** synccheck(var_244, -1)：目标对玩家是否可见（自己 / 队友 / 主角） */
  /**
   * synccheck(var_244, -1)：这段在原版是「玩家能不能看到这个角色」，
   * 决定要不要往消息栏写一行。本项目没有逐格视野缓存，因此按
   * 「自己 / 队友 / 视野内」三级判；拿不到视野信息时按可见处理（宁可多播报）。
   */
  /** 按 chara.index 找角色（g.charas 的数组下标不一定等于 index） */
  function findChara(g, idx) {
    for (const m of (g.charas || [])) {
      if (m && (m.index | 0) === (idx | 0)) return m;
    }
    return null;
  }
  function visible(g, c) {
    if (!c) return false;
    if ((c.index | 0) === 0) return true;
    if (g && g.getV65 && (c.index | 0) === v65(g, 183)) return true;
    if (Elona.Party && Elona.Party.isAlly && Elona.Party.isAlly(c)) return true;
    // 拿不到逐格视野时按「可见」处理：宁可多播报一行，也不要整段消息消失。
    return true;
  }
  function say(g, s) { if (g && g.log && s) g.log(s); }
  function nm(c) { return (c && c.name) || '某人'; }

  function dmg(g, t, n, caster, elem, arg, opts) {
    if (!t || (t.get(0) | 0) !== 1) return 0;
    // 0-EX：魔力控制（技能 188 / calcmagiccontrol）—— 源码在 10 处广域能力命中前调用
    //   （323937/324085/324165/327056/327887/327968/328081/329493/329564/338810）。
    //   项目把这些能力简化成单目标 handler，故统一在伤害包装器接线；
    //   calcMagicControl 只在「双方同一阵营」时才减伤，对敌对目标无影响。
    let dmgVal = n | 0;
    if (caster && caster !== t && g && g.rng && Elona.Spell && Elona.Spell.calcMagicControl) {
      const mc = Elona.Spell.calcMagicControl(g, caster, t, dmgVal);
      if (mc.avoided) return 0;
      dmgVal = mc.dmg;
    }
    if (Elona.Battle && Elona.Battle.applyDamage) {
      return Elona.Battle.applyDamage(t, dmgVal, g, caster || null,
        elem === undefined ? 0 : (elem | 0), arg === undefined ? 0 : (arg | 0), opts) | 0;
    }
    t.set(50, Math.max(0, (t.get(50) | 0) - dmgVal));
    return dmgVal;
  }
  function healHp(c, n) { if (Elona.Status && Elona.Status.healhp) Elona.Status.healhp(c, n | 0); }
  function healMp(c, n) { if (Elona.Status && Elona.Status.healmp) Elona.Status.healmp(c, n | 0); }
  function dmgMp(c, n) { if (Elona.Status && Elona.Status.dmgmp) Elona.Status.dmgmp(c, n | 0); }
  function healSp(c, n) { if (Elona.Status && Elona.Status.healsp) Elona.Status.healsp(c, n | 0); }
  function dmgSan(c, n, g) { if (Elona.Status && Elona.Status.dmgsan) Elona.Status.dmgsan(c, n | 0, g); }
  function con(g, t, cond, pw) {
    if (Elona.Spell && Elona.Spell.dmgconOf) return Elona.Spell.dmgconOf(g, t, cond, pw | 0) | 0;
    return 0;
  }
  /** addbuff 的原型是 (g, c, id, p1, p2)（status.js:81） */
  function buff(g, c, id, pw, dur) {
    if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, id | 0, pw | 0, dur | 0);
  }
  function hasBuff(c, id) {
    if (!Elona.Status || !Elona.Status.findbuff) return false;
    return Elona.Status.findbuff(c, id | 0) >= 0;
  }
  function unbuff(c, id) {
    if (!Elona.Status || !Elona.Status.findbuff) return false;
    const slot = Elona.Status.findbuff(c, id | 0);
    if (slot < 0) return false;
    Elona.Status.delbuff(c, slot);
    return true;
  }
  function cbit(c, n) {
    if (Elona.Status && Elona.Status.cbit) return (Elona.Status.cbit(c, n | 0) | 0) === 1;
    return false;
  }
  function setCbit(c, n, v) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, n | 0, v ? 1 : 0);
  }
  function skillExp(c, n, amt) {
    if (!c) return;
    // 326xxx 各分支的 `skillexp <技能>, var_243, <经验>`：角色下标必须显式传，
    // 之前只传了 3 个参数（经验被当成 chara、exp 变 undefined），会把技能潜力写成 0。
    if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(c, n | 0, c.index | 0, amt | 0);
  }
  function morale(c) { return c ? (c.get(182) | 0) : 0; }
  function setMorale(c, v) { if (c) c.set(182, v | 0); }
  /** var_58(182) += n，带上限（>100 时按 409/214/25 判 100，再夹到 200） */
  function addMorale(c, n) {
    let v = morale(c) + (n | 0);
    if (v > 100) {
      const free = (c.get(409) | 0) <= 0
        && ((c.get(214) | 0) <= 0 || (c.index | 0) === 0)
        && ((c.get(25) | 0) < 4 || (c.index | 0) < 16);
      if (free) v = 100;
    }
    if (v > 200) v = 200;
    setMorale(c, v);
  }
  function subMorale(c, n) { setMorale(c, Math.max(0, morale(c) - (n | 0))); }

  /** 是否「手持武器」（var_58(97)）—— 见 339619 的武器技判定 */
  function armed(c) { return (c.get(97) | 0) !== 0; }

  /** `var_396 = id ; gosub *label_2960` 的同回合改放 */
  function recast(g, c, id, t) {
    if (!Elona.Spell || !Elona.Spell.cast) return null;
    // 目标缺省时传施法者本人：619 影步这类自身位移的分支在效果函数里仍会读 tg.x
    return Elona.Spell.cast(g, c, id | 0, t || c);
  }

  /**
   * `if ( findbuff(var_243, 50) != -1 )` 的公共段（buff 50 = 朱亚的瞳孔）：
   *   目标 HP/MP 被吸 1/6，施法者回复 1/2，双方斗志各 -2 / +2。
   * 636 / 638 / 648 / 652 / 683 / 771 / 772 / 842 / 633 共用。
   */
  function vampire(g, c, t) {
    if (!hasBuff(c, 50) || !t || (t.get(0) | 0) !== 1) return false;
    const R = rndOf(g);
    const v = c.skill(16) | 0;
    say(g, '……' + nm(c) + '的瞳孔裂开了。');
    dmg(g, t, idiv(v, 6) + R(5 + idiv(v, 6)), c, 16, 0);
    healHp(c, idiv(v, 2) + R(5 + idiv(v, 2)));
    dmgMp(t, idiv(v, 6) + R(5 + idiv(v, 6)));
    healMp(c, idiv(v, 2) + R(5 + idiv(v, 2)));
    subMorale(t, 2);
    addMorale(c, 2);
    return true;
  }

  /**
   * `var_2378` 斗志溢出块（636/638/648/652/683/691/771/772/842 等）：
   * 斗志满且判定通过时，把本次动作改放成 728（部分为 730）。
   * 返回 true 表示已经改放，调用方应停止后续效果。
   */
  function rage(g, c, t, over) {
    if (!t || (t.get(0) | 0) !== 1) return false;
    if (morale(c) < 100) return false;
    let v = 0;
    const danger = v65(g, 22);
    if (v65(g, 252) < 350) { if ((c.get(38) | 0) >= 130) v = 100; }
    if (v65(g, 252) >= 350) { if ((c.get(38) | 0) >= 50) v = 100; }
    if ((c.index | 0) < 16 || (c.get(58) | 0) === 100 || (c.index | 0) === 0) v = 100;
    if (v65(g, 273) === 1) v = 100;
    if ((c.index | 0) >= 16 && (c.get(25) | 0) > 3
      && (c.get(50) | 0) > idiv(c.get(51) | 0, 2) && morale(c) < 200) {
      if (c._v1636 !== 100) v = 0;
    }
    if (v65(g, 193) === 888) v = 0;
    if ((c.get(266) | 0) === -1) { if ((c.get(185) | 0) !== 0) v = 0; }
    if ((c.get(266) | 0) === 1 || (c.get(266) | 0) === 2) v = 0;
    if (danger === -1 && false) v = 0;                    // 占位：danger 不参与
    if (v !== 100) return false;
    recast(g, c, over || 728, t);
    return true;
  }

  /** cbit(1016, c)：本回合已选定目标 → 直接对锁定者做一次近接（*label_3006） */
  function meleeLocked(g, c) {
    if (!cbit(c, 1016)) return false;
    const t = c.get(29) | 0;
    const tg = findChara(g, t);
    if (!tg || (tg.get(0) | 0) !== 1) return false;
    if (Elona.Battle && Elona.Battle.attackSeq) Elona.Battle.attackSeq(g, c, tg);
    return true;
  }

  // ------------------------------------------------------------------
  // 逐条实现
  // ------------------------------------------------------------------
  const T = {};

  // ---- 魔力系（325127-325273）------------------------------------
  T[621] = (g, c, t) => {                                   // 恢复魔力 325127
    const R = rndOf(g);
    if ((t.index | 0) === 0) healMp(t, idiv(g._v578 || 0, 2) + R(idiv(g._v578 || 0, 2) + 1));
    else healMp(t, idiv(t.get(56) | 0, 10) + R(t.skill(16) | 0) + 5);
    if (visible(g, t)) say(g, `${nm(t)}的魔力恢复了。`);
    return { implemented: true, mp: true };
  };
  T[624] = (g, c, t) => {                                   // 魔力吸收 325147
    const R = rndOf(g);
    healMp(t, idiv(t.get(56) | 0, 12) + R(4) + 1);
    if (visible(g, t)) say(g, `${nm(t)}从周围吸取了魔力。`);
    return { implemented: true, mp: true };
  };
  // 626 精神分析 318819
  //   0-EP：玩家侧的完整流程（邻格箭头 `*label_2893` + タッグ二选一 + 分析窗）已上移到
  //   `core/ability.js` 的 `use()` 里（318819-318868 的入口就是 `gosub *label_2893`，
  //   而类别 10000 在 `*label_2959` 里只把 var_244 设成使用者）。
  //   这里保留给「不经 Ability.use 的直呼路径」（NPC / 脚本），行为与源码一致：
  //   目标必须是存活角色，然后交给分析窗。
  T[626] = (g, c, t) => {
    if ((c.index | 0) !== 0) return { implemented: true, nothing: true };
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `你窥视了${nm(t)}的心。`);
    return { implemented: true, request: 'analyze', target: t };
  };
  T[628] = (g, c, t) => {                                   // 他人变异 326652
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (!Elona.Mutation) return { implemented: true, nothing: true };
    const r = Elona.Mutation.mutate(g, t, { count: 1 });
    return { implemented: true, mutation: r };
  };
  // 629 魔力抽取 / 630 魔力充填（326463-326651）—— 都要先选一个物品
  T[629] = (g, c) => {
    if ((c.index | 0) !== 0) return { implemented: true, nothing: true };   // 326585
    return { implemented: true, request: 'recharge', mode: 'drain' };
  };
  T[630] = (g, c) => {
    if ((c.index | 0) !== 0) return { implemented: true, nothing: true };   // 326469
    return { implemented: true, request: 'recharge', mode: 'fill' };
  };
  // 以太凝视 339052：源码在「有目标」时直接 goto 2970（无事），只在无目标时继续，
  // 继续的那段属于 636 的共享尾块 —— 因此此处等价于「有目标则无事」。
  T[633] = (g, c, t) => ({ implemented: true, nothing: true, hasTarget: !!t });
  T[636] = (g, c, t) => {                                   // 疯狂凝视 318384
    const R = rndOf(g);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (visible(g, t)) say(g, `${nm(t)}目睹了${nm(c)}啃食尸体的幻象。`);
    dmgSan(t, R(idiv(t.get(38) | 0, 1) + 1), g);
    vampire(g, c, t);
    if (rage(g, c, t, 728)) return { implemented: true, recast: 728 };
    return { implemented: true, san: true };
  };
  T[638] = (g, c, t) => daze(g, c, t, 638);                 // 眩晕凝视 339276（与 648 同块）
  T[648] = (g, c, t) => daze(g, c, t, 648);                 // 痛骂 339280
  /** 638 / 648 共用的 339276-339418 段；src 区分是哪一条触发的 */
  function daze(g, c, t, src) {
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (src === 648) {
      if (visible(g, t)) say(g, `${nm(c)}痛骂了${nm(t)}。`);
      if (v65(g, 191) === 100) say(g, '「你这只蛞蝓！」');
      con(g, t, 7, 100 + limit(c.skill(17) | 0, 1, 2000));   // 339281 迷糊
    } else {
      con(g, t, 7, 100 + limit(c.skill(15) | 0, 1, 2000));   // 638 用詠唱
    }
    subMorale(t, 5);
    vampire(g, c, t);
    if (src === 638 && rage(g, c, t, 728)) return { implemented: true, recast: 728 };
    return { implemented: true, cond: 7 };
  }
  T[649] = (g, c, t) => {                                   // 冲击波动 329440
    const R = rndOf(g);
    say(g, `${nm(c)}放出了冲击波。`);
    let pw = c.skill(152) | 0;                               // 325157：默认射撃
    if (v65(g, 172) === 100) pw = (g._v1369 !== -1) ? (c.skill(189) | 0) : (c.skill(152) | 0);
    g._v578 = pw;
    const hits = projLine(g, c, pw);
    return { implemented: true, type: 0, hits };
  };
  T[651] = (g, c, t) => {                                   // 胡吃海喝 340260
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (visible(g, t)) say(g, `${nm(c)}翻找了${nm(t)}的背包。`);
    const foods = (t.inv || []).filter((e) => e && (e.id | 0) === 618);
    if (!foods.length) return { implemented: true, nothing: true };
    healHp(c, idiv(c.get(51) | 0, 3));
    return { implemented: true, ate: foods.length };
  };
  T[652] = (g, c, t) => {                                   // 魔力凝视 339419
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (visible(g, t)) say(g, `${nm(c)}凝聚魔力瞪视着${nm(t)}。`);
    hostile(g, c, t);
    con(g, t, 21, 100 + limit(c.skill(16) | 0, 1, 400));
    dmgMp(t, idiv(c.skill(16) | 0, 4) + rndOf(g)(10 + idiv(c.skill(16) | 0, 4)));
    vampire(g, c, t);
    if (rage(g, c, t, 728)) return { implemented: true, recast: 728 };
    return { implemented: true, cond: 21 };
  };

  // ---- 斩击 / 射手系 -------------------------------------------------
  T[658] = (g, c, t) => {                                   // 斩首攻击 321670
    const R = rndOf(g);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}瞄准了${nm(t)}的首级。`);
    dmg(g, t, limit((c.skill(12) | 0) * 3 + R(c.skill(12) | 0) - (t.get(70) | 0), 1, 99999), c, 0, 0);
    if ((t.get(50) | 0) > idiv(t.get(51) | 0, 8) && (t.get(263) | 0) < 10) t.set(263, (t.get(263) | 0) + 3);
    return { implemented: true, dmg: true };
  };
  T[659] = (g, c) => {                                      // 地雷埋下 327196
    if (v65(g, 6) === 1) return { implemented: true, nothing: true };   // 世界地图
    if (g.map && g.map.cellFeat) {
      if (g.map.cellFeat(c.x, c.y, 6)) return { implemented: true, nothing: true };
      g.map.cellFeat(c.x, c.y, { id: 14, arg: 7, owner: c.index | 0 });
    }
    return { implemented: true, mine: true };
  };
  T[660] = (g, c, t) => moraleReject(g, c, t, 660, 732);    // 玛尼的分解术 327339
  T[662] = (g, c, t) => moraleReject(g, c, t, 662, 732);    // 超振动拳 327414
  T[664] = (g, c, t) => moraleReject(g, c, t, 664, 732);    // 闪华裂光 327490
  T[665] = (g, c, t) => moraleReject(g, c, t, 665, 732, 10); // 蜗牛闪光 327566（门槛 10）
  T[667] = (g, c, t) => {                                   // 魔力解放 327856
    const R = rndOf(g);
    say(g, `${nm(c)}解开了自身的魔力。`);
    const hits = [];
    for (const o of (g.charas || [])) {
      if (!o || (o.get(0) | 0) !== 1 || o === c) continue;
      if (!sameSide(c, o)) continue;
      if (Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) > 4) continue;
      if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, c.x, c.y, o.x, o.y)) continue;
      const power = (c.get(55) | 0) > (c.skill(16) | 0) ? (c.get(55) | 0) : (c.skill(16) | 0);
      dmg(g, o, power, c, 0, 0);
      hits.push(o.index | 0);
    }
    if ((c.get(55) | 0) > (c.skill(16) | 0)) c.set(55, 0);
    else dmgMp(c, c.skill(16) | 0);
    return { implemented: true, hits, R };
  };
  T[668] = (g, c, t) => moraleReject(g, c, t, 668, 732);    // 元素撕裂 327636
  T[670] = (g, c, t) => moraleReject(g, c, t, 670, 732, 98); // 淘金热 327713（门槛 98）

  // ---- 魅惑 / 状态系 ------------------------------------------------
  T[672] = (g, c, t) => {                                   // 魔法之吻 335281
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (guardJuA(g, t)) return { implemented: true, nothing: true };
    hostile(g, c, t);
    t.set(269, 1);                                           // 被魅惑标记
    const R = rndOf(g);
    if ((c.get(27) | 0) === 709) {                           // 335322：魅魔变体
      dmgMp(c, idiv(c.skill(17) | 0, 10) + 1);
      healMp(t, idiv(c.skill(17) | 0, 10) + 1);
    } else {
      dmgMp(t, idiv(c.skill(17) | 0, 10) + 1);
      healMp(c, idiv(c.skill(17) | 0, 20) + 1);
    }
    return { implemented: true, charmed: true, R };
  };
  T[681] = (g, c, t) => {                                   // 束缚 329655
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(268) | 0) > 0) return { implemented: true, already: true };
    t.set(268, (t.get(268) | 0) + 10);
    return { implemented: true, bind: 10 };
  };
  T[682] = (g, c, t) => {                                   // 威吓 329417
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(267) | 0) > 0) { say(g, '什么也没有发生……'); return { implemented: true, nothing: true }; }
    if (visible(g, t)) say(g, `${nm(t)}畏缩了。`);
    t.set(267, (t.get(267) | 0) + 5);
    return { implemented: true, fear: 5 };
  };
  T[683] = (g, c, t) => {                                   // 洗脑凝视 339133
    if ((c.index | 0) !== 0 && ((c.index | 0) < 16 || (c.get(58) | 0) === 100)) {
      recast(g, c, 652, t);
      return { implemented: true, recast: 652 };
    }
    const R = rndOf(g);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (!visible(g, t)) return { implemented: true, nothing: true };
    if (R(c.skill(17) | 0) > 50 + R(c.skill(17) | 0) || hasBuff(t, 42)) {
      return { implemented: true, resisted: true };
    }
    t.set(269, limit(idiv(300 - (t.get(17) | 0), 10), 5, 30));
    t.set(201, 10);
    t.set(29, 0);
    say(g, `${nm(t)}被剥夺了战意。`);
    vampire(g, c, t);
    if (rage(g, c, t, 728)) return { implemented: true, recast: 728 };
    return { implemented: true, charmed: true };
  };
  T[690] = () => ({ implemented: true, nothing: true });     // 什么也不做 337151（调试）

  // ---- 重力 / 元素近接 ---------------------------------------------
  T[691] = (g, c, t) => {                                   // 重力球 338606
    const R = rndOf(g);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (visible(g, t)) say(g, `${nm(t)}被重力球压扁了。`);
    let d = (idiv(c.skill(11) | 0, 5) + 5) * (idiv((c.skill(16) | 0) + 1, 5) + 5)
      + R((v65(g, 22) | 0) + 5)
      + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
        * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 3);
    const stacks = t.get(262) | 0;                           // 重力累积层数
    if (stacks >= 50 && stacks < 100) d = idiv(d * 3, 2);
    else if (stacks >= 100 && stacks < 150) d = d * 2;
    else if (stacks >= 150 && stacks < 200) d = idiv(d * 5, 2);
    else if (stacks >= 200) d = d * 3;
    if (hasBuff(t, 31)) d = idiv(d, 10);                     // 338622 抗重力
    buff(g, t, 6, idiv(c.skill(11) | 0, 2) + 150, 5);
    t.set(262, stacks + limit(idiv(v65(g, 22), 10), 1, 50) + 10 + R(10));
    dmg(g, t, d, c, 68, 1000);
    if (rage(g, c, t, 730)) return { implemented: true, recast: 730 };
    return { implemented: true, dmg: d };
  };
  T[692] = (g, c, t) => {                                   // 元素之拳 336983
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    // 取目标最高的元素技能，决定附魔属性（336999-337035）
    let best = c.skill(60) | 0, elem = 10;
    for (let i = 0; i <= 10; i++) {
      const v = t.skill(50 + i) | 0;
      if (v > best) { best = v; elem = i; }
    }
    if ((t.get(414) | 0) !== 0) elem = (t.get(414) | 0) - 1;
    t.set(174, elem);
    buff(g, t, 36, elem, 101);                                  // 附加属性（元素之拳专用）
    return { implemented: true, elem };
  };
  T[693] = (g, c, t) => {                                   // 一齐射击 329048
    if (morale(c) < 50) { say(g, '什么也没有发生……'); return { implemented: true, nothing: true }; }
    subMorale(c, 50);
    setV65(g, 193, 100);
    const hits = [];
    for (const o of (g.charas || [])) {
      if (!o || (o.get(0) | 0) !== 1 || o === c) continue;
      if (!sameSide(c, o) || (o.get(266) | 0) !== 1) continue;
      hostile(g, c.index === 0 ? null : c.index === 0 ? null : c);
      hits.push(o.index | 0);
    }
    setV65(g, 193, 0);
    return { implemented: true, hits };
  };
  T[696] = (g, c, t) => {                                   // 强制同行 338552
    if (v65(g, 20) === 35) return { implemented: true, nothing: true };
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    setV65(g, 64, 41);
    return { implemented: true, request: 'join' };
  };
  T[697] = (g, c) => (meleeLocked(g, c) ? { implemented: true, melee: true } : { implemented: true, nothing: true });
  T[699] = (g, c, t) => {                                   // 神气溢发 331345
    if ((c.index | 0) !== 0 && ((c.index | 0) < 16 || (c.get(58) | 0) === 100)) {
      recast(g, c, 732, t);
      return { implemented: true, recast: 732 };
    }
    const R = rndOf(g);
    if ((c.get(9) | 0) === 0) {                              // 中立 → 只打一发
      const d = (c.skill(11) | 0);
      dmg(g, t, d, c, 0, 0);
      return { implemented: true, dmg: d };
    }
    return { implemented: true, nothing: true, R };
  };
  T[700] = (g, c) => (meleeLocked(g, c) ? { implemented: true, melee: true } : { implemented: true, nothing: true });
  T[701] = (g, c, t) => {                                   // 爱抚之手 333938
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    // 0-FO：333956-334025 —— 牧场里对家畜/种畜 + 持有大型ブラシ 921 时是「梳理」：
    // 显示 407/408 特性、f[177] +1（上限 5）、modimp +10、cbit 1012 冷却。
    const Ranch = Elona.Ranch;
    if (Ranch && Ranch.isRanch && Ranch.isRanch(g)
      && Ranch.isLivestock && Ranch.isLivestock(g, t)) {
      const r = Ranch.brush(g, c, t);
      if (r.ok || r.reason === 'cooldown' || r.reason === 'no-brush') {
        return { implemented: true, brushed: r.ok, reason: r.reason || 'ok',
          genes: r.genes, brushCount: r.brushCount, message: r.message };
      }
    }
    // 非畜牧目标：原版 333940-334955 的普通「爱抚」表现（本项目的近似）
    if (guardJuA(g, t)) return { implemented: true, nothing: true };
    if (cbit(t, 1012)) return { implemented: true, already: true };
    t.set(79, 6 + 100 * 3);                                 // 行动模式：被爱抚
    t.set(177, 5);
    setCbit(t, 1012, 1);
    return { implemented: true, touched: true };
  };
  T[710] = (g, c, t) => {                                   // 緊抱 / 家畜搾乳 334957
    const Ranch = Elona.Ranch;
    if (!Ranch || !Ranch.milk) return { implemented: true, nothing: true };
    const r = Ranch.milk(g, c, t);
    return { implemented: true, milked: r.ok, reason: r.reason || 'ok',
      item: r.item || null, killed: !!r.killed, weakened: !!r.weakened, message: r.message };
  };
  T[708] = (g, c, t) => {                                   // 魂之一击 324734
    if (morale(c) < 100) { say(g, '什么也没有发生……'); return { implemented: true, nothing: true }; }
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((c.get(9) | 0) !== -3) return { implemented: true, nothing: true };
    if ((t.get(97) | 0) === 0) return { implemented: true, nothing: true };
    if ((t.get(96) | 0) === 0) return { implemented: true, nothing: true };
    const R = rndOf(g);
    const force = Math.max(1, idiv((c.skill(111) | 0) + 1, 2));
    const d = limit((c.get(184) | 0) + idiv(force + 1, 2), 2, 2500)
      * Math.sqrt(force) * Math.sqrt(Math.max(1, idiv(c.skill(152) | 0, 3))) + R(force + 1);
    dmg(g, t, d, c, 702, 0);
    if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 40));
    skillExp(c, 152, 400);
    skillExp(c, 106, 400);
    addMorale(c, 16);
    c.set(178, 1);
    return { implemented: true, dmg: d };
  };
  T[711] = (g, c, t) => {                                   // 扰乱 333679
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const bad = (t.index | 0) < 16 || (t.get(58) | 0) === 100 || (t.index | 0) === 0;
    const danger = v65(g, 22);
    const strong = (v65(g, 252) < 350) ? ((t.get(38) | 0) >= 130) : ((t.get(38) | 0) >= 50);
    if (!bad && !strong && v65(g, 273) !== 1) return { implemented: true, nothing: true };
    subMorale(c, 10);
    subMorale(t, 10);
    return { implemented: true, disturb: true };
  };
  T[712] = (g, c) => {                                      // 砍伐树木 333738-333790
    // 0-FZ：原先只看地图 cell[5]（那是地形，不是地面物品），也没有斧头判定与 rowact。
    //   现按源码交给 Camp.beginChop：脚下找树 → 找斧（234/1149/794）→
    //   回合数 limit(基础 - 伐採/8, 20, 100) → rowact 10 + var_65(91)=14。
    if ((c.index | 0) !== 0) return { implemented: true, nothing: true };
    if (!Elona.Camp || !Elona.Camp.beginChop) { say(g, '没有可砍伐的树木。'); return { implemented: true, nothing: true }; }
    const r = Elona.Camp.beginChop(g);
    if (!r.ok) {
      say(g, r.reason === 'no-axe' ? '你没有砍伐树木的工具。' : '没有可砍伐的树木。');
      return { implemented: true, nothing: true };
    }
    return { implemented: true, tree: r.tree, mode: 14, turns: r.turns };
  };
  T[714] = (g, c, t) => {                                   // 暴走 335446
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (hasBuff(t, 40)) return { implemented: true, nothing: true };
    buff(g, t, 40, (t.skill(14) | 0) + (t.skill(12) | 0) + (t.skill(15) | 0), 30);
    if ((t.get(264) | 0) === 0) {
      t.set(264, 30);
      say(g, `${nm(t)}狂暴化了。`);
    }
    if ((t.index | 0) === 0 && (t.get(254) | 0) === 0) {
      t.set(254, 5);
      say(g, `${nm(t)}陷入了混乱。`);
    }
    if ((t.get(7) | 0) === 739) t.set(7, 817);
    if ((t.get(7) | 0) === 579) t.set(7, 647);
    if ((t.get(7) | 0) === 864) {
      t.set(7, 865);
      if ((t.get(13) | 0) === 86) t.set(13, 87);
    }
    return { implemented: true, berserk: true };
  };
  T[715] = (g, c, t) => {                                   // 收束吐息 337276
    if (morale(c) < 100) { say(g, '什么也没有发生……'); return { implemented: true, nothing: true }; }
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((c.get(9) | 0) !== -3) return { implemented: true, nothing: true };
    const R = rndOf(g);
    const d = limit((c.get(184) | 0) + idiv((c.skill(16) | 0) + 5, 2), 2, 2500)
      * Math.sqrt(idiv(c.skill(11) | 0, 2) + 1) + R((c.skill(11) | 0) + 1);
    dmg(g, t, d, c, 702, 0);
    c.set(50, (c.get(50) | 0) + idiv(c.get(51) | 0, 3));
    return { implemented: true, dmg: d };
  };
  T[717] = (g, c) => {                                      // 零距离射击·突击型 322262
    if (cbit(c, 1016)) { const r = meleeLocked(g, c); if (r) return { implemented: true, melee: true }; }
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    skillExp(c, 189, 400); skillExp(c, 108, 400);
    skillExp(c, 110, 400); skillExp(c, 109, 400);
    setV65(g, 194, 1500);
    recast(g, c, 619, null);
    return { implemented: true, recast: 619 };
  };
  T[718] = (g, c, t) => {                                   // 魔仪迦 321528
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    const R = rndOf(g);
    const force = Math.max(1, idiv(c.skill(172) | 0, 2));
    const d = limit(idiv(force + 1, 2), 2, 2500) * Math.sqrt(force)
      * Math.sqrt(Math.max(1, idiv(c.skill(152) | 0, 3))) + R(force * 2 + 1);
    dmg(g, t, d, c, 702, 0);
    if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 30));
    healHp(c, idiv(d, 5));
    healMp(c, idiv(d, 5));
    return { implemented: true, dmg: d };
  };
  T[722] = (g, c, t) => {                                   // 共振音波 339881
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    subMorale(t, 50);
    skillExp(c, 156, 400);
    skillExp(c, 162, 400);
    skillExp(c, 156, limit(idiv((t.get(38) | 0) * (t.get(38) | 0), 10), 10, 1000));
    t.set(50, 0);
    dmg(g, t, 10, { get: () => 0, index: -31 }, 0, 0);
    return { implemented: true, sonic: true };
  };

  T[724] = (g, c, t) => {                                   // 灼热绘卷 321963
    const R = rndOf(g);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const d = (c.skill(11) | 0) * 2 + (c.skill(12) | 0) + R(20);
    dmg(g, t, d, c, 50, 1000);
    unbuff(t, 4);
    return { implemented: true, dmg: d };
  };
  T[725] = (g, c, t) => {                                   // 咒装豪身 336911
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}给自己施下了强烈的诅咒！`);
    let n = 0;
    for (const e of (t.inv || [])) {
      if (!e || !(e.id | 0)) continue;
      if ((e.cursed | 0) >= 1 && rndOf(g)(10)) continue;
      e.cursed = ((e.cursed | 0) === -1) ? -2 : -1;
      n++;
    }
    if (n > 0) {
      healHp(c, n * 666 + (c.skill(15) | 0));
      buff(g, c, 64, idiv((c.skill(15) | 0) * (24 + n), 4), 67);
      return { implemented: true, cursed: n };
    }
    say(g, '什么也没有发生……');
    return { implemented: true, nothing: true };
  };
  T[728] = (g, c, t) => {                                   // 精神破坏光 339669
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    const v16 = c.skill(16) | 0;
    const sc = Math.max(1, idiv(c.skill(152) | 0, 3));
    con(g, t, 7, 200);
    dmgSan(t, R(R(1 + idiv(v16, 20)) * 10 + 2) + 1, g);
    dmgMp(t, (idiv(v16, 10) + 1) * sc + R(10 + idiv(v16, 4)));
    if ((t.get(0) | 0) === 1) dmg(g, t, (idiv(v16, 10) + 1) * Math.sqrt(c.skill(15) | 0) * sc, c, 58, v16 + 100);
    if ((t.get(0) | 0) === 1) dmg(g, t, (idiv(v16, 10) + 1) * Math.sqrt(c.skill(15) | 0) * sc, c, 54, v16 + 100);
    if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 30));
    skillExp(c, 16, 200);
    return { implemented: true, mental: true };
  };
  T[729] = (g, c, t) => {                                   // 光辉之手 340005
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (cbit(c, 1017)) {                                     // 340024：光之手已展开 → 打击
      const R = rndOf(g);
      const force = Math.max(1, idiv(c.skill(16) | 0, 2));
      const d = limit((c.get(184) | 0) + idiv(force + 1, 2), 2, 2500) * Math.sqrt(force)
        * Math.sqrt(Math.max(1, idiv(c.skill(152) | 0, 3))) + R(force + 1);
      dmg(g, t, d, c, 702, 0);
      if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 30));
      skillExp(c, 15, 100); skillExp(c, 16, 100);
      return { implemented: true, dmg: d };
    }
    // 340065：恢复系（解除异常 + 回气力/HP/MP）
    for (const f of [445, 250, 251, 253, 252, 263, 256, 257, 258, 262, 259, 264, 267, 268, 412]) t.set(f, 0);
    t.set(269, 1);
    healSp(t, 100); healHp(t, 100); healMp(t, 100);
    return { implemented: true, heal: true };
  };
  T[730] = (g, c, t) => {                                   // 重力爆发 338686
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (g.map && g.map.setCellAttr) {
      const a = g.map.cell ? g.map.cell(t.x, t.y) : null;
      if (!a || (a[0] !== 701 && a[0] !== 671)) g.map.setCellAttr(t.x, t.y, 38);
    }
    t.set(262, (t.get(262) | 0) + 50);
    buff(g, t, 6, (c.skill(11) | 0) + 150, 5);
    const d = (c.skill(16) | 0);
    dmg(g, t, d, c, 702, 0);
    skillExp(c, 152, 400); skillExp(c, 164, 400);
    c.set(178, 1);
    return { implemented: true, dmg: d };
  };
  T[735] = (g, c, t) => {                                   // 超级旋转 322383
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    c._v1636 = 100;                                          // 322391：本次必定触发溢出判定
    if (v65(g, 801) === 0) setV65(g, 801, 2);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    say(g, `${nm(c)}把武器旋转着掷了出去！`);
    let force = c.skill(111) | 0;
    if (R((t.skill(187) | 0) + 1000) > R(4000) && !cbit(t, 985)) {
      say(g, `${nm(t)}挡下了${nm(c)}的攻击！`);
      force = idiv(limit(force * 2 - (t.skill(187) | 0), 2, 4000), 2);
    }
    const d = limit((c.get(184) | 0) + idiv(force + 1, 2), 2, 2500) * Math.sqrt(force)
      * Math.sqrt(Math.max(1, idiv(c.skill(152) | 0, 3))) + R(force + 1);
    dmg(g, t, d, c, 702, 0);
    if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 60));
    skillExp(c, 152, 400); skillExp(c, 111, 400);
    c.set(178, 1);
    return { implemented: true, dmg: d };
  };
  T[737] = (g, c) => {                                      // 迅雷脚 330973
    if (meleeLocked(g, c)) return { implemented: true, melee: true };
    recast(g, c, 619, null);
    return { implemented: true, recast: 619 };
  };
  T[738] = (g, c) => {                                      // 三振出局 327134
    if (meleeLocked(g, c)) {
      setV65(g, 175, 300);
      return { implemented: true, melee: true };
    }
    return { implemented: true, nothing: true };
  };
  T[739] = (g, c, t) => {                                   // 魅态攻击 334206
    if (!t || (t.get(0) | 0) !== 1 || t === c) return { implemented: true, nothing: true };
    con(g, t, 9, 75);                                       // 呕吐
    if (v65(g, 191) === 100) {
      if ((t.get(252) | 0) === -1) return { implemented: true, nothing: true };
      t.set(14, 0);
      t.set(15, v65(g, 13) + v65(g, 12) * 24 + v65(g, 11) * 24 * 30 + v65(g, 10) * 24 * 30 * 12 + 12);
      t.set(60, (t.get(60) | 0) + 20);
      if ((t.get(252) | 0) === 0) t.set(252, 1);
    }
    return { implemented: true, vomit: true };
  };
  T[740] = (g, c, t) => {                                   // 全军突击 328919
    if (morale(c) < 75) {
      if ((c.index | 0) === 0) say(g, '什么也没有发生……');
      return { implemented: true, nothing: true };
    }
    subMorale(c, 75);
    setV65(g, 193, 100);
    recast(g, c, 619, t);
    hostile(g, c, t);
    setV65(g, 193, 0);
    return { implemented: true, recast: 619 };
  };
  T[741] = (g, c, t) => {                                   // タッグフォース 333096-333130
    // `var_58(182)`（士气）不足 50 →「什么也没有发生……」
    if (morale(c) < 50) {
      if ((c.index | 0) === 0) say(g, '什么也没有发生……');
      return { implemented: true, nothing: true };
    }
    subMorale(c, 50);                                       // 333109
    // 333110：addbuff var_244, 42, 50, 51 —— 目标是**选中的同伴**
    //   buff 42 = タッグフォース（buffnames.json），p1 = 50（强度）/ p2 = 51（回合）
    const ally = (t && (t.get(0) | 0) === 1) ? t : null;
    if (ally) buff(g, ally, 42, 50, 51);
    // 333111-333113：有搭档（var_58(167) > 0）时回复自身
    //   `healhp 0, 最大HP * (var_58(182) + 40) / 200`（用的是扣完 50 之后的值）
    if ((c.get(167) | 0) > 0) {
      healHp(c, idiv((c.get(51) | 0) * (morale(c) + 40), 200));
    }
    if ((c.index | 0) === 0) {
      const an = (Elona.Spell && Elona.Spell.actionName) ? Elona.Spell.actionName(741) : null;
      say(g, `*${(an && (an.ch || an.jp || an.en)) || '羁绊之力'}*`);
    }
    return { implemented: true, buff: ally ? 42 : 0, morale: morale(c) };
  };
  T[744] = (g, c, t) => {                                   // 一起上路 333077
    const R = rndOf(g);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}拉着${nm(t)}一起自爆了。`);
    const d = (idiv(c.skill(16) | 0, 5) + 5) * (idiv((c.skill(16) | 0) + 1, 5) + 5)
      + R((c.skill(11) | 0) * 2 + 5)
      + (limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
      * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 30;
    dmg(g, t, d, c, 64, 1000);
    if ((c.index | 0) !== 0) c.set(50, 0);                   // 333086：var_243 != 0 才清空
    if ((c.get(50) | 0) === 0) dmg(g, c, 99999, null, 0, 0);
    return { implemented: true, suicide: true, dmg: d };
  };
  T[746] = (g, c, t) => {                                   // 多重咏唱魔法 329130
    if (hasBuff(c, 2)) { say(g, '沉默之雾阻止了魔力的发生。'); return { implemented: true, silenced: true }; }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (!hasBuff(t, 2)) return { implemented: true, nothing: true };
    // 329170：对沉默中的同伴 —— 每回合 5 点斗志，MP 上限 1/10
    addMorale(t, 5);
    t.set(55, (t.get(55) | 0) - (idiv(t.get(56) | 0, 10) + 1));
    return { implemented: true, support: true };
  };
  T[747] = (g, c, t) => {                                   // 碎地 327024
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    say(g, `${nm(c)}击碎了地面！`);
    const d = (idiv(c.skill(10) | 0, 5) + 5) * (idiv((c.skill(10) | 0) + 1, 5) + 5)
      + R((c.skill(10) | 0) * 2 + 5)
      + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
        * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 2);
    dmg(g, t, d, c, 64, 1000);
    if ((t.get(175) | 0) <= 0) {
      t.set(175, 1 + R(5));
      say(g, `${nm(t)}胆怯了。`);
    }
    return { implemented: true, dmg: d };
  };
  T[749] = (g, c, t) => {                                   // 盾击 324615
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((c.get(96) | 0) !== 1) return { implemented: true, nothing: true };   // 没拿盾
    if (Elona.Battle && Elona.Battle.attackSeq) Elona.Battle.attackSeq(g, c, t);
    return { implemented: true, melee: true };
  };
  // 炼成雨 328514-328596：消耗一瓶药水，对视野内**自己与同伴**按 90% 强度各用一次
  //   （射程 var_83(3,656)/1000+1、要有视线、非精油/挥发油则濡湿 25）。
  //   药水由 `g.potionChoice` 指定；未指定时取背包里第一瓶可用药水（见 core/potion.js 的差异说明）。
  T[751] = (g, c) => {
    const P = Elona.Potion;
    if (!P || !P.rain) return { implemented: false, reason: 'no-potion-module' };
    // 328519-328522：玩家发动时弹「使用するポーションは？」（var_486 = 23, 11）
    //   → 交给 UI 打开只列可用药水的选择窗；选中后由 Panels.openPotionPick 调 P.rain
    if ((c.index | 0) === 0 && !(g && g.potionChoice)) {
      return { implemented: true, request: 'potion-pick', kind: 'rain', noTurn: true };
    }
    const r = P.rain(g, c, (g && g.potionChoice) || null);
    for (const m of (r.messages || [])) say(g, m);
    if (r.message) say(g, r.message);
    if (!r.ok) return { implemented: true, nothing: true, reason: r.reason };
    return { implemented: true, rain: r.targets.length, targets: r.targets, item: r.item };
  };
  T[752] = (g, c, t) => ({ implemented: true, request: 'gather', target: t });  // 强制集合 338511
  T[753] = (g, c, t) => {                                   // 心灵波动 329986
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmgSan(t, Math.max(1, idiv(c.skill(17) | 0, 5)), g);
    return { implemented: true, san: true };
  };
  T[755] = (g, c, t) => {                                   // 闪耀投掷 323985
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    addMorale(c, 5);
    const R = rndOf(g);
    const d = (idiv(c.skill(15) | 0, 5) + 5) * (idiv((c.skill(111) | 0) + 1, 5) + 5)
      + R((c.skill(111) | 0) * 2 + 5)
      + (limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
      * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 30;
    dmg(g, t, d, c, 64, 1000);
    return { implemented: true, dmg: d, R };
  };
  // 328299 魔杖复制 / 328177 暴力开锁：源码在 var_243 != 0 时直接结束，
  //   玩家侧走的是道具栏 UI（不在本分派里），故此处等价于无事。
  T[756] = (g) => ({ implemented: true, nothing: true, flag: v65(g, 560) });
  T[757] = () => ({ implemented: true, nothing: true });
  T[760] = (g, c) => {                                      // 舍身攻击 330948
    if (meleeLocked(g, c)) {
      subMorale(c, 25);
      recast(g, c, 619, null);
      return { implemented: true, melee: true };
    }
    return { implemented: true, nothing: true };
  };
  T[768] = (g, c) => {                                      // 温戴尔柔术 328326
    if (cbit(c, 1028)) {
      setCbit(c, 1028, 0);
      say(g, `${nm(c)}调整呼吸，改变了架势。`);
      return { implemented: true, stance: 0 };
    }
    setCbit(c, 1028, 1);
    say(g, `${nm(c)}调整呼吸，改变了架势。`);
    return { implemented: true, stance: 1 };
  };
  T[770] = (g, c, t) => {                                   // 舞动的钢弦 338446
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}用钢丝缠住了${nm(t)}。`);
    if ((t.get(268) | 0) < 3) t.set(268, 3);
    recast(g, c, 620, t);
    return { implemented: true, bind: 3 };
  };
  T[771] = (g, c, t) => {                                   // 僵直凝视 339579
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    if (visible(g, t)) say(g, `${nm(c)}向${nm(t)}放出妖异的目光。`);
    dmg(g, t, (idiv(c.skill(16) | 0, 5) + 5) * (idiv((c.skill(15) | 0) + 1, 5) + 5)
      + R((c.skill(15) | 0) * 2 + 5)
      + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
        * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 2), c, 58, (c.skill(16) | 0) * 2 + 100);
    if ((t.get(268) | 0) < 3) t.set(268, 3);
    t.set(179, -3);
    if (visible(g, t)) say(g, `${nm(t)}的身体像石头一样僵住了。`);
    vampire(g, c, t);
    if (rage(g, c, t, 728)) return { implemented: true, recast: 728 };
    return { implemented: true, paralyze: true };
  };
  T[772] = (g, c, t) => {                                   // 幻惑凝视 339500
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    if (visible(g, t)) say(g, `${nm(c)}让${nm(t)}看到了幻影。`);
    dmg(g, t, (idiv(c.skill(16) | 0, 5) + 5) * (idiv((c.skill(15) | 0) + 1, 5) + 5)
      + R((c.skill(15) | 0) * 2 + 5)
      + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
        * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 2), c, 54, (c.skill(16) | 0) * 2 + 100);
    vampire(g, c, t);
    if (rage(g, c, t, 728)) return { implemented: true, recast: 728 };
    return { implemented: true, dmg: true };
  };
  T[775] = (g, c, t) => {                                   // 化为材料 321818
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(50) | 0) > idiv(t.get(51) | 0, 8)) return { implemented: true, nothing: true };
    setV65(g, 809, 2);
    dmg(g, t, t.get(51) | 0, c, 658, 0);
    return { implemented: true, execute: true };
  };
  T[776] = (g, c, t) => {                                   // 可怕的笑脸 335578
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmgSan(t, 50, g);
    return { implemented: true, san: true };
  };
  T[777] = (g, c, t) => {                                   // 微笑力场 335654
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    healHp(t, 50);
    return { implemented: true, heal: true };
  };
  T[778] = (g, c, t) => {                                   // 瞳孔里的深渊 335622
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmgSan(t, 100, g);
    con(g, t, 7, 200);
    return { implemented: true, san: true };
  };
  T[780] = (g, c, t) => {                                   // 炮弹发射 322139
    // 322140-322155：斗志 <25 时优先改打近接；没有目标则走 *label_2840 选目标
    if (morale(c) < 25) {
      if (cbit(c, 1016) && meleeLocked(g, c)) return { implemented: true, melee: true };
      if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true, needTarget: true };
    }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}发射了特殊炮弹。`);
    subMorale(c, 25);
    t.set(179, 2);                                           // 322172 硬直
    const R = rndOf(g);
    const d = (idiv(c.skill(13) | 0, 5) + 5) * (idiv((c.skill(189) | 0) + 1, 5) + 5)
      + R((c.skill(189) | 0) * 2 + 5)
      + (limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
      * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 30;
    dmg(g, t, d, c, 64, 1000);
    return { implemented: true, shot: true, dmg: d };
  };
  T[781] = (g, c, t) => {                                   // 核射击 322178
    say(g, `${nm(c)}发射了核炮弹。`);
    if (morale(c) < 25) {
      if (cbit(c, 1016) && meleeLocked(g, c)) {
        subMorale(c, 25);
        return { implemented: true, melee: true };
      }
      if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    subMorale(c, 25);
    if (g.map && g.map.setCellAttr) g.map.setCellAttr(t.x, t.y, 37);
    dmg(g, t, c.skill(16) | 0, c, 64, 1000);
    return { implemented: true, shot: true };
  };
  T[782] = (g, c, t) => {                                   // 通货风暴 326966
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const gold = Math.min(c.get(20) | 0, 100000);
    c.set(20, (c.get(20) | 0) - gold);
    dmg(g, t, Math.max(1, idiv(gold, 100)), c, 0, 0);
    return { implemented: true, gold };
  };
  T[784] = (g, c, t) => {                                   // 超重压杀 331153
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const d = (c.get(184) | 0) + (c.skill(11) | 0);
    dmg(g, t, d, c, 68, 1000);
    return { implemented: true, dmg: d };
  };
  T[785] = (g, c, t) => {                                   // 烈走破 335383
    if ((c.index | 0) === 0 && v65(g, 183) === 0) {
      say(g, '什么也没有发生……');
      return { implemented: true, nothing: true };
    }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    buff(g, t, 53, 30, 30);
    return { implemented: true, buff: 53 };
  };
  T[786] = (g, c, t) => {                                   // 暴虐的庭园 335978
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    addMorale(t, 10);
    return { implemented: true, morale: true };
  };
  T[791] = (g, c, t) => {                                   // 超认知 318870
    if ((c.index | 0) !== 0) return { implemented: true, nothing: true };
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `你调查了${nm(t)}的状态。`);
    return { implemented: true, request: 'examine', target: t };
  };
  T[792] = (g, c, t) => {                                   // 溶解之握 334330
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(268) | 0) < 1) t.set(268, 1);
    if ((t.get(267) | 0) < 1) t.set(267, 1);
    if ((c.get(268) | 0) < 2) c.set(268, 2);
    say(g, `${nm(c)}缠住${nm(t)}并开始溶解。`);
    const d = (c.skill(10) | 0) * 2 + (c.skill(11) | 0) * 2 + rndOf(g)((c.skill(10) | 0) + 10);
    dmg(g, t, d, c, 63, 1000);
    return { implemented: true, dmg: d };
  };
  T[793] = (g, c, t) => {                                   // 无形枷锁 334362
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(268) | 0) < 5) t.set(268, 5);
    return { implemented: true, bind: 5 };
  };
  T[794] = (g, c, t) => {                                   // 鲜血投刃 329518
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((c.get(258) | 0) < 100) c.set(258, (c.get(258) | 0) + 8);   // 出血
    const d = (c.skill(15) | 0);
    dmg(g, t, d, c, 64, 1000);
    return { implemented: true, dmg: d };
  };
  T[795] = (g, c, t) => {                                   // 愤怒的爆炎 336612
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(11) | 0) * 2, c, 50, 1000);
    con(g, t, 5, 200);
    return { implemented: true, fire: true };
  };
  T[796] = (g, c, t) => {                                   // 重冲击止动弹 323473
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const d = limit((c.get(184) | 0) + idiv((c.skill(111) | 0) + 1, 2), 2, 2500);
    dmg(g, t, d, c, 702, 0);
    t.set(434, 2);                                           // 击倒
    skillExp(c, 189, 400); skillExp(c, 110, 400);
    c.set(178, 1);
    return { implemented: true, dmg: d };
  };
  T[797] = (g, c, t) => {                                   // 定点连弹枪 323603
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, limit((c.get(184) | 0) + idiv((c.skill(111) | 0) + 1, 2), 2, 2500), c, 702, 0);
    t.set(179, 3);                                           // 硬直
    skillExp(c, 189, 400); skillExp(c, 110, 400);
    c.set(178, 1);
    return { implemented: true, stun: true };
  };
  T[798] = (g, c, t) => {                                   // 临界粒子炮 323728
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (sameSide(c, t)) return { implemented: true, nothing: true };
    dmg(g, t, limit((c.get(184) | 0) + idiv((c.skill(111) | 0) + 1, 2), 2, 2500), c, 702, 0);
    t.set(253, 2);
    skillExp(c, 189, 400); skillExp(c, 110, 400);
    c.set(178, 1);
    return { implemented: true, dmg: true };
  };
  T[799] = (g, c, t) => {                                   // 贯盔 323198
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, limit((c.get(184) | 0) + idiv((c.skill(109) | 0) + 1, 2), 2, 2500), c, 702, 0);
    if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 30));
    t.set(252, 2);
    skillExp(c, 189, 400); skillExp(c, 109, 400);
    c.set(178, 1);
    return { implemented: true, dmg: true };
  };
  T[800] = (g, c, t) => {                                   // 箭如飞瀑 323034
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (sameSide(c, t)) return { implemented: true, nothing: true };
    const hits = [];
    for (const o of (g.charas || [])) {
      if (!o || (o.get(0) | 0) !== 1) continue;
      if (o === c || sameSide(c, o)) continue;
      if (Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) > 4) continue;
      dmg(g, o, limit((c.get(184) | 0) + idiv((c.skill(108) | 0) + 1, 2), 2, 2500), c, 702, 0);
      o.set(175, 2);
      hits.push(o.index | 0);
    }
    skillExp(c, 189, 400); skillExp(c, 108, 400);
    c.set(178, 1);
    return { implemented: true, hits };
  };
  T[801] = (g, c, t) => {                                   // 地狱的责罚 336227
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(268) | 0) === 0) {
      t.set(268, (t.get(268) | 0) + 1);
      if (visible(g, t)) say(g, `${nm(t)}被束缚了。`);
    }
    say(g, `${nm(c)}拷问了${nm(t)}！`);
    const R = rndOf(g);
    const d = idiv((idiv(c.skill(11) | 0, 5) + 5) * (idiv((c.skill(15) | 0) + 1, 5) + 5)
      + R((c.skill(11) | 0) * 2 + 5)
      + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
        * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 2), 4);
    for (let i = 0; i < 4; i++) {
      dmg(g, t, d, c, 56, 1000);
      if ((t.get(0) | 0) !== 1) break;
    }
    if ((t.get(0) | 0) === 1
      && R((c.skill(11) | 0) + (c.skill(15) | 0)) >= R((t.skill(11) | 0) + (t.skill(15) | 0))) {
      say(g, `${nm(t)}在拷问下屈服了。`);
      subMorale(t, 15);
    }
    return { implemented: true, torture: true };
  };
  T[802] = (g, c, t) => {                                   // *胜利* 336216
    if (v65(g, 273) !== 5) return { implemented: true, nothing: true };
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    t.set(50, 0);
    dmg(g, t, 100, c, 0, 0);
    return { implemented: true, execute: true };
  };
  T[806] = (g, c, t) => {                                   // 神经支配之线 338377
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    say(g, `${nm(c)}把丝线打进了${nm(t)}的身体。`);
    if (g.map && g.map.cellFeat && v65(g, 85) === 2) {
      g.map.cellFeat(t.x, t.y, { id: 14, arg: 20, owner: c.index | 0 });
    }
    setV65(g, 193, 4771);
    const d = (idiv(c.skill(13) | 0, 5) + 5) * (idiv((c.skill(151) | 0) + 1, 5) + 5)
      + R((c.skill(151) | 0) * 2 + 5)
      + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
        * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 3);
    // 0-GH：斩杀要把「已生成肉人偶」的标记写进死亡结算，所以先延后结算
    const hasFD = !!(Elona.FleshDoll && Elona.FleshDoll.finish);
    dmg(g, t, d, c, 58, (c.skill(13) | 0) + 200, hasFD ? { deferDeath: true } : undefined);
    setV65(g, 193, 0);
    // 0-EZ / 338396-338443：濒死时触发斩杀，按条件生成肉人偶（Rank10 尸体料理）
    const fd = hasFD ? Elona.FleshDoll.finish(g, c, t)
      : (Elona.FleshDoll ? Elona.FleshDoll.execute(g, c, t) : null);
    return { implemented: true, dmg: d, fleshDoll: fd || undefined };
  };
  T[807] = (g, c, t) => {                                   // 标记 337666
    if ((c.get(446) | 0) < 10000) { say(g, '什么也没有发生……'); return { implemented: true, nothing: true }; }
    c.set(446, 5000);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, mark: true };
    t.set(264, (t.get(264) | 0) + 3);
    t.set(259, (t.get(259) | 0) + 3);
    return { implemented: true, mark: true };
  };
  T[808] = (g, c, t) => ({ implemented: true, finale: !!(t && (t.get(0) | 0) === 1) });  // 大结局 336710
  T[809] = (g, c, t) => {                                   // 消除记忆 339788
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((c.get(27) | 0) === 822) t.set(182, 0);
    hostile(g, c, t);
    return { implemented: true, forget: true };
  };
  T[811] = (g, c, t) => {                                   // 死神舞步 335413
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    buff(g, t, 58, 13, 13);
    return { implemented: true, buff: 58 };
  };
  T[812] = (g, c, t) => {                                   // 斩首 321749
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const rec = (Elona.CharaFactory && Elona.CharaFactory.ref)
      ? (Elona.CharaFactory.ref(c.get(27) | 0) || {}) : {};
    const div = 8 - ((rec.id === 'farmer') ? 1 : 0);         // 321752：farmer 上位职业加成
    if ((t.get(50) | 0) > idiv(t.get(51) | 0, div)) return { implemented: true, nothing: true };
    setV65(g, 809, 2);
    dmg(g, t, t.get(51) | 0, c, 658, 0);
    return { implemented: true, execute: true };
  };
  T[813] = (g, c, t) => {                                   // 引发过敏 336040
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    con(g, t, 22, 200);
    con(g, t, 23, 200);
    return { implemented: true, cond: 22 };
  };
  T[814] = (g, c, t) => {                                   // 危险食谱 328601
    if ((c.index | 0) !== 0) { say(g, '什么也没有发生……'); return { implemented: true, nothing: true }; }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    hostile(g, c, t);
    con(g, t, 9, 100);                                      // 呕吐
    return { implemented: true, food: true };
  };
  T[815] = (g, c, t) => {                                   // 蚀骨剧毒 336126
    if (morale(c) < 25) { say(g, '什么也没有发生……'); return { implemented: true, nothing: true }; }
    subMorale(c, 25);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (sameSide(c, t)) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(16) | 0), c, 64, 1000);
    if ((t.get(25) | 0) > 3 || (t.get(27) | 0) === 534) {
      t.set(250, 2);
      t.set(250, (t.get(250) | 0) + 10);
    }
    skillExp(c, 151, 50);
    return { implemented: true, poison: true };
  };
  T[816] = (g, c, t) => {                                   // 全力说服 333791
    // 0-GC：5 回合 rowact 19（*label_2921），每回合 `rnd(意志+説得)` 对抗。
    //   玩家与 NPC 都走同一条路（AI 每回合用 Actions.tickChara 推进）。
    if (Elona.Social) {
      const r = Elona.Social.begin(g, 19, c);
      return r.ok ? { implemented: true, rowact: 19 } : { implemented: true, nothing: true };
    }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    subMorale(t, 10);
    return { implemented: true, persuade: true };
  };
  T[817] = (g, c, t) => {                                   // 搞笑绝活 308724
    if (Elona.Social) {
      const r = Elona.Social.begin(g, 20, c);
      return r.ok ? { implemented: true, rowact: 20 } : { implemented: true, nothing: true };
    }
    return T[816](g, c, t);
  };
  T[818] = (g, c, t) => {                                   // 信口开河 308962
    if (Elona.Social) {
      const r = Elona.Social.begin(g, 21, c);
      return r.ok ? { implemented: true, rowact: 21 } : { implemented: true, nothing: true };
    }
    return T[816](g, c, t);
  };
  T[819] = (g, c, t) => {                                   // 胁迫地狱 309224
    if (Elona.Social) {
      const r = Elona.Social.begin(g, 22, c);
      return r.ok ? { implemented: true, rowact: 22 } : { implemented: true, nothing: true };
    }
    return T[816](g, c, t);
  };
  T[820] = (g, c, t) => {                                   // 魔唱 309486
    if (Elona.Social) {
      const r = Elona.Social.begin(g, 23, c);
      return r.ok ? { implemented: true, rowact: 23 } : { implemented: true, nothing: true };
    }
    return T[816](g, c, t);
  };
  T[821] = (g, c, t) => {                                   // 快活乐园 336752
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    addMorale(t, 10);
    healHp(t, 20);
    return { implemented: true, cheer: true };
  };
  T[822] = (g, c, t) => {                                   // 一投入魂 330489
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (hasBuff(t, 62)) { unbuff(t, 62); return { implemented: true, toggle: 0 }; }
    buff(g, t, 62, 25, 25);
    return { implemented: true, toggle: 1 };
  };
  T[823] = (g, c, t) => {                                   // 乱骰一气 336321
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    dmg(g, t, 1 + R(6) + R(6), c, 0, 0);
    return { implemented: true, dice: true };
  };
  T[824] = (g, c, t) => {                                   // 腐蚀烈风 323893
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}乘风放出了酸液！`);
    const d = (c.skill(10) | 0) + (c.skill(111) | 0);
    dmg(g, t, d, c, 63, 1000);
    t.set(250, (t.get(250) | 0) + 5);
    return { implemented: true, acid: true };
  };
  T[825] = (g, c, t) => {                                   // 神威 336454
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(16) | 0) * 2, c, 54, 1000);
    return { implemented: true, dmg: true };
  };
  // 液体操纵弹 328350-328454：消耗一瓶药水，对视野内**敌人**先打一段 PVDV 伤害，
  //   再按 90% 强度用药水（射程与视线同上；非精油/挥发油则濡湿 25）。
  T[826] = (g, c) => {
    const P = Elona.Potion;
    if (!P || !P.spray) return { implemented: false, reason: 'no-potion-module' };
    // 328355 附近：与炼成雨相同，先选药水
    if ((c.index | 0) === 0 && !(g && g.potionChoice)) {
      return { implemented: true, request: 'potion-pick', kind: 'spray', noTurn: true };
    }
    const r = P.spray(g, c, (g && g.potionChoice) || null);
    for (const m of (r.messages || [])) say(g, m);
    if (r.message) say(g, r.message);
    if (!r.ok) return { implemented: true, nothing: true, reason: r.reason };
    return { implemented: true, spray: r.targets.length, targets: r.targets, item: r.item };
  };
  T[827] = (g, c, t) => {                                   // 数据扫描 330437
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(58) | 0) === 0) {
      say(g, `${nm(t)}反过来分析了正在被分析的自己，改变了动作。`);
      t.set(31, 0);
      return { implemented: true, analyze: true };
    }
    if (hasBuff(t, 63)) { unbuff(t, 63); setV65(g, 669, 0); return { implemented: true, toggle: 0 }; }
    buff(g, t, 63, 20, 20);
    setV65(g, 669, (t.index | 0) + 1);
    return { implemented: true, toggle: 1 };
  };
  T[828] = (g, c, t) => {                                   // 高度咏唱阵 330419
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    buff(g, t, 32, 400, 5);
    return { implemented: true, buff: 32 };
  };
  T[829] = (g, c, t) => {                                   // 渗出的疯狂 329938
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmgSan(t, 100, g);
    return { implemented: true, san: true };
  };
  T[830] = (g, c, t) => {                                   // 认真乞讨 330872
    if ((c.index | 0) !== 0) return { implemented: true, nothing: true };
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const gold = Math.min(t.get(20) | 0, 50);
    t.set(20, (t.get(20) | 0) - gold);
    c.set(20, (c.get(20) | 0) + gold);
    return { implemented: true, gold };
  };
  T[832] = (g, c, t) => {                                   // 磁化 334838
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (cbit(t, 1030)) {
      say(g, `${nm(t)}的磁力消失了……`);
      setCbit(t, 1029, 0); setCbit(t, 1030, 0);
      return { implemented: true, magnet: 0 };
    }
    if (!cbit(t, 1029)) { setCbit(t, 1029, 1); setCbit(t, 1030, 0); return { implemented: true, magnet: 1 }; }
    setCbit(t, 1029, 0); setCbit(t, 1030, 1);
    return { implemented: true, magnet: 2 };
  };
  T[833] = (g, c, t) => {                                   // 质量发射器 328445
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const d = (c.skill(16) | 0) + (c.get(184) | 0);
    if (cbit(c, 1029) || cbit(c, 1030)) dmg(g, t, d * 2, c, 64, 1000);
    dmg(g, t, d, c, 64, 1000);
    return { implemented: true, dmg: d };
  };
  T[834] = (g, c, t) => {                                   // 电磁狱 334563
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(16) | 0), c, 64, 1000);
    if ((t.get(268) | 0) < 3) t.set(268, 3);
    return { implemented: true, shock: true };
  };
  T[835] = (g, c, t) => {                                   // 超电磁龙卷 324121
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}放出了电磁龙卷！`);
    const d = (c.skill(16) | 0) + (c.get(184) | 0);
    if (cbit(t, 1029) || cbit(t, 1030)) {
      if ((t.get(268) | 0) === 0) t.set(268, 5);
      dmg(g, t, d, c, 64, 1000);
    }
    if ((t.get(268) | 0) === 0) t.set(268, 3);
    dmg(g, t, (c.skill(16) | 0), c, 64, 1000);
    if (!cbit(t, 1030)) { setCbit(t, 1029, 0); setCbit(t, 1030, 1); }
    return { implemented: true, dmg: d };
  };
  T[836] = (g, c, t) => {                                   // 弦葬世界 334743
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(13) | 0) * 2, c, 64, 1000);
    return { implemented: true, dmg: true };
  };
  T[838] = (g, c, t) => {                                   // 岩锁压碎 334656
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(11) | 0) * 2 + (c.get(184) | 0), c, 68, 1000);
    if ((t.get(268) | 0) < 2) t.set(268, 2);
    return { implemented: true, dmg: true };
  };
  T[839] = (g, c, t) => {                                   // 土龙斗气 330510
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (g.map && g.map.setCellAttr) g.map.setCellAttr(t.x, t.y, 12);
    t.set(55, (t.get(55) | 0) - idiv(t.get(56) | 0, 2));
    buff(g, t, 66, limit((t.skill(11) | 0) * 3, 0, 1200), 50);
    return { implemented: true, buff: 66 };
  };
  T[840] = (g, c) => {                                      // 个别指导 338874
    if ((c.get(60) | 0) >= 100) { say(g, '没有指导他人的余裕。'); return { implemented: true, nothing: true }; }
    return { implemented: true, request: 'teach' };
  };
  T[841] = (g, c, t) => {                                   // 强烈花粉炮 335709
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}喷出了强烈的花粉！`);
    if ((t.index | 0) === 0) say(g, '咕哇啊啊啊啊啊！！！');
    hostile(g, c, t);
    const R = rndOf(g);
    const p = (c.get(38) | 0) * 2;
    for (const cond of [22, 23, 4, 3, 5, 7, 1]) con(g, t, cond, R(p + 1));
    return { implemented: true, pollen: true };
  };
  T[842] = (g, c, t) => {                                   // 姐姐凝视 338926
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const sisters = [1066, 1014, 676, 493, 364, 363, 361];
    if (sisters.indexOf(t.get(27) | 0) >= 0) {
      say(g, `${nm(c)}的目光被${nm(t)}的姐姐波动挡下了！`);
      return { implemented: true, blocked: true };
    }
    vampire(g, c, t);
    if (rage(g, c, t, 728)) return { implemented: true, recast: 728 };
    return { implemented: true, glare: true };
  };
  T[843] = (g, c, t) => {                                   // 直接输血 330810
    if ((c.index | 0) === 0) { say(g, '首先要选择输血源。'); return { implemented: true, request: 'transfuse' }; }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    con(g, t, 9, idiv(c.skill(151) | 0, 2) + 1);
    hostile(g, c, t);
    return { implemented: true, transfuse: true };
  };
  T[844] = (g, c, t) => {                                   // 电流驱使 337718
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    const R = rndOf(g);
    if ((t.get(9) | 0) === -3 || (c.get(9) | 0) === -3) {
      const d = idiv((idiv(c.skill(12) | 0, 5) + 5) * (idiv((c.skill(151) | 0) + 1, 5) + 5)
        + R((c.skill(151) | 0) * 2 + 5)
        + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
          * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 2), 4);
      dmg(g, t, d, c, 52, 1000 + (c.skill(151) | 0));
    } else {
      t.set(263, idiv(t.get(263) | 0, 2));
      t.set(256, 59);
      t.set(251, 0);
    }
    skillExp(c, 151, 40);
    return { implemented: true, shock: true };
  };
  T[845] = (g, c, t) => {                                   // 神速缝合 338167
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(9) | 0) === -3 || (c.get(9) | 0) === -3) t.set(268, 10);
    else t.set(258, idiv(t.get(258) | 0, 2));
    skillExp(c, 177, 40);
    return { implemented: true, suture: true };
  };
  T[846] = (g, c) => {                                      // 摆出架势 337072
    say(g, `${nm(c)}自信满满地摆出了决胜姿势！`);
    addMorale(c, 15);
    let v = (c.get(60) | 0) - 15;
    if (v <= 100 && v >= 85) v = 0;
    if (v < 0) v = 0;
    c.set(60, v);
    return { implemented: true, pose: true };
  };
  T[847] = (g, c, t) => {                                   // 鲨式交易 337100
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    say(g, `${nm(c)}向${nm(t)}提出了鲨鱼交易！`);
    subMorale(t, 20);
    addMorale(c, 20);
    return { implemented: true, trade: true };
  };
  T[848] = () => ({ implemented: true, request: 'reconstruct' });   // 构造改变 328803
  T[849] = (g, c, t) => {                                   // 爆栓连发 323338
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, limit((c.get(184) | 0) + idiv((c.skill(189) | 0) + 1, 2), 2, 2500), c, 702, 0);
    if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 30));
    skillExp(c, 189, 400);
    c.set(178, 1);
    return { implemented: true, dmg: true };
  };
  T[850] = (g, c, t) => {                                   // <能力限制> 337767
    if (v65(g, 6) === 1) return { implemented: true, nothing: true };
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    t.set(182, 0);
    t.set(84, 0);
    t.set(50, t.get(51) | 0);
    t.set(55, t.get(56) | 0);
    t.set(52, t.get(53) | 0);
    return { implemented: true, restore: true };
  };
  T[851] = (g, c, t) => {                                   // <限制解除> 337818
    if (v65(g, 6) === 1) return { implemented: true, nothing: true };
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (g.map && g.map.setCellAttr) g.map.setCellAttr(t.x, t.y, 12);
    t.set(84, 0);
    healSp(t, idiv(t.get(53) | 0, 2));
    healHp(t, idiv(t.get(51) | 0, 2));
    healMp(t, idiv(t.get(56) | 0, 2));
    const pw = 200 + rndOf(g)(100);
    for (const id of [1, 31, 4, 30, 10]) buff(g, t, id, pw, 200);
    return { implemented: true, unleash: true };
  };
  // 322017 阴影跳跃 / 322083 阴影跳行：位移技，落点由 *label_2670 选格后在移动侧结算
  T[852] = () => ({ implemented: true, request: 'shadow', target: null });
  T[853] = () => ({ implemented: true, request: 'shadow', target: null });
  T[855] = (g, c, t) => {                                   // 神填之杖 321386
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (morale(c) < 100) return { implemented: true, nothing: true };
    subMorale(c, 100);
    skillExp(c, 174, 400);
    const R = rndOf(g);
    const force = Math.max(1, idiv(c.skill(111) | 0, 2));
    dmg(g, t, limit(idiv(force + 1, 2), 2, 2500) * Math.sqrt(force)
      * Math.sqrt(Math.max(1, idiv(c.skill(152) | 0, 3))) + R(force * 2 + 1), c, 702, 0);
    if ((t.get(0) | 0) === 1) t.set(60, Math.min(120, (t.get(60) | 0) + 30));
    return { implemented: true, dmg: true };
  };
  T[856] = (g, c, t) => {                                   // 飞跳杀法 330336
    // 0-GC：5 回合 rowact 30（*label_2918）：跳起 → 落地时对 5 格内目标重击
    if (Elona.Social) {
      const r = Elona.Social.beginLeap(g, 30, c);
      return r.ok ? { implemented: true, rowact: 30 } : { implemented: true, nothing: true };
    }
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (Elona.Battle && Elona.Battle.attackSeq) Elona.Battle.attackSeq(g, c, t);
    return { implemented: true, melee: true };
  };
  T[857] = (g, c, t) => {                                   // 奇袭穿孔 330385
    // 0-GC：10 回合 rowact 31（*label_2919）：潜入地下 → 破土奇袭
    if (Elona.Social) {
      const r = Elona.Social.beginLeap(g, 31, c);
      return r.ok ? { implemented: true, rowact: 31 } : { implemented: true, nothing: true };
    }
    return T[856](g, c, t);
  };
  T[858] = (g, c, t) => {                                   // 圣者光刃 338132
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((c.index | 0) === 0 && (c.get(49) | 0) < 1) {
      say(g, '什么也没有发生……看来你的业力太低了。');
      return { implemented: true, nothing: true };
    }
    const d = (c.skill(16) | 0) * 2 + (c.get(184) | 0);
    dmg(g, t, d, c, 64, 1000);
    skillExp(c, 181, 50);
    return { implemented: true, dmg: d };
  };
  T[859] = (g, c, t) => {                                   // 净化波动 338063
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    for (const id of [4, 5, 7, 9]) unbuff(t, id);
    return { implemented: true, purify: true };
  };
  T[860] = (g, c, t) => {                                   // 天使光环 338010
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    healHp(t, 100);
    buff(g, t, 31, 100, 20);
    return { implemented: true, halo: true };
  };
  T[861] = (g, c, t) => {                                   // 惩罚之光 337920
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(16) | 0) * 2, c, 58, 1000);
    return { implemented: true, dmg: true };
  };
  // 862/863（式折神·幻惑折鹤 / 荒纸手里剑）在源码 331595-331602 里只是
  //   `var_1303++` 的空分支 —— 照抄为空操作，不再借用 856 的近接。
  T[862] = () => ({ implemented: true, nothing: true, emptyBranch: true });
  T[863] = () => ({ implemented: true, nothing: true, emptyBranch: true });
  T[864] = (g, c, t) => {                                   // 式折神·纸风飞机 331603
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (Elona.Battle && Elona.Battle.attackSeq) Elona.Battle.attackSeq(g, c, t);
    return { implemented: true, melee: true };
  };
  T[865] = (g, c, t) => {                                   // 脑髓寄生攻击 318725
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if (guardJuA(g, t)) return { implemented: true, nothing: true };
    hostile(g, c, t);
    if ((t.get(60) | 0) < 100) {
      t.set(60, (t.get(60) | 0) + 10);
      if ((t.get(60) | 0) >= 100) t.set(60, 120);
    }
    if (Elona.Parasite) Elona.Parasite.brain(g, t);
    return { implemented: true, parasite: true };
  };
  T[866] = (g, c) => {                                      // 纸隐 335825
    let buddy = null;
    for (const o of (g.charas || [])) {
      if (!o || (o.get(0) | 0) !== 1) continue;
      if ((o.get(9) | 0) !== 10 || !cbit(o, 992) || !cbit(o, 1035)) continue;
      const sp = o.get(27) | 0;
      if (sp === 1113 || sp === 1114 || sp === 1115) { buddy = o; break; }
    }
    if (!buddy) {
      say(g, `${nm(c)}还需要其他的式折神……`);
      return { implemented: true, nothing: true };
    }
    healHp(c, idiv(c.get(50) | 0, 4));
    healMp(c, idiv(c.get(55) | 0, 4));
    return { implemented: true, hidden: true };
  };
  T[867] = (g, c, t) => {                                   // 臀击 338205
    const R = rndOf(g);
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(434) | 0) > 0) {
      say(g, `${nm(c)}用屁股压碎了倒地的${nm(t)}！`);
      t.set(434, (t.get(434) | 0) + 1);
      let d = (idiv(c.skill(10) | 0, 5) + 5) * (idiv((c.skill(152) | 0) + 1, 5) + 5)
        + R((c.skill(152) | 0) * 2 + 5)
        + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
          * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 2);
      if ((c.get(27) | 0) === 31) d = idiv(d * 3, 2);
      dmg(g, t, d, c, 68, 1000);
      return { implemented: true, dmg: d };
    }
    if ((t.get(434) | 0) === 0) {
      say(g, `${nm(c)}用屁股撞飞了${nm(t)}。`);
      t.set(434, 2);
      if (visible(g, t)) say(g, `${nm(t)}摔倒了。`);
      let d = (idiv(c.skill(10) | 0, 5) + 5) * (idiv((c.skill(152) | 0) + 1, 5) + 5)
        + R((c.skill(152) | 0) * 2 + 5);
      if ((c.get(27) | 0) === 31) d = idiv(d * 3, 2);
      dmg(g, t, d, c, 68, 1000);
      return { implemented: true, dmg: d };
    }
    return { implemented: true, nothing: true };
  };
  T[868] = (g, c, t) => {                                   // 扑克之力 331709
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, 1 + rndOf(g)(52), c, 0, 0);
    return { implemented: true, card: true };
  };
  T[869] = (g, c) => {                                      // 【求饶】 332358
    subMorale(c, 30);
    return { implemented: true, beg: true };
  };
  T[870] = (g, c, t) => {                                   // 冥界瘴气 330076
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    con(g, t, 8, 200);                                      // 变异
    dmgSan(t, 50, g);
    return { implemented: true, miasma: true };
  };
  T[871] = (g, c) => {                                      // 预设炸药 338247
    dmgMp(c, idiv(c.get(56) | 0, 20) + 1);
    if ((c.index | 0) !== 0) return { implemented: true, nothing: true };
    const hits = [];
    const R = rndOf(g);
    for (const o of (g.charas || [])) {
      if (!o || (o.get(0) | 0) !== 1 || !cbit(o, 1054)) continue;
      setCbit(o, 1054, 0);
      const d = (idiv(c.skill(16) | 0, 5) + 5) * (idiv((c.skill(157) | 0) + 1, 5) + 5)
        + R((c.skill(157) | 0) * 2 + 5)
        + idiv((limit((c.get(38) | 0) - 50, 1, 2000) + limit((c.get(38) | 0) - 100, 1, 2000))
          * 4 * Math.sqrt(limit(c.get(38) | 0, 1, 2000) * 3) + 31, 2);
      dmg(g, o, d, c, 68, 1000);
      hits.push(o.index | 0);
    }
    skillExp(c, 157, 40);
    return { implemented: true, hits };
  };
  T[872] = (g, c, t) => {                                   // 火箭推进 330528
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    if ((t.get(27) | 0) !== 1162) dmgMp(t, idiv(t.get(56) | 0, 2));
    say(g, `${nm(t)}全身喷出了爆炎。`);
    buff(g, t, 17, 20, 150);
    buff(g, t, 5, (c.skill(17) | 0) * 3 + 50, 150);
    return { implemented: true, blast: true };
  };
  T[873] = (g, c, t) => {                                   // 制导轰炸 330248
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    dmg(g, t, (c.skill(16) | 0) + (c.get(184) | 0), c, 50, 1000);
    return { implemented: true, bomb: true };
  };
  T[874] = () => ({ implemented: true, request: 'rescue' });        // 请求救援 328995
  T[875] = (g, c) => {                                      // 响彻声援 333880
    // 0-GC：5 回合 rowact 33（*label_2920），每回合给同阵营角色 +2 斗志并回 SP
    if (Elona.Social) {
      const r = Elona.Social.beginCheer(g, c);
      return r.ok ? { implemented: true, rowact: 33 } : { implemented: true, nothing: true };
    }
    for (const o of (g.charas || [])) {
      if (!o || (o.get(0) | 0) !== 1 || !sameSide(c, o)) continue;
      addMorale(o, 10);
    }
    return { implemented: true, cheer: true };
  };
  T[876] = (g, c) => T[875](g, c);                          // 动态声援
  T[877] = () => ({ implemented: true, request: 'stance' });        // 姿态选择 328661
  T[878] = (g, c, t) => {                                   // 破灭催眠 334476
    if (!t || (t.get(0) | 0) !== 1) return { implemented: true, nothing: true };
    con(g, t, 7, 300);
    return { implemented: true, hypnotize: true };
  };

  // ---- 收尾补漏 -----------------------------------------------------
  // 678 战术指示（338868）：`goto *label_2973` —— 先选目标再下指令。
  T[678] = (g, c, t) => ({ implemented: true, request: 'order', target: t });
  // 719 同化吸收 / 720 Over Boost / 726 死亡束缚：var_83 里有定义（3452/3458/3500），
  //   但全 611,941 行里没有任何 `var_1302 ==` / `var_396 ==` 的分支消费它们，
  //   属于 2.33R 的「表里有、没人读」条目 —— 照源码实现为空操作。
  T[719] = () => ({ implemented: true, nothing: true, deadEntry: true });
  T[720] = () => ({ implemented: true, nothing: true, deadEntry: true });
  T[726] = () => ({ implemented: true, nothing: true, deadEntry: true });

  // ------------------------------------------------------------------
  // 共用小工具
  // ------------------------------------------------------------------
  /** 335285 / 318727：对方是「绝对防卫」的朱亚系守护者时拦下 */
  function guardJuA(g, t) {
    if (!t || (t.get(27) | 0) !== 359) return false;
    let guard = null;
    for (const o of (g.charas || [])) {
      if (!o || (o.get(0) | 0) !== 1) continue;
      if ((o.get(27) | 0) === 665) { guard = o; break; }
    }
    if (!guard) return false;
    say(g, `${nm(guard)}「绝对防卫！」`);
    return true;
  }
  /** 斗志不足时改放 732（部分改 716），返回统一的 implemented 结果 */
  function moraleReject(g, c, t, id, fallback, need) {
    if ((c.index | 0) !== 0 && (c.get(182) | 0) < (need === undefined ? 100 : need)) {
      recast(g, c, fallback, t);
      return { implemented: true, recast: fallback };
    }
    if ((c.index | 0) !== 0 && ((c.index | 0) < 16 || (c.get(58) | 0) === 100)) {
      recast(g, c, 716, t);
      return { implemented: true, recast: 716 };
    }
    return { implemented: true, nothing: true, id };
  }
  /** 敌我判定：var_58(9) 同号且都在 -1 以上视为同侧 */
  function sameSide(a, b) {
    const sa = a.get(9) | 0, sb = b.get(9) | 0;
    if (sa === sb) return true;
    if (sa >= -1 && sb >= -1) return true;
    return false;
  }
  function hostile(g, a, b) {
    if (!a || !b) return;
    if (Elona.Relation && Elona.Relation.hostile) Elona.Relation.hostile(a, b);
  }
  /**
   * `get_route` 的等价物：沿施法者朝向（没有瞄准信息时取正右方）逐格推进，
   * 命中第一个角色即停。649 冲击波动 / 794 鲜血投刃 等「射线」用它。
   */
  function projLine(g, c, pw) {
    const hits = [];
    const tx = (g._aimX === undefined || g._aimX === null) ? c.x + 1 : g._aimX;
    const ty = (g._aimY === undefined || g._aimY === null) ? c.y : g._aimY;
    const dx = Math.sign(tx - c.x);
    const dy = Math.sign(ty - c.y);
    if (!dx && !dy) return hits;
    for (let i = 1; i <= 8; i++) {
      const x = c.x + dx * i, y = c.y + dy * i;
      if (g.map && g.map.inBounds && !g.map.inBounds(x, y)) break;
      const o = findChara(g, 0) && (g.charas || []).find(
        (m) => m && (m.get(0) | 0) === 1 && m !== c && (m.x | 0) === x && (m.y | 0) === y);
      if (!o) continue;
      dmg(g, o, pw, c, 64, 1000);
      hits.push(o.index | 0);
      break;
    }
    return hits;
  }

  // ------------------------------------------------------------------
  function has(id) { return !!T[id]; }
  function run(g, caster, id, tg, power) {
    const fn = T[id];
    if (!fn) return null;
    g._v578 = (power === undefined || power === null) ? (g._v578 || 0) : power;
    const r = fn(g, caster, tg || caster, power) || {};
    return Object.assign({ ok: true, type: 0, implemented: true, id }, r);
  }

  Elona.Ability0 = { has, run, IDS: T };
})(window);
