'use strict';
/**
 * 投掷命中角色的效果分派（core/throwhit.js）—— 0-GR
 *
 * 【源码依据 hsp/start.hsp】`*label_2975` 的投掷尾段 341421-341860
 *
 *   341421-341604  按物品 id 的专例（在 57000/60000/64000/80000 类别判定**之前**）：
 *     341421-341469  906  栗（`var_99(26)==0` 才走专例，否则落到 57000 食物路径）
 *     341470-341485  1098 ルルウィの写真集（只有命中提示 + rowact_check）
 *     341486-341520  1313 ブランクカード（在目标脚下生成 504 并记录其物种/等级）
 *     341521-341565  984  デュエルグローブ（满足条件时开决斗、强制敌对）
 *     341566-341604  1079 大豆 / 1080 とうふ
 *   341605-341844  类别 57000/60000/64000/80000 命中角色：
 *     341608-341619  かばう（`var_58(168)`，按 HP 骰决定是否换成搭档）
 *     341620-341627  非食物才有「命中」提示
 *     341629-341632  战术 152 / 投掷 111 技能经验（排除 23/27/964/960/992/985 与玩家）
 *     341633        rowact_check（打断目标的持续行动）
 *     341634-341639  1064 不播音效；目标 >= 16 时 hostileaction
 *     341640-341676  57000 食物 → 交 core/foodleft.js（瞬间进食 / 噎住 / 通用伤害）
 *     341674-341675  其余物品的通用伤害（排除 12 个专例 id）
 *     341677-341837  12 个专例 id：987/1008、1064、1059、1061、1133、1309、
 *                    1307、1312、1306、1305、1304、988、989
 *   341846-341860  落到地面：碎裂提示 + 578（貯金箱）散落 f[25] 枚金币
 *
 * 【差异登记】
 *   A497  `gosub *label_2960`（`var_396 = 法术id` / `var_578 = 强度`）由
 *         `Elona.Spell.cast` 承担；强度按原式的技能项（`var_82(x, 0)`）另算后不再回写，
 *         因为 cast 内部会重新按咏唱公式求 power（道具路径的 150%/50% 修正见 spell.js）。
 *   A498  1313 按源码写回**被投出的那张空白卡**（`var_99(22/23, var_579)`）；数量归 0 时槽位被清空、
 *         信息随之丢失，这是原版行为，0-GZ 起照抄不再修改。
 *   A499  987/1008 的 `var_58(60)` 激昂推进照抄（+15、满 100 置 120），动画/音效不移植。
 *   A500  `label_2334` 的脑寄生虫只做 cbit 1045 置位与文案；寄生后的每回合结算在
 *         `status.js` 的 statusTick 侧，本模块不重复。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc((a | 0) / (b | 0)));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const GROUP_A_FALLBACK = [906, 1098, 1313, 984, 1079, 1080];
  const CATS_FALLBACK = [57000, 60000, 64000, 80000];
  const EXCLUDE_FALLBACK = [1133, 988, 989, 1064, 1059, 1061,
    1304, 1305, 1306, 1307, 1309, 1312];

  let cached = null;
  function table() {
    if (!cached) {
      cached = (Elona.ThrowHitData && Elona.ThrowHitData.groupA) ? Elona.ThrowHitData : null;
      if (!cached && Elona.Data && Elona.Data.tableSync) {
        try { cached = Elona.Data.tableSync('throwhit'); } catch (e) { cached = null; }
      }
    }
    return (cached && cached.groupA) ? cached : null;
  }
  function setTable(t) { cached = t; }

  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);
  /** 物品字段（var_99(n, 物品)）—— 物品没有 get()，直接读 f[] */
  const F = (it, n) => (it && it.f ? (it.f[n] | 0) : 0);
  const SET = (c, n, v) => { if (c && typeof c.set === 'function') c.set(n, v | 0); };
  const V = (g, n) => (g && typeof g.getV65 === 'function' ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && typeof g.setV65 === 'function') g.setV65(n, v | 0); };
  function rndOf(g) {
    const o = (g && g.rng) ? g.rng : (Elona.rng || null);
    return (n) => (o && typeof o.rnd === 'function') ? o.rnd(Math.max(1, n | 0)) : 0;
  }
  function sk(c, id) { return (c && typeof c.skill === 'function') ? (c.skill(id) | 0) : 0; }
  function ref(id, f) { return Elona.ItemDB ? (Elona.ItemDB.ref(id | 0, f | 0) | 0) : 0; }
  function cbit(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, bit | 0) | 0) : 0;
  }
  function nm(c) { return (c && c.name) ? c.name : '对方'; }

  /** 双语文案（jp/en）—— 与项目其余模块一致，运行时取 en，界面层可换 jp */
  function text(g, key, args) {
    const T = table();
    const e = (T && T.keyed && T.keyed[key]) || null;
    const lang = (g && g.lang) ? g.lang : 'zh';
    let raw = e ? (lang === 'jp' ? e.jp : e.en) : key;
    return String(raw)
      .replace(/\{arg1\}/g, (args && args.arg1) || '')
      .replace(/\{arg2\}/g, (args && args.arg2) || '')
      .replace(/\{item\}/g, (args && args.item) || '');
  }

  /** dmghp(target, dmg, att, elem, elemPower)（199131 起并入 Battle.applyDamage） */
  function dmg(g, t, v, att, elem, pow) {
    const n = Math.max(0, v | 0);
    if (!t || (t.get(0) | 0) !== 1) return 0;
    if (Elona.Battle && Elona.Battle.applyDamage) {
      return Elona.Battle.applyDamage(t, n, g, att, elem | 0, pow | 0) | 0;
    }
    t.hp = Math.max(0, (t.hp | 0) - n);
    return n;
  }

  /** 341608-341619：かばう —— 目标处于タッグ编成时可能换成搭档承伤 */
  function guardTarget(g, t, out, R) {
    if (!G(t, 168)) return t;
    const partner = g && g.charas ? g.charas[G(t, 167)] : null;
    const who = partner && partner.name ? partner.name : '搭档';
    out.messages.push(text(g, 'guard', { arg1: nm(t), arg2: who }));
    if ((t.index | 0) !== 0 && partner && (partner.get(0) | 0) === 1) {
      if (R(G(t, 50) + 1) < R(G(partner, 50) + 1)) return partner;
    }
    return t;
  }

  /** 341629-341632：战术 152 / 投掷 111 技能经验 */
  function gainThrowExp(g, thrower, t) {
    if ((t.index | 0) === 0) return;
    if ([23, 27, 964, 960, 992, 985].some((b) => cbit(t, b) === 1)) return;
    const ev = sk(t, 173);
    if (!(Elona.Stats && Elona.Stats.skillExp)) return;
    Elona.Stats.skillExp(thrower, 152, thrower,
      limit(ev * 3 - sk(thrower, 152) + 1, 5, 80), 1, 0, g);
    Elona.Stats.skillExp(thrower, 111, thrower,
      limit(ev * 3 - sk(thrower, 111) + 1, 5, 80), 1, 0, g);
  }

  /** 341633：rowact_check —— 打断目标正在进行的持续行动 */
  function interrupt(g, t) {
    if (Elona.Actions && Elona.Actions.interruptChara) {
      try { Elona.Actions.interruptChara(g, t, 'throw'); } catch (e) { /* noop */ }
    }
  }
  function hostile(g, thrower, t) {
    if ((t.index | 0) < 16) return;
    if (Elona.Relation && Elona.Relation.hostileAction) {
      try { Elona.Relation.hostileAction(g, thrower, t); } catch (e) { /* noop */ }
    }
  }
  /** 341514 / 341551 / 341515：投掷命中把非敌对的 NPC 转成敌对 */
  function enrage(t) {
    SET(t, 79, 18 + 100 * 4);
    SET(t, 9, -3);
    SET(t, 201, 80);
    SET(t, 29, 0);
  }
  function dropAt(g, id, cnt, x, y) {
    if (!(Elona.ItemDB && Elona.ItemDB.createItem)) return null;
    const it = Elona.ItemDB.createItem(id | 0, Math.max(1, cnt | 0));
    if (!it) return null;
    it.f[5] = x | 0; it.f[6] = y | 0; it.f[21] = -1; it.eqSlot = -1;
    if (Elona.Loot && Elona.Loot.dropGround) Elona.Loot.dropGround(g, it, x | 0, y | 0);
    else if (g.groundItems) g.groundItems.push(it);
    return it;
  }

  // =========================================================================
  // 341421-341604：按物品 id 的专例
  // =========================================================================
  function branch906(g, thrower, t, it, out, R) {
    const skill = sk(thrower, 111);
    dmg(g, t, R(skill * 2) + 1, thrower, 65, 1000);
    dmg(g, t, idiv(skill + 2, 2), thrower, 61, 500);
    if (G(t, 27) === 627) {
      out.messages.push(text(g, 'chestnut'));
      dmg(g, t, idiv(G(t, 51), 10), thrower, 65, 1000);
    }
    // 341464-341466：var_65(250+262) 只累加到 100
    if (V(g, 512) < 100) S(g, 512, V(g, 512) + 1);
    out.effects.push('chestnut');
    return out;
  }

  function branch1313(g, thrower, t, it, out) {
    // 341507-341508：在目标脚下生成 504（本身不带信息）
    dropAt(g, 504, 1, G(t, 1), G(t, 2));
    // 341505-341510：先 `var_99(0, var_579)--` 消耗一张，再把物种/等级写回
    //   **被投出的那张空白卡**（`var_99(22/23, var_579)`）。
    //   原版就是写回原卡：数量归 0 时该槽被清空，记下的信息随之丢失（照抄，不做修正）。
    if ((it.f[0] | 0) > 0) it.f[0]--;
    it.f[22] = idiv(G(t, 7), 1000) + G(t, 435) * 1000;
    it.f[23] = G(t, 27);
    if (G(t, 9) === 0 && (t.index | 0) >= 16) enrage(t);
    out.effects.push('card');
    return out;
  }

  function branch984(g, thrower, t, it, out) {
    // 341534-341536：目标处于异常状态时一律不成立
    if (G(t, 251) || G(t, 252) || G(t, 253) || G(t, 255) || G(t, 256)) return out;
    const duel = V(g, 556);                                  // var_65(250+306)
    if (duel <= 0 && duel !== (t.index | 0) && G(t, 9) === 0 && (t.index | 0) >= 16) {
      S(g, 556, t.index | 0);
      S(g, 309, V(g, 309) + 1);                              // var_65(250+59)
      out.messages.push(text(g, 'duel', { arg1: nm(t) }));
      if ((it.f[0] | 0) > 0) it.f[0]--;
      enrage(t);
      out.effects.push('duel');
    } else if ((t.index | 0) !== 0) {
      out.messages.push(text(g, 'ridicule', { arg1: nm(t) }));
    }
    return out;
  }

  // =========================================================================
  // 341677-341837：类别 57000/60000/64000/80000 的专例
  // =========================================================================
  function special(g, thrower, t, it, id, out, R) {
    const s111 = sk(thrower, 111), s174 = sk(thrower, 174), lv = G(thrower, 38);
    const lvTerm = (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
      * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1;
    switch (id) {
      case 987:
      case 1008: {
        if ((it.f[26] | 0) !== 0) it.f[26] = 0;
        if (G(t, 60) < 100) {
          SET(t, 60, G(t, 60) + 15);
          if (G(t, 60) >= 100) SET(t, 60, 120);
        }
        const base = (idiv(s111, 5) + 5) * (idiv(s174 + 1, 5) + 5)
          + R(s174 * 2 + 5);
        dmg(g, t, base + idiv(lvTerm, 2), thrower, 64, 1000);
        if (id === 1008) {
          dmg(g, t, base + idiv(lvTerm, 3), thrower, 56, 1000);
          dmg(g, t, base + idiv(lvTerm, 3), thrower, 60, 1000);
        }
        out.effects.push(id);
        return true;
      }
      case 1064: {
        // 341701-341714：拆掉目标第一个有效增益（id 13 / 空槽除外）
        for (let i = 0; i < 16; i++) {
          const bid = G(t, 280 + i * 3);
          if (!bid || bid === 13) continue;
          if (Elona.Status && Elona.Status.delbuff) Elona.Status.delbuff(t, i);
          break;
        }
        dmg(g, t, limit(idiv(s111, 5), 1, 200) * limit(idiv(s174 + 1, 3), 1, 500)
          + R(s174 + s111 + 1), thrower, 60, 1000);
        out.effects.push('ohuda');
        return true;
      }
      case 1059: {
        const s15 = sk(thrower, 15);
        if (G(t, 9) === -3 || (t.index | 0) === 0) {
          dmg(g, t, limit(idiv(s174, 5), 1, 400) * limit(idiv(s15, 6), 1, 200)
            + R(s15 + 1) + s174, thrower, 59, 3000);
          out.effects.push('present-hurt');
        } else {
          const heal = Math.floor(Math.sqrt(sk(t, 15))) * limit(idiv(s15, 4), 1, 500)
            + s15 + R(sk(t, 15) + 1);
          t.hp = Math.min(G(t, 51), (t.hp | 0) + heal);
          out.effects.push('present-heal');
        }
        return true;
      }
      case 1061: {
        if (F(it, 26) !== 5) {
          dmg(g, t, limit(idiv(s111, 5), 1, 200) * limit(idiv(F(it, 7), 1000), 1, 500)
            + R(idiv(F(it, 7), 1000) + s111 + 1), thrower, 0, 0);
        } else {
          const p = 10 + F(it, 20);
          dmg(g, t, idiv(s111 * p, 5), thrower, 61, idiv(400 * p, 10));
        }
        out.effects.push('flower');
        return true;
      }
      default:
        return false;
    }
  }

  // =========================================================================
  // 主入口
  // =========================================================================
  /**
   * 投掷物命中角色时的效果分派。
   * @param {object} g
   * @param {object} thrower
   * @param {object} target   落点格上的角色（未做かばう替换）
   * @param {object} it       落点上的物品副本（投掷后生成的那一个）
   * @param {object} [opts]   { skill }
   * @returns {object} { handled, itemId, cat, messages, effects, food, consumed }
   */
  function hit(g, thrower, target, it, opts) {
    if (!it || !target) return { handled: false };
    const T = table();
    const id = it.id | 0;
    const cat = ref(id, 5);
    const out = { handled: true, itemId: id, cat, messages: [], effects: [], food: null };

    const inA = (T ? T.groupA.map((x) => x.id) : GROUP_A_FALLBACK).indexOf(id) >= 0;
    const inCat = (T ? T.cats : CATS_FALLBACK).indexOf(cat) >= 0;
    const R = rndOf(g);

    // ---- 341421-341604：先按 id 走专例（906 还要 f[26]==0）----
    if (inA && !(id === 906 && (it.f[26] | 0) !== 0)) {
      let t = target;
      if (id === 906) t = guardTarget(g, t, out, R);
      // 341423 / 341472：cell_refresh（渲染层职责，略）
      if (id === 906) {
        out.messages.push(text(g, 'hit', { arg1: nm(t) }));
        gainThrowExp(g, thrower, t);
        interrupt(g, t);
        hostile(g, thrower, t);
        return branch906(g, thrower, t, it, out, R);
      }
      if (id === 1079 || id === 1080) {
        out.messages.push(text(g, 'hit', { arg1: nm(t) }));
        gainThrowExp(g, thrower, t);
        interrupt(g, t);
        hostile(g, thrower, t);
        const skill = sk(thrower, 111);
        if (id === 1079) {
          dmg(g, t, skill, thrower, 53, 3000 * F(it, 20));
          const sp = G(t, 27);
          if (sp >= 717 && sp <= 719) {
            if (G(t, 50) > 10) dmg(g, t, G(t, 50) - R(10), thrower, 0, 0);
            else dmg(g, t, R(20000), thrower, 0, 0);
          }
        } else {
          dmg(g, t, skill * F(it, 20) + R(skill + 10) + 1, thrower, 67, 1000);
        }
        out.effects.push(id === 1079 ? 'soybean' : 'tofu');
        return out;
      }
      out.messages.push(text(g, 'fell', { arg1: nm(t) }));
      interrupt(g, t);
      if (id === 1313) return branch1313(g, thrower, t, it, out);
      if (id === 984) return branch984(g, thrower, t, it, out);
      // 1098：只有提示与 rowact_check
      return out;
    }

    if (!inCat) return { handled: false };

    // ---- 341605-341639：类别物品命中角色的公共前段 ----
    let t = guardTarget(g, target, out, R);
    if (cat !== 57000) out.messages.push(text(g, 'hit', { arg1: nm(t) }));
    gainThrowExp(g, thrower, t);
    interrupt(g, t);
    hostile(g, thrower, t);

    // ---- 341640-341672：57000 食物 → 瞬间进食 / 噎住 ----
    //   `core/foodleft.js` 自己会判 `var_58(22)<=10000 & 251==0 & 256<60`：
    //   可以进食时走 `eatItemNow`（含噎住），否则落到 341674-341676 的无属性伤害。
    const FL = Elona.FoodLeft;
    if (cat === 57000 && FL) {
      const res = (FL.specialThrowFood && FL.specialThrowFood(g, thrower, t, it))
        || (FL.throwFoodHit && FL.throwFoodHit(g, thrower, t, it, sk(thrower, 111)));
      if (res) {
        out.food = res;
        if (res.eaten) {
          out.messages.push(text(g, 'bite', { arg1: nm(t), item: itemName(it) }));
          if (res.choked) out.messages.push(text(g, 'choke', { arg1: nm(t) }));
        }
        if (res.special || res.eaten) { out.consumed = true; return out; }
        // 没吃掉：foodleft 已经结算过 341674-341676 的无属性伤害
        return out;
      }
    }

    // ---- 341674-341675：通用伤害（12 个专例 id 除外）----
    const excl = T ? T.excludeGeneric : EXCLUDE_FALLBACK;
    if (excl.indexOf(id) < 0) {
      const w = idiv(F(it, 7), 1000);
      dmg(g, t, limit(idiv(sk(thrower, 111), 5), 1, 200) * limit(w, 1, 500)
        + R(w + sk(thrower, 111) + 1), thrower, 0, 0);
    }

    // ---- 341677-341837：12 个专例 ----
    if (special(g, thrower, t, it, id, out, R)) return out;

    // ---- 341740-341837：法术型专例（`var_396` + `gosub *label_2960`）----
    const spells = { 1133: 432, 1309: 479, 1307: 431, 1312: 473,
      1306: 469, 1305: 470, 1304: 478, 988: 460, 989: 460 };
    if (spells[id]) {
      const times = id === 989 ? 3 : 1;
      for (let n = 0; n < times; n++) {
        if (Elona.Spell && Elona.Spell.cast) {
          try { Elona.Spell.cast(g, thrower, spells[id], t); } catch (e) { /* noop */ }
        }
      }
      if (id === 1309 && (t.get(0) | 0) === 1 && Elona.Spell && Elona.Spell.dmgconOf) {
        const p2 = idiv(power(g, thrower, 184), 2) + 1;
        Elona.Spell.dmgconOf(g, t, 7, limit(R(p2), 1, 5000));
      }
      if ((id === 1307 || id === 1312) && (t.get(0) | 0) === 1 && Elona.Status && Elona.Status.addbuff) {
        Elona.Status.addbuff(g, t, id === 1307 ? 9 : 11,
          idiv(power(g, thrower, id === 1307 ? 179 : 179), 3), 30);
      }
      if (id === 1305 && (t.get(0) | 0) === 1) {
        const s164 = sk(thrower, 164), s188 = sk(thrower, 188), lv = G(thrower, 38);
        const lvTerm = (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
          * Math.sqrt(limit(lv, 1, 2000) * 3) + 30 + 1;
        dmg(g, t, (idiv(sk(thrower, 111), 5) + 5) * (idiv(s164 + 1, 5) + 5)
          + R(s188 * 2 + 5) + idiv(lvTerm, 2), thrower, 64, 1000);
      }
      if (id === 1304 && (t.get(0) | 0) === 1) {
        out.messages.push(text(g, 'parasite', { arg1: nm(t) }));
        if (cbit(t, 1045) === 0 && Elona.Status && Elona.Status.cbitmod) {
          Elona.Status.cbitmod(t, 1045, 1);
        }
      }
      out.effects.push(id);
    }
    return out;
  }

  /** `var_2422 = (var_82(a,0) + var_82(b,0) + var_58(38,0)) * 6 + 5` 的近似（取首个技能项） */
  function power(g, who, id) {
    const c = (g && g.player) || who;
    return (sk(c, id) + sk(c, 151) + G(c, 38)) * 6 + 5;
  }
  function itemName(it) {
    if (!Elona.ItemDB) return '那个';
    try { return Elona.ItemDB.name(it.id, 'zh') || '那个'; } catch (e) { return '那个'; }
  }

  /**
   * 341846-341860：落到地面的收尾。
   *   · 非 1181/1228 且看不到时「それは地面に落ちて砕けた。」
   *   · 578（貯金箱）在无主状态（`var_99(21) != 5`）被打碎 → 散落 f[25] 枚金币
   */
  function ground(g, it, x, y) {
    if (!it) return { shatter: false, gold: 0, messages: [] };
    const id = it.id | 0;
    const out = { shatter: false, gold: 0, messages: [] };
    if (id !== 1181 && id !== 1228) {
      out.shatter = true;
      out.messages.push(text(g, 'shatter'));
    }
    if (id === 578 && F(it, 21) !== 5) {
      const n = F(it, 25);
      if (n > 0) {
        dropAt(g, 54, n, x, y);
        out.gold = n;
      }
    }
    return out;
  }

  Elona.ThrowHit = { hit, ground, table, setTable, text, guardTarget, GROUP_A_FALLBACK };
})(window);
