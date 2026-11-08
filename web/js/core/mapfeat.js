'use strict';
/**
 * 地图格 feat（地形特性 / 陷阱）系统
 *
 * 【已确认 数据布局】var_704(x, y, 6) 为打包值（cell_featset / cell_featread，32311-32340）：
 *     id   = v \ 1000                  → var_503(0)  图块/外观 id（234 = 已发现陷阱）
 *     type = v / 1000 \ 100            → var_503(1)  特性类别（14 = 陷阱，22 = 隐藏通路，32 = 小徽章）
 *     sub  = v / 100000 \ 100          → var_503(2)  子类型（陷阱种类 0..28）
 *     arg3 = v / 10000000              → var_503(3)  附加参数
 *
 * 【已移植】
 *   *label_2218 (215598)  侦测：rnd(探知159*15+20+感覚13) > rnd(危险度*8+60)
 *   *label_2219 (215604)  回避：玩家/同伴 & 自设陷阱(sub>=20) 直接回避；
 *                          否则玩家用 rnd(100+危险度*3+379*3+1) vs 感覚/探知，
 *                          NPC 75% 回避
 *   *label_2221 (215631)  解除：rnd(解除175*15+20+器用12) > rnd(危险度*12 + 379*12*var_1446 + 100)
 *   *label_2910 (305989)  解除成功：var_58(178?) 技能经验 + cell_featset(id=0)
 *   *label_3010 (348233)  发现：cell_featset(id=234 / 254 / 255)
 *   *label_2911 (306052-306511) 进入格子后的陷阱判定与 0..28 号陷阱效果
 *
 * 【未移植】非陷阱类特性（门/楼梯/祭坛/矿脉/隐藏通路 22/小徽章 32 等）的表现与交互，
 *   以及 *label_2222（怪物索敌）、陷阱生成 map_trap、hostileaction/事件系统。
 *   文本/动画/音效均省略。
 *
 * 【0-FB 修正】源码 `cell_featset`（32311-32340）的缺省参数全为 0，因此
 *   `cell_featset(id=0)` 是**连 type/sub 一起清空**，并非只清 id。
 *   0-FA 之前 write(id=0) 会保留 type，导致同一格反复被判定为陷阱，只能靠
 *   `f.id === 0` 打补丁。现统一改为 `clear()` 全清，与源码一致。
 *   陷阱的生成放置（map_trap / map_web / map_barrel）已由 `core/dungeonfx.js` 承担。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const mod = (a, b) => (b === 0 ? 0 : (a % b));
  const findbuff = (c, id) => (Elona.Status ? Elona.Status.findbuff(c, id) : -1);
  const cbit = (c, bit) => (Elona.Status ? Elona.Status.cbit(c, bit) : 0);

  const DISCOVERED = 234;      // var_1597
  const DEMOLISH_DISCOVERED = [254, 255];   // var_1598 / var_1599

  /** cell_featread */
  function read(g, x, y) {
    const cell = g.map && g.map.cell(x, y);
    const v = (cell && cell[6]) || 0;
    return { raw: v, id: mod(v, 1000), type: mod(idiv(v, 1000), 100),
      sub: mod(idiv(v, 100000), 100), arg3: idiv(v, 10000000) };
  }

  /**
   * 整格清除特性 —— 对应 `var_704(x, y, 6) = 0`（采集点采尽后 305982）。
   * 注意不能写成 write(g,x,y,0)：那只把 id 归零，type 还在，read() 仍会认出采集点。
   */
  function clear(g, x, y) {
    const cell = g.map && g.map.cell(x, y);
    if (cell) cell[6] = 0;
  }

  /** cell_featset：-1 表示保留原值 */
  function write(g, x, y, id, type, sub, arg3) {
    const cell = g.map && g.map.cell(x, y);
    if (!cell) return;
    const cur = read(g, x, y);
    const i = id === undefined || id === -1 ? cur.id : id;
    const t = type === undefined || type === -1 ? cur.type : type;
    const s = sub === undefined || sub === -1 ? cur.sub : sub;
    const a = arg3 === undefined || arg3 === -1 ? cur.arg3 : arg3;
    cell[6] = i + t * 1000 + s * 100000 + a * 10000000;
  }

  /** cell_featclear */
  function clear(g, x, y) {
    const cell = g.map && g.map.cell(x, y);
    if (cell) cell[6] = 0;
  }

  /** *label_2218：侦测陷阱 */
  function detect(g, c) {
    const r = (n) => (g.rng || Elona.rng).rnd(n);
    return r(c.skill(159) * 15 + 20 + c.skill(13)) > r(dayLevel(g) * 8 + 60);
  }

  /** *label_2219：回避（返回 1 = 回避成功） */
  function avoid(g, c, f) {
    const r = (n) => (g.rng || Elona.rng).rnd(n);
    // 玩家/同伴 & 自设陷阱（sub>=20）→ 直接回避
    if ((c.index === 0 || c.get(9) === 10) && f.sub >= 20) return 1;
    if (f.sub === 7 || f.sub === 15 || f.sub === 16) return 0;
    if (c.get(262) > 0) return 0;
    if (g.getV65 && g.getV65(85) === 2) return 0;
    if (c.index < 16) {
      const dc = 100 + dayLevel(g) * 3 + (g.getV65 ? g.getV65(379) : 0) * 3;
      if (r(dc + 1) < c.skill(13) + c.skill(159) * 4) return 1;
    } else {
      if (r(4) !== 0) return 1;
    }
    return 0;
  }

  /** *label_2221：解除（返回 1 = 成功） */
  function disarm(g, c, f) {
    const r = (n) => (g.rng || Elona.rng).rnd(n);
    const k = (f.sub === 15 || f.sub === 16) ? 10 : 1;
    const dc = dayLevel(g) * 12 + (g.getV65 ? g.getV65(629) : 0) * 12 * k + 100;
    if (r(c.skill(175) * 15 + 20 + c.skill(12)) > r(dc)) {
      // *label_2220
      if (Elona.Stats && Elona.Stats.skillExp && c.get(0) === 1) {
        Elona.Stats.skillExp(c, 175, c.index, 50, 9999, 0, g);
      }
      return 1;
    }
    return 0;
  }

  /** *label_2910：解除成功，去掉陷阱外观 + 深渊魔力奖励（305989-306011） */
  function disarmed(g, c, x, y, f) {
    if (f.sub !== 20 && f.sub !== 21) {
      if (Elona.Stats && Elona.Stats.skillExp && c.get(0) === 1) {
        Elona.Stats.skillExp(c, 175, c.index, 100, 9999, 0, g);
      }
    }
    // cell_featset(x, y, 0)：源码缺省参数全为 0 → **连 type/sub 一起清**（0-FB 修正）
    clear(g, x, y);
    // 305999-306011：玩家或同伴解除、且 sub <= 10 → 深渊魔力 +3（上限 100000）
    if ((c.index === 0 || c.get(9) === 10) && f.sub <= 10 && g.getV65 && g.setV65) {
      let abyss = (g.getV65(250 + 429) | 0) + 3;
      if (abyss > 100000) abyss = 100000;
      g.setV65(250 + 429, abyss);
      if (g.log) g.log(`获得 3 点深渊魔力（当前 ${abyss}）。`);
    }
  }

  /** *label_3010：陷阱被发现（显示为已发现图块） */
  function reveal(g, x, y) {
    const f = read(g, x, y);
    if (g.getV65 && g.getV65(70) === 1013) {
      if (f.sub === 7 || f.sub === 9) { write(g, x, y, DEMOLISH_DISCOVERED[0]); return; }
      if (f.sub === 15 || f.sub === 16) { write(g, x, y, DEMOLISH_DISCOVERED[1]); return; }
    }
    write(g, x, y, DISCOVERED);
  }

  function dayLevel(g) { return (g.getV65 ? g.getV65(22) : 0) | 0; }

  function damage(g, c, dmg) {
    const d = limit(dmg | 0, 0, 2000000000);
    if (Elona.Battle && Elona.Battle.applyDamage) Elona.Battle.applyDamage(c, d);
    return d;
  }

  function cond(g, c, id, power) {
    if (Elona.Resist && g.dmgconTable) Elona.Resist.dmgcon(g, g.dmgconTable, c, id, power);
  }

  /**
   * 进入格子后的处理 —— *label_2911 的 306076-306510。
   * @returns {{type:number, sub:number, avoided?:boolean, disarmed?:boolean,
   *            triggered?:boolean, dmg?:number, revealed?:boolean, effects?:Array}}
   */
  function onEnter(g, c, x, y) {
    const f = read(g, x, y);
    const out = { type: f.type, sub: f.sub, effects: [] };
    if (f.type !== 14) return out;            // 仅处理陷阱
    if (f.id === 0) return out;               // 已解除（见文件头注记）
    const r = (n) => (g.rng || Elona.rng).rnd(n);
    const flying = (cbit(c, 5) && c.get(262) === 0) || findbuff(c, 52) !== -1;

    // ---- 306078-306149：飞行/浮游时尝试解除地面陷阱 ----
    if ((f.sub === 7 || f.sub === 15) && flying) {
      if (c.skill(175) !== 0 && disarm(g, c, f)) { disarmed(g, c, x, y, f); out.disarmed = true; return out; }
      return out;
    }
    if ((f.sub === 8 || f.sub === 20) && flying) {
      if (c.skill(175) !== 0 && disarm(g, c, f)) { disarmed(g, c, x, y, f); out.disarmed = true; return out; }
      return out;
    }
    if ((f.sub === 9 || f.sub === 21 || f.sub === 16) && flying) {
      if (c.skill(175) !== 0 && disarm(g, c, f)) { disarmed(g, c, x, y, f); out.disarmed = true; return out; }
      return out;
    }

    // ---- 306150：玩家侦测 ----
    if (c.index === 0 && f.id !== DISCOVERED) {
      if (detect(g, c)) { reveal(g, x, y); out.revealed = true; f.id = DISCOVERED; }
    }
    // ---- 306160：已发现时的解除尝试 ----
    if (f.id === DISCOVERED) {
      if (c.get(9) !== 10 || f.sub < 20) {
        if (c.skill(175) !== 0) {
          if (disarm(g, c, f)) { disarmed(g, c, x, y, f); out.disarmed = true; return out; }
          return out;                          // 306096：失败则不触发
        }
      }
    }
    // ---- 306179：回避判定 ----
    if (avoid(g, c, f)) {
      out.avoided = true;
      if (c.index === 0) reveal(g, x, y);
      return out;
    }

    // ---- 306194-306507：陷阱发动 ----
    out.triggered = true;
    const day = dayLevel(g);
    const pit379 = g.getV65 ? g.getV65(379) : 0;

    if (f.sub >= 23 && f.sub <= 28) {
      clear(g, x, y);
      const lv = c.level;
      const d = (idiv(c.skill(174) + 1, 5) + 5) * (idiv(c.skill(175) + 1, 5) + 5)
        + r(c.skill(175) * 2 + 5)
        + (limit(lv - 50, 1, 2000) + limit(lv - 100, 1, 2000)) * 4
          * Math.trunc(Math.sqrt(limit(lv, 1, 2000) * 3)) + 31;
      out.dmg = damage(g, c, d);
      const condMap = { 23: 7, 24: 1, 25: 2, 26: 4, 27: 5, 28: 3 };
      if (c.get(0) === 1) cond(g, c, condMap[f.sub], c.skill(175) + day * 2);
    } else if (f.sub === 4) {
      clear(g, x, y); cond(g, c, 4, 100 + day * 2);          // 墨 → 盲目
    } else if (f.sub === 6) {
      clear(g, x, y); cond(g, c, 3, 100 + day * 2);          // 刺激气体 → 麻痺
    } else if (f.sub === 5) {
      clear(g, x, y); cond(g, c, 5, 100 + day * 2);          // 恶臭 → 混乱
    } else if (f.sub === 3) {
      clear(g, x, y);                                        // 传送（encfind(22) 防传送未移植）
      for (let i = 0; i < 200; i++) {
        const nx = r(Math.max(1, g.map.width - 2)) + 1;
        const ny = r(Math.max(1, g.map.height - 2)) + 1;
        if (g.map.walkable(nx, ny)) {
          const old = g.map.cell(c.x, c.y); if (old) old[1] = 0;
          c.x = nx; c.y = ny;
          const nc = g.map.cell(nx, ny); if (nc) nc[1] = c.index + 1;
          break;
        }
      }
      out.teleported = true;
    } else if (f.sub === 0) {
      if (!flying) { clear(g, x, y); out.dmg = damage(g, c, r(day * 2 + 10)); }
    } else if (f.sub === 1) {
      clear(g, x, y); cond(g, c, 1, 100 + day * 2);          // 毒气
    } else if (f.sub === 2) {
      clear(g, x, y); cond(g, c, 2, 100 + day * 2);          // 睡眠气
    } else if (f.sub === 7 || f.sub === 22) {
      // 306357-306362：7 号炸弹带 379（潜在魔力），22 号大炸弹只按层数
      const power = f.sub === 7 ? day + pit379 : day;
      out.dmg = damage(g, c, 50 + limit(r(power + 1) * 5, 1, 99999));
      clear(g, x, y);
    } else if (f.sub === 15) {
      out.dmg = damage(g, c, (50 + limit(r(day + pit379 + 1) * 5, 1, 99999)) * 10);
      clear(g, x, y);
    } else if (f.sub === 8 || f.sub === 20) {
      out.dmg = damage(g, c, limit(idiv(c.skill(18), 2) + limit(r(day + 1) * 2, 1, 9999) - c.get(70), 1, 9999));
      clear(g, x, y);
    } else if (f.sub === 16) {
      out.dmg = damage(g, c, limit(idiv(day + pit379, 2) + limit(r(day + pit379 + 1) * 2, 1, 9999)
        - c.get(71), 2, 9999) * 10);
      if (c.get(0) === 1 && c.get(434) < 2) c.set(434, 2);
      clear(g, x, y);
    } else if (f.sub === 9 || f.sub === 21) {
      const base = f.sub === 9
        ? idiv(day + pit379, 2) + limit(r(day + pit379 + 1) * 2, 1, 9999)
        : idiv(day, 2) + limit(r(day + 1) * 2, 1, 9999);
      out.dmg = damage(g, c, limit(base - c.get(71), 2, 9999));
      if (c.get(0) === 1 && c.get(434) < 2) c.set(434, 2);
      clear(g, x, y);
    }
    return out;
  }

  // ==========================================================================
  // 非陷阱地形（门 / 楼梯 / 祭坛 / 告示板 / 矿脉…）
  // ==========================================================================

  /** var_503(1) 特性类别 */
  const TYPE = {
    STAIRS_UP: 10, STAIRS_DOWN: 11, TRAP: 14, MAPMOVE: 15,
    DOOR_OPEN: 20, DOOR_CLOSED: 21, HIDDEN: 22, BOARD: 23,
    GATHER: 24, MINE: 25, SPRING: 26, REMAINS: 27, PLANT: 28, SEED: 29,
    POT: 30, VOTE: 31, MEDAL: 32, CITYBOARD: 33, BUILDING: 34,
  };

  /**
   * *.obj 的 kind==2 地形对象 → var_1615 表（*label_2337 227323-227390）。
   * 每项 = [type, id, 默认 sub, arg3]。对象参数按 sub = prm%1000, arg3 = prm/1000 写入。
   */
  const OBJ_FEATS = [
    [21, 726, 99, 726],   // 0 dummy
    [21, 726, 99, 726],   // 1 扉99
    [21, 726, 0, 726],    // 2 扉0
    [14, 234, 100, 0],    // 3 罠
    [14, 234, 100, 0],    // 4 罠
    [10, 232, 0, 232],    // 5 昇り階段
    [11, 231, 0, 231],    // 6 降り階段
    [21, 728, 0, 728],    // 7 扉SF
    [23, 727, 0, 727],    // 8 掲示板
    [31, 729, 0, 729],    // 9 投票箱
    [32, 234, 0, 0],      // 10 メダル
    [21, 730, 0, 730],    // 11 扉JP
    [33, 732, 0, 732],    // 12 街掲示板
    [21, 733, 0, 733],    // 13 扉JAIL
    [21, 734, 0, 734],    // 14 扉EW
  ];

  /** var_1605 / var_1600 默认门图块（map_tileset 227422-227423）。 */
  const DOOR_OPEN_ID = 236, DOOR_CLOSED_ID = 726;

  /**
   * 地图对象的 kind==2 项 → cell_featset（map_initcustom 227716-227729）。
   * @param {object} g
   * @param {object[]} objects .obj 解出的 [type,x,y,param,kind]
   */
  function applyObjects(g, objects) {
    if (!g || !g.map || !Array.isArray(objects)) return 0;
    let n = 0;
    for (const o of objects) {
      if (!o || o[4] !== 2) continue;
      const def = OBJ_FEATS[o[0] | 0];
      if (!def) continue;
      const x = o[1] | 0, y = o[2] | 0, prm = o[3] | 0;
      write(g, x, y, def[3], def[0], mod(prm, 1000), idiv(prm, 1000));
      // 227723-227728：记录楼梯坐标到 var_126(4)/(5)
      if (def[0] === TYPE.STAIRS_UP) g.map.header[5] = y * 1000 + x;
      if (def[0] === TYPE.STAIRS_DOWN) g.map.header[4] = y * 1000 + x;
      n++;
    }
    return n;
  }

  /**
   * 开锁/开门 —— *label_3003（345508-345578）。
   * 锁难度 = sub；成功率 `rnd(sub*20+150) < 技能158*20+20`。
   * 成功 → cell_featset(x,y, 236, 20, 0, -1)。
   * @returns {{ok:boolean, locked:boolean, opened?:boolean, reason?:string}}
   */
  function openDoor(g, c, x, y) {
    const f = read(g, x, y);
    if (f.type !== TYPE.DOOR_CLOSED) return { ok: false, reason: 'not-door' };
    if (f.id === 0) return { ok: false, reason: 'broken' };
    if (f.sub > 0) {
      const r = (n) => (g.rng || Elona.rng).rnd(n);
      if (!(r(f.sub * 20 + 150) < c.skill(158) * 20 + 20)) {
        return { ok: false, locked: true, reason: 'fail' };
      }
      if (Elona.Stats && Elona.Stats.skillExp && c.get(0) === 1) {
        Elona.Stats.skillExp(c, 158, c.index, 100 + limit(f.sub, 1, 100), 9999, 0, g);  // 345542
      }
    }
    write(g, x, y, DOOR_OPEN_ID, TYPE.DOOR_OPEN, 0, -1);
    return { ok: true, locked: f.sub > 0, opened: true };
  }

  /** 关门 —— *label_3004（345579-345622）：格上有角色/物品则失败。 */
  function closeDoor(g, c, x, y) {
    const f = read(g, x, y);
    if (f.type !== TYPE.DOOR_OPEN) return { ok: false, reason: 'not-open' };
    const cell = g.map && g.map.cell(x, y);
    if (cell && (cell[1] !== 0 || cell[4] !== 0)) return { ok: false, reason: 'occupied' };  // 345607
    write(g, x, y, DOOR_CLOSED_ID, TYPE.DOOR_CLOSED, -1, -1);
    return { ok: true, closed: true };
  }

  /** 楼梯信息（type 10 / 11）。 */
  function stairsAt(g, x, y) {
    const f = read(g, x, y);
    if (f.type !== TYPE.STAIRS_UP && f.type !== TYPE.STAIRS_DOWN) return null;
    return { up: f.type === TYPE.STAIRS_UP, sub: f.sub, arg3: f.arg3, id: f.id };
  }

  /** 告示板/投票箱/街告示板/小徽章的交互文本（344045-344082）。 */
  function boardText(g, x, y) {
    const f = read(g, x, y);
    switch (f.type) {
      case TYPE.HIDDEN: return '这里似乎有隐藏的通路。';
      case TYPE.MEDAL: return ' *闪耀* ';
      case TYPE.MAPMOVE: return `可以移动到地图 ${f.sub + f.arg3 * 100}。`;
      case TYPE.BOARD: return '告示板。';
      case TYPE.VOTE: return '投票箱。';
      case TYPE.CITYBOARD: return '街告示板。';
      case TYPE.GATHER: return '可以采集。';
      case TYPE.MINE: return '可以采掘。';
      case TYPE.SPRING: return '泉水。';
      case TYPE.REMAINS: return '残骸。';
      case TYPE.PLANT: return '生长着各种植物。';
      case TYPE.SEED: return '种着种子。';
      case TYPE.BUILDING: return '建筑物。';
      default: return null;
    }
  }

  // ---------- 祭坛（var_99(25) = 神 id；refitem(id,9) == 60002） ----------

  /** *label_2606（272104-272115） */
  const GOD_NAMES = [
    '无之艾斯', '机械之玛尼', '风之露露薇', '元素之伊兹帕罗特', '幸运之艾赫卡托尔',
    '大地之奥帕托斯', '治愈之朱亚', '收获之库米罗米', '财富之雅卡泰克特',
  ];

  function refItem(id, field) {
    return Elona.ItemDB ? Elona.ItemDB.ref(id, field) : 0;
  }

  /** 找 (x,y) 上的祭坛物品（item_find 60002） */
  function altarAt(g, x, y) {
    if (!g || !Array.isArray(g.groundItems)) return null;
    for (const it of g.groundItems) {
      if (!it || (it.f[0] | 0) <= 0) continue;
      if (it.f[5] !== x || it.f[6] !== y) continue;
      if (refItem(it.id, 9) === 60002) return it;
    }
    return null;
  }

  /**
   * modpiety（272009-272065）：上限 = 信仰技能(181)×100。
   * 0-ES 起完整逻辑（含 1500/2500/4000 的阶段推进）在 `core/faith.js`。
   * @returns {number} 1 = 已增加；0 = 已达上限
   */
  function modPiety(g, c, amount) {
    if (Elona.Faith && Elona.Faith.modPiety) return Elona.Faith.modPiety(g, c, amount).ok ? 1 : 0;
    const mapId = g.getV65 ? g.getV65(20) : 0;
    if ((c.skill(181) * 100) < c.get(62)) return 0;
    c.set(62, c.get(62) + idiv(amount, 1 + (mapId === 35 ? 9 : 0)));
    return 1;
  }

  /**
   * 在祭坛祈祷 —— *label_2976 / *label_2609 / *label_2613（341861-341870 / 272344-273023）。
   * 0-ES 起完整逻辑在 `core/faith.js`（改宗要经过菜单，见 `Faith.convert`）；
   * 这里保留旧入口，`p` 键走 `Panels.openAltar`。
   * @returns {object|null}
   */
  function pray(g, c) {
    const altar = altarAt(g, c.x, c.y);
    if (!altar) return { ok: false, reason: 'no-altar' };
    const F = Elona.Faith;
    if (!F) {
      const god = altar.f[25] | 0;
      const faith = c.get(61) | 0;
      if (faith === 0) { c.set(61, god); return { ok: true, god, converted: true, name: GOD_NAMES[god] || '?' }; }
      if (faith !== god) { c.set(61, god); return { ok: true, god, faith, converted: true, name: GOD_NAMES[god] || '?' }; }
      return { ok: true, god, faith, name: GOD_NAMES[god] || '?' };
    }
    const faith = c.get(61) | 0;
    const god = altar.f[25] | 0;
    if (faith !== god) {
      const r = F.convert(g, c, god);
      return { ok: true, god, faith, converted: true, punished: r.punished,
        name: GOD_NAMES[god] || '?', messages: r.messages };
    }
    const r = F.pray(g, c);
    return Object.assign({ god, faith, name: GOD_NAMES[god] || '?' }, r);
  }

  /**
   * 献祭 —— *label_2614（273025-273203），0-ES 起在 `core/faith.js`。
   * @param {object} g
   * @param {object} c   玩家
   * @param {number} idx 背包下标
   * @returns {object}
   */
  function offer(g, c, idx) {
    if (Elona.Faith && Elona.Faith.offer) return Elona.Faith.offer(g, c, idx);
    return { ok: false, reason: 'no-faith-module' };
  }

  Elona.MapFeat = {
    read, write, clear, clear, detect, avoid, disarm, disarmed, reveal, onEnter,
    DISCOVERED, idiv, limit,
    TYPE, OBJ_FEATS, DOOR_OPEN_ID, DOOR_CLOSED_ID,
    applyObjects, openDoor, closeDoor, stairsAt, boardText,
    altarAt, pray, offer, modPiety, GOD_NAMES,
  };
})(window);
