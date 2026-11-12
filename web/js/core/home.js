'use strict';
/**
 * 玩家自宅（core/home.js）—— 家の権利書 / ハウスボード / 昇降階段 / 初始洞窟
 *
 * 【源码定位】
 *   家の権利書        232700-232845   （344 権利書 / 897 引越しの権利書 / 1134 物件移設）
 *     · 232703  var_126(6) != 1            →「ワールドマップでしか使えない」
 *     · 232707  var_503(0) != 0 | 世界47   →「その場所には建てられない」
 *     · 232717  槽位 300..449 全满        →「もうこれ以上建物は建てられない」
 *     · 232767  var_65(24) = var_99(25)    → 家的等级（rank）取自权利书的 f25
 *     · 232787  「新しい家を建てた！」→ 232810「引っ越しが完了した！」
 *   家の初期化        *label_2432 232639-232668 / map_init 238842-239933
 *     · map_initcustom "home" + var_65(24) → 地图文件 home0..home6（家の等級）
 *     · var_126(13) = 132（BGM）/ var_65(26) = 4 / var_126(12) = 3
 *     · rank 0 且 var_65(22) == 1：两个使用人（33 ラーネイレ / 34 ロミアス，role 3）
 *       与 510 形見のカバン / 547 給料箱 / 579 冷蔵庫 / 24 本（f25 = 1）
 *     · rank >= 5 且没有滞在者时补 7 位店主/使用人
 *     · var_65(22) != 1（二层以上）：脚下放一条 219 頑丈なロープ
 *   家の等級与容量     *label_2432（232639）：
 *     rank 0..6 → 容量 100/150/200/300/350/400/400，家の価値 1000..15000
 *   外装（世界地図のチップ） *label_2434（232964）：
 *     var_132(15, 7) = 143（既定）/ rank0 → 138（洞窟）/ 4 → 148 / 5 → 144 / 6 → 136
 *   ハウスボード      *label_2435（232969-235164）
 *     · 233240  var_126(6) != 5 →「ここはあなたの家ではない。」
 *     · 233247  家产清单「<地图> には N 個のアイテムと M 個の家具が…」
 *     · 菜单：家の模様替え / 家の情報 / 仲間の滞在 / 滞在者の移動 /
 *             使用人を募集する / 生成される扉変更 / タイルグループ変更 /
 *             外装変更 / お片付け機能
 *     · 233520 家の情報：価値 = (基本 var_65(76) + 家具 var_65(77) + 家宝 var_65(78)) / 3
 *     · 235039 使用人を募集する：calchirecost()*20 GP，家门口上限 = rank + 2
 *     · 234726 タイルグループ変更：var_126(2) 0→1→2→3→0（換 tileset）
 *     · 234667 生成される扉変更：var_126(12) 14→9→3→8→14
 *     · 234831 外装変更：1..33 → var_132(15) = 329 + n（家の外観チップ）
 *     · 234061 お片付け機能：地面物品全部吸到脚下（跳过 f21 = 1 / 5）
 *     · 234035 家の模様替え（*label_2444 / *label_2670）：铺地砖 / 取地砖
 *   昇降階段（家具 750 / 751）237215-237280 + 344060-344140
 *     · var_65(20) == 7 时在玩家脚下 mapitemfind 750/751，
 *       命中即 var_503(1) = 10 / 11（= 上行 / 下行楼梯）
 *     · 下楼 var_65(22)++，上楼 var_65(22)--；上到 0 层且 var_126(6) == 5（屋内）
 *       → var_65(20) = var_65(850)（回到世界地图）
 *   换图时的滞在者    237755-237780 / 237845-237866
 *     · 出图：var_58(80) != 0 的角色 var_58(0) = 9（不在场）
 *     · 进图：var_58(80) == 当前地图 → 1；自宅还要 var_58(438) == 当前层
 *
 * 【本项目约定】
 *   · 家永远是同一个 site（id 7），用权利书「搬家/升级」而不是另建一处 ——
 *     源码里家也只有一处（349…「家は一つしか持てない」）。
 *   · 楼层共用同一张 home<rank> 地图（源码 map_initcustom 只依赖 var_65(24)），
 *     但**地面物品按层分开存**（源码 inv_<地图id>_<100+层>.s2）。
 *   · 没有「回家用绳索」的效果（219 的效果 46 未移植），因此下到二层以上时
 *     若该层没有任何 750 昇り階段，会在落地点补一段上行石阶，避免卡死。
 */

