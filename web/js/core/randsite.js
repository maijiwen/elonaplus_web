/**
 * 随机地图放置 —— `map_randsite`（hsp/start.hsp 228777-228919）。
 *
 * 地图生成时按 `var_400` 次调用，每次随机挑一个空格，按**地图类型**（`var_126(6)`）
 * 决定放什么：地面物品、祭坛/喷泉、采集点。
 *
 * 源码结构：
 *   228780-228793  随机挑格（20 次尝试）：不可通行、无特性、无物品 → 选中
 *   228795-228802  世界地图（var_126(6)==1）的落格排除（海岸等）
 *   228803-228818  地图类型 20..27 的第一段：var_126(3)==0 时 1/25 噴水、1/100 祭壇
 *   228820-228842  地图类型 20..27 的第二段：var_126(7)!=0 时放采集点（rnd(10) 四连 + 24 号兜底）
 *   228843-228857  地图 95/96：1139 / 1138 / 1137 三选一
 *   228859-228870  `var_126(6)==3 & var_65(20)!=33`：8/9 月放 1228（喪蝉），末尾 return
 *   228872-228915  地图类型 3/2（迷宫）：631 / 1041 / 55 / 284 / 283 / 随机物品 / 64100 类
 *   228917         地图类型 4：什么也不放
 *
 * 0-Q0 / Q-O1：228859 的条件此前被写成 `mapType === 1`（世界地图），且被放到函数最前；
 *   现按源码改为 `var_126(6) == 3 & var_65(20) != 33`，并移到 95/96 之后、
 *   2/3 迷宫分支之前。源码该分支末尾是**无条件 return**：类型 3 且地图非 33 时，
 *   即便 8 月的 rnd(2) 没命中，也不会落到后面的迷宫掉落分支。
 *   237969 `var_126(6) = var_132(0, var_65(20))`，即项目 `Sites.field(0, mapId)`；
 *   228859 的 `var_65(20) != 33` 排除的是诺耶尔（Noyel）。
 *
 * 0-O0：补 228795-228802 的**世界地图落格排除**（`worldExcluded`）与
 *   228905-228909 的 `var_638 = var_645(rnd(length(var_645)))` 随机类别表（A70）。
 *   旧实现这两处都没有：落格可能压在海岸上，随机物品只给等级/品质、
 *   类别交给 `pickCand` 的默认轮盘。
 *
 * 0-M0：两段 20..27 判定在源码里是**独立的两个 if 块**（第一段的两个 rnd 没命中时
 *   会继续落到第二段放采集点），旧实现写成「indoor 命中不了就 return null」，
 *   少放了采集点。现按源码拆开，并保留 indoor / outdoor 作为旧字段名兼容。
 *
 * 数量（249170-249178）：
 *   var_400 = rnd(W*H/400 + 3)
 *   类型 3 → rnd(rnd(rnd(12)+1)+1)
 *   类型 2 → rnd(var_400 + 1)
 *   类型 1 → rnd(40)
 */
