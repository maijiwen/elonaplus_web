'use strict';
/**
 * 剧情地图层初始化 —— core/storymap.js
 *
 * 【源码依据】start.hsp `map_init` 的地图 3 / 49 / 76 分支（240677-241259），
 *   数据由 `tools/gen_storymap.js` 提取为 `data/tables/storymap.json`。
 *
 * 原版这三张地图是**手工地图 + 逐层硬编码的 BOSS / NPC 摆放**：
 *     map 3  莱希墨苏：3 层『斯兰』(139)、17 层『卡拉姆』(146)、最深层『杰姆』(2)
 *     map 49 莱米伊德遗迹：最深层『摩歇拉·摩多』(435) + 3 只 1091、
 *                          106 层调查队、122 层耶鲁士自律战斗通信机 (508)、
 *                          114 层大厅（evadd 39 + 状态 269）
 *     map 76 混沌巨城：25 个楼层各有剧情 NPC（147/151/153/154/159/164/169/173/178/179…）
 *
 * 网页版的地下城是程序生成的（`Game.generateDungeon`），没有原版手工地图，
 * 所以本模块只负责**语义**：
 *   · 层到达时按表生成该层的剧情角色（原版同样在 map_init 里 characreate）；
 *   · 应用该层的 `var_65(250+n)` 写入与 `evadd`（原版紧跟 characreate 的副作用）。
 *
 * 【坐标解释】
 *   x === 'player'  源码写的是 `var_58(1, 0)/var_58(2, 0)`（玩家所在格）
 *   x === number    源码是手工地图的固定坐标 → 在附近螺旋搜索最近的可站立格
 *   x === 'auto'    在玩家周围找空格
 *   找不到合适格 → 放到玩家脚下（宁可挤在一起，也不丢剧情角色）。
 *
 * 【去重】
 *   原版每次 map_init 都会重建这些角色（手工地图每层只有一份），而网页版会缓存
 *   已生成的楼层（`dungeonFloors`）。因此这里先检查同层是否已有同物种的存活角色，
 *   有则跳过 —— 与「剧情角色唯一」的语义一致。
 */
