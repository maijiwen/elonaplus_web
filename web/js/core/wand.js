/**
 * 魔杖（杖 / 魔杖）—— 源码 `*label_2986`（342598-342623）+ `*label_2956`（315335-315475）
 *
 * ## 效果 id 的数据来源（不是猜的）
 *
 * `*label_1934`（itemcreate 的模板表）里每个 `if ( var_60 == <物品id> )` 块都有一段：
 *     if ( var_59 == 14 ) {
 *         var_396 = 414        ← 效果 id（= actions.json / var_83 的索引）
 *         var_578 = 100        ← 威力基数
 *         return -1
 *     }
 * 使用流程（342598-342607）：
 *     var_59 = 14
 *     var_60 = var_99(3, var_579)     ← 物品 id
 *     gosub *label_0598                ← 空 label，紧接 *label_0599 → goto *label_1934
 *     gosub *label_2956                ← 用 var_396 施法
 * 所以「杖 → 法术」是源码写死的表（32 条），由 `tools/extract_wands.py` 提成 wands.json。
 *
 * 【重要】`var_396 = var_99(25)` 只在 364084-364096 的 `var_1302 == 30`（机械类）分支里，
 * 与魔杖无关 —— 之前把它当成「魔杖读 f[25]」是错的，f[25] 对杖恒为 0。
 *
 * ## 每次使用的完整流程（逐行对应）
 *   315336-315352  充能 f[9] <= 0 → 「zap ... / Nothing happens...」（不消耗、不结束回合）
 *   315354-315357  var_2362 = f[17]（祝福 >= 1 / 诅咒 <= -1）
 *   315359        precheck（`*label_2959`）
 *   315382-315388  威力 = 魔道具*4 + 基数 + limit(等级*8, 0, 8000)，再乘 `var_2423`（魔力/5）
 *   315432-315457  成功率 = 魔道具*20 + 100（祝福 ×125% / 诅咒 ×50%）；f[17]==0 时 rnd(2) 直接成功；
 *                 rnd(var_83(4)+1)/2 <= 成功率 → 成功；魔道具 < 100 时 rnd(魔道具+20)==0 → 失败
 *   315458-315466  成功 → `*label_2960`（效果分派）；未鉴定 → 鉴定
 *   315476-315506  消耗：f[9]-- （成功与失败都扣）
 *   342620-342622  使用者带 buff 38 时 `modgauge 5`
 */
