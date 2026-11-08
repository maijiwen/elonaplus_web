/**
 * 随机地图放置 —— `map_randsite`（hsp/start.hsp 228777-228919）。
 *
 * 地图生成时按 `var_400` 次调用，每次随机挑一个空格，按**地图类型**（`var_126(6)`）
 * 决定放什么：地面物品、祭坛/喷泉、采集点。
 *
 * 源码结构：
 *   228780-228793  随机挑格（20 次尝试）：不可通行、无特性、无物品 → 选中
 *   228795-228802  世界地图的排除（海岸等）
 *   228803-228818  地图类型 20..27 且 var_126(3)==0（城镇）：1/25 噴水、1/100 祭壇
 *   228820-228842  地图类型 20..27 且室外：采集点（rnd(10) 四连 + 24 号兜底）
 *   228859-228870  世界地图：8/9 月放 1228（喪蝉）
 *   228872-228915  地图类型 3/2（迷宫）：631 / 1041 / 55 / 284 / 283 / 随机物品 / 64100 类
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
   * @param {object} ctx        { month, mapId, playerLevel, v850, indoor, outdoor, rollSite }
   * @returns {null|{kind:'item', id, god?, level?, fix?, cat?}|{kind:'feat', id, type}}
   */
  function roll(rnd, mapType, ctx) {
    const c = ctx || {};
    const r = rnd || ((n) => Math.floor(Math.random() * n));

    // ---- 世界地图（228859-228870）：8/9 月有喪蝉 ----
    if (mapType === 1) {
      if ((c.month | 0) === 8 && r(2) === 0) return { kind: 'item', id: 1228 };
      if ((c.month | 0) === 9) return { kind: 'item', id: 1228 };
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
      // 228905-228909：随机物品，等级 calcobjlv(rnd(玩家等级+10))、品质 3
      if (r(18) === 0) {
        return { kind: 'random', level: r(((c.playerLevel | 0) + 10) || 10), fix: 3 };
      }
      // 228911-228914：flt 10 / var_639 = 64100 → 10 级、分类 64100 的随机物品
      return { kind: 'random', level: 10, fix: 0, cat: 64100 };
    }

    // ---- 城镇 / 野外（228803-228841）----
    if (mapType >= 20 && mapType <= 27) {
      if (c.indoor) {
        if (r(25) === 0) return { kind: 'item', id: 173 };           // 噴水
        if (r(100) === 0) return { kind: 'item', id: 172, god: r(9) }; // 祭壇（f[25] = 神 id）
      }
      if (!c.outdoor) return null;
      const site = c.rollSite ? c.rollSite(r) : null;
      return site ? { kind: 'feat', id: site.id, type: site.type } : null;
    }

    return null;
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

  Elona.RandSite = { DUNGEON_DROPS, countOf, roll, pickCell };
})(typeof window !== 'undefined' ? window : globalThis);
