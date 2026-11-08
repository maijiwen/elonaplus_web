'use strict';
/**
 * 浸染 / 浸泡（core/dip.js）—— `#deffunc dipcursed`（348266）+ `*label_3015`（348331）
 *
 * 【源码结构】348266-348747 共 482 行，其实是两件事：
 *   A. `dipcursed(item)` 348266-348329 —— 「腐蚀」一个物品：
 *        食物（refitem f5 == 57000）且 f[24] == 35 → 腐坏（f[27] = -1、f[2] = 336）
 *        装备/道具（f5 < 50000）→ 耐久 f[20]--，附带「锈蚀到 < -10 就溶解」的开关判定
 *        其它 → 「什么也没有发生」
 *   B. `*label_3015` 348331-348747 —— 真正的浸染：把液体 `var_2261` 用在物品 `var_579` 上，
 *      按液体 id 分 14 类（鱼饵 / 装瓶 / 媚药 / 混果汁 / 牛奶 / 充能 / 水 / 圣水 / 染料 / 涂层…）
 *
 * 【谁调用】
 *   348337 附近还把「鱼饵 617」接在钓竿上（f[9] = 剩余饵数、f[28] = 饵种）。
 *   原版入口是 B 键（`var_486 = 17`），本项目对应 `Panels.openDip`。
 *
 * 【本实现的取舍】
 *   · `item_separate`（把堆叠拆出一件）在项目里不需要：所有效果都只改一件并 `f[0]--`。
 *   · `item_stack`（合并同类）由项目原有的 addToInventory 收尾，这里不重复。
 *   · `label_2174`（装备变化后重算属性）→ `Elona.Stats.applyEquipment`。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const R = (g, n) => {
    const m = Math.max(1, n | 0);
    if (g && g.rng && g.rng.rnd) return g.rng.rnd(m);
    if (Elona.rng && Elona.rng.rnd) return Elona.rng.rnd(m);
    return Math.floor(Math.random() * m);
  };
  const V65 = (g, n) => (g && g.getV65 ? (g.getV65(n) | 0) : 0);
  const setV65 = (g, n, v) => { if (g && g.setV65) g.setV65(n, v | 0); };

  /** 物品类别（refitem(id, 5)）与字段的常用别名 */
  const CAT = {
    FOOD: 57000,        // 食物
    LIQUID: 52000,      // 液体 / 药水容器
    EQUIP_HI: 50000,    // 小于此值视为装备/道具（会锈蚀）
  };
  /** 目标物品 refitem(id, 9) == 60001 表示「空容器」 */
  const REF9_EMPTY = 60001;

  // 常用物品 id
  const ID = {
    BAIT: 617,
    APHRODISIAC: 262,
    JUICE: 1005,
    MILK: 574,
    WATER: 516,
    EMPTY_BOTTLE: 601,
    HOLY_WATER: 602,
    DYE: 519,
    ACIDPROOF: 566,
    FIREPROOF: 736,
    INCORRUPT: 911,
    SNOW: 587,
    JUNK_FOOD: 934,
    MIX_FOOD: 1069,
  };

  function ref(id, f) {
    return Elona.ItemDB && Elona.ItemDB.ref ? (Elona.ItemDB.ref(id | 0, f) | 0) : 0;
  }
  function name(it) {
    return Elona.ItemDB ? Elona.ItemDB.name(it, 'en') : ('#' + (it && it.id));
  }
  function refresh(g, it) {
    if (!it) return;
    if (g && g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
  }
  /** item_num(it, -1)：消耗一个 */
  function consumeOne(it) {
    if (!it) return 0;
    it.f[0] = (it.f[0] | 0) - 1;
    return it.f[0] | 0;
  }
  /** 装备变化后重算（label_2174 → 项目 Stats） */
  function recalcEquip(g, owner) {
    if (!owner || !Elona.Stats) return;
    if (Elona.Stats.applyEquipment) Elona.Stats.applyEquipment(owner, g);
    if (Elona.Stats.applySkillCorrections) Elona.Stats.applySkillCorrections(owner, g);
    if (Elona.Stats.refreshSpeed) Elona.Stats.refreshSpeed(owner, g);
  }
  /** 在地面放一件物品（itemcreate -1, id, x, y, 0 的常用形态） */
  function spawnAt(g, id, x, y, lv) {
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    let it = null;
    try { it = Elona.ItemDB.createItem(id, 1, g && g.rng); } catch (e) { it = null; }
    if (!it) return null;
    if (lv !== undefined && lv !== null) it.genLevel = lv;
    it.f[5] = x | 0; it.f[6] = y | 0; it.f[21] = -1;
    if (!Array.isArray(g.groundItems)) g.groundItems = [];
    g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(x | 0, y | 0);
    return it;
  }

  /** `itemcreate 0, id, -1, -1, 0` —— 直接放进玩家背包 */
  function toInventory(g, id, lv) {
    const p = g && g.player;
    if (!p || !Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    let it = null;
    try { it = Elona.ItemDB.createItem(id, 1, g.rng); } catch (e) { it = null; }
    if (!it) return null;
    if (lv !== undefined && lv !== null) it.genLevel = lv;
    if (!Array.isArray(p.inv)) p.inv = [];
    let slot = -1;
    for (let k = 0; k < p.inv.length; k++) {
      if (!p.inv[k] || (p.inv[k].f[0] | 0) <= 0) { slot = k; break; }
    }
    if (slot < 0) { p.inv.push(it); } else { p.inv[slot] = it; }
    return it;
  }

  // ==========================================================================
  // A. dipcursed（348266-348329）
  // ==========================================================================
  /**
   * 让一个物品「腐坏 / 锈蚀」。
   * 348267  食物（f5 == 57000）
   * 348268  `var_99(24) == 35` → 腐坏：`f[27] = -1`、`f[2] = 336`
   * 348288  f5 < 50000 → 耐久 f[20]--，若 `var_65(273) == 1`（「锈蚀破坏」开关）
   *         且 f[20] < -10 → 溶解消失
   * @returns {{ok:boolean, kind:string, message:string}}
   */
  function dipcursed(g, it) {
    if (!it) return { ok: false, kind: 'none', message: '' };
    const cat = ref(it.id, 5);
    const nm = name(it);
    if (cat === CAT.FOOD) {
      if ((it.f[24] | 0) === 35) {
        const msg = `${nm}腐烂了……`;
        g.log(msg);
        it.f[27] = -1;
        it.f[2] = 336;
        refresh(g, it);
        return { ok: true, kind: 'rot', message: msg };
      }
      const msg = `${nm}没有任何变化。`;
      g.log(msg);
      return { ok: false, kind: 'nochange', message: msg };
    }
    if (cat < CAT.EQUIP_HI) {
      it.f[20] = (it.f[20] | 0) - 1;
      const msg = `${nm}生锈了……`;
      g.log(msg);
      // 348302-348305：若在角色身上 → label_2174 重算
      const owner = (g && g.player && (it.f[18] | 0) === 0) ? g.player : null;
      recalcEquip(g, owner);
      if (V65(g, 273) === 1 && (it.f[20] | 0) < -10) {
        const msg2 = `${nm}溶解掉了。`;
        g.log(msg2);
        consumeOne(it);
        if (it.f[18]) it.f[18] = 0;          // 348316-348317：脱掉并清装备者
        recalcEquip(g, owner);
        return { ok: true, kind: 'melt', message: msg2 };
      }
      return { ok: true, kind: 'rust', message: msg };
    }
    const msg = '什么也没有发生……';
    g.log(msg);
    return { ok: false, kind: 'none', message: msg };
  }

  // ==========================================================================
  // B. 浸染主流程（*label_3015，348331-348747）
  // ==========================================================================
  /**
   * 把 `src`（液体）用在 `dst`（目标）上。
   * @returns {{ok:boolean, kind:string, message:string, status?:object}}
   */
  function dip(g, src, dst) {
    if (!src || !dst) return { ok: false, kind: 'no-item', message: '没有什么可以浸染的。' };
    const sid = src.id | 0;
    const did = dst.id | 0;
    const snm = name(src);
    const dnm = name(dst);

    // 348334-348336：某种液体的使用计数（var_65(250+439)）
    if ((src.f[2] | 0) === 354) setV65(g, 689, V65(g, 689) + 1);

    // ---- 348337-348353：鱼饵 617 → 钓竿上饵
    if (sid === ID.BAIT) {
      consumeOne(src);
      const msg = `你用${snm}给${dnm}上了饵。`;
      g.log(msg);
      if ((dst.f[28] | 0) === (src.f[25] | 0)) {
        dst.f[9] = (dst.f[9] | 0) + R(g, 10) + 15;
      } else {
        dst.f[9] = R(g, 10) + 15;
        dst.f[28] = src.f[25] | 0;
      }
      return { ok: true, kind: 'bait', message: msg, bait: dst.f[9] | 0 };
    }

    // ---- 348356-348471：液体容器 → 空容器
    if (ref(sid, 5) === CAT.LIQUID && ref(did, 9) === REF9_EMPTY) {
      consumeOne(src);
      if (sid !== ID.EMPTY_BOTTLE) {
        const msg = `你把${dnm}浸入了${snm}。`;
        g.log(msg);
        if (did === ID.HOLY_WATER) {                 // 348367-348374
          const m2 = '圣井被玷污了。';
          g.log(m2);
          return { ok: true, kind: 'pollute', message: m2 };
        }
        if ((dst.f[27] | 0) >= 20) {                 // 348375-348382
          const m2 = `${dnm}已经完全干了。`;
          g.log(m2);
          return { ok: true, kind: 'dry', message: m2 };
        }
        g.log(`${dnm}闪了一下。`);                    // 348384-348387
        if (sid === ID.SNOW) {                       // 348388-348394
          const m2 = '这点量……';
          g.log(m2);
          return { ok: true, kind: 'snow', message: `${msg}${m2}` };
        }
        dst.f[25] = (dst.f[25] | 0) + R(g, 3);       // 348396
        return { ok: true, kind: 'fill', message: msg };
      }
      // ---- 348400-348469：空瓶 + 井水
      if ((dst.f[25] | 0) < -5 || (dst.f[27] | 0) >= 20
          || (did === ID.HOLY_WATER && V65(g, 260) <= 0)) {
        const m2 = `${dnm}是干的。`;
        g.log(m2);
        g.log('哎呀，把空瓶掉进井里了……');
        return { ok: true, kind: 'empty', message: m2 };
      }
      if (did === ID.HOLY_WATER) {                   // 348434-348449
        setV65(g, 260, V65(g, 260) - 1);
        toInventory(g, ID.WATER);
        dst.f[17] = 1;
        return { ok: true, kind: 'holy-well', message: '从井里打了水。' };
      }
      dst.f[25] = (dst.f[25] | 0) - 3;               // 348452
      // 348453-348455：`flt 20 : var_638 = 52000 : itemcreate 0, 0, -1, -1, 0`
      //   原版按类别 52000 随机生成一瓶液体；本项目没有随机物品生成器，固定给「水」。
      toInventory(g, ID.WATER, 20);
      g.log('从井里打了水。');
      g.log(`得到了${dnm}。`);
      return { ok: true, kind: 'well', message: '从井里打了水。' };
    }

    // ---- 348472-348487：媚药 262 → 食物
    if (sid === ID.APHRODISIAC && ref(did, 5) === CAT.FOOD) {
      consumeOne(src);
      const msg = `你做出了媚药食物！你暗自窃喜。`;
      g.log(msg);
      if ((src.f[17] | 0) <= -1) dipcursed(g, dst);
      if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(14, dst, 1);
      return { ok: true, kind: 'aphrodisiac', message: msg };
    }

    // ---- 348488-348500：果汁 1005 + 果汁 → 混合果汁
    if (sid === ID.JUICE && did === ID.JUICE) {
      consumeOne(src);
      const msg = `${dnm}变成了混合果汁！`;
      g.log(msg);
      if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(18, dst, 1);
      return { ok: true, kind: 'mixjuice', message: msg };
    }

    // ---- 348501-348513：牛奶 574 → 果汁/垃圾食物/混合食物
    if (sid === ID.MILK && (did === ID.JUICE || did === ID.JUNK_FOOD || did === ID.MIX_FOOD)) {
      consumeOne(src);
      const msg = `你往${dnm}里混了牛奶！`;
      g.log(msg);
      if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(1, dst, 1);
      return { ok: true, kind: 'milk', message: msg };
    }

    // ---- 348514-348529：620 → 食物（媚药，愧疚版）
    if (sid === 620 && ref(did, 5) === CAT.FOOD) {
      consumeOne(src);
      const msg = `你做出了媚药食物！你有点愧疚……`;
      g.log(msg);
      if ((src.f[17] | 0) <= -1) dipcursed(g, dst);
      if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(6, dst, 1);
      return { ok: true, kind: 'aphrodisiac2', message: msg };
    }

    // ---- 348530-348580：药水 → 充能道具（1200..1203）
    if (ref(sid, 5) === CAT.LIQUID && (did === 1203 || did === 1202 || did === 1201 || did === 1200)) {
      consumeOne(src);
      const cap = did === 1203 ? 4 : 3;
      if ((dst.f[20] | 0) >= cap) {                // 348533
        const m2 = `不能再给${dnm}充能了。`;
        g.log(m2);
        return { ok: true, kind: 'charge-full', message: m2 };
      }
      // 348542-348546：充能量 = limit(价值/1000, 0, 4)，1203 三倍
      let v = 0;
      if (Elona.ItemDB && Elona.ItemDB.calcValue) {
        try { v = Elona.ItemDB.calcValue(null, src, 5, g) | 0; } catch (e) { v = 0; }
      }
      if (did === 1203) v *= 3;
      v = limit(idiv(v, 1000), 0, 4);
      if (v === 0) {                               // 348547
        const m2 = `${snm}里没有足够的魔力来充能${dnm}。`;
        g.log(m2);
        return { ok: true, kind: 'charge-weak', message: m2 };
      }
      dst.f[20] = limit((dst.f[20] | 0) + v, 0, cap);
      const msg = `Potion-charge Lv${dst.f[20] | 0}!!`;
      g.log(msg);
      return { ok: true, kind: 'charge', message: msg, level: dst.f[20] | 0 };
    }

    // ---- 348581-348610：水 / 圣水 / 1115 → 去闪耀 或 诅咒
    if (sid === 26 || sid === 704 || sid === 1115) {
      if ((dst.f[17] | 0) === 1) {
        consumeOne(src);
        const msg = `${dnm}的闪耀被去掉了。`;
        g.log(msg);
        dst.f[17] = 0;
        if ((src.f[17] | 0) <= -1) dipcursed(g, dst);
        recalcEquip(g, g && g.player);
        return { ok: true, kind: 'deshine', message: msg };
      }
      // 348601-348609：目标本来就不闪耀时，只有「被诅咒的液体」才有反应
      if ((src.f[17] | 0) <= -1) {
        consumeOne(src);
        dipcursed(g, dst);
        recalcEquip(g, g && g.player);
        return { ok: true, kind: 'curse', message: '' };
      }
      return { ok: false, kind: 'none', message: '' };
    }

    // ---- 348611-348626：911 → 不腐食物
    if (sid === ID.INCORRUPT && ref(did, 5) === CAT.FOOD) {
      consumeOne(src);
      const msg = `你做出了不腐的食物！`;
      g.log(msg);
      if ((src.f[17] | 0) <= -1) dipcursed(g, dst);
      if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(19, dst, 1);
      return { ok: true, kind: 'incorrupt', message: msg };
    }

    // ---- 348627-348649：染料 519
    if (sid === ID.DYE) {
      consumeOne(src);
      dst.f[22] = src.f[22] | 0;
      const msg = `你把${dnm}染了色。`;
      g.log(msg);
      refresh(g, dst);
      return { ok: true, kind: 'dye', message: msg, color: dst.f[22] | 0 };
    }

    // ---- 348650-348678：566 → 耐酸
    if (sid === ID.ACIDPROOF && ref(did, 5) !== CAT.LIQUID) {
      consumeOne(src);
      const msg = `你在${dnm}上涂了${snm}。`;
      g.log(msg);
      if ((src.f[17] | 0) <= -1) {
        dipcursed(g, dst);
      } else {
        if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(1, dst, 1);
        g.log(`${dnm}获得了耐酸性。`);
      }
      return { ok: true, kind: 'acidproof', message: msg };
    }

    // ---- 348679-348714：736 → 耐火
    if (sid === ID.FIREPROOF) {
      consumeOne(src);
      const msg = `你在${dnm}上涂了${snm}。`;
      g.log(msg);
      if ((src.f[17] | 0) <= -1) {
        dipcursed(g, dst);
      } else if (did === 567) {
        g.log('好主意！但是……');
      } else {
        if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(2, dst, 1);
        g.log(`${dnm}获得了耐火性。`);
      }
      return { ok: true, kind: 'fireproof', message: msg };
    }

    // ---- 348715-348741：水 516 → 银化（圣水）/ 诅咒（被诅咒的水）
    if (sid === ID.WATER) {
      // 348717 `if ( var_99(17, var_2261) == 1 )` —— 判断的是**源**（圣水）而不是目标
      if ((src.f[17] | 0) === 1) {
        consumeOne(src);
        const msg = `${dnm}闪着银光。`;
        g.log(msg);
        dst.f[17] = 1;
        recalcEquip(g, g && g.player);
        return { ok: true, kind: 'silver', message: msg };
      }
      if ((src.f[17] | 0) <= -1) {
        consumeOne(src);
        const msg = `${dnm}被暗色的气场包裹着。`;
        g.log(msg);
        dst.f[17] = -1;
        recalcEquip(g, g && g.player);
        return { ok: true, kind: 'curse', message: msg };
      }
    }

    // ---- 348742-348747：什么也没有发生
    const msg = '什么也没有发生……';
    g.log(msg);
    return { ok: false, kind: 'none', message: msg };
  }

  // ==========================================================================
  // 选择器的过滤：什么算「液体」
  // ==========================================================================
  /** 可以作为浸染源的物品（52000 液体 / f[24] == 35 的食物） */
  function isLiquid(it) {
    if (!it) return false;
    return ref(it.id, 5) === CAT.LIQUID || (it.f[24] | 0) === 35;
  }

  Elona.Dip = {
    CAT, ID, REF9_EMPTY,
    dip, dipcursed, isLiquid,
    _internals: { ref, name, consumeOne, spawnAt, recalcEquip },
  };
})(typeof window !== 'undefined' ? window : globalThis);
