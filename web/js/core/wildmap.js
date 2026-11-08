'use strict';
/**
 * 野外地图 —— 原版 map id 2（var_132(16)=2「野外 / Wilderness」）
 *
 * 【源码依据】
 *   进入条件（237303-237460）：
 *     世界地图（var_126(6)==1，即 var_132(0, 当前地图)=1 的大陆地图）上按确认键，
 *     脚下格**没有站点**（var_503(1)!=15）时 → `var_65(20) = 2`，
 *     即进入「野外」这一地图类型。空格键同样触发（var_577==6 与确认键共用分支）。
 *
 *   地图生成（240076-240572，`if ( var_65(20) == 2 )`）：
 *     - 尺寸固定 34 × 22（var_126(0)=34, var_126(1)=22）
 *     - 基础地形 = var_1618 = 396，按地形类别再随机铺 var_randomtile 的图块
 *     - 地形类别由玩家脚下的图块 var_65(62)（343586 赋值）决定：
 *         4..8    → 森（Forest）        tile 8/0/1/4
 *         9..12   → 草原（Grassland）   tile 9/10/0/1/4/3/4/5
 *         13..16  → 荒野（Wasteland）   tile 18/17/19/20/21
 *         264..362→ 水上（Sea）
 *         地形属性 var_593(0,x)==7|8 → 砂丘（Sand）  tile 24..28
 *         地形属性 var_593(0,x)==3   → 湿原（moor）   tile 314/315
 *         地形属性 var_593(0,x)==4   → 雪原（Snow）   tile 57/56/49/46/47/48/51
 *         其它                     → 平地（Plain）   tile 1..6
 *     - 出口（240433-240447）：放置 var_126(10)+1 只野生怪物
 *     - 物品：林/草原/平地撒 80000 类随机物；荒野撒 527；砂丘撒 607；
 *             湿原撒 528；雪原撒 80000（var_637=8）；海底撒 80001
 *
 *   离图方式（343336-343419）—— **走出地图边缘**，不是楼梯：
 *     玩家朝地图外走（目标格越界，`var_58(3/4,var_243)` 超出 `var_126(0/1)`）且
 *     `var_65(22)==1`（地面层）时 → 询问「「<地图名>」を去る？」→ y →
 *     `var_65(22)--` + `var_1777 = 4` → 重新载入 → `var_65(20) = var_65(850)`
 *     （237463-237465），即回到进入前所在的大陆世界地图与原坐标。
 *     地图上**没有**出口楼梯（本文件不生成任何 feat）。
 *
 *   本实现的近似：
 *     - 原版用 map_converttile 把符号图块转成真实图块；这里直接用真实图块 id。
 *     - 边界一圈强制还原为基础图块，保证玩家总能走到地图边（原版边界也可能被
 *       随机铺成水域，属随机性差异）。
 *     - 命名沿用原版的日文/英文（wiki 未给中文），项目内统一用中文名。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const W = 34, H = 22;            // 240077-240078
  /**
   * 各地形的**基础图块**（var_1618）—— 227650-227684 的 `map_tileset(4)` 分支。
   *   野外站点的 tileset 字段 `var_132(18, 2) = 4`（250633），所以走 prm_1081==4：
   *     森林 7 / 水上 12 / 草原 3 / 荒野 19 / 雪原 45 / 湿原 316 / 砂丘 23 /
   *     海底（世界 47）280 / 其余（平地）0
   *   注意：0-FC 初版误用 `var_1618 = 396`（227427 的**默认值**，tileset 0/1 才用），
   *   导致铺完整张图都不可通行；这里按 tileset 4 的真实分支取值。
   */
  const TERRAIN_BASE = {
    forest: 7, sea: 12, grass: 3, waste: 19,
    snow: 45, moor: 316, sand: 23, plain: 0, seabed: 280,
  };
  const WORLD_MAP = 2;             // 原版「野外」的 var_65(20)

  /** 地形类别 —— 240094-240420 的判定顺序 */
  const TERRAIN = {
    FOREST: 'forest', GRASS: 'grass', WASTE: 'waste', SEA: 'sea',
    SAND: 'sand', MOOR: 'moor', SNOW: 'snow', PLAIN: 'plain', SEABED: 'seabed',
  };

  /** 地形名（项目内中文；原版为 jp/en 双语） */
  const TERRAIN_NAMES = {
    forest: '森林', grass: '草原', waste: '荒野', sea: '水上',
    sand: '砂丘', moor: '湿原', snow: '雪原', plain: '平原', seabed: '海底',
  };

  /**
   * 各地形的点缀图块 —— 240096-240402 的 `map_randomtile 图块, 数量` 调用。
   * 值为 [图块 id, 数量] 的有序列表；原版按书写顺序依次随机替换。
   */
  const TERRAIN_TILES = {
    forest: [[8, 25], [0, 10], [1, 4], [4, 2]],
    grass: [[9, 10], [10, 10], [0, 30], [1, 4], [4, 2], [3, 2], [4, 2], [5, 2]],
    waste: [[18, 25], [17, 10], [19, 2], [20, 4], [21, 2]],
    sea: [],
    sand: [[24, 25], [25, 1], [28, 1], [26, 1], [27, 1]],
    moor: [[314, 20], [315, 45]],
    snow: [[57, 4], [56, 4], [49, 2], [46, 1], [47, 1], [48, 1], [51, 1]],
    plain: [[1, 10], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2]],
    seabed: [[281, 30], [282, 20], [283, 10]],
  };

  /**
   * 各地形撒落的地面物品 —— 240100-240415 的 `itemcreate`。
   *   var_638 = 80000/80001 是**候选类别**（itemcand.json 的 t638），
   *   527/607/528 是具体物品 id（枯れ木 / 巨大サボテン / ケヤキの木）。
   *   统一表示为 { t638: 类别 } 或 { id: 具体物品 }。
   */
  const TERRAIN_ITEMS = {
    forest: [{ t638: 80000 }], grass: [{ t638: 80000 }], waste: [{ id: 527 }],
    sea: [{ t638: 80001 }], sand: [{ id: 607 }], moor: [{ id: 528 }],
    snow: [{ t638: 80000 }], plain: [{ t638: 80000 }], seabed: [{ t638: 80001 }],
  };

  /** 各地形的额外怪物 —— 240163-240310 */
  const TERRAIN_MONSTERS = {
    sand: [634, 96, 255, 256],
    moor: [585, 11, 480],
  };

  /** 地形随机物数量 —— 各分支的 repeat 次数 */
  const TERRAIN_ITEM_COUNT = {
    forest: [20, 20], grass: [10, 10], waste: [4, 4], sea: [3, 3],
    sand: [4, 4], moor: [4, 4], snow: [3, 5], plain: [5, 5], seabed: [3, 3],
  };

  /**
   * 由玩家脚下的图块 id 判定地形类别。
   * 对应 240094-240420。
   *
   * 【源码语义】这些判定在原版是**一串独立的 if，不是 else-if**，
   * 所以后面的分支会覆盖前面的结果：
   *   1. 240094  `4 <= t < 9`            → 森（Forest）
   *   2. 240119  `264 <= t < 363`        → 水上（Sea）
   *   3. 240122  `9 <= t < 13`           → 草原（Grassland）
   *   4. 240150  `13 <= t < 17`          → 荒野（Wasteland）
   *   5. 240163  `var_593(0,t) == 7|8`   → 砂丘（Sand）
   *   6. 240184  `var_593(0,t) == 3`     → 湿原（moor）
   *   7. 240205  世界 47                → 海底（Seabed）
   *   8. 240312  世界 91                → 平地（Plain Field）
   *   9. 240378  `var_593(0,t) == 4`     → 雪原（Snow Field）
   *  10. 240395  兜底                   → 平地（Plain Field）
   * 本实现按同样顺序依次覆盖，保证与原版一致。
   *
   * @param {number} tileId 玩家脚下的图块 id（var_65(62)）
   * @param {object} g 游戏实例（用于查图块属性 var_593(0, tile)）
   * @param {number} worldId 世界 id（var_65(850)）
   * @returns {string} 地形类别
   */
  function terrainOf(tileId, g, worldId) {
    const t = tileId | 0;
    let r = null;
    if (t >= 4 && t < 9) r = TERRAIN.FOREST;
    if (t >= 264 && t < 363) r = TERRAIN.SEA;
    if (t >= 9 && t < 13) r = TERRAIN.GRASS;
    if (t >= 13 && t < 17) r = TERRAIN.WASTE;
    const attr = tileAttr(g, t);
    if (attr === 7 || attr === 8) r = TERRAIN.SAND;
    if (attr === 3) r = TERRAIN.MOOR;
    if ((worldId | 0) === 47) r = TERRAIN.SEABED;        // 海底（240205）
    if ((worldId | 0) === 91) r = TERRAIN.PLAIN;         // 平地（240312）
    if (attr === 4) r = TERRAIN.SNOW;
    if (!r) r = TERRAIN.PLAIN;
    return r;
  }

  /**
   * var_593(0, tile) —— 图块的地形属性（项目 tile_attributes.json 的第 0 维）。
   *   玩家此刻站在**世界地图**上，所以必须按世界地图的图集（ntyris 的 tileset 0）
   *   查表；不能用 g.map（那是上一张城镇/地城图，图集不同）。
   */
  function tileAttr(g, tileId) {
    const W = Elona.WorldMap;
    const attrs = g && g.tileAttrs;
    if (W && attrs) {
      const ts = (typeof W.tileset === 'number') ? W.tileset : 0;
      const t = attrs[String(ts)];
      const v = t && t[String(tileId | 0)];
      if (v) return v[0] | 0;
    }
    const map = g && g.map;
    if (map && typeof map.attr === 'function') return map.attr(tileId, 0) | 0;
    return 0;
  }

  function mk(id) { return [id, 0, id, 0, 0, 0, 0, 0, 0, 0]; }

  /**
   * 生成一张野外地图。
   * @param {object} g 游戏实例
   * @param {object} opt
   *   @param {number} opt.tileId 玩家脚下的图块 id（决定地形）
   *   @param {number} opt.level  怪物基准等级（var_65(189) 危险度）
   * @param {number} opt.worldId 世界 id（var_65(850)）
   * @returns {object} { json, entry, exit, monsters, items, terrain, name }
   */
  function build(g, opt) {
    opt = opt || {};
    const R = ((g && g.rng) || Elona.rng).rnd.bind(((g && g.rng) || Elona.rng));
    const terrain = opt.terrain || terrainOf(opt.tileId | 0, g, opt.worldId | 0);

    // 基础地形：var_1618 + (rnd(var_1618(2))==0) * rnd(var_1618(1))（240090）
    //   野外走 tileset 4 分支，基础图块随地形的不同而不同（见 TERRAIN_BASE）。
    const base = TERRAIN_BASE[terrain] === undefined ? 0 : TERRAIN_BASE[terrain];
    const cells = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push(mk(base + (R(1) === 0 ? R(1) : 0)));
      cells.push(row);
    }

    // 按地形铺点缀图块（map_randomtile 图块, 数量：随机挑选 count 个格子替换）
    const tiles = TERRAIN_TILES[terrain] || [];
    for (let i = 0; i < tiles.length; i++) {
      scatterTiles(cells, tiles[i][0], tiles[i][1], R);
    }

    // 0-FC：边界一圈强制还原为基础图块。
    //   原版靠「走到地图边缘再往外走」离图（343336-343419）；若边界被随机铺成
    //   不可通行图块（如水上/岩石），玩家就再也出不去，故这里补一条保底。
    for (let x = 0; x < W; x++) { cells[0][x] = mk(base); cells[H - 1][x] = mk(base); }
    for (let y = 0; y < H; y++) { cells[y][0] = mk(base); cells[y][W - 1] = mk(base); }

    // 玩家落点：地图中央（map_placeplayer 的默认行为）
    const entry = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
    cells[entry.y][entry.x] = mk(base);

    // 右下角保留一个「撤离锚点」：只用于物品/怪物落点的回避，不再放楼梯
    const exit = { x: W - 2, y: H - 2 };
    cells[exit.y][exit.x] = mk(base);

    const header = new Array(100).fill(0);
    header[0] = W; header[1] = H; header[2] = 1;
    header[5] = entry.y * 1000 + entry.x;
    header[4] = exit.y * 1000 + exit.x;
    header[6] = 4;                 // var_126(6) = var_132(0, 2) = 4（野外）
    header[10] = 4;                // var_126(10) = 4（240080）

    const level = Math.max(1, opt.level | 0 || 1);

    // 地面物品（240100-240415）
    const items = [];
    const itemPool = TERRAIN_ITEMS[terrain] || TERRAIN_ITEMS.plain;
    const cntRange = TERRAIN_ITEM_COUNT[terrain] || TERRAIN_ITEM_COUNT.plain;
    const itemCount = cntRange[0] + R(cntRange[1] - cntRange[0] + 1);
    for (let i = 0; i < itemCount; i++) {
      const pick = itemPool[R(itemPool.length)];
      items.push({ id: pick.id, t638: pick.t638, x: 0, y: 0 });
    }

    // 地形专属怪物（240163-240310）
    const monsters = [];
    for (const id of (TERRAIN_MONSTERS[terrain] || [])) {
      monsters.push({ id, level, x: 0, y: 0 });
    }

    // 通用野生怪物：var_126(10)+1 只（240435-240439）
    const wildCount = (header[10] | 0) + 1;
    for (let i = 0; i < wildCount; i++) {
      const id = pickMonster(g, level);
      if (id) monsters.push({ id, level, x: 0, y: 0 });
    }

    return {
      json: { name: 'wilderness', width: W, height: H, tileset: 1, header, cells, objects: [] },
      entry, exit, monsters, items, terrain,
      name: TERRAIN_NAMES[terrain] || TERRAIN_NAMES.plain,
    };
  }

  /** 在地图上随机替换 count 个格子为指定图块（对应 map_randomtile） */
  function scatterTiles(cells, tileId, count, R) {
    if (!tileId) return;
    let placed = 0, guard = 0;
    while (placed < count && guard < count * 40 + 40) {
      guard++;
      const x = R(W), y = R(H);
      if (!cells[y] || !cells[y][x]) continue;
      cells[y][x] = mk(tileId);
      placed++;
    }
  }

  /** 选一只野生怪（characreate -1, 0, -3, 0 的等价：按危险度加权随机） */
  function pickMonster(g, level) {
    try {
      const id = Elona.CharaFactory.pick(g, Math.max(1, level | 0), {}) | 0;
      return id || 0;
    } catch (_) { return 0; }
  }

  /** 野外地图名（按地形） */
  function nameOf(terrain) {
    return TERRAIN_NAMES[terrain] || TERRAIN_NAMES.plain;
  }

  Elona.WildMap = {
    W, H, WORLD_MAP, TERRAIN, TERRAIN_NAMES,
    terrainOf, terrainOfTile: terrainOf,
    build, nameOf,
  };
})(window);
