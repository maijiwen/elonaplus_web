'use strict';
/**
 * 材料获取特效与同伴采集 —— start.hsp 生产/材料章节补完。
 *
 * 源码依据（hsp/start.hsp）：
 *   320164-320215  var_1302 == 1117「たくさんのマテリアルが降ってきた」
 *                 —— 素材生成卷轴(395, itemuse spell 1117 power 250) 与
 *                    素材箱(394, 345101 打开时 var_396=1117, var_578=100+f[25]*10) 共用。
 *   200462-200478  同伴击杀怪物时按采集技能累加材料进度 var_58(191..195) + skillexp(...,5)
 *   415118-415122  任一材料进度 >200 → 出现能力 66「マテリアルを受け取る」
 *   417526-417940  能力 66 兑换：五类材料池按点数从低到高兑换为真实材料
 *
 * 材料进度字段（不是技能潜力）：
 *   191 採掘(163) / 192 釣り(185) / 193 栽培(180) / 194 生化学(151) / 195 探知(159)
 *
 * 旅行结算的 +50 段在 core/travel.js（248753-248776）已实现，这里只补其余三块。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const R = (g, n) => ((g && g.rng) ? g.rng.rnd(Math.max(1, n | 0)) : 0);
  const idiv = (a, b) => Math.trunc((a | 0) / (b | 0));
  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);

  /** 采集技能 → 材料进度字段（200462-200478 / 248753-248776） */
  const GATHER_PAIRS = [
    [163, 191], [185, 192], [180, 193], [151, 194], [159, 195],
  ];

  /** 材料降下的候选分类（320179-320190）：默认 19，再按 rnd(10)==0 逐个上调 */
  const RAIN_CATS = [19, 16, 14, 15, 9, 12, 13, 11, 10];

  /**
   * 一次「材料降下」判定（var_1302 == 1117）。
   * 320164-320215 逐行对照：
   *   if (var_244 >= 16) → 「何もおきない」；本函数由道具使用触发，var_244 = 使用者 = 0，
   *     故不会走该分支（NPC 对自己用时 callers 可传 casterIndex >= 16）。
   *   var_2362 = 物品 f[17]（祝福度）：>=1 为祝福，额外 6 个；
   *   repeat rnd(3)+3+(var_2362>=1)*6：
   *     var_2049 = 19，随后 8 次 rnd(10)==0 依次改为 16/14/15/9/12/13/11/10；
   *     var_400 = random_material(var_578/10, var_578/50)（var_2362<0 时为 0=クズ）；
   *     matgetmain var_400, 1（reason 0）。
   * @param {object} g game
   * @param {object} [opt] {caster, power, curse}
   * @returns {{ok:boolean, count:number, materials:{id:number,n:number,category:number}[],
   *            cursed:boolean, messages:string[]}}
   */
  function materialRain(g, opt) {
    const o = opt || {};
    const Mat = Elona.Material;
    const out = { ok: false, count: 0, materials: [], cursed: false, messages: [] };
    if (!g || !Mat) return out;
    const caster = o.caster || g.player;
    if (caster && (caster.index | 0) >= 16) {
      out.messages.push('什么也没发生…');
      return out;
    }
    const power = (o.power === undefined ? 250 : o.power) | 0;
    const curse = (o.curse === undefined ? 0 : o.curse) | 0;
    const blessed = curse >= 1;
    const cursed = curse <= -1;
    out.cursed = cursed;
    out.messages.push(cursed ? '垃圾一样的东西从天而降！' : '大量的材料从天而降！');
    const times = R(g, 3) + 3 + (blessed ? 6 : 0);
    for (let i = 0; i < times; i++) {
      let cat = RAIN_CATS[0];
      for (let k = 1; k < RAIN_CATS.length; k++) {
        if (R(g, 10) === 0) cat = RAIN_CATS[k];
      }
      const id = cursed ? 0 : Mat.random(idiv(power, 10), idiv(power, 50), cat, (n) => R(g, n));
      Mat.add(g, id, 1, 0);
      out.materials.push({ id, n: 1, category: cat });
    }
    out.count = out.materials.length;
    out.ok = true;
    return out;
  }

  /**
   * 同伴击杀怪物后的材料进度累积（200454-200481）。
   * 条件：击杀者 1..15 号同伴、好感 var_58(17)>=100、
   *       死者由玩家/同伴侧击杀（cbit 23/27/964 已排除）、无 cbit 992。
   * 每项：采集技能 >0 → 进度 += limit(skill/5, 1, 10)，且 skillexp(skill, ally, 5)。
   * @returns {{ok:boolean, gains:{skill:number, field:number, amount:number}[], messages:string[]}}
   */
  function onAllyKill(g, killer, opt) {
    const o = opt || {};
    const out = { ok: false, gains: [], messages: [] };
    if (!g || !killer) return out;
    const idx = killer.index | 0;
    if (idx < 1 || idx > 15) return out;
    if ((killer.get(17) | 0) < 100) return out;
    if (o.noGain) return out;                         // cbit 23/27/964 / 992 等由调用方排除
    const S = Elona.Stats;
    for (const [skillId, field] of GATHER_PAIRS) {
      let lv = 0;
      try { lv = (killer.skill ? killer.skill(skillId) : 0) | 0; } catch (e) { lv = 0; }
      if (lv <= 0) continue;
      const amount = Math.max(1, Math.min(10, idiv(lv, 5)));
      killer.set(field, (killer.get(field) | 0) + amount);
      if (S && S.skillExp) {
        try { S.skillExp(killer, skillId, idx, 5, 1, 0, g); } catch (e) { /* noop */ }
      }
      out.gains.push({ skill: skillId, field, amount });
    }
    out.ok = out.gains.length > 0;
    return out;
  }

  /**
   * 是否出现能力 66「领取材料」（415118-415122）：任一进度 >200。
   */
  function canReceive(g, ally) {
    if (!ally) return false;
    return GATHER_PAIRS.some(([, field]) => (ally.get(field) | 0) > 200);
  }

  /**
   * 能力 66 兑换（417526-417940）。
   * 与 source 一致：五类材料池按点数从低到高循环，每类只要进度 >= 门槛就
   *   给 1 个对应材料并扣掉门槛点数（注意部分第二档要求 >=60 但只扣 40）。
   * 材料池（417548-417940 的 matgetmain 序列）：
   *   191 採掘：48(40) / 52(100) / 8(120) / 22(150) / 51(150)
   *   192 釣り：5(20) / 25(>=60,扣40) / 20(80) / 11(100) / 10(120)
   *   193 栽培：6(30) / 46(>=100,扣40) / 17(120) / 29(130) / 34(150)
   *   194 生化：31(40) / 19(100) / 18(120) / 32(120) / 21(130)
   *   195 探知：45(40) / 43(50) / 38(100) / 36(120) / 30(120) / 44(150) / 23(150)
   * @returns {{ok:boolean, gains:{id:number,n:number}[], messages:string[]}}
   */
  const RECEIVE_POOLS = {
    191: [[48, 40], [52, 100], [8, 120], [22, 150], [51, 150]],
    192: [[5, 20], [25, 60, 40], [20, 80], [11, 100], [10, 120]],
    193: [[6, 30], [46, 100, 40], [17, 120], [29, 130], [34, 150]],
    194: [[31, 40], [19, 100], [18, 120], [32, 120], [21, 130]],
    195: [[45, 40], [43, 50], [38, 100], [36, 120], [30, 120], [44, 150], [23, 150]],
  };

  function receive(g, ally) {
    const Mat = Elona.Material;
    const out = { ok: false, gains: [], messages: [] };
    if (!g || !ally || !Mat) return out;
    for (const [field, pool] of Object.entries(RECEIVE_POOLS)) {
      const fid = Number(field);
      let pts = ally.get(fid) | 0;
      for (const row of pool) {
        const matId = row[0], need = row[1], cost = row[2] === undefined ? row[1] : row[2];
        // 源码 repeat 500 循环：每轮从低到高判定，点数够就给 1 个并扣点数。
        while (pts >= need) {
          Mat.add(g, matId, 1, 6);
          out.gains.push({ id: matId, n: 1 });
          pts -= cost;
        }
      }
      ally.set(fid, Math.max(0, pts));
    }
    out.ok = out.gains.length > 0;
    if (!out.ok) out.messages.push('同伴似乎还没采集到材料。');
    return out;
  }

  Elona.MaterialFx = {
    GATHER_PAIRS, RAIN_CATS, RECEIVE_POOLS,
    materialRain, onAllyKill, canReceive, receive,
  };
})(typeof window !== 'undefined' ? window : globalThis);
