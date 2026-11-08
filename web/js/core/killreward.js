/**
 * 击杀结算 —— 主路径（200426-200455）+ `check_talk`（196675-196828）
 *
 * 【名字陷阱】`check_talk` 在源码里并不检查对话内容 —— 它是「击杀/交手后的成长结算」，
 *   12 个调用点（308644-339998）全部紧跟在 `dmgsptalk`（体力吸取致死）之后。
 *   主击杀经验在 200426-200455（`*label_2055` 的死亡处理块，prm_985 = 死者 / prm_987 = 击杀者）。
 *
 * ## 经验公式（两处一致）
 *   var_1170 = limit(lv,1,400) * (lv+1) * (lv+2) / 10 + 10          （lv = 死者等级）
 *   玩家击杀弱敌（死者等级 < 玩家等级）→ /100 + 5
 *   死者是店员(cbit 23)/马(cbit 27)/被魅惑(964)/友军(关系 10) → 0
 *   击杀者是玩家或队友 → var_65(92) += exp（累计，上限 10 亿）
 *   玩家击杀强敌 → exp *= limit(死者等级*20/玩家等级, 10, 100) / 10   （200450）
 *                    check_talk 版是 *30（196822），两处系数不同，各自照抄
 *   var_58(35, 击杀者) += exp；var_58(201, 击杀者) = 0
 *
 * ## check_talk 独有的部分
 *   196681  玩家等级 < 目标等级 且 var_58(191)==4 → var_58(191) += 1000（转生计数）
 *   196694  var_65(250+383)==1 且目标等级 >= var_65(250+382) 且原始关系 -3 → 383 = 2（剧情标志）
 *   196708  var_58(147, 击杀者) = max(147, 目标等级)（最高击杀记录）
 *   196714  地图 40/35/6 → 跳过观察学习（经验照给）
 *   196721-196800  队伍观察学习：
 *     var_58(198) = Σ sorg(10..17)（八属性潜力之和，缓存）
 *     var_58(199) = sorg(18)（速度潜力）
 *     var_58(160) = limit(sorg(2),50,200)*2 + limit(sorg(3),50,200)/2
 *     目标速度潜力 > 成员 → skillexp 18, 成员, limit(目标速度,10,2000)/5
 *     强敌（198+160 >= 1000）：五档比较（目标 199 > 阈值*5/4/3/2/1），每档 173 += 2、159 += 2
 *     173 上限 2000（超出部分从 159 里扣）；159 < 0 → 重置为 2000
 */
