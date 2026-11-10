'use strict';
/**
 * 投掷（T 键 → var_486=26 → *label_2975 340795-341420）。
 *
 * 【已确认 流程】
 *   340796-340824  所有权 / 重量 / 不可丢弃(ibit 13) 检查
 *   340873-340888  命中判定：`dist*4 > rnd(投擲111+10) + 投擲111/4` 时落点 ±1 抖动；
 *                  抖动后的格必须是可通行、且不是门/告示板/投票箱/街告示板(21/23/31/33)
 *   340898-340913  消耗 1 个；可放置物品（60000/64000/80000/57000 与 685/906/984/1313/1098）
 *                  在地面生成 1 个副本，其余物品消失
 *   341347-341390  效果：392 → 酸雾(type3)；577 → 火(type5)+mapitem_fire；
 *                  1181 → 9 格烟幕(type9)；其余物品 → 液体(type6)
 *   341393-341419  1048（炸弹）→ 命中角色或火(type5)
 *
 * 【0-EY 追加】341605-341676：57000 类食物命中角色时由 core/foodleft.js 判定
 *   「特殊食物专属效果 / 瞬间进食（含 1/8 噎住）/ 无属性伤害」，
 *   瞬间进食走 Game.eatItemNow 复用 finishEating 的全部结算。
 *
 * 【0-GR 追加】341421-341860 的命中分派整段交 core/throwhit.js：
 *   按 id 的专例（906/1098/1313/984/1079/1080）、类别 57000/60000/64000/80000 的
 *   公共前段与 12 个专例 id（987/1008/1064/1059/1061/1133/1309/1307/1312/1306/
 *   1305/1304/988/989）、以及 578 貯金箱落地散落金币。
 *
 * 【未移植】685 怪物球捕获以外的 var_1321 特殊弹药、以及全部文本/动画/音效。
 *   本模块只返回结构化结果，由 game 输出日志。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const mod = (a, b) => (b === 0 ? 0 : (a % b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  function dist(x1, y1, x2, y2) {
    return Elona.Battle ? Elona.Battle.dist(x1, y1, x2, y2)
      : Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
  }
  function ref(id, f) { return Elona.ItemDB ? Elona.ItemDB.ref(id, f) : 0; }

  /** 该格能否作为投掷落点（340880） */
  function canLand(g, x, y) {
    if (!g.map || !g.map.inBounds(x, y)) return false;
    const cell = g.map.cell(x, y);
    if (g.map.attr(cell[0], 7) & 4) return false;
    if (Elona.MapFeat) {
      const f = Elona.MapFeat.read(g, x, y);
      if ([21, 23, 31, 33].includes(f.type)) return false;
    }
    return true;
  }

  /** 检查物品是否可投掷（340796-340824） */
  function canThrow(c, idx) {
    const it = c.inv && c.inv[idx];
    if (!it || (it.f[0] | 0) <= 0) return { ok: false, reason: 'no-item' };
    if (it.eqSlot >= 0) return { ok: false, reason: 'equipped' };
    if (it.f[18] | 0) return { ok: false, reason: 'equipped' };
    if (Elona.ItemDB && Elona.ItemDB.ibit && Elona.ItemDB.ibit(13, it)) {
      return { ok: false, reason: 'no-drop' };
    }
    // 296766-296769：已捕获生物的怪物球不能再投
    if (it.id === 685 && (it.f[23] | 0) !== 0) return { ok: false, reason: 'occupied' };
    const cat = ref(it.id, 5);
    if (cat === 60000 || cat === 64000 || cat === 80000) {
      if (limit(idiv(it.f[7] | 0, 1000), 0, 1000) > c.skill(153) + 5) {
        return { ok: false, reason: 'too-heavy' };
      }
    }
    return { ok: true };
  }

  /** (x,y) 上的活跃角色 */
  function charaAt(g, x, y) {
    for (const c of g.charas || []) {
      if (c && c.get(0) === 1 && c.x === x && c.y === y) return c;
    }
    return null;
  }

  /**
   * 怪物球捕获 —— 340944-340987。
   * 条件：目标非店主/非特殊、目标等级 ≤ 球等级(var_99(26))、
   *       目标 HP ≤ 最大 HP/10、且不在禁止捕获的地图。
   * 成功：var_99(23)=creatureId、var_99(27)=等级、var_99(7)=10000、var_99(1)=1000。
   */
  function capture(g, thrower, target, ball) {
    const cbit = (c, bit) => (Elona.Status ? Elona.Status.cbit(c, bit) : 0);
    if (cbit(target, 976) || cbit(target, 992)) return { ok: false, reason: 'immune' };
    if ((target.get(150) | 0) !== 0) return { ok: false, reason: 'immune' };
    if ((target.get(25) | 0) === 6) return { ok: false, reason: 'immune' };
    const ballLv = ball.f[26] | 0;
    if (target.level > ballLv) return { ok: false, reason: 'ball-level', ballLv, level: target.level };
    if (target.hp > idiv(target.hpMax, 10)) return { ok: false, reason: 'too-strong' };
    const map = g.getV65 ? g.getV65(20) : 0;
    const floor = g.getV65 ? g.getV65(22) : 0;
    if (map === 6 || map === 40 || map === 35 || (map === 30 && floor === 1)) {
      return { ok: false, reason: 'area' };
    }
    ball.f[23] = target.get(27) | 0;       // creature id
    ball.f[27] = target.level | 0;         // captured level
    ball.f[7] = 10000;
    ball.f[1] = 1000;
    target.set(0, 0);                      // chara_vanquish
    if (g.map) {
      const cell = g.map.cell(target.x, target.y);
      if (cell) cell[1] = 0;
    }
    if (g.syncCharaCells) g.syncCharaCells();
    if (Elona.QuestCheck) Elona.QuestCheck.check(g);      // chara_vanquish 之后
    return { ok: true, creatureId: ball.f[23], level: ball.f[27] };
  }

  /**
   * 投掷一件物品。
   * @param {object} g
   * @param {object} c      投掷者
   * @param {number} idx    背包下标
   * @param {number} tx,ty  目标格
   * @returns {object}
   */
  function throwItem(g, c, idx, tx, ty) {
    const chk = canThrow(c, idx);
    if (!chk.ok) return chk;
    const it = c.inv[idx];
    const R = (n) => (g.rng || Elona.rng).rnd(n);
    const skill = c.skill(111);

    // ---- 340873-340888：命中/落点抖动 ----
    let lx = tx | 0, ly = ty | 0;
    const d = dist(c.x, c.y, lx, ly);
    let missed = false;
    if (d * 4 > R(skill + 10) + idiv(skill, 4)) {
      const nx = lx + R(2) - R(2), ny = ly + R(2) - R(2);
      if (canLand(g, nx, ny)) { lx = nx; ly = ny; }
      missed = true;
    }
    if (!canLand(g, lx, ly)) return { ok: false, reason: 'blocked' };

    const itemId = it.id;
    const cat = ref(itemId, 5);
    const count = it.f[0] | 0;

    // ---- 340944-340987：怪物球捕获（不消耗球） ----
    if (itemId === 685) {
      const target = charaAt(g, lx, ly);
      if (target) {
        const cap = capture(g, c, target, it);
        return { ok: true, missed, itemId, count, target: { x: lx, y: ly }, captured: cap, effect: [] };
      }
    }

    // ---- 340898-340913：消耗 1 个 ----
    it.f[0] = count - 1;
    if (it.f[0] <= 0) c.inv[idx] = null;
    // 340870：玩家投掷「贴图 354」的药水时，瓶塞 +1（并与饮用一样给斗志 +5）
    if ((c.index | 0) === 0 && Elona.Potion) {
      if (Elona.Potion.addPlug) Elona.Potion.addPlug(g, it, 1);
    }

    // 可放置类 → 地面副本
    const placeable = [685, 906, 984, 1313, 1098].includes(itemId)
      || [60000, 64000, 80000, 57000].includes(cat);
    let placed = null;
    if (placeable && Elona.Item) {
      const copy = Elona.Item.fromJSON(it.toJSON());
      copy.f[0] = 1;
      copy.f[5] = lx; copy.f[6] = ly; copy.f[21] = -1;
      copy.eqSlot = -1;
      g.groundItems.push(copy);
      if (g.refreshGroundCell) g.refreshGroundCell(lx, ly);
      placed = copy;
    }

    // ---- 0-GR：命中角色的效果分派（341421-341860，见 core/throwhit.js）----
    //   涵盖按 id 的专例（906/1098/1313/984/1079/1080）、类别 57000/60000/64000/80000
    //   的公共前段与 12 个专例 id；57000 食物的瞬间进食仍由 core/foodleft.js 承担。
    let food = null;
    let hit = null;
    const hitChara = charaAt(g, lx, ly);
    if (hitChara && Elona.ThrowHit) {
      hit = Elona.ThrowHit.hit(g, c, hitChara, placed || it, { skill });
      if (hit && hit.food) food = hit.food;
      if (hit && hit.consumed && placed && (placed.f[0] | 0) <= 0) placed = null;
    }

    // ---- 341347-341390：落地效果 ----
    // 源码顺序：392 → 酸(type3)；577 → 火(type5)+mapitem_fire；1181 → 烟(type9)；
    //           其余 → 液体(type6)。
    // 注：1048（炸弹）的火效果在**使用**路径（341393-341419），不在投掷落地路径。
    const effect = [];
    // 食物被吃掉 / 触发专属效果时源码直接 goto *label_4358，不再生成地面液体效果
    if (g.mef && !(food && (food.special || food.eaten))) {
      if (itemId === 392) {
        g.mef.add(g, lx, ly, 3, 19, R(15) + 5, 50 + skill * 10, c.index);
        effect.push('acid');
      } else if (itemId === 577) {
        g.mef.add(g, lx, ly, 5, 24, R(15) + 25, 50 + skill * 10, c.index);
        if (Elona.ItemDB && Elona.ItemDB.mapitemFire) Elona.ItemDB.mapitemFire(g, lx, ly, c);
        effect.push('fire');
      } else if (itemId === 1181) {
        for (let k = 0; k < 120; k++) {
          const nx = lx + R(3) - R(3), ny = ly + R(3) - R(3);
          if (dist(lx, ly, nx, ny) >= 3 || !canLand(g, nx, ny)) continue;
          g.mef.add(g, nx, ny, 9, 963, 30, 500);
        }
        effect.push('smoke');
      } else if (itemId !== 1048 && cat !== 60000 && cat !== 64000 && cat !== 80000) {
        g.mef.add(g, lx, ly, 6, 27, -1, 50 + skill * 10, c.index, itemId, it.f[17] | 0, 0);
        effect.push('liquid');
      }
    }

    // ---- 341846-341860：落到地面的收尾（578 貯金箱散落 f[25] 枚金币）----
    let ground = null;
    if (!hitChara && Elona.ThrowHit) {
      ground = Elona.ThrowHit.ground(g, placed || it, lx, ly);
    }

    return {
      ok: true, missed, itemId, count, target: { x: lx, y: ly },
      placed, effect, skill, food, hit, ground,
      messages: (hit && hit.messages) ? hit.messages : [],
    };
  }

  /** 自动寻找最近的敌对目标（*label_2841 的简化：距离最近 + 有视线） */
  function nearestEnemy(g, c, maxDist) {
    let best = null, bd = 1e9;
    for (const t of g.charas || []) {
      if (!t || t === c || t.get(0) !== 1) continue;
      if (t.get(9) >= 0) continue;                 // 非敌对
      const d = dist(c.x, c.y, t.x, t.y);
      if (d > (maxDist || 20) || d >= bd) continue;
      if (Elona.Spell && Elona.Spell.fovLos && !Elona.Spell.fovLos(g, c.x, c.y, t.x, t.y)) continue;
      best = t; bd = d;
    }
    return best;
  }

  Elona.Throw = { canThrow, canLand, throwItem, nearestEnemy, capture, charaAt, dist };
})(window);
