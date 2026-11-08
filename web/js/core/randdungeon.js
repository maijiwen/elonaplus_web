'use strict';
/**
 * 随机地城（ランダムネフィア）—— 世界地图上随机生成的地城入口
 *
 * 【权威源码 hsp/start.hsp】
 *   *label_2469 `world_newRandArea`（249566-249614）：
 *       统计槽位 450..499 里 `var_132(16)==8 && var_132(20)!=-1` 的数量，
 *       `var_400 = 40 - 数量`（不足 1 则取 1），世界 91（ether）除外，
 *       逐个 `gosub *label_2475` 生成；末尾 `var_65(250+311)=0`。
 *   *label_2475（251302-251441）：单个随机地城站点生成
 *       · 槽位 450..499 找 `var_132(16)==0` 的空槽
 *       · 1000 次尝试：`x = baseX + rnd(cnt+1) - rnd(cnt+1)`（扩散随尝试数增大）
 *       · 边界 5 格；`33<=tile<57 && tile!=44`、`tile>16`、该格已有 feat → 跳过
 *       · 与所有已占用站点 ±2 格冲突 → 跳过
 *       · `var_132(0)=20+rnd(8)`（8 种外形）、`16=8`（随机地城类型）、`15`=外观图块、
 *         `17`=入口危险度、`10=17+2`（最深层）、`20=0`、`30`=所属世界、`5`=随机名索引
 *       · 4 种危险度刷新类型（249355-249395），用 `var_65(189)` 最深攻略层数
 *   *label_2470 `world_update`（249615-249678）：
 *       活跃站点 <= 25、欧巴德斯雕像 `var_65(250+12)`、强制刷新 `var_65(79)` 时
 *       → 删除旧站点（`var_65(250+311)==1 | rnd(5)==0 | var_132(20)==-1`）
 *       → `gosub *label_2469` 补到 40，并输出「地壳变动」。
 *   249591-249614：站点消失标记 `var_132(20,cnt) = -1`（每次更新 rnd(3)==0）。
 *   248487-248497：从小地图回大地图时 `rnd(150)==0` → `var_65(79)=1` 强制刷新。
 *   238935-238959：切换/初始化大地图 `map_initcustom` 后直接 `gosub *label_2469`。
 *   236905-236913：最深层进入时 `var_132(20,id) = -1`（击破标记）。
 *   237835-237842 `map_init`：`var_65(22)` 被钳制在 `[var_132(17), var_132(10)]`。
 *   228762 `map_placedownstairs`：到达 `var_132(10)` 后不再放下行楼梯。
 *   609357-609365：地城主（品质 4、等级 = 层数+20、cbit 976）。
 *   12429-12462 `mapname`：随机地城名 = 前缀表 var_408 + 外形后缀
 *       （20 洞窟 / 21 塔 / 22 森 / 23 砦 / 24 巣穴 / 25 霊園 / 26 鉱山 / 27 湖）。
 *   11952-11956：var_408 前缀表（5 档 × 2 列），档位 = min(危险度/5, 4)。
 *
 * 【wiki「地城」页的版本差异】觉醒/狂热地城、白金币与记忆碎片掉落、8 类怪物分布等
 *   属于较新版本；本源码只保留可确认的部分（觉醒层环境 247596-247620、狂热在 daily.js
 *   已实现），其余登记在差异报告。
 *
 * 【项目承接点】
 *   · `Elona.WorldMap`（core/worldmap.js）：世界地图格与通行
 *   · `Elona.Sites`（core/sites.js）：静态站点表 + 动态站点注册（本模块写 g.randSites）
 *   · `Game.enterWorldMap / enterSite / enterDungeon`：进入与地图生成
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const SLOT_MIN = 450;          // 源码 repeat 500-450, 450
  const SLOT_MAX = 499;
  const MAX_ACTIVE = 40;         // label_2469 补足上限
  const MIN_ACTIVE = 26;         // label_2470：<=25 触发刷新
  const RAND_TYPE = 8;           // var_132(16) = 8
  const WORLD_NO_SPAWN = 91;     // ether 不生成随机地城
  const V_DEEPEST = 189;         // var_65(189) 最深攻略层数
  const V_MAIN_PROGRESS = 252;   // var_65(250+2) 主线进度
  const V_STATUE_SHRINK = 561;   // var_65(250+311) 欧巴德斯雕像深度缩减
  const V_FORCE_REFRESH = 79;    // var_65(79)

  const idiv = (a, b) => Math.floor((a | 0) / (b | 0));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));

  /** kind → [入口外观 feat, var_132(18) 的种族组编号]，源码 251406-251438 */
  const KIND_FEAT = {
    20: [133, 0], 21: [137, 100], 23: [140, 200], 22: [135, 300],
    24: [380, 15], 25: [381, 16], 26: [382, 17], 27: [383, 18],
  };
  /** 源码 12433-12456 的名字后缀（中文） */
  const KIND_SUFFIX = {
    20: '洞窟', 21: '塔', 22: '森林', 23: '营寨',
    24: '巢窟', 25: '陵园', 26: '矿山', 27: '湖',
  };
  /** 源码 var_408 前缀（11952-11956），按危险度 /5 选档；中文直译 */
  const PREFIX = [
    ['初始之', '安全之'],
    ['冒险者之', '心动之'],
    ['迷途之', '勇者之'],
    ['死亡之', '暗黑之'],
    ['不归之', '混沌之'],
  ];
  /** 觉醒层环境（247607-247620）：100 带电 / 103 时停 / 105 毒气 / 108 重力 */
  const FLOOR_EFFECT = {
    100: '这一层带着静电。',
    103: '这一层的时间流动不稳定。',
    105: '这一层充满了毒气。',
    108: '这一层的重力很强。',
  };

  function rng(g) { return (g && g.rng) || Elona.rng || { rnd: () => 0 }; }
  function V(g, n) { return g && g.getV65 ? (g.getV65(n) | 0) : 0; }
  function S(g, n, v) { if (g && g.setV65) g.setV65(n, v | 0); }

  function bind(g) {
    if (g && !g.randSites) g.randSites = {};
    if (g && !g.randDungeonMeta) g.randDungeonMeta = { init: false, lastWorld: 0 };
    if (g && Elona.Sites && Elona.Sites.bindGame) Elona.Sites.bindGame(g);
    return g;
  }

  /** 世界地图格数据（可由测试注入 g.__worldCells） */
  function world(g) {
    const WM = Elona.WorldMap;
    const cells = (g && g.__worldCells) || (WM && WM.cells) || null;
    const w = (g && g.__worldWidth) || (WM && WM.width) || 95;
    const h = (g && g.__worldHeight) || (WM && WM.height) || 55;
    const walkable = (x, y) => {
      if (g && g.__worldWalkable) return g.__worldWalkable(x, y);
      if (WM && WM.walkable) return WM.walkable(x, y);
      return true;
    };
    return { cells, w, h, walkable };
  }

  /** 动态站点列表（g.randSites 的槽位 450..499） */
  function list(g, worldId) {
    const all = [];
    const src = (g && g.randSites) || {};
    for (const k of Object.keys(src)) {
      const s = src[k];
      if (!s || !s.fields) continue;
      if (worldId !== undefined && (s.fields[30] | 0) !== (worldId | 0)) continue;
      all.push(s);
    }
    return all.sort((a, b) => (a.id | 0) - (b.id | 0));
  }

  /** 活跃（未被击破）随机地城数 —— label_2469 / label_2470 的统计口径 */
  function activeCount(g, worldId) {
    return list(g, worldId).filter((s) => (s.fields[16] | 0) === RAND_TYPE
      && (s.fields[20] | 0) !== -1).length;
  }

  /** mapname() 的随机地城名：前缀档位 = min(危险度/5, 4)，列 = var_132(5) */
  function nameOf(site) {
    if (!site) return '';
    if (site.dyn && site.nameZh) {
      return site.nameZh + ((site.fields[32] | 0) ? '《觉醒》' : '');
    }
    const kind = site.fields ? (site.fields[0] | 0) : 0;
    const lv = site.fields ? (site.fields[17] | 0) : 0;
    return buildName(kind, lv, site.fields ? (site.fields[5] | 0) : 0,
      site.fields ? (site.fields[32] | 0) : 0);
  }

  function buildName(kind, lv, nameIdx, awakened) {
    const row = PREFIX[clamp(idiv(lv, 5), 0, PREFIX.length - 1)];
    const pre = row[(nameIdx | 0) % row.length];
    return pre + (KIND_SUFFIX[kind] || '地城') + (awakened ? '《觉醒》' : '');
  }

  const minLevelOf = (s) => s && s.fields ? (s.fields[17] | 0) : 0;
  const maxLevelOf = (s) => s && s.fields ? (s.fields[10] | 0) : 0;
  const isCleared = (s) => !!(s && s.fields && (s.fields[20] | 0) === -1);
  const isAwakened = (s) => !!(s && s.fields && (s.fields[32] | 0) !== 0);

  /** 所有「已占用」站点坐标（静态表 + 动态 + 城镇），用于 ±2 冲突判定 */
  function occupiedPoints(g) {
    const pts = [];
    const St = Elona.Sites;
    if (St && St.all) {
      for (const s of St.all()) {
        if (!s || !s.fields || !(s.fields[16] | 0)) continue;
        pts.push({ x: s.fields[1] | 0, y: s.fields[2] | 0 });
      }
    }
    for (const s of list(g)) {
      if (!(s.fields[16] | 0)) continue;
      pts.push({ x: s.fields[1] | 0, y: s.fields[2] | 0 });
    }
    for (const t of ((Elona.Towns && Elona.Towns.LIST) || [])) {
      pts.push({ x: t.wx | 0, y: t.wy | 0 });
    }
    return pts;
  }

  /**
   * 危险度（249355-249395）：4 种刷新类型，按最深攻略层数 var_65(189) 计算。
   * @returns {{lv:number, type:number, deepest:number}}
   */
  function rollDepth(g, worldId, opts) {
    const R = rng(g).rnd.bind(rng(g));
    let deepest = V(g, V_DEEPEST);
    const progress = V(g, V_MAIN_PROGRESS);
    const floor = idiv(progress, 4) + 1;
    if (deepest < floor) { deepest = floor; S(g, V_DEEPEST, deepest); }
    const statue = !!(opts && opts.statueShrink) || V(g, V_STATUE_SHRINK) === 1;
    const type = R(4);
    let lv;
    if (type === 0) {
      lv = idiv(deepest, 2) + R(idiv(deepest * 11, 10) + 5) + 1;
      if (statue) lv = idiv(lv, 4) + 1;
    } else if (type === 1) {
      lv = idiv(deepest, 2) + R(idiv(deepest * 11, 10) + 5) + 1;
      if (statue) lv = idiv(lv, 4) + 1;
      if ((worldId | 0) === 4) lv = idiv(lv, 4) + 1;
      if ((worldId | 0) === 44) lv = idiv(lv, 2) + 1;
      if ((worldId | 0) === 70) lv = idiv(lv * 3, 4) + 1;
    } else if (type === 2) {
      lv = R(45) + 1;
      if ((worldId | 0) === 44) lv = R(60) + 30;
      if ((worldId | 0) === 70) lv = R(50) + 100;
    } else {
      lv = idiv(deepest * 9, 10) + R(idiv(deepest, 5) + 2) + 1;
      if (statue) lv = idiv(lv, 4) + 1;
    }
    return { lv: Math.max(1, lv | 0), type, deepest };
  }

  /**
   * *label_2475：生成一个随机地城站点。
   * @param {object} g
   * @param {number} worldId
   * @param {number} baseX 随机基准（原版 var_1021 = rnd(世界宽)）
   * @param {number} baseY
   * @param {object} [opts] { statueShrink, deepest, type }
   */
  function spawnOne(g, worldId, baseX, baseY, opts) {
    bind(g);
    const R = rng(g).rnd.bind(rng(g));
    const WM = world(g);
    if (!WM.cells) return null;
    const occupied = occupiedPoints(g);
    let slot = -1;
    for (let i = SLOT_MIN; i <= SLOT_MAX; i++) {
      if (!g.randSites[String(i)]) { slot = i; break; }
    }
    if (slot < 0) return null;                  // 50 个槽全满

    let hit = null;
    for (let t = 0; t < 1000; t++) {
      const x = (baseX | 0) + R(t + 1) - R(t + 1);
      const y = (baseY | 0) + R(t + 1) - R(t + 1);
      if (x <= 5 || y <= 5 || x >= WM.w - 6 || y >= WM.h - 6) continue;
      const row = WM.cells[y];
      if (!row || !row[x]) continue;
      const tile = row[x][0] | 0;
      // 223831：33..56（且非 44）是水域/特殊地形；>16 一律不放
      if (tile >= 33 && tile < 57 && tile !== 44) continue;
      if (tile > 16) continue;
      const feat = row[x].length > 6 ? idiv(row[x][6] | 0, 1000) : 0;
      if (feat !== 0) continue;
      // 网页版额外约束：入口必须能走到（原版 tile 判定已隐含，这里显式保证）
      if (!WM.walkable(x, y)) continue;
      let ok = true;
      for (const p of occupied) {
        if (x >= p.x - 2 && x <= p.x + 2 && y >= p.y - 2 && y <= p.y + 2) { ok = false; break; }
      }
      if (!ok) continue;
      hit = { x, y };
      break;
    }
    if (!hit) return null;                       // 1000 次未命中：放弃本次生成

    const kind = 20 + R(8);
    const pair = KIND_FEAT[kind] || KIND_FEAT[20];
    const depth = (opts && opts.depth) || rollDepth(g, worldId, opts);
    const lv = Math.max(1, depth.lv | 0);
    const nameIdx = R(2);                       // length(var_408) = 2 列
    const fields = {};
    fields[0] = kind;
    fields[1] = hit.x;
    fields[2] = hit.y;
    fields[3] = 1;
    fields[4] = 1;
    fields[5] = nameIdx;
    fields[9] = 10000;                         // 行动基准（237970）
    fields[11] = 1;
    fields[12] = 0;
    fields[15] = pair[0];
    fields[16] = RAND_TYPE;
    fields[17] = lv;                           // 入口危险度
    fields[18] = pair[1];                      // 怪物种族组
    fields[20] = 0;                            // 0=有主 / -1=已击破
    fields[21] = 1;
    fields[30] = worldId | 0;
    fields[10] = lv + 2;                       // 最深层 = 危险度 + 2
    fields[32] = 0;                            // 觉醒标记
    const site = {
      id: slot, dyn: true, world: worldId | 0, x: hit.x, y: hit.y,
      fields, nameZh: buildName(kind, lv, nameIdx, 0),
      nameJp: '', nameEn: '',
      depthType: depth.type,
    };
    g.randSites[String(slot)] = site;
    occupied.push({ x: hit.x, y: hit.y });      // 后续同批生成也要避开
    return site;
  }

  /**
   * *label_2469 world_newRandArea：把活跃随机地城补足到 40 个。
   * @returns {{created:number, need:number, active:number, sites:Array}}
   */
  function newRandArea(g, worldId, opts) {
    bind(g);
    const wid = worldId | 0;
    if (wid === WORLD_NO_SPAWN) return { created: 0, need: 0, active: 0, sites: [], skipped: true };
    const R = rng(g).rnd.bind(rng(g));
    const WM = world(g);
    const before = activeCount(g, wid);
    let need = MAX_ACTIVE - before;
    if (need < 1) need = 1;                    // 249576-249578
    const created = [];
    for (let i = 0; i < need; i++) {
      const s = spawnOne(g, wid, R(WM.w), R(WM.h), opts);
      if (s) created.push(s);
    }
    S(g, V_STATUE_SHRINK, 0);                 // 249587
    if (g && g.log && created.length && !(opts && opts.silent)) {
      g.log(`大陆上出现了 ${created.length} 座新的地城。`);
    }
    return { created: created.length, need, active: before + created.length, sites: created };
  }

  /**
   * *label_2470 world_update：刷新判定与旧站点清除。
   * @param {object} [opts] { force, statue, statueShrink, silent }
   */
  function update(g, worldId, opts) {
    bind(g);
    const o = opts || {};
    const wid = worldId | 0;
    const R = rng(g).rnd.bind(rng(g));
    const active = activeCount(g, wid);
    const force = !!o.force || V(g, V_FORCE_REFRESH) === 1;
    const statue = !!o.statue;
    if (!force && !statue && active > MIN_ACTIVE - 1) {   // 249654：var_400 <= 25 才刷新
      return { refreshed: false, reason: 'enough', active, removed: 0, created: 0 };
    }
    let removed = 0;
    for (const s of list(g, wid)) {
      if ((s.fields[16] | 0) !== RAND_TYPE) continue;
      const gone = force || statue || R(5) === 0 || (s.fields[20] | 0) === -1;
      if (!gone) continue;
      delete g.randSites[String(s.id | 0)];
      removed++;
    }
    if (!o.silent && g && g.log) g.log('这片大陆发生了剧烈的地壳变动。');
    S(g, V_FORCE_REFRESH, 0);
    const made = newRandArea(g, wid, {
      statueShrink: statue || o.statueShrink, silent: true,
    });
    return {
      refreshed: true, active, removed, created: made.created,
      reason: force ? 'force' : (statue ? 'statue' : 'few'),
    };
  }

  /**
   * 每次从城镇/小地图回到世界地图时调用（248487-248497 / 238935-238959）。
   * 首次进入或切换大地图：直接生成 40 个；之后按 1/150 强制刷新 + <=25 补充。
   */
  function onEnterWorld(g, worldId, opts) {
    bind(g);
    const o = opts || {};
    const wid = worldId | 0;
    const meta = g.randDungeonMeta;
    const wasInit = !!meta.init;
    const first = !wasInit || meta.lastWorld !== wid;
    meta.init = true;
    meta.lastWorld = wid;
    if (first) {
      // 249619-249627：切换大地图时 var_65(79)=1 → 先把 450..499 的动态槽全部清 0，
      // 再对新大陆执行 label_2469（槽位是全局共享的，不按世界分开存）。
      if (wasInit) {
        for (const k of Object.keys(g.randSites)) delete g.randSites[k];
      }
      return Object.assign({}, newRandArea(g, wid, o), { reason: 'init', first: true });
    }
    const R = rng(g).rnd.bind(rng(g));
    const force = !!o.force || R(150) === 0 || V(g, V_FORCE_REFRESH) === 1;
    const res = update(g, wid, {
      force, statue: !!o.statue, statueShrink: !!o.statueShrink,
    });
    return Object.assign({}, res, { first: false });
  }

  /** 249591-249614：站点消失标记（每次世界更新 rnd(3)==0） */
  function decay(g, worldId) {
    bind(g);
    const R = rng(g).rnd.bind(rng(g));
    let n = 0;
    for (const s of list(g, worldId)) {
      if ((s.fields[16] | 0) !== RAND_TYPE) continue;
      if ((s.fields[20] | 0) === -1) continue;
      if (R(3) === 0) { s.fields[20] = -1; n++; }
    }
    return n;
  }

  /** 击破地城主（236905-236913）：var_132(20, id) = -1 */
  function markCleared(g, siteId) {
    bind(g);
    const s = find(g, siteId);
    if (!s) return false;
    s.fields[20] = -1;
    return true;
  }

  function find(g, siteId) {
    const src = (g && g.randSites) || {};
    return src[String(siteId | 0)] || null;
  }

  /** 觉醒之宝玉（359904-359916）：7 格距离内的地城变觉醒（var_132(32)=100） */
  function awakenNear(g, x, y, worldId, sitesInRange) {
    bind(g);
    const wid = worldId | 0;
    const targets = sitesInRange || list(g, wid)
      .concat((Elona.Sites && Elona.Sites.ofWorld ? Elona.Sites.ofWorld(wid, { placed: true }, g) : []));
    let n = 0;
    for (const s of targets) {
      if (!s || !s.fields) continue;
      const k = s.fields[0] | 0;
      if (k < 20 || k > 27) continue;
      if ((s.fields[30] | 0) !== wid) continue;
      const dx = Math.abs((s.fields[1] | 0) - (x | 0));
      const dy = Math.abs((s.fields[2] | 0) - (y | 0));
      if (dx > 7 || dy > 7) continue;
      s.fields[32] = 100;
      if (s.dyn) s.nameZh = buildName(k, s.fields[17] | 0, s.fields[5] | 0, 100);
      n++;
    }
    return n;
  }

  /** 觉醒地城的层环境（247596-247620）：个位 0/3/5/8 */
  function floorEffect(site, depth) {
    if (!isAwakened(site)) return null;
    const code = 100 + (((depth | 0) % 10) + 10) % 10;
    return { code, text: FLOOR_EFFECT[code] || null };
  }

  /**
   * ★《觉醒之宝玉》（使用效果 67，359885-359918）：
   *   必须在世界地图上；对 450..499 里 type==8、未被攻略（var_132(6)==0）、
   *   未觉醒（var_132(32)==0）且距离 <= var_83(3,656)\1000+1（= 4）的地城，
   *   置 var_132(32)=100 并提示「活性化した」。wiki 写「7 格」属版本差异。
   */
  function awakenOrb(g) {
    bind(g);
    const out = { ok: true, effect: 67, awakened: 0, messages: [] };
    const w = g && g.worldMap;
    if (!w) {
      out.ok = false;
      out.reason = 'not-world';
      out.messages.push('应该在世界地图上使用。');
      if (g && g.log) g.log(out.messages[0]);
      return out;
    }
    const wid = (g.getV65 ? (g.getV65(850) | 0) : 0) || 4;
    for (const s of list(g, wid)) {
      if ((s.fields[16] | 0) !== RAND_TYPE) continue;
      if ((s.fields[6] | 0) !== 0) continue;
      if ((s.fields[32] | 0) !== 0) continue;
      const dx = (s.fields[1] | 0) - (w.x | 0), dy = (s.fields[2] | 0) - (w.y | 0);
      if (Math.sqrt(dx * dx + dy * dy) > 4) continue;
      s.fields[32] = 100;
      if (s.dyn) s.nameZh = buildName(s.fields[0] | 0, s.fields[17] | 0, s.fields[5] | 0, 100);
      out.awakened++;
      out.messages.push(`${nameOf(s)}活性化了！`);
    }
    if (g && g.log) for (const m of out.messages) g.log(m);
    return out;
  }

  /**
   * 地城主被击破（609775-609790 / 236905-236913）：
   *   var_132(20,id) = -1（无主）、灵感 +3、旅经验 +3、通关计数 +1。
   * 0-FB：击破掉落与名声在 `Elona.DungeonFx.onBossKilled`（609445-609735）——
   *   记忆碎片 1191 / 变忆结晶 1204 / 奈菲亚之核 969 / 小徽章 622 / 白金币 / 名声。
   */
  function onBossKilled(g, dead) {
    if (!g || !dead || !dead.isDungeonBoss || dead._bossRewarded) return null;
    dead._bossRewarded = true;
    const siteId = g.dungeonSiteId | 0;
    if (siteId) markCleared(g, siteId);
    g.dungeonCleared = true;
    const out = { cleared: true, siteId, depth: g.dungeonDepth | 0, messages: [] };
    // 609445-609761：掉落 + 名声（源码在灵感/旅经验之前）
    if (Elona.DungeonFx && Elona.DungeonFx.onBossKilled) {
      try { Elona.DungeonFx.onBossKilled(g, dead, out); } catch (e) { /* 掉落失败不阻断通关 */ }
    }
    if (g.getV65 && g.setV65) {
      g.setV65(250 + 435, (g.getV65(250 + 435) | 0) + 3);   // 灵感
      g.setV65(180, (g.getV65(180) | 0) + 3);                 // 旅经验
      g.setV65(250 + 24, (g.getV65(250 + 24) | 0) + 1);      // 通关计数
    }
    out.messages.push('地城主被击倒了！这座地城已经没有主人了。');
    out.messages.push('获得 3 点灵感与 3 点旅经验。');
    if (g.log) for (const m of out.messages) g.log(m);
    return out;
  }

  /** 存档用：把动态站点与元数据导出成纯数据 */
  function snapshot(g) {    bind(g);
    const sites = {};
    for (const k of Object.keys(g.randSites || {})) {
      const s = g.randSites[k];
      if (!s) continue;
      sites[k] = {
        id: s.id | 0, dyn: true, world: s.world | 0, x: s.x | 0, y: s.y | 0,
        fields: Object.assign({}, s.fields), nameZh: s.nameZh || '',
        nameJp: s.nameJp || '', nameEn: s.nameEn || '', depthType: s.depthType | 0,
      };
    }
    return { sites, meta: Object.assign({}, g.randDungeonMeta || {}) };
  }

  function restore(g, data) {
    if (!g) return 0;
    const src = (data && data.sites) || {};
    g.randSites = {};
    for (const k of Object.keys(src)) {
      const s = src[k];
      if (!s || !s.fields) continue;
      g.randSites[k] = Object.assign({}, s, { fields: Object.assign({}, s.fields), dyn: true });
    }
    g.randDungeonMeta = Object.assign({ init: false, lastWorld: 0 }, (data && data.meta) || {});
    bind(g);
    return Object.keys(g.randSites).length;
  }

  Elona.RandDungeon = {
    SLOT_MIN, SLOT_MAX, MAX_ACTIVE, MIN_ACTIVE, RAND_TYPE, WORLD_NO_SPAWN,
    KIND_FEAT, KIND_SUFFIX, PREFIX, FLOOR_EFFECT,
    V_DEEPEST, V_MAIN_PROGRESS, V_STATUE_SHRINK, V_FORCE_REFRESH,
    bind, list, activeCount, nameOf, buildName, minLevelOf, maxLevelOf,
    isCleared, isAwakened, occupiedPoints, rollDepth, spawnOne,
    newRandArea, update, onEnterWorld, decay, markCleared, find,
    awakenNear, awakenOrb, floorEffect, onBossKilled, snapshot, restore,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Elona.RandDungeon;
})(typeof window !== 'undefined' ? window : global);
