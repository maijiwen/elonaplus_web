'use strict';
/**
 * 地图 id 对照表（core/mapids.js）
 *
 * 【源码依据】start.hsp 中所有 `map_reload "名字"` 语句及其外层的
 * `var_65(20) == N` / `var_65(22) == S` 条件（如 245818-246036），
 * 由 tools/extract_map_ids.py 机械提取为 data/index/map_ids.json。
 *
 * 用途：进入地图时写入
 *   var_65(20) = 原版地图 id      （剧情触发链、音乐、天气等都用它判断）
 *   var_65(22) = 子地图 / 楼层    （mapfile() 11977-12110 用它区分城镇与公会等）
 *
 * 只有源码里明确写出对应关系的 54 个地图名才有值；
 * 随机迷宫、临时地图等没有静态注册，lookup() 返回 null，调用方沿用旧逻辑。
 */
(function (global) {
  const Elona = global.Elona = global.Elona || {};

  let data = null;
  let loading = null;

  async function load() {
    if (data) return data;
    if (loading) return loading;
    loading = (async () => {
      try {
        data = await Elona.Data.fetchJson('data/index/map_ids.json');
      } catch (e) {
        data = { byName: {}, sites: [] };
      }
      return data;
    })();
    return loading;
  }

  /** 地图名 → { id, sub }；没有静态注册返回 null */
  function lookup(name) {
    if (!data || !name) return null;
    const e = data.byName[name];
    if (!e) return null;
    return { id: e.id | 0, sub: e.sub === null || e.sub === undefined ? null : (e.sub | 0) };
  }

  /** (id, sub) → 地图名；同 id 多个子地图时按 sub 精确匹配 */
  function byId(id, sub) {
    if (!data) return null;
    const list = (data.sites || []).filter((s) => s.id === (id | 0));
    if (!list.length) return null;
    if (sub !== undefined && sub !== null) {
      const hit = list.find((s) => s.sub === (sub | 0));
      if (hit) return hit.name;
    }
    return list[0].name;
  }

  /** 该 id 下注册过的所有子地图 */
  function subsOf(id) {
    if (!data) return [];
    return (data.sites || []).filter((s) => s.id === (id | 0)).map((s) => s.sub);
  }

  /**
   * 0-K0 / A42·A48：没有静态注册的地图，按源码推导 `var_65(20)`。
   * 原版不是给每个 .map 文件配一个 id，而是在「进入地图」时按上下文赋值：
   *   249630-249649  `var_65(20)==4/44/70/91` → `map_initcustom "ntyris"/"styris"/"lost"/"ether"`
   *                  世界地图本体的 id 就是 4 / 44 / 70 / 91
   *   237464          `var_126(6) in {2,3,4,5,6}`（地下城 / 屋内）→ `var_65(20) = var_65(850)`
   *   237573-237594  从世界区域进入时：850==7(家区域) → 20=7；
   *                  850==4 → 20=10、44 → 51、70 → 71、91 → 92
   *   237457/237460  世界地图上的随机迷宫 → `var_65(20) = 2`
   * 调用方传入的是**换图前**的 850（源码同样如此），因为新 850 要等新地图的
   * site 表查出来之后才写（game.js 1011-1016）。
   * @returns {number|null} null 表示源码没有可判定规则，由调用方保持原值
   */
  function dynamicId(name, worldId, header6) {
    const n = String(name || '').toLowerCase();
    const w = worldId | 0;
    const h = header6 | 0;
    // 世界地图本体（249630-249649）
    if (n === 'ntyris' || n === 'ntyris2' || n === 'world') return 4;
    if (n === 'styris') return 44;
    if (n === 'lost') return 70;
    if (n === 'ether') return 91;
    // 237464：地下城 / 屋内沿用所属世界区域 id
    if (h >= 2 && h <= 6) return w || null;
    // 237573-237594：从世界区域进入的野外 / 区域地图
    const byWorld = { 4: 10, 44: 51, 70: 71, 91: 92 };
    if (byWorld[w]) return byWorld[w];
    // 237457 / 237460：随机迷宫
    if (/^dungeon|nefia|rand|rogue|chaos|sq|meiq|lesimas|abyss/.test(n)) return 2;
    return null;
  }

  Elona.MapIds = {
    load, lookup, byId, subsOf, dynamicId,
    sites() { return (data && data.sites) || []; },
    meta() { return (data && data.meta) || {}; },
    _reset() { data = null; loading = null; },
  };
})(window);
