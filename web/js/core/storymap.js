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

  Elona.StoryMap = {
    V_STATE, load, tableSync, floorsFor, onEnterFloor, makeCtx,
    floors() { const t = tableSync(); return (t && t.floors) || []; },
    _reset() { TABLE = null; loading = null; BY_MAP.clear(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