(function (global) {
  'use strict';
  const Elona = global.Elona = global.Elona || {};

  /** 迷宫类地图上的固定物品（228874-228904）。顺序有意义：逐个 rnd 判定，命中即返回。 */
  const DUNGEON_DROPS = [
    { p: 3, id: 631 },     // ムーンゲート
    { p: 8, id: 1041 },    // ブロンズ硬貨
    { p: 15, id: 55 },     // プラチナ硬貨（v65(850)==91 时换成 1041）
    { p: 20, id: 284 },    // 財布(落し物)
    { p: 15, id: 283 },    // カバン(落し物)
  ];

  /**
   * 222064：`var_645` 随机类别表（与 `shop.js` 的 `CAT_645` 同源）。
   * 228906 在 `flt` 之后执行 `var_638 = var_645(rnd(length(var_645)))`，
   * 即先按这张表抽一个物品大类，再 `itemcreate -1, 0, …`。
   * （`10000` / `24000` 各重复一次是原表如此，等同加权。）
   */
  const CAT_645 = [
    10000, 10000, 24000, 24000, 25000, 12000, 16000,
    20000, 19000, 18000, 22000, 14000, 32000, 34000,
  ];

  /**
   * 228795-228802：世界地图（`var_126(6) == 1`）的落格排除。
   *
   *   if 264 <= tile < 363 | (33 <= tile < 57 & tile != 44) → var_1668 = 0
   *
   * 即选中的格如果落在海岸/水面等图块上，本次 `map_randsite` 直接 return，
   * 不放任何东西。项目世界地图数据（`ntyris.json`）沿用同一套图块编号：
   * 264..362 实测 30 种 / 1474 格，33..56 实测 10 种 / 232 格。
   *
   * @param {number} mapType  var_126(6)
   * @param {number} tile     该格的 var_704(x, y, 0)
   * @returns {boolean} true = 本次放置作废
   */
  function worldExcluded(mapType, tile) {
    if ((mapType | 0) !== 1) return false;
    const t = tile | 0;
    if (t >= 264 && t < 363) return true;
    if (t >= 33 && t < 57 && t !== 44) return true;
    return false;
  }

  /** 每层的放置次数（249170-249179） */
  function countOf(mapType, W, H, rnd) {
    const r = rnd || ((n) => Math.floor(Math.random() * n));
    let n = r(Math.max(1, Math.trunc((W * H) / 400) + 3));
    if (mapType === 1) n = r(40);
    if (mapType === 3) n = r(r(r(12) + 1) + 1);
    if (mapType === 2) n = r(n + 1);
    return n;
  }

  /**
   * 掷一次「放什么」——纯逻辑，不碰地图。
   *
   * @param {function} rnd      rnd(n)
   * @param {number} mapType    var_126(6)
   * @param {object} ctx        { month, mapId, playerLevel, v850, fresh, allowSpots,
   *                              rollSite, indoor, outdoor }（后两者为旧别名）
   * @returns {null|{kind:'item', id, god?, level?, fix?, cat?}|{kind:'feat', id, type}}
   */
  function roll(rnd, mapType, ctx) {
    const c = ctx || {};
    const r = rnd || ((n) => Math.floor(Math.random() * n));

    // ---- 地图 95 / 96 的固定三选一（228843-228857）----
    // 源码这段排在 20..27 之后、2/3 之前；这两张图的 var_132(0) 是 6，
    // 所以提到前面统一处理，避免被 2/3 分支抢先。
    if ((c.mapId | 0) === 95 || (c.mapId | 0) === 96) {
      return { kind: 'item', id: [1139, 1138, 1137][r(3)] };
    }

    // ---- 喪蝉 1228（228859-228870）----
    // 0-Q0 / Q-O1：按源码 `var_126(6) == 3 & var_65(20) != 33`。
    //   `var_126(6)=3` 是城镇 / 任务图（静态表里 5 Vernis、12 Yowyn、15 Palmia、
    //   33 Noyel 等 16 张），不是世界地图（col0=1）。33 号被排除，仍会走下面的迷宫掉落。
    //   8 月 `rnd(2)==0`、9 月必定；分支末尾源码 `return`，所以无论有没有命中，
    //   都不会继续到 2/3 迷宫掉落分支（-project 里用 return null 表达「本次什么都不放」）。
    if ((mapType | 0) === 3 && (c.mapId | 0) !== 33) {
      const month = c.month | 0;
      if (month === 8 && r(2) === 0) return { kind: 'item', id: 1228 };
      if (month === 9) return { kind: 'item', id: 1228 };
      return null;
    }

    // ---- 迷宫类（228872-228915）----
    if (mapType === 2 || mapType === 3) {
      if ((c.mapId | 0) === 74) return null;          // 228873 的排除
      for (const d of DUNGEON_DROPS) {
        if (r(d.p) !== 0) continue;
        // 228889：v65(850)==91（某任务状态）时改放 1041
        if (d.id === 55 && (c.v850 | 0) === 91) return { kind: 'item', id: 1041 };
        return { kind: 'item', id: d.id };
      }
      // 228905-228909：随机物品。`flt calcobjlv(rnd(var_58(38,0)+10)), calcfixlv(3)`
      //   之后还有一行 `var_638 = var_645(rnd(length(var_645)))` —— 先抽大类再生成。
      //   0-O0 / A70：此前只返回等级与品质，类别交给 `pickCand` 默认轮盘，
      //   与源码「按 var_645 加权抽一个 t638」不同。随机数消耗顺序按源码：
      //   先 rnd(玩家等级+10) 定等级，再 rnd(14) 抽类别。
      if (r(18) === 0) {
        const level = r(((c.playerLevel | 0) + 10) || 10);
        return { kind: 'random', level, fix: 3, t638: CAT_645[r(CAT_645.length)] };
      }
      // 228911-228914：`flt 10` + `var_639 = 64100` → 10 级、分类 64100 的随机物品。
      // 29237：`itemcreate` 在 `var_639 != 0` 时会强制 `var_638 = 0`，故这条不带 t638。
      return { kind: 'random', level: 10, fix: 0, cat: 64100 };
    }

    // ---- 城镇 / 野外（228803-228842）：两段独立的 if 块 ----
    if (mapType >= 20 && mapType <= 27) {
      // 第一段：var_126(3)==0（本次是新生成的地图，不是从存档恢复）才掷这两次
      const fresh = c.fresh !== undefined ? !!c.fresh : !!c.indoor;
      if (fresh) {
        if (r(25) === 0) return { kind: 'item', id: 173 };           // 噴水
        if (r(100) === 0) return { kind: 'item', id: 172, god: r(9) }; // 祭壇（f[25] = 神 id）
      }
      // 第二段：var_126(7)==0 时连采集点也不放（228820-228821）
      const allowSpots = c.allowSpots !== undefined ? !!c.allowSpots : !!c.outdoor;
      if (!allowSpots) return null;
      const site = c.rollSite ? c.rollSite(r) : null;
      return site ? { kind: 'feat', id: site.id, type: site.type } : null;
    }

    return null;                                      // 228917：类型 4 不放任何东西
  }

  /** 在 cells 里挑一个空格（228780-228793）。返回 null 表示 20 次都没找到。 */
  function pickCell(cells, W, H, rnd, isWalkable) {
    for (let t = 0; t < 20; t++) {
      const x = rnd(Math.max(1, W - 5)) + 2;
      const y = rnd(Math.max(1, H - 5)) + 2;
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const cell = cells[y] && cells[y][x];
      if (!cell) continue;
      if (isWalkable && !isWalkable(cell[0])) continue;
      if ((cell[6] | 0) !== 0) continue;      // 已有特性
      if ((cell[4] | 0) !== 0) continue;      // 已有物品
      return { x, y };
    }
    return null;
  }

  Elona.RandSite = {
    DUNGEON_DROPS, CAT_645, countOf, roll, pickCell, worldExcluded,
  };
})(typeof window !== 'undefined' ? window : globalThis);
