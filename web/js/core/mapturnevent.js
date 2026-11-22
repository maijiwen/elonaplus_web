'use strict';
/**
 * 地图每回合事件（core/mapturnevent.js）—— 对应 start.hsp `*label_2476`（251443-252302）
 *
 * 【调用点】源码 604168 在回合循环 `*label_4356` 里以 `gosub *label_2476` 每回合调用一次；
 *   本项目在 game.js `endTurn()` 的 TurnCycle 段之后、`advanceClock()` 之前调用
 *   `Elona.MapTurnEvent.tick(this)`。
 *
 * 【分派方式】逐条按 `var_65(20)`（地图 id）与 `var_65(22)`（深度）判断，命中后大多 `return`，
 *   与原码一致。博物馆/商店的闲话（252220-252302）已由 core/property.js 的 ambientMessage
 *   近似承载，这里不重复。收容所（地图 30）的食物/饮水是 A-R3-03 里原本由 camp.js 近似的
 *   部分，这里按 252178-252219 逐句补齐（不会与 camp.js 的训练结算冲突）。
 *
 * 【字段/槽位】
 *   var_65(20) 地图 id  var_65(22) 深度  var_65(3) 当前角色数   var_65(17) 天气
 *   var_65(90) 眠気     var_65(250+2)=252 主线阶段  var_65(250+11) 剧情计数
 *   var_65(250+209)=459、250+292=542、250+318=568、250+370=620、
 *   var_65(250+377)=627、250+8/9 诺伊尔事件、250+231 剧情阶段
 *   var_126(0/1) 地图宽高、var_126(9) 地图时间片、var_126(34) 人狼遊儀进度
 *   var_132(16) 站点类型、var_132(32) ネフィア主题、var_132(34) 地图标记
 *   var_58(86) 狂気、var_58(201) AI 追加计数、var_58(268) 干扰装置倒计时
 *
 * 【近似登记】
 *   · characreate 的 `-3`（随机落点）用 `g.randWalkableCell()` 实现；
 *     固定坐标直接使用，不再二次校验可站立性（与原版一致，原版也不校验）。
 *   · `flt` = `var_640 = calcobjlv(depth)`，用 `Elona.ItemDB.calcObjLv(depth, g)`。
 *   · `dmgcon` / `dmghp` 的 attr 参数直接传给 `Elona.Battle.applyDamage` / `Elona.Resist.dmgcon`。
 *   · 地图 1008 的委托生成依赖 `var_434(8, var_65(72))`；项目用 `g.quests` 中 id 匹配的委托，
 *     字段 29 取 `q.clientIndex`。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && g.setV65) g.setV65(n, v | 0); };
  const R = (g, n) => ((g && g.rng) ? g.rng.rnd(n) : 0);
  const hdr = (g, n) => ((g && g.map && g.map.header) ? (g.map.header[n] | 0) : 0);
  const site = (g, col) => {
    const id = V(g, 20);
    if (Elona.Sites && Elona.Sites.field) return Elona.Sites.field(col, id, g) | 0;
    return 0;
  };
  const log = (g, m) => { if (g && typeof g.log === 'function') g.log(m); };

  const active = (c) => !!(c && typeof c.get === 'function' && (c.get(0) | 0) === 1);
  const allChars = (g) => (g && g.charas) ? g.charas : [];
  function npcCount(g) {
    let n = 0;
    const a = allChars(g);
    for (let i = 1; i < a.length; i++) if (active(a[i]) && a[i] !== (g && g.player)) n++;
    return n;
  }
  function findSpecies(g, id) {
    const a = allChars(g);
    for (let i = 0; i < a.length; i++) {
      if (active(a[i]) && (a[i].get(27) | 0) === id) return i;
    }
    return 0;                                    // findchara 未找到返回 0
  }
  function charAt(g, x, y) {
    const a = allChars(g);
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (!active(c)) continue;
      if ((c.x | 0) === (x | 0) && (c.y | 0) === (y | 0)) return c;
    }
    return null;
  }
  function levelOf(g) {
    // flt = var_640 = calcobjlv(var_65(22)) → calcObjLv(0) 取当前地图深度
    if (Elona.ItemDB && Elona.ItemDB.calcObjLv) return Elona.ItemDB.calcObjLv(0, g) | 0;
    return Math.max(1, V(g, 22));
  }
  /** characreate -1, species, x, y */
  function spawn(g, speciesId, x, y, level) {
    if (!Elona.CharaFactory || !Elona.CharaFactory.create) return null;
    let px = x, py = y;
    if (px === -3) {
      const p = (typeof g.randWalkableCell === 'function') ? g.randWalkableCell() : null;
      if (p) { px = p.x; py = p.y; }
      else { px = 1; py = 1; }
    }
    return Elona.CharaFactory.create(g, speciesId, level === undefined ? levelOf(g) : level, px, py);
  }
  function applyDmg(g, c, dmg, attr, arg) {
    if (!c || !Elona.Battle || !Elona.Battle.applyDamage) return;
    Elona.Battle.applyDamage(c, dmg, g, null, attr === undefined ? 0 : attr, arg === undefined ? 0 : arg);
  }
  function dmgcon(g, c, id, power) {
    if (Elona.Resist && Elona.Resist.dmgcon && g && g.dmgconTable) {
      Elona.Resist.dmgcon(g, g.dmgconTable, c, id, power);
    }
  }
  function addbuff(g, c, id, p1, p2) {
    if (Elona.Status && Elona.Status.addbuff) Elona.Status.addbuff(g, c, id, p1, p2, c);
  }
  function cbitmod(c, bit, on) {
    if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit, on);
  }
  function cbit(c, bit) {
    return (Elona.Status && Elona.Status.cbit) ? (Elona.Status.cbit(c, bit) | 0) : 0;
  }
  function setCellFeat(g, x, y, id, type, sub, arg3) {
    if (Elona.MapFeat && Elona.MapFeat.write) Elona.MapFeat.write(g, x, y, id, type, sub, arg3);
  }

  /** 当前受注委托（`var_65(72)` 是 var_434 的槽位下标，见 questcheck.js） */
  function currentQuest(g) {
    const slot = V(g, 72);
    if (!g.quests) return null;
    return g.quests[slot] || null;
  }

  const STAIRS_DOWN = 231;      // var_1606
  const DOOR_OPEN = 236;        // var_1605

  // ==========================================================================
  // 251443-251460  地图 33：诺伊尔（var_65(250+8)==1）的守卫事件
  // ==========================================================================
  function map33(g) {
    if (V(g, 250 + 8) !== 1) return;
    const guard = g.charas ? g.charas[V(g, 250 + 9)] : null;
    if (!active(guard)) return;
    if (npcCount(g) >= 30) return;
    if (R(g, 4) === 0) spawn(g, 204, -3, 0, 1);
    if (R(g, 10) === 0) spawn(g, 185, -3, 0, 1);
  }

  // ==========================================================================
  // 251461-251484  委托图 1008：委托未完成时补足敌人
  // ==========================================================================
  function mapQuest1008(g) {
    if (V(g, 70) !== 1008) return;
    const q = currentQuest(g);
    if (q && (q.status | 0) === 3) return;                 // var_434(8) == 3
    // 251463：`var_65(3) < var_65(84) / 300`。var_65(84) 是委托剩余时间，
    //   1008 入图时为 360（232139）→ 上限 1 只；本项目尚未接入委托计时器，
    //   没有值时按入图初值 360 计算。
    const cap = Math.max(1, idiv(V(g, 84) || 360, 300));
    if (npcCount(g) >= cap) return;
    let species = 0;
    if (R(g, 4) === 0) species = 204;
    if (R(g, 20) === 0) species = 185;
    if (!species) return;
    const c = spawn(g, species, -3, 0, 1);
    if (!c) return;
    c.set(9, -1);
    c.set(69, -1);
    c.set(201, 100);
    // 251479：`var_58(29) = var_434(13, var_65(72))` 在 1008 型里是所生成目标
    //   唯一怪物的角色索引（232144-232147）；本项目把 CONQUER 简化为「击倒 N 只同种」，
    //   没有该唯一目标，故留 0（AI 目标为空，不会错误地指向委托人）。
    c.set(29, 0);
  }

  // ==========================================================================
  // 251485-251500  地图 16：熱い！
  // ==========================================================================
  function map16(g) {
    if (R(g, 5) !== 0) return;
    const resist = (g.player && g.player.skill) ? (g.player.skill(50) | 0) : 0;
    const lv = idiv(resist, 50);
    if (lv >= 3) return;
    const dmg = (4 - lv) * (4 - lv) * 2;
    log(g, '好烫！');
    applyDmg(g, g.player, dmg, 0, 0);
  }

  // ==========================================================================
  // 251502-251536  地图 43 深 100：神经毒气
  // ==========================================================================
  function map43(g) {
    if (V(g, 22) !== 100) return;
    if (R(g, 20) !== 0) return;
    log(g, '神经毒气弥漫开来！');
    for (const c of allChars(g)) {
      if (!active(c)) continue;
      if ((c.get(27) | 0) !== 686 && c.raceName !== 'bacteria') {
        if ((c.get(50) | 0) > idiv(c.get(51) | 0, 5)) applyDmg(g, c, 200, 58, 200);
        else if ((c.get(252) | 0) === 0) c.set(252, 1);
      } else if ((c.get(252) | 0) === 0) {
        c.set(252, 1);
      }
    }
  }

  // ==========================================================================
  // 251537-251554  地图 80 深 100：强制睡眠与麻痹
  // ==========================================================================
  function map80(g) {
    if (V(g, 22) !== 100) return;
    if (R(g, 15) !== 0) return;
    for (const c of allChars(g)) {
      if (!active(c) || (c.get(9) | 0) === -3) continue;
      dmgcon(g, c, 9, 50);
      dmgcon(g, c, 1, 60);
    }
  }

  // ==========================================================================
  // 251555-251590  地图 73 深 100：叛军魔法师复仇
  // ==========================================================================
  function map73(g) {
    if (V(g, 22) !== 100) return;
    if (V(g, 250 + 292) >= 100) return;
    if (R(g, 20) !== 0) return;
    let hit = false;
    for (const c of allChars(g)) {
      if (!active(c)) continue;
      const sp = c.get(27) | 0;
      if (sp !== 739 && sp !== 376) continue;
      if ((c.get(58) | 0) !== 0) continue;
      if (c === g.player) continue;
      if ((c.get(182) | 0) < 50) { c.set(182, 50); hit = true; }
    }
    if (hit) log(g, '敌方魔法师们被复仇心煽动了。');
  }

  // ==========================================================================
  // 251591-251635  地图 76 深 149：空间干扰装置
  // ==========================================================================
  function map76a(g) {
    if (V(g, 22) !== 149 || V(g, 250 + 2) !== 470) return;
    if (R(g, 15) !== 0) return;
    log(g, '恶魔开始进行空间干涉。');
    let target = findSpecies(g, 791);
    if (R(g, 100) >= 94) target = 0;
    for (const c of allChars(g)) {
      if (!active(c)) continue;
      if (target === 0) {
        if ((c.get(27) | 0) === 789) addbuff(g, c, 41, 400, 50);
        c.set(268, 50);
      } else {
        c.set(268, 5);
      }
    }
    if (target !== 0) log(g, '……似乎被 D 干扰器减轻了。');
  }

  // ==========================================================================
  // 251636-251665  地图 76 深 164：士兵士气
  // ==========================================================================
  function map76b(g) {
    if (V(g, 22) !== 164) return;
    if (findSpecies(g, 860) === 0) return;
    if (V(g, 250 + 318) !== 0) return;
    if (R(g, 20) !== 0) return;
    log(g, '「奋起吧！为了洛斯利亚的理想献出生命！」');
    for (const c of allChars(g)) {
      if (!active(c) || (c.get(9) | 0) !== -3) continue;
      addbuff(g, c, 5, 271 * 3 + 50, 75);
      addbuff(g, c, 7, 271 * 3 + 100, 75);
      if ((c.get(182) | 0) < 50) c.set(182, (c.get(182) | 0) + 10);
    }
  }

  // ==========================================================================
  // 251666-251682  地图 78：热风
  // ==========================================================================
  function map78(g) {
    if (R(g, 10) !== 0) return;
    log(g, '热风吹过！');
    const dmg = V(g, 22) * 2 + 50;
    for (const c of allChars(g)) {
      if (!active(c)) continue;
      if (idiv((c.skill ? c.skill(50) : 0) | 0, 50) < 6) applyDmg(g, c, dmg, 50, 1000);
    }
  }

  // ==========================================================================
  // 251683-251748  神の杖（var_58(85,0) == -1）：半径 6 的落雷
  // ==========================================================================
  function godsRod(g) {
    if (!g.player || (g.player.get(85) | 0) !== -1) return;
    if (R(g, 5) !== 0) return;
    const W = hdr(g, 0), H = hdr(g, 1);
    const cx = R(g, W), cy = R(g, H);
    log(g, R(g, 2) === 0 ? '有什么东西撕裂天空落了下来！' : '神之杖被挥落到了地上！');
    const rad = 6;
    const dist = (Elona.Battle && Elona.Battle.dist) ? Elona.Battle.dist
      : ((x1, y1, x2, y2) => Math.trunc(Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2))));
    for (let y = cy - rad; y <= cy + rad; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = cx - rad; x <= cx + rad; x++) {
        if (x < 0 || x >= W) continue;
        if (dist(cx, cy, x, y) > rad) continue;
        const cell = g.map && g.map.cell ? g.map.cell(x, y) : null;
        if (cell) {
          const tile = cell[0] | 0;
          if (tile !== 701 && tile !== 671) cell[0] = 37;
        }
        const c = charAt(g, x, y);
        if (!c) continue;
        if ((c.get(168) | 0) !== 0 && c !== g.player) {
          const master = g.charas ? g.charas[c.get(167) | 0] : null;
          if (master) {
            if (R(g, (c.get(50) | 0) + 1) < R(g, (master.get(50) | 0) + 1)) {
              log(g, `${c.name} 护住了 ${master.name}！`);
              applyDmg(g, master, 1000, 0, 0);
              continue;
            }
          }
        }
        applyDmg(g, c, 1000, 0, 0);
      }
    }
  }

  // ==========================================================================
  // 251750-251787  ネフィア放电 / 猛毒（var_132(32)）
  // ==========================================================================
  function nefiaDischarge(g) {
    const theme = site(g, 32);
    if (theme === 100) {
      if (R(g, 10) !== 0) return true;                   // 源码无论 rnd 结果都 return
      log(g, 'ネフィア放出了电击！');
      const dmg = V(g, 22) * 2 + 50;
      for (const c of allChars(g)) if (active(c)) applyDmg(g, c, dmg, 52, 1000);
      return true;
    }
    if (theme === 105) {
      if (R(g, 20) !== 0) return true;
      log(g, 'ネフィア喷出了剧毒！');
      const depth = V(g, 22);
      for (const c of allChars(g)) if (active(c)) applyDmg(g, c, depth * 2 + 50, 55, depth + 200);
      return true;
    }
    if (theme === 108 || (V(g, 20) === 89 && V(g, 250 + 370) < 1000)) {
      if (R(g, 5) !== 0) return true;
      log(g, 'ネフィア释放了重力！');
      for (const c of allChars(g)) {
        if (!active(c)) continue;
        if ((c.get(262) | 0) < 50) c.set(262, 50);
      }
      return true;
    }
    return false;
  }

  // ==========================================================================
  // 251810-251859  地图 54 深 30：恐怖呼声（狂気）
  // ==========================================================================
  function map54Voice(g) {
    if (V(g, 22) !== 30 || V(g, 250 + 2) >= 400) return;
    if (R(g, 10) !== 0) return;
    log(g, '脑中响起了令人作呕的呼唤声……');
    for (const c of allChars(g)) {
      if (!active(c)) continue;
      if (c.raceName === 'yith' || c.raceName === 'seamonster') continue;
      if ((c.get(27) | 0) === 394) continue;
      if (c !== g.player && (c.get(25) | 0) >= 4) continue;   // cnt > var_1900(=0)
      if (idiv((c.skill ? c.skill(54) : 0) | 0, 50) < R(g, 15) + (c.get(86) | 0)) {
        c.set(86, (c.get(86) | 0) + 1);
      }
      if ((c.get(86) | 0) > 4) dmgcon(g, c, 11, idiv(c.get(86) | 0, 2) + 1);
    }
    if (g.player && (g.player.get(86) | 0) >= 100) {
      log(g, '雷基「再这样下去精神会崩溃的！」');
      if (g.events && g.events.add) g.events.add(14);
    }
  }

  // ==========================================================================
  // 251861-251878  地图 65/68：以太侵蚀
  // ==========================================================================
  function etherErosion(g) {
    if (R(g, 20) !== 0) return;
    log(g, '以太正在侵蚀你的身体……');
    if (Elona.Weather && Elona.Weather.modCorrupt) Elona.Weather.modCorrupt(g, 100);
  }

  // ==========================================================================
  // 251879-252010  地图 81 深 5：卡ラヴィカ跟踪者
  // ==========================================================================
  function map81(g) {
    if (V(g, 22) !== 5) return;
    const n = V(g, 250 + 11) + 1;
    S(g, 250 + 11, n);
    if (n === 500) {
      if ((V(g, 250 + 377) % 3) === 2) S(g, 250 + 377, V(g, 250 + 377) + 1);
      if (g.events && g.events.add) g.events.add(81, 0);
    }
    if ((n % 20) !== 0) return;

    const r = R(g, 6);
    let x = 9, y = 4;
    if (r === 0) { x = 9; y = 4; }
    else if (r === 1) { x = 10; y = 4; }
    else if (r === 2) { x = 9; y = 5; }
    else if (r === 3) { x = 18; y = 2; }
    else if (r === 4) { x = 18; y = 3; }
    else { x = 18; y = 4; }
    if (n > 200 && R(g, 3) !== 0) {
      if (r === 0) { x = 0; y = 11; }
      else if (r === 1) { x = 1; y = 11; }
      else if (r === 2) { x = 2; y = 11; }
      else if (r === 3) { x = 28; y = 11; }
      else if (r === 4) { x = 27; y = 13; }
      else { x = 26; y = 14; }
    }
    if (n > 300 && R(g, 3) !== 0) {
      if (r === 0) { x = 0; y = 24; }
      else if (r === 1) { x = 0; y = 25; }
      else if (r === 2) { x = 0; y = 26; }
      else if (r === 3) { x = 27; y = 22; }
      else if (r === 4) { x = 27; y = 23; }
      else { x = 28; y = 23; }
    }
    let species = 509;
    if (n > 50 && R(g, 10) === 0) species = 510;
    if (n > 100 && R(g, 10) === 0) species = 804;
    if (n > 150 && R(g, 10) === 0) species = 820;
    const target = findSpecies(g, 675) || 0;
    const c = spawn(g, species, x, y);
    if (!c) return;
    c.set(201, 3000);
    cbitmod(c, 964, 1);
    c.set(29, target);
    c.name = (n >= 400) ? '『卡ラヴィカ的跟踪者』' : '卡ラヴィカ的跟踪者';
  }

  // ==========================================================================
  // 252011-252077  地图 11 深 25：传令到达 / 跟踪者
  // ==========================================================================
  function map11(g) {
    if (V(g, 22) !== 25) return;
    const n = V(g, 250 + 11) + 1;
    S(g, 250 + 11, n);
    const W = hdr(g, 0), H = hdr(g, 1);
    let x = 1, y = R(g, H);
    if (R(g, 4) === 0) { x = W - 2; y = R(g, H); }
    if (R(g, 5) === 0) { x = R(g, W); y = 1; }
    if (R(g, 6) === 0) { x = R(g, W); y = H - 2; }
    let species = 237;
    if (n > 50 && R(g, 10) === 0) species = 245;
    if (n > 100 && R(g, 10) === 0) species = 244;
    if (n > 150 && R(g, 10) === 0) species = 244;
    if (n === 250) {
      log(g, '日记更新了。');
      S(g, 250 + 209, 3);
      log(g, '传令「帕尔米亚军的撤退已经完成！没有必要继续留在这里了。请见机从地下撤退！」');
      log(g, '楼梯出现了。');
      setCellFeat(g, 18, 9, STAIRS_DOWN, 11, 1, 0);
    }
    if ((n % 2) === 1) return;
    const c = spawn(g, species, x, y);
    if (!c) return;
    c.set(201, 1000);
    c.set(29, 0);
  }

  // ==========================================================================
  // 252078-252093  地图 61 深 3：NPC 523
  // ==========================================================================
  function map61(g) {
    if (V(g, 22) !== 3) return;
    if (V(g, 250 + 231) >= 1003) return;
    if (R(g, 10) !== 0) return;
    const c = spawn(g, 523, 28, 16);
    if (!c) return;
    cbitmod(c, 964, 1);
    c.set(201, 1000);
    c.set(29, 0);
  }

  // ==========================================================================
  // 252094-252129  地图 96 深 2..6：NPC 961
  // ==========================================================================
  function map96(g) {
    const depth = V(g, 22);
    if (depth < 2 || depth > 6) return;
    if (V(g, 250 + 2) >= 1000) return;
    if (R(g, 100) !== 0) return;
    let x = g.player ? (g.player.x | 0) : 0;
    let y = g.player ? (g.player.y | 0) : 0;
    if (depth === 2) { x = 78; y = 12; }
    if (depth === 3) { x = 22; y = 6; }
    if (depth === 4) { x = 41; y = 26; }
    if (depth === 5) { x = 22; y = 31; }
    if (depth === 6) { x = 37; y = 16; }
    const c = spawn(g, 961, x, y);
    if (!c) return;
    cbitmod(c, 964, 1);
    c.set(201, 1000);
    c.set(29, 0);
  }

  // ==========================================================================
  // 252130-252137  地图 54 深 3：收容所内的时间片与眠気
  // ==========================================================================
  function map54Shelter(g) {
    if (V(g, 22) !== 3) return;
    if (V(g, 90) >= 13) S(g, 90, 11);
    if (g.map && g.map.header) g.map.header[9] = 5000000;
  }

  // ==========================================================================
  // 252138-252177  地图 41：监狱 —— 悔罪 / 守卫开门
  // ==========================================================================
  function map41(g) {
    if (R(g, 50) === 0 && g.player && (g.player.get(49) | 0) < -30) {
      log(g, '你悔悟了自己的罪。');
      if (typeof g.modkarma === 'function') g.modkarma(1);
      const sk = R(g, 8) + 10;
      if (g.player.skill && Elona.Stats && Elona.Stats.sorg
          && Elona.Stats.sorg(g.player, sk) >= 10 && Elona.Stats.skillMod) {
        Elona.Stats.skillMod(g.player, sk, 0, -300, g);
      }
    }
    if (g.player && (g.player.get(49) | 0) >= -30 && R(g, 10) === 0) {
      const f = (Elona.MapFeat && Elona.MapFeat.read) ? Elona.MapFeat.read(g, 29, 6) : null;
      if (f && f.type === 21) {
        log(g, '你注意到守卫的脚步声正在靠近牢房。');
        log(g, '「那边的家伙，可以出来了」');
        log(g, '守卫一脸不耐烦地打开了你的牢门。');
        setCellFeat(g, 29, 6, DOOR_OPEN, 20, 0, -1);
      }
    }
  }

  // ==========================================================================
  // 252178-252219  地图 30：收容所的贮藏食品 / 饮料
  // ==========================================================================
  function map30(g) {
    if (!g.player) return;
    const p = g.player;
    const weather = V(g, 17);
    if (weather === 2 || weather === 4 || weather === 1) {
      if ((p.get(22) | 0) < 5000 && cbit(p, 986) === 0) {
        log(g, '你吃了收容所的贮藏食品。');
        p.set(22, (p.get(22) | 0) + 5000);
      }
      if ((p.get(446) | 0) < 5000) {
        log(g, '你喝了收容所的贮藏饮料。');
        p.set(446, (p.get(446) | 0) + 5000);
      }
      if (V(g, 90) >= 13) S(g, 90, 11);
      if (g.map && g.map.header) g.map.header[9] = 1000000;
    } else if (g.map && g.map.header && (g.map.header[9] | 0) === 1000000) {
      g.map.header[9] = 10000;
      for (const c of allChars(g)) if (c && c.set) c.set(10, 0);
      log(g, '已经没有必要继续留在收容所里了。');
    }
  }

  // ==========================================================================
  // 主分派（严格按源码顺序；有 return 的分支与源码一致）
  // ==========================================================================
  function tick(g) {
    if (!g || !g.map || !g.player) return null;
    const mapId = V(g, 20);
    const out = { messages: [], mapId, depth: V(g, 22) };
    const before = (g.messages || []).length;

    if (mapId === 33) map33(g);
    if (V(g, 70) === 1008) mapQuest1008(g);
    if (mapId === 16) { map16(g); return out; }
    if (mapId === 43) { map43(g); if (V(g, 22) === 100) return out; }
    if (mapId === 80) { map80(g); if (V(g, 22) === 100) return out; }
    if (mapId === 73) { map73(g); if (V(g, 22) === 100) return out; }
    if (mapId === 76) { map76a(g); if (V(g, 22) === 149) return out; }
    if (mapId === 76) map76b(g);
    if (mapId === 78) { map78(g); return out; }
    godsRod(g);
    if (nefiaDischarge(g)) return out;
    if (mapId === 54) { map54Voice(g); if (V(g, 22) === 30) return out; }
    if (mapId === 65 || mapId === 68) { etherErosion(g); return out; }
    if (mapId === 81) { map81(g); if (V(g, 22) === 5) return out; }
    if (mapId === 11) { map11(g); if (V(g, 22) === 25) return out; }
    if (mapId === 61) map61(g);
    if (mapId === 96) map96(g);
    if (mapId === 54) map54Shelter(g);
    if (mapId === 41) map41(g);
    if (mapId === 30) map30(g);

    out.messages = (g.messages || []).slice(before);
    return out;
  }

  Elona.MapTurnEvent = { tick };
})(window);
