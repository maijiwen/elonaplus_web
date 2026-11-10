'use strict';
/**
 * 地图 / 世界 / tile / 货物收口规则（core/residual_map.js）—— B 组
 * 数据源 web/data/tables/residual_map.json，由 tools/extract_residual_map.py 逐行校验生成。
 *
 * 【源码区间逐条登记（hsp/start.hsp，cp932）】
 *  249342-249767：map_prepareTile 时段光照表、world_newRandArea 槽位统计、
 *                 world_update 地壳变动、world_setArea:building 逐 tile 修正 →
 *                 prepareTileRules() / lighting() / worldAreaRules()
 *  292183-292600：label_2777/2778 的 var_472 物种候选清单（地图 id / 深度档）→
 *                 siteCandidates() / allCandidates() / candidateEntries()
 *  251302-251441：label_2475 的 450-500 随机站点槽分配、类型→feat 表、等级公式 →
 *                 randSiteRules() / siteTypeFeat() / siteLevel()
 *  343328-343452：label_2990 世界地图 tile 264..363 阻挡与离图询问 →
 *                 tileRange() / worldTileBlocked() / worldTileCheck()
 *  232357-232638：label_2430/2431 迷宫尺寸公式、房间编号与楼梯距离 →
 *                 mazeSize() / entryPoint() / mapSizes()
 *  237831-237925：label_2462 map_init 深度限幅、随从复位、地图存档键 →
 *                 clampDepth() / mapSaveKey() / mapInitRules()
 *                 （深度限幅细目 237835-237847）
 *  232181-232270：label_2424/2425 居中起点公式与 tile 165 河带 →
 *                 centeredStart() / riverBand()
 *  232271-232336：label_2426 宽 30 / 高 60+rnd(60) 走廊与上下楼梯 → corridorSize()
 *  229082-229142：label_2380 exgoto var_1381 四方向门口连接表 →
 *                 connectRoomSides() / connectRoomPoint()
 *  304411-304469：label_2879 的 35 / 76+179 / 74+>=10 不可保存地图集合 →
 *                 canEnter() / noSaveMaps()
 *  245727-245784：label_2464 map_preBegin 世界地图 id、三年回归坐标 → mapPreBeginRules()
 *  300703-300757：label_2845 退出提示与存档条件 → exitPrompt()
 *  232129-232180：label_2423 map_initcustom 自定义地图初始化 → mapSizes().initCustom
 *  300334-300382：label_2837 锁定目标 var_58(29) 无效清 0 → validateTarget()
 *  228987-229028：label_2370 陷阱随机坐标与深度过滤 → trapId() / randomTilePos()
 *  233681-233721：label_2439 移动随从提示与非法位置判定 → movePrompts()
 *  230090-230125：label_2403 地图尺寸下限修正与缓冲复制 → clampMapSize()
 *  342549-342582：label_2984 cargocheck 调用点与道具占用提示 → cargoCheck()
 *  232639-232669：label_2432 难度档→深度上限 / 金币 / tileset 表 → difficultyTier()
 *  301510-301540：label_2854 fixOnMapEnter 越界随从归位与 map7 特例 → fixOnMapEnter()
 *  270959-270987：label_2589 begintempinv 临时背包场景变量 → tempInvRules()
 *  229175-229203：label_2384 rnd(100) 判定与物品计数公式 → editorRules()
 *  211179-211201：label_2119 地图装饰绘制参数 → renderRules()
 *  211202-211228：label_2120 地图装饰绘制参数 → renderRules()
 *  211229-211255：label_2121 地图装饰绘制参数 → renderRules()
 *  211256-211282：label_2122 地图装饰绘制参数 → renderRules()
 *  211347-211369：label_2126 地图装饰绘制参数 → renderRules()
 *  228116-228141：map_line 逐格先 x 后 y 的 tile 100 划线 → linePath()
 *  231623-231646：label_2421 竞技场 48+rnd(20) × 22 与墙 tile 3 → arenaSize()
 *  232347-232356：label_2429 迷宫尺寸公式第二处 → mazeSize()
 *  228142-228163：map_makesimpleroom 房间边框 / 地板 → simpleRoom()
 *  24277-24298：label_0289 季节 / 地图初始化 repeat 12 → seasonInit()
 *  229035-229052：label_2373 蛛网 exgoto 三次尝试 → webTries()
 *  229059-229076：label_2376 木桶 exgoto 三次尝试 → barrelTries()
 *  228761-228776：map_placedownstairs 的 feat 11 与 y*1000+x 编码 → downstairs()
 *  230146-230160：label_2406 地图文件保存对话框参数 → editorRules()
 *  229915-229927：label_2396 编辑器列表构建变量 → editorRules()
 *  228748-228760：map_placeupstairs 的 feat 10 与 y*1000+x 编码 → upstairs()
 *  229204-229215：label_2385 新建地图确认对话框 → editorRules()
 *  31537-31547：#deffunc cargocheck 允许的地图类型 1/5/3/4/6/2 → cargoCheck()
 *  230135-230145：label_2405 地图文件打开对话框参数 → editorRules()
 *  230161-230170：label_2407 var_1678 扫描 400 槽 → editorRules()
 *  230081-230089：label_2402 迷雾层 2 全图填充 → editorRules()
 *  230126-230134：label_2404 空地图名回退 → editorRules()
 *  228461-228469：map_setfog 战争迷雾表达式 → fogValue()
 *  229867-229874：label_2393 var_1716 编辑器标志 → editorRules()
 *  230065-230072：label_2400 var_1693 开关 → editorRules()
 *  230073-230080：label_2401 全图 tile 随机表达式 → editorRules()
 *  233647-233652：label_2437 随从移动状态机 → movePrompts()
 *  230060-230064：label_2399 var_469 行清零 → editorRules()
 *  228111-228115：map_randomtile 数量公式 → randomTileCount()
 *  229031-229034：map_web 定义与随机坐标 → webTries()
 *  229055-229058：map_barrel 定义与随机坐标 → barrelTries()
 *  229328-229330：label_2388 map_tileset var_4 → editorRules()
 *  228458-228459：map_makeroom 入口 → mapToolRules()
 *  229080-229081：map_connectroom 起始槽 var_1381=0 → connectRoomSides()
 *  229893-229914：label_2395 编辑器列表变量 → editorRules()
 *  425317-425379：label_3067 事件区变量初始化与好感度阈值 → eventZoneInit()
 *
 * 【数据加载】测试注入 Elona.ResidualMapData 优先，浏览器走
 *  Elona.Data.tableSync('residual_map')，另提供 load() 走 Elona.Data.table()。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let DATA = null;

  function setData(t) { DATA = t || null; return DATA; }

  /** 同步取表：测试注入 > 浏览器 Data.tableSync */
  function tableSync() {
    if (DATA) return DATA;
    if (Elona.ResidualMapData) {
      DATA = Elona.ResidualMapData;
    } else if (Elona.Data && Elona.Data.tableSync) {
      try { DATA = Elona.Data.tableSync('residual_map'); } catch (e) { DATA = null; }
    }
    return DATA;
  }

  /** 浏览器异步取表（tableSync 不可用时） */
  async function load() {
    if (DATA) return DATA;
    if (Elona.ResidualMapData) {
      DATA = Elona.ResidualMapData;
    } else if (Elona.Data && Elona.Data.table) {
      try { DATA = await Elona.Data.table('residual_map'); } catch (e) { DATA = null; }
    }
    return DATA;
  }

  function T() { return tableSync() || {}; }

  // ---------------------------------------------------------------- 段与区间
  function segments() { return (T().segments || []).slice(); }
  function src() { return T().src || {}; }
  function srcOf(key) { return (T().src || {})[key] || ''; }

  function tileRanges() { return T().tileRanges || {}; }
  function tileRange(name) {
    const r = tileRanges();
    return name === undefined ? r : r[name];
  }

  /** 世界地图阻挡 tile：264 <= tile < 363（343330） */
  function worldTileBlocked(tile) {
    const r = tileRanges().worldBlocking || { lo: 264, hi: 363 };
    return (tile | 0) >= r.lo && (tile | 0) < r.hi;
  }

  /** 水域 tile：33 <= tile < 57 且 tile != 44（251314 / 249735） */
  function waterTile(tile) {
    const r = tileRanges().water || { lo: 33, hi: 57, exclude: [44] };
    const t = tile | 0;
    return t >= r.lo && t < r.hi && (r.exclude || []).indexOf(t) < 0;
  }

  /** 随机站点槽：450..499 共 50 个（251303 / 249569） */
  function siteSlotRange() {
    const r = tileRanges().siteSlot || { lo: 450, hi: 500, count: 50 };
    return { start: r.lo, end: r.hi, count: r.count };
  }

  // ---------------------------------------------------------------- 地图大小与坐标
  /** 越界坐标居中：var_126(0)/2, var_126(1)/2（249719-249720） */
  function entryPoint(w, h) {
    return { x: Math.floor((w | 0) / 2), y: Math.floor((h | 0) / 2) };
  }

  /** 居中起点：extent/2 - width/2 - pad（232183 / 232228 / 232277） */
  function centeredStart(extent, width, pad) {
    const p = pad === undefined ? 5 : pad;
    return Math.floor((extent | 0) / 2) - Math.floor((width | 0) / 2) - p;
  }

  /** 河带：band = 6+var_65(682)，起点居中减 5，tile 165（232182-232228） */
  function riverBand(extent, var682) {
    const band = 6 + (var682 | 0);
    return { band: band, start: centeredStart(extent, band, 5), tile: 165 };
  }

  function mapSizes() { return T().mapSizes || {}; }

  /** 迷宫尺寸：w = rooms*(span*2)-span+8，h = w，上限 w*h/12（232503 / 232348） */
  function mazeSize(rooms, span) {
    const w = (rooms | 0) * ((span | 0) * 2) - (span | 0) + 8;
    return { w: w, h: w, creatureLimit: Math.floor(w * w / 12) };
  }

  /** 走廊地图：w=30，h=60+rnd(60)，上限 w*h/20（232272-232274） */
  function corridorSize(rnd60) {
    const w = 30, h = 60 + (rnd60 | 0);
    return { w: w, h: h, creatureLimit: Math.floor(w * h / 20), band: 6 };
  }

  /** 竞技场：w=48+rnd(20)，h=22，上限 w*h/20（231624-231626） */
  function arenaSize(rnd20) {
    const w = 48 + (rnd20 | 0), h = 22;
    return { w: w, h: h, creatureLimit: Math.floor(w * h / 20), wall: 3 };
  }

  /** 地图尺寸下限修正（230091-230100） */
  function clampMapSize(w, h, minW, minH) {
    return { w: Math.max(w | 0, minW | 0), h: Math.max(h | 0, minH | 0) };
  }

  /** map_init 深度限幅（237835-237847） */
  function clampDepth(depth, minLevel, maxLevel) {
    return Math.max(minLevel | 0, Math.min(maxLevel | 0, depth | 0));
  }

  /** 地图存档键：mapId + "_" + (100+depth)（237864） */
  function mapSaveKey(mapId, depth) {
    return String(mapId | 0) + '_' + String(100 + (depth | 0));
  }

  // ---------------------------------------------------------------- 光照表（249342-249537）
  function prepareTileRules() {
    const d = T();
    return { lighting: d.lighting || {}, worldArea: d.worldArea || {},
             randSite: d.randSite || {}, src: (d.src || {}).prepareTile || '' };
  }

  function evalRgb(spec, hour) {
    return [0, 1, 2].map((i) => spec.base[i] + spec.step[i] * (hour - spec.offset[i]));
  }

  /**
   * 求时段光照。
   * @param {number} hour var_65(13)
   * @param {object} o { indoor, worldTile, mapId, illum:'A'|'B', weather:3|4 }
   */
  function lighting(hour, o) {
    const L = T().lighting || {};
    const opt = o || {};
    const h = hour | 0;
    let set = null, weatherFloor = {}, mapBonus = null, special = false;

    if (opt.worldTile === 47 && opt.mapId === 2) {
      const s = L.special47 || {};
      const blk = opt.illum === 'B' ? s.illumB : s.illumA;
      set = (blk && blk.hours) || null;
      special = true;
    } else {
      const blk = opt.indoor ? L.indoor : L.outdoor;
      set = (blk && blk.hours) || null;
      weatherFloor = (blk && blk.weatherFloor) || {};
      mapBonus = (blk && blk.mapBonus) || null;
    }

    if (!set || !set.length) {
      const def = L.default || { rgb: { base: [5, 5, 5], step: [0, 0, 0], offset: [0, 0, 0] }, bright: 15 };
      return { rgb: evalRgb(def.rgb, h), bright: def.bright };
    }

    let rule = set[set.length - 1];
    for (const r of set) {
      if (h >= r.lo && h < r.hi) { rule = r; break; }
    }
    const rgb = evalRgb(rule.rgb, h);
    let bright = rule.bright;

    if (rule.floor !== undefined && rgb[0] < rule.floor) {
      rgb[0] = rule.floor;
      const fb = rule.floorBright || { base: 8, step: 2, offset: 3 };
      bright = fb.base + fb.step * (h - fb.offset);
    }
    if (!special) {
      const wf = weatherFloor[String(opt.weather)];
      if (wf !== undefined && rgb[0] < wf) {
        rgb[0] = rgb[1] = rgb[2] = wf;
      }
      if (mapBonus && opt.mapId === mapBonus.mapId && (h >= 17 || h < 7)) {
        for (let i = 0; i < 3; i++) rgb[i] += mapBonus.add;
      }
    }
    return { rgb: rgb, bright: bright };
  }

  // ---------------------------------------------------------------- 世界与站点规则
  function worldAreaRules() { return T().worldArea || {}; }
  function worldUpdateRules() {
    const w = worldAreaRules();
    return { customMaps: w.customMaps || [], diastrophism: w.diastrophism || {},
             targetCount: w.targetCount || {}, siteReset: w.siteReset || {} };
  }
  function randSiteRules() { return T().randSite || {}; }
  function siteTypeFeat(type) {
    const m = randSiteRules().typeFeat || {};
    return m[String(type | 0)] || null;
  }

  /** 站点等级 4 个分支（251364-251399）；rnd(n) 返回 [0,n) */
  function siteLevel(mode, base, rng, opts) {
    const o = opts || {};
    const r = (n) => (rng ? rng(n) : 0);
    let lv;
    if (mode === 0 || mode === 1) {
      lv = Math.floor(base / 2 + r(Math.floor(base * 11 / 10) + 5) + 1);
      if (o.resetWorld) lv = Math.floor(lv / 4) + 1;
      if (mode === 1) {
        if (o.worldTile === 4) lv = Math.floor(lv / 4) + 1;
        else if (o.worldTile === 44) lv = Math.floor(lv / 2) + 1;
        else if (o.worldTile === 70) lv = Math.floor(lv * 3 / 4) + 1;
      }
    } else if (mode === 2) {
      lv = r(45) + 1;
      if (o.worldTile === 44) lv = r(60) + 30;
      else if (o.worldTile === 70) lv = r(50) + 100;
    } else {
      lv = Math.floor(base * 9 / 10 + r(Math.floor(base / 5) + 2) + 1);
      if (o.resetWorld) lv = Math.floor(lv / 4) + 1;
    }
    return { level: lv, maxLevel: lv + 2 };
  }

  /** var_472 物种候选：基础 + 地图 id 分支 + 深度档分支（292185-292593） */
  function siteCandidates(mapId, mode) {
    const c = T().siteCandidates || {};
    let out = (c.base || []).slice();
    const bm = (c.byMap || {})[String(mapId | 0)];
    if (bm) out = out.concat(bm);
    if (mode !== undefined && mode !== null) {
      const bmm = (c.byMapMode || {})[String(mapId | 0) + ':' + String(mode | 0)];
      if (bmm) out = out.concat(bmm);
    }
    return out;
  }

  /** label_2778 全表 150..190,300,301（292509-292593） */
  function allCandidates() { return ((T().siteCandidates || {}).all || []).slice(); }

  /** label_2777/2778 生成 var_484 条目 [id, var_83+21000]（292493-292599） */
  function candidateEntries(ids, var83, filterFn) {
    const out = [];
    for (const id of (ids || [])) {
      if (filterFn && !filterFn(id)) continue;
      out.push([id, (typeof var83 === 'function' ? var83(id) : (var83 || 0)) + 21000]);
    }
    return out;
  }

  function worldTileCheck(tile, o) {
    const c = T().worldTileCheck || {};
    const opt = o || {};
    return {
      blocked: worldTileBlocked(tile),
      blocking: c.blocking || { lo: 264, hi: 363 },
      leaveCheck: c.leaveCheck || {},
      questMaps: (c.questMaps || []).slice(),
      specialActions: c.specialActions || {},
      bump: !!opt.bump,
    };
  }

  // ---------------------------------------------------------------- 禁入 / 存档 / 目标
  function noSaveMaps() { return (T().noSaveMaps || []).slice(); }

  /** 35 / 76+179 / 74+>=10 → 返回 false（304412） */
  function canEnter(mapId, depth) {
    for (const r of noSaveMaps()) {
      if (r.mapId !== (mapId | 0)) continue;
      if (r.depth !== undefined && (depth | 0) !== r.depth) continue;
      if (r.depthMin !== undefined && (depth | 0) < r.depthMin) continue;
      return false;
    }
    return true;
  }

  /** 退出提示与存档条件（300705-300735） */
  function exitPrompt(mapId, depth) {
    const e = T().noSaveExit || {};
    const blocked = (e.rules || []).some((r) => r.mapId === (mapId | 0) &&
      (r.depth === undefined || r.depth === (depth | 0)));
    return {
      text: blocked ? (e.textNoSave || '') : (e.textNormal || ''),
      canSave: (mapId | 0) !== 35,
      blocked: blocked,
    };
  }

  function targetLockRules() { return T().targetLock || {}; }

  /** 锁定目标 var_58(29) 清理与自动选取（300335-300382） */
  function validateTarget(s) {
    const r = targetLockRules();
    const o = s || {};
    let t = o.target | 0;
    const alive = o.aliveOf ? o.aliveOf(t) : 1;
    if (alive !== 1 || o.syncOk === false) t = 0;
    if (t === 0 && o.candidates && o.candidates.length) {
      const friendly = (o.playerIndex === 0) || (o.relation >= 0);
      const tiers = friendly ? (r.autoPickTiers || {}).friendly || [-3, -1, 0]
                             : (r.autoPickTiers || {}).hostile || [10, 0, 0];
      outer: for (const tier of tiers) {
        for (const c of o.candidates) {
          if ((c.relation | 0) <= tier) { t = c.id | 0; break outer; }
        }
      }
    }
    if (t === 0 || o.blind) {
      return { target: 0, ok: false, text: r.noTargetText || '' };
    }
    if (t < 0) t = 0;
    return { target: t, ok: true };
  }

  // ---------------------------------------------------------------- 货物 / 进图 / 临时背包
  /** #deffunc cargocheck：两个分支均 return 1（31538-31546） */
  function cargoCheck(o) {
    const c = T().cargo || {};
    const opt = o || {};
    const types = (c.mapTypes || [1, 5, 3, 4, 6, 2]).slice();
    return {
      ok: true,
      alwaysPass: c.alwaysPass !== false,
      mapTypes: types,
      mapTypeAllowed: types.indexOf(opt.mapType | 0) >= 0,
      playerOnly: c.playerOnly !== false,
      activity: c.activity || 116,
      caller: (c.caller || []).slice(),
    };
  }

  function fixOnMapEnterRules() { return T().fixOnMapEnter || {}; }

  /** fixOnMapEnter：越界随从归位、清 var_126(18)、map7 特例（301513-301539） */
  function fixOnMapEnter(s) {
    const r = fixOnMapEnterRules();
    const o = s || {};
    const chars = (o.chars || []).map((c) => ({ x: c.x | 0, y: c.y | 0, alive: c.alive }));
    for (const c of chars) {
      if (c.alive === 1 && (c.x < 0 || c.x >= (o.w | 0) || c.y < 0 || c.y >= (o.h | 0))) {
        c.x = 0; c.y = 0;
      }
    }
    const out = { chars: chars, var193: 0, var126_18: o.var126_18 | 0 };
    if ((o.mapType | 0) !== 5 && out.var126_18 !== 0) out.var126_18 = 0;
    if ((o.mapId | 0) === 7) {
      out.map7 = { minLevel: 0, maxLevel: 10, startLevel: 1, var126_8: 1 };
    }
    return out;
  }

  function tempInvRules() { return T().tempInv || {}; }

  // ---------------------------------------------------------------- 表族
  function difficultyTier(level) {
    return ((T().difficulty || {}).levels || {})[String(level | 0)] || null;
  }
  function site7Feat(level) {
    const s = T().site7 || {};
    const m = s.featByDifficulty || {};
    const k = String(level | 0);
    return { slot: s.slot || 7, feat: m[k] === undefined ? (s.feat || 143) : m[k] };
  }
  function mapInitRules() { return T().mapInit || {}; }
  function mapPreBeginRules() { return T().mapPreBegin || {}; }
  function clampSizeRules() { return T().clampSize || {}; }
  function movePrompts() { return T().prompts || {}; }
  function renderRules() { return T().render || {}; }
  function editorRules() { return T().editor || {}; }
  function mapToolRules() { return T().mapTools || {}; }

  // ---------------------------------------------------------------- 地图生成工具
  /** map_randomtile 次数 floor(w*h*pct/100)+1（228112） */
  function randomTileCount(w, h, pct) {
    return Math.floor((w | 0) * (h | 0) * (pct | 0) / 100) + 1;
  }

  /** 随机地块坐标 rnd(w-5)+2 / rnd(h-5)+2（228990 / 229038） */
  function randomTilePos(rng, w, h) {
    const r = (n) => (rng ? rng(n) : 0);
    return { x: r((w | 0) - 5) + 2, y: r((h | 0) - 5) + 2 };
  }

  /** map_line：逐格先走 x 再走 y，每格 tile 100（228117-228140） */
  function linePath(x1, y1, x2, y2) {
    const pts = [];
    let x = x1 | 0, y = y1 | 0;
    const tx = x2 | 0, ty = y2 | 0;
    pts.push({ x: x, y: y, tile: 100 });
    let guard = 10000;
    while (guard-- > 0) {
      if (x > tx) { x--; }
      else if (x < tx) { x++; }
      else if (y > ty) { y--; }
      else if (y < ty) { y++; }
      else break;
      pts.push({ x: x, y: y, tile: 100 });
      if (x === tx && y === ty) break;
    }
    return pts;
  }

  /** map_makesimpleroom：w+3 × h+3，边框 wall，内部 floor（228142-228163） */
  function simpleRoom(x, y, w, h, wall, floor, mapW, mapH) {
    const cells = [];
    let ok = 1;
    outer: for (let ry = 0; ry < (h | 0) + 3; ry++) {
      const cy = (y | 0) + ry;
      if (cy >= (mapH | 0)) { ok = 0; break; }
      for (let rx = 0; rx < (w | 0) + 3; rx++) {
        const cx = (x | 0) + rx;
        if (cx >= (mapW | 0)) { ok = 0; break outer; }
        const border = cx === (x | 0) || cy === (y | 0) ||
                       cx === (x | 0) + (w | 0) + 2 || cy === (y | 0) + (h | 0) + 2;
        cells.push({ x: cx, y: cy, tile: border ? wall : floor });
      }
    }
    return { ok: ok, cells: cells };
  }

  /** map_setfog：var_812 + (rnd(var_812(2))==0)*rnd(var_812(1))（228466） */
  function fogValue(rng, base, chance, amplitude) {
    const r = (n) => (rng ? rng(n) : 0);
    return (base | 0) + (r(chance | 0) === 0 ? r(amplitude | 0) : 0);
  }

  function stairsPoint(x, y, rng, room) {
    const r = (n) => (rng ? rng(n) : 0);
    if ((x | 0) === 0 && room) {
      return { x: r((room.w | 0) - 2) + (room.x | 0) + 1,
               y: r((room.h | 0) - 2) + (room.y | 0) + 1 };
    }
    return { x: x | 0, y: y | 0 };
  }

  /** map_placeupstairs：feat 10，var_126(5)=y*1000+x（228757-228758） */
  function upstairs(x, y, rng, room) {
    const t = T().mapTools || {};
    const u = t.upstairs || { feat: 10, slot: 5 };
    const p = stairsPoint(x, y, rng, room);
    return { x: p.x, y: p.y, feat: u.feat, slot: u.slot, enc: p.y * 1000 + p.x };
  }

  /** map_placedownstairs：depth>=maxLevel 时跳过，feat 11（228762-228774） */
  function downstairs(x, y, rng, room, depth, maxLevel) {
    const t = T().mapTools || {};
    const d = t.downstairs || { feat: 11, slot: 4 };
    const skip = (depth | 0) >= (maxLevel | 0);
    const p = stairsPoint(x, y, rng, room);
    return { x: p.x, y: p.y, feat: d.feat, slot: d.slot,
             enc: p.y * 1000 + p.x, skip: skip };
  }

  function webTries() { return ((T().mapTools || {}).web || {}).tries || 3; }
  function barrelTries() { return ((T().mapTools || {}).barrel || {}).tries || 3; }

  /** 陷阱编号：浅层禁 6/1/5，深层禁 7（任务 1013 例外）（229005-229022） */
  function trapId(rng, depth, questId, forced) {
    const t = (T().mapTools || {}).trap || {};
    const r = (n) => (rng ? rng(n) : 0);
    const v = forced === undefined ? r(10) : (forced | 0);
    if ((depth | 0) <= (t.shallowDepth || 5) &&
        (t.shallowForbidden || [6, 1, 5]).indexOf(v) >= 0) return -1;
    if ((depth | 0) <= (t.deepDepth || 25) && v === (t.deepForbidden || 7) &&
        (questId | 0) !== (t.deepQuest || 1013)) return -1;
    return v;
  }

  /** 四方向门口坐标（229096-229111） */
  function connectRoomSides() { return (T().connectRoom || {}).sides || {}; }

  function connectRoomPoint(side, room, rng) {
    const s = connectRoomSides()[String(side | 0)];
    if (!s) return null;
    const r = (n) => (rng ? rng(n) : 0);
    let x, y;
    if (side === 1) { x = room.x; y = room.y + r(room.h - 2) + 1; }
    else if (side === 2) { x = room.x + room.w - 1; y = room.y + r(room.h - 2) + 1; }
    else if (side === 3) { x = room.x + r(room.w - 2) + 1; y = room.y; }
    else { x = room.x + r(room.w - 2) + 1; y = room.y + room.h - 1; }
    return { x: x | 0, y: y | 0, vec: s.vec, doorTile: 3, floorTile: 100 };
  }

  // ---------------------------------------------------------------- 季节 / 事件区
  /** label_0289：repeat 12 的季节图块与坐标（24278-24296） */
  function seasonInit(cnt, mapId, rnd2, rng) {
    const s = T().season || {};
    const r = (n) => (rng ? rng(n) : 0);
    const tbl = (mapId | 0) === 47 ? (s.map47 || {}) : (s.other || {});
    const rect = (rnd2 | 0) === 0 ? tbl.even : tbl.odd;
    return {
      cnt: cnt | 0,
      rect: (rect || []).slice(),
      x: r(100) + (cnt | 0) * 200 + 100000,
      y: r(100) + Math.floor((cnt | 0) / 5) * 200 + 100000,
    };
  }

  /** label_3067 事件区变量初始化与好感度阈值（425318-425374） */
  function eventZoneInit(s) {
    const z = T().eventZone || {};
    const o = s || {};
    const imp = o.impression | 0;
    return {
      zeroVars: (z.zeroVars || []).slice(),
      var2719: 0,
      impression: imp >= ((z.impression || {}).threshold || 10)
        ? ((z.impression || {}).cap || 10) : imp,
      activity: imp >= ((z.impression || {}).threshold || 10)
        ? ((z.impression || {}).activity || 317) : 0,
    };
  }

  Elona.ResidualMap = {
    setData: setData, tableSync: tableSync, load: load, table: tableSync,
    segments: segments, src: src, srcOf: srcOf,
    tileRanges: tileRanges, tileRange: tileRange,
    worldTileBlocked: worldTileBlocked, waterTile: waterTile,
    siteSlotRange: siteSlotRange,
    entryPoint: entryPoint, centeredStart: centeredStart, riverBand: riverBand,
    mapSizes: mapSizes, mazeSize: mazeSize, corridorSize: corridorSize,
    arenaSize: arenaSize, clampMapSize: clampMapSize,
    clampDepth: clampDepth, mapSaveKey: mapSaveKey,
    prepareTileRules: prepareTileRules, lighting: lighting,
    worldAreaRules: worldAreaRules, worldUpdateRules: worldUpdateRules,
    randSiteRules: randSiteRules, siteTypeFeat: siteTypeFeat, siteLevel: siteLevel,
    siteCandidates: siteCandidates, allCandidates: allCandidates,
    candidateEntries: candidateEntries, worldTileCheck: worldTileCheck,
    noSaveMaps: noSaveMaps, canEnter: canEnter, exitPrompt: exitPrompt,
    targetLockRules: targetLockRules, validateTarget: validateTarget,
    cargoCheck: cargoCheck,
    fixOnMapEnterRules: fixOnMapEnterRules, fixOnMapEnter: fixOnMapEnter,
    tempInvRules: tempInvRules,
    difficultyTier: difficultyTier, site7Feat: site7Feat,
    mapInitRules: mapInitRules, mapPreBeginRules: mapPreBeginRules,
    clampSizeRules: clampSizeRules, movePrompts: movePrompts,
    renderRules: renderRules, editorRules: editorRules,
    mapToolRules: mapToolRules,
    randomTileCount: randomTileCount, randomTilePos: randomTilePos,
    linePath: linePath, simpleRoom: simpleRoom, fogValue: fogValue,
    upstairs: upstairs, downstairs: downstairs,
    webTries: webTries, barrelTries: barrelTries, trapId: trapId,
    connectRoomSides: connectRoomSides, connectRoomPoint: connectRoomPoint,
    seasonInit: seasonInit, eventZoneInit: eventZoneInit,
  };
})(window);
