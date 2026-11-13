'use strict';
/**
 * 战斗模块 —— 对应原版 calcattackhit / calcattackdmg / dmghp(核心) / role / dist
 *
 * 【已确认公式来源（start.hsp 行号）】
 *   骰子:      role(dice, sides, bonus) = Σ(dice × (rnd(sides)+1)) + bonus      (37434)
 *              rolemax(dice, sides, bonus) = dice × sides + bonus               (37446)
 *   距离:      dist = int(sqrt((x1-x2)^2 + (y1-y2)^2))   —— 欧氏距离，非切比雪夫 (31560)
 *   护甲技能:  carmor(c): var_58(64)>=35000→169 / >=15000→170 / 否则 171        (211690)
 *   命中:      calcattackhit(prm)                                                (212232)
 *                命中力 var_1370，回避力 var_1378；最终 rnd(命中) > rnd(回避) 则命中
 *   伤害:      calcattackdmg(prm)                                                (212911)
 *                var_89/var_90 = 骰子数/面数, var_1386 = 固定加成, var_1387 = 倍率(浮点)
 *                var_1389 = role(...) × 倍率；再按护甲(PV)减伤                    (213061-213105, 213277-213288)
 *
 * 【HSP 语义】所有 `/` 为整数除法（向零截断）；var_99 为物品实例数组。
 *
 * 【依赖说明】
 *   - findbuff()/cbit()：增益槽与位标志系统已移植到 core/status.js，
 *     本文件底部改为委托调用；但本文件的公式路径中**尚未使用**它们
 *     （相关分支仍以 * 标注跳过，后续接入对应系统时补齐）。
 *   - var_97()/var_65(): 全局状态表未移植 → 返回 0
 *   因此本模块实现的是「无增益、无特殊状态」的通用路径；带 *
 *   的注释标出被跳过的分支，后续移植对应系统时需补齐。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // ---------- 基础工具 ----------
  function role(rng, dice, sides, bonus) {
    if (dice < 1) dice = 1;
    if (sides < 1) sides = 1;
    let sum = 0;
    for (let i = 0; i < dice; i++) sum += rng.rnd(sides) + 1;
    return sum + bonus;
  }
  function rolemax(dice, sides, bonus) { return dice * sides + bonus; }
  function dist(x1, y1, x2, y2) {
    const d = (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    return Math.trunc(Math.sqrt(d));
  }
  function carmor(c) {
    const w = c.get(64);
    if (w >= 35000) return 169;
    if (w >= 15000) return 170;
    return 171;
  }
  // 增益槽 / 位标志系统已移植到 core/status.js（cbit/cbitmod/findbuff/addbuff）。
  // 此处委托给它，避免重复实现；status.js 未加载时退化为「无增益 / 位为 0」。
  const findbuff = (c, id) => (Elona.Status ? Elona.Status.findbuff(c, id) : -1);
  const cbit = (c, bit) => (Elona.Status ? Elona.Status.cbit(c, bit) : 0);

  /**
   * 防御方种族暴击抗性 var_58(415)（212576-212780 的种族名 → 修正值表；
   * 只在 var_58(415)==0/100 时初始化，默认 5）。
   */
  const RACE_CRIT = {
    kobolt: 8, orc: 8, largeanimal: 7, lizardman: 7, minotaur: 7,
    yerles: 6, norland: 6, eulderna: 6, fairy: 6, asura: 7, slime: 8,
    doggod: 1, dwarf: 6, juere: 6, zombie: 7, elea: 6, rabbit: 8, sheep: 7,
    frog: 9, worm: 9, snail: 11, medusa: 7, cupid: 6, karune: 6, harpy: 7,
    dragon: 4, dinosaur: 7, beast: 6, spider: 8, golem: 5, rock: 9,
    zanan: 6, skeleton: 6, piece: 7, cat: 6, dog: 7, roran: 7, rat: 8,
    shell: 8, catgod: 1, machinegod: 1, undeadgod: 1, machine: 7, wisp: 6,
    bird: 8, seamonster: 7, catsister: 5, mutant: 7, yeek: 8, yith: 5,
    servant: 6, horse: 7, god: 1, quickling: 1, metal: 1, vehicle: 6,
  };

  // 気力吐息（var_58(182)>=100）时按武器种类触发的法术表
  // （*label_3007 347717-347787 → tools/extract_weaponspells.py → weaponspells.json）
  let WSPELLS = null;
  async function loadWeaponSpells() {
    if (!WSPELLS) WSPELLS = await Elona.Data.table('weaponspells');
    return WSPELLS;
  }
  function setWeaponSpells(t) { WSPELLS = t; }

  /**
   * 会心判定 —— calcattackhit 尾段 212553-212575。
   * var_1139 在原版是全局副作用；此处改为返回值。
   */
  function critCheck(g, att, def, rng) {
    // 212553-212559：自身低 HP（cbit 1003）时按 HP 比触发会心
    if (cbit(att, 1003) && att.get(50) >= 0) {
      if (limit(idiv(att.get(51), att.get(50) + 1), 1, 20) > rng.rnd(20)) return true;
    }
    // 212561-212575
    if (rng.rnd(5000) * ((g.var1380 | 0) + 1) < att.skill(13) + 50) {
      if (cbit(def, 1003) && def.get(50) >= 0) {
        if (limit(idiv(def.get(51), def.get(50) + 1), 1, 20) > rng.rnd(5)) return false;
      }
      if (findbuff(def, 33) !== -1 && def.get(64) < 15000) return false;
      return true;
    }
    return false;
  }

  /**
   * 护甲/回避相关量（calcattackdmg 213061-213105）
   * 返回 { pvArmor: var_1391, dice: var_1393, sides: var_1394, bonus: var_1395 }
   */
  function calcArmor(def) {
    let r1275 = def.get(76);
    if (def.get(70) < 0) r1275 = 100;
    let r1390 = idiv((def.get(70) + idiv(r1275, 25)) * r1275, 100);
    if (def.get(60) >= 100) r1390 = 0;          // 睡意>=100（睡着）→ 护甲无效

    let r1391 = r1390
      + limit(idiv(def.skill(carmor(def)), 4) - def.get(179) * 100, 0, 2000)
      + idiv(def.skill(12), 10);
    // * 跳过 cbit(1003, def) 的低血量加成分支（位标志系统未移植）

    let dice = 0, sides = 1, bonus = 0;
    if (r1391 > 0) {
      const r1392 = idiv(r1391, 4);
      const r1393 = idiv(r1392, 10) + 1;
      dice = r1393;
      sides = idiv(r1392, r1393) + 2;
      bonus = 0;
    } else {
      r1391 = 0;
    }
    return { pvArmor: r1391, dice, sides, bonus };
  }

  /**
   * 完整命中判定 —— calcattackhit
   * @param {object} g    游戏对象（需要 g.rng）
   * @param {object} att  攻击者 Chara
   * @param {object} def  防御者 Chara
   * @param {object} weapon  武器 Item（可为 null）
   * @param {object} weapon2 副手武器 Item（可为 null）
   * @param {number} skillId 攻击技能 id（var_1322；106=格闘）
   * @param {number} atkType 攻击类型（var_1321）
   * @param {number} mode    prm：0=完整判定 1=只返回命中力 2=只返回回避力
   * @returns {Object} { result, hit, eva, pierce, critical }
   *   result: 1=命中, -1=未命中
   */
  /** 武器距离修正表（calcweaponfix 191405-192336 → weaponrange.json） */
  let WEAPON_RANGE = null;
  async function loadWeaponRange() {
    if (WEAPON_RANGE) return WEAPON_RANGE;
    WEAPON_RANGE = await Elona.Data.table('weaponrange');
    return WEAPON_RANGE;
  }
  function setWeaponRange(t) { WEAPON_RANGE = t; }
  function rangeOf(weapon) {
    const d = (WEAPON_RANGE && WEAPON_RANGE.default) || { fix: 0, dist: [] };
    if (!weapon || !WEAPON_RANGE) return d;
    return WEAPON_RANGE.weapons[String(weapon.id)] || d;
  }

  function calcAttackHit(g, att, def, weapon, weapon2, skillId, atkType, mode) {
    const rng = g.rng;
    mode = mode | 0;
    const sx = (c, id) => c.skill(id);
    const D = dist(att.x, att.y, def.x, def.y);

    // ---- 命中力 var_1370 ----
    let r1365, r1366, pierce;
    if (skillId === 106) {
      r1365 = idiv(sx(att, 12), 4) + idiv(sx(att, 106), 3) + sx(att, 106) + 50;
      r1366 = att.get(72);
      // 多段攻击加成：统计"装备类型 5"的件数（最多计 4 件）
      let cnt5 = 0;
      for (let i = 100; i < 130; i++) {
        if (idiv(att.get(i), 10000) === 5) cnt5++;
        if (cnt5 >= 4) break;
      }
      r1365 = idiv(r1365 * (cnt5 + 3), 3);
      pierce = limit(idiv(sx(att, 106), 7) + 15, 15, 50);
    } else {
      const wskill = weapon ? weapon.f[16] : 0;
      r1365 = idiv(sx(att, 12), 4) + idiv(sx(att, wskill), 3) + sx(att, skillId) + 50;
      r1366 = att.get(72)
        + (weapon ? weapon.f[13] + weapon.f[20] + (weapon.f[17] === 1 ? 1 : 0) : 0);
      if (weapon2) r1366 += weapon2.f[13] + weapon2.f[20];
      pierce = limit(idiv(sx(att, skillId), 7) + 15, 15, 50);
    }
    let r1370 = r1365 + r1366;
    // 212454-212456：特殊弹 type 2（穿甲弹）→ var_1016 = 100
    if (atkType === 2) pierce = 100;
    // 213217-213245：附魔「完全贯通」(39) —— var_58(66) 由 stats 按 pw/50 累加
    //   近战时：claymore 5% / limit(66,0,20)+limit(技能/100,0,15) > rnd(100) / var_1148==100
    //   命中后贯通率强制 100%，并让对方装备技能削弱 3 回合（var_58(148)=3）
    if (!g.var1323 && mode === 0) {
      let full = false;
      if (att.className === 'claymore' && rng.rnd(100) < 5) full = true;
      else if (limit(att.get(66), 0, 20) + limit(idiv(sx(att, skillId), 100), 0, 15) > rng.rnd(100)) full = true;
      else if ((g.var1148 | 0) === 100) full = true;
      if (full) {
        pierce = 100;
        def.set(148, 3);
      }
    }

    // 距离衰减（212261-212265）：var_1323==0 时才使用通用衰减
    if (!g.var1323 && atkType === 0 && mode === 0) {
      r1370 = idiv(r1370 * (10 - limit(D - 1, 0, 5)), 10);
    }
    if (atkType === 5) r1370 = idiv(r1370, 2);

    // 弓/投掷的距离修正表（212269-212290）：被祝福/浮游 buff 59 时改为 ×2
    if (skillId !== 106 && mode === 0) {
      const isRanged = (g.var1323 === 1 && skillId !== 103)
        || (g.var1323 !== 1 && skillId === 111);
      if (isRanged) {
        const idx = limit(D - 1, 0, 8);
        if (weapon && findbuff(att, 59) !== -1 && g.var1369 !== -1) {
          r1370 *= 2;
        } else {
          const dist = (rangeOf(weapon).dist || [])[idx];
          if (dist) r1370 = idiv(r1370 * dist, 100);
        }
      }
    }

    // ---- 骑乘的命中修正（212316-212365）----
    //   var_65(183) != 0 时：
    //     · 骑手（var_243 == 0）用 乗馬(301) 技能；坐骑（var_243 == var_65(183)）用 筋力(10)
    //     · feat 48「迅馬一体」（var_97(48) != 0）成立时骑手改用宽松档：
    //         var_1370 = var_1370 * 100 / limit(150 - 乗馬/2, 105, 125)   （212319）
    //       否则             * 100 / limit(150 - 乗馬/2, 115, 150)        （212343）
    //       坐骑一侧两种情形都是 115..150（212331）。
    //     · 重武器补正：var_1322 != 106（非格闘）且 var_1323 == 0（近战）且武器重量 >= 4000
    //         有 feat 48 → 减 (limit(w,1,10000) - 4000 + 100) / (100 + 技能*2)   （212324/212335）
    //         无 feat 48 → 减 (w - 4000 + 400) / (10 + 技能/5)                   （212348/212359）
    //       骑手额外要求「无 buff 35 或 装备总重 var_58(64) < 35000」（212323/212347）
    //   var_97 是 500 槽的单维数组（23411 `dim var_97, 500`），只有玩家有 feat，
    //   所以坐骑攻击时读的也是玩家的 feat 48。
    const mountIdx = (g.getV65 ? (g.getV65(183) | 0) : 0);
    if (mountIdx !== 0) {
      const feat48 = (Elona.Feat && Elona.Feat.get)
        ? (Elona.Feat.get(g.player || att, 48) | 0) : 0;
      const wWeight = weapon ? (weapon.f[7] | 0) : 0;
      const heavyOK = (skillId !== 106 && g.var1323 === 0 && wWeight >= 4000);
      if ((att.index | 0) === 0) {
        const riding = sx(att, 301);
        r1370 = idiv(r1370 * 100, limit(150 - idiv(riding, 2), feat48 ? 105 : 115,
          feat48 ? 125 : 150));
        if (heavyOK && (findbuff(att, 35) === -1 || (att.get(64) | 0) < 35000)) {
          r1370 -= feat48
            ? idiv(limit(wWeight, 1, 10000) - 4000 + 100, 100 + riding * 2)
            : idiv(wWeight - 4000 + 400, 10 + idiv(riding, 5));
        }
      }
      if ((att.index | 0) === mountIdx) {
        const str = sx(att, 10);
        r1370 = idiv(r1370 * 100, limit(150 - idiv(str, 2), 115, 150));
        if (heavyOK) {
          r1370 -= feat48
            ? idiv(limit(wWeight, 1, 10000) - 4000 + 100, 100 + str)
            : idiv(wWeight - 4000 + 400, 10 + idiv(str, 10));
        }
      }
    }

    // 连续攻击惩罚：var_1374 = 攻击回数
    if (g.var1374 > 1) {
      const r1375 = 100 - (g.var1374 - 1) * idiv(10000, 100 + sx(att, 166) * 10);
      if (r1370 > 0) r1370 = idiv(r1370 * r1375, 100);
    }
    if (mode === 1) return { result: 0, hit: r1370, eva: 0, pierce, critical: false };

    // ---- 回避力 var_1378 ----
    let r1274 = def.get(77);
    if (def.get(71) < 0) r1274 = 100;
    let r1377 = idiv(def.get(71) * r1274, 100) + r1274 - 100;
    if (def.get(60) >= 100) r1377 = 0;           // 睡意>=100（睡着）→ DV 无效

    let r1378 = idiv(sx(def, 13), 6) + sx(def, 173) + idiv(r1377 * 2 * 7, 4) + 25
      - def.get(148) * 100;
    if (def.get(266) === 1) r1378 += sx(def, 168) + idiv(sx(def, 11), 6);
    // 213083-213088：觉醒天赋「意地」(cbit 1003) —— HP 越少回避越高
    //   var_1391 = var_1391 * (100 + limit((HP/(maxHP+1) - 1) * 10, 0, 50)) / 100
    if (cbit(def, 1003) && (def.get(50) | 0) >= 0) {
      const ratio = idiv(def.get(51), (def.get(50) | 0) + 1);    // maxHP/(HP+1)
      r1378 = idiv(r1378 * (100 + limit((ratio - 1) * 10, 0, 50)), 100);
    }
    // * 跳过：地形/魔法控制(var_58(259))、骑乘与乘骑者加成
    if (r1378 <= 0) r1378 = 1;
    if (mode === 2) return { result: 0, hit: r1370, eva: r1378, pierce, critical: false };

    // ================= 判定段（212433-212910，0-CP 按源码全序移植） =================
    const V65 = (n) => (g.getV65 ? (g.getV65(n) | 0) : 0);
    const wid = weapon ? (weapon.id | 0) : -1;
    const crit = () => ({ result: 1, hit: r1370, eva: r1378, pierce, critical: true });
    const hitR = () => ({ result: 1, hit: r1370, eva: r1378, pierce, critical: false });
    const missR = () => ({ result: -1, hit: r1370, eva: r1378, pierce, critical: false });

    // 212433-212438：剧情/神器必中暴击（武器 1182）
    if ((V65(801) > 0 || V65(663) > 0) && wid === 1182) return crit();
    // 212439-212448：var_65(194) 剧情必中（武器 806/807 豁免）
    if (V65(194) !== 0 && wid !== 806 && wid !== 807) return crit();
    // 212449-212455：var_65(175)==100 必中（武器 830 豁免）
    if (V65(175) === 100 && wid !== 830) return crit();
    // 212456-212458：特殊弹 3（魔弹）→ 必暴击命中
    if (atkType === 3) return crit();
    // 212459-212465：对方朦胧（var_58(256)）→ 1/8 暴击命中，且回避减半
    if ((def.get(256) | 0) !== 0) {
      if (rng.rnd(8) === 0) return crit();
      if (r1378 !== 0) r1378 = idiv(r1378, 2);
    }
    // 212466-212481：充能暴击 buff（buff 32）——武器带附魔 71 必暴击，否则 1/2 暴击
    if (findbuff(att, 32) !== -1) {
      let charge = 0;
      for (let i = 0; i < 15; i++) {
        const slot = att.get(40 + i * 2) | 0;
        if (slot === 0) break;
        if (slot === 71) { charge = 100; break; }
      }
      if (charge === 100) return crit();
      if (rng.rnd(2) === 0) return crit();
    }
    // 212482-212485：舍身攻击（var_1148==100）→ 必暴击命中
    if ((g.var1148 | 0) === 100) return crit();
    // 212486-212498：偷袭——对方无目标（var_58(29)==0）且未在战斗（var_58(201)==0）
    if ((def.get(29) | 0) === 0 && (def.get(201) | 0) === 0 && !cbit(def, 985)) {
      const relOK = (att.index | 0) === 0
        || ((att.get(9) | 0) >= -1 && (def.get(9) | 0) === -3)
        || ((def.get(9) | 0) >= -1 && (att.get(9) | 0) <= -2);
      if (relOK) {
        if (rng.rnd(3) === 0 || att.className === 'thief') {
          if (Elona.Stats && Elona.Stats.skillExp) {
            Elona.Stats.skillExp(att, 157, att.index | 0, 100, 0, 0, g);   // skillexp 157(隐蔽), 100
          }
          def.set(29, att.index | 0);
          def.set(201, 80);
          return crit();
        }
      }
    }
    // 212499-212506：分心——对方目标不是自己 → 回避减半、1/10 直接命中
    if ((def.get(29) | 0) !== (att.index | 0)) {
      if (r1378 !== 0) r1378 = idiv(r1378, 2);
      if (rng.rnd(10) === 0) return hitR();
    }
    // 212507-212520：命中修正（猎人职业 / 束缚 / var_65(193)==888）
    if (att.className === 'archer') r1370 = idiv(r1370 * 110, 100);
    if ((att.get(253) | 0) !== 0 && r1370 > 0) r1370 = idiv(r1370, 2);
    if (V65(193) === 888 && r1370 > 0) r1370 = idiv(r1370, 2);
    // 212521-212527：回避修正（束缚 / 固定）
    if ((def.get(253) | 0) !== 0 && r1378 !== 0) r1378 = idiv(r1378, 2);
    if ((def.get(268) | 0) !== 0) r1378 = 0;
    // 212528-212530：对方无敌（251）/固定>=20/睡眠（181<0）→ 直接命中
    if ((def.get(251) | 0) !== 0 || (def.get(268) | 0) >= 20 || (def.get(181) | 0) < 0) return hitR();
    // 212531-212540：剧情角色 1017（成长力事件分支）
    if ((def.get(27) | 0) === 1017 && (def.get(58) | 0) === 0) {
      const s2 = V65(252);
      if (s2 === 875) g.setV65 && g.setV65(252, 880);
      if (s2 === 885) g.setV65 && g.setV65(252, 890);
      return hitR();
    }
    // 212541-212547：攻击方朦胧 → 远程命中/5、近战 ×2/3
    if ((att.get(256) | 0) !== 0 && r1370 > 0) {
      if (g.var1323) r1370 = idiv(r1370, 5);
      else r1370 = idiv(idiv(r1370, 3) * 2, 1);
    }
    // 212553-212559：意志天赋暴击
    if (cbit(att, 1003) && (att.get(50) | 0) >= 0) {
      if (limit(idiv(att.get(51), (att.get(50) | 0) + 1), 1, 20) > rng.rnd(20)) return crit();
    }
    // 212561-212575：感知暴击 rnd(5000)*(追打+1) < 感知+50
    if (rng.rnd(5000) * ((g.var1380 | 0) + 1) < sx(att, 13) + 50) {
      let ok = 1;
      if (cbit(def, 1003) && (def.get(50) | 0) >= 0) {
        if (limit(idiv(def.get(51), (def.get(50) | 0) + 1), 1, 20) > rng.rnd(5)) ok = 0;
      }
      if (findbuff(def, 33) !== -1 && (def.get(64) | 0) < 15000) ok = 0;
      if (ok === 1) return crit();
    }
    // 212576-212780：防御方种族暴击抗性 var_58(415)（==0/==100 时按种族名初始化）
    if ((def.get(415) | 0) === 0 || (def.get(415) | 0) === 100) {
      def.set(415, RACE_CRIT[def.raceName] !== undefined ? RACE_CRIT[def.raceName] : 5);
    }
    // ---- 附魔暴击前置（212780-212850）----
    let r1381 = att.className === 'predator' ? 1 : 0;                 // 铁血战士 +1
    if (cbit(att, 1029)) {
      if (cbit(def, 1029)) r1381 -= 2;                                // 磁性互斥
      if (cbit(def, 1030)) r1381 += 2;                                // 磁性相吸
    }
    if (cbit(att, 1030)) {
      if (cbit(def, 1030)) r1381 -= 2;
      if (cbit(def, 1029)) r1381 += 2;
    }
    let r1382 = 400;                                                   // 重量修正
    if (skillId === 106) r1382 = 100;
    else {
      // var_1369 = 弹药下标（rangedAttack 写入）；有弹药时取弹药重量 var_99(7, var_1369)
      let wobj = weapon;
      if (g.var1369 !== undefined && g.var1369 !== null && g.var1369 !== -1) {
        const am = (typeof g.var1369 === 'object') ? g.var1369
          : (att.inv && att.inv[g.var1369]) || null;
        if (am && am.f) wobj = am;
      }
      if (wobj) r1382 = idiv(limit(idiv(wobj.f[7] | 0, 10), 1, 400), 2);
    }
    let r1383 = 0;                                                     // 追加攻击 buff 计数
    if (((att.get(32) | 0) & 2) !== 0) {
      for (let i = 100; i < 130; i++) {
        if (idiv(att.get(i) | 0, 10000) === 5) r1383++;
        if (r1383 >= 4) break;
      }
      if (r1383 === 1) r1383 = 0;
    }
    // 212851-212868：附魔暴击判定（var_58(67)=暴击附魔效果值；紧急回避 buff 33 使其失效）
    if (idiv(idiv(((att.get(67) | 0) * 4 + 10) * (r1383 + 10), 10) * (r1381 + 10), 10)
      > (rng.rnd(400) + rng.rnd(r1382 + 2) + (def.get(403) | 0) * 2)
        * ((g.var1380 | 0) + 1) * (idiv((def.get(415) | 0) * 2 + 8, 10))) {
      if (!(findbuff(def, 33) !== -1 && (def.get(64) | 0) < 15000)) return crit();
    }
    // 212869-212875：盾牌架挡（持盾风格 + buff 51）→ 被挡开视为未命中
    if (((def.get(32) | 0) & 1) !== 0 && findbuff(def, 51) !== -1) {
      if (((def.get(436) | 0) + 5) > rng.rnd(100)) return missR();
    }
    // 212876-212883：看穿判定（对方无重力异常 var_58(262)==0、看穿非 0、命中<看穿×10、
    //   C = 回避/命中×100 > 200 时 rnd(看穿 + C) > 100 → 看穿回避）
    if ((def.get(262) | 0) === 0 && sx(def, 187) !== 0 && r1370 < sx(def, 187) * 10) {
      let r1384 = idiv(r1378 * 100, limit(r1370, 1, r1370));
      if (r1384 > 1000) r1384 = 1000;
      if (r1384 > 200 && rng.rnd(sx(def, 187) + r1384) > 100) {
        return { result: -2, hit: r1370, eva: r1378, pierce, critical: false };
      }
    }

    // ---- 最终判定（212886-212909）----
    if (rng.rnd(20) === 1) return missR();
    if (rng.rnd(Math.trunc(Math.sqrt(limit(sx(att, 19), 1, 2000) + 1)) + 1) > rng.rnd(300)) {
      return hitR();
    }
    if (r1370 < 1) return missR();
    if (r1378 < 1) return hitR();
    const evaFinal = idiv(r1378 * 3, 2);
    if (rng.rnd(r1370) > rng.rnd(evaFinal)) {
      return { result: 1, hit: r1370, eva: evaFinal, pierce, critical: false };
    }
    return { result: -1, hit: r1370, eva: evaFinal, pierce, critical: false };
  }

  /**
   * 伤害计算 —— calcattackdmg
   * @param {number} mode prm：0=完整 1=只返回伤害(命中前) 2=只返回护甲值
   * @returns {Object} { dmg, armor, critical, dice:{n,s,b} }
   */
  function calcAttackDmg(g, att, def, weapon, weapon2, skillId, atkType, critical, pierce, mode) {
    const rng = g.rng;
    mode = mode | 0;
    const sx = (c, id) => c.skill(id);
    const D = dist(att.x, att.y, def.x, def.y);

    let r1386, r89, r90, r1387;
    if (skillId === 106) {
      r1386 = idiv(sx(att, 10), 16) + idiv(sx(att, 12), 16) + idiv(sx(att, 106), 16)
        + idiv(sx(att, 15), 20) + att.get(73);
      r89 = 2;
      r90 = limit(idiv(sx(att, 106), 5) + 10, 10, 120);
      r1387 = 0.5 + ((idiv(sx(att, 10), 2) + idiv(sx(att, 15), 2) + idiv(sx(att, 106), 5)
        + sx(att, 152) * 3) / 40);
    } else {
      const wskill = weapon ? weapon.f[16] : 0;
      r1386 = att.get(73)
        + (weapon ? weapon.f[12] + weapon.f[20] + (weapon.f[17] === 1 ? 1 : 0) : 0)
        + idiv(sx(att, 15), 10) + idiv(sx(att, 10), 30) + idiv(sx(att, 13), 30)
        + limit(idiv((weapon ? weapon.f[7] : 0) + 1, 5000), 0, 40)
        + idiv(sx(att, skillId), 50) * 5;
      r89 = weapon ? weapon.f[10] : 0;
      r90 = weapon ? weapon.f[11] : 0;
      if (weapon && itemEquipLoc(weapon) === 10 && skillId === 103) r90 = idiv(r90, 2);
      if (weapon && itemEquipLoc(weapon) === 5 && skillId === 111) {
        const wid = weapon.id;
        if (wid !== 1168 && wid !== 1165 && wid !== 1154 && wid !== 1150) r90 = idiv(r90, 2);
      }
      if (r89 <= 0) r89 = 1;
      if (r90 <= 0) r90 = 1;
      if (weapon && weapon.f[10] === 0) r89 = 4;
      if (weapon && weapon.f[11] === 0) r90 = 4;

      if (weapon2) {
        r1386 += weapon2.f[12] + weapon2.f[20] + idiv(weapon2.f[10] * weapon2.f[11], 2);
        r1387 = 0.5 + ((idiv(sx(att, 12), 2) + idiv(sx(att, 13), 2) + idiv(sx(att, wskill), 4)
          + idiv(sx(att, skillId), 4) + sx(att, 189) * 3) / 40);
      } else {
        r1387 = 0.6 + ((sx(att, 10) + idiv(sx(att, wskill), 5) + idiv(sx(att, skillId), 5)
          + sx(att, 152) * 3) / 45);
        if (wskill === 110 || wskill === 109 || wskill === 108 || skillId === 111) {
          r1387 = 0.6 + ((sx(att, 10) + idiv(sx(att, skillId), 5) * 2 + sx(att, 152) * 3) / 45);
        }
      }
    }
    // 距离衰减（212967-212971）：var_1323==0 时才使用通用衰减
    if (!g.var1323 && atkType === 0 && mode === 0) {
      r1387 = r1387 * (10 - limit(D - 1, 0, 5)) / 10;
    }
    // 弓/投掷距离修正（212973-213008）：伤害倍率 = 表值/2 + 50（%）
    // * 跳过 cbit(1044)/var_65(194) 的额外加成与 var_1372==100 分支
    if (g.var1323 && skillId !== 103 && mode === 0) {
      const idx = limit(D - 1, 0, 8);
      const dist = (rangeOf(weapon).dist || [])[idx];
      if (dist) r1387 = r1387 * (dist / 2 + 50) / 100;
    }

    // ---- 护甲(PV) ----
    const armor = calcArmor(def);
    const r1391 = armor.pvArmor;
    if (mode === 2) return { dmg: 0, armor: r1391, critical: !!critical };

    if (r1386 < -100) r1386 = -100;
    att.set(184, r1386);                 // 213049-213050：var_58(184) = 固定伤害加成
    r1387 = Math.trunc(r1387 * 100);      // 倍率转为 ×100 的整数

    let r1389 = role(rng, r89, r90, r1386);
    if (critical) {
      r1389 = rolemax(r89, r90, r1386);
      let r1396;
      if (skillId === 106) r1396 = sx(att, 106) * 400;
      else r1396 = (weapon2 ? weapon2.f[7] : (weapon ? weapon.f[7] : 0)) * 2;
      const cap = def.get(64) >= 15000 ? limit(r1396 - def.get(64), 1, 360000) : limit(r1396, 1, 360000);
      r1387 = idiv(r1387 * (Math.trunc(Math.sqrt(cap) / 3) + 100), 100);
    }
    r1389 = idiv(r1389 * r1387, 100);
    if (critical) r1389 += sx(att, 186) * Math.trunc(Math.sqrt(sx(att, 186) + 1));
    // * 跳过：findbuff(var_243,32) 的 10 倍暴走分支、毒/属性附加伤害

    // 213273-213274：特殊弹 type 5（散弹）→ 每发伤害 1/5
    if (atkType === 5) r1389 = idiv(r1389, 5);

    if (mode === 1) return { dmg: r1389, armor: r1391, critical: !!critical };

    // ---- 护甲减伤（213277-213288）----
    if (r1391 > 0) r1389 = idiv(r1389 * 100, 100 + idiv(r1391 * (150 - pierce), 150));
    const r1401 = idiv(r1389 * pierce, 100);        // 穿甲部分不受护甲骰子影响
    let r1402 = r1389 - r1401;
    if (r1391 > 0) {
      r1402 -= role(rng, armor.dice, armor.sides, armor.bonus);
      if (r1402 < 0) r1402 = 0;
    }
    r1389 = r1402 + r1401;

    // 其余乘算修正（213289-213352）
    if (def.get(434) > 0) r1389 = idiv(r1389 * 7, 4);
    if (def.get(90) !== 0) r1389 = idiv(r1389 * 100, limit(100 + def.get(90), 25, 1000));
    // * 跳过：findbuff 系列、cbit(28/33) 的伤害折算

    // 199004-199010：觉醒天赋「底力」(cbit 1004) —— 攻击者 HP 越少最终伤害越高
    //   if (var_1134 >= 10 && HP < maxHP/2 && HP >= 0)
    //       var_1134 = var_1134/10 * limit(10 + maxHP/(HP+1), 10, 30)
    if (cbit(att, 1004) && r1389 >= 10 && (att.get(50) | 0) >= 0
      && (att.get(50) | 0) < idiv(att.get(51) | 0, 2)) {
      r1389 = idiv(r1389, 10) * limit(10 + idiv(att.get(51), (att.get(50) | 0) + 1), 10, 30);
    }
    if (r1389 < 0) r1389 = 0;
    return { dmg: r1389, armor: r1391, critical: !!critical };
  }

  // 避免循环依赖：装备位置由 ItemDB 提供
  function itemEquipLoc(item) {
    return Elona.ItemDB ? Elona.ItemDB.equipLocById(item.id) : 0;
  }

  /**
   * 完整一次攻击 —— 命中判定 + 伤害 + 扣血
   * 对应 346122-346782 的骨架（已去掉所有表现层与控制台消息）
   * @returns {Object} 战斗结果描述
   */
  function attack(g, att, def, opts) {
    opts = opts || {};
    const weapon = opts.weapon || null;
    const weapon2 = opts.weapon2 || null;
    const skillId = opts.skillId !== undefined ? opts.skillId
      : (weapon ? weapon.f[16] : 106);
    const atkType = opts.atkType || 0;

    // 0-DD：记录「最后攻击对象」—— 角色数据条只显示它（HUD 用）
    if ((att.index | 0) === 0 && def) g.lastAttacked = def.index | 0;

    const hit = calcAttackHit(g, att, def, weapon, weapon2, skillId, atkType, 0);
    if (hit.result === -2) {
      // 0-CP：看穿回避（212876-212883）——区别于普通未命中
      return { hit: false, kanzen: true, dmg: 0, killed: false, hitPower: hit.hit, evaPower: hit.eva };
    }
    if (hit.result !== 1) {
      return { hit: false, dmg: 0, killed: false, hitPower: hit.hit, evaPower: hit.eva };
    }
    const critical = atkType === 3 ? true
      : ((opts.critical === undefined) ? !!hit.critical : !!opts.critical);
    const dmgR = calcAttackDmg(g, att, def, weapon, weapon2, skillId, atkType, critical, hit.pierce, 0);
    // 347256：主伤害用属性 64（物理近战，走 DV 减免）
    const applied = applyDamage(def, dmgR.dmg, g, att, 64, 1000);
    // 347265-347271：觉醒天赋「魅惑」(cbit 1002) —— 被近战直接攻击后，攻击者陷入朦胧(状态 7)
    //   dmgcon 攻击者, 7, limit(魅力(17), 200, 1000)
    if (applied > 0 && atkType === 0 && Elona.Status && Elona.Status.cbit
      && Elona.Status.cbit(def, 1002)) {
      if (Elona.Spell && Elona.Spell.dmgconOf) {
        const pow = limit(sx(def, 17), 200, 1000);
        Elona.Spell.dmgconOf(g, att, 7, pow);
      }
    }
    // 0-GH：击杀结算统一入口 —— 近战 / 远程 / 法术 / 能力 / 地面效果共用一套
    //   （经验、招募事件、盗窃掠夺、死灵暗棺、竞技场、掉落、委托进度）
    const death = (def.hp <= 0) ? onDeath(g, def, att) : null;
    const kill = death ? death.exp : null;
    return {
      hit: true,
      dmg: applied,
      killed: def.hp <= 0,
      kill,
      critical,
      hitPower: hit.hit,
      evaPower: hit.eva,
      armor: dmgR.armor,
    };
  }

  /**
   * 扣血 —— dmghp（197974-198610）逐步移植。
   *
   * 参数：`dmghp 目标, 伤害, 攻击者, 属性id, 属性参数`
   *   属性 id（var_1131）：
   *     0        无属性（固定伤害）
   *     50-60    元素（火炎/冷気/電撃/暗黒/幻惑/毒/地獄/音/神経/混沌/魔法）
   *     61       出血
   *     64       物理近战（走 DV 减免）
   *     68       特殊直接伤害（走「耐久+关系+好感」减免）
   *     702/707  无视大部分减免的固定伤害
   *   攻击者 -1/-2/… 负数是「无攻击者的系统伤害」（毒/饥饿/地形等）。
   *
   * 已实现：
   *   197986-197995  重伤翻倍 / 以太风削减 / 攻击者 267 减半
   *   197997-198040  **属性抗性链**（元素 50-60、物理 64、特殊 68）
   *   198481-198558  状态与种族倍率、速度差、连续被击累积减伤（var_58(444)）
   *   198591        附魔「攻击无效化」(53)
   *   199071-199080 觉醒天赋「障壁」(cbit 1005)
   *
   * 未接（依赖未移植子系统，登记 A245）：
   *   198136-198480  var_65(250+2)==900 的种族 1017「吸收」专属分支
   *   198562-198590  cbit(980) 契约（召唤物）到期解除
   *   198596-198604  var_65(250+387) / var_65(193)==888·4771 的剧情一击必杀
   *
   * @param {object} def     受伤者
   * @param {number} dmg     伤害（prm_986）
   * @param {object} [g]
   * @param {object} [att]   攻击者（prm_987）
   * @param {number} [attr]  属性 id（prm_988），默认 0
   * @param {number} [attrArg] 属性参数（prm_989）
   * @returns {number} 实际扣除的 HP
   */
  /**
   * 0-GH：死亡结算总入口（幂等）。
   *
   * 源码里没有单一函数：死亡效果分散在 `*label_2287`（201319 的掉落唯一调用点）、
   * dmghp 的 200426-200455（经验）与各事件分支。本项目原先按「谁打死的」分了三份，
   * 结果近战走 attackOne（有经验、无掉落）、远程走 fireAtTarget（有掉落、无经验）、
   * 状态/地面效果走 ai.runAll（只有掉落）。统一到这里后三条路径一致。
   *
   * 顺序（与原版的副作用顺序保持一致）：
   *   1. 同伴阵亡 → `Companion.onDeath`（var_58(0)=6，等复活；不掉落、不消失）
   *   2. 主击杀经验 → `KillReward.onKill`（200426-200455）
   *   3. 可招募物种 → `KillReward.queueRecruit`（200086-200160）
   *   4. 盗窃掠夺（200349-200360）
   *   5. 死灵从者 → 暗之棺（0-CW）
   *   6. 竞技场结算（0-CC）
   *   7. 死亡掉落 → `Loot.onDeath`（*label_2287；内部含地城主击破）
   *   8. `var_58(0) = 0`（194144 的 chara_vanquish 前半）
   *   9. 坐骑阵亡 → `Riding.end`
   *  10. 附近同伴斗志 +5（199945-199952）与委托进度（`Quest.onKill`）
   *
   * @param {object} g
   * @param {object} dead 死者
   * @param {object} [att] 击杀者（环境伤害可为 null）
   * @returns {object|null} 各子系统的结果；已结算过则返回上次的结果
   */
  function onDeath(g, dead, att) {
    if (!dead || typeof dead.get !== 'function') return null;
    if ((dead.get(0) | 0) !== 1) return null;
    if ((dead.hp | 0) > 0) return null;
    if (dead.__death) return dead.__death;
    const out = {
      exp: null, loot: null, recruit: null, arena: null, necro: null,
      companion: null, morale: null, quest: null, vanquished: false, gold: 0,
    };
    // 0-GQ / 200036-200348：死因文案（var_1165 / txt_select）与尸体清理
    //   （cell_removechara + 血痕 / 碎片）。放在玩家分支之前，玩家与 NPC 都会记录；
    //   负值来源（毒 -4 / 饿死 -3 等）可由调用方通过 DeathMsg.log 的 source 参数补。
    if (Elona.DeathMsg) {
      try {
        const src = Elona.DeathMsg.sourceOf(att, null);
        Elona.DeathMsg.log(g, dead, src, { attacker: att ? att.name : undefined });
        Elona.DeathMsg.cleanup(g, dead, src);
      } catch (e) { /* 死因文案失败不影响结算 */ }
    }
    // 玩家死亡走 game 的主循环（0-CQ / 0-FI），这里只记账
    if ((dead.index | 0) === 0) { dead.__death = out; return out; }

    // 0-HB / 196885-196891：总击杀数 var_65(2)++
    //   条件：玩家或同伴（index < 16）亲手击杀、死者不是自己/队伍成员（index >= 16、
    //   var_58(9) != 10）、且死者不带 cbit 992（深渊召唤的临时体）。
    if (att && (att.index | 0) >= 0 && (att.index | 0) < 16
      && (att.index | 0) !== (dead.index | 0) && (dead.index | 0) >= 16
      && (dead.get(9) | 0) !== 10 && !cbit(dead, 992)
      && g && typeof g.setV65 === 'function') {
      g.setV65(2, (g.getV65(2) | 0) + 1);
    }

    // 1. 同伴
    if (Elona.Companion && Elona.Companion.onDeath) {
      try { out.companion = Elona.Companion.onDeath(g, dead); } catch (e) { out.companion = null; }
    }
    if (!out.companion) {
      // 2. 经验 / AP
      if (att && Elona.KillReward && Elona.KillReward.onKill) {
        out.exp = Elona.KillReward.onKill(g, att, dead);
      }
      // 3. 招募事件
      if (Elona.KillReward && Elona.KillReward.queueRecruit) {
        out.recruit = Elona.KillReward.queueRecruit(g, dead);
      }
      // 3-b 200456-200484：击杀者是同伴（1..15、关系 >= 100）时，给其已会的
      //   采集系技能（163/185/180/151/159）练经验；死者不带 cbit 23/27/964 才算。
      //   `var_58(191..195)` 是各技能的「收获次数」计数（+limit(潜力/5,1,10)）。
      if (att && Elona.Stats && Elona.Status
        && (att.index | 0) > 0 && (att.index | 0) < 16
        && (att.get(17) | 0) >= 100
        && !(Elona.Status.cbit(dead, 23) || Elona.Status.cbit(dead, 27)
          || Elona.Status.cbit(dead, 964))) {
        const GATHER = [[163, 191], [185, 192], [180, 193], [151, 194], [159, 195]];
        out.gatherExp = [];
        for (const [skillId, cntField] of GATHER) {
          const pot = Elona.Stats.sorg ? (Elona.Stats.sorg(att, skillId) | 0) : 0;
          if (pot > 0) {
            att.set(cntField, (att.get(cntField) | 0) + limit(idiv(pot, 5), 1, 10));
            Elona.Stats.skillExp(att, skillId, att.index | 0, 5, 0, 0, g);
            out.gatherExp.push(skillId);
          }
        }
        if (!out.gatherExp.length) out.gatherExp = null;
      }
      // 4. 盗窃掠夺（200349-200360）：玩家/队友带盗窃技能时从尸体摸钱
      if (att && (att.index | 0) > 0 && typeof att.skill === 'function'
        && (att.skill(300) | 0) !== 0 && Elona.Status
        && !(Elona.Status.cbit(dead, 23) || Elona.Status.cbit(dead, 27)
          || Elona.Status.cbit(dead, 964) || Elona.Status.cbit(dead, 960))) {
        const sk = att.skill(300) | 0;
        let gain = Math.max(50, Math.min(2000, sk * 5 + 100));
        const victimGold = dead.get(30) | 0;
        if (gain > victimGold) gain = victimGold;
        if (gain > 0) {
          att.set(30, (att.get(30) | 0) + gain);
          dead.set(30, victimGold - gain);
          out.gold = gain;
          if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(att, 300, att.index | 0, 80, 1, 0, g);
          if (g && g.log) g.log(`${att.index === 0 ? '你' : att.name}从尸体上摸走了 ${gain} gold。`);
        }
      }
      // 5. 死灵从者 → 暗之棺
      if (Elona.Necro && Elona.Necro.onNecroDeath) {
        out.necro = Elona.Necro.onNecroDeath(g, dead);
        if (out.necro && out.necro.message && g.log) g.log(out.necro.message);
      }
      // 6. 竞技场
      if (Elona.Arena && Elona.Arena.onKill) {
        out.arena = Elona.Arena.onKill(g, dead);
        if (out.arena && out.arena.message && g.log) g.log(out.arena.message);
      }
      // 7. 掉落（*label_2287；地城主击破也在其中）
      if (Elona.Loot) {
        try { out.loot = Elona.Loot.onDeath(g, dead, att); } catch (e) { out.loot = null; }
      }
      // 8. 离开世界
      dead.set((Elona.ATTR && Elona.ATTR.ACTIVE !== undefined) ? Elona.ATTR.ACTIVE : 0, 0);
      out.vanquished = true;
    }
    // 9. 坐骑阵亡
    if (Elona.Riding && Elona.Riding.mountOf && Elona.Riding.mountOf(g) === (dead.index | 0)) {
      try { Elona.Riding.end(g); } catch (e) { /* 骑乘未就绪 */ }
    }
    // 10. 士气 / 委托
    if (att && Elona.Morale && Elona.Morale.onKill) {
      try { out.morale = Elona.Morale.onKill(g, att, dead); } catch (e) { out.morale = null; }
    }
    if (Elona.Quest && Elona.Quest.onKill) {
      try { out.quest = Elona.Quest.onKill(g, dead); } catch (e) { out.quest = null; }
    }
    if (g && typeof g.syncCharaCells === 'function') g.syncCharaCells();
    dead.__death = out;
    return out;
  }

  /**
   * 显式触发死亡结算（供「先扣血、后做事」的能力使用，见 `opts.deferDeath`）。
   */
  function checkDeath(g, dead, att) { return onDeath(g, dead, att); }

  function applyDamage(def, dmg, g, att, attr, attrArg, opts) {
    const A = (attr === undefined || attr === null) ? 0 : (attr | 0);
    const attIdx = (att && att.index !== undefined) ? (att.index | 0) : -1;
    let d = dmg | 0;
    if (d < 0) d = 0;
    if (!def || (def.get(0) | 0) !== 1) return 0;        // 197982 目标已死
    if ((def.hp | 0) > 0) def.__death = null;            // 复活/新回合 → 清结算标记
    // 0-EY / 199698-199712：元素 58（神）或 52（雷）伤害会杀死脑寄生虫（cbit 1045）
    if (g && Elona.FoodLeft && Elona.FoodLeft.cureBrainParasite) {
      Elona.FoodLeft.cureBrainParasite(g, def, A);
    }
    // 199063（dmghp）：防御態勢（var_58(266) == 1）受到的伤害变为 1/3。
    //   配合 212392 的命中侧回避加值（sorg(168) + sorg(11)/6），构成「防御」的全部效果。
    if ((def.get(266) | 0) === 1 && d > 0) d = Math.max(1, idiv(d, 3));
    // 199065-199069：金属外套（736 发动 → var_58(265) = 6）受到的伤害变为 1/10，随后清空。
    if ((def.get(265) | 0) !== 0) {
      d = idiv(d, 10);
      def.set(265, 0);
    }

    const rng = (g && g.rng) ? g.rng : null;
    const R = (n) => (rng ? rng.rnd(Math.max(1, n | 0)) : 0);
    // 注意：抗性链读的是 var_82(id) = **技能等级**（不是 sorg 的潜力编码）；
    //   sorg(c,id) = var_82(id+600)/1000000 是「潜力」，两者不同。
    const src = (c, id) => {
      if (!c) return 0;
      if (typeof c.skill === 'function') return c.skill(id) | 0;
      return (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(c, id) | 0) : 0;
    };
    const v65 = (n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);

    // ---- 197986：var_58(264) > 0（重伤）→ 伤害翻倍 ----
    if ((def.get(264) | 0) > 0) d = d * 2;
    // ---- 197987-197990：以太风（var_65(85)==5）且伤害 >= 200 → 按 var_58(86) 削减 ----
    if (v65(85) === 5 && d >= 200) {
      d = idiv(d, 200) * (200 - limit(def.get(86), 0, 100));
    }
    // ---- 197992-197995：攻击者 var_58(267) > 0 → 伤害减半 ----
    if (att && (att.get(267) | 0) > 0) d = idiv(d, 2);

    // ================= 197997-198040：抗性链 =================
    if (A === 0 || A >= 61) {
      if (A === 64) {
        // 197998-198010：物理近战 → DV 减免
        const v1135 = idiv((def.get(71) | 0) * (def.get(77) | 0), 100) + (def.get(77) | 0) - 100;
        const v1136 = idiv(((def.get(70) | 0) + idiv(def.get(76) | 0, 25)) * (def.get(76) | 0), 100);
        let v1137 = v1135 * 2 + v1136;
        if (v1137 > 0 && (def.get(60) | 0) >= 100) v1137 = 0;   // var_58(60)>=100 → 物理完全减免
        if (v1137 > 0) v1137 = idiv(v1137 * 2, 3);
        d = idiv(d * 100, limit(v1137 + 110, 50, 30000));
      }
      if (A === 68 || attIdx === -21 || attIdx === -4) {
        // 198012-198018：特殊直接伤害 → 耐久 + 关系 + 好感 减免
        const v1137 = (def.get(11) | 0)
          + limit(def.get(169), 50, 1000) + limit(def.get(17), 50, 1000);
        d = idiv(d * 100, v1137 + 50) + 2;
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(def, 1051)) d = idiv(d, 2);
      }
    } else {
      // 198020-198040：元素属性 50-60 → 该属性等级（抗性）减免
      const v1137 = idiv(src(def, A), 50);
      if (v1137 < 3) d = idiv(d * 150, limit(v1137 * 50 + 50, 40, 150));
      else d = idiv(d * 100, v1137 * 50 + 50);
      if (A === 60) {                                       // 魔法：变异壳 + buff 34
        const v64 = def.get(64) | 0;
        if (v64 < 35000 && v64 >= 15000 && findbuff(def, 34) !== -1) d = idiv(d * 4, 5);
      }
      let mres = src(def, 60);                              // var_82(60)：魔法抗性
      if ((def.get(60) | 0) >= 100) mres = 1;
      d = idiv(d * 100, idiv(mres, 4) + 50);
    }

    // ================= 198481-198558：状态 / 种族 / 速度倍率 =================
    const skipFixed = (A === 702 || A === 707 || A === 64 || A === 68);
    if (attIdx !== -11 && attIdx !== -13 && attIdx !== -4) {
      if (A !== 0 && !skipFixed) {
        // cbit 26：伤害削减类效果 → /50
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(def, 26) && d > 0) d = idiv(d, 50);
      }
      if ((def.get(27) | 0) === 668 && A !== 702) d = idiv(d * 2, 3);        // 种族 668 减伤
      if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(def, 1040) && A !== 702) d = idiv(d, 2);
      if (findbuff(def, 8) !== -1) {                        // buff 8：受击伤害调整
        d = ((def.get(25) | 0) > 3) ? idiv(d, 10) * 11 : idiv(d, 5) * 6;
      }
    }
    if (v65(193) === 100) d = idiv(d * 3, 5);                 // 198510
    if (v65(193) === 1200) d = idiv(d, 6) + 1;                // 198513
    if (d > 0 && v65(192) === 100) d = idiv(d, 2) + 1;        // 198516
    // 198521-198527：玩家为攻击者且无信仰 → 攻击「/god/」种族加成
    if (attIdx === 0 && (def.get(61) | 0) === 0 && Elona.EnchantFX && Elona.EnchantFX.raceTag) {
      if (Elona.EnchantFX.raceTag(def.get(27) | 0).indexOf('/god/') >= 0) d = idiv(d * 7, 5);
    }
    if (attIdx >= 0 && d > 0) {
      if (findbuff(att, 8) !== -1) {
        d = ((att.get(25) | 0) > 3) ? idiv(d, 10) * 9 : idiv(d, 5) * 4;
      }
      // 198539-198541：防御者品质 >= 4 时按速度差增伤
      if ((def.get(25) | 0) >= 4) {
        const spdA = src(att, 18), spdD = src(def, 18);
        d = idiv(d * 10, limit(idiv(spdA * 10, spdD || 1), 10, 50));
      }
      if (A !== 0 && !skipFixed) {
        if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(att, 26) && d > 0) d = idiv(d, 50);
      }
    }
    // 198553-198557：var_58(444) = 连续被击次数累积减伤
    if ((def.get(444) | 0) >= 50) {
      d = idiv(d, 10) * (10 - idiv(def.get(444), 20));
      if ((def.get(444) | 0) >= 200) d = 1;
    }
    if (v65(193) === 0) def.set(444, (def.get(444) | 0) + 1);

    // ================= 199131-199148：受击累积「ガードブレイク」计量（var_58(60)） ============
    //   每被命中一次 +3，物理（属性 64）再 +3；>=100 → 置 120（破防状态，持续到每回合 -1 降到 100）
    //   破防时 dmghp 的物理减免失效（198003）、魔法抗性项按 1 计（198036）
    if (attIdx >= 0 && (def.get(183) | 0) === 0) {
      const gb = def.get(60) | 0;
      if (gb < 100) {
        let nv = gb + 3 + (A === 64 ? 3 : 0);
        if (nv >= 100) nv = 120;
        def.set(60, nv);
      }
    }

    // ================= 198591：附魔「偶尔令你所受的攻击无效化」(53) =================
    if (d > 0 && (def.get(91) | 0) > 0) {
      const p = limit(idiv(def.get(91), 2), 1, 50);
      if (p > R(100)) d = 0;
    }

    // ================= 199071-199080：觉醒天赋「障壁」(cbit 1005) =================
    if (d > 0 && att && Elona.Status && Elona.Status.cbit && Elona.Status.cbit(def, 1005)) {
      const mp = def.get(55) | 0;
      const mpMax = def.get(56) | 0;
      if (mp >= idiv(mpMax, 3)) {
        def.set(55, mp - d);
        d = 0;
      }
    }

    def.hp -= d;
    if (def.hp <= 0) def.hp = 0;

    // 0-GH：死亡结算统一入口 —— 不论伤害来自近战 / 远程 / 法术 / 能力 /
    //   地面效果（mef）/ 环境，都在 HP 归零处结算一次（幂等）。
    //   原先经验、掉落、招募、竞技场等分散在 attackOne / game.fireAtTarget /
    //   ai.runAll 三处，导致「近战不掉落、远程没经验」。
    if (d > 0 && def.hp <= 0 && !(opts && opts.deferDeath)) onDeath(g, def, att);

    // 0-GP / 199713-199920：*label_2044 的受击副作用（睡眠妨害、hostileaction、
    //   拍照音、cbit 23/27 分身分裂、怒气、仇恨目标、剧情击晕、濒死以太耐性）。
    //   0-GV / 199519-199712：同一入口的前半段（酸蚀装备、恐惧失禁、
    //   元素附加状态 dmgcon 与火/冰/酸的道具破坏），prm_989 由 attrArg 传入。
    //   放在死亡结算之后，保证既有掉落 / 经验的随机序列不变；
    //   199945-199952 的附近同伴斗志 +5 仍由 Morale.onKill 承担，不重复累加。
    if (d > 0 && Elona.OnHit && Elona.OnHit.onDamage) {
      try {
        const hr = Elona.OnHit.onDamage(g, def, att, d, A, attrArg);
        if (hr && hr.messages && g && typeof g.log === 'function') {
          for (const m of hr.messages) g.log(m);
        }
      } catch (e) { /* 副作用失败不影响伤害结算 */ }
    }

    // ================= 199131-199231：斗志（var_58(182)）结算 =================
    //   目标受伤累积（d*150/最大HP+2，上限 96 / 196）
    //   来源伤害他人累积（+2，獣爪兵再 +2，沙包不提供）
    if (d > 0 && Elona.Morale && Elona.Morale.onDamage) {
      Elona.Morale.onDamage(g, att, def, d);
    }
    return d;
  }

  /**
   * 攻击总驱动 —— 忠实实现 *label_3006（345830-346016），玩家/怪物通用。
   *
   * 流程（对照源码行号）：
   *   345831  cbit(1016) → 特殊攻击：取技能 50..60 中最高者对应的法术（414 / 485-490 / 415-418）
   *                       → gosub *label_2950（施法引擎，本项目走 Spell.dispatchEffect）
   *   345938  var_1374=0（攻击回数） var_1322=106（格闘） var_1369=-1 var_87=0
   *   345944-345975  var_2378 判定（等级/var_58(58)/var_65(250+2)/var_65(250+23)/
   *                  var_58(25)/(182)/(266)/(185)）
   *   345976  749 気力吐息：var_58(182)>=100 且 var_2378==100 且 var_58(96)==1 且 var_58(32)&1
   *   345988  `repeat 30`：遍历装备槽 var_58(100+cnt)
   *             - 值 \ 10000 == 0 → 空槽，跳过
   *             - 值 / 10000 == 10 或 11 → 跳过（预留槽）
   *             - var_1368 = 值 \ 10000 - 1（物品实例下标）
   *             - var_1322 = var_99(16, var_1368)（物品攻击技能）；iequiploc==10 → 103
   *             - var_1374++ ; gosub *label_3007（单次攻击结算）
   *   346011  var_1322 == 106（全程无武器）→ 以格闘再执行一次 *label_3007
   *
   * 【HSP 语义】`\` = 余数，`/` = 整除；装备槽编码 = 槽类型*10000 + (物品下标+1)。
   * 【近似标注】*label_3007 的「属性附魔/特殊攻击/武器特效」等分支未逐字移植
   *   → 单次结算复用 calcAttackHit/calcAttackDmg（见 attackOne）。
   *
   * @returns {{magic:boolean, spell?:number, attacks?:Array, var2378?:number}}
   */
  function attackSeq(g, att, def) {
    const V65 = (n) => (g && typeof g.getV65 === 'function') ? g.getV65(n) : 0;
    const mod = (a, b) => (b === 0 ? 0 : (a % b));

    // ---- 345831：特殊攻击（var_58 里存的是"最高技能对应法术"）----
    if (cbit(att, 1016)) {
      let best = att.skill(60), id = 414;
      const cand = [[50, 485], [51, 486], [52, 487], [53, 418], [54, 488],
        [55, 489], [56, 415], [57, 490], [58, 416], [59, 417]];
      for (const [sk, sp] of cand) if (att.skill(sk) > best) { best = att.skill(sk); id = sp; }
      if (att.skill(60) >= best) id = 414;                       // 345874
      const ov = att.get(414);                                    // 345878-345912
      if (ov) {
        const map = { 1: 485, 2: 486, 3: 487, 4: 418, 5: 488, 6: 489, 7: 415, 8: 490, 9: 416, 10: 417, 11: 414 };
        if (map[ov]) id = map[ov];
      }
      if (Elona.Spell && Elona.Spell.dispatchEffect) {
        return { magic: true, spell: id, result: Elona.Spell.dispatchEffect(g, att, id, def) };
      }
      return { magic: true, spell: id, unimplemented: ['spell-dispatch'] };
    }

    // ---- 594719-594725：cbit 1024「営業笑顔」→ 悩殺攻撃（739）----
    //   条件：攻撃者の気力 var_58(14) > 0 且 var_58(252) == 0（本回合还没用过特殊行动）。
    //   源码先把 var_2773 覆盖成 739，再在 596707-596714 走 `gosub *label_2958` 的能力派发。
    //   注意 739 是「让目标呕吐 + 清气力」的辅助攻击，不进入普通武器连击。
    if (cbit(att, 1024) && (att.get(14) | 0) > 0 && (att.get(252) | 0) === 0
      && Elona.Spell && Elona.Spell.dispatchEffect) {
      return { magic: true, spell: 739, result: Elona.Spell.dispatchEffect(g, att, 739, def) };
    }

    let var1374 = 0, var1322 = 106, var2378 = 0;
    // ---- 345944-345975：var_2378 ----
    if (V65(252) < 350) { if (att.level >= 130) var2378 = 100; }
    if (V65(252) >= 350) { if (att.level >= 50) var2378 = 100; }
    if (att.index < 16 || att.get(58) === 100 || att.index === 0) var2378 = 100;
    if (V65(273) === 1) var2378 = 100;
    if (att.index >= 16 && att.get(25) > 3 && att.hp > idiv(att.hpMax, 2) && att.get(182) < 200) {
      if (g.var1636 !== 100) var2378 = 0;                        // var_1636 未确认 → 缺省 0
    }
    if (V65(193) === 888) var2378 = 0;
    if (att.get(266) === -1 && att.get(185) !== 0) var2378 = 0;
    if (att.get(266) === 1 || att.get(266) === 2) var2378 = 0;

    const out = { magic: false, attacks: [], var2378 };
    // var_1380（本回合连续攻击数）在每次 `gosub *label_3007` 前复位（346007/346012）
    const one = (item, skill, n) => {
      const prev = g.var1380;
      g.var1380 = 0;
      try { return attackOne(g, att, def, item, skill, n); }
      finally { g.var1380 = prev; }
    };
    // ---- 345976-345987：749 気力吐息 ----
    if (att.get(182) >= 100 && var2378 === 100 && att.get(96) === 1 && (att.get(32) & 1)) {
      if (Elona.Spell && Elona.Spell.dispatchEffect) {
        out.breath749 = Elona.Spell.dispatchEffect(g, att, 749, def);
      } else {
        out.breath749 = { implemented: false, why: 'no-spell-engine' };
      }
    }

    // ---- 345988-346010：遍历装备槽 ----
    for (let cnt = 0; cnt < 30; cnt++) {
      const val = att.get(100 + cnt);
      if (mod(val, 10000) === 0) continue;                       // 空槽
      const slotType = idiv(val, 10000);
      if (slotType === 10 || slotType === 11) continue;          // 预留槽
      const itemIdx = mod(val, 10000) - 1;
      const item = att.inv && att.inv[itemIdx];
      if (!item) continue;
      var1322 = item.f[16] || 106;                                // var_99(16, var_1368)
      if (Elona.ItemDB && Elona.ItemDB.equipLocById(item.id) === 10) var1322 = 103;
      var1374++;
      out.attacks.push(one(item, var1322, var1374));
    }
    // ---- 346011-346014：无武器 → 格闘 ----
    if (var1322 === 106) out.attacks.push(one(null, 106, var1374));
    return out;
  }

  /**
   * 单次攻击结算 —— *label_3007（346017-347815）。
   *
   * 已逐字移植的段：
   *   346018-346047  存活检查、体力/饱食消耗、気力(var_58(182))积累
   *   346085-346099  雾中幻影（mef type 2）→ 1/4 概率攻击落空
   *   346101-346112  疲劳（SP<50）→ 1/2 概率攻击失败
   *   346122-346818  命中/伤害/扣血 + 伤害后技能经验
   *   346831-347114  装备「追撃」附魔（65 近接 / 66 射击）的追加伤害
   *   347115-347121  buff 68 的追加伤害
   *   347122-347136  buff 36（格闘）的爆炸伤害
   *   347242-347259  feat 227 触手追击
   *   347260-347271  反撃(var_58(92)) / cbit(1002) 的 dmgcon
   *   347273-347335  棘(var_58(78)) 的反撃
   *   347531-347608  战士/枪手与双手武器的连续攻击判定（var_1380）
   *   347717-347787  気力吐息：武器种类 → 法术 702-707/731（weaponspells.json）
   * 未移植：投掷/弹药（var_1369/var_1322=108..111）、特殊格闘技（var_2442）、
   *   偷袭 var_58(29)、金钱窃取 var_58(31)、怪物专属事件（347789-347814）、
   *   以及所有文本/动画表现（txt_select / animeload / snd）。
   *
   * 追加攻击沿用原版的 `goto *label_3007`：以 depth 控制递归。
   */
  function attackOne(g, att, def, item, skillId, var1374, depth) {
    depth = depth | 0;
    const prev = g.var1374;
    g.var1374 = var1374 === undefined ? 1 : var1374;
    const rng = g.rng;
    try {
      if (att.get(0) !== 1 || def.get(0) !== 1) return null;      // 346018-346023

      // ---- 346025-346047：体力 / 饱食 / 気力 ----
      if (att.get(178) === 0) {
        if (att.get(52) > -50) att.set(52, att.get(52) - 1);
        if (att.get(60) < 99) att.set(60, att.get(60) + 1);
        att.set(178, 1);
        if (cbit(def, 985) !== 1) {
          att.set(182, att.get(182) + 2);
          if (att.get(27) === 909) att.set(182, att.get(182) + 2);
        }
      }
      if (att.get(182) > 100) {
        if (att.get(409) <= 0 && (att.get(214) <= 0 || att.index === 0)
          && (att.get(25) < 4 || att.index < 16)) att.set(182, 100);
      }
      if (att.get(182) > 200) att.set(182, 200);

      // ---- 346085-346099：雾中幻影 ----
      if (g.mef && g.mef.typeAt && g.mef.typeAt(g, def.x, def.y) === 2) {
        if (rng.rnd(4) === 0) {
          return { hit: false, dmg: 0, killed: false, illusion: true,
            hitPower: 0, evaPower: 0, extra: [] };
        }
      }
      // ---- 346101-346112：疲劳 ----
      if (att.get(52) < 50 && rng.rnd(2) === 0) {
        return { hit: false, dmg: 0, killed: false, fatigue: true,
          hitPower: 0, evaPower: 0, extra: [] };
      }

      // ---- 346122：命中 + 伤害 ----
      // 特殊弹 var_1321：2 = 穿甲 3 = 必会心 5 = 散弹（见 calcAttackHit/Dmg）
      const spAmmo = g.var1321 | 0;
      const res = attack(g, att, def, { weapon: item, skillId,
        atkType: (spAmmo === 2 || spAmmo === 3 || spAmmo === 5) ? spAmmo : 0 });
      res.extra = [];
      if (!res.hit) return res;
      const dmg = res.dmg;

      // ---- 346831-347114：装备「追撃」附魔 ----
      if (att.get(405) === 0 && att.get(406) !== 0 && def.get(0) === 1 && dmg > 0) {
        const dw = dist(att.x, att.y, def.x, def.y);
        for (let t = 0; t < 3; t++) {
          let idx = -1;
          for (let cnt = 100; cnt < 130; cnt++) {
            const v = att.get(cnt);
            if (v === 0) continue;
            if (rng.rnd(10) !== 0) continue;
            idx = (v % 10000) - 1;
            break;
          }
          if (idx < 0) continue;
          const it = att.inv && att.inv[idx];
          if (!it) continue;
          let mode = 0, pow = 0;
          for (let n = 0; n < 15; n++) {
            const e = it.f[40 + n * 2];
            if (!e) break;
            const p = it.f[40 + n * 2 + 1];
            if (e === 66 && dw <= 1) { mode = 1; pow = p; break; }   // 346877
            if (e === 65) { mode = 2; pow = p; break; }               // 346883
          }
          if (!mode) continue;
          att.set(405, mode);
          if (pow > 2000) pow = 2000;
          if (mode === 1) {
            if (def.get(179) < 2) def.set(179, 2);
            const d = idiv(dmg, 30) * idiv(rng.rnd(20) + pow + 800, 140)
              + rng.rnd(att.skill(189) * 3 + 1);                      // 347108
            res.extra.push({ kind: 'pursuit-ranged', dmg: applyDamage(def, d, g, att, g.var87 | 0, 1000) });
          } else {
            if (def.get(148) < 2) def.set(148, 2);
            const d = idiv(dmg, 30) * idiv(rng.rnd(20) + pow + 800, 130)
              + rng.rnd(att.skill(152) * 3 + 1);                      // 347086
            res.extra.push({ kind: 'pursuit-melee', dmg: applyDamage(def, d, g, att, g.var87 | 0, 1000) });
          }
          break;
        }
      }
      // ---- 347115-347121：buff 68 追加伤害 ----
      if (findbuff(att, 68) !== -1) {
        const d = idiv(dmg * (rng.rnd(30) + 60), 100) + 1;
        res.extra.push({ kind: 'buff68', dmg: applyDamage(def, d, g, att, 0, 0) });
      }
      // ---- 347122-347136：buff 36（格闘）爆炸 ----
      if (skillId === 106 && findbuff(att, 36) !== -1) {
        const elem = att.get(174) + 50;
        let d;
        if (elem === 60) {
          d = idiv(idiv(dmg, 10) * (rng.rnd(400) + limit(att.skill(106) * 2, 200, 2000)), 100) + 1;
        } else {
          d = idiv(idiv(dmg, 10) * (rng.rnd(400) + limit(att.skill(106) * 4, 200, 3000)), 100) + 1;
        }
        res.extra.push({ kind: 'buff36', dmg: applyDamage(def, d, g, att, elem | 0, 100), element: elem });
      }
      // ---- 347240：武器附魔特效发动（gosub *label_3008）----
      //   吸血36 / 吸魔38 / 终结37 / 时停40·77 / 龙·不死·神特攻 57·58·61 /
      //   对空76 / 对金属84 / 属性追伤(type7) / 特效发动(type8) / 特殊弹后处理
      if (Elona.EnchantFX && dmg > 0 && att.get(0) === 1) {
        const fx = Elona.EnchantFX.apply(g, att, def, {
          item, dmg, ammoType: spAmmo, skillId,
        });
        for (const f of fx) res.extra.push(f);
      }
      // ---- 347242-347259：feat 227 触手 ----
      if (Elona.Feat && Elona.Feat.get(att, 227) !== 0 && att.index === 0
        && def.get(0) === 1 && rng.rnd(8) === 0) {
        const lv = limit(att.level, 1, 1000);
        let d = (idiv(lv, 10) + 4) * (idiv(lv, 10) + 3) * 2 + rng.rnd(lv + 5) + 1;
        if (Elona.Feat.get(att, 227) === -2) d *= 2;
        res.extra.push({ kind: 'tentacle', dmg: applyDamage(def, d, g, att, 0, 0) });
      }
      // ---- 347260-347271：反撃 / dmgcon ----
      if (def.get(92) > 0) {
        const d = limit(idiv(idiv(def.get(92), 100) * dmg, 1) + 1, 1, idiv(def.get(51), 5));
        res.extra.push({ kind: 'counter92', dmg: applyDamage(att, d, g, def, 61, 100) });
      }
      if (cbit(def, 1002) && Elona.Resist && g.dmgconTable) {
        Elona.Resist.dmgcon(g, g.dmgconTable, att, 7, limit(def.skill(17), 200, 1000));
      }
      // ---- 347273-347335：棘 ----
      if (def.get(78) !== 0 && dist(att.x, att.y, def.x, def.y) <= 1) {
        const elem = def.get(78) % 1000;
        if (elem === 61 || elem === 62) {
          const d = limit(idiv(dmg, 10), 1, idiv(def.get(51), 10));
          res.extra.push({ kind: 'thorns', dmg: applyDamage(att, d, g, def, elem | 0, 0), element: elem });
        }
        // elem == 63（酸）的道具腐蚀由 applyDamage → OnHit 的 elemental() 统一处理
      }

      // ---- 347717-347787：気力吐息 → 武器种类法术 ----
      if (att.get(182) >= 100 && def.get(0) === 1 && item && WSPELLS
        && Elona.Spell && Elona.Spell.dispatchEffect) {
        const loc = itemEquipLoc(item);
        for (const grp of WSPELLS.groups) {
          const hit = (grp.equipLoc10 && loc === 10)
            || (!grp.equipLoc10 && grp.ids.indexOf(item.id) >= 0);
          if (!hit) continue;
          const power = limit(att.skill(grp.skill) * 10 + 50, 1, 100000);
          res.weaponSpell = Elona.Spell.dispatchEffect(g, att, grp.spell, def, power);
          break;
        }
      }

      // ---- 347531-347608：连续攻击 ----
      if (depth < 8 && def.get(0) === 1 && !cbit(att, 1016)
        && (g.getV65 ? g.getV65(194) === 0 && g.getV65(193) === 0 && g.getV65(175) === 0 : true)) {
        let again = 0;
        if ((g.var1380 | 0) === 0) {
          const base = limit(att.get(88), 0, 50)
            + limit(idiv(att.skill(skillId), 50), 0, 40);
          if (g.var1323) {
            // 347536-347554：远程 → 附魔「追加射击」(51)（var_58(89)）
            const rbase = limit(att.get(89), 0, 50)
              + limit(idiv(att.skill(skillId), 50), 0, 40);
            const rbonus = (att.className === 'gunner') ? 5 : 0;
            if ((g.var1321 | 0) === -1 && rng.rnd(100) < rbase + rbonus) again = 1;
          } else {
            // 347556-347571：近战 → 附魔「追加打击」(50)（var_58(88)）
            const bonus = (att.className === 'warrior') ? 5 : 0;
            if (rng.rnd(100) < base + bonus) again = 1;                 // 347558-347569
          }
        } else if ((g.var1380 | 0) < 3
          || (att.get(96) === 0 && (g.var1380 | 0) < 7 && skillId === 106)) {
          let hands = 0;
          for (let cnt = 100; cnt < 130; cnt++) if (idiv(att.get(cnt), 10000) === 5) hands++;
          if (skillId === 106 && att.get(96) === 0) hands = 0;
          if (hands <= 2) hands = 0;
          if (rng.rnd(100) + (hands + 1) * (hands + 10) * (g.var1380 | 0)
            < rng.rnd(att.get(88) * 2 + 1)) again = 1;                // 347598
        }
        if (again) {
          g.var1380 = (g.var1380 | 0) + 1;
          const nxt = attackOne(g, att, def, item, skillId, var1374, depth + 1);
          if (nxt) res.extra.push({ kind: 'chain', result: nxt });
        }
      }
      // ---- 346790-346818：伤害后技能经验 ----
      if (dmg > 0 && def.hpMax > 0) {
        const S = Elona.Stats;
        const div = Math.max(1, 1 + cbit(def, 985) * 1000 + cbit(def, 23) * 1000
          + cbit(def, 27) * 1000
          + ((g.getV65 && g.getV65(20) === 35) ? 1000 : 0));   // var_2543 (346121)
        if (dmg > idiv(def.hpMax, 100)) {
          const ex = limit(idiv(500 * dmg, def.hpMax) + 1, 5, 500);
          if (def.get(0) === 1 && S && S.skillExp) {
            S.skillExp(def, carmor(def), def.index, idiv(ex, div), 0, 5, g);
            if (def.get(32) & 1) S.skillExp(def, 168, def.index, idiv(ex, div), 0, 5, g);
          }
          if (!cbit(att, 23) && !cbit(att, 27) && S && S.skillExp) {
            const ex2 = limit(def.skill(173) * 2 - att.skill(skillId) + 1, 5, 50);
            S.skillExp(att, skillId, att.index, idiv(ex2, div), 0, 4, g);
            S.skillExp(att, 152, att.index, idiv(20, div), 0, 4, g);
            if (att.get(32) & 2) S.skillExp(att, 167, att.index, idiv(20, div), 0, 4, g);
            if (att.get(32) & 4) S.skillExp(att, 166, att.index, idiv(20, div), 0, 4, g);
            if (att.get(32) & 1) S.skillExp(att, 168, att.index, idiv(20, div), 0, 4, g);
          }
        }
      }
      return res;
    } finally {
      g.var1374 = prev;
    }
  }

  // ==========================================================================
  // 射击 / 弹药（*label_2840 / *label_3005 的远程分支）
  // ==========================================================================

  /**
   * 取远程武器与弹药 —— 逐字移植 *label_2840（300458-300507）。
   * 装备槽 var_58(100+n)：槽类型 10 = 远程武器，11 = 弹药（*label_2235 末尾追加）。
   *
   * 返回：
   *   { ok:false, reason:'no-weapon' }  未装备远程武器
   *   { ok:false, reason:'no-ammo'   }  弓/枪没有弹药（近战武器/投掷武器除外）
   *   { ok:false, reason:'mismatch'  }  弹药种类不匹配
   *   { ok:true, weapon, ammo, skill } skill = 100..111（111 = 投掷）
   */
  function getRanged(g, att) {
    let wi = -1, ai = -1, aiSlot = -1;
    for (let n = 0; n < 30; n++) {
      const val = att.get(100 + n);
      const st = idiv(val, 10000);
      if (st === 10) wi = (val % 10000) - 1;
      else if (st === 11) { ai = (val % 10000) - 1; aiSlot = n; }
    }
    if (wi < 0 || !att.inv || !att.inv[wi]) return { ok: false, reason: 'no-weapon', weapon: null, ammo: null };
    const weapon = att.inv[wi];
    let ammo = ai >= 0 ? att.inv[ai] : null;
    if (!ammo && ai >= 0) ammo = null;
    const wskill = weapon.f[16] | 0;
    const wloc = Elona.ItemDB ? Elona.ItemDB.equipLocById(weapon.id) : 0;
    if (!ammo) {
      if (wskill !== 111 && wloc !== 5) return { ok: false, reason: 'no-ammo', weapon, ammo: null };
    } else {
      // 300484-300500：箭/弩矢/子弹的技能码修正与匹配
      if (ammo.id === 483 && (ammo.f[16] | 0) !== 109) ammo.f[16] = 109;
      if (ammo.id === 61 && (ammo.f[16] | 0) !== 108) ammo.f[16] = 108;
      if ((ammo.f[16] | 0) !== wskill) return { ok: false, reason: 'mismatch', weapon, ammo };
      if (ammo.id === 973 && weapon.id !== 60 && weapon.id !== 758) {
        return { ok: false, reason: 'mismatch', weapon, ammo };
      }
    }
    let skill = wskill || 106;
    if (wloc === 5) skill = 111;            // 300504-300506
    return { ok: true, weapon, ammo, skill, weaponIndex: wi, ammoIndex: ai, ammoSlot: aiSlot };
  }

  /**
   * 特殊弹类型（345717-345733 / 345769-345825）：
   *   -1 普通弹；0 连射 6 发；1 贯通弹；2 穿甲弹；3 必会心；4 时停；5 散弹 40 发。
   * 弹药把效果存在 f[9] = 效果槽位，f[40+slot*2] = 类型*10000+值，f[40+slot*2+1] = 剩余次数*1000+强度。
   */
  /**
   * 特殊弹（var_1321）—— 345713-345733。
   *   `f[9]` 指向弹种附魔槽；9 号附魔的 +1 格打包「发数*1000 + 弹种值」
   *   （原版 345719 `f[...+1] \ 1000 <= 0` 判发数、345728 `f[...] \ 10000` 取弹种）。
   *   本项目附魔槽存 `eid`，所以弹种值走 +1 格的低 3 位。
   */
  function ammoSpecial(ammo) {
    if (!ammo) return -1;
    const slot = ammo.f[9] | 0;
    if (slot < 0 || slot >= 15) return -1;
    const eid = ammo.f[40 + slot * 2] | 0;
    if (eid !== 9) return -1;                                 // 不是弹种附魔
    const e1 = ammo.f[40 + slot * 2 + 1] | 0;
    if (idiv(e1, 1000) <= 0) { ammo.f[9] = -1; return -1; }   // 345719-345725：发数用完 → 通常弾
    ammo.f[40 + slot * 2 + 1] = e1 - 1;                       // 345731
    return e1 % 1000;                                         // 弹种值 0..5
  }

  /** 可见的敌对角色（var_484 的近似） */
  function visibleEnemies(g, att) {
    const out = [];
    for (const t of g.charas || []) {
      if (!t || t === att || t.get(0) !== 1) continue;
      if (att.get(9) >= 0 && t.get(9) !== -3) continue;       // 非敌对者只打敌对目标
      const d = dist(att.x, att.y, t.x, t.y);
      if (d > 20) continue;
      if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, att.x, att.y, t.x, t.y)) continue;
      out.push(t);
    }
    return out;
  }

  /** 直线上的角色（贯通弹，type 1） */
  function lineTargets(g, att, def) {
    const out = [def];
    const dx = Math.sign(def.x - att.x), dy = Math.sign(def.y - att.y);
    if (!dx && !dy) return out;
    let x = def.x, y = def.y;
    for (let i = 0; i < 8; i++) {
      x += dx; y += dy;
      if (!g.map || !g.map.inBounds(x, y)) break;
      const c = (g.charas || []).find((t) => t && t.get(0) === 1 && t.x === x && t.y === y);
      if (c && c !== att) out.push(c);
    }
    return out;
  }

  /**
   * 发射一次 —— *label_3005 的远程部分（345710-345829）：
   *   读取特殊弹 var_1321 → 按类型执行连射/贯通/散弹/时停。
   *   注意：原版**不扣减**箭矢/子弹的堆叠数量（只扣特殊弹的发数）。
   */
  function rangedAttack(g, att, def) {
    const r = getRanged(g, att);
    if (!r.ok) return r;
    // 345717-345734：原版**不消耗**箭矢/子弹的数量，箭束只作为装备件常驻；
    //   这里只处理特殊弹的剩余发数（ammoSpecial），f[0] 保持原样。
    const sp = ammoSpecial(r.ammo);              // var_1321
    // var_1323=1（远程）/ var_1322=技能 / var_1368/1369（武器/弹药下标）
    const p1322 = g.var1322, p1323 = g.var1323, p1368 = g.var1368, p1369 = g.var1369;
    const pSp = g.var1321;
    g.var1323 = 1; g.var1322 = r.skill;
    g.var1368 = r.weaponIndex; g.var1369 = r.ammoIndex;
    g.var1321 = sp;
    const shots = [];
    try {
      const fire = (target) => {
        if (!target || target.get(0) !== 1) return null;
        const res = attackOne(g, att, target, r.weapon, r.skill, 1);
        if (res) shots.push({ target: target.name, result: res });
        return res;
      };
      if (sp === 0) {                            // 345769-345789：连射 6 发
        let target = def;
        for (let i = 0; i < 6; i++) {
          if (!target || target.get(0) !== 1 || target.hp <= 0) {
            const list = visibleEnemies(g, att).filter((t) => t.hp > 0);
            target = list.length ? list[g.rng.rnd(list.length)] : null;
          }
          if (!target) break;
          fire(target);
        }
      } else if (sp === 5) {                     // 345792-345820：散弹 40 发
        const list = visibleEnemies(g, att);
        const pool = list.length ? list : (def ? [def] : []);
        for (let i = 0; i < 40 && pool.length; i++) {
          fire(pool[g.rng.rnd(pool.length)]);
        }
      } else if (sp === 1) {                     // 贯通弹
        for (const t of lineTargets(g, att, def)) fire(t);
      } else {
        fire(def);
        if (sp === 4 && g.setV65) {              // 348021-348034：时停
          g.setV65(801, 4);
          shots.push({ kind: 'timestop' });
        }
      }
    } finally {
      g.var1322 = p1322; g.var1323 = p1323; g.var1368 = p1368; g.var1369 = p1369;
      g.var1321 = pSp;
    }
    return { ok: true, special: sp, shots: shots.map((s) => s.result || s),
      result: shots[0] ? shots[0].result : null, weapon: r.weapon, ammo: r.ammo, skill: r.skill };
  }

  Elona.Battle = {
    role, rolemax, dist, carmor, calcArmor, calcAttackHit, calcAttackDmg, attack, applyDamage,
    onDeath, checkDeath,
    attackSeq, attackOne, critCheck,
    loadWeaponSpells, setWeaponSpells,
    findbuff, cbit, idiv, limit,
    getRanged, rangedAttack,
    loadWeaponRange, setWeaponRange,
  };
})(window);
