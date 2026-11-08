'use strict';
/**
 * 地图挖掘工具（core/mapdig.js）—— 对应原版
 *   map_digcheck（228164-228171）、map_nextdir1（228172-228243）、
 *   map_nextdir2（228244-228366）、map_digtoentrance1（228367-228456）
 *
 * 【源码依据】
 *   map_digcheck(x,y)：越界（<1 或 >尺寸-2）→ 0；该格 tile==100（已是通道）→ 100；
 *                      否则返回 (tile==0)（墙 → 可挖，返回 1）
 *   map_nextdir1(tx,ty)：在目标 4 格内按相对位置定方向；否则「主方向」在水平/垂直之间
 *     交替切换、另一轴作为备用方向（蛇形逼近）
 *   map_nextdir2(tx,ty)：若备用方向那一格可挖 → 主/备方向互换（遇阻改道）
 *   map_digtoentrance1(sx,sy,tx,ty,useNext)：从 (sx,sy) 随机游走挖通道（tile=100），
 *     最多 2000 步；每一步按主方向前进，走不通时尝试备用方向；抵达目标相邻格即停。
 *     途中以 `rnd(200) < ambush` 的概率把该格改成 tile 4 并放 feat 22（原版 var_1650）。
 *
 * 方向编码（与原版一致）：0 = 下(y+1)、1 = 左(x-1)、2 = 右(x+1)、3 = 上(y-1)
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const DIR_DX = { 0: 0, 1: -1, 2: 1, 3: 0 };
  const DIR_DY = { 0: 1, 1: 0, 2: 0, 3: -1 };

  /** map_digcheck */
  function digCheck(g, x, y) {
    const W = g.map.width | 0, H = g.map.height | 0;
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) return 0;
    const cell = g.map.cell(x, y);
    if (!cell) return 0;
    const tile = cell[0] | 0;
    if (tile === 100) return 100;
    return tile === 0 ? 1 : 0;
  }

  /** map_nextdir1：更新 st.dir（主）/ st.dir2（备） */
  function nextDir1(st, tx, ty) {
    const x = st.x, y = st.y;
    if (x >= tx - 4 && x <= tx + 4 && y >= ty - 4 && y <= ty + 4) {
      if (x < tx) {
        st.dir = 2;
        st.dir2 = (y > ty) ? 3 : 0;
      }
      if (x > tx) {
        st.dir = 1;
        st.dir2 = (y > ty) ? 3 : 0;
      }
      if (y < ty) {
        st.dir = 0;
        st.dir2 = (x > tx) ? 1 : 2;
      }
      if (y > ty) {
        st.dir = 3;
        st.dir2 = (x > tx) ? 1 : 2;
      }
      return;
    }
    if (st.dir === 1 || st.dir === 2) {
      st.dir = (y > ty) ? 3 : 0;
      st.dir2 = (x > tx) ? 1 : 2;
      return;
    }
    if (st.dir === 3 || st.dir === 0) {
      st.dir = (x > tx) ? 1 : 2;
      st.dir2 = (y > ty) ? 3 : 0;
      return;
    }
  }

  /**
   * map_nextdir2（228244-228330）—— `st.saved` 是原版 var_1644：
   *   「被顶替下来的主方向」。两段逻辑：
   *   ① saved != -1 且那个方向可以挖：
   *        在目标轴线上（x==tx 或 y==ty）→ 主方向与 saved 交换；
   *        否则 → 主方向改为 saved，并清空 saved（-1）。
   *   ② 当前主方向是水平(1/2)且已到目标列 → 若垂直方向可挖，记下旧主方向到 saved、改走垂直；
   *      主方向是垂直(3/0)且已到目标行 → 若水平方向可挖，同理改走水平。
   */
  function nextDir2(g, st, tx, ty) {
    if (st.saved !== -1 && st.saved !== undefined) {
      const s = st.saved;
      const nx = st.x + (DIR_DX[s] || 0);
      const ny = st.y + (DIR_DY[s] || 0);
      if (digCheck(g, nx, ny)) {
        const onAxis = (s === 1 || s === 2) ? (st.x === tx) : (st.y === ty);
        if (onAxis) {
          st.saved = st.dir;
          st.dir = s;
        } else {
          st.dir = s;
          st.saved = -1;
        }
      }
    }
    if (st.dir === 1 || st.dir === 2) {
      if (st.x === tx) {
        if (st.y > ty && digCheck(g, st.x, st.y - 1)) { st.saved = st.dir; st.dir = 3; }
        if (st.y < ty && digCheck(g, st.x, st.y + 1)) { st.saved = st.dir; st.dir = 0; }
      }
      return;
    }
    if (st.dir === 3 || st.dir === 0) {
      if (st.y === ty) {
        if (st.x > tx && digCheck(g, st.x - 1, st.y)) { st.saved = st.dir; st.dir = 1; }
        if (st.x < tx && digCheck(g, st.x + 1, st.y)) { st.saved = st.dir; st.dir = 2; }
      }
    }
  }

  /**
   * map_digtoentrance1
   * @param {object} g
   * @param {number} sx,sy 起点
   * @param {number} tx,ty 目标（挖到它的相邻格为止）
   * @param {number} [useNext] 1 = 全程用 nextdir 导航；0 = 偶尔重新定向
   * @param {object} [opt] { ambush: 0..200（默认 0）, featType: 22 }
   * @returns {number} 1 = 已抵达目标相邻格；0 = 2000 步内未抵达
   */
  function digToEntrance1(g, sx, sy, tx, ty, useNext, opt) {
    opt = opt || {};
    const ambush = opt.ambush === undefined ? 0 : (opt.ambush | 0);
    const featType = opt.featType === undefined ? 22 : (opt.featType | 0);
    const R = (n) => (g.rng ? g.rng.rnd(Math.max(1, n | 0)) : 0);
    const st = { x: sx | 0, y: sy | 0, dir: 0, dir2: -1, saved: -1, reached: 0 };
    if (useNext === 1) {
      st.saved = -1;                        // 原版 var_1644 = -1
      nextDir1(st, tx, ty);
    }
    for (let guard = 0; guard < 2000; guard++) {
      if (st.x === tx && (st.y + 1 === ty || st.y - 1 === ty)) { st.reached = 1; break; }
      if (st.y === ty && (st.x + 1 === tx || st.x - 1 === tx)) { st.reached = 1; break; }
      if (useNext === 1) nextDir2(g, st, tx, ty);
      const nx = st.x + (DIR_DX[st.dir] || 0);
      const ny = st.y + (DIR_DY[st.dir] || 0);
      if (digCheck(g, nx, ny)) {
        st.x = nx; st.y = ny;
        const cell = g.map.cell(nx, ny);
        if (cell) {
          cell[0] = 100;                                   // 通道
          if (ambush > 0 && R(200) < ambush) {
            cell[0] = 4;
            if (Elona.MapFeat && Elona.MapFeat.write) {
              // cell_featset(x, y, tileId=0, featType, sub, arg3) → cell[6] = type*1000
              Elona.MapFeat.write(g, nx, ny, 0, featType, 0, 0);
            }
          }
        }
        if (useNext !== 1 && R(4) === 0) nextDir1(st, tx, ty);
      } else {
        // 主方向走不通 → 尝试「备方向」（nextdir1 设的 dir2，原版 228421-228448）
        const d2 = st.dir2;
        if (d2 >= 0 && d2 <= 3) {
          const ax = st.x + (DIR_DX[d2] || 0);
          const ay = st.y + (DIR_DY[d2] || 0);
          if (digCheck(g, ax, ay)) {
            st.dir = d2;
            st.dir2 = -2;
          }
        }
        if (st.dir2 === -2) { st.dir2 = -1; continue; }
        // 仍不通 → 重新定向（原版 prm_1111==0/1 时都调 nextdir1）
        nextDir1(st, tx, ty);
      }
    }
    return st.reached;
  }

  Elona.MapDig = { digCheck, nextDir1, nextDir2, digToEntrance1, DIR_DX, DIR_DY };
})(window);