(function (global) {
  'use strict';

  const Elona = global.Elona = global.Elona || {};

  const idiv = (a, b) => Math.floor((a | 0) / (b || 1));
  const limit = (v, a, b) => Math.max(a, Math.min(b, v));
  const EXP_CAP = 1000000000;

  function cbit(c, n) {
    if (!Elona.Status || !Elona.Status.cbit) return 0;
    return Elona.Status.cbit(c, n) | 0;
  }
  function sorgV(c, id) {
    if (!c || !Elona.Stats || !Elona.Stats.sorg) return 0;
    return Elona.Stats.sorg(c, id) | 0;
  }

  /** 经验公式（200430 / 196801）：limit(lv,1,400)³ / 10 + 10 */
  function expOf(level) {
    const lv = limit(level | 0, 1, 400);
    return idiv(lv * (lv + 1) * (lv + 2), 10) + 10;
  }

  /**
   * 主击杀经验（200426-200455）。
   * @param {object} g
   * @param {object} killer 击杀者（prm_987）
   * @param {object} target 死者（prm_985）
   * @returns {object|null} { exp, targetLevel, capped }
   */
  function onKill(g, killer, target) {
    if (!g || !killer || !target) return null;
    const tLv = target.get(38) | 0;
    const kLv = killer.get(38) | 0;
    let exp = expOf(tLv);

    // 200431-200435：玩家击杀弱敌
    if (killer.index === 0 && tLv < kLv) exp = idiv(exp, 100) + 5;
    // 200436-200438：店员/马/魅惑/友军
    if (cbit(target, 23) === 1 || cbit(target, 27) === 1
      || cbit(target, 964) === 1 || (target.get(9) | 0) === 10) exp = 0;
    // 200439-200447：玩家或队友击杀 → var_65(92) 累计
    let capped = false;
    if ((killer.get(9) | 0) === 10 || killer.index === 0) {
      let v92 = g.getV65(92) | 0;
      if (v92 > EXP_CAP) { v92 = EXP_CAP; capped = true; }
      v92 += exp;
      if (v92 > EXP_CAP) { v92 = EXP_CAP; capped = true; }
      g.setV65(92, v92);
    }
    // 200448-200452：玩家击杀强敌 → 按等级比缩放（×20 版）
    if (killer.index === 0 && tLv > kLv) {
      exp = idiv(exp * limit(idiv(tLv * 20, kLv || 1), 10, 100), 10);
    }
    // 200453-200454
    killer.set(35, (killer.get(35) | 0) + exp);
    killer.set(201, 0);
    return { exp, targetLevel: tLv, capped };
  }

  /** 196727-196741：var_58(198/199/160) 的惰性缓存 */
  function ensureDerived(c) {
    if (!c) return;
    if ((c.get(198) | 0) === 0) {
      let sum = 0;
      for (let a = 10; a <= 17; a++) sum += sorgV(c, a);
      c.set(198, sum);
    }
    if ((c.get(199) | 0) === 0) c.set(199, sorgV(c, 18));
    if ((c.get(160) | 0) === 0) {
      c.set(160, limit(sorgV(c, 2), 50, 200) * 2 + idiv(limit(sorgV(c, 3), 50, 200), 2));
    }
  }

  /**
   * `check_talk` 本体（196675-196828）。
   * @param {object} g
   * @param {object} attacker 攻击者（prm_966；-1/undefined = 无）
   * @param {object} target   死者（prm_967）
   * @returns {object} { exp, targetLevel, rebirth, progress383, learned, learnExp }
   */
  function checkTalk(g, attacker, target) {
    if (!g || !target) return null;
    // 196676：还活着 → 不结算。JS 侧击杀瞬间 var_58(0) 要等 AI 清理才变 0，
    // 所以补 hp 判定（与 QuestCheck 的 A160 同理）
    if ((target.get(0) | 0) === 1 && (target.hp | 0) > 0) return null;
    const out = { exp: 0, targetLevel: target.get(38) | 0, rebirth: false, progress383: false, learned: false, learnExp: 0 };
    const tLv = target.get(38) | 0;
    const atk = (attacker && attacker.index !== undefined) ? attacker : null;

    // 196679-196713
    if (atk) {
      const isPlayerSide = atk.index === 0 || (atk.get(9) | 0) >= 10;
      if (isPlayerSide) {
        // 196681-196692：击杀强敌 → 转生计数
        if ((atk.get(38) | 0) < tLv && (atk.get(191) | 0) === 4) {
          atk.set(191, (atk.get(191) | 0) + 1000);
          out.rebirth = true;
        }
        // 196693-196711
        if (cbit(target, 992) !== 1 && (target.get(9) | 0) !== 10 && (g.getV65(250 + 2) | 0) !== 900) {
          if ((g.getV65(250 + 383) | 0) === 1
            && tLv >= (g.getV65(250 + 382) | 0)
            && (target.get(69) | 0) === -3) {
            g.setV65(250 + 383, 2);
            out.progress383 = true;
          }
          if ((atk.get(147) | 0) < tLv) atk.set(147, tLv);   // 最高击杀记录
        }
      }
    }

    // 196717-196720：prm_966 < 0 → 直接 return（观察学习与经验都不做）
    if (!atk) return out;
    // 196714-196716：地图 40/35/6 → 跳过观察学习
    const mapId = g.getV65(20) | 0;
    const skipLearn = (mapId === 40 || mapId === 35 || mapId === 6);

    // 196717-196800：队伍观察学习
    if (!skipLearn && atk
      && cbit(target, 23) !== 1 && cbit(target, 27) !== 1 && cbit(target, 964) !== 1
      && cbit(target, 992) !== 1 && cbit(target, 960) !== 1) {
      const isPlayerSide = atk.index === 0 || (atk.get(9) | 0) >= 10;
      if (isPlayerSide && g.charas) {
        ensureDerived(target);
        for (let i = 0; i < 16; i++) {
          const m = g.charas[i];
          if (!m || (m.get(0) | 0) !== 1) continue;       // 196724
          ensureDerived(m);
          // 196742-196746：速度潜力差距 → 速度技能经验
          if (mapId !== 42 && sorgV(target, 18) > sorgV(m, 18) && Elona.Stats.skillExp) {
            const v = idiv(limit(sorgV(target, 18), 10, 2000), 5);
            Elona.Stats.skillExp(m, 18, m.index, v, 0, 0, g);
            out.learnExp += v;
          }
          // 196747-196797：强敌的五档潜力比较
          if ((m.get(173) | 0) < 2000) {
            let v1103 = m.get(199) | 0;                    // var_1103 = 队友速度潜力
            const ally = g.getV65(183) | 0;
            if (ally !== 0 && (i === 0 || i === ally)) {
              v1103 = ((g.charas[0] ? (g.charas[0].get(199) | 0) : 0) > (g.charas[ally] ? (g.charas[ally].get(199) | 0) : 0))
                ? (g.charas[0] ? (g.charas[0].get(199) | 0) : 0)
                : (g.charas[ally] ? (g.charas[ally].get(199) | 0) : 0);
            }
            const bump = () => {
              m.set(173, (m.get(173) | 0) + 2);
              m.set(159, (m.get(159) | 0) + 2);
            };
            if ((target.get(198) | 0) + (target.get(160) | 0) >= 1000) {   // 196764
              const lhs = (target.get(198) | 0) + (target.get(199) | 0);
              const rhs = (m.get(198) | 0) + (m.get(160) | 0) + v1103 + idiv((m.get(159) | 0) + 1, 5);
              if (lhs > rhs) {
                const tv = target.get(199) | 0;
                if (tv > v1103 * 5) bump();                // 196766
                if (tv > v1103 * 4) bump();                // 196770
                if (tv > v1103 * 3) bump();                // 196774
                if (tv > v1103 * 2) bump();                // 196778
                if (tv > v1103) { bump(); out.learned = true; }   // 196782
                if ((m.get(173) | 0) > 2000) {             // 196788-196791
                  m.set(159, (m.get(159) | 0) - ((m.get(173) | 0) - 2000));
                  m.set(173, 2000);
                }
                if ((m.get(159) | 0) < 0) m.set(159, 2000);   // 196792-196794
              }
            }
          }
        }
      }
    }

    // 196801-196827：击杀经验（×30 版缩放）
    let exp = expOf(tLv);
    if (atk && atk.index === 0 && tLv < (atk.get(38) | 0)) exp = idiv(exp, 100) + 5;   // 196802-196806
    if (atk && (cbit(target, 23) === 1 || cbit(target, 27) === 1 || cbit(target, 964) === 1
      || (target.get(9) | 0) === 10)) exp = 0;                                            // 196807-196809
    if (atk && ((atk.get(9) | 0) === 10 || atk.index === 0)) {                            // 196810-196818
      let v92 = g.getV65(92) | 0;
      if (v92 > EXP_CAP) v92 = EXP_CAP;
      v92 += exp;
      if (v92 > EXP_CAP) v92 = EXP_CAP;
      g.setV65(92, v92);
    }
    if (atk && atk.index === 0 && tLv > (atk.get(38) | 0) && exp > 10) {                  // 196819-196825
      exp = idiv(exp * limit(idiv(tLv * 30, atk.get(38) | 0 || 1), 10, 100), 10);
    }
    if (atk) {
      atk.set(35, (atk.get(35) | 0) + exp);             // 196826
      atk.set(201, 0);                                  // 196827
    }
    out.exp = exp;
    return out;
  }

  Elona.KillReward = {
    EXP_CAP,
    expOf, onKill, checkTalk, ensureDerived, sorgV,
  };
})(window);
