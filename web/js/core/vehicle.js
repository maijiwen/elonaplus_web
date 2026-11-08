'use strict';
/**
 * 载具 / 航海 —— 大型馬車・魔導機関車（陆上）与客船・海賊船・漁船（海上）。
 *
 * 【源码定位】
 *   持有等级   var_65(250 + 417) = 陆上载具等级（0..4）→ 槽位 667
 *              var_65(250 + 444) = 海上载具等级（0..6）→ 槽位 694
 *              var_65(250 + 418) = 陆上等级 + f[22]*1000（性能附加）
 *              var_65(250 + 445) = 海上等级 + f[22]*1000
 *   生效等级   var_65(250 + 442) = 当前陆上载具 → 槽位 692
 *              var_65(250 + 446) = 当前海上载具 → 槽位 696
 *              194002-194010：海域（var_65(850)==47）时海上生效；
 *                            陆上地形（var_132(0, var_65(20)) == 1）时陆上生效
 *   陆上呼出   326255-326314（effect 1174）
 *     · 等级 = 物品 f[25]；与当前等级相同 → 「改为徒步」，等级归 0
 *     · 消耗 var_65(82)：等级 1→10000、2→20000、3→30000、4→100000（呼出时返还）
 *   海上出航   326316-326410（effect 1175）
 *     · 必须在海边城镇：地图 11 / 93 / 36 / 53 / 54
 *     · 保险费：1281→5000、1280→10000、1279→15000、1278→20000、1277→25000、1276→30000
 *     · 出航后：等级按物品 id 定为 1..6、var_58(197)=5（船的状态）、
 *              var_65(250+447) = var_65(850)*100 + var_65(20)、var_65(64)=47（进入海域）
 *   船的状态   var_58(197)：雷雨（278166-278181）/海鸟（278736-278767）/鲨鱼（278771-278849）
 *              每次 -1，<= 0 → 船大破 → var_65(250+444) = 0（失去海上载具）
 *   维护费     214570-214599：陆上 500/2000/10000/200000；海上 100/3000/10000/50000/100000/150000
 *              （economy.js 的 calcBuilding 已按槽 692/696 计费）
 *   渔船特权   278236：var_65(250+444) == 2（漁船）时渔获量翻倍
 *
 * 【载具物品】
 *   陆上 1187 大型馬車 / 1188 輸送車 / 1189 魔導機関車 / 1190 陸上戦艦
 *        （等级取物品 f[25]，未写入时按价格阶梯取 1/2/3/4 —— 登记 A265）
 *   海上 1281 巨大イカダ→1、1280 漁船→2、1279 海賊船→3、1278 客船→4、
 *        1277 軍用艦→5、1276 潜水艦→6（326384-326399 逐条确认）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const LAND_SLOT = 667;      // var_65(250 + 417)
  const LAND_PERF_SLOT = 668; // var_65(250 + 418)
  const SEA_SLOT = 694;       // var_65(250 + 444)
  const SEA_PERF_SLOT = 695;  // var_65(250 + 445)
  const CUR_LAND_SLOT = 692;  // var_65(250 + 442)
  const CUR_SEA_SLOT = 696;   // var_65(250 + 446)
  const SEA_HOME_SLOT = 697;  // var_65(250 + 447)：出航前的世界*100+地图
  const CARGO_LIMIT_SLOT = 82; // var_65(82)：货物（荷车）负重上限
  const MOVE_COST_SLOT = 82;  // var_65(82)（别名，见 cargoLimit）
  const SHIP_STATE_FIELD = 197; // var_58(197)：船的状态

  /** 陆上载具：物品 id → 默认等级（物品 f[25] 为 0 时使用） */
  const LAND_VEHICLES = {
    1187: { level: 1, jp: '大型馬車', en: 'carriage' },
    1188: { level: 2, jp: '輸送車', en: 'carriage' },
    1189: { level: 3, jp: '魔導機関車', en: 'magic locomotive' },
    1190: { level: 4, jp: '陸上戦艦', en: 'land battleship' },
  };

  /** 海上载具：物品 id → 等级（326384-326399） */
  const SEA_VEHICLES = {
    1281: { level: 1, fee: 5000, jp: '巨大イカダ', en: 'giant squid' },
    1280: { level: 2, fee: 10000, jp: '漁船', en: 'fishing ship' },
    1279: { level: 3, fee: 15000, jp: '海賊船', en: 'pirate ship' },
    1278: { level: 4, fee: 20000, jp: '客船', en: 'cruise ship' },
    1277: { level: 5, fee: 25000, jp: '軍用艦', en: 'warship' },
    1276: { level: 6, fee: 30000, jp: '潜水艦', en: 'submarine' },
  };

  /** 陆上载具的移动消耗（326265-326276 / 326301-326311） */
  const LAND_COST = { 1: 10000, 2: 20000, 3: 30000, 4: 100000 };

  /** 维护费（214570-214599） */
  const MAINTENANCE = {
    land: { 1: 500, 2: 2000, 3: 10000, 4: 200000 },
    sea: { 1: 100, 2: 3000, 3: 10000, 4: 50000, 5: 100000, 6: 150000 },
  };

  /** 326318：必须停在海边的城镇 */
  const SEA_TOWN_MAPS = [11, 93, 36, 53, 54];

  /**
   * 船的状态文本（var_277，8769-8772）：
   *   0 航行不能 / Unnavigable
   *   1 大破寸前 / About to sink
   *   2 ヤバい / Dangerous
   *   3 トラブル多発 / Many troubles
   *   4 損傷は軽微 / Minor damage
   *   5 順風満帆 / No problems
   * 出航时置 5（326405），雷雨/海鸟/鲨鱼各减 1，归零即船大破。
   */
  const SHIP_CONDITION = [
    '航行不能', '大破寸前', 'ヤバい', 'トラブル多発', '損傷は軽微', '順風満帆',
  ];

  function isVehicle(item) {
    if (!item) return false;
    const id = item.id | 0;
    return Object.prototype.hasOwnProperty.call(LAND_VEHICLES, id)
      || Object.prototype.hasOwnProperty.call(SEA_VEHICLES, id);
  }
  function isLandVehicle(item) {
    return !!item && Object.prototype.hasOwnProperty.call(LAND_VEHICLES, item.id | 0);
  }
  function isSeaVehicle(item) {
    return !!item && Object.prototype.hasOwnProperty.call(SEA_VEHICLES, item.id | 0);
  }

  function landLevel(g) { return (g && g.getV65) ? (g.getV65(LAND_SLOT) | 0) : 0; }
  function seaLevel(g) { return (g && g.getV65) ? (g.getV65(SEA_SLOT) | 0) : 0; }
  function currentLand(g) { return (g && g.getV65) ? (g.getV65(CUR_LAND_SLOT) | 0) : 0; }
  function currentSea(g) { return (g && g.getV65) ? (g.getV65(CUR_SEA_SLOT) | 0) : 0; }

  /** 船的状态 var_58(197) */
  function shipState(g) {
    const p = g && g.player;
    return p ? (p.get(SHIP_STATE_FIELD) | 0) : 0;
  }
  function setShipState(g, v) {
    const p = g && g.player;
    if (p) p.set(SHIP_STATE_FIELD, v | 0);
  }

  /** 维护费合计（按当前生效的载具） */
  function maintenance(g) {
    return (MAINTENANCE.land[currentLand(g)] || 0) + (MAINTENANCE.sea[currentSea(g)] || 0);
  }

  /**
   * 更新当前生效的载具（194002-194010）。
   *   海域（var_65(850) == 47）→ 海上生效
   *   陆上地形（var_132(0, var_65(20)) == 1）→ 陆上生效
   */
  function updateCurrent(g) {
    if (!g || !g.setV65) return { land: 0, sea: 0 };
    const world = g.getV65(850) | 0;
    const land = landLevel(g), sea = seaLevel(g);
    let cl = 0, cs = 0;
    if (world === 47) {
      cs = sea;
    } else {
      const kind = (Elona.Sites && Elona.Sites.kindOf)
        ? (Elona.Sites.kindOf(g.getV65(20) | 0) | 0) : 0;
      if (kind === 1) cl = land;
    }
    g.setV65(CUR_LAND_SLOT, cl);
    g.setV65(CUR_SEA_SLOT, cs);
    return { land: cl, sea: cs };
  }

  /** 陆上载具等级：优先取物品 f[25]（326290） */
  function landLevelOfItem(item) {
    const f25 = (item && item.f && item.f[25]) | 0;
    if (f25 > 0) return f25;
    const def = LAND_VEHICLES[item.id | 0];
    return def ? def.level : 0;
  }

  /**
   * 陆上载具：呼出 / 改为徒步（326255-326314）。
   */
  function callLand(g, item) {
    if (!isLandVehicle(item)) return { ok: false, reason: 'not-land-vehicle' };
    const lv = landLevelOfItem(item);
    const cur = landLevel(g);
    if (cur === lv) {
      // 326277-326287：与当前等级相同 → 改为徒步
      g.setV65(LAND_SLOT, 0);
      g.setV65(LAND_PERF_SLOT, 0);
      syncCargoLimit(g);
      updateCurrent(g);
      return { ok: true, foot: true,
        message: 'あなたは乗り物を使わず徒歩で旅することにした。（你决定徒步旅行）' };
    }
    // 326290-326294：设置新等级
    g.setV65(LAND_SLOT, lv);
    g.setV65(LAND_PERF_SLOT, lv + ((item.f && item.f[22]) | 0) * 1000);
    if (currentLand(g) < lv) g.setV65(CUR_LAND_SLOT, lv);
    // 326301-326312：按新等级同步 var_65(82)（荷车负重上限）
    syncCargoLimit(g);
    return { ok: true, level: lv,
      message: 'あなたは乗り物をさっそく郊外に呼んだ。（你把载具召喚到了郊外）' };
  }

  /**
   * 海上载具：出航（326316-326410）。
   */
  function sail(g, item) {
    if (!isSeaVehicle(item)) return { ok: false, reason: 'not-sea-vehicle' };
    const mapId = g.getV65(20) | 0;
    if (SEA_TOWN_MAPS.indexOf(mapId) < 0) {
      return { ok: false, reason: 'not-sea-town',
        message: 'それは海に面した街などで読む必要がある。' };
    }
    const v = SEA_VEHICLES[item.id | 0];
    const p = g.player;
    if ((p.get(30) | 0) < v.fee) {
      return { ok: false, reason: 'no-money', message: '金が足りない…' };
    }
    p.set(30, (p.get(30) | 0) - v.fee);
    g.setV65(SEA_SLOT, v.level);
    g.setV65(SEA_PERF_SLOT, v.level + ((item.f && item.f[22]) | 0) * 1000);
    if (currentSea(g) < v.level) g.setV65(CUR_SEA_SLOT, v.level);
    setShipState(g, 5);                                   // 326405
    g.setV65(SEA_HOME_SLOT, (g.getV65(850) | 0) * 100 + mapId);   // 326407 出航前位置
    return { ok: true, level: v.level, fee: v.fee,
      message: `保険料${v.fee}gpを払って出航した。（支付保险费 ${v.fee} gp 出航）` };
  }

  /**
   * 船体受损（278166 / 278752 / 278815 / 278834）。
   */
  function damageShip(g, n) {
    if (!g) return { ok: false };
    const before = shipState(g);
    if (before <= 0) return { ok: false, reason: 'no-ship' };
    const after = before - (n | 0);
    setShipState(g, after);
    if (after <= 0) {
      // 278755-278767 / 278837-278849：船大破 → 失去海上载具
      g.setV65(SEA_SLOT, 0);
      g.setV65(CUR_SEA_SLOT, 0);
      return { ok: true, wrecked: true,
        message: '度重なる損傷により、あなたの船は大破した。（船因反复受损而沉没）' };
    }
    return { ok: true, wrecked: false, state: after,
      message: 'どうにか逃げきれたが、船がそれなりに損傷を受けた。（船体受损）' };
  }

  /**
   * 雷雨事件（278135-278193）：船的状态 -1，<= 0 沉船并让全员湿透。
   */
  function stormTick(g) {
    const r = damageShip(g, 1);
    if (!r.ok) return r;
    if (r.wrecked) wetAll(g);       // 278182-278192
    return r;
  }

  /** 278182-278192：全员湿透、疲劳 +10 */
  function wetAll(g) {
    const list = (g && g.charas) || [];
    for (let i = 1; i < list.length; i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if ((c.get(259) | 0) < 5 && Elona.Status && Elona.Status.wet) {
        Elona.Status.wet(c, 5, g);
      }
      c.set(263, (c.get(263) | 0) + 10);
    }
  }

  /** 海鸟遭遇（278736-278753）：等级 3/5 可无伤，其余 -1 */
  function seabirdEncounter(g) {
    const lv = currentSea(g);
    if (lv === 3 || lv === 5) {
      return { ok: true, damage: 0,
        message: '大きな損傷を受ける前に大砲で追い払うことができた。（用大炮赶走了海鸟）' };
    }
    const r = damageShip(g, 1);
    return Object.assign(r, { damage: 1 });
  }

  /** 鲨鱼遭遇（278799-278836）：等级 >= 5 可用鱼雷无伤 */
  function sharkEncounter(g) {
    const lv = currentSea(g);
    if (lv >= 5) {
      return { ok: true, damage: 0,
        message: '大きな損傷を受ける前に魚雷でサメを爆殺した。（用鱼雷击杀了鲨鱼）' };
    }
    const r = damageShip(g, 1);
    return Object.assign(r, { damage: 1 });
  }

  /** 载具能否在当前世界通行 */
  function canTravel(g) {
    const world = g.getV65(850) | 0;
    if (world === 47) return currentSea(g) > 0;      // 海域需要海上载具
    return true;
  }

  /**
   * 载重上限 —— var_65(82)。
   * 源码：
   *   220013-220014：var_65(81) = 80000 ; var_65(82) = var_65(81)
   *   302209-302221：var_65(82) = var_65(82) / 10000 * 10000（去掉载具加成）
   *                   再按陆上载具等级加 10/20/30/100 * 1000
   *   326265-326276 / 326301-326312：呼出/徒步时同步加减
   *   422732-422743：丢弃载具时扣掉加成
   * 本实现以 80000 为基础上限（CARGO_BASE），按当前陆上载具等级给加成。
   * @param {number} [level] 陆上载具等级；缺省取当前持有的等级
   */
  const CARGO_BASE = 80000;
  const CARGO_BONUS = { 1: 10000, 2: 20000, 3: 30000, 4: 100000 };
  function cargoLimit(g, level) {
    const lv = (level === undefined) ? landLevel(g) : (level | 0);
    return CARGO_BASE + (CARGO_BONUS[lv] || 0);
  }

  /**
   * 把 var_65(82) 同步到当前载具等级对应的上限（并初始化 var_65(81)）。
   * 在新游戏、呼出载具、丢弃载具后调用。
   */
  function syncCargoLimit(g) {
    if (!g || !g.setV65) return 0;
    g.setV65(81, CARGO_BASE);
    const limit = cargoLimit(g);
    g.setV65(CARGO_LIMIT_SLOT, limit);
    return limit;
  }

  /**
   * 货物重量 —— var_65(80) = 背包内「负重量物品」（钱等）的重量合计。
   * 源码 inv_weight(0)（29738-29756）：正重量物品累加到返回值，
   *   负重量物品累加到 var_65(80)（乘 -1）。实际由 Feat.invWeight 维护。
   * @returns {number} var_65(80)
   */
  function cargoWeight(g) {
    return (g && g.getV65) ? (g.getV65(80) | 0) : 0;
  }

  /**
   * 超重时的速度惩罚 —— 194012-194031（refreshspeed 段）。
   *   var_65(80) > var_65(82) → var_58(39) -= 25 + 25 * (weight / (cap + 1))
   *   陆上载具等级 3/4 时惩罚减半（194026-194031）。
   *   无载具时（var_65(250+417)==0）仅在 var_126(6)==1（世界地图）或 ==4 时生效；
   *   有载具时仅在 var_126(6)==1（世界地图）生效。
   * @returns {number} 扣减量（0 = 未超重）
   */
  function overweightPenalty(g, weight, cap, level) {
    const w = weight === undefined ? ((g && g.getV65) ? (g.getV65(80) | 0) : 0) : (weight | 0);
    const c = cap === undefined ? cargoLimit(g, level) : (cap | 0);
    if (!(w > c)) return 0;
    const raw = 25 + 25 * (w / (c + 1));
    const lv = (level === undefined) ? landLevel(g) : (level | 0);
    if (lv >= 3 && lv <= 4) return (raw / 2) | 0;
    return raw | 0;
  }

  /**
   * 丢弃陆上载具、改为徒步（422722-422745）。
   * 源码：NPC 菜单 99「ワールドマップでの乗り物を破棄して徒歩に戻る？」
   *   · 按当前载具等级从 var_65(82)（荷车负重上限）扣掉对应的加成
   *   · var_65(250 + 417) = 0（陆上载具等级归零）
   */
  function discardLand(g) {
    const lv = landLevel(g);
    if (!lv) {
      return { ok: false, reason: 'no-vehicle',
        message: '対象となる乗り物は持っていないようだ。（你没有陆上载具）' };
    }
    // 422732-422743：丢弃时把荷车上限的载具加成扣掉
    g.setV65(LAND_SLOT, 0);
    g.setV65(LAND_PERF_SLOT, 0);
    g.setV65(CUR_LAND_SLOT, 0);
    syncCargoLimit(g);
    return {
      ok: true,
      message: 'ワールドマップでの乗り物を破棄して徒歩に戻ることにした。'
        + '（你丢弃了载具，改为徒步旅行）',
    };
  }

  /** 渔船特权（278236）：海上等级 2（漁船）时渔获量翻倍 */
  function isFishingShip(g) { return seaLevel(g) === 2; }

  /** 载具一览（给 UI 用） */
  function list(g) {
    const out = [];
    for (const k of Object.keys(LAND_VEHICLES)) {
      const v = LAND_VEHICLES[k];
      out.push({ id: Number(k), kind: 'land', level: v.level, jp: v.jp, en: v.en,
        owned: landLevel(g) >= v.level, current: currentLand(g) });
    }
    for (const k of Object.keys(SEA_VEHICLES)) {
      const v = SEA_VEHICLES[k];
      out.push({ id: Number(k), kind: 'sea', level: v.level, fee: v.fee, jp: v.jp, en: v.en,
        owned: seaLevel(g) >= v.level, current: currentSea(g) });
    }
    return out;
  }

  Elona.Vehicle = {
    LAND_SLOT, LAND_PERF_SLOT, SEA_SLOT, SEA_PERF_SLOT,
    CUR_LAND_SLOT, CUR_SEA_SLOT, SEA_HOME_SLOT, MOVE_COST_SLOT, SHIP_STATE_FIELD,
    LAND_VEHICLES, SEA_VEHICLES, LAND_COST, MAINTENANCE, SEA_TOWN_MAPS, SHIP_CONDITION,
    isVehicle, isLandVehicle, isSeaVehicle,
    landLevel, seaLevel, currentLand, currentSea, shipState, setShipState,
    maintenance, updateCurrent, landLevelOfItem,
    callLand, sail, damageShip, stormTick, seabirdEncounter, sharkEncounter, wetAll,
    canTravel, isFishingShip, list,
    cargoLimit, syncCargoLimit, cargoWeight, overweightPenalty, discardLand,
    CARGO_BASE, CARGO_BONUS,
  };
})(window);
