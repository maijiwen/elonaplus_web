'use strict';
/**
 * 自身强化系特殊能力（core/buffact.js）—— 对应 `*label_2965` 的 `var_1302 == id` 分支
 *
 * 【源码依据】（start.hsp 2.33R）
 *   673 明镜止水 335405-335411　addbuff(var_244, 29, 100, 20 + var_82(106)/5)
 *   677 超再生   329404-329415　healhp(var_244, 最大HP/10 + 1) → addbuff(var_244, 30, 4000, 20)
 *   686 充填     330410-330416 → *label_2917(308012-308102)：rowact 13，10 回合后
 *                              addbuff(var_243, 32, 400, 主角 1 / NPC 3)
 *   709 强效道具 337143-337149　addbuff(var_243, 38, 31, 31)
 *   736 金属外套 338851-338870　主角专用；var_58(265) = 6（199065-199069 受伤时 /10）
 *   779 盾牌架挡 330564-330609　半径 var_83(3,656)\1000+1 = 4、同队、有视线、
 *                              var_58(96)==1 且 var_58(32)&1 → addbuff(51, 40, 40)
 *   783 重力偏转 330617-330655　同一套范围条件 → addbuff(52, limit(var_58(262)+20, 20,
 *                              sorg(18)/2)，上限 300, 40)，随后 var_58(262) += 20
 *
 * 【关键字段】
 *   var_58(140/141/142)  rowact 类别 / 剩余回合 / 附加参数（140=13 为充填）
 *   var_58(96)  盾装备槽（1 = 有盾）　var_58(32) 装备位掩码（bit0 = 盾）
 *   var_58(262) 重力偏转的累积层数（每用一次 +20，最多 1000，每回合 -1，见 215957-215962）
 *   var_58(265) 金属外套剩余回合（受伤时伤害 /10 后清零）
 *
 * 【省略】var_1117 = 20 的震屏、snd / animeload 等表现层；充填的「盟友喊话」用
 *   `Elona.Talk.say` 走自定义台词，缺台词表时静默跳过（登记 A379）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const F_ROWACT = 140;
  const F_ROWLEFT = 141;
  const F_ROWARG = 142;
  const ROWACT_CHARGE = 13;
  /** 充填的蓄力回合数（label_2917 的 var_58(141) = 10） */
  const CHARGE_TURNS = 10;

  /** 本模块负责的 id 列表 */
  const IDS = [673, 677, 686, 709, 736, 779, 783];

  function has(id) { return IDS.indexOf(id | 0) >= 0; }

  function R(g, n) {
    if (g && g.rng && typeof g.rng.rnd === 'function') return g.rng.rnd(Math.max(1, n | 0));
    if (Elona.rng && typeof Elona.rng.rnd === 'function') return Elona.rng.rnd(Math.max(1, n | 0));
    return 0;
  }

  function buff(g, c, id, power, dur) {
    if (!c || !Elona.Status || !Elona.Status.addbuff) return 0;
    return Elona.Status.addbuff(g, c, id, power, dur) | 0;
  }

  function skillOf(c, id) {
    if (c && typeof c.skill === 'function') return c.skill(id) | 0;
    return 0;
  }

  function potentialOf(c, id) {
    if (Elona.Stats && Elona.Stats.sorg) return Elona.Stats.sorg(c, id) | 0;
    return 0;
  }

  /** 角色是否「与主角同侧」（synccheck(c, -1)：var_58(6) == var_104 或骑乘对象） */
  function syncCheck(g, c) {
    if (!c) return false;
    if ((c.index | 0) === 0) return true;
    if (g && g.getV65 && (c.index | 0) === (g.getV65(183) | 0)) return true;
    if (Elona.Party && Elona.Party.isAlly) return !!Elona.Party.isAlly(c);
    return false;
  }

  function los(g, a, b) {
    if (!Elona.Spell || !Elona.Spell.fovLos) return true;
    return !!Elona.Spell.fovLos(g, a.x, a.y, b.x, b.y);
  }

  function dist(a, b) {
    if (Elona.Battle && Elona.Battle.dist) return Elona.Battle.dist(a.x, a.y, b.x, b.y);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  /** 779 / 783 的范围：var_83(3,656)\1000+1 = 3006\1000+1 = 4 */
  function auraRange() {
    const f3 = (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(656, 3) | 0) : 3006;
    return idiv(f3, 1000) + 1;
  }

  /**
   * 范围遍历（330564-330610 / 330617-330655 的共同循环体）。
   *   · 主角/同伴（槽位 < 16）只影响槽位 < 16；NPC 只影响关系值相同的角色
   *   · 距离 > 4 或无视线 → 跳过
   */
  function auraEach(g, caster, fn) {
    const out = [];
    const list = (g && g.charas) || [];
    const range = auraRange();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      // cnt 是原版的角色槽位（= 本项目的 chara.index），不是数组下标
      const slot = (c.index | 0);
      if ((caster.index | 0) < 16 || (caster.index | 0) === 0) {
        if (slot >= 16) continue;
      } else {
        if ((c.get(9) | 0) !== (caster.get(9) | 0)) continue;
      }
      if (dist(caster, c) > range) continue;
      if (!los(g, caster, c)) continue;
      const r = fn(c, i);
      if (r !== undefined) out.push(r);
    }
    return out;
  }

  // ==========================================================================
  // 686 充填 —— *label_2917（308012-308102）
  // ==========================================================================

  /**
   * 蓄力完成：addbuff(自身, 32, 400, 主角 1 / NPC 3) + rowactend。
   * 308060-308097。
   */
  function chargeFinish(g, c) {
    c.set(F_ROWACT, 0);
    c.set(F_ROWLEFT, 0);
    c.set(F_ROWARG, 0);
    const dur = ((c.index | 0) === 0) ? 1 : 3;
    buff(g, c, 32, 400, dur);         // 308091-308096
    if (g && g.log && syncCheck(g, c)) g.log('*完全充填！！*');
    if (g) g.shake = 20;              // var_1117 = 20（308084）
    return { ok: true, type: 0, implemented: true, charged: true, buff: { id: 32, power: 400, dur } };
  }

  /**
   * 开始蓄力：rowact 13、剩余 10 回合；同队 5 格内的伙伴有 2/3 概率喊一句（308013-308050）。
   */
  function chargeStart(g, c) {
    if ((c.get(F_ROWACT) | 0) === 0) {
      c.set(F_ROWACT, ROWACT_CHARGE);
      c.set(F_ROWLEFT, CHARGE_TURNS);
      if (g && g.log && syncCheck(g, c)) g.log(`${c.name} 开始蓄力。`);
      // 308027-308050：伙伴喊话（customtalk 116 = 自己，114 = 同伴）
      if ((c.index | 0) < 16) {
        const list = (g && g.charas) || [];
        for (let i = 0; i < list.length; i++) {
          if (i === 0) continue;
          const a = list[i];
          if (!a || (a.get(0) | 0) !== 1) continue;
          if ((a.get(251) | 0) !== 0) continue;        // 眩晕中
          if ((a.get(256) | 0) >= 60) continue;        // 睡眠中
          if (dist(a, (g.player || c)) > 5) continue;
          if (R(g, 3) === 0) continue;
          if (Elona.Talk && Elona.Talk.say) {
            try { Elona.Talk.say(g, a, 114); } catch (e) { /* 没有台词表就跳过 */ }
          }
        }
      }
      return { ok: true, type: 0, implemented: true, charging: true, turns: CHARGE_TURNS };
    }
    if ((c.get(F_ROWLEFT) | 0) > 0) {
      if (g && g.log && syncCheck(g, c)) g.log(`${c.name} 正在蓄力。`);
      return { ok: true, type: 0, implemented: true, charging: true, left: c.get(F_ROWLEFT) | 0 };
    }
    return chargeFinish(g, c);
  }

  /**
   * 每回合推进（604692-604696 → gosub *label_2917）。
   * 调用前 rowact 剩余回合已由主循环递减（604684）。
   */
  function chargeTick(g, c) {
    if ((c.get(F_ROWACT) | 0) !== ROWACT_CHARGE) return null;
    const left = c.get(F_ROWLEFT) | 0;
    if (left > 0) {
      // 308041-308048：每 5 回合提示一次
      if (g && g.log && idiv(left, 5) === 0 && syncCheck(g, c)) g.log(`${c.name} 正在蓄力。`);
      return { type: ROWACT_CHARGE, left };
    }
    const r = chargeFinish(g, c);
    return { type: ROWACT_CHARGE, finished: true, result: r };
  }

  // ==========================================================================
  // 主分派
  // ==========================================================================

  function run(g, caster, id, tg) {
    const self = caster;
    switch (id | 0) {
      // ---------------------------------------------------------------- 673 明镜止水
      case 673: {
        // 335405-335411：addbuff(var_244, 29, 100, 20 + var_82(106)/5)
        const dur = 20 + idiv(skillOf(self, 106), 5);
        const added = buff(g, self, 29, 100, dur);
        return { ok: true, type: 0, implemented: true, buff: { id: 29, power: 100, dur, added: !!added } };
      }
      // ---------------------------------------------------------------- 677 超再生
      case 677: {
        // 329404-329415：healhp(最大HP/10 + 1) → addbuff(30, 4000, 20)
        const heal = idiv(self.get(51), 10) + 1;
        if (Elona.Status && Elona.Status.healhp) Elona.Status.healhp(self, heal);
        else self.set(50, Math.min(self.get(51), (self.get(50) | 0) + heal));
        const added = buff(g, self, 30, 4000, 20);
        return { ok: true, type: 0, implemented: true, heal, buff: { id: 30, power: 4000, dur: 20, added: !!added } };
      }
      // ---------------------------------------------------------------- 686 充填
      case 686:
        return chargeStart(g, self);
      // ---------------------------------------------------------------- 709 强效道具
      case 709: {
        // 337143-337149：addbuff(var_243, 38, 31, 31)
        const added = buff(g, self, 38, 31, 31);
        return { ok: true, type: 0, implemented: true, buff: { id: 38, power: 31, dur: 31, added: !!added } };
      }
      // ---------------------------------------------------------------- 736 金属外套
      case 736: {
        // 338864：var_58(265) = 6。338853-338855：只有主角能发动
        if ((self.index | 0) !== 0) return { ok: true, type: 0, implemented: true, nothing: true };
        self.set(265, 6);
        return { ok: true, type: 0, implemented: true, guard: { field: 265, turns: 6 } };
      }
      // ---------------------------------------------------------------- 779 盾牌架挡
      case 779: {
        // 330611-330613：var_58(96)==1 且 var_58(32)&1 → addbuff(51, 40, 40)
        const hit = auraEach(g, self, (c) => {
          if ((c.get(96) | 0) !== 1) return undefined;         // 没装备盾
          if (((c.get(32) | 0) & 1) === 0) return undefined;   // 盾不在手
          buff(g, c, 51, 40, 40);
          return c.index | 0;
        });
        return { ok: true, type: 0, implemented: true, buff: { id: 51, power: 40, dur: 40 }, targets: hit };
      }
      // ---------------------------------------------------------------- 783 重力偏转
      case 783: {
        // 330645-330652：power = limit(var_58(262)+20, 20, sorg(18)/2)，上限 300
        const hit = auraEach(g, self, (c) => {
          let power = limit((c.get(262) | 0) + 20, 20, idiv(potentialOf(c, 18), 2));
          if (power > 300) power = 300;
          buff(g, c, 52, power, 40);
          c.set(262, (c.get(262) | 0) + 20);
          return c.index | 0;
        });
        return { ok: true, type: 0, implemented: true, buff: { id: 52, dur: 40 }, targets: hit };
      }
      default:
        return { ok: true, type: 0, implemented: false, reason: 'buffact 未收录该 id' };
    }
  }

  Elona.BuffAct = { has, run, chargeTick, chargeStart, chargeFinish, IDS, auraRange, auraEach };
})(window);
