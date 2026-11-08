'use strict';
/**
 * 世界地图模式 —— 直接使用原版世界地图 ntyris（95×55）
 *
 * 【0-CH 修正】此前的实现是把 world.bmp 采样成 100×60 的自制网格，
 * 与世界地图不符（用户指出第一章世界地图应为 map/ntyris.map）。
 * 现在改为读取提取产物 `web/data/maps/ntyris.json`：
 *   · 通行判定用图块属性（ATTR_WALK & 4 视为阻挡），与普通地图一致
 *   · 城镇坐标沿用 var_132(1/2, mapId)（Towns 的 wx/wy），已核对都在 95×55 内
 *   · 渲染交给 renderer.drawWorldMap（逐格画 tileset 0 的图块）
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const ATTR_WALK = 7;          // 与 map.js 一致：属性位 &4 = 阻挡
  let width = 0, height = 0, tileset = 0;
  let cells = null;             // 原版地块（渲染用）
  let grid = null;              // 通行网格（1 = 可走）
  let promise = null;

  /** 载入 ntyris 地图并构建通行网格 */
  async function load() {
    if (promise) return promise;
    promise = (async () => {
      try {
        const json = await Elona.Data.map('ntyris');
        width = json.width | 0;
        height = json.height | 0;
        tileset = json.tileset | 0;
        cells = (json.cells || []).map((row) => row.map((c) => c.slice()));
        const attrs = (await Elona.Data.tileAttributes()).tilesets[String(tileset)] || {};
        grid = cells.map((row) => row.map((c) => {
          const a = attrs[String(c[0] | 0)] || [];
          return ((a[ATTR_WALK] | 0) & 4) ? 0 : 1;
        }));
        // 城镇所在格及其周围 1 格强制可走（原版城镇入口在世界地图上是可站的）
        const towns = (Elona.Towns && Elona.Towns.LIST) || [];
        for (const t of towns) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = t.wx + dx, y = t.wy + dy;
              if (x >= 0 && y >= 0 && x < width && y < height) grid[y][x] = 1;
            }
          }
        }
        return json;
      } catch (e) {
        return null;
      }
    })();
    return promise;
  }

  /**
   * 当前地图的「行动基准值」—— var_126(9) = var_132(9, 当前地图 id)（237970）。
   * 世界地图（site 4「ノースティリス」）为 50000，城镇/野外为 10000。
   * 时间推进用它算 var_2839（603049）。
   */
  function turnCost(g) {
    const S = Elona.Sites;
    const id = (g && g.getV65) ? (g.getV65(20) | 0) : 0;
    if (S && S.get) {
      const s = S.get(id);
      if (s && s.fields && (s.fields[9] | 0) > 0) return s.fields[9] | 0;
    }
    return 10000;
  }

  function walkable(x, y) {
    x = x | 0; y = y | 0;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (!grid) return true;
    return grid[y][x] === 1;
  }

  /**
   * 0-FC：取世界地图某格的图块 id。
   * 源码 `var_65(62) = var_704(var_58(1,0), var_58(2,0), 0)`（343586）
   * —— 玩家脚下的图块 id，用于判定野外地图的地形（森/草原/荒野/砂丘…）。
   */
  function tileAt(x, y) {
    x = x | 0; y = y | 0;
    if (!cells) return 0;
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const row = cells[y];
    if (!row || !row[x]) return 0;
    return row[x][0] | 0;
  }

  Elona.WorldMap = {
    load,
    walkable,
    turnCost,
    tileAt,
    get width() { return width; },
    get height() { return height; },
    get tileset() { return tileset; },
    get cells() { return cells; },
    get grid() { return grid; },
  };
})(window);
