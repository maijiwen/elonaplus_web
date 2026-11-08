'use strict';
/**
 * 房间门生成（core/mapdoor.js）—— map_makedoor / map_createroomdoor
 *
 * 【源码依据】hsp/start.hsp：
 *   229145-229174  map_makedoor：对房间表 var_519/520/521/522（x/y/宽/高）里的每个房间，
 *     沿房间四周走一圈（周长 var_522*2 + var_521*2 步），环上的格子不是墙
 *     （var_704(x,y,0) != 1，即走廊凿开的入口）→ cell_featset(x, y, var_1600, 21,
 *     rnd(limit(var_65(22)*3/2+1, 1, 300)))：21 = 闭门，sub = 锁难度（随地图等级 var_65(22)）。
 *   228470-228511  map_createroomdoor：对指定房间（var_1381）与方向 var_1651
 *     （0 上 / 1 右 / 2 左 / 3 下），把边缘内侧的候选位置洗牌后逐一尝试：
 *     门位两侧的两格都在界内且不是墙 → 该格 tile 改为 3（地板）并设门 feat
 *     （var_1653 != 3 的房间类型才设 feat）。
 *
 * 【本实现的近似（登记）】
 *   - 原版在 map_createroom 生成的 BMP 图块地图上运行（tile 1=墙 / 3=地板）；
 *     本项目的 generateDungeon 用 33=地板 / 468=墙，语义一一对应。
 *   - map_makedoor 反编译的环形走位不完整（周长 2w+2h 步、外环实际 2w+2h+4 步），
 *     按语义实现为「房间外环一圈」，即门只出现在走廊凿穿的入口处。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  const WALL = 468, FLOOR = 33;

  function rngOf(g) { return (g && g.rng) || Elona.rng; }

  /** 锁难度（229163 / 228505）：rnd(limit(地图等级*3/2 + 1, 1, 300)) */
  function lockDifficulty(g, level) {
    const lv = (level === undefined) ? ((g && g.getV65) ? (g.getV65(22) | 0) : 0) : (level | 0);
    return rngOf(g).rnd(limit(idiv(lv * 3, 2) + 1, 1, 300));
  }

  function isFloor(map, x, y) {
    if (!map || !map.inBounds(x, y)) return false;
    const cell = map.cell(x, y);
    return !!cell && ((cell[0] | 0) !== WALL) && ((cell[0] | 0) !== 0);
  }

  function setDoorFeat(g, x, y, level) {
    if (Elona.MapFeat && Elona.MapFeat.write) {
      // cell_featset(x, y, var_1600, 21, 难度)
      Elona.MapFeat.write(g, x, y, Elona.MapFeat.DOOR_CLOSED_ID, Elona.MapFeat.TYPE.DOOR_CLOSED,
        lockDifficulty(g, level), -1);
    }
  }

  /**
   * map_makedoor（229145-229174）：给每个房间的入口放门。
   * @param {object} g
   * @param {Array<{x,y,w,h}>} rooms 房间表（对应 var_519/520/521/522）
   * @param {number} [level] 地图等级（缺省 var_65(22)）
   * @returns {number} 放置的门数
   */
  function makeDoors(g, rooms, level) {
    const map = g && g.map;
    if (!map || !Array.isArray(rooms)) return 0;
    let n = 0;
    for (const r of rooms) {
      if (!r) continue;
      // 房间外环：[x-1 .. x+w] × [y-1 .. y+h] 的一圈
      const x0 = r.x - 1, y0 = r.y - 1, x1 = r.x + r.w, y1 = r.y + r.h;
      const ring = [];
      for (let x = x0; x <= x1; x++) { ring.push([x, y0]); ring.push([x, y1]); }
      for (let y = y0 + 1; y <= y1 - 1; y++) { ring.push([x0, y]); ring.push([x1, y]); }
      for (const [x, y] of ring) {
        if (!isFloor(map, x, y)) continue;          // var_704(x,y,0) == 1 → continue
        setDoorFeat(g, x, y, level);
        n++;
      }
    }
    return n;
  }

  /**
   * map_createroomdoor（228470-228511）：在房间指定方向的边缘开一个门。
   * @param {number} dir 0 上 / 1 右 / 2 左 / 3 下（原版 var_1651）
   * @param {number} [roomType] 房间类型（原版 var_1653；==3 时不设 feat）
   * @returns {{ok:boolean, x?:number, y?:number}}
   */
  function createRoomDoor(g, room, dir, level, roomType) {
    const map = g && g.map;
    if (!map || !room) return { ok: false };
    const R = rngOf(g);
    const Rrnd = (n) => R.rnd(Math.max(1, n | 0));
    // var_1652 = 洗牌后的候选下标（0 .. 边长-2），取「内缩 1 格」的位置
    const inner = (dir === 0 || dir === 3) ? room.w : room.h;
    const cand = [];
    for (let k = 0; k < Math.max(0, inner - 2); k++) cand.push(k);
    for (let i = cand.length - 1; i > 0; i--) {      // rndshuffle var_1652
      const j = Rrnd(i + 1);
      const t = cand[i]; cand[i] = cand[j]; cand[j] = t;
    }
    for (const k of cand) {
      let x, y, dx1, dy1, dx2, dy2;
      if (dir === 0) { x = room.x + k + 1; y = room.y; dx1 = 0; dy1 = -1; dx2 = 0; dy2 = 1; }
      else if (dir === 3) { x = room.x + k + 1; y = room.y + room.h - 1; dx1 = 0; dy1 = -1; dx2 = 0; dy2 = 1; }
      else if (dir === 1) { x = room.x + room.w - 1; y = room.y + k + 1; dx1 = -1; dy1 = 0; dx2 = 1; dy2 = 0; }
      else { x = room.x; y = room.y + k + 1; dx1 = -1; dy1 = 0; dx2 = 1; dy2 = 0; }
      // 两侧的两格须在界内且不是墙（var_1442 检查，228496-228503）
      let ok = true;
      for (const [dx, dy] of [[dx1, dy1], [dx2, dy2]]) {
        const nx = x + dx, ny = y + dy;
        if (!map.inBounds(nx, ny)) { ok = false; break; }
        const cell = map.cell(nx, ny);
        if (!cell || (cell[0] | 0) === WALL) { ok = false; break; }
      }
      if (!ok) continue;
      // 该格改成地板（var_704(x,y,0) = 3）并设门 feat
      const cell = map.cell(x, y);
      if (cell) cell[0] = FLOOR;
      if (roomType !== 3) setDoorFeat(g, x, y, level);   // 228505：var_1653 != 3 才设
      return { ok: true, x, y };
    }
    return { ok: false };
  }

  Elona.MapDoor = { makeDoors, createRoomDoor, lockDifficulty };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.MapDoor;
})(typeof window !== 'undefined' ? window : global);
