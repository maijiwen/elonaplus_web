'use strict';
/**
 * 进入地图时的玩家落点（core/entrance.js）—— 0-Y0
 *
 * 【源码依据】start.hsp
 *   map_placecharaonentrance  227797-227932
 *     prm_1085 = var_65(26)（落点模式），prm_1086 = 抖动量
 *     · 1/2   用 var_126(5)/(4) 编码的楼梯坐标
 *     · 3     ★四边缘★：按 var_65(35) 决定落在上/下/左/右哪一边（227819-227902）
 *     · 4     地图正中央（227911-227914）
 *     · 5     随机（227918-227921）
 *     · 6     var_65(5/6) 附近（227922-227925）
 *     · 7     固定坐标 var_1633/1634（227926-227929）
 *     · 8     下边缘中央（227915-227917）
 *     · 227905-227907：var_65(60) != -1 时用 (var_65(60), var_65(61)) 覆盖
 *   var_65(26) = var_132(3, var_65(20))   237616
 *     —— 城镇 site 的 field 3 普遍为 3，即「按进入方向落四边缘」。
 *   var_65(35) 由世界地图上的移动方向决定（606036-606078），并同步到
 *     var_58(83, 0)（玩家朝向，606085）；进图时 300589 / 319981 / 331039
 *     再写回 var_65(35) = var_58(83, 0)。
 *
 *   方向 → 落点（注意是**反方向**的边缘：从北边走进城，就出现在城南）：
 *     var_65(35)==1（向左走进入）→ 右边缘 (W-2, H/2)
 *     var_65(35)==2（向右走进入）→ 左边缘 (1,   H/2)
 *     var_65(35)==3（向上走进入）→ 下边缘 (W/2, H-2)
 *     var_65(35)==0（向下走进入）→ 上边缘 (W/2, 1)
 *
 * 【与旧实现的差别】此前 game.loadMap() 只看 header[5]（入口坐标），
 * 没有就一律从地图中心螺旋找空格，所以从世界地图进任何城镇都出现在中心。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const MODE = {
    UPSTAIRS: 1, DOWNSTAIRS: 2, EDGE: 3, CENTER: 4,
    RANDOM: 5, NEAR: 6, FIXED: 7, BOTTOM: 8,
  };

  /**
   * 606036-606078：世界地图的方向键 → var_65(35)。
   * HSP 的 var_172=上(8) / var_174=下(2) / var_171=左(4) / var_173=右(6)，
   * 四个斜向 7/9/1/3 分别并入上/上/下/下。
   */
  function dirOfMove(dx, dy) {
    const x = dx | 0, y = dy | 0;
    if (y < 0) return 3;          // 上 / 左上 / 右上
    if (y > 0) return 0;          // 下 / 左下 / 右下
    if (x < 0) return 1;          // 左
    if (x > 0) return 2;          // 右
    return 0;
  }

  /**
   * 227819-227902：四边缘落点（含各地图的硬编码特例）。
   * @param {{width:number,height:number}} map
   * @param {number} dir   var_65(35)
   * @param {number} mapId var_65(20)
   * @param {number} sub   var_65(22)
   */
  function edgeSpot(map, dir, mapId, sub) {
    const W = map.width | 0, H = map.height | 0;
    const id = mapId | 0, s = sub | 0;
    const halfW = (W / 2) | 0, halfH = (H / 2) | 0;   // HSP 的 / 是整数除法
    let x, y;
    if (dir === 1) {
      x = W - 2; y = halfH;
      if (id === 15) y = 22;
      if (id === 36) { x = 58; y = 21; }
      if (id === 92) { x = 39; y = 67; }
      if (id === 95) { x = 78; y = 54; }
      if (id === 96) { x = 42; y = 27; }
    } else if (dir === 2) {
      x = 1; y = halfH;
      if (id === 33) y = 3;
      if (id === 36) { x = 25; y = 1; }
      if (id === 92) { x = 1; y = 44; }
      if (id === 95) { x = 1; y = 33; }
      if (id === 96) { x = 1; y = 34; }
    } else if (dir === 3) {
      x = halfW; y = H - 2;
      if (id === 15) x = 30;
      if (id === 33) x = 28;
      if (id === 36) { x = 58; y = 21; }
      if (id === 92) { x = 39; y = 67; }
      if (id === 95) { x = 38; y = 78; }
    } else {
      x = halfW; y = 1;
      if (id === 33) x = 5;
      if (id === 36) { x = 25; y = 1; }
      if (id === 92) { x = 1; y = 44; }
      if (id === 95) { x = 78; y = 12; }
    }
    if (id === 25) { x = 1; y = 14; }
    if (id === 87 && s === 1) { x = 8; y = 18; }
    // 227905-227907：脚本指定的固定落点优先
    return { x, y, dir: dir | 0 };
  }

  /**
   * 按落点模式算坐标；返回 null 表示该模式本项目仍沿用旧逻辑（楼梯 / 随机 / 固定等）。
   * @param {{x:number,y:number}|null} override var_65(60/61)，-1 表示未指定
   */
  function spot(map, mode, dir, mapId, sub, override) {
    const W = map.width | 0, H = map.height | 0;
    if (override && (override.x | 0) >= 0 && (override.y | 0) >= 0) {
      return { x: override.x | 0, y: override.y | 0, src: 'override' };
    }
    const m = mode | 0;
    if (m === MODE.EDGE) {
      const s = edgeSpot(map, dir, mapId, sub);
      s.src = 'edge';
      return s;
    }
    if (m === MODE.CENTER) return { x: (W / 2) | 0, y: (H / 2) | 0, src: 'center' };
    if (m === MODE.BOTTOM) return { x: (W / 2) | 0, y: H - 2, src: 'bottom' };
    return null;
  }

  /**
   * 把落点钳到地图内并向外螺旋找最近可走格（原版 228012 之后由
   * `gosub *label_2236` 的 cell_findspace 负责；网页版等价实现）。
   */
  function place(g, map, opts) {
    const o = opts || {};
    const s = spot(map, o.mode, o.dir, o.mapId, o.sub, o.override);
    if (!s || !map || typeof map.walkable !== 'function') return null;
    const W = map.width | 0, H = map.height | 0;
    const cx = Math.max(1, Math.min(W - 2, s.x | 0));
    const cy = Math.max(1, Math.min(H - 2, s.y | 0));
    if (map.walkable(cx, cy)) return { x: cx, y: cy, src: s.src, exact: true };
    for (let r = 1; r < Math.max(W, H); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
          if (map.walkable(x, y)) return { x, y, src: s.src, exact: false };
        }
      }
    }
    return null;
  }

  Elona.Entrance = { MODE, dirOfMove, edgeSpot, spot, place };
})(typeof window !== 'undefined' ? window : globalThis);
