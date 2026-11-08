'use strict';
/**
 * 玩家地产（自家建筑）—— 建造 / 地产表 / 博物馆评分 / 收容所。
 *
 * 【源码定位】
 *   建造     232844-232920（使用建筑物品 → 就地建 site）
 *     var_541 = 13 ; gosub *label_2873   ← 分配新的 site 槽
 *     var_132(0,id)=5   状态：已建
 *     var_132(3,id)=8   地图文件编号
 *     var_132(9,id)=10000 / (11)=1 / (12)=0或1 / (17)=1 / (18)=3 / (10)=1 / (4)=1
 *     var_132(30,id)=var_65(850)  所属世界地图
 *     var_132(1,2,id)=玩家坐标
 *     var_132(16,id)=建筑类型 / var_132(15,id)=对应地图 id / var_132(21,id)=类别
 *   建筑物品 521 博物館 / 1296 収容所 / 522 店 / 542 畑 / 543 倉庫 / 572 牧場
 *             712 ダンジョン / 909 廃モンスター牧場
 *   地产税   economy.js 的 calcBuilding（214544-214606）已按 g.v132[300..449] 计费
 *   博物馆   var_65(123) = 收藏评分槽
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const SLOT_MIN = 300;        // 214548：地产槽 300..449
  const SLOT_MAX = 449;

  /** 232859-232909：建筑物品 → (类型, 地图 id, 类别, 名称) */
  const BUILD_ITEMS = {
    521: { type: 101, map: 151, cat: 1, jp: '博物館', en: 'museum', zh: '博物馆' },
    1296: { type: 105, map: 161, cat: 1, jp: '収容所', en: 'camp', zh: '收容所' },
    522: { type: 102, map: 150, cat: 1, jp: '店', en: 'shop', zh: '店铺' },
    542: { type: 103, map: 152, cat: 2, jp: '畑', en: 'crop', zh: '农田' },
    543: { type: 104, map: 153, cat: 1, jp: '倉庫', en: 'storage', zh: '仓库' },
    572: { type: 31, map: 154, cat: 2, jp: '牧場', en: 'ranch', zh: '牧场' },
    712: { type: 39, map: 138, cat: 1, jp: 'ダンジョン', en: 'dungeon', zh: '迷宫' },
    909: { type: 100, map: 142, cat: 2, jp: '廃モンスター牧場', en: 'discarded ranch', zh: '废弃怪物牧场' },
  };

  /**
   * 建筑内部的初始布置 —— 源码 `map_init` 的类型分派（238053-238145）。
   *   · map      map_initcustom 的地图文件名
   *   · capacity var_126(18) = 该建筑的物品容量上限（233002 会显示「アイテム最大 N 個」）
   *   · items    进图时摆好的家具（itemcreate 的逐条抄写）
   *     f25 = 家具种类（4=展示台 8=店铺柜台 9=畑 11=牧場 15=地城 32=收容所）
   *     f9  = 店铺金库（56x）の初始金额
   */
  const ESTATE_INIT = {
    101: {
      map: 'museum_1', capacity: 0, bgm: 53,
      items: [{ id: 24, x: 15, y: 17, f25: 4 }, { id: 562, x: 18, y: 17 }],
    },
    102: {
      map: 'shop_1', capacity: 10, bgm: 53,
      items: [
        { id: 24, x: 17, y: 14, f25: 8 },
        { id: 561, x: 19, y: 10, f9: 5 },
        { id: 562, x: 17, y: 11 },
      ],
    },
    103: {
      map: 'crop_1', capacity: 80, bgm: 68,
      items: [{ id: 24, x: 14, y: 5, f25: 9 }],
    },
    104: { map: 'storage_1', capacity: 200, bgm: 67, items: [] },
    105: {
      map: 'camp', capacity: 100, bgm: 53,
      items: [{ id: 24, x: 22, y: 18, f25: 32 }],
    },
    31: {
      map: 'ranch_1', capacity: 80, bgm: 68,
      items: [{ id: 24, x: 23, y: 8, f25: 11 }, { id: 562, x: 22, y: 6 }],
    },
    39: {
      map: 'dungeon1', capacity: 350, bgm: 68,
      items: [{ id: 24, x: 39, y: 54, f25: 15 }],
    },
    100: { map: '2nouti', capacity: 400, bgm: 67, items: [] },
  };


  function isBuildItem(item) {
    return !!item && Object.prototype.hasOwnProperty.call(BUILD_ITEMS, item.id | 0);
  }

  /** 取一个空闲的地产槽（300..449） */
  function freeSlot(g) {
    const v132 = (g && g.v132) || {};
    for (let id = SLOT_MIN; id <= SLOT_MAX; id++) {
      if (!v132[String(id)]) return id;
    }
    return -1;
  }

  /** 玩家地产一览 */
  function list(g) {
    const v132 = (g && g.v132) || {};
    const sites = (g && g.propertySites) || {};
    const out = [];
    for (let id = SLOT_MIN; id <= SLOT_MAX; id++) {
      const type = v132[String(id)] | 0;
      if (!type) continue;
      const s = sites[String(id)] || null;
      out.push({
        id, type,
        name: s ? s.name : ('site ' + id),
        nameJp: s ? s.nameJp : '',
        map: s ? s.map : 0,
        x: s ? s.x : 0,
        y: s ? s.y : 0,
        world: s ? s.world : 0,
      });
    }
    return out;
  }

  function siteOf(g, id) {
    const sites = (g && g.propertySites) || {};
    return sites[String(id | 0)] || null;
  }

  /**
   * 世界地图当前所在格（原版 232847 的 `var_58(1,0), var_58(2,0)`）。
   *   网页版的地图坐标与世界坐标是两套：站在世界地图上时以 `g.worldMap` 为准。
   */
  function worldPos(g) {
    if (g && g.worldMap) return { x: g.worldMap.x | 0, y: g.worldMap.y | 0 };
    const p = g && g.player;
    return { x: p ? (p.x | 0) : 0, y: p ? (p.y | 0) : 0 };
  }

  /** 是否站在世界地图上（`var_126(6) == 1`） */
  function onWorldMap(g) {
    return !!(g && g.worldMap);
  }

  /**
   * 该世界地图格是否已经有东西 —— `cell_featread` + `var_503(0) != 0`（232707-232716）。
   *   原版每一格只放一个入口特性，所以「格子上已有站点 / 城镇」就等于 `var_503(0) != 0`。
   */
  function cellBusy(g, world, x, y) {
    const S = Elona.Sites;
    if (S && S.at && S.at(world, x, y, g)) return true;
    const towns = (Elona.Towns && Elona.Towns.LIST) || [];
    for (const t of towns) {
      if ((t.wx | 0) === x && (t.wy | 0) === y) return true;
    }
    if (g && g.worldMap && typeof g.worldMap.featAt === 'function') {
      if (g.worldMap.featAt(x, y)) return true;
    }
    return false;
  }

  /**
   * 使用产权书建造（232700-232920）。
   *
   * 判定顺序与原版一致：
   *   232703 `var_126(6) != 1`        →「それはワールドマップでしか使えない。」
   *   232707 `cell_featread` + `var_503(0) != 0 | var_65(850) == 47`
   *                                   →「その場所には建てられない。」
   *   232717 槽位 300..449 全满      →「もうこれ以上建物は建てられない。」
   *   232727 「本当にこの場所に建設する？」（y/n）
   *   232841 `var_541 = 13 ; gosub *label_2873` → 建 site 记录
   *   232844-232909 按物品 id 覆写类型 / 地图 id / 类别
   *   232911 「あなたは<名称>を建設した！」→ `removeitem` 消耗一本
   *
   * @param {object} g
   * @param {object} item 产权书物品
   * @param {object} [opts] { confirmed:true } —— 跳过 y/n（网页版由「选中并使用」代替）
   * @returns {{ok:boolean, reason?:string, site?:object, message:string}}
   */
  function build(g, item, opts) {
    if (!isBuildItem(item)) return { ok: false, reason: 'not-build', message: '这不是建筑产权书。' };
    const def = BUILD_ITEMS[item.id | 0];
    // 232703：只允许在世界地图上使用
    if (!onWorldMap(g)) {
      return {
        ok: false, reason: 'not-world', needWorldMap: true,
        message: '那是只能在世界地图上使用的物品。',
      };
    }
    const world = (g.getV65 ? (g.getV65(850) | 0) : 0);
    const pos = worldPos(g);
    // 232707-232716：海边世界（47）与已有特性的格子建不了
    if (world === 47 || cellBusy(g, world, pos.x, pos.y)) {
      return { ok: false, reason: 'occupied-cell', message: '那里不能建造。' };
    }
    const slot = freeSlot(g);
    if (slot < 0) {
      return { ok: false, reason: 'no-slot', message: '不能再建造更多的建筑了。' };
    }
    if (!(opts && opts.confirmed)) {
      // 232727：原版是 y/n 确认框；网页版把「在背包里选中并使用」当作确认（见 A363）。
      //   这里只把原版提示词透出去，供 UI 需要时显示。
      build._pendingPrompt = '真的要在这里建造吗？';
    }
    const x = pos.x, y = pos.y;
    // 232844-232858：site 表字段
    const fields = {
      0: 5,        // kind = 已建
      1: x, 2: y,
      3: 8, 4: 1,  // 宽高
      9: 10000,    // 价值
      10: 1, 11: 1,
      12: 0,
      15: def.map,
      16: def.type,
      17: 1, 18: 3,
      21: def.cat,     // 232895-232908 的 `var_132(21)`：1 = 收取类 / 2 = 可放牧类
      30: world,
    };
    if (def.cat === 2) fields[12] = 1;         // 畑 / 牧場 / 廃牧場
    if (def.type === 31 || def.type === 39 || def.type === 100) fields[12] = 1;
    const site = {
      id: slot, player: true, type: def.type, map: def.map,
      x, y, world, fields,
      name: def.jp, nameJp: def.jp, nameEn: def.en,
    };
    if (!g.v132) g.v132 = {};
    if (!g.propertySites) g.propertySites = {};
    g.v132[String(slot)] = def.type;
    g.propertySites[String(slot)] = site;
    // 232918：消耗产权书
    item.f[0] = (item.f[0] | 0) - 1;
    if (g.refreshGroundCell) g.refreshGroundCell(item.f[5] | 0, item.f[6] | 0);
    return {
      ok: true, site, slot,
      message: `你建造了${def.zh || def.jp}！（${def.jp}）`,
    };
  }

  // ---------------------------------------------------------------- 博物馆
  /** refchara(species, 6)：该物种的稀有度系数（creature 表 fields[6]） */
  function speciesValue(species) {
    if (!Elona.CharaFactory || !Elona.CharaFactory.ref) return 100;
    const rec = Elona.CharaFactory.ref(species | 0);
    if (!rec || !rec.fields) return 100;
    const v = parseInt(rec.fields[6], 10);
    return Number.isFinite(v) ? v : 100;
  }

  /**
   * 单件标本/卡片的收藏价值 —— `*label_2448`（235657-235682）。
   *   品质 6 → 70 + 等级；否则 `等级/10 + 2`，物种稀有度 < 80 时再补 `80 - 稀有度`；
   *   同种超过 1 件 → 值 /3（上限 15）。
   *   标本(503) 记全额，卡片(504) 记一半（235726-235731）。
   */
  function specimenValue(it, dupCount) {
    const species = (it.f && it.f[23]) | 0;
    const lv = idiv((it.f && it.f[7]) | 0, 1000);     // var_58(7) = 等级 * 1000
    let v = idiv(lv, 10) + 2;
    const sv = speciesValue(species);
    if (sv < 80) v += 80 - sv;
    if (dupCount > 1) {
      v = idiv(v, 3);
      if (v > 15) v = 15;
    }
    return v;
  }

  /**
   * 博物馆收藏评分 —— var_65(123)（235700-235752）。
   *   只统计标本(503)与卡片(504)，卡片要有 var_99(22) != 0；
   *   `10000 - int(sqrt(总价值) * 70)`，下限 100。
   * @param {object[]} items 存放在博物馆里的物品
   */
  function museumScore(items) {
    const list = items || [];
    const dup = {};
    for (const it of list) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      const id = it.id | 0;
      if (id !== 503 && id !== 504) continue;
      if (id === 504 && ((it.f[22] | 0) === 0)) continue;
      const key = (id === 503 ? 's' : 'c') + ((it.f[23] | 0));
      dup[key] = (dup[key] || 0) + 1;
    }
    let total = 0;
    for (const it of list) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      const id = it.id | 0;
      if (id !== 503 && id !== 504) continue;
      if (id === 504 && ((it.f[22] | 0) === 0)) continue;
      const key = (id === 503 ? 's' : 'c') + ((it.f[23] | 0));
      const v = specimenValue(it, dup[key]);
      total += (id === 503) ? v : idiv(v, 2);
    }
    return Math.max(100, 10000 - Math.trunc(Math.sqrt(total) * 70));
  }

  /** 博物馆展示的物品（存放在博物馆 site 的库存里） */
  function museumItems(g, slot) {
    const s = siteOf(g, slot);
    if (!s || s.type !== 101) return [];
    return s.items || [];
  }

  /** 把物品存入博物馆 */
  function depositMuseum(g, slot, item) {
    const s = siteOf(g, slot);
    if (!s || s.type !== 101) return { ok: false, reason: 'not-museum' };
    if (!s.items) s.items = [];
    s.items.push(item);
    const before = g.getV65(123) | 0;                       // 235738：变动前的评分
    const score = museumScore(s.items);
    g.setV65(123, score);                                    // var_65(123) = 收藏评分
    const out = { ok: true, count: s.items.length, score, before };
    // 235738-235750：位次变动提示
    if (before !== score && Elona.Rank && Elona.Rank.changeText) {
      out.rankText = Elona.Rank.changeText(before, score, 3, 'jp');
    }
    return out;
  }

  /** 博物馆的称号（ranktitle(3)，位次 = var_65(123)/100） */
  function museumTitle(g, lang) {
    if (!Elona.Rank || !Elona.Rank.title) return '';
    return Elona.Rank.title(g, 3, lang);
  }

  /**
   * 博物馆访客评价（252247-252284）。
   * 按 var_65(123)（收藏评分，越小越好）分四档 + 最好档：
   *   > 8000 冷清档 / > 5000 普通档 / > 2500 热闹档 / > 500 盛况档 / 其余 最佳档
   * 随机取一条。
   * @param {object} g
   * @param {string} [lang] 'jp' | 'en'
   */
  const VISITOR_COMMENTS = [
    { min: 8001, jp: ['「退屈ぅー」', '「あまり見るものがないな」', '「こんなので見物料とるの？」', '館内は少し寂しい…'],
      en: ['"Boring..."', '"There is not much to see."', '"Do you charge admission for this?"', 'The hall is a bit lonely...'] },
    { min: 5001, jp: ['「いいんじゃない～」', '「まあ、普通の博物館だ」', '「恋人を連れてくればよかったかも」', 'まあまあの客足だ。'],
      en: ['"Not bad~"', '"It is an ordinary museum."', '"I should have brought my lover."', 'The number of visitors is fair.'] },
    { min: 2501, jp: ['「この雰囲気好きだなぁ」', '「もう一度来ようよ」', '「時間が経つのを忘れるね！」', '館内はなかなか賑わっている。'],
      en: ['"I like this atmosphere."', '"I will come again."', '"I forget how time passes!"', 'The hall is fairly crowded.'] },
    { min: 501, jp: ['「来て良かった♪」', '「よくこんなに集めたなあ」', '「むぅ…興味深い」', '客足が全く絶えない盛況ぶりだ。'],
      en: ['"Glad I came~"', '"You collected so many."', '"Hmm... interesting."', 'The hall is packed with visitors.'] },
    { min: -1, jp: ['「素晴らしいコレクションだ！」', '「感動した」', '「帰りたくないわ♪」', '来客は食い入るように展示物を眺めている。'],
      en: ['"A wonderful collection!"', '"I am moved."', '"I do not want to go home~"', 'Visitors stare at the exhibits intently.'] },
  ];

  /**
   * 博物馆访客评价档位（252247-252284）。
   * 按 var_65(123)（收藏评分，越小越好）分档：
   *   > 8000 冷清档 / > 5000 普通档 / > 2500 热闹档 / > 500 盛况档 / 其余 最佳档
   * @returns {object} 该档位的 { jp:[], en:[] }
   */
  function visitorTier(g) {
    const score = (g && g.getV65) ? (g.getV65(123) | 0) : 0;
    const row = VISITOR_COMMENTS.filter((r) => score >= r.min)[0]
      || VISITOR_COMMENTS[VISITOR_COMMENTS.length - 1];
    return row;
  }

  /**
   * 博物馆访客评价（252247-252284），随机取一条。
   * @param {object} g
   * @param {string} [lang] 'jp' | 'en'
   * @param {number} [idx] 指定第几条（测试用；缺省随机）
   */
  function visitorComment(g, lang, idx) {
    const row = visitorTier(g);
    const list = (lang === 'en') ? row.en : row.jp;
    const R = (g && g.rng && g.rng.rnd) ? (n) => g.rng.rnd(n) : () => 0;
    const i = (idx === undefined || idx === null) ? R(list.length) : (idx | 0);
    return list[i] || list[0];
  }

  // ---------------------------------------------------------------- 收容所
  /**
   * 收容所的能量 —— 收容怪物换取的「力」。
   * 源码对应 var_65(250+255) 与收容所的关押计数（登记为近似）。
   */
  function campEnergy(g, slot) {
    const s = siteOf(g, slot);
    if (!s || s.type !== 105) return 0;
    return s.energy | 0;
  }

  function addCampEnergy(g, slot, n) {
    const s = siteOf(g, slot);
    if (!s || s.type !== 105) return { ok: false, reason: 'not-camp' };
    s.energy = Math.max(0, (s.energy | 0) + (n | 0));
    return { ok: true, energy: s.energy };
  }

  // ------------------------------------------------- 建筑内部布置与访客
  /**
   * 进入玩家自建建筑时的内部布置 —— 源码 `map_init`（238053-238145）。
   *   · 摆好该类型专属的家具（展示台 / 店铺柜台 / 金库 / 收容所的槛）
   *   · var_126(18) = 建筑容量（233002 会显示「アイテム最大 N 個」）
   * @returns {{ok:boolean, capacity:number, items:number}}
   */
  function siteInit(g, site) {
    const def = site ? ESTATE_INIT[site.type | 0] : null;
    if (!def) return { ok: false, reason: 'not-estate', capacity: 0, items: 0 };
    if (!site.capacity) site.capacity = def.capacity | 0;
    let placed = 0;
    if (Elona.ItemDB && Elona.ItemDB.createItem && g && g.groundItems) {
      for (const spec of def.items) {
        const it = Elona.ItemDB.createItem(spec.id, 1);
        if (!it) continue;
        it.f[5] = spec.x | 0;
        it.f[6] = spec.y | 0;
        it.f[7] = 100;
        if (spec.f25 !== undefined) it.f[25] = spec.f25 | 0;
        if (spec.f9 !== undefined) it.f[9] = spec.f9 | 0;
        g.groundItems.push(it);
        placed++;
      }
      if (placed && g.refreshGroundCell) {
        for (const spec of def.items) g.refreshGroundCell(spec.x | 0, spec.y | 0);
      }
    }
    return { ok: true, capacity: site.capacity | 0, items: placed };
  }

  // ------------------------------------------- 建筑内的物品（0-EA：库存持久化）
  /**
   * 离开自建建筑时把地面物品收进 `site.stock`。
   *
   * 原版把建筑内部当作一张独立地图：离开时 `gosub *label_2873` 把 `var_99` 写进
   * `tmp\inv_<槽位>_<编号>.s2`（235253-235255），回来时再读回来，所以摆在店里的
   * 商品、金库里的钱、农地里的作物都留在原地。
   * 本项目的地面物品在换图时整体清空（`loadMap`），若不显式收存，店内货物会消失。
   *
   * @returns {number} 收存的件数（0 表示当前不在自建建筑里）
   */
  function stashStock(g) {
    const site = currentSite(g);
    if (!site || !g) return 0;
    // 自宅（site 7）的地面物品按「楼层」分开存（core/home.js 的 g.homeFloors），
    //   不能写进 site.stock，否则一层与二层会互相覆盖。
    if ((site.type | 0) === 7) return 0;
    const kept = [];
    for (const it of (g.groundItems || [])) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      kept.push(it.toJSON());
    }
    site.stock = kept;
    return kept.length;
  }

  /**
   * 进入自建建筑：第一次进来按 `map_init` 摆家具，之后按 `site.stock` 还原。
   * @returns {{ok:boolean, capacity:number, items:number, restored:boolean}}
   */
  function enterStock(g, site) {
    if (!site) return { ok: false, reason: 'not-estate', capacity: 0, items: 0, restored: false };
    if (Array.isArray(site.stock) && Elona.Item && Elona.Item.fromJSON) {
      g.groundItems = site.stock.map((o) => Elona.Item.fromJSON(o));
      if (g.refreshGroundCell) {
        for (const it of g.groundItems) {
          g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
        }
      }
      const cap = site.capacity || ((ESTATE_INIT[site.type | 0] || {}).capacity | 0);
      if (!site.capacity) site.capacity = cap;
      return { ok: true, capacity: site.capacity | 0, items: g.groundItems.length, restored: true };
    }
    const r = siteInit(g, site);
    if (r.ok) site.stock = (g.groundItems || []).map((it) => it.toJSON());
    return Object.assign({ restored: false }, r);
  }

  /**
   * 访客等级 var_126(10)：
   *   博物馆 235752：`var_126(10) = (100 - var_65(123)/100) / 2 + 1`
   *   店     235636：`var_126(10) = (100 - var_65(125)/100) / 4 + 1`
   * 收藏评分 / 店铺评分越低（越好），访客等级越高 → 来客越多。
   * @param {object} g
   * @param {number} type 建筑类型（101=博物馆 / 102=店）
   */
  function visitorLevel(g, type) {
    const score = (type | 0) === 102
      ? ((g && g.getV65) ? (g.getV65(125) | 0) : 10000)
      : ((g && g.getV65) ? (g.getV65(123) | 0) : 10000);
    const denom = (type | 0) === 102 ? 4 : 2;
    return Math.trunc((100 - score / 100) / denom) + 1;
  }

  /**
   * 访客生成 —— 源码 `*label_2458`（236834-236875）。
   *   var_65(3) = 时（0..23，源码的「Map:Recaluculate crowd」计数；本项目用 var_65(13)）
   *   var_126(10) = 访客等级（博物馆评分 / 店铺评分决定）
   *   判定顺序：
   *     101/102 且 时 < 等级/2          → 1/4 生成
   *     等级 == 0                        → 直接返回
   *     var_126(6) >= 20 且 rnd(20) > 0  → 直接返回（野外地图几乎不生成）
   *     时 < 等级/4                       → 1/2 生成
   *     时 < 等级/2                       → 1/3 生成
   *     时 * 3 < 等级 * 2                 → 1/4 生成
   *     时 < 等级                        → 1/10 生成
   *
   * 访客的物种选择（源码 `*label_2457`，236391-236833 的 440 行分派）在本项目用
   * 「城镇市民池 + 低等级」近似（源码对玩家建筑最终落到
   * `flt calcobjlv(var_58(38,0)), calcfixlv(2)`，等级约 1..3）。
   *
   * @returns {{spawned:number, level:number}}
   */
  function spawnVisitors(g, site) {
    const out = { spawned: 0, level: 0 };
    if (!g || !site) return out;
    const type = site.type | 0;
    if (type !== 101 && type !== 102) return out;
    const level = visitorLevel(g, type);
    out.level = level;
    const hour = (g.getV65 ? (g.getV65(13) | 0) : 0);
    const rng = g.rng || Elona.rng;
    const R = (n) => rng.rnd(n);
    // var_126(6) = 当前地图的 kind（var_132(0, var_65(20))）；>= 20 表示野外/迷宫地图
    const kind = (site.fields && (site.fields[0] | 0)) || 0;
    let want = 0;
    if (hour < level / 2 && R(4) === 0) want++;
    if (level === 0) return out;
    if (kind >= 20) { if (R(20) > 0) return out; }
    if (hour < level / 4 && R(2) === 0) want++;
    if (hour < level / 2 && R(3) === 0) want++;
    if (hour * 3 < level * 2 && R(4) === 0) want++;
    if (hour < level && R(10) === 0) want++;
    if (want <= 0) return out;
    const made = placeVisitors(g, want);
    out.spawned = made;
    return out;
  }

  /** 城镇市民物种池（与 populateTown 使用的同一组），作为访客的近似物种 */
  const VISITOR_FOLK = [16, 39, 440, 441, 495, 69, 70, 74, 269, 326];

  /**
   * 建筑内的窃窃私语 —— 源码 `*label_2476` 的 252222-252238（博物馆）与
   * 252291-252297（店）。每条各 6 句（rnd(6) 选一）。
   */
  const MURMURS = {
    101: {
      jp: [
        [' *ざわざわ* ', '「ふむ…悪くないな」', '「何だろう、これは」', '「ほほう…」', '「私も死んだらはく製に…」', '「ここが噂の…」'],
        [' *がやがや* ', '「やだっ気持ち悪い」', '「ねーねーこれ死んでるんでしょ？」', '「かわ、いー♪」', '「今日はとことん見るぜ」', '「触ってもいいの？」'],
      ],
      en: [
        [' *noise* ', '"Hmm. Not bad."', '"What\'s this?"', '"Ohh..."', '"I want to be stuffed..."', '"So this is the famous..."'],
        [' *murmur* ', '"Gross! Disgusting."', '"Hey. Is it really dead?"', '"Scut!"', '"Absolutely amazing."', '"Can I touch?"'],
      ],
    },
    102: {
      jp: [[' *ざわざわ* ', '「これ欲しい～」', '「何だろう、これは」', '「お買い物♪」', '「金が足りん…」', '「ここが噂の…」']],
      en: [[' *murmur* ', '"I want this! I want this!"', '"Oh what\'s this?"', '"I\'m just watching"', '"My wallet is empty..."', '"So this is the famous...."']],
    },
  };

  /**
   * 玩家当前所在的玩家自建建筑（若有）。
   * `pendingSite` 离开后不会清空，因此还要核对当前地图文件名。
   */
  function currentSite(g) {
    if (!g || !g.pendingSite) return null;
    const site = siteOf(g, g.pendingSite);
    if (!site || !site.player) return null;
    // 自宅：地图文件名由家的等级决定（home0..home6），不是固定的 estateFile()
    if ((site.type | 0) === 7) {
      const f = (Elona.Home && Elona.Home.mapFile) ? Elona.Home.mapFile(g) : '';
      if (f && g.map && g.map.name !== f) return null;
      return site;
    }
    const file = (Elona.Sites && Elona.Sites.estateFile) ? Elona.Sites.estateFile(site.type) : '';
    if (file && g.map && g.map.name !== file) return null;
    return site;
  }

  /**
   * 建筑内的每回合环境消息（源码 `*label_2476` 的 252220-252300 段）。
   *   博物馆（类型 101）：
   *     rnd(25)==0 → 一条嘈杂声（6 句）
   *     rnd(25)==0 → 一条窃窃私语（6 句）
   *     rnd(15)==0 → 一条「访客评价」（按 var_65(123) 分 5 档，各 4 句）
   *   店（类型 102）：rnd(25)==0 → 一条嘈杂声（6 句）
   * 前提：`var_65(3) > 0`（源码的时段计数；本项目用 var_65(13) = 时）。
   * @returns {string|null}
   */
  function ambientMessage(g) {
    const site = currentSite(g);
    if (!site) return null;
    const type = site.type | 0;
    const rows = MURMURS[type];
    if (!rows) return null;
    const hour = (g.getV65 ? (g.getV65(13) | 0) : 0);
    if (hour <= 0) return null;
    const rng = g.rng || Elona.rng;
    const R = (n) => rng.rnd(n);
    const en = !!(Elona.Options && Elona.Options.values && Elona.Options.values.lang === 'en');
    const pick = (arr) => arr[R(arr.length)];
    // 博物馆：两条嘈杂声 + 一条访客评价
    if (type === 101) {
      if (R(25) === 0) {
        const list = en ? rows.en[0] : rows.jp[0];
        return pick(list);
      }
      if (R(25) === 0) {
        const list = en ? rows.en[1] : rows.jp[1];
        return pick(list);
      }
      if (R(15) === 0) return visitorComment(g, en ? 'en' : 'jp');
      return null;
    }
    // 店：一条嘈杂声
    if (R(25) === 0) {
      const list = en ? rows.en[0] : rows.jp[0];
      return pick(list);
    }
    return null;
  }

  /**
   * 把访客放到建筑内的空地上。
   * @returns {number} 实际生成数
   */
  function placeVisitors(g, want) {
    if (!g || !g.map || !Elona.CharaFactory || !Elona.CharaFactory.create) return 0;
    const map = g.map;
    const p = g.player;
    const used = new Set();
    // g.charas 是按 HSP 角色索引的稀疏数组，空槽为 undefined
    for (const c of (g.charas || [])) {
      if (c) used.add(`${c.x},${c.y}`);
    }
    if (p) used.add(`${p.x},${p.y}`);
    let made = 0;
    for (let n = 0; n < want; n++) {
      let pos = null;
      for (let t = 0; t < 400; t++) {
        const x = g.rng.rnd(map.width);
        const y = g.rng.rnd(map.height);
        if (!map.walkable(x, y)) continue;
        if (p && Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1) continue;
        const k = `${x},${y}`;
        if (used.has(k)) continue;
        used.add(k);
        pos = { x, y };
        break;
      }
      if (!pos) continue;
      const cid = VISITOR_FOLK[g.rng.rnd(VISITOR_FOLK.length)];
      const lv = 1 + g.rng.rnd(3);           // calcobjlv：1..3
      let c = null;
      try {
        c = Elona.CharaFactory.create(g, cid, lv, pos.x, pos.y, {});
      } catch (_) { c = null; }
      if (!c) continue;
      c.set(9, 0);                            // 中立
      c.set(69, 0);
      made++;
    }
    if (made && g.syncCharaCells) g.syncCharaCells();
    return made;
  }

  Elona.Property = {
    SLOT_MIN, SLOT_MAX, BUILD_ITEMS, ESTATE_INIT, VISITOR_FOLK,
    isBuildItem, freeSlot, list, siteOf, build, worldPos, onWorldMap, cellBusy,
    museumScore, museumItems, depositMuseum, museumTitle, specimenValue, speciesValue,
    visitorComment, visitorTier, VISITOR_COMMENTS,
    campEnergy, addCampEnergy,
    siteInit, visitorLevel, spawnVisitors, placeVisitors,
    currentSite, ambientMessage, MURMURS,
    stashStock, enterStock,
  };
})(window);
