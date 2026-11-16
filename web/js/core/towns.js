'use strict';
/**
 * 城镇列表 —— 原版 var_132(1/2/16, mapId) 的城镇部分。
 *
 * 地图文件来自 mapfile()（11977-12110）：
 *   5 vernis / 11 kapul / 12 yowyn / 14 rogueden / 15 palmia /
 *   33 noyel / 36 lumiest / 50 eirel / 52 melkawn1 / 53 kurualm /
 *   54 valm / 55 melugas / 56 arcbelc / 57 ludus
 *
 * `base/size` 是本作给各城镇 NPC 预留的 var_58 角色槽区间：
 *   - 城镇 NPC 只在当前城镇存在；var_434 委托用 (map, clientIndex) 共同定位委托人，
 *     因此各城镇可以复用同一段槽位（57..131）。
 *   - 236..240 留给护送委托人跟随者。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  const BASE = 57, SIZE = 75;   // 57..131，足够容纳原版最大城镇（Palmia 72 个）
  // 0-Z0：城镇数据以 web/data/tables/world_sites.json（*label_2474 提取的 var_132 表）
  //   为唯一数据源 —— fields[0] == 3 的据点就是城镇，坐标 fields[1/2]，
  //   所属世界 fields[30]，显示名 nameJp（表内已是中文），nameEn 作英文兜底，
  //   mapFile 作 loadMap 的地图键。Sites.load() 之后 syncFromSites() 整体重建 LIST。
  //   这样 70 号世界的鲁斯托尔仙窟(77) / 奥尔德拉恩(81) 会自动进列表 ——
  //   下面这份硬编码兜底此前漏了它们（用户指出「又不全」）。
  // 硬编码 FALLBACK 只在表未就绪时兜底（boot 顺序保护），字段与表一致。
  const mk = (name, id, label, zh, wx, wy, world) =>
    ({ name, id, label, zh, wx, wy, world: world | 0, base: BASE, size: SIZE });
  const FALLBACK = [
    // var_132(30) == 4：北提里斯（ntyris）
    mk('vernis', 5, 'Vernis', '韦尔尼斯', 26, 23, 4),
    mk('kapul', 11, 'Kapul', '卡普尔港', 3, 15, 4),
    mk('yowyn', 12, 'Yowyn', '约温', 43, 32, 4),
    mk('rogueden', 14, 'Rogueden', '达尔菲', 14, 35, 4),
    mk('palmia', 15, 'Palmia', '帕尔米亚', 53, 24, 4),
    mk('noyel', 33, 'Noyel', '诺耶尔', 89, 14, 4),
    mk('lumiest', 36, 'Lumiest', '鲁米埃斯特', 61, 32, 4),
    // var_132(30) == 44：南提里斯（styris）
    mk('eirel', 50, 'Eirel', '艾雷尔', 41, 2, 44),
    mk('melkawn1', 52, 'Melkawn', '梅尔卡恩', 24, 11, 44),
    mk('kurualm', 53, 'Kurualm', '库鲁阿尔姆', 16, 10, 44),
    mk('valm', 54, 'Valm', '瓦尔姆', 3, 33, 44),
    mk('melugas', 55, 'Melugas', '梅尔加斯', 25, 29, 44),
    mk('arcbelc', 56, 'Arcbelc', '阿克·贝尔克', 30, 42, 44),
    mk('ludus', 57, 'Ludus', '卢杜斯', 56, 32, 44),
    // var_132(30) == 70：失落伊尔瓦（lost）
    mk('5cave', 77, 'Rust Plaza', '鲁斯托尔仙窟', 62, 31, 70),
    mk('9dran', 81, 'Ol-dran', '奥尔德拉恩', 23, 17, 70),
  ];
  const LIST = FALLBACK.slice();

  const ESCORT_SLOTS = [236, 237, 238, 239, 240];

  /**
   * 0-Z0：从 var_132 表（world_sites.json）整体重建城镇列表。
   * 城镇判定 = fields[0] == 3（*label_2474 里 var_132(0, site) 的城镇类别）；
   * 坐标 / 世界 / 名称全部以表为准，硬编码兜底仅用于表未加载时。
   * game.js 等处的 `Towns.syncCoords()` 调用点保持不变（别名转发到这里）。
   */
  function syncFromSites() {
    const S = Elona.Sites;
    if (!S || typeof S.ready !== 'function' || !S.ready()) return false;
    const sites = typeof S.all === 'function' ? S.all() : null;
    if (!sites) return false;
    const out = [];
    for (const key of Object.keys(sites)) {
      const s = sites[key];
      if (!s || !s.fields) continue;
      if ((s.fields[0] | 0) !== 3) continue;            // var_132(0) != 3 → 非城镇
      const id = s.id !== undefined ? (s.id | 0) : (key | 0);
      // mapfile 命名（11977-12110）：11 kapul / 14 rogueden / 36 lumiest / 52 melkawn1。
      //   表里这 4 城的 mapFile 是空串 → 回退到 FALLBACK 的地图键，不能编 'siteN'。
      const fb = FALLBACK.find((f) => f.id === id) || null;
      const name = (s.mapFile || (fb && fb.name) || ('site' + id));
      const label = s.nameEn || (fb && fb.label) || name;
      out.push({
        id,
        name,
        label,
        zh: s.nameJp || s.nameEn || name,
        wx: s.fields[1] | 0, wy: s.fields[2] | 0,
        world: (s.fields[30] !== undefined ? s.fields[30] : 4) | 0,
        base: BASE, size: SIZE,
      });
    }
    if (!out.length) return false;
    out.sort((a, b) => a.id - b.id);
    LIST.length = 0;
    for (const t of out) LIST.push(t);
    return true;
  }

  /**
   * 用 site 表（var_132）校正世界地图坐标与所属世界。
   * 0-Z0：升级为整体重建（见 syncFromSites），保留旧名作调用点兼容。
   */
  function syncCoords() { return syncFromSites(); }

  /** 0-Y0：某张世界地图上的城镇（var_132(30) == worldId） */
  function ofWorld(worldId) {
    return LIST.filter((t) => (t.world | 0) === (worldId | 0));
  }

  Elona.Towns = {
    LIST,
    ESCORT_SLOTS,
    syncFromSites, syncCoords, ofWorld,
    byName(name) { return LIST.find((t) => t.name === name) || null; },
    byId(id) { return LIST.find((t) => t.id === (id | 0)) || null; },
    names() { return LIST.map((t) => t.name); },
    labels() { return LIST.map((t) => ({ name: t.name, label: t.label, zh: t.zh })); },
    /** 显示用名字：中文优先，没有则英文（世界地图 / 提示语统一走这里） */
    labelOf(t) { return (t && (t.zh || t.label)) || ''; },
    isTown(name) { return !!this.byName(name); },
    /** 原版 var_1558 / var_1559 可选目的地（排除当前城镇） */
    escortTargets(currentName) {
      return LIST.filter((t) => t.name !== currentName);
    },
  };
})(window);
