'use strict';
/**
 * 召唤系特殊能力（core/summon.js）—— 对应效果分派 `*label_2960` 的
 * `var_1302 == 7` 分支（317396-317712）
 *
 * 【覆盖的 id】639 猫召唤 / 640 小鬼召唤 / 641 棋子召唤 / 642 炎召唤 / 643 妹召唤 /
 *   663 暴风流法 / 675 眷属召唤（外加 424 野生召唤、425、467 精灵召唤共用同一段）
 *
 * 【流程】（317396-317712）
 *   1. 663：施法者不是主角且斗志 `var_58(182) < 100` → 改放 732（弱化版）；
 *      施法者属我方（槽位 < 16 或 `var_58(58)==100`）→ 改放 716。
 *   2. 其它施法者若属我方 / 被 cbit 960 标记 / `58==100` / 关系 10 → 改放 732。
 *   3. 主角施放且角色数 `var_65(3) + 100 >= 188`（245-57）→ 「何もおきない…」。
 *   4. `var_400`（数量基数）默认 3；643 → 10、663 → 5、675 → 5。
 *      等级 `var_578 = (威力/25 + 威力/100*(威力+1)/100 + 施法者等级) / 2`，下限 1；
 *      641 → 15+rnd(8)、639 → 2+rnd(18)、642 → 15+rnd(15)、640 → 5+rnd(12)；
 *      424 时不超过 `等级+5`。
 *   5. 675 的两个特例：施法者物种 306/356 → 7 只 792（上限 15 只）；
 *      物种 745/755 → 「死者觉醒」，10 只 21 号并带 10 回合寿命。
 *   6. 主循环 `repeat 1 + rnd(var_400)`：`flt calcobjlv(var_578), 2` 定等级、
 *      `fltn` 定标签（cat / yeek / pawn / fire / wild / spirit）、指定物种后 characreate。
 *   7. 收尾：召唤物一律 `cbit 964`；663 的召唤物关系 -3 / 组 -3；
 *      施法者物种 1018 的召唤物复制施法者关系并带 10 回合寿命；
 *      与施法者同种（且施法者不是 1033/1118）或物种 332 的召唤物立刻遣返（317635-317646）。
 *
 * 【实现依赖】`Elona.CharaFactory.pick/create`（*label_3105 加权选怪 + *label_2238 造怪）。
 *   `flt calcobjlv(lv), 2` 在本项目对应 `create(g, 0, calcObjLv(lv), x, y, { tag })`。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const IDS = [424, 425, 467, 639, 640, 641, 642, 643, 663, 675];

  /** `calcobjlv`（26093-26116）：0 → 当前地图等级；地图 30 → 1；三次暴走判定 */
  function calcObjLv(g, lv) {
    const v65 = (n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
    let base = (lv | 0) <= 0 ? v65(22) : (lv | 0);
    if (v65(20) === 30) base = 1;
    for (let cnt = 1; cnt <= 3; cnt++) {
      const r = R(g, 30 + cnt * 5);
      if (r === 0) { base += R(g, 10 * cnt); continue; }
      break;
    }
    if ((lv | 0) <= 3) {
      if (R(g, 4) !== 0) base = R(g, 3) + 1;
    }
    return base;
  }

  function R(g, n) {
    if (g && g.rng && typeof g.rng.rnd === 'function') return g.rng.rnd(Math.max(1, n | 0));
    if (Elona.rng && typeof Elona.rng.rnd === 'function') return Elona.rng.rnd(Math.max(1, n | 0));
    return 0;
  }

  function syncCheck(g, c) {
    if (!c) return false;
    if ((c.index | 0) === 0) return true;
    if (g && g.getV65 && (c.index | 0) === (g.getV65(183) | 0)) return true;
    if (Elona.Party && Elona.Party.isAlly) return !!Elona.Party.isAlly(c);
    return false;
  }

  function cbitOf(c, bit) {
    if (!c || !Elona.Status || !Elona.Status.cbit) return 0;
    return Elona.Status.cbit(c, bit) | 0;
  }

  /** 场上已有多少只该物种的召唤物（317480-317495 / 317514-317530） */
  function countSummoned(g, speciesId) {
    let n = 0;
    const list = (g && g.charas) || [];
    for (const c of list) {
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(27) | 0) !== (speciesId | 0)) continue;
      if (cbitOf(c, 964) !== 1) continue;
      n++;
    }
    return n;
  }

  function create(g, speciesId, level, x, y, opt) {
    if (!Elona.CharaFactory || !Elona.CharaFactory.create) return null;
    try {
      return Elona.CharaFactory.create(g, speciesId, level, x, y, opt || {});
    } catch (e) {
      return null;
    }
  }

  /** 主流程。返回 { ok, type:7, implemented, spawned, ... } */
  function run(g, caster, id, tg, power) {
    const R2 = (n) => R(g, n);
    const isPlayer = (caster.index | 0) === 0;
    const target = tg || caster;
    const x = target.x, y = target.y;
    const out = { ok: true, type: 7, implemented: true, spawned: [], replaced: 0 };

    // ---- 1. 663：斗志不足 → 732；我方 → 716（317398-317411）
    if (id === 663 && !isPlayer) {
      if ((caster.get(182) | 0) < 100) {
        out.replaced = 732;
        out.result = Elona.Spell.cast(g, caster, 732, target);
        return out;
      }
      if ((caster.index | 0) < 16 || (caster.get(58) | 0) === 100) {
        out.replaced = 716;
        out.result = Elona.Spell.cast(g, caster, 716, target);
        return out;
      }
    }
    // ---- 2. 我方 / cbit 960 / 58==100 / 关系 10 → 732（317413-317420）
    if (!isPlayer) {
      if ((caster.index | 0) < 16 || cbitOf(caster, 960) === 1
        || (caster.get(58) | 0) === 100 || (caster.get(9) | 0) === 10) {
        out.replaced = 732;
        out.result = Elona.Spell.cast(g, caster, 732, target);
        return out;
      }
    }
    // ---- 3. 主角施放且槽位将满（317421-317431）
    if (isPlayer && (g.getV65 ? (g.getV65(3) | 0) : 0) + 100 >= 245 - 57) {
      if (g.log) g.log('什么也没有发生……');
      return { ok: true, type: 7, implemented: true, nothing: true, spawned: [] };
    }

    // ---- 4. 数量与等级（317433-317466）
    let count = 3;
    let lv = idiv(idiv(power, 25) + idiv(idiv(power, 100) * (power + 1), 100) + (caster.level | 0), 2);
    if (lv < 1) lv = 1;
    if (id === 641) lv = 15 + R2(8);
    else if (id === 639) lv = 2 + R2(18);
    else if (id === 642) lv = 15 + R2(15);
    else if (id === 640) lv = 5 + R2(12);
    else if (id === 643) count = 10;
    else if (id === 663) count = 5;
    else if (id === 675) count = 5;
    if (id === 424 && lv > (caster.level | 0) + 5) lv = (caster.level | 0) + R2(5);
    out.level = lv;
    out.countBase = count;

    const species = caster.get(27) | 0;

    // ---- 5a. 675：物种 306/356 → 7 只 792（317467-317508）
    if (id === 675 && (species === 306 || species === 356)) {
      const rel = (caster.get(9) | 0) >= -1 ? -1 : -3;
      if (countSummoned(g, 792) > 15) return out;              // goto *label_2964
      if (syncCheck(g, caster) && g.log) g.log('魔法でモンスターが召喚された。');
      for (let k = 0; k < 7; k++) {
        const m = create(g, 792, calcObjLv(g, lv), x, y, {});
        if (!m) continue;
        if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m, 964, true);
        m.set(9, rel);
        out.spawned.push(m);
      }
      return out;
    }
    // ---- 5b. 675：物种 745/755 → 死者觉醒，10 只 21（317509-317542）
    if (id === 675 && (species === 745 || species === 755)) {
      if ((caster.index | 0) < 16 || cbitOf(caster, 960) === 1 || (caster.get(58) | 0) === 100) return out;
      if (countSummoned(g, 21) > 15) return out;
      if (g.log) g.log('*死者觉醒*');
      const pw = idiv((caster.get(38) | 0) * 2, 3) + 1;
      for (let k = 0; k < 10; k++) {
        const m = create(g, 21, calcObjLv(g, lv), x, y, { var1023: pw });
        if (!m) continue;
        if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m, 964, true);
        m.set(197, 10);
        out.spawned.push(m);
      }
      return out;
    }

    // ---- 6. 主循环（317543-317646）
    const n = 1 + R2(Math.max(1, count));
    out.count = n;
    for (let k = 0; k < n; k++) {
      // fltn 标签（317552-317562）
      let tag = '';
      if (id === 425) tag = 'wild';
      else if (id === 642) tag = 'fire';
      else if (id === 641) tag = 'pawn';
      else if (id === 639) tag = 'cat';
      else if (id === 640) tag = 'yeek';
      // 指定物种（317563-317592）
      let sp = 0;
      if (id === 643) sp = 176;
      else if (id === 663) sp = 362;
      else if (id === 675) {
        sp = 503;
        if (species === 835) sp = 832 + R2(3);
        else if (species === 994) sp = 961;
        else if (species === 1005) sp = 1003;
        else if (species === 1018) sp = 909;
        else if (species === 1030) sp = 1118;
        else if (species === 1033) sp = 1033;
        else if (species === 435) sp = 1089;
        else if (species === 1118) sp = 1118;
        else if (species === 1143) sp = 1142;
      }
      const level = calcObjLv(g, lv);
      // fltn 的标签过滤（var_636 + var_549「/cat/」）：交给 pick 按 var_550 表判定
      const tflt = tag ? { tagName: tag, t636: 1 } : {};

      // 467 精灵召唤（317593-317601）
      if (id === 467) {
        tag = 'spirit';
        const pw = limit(idiv(lv, 3) + 2, 1, (g.getV65 ? (g.getV65(189) | 0) : 0));
        const m = create(g, sp, level, x, y, Object.assign({ var1023: pw }, tflt));
        if (!m) continue;
        if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m, 964, true);
        m.set(197, 10);
        out.spawned.push(m);
        continue;
      }

      // 663：敌对（317602-317607）
      if (id === 663) {
        const m = create(g, sp, level, x, y, Object.assign({ var1023: 0 }, tflt));
        if (!m) continue;
        m.set(9, -3);
        m.set(69, -3);
        if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m, 964, true);
        out.spawned.push(m);
        continue;
      }

      // 一般分支（317608-317634）：施法者物种 1018 时强化召唤物
      let m = null;
      if (species === 1018) {
        const pw = limit(idiv(caster.get(38) | 0, 5), 1, 700);
        m = create(g, sp, level, x, y, Object.assign({ var1023: pw }, tflt));
        if (m) {
          if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m, 964, true);
          m.set(197, 10);
          m.set(9, caster.get(9) | 0);
          out.spawned.push(m);
        }
      } else {
        m = create(g, sp, level, x, y, Object.assign({}, tflt));
        if (m) {
          if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m, 964, true);
          out.spawned.push(m);
          // 物种 680 → 再叫一只 681（317627-317631）
          if ((m.get(27) | 0) === 680) {
            const m2 = create(g, 681, level, x, y, {});
            if (m2 && Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(m2, 964, true);
            if (m2) out.spawned.push(m2);
          }
        }
      }
      if (!m) continue;

      // 同种 / 332 遣返（317635-317646）
      const msp = m.get(27) | 0;
      if (id !== 643 && msp === species && species !== 1033 && species !== 1118) {
        if (Elona.Chara && Elona.Chara.vanquish) Elona.Chara.vanquish(g, m.index | 0);
        const at = out.spawned.indexOf(m);
        if (at >= 0) out.spawned.splice(at, 1);
        continue;
      }
      if (msp === 332) {
        if (Elona.Chara && Elona.Chara.vanquish) Elona.Chara.vanquish(g, m.index | 0);
        const at = out.spawned.indexOf(m);
        if (at >= 0) out.spawned.splice(at, 1);
      }
    }

    // ---- 7. 收尾（317648-317709）
    if (id === 663) {
      // var_58(182) -= 100；仍 >= 100 时置 var_1636 与 var_65(801)
      caster.set(182, (caster.get(182) | 0) - 100);
      if ((caster.get(182) | 0) >= 100) {
        g.var1636 = 100;
        if ((g.getV65 ? (g.getV65(801) | 0) : 0) === 0 && g.setV65) g.setV65(801, 2);
      }
      if (syncCheck(g, caster) && g.log) g.log('「啊哈哈！被龙卷风吞掉消失吧！」');
    } else if (syncCheck(g, caster) && g.log) {
      g.log('魔法でモンスターが召喚された。');
    }
    return out;
  }

  function has(id) { return IDS.indexOf(id | 0) >= 0; }

  Elona.Summon = { has, run, calcObjLv, IDS, countSummoned };
})(window);
