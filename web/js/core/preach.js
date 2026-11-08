'use strict';
/**
 * 説法（Preaching）—— `*label_2916`（307623-308011，389 行）
 *
 * 这是「信仰」系的持续行动：角色（玩家或 NPC）站在原地讲上 61 回合，
 * 周围的听众会听、会掏钱（お布施）、会反感（扔石头）、可能改宗，
 * 结束后按累计的信仰经验给 `skillexp 181`。
 *
 * 【源码结构】
 *   307624-307636  开始：`var_58(140)=15`（行动 id）、`var_58(141)=61`（剩余回合）、
 *                  `var_58(145)=0`（累计布施）
 *   307637-307638  每回合：只在 `var_58(141) \ 20 == 0`（剩余 0..19）时结算听众
 *   307640-307966  听众循环：屏幕震动 → 245 个角色逐个过滤 → 反感/布施/歓声/改宗
 *   307967-307974  本轮布施累加进 `var_58(145)`
 *   307976-308010  结束：提示总布施额 → `rowactend` → 信仰经验
 *                  `limit(var_58(144)/2+20, 20, 500)`，同行的队友（1..15 号且视野内）同得
 *
 * 【听众过滤条件（307641-307674）】
 *   存活 → 同一张地图 / 3 格内 → `var_58(14)`（关注度）> 0 → `var_58(251)==0`
 *   → `var_58(256) < 60` → 未被驯服（cbit 992）→ 该格可见（`var_704(x,y,1)`）
 *   → 不是自己
 *
 * 【本实现的取舍（见差异表）】
 *   · 只做「玩家发起」这一路：NPC 的 `var_58(140)==15` 由 AI 决定，本项目 AI 尚无
 *     持续行动（rowact）分支，故不接。
 *   · `synccheck` / `txt_select` 的联机与演出层不移植，统一走 `g.log`。
 *   · 逐字台词只保留必要句（原版按 8 位神各写了一套歓声台词，这里用通用句）。
 *   · 屏幕震动、`make_sound` 期望语义由表现层自行处理，这里只记一条消息。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const ACTION = 15;             // var_58(140)
  const F_ROWACT = 140;
  const F_ROWLEFT = 141;
  const F_FAITHEXP = 144;        // 本轮累计的信仰经验
  const F_TIPS = 145;            // 本轮累计的布施
  const TURNS = 61;              // 307633
  const EFFECT_LEFT = 20;        // 307638：剩余 < 20 才结算
  const SKILL_FAITH = 181;       // 信仰
  const RANGE = 3;               // 307654
  const OFFERING_ITEM = 971;     // 御布施（有这件东西的人不会改宗，307934）

  const GOD_NAMES = [
    { jp: '無のエヘカトル', en: 'Ehekatl of Luck' },
    { jp: '機械のルルウィ', en: 'Lulwy of Wind' },
    { jp: '地のオパートス', en: 'Opatos of Earth' },
    { jp: '癒しのジュア', en: 'Jure of Healing' },
    { jp: '収穫のクミミ', en: 'Kumiromi of Harvest' },
    { jp: '富のヤカテクト', en: 'Yacatect of Wealth' },
    { jp: '元素のイツパロトル', en: 'Itzpalt of Element' },
    { jp: '迷宮のマニ', en: 'Mani of Machine' },
  ];

  function skillOf(c) { return c && c.skill ? (c.skill(SKILL_FAITH) | 0) : 0; }
  function cbit(c, n) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, n) | 0) : 0;
  }
  function godName(id, lang) {
    const t = GOD_NAMES[id | 0];
    if (!t) return (lang === 'jp' ? '神' : 'god');
    return lang === 'jp' ? t.jp : t.en;
  }
  /** 时钟戳（var_58(15) 用的「现在 + N 小时」比较量） */
  function stamp(g) {
    if (!g || !g.getV65) return 0;
    return (g.getV65(13) | 0) + (g.getV65(12) | 0) * 24
      + (g.getV65(11) | 0) * 24 * 30 + (g.getV65(10) | 0) * 24 * 30 * 12;
  }
  function hasItem(c, id) {
    if (!c || !c.inv) return false;
    for (const it of c.inv) {
      if (it && (it.id | 0) === (id | 0) && (it.f[0] | 0) > 0) return true;
    }
    return false;
  }
  function dmg(g, target, amount, source) {
    if (Elona.Battle && Elona.Battle.applyDamage) {
      return Elona.Battle.applyDamage(target, amount, g, source, -8, 1000);   // 307748：dmghp …, -8
    }
    target.hp = Math.max(0, (target.hp | 0) - (amount | 0));
    target.set(50, target.hp);
    return amount;
  }

  /**
   * 开始説法（307624-307636）。
   * @returns {{ok:boolean, message?:string}}
   */
  function start(g) {
    const p = g.player;
    if (!p) return { ok: false, message: '现在不能这么做。' };
    if ((p.get(F_ROWACT) | 0) !== 0) return { ok: false, message: '你正忙着别的事情。' };
    if (g.onWorldMap) return { ok: false, message: '在世界地图上无法说法。' };
    p.set(F_ROWACT, ACTION);
    p.set(F_ROWLEFT, TURNS);
    p.set(F_FAITHEXP, 0);
    p.set(F_TIPS, 0);
    g.log('你开始说法。');
    return { ok: true, started: true, turns: TURNS };
  }

  /** 听众（307641-307674 的过滤条件） */
  function listeners(g, p) {
    const out = [];
    const charas = g.charas || [];
    for (let i = 0; i < charas.length; i++) {
      const c = charas[i];
      if (!c || c === p) continue;
      if ((c.get(0) | 0) !== 1) continue;                       // 存活
      if ((c.x | 0) !== 0 || (c.y | 0) !== 0) {                 // 坐标合法
        if (Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) > RANGE) continue;
      }
      if ((c.get(14) | 0) <= 0) continue;                       // 关注度
      if ((c.get(251) | 0) > 0) continue;
      if ((c.get(256) | 0) >= 60) continue;
      if (cbit(c, 992)) continue;                               // 被驯服
      out.push(c);
    }
    return out;
  }

  /**
   * 一次结算（307639-307974）。
   * @returns {{tips:number, cheers:number, converts:number, rocks:number}}
   */
  function settle(g) {
    const p = g.player;
    const ps = skillOf(p);
    const res = { tips: 0, cheers: 0, converts: 0, rocks: 0 };
    for (const c of listeners(g, p)) {
      // 敌对者只会注意到你（307679-307690）
      if ((c.get(9) | 0) === -3) {
        c.set(201, 30);
        continue;
      }
      let interest = c.get(14) | 0;
      // 玩家说法时，镇民会逐渐失去兴趣（307692-307697）
      if ((c.index | 0) >= 16) {
        interest -= g.rng.rnd(15);
        c.set(15, stamp(g) + 12);
      }
      if (interest <= 0) {                                      // 307698-307717
        c.set(14, 0);
        if (Elona.UI && Elona.UI.pushMessage) Elona.UI.pushMessage('「もうその話は聴いたよ」');
        else g.log('「已经听过这段了。」');
        continue;
      }
      // 对方更会讲 → 反感，甚至扔石头（307719-307755）
      if (skillOf(c) > ps) {
        if (g.rng.rnd(6) === 0 || (g.rng.rnd(3) === 0 && (c.get(61) | 0) !== (p.get(61) | 0))) {
          let d = g.rng.rnd(skillOf(c) + 1) + 1;
          if ((c.get(27) | 0) === 29) d = (c.get(38) | 0) * 2 + g.rng.rnd(100);
          g.log(`${c.name} 扔来一块石头。`);
          dmg(g, p, d, c);
          res.rocks++;
          if ((p.hp | 0) <= 0) break;
          continue;
        }
      }
      // お布施（307756-307780）
      if (g.rng.rnd(3) === 0 && interest > 0) {
        let amt = limit(ps * 10, 0, (c.get(38) | 0) * 8);
        if ((c.index | 0) < 16) amt = 1;                        // 队友只给 1 枚
        const st = c.get(150) | 0;
        if ((st >= 1000 && st < 2000) || st === 2003) amt = idiv(amt, 50);
        if (cbit(c, 23) || cbit(c, 27) || cbit(c, 964)) amt = limit(idiv(amt + 1, 5) + 1, 1, 3000);
        const gold = c.get(30) | 0;
        if (amt > gold) amt = gold;
        if (amt > 0) {
          c.set(30, gold - amt);
          p.set(30, (p.get(30) | 0) + amt);
          res.tips += amt;
          if ((c.index | 0) >= 16) {                            // 307774-307779
            c.set(14, interest - 20);
            c.set(15, stamp(g) + 12);
          }
        }
      }
      if (ps < skillOf(c)) continue;                            // 307782-307783
      if (g.rng.rnd(ps + 1) > g.rng.rnd(skillOf(c) * 3 + 1)) {   // 307785
        if (g.rng.rnd(3) === 0) {
          let gain = idiv(skillOf(c), 2) + 1;                    // 307902-307905
          if (cbit(c, 23) || cbit(c, 27) || cbit(c, 964)) {
            gain = limit(idiv(gain + 1, 5) + 1, 1, 30);
          }
          // 派对委托（var_65(70) == 1009）的兴奋度（307906-307913）
          //   原版槽位 57..244 是「地图 NPC」；本项目的 NPC 从 16 号起，等同判断
          if ((g.getV65(70) | 0) === 1009 && (c.index | 0) >= 16 && (c.get(17) | 0) < 53) {
            c.set(17, (c.get(17) | 0) + g.rng.rnd(2) + 1);
            if (Elona.QuestMap && Elona.QuestMap.partyScore) Elona.QuestMap.partyScore(g);   // 307910
          }
          p.set(F_FAITHEXP, (p.get(F_FAITHEXP) | 0) + gain);
          res.cheers++;
          g.log(`${c.name} 发出了欢呼。`);
          // 改宗（307933-307962）
          if ((c.index | 0) !== 0 && !hasItem(c, OFFERING_ITEM) && (c.get(61) | 0) !== (p.get(61) | 0)) {
            c.set(61, p.get(61) | 0);
            res.converts++;
            g.log(`${c.name} 深受感动，改信了${godName(p.get(61), 'jp')}！`);
            p.set(F_FAITHEXP, (p.get(F_FAITHEXP) | 0) + skillOf(c) * 2);      // 307953
            g.setV65(305, (g.getV65(305) | 0) + 1);                            // var_65(250+55)
            if ((g.getV65(70) | 0) === 1009 && (c.index | 0) >= 16 && (c.get(17) | 0) < 53) {
              c.set(17, (c.get(17) | 0) + 2);                                  // 307947-307949
              if (Elona.QuestMap && Elona.QuestMap.partyScore) Elona.QuestMap.partyScore(g);
            }
          }
        }
      }
    }
    if (res.tips > 0) {                                        // 307967-307972
      p.set(F_TIPS, (p.get(F_TIPS) | 0) + res.tips);
      g.log(`你收到了 ${res.tips} 枚金币的布施。`);
    }
    return res;
  }

  /** 收尾（307976-308010） */
  function finish(g) {
    const p = g.player;
    const tips = p.get(F_TIPS) | 0;
    if (tips !== 0) g.log(`你一共收到了 ${tips} 金币的布施。`);
    p.set(F_ROWACT, 0);
    p.set(F_ROWLEFT, 0);
    const exp = limit(idiv(p.get(F_FAITHEXP) | 0, 2) + 20, 20, 500);
    if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(p, SKILL_FAITH, p, exp, 0, 0, g);
    g.log(`你的信仰技能提升了（${exp}）。`);
    // 同行的队友（1..15 号、视野内）同得（307988-308009）
    for (const c of (g.charas || [])) {
      if (!c || c === p) continue;
      const idx = c.index | 0;
      if (idx < 1 || idx >= 16) continue;
      if ((c.get(0) | 0) !== 1) continue;
      if (Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) > 6) continue;
      if (Elona.Stats && Elona.Stats.skillExp) Elona.Stats.skillExp(c, SKILL_FAITH, c, exp, 0, 0, g);
    }
    p.set(F_FAITHEXP, 0);
    p.set(F_TIPS, 0);
    return { finished: true, type: ACTION, tips, exp };
  }

  /** 每回合推进（由 Actions.tickRowAct 调用） */
  function tick(g) {
    const p = g.player;
    if (!p) return null;
    if ((p.get(F_ROWACT) | 0) !== ACTION) return null;
    // 讲道中被打死：源码在 dmghp 后 `if (var_58(0,var_243)==0) break`，
    // 跳出循环后照常走 rowactend（307749-307751 / 307985）
    if ((p.hp | 0) <= 0) return finish(g);
    const left = p.get(F_ROWLEFT) | 0;
    if (left <= 0) return finish(g);
    let res = null;
    if (idiv(left, EFFECT_LEFT) === 0) res = settle(g);         // 307638
    p.set(F_ROWLEFT, left - 1);
    return Object.assign({ type: ACTION, left: left - 1 }, res || {});
  }

  Elona.Preach = {
    ACTION, TURNS, SKILL_FAITH, RANGE, OFFERING_ITEM,
    start, tick, settle, finish, listeners, godName,
  };
})(window);
