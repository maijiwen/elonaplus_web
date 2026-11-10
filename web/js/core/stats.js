'use strict';
/**
 * 属性计算模块 —— 对应原版 cnvbonus (start.hsp 行 213355 起)
 *
 * 【已确认】HP/MP/SP 上限公式（start.hsp 行 213908-213957），逐字对应：
 *
 *   var_1409 = limit( Lv/4
 *                   + limit(Lv/5, 0, 20)
 *                   + limit(Lv/5, 1, 40)
 *                   + limit(Lv/5, 1, 60)
 *                   + limit(Lv/5, 1, 100), 1, 3000 )
 *
 *   MP上限(56) = limit( ((S16*3 + S15 + S14) / 3) * var_1409 / 10 + S16, 1, 2000000 )
 *                * limit(S3, 1, 1000) / 100
 *
 *   HP上限(51) = limit( ((S11*3 + S10 + S15) / 3) * var_1409 / 10 + S11, 1, 2000000 )
 *                * limit(S2, 1, 1000) / 100 + 5
 *
 *   SP上限(53) = 100 + (S15 + S11)/5 + var_97(24)*8 + limit(Lv, 1, 2000)
 *
 *   之后依次：
 *     - 若 chara==0 且 var_97(226)!=0 → SP上限 = SP上限*6/5
 *     - MP上限 < 1 → 1 ; HP上限 < 1 → 1
 *     - 若 creatureId(var_58(27)) ∈ {1113,1114,1115} 且 var_58(58)==0 →
 *           HP上限 = HP上限/20 + 1 ; MP上限 = MP上限/20 + 1
 *     - 若 (chara>=57 且 玩家标志==0 且 creatureId!=1124 且 chara!=0) 走另一分支，
 *       否则 HP上限 += 10          ← 玩家(index 0) 走此分支
 *
 * 所有除法均为「HSP 整数除法」：向零截断（等价 JS 的 (a/b)|0）。
 * 其中 S10..S18 = var_82(10..18)，即基础属性：10=筋力 11=耐久 12=器用 13=感覚
 *   14=習得 15=意志 16=魔力 17=魅力 18=速度；S2=生命力% S3=マナ%
 *
 * 【未确认】var_97(24)/var_97(226) 的确切来源，此处以参数注入，默认 0。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** HSP 整数除法（向零截断） */
  function idiv(a, b) { return b === 0 ? 0 : ((a / b) | 0); }
  /** HSP limit(v, a, b) */
  function limit(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // 属性 id（已由 var_81 名称表确认）
  const ATTR = {
    LIFE: 2, MANA: 3,
    STR: 10, CON: 11, DEX: 12, PER: 13, LRN: 14, WIL: 15, MAG: 16, CHA: 17, SPD: 18,
  };

  /**
   * 计算并写回角色的 HP/MP/SP 上限。
   * @param {object} c  角色对象，需提供 level / skill(id) / set
   * @param {object} opt { creatureId }
   *
   * 213912 var_97(24)（SP 加成 feat）与 213914 var_97(226)（SP+20% feat）直接读 c.feats；
   * 两个值在调用点之前已由 Feat.applyRaceFeats / Feat.apply 写入。
   */
  function calcMaxStats(c, opt) {
    opt = opt || {};
    const L = c.level;
    const S = (id) => c.skill(id);
    const v97_24 = (Elona.Feat ? Elona.Feat.get(c, 24) : 0);
    const v97_226 = (Elona.Feat ? Elona.Feat.get(c, 226) : 0);

    const v1409 = limit(
      idiv(L, 4)
      + limit(idiv(L, 5), 0, 20)
      + limit(idiv(L, 5), 1, 40)
      + limit(idiv(L, 5), 1, 60)
      + limit(idiv(L, 5), 1, 100),
      1, 3000);

    // MP 上限
    let mpMax = idiv(
      limit(idiv(S(ATTR.MAG) * 3 + S(ATTR.WIL) + S(ATTR.LRN), 3) * idiv(v1409, 10) + S(ATTR.MAG), 1, 2000000)
      * limit(S(ATTR.MANA), 1, 1000), 100);
    // HP 上限（213911：`(体质*3+力量+意志)/3 * var_1409/10 + 体质` * 生命力/100 + 5）
    // 【wiki-audit 修正】末尾项是 +体质（var_82(11)），此前误写为 +力量
    let hpMax = idiv(
      limit(idiv(S(ATTR.CON) * 3 + S(ATTR.STR) + S(ATTR.WIL), 3) * idiv(v1409, 10) + S(ATTR.CON), 1, 2000000)
      * limit(S(ATTR.LIFE), 1, 1000), 100) + 5;
    // SP 上限
    let spMax = 100 + idiv(S(ATTR.WIL) + S(ATTR.CON), 5) + v97_24 * 8 + limit(L, 1, 2000);

    if (c.index === 0 && v97_226 !== 0) {
      spMax = idiv(spMax * 6, 5);
    }
    if (mpMax < 1) mpMax = 1;
    if (hpMax < 1) hpMax = 1;

    const creatureId = opt.creatureId || 0;
    if ((creatureId === 1113 || creatureId === 1114 || creatureId === 1115) && c.get(58) === 0) {
      hpMax = idiv(hpMax, 20) + 1;
      mpMax = idiv(mpMax, 20) + 1;
    }

    // NPC(index>=57) 走另一分支：按 var_58(25) 档位倍率（213930-213957）
    if (c.index >= 57 && c.get(58) === 0 && creatureId !== 1124 && c.index !== 0) {
      if (c.get(60) < 100) {
        c.set(71, (c.get(71) + limit(idiv(L, 2), 1, 200)) | 0);
        c.set(70, (c.get(70) + limit(idiv(L, 2), 1, 200)) | 0);
      }
      if (c.get(25) === 3) hpMax = idiv(hpMax * 3, 2);
      if (c.get(25) >= 4 || creatureId === 534) {
        hpMax = hpMax * 6;
        spMax = spMax * 3;
        for (let s = 50; s <= 60; s++) c.setSkill(s, (c.skill(s) + 150) | 0);   // 213943-213953
      }
    } else {
      hpMax += 10;                              // 213957
    }

    return { hpMax, mpMax, spMax, v1409 };
  }

  /**
   * 对应原版 skillinit (start.hsp 行 214947)。
   * 它并不直接写技能等级，而是把「成长潜力」累加到 var_82(id+600)：
   *   var_82(id+600) = 潜力*1000000 + 到下一级的经验
   * 之后 syncSkillValues() 会把 var_82(id) 设为 潜力（label_2174 行 213385-213387）。
   *
   * @param {object} pot    潜力累加器（普通对象，键为技能id）
   * @param {number} id     技能/属性 id
   * @param {number} val    skillinit 的第 3 个参数
   * @param {object} ctx    { level, creatureId }
   */
  function skillInit(pot, id, val, ctx) {
    const Lv = ctx.level | 0;
    const v1436 = pot[id] || 0;                 // 当前积累值
    let v1437;                                  // 经验阈值部分
    if (id >= 100) {
      v1437 = val * 5;
      v1437 += (idiv(v1436, 1000000) === 0) ? 100 : 50;
    } else {
      v1437 = val * 20;
      if (v1437 > 400) v1437 = 400;
    }
    // 潜力增量
    let pot_add;
    if (id === 18) {                            // 速度：特殊公式
      pot_add = idiv(val * (100 + Lv * 2), 100);
    } else {
      pot_add = idiv(v1437 * v1437 * Lv, 45000) + val + idiv(Lv, 3);
    }
    if (ctx.creatureId === 685 && id === 17) pot_add = idiv(pot_add, 2) + 1;
    if (Lv > 1) v1437 = Math.trunc(Math.exp(Math.log(0.9) * Lv) * v1437);
    if (v1437 < 1) v1437 = 1;
    if (id === 2 || id === 19 || id === 3) {    // 生命力 / マナ：直接使用参数
      pot_add = val;
      v1437 = 100;
    }
    if (idiv(v1436, 1000000) + pot_add > 2000) {
      pot_add = 2000 - idiv(v1436, 1000000);
    }
    pot[id] = v1436 + limit(pot_add, 0, 2000) * 1000000 + v1437;
    return pot[id];
  }

  /**
   * 对应 label_2174 行 213385-213387：
   *   repeat 600 : var_82(cnt) = var_82(cnt + 600) / 1000000
   * 即把「潜力」变为当前属性/技能值。
   * 同时保留潜力表（sorg(id) = var_82(id+600)/1000000 需要它）。
   */
  function syncSkillValues(c, pot) {
    for (const k in pot) {
      c.setSkill(parseInt(k, 10), idiv(pot[k], 1000000));
    }
    c.potential = pot;
    return c;
  }

  /** 对应 sorg(id, chara) = var_82(id + 600, chara) / 1000000（5022-5023） */
  function sorg(c, id) {
    if (c.potential && c.potential[id] !== undefined) return idiv(c.potential[id], 1000000);
    return 0;
  }

  // ==========================================================================
  // 装备对属性的加成 —— *label_2175 的 213461-213793（逐字移植）
  //
  //   清空累计字段 → repeat 30（槽 100..129）：
  //     var_58(64) += 装备重量 var_99(7)                       ; 已装备物品总重
  //     盾(var_99(16)==168) 且在手槽 → var_58(96)=1/2、var_58(436)+=var_99(14)、var_58(32)|=1
  //     var_58(97) = 武器类型码（按物品 id 列表）
  //     var_99(15)+var_99(14) < 180 → var_58(71)+=var_99(14)、var_58(70)+=var_99(15)
  //     var_99(10)==0（防具）→ var_58(72/73) 命中/伤害修正 + var_58(70/71) 的附魔等级/价值加成
   //                         （少数例外物品改为加 72/73）
   //     var_99(10)!=0（武器）且在手槽 → var_1374++（攻击回数）
   //     var_99(17) == -1 → var_58(87)+=20；== -2 → +=100（诅咒/堕落品质）
   //     var_99(24)==8 且玩家 → var_65(800)+=5
   //     repeat 15：附魔表 var_99(40+2n)/var_99(41+2n)
   //       >=10000 → 技能修正（type1 上限 / type2 直接加 / type3 成长加成）
   //       <10000  → 固定附魔 id（见 ENCHANT）
   //   末尾 var_58(436) = limit(..., -5, 10)
  //
  // 【未移植】var_132(32, mapId)==100 的 global 判定（缺省 0 → 复位 var_58(94)）；
  //   var_97(218) 的 SP 修正（缺省 0）。
  // ==========================================================================
  // var_99(14) → var_58(71)=DV，var_99(15) → var_58(70)=PV（213575-213579）
  const EQ = {
    PV: 70, DV: 71, HIT: 72, DMG: 73, VAL: 64, QUAL: 87, SHIELD: 96, WTYPE: 97,
  };
  // 213501/213586：不计入防具加成的「特例装备」id
  const EQ_SPECIAL_IDS = [895, 892, 850, 871, 893, 923, 938, 948, 1092, 1314];

  // 213517-213570：var_58(97) 武器类型码
  const WTYPE_1 = [1, 224, 759, 56, 57, 64, 73, 741, 810, 888, 949, 1006, 1153, 1167, 1170, 1182, 1184];
  const WTYPE_101 = [225, 266, 798, 826];
  const WTYPE_1001 = [1163];
  const WTYPE_2 = [2, 781, 206, 678, 801, 959, 1154, 1168];
  const WTYPE_3 = [232, 791, 719, 808, 863, 958];
  const WTYPE_103 = [3, 226, 234, 695, 794, 805, 899, 1058, 1150, 1149, 1165, 1303];
  const WTYPE_4 = [4, 227, 356, 679, 831, 854, 955, 985, 1042, 1110, 1146, 1145, 1160];
  const WTYPE_5 = [213, 228, 235, 359, 677, 793, 868, 950, 995, 1152, 1151, 1166, 1183];
  const WTYPE_105 = [813];
  const WTYPE_6 = [212, 229, 358, 676, 860, 862, 898, 908, 956, 974, 983, 1010, 1144, 1143, 1162];
  const WTYPE_7 = [922, 804, 739, 735, 675, 211, 63, 954, 1034, 1049, 1148, 1147, 1164, 1169];

  // 213653-213790：固定附魔 id → 效果
  const ENCHANT_CBIT = {
    32: 5, 70: 34, 35: 7, 23: 9, 24: 12, 25: 8, 26: 10, 27: 11, 28: 13,
    42: 14, 41: 15, 55: 29, 69: 1044,
  };
  const ENCHANT_CBIT24 = [21, 45, 46, 47, 72];

  /**
   * 应用装备的全部属性加成（重算并覆盖 var_58 的累计字段）。
   * @param {Elona.Chara} c
   * @param {object} [g] 需要写入 var_65(28/29/83/185/187/800) 时传入
   * @returns {{attackCount:number, unimpl:string[]}}
   */
  function applyEquipment(c, g) {
    const V = (n) => c.get(n);
    const S = (n, v) => c.set(n, v);
    const SK = (id, v) => c.setSkill(id, v);
    const cbitmod = (bit, on) => { if (Elona.Status) Elona.Status.cbitmod(c, bit, on); };
    const v65 = (n) => (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0;
    const set65 = (n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v); };
    const unimpl = [];
    const item = (idx) => (c.inv && c.inv[idx]) || null;
    const f = (idx, fld) => { const it = item(idx); return it ? (it.f[fld] || 0) : 0; };

    // ---- 213461-213493：清空累计字段 ----
    S(71, 0); S(70, 0); S(72, 0); S(73, 0); S(32, 0); S(66, 0);
    S(87, 0); S(88, 0); S(89, 0); S(64, 0); S(90, 0); S(91, 0);
    S(98, 0); S(418, 0); S(92, 0); S(436, 0); S(57, 0);
    // 213479-213480：`var_132(32, var_65(20)) != 100` 未移植（缺省 0 → 条件恒真）
    if (V(94) !== 19) S(94, 0);
    if (V(27) === 703) S(94, 100);
    S(96, 0); S(97, 0); S(403, 0); S(406, 0); S(67, 0);
    cbitmod(1017, false); cbitmod(34, false); cbitmod(1044, false);

    // ---- 426785-426807：feat 161（妖精「无法装备 2s 以上的物品」）----
    //   重算派生值时，把已经装着但超过 2s 的装备卸下：
    //   `if ( var_97(161) != 0 ) repeat 30,100 { if (var_99(7, idx) > 2000) { 清槽 ; var_99(18)=0 } }`
    //   这里只对玩家（var_691 == 0）生效。
    if (c.index === 0 && Elona.Feat && (Elona.Feat.get(c, 161) | 0) !== 0) {
      for (let cnt = 100; cnt < 130; cnt++) {
        const v = c.get(cnt);
        if ((v % 10000) === 0) continue;
        const idx = (v % 10000) - 1;
        const it = item(idx);
        if (it && (it.f[7] | 0) > 2000) {
          c.set(cnt, idiv(v, 10000) * 10000);      // 保留部位类型、清物品下标
          it.eqSlot = -1;
        }
      }
    }

    let attackCount = 0;
    // ---- 213493-213793：遍历装备槽 ----
    for (let cnt = 100; cnt < 130; cnt++) {
      const slotVal = c.get(cnt);
      if ((slotVal % 10000) === 0) continue;                 // var_58(cnt) \ 10000 == 0
      const idx = (slotVal % 10000) - 1;                     // var_1403
      const isHand = idiv(slotVal, 10000) === 5;
      const itemId = f(idx, 3);

      S(64, V(64) + f(idx, 7));                              // 213498

      // 213499-213516：盾
      if (f(idx, 16) === 168 && isHand) {
        const special = EQ_SPECIAL_IDS.indexOf(itemId) >= 0;
        if (!special) { S(96, 1); S(436, V(436) + f(idx, 14)); }
        else if (V(96) !== 1) S(96, 2);
        if (!(V(32) & 1)) S(32, V(32) + 1);
      }

      // 213517-213570：武器类型码
      if (V(97) === 0) {
        if (WTYPE_1.indexOf(itemId) >= 0) S(97, 1);
        else if (WTYPE_101.indexOf(itemId) >= 0) S(97, 101);
        else if (WTYPE_1001.indexOf(itemId) >= 0) S(97, 1001);
        else if (WTYPE_2.indexOf(itemId) >= 0) S(97, 2);
        else if (WTYPE_3.indexOf(itemId) >= 0) S(97, 3);
        else if (WTYPE_103.indexOf(itemId) >= 0) S(97, 103);
        else if (WTYPE_4.indexOf(itemId) >= 0) S(97, 4);
        else if (WTYPE_5.indexOf(itemId) >= 0) S(97, 5);
        else if (WTYPE_105.indexOf(itemId) >= 0) S(97, 105);
        else if (WTYPE_6.indexOf(itemId) >= 0) S(97, 6);
        else if (WTYPE_7.indexOf(itemId) >= 0) S(97, 7);
      }
      if (itemId === 827) cbitmod(1017, true);               // 213572-213574

      // 213575-213585：DV/PV
      if (f(idx, 15) + f(idx, 14) < 180) {
        S(71, V(71) + f(idx, 14));                           // 213576 DV
        S(70, V(70) + f(idx, 15));                           // 213579 PV
      }

      // 213581-213599
      if (f(idx, 10) === 0) {
        if (f(idx, 13) + f(idx, 12) < 80) {
          S(72, V(72) + f(idx, 13));                         // 213583
          S(73, V(73) + f(idx, 12));                         // 213584
        }
        const special = EQ_SPECIAL_IDS.indexOf(itemId) >= 0;
        const ench = f(idx, 20);
        const q = (f(idx, 17) === 1) ? 2 : 0;
        if (!special) {
          S(70, V(70) + ench * 2 + q + limit(idiv(f(idx, 7) + 1, 5000), 0, 40));  // 213587
          S(71, V(71) + ench * 2 + q);                                            // 213588
        } else {
          S(73, V(73) + ench + (f(idx, 17) === 1 ? 1 : 0) + limit(idiv(f(idx, 7) + 1, 5000), 0, 40));
          S(72, V(72) + ench + (f(idx, 17) === 1 ? 1 : 0));
        }
      } else if (isHand) {
        attackCount++;                                        // 213596-213598
      }

      // 213600-213610
      if (f(idx, 17) === -1) S(87, V(87) + 20);
      if (f(idx, 17) === -2) S(87, V(87) + 100);
      if (f(idx, 24) === 8 && c.index === 0) set65(800, v65(800) + 5);

      // 213611-213792：附魔表（最多 15 条）
      for (let n = 0; n < 15; n++) {
        const raw = f(idx, 40 + n * 2);
        if (raw === 0) break;
        const pow = f(idx, 40 + n * 2 + 1);
        if (raw >= 10000) {
          const skillId = raw % 10000;
          const type = idiv(raw, 10000);
          if (type === 1) {
            if (v65(273) === 5) { SK(skillId, c.skill(skillId) + idiv(pow, 50) + 1); continue; }
            const cap = sorg(c, skillId) * 2 + 50;
            if (c.skill(skillId) < cap) {
              SK(skillId, limit(c.skill(skillId) + idiv(pow, 50) + 1, 1, cap));
            } else {
              SK(skillId, cap);
            }
            continue;
          }
          if (type === 2) {
            const v = c.skill(skillId) + idiv(pow, 2);
            SK(skillId, v < 0 ? 1 : v);
            continue;
          }
          if (type === 3) {
            if (sorg(c, skillId) !== 0) {
              const v = c.skill(skillId) + idiv(pow, 50) + 1;
              SK(skillId, v < 1 ? 1 : v);
            }
            continue;
          }
          unimpl.push('enchant-skill-type:' + type);
          continue;
        }
        const eid = raw;
        if (ENCHANT_CBIT[eid] !== undefined) { cbitmod(ENCHANT_CBIT[eid], true); continue; }
        if (ENCHANT_CBIT24.indexOf(eid) >= 0) { cbitmod(24, true); continue; }
        switch (eid) {
          case 56: if (c.index === 0) set65(185, 1); break;
          case 59: if (c.index === 0) set65(187, 1); break;
          case 29:
            SK(18, c.skill(18) + idiv(pow, 50) + 1);
            if (c.index === 0) set65(28, v65(28) + idiv(pow, 8));
            break;
          case 52: S(90, V(90) + idiv(pow, 40) + 5); break;
          case 53: S(91, V(91) + idiv(pow, 60) + 3); break;
          case 54: S(92, V(92) + idiv(pow, 5)); break;
          case 44: S(67, V(67) + idiv(pow, 50)); break;
          case 64: S(403, V(403) + idiv(pow, 50)); break;
          case 39: S(66, V(66) + idiv(pow, 50)); break;
          case 34: S(98, V(98) + pow); break;
          case 68: S(418, V(418) + pow); break;
          case 50: S(88, V(88) + idiv(pow, 15)); break;
          case 51: S(89, V(89) + idiv(pow, 15)); break;
          case 65: case 66: S(406, V(406) + 1); break;
          case 62: S(94, V(94) + idiv(pow, 5)); break;
          case 63: S(57, V(57) + idiv(pow, 2)); break;
          case 30: if (c.index === 0) set65(29, 1); break;
          case 31: if (c.index === 0) set65(83, 1); break;
          default: unimpl.push('enchant:' + eid); break;
        }
      }
    }
    // 213794
    S(436, limit(V(436), -5, 10));
    if (c.index === 0 && Elona.Feat && Elona.Feat.get(c, 218) !== 0) S(92, V(92) + 50);
    // *label_2143（211719-211732）：装备槽数 → var_58(68) 速度惩罚
    let n68 = 0;
    for (let n = 100; n < 130; n++) if (c.get(n) !== 0) n68++;
    S(68, n68 > 13 ? limit((n68 - 13) * 5, 0, 50) : 0);
    c.attackCount = attackCount;
    return { attackCount, unimpl };
  }

  // ==========================================================================
  // 技能/属性修正 —— *label_2175 的 213795-213977（在装备加成之后、HP 计算前后）
  //
  //   213828-213854  var_58(240+cnt) 的属性加成 → var_82(10+cnt)（cnt=0..9，即 10..19 属性）
  //                   var_58(84)（负重/衰弱）→ 属性衰减与速度衰减
  //   213865-213866  NPC：var_58(62) = var_82(181) * 50
  //   213868-213876  特殊 creature 的速度（1017 / 1040）
  //   213878-213906  盾与攻击回数对 DV/var_58(32) 的修正；var_58(412) 的 PV/DV ×1.3
  //   213959-213960  特定 creature 的 cbit 34
  //   213969-213977  var_58(88) 的盾加成、var_58(403)/67 的上限转移
  //
  // 【未移植】213800-213827 玩家 feat（var_97/var_98）与 213962-213968 的 calcbuff（buff 系统）
  // 【未移植】213855-213863 的 label_2607 / var_97 循环（玩家 feat 刷新）
  // ==========================================================================
  function applySkillCorrections(c, g) {
    const V = (n) => c.get(n);
    const S = (n, v) => c.set(n, v);
    const SK = (id, v) => c.setSkill(id, v);
    const v65 = (n) => (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0;
    const set65 = (n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v); };
    const unimpl = [];
    const cbitmod = (bit, on) => { if (Elona.Status) Elona.Status.cbitmod(c, bit, on); };

    // ---- 213375-213384：玩家全局复位 ----
    if (c.index === 0) {
      set65(28, 0); set65(800, 0); set65(29, 0); set65(83, 0);
      set65(89, 70); set65(185, 0); set65(187, 0);
    }

    // ---- 213828-213854：属性修正 ----
    const burden = V(84);
    if (c.index === 0 || V(58) === 100) {
      if (burden !== 0 && burden > 10) S(84, 0);
    }
    const bur = V(84);
    for (let cnt = 0; cnt < 10; cnt++) {
      const stat = 10 + cnt;
      const bonus = V(240 + cnt);
      if (bonus !== 0) {
        if (V(25) >= 4) {
          const floor = idiv(sorg(c, stat), 5);
          if (bonus < floor) S(240 + cnt, floor);
        }
        SK(stat, c.skill(stat) + V(240 + cnt));
      }
      if (c.index === 0 || V(58) === 100) {
        if (bur !== 0) {
          if (cnt === 8) {
            SK(18, idiv(c.skill(18) * (10 - bur), 10));
          }
          if (cnt !== 8 && cnt !== 9) {
            SK(stat, idiv(c.skill(stat), bur + 1));
          }
        }
      }
      if (c.skill(stat) < 1) SK(stat, 1);
    }
    // 213855-213863：玩家 feat 刷新（label_2607 神加成 + var_97 效果循环）
    if (c.index === 0) {
      if (Elona.Feat) {
        const gb = Elona.Feat.applyGodBonus(c, g);
        if (gb.unimpl.length) unimpl.push(...gb.unimpl);
        const fr = Elona.Feat.apply(c, g);
        if (fr.unimpl.length) unimpl.push(...fr.unimpl);
      } else unimpl.push('feats:no-module');
    }
    // 213865-213866
    if (c.index !== 0) S(62, c.skill(181) * 50);
    // 213868-213876
    if (V(27) === 1017 && v65(252) === 860) SK(18, 666666);
    if (V(27) === 1040 && c.skill(18) < 1000000) SK(18, 1000000);

    // ---- 213878-213906：盾 / 攻击回数 / var_58(412) ----
    const atk = c.attackCount || 0;
    if (V(32) & 1) {
      if (atk > 1) S(32, V(32) + 4);
      else if (V(70) > 0 && V(96) === 1) {
        S(70, idiv(V(70) * (120 + idiv(Math.sqrt(Math.max(0, c.skill(168))) | 0, 1) * 2), 100));
      }
    } else {
      if (atk === 1) S(32, V(32) + 2);
      else if (atk !== 0) S(32, V(32) + 4);
    }
    if (V(412) > 0) {
      if (V(71) > 0) S(71, idiv(V(71) * 13, 10));
      if (V(70) > 0) S(70, idiv(V(70) * 13, 10));
    }

    // ---- 213959-213960 ----
    if ([843, 871, 370, 655, 746].indexOf(V(27)) >= 0) cbitmod(34, true);

    // ---- 213962-213968：calcbuff（buff 对属性的作用，见 core/buff.js） ----
    for (let n = 0; n < 16; n++) {
      const buffId = V(280 + n * 3);
      if (buffId === 0) break;
      const power = V(280 + n * 3 + 1);
      if (Elona.BuffEffects) {
        const r = Elona.BuffEffects.apply(c, buffId, power);
        if (!r.applied) unimpl.push('calcbuff:' + buffId);
      } else unimpl.push('calcbuff:no-module');
    }

    // ---- 213969-213977 ----
    if (V(32) & 4) {
      S(88, V(88) + idiv((Math.sqrt(Math.max(0, c.skill(166))) | 0) * 3, 2) + 1);
    }
    if (V(403) > 30) S(403, 30);
    if (V(67) > 30) { S(72, V(72) + (V(67) - 30) * 2); S(67, 30); }

    return { unimpl };
  }

  // ==========================================================================
  // 角色升级 —— *label_2145（211854-211957）+ *label_2151（212043）
  // ==========================================================================
  /** *label_2151：下一级所需经验 var_58(36) */
  function expNeeded(c) {
    const L = limit(c.level | 0, 1, 200);
    let v = L * (L + 1) * (L + 2) * (L + 3) + 3000;
    if (v > 100000000 || v < 0) v = 100000000;
    return v;
  }

  const cbitOf = (c, bit) => (Elona.Status ? Elona.Status.cbit(c, bit) : 0);

  /** 完整属性重算（label_2174 的玩家/NPC 通用路径） */
  function recalcStats(c, g) {
    if (!c.potential) c.potential = {};
    syncSkillValues(c, c.potential);
    applyInnateBits(c, g);
    applyEquipment(c, g);
    applySkillCorrections(c, g);
    const st = calcMaxStats(c, { creatureId: c.get(27) });
    c.set(51, st.hpMax); c.set(56, st.mpMax); c.set(53, st.spMax);
    if (c.get(50) > st.hpMax) c.set(50, st.hpMax);
    if (c.get(55) > st.mpMax) c.set(55, st.mpMax);
    if (c.get(52) > st.spMax) c.set(52, st.spMax);
    refreshSpeed(c, g);
    return st;
  }

  /**
   * 升一级 —— *label_2145。
   * @returns {{leveled:boolean, level:number, unimpl:string[]}}
   */
  function levelUp(c, g) {
    const unimpl = [];
    const unlocked = [];
    const v65 = (n) => (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0;
    const set65 = (n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v); };
    const need = expNeeded(c);
    c.set(36, need);
    c.set(35, Math.max(0, (c.get(35) | 0) - need));     // 211855-211858
    if (cbitOf(c, 960) === 1) return { leveled: false, level: c.level, unimpl };   // 211859
    c.level = (c.level | 0) + 1;                        // 211860
    let bonus = limit(idiv(5 * (100 + sorg(c, 14) * 10), 300 + c.level * 15) + 1, 5, 15);  // 211883
    if (c.index === 0) {
      // 211884-211903：法术奖励点 var_65(660)/311
      if (v65(660) >= 100 && v65(23) !== 2 && v65(23) !== 5) {
        set65(660, v65(660) - bonus); set65(311, v65(311) - bonus);
      }
      set65(660, v65(660) + bonus); set65(311, v65(311) + bonus);
      // 211905-211908
      if (v65(612) < 10) set65(612, v65(612) + 1);
      // 211909-211915
      if (c.level % 5 === 0 && c.get(48) < c.level && c.level <= 50) set65(93, v65(93) + 1);
      // 211916：label_2229（新能力习得）
      if (Elona.Feat && Elona.Feat.unlockAbilities) {
        const u = Elona.Feat.unlockAbilities(c, g);
        for (const x of u.unlocked) unlocked.push(x);
        for (const x of u.unimpl) unimpl.push(x);
      } else unimpl.push('label_2145:label_2229-abilities');
      bonus += (Elona.Feat ? Elona.Feat.get(c, 154) : 0);   // 211917
    }
    if (c.index === 0) {
      // 211919-211927：技能奖励点 var_58(41)/var_65(310)
      if (c.get(41) >= 100 && v65(23) !== 2 && v65(23) !== 5) {
        c.set(41, c.get(41) - bonus); set65(310, v65(310) - bonus);
      }
      c.set(41, c.get(41) + bonus); set65(310, v65(310) + bonus);
    }
    // 211940-211947：mutant 成长（游玩期 var_685 = 0 → growMutantPart 内播报，211747）
    if ((c.raceName === 'mutant' || (c.index === 0 && Elona.Feat && Elona.Feat.get(c, 0) === 1))
      && c.level < 37 && c.level % 3 === 0 && c.get(48) < c.level) {
      if (Elona.EquipGen) Elona.EquipGen.growMutantPart(g, c);
    }
    if (c.get(48) < c.level) c.set(48, c.level);          // 211949-211951
    // 211952-211954：NPC index>=16 的潜力成长（label_2150；var_552 = 173,106,108）
    if (c.index >= 16) {
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      if (!c.potential) c.potential = {};
      for (let a = 10; a < 20; a++) {
        const cur = c.potential[a] || 0;
        c.potential[a] = limit(cur + 1000000 * R(3), 1, 2000 * 1000000);
      }
      for (const sk of [173, 106, 108]) {
        const cur = c.potential[sk] || 0;
        c.potential[sk] = limit(cur + 1000000 * R(3), 1, 2000 * 1000000);
      }
    }
    c.set(36, expNeeded(c));                              // 211955 label_2151
    recalcStats(c, g);                                    // 211956 label_2174
    return { leveled: true, level: c.level, unimpl, unlocked };
  }

  /** 回合结束时检查经验是否够升级（*label_4357 604850-604858） */
  function checkLevelUp(c, g) {
    const out = { levels: 0, unimpl: [], unlocked: [] };
    if (!c || c.get(0) !== 1) return out;
    let guard = 0;
    while ((c.get(35) | 0) >= expNeeded(c) && cbitOf(c, 960) !== 1 && guard++ < 100) {
      const r = levelUp(c, g);
      if (!r.leveled) break;
      for (const u of r.unimpl) if (out.unimpl.indexOf(u) < 0) out.unimpl.push(u);
      for (const u of (r.unlocked || [])) if (out.unlocked.indexOf(u) < 0) out.unlocked.push(u);
      out.levels++;
    }
    if ((c.get(36) | 0) === 0) c.set(36, expNeeded(c));
    return out;
  }

  // ==========================================================================
  // 速度刷新 —— refreshspeed (193826-194036)
  //
  //   var_58(11) = var_82(18)（速度技能）
  //     · var_58(68)（负重/减速%）且 var_58(409)!=3 → 按百分比减速
  //     · 最低 10
  //     · var_58(259)>0（骑乘/特殊移动）→ +var_82(190)*2/5（creature 910 为 *3/5）
  //     · 玩家/高 index：var_58(52)（体力）<0 → ×7/10；<25 → ×8/10；<50 → ×9/10
  //     · creature 1128 → 按 var_58(214) 阶梯加成
  //     · feat 46（193926-193945）：无 relation==10 的同伴时 +sorg(18)/5
  //     · var_58(39)（193925-194001）：饱食/体力/负重档位造成的速度修正
  //       （由 603958 复制到 var_58(37)，主循环 603045/603075 依此排行动顺序）
  //   未移植：var_65(183) 骑乘同步（193878-193923）、194002-194032 的月度事件修正
  //   （依赖 var_126 / var_132 / var_65(850) 等未移植全局）。
  // ==========================================================================
  function refreshSpeed(c, g) {
    const V = (n) => c.get(n);
    const S = (n, v) => c.set(n, v);
    const v65 = (n) => (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0;
    const unimpl = [];
    let sp = c.skill(18);                                  // 193827
    if (V(68) !== 0 && V(409) !== 3) {                     // 193828-193832
      sp = idiv(c.skill(18) * limit(100 - V(68), 0, 100), 100);
    }
    if (sp < 10) sp = 10;                                  // 193833-193835
    if (V(412) === 0) unimpl.push('inv_find:972');         // 193836-193841
    if (v65(850) === 44 && v65(5) > 55 && v65(6) > 32) S(259, 0);   // 193842-193844
    if (v65(850) === 70 && v65(5) > 39 && v65(6) > 33) S(259, 0);   // 193845-193847
    if (V(259) > 0) {                                      // 193848-193855
      if (V(27) === 910) sp += idiv(c.skill(190) * 3, 5);
      else sp += idiv(c.skill(190) * 2, 5);
    }
    if (c.index !== 0) {                                   // 193856-193870
      if (V(52) < 0) sp = idiv(sp * 7, 10);
      else if (V(52) < 25) sp = idiv(sp * 8, 10);
      else if (V(52) < 50) sp = idiv(sp * 9, 10);
    }
    if (V(27) === 1128 && V(58) === 0) {                   // 193871-193877
      if (sp >= 50) sp = idiv(sp, 50) * (50 + V(214));
    }
    S(11, sp | 0);
    // ---- 193878-193923：骑乘同步（var_58(168)=骑乘中，var_58(167)=坐骑索引）----
    if (V(168) !== 0) {
      const mi = V(167);
      const m = (g && g.charas) ? g.charas[mi] : null;
      if (m) {
        let ms = m.skill(18);                                  // 193879
        if (m.get(68) !== 0 && m.get(409) !== 3) {             // 193880-193884
          ms = idiv(m.skill(18) * limit(100 - m.get(68), 0, 100), 100);
        }
        if (ms < 10) ms = 10;                                  // 193885-193887
        // 193888-193893：inv_find 972 未移植
        if (v65(850) === 44 && v65(5) > 55 && v65(6) > 32) m.set(259, 0);   // 193894-193896
        if (v65(850) === 70 && v65(5) > 39 && v65(6) > 33) m.set(259, 0);   // 193897-193899
        if (m.get(259) > 0) ms += idiv(m.skill(190), 2);       // 193900-193902
        // 193903-193917：原码条件为 var_58(167, rider) / var_58(167, mount)——忠实复现
        if (V(167) !== 0 && m.get(52) < 0) ms = idiv(ms * 7, 10);
        if (m.get(167) !== 0) {
          const st = m.get(52);
          if (st >= 0 && st < 25) ms = idiv(ms * 8, 10);
          else if (st >= 25 && st < 50) ms = idiv(ms * 9, 10);
        }
        m.set(11, ms | 0);
        if ((ms | 0) < V(11)) S(11, ms | 0);                   // 193918-193920
        else if ((ms | 0) > V(11)) m.set(11, V(11));           // 193921-193923
      } else unimpl.push('refreshspeed:mount-missing');
    }

    // ---- 193925-193946：var_58(39) 复位 + feat 46 ----
    S(39, 0);
    if (Elona.Feat && Elona.Feat.get(c, 46) && c.index === 0) {
      let ally = false;
      const charas = (g && g.charas) || [];
      for (let k = 1; k < 245; k++) {
        const o = charas[k];
        if (o && o.get(0) === 1 && o.get(9) === 10) { ally = true; break; }
      }
      if (!ally) S(11, V(11) + idiv(sorg(c, 18), 5));
    }
    // 193947-193950：NPC 且不是当前坐骑 → 直接返回
    if (c.index !== 0 && v65(183) !== c.index) {
      return { speed: V(11) | 0, unimpl };
    }
    // 193952-193973：坐骑专用速度交换（0-DC 已移植 → core/riding.js）
    //   方式 0（你骑它）：你的速度 = SPD(坐骑)*100 / limit(100 + SPD - STR*3/2
    //                     - 乗馬(坐骑)/2 - 乗馬(你)*2 - (cbit22?50:0), 100, 1000000)
    //                   cbit25 → 再 /= 10；坐骑速度 = limit(STR(你)+乗馬(你), 10, SPD(坐骑))
    //   方式 1（它骑你）：你的速度 = limit(STR(你)+乗馬(坐骑), 10, SPD(你))
    //                   坐骑速度 = SPD(你)*100 / limit(...) 且不超过 SPD(坐骑)*3
    if (v65(183) !== 0) {
      if (Elona.Riding && Elona.Riding.applySpeed) {
        Elona.Riding.applySpeed(g, c);
      } else {
        unimpl.push('refreshspeed:mount-speed');
        return { speed: V(11) | 0, unimpl };
      }
      if (c.index !== 0) return { speed: V(11) | 0, unimpl };
    }
    // ---- 193974-194001：饱食 / 体力 / 负重档位 ----
    const v1045 = idiv(V(22), 1000) * 1000;
    if (v1045 < 1000) S(39, V(39) - 30);
    if (v1045 < 2000) S(39, V(39) - 10);
    if (V(52) < 0) S(39, V(39) - 30);
    if (V(52) < 25) S(39, V(39) - 20);
    if (V(52) < 50) S(39, V(39) - 10);
    if (V(45) >= 3) S(39, V(39) - 50);
    else if (V(45) === 2) S(39, V(39) - 30);
    else if (V(45) === 1) S(39, V(39) - 10);
    // ---- 194002-194031：载具超重惩罚 ----
    //   var_65(80) > var_65(82) → var_58(39) -= 25 + 25 * (weight / (cap + 1))
    //   · 无陆上载具（var_65(250+417)==0）：var_126(6)==1（世界地图）或 ==4 时生效
    //   · 陆上载具等级 1~2：仅 var_126(6)==1 时生效
    //   · 陆上载具等级 3~4：仅 var_126(6)==1 时生效，且惩罚减半
    // var_126(6) 是地图类型（世界地图 == 1）。
    if (Elona.Vehicle && Elona.Vehicle.overweightPenalty) {
      const lv = v65(417);            // var_65(250+417)：陆上载具等级
      const mapType = (g && g.map && g.map.header) ? (g.map.header[6] | 0) : 0;
      const weight = v65(80);         // var_65(80)：货物重量
      const cap = v65(82);            // var_65(82)：荷车负重上限
      if (weight > cap) {
        if (lv === 0) {
          if (mapType === 1 || mapType === 4) {
            S(39, V(39) - Elona.Vehicle.overweightPenalty(g, weight, cap, 0));
          }
        } else if (mapType === 1) {
          S(39, V(39) - Elona.Vehicle.overweightPenalty(g, weight, cap, lv));
        }
      }
    }
    // 194032：月度事件的额外修正（依赖未移植全局）
    if (v65(850) === 47 || v65(667) !== 0) unimpl.push('refreshspeed:monthly');
    return { speed: V(11) | 0, unimpl };
  }

  // ==========================================================================
  // 技能成长 —— modgrowth / skillmod / skillexp / skillgain（31818-32216）
  //
  // var_82(id+600, chara) 的打包格式（已确认）：
  //     潜力(sorg) * 1000000 + 经验(sexp) * 1000 + 成长率(sgrowth)
  //   本项目以 c.potential[id] 保存该打包值，c.skill(id) 为其 / 1000000。
  //
  //   modgrowth(chara, skill, delta)  31818-31830
  //   skillgain(chara, skill, lv, exp) 31831-31856 —— 潜力为 0 时「习得」技能
  //   skillmod (skill, chara, exp)    31859-31925  —— 直接改经验（可负）
  //   skillexp (skill, chara, exp, 除数, 教师)     31926-32216
  // ==========================================================================
  function rawPotential(c, id) { return (c.potential && c.potential[id]) || 0; }
  function storeRaw(c, id, raw) {
    if (!c.potential) c.potential = {};
    c.potential[id] = raw | 0;
    c.setSkill(id, idiv(raw, 1000000));
  }
  /** sexp(skill, chara) = var_82(id+600)/1000 \ 1000 */
  function sexp(c, id) { return idiv(rawPotential(c, id), 1000) % 1000; }
  /** sgrowth(skill, chara) = var_82(id+600) \ 1000 */
  function sgrowth(c, id) { return rawPotential(c, id) % 1000; }

  const V65 = (g, n) => (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0;
  const setV65 = (g, n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v); };

  /** modgrowth（31818-31830） */
  function modGrowth(c, skillId, chara, delta, g) {
    let gr = sgrowth(c, skillId) + delta;
    if (gr > 400) gr = 400;
    if (gr < 1) {
      gr = 1;
      if (V65(g, 273) === 5) gr = 2;
    }
    storeRaw(c, skillId, sorg(c, skillId) * 1000000 + sexp(c, skillId) * 1000 + gr);
    return gr;
  }

  /** skillgain（31831-31856）：已有潜力则只加成长率；否则「习得」技能 */
  function skillGain(c, chara, skillId, level, exp, g) {
    // 31832-31836：技能 400+ 且角色 0 → 魔力库存（var_495）
    if (skillId >= 400 && chara === 0) {
      // var_495(spellId-400)：独立的 200 格魔力库存数组（chara.spellStock）
      if (c.spellStock) c.spellStock[skillId - 400] += (exp || 0);
    }
    if (sorg(c, skillId) !== 0) {
      if (skillId < 400) modGrowth(c, skillId, chara, 20, g);
      return 0;
    }
    let pot = sorg(c, skillId) + (level || 0);          // 31843-31846
    if (pot < 1) pot = 1;
    if (skillId >= 400) modGrowth(c, skillId, chara, 200, g);   // 31847-31852
    else modGrowth(c, skillId, chara, 50, g);
    storeRaw(c, skillId, limit(pot, 0, 2000) * 1000000 + sexp(c, skillId) * 1000 + sgrowth(c, skillId));
    return 1;
  }

  /** skillmod（31859-31925）：直接改动经验，返回 1 = 有等级变化 */
  function skillMod(c, skillId, chara, exp, g) {
    let pot = sorg(c, skillId);
    let e = sexp(c, skillId) + exp;
    let gr = sgrowth(c, skillId);
    if (gr < 1) { gr = 1; if (V65(g, 273) === 5) gr = 2; }
    if (e >= 1000) {
      const lv = idiv(e, 1000);
      pot += lv;
      e = e % 1000;
      storeRaw(c, skillId, limit(pot, 0, 2000) * 1000000 + e * 1000 + gr);
      return 1;
    }
    if (e < 0) {
      // 31889-31900：var_777 = -var_775 / 1000 + 1 ; var_775 = 1000 + var_775 \ 1000
      // 注意：e = 1000 时会被编码进位到潜力位（98e6 + 1000*1000 = 99e6），
      // 因此净效果是「潜力 -1、余经验 0」，与源码的编码方式一致。
      let lv = idiv(-e, 1000) + 1;
      e = 1000 + (e % 1000);
      if (pot - lv < 1) {
        lv = pot - 1;
        if (pot === 1 && lv === 0) e = 0;
      }
      pot -= lv;
      for (let i = 0; i < lv; i++) {
        gr = Math.trunc(gr * 1.1) + 1;
        if (gr > 400) gr = 400;
      }
      storeRaw(c, skillId, limit(pot, 0, 2000) * 1000000 + e * 1000 + gr);
      return 1;
    }
    storeRaw(c, skillId, limit(pot, 0, 2000) * 1000000 + e * 1000 + gr);
    return 0;
  }

  /**
   * skillexp（31926-32216）—— 技能经验获取。
   * @param {number} skillId 技能 id（prm_671）
   * @param {number} chara   角色下标（prm_672）
   * @param {number} exp     经验（prm_673，可负）
   * @param {number} [divisor] 除数（prm_674；9999 = 特殊，不做 6 折以下的成长衰减）
   * @param {number} [teacher] 教师/等级基准（prm_675，默认 0）
   * @param {object} [g] 可选：提供 rng / getV65
   * @returns {number} 1 = 升级，0 = 未升级
   */
  function skillExp(c, skillId, chara, exp, divisor, teacher, g) {
    g = g || c.__game || Elona.__game || null;
    const div = divisor === undefined ? 0 : divisor;
    const tea = teacher === undefined ? 0 : teacher;
    if (sorg(c, skillId) <= 0) return 0;
    if (exp === 0) return 0;
    if (div !== 9999) {
      // 关联技能分摊（var_83(0, skillId) = 动作表 f0）
      const rel = (Elona.Spell && Elona.Spell.field) ? Elona.Spell.field(skillId, 0) : 0;
      if (rel !== 0) skillExp(c, rel, chara, idiv(exp, 2 + div), div, tea);
    }
    let pot = sorg(c, skillId);
    const capLv = limit(pot, 1, 400);
    const v779 = Math.trunc(Math.sqrt(capLv * 10)) * 2;
    let gr = sgrowth(c, skillId);
    if (div !== 9999 && gr === 0) return 0;

    let v = 0;
    if (exp > 0) {
      const base = c.get(160) + c.get(198) + 500;
      if (div === 9999) {
        v = (pot >= c.get(199) + 100)
          ? idiv((exp + idiv(16000, base) + 1) * 100, 100 + v779 * 10)
          : idiv(exp * 100, 100 + v779 * 10);
      } else {
        v = (pot >= c.get(199) + 100)
          ? idiv((exp + idiv(16000, base) + 1) * gr, 100 + v779 * 10)
          : idiv(exp * gr, 100 + v779 * 10);
      }
      if (skillId >= 10 && skillId < 19) {
        const bonus = c.get(270 + skillId - 10);
        if (bonus > 0) v = idiv(v * (100 + bonus), 100);
      }
      if (v > 0) v = idiv(idiv(v, 4) * (V65(g, 252) + 100), 100);
      if (pot < V65(g, 189)) v = v * 4;
      if (V65(g, 273) === 5 && v === 0) v = 1;
      if (v === 0) {
        if (((g && g.rng) || Elona.rng).rnd(idiv(v779, 10) + 1) === 0) v = 1;
        else return 0;
      }
    } else {
      v = exp;
    }
    if (V65(g, 193) === 1200 && ((g && g.rng) || Elona.rng).rnd(10) <= 6) v = 0;
    if (V65(g, 20) === 35) v = 0;
    if (Elona.Status && Elona.Status.cbit(c, 985)) v = 0;

    // 32005-32042：教师/职业类型的 3 倍加成（依赖 var_65(250+420)）
    if (V65(g, 173) === 0 && chara < 16 && div !== 9999) {
      // 【0-CU 修正】源码是 var_65(250 + 420) = 槽位 670，此前误读 420
      const t = Elona.Daily ? Elona.Daily.group(g) : limit(V65(g, 670), 0, 4);
      const S3 = {
        0: [153, 154, 155, 164, 169, 170, 171, 181],
        1: [152, 166, 167, 168, 173, 186, 187, 189],
        2: [156, 160, 176, 177, 178, 179, 180, 183, 184, 185, 300],
        3: [157, 158, 159, 163, 175, 182, 190, 301],
        4: [150, 151, 161, 162, 165, 172, 174, 188],
      };
      let hit = (S3[t] || []).indexOf(skillId) >= 0;
      if (t === 1 && skillId >= 100 && skillId < 112) hit = true;
      if (hit) v = v * 3;
      if (skillId >= 400 && skillId < 492 && c.get(428) === 1 && V65(g, 175) !== 11111111) v = v * 3;
    }
    // 32043-32047
    if (c.get(279) > 0 && skillId >= 100 && skillId < 302) v = idiv(v * 11, 10);
    // 32048-32055
    if (skillId >= 100) {
      if (chara === 0) v = v * 3;
      else if (chara < 16) v = v * 4;
    }
    if (v > 20000) v = 20000;
    if (V65(g, 273) === 2 && v > 0) v = v * (V65(g, 639) + 3);
    if (V65(g, 90) >= 50 && (chara === 0 || chara < 16)) v = 0;
    if (V65(g, 273) === 5 && chara < 16 && v < V65(g, 640)) v = V65(g, 640);

    // 32076-32125：把经验计入对应「冒险日和」组；达 15000 时完成度 +1（上限 7）
    if (v > 0 && Elona.Daily) Elona.Daily.addGroupExp(g, skillId, v);

    // 32126-32141：技能使用积累（var_58(35) / var_65(92)）
    if (v > 0 && skillId >= 100 && tea !== 1000) {
      const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
      const denom = c.get(38) + tea;
      const v780 = (c.get(36) < 1000)
        ? R(idiv(c.get(36) * v, 1000 * (denom || 1)) + 1) + R(2)
        : R(idiv(idiv(c.get(36), 1000) * v, denom || 1) + 1) + R(2);
      c.set(35, c.get(35) + v780);
      if (chara === 0) setV65(g, 92, V65(g, 92) + v780);
    }

    // 32142-32216：经验并入与等级变化
    v += sexp(c, skillId);
    if (v >= 1000) {
      let lv = idiv(v, 1000);
      v = v % 1000;
      pot += lv;
      for (let i = 0; i < lv; i++) {
        if (div !== 9999 && V65(g, 273) !== 2 && V65(g, 273) !== 5) {
          gr = Math.trunc(gr * 0.9);
          gr = Math.trunc(gr * 0.9);
        }
        gr -= 5;
        if (gr <= 1) { gr = 0; if (V65(g, 273) === 5) gr = 1; }
      }
      storeRaw(c, skillId, limit(pot, 0, 2000) * 1000000 + v * 1000 + gr);
      return 1;
    }
    if (v < 0) {
      let lv = idiv(-v, 1000) + 1;
      v = 1000 + (v % 1000);
      if (pot - lv < 1) {
        lv = pot - 1;
        if (pot === 1 && lv === 0) v = 0;
      }
      pot -= lv;
      for (let i = 0; i < lv; i++) {
        gr = Math.trunc(gr * 1.1) + 1;
        if (gr > 400) gr = 400;
      }
      storeRaw(c, skillId, limit(pot, 0, 2000) * 1000000 + v * 1000 + gr);
      return 1;
    }
    storeRaw(c, skillId, limit(pot, 0, 2000) * 1000000 + v * 1000 + gr);
    return 0;
  }

  // ==========================================================================
  // 固有 cbit 基表 —— *label_2175 的 213388-213457
  //
  //   · 玩家（index 0）：var_58(450..479) 清零；var_97(161)!=0 时卸除价值 >2000 的装备
  //   · 其他角色：把 var_1405(0..29, creatureId) 整块复制进 var_58(450..479)
  //     （creature 343 用 var_1404——来自存档的 NPC 数据，未移植）
  //   · 213412-213449：按 var_58(214) 档位追加 cbit
  //   · 213452-213457：var_1406(cnt, var_58(158)) —— 源码无初始赋值（全 0），等效空操作
  // ==========================================================================
  let CREATURE_BITS = null;

  function applyInnateBits(c, g) {
    const unimpl = [];
    const cbitmod = (bit, on) => { if (Elona.Status) Elona.Status.cbitmod(c, bit, on); };
    if (c.index === 0) {
      // 213392：memset var_58(450), 0, 30*4
      for (let i = 450; i < 480; i++) c.set(i, 0);
      // 213393-213404：var_97(161) 未移植
    } else {
      for (let i = 450; i < 480; i++) c.set(i, 0);
      if (c.get(27) === 343) {
        unimpl.push('innate-bits:creature343-var_1404');
      } else {
        const bits = CREATURE_BITS && CREATURE_BITS[String(c.get(27))];
        if (bits) for (const b of bits) cbitmod(b, true);
      }
    }
    // 213412-213449：按 var_58(214) 档位
    const tier = c.get(214);
    const cid = c.get(27);
    if (tier >= 1) {
      if ([267, 276, 275, 268, 277, 162, 234, 95, 96, 228, 229, 450, 535, 45, 46].indexOf(cid) >= 0) cbitmod(5, true);
      if (cid === 24 || cid === 264) cbitmod(1031, true);
    }
    if (tier >= 2) {
      if (cid === 363) cbitmod(5, true);
      if (cid === 211) cbitmod(29, true);
      if (cid === 6) cbitmod(28, true);
      if (cid === 168) cbitmod(33, true);
      if (cid === 65 || cid === 66 || cid === 191) cbitmod(1031, true);
    }
    if (tier >= 3) {
      if (cid === 166) cbitmod(5, true);
      if (cid === 748) cbitmod(1031, true);
    }
    if (tier >= 10) {
      if (cid === 165 || cid === 361 || cid === 176) cbitmod(32, true);
    }
    return { unimpl };
  }

  Elona.Stats = {
    calcMaxStats, idiv, limit, ATTR, skillInit, syncSkillValues, sorg, applyEquipment,
    applySkillCorrections, refreshSpeed, EQ_FIELDS: EQ,
    sexp, sgrowth, modGrowth, skillMod, skillExp, skillGain,
    applyInnateBits,
    expNeeded, recalcStats, levelUp, checkLevelUp,
    setCreatureBits(t) { CREATURE_BITS = t; },
    async loadCreatureBits() {
      if (!CREATURE_BITS) CREATURE_BITS = await Elona.Data.table('creature_bits');
      return CREATURE_BITS;
    },
  };
})(window);
