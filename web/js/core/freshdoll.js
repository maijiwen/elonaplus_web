'use strict';
/**
 * 肉人偶（core/fleshdoll.js）—— 0-EZ，以 hsp/start.hsp 为准
 *
 * 【源码锚点】
 *   3165      var_81(806) = 「神経支配の糸 / Thread of Innervation」
 *   338377-338443 能力 806：造成伤害（var_65(193)=4771）后，若目标濒死
 *                （HP <= maxHP/9）且通过排除条件，则按一串判定把
 *                var_65(250+372) 置 100（生成肉人偶）或 -1（只斩杀），
 *                再 `dmghp target, maxHP, caster, 658` 处决。
 *   222905-222925 chara_vanquish：flag==100 时在脚下生成尸体 204，
 *                f[2]=1119、f[26]=10（Rank10 料理）、f[27]=now+240、
 *                f[20]+=梳理计数、f[22]/f[23] 记录目标，且
 *                `var_65(250+372)<=0` 才掉普通尸体/卵/残骸/标本
 *                （222666/222849/222871/222886）→ 肉人偶抑制这些掉落。
 *   12732     foodname 品质 10 = 「<生物名>の肉人形」，中文表作「肉人偶」。
 *   280419    「肉詰め蘇生」配方 → 产物 10020（core/craftprod.js 已实现，282787-282803）。
 *
 * 【项目差异】源码在 chara_vanquish 里生成；本项目能力执行链里死亡结算是延迟的，
 *   故在能力 806 结算处直接生成，并把目标置为 ACTIVE=0。
 *   0-FM 起 Loot.onDeath 已会生成尸体/卵/奶/残骸/标本，故本模块通过
 *   `consume(g, chara)` 把「已生成人偶」标记递交给 Loot：Loot 不再重复生成 204，
 *   并按源码 222666/222849/222871/222886/222925 的 `var_65(250+372)<=0` 抑制普通掉落。
 *   var_1174 / var_38（源码 338434 的仔畜/未确认标记）用 cbit(960) 与健康字段近似。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const FLAG = 622;              // var_65(250 + 372)
  const DUEL = 556;              // var_65(250 + 306)：-2 = 决斗中
  const CORPSE_ID = 204;
  const GRAPHIC_DLL = 1119;
  const RANK_DOLL = 10;
  const SPECIAL_RACES = [878, 877, 876, 875, 534];   // 服务员艾露 / 亡灵兵器四形态
  const SKILL_BIO = 151;         // 生化学

  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));

  function clockHours(g) {
    if (Elona.Status && Elona.Status.clockHours) return Elona.Status.clockHours(g);
    const V = (n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
    return V(13) + V(12) * 24 + V(11) * 24 * 30 + V(10) * 24 * 30 * 12;
  }

  function cbit(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, bit) | 0) : 0;
  }

  function mapId(g) { return (g && g.getV65 ? (g.getV65(20) | 0) : 0); }

  function mapType(g) {
    return (Elona.Ranch && Elona.Ranch.mapType) ? (Elona.Ranch.mapType(g) | 0) : 0;
  }

  /**
   * 338396-338434：先 exclusion，再按源码逐条判定是否生成肉人偶。
   * @returns {{kill:boolean, doll:boolean, reasons:string[]}}
   */
  function roll(g, caster, t) {
    const out = { kill: false, doll: false, reasons: [] };
    if (!t || (t.get(0) | 0) !== 1) return out;
    if ((t.hp | 0) > idiv(t.hpMax | 0, 9)) return out;            // 338396 濒死
    const idx = t.index | 0;
    if (idx < 16 || (t.get(9) | 0) === 10 || (t.get(58) | 0) !== 0) return out;  // 338399-338402
    if (cbit(t, 985)) return out;                                  // 338404
    const mid = mapId(g);
    if (mid === 33) {
      const sp = t.get(27) | 0;
      if (sp === 185 || sp === 204) return out;                    // 338406-338412
    }
    if (cbit(t, 969) || cbit(t, 23) || (cbit(t, 27) && cbit(t, 964))
      || cbit(t, 964) || cbit(t, 1015) || mid === 35) return out; // 338414-338425
    out.kill = true;

    const R = (n) => (g && g.rng ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const bio = caster && caster.skill ? (caster.skill(SKILL_BIO) | 0) : 0;
    const quality = t.get(25) | 0;
    const race = t.get(27) | 0;
    const god = (g && g.player) ? (g.player.get(61) | 0) : 0;

    // 338430-338432
    if (Math.trunc(Math.sqrt(bio + 100)) > R(150)) { out.doll = true; out.reasons.push('biology'); }
    if (R(60) === 0) { out.doll = true; out.reasons.push('1/60'); }
    if (g && g.getV65 && (g.getV65(DUEL) | 0) === -2) { out.doll = true; out.reasons.push('duel'); }
    if (quality === 6) { out.doll = true; out.reasons.push('quality6'); }
    if (SPECIAL_RACES.indexOf(race) >= 0) { out.doll = true; out.reasons.push('special-npc'); }
    if (quality === 4 && R(2) === 0) { out.doll = true; out.reasons.push('elite4'); }
    if (quality === 5 && R(3) === 0) { out.doll = true; out.reasons.push('elite5'); }
    if (god === 8 && R(35) === 0) { out.doll = true; out.reasons.push('yacatect'); }
    // 338434：精英品质、健康仔畜（牧场 mapType 31 + cbit 960 + 未生病）
    if (quality >= 4) { out.doll = true; out.reasons.push('elite'); }
    if (mapType(g) === 31 && cbit(t, 960) === 1 && (t.get(261) | 0) === 0) {
      out.doll = true; out.reasons.push('livestock');
    }
    return out;
  }

  /** 222905-222925：生成 Rank10 尸体料理（肉人偶） */
  function spawn(g, t) {
    if (!g || !t || !Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    const it = Elona.ItemDB.createItem(CORPSE_ID, 1);
    it.f[2] = GRAPHIC_DLL;
    it.f[26] = RANK_DOLL;
    it.f[27] = clockHours(g) + 240;
    it.f[20] = (it.f[20] | 0) + (t.get(177) | 0);
    it.f[22] = idiv(t.get(7) | 0, 1000) + (t.get(435) | 0) * 1000;
    it.f[23] = t.get(27) | 0;
    it.f[5] = t.x | 0; it.f[6] = t.y | 0; it.f[21] = -1;
    if (!g.groundItems) g.groundItems = [];
    g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(it.f[5], it.f[6]);
    return it;
  }

  /**
   * 能力 806 在伤害结算之后调用：判定 → 斩杀 → （可选）生成肉人偶。
   * @returns {object|null} null = 不满足濒死/排除条件
   */
  /** 扣血之后的部分：标记 → 生成/掉落 → 死亡结算（0-GH 起死亡结算延迟到这里） */
  function complete(g, caster, t, r) {
    // 338429：skillexp 151, caster, 50
    if (caster && Elona.Stats && Elona.Stats.skillExp) {
      Elona.Stats.skillExp(caster, SKILL_BIO, caster, 50, 1, 0, g);
    }
    if (g && g.setV65) g.setV65(FLAG, r.doll ? 100 : -1);   // 338430-338434
    t.hp = 0;
    t.__fleshDoll = r.doll ? 100 : 0;                       // Loot.onDeath 取用
    let item = null;
    const canSettle = !!(Elona.Battle && Elona.Battle.checkDeath);
    if (r.doll) item = spawn(g, t);                          // 204 肉人偶（Rank10）
    if (canSettle) {
      Elona.Battle.checkDeath(g, t, caster);                 // 普通掉落会被 pendingDoll 抑制
    } else {
      t.set(0, 0);                                          // chara_vanquish
    }
    if (g && g.setV65) g.setV65(FLAG, 0);                  // 338442
    if (g && g.log) {
      g.log(r.doll ? `${t.name || '目标'}被丝线变成了肉人偶。`
        : `${t.name || '目标'}的身体从内部崩坏了。`);
    }
    if (g && g.syncCharaCells) g.syncCharaCells();
    return { kill: true, doll: r.doll, reasons: r.reasons, item: item || null };
  }

  /**
   * 能力 806 的「伤害已经结算、但死亡结算被延后」的收尾（0-GH）。
   * 目标此时 HP <= 0 且仍 ACTIVE，可以正常读 `var_58(50)` 做濒死判定。
   */
  function finish(g, caster, t) {
    const r = roll(g, caster, t);
    if (!r.kill) {
      if (t && (t.hp | 0) <= 0 && Elona.Battle && Elona.Battle.checkDeath) {
        Elona.Battle.checkDeath(g, t, caster);
      }
      return null;
    }
    return complete(g, caster, t, r);
  }

  /** 直接调用的入口（旧路径 / 测试）：先判定，再扣血，再收尾 */
  function execute(g, caster, t) {
    const r = roll(g, caster, t);
    if (!r.kill) return null;
    t.__fleshDoll = r.doll ? 100 : 0;
    // 338436 dmghp target, maxHP, caster, 658
    if (Elona.Battle && Elona.Battle.applyDamage) {
      Elona.Battle.applyDamage(t, (t.hpMax | 0) * 2, g, caster, 658, 0, { deferDeath: true });
    }
    return complete(g, caster, t, r);
  }

  /** 当前全局标志（338433-338442，只在能力结算瞬间有效） */
  function pending(g) { return (g && g.getV65 ? (g.getV65(FLAG) | 0) : 0); }

  /**
   * 交给 Loot.onDeath 消费的一次性标记：100 = 已生成肉人偶，0 = 无。
   * 消费后清除，避免影响该角色后续（复活 / 复用对象）的死亡结算。
   */
  function consume(g, chara) {
    if (!chara) return 0;
    const v = chara.__fleshDoll | 0;
    delete chara.__fleshDoll;
    return v;
  }

  Elona.FleshDoll = {
    FLAG, DUEL, CORPSE_ID, GRAPHIC_DLL, RANK_DOLL, SPECIAL_RACES,
    roll, spawn, execute, finish, complete, pending, consume,
  };
})(window);
