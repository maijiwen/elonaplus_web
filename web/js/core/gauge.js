'use strict';
/**
 * 斗志技 / 广域系特殊能力（core/gauge.js）—— `*label_2965` 的 `var_1302 == id` 分支
 *
 * 【源码依据】（start.hsp 2.33R）
 *   750 【力之解放】 322494-322519　主角专用；把 var_58(266,0) 在 0 / 2 之间切换
 *                                  （ゲージ技方针：0 温存 / 2 积极），**不消耗回合**
 *   741 组合力量     333096-333150　斗志 <50 什么都不发生；否则给目标 addbuff(42, 50, 51)，
 *                                  再遍历半径 4、有视线的同侧伙伴（var_58(168) != 0：
 *                                  正在护人）各自 -50 斗志 → 回血 + addbuff(42, 50, 50)
 *   803 *Purge*      333546-333570　var_65(250+23)（= var_65(273)）== 5 时，把半径 4 内所有
 *                                  敌对（关系 -3）角色的 HP / MP 清零；该标记源码里没有任何
 *                                  赋值点，等于恒不成立（见 A383）
 *   804 【发动合体攻击】333360-333540　斗志 <100 → 什么都不发生；主角对关系 >= -1 的目标
 *                                  会「さすがに卑怯な気がする…」；否则集结半径 4 内有视线的同侧
 *                                  伙伴，按 max(戦術152, 射撃189, 詠唱172, 魔道具174) × 斗志%
 *                                  累积力量，再追加自己的力量，全部斗志清零后一击（属性 702）
 *
 * 【关键字段】
 *   var_58(182) 斗志（パワーゲージ百分比，上限 100/200，见 core/morale.js）
 *   var_58(266) 行动模式 / ゲージ技方针（0 突撃・温存 / 1 防御 / 2 迎撃・积极 / 3 交渉）
 *   var_58(60)  怒气槽（被治疗、被打时累积，满 120 变 100 时爆气）
 *   var_58(167/168) 护卫对象 / 正在护卫标记
 *   var_65(273) *Purge* 的触发标记
 *
 * 【省略】cut-in 立绘与音效（`var_1117` / `label_2111`）、`customtalk` 喊话。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

  /** 斗志 */
  const F_MG = 182;
  /** 怒气槽 */
  const F_RAGE = 60;
  /** 行动模式 / ゲージ技方针 */
  const F_MODE = 266;
  /** 护卫对象 / 护卫标记 */
  const F_GUARD_WHO = 167;
  const F_GUARDING = 168;

  /** 合体攻击 / 组合力量的技能：戦術 / 射撃 / 詠唱 / 魔道具 */
  const FORCE_SKILLS = [152, 189, 172, 174];

  const IDS = [741, 750, 803, 804];

  function has(id) { return IDS.indexOf(id | 0) >= 0; }

  function R(g, n) {
    if (g && g.rng && typeof g.rng.rnd === 'function') return g.rng.rnd(Math.max(1, n | 0));
    if (Elona.rng && typeof Elona.rng.rnd === 'function') return Elona.rng.rnd(Math.max(1, n | 0));
    return 0;
  }
  function sk(c, id) { return (c && typeof c.skill === 'function') ? (c.skill(id) | 0) : 0; }
  function cbit(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? Elona.Status.cbit(c, bit) : 0;
  }
  function dist(a, b) {
    if (Elona.Battle && Elona.Battle.dist) return Elona.Battle.dist(a.x, a.y, b.x, b.y);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  function los(g, a, b) {
    if (Elona.Spell && Elona.Spell.fovLos) return !!Elona.Spell.fovLos(g, a.x, a.y, b.x, b.y);
    return true;
  }
  function log(g, s) { if (g && g.log) g.log(s); }
  function field(id, n) { return Elona.Spell.field(id, n); }

  /** 范围：var_83(3,656)\1000+1（= 3006 → 4） */
  function rangeOf() {
    const f3 = (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(656, 3) | 0) : 3006;
    return idiv(f3, 1000) + 1;
  }

  function buff(g, c, id, power, dur) {
    if (!c || !Elona.Status || !Elona.Status.addbuff) return 0;
    return Elona.Status.addbuff(g, c, id, power, dur) | 0;
  }

  function heal(c, n) {
    if (!c || !(n > 0)) return 0;
    if (Elona.Status && Elona.Status.healhp) return Elona.Status.healhp(c, n | 0) | 0;
    const before = c.get(50) | 0;
    c.set(50, Math.min(c.get(51) | 0, before + (n | 0)));
    return (c.get(50) | 0) - before;
  }

  /** 333360-333415 / 333440-333470 的成员筛选（合体攻击与技能经验结算共用） */
  function eachAlly(g, caster, fn) {
    const out = [];
    const list = (g && g.charas) || [];
    const range = rangeOf();
    const selfIsPlayer = (caster.index | 0) === 0;
    const selfSide = caster.get(9) | 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      const side = c.get(9) | 0;
      // 333368-333377：主角或关系 10（中立）时只收关系 >= 10 的；其余按同关系值分组
      if (side === 10 || selfIsPlayer) {
        if (side < 10) continue;
      }
      if (side < 10 && !selfIsPlayer) {
        if (side !== selfSide) continue;
      }
      if (dist(caster, c) > range) continue;
      if (!los(g, caster, c)) continue;
      const r = fn(c, i);
      if (r !== undefined) out.push(r);
    }
    return out;
  }

  /** 战斗力：max(戦術, 射撃, 詠唱, 魔道具)（333455-333478） */
  function bestSkill(c) {
    let best = 0;
    for (let i = 0; i < FORCE_SKILLS.length; i++) {
      const v = sk(c, FORCE_SKILLS[i]);
      if (v > best) best = v;
    }
    return best;
  }

  /** 单人的力量贡献：v * sqrt(v) * 5 + rnd(v + 1)（333480-333484 / 333521-333524） */
  function forceOf(g, c, gauge) {
    const v = idiv(bestSkill(c) * gauge, 100);
    if (v <= 0) return 0;
    return v * Math.sqrt(v) * 5 + R(g, v + 1);
  }

  function nothing(g, msg) {
    if (msg) log(g, msg);
    return { ok: true, type: 0, implemented: true, nothing: true };
  }

  // ==========================================================================
  // 750 【力之解放】322494-322519
  // ==========================================================================
  function gaugeToggle(g, caster) {
    if ((caster.index | 0) !== 0) {
      // 322498：不是主角就直接跳过（NPC 没有这条）
      return { ok: true, type: 0, implemented: true, nothing: true, npc: true };
    }
    const cur = caster.get(F_MODE) | 0;
    if (cur === 0) {
      caster.set(F_MODE, 2);
      log(g, '你决定积极使用必杀技。');
      return { ok: true, type: 0, implemented: true, mode: 2, noTurn: true };
    }
    caster.set(F_MODE, 0);
    log(g, '你决定把必杀技留到关键时刻。');
    return { ok: true, type: 0, implemented: true, mode: 0, noTurn: true };
  }

  // ==========================================================================
  // 741 组合力量 333096-333150
  // ==========================================================================
  function comboPower(g, caster, tg) {
    const gauge = caster.get(F_MG) | 0;
    if (gauge < 50) return nothing(g, '什么也没有发生……');
    // 333107：var_58(182, var_243) -= 50 —— 实际扣除由 Morale.spend（成本表 741: 50）完成，
    //   这里只按扣除后的值计算治疗量，避免重复扣。
    const after = Math.max(0, gauge - 50);
    if (tg && (tg.get(0) | 0) === 1) buff(g, tg, 42, 50, 51);          // 333108
    const healed = [];
    if ((caster.get(F_GUARD_WHO) | 0) > 0) {                           // 333109-333111
      const n = idiv((caster.get(51) | 0) * (after + 40), 200);
      if (heal(caster, n) > 0) healed.push(caster.index | 0);
    }
    // 333113-333148：半径 4、有视线、正在护卫（168 != 0）的同伴
    eachAlly(g, caster, (c) => {
      if (c === caster) return undefined;
      if ((c.get(F_GUARDING) | 0) === 0) return undefined;
      const left = Math.max(0, (c.get(F_MG) | 0) - 50);
      c.set(F_MG, left);                                               // 333138-333141
      const n = idiv((c.get(51) | 0) * (left + 40), 200);              // 333142
      const got = heal(c, n);
      buff(g, c, 42, 50, 50);                                          // 333143
      if (got > 0) healed.push(c.index | 0);
      return c.index | 0;
    });
    return { ok: true, type: 0, implemented: true, power: after, healed };
  }

  // ==========================================================================
  // 803 *Purge* 333546-333570
  // ==========================================================================
  function purge(g, caster) {
    // 333549：var_65(250+23) != 5 → 直接结束。源码里没有任何写入点（A383）。
    const flag = (g && g.getV65) ? (g.getV65(273) | 0) : 0;
    if (flag !== 5) return nothing(g, null);
    const killed = [];
    eachAllyLikeEnemies(g, caster, (c) => {
      c.set(50, 0);
      c.set(55, 0);
      killed.push(c.index | 0);
      return c.index | 0;
    });
    return { ok: true, type: 0, implemented: true, purged: killed };
  }

  /** 803 的遍历：只挑关系 -3 的敌对者（333552-333567） */
  function eachAllyLikeEnemies(g, caster, fn) {
    const out = [];
    const list = (g && g.charas) || [];
    const range = rangeOf();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (c === caster) continue;
      if ((c.get(9) | 0) !== -3) continue;
      if (dist(caster, c) > range) continue;
      if (!los(g, caster, c)) continue;
      const r = fn(c, i);
      if (r !== undefined) out.push(r);
    }
    return out;
  }

  // ==========================================================================
  // 804 【发动合体攻击】333360-333540
  // ==========================================================================
  function tagForce(g, caster, tg) {
    const gauge = caster.get(F_MG) | 0;
    if (gauge < 100) return nothing(g, '什么也没有发生……');           // 333362
    if ((caster.index | 0) === 0 && tg && (tg.get(9) | 0) >= -1) {
      // 333371-333379：主角打非敌对目标 → 「さすがに卑怯な気がする…」
      return nothing(g, '总觉得这样做有点卑鄙……');
    }
    let force = 0;
    const drained = [];
    // 333381-333433：伙伴把自己的斗志全部押上
    eachAlly(g, caster, (c) => {
      if (c === caster) return undefined;
      if ((c.get(F_MG) | 0) < 0) return undefined;                     // 333385
      const cg = c.get(F_MG) | 0;
      const add = forceOf(g, c, cg);
      if (add > 0) force += add;
      c.set(F_MG, 0);                                                  // 333488
      drained.push(c.index | 0);
      return c.index | 0;
    });
    // 333500-333505：加上自己
    const own = forceOf(g, caster, gauge);
    if (own > 0) force += own;
    caster.set(F_MG, 0);
    if (force <= 0) return nothing(g, '力量不够……');                   // 333508

    const dmg = Math.round(force);                                     // var_1588
    let applied = 0;
    if (tg && (tg.get(0) | 0) === 1) {
      applied = (Elona.Battle && Elona.Battle.applyDamage)
        ? Elona.Battle.applyDamage(tg, dmg, g, caster, 702, 0) : dmg;
      // 333536-333543：被打的目标怒气 +30（满 100 记作 120）
      if ((tg.get(0) | 0) === 1) {
        const rg = tg.get(F_RAGE) | 0;
        if (rg < 100) {
          let nv = rg + 30;
          if (nv >= 100) nv = 120;                                     // 333470-333476
          tg.set(F_RAGE, nv);
        }
      }
      // 333470-333543：目标不是保护对象时，参战者获得 152/189/172/174 的技能经验
      const PROTECTED = [23, 27, 964, 960, 992, 985];
      let prot = false;
      for (let i = 0; i < PROTECTED.length; i++) {
        if (cbit(tg, PROTECTED[i])) { prot = true; break; }
      }
      if (!prot && Elona.Stats && Elona.Stats.skillExp) {
        eachAlly(g, caster, (c) => {
          if ((c.get(F_MG) | 0) < 0) return undefined;
          for (let k = 0; k < FORCE_SKILLS.length; k++) {
            try { Elona.Stats.skillExp(c, FORCE_SKILLS[k], c.index | 0, 200, 0, 0, g); } catch (e) { /* 无潜力表时跳过 */ }
          }
          return c.index | 0;
        });
      }
    }
    return { ok: true, type: 0, implemented: true, force: dmg, dmg: applied, drained };
  }

  // ==========================================================================
  // 主分派
  // ==========================================================================
  function run(g, caster, id, tg) {
    switch (id | 0) {
      case 750: return gaugeToggle(g, caster);
      case 741: return comboPower(g, caster, tg);
      case 803: return purge(g, caster);
      case 804: return tagForce(g, caster, tg);
      default:
        return { ok: true, type: 0, implemented: false, reason: 'gauge 未收录该 id' };
    }
  }

  Elona.Gauge = { has, run, IDS, rangeOf, bestSkill, forceOf, eachAlly };
})(window);
