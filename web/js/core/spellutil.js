'use strict';
/**
 * type-0 实用法术 —— `*label_2965` 里 `var_1302` 分派的那批「非伤害」法术。
 *
 * 【为什么单独一个文件】
 *   spell.js 的 effectType0 已经把伤害/召唤/吐息/变异等分支写满了；剩下 16 条
 *   都是「改地图 / 改状态 / 开窗口」的杂项，逐条塞回去会让那个函数更难读。
 *   这里按 `var_1302 == id` 的顺序逐条照抄，spell.js 只留一行转交。
 *
 * 【移植依据】hsp/start.hsp：
 *   406 清浄なる光   320021-320095   范围内友军各净化 1 个 debuff（天罚 13 除外）
 *   407 全浄化       320096-320149   对自己净化全部 debuff
 *   412 解呪         320592-320704   按 var_578 与随机阈值解除装备的诅咒
 *   413 神託         320705-320744   列出已生成的黑星物品（var_535 缓冲）
 *   429 魔法の地図   321209-321278   把地形写进「已知」层
 *   430 物質感知     321205-321350   同上 + 标记有物/有人/有 mef 的格
 *   438 壁生成       326841-326905   目标格变成墙
 *   457 扉生成       326837-326905   目标格生成一扇门（type 21）
 *   439 肉体復活     324865-324960   healsp 3 + 清除肉体弱化
 *   440 精神復活     324861-324960   +4 斗志（<50 时）+ 清除精神弱化
 *   454 自己の変容   320226-320274   玩家改别名；怪物换贴图
 *   461 復活         320497-320591   复活队伍里的死者（成功率按 461 的公式）
 *   463 四次元ポケット 340375-340428 打开临时口袋（容量 = 法强/10+10）
 *   464 魔術士の収穫 340343-340374   按法强掉 4..10 次收获
 *   465 メテオ       327791-327855   全图火属性伤害 + 随机破坏地形 + 火 mef
 *   466 グラビティ   327215-327249   4 格内无羽化者累积重力
 *
 * 【与 wiki 的关系】
 *   公式与判定一律以 start.hsp 为准；wiki（旧版）只用来交叉核对「这条法术应当
 *   做什么」。wiki 里 406 的「降低量 = 法术强度 / 持续回合 -法强/5」与源码
 *   320078-320079 完全一致，可作为对照。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));   // HSP 的 `\`（向零截断）
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));

  /** var_75(0, id) == 2 的 debuff 一览（从 start.hsp 413-900 的初始化表提取） */
  const DEBUFF = [2, 6, 8, 9, 11, 13, 16, 39, 56, 57, 61, 71];
  const BUFF_PUNISH = 13;          // 天罚：406/407 明确跳过

  const H = {};

  // ---------------------------------------------------------------- 工具
  function R(g, n) {
    const v = Math.max(1, n | 0);
    if (g && g.rng && g.rng.rnd) return g.rng.rnd(v);
    if (g && g.rng && typeof g.rng === 'function') return g.rng(v);
    return 0;
  }
  function gv(g, n) { return (g && g.getV65) ? (g.getV65(n) | 0) : 0; }
  function sv(g, n, v) { if (g && g.setV65) g.setV65(n, v); }
  function dist(a, b) {
    if (Elona.Battle && Elona.Battle.dist) return Elona.Battle.dist(a.x, a.y, b.x, b.y);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
  function los(g, a, b) {
    const S = Elona.Spell;
    if (S && S.fovLos) return S.fovLos(g, a.x, a.y, b.x, b.y);
    return true;
  }
  function field(id, idx) {
    return (Elona.Spell && Elona.Spell.field) ? (Elona.Spell.field(id, idx) | 0) : 0;
  }
  function status() { return Elona.Status || null; }
  function buffId(t, slot) { return t.get(280 + slot * 3) | 0; }
  function buffPow(t, slot) { return t.get(280 + slot * 3 + 1) | 0; }
  function buffTurn(t, slot) { return t.get(280 + slot * 3 + 2) | 0; }
  function delBuff(t, slot) {
    const S = status();
    if (S && S.delbuff) S.delbuff(t, slot);
  }
  function allies(g, caster) {
    const out = [];
    for (const t of (g.charas || [])) {
      if (!t || (t.get(0) | 0) !== 1) continue;
      if (caster.index < 16) { if (t.index >= 16) continue; }
      else if ((t.get(9) | 0) !== (caster.get(9) | 0)) continue;
      out.push(t);
    }
    return out;
  }
  /** 净化一个 debuff（320064-320089）。返回 { purged, reduced } */
  function purgeOne(g, t, power) {
    let purged = 0, reduced = 0;
    for (let slot = 15; slot >= 0; slot--) {          // var_399 = 16-cnt-1
      if (purged >= 1) break;                          // 406 只净化 1 个
      const bid = buffId(t, slot);
      if (bid === 0 || bid === BUFF_PUNISH) continue;
      if (DEBUFF.indexOf(bid) < 0) continue;           // var_75(0, id) != 2
      if (R(g, power * 2 + 1) > R(g, buffPow(t, slot) + 1)) {   // 320073
        delBuff(t, slot);
        purged++;
        continue;
      }
      t.set(280 + slot * 3 + 1, buffPow(t, slot) - power);
      t.set(280 + slot * 3 + 2, buffTurn(t, slot) - idiv(power, 5));
      if (buffPow(t, slot) <= 0 || buffTurn(t, slot) <= 0) {
        delBuff(t, slot);
        purged++;
      } else reduced++;
    }
    return { purged, reduced };
  }

  // ---------------------------------------------------------------- 406 清浄なる光
  H[406] = function (g, caster, id, tg, power) {
    if ((g.var2362 | 0) <= -1) {
      return { ok: true, implemented: true, cursed: true, message: '恶魔的笑声在耳边回荡，光没有聚起来。' };
    }
    const range = (field(656, 3) % 1000) + 1;                  // 320050
    const hits = [];
    for (const t of allies(g, caster)) {
      if (t === caster) { /* 自己也吃，源码没有排除 */ }
      if (dist(caster, t) > range) continue;
      if (!los(g, caster, t)) continue;
      const r = purgeOne(g, t, power);
      hits.push({ index: t.index, purged: r.purged, reduced: r.reduced });
    }
    const n = hits.reduce((s, h) => s + h.purged, 0);
    return {
      ok: true, implemented: true, purge: hits,
      message: n ? `清净的光辉驱散了 ${n} 个弱化效果。` : '光只是闪了一下。',
    };
  };

  // ---------------------------------------------------------------- 407 全浄化
  H[407] = function (g, caster, id, tg, power) {
    const target = (caster.index !== 0 && tg && tg.get(0) === 1) ? tg : caster;
    if ((g.var2362 | 0) <= -1) {
      return { ok: true, implemented: true, cursed: true, message: '恶魔的笑声在耳边回荡，净化失败了。' };
    }
    let purged = 0, reduced = 0;
    for (let slot = 15; slot >= 0; slot--) {
      const bid = buffId(target, slot);
      if (bid === 0 || bid === BUFF_PUNISH) continue;
      if (DEBUFF.indexOf(bid) < 0) continue;
      if (R(g, power * 2 + 1) > R(g, buffPow(target, slot) + 1)) {
        delBuff(target, slot); purged++; continue;
      }
      target.set(280 + slot * 3 + 1, buffPow(target, slot) - power);
      target.set(280 + slot * 3 + 2, buffTurn(target, slot) - idiv(power, 5));
      if (buffPow(target, slot) <= 0 || buffTurn(target, slot) <= 0) {
        delBuff(target, slot); purged++;
      } else reduced++;
    }
    return {
      ok: true, implemented: true, target, purge: { purged, reduced },
      message: purged ? `全部净化：${purged} 个弱化效果消散了。` : '弱化效果被削弱了。',
    };
  };

  // ---------------------------------------------------------------- 412 解呪
  H[412] = function (g, caster, id, tg, power) {
    const target = (tg && tg.get(0) === 1) ? tg : caster;
    if ((g.var2362 | 0) <= -1) {
      return { ok: true, implemented: true, cursed: true, message: '恶魔的笑声在耳边回荡，解咒失败了。' };
    }
    let okCount = 0, resist = 0;
    const inv = target.inv || [];
    for (let k = 0; k < inv.length; k++) {
      const it = inv[k];
      if (!it || !it.f) continue;
      if ((it.f[0] | 0) <= 0) continue;
      const bless = it.f[17] | 0;
      if (bless >= 0) continue;                              // 320628：没被诅咒
      let need = 0;                                          // var_400
      if (bless === -1) need = R(g, 200) + 1;                // 320634
      if (bless === -2) need = R(g, 1000) + 1;               // 320637
      if ((g.var2362 | 0) >= 1) need = idiv(need, 2) + 1;    // 320640
      // 320643：未祝福时只对**已装备**的物品生效（var_99(18) 是装备槽，0 = 没穿）
      else if ((it.eqSlot | 0) < 0) continue;
      if (!need) continue;
      if (power >= need) { it.f[17] = 0; okCount++; }        // 320648-320651
      else resist++;
    }
    if (okCount) {
      if (Elona.Stats && Elona.Stats.applyEquipment) Elona.Stats.applyEquipment(target, g);
      if (Elona.Stats && Elona.Stats.recalcStats) Elona.Stats.recalcStats(target, g);
    }
    return {
      ok: true, implemented: true, target, uncursed: okCount, resisted: resist,
      message: okCount ? `${okCount} 件装备的诅咒被解除了。`
        : (resist ? '几件物品抵抗了光环，诅咒还在。' : '什么也没有发生……'),
    };
  };

  // ---------------------------------------------------------------- 413 神託
  H[413] = function (g, caster, id, tg, power) {
    if (tg && (tg.index | 0) >= 16) {
      return { ok: true, implemented: true, message: '什么也没有发生……' };
    }
    if ((g.var2362 | 0) <= -1) {
      return { ok: true, implemented: true, cursed: true, message: '耳边有细语，却听不清任何一个字。' };
    }
    const log = (Elona.ItemDB && Elona.ItemDB.artifactLog) ? Elona.ItemDB.artifactLog : [];
    if (!log.length) {
      return { ok: true, implemented: true, oracle: [], message: '还没有生成任何特殊物品。' };
    }
    const names = log.map((x) => x.name).filter(Boolean);
    return { ok: true, implemented: true, oracle: names, messages: names };
  };

  // ---------------------------------------------------------------- 429 魔法の地図 / 430 物質感知
  function senseCells(g, caster, id, power) {
    const w = g.map ? (g.map.width | 0) : 0;
    const h = g.map ? (g.map.height | 0) : 0;
    if (!w || !h) return 0;
    const cursed = (g.var2362 | 0) <= -1;
    const blessed = (g.var2362 | 0) >= 1;
    const times = (id === 430) ? 2 : 1;                       // 321220-321223
    let marked = 0;
    const items = g.groundItems || [];
    // 0-DW：揭示要同时更新迷雾的 seen 表（原版写 var_704(x,y,2)）
    const mark = (x, y) => {
      if (Elona.Fov && Elona.Fov.reveal) Elona.Fov.reveal(g, x, y);
      else if (g.map.markSeen) g.map.markSeen(x, y);
      else {
        // 没有迷雾层（测试桩 / 极简地图）时直接写记忆图块：
        //   321241 / 321245 `var_704(x,y,2) = var_704(x,y,0)`
        const c = g.map.cell(x, y);
        if (c) c[2] = c[0];
      }
      marked++;
    };
    for (let pass = 0; pass < times; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const cell = g.map.cell(x, y);
          if (!cell) continue;
          const d = Elona.Battle && Elona.Battle.dist
            ? Elona.Battle.dist(caster.x, caster.y, x, y)
            : Math.max(Math.abs(caster.x - x), Math.abs(caster.y - y));
          if (cursed) {                                       // 321230-321237
            if (id === 429) cell[2] = R(g, 256);
            if (id === 430) cell[5] = 0;
            continue;
          }
          if (!(d <= 7 || R(g, power + 1) > R(g, d * 8 + 1) || blessed)) continue;  // 321239
          if (id === 429) mark(x, y);
          if (id === 430) {
            // 321244：feat / 显示物品 / 角色 / 地面物品
            const hasThing = (cell[1] | 0) !== 0 || (cell[6] | 0) !== 0
              || (cell[4] | 0) !== 0
              || items.some((it) => {
                if (!it) return false;
                const ix = it.f ? (it.f[5] | 0) : (it.x | 0);
                const iy = it.f ? (it.f[6] | 0) : (it.y | 0);
                return ix === x && iy === y && (!it.f || (it.f[0] | 0) > 0);
              });
            if (hasThing) mark(x, y);
          }
        }
      }
    }
    return marked;
  }
  /**
   * 430 物质感知的附带发现（321283-321332）：
   *   循环范围是 -5..+7（13×13），其中 |dx|<=7 且 |dy|<=7 的部分才提示陷阱 / 隐藏通路；
   *   小徽章（feat 32）在整圈范围内都会变成地面物品 622（地图 35 除外）。
   */
  function senseDiscover(g, caster) {
    const M = Elona.MapFeat;
    const map = g.map;
    if (!M || !map || !g.groundItems) return [];
    const msgs = [];
    const mapId = g.getV65 ? (g.getV65(20) | 0) : 0;
    const cx = caster.x | 0, cy = caster.y | 0;
    for (let dy = -5; dy <= 7; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= map.height) continue;
      for (let dx = -5; dx <= 7; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= map.width) continue;
        const f = M.read(g, x, y);
        if (!f.raw) continue;
        if (Math.abs(cy - y) <= 7 && Math.abs(cx - x) <= 7) {
          if (f.type === 14 && f.sub === 0) {
            M.reveal(g, x, y);                                  // *label_3010
            msgs.push('你感知到了陷阱。');
          }
          if (f.type === 22) {                                  // *label_3011
            const cell = map.cell(x, y);
            if (cell) cell[0] = Elona.MapTileset ? Elona.MapTileset.hiddenGround(g) : 33;
            M.clear(g, x, y);
            if (Elona.Fov && Elona.Fov.reveal) Elona.Fov.reveal(g, x, y);
            msgs.push('你感知到了隐藏的通路。');
          }
        }
        if (f.type === 32 && mapId !== 35) {                    // 321317：小徽章
          M.clear(g, x, y);
          if (Elona.ItemDB) {
            const it = Elona.ItemDB.createItem(622, 1);
            if (it) {
              it.f[5] = x; it.f[6] = y; it.f[21] = -1;
              g.groundItems.push(it);
              if (g.refreshGroundCell) g.refreshGroundCell(x, y);
            }
          }
          msgs.push('你找到了一枚小徽章！');
        }
      }
    }
    return msgs;
  }

  H[429] = function (g, caster, id, tg, power) {
    if (tg && (tg.index | 0) >= 16) {
      return { ok: true, implemented: true, message: '什么也没有发生……' };
    }
    const n = senseCells(g, caster, 429, power);
    return {
      ok: true, implemented: true, sensed: n,
      message: (g.var2362 | 0) <= -1 ? '咦……？你出现了轻微的失忆。' : '你察觉到了周围的地形。',
    };
  };
  H[430] = function (g, caster, id, tg, power) {
    if (tg && (tg.index | 0) >= 16) {
      return { ok: true, implemented: true, message: '什么也没有发生……' };
    }
    const n = senseCells(g, caster, 430, power);
    // 321283-321332：感知范围（循环 -5..+7）内的陷阱 / 隐藏通路 / 小徽章
    const extra = senseDiscover(g, caster).join('');
    // 原版 321276 会临时把 var_65(173) 设为 10（关闭遮挡）并 msg_halt，随后 321341 归 0。
    // 网页版没有阻塞式等待，记忆图块已经在 senseCells 里写好，这里不再改 var_65(173)。
    return {
      ok: true, implemented: true, sensed: n,
      message: ((g.var2362 | 0) <= -1 ? '咦……？你出现了轻微的失忆。' : '你感知到了周围的物质。') + extra,
    };
  };

  // ---------------------------------------------------------------- 438 壁生成 / 457 扉生成
  /** 目标格（`var_1311/1312`）→ 本项目的 g.dirTile */
  function targetTile(g, tg) {
    if (g && g.dirTile) return { x: g.dirTile.x | 0, y: g.dirTile.y | 0 };
    if (tg && tg.get && tg.get(0) === 1 && tg.tx !== undefined) return { x: tg.tx | 0, y: tg.ty | 0 };
    return null;
  }
  /** 找一块「墙」用的 tile id：优先 2，其次属性表里带「不可通行」的 id */
  function wallTile(g) {
    const m = g.map;
    if (!m) return 2;
    const blocked = (tid) => {
      if (typeof m.attr === 'function') {
        const a = m.attr(tid, 7) | 0;
        if (a) return (a & 4) !== 0;
      }
      return tid === 2 || tid === 3;
    };
    if (blocked(2)) return 2;
    const attrs = m.attrs || {};
    for (const k of Object.keys(attrs)) {
      const tid = parseInt(k, 10);
      if (blocked(tid)) return tid;
    }
    return 2;
  }
  function canPlaceAt(g, x, y, id) {
    const m = g.map;
    if (!m) return { ok: false };
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return { ok: false };
    const cell = m.cell(x, y);
    if (!cell) return { ok: false };
    if ((cell[1] | 0) !== 0) return { ok: false };             // 326862：有角色
    if ((cell[6] | 0) !== 0) return { ok: false };             // 326862：有地物
    const attrs = (typeof m.attr === 'function') ? (m.attr(cell[0], 7) | 0) : 0;
    if (attrs & 4) {                                           // 326850：已经是墙
      if (id !== 457) return { ok: false };
    }
    return { ok: true, cell };
  }
  H[438] = function (g, caster, id, tg, power) {
    const t = targetTile(g, tg);
    if (!t) return { ok: true, implemented: true, message: '那里无法指定。' };
    const chk = canPlaceAt(g, t.x, t.y, 438);
    if (!chk.ok) return { ok: true, implemented: true, message: '那里无法造出墙壁。' };
    const tile = wallTile(g);
    chk.cell[0] = tile;                                        // 326882
    chk.cell[2] = tile;                                        // 326883
    return { ok: true, implemented: true, wall: { x: t.x, y: t.y, tile }, message: '地面隆了起来，形成了一堵墙。' };
  };
  H[457] = function (g, caster, id, tg, power) {
    const t = targetTile(g, tg);
    if (!t) return { ok: true, implemented: true, message: '那里无法指定。' };
    const chk = canPlaceAt(g, t.x, t.y, 457);
    if (!chk.ok) return { ok: true, implemented: true, message: '那里无法造出门。' };
    const MF = Elona.MapFeat;
    if (!MF || !MF.write) return { ok: true, implemented: false, reason: 'MapFeat 未加载' };
    // 326900：cell_featset x, y, 726, 21, rnd(法强/10+1)
    MF.write(g, t.x, t.y, MF.DOOR_CLOSED_ID || 726, MF.TYPE ? MF.TYPE.DOOR_CLOSED : 21,
      R(g, idiv(power, 10) + 1), 0);
    return { ok: true, implemented: true, door: { x: t.x, y: t.y }, message: '一扇门出现了。' };
  };

  // ---------------------------------------------------------------- 439 肉体復活 / 440 精神復活
  function restore(g, caster, id, tg, power) {
    const target = (tg && tg.get(0) === 1) ? tg : caster;
    const S = status();
    if (id === 439) {
      if (S && S.healsp) S.healsp(target, 3);                  // 324878
    } else {
      if ((target.get(182) | 0) < 50) target.set(182, (target.get(182) | 0) + 4);  // 324908
    }
    const cursed = (g.var2362 | 0) <= -1;
    const blessed = (g.var2362 | 0) >= 1;
    if (cursed && (target.get(25) | 0) >= 4) {
      return { ok: true, implemented: true, target, message: '什么也没有发生……' };
    }
    const list = (id === 439)
      ? [10, 11, 12, 17, 18] : [14, 13, 16, 15, 19];            // 324905 / 324937
    let cleared = 0, boosted = 0;
    for (const a of list) {
      const f = 240 + (a - 10);                                 // var_399
      if (cursed) {
        if ((target.get(25) | 0) <= 3) {
          const sorg = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(a, target) | 0) : 100;
          target.set(f, (target.get(f) | 0) - idiv(R(g, sorg), 5) - R(g, 5));
        }
        continue;
      }
      if ((target.get(f) | 0) < 0) { target.set(f, 0); cleared++; }
      if (blessed) {
        const sorg = (Elona.Stats && Elona.Stats.sorg) ? (Elona.Stats.sorg(a, target) | 0) : 100;
        target.set(f, idiv(sorg, 10) + 5);                      // 324954
        boosted++;
      }
    }
    if (Elona.Stats && Elona.Stats.recalcStats) Elona.Stats.recalcStats(target, g);
    const who = (target.index | 0) === 0 ? '你' : (target.name || '对方');
    const what = (id === 439) ? '肉体' : '精神';
    return {
      ok: true, implemented: true, target, cleared, boosted,
      message: cursed ? `${who}的${what}被侵蚀了。` : `${who}的${what}恢复了。`,
    };
  }
  H[439] = (g, c, id, tg, pw) => restore(g, c, 439, tg, pw);
  H[440] = (g, c, id, tg, pw) => restore(g, c, 440, tg, pw);

  // ---------------------------------------------------------------- 454 自己の変容
  H[454] = function (g, caster, id, tg, power) {
    const race = caster.get(27) | 0;
    if (race === 220) return { ok: true, implemented: true, message: '什么也没有发生……' };   // 320228
    // 594（変化）/ 410 且 var_58(58)==100：怪物换贴图，本项目没有对应贴图层
    if (race === 594 || (race === 410 && (caster.get(58) | 0) === 100)) {
      return { ok: true, implemented: true, message: '外形扭曲了一下，但什么也没有改变。' };
    }
    if ((caster.index | 0) !== 0) {
      return { ok: true, implemented: true, message: '什么也没有发生……' };                   // 320261
    }
    return { ok: true, implemented: true, request: 'alias', message: '你感到自己正在改变。' };
  };

  // ---------------------------------------------------------------- 461 復活
  H[461] = function (g, caster, id, tg, power) {
    // 320499：街（地图类别 1）里不能复活
    const kind = (Elona.RandomEvent && Elona.RandomEvent.mapKind)
      ? Elona.RandomEvent.mapKind(g) : 0;
    if (kind === 1) return { ok: true, implemented: true, message: '什么也没有发生……' };
    // 320508：队伍空位（get_freeallyne）。本项目按「在场 + 死亡占用的槽位」统计，
    // 达到上限才拒绝 —— 原版是按魅力决定的可用槽数，这里不细分（登记 A398）。
    const MAX_SLOT = (Elona.Party && Elona.Party.MAX_SLOT) ? Elona.Party.MAX_SLOT : 15;
    let used = 0;
    for (let i = 1; i <= MAX_SLOT; i++) {
      const c = g.charas[i];
      if (c && ((c.get(0) | 0) === 1 || (c.get(0) | 0) === 6)) used++;
    }
    if (used >= MAX_SLOT) {
      return { ok: true, implemented: true, message: '同伴已经满员，无法唤回。' };
    }
    if ((g.var2362 | 0) <= -1) {
      // 320517-320529：诅咒的卷轴/药水反而唤来亡灵 ——
      //   repeat 4+rnd(4)：flt calcobjlv(玩家等级), calcfixlv(3); fltn "undead";
      //   characreate -1, 0（在玩家脚下随机生成不死系怪物）。
      const p = g.player;
      const px = p ? (p.x | 0) : 0, py = p ? (p.y | 0) : 0;
      const lv = (Elona.ItemDB && Elona.ItemDB.calcObjLv)
        ? Elona.ItemDB.calcObjLv(p ? (p.get(38) | 0) : 1, g) : 1;
      const fix = (Elona.ItemDB && Elona.ItemDB.calcFixLv) ? Elona.ItemDB.calcFixLv(3, g) : 3;
      const n = 4 + R(g, 4);
      let made = 0;
      for (let i = 0; i < n; i++) {
        if (Elona.CharaFactory && Elona.CharaFactory.create) {
          const c = Elona.CharaFactory.create(g, 0, lv, px, py, { tagName: 'undead', var641: fix });
          if (c) made++;
        }
      }
      return { ok: true, implemented: true, cursed: true, summoned: made,
        message: '冥界的亡灵被唤了出来！' };
    }
    const dead = (g.charas || []).filter((c) => c && (c.get(0) | 0) === 6 && (c.index | 0) !== 0);
    if (!dead.length) {
      return { ok: true, implemented: true, message: '什么也没有发生……' };
    }
    const pool = dead.filter((c) => (c.get(166) | 0) > 0);
    if (!pool.length) {
      // 320542-320547：选中了但「切换地图前不能复活」
      return { ok: true, implemented: true, message: '切换地图之前无法复活。' };
    }
    // var_91 = limit((关联属性*5 + 法强)/20 + 40, 40, 100)（wiki 461 行公式）
    const sk = caster.skill(field(id, 0)) | 0;
    const chance = limit(idiv(sk * 5 + power, 20) + 40, 40, 100);
    if (chance < R(g, 100)) {
      return { ok: true, implemented: true, revived: false, message: '你的力量没能抵达冥界。' };
    }
    // 320531-320561：原版 `gosub *label_2707` 让玩家选人；本项目取第一个
    // 「还有复活次数」的死者（登记 A398）。
    const c = pool[0];
    const fin = finishRevive(g, caster, c);
    return {
      ok: true, implemented: true, revived: true, target: c, finish: fin,
      message: `${c.name || '同伴'}复活了！`,
    };
  };
  /**
   * 复活的实际结算（320560-320587）：召回身边、清状态、消耗复活次数、好感 +15。
   * spellutil 只做判定，位置与场面交给这里，便于 UI 与 AI 共用。
   */
  function finishRevive(g, caster, c) {
    if (!c) return null;
    const p = g.player;
    const x = p ? p.x : caster.x, y = p ? p.y : caster.y;
    const S = Elona.Spell;
    if (S && S.placeChar) S.placeChar(g, c, x, y);
    else { c.x = x; c.y = y; }
    c.set(0, 1);
    c.set(80, 0);
    if ((c.get(166) | 0) > 0) c.set(166, (c.get(166) | 0) - 1);
    if (Elona.Status && Elona.Status.healhp) Elona.Status.healhp(c, c.get(51) | 0);
    if ((caster.index | 0) === 0) {
      if (Elona.NPC && Elona.NPC.modImp) Elona.NPC.modImp(c, 15, g);
      if ((c.index | 0) >= 16 && Elona.NPC && Elona.NPC.modKarma) Elona.NPC.modKarma(g, 2);
    }
    return { ok: true, index: c.index | 0 };
  }

  // ---------------------------------------------------------------- 463 四次元ポケット
  H[463] = function (g, caster, id, tg, power) {
    // 340413：可收纳的种类上限
    let cap = limit(idiv(power, 10) + 10, 10, 300);
    if (gv(g, 250 + 23) === 1) cap = 4;                        // 340414-340416
    const weight = idiv(power, 10);                            // 340?：重量上限（s）
    if (!g.pocket) g.pocket = { items: [] };
    g.pocket.cap = cap;
    g.pocket.weight = weight;
    return {
      ok: true, implemented: true, request: 'pocket', pocket: g.pocket,
      message: (gv(g, 194) === 104) ? '镜子连通了四次元。' : '你召唤出了四次元口袋。',
    };
  };

  // ---------------------------------------------------------------- 464 魔術士の収穫
  H[464] = function (g, caster, id, tg, power) {
    const out = [];
    const n = limit(4 + R(g, idiv(power, 50) + 1), 1, 10);     // 340346
    for (let i = 0; i < n; i++) {
      let itemId = 54;                                         // 金币
      let count = limit(400 + R(g, power), 400, 800);
      if (R(g, 90) === 0) { itemId = 55; count = 1; }           // 小奖章
      if (R(g, 50) === 0) { itemId = 687; count = 1; }          // 古书
      if (R(g, 200) === 0) { itemId = 622; count = 1; }         // 白金币
      if (R(g, 1500) === 0) { itemId = 621; count = 1; }        // 宝物地图
      const it = (Elona.ItemDB && Elona.ItemDB.createItem)
        ? Elona.ItemDB.createItem(itemId, count, g.rng) : null;
      let placed = false;
      if (it) {
        if (caster.inv && caster.inv.length < 60) { caster.inv.push(it); placed = true; }
        else if (Elona.ItemDB.dropItem) { Elona.ItemDB.dropItem(g, it, caster.x, caster.y); placed = true; }
      }
      out.push({ id: itemId, count, placed });
    }
    return { ok: true, implemented: true, harvest: out, message: `收获出现了 ${n} 次。` };
  };

  // ---------------------------------------------------------------- 465 メテオ
  H[465] = function (g, caster, id, tg, power) {
    // 327793：特定地图（40/37/41）与街里不落
    const mapId = gv(g, 20);
    const kind = (Elona.RandomEvent && Elona.RandomEvent.mapKind)
      ? Elona.RandomEvent.mapKind(g) : 0;
    if (mapId === 40 || kind === 1 || mapId === 37 || mapId === 41) {
      return { ok: true, implemented: true, message: '陨石似乎在平流层就烧尽了……' };
    }
    const w = g.map ? g.map.width : 0, h = g.map ? g.map.height : 0;
    const magic = caster.get(16) | 0;                          // var_82(16)
    const root = Math.sqrt(magic + 1);
    let destroyed = 0, burned = 0;
    const hits = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = g.map.cell(x, y);
        if (!cell) continue;
        if (R(g, 3) === 0) { cell[0] = 12 + R(g, 2); destroyed++; }       // 327815-327817
        if (R(g, 40) === 0 && g.mef && g.mef.add) {                        // 327818-327820
          g.mef.add(g, x, y, 5, 24, R(g, 4) + 3, 50);
          burned++;
        }
        if ((cell[1] | 0) === 0) continue;
        let tIdx = (cell[1] | 0) - 1;
        let t = g.charas[tIdx];
        if (!t || (t.get(0) | 0) !== 1) continue;
        if ((t.get(168) | 0) !== 0 && tIdx !== caster.index) {             // 327823
          const gd = g.charas[t.get(167) | 0];
          if (gd && R(g, (t.get(50) | 0) + 1) < R(g, (gd.get(50) | 0) + 1)) {
            tIdx = t.get(167) | 0; t = gd;
          }
        }
        const dmg = limit(Math.trunc(root) + R(g, Math.trunc(root) + 1), 1, 60) * power;  // 327835
        const applied = (Elona.Battle && Elona.Battle.applyDamage)
          ? Elona.Battle.applyDamage(t, dmg, g, caster, 50, 0)
          : 0;
        if ((t.get(94) | 0) > 0 && ((caster.index | 0) >= 16 || tIdx >= 16)) {  // 327837
          const refl = limit(idiv(dmg * (t.get(94) | 0), 200) + 1, 1, idiv(caster.get(51) | 0, 10));
          if (Elona.Battle && Elona.Battle.applyDamage) {
            Elona.Battle.applyDamage(caster, refl, g, t, 50, 0);
          }
        }
        hits.push({ index: tIdx, dmg: applied });
      }
    }
    return {
      ok: true, implemented: true, meteor: { hits, destroyed, burned },
      message: `陨石落了下来！`,
    };
  };

  // ---------------------------------------------------------------- 466 グラビティ
  H[466] = function (g, caster, id, tg, power) {
    const add = 30 + limit(idiv(power, 700), 0, 70);           // 327236
    const hits = [];
    for (const t of (g.charas || [])) {
      if (!t || (t.get(0) | 0) !== 1) continue;
      if (t === caster) continue;
      if (Elona.Status && Elona.Status.cbit && Elona.Status.cbit(t, 31)) continue;   // 327224
      if (dist(caster, t) > 4) continue;                                            // 327230
      if (Elona.Status && Elona.Status.findbuff && Elona.Status.findbuff(t, 31) !== -1) continue; // 羽化
      t.set(262, (t.get(262) | 0) + add);                        // 327244
      hits.push({ index: t.index, add });
    }
    return {
      ok: true, implemented: true, gravity: hits,
      message: hits.length ? `周围 ${hits.length} 个对象感到了重力。` : '什么也没有发生……',
    };
  };

  function has(id) { return !!H[id | 0]; }
  function run(g, caster, id, tg, power) {
    const fn = H[id | 0];
    if (!fn) return null;
    return fn(g, caster, id, tg, power === undefined ? 0 : (power | 0));
  }

  Elona.SpellUtil = { H, has, run, DEBUFF, purgeOne, finishRevive };
})(typeof window !== 'undefined' ? window : globalThis);