(function (global) {
  'use strict';

  const Elona = global.Elona = global.Elona || {};

  const V_STATE = 252;

  let TABLE = null;
  let loading = null;
  const BY_MAP = new Map();     // mapId → [floor]

  function index() {
    BY_MAP.clear();
    for (const f of (TABLE.floors || [])) {
      if (!BY_MAP.has(f.map)) BY_MAP.set(f.map, []);
      BY_MAP.get(f.map).push(f);
    }
  }

  function tableSync() {
    if (TABLE) return TABLE;
    if (Elona.StoryMapData && Elona.StoryMapData.floors) TABLE = Elona.StoryMapData;
    else if (Elona.Data && Elona.Data.tableSync) {
      try { TABLE = Elona.Data.tableSync('storymap'); } catch (e) { TABLE = null; }
    }
    if (TABLE) index();
    return TABLE;
  }

  async function load() {
    if (TABLE) return TABLE;
    if (loading) return loading;
    loading = (async () => {
      if (Elona.StoryMapData && Elona.StoryMapData.floors) TABLE = Elona.StoryMapData;
      else if (Elona.Data && Elona.Data.fetchJson) {
        try { TABLE = await Elona.Data.fetchJson('data/tables/storymap.json'); } catch (e) { TABLE = null; }
      }
      if (TABLE) index();
      return TABLE;
    })();
    return loading;
  }

  // ---------------------------------------------------------------- 条件

  function makeCtx(g) {
    return {
      g,
      dead: null,
      killer: null,
      deadIndex: -1,
      killerIndex: -1,
      v65(i) {
        if (!g || typeof g.getV65 !== 'function') return 0;
        const v = g.getV65(i | 0);
        return (v === undefined || v === null) ? 0 : (v | 0);
      },
    };
  }

  function evalCond(node, c) {
    if (Elona.StoryKill && Elona.StoryKill.evalCond) {
      const v = Elona.StoryKill.evalCond(node, c);
      return v === 1;
    }
    return true;
  }

  function pass(list, c) {
    for (const n of (list || [])) if (!evalCond(n, c)) return false;
    return true;
  }

  // ---------------------------------------------------------------- 落格

  function inMap(g, x, y) {
    const m = g.map;
    return !!m && x >= 1 && y >= 1 && x < m.width - 1 && y < m.height - 1;
  }

  function standable(g, x, y, allowPlayer) {
    if (!inMap(g, x, y)) return false;
    const m = g.map;
    if (typeof m.walkable === 'function' && !m.walkable(x, y)) return false;
    if (g.charas && g.charas.some((c) => c && (c.get(0) | 0) === 1
      && !(allowPlayer && (c.index | 0) === 0) && c.x === x && c.y === y)) return false;
    return true;
  }

  /** 以 (x,y) 为中心螺旋找最近的可站立格 */
  function nearestFree(g, x, y, maxR) {
    if (standable(g, x, y)) return { x, y };
    const R = maxR || 12;
    for (let r = 1; r <= R; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          if (standable(g, x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return null;
  }

  function resolve(g, spawn, mi) {
    const p = g.player || { x: 0, y: 0 };
    const px = p.x | 0, py = p.y | 0;
    if (spawn.x === 'player' || spawn.y === 'player') {
      // 源码就是「在玩家所在格生成」（var_58(1, 0), var_58(2, 0)）。
      // 玩家站得住就说明这格可用 —— 地面物品/地毯格的 map.walkable 可能是 false，
      // 所以这里只看「有没有别的角色」，不查 walkable。
      const blocked = (g.charas || []).some((c) => c && (c.get(0) | 0) === 1
        && (c.index | 0) !== 0 && c.x === px && c.y === py);
      if (inMap(g, px, py) && !blocked) return { x: px, y: py };
      const off = mi | 0;
      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];
      for (let k = 0; k < dirs.length; k++) {
        const d = dirs[(k + off) % dirs.length];
        if (standable(g, px + d[0], py + d[1])) return { x: px + d[0], y: py + d[1] };
      }
      return { x: px, y: py };
    }
    if (typeof spawn.x === 'number' && typeof spawn.y === 'number') {
      const s = nearestFree(g, spawn.x | 0, spawn.y | 0, 16);
      if (s) return s;
    }
    const s2 = nearestFree(g, px, py, 8);
    return s2 || { x: px, y: py };
  }

  // ---------------------------------------------------------------- 生成

  function alreadyOnFloor(g, sp) {
    if (!g.charas) return false;
    return g.charas.some((c) => c && (c.get(0) | 0) === 1 && (c.get(27) | 0) === (sp | 0));
  }

  function spawnOne(g, spawn, depth, out) {
    const CF = Elona.CharaFactory;
    if (!CF || typeof CF.create !== 'function') { out.skipped.push({ sp: spawn.sp, why: 'no-factory' }); return null; }
    if (alreadyOnFloor(g, spawn.sp)) { out.skipped.push({ sp: spawn.sp, why: 'already' }); return null; }
    const pos = resolve(g, spawn, out.spawned.length);
    // 原版 `flt` → var_640 = calcobjlv(var_65(22))（层数），这里用层数作等级
    const lv = (spawn.level !== undefined && spawn.level !== null)
      ? (spawn.level | 0) : Math.max(1, depth | 0);
    let c = null;
    try {
      c = CF.create(g, spawn.sp | 0, lv, pos.x, pos.y, { var641: spawn.quality | 0 });
    } catch (e) { c = null; }
    if (!c) { out.skipped.push({ sp: spawn.sp, why: 'create-failed' }); return null; }
    // var_58(f, var_581) = v —— 源码紧跟 characreate 的字段写入
    for (const [f, v] of (spawn.fields || [])) {
      if (f === 7) { c.set(7, v | 0); continue; }        // 位置编码字段照抄
      c.set(f | 0, v | 0);
    }
    for (const bit of (spawn.cbits || [])) {
      if (Elona.Status && Elona.Status.cbitmod) Elona.Status.cbitmod(c, bit | 0, 1);
    }
    if (spawn.name) c.name = spawn.name.en || spawn.name.jp || c.name;
    c.__storySpawn = { map: g.getV65 ? (g.getV65(20) | 0) : 0, depth: depth | 0, species: spawn.sp | 0 };
    out.spawned.push({ sp: spawn.sp, index: c.index | 0, x: pos.x, y: pos.y, name: c.name });
    return c;
  }

  /** 一个 if 块的语句共享一次条件求值（源码语义），块内顺序执行 */
  function applyBlocks(g, blocks, c, out) {
    for (const b of (blocks || [])) {
      if (!pass(b.conds, c)) { out.blocked.push({ k: 'block', line: b.effects[0] && b.effects[0].line }); continue; }
      applyEffects(g, b.effects, c, out);
    }
  }

  function applyEffects(g, effects, c, out) {
    const SK = Elona.StoryKill;
    for (const e of (effects || [])) {
      if (e.k === 'setV65') { if (g.setV65) g.setV65(e.i | 0, e.v | 0); out.effects.push({ k: 'setV65', i: e.i, v: e.v }); }
      else if (e.k === 'addV65') {
        if (g.setV65) {
          const cur = g.getV65(e.i | 0) | 0;
          g.setV65(e.i | 0, cur + (e.v | 0));
          out.effects.push({ k: 'addV65', i: e.i, v: e.v, from: cur });
        }
      } else if (e.k === 'evadd') {
        const add = (g.events && typeof g.events.add === 'function')
          ? g.events.add.bind(g.events)
          : (Elona.Event && typeof Elona.Event.add === 'function' ? Elona.Event.add : null);
        if (add) { add(e.id | 0); out.effects.push({ k: 'evadd', id: e.id }); }
        else out.skipped.push({ k: 'evadd', id: e.id, why: 'no-queue' });
      } else if (e.k === 'snd') {
        if (Elona.Audio && typeof Elona.Audio.playIndex === 'function') {
          try { Elona.Audio.playIndex(e.id | 0); } catch (err) { /* 无声卡 */ }
        }
        out.effects.push({ k: 'snd', id: e.id });
      } else if (e.k === 'msg') {
        const Zh = SK && SK.MSG_ZH ? SK.MSG_ZH[e.jp] : null;
        const line = Zh || e.en || e.jp || '';
        if (line && g.log) g.log(line);
        out.effects.push({ k: 'msg', text: line });
      }
    }
  }

  /** 该地图、该层对应的表项（可能多条） */
  function floorsFor(mapId, depth, opts) {
    const tbl = tableSync();
    if (!tbl) return [];
    const list = BY_MAP.get(mapId | 0) || [];
    const maxDepth = (opts && opts.maxDepth) | 0;
    return list.filter((f) => (f.depth === 'bottom'
      ? (maxDepth > 0 && (depth | 0) === maxDepth)
      : (f.depth | 0) === (depth | 0)));
  }

  /**
   * 进入地城某层时调用（`Game.enterDungeon` 在写好 `var_65(20)/(22)` 之后）。
   * @param {object} g
   * @param {number} mapId  var_65(20)
   * @param {number} depth  var_65(22)
   * @param {object} [opts] { maxDepth } —— 用于判定 'bottom'
   * @returns {{spawned:Array, effects:Array, blocked:Array, skipped:Array}}
   */
  function onEnterFloor(g, mapId, depth, opts) {
    const out = { spawned: [], effects: [], blocked: [], skipped: [], floors: 0 };
    if (!g) return out;
    advanceLesimas(g, mapId, depth);
    soulcageSpawn(g, mapId, depth, out);
    const list = floorsFor(mapId, depth, opts);
    if (!list.length) return out;
    const c = makeCtx(g);
    for (const f of list) {
      if (!pass(f.conds, c)) continue;
      out.floors++;
      let mi = 0;
      for (const sp of (f.spawns || [])) {
        if (!pass(sp.conds, c)) { out.blocked.push({ k: 'spawn', sp: sp.sp }); continue; }
        const n = Math.max(1, sp.count | 0 || 1);
        for (let k = 0; k < n; k++) spawnOne(g, sp, depth, out);
        mi++;
      }
      applyBlocks(g, f.blocks, c, out);
    }
    if (out.spawned.length && typeof g.syncCharaCells === 'function') g.syncCharaCells();
    return out;
  }

  // ================================================================
  // 344401-344613：主线楼梯屏障 / 封印门 / 173 层 NPC 事件
  //   原版把「封印门」放在对应楼层的下行楼梯格上（feat 237），开启后
  //   `cell_featset(x,y,var_1606,11)` 才变成真正的下行楼梯。本项目沿用
  //   这一结构：enterDungeon 在封印层放 237 而不是 231，开门的判定在
  //   MapFeat.openDoor；其余「看不见的屏障」直接在 useStairs 拦下。
  // ================================================================
  const V = (g, i) => (g && typeof g.getV65 === 'function' ? (g.getV65(i | 0) | 0) : 0);

  /** 344413-344476：下楼前的主线屏障文案（null = 可以通过） */
  function stairBarrier(g) {
    const map = V(g, 20), depth = V(g, 22), main = V(g, 252);
    if (map === 42) {
      // 240573-240583：var_65(186) 缺省 = 入口层 + 4
      const limitDepth = V(g, 186) || ((g.dungeonMinDepth | 0) + 4);
      if (depth >= limitDepth) return '楼梯被奇怪的屏障挡住了。';
    }
    if (map === 3) {
      if (depth === 30 && V(g, 611) < 35) return '楼梯被奇怪的屏障挡住了。「不许你再往前」';
      if (depth === 40 && V(g, 611) < 55) return '楼梯被奇怪的屏障挡住了。「紧急防御程序启动中」';
    }
    if (map === 49 && depth === 114 && main < 270) return '楼梯被混沌之力封住了。';
    if (map === 76) {
      if (depth === 143 && main < 382) return '得先把银熊的事报告给艾莉丝缇亚。';
      if (depth === 146 && main < 455) return '楼梯被混沌之力封住了。';
      if (depth === 149 && main < 490) return '得先完成委托并报告给加维拉。';
      if (depth === 154 && main < 525) return '诺恩「神说，现在还不是前进之时……」';
    }
    return null;
  }

  /** 344511-344556：该层是否有封印门（feat 237），以及开启所需的主线阶段 */
  const SEALED_DOORS = {
    3: { 3: 65, 17: 115, 25: 125, 44: 125 },
    49: { 106: 267, 122: 282 },
    76: { 142: 0, 159: 560 },
  };
  function sealedDoorAt(mapId, depth) {
    const t = SEALED_DOORS[mapId | 0];
    if (!t) return null;
    const need = t[depth | 0];
    return need === undefined ? null : { need: need | 0 };
  }
  /** 玩家当前所在位置是否允许开启封印门 */
  function sealedDoorAllowed(g) {
    const d = sealedDoorAt(V(g, 20), V(g, 22));
    if (!d) return false;
    return V(g, 252) >= d.need;
  }

  /**
   * 344604-344613：地图 74 深于 10 层时，魂之限耗尽（var_1290<=0）
   * 且剧情阶段 var_1853>=2 → 带走同伴（findallyguard(1034)）。
   * 项目尚未移植 map 74 的魂之限剧情（没有 var_1290/var_1853），
   * 因此这里只在两个变量存在时才执行；缺失时安全跳过。见 docs/18 D-014。
   */
  function stairLeaveAlly(g) {
    if (V(g, 20) !== 74 || V(g, 22) < 10) return null;
    if ((g.var1290 | 0) > 0 || (g.var1853 | 0) < 2) return null;
    g.var1853 = 0;
    const list = g.charas || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (!c || !c.get || (c.get(0) | 0) !== 1 || (c.get(27) | 0) !== 1034) continue;
      if (Elona.Chara && Elona.Chara.vanquish) { try { Elona.Chara.vanquish(g, i); } catch (e) { /* noop */ } }
      return { k: 'leave-ally', index: i };
    }
    return null;
  }

  /** 344477-344492：地图 76 深度 173 下楼时，物种 886 自爆并把主线推到 640 */
  function stairNpc886(g) {
    if (V(g, 20) !== 76 || V(g, 22) !== 173) return null;
    const list = g.charas || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !c.get || (c.get(0) | 0) !== 1 || (c.get(27) | 0) !== 886) continue;
      if (g.log) g.log(`${c.name || '某人'}的身体炸裂开来。`);
      if (Elona.Audio && typeof Elona.Audio.playIndex === 'function') {
        try { Elona.Audio.playIndex(34); } catch (e) { /* 无声卡 */ }
      }
      if (Elona.Chara && Elona.Chara.vanquish) { try { Elona.Chara.vanquish(g, i); } catch (e) { /* noop */ } }
      g.setV65(252, 640);
      g.setV65(575, 1);          // var_65(250+325)
      return { k: 'npc886', index: i };
    }
    return null;
  }

  /** useStairs 下楼前统一调用：先屏障，再剧情事件。返回 null 表示可继续。 */
  function onStairDown(g) {
    const msg = stairBarrier(g);
    if (msg) return { blocked: true, message: msg };
    const ev = stairNpc886(g);
    return ev ? { blocked: false, event: ev } : null;
  }

  /** 247433-247463：雷希墨苏（地图 3）楼层推进 var_65(250+361)=611 */
  const LESIMAS_STAGE = { 20: [0, 10], 25: [10, 20], 30: [20, 30], 34: [35, 40], 40: [40, 50] };
  function advanceLesimas(g, mapId, depth) {
    if ((mapId | 0) !== 3) return 0;
    const a = LESIMAS_STAGE[depth | 0];
    if (!a) return 0;
    if (V(g, 611) !== a[0]) return 0;
    g.setV65(611, a[1]);
    return a[1];
  }


  // ================================================================
  // 地图 74「魂之限」（阿穆尔暗笼 / 冥宮）
  //   源码：map_init 242665-243608、637 分支 392869-393040、1034 分支
  //   392680-392868、1037 分支 392655-392679、计时 204222-204238、
  //   失败 200401-200418、离层 344604-344613。
  //   本项目沿用地图 3/49/76 的口径：楼层随机生成，这里只负责**剧情语义**
  //   —— 在对应层摆出任务 NPC，并维护 1290/1853/250+440 三个状态。
  // ================================================================
  const SOUL_MAP = 74;

  function soulSpecies(g, sp) {
    const list = g.charas || [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c && typeof c.get === 'function' && (c.get(0) | 0) === 1 && (c.get(27) | 0) === (sp | 0)) return c;
    }
    return null;
  }

  function soulSpawn(g, sp, depth, out) {
    if (soulSpecies(g, sp)) return null;
    const CF = Elona.CharaFactory;
    if (!CF || typeof CF.create !== 'function') return null;
    const p = g.player || { x: 0, y: 0 };
    const m = g.map;
    let pos = null;
    if (m) {
      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1], [0, 2], [2, 0]];
      for (const d of dirs) {
        const x = (p.x | 0) + d[0], y = (p.y | 0) + d[1];
        if (x < 1 || y < 1 || x >= m.width - 1 || y >= m.height - 1) continue;
        if (typeof m.walkable === 'function' && !m.walkable(x, y)) continue;
        if ((g.charas || []).some((c) => c && (c.get(0) | 0) === 1 && c.x === x && c.y === y)) continue;
        pos = { x, y }; break;
      }
    }
    if (!pos) pos = { x: p.x | 0, y: p.y | 0 };
    let c = null;
    try { c = CF.create(g, sp | 0, Math.max(1, depth | 0), pos.x, pos.y); } catch (e) { c = null; }
    if (c && out) out.spawned.push({ sp: sp | 0, index: c.index | 0, x: pos.x, y: pos.y });
    return c;
  }

  /** 进入地图 74 的某层时摆放任务 NPC（onEnterFloor 调用） */
  function soulcageSpawn(g, mapId, depth, out) {
    if ((mapId | 0) !== SOUL_MAP) return;
    const d = depth | 0;
    const v1853 = (g.var1853 | 0) || 0;
    if (d === 1) {
      // 242672：入口层的《永遠のネヘルタード》637（委托者 / 领奖）。
      soulSpawn(g, 637, 1, out);
    } else if (d === 60) {
      // 242809：最深层的迷子 1034；已开始护送（1853>=2）就不再重复生成。
      if (v1853 < 2) soulSpawn(g, 1034, d, out);
    } else if (d === 11 || d === 12 || d === 16 || d === 26 || d === 36 || d === 46) {
      // 242132-243142 / 243310：？？？？ 1037；剧情推进到 5 之后不再出现。
      if (v1853 < 5) soulSpawn(g, 1037, d, out);
    }
  }

  /**
   * 每回合：魂之限倒计时（204222-204238）。
   *   深度 >=10 且 var_1290>0 时递减；归零 → 250+440 += 9（失败），提示。
   */
  function soulcageOnTurn(g) {
    if (!g || typeof g.getV65 !== 'function') return null;
    if ((g.getV65(20) | 0) !== SOUL_MAP) return null;
    if ((g.getV65(22) | 0) < 10) return null;
    if ((g.var1290 | 0) <= 0) return null;
    g.var1290 = (g.var1290 | 0) - 1;
    if (g.var1290 === 0) {
      g.setV65(250 + 440, (g.getV65(250 + 440) | 0) + 9);
      if (g.log) g.log('ネヘルタード「間に合わなかった…。救済すべき魂はもう助からない…」');
      return { failed: true };
    }
    return { tick: g.var1290 };
  }

  /**
   * 死亡：地图 74 深度 >=10 时玩家或护送对象 1034 死亡 → 250+440 += 9（200401-200418）。
   * @param {boolean} isPlayer
   */
  function soulcageOnDeath(g, dead, isPlayer) {
    if (!g || typeof g.getV65 !== 'function') return null;
    if ((g.getV65(20) | 0) !== SOUL_MAP) return null;
    if ((g.getV65(22) | 0) < 10) return null;
    const sp = (dead && typeof dead.get === 'function') ? (dead.get(27) | 0) : 0;
    if (!isPlayer && sp !== 1034) return null;
    if (isPlayer && (g.var1853 | 0) >= 2) {
      const escort = soulSpecies(g, 1034);
      if (escort && typeof g.charaVanquish === 'function') {
        try { g.charaVanquish(escort.index | 0); } catch (e) { /* noop */ }
      }
    }
    g.setV65(250 + 440, (g.getV65(250 + 440) | 0) + 9);
    if (g.log) g.log('ネヘルタード「もう駄目…残念…」');
    return { failed: true };
  }

  Elona.StoryMap = {
    V_STATE, load, tableSync, floorsFor, onEnterFloor, makeCtx,
    stairBarrier, sealedDoorAt, sealedDoorAllowed, onStairDown,
    stairLeaveAlly, stairNpc886, advanceLesimas,
    soulcageSpawn, soulcageOnTurn, soulcageOnDeath,
    floors() { const t = tableSync(); return (t && t.floors) || []; },
    _reset() { TABLE = null; loading = null; BY_MAP.clear(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
