'use strict';
/**
 * 吐息系的补全（0-EL）—— `*label_2965` 里与吐息相关的分支
 *
 * 【源码依据】（start.hsp 2.33R）
 *   698 可变吐息       337557-337672　按 var_58(414) 的 1..11 选 602..612；没有该值时按
 *                                  施法者（比较用）与目标（初值）的元素技能挑一个，
 *                                  最后 `var_396 = 602 + var_58(174)` 后 `gosub *label_2960`
 *   773 歼灭可变吐息   337435-337550　斗志 -25、`var_801 = 100`（威力加成），其余同上
 *   763 破坏奔流       328002-328106　MP < 上限/4 → 什么都不发生；把沿途地面改成 38，
 *                                  伤害 = role(...) + 等级补正/2，属性 60；收尾 MP -上限/4
 *   837 沙尘炮         327907-328001　伤害 = role(...)（无等级补项），属性 64；
 *                                  命中后 var_58(263) 计数 +1、dmgcon 4（朦朧）
 *
 * 610/611/612（猛毒/幻影/能量吐息）只在 `calcskill` 里缺分支，其余流程与 602-609 一致，
 * 因此直接补在 `spell.calcSkill` 里（见该函数注释），本模块不重复。
 *
 * 【省略】cut-in、snd / animeload 等表现层。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const IDS = [698, 763, 773, 837];

  function has(id) { return IDS.indexOf(id | 0) >= 0; }

  /** var_58(414) → 具体吐息 id（337560-337625 的 11 个分支） */
  const ELEM_BY_414 = { 1: 602, 2: 603, 3: 604, 4: 605, 5: 611, 6: 610, 7: 608, 8: 607, 9: 609, 10: 606, 11: 612 };

  /** 元素技能 → var_58(174)（337627-337660）：50..59 逐个比较，最后 60 兜底 */
  const SKILL_TO_174 = [[50, 0], [51, 1], [52, 2], [53, 3], [54, 9], [55, 8], [56, 6], [57, 5], [58, 7], [59, 4]];

  /**
   * 挑一条吐息（337627-337665）。
   * 【照抄原版】初值取 **var_244（目标）** 的 var_82(60)，比较的是 var_243（施法者）的
   *   50..59 —— 源码就是这么写的，这里不"修正"。
   */
  function pickBreath(g, caster, tg) {
    const seed = (tg && typeof tg.skill === 'function') ? (tg.skill(60) | 0) : 0;
    let best = seed;
    let v174 = 10;
    for (let i = 0; i < SKILL_TO_174.length; i++) {
      const sid = SKILL_TO_174[i][0];
      const v = (typeof caster.skill === 'function') ? (caster.skill(sid) | 0) : 0;
      if (v > best) { v174 = SKILL_TO_174[i][1]; best = v; }
    }
    if (((typeof caster.skill === 'function') ? (caster.skill(60) | 0) : 0) >= best) v174 = 10;
    return 602 + v174;
  }

  /** 可变吐息（698 / 773）：算好要放的 id，再走一次效果分派 */
  function variableBreath(g, caster, id, tg, power) {
    let sub = ELEM_BY_414[caster.get(414) | 0] || 0;
    if (!sub) sub = pickBreath(g, caster, tg);
    let saved801 = null;
    if ((id | 0) === 773) {
      // 337447：var_801 = 100（318307 的威力加成读这个值）
      saved801 = (g.var801 === undefined) ? 0 : g.var801;
      g.var801 = 100;
    }
    let r;
    try {
      r = Elona.Spell.dispatchEffect(g, caster, sub, tg, power);
    } finally {
      if (saved801 !== null) g.var801 = saved801;
    }
    return Object.assign({ ok: true, type: 0, implemented: true, breath: sub }, r || {});
  }

  // ==========================================================================
  // 763 破坏奔流 / 837 沙尘炮：自己铺 breath_list 再逐格结算
  // ==========================================================================

  /** 每格结算（327930-328092 / 328035-328195 的共同部分） */
  function cellsDamage(g, caster, id, tg, dice, opt) {
    const S = Elona.Spell;
    const gr = S.getRoute(g, caster.x, caster.y, tg.x, tg.y);
    if (!gr || !gr.ok) return { ok: true, type: 0, implemented: true, noRoute: true };
    const bl = S.breathList(g, caster, id, gr.route);
    const lv = caster.get(38) | 0;
    const lvBonus = ((limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4 * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1);
    const hits = [];
    const cells = (bl && bl.cells) || [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!S.fovLos(g, caster.x, caster.y, cell.x, cell.y)) continue;
      if (cell.x === (caster.x | 0) && cell.y === (caster.y | 0)) continue;
      if (opt.tile) {
        // 328020-328024：把地面改成 38（不过 701 / 671 两种地形）
        const c0 = g.map && g.map.cell ? g.map.cell(cell.x, cell.y) : null;
        if (c0) {
          const tile = c0[0] | 0;
          if (tile !== 701 && tile !== 671) c0[0] = 38;
        }
      }
      const c2 = g.map && g.map.cell ? g.map.cell(cell.x, cell.y) : null;
      if (!c2 || (c2[1] | 0) === 0) continue;
      let tIdx = (c2[1] | 0) - 1;
      if (tIdx === (caster.index | 0)) continue;
      let t = g.charas[tIdx];
      if (!t || (t.get(0) | 0) !== 1) continue;
      // 护身（333320-333330 同款）：168 有值且不是主角时按 HP 抽签改打护卫者
      if ((t.get(168) | 0) !== 0 && tIdx !== 0) {
        const gd = g.charas[t.get(167)];
        if (gd && g.rng && g.rng.rnd((t.get(50) | 0) + 1) < g.rng.rnd((gd.get(50) | 0) + 1)) {
          tIdx = t.get(167) | 0;
          t = g.charas[tIdx] || t;
        }
      }
      let dmg = Elona.Battle.role(g.rng, dice.dice, dice.sides, dice.bonus);
      if (opt.levelHalf) dmg += idiv(lvBonus, 2);
      if ((caster.get(418) | 0) !== 0) {
        dmg = idiv(dmg * (100 + idiv(limit(caster.get(418) | 0, 0, 2000), 10)), 100);
      }
      const mc = S.calcMagicControl(g, caster, t, dmg);
      if (mc.avoided) continue;
      dmg = mc.dmg;
      const applied = S.applyMagicDamage(g, caster, t, dmg, dice.elem, id);
      // 327993-327996：命中计数（263）+ 朦朧
      if (opt.confuse) {
        if ((t.get(263) | 0) === 0) t.set(263, (t.get(263) | 0) + 1);
        const pow = 100 + ((typeof caster.skill === 'function') ? (caster.skill(11) | 0) : 0);
        if (S.dmgconOf) S.dmgconOf(g, t, 4, pow);
      }
      hits.push({ index: tIdx, dmg: applied });
    }
    return { ok: true, type: 0, implemented: true, cells: cells.length, hits };
  }

  function run(g, caster, id, tg, power) {
    switch (id | 0) {
      case 698:
      case 773:
        return variableBreath(g, caster, id, tg, power);
      case 837: {
        // 327911-327914：没有路线就结束
        if (!tg || (tg.get(0) | 0) !== 1) return { ok: true, type: 0, implemented: true, noTarget: true };
        const dice = Elona.Spell.calcSkill(837, caster, power || 0, 0);
        if (!dice) return { ok: true, type: 0, implemented: false, reason: 'calcskill 未移植 837' };
        return cellsDamage(g, caster, 837, tg, dice, { confuse: true });
      }
      case 763: {
        // 328004：MP 不足四分之一 → 什么都不发生
        const mp = caster.get(55) | 0;
        const mpMax = caster.get(56) | 0;
        if (mp < idiv(mpMax, 4)) return { ok: true, type: 0, implemented: true, nothing: true };
        if (!tg || (tg.get(0) | 0) !== 1) return { ok: true, type: 0, implemented: true, noTarget: true };
        const dice = Elona.Spell.calcSkill(763, caster, power || 0, 0);
        if (!dice) return { ok: true, type: 0, implemented: false, reason: 'calcskill 未移植 763' };
        const r = cellsDamage(g, caster, 763, tg, dice, { levelHalf: true, tile: true });
        // 328106：dmgmp MP 上限/4
        if (Elona.Status && Elona.Status.dmgmp) Elona.Status.dmgmp(caster, idiv(mpMax, 4), g);
        return r;
      }
      default:
        return { ok: true, type: 0, implemented: false, reason: 'breathx 未收录该 id' };
    }
  }

  Elona.BreathX = { has, run, IDS, pickBreath, ELEM_BY_414 };
})(window);
