'use strict';
/**
 * 世界地图 site 表（core/sites.js）—— 原版 var_132 的静态数据源
 *
 * 【为什么需要它】
 * `var_132(16, mapId)`（地图类型）散落在全代码 2975 处引用里，之前各处只能按
 * 地图名字猜（farm.js / ranch.js / fishing.js 各写一份），既不可靠也不好维护。
 *
 * 【源码依据】
 *   `*label_2474`（249783-251301）：93 条固定 site 的定义（var_400 = siteId 后跟
 *       var_132(字段, var_400) = 值）
 *   `#defcfunc mapfile`（11977-12110）：类型 + 层数 → 地图文件名
 *   `#defcfunc mapname`（12111-12473）：类型 → 名称（jp/en）
 *   世界地图本体（249618-249649）：map_update 里的 map_initcustom "ntyris" 等
 *
 * 由 tools/extract_world_sites.py 机械提取为 data/tables/world_sites.json。
 *
 * 【字段含义】见 FIELD_NAMES（从使用点归纳）
 *   0=kind 1=x 2=y 3=width 4=height 9=weight 10=maxLevel 15=featFile
 *   16=type 17=minLevel 30=worldId，其余为标志位
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  // HSP 的 `/` 对整数是截断除法（`cnt / 100`），对应这里的 idiv
  const idiv = (a, b) => (b === 0 ? 0 : ((a / b) | 0));

  const MAP_TYPE_FARM = 103;      // 232878 / 365043
  const MAP_TYPE_RANCH = 31;      // 232890 / 236217
  const MAP_TYPE_MUSEUM = 101;
  const MAP_TYPE_SHOP = 102;
  const MAP_TYPE_STORAGE = 104;
  const MAP_TYPE_CAMP = 105;
  const MAP_TYPE_HOME = 7;
  const MAP_TYPE_SHELTER = 30;

  /**
   * 玩家自建建筑（kind 5）的地图文件 —— 源码 `map_init` 的类型分派（238053-238145）：
   *   `if ( var_132(16, var_65(20)) == 101 ) { map_initcustom "museum_1" ... }`
   * 注意原版是按 **site 类型**（var_132(16)）而不是 var_132(15) 的地图 id 决定的。
   */
  const ESTATE_MAP_FILES = {
    101: 'museum_1',   // 博物館
    102: 'shop_1',     // 店
    103: 'crop_1',     // 畑
    104: 'storage_1',  // 倉庫
    105: 'camp',       // 収容所
    31: 'ranch_1',     // 牧場
    39: 'dungeon1',    // ダンジョン
    100: '2nouti',     // 廃モンスター牧場
  };

  /**
   * 建筑蓝图 → var_132(15, id)（232859-232909 的逐条赋值）→ 建筑类型。
   * `var_132(15)` 是「地图 id」，原版 map_init 用的是 `var_132(16)`（类型）。
   */
  const ESTATE_MAP_IDS = {
    151: 101, 161: 105, 150: 102, 152: 103,
    153: 104, 154: 31, 138: 39, 142: 100,
  };

  // kind（var_132(0)）→ 语义（12433-12458 的 20..27 是迷宫外形，用于名字后缀）
  const KIND = {
    0: 'none', 1: 'land', 2: 'gate', 3: 'city', 4: 'wild',
    5: 'home', 6: 'canyon', 7: 'site',
    20: 'nefia', 21: 'nefia', 22: 'nefia', 23: 'nefia',
    24: 'nefia', 25: 'nefia', 26: 'nefia', 27: 'nefia',
  };

  let data = null;
  // 0-FA：运行时随机地城站点（槽位 450..499，*label_2469 / *label_2475）。
  // 由 core/randdungeon.js 写入 g.randSites；这里把它与静态表合并成同一个 var_132 视图。
  let dynamic = null;

  /** 绑定当前游戏实例（新游戏 / 读档 / 每次随机地城生成前调用） */
  function bindGame(g) {
    if (!g) return;
    if (!g.randSites) g.randSites = {};
    dynamic = g.randSites;
  }

  /** 动态站点表（未显式绑定时退回全局 game 实例） */
  function dynamicTable(g) {
    if (g && g.randSites) return g.randSites;
    if (dynamic) return dynamic;
    const game = Elona.game;
    return (game && game.randSites) || null;
  }

  /**
   * 0-FF：玩家自建地产（槽位 300..449，`g.propertySites`）。
   *   源码里地产与随机地城写在**同一张 var_132 表**上（只是槽位段不同），
   *   所以这里也把它并进同一个「登记表」视图，`mapname()` / `cell_featset`
   *   对应的名字与入口格才能一并生效。
   *   注意：**不能**直接塞进 `g.randSites` —— `RandDungeon.onEnterWorld` 换大陆时
   *   会清空该表的全部键，玩家的田地会被一起抹掉。
   */
  function propertyTable(g) {
    if (g && g.propertySites) return g.propertySites;
    const game = Elona.game;
    return (game && game.propertySites) || null;
  }

  function dynamicList(g) {
    const d = dynamicTable(g);
    if (!d) return [];
    const out = [];
    for (const k of Object.keys(d)) if (d[k] && d[k].fields) out.push(d[k]);
    // 0-FF：玩家地产（300..449）与随机地城（450..499）同表不同段，合并成一览
    const p = propertyTable(g);
    if (p) {
      for (const k of Object.keys(p)) {
        const s = p[k];
        if (s && s.fields && !d[k]) out.push(s);
      }
    }
    return out;
  }

  /** var_132(id) 记录：动态站点 → 玩家地产 → 静态表 */
  function record(mapId, g) {
    const id = String(mapId | 0);
    const d = dynamicTable(g);
    const hit = d && d[id];
    if (hit) return hit;
    const p = propertyTable(g);
    if (p && p[id]) return p[id];
    const t = table();
    if (!t) return null;
    return t.sites[String(mapId | 0)] || null;
  }

  function table() {
    if (data) return data;
    if (Elona.Data && Elona.Data.tableSync) {
      try { data = Elona.Data.tableSync('world_sites'); } catch (e) { data = null; }
    }
    return data;
  }

  const Sites = {
    MAP_TYPE_FARM, MAP_TYPE_RANCH, MAP_TYPE_MUSEUM, MAP_TYPE_SHOP,
    MAP_TYPE_STORAGE, MAP_TYPE_CAMP, MAP_TYPE_HOME, MAP_TYPE_SHELTER,
    KIND,

    /** 0-FA：绑定运行时站点表 g.randSites（随机地城槽位 450..499） */
    bindGame,

    /** 同步读取动态站点列表（渲染 / 控制台用） */
    dynamicList(g) { return dynamicList(g); },

    async load() {
      if (data) return data;
      if (Elona.Data) {
        try { data = await Elona.Data.table('world_sites'); } catch (e) { data = null; }
      }
      return data;
    },

    /** 表是否已就绪（同步路径调用前应确认） */
    ready() { return !!table(); },

    /** site 记录（含 mapFile / nameJp / nameEn / fields）；0-FA 起也含动态随机地城 */
    get(mapId, g) {
      return record(mapId | 0, g);
    },

    /** var_132(16, mapId)：site 表 → 0 */
    rawType(mapId, g) {
      const s = this.get(mapId, g);
      return s ? (s.fields[16] | 0) : 0;
    },

    /**
     * 地图类型。优先运行时覆盖（玩家地产），其次 site 表，最后按名字兜底。
     * @param {object} [g] 游戏对象（读 g.v132 运行时覆盖）
     * @param {number} mapId
     * @param {object} [opts] { mapType, mapName }
     */
    typeOf(mapId, opts, g) {
      const o = opts || {};
      if (o.mapType) return o.mapType | 0;
      if (g && g.v132) {
        const rt = g.v132[String(mapId | 0)];
        if (rt !== undefined) return rt | 0;
      }
      const t = this.get(mapId);
      if (t && (t.fields[16] | 0)) return t.fields[16] | 0;
      // site 表里没有（或该条 type 为 0，如 site 0 这个占位）→ 按地图名兜底
      if (o.mapName) {
        const guess = this.typeByName(o.mapName);
        if (guess) return guess;
      }
      return 0;
    },

    /** 按地图文件名推断类型（site 表没有的临时地图） */
    typeByName(name) {
      const t = table();
      const n = String(name || '').toLowerCase();
      if (!n) return 0;
      const rows = (t && t.nameToType) || [];
      let best = 0, bestLen = 0;
      for (const row of rows) {
        const p = String(row.prefix).toLowerCase();
        if (p && n.startsWith(p) && p.length > bestLen) { best = row.type | 0; bestLen = p.length; }
      }
      return best;
    },

    /** mapfile()：mapId + 层数 → 地图文件名 */
    fileOf(mapId, level) {
      const t = table();
      const type = this.rawType(mapId);
      const mf = t && t.mapFile;
      if (mf) {
        const row = mf[String(type)];
        if (row) {
          if (level !== undefined && level !== null && row.level) {
            const hit = row.level[String(level | 0)];
            if (hit) return hit;
          }
          if (row.default) return row.default;
        }
      }
      // 玩家自建建筑：var_132(15) 的地图 id → map_initcustom 的文件名（238053-238145）
      const estType = ESTATE_MAP_IDS[mapId | 0];
      if (estType && ESTATE_MAP_FILES[estType]) return ESTATE_MAP_FILES[estType];
      const s = this.get(mapId);
      if (s && s.mapFile) return s.mapFile;
      return (mf && mf._default) || 'vernis';
    },

    /** 建筑类型（var_132(16)）→ 地图文件名（238053-238145） */
    estateFile(type) {
      return ESTATE_MAP_FILES[type | 0] || '';
    },

    /**
     * mapname()：名称（mapId 也可能是直接用类型号，如 103）
     * 0-FF：玩家地产（槽位 300..449）走 `site.nameJp / nameEn`，
     *   它没有 mapName 表项时按 `var_132(16)` 的类型名回转（103 → 农田 / 31 → 牧场）。
     */
    nameOf(mapId, lang, g) {
      const rec = record(mapId | 0, g);
      // 0-FA：随机地城用源码 mapname() 的前缀+后缀（中文），不落在静态 mapName 表里
      if (rec && rec.dyn) {
        return Elona.RandDungeon ? Elona.RandDungeon.nameOf(rec) : (rec.nameZh || '');
      }
      if (rec && rec.player) {
        return lang === 'jp' ? (rec.nameJp || rec.name || '') : (rec.nameEn || rec.name || '');
      }
      const t = table();
      const type = this.rawType(mapId, g) || (mapId | 0);
      const nm = t && t.mapName && t.mapName[String(type)];
      if (nm) return lang === 'jp' ? (nm.jp || '') : (nm.en || '');
      const s = this.get(mapId, g);
      if (s) return lang === 'jp' ? (s.nameJp || '') : (s.nameEn || '');
      return '';
    },

    /** var_132(30)：所属世界地图 id */
    worldOf(mapId) {
      const s = this.get(mapId);
      return s ? (s.fields[30] | 0) : 0;
    },

    /** 世界地图本体文件（249618-249649）；未知世界按北ティリス处理 */
    worldMapFile(worldId) {
      const t = table();
      const wf = (t && t.worldMapFile) || {};
      const hit = wf[String(worldId | 0)];
      if (hit) return hit;
      return wf['4'] || 'ntyris';
    },

    /**
     * 某世界地图上的全部 site（按 y、x 排序）。
     * @param {number} worldId
     * @param {object} [opts] { placed: true } 只要真正放到世界地图上的
     *   —— 249702：`var_132(15, cnt) == 0` 的 site 不放置（世界地图本体、Wilderness 等）
     */
    ofWorld(worldId, opts, g) {
      const t = table();
      const w = worldId | 0;
      const placedOnly = !!(opts && opts.placed);
      const rows = t && t.order ? t.order.map((id) => t.sites[String(id)]).filter(Boolean) : [];
      // 0-FA：合并运行时随机地城站点（槽位 450..499）
      const all = rows.concat(dynamicList(g));
      return all
        .filter((s) => s && (s.fields[30] | 0) === w && (!placedOnly || (s.fields[15] | 0) !== 0))
        .sort((a, b) => ((a.fields[2] | 0) - (b.fields[2] | 0)) || ((a.fields[1] | 0) - (b.fields[1] | 0))
          || ((a.id | 0) - (b.id | 0)));
    },

    all(g) {
      const t = table();
      const rows = t && t.order ? t.order.map((id) => t.sites[String(id)]).filter(Boolean) : [];
      return rows.concat(dynamicList(g));
    },

    /**
     * 世界地图格 (x, y) 上**可进入**的 site —— 只匹配入口格。
     *
     * 【0-DF 修正】原版只把 site 的**中心一格**设为入口：
     *   249758：`cell_featset var_132(1,cnt), var_132(2,cnt), var_132(15,cnt), 15, cnt\100, cnt/100`
     * 而 var_132(3)/var_132(4)（width/height）只是该地图自身的尺寸（用于地图加载/视野），
     * 与世界地图上的占格无关。
     * 旧实现按 width×height 做矩形包含判定，于是「アクリ・テオラ」（x21 y27 w8 h1）
     * 整个 8 格宽都成了入口——玩家从 Vernis(26,23) 往南走到 (26,27) 就凭空进了 Cyber Dome。
     *
     * 【A138】现在先读世界地图格的 feat（type 15，值里带 site 槽位），
     *   与源码 `cell_featset(..., 15, cnt\100, cnt/100)` 同构；没有 feat 时才退回扫描。
     */
    at(worldId, x, y, g) {
      const xx = x | 0, yy = y | 0;
      // A138：世界地图格的 feat（`var_704(x, y, 6)`）
      const featSite = this.siteAtFeat(g, worldId, xx, yy);
      if (featSite) return featSite;
      // 0-CY：玩家自己建造的地产（运行时记录，g.propertySites）
      if (g && g.propertySites) {
        for (const k of Object.keys(g.propertySites)) {
          const s = g.propertySites[k];
          if (!s) continue;
          if ((s.world | 0) !== (worldId | 0)) continue;
          if ((s.x | 0) === xx && (s.y | 0) === yy) return s;
        }
      }
      for (const s of this.ofWorld(worldId, { placed: true }, g)) {
        if ((s.fields[1] | 0) === xx && (s.fields[2] | 0) === yy) return s;
      }
      return null;
    },

    // ------------------------------------------------------------------
    // A138：世界地图格的 site 特性（249744-249764）
    // ------------------------------------------------------------------
    /**
     * 249758 的打包值与 `cell_featset` 完全一致：
     *   `id = var_132(15, cnt)`（地图/图标 id）· `type = 15` ·
     *   `sub = cnt \ 100` · `arg3 = cnt / 100`
     * 由 sub + arg3*100 还原槽位 cnt，再到**同一顺序**的世界地图站点表里取第 cnt 个。
     */
    featValueOf(site, cnt) {
      if (!site) return 0;
      const id = site.fields ? (site.fields[15] | 0) : (site.featId | 0);
      const c = cnt | 0;
      const sub = c % 100;               // `cnt \ 100`（HSP 的 \ 是取余）
      const arg3 = idiv(c, 100);
      return id + 15 * 1000 + sub * 100000 + arg3 * 10000000;
    },

    /**
     * 把某世界地图上所有已放置 site 落成格子特性（`cell_featset`）。
     * 世界地图在本项目里不是逐格 GameMap，因此特性表挂在 `g.worldFeats[worldId]`：
     * 键 "x,y" → 打包值。语义与源码相同（一格一个入口 + 槽位编码）。
     */
    buildWorldFeats(g, worldId) {
      if (!g) return null;
      const w = worldId | 0;
      if (!g.worldFeats) g.worldFeats = {};
      const bag = {};
      const list = this.ofWorld(w, { placed: true }, g);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const x = s.fields[1] | 0, y = s.fields[2] | 0;
        bag[x + ',' + y] = this.featValueOf(s, i);
        // 249762：kind 2 / 3（城镇类）额外写 `var_704(x, y, 9) = 11`（入口向标）
        const kind = s.fields[0] | 0;
        if (kind === 2 || kind === 3) bag['m' + x + ',' + y] = 11;
      }
      // 玩家地产（0-CY 的运行时站点）也占一格
      if (g.propertySites) {
        for (const k of Object.keys(g.propertySites)) {
          const s = g.propertySites[k];
          if (!s || (s.world | 0) !== w) continue;
          bag[(s.x | 0) + ',' + (s.y | 0)] =
            (s.featId | 0) + 15 * 1000 + 99 * 100000;      // 槽位 99xx 段留给自建地产
        }
      }
      g.worldFeats[w] = bag;
      return bag;
    },

    /** 读取世界地图格的 feat 值（`var_704(x, y, 6)`；0 = 没有特性） */
    worldFeatAt(g, worldId, x, y) {
      const bag = g && g.worldFeats && g.worldFeats[worldId | 0];
      if (!bag) return 0;
      return bag[(x | 0) + ',' + (y | 0)] | 0;
    },

    /** 由 feat 值找到站点（type 必须是 15；槽位解码后按同一顺序取表） */
    siteAtFeat(g, worldId, x, y) {
      const v = this.worldFeatAt(g, worldId, x, y);
      if (!v) return null;
      const type = idiv(v, 1000) % 100;
      if (type !== 15) return null;
      const sub = idiv(v, 100000) % 100;
      const arg3 = idiv(v, 10000000);
      const slot = sub + arg3 * 100;
      const list = this.ofWorld(worldId, { placed: true }, g);
      if (slot >= 0 && slot < list.length) return list[slot];
      return null;
    },

    /** 矩形范围包含（只用于显示/查询，**不用于进入判定**） */
    atArea(worldId, x, y, g) {
      const xx = x | 0, yy = y | 0;
      for (const s of this.ofWorld(worldId, { placed: true }, g)) {
        const fx = s.fields[1] | 0, fy = s.fields[2] | 0;
        const w = Math.max(1, s.fields[3] | 0), h = Math.max(1, s.fields[4] | 0);
        if (xx >= fx && xx < fx + w && yy >= fy && yy < fy + h) return s;
      }
      return null;
    },

    // ---------------- 便捷判定 ----------------
    /** 参数既可以是地图 id，也可以直接是类型号（103 / 31） */
    isFarm(typeOrId, opts, g) {
      const v = typeOrId | 0;
      if (v === MAP_TYPE_FARM) return true;
      return this.typeOf(v, opts, g) === MAP_TYPE_FARM;
    },
    isRanch(typeOrId, opts, g) {
      const v = typeOrId | 0;
      if (v === MAP_TYPE_RANCH) return true;
      return this.typeOf(v, opts, g) === MAP_TYPE_RANCH;
    },
    isMuseum(t) { return (t | 0) === MAP_TYPE_MUSEUM; },
    isShop(t) { return (t | 0) === MAP_TYPE_SHOP; },
    isStorage(t) { return (t | 0) === MAP_TYPE_STORAGE; },

    kindOf(mapId) {
      const s = this.get(mapId);
      return s ? (s.fields[0] | 0) : 0;
    },
    kindName(mapId) { return KIND[this.kindOf(mapId)] || 'none'; },
    isTown(mapId) {
      const k = this.kindOf(mapId);
      return k === 1 || k === 3;
    },
    /** 迷宫：kind 20..27（ネフィア）或 2/6/7（关所/谷间/据点） */
    isDungeon(mapId) {
      const k = this.kindOf(mapId);
      return (k >= 20 && k <= 27) || k === 2 || k === 6 || k === 7;
    },

    minLevel(mapId) { const s = this.get(mapId); return s ? (s.fields[17] | 0) : 0; },
    maxLevel(mapId) { const s = this.get(mapId); return s ? (s.fields[10] | 0) : 0; },

    /** 写运行时类型（玩家买地/建博物馆时用，等价于 var_132(16, newId)） */
    setRuntimeType(g, mapId, type) {
      if (!g) return;
      g.v132 = g.v132 || {};
      g.v132[String(mapId | 0)] = type | 0;
    },

    /** 已提取的地图文件名集合（data/index/maps.json），用于判断能否直接加载 */
    async mapNames() {
      if (this._mapNames) return this._mapNames;
      let list = [];
      try {
        const d = await Elona.Data.fetchJson('data/index/maps.json');
        list = (Array.isArray(d) ? d : []).map((x) => x.name);
      } catch (e) { list = []; }
      this._mapNames = new Set(list);
      return this._mapNames;
    },

    hasMapSync(name) {
      return !!(this._mapNames && this._mapNames.has(name));
    },

    /** 统计信息（控制台用） */
    stats() {
      const t = table();
      if (!t) return null;
      return {
        count: t.count,
        worlds: [...new Set(t.order.map((id) => t.sites[String(id)].fields[30] | 0))].sort((a, b) => a - b),
        mapFiles: Object.keys(t.mapFile || {}).filter((k) => k !== '_default').length,
        names: Object.keys(t.mapName || {}).length,
      };
    },
  };

  Elona.Sites = Sites;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sites;
})(typeof window !== 'undefined' ? window : global);
