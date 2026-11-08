'use strict';
/**
 * 调合产物专属分支 —— 原版 `*label_2660`（281835-282961，1,127 行）。
 *
 * 原版在同一张 `var_1302` 分派表里给 22 个产物 id（10000-10025）各写了一段
 * 「这个配方到底生成什么」的逻辑，而 `craft.js` 之前统一按 `products[0]` 直接
 * `createItem`，于是 13 个特殊配方全都生成了一件不存在的物品。
 *
 * 本模块把这 22 段抽成数据 + 少量代码，`Craft.craft()` 在成功分支调用
 * `Product.build(g, ctx)` 拿到「真正的产物」。
 *
 * 【判读要点】
 *   · `var_2127(10+0*2)` / `var_2127(10+1*2)` 是**已被消耗的两个材料**（下文称 m0/m1）。
 *     10003 / 10004 / 10005 / 10006 / 10007 / 10008 / 10024 / 10025 都是
 *     「拿 m0 当被加工对象，m1 当催化剂/材料」，产物往往就是 m0 本身。
 *   · 10011 / 10012 / 10022 是**随机工艺产物**：等级 `var_2170` 由 `錬金術(178)`
 *     决定，品质 `var_2171` 由对应技能决定，价位按 `var_99(1) = 等级 × 9000 × (80+品质×20)/100`。
 *   · 10002 的档次 `var_1472` 读的是 `var_99(1, var_580)`（材料 m1 的**价值**），
 *     门槛 1000/1500/1800/2000/3000/5000/10000 → 档 3..9（缺省 2）。
 *   · 10025 是「强化等级 +1」：先把 `var_99(1)` 按旧档次反算回基准，
 *     再取两个材料档次的较大值 +1（上限 12），最后乘新档次。
 *   · 10008 的随机水用的是 `var_638 = 52000`（随机生成，`itemcreate 0, 0`）。
 *
 * 【未做】文本 / 音效 / `item_stack`（见差异表 A365）。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** 随机工艺产物表（10011 木 / 10012 石 / 10022 陶）—— 282582/282624/282540 */
  const CRAFT_TABLE = {
    10011: {          // 木の加工：技能 176（木工）
      skillId: 176,
      items: { 1: 327, 2: 535, 3: 321, 4: 150, 5: 961, 6: 962, 7: 963 },
    },
    10012: {          // 石の加工：技能 179（採掘）
      skillId: 179,
      items: { 1: 53, 2: 138, 3: 539, 4: 872, 5: 964, 6: 965, 7: 966 },
    },
    10022: {          // 焼き物：技能 162（彫刻）
      skillId: 162,
      items: { 1: 189, 2: 217, 3: 782, 4: 98, 5: 1125, 6: 1126, 7: 1127 },
    },
  };

  /** 10014 / 10015 / 10016：装备改修的技能门槛（软/硬/锐）—— 281890-281898 */
  const UPGRADE_SKILLS = { 10014: 177, 10015: 179, 10016: 176 };

  /** 10004 的「锈」= `var_99(20) < 0`；由本模块与 dip.js 共用同一语义 */
  const RUST_FIELD = 20;

  // ------------------------------------------------------------------
  // 材料引用
  // ------------------------------------------------------------------
  /**
   * m0 = 第 0 个材料，m1 = 第 1 个材料（`var_2127(10+n*2)`）。
   * 原版在 281836-281837 直接取，这里可能为 null（材料不足时）。
   */
  function mats(ctx) {
    const p = ctx.picks || [];
    return [p[0] ? p[0].item : null, p[1] ? p[1].item : null];
  }

  /** `var_99(1)` 的档次（10002：282410-282433） */
  function gradeOfValue(v) {
    const x = v | 0;
    if (x > 10000) return 9;
    if (x > 5000) return 8;
    if (x > 3000) return 7;
    if (x > 2000) return 6;
    if (x > 1800) return 5;
    if (x > 1500) return 4;
    if (x > 1000) return 3;
    return 2;
  }

  // ------------------------------------------------------------------
  // 产物构造
  // ------------------------------------------------------------------
  /**
   * 生成一件物品并放进背包（等价 `itemcreate 0, <id>, -1, -1`）。
   * @returns {object|null}
   */
  function make(g, id, count) {
    if (!Elona.ItemDB) return null;
    const it = Elona.ItemDB.createItem(id | 0, count || 1);
    if (!it) return null;
    it.f[0] = count || 1;
    let slot = -1;
    for (let k = 0; k < g.player.inv.length; k++) {
      if (!g.player.inv[k] || (g.player.inv[k].f[0] | 0) <= 0) { slot = k; break; }
    }
    if (slot >= 0) g.player.inv[slot] = it;
    else g.player.inv.push(it);
    return it;
  }

  /**
   * 随机工艺产物（10011 / 10012 / 10022 共用骨架 282540-282580 / 282582-282622 / 282624-282667）。
   *   `var_2170 = limit(rnd(limit(錬金術,1,60)/10+1),1,6) + rnd(2)`   ← 可能到 7
   *   `var_2171 = limit(rnd(limit(技能,1,100)/20+1) + limit(技能,1,100)/20, 1, 10) + rnd(2)`
   *   `var_99(1) = var_2170 * 9000 * (80 + var_2171 * 20) / 100`
   */
  function buildRandomCraft(g, pid) {
    const spec = CRAFT_TABLE[pid];
    if (!spec) return null;
    const R = (n) => ((g.rng && g.rng.rnd) ? (g.rng.rnd(n) | 0) : 0);
    const alchemy = g.player.skill(178) | 0;
    // 三张表的子技能：10011 木工 176 / 10012 採掘 179 / 10022 彫刻 162
    const sub = g.player.skill(spec.skillId | 0) | 0;

    const alv = limit(R(idiv(limit(alchemy, 1, 60), 10) + 1), 1, 6) + R(2);
    const subV = limit(R(idiv(limit(sub, 1, 100), 20) + 1) + idiv(limit(sub, 1, 100), 20), 1, 10) + R(2);
    let itemId = spec.items[alv] || spec.items[7];
    // 10012 的 4 档有 1/2 概率换成 873（282871-282873）
    if (pid === 10012 && alv === 4 && R(2) === 0) itemId = 873;
    const it = make(g, itemId, 1);
    if (!it) return null;
    it.f[23] = subV;                                    // var_99(23)
    it.f[1] = idiv(alv * 9000 * (80 + subV * 20), 100); // var_99(1)
    if (Elona.ItemDB.identify) Elona.ItemDB.identify(it, 3);
    return it;
  }

  const builders = {
    /** 10000 ハーブ調合：往食物里揉香草（281859-281876） */
    [10000](g, ctx) {
      const [m0] = mats(ctx);
      if (!m0) return null;
      Elona.ItemDB.ibitmod(18, m0, 1);                  // 281861
      return m0;                                        // 产物就是那份食物
    },

    /** 10001 進化の側枝：把「进化」值 +14（281877-281889） */
    [10001](g, ctx) {
      const [m0] = mats(ctx);
      if (!m0) return null;
      m0.f[25] = 14;                                    // 281879
      return m0;
    },

    /** 10002 錬金術：按材料价值定档，产出 903（暗之棺）并改重量（282407-282446） */
    [10002](g, ctx) {
      const [, m1] = mats(ctx);
      const grade = gradeOfValue(m1 ? (m1.f[1] | 0) : 0);
      const it = make(g, 903, 1);
      if (!it) return null;
      it.f[25] = grade;                                 // var_99(25)
      it.f[7] = (it.f[7] | 0) + grade * 1000;           // var_99(7) += 档 × 1000
      if (Elona.ItemDB.identify) Elona.ItemDB.identify(it, 3);
      return it;
    },

    /**
     * 10003 接着剤：把 m1 涂到 m0 上。
     *   567（鉄のハンマー）会先吐槽一句再照做；否则给 m0 加「耐火」ibit 2。
     */
    [10003](g, ctx) {
      const [m0] = mats(ctx);
      if (!m0) return null;
      if ((m0.id | 0) !== 567) Elona.ItemDB.ibitmod(2, m0, 1);   // 282702
      return m0;
    },

    /** 10004 錆取り：耐久为负 → 归零（282712-282736） */
    [10004](g, ctx) {
      const [m0] = mats(ctx);
      if (!m0) return null;
      if ((m0.f[RUST_FIELD] | 0) < 0) m0.f[RUST_FIELD] = 0;      // 282714
      return m0;
    },

    /** 10005 撒饵：记录饵的「种类」并把新鲜度重置/累加（282804-282822） */
    [10005](g, ctx) {
      const [m0, m1] = mats(ctx);
      if (!m0) return null;
      if (m1) {
        if ((m0.f[28] | 0) === (m1.f[25] | 0)) {
          m0.f[9] = (m0.f[9] | 0) + (R(g, 10) + 15);              // 282812
        } else {
          m0.f[9] = R(g, 10) + 15;                                // 282816
          m0.f[28] = m1.f[25] | 0;
        }
      }
      return m0;
    },

    /** 10006 聖水：把 m0 变成祝福/诅咒（282823-282851） */
    [10006](g, ctx) {
      const [m0, m1] = mats(ctx);
      if (!m0) return null;
      const b1 = m1 ? (m1.f[17] | 0) : 0;
      if (b1 >= 1) m0.f[17] = 1;
      if (b1 <= -1) m0.f[17] = -1;
      return m0;
    },

    /** 10007 井戸：空瓶打水（282853-282902） */
    [10007](g, ctx) {
      const [m0, m1] = mats(ctx);
      if (!m1) return null;
      if ((m1.id | 0) === 601) return m0;                         // 空瓶碎了，什么也拿不到
      if ((m0.id | 0) === 602) return m0;                         // 圣井被污染
      if ((m0.f[27] | 0) >= 20) return m0;                        // 已经干了
      if ((m1.id | 0) === 587) return m0;                         // 雪化了
      m0.f[25] = (m0.f[25] | 0) + R(g, 3);                        // 282901
      return m0;
    },

    /** 10008 給水：往空瓶里灌水（282904-282961） */
    [10008](g, ctx) {
      const [m0] = mats(ctx);
      if (!m0) return null;
      if ((m0.f[25] | 0) < -5 || (m0.f[27] | 0) >= 20
        || ((m0.id | 0) === 602 && (g.getV65 ? (g.getV65(260) | 0) : 0) <= 0)) {
        return m0;                                                // 干得打不出水
      }
      if ((m0.id | 0) === 602) {
        if (g.setV65) g.setV65(260, (g.getV65(260) | 0) - 1);     // var_65(250+10)--
        const holy = make(g, 516, 1);
        if (holy) holy.f[17] = 1;
        return holy;
      }
      m0.f[25] = (m0.f[25] | 0) - 3;                              // 282935
      return make(g, 0, 1);                                       // 282938：随机药水（var_638 = 52000）
    },

    /** 10010 酒：产出 5 瓶麦酒（282669-282683） */
    [10010](g) {
      const it = make(g, 31, 5);                                  // 282672
      if (it) it.f[17] = 1;
      return it;
    },

    /** 10013 ネクロチューニング：改暗之棺的种族槽（282447-282476） */
    [10013](g, ctx) {
      const [m0, m1] = mats(ctx);
      if (!m0 || !m1) return null;
      m0.f[26] = m1.id | 0;                                       // 282450
      if ((m1.id | 0) === 503) {                                  // 282451
        m0.f[26] = (m1.f[22] | 0) + 12 * 1000;
        if ((m1.f[22] | 0) >= 1000) m0.f[34] = 1;                 // 282455
      }
      return m0;
    },

    /** 10014/15/16 武具改修：m0 加对应技能的经验与耐久（281890-282406） */
    [10014](g, ctx) { return upgrade(g, ctx, 10014); },
    [10015](g, ctx) { return upgrade(g, ctx, 10015); },
    [10016](g, ctx) { return upgrade(g, ctx, 10016); },

    /** 10020 肉詰め蘇生：把肉塞回尸体（282787-282803） */
    [10020](g, ctx) {
      const [m0, m1] = mats(ctx);
      if (!m0) return null;
      m0.f[2] = 1119;                                             // 282790
      m0.f[26] = 10;                                              // 282791
      const st = g.getV65 ? clockStamp(g) : 0;
      m0.f[27] = st + 240;                                        // 282792：10 天后重算
      if (m1) m0.f[22] = m1.f[22] | 0;
      return m0;
    },

    /** 10021 什么也不发生（282477-282486） */
    [10021](g, ctx) {
      const [m0] = mats(ctx);
      return m0 || null;
    },

    /** 10022 / 10011 / 10012：随机工艺产物 */
    [10022](g) { return buildRandomCraft(g, 10022); },
    [10011](g) { return buildRandomCraft(g, 10011); },
    [10012](g) { return buildRandomCraft(g, 10012); },

    /** 10023 生体復元：造出对应等级的怪物，再掉 503 図鑑与 504 卡片（282487-282539） */
    [10023](g, ctx) {
      const [m0] = mats(ctx);
      const lv = m0 ? (m0.f[26] | 0) : 0;
      const roll = lv >= 99 ? 1112
        : lv >= 90 ? 1111 : lv >= 80 ? 1110 : lv >= 70 ? 1109 : lv >= 60 ? 1108
          : lv >= 50 ? 1107 : lv >= 40 ? 1106 : lv >= 30 ? 1105 : lv >= 20 ? 1104
            : lv >= 10 ? 1103 : 1102;
      if (Elona.CharaFactory && Elona.CharaFactory.create) {
        try {
          Elona.CharaFactory.create(g, roll, 1, g.player.x, g.player.y);
        } catch (e) { /* 怪物表未就绪 */ }
      }
      return null;      // 产物是怪物本体，不是物品
    },

    /** 10024 外見模倣：把 m1 的外观/品质抄给 m0（282738-282751） */
    [10024](g, ctx) {
      const [m0, m1] = mats(ctx);
      if (!m0 || !m1) return null;
      m0.f[2] = m1.f[2] | 0;
      m0.f[22] = m1.f[22] | 0;
      m0.f[34] = m1.f[34] | 0;
      return m0;
    },

    /** 10025 装備強化：强化等级 +1（282753-282786） */
    [10025](g, ctx) {
      const [m0, m1] = mats(ctx);
      if (!m0) return null;
      // 282755：先按旧档次把价值反算回基准
      const oldGrade = m0.f[23] | 0;
      m0.f[1] = idiv((m0.f[1] | 0) * 100, 80 + oldGrade * 20);
      // 282757-282771：取两者较大值 +1，但 var_2172 只在「确实有更大的一边」时才会被赋值；
      // 两边相等时保持原值（不是归零 —— 归零会让强化等级被清掉）。
      const g1 = m0.f[23] | 0;
      const g2 = m1 ? (m1.f[23] | 0) : 0;
      let next = g1;
      if (g1 > g2) next = g1 + 1;
      else if (g2 > g1) next = g2 + 1;
      if (next > 12) next = 12;
      m0.f[23] = next;
      if (next !== 0) m0.f[1] = idiv((m0.f[1] | 0) * (80 + next * 20), 100);
      return m0;
    },
  };

  /** 10014/15/16：武具改修（281898-282406，共 517 行）*/
  function upgrade(g, ctx, pid) {
    const [m0] = mats(ctx);
    if (!m0) return null;
    // 源码里 10014/10015 是空分支（281890-281897 只有 var_1303++），
    // 517 行改修表全在 10016；三类配方都查同一张表，查到就改、查不到就不变。
    const ent = UPGRADE_TABLE[m0.id | 0];
    if (!ent) return m0;
    m0.f[3] = ent.next | 0;                             // var_99(3)：换 id
    if (ent.pic) m0.f[2] = ent.pic | 0;                 // var_99(2)：贴图
    if (ent.slot) m0.f[16] = ent.slot | 0;              // var_99(16)：装备位（483/61 例）
    // 282395-282397：重量与强化等级保持原值（原版 var_2168/var_2167 存的是改前值）
    void pid;
    return m0;
  }

  /** 由 extract_craft_upgrade.py 从 281898-282406 提取 */
  let UPGRADE_TABLE = {};

  /** 时钟戳（与 itemfx.js 的 clockStamp 一致） */
  function clockStamp(g) {
    if (!g || !g.getV65) return 0;
    const h = g.getV65(13) | 0, d = g.getV65(12) | 0;
    const mo = g.getV65(11) | 0, y = g.getV65(10) | 0;
    return h + d * 24 + mo * 24 * 30 + y * 24 * 30 * 12;
  }

  function R(g, n) {
    return (g.rng && g.rng.rnd) ? (g.rng.rnd(n) | 0) : 0;
  }

  // ------------------------------------------------------------------
  const Product = {
    /** 这些 id 走本模块（其余走 Craft 的通用路径） */
    isSpecial(pid) { return !!(builders[pid | 0]); },

    /** 载入改修对照表（craft_upgrade.json）；失败时保持空表 */
    async load() {
      if (Object.keys(UPGRADE_TABLE).length) return UPGRADE_TABLE;
      try {
        const d = Elona.Data && Elona.Data.table
          ? await Elona.Data.table('craft_upgrade')
          : await (await fetch('data/tables/craft_upgrade.json')).json();
        UPGRADE_TABLE = (d && d.map) || {};
      } catch (e) { UPGRADE_TABLE = {}; }
      return UPGRADE_TABLE;
    },

    /** 测试注入 */
    setUpgradeTable(t) { UPGRADE_TABLE = t || {}; return this; },

    /**
     * 生成产物。
     * @param {object} g
     * @param {object} ctx { pid, picks, recipe }
     * @returns {{item:object|null, special:boolean, note?:string}}
     */
    build(g, ctx) {
      const pid = (ctx && ctx.pid) | 0;
      const fn = builders[pid];
      if (!fn) return { item: null, special: false };
      let item = null;
      try { item = fn(g, ctx) || null; } catch (e) { item = null; }
      return { item, special: true };
    },

    CRAFT_TABLE, UPGRADE_SKILLS, UPGRADE_TABLE, gradeOfValue,
    get SPECIAL_IDS() { return Object.keys(builders).map(Number).sort((a, b) => a - b); },
  };

  Elona.CraftProduct = Product;
})(window);
