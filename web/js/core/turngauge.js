'use strict';
/**
 * 行动计（var_58(10, cnt)）—— 0-FY。
 *
 * 【源码】
 *   603045-603049  var_1046 = 速度 × (100 + var_58(37)) / 100（下限 10）
 *                  var_2839 = (var_126(9) - var_58(10,0)) / var_1046 + 1
 *   603063-603070  世界地图上 141 > 2 时：var_58(10,0) = var_126(9)，直接跳到时间累加
 *   603075-603092  repeat 245：每个存活角色
 *                    var_2840 = 速度 × (100 + var_58(37,cnt)) / 100
 *                    NPC 的速度夹在玩家的 1/5 ~ 5 倍之间
 *                    var_2840 下限 10；特定剧情地图强制 100
 *                    var_58(10,cnt) += var_2840 × var_2839
 *   603943-603955  *label_4353：从 var_124 = 0 扫到 245，
 *                    gauge >= var_126(9) 的角色 -= var_126(9) 并取得一次行动，
 *                    一次行动结束后回到 var_124 = 0 重新扫描 —— 速度快的角色
 *                    一个玩家回合里可以连动好几次，速度慢的可能一次也动不了。
 *
 * 本项目原先「一次 endTurn = 所有 NPC 各动一次」，是按平均回合近似。
 * 这里把行动计补齐，由 Game.endTurn() 在 advanceClock() 之后调用 tick()，
 * 再把「本回合每个角色的行动次数」交给 AI.runAll(g, budgets)。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const F_ACTIVE = 0;
  const F_GAUGE = 10;      // var_58(10)
  const F_SPEED = 11;      // var_58(11)
  const F_ROWLEFT = 141;   // var_58(141)
  const F_SPEEDMOD = 37;   // var_58(37) 速度修正（%）

  // 源码没有硬上限，但 NPC 速度被夹在玩家 5 倍以内，一个回合最多约 5~6 次行动。
  const MAX_ACTS = 6;

  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const G = (c, n) => (c && typeof c.get === 'function' ? (c.get(n) | 0) : 0);

  /** var_126(9) = var_132(9, 当前地图 id)（237970） */
  function cost(g) {
    return (Elona.WorldMap && Elona.WorldMap.turnCost)
      ? (Elona.WorldMap.turnCost(g) | 0) : 10000;
  }

  /** var_1046（玩家）或 var_2840 的基础值，不含 NPC 的 1/5~5 倍夹取 */
  function baseSpeed(c) {
    const v = idiv(G(c, F_SPEED) * (100 + G(c, F_SPEEDMOD)), 100);
    return v < 10 ? 10 : v;
  }

  /** var_2839 —— 也用于 603099 的时间累加，必须与 advanceClock() 用同一个值 */
  function delta(g) {
    const p = g && g.player;
    const c = cost(g);
    const d = idiv(c - G(p, F_GAUGE), baseSpeed(p)) + 1;
    return d < 1 ? 1 : d;
  }

  /** var_2840 —— 单个角色这一回合累加的行动计 */
  function speedUnit(g, c, playerSpeed) {
    let s = G(c, F_SPEED);
    if (c !== g.player) {
      const lo = idiv(playerSpeed, 5), hi = playerSpeed * 5;
      if (s < lo) s = lo;
      if (s > hi) s = hi;
    }
    let v = idiv(s * (100 + G(c, F_SPEEDMOD)), 100);
    if (v < 10) v = 10;
    // 603088-603090：特定剧情地图（var_65(252) 865..999 / 地图 76 子区域 179）全员固定 100
    if (g.getV65) {
      const a = g.getV65(252) | 0;
      if (a >= 865 && a < 1000 && (g.getV65(20) | 0) === 76 && (g.getV65(22) | 0) === 179) v = 100;
    }
    return v;
  }

  function onWorldMap(g) {
    if (!g) return false;
    if (g.worldMap) return true;
    const h = g.map && g.map.header;
    return !!(h && (h[6] | 0) === 1);
  }

  /**
   * 推进一回合的行动计。
   * @returns {Object<number, number>} 角色 index → 本回合行动次数（玩家恒为 0，
   *          因为他的这次行动已经在按键处理里做完了）
   */
  function tick(g) {
    const out = Object.create(null);
    const p = g && g.player;
    if (!p) return out;
    const c = cost(g);
    const d = delta(g);
    g.turnDelta = d;                       // 供 advanceClock / 调试用

    // 603063-603070：世界地图长距离移动，跳过全员累加
    if (onWorldMap(g) && G(p, F_ROWLEFT) > 2) {
      p.set(F_GAUGE, c);
      out[p.index | 0] = 0;
      return out;
    }

    const ps = baseSpeed(p);
    const list = [];
    if (g.charas) {
      for (const ch of g.charas) {
        if (!ch || G(ch, F_ACTIVE) !== 1) continue;
        list.push(ch);
      }
    }
    if (list.indexOf(p) < 0) list.unshift(p);

    // 603092
    for (const ch of list) {
      ch.set(F_GAUGE, G(ch, F_GAUGE) + speedUnit(g, ch, ps) * d);
    }

    // *label_4353：把攒够的角色依次兑现，剩余行动计留到下一回合
    for (const ch of list) {
      let gauge = G(ch, F_GAUGE);
      let n = 0;
      if (ch === p) {
        // 玩家这次按键 = 已用掉一次行动。网页版无论 gauge 是否攒够都会执行按键，
        // 所以这里只扣、不产生负数（慢速角色不会卡死）。
        gauge = Math.max(0, gauge - c);
      } else {
        n = Math.min(MAX_ACTS, idiv(gauge, c));
        gauge -= n * c;
      }
      ch.set(F_GAUGE, gauge);
      out[ch.index | 0] = n;
    }
    return out;
  }

  /** 存档/读档兼容：切地图时按 246213 / 252210 清零行动计 */
  function reset(g) {
    if (!g) return;
    if (g.player) g.player.set(F_GAUGE, 0);
    if (g.charas) for (const c of g.charas) if (c) c.set(F_GAUGE, 0);
  }

  Elona.TurnGauge = {
    F_GAUGE, F_SPEED, F_SPEEDMOD, MAX_ACTS,
    cost, delta, baseSpeed, speedUnit, tick, reset, onWorldMap,
  };
})(typeof window !== 'undefined' ? window : globalThis);