(function (window) {
  'use strict';

  const Elona = window.Elona = window.Elona || {};

  const idiv = (a, b) => Math.floor((a | 0) / (b || 1));
  const limit = (v, a, b) => Math.max(a, Math.min(b, v));

  const CAT_WAND = 56000;
  const SKILL_MAGIC_DEVICE = 174;      // 魔道具
  const SKILL_MAGIC = 16;              // 魔力
  const FIELD_CHARGES = 9;             // var_99(9) 充能
  const FIELD_BLESS = 17;              // var_99(17) 祝福(1) / 诅咒(-1)
  const FIELD_LEVEL = 38;              // var_99(38) 生成等级

  let table = null;
  const cache = {};                    // itemId → 条目（少一次字符串拼接）

  async function load() {
    if (table) return table;
    table = await Elona.Data.table('wands');
    return table;
  }

  /** 表是否就绪；传入表则直接注入（测试 / 控制台用） */
  function ready(d) {
    if (d) { table = d; for (const k in cache) delete cache[k]; }
    return !!table;
  }

  function entry(itemId) {
    const k = String(itemId | 0);
    if (cache[k] !== undefined) return cache[k];
    const e = (table && table.wands && table.wands[k]) || null;
    cache[k] = e;
    return e;
  }

  function isWand(it) {
    if (!it || !Elona.ItemDB) return false;
    return (Elona.ItemDB.ref(it.id, 5) | 0) === CAT_WAND;
  }

  /** 效果 id（var_396）；表外物品返回 0 */
  function effectOf(it) {
    const e = entry(it && it.id);
    return (e && e.effectId) ? (e.effectId | 0) : 0;
  }

  /** 威力基数（var_578 的初值，全部是 100） */
  function basePower(it) {
    const e = entry(it && it.id);
    return (e && e.power) ? (e.power | 0) : 100;
  }

  function chargesOf(it) { return it ? (it.f[FIELD_CHARGES] | 0) : 0; }

  /** 名称（日志用） */
  function nameOf(it, lang) {
    if (!it || !Elona.ItemDB) return '魔杖';
    return Elona.ItemDB.name(it, lang || 'en');
  }

  /**
   * 威力（315382-315388 + 315862-315877 的祝福修正）。
   *   var_578  = 魔道具*4 + 魔杖强度 + limit(等级*8, 0, 8000)
   *   var_2423 = limit(var_58(98)*2/3, 0, 1000)/10 + limit(var_82(16)/5, 0, 300)
   *   `var_58(98)` 是装备上「魔法威力增强」(附魔 34) 的合计，由
   *   stats.applyEquipment 的 `case 34` 累加（对应源码 213745-213748），不是恒 0。
   */
  /** 增幅前的原始强度（315382 的 var_578 初值）*/
  function calcRaw(p, it) {
    const dev = p.skill(SKILL_MAGIC_DEVICE) | 0;
    return dev * 4 + basePower(it) + limit((it.f[FIELD_LEVEL] | 0) * 8, 0, 8000);
  }

  function calcPower(g, p, it, effectId) {
    const eid = effectId | 0;
    let power = calcRaw(p, it);
    const ench = limit(idiv((p.get(98) | 0) * 2, 3), 0, 1000);
    const mod = idiv(ench, 10) + limit(idiv((p.get(16) | 0), 5), 0, 300);
    power = idiv(power * (100 + mod), 100);
    // 315386-315388：状態 64 在 15000..34999 且有 buff 34 → ×6/5
    let hasBuff34 = false;
    if (Elona.Battle && Elona.Battle.findbuff) {
      try { hasBuff34 = Elona.Battle.findbuff(p, 34) !== -1; } catch (e) { hasBuff34 = false; }
    }
    const st = p.get(64) | 0;
    if (st >= 15000 && st < 35000 && hasBuff34) power = idiv(power * 6, 5);

    // 315849-315877：祝福 / 诅咒对威力的修正（buff 类方向相反）
    const S = Elona.Spell;
    const f1 = S ? S.field(eid, 1) : 0;
    const isBuff = idiv(f1, 1000) === 1;
    const bless = it.f[FIELD_BLESS] | 0;
    if (!isBuff) {
      if (bless >= 1) power = idiv(power * 150, 100);
      if (bless <= -1) power = 50;
    } else {
      if (bless >= 1) power = 50;
      if (bless <= -1) power = idiv(power * 150, 100);
    }
    return power;
  }

  /**
   * 成功率（315432-315457）。
   *   chance = 魔道具*20 + 100；祝福 ×125%、诅咒 ×50%
   *   f[17] <= -1 之外（即祝福与普通）先 rnd(2) 掷一次直接成功
   *   rnd(var_83(4)+1)/2 <= chance → 成功
   *   魔道具 < 100 且 rnd(魔道具+20)==0 → 失败
   */
  function calcSuccess(g, p, it, effectId) {
    const S = Elona.Spell;
    const dev = p.skill(SKILL_MAGIC_DEVICE) | 0;
    const bless = it.f[FIELD_BLESS] | 0;
    let chance = dev * 20 + 100;                                  // var_2384
    if (bless >= 1) chance = idiv(chance * 125, 100);
    let ok = false;
    if (bless <= -1) {
      chance = idiv(chance * 50, 100);
    } else if (g.rng.rnd(2)) {
      ok = true;                                                  // 315441-315445
    }
    const base = S ? (S.field(effectId, 4) | 0) : 0;              // var_83(4)
    if (idiv(g.rng.rnd(base + 1), 2) <= chance) ok = true;        // 315446-315448
    if (dev < 100 && g.rng.rnd(dev + 20) === 0) ok = false;       // 315453-315457
    return ok;
  }

  /**
   * 方向 → 该方向上的第一个角色（原版 5000 系的准星只取方向：`var_1311/1312`
   * 是射线终点，效果沿这条线结算，315809-315838）。
   * 遇到墙 / 出界就中断。
   */
  function targetByDir(g, p, dir) {
    if (!dir || !g.map) return null;
    const dx = dir.dx | 0, dy = dir.dy | 0;
    if (!dx && !dy) return null;
    for (let i = 1; i <= 20; i++) {
      const x = (p.x | 0) + dx * i, y = (p.y | 0) + dy * i;
      if (!g.map.inBounds(x, y)) return null;
      const cell = g.map.cell(x, y);
      if (!cell) return null;
      if (cell[1]) {
        const c = (g.charas || [])[cell[1] - 1];
        if (c && (c.get(0) | 0) === 1 && (c.index | 0) !== (p.index | 0)) return c;
      }
      if (g.map.attr && g.map.attr(cell[0], 0) === 3) return null;   // 墙挡住射线
    }
    return null;
  }

  /**
   * 315389-315421：杖的一次复制。
   *   NPC 分支（315390-315404）：魔道具 `var_82(178)` 判 `sqrt() + 80 >= rnd(100)`，
   *   成功 → 充能 +1、威力 ×7/10+1、练技能 178（+80）。
   *   玩家分支（315406-315421）：`var_65(250+310) == 100` 时必定复制（练 178 +40、dmgsp 3）。
   * @returns {{cloned:boolean, power:number}}
   */
  const CLONE_IDS = [901, 887, 570, 565, 175, 123, 122, 120, 1026, 1027, 1032];
  function tryClone(g, p, it, eid, power) {
    const id = it.f[3] | 0;
    if (CLONE_IDS.indexOf(id) < 0) return { cloned: false, power };
    const sp = (typeof p.get === 'function') ? (p.get(52) | 0) : (p.sp | 0);
    if (sp <= 0) return { cloned: false, power };
    const dev = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(p, 178) | 0) : 0;
    const rnd = (n) => ((g && g.rng && g.rng.rnd) ? (g.rng.rnd(n) | 0) : 0);
    let ok = false;
    if (dev > 0 && Math.sqrt(dev) + 80 >= rnd(100)) ok = true;       // 315390-315391
    if (!ok && g && typeof g.getV65 === 'function' && (g.getV65(560) | 0) === 100) ok = true;  // 315406
    if (!ok) return { cloned: false, power };
    it.f[FIELD_CHARGES] = chargesOf(it) + 1;                          // 315393 / 315409
    if (Elona.Stats && Elona.Stats.skillExp) {
      try {
        Elona.Stats.skillExp(p, 178, p.index | 0, dev > 0 ? 80 : 40, 9999, 0, g);
      } catch (e) { /* 技能表缺失 */ }
    }
    if (Elona.Status && Elona.Status.dmgsp) {
      try { Elona.Status.dmgsp(p, 3); } catch (e) { /* 忽略 */ }      // 315421
    }
    return { cloned: true, power: Math.floor(power * 7 / 10) + 1 };   // 315394
  }

  /**
   * 使用魔杖（`*label_2986` → `*label_2956`）。
   * @param {object} g
   * @param {number} idx 背包下标（也接受物品实例）
   * @param {object} [opts] { target, dir, askDirection, identify }
   *        dir   —— 由 `DirSel` 的 item 档给出的方向（315822「どの方向に振る？」）
   *        askDirection —— UI 要求「先选方向」时置 true；没有方向就返回 need-direction
   * @returns {object} { ok, reason?, effectId?, power?, charges?, ...效果结果 }
   */
  function use(g, idx, opts) {
    const o = opts || {};
    const p = g.player;
    const it = (typeof idx === 'object') ? idx : p.inv[idx];
    if (!it) return { ok: false, reason: 'no-item' };
    if (!isWand(it)) return { ok: false, reason: 'not-wand' };
    const nm = nameOf(it);

    // 315336-315352：没有充能 → 挥一下，什么也不发生（不消耗、不结束回合）
    if (chargesOf(it) <= 0) {
      g.log(`你挥了挥 ${nm}。`);
      g.log('何もおきない…');
      return { ok: false, reason: 'no-charge', charges: 0 };
    }

    const eid = effectOf(it);
    if (!eid) return { ok: false, reason: 'no-effect' };
    const S = Elona.Spell;
    if (!S) return { ok: false, reason: 'no-spell' };

    // 目标（自身系不需要）：f1 == 0 / 4 / 5 / 7 / >=1000 视为自身或无需目标
    //   315582-315586：玩家挥「自身系(3000)」的杖时会被改判成方向系(8000)，
    //   所以这类杖仍要先选目标（治愈/解咒杖朝目标挥）。
    const f1 = S.field(eid, 1);
    const f3 = S.field(eid, 3);
    const wandToDir = (idiv(f3, 1000) * 1000) === 3000;
    const selfOnly = !wandToDir && (f1 === 0 || f1 === 4 || f1 === 5 || f1 === 7 || idiv(f1, 1000) === 1);
    let target = p;
    if (!selfOnly) {
      target = o.target || (o.dir ? targetByDir(g, p, o.dir) : null);
      // 315822：原版先问「どの方向に振る？」，由准星给出方向
      if (!target && !o.dir && o.askDirection) {
        return { ok: false, reason: 'need-direction', effectId: eid, allowEmpty: true };
      }
      if (!target && o.dir) {
        g.log('那个方向没有可以瞄准的目标。');
        return { ok: false, reason: 'no-target', effectId: eid };
      }
      // 治愈/解咒杖（3000 系）：没给目标也没给方向时按「对自己挥」处理
      //   （原版由方向光标选格，选自己所在格即对自身生效）
      if (!target && wandToDir) {
        target = p;
      }
      if (!target) {
        target = (Elona.Throw && Elona.Throw.nearestEnemy) ? Elona.Throw.nearestEnemy(g, p, 20) : null;
      }
      if (!target) {
        g.log('没有可以瞄准的目标。');
        return { ok: false, reason: 'no-target' };
      }
    }

    // 315359：precheck（`*label_2959`）—— var_2367 == 1 的魔杖分支（315581-315610）
    const pre = S.precheck ? S.precheck(g, p, eid, target, null, { wand: true }) : { ok: true, target };
    if (!pre.ok) {
      g.log(`杖的力量没有发挥出来（${pre.reason}）。`);
      return { ok: false, reason: pre.reason };
    }
    target = pre.target || target;

    // 315424-315431：挥动消息
    g.log(`你挥动了 ${nm}。`);

    // 315432-315457：成功判定
    if (!calcSuccess(g, p, it, eid)) {
      g.log(`你没能很好地使用 ${nm} 的力量。`);
      it.f[FIELD_CHARGES] = Math.max(0, chargesOf(it) - 1);      // 315485
      if (g.endTurn) g.endTurn();
      return { ok: false, reason: 'fail', effectId: eid, charges: chargesOf(it) };
    }

    let power = calcPower(g, p, it, eid);                        // 315382-315388
    // 315383：var_2422 = var_578（增幅**前**）—— 骰个数用它
    if (g) g.var2422 = calcRaw(p, it);
    // 315354-315357：var_2362 = 物品 f[17]（祝福/诅咒档，buff 系效果会用到）
    if (g) g.var2362 = (it.f[17] | 0);

    // 315389-315421：杖的一次复制
    //   315389-315404  NPC：id ∈ {901,887,570,565,175,123,122,120,1026,1027,1032}、
    //                   SP>0、魔道具>0 时 sqrt(魔道具)+80 >= rnd(100) → 充能 +1、威力 ×7/10+1、练技能 178
    //   315406-315421  玩家：var_65(250+310) == 100 且 SP>0 → 必定复制（练 178，dmgsp 3）
    const clone = tryClone(g, p, it, eid, power);
    if (clone.cloned) {
      power = clone.power;
      g.log(`你手里的 ${nm} 一时复制了一份。`);
    }

    const r = S.dispatchEffect(g, p, eid, target, power, f1) || { ok: true };

    // 315476-315506：消耗充能
    it.f[FIELD_CHARGES] = Math.max(0, chargesOf(it) - 1);
    // 315460-315463：使用者是玩家时，用一次即鉴定（var_2101 == 1）
    if (o.identify !== false) it.identified = true;

    // 342620-342622：带 buff 38 时士气 +5
    if (Elona.Battle && Elona.Battle.modgauge) {
      try { if (Elona.Battle.findbuff(p, 38) !== -1) Elona.Battle.modgauge(p, 5); } catch (e) { /* 忽略 */ }
    }

    if (g.endTurn) g.endTurn();
    return Object.assign({ ok: true, effectId: eid, power, charges: chargesOf(it) }, r);
  }

  /** 表里所有杖的清单（控制台 / 测试用） */
  function list() {
    if (!table) return [];
    return Object.keys(table.wands).map((k) => table.wands[k]);
  }

  Elona.Wand = {
    CAT_WAND,
    load, ready, entry, isWand,
    effectOf, basePower, chargesOf, nameOf,
    calcPower, calcSuccess, use, list,
    get table() { return table; },
  };
})(window);