(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const MAP_ID = 7;                  // var_65(20) == 7 即自宅
  const MAX_FLOOR = 10;              // var_132(10, 7) = 10
  const MAX_RANK = 6;

  /** *label_2432（232639-232668）+ *label_2434（232964-232983） */
  const RANKS = [
    { rank: 0, file: 'home0', cap: 100, value: 1000, chip: 138, name: '洞窟の我が家' },
    { rank: 1, file: 'home1', cap: 150, value: 3000, chip: 143, name: '小さな我が家' },
    { rank: 2, file: 'home2', cap: 200, value: 5000, chip: 143, name: '我が家' },
    { rank: 3, file: 'home3', cap: 300, value: 7000, chip: 143, name: '広い我が家' },
    { rank: 4, file: 'home4', cap: 350, value: 8000, chip: 148, name: '立派な我が家' },
    { rank: 5, file: 'home5', cap: 400, value: 10000, chip: 144, name: '豪邸' },
    { rank: 6, file: 'home6', cap: 400, value: 15000, chip: 136, name: '大豪邸' },
  ];

  /** 250641-250660：初始位置（var_65(24)==0 且 var_65(250+259)==0 时） */
  const DEFAULT_POS = { x: 22, y: 21, world: 4 };

  /** 使用人募集表（222105-222109） */
  const HIRE_CREATURE = [205, 70, 74, 41, 69, 76, 1, 1, 1];
  const HIRE_ROLE = [18, 9, 12, 5, 8, 14, 1008, 1008, 1008, 24];

  /** 门的种类（234677-234690）：和風 9 / 普通 3 / SF 8 / 片開き 14 */
  const DOOR_CYCLE = [14, 9, 3, 8];

  function hasMap(name) {
    return (Elona.Sites && Elona.Sites.hasMapSync) ? Elona.Sites.hasMapSync(name) : false;
  }

  function rank(g) {
    const r = g && g.getV65 ? (g.getV65(24) | 0) : 0;
    return limit(r, 0, MAX_RANK);
  }

  function setRank(g, r) {
    if (!g || !g.setV65) return 0;
    const v = limit(r | 0, 0, MAX_RANK);
    g.setV65(24, v);
    return v;
  }

  function def(g) { return RANKS[rank(g)] || RANKS[0]; }

  function mapFile(g, r) {
    const rr = (r === undefined || r === null) ? rank(g) : limit(r | 0, 0, MAX_RANK);
    return RANKS[rr].file;
  }

  function floor(g) {
    const f = g && g.getV65 ? (g.getV65(22) | 0) : 1;
    return limit(f || 1, 1, MAX_FLOOR);
  }

  /** 当前是否在自宅地图里（地图文件名 home0..home6，或 var_65(20) == 7） */
  function inHome(g) {
    if (!g) return false;
    if (g.map && /^home\d+$/.test(g.map.name || '')) return true;
    return (g.getV65 ? (g.getV65(20) | 0) : 0) === MAP_ID;
  }

  // ------------------------------------------------------------------ 站点

  /**
   * 自宅的 site 记录（var_132 的槽 7）。
   *   静态表里 site 7 的字段是 0:5 / 3:8 / 9:10000 / 10:10 / 11:1 / 12:1 / 16:7 / 17:1 / 21:1，
   *   坐标与外装来自 250641-250660 的条件分支（var_65(24)==0 且 var_65(259)==0）。
   *   本项目把它变成运行时记录（g.propertySites['7']），这样「搬家」只需改坐标。
   */
  function ensureSite(g) {
    if (!g) return null;
    if (!g.propertySites) g.propertySites = {};
    if (!g.v132) g.v132 = {};
    let s = g.propertySites['7'];
    if (!s) {
      s = {
        id: MAP_ID, player: true, type: MAP_ID, map: MAP_ID,
        x: DEFAULT_POS.x, y: DEFAULT_POS.y, world: DEFAULT_POS.world,
        name: '我家', nameJp: '我家', nameEn: 'Your Home',
        fileName: mapFile(g),
        fields: {
          0: 5, 1: DEFAULT_POS.x, 2: DEFAULT_POS.y, 3: 8, 4: 1,
          9: 10000, 10: MAX_FLOOR, 11: 1, 12: 1,
          15: def(g).chip, 16: MAP_ID, 17: 1, 18: 3, 21: 1, 30: DEFAULT_POS.world,
        },
      };
      g.propertySites['7'] = s;
      g.v132['7'] = MAP_ID;
    } else {
      if (!s.fields) s.fields = {};
      s.player = true;
      s.type = MAP_ID;
      s.id = MAP_ID;
    }
    // 外装与文件名随等级变化（*label_2434）
    if (!s.chipCustom) s.fields[15] = def(g).chip;
    s.fileName = mapFile(g);
    return s;
  }

  function site(g) {
    if (!g || !g.propertySites) return null;
    return g.propertySites['7'] || null;
  }

  /** 移动/新建家：改 site 7 的坐标与外装（*label_2434，232964-232983） */
  function placeSite(g, x, y, world) {
    const s = ensureSite(g);
    const w = (world === undefined || world === null) ? ((g.getV65 ? (g.getV65(850) | 0) : 0) || DEFAULT_POS.world) : (world | 0);
    s.x = x | 0; s.y = y | 0; s.world = w;
    s.fields[1] = s.x; s.fields[2] = s.y; s.fields[30] = w;
    s.fields[15] = def(g).chip;
    s.fields[18] = 3;
    s.fields[4] = 1;
    s.fileName = mapFile(g);
    return s;
  }

  // ------------------------------------------------------------------ 建造

  const DEED_NEW = 344;        // 権利書（新建/升级）
  const DEED_MOVE = 897;       // 引越しの権利書（只搬家，等级不变）
  const DEED_RELOCATE = 1134;  // 物件移設の申請書（搬家产，与家无关 → 交给 property.js）

  function isDeed(item) {
    const id = item ? ((item.id !== undefined ? (item.id | 0) : (item.f && item.f[3] | 0))) : 0;
    return id === DEED_NEW || id === DEED_MOVE;
  }

  /**
   * 使用家の権利書 —— 232700-232845。
   * @param {object} g
   * @param {object} item
   * @returns {{ok:boolean, reason?:string, message:string, rank?:number}}
   */
  function build(g, item) {
    if (!isDeed(item)) return { ok: false, reason: 'not-deed', message: '这不是家的权利书。' };
    const id = (item.id !== undefined ? (item.id | 0) : (item.f[3] | 0));
    // 232703：只能在世界地图上使用
    if (!(g && g.worldMap)) {
      return { ok: false, reason: 'not-world', needWorldMap: true,
        message: '那是只能在世界地图上使用的物品。' };
    }
    const world = (g.getV65(850) | 0) || 4;
    const x = g.worldMap.x | 0, y = g.worldMap.y | 0;
    // 232707-232716：已有据点的格子 / 海辺世界 47
    if (world === 47 || (Elona.Property && Elona.Property.cellBusy(g, world, x, y))) {
      return { ok: false, reason: 'occupied-cell', message: '那里不能建造。' };
    }
    // 232717：槽位 300..449 全满（家本身占 7 号槽，不参与这段判定，但保持同一提示）
    if (!ensureSite(g)) return { ok: false, reason: 'no-site', message: 'cannot place home' };

    const oldRank = rank(g);
    const newRank = (id === DEED_NEW)
      ? limit(((item.f && item.f[25]) | 0), 0, MAX_RANK)
      : oldRank;
    placeSite(g, x, y, world);
    if (id === DEED_NEW) {
      setRank(g, newRank);
      ensureSite(g);            // 等级变了 → 外装/容量跟着变
    }
    placeSite(g, x, y, world);
    // 232783-232790：引越し时若仍是初始洞窟，标记「已离开初始位置」
    //   （250652 的静态放置条件 var_65(24)==0 & var_65(250+259)==0 从此不再成立）
    if (id === DEED_MOVE && rank(g) === 0) g.setV65(259, 1);
    else if (rank(g) !== 0) g.setV65(259, 1);
    // 232918：消耗一本
    item.f[0] = (item.f[0] | 0) - 1;
    if (g.refreshGroundCell) g.refreshGroundCell(item.f[5] | 0, item.f[6] | 0);
    const msg = (id === DEED_NEW) ? '新的家建好了！' : '搬家完成了！';
    g.log(msg);
    return { ok: true, site: site(g), rank: rank(g), moved: id === DEED_MOVE, message: msg };
  }

  // ------------------------------------------------------------------ 进出

  /** 进入自宅（floor 缺省 1）。对应 var_1777 = 2 → var_65(64)=7 / var_65(65)=1 */
  async function enter(g, toFloor, opts) {
    if (!g || g.transitioning) return false;
    const o = opts || {};
    const target = limit(toFloor | 0, 1, MAX_FLOOR);
    const file = mapFile(g);
    if (!hasMap(file)) {
      g.log(`自宅的地图（${file}）尚未提取。`);
      return false;
    }
    g.transitioning = true;
    try {
      if (Elona.Sites) { await Elona.Sites.load(); await Elona.Sites.mapNames(); }
      // 离开的是自宅 → 先存本层的地面物品与 NPC
      if (inHome(g)) { stashFloor(g); stashNpcs(g); }
      ensureSite(g);
      g.homeFloor = target;
      g.pendingSite = MAP_ID;
      await g.loadMap(file);
      // 地图编号 / 层数 / 所属世界
      g.setV65(20, MAP_ID);
      g.setV65(22, target);
      g.setV65(850, 4);
      g.map.header[6] = 5;                   // var_126(6) = 5（屋内，家具/告示板判定用）
      g.map.header[18] = def(g).cap;         // 道具上限
      g.map.header[12] = g.map.header[12] || 3;
      g.setV65(76, def(g).value);            // 家の基本価値（*label_2432）
      // var_132(4, 7) = 图块组（234726 的タイルグループ変更会改它）
      const s = site(g);
      if (s && s.tileset !== undefined) g.map.tileset = s.tileset | 0;
      applyTiles(g, file);                   // 装修补丁（铺过的地砖）
      // 地面物品：本层已有存档就还原，否则把地图自带的对象收作初始内容
      const firstVisit = !(g.homeFloors && Array.isArray(g.homeFloors[floorKey(target)]));
      if (firstVisit) seedItems(g);          // 238862-238878：rank 0 一层的初始家具
      for (const it of (g.groundItems || [])) {
        if (!it) continue;
        it.f[21] = -1;                       // 自宅里的东西都是自己的
        it.townOwned = false;
      }
      restoreFloor(g, target);
      // 角色：清场后还原本层 NPC，再放同伴
      g.charas = [g.player];
      const npcBack = firstVisit ? 0 : restoreNpcs(g, target);
      if (firstVisit && !npcBack) seedNpcs(g);
      if (firstVisit) stashNpcs(g);
      g.dungeonDepth = 0;
      g.questMap = null;
      g.worldMap = null;
      // 落点
      const put = (o.x !== undefined && o.y !== undefined)
        ? { x: o.x | 0, y: o.y | 0 }
        : (o.keep ? { x: g.player.x | 0, y: g.player.y | 0 } : null);
      if (put && g.map.walkable(put.x, put.y)) { g.player.x = put.x; g.player.y = put.y; }
      else if (put) {
        const spot = nearWalkable(g, put.x, put.y);
        if (spot) { g.player.x = spot.x; g.player.y = spot.y; }
      }
      g.player.set(0, 1);
      g.syncCharaCells();
      g.restoreParty();
      // 二层以上：源码在脚下放一条 219 頑丈なロープ（238912-238916）
      if (target > 1) ensureEscape(g);
      recalcValue(g);
      if (g.onMapChange) g.onMapChange(g.map);
      g.log(target === 1 ? '这里是你的家。' : `这里是家的第 ${target} 层。`);
      return true;
    } finally {
      g.transitioning = false;
    }
  }

  /** 从世界地图进入自宅（enterSite 的分支） */
  async function enterFromWorld(g) {
    return enter(g, 1);
  }

  /** 找 (x,y) 附近第一个可通行格 */
  function nearWalkable(g, x, y) {
    if (!g.map) return null;
    if (g.map.walkable(x, y)) return { x, y };
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (g.map.walkable(nx, ny)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  /**
   * 二层以上的「保底出口」：该层既没有 750 昇り階段、也没有 219 ロープ时，
   * 在脚下补一段上行石阶（源码靠ロープ离图，本项目没有效果 46，故给石阶）。
   */
  function ensureEscape(g) {
    const hasUp = (g.groundItems || []).some((it) => it && (it.f[0] | 0) > 0 && (it.id | 0) === 750);
    const hasRope = (g.groundItems || []).some((it) => it && (it.f[0] | 0) > 0 && (it.id | 0) === 219);
    if (hasUp || hasRope) return false;
    const spot = nearWalkable(g, g.player.x | 0, g.player.y | 0);
    if (!spot) return false;
    if (spot.x === (g.player.x | 0) && spot.y === (g.player.y | 0)) {
      const alt = nearWalkable(g, spot.x + 1, spot.y) || nearWalkable(g, spot.x, spot.y + 1);
      if (alt) spot.x = alt.x, spot.y = alt.y;
    }
    const it = Elona.ItemDB && Elona.ItemDB.createItem ? Elona.ItemDB.createItem(750, 1, g.rng) : null;
    if (!it) return false;
    it.f[5] = spot.x; it.f[6] = spot.y; it.f[7] = 7500; it.f[21] = -1;
    g.groundItems.push(it);
    if (g.refreshGroundCell) g.refreshGroundCell(spot.x, spot.y);
    g.log('（这一段上行石阶是回到一层的通道。）');
    return true;
  }

  // -------------------------------------------------------------- 层与物品

  function floorKey(f) { return String(f | 0); }

  /** 把当前层的地面物品存进 g.homeFloors（源码 inv_<地图id>_<100+层>.s2） */
  function stashFloor(g) {
    if (!g || !inHome(g)) return 0;
    if (!g.homeFloors) g.homeFloors = {};
    const kept = [];
    for (const it of (g.groundItems || [])) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      kept.push(it.toJSON ? it.toJSON() : it);
    }
    g.homeFloors[floorKey(floor(g))] = kept;
    return kept.length;
  }

  /** 还原某层的地面物品；返回 {restored, count} */
  function restoreFloor(g, f) {
    if (!g.homeFloors) g.homeFloors = {};
    const key = floorKey(f);
    const list = g.homeFloors[key];
    if (!Array.isArray(list)) {
      // 首次进入：把 loadMap 摆好的地图对象记为初始内容
      const kept = [];
      for (const it of (g.groundItems || [])) {
        if (!it || (it.f[0] | 0) <= 0) continue;
        kept.push(it.toJSON ? it.toJSON() : it);
      }
      g.homeFloors[key] = kept;
      return { restored: false, count: kept.length };
    }
    g.groundItems = list.map((o) => (Elona.Item && Elona.Item.fromJSON) ? Elona.Item.fromJSON(o) : o);
    // 重建「格子上有物品」标记
    if (g.map) {
      for (let y = 0; y < g.map.height; y++) {
        for (let x = 0; x < g.map.width; x++) g.map.cells[y][x][4] = 0;
      }
    }
    for (const it of g.groundItems) {
      if (g.refreshGroundCell) g.refreshGroundCell(it.f[5] | 0, it.f[6] | 0);
    }
    return { restored: true, count: g.groundItems.length };
  }

  /** 本层地面物品（不含背包） */
  function floorItems(g) {
    return (g && g.groundItems) || [];
  }

  // ------------------------------------------------------------------ NPC

  /**
   * 家的初始人物 —— map_init 238850-238860（只在 rank 0 的一层）：
   *   `characreate -1, 33, 18, 10 : var_58(150) = 3`（風を聴く者『ラーネイレ』）
   *   `characreate -1, 34, 16, 11 : var_58(150) = 3`（異形の森の使者『ロミアス』）
   */
  function seedNpcs(g) {
    if (rank(g) !== 0) return 0;
    if (!Elona.CharaFactory || !Elona.CharaFactory.create) return 0;
    const spot = (wantX, wantY) => {
      if (g.map && g.map.walkable(wantX, wantY)) return { x: wantX, y: wantY };
      return nearWalkable(g, wantX, wantY) || { x: g.player.x | 0, y: g.player.y | 0 };
    };
    let n = 0;
    const list = [[33, 18, 10], [34, 16, 11]];
    for (let i = 0; i < list.length; i++) {
      const [cid, wx, wy] = list[i];
      const slot = 57 + i;
      const p = spot(wx, wy);
      let c = null;
      try {
        c = Elona.CharaFactory.create(g, cid, Math.max(1, g.player.level | 0), p.x, p.y, { index: slot });
      } catch (e) { c = null; }
      if (!c) continue;
      c.set(0, 1);
      c.set(9, 0);
      c.set(69, 0);
      c.set(150, 3);                 // 役割 3（住人）
      g.charas[slot] = c;
      n++;
    }
    if (n && g.syncCharaCells) g.syncCharaCells();
    return n;
  }

  /**
   * 家的初始家具 —— map_init 238862-238878（rank 0 一层）：
   *   `itemcreate -1, 510, 6, 10` + `var_99(9) = 3`   形見のカバン
   *   `itemcreate -1, 547, 15, 19` + `var_99(9) = 4`  給料箱
   *   `itemcreate -1, 579, 9, 8` + `var_99(9) = 6`    冷蔵庫
   *   `itemcreate -1, 24, 18, 19` + `var_99(25) = 1`  本（家具）
   */
  function seedItems(g) {
    if (rank(g) !== 0) return 0;
    if (!Elona.ItemDB || !Elona.ItemDB.createItem) return 0;
    const list = [
      [510, 6, 10, { f9: 3 }],
      [547, 15, 19, { f9: 4 }],
      [579, 9, 8, { f9: 6 }],
      [24, 18, 19, { f25: 1 }],
    ];
    let n = 0;
    for (const [id, x, y, extra] of list) {
      const it = Elona.ItemDB.createItem(id, 1, g.rng);
      if (!it) continue;
      it.f[5] = x; it.f[6] = y; it.f[21] = -1;
      if (extra && extra.f9 !== undefined) it.f[9] = extra.f9 | 0;
      if (extra && extra.f25 !== undefined) it.f[25] = extra.f25 | 0;
      g.groundItems.push(it);
      if (g.refreshGroundCell) g.refreshGroundCell(x, y);
      n++;
    }
    return n;
  }

  function stashNpcs(g) {
    if (!g || !inHome(g)) return 0;
    if (!g.homeNpcs) g.homeNpcs = {};
    const list = [];
    for (let i = 57; i < 245; i++) {
      const c = g.charas[i];
      if (!c || (c.get(0) | 0) === 0) continue;
      if (c === g.player) continue;
      list.push(c.toJSON());
    }
    g.homeNpcs[floorKey(floor(g))] = list;
    return list.length;
  }

  function restoreNpcs(g, f) {
    if (!g.homeNpcs || !Elona.Chara || !Elona.Chara.fromJSON) {
      if (!g.homeNpcs) g.homeNpcs = {};
      return 0;
    }
    const list = g.homeNpcs[floorKey(f)];
    if (!Array.isArray(list) || !list.length) return 0;
    let n = 0;
    for (const o of list) {
      let c = null;
      try { c = Elona.Chara.fromJSON(o); } catch (e) { c = null; }
      if (!c) continue;
      const slot = c.index | 0;
      if (slot <= 0) continue;
      c.set(0, 1);
      if (!g.map.walkable(c.x, c.y)) {
        const spot = nearWalkable(g, c.x | 0, c.y | 0);
        if (spot) { c.x = spot.x; c.y = spot.y; }
      }
      g.charas[slot] = c;
      n++;
    }
    if (n && g.syncCharaCells) g.syncCharaCells();
    return n;
  }

  // ------------------------------------------------------------------ 楼梯

  /**
   * 脚下的昇降階段家具 —— 237217-237232：
   *   `if ( var_65(20) == 7 ) { if ( mapitemfind(x, y, 751) != -1 ) …751… ; 750 … }`
   * @returns {{up:boolean, item:object}|null}
   */
  function stairsAt(g, x, y) {
    if (!g || !inHome(g)) return null;
    const xx = (x === undefined) ? (g.player.x | 0) : (x | 0);
    const yy = (y === undefined) ? (g.player.y | 0) : (y | 0);
    for (const it of (g.groundItems || [])) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if ((it.f[5] | 0) !== xx || (it.f[6] | 0) !== yy) continue;
      const id = it.id | 0;
      if (id === 751) return { up: false, item: it };
      if (id === 750) return { up: true, item: it };
    }
    return null;
  }

  /**
   * 上下自家楼层（237253-237280）：
   *   下楼 var_65(22)++ / 上楼 var_65(22)--；
   *   上到 0 层且 var_126(6) == 5 → var_65(20) = var_65(850)（回世界地图）。
   * @returns {Promise<object>}
   */
  async function useStairs(g, up, opts) {
    if (!g || g.transitioning) return { ok: false, reason: 'busy' };
    // 原版是「脚下有 750/751 才改变 var_503(1)」，光按 </> 不会换层（237217-237232）
    if (!(opts && opts.force)) {
      const st = stairsAt(g, g.player.x, g.player.y);
      if (!st || st.up !== !!up) {
        g.log(up ? '这里没有上行的楼梯。' : '这里没有下行的楼梯。');
        return { ok: false, reason: 'no-stairs' };
      }
    }
    const f = floor(g);
    if (up) {
      if (f <= 1) {
        // 237262-237275：var_126(6) == 5（屋内）→ 回世界地图
        g.setV65(26, 2);
        g.setV65(22, 0);
        g.log('你走上了楼梯。');
        const ok = await leaveHome(g);
        return { ok, up: true, map: 'world', floor: 0 };
      }
      g.setV65(26, 2);
      await enter(g, f - 1, { keep: true });
      return { ok: true, up: true, floor: f - 1 };
    }
    if (f >= MAX_FLOOR) {
      g.log('这里已经是最深的一层了。');
      return { ok: false, reason: 'bottom' };
    }
    g.setV65(26, 1);
    await enter(g, f + 1, { keep: true });
    return { ok: true, up: false, floor: f + 1 };
  }

  /** 从自宅回到世界地图（原版 var_65(20) = var_65(850)） */
  async function leaveHome(g) {
    if (!g) return false;
    stashFloor(g);
    stashNpcs(g);
    g.pendingSite = null;
    const s = ensureSite(g);
    // A49：自宅所在世界（s.world）决定载入哪张世界地图
    const wid = (s && s.world) || 4;
    if (Elona.WorldMap) await Elona.WorldMap.load(wid);
    if (Elona.Sites) { await Elona.Sites.load(); Elona.Sites.bindGame(g); }
    if (Elona.RandDungeon) {
      Elona.RandDungeon.onEnterWorld(g, wid);
    }
    g.setV65(20, 0);
    g.setV65(22, 0);
    g.worldMap = { x: (s ? s.x : DEFAULT_POS.x) | 0, y: (s ? s.y : DEFAULT_POS.y) | 0 };
    g.setV65(850, (s && s.world) || 4);
    g.log('你来到了世界地图。');
    return true;
  }

  // ------------------------------------------------------------------ 价值

  /**
   * 家の価値 —— *label_2451 / *label_2452（235860-235940）。
   *   var_65(76) 基本（*label_2432 查表）
   *   var_65(77) 家具：refitem(id, 5) == 60000 的家具，每件 +limit(価値/50, 50, 500)，上限 10000
   *   var_65(78) 家宝：按価値/1000（家具 /20、80000・77000 类 /10）排序取前 10，
   *               每件 limit(v, 100, 2000)，上限 10000
   *   var_65(124) = max(100, 10000 - (76 + 77 + 78) / 3)   ← 越小越好（位次越高）
   */
  function recalcValue(g) {
    if (!g || !g.setV65) return null;
    const base = def(g).value;
    g.setV65(76, base);
    let furn = 0;
    const heirs = [];
    for (const it of floorItems(g)) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      const cat = (Elona.ItemDB && Elona.ItemDB.ref) ? (Elona.ItemDB.ref(it.id | 0, 5) | 0) : 0;
      const val = it.f[1] | 0;
      if (cat === 60000) furn += limit(idiv(val, 50), 50, 500);
      let v;
      if (cat === 60000) v = idiv(val, 20);
      else if (cat === 80000 || cat === 77000) v = idiv(val, 10);
      else v = idiv(val, 1000);
      heirs.push(v);
    }
    furn = Math.min(10000, furn);
    heirs.sort((a, b) => b - a);
    let heir = 0;
    for (let i = 0; i < Math.min(10, heirs.length); i++) heir += limit(heirs[i], 100, 2000);
    heir = Math.min(10000, heir);
    g.setV65(77, furn);
    g.setV65(78, heir);
    const score = Math.max(100, 10000 - idiv(base + furn + heir, 3));
    const before = g.getV65(124) | 0;
    g.setV65(124, score);
    return { base, furn, heir, score, before, changed: before !== score };
  }

  /** 家の情報（233520-233560 的数值部分） */
  function homeInfo(g) {
    const v = recalcValue(g) || { base: def(g).value, furn: 0, heir: 0, score: 0 };
    const stars = (n) => limit(idiv(n, 1000), 1, 10);
    const sites = (Elona.Property && Elona.Property.list) ? Elona.Property.list(g) : [];
    const stayers = countStayers(g);
    return {
      rank: rank(g), rankName: def(g).name, file: mapFile(g),
      cap: def(g).cap, floor: floor(g), maxFloor: MAX_FLOOR,
      base: v.base, furn: v.furn, heir: v.heir, score: v.score,
      stars: { base: stars(v.base), furn: stars(v.furn), heir: stars(v.heir), total: stars(idiv(v.base + v.furn + v.heir, 3)) },
      stayers, maxStayers: rank(g) + 2,
      estates: sites.length,
    };
  }

  /** 滞在者数（233223-233234：槽 57..244 中 var_58(150) != 0 的角色） */
  function countStayers(g) {
    let n = 0;
    for (let i = 57; i < 245; i++) {
      const c = g.charas[i];
      if (!c) continue;
      const st = c.get(0) | 0;
      if (st !== 1 && st !== 2) continue;
      if ((c.get(150) | 0) === 0) continue;
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------ 告示板菜单

  /** 菜单项（233240-233300 的顺序与可用条件） */
  function menu(g) {
    const out = [];
    const fl = floor(g);
    out.push({ key: 'design', label: '家の模様替え / 装修' });
    out.push({ key: 'info', label: '家の情報 / 家的信息' });
    out.push({ key: 'stay', label: '仲間の滞在 / 让同伴留在家里' });
    out.push({ key: 'move', label: '滞在者の移動 / 移动滞在者' });
    if (fl === 1) out.push({ key: 'hire', label: '使用人を募集する / 招募使用人' });
    out.push({ key: 'door', label: '生成される扉変更 / 更换门的种类' });
    out.push({ key: 'tileset', label: 'タイルグループ変更 / 更换图块组' });
    out.push({ key: 'exterior', label: '外装変更 / 更换外观' });
    out.push({ key: 'collect', label: 'お片付け機能 / 收拾地面物品' });
    return out;
  }

  /** 233002：家产清单表头 */
  function inventoryHead(g) {
    let items = 0, furn = 0;
    for (const it of floorItems(g)) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if ((Elona.ItemDB.ref(it.id | 0, 5) | 0) === 60000) furn++;
      else items++;
    }
    const cap = (g.map && g.map.header && (g.map.header[18] | 0)) || def(g).cap;
    const name = (g.map && g.map.name) || mapFile(g);
    return `「${def(g).name}」第 ${floor(g)} 层：${items} 件道具、${furn} 件家具（道具上限 ${cap} 个）。`;
  }

  // ----------------------------------------------------------- 使用人募集

  /**
   * 招募使用人（235039-235120 的候选生成）。
   * @returns {{ok:boolean, reason?:string, message?:string, candidates?:Array}}
   */
  function recruit(g) {
    const r = rank(g);
    if (countStayers(g) >= r + 2) {
      return { ok: false, reason: 'full', message: '家里已经挤满了人。' };
    }
    const slots = [];
    for (let i = 57; i < 245; i++) {
      const c = g.charas[i];
      if (!c || (c.get(0) | 0) === 0) { slots.push(i); }
      if (slots.length >= 8) break;
    }
    if (!slots.length) return { ok: false, reason: 'no-slot', message: '没有空位了。' };
    const R = (n) => (g.rng ? g.rng.rnd(n) : 0);
    const out = [];
    let si = 0;
    for (let cnt = 0; cnt < 10 && out.length < 4; cnt++) {
      if (R(2)) continue;                       // 235063：rnd(2) 为真则跳过
      const idx = (cnt === 0) ? 0 : R(HIRE_CREATURE.length);
      const cid = HIRE_CREATURE[idx] | 0;
      const role = HIRE_ROLE[idx] | 0;
      const slot = slots[si++];
      if (!slot) break;
      let c = null;
      try {
        c = Elona.CharaFactory.create(g, cid, Math.max(1, g.player.level | 0), g.player.x, g.player.y, { index: slot });
      } catch (e) { c = null; }
      if (!c) continue;
      c.set(0, 10);                             // 235077：var_58(0) = 10（候选）
      c.set(150, role);
      c.set(9, 0); c.set(69, 0);
      out.push({ chara: c, slot, role, cost: hireCost(c) * 20 });
    }
    if (!out.length) return { ok: false, reason: 'none', message: '今天没有人来应征。' };
    return { ok: true, candidates: out, message: '谁要来应聘？' };
  }

  /** calchirecost：雇佣成本（economy.js 有同名实现，这里做最小兜底） */
  function hireCost(c) {
    if (Elona.Economy && Elona.Economy.calcHireCost) {
      try { return Elona.Economy.calcHireCost(c) | 0; } catch (e) { /* 回退 */ }
    }
    const lv = (c && c.level) | 0;
    return Math.max(1, idiv(lv * lv, 10) + lv);
  }

  /** 正式雇佣（235128-235145）：扣钱 → var_58(0) = 1 */
  function hire(g, cand) {
    if (!cand || !cand.chara) return { ok: false, message: '没有选中的人。' };
    const cost = cand.cost | 0;
    const gold = g.player.inv.reduce((s, it) => s + (it && (it.id | 0) === 0 ? (it.f[0] | 0) : 0), 0);
    if (gold < cost) {
      for (const c of g.charas) { if (c && (c.get(0) | 0) === 10) c.set(0, 0); }
      return { ok: false, reason: 'money', message: '钱不够……' };
    }
    // 扣金币
    let need = cost;
    for (const it of g.player.inv) {
      if (!it || (it.id | 0) !== 0) continue;
      const have = it.f[0] | 0;
      const take = Math.min(have, need);
      it.f[0] = have - take; need -= take;
      if (!need) break;
    }
    cand.chara.set(0, 1);
    g.syncCharaCells();
    // 其它候选清场
    for (const c of g.charas) {
      if (c && (c.get(0) | 0) === 10) c.set(0, 0);
    }
    const name = cand.chara.name || '使用人';
    g.log(`你雇佣了${name}。`);
    return { ok: true, message: `你雇佣了${name}。`, chara: cand.chara, cost };
  }

  // -------------------------------------------------------------- 滞在

  /** 让同伴留在家里（233790-233800：var_58(80) = 当前地图, var_58(438) = 层） */
  function stayAlly(g, c) {
    if (!c) return { ok: false };
    c.set(80, MAP_ID);
    c.set(438, floor(g));
    c.set(171, c.x | 0);
    c.set(172, c.y | 0);
    return { ok: true, message: `${c.name} 决定留在家里。` };
  }

  /** 取消滞在 / 从工作岗位上撤下（233753-233770） */
  function unstayAlly(g, c) {
    if (!c) return { ok: false };
    c.set(80, 0);
    c.set(438, 0);
    return { ok: true, message: `${c.name} 不再留在家里。` };
  }

  function isStaying(c, mapId, fl) {
    if (!c || !c.get) return false;
    if ((c.get(80) | 0) !== (mapId | 0)) return false;
    if ((mapId | 0) === MAP_ID && fl !== undefined) return (c.get(438) | 0) === (fl | 0);
    return true;
  }

  /** 把滞在者搬到指定格（233725-233745） */
  function moveStayer(g, c, x, y) {
    if (!c || !g.map) return { ok: false };
    if (!g.map.walkable(x | 0, y | 0)) return { ok: false, message: '那个位置不能移动。' };
    const cell = g.map.cell(c.x | 0, c.y | 0);
    if (cell && cell[1] === (c.index | 0) + 1) cell[1] = 0;
    c.x = x | 0; c.y = y | 0;
    c.set(171, c.x); c.set(172, c.y);
    g.syncCharaCells();
    return { ok: true, message: `${c.name} 移动了。` };
  }

  // ------------------------------------------------------ 其它告示板功能

  /** 234726：var_126(2) 与 var_132(4, 7) 一起 0→1→2→3→0 */
  function cycleTileset(g) {
    if (!g.map) return { ok: false };
    const cur = g.map.tileset | 0;
    const next = (cur + 1) % 4;
    g.map.tileset = next;
    const s = ensureSite(g);
    if (s) { s.tileset = next; s.fields[4] = next; }
    return { ok: true, tileset: next, message: `图块组改成了 map${next}。（要重新进入地图才会完全生效。）` };
  }

  /** 234667：门种类 14→9→3→8→14（var_126(12) / var_132(18)） */
  function cycleDoor(g) {
    if (!g.map) return { ok: false };
    const cur = g.map.header[12] | 0;
    const i = DOOR_CYCLE.indexOf(cur);
    const next = DOOR_CYCLE[(i < 0 ? 0 : i + 1) % DOOR_CYCLE.length];
    g.map.header[12] = next;
    const s = ensureSite(g);
    if (s) s.fields[18] = next;
    const names = { 9: '和风门', 3: '普通的门', 8: '机械门', 14: '单开门' };
    return { ok: true, door: next, message: `以后生成的门是${names[next] || next}。（要重新进入地图才会完全生效。）` };
  }

  /** 234831：外装 1..33 → var_132(15) = 329 + n；0 = 回退到默认 */
  function setExterior(g, n) {
    const s = ensureSite(g);
    if (!s) return { ok: false };
    const v = n | 0;
    if (v === 0) {
      s.chipCustom = false;
      s.fields[15] = def(g).chip;
      return { ok: true, chip: s.fields[15], message: '恢复了原来的外观。' };
    }
    if (v < 1 || v > 33) return { ok: false, message: '请输入 1〜33（0 恢复默认）。' };
    s.chipCustom = true;
    s.fields[15] = 329 + v;
    return { ok: true, chip: s.fields[15], message: `外观改成了 No.${v}。` };
  }

  /** 234061：把地面物品全部吸到脚下（跳过 f21 = 1 / 5 的有主物） */
  function collectAll(g) {
    const p = g.player;
    let n = 0;
    for (const it of floorItems(g)) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      const owner = it.f[21] | 0;
      if (owner === 1 || owner === 5) continue;
      const ox = it.f[5] | 0, oy = it.f[6] | 0;
      it.f[5] = p.x | 0; it.f[6] = p.y | 0;
      if (g.refreshGroundCell) g.refreshGroundCell(ox, oy);
      n++;
    }
    if (n) g.refreshGroundCell(p.x, p.y);
    return { ok: true, count: n, message: n ? `收拾了 ${n} 件掉落物品。` : '没有什么可以收拾的。' };
  }

  // ------------------------------------------------------------ 装修模式

  /**
   * 装修过的格子 —— 地图文件（data/maps/homeN.json）是只读的，换图会重新读入，
   *   所以每次铺砖都记在 `g.homeTiles[文件]["x,y"] = 图块号`，进图后再贴回去。
   *   原版把改动直接写进内存里的 var_704 并随存档保存（mdata_*.s2），
   *   本项目用「初始数据 + 补丁」达到同样效果。
   */
  function rememberTile(g, x, y, tile) {
    if (!g) return false;
    if (!g.homeTiles) g.homeTiles = {};
    const file = (g.map && g.map.name) || mapFile(g);
    if (!g.homeTiles[file]) g.homeTiles[file] = {};
    g.homeTiles[file][`${x | 0},${y | 0}`] = tile | 0;
    return true;
  }

  /** 进图后把装修补丁贴回去 */
  function applyTiles(g, file) {
    const patch = g && g.homeTiles && g.homeTiles[file];
    if (!patch || !g.map) return 0;
    let n = 0;
    for (const key of Object.keys(patch)) {
      const [xs, ys] = key.split(',');
      const cell = g.map.cell(parseInt(xs, 10) | 0, parseInt(ys, 10) | 0);
      if (!cell) continue;
      cell[0] = patch[key] | 0;
      n++;
    }
    return n;
  }

  const design = {
    active: false, x: 0, y: 0, tile: 0, page: 0, _g: null,
    start(g) {
      if (!g || !g.map) return false;
      this.active = true;
      this._g = g;
      this.x = g.player.x | 0;
      this.y = g.player.y | 0;
      if (!this.tile) this.tile = (g.map.cells[this.y] && g.map.cells[this.y][this.x]) ? g.map.cells[this.y][this.x][0] : 0;
      g.designSel = true;
      return true;
    },
    cancel() {
      const was = this.active;
      this.active = false;
      if (this._g) this._g.designSel = false;
      this._g = null;
      return was;
    },
    move(dx, dy) {
      const g = this._g;
      if (!this.active || !g || !g.map) return false;
      const nx = limit(this.x + (dx | 0), 0, g.map.width - 1);
      const ny = limit(this.y + (dy | 0), 0, g.map.height - 1);
      this.x = nx; this.y = ny;
      return true;
    },
    /** 左键：铺砖（*label_2444 的 `var_704(x,y,0) = var_1663`） */
    paint(g) {
      if (!this.active || !g || !g.map) return { ok: false };
      const cell = g.map.cell(this.x, this.y);
      if (!cell) return { ok: false };
      cell[0] = this.tile | 0;
      // 地图文件是只读的数据表，换图会重新读入 → 把改过的格子记下来（g.homeTiles）
      rememberTile(g, this.x, this.y, this.tile | 0);
      return { ok: true, tile: this.tile, x: this.x, y: this.y };
    },
    /** 右键：取砖（取脚下方块的图块 id） */
    pick(g) {
      if (!this.active || !g || !g.map) return { ok: false };
      const cell = g.map.cell(this.x, this.y);
      if (!cell) return { ok: false };
      this.tile = cell[0] | 0;
      return { ok: true, tile: this.tile };
    },
    setTile(id) {
      this.tile = id | 0;
      this.page = Math.floor(this.tile / 33);
      return this.tile;
    },
  };

  // ------------------------------------------------------------------ 导出

  Elona.Home = {
    MAP_ID, MAX_FLOOR, MAX_RANK, RANKS, DEFAULT_POS, DOOR_CYCLE,
    HIRE_CREATURE, HIRE_ROLE,
    rank, setRank, def, mapFile, floor, inHome,
    site, ensureSite, placeSite,
    isDeed, build,
    enter, enterFromWorld, leaveHome, nearWalkable,
    seedItems, seedNpcs,
    stashFloor, restoreFloor, floorItems,
    rememberTile, applyTiles,
    stashNpcs, restoreNpcs,
    stairsAt, useStairs,
    recalcValue, homeInfo, countStayers,
    menu, inventoryHead,
    recruit, hire, hireCost,
    stayAlly, unstayAlly, isStaying, moveStayer,
    cycleTileset, cycleDoor, setExterior, collectAll,
    design,
  };
})(typeof window !== 'undefined' ? window : globalThis);
