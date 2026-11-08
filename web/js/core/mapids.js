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

  Elona.MapIds = {
    load, lookup, byId, subsOf,
    sites() { return (data && data.sites) || []; },
    meta() { return (data && data.meta) || {}; },
    _reset() { data = null; loading = null; },
  };
})(window);
