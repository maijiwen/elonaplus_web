'use strict';
/**
 * 角色视野 / 地图迷雾 —— 原版 `*label_2114`（start.hsp 210909-211000）
 *
 * 【源码口径】
 *   1. 视野范围：固定 17×17 的圆形遮罩 var_2348 / var_1338（*label_2890，304868-304900）：
 *        dist(x, y, 8, 8) < (17-2)/2 + 1 = 8  → 半径 7 格（不含自身格）。
 *      所以「有光照且无墙」时最远看到 7 格，与用户描述一致。
 *      注意：这个遮罩与 var_58(28) 无关；var_58(28)=14 只在 *label_2890 里被夹到 1..16。
 *   2. 遮挡：fov_los(玩家, 目标格)；相邻格恒可见（core/spell.js 已按 36275 实现）。
 *   3. 失明：var_58(253,0) != 0 时只有自身格可见。
 *   4. var_65(20)==40（特殊地图）：不做遮罩与视线判定，视野内全亮。
 *   5. 可见时：var_105(x,y)=var_104，记忆图块 var_704(x,y,2)=var_704(x,y,0)。
 *
 * 【与网页版的对应】
 *   var_105 等价物 = map.vis（每帧重置）
 *   记忆图块      = cell[2]
 *   未探索        = map.seen 为 0（原版用「记忆图块 == var_812」判断）
 *
 * 每次绘制前调用 `Elona.Fov.compute(game)` 即可，不需要在移动逻辑里埋点：
 * 原版也是在绘制前的 *label_2114 里逐帧重算的。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  /** 视野半径（*label_2890 的 17×17 遮罩：dist < 8 → 半径 7） */
  const RADIUS = 7;

  /** 首次进入地图时按 map_setfog / 245630 初始化迷雾（open 地图整图揭示） */
  function ensureInit(g) {
    const map = g && g.map;
    if (!map) return false;
    if (map._fovReady) return true;
    const MT = Elona.MapTileset;
    const fog = MT ? MT.fogTile(g) : 531;
    const open = MT ? MT.isOpen(g) : false;
    map.initFog(fog, open);
    return true;
  }

  /** 玩家是否失明（var_58(253) 或 cbit(7)） */
  function isBlind(p) {
    if (!p) return false;
    if ((p.get(253) | 0) !== 0) return true;
    if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(p, 7) === 1) return true;
    return false;
  }

  /** 整图设为可见（open 地图 / map 40） */
  function revealAllVisible(map) {
    const n = map.width * map.height;
    for (let i = 0; i < n; i++) {
      map.vis[i] = 1;
      map.seen[i] = 1;
    }
    for (let y = 0; y < map.height; y++) {
      const row = map.cells[y];
      for (let x = 0; x < map.width; x++) {
        const c = row[x];
        if (c[2] !== undefined) c[2] = c[0] | 0;
      }
    }
  }

  /** 计算本帧可见性（*label_2114） */
  function compute(g) {
    const map = g && g.map;
    const p = g && g.player;
    if (!map || !p) return;
    if (!ensureInit(g)) return;

    // 245630：这些地图整图可见（城镇 / 野外 / 自家…），只算一次
    if (map.open || (g.getV65 && (g.getV65(20) | 0) === 40)) {
      if (!map._allVisible) {
        revealAllVisible(map);
        map._allVisible = true;
      }
      return;
    }

    map.vis.fill(0);

    const px = p.x | 0, py = p.y | 0;
    if (!map.inBounds(px, py)) return;
    map.setVisible(px, py);                    // 自身格恒可见

    if (isBlind(p)) return;                    // 失明：只显示自身格

    const los = Elona.Spell && Elona.Spell.fovLos;
    const r2 = (RADIUS + 1) * (RADIUS + 1);    // dist < 8
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const y = py + dy;
      if (y < 0 || y >= map.height) continue;
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (dx * dx + dy * dy >= r2) continue; // 圆形遮罩（var_1338）
        const x = px + dx;
        if (x < 0 || x >= map.width) continue;
        // 视线（fov_los）：相邻格恒可见；var_65(173)==10 时全部放行
        if (los && !los(g, px, py, x, y)) continue;
        map.setVisible(x, y);
      }
    }
  }

  /**
   * 只标记「已探索」（魔法地图 429 / 物质感知 430 用）。
   * 与 compute 不同，不改变当前帧的 vis。
   */
  function reveal(g, x, y) {
    const map = g && g.map;
    if (!map) return;
    if (!ensureInit(g)) return;
    map.markSeen(x, y);
  }

  /**
   * 读档后恢复迷雾记忆。
   *   存档里的 cell[2] 就是原版的记忆图块 var_704(x,y,2)，但 GameMap 构造后
   *   首次 initFog 会把整张图重置成雾图块。这里先抄下存档里的记忆图块，
   *   再按「记忆图块 != 雾图块」重建 seen，避免读档后探索过的区域重新被雾盖住。
   */
  function restoreFromSave(g) {
    const map = g && g.map;
    if (!map) return false;
    const MT = Elona.MapTileset;
    const fog = MT ? MT.fogTile(g) : 531;
    const open = MT ? MT.isOpen(g) : false;
    const saved = [];
    for (let y = 0; y < map.height; y++) {
      const row = map.cells[y];
      const line = [];
      for (let x = 0; x < map.width; x++) line.push(row[x][2] === undefined ? 0 : (row[x][2] | 0));
      saved.push(line);
    }
    map.initFog(fog, open);
    // 整图揭示的地图：initFog 已经把 seen 全部置 1，不需要再判断记忆图块
    if (open) return true;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const m = saved[y][x];
        const c = map.cells[y][x];
        if (c[2] !== undefined) c[2] = m;
        // 0 是早期没有迷雾字段的存档的默认值，按「未探索」处理；
        // 雾图块在部分地图有多个变体，用 MapTileset.isFog 判定整族
        const unseen = m === 0 || (MT && MT.isFog ? MT.isFog(g, m) : m === fog);
        if (!unseen) map.seen[y * map.width + x] = 1;
      }
    }
    return true;
  }

  Elona.Fov = { RADIUS, compute, ensureInit, reveal, restoreFromSave, isBlind };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.Fov;
})(typeof window !== 'undefined' ? window : global);
