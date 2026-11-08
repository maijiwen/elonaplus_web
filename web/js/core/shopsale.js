'use strict';
/**
 * 自营店日结（core/shopsale.js）—— `*label_2445`（235208-235225）/ `*label_2446`（235226-235634）
 *
 * 【源码依据】
 *   235208-235225  每天主循环里 `gosub *label_2445`（603752）：
 *                  `repeat 450-300, 300` 遍历 300..449 的地产槽，`var_132(16, cnt) == 102`（店）
 *                  就 `var_1774 = cnt ; gosub *label_2446`。
 *                  之后如果玩家**正站在自家店里**，再对当前地图调一次 `*label_2447`
 *                  （只重算访客等级 var_126(10)，本项目在 property.js 里）。
 *   235226-235236  getworker(var_1774) 找不到店番 → 「店には店番がいない。」并直接返回。
 *   235237-235248  来客数 var_1808：
 *                    `var_1807 = 100 - var_65(125)/100`（店铺评分越低越好，0..100）
 *                    `repeat 3 : var_1808 += rnd(var_1807/3 + 5)`
 *                    `var_1808 = var_1808 * (80 + var_82(17,店番)*3/2) / 100`（魅力）
 *                    下限 1。
 *   235257-235313  货架盘点：跳过金库 561 / レジ 562 / ヤカカード 1180 / 书 24 / 金币 54 /
 *                  シェルター 555 / 権利書 344 / 重量负数 / f[4]>=6（唯一物品）/ ロッド 290 /
 *                  f[32]==100（非売品）/ ibit(21)；玩家正站在店里时跳过 tile 特性 37 的格子；
 *                  经营种类 != 5（装飾家具店）时跳过类别 60000（花以外）。
 *   235314-235481  逐个来客：随机取一件 → 售价 `calcitemvalue(item,2)` ×
 *                  `(10 + sqrt(交渉*200))/100 + 10` → 品类加成 6/5 → `rnd(售价) > var_1807*100+500`
 *                  就卖不掉 → 再按经营种类掷骰（同类 1/2，异类 1/10）→ 卖出 `rnd(数量)+1` 个
 *                  （1日15品 / 5品 上限）→ 1/4 概率「物々交換」（同类别的随机物品）→ 否则记金币。
 *   235482-235505  把金币与替换来的物品写回店里（本项目写进 `site.stock`）。
 *   235506-235633  收尾：金币入金库 → `skillexp 156`（交渉）→ `var_58(439)++` →
 *                  ヤカポイント（`var_65(661)`，上限 100000）→ 卖够量 `modrank 5,30,2` →
 *                  店番「独自稼ぎ」`交渉*5 + 交渉*rnd(6)`（cbit 1022 ×3/2，12 月 ×5）。
 *
 * 【与原版的数据差异】原版把店内物品存在 `tmp\inv_<槽位>_<n>.s2`（gosub *label_2873），
 *   本项目存在 `site.stock`（见 property.js 的 stashStock / enterStock），语义等价。
 *   金库 561 在本项目只是家具，所以卖得的金币按原版 `itemcreate -1, 54` 的语义
 *   直接落在店里（可拾取），而不是累加到某个容器字段。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const SHOP_TYPE = 102;                // var_132(16) == 102 → 店
  const F_WORKER = 80;                  // var_58(80)：该角色被任命的地图 id
  const F_SOLD_TIMES = 439;             // var_58(439)：店番累计营业次数
  const SK_CHARISMA = 17;               // var_82(17)：魅力（来客数）
  const SK_NEGOTIATION = 156;           // var_82(156)：交渉（售价 / 经验 / 独自稼ぎ）
  const CBIT_EYE = 1021;                // 目利き（物々交換的成交阈值放宽）
  const CBIT_MASTER = 1022;             // 商売上手（独自稼ぎ ×1.5）
  const V_YACA = 661;                   // var_65(250+411)：ヤカポイント
  const V_SHOP_SCORE = 125;             // var_65(125)：店铺评分（0 最好）
  const ITEM_GOLD = 54;
  const ITEM_STRONGBOX = 561;
  const ITEM_REGISTER = 562;
  const ITEM_YACA_CARD = 1180;
  const CAT_DECOR = 60000;              // 装飾品类别（装飾家具店以外不卖）
  const CAT_FOOD = 57000;
  const CAT_DEED = 53000;

  /** 不进入销售池的物品 id（235264-235293） */
  const SKIP_IDS = [ITEM_STRONGBOX, ITEM_REGISTER, ITEM_YACA_CARD, 24, ITEM_GOLD, 555, 344, 290];

  /** 经营种类（var_132(13)）的显示名 */
  const GENRE_NAMES = {
    0: { jp: '何でも屋', en: 'Goods shop' },
    1: { jp: '食品店', en: 'Food shop' },
    2: { jp: '魔法店', en: 'Magic shop' },
    3: { jp: '武具店', en: 'Blacksmith' },
    4: { jp: '宿屋', en: 'Inn shop' },
    5: { jp: '装飾家具店', en: 'Decorative arts shop' },
    6: { jp: 'ジャンク屋', en: 'Junk shop' },
  };

  /** 各经营种类「本行」的物品类别（235328-235356 / 235375-235415） */
  const GENRE_CATS = {
    1: [CAT_FOOD],
    2: [53000, 54000, 56000],
    3: [10000, 24000, 25000, 12000, 16000, 20000, 19000, 18000, 22000, 14000, 32000, 34000],
    4: [72000, 52000],
    5: [80000, 60000, 60001, 60002],
    6: [64000, 62000, 59000],
  };
  /** 种类 2 还认物品 id 1064（235334），种类 3 之外的 1 处特例也记在这里 */
  const GENRE_IDS = { 2: [1064] };

  const ref = (id, f) => (Elona.ItemDB && Elona.ItemDB.ref ? (Elona.ItemDB.ref(id | 0, f) | 0) : 0);
  const itemId = (it) => (it && it.f ? (it.f[3] | 0) : 0);
  const itemCount = (it) => (it && it.f ? (it.f[0] | 0) : 0);
  const rnd = (g, n) => {
    const R = (g && g.rng) || Elona.rng;
    const m = Math.max(1, n | 0);
    return R && R.rnd ? (R.rnd(m) | 0) : 0;
  };

  // ------------------------------------------------------------------
  // 店番
  // ------------------------------------------------------------------
  /**
   * getworker(32233-32249)：在角色表里找 `var_58(80) == mapId` 的角色。
   * 原版只扫 1..15 号槽；本项目的同伴常驻 `g.party`、NPC 下标不固定，
   * 所以先按原版槽位、再扫角色池、最后扫同伴（与 ranch.getWorker 同一策略）。
   */
  function workerOf(g, mapId) {
    const id = mapId | 0;
    if (!g || id <= 0) return null;
    const from = (arr, preferSlot) => {
      let fallback = null;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        if (!c || (c.get(0) | 0) !== 1) continue;
        if ((c.get(F_WORKER) | 0) !== id) continue;
        if (!preferSlot) return c;
        if (i >= 1 && i <= 15) return c;
        if (!fallback) fallback = c;
      }
      return fallback;
    };
    return from(g.charas || [], true) || from(g.party || [], false);
  }

  /** 任命 / 卸任店番（233797 / 233761 / removeworker 32250-32259） */
  function assign(g, c, mapId) {
    if (!c) return { ok: false, message: '找不到这只角色。' };
    if ((mapId | 0) <= 0) return { ok: false, message: '这里不是店铺。' };
    // removeworker：同一地图上的旧店番先卸任
    for (const o of (g.charas || [])) {
      if (o && o !== c && (o.get(F_WORKER) | 0) === (mapId | 0)) o.set(F_WORKER, 0);
    }
    for (const o of (g.party || [])) {
      if (o && o !== c && (o.get(F_WORKER) | 0) === (mapId | 0)) o.set(F_WORKER, 0);
    }
    c.set(F_WORKER, mapId | 0);
    return { ok: true, worker: c, message: `任命 ${c.name} 为这家店的店番。` };
  }

  function unassign(g, c) {
    if (!c) return { ok: false, message: '找不到这只角色。' };
    c.set(F_WORKER, 0);
    return { ok: true, message: `${c.name} 卸下了店番的工作。` };
  }

  // ------------------------------------------------------------------
  // 货架
  // ------------------------------------------------------------------
  /** 玩家正站在这家店里时用地面物品，否则用 site.stock */
  function stockOf(g, site) {
    const cur = (Elona.Property && Elona.Property.currentSite) ? Elona.Property.currentSite(g) : null;
    if (cur && site && (cur.id | 0) === (site.id | 0)) return g.groundItems || [];
    if (!site) return [];
    if (!Array.isArray(site.stock)) site.stock = [];
    return site.stock;
  }

  /** 这一格地面能不能摆店里的商品（235300-235304：tile 特性 37 的格子算柜台） */
  function onCounter(g, it) {
    if (!g || !g.map || !Elona.MapFeat || !Elona.MapFeat.read) return false;
    const x = it.f[5] | 0, y = it.f[6] | 0;
    if (x < 0 || y < 0) return false;
    const f = Elona.MapFeat.read(g, x, y);
    return !!(f && (f.type | 0) === 37);
  }

  /** 能不能摆出来卖（235260-235312） */
  function sellable(g, site, it) {
    const id = itemId(it);
    if (!it || itemCount(it) <= 0) return false;
    if (SKIP_IDS.indexOf(id) >= 0) return false;
    if ((it.f[7] | 0) < 0) return false;                  // 重量为负
    if ((it.f[4] | 0) >= 6) return false;                 // f[4]>=6：唯一物品等
    if ((it.f[32] | 0) === 100) return false;             // 非売品标记
    if (Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(21, it)) return false;
    const genre = ((site && site.fields && (site.fields[13] | 0)) || 0);
    if (genre !== 5) {
      const cat = ref(id, 5);
      if (cat === CAT_DECOR && id !== 1061) return false;
    }
    if (onCounter(g, it)) return false;
    return true;
  }

  /** 该物品是否属于这家店的「本行」（235328-235356） */
  function matchesGenre(site, id) {
    const genre = ((site && site.fields && (site.fields[13] | 0)) || 0);
    if (!genre) return true;
    const cats = GENRE_CATS[genre] || [];
    if (cats.indexOf(ref(id, 5)) >= 0) return true;
    const ids = GENRE_IDS[genre] || [];
    return ids.indexOf(id) >= 0;
  }

  // ------------------------------------------------------------------
  // 本体
  // ------------------------------------------------------------------
  /**
   * 单家店的日结（`*label_2446`，235226-235634）。
   * @param {object} g
   * @param {number} siteId 地产槽（300..449）
   * @returns {object} 结算结果（dry=true 时不改动任何状态）
   */
  function settle(g, siteId, opts) {
    const o = opts || {};
    const dry = !!o.dry;
    const id = siteId | 0;
    const site = (Elona.Property && Elona.Property.siteOf) ? Elona.Property.siteOf(g, id) : null;
    const out = {
      ok: true, siteId: id, worker: null, visitors: 0, sold: 0, gold: 0,
      goldOwn: 0, points: 0, barters: 0, lines: [],
    };
    // messages 是 lines 的日文视图（日志/测试用）
    Object.defineProperty(out, 'messages', {
      get() { return out.lines.map((l) => l.jp); }, enumerable: true,
    });
    const worker = workerOf(g, id);
    if (!worker) {
      out.ok = false;
      out.reason = 'no-worker';
      out.lines.push({ jp: '[店]店には店番がいない。', en: "[Shop]Your shop doesn't have a shopkeeper." });
      return out;
    }
    out.worker = worker;

    // 235237-235248：来客数
    const base = 100 - idiv(g.getV65(V_SHOP_SCORE) | 0, 100);         // var_1807
    let visitors = 0;
    for (let i = 0; i < 3; i++) visitors += rnd(g, idiv(base, 3) + 5);
    visitors = idiv(visitors * (80 + idiv((worker.skill ? worker.skill(SK_CHARISMA) : 0) * 3, 2)), 100);
    if (visitors < 1) visitors = 1;
    out.visitors = visitors;

    const limitN = ((site && site.fields && (site.fields[37] | 0)) || 0);   // 0 无限制 / 1 15品 / 2 5品
    const cap = limitN === 1 ? 15 : (limitN === 2 ? 5 : 0);

    const stock = stockOf(g, site);
    const pool = stock.filter((it) => sellable(g, site, it));
    const genre = ((site && site.fields && (site.fields[13] | 0)) || 0);
    const eye = Elona.Status && Elona.Status.cbit ? (Elona.Status.cbit(worker, CBIT_EYE) ? 1 : 0) : 0;

    let soldQty = 0;       // var_1805
    let goldSum = 0;       // var_1806
    let barterCount = 0;   // var_1806(1)：用物々交換抵掉的件数（235546）
    const barters = [];    // var_484 / var_485：待补发的交换物 { cat, price }
    let points = 0;        // var_1804

    for (let v = 0; v < visitors; v++) {
      if (!pool.length) break;
      const it = pool[rnd(g, pool.length)];
      const pid = itemId(it);
      if (itemCount(it) <= 0) continue;

      // 235321-235322：售价
      let price = (Elona.ItemDB && Elona.ItemDB.calcValue)
        ? (Elona.ItemDB.calcValue(g.player, it, 2, g, { index: 0, var577: 6 }) | 0)
        : 0;
      const neg = worker.skill ? worker.skill(SK_NEGOTIATION) : 0;
      price = idiv(price * Math.trunc(10 + Math.sqrt(neg * 200)), 100) + 10;
      if (price <= 1) continue;
      // 235323-235327：var_1414（相場上限）在本项目没有对应数据源，按 0 处理
      // 235328-235356：本行商品加成 6/5
      if (matchesGenre(site, pid) && genre !== 0) price = idiv(price * 6, 5);
      // 235361：太贵卖不掉
      if (rnd(g, price) > base * 100 + 500) continue;
      // 235370-235421：经营种类的成交概率
      if (genre === 0) {
        if (rnd(g, 8) !== 0) continue;
      } else {
        if (!matchesGenre(site, pid)) {
          if (rnd(g, 5) !== 0) continue;
        }
        if (rnd(g, 2) !== 0) continue;
      }

      // 235422-235432：卖出数量
      let n = rnd(g, itemCount(it)) + 1;
      if (limitN === 1 && n + soldQty > 15) n = 15 - soldQty;
      if (limitN === 2 && n + soldQty > 5) n = 5 - soldQty;
      if (n <= 0) break;

      // 235433-235446：1198 是「名声の書」类物品，卖出直接给名声
      if (pid === 1198 && (it.f[26] | 0) === 0) {
        const fame = ((it.f[27] | 0) + 5) * n;
        if (!dry) {
          const p = g.player;
          p.set(34, (p.get(34) | 0) + fame);
        }
        out.lines.push({ jp: `${fame}の名声値を手に入れた。`, en: `You gain ${fame} fame.` });
      }

      if (!dry) it.f[0] = itemCount(it) - n;
      soldQty += n;
      const total = price * n;

      // 235450-235457：1/4 概率用物品抵账（物々交換），否则记金币
      if (rnd(g, 4) === 0) {
        barters.push({ cat: ref(pid, 5), price: total, src: pid });
      } else {
        goldSum += total;
      }

      // 235471-235480：达到上限就收摊
      if (limitN === 1 && soldQty >= 15) break;
      if (limitN === 2 && soldQty >= 5) break;
    }

    // 235506-235509：卖得的金币落进店里
    if (goldSum > 0) {
      out.gold = goldSum;
      if (!dry) addGold(g, site, stock, goldSum);
    }

    // 235510-235548：物々交換的交换物
    for (const b of barters) {
      let got = null;
      let tries = 0;
      let accepted = false;
      for (tries = 0; tries < 4; tries++) {
        const cand = makeBarter(g, b.cat);
        if (!cand) break;
        const val = cand.f[1] | 0;
        if (val > idiv(b.price * 2 * (3 + eye), 3) + 300 * eye) {
          got = cand;
          accepted = true;
          break;
        }
      }
      if (accepted && got) {
        out.barters++;
        barterCount++;                              // 235546：var_1806(1)++
        points += idiv(limit(got.f[1] | 0, 1, 500000), 1000);
        if (!dry) stock.push(got);
      } else {
        // 235540-235543：抵账失败 → 还是付金币
        goldSum += b.price;
        points += idiv(limit(b.price, 1, 500000), 1000);
        if (!dry) addGold(g, site, stock, b.price);
      }
    }
    out.gold = goldSum;

    // 235549-235553：其它来源的ヤカポイント
    points += idiv(visitors, 10);
    const month = g.getV65(11) | 0;

    // 235554-235556：站在自家店里结算时记「今天已经结过账」
    if ((g.getV65(20) | 0) === id) out.settledHere = true;

    const wname = worker.name || ('chara ' + worker.index);
    const yacaBefore = g.getV65(V_YACA) | 0;
    if (soldQty === 0) {
      // 235557-235566：一件也没卖出去（var_1812 在本项目没有对应数据源，按 0 处理）
      points = 0;
      out.lines.push({
        jp: `[店]${visitors}人が来客したが、${wname}はアイテムを一つも売れなかった。`,
        en: `[Shop]${visitors} customers visited your shop but ${wname} couldn't sell any item.`,
      });
    } else {
      // 235567-235584：卖出去了
      if (yacaBefore >= 100000) points = 0;
      let moneyText = `${goldSum} gold pieces`;
      if (barterCount > 0) moneyText += ` and ${barterCount} items`;
      out.lines.push({
        jp: `[店]${visitors}人の来客があり、${wname}は${soldQty}個のアイテムを売却した。`
          + `${moneyText} が売り上げとして金庫に保管された。そして${points}ヤカポイントを獲得した。`,
        en: `[Shop]${visitors} customers visited your shop and ${wname} sold ${soldQty} items. `
          + `${wname} put ${moneyText} in the shop strong box. You got ${points} yaca points.`,
      });

      // 235585-235586：交渉技能经验 + 营业次数
      if (!dry) {
        if (Elona.Stats && Elona.Stats.skillExp) {
          const exp = idiv(limit(Math.trunc(Math.sqrt(goldSum)) * 10, 25, 2000) * (limitN + 2), 2);
          Elona.Stats.skillExp(worker, SK_NEGOTIATION, worker.index | 0, exp, 0, 0, g);
        }
        worker.set(F_SOLD_TIMES, (worker.get(F_SOLD_TIMES) | 0) + 1);
        // 235590-235593：ヤカポイント（上限 10 万）
        g.setV65(V_YACA, Math.min(100000, yacaBefore + points));
      }
    }
    out.points = points;

    // 235595-235597：卖得够多 → 名声
    if (soldQty > idiv(110 - idiv(g.getV65(V_SHOP_SCORE) | 0, 100), 10)) {
      if (!dry && Elona.Rank && Elona.Rank.modRank) Elona.Rank.modRank(g, 5, 30, 2);
      out.rankUp = true;
    }

    // 235598-235626：店番「独自稼ぎ」
    const neg2 = worker.skill ? worker.skill(SK_NEGOTIATION) : 0;
    let own = neg2 * 5 + neg2 * rnd(g, 6);
    if ((g.getV65(20) | 0) === 54 && (g.getV65(22) | 0) === 3) own = 1;
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(worker, CBIT_MASTER)) {
      own = idiv(own * 3, 2);
    }
    out.goldOwn = own;
    let ownPts = idiv(own, 100);
    if (month === 12) ownPts *= 5;
    if ((g.getV65(V_YACA) | 0) >= 100000) ownPts = 0;
    if (!dry) {
      addGold(g, site, stock, own);
      g.setV65(V_YACA, Math.min(100000, (g.getV65(V_YACA) | 0) + ownPts));
      out.lines.push({
        jp: `[店]${wname}は独自に${own}gold稼ぎ、金庫に保管した。そして${ownPts}ヤカポイントを獲得した。`,
        // 原版这一句的英文串是复制粘贴（235620 与 235582 完全相同），这里按日文内容重写
        en: `[Shop]${wname} earned ${own} gold on the side and put it in the strong box. `
          + `You got ${ownPts} yaca points.`,
      });
    }
    out.points += ownPts;
    out.sold = soldQty;
    return out;
  }

  /** 235508：往店里放一叠金币（原版 `itemcreate -1, 54`） */
  function addGold(g, site, stock, amount) {
    if (!(amount > 0)) return null;
    let it = stock.find((x) => x && itemId(x) === ITEM_GOLD && (x.f[5] | 0) <= 0);
    if (it) {
      it.f[0] = itemCount(it) + amount;
      return it;
    }
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return null;
    it = Elona.ItemDB.createItem(ITEM_GOLD, amount);
    if (!it) return null;
    it.f[0] = amount;
    // 摆在金库里（561）所在格；没有金库就放地图中央
    const box = stock.find((x) => x && itemId(x) === ITEM_STRONGBOX);
    if (box) { it.f[5] = box.f[5] | 0; it.f[6] = box.f[6] | 0; }
    else { it.f[5] = -1; it.f[6] = -1; }
    stock.push(it);
    return it;
  }

  /**
   * 物々交換：生成一件类别为 `cat` 的随机物品（原版 235519-235520 的
   * `var_638 = 类别 ; itemcreate -1, 0`）。
   */
  function makeBarter(g, cat) {
    const I = Elona.ItemDB;
    if (!I || !I.create) return null;
    const lv = limit(1 + idiv(g.getV65(V_YACA) | 0, 2000), 1, 50);
    try {
      // var_638 = 类别（235519-235520）；var_641（品质）在这一支里没有确定来源，
      // 交给默认的 calcFixLv 掷骰，登记为差异。
      return I.create(g, { level: lv, t638: cat | 0 });
    } catch (e) {
      return null;
    }
  }

  /** `*label_2445`（235208-235225）：遍历 300..449 的所有自家店 */
  function settleAll(g, opts) {
    const res = { shops: 0, gold: 0, points: 0, messages: [] };
    const v132 = (g && g.v132) || {};
    for (let id = 300; id <= 449; id++) {
      if ((v132[String(id)] | 0) !== SHOP_TYPE) continue;
      const r = settle(g, id, opts);
      res.shops++;
      res.gold += r.gold | 0;
      res.points += r.points | 0;
      for (const m of (r.messages || [])) res.messages.push(m);
    }
    return res;
  }

  Elona.ShopSale = {
    SHOP_TYPE, GENRE_NAMES, GENRE_CATS, SKIP_IDS, V_YACA,
    workerOf, assign, unassign,
    stockOf, sellable, matchesGenre,
    settle, settleAll, addGold, makeBarter,
  };
})(typeof window !== 'undefined' ? window : global);
