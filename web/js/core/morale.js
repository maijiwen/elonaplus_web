'use strict';
/**
 * 斗志（闘志 / パワーゲージ）系统 —— 对应原版 var_58(182)。
 *
 * 这是 Elona+ 的核心资源：受伤与攻击都会累积，每回合自然衰减，
 * 累积到 100 以上可以发动强力技能（消耗后归零）。
 *
 * 【源码依据】
 *   modgauge (31667-31686) ------------------------------------------------------------
 *     var_58(182, ch) += n；上限 var_765 = 100，但满足以下任一则为 200：
 *       var_58(409) > 0（进化）/ var_58(214) > 0（変身）/ var_58(25) >= 4（品质）
 *     下限 0。
 *
 *   受伤者累积 (199190-199231) -------------------------------------------------------
 *     if (var_58(182) < 96) {                     ← 低于 96 时累积到此
 *       if (伤害 > 0 && var_58(183) == 0) {        ← 每回合只累积一次
 *         var_58(183) = 1
 *         var_58(182) += 伤害 * 150 / 最大HP + 2
 *         if (var_58(154) > 0 && (var_58(58) == 100 || 是玩家)) var_58(182) += 1
 *         if (>= 96) = 96
 *       }
 *     }
 *     if (100 < var_58(182) < 196) { 同上 → 上限 196 }   ← 变身/进化后的「超级区间」
 *
 *   伤害来源累积 (199131-199156) -----------------------------------------------------
 *     if (var_58(183, 目标) == 0) {               ← 同一目标每回合只给一次
 *       var_58(178, 攻击者) = 1
 *       if (cbit(985, 目标) != 1) {               ← 沙包不提供斗志
 *         var_58(182, 攻击者) += 2
 *         if (var_58(27, 攻击者) == 909) var_58(182, 攻击者) += 2   ← 兽爪兵
 *       }
 *     }
 *
 *   击杀回复 (199945-199952) ---------------------------------------------------------
 *     遍历附近同伴：if (var_58(182) <= 195 && 目标无 cbit 23/27/964) var_58(182) += 5
 *     之后 if (> 100) 且非进化/非変身/品质 < 4 → = 100
 *
 *   每回合衰减 (216340-216362) -------------------------------------------------------
 *     var_58(405) = 0
 *     if (var_58(255) > 0) { var_58(182) -= 3; if (< 0) = 0 }      ← 疲劳状态下额外流失
 *     if (var_58(182) > 0 && findbuff(48) == -1) {                  ← buff 48 抑制衰减
 *       if (var_58(182) < 100) var_58(182)--
 *       if (100 < var_58(182) < 200) var_58(182)--
 *       if (findbuff(57) != -1) var_58(182)--                       ← buff 57（狂気）再 -1
 *     }
 *   回合结束清标志 (216244-216247)：var_58(178) / var_58(183) 归零
 *
 *   变身维持 (216248-216253)：玩家 var_58(182) < 30 → 解除変身（var_58(214) = 0）
 *
 *   显示 (203129-203226) -------------------------------------------------------------
 *     数值条宽 84px（HP 条右侧下方 2px 高），文字为「N%」。
 *
 * 【技能消耗表】从源码逐分支提取：var_58(182, var_243) -= N 且同分支有 < N 的判定。
 *   共 47 项（25 / 30 / 50 / 75 / 80 / 100）。原版在斗志不足时并非「不能发动」，
 *   而是**替换为弱化效果**（如 663 → 732）；本项目暂按「不足则拦下并提示」处理，
 *   已在 docs 中登记为近似。
 *
 * 【HSP 语义】`/` 为整除（向零截断）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** var_58(182)：斗志 */
  const MG = 182;
  /** var_58(183)：本回合「因受伤而获得斗志」标志 */
  const FLAG_HURT = 183;
  /** var_58(178)：本回合「因伤害他人而获得斗志」标志 */
  const FLAG_ATTACK = 178;
  /** var_58(255)：疲劳（有则额外流失 3） */
  const FATIGUE = 255;
  /** var_58(214)：変身状态 */
  const TRANSFORM = 214;
  /** var_58(409)：進化状态 */
  const EVOLVED = 409;
  /** var_58(25)：品质 */
  const QUALITY = 25;

  /** buff 48 = 抑制斗志衰减；buff 57 = 狂気（额外衰减） */
  const BUFF_NO_DECAY = 48;
  const BUFF_EXTRA_DECAY = 57;

  const CAP_LOW = 100;
  const CAP_HIGH = 200;

  /**
   * 技能的斗志消耗（源码逐分支提取，门槛值与消耗值一致才收录）。
   * 0 / 未收录 = 不消耗。
   */
  const COST = {
    657: 100, 660: 100, 661: 100, 662: 100, 664: 100, 668: 100, 670: 100,
    693: 50, 702: 100, 703: 100, 704: 100, 705: 100, 706: 100, 707: 100, 708: 100,
    716: 100, 717: 100, 718: 100, 722: 100, 728: 100, 729: 100, 730: 100, 731: 100,
    740: 75, 741: 50, 746: 50, 749: 100,
    773: 25, 780: 25, 781: 25, 796: 100, 797: 100, 798: 100, 799: 100, 800: 100,
    809: 100, 815: 25, 825: 50,
    834: 80, 836: 80, 838: 80, 849: 100, 855: 100, 861: 80,
    874: 30, 876: 100, 878: 80,
  };

  const TEXT = {
    notEnough: (need, have) => `闘志が足りない（需要 ${need}，现在 ${have}）。`,
    gainBig: '闘志がみなぎってきた！',
  };

  function get(c) {
    return c ? (c.get(MG) | 0) : 0;
  }

  function set(c, v) {
    if (!c) return 0;
    c.set(MG, v | 0);
    return v | 0;
  }

  /** modgauge 的上限：100，或 200（进化 / 変身 / 品质 >= 4） */
  function capOf(c) {
    if (!c) return CAP_LOW;
    if ((c.get(EVOLVED) | 0) > 0) return CAP_HIGH;
    if ((c.get(TRANSFORM) | 0) > 0) return CAP_HIGH;
    if ((c.get(QUALITY) | 0) >= 4) return CAP_HIGH;
    return CAP_LOW;
  }

  /** 31667-31686 modgauge：加成并夹到 [0, 上限] */
  function add(c, n) {
    if (!c) return 0;
    let v = get(c) + (n | 0);
    const cap = capOf(c);
    if (v > cap) v = cap;
    if (v < 0) v = 0;
    set(c, v);
    return v;
  }

  /** 不夹到 modgauge 上限的直接累加（199194 / 199215 的受伤累积走这条） */
  function rawAdd(c, n) {
    if (!c) return 0;
    const v = get(c) + (n | 0);
    set(c, v);
    return v;
  }

  function hasBuff(c, id) {
    if (!c) return false;
    if (Elona.Status && Elona.Status.findbuff) return Elona.Status.findbuff(c, id) >= 0;
    return false;
  }

  /**
   * 受击/出手后的斗志结算 —— 对应 dmghp 尾部 199131-199156（来源）与 199190-199231（受害）。
   * @param {object} g    游戏
   * @param {object} att  伤害来源（可为 null / 环境）
   * @param {object} def  受伤目标
   * @param {number} dmg  实际伤害
   */
  function onDamage(g, att, def, dmg) {
    const d = dmg | 0;
    if (!def) return;
    const defIdx = (def.index === undefined) ? -1 : (def.index | 0);

    // ---- 目标：受伤累积（199132 的 var_58(183) 是「本回合已获得」标志） ----
    if (defIdx >= 0 && (def.get(FLAG_HURT) | 0) === 0) {
      // 199131-199148 的 var_58(60) 破防计量在 battle.applyDamage 里已单独实现，此处只处理斗志
      const mg = get(def);
      if (d > 0 && (mg < 96 || (mg > 100 && mg < 196))) {
        def.set(FLAG_HURT, 1);
        const hpMax = Math.max(1, def.get(51) | 0);
        let gain = idiv(d * 150, hpMax) + 2;
        // 199200-199204：var_58(154) > 0 且（var_58(58) == 100 或 玩家）→ 再 +1
        if ((def.get(154) | 0) > 0 && ((def.get(58) | 0) === 100 || defIdx === 0)) gain += 1;
        let nv = mg + gain;
        if (mg < 96) { if (nv >= 96) nv = 96; }
        else { if (nv >= 196) nv = 196; }
        set(def, nv);
      }

      // ---- 来源：伤害他人累积（199149-199156） ----
      if (att && att !== def && (att.get(0) | 0) === 1) {
        att.set(FLAG_ATTACK, 1);
        if (!(Elona.Status && Elona.Status.cbit && Elona.Status.cbit(def, 985))) {
          let gain = 2;
          if ((att.get(27) | 0) === 909) gain += 2;    // 獣爪兵
          rawAdd(att, gain);
          if (get(att) > 100) {
            const evolved = (att.get(EVOLVED) | 0) > 0;
            const trans = (att.get(TRANSFORM) | 0) > 0;
            const qual = (att.get(QUALITY) | 0) >= 4;
            if (!evolved && !trans && !qual) set(att, 100);
            else if (get(att) > 200) set(att, 200);
          }
        }
      }
    }
  }

  /**
   * 击杀结算 —— 199945-199952：附近同伴 +5。
   * @param {object} g
   * @param {object} killer 击杀者（可为玩家）
   * @param {object} victim 被击杀者
   */
  function onKill(g, killer, victim) {
    if (!g || !killer || !victim) return null;
    const k = killer.index | 0;
    if (k < 0) return null;

    // 199921-199944 的筛选（逐条对应）：
    //   prm_987 = 击杀者，prm_985 = 死者，cnt = 受益者
    //   ① 击杀者是玩家/同伴（index < 16 或 == 0）→ 受益者只取 index <= 16（玩家 + 同伴）
    //   ② 击杀者是 NPC（index > 16）      → 受益者必须与击杀者同阵营
    //   ③ 击杀者与死者同阵营 → 整段跳过（误伤不激昂）
    //   ④ 击杀者是玩家方 → 死者必须是敵対（var_58(9) == -3）
    const isPlayerSide = (k < 16) || (k === 0);
    if ((killer.get(9) | 0) === (victim.get(9) | 0)) return [];
    if (isPlayerSide && (victim.get(9) | 0) !== -3) return [];

    const sp = Elona.Status && Elona.Status.cbit;
    // 199946：死者带分裂 / 召唤特性（cbit 23 / 27 / 964）→ 不回复
    if (sp && (sp(victim, 23) || sp(victim, 27) || sp(victim, 964))) return [];

    // 199931：dist <= var_83(3,656)\1000 + 1
    const reach = idiv((killer.skill ? (killer.skill(656) | 0) : 0), 1000) + 1;
    const align = killer.get(9) | 0;
    const gained = [];
    for (const c of (g.charas || [])) {
      if (!c || (c.get(0) | 0) !== 1 || c === victim) continue;
      const ci = c.index | 0;
      if (isPlayerSide) {
        if (ci > 16) continue;                     // 199922-199924
      } else {
        if ((c.get(9) | 0) !== align) continue;    // 199926-199929
      }
      const dx = Math.abs((c.x | 0) - (killer.x | 0));
      const dy = Math.abs((c.y | 0) - (killer.y | 0));
      if (Math.max(dx, dy) > Math.max(1, reach)) continue;
      if (Elona.Spell && Elona.Spell.fovLos
        && ci !== k && !Elona.Spell.fovLos(g, killer.x | 0, killer.y | 0, c.x | 0, c.y | 0)) continue;
      if (get(c) > 195) continue;                  // 199945
      rawAdd(c, 5);
      // 199950-199953：>100 时按「非進化 / 非変身 / 品质 < 4」夹回 100
      if (get(c) > 100) {
        const evolved = (c.get(EVOLVED) | 0) > 0;
        const trans = (c.get(TRANSFORM) | 0) > 0;
        const qual = (c.get(QUALITY) | 0) >= 4;
        if (!evolved && !(trans && ci !== 0) && (!qual || ci > 16)) set(c, 100);
      }
      gained.push(ci);
    }
    return gained;
  }

  /**
   * 每回合结算 —— 216244-216253 的清标志 + 216340-216362 的衰减。
   * 由 Status.statusTick 末尾调用（每个角色一次）。
   */
  function tick(g, c) {
    if (!c) return 0;
    // 216244-216247：清掉上一回合的两个获得标志
    if ((c.get(FLAG_ATTACK) | 0) > 0) c.set(FLAG_ATTACK, 0);
    if ((c.get(FLAG_HURT) | 0) > 0) c.set(FLAG_HURT, 0);

    // 216340-216347：疲劳状态下额外 -3
    if ((c.get(FATIGUE) | 0) > 0) {
      let v = get(c) - 3;
      if (v < 0) v = 0;
      set(c, v);
    }

    // 216348-216362：自然衰减
    if (get(c) > 0) {
      if (!hasBuff(c, BUFF_NO_DECAY)) {
        let v = get(c);
        if (v < 100) v -= 1;
        if (v > 100 && v < 200) v -= 1;
        if (hasBuff(c, BUFF_EXTRA_DECAY) && v > 0) v -= 1;
        if (v < 0) v = 0;
        set(c, v);
      }
    }

    // 216248-216253：玩家的斗志低于 30 → 変身解除
    if ((c.index | 0) === 0) {
      if ((c.get(TRANSFORM) | 0) !== 0 && get(c) < 30) {
        c.set(TRANSFORM, 0);
        if (g && g.log) g.log('変身が解けた。');
      }
    }
    return get(c);
  }

  /** 该技能需要多少斗志（0 = 不需要） */
  function costOf(id) {
    return COST[id | 0] || 0;
  }

  /** 能否发动 */
  function canUse(c, id) {
    const need = costOf(id);
    if (!need) return { ok: true, need: 0 };
    const have = get(c);
    return { ok: have >= need, need, have };
  }

  /** 消耗（发动成功后调用） */
  function spend(c, id) {
    const need = costOf(id);
    if (!need) return true;
    if (get(c) < need) return false;
    let v = get(c) - need;
    if (v < 0) v = 0;
    set(c, v);
    return true;
  }

  /** 百分比（原版直接显示数值 + "%"；200 满时显示 200%） */
  function pct(c) {
    return limit(get(c), 0, 200);
  }

  Elona.Morale = {
    MG, FLAG_HURT, FLAG_ATTACK, CAP_LOW, CAP_HIGH, COST, TEXT,
    get, set, add, rawAdd, capOf, onDamage, onKill, tick,
    costOf, canUse, spend, pct,
  };
})(typeof window !== 'undefined' ? window : globalThis);
