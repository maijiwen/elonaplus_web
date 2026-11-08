'use strict';
/**
 * 野外遭遇（随机遇敌）—— 对应 start.hsp 主循环 343587-343805 与地图进入时的生成段 240455-240565。
 *
 * 原版流程（每回合、只对玩家 var_243 == 0）：
 *   343587  if ( var_126(6) == 1 )                      ; 地图种类 = 1（野外）
 *   343588    if ( var_65(850) != 91 & != 47 )          ; 排除特定区域与海域
 *   343594      var_65(62) = map(x,y,0)                 ; 记录脚下地块
 *   343595      if ( var_65(250+375) > 0 )              ; 回避遇敌计数（625）
 *   343615      if ( map(x,y,6) == 0 )                  ; 有地形物件（feat）的格子不判
 *   343616-343695  逐项掷骰决定 var_1287（遭遇类型）
 *   343696-343745  类型 4/8/3/2/5 的强度
 *   343720          if ( var_65(250+375) <= 0 )         ; 有回避遇敌时不触发
 *   343722-343800      类型 1：危险度 var_400 = rnd(var_65(189)+1)+50、敌战力 var_1849、
 *                      「遭遇！(危险度:N 敌战力:X级)」→ var_1777 = 4 → 重进地图
 *   240455-240560  重进地图时的生成：按 var_1287 造怪
 *
 * 【已移植】遭遇掷骰（类型 1/2/4/5/8）、危险度与敌战力公式、阶位文本、
 *   各类型的怪物编成（含「 Lv N」后缀、商人金钱、敌对关系）、战舰击退（var_65(517)==4）。
 * 【近似/未移植】① 类型 3（暗杀者）依赖 `evadd` 地图事件表（var_65(160+cnt) / var_434），
 *   本项目还没有该表，暂以「暗杀者」通用编成代替；② `var_1777 = 4` 的「重进地图」在本项目
 *   等价为「直接在当前地图上就地生成」，因为世界地图本身就是可战斗地图；
 *   ③ evadd 的记录（23/60/97）未做。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};
  const idiv = (a, b) => (b === 0 ? 0 : Math.trunc(a / b));
  const limit = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const R = (g, n) => ((g && g.rng) ? g.rng : Elona.rng).rnd(Math.max(1, n | 0));
  const V = (g, n) => ((g && g.getV65) ? (g.getV65(n) | 0) : 0);
  const S = (g, n, v) => { if (g && g.setV65) g.setV65(n, v | 0); };

  // var_65 字段
  const V_MAP = 20;         // 当前地图 id
  const V_MAPLV = 22;       // 当前地图层数 / 地图等级
  const V_WEATHER = 17;     // 天气（0 晴 / 1 以太风 / 2 雪 / 3 雨 / 4 暴雨）
  const V_CARGO = 80;       // 载重
  const V_CARGOMAX = 82;    // 载重上限
  const V_REGION = 850;     // 大区域（47 = 海，91 = 特殊）
  const V_MAPLV189 = 189;   // 遭遇用的基准等级（609737：= var_65(22)）
  const V_CANCEL = 625;     // 回避遇敌（250+375）剩余格数
  const V_BOUNTY = 512;     // 悬赏度（250+262），>=100 时可能出现赏金首
  const V_BATTLESHIP = 517; // 250+417 战舰（4 = 持有）
  const V_STORY = 252;      // 250+2 剧情进行度
  const V_SHIP = 694;       // 船等级

  /** var_126(6)：地图种类。1 = 野外（可遭遇）；3 = 城市；5 = 洞窟；7 = 据点 */
  const WILD = 1;

  /** 敌战力 → 阶位文本（343748-343787） */
  const RANKS = [
    [5, '普奇级'], [10, '欧克级'], [20, '灰熊级'], [30, '幼龙级'],
    [40, '巫妖级'], [60, '龙级'], [70, '伊斯级'], [Infinity, '不明'],
  ];

  function rankOf(strength) {
    const v = strength | 0;
    for (const [cap, name] of RANKS) if (v < cap) return name;
    return '不明';
  }

  /** 地图 id（与 randomevent.mapKind 同源） */
  function mapIdOf(g) {
    if (!g) return 0;
    if (g.getV65) return g.getV65(V_MAP) | 0;
    return 0;
  }

  /** var_126(6)：site 表的 fields[0] */
  function mapKind(g) {
    const id = mapIdOf(g);
    if (!id) return 0;
    if (Elona.Sites && Elona.Sites.get) {
      const s = Elona.Sites.get(id);
      if (s && s.fields) return s.fields[0] | 0;
    }
    const known = { 4: 1, 47: 1, 70: 1, 54: 3, 7: 5 };
    return known[id] || 0;
  }

  /** map(x, y, 0) / map(x, y, 6) */
  function cellOf(g, x, y) {
    if (!g || !g.map || !g.map.cell) return null;
    return g.map.cell(x, y);
  }

  /**
   * 掷一次遭遇骰 —— 纯函数（除 rng 外不改状态）。
   * @returns {null|{type:number, danger:number, strength:number, tile:number,
   *                 rank:string, blocked:boolean, battleship:boolean}}
   *   type：0 无 / 1 魔兽 / 2 行商 / 3 暗杀者 / 4 盗贼团 / 5 赏金首 / 8 艾莱亚
   */
  function roll(g, opts) {
    const o = opts || {};
    if (!g || !g.player || !g.map) return null;
    const world = !!o.world;                     // 世界地图步行模式（原版 var_65(20) == 4/44）
    if (!world && mapKind(g) !== WILD) return null;
    const region = V(g, V_REGION);
    if (region === 91 || region === 47) return null;
    const p = g.player;
    let tile = 0;
    if (world) {
      const WM = Elona.WorldMap;
      const w = g.worldMap;
      if (!WM || !WM.cells || !w) return null;
      const row = WM.cells[w.y];
      tile = (row && row[w.x]) ? (row[w.x][0] | 0) : 0;
    } else {
      const cell = cellOf(g, p.x, p.y);
      if (!cell) return null;
      // 343615：脚下有地形物件（feat）的格子不判遭遇
      if ((cell[6] | 0) !== 0) return null;
      tile = cell[0] | 0;
    }

    const mapId = world ? (region === 44 ? 44 : 4) : mapIdOf(g);
    const weather = V(g, V_WEATHER);
    let v2530 = 0;                                   // 343617-343621
    if (mapId === 4) v2530 = 1;
    if (mapId === 44) v2530 = 2;

    let type = 0;
    if (R(g, 30) === 0) type = 1;                    // 343622
    if (weather === 4 && R(g, 10) === 0) type = 1;   // 343625 暴雨
    if (weather === 1 && R(g, 13) === 0) type = 1;   // 343628 以太风
    if (V(g, V_BOUNTY) >= 100 && R(g, 5) === 0) type = 5;   // 343631 赏金首
    if (tile >= 33 && tile < 57 && tile !== 44) {    // 343635 特定地块（草原/森林？）
      if (R(g, 2) === 0) type = 0;
      if (R(g, 100) === 0) type = 2;
    }
    // 343641-343644：载重越接近上限越不容易遇敌
    const lv = p.level | 0;
    const v2531 = limit(lv * 10, 1, 500);
    const cargo = limit(idiv(V(g, V_CARGO) * 150, V(g, V_CARGOMAX) + 1), 0, 210 + v2531);
    if (R(g, 220 + v2531 - cargo) === 0) type = 4;

    // 343645-343652：地图 44 的艾莱亚袭击
    if (mapId === 44) {
      const story = V(g, V_STORY);
      if (story < 345) { if (R(g, 400 - story) === 0) type = 8; }
      else if (R(g, 250) === 0) type = 8;
    }

    // 343654-343670：护送途中可能被暗杀者袭击。
    //   1/40 概率；遍历 5 个委托槽（var_65(160..164)）找 type 1007、未完成（var_434(8)==1）、
    //   尚未送达（var_434(4)==0）、且袭击次数 < 2（var_434(10)）的委托。
    let assassins = false;
    let escortQuest = null;
    if (world && R(g, 40) === 0) {
      const Q = Elona.Quest;
      const list = (Q && Q.activeQuests) ? Q.activeQuests(g) : [];
      for (const q of list) {
        if (!q || (q.type | 0) !== 1007 || (q.status | 0) !== 1) continue;
        if ((q.progress | 0) !== 0) continue;                  // var_434(4) == 0
        if ((q.ambushCount | 0) >= 2) continue;                // var_434(10) < 2
        assassins = true;
        escortQuest = q;
        type = 3;                                            // 343661 var_1287 = 3
        q.ambushCount = (q.ambushCount | 0) + 1;               // 343663
        break;
      }
    }

    // 343671-343694：战舰（var_65(517) == 4）自动击退
    let battleship = false;
    if (V(g, V_BATTLESHIP) === 4) {
      if (type === 4 || type === 1) {
        battleship = true;
        type = 0;
      }
    }
    if (type === 3 && !assassins) type = 1;

    // ---- 强度（343696-343719）
    let danger = 0;
    if (type === 4 || type === 8) danger = idiv(p.get(34) | 0, 1000);
    else if (type === 3) danger = idiv(p.get(34) | 0, 1000);
    else if (type === 2) danger = 10 + R(g, 100);
    else if (type === 5) danger = 111 + (p.skill ? (p.skill(111) | 0) : 0);

    let strength = 0;
    if (type === 1) {
      // 343720-343745：只有没有回避遇敌时才真正触发
      if (V(g, V_CANCEL) > 0) return null;
      danger = R(g, V(g, V_MAPLV189) + 1) + 50;
      if (v2530 === 1) danger = limit(R(g, R(g, V(g, V_MAPLV189) + 1) + 1), 1, 50);
      if (v2530 === 2) danger = limit(R(g, V(g, V_MAPLV189) + 1), 50, 100);
      strength = idiv(danger * 4, 5) - 10;
      if (lv <= 5) strength = idiv(strength, 2);
      if (tile >= 33 && tile < 57 && tile !== 44) strength = idiv(strength, 2);
      else if (weather === 1) strength = idiv(strength * 3, 2) + 10;
      if (strength < 0) strength = 1;
      if (strength >= 999) danger = 999;
    } else if (type) {
      // 其余类型同样受回避遇敌保护（343720 的条件块覆盖整段）
      if (V(g, V_CANCEL) > 0) return null;
      strength = danger;
    } else {
      return null;
    }

    return {
      type, danger, strength, tile, battleship,
      escortQuestId: escortQuest ? escortQuest.id : null,
      rank: rankOf(strength),
      message: `遭遇！(危险度:${danger} 敌战力:${rankOf(strength)})`,
    };
  }

  /** 找一个可站且没人占的格子（以玩家为中心由近到远） */
  function freeTile(g, cx, cy, maxR) {
    const p = g.player;
    const ox = cx === undefined ? p.x : cx;
    const oy = cy === undefined ? p.y : cy;
    const rad = maxR === undefined ? 6 : maxR;
    for (let r = 1; r <= rad; r++) {
      const cand = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = ox + dx, y = oy + dy;
          if (!g.map.inBounds(x, y) || !g.map.walkable(x, y)) continue;
          if (g.map.check(x, y).charaIndex >= 0) continue;
          cand.push({ x, y });
        }
      }
      if (cand.length) return cand[R(g, cand.length)];
    }
    return { x: ox, y: oy };
  }

  /** 造一只怪 —— 包一层，统一处理「表未加载 / 生成失败」 */
  function make(g, species, level, x, y, opt) {
    const C = Elona.CharaFactory;
    if (!C || !C.create || !C.monTable) return null;
    const o = opt || {};
    // var_1023 = 生成等级（characreate 的等级来源）；不传就退回物种模板的固定等级
    if (o.var1023 === undefined) o.var1023 = Math.max(1, level | 0);
    const m = C.create(g, species | 0, Math.max(1, level | 0), x, y, o);
    if (!m) return null;
    m.set(9, -3);                                   // gohostile
    m.set(201, 30);                                 // var_58(201)：AI 行为档
    return m;
  }

  /** generatemoney（214504-214525）的简版：只写 var_58(30) */
  function genMoney(g, c) {
    let v = R(g, 100) + R(g, (c.get(38) | 0) * 50 + 1);
    const role = c.get(150) | 0;
    if ((role >= 1000 && role < 2000) || role === 2003) {
      v += 2500 + (c.get(151) | 0) * 250;
      if (role === 1009) v = 25000 + (c.get(151) | 0) * 500;
    }
    if ((c.get(30) | 0) < idiv(v, 2)) c.set(30, v);
    return v;
  }

  /**
   * 按遭遇类型生成怪物（240455-240560）。
   * @returns {{created:Array<object>, leader:object|null}}
   */
  function spawn(g, type, danger, opt) {
    const o = opt || {};
    const out = { created: [], leader: null };
    if (!Elona.CharaFactory || !Elona.CharaFactory.monTable) return out;
    const lv = Math.max(1, danger | 0);
    // 240489/240542：手下名字后面补「 Lv N」（CharaFactory 若已经加过就不重复）
    const push = (m, suffix) => {
      if (!m) return;
      if (suffix && !/ Lv\d+$/.test(m.name || '')) m.name = (m.name || '') + suffix;
      out.created.push(m);
    };

    if (type === 1) {                               // 魔兽群（240556-240575）
      let n0 = R(g, 9);
      if ((g.player.level | 0) <= 5) n0 = R(g, 3);
      const n = 2 + n0;
      for (let i = 0; i < n; i++) {
        const lvl = Elona.ItemDB && Elona.ItemDB.calcObjLv
          ? Elona.ItemDB.calcObjLv(lv, g) : lv;
        // 原版 cnt<4 是 characreate 在玩家格（引擎会挤开），这里统一取身边的空位
        const pos = freeTile(g);
        push(make(g, 0, lvl, pos.x, pos.y));
      }
    } else if (type === 3) {                        // 护送袭击（240492-240523）
      // `var_400 = (rnd(3) + 5) / 2` → 2..4 只；`flt var_434(5), 3`（品质 3）；
      // `characreate -1, 0`（不指定种，按等级随机）。
      const q = o.quest || null;
      const lvl3 = Math.max(1, q ? (q.difficulty | 0) : lv);
      const n = idiv(R(g, 3) + 5, 2);
      for (let i = 0; i < n; i++) {
        const pos = freeTile(g);
        const m = make(g, 0, lvl3, pos.x, pos.y);
        if (!m) continue;
        m.set(9, -3);
        m.set(201, 30);
        m.set(69, -3);
        push(m);
      }
      // 240517-240522：两版台词（`var_65(250+417)==4` 时是「行商人に変装していた暗殺者」）；
      //   本项目该槽位另有他用，统一用通用台词。
      out.message = '暗杀者抓住了你。你必须保护委托人。';
    } else if (type === 2) {                        // 行商与佣兵（240520-240545）
      const pos = freeTile(g);
      const vendor = make(g, 1, 10, pos.x, pos.y);
      if (vendor) {
        vendor.set(150, 1010);                      // 行商
        vendor.set(151, lv);
        vendor.name = '流浪商人';
        genMoney(g, vendor);
        out.leader = vendor;
        out.created.push(vendor);
      }
      const n = 6 + R(g, 6);
      for (let i = 0; i < n; i++) {
        const pos2 = freeTile(g);
        const m = make(g, 159 + R(g, 3), lv + R(g, 10), pos2.x, pos2.y);
        if (m) { m.set(150, 16); m.set(197, 10); }
        push(m, m ? ` Lv${m.level | 0}` : '');
      }
    } else if (type === 3) {                        // 暗杀者（240508-240520，简版）
      const n = idiv(R(g, 3) + 5, 2);
      for (let i = 0; i < n; i++) {
        const pos = freeTile(g);
        const m = make(g, 0, lv, pos.x, pos.y);
        if (m) { m.set(201, 30); m.set(9, -3); m.set(69, -3); }
        push(m);
      }
    } else if (type === 4) {                        // 盗贼团（240487-240505）
      const pos = freeTile(g);
      const boss = make(g, 302, lv, pos.x, pos.y);
      push(boss);
      out.leader = boss;
      const n = 6 + R(g, 6);
      for (let i = 0; i < n; i++) {
        const pos2 = freeTile(g);
        const m = make(g, 303 + R(g, 3), lv + R(g, 10), pos2.x, pos2.y);
        if (m) m.set(197, 10);
        push(m, m ? ` Lv${m.level | 0}` : '');
      }
    } else if (type === 5) {                        // 赏金首（240506-240508）
      const pos = freeTile(g);
      const boss = make(g, 627, lv, pos.x, pos.y);
      push(boss);
      out.leader = boss;
    } else if (type === 8) {                        // 艾莱亚（240470-240486）
      const pos = freeTile(g);
      const boss = make(g, 1085, lv, pos.x, pos.y);
      push(boss);
      out.leader = boss;
      const n = 6 + R(g, 6);
      for (let i = 0; i < n; i++) {
        const pos2 = freeTile(g);
        const m = make(g, 1082 + R(g, 3), lv + R(g, 10), pos2.x, pos2.y);
        if (m) m.set(197, 10);
        push(m, m ? ` Lv${m.level | 0}` : '');
      }
    }
    return out;
  }

  /**
   * 世界地图步行时的遭遇判定（原版在世界地图 var_65(20) == 4/44 上行走同样走 343587 那段）。
   * @returns {null|object} 同 roll()
   */
  function rollWorld(g) {
    if (!g || !g.worldMap) return null;
    return roll(g, { world: true });
  }

  /**
   * 每回合调用（Game.endTurn 里，玩家行动之后）。
   * @returns {null|{type,danger,strength,rank,spawned,message,messages}}
   */
  function tick(g) {
    if (!g || !g.player || (g.player.get(0) | 0) !== 1) return null;
    if (g.questMap || g.dungeonDepth > 0) return null;   // 委托地图 / 地下城不判野外遭遇
    const rollRes = roll(g);
    if (!rollRes) return null;
    if (rollRes.battleship) {
      const msg = '遭到了袭击，但被战舰击退了。';
      if (g.log) g.log(msg);
      S(g, V_MAP + 40, V(g, V_MAP + 40) + 1);            // 250+40 战绩计数
      return { ...rollRes, spawned: [], messages: [msg] };
    }
    if (g.log) g.log(rollRes.message);
    const eq = rollRes.escortQuestId && Elona.Quest && Elona.Quest.activeQuests
      ? Elona.Quest.activeQuests(g).find((q) => q.id === rollRes.escortQuestId) : null;
    const sp = spawn(g, rollRes.type, rollRes.strength, { quest: eq });
    const messages = [rollRes.message];
    if (rollRes.type === 2) messages.push('流浪商人一行出现了。');
    if (rollRes.type === 3) messages.push('暗杀者扑了过来！');
    if (rollRes.type === 4) messages.push('盗贼团挡住了去路！');
    if (rollRes.type === 5) messages.push('赏金首出现了！');
    if (rollRes.type === 8) messages.push('艾莱亚的过激派袭击了过来！');
    for (const m of messages.slice(1)) if (g.log) g.log(m);
    if (sp.created.length && g.syncCharaCells) g.syncCharaCells();
    return { ...rollRes, spawned: sp.created, leader: sp.leader, messages };
  }

  Elona.Encounter = {
    WILD, RANKS, rankOf, mapKind, roll, rollWorld, spawn, tick, freeTile, genMoney,
    /** 调试用：强制一次遭遇 */
    force(g, type, danger) {
      const t = type | 0 || 1;
      const d = danger === undefined ? 50 : (danger | 0);
      const sp = spawn(g, t, d);
      if (g && g.log) g.log(`[debug] 遭遇 type=${t} danger=${d}，生成 ${sp.created.length} 只`);
      return { type: t, danger: d, strength: d, rank: rankOf(d), spawned: sp.created };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
