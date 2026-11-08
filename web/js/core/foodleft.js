'use strict';
/**
 * 0-EY：食物系统剩余机制（core/foodleft.js）—— 以 hsp/start.hsp 为准
 *
 * 【源码锚点】
 *   223820-223946 *label_2290 食物腐烂每小时扫描：
 *     223823-223838 地面生肉放在「冷藏格」(var_593(0,cell)==3) → f[27] = now + 72
 *     223846-223920 地面食材在「日干し岩」(var_593(0,cell)==1) + 牧场(mapType 31)
 *                    + 晴天(var_65(17)==0) → 变成干制品，不腐烂
 *     223943-223944 其余 → f[27]=-1、f[2]=336（由 Status.rotTick 处理）
 *   24945            var_596(1) = 「日干し岩 / a dryrock」
 *   24420            var_593(0, 29) = 1（牧场地图第 29 格是晾晒石，30/31 是田地）
 *   12197            var_132(16,map) == 31 → 「牧場 / Ranch」
 *   342154-342180    容器窗口（var_577==6）存取食物时的腐烂时间换算：
 *                    存入冰箱(var_486==24, 模式 3) f[27] -= now；
 *                    取出冰箱(var_486==22, 模式 3) f[27] += now。
 *   340944-341420    投掷命中角色：
 *     341069-341090  772 番茄（腐烂时 +rnd(10)+5 激怒 264）
 *     341156-341177  1081 纳豆 / 1072 酸奶 / 1073 黄油
 *     341640-341673  57000 类食物命中 → 瞬间进食（label_2945）、1/8 噎住
 *     341674-341676  没吃掉 → 无属性伤害 + 食物留在脚下
 *   356280-356370    效果 75（大型野餐篮）/ 100（圣诞蛋糕套餐）
 *   309679-309870    *label_2926 / *label_2928：吃饭结束后的饱腹 / 潜力 / 12 月奖励
 *   413-551           var_75(0,buffId)==3 = 「加速成长类增益」（20..28、67）
 *   201653-201663     chara_vomit 删除全部 type 3 buff
 *   199698-199712     元素 58（神）/52（雷）伤害 → 脑寄生 cbit 1045 死亡
 *
 * 【与项目的偏差（登记在 docs/02-diff-report.md）】
 *   · 原版 var_593 是 33×25 的地面设施表，本项目无对应数据；这里用
 *     `g.map.dryrockCells`（坐标字符串数组，可随存档序列化）承载，进入牧场时
 *     按源码第 29 格懒初始化，也可用 markDryrock() 显式放置。
 *     冷藏格改为「地上有冰箱(579/641) 的同格」。
 *   · 原版野餐篮用 label_2960 施法 619 把同伴集合过来，本项目按「同地图前 16 号友方角色」近似。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** 冰箱 / 小冰箱（4 格与共享空间两种，源码 344857-344872 的 var_486(1)==3 模式） */
  const FREEZER_IDS = [579, 641];
  const MAP_TYPE_RANCH = 31;
  const DRYROCK_INDEX = 29;
  const FOOD_CAT = 57000;

  /** var_75(0, id) == 3：成长类 buff（524-551），呕吐时全部清除 */
  const GROWTH_BUFFS = [20, 21, 22, 23, 24, 25, 26, 27, 28, 67];

  /**
   * 干制产物（223871-223920）。源码的 var_99(3) 是物品 id、var_99(2) 是图块，
   * 项目里对应 it.id / it.f[2]。f[22] 是干制品的食材类别。
   */
  const DRY_TABLE = {
    corpse: { id: 571, graphic: 337, f22: null },   // 死体 → 干し肉
    2: { id: 1103, graphic: 337, f22: 2 },          // 野菜 → 干し野菜
    3: { id: 1102, graphic: 301, f22: 5 },          // 果物 → ドライフルーツ
    6: { id: 1104, graphic: 301, f22: 10 },         // 魚 → 干物
  };

  /** 投掷时有专属效果的食物（341069-341210） */
  const SPECIAL_THROW = { 772: 'tomato', 1072: 'yogurt', 1073: 'butter', 1081: 'natto' };

  function clockHours(g) {
    if (Elona.Status && Elona.Status.clockHours) return Elona.Status.clockHours(g);
    if (!g || !g.getV65) return 0;
    return (g.getV65(13) | 0) + (g.getV65(12) | 0) * 24
      + (g.getV65(11) | 0) * 24 * 30 + (g.getV65(10) | 0) * 24 * 30 * 12;
  }

  function mapType(g) {
    if (Elona.Ranch && Elona.Ranch.mapType) return Elona.Ranch.mapType(g) | 0;
    return (g && g.map && g.map.mapType) | 0;
  }

  function weather(g) {
    if (Elona.Weather && Elona.Weather.current) return Elona.Weather.current(g) | 0;
    return (g && g.getV65 ? (g.getV65(17) | 0) : 0);
  }

  const key = (x, y) => (x | 0) + ',' + (y | 0);

  /** 牧场地图第一次腐烂扫描时按源码 24420 摆好晾晒石（33 宽地图的第 29 格） */
  function ensureDryrock(g) {
    const m = g && g.map;
    if (!m || m.dryrockCells) return;
    const w = (m.width || m.w || 33) | 0;
    // 用数组而不是 Set：地图对象会随存档 JSON 序列化
    m.dryrockCells = [];
    if (mapType(g) === MAP_TYPE_RANCH) {
      m.dryrockCells.push(key(DRYROCK_INDEX % w, Math.floor(DRYROCK_INDEX / w)));
    }
  }

  /** 显式摆放晾晒石（控制台/测试/未来家具放置入口） */
  function markDryrock(g, x, y) {
    if (!g || !g.map) return false;
    ensureDryrock(g);
    const k = key(x, y);
    if (g.map.dryrockCells.indexOf(k) < 0) g.map.dryrockCells.push(k);
    return true;
  }

  function isDryrock(g, x, y) {
    if (!g || !g.map) return false;
    ensureDryrock(g);
    return !!(g.map.dryrockCells && g.map.dryrockCells.indexOf(key(x, y)) >= 0);
  }

  /** 该格是否放着冰箱/小冰箱（223826 的 var_593(0,cell)==3 在本项目的等价判定） */
  function fridgeCell(g, x, y) {
    const list = (g && g.groundItems) || [];
    for (const it of list) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if (FREEZER_IDS.indexOf(it.id | 0) < 0) continue;
      if ((it.f[5] | 0) === (x | 0) && (it.f[6] | 0) === (y | 0)) return true;
    }
    return false;
  }

  /** 该食物是否允许晾晒（223853：尸体 204 或食材类别 2/3/6） */
  function dryCandidate(g, it, ground) {
    if (!ground || !it || !it.f || (it.f[21] | 0) > 0) return null;
    if (mapType(g) !== MAP_TYPE_RANCH) return null;
    const cat = idiv(it.f[25] | 0, 1000);
    const conv = (it.id | 0) === 204 ? DRY_TABLE.corpse : DRY_TABLE[cat];
    if (!conv) return null;
    if (!isDryrock(g, it.f[5] | 0, it.f[6] | 0)) return null;
    return conv;
  }

  /** 223871-223920：变成干制品（f[27]=0 表示不再腐烂，数量 ×5） */
  function dryConvert(g, it, conv) {
    const before = it.f[0] | 0;
    it.f[3] = conv.id;                                 // var_99(3)：Item.id 是 f[3] 的 getter
    try { if (it.id !== conv.id) it.id = conv.id; } catch (_) { /* 只读 getter，已写 f[3] */ }
    it.f[2] = conv.graphic;
    it.f[27] = 0;
    it.f[25] = 0;
    it.f[26] = 4;
    it.f[7] = 100;
    it.f[20] = 0;
    it.f[17] = 0;
    if (conv.f22 !== null) it.f[22] = conv.f22;
    if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(18, it, 0);
    it.f[0] = before * 5;
    if (g.log) g.log(`一份食物在晾晒石上晒成了干制品。（${conv.id}）`);
    return { kind: 'dry', to: conv.id, count: it.f[0] };
  }

  /** 223823-223838：地面生肉在冷藏格上**每小时**把到期时刻推到 now+72（不看是否已到期） */
  function fridgeCheck(g, it, now) {
    if (!it || !it.f || (it.f[21] | 0) > 0) return false;
    if (idiv(it.f[25] | 0, 1000) !== 6 || (it.f[26] | 0) !== 0) return false;
    if (!fridgeCell(g, it.f[5] | 0, it.f[6] | 0)) return false;
    it.f[27] = (now | 0) + 72;
    return true;
  }

  /**
   * Status.rotTick 在「到期」时问这里：
   *   dry  → 变成干制品；wait → 非晴天暂不结算（223868 continue）；
   *   null → 按原逻辑腐烂。
   */
  function rotCheck(g, it, ground, now) {
    if (!it || !it.f) return null;
    const conv = dryCandidate(g, it, ground);
    if (!conv) return null;
    if (weather(g) !== 0) return { kind: 'wait' };       // 223868：非晴天跳过本次扫描
    return dryConvert(g, it, conv);
  }

  // ============================================================ 冰箱时间换算
  function isFreezer(it) {
    return !!(it && FREEZER_IDS.indexOf(it.id | 0) >= 0);
  }

  /**
   * 342161-342180：只对 57000 类食物、f[27]>0 换算。
   * 存入把「绝对到期时刻」变成「剩余小时数」，取出时加回当前时刻——
   * 于是箱内停留的时间不计入腐烂，这正是 wiki 说的冷藏效果。
   */
  function freezerConvert(g, x, dir) {
    if (!x || !x.f) return false;
    if (!Elona.ItemDB || (Elona.ItemDB.ref(x.id, 5) | 0) !== FOOD_CAT) return false;
    const until = x.f[27] | 0;
    if (until <= 0) return false;
    const now = clockHours(g);
    x.f[27] = dir === 'in' ? until - now : until + now;
    return true;
  }

  // ============================================================ 投掷食物
  /** 从地面容器里移除已消耗的一份 */
  function dropGround(g, it) {
    const list = g && g.groundItems;
    if (!list) return;
    const i = list.indexOf(it);
    if (i >= 0) list.splice(i, 1);
    if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
  }

  function consumeOne(g, it) {
    it.f[0] = (it.f[0] | 0) - 1;
    if (it.f[0] <= 0) { it.f[0] = 0; dropGround(g, it); }
  }

  /**
   * 341069-341210：番茄/酸奶/黄油/纳豆命中时的专属效果（这些食物**不会**被瞬间吃掉）。
   * @returns {object|null} null = 不是特殊食物
   */
  function specialThrowFood(g, thrower, target, it) {
    const kind = SPECIAL_THROW[it.id | 0];
    if (!kind || !target) return null;
    const R = (n) => (g.rng || Elona.rng).rnd(Math.max(1, n | 0));
    const out = { special: true, kind, consumed: true };
    switch (kind) {
      case 'tomato':                                  // 341069-341090
        if ((it.f[27] | 0) === -1 && (target.get(264) | 0) === 0) {
          target.set(264, (target.get(264) | 0) + R(10) + 5);
          out.anger = target.get(264) | 0;
        }
        break;
      case 'natto':                                   // 341156-341177
        if ((target.get(264) | 0) === 0) {
          target.set(264, 5 + (it.f[20] | 0));
          out.anger = target.get(264) | 0;
        }
        break;
      case 'yogurt':                                  // 341197-341210
        target.set(264, (target.get(264) | 0) + R(3) + 5);
        out.anger = target.get(264) | 0;
        break;
      case 'butter':                                  // 341180-341196
        if ((target.get(177) | 0) <= 1) target.set(177, (target.get(177) | 0) + 1);
        target.set(412, (target.get(412) | 0) + 15);
        out.groom = target.get(177) | 0;
        break;
      default: break;
    }
    consumeOne(g, it);
    return out;
  }

  /** 341640-341673：普通食物命中角色 */
  function throwFoodHit(g, thrower, target, it, skill) {
    const R = (n) => (g.rng || Elona.rng).rnd(Math.max(1, n | 0));
    const canEat = (target.get(22) | 0) <= 10000
      && (target.get(251) | 0) === 0 && (target.get(256) | 0) < 60;
    if (canEat && g.eatItemNow) {
      const eat = g.eatItemNow(target, it);
      if ((it.f[0] | 0) <= 0) dropGround(g, it);
      // 341650-341671：窒息回合数先压到 10，1/8 概率噎住（玩家必定 10）
      if ((target.get(263) | 0) > 10) target.set(263, 10);
      let choked = false;
      if (R(8) === 0) {
        choked = true;
        if ((target.index | 0) !== 0 && (target.get(263) | 0) >= 10) {
          // NPC 已 >=10 时不再叠加（源码只在 <10 时写 10）
        } else {
          target.set(263, 10);
        }
      }
      return { special: false, eaten: true, eat, choked, suffocation: target.get(263) | 0 };
    }
    // 341674-341676：没吃掉 → 基于投掷技能与物品重量的无属性伤害，食物留在脚下
    const w = idiv(it.f[7] | 0, 1000);
    const dmg = limit(idiv(skill | 0, 5), 1, 200) * limit(w, 1, 500) + R(w + (skill | 0) + 1);
    if (Elona.Battle && Elona.Battle.applyDamage) {
      Elona.Battle.applyDamage(target, dmg, g, thrower, 0, 0);
    } else {
      target.hp = Math.max(0, (target.hp | 0) - dmg);
    }
    return { special: false, eaten: false, damage: dmg };
  }

  // ============================================================ 野餐篮 / 圣诞蛋糕
  /** 356280-356370 的参与者：源码 repeat 16 + 施法 619 集合同伴；本项目取同地图前 16 号友方 */
  function feastMembers(g) {
    const out = [];
    const list = (g && g.charas) || [];
    for (let i = 0; i < Math.min(16, list.length); i++) {
      const c = list[i];
      if (!c || (c.get(0) | 0) !== 1) continue;
      if (i !== 0 && (c.get(9) | 0) < 0) continue;       // 敌对目标不与玩家一起吃饭
      out.push(c);
    }
    return out;
  }

  /**
   * 使用效果 75（大型野餐篮 992）/ 100（圣诞蛋糕套餐 1106）。
   * 源码 label_2926/2928 是 20 回合的持续吃饭状态，项目没有该动画状态机，
   * 直接结算「食事を終えた」的结果段（饱腹 13000 + 潜力 / 12 月奖励）。
   */
  function feast(g, it, eff, opts) {
    const isBasket = (eff | 0) === 75;
    if (!isBasket && (eff | 0) !== 100) return null;
    const members = feastMembers(g);
    const bonus = limit(it.f[20] | 0, 0, 100);          // 加值（防御异常大的自定义物品）
    const month = g.getV65 ? (g.getV65(11) | 0) : 0;
    // 309861：游戏月份 12 **或** 现实月份 12（int(gettime(1))==12）都算圣诞
    const realMonth = (opts && opts.realMonth) || (new Date().getMonth() + 1);
    const isXmas = !isBasket && (month === 12 || realMonth === 12);
    const out = { ok: true, effect: eff | 0, members: members.length, bonus, xmas: isXmas };

    for (const c of members) {
      // 356310-356318 / 356348-356356：先清妨碍进食的状态
      if ((c.get(256) | 0) > 60) c.set(256, 59);
      c.set(251, 0);
      c.set(263, 0);
      c.set(252, 0);
      c.set(22, 13000);                                  // 309710 / 309860
      if (isBasket) {
        if (Elona.Stats && Elona.Stats.modGrowth) {
          for (let a = 10; a <= 17; a++) Elona.Stats.modGrowth(c, a, c, bonus * 4 + 5, g);
        }
      } else if (isXmas) {
        if (Elona.Stats && Elona.Stats.skillExp) {
          for (const s of [181, 16, 19]) Elona.Stats.skillExp(c, s, c, 1000, 1, 0, g);
        }
        if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, 19, 250, 1000);
      }
    }

    it.f[0] = Math.max(0, (it.f[0] | 0) - 1);
    if (isBasket && g.player && g.groundItems && Elona.ItemDB && Elona.ItemDB.createItem) {
      // 356336：使用后在脚下生成一个空的大篮子 993
      const empty = Elona.ItemDB.createItem(993, 1);
      if (empty) {
        empty.f[5] = g.player.x | 0; empty.f[6] = g.player.y | 0; empty.f[21] = -1;
        g.groundItems.push(empty);
        if (g.refreshGroundCell) g.refreshGroundCell(empty.f[5], empty.f[6]);
        out.emptyBasket = true;
      }
    }
    if (g.log) {
      g.log(isBasket ? '你把篮子里的料理摆开了，大家一起吃了个饱。'
        : '大家分吃了圣诞蛋糕。');
    }
    if (g.endTurn) g.endTurn();                        // 356324 / 356370 goto *label_3017
    return out;
  }

  // ============================================================ 呕吐 / 寄生
  /** 201653-201663：删除全部 type 3（加速成长类）buff */
  function clearGrowthBuffs(g, c) {
    if (!Elona.Status || !Elona.Status.delbuff) return 0;
    let n = 0;
    for (let s = 0; s < 16; s++) {
      const id = c.get(280 + s * 3) | 0;
      if (id === 0) break;
      if (GROWTH_BUFFS.indexOf(id) >= 0) {
        Elona.Status.delbuff(c, s);
        s--;                                             // delbuff 会压缩槽位，重新扫本槽
        n++;
      }
    }
    return n;
  }

  /** 199698-199712：元素 58（神）/52（雷）伤害杀死脑寄生虫（cbit 1045） */
  function cureBrainParasite(g, c, attr) {
    const a = attr | 0;
    if (a !== 58 && a !== 52) return null;
    const S = Elona.Status;
    if (!S || !S.cbit || !S.cbit(c, 1045)) return null;
    if (S.cbitmod) S.cbitmod(c, 1045, false);
    // 注：源码的 var_98(865-600)=0 是玩家专用能力标志数组，项目 field 265 已被
    //     「金属外套」占用（battle.js 199065），语义不同，不能照写；只清 cbit。
    if (g.log) g.log('脑髓受到冲击，脑寄生虫死掉了。');
    return { cured: true };
  }

  Elona.FoodLeft = {
    FREEZER_IDS, MAP_TYPE_RANCH, DRYROCK_INDEX, GROWTH_BUFFS, DRY_TABLE, SPECIAL_THROW,
    clockHours, mapType, weather, ensureDryrock, markDryrock, isDryrock, fridgeCell,
    fridgeCheck, dryCandidate, dryConvert, rotCheck,
    isFreezer, freezerConvert,
    specialThrowFood, throwFoodHit, consumeOne, dropGround,
    feast, feastMembers, clearGrowthBuffs, cureBrainParasite,
  };
})(window);
