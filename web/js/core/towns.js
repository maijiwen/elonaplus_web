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
  // wx/wy = 原版 var_132(1/2, mapId) 世界地图坐标（100×60 网格）
  const mk = (name, id, label, wx, wy) => ({ name, id, label, wx, wy, base: BASE, size: SIZE });
  const LIST = [
    mk('vernis', 5, 'Vernis', 26, 23),
    mk('kapul', 11, 'Kapul', 3, 15),
    mk('yowyn', 12, 'Yowyn', 43, 32),
    mk('rogueden', 14, 'Rogueden', 14, 35),
    mk('palmia', 15, 'Palmia', 53, 24),
    mk('noyel', 33, 'Noyel', 89, 14),
    mk('lumiest', 36, 'Lumiest', 61, 32),
    mk('eirel', 50, 'Eirel', 41, 2),
    mk('melkawn1', 52, 'Melkawn', 24, 11),
    mk('kurualm', 53, 'Kurualm', 16, 10),
    mk('valm', 54, 'Valm', 3, 33),
    mk('melugas', 55, 'Melugas', 25, 29),
    mk('arcbelc', 56, 'Arcbelc', 30, 42),
    mk('ludus', 57, 'Ludus', 56, 32),
  ];

  const ESCORT_SLOTS = [236, 237, 238, 239, 240];

  /**
   * 用 site 表（var_132）校正世界地图坐标。
   * 上面的硬编码值只是兜底；表加载后以 `*label_2474` 提取的数据为准。
   */
  function syncCoords() {
    const S = Elona.Sites;
    if (!S || typeof S.ready !== 'function' || !S.ready()) return false;
    for (const t of LIST) {
      const s = S.get(t.id);
      if (!s) continue;
      const x = s.fields[1], y = s.fields[2];
      if (x !== undefined && y !== undefined) { t.wx = x | 0; t.wy = y | 0; }
    }
    return true;
  }

  Elona.Towns = {
    LIST,
    ESCORT_SLOTS,
    syncCoords,
    byName(name) { return LIST.find((t) => t.name === name) || null; },
    byId(id) { return LIST.find((t) => t.id === (id | 0)) || null; },
    names() { return LIST.map((t) => t.name); },
    labels() { return LIST.map((t) => ({ name: t.name, label: t.label })); },
    isTown(name) { return !!this.byName(name); },
    /** 原版 var_1558 / var_1559 可选目的地（排除当前城镇） */
    escortTargets(currentName) {
      return LIST.filter((t) => t.name !== currentName);
    },
  };
})(window);
