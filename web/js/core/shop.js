'use strict';
/**
 * 商店系统 —— 库存生成（*label_3076，426727-427530）与买卖结算（*label_2978，341874-342330）
 *
 * 【已确认】
 *   店主角色 var_58(150)：1001 武具店 / 1004 魔法店 / 1006 雑貨屋 / 1007 黑市 / 1008 何でも屋
 *   店等级 var_58(151)；店主金币 var_58(30)
 *   库存数量：
 *     通用 40 + 店等级*2/3（上限 120）
 *     1001 → 15 + limit(等级/7,1,120)
 *     1007 → 7 + limit(等级/7,1,30)
 *   生成：calcobjlv(limit(店等级,1,200)) + calcfixlv(2)，按角色设置 var_638/639 类别过滤
 *   单格数量：var_444 = refitem(id,8)/{100,200,500,80} → count = rnd(var_444)+1
 *   买入价 calcitemvalue(item,0)，卖出价 calcitemvalue(item,1)（214124-214372）
 *   买入：玩家 var_58(30) -= 总价，店主 += 总价
 *   卖出：店主余额不足则拒绝；玩家 += 总价，店主 -= 总价；售出物品鉴定等级置 3
 *
 * 【已移植】投资 calcinvestvalue / calcinvestvalue50（214376-214424）与店等级提升（425236-425315）。
 *   盘点周期（426680-427503）：店主 var_58(153) = 店编号，var_58(154) = 下次盘点时刻（绝对小时）；
 *   到期（或首次开店）时重新生成库存，并把 var_58(154) 设为 now + 48 小时（1009 号店 168 小时）。
 *
 * 【0-FP 复核】以 2.33R 源码为准补齐买卖结算周边：
 *   212054-212058 `*label_2154` 交涉经验；342193-342213 买后店主盈余自动升规模；
 *   342214-342217 货物（92000）记录买价/买入地；342222-342234 名声之书；
 *   342241-342267 家具店卖出激活地域商店；342269-342288 盗品与盗贼公会任务；
 *   342296-342327 卖出雅卡点数活动；426764-426768 店主名声增加下次进货数；
 *   427693-427697 家具/货物价格按 100 小时播种的 ±14% 浮动；
 *   214504-214525 generatemoney（含营业天赋 cbit 1020）。
 * 【wiki 版本差异】经商页写「交易店 168 小时、其他 48 小时」，但 427500-427503 的
 *   168 小时分支是 `var_58(150)==1009`（家具店），交易店 1011 仍是 48 小时 —— 按源码。
 *   投资费用同理：源码是 (limit(规模+50,1,250)²+500)*100/(100+投资*10+同伴*2)+200，
 *   不是页面的「规模²*15+200」。
 * 【未移植】订货、食物鲜度、抢劫行商/海船的提包事件、大地图跑商事件。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  // 0-FP：买卖结算相关字段（全部来自 2.33R 源码）
  const V_YACA = 661;              // var_65(250+411)：ヤカポイント
  const V_GUILD_QUOTA = 269;       // var_65(250+19)：盗贼公会任务余额
  const V_MONTH = 11;              // var_65(11)：月（12 月雅卡 5 倍）
  const V_MAP = 20;                // var_65(20)：当前地图 id
  const SK_NEGOTIATION = 156;      // var_82(156)：交渉
  const CAT_CARGO = 92000;         // refitem(id,5)==92000：货物 / 家具
  const CBIT_ELEGANCE = 1020;      // 営業フィート「気品」：店主持金 ×7/4+2000
  const F_FAME = 34;               // var_58(34)：店主名声（也用作下次进货加成）
  const F_RANK = 151;              // var_58(151)：店规模
  const F_GOLD = 30;               // var_58(30)：持金

  const ROLE_NAMES = {
    1000: '武具店', 1001: '武具店', 1002: '道具店', 1003: '面包房', 1004: '魔法店',
    1005: '旅店', 1006: '杂货店', 1007: '黑市', 1008: '万事屋', 1009: '家具店',
    1010: '行商', 1011: '交易店', 1012: '纪念品店', 1013: '电子巨蛋商人',
    1014: '钓饵店', 1015: '见世物屋', 1016: '精灵球屋', 1017: '染料店',
    1018: '杂货商', 1019: '妹妹的店', 1020: '魔術士ギルド書店', 1021: '盗贼店',
    1022: '祭典摊', 1023: '宝具商', 1024: '小摊', 1026: '船商', 2003: '商人',
  };
  /** 0-DH+：原版 415133 的判定是 var_58(150) ∈ [1000,2000) 或 2003 —— 全部按店主处理 */
  const SHOP_ROLES = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009,
    1010, 1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022,
    1023, 1024, 1026, 2003];

  // 原版 222064-222101 的特殊商店物品池
  const CAT_645 = [10000, 10000, 24000, 24000, 25000, 12000, 16000, 20000, 19000, 18000, 22000, 14000, 32000, 34000];
  const POOL_1547 = [344, 521, 522, 542, 543, 555, 572, 1296, 1190, 1189, 1188, 1187, 1281, 1280, 1279, 1278, 1277, 1276];
  const POOL_1543 = [934, 1132, 1131, 1070, 1069, 1005];
  /** 精灵球屋固定货架（427228-427305） */
  const PETSHOP_IDS = [430, 431, 502, 480, 421, 603, 615, 559, 516, 616, 623, 505,
    624, 625, 626, 627, 56, 742, 760, 892, 1037, 1186, 1113, 1310, 1311];
  /** 宝具商固定货架（427307-427371） */
  const TREASURE_IDS = [799, 427, 425, 426, 424, 423, 422, 809, 1121, 811, 1135,
    1049, 847, 707, 816, 655, 662, 639, 1185, 1301];
  /** 纪念品店固定货架（427166-427223） */
  const SOUVENIR_IDS = [510, 561, 562, 547, 579, 576, 611, 701, 921, 1174, 1180, 413, 414, 616, 1084, 1085];

  /**
   * 家具价格百分比 var_548(0..8) —— *label_3078（427554-427700）。
   * 只在 1009 家具店开店时按当前城镇初始化；其余店铺按 100%（calcValue 内 var_548==0 → 100）。
   * 索引 = 家具子类型 var_99(25)。
   */
  const FURNITURE_PRICES = {
    vernis: [110, 60, 80, 75, 100, 100, 180, 170, 150],
    kapul: [60, 120, 130, 100, 150, 60, 190, 180, 100],
    palmia: [140, 85, 130, 100, 130, 100, 160, 70, 100],
    yowyn: [160, 100, 80, 60, 100, 100, 170, 105, 100],
    rogueden: [70, 100, 60, 50, 100, 140, 170, 135, 100],
    noyel: [160, 165, 145, 150, 100, 150, 60, 140, 100],
    lumiest: [150, 150, 140, 120, 100, 140, 130, 50, 160],
    eirel: [150, 60, 140, 130, 100, 100, 90, 150, 100],
    melkawn1: [130, 80, 80, 100, 80, 140, 130, 80, 100],
  };
  /** 家具/货物店：取当前城镇的「基准」价格百分比（427554-427692，不含相场浮动） */
  function furniturePct(g, it) {
    const name = g && g.map ? String(g.map.name || '').toLowerCase() : '';
    const table = FURNITURE_PRICES[name];
    if (!table) return 100;
    const idx = limit(it && it.f ? (it.f[25] | 0) : 0, 0, 8);
    return table[idx] || 100;
  }

  /**
   * 427693-427697：`randomize(now \ 100)` 之后 `repeat 10 : var_548(cnt) += rnd(15)-rnd(15)`。
   * 原版换的是全局 RNG 种子；网页版不能污染 g.rng（会打乱掉落/战斗的随机序列），
   * 所以用「绝对小时 / 100」做种子的独立 LCG：全城镇共享、每 100 小时重掷一次，
   * 同一时刻多次调用结果一致。HSP 的 randomize 算法不同，数值会有差异，登记为 A468。
   */
  function furnitureDrift(g) {
    const now = (g && g.nowHours) ? (g.nowHours() | 0) : 0;
    let s = (Math.imul(idiv(now, 100) | 0, 2654435761) ^ 0x9e3779b9) >>> 0;
    const d = [];
    for (let i = 0; i < 10; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const a = s % 15;
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d.push(a - (s % 15));
    }
    return d;
  }

  /** 实际生效的价格百分比 = 城镇基准 + 相场浮动（下限 1%） */
  function furniturePctLive(g, it) {
    const idx = limit(it && it.f ? (it.f[25] | 0) : 0, 0, 9);
    return Math.max(1, furniturePct(g, it) + (furnitureDrift(g)[idx] | 0));
  }

  function roleOf(keeper) { return keeper ? (keeper.get(150) | 0) : 0; }
  function isShopkeeper(c) { return !!c && SHOP_ROLES.indexOf(roleOf(c)) >= 0; }
  function roleName(role) { return ROLE_NAMES[role] || ('商店 ' + role); }

  /** 库存件数（426732-426762） */
  function stockSize(role, rank, g) {
    const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
    let n = 40 + idiv(rank * 2, 3);
    if (n > 120) n = 120;
    if (role === 1007) n = 7 + limit(idiv(rank, 7), 1, 30);
    if (role === 1001) n = 15 + limit(idiv(rank, 7), 1, 120);
    if (role === 1010 || role === 1026 || role === 2003) n = 6 + R(4);
    if (role === 1016) n = 25;
    if (role === 1018) n = idiv(n, 2);
    if (role === 1023) n = 20;
    if (role === 1024) n = idiv(n, 4);
    return Math.max(1, n);
  }

  /**
   * 物品标签串 `var_542(id)`（427391-427398 读 `/neg/`、`/noshop/`；427057 用 `fltn "sf"`）。
   * 本项目把源码的 var_542 存在 items.json 的 `mode2.var_1009`（与 91529 的 1180 同源）。
   */
  function itemTag(id) {
    const DB = Elona.ItemDB;
    if (!DB || !DB.data) return '';
    const e = DB.data[String(id | 0)] || DB.data[id | 0];
    if (!e) return '';
    const t = e.mode2 && e.mode2.var_1009;
    return t ? String(t) : '';
  }

  /** `/sf/` 池（交易店 1011 的 `fltn "sf"`）：按类别筛出带该标签的 id */
  function sfCandidates(cat) {
    const DB = Elona.ItemDB;
    if (!DB || !DB.data) return [];
    if (!sfCandidates.cache) sfCandidates.cache = {};
    const key = cat | 0;
    if (sfCandidates.cache[key]) return sfCandidates.cache[key];
    const out = [];
    for (const k in DB.data) {
      const id = parseInt(k, 10);
      if ((DB.ref(id, 5) | 0) !== key) continue;
      if (itemTag(id).indexOf('/sf/') < 0) continue;
      out.push(id);
    }
    sfCandidates.cache[key] = out;
    return out;
  }

  /** 单格数量 var_444（label_3077 427505-427553） */
  function stackCount(id) {
    const cat = Elona.ItemDB.ref(id, 5);
    const stack = Elona.ItemDB.ref(id, 8) || 0;
    let q = 1;
    if (stack > 100) {
      if (cat === 57000) q = 1;
      else if (cat === 92000) q = idiv(stack, 200);
      else if (cat >= 90000) q = idiv(stack, 100);
      else if (cat === 52000 || cat === 53000) q = idiv(stack, 100);
      else if (cat === 60000) q = idiv(stack, 200);
      else if (cat === 64000) q = idiv(stack, 80);
      else if (cat === 59000) q = idiv(stack, 500);
    }
    return Math.max(1, q);
  }

  /** 魔法书（法术书）物品 id —— 反查 ItemUse 的 spell 字段（54000 类） */
  function bookIdForSpell(spellId) {
    const DB = Elona.ItemDB;
    if (!DB || !DB.data || !Elona.ItemUse) return 0;
    if (!bookIdForSpell.cache) bookIdForSpell.cache = {};
    const c = bookIdForSpell.cache;
    if (c[spellId] !== undefined) return c[spellId];
    let found = 0;
    for (const key in DB.data) {
      const id = parseInt(key, 10);
      if (DB.ref(id, 5) !== 54000) continue;
      const e = Elona.ItemUse.entryOf(id, 13);
      if (e && (e.spell | 0) === (spellId | 0)) { found = id; break; }
    }
    c[spellId] = found;
    return found;
  }

  /**
   * 本店本格要生成什么 —— *label_3076 的 role 分支（426773-427371）。
   * @returns {{t638:number,t639:number,itemId:number,fix:number|null,skip:boolean}}
   */
  function pickCategory(role, keeper, g, cnt) {
    const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
    let t638 = 0, t639 = 0, itemId = 0, fix = null;
    const npcId = keeper ? (keeper.get(27) | 0) : 0;
    switch (role) {
      case 1004: {                                     // 魔法店（426773-426790）
        const r = R(3);
        if (r === 0) t639 = 52001;
        if (r === 1) t638 = 53000;
        if (r === 2) t638 = 52000;
        if (R(7) === 0) t638 = 54000;
        if (R(15) === 0) t638 = 55000;
        break;
      }
      case 1015: {                                     // 魔法书店（426807-426823）
        const r = R(3);
        if (r === 0) t638 = 59000;
        if (r === 1) t638 = 32000;
        if (r === 2) t638 = 34000;
        if (R(3) === 0) fix = 3;
        if (R(10) === 0) fix = 4;
        break;
      }
      case 1006: {                                     // 杂货店（426825-426878）
        const r = R(5);
        if (r === 0) t638 = 25000;
        if (r === 1) t638 = 60000;
        if (r === 2) t638 = 20000;
        if (r === 3) t638 = 77000;
        if (r === 4) t638 = 59000;
        if (R(20) === 0) itemId = 734;
        if (R(8) === 0) t638 = 91000;
        if (R(5) === 0) itemId = POOL_1547[R(POOL_1547.length)];
        if (R(20) === 0) itemId = 1134;
        const mon = g && g.getV65 ? (g.getV65(11) | 0) : 0;
        const day = g && g.getV65 ? (g.getV65(12) | 0) : 0;
        if (mon === 2 && R(2) === 0) itemId = 907;
        if (mon === 12) {
          if (day <= 25) { if (R(2) === 0) itemId = 1106; }
          else if (R(20) === 0) itemId = 1106;
        }
        if (cnt === 1 && R(4) !== 0) itemId = 685;
        break;
      }
      case 1003: {                                     // 面包房（426879-426885）
        t639 = R(3) !== 0 ? 57001 : 57002;
        break;
      }
      case 1002: {                                     // 染料店（426887-426909）
        if (npcId !== 534) { if (R(3) !== 0) return { skip: true }; }
        else if (R(5) !== 0) return { skip: true };
        t638 = 57000;
        if (R(5) === 0) t638 = 91000;
        if (npcId === 534) {
          if (R(5) === 0) itemId = 910;
          if (R(10) === 0) itemId = 520;
        }
        break;
      }
      case 1007:                                       // 黑市（426911-426917）
      case 1010:
      case 2003: {                                     // 行商（426918-426924）
        t638 = CAT_645[R(CAT_645.length)];
        fix = 3;
        if (role === 1007) {
          if (R(limit(idiv(keeper.get(151) | 0, 10), 1, 400) + 200) > R(1000)) fix = 4;
        } else if (R(2) === 0) fix = 4;
        break;
      }
      case 1005: {                                     // 旅店（426925-426950）
        if (npcId === 949) {
          t638 = 54000;
          if (R(2) === 0) t639 = 52002;
        } else {
          t638 = 91000;
        }
        if (npcId !== 950 && R(4)) t639 = 52002;
        if (npcId !== 949 && npcId !== 950) {
          if (R(10) === 0) itemId = 734;
          if (R(30) === 0) itemId = POOL_1543[R(POOL_1543.length)];
        }
        break;
      }
      case 1026: {                                     // 船商（426951-426961）
        t638 = 91000;
        if (R(3) === 0) t638 = 52000;
        if (R(3) === 0) t638 = 57000;
        if (R(10) === 0) itemId = POOL_1543[R(POOL_1543.length)];
        break;
      }
      case 1008: {                                     // 万事屋（426963-426992）
        t638 = 56000;
        if (R(3) === 0) t638 = CAT_645[R(CAT_645.length)];
        if (R(3) === 0) t638 = 60000;
        if (R(5) === 0) t638 = 57000;
        if (R(4) === 0) t638 = 53000;
        if (R(15) === 0) t638 = 55000;
        if (R(10) === 0) t638 = 91000;
        if (R(5) === 0) itemId = POOL_1547[R(POOL_1547.length)];
        if (R(20) === 0) itemId = 1134;
        if (R(15) === 0) itemId = 511;
        break;
      }
      case 1000:
      case 1001: {                                     // 武具店（426993-427024）
        if (R(limit(keeper.get(151) | 0, 1, 1000) + 200) > R(1000)) fix = 3;
        const r = R(6);
        t638 = [16000, 12000, 22000, 18000, 14000, 19000][r];
        if (R(3) === 0) t638 = R(3) === 0 ? 10000 : 24000;
        break;
      }
      case 1009: {                                     // 家具店（427025-427036）
        if (npcId !== 950) t638 = 92000;
        else itemId = R(2) === 0 ? 1117 : 1118;
        break;
      }
      case 1021: {                                     // 杂耍商人（427038-427045）
        t638 = 59000;
        if (R(2) === 0) itemId = 636;
        if (R(2) === 0) itemId = 629;
        break;
      }
      case 1011: {                                     // 交易店（427047-427057）
        if (R(4) === 0) t638 = 24000;
        if (R(5) === 0) t638 = 25000;
        if (R(3) === 0) t638 = 57000;
        break;
      }
      case 1013: {                                     // 电子巨蛋（427059-427078）
        if (R(2) !== 0) return { skip: true };
        t638 = 55000;
        if (R(2) === 0) itemId = POOL_1547[R(POOL_1547.length)];
        if (R(5) === 0) itemId = 1134;
        if (R(5) === 0) itemId = 511;
        if (R(5) === 0) itemId = 897;
        if (R(15) === 0) itemId = 712;
        break;
      }
      case 1018: {                                     // 盗贼店（427080-427093）
        if (R(20) === 0) itemId = 869;
        if (R(100) === 0) itemId = 1309;
        if (cnt === 0) itemId = 430;
        if (cnt === 1) itemId = 287;
        break;
      }
      case 1022: {                                     // 祭典摊（427095-427159）
        if (R(12) === 0) itemId = 750;
        if (R(12) === 0) itemId = 751;
        if (R(5) === 0) itemId = 770;
        if (R(5) === 0) itemId = 867;
        break;
      }
      case 1024: itemId = 685; break;                  // 小摊（427160）
      case 1017: itemId = 519; break;                  // 妹妹的店（427163）
      case 1012: {                                     // 纪念品店（427166-427223）
        t638 = 60000;
        if (npcId !== 950) {
          if (cnt < SOUVENIR_IDS.length) itemId = SOUVENIR_IDS[cnt];
          else if (R(3) !== 0) return { skip: true };
        }
        break;
      }
      case 1014: itemId = 617; break;                  // 鱼店（427224）
      case 1016: {                                     // 精灵球店（427227-427305）
        if (cnt >= PETSHOP_IDS.length) return { skip: true };
        itemId = PETSHOP_IDS[cnt];
        break;
      }
      case 1023: {                                     // 宝具商（427307-427371）
        if (cnt >= TREASURE_IDS.length) return { skip: true };
        itemId = TREASURE_IDS[cnt];
        break;
      }
      case 1019: itemId = 667; break;                  // 染料商（426791-426792）
      case 1020: {                                     // 魔術士ギルド書店（426794-426806）
        // 426795-426805：只从「已预约」（var_498(2) > 1）的书里抽，抽不到就空着这一格；
        //   旧实现退化成「已解读过的书随机」是偏差，已按源码修正（0-FQ）。
        const reserved = (g && g.reservedBooks) || [];
        if (!reserved.length) return { skip: true };
        itemId = bookIdForSpell(reserved[R(reserved.length)]);
        if (!itemId) return { skip: true };
        break;
      }
      default:
        t638 = 0;                                      // 原版：未定义 → itemcreate(-1) 随机
        break;
    }
    // 427057 `fltn "sf"`：交易店只从 /sf/ 标签里取货（2.33R 的「交易店」是科幻/现代品店，
    // 不是 wiki 老版本说的跑商货物店）。池为空时这一格作废。
    if (role === 1011 && !itemId && t638) {
      const pool = sfCandidates(t638);
      if (!pool.length) return { skip: true };
      itemId = pool[R(pool.length)];
    }
    return { t638, t639, itemId, fix, skip: false };
  }

  /** 生成一批库存（*label_3076）。stock 存在 keeper.inv 中 */
  function restock(g, keeper) {
    const role = roleOf(keeper);
    const rank = limit(keeper.get(151) | 0, 1, 1000);
    const R = (n) => ((g && g.rng) || Elona.rng).rnd(n);
    keeper.inv = [];
    let n = stockSize(role, rank, g);
    // 426764-426768：店主名声（家具店卖出会累积）在本次盘点换算成额外进货次数，
    // 上限 +20，随后清零。342241-342267 的「地域の店が活性化」写的就是这个字段。
    const fame = keeper.get(F_FAME) | 0;
    const noFame = [1026, 1010, 2003, 1023, 1024].indexOf(role) >= 0;
    if (fame > 0 && !noFame) {
      n += limit(idiv(fame, 3000), 0, 20);
      keeper.set(F_FAME, 0);
    }
    // 426770 的 repeat 在生成内可能 continue（跳过格子），因此按 n 次尝试
    for (let i = 0; i < n; i++) {
      const cat = pickCategory(role, keeper, g, i);
      if (cat.skip) continue;
      const level = Elona.ItemDB.calcObjLv(limit(rank, 1, 200), g);
      let fix = cat.fix === null ? Elona.ItemDB.calcFixLv(2, g) : cat.fix;
      const it = Elona.ItemDB.create(g, {
        level, fix, t638: cat.t638, t639: cat.t639,
        itemId: cat.itemId || -1,
      });
      if (!it || !it.id) continue;
      it.f[8] = 3;                               // 店内商品已鉴定
      it.eqSlot = -1;
      it.f[17] = it.f[17] || 0;
      // 精灵球屋 / 宝具商：固定 1 个、无诅咒。源码在 427377/427385 就 continue，
      // 位于 427390 的标签检查之前，所以这两类店不受 /neg/、/noshop/ 影响。
      if (role === 1016) {
        it.f[0] = 1; it.f[17] = 0;
        if (it.id === 480) it.f[9] = 4;
        keeper.inv.push(it);
        continue;
      }
      if (role === 1023) { it.f[0] = 1; it.f[17] = 0; keeper.inv.push(it); continue; }
      // 427390-427402：`/neg/` 永不上架；`/noshop/` 只有 1018 杂货商能进
      const tag = itemTag(it.id);
      if (tag.indexOf('/neg/') >= 0) continue;
      if (tag.indexOf('/noshop/') >= 0 && role !== 1018) continue;
      if (it.f[17] === -1 || it.f[17] === -2) continue;   // 427438-427440：诅咒品不上架
      // 427546-427547：734（魔法书？）的数量走 rnd(8)，var_444 为 0 时按 1 处理
      let cnt = it.id === 734 ? R(8) : R(stackCount(it.id)) + 1;
      if (it.f[17] === 1) cnt = 1;               // 427442-427444
      it.f[0] = Math.max(1, cnt);
      // 427408-427411：面包房的数量规则
      if (role === 1003 && R(5) <= 2) {
        it.f[0] = Math.max(1, limit(idiv(R(rank + 1), 30) + 1, 1, 3) + R(2));
      }
      // 427413-427435：家具店价格百分比（含相场浮动）影响进货量
      if (role === 1009) {
        const pct = furniturePctLive(g, it);
        if (pct <= 70) it.f[0] = idiv(it.f[0] * 200, 100);
        if (pct <= 50) it.f[0] = idiv(it.f[0] * 200, 100);
        if (pct >= 80) {
          it.f[0] = idiv(it.f[0], 2) + 1;
          if (R(2)) continue;
        }
        if (pct >= 100) {
          it.f[0] = idiv(it.f[0], 2) + 1;
          if (R(3)) continue;
        }
        it.f[0] = idiv(it.f[0] * (100 + rank), 75) + 1;
      }
      // 427445-427456：类别例外 —— 52000 的 516 不上架；57000 的 58500（药草）4/5 进货失败
      const cat5 = Elona.ItemDB.ref(it.id, 5) | 0;
      if (cat5 === 52000 && (it.id | 0) === 516) continue;
      if (cat5 === 57000 && (Elona.ItemDB.ref(it.id, 9) | 0) === 58500 && R(5)) {
        it.f[0] = 0;                                       // 427450-427456：药草 4/5 进货失败
        continue;
      }
      // 427457-427498：各店种的价格 / 数量修正
      const month = g.getV65 ? (g.getV65(11) | 0) : 0;
      const day = g.getV65 ? (g.getV65(12) | 0) : 0;
      if (role === 1018) {                                   // 杂货商：×50（729 ×10）
        it.f[1] = limit(it.f[1] | 0, 1, 1000000) * 50;
        if ((it.id | 0) === 729) it.f[1] *= 10;
      }
      if (role === 1026) it.f[0] *= 10;                      // 船商：数量 ×10
      if ((it.id | 0) === 1106 && (month !== 12 || day > 25)) it.f[1] = idiv(it.f[1] | 0, 2);
      if (role === 1015) it.f[1] *= 2;                       // 魔法书店
      if (role === 1007) it.f[1] *= (g.getV65 && (g.getV65(265) | 0) !== 0) ? 2 : 3;   // 黑市
      if (role === 1010) it.f[1] *= 2;                       // 行商
      if (role === 2003) it.f[1] = idiv((it.f[1] | 0) * 4, 5);          // 商人
      if (role === 1020) {                                   // 魔術士ギルド書店
        it.f[1] = idiv((it.f[1] | 0) * 3, 4);
        if (g.getV65 && (g.getV65(20) | 0) === 72) it.f[1] *= 20;
      }
      if (role === 1024) it.f[1] *= 2;                       // 小摊
      keeper.inv.push(it);
    }
    keeper.set(84, keeper.inv.length + 50);              // 426763 / 427372
    const nowH = (g && g.nowHours) ? g.nowHours() : 0;
    keeper.set(154, nowH + (role === 1009 ? 168 : 48));
    // 365705-365709：盘点完成 → 店主有「可处理的废药水瓶塞」（cbit 974）
    //   玩家在魔法店（var_58(150) == 1004）选「希望分给药水塞。」时，421806 会按
    //   `5 + limit(店等级,1,200)/10` 给出瓶塞并清掉这一位。
    const isShop = (role >= 1000 && role < 2000) || role === 2003;
    if (isShop && Elona.Status && Elona.Status.cbitmod) {
      Elona.Status.cbitmod(keeper, 974, true);
    }
    return keeper.inv.length;
  }

  /** 是否需要盘点（426680-426695）：首次开店，或已到 var_58(154) 的时刻 */
  function needsRestock(g, keeper) {
    if (!keeper.inv || !keeper.inv.length) return true;
    const next = keeper.get(154) | 0;
    if (!next) return true;
    return (g.nowHours ? g.nowHours() : 0) >= next;
  }

  /**
   * 投资价格 —— calcinvestvalue（214376-214398） / calcinvestvalue50（214399-214424）。
   * 同伴的投資技能（var_82(160)）在 7 格内且有视线时提供折扣。
   * @param {number} times 1 = 小额投资, 20 = 50 规模（源码重复 20 次同值求和）
   */
  function investValue(g, keeper, player, times) {
    const rank = keeper.get(151) | 0;
    let support = 0;
    const pskill = player.skill(160);
    for (let i = 1; i < 16; i++) {
      const c = g.charas && g.charas[i];
      if (!c || c.get(0) !== 1 || c.get(9) !== 10) continue;
      if ((c.skill(160) | 0) <= 0) continue;
      if (Elona.Battle && Elona.Battle.dist(player.x, player.y, c.x, c.y) > 7) continue;
      if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, player.x, player.y, c.x, c.y)) continue;
      support += limit(c.skill(160), 0, pskill);
    }
    let base = limit(rank + 50, 1, 250);
    base = base * base + 500;
    if (base > 500000) base = 500000;
    const one = idiv(base * 100, 100 + pskill * 10 + support * 2) + 200;
    return one * (times || 1);
  }

  /**
   * 投资 —— *label_3066（425236-425315）。
   * kind=1：店等级 +2+rnd(2)；kind=2：+50。投资技能经验按基础值增加。
   * 【简化】投资后立即重新进货，使等级效果可见（原版在下一次盘点生效）。
   */
  function invest(g, keeper, player, kind) {
    if (!keeper) return { ok: false, reason: 'no-keeper' };
    const times = kind === 2 ? 20 : 1;
    const cost = investValue(g, keeper, player, times);
    if ((player.get(30) | 0) < cost) return { ok: false, reason: 'money', cost };
    const rankBefore = keeper.get(151) | 0;
    let base = limit(rankBefore + 50, 1, 250);
    base = base * base + 500;
    if (base > 500000) base = 500000;
    player.set(30, player.get(30) - cost);
    if (kind === 2) {
      keeper.set(151, limit(rankBefore + 50, 0, 2000));
      if (Elona.Stats && Elona.Stats.skillExp) {
        Elona.Stats.skillExp(player, 160, player.index, idiv(base * 20, 100), 0, 0, g);
      }
    } else {
      keeper.set(151, limit(rankBefore + 2 + g.rng.rnd(2), 0, 2000));
      if (Elona.Stats && Elona.Stats.skillExp) {
        Elona.Stats.skillExp(player, 160, player.index, idiv(base, 100), 0, 0, g);
      }
    }
    restock(g, keeper);
    return { ok: true, cost, rank: keeper.get(151) };
  }

  function cloneItem(it, count) {
    const c = Elona.Item.fromJSON(JSON.parse(JSON.stringify(it.toJSON())));
    c.f[0] = count;
    c.eqSlot = -1;
    return c;
  }

  function addToInv(c, it, g) {
    let slot = -1;
    for (let k = 0; k < c.inv.length; k++) {
      if (!c.inv[k] || (c.inv[k].f[0] | 0) <= 0) { slot = k; break; }
    }
    if (slot === -1) c.inv.push(it); else c.inv[slot] = it;
    const idx = (slot === -1 ? c.inv.length - 1 : slot);
    if (Elona.ItemDB) Elona.ItemDB.stack(c, idx);
    // 0-BZ：唯一物品重复 → 化为星尘（convertartifact 222003；原版 298885/299131 在交易入包处调用）
    if (Elona.ItemDB && Elona.ItemDB.convertArtifact) {
      const conv = Elona.ItemDB.convertArtifact(c, idx);
      if (conv && g && g.log) g.log(`${conv.name} 化成了星尘。`);
    }
    return it;
  }

  /** 打开商店（生成/复用库存） */
  function open(g, keeper) {
    if (!keeper) return null;
    // 426680-426688：首次开店 → 分配店编号并生成库存
    if (!(keeper.get(153) | 0)) {
      const role = roleOf(keeper);
      if (role === 1026 || role === 1010 || role === 2003) keeper.set(153, 1);
      else {
        keeper.set(153, (g.getV65(16) | 0) + 1);
        g.setV65(16, (g.getV65(16) | 0) + 1);
      }
      // 214504-214525：首次对话补足持金（源码在 NPC 生成时调用；城镇 NPC 由 town_npcs
      // 直接建，缺这一步 → 玩家卖东西永远「店主没钱」）。用独立 RNG，避免打乱全局序列。
      if (isShopkeeper(keeper) && (keeper.get(F_GOLD) | 0) <= 0) {
        const seed = Math.imul(((g.nowHours ? g.nowHours() : 0) ^ 0x9e3779b9), 31)
          + (keeper.index | 0) + 1;
        generateMoney(g, keeper, localRng(seed));
      }
    }
    if (needsRestock(g, keeper)) restock(g, keeper);
    const session = { keeper, role: roleOf(keeper), rank: keeper.get(151), stock: keeper.inv };
    g.shopSession = session;
    return session;
  }

  function close(g) { g.shopSession = null; }

  // ------------------------------------------------------------------
  // 0-FP：*label_2978 买卖结算的周边配套（341874-342330）
  // ------------------------------------------------------------------

  /**
   * 212054-212058 `*label_2154`：买卖成功后给交涉（156）经验。
   * 342350-342352 在每次交易末尾设 `var_1362 = 交易总额` 后调用。
   * 源码门槛 `limit((交渉+10)², 1, 15000)`；经验 `limit(总额/(limit(交渉,1,100)+10),10,300)`。
   */
  function negotiationExp(g, actorIdx, amount) {
    const S = Elona.Stats;
    if (!S || !S.skillExp || !g) return 0;
    const idx = actorIdx | 0;
    const c = idx === 0 ? g.player : ((g.charas || [])[idx] || null);
    if (!c || !c.skill) return 0;
    const lv = c.skill(SK_NEGOTIATION) | 0;
    const gate = limit((lv + 10) * (lv + 10), 1, 15000);
    if ((amount | 0) < gate) return 0;
    const exp = limit(idiv(amount | 0, limit(lv, 1, 100) + 10), 10, 300);
    S.skillExp(c, SK_NEGOTIATION, idx, exp, 10, 0, g);
    return exp;
  }

  /** 214374 `calcinvestnpc()` = (limit(规模+50,1,250)² + 500) / 3 */
  function calcinvestnpc(keeper) {
    const r = limit((keeper.get(F_RANK) | 0) + 50, 1, 250);
    return idiv(r * r + 500, 3);
  }

  /**
   * 342193-342213：买入后店主持金超过阈值时，店主自己把盈余「再投资」提升规模。
   * 每次 `var_58(151) += 3` 并扣掉 calcinvestnpc()，最多循环 200 次。
   * 行商 1010 / 船商 1026 不做（源码只排除这两个）。
   */
  function autoInvestFromSales(g, keeper) {
    const role = roleOf(keeper);
    if (role === 1026 || role === 1010) return 0;
    let up = 0;
    for (let i = 0; i < 200; i++) {
      const cost = calcinvestnpc(keeper);
      const threshold = cost + 1750 + limit(keeper.get(F_RANK) | 0, 10, 200) * 125;
      if ((keeper.get(F_GOLD) | 0) < threshold) break;
      keeper.set(F_GOLD, (keeper.get(F_GOLD) | 0) - cost);
      keeper.set(F_RANK, (keeper.get(F_RANK) | 0) + 3);
      up += 3;
    }
    return up;
  }

  /**
   * 342214-342217：货物（类别 92000）买入时把「仕入れ値」写进 f[26]、
   * 买入地点写进 f[27]；31217-31221 的物品名后缀会读 f[26]。
   * 342242 也用 f[27] 判断是不是从别的城镇贩来的（家具店地域活性化）。
   */
  function recordBuyPrice(g, it) {
    if (!it || !it.f || !Elona.ItemDB || !Elona.ItemDB.ref) return false;
    if ((Elona.ItemDB.ref(it.id | 0, 5) | 0) !== CAT_CARGO) return false;
    it.f[26] = unitPrice(g, it, 0) | 0;
    it.f[27] = g.getV65 ? (g.getV65(V_MAP) | 0) : 0;
    return true;
  }

  /**
   * 342222-342288：卖出时的三种附加效果。
   *  · 1198 名声之书（f[26]==0）→ 名声 (f[27]+5)*数量，并置 f[26]=1
   *  · 盗品 ibit(9) → 清标记，扣盗贼公会任务余额 var_65(269)
   *  · 家具店 1009 且货物不是本地买入 → 全场店主 var_58(34) += 售价（上限 60000）
   */
  function saleSideEffects(g, keeper, it, total, count) {
    const out = { fame: 0, stolen: false, quota: null, revitalized: 0 };
    const I = Elona.ItemDB;
    const p = g.player;
    const id = it.id !== undefined ? (it.id | 0) : ((it.f && it.f[3]) | 0);
    if (id === 1198 && (it.f[26] | 0) === 0) {
      const fame = ((it.f[27] | 0) + 5) * (count | 0);
      if (p) p.set(34, (p.get(34) | 0) + fame);
      it.f[26] = 1;
      out.fame = fame;
    }
    if (I && I.ibit && I.ibit(9, it)) {
      out.stolen = true;
      if (I.ibitmod) I.ibitmod(9, it, 0);
      const q = g.getV65 ? (g.getV65(V_GUILD_QUOTA) | 0) : 0;
      if (q > 0) {
        const left = Math.max(0, q - (total | 0));
        if (g.setV65) g.setV65(V_GUILD_QUOTA, left);
        out.quota = left;
      }
    }
    const role = roleOf(keeper);
    const mapId = g.getV65 ? (g.getV65(V_MAP) | 0) : 0;
    if (role === 1009 && (it.f[27] | 0) !== mapId) {
      let bump = 0;
      for (const c of (g.charas || [])) {
        if (!c || (c.get(0) | 0) !== 1) continue;
        const cr = c.get(150) | 0;
        if (cr === 1009) continue;
        if (!((cr >= 1000 && cr < 2000) || cr === 2003)) continue;
        c.set(F_FAME, Math.min(60000, (c.get(F_FAME) | 0) + (total | 0)));
        bump = idiv(c.get(F_FAME) | 0, 3000);   // 342255：源码是循环内覆盖赋值
      }
      out.revitalized = bump;
    }
    return out;
  }

  /**
   * 342296-342327：卖出后「店のキャンペーン対象」的雅卡点数。
   * 次数 = limit(总额 / limit(5000 - sqrt(规模+1)*20, 3000, 5000), 0, 10)；
   * 每次 rnd((3000-(sqrt(规模+1)+1000))/200)==0 得 1 点，12 月额外 +4；
   * 上限 100000（到顶后本次归零）。
   */
  function yacaCampaign(g, keeper, total) {
    const rank = keeper.get(F_RANK) | 0;
    const root = Math.trunc(Math.sqrt(rank + 1));
    const div = limit(5000 - root * 20, 3000, 5000);
    let reps = limit(idiv(total | 0, div), 0, 10);
    const denom = idiv(3000 - (root + 1000), 200);
    const R = (n) => ((g && g.rng) || Elona.rng).rnd(Math.max(1, n | 0));
    const dec = (g.getV65 ? (g.getV65(V_MONTH) | 0) : 0) === 12;
    let pts = 0;
    for (let i = 0; i < reps; i++) {
      if (R(denom) === 0) pts += dec ? 5 : 1;
    }
    const cur = g.getV65 ? (g.getV65(V_YACA) | 0) : 0;
    if (cur >= 100000) pts = 0;
    if (pts > 0 && g.setV65) g.setV65(V_YACA, Math.min(100000, cur + pts));
    return pts;
  }

  /** 独立 LCG：持金补足不能消耗 g.rng，否则会改变商店盘点/掉落的随机序列 */
  function localRng(seed) {
    let s = ((seed | 0) >>> 0) || 1;
    return {
      rnd(n) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s % Math.max(1, n | 0);
      },
    };
  }

  /**
   * 214504-214525 `generatemoney`：地图更新时补足店主持金（低于 A/2 才补到 A）。
   * 214512-214521：当前地图是自家店、店番有营业天赋 1020（気品）且该角色不敌对时
   * A = A*7/4 + 2000。218306 起 8 处 NPC 生成与 249303 的日变化都会调用。
   */
  function generateMoney(g, c, rngOverride) {
    if (!g || !c) return 0;
    const src = rngOverride || (g && g.rng) || Elona.rng;
    const R = (n) => src.rnd(Math.max(1, n | 0));
    let v = R(100) + R((c.get(38) | 0) * 50 + 1);
    const role = c.get(150) | 0;
    const isShop = (role >= 1000 && role < 2000) || role === 2003;
    if (isShop) {
      v += 2500 + (c.get(F_RANK) | 0) * 250;
      if (role === 1009) v = 25000 + (c.get(F_RANK) | 0) * 500;
    }
    const mapId = g.getV65 ? (g.getV65(V_MAP) | 0) : 0;
    const inShop = (g.v132 && (g.v132[String(mapId)] | 0) === 102)
      || !!(Elona.Property && Elona.Property.currentSite
        && (function () { const s = Elona.Property.currentSite(g); return s && (s.type | 0) === 102; })());
    if (inShop && Elona.ShopSale && Elona.Status && Elona.Status.cbit) {
      const w = Elona.ShopSale.workerOf(g, mapId);
      if (w && Elona.Status.cbit(w, CBIT_ELEGANCE) && (c.get(9) | 0) !== -3) {
        v = idiv(v * 7, 4) + 2000;
      }
    }
    if ((c.get(F_GOLD) | 0) < idiv(v, 2)) c.set(F_GOLD, v);
    return v;
  }

  function unitPrice(g, it, mode) {
    // var_577 = 6（商店）；214236-214249 对 92000（负重量货物/家具）无条件乘
    // var_548(子类型) 的百分比（含相场浮动），mode=1 时 calcValue 内部再 ×3/4。
    const s = g.shopSession;
    const DB = Elona.ItemDB;
    const isCargo = !!(DB && DB.ref && (DB.ref((it && it.id) | 0, 5) | 0) === CAT_CARGO);
    const pct = (s && (s.role === 1009 || isCargo)) ? furniturePctLive(g, it) : 100;
    return DB.calcValue(g.player, it, mode, g, { index: 0, var577: 6, var548: pct });
  }

  /**
   * 买入。count 超过库存时截断。
   * @returns {{ok:boolean, reason?:string, price?:number, item?:object}}
   */
  function buy(g, idx, count) {
    const s = g.shopSession;
    if (!s) return { ok: false, reason: 'no-shop' };
    const it = s.keeper.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
    count = limit(count | 0, 1, it.f[0] | 0);
    const unit = unitPrice(g, it, 0);
    const total = unit * count;
    if (total > g.player.get(30)) return { ok: false, reason: 'money', price: total };
    let got;
    if (count >= (it.f[0] | 0)) {
      s.keeper.inv.splice(idx, 1);
      got = it;
      got.eqSlot = -1;
      got.f[0] = count;
    } else {
      it.f[0] -= count;
      got = cloneItem(it, count);
    }
    got.f[8] = 3;
    addToInv(g.player, got, g);
    g.player.set(30, g.player.get(30) - total);        // 342191
    s.keeper.set(30, s.keeper.get(30) + total);        // 342192
    // 342193-342217 / 342349-342352
    const rankUp = autoInvestFromSales(g, s.keeper);
    const cargo = recordBuyPrice(g, got);
    const exp = negotiationExp(g, 0, total);
    return { ok: true, price: total, item: got, rankUp, cargo, exp };
  }

  /**
   * 偷窃（在商店里拿走商品不付钱）。
   * 【源码依据】物品的 ibit(9) 为「盗品」标记，calcitemvalue 会据此压价（214250-214265）；
   *   原版在店主/目击者视野内偷窃会使对方敌对（*label_4290 附近）。
   * 【简化】目击判定：8 格内、有视线的店主与其他 NPC 全部转为敌对（关系 -3）。
   */
  function steal(g, idx) {
    const s = g.shopSession;
    if (!s) return { ok: false, reason: 'no-shop' };
    const it = s.keeper.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
    let got;
    if ((it.f[0] | 0) <= 1) {
      s.keeper.inv.splice(idx, 1);
      got = it;
    } else {
      it.f[0] -= 1;
      got = cloneItem(it, 1);
    }
    got.eqSlot = -1;
    got.f[0] = 1;
    if (Elona.ItemDB && Elona.ItemDB.ibitmod) Elona.ItemDB.ibitmod(9, got, 1);   // 盗品
    addToInv(g.player, got, g);

    const witnesses = [];
    for (const c of g.charas || []) {
      if (!c || c.get(0) !== 1 || c === g.player || c.get(9) === -3) continue;
      const d = Math.max(Math.abs(c.x - g.player.x), Math.abs(c.y - g.player.y));
      if (d > 8) continue;
      if (g.map && Elona.Spell && Elona.Spell.fovLos
        && !Elona.Spell.fovLos(g, c.x, c.y, g.player.x, g.player.y)) continue;
      c.set(9, -3);
      witnesses.push(c.name);
    }
    return { ok: true, item: got, witnesses };
  }

  /**
   * 卖出。拒绝已装备/无库存/店主钱不够。
   * @returns {{ok:boolean, reason?:string, price?:number, item?:object}}
   */
  function sell(g, idx, count) {
    const s = g.shopSession;
    if (!s) return { ok: false, reason: 'no-shop' };
    const it = g.player.inv && g.player.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
    if (it.eqSlot >= 0) return { ok: false, reason: 'equipped' };
    // 经商页注 2 / 30466-30475：店主不收腐烂食物与黑星物品
    if ((it.f[4] | 0) === 6) return { ok: false, reason: 'artifact' };
    if ((it.f[24] | 0) === 35 && (it.f[27] | 0) < 0) return { ok: false, reason: 'rotten' };
    count = limit(count | 0, 1, it.f[0] | 0);
    const unit = unitPrice(g, it, 1);
    const total = unit * count;
    if ((s.keeper.get(30) | 0) < total) return { ok: false, reason: 'shop-money', price: total };
    let sold;
    if (count >= (it.f[0] | 0)) {
      g.player.inv[idx] = null;
      sold = it;
      sold.eqSlot = -1;
      sold.f[0] = count;
    } else {
      it.f[0] -= count;
      sold = cloneItem(it, count);
    }
    sold.f[8] = 3;                                     // 342295
    sold.f[21] = s.keeper.index;
    s.keeper.inv.push(sold);
    g.player.set(30, g.player.get(30) + total);        // 342290
    s.keeper.set(30, Math.max(0, s.keeper.get(30) - total));   // 342291-342294
    // 342222-342288 / 342296-342327 / 342349-342352
    const side = saleSideEffects(g, s.keeper, sold, total, count);
    if (sold !== it && side.fame) it.f[26] = 1;       // 部分卖出时原堆叠也不再刷名声
    const points = yacaCampaign(g, s.keeper, total);
    const exp = negotiationExp(g, 0, total);
    return { ok: true, price: total, item: sold, side, points, exp };
  }

  Elona.Shop = {
    ROLE_NAMES, SHOP_ROLES, roleOf, isShopkeeper, roleName, stockSize, stackCount,
    restock, needsRestock, open, close, buy, sell, steal, unitPrice, cloneItem,
    pickCategory, bookIdForSpell, CAT_645, POOL_1547, POOL_1543,
    investValue, invest, FURNITURE_PRICES, furniturePct, furnitureDrift, furniturePctLive,
    itemTag, sfCandidates,
    // 0-FP
    V_YACA, V_GUILD_QUOTA, CAT_CARGO, CBIT_ELEGANCE,
    negotiationExp, calcinvestnpc, autoInvestFromSales, recordBuyPrice,
    saleSideEffects, yacaCampaign, generateMoney, localRng,
  };
})(window);
